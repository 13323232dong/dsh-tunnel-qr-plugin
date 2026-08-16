import { describe, expect, test } from 'vitest'
import { resolveArtifact } from '../src/artifacts.ts'

describe('cloudflared artifact resolution', () => {
  test.each([
    ['darwin', 'x64', 'cloudflared-darwin-amd64.tgz', 'tar-gzip', false],
    ['darwin', 'arm64', 'cloudflared-darwin-arm64.tgz', 'tar-gzip', false],
    ['linux', 'x64', 'cloudflared-linux-amd64', 'raw', false],
    ['linux', 'arm64', 'cloudflared-linux-arm64', 'raw', false],
    ['win32', 'x64', 'cloudflared-windows-amd64.exe', 'raw', false],
    ['win32', 'arm64', 'cloudflared-windows-amd64.exe', 'raw', true],
  ] as const)('maps %s/%s exactly', (platform, architecture, asset, archive, requiresX64Emulation) => {
    expect(resolveArtifact(platform, architecture)).toEqual({
      ok: true,
      artifact: {
        asset,
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
