import { createHash } from 'node:crypto'

/**
 * Supabase Root 2021 CA, pinned.
 *
 * Supabase's shared connection pooler presents a chain rooted here, and this
 * root sits in no public trust store, so a default Node connection fails with
 * `SELF_SIGNED_CERT_IN_CHAIN`. The certificate below was read from the pooler's
 * own STARTTLS handshake — a probe that sends no username, no password and no
 * SQL — and then authenticated against the DER SHA-256 published in
 * supabase/supabase#50862. The fingerprint, not the connection that carried the
 * bytes, is what makes this a trust anchor.
 *
 * Verification stays on everywhere in this application: `rejectUnauthorized` is
 * never relaxed, and no `sslmode` taken from a URL is allowed to decide it.
 *
 * Embedded rather than read from disk so a bundled deployment cannot lose the
 * anchor to file tracing. `tests/security.test.ts` asserts the fingerprint, so
 * swapping this certificate for another one fails the suite rather than quietly
 * changing who the database is allowed to be.
 */
export const SUPABASE_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`

/** The value published in supabase/supabase#50862 for `Supabase Root 2021 CA`. */
export const SUPABASE_ROOT_CA_SHA256 = '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa'

export function supabaseRootCaFingerprint(pem: string = SUPABASE_ROOT_CA_PEM) {
  const base64 = pem
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('-----'))
    .join('')
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')
}

/**
 * True only for Supabase's shared pooler. Anything else — the local QA cluster,
 * a restored direct connection — keeps Prisma's own engine and its own TLS.
 */
export function usesSupabasePooler(connectionString: string | undefined | null) {
  if (!connectionString) return false
  try {
    return new URL(connectionString).hostname.endsWith('.pooler.supabase.com')
  } catch {
    return false
  }
}

/**
 * The one TLS configuration every Supabase connection in this repository uses.
 *
 * `servername` is what makes Node verify the certificate against the host we
 * dialled rather than against whatever name the peer offers, and
 * `rejectUnauthorized: true` is what makes a failure to verify fatal. There is
 * deliberately no second branch: an operator cannot ask for an unverified
 * connection by setting a variable, and `tests/security-boundaries.test.ts` proves a
 * self-signed peer and a wrong-hostname peer are both refused.
 */
export function supabaseTlsOptions(host: string) {
  return {
    ca: SUPABASE_ROOT_CA_PEM,
    rejectUnauthorized: true,
    servername: host,
  }
}
