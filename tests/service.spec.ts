import { describe, expect, test } from 'vitest'
import { QrCredentials } from '../src/credentials.ts'
import { createQrResponse } from '../src/service.ts'

describe('QR response creation', () => {
  test('puts the single-use token in a fragment and renders a PNG data URL', async () => {
    const credentials = new QrCredentials({ tokenLifetimeMs: 300_000, sessionLifetimeMs: 1_000 })
    const response = await createQrResponse(
      'https://sample.trycloudflare.com', 4, credentials,
    )

    expect(response.loginUrl).toMatch(/^https:\/\/sample\.trycloudflare\.com\/dsh-qr-login#[A-Za-z0-9_-]+$/)
    expect(response.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(response.generation).toBe(4)
    expect(response.publicUrl).toBe('https://sample.trycloudflare.com')
  })
})
