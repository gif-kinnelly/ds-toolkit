/**
 * A small in-memory stand-in for the parts of the Figma Plugin API this kit
 * uses. Strict on purpose: calling something it doesn't model throws, so a
 * new API use shows up here before it shows up in Figma.
 */
type Alias = { type: 'VARIABLE_ALIAS'; id: string };
export const alias = (id: string): Alias => ({ type: 'VARIABLE_ALIAS', id });

let seq = 0;

/** getSharedPluginData / setSharedPluginData with Figma's namespace rule. */
function pluginData() {
  const store = new Map<string, string>();
  const check = (ns: string) => { if (!/^[A-Za-z0-9_.]{3,}$/.test(ns)) throw new Error(`mock figma: bad plugin data namespace "${ns}"`); };
  return {
    getSharedPluginData(ns: string, key: string) { check(ns); return store.get(`${ns}/${key}`) ?? ''; },
    setSharedPluginData(ns: string, key: string, value: string) { check(ns); if (typeof value !== 'string') throw new Error('mock figma: plugin data must be a string'); store.set(`${ns}/${key}`, value); },
  };
}
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
  const n: MockNode = { id: nid(type), type, name, children: [], removed: false, resolvedVariableModes: {}, ...extra };
  if (type === 'TEXT') {
    // Runs: one per node unless the test sets n.runs.
    n.getStyledTextSegments = () => (n.runs as unknown[] | undefined) ?? [{ fontSize: n.fontSize ?? 14, fontName: n.fontName ?? { family: 'Inter', style: 'Regular' }, lineHeight: n.lineHeight ?? { unit: 'AUTO' } }];
  }
  n.setBoundVariable = (field: string, v: { id: string } | null) => {
    if (typeof n[field] !== 'number') throw new Error(`mock figma: can't bind ${field} on ${n.type}`);
    const b = { ...(n.boundVariables ?? {}) };
    if (v) b[field] = alias(v.id); else delete b[field];
    n.boundVariables = b;
  };
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
  variables: { name: string; collection: string; type: string; values: Record<string, unknown>; hidden?: boolean; scopes?: string[] }[];
  textStyles?: { name: string; family: string; style: string; size: number; lineHeight: { unit: string; value?: number }; bound?: Record<string, Alias> }[];
  effectStyles?: { name: string; effects: unknown[] }[];
  paintStyles?: { name: string; paints: unknown[] }[];
  pages: MockNode[];
  /** Max modes per collection (plan limit). Default 20. */
  modeLimit?: number;
}) {
  const collections = file.collections.map((c) => {
    const modes = c.modes.map((m) => ({ modeId: nid('mode'), name: m }));
    return { id: nid('coll'), name: c.name, modes, defaultModeId: modes[0].modeId, variableIds: [] as string[], parentName: c.parent as string | undefined };
  });
  for (const c of collections) if (c.parentName) (c as Record<string, unknown>).parentVariableCollectionId = collections.find((x) => x.name === c.parentName)!.id;
  const varIds = new Map<string, string>();
  for (const v of file.variables) varIds.set(v.name, nid('var'));
  type Coll = (typeof collections)[number];
  const makeVar = (id: string, v: { name: string; type: string; hidden?: boolean; scopes?: string[] }, c: Coll, valuesByMode: Record<string, unknown>) => {
    c.variableIds.push(id);
    return { id, name: v.name, resolvedType: v.type, variableCollectionId: c.id, valuesByMode, hiddenFromPublishing: !!v.hidden, description: '', scopes: v.scopes ?? ['ALL_SCOPES'],
      ...pluginData(),
      setValueForMode(modeId: string, value: unknown) {
        if (!c.modes.some((m) => m.modeId === modeId)) throw new Error(`mock figma: no mode ${modeId} in ${c.name}`);
        valuesByMode[modeId] = value;
      } };
  };
  const variables = file.variables.map((v) => {
    const c = collections.find((x) => x.name === v.collection)!;
    const valuesByMode: Record<string, unknown> = {};
    for (const m of c.modes) {
      const raw = v.values[m.name];
      valuesByMode[m.modeId] = typeof raw === 'string' && raw.startsWith('@') ? alias(varIds.get(raw.slice(1))!) : raw;
    }
    return makeVar(varIds.get(v.name)!, v, c, valuesByMode);
  });
  const collectionMethods = (c: Coll) => Object.assign(c, pluginData(), {
    renameMode(modeId: string, name: string) { c.modes.find((m) => m.modeId === modeId)!.name = name; },
    addMode(name: string) {
      if (c.modes.length >= (file.modeLimit ?? 20)) throw new Error('Limited to ' + (file.modeLimit ?? 20) + ' modes only');
      const modeId = nid('mode');
      c.modes.push({ modeId, name });
      // Figma fills a new mode with the default mode's values.
      for (const v of variables) if (v.variableCollectionId === c.id) v.valuesByMode[modeId] = v.valuesByMode[c.defaultModeId];
      return modeId;
    },
  });
  for (const c of collections) collectionMethods(c);
  const textStyle = (s: { name: string; family: string; style: string; size: number; lineHeight: { unit: string; value?: number }; bound?: Record<string, Alias> }) => {
    const st: Record<string, unknown> = { id: nid('S'), name: s.name, fontName: { family: s.family, style: s.style }, fontSize: s.size, lineHeight: s.lineHeight, boundVariables: { ...(s.bound ?? {}) } };
    st.setBoundVariable = (field: string, v: { id: string }) => { (st.boundVariables as Record<string, Alias>)[field] = alias(v.id); };
    return st;
  };
  const textStyles = (file.textStyles ?? []).map(textStyle);
  const fonts = new Set(['Inter|Regular', 'Inter|Medium', 'Inter|Semi Bold', 'Inter|Bold']);
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
  let selection: MockNode[] = [];
  for (const p of pages) Object.defineProperty(p, 'selection', { get: () => selection, set: (v: MockNode[]) => { selection = v; } });
  const undo = { commits: 0 };
  (globalThis as Record<string, unknown>).figma = strict('figma', {
    mixed,
    root: { name: file.name ?? 'Mock file', children: pages },
    currentPage: pages[0],
    loadAllPagesAsync: async () => {},
    getLocalTextStylesAsync: async () => textStyles,
    getLocalEffectStylesAsync: async () => effectStyles,
    getLocalPaintStylesAsync: async () => paintStyles,
    getNodeByIdAsync: async (id: string) => all().find((n) => n.id === id) ?? null,
    setCurrentPageAsync: async (p: MockNode) => { (globalThis as unknown as { figma: { currentPage: MockNode } }).figma.currentPage = p; },
    commitUndo: () => { undo.commits++; },
    loadFontAsync: async (f: { family: string; style: string }) => { if (!fonts.has(`${f.family}|${f.style}`)) throw new Error(`mock figma: font ${f.family} ${f.style} not installed`); },
    createTextStyle: () => { const st = textStyle({ name: 'Text style', family: 'Inter', style: 'Regular', size: 12, lineHeight: { unit: 'AUTO' } }); textStyles.push(st); return st; },
    viewport: { scrollAndZoomIntoView: () => {} },
    variables: strict('figma.variables', {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
      createVariableCollection: (name: string) => {
        const modes = [{ modeId: nid('mode'), name: 'Mode 1' }];
        const c = collectionMethods({ id: nid('coll'), name, modes, defaultModeId: modes[0].modeId, variableIds: [] as string[], parentName: undefined as string | undefined });
        collections.push(c);
        return c;
      },
      createVariable: (name: string, c: Coll, type: string) => {
        if (variables.some((v) => v.name === name && v.variableCollectionId === c.id)) throw new Error(`mock figma: duplicate variable ${name}`);
        const v = makeVar(nid('var'), { name, type }, c, {});
        variables.push(v);
        return v;
      },
      getVariableCollectionByIdAsync: async (id: string) => collections.find((c) => c.id === id) ?? null,
      getVariableByIdAsync: async (id: string) => variables.find((v) => v.id === id) ?? null,
      setBoundVariableForPaint: (paint: Record<string, unknown>, field: string, v: { id: string }) => {
        if (field !== 'color' || paint.type !== 'SOLID') throw new Error('mock figma: setBoundVariableForPaint supports SOLID color only');
        return { ...paint, boundVariables: { color: alias(v.id) } };
      },
    }),
  });
  return { varIds, collections, variables, textStyles, effectStyles, paintStyles, undo };
}
