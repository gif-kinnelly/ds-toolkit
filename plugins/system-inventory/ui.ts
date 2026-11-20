// System Inventory — UI.
import type { Proposal, ScaleStep } from '../../src/inventory/cluster';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: Record<string, unknown>) => parent.postMessage({ pluginMessage: m }, '*');
const say = (t: string, err = false) => { const s = $('status'); s.textContent = t; s.className = err ? 'error' : ''; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
let dtcg = '';

const tail = (name: string) => name.split('/').slice(1).join('/');
const mergedNote = (m: { value: string | number }[]) => (m.length ? `<span class="m" title="${esc(m.map((x) => String(x.value)).join(', '))}">+${m.length}</span>` : '');

function scaleChips(steps: ScaleStep[], unit = 'px') {
  return steps.map((s) => s.offGrid
    ? `<span class="chip off" title="Not on the grid: worth fixing in the designs">${s.value}${unit} <span class="c">×${s.count}</span> off-grid</span>`
    : `<span class="chip"><b>${esc(tail(s.name))}</b> ${s.value === 9999 ? '∞' : s.value + unit} <span class="c">×${s.count}</span>${mergedNote(s.merged)}</span>`).join('');
}

function render(m: { proposal: Proposal; raw: Record<string, number>; layers: number; dtcg: string }) {
  const p = m.proposal;
  dtcg = m.dtcg;
  const fams = new Map<string, Proposal['colors']>();
  for (const c of p.colors) {
    const f = c.name.split('/')[1];
    fams.set(f, [...(fams.get(f) ?? []), c]);
  }
  const colorRows = [...fams.entries()].map(([f, cs]) => `<div class="fam"><span>${esc(f)}</span><div class="chips">${cs
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((c) => `<span class="chip"><span class="sw" style="background:${c.hex}"></span><span><b>${esc(c.name.split('/').slice(2).join('/') || f)}</b> ${c.hex}<br><span class="c">×${c.count}</span> ${mergedNote(c.merged)}</span></span>`).join('')}</div></div>`).join('');
  const off = p.spacing.filter((s) => s.offGrid);
  const merged = p.colors.reduce((n, c) => n + c.merged.length, 0);
  $('out').innerHTML = `
    <p class="sum">${m.layers} layers: ${m.raw.colors} colors → ${p.colors.length}${merged ? ` (${merged} near-duplicates merged)` : ''}, ${m.raw.spacing} spacing values → ${p.spacing.length - off.length}${off.length ? ` + ${off.length} off-grid` : ''}, ${m.raw.radii} radii → ${p.radii.length}, ${m.raw.fontSizes} font sizes, ${m.raw.type} type combinations.</p>
    <h3>Colors <small>+N = near-duplicates merged in</small></h3>${colorRows || '<p class="m">None</p>'}
    <h3>Spacing</h3><div class="chips">${scaleChips(p.spacing)}</div>
    <h3>Radius</h3><div class="chips">${scaleChips(p.radii)}</div>
    <h3>Font size</h3><div class="chips">${scaleChips(p.fontSizes)}</div>
    <h3>Text styles <small>most used combinations</small></h3>
    <table><thead><tr><th>Proposed name</th><th>Font</th><th>Size / line</th><th>Uses</th></tr></thead><tbody>${p.type.map((t) => `<tr><td>${esc(tail(t.name))}</td><td>${esc(t.family)} ${t.weight}</td><td>${t.size} / ${esc(String(t.lineHeight))}</td><td class="num">${t.count}</td></tr>`).join('')}</tbody></table>
    <div class="row"><button id="dl" class="secondary">Download tokens (DTCG)</button><input id="colName" type="text" value="Inventory" size="12" title="Collection name" /><button id="create">Create variables + text styles</button></div>`;
  $('dl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([dtcg], { type: 'application/json' }));
    a.download = 'Inventory.tokens.json';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('create').onclick = () => { say('Creating…'); send({ type: 'create', collection: $<HTMLInputElement>('colName').value }); };
}

onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'progress') say(m.text);
  if (m.type === 'proposal') { render(m); say(''); }
  if (m.type === 'created') {
    say('');
    const next = document.createElement('div');
    next.className = 'next';
    next.textContent = `Created ${m.variables} variables and ${m.styles} text styles.${m.skipped.length ? ` Skipped: ${m.skipped.join('; ')}.` : ''} Next: run Token Rebinder with "near" colors and "within 1px" numbers to bind the screens to them.`;
    $('out').appendChild(next);
  }
  if (m.type === 'error') say(m.message, true);
};

$('scan').onclick = () => send({
  type: 'scan', scope: $<HTMLSelectElement>('scope').value, merge: Number($<HTMLSelectElement>('merge').value),
  grid: Number($<HTMLSelectElement>('grid').value), includeTokenized: $<HTMLInputElement>('tok').checked,
});
