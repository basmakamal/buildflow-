/**
 * Generates a standalone icon gallery for design review.
 *
 * Deliberately zero-dependency and parses the source with a regex rather than
 * importing it: the whole point is that a designer or a client can open one
 * HTML file and review every icon WITHOUT pnpm install, a build step, or a dev
 * server. Design review should never be gated on a working toolchain.
 *
 * Run:  node packages/ui/scripts/build-icon-gallery.mjs
 * Out:  packages/ui/icon-gallery.html
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(here, '..', 'src', 'icons')
const outFile = join(here, '..', 'icon-gallery.html')

const GROUPS = [
  { file: 'stages.ts', en: 'Finishing stages', ar: 'مراحل التشطيب' },
  { file: 'electrical.ts', en: 'Electrical', ar: 'الكهرباء' },
  { file: 'lighting.ts', en: 'Lighting', ar: 'الإنارة' },
  { file: 'ceiling.ts', en: 'Ceilings & gypsum', ar: 'الأسقف والجبس' },
  { file: 'furniture.ts', en: 'Furniture & furnishings', ar: 'العفش والمفروشات' },
]

/**
 * Trade colours are READ FROM tokens.css, never restated here.
 *
 * An earlier version of this script hardcoded them and had already drifted from
 * the stylesheet on two values (stage-lighting and stage-gypsum) before anyone
 * noticed. A gallery that shows different colours from the product is worse
 * than no gallery, so the stylesheet is the single source of truth and this
 * file parses it.
 *
 * Strokes resolve to the `-ink` variant: the base palette is tuned for filled
 * areas and several values fall below 2:1 as a 1.5px stroke.
 */
const tokensCss = readFileSync(join(here, '..', 'src', 'tokens', 'tokens.css'), 'utf8')

function readToken(name) {
  const m = new RegExp(`--bf-${name}:\\s*([^;]+);`).exec(tokensCss)
  return m ? m[1].trim() : null
}

const STAGE_KEYS = {
  'stage-unit-received': 'received',
  'stage-demolition': 'demolition',
  'stage-plumbing': 'plumbing',
  'stage-electrical': 'electrical',
  'stage-hvac': 'hvac',
  'stage-waterproofing': 'waterproofing',
  'stage-plastering': 'plastering',
  'stage-gypsum': 'gypsum',
  'stage-flooring': 'flooring',
  'stage-painting': 'painting',
  'stage-carpentry': 'carpentry',
  'stage-lighting': 'lighting',
  'stage-cleaning': 'cleaning',
  'stage-delivery': 'delivery',
}

const PREFIX_KEYS = [
  ['elec-', 'tone-electrical'],
  ['light-', 'tone-lighting'],
  ['plumb-', 'tone-plumbing'],
  ['hvac-', 'tone-hvac'],
  ['ceiling-', 'tone-ceiling'],
  ['floor-', 'tone-flooring'],
  ['wall-', 'tone-wall'],
  ['join-', 'tone-joinery'],
  ['furn-', 'tone-furniture'],
]

/** Stroke colour (ink for stages). */
function toneFor(name) {
  const stage = STAGE_KEYS[name]
  if (stage) return readToken(`stage-${stage}-ink`)
  const hit = PREFIX_KEYS.find(([p]) => name.startsWith(p))
  return hit ? readToken(hit[1]) : null
}

/** Chip backdrop derives from the brighter base colour, matching tones.ts. */
function tintBaseFor(name) {
  const stage = STAGE_KEYS[name]
  if (stage) return readToken(`stage-${stage}`)
  return toneFor(name)
}

/** Extracts each icon definition block from a source file. */
function parseIcons(source) {
  const icons = []
  // Match: key: { ... },  at one nesting level inside defineIcons({ ... })
  const blockRe = /\n {2}\w+:\s*\{([\s\S]*?)\n {2}\},/g
  let m
  while ((m = blockRe.exec(source)) !== null) {
    const block = m[1]
    const pick = (key) => {
      const r = new RegExp(`${key}:\\s*'([^']*)'`).exec(block)
      return r ? r[1] : ''
    }
    const bodyMatch = /body:\s*`([\s\S]*?)`/.exec(block)
    if (!bodyMatch) continue
    icons.push({
      name: pick('name'),
      labelEn: pick('labelEn'),
      labelAr: pick('labelAr'),
      body: bodyMatch[1].trim(),
    })
  }
  return icons
}

const groups = GROUPS.map(({ file, en, ar }) => {
  const src = readFileSync(join(iconsDir, file), 'utf8')
  return { en, ar, icons: parseIcons(src) }
}).filter((g) => g.icons.length > 0)

const total = groups.reduce((n, g) => n + g.icons.length, 0)

const cards = groups
  .map(
    (g) => `
  <section class="group">
    <h2><span>${g.en}</span><span class="ar">${g.ar}</span><em>${g.icons.length}</em></h2>
    <div class="grid">
      ${g.icons
        .map((i) => {
          const tone = toneFor(i.name) ?? '#78716c'
          const tint = tintBaseFor(i.name) ?? tone
          const svg = (px) =>
            `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" ` +
            `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${i.body}</svg>`
          return `<figure class="card" style="--tone:${tone};--tint:${tint}" data-search="${i.name} ${i.labelEn.toLowerCase()} ${i.labelAr}">
        <div class="sizes">
          <span class="chip">${svg(24)}</span>
          ${svg(24)}
          ${svg(16)}
        </div>
        <figcaption>
          <b>${i.labelAr}</b>
          <span>${i.labelEn}</span>
          <code>${i.name}</code>
        </figcaption>
      </figure>`
        })
        .join('\n      ')}
    </div>
  </section>`,
  )
  .join('\n')

const html = `<!doctype html>
<html lang="en" dir="ltr" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuildFlow — Icon Library</title>
<style>
  :root{
    --primary:#1b5e4a; --accent:#e8a33d;
    --bg:#fafaf9; --surface:#fff; --border:#e7e5e4; --text:#1c1917; --muted:#78716c;
    font-family:'IBM Plex Sans Arabic','Inter',ui-sans-serif,system-ui,'Segoe UI',sans-serif;
  }
  [data-theme="dark"]{
    --bg:#0f0e0d; --surface:#1c1917; --border:#292524; --text:#f5f5f4; --muted:#a8a29e;
    --primary:#3f9a79;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       transition:background .25s,color .25s}
  header{position:sticky;top:0;z-index:10;background:var(--surface);
         border-bottom:1px solid var(--border);padding:20px 28px;
         display:flex;gap:20px;align-items:center;flex-wrap:wrap}
  h1{margin:0;font-size:19px;font-weight:600;letter-spacing:-.01em}
  h1 small{display:block;font-weight:400;font-size:12.5px;color:var(--muted);margin-top:3px}
  .spacer{flex:1}
  input[type=search]{padding:9px 14px;border:1px solid var(--border);border-radius:8px;
    background:var(--bg);color:var(--text);font:inherit;font-size:14px;min-width:230px;outline:none}
  input[type=search]:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 20%,transparent)}
  button{padding:9px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg);
    color:var(--text);font:inherit;font-size:13px;cursor:pointer;transition:all .15s}
  button:hover{border-color:var(--primary);color:var(--primary)}
  button.on{background:var(--primary);color:#fff;border-color:var(--primary)}
  main{padding:28px;max-width:1400px;margin:0 auto}
  .group{margin-bottom:40px}
  .group h2{display:flex;align-items:baseline;gap:12px;font-size:14px;font-weight:600;
    text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
    margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
  .group h2 .ar{text-transform:none;letter-spacing:0;font-size:15px;color:var(--text)}
  .group h2 em{margin-inline-start:auto;font-style:normal;font-size:12px;
    background:var(--bg);border:1px solid var(--border);border-radius:99px;padding:2px 9px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
  .card{margin:0;background:var(--surface);border:1px solid var(--border);border-radius:12px;
    padding:16px 12px 12px;text-align:center;transition:all .15s;cursor:pointer}
  .card:hover{border-color:var(--tone);transform:translateY(-2px);
    box-shadow:0 6px 20px -8px color-mix(in srgb,var(--tone) 45%,transparent)}
  .card.hidden{display:none}
  /* Colour is semantic: every icon carries its trade colour, so the category
     is readable before the label is. */
  .sizes{display:flex;align-items:center;justify-content:center;gap:12px;
    color:var(--tone);min-height:52px;margin-bottom:12px}
  .chip{display:inline-flex;align-items:center;justify-content:center;padding:8px;
    border-radius:9px;background:color-mix(in srgb,var(--tint) 16%,transparent);line-height:0}
  body.mono .sizes{color:var(--text)}
  body.mono .chip{background:color-mix(in srgb,var(--text) 8%,transparent)}
  figcaption b{display:block;font-size:13.5px;font-weight:600;margin-bottom:2px}
  figcaption span{display:block;font-size:11.5px;color:var(--muted)}
  figcaption code{display:block;font-size:10px;color:var(--muted);margin-top:6px;
    font-family:ui-monospace,Menlo,monospace;opacity:.75;word-break:break-all}
  .empty{text-align:center;color:var(--muted);padding:60px;font-size:15px}
  footer{padding:24px 28px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);
    text-align:center}
  .toast{position:fixed;inset-inline-end:24px;inset-block-end:24px;background:var(--primary);
    color:#fff;padding:11px 18px;border-radius:9px;font-size:13.5px;opacity:0;
    transform:translateY(8px);transition:all .2s;pointer-events:none}
  .toast.show{opacity:1;transform:none}
</style>
</head>
<body>
<header>
  <h1>BuildFlow Icon Library<small>${total} domain icons · 24px grid · 1.5 stroke · currentColor</small></h1>
  <div class="spacer"></div>
  <input type="search" id="q" placeholder="Search / بحث…" aria-label="Search icons">
  <button id="mono">Mono</button>
  <button id="rtl">RTL</button>
  <button id="theme">Dark</button>
</header>
<main id="main">
${cards}
  <p class="empty" id="empty" style="display:none">No icons match that search.</p>
</main>
<footer>Click any icon to copy its name · generated by <code>build-icon-gallery.mjs</code></footer>
<div class="toast" id="toast"></div>
<script>
  const q=document.getElementById('q'),empty=document.getElementById('empty'),toast=document.getElementById('toast');
  q.addEventListener('input',()=>{
    const t=q.value.trim().toLowerCase();let shown=0;
    document.querySelectorAll('.card').forEach(c=>{
      const hit=!t||c.dataset.search.includes(t);
      c.classList.toggle('hidden',!hit); if(hit)shown++;
    });
    document.querySelectorAll('.group').forEach(g=>{
      g.style.display=g.querySelectorAll('.card:not(.hidden)').length?'':'none';
    });
    empty.style.display=shown?'none':'block';
  });
  document.querySelectorAll('.card').forEach(c=>c.addEventListener('click',()=>{
    const name=c.querySelector('code').textContent;
    navigator.clipboard?.writeText(name);
    toast.textContent='Copied '+name; toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'),1400);
  }));
  document.getElementById('mono').addEventListener('click',e=>{
    const on=document.body.classList.toggle('mono');
    e.target.classList.toggle('on',on);
  });
  document.getElementById('rtl').addEventListener('click',e=>{
    const rtl=document.documentElement.dir==='rtl';
    document.documentElement.dir=rtl?'ltr':'rtl';
    e.target.classList.toggle('on',!rtl);
  });
  document.getElementById('theme').addEventListener('click',e=>{
    const dark=document.documentElement.dataset.theme==='dark';
    document.documentElement.dataset.theme=dark?'light':'dark';
    e.target.textContent=dark?'Dark':'Light'; e.target.classList.toggle('on',!dark);
  });
</script>
</body>
</html>
`

writeFileSync(outFile, html, 'utf8')

// --- Integrity checks. These run on every generate so the library cannot rot.
const names = groups.flatMap((g) => g.icons.map((i) => i.name))

const dupes = names.filter((n, i) => names.indexOf(n) !== i)
if (dupes.length) {
  console.error('Duplicate icon names:', dupes)
  process.exit(1)
}

// An icon with no tone would silently render grey and look like a bug rather
// than read as a bug — so it fails the build instead.
const untoned = names.filter((n) => toneFor(n) === null)
if (untoned.length) {
  console.error('Icons with no trade tone (check the name prefix against tones.ts):', untoned)
  process.exit(1)
}

const unlabelled = groups.flatMap((g) => g.icons.filter((i) => !i.labelAr).map((i) => i.name))
if (unlabelled.length) {
  console.error('Icons missing an Arabic label:', unlabelled)
  process.exit(1)
}

console.warn(`Icon gallery: ${total} icons across ${groups.length} groups → ${outFile}`)
