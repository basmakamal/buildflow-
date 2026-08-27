<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { BfIcon, stageIcons, type IconDef } from '@buildflow/ui'
import { request } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import AppShell from '@/components/AppShell.vue'

/**
 * The stage board — the web face of the daily loop.
 *
 * Actions render only when BOTH the permission and the state machine allow
 * them, mirroring `STAGE_TRANSITIONS` on the server. The client cannot invent
 * a move the server would refuse, so every visible button works — an interface
 * that offers dead buttons teaches users to stop trusting it.
 */

interface StageRow {
  id: string
  code: string
  nameEn: string
  nameAr: string
  sequence: number
  status: string
  progress: string
  requiresApproval: boolean
  blockedReason: string | null
  rejectedReason: string | null
}

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const unitId = String(route.params['unitId'])

const stages = ref<StageRow[]>([])
const unitProgress = ref('0.00')
const workflowStatus = ref<'active' | 'completed' | 'none'>('none')
const loading = ref(true)
const busyStage = ref<string | null>(null)
const progressDraft = ref<Record<string, string>>({})
const reasonDraft = ref<Record<string, string>>({})

/** snake_case stage codes → the icon registry's camelCase keys. */
const iconFor = (code: string): IconDef => {
  const camel = code.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())
  return (stageIcons as Record<string, IconDef>)[camel] ?? stageIcons.unitReceived
}

const stageName = (stage: StageRow): string => (ui.locale === 'ar' ? stage.nameAr : stage.nameEn)

const isDone = computed(() => workflowStatus.value === 'completed')

async function load() {
  loading.value = true
  const result = await request<{
    progress: string
    status: 'active' | 'completed'
    stages: StageRow[]
  }>(`/units/${unitId}/stages`)
  if (result.ok) {
    stages.value = result.data.stages
    unitProgress.value = result.data.progress
    workflowStatus.value = result.data.status
  } else if (result.error.status === 404) {
    workflowStatus.value = 'none'
  }
  loading.value = false
}

async function instantiate() {
  const result = await request(`/units/${unitId}/workflow`, { method: 'POST' })
  if (result.ok) await load()
}

async function act(stage: StageRow, action: string, body?: Record<string, unknown>) {
  busyStage.value = stage.id
  const method = action === 'progress' ? 'PATCH' : 'POST'
  await request(`/units/${unitId}/stages/${stage.id}/${action}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  busyStage.value = null
  await load()
}

const saveProgress = (stage: StageRow) =>
  act(stage, 'progress', { progress: progressDraft.value[stage.id] ?? stage.progress })

function withReason(stage: StageRow, action: 'reject' | 'block') {
  const reason = reasonDraft.value[stage.id]?.trim()
  if (!reason) return
  void act(stage, action, { reason })
  reasonDraft.value[stage.id] = ''
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="board">
      <header class="board__head">
        <div class="board__title">
          <div>
            <h1>{{ t('stages.title') }}</h1>
            <p class="board__progress">
              {{ t('stages.unitProgress') }}:
              <strong class="numeric">{{ unitProgress }}%</strong>
            </p>
          </div>
          <div class="board__actions">
            <RouterLink :to="`/units/${unitId}/planner`" class="btn btn--small">
              {{ t('planner.open') }}
            </RouterLink>
            <RouterLink :to="`/units/${unitId}/review`" class="btn btn--small">
              {{ t('knowledge.title') }}
            </RouterLink>
          </div>
        </div>
        <div class="board__meter" role="progressbar" :aria-valuenow="Number(unitProgress)">
          <div class="board__meter-fill" :style="{ width: `${Number(unitProgress)}%` }" />
        </div>
      </header>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>

      <div v-else-if="workflowStatus === 'none'" class="board__empty">
        <p class="muted">{{ t('stages.noWorkflow') }}</p>
        <button
          v-if="auth.can('unit.update')"
          class="btn btn--primary"
          type="button"
          @click="instantiate"
        >
          {{ t('stages.instantiate') }}
        </button>
      </div>

      <template v-else>
        <p v-if="isDone" class="board__done">{{ t('stages.workflowDone') }}</p>

        <ol class="stages">
          <li
            v-for="stage in stages"
            :key="stage.id"
            class="stage"
            :data-status="stage.status"
            :aria-busy="busyStage === stage.id"
          >
            <div class="stage__icon">
              <BfIcon :icon="iconFor(stage.code)" variant="chip" size="lg" />
            </div>

            <div class="stage__main">
              <div class="stage__title">
                <strong>{{ stageName(stage) }}</strong>
                <span class="badge" :data-status="stage.status">
                  {{ t(`stages.status.${stage.status}`) }}
                </span>
              </div>

              <p v-if="stage.blockedReason" class="stage__note stage__note--warn">
                {{ t('stages.blockedBecause', { reason: stage.blockedReason }) }}
              </p>
              <p
                v-if="stage.rejectedReason && stage.status === 'rejected'"
                class="stage__note stage__note--danger"
              >
                {{ t('stages.rejectedBecause', { reason: stage.rejectedReason }) }}
              </p>

              <div class="stage__meter" role="progressbar" :aria-valuenow="Number(stage.progress)">
                <div class="stage__meter-fill" :style="{ width: `${Number(stage.progress)}%` }" />
              </div>
            </div>

            <div class="stage__side">
              <span class="numeric stage__pct">{{ stage.progress }}%</span>

              <div class="stage__actions">
                <!-- start: from not_started, blocked (resume), on_hold, rejected (rework) -->
                <button
                  v-if="
                    auth.can('stage.update_progress') &&
                    ['not_started', 'rejected'].includes(stage.status)
                  "
                  class="btn btn--small"
                  type="button"
                  @click="act(stage, 'start')"
                >
                  {{ t('stages.actions.start') }}
                </button>

                <template
                  v-if="auth.can('stage.update_progress') && stage.status === 'in_progress'"
                >
                  <input
                    v-model="progressDraft[stage.id]"
                    class="stage__input numeric"
                    :placeholder="stage.progress"
                    :aria-label="t('projects.fields.progress')"
                    pattern="\d{1,3}(\.\d{1,2})?"
                  />
                  <button class="btn btn--small" type="button" @click="saveProgress(stage)">
                    {{ t('stages.actions.saveProgress') }}
                  </button>
                </template>

                <button
                  v-if="auth.can('stage.complete') && stage.status === 'in_progress'"
                  class="btn btn--small btn--primary"
                  type="button"
                  @click="act(stage, 'complete')"
                >
                  {{ t('stages.actions.complete') }}
                </button>

                <button
                  v-if="auth.can('stage.update_progress') && stage.status === 'blocked'"
                  class="btn btn--small"
                  type="button"
                  @click="act(stage, 'start')"
                >
                  {{ t('stages.actions.unblock') }}
                </button>

                <template v-if="auth.can('stage.approve') && stage.status === 'completed'">
                  <button
                    class="btn btn--small btn--primary"
                    type="button"
                    @click="act(stage, 'approve')"
                  >
                    {{ t('stages.actions.approve') }}
                  </button>
                </template>

                <template
                  v-if="
                    (auth.can('stage.reject') && stage.status === 'completed') ||
                    (auth.can('stage.update_progress') && stage.status === 'in_progress')
                  "
                >
                  <input
                    v-model="reasonDraft[stage.id]"
                    class="stage__input"
                    :placeholder="t('stages.reasonPrompt')"
                    :aria-label="t('stages.reasonPrompt')"
                  />
                  <button
                    v-if="auth.can('stage.reject') && stage.status === 'completed'"
                    class="btn btn--small btn--danger"
                    type="button"
                    @click="withReason(stage, 'reject')"
                  >
                    {{ t('stages.actions.reject') }}
                  </button>
                  <button
                    v-if="auth.can('stage.update_progress') && stage.status === 'in_progress'"
                    class="btn btn--small"
                    type="button"
                    @click="withReason(stage, 'block')"
                  >
                    {{ t('stages.actions.block') }}
                  </button>
                </template>
              </div>
            </div>
          </li>
        </ol>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.board {
  padding: var(--bf-space-6);
  max-width: 900px;
  margin-inline: auto;
}

.board__head {
  margin-bottom: var(--bf-space-5);
}

.board__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--bf-space-4);
}

.board__actions {
  display: flex;
  gap: var(--bf-space-2);
}

.board__title .btn {
  text-decoration: none;
}

.board__head h1 {
  margin: 0;
  font-size: var(--bf-text-2xl);
  font-weight: var(--bf-weight-semibold);
}

.board__progress {
  margin: var(--bf-space-1) 0 var(--bf-space-3);
  color: var(--bf-text-muted);
  font-size: var(--bf-text-sm);
}

.board__meter {
  height: 10px;
  border-radius: var(--bf-radius-full);
  background: var(--bf-surface-sunken);
  overflow: hidden;
}

.board__meter-fill {
  height: 100%;
  background: var(--bf-primary-600);
  transition: width var(--bf-duration) var(--bf-ease);
}

.board__empty {
  display: grid;
  gap: var(--bf-space-3);
  justify-items: start;
}

.board__done {
  padding: var(--bf-space-3) var(--bf-space-4);
  border-radius: var(--bf-radius-md);
  background: var(--bf-success-bg);
  color: var(--bf-success);
  font-weight: var(--bf-weight-medium);
}

.stages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--bf-space-2);
}

.stage {
  display: flex;
  align-items: center;
  gap: var(--bf-space-4);
  padding: var(--bf-space-3) var(--bf-space-4);
  background: var(--bf-surface);
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-lg);
  /* Status is carried by the badge and the start border — never colour alone. */
  border-inline-start-width: 3px;
}

.stage[data-status='in_progress'] {
  border-inline-start-color: var(--bf-info);
}
.stage[data-status='completed'] {
  border-inline-start-color: var(--bf-warning);
}
.stage[data-status='approved'] {
  border-inline-start-color: var(--bf-success);
}
.stage[data-status='blocked'],
.stage[data-status='rejected'] {
  border-inline-start-color: var(--bf-danger);
}

.stage__main {
  flex: 1;
  min-width: 0;
}

.stage__title {
  display: flex;
  align-items: center;
  gap: var(--bf-space-2);
  margin-bottom: var(--bf-space-2);
}

.stage__note {
  margin: 0 0 var(--bf-space-2);
  font-size: var(--bf-text-xs);
}

.stage__note--warn {
  color: var(--bf-warning);
}

.stage__note--danger {
  color: var(--bf-danger);
}

.stage__meter {
  height: 5px;
  border-radius: var(--bf-radius-full);
  background: var(--bf-surface-sunken);
  overflow: hidden;
}

.stage__meter-fill {
  height: 100%;
  background: var(--bf-primary-600);
  transition: width var(--bf-duration) var(--bf-ease);
}

.stage__side {
  display: grid;
  gap: var(--bf-space-2);
  justify-items: end;
  min-width: 220px;
}

.stage__pct {
  font-size: var(--bf-text-sm);
  font-weight: var(--bf-weight-semibold);
}

.stage__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bf-space-1);
  justify-content: flex-end;
}

.stage__input {
  width: 90px;
  padding-block: 0.3rem;
  padding-inline: 0.5rem;
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-sm);
  background: var(--bf-bg);
  color: var(--bf-text);
  font: inherit;
  font-size: var(--bf-text-xs);
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
}

.btn--small {
  font-size: var(--bf-text-xs);
  padding-block: 0.3rem;
  padding-inline: 0.6rem;
}

.btn--primary {
  background: var(--bf-primary-600);
  border-color: var(--bf-primary-600);
  color: #fff;
}

.btn--danger {
  color: var(--bf-danger);
  border-color: var(--bf-danger);
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

.badge[data-status='in_progress'] {
  color: var(--bf-info);
  border-color: var(--bf-info);
}
.badge[data-status='approved'] {
  color: var(--bf-success);
  border-color: var(--bf-success);
}
.badge[data-status='completed'] {
  color: var(--bf-warning);
  border-color: var(--bf-warning);
}
.badge[data-status='blocked'],
.badge[data-status='rejected'] {
  color: var(--bf-danger);
  border-color: var(--bf-danger);
}

.muted {
  color: var(--bf-text-muted);
}
</style>
