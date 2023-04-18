import * as GitHub from '@actions/github'

import { logger } from '../logger/index.ts'
import type { IGitCommandManager } from './git-command-manager.ts'
import { getServerApiUrl, isGhes } from './url-helper.ts'

export const tagsReferenceSpec = '+refs/tags/*:refs/tags/*'

export interface ICheckoutInfo {
  ref: string
  startPoint: string
}

export async function getCheckoutInfo(
  git: IGitCommandManager,
  reference: string,
  commit: string
): Promise<ICheckoutInfo> {
  if (!git) {
    throw new Error('Arg git cannot be empty')
  }

  if (!reference && !commit) {
    throw new Error('Args ref and commit cannot both be empty')
  }

  const result = {} as unknown as ICheckoutInfo
  const upperReference = (reference || '').toUpperCase()

  // SHA only
  if (!reference) {
    result.ref = commit
  }
  // refs/heads/
  else if (upperReference.startsWith('REFS/HEADS/')) {
    const branch = reference.slice('refs/heads/'.length)
    result.ref = branch
    result.startPoint = `refs/remotes/origin/${branch}`
  }
  // refs/pull/
  else if (upperReference.startsWith('REFS/PULL/')) {
    const branch = reference.slice('refs/pull/'.length)
    result.ref = `refs/remotes/pull/${branch}`
  }
  // refs/tags/
  else if (upperReference.startsWith('REFS/')) {
    result.ref = reference
  }
  // Unqualified ref, check for a matching branch or tag
  else {
    if (await git.branchExists(true, `origin/${reference}`)) {
      result.ref = reference
      result.startPoint = `refs/remotes/origin/${reference}`
    } else if (await git.tagExists(`${reference}`)) {
      result.ref = `refs/tags/${reference}`
    } else {
      throw new Error(
        `A branch or tag with the name '${reference}' could not be found`
      )
    }
  }

  return result
}

export function getReferenceSpecForAllHistory(
  reference: string,
  commit: string
): string[] {
  const result = ['+refs/heads/*:refs/remotes/origin/*', tagsReferenceSpec]
  if (reference && reference.toUpperCase().startsWith('REFS/PULL/')) {
    const branch = reference.slice('refs/pull/'.length)
    result.push(`+${commit || reference}:refs/remotes/pull/${branch}`)
  }

  return result
}

export function getReferenceSpec(reference: string, commit: string): string[] {
  if (!reference && !commit) {
    throw new Error('Args ref and commit cannot both be empty')
  }

  const upperReference = (reference || '').toUpperCase()

  // SHA
  if (commit) {
    // refs/heads
    if (upperReference.startsWith('REFS/HEADS/')) {
      const branch = reference.slice('refs/heads/'.length)
      return [`+${commit}:refs/remotes/origin/${branch}`]
    }
    // refs/pull/
    else if (upperReference.startsWith('REFS/PULL/')) {
      const branch = reference.slice('refs/pull/'.length)
      return [`+${commit}:refs/remotes/pull/${branch}`]
    }
    // refs/tags/
    else if (upperReference.startsWith('REFS/TAGS/')) {
      return [`+${commit}:${reference}`]
    }
    // Otherwise no destination ref
    else {
      return [commit]
    }
  }
  // Unqualified ref, check for a matching branch or tag
  else if (!upperReference.startsWith('REFS/')) {
    return [
      `+refs/heads/${reference}*:refs/remotes/origin/${reference}*`,
      `+refs/tags/${reference}*:refs/tags/${reference}*`,
    ]
  }
  // refs/heads/
  else if (upperReference.startsWith('REFS/HEADS/')) {
    const branch = reference.slice('refs/heads/'.length)
    return [`+${reference}:refs/remotes/origin/${branch}`]
  }
  // refs/pull/
  else if (upperReference.startsWith('REFS/PULL/')) {
    const branch = reference.slice('refs/pull/'.length)
    return [`+${reference}:refs/remotes/pull/${branch}`]
  }
  // refs/tags/
  else {
    return [`+${reference}:${reference}`]
  }
}

/**
 * Tests whether the initial fetch created the ref at the expected commit
 */
export async function testReference(
  git: IGitCommandManager,
  reference: string,
  commit: string
): Promise<boolean> {
  if (!git) {
    throw new Error('Arg git cannot be empty')
  }

  if (!reference && !commit) {
    throw new Error('Args ref and commit cannot both be empty')
  }

  // No SHA? Nothing to test
  if (!commit) {
    return true
  }
  // SHA only?
  else if (!reference) {
    return await git.shaExists(commit)
  }

  const upperReference = reference.toUpperCase()

  // refs/heads/
  if (upperReference.startsWith('REFS/HEADS/')) {
    const branch = reference.slice('refs/heads/'.length)
    const branchExists = await git.branchExists(true, `origin/${branch}`)
    const commitSHA = await git.revParse(`refs/remotes/origin/${branch}`)
    return branchExists && commit === commitSHA
  }
  // refs/pull/
  else if (upperReference.startsWith('REFS/PULL/')) {
    // Assume matches because fetched using the commit
    return true
  }
  // refs/tags/
  else if (upperReference.startsWith('REFS/TAGS/')) {
    const tagName = reference.slice('refs/tags/'.length)
    const tagExists = await git.tagExists(tagName)
    const commitSHA = await git.revParse(reference)
    return tagExists && commit === commitSHA
  }
  // Unexpected
  else {
    logger.debug(`Unexpected ref format '${reference}' when testing ref info`)
    return true
  }
}

export async function checkCommitInfo(
  token: string,
  commitInfo: string,
  repositoryOwner: string,
  repositoryName: string,
  reference: string,
  commit: string,
  baseUrl?: string
): Promise<void> {
  try {
    // GHES?
    if (isGhes(baseUrl)) {
      return
    }

    // Auth token?
    if (!token) {
      return
    }

    // Public PR synchronize, for workflow repo?
    if (
      fromPayload('repository.private') !== false ||
      GitHub.context.eventName !== 'pull_request' ||
      fromPayload('action') !== 'synchronize' ||
      repositoryOwner !== GitHub.context.repo.owner ||
      repositoryName !== GitHub.context.repo.repo ||
      reference !== GitHub.context.ref ||
      !reference.startsWith('refs/pull/') ||
      commit !== GitHub.context.sha
    ) {
      return
    }

    // Head SHA
    const expectedHeadSha = fromPayload('after')
    if (!expectedHeadSha) {
      logger.debug('Unable to determine head sha')
      return
    }

    // Base SHA
    const expectedBaseSha = fromPayload('pull_request.base.sha')
    if (!expectedBaseSha) {
      logger.debug('Unable to determine base sha')
      return
    }

    // Expected message?
    const expectedMessage = `Merge ${expectedHeadSha} into ${expectedBaseSha}`
    if (commitInfo.includes(expectedMessage)) {
      return
    }

    // Extract details from message
    const match = commitInfo.match(/Merge ([\da-f]{40}) into ([\da-f]{40})/)
    if (!match) {
      logger.debug('Unexpected message format')
      return
    }

    // Post telemetry
    const actualHeadSha = match[1]
    if (actualHeadSha !== expectedHeadSha) {
      logger.debug(
        `Expected head sha ${expectedHeadSha}; actual head sha ${actualHeadSha}`
      )
      const octokit = GitHub.getOctokit(token, {
        baseUrl: getServerApiUrl(baseUrl),
        userAgent: `actions-checkout-tracepoint/1.0 (code=STALE_MERGE;owner=${repositoryOwner};repo=${repositoryName};pr=${fromPayload(
          'number'
        )};run_id=${
          process.env['GITHUB_RUN_ID']
        };expected_head_sha=${expectedHeadSha};actual_head_sha=${actualHeadSha})`,
      })
      await octokit.rest.repos.get({
        owner: repositoryOwner,
        repo: repositoryName,
      })
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'stack' in error) {
      logger.debug(
        `Error when validating commit info: ${error?.stack ?? error}`
      )
    }
    logger.debug(`Error when validating commit info: ${error}`)
  }
}

function fromPayload(path: string): unknown {
  return select(GitHub.context.payload, path)
}

function select(
  object: Record<string, unknown | Record<string, unknown>>,
  path: string
): unknown {
  if (!object) {
    return undefined
  }

  const index = path.indexOf('.')
  if (index < 0) {
    return object[path]
  }

  const key = path.slice(0, Math.max(0, index))
  return select(object[key] as Record<string, unknown>, path.slice(index + 1))
}
