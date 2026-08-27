<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  SCALE_RATIOS,
  exportFileName,
  exportLayout,
  squareMmToSquareMetres,
  titleBlock,
  type Orientation,
  type PaperSize,
  type ScaleRatio,
} from '@buildflow/spatial'
import type { SheetRenderer } from '@/components/planner/sheet-renderer'
import { usePlannerStore } from '@/stores/planner'

/**
 * Printing a plan. docs/16 Phase 5 sprint 7
 *
 * The SCALE is the point. A plan exported to fill the page is a picture; a
 * plan at 1:100 is a drawing somebody can put a ruler on. So the control
 * offers the standard ratios, defaults to the largest that fits, and prints
 * whichever was actually used in the title block — including when the user
 * forced one that does not fit, which is reported rather than quietly changed.
 *
 * PDF comes from the browser's own print dialog rather than a bundled writer.
 * That follows the same line the estimation module took with quotations: the
 * document's CONTENT is ours, the binary is somebody else's problem until
 * docs/13's document pipeline exists — and it saves shipping 350 kB of PDF
 * library to every user who never prints.
 */

const { t, locale } = useI18n()
const store = usePlannerStore()

const props = defineProps<{ render: SheetRenderer }>()

/** Paper standards, not prose — the same two letters in every language. */
const PAPERS: PaperSize[] = ['A4', 'A3']

const paper = ref<PaperSize>('A3')
const orientation = ref<Orientation>('landscape')
/** Empty means "choose the largest standard scale that fits". */
const ratio = ref<ScaleRatio | ''>('')
const open = ref(false)

const layout = computed(() => {
  const bounds = store.planBounds
  if (!bounds) return null
  return exportLayout({
    bounds,
    paper: paper.value,
    orientation: orientation.value,
    ...(ratio.value === '' ? {} : { scaleRatio: ratio.value }),
  })
})

const block = computed(() => {
  const current = layout.value
  if (!current) return null
  return titleBlock({
    planName: t('planner.sheetTitle'),
    unitLabel: store.planId ? t('planner.sheetUnit', { id: store.planId.slice(0, 8) }) : '',
    layout: current,
    dateLabel: new Date().toLocaleDateString(locale.value),
    areaLabel: `${Number(squareMmToSquareMetres(store.floorAreaMm2)).toFixed(2)} m²`,
  })
})

function sheet(): string | null {
  const current = layout.value
  const heading = block.value
  if (!current || !heading) return null
  return props.render(current, heading)
}

function download() {
  const image = sheet()
  if (!image) return

  const link = document.createElement('a')
  link.href = image
  link.download = `${exportFileName('plan', t('planner.sheetTitle'), new Date().toISOString().slice(0, 10))}.png`
  link.click()
}

/**
 * Hands the sheet to the browser's print dialog, sized in MILLIMETRES.
 *
 * `@page` carries the real paper size and the image is placed at 100 % of it,
 * so "Save as PDF" produces a document whose 1:100 is genuinely 1:100 — as
 * long as the user leaves scaling at 100 %, which the dialog defaults to.
 */
function print() {
  const image = sheet()
  const current = layout.value
  if (!image || !current) return

  const printer = window.open('', '_blank', 'width=900,height=700')
  if (!printer) return

  // Built with DOM calls rather than document.write: the same result, without
  // a deprecated API that browsers have started warning about.
  const sheetStyle = printer.document.createElement('style')
  sheetStyle.textContent = [
    `@page { size: ${current.paperWidthMm}mm ${current.paperHeightMm}mm; margin: 0 }`,
    'html, body { margin: 0; padding: 0 }',
    `img { display: block; width: ${current.paperWidthMm}mm; height: ${current.paperHeightMm}mm }`,
  ].join('\n')

  const picture = printer.document.createElement('img')
  picture.alt = ''
  // A data URL decodes asynchronously; printing before it has painted produces
  // a blank sheet, so the dialog waits for the image itself rather than for the
  // window's load event.
  picture.addEventListener('load', () => {
    printer.focus()
    printer.print()
  })
  picture.src = image

  printer.document.title = t('planner.sheetTitle')
  printer.document.head.append(sheetStyle)
  printer.document.body.append(picture)
}
</script>

<template>
  <div class="export">
    <button type="button" class="export__toggle" :aria-expanded="open" @click="open = !open">
      {{ t('planner.export') }}
    </button>

    <div v-if="open" class="export__panel">
      <p v-if="!layout" class="export__empty">{{ t('planner.exportEmpty') }}</p>

      <template v-else>
        <label class="export__field">
          {{ t('planner.paper') }}
          <select v-model="paper" class="export__input">
            <option v-for="size in PAPERS" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>

        <label class="export__field">
          {{ t('planner.orientation') }}
          <select v-model="orientation" class="export__input">
            <option value="landscape">{{ t('planner.landscape') }}</option>
            <option value="portrait">{{ t('planner.portrait') }}</option>
          </select>
        </label>

        <label class="export__field">
          {{ t('planner.scale') }}
          <select v-model="ratio" class="export__input">
            <option value="">{{ t('planner.scaleAuto') }}</option>
            <option v-for="value in SCALE_RATIOS" :key="value" :value="value">
              {{ t('planner.scaleRatio', { ratio: value }) }}
            </option>
          </select>
        </label>

        <p class="export__summary">
          {{
            t('planner.sheetSummary', {
              scale: layout.scaleLabel,
              width: layout.widthPx,
              height: layout.heightPx,
            })
          }}
        </p>
        <p v-if="!layout.fits" class="export__warning">{{ t('planner.doesNotFit') }}</p>

        <div class="export__actions">
          <button type="button" class="export__button" @click="download">
            {{ t('planner.downloadPng') }}
          </button>
          <button type="button" class="export__button" @click="print">
            {{ t('planner.printPdf') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.export {
  position: relative;
  font-size: 0.875rem;
}

.export__toggle,
.export__button {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.export__panel {
  position: absolute;
  z-index: 10;
  inset-block-start: 2.2rem;
  inset-inline-start: 0;
  inline-size: 18rem;
  padding: 0.6rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.5rem;
  background: var(--color-surface, #fff);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
}

.export__field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-block-end: 0.4rem;
}

.export__input {
  flex: 1;
  padding: 0.25rem 0.35rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.3rem;
  font: inherit;
  font-size: 0.8125rem;
}

.export__summary,
.export__empty {
  margin: 0.4rem 0;
  font-size: 0.75rem;
  color: var(--color-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

.export__warning {
  margin: 0.25rem 0;
  font-size: 0.75rem;
  color: #b45309;
}

.export__actions {
  display: flex;
  gap: 0.35rem;
  margin-block-start: 0.5rem;
}
</style>
