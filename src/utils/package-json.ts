import fs from 'node:fs'
import path from 'node:path'

const packagePath = path.join('./package.json')

const packageData = fs.readFileSync(packagePath, 'utf8')

type PackageJson = {
  name: string
  version: string
  description?: string
  main?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  keywords?: string[]
  author?: string | { name: string; email?: string; url?: string }
  license?: string
  bugs?: { url: string; email?: string }
  homepage?: string
  repository?: { type: string; url: string }
  engines?: { node?: string; npm?: string }
  os?: string[]
  cpu?: string[]
  publishConfig?: { registry?: string; access?: string; tag?: string }
}

export const packageJson: PackageJson = JSON.parse(packageData)
