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

  private async execDocker(arguments_: string[], reject = false) {
    logger.debug(`Exec docker ${arguments_.join(' ')}`)
    return await execa('docker', arguments_, {
      cwd: this.#codeDirectory,
      reject,
    })
  }

  public async build() {
    const arguments_ = ['build', '-t', `${this.#dockerImageName}`, '.']
    const { exitCode, stderr } = await this.execDocker(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error docker build: ${stderr}`)
      throw new Error(`Failed to build docker image: ${this.#dockerImageName}`)
    }
  }

  public async ps(): Promise<DockerContainerInfo> {
    const arguments_ = [
      'ps',
      '-a',
      '--filter',
      `name=${this.#dockerImageName}`,
      '--format',
      '{{json .}}',
    ]
    const { stdout, exitCode, stderr } = await this.execDocker(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error docker ps: ${stderr}`)
      throw new Error(
        `Failed to check docker image: ${this.#dockerImageName} status`
      )
    }
    const outputJson: DockerContainerInfo = JSON.parse(stdout || '{}')
    logger.debug(outputJson, `Docker ps output`)
    return outputJson
  }

  public async kill(id: string) {
    const arguments_ = ['kill', id]
    const { exitCode, stderr } = await this.execDocker(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error docker kill: ${stderr}`)
      throw new Error(`Failed to stop docker image: ${id}`)
    }
  }

  public async remove(id: string, force = false) {
    const arguments_ = ['rm', id]
    if (force) arguments_.push('-f')
    const { exitCode, stderr } = await this.execDocker(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error docker rm: ${stderr}`)
      throw new Error(`Failed to remove docker image: ${id}`)
    }
  }

  public async run(
    bindPort: number,
    environments: Record<string, string> = {}
  ) {
    const arguments_ = [
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
    const { exitCode, stderr } = await this.execDocker(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error docker run: ${stderr}`)
      throw new Error(`Failed to run docker image: ${this.#dockerImageName}`)
    }
  }
}
