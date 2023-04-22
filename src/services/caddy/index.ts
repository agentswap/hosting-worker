import * as fsp from 'node:fs/promises'

import { execa } from 'execa'

import { logger } from '../../logger/index.ts'

const createCaddyfileEntity = (
  id: number,
  port: number
) => `handle /app/${id}* {
	reverse_proxy 127.0.0.1:${port}
}\n\n`

type CaddyServiceOptions = {
  caddyfilePath: string
}

export class CaddyService {
  #caddyfilePath: string

  public constructor(options: CaddyServiceOptions) {
    const { caddyfilePath } = options
    this.#caddyfilePath = caddyfilePath
  }

  public async update(id: number, port: number) {
    const entity = createCaddyfileEntity(id, port)
    const oldCaddyfile = await fsp.readFile(this.#caddyfilePath, 'utf8')

    const path = `/app/${id}`

    if (oldCaddyfile.includes(entity)) {
      return
    }

    oldCaddyfile.replace(
      // replace old one if exists
      new RegExp(`handle_path ${path}[\s\S]+?}`, 'g'),
      entity
    )

    const newCaddyfile = oldCaddyfile.includes(`handle_path ${path}`)
      ? oldCaddyfile.replace(
          // replace old one if exists
          new RegExp(`handle_path ${path}[^]+?}`, 'g'),
          entity
        )
      : entity + oldCaddyfile

    logger.debug(`Update caddyfile for id ${id} and port ${port}}`)
    await fsp.writeFile(this.#caddyfilePath, newCaddyfile)
  }

  public async reload() {
    const { exitCode, stderr, stdout } = await execa(
      'sudo systemctl restart caddy',
      {
        reject: false,
        shell: true,
        stdio: 'inherit',
      }
    )
    if (exitCode !== 0) {
      logger.error(`Error reloading caddy: ${stderr}`)
      throw new Error(`Failed to reload caddy`)
    }
    logger.debug(`Caddy reloaded: ${stdout}`)
  }
}
