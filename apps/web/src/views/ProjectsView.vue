<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { request } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import AppShell from '@/components/AppShell.vue'

interface ProjectRow {
  id: string
  code: string
  nameEn: string
  nameAr: string
  status: string
  progressPercentage: string | number
}

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const projects = ref<ProjectRow[]>([])
const loading = ref(true)
const creating = ref(false)
const form = ref({ code: '', nameEn: '', nameAr: '' })
const errorCode = ref<string | null>(null)

async function load() {
  loading.value = true
  const result = await request<{ data: ProjectRow[] }>('/projects')
  if (result.ok) projects.value = result.data.data
  loading.value = false
}

async function create() {
  errorCode.value = null
  const result = await request<{ id: string }>('/projects', {
    method: 'POST',
    body: JSON.stringify(form.value),
  })
  if (!result.ok) {
    errorCode.value = result.error.code
    return
  }
  creating.value = false
  form.value = { code: '', nameEn: '', nameAr: '' }
  await load()
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page">
      <header class="page__head">
        <h1>{{ t('projects.title') }}</h1>
        <!-- Hidden when the permission is absent — honesty in the interface;
             the server enforces it regardless. -->
        <button
          v-if="auth.can('project.create')"
          class="btn btn--primary"
          type="button"
          @click="creating = !creating"
        >
          {{ t('projects.create.action') }}
        </button>
      </header>

      <form v-if="creating" class="panel form" @submit.prevent="create">
        <label class="field">
          <span>{{ t('projects.create.code') }}</span>
          <input v-model="form.code" class="numeric" required minlength="2" />
        </label>
        <label class="field">
          <span>{{ t('projects.create.nameEn') }}</span>
          <input v-model="form.nameEn" dir="ltr" required minlength="2" />
        </label>
        <label class="field">
          <span>{{ t('projects.create.nameAr') }}</span>
          <input v-model="form.nameAr" dir="rtl" required minlength="2" />
        </label>
        <p v-if="errorCode" class="error" role="alert">{{ t('common.state.error') }}</p>
        <button class="btn btn--primary" type="submit">{{ t('projects.create.submit') }}</button>
      </form>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>
      <p v-else-if="projects.length === 0" class="muted">{{ t('projects.empty') }}</p>

      <ul v-else class="cards">
        <li v-for="project in projects" :key="project.id">
          <RouterLink :to="`/projects/${project.id}/units`" class="panel card">
            <div class="card__row">
              <strong>{{ ui.locale === 'ar' ? project.nameAr : project.nameEn }}</strong>
              <code class="numeric">{{ project.code }}</code>
            </div>
            <div class="card__row">
              <span class="badge" :data-status="project.status">
                {{ t(`projects.status.${project.status}`) }}
              </span>
              <span class="numeric muted">{{ Number(project.progressPercentage) }}%</span>
            </div>
            <div
              class="meter"
              role="progressbar"
              :aria-valuenow="Number(project.progressPercentage)"
            >
              <div
                class="meter__fill"
                :style="{ width: `${Number(project.progressPercentage)}%` }"
              />
            </div>
          </RouterLink>
        </li>
      </ul>
    </div>
  </AppShell>
</template>

<style scoped src="./list-pages.css"></style>
