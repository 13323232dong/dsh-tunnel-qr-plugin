import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { verifyInstalledProfile } from '../scripts/verify-git-install.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ readonly dshHome: string; readonly profileDirectory: string }> {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-tunnel-install-test-'))
  temporaryRoots.push(dshHome)
  const profileDirectory = join(dshHome, 'profiles', 'web')
  const packageDirectory = join(profileDirectory, 'node_modules', 'dsh-tunnel-qr-plugin')
  await mkdir(join(packageDirectory, 'lib'), { recursive: true })
  await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({
    dependencies: { 'dsh-tunnel-qr-plugin': 'git+file:///fixture' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-tunnel-qr-plugin'] } },
  }))
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
    name: 'dsh-tunnel-qr-plugin',
    exports: {
      '.': { default: './lib/index.js' },
      './client': { default: './lib/client.js' },
      './cordis.patch.yml': './cordis.patch.yml',
    },
  }))
  await Promise.all([
    writeFile(join(packageDirectory, 'lib', 'index.js'), ''),
    writeFile(join(packageDirectory, 'lib', 'client.js'), ''),
    writeFile(join(packageDirectory, 'cordis.patch.yml'), '- insert: []\n'),
  ])
  return { dshHome, profileDirectory }
}

describe('clean Git installation verifier', () => {
  test('accepts a profile with the bundle and every published entry', async () => {
    const value = await fixture()

    await expect(verifyInstalledProfile(value.dshHome, 'web')).resolves.toMatchObject({
      dependency: 'git+file:///fixture',
      bundle: 'dsh-tunnel-qr-plugin',
    })
  })

  test('rejects an installation missing the client bundle', async () => {
    const value = await fixture()
    await rm(join(value.profileDirectory, 'node_modules', 'dsh-tunnel-qr-plugin', 'lib', 'client.js'))

    await expect(verifyInstalledProfile(value.dshHome, 'web')).rejects.toThrow(/client\.js/)
  })
})
