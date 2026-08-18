#!/usr/bin/env node

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const PACKAGE_NAME = 'dsh-tunnel-qr-plugin'

function readJson(path) {
  return readFile(path, 'utf8').then(value => JSON.parse(value))
}

function exportedPath(exports, key) {
  const entry = exports?.[key]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null && typeof entry.default === 'string') return entry.default
  throw new Error(`installed package is missing export ${key}`)
}

/** Verify the installed profile manifest, bundle list, exports, and shipped files. */
export async function verifyInstalledProfile(dshHome, profile = 'web') {
  const profileDirectory = join(dshHome, 'profiles', profile)
  const manifest = await readJson(join(profileDirectory, 'package.json'))
  const dependency = manifest.dependencies?.[PACKAGE_NAME]
  if (typeof dependency !== 'string') throw new Error(`profile is missing dependency ${PACKAGE_NAME}`)
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) {
    throw new Error(`profile is missing bundle ${PACKAGE_NAME}`)
  }

  const packageDirectory = join(profileDirectory, 'node_modules', PACKAGE_NAME)
  const packageManifest = await readJson(join(packageDirectory, 'package.json'))
  const required = [
    exportedPath(packageManifest.exports, '.'),
    exportedPath(packageManifest.exports, './client'),
    exportedPath(packageManifest.exports, './cordis.patch.yml'),
    './README.md',
    './LICENSE',
  ]
  for (const relativePath of required) {
    await access(join(packageDirectory, relativePath))
  }
  return { dependency, bundle: PACKAGE_NAME, packageDirectory }
}

/** Verify that DSH composed the package's bundle patch into the target profile. */
export function verifyDumpConfig(output) {
  if (!output.includes('# == dsh-tunnel-qr-plugin')
    || !output.includes('- id: tunnel-qr')
    || !output.includes('name: dsh-tunnel-qr-plugin')) {
    throw new Error('composed config is missing the tunnel-qr bundle row')
  }
}

function parseArguments(argv) {
  const options = { profile: 'web', source: undefined, dshRepo: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if ((name === '--source' || name === '--profile' || name === '--dsh-repo') && value === undefined) {
      throw new Error(`${name} requires a value`)
    }
    if (name === '--source') options.source = value
    else if (name === '--profile') options.profile = value
    else if (name === '--dsh-repo') options.dshRepo = value
    else throw new Error(`unknown argument: ${name}`)
    index += 1
  }
  if (options.source === undefined) throw new Error('--source is required')
  return options
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    const output = []
    child.stdout?.on('data', chunk => { output.push(Buffer.from(chunk)) })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(output).toString('utf8'))
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

async function runDsh(options, args, spawnOptions) {
  if (options.dshRepo !== undefined) {
    return await run('pnpm', ['dsh', ...args], { ...spawnOptions, cwd: options.dshRepo })
  }
  return await run('npx', ['-y', '-p', '@deepseek-ai/dsh@0.1.0-rc.6', 'dsh', ...args], spawnOptions)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-tunnel-git-install-'))
  const environment = { ...process.env, DSH_HOME: dshHome }
  try {
    await runDsh(options, ['plugin', '--profile', options.profile, 'add', options.source], {
      env: environment,
      stdio: 'inherit',
    })
    const result = await verifyInstalledProfile(dshHome, options.profile)
    const config = await runDsh(options, ['--profile', options.profile, '--dump-config'], {
      env: environment,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    verifyDumpConfig(config)
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
