<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppShell from '@/components/AppShell.vue'
import { useAuthStore } from '@/stores/auth'
import { getTaxIdentity, saveTaxIdentity } from '@/api/invoicing'

/**
 * The company tax identity. docs/04 §2.1, docs/01 NFR-C4
 *
 * Everything a tax invoice prints about the seller, entered once. The page
 * mirrors the server's honesty: until this form is complete, invoicing
 * refuses with SELLER_IDENTITY_INCOMPLETE — so the banner says exactly that
 * instead of letting someone discover it at their first invoice.
 */

const i18n = useI18n()
const { t } = i18n

/** A known error code gets its own sentence; anything else the generic one. */
const errorMessage = (code: string): string =>
  i18n.te(`invoicing.errors.${code}`)
    ? t(`invoicing.errors.${code}`)
    : t('invoicing.errors.UNKNOWN')
const auth = useAuthStore()

const form = reactive({
  legalName: '',
  vatNumber: '',
  crNumber: '',
  street: '',
  buildingNumber: '',
  district: '',
  city: '',
  postalCode: '',
})
const complete = ref(false)
const loading = ref(true)
const saving = ref(false)
const errorCode = ref<string | null>(null)
const saved = ref(false)

onMounted(async () => {
  const result = await getTaxIdentity()
  if (result.ok) {
    const identity = result.data.data
    form.legalName = identity.legalName ?? ''
    form.vatNumber = identity.vatNumber ?? ''
    form.crNumber = identity.crNumber ?? ''
    form.street = identity.address.street ?? ''
    form.buildingNumber = identity.address.buildingNumber ?? ''
    form.district = identity.address.district ?? ''
    form.city = identity.address.city ?? ''
    form.postalCode = identity.address.postalCode ?? ''
    complete.value = identity.complete
  } else {
    errorCode.value = result.error.code
  }
  loading.value = false
})

async function save() {
  saving.value = true
  errorCode.value = null
  saved.value = false
  const result = await saveTaxIdentity({
    legalName: form.legalName,
    vatNumber: form.vatNumber,
    crNumber: form.crNumber,
    address: {
      street: form.street,
      buildingNumber: form.buildingNumber,
      district: form.district,
      city: form.city,
      postalCode: form.postalCode,
    },
  })
  if (result.ok) {
    complete.value = result.data.data.complete
    saved.value = true
  } else {
    errorCode.value = result.error.code
  }
  saving.value = false
}

const fields = [
  ['legalName', 'invoicing.identity.legalName'],
  ['vatNumber', 'invoicing.identity.vatNumber'],
  ['crNumber', 'invoicing.identity.crNumber'],
  ['street', 'invoicing.identity.street'],
  ['buildingNumber', 'invoicing.identity.buildingNumber'],
  ['district', 'invoicing.identity.district'],
  ['city', 'invoicing.identity.city'],
  ['postalCode', 'invoicing.identity.postalCode'],
] as const
</script>

<template>
  <AppShell>
    <div class="identity">
      <h1>{{ t('invoicing.identity.title') }}</h1>
      <p class="muted">{{ t('invoicing.identity.intro') }}</p>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>

      <template v-else>
        <p v-if="!complete" class="identity__banner identity__banner--warn">
          {{ t('invoicing.identity.incomplete') }}
        </p>
        <p v-else class="identity__banner identity__banner--ok">
          {{ t('invoicing.identity.complete') }}
        </p>

        <form class="identity__form" @submit.prevent="save">
          <label v-for="[key, label] in fields" :key="key" class="identity__field">
            <span>{{ t(label) }}</span>
            <input v-model="form[key]" :disabled="!auth.can('company.update_settings')" required />
          </label>

          <p v-if="errorCode" class="identity__error">{{ errorMessage(errorCode) }}</p>
          <p v-if="saved" class="identity__saved">{{ t('invoicing.identity.saved') }}</p>

          <button
            v-if="auth.can('company.update_settings')"
            class="btn btn--primary"
            type="submit"
            :disabled="saving"
          >
            {{ saving ? t('common.state.loading') : t('common.actions.save') }}
          </button>
        </form>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.identity {
  max-width: 34rem;
  margin: 0 auto;
  padding: var(--bf-space-6) var(--bf-space-4);
}

.identity__banner {
  padding: var(--bf-space-3);
  border-radius: var(--bf-radius-md);
}

.identity__banner--warn {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.5);
}

.identity__banner--ok {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.5);
}

.identity__form {
  display: flex;
  flex-direction: column;
  gap: var(--bf-space-3);
  margin-top: var(--bf-space-4);
}

.identity__field {
  display: flex;
  flex-direction: column;
  gap: var(--bf-space-1);
}

.identity__field input {
  padding: var(--bf-space-2);
  border: 1px solid var(--bf-color-border, #cbd5e1);
  border-radius: var(--bf-radius-md);
  background: transparent;
  color: inherit;
}

.identity__error {
  color: #dc2626;
}

.identity__saved {
  color: #059669;
}
</style>
