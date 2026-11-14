import { redact } from './redact'

/**
 * The Supabase Data API reachability probe.
 *
 * Separated from the script so a test can hand it a stub `fetch` and assert where
 * the credential actually travels. The rules it has to keep:
 *
 *  - the key is in headers only. A query parameter is written to every proxy and
 *    access log on the path, and fetch puts the full URL inside its own errors;
 *  - redirects are refused, because a redirect would replay both headers to
 *    whatever host answered;
 *  - nothing it returns or throws carries the key, even when the platform echoes
 *    it back inside an error body.
 */

export type ProbeResult =
  | { ok: true; status: number }
  | { ok: false; status: number }
  | { ok: false; error: string }

export async function probeDataApi(input: {
  ref: string
  serviceKey: string
  timeoutMs?: number
}): Promise<ProbeResult> {
  const url = `https://${input.ref}.supabase.co/rest/v1/`
  try {
    const response = await fetch(url, {
      headers: { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(input.timeoutMs ?? 12000),
    })
    return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status }
  } catch (error) {
    // `redact` rather than the raw message: a TypeError from fetch names the URL
    // it was given, and a platform error can quote the credential back.
    return { ok: false, error: redact(error) }
  }
}