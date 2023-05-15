import type { Level } from 'pino'
import { z, type ZodFormattedError } from 'zod'

const logLevels: z.ZodType<Level> = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
])

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .default('development'),
  PORT: z.preprocess(Number, z.number()).optional().default(3210),
  LOG_LEVEL: logLevels.optional().default('info'),
  LOG_DIR: z.string().optional().default('.logs'),
  NO_COLOR: z.boolean().optional().default(false),
  REDIS_HOST: z.string().optional().default('localhost'),
  REDIS_PORT: z.number().optional().default(6379),
  // REDIS_PASS: z.string(),
  GRADIO_PORT: z.number().optional().default(7860),
  INITIAL_GRADIO_PORT: z.preprocess(Number, z.number()),
  CADDYFILE_PATH: z.string(),
  AGENTSWAP_URL: z.string().url(),
  WORKER_TOKEN: z.string(),
  BASE_HOSTNAME: z.string(),
})

export const formatErrors = (
  errors: ZodFormattedError<Map<string, string>, string>
) =>
  Object.entries(errors)
    .map(([name, value]) => {
      if (value && '_errors' in value) {
        return `${name}: ${value._errors.join(', ')}\n`
      }
      return
    })
    .filter(Boolean)
