import { Octokit } from 'octokit'

import { logger } from '../../logger/index.ts'

type GitHubServiceOptions = {
  token?: string
}

export class GitHubService {
  #octokit: Octokit

  public constructor(options: GitHubServiceOptions) {
    const { token } = options
    const auth = token ?? ''

    this.#octokit = new Octokit({ auth }) // If no token is provided, it might be rate limited
  }

  public async checkRepoExists(owner: string, repo: string): Promise<boolean> {
    logger.debug(`Checking if repo ${owner}/${repo} exists`)

    try {
      const repoResult = await this.#octokit.rest.repos.get({ owner, repo })

      if (repoResult.status === 200) {
        return true
      }

      throw new Error(
        `Repository ${owner}/${repo} does not exist or is private`
      )
    } catch (error) {
      logger.warn(`Error checking if repo exists: ${error}`)
      throw new Error(
        `Repository ${owner}/${repo} does not exist or is private`
      )
    }
  }
}
