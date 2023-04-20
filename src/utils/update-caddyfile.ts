import * as fsp from 'node:fs/promises'

import { environment } from '../env/index.js'

const createCaddyfileEntity = (id: number, port: number) => `
  handle_path /${id}* {
    encode zstd gzip
    reverse_proxy 127.0.0.1:${port}
  }\n\n`

export async function updateCaddyfile(id: number, port: number) {
  const entity = createCaddyfileEntity(id, port)
  const oldCaddyfile = await fsp.readFile(environment.CADDYFILE_PATH, 'utf8')

  if (oldCaddyfile.includes(entity)) {
    return
  }

  console.log(
    oldCaddyfile.replace(
      // replace old one if exists
      new RegExp(`handle_path /${id}[\s\S]+?}`, 'g'),
      entity
    )
  )

  const newCaddyfile = oldCaddyfile.includes(`handle_path /${id}`)
    ? oldCaddyfile.replace(
        // replace old one if exists
        new RegExp(`handle_path /${id}[^]+?}`, 'g'),
        entity
      )
    : oldCaddyfile.replace(/(?<={\n)/, entity)
  await fsp.writeFile(environment.CADDYFILE_PATH, newCaddyfile)
}
