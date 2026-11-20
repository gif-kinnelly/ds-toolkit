/** Reads any mix of supported files into one snapshot, detecting each file's format. */
import type { Snapshot } from '../core/snapshot';
import { fromDtcg, type DtcgFile, type DtcgOptions } from './dtcg';
import { fromFigmaRest, isRestVariables } from './figma-rest';
import { fromUiSpec, isUiSpec } from './ui-spec';

export type Format = 'snapshot' | 'ui-spec' | 'figma-rest' | 'dtcg';

export const isSnapshot = (x: unknown): x is Snapshot =>
  typeof x === 'object' && x !== null && Array.isArray((x as Snapshot).collections) && Array.isArray((x as Snapshot).components) && Array.isArray((x as Snapshot).styles);

export function detect(json: unknown): Format {
  if (isSnapshot(json)) return 'snapshot';
  if (isUiSpec(json)) return 'ui-spec';
  if (isRestVariables(json)) return 'figma-rest';
  return 'dtcg';
}

/** Combines snapshots; later ones win on a name clash. Collections with the same name merge their modes and variables. */
export function merge(parts: Snapshot[], source?: string): Snapshot {
  const out: Snapshot = { source: source ?? parts.map((p) => p.source).join(' + '), collections: [], styles: [], components: [] };
  for (const p of parts) {
    for (const c of p.collections) {
      const have = out.collections.find((x) => x.name === c.name);
      if (!have) { out.collections.push({ ...c, modes: [...c.modes], variables: c.variables.map((v) => ({ ...v, values: { ...v.values } })) }); continue; }
      for (const m of c.modes) if (!have.modes.includes(m)) have.modes.push(m);
      for (const v of c.variables) {
        const hv = have.variables.find((x) => x.name === v.name);
        if (hv) Object.assign(hv.values, v.values); else have.variables.push({ ...v, values: { ...v.values } });
      }
    }
    for (const s of p.styles) {
      const i = out.styles.findIndex((x) => x.kind === s.kind && x.name === s.name);
      if (i >= 0) out.styles[i] = s; else out.styles.push(s);
    }
    for (const c of p.components) {
      const i = out.components.findIndex((x) => x.name === c.name);
      if (i >= 0) out.components[i] = c; else out.components.push(c);
    }
    if (p.hasUsage) out.hasUsage = true;
    if (p.warnings?.length) out.warnings = [...(out.warnings ?? []), ...p.warnings];
  }
  return out;
}

export interface InputFile { path: string; text: string }

export function load(files: InputFile[], opts: DtcgOptions = {}): Snapshot {
  const parts: Snapshot[] = [];
  const dtcg: DtcgFile[] = [];
  for (const f of files) {
    let json: unknown;
    try { json = JSON.parse(f.text); } catch (e) { throw new Error(`${f.path}: not valid JSON (${(e as Error).message})`); }
    const fmt = detect(json);
    if (fmt === 'snapshot') parts.push(json as Snapshot);
    else if (fmt === 'ui-spec') parts.push(fromUiSpec(json as Parameters<typeof fromUiSpec>[0], f.path));
    else if (fmt === 'figma-rest') parts.push(fromFigmaRest(json as Parameters<typeof fromFigmaRest>[0], f.path));
    else dtcg.push({ path: f.path, json });
  }
  if (dtcg.length) parts.push(fromDtcg(dtcg, opts));
  if (parts.length === 1) return parts[0];
  return merge(parts, files.map((f) => f.path).join(', '));
}
