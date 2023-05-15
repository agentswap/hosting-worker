import assert from 'node:assert'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as exec from '@actions/exec'
import { v4 as uuid } from '@napi-rs/uuid'

import { IS_WINDOWS } from '../env/index.ts'
import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'
import * as regexpHelper from '../utils/regexp-helper.ts'
// import * as stateHelper from '../utils/state-helper.ts'
import type { IGitCommandManager } from './git-command-manager.ts'
import type { IGitSourceSettings } from './git-source-settings.ts'
import * as urlHelper from './url-helper.ts'

const SSH_COMMAND_KEY = 'core.sshCommand'

export interface IGitAuthHelper {
  configureAuth(): Promise<void>
  configureGlobalAuth(): Promise<void>
  configureSubmoduleAuth(): Promise<void>
  configureTempGlobalConfig(): Promise<string>
  removeAuth(): Promise<void>
  removeGlobalConfig(): Promise<void>
}

export function createAuthHelper(
  git: IGitCommandManager,
  settings?: IGitSourceSettings
): IGitAuthHelper {
  return new GitAuthHelper(git, settings)
}

class GitAuthHelper {
  private readonly git: IGitCommandManager
  private readonly settings: IGitSourceSettings
  private readonly tokenConfigKey: string
  private readonly tokenConfigValue: string
  private readonly tokenPlaceholderConfigValue: string
  private readonly insteadOfKey: string
  private readonly insteadOfValues: string[] = []
  private sshCommand = ''
  private sshKeyPath = ''
  private sshKnownHostsPath = ''
  private temporaryHomePath = ''

  constructor(
    gitCommandManager: IGitCommandManager,
    gitSourceSettings: IGitSourceSettings | undefined
  ) {
    this.git = gitCommandManager
    this.settings = gitSourceSettings || ({} as unknown as IGitSourceSettings)

    // Token auth header
    const serverUrl = urlHelper.getServerUrl(this.settings.githubServerUrl)
    this.tokenConfigKey = `http.${serverUrl.origin}/.extraheader` // "origin" is SCHEME://HOSTNAME[:PORT]
    const basicCredential = Buffer.from(
      `x-access-token:${this.settings.authToken}`,
      'utf8'
    ).toString('base64')
    // core.setSecret(basicCredential)
    this.tokenPlaceholderConfigValue = `AUTHORIZATION: basic ***`
    this.tokenConfigValue = `AUTHORIZATION: basic ${basicCredential}`

    // Instead of SSH URL
    this.insteadOfKey = `url.${serverUrl.origin}/.insteadOf` // "origin" is SCHEME://HOSTNAME[:PORT]
    this.insteadOfValues.push(`git@${serverUrl.hostname}:`)
    if (this.settings.workflowOrganizationId) {
      this.insteadOfValues.push(
        `org-${this.settings.workflowOrganizationId}@github.com:`
      )
    }
  }

  async configureAuth(): Promise<void> {
    // Remove possible previous values
    await this.removeAuth()

    // Configure new values
    await this.configureSsh()
    await this.configureToken()
  }

  async configureTempGlobalConfig(): Promise<string> {
    // Already setup global config
    if (this.temporaryHomePath?.length > 0) {
      return path.join(this.temporaryHomePath, '.gitconfig')
    }
    // Create a temp home directory
    const runnerTemporary = process.env['RUNNER_TEMP'] || '' // TODO: Get from bull-mq
    assert.ok(runnerTemporary, 'RUNNER_TEMP is not defined')
    const uniqueId = uuid()
    this.temporaryHomePath = path.join(runnerTemporary, uniqueId)
    await fsp.mkdir(this.temporaryHomePath, { recursive: true })

    // Copy the global git config
    const gitConfigPath = path.join(os.homedir(), '.gitconfig')
    const newGitConfigPath = path.join(this.temporaryHomePath, '.gitconfig')
    let configExists = false
    try {
      await fsp.stat(gitConfigPath)
      configExists = true
    } catch (error) {
      if (fsHelper.isErrorObject(error) && error.code !== 'ENOENT') {
        throw error
      }
    }
    if (configExists) {
      logger.info(`Copying '${gitConfigPath}' to '${newGitConfigPath}'`)
      await fsHelper.cp(gitConfigPath, newGitConfigPath)
    } else {
      await fsp.writeFile(newGitConfigPath, '')
    }

    // Override HOME
    logger.info(
      `Temporarily overriding HOME='${this.temporaryHomePath}' before making global git config changes`
    )
    this.git.setEnvironmentVariable('HOME', this.temporaryHomePath)

    return newGitConfigPath
  }

  async configureGlobalAuth(): Promise<void> {
    // 'configureTempGlobalConfig' noops if already set, just returns the path
    const newGitConfigPath = await this.configureTempGlobalConfig()
    try {
      // Configure the token
      await this.configureToken(newGitConfigPath, true)

      // Configure HTTPS instead of SSH
      await this.git.tryConfigUnset(this.insteadOfKey, true)
      if (!this.settings.sshKey) {
        for (const insteadOfValue of this.insteadOfValues) {
          await this.git.config(this.insteadOfKey, insteadOfValue, true, true)
        }
      }
    } catch (error) {
      // Unset in case somehow written to the real global config
      logger.info(
        'Encountered an error when attempting to configure token. Attempting unconfigure.'
      )
      await this.git.tryConfigUnset(this.tokenConfigKey, true)
      throw error
    }
  }

  async configureSubmoduleAuth(): Promise<void> {
    // Remove possible previous HTTPS instead of SSH
    await this.removeGitConfig(this.insteadOfKey, true)

    if (this.settings.persistCredentials) {
      // Configure a placeholder value. This approach avoids the credential being captured
      // by process creation audit events, which are commonly logged. For more information,
      // refer to https://docs.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing
      const output = await this.git.submoduleForeach(
        // wrap the pipeline in quotes to make sure it's handled properly by submoduleForeach, rather than just the first part of the pipeline
        `sh -c "git config --local '${this.tokenConfigKey}' '${this.tokenPlaceholderConfigValue}' && git config --local --show-origin --name-only --get-regexp remote.origin.url"`,
        this.settings.nestedSubmodules
      )

      // Replace the placeholder
      const configPaths: string[] =
        output.match(/(?<=(^|\n)file:)[^\t]+(?=\tremote\.origin\.url)/g) || []
      for (const configPath of configPaths) {
        logger.debug(`Replacing token placeholder in '${configPath}'`)
        await this.replaceTokenPlaceholder(configPath)
      }

      if (this.settings.sshKey) {
        // Configure core.sshCommand
        await this.git.submoduleForeach(
          `git config --local '${SSH_COMMAND_KEY}' '${this.sshCommand}'`,
          this.settings.nestedSubmodules
        )
      } else {
        // Configure HTTPS instead of SSH
        for (const insteadOfValue of this.insteadOfValues) {
          await this.git.submoduleForeach(
            `git config --local --add '${this.insteadOfKey}' '${insteadOfValue}'`,
            this.settings.nestedSubmodules
          )
        }
      }
    }
  }

  async removeAuth(): Promise<void> {
    await this.removeSsh()
    await this.removeToken()
  }

  async removeGlobalConfig(): Promise<void> {
    if (this.temporaryHomePath?.length > 0) {
      logger.debug(`Unsetting HOME override`)
      this.git.removeEnvironmentVariable('HOME')
      await fsHelper.rmRF(this.temporaryHomePath)
    }
  }

  private async configureSsh(): Promise<void> {
    if (!this.settings.sshKey) {
      return
    }

    // Write key
    const runnerTemporary = process.env['RUNNER_TEMP'] || ''
    assert.ok(runnerTemporary, 'RUNNER_TEMP is not defined')
    const uniqueId = uuid()
    this.sshKeyPath = path.join(runnerTemporary, uniqueId)
    // stateHelper.setSshKeyPath(this.sshKeyPath)
    await fsp.mkdir(runnerTemporary, { recursive: true })
    await fsp.writeFile(this.sshKeyPath, this.settings.sshKey.trim() + '\n', {
      mode: 0o600,
    })

    // Remove inherited permissions on Windows
    if (IS_WINDOWS) {
      const icacls = await fsHelper.which('icacls.exe')
      await exec.exec(
        `"${icacls}" "${this.sshKeyPath}" /grant:r "${process.env['USERDOMAIN']}\\${process.env['USERNAME']}:F"`
      )
      await exec.exec(`"${icacls}" "${this.sshKeyPath}" /inheritance:r`)
    }

    // Write known hosts
    const userKnownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts')
    let userKnownHosts = ''
    try {
      const userKnownHostsFile = await fsp.readFile(userKnownHostsPath)
      userKnownHosts = userKnownHostsFile.toString()
    } catch (error) {
      if (fsHelper.isErrorObject(error) && error.code !== 'ENOENT') {
        throw error
      }
    }
    let knownHosts = ''
    if (userKnownHosts) {
      knownHosts += `# Begin from ${userKnownHostsPath}\n${userKnownHosts}\n# End from ${userKnownHostsPath}\n`
    }
    if (this.settings.sshKnownHosts) {
      knownHosts += `# Begin from input known hosts\n${this.settings.sshKnownHosts}\n# end from input known hosts\n`
    }
    knownHosts += `# Begin implicitly added github.com\ngithub.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=\n# End implicitly added github.com\n`
    this.sshKnownHostsPath = path.join(
      runnerTemporary,
      `${uniqueId}_known_hosts`
    )
    // stateHelper.setSshKnownHostsPath(this.sshKnownHostsPath)
    await fsp.writeFile(this.sshKnownHostsPath, knownHosts)

    // Configure GIT_SSH_COMMAND
    const sshPath = await fsHelper.which('ssh', true)
    this.sshCommand = `"${sshPath}" -i "$RUNNER_TEMP/${path.basename(
      this.sshKeyPath
    )}"`
    if (this.settings.sshStrict) {
      this.sshCommand += ' -o StrictHostKeyChecking=yes -o CheckHostIP=no'
    }
    this.sshCommand += ` -o "UserKnownHostsFile=$RUNNER_TEMP/${path.basename(
      this.sshKnownHostsPath
    )}"`
    logger.info(`Temporarily overriding GIT_SSH_COMMAND=${this.sshCommand}`)
    this.git.setEnvironmentVariable('GIT_SSH_COMMAND', this.sshCommand)

    // Configure core.sshCommand
    if (this.settings.persistCredentials) {
      await this.git.config(SSH_COMMAND_KEY, this.sshCommand)
    }
  }

  private async configureToken(
    configPath?: string,
    globalConfig?: boolean
  ): Promise<void> {
    // Validate args
    assert.ok(
      (configPath && globalConfig) || (!configPath && !globalConfig),
      'Unexpected configureToken parameter combinations'
    )

    // Default config path
    if (!configPath && !globalConfig) {
      configPath = path.join(this.git.getWorkingDirectory(), '.git', 'config')
    }

    // Configure a placeholder value. This approach avoids the credential being captured
    // by process creation audit events, which are commonly logged. For more information,
    // refer to https://docs.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing
    await this.git.config(
      this.tokenConfigKey,
      this.tokenPlaceholderConfigValue,
      globalConfig
    )

    // Replace the placeholder
    await this.replaceTokenPlaceholder(configPath || '')
  }

  private async replaceTokenPlaceholder(configPath: string): Promise<void> {
    assert.ok(configPath, 'configPath is not defined')
    const configFile = await fsp.readFile(configPath)
    let content = configFile.toString()
    const placeholderIndex = content.indexOf(this.tokenPlaceholderConfigValue)
    if (
      placeholderIndex < 0 ||
      placeholderIndex != content.lastIndexOf(this.tokenPlaceholderConfigValue)
    ) {
      throw new Error(`Unable to replace auth placeholder in ${configPath}`)
    }
    assert.ok(this.tokenConfigValue, 'tokenConfigValue is not defined')
    content = content.replace(
      this.tokenPlaceholderConfigValue,
      this.tokenConfigValue
    )
    await fsp.writeFile(configPath, content)
  }

  private async removeSsh(): Promise<void> {
    // SSH key
    // const keyPath = this.sshKeyPath || stateHelper.SshKeyPath
    const keyPath = this.sshKeyPath

    if (keyPath) {
      try {
        await fsHelper.rmRF(keyPath)
      } catch (error) {
        logger.debug(
          `${
            fsHelper.isErrorObject(error) && error.message
              ? error.message
              : error
          }`
        )
        logger.warn(`Failed to remove SSH key '${keyPath}'`)
      }
    }

    // SSH known hosts
    // const knownHostsPath =
    //   this.sshKnownHostsPath || stateHelper.SshKnownHostsPath
    const knownHostsPath = this.sshKnownHostsPath

    if (knownHostsPath) {
      try {
        await fsHelper.rmRF(knownHostsPath)
      } catch {
        // Intentionally empty
      }
    }

    // SSH command
    await this.removeGitConfig(SSH_COMMAND_KEY)
  }

  private async removeToken(): Promise<void> {
    // HTTP extra header
    await this.removeGitConfig(this.tokenConfigKey)
  }

  private async removeGitConfig(
    configKey: string,
    submoduleOnly = false
  ): Promise<void> {
    if (
      !submoduleOnly &&
      (await this.git.configExists(configKey)) &&
      !(await this.git.tryConfigUnset(configKey))
    ) {
      // Load the config contents
      logger.warn(`Failed to remove '${configKey}' from the git config`)
    }

    const pattern = regexpHelper.escape(configKey)
    await this.git.submoduleForeach(
      // wrap the pipeline in quotes to make sure it's handled properly by submoduleForeach, rather than just the first part of the pipeline
      `sh -c "git config --local --name-only --get-regexp '${pattern}' && git config --local --unset-all '${configKey}' || :"`,
      true
    )
  }
}
