/**
 * Gets the value of an state set by this action's main execution.
 *
 * @param     name     name of the state to get
 * @returns   string
 */
export function getState(name: string): string {
  return process.env[`STATE_${name}`] || ''
}

/**
 * The set-safe-directory for the POST action. The value is set if input: 'safe-directory' is set during the MAIN action.
 */
export const PostSetSafeDirectory = getState('setSafeDirectory') === 'true'

export function setSafeDirectory() {
  throw new Error('Function not implemented.')
}
export function setRepositoryPath(repositoryPath: string) {
  throw new Error('Function not implemented.')
}
