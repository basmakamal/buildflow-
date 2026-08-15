import { hash, verify } from '@node-rs/argon2'
import type { PasswordHasher } from '../domain/ports'

/**
 * argon2id password hashing.
 *
 * WHY argon2id and not bcrypt: argon2id is memory-hard, so a GPU or ASIC
 * attacker gains far less than they do against bcrypt. It won the Password
 * Hashing Competition and is the OWASP first choice.
 *
 * WHY @node-rs/argon2: ships prebuilt native binaries, so `pnpm install` needs
 * no C toolchain. The reference `argon2` package compiles from source, which
 * breaks CI and Windows developer machines without build tools.
 *
 * PARAMETERS follow OWASP guidance (m=64MiB, t=3, p=4) and are tuned to roughly
 * 250ms on production hardware. That number is a deliberate trade: slow enough
 * to make offline cracking expensive, fast enough that login does not feel
 * broken. Raising memory cost is the lever to pull as hardware improves — it
 * hurts attackers far more than it hurts us. docs/11 §2.1
 */

const MEMORY_COST = 65_536 // 64 MiB
const TIME_COST = 3
const PARALLELISM = 4

/**
 * Argon2id in @node-rs/argon2's `Algorithm` enum.
 *
 * Declared as a literal rather than imported: that enum is an ambient `const
 * enum`, which `verbatimModuleSyntax` cannot import. The variant is pinned
 * explicitly rather than relying on the library default, because which
 * algorithm hashes our passwords is not something to leave to a dependency's
 * default — and `credentials.test.ts` asserts every hash carries the
 * `$argon2id$` prefix, so a silent change breaks the build.
 */
const ARGON2ID = 2

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, {
      algorithm: ARGON2ID,
      memoryCost: MEMORY_COST,
      timeCost: TIME_COST,
      parallelism: PARALLELISM,
    })
  }

  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext)
    } catch {
      // A malformed hash must return false, never throw. Throwing here would
      // produce a 500 instead of a 401 and would let an attacker distinguish
      // "corrupt record" from "wrong password" by response code alone.
      return false
    }
  }

  /**
   * True when the stored hash used weaker parameters than we now require.
   *
   * Lets a password be transparently upgraded on the next successful login, so
   * hardening the parameters does not require a mass reset — the user never
   * notices. docs/11 §2.1
   */
  needsRehash(storedHash: string): boolean {
    const params = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash)
    if (!params) return true // not argon2id at all — definitely upgrade

    const [, m, t, p] = params
    return Number(m) < MEMORY_COST || Number(t) < TIME_COST || Number(p) < PARALLELISM
  }
}
