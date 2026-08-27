<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { squareMmToSquareMetres } from '@buildflow/spatial'
import { stopRoomDetection } from '@/workers/room-detection-client'
import { usePlannerStore } from '@/stores/planner'

/**
 * Rooms, and what a person has to say about them. docs/08 §7.4
 *
 * Detection is automatic and DEBOUNCED. Running it on every pointer event
 * would put a quadratic crossing pass in the middle of a drag; running it only
 * on a button would leave the areas stale, and a stale area is worse than no
 * area — it looks authoritative on the way to a quotation.
 *
 * The type matters more than the name: docs/02 §3.7's quantity rules key off
 * `room.type`, so an unnamed room contributes nothing to the BOQ. That is why
 * the count of unnamed rooms is shown rather than left for someone to notice.
 */

const { t } = useI18n()
const store = usePlannerStore()

/**
 * The canonical list lives in `packages/modules/project/src/domain/room.ts`
 * and is enforced when a plan is saved. It is repeated here rather than
 * imported because that module's barrel exports Prisma repositories, which
 * have no business in a browser bundle.
 */
const ROOM_TYPES = [
  'bedroom',
  'master_bedroom',
  'bathroom',
  'guest_bathroom',
  'kitchen',
  'living_room',
  'dining_room',
  'reception',
  'majlis',
  'balcony',
  'laundry',
  'storage',
  'corridor',
  'staircase',
  'maid_room',
  'driver_room',
  'other',
] as const

/** A quadratic pass over the walls, so it waits for the drawing to settle. */
const DETECT_DEBOUNCE_MS = 350
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  // Geometry only. Selecting a wall or panning must not re-run detection.
  () =>
    store.walls
      .map((wall) => `${wall.id}:${wall.start.x},${wall.start.y}:${wall.end.x},${wall.end.y}`)
      .join(';'),
  () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void store.detectRooms()
    }, DETECT_DEBOUNCE_MS)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  stopRoomDetection()
})

const squareMetres = (areaMm2: number) => Number(squareMmToSquareMetres(areaMm2)).toFixed(2)

const totalArea = computed(() => squareMetres(store.floorAreaMm2))
</script>

<template>
  <aside class="rooms" :aria-label="t('planner.rooms')">
    <header class="rooms__head">
      <h2 class="rooms__title">{{ t('planner.rooms') }}</h2>
      <span v-if="store.detecting" class="rooms__busy">{{ t('planner.detecting') }}</span>
    </header>

    <p v-if="store.rooms.length === 0" class="rooms__empty">{{ t('planner.noRooms') }}</p>

    <ul v-else class="rooms__list">
      <li
        v-for="room in store.rooms"
        :key="room.id"
        class="rooms__row"
        :class="{ 'rooms__row--active': store.activeRoomId === room.id }"
        @mouseenter="store.setActiveRoom(room.id)"
        @mouseleave="store.setActiveRoom(null)"
      >
        <div class="rooms__line">
          <input
            class="rooms__name"
            type="text"
            :value="room.name"
            :placeholder="t('planner.roomName')"
            :aria-label="t('planner.roomName')"
            @change="
              store.assignRoom(room.signature, { name: ($event.target as HTMLInputElement).value })
            "
          />
          <button
            type="button"
            class="rooms__zoom"
            :title="t('planner.zoomToRoom')"
            @click="store.zoomToRoom(room.id)"
          >
            {{ t('planner.zoomToRoom') }}
          </button>
        </div>

        <div class="rooms__line">
          <select
            class="rooms__type"
            :value="room.typeCode ?? ''"
            :aria-label="t('planner.roomType')"
            @change="
              store.assignRoom(room.signature, {
                typeCode: ($event.target as HTMLSelectElement).value || null,
              })
            "
          >
            <option value="">{{ t('planner.roomTypeUnset') }}</option>
            <option v-for="code in ROOM_TYPES" :key="code" :value="code">
              {{ t(`planner.roomTypes.${code}`) }}
            </option>
          </select>
          <span class="rooms__area">{{
            t('planner.squareMetres', { value: squareMetres(room.areaMm2) })
          }}</span>
        </div>

        <p class="rooms__metrics">
          {{ t('planner.wallArea') }}
          {{ squareMetres(store.metricsFor(room.id)?.wallAreaMm2 ?? 0) }} ·
          {{ t('planner.skirting') }}
          {{ ((store.metricsFor(room.id)?.skirtingLengthMm ?? 0) / 1000).toFixed(2) }}
        </p>
      </li>
    </ul>

    <footer v-if="store.rooms.length > 0" class="rooms__foot">
      <p class="rooms__total">
        {{ t('planner.totalArea') }}
        {{ t('planner.squareMetres', { value: totalArea }) }}
      </p>
      <p v-if="store.unnamedRooms.length > 0" class="rooms__warning">
        {{ t('planner.unnamed', { count: store.unnamedRooms.length }) }}
      </p>
    </footer>
  </aside>
</template>

<style scoped>
.rooms {
  padding: 0.75rem;
  border-inline-start: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-surface, #fff);
  inline-size: 17rem;
  overflow-y: auto;
}

.rooms__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.rooms__title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted, #64748b);
}

.rooms__busy,
.rooms__empty {
  font-size: 0.8125rem;
  color: var(--color-text-muted, #94a3b8);
}

.rooms__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rooms__row {
  padding: 0.4rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
}

.rooms__row--active {
  border-color: var(--color-primary, #2563eb);
  background: rgba(37, 99, 235, 0.06);
}

.rooms__line {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-block-end: 0.3rem;
}

.rooms__name,
.rooms__type {
  flex: 1;
  min-inline-size: 0;
  padding: 0.25rem 0.35rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.3rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.8125rem;
}

.rooms__zoom {
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.3rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.rooms__area {
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rooms__metrics {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

.rooms__foot {
  margin-block-start: 0.75rem;
  padding-block-start: 0.5rem;
  border-block-start: 1px solid var(--color-border, #e2e8f0);
}

.rooms__total {
  margin: 0;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}

.rooms__warning {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: #b45309;
}
</style>
