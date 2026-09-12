import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadGmailConnection, parseGmailConnection } from './gmail-connection'
import { GmailConnectionView } from './GmailConnectionStatus'
vi.mock('deepspace', () => ({ getAuthToken: async () => 'test-token' }))
afterEach(() => vi.unstubAllGlobals())
it('reads only authenticated status, never the send endpoint', async () => {
  const fetcher = vi.fn(async () => Response.json({ google: { connected: false, gmailSend: false } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await loadGmailConnection()).toEqual({ connected: false, gmailSend: false })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0]).toMatchObject(['/api/integrations/status', { headers: { Authorization: 'Bearer test-token' } }])
})
it('accepts direct and wrapped status but rejects missing permission data', () => {
  expect(parseGmailConnection({ success: true, data: { google: { connected: true, gmailSend: false } } }).gmailSend).toBe(false)
  expect(() => parseGmailConnection({ google: { connected: true } })).toThrow()
})
it('does not retry failed reads or mislabel them disconnected', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(loadGmailConnection()).rejects.toThrow('Could not check')
  expect(fetcher).toHaveBeenCalledOnce()
})
it('distinguishes account connection from sending permission and escapes the email', () => {
  expect(renderToStaticMarkup(<GmailConnectionView state={{ connected: true, gmailSend: false }} />)).toContain('permission is missing')
  const html = renderToStaticMarkup(<GmailConnectionView state={{ connected: true, gmailSend: true, email: '<script>x</script>' }} />)
  expect(html).toContain('Permission has not been tested')
  expect(html).not.toContain('<script>')
})
