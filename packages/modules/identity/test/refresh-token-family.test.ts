import { describe, it, expect } from 'vitest'
import type { CompanyId, UserId } from '@buildflow/core'
import {
  evaluateRefresh,
  generateRefreshToken,
  hashToken,
  type RefreshTokenRecord,
} from '../src/domain/refresh-token-family'

const NOW = new Date('2026-06-01T12:00:00.000Z')

const token = (over: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord => ({
  id: 'tok-1',
  companyId: 'co-1' as CompanyId,
  sessionId: 'sess-1',
  userId: 'usr-1' as UserId,
  tokenHash: 'hash',
  familyId: 'fam-1',
  parentId: null,
  issuedAt: new Date('2026-06-01T11:00:00.000Z'),
  expiresAt: new Date('2026-07-01T11:00:00.000Z'),
  usedAt: null,
  revokedAt: null,
  ...over,
})

describe('evaluateRefresh', () => {
  it('rotates a valid unused token', () => {
    const result = evaluateRefresh(token(), NOW)
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().kind).toBe('rotate')
  })

  describe('reuse detection — the control that defeats a stolen token', () => {
    it('flags a token that was already consumed', () => {
      // In honest use a refresh token is presented exactly once: the client
      // replaces it on receipt. A second presentation means two parties hold
      // it, which is unambiguous evidence of theft.
      const result = evaluateRefresh(token({ usedAt: new Date('2026-06-01T11:30:00.000Z') }), NOW)
      expect(result.isOk()).toBe(true)
      const outcome = result.unwrap()
      expect(outcome.kind).toBe('reuse_detected')
      if (outcome.kind === 'reuse_detected') {
        expect(outcome.familyId).toBe('fam-1')
      }
    })

    it('reports the family so every descendant of that login can be revoked', () => {
      const outcome = evaluateRefresh(
        token({ familyId: 'fam-stolen', usedAt: NOW, parentId: 'tok-0' }),
        NOW,
      ).unwrap()
      expect(outcome.kind).toBe('reuse_detected')
      if (outcome.kind === 'reuse_detected') expect(outcome.familyId).toBe('fam-stolen')
    })

    it('prefers reuse detection over expiry', () => {
      // A consumed AND expired token is still evidence of theft. Reporting it
      // as merely expired would discard the signal and leave the family alive.
      const outcome = evaluateRefresh(
        token({ usedAt: NOW, expiresAt: new Date('2026-05-01T00:00:00.000Z') }),
        NOW,
      ).unwrap()
      expect(outcome.kind).toBe('reuse_detected')
    })
  })

  describe('rejections', () => {
    it('rejects an unknown token', () => {
      const result = evaluateRefresh(null, NOW)
      expect(result.isErr()).toBe(true)
      expect(result.isErr() && result.error.code).toBe('REFRESH_TOKEN_UNKNOWN')
    })

    it('rejects an expired token', () => {
      const result = evaluateRefresh(
        token({ expiresAt: new Date('2026-05-01T00:00:00.000Z') }),
        NOW,
      )
      expect(result.isErr() && result.error.code).toBe('REFRESH_TOKEN_EXPIRED')
    })

    it('rejects a revoked token without re-revoking a dead family', () => {
      const result = evaluateRefresh(token({ revokedAt: NOW }), NOW)
      expect(result.isErr() && result.error.code).toBe('REFRESH_TOKEN_REVOKED')
    })

    it('accepts a token expiring in the future by one millisecond', () => {
      const result = evaluateRefresh(token({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)
      expect(result.isOk()).toBe(true)
    })

    it('rejects a token expiring exactly now', () => {
      const result = evaluateRefresh(token({ expiresAt: NOW }), NOW)
      expect(result.isErr() && result.error.code).toBe('REFRESH_TOKEN_EXPIRED')
    })
  })
})

describe('generateRefreshToken', () => {
  it('produces 256 bits of entropy', () => {
    // base64url of 32 bytes, unpadded.
    expect(generateRefreshToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 5_000 }, () => generateRefreshToken()))
    expect(tokens.size).toBe(5_000)
  })
})

describe('hashToken', () => {
  it('is deterministic', async () => {
    expect(await hashToken('abc')).toBe(await hashToken('abc'))
  })

  it('never stores the token itself', async () => {
    // A database dump must not yield usable credentials.
    const raw = generateRefreshToken()
    const hashed = await hashToken(raw)
    expect(hashed).not.toContain(raw)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different hashes for tokens differing by one character', async () => {
    expect(await hashToken('token-a')).not.toBe(await hashToken('token-b'))
  })
})
