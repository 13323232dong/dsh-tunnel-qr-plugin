import { describe, expect, test } from 'vitest'
import { resolveArtifact } from '../src/artifacts.ts'

describe('cloudflared artifact resolution', () => {
  test.each([
    ['darwin', 'x64', 'cloudflared-darwin-amd64.tgz', 'f1727723c586500e2092368ae21871b3df7ddfd2cb097f22d81bee4a9c458bb4', 'tar-gzip', false],
    ['darwin', 'arm64', 'cloudflared-darwin-arm64.tgz', '9042c2c5d8b2de78e60f313d5fb31b6c5c1cebde787a3caf1f2c9588084ac442', 'tar-gzip', false],
    ['linux', 'x64', 'cloudflared-linux-amd64', 'fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2', 'raw', false],
    ['linux', 'arm64', 'cloudflared-linux-arm64', '7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790', 'raw', false],
    ['win32', 'x64', 'cloudflared-windows-amd64.exe', 'c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5', 'raw', false],
    ['win32', 'arm64', 'cloudflared-windows-amd64.exe', 'c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5', 'raw', true],
  ] as const)('maps %s/%s exactly', (platform, architecture, asset, sha256, archive, requiresX64Emulation) => {
    expect(resolveArtifact(platform, architecture)).toEqual({
      ok: true,
      artifact: {
        asset,
        sha256,
        executable: platform === 'win32' ? 'cloudflared.exe' : 'cloudflared',
        archive,
        requiresX64Emulation,
      },
    })
  })

  test('fails closed for every unlisted pair', () => {
    expect(resolveArtifact('freebsd', 'x64')).toEqual({
      ok: false,
      code: 'unsupported-platform',
      platform: 'freebsd',
      architecture: 'x64',
    })
    expect(resolveArtifact('linux', 'ia32')).toEqual({
      ok: false,
      code: 'unsupported-platform',
      platform: 'linux',
      architecture: 'ia32',
    })
  })
})
