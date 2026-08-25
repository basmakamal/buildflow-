import { describe, expect, it } from 'vitest'
import type { CompanyId, PackageId } from '@buildflow/core'
import { FinishingPackage, type NewItemInput } from '../src/domain/finishing-package'
import { planLines, roomInputs, type RoomFacts } from '../src/domain/package-generation'

/**
 * The package is the recipe: one specification per (room type, element), a
 * quantity from a rule OR a fixed count but never both, frozen on publication.
 * The planner is what turns it into work: which rooms, with which inputs.
 */

const AT = new Date('2026-08-25T08:00:00Z')
let counter = 0
const nextId = () => `id-${String(++counter)}`
const isRoomType = (code: string) =>
  ['bedroom', 'master_bedroom', 'bathroom', 'kitchen', 'living_room'].includes(code)

const ITEM: NewItemInput = {
  roomTypeCode: null,
  element: 'wall',
  materialId: null,
  specTextEn: 'Matt emulsion, off-white',
  specTextAr: 'دهان مطفي، أبيض مكسور',
  ruleCode: 'est_paint_wall_area',
  ruleInputs: null,
  fixedQuantity: null,
  workItemCode: 'wk_paint_walls',
  isOptional: false,
  upgradePriceDelta: null,
}

const create = (over: Partial<Parameters<typeof FinishingPackage.create>[0]> = {}) =>
  FinishingPackage.create({
    id: 'pkg-1' as PackageId,
    companyId: 'co-1' as CompanyId,
    code: 'premium',
    versionNumber: 1,
    nameEn: 'Premium',
    nameAr: 'بريميوم',
    tier: 'premium',
    descriptionEn: null,
    descriptionAr: null,
    currency: 'SAR',
    indicativePricePerSqm: '1450',
    ...over,
  })

const pkg = (over: Partial<Parameters<typeof FinishingPackage.create>[0]> = {}) => {
  const result = create(over)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

const room = (over: Partial<RoomFacts> = {}): RoomFacts => ({
  id: 'room-1',
  typeCode: 'bedroom',
  nameEn: 'Bedroom 1',
  floorArea: '20.0000',
  wallArea: '48.0000',
  ceilingArea: '20.0000',
  perimeter: '18.0000',
  heightMm: 3000,
  ...over,
})

describe('definition', () => {
  it('starts as an empty draft and refuses a malformed code or currency', () => {
    expect(pkg().status).toBe('draft')
    expect(create({ code: 'Premium Tier!' }).isErr()).toBe(true)
    expect(create({ currency: 'XXX' }).isErr()).toBe(true)
    expect(create({ nameAr: '  ' }).isErr()).toBe(true)
  })

  it('takes one specification per (room type, element)', () => {
    const draft = pkg()
    expect(draft.replaceItems([ITEM], isRoomType, nextId).isOk()).toBe(true)

    const duplicate = draft.replaceItems([ITEM, { ...ITEM }], isRoomType, nextId)
    expect(duplicate.isErr()).toBe(true)
    if (duplicate.isErr()) expect(duplicate.error.code).toBe('PACKAGE_ITEM_DUPLICATE')

    // The same element in a DIFFERENT room type is a different specification.
    const scoped = draft.replaceItems(
      [ITEM, { ...ITEM, roomTypeCode: 'bathroom' }],
      isRoomType,
      nextId,
    )
    expect(scoped.isOk()).toBe(true)
  })

  it('demands a rule or a fixed quantity — exactly one', () => {
    const draft = pkg()

    const neither = draft.replaceItems(
      [{ ...ITEM, ruleCode: null, fixedQuantity: null }],
      isRoomType,
      nextId,
    )
    expect(neither.isErr()).toBe(true)
    if (neither.isErr()) expect(neither.error.code).toBe('PACKAGE_ITEM_QUANTITY_AMBIGUOUS')

    const both = draft.replaceItems([{ ...ITEM, fixedQuantity: '1' }], isRoomType, nextId)
    expect(both.isErr()).toBe(true)

    const fixedOnly = draft.replaceItems(
      [{ ...ITEM, element: 'sanitary', ruleCode: null, fixedQuantity: '1' }],
      isRoomType,
      nextId,
    )
    expect(fixedOnly.isOk()).toBe(true)
  })

  it('refuses an unknown room type', () => {
    const result = pkg().replaceItems([{ ...ITEM, roomTypeCode: 'dungeon' }], isRoomType, nextId)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PACKAGE_ROOM_TYPE_UNKNOWN')
  })
})

describe('versioning', () => {
  it('freezes content on publication — a promise, not a setting', () => {
    const published = pkg()
    expect(published.replaceItems([ITEM], isRoomType, nextId).isOk()).toBe(true)
    expect(published.publish(AT).isOk()).toBe(true)
    expect(published.status).toBe('published')

    const edit = published.replaceItems([{ ...ITEM, workItemCode: 'wk_other' }], isRoomType, nextId)
    expect(edit.isErr()).toBe(true)
    if (edit.isErr()) expect(edit.error.code).toBe('PACKAGE_NOT_DRAFT')
  })

  it('an empty package specifies nothing and cannot publish', () => {
    const result = pkg().publish(AT)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PACKAGE_NEEDS_ITEMS')
  })

  it('the next version copies the items as a fresh draft, leaving this one alone', () => {
    const published = pkg()
    published.replaceItems([ITEM], isRoomType, nextId)
    published.publish(AT)

    const next = published.nextVersion('pkg-2' as PackageId, nextId)
    expect(next.isOk()).toBe(true)
    if (!next.isOk()) return

    expect(next.value.versionNumber).toBe(2)
    expect(next.value.status).toBe('draft')
    expect(next.value.items).toHaveLength(1)
    expect(next.value.items[0]!.id).not.toBe(published.items[0]!.id)
    expect(published.status).toBe('published')
  })

  it('a draft does not version — it just edits', () => {
    const result = pkg().nextVersion('pkg-2' as PackageId, nextId)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PACKAGE_VERSION_FROM_DRAFT')
  })

  it('archiving retires it from selection but keeps it readable', () => {
    const archived = pkg()
    archived.replaceItems([ITEM], isRoomType, nextId)
    archived.publish(AT)
    expect(archived.archive().isOk()).toBe(true)
    expect(archived.archive().isErr()).toBe(true)
    expect(archived.toSnapshot().items).toHaveLength(1)
  })
})

describe('the planner', () => {
  it('feeds the element its own surface under the generic name', () => {
    const facts = room()
    expect(roomInputs(facts, 'floor')['area_m2']).toBe('20.0000')
    expect(roomInputs(facts, 'wall')['area_m2']).toBe('48.0000')
    expect(roomInputs(facts, 'ceiling')['area_m2']).toBe('20.0000')
    // Count-based elements get no generic surface — they carry their own basis.
    expect(roomInputs(facts, 'sanitary')['area_m2']).toBeUndefined()
    // Every specific fact is always available, plus height in METRES.
    expect(roomInputs(facts, 'floor')).toMatchObject({
      floor_area_m2: '20.0000',
      wall_area_m2: '48.0000',
      perimeter_m: '18.0000',
      height_m: '3.0000',
      openings_m2: '0',
    })
  })

  it('matches an untyped item to every room and a typed one to its own', () => {
    const rooms = [
      room({ id: 'r1', typeCode: 'bedroom' }),
      room({ id: 'r2', typeCode: 'bathroom' }),
      room({ id: 'r3', typeCode: 'bedroom' }),
    ]
    const draft = pkg()
    draft.replaceItems(
      [
        ITEM,
        { ...ITEM, element: 'floor', roomTypeCode: 'bathroom', workItemCode: 'wk_wall_ceramic' },
      ],
      (code) => ['bedroom', 'bathroom'].includes(code),
      nextId,
    )

    const plans = planLines(draft.items, rooms, { includeOptional: false })
    // Wall item → all three rooms; bathroom floor item → one room.
    expect(plans).toHaveLength(4)
    expect(plans.filter((plan) => plan.item.element === 'wall')).toHaveLength(3)
    const bathroom = plans.filter((plan) => plan.item.element === 'floor')
    expect(bathroom).toHaveLength(1)
    expect(bathroom[0]!.room.id).toBe('r2')
  })

  it('layers the item constants over geometry — an authored value wins', () => {
    const draft = pkg()
    draft.replaceItems(
      [{ ...ITEM, element: 'ceiling', ruleInputs: { area_m2: '15', coats: '2' } }],
      isRoomType,
      nextId,
    )
    const plans = planLines(draft.items, [room()], { includeOptional: false })
    // A dropped ceiling smaller than the floor, stated deliberately.
    expect(plans[0]!.inputs['area_m2']).toBe('15')
    expect(plans[0]!.inputs['coats']).toBe('2')
    expect(plans[0]!.inputs['perimeter_m']).toBe('18.0000')
  })

  it('leaves optional items out unless asked for', () => {
    const draft = pkg()
    draft.replaceItems([{ ...ITEM, isOptional: true }], isRoomType, nextId)
    expect(planLines(draft.items, [room()], { includeOptional: false })).toHaveLength(0)
    expect(planLines(draft.items, [room()], { includeOptional: true })).toHaveLength(1)
  })
})
