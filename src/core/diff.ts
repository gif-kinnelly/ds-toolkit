/**
 * Compares the snapshot you're about to import (source) with what's in Figma
 * now (target) and says what the import will do, ranked by how much it can
 * break. Assumes the importer matches by name, like Figma's native variable
 * import and most sync plugins: a renamed variable or variant is a new one,
 * and anything bound to the old name doesn't follow.
 */
import type { Collection, Component, Snapshot, Style, Value, Variable, Variant } from './snapshot';
import { variantProps } from './snapshot';
import { formatValue, resolveValue, sameValue } from './values';

export type Severity = 'breaking' | 'review' | 'safe';
export type Area = 'variables' | 'styles' | 'components';
export type ChangeKind = 'added' | 'removed' | 'kept' | 'changed' | 'retyped' | 'renamed';

export interface Change {
  severity: Severity;
  area: Area;
  kind: ChangeKind;
  /** "Theme › color/primary", "Button › size=md". */
  subject: string;
  /** One plain sentence on what happens. */
  detail: string;
  /** Per-mode or per-field before/after, for value changes. */
  rows?: { label: string; before: string; after: string }[];
  /** What in the file depends on the thing that changes (live targets only). */
  impact?: { count: number; unit: 'layers' | 'instances' };
}

export interface DiffOptions {
  /**
   * What the importer does with things that exist in Figma but not in the source,
   * inside collections and components the source does describe:
   * "keep" (default) leaves them, "remove" deletes them.
   */
  missing?: 'keep' | 'remove';
  /** Also report whole collections, styles and components the source doesn't mention. Default false. */
  wholeFile?: boolean;
}

export interface DiffResult {
  source: string;
  target: string;
  changes: Change[];
  counts: Record<Severity, number>;
  /** False when the target had no usage counts (not a live file), so impact is unknown. */
  hasUsage: boolean;
}

const ORDER: Record<Severity, number> = { breaking: 0, review: 1, safe: 2 };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sub = (...parts: string[]) => parts.join(' › ');

export function diff(source: Snapshot, target: Snapshot, opts: DiffOptions = {}): DiffResult {
  const missing = opts.missing ?? 'keep';
  const out: Change[] = [];
  diffCollections(source.collections, target.collections, resolver(source), resolver(target), missing, !!opts.wholeFile, out);
  diffStyles(source.styles, target.styles, missing, !!opts.wholeFile || source.styles.length > 0, out);
  diffComponents(source.components, target.components, missing, !!opts.wholeFile, out);
  out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.impact?.count ?? 0) - (a.impact?.count ?? 0));
  const counts = { breaking: 0, review: 0, safe: 0 };
  for (const c of out) counts[c.severity]++;
  return { source: source.source, target: target.source, changes: out, counts, hasUsage: !!target.hasUsage };
}

/** Removing or orphaning something that's used is breaking; unused is just worth a look. */
function usedSeverity(count: number | undefined): Severity {
  return count ? 'breaking' : 'review';
}
const layersImpact = (n?: number) => (n ? { count: n, unit: 'layers' as const } : undefined);
const instImpact = (n?: number) => (n ? { count: n, unit: 'instances' as const } : undefined);

// ---------- variables ----------

/** Resolves a value through aliases, looking variables up by name across collections. */
type Resolver = (v: Value | undefined, mode: string) => Value | undefined;
function resolver(snap: Snapshot): Resolver {
  const byName = new Map<string, { v: Variable; c: Collection }>();
  for (const c of snap.collections) for (const v of c.variables) if (!byName.has(v.name)) byName.set(v.name, { v, c });
  return (value, mode) => {
    // An alias into another collection resolves in that collection's default mode
    // unless it has a mode of the same name (Figma resolves per collection mode).
    let m = mode;
    return resolveValue(value, (name) => {
      const hit = byName.get(name);
      if (!hit) return undefined;
      if (!hit.c.modes.includes(m)) m = hit.c.modes[0];
      return hit.v.values[m];
    });
  };
}

function diffCollections(src: Collection[], tgt: Collection[], rs: Resolver, rt: Resolver, missing: 'keep' | 'remove', whole: boolean, out: Change[]) {
  const byName = new Map(tgt.map((c) => [c.name, c]));
  for (const s of src) {
    const t = byName.get(s.name);
    byName.delete(s.name);
    if (!t) {
      out.push({
        severity: 'safe', area: 'variables', kind: 'added', subject: s.name,
        detail: `New collection with ${plural(s.variables.length, 'variable')} in ${plural(s.modes.length, 'mode')} (${s.modes.join(', ')}).`,
      });
      continue;
    }
    const modeMap = mapModes(s, t);
    diffModes(s, t, modeMap, missing, out);
    diffVariables(s, t, modeMap, rs, rt, missing, out);
  }
  if (whole) {
    for (const t of byName.values()) {
      const used = t.variables.reduce((n, v) => n + (v.usage ?? 0), 0);
      out.push(missing === 'remove'
        ? { severity: usedSeverity(used), area: 'variables', kind: 'removed', subject: t.name, detail: `Collection isn't in the source and will be deleted with its ${plural(t.variables.length, 'variable')}.`, impact: layersImpact(used) }
        : { severity: 'safe', area: 'variables', kind: 'kept', subject: t.name, detail: `Collection isn't in the source; it's left as is.` });
    }
  }
}

/**
 * Source mode name -> target mode name. Same names match; and when neither
 * side's default mode has a match, importers (Figma's and most plugins) rename
 * the existing default mode ("Mode 1" -> "Light") rather than adding one.
 */
function mapModes(s: Collection, t: Collection): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of s.modes) if (t.modes.includes(m)) map.set(m, m);
  const sd = s.modes[0], td = t.modes[0];
  if (sd && td && !map.has(sd) && !s.modes.includes(td)) map.set(sd, td);
  return map;
}

function diffModes(s: Collection, t: Collection, modeMap: Map<string, string>, missing: 'keep' | 'remove', out: Change[]) {
  const mapped = new Set(modeMap.values());
  for (const [sm, tm] of modeMap) {
    if (sm !== tm) out.push({ severity: 'review', area: 'variables', kind: 'renamed', subject: sub(s.name, `mode ${tm} → ${sm}`), detail: `The default mode is renamed and keeps its values. Anything that refers to the mode by name (code, other plugins) needs updating.` });
  }
  const modeCount = new Set([...t.modes, ...s.modes.filter((m) => !modeMap.has(m))]).size;
  for (const m of s.modes) {
    if (!modeMap.has(m)) {
      out.push({ severity: 'safe', area: 'variables', kind: 'added', subject: sub(s.name, `mode ${m}`), detail: `New mode. The collection will have ${modeCount} modes; check your plan allows that many.` });
    }
  }
  for (const m of t.modes) {
    if (mapped.has(m)) continue;
    out.push(missing === 'remove'
      ? { severity: 'breaking', area: 'variables', kind: 'removed', subject: sub(s.name, `mode ${m}`), detail: `Mode will be deleted. Frames set to "${m}" fall back to the default mode and its values are lost.` }
      : { severity: 'safe', area: 'variables', kind: 'kept', subject: sub(s.name, `mode ${m}`), detail: `Mode isn't in the source; its values are left as they are.` });
  }
  if (s.modes[0] && t.modes[0] && s.modes[0] !== t.modes[0] && t.modes.includes(s.modes[0])) {
    out.push({ severity: 'review', area: 'variables', kind: 'changed', subject: sub(s.name, 'default mode'), detail: `Default mode changes from "${t.modes[0]}" to "${s.modes[0]}". Layers with no mode set will switch.` });
  }
}

function diffVariables(s: Collection, t: Collection, modeMap: Map<string, string>, rs: Resolver, rt: Resolver, missing: 'keep' | 'remove', out: Change[]) {
  const tgt = new Map(t.variables.map((v) => [v.name, v]));
  const added: Variable[] = [];
  const sharedModes = s.modes.filter((m) => modeMap.has(m));
  const before = (v: Variable, m: string) => v.values[modeMap.get(m)!];
  const sameValues = (a: Variable, b: Variable) => sharedModes.every((m) => sameValue(a.values[m], before(b, m)));

  for (const sv of s.variables) {
    const tv = tgt.get(sv.name);
    if (!tv) { added.push(sv); continue; }
    tgt.delete(sv.name);
    const subject = sub(s.name, sv.name);
    if (sv.type !== tv.type) {
      out.push({
        severity: 'breaking', area: 'variables', kind: 'retyped', subject,
        detail: `Type changes from ${tv.type} to ${sv.type}. Figma can't change a variable's type, so it's deleted and recreated: every binding to it is lost.`,
        impact: layersImpact(tv.usage),
      });
      continue;
    }
    // Raw differences, split into ones you can see and ones that only change how a value is written.
    const differs = sharedModes.filter((m) => sv.values[m] && !sameValue(sv.values[m], before(tv, m)));
    const show = (raw: Value | undefined, resolved: Value | undefined) =>
      raw?.kind === 'alias' && resolved ? `${formatValue(raw)} ${formatValue(resolved)}` : formatValue(raw);
    const visible = differs.filter((m) => {
      const a = rs(sv.values[m], m), b = rt(before(tv, m), modeMap.get(m)!);
      // Unresolvable on either side: treat as a real change.
      return !a || !b || !sameValue(a, b);
    });
    const rowsFor = (ms: string[]) => ms.map((m) => ({
      label: m,
      before: show(before(tv, m), rt(before(tv, m), modeMap.get(m)!)),
      after: show(sv.values[m], rs(sv.values[m], m)),
    }));
    if (visible.length) {
      out.push({
        severity: 'review', area: 'variables', kind: 'changed', subject,
        detail: `Value changes in ${visible.join(', ')}${tv.usage ? `; ${plural(tv.usage, 'layer')} will look different` : ''}.`,
        rows: rowsFor(visible), impact: layersImpact(tv.usage),
      });
    }
    const quiet = differs.filter((m) => !visible.includes(m));
    if (quiet.length) {
      out.push({
        severity: 'safe', area: 'variables', kind: 'changed', subject,
        detail: `Now ${quiet.every((m) => sv.values[m].kind === 'alias') ? 'an alias' : 'a literal'} with the same resolved value in ${quiet.join(', ')}. Nothing looks different.`,
        rows: rowsFor(quiet),
      });
    }
    if (!!sv.hidden !== !!tv.hidden) {
      out.push({ severity: sv.hidden ? 'review' : 'safe', area: 'variables', kind: 'changed', subject, detail: sv.hidden ? 'Will be hidden from publishing: library users can no longer pick it.' : 'Will be published to library users.' });
    }
  }

  // Pair a removed and an added variable with the same type and values: almost always a rename.
  const gone = [...tgt.values()];
  for (const a of [...added]) {
    const i = gone.findIndex((g) => g.type === a.type && sharedModes.length > 0 && sameValues(a, g));
    if (i < 0) continue;
    const g = gone.splice(i, 1)[0];
    added.splice(added.indexOf(a), 1);
    const left = missing === 'remove' ? 'deleted' : 'left behind';
    out.push({
      severity: usedSeverity(g.usage), area: 'variables', kind: 'renamed', subject: sub(s.name, `${g.name} → ${a.name}`),
      detail: `Looks like a rename. The import matches by name, so "${a.name}" is created and "${g.name}" is ${left}${g.usage ? `; the ${plural(g.usage, 'layer')} bound to it won't move to the new name` : ''}.`,
      impact: layersImpact(g.usage),
    });
  }
  for (const a of added) {
    out.push({ severity: 'safe', area: 'variables', kind: 'added', subject: sub(s.name, a.name), detail: `New ${a.type.toLowerCase()} variable.`, rows: s.modes.map((m) => ({ label: m, before: '—', after: formatValue(a.values[m]) })) });
  }
  for (const g of gone) {
    out.push(missing === 'remove'
      ? { severity: usedSeverity(g.usage), area: 'variables', kind: 'removed', subject: sub(s.name, g.name), detail: g.usage ? `Will be deleted; ${plural(g.usage, 'layer')} bound to it will be detached.` : 'Will be deleted (nothing in this file uses it).', impact: layersImpact(g.usage) }
      : { severity: 'safe', area: 'variables', kind: 'kept', subject: sub(s.name, g.name), detail: "Not in the source; it's left as is." });
  }
}

// ---------- styles ----------

function diffStyles(src: Style[], tgt: Style[], missing: 'keep' | 'remove', compareMissing: boolean, out: Change[]) {
  const key = (s: Style) => `${s.kind}:${s.name}`;
  const byKey = new Map(tgt.map((s) => [key(s), s]));
  for (const s of src) {
    const t = byKey.get(key(s));
    byKey.delete(key(s));
    const subject = `${s.kind} style ${s.name}`;
    if (!t) { out.push({ severity: 'safe', area: 'styles', kind: 'added', subject, detail: 'New style.' }); continue; }
    const fields = [...new Set([...Object.keys(s.props), ...Object.keys(t.props)])];
    const rows = fields
      .filter((f) => s.props[f] !== undefined && String(s.props[f]) !== String(t.props[f]))
      .map((f) => ({ label: f, before: t.props[f] === undefined ? '—' : String(t.props[f]), after: String(s.props[f]) }));
    if (rows.length) out.push({ severity: 'review', area: 'styles', kind: 'changed', subject, detail: `Changes ${rows.map((r) => r.label).join(', ')}.`, rows, impact: layersImpact(t.usage) });
  }
  if (!compareMissing) return;
  for (const t of byKey.values()) {
    const subject = `${t.kind} style ${t.name}`;
    out.push(missing === 'remove'
      ? { severity: usedSeverity(t.usage), area: 'styles', kind: 'removed', subject, detail: 'Will be deleted.', impact: layersImpact(t.usage) }
      : { severity: 'safe', area: 'styles', kind: 'kept', subject, detail: "Not in the source; it's left as is." });
  }
}

// ---------- components ----------

function diffComponents(src: Component[], tgt: Component[], missing: 'keep' | 'remove', whole: boolean, out: Change[]) {
  const byName = new Map(tgt.map((c) => [c.name, c]));
  for (const s of src) {
    const t = byName.get(s.name);
    byName.delete(s.name);
    if (!t) {
      out.push({ severity: 'safe', area: 'components', kind: 'added', subject: s.name, detail: `New component with ${plural(s.variants.length, 'variant')}.` });
      continue;
    }
    diffProperties(s, t, missing, out);
    diffVariants(s, t, missing, out);
    if ((s.description ?? '') !== (t.description ?? '') && s.description !== undefined) {
      out.push({ severity: 'safe', area: 'components', kind: 'changed', subject: s.name, detail: 'Description changes.' });
    }
  }
  if (whole) {
    for (const t of byName.values()) {
      const n = t.variants.reduce((a, v) => a + (v.instances ?? 0), 0);
      out.push(missing === 'remove'
        ? { severity: usedSeverity(n), area: 'components', kind: 'removed', subject: t.name, detail: n ? `Not in the source. Deleting it would leave ${plural(n, 'instance')} without a main component.` : 'Not in the source; will be deleted.', impact: instImpact(n) }
        : { severity: 'safe', area: 'components', kind: 'kept', subject: t.name, detail: "Not in the source; it's left as is." });
    }
  }
}

function diffProperties(s: Component, t: Component, missing: 'keep' | 'remove', out: Change[]) {
  const total = t.variants.reduce((a, v) => a + (v.instances ?? 0), 0);
  for (const [name, p] of Object.entries(s.properties)) {
    const tp = t.properties[name];
    const subject = sub(s.name, `property ${name}`);
    if (!tp) { out.push({ severity: 'safe', area: 'components', kind: 'added', subject, detail: `New ${p.type.toLowerCase()} property.` }); continue; }
    if (tp.type !== p.type) {
      out.push({ severity: usedSeverity(total), area: 'components', kind: 'retyped', subject, detail: `Type changes from ${tp.type} to ${p.type}; instance overrides of it are lost.`, impact: instImpact(total) });
    } else if (p.default !== undefined && tp.default !== p.default) {
      out.push({ severity: 'review', area: 'components', kind: 'changed', subject, detail: 'Default changes. Instances that never overrode it will show the new default.', rows: [{ label: 'default', before: String(tp.default), after: String(p.default) }], impact: instImpact(total) });
    }
  }
  for (const [name] of Object.entries(t.properties)) {
    if (name in s.properties) continue;
    const subject = sub(s.name, `property ${name}`);
    out.push(missing === 'remove'
      ? { severity: usedSeverity(total), area: 'components', kind: 'removed', subject, detail: 'Will be deleted; instances lose any value they set for it.', impact: instImpact(total) }
      : { severity: 'safe', area: 'components', kind: 'kept', subject, detail: "Not in the source; it's left as is." });
  }
}

/** Props that differ in at most one value, or only in axis names: probably the same variant renamed. */
function looksRenamed(a: string, b: string): boolean {
  const pa = variantProps(a), pb = variantProps(b);
  const ka = Object.keys(pa), kb = Object.keys(pb);
  if (ka.length !== kb.length) return false;
  if (ka.every((k) => k in pb)) return ka.filter((k) => pa[k] !== pb[k]).length === 1;
  return Object.values(pa).sort().join('|') === Object.values(pb).sort().join('|');
}

function diffVariants(s: Component, t: Component, missing: 'keep' | 'remove', out: Change[]) {
  const tgt = new Map(t.variants.map((v) => [v.name, v]));
  const added: Variant[] = [];
  for (const sv of s.variants) {
    const tv = tgt.get(sv.name);
    if (!tv) { added.push(sv); continue; }
    tgt.delete(sv.name);
    if (sv.layers && tv.layers) {
      const gone = tv.layers.filter((l) => !sv.layers!.includes(l));
      const subject = sub(s.name, sv.name);
      for (const l of gone) {
        out.push({ severity: 'review', area: 'components', kind: 'removed', subject: sub(subject, `layer ${l}`), detail: `Layer is removed or renamed; instance overrides on it are lost.`, impact: instImpact(tv.instances) });
      }
    }
  }
  const gone = [...tgt.values()];
  for (const a of [...added]) {
    const i = gone.findIndex((g) => looksRenamed(g.name, a.name));
    if (i < 0) continue;
    const g = gone.splice(i, 1)[0];
    added.splice(added.indexOf(a), 1);
    out.push({
      severity: usedSeverity(g.instances), area: 'components', kind: 'renamed', subject: sub(s.name, `${g.name} → ${a.name}`),
      detail: `Looks like a renamed variant. It's created as a new variant${g.instances ? `; the ${plural(g.instances, 'instance')} of the old one won't switch over and need swapping by hand` : ''}.`,
      impact: instImpact(g.instances),
    });
  }
  for (const a of added) out.push({ severity: 'safe', area: 'components', kind: 'added', subject: sub(s.name, a.name), detail: 'New variant.' });
  for (const g of gone) {
    out.push(missing === 'remove'
      ? { severity: usedSeverity(g.instances), area: 'components', kind: 'removed', subject: sub(s.name, g.name), detail: g.instances ? `Deleting it would leave ${plural(g.instances, 'instance')} without a main component.` : 'Will be deleted (no instances in this file).', impact: instImpact(g.instances) }
      : { severity: g.instances ? 'review' : 'safe', area: 'components', kind: 'kept', subject: sub(s.name, g.name), detail: `Not in the source; it's left as is${g.instances ? ` (${plural(g.instances, 'instance')} still use it)` : ''}.`, impact: instImpact(g.instances) });
  }
}
