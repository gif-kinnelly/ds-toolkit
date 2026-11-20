/**
 * A small in-memory stand-in for the parts of the Figma Plugin API this kit
 * uses. Strict on purpose: calling something it doesn't model throws, so a
 * new API use shows up here before it shows up in Figma.
 */
type Alias = { type: 'VARIABLE_ALIAS'; id: string };
export const alias = (id: string): Alias => ({ type: 'VARIABLE_ALIAS', id });

let seq = 0;
const nid = (p: string) => `${p}:${++seq}`;

export interface MockNode {
  id: string; type: string; name: string; parent?: MockNode; children: MockNode[];
  boundVariables?: Record<string, Alias | Alias[]>;
  fills?: unknown[]; strokes?: unknown[]; effects?: unknown[];
  fillStyleId?: string; strokeStyleId?: string; effectStyleId?: string; textStyleId?: string;
  description?: string;
  componentPropertyDefinitions?: Record<string, { type: string; defaultValue: string | boolean }>;
  mainComponent?: MockNode;
  [k: string]: unknown;
}

export function node(type: string, name: string, extra: Partial<MockNode> = {}, children: MockNode[] = []): MockNode {
  const n: MockNode = { id: nid(type), type, name, children: [], ...extra };
  for (const c of children) { c.parent = n; n.children.push(c); }
  return n;
}

function walk(n: MockNode, out: MockNode[] = []) {
  for (const c of n.children) { out.push(c); walk(c, out); }
  return out;
}

export function installMockFigma(file: {
  name?: string;
  collections: { name: string; modes: string[]; parent?: string }[];
  variables: { name: string; collection: string; type: string; values: Record<string, unknown>; hidden?: boolean }[];
  textStyles?: { name: string; family: string; style: string; size: number; lineHeight: { unit: string; value?: number }; bound?: Record<string, Alias> }[];
  effectStyles?: { name: string; effects: unknown[] }[];
  paintStyles?: { name: string; paints: unknown[] }[];
  pages: MockNode[];
}) {
  const collections = file.collections.map((c) => {
    const modes = c.modes.map((m) => ({ modeId: nid('mode'), name: m }));
    return { id: nid('coll'), name: c.name, modes, defaultModeId: modes[0].modeId, variableIds: [] as string[], parentName: c.parent };
  });
  for (const c of collections) if (c.parentName) (c as Record<string, unknown>).parentVariableCollectionId = collections.find((x) => x.name === c.parentName)!.id;
  const varIds = new Map<string, string>();
  for (const v of file.variables) varIds.set(v.name, nid('var'));
  const variables = file.variables.map((v) => {
    const c = collections.find((x) => x.name === v.collection)!;
    const id = varIds.get(v.name)!;
    c.variableIds.push(id);
    const valuesByMode: Record<string, unknown> = {};
    for (const m of c.modes) {
      const raw = v.values[m.name];
      valuesByMode[m.modeId] = typeof raw === 'string' && raw.startsWith('@') ? alias(varIds.get(raw.slice(1))!) : raw;
    }
    return { id, name: v.name, resolvedType: v.type, variableCollectionId: c.id, valuesByMode, hiddenFromPublishing: !!v.hidden, description: '' };
  });
  const textStyles = (file.textStyles ?? []).map((s) => ({ id: nid('S'), name: s.name, fontName: { family: s.family, style: s.style }, fontSize: s.size, lineHeight: s.lineHeight, boundVariables: s.bound ?? {} }));
  const effectStyles = (file.effectStyles ?? []).map((s) => ({ id: nid('S'), name: s.name, effects: s.effects }));
  const paintStyles = (file.paintStyles ?? []).map((s) => ({ id: nid('S'), name: s.name, paints: s.paints }));

  const pages = file.pages;
  const all = () => pages.flatMap((p) => walk(p));
  for (const p of pages) {
    p.findAll = () => walk(p);
    p.findAllWithCriteria = ({ types }: { types: string[] }) => walk(p).filter((n) => types.includes(n.type));
  }
  for (const n of all()) {
    if (n.type === 'COMPONENT') n.getInstancesAsync = async () => all().filter((x) => x.type === 'INSTANCE' && x.mainComponent === n);
    if (n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && n.parent?.type !== 'COMPONENT_SET')) {
      n.componentPropertyDefinitions ??= {};
      n.description ??= '';
    }
  }

  const strict = <T extends object>(name: string, obj: T): T => new Proxy(obj, {
    get(t, k) {
      if (k in t || typeof k === 'symbol') return (t as Record<string | symbol, unknown>)[k];
      throw new Error(`mock figma: ${name}.${String(k)} is not modelled`);
    },
  });

  const mixed = Symbol('mixed');
  (globalThis as Record<string, unknown>).figma = strict('figma', {
    mixed,
    root: { name: file.name ?? 'Mock file', children: pages },
    currentPage: pages[0],
    loadAllPagesAsync: async () => {},
    getLocalTextStylesAsync: async () => textStyles,
    getLocalEffectStylesAsync: async () => effectStyles,
    getLocalPaintStylesAsync: async () => paintStyles,
    variables: strict('figma.variables', {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
    }),
  });
  return { varIds, textStyles, effectStyles, paintStyles };
}
