import type { Database } from '@buildflow/database'

/**
 * Seeds the global material category vocabulary.
 *
 * Idempotent by code, so it is safe to re-run after adding a category — the
 * same contract as the permission catalogue, and for the same reason: a
 * category added in a release must reach tenants provisioned before it.
 *
 * The waste factors are NOT invented. Each one is the figure the knowledge
 * base's estimation standards already use for that trade
 * (@buildflow/knowledge-base sql/08_estimation_standards.sql), so a quantity
 * estimated from the catalogue and one estimated from the KB formulas agree.
 * Two different numbers for tile waste is how a BOQ and a purchase order end
 * up disagreeing by a pallet.
 */

interface CategorySeed {
  code: string
  nameEn: string
  nameAr: string
  icon: string | null
  /** Percent. Matches the KB estimation standard for the same trade. */
  defaultWasteFactor: string
  sortOrder: number
  children?: readonly CategorySeed[]
}

const CATEGORIES: readonly CategorySeed[] = [
  {
    code: 'flooring',
    nameEn: 'Flooring',
    nameAr: 'الأرضيات',
    icon: 'flooring',
    // est_tile_count waste_pct = 10
    defaultWasteFactor: '10.00',
    sortOrder: 10,
    children: [
      // est_tile_count notes: 12–15% for large format, cutting loss dominates.
      {
        code: 'flooring_porcelain',
        nameEn: 'Porcelain',
        nameAr: 'بورسلان',
        icon: null,
        defaultWasteFactor: '12.00',
        sortOrder: 11,
      },
      {
        code: 'flooring_ceramic',
        nameEn: 'Ceramic',
        nameAr: 'سيراميك',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 12,
      },
      {
        code: 'flooring_stone',
        nameEn: 'Natural Stone',
        nameAr: 'حجر طبيعي',
        icon: null,
        defaultWasteFactor: '15.00',
        sortOrder: 13,
      },
      {
        code: 'flooring_vinyl',
        nameEn: 'Vinyl / SPC',
        nameAr: 'فينيل / SPC',
        icon: null,
        defaultWasteFactor: '8.00',
        sortOrder: 14,
      },
      {
        code: 'flooring_wood',
        nameEn: 'Wood',
        nameAr: 'خشب',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 15,
      },
      {
        code: 'flooring_skirting',
        nameEn: 'Skirting',
        nameAr: 'نعلات',
        icon: null,
        defaultWasteFactor: '8.00',
        sortOrder: 16,
      },
    ],
  },
  {
    code: 'paint',
    nameEn: 'Paint',
    nameAr: 'الدهانات',
    icon: 'painting',
    // est_paint_quantity waste_pct = 10
    defaultWasteFactor: '10.00',
    sortOrder: 20,
    children: [
      {
        code: 'paint_emulsion',
        nameEn: 'Emulsion',
        nameAr: 'بلاستيك',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 21,
      },
      {
        code: 'paint_enamel',
        nameEn: 'Enamel',
        nameAr: 'لاكيه',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 22,
      },
      // est_putty_quantity waste_pct = 12
      {
        code: 'paint_putty',
        nameEn: 'Putty & Primer',
        nameAr: 'معجون وبرايمر',
        icon: null,
        defaultWasteFactor: '12.00',
        sortOrder: 23,
      },
      // REC_EST_003: textured finishes consume 25–30% more than smooth.
      {
        code: 'paint_texture',
        nameEn: 'Decorative Texture',
        nameAr: 'دهانات ديكورية',
        icon: null,
        defaultWasteFactor: '15.00',
        sortOrder: 24,
      },
    ],
  },
  {
    code: 'ceiling',
    nameEn: 'Ceiling',
    nameAr: 'الأسقف',
    icon: 'gypsum',
    // est_gypsum_board waste_pct = 12
    defaultWasteFactor: '12.00',
    sortOrder: 30,
    children: [
      {
        code: 'ceiling_gypsum_board',
        nameEn: 'Gypsum Board',
        nameAr: 'ألواح جبس',
        icon: null,
        defaultWasteFactor: '12.00',
        sortOrder: 31,
      },
      {
        code: 'ceiling_framing',
        nameEn: 'Framing & Hangers',
        nameAr: 'هياكل وشدادات',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 32,
      },
      // est_joint_compound waste_pct = 12
      {
        code: 'ceiling_finishing',
        nameEn: 'Joint Compound & Tape',
        nameAr: 'معجون وشرائط',
        icon: null,
        defaultWasteFactor: '12.00',
        sortOrder: 33,
      },
      {
        code: 'ceiling_access',
        nameEn: 'Access Panels',
        nameAr: 'فتحات صيانة',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 34,
      },
    ],
  },
  {
    code: 'electrical',
    nameEn: 'Electrical',
    nameAr: 'الكهرباء',
    icon: 'electrical',
    // est_cable_* waste_pct = 15 — pull-back and offcuts.
    defaultWasteFactor: '15.00',
    sortOrder: 40,
    children: [
      {
        code: 'electrical_cable',
        nameEn: 'Cable',
        nameAr: 'كابلات',
        icon: null,
        defaultWasteFactor: '15.00',
        sortOrder: 41,
      },
      {
        code: 'electrical_conduit',
        nameEn: 'Conduit & Boxes',
        nameAr: 'مواسير وعلب',
        icon: null,
        defaultWasteFactor: '12.00',
        sortOrder: 42,
      },
      {
        code: 'electrical_accessories',
        nameEn: 'Switches & Sockets',
        nameAr: 'مفاتيح وأفياش',
        icon: null,
        defaultWasteFactor: '2.00',
        sortOrder: 43,
      },
      {
        code: 'electrical_distribution',
        nameEn: 'Distribution & Breakers',
        nameAr: 'لوحات وقواطع',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 44,
      },
    ],
  },
  {
    code: 'lighting',
    nameEn: 'Lighting',
    nameAr: 'الإنارة',
    icon: 'lighting',
    /**
     * Fixtures are counted, not cut, so the default is zero. A blanket
     * percentage here would quietly order spare chandeliers.
     */
    defaultWasteFactor: '0.00',
    sortOrder: 50,
    children: [
      {
        code: 'lighting_downlight',
        nameEn: 'Downlights',
        nameAr: 'سبوت لايت',
        icon: null,
        defaultWasteFactor: '2.00',
        sortOrder: 51,
      },
      // Strip is cut to length, so it does waste.
      {
        code: 'lighting_strip',
        nameEn: 'LED Strip & Drivers',
        nameAr: 'شرائط LED ومحولات',
        icon: null,
        defaultWasteFactor: '8.00',
        sortOrder: 52,
      },
      {
        code: 'lighting_decorative',
        nameEn: 'Decorative Fixtures',
        nameAr: 'وحدات ديكورية',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 53,
      },
    ],
  },
  {
    code: 'plumbing',
    nameEn: 'Plumbing',
    nameAr: 'السباكة',
    icon: 'plumbing',
    // est_supply_pipe / est_drain_pipe waste_pct = 12
    defaultWasteFactor: '12.00',
    sortOrder: 60,
    children: [
      {
        code: 'plumbing_pipe',
        nameEn: 'Pipe',
        nameAr: 'مواسير',
        icon: null,
        defaultWasteFactor: '12.00',
        sortOrder: 61,
      },
      {
        code: 'plumbing_fittings',
        nameEn: 'Fittings & Valves',
        nameAr: 'لوازم ومحابس',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 62,
      },
      // est_waterproofing waste_pct = 15
      {
        code: 'plumbing_waterproofing',
        nameEn: 'Waterproofing',
        nameAr: 'العزل المائي',
        icon: null,
        defaultWasteFactor: '15.00',
        sortOrder: 63,
      },
    ],
  },
  {
    code: 'sanitary',
    nameEn: 'Sanitary Ware',
    nameAr: 'الأدوات الصحية',
    icon: 'plumbing',
    defaultWasteFactor: '0.00',
    sortOrder: 70,
    children: [
      {
        code: 'sanitary_wc',
        nameEn: 'WC',
        nameAr: 'كراسي',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 71,
      },
      {
        code: 'sanitary_basin',
        nameEn: 'Basins',
        nameAr: 'مغاسل',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 72,
      },
      {
        code: 'sanitary_shower',
        nameEn: 'Showers & Baths',
        nameAr: 'دشات وبانيوهات',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 73,
      },
      {
        code: 'sanitary_mixer',
        nameEn: 'Mixers',
        nameAr: 'خلاطات',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 74,
      },
    ],
  },
  {
    code: 'doors',
    nameEn: 'Doors',
    nameAr: 'الأبواب',
    icon: 'carpentry',
    defaultWasteFactor: '0.00',
    sortOrder: 80,
    children: [
      {
        code: 'doors_leaf',
        nameEn: 'Door Leaves',
        nameAr: 'ضلف',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 81,
      },
      {
        code: 'doors_frame',
        nameEn: 'Frames',
        nameAr: 'حلوق',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 82,
      },
      {
        code: 'doors_hardware',
        nameEn: 'Hardware',
        nameAr: 'إكسسوارات',
        icon: null,
        defaultWasteFactor: '2.00',
        sortOrder: 83,
      },
    ],
  },
  {
    code: 'kitchens',
    nameEn: 'Kitchens',
    nameAr: 'المطابخ',
    icon: 'carpentry',
    defaultWasteFactor: '5.00',
    sortOrder: 90,
    children: [
      {
        code: 'kitchens_cabinet',
        nameEn: 'Cabinets',
        nameAr: 'خزائن',
        icon: null,
        defaultWasteFactor: '5.00',
        sortOrder: 91,
      },
      {
        code: 'kitchens_countertop',
        nameEn: 'Countertops',
        nameAr: 'أسطح',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 92,
      },
      {
        code: 'kitchens_appliance',
        nameEn: 'Appliances',
        nameAr: 'أجهزة',
        icon: null,
        defaultWasteFactor: '0.00',
        sortOrder: 93,
      },
    ],
  },
  {
    code: 'plastering',
    nameEn: 'Plastering',
    nameAr: 'البياض',
    icon: 'plastering',
    // est_plaster_volume waste_pct = 15 — droppings are unrecoverable.
    defaultWasteFactor: '15.00',
    sortOrder: 100,
    children: [
      {
        code: 'plastering_cement',
        nameEn: 'Cement & Sand',
        nameAr: 'أسمنت ورمل',
        icon: null,
        defaultWasteFactor: '15.00',
        sortOrder: 101,
      },
      {
        code: 'plastering_mesh',
        nameEn: 'Mesh & Beads',
        nameAr: 'شبك وزوايا',
        icon: null,
        defaultWasteFactor: '10.00',
        sortOrder: 102,
      },
    ],
  },
]

/** Returns the number of categories written. */
export async function seedMaterialCategories(
  db: Database,
  generateId: () => string,
): Promise<number> {
  let written = 0

  for (const parent of CATEGORIES) {
    const parentId = await upsert(db, generateId, parent, null)
    if (parentId.created) written++

    for (const child of parent.children ?? []) {
      const result = await upsert(db, generateId, child, parentId.id)
      if (result.created) written++
    }
  }
  return written
}

async function upsert(
  db: Database,
  generateId: () => string,
  seed: CategorySeed,
  parentId: string | null,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.materialCategory.findFirst({ where: { code: seed.code } })
  if (existing) return { id: existing.id, created: false }

  const id = generateId()
  await db.materialCategory.create({
    data: {
      id,
      parentId,
      code: seed.code,
      nameEn: seed.nameEn,
      nameAr: seed.nameAr,
      icon: seed.icon,
      defaultWasteFactor: seed.defaultWasteFactor,
      sortOrder: seed.sortOrder,
    },
  })
  return { id, created: true }
}
