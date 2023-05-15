import * as fsp from 'node:fs/promises'

import { execa } from 'execa'

import { logger } from '../../logger/index.ts'

const createCaddyfileEntity = (host: string, port: number) => `${host} {
	encode zstd gzip
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

  public async update(host: string, port: number) {
    const entity = createCaddyfileEntity(host, port)
    const oldCaddyfile = await fsp.readFile(this.#caddyfilePath, 'utf8')
    const regex = new RegExp(`${host}[^]+?}`, 'g')

    if (oldCaddyfile.includes(entity)) {
      return
    }

    const newCaddyfile = oldCaddyfile.includes(`${host}`)
      ? oldCaddyfile.replace(
          // replace old one if exists
          regex,
          entity
        )
      : entity + oldCaddyfile

    logger.debug(`Update caddyfile for host ${host} and port ${port}}`)
    await fsp.writeFile(this.#caddyfilePath, newCaddyfile)
  }

  public async reload() {
    const { exitCode, stderr, stdout } = await execa(
      'sudo systemctl reload caddy',
      { reject: false, shell: true }
    )
    if (exitCode !== 0) {
      logger.error(`Error reloading caddy: ${stderr}`)
      throw new Error(`Failed to reload caddy`)
    }
    logger.debug(`Caddy reloaded: ${stdout}`)
  }

  public async restart() {
    const { exitCode, stderr, stdout } = await execa(
      'sudo systemctl restart caddy',
      { reject: false, shell: true }
    )
    if (exitCode !== 0) {
      logger.error(`Error restarting caddy: ${stderr}`)
      throw new Error(`Failed to restart caddy`)
    }
    logger.debug(`Caddy restarted: ${stdout}`)
  }
}
