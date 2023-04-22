import * as path from 'node:path'

import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'
import * as stateHelper from '../utils/state-helper.ts'
import * as gitAuthHelper from './git-auth-helper.ts'
import type { IGitCommandManager } from './git-command-manager.ts'
import * as gitCommandManager from './git-command-manager.ts'
import * as gitDirectoryHelper from './git-directory-helper.ts'
import type { IGitSourceSettings } from './git-source-settings.ts'
import * as githubApiHelper from './github-api-helper.ts'
import * as referenceHelper from './reference-helper.ts'
import * as urlHelper from './url-helper.ts'

export async function getSource(settings: IGitSourceSettings): Promise<void> {
  // Repository URL
  logger.info(
    `Syncing repository: ${settings.repositoryOwner}/${settings.repositoryName}`
  )
  const repositoryUrl = urlHelper.getFetchUrl(settings)

  // Remove conflicting file path
  if (fsHelper.fileExistsSync(settings.repositoryPath)) {
    await fsHelper.rmRF(settings.repositoryPath)
  }

  // Create directory
  const isExisting = fsHelper.directoryExistsSync(settings.repositoryPath)
  if (!isExisting) {
    await fsHelper.mkdirP(settings.repositoryPath)
  }

  // Git command manager
  logger.info('Getting Git version info')
  const git = await getGitCommandManager(settings)

  let authHelper: gitAuthHelper.IGitAuthHelper | undefined
  try {
    if (git) {
      authHelper = gitAuthHelper.createAuthHelper(git, settings)
      if (settings.setSafeDirectory) {
        // Setup the repository path as a safe directory, so if we pass this into a container job with a different user it doesn't fail
        // Otherwise all git commands we run in a container fail
        await authHelper.configureTempGlobalConfig()
        logger.info(
          `Adding repository directory to the temporary git global config as a safe directory`
        )

        await git
          .config('safe.directory', settings.repositoryPath, true, true)
          .catch((error) => {
            logger.info(
              `Failed to initialize safe directory with error: ${error}`
            )
          })

        stateHelper.setSafeDirectory()
      }
    }

    // Prepare existing directory, otherwise recreate
    if (isExisting) {
      await gitDirectoryHelper.prepareExistingDirectory(
        git,
        settings.repositoryPath,
        repositoryUrl,
        settings.clean,
        settings.ref
      )
    }

    if (!git) {
      // Downloading using REST API
      logger.info(`The repository will be downloaded using the GitHub REST API`)
      logger.info(
        `To create a local Git repository instead, add Git ${gitCommandManager.MinimumGitVersion} or higher to the PATH`
      )
      if (settings.submodules) {
        throw new Error(
          `Input 'submodules' not supported when falling back to download using the GitHub REST API. To create a local Git repository instead, add Git ${gitCommandManager.MinimumGitVersion} or higher to the PATH.`
        )
      } else if (settings.sshKey) {
        throw new Error(
          `Input 'ssh-key' not supported when falling back to download using the GitHub REST API. To create a local Git repository instead, add Git ${gitCommandManager.MinimumGitVersion} or higher to the PATH.`
        )
      }

      await githubApiHelper.downloadRepository(
        settings.authToken,
        settings.repositoryOwner,
        settings.repositoryName,
        settings.ref,
        settings.commit,
        settings.repositoryPath,
        settings.githubServerUrl
      )
      return
    }

    // Save state for POST action
    stateHelper.setRepositoryPath(settings.repositoryPath)

    // Initialize the repository
    if (
      !fsHelper.directoryExistsSync(path.join(settings.repositoryPath, '.git'))
    ) {
      logger.info('Initializing the repository')
      await git.init()
      await git.remoteAdd('origin', repositoryUrl)
    }

    // Disable automatic garbage collection
    logger.info('Disabling automatic garbage collection')
    if (!(await git.tryDisableAutomaticGarbageCollection())) {
      logger.warning(
        `Unable to turn off git automatic garbage collection. The git fetch operation may trigger garbage collection and cause a delay.`
      )
    }

    // If we didn't initialize it above, do it now
    if (!authHelper) {
      authHelper = gitAuthHelper.createAuthHelper(git, settings)
    }
    // Configure auth
    logger.info('Setting up auth')
    await authHelper.configureAuth()

    // Determine the default branch
    if (!settings.ref && !settings.commit) {
      logger.info('Determining the default branch')
      settings.ref = await (settings.sshKey
        ? git.getDefaultBranch(repositoryUrl)
        : githubApiHelper.getDefaultBranch(
            settings.authToken,
            settings.repositoryOwner,
            settings.repositoryName,
            settings.githubServerUrl
          ))
    }

    // LFS install
    if (settings.lfs) {
      await git.lfsInstall()
    }

    // Fetch
    logger.info('Fetching the repository')
    if (settings.fetchDepth <= 0) {
      // Fetch all branches and tags
      let referenceSpec = referenceHelper.getReferenceSpecForAllHistory(
        settings.ref,
        settings.commit
      )
      await git.fetch(referenceSpec)

      // When all history is fetched, the ref we're interested in may have moved to a different
      // commit (push or force push). If so, fetch again with a targeted refspec.
      if (
        !(await referenceHelper.testReference(
          git,
          settings.ref,
          settings.commit
        ))
      ) {
        referenceSpec = referenceHelper.getReferenceSpec(
          settings.ref,
          settings.commit
        )
        await git.fetch(referenceSpec)
      }
    } else {
      const referenceSpec = referenceHelper.getReferenceSpec(
        settings.ref,
        settings.commit
      )
      await git.fetch(referenceSpec, settings.fetchDepth)
    }

    // Checkout info
    logger.info('Determining the checkout info')
    const checkoutInfo = await referenceHelper.getCheckoutInfo(
      git,
      settings.ref,
      settings.commit
    )

    // LFS fetch
    // Explicit lfs-fetch to avoid slow checkout (fetches one lfs object at a time).
    // Explicit lfs fetch will fetch lfs objects in parallel.
    if (settings.lfs) {
      logger.info('Fetching LFS objects')
      await git.lfsFetch(checkoutInfo.startPoint || checkoutInfo.ref)
    }

    // Checkout
    logger.info('Checking out the ref')
    await git.checkout(checkoutInfo.ref, checkoutInfo.startPoint)

    // Submodules
    if (settings.submodules) {
      // Temporarily override global config
      logger.info('Setting up auth for fetching submodules')
      await authHelper.configureGlobalAuth()

      // Checkout submodules
      logger.info('Fetching submodules')
      await git.submoduleSync(settings.nestedSubmodules)
      await git.submoduleUpdate(settings.fetchDepth, settings.nestedSubmodules)
      await git.submoduleForeach(
        'git config --local gc.auto 0',
        settings.nestedSubmodules
      )

      // Persist credentials
      if (settings.persistCredentials) {
        logger.info('Persisting credentials for submodules')
        await authHelper.configureSubmoduleAuth()
      }
    }

    // Get commit information
    const commitInfo = await git.log1()

    // Log commit sha
    await git.log1("--format='%H'")

    // Check for incorrect pull request merge commit
    await referenceHelper.checkCommitInfo(
      settings.authToken,
      commitInfo,
      settings.repositoryOwner,
      settings.repositoryName,
      settings.ref,
      settings.commit,
      settings.githubServerUrl
    )
  } finally {
    // Remove auth
    if (authHelper) {
      if (!settings.persistCredentials) {
        logger.info('Removing auth')
        await authHelper.removeAuth()
      }
      authHelper.removeGlobalConfig()
    }
  }
}

export async function cleanup(repositoryPath: string): Promise<void> {
  // Repo exists?
  if (
    !repositoryPath ||
    !fsHelper.fileExistsSync(path.join(repositoryPath, '.git', 'config'))
  ) {
    return
  }

  let git: IGitCommandManager
  try {
    git = await gitCommandManager.createCommandManager(repositoryPath, false)
  } catch {
    return
  }

  // Remove auth
  const authHelper = gitAuthHelper.createAuthHelper(git)
  try {
    if (stateHelper.PostSetSafeDirectory) {
      // Setup the repository path as a safe directory, so if we pass this into a container job with a different user it doesn't fail
      // Otherwise all git commands we run in a container fail
      await authHelper.configureTempGlobalConfig()
      logger.info(
        `Adding repository directory to the temporary git global config as a safe directory`
      )

      await git
        .config('safe.directory', repositoryPath, true, true)
        .catch((error) => {
          logger.info(
            `Failed to initialize safe directory with error: ${error}`
          )
        })
    }

    await authHelper.removeAuth()
  } finally {
    await authHelper.removeGlobalConfig()
  }
}

async function getGitCommandManager(
  settings: IGitSourceSettings
): Promise<IGitCommandManager | undefined> {
  logger.info(`Working directory is '${settings.repositoryPath}'`)
  try {
    return await gitCommandManager.createCommandManager(
      settings.repositoryPath,
      settings.lfs
    )
  } catch (error) {
    // Git is required for LFS
    if (settings.lfs) {
      throw error
    }

    // Otherwise fallback to REST API
    return undefined
  }
}
