<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { toDataURL } from 'qrcode'
import AppShell from '@/components/AppShell.vue'
import { useAuthStore } from '@/stores/auth'
import {
  createTaxInvoiceDraft,
  getTaxInvoiceDocument,
  issueTaxInvoice,
  listTaxInvoices,
  type TaxInvoiceRow,
} from '@/api/invoicing'

/**
 * Issued tax invoices for a unit. docs/01 NFR-C4
 *
 * The page mirrors the domain's two-state life: a DRAFT is editable ambition,
 * an ISSUED invoice is a regulated document — so the issued row shows the
 * chain position (ICV) and offers the document, and nothing offers an edit.
 * The QR rendered here is the byte payload the server stamped; the phone app
 * decodes it offline, which is why it comes from the API and is never
 * recomputed in the browser.
 */

const i18n = useI18n()
const { t } = i18n
const route = useRoute()
const auth = useAuthStore()
const unitId = computed(() => String(route.params['unitId']))

const invoices = ref<TaxInvoiceRow[]>([])
const loading = ref(true)
const busy = ref<string | null>(null)
const errorCode = ref<string | null>(null)
const qrImages = reactive<Record<string, string>>({})
const openXml = ref<string | null>(null)

interface DraftForm {
  kind: 'standard' | 'simplified'
  buyerName: string
  buyerVat: string
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
}

const draft = reactive<DraftForm>({
  kind: 'simplified',
  buyerName: '',
  buyerVat: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  vatRate: '15',
})

const errorMessage = (code: string): string =>
  i18n.te(`invoicing.errors.${code}`)
    ? t(`invoicing.errors.${code}`)
    : t('invoicing.errors.UNKNOWN')

async function load() {
  const result = await listTaxInvoices(unitId.value)
  if (result.ok) {
    invoices.value = result.data.data
    for (const invoice of invoices.value) {
      if (invoice.qr && !qrImages[invoice.id]) {
        // The QR image is a rendering of the server's payload, nothing more.
        qrImages[invoice.id] = await toDataURL(invoice.qr, { margin: 1, width: 160 })
      }
    }
  } else {
    errorCode.value = result.error.code
  }
  loading.value = false
}

onMounted(load)

async function createDraft() {
  errorCode.value = null
  busy.value = 'create'
  const result = await createTaxInvoiceDraft(unitId.value, {
    kind: draft.kind,
    buyer: {
      name: draft.buyerName,
      vatNumber: draft.kind === 'standard' ? draft.buyerVat : null,
    },
    lines: [
      {
        description: draft.description,
        quantity: draft.quantity,
        unitPrice: draft.unitPrice,
        vatRate: draft.vatRate,
      },
    ],
  })
  if (result.ok) {
    draft.buyerName = ''
    draft.buyerVat = ''
    draft.description = ''
    draft.unitPrice = ''
    await load()
  } else {
    errorCode.value = result.error.code
  }
  busy.value = null
}

async function issue(invoice: TaxInvoiceRow) {
  errorCode.value = null
  busy.value = invoice.id
  const result = await issueTaxInvoice(invoice.id)
  if (!result.ok) errorCode.value = result.error.code
  await load()
  busy.value = null
}

async function showDocument(invoice: TaxInvoiceRow) {
  errorCode.value = null
  const result = await getTaxInvoiceDocument(invoice.id)
  if (result.ok) openXml.value = result.data.data.xml
  else errorCode.value = result.error.code
}
</script>

<template>
  <AppShell>
    <div class="invoices">
      <h1>{{ t('invoicing.title') }}</h1>
      <p class="muted">{{ t('invoicing.intro') }}</p>

      <p v-if="errorCode" class="invoices__error">{{ errorMessage(errorCode) }}</p>

      <form v-if="auth.can('invoice.create')" class="invoices__draft" @submit.prevent="createDraft">
        <h2>{{ t('invoicing.newDraft') }}</h2>
        <div class="invoices__grid">
          <label>
            <span>{{ t('invoicing.kind') }}</span>
            <select v-model="draft.kind">
              <option value="simplified">{{ t('invoicing.kinds.simplified') }}</option>
              <option value="standard">{{ t('invoicing.kinds.standard') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('invoicing.buyerName') }}</span>
            <input v-model="draft.buyerName" required />
          </label>
          <label v-if="draft.kind === 'standard'">
            <span>{{ t('invoicing.buyerVat') }}</span>
            <input v-model="draft.buyerVat" required minlength="15" maxlength="15" />
          </label>
          <label>
            <span>{{ t('invoicing.description') }}</span>
            <input v-model="draft.description" required />
          </label>
          <label>
            <span>{{ t('invoicing.quantity') }}</span>
            <input v-model="draft.quantity" required inputmode="decimal" />
          </label>
          <label>
            <span>{{ t('invoicing.unitPrice') }}</span>
            <input v-model="draft.unitPrice" required inputmode="decimal" />
          </label>
          <label>
            <span>{{ t('invoicing.vatRate') }}</span>
            <input v-model="draft.vatRate" required inputmode="decimal" />
          </label>
        </div>
        <button class="btn btn--primary" type="submit" :disabled="busy === 'create'">
          {{ t('invoicing.createDraft') }}
        </button>
      </form>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>
      <p v-else-if="invoices.length === 0" class="muted">{{ t('invoicing.empty') }}</p>

      <ul v-else class="invoices__list">
        <li v-for="invoice in invoices" :key="invoice.id" class="invoices__item">
          <div class="invoices__head">
            <strong>{{ invoice.invoiceNumber }}</strong>
            <span class="invoices__badge" :data-status="invoice.status">
              {{ t(`invoicing.status.${invoice.status}`) }}
            </span>
            <span class="muted">{{ t(`invoicing.kinds.${invoice.kind}`) }}</span>
          </div>
          <p class="muted">
            {{ invoice.buyer.name }} ·
            <span class="numeric">{{ invoice.totals.taxInclusiveAmount }}</span>
            {{ t('invoicing.sar') }}
            <template v-if="invoice.icv !== null">
              · {{ t('invoicing.icv') }} <span class="numeric">{{ invoice.icv }}</span>
            </template>
          </p>
          <div class="invoices__actions">
            <button
              v-if="invoice.status === 'draft' && auth.can('invoice.create')"
              class="btn btn--small"
              type="button"
              :disabled="busy === invoice.id"
              @click="issue(invoice)"
            >
              {{ t('invoicing.issue') }}
            </button>
            <button
              v-if="invoice.status === 'issued'"
              class="btn btn--small"
              type="button"
              @click="showDocument(invoice)"
            >
              {{ t('invoicing.viewDocument') }}
            </button>
          </div>
          <img
            v-if="qrImages[invoice.id]"
            class="invoices__qr"
            :src="qrImages[invoice.id]"
            :alt="t('invoicing.qrAlt')"
          />
        </li>
      </ul>

      <div v-if="openXml" class="invoices__xml">
        <div class="invoices__xml-head">
          <h2>{{ t('invoicing.document') }}</h2>
          <button class="btn btn--small" type="button" @click="openXml = null">
            {{ t('common.actions.close') }}
          </button>
        </div>
        <pre>{{ openXml }}</pre>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.invoices {
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--bf-space-6) var(--bf-space-4);
}

.invoices__error {
  color: #dc2626;
}

.invoices__draft {
  border: 1px solid var(--bf-color-border, #cbd5e1);
  border-radius: var(--bf-radius-lg);
  padding: var(--bf-space-4);
  margin: var(--bf-space-4) 0;
  display: flex;
  flex-direction: column;
  gap: var(--bf-space-3);
}

.invoices__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--bf-space-3);
}

.invoices__grid label {
  display: flex;
  flex-direction: column;
  gap: var(--bf-space-1);
}

.invoices__grid input,
.invoices__grid select {
  padding: var(--bf-space-2);
  border: 1px solid var(--bf-color-border, #cbd5e1);
  border-radius: var(--bf-radius-md);
  background: transparent;
  color: inherit;
}

.invoices__list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--bf-space-3);
}

.invoices__item {
  border: 1px solid var(--bf-color-border, #cbd5e1);
  border-radius: var(--bf-radius-lg);
  padding: var(--bf-space-3);
}

.invoices__head {
  display: flex;
  align-items: center;
  gap: var(--bf-space-2);
}

.invoices__badge {
  font-size: 0.8rem;
  padding: 0 var(--bf-space-2);
  border-radius: var(--bf-radius-full);
  border: 1px solid rgba(245, 158, 11, 0.6);
}

.invoices__badge[data-status='issued'] {
  border-color: rgba(16, 185, 129, 0.6);
}

.invoices__actions {
  display: flex;
  gap: var(--bf-space-2);
}

.invoices__qr {
  margin-top: var(--bf-space-2);
  border-radius: var(--bf-radius-md);
  background: #fff;
}

.invoices__xml {
  margin-top: var(--bf-space-4);
}

.invoices__xml-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.invoices__xml pre {
  overflow-x: auto;
  border: 1px solid var(--bf-color-border, #cbd5e1);
  border-radius: var(--bf-radius-md);
  padding: var(--bf-space-3);
  font-size: 0.75rem;
}
</style>
