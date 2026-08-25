import type { BoqSnapshot } from './boq'
import type { QuotationLanguage, QuotationSnapshot } from './quotation'

/**
 * The bilingual quotation document — its CONTENT, not its pixels.
 * docs/12 §RTL, docs/16 Phase 4 ("bilingual quotation documents")
 *
 * This is the render model a PDF writer consumes: every string already in the
 * requested language, every number already formatted, the direction stated.
 * Keeping it a pure data structure is what makes the Arabic document testable
 * without rendering anything — and an Arabic quotation whose totals silently
 * came out in English digits is exactly the defect nobody catches in review.
 *
 * The PDF binary itself waits for the documents context and object storage
 * (docs/13); when it lands, it renders THIS and nothing else changes.
 */

export interface DocumentLine {
  description: string
  uom: string
  quantity: string
  unitRate: string
  lineTotal: string
}

export interface DocumentSection {
  title: string
  lines: DocumentLine[]
  subtotal: string
}

export interface DocumentTotalRow {
  label: string
  amount: string
  /** Subtracted rather than added — the renderer shows it in parentheses. */
  isDeduction?: boolean
  /** The payable line, emphasised. */
  isTotal?: boolean
}

export interface QuotationDocument {
  language: QuotationLanguage
  /** 'rtl' for Arabic. The renderer must not infer this from the strings. */
  direction: 'rtl' | 'ltr'
  header: {
    title: string
    quotationNumber: string
    issuedLabel: string
    issuedOn: string | null
    validUntilLabel: string
    validUntil: string
    unitLabel: string
    unitName: string
    statusLabel: string
    status: string
  }
  columns: { description: string; uom: string; quantity: string; unitRate: string; total: string }
  sections: DocumentSection[]
  totals: DocumentTotalRow[]
  currency: string
  notes: string | null
  /** Small print the client reads before signing. */
  terms: string[]
}

const STRINGS = {
  en: {
    title: 'Quotation',
    quotationNumber: 'Quotation no.',
    issued: 'Issued',
    validUntil: 'Valid until',
    unit: 'Unit',
    status: 'Status',
    description: 'Description',
    uom: 'Unit',
    quantity: 'Quantity',
    unitRate: 'Rate',
    total: 'Amount',
    subtotal: 'Works subtotal',
    markup: 'Markup',
    discount: 'Discount',
    net: 'Net',
    tax: 'VAT',
    grandTotal: 'Total payable',
    terms: [
      'Prices are valid until the date stated above.',
      'Quantities are estimated from the approved bill of quantities and are subject to site measurement.',
      'Variations requested after acceptance are quoted separately.',
    ],
    statuses: {
      draft: 'Draft',
      sent: 'Sent',
      viewed: 'Viewed',
      accepted: 'Accepted',
      rejected: 'Rejected',
      expired: 'Expired',
    },
  },
  ar: {
    title: 'عرض سعر',
    quotationNumber: 'رقم العرض',
    issued: 'تاريخ الإصدار',
    validUntil: 'صالح حتى',
    unit: 'الوحدة',
    status: 'الحالة',
    description: 'الوصف',
    uom: 'الوحدة',
    quantity: 'الكمية',
    unitRate: 'السعر',
    total: 'المبلغ',
    subtotal: 'إجمالي الأعمال',
    markup: 'هامش الربح',
    discount: 'الخصم',
    net: 'الصافي',
    tax: 'ضريبة القيمة المضافة',
    grandTotal: 'الإجمالي المستحق',
    terms: [
      'الأسعار سارية حتى التاريخ الموضح أعلاه.',
      'الكميات تقديرية وفق جدول الكميات المعتمد وتخضع للقياس في الموقع.',
      'أي تعديلات تُطلب بعد القبول تُسعَّر بشكل منفصل.',
    ],
    statuses: {
      draft: 'مسودة',
      sent: 'مُرسل',
      viewed: 'تمت المشاهدة',
      accepted: 'مقبول',
      rejected: 'مرفوض',
      expired: 'منتهي',
    },
  },
} as const

/** ISO date — unambiguous in both languages, unlike 03/04/2026. */
const isoDate = (date: Date | null): string | null =>
  date === null ? null : date.toISOString().slice(0, 10)

/**
 * Builds the document from the quotation and the BOQ it was derived from.
 *
 * The line rate shown is the COMBINED rate (material + labour + equipment):
 * a client is buying finished work, and itemising the contractor's internal
 * cost split on a client-facing document hands over the margin. The BOQ keeps
 * the breakdown; the quotation states the price.
 */
export function buildQuotationDocument(
  quotation: QuotationSnapshot,
  boq: BoqSnapshot,
  unitName: string,
  language: QuotationLanguage,
): QuotationDocument {
  const t = STRINGS[language]
  const sectionTitles = new Map(
    boq.sections.map((section) => [
      section.id,
      language === 'ar' ? section.titleAr : section.titleEn,
    ]),
  )

  const bySection = new Map<string, DocumentLine[]>()
  for (const line of boq.lines) {
    const combined = (
      Number(line.materialRate) +
      Number(line.labourRate) +
      Number(line.equipmentRate)
    ).toFixed(4)
    const entry: DocumentLine = {
      description: language === 'ar' ? line.descriptionAr : line.descriptionEn,
      uom: line.uom,
      quantity: line.quantityWithWaste,
      unitRate: combined,
      lineTotal: line.lineTotal,
    }
    const existing = bySection.get(line.sectionId)
    if (existing) existing.push(entry)
    else bySection.set(line.sectionId, [entry])
  }

  const sections: DocumentSection[] = boq.sections
    .filter((section) => (bySection.get(section.id)?.length ?? 0) > 0)
    .map((section) => ({
      title: sectionTitles.get(section.id) ?? section.code,
      lines: bySection.get(section.id) ?? [],
      subtotal: section.subtotal,
    }))

  const totals: DocumentTotalRow[] = [{ label: t.subtotal, amount: quotation.basisAmount }]
  // Zero rows are omitted, not printed as 0.00: a client reading "Discount
  // 0.00" wonders what discount they were meant to get.
  if (Number(quotation.markupAmount) > 0) {
    totals.push({
      label: `${t.markup} (${quotation.markupPercentage}%)`,
      amount: quotation.markupAmount,
    })
  }
  if (Number(quotation.discountAmount) > 0) {
    totals.push({ label: t.discount, amount: quotation.discountAmount, isDeduction: true })
  }
  if (Number(quotation.taxAmount) > 0) {
    totals.push({ label: t.net, amount: quotation.netAmount })
    totals.push({ label: `${t.tax} (${quotation.taxPercentage}%)`, amount: quotation.taxAmount })
  }
  totals.push({ label: t.grandTotal, amount: quotation.totalAmount, isTotal: true })

  return {
    language,
    direction: language === 'ar' ? 'rtl' : 'ltr',
    header: {
      title: t.title,
      quotationNumber: quotation.quotationNumber,
      issuedLabel: t.issued,
      issuedOn: isoDate(quotation.sentAt),
      validUntilLabel: t.validUntil,
      validUntil: isoDate(quotation.validUntil) ?? '',
      unitLabel: t.unit,
      unitName,
      statusLabel: t.status,
      status: t.statuses[quotation.status],
    },
    columns: {
      description: t.description,
      uom: t.uom,
      quantity: t.quantity,
      unitRate: t.unitRate,
      total: t.total,
    },
    sections,
    totals,
    currency: quotation.currency,
    notes: quotation.notes,
    terms: [...t.terms],
  }
}
