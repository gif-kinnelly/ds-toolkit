// Brand Inheritance — main thread. Stores which mode inherits from which on the
// collection, and per-variable override state on each variable (shared plugin
// data, so every editor of the file sees the same setup).
import { adopt, plan, valueKey, type InheritConfig, type ModeMeta, type VarInput } from '../../src/brands/inherit';
import { rgbaToHex } from '../../src/core/values';

const NS = 'ds_toolkit';
const KEY = 'inherit';

figma.showUI(__html__, { width: 520, height: 720, themeColors: true });

type Ref = { varId: string; modeId: string };
type Msg =
  | { type: 'init' }
  | { type: 'load'; collectionId: string }
  | { type: 'set-parent'; collectionId: string; modeId: string; parentId: string | null }
  | { type: 'add-mode'; collectionId: string; name: string; parentId: string }
  | { type: 'sync'; collectionId: string; keep: Ref[]; reset: Ref[] };

const read = <T>(n: PluginDataMixin, fallback: T): T => {
  try { return JSON.parse(n.getSharedPluginData(NS, KEY) || 'null') ?? fallback; } catch { return fallback; }
};
const write = (n: PluginDataMixin, v: unknown) => n.setSharedPluginData(NS, KEY, v === null ? '' : JSON.stringify(v));

async function collection(id: string) {
  const c = await figma.variables.getVariableCollectionByIdAsync(id);
  if (!c) throw new Error('That collection no longer exists.');
  return c;
}

async function variablesOf(c: VariableCollection) {
  const all = await figma.variables.getLocalVariablesAsync();
  return all.filter((v) => v.variableCollectionId === c.id);
}

function inputs(vars: Variable[]): VarInput[] {
  return vars.map((v) => ({ id: v.id, name: v.name, values: { ...v.valuesByMode }, meta: read<Record<string, ModeMeta> | undefined>(v, undefined) }));
}

/** Value as the UI shows it: hex for colors, the target's name for aliases. */
async function display(raw: unknown): Promise<string> {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.type === 'VARIABLE_ALIAS') {
      const t = await figma.variables.getVariableByIdAsync(String(o.id));
      return `{${t ? t.name : o.id}}`;
    }
    if ('r' in o) return rgbaToHex(o as unknown as RGBA);
  }
  return raw === undefined ? '—' : JSON.stringify(raw);
}

async function state(c: VariableCollection, opts: { keep?: Ref[]; reset?: Ref[] } = {}) {
  const cfg = read<InheritConfig>(c, { parents: {} });
  const vars = await variablesOf(c);
  const ins = inputs(vars);
  const modeIds = c.modes.map((m) => m.modeId);
  // Drop links to modes that were deleted, so one stale entry doesn't block everything.
  for (const [child, parent] of Object.entries(cfg.parents)) if (!modeIds.includes(child) || !modeIds.includes(parent)) delete cfg.parents[child];
  const p = plan(ins, cfg, modeIds, opts);
  const modeName = (id: string) => c.modes.find((m) => m.modeId === id)?.name ?? id;
  const pending = await Promise.all(p.writes.map(async (w) => {
    const v = ins.find((x) => x.id === w.varId)!;
    const ev = p.events.find((e) => e.variable === v.name && e.mode === w.modeId)!;
    return { varId: w.varId, modeId: w.modeId, variable: v.name, mode: modeName(w.modeId), kind: ev.kind, before: await display(v.values[w.modeId]), after: await display(w.value) };
  }));
  const noticed = p.events.filter((e) => e.kind === 'detected-override' || e.kind === 'new-override')
    .map((e) => ({ variable: e.variable, mode: modeName(e.mode), kind: e.kind }));
  // Current overrides, with the value they'd get if reset.
  const overrides = [];
  for (const v of ins) {
    for (const [modeId, mm] of Object.entries(p.meta[v.id] ?? {})) {
      if (!mm.o || !cfg.parents[modeId]) continue;
      overrides.push({ varId: v.id, modeId, variable: v.name, mode: modeName(modeId), value: await display(v.values[modeId]), parent: await display(v.values[cfg.parents[modeId]]) });
    }
  }
  return { cfg, ins, p, modeIds, pending, noticed, overrides };
}

async function load(id: string) {
  const c = await collection(id);
  const { cfg, p, pending, noticed, overrides } = await state(c);
  figma.ui.postMessage({
    type: 'state',
    collection: { id: c.id, name: c.name, isExtension: (c as { isExtension?: boolean }).isExtension === true },
    modes: c.modes.map((m) => ({ id: m.modeId, name: m.name, parent: cfg.parents[m.modeId] ?? null, stats: p.stats[m.modeId] ?? null })),
    pending, noticed, overrides,
  });
}

/** Linking a mode to a parent: values equal to the parent's start inherited, others become overrides. */
async function setParent(id: string, modeId: string, parentId: string | null) {
  const c = await collection(id);
  const cfg = read<InheritConfig>(c, { parents: {} });
  const vars = await variablesOf(c);
  if (parentId) {
    cfg.parents[modeId] = parentId;
    const meta = adopt(inputs(vars), modeId, parentId);
    for (const v of vars) write(v, { ...read<Record<string, ModeMeta>>(v, {}), [modeId]: meta[v.id] });
  } else {
    delete cfg.parents[modeId];
    for (const v of vars) { const m = read<Record<string, ModeMeta>>(v, {}); delete m[modeId]; write(v, m); }
  }
  write(c, cfg);
}

async function addMode(id: string, name: string, parentId: string) {
  const c = await collection(id);
  let modeId: string;
  try { modeId = c.addMode(name); } catch (e) {
    throw new Error(`Figma didn't add the mode: ${(e as Error).message}. Your plan may limit modes per collection.`);
  }
  // A new brand starts fully inherited: copy the parent's values and mark them as such.
  const vars = await variablesOf(c);
  for (const v of vars) {
    const val = v.valuesByMode[parentId];
    if (val !== undefined) v.setValueForMode(modeId, val);
    write(v, { ...read<Record<string, ModeMeta>>(v, {}), [modeId]: { l: valueKey(val) } });
  }
  const cfg = read<InheritConfig>(c, { parents: {} });
  cfg.parents[modeId] = parentId;
  write(c, cfg);
}

async function sync(id: string, keep: Ref[], reset: Ref[]) {
  const c = await collection(id);
  const { p } = await state(c, { keep, reset });
  const vars = new Map((await variablesOf(c)).map((v) => [v.id, v]));
  for (const w of p.writes) vars.get(w.varId)!.setValueForMode(w.modeId, w.value as VariableValue);
  for (const [varId, meta] of Object.entries(p.meta)) write(vars.get(varId)!, meta);
  return p.writes.length;
}

figma.ui.onmessage = async (msg: Msg) => {
  try {
    if (msg.type === 'init') {
      const cols = (await figma.variables.getLocalVariableCollectionsAsync()).map((c) => ({ id: c.id, name: c.name, modes: c.modes.length }));
      figma.ui.postMessage({ type: 'collections', collections: cols });
      return;
    }
    if (msg.type === 'set-parent') await setParent(msg.collectionId, msg.modeId, msg.parentId);
    if (msg.type === 'add-mode') await addMode(msg.collectionId, msg.name, msg.parentId);
    if (msg.type === 'sync') {
      const n = await sync(msg.collectionId, msg.keep, msg.reset);
      figma.notify(n ? `Synced ${n} value${n === 1 ? '' : 's'}` : 'Brands already in sync');
    }
    await load(msg.collectionId);
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
