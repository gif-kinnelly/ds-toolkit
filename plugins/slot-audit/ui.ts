// Slot Audit — UI.
import type { SlotSummary } from '../../src/slots/audit';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: Record<string, unknown>) => parent.postMessage({ pluginMessage: m }, '*');
const say = (t: string, err = false) => { const s = $('status'); s.textContent = t; s.className = err ? 'error' : ''; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const VIOL: Record<string, string> = { BELOW_MIN: 'too few items', ABOVE_MAX: 'too many items', HAS_NON_PREFERRED: 'non-preferred content' };
const opts = () => ({ scope: $<HTMLSelectElement>('scope').value, share: Number($<HTMLSelectElement>('share').value) });
let slots: SlotSummary[] = [];

function render(m: { slots: SlotSummary[]; instances: number }) {
  slots = m.slots;
  if (!slots.length) { $('out').innerHTML = '<p class="sum">No instances with slots found.</p>'; return; }
  const broken = slots.reduce((n, s) => n + Object.values(s.violations).reduce((a, v) => a + v.length, 0), 0);
  const noRules = slots.filter((s) => !s.rules.length).length;
  $('out').innerHTML = `<p class="sum">${plural(slots.length, 'slot')} on ${plural(m.instances, 'instance')}: ${broken ? `${plural(broken, 'broken limit')}` : 'no broken limits'}${noRules ? `, ${noRules} with no rules` : ''}.</p>` + slots.map((s, i) => {
    const viol = Object.entries(s.violations).filter(([, ids]) => ids.length)
      .map(([k, ids]) => `<div class="viol">${plural(ids.length, 'slot')}: ${VIOL[k]}<a data-ids="${ids.join(',')}">Show</a></div>`).join('');
    const max = Math.max(1, ...s.content.map((c) => c.slots));
    const bars = s.content.slice(0, 8).map((c) => `<div class="bar ${c.kind}"><span>${esc(c.kind === 'raw' ? `${c.name.toLowerCase()} (not a component)` : c.name)}</span><span class="t"><i style="width:${(c.slots / max) * 100}%"></i></span><span class="n">${c.slots}</span></div>`).join('');
    const sugg = s.suggestedPreferred;
    const act = s.local && sugg.length
      ? `<div class="act"><span>Prefer ${esc(sugg.map((x) => x.name).join(', '))}</span><label><input type="checkbox" data-only="${i}"> only these</label><button class="small" data-prefer="${i}">Set preferred</button></div>`
      : !s.local ? '<div class="act"><span>From a library: change its slot settings in the library file.</span></div>' : '';
    return `<div class="slot"><div class="hd"><b>${esc(s.component)} › ${esc(s.slot)}</b>${s.rules.length ? s.rules.map((r) => `<span class="tag">${esc(r)}</span>`).join('') : '<span class="tag none">no rules</span>'}<span class="uses">${plural(s.uses, 'use')}${s.empty ? ` · ${s.empty} empty` : ''}</span></div>${viol}<div class="bars">${bars}</div>${act}</div>`;
  }).join('');
  $('out').querySelectorAll<HTMLAnchorElement>('a[data-ids]').forEach((a) => { a.onclick = () => send({ type: 'select', ids: a.dataset.ids!.split(',') }); });
  $('out').querySelectorAll<HTMLButtonElement>('button[data-prefer]').forEach((b) => {
    b.onclick = () => {
      const s = slots[Number(b.dataset.prefer)];
      const only = $('out').querySelector<HTMLInputElement>(`input[data-only="${b.dataset.prefer}"]`)!.checked;
      say('Saving…');
      send({ type: 'prefer', componentId: s.componentId, propertyKey: s.propertyKey, keys: s.suggestedPreferred.map((p) => ({ key: p.key, type: p.type })), only, ...opts() });
    };
  });
}

onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'progress') say(m.text);
  if (m.type === 'summary') { render(m); say(''); }
  if (m.type === 'error') say(m.message, true);
};
$('scan').onclick = () => send({ type: 'scan', ...opts() });
