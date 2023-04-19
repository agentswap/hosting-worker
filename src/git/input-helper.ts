import assert from 'node:assert'
import path from 'node:path'

import { logger } from '../logger/index.ts'
import * as fsHelper from '../utils/fs-helper.ts'
import type { IGitSourceSettings } from './git-source-settings.ts'

export interface IInputs {
  workspacePath: string
  repositoryOwner: string
  repositoryName: string
}

export async function getInputs(inputs: IInputs): Promise<IGitSourceSettings> {
  const result = {} as unknown as IGitSourceSettings

  const { workspacePath } = inputs
  const codeWorkspacePath = path.resolve(workspacePath)
  logger.debug(`code workspace path = ${codeWorkspacePath}`)
  fsHelper.directoryExistsSync(codeWorkspacePath, true)

  // Qualified repository
  const { repositoryOwner, repositoryName } = inputs
  const qualifiedRepository = `${repositoryOwner}/${repositoryName}`
  assert.ok(
    typeof repositoryOwner === 'string' && typeof repositoryName === 'string',
    'Invalid repository owner and name'
  )
  logger.debug(`qualified repository = '${qualifiedRepository}'`)
  result.repositoryOwner = repositoryOwner
  result.repositoryName = repositoryName

  // Repository path
  const repositoryPath = '.'
  result.repositoryPath = path.resolve(codeWorkspacePath, repositoryPath)
  if (
    !(result.repositoryPath + path.sep).startsWith(codeWorkspacePath + path.sep)
  ) {
    throw new Error(
      `Repository path '${result.repositoryPath}' is not under '${codeWorkspacePath}'`
    )
  }

  return result
}
