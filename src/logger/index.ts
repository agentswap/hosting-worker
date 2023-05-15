import path from 'node:path'

import type { TransportTargetOptions } from 'pino'
import { type Options, pinoHttp } from 'pino-http'

import { environment, IS_DEV } from '../env/index.ts'
import { packageJson } from '../utils/package-json.ts'

function initialLogger() {
  const directoryName = environment.LOG_DIR
  const logDirectory = path.join(process.cwd(), directoryName)
  const level = environment.LOG_LEVEL

  const targets: TransportTargetOptions[] = [
    // Log file target
    {
      target: 'pino/file',
      level,
      options: {
        destination: path.join(logDirectory, `${level}.log`),
        mkdir: true,
      },
    },
  ]

  // If LOG_LEVEL is not error, add error log file target
  if (level !== 'error') {
    targets.push({
      target: 'pino/file',
      level: 'error',
      options: {
        destination: path.join(logDirectory, 'error.log'),
        mkdir: true,
      },
    })
  }

  // If IS_DEV is true, add pino-pretty target
  if (IS_DEV) {
    targets.push({
      target: 'pino-pretty',
      level,
      options: { destination: 1 },
    })
  }

  const options: Options = {
    name: packageJson.name,
    level,
    transport: { targets },
  }

  const httpLogger = pinoHttp(options)
  const logger = httpLogger.logger

  return { httpLogger, logger }
}

const { httpLogger, logger } = initialLogger()

export { httpLogger, logger }
