import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'

import * as GitHub from '@actions/github'
import { v4 as uuid } from '@napi-rs/uuid'

import { IS_WINDOWS } from '../env/index.ts'
import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'
import * as toolCache from '../utils/tool-cache.ts'
import * as retryHelper from './retry-helper.ts'
import { getServerApiUrl } from './url-helper.ts'

export async function downloadRepository(
  authToken: string,
  owner: string,
  repo: string,
  reference: string,
  commit: string,
  repositoryPath: string,
  baseUrl?: string
): Promise<void> {
  // Determine the default branch
  if (!reference && !commit) {
    logger.info('Determining the default branch')
    reference = await getDefaultBranch(authToken, owner, repo, baseUrl)
  }

  // Download the archive
  let archiveData = await retryHelper.execute(async () => {
    logger.info('Downloading the archive')
    return await downloadArchive(
      authToken,
      owner,
      repo,
      reference,
      commit,
      baseUrl
    )
  })

  // Write archive to disk
  logger.info('Writing archive to disk')
  const uniqueId = uuid()
  const archivePath = path.join(repositoryPath, `${uniqueId}.tar.gz`)
  await fs.promises.writeFile(archivePath, archiveData)
  archiveData = Buffer.from('') // Free memory

  // Extract archive
  logger.info('Extracting the archive')
  const extractPath = path.join(repositoryPath, uniqueId)
  await fsHelper.mkdirP(extractPath)
  await (IS_WINDOWS
    ? toolCache.extractZip(archivePath, extractPath)
    : toolCache.extractTar(archivePath, extractPath))
  await fsHelper.rmRF(archivePath)

  // Determine the path of the repository content. The archive contains
  // a top-level folder and the repository content is inside.
  const archiveFileNames = await fs.promises.readdir(extractPath)
  assert.ok(
    archiveFileNames.length == 1,
    'Expected exactly one directory inside archive'
  )
  const archiveVersion = archiveFileNames[0] // The top-level folder name includes the short SHA
  logger.info(`Resolved version ${archiveVersion}`)
  const temporaryRepositoryPath = path.join(extractPath, archiveVersion)

  // Move the files
  for (const fileName of await fs.promises.readdir(temporaryRepositoryPath)) {
    const sourcePath = path.join(temporaryRepositoryPath, fileName)
    const targetPath = path.join(repositoryPath, fileName)
    await (IS_WINDOWS
      ? fsHelper.cp(sourcePath, targetPath, { recursive: true }) // Copy on Windows (Windows Defender may have a lock)
      : fsHelper.mv(sourcePath, targetPath))
  }
  await fsHelper.rmRF(extractPath)
}

/**
 * Looks up the default branch name
 */
export async function getDefaultBranch(
  authToken: string,
  owner: string,
  repo: string,
  baseUrl?: string
): Promise<string> {
  return await retryHelper.execute(async () => {
    logger.info('Retrieving the default branch name')
    const octokit = GitHub.getOctokit(authToken, {
      baseUrl: getServerApiUrl(baseUrl),
    })
    let result: string
    try {
      // Get the default branch from the repo info
      const response = await octokit.rest.repos.get({ owner, repo })
      result = response.data.default_branch
      assert.ok(result, 'default_branch cannot be empty')
    } catch (error) {
      // Handle .wiki repo
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 404 &&
        repo.toUpperCase().endsWith('.WIKI')
      ) {
        result = 'master'
      }
      // Otherwise error
      else {
        throw error
      }
    }

    // Print the default branch
    logger.info(`Default branch '${result}'`)

    // Prefix with 'refs/heads'
    if (!result.startsWith('refs/')) {
      result = `refs/heads/${result}`
    }

    return result
  })
}

async function downloadArchive(
  authToken: string,
  owner: string,
  repo: string,
  reference: string,
  commit: string,
  baseUrl?: string
): Promise<Buffer> {
  const octokit = GitHub.getOctokit(authToken, {
    baseUrl: getServerApiUrl(baseUrl),
  })
  const download = IS_WINDOWS
    ? octokit.rest.repos.downloadZipballArchive
    : octokit.rest.repos.downloadTarballArchive
  const response = await download({
    owner: owner,
    repo: repo,
    ref: commit || reference,
  })
  return Buffer.from(response.data as ArrayBuffer) // response.data is ArrayBuffer
}
