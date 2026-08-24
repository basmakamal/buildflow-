import {
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type RateCardId,
  type Result,
  type UnitOfMeasure,
  AggregateRoot,
  err,
  exponentOf,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * Rate card — effective-dated pricing. docs/02 §3.7, docs/04 §2.7
 *
 * The invariant everything hangs on: rates are resolved by the BOQ's
 * PRICING DATE, never by "now". That is only honest if an ACTIVE card's items
 * are immutable — so items are editable in draft, frozen on activation, and a
 * price change is a NEW card with a new effective window. Editing rates on a
 * card that priced last month's BOQ would silently restate a signed document.
 *
 * draft → active → archived. Archived cards stay readable forever: the BOQs
 * that priced from them still reference them.
 */

export type RateCardStatus = 'draft' | 'active' | 'archived'

export interface RateItem {
  id: string
  materialId: string | null
  workItemCode: string
  descriptionEn: string
  descriptionAr: string
  uom: UnitOfMeasure
  /** 4 dp decimal strings — per-uom rates in the card's currency. */
  materialRate: string
  labourRate: string
  equipmentRate: string
  /** Output per crew-day, for duration estimates. Null = not measured. */
  productivityPerDay: string | null
}

export interface RateCardSnapshot {
  id: RateCardId
  companyId: CompanyId
  name: string
  countryCode: string
  city: string | null
  currency: string
  effectiveFrom: Date
  effectiveTo: Date | null
  isDefault: boolean
  status: RateCardStatus
  items: RateItem[]
  version: number
}

const RATE_PATTERN = /^\d{1,14}(\.\d{1,4})?$/
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
const MAX_ITEMS = 500

export class RateCard extends AggregateRoot<RateCardId> {
  #status: RateCardStatus
  #items: RateItem[]

  private constructor(
    id: RateCardId,
    readonly companyId: CompanyId,
    readonly name: string,
    readonly countryCode: string,
    readonly city: string | null,
    readonly currency: string,
    readonly effectiveFrom: Date,
    readonly effectiveTo: Date | null,
    readonly isDefault: boolean,
    status: RateCardStatus,
    items: RateItem[],
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#items = items
  }

  static create(props: {
    id: RateCardId
    companyId: CompanyId
    name: string
    countryCode: string
    city: string | null
    currency: string
    effectiveFrom: Date
    effectiveTo: Date | null
    isDefault: boolean
  }): Result<RateCard, DomainError> {
    const name = props.name.trim()
    if (name.length === 0) {
      return err(validationError('RATE_CARD_NAME_REQUIRED', 'A rate card needs a name'))
    }
    if (!/^[A-Z]{2}$/.test(props.countryCode)) {
      return err(
        validationError('RATE_CARD_COUNTRY_INVALID', 'Country is a 2-letter ISO code', {
          countryCode: props.countryCode,
        }),
      )
    }
    if (!Number.isInteger(exponentOf(props.currency as CurrencyCode))) {
      return err(
        validationError('INVALID_CURRENCY', `Unknown currency ${props.currency}`, {
          currency: props.currency,
        }),
      )
    }
    // An inverted window can never cover a date — it is a typo to refuse, not
    // a card to store. Same-day from/to is a legitimate one-day card.
    if (props.effectiveTo && props.effectiveTo < props.effectiveFrom) {
      return err(
        validationError('RATE_CARD_DATES_INVERTED', 'effectiveTo is before effectiveFrom', {}),
      )
    }

    return ok(
      new RateCard(
        props.id,
        props.companyId,
        name,
        props.countryCode,
        props.city,
        props.currency,
        props.effectiveFrom,
        props.effectiveTo,
        props.isDefault,
        'draft',
        [],
        0,
      ),
    )
  }

  static restore(snapshot: RateCardSnapshot): RateCard {
    return new RateCard(
      snapshot.id,
      snapshot.companyId,
      snapshot.name,
      snapshot.countryCode,
      snapshot.city,
      snapshot.currency,
      snapshot.effectiveFrom,
      snapshot.effectiveTo,
      snapshot.isDefault,
      snapshot.status,
      snapshot.items,
      snapshot.version,
    )
  }

  get status(): RateCardStatus {
    return this.#status
  }
  get items(): readonly RateItem[] {
    return this.#items
  }

  /**
   * Replaces the item set — a value-object SET, whole or not at all, and only
   * while DRAFT. Once active the card has possibly priced a BOQ, and its
   * numbers are history, not settings.
   */
  replaceItems(
    items: readonly {
      materialId: string | null
      workItemCode: string
      descriptionEn: string
      descriptionAr: string
      uom: UnitOfMeasure
      materialRate: string
      labourRate: string
      equipmentRate: string
      productivityPerDay: string | null
    }[],
    generateId: () => string,
  ): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError(
          'RATE_CARD_NOT_DRAFT',
          'An active card is history — publish new rates as a new card',
          { status: this.#status },
        ),
      )
    }
    if (items.length > MAX_ITEMS) {
      return err(validationError('RATE_CARD_TOO_MANY_ITEMS', `At most ${String(MAX_ITEMS)} items`))
    }

    const seen = new Set<string>()
    const next: RateItem[] = []
    for (const item of items) {
      if (!CODE_PATTERN.test(item.workItemCode)) {
        return err(
          validationError(
            'RATE_ITEM_CODE_INVALID',
            'Work item codes are snake_case, 2–64 characters',
            { workItemCode: item.workItemCode },
          ),
        )
      }
      if (seen.has(item.workItemCode)) {
        return err(
          validationError('RATE_ITEM_DUPLICATE', 'Each work item appears once per card', {
            workItemCode: item.workItemCode,
          }),
        )
      }
      seen.add(item.workItemCode)

      for (const [label, rate] of [
        ['materialRate', item.materialRate],
        ['labourRate', item.labourRate],
        ['equipmentRate', item.equipmentRate],
      ] as const) {
        if (!RATE_PATTERN.test(rate)) {
          return err(
            validationError('RATE_ITEM_RATE_INVALID', 'Rates are non-negative decimals, 4 dp', {
              workItemCode: item.workItemCode,
              field: label,
              value: rate,
            }),
          )
        }
      }
      // An all-zero line prices work as free — always a mistake, never a rate.
      if (
        Number(item.materialRate) === 0 &&
        Number(item.labourRate) === 0 &&
        Number(item.equipmentRate) === 0
      ) {
        return err(
          validationError('RATE_ITEM_ZERO', 'A work item needs at least one non-zero rate', {
            workItemCode: item.workItemCode,
          }),
        )
      }
      if (
        item.productivityPerDay !== null &&
        (!RATE_PATTERN.test(item.productivityPerDay) || Number(item.productivityPerDay) <= 0)
      ) {
        return err(
          validationError('RATE_ITEM_PRODUCTIVITY_INVALID', 'Productivity must be positive', {
            workItemCode: item.workItemCode,
          }),
        )
      }

      next.push({ id: generateId(), ...item })
    }

    this.#items = next
    return ok(undefined)
  }

  /** Freezes the card. From here on, its numbers are history. */
  activate(): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError('RATE_CARD_NOT_DRAFT', 'Only a draft can activate', {
          status: this.#status,
        }),
      )
    }
    if (this.#items.length === 0) {
      return err(validationError('RATE_CARD_NEEDS_ITEMS', 'An empty rate card prices nothing', {}))
    }
    this.#status = 'active'
    return ok(undefined)
  }

  /** Retires the card from resolution. It stays readable — BOQs reference it. */
  archive(): Result<void, DomainError> {
    if (this.#status === 'archived') {
      return err(validationError('RATE_CARD_ARCHIVED', 'Already archived', {}))
    }
    this.#status = 'archived'
    return ok(undefined)
  }

  toSnapshot(): RateCardSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      name: this.name,
      countryCode: this.countryCode,
      city: this.city,
      currency: this.currency,
      effectiveFrom: this.effectiveFrom,
      effectiveTo: this.effectiveTo,
      isDefault: this.isDefault,
      status: this.#status,
      items: [...this.#items],
      version: this.version,
    }
  }
}

export interface ResolvableCard {
  status: RateCardStatus
  effectiveFrom: Date
  effectiveTo: Date | null
  city: string | null
  isDefault: boolean
  name: string
}

/** Whether an active card's window covers the pricing date. Boundary-inclusive. */
export function coversDate(card: ResolvableCard, pricingDate: Date): boolean {
  if (card.status !== 'active') return false
  if (pricingDate < card.effectiveFrom) return false
  return card.effectiveTo === null || pricingDate <= card.effectiveTo
}

/**
 * Resolves THE card for a pricing date — deterministically, because two
 * people pricing the same unit on the same date must get the same answer.
 * Precedence: exact city match beats country-wide, then the tenant's default,
 * then the most recently effective window, then name as the final tiebreak.
 */
export function pickRateCard<T extends ResolvableCard>(
  cards: readonly T[],
  pricingDate: Date,
  city: string | null,
): T | null {
  const candidates = cards.filter((card) => coversDate(card, pricingDate))
  if (candidates.length === 0) return null

  const wanted = city?.trim().toLowerCase() ?? null
  const ranked = [...candidates].sort((a, b) => {
    const cityA = wanted !== null && a.city?.toLowerCase() === wanted ? 1 : 0
    const cityB = wanted !== null && b.city?.toLowerCase() === wanted ? 1 : 0
    if (cityA !== cityB) return cityB - cityA
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    if (a.effectiveFrom.getTime() !== b.effectiveFrom.getTime()) {
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
    }
    return a.name.localeCompare(b.name)
  })
  return ranked[0] ?? null
}
