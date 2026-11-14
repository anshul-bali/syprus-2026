import { getPrincipal } from '@/lib/authz'
import { readUploadForPrincipal } from '@/server/ai/uploads'

/**
 * Evidence download. Ownership is re-checked inside `readUploadForPrincipal`, and
 * the stored sha256 is recomputed over the bytes before anything is returned, so
 * a replaced file is refused rather than served.
 */
export async function GET(_request: Request, props: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await props.params
  const principal = await getPrincipal()
  if (!principal) {
    return Response.json({ error: 'Sign in to open this document.' }, { status: 401 })
  }

  try {
    const file = await readUploadForPrincipal(principal, uploadId)
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.mimeType,
        'content-length': String(file.bytes.byteLength),
        'content-disposition': `attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`,
        'content-security-policy': "sandbox; default-src 'none'", 
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return Response.json({ error: 'That document is not available.' }, { status: 404 })
  }
}
