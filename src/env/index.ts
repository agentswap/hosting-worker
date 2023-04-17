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
export const isDevelopment = environment.NODE_ENV === 'development'
export const isProduction = environment.NODE_ENV === 'production'
