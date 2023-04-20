import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { execa } from 'execa'
import { kebabCase } from 'lodash-es'

import { environment } from '../env/index.ts'
import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export type DeployGradioTaskInfo = {
  port: number
  repositoryOwner: string
  repositoryName: string
}

export type DeployGradioTaskResult = {
  port: number
  imageName: string
}

export async function deployGradio(
  info: DeployGradioTaskInfo
): Promise<DeployGradioTaskResult> {
  const { port, repositoryOwner, repositoryName } = info
  const githubUrl = `https://github.com/${repositoryOwner}/${repositoryName}`

  // Prepare temporary directory
  const codeDirectory = fs.mkdtempSync(
    `${path.join(os.tmpdir(), repositoryName)}-`
  )
  logger.debug(`Temporary directory: ${codeDirectory}`)

  // Clone repository
  logger.info(`Cloning repository: ${githubUrl}`)
  await cloneRepository(githubUrl, codeDirectory)

  // Copy Dockerfile
  const dockerFilePath = path.join(__dirname, '../scripts/Dockerfile')
  logger.info(`Copying Dockerfile ${dockerFilePath} to: ${codeDirectory}`)
  await fsHelper.cp(dockerFilePath, codeDirectory)

  // Build docker image
  const kebabOwner = kebabCase(repositoryOwner)
  const kebabName = kebabCase(repositoryName)
  const dockerImageName = `${kebabOwner}-${kebabName}`
  logger.info(`Building docker image: ${dockerImageName}`)
  await dockerBuild(dockerImageName, codeDirectory)

  // Prepare run docker image
  logger.info(`Checking if docker image is already running: ${dockerImageName}`)
  const checkOldImageRunning = await dockerPs(dockerImageName, codeDirectory)
  if (checkOldImageRunning.ID) {
    logger.debug(
      `Docker image ${checkOldImageRunning.Image} state: ${checkOldImageRunning.State}`
    )
  }

  // Stop and remove docker image
  if (checkOldImageRunning.State === 'running') {
    logger.info(`Stopping docker image: ${dockerImageName}`)
    await dockerKill(checkOldImageRunning.ID, codeDirectory)

    logger.info(`Removing docker image: ${dockerImageName}`)
    await dockerRemove(checkOldImageRunning.ID, codeDirectory, true)
  }

  // Run docker image
  logger.info(`Running docker image: ${dockerImageName}`)
  await dockerRun(dockerImageName, port, codeDirectory)

  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Check if docker image is running
  logger.info(`Checking if docker image is running: ${dockerImageName}`)
  const checkImageRunning = await dockerPs(dockerImageName, codeDirectory)
  if (!(checkImageRunning.State === 'running')) {
    logger.error(`Docker image ${dockerImageName} failed to start`)
    throw new Error(`Docker image ${dockerImageName} failed to start`)
  }

  // Remove temporary directory
  logger.debug(`Removing temporary directory: ${codeDirectory}`)
  await fsHelper.rmRF(codeDirectory)

  return { port, imageName: dockerImageName }
}

async function cloneRepository(githubUrl: string, codeDirectory: string) {
  const gitCloneArguments = ['clone', '--depth=1', githubUrl, codeDirectory]
  logger.debug(`Git clone arguments: git ${gitCloneArguments.join(' ')}`)
  const { exitCode: cloneExitCode, stderr: cloneError } = await execa(
    'git',
    gitCloneArguments,
    { cwd: codeDirectory, reject: false }
  )
  if (cloneExitCode !== 0) {
    logger.error(`Error cloning repository: ${cloneError}`)
    throw new Error(`Failed to clone repository: ${githubUrl}`)
  }
}

async function dockerBuild(dockerImageName: string, codeDirectory: string) {
  const dockerBuildArguments = ['build', '-t', `${dockerImageName}`, '.']
  logger.debug(
    `Docker build arguments: docker ${dockerBuildArguments.join(' ')}`
  )
  const { exitCode: dockerBuildExitCode, stderr: dockerBuildError } =
    await execa('docker', dockerBuildArguments, {
      cwd: codeDirectory,
      reject: false,
    })
  if (dockerBuildExitCode !== 0) {
    logger.error(`Error docker build: ${dockerBuildError}`)
    throw new Error(`Failed to build docker image: ${dockerImageName}`)
  }
}

type DockerContainerInfo = {
  Command: string
  CreatedAt: string
  ID: string
  Image: string
  Labels: string
  LocalVolumes: string
  Mounts: string
  Names: string
  Networks: string
  Ports: string
  RunningFor: string
  Size: string
  State: string
  Status: string
}

async function dockerPs(
  dockerImageName: string,
  codeDirectory: string
): Promise<DockerContainerInfo> {
  const dockerPsArguments = [
    'ps',
    '-a',
    '--filter',
    `name=${dockerImageName}`,
    '--format',
    '{{json .}}',
  ]
  logger.debug(`Docker ps arguments: docker ${dockerPsArguments.join(' ')}`)
  const {
    stdout: dockerPsOutput,
    exitCode: dockerPsExitCode,
    stderr: dockerPsError,
  } = await execa('docker', dockerPsArguments, {
    cwd: codeDirectory,
    reject: false,
  })
  if (dockerPsExitCode !== 0) {
    logger.error(`Error docker ps: ${dockerPsError}`)
    throw new Error(`Failed to check docker image: ${dockerImageName} status`)
  }
  logger.debug(`Docker ps output: ${dockerPsOutput}`)
  const dockerPsOutputJson: DockerContainerInfo = JSON.parse(
    dockerPsOutput || '{}'
  )
  return dockerPsOutputJson
}

async function dockerKill(id: string, codeDirectory: string) {
  const dockerKillArguments = ['kill', id]
  logger.debug(`Docker kill arguments: docker ${dockerKillArguments.join(' ')}`)
  const { exitCode: dockerKillExitCode, stderr: dockerKillError } = await execa(
    'docker',
    dockerKillArguments,
    {
      cwd: codeDirectory,
      reject: false,
    }
  )
  if (dockerKillExitCode !== 0) {
    logger.error(`Error docker kill: ${dockerKillError}`)
    throw new Error(`Failed to stop docker image: ${id}`)
  }
}

async function dockerRemove(id: string, codeDirectory: string, force = false) {
  const dockerRmArguments = ['rm', id]
  if (force) dockerRmArguments.push('-f')
  logger.debug(`Docker rm arguments: docker ${dockerRmArguments.join(' ')}`)
  const { exitCode: dockerRmExitCode, stderr: dockerRmError } = await execa(
    'docker',
    dockerRmArguments,
    { cwd: codeDirectory, reject: false }
  )
  if (dockerRmExitCode !== 0) {
    logger.error(`Error docker rm: ${dockerRmError}`)
    throw new Error(`Failed to remove docker image: ${id}`)
  }
}

async function dockerRun(
  dockerImageName: string,
  bindPort: number,
  codeDirectory: string
) {
  const gradioPort = environment.GRADIO_PORT
  const dockerRunArguments = [
    'run',
    '-d',
    '-p',
    `${bindPort}:${gradioPort}`,
    '--name',
    dockerImageName,
    dockerImageName,
  ]
  logger.debug(`Docker run arguments: docker ${dockerRunArguments.join(' ')}`)
  const { exitCode: dockerRunExitCode, stderr: dockerRunError } = await execa(
    'docker',
    dockerRunArguments,
    { cwd: codeDirectory, reject: false }
  )
  if (dockerRunExitCode !== 0) {
    logger.error(`Error docker run: ${dockerRunError}`)
    throw new Error(`Failed to run docker image: ${dockerImageName}`)
  }
}
