import type { Credentials, SpaceEntry } from '@huggingface/hub'
import { ofetch } from 'ofetch'

import { logger } from '../../logger/index.ts'

type HuggingFaceServiceOptions = {
  accessToken?: string
}

export class HuggingFaceService {
  #hubUrl = 'https://huggingface.co'

  #credentials: Credentials

  public constructor(options: HuggingFaceServiceOptions) {
    const { accessToken } = options
    this.#credentials = { accessToken } as Credentials
  }

  public async checkSpaceExists(owner: string, name: string): Promise<boolean> {
    const id = `${owner}/${name}`

    logger.debug(`Checking if space ${id} exists`)

    const EXPAND_KEYS = ['sdk', 'likes', 'private', 'lastModified']

    const search = new URLSearchParams([
      ...Object.entries({ id }),
      ...EXPAND_KEYS.map(
        (value) => ['expand', value] satisfies [string, string]
      ),
    ]).toString()
    const url = new URL(`/api/spaces?${search}`, this.#hubUrl)

    try {
      const response = await ofetch<SpaceEntry[]>(url.toString(), {
        method: 'GET',
      })

      if (response && Array.isArray(response)) {
        const space = response.find((space) => space.id === id)
        if (space && space.sdk === 'gradio') {
          return true
        }
      }

      throw new Error(`Space ${id} does not exist or is private`)
    } catch (error) {
      logger.warn(`Error checking if space exists: ${error}`)
      throw new Error(`Space ${id} does not exist or is private`)
    }
  }
}
