import assert from 'node:assert'
import os from 'node:os'
import path from 'node:path'

import { v4 as uuidV4 } from '@napi-rs/uuid'
import { execa } from 'execa'

import { IS_DEBUG, IS_WINDOWS } from '../env/index.ts'
import { logger } from '../logger/index.ts'
import * as fsHelper from './fs-helper.ts'

/**
 * Extract a compressed tar archive
 *
 * @param file     path to the tar
 * @param dest     destination directory. Optional.
 * @param flags    flags for the tar command to use for extraction. Defaults to 'xz' (extracting gzipped tars). Optional.
 * @returns        path to the destination directory
 */
export async function extractTar(
  file: string,
  destination?: string,
  flags: string | string[] = 'xz'
): Promise<string> {
  if (!file) {
    throw new Error("parameter 'file' is required")
  }

  // Create dest
  destination = await _createExtractFolder(destination)

  // Determine whether GNU tar
  logger.debug('Checking tar --version')
  const { stdout: versionOutput } = await execa('tar --version', [])
  logger.debug(versionOutput.trim())
  const isGnuTar = versionOutput.toUpperCase().includes('GNU TAR')

  // Initialize args
  const arguments_: string[] = Array.isArray(flags) ? flags : [flags]

  if (IS_DEBUG && !flags.includes('v')) {
    arguments_.push('-v')
  }

  let destinationArgument = destination
  let fileArgument = file
  if (IS_WINDOWS && isGnuTar) {
    arguments_.push('--force-local')
    destinationArgument = destination.replaceAll('\\', '/')

    // Technically only the dest needs to have `/` but for aesthetic consistency
    // convert slashes in the file arg too.
    fileArgument = file.replaceAll('\\', '/')
  }

  if (isGnuTar) {
    // Suppress warnings when using GNU tar to extract archives created by BSD tar
    arguments_.push('--warning=no-unknown-keyword', '--overwrite')
  }

  arguments_.push('-C', destinationArgument, '-f', fileArgument)
  await execa(`tar`, arguments_)

  return destination
}

/**
 * Extract a zip
 *
 * @param file     path to the zip
 * @param dest     destination directory. Optional.
 * @returns        path to the destination directory
 */
export async function extractZip(
  file: string,
  destination?: string
): Promise<string> {
  if (!file) {
    throw new Error("parameter 'file' is required")
  }

  destination = await _createExtractFolder(destination)

  await (IS_WINDOWS
    ? extractZipWin(file, destination)
    : extractZipNix(file, destination))

  return destination
}

async function extractZipWin(file: string, destination: string): Promise<void> {
  // build the powershell command
  const escapedFile = file.replaceAll("'", "''").replaceAll(/[\n\r"]/g, '') // double-up single quotes, remove double quotes and newlines
  const escapedDestination = destination
    .replaceAll("'", "''")
    .replaceAll(/[\n\r"]/g, '')
  const pwshPath = await fsHelper.which('pwsh', false)

  //To match the file overwrite behavior on nix systems, we use the overwrite = true flag for ExtractToDirectory
  //and the -Force flag for Expand-Archive as a fallback
  if (pwshPath) {
    //attempt to use pwsh with ExtractToDirectory, if this fails attempt Expand-Archive
    const pwshCommand = [
      `$ErrorActionPreference = 'Stop' ;`,
      `try { Add-Type -AssemblyName System.IO.Compression.ZipFile } catch { } ;`,
      `try { [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDestination}', $true) }`,
      `catch { if (($_.Exception.GetType().FullName -eq 'System.Management.Automation.MethodException') -or ($_.Exception.GetType().FullName -eq 'System.Management.Automation.RuntimeException') ){ Expand-Archive -LiteralPath '${escapedFile}' -DestinationPath '${escapedDestination}' -Force } else { throw $_ } } ;`,
    ].join(' ')

    const arguments_ = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Unrestricted',
      '-Command',
      pwshCommand,
    ]

    logger.debug(`Using pwsh at path: ${pwshPath}`)
    await execa(`"${pwshPath}"`, arguments_)
  } else {
    const powershellCommand = [
      `$ErrorActionPreference = 'Stop' ;`,
      `try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch { } ;`,
      `if ((Get-Command -Name Expand-Archive -Module Microsoft.PowerShell.Archive -ErrorAction Ignore)) { Expand-Archive -LiteralPath '${escapedFile}' -DestinationPath '${escapedDestination}' -Force }`,
      `else {[System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDestination}', $true) }`,
    ].join(' ')

    const arguments_ = [
      '-NoLogo',
      '-Sta',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Unrestricted',
      '-Command',
      powershellCommand,
    ]

    const powershellPath = await fsHelper.which('powershell', true)
    logger.debug(`Using powershell at path: ${powershellPath}`)

    await execa(`"${powershellPath}"`, arguments_)
  }
}

async function extractZipNix(file: string, destination: string): Promise<void> {
  const unzipPath = await fsHelper.which('unzip', true)
  const arguments_ = [file]
  if (!IS_DEBUG) {
    arguments_.unshift('-q')
  }
  arguments_.unshift('-o') //overwrite with -o, otherwise a prompt is shown which freezes the run
  await execa(`"${unzipPath}"`, arguments_, { cwd: destination })
}

async function _createExtractFolder(destination?: string): Promise<string> {
  if (!destination) {
    // create a temp dir
    destination = path.join(_getTemporaryDirectory(), uuidV4())
  }
  await fsHelper.mkdirP(destination)
  return destination
}

/**
 * Gets os.tmpdir()
 */
function _getTemporaryDirectory(): string {
  const temporaryDirectory = os.tmpdir()
  assert.ok(temporaryDirectory, 'Expected a temporary directory')
  return temporaryDirectory
}
