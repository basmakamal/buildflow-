# 12 — Internationalization, RTL & Regional Configuration

Arabic is a **first-class language**, not a translation applied to an English product. The
difference shows in a hundred small decisions — and getting them wrong is instantly obvious to
the people who will buy this software.

---

## 1. Scope

| Dimension | v1 | Roadmap |
|---|---|---|
| Languages | Arabic (`ar`), English (`en`) | French, Urdu, Hindi (large GCC labour populations) |
| Directions | RTL, LTR | — |
| Countries | Saudi Arabia, UAE, Egypt, Kuwait, Qatar, Bahrain, Oman | Jordan, Iraq, Morocco |
| Currencies | SAR, AED, EGP, KWD, QAR, BHD, OMR, USD | Multi-currency per project |
| Calendars | Gregorian (default), Hijri display | Hijri input |
| Measurement | Metric (default), Imperial | — |

---

## 2. What gets translated, and how

Three distinct categories, three distinct mechanisms. Conflating them is the most common i18n
architecture mistake.

| Category | Example | Mechanism | Who edits |
|---|---|---|---|
| **UI strings** | "Save", "Overdue stages" | JSON/ARB message catalogues | Developers + translators |
| **System reference data** | Stage names, room types, permission labels | Paired `name_en` / `name_ar` columns | Product team, in seed data |
| **Tenant content** | Client names, project names, custom stage names, material descriptions | `translations` table, or paired columns where always bilingual | The tenant's own users |

### 2.1 Why paired columns for reference data

`vtiger`-style translation tables for a fixed, small, always-bilingual set add a join to every
query for no benefit. A room type is *always* needed in both languages, and there are ~20 of
them. `name_en` + `name_ar` on the row is simpler, faster, and honest about the requirement.

### 2.2 Why a translation table for tenant content

Tenant content is **optionally** multilingual and open-ended. A contractor may name a custom
stage only in Arabic. A material description may exist in three languages for an
export-oriented supplier. Forcing paired columns would mean adding a column per language
forever, so the `translations` table (`entity_type`, `entity_id`, `field`, `locale`, `value`) is
the right shape here — with a fallback chain: requested locale → company default → any available.

---

## 3. Frontend i18n

### 3.1 Namespaced message catalogues

```
locales/
├── en/  common.json  auth.json  projects.json  units.json  workflow.json
│       materials.json  procurement.json  boq.json  planner.json  reports.json  errors.json
└── ar/  (same files)
```

Namespaces are loaded lazily per route. A client-portal user downloads `common` + `portal` — not
the 40 KB planner catalogue they will never see.

### 3.2 Key conventions

```json
{
  "unit": {
    "title": "Unit",
    "title_plural": "Units",
    "fields": { "grossArea": "Gross area", "ceilingHeight": "Ceiling height" },
    "actions": { "clone": "Clone unit", "deliver": "Mark as delivered" },
    "status": { "in_progress": "In progress", "delivered": "Delivered" },
    "messages": {
      "cloneSuccess": "Unit {unitNumber} cloned successfully",
      "roomCount": "No rooms | 1 room | {count} rooms"
    }
  }
}
```

Rules: dot-namespaced by feature · never reuse a key across contexts (the same English word
often needs different Arabic words) · always use named interpolation, never positional (word
order differs between languages) · always use plural rules, never string concatenation.

### 3.3 Arabic pluralisation

Arabic has **six** plural forms: zero, one, two, few (3–10), many (11–99), other (100+). English
has two. Any code that assumes `count === 1 ? singular : plural` is broken in Arabic.

```json
"stageCount": "لا توجد مراحل | مرحلة واحدة | مرحلتان | {count} مراحل | {count} مرحلة | {count} مرحلة"
```

`vue-i18n` and Flutter `intl` both implement CLDR plural rules; the requirement is simply that
developers never hand-roll the logic. A lint rule flags ternary-based pluralisation.

### 3.4 The no-hardcoded-strings rule

An ESLint rule (`vue/no-bare-strings-in-template` plus a custom check on `.ts`) fails the build
on any user-facing literal. This is enforced from commit one — retrofitting i18n into a codebase
with 4,000 hardcoded strings is a multi-month project nobody ever funds.

---

## 4. RTL

### 4.1 Direction is a document attribute

```ts
watch(locale, (l) => {
  const dir = RTL_LOCALES.has(l) ? 'rtl' : 'ltr'
  document.documentElement.setAttribute('dir', dir)
  document.documentElement.setAttribute('lang', l)
})
```

No page reload, no logout, no re-render of the whole tree — CSS logical properties do the work.

### 4.2 CSS logical properties everywhere

| ❌ Physical | ✅ Logical |
|---|---|
| `margin-left` | `margin-inline-start` |
| `padding-right` | `padding-inline-end` |
| `text-align: left` | `text-align: start` |
| `left: 0` | `inset-inline-start: 0` |
| `border-left` | `border-inline-start` |
| `float: right` | `float: inline-end` |

Tailwind is configured with logical utilities (`ps-4`, `me-2`, `text-start`, `start-0`), so a
single class works in both directions. A stylelint rule bans physical properties in application
CSS; the few genuine exceptions (a chevron that must always point the same way regardless of
direction) require an inline justification comment.

### 4.3 What flips and what does not

| Element | RTL behaviour |
|---|---|
| Layout, navigation, sidebar | **Mirror** |
| Text alignment, list bullets | **Mirror** |
| Tables (column order, headers) | **Mirror** |
| Form labels and inputs | **Mirror** |
| Progress bars, sliders | **Mirror** — fill grows right-to-left |
| Timelines, Gantt charts | **Mirror** — time flows right-to-left |
| Directional icons (back, next, arrows) | **Mirror** |
| **Numbers** | **Never flip** — digits are always LTR, even in Arabic text |
| **Phone numbers, emails, URLs** | **Never flip** — force `direction: ltr` on those fields |
| **Currency amounts** | Never flip the digits; the symbol position follows locale convention |
| Media controls (play, pause) | Do not flip — universal convention |
| Logos, brand marks | Do not flip |
| **Floor plans and 3D scenes** | **Do not flip** — a building's geometry is physical reality, not a reading direction. Only the surrounding UI chrome mirrors |
| Charts | Axis direction mirrors; data mapping does not change |

> The floor-plan rule matters enormously and is frequently got wrong. Mirroring a plan in RTL
> would place the kitchen on the wrong side of the actual apartment. The canvas stays fixed; the
> toolbar, panels, and rulers mirror around it.

### 4.4 Bidirectional text

Mixed Arabic/Latin content — "شقة 305 in Al Nakheel Tower" — needs explicit isolation, or the
punctuation and number placement scramble:

```html
<span dir="auto">{{ mixedContent }}</span>
<bdi>{{ userGeneratedName }}</bdi>
```

`<bdi>` around every user-generated name is a small habit that eliminates an entire class of
"the text looks broken" reports.

### 4.5 Typography

| | Arabic | English |
|---|---|---|
| Font | IBM Plex Sans Arabic / Noto Sans Arabic | Inter |
| Base size | 16 px | 15 px |
| Line height | 1.75 | 1.55 |
| Letter spacing | **0 — never adjust** | Normal |
| Font weights | 400 / 500 / 700 | 400 / 500 / 600 / 700 |

Arabic script needs more vertical space because of its ascenders and descenders, and it must
never receive letter-spacing — the letters connect, and spacing them breaks the word shapes.
Fonts are preloaded per locale to avoid a layout shift on switch.

### 4.6 Numerals as a user preference

Arabic-speaking users in the Gulf overwhelmingly read **Western digits** (1234) in business
software, while Egyptian users more often expect Eastern Arabic digits (١٢٣٤). Tying numeral
system to language forces a wrong default on one group.

So numerals are a **per-user preference** defaulting to Western, independent of interface
language. Financial screens always use Western digits regardless of the preference — misreading
a cost figure is a costly error, and Western digits are what every invoice and bank statement in
the region uses.

---

## 5. Regional configuration

Per company, stored as data — never as code, never as an environment variable:

| Setting | Options | Default source |
|---|---|---|
| Country | SA, AE, EG, KW, QA, BH, OM | Signup |
| Currency | SAR, AED, EGP, KWD, QAR, BHD, OMR, USD | Country |
| Currency display | Symbol/code, position, decimal places | Country |
| Measurement | Metric / Imperial | Country |
| Date format | `dd/MM/yyyy`, `yyyy-MM-dd` | Country |
| Calendar | Gregorian, Hijri display | Country |
| **Week start** | Sunday (KSA, EG, AE) / Monday (EU) | Country |
| **Weekend days** | Fri–Sat (most GCC), Sat–Sun | Country |
| Timezone | IANA | Country |
| Tax rate & label | 15 % VAT (SA), 5 % (AE), 14 % (EG) | Country + effective date |
| Fiscal year start | Month | Country |
| Number format | Decimal and thousands separators | Locale |

**Weekend configuration is not cosmetic.** Every working-day calculation — planned stage
durations, delay computation, the Gantt chart, SLA timers — depends on it. A system that assumes
Saturday–Sunday will report a Saudi project as delayed every single week.

### 5.1 Currency handling

- Amounts stored as `DECIMAL(18,4)` + an explicit currency code. Never a bare number.
- KWD, BHD, and OMR have **three** decimal places, not two. A hard-coded 2-decimal assumption
  produces wrong invoices in Kuwait.
- One project uses one currency. Multi-currency *within* a project is deferred (Phase 7) because
  it demands exchange-rate policy decisions (rate at PO date? invoice date? payment date?) that
  should be made deliberately with real customers, not guessed.
- Historical exchange rates are stored on the transaction, so a report from last year is not
  silently re-valued at today's rate.
- Display formatting via `Intl.NumberFormat` with the company's locale and currency.

### 5.2 Tax

```
tax_profiles: (country, label_en, label_ar, rate, effective_from, effective_to)
```

Effective dating is mandatory. Saudi VAT moved from 5 % to 15 % in July 2020; a system without
effective dates would retroactively re-tax every historical invoice — a real problem that
happened to real systems in that market.

Invoice documents render the tax label in the tenant's language
(`ضريبة القيمة المضافة 15%` / `VAT 15%`) and include the registration number, which is a legal
requirement for a valid tax invoice in KSA and the UAE.

### 5.3 Dates and calendars

- **Storage is always UTC.** Always. Every timestamp, without exception.
- Display converts to the company timezone, then formats per locale.
- Hijri is a **display option**, shown alongside Gregorian
  (`15 Aug 2026 / ٢٢ صفر ١٤٤٨`), because contracts and government submissions in KSA often
  reference Hijri dates while operational systems run on Gregorian.
- Working-day arithmetic honours the configured weekend and a per-country public-holiday
  calendar (including movable Islamic holidays, which cannot be computed from a fixed rule and
  are therefore maintained as data).

---

## 6. Localised document generation

PDFs and Excel exports are where RTL support usually collapses. Specific measures:

| Concern | Solution |
|---|---|
| PDF engine | Puppeteer rendering HTML — the same CSS logical properties that work in the browser work in the PDF, so there is one layout implementation, not two |
| Arabic shaping | Embedded Arabic fonts with full shaping; **never** a font subset that drops ligatures |
| Table direction | Column order mirrors in RTL; numeric columns stay LTR-aligned |
| Numbers in tables | Always Western digits, right-aligned in both directions for column scanning |
| Excel export | `ExcelJS` with `rightToLeft: true` on the worksheet, Arabic-capable fonts, and explicit cell number formats |
| BOQ documents | Fully bilingual layout option: Arabic description and English description as adjacent columns — what clients in the region actually ask for |
| Letterhead | Per-tenant logo, address, tax number, rendered in the document language |

---

## 7. Translation workflow

```
Developer adds an English key
  → CI detects a missing Arabic key and FAILS the build
  → key exported to the translation platform (Crowdin/Lokalise)
  → professional translator with construction-domain context
  → in-context screenshot review
  → import back, PR, merge
```

**No feature ships English-only.** The CI gate is what makes this real: a missing Arabic key is a
build failure, not a backlog item that quietly accumulates for two years.

**A domain glossary is maintained and enforced** so terminology is consistent across the web app,
the mobile app, PDFs, and emails:

| English | Arabic | Note |
|---|---|---|
| Unit | وحدة | not شقة — a unit may be a villa or an office |
| Stage | مرحلة | |
| Finishing | تشطيب | |
| Red brick | على المحارة | the trade term, not a literal translation |
| BOQ | جدول الكميات | |
| Snag | ملاحظة تسليم | |
| Handover | تسليم | |
| Waste factor | نسبة الهالك | |
| Wastage | هالك | |
| Take-off | حصر الكميات | |

The glossary matters more than the translation quality itself. A contractor who reads
"على المحارة" recognises their own trade language instantly; a literal translation of "red brick"
would read as software written by outsiders — and that impression, once formed, is hard to
reverse in a relationship-driven market.

---

## 8. Testing

| Test | Method |
|---|---|
| Missing keys | CI diff of `en` vs `ar` key sets — build fails on any gap |
| Unused keys | Reported weekly, pruned quarterly |
| Hardcoded strings | ESLint rule, build-blocking |
| RTL layout | Playwright visual regression on every key screen in both directions |
| Text expansion | Pseudo-locale test with 40 % longer strings, catching truncation and overflow before Arabic reveals it |
| Bidirectional text | Fixture set of mixed Arabic/Latin/numeric content on every text-rendering component |
| Number/date formatting | Unit tests per locale, including 3-decimal currencies |
| Working days | Unit tests per country weekend and holiday configuration |
| PDF output | Golden-file comparison for Arabic and English BOQ and report documents |
| Mobile RTL | Flutter golden tests per screen, both directions |

---

## 9. Pitfalls this design explicitly avoids

| Pitfall | Consequence if unaddressed |
|---|---|
| Hardcoded strings | A months-long retrofit nobody funds; permanent English leakage |
| Physical CSS properties | Broken RTL layout in a hundred places, fixed one bug report at a time |
| Concatenated sentences | Ungrammatical Arabic — word order differs fundamentally |
| Assuming 2 plural forms | Wrong grammar on every count in Arabic |
| Flipping numbers in RTL | Unreadable, and dangerous on financial screens |
| Mirroring floor plans | Rooms shown on the wrong side of the actual apartment |
| Hardcoded Sat–Sun weekend | Every GCC project reported as permanently delayed |
| Currency without effective-dated tax | Historical invoices silently re-taxed |
| 2-decimal currency assumption | Wrong amounts in Kuwait, Bahrain, and Oman |
| Locale-derived numerals | Wrong default for a large share of users; misread costs |
| Font subsetting without shaping | Arabic renders as disconnected letters — the classic broken-PDF symptom |
