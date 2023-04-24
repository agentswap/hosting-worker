import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { kebabCase } from 'lodash-es'

import { environment } from '../env/index.ts'
import { logger } from '../logger/index.ts'
import { DockerService } from '../services/docker/index.ts'
import { GitService } from '../services/git/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export type DeployGradioTaskInfo = {
  id: number
  port: number
  repositoryOwner: string
  repositoryName: string
}

export type DeployGradioTaskResult = {
  port: number
  imageName: string
}

export async function deployGradio({
  id,
  port,
  repositoryOwner,
  repositoryName,
}: DeployGradioTaskInfo): Promise<DeployGradioTaskResult> {
  const githubUrl = `https://github.com/${repositoryOwner}/${repositoryName}`

  // Prepare temporary directory
  const codeDirectory = fs.mkdtempSync(
    `${path.join(os.tmpdir(), repositoryName)}-`
  )
  logger.debug(`Temporary directory: ${codeDirectory}`)

  try {
    // Clone repository
    const git = new GitService({ codeDirectory })
    logger.info(`Cloning repository: ${githubUrl}`)
    await git.clone(githubUrl)

    // Copy Dockerfile
    const dockerFilePath = path.join(__dirname, '../../scripts/Dockerfile')
    logger.info(`Copying Dockerfile ${dockerFilePath} to: ${codeDirectory}`)
    await fsHelper.cp(dockerFilePath, codeDirectory)

    // Build docker image
    const kebabOwner = kebabCase(repositoryOwner)
    const kebabName = kebabCase(repositoryName)
    const dockerImageName = `${kebabOwner}-${kebabName}-${id}`
    const internalPort = environment.INITIAL_GRADIO_PORT
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
    await docker.run(port, { CUSTOM_PATH: `/app/${id}` })

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
