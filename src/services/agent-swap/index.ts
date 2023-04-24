import { URL } from 'node:url'

import { ofetch } from 'ofetch'

import { logger } from '../../logger/index.ts'

export type ModelAppStatus =
  | 'STOPPED'
  | 'BUILDING'
  | 'RUNNING'
  | 'RUNTIME_ERROR'
  | 'BUILD_ERROR'

export type HostingWorkerReportBody = {
  id: number
  state: ModelAppStatus
}

export type HostingWorkerReportResponse = {
  ok: boolean
  id: number
  url: string
  name: string
  state: ModelAppStatus
}

type AgentSwapOptions = {
  baseUrl: string
  workerToken: string
}

export class AgentSwapService {
  #baseUrl: string
  #workerHeader: globalThis.RequestInit['headers']

  public constructor(options: AgentSwapOptions) {
    const { baseUrl, workerToken } = options
    this.#baseUrl = new URL('/', baseUrl).toString()
    this.#workerHeader = {
      'X-Worker-Token': workerToken,
    }
  }

  public async reportHostingWorkerState(id: number, state: ModelAppStatus) {
    const url = new URL(`/api/webhooks/workers/hosting/report`, this.#baseUrl)
    const body: HostingWorkerReportBody = { id, state }

    logger.debug(`Reporting hosting worker ${id} state: ${state}`)
    const response = await ofetch<HostingWorkerReportResponse>(url.toString(), {
      method: 'POST',
      body,
      headers: this.#workerHeader,
    }).catch((error) => {
      logger.error(`Failed to report hosting worker state: ${error}`)
      return { ok: false }
    })

    if (typeof response === 'object' && !response.ok) {
      logger.warn(`Failed to report hosting worker ${id} state ${state}`)
      return
    }

    logger.debug(`Reported hosting worker ${id} state: ${state}`)
  }
}
