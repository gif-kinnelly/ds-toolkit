// Import Preview — UI. Parses the dropped files, asks the main thread for a
// snapshot of the open file, diffs, renders.
import { detect, load, type InputFile } from '../../src/adapters/load';
import { nameFromPath } from '../../src/adapters/dtcg';
import { diff, type DiffResult } from '../../src/core/diff';
import { renderHtmlFragment, renderHtmlPage, renderMarkdown } from '../../src/core/render';
import type { Snapshot } from '../../src/core/snapshot';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
const say = (text: string, error = false) => { status.textContent = text; status.className = error ? 'error' : ''; };

const LABEL = { snapshot: 'snapshot', 'ui-spec': 'component spec', 'figma-rest': 'REST variables', dtcg: 'DTCG' } as const;
/** path drives collection/mode for token files; name is what the user dropped. */
let files: (InputFile & { name: string })[] = [];
let last: DiffResult | null = null;

function pasted(): InputFile[] {
  const text = $<HTMLTextAreaElement>('json').value.trim();
  return text ? [{ path: 'pasted.json', text }] : [];
}

function source(): Snapshot | null {
  const all = [...files, ...pasted()];
  if (!all.length) return null;
  return load(all, { collection: $<HTMLInputElement>('collection').value.trim() || 'Tokens' });
}

/** Re-parses on every change so mistakes show up before "Preview". */
function refresh() {
  const list = $('files');
  list.innerHTML = '';
  files.forEach((f, i) => {
    let fmt = 'invalid';
    try { fmt = LABEL[detect(JSON.parse(f.text))]; } catch { /* shown as invalid */ }
    const li = document.createElement('li');
    li.innerHTML = `<span class="fmt"></span><span class="name"></span><span class="cm"></span><button class="rm" title="Remove">×</button>`;
    li.querySelector('.fmt')!.textContent = fmt;
    li.querySelector('.name')!.textContent = f.name;
    li.querySelector('.name')!.setAttribute('title', f.name);
    if (fmt === 'DTCG') {
      // Token files map to a collection and a mode; both are editable, prefilled from the folder and file name.
      const { collection, mode } = nameFromPath(f.path, 'Tokens');
      const cm = li.querySelector('.cm')!;
      for (const [label, value] of [['Collection', collection], ['Mode', mode]] as const) {
        const input = document.createElement('input');
        input.value = value;
        input.title = label;
        input.placeholder = label;
        input.onchange = () => {
          const [c, m] = [...cm.querySelectorAll('input')].map((x) => x.value.trim() || x.placeholder);
          f.path = `${c}/${m}.tokens.json`;
          refresh();
        };
        cm.appendChild(input);
      }
    }
    (li.querySelector('.rm') as HTMLButtonElement).onclick = () => { files.splice(i, 1); refresh(); };
    list.appendChild(li);
  });
  const loaded = $('loaded');
  try {
    const s = source();
    $<HTMLButtonElement>('go').disabled = !s;
    if (!s) { loaded.textContent = ''; return; }
    const vars = s.collections.reduce((n, c) => n + c.variables.length, 0);
    const cols = s.collections.map((c) => `${c.name} (${c.modes.join(', ')})`).join('; ');
    loaded.textContent = [
      vars ? `${vars} variables in ${cols}` : '',
      s.styles.length ? `${s.styles.length} styles` : '',
      s.components.length ? `${s.components.length} components` : '',
      s.warnings?.length ? `${s.warnings.length} skipped: ${s.warnings.slice(0, 3).join('; ')}${s.warnings.length > 3 ? '…' : ''}` : '',
    ].filter(Boolean).join(' · ') || 'Nothing recognised in these files.';
    say('');
  } catch (e) {
    $<HTMLButtonElement>('go').disabled = true;
    loaded.textContent = '';
    say((e as Error).message, true);
  }
}

async function addFiles(list: { file: File; path: string }[]) {
  for (const { file, path } of list) {
    if (!/\.json$/i.test(file.name)) continue;
    files = files.filter((x) => x.name !== path);
    files.push({ path, name: path, text: await file.text() });
  }
  refresh();
}

/** Dropped folders are walked, so "Theme/Light.tokens.json" keeps its folder as the collection. */
async function dropped(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + e.name });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const c of batch) await walk(c, `${prefix}${e.name}/`);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

// ---------- talking to the main thread ----------

let nextId = 1;
const pending = new Map<number, { resolve: (s: Snapshot) => void; reject: (e: Error) => void }>();
onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  const p = pending.get(m.id);
  if (m.type === 'progress') say(m.text);
  if (m.type === 'snapshot' && p) { pending.delete(m.id); p.resolve(m.snapshot); }
  if (m.type === 'error' && p) { pending.delete(m.id); p.reject(new Error(m.message)); }
};
function readFile(opts: { scope: string; components?: string[]; skipUsage?: boolean }): Promise<Snapshot> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    parent.postMessage({ pluginMessage: { type: 'read', id, ...opts } }, '*');
  });
}

// ---------- actions ----------

async function preview() {
  const go = $<HTMLButtonElement>('go');
  go.disabled = true;
  $('result').innerHTML = '';
  $('actions').style.display = 'none';
  try {
    const src = source();
    if (!src) return;
    const whole = $<HTMLInputElement>('whole').checked;
    const target = await readFile({
      scope: $<HTMLSelectElement>('scope').value,
      // Counting instances is the slow part, so only read the components the files mention.
      components: whole ? undefined : src.components.map((c) => c.name),
    });
    last = diff(src, target, { missing: $<HTMLSelectElement>('missing').value as 'keep' | 'remove', wholeFile: whole });
    $('result').innerHTML = renderHtmlFragment(last);
    $('actions').style.display = last.changes.length ? 'flex' : 'none';
    say('');
  } catch (e) {
    say((e as Error).message, true);
  } finally {
    go.disabled = false;
  }
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function copy(text: string) {
  // navigator.clipboard is often blocked in plugin iframes; execCommand still works there.
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  say(ok ? 'Copied.' : 'Copy failed; use Download report instead.', !ok);
}

const drop = $('drop');
drop.onclick = () => $('picker').click();
$<HTMLInputElement>('picker').onchange = (e) => {
  const t = e.target as HTMLInputElement;
  if (t.files) addFiles([...t.files].map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  t.value = '';
};
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer) addFiles(await dropped(e.dataTransfer));
};
$('json').oninput = refresh;
$('collection').oninput = refresh;
$('go').onclick = preview;
$('md').onclick = () => last && copy(renderMarkdown(last));
$('html').onclick = () => last && download('import-preview.html', renderHtmlPage(last, 'Import preview'), 'text/html');
$('export').onclick = async () => {
  try {
    const snap = await readFile({ scope: 'file' });
    download('figma-snapshot.json', JSON.stringify(snap, null, 2), 'application/json');
    say('Snapshot downloaded.');
  } catch (e) { say((e as Error).message, true); }
};
refresh();
