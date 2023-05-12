import { defineEventHandler } from 'h3'
import { useValidatedBody } from 'h3-zod'
import { z } from 'zod'

import type { DeployGradioTaskResult } from '../tasks/deploy-gradio.ts'

export type ModelAppResult = DeployGradioTaskResult & {
  id: number
}

const bodySchema = z.object({
  id: z.number(),
  url: z.string().url(),
  name: z.string(),
})

export default defineEventHandler<ModelAppResult>(async (event) => {
  const body = await useValidatedBody(event, bodySchema)
  const { id } = body
  return { id, port: 1, imageName: 'test' }
})
