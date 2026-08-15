import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { CompanyId, UserId } from '@buildflow/core'
import { Argon2PasswordHasher } from '../src/infrastructure/argon2-hasher'
import { JwtTokenIssuer } from '../src/infrastructure/jwt-token-issuer'

const hasher = new Argon2PasswordHasher()

/**
 * Generated per run rather than hardcoded.
 *
 * A literal here is a high-entropy, secret-shaped string in a source file, and
 * secret scanners flag it — correctly, because they cannot tell a test fixture
 * from a real key. Suppressing that finding would train everyone to dismiss
 * scanner output, which is how a genuine leak eventually gets waved through.
 *
 * Generating it also makes the test stronger: it proves the issuer works with
 * an arbitrary secret rather than one specific string.
 */
const secret = (): string => randomBytes(24).toString('base64url')
const SECRET = secret()

describe('Argon2PasswordHasher', () => {
  it('produces an argon2id hash with the configured parameters', async () => {
    const hash = await hasher.hash('correct horse battery staple')
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/)
  })

  it('salts, so identical passwords hash differently', async () => {
    // Without a per-hash salt, identical passwords share a hash and one
    // rainbow table cracks every account at once.
    const [a, b] = await Promise.all([hasher.hash('same-password'), hasher.hash('same-password')])
    expect(a).not.toBe(b)
    expect(await hasher.verify(a, 'same-password')).toBe(true)
    expect(await hasher.verify(b, 'same-password')).toBe(true)
  })

  it('verifies a correct password', async () => {
    const hash = await hasher.hash('كلمة-السر-الصحيحة-٢٠٢٦')
    expect(await hasher.verify(hash, 'كلمة-السر-الصحيحة-٢٠٢٦')).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hasher.hash('correct-password')
    expect(await hasher.verify(hash, 'wrong-password')).toBe(false)
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    // Throwing would produce a 500 instead of a 401 and let an attacker
    // distinguish a corrupt record from a wrong password by response code.
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false)
    expect(await hasher.verify('', 'anything')).toBe(false)
  })

  it('is slow enough to make offline cracking expensive', async () => {
    const started = performance.now()
    await hasher.hash('timing-check')
    const elapsed = performance.now() - started
    // Deliberately a floor, not a range: CI hardware varies, and the assertion
    // that matters is "this was not accidentally configured to be fast".
    expect(elapsed).toBeGreaterThan(20)
  })

  describe('needsRehash', () => {
    it('is false for a hash at current parameters', async () => {
      expect(hasher.needsRehash(await hasher.hash('x'))).toBe(false)
    })

    it('is true for weaker memory cost', () => {
      expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=3,p=4$salt$hash')).toBe(true)
    })

    it('is true for a non-argon2id hash', () => {
      expect(hasher.needsRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true)
    })
  })
})

describe('JwtTokenIssuer', () => {
  const issuer = new JwtTokenIssuer(SECRET)

  const claims = {
    sub: 'usr-1' as UserId,
    companyId: 'co-1' as CompanyId,
    sessionId: 'sess-1',
    permHash: 'abc123',
    roles: ['site_engineer'],
  }

  it('refuses a short secret at construction, not at first request', () => {
    expect(() => new JwtTokenIssuer('short')).toThrow(/at least 32/)
  })

  it('round-trips claims', async () => {
    const token = await issuer.issueAccessToken(claims)
    const verified = await issuer.verifyAccessToken(token)
    expect(verified).toEqual(claims)
  })

  it('does not embed the permission set, only its hash', async () => {
    // Permissions in the token would stay valid until expiry, so a revocation
    // could take up to 15 minutes to take effect. docs/11 §2.2
    const token = await issuer.issueAccessToken(claims)
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
      string,
      unknown
    >
    expect(payload['permHash']).toBe('abc123')
    expect(payload['permissions']).toBeUndefined()
  })

  it('rejects a token signed with a different secret', async () => {
    const other = new JwtTokenIssuer(secret())
    const forged = await other.issueAccessToken(claims)
    expect(await issuer.verifyAccessToken(forged)).toBeNull()
  })

  it('rejects a token for a different audience', async () => {
    // A portal token must not be accepted by an internal endpoint. That
    // separation is structural, not a matter of which routes remember to check.
    const portal = new JwtTokenIssuer(SECRET, 900, 'buildflow:portal')
    const portalToken = await portal.issueAccessToken(claims)
    expect(await issuer.verifyAccessToken(portalToken)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const shortLived = new JwtTokenIssuer(SECRET, -10)
    const expired = await shortLived.issueAccessToken(claims)
    expect(await issuer.verifyAccessToken(expired)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await issuer.issueAccessToken(claims)
    const [header, , signature] = token.split('.')
    const tampered = Buffer.from(JSON.stringify({ ...claims, companyId: 'co-victim' })).toString(
      'base64url',
    )
    expect(await issuer.verifyAccessToken(`${header}.${tampered}.${signature}`)).toBeNull()
  })

  it('returns null rather than throwing on garbage input', async () => {
    expect(await issuer.verifyAccessToken('not.a.token')).toBeNull()
    expect(await issuer.verifyAccessToken('')).toBeNull()
  })
})
