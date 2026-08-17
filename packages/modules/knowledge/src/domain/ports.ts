import type { Rule } from './rule'

/**
 * Ports the knowledge module depends on.
 *
 * Declared in the domain so the application layer can be tested with in-memory
 * doubles and no database — the analyze handler's behaviour is a pure function
 * of the rules it is handed. docs/06 §1
 */

export interface RuleReader {
  /**
   * Rules visible to a tenant: its own overrides plus the system rules shipped
   * with the product, with the tenant's version winning on a code collision.
   * Inactive rules are excluded by the implementation.
   */
  activeForCompany(): Promise<readonly Rule[]>
}

export interface FactCatalogue {
  /** Fact codes the engine understands, used to reject unknown supplied facts. */
  knownFactCodes(): Promise<ReadonlySet<string>>
}
