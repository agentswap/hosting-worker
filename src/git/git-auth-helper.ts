import type { IGitCommandManager } from './git-command-manager.ts'
import type { IGitSourceSettings } from './git-source-settings.ts'

export interface IGitAuthHelper {
  configureAuth(): Promise<void>
  configureGlobalAuth(): Promise<void>
  configureSubmoduleAuth(): Promise<void>
  configureTempGlobalConfig(): Promise<string>
  removeAuth(): Promise<void>
  removeGlobalConfig(): Promise<void>
}

export function createAuthHelper(
  git: IGitCommandManager,
  settings?: IGitSourceSettings
): IGitAuthHelper {
  throw new Error('Function not implemented.')
}
