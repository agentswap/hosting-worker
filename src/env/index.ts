import { environmentSchema, formatErrors } from './schema.ts'

const appEnvironment = environmentSchema.safeParse(process.env)

if (!appEnvironment.success) {
  console.error(
    'Invalid environment variables:\n',
    ...formatErrors(appEnvironment.error.format())
  )
  throw new Error('Invalid environment variables')
}

export const environment = appEnvironment.data

export const IS_DEV = environment.NODE_ENV === 'development'
export const IS_PROD = environment.NODE_ENV === 'production'
export const IS_DEBUG = environment.LOG_LEVEL === 'debug'

export const IS_WINDOWS = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
