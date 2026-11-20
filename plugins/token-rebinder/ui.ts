// Token Rebinder — UI.
type Sugg = { id: string; name: string; collection: string; distance: number; value: string | number };
type G = { key: string; family: string; color: boolean; value: string; count: number; layerCount: number; layers: string[]; suggestions: Sugg[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: Record<string, unknown>) => parent.postMessage({ pluginMessage: m }, '*');
const say = (t: string, err = false) => { const s = $('status'); s.textContent = t; s.className = err ? 'error' : ''; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sw = (hex: string) => `<span class="sw"><i style="background:${hex}"></i></span>`;
let groups: G[] = [];
/** Shown again once the rescan after an apply finishes. */
let afterApply = '';

function options() {
  return {
    scope: $<HTMLSelectElement>('scope').value,
    maxColorDistance: Number($<HTMLSelectElement>('near').value),
    maxNumberDistance: Number($<HTMLSelectElement>('nums').value),
    includeHidden: $<HTMLInputElement>('hidden').checked,
    skipInstances: $<HTMLInputElement>('inst').checked,
    libraries: [...document.querySelectorAll<HTMLInputElement>('#libs input:checked')].map((x) => x.value),
  };
}

function label(s: Sugg) {
  return `${s.name} · ${s.collection}${s.distance ? ` · ${s.distance > 0 && typeof s.value === 'number' ? `${s.value}` : `ΔE ${s.distance}`}` : ''}`;
}

function render(m: { groups: G[]; layers: number; candidates: number }) {
  groups = m.groups;
  const matched = groups.filter((g) => g.suggestions.length);
  const none = groups.filter((g) => !g.suggestions.length);
  const values = groups.reduce((n, g) => n + g.count, 0);
  const bindable = matched.reduce((n, g) => n + g.count, 0);
  if (!groups.length) { $('result').innerHTML = '<p class="sum">No raw values found: everything here uses variables or styles.</p>'; $('applyBar').style.display = 'none'; return; }
  const rows = matched.map((g, i) => {
    const exact = g.suggestions[0].distance === 0;
    const opts = g.suggestions.map((s) => `<option value="${s.id}">${esc(label(s))}</option>`).join('');
    return `<div class="g"><input type="checkbox" data-i="${i}"${exact ? ' checked' : ''}><div>
      <div class="top">${g.color ? sw(g.value) : ''}<span class="val">${esc(g.value)}</span><span class="fam">${esc(g.family)}</span><span class="n">${g.layerCount} layer${g.layerCount === 1 ? '' : 's'}<a data-key="${esc(g.key)}">Show</a></span></div>
      <div class="lay">${esc(g.layers.join(', '))}</div>
      <select data-i="${i}">${opts}</select>
      ${exact ? '' : '<div class="near">Near match: binding changes how these layers look slightly.</div>'}
    </div></div>`;
  }).join('');
  const noneList = none.map((g) => `<li>${g.color ? sw(g.value) + ' ' : ''}${esc(g.value)} · ${esc(g.family)} · ${g.layerCount} layer${g.layerCount === 1 ? '' : 's'} <a data-key="${esc(g.key)}" style="cursor:pointer;color:var(--figma-color-text-brand,#007be5)">Show</a></li>`).join('');
  $('result').innerHTML = `<p class="sum">${values} raw value${values === 1 ? '' : 's'} on ${m.layers} layer${m.layers === 1 ? '' : 's'}; ${bindable} can be bound to one of ${m.candidates} variables.</p>
    ${matched.length ? `<div class="groups" id="matched">${rows}</div>` : ''}
    ${none.length ? `<details class="none"><summary>No matching token (${none.length})</summary><ul>${noneList}</ul></details>` : ''}`;
  matchedGroups = matched;
  $('result').querySelectorAll<HTMLAnchorElement>('a[data-key]').forEach((a) => { a.onclick = () => send({ type: 'select', key: a.dataset.key }); });
  $('result').querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => { c.onchange = updateApply; });
  updateApply();
}
let matchedGroups: G[] = [];

function chosen() {
  return [...document.querySelectorAll<HTMLInputElement>('#matched input[type=checkbox]:checked')].map((c) => {
    const i = Number(c.dataset.i);
    const sel = document.querySelector<HTMLSelectElement>(`#matched select[data-i="${i}"]`)!;
    return { key: matchedGroups[i].key, variableId: sel.value, count: matchedGroups[i].count };
  });
}

function updateApply() {
  const c = chosen();
  const n = c.reduce((a, x) => a + x.count, 0);
  $('applyBar').style.display = matchedGroups.length ? 'block' : 'none';
  const b = $<HTMLButtonElement>('apply');
  b.textContent = n ? `Bind ${n} value${n === 1 ? '' : 's'} (${c.length} group${c.length === 1 ? '' : 's'})` : 'Tick the groups to bind';
  b.disabled = !n;
}

onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'init') {
    if (m.selection) $<HTMLSelectElement>('scope').value = 'selection';
    $('libs').innerHTML = m.libraries.length
      ? '<div style="margin-top:6px;color:var(--figma-color-text-secondary,#666)">Also suggest variables from libraries:</div>' + m.libraries.map((l: { key: string; name: string; library: string }) => `<label><input type="checkbox" value="${esc(l.key)}"> ${esc(l.library)} · ${esc(l.name)}</label>`).join('')
      : '';
  }
  if (m.type === 'progress') say(m.text);
  if (m.type === 'groups') { render(m); say(afterApply); afterApply = ''; $<HTMLButtonElement>('scan').disabled = false; }
  if (m.type === 'applied') {
    afterApply = `Bound ${m.done} value${m.done === 1 ? '' : 's'}${m.skipped ? `; ${m.skipped} had changed since the scan and were skipped` : ''}. ⌘Z undoes it.`;
    say('Rescanning…');
  }
  if (m.type === 'error') { say(m.message, true); $<HTMLButtonElement>('scan').disabled = false; }
};

$('scan').onclick = () => { $<HTMLButtonElement>('scan').disabled = true; say('Scanning…'); send({ type: 'scan', ...options() }); };
$('apply').onclick = () => {
  const choices = chosen().map(({ key, variableId }) => ({ key, variableId }));
  if (!choices.length) return;
  $<HTMLButtonElement>('apply').disabled = true;
  say('Binding…');
  send({ type: 'apply', choices, ...options() });
};
send({ type: 'init' });

export {};
