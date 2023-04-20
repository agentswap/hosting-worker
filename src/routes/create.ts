import url from 'node:url'

import type { FastifyInstance } from 'fastify'
import { Octokit } from 'octokit'

import { deployGradio } from '../tasks/deploy-gradio.ts'

export interface IModelApp {
  id: number
  url: string
  name: string
}

type CreatePost = {
  Body: IModelApp
}

async function routes(fastify: FastifyInstance) {
  fastify.post<CreatePost>('/create', async (request, reply) => {
    const { id, url } = request.body
    if (!id || !Number.isInteger(id)) {
      const error = new Error('Invalid parameter: id')
      reply.code(400).send(error)
      return
    }
    if (!url || typeof url !== 'string' || !isValidUrl(url)) {
      const error = new Error('Invalid parameter: url')
      reply.code(400).send(error)
      return
    }

    fastify.log.info(`Creating model app ${id} from ${url}`)

    const { repositoryOwner, repositoryName } = extractRepoInfo(url)
    const isRepoExists = await isGitHubRepoExists(
      repositoryOwner,
      repositoryName
    )
    if (!isRepoExists) {
      throw new Error(
        `Repository ${repositoryOwner}/${repositoryName} does not exist or is private`
      )
    }
    const port = Number(id) + 3000 // TODO: change initial port

    const taskResult = await deployGradio({
      port,
      repositoryOwner,
      repositoryName,
    })

    return JSON.stringify(taskResult)
  })
}

function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString)
    return true
  } catch {
    return false
  }
}

type RepoInfo = {
  repositoryOwner: string
  repositoryName: string
}

function extractRepoInfo(githubUrl: string): RepoInfo {
  const match = githubUrl.match(/github\.com\/(.*)\/(.*)/)
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${githubUrl}`)
  }
  const parsedUrl = new url.URL(githubUrl)
  const pathnameParts = parsedUrl.pathname.split('/')
  const repositoryOwner = pathnameParts[1]
  const repoName = pathnameParts[2]
  const repositoryName = repoName.replace(/\.git$/, '')
  return { repositoryOwner, repositoryName }
}

async function isGitHubRepoExists(
  owner: string,
  repo: string
): Promise<boolean> {
  const octokit = new Octokit({ auth: '' }) // If no token is provided, it might be rate limited

  try {
    const repoResult = await octokit.rest.repos.get({ owner, repo })

    if (repoResult.status === 200) {
      return true
    }

    return false
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 404
    ) {
      throw new Error(
        `Repository ${owner}/${repo} does not exist or is private`
      )
    }

    throw new Error(`Error while checking if repository exists: ${error}`)
  }
}

export default routes
