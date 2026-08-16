import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import * as tar from 'tar'
import { afterEach, describe, expect, test } from 'vitest'
import type { CloudflaredArtifact } from '../src/artifacts.ts'
import { ensureCloudflared } from '../src/download.ts'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tunnel-download-'))
  roots.push(root)
  return root
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function serve(bytes: Uint8Array, interrupt = false): Promise<{
  readonly url: string
  readonly requests: () => number
  readonly close: () => Promise<void>
}> {
  let count = 0
  const server = createServer((_request, response) => {
    count += 1
    response.writeHead(200, { 'content-length': String(bytes.byteLength) })
    if (interrupt) {
      response.write(bytes.subarray(0, Math.max(1, Math.floor(bytes.byteLength / 2))))
      response.destroy()
      return
    }
    response.end(bytes)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')
  return {
    url: `http://127.0.0.1:${address.port}/cloudflared`,
    requests: () => count,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

const RAW_ARTIFACT: CloudflaredArtifact = {
  asset: 'cloudflared-linux-amd64',
  sha256: 'fixture',
  executable: 'cloudflared',
  archive: 'raw',
  requiresX64Emulation: false,
}

describe('ensureCloudflared', () => {
  test('downloads, verifies, publishes, and reuses one raw executable', async () => {
    const root = await temporaryRoot()
    const bytes = Buffer.from('verified executable')
    const fixture = await serve(bytes)
    try {
      const options = {
        version: 'test', artifact: RAW_ARTIFACT, expectedSha256: sha256(bytes),
        cacheDirectory: root, downloadUrl: fixture.url, allowHttpForTests: true,
      } as const
      const [first, concurrent] = await Promise.all([
        ensureCloudflared(options),
        ensureCloudflared(options),
      ])
      const reused = await ensureCloudflared(options)

      expect(first).toBe(concurrent)
      expect(reused).toBe(first)
      expect(await readFile(first)).toEqual(bytes)
      expect(fixture.requests()).toBe(1)
      if (process.platform !== 'win32') expect((await stat(first)).mode & 0o777).toBe(0o700)
    } finally {
      await fixture.close()
    }
  })

  test('extracts only the expected executable from a Darwin tarball', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'source')
    await mkdir(source)
    const executable = Buffer.from('darwin executable')
    await writeFile(join(source, 'cloudflared'), executable)
    const archivePath = join(root, 'fixture.tgz')
    await tar.c({ cwd: source, gzip: true, file: archivePath }, ['cloudflared'])
    const archive = await readFile(archivePath)
    const fixture = await serve(archive)
    try {
      const path = await ensureCloudflared({
        version: 'test',
        artifact: { ...RAW_ARTIFACT, asset: 'cloudflared-darwin-arm64.tgz', archive: 'tar-gzip' },
        expectedSha256: sha256(archive), cacheDirectory: join(root, 'cache'),
        downloadUrl: fixture.url, allowHttpForTests: true,
      })
      expect(await readFile(path)).toEqual(executable)
    } finally {
      await fixture.close()
    }
  })

  test('does not replace an existing executable when checksum verification fails', async () => {
    const root = await temporaryRoot()
    const cache = join(root, 'test', RAW_ARTIFACT.asset)
    await mkdir(cache, { recursive: true })
    const existing = join(cache, RAW_ARTIFACT.executable)
    await writeFile(existing, 'existing')
    const fixture = await serve(Buffer.from('corrupt'))
    try {
      await expect(ensureCloudflared({
        version: 'test', artifact: RAW_ARTIFACT, expectedSha256: '00'.repeat(32),
        cacheDirectory: root, downloadUrl: fixture.url, allowHttpForTests: true,
      })).rejects.toMatchObject({ code: 'checksum-mismatch' })
      expect(await readFile(existing, 'utf8')).toBe('existing')
    } finally {
      await fixture.close()
    }
  })

  test('removes temporary data after an interrupted response', async () => {
    const root = await temporaryRoot()
    const fixture = await serve(Buffer.alloc(1_024, 1), true)
    try {
      await expect(ensureCloudflared({
        version: 'test', artifact: RAW_ARTIFACT, expectedSha256: '00'.repeat(32),
        cacheDirectory: root, downloadUrl: fixture.url, allowHttpForTests: true,
      })).rejects.toMatchObject({ code: 'download-failed' })
      await expect(readFile(join(root, 'test', RAW_ARTIFACT.asset, RAW_ARTIFACT.executable)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fixture.close()
    }
  })
})
