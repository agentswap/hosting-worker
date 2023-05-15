import { createServer, type RequestListener } from 'node:http'

import { createApp, toNodeListener } from 'h3'

import { environment } from './env/index.ts'
import { httpLogger } from './logger/index.ts'
import { router } from './routes/index.ts'

const app = createApp()
app.use(router)

const appListener = toNodeListener(app)
const serverListener: RequestListener = (request, response) => {
  httpLogger(request, response)
  appListener(request, response)
}

const server = createServer(serverListener)
server.listen(environment.PORT)
