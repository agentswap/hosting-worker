import { execa } from 'execa'

import { logger } from '../../logger/index.ts'

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

type DockerServiceOptions = {
  codeDirectory: string
  dockerImageName: string
  internalPort: number
}

export class DockerService {
  #codeDirectory: string
  #dockerImageName: string
  #internalPort: number

  public constructor(options: DockerServiceOptions) {
    const { codeDirectory, dockerImageName, internalPort } = options
    this.#codeDirectory = codeDirectory
    this.#dockerImageName = dockerImageName
    this.#internalPort = internalPort
  }

  public async build() {
    const dockerBuildArguments = [
      'build',
      '-t',
      `${this.#dockerImageName}`,
      '.',
    ]
    logger.debug(
      `Docker build arguments: docker ${dockerBuildArguments.join(' ')}`
    )
    const { exitCode: dockerBuildExitCode, stderr: dockerBuildError } =
      await execa('docker', dockerBuildArguments, {
        cwd: this.#codeDirectory,
        reject: false,
      })
    if (dockerBuildExitCode !== 0) {
      logger.error(`Error docker build: ${dockerBuildError}`)
      throw new Error(`Failed to build docker image: ${this.#dockerImageName}`)
    }
  }

  public async ps(): Promise<DockerContainerInfo> {
    const dockerPsArguments = [
      'ps',
      '-a',
      '--filter',
      `name=${this.#dockerImageName}`,
      '--format',
      '{{json .}}',
    ]
    logger.debug(`Docker ps arguments: docker ${dockerPsArguments.join(' ')}`)
    const {
      stdout: dockerPsOutput,
      exitCode: dockerPsExitCode,
      stderr: dockerPsError,
    } = await execa('docker', dockerPsArguments, {
      cwd: this.#codeDirectory,
      reject: false,
    })
    if (dockerPsExitCode !== 0) {
      logger.error(`Error docker ps: ${dockerPsError}`)
      throw new Error(
        `Failed to check docker image: ${this.#dockerImageName} status`
      )
    }
    logger.debug(`Docker ps output: ${dockerPsOutput}`)
    const dockerPsOutputJson: DockerContainerInfo = JSON.parse(
      dockerPsOutput || '{}'
    )
    return dockerPsOutputJson
  }

  public async kill(id: string) {
    const dockerKillArguments = ['kill', id]
    logger.debug(
      `Docker kill arguments: docker ${dockerKillArguments.join(' ')}`
    )
    const { exitCode: dockerKillExitCode, stderr: dockerKillError } =
      await execa('docker', dockerKillArguments, {
        cwd: this.#codeDirectory,
        reject: false,
      })
    if (dockerKillExitCode !== 0) {
      logger.error(`Error docker kill: ${dockerKillError}`)
      throw new Error(`Failed to stop docker image: ${id}`)
    }
  }

  public async remove(id: string, force = false) {
    const dockerRmArguments = ['rm', id]
    if (force) dockerRmArguments.push('-f')
    logger.debug(`Docker rm arguments: docker ${dockerRmArguments.join(' ')}`)
    const { exitCode: dockerRmExitCode, stderr: dockerRmError } = await execa(
      'docker',
      dockerRmArguments,
      { cwd: this.#codeDirectory, reject: false }
    )
    if (dockerRmExitCode !== 0) {
      logger.error(`Error docker rm: ${dockerRmError}`)
      throw new Error(`Failed to remove docker image: ${id}`)
    }
  }

  public async run(
    bindPort: number,
    environments: Record<string, string> = {}
  ) {
    const dockerRunArguments = [
      'run',
      '-d',
      '-p',
      `${bindPort}:${this.#internalPort}`,
      ...Object.entries(environments).flatMap(([key, value]) => [
        '-e',
        `${key}=${value}`,
      ]),
      '--name',
      this.#dockerImageName,
      this.#dockerImageName,
    ]
    logger.debug(`Docker run arguments: docker ${dockerRunArguments.join(' ')}`)
    const { exitCode: dockerRunExitCode, stderr: dockerRunError } = await execa(
      'docker',
      dockerRunArguments,
      { cwd: this.#codeDirectory, reject: false }
    )
    if (dockerRunExitCode !== 0) {
      logger.error(`Error docker run: ${dockerRunError}`)
      throw new Error(`Failed to run docker image: ${this.#dockerImageName}`)
    }
  }
}
