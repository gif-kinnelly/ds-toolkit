/**
 * Figma side of the rebinder: find raw values on layers, collect candidate
 * variables with resolved values, and bind them.
 */
import type { Candidate, Field, Finding, Raw, Suggestion } from './match';
import { rgbaToHex } from '../core/values';

export interface ScanOptions {
  /** Skip layers inside instances (binding there creates instance overrides). Default true. */
  skipInstances?: boolean;
}

/** Number fields each finding can bind, in Figma property names. */
export type NumberProp = 'topLeftRadius' | 'topRightRadius' | 'bottomLeftRadius' | 'bottomRightRadius' | 'itemSpacing' | 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom' | 'fontSize' | 'strokeWeight';
export type ScanFinding = Finding & { props?: NumberProp[] };

const CORNERS: NumberProp[] = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
const PADDING: NumberProp[] = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];

type AnyNode = SceneNode & Record<string, unknown> & { boundVariables?: Record<string, unknown>; resolvedVariableModes?: Record<string, string> };
const bound = (n: AnyNode, prop: string) => !!n.boundVariables && n.boundVariables[prop] !== undefined;

function paints(n: AnyNode, key: 'fills' | 'strokes', field: Field, out: ScanFinding[], modes: Record<string, string>) {
  const styleId = n[key === 'fills' ? 'fillStyleId' : 'strokeStyleId'];
  if (styleId && styleId !== '') return; // uses a style: leave it to the style
  const list = n[key];
  if (!Array.isArray(list)) return; // figma.mixed on text with several fills
  (list as Paint[]).forEach((p, index) => {
    if (p.type !== 'SOLID' || p.visible === false) return;
    if ((p as SolidPaint).boundVariables?.color) return;
    out.push({ nodeId: n.id, nodeName: n.name, field, index, value: { kind: 'color', hex: rgbaToHex((p as SolidPaint).color), opacity: p.opacity ?? 1 }, modes });
  });
}

/** Groups a set of number props by value, so equal paddings become one finding. */
function numbers(n: AnyNode, props: NumberProp[], field: Field, out: ScanFinding[], modes: Record<string, string>) {
  const byValue = new Map<number, NumberProp[]>();
  for (const p of props) {
    const v = n[p];
    if (typeof v !== 'number' || v === 0 || bound(n, p)) continue;
    byValue.set(v, [...(byValue.get(v) ?? []), p]);
  }
  for (const [v, ps] of byValue) out.push({ nodeId: n.id, nodeName: n.name, field, value: { kind: 'number', n: v }, modes, props: ps });
}

export function scanNode(n: AnyNode, out: ScanFinding[]) {
  const modes = { ...(n.resolvedVariableModes ?? {}) };
  if ('fills' in n) paints(n, 'fills', n.type === 'TEXT' ? 'text-fill' : 'fill', out, modes);
  if ('strokes' in n && Array.isArray(n.strokes) && (n.strokes as Paint[]).length) {
    paints(n, 'strokes', 'stroke', out, modes);
    if (typeof n.strokeWeight === 'number' && !n.strokeStyleId) numbers(n, ['strokeWeight'], 'stroke-weight', out, modes);
  }
  if ('topLeftRadius' in n) numbers(n, CORNERS, 'radius', out, modes);
  if ('layoutMode' in n && n.layoutMode !== 'NONE') {
    if (n.primaryAxisAlignItems !== 'SPACE_BETWEEN') numbers(n, ['itemSpacing'], 'gap', out, modes);
    numbers(n, PADDING, 'padding', out, modes);
  }
  if (n.type === 'TEXT' && !n.textStyleId && typeof n.fontSize === 'number') numbers(n, ['fontSize'], 'font-size', out, modes);
}

export function scan(roots: readonly SceneNode[], opts: ScanOptions = {}): ScanFinding[] {
  const skip = opts.skipInstances !== false;
  const out: ScanFinding[] = [];
  const visit = (n: SceneNode) => {
    if (skip && n.type === 'INSTANCE') return;
    scanNode(n as AnyNode, out);
    if ('children' in n) for (const c of n.children) visit(c);
  };
  for (const r of roots) visit(r);
  return out;
}

/** Candidate variables (COLOR and FLOAT) with values resolved through aliases, per mode. */
export async function candidates(vars: Variable[]): Promise<Candidate[]> {
  const colCache = new Map<string, VariableCollection | null>();
  const col = async (id: string) => {
    if (!colCache.has(id)) colCache.set(id, await figma.variables.getVariableCollectionByIdAsync(id));
    return colCache.get(id)!;
  };
  const varCache = new Map<string, Variable | null>();
  const getVar = async (id: string) => {
    if (!varCache.has(id)) varCache.set(id, await figma.variables.getVariableByIdAsync(id));
    return varCache.get(id)!;
  };
  /** Follows aliases; a target in another collection resolves in its mode of the same name, else its default. */
  const resolve = async (raw: VariableValue, modeName: string, depth = 0): Promise<VariableValue | undefined> => {
    if (!(raw && typeof raw === 'object' && (raw as VariableAlias).type === 'VARIABLE_ALIAS')) return raw;
    if (depth > 10) return undefined;
    const t = await getVar((raw as VariableAlias).id);
    if (!t) return undefined;
    const tc = await col(t.variableCollectionId);
    if (!tc) return undefined;
    const m = tc.modes.find((x) => x.name === modeName) ?? tc.modes.find((x) => x.modeId === tc.defaultModeId)!;
    return resolve(t.valuesByMode[m.modeId], modeName, depth + 1);
  };

  const out: Candidate[] = [];
  for (const v of vars) {
    if (v.resolvedType !== 'COLOR' && v.resolvedType !== 'FLOAT') continue;
    const c = await col(v.variableCollectionId);
    if (!c) continue;
    const values: Record<string, string | number> = {};
    let alias = false;
    for (const m of c.modes) {
      const raw = v.valuesByMode[m.modeId];
      if (raw && typeof raw === 'object' && (raw as VariableAlias).type === 'VARIABLE_ALIAS') alias = true;
      const r = await resolve(raw, m.name);
      if (r === undefined) continue;
      if (v.resolvedType === 'COLOR' && typeof r === 'object') values[m.modeId] = rgbaToHex(r as RGBA);
      if (v.resolvedType === 'FLOAT' && typeof r === 'number') values[m.modeId] = r;
    }
    out.push({ id: v.id, name: v.name, collectionId: c.id, collection: c.name, type: v.resolvedType, scopes: [...v.scopes], hidden: v.hiddenFromPublishing, alias, values, defaultModeId: c.defaultModeId });
  }
  return out;
}

/** Still the value the scan saw? Layers can change between scan and apply. */
function unchanged(n: AnyNode, f: ScanFinding): boolean {
  if (f.value.kind === 'color') {
    const list = n[f.field === 'stroke' ? 'strokes' : 'fills'];
    const p = Array.isArray(list) ? (list as Paint[])[f.index!] : undefined;
    return !!p && p.type === 'SOLID' && !(p as SolidPaint).boundVariables?.color && rgbaToHex((p as SolidPaint).color) === f.value.hex && Math.abs((p.opacity ?? 1) - f.value.opacity) < 0.001;
  }
  const want = (f.value as Extract<Raw, { kind: 'number' }>).n;
  return (f.props ?? []).every((p) => n[p] === want && !bound(n, p));
}

/** Binds each finding to a variable. Returns how many layers changed and how many were skipped. */
export async function bind(items: { finding: ScanFinding; variable: Variable; suggestion: Pick<Suggestion, 'absorbsOpacity'> }[]) {
  let done = 0, skipped = 0;
  for (const { finding: f, variable, suggestion } of items) {
    const n = (await figma.getNodeByIdAsync(f.nodeId)) as AnyNode | null;
    if (!n || n.removed || !unchanged(n, f)) { skipped++; continue; }
    if (f.value.kind === 'color') {
      const key = f.field === 'stroke' ? 'strokes' : 'fills';
      const list = [...(n[key] as Paint[])];
      let p = figma.variables.setBoundVariableForPaint(list[f.index!] as SolidPaint, 'color', variable);
      if (suggestion.absorbsOpacity) p = { ...p, opacity: 1 };
      list[f.index!] = p;
      (n as unknown as Record<string, unknown>)[key] = list;
    } else {
      for (const p of f.props ?? []) (n as unknown as { setBoundVariable(f: string, v: Variable): void }).setBoundVariable(p, variable);
    }
    done++;
  }
  return { done, skipped };
}
