import { execa } from 'execa'

import { logger } from '../../logger/index.ts'

type GitServiceOptions = {
  codeDirectory: string
}

export class GitService {
  #codeDirectory: string

  public constructor(options: GitServiceOptions) {
    const { codeDirectory } = options
    this.#codeDirectory = codeDirectory
  }

  public async clone(repoUrl: string) {
    const gitCloneArguments = [
      'clone',
      '--depth=1',
      repoUrl,
      this.#codeDirectory,
    ]
    logger.debug(`Git clone arguments: git ${gitCloneArguments.join(' ')}`)
    const { exitCode: cloneExitCode, stderr: cloneError } = await execa(
      'git',
      gitCloneArguments,
      { cwd: this.#codeDirectory, reject: false }
    )
    if (cloneExitCode !== 0) {
      logger.error(`Error cloning repository: ${cloneError}`)
      throw new Error(`Failed to clone repository: ${repoUrl}`)
    }
  }
}
