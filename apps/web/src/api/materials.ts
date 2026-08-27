import { request, type ApiResult } from './client'

/**
 * The catalogue, as the 3D viewer needs it. docs/08 §8.3
 *
 * One endpoint, one projection. The viewer prices a finish from the material's
 * OWN default cost rather than from a rate card: a rate card is resolved by a
 * BOQ's pricing date and carries labour and equipment alongside the material,
 * which is right for a quotation and wrong for "what would this tile do to the
 * number". The delta is a material-cost comparison, and it says so.
 */
export interface MaterialRow {
  id: string
  sku: string
  nameEn: string
  nameAr: string
  categoryId: string
  categoryCode: string
  brandName: string | null
  baseUom: string
  /** 4 dp, or null for a material nobody has costed yet. */
  defaultCost: string | null
  currency: string | null
  /** 2 dp, already falling back to the category's default. */
  effectiveWasteFactor: string
  isActive: boolean
}

export async function fetchMaterials(search?: string): Promise<ApiResult<MaterialRow[]>> {
  const query = search ? `?search=${encodeURIComponent(search)}` : ''
  const result = await request<{ data: MaterialRow[] }>(`/materials${query}`)
  return result.ok ? { ok: true, data: result.data.data } : result
}
