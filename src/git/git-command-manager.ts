import * as path from 'node:path'

import * as exec from '@actions/exec'

import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'
import { packageJson } from '../utils/package-json.ts'
import * as regexpHelper from '../utils/regexp-helper.ts'
import { GitVersion } from './git-version.ts'
import * as referenceHelper from './reference-helper.ts'
import * as retryHelper from './retry-helper.ts'

// Auth header not supported before 2.9
// Wire protocol v2 not supported before 2.18
export const MinimumGitVersion = new GitVersion('2.18')

export interface IGitCommandManager {
  branchDelete(remote: boolean, branch: string): Promise<void>
  branchExists(remote: boolean, pattern: string): Promise<boolean>
  branchList(remote: boolean): Promise<string[]>
  checkout(reference: string, startPoint: string): Promise<void>
  checkoutDetach(): Promise<void>
  config(
    configKey: string,
    configValue: string,
    globalConfig?: boolean,
    add?: boolean
  ): Promise<void>
  configExists(configKey: string, globalConfig?: boolean): Promise<boolean>
  fetch(referenceSpec: string[], fetchDepth?: number): Promise<void>
  getDefaultBranch(repositoryUrl: string): Promise<string>
  getWorkingDirectory(): string
  init(): Promise<void>
  isDetached(): Promise<boolean>
  lfsFetch(reference: string): Promise<void>
  lfsInstall(): Promise<void>
  log1(format?: string): Promise<string>
  remoteAdd(remoteName: string, remoteUrl: string): Promise<void>
  removeEnvironmentVariable(name: string): void
  revParse(reference: string): Promise<string>
  setEnvironmentVariable(name: string, value: string): void
  shaExists(sha: string): Promise<boolean>
  submoduleForeach(command: string, recursive: boolean): Promise<string>
  submoduleSync(recursive: boolean): Promise<void>
  submoduleUpdate(fetchDepth: number, recursive: boolean): Promise<void>
  submoduleStatus(): Promise<boolean>
  tagExists(pattern: string): Promise<boolean>
  tryClean(): Promise<boolean>
  tryConfigUnset(configKey: string, globalConfig?: boolean): Promise<boolean>
  tryDisableAutomaticGarbageCollection(): Promise<boolean>
  tryGetFetchUrl(): Promise<string>
  tryReset(): Promise<boolean>
}

export async function createCommandManager(
  workingDirectory: string,
  lfs: boolean
): Promise<IGitCommandManager> {
  return await GitCommandManager.createCommandManager(workingDirectory, lfs)
}

type GitEnvironment = {
  [key: string]: string
}

class GitCommandManager {
  private gitEnv: GitEnvironment = {
    GIT_TERMINAL_PROMPT: '0', // Disable git prompt
    GCM_INTERACTIVE: 'Never', // Disable prompting for git credential manager
  }
  private gitPath = ''
  private lfs = false
  private workingDirectory = ''

  // Private constructor; use createCommandManager()
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  async branchDelete(remote: boolean, branch: string): Promise<void> {
    const arguments_ = ['branch', '--delete', '--force']
    if (remote) {
      arguments_.push('--remote')
    }
    arguments_.push(branch)

    await this.execGit(arguments_)
  }

  async branchExists(remote: boolean, pattern: string): Promise<boolean> {
    const arguments_ = ['branch', '--list']
    if (remote) {
      arguments_.push('--remote')
    }
    arguments_.push(pattern)

    const output = await this.execGit(arguments_)
    return !!output.stdout.trim()
  }

  async branchList(remote: boolean): Promise<string[]> {
    const result: string[] = []

    // Note, this implementation uses "rev-parse --symbolic-full-name" because the output from
    // "branch --list" is more difficult when in a detached HEAD state.

    // TODO(https://github.com/actions/checkout/issues/786): this implementation uses
    // "rev-parse --symbolic-full-name" because there is a bug
    // in Git 2.18 that causes "rev-parse --symbolic" to output symbolic full names. When
    // 2.18 is no longer supported, we can switch back to --symbolic.

    const arguments_ = ['rev-parse', '--symbolic-full-name']
    if (remote) {
      arguments_.push('--remotes=origin')
    } else {
      arguments_.push('--branches')
    }

    const stderr: string[] = []
    const errline: string[] = []
    const stdout: string[] = []
    const stdline: string[] = []

    const listeners = {
      stderr: (data: Buffer) => {
        stderr.push(data.toString())
      },
      errline: (data: Buffer) => {
        errline.push(data.toString())
      },
      stdout: (data: Buffer) => {
        stdout.push(data.toString())
      },
      stdline: (data: Buffer) => {
        stdline.push(data.toString())
      },
    }

    // Suppress the output in order to avoid flooding annotations with innocuous errors.
    await this.execGit(arguments_, false, true, listeners)

    logger.debug(`stderr callback is: ${stderr}`)
    logger.debug(`errline callback is: ${errline}`)
    logger.debug(`stdout callback is: ${stdout}`)
    logger.debug(`stdline callback is: ${stdline}`)

    for (let branch of stdline) {
      branch = branch.trim()
      if (!branch) {
        continue
      }

      if (branch.startsWith('refs/heads/')) {
        branch = branch.slice('refs/heads/'.length)
      } else if (branch.startsWith('refs/remotes/')) {
        branch = branch.slice('refs/remotes/'.length)
      }

      result.push(branch)
    }

    return result
  }

  async checkout(reference: string, startPoint: string): Promise<void> {
    const arguments_ = ['checkout', '--progress', '--force']
    if (startPoint) {
      arguments_.push('-B', reference, startPoint)
    } else {
      arguments_.push(reference)
    }

    await this.execGit(arguments_)
  }

  async checkoutDetach(): Promise<void> {
    const arguments_ = ['checkout', '--detach']
    await this.execGit(arguments_)
  }

  async config(
    configKey: string,
    configValue: string,
    globalConfig?: boolean,
    add?: boolean
  ): Promise<void> {
    const arguments_: string[] = [
      'config',
      globalConfig ? '--global' : '--local',
    ]
    if (add) {
      arguments_.push('--add')
    }
    arguments_.push(configKey, configValue)
    await this.execGit(arguments_)
  }

  async configExists(
    configKey: string,
    globalConfig?: boolean
  ): Promise<boolean> {
    const pattern = regexpHelper.escape(configKey)
    const output = await this.execGit(
      [
        'config',
        globalConfig ? '--global' : '--local',
        '--name-only',
        '--get-regexp',
        pattern,
      ],
      true
    )
    return output.exitCode === 0
  }

  async fetch(referenceSpec: string[], fetchDepth?: number): Promise<void> {
    const arguments_ = ['-c', 'protocol.version=2', 'fetch']
    if (!referenceSpec.includes(referenceHelper.tagsReferenceSpec)) {
      arguments_.push('--no-tags')
    }

    arguments_.push('--prune', '--progress', '--no-recurse-submodules')
    if (fetchDepth && fetchDepth > 0) {
      arguments_.push(`--depth=${fetchDepth}`)
    } else if (
      fsHelper.fileExistsSync(
        path.join(this.workingDirectory, '.git', 'shallow')
      )
    ) {
      arguments_.push('--unshallow')
    }

    arguments_.push('origin')
    for (const argument of referenceSpec) {
      arguments_.push(argument)
    }

    await retryHelper.execute(async () => {
      await this.execGit(arguments_)
    })
  }

  async getDefaultBranch(repositoryUrl: string): Promise<string> {
    let output: GitOutput | undefined
    await retryHelper.execute(async () => {
      output = await this.execGit([
        'ls-remote',
        '--quiet',
        '--exit-code',
        '--symref',
        repositoryUrl,
        'HEAD',
      ])
    })

    if (output) {
      // Satisfy compiler, will always be set
      for (let line of output.stdout.trim().split('\n')) {
        line = line.trim()
        if (line.startsWith('ref:') || line.endsWith('HEAD')) {
          return line
            .slice(
              'ref:'.length,
              'ref:'.length + line.length - 'ref:'.length - 'HEAD'.length
            )
            .trim()
        }
      }
    }

    throw new Error('Unexpected output when retrieving default branch')
  }

  getWorkingDirectory(): string {
    return this.workingDirectory
  }

  async init(): Promise<void> {
    await this.execGit(['init', this.workingDirectory])
  }

  async isDetached(): Promise<boolean> {
    // Note, "branch --show-current" would be simpler but isn't available until Git 2.22
    const output = await this.execGit(
      ['rev-parse', '--symbolic-full-name', '--verify', '--quiet', 'HEAD'],
      true
    )
    return !output.stdout.trim().startsWith('refs/heads/')
  }

  async lfsFetch(reference: string): Promise<void> {
    const arguments_ = ['lfs', 'fetch', 'origin', reference]

    await retryHelper.execute(async () => {
      await this.execGit(arguments_)
    })
  }

  async lfsInstall(): Promise<void> {
    await this.execGit(['lfs', 'install', '--local'])
  }

  async log1(format?: string): Promise<string> {
    const arguments_ = format ? ['log', '-1', format] : ['log', '-1']
    const silent = format ? false : true
    const output = await this.execGit(arguments_, false, silent)
    return output.stdout
  }

  async remoteAdd(remoteName: string, remoteUrl: string): Promise<void> {
    await this.execGit(['remote', 'add', remoteName, remoteUrl])
  }

  removeEnvironmentVariable(name: string): void {
    delete this.gitEnv[name]
  }

  /**
   * Resolves a ref to a SHA. For a branch or lightweight tag, the commit SHA is returned.
   * For an annotated tag, the tag SHA is returned.
   * @param {string} ref  For example: 'refs/heads/main' or '/refs/tags/v1'
   * @returns {Promise<string>}
   */
  async revParse(reference: string): Promise<string> {
    const output = await this.execGit(['rev-parse', reference])
    return output.stdout.trim()
  }

  setEnvironmentVariable(name: string, value: string): void {
    this.gitEnv[name] = value
  }

  async shaExists(sha: string): Promise<boolean> {
    const arguments_ = ['rev-parse', '--verify', '--quiet', `${sha}^{object}`]
    const output = await this.execGit(arguments_, true)
    return output.exitCode === 0
  }

  async submoduleForeach(command: string, recursive: boolean): Promise<string> {
    const arguments_ = ['submodule', 'foreach']
    if (recursive) {
      arguments_.push('--recursive')
    }
    arguments_.push(command)

    const output = await this.execGit(arguments_)
    return output.stdout
  }

  async submoduleSync(recursive: boolean): Promise<void> {
    const arguments_ = ['submodule', 'sync']
    if (recursive) {
      arguments_.push('--recursive')
    }

    await this.execGit(arguments_)
  }

  async submoduleUpdate(fetchDepth: number, recursive: boolean): Promise<void> {
    const arguments_ = ['-c', 'protocol.version=2']
    arguments_.push('submodule', 'update', '--init', '--force')
    if (fetchDepth > 0) {
      arguments_.push(`--depth=${fetchDepth}`)
    }

    if (recursive) {
      arguments_.push('--recursive')
    }

    await this.execGit(arguments_)
  }

  async submoduleStatus(): Promise<boolean> {
    const output = await this.execGit(['submodule', 'status'], true)
    logger.debug(output.stdout)
    return output.exitCode === 0
  }

  async tagExists(pattern: string): Promise<boolean> {
    const output = await this.execGit(['tag', '--list', pattern])
    return !!output.stdout.trim()
  }

  async tryClean(): Promise<boolean> {
    const output = await this.execGit(['clean', '-ffdx'], true)
    return output.exitCode === 0
  }

  async tryConfigUnset(
    configKey: string,
    globalConfig?: boolean
  ): Promise<boolean> {
    const output = await this.execGit(
      [
        'config',
        globalConfig ? '--global' : '--local',
        '--unset-all',
        configKey,
      ],
      true
    )
    return output.exitCode === 0
  }

  async tryDisableAutomaticGarbageCollection(): Promise<boolean> {
    const output = await this.execGit(
      ['config', '--local', 'gc.auto', '0'],
      true
    )
    return output.exitCode === 0
  }

  async tryGetFetchUrl(): Promise<string> {
    const output = await this.execGit(
      ['config', '--local', '--get', 'remote.origin.url'],
      true
    )

    if (output.exitCode !== 0) {
      return ''
    }

    const stdout = output.stdout.trim()
    if (stdout.includes('\n')) {
      return ''
    }

    return stdout
  }

  async tryReset(): Promise<boolean> {
    const output = await this.execGit(['reset', '--hard', 'HEAD'], true)
    return output.exitCode === 0
  }

  static async createCommandManager(
    workingDirectory: string,
    lfs: boolean
  ): Promise<GitCommandManager> {
    const result = new GitCommandManager()
    await result.initializeCommandManager(workingDirectory, lfs)
    return result
  }

  private async execGit(
    arguments_: string[],
    allowAllExitCodes = false,
    silent = false,
    customListeners = {}
  ): Promise<GitOutput> {
    fsHelper.directoryExistsSync(this.workingDirectory, true)

    const result = new GitOutput()

    const environment: GitEnvironment = {}
    for (const key of Object.keys(process.env)) {
      environment[key] = process.env[key] || ''
    }
    for (const key of Object.keys(this.gitEnv)) {
      environment[key] = this.gitEnv[key]
    }

    const defaultListener = {
      stdout: (data: Buffer) => {
        stdout.push(data.toString())
      },
    }

    const mergedListeners = { ...defaultListener, ...customListeners }

    const stdout: string[] = []
    const options = {
      cwd: this.workingDirectory,
      env: environment,
      silent,
      ignoreReturnCode: allowAllExitCodes,
      listeners: mergedListeners,
    }

    result.exitCode = await exec.exec(`"${this.gitPath}"`, arguments_, options)
    result.stdout = stdout.join('')

    logger.debug(result.exitCode.toString())
    logger.debug(result.stdout)

    return result
  }

  private async initializeCommandManager(
    workingDirectory: string,
    lfs: boolean
  ): Promise<void> {
    this.workingDirectory = workingDirectory

    // Git-lfs will try to pull down assets if any of the local/user/system setting exist.
    // If the user didn't enable `LFS` in their pipeline definition, disable LFS fetch/checkout.
    this.lfs = lfs
    if (!this.lfs) {
      this.gitEnv['GIT_LFS_SKIP_SMUDGE'] = '1'
    }

    this.gitPath = await fsHelper.which('git', true)

    // Git version
    logger.debug('Getting git version')
    let gitVersion = new GitVersion()
    let gitOutput = await this.execGit(['version'])
    let stdout = gitOutput.stdout.trim()
    if (!stdout.includes('\n')) {
      const match = stdout.match(/\d+\.\d+(\.\d+)?/)
      if (match) {
        gitVersion = new GitVersion(match[0])
      }
    }
    if (!gitVersion.isValid()) {
      throw new Error('Unable to determine git version')
    }

    // Minimum git version
    if (!gitVersion.checkMinimum(MinimumGitVersion)) {
      throw new Error(
        `Minimum required git version is ${MinimumGitVersion}. Your git ('${this.gitPath}') is ${gitVersion}`
      )
    }

    if (this.lfs) {
      // Git-lfs version
      logger.debug('Getting git-lfs version')
      let gitLfsVersion = new GitVersion()
      const gitLfsPath = await fsHelper.which('git-lfs', true)
      gitOutput = await this.execGit(['lfs', 'version'])
      stdout = gitOutput.stdout.trim()
      if (!stdout.includes('\n')) {
        const match = stdout.match(/\d+\.\d+(\.\d+)?/)
        if (match) {
          gitLfsVersion = new GitVersion(match[0])
        }
      }
      if (!gitLfsVersion.isValid()) {
        throw new Error('Unable to determine git-lfs version')
      }

      // Minimum git-lfs version
      // Note:
      // - Auth header not supported before 2.1
      const minimumGitLfsVersion = new GitVersion('2.1')
      if (!gitLfsVersion.checkMinimum(minimumGitLfsVersion)) {
        throw new Error(
          `Minimum required git-lfs version is ${minimumGitLfsVersion}. Your git-lfs ('${gitLfsPath}') is ${gitLfsVersion}`
        )
      }
    }

    // Set the user agent
    const gitHttpUserAgent = `git/${gitVersion} (${packageJson.name})`
    logger.debug(`Set git useragent to: ${gitHttpUserAgent}`)
    this.gitEnv['GIT_HTTP_USER_AGENT'] = gitHttpUserAgent
  }
}

class GitOutput {
  stdout = ''
  exitCode = 0
}
