<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import {
  NOT_COVERED,
  SEVERITY_RANK,
  analyzeRoom,
  fetchUnit,
  tallySeverities,
  type Analysis,
  type Finding,
  type Room,
  type RuleType,
  type Severity,
} from '@/api/knowledge'
import { useUiStore } from '@/stores/ui'
import AppShell from '@/components/AppShell.vue'
import RoomFindings from '@/components/RoomFindings.vue'

/**
 * Room review — the web face of the knowledge base.
 *
 * The screen's job is to be trustworthy about what it does not know. A room
 * showing no findings can mean three different things — nothing is wrong, the
 * room type has no standards, or most rules could not run for lack of data —
 * and one shared empty state for all three teaches users that a clean result
 * means nothing. Each renders distinctly, and every analysed room carries its
 * coverage so "nothing flagged" is always qualified by "out of how many".
 */

/** Per room: the analysis, or why there is not one. */
type RoomState =
  | { kind: 'loading' }
  | { kind: 'ready'; analysis: Analysis }
  | { kind: 'not_covered' }
  | { kind: 'failed' }

const { t } = useI18n()
const ui = useUiStore()
const route = useRoute()
const unitId = String(route.params['unitId'])

const rooms = ref<Room[]>([])
const states = ref<Record<string, RoomState>>({})
const loading = ref(true)
const filter = ref<'all' | RuleType>('all')

const FILTERS = ['all', 'validation', 'recommendation'] as const

const FILTER_LABELS: Readonly<Record<(typeof FILTERS)[number], string>> = {
  all: 'knowledge.filters.all',
  validation: 'knowledge.filters.validationOnly',
  recommendation: 'knowledge.filters.recommendationOnly',
}

const localeName = (room: Room): string => (ui.locale === 'ar' ? room.nameAr : room.nameEn)

const stateOf = (roomId: string): RoomState => states.value[roomId] ?? { kind: 'loading' }

const analysisOf = (roomId: string): Analysis | null => {
  const state = stateOf(roomId)
  return state.kind === 'ready' ? state.analysis : null
}

const applyFilter = (findings: readonly Finding[]): Finding[] =>
  filter.value === 'all' ? [...findings] : findings.filter((f) => f.ruleType === filter.value)

const analyzedCount = computed(
  () => Object.values(states.value).filter((state) => state.kind !== 'loading').length,
)

const totals = computed(() =>
  tallySeverities(rooms.value.map((room) => applyFilter(analysisOf(room.id)?.findings ?? []))),
)

const totalCount = computed(() => Object.values(totals.value).reduce((sum, n) => sum + n, 0))

const orderedSeverities = computed(() =>
  (Object.keys(totals.value) as Severity[])
    .filter((severity) => totals.value[severity] > 0)
    .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b]),
)

async function analyze(room: Room): Promise<void> {
  states.value[room.id] = { kind: 'loading' }
  const result = await analyzeRoom(unitId, room.id)

  if (result.ok) {
    states.value[room.id] = { kind: 'ready', analysis: result.data }
    return
  }
  // A room type the knowledge base does not cover is an expected answer, not a
  // failure, and must not be presented as one.
  states.value[room.id] =
    result.error.code === NOT_COVERED ? { kind: 'not_covered' } : { kind: 'failed' }
}

async function load(): Promise<void> {
  loading.value = true
  const result = await fetchUnit(unitId)
  if (result.ok) {
    rooms.value = result.data.rooms
    // Concurrent, not sequential: each room is an independent read, and a unit
    // with twelve rooms should not cost twelve round trips of latency.
    await Promise.all(result.data.rooms.map(analyze))
  }
  loading.value = false
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="review">
      <header class="review__head">
        <div>
          <h1>{{ t('knowledge.title') }}</h1>
          <p class="muted">{{ t('knowledge.subtitle') }}</p>
        </div>
        <RouterLink :to="`/units/${unitId}/board`" class="btn btn--small">
          {{ t('knowledge.back') }}
        </RouterLink>
      </header>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>

      <p v-else-if="rooms.length === 0" class="muted">{{ t('knowledge.noRooms') }}</p>

      <template v-else>
        <section class="summary panel">
          <div>
            <h2 class="summary__title">{{ t('knowledge.summary.title') }}</h2>
            <p class="muted summary__meta">
              {{ t('knowledge.roomsAnalyzed', { done: analyzedCount, total: rooms.length }) }}
            </p>
          </div>

          <div v-if="totalCount > 0" class="summary__counts">
            <span
              v-for="severity in orderedSeverities"
              :key="severity"
              class="tally"
              :data-severity="severity"
            >
              <strong class="numeric">{{ totals[severity] }}</strong>
              {{ t(`knowledge.severity.${severity}`) }}
            </span>
          </div>
          <p v-else class="summary__clean">{{ t('knowledge.summary.none') }}</p>
        </section>

        <div class="filters" role="group" :aria-label="t('knowledge.filters.all')">
          <button
            v-for="option in FILTERS"
            :key="option"
            class="btn btn--small"
            type="button"
            :aria-pressed="filter === option"
            :data-active="filter === option"
            @click="filter = option"
          >
            {{ t(FILTER_LABELS[option]) }}
          </button>
        </div>

        <ul class="rooms">
          <li v-for="room in rooms" :key="room.id" class="room panel">
            <header class="room__head">
              <div class="room__id">
                <strong>{{ localeName(room) }}</strong>
                <span class="badge">{{ room.typeCode }}</span>
              </div>
              <span class="muted room__dims numeric">
                {{ room.geometry.floorArea }} m² · {{ room.widthMm / 1000 }} ×
                {{ room.lengthMm / 1000 }} m
              </span>
            </header>

            <p v-if="stateOf(room.id).kind === 'loading'" class="note">
              {{ t('common.state.loading') }}
            </p>

            <p v-else-if="stateOf(room.id).kind === 'not_covered'" class="note">
              {{ t('knowledge.notCovered') }}
            </p>

            <p v-else-if="stateOf(room.id).kind === 'failed'" class="note note--danger">
              {{ t('knowledge.failed') }}
              <button class="btn btn--small" type="button" @click="analyze(room)">
                {{ t('knowledge.recheck') }}
              </button>
            </p>

            <RoomFindings
              v-else-if="analysisOf(room.id)"
              :analysis="analysisOf(room.id)!"
              :filter="filter"
            />
          </li>
        </ul>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.review {
  padding: var(--bf-space-6);
  max-width: 900px;
  margin-inline: auto;
}

.review__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--bf-space-4);
  margin-bottom: var(--bf-space-5);
}

.review__head h1 {
  margin: 0;
  font-size: var(--bf-text-2xl);
  font-weight: var(--bf-weight-semibold);
}

.panel {
  background: var(--bf-surface);
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-lg);
  padding: var(--bf-space-4);
}

.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--bf-space-3);
  margin-bottom: var(--bf-space-4);
}

.summary__title {
  margin: 0;
  font-size: var(--bf-text-lg);
  font-weight: var(--bf-weight-semibold);
}

.summary__meta {
  margin: var(--bf-space-1) 0 0;
  font-size: var(--bf-text-sm);
}

.summary__counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bf-space-2);
}

.summary__clean {
  margin: 0;
  color: var(--bf-success);
  font-weight: var(--bf-weight-medium);
}

/* Severity carries a text label as well as colour — never colour alone. */
.tally {
  display: inline-flex;
  align-items: baseline;
  gap: var(--bf-space-1);
  padding-block: 0.2rem;
  padding-inline: 0.6rem;
  border-radius: var(--bf-radius-full);
  border: 1px solid var(--bf-border);
  font-size: var(--bf-text-xs);
  color: var(--bf-text-muted);
}

.tally[data-severity='critical'],
.tally[data-severity='error'] {
  color: var(--bf-danger);
  border-color: var(--bf-danger);
}

.tally[data-severity='warning'] {
  color: var(--bf-warning);
  border-color: var(--bf-warning);
}

.tally[data-severity='info'] {
  color: var(--bf-info);
  border-color: var(--bf-info);
}

.filters {
  display: flex;
  gap: var(--bf-space-1);
  margin-bottom: var(--bf-space-3);
}

.rooms {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--bf-space-3);
}

.room__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bf-space-3);
  margin-bottom: var(--bf-space-3);
  flex-wrap: wrap;
}

.room__id {
  display: flex;
  align-items: center;
  gap: var(--bf-space-2);
}

.room__dims {
  font-size: var(--bf-text-xs);
}

.note {
  margin: 0;
  font-size: var(--bf-text-sm);
  color: var(--bf-text-muted);
}

.note--danger {
  color: var(--bf-danger);
  display: flex;
  align-items: center;
  gap: var(--bf-space-2);
}

.btn {
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-md);
  background: var(--bf-surface);
  color: var(--bf-text);
  font: inherit;
  cursor: pointer;
  padding-block: 0.55rem;
  padding-inline: 1rem;
  text-decoration: none;
}

.btn--small {
  font-size: var(--bf-text-xs);
  padding-block: 0.3rem;
  padding-inline: 0.6rem;
}

.btn[data-active='true'] {
  background: var(--bf-primary-600);
  border-color: var(--bf-primary-600);
  color: #fff;
}

.badge {
  font-size: var(--bf-text-2xs);
  padding-block: 0.1rem;
  padding-inline: 0.5rem;
  border-radius: var(--bf-radius-full);
  border: 1px solid var(--bf-border);
  color: var(--bf-text-muted);
  white-space: nowrap;
}

.muted {
  color: var(--bf-text-muted);
}
</style>
