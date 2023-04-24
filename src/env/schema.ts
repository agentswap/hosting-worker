import { z, type ZodFormattedError } from 'zod'

import { logLevels } from '../logger/constants.ts'

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .default('development'),
  PORT: z.preprocess(Number, z.number()).optional().default(3210),
  LOG_LEVEL: z.enum(logLevels).optional(),
  LOG_DIR: z.string().optional().default('.logs'),
  NO_COLOR: z.boolean().optional().default(false),
  LOKI_URL: z.string().url().optional(),
  REDIS_HOST: z.string().optional().default('localhost'),
  REDIS_PORT: z.number().optional().default(6379),
  // REDIS_PASS: z.string(),
  GRADIO_PORT: z.number().optional().default(7860),
  INITIAL_GRADIO_PORT: z.preprocess(Number, z.number()),
  CADDYFILE_PATH: z.string(),
  AGENTSWAP_URL: z.string().url(),
  WORKER_TOKEN: z.string(),
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
