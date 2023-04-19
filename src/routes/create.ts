import url from 'node:url'

import type { FastifyInstance } from 'fastify'

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
    if (!id) {
      const error = new Error('Missing required parameter: id')
      reply.code(400).send(error)
      return
    }
    if (!url) {
      const error = new Error('Missing required parameter: url')
      reply.code(400).send(error)
      return
    }
    const port = Number(id) + 3000 // TODO: change initial port
    const { repositoryOwner, repositoryName } = extractRepoInfo(url)
    await deployGradio({ port, repositoryOwner, repositoryName })
    return JSON.stringify({ ...request.body, repositoryOwner, repositoryName })
  })
}

type RepoInfo = {
  repositoryOwner: string
  repositoryName: string
}

function extractRepoInfo(githubUrl: string): RepoInfo {
  const parsedUrl = new url.URL(githubUrl)
  const pathnameParts = parsedUrl.pathname.split('/')
  const repositoryOwner = pathnameParts[1]
  const repoName = pathnameParts[2]
  const repositoryName = repoName.replace(/\.git$/, '')
  return { repositoryOwner, repositoryName }
}

export default routes
