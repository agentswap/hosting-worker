import Queue from 'bull'

import { environment } from '../env/index.ts'

export function createQueue<T = unknown>(name: string) {
  const port = environment.REDIS_PORT
  const host = environment.REDIS_HOST
  // const password = environment.REDIS_PASS
  const password = ''
  return new Queue<T>(name, { redis: { port, host, password } })
}
