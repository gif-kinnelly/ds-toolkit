/**
 * Mode inheritance for multi-brand collections, on any Figma plan.
 *
 * Figma modes don't inherit: each mode stores its own value. Here each mode
 * may name a parent mode, and every value in it is either an **override**
 * (kept as is) or **inherited** (kept equal to the parent's value). The plugin
 * remembers, per variable and mode, the value it last wrote. On the next sync:
 *
 * - inherited, unchanged since we wrote it → follows the parent (picks up base changes);
 * - inherited, but someone edited it in Figma since → it becomes an override (never clobbered);
 * - override → left alone;
 * - a variable we've never seen (added after setup) → filled from the parent, unless
 *   its value in that mode was clearly set by hand (then it's an override).
 *
 * Values are compared by a stable key (literal or alias target id), so this
 * module needs no Figma API and is tested on plain data.
 */

export type Raw = unknown; // Figma VariableValue: RGBA, number, string, boolean, or { type: 'VARIABLE_ALIAS', id }

export interface ModeMeta {
  /** Explicit override: never written by sync. */
  o?: true;
  /** Key of the value sync last wrote or confirmed (inherited values only). */
  l?: string;
}

export interface VarInput {
  id: string;
  name: string;
  values: Record<string, Raw>; // by modeId
  /** Stored per variable; undefined for a variable this tool hasn't seen. */
  meta?: Record<string, ModeMeta>;
}

export interface InheritConfig {
  /** child modeId -> parent modeId. Modes with no entry are roots (edited by hand). */
  parents: Record<string, string>;
}

export type EventKind = 'filled' | 'followed' | 'detected-override' | 'new-override' | 'reset' | 'kept';
export interface SyncEvent { kind: EventKind; variable: string; mode: string; before?: Raw; after?: Raw }

export interface Plan {
  writes: { varId: string; modeId: string; value: Raw }[];
  /** New meta for every variable (write back even when no values change). */
  meta: Record<string, Record<string, ModeMeta>>;
  events: SyncEvent[];
  /** Per child mode: how many values are overrides vs inherited after the sync. */
  stats: Record<string, { overrides: number; inherited: number }>;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
/** Stable comparison key for a Figma variable value. */
export function valueKey(v: Raw): string {
  if (v === undefined || v === null) return '∅';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'VARIABLE_ALIAS') return `@${o.id}`;
    if ('r' in o && 'g' in o && 'b' in o) return `rgba(${[o.r, o.g, o.b, o.a ?? 1].map((x) => round(Number(x))).join(',')})`;
    return JSON.stringify(o);
  }
  return typeof v === 'number' ? `n:${round(v)}` : `${typeof v}:${String(v)}`;
}

/** Child modes ordered so each comes after its parent; throws on a cycle. */
export function order(parents: Record<string, string>, modeIds: string[]): string[] {
  const out: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (m: string, path: string[]) => {
    if (state.get(m) === 'done') return;
    if (state.get(m) === 'visiting') throw new Error(`Modes inherit in a loop: ${[...path, m].join(' → ')}`);
    state.set(m, 'visiting');
    const p = parents[m];
    if (p) {
      if (!modeIds.includes(p)) throw new Error(`Mode ${m} inherits from a mode that no longer exists (${p}).`);
      visit(p, [...path, m]);
    }
    state.set(m, 'done');
    if (p) out.push(m);
  };
  for (const m of modeIds) visit(m, []);
  return out;
}

/**
 * First-time setup for a mode: values equal to the parent's are inherited,
 * different ones are overrides. Returns meta to merge into each variable.
 */
export function adopt(vars: VarInput[], child: string, parent: string): Record<string, ModeMeta> {
  const out: Record<string, ModeMeta> = {};
  for (const v of vars) {
    const cur = valueKey(v.values[child]);
    out[v.id] = cur === valueKey(v.values[parent]) ? { l: cur } : { o: true };
  }
  return out;
}

export interface PlanOptions {
  /** Inherited values to put back to the parent's value. */
  reset?: { varId: string; modeId: string }[];
  /** Values to keep as overrides instead of syncing (chosen in the preview). */
  keep?: { varId: string; modeId: string }[];
}

export function plan(vars: VarInput[], cfg: InheritConfig, modeIds: string[], opts: PlanOptions = {}): Plan {
  const children = order(cfg.parents, modeIds);
  const writes: Plan['writes'] = [];
  const events: SyncEvent[] = [];
  const meta: Plan['meta'] = {};
  const stats: Plan['stats'] = Object.fromEntries(children.map((m) => [m, { overrides: 0, inherited: 0 }]));
  const key = (r: { varId: string; modeId: string }) => `${r.varId}|${r.modeId}`;
  const resets = new Set((opts.reset ?? []).map(key));
  const keeps = new Set((opts.keep ?? []).map(key));

  for (const v of vars) {
    const values = { ...v.values }; // updated as parents change, so grandchildren follow in the same pass
    const m: Record<string, ModeMeta> = {};
    // Keep meta for root modes and modes no longer inheriting, minus stale entries.
    for (const [mode, mm] of Object.entries(v.meta ?? {})) if (modeIds.includes(mode) && !children.includes(mode)) m[mode] = mm;

    for (const mode of children) {
      const parentVal = values[cfg.parents[mode]];
      const cur = values[mode];
      const prev = v.meta?.[mode];
      const target = valueKey(parentVal);
      const write = (kind: EventKind) => {
        if (valueKey(cur) !== target) { writes.push({ varId: v.id, modeId: mode, value: parentVal }); events.push({ kind, variable: v.name, mode, before: cur, after: parentVal }); }
        values[mode] = parentVal;
        m[mode] = { l: target };
        stats[mode].inherited++;
      };

      const override = (kind?: EventKind) => {
        m[mode] = { o: true };
        stats[mode].overrides++;
        if (kind) events.push({ kind, variable: v.name, mode, after: cur });
      };
      if (resets.has(`${v.id}|${mode}`)) { write('reset'); continue; }
      if (keeps.has(`${v.id}|${mode}`)) { override(prev?.o ? undefined : 'kept'); continue; }
      if (!prev) {
        // A variable added since the last sync. Figma gives a new variable the same value in
        // every mode, so a child still holding what its sibling modes hold is that untouched
        // default: fill it. A child set to something of its own was set on purpose: keep it.
        const siblings = children.filter((c) => c !== mode).map((c) => valueKey(v.values[c]));
        const own = valueKey(cur) !== target && siblings.length > 0 && siblings.every((k) => k !== valueKey(cur));
        if (own) override('new-override'); else write('filled');
        continue;
      }
      if (prev.o) { override(); continue; }
      // Someone set this value by hand since the last sync: respect it.
      if (prev.l !== undefined && valueKey(cur) !== prev.l) { override('detected-override'); continue; }
      write('followed');
    }
    meta[v.id] = m;
  }
  return { writes, meta, events, stats };
}
