import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { IS_WINDOWS } from '../env/index.ts'
import { logger } from '../logger/index.ts'

export function isErrorObject(
  error: unknown
): error is { code?: string; message?: string } {
  return typeof error === 'object' && error !== null
}

export function directoryExistsSync(path: string, required?: boolean): boolean {
  if (!path) {
    throw new Error("Arg 'path' must not be empty")
  }

  let stats: fs.Stats
  try {
    stats = fs.statSync(path)
  } catch (error) {
    if (isErrorObject(error)) {
      if (error.code === 'ENOENT') {
        if (!required) {
          return false
        }

        throw new Error(`Directory '${path}' does not exist`)
      }

      if (error.message) {
        throw new Error(
          `Encountered an error when checking whether path '${path}' exists: ${error.message}`
        )
      }
    }

    throw new Error(
      `Encountered an error when checking whether path '${path}' exists: ${error}`
    )
  }

  if (stats.isDirectory()) {
    return true
  } else if (!required) {
    return false
  }

  throw new Error(`Directory '${path}' does not exist`)
}

export function existsSync(path: string): boolean {
  if (!path) {
    throw new Error("Arg 'path' must not be empty")
  }

  try {
    fs.statSync(path)
  } catch (error) {
    if (isErrorObject(error)) {
      if (error.code === 'ENOENT') {
        return false
      }

      if (error.message) {
        throw new Error(
          `Encountered an error when checking whether path '${path}' exists: ${error.message}`
        )
      }
    }

    throw new Error(
      `Encountered an error when checking whether path '${path}' exists: ${error}`
    )
  }

  return true
}

export function fileExistsSync(path: string): boolean {
  if (!path) {
    throw new Error("Arg 'path' must not be empty")
  }

  let stats: fs.Stats
  try {
    stats = fs.statSync(path)
  } catch (error) {
    if (isErrorObject(error)) {
      if (error.code === 'ENOENT') {
        return false
      }

      if (error.message) {
        throw new Error(
          `Encountered an error when checking whether path '${path}' exists: ${error.message}`
        )
      }
    }

    throw new Error(
      `Encountered an error when checking whether path '${path}' exists: ${error}`
    )
  }

  if (!stats.isDirectory()) {
    return true
  }

  return false
}

// ====== @actions/io ======
//#region @actions/io

/**
 * Interface for cp/mv options
 */
export interface CopyOptions {
  /** Optional. Whether to recursively copy all subdirectories. Defaults to false */
  recursive?: boolean
  /** Optional. Whether to overwrite existing files in the destination. Defaults to true */
  force?: boolean
  /** Optional. Whether to copy the source directory along with all the files. Only takes effect when recursive=true and copying a directory. Default is true*/
  copySourceDirectory?: boolean
}

/**
 * Copies a file or folder.
 * Based off of shelljs - https://github.com/shelljs/shelljs/blob/9237f66c52e5daa40458f94f9565e18e8132f5a6/src/cp.js
 *
 * @param     source    source path
 * @param     dest      destination path
 * @param     options   optional. See CopyOptions.
 */
export async function cp(
  source: string,
  destination: string,
  options: CopyOptions = {}
): Promise<void> {
  const { force, recursive, copySourceDirectory } = readCopyOptions(options)

  const destinationStat = (await exists(destination))
    ? await fsp.stat(destination)
    : undefined
  // Dest is an existing file, but not forcing
  if (destinationStat && destinationStat.isFile() && !force) {
    return
  }

  // If dest is an existing directory, should copy inside.
  const newDestination: string =
    destinationStat && destinationStat.isDirectory() && copySourceDirectory
      ? path.join(destination, path.basename(source))
      : destination

  if (!(await exists(source))) {
    throw new Error(`no such file or directory: ${source}`)
  }
  const sourceStat = await fsp.stat(source)

  if (sourceStat.isDirectory()) {
    if (recursive) {
      await cpDirectoryRecursive(source, newDestination, 0, force)
    } else {
      throw new Error(
        `Failed to copy. ${source} is a directory, but tried to copy without recursive flag.`
      )
    }
  } else {
    if (path.relative(source, newDestination) === '') {
      // a file cannot be copied to itself
      throw new Error(`'${newDestination}' and '${source}' are the same file`)
    }

    await copyFile(source, newDestination, force)
  }
}

/**
 * Interface for cp/mv options
 */
export interface MoveOptions {
  /** Optional. Whether to overwrite existing files in the destination. Defaults to true */
  force?: boolean
}

/**
 * Moves a path.
 *
 * @param     source    source path
 * @param     dest      destination path
 * @param     options   optional. See MoveOptions.
 */
export async function mv(
  source: string,
  destination: string,
  options: MoveOptions = {}
): Promise<void> {
  let destinationExists = await exists(destination)
  if (destinationExists) {
    if (await isDirectory(destination)) {
      // If dest is directory copy src into dest
      destination = path.join(destination, path.basename(source))
      destinationExists = await exists(destination)
    }

    if (destinationExists) {
      const force = options.force ?? true
      if (force) {
        await rmRF(destination)
      } else {
        throw new Error('Destination already exists')
      }
    }
  }
  await mkdirP(path.dirname(destination))
  await fsp.rename(source, destination)
}

/**
 * Remove a path recursively with force
 *
 * @param inputPath path to remove
 */
export async function rmRF(inputPath: string): Promise<void> {
  if (
    IS_WINDOWS && // Check for invalid characters
    // https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
    /["*<>|]/.test(inputPath)
  ) {
    throw new Error(
      'File path must not contain `*`, `"`, `<`, `>` or `|` on Windows'
    )
  }
  try {
    // note if path does not exist, error is silent
    await fsp.rm(inputPath, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 300,
    })
  } catch (error) {
    throw new Error(`File was unable to be removed ${error}`)
  }
}

/**
 * Make a directory.  Creates the full path with folders in between
 * Will throw if it fails
 *
 * @param   fsPath        path to create
 * @returns Promise<void>
 */
export async function mkdirP(fsPath: string): Promise<void> {
  assert.ok(fsPath, 'a path argument must be provided')
  await fsp.mkdir(fsPath, { recursive: true })
}

/**
 * Returns path of a tool had the tool actually been invoked.  Resolves via paths.
 * If you check and the tool does not exist, it will throw.
 *
 * @param     tool              name of the tool
 * @param     check             whether to check if tool exists
 * @returns   Promise<string>   path to tool
 */
export async function which(tool: string, check?: boolean): Promise<string> {
  if (!tool) {
    throw new Error("parameter 'tool' is required")
  }

  // recursive when check=true
  if (check) {
    const result: string = await which(tool, false)

    if (!result) {
      const error = IS_WINDOWS
        ? new Error(
            `Unable to locate executable file: ${tool}. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable. Also verify the file has a valid extension for an executable file.`
          )
        : new Error(
            `Unable to locate executable file: ${tool}. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable. Also check the file mode to verify the file is executable.`
          )
      throw error
    }

    return result
  }

  const matches: string[] = await findInPath(tool)

  if (matches && matches.length > 0) {
    return matches[0]
  }

  return ''
}

/**
 * Returns a list of all occurrences of the given tool on the system path.
 *
 * @returns   Promise<string[]>  the paths of the tool
 */
export async function findInPath(tool: string): Promise<string[]> {
  if (!tool) {
    throw new Error("parameter 'tool' is required")
  }

  // build the list of extensions to try
  const extensions: string[] = []
  if (IS_WINDOWS && process.env['PATHEXT']) {
    for (const extension of process.env['PATHEXT'].split(path.delimiter)) {
      if (extension) {
        extensions.push(extension)
      }
    }
  }

  // if it's rooted, return it if exists. otherwise return empty.
  if (isRooted(tool)) {
    const filePath: string = await tryGetExecutablePath(tool, extensions)

    if (filePath) {
      return [filePath]
    }

    return []
  }

  // if any path separators, return empty
  if (tool.includes(path.sep)) {
    return []
  }

  // build the list of directories
  //
  // Note, technically "where" checks the current directory on Windows. From a toolkit perspective,
  // it feels like we should not do this. Checking the current directory seems like more of a use
  // case of a shell, and the which() function exposed by the toolkit should strive for consistency
  // across platforms.
  const directories: string[] = []

  if (process.env.PATH) {
    for (const p of process.env.PATH.split(path.delimiter)) {
      if (p) {
        directories.push(p)
      }
    }
  }

  // find all matches
  const matches: string[] = []

  for (const directory of directories) {
    const filePath = await tryGetExecutablePath(
      path.join(directory, tool),
      extensions
    )
    if (filePath) {
      matches.push(filePath)
    }
  }

  return matches
}

function readCopyOptions(options: CopyOptions): Required<CopyOptions> {
  const force = options.force ?? true
  const recursive = Boolean(options.recursive)
  const copySourceDirectory = options.copySourceDirectory ?? true
  return { force, recursive, copySourceDirectory }
}

async function cpDirectoryRecursive(
  sourceDirectory: string,
  destinationDirectory: string,
  currentDepth: number,
  force: boolean
): Promise<void> {
  // Ensure there is not a run away recursive copy
  if (currentDepth >= 255) return
  currentDepth++

  await mkdirP(destinationDirectory)

  const files: string[] = await fsp.readdir(sourceDirectory)

  for (const fileName of files) {
    const sourceFile = `${sourceDirectory}/${fileName}`
    const destinationFile = `${destinationDirectory}/${fileName}`
    const sourceFileStat = await fsp.lstat(sourceFile)

    sourceFileStat.isDirectory()
      ? // Recurse
        await cpDirectoryRecursive(
          sourceFile,
          destinationFile,
          currentDepth,
          force
        )
      : await copyFile(sourceFile, destinationFile, force)
  }

  // Change the mode for the newly created directory
  const sourceStat = await fsp.stat(sourceDirectory)
  await fsp.chmod(destinationDirectory, sourceStat.mode)
}

// Buffered file copy
async function copyFile(
  sourceFile: string,
  destinationFile: string,
  force: boolean
): Promise<void> {
  const sourceStat = await fsp.lstat(sourceFile)
  if (sourceStat.isSymbolicLink()) {
    // unlink/re-link it
    try {
      await fsp.lstat(destinationFile)
      await fsp.unlink(destinationFile)
    } catch (error) {
      // Try to override file permission
      if (isErrorObject(error) && error.code === 'EPERM') {
        await fsp.chmod(destinationFile, '0666')
        await fsp.unlink(destinationFile)
      }
      // other errors = it doesn't exist, no work to do
    }

    // Copy over symlink
    const symlinkFull: string = await fsp.readlink(sourceFile)
    await fsp.symlink(
      symlinkFull,
      destinationFile,
      IS_WINDOWS ? 'junction' : undefined
    )
  } else if (!(await exists(destinationFile)) || force) {
    await fsp.copyFile(sourceFile, destinationFile)
  }
}

export async function exists(fsPath: string): Promise<boolean> {
  try {
    await fsp.stat(fsPath)
  } catch (error) {
    if (isErrorObject(error) && error?.code === 'ENOENT') {
      return false
    }

    throw error
  }

  return true
}

export async function isDirectory(
  fsPath: string,
  useStat = false
): Promise<boolean> {
  const stats = useStat ? await fsp.stat(fsPath) : await fsp.lstat(fsPath)
  return stats.isDirectory()
}

/**
 * On OSX/Linux, true if path starts with '/'. On Windows, true for paths like:
 * \, \hello, \\hello\share, C:, and C:\hello (and corresponding alternate separator cases).
 */
export function isRooted(p: string): boolean {
  p = normalizeSeparators(p)
  if (!p) {
    throw new Error('isRooted() parameter "p" cannot be empty')
  }

  if (IS_WINDOWS) {
    return (
      p.startsWith('\\') || /^[a-z]:/i.test(p) // e.g. \ or \hello or \\hello
    ) // e.g. C: or C:\hello
  }

  return p.startsWith('/')
}

/**
 * Best effort attempt to determine whether a file exists and is executable.
 * @param filePath    file path to check
 * @param extensions  additional file extensions to try
 * @return if file exists and is executable, returns the file path. otherwise empty string.
 */
export async function tryGetExecutablePath(
  filePath: string,
  extensions: string[]
): Promise<string> {
  let stats: fs.Stats | undefined
  try {
    // test file exists
    stats = await fsp.stat(filePath)
  } catch (error) {
    if (isErrorObject(error) && error?.code !== 'ENOENT') {
      logger.warn(
        `Unexpected error attempting to determine if executable file exists '${filePath}': ${error}`
      )
    }
  }
  if (stats && stats.isFile()) {
    if (IS_WINDOWS) {
      // on Windows, test for valid extension
      const upperExtension = path.extname(filePath).toUpperCase()
      if (
        extensions.some(
          (validExtension) => validExtension.toUpperCase() === upperExtension
        )
      ) {
        return filePath
      }
    } else {
      if (isUnixExecutable(stats)) {
        return filePath
      }
    }
  }

  // try each extension
  const originalFilePath = filePath
  for (const extension of extensions) {
    filePath = originalFilePath + extension

    stats = undefined
    try {
      stats = await fsp.stat(filePath)
    } catch (error) {
      if (isErrorObject(error) && error?.code !== 'ENOENT') {
        logger.warn(
          `Unexpected error attempting to determine if executable file exists '${filePath}': ${error}`
        )
      }
    }

    if (stats && stats.isFile()) {
      if (IS_WINDOWS) {
        // preserve the case of the actual file (since an extension was appended)
        try {
          const directory = path.dirname(filePath)
          const upperName = path.basename(filePath).toUpperCase()
          for (const actualName of await fsp.readdir(directory)) {
            if (upperName === actualName.toUpperCase()) {
              filePath = path.join(directory, actualName)
              break
            }
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.log(
            `Unexpected error attempting to determine the actual case of the file '${filePath}': ${error}`
          )
        }

        return filePath
      } else {
        if (isUnixExecutable(stats)) {
          return filePath
        }
      }
    }
  }

  return ''
}

function normalizeSeparators(p = ''): string {
  if (IS_WINDOWS) {
    // convert slashes on Windows
    p = p.replaceAll('/', '\\')

    // remove redundant slashes
    return p.replaceAll(/\\\\+/g, '\\')
  }

  // remove redundant slashes
  return p.replaceAll(/\/\/+/g, '/')
}

// on Mac/Linux, test the execute bit
//     R   W  X  R  W X R W X
//   256 128 64 32 16 8 4 2 1
function isUnixExecutable(stats: fs.Stats): boolean {
  const gid = process.getgid?.()
  return (
    (stats.mode & 1) > 0 ||
    ((stats.mode & 8) > 0 && stats.gid === gid) ||
    ((stats.mode & 64) > 0 && stats.uid === gid)
  )
}

//#endregion @actions/io
