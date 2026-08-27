<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mmToMetres, squareMmToSquareMetres } from '@buildflow/spatial'
import { finishDelta, type FinishSpec, type RoomSurfaces } from '@buildflow/estimation/pricing'
import { fetchMaterials, type MaterialRow } from '@/api/materials'
import type { DrawnSurface } from './scene-builder'
import { usePlannerStore } from '@/stores/planner'

/**
 * Finish switching, priced live. docs/08 §8.3, docs/16 Phase 5 sprint 10
 *
 * "The 3D viewer is a pricing interface wearing a visualisation costume." A
 * client choosing marble over porcelain is making a purchase decision, so the
 * cost of that decision belongs on screen WHILE they are looking at the room —
 * not in a revised quotation next week.
 *
 * The comparison is material cost against material cost, over the same rooms.
 * It is deliberately NOT a re-quote: a rate card carries labour and equipment
 * and is resolved by a BOQ's pricing date, which is the right answer to a
 * different question and takes a round trip to compute.
 */

const { t, locale } = useI18n()
const store = usePlannerStore()

const emit = defineEmits<{ (event: 'apply', surface: DrawnSurface, colour: number): void }>()

const SURFACES: DrawnSurface[] = ['floor', 'wall', 'ceiling']

const materials = ref<MaterialRow[]>([])
const loading = ref(false)
const surface = ref<DrawnSurface>('floor')
/** The finish each surface currently carries, as the baseline to price against. */
const current = ref<Partial<Record<DrawnSurface, string>>>({})
const candidateId = ref('')

onMounted(async () => {
  loading.value = true
  const result = await fetchMaterials()
  if (result.ok) materials.value = result.data.filter((row) => row.defaultCost !== null)
  loading.value = false
})

/**
 * A colour for a material that has none.
 *
 * The catalogue stores cost and units, not appearance — textures arrive with
 * the media pipeline in docs/13. Hashing the SKU gives every material a
 * STABLE colour, so a tile looks the same on every reload and two materials
 * are told apart, which is what the swatch is for. It is a placeholder that
 * behaves, not a guess at what the product looks like.
 */
function colourOf(material: MaterialRow): number {
  let hash = 0
  for (const character of material.sku) hash = (hash * 31 + character.charCodeAt(0)) % 360

  const hue = hash / 360
  const light = 0.62
  const saturation = 0.22
  const toChannel = (offset: number) => {
    const value = Math.abs(((hue * 6 + offset) % 6) - 3) - 1
    const clamped = Math.max(0, Math.min(1, value))
    const channel = light + saturation * (clamped - 0.5) * 2
    return Math.round(Math.max(0, Math.min(1, channel)) * 255)
  }
  return (toChannel(0) << 16) | (toChannel(4) << 8) | toChannel(2)
}

const byId = computed(() => new Map(materials.value.map((row) => [row.id, row])))

const specOf = (material: MaterialRow | undefined): FinishSpec | null =>
  material?.defaultCost
    ? {
        materialId: material.id,
        name: locale.value === 'ar' ? material.nameAr : material.nameEn,
        rate: material.defaultCost,
        wasteFactor: material.effectiveWasteFactor,
      }
    : null

/**
 * The rooms, in the units a rate is quoted in.
 *
 * Metres and square metres, converted from the plan's integer millimetres at
 * this single boundary — the same one docs/18 ADR-016 draws everywhere else.
 */
const rooms = computed<RoomSurfaces[]>(() =>
  store.rooms.map((room) => {
    const metrics = store.metricsFor(room.id)
    return {
      roomId: room.id,
      name: room.name || t('viewer.unnamedRoom'),
      floorAreaM2: squareMmToSquareMetres(metrics?.floorAreaMm2 ?? 0),
      wallAreaM2: squareMmToSquareMetres(metrics?.wallAreaMm2 ?? 0),
      ceilingAreaM2: squareMmToSquareMetres(metrics?.ceilingAreaMm2 ?? 0),
      skirtingM: mmToMetres(metrics?.skirtingLengthMm ?? 0),
    }
  }),
)

/** A finish nobody has chosen yet costs nothing — the honest baseline. */
const BARE: FinishSpec = { materialId: '', name: '', rate: '0.0000', wasteFactor: '0' }

const delta = computed(() => {
  const candidate = specOf(byId.value.get(candidateId.value))
  if (!candidate || rooms.value.length === 0) return null

  const baselineId = current.value[surface.value]
  const baseline = baselineId ? specOf(byId.value.get(baselineId)) : null
  const currency = byId.value.get(candidateId.value)?.currency ?? 'SAR'

  const result = finishDelta(rooms.value, surface.value, baseline ?? BARE, candidate, currency)
  return result.isOk() ? result.value : null
})

function apply() {
  const material = byId.value.get(candidateId.value)
  if (!material) return

  current.value = { ...current.value, [surface.value]: material.id }
  // Only the material changes. docs/08 §8.3 — no geometry rebuild, repainted
  // on the next frame.
  emit('apply', surface.value, colourOf(material))
}

const money = (amount: { toDecimal: () => string; currency: string }) =>
  `${amount.toDecimal()} ${amount.currency}`
</script>

<template>
  <aside class="finishes" :aria-label="t('viewer.finishes')">
    <h2 class="finishes__title">{{ t('viewer.finishes') }}</h2>

    <div class="finishes__group" role="group" :aria-label="t('viewer.surface')">
      <button
        v-for="option in SURFACES"
        :key="option"
        type="button"
        class="finishes__tab"
        :class="{ 'finishes__tab--active': surface === option }"
        :aria-pressed="surface === option"
        @click="surface = option"
      >
        {{ t(`viewer.surfaceName.${option}`) }}
      </button>
    </div>

    <p v-if="loading" class="finishes__note">{{ t('viewer.loadingMaterials') }}</p>
    <p v-else-if="materials.length === 0" class="finishes__note">{{ t('viewer.noMaterials') }}</p>

    <template v-else>
      <label class="finishes__field">
        <span class="finishes__label">{{ t('viewer.material') }}</span>
        <select v-model="candidateId" class="finishes__select">
          <option value="">{{ t('viewer.pickMaterial') }}</option>
          <option v-for="material in materials" :key="material.id" :value="material.id">
            {{ locale === 'ar' ? material.nameAr : material.nameEn }} — {{ material.defaultCost }}
          </option>
        </select>
      </label>

      <div v-if="delta" class="finishes__delta">
        <p class="finishes__row">
          <span>{{ t('viewer.currentCost') }}</span>
          <span>{{ money(delta.before.total) }}</span>
        </p>
        <p class="finishes__row">
          <span>{{ t('viewer.newCost') }}</span>
          <span>{{ money(delta.after.total) }}</span>
        </p>
        <p
          class="finishes__row finishes__row--total"
          :class="{ 'finishes__row--saving': delta.delta.isNegative() }"
        >
          <span>{{ t('viewer.difference') }}</span>
          <span>
            {{ money(delta.delta) }}
            <template v-if="delta.percent">({{ delta.percent }}%)</template>
          </span>
        </p>
        <p class="finishes__note">
          {{ t('viewer.acrossRooms', { count: delta.after.lines.length }) }}
        </p>
      </div>

      <button type="button" class="finishes__apply" :disabled="!delta" @click="apply">
        {{ t('viewer.applyFinish') }}
      </button>

      <p class="finishes__note finishes__note--quiet">{{ t('viewer.materialCostOnly') }}</p>
    </template>
  </aside>
</template>

<style scoped>
.finishes {
  position: absolute;
  inset-block-start: 3.5rem;
  inset-inline-end: 1rem;
  inline-size: 17rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgb(15 23 42 / 92%);
  color: #e2e8f0;
  font-size: 0.8125rem;
}

.finishes__title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
}

.finishes__group {
  display: flex;
  gap: 0.25rem;
  margin-block-end: 0.5rem;
}

.finishes__tab,
.finishes__apply {
  padding: 0.3rem 0.6rem;
  border: 1px solid rgb(148 163 184 / 40%);
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.finishes__tab--active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.finishes__field {
  display: block;
  margin-block-end: 0.5rem;
}

.finishes__label {
  display: block;
  margin-block-end: 0.2rem;
  color: #94a3b8;
}

.finishes__select {
  inline-size: 100%;
  padding: 0.3rem;
  border: 1px solid rgb(148 163 184 / 40%);
  border-radius: 0.375rem;
  background: #0f172a;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
}

.finishes__delta {
  margin-block: 0.5rem;
  padding-block: 0.4rem;
  border-block: 1px solid rgb(148 163 184 / 25%);
}

.finishes__row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0.15rem 0;
  font-variant-numeric: tabular-nums;
}

.finishes__row--total {
  font-weight: 600;
  color: #fca5a5;
}

.finishes__row--saving {
  color: #86efac;
}

.finishes__apply {
  inline-size: 100%;
  margin-block-start: 0.35rem;
}

.finishes__apply:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.finishes__note {
  margin: 0.35rem 0 0;
  color: #94a3b8;
  font-size: 0.75rem;
}

.finishes__note--quiet {
  color: #64748b;
}
</style>
