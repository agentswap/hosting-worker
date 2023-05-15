import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'
import type { IGitCommandManager } from './git-command-manager.ts'

export async function prepareExistingDirectory(
  git: IGitCommandManager | undefined,
  repositoryPath: string,
  repositoryUrl: string,
  clean: boolean,
  reference: string
): Promise<void> {
  assert.ok(repositoryPath, 'Expected repositoryPath to be defined')
  assert.ok(repositoryUrl, 'Expected repositoryUrl to be defined')

  // Indicates whether to delete the directory contents
  let remove = false

  // Check whether using git or REST API
  if (!git) {
    remove = true
  }
  // Fetch URL does not match
  else if (
    !fsHelper.directoryExistsSync(path.join(repositoryPath, '.git')) ||
    repositoryUrl !== (await git.tryGetFetchUrl())
  ) {
    remove = true
  } else {
    // Delete any index.lock and shallow.lock left by a previously canceled run or crashed git process
    const lockPaths = [
      path.join(repositoryPath, '.git', 'index.lock'),
      path.join(repositoryPath, '.git', 'shallow.lock'),
    ]
    for (const lockPath of lockPaths) {
      try {
        await fsHelper.rmRF(lockPath)
      } catch (error) {
        if (fsHelper.isErrorObject(error) && error.message) {
          logger.debug(`Unable to delete '${lockPath}'. ${error.message}`)
        }
        logger.debug(`Unable to delete '${lockPath}'. ${error}`)
      }
    }

    try {
      logger.info('Removing previously created refs, to avoid conflicts')
      // Checkout detached HEAD
      if (!(await git.isDetached())) {
        await git.checkoutDetach()
      }

      // Remove all refs/heads/*
      let branches = await git.branchList(false)
      for (const branch of branches) {
        await git.branchDelete(false, branch)
      }

      // Remove any conflicting refs/remotes/origin/*
      // Example 1: Consider ref is refs/heads/foo and previously fetched refs/remotes/origin/foo/bar
      // Example 2: Consider ref is refs/heads/foo/bar and previously fetched refs/remotes/origin/foo
      if (reference) {
        reference = reference.startsWith('refs/')
          ? reference
          : `refs/heads/${reference}`
        if (reference.startsWith('refs/heads/')) {
          const upperName1 = reference.toUpperCase().slice('REFS/HEADS/'.length)
          const upperName1Slash = `${upperName1}/`
          branches = await git.branchList(true)
          for (const branch of branches) {
            const upperName2 = branch.slice('origin/'.length).toUpperCase()
            const upperName2Slash = `${upperName2}/`
            if (
              upperName1.startsWith(upperName2Slash) ||
              upperName2.startsWith(upperName1Slash)
            ) {
              await git.branchDelete(true, branch)
            }
          }
        }
      }

      // Check for submodules and delete any existing files if submodules are present
      if (!(await git.submoduleStatus())) {
        remove = true
        logger.info('Bad Submodules found, removing existing files')
      }

      // Clean
      if (clean) {
        logger.info('Cleaning the repository')
        if (!(await git.tryClean())) {
          logger.debug(
            `The clean command failed. This might be caused by: 1) path too long, 2) permission issue, or 3) file in use. For further investigation, manually run 'git clean -ffdx' on the directory '${repositoryPath}'.`
          )
          remove = true
        } else if (!(await git.tryReset())) {
          remove = true
        }

        if (remove) {
          logger.warn(
            `Unable to clean or reset the repository. The repository will be recreated instead.`
          )
        }
      }
    } catch {
      logger.warn(
        `Unable to prepare the existing repository. The repository will be recreated instead.`
      )
      remove = true
    }
  }

  if (remove) {
    // Delete the contents of the directory. Don't delete the directory itself
    // since it might be the current working directory.
    logger.info(`Deleting the contents of '${repositoryPath}'`)
    for (const file of await fs.promises.readdir(repositoryPath)) {
      await fsHelper.rmRF(path.join(repositoryPath, file))
    }
  }
}
