import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { execa } from 'execa'

import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export type DeployGradioTaskInfo = {
  port: number
  repositoryOwner: string
  repositoryName: string
}

export async function deployGradio(info: DeployGradioTaskInfo) {
  const { port, repositoryOwner, repositoryName } = info
  const githubUrl = `https://github.com/${repositoryOwner}/${repositoryName}`

  const codeDirectory = fs.mkdtempSync(
    `${path.join(os.tmpdir(), repositoryName)}-`
  )
  logger.debug(`Temporary directory: ${codeDirectory}`)

  logger.debug(`Cloning repository: ${githubUrl}`)
  const { exitCode: cloneExitCode, stderr: cloneError } = await execa(
    'git',
    ['clone', '--depth=1', githubUrl, codeDirectory],
    { cwd: codeDirectory, reject: false }
  )
  if (cloneExitCode !== 0) {
    logger.error(`Error cloning repository: ${cloneError}`)
    throw new Error(`Error cloning repository: ${cloneError}`)
  }

  const dockerFilePath = path.join(__dirname, '../scripts/Dockerfile')
  logger.debug(`Copying Dockerfile ${dockerFilePath} to: ${codeDirectory}`)
  await fsHelper.cp(dockerFilePath, codeDirectory)

  const scriptPath = path.join(__dirname, '../scripts/deploy-gradio.sh')
  const { stdout } = await execa(
    scriptPath,
    [githubUrl, codeDirectory, port.toString()],
    {
      cwd: codeDirectory,
    }
  )
  console.log(stdout)

  logger.debug(`Removing temporary directory: ${codeDirectory}`)
  await fsHelper.rmRF(codeDirectory)
}
