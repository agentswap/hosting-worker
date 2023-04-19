import Fastify from 'fastify'

import { environment } from './env/index.ts'

const app = Fastify({ logger: true })

const run = async () => {
  await app.register(import('./routes/create.ts'))

  const port = environment.PORT
  await app.listen({ port })
}

run()
