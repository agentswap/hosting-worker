import fs from 'node:fs'
import path from 'node:path'

import pc from 'picocolors'
import winston from 'winston'
import LokiTransport from 'winston-loki'

import { environment, isDevelopment } from '../env/index.ts'
import { packageJson } from '../utils/package-json.ts'
import { logLevels } from './constants.ts'

export type LoggerServiceOptions<
  T extends Record<string, unknown> = Record<string, unknown>
> = {
  appName: string
  lokiUrl?: string
  metadata?: T
}

class LoggerService {
  public constructor(private readonly options: LoggerServiceOptions) {
    const { appName, lokiUrl, metadata } = this.options

    const directoryName = environment.LOG_DIR
    const logDirectory = path.join(process.cwd(), directoryName)
    if (!fs.existsSync(logDirectory)) {
      fs.mkdirSync(logDirectory, { recursive: true })
      console.log(`Log directory created at ${logDirectory}.`)
    }

    const level = this.makeLevel(environment.LOG_LEVEL)
    const noColor = environment.NO_COLOR
    const enableLoki = !!lokiUrl

    const commonOptions: winston.transport.TransportStreamOptions = {
      handleExceptions: true,
      handleRejections: true,
    }

    const defaultWinstonFormat = winston.format.combine(
      winston.format.label({ label: appName }),
      winston.format.timestamp({ format: 'MM/DD/YYYY, hh:mm:ss A' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.ms()
    )

    const errorConsoleFormat = winston.format.printf((info) => {
      const { metadata, label, timestamp, level, message } = info
      const host = metadata?.host ? `:${metadata.host}` : ''
      const pid = metadata?.runtime?.pid || 'null'
      const context = metadata?.context
      return `${pc.green(
        `[${label}${host}] ${pid} -`
      )} ${timestamp}     ${level} ${pc.yellow(`[${context}]`)} ${message}`
    })

    const debugConsoleFormat = winston.format.printf((info) => {
      const { metadata, label, timestamp, level, message } = info
      const host = metadata?.host ? `:${metadata.host}` : ''
      const pid = metadata?.runtime?.pid || 'null'
      const context = metadata?.context
      const ms = metadata?.ms || ''
      const stack = metadata?.stack
      return `${pc.green(
        `[${label}${host}] ${pid} -`
      )} ${timestamp}     ${level} ${pc.yellow(
        `[${context}]`
      )} ${message} ${pc.yellow(`${ms}`)}${stack ? pc.red(`\n${stack}`) : ''}`
    })

    const transports: winston.transport[] = [
      new winston.transports.File({
        level,
        filename: `${logDirectory}/${level}.log`,
        format: winston.format.combine(winston.format.json()),
      }),
      new winston.transports.File({
        ...commonOptions,
        level: 'error',
        filename: `${logDirectory}/error.log`,
        format: winston.format.combine(winston.format.json()),
      }),
      new winston.transports.Console({
        ...commonOptions,
        level: 'error',
        format: winston.format.combine(
          winston.format.colorize({ all: !noColor }),
          winston.format.metadata({
            fillExcept: ['label', 'timestamp', 'level', 'message'],
          }),
          errorConsoleFormat
        ),
      }),
    ]

    if (enableLoki) {
      transports.push(
        new LokiTransport({
          ...commonOptions,
          level,
          json: true,
          labels: { job: appName },
          format: winston.format.combine(
            winston.format.timestamp({ format: 'isoDateTime' }),
            winston.format.json()
          ),
          host: lokiUrl,
          replaceTimestamp: true,
        })
      )
    }

    if (isDevelopment) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ all: !noColor }),
            winston.format.metadata({
              fillExcept: ['label', 'timestamp', 'level', 'message'],
            }),
            debugConsoleFormat
          ),
        })
      )
    }

    const _logger = winston.createLogger({
      levels: winston.config.npm.levels,
      level,
      format: defaultWinstonFormat,
      defaultMeta: {
        runtime: {
          pid: process.pid,
          platform: process.platform,
          node: process.versions.node,
          v8: process.versions.v8,
        },
        context: 'main',
        ...metadata,
      },
      transports,
      exitOnError: true,
    })

    this.logger = _logger
  }

  public readonly logger: winston.Logger

  private makeLevel(level?: string): string {
    if (isDevelopment) {
      return 'debug'
    }

    if (level && logLevels.includes(level as (typeof logLevels)[number])) {
      return level
    }

    return 'info'
  }
}

const options: LoggerServiceOptions = {
  appName: packageJson.name,
  lokiUrl: environment.LOKI_URL,
  metadata: { version: packageJson.version },
}

const service = new LoggerService(options)

export const logger = service.logger
