import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { kebabCase } from 'lodash-es'

import { environment } from '../env/index.ts'
import { logger } from '../logger/index.ts'
import { DockerService } from '../services/docker/index.ts'
import { GitService } from '../services/git/index.ts'
import { GitHubService } from '../services/github/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const internalPort = environment.INITIAL_GRADIO_PORT

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
    // TODO(550): Check if repo exists

    const url = new URL(
      `spaces/${repoOwner}/${repoName}`,
      'https://huggingface.co'
    )
    return { repoOwner, repoName, repoUrl: url.href }
  }

  throw new Error(`Invalid repository URL: ${gitUrl}`)
}

export type DeployGradioTaskInfo = {
  id: number
  port: number
  url: string
}

export type DeployGradioTaskResult = {
  port: number
  imageName: string
}

export async function deployGradio(
  taskInfo: DeployGradioTaskInfo
): Promise<DeployGradioTaskResult> {
  const { id, port, url } = taskInfo
  const { repoOwner, repoName, repoUrl } = await rebuildGitRepoInfo(url)

  // Prepare temporary directory
  const codeDirectory = fs.mkdtempSync(`${path.join(os.tmpdir(), repoName)}-`)
  logger.debug(`Temporary directory: ${codeDirectory}`)

  try {
    // Clone repository
    const git = await GitService.createGitService({ codeDirectory })
    logger.info(`Cloning repository: ${repoUrl}`)
    await git.clone(repoUrl)

    // Copy Dockerfile
    const dockerFilePath = path.join(__dirname, '../../scripts/Dockerfile')
    logger.info(`Copying Dockerfile ${dockerFilePath} to: ${codeDirectory}`)
    await fsHelper.cp(dockerFilePath, codeDirectory)

    // Build docker image
    const kebabOwner = kebabCase(repoOwner)
    const kebabName = kebabCase(repoName)
    const dockerImageName = `${kebabOwner}-${kebabName}-${id}`
    const docker = new DockerService({
      codeDirectory,
      dockerImageName,
      internalPort,
    })
    logger.info(`Building docker image: ${dockerImageName}`)
    await docker.build()

    // Prepare run docker image
    logger.info(
      `Checking if docker image is already running: ${dockerImageName}`
    )
    const checkOldImage = await docker.ps()

    // Stop and remove docker image
    if (checkOldImage.ID) {
      logger.debug(
        `Docker image ${checkOldImage.Image} state: ${checkOldImage.State}`
      )

      if (checkOldImage.State === 'running') {
        logger.info(`Stopping docker image: ${dockerImageName}`)
        await docker.kill(checkOldImage.ID)
      }

      logger.info(`Removing docker image: ${dockerImageName}`)
      await docker.remove(checkOldImage.ID, true)
    }

    // Run docker image
    logger.info(`Running docker image: ${dockerImageName}`)
    await docker.run(port)

    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Check if docker image is running
    logger.info(`Checking if docker image is running: ${dockerImageName}`)
    const checkImageRunning = await docker.ps()
    if (!(checkImageRunning.State === 'running')) {
      logger.error(`Docker image ${dockerImageName} failed to start`)
      throw new Error(`Docker image ${dockerImageName} failed to start`)
    }

    return { port, imageName: dockerImageName }
  } finally {
    // Remove temporary directory
    logger.info(`Removing temporary directory: ${codeDirectory}`)
    await fsHelper.rmRF(codeDirectory)
  }
}
