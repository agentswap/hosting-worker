import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { createError, defineEventHandler, sendError } from 'h3'
import { useValidatedBody } from 'h3-zod'
import { kebabCase } from 'lodash-es'
import { z } from 'zod'

import { environment } from '../env/index.ts'
import { AgentSwapService } from '../services/agent-swap/index.ts'
import { CaddyService } from '../services/caddy/index.ts'
import { DockerService } from '../services/docker/index.ts'
import { GitService } from '../services/git/index.ts'
import { GitHubService } from '../services/github/index.ts'
import { HuggingFaceService } from '../services/huggingface/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'

const GitHubUrlRegex = /github\.com\/(.*)\/(.*)/
const HuggingFaceUrlRegex = /huggingface\.co\/spaces\/(.*)\/(.*)/

type GitRepoInfo = {
  repoOwner: string
  repoName: string
  repoUrl: string
}

async function rebuildGitRepoInfo(gitUrl: string): Promise<GitRepoInfo> {
  const matchGitHub = gitUrl.match(GitHubUrlRegex)
  if (matchGitHub) {
    const [, repoOwner, repoName_] = matchGitHub
    const repoName = repoName_.replace(/\.git$/, '')

    const github = new GitHubService({})
    await github.checkRepoExists(repoOwner, repoName)

    const url = new URL(`${repoOwner}/${repoName}`, 'https://github.com')
    return { repoOwner, repoName, repoUrl: url.href }
  }

  const matchHuggingFace = gitUrl.match(HuggingFaceUrlRegex)
  if (matchHuggingFace) {
    const [, repoOwner, repoName] = matchHuggingFace

    const huggingface = new HuggingFaceService({})
    await huggingface.checkSpaceExists(repoOwner, repoName)

    const url = new URL(
      `spaces/${repoOwner}/${repoName}`,
      'https://huggingface.co'
    )
    return { repoOwner, repoName, repoUrl: url.href }
  }

  throw new Error(`Invalid repository URL: ${gitUrl}`)
}

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const agentSwap = new AgentSwapService({
  baseUrl: environment.AGENTSWAP_URL,
  workerToken: environment.WORKER_TOKEN,
})

export type ModelAppResult = {
  id: number
  port: number
  imageName: string
}

const bodySchema = z.object({
  id: z.number(),
  url: z.string().url(),
  name: z.string(),
})

export default defineEventHandler<ModelAppResult | void>(async (event) => {
  const body = await useValidatedBody(event, bodySchema)
  const { id, url } = body

  let codeDirectory

  try {
    event.node.req.log.info(`Creating model app ${id} from ${url}`)

    // Check git repo url
    const { repoOwner, repoName, repoUrl } = await rebuildGitRepoInfo(url)

    // Prepare temporary directory
    codeDirectory = fs.mkdtempSync(`${path.join(os.tmpdir(), repoName)}-`)
    event.node.req.log.debug(`Temporary directory ${codeDirectory}`)

    // Clone repository
    const git = await GitService.createGitService({ codeDirectory })
    event.node.req.log.info(`Cloning repository ${repoUrl}`)
    await git.clone(repoUrl)

    // Copy Dockerfile
    const dockerFilePath = path.join(__dirname, '../../scripts/Dockerfile')
    event.node.req.log.info(
      `Copying Dockerfile ${dockerFilePath} to ${codeDirectory}`
    )
    await fsHelper.cp(dockerFilePath, codeDirectory)

    // Build docker image
    const kebabOwner = kebabCase(repoOwner)
    const kebabName = kebabCase(repoName)
    const dockerImageName = `${kebabOwner}-${kebabName}-${id}`
    const internalPort = environment.INITIAL_GRADIO_PORT
    const docker = new DockerService({
      codeDirectory,
      dockerImageName,
      internalPort,
    })
    event.node.req.log.info(`Building docker image ${dockerImageName}`)
    await docker.build()

    // Prepare run docker image
    event.node.req.log.info(
      `Checking if docker image ${dockerImageName} is already running`
    )
    const checkOldImage = await docker.ps()

    // Stop and remove docker image
    if (checkOldImage.ID) {
      event.node.req.log.debug(
        `Docker image ${checkOldImage.Image} state ${checkOldImage.State}`
      )

      if (checkOldImage.State === 'running') {
        event.node.req.log.info(`Stopping docker image ${dockerImageName}`)
        await docker.kill(checkOldImage.ID)
      }

      event.node.req.log.info(`Removing docker image ${dockerImageName}`)
      await docker.remove(checkOldImage.ID, true)
    }

    // Run docker image
    const port = Number(id) + environment.INITIAL_GRADIO_PORT
    event.node.req.log.info(`Running docker image ${dockerImageName}`)
    await docker.run(port)

    // Wait for docker run to be ready
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Check if docker image is running
    event.node.req.log.info(
      `Checking if docker image ${dockerImageName} is running`
    )
    const checkImageRunning = await docker.ps()
    if (!(checkImageRunning.State === 'running')) {
      event.node.req.log.error(
        `Docker image ${dockerImageName} failed to start`
      )
      throw new Error(`Docker image ${dockerImageName} failed to start`)
    }

    // Update caddy record
    const caddyfilePath = environment.CADDYFILE_PATH
    const caddy = new CaddyService({ caddyfilePath })
    event.node.req.log.info(`Updating caddyfile for app id ${id}`)
    await caddy.update(`${dockerImageName}.${environment.BASE_HOSTNAME}`, port)
    event.node.req.log.info(`Reloading caddy`)
    await caddy.reload()

    // Report running state
    await agentSwap.reportHostingWorkerState(id, 'Running')

    return { id, port, imageName: dockerImageName }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to build docker image')) {
        // Report build error
        await agentSwap.reportHostingWorkerState(id, 'BuildError')
      } else if (error.message.includes('Failed to run docker image')) {
        // Report runtime error
        await agentSwap.reportHostingWorkerState(id, 'RuntimeError')
      } else {
        // Report unknown error
        await agentSwap.reportHostingWorkerState(id, 'RuntimeError')
      }

      const h3Error = createError({
        ...error,
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        data: { message: error.message },
        fatal: true,
      })

      return sendError(event, h3Error)
    }

    return sendError(event, error as Error)
  } finally {
    // Remove temporary directory
    if (!codeDirectory) return
    event.node.req.log.info(`Removing temporary directory ${codeDirectory}`)
    await fsHelper.rmRF(codeDirectory)
  }
})
