/**
 * Figma REST API "GET /v1/files/:key/variables/local" response -> snapshot.
 * (That endpoint needs an Enterprise plan; on other plans, commit a snapshot
 * exported by the plugin instead and diff that.)
 */
import type { Collection, Snapshot, Value, VariableType } from '../core/snapshot';
import { rgbaToHex } from '../core/values';

interface RestVariable {
  id: string; name: string; variableCollectionId: string; resolvedType: VariableType;
  valuesByMode: Record<string, unknown>; hiddenFromPublishing?: boolean; description?: string; remote?: boolean;
}
interface RestCollection { id: string; name: string; modes: { modeId: string; name: string }[]; defaultModeId: string; remote?: boolean; parentVariableCollectionId?: string }
export interface RestVariablesResponse { meta: { variables: Record<string, RestVariable>; variableCollections: Record<string, RestCollection> } }

export const isRestVariables = (x: unknown): x is RestVariablesResponse =>
  typeof x === 'object' && x !== null && typeof (x as RestVariablesResponse).meta?.variableCollections === 'object';

export function figmaValue(raw: unknown, type: VariableType, nameOf: (id: string) => string | undefined): Value | null {
  if (typeof raw === 'object' && raw !== null && (raw as { type?: string }).type === 'VARIABLE_ALIAS') {
    const id = (raw as { id: string }).id;
    return { kind: 'alias', name: nameOf(id) ?? `<unknown ${id}>` };
  }
  switch (type) {
    case 'COLOR': return typeof raw === 'object' && raw !== null ? { kind: 'color', hex: rgbaToHex(raw as { r: number; g: number; b: number; a?: number }) } : null;
    case 'FLOAT': return typeof raw === 'number' ? { kind: 'number', n: raw } : null;
    case 'BOOLEAN': return typeof raw === 'boolean' ? { kind: 'boolean', b: raw } : null;
    case 'STRING': return typeof raw === 'string' ? { kind: 'string', s: raw } : null;
    default: return raw === undefined ? null : { kind: 'string', s: JSON.stringify(raw) };
  }
}

export function fromFigmaRest(res: RestVariablesResponse, source = 'Figma REST'): Snapshot {
  const { variables, variableCollections } = res.meta;
  const nameOf = (id: string) => variables[id]?.name;
  const cols = new Map<string, Collection>();
  for (const c of Object.values(variableCollections)) {
    if (c.remote) continue;
    const modes = [...c.modes].sort((a, b) => (a.modeId === c.defaultModeId ? -1 : b.modeId === c.defaultModeId ? 1 : 0));
    const parent = c.parentVariableCollectionId ? variableCollections[c.parentVariableCollectionId]?.name : undefined;
    cols.set(c.id, { name: c.name, modes: modes.map((m) => m.name), variables: [], ...(parent ? { extends: parent } : {}) });
  }
  for (const v of Object.values(variables)) {
    const c = cols.get(v.variableCollectionId);
    const rc = variableCollections[v.variableCollectionId];
    if (!c || v.remote) continue;
    const values: Record<string, Value> = {};
    for (const m of rc.modes) {
      const val = figmaValue(v.valuesByMode[m.modeId], v.resolvedType, nameOf);
      if (val) values[m.name] = val;
    }
    c.variables.push({ name: v.name, type: v.resolvedType, values, ...(v.hiddenFromPublishing ? { hidden: true } : {}), ...(v.description ? { description: v.description } : {}) });
  }
  return { source, collections: [...cols.values()], styles: [], components: [] };
}
