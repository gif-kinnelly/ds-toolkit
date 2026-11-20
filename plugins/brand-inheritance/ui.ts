// Brand Inheritance — UI.
type Mode = { id: string; name: string; parent: string | null; stats: { overrides: number; inherited: number } | null };
type Pending = { varId: string; modeId: string; variable: string; mode: string; kind: string; before: string; after: string };
type Override = { varId: string; modeId: string; variable: string; mode: string; value: string; parent: string };
type State = { collection: { id: string; name: string; isExtension: boolean }; modes: Mode[]; pending: Pending[]; noticed: { variable: string; mode: string; kind: string }[]; overrides: Override[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: Record<string, unknown>) => parent.postMessage({ pluginMessage: m }, '*');
const say = (t: string, err = false) => { const s = $('status'); s.textContent = t; s.className = err ? 'error' : ''; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sw = (v: string) => { const m = /#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.exec(v); return m ? `<i class="sw" style="background:${m[0]}"></i>` : ''; };
const val = (v: string) => `${sw(v)}${esc(v)}`;
const KIND: Record<string, string> = { filled: 'new token', followed: 'base changed', reset: 'reset' };

let current: State | null = null;
const colId = () => $<HTMLSelectElement>('col').value;

function render(s: State) {
  current = s;
  $('ext').hidden = !s.collection.isExtension;
  const opt = [...$<HTMLSelectElement>('col').options].find((o) => o.value === s.collection.id);
  if (opt) opt.textContent = `${s.collection.name} (${s.modes.length} modes)`;
  const tbody = $('modes').querySelector('tbody')!;
  tbody.innerHTML = '';
  for (const m of s.modes) {
    const tr = document.createElement('tr');
    const options = [`<option value="">—</option>`, ...s.modes.filter((o) => o.id !== m.id).map((o) => `<option value="${o.id}"${o.id === m.parent ? ' selected' : ''}>${esc(o.name)}</option>`)].join('');
    tr.innerHTML = `<td>${esc(m.name)}</td><td><select>${options}</select></td><td class="num">${m.stats ? m.stats.overrides : '<span class="root">—</span>'}</td><td class="num">${m.stats ? m.stats.inherited : '<span class="root">—</span>'}</td>`;
    tr.querySelector('select')!.onchange = (e) => {
      const parentId = (e.target as HTMLSelectElement).value || null;
      say(parentId ? `Linking ${m.name}: values that match the parent start inherited, the rest become overrides…` : `${m.name} is now edited by hand.`);
      send({ type: 'set-parent', collectionId: colId(), modeId: m.id, parentId });
    };
    tbody.appendChild(tr);
  }
  $('newParent').innerHTML = s.modes.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');

  $('pendingCount').textContent = s.pending.length ? `${s.pending.length} value${s.pending.length === 1 ? '' : 's'} · tick to keep as an override instead` : '';
  $('pending').innerHTML = s.pending.length
    ? s.pending.map((p, i) => `<label><input type="checkbox" data-i="${i}"><span><b>${esc(p.variable)}</b> <span class="m">in ${esc(p.mode)}</span><br><span class="v">${val(p.before)} → ${val(p.after)}</span></span><span class="m">${KIND[p.kind] ?? p.kind}</span></label>`).join('')
    : '<div class="empty">Every brand is in sync with its parent.</div>';

  const n = s.noticed;
  $('noticed').hidden = !n.length;
  $('noticed').textContent = n.length
    ? `Treated as overrides from now on, because they were set by hand: ${n.slice(0, 6).map((x) => `${x.variable} (${x.mode})`).join(', ')}${n.length > 6 ? ` and ${n.length - 6} more` : ''}. Tick them under Overrides to undo.`
    : '';

  $('overrides').innerHTML = s.overrides.length
    ? s.overrides.map((o, i) => `<label><input type="checkbox" data-i="${i}"><span><b>${esc(o.variable)}</b> <span class="m">in ${esc(o.mode)}</span><br><span class="v">${val(o.value)} <span class="m">· parent</span> ${val(o.parent)}</span></span><span></span></label>`).join('')
    : '<div class="empty">No overrides yet.</div>';
  const links = s.modes.filter((m) => m.parent).length;
  $('syncHint').textContent = links ? '' : 'Pick a parent for at least one mode first.';
  $<HTMLButtonElement>('sync').disabled = !links;
}

onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'collections') {
    const sel = $<HTMLSelectElement>('col');
    sel.innerHTML = m.collections.map((c: { id: string; name: string; modes: number }) => `<option value="${c.id}">${esc(c.name)} (${c.modes} modes)</option>`).join('');
    if (m.collections.length) send({ type: 'load', collectionId: sel.value }); else say('This file has no local variable collections.');
  }
  if (m.type === 'state') { render(m as State); if (!$('status').classList.contains('error')) say(''); }
  if (m.type === 'error') say(m.message, true);
};

const checked = (id: string) => [...$(id).querySelectorAll<HTMLInputElement>('input:checked')].map((x) => Number(x.dataset.i));
$('col').onchange = () => send({ type: 'load', collectionId: colId() });
$('add').onclick = () => {
  const name = $<HTMLInputElement>('newName').value.trim();
  if (!name) return say('Name the new brand first.', true);
  say(`Adding ${name}…`);
  send({ type: 'add-mode', collectionId: colId(), name, parentId: $<HTMLSelectElement>('newParent').value });
  $<HTMLInputElement>('newName').value = '';
};
$('sync').onclick = () => {
  if (!current) return;
  const keep = checked('pending').map((i) => ({ varId: current!.pending[i].varId, modeId: current!.pending[i].modeId }));
  const reset = checked('overrides').map((i) => ({ varId: current!.overrides[i].varId, modeId: current!.overrides[i].modeId }));
  say('Syncing…');
  send({ type: 'sync', collectionId: colId(), keep, reset });
};
send({ type: 'init' });

export {};
