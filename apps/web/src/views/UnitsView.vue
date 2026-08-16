<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { request } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import AppShell from '@/components/AppShell.vue'

interface UnitRow {
  id: string
  unitNumber: string
  name: string
  floor: number | null
  grossArea: string | number
  status: string
  progressPercentage: string | number
  _count: { rooms: number }
}

const { t } = useI18n()
const auth = useAuthStore()
const route = useRoute()
const projectId = String(route.params['projectId'])

const units = ref<UnitRow[]>([])
const loading = ref(true)
const creating = ref(false)
const form = ref({ unitNumber: '', name: '', grossArea: '', floor: 0 })
const errorCode = ref<string | null>(null)

async function load() {
  loading.value = true
  const result = await request<{ data: UnitRow[] }>(`/projects/${projectId}/units`)
  if (result.ok) units.value = result.data.data
  loading.value = false
}

async function create() {
  errorCode.value = null
  const result = await request<{ id: string }>(`/projects/${projectId}/units`, {
    method: 'POST',
    body: JSON.stringify({
      unitNumber: form.value.unitNumber,
      name: form.value.name,
      grossArea: form.value.grossArea,
      floor: form.value.floor,
    }),
  })
  if (!result.ok) {
    errorCode.value = result.error.code
    return
  }
  creating.value = false
  form.value = { unitNumber: '', name: '', grossArea: '', floor: 0 }
  await load()
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page">
      <header class="page__head">
        <h1>{{ t('projects.units.title') }}</h1>
        <button
          v-if="auth.can('unit.create')"
          class="btn btn--primary"
          type="button"
          @click="creating = !creating"
        >
          {{ t('projects.units.create.action') }}
        </button>
      </header>

      <form v-if="creating" class="panel form" @submit.prevent="create">
        <label class="field">
          <span>{{ t('projects.units.create.unitNumber') }}</span>
          <input v-model="form.unitNumber" class="numeric" required />
        </label>
        <label class="field">
          <span>{{ t('projects.units.create.name') }}</span>
          <input v-model="form.name" required />
        </label>
        <label class="field">
          <span>{{ t('projects.units.create.grossArea') }}</span>
          <input v-model="form.grossArea" class="numeric" required pattern="\d{1,6}(\.\d{1,4})?" />
        </label>
        <label class="field">
          <span>{{ t('projects.units.create.floor') }}</span>
          <input v-model="form.floor" class="numeric" type="number" min="-5" max="200" />
        </label>
        <p v-if="errorCode" class="error" role="alert">{{ t('common.state.error') }}</p>
        <button class="btn btn--primary" type="submit">
          {{ t('projects.units.create.submit') }}
        </button>
      </form>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>
      <p v-else-if="units.length === 0" class="muted">{{ t('projects.units.empty') }}</p>

      <ul v-else class="cards">
        <li v-for="unit in units" :key="unit.id">
          <RouterLink :to="`/units/${unit.id}/board`" class="panel card">
            <div class="card__row">
              <strong>{{ unit.name }}</strong>
              <code class="numeric">#{{ unit.unitNumber }}</code>
            </div>
            <div class="card__row">
              <span class="muted">
                <template v-if="unit.floor !== null">
                  {{ t('projects.units.fields.floor', { n: unit.floor }) }} ·
                </template>
                {{ t('projects.units.fields.area', { area: Number(unit.grossArea) }) }} ·
                <span class="numeric">{{ unit._count.rooms }}</span>
                {{ t('projects.units.fields.rooms') }}
              </span>
              <span class="numeric muted">{{ Number(unit.progressPercentage) }}%</span>
            </div>
            <div class="meter" role="progressbar" :aria-valuenow="Number(unit.progressPercentage)">
              <div class="meter__fill" :style="{ width: `${Number(unit.progressPercentage)}%` }" />
            </div>
          </RouterLink>
        </li>
      </ul>
    </div>
  </AppShell>
</template>

<style scoped src="./list-pages.css"></style>
