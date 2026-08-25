import {
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type PackageId,
  type Result,
  AggregateRoot,
  err,
  exponentOf,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * FinishingPackage — a tier definition. docs/02 §3.6, docs/04 §2.6
 *
 * For each (room type, element): which material, which quantity rule, which
 * work item prices it. Applying one to a unit is what turns 14 rooms into 140
 * BOQ lines, each carrying its formula — the package is the RECIPE, the BOQ
 * is the meal.
 *
 * A version becomes IMMUTABLE on publication. docs/02 phrases the invariant as
 * "once applied to any unit"; publishing is the earlier and stricter line, and
 * it is the one a seller can rely on — a quotation citing "Premium v2" must
 * mean the same thing next month. New content is a new version, the same
 * discipline as rate cards and BOQs.
 */

export const PACKAGE_TIERS = ['economic', 'standard', 'premium', 'luxury', 'vip', 'custom'] as const
export type PackageTier = (typeof PACKAGE_TIERS)[number]

export type PackageStatus = 'draft' | 'published' | 'archived'

/**
 * The finish surfaces and fittings a package specifies. Mirrors
 * room_finish_specs.element so a specified room and a packaged room compare.
 */
export const PACKAGE_ELEMENTS = [
  'floor',
  'wall',
  'ceiling',
  'skirting',
  'door',
  'window',
  'sanitary',
  'kitchen',
  'lighting',
  'ironmongery',
] as const
export type PackageElement = (typeof PACKAGE_ELEMENTS)[number]

export interface PackageItem {
  id: string
  /** NULL = every room in the unit. */
  roomTypeCode: string | null
  element: PackageElement
  materialId: string | null
  specTextEn: string | null
  specTextAr: string | null
  /** The rule computing the quantity; null means fixedQuantity per room. */
  ruleCode: string | null
  /** Constants beyond room geometry: coats, coverage, tile size. */
  ruleInputs: Record<string, string> | null
  fixedQuantity: string | null
  workItemCode: string
  isOptional: boolean
  upgradePriceDelta: string | null
  sortOrder: number
}

export interface PackageSnapshot {
  id: PackageId
  companyId: CompanyId
  code: string
  versionNumber: number
  nameEn: string
  nameAr: string
  tier: PackageTier
  status: PackageStatus
  descriptionEn: string | null
  descriptionAr: string | null
  indicativePricePerSqm: string | null
  currency: string
  publishedAt: Date | null
  items: PackageItem[]
  version: number
}

export interface NewItemInput {
  roomTypeCode: string | null
  element: PackageElement
  materialId: string | null
  specTextEn: string | null
  specTextAr: string | null
  ruleCode: string | null
  ruleInputs: Record<string, string> | null
  fixedQuantity: string | null
  workItemCode: string
  isOptional: boolean
  upgradePriceDelta: string | null
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
const WORK_ITEM_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,4})?$/
const MAX_ITEMS = 400

export class FinishingPackage extends AggregateRoot<PackageId> {
  #status: PackageStatus
  #items: PackageItem[]
  #publishedAt: Date | null
  #indicativePricePerSqm: string | null

  private constructor(
    id: PackageId,
    readonly companyId: CompanyId,
    readonly code: string,
    readonly versionNumber: number,
    readonly nameEn: string,
    readonly nameAr: string,
    readonly tier: PackageTier,
    readonly descriptionEn: string | null,
    readonly descriptionAr: string | null,
    readonly currency: string,
    status: PackageStatus,
    items: PackageItem[],
    publishedAt: Date | null,
    indicativePricePerSqm: string | null,
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#items = items
    this.#publishedAt = publishedAt
    this.#indicativePricePerSqm = indicativePricePerSqm
  }

  static create(props: {
    id: PackageId
    companyId: CompanyId
    code: string
    versionNumber: number
    nameEn: string
    nameAr: string
    tier: PackageTier
    descriptionEn: string | null
    descriptionAr: string | null
    currency: string
    indicativePricePerSqm: string | null
  }): Result<FinishingPackage, DomainError> {
    if (!CODE_PATTERN.test(props.code)) {
      return err(
        validationError('PACKAGE_CODE_INVALID', 'Package codes are snake_case, 2–64 characters', {
          code: props.code,
        }),
      )
    }
    if (props.nameEn.trim().length === 0 || props.nameAr.trim().length === 0) {
      return err(
        validationError('PACKAGE_NAME_REQUIRED', 'A package needs both an English and Arabic name'),
      )
    }
    if (!Number.isInteger(exponentOf(props.currency as CurrencyCode))) {
      return err(
        validationError('INVALID_CURRENCY', `Unknown currency ${props.currency}`, {
          currency: props.currency,
        }),
      )
    }
    if (
      props.indicativePricePerSqm !== null &&
      !DECIMAL_PATTERN.test(props.indicativePricePerSqm)
    ) {
      return err(
        validationError('PACKAGE_PRICE_INVALID', 'The indicative price is a non-negative decimal', {
          indicativePricePerSqm: props.indicativePricePerSqm,
        }),
      )
    }

    return ok(
      new FinishingPackage(
        props.id,
        props.companyId,
        props.code,
        props.versionNumber,
        props.nameEn.trim(),
        props.nameAr.trim(),
        props.tier,
        props.descriptionEn,
        props.descriptionAr,
        props.currency,
        'draft',
        [],
        null,
        props.indicativePricePerSqm,
        0,
      ),
    )
  }

  static restore(snapshot: PackageSnapshot): FinishingPackage {
    return new FinishingPackage(
      snapshot.id,
      snapshot.companyId,
      snapshot.code,
      snapshot.versionNumber,
      snapshot.nameEn,
      snapshot.nameAr,
      snapshot.tier,
      snapshot.descriptionEn,
      snapshot.descriptionAr,
      snapshot.currency,
      snapshot.status,
      snapshot.items,
      snapshot.publishedAt,
      snapshot.indicativePricePerSqm,
      snapshot.version,
    )
  }

  get status(): PackageStatus {
    return this.#status
  }
  get items(): readonly PackageItem[] {
    return this.#items
  }

  /**
   * Replaces the item set — whole or not at all, and only while DRAFT. Once
   * published the package has possibly been quoted, and its content is a
   * promise rather than a setting.
   */
  replaceItems(
    items: readonly NewItemInput[],
    isRoomType: (code: string) => boolean,
    generateId: () => string,
  ): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError(
          'PACKAGE_NOT_DRAFT',
          'A published package is a promise — publish changes as a new version',
          { status: this.#status },
        ),
      )
    }
    if (items.length > MAX_ITEMS) {
      return err(validationError('PACKAGE_TOO_MANY_ITEMS', `At most ${String(MAX_ITEMS)} items`))
    }

    const seen = new Set<string>()
    const next: PackageItem[] = []
    for (const [index, item] of items.entries()) {
      if (item.roomTypeCode !== null && !isRoomType(item.roomTypeCode)) {
        return err(
          validationError('PACKAGE_ROOM_TYPE_UNKNOWN', `Unknown room type ${item.roomTypeCode}`, {
            roomTypeCode: item.roomTypeCode,
          }),
        )
      }
      // One specification per (room type, element): two floor finishes for the
      // same room type is not a richer package, it is an unanswerable question.
      const key = `${item.roomTypeCode ?? '*'}|${item.element}`
      if (seen.has(key)) {
        return err(
          validationError(
            'PACKAGE_ITEM_DUPLICATE',
            `Two specifications for ${item.element} in ${item.roomTypeCode ?? 'every room'}`,
            { element: item.element, roomTypeCode: item.roomTypeCode ?? '*' },
          ),
        )
      }
      seen.add(key)

      if (!WORK_ITEM_PATTERN.test(item.workItemCode)) {
        return err(
          validationError('PACKAGE_WORK_ITEM_INVALID', 'Work item codes are snake_case', {
            workItemCode: item.workItemCode,
          }),
        )
      }
      // A quantity comes from a rule or from a fixed count — exactly one, or
      // generation has to guess, and a guessed quantity is the whole problem
      // the rule engine exists to solve.
      const hasRule = item.ruleCode !== null
      const hasFixed = item.fixedQuantity !== null
      if (hasRule === hasFixed) {
        return err(
          validationError(
            'PACKAGE_ITEM_QUANTITY_AMBIGUOUS',
            'An item takes a rule code or a fixed quantity — exactly one',
            { element: item.element, roomTypeCode: item.roomTypeCode ?? '*' },
          ),
        )
      }
      if (
        hasFixed &&
        (!DECIMAL_PATTERN.test(item.fixedQuantity ?? '') || Number(item.fixedQuantity) <= 0)
      ) {
        return err(
          validationError('PACKAGE_FIXED_QUANTITY_INVALID', 'A fixed quantity must be positive', {
            element: item.element,
          }),
        )
      }
      if (item.upgradePriceDelta !== null && !DECIMAL_PATTERN.test(item.upgradePriceDelta)) {
        return err(
          validationError('PACKAGE_UPGRADE_DELTA_INVALID', 'The upgrade delta is a decimal', {
            element: item.element,
          }),
        )
      }

      next.push({ id: generateId(), ...item, sortOrder: index })
    }

    this.#items = next
    return ok(undefined)
  }

  /** Freezes the content. From here on it is a promise, not a setting. */
  publish(at: Date): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError('PACKAGE_NOT_DRAFT', 'Only a draft publishes', { status: this.#status }),
      )
    }
    if (this.#items.length === 0) {
      return err(validationError('PACKAGE_NEEDS_ITEMS', 'An empty package specifies nothing', {}))
    }
    this.#status = 'published'
    this.#publishedAt = at
    return ok(undefined)
  }

  /**
   * Retires the package from selection. It stays readable forever — the BOQs
   * generated from it still cite this version, and a quotation must remain
   * explicable years later.
   */
  archive(): Result<void, DomainError> {
    if (this.#status === 'archived') {
      return err(validationError('PACKAGE_ARCHIVED', 'Already archived', {}))
    }
    this.#status = 'archived'
    return ok(undefined)
  }

  /**
   * The next version: a fresh DRAFT copying this version's items with new
   * identities. This version is untouched — packages accumulate history rather
   * than replacing it.
   */
  nextVersion(id: PackageId, generateId: () => string): Result<FinishingPackage, DomainError> {
    if (this.#status === 'draft') {
      return err(
        validationError(
          'PACKAGE_VERSION_FROM_DRAFT',
          'A draft just edits — version a published or archived package',
          { status: this.#status },
        ),
      )
    }
    return ok(
      new FinishingPackage(
        id,
        this.companyId,
        this.code,
        this.versionNumber + 1,
        this.nameEn,
        this.nameAr,
        this.tier,
        this.descriptionEn,
        this.descriptionAr,
        this.currency,
        'draft',
        this.#items.map((item) => ({
          ...item,
          id: generateId(),
          ruleInputs: item.ruleInputs ? { ...item.ruleInputs } : null,
        })),
        null,
        this.#indicativePricePerSqm,
        0,
      ),
    )
  }

  toSnapshot(): PackageSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      code: this.code,
      versionNumber: this.versionNumber,
      nameEn: this.nameEn,
      nameAr: this.nameAr,
      tier: this.tier,
      status: this.#status,
      descriptionEn: this.descriptionEn,
      descriptionAr: this.descriptionAr,
      indicativePricePerSqm: this.#indicativePricePerSqm,
      currency: this.currency,
      publishedAt: this.#publishedAt,
      items: this.#items.map((item) => ({
        ...item,
        ruleInputs: item.ruleInputs ? { ...item.ruleInputs } : null,
      })),
      version: this.version,
    }
  }
}
