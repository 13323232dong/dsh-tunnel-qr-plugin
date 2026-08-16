import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(import.meta.dirname, '..')

interface PackageManifest {
  readonly name: string
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly exports: Record<string, unknown>
  readonly dsh: unknown
  readonly files: readonly string[]
  readonly scripts: Record<string, string>
}

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as PackageManifest
}

describe('standalone package', () => {
  test('publishes the host and client bundle contract without workspace ranges', async () => {
    const manifest = await readManifest()
    const ranges = [
      ...Object.values(manifest.dependencies ?? {}),
      ...Object.values(manifest.peerDependencies ?? {}),
      ...Object.values(manifest.devDependencies ?? {}),
    ]

    expect(manifest.name).toBe('dsh-tunnel-qr-plugin')
    expect(ranges).not.toContainEqual(expect.stringMatching(/^workspace:/))
    expect(manifest.exports).toMatchObject({
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    })
    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    })
    expect(manifest.files).toEqual(expect.arrayContaining(['lib', 'cordis.patch.yml', 'README.md', 'LICENSE']))
    await expect(access(resolve(root, 'LICENSE'))).resolves.toBeUndefined()
    expect(manifest.scripts).toMatchObject({
      typecheck: expect.any(String),
      'build:types': expect.any(String),
      bundle: expect.any(String),
      build: expect.any(String),
      test: expect.any(String),
      verify: expect.any(String),
    })
    expect(manifest.scripts).not.toHaveProperty('prepare')
  })

  test('ships a credential-free bundle patch and no static QR asset', async () => {
    const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')

    expect(patch).toBe('- insert:\n    - id: tunnel-qr\n      name: dsh-tunnel-qr-plugin\n      config: {}\n')
    await expect(access(resolve(root, 'assets/dsh-public-qr.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('documents one pinned GitHub install without third-party account setup', async () => {
    const readme = await readFile(resolve(root, 'README.md'), 'utf8')
    const installTargets = readme.match(/github:13323232dong\/dsh-tunnel-qr-plugin#[0-9a-f]{40}/g) ?? []

    expect(installTargets).toHaveLength(1)
    expect(readme).toMatch(/Cloudflare (?:account|账号).*(?:not required|无需|不需要)/i)
    expect(readme).toMatch(/Windows ARM64.*(?:x64|AMD64).*(?:emulation|仿真|模拟)/i)
    expect(readme).not.toMatch(/Basic Auth|DSH_TUNNEL_AUTH_(?:USERNAME|PASSWORD)/i)
  })

  test('runs keyless verification on macOS, Windows, and Linux', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8')

    expect(workflow).toContain('ubuntu-latest')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('macos-latest')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm verify')
  })
})
