import { execa } from 'execa'

import { logger } from '../../logger/index.ts'

type GitServiceOptions = {
  codeDirectory: string
  enableLfs?: boolean
}

type GitEnvironment = {
  [key: string]: string
}

export class GitService {
  #codeDirectory: string
  #enableLfs: boolean

  #gitEnv: GitEnvironment = {
    GIT_TERMINAL_PROMPT: '0', // Disable git prompt
    GCM_INTERACTIVE: 'Never', // Disable prompting for git credential manager
  }

  private constructor(options: GitServiceOptions) {
    const { codeDirectory, enableLfs } = options
    this.#codeDirectory = codeDirectory
    this.#enableLfs = enableLfs ?? false
  }

  private async execGit(arguments_: string[], reject = false) {
    logger.debug(`Exec git ${arguments_.join(' ')}`)
    return await execa('git', arguments_, {
      cwd: this.#codeDirectory,
      env: this.#gitEnv,
      reject,
    })
  }

  private async lfsInstall(): Promise<void> {
    const arguments_ = ['lfs', 'install', '--local']
    const { exitCode, stderr } = await this.execGit(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error installing Git LFS: ${stderr}`)
    }
  }

  private async initializeGitService() {
    // Git-lfs will try to pull down assets if any of the local/user/system setting exist.
    // If the user didn't enable `LFS` in their pipeline definition, disable LFS fetch/checkout.
    if (!this.#enableLfs) {
      this.#gitEnv['GIT_LFS_SKIP_SMUDGE'] = '1'
    }

    if (this.#enableLfs) {
      // TODO(550): check git-lfs command
      // await this.lfsInstall()
      throw new Error('Git LFS support not implemented')
    }
  }

  public static async createGitService(options: GitServiceOptions) {
    const service = new GitService(options)
    await service.initializeGitService()
    return service
  }

  public async clone(repoUrl: string) {
    const arguments_ = ['clone', '--depth=1', repoUrl, this.#codeDirectory]
    const { exitCode, stderr } = await this.execGit(arguments_)
    if (exitCode !== 0) {
      logger.error(`Error cloning repository: ${stderr}`)
      throw new Error(`Failed to clone repository: ${repoUrl}`)
    }
  }
}
