import http from 'node:http'

import dotenv from 'dotenv'

import { environment } from './env/index.ts'
import { logger } from './logger/index.ts'

dotenv.config()

const server = http.createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('Hello World\n')
})

const port = environment.PORT

server.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}/`)
})
