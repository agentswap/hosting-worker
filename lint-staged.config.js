// @ts-check

/**
 * @template {import('lint-staged').Config} T
 * @param {T} config - A generic parameter that flows through to the return type
 */
function defineLintStagedConfig(config) {
  return config
}

export default defineLintStagedConfig({
  '**/*.(ts|tsx|js|jsx|mjs|cjs)': (filenames) =>
    `eslint --fix ${filenames.join(' ')}`,

  '**/*.(md|json|html|yml|yaml)': (filenames) =>
    `prettier --write ${filenames.join(' ')}`,
})
