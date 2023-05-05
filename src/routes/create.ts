import type { FastifyInstance } from 'fastify'

import { environment } from '../env/index.ts'
import { AgentSwapService } from '../services/agent-swap/index.ts'
import { CaddyService } from '../services/caddy/index.ts'
import { deployGradio } from '../tasks/deploy-gradio.ts'

const initialPort = environment.INITIAL_GRADIO_PORT

const caddyfilePath = environment.CADDYFILE_PATH
const caddy = new CaddyService({ caddyfilePath })

const agentSwap = new AgentSwapService({
  baseUrl: environment.AGENTSWAP_URL,
  workerToken: environment.WORKER_TOKEN,
})

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

    const port = Number(id) + initialPort

    try {
      const taskResult = await deployGradio({ id, port, url })

      fastify.log.info(`Updating caddyfile for ${id}`)
      await caddy.update(
        `${taskResult.imageName}.${environment.BASE_HOSTNAME}`,
        port
      )
      fastify.log.info(`Reloading caddy`)
      await caddy.reload()

      await agentSwap.reportHostingWorkerState(id, 'Running')

      return JSON.stringify({ id, ...taskResult })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Failed to build docker image')) {
          // Report build error
          fastify.log.info(`Reporting build error status`)
          await agentSwap.reportHostingWorkerState(id, 'BuildError')
        } else if (error.message.includes('Failed to run docker image')) {
          // Report runtime error
          fastify.log.info(`Reporting run error status`)
          await agentSwap.reportHostingWorkerState(id, 'RuntimeError')
        } else {
          // Report unknown error
          fastify.log.info(`Reporting unknown error status`)
          await agentSwap.reportHostingWorkerState(id, 'RuntimeError')
        }
      }

      throw error
    }
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

export default routes
