import { createServer, type RequestListener } from 'node:http'

import { createApp, toNodeListener } from 'h3'

import { environment } from './env/index.ts'
import { httpLogger, logger } from './logger/index.ts'
import { router } from './routes/index.ts'

const app = createApp()
app.use(router)

const appListener = toNodeListener(app)
const serverListener: RequestListener = (request, response) => {
  httpLogger(request, response)
  appListener(request, response)
}

const server = createServer(serverListener)
const port = environment.PORT
server.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}/`)
})
