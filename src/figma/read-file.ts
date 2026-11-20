/**
 * Live Figma file -> snapshot, inside a plugin. Counts how many layers bind
 * each variable or use each style, and how many instances each variant has,
 * so a diff can say what a change actually touches.
 */
import type { Collection, Component, ComponentProperty, Snapshot, Style, Value, Variant } from '../core/snapshot';
import { rgbaToHex } from '../core/values';
import { figmaValue } from '../adapters/figma-rest';

export interface ReadOptions {
  /** Count usage across every page (slower on big files) or only the current page. Default "file". */
  scope?: 'file' | 'page';
  /** Only read these components (instance counting is the slow part). Default: all. */
  components?: Set<string>;
  /** Skip counting usage entirely (fast; for exporting a snapshot). */
  skipUsage?: boolean;
  onProgress?: (message: string) => void;
}

const WEIGHT: Record<string, number> = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
export const weightOf = (style: string) => WEIGHT[style.toLowerCase().replace(/[\s_-]|italic/g, '')] ?? 400;

type Bound = VariableAlias | VariableAlias[] | undefined;
const aliasIds = (b: Bound): string[] => (Array.isArray(b) ? b.map((x) => x.id) : b ? [b.id] : []);

/** Every variable id a node binds: its own fields, plus paints and effects. */
export function boundVariableIds(node: SceneNode): Set<string> {
  const ids = new Set<string>();
  const bv = (node as { boundVariables?: Record<string, Bound> }).boundVariables;
  if (bv) for (const v of Object.values(bv)) for (const id of aliasIds(v as Bound)) ids.add(id);
  for (const key of ['fills', 'strokes'] as const) {
    const paints = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(paints)) for (const p of paints as Paint[]) {
      const pb = (p as SolidPaint).boundVariables;
      if (pb && pb.color) ids.add(pb.color.id);
    }
  }
  const effects = (node as { effects?: readonly Effect[] }).effects;
  if (Array.isArray(effects)) for (const e of effects) {
    const eb = (e as { boundVariables?: Record<string, VariableAlias> }).boundVariables;
    if (eb) for (const a of Object.values(eb)) ids.add(a.id);
  }
  return ids;
}

/** Style ids a node uses. Mixed text styles are read per character range. */
export function usedStyleIds(node: SceneNode): string[] {
  const out: string[] = [];
  const n = node as unknown as Record<string, unknown>;
  for (const key of ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId']) {
    const v = n[key];
    if (typeof v === 'string' && v) out.push(v);
  }
  if (node.type === 'TEXT' && node.textStyleId === figma.mixed) {
    for (const seg of node.getStyledTextSegments(['textStyleId'])) if (seg.textStyleId) out.push(seg.textStyleId);
  }
  return out;
}

function layerPaths(node: BaseNode & ChildrenMixin, prefix = '', out: string[] = []): string[] {
  for (const c of node.children) {
    const p = prefix ? `${prefix}/${c.name}` : c.name;
    out.push(p);
    if ('children' in c) layerPaths(c as BaseNode & ChildrenMixin, p, out);
  }
  return out;
}

const varRef = (bv: Record<string, Bound> | undefined, field: string, nameOf: (id: string) => string | undefined) => {
  const id = bv ? aliasIds(bv[field])[0] : undefined;
  return id ? `var:${nameOf(id) ?? id}` : undefined;
};

function propertyType(t: ComponentPropertyType): ComponentProperty['type'] | null {
  if (t === 'VARIANT') return null;
  return t as ComponentProperty['type'];
}

export async function readFigmaFile(opts: ReadOptions = {}): Promise<Snapshot> {
  const say = opts.onProgress ?? (() => {});
  say('Reading variables…');
  const rawCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const rawVars = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(rawVars.map((v) => [v.id, v]));
  const nameOf = (id: string) => byId.get(id)?.name;

  const usage = new Map<string, number>();
  const styleUsage = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  // Styles first: they can bind variables too, and that counts as a use.
  say('Reading styles…');
  const styles: Style[] = [];
  const styleIds: string[] = []; // parallel to styles
  for (const s of await figma.getLocalTextStylesAsync()) {
    const bv = s.boundVariables as Record<string, Bound> | undefined;
    if (bv) for (const v of Object.values(bv)) for (const id of aliasIds(v)) bump(usage, id);
    const lh = s.lineHeight;
    styles.push({
      name: s.name, kind: 'text',
      props: {
        fontFamily: varRef(bv, 'fontFamily', nameOf) ?? s.fontName.family,
        fontWeight: varRef(bv, 'fontWeight', nameOf) ?? weightOf(s.fontName.style),
        fontSize: varRef(bv, 'fontSize', nameOf) ?? s.fontSize,
        lineHeight: varRef(bv, 'lineHeight', nameOf) ?? (lh.unit === 'PIXELS' ? lh.value : lh.unit === 'PERCENT' ? `${lh.value}%` : 'auto'),
      },
    });
    styleIds.push(s.id);
  }
  for (const s of await figma.getLocalEffectStylesAsync()) {
    const props: Record<string, string | number> = {};
    s.effects.filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW').forEach((e, i) => {
      const sh = e as DropShadowEffect;
      const eb = (sh as { boundVariables?: Record<string, VariableAlias> }).boundVariables ?? {};
      for (const a of Object.values(eb)) bump(usage, a.id);
      props[`shadow${i}.color`] = eb.color ? `var:${nameOf(eb.color.id) ?? eb.color.id}` : rgbaToHex(sh.color);
      props[`shadow${i}.x`] = sh.offset.x; props[`shadow${i}.y`] = sh.offset.y;
      props[`shadow${i}.blur`] = sh.radius; props[`shadow${i}.spread`] = sh.spread ?? 0;
    });
    styles.push({ name: s.name, kind: 'effect', props });
    styleIds.push(s.id);
  }
  for (const s of await figma.getLocalPaintStylesAsync()) {
    const p = s.paints[0];
    const props: Record<string, string | number> = {};
    if (p && p.type === 'SOLID') {
      const b = p.boundVariables?.color;
      if (b) bump(usage, b.id);
      props.color = b ? `var:${nameOf(b.id) ?? b.id}` : rgbaToHex({ ...p.color, a: p.opacity ?? 1 });
    } else if (p) props.type = p.type;
    styles.push({ name: s.name, kind: 'paint', props });
    styleIds.push(s.id);
  }

  // Layers: one count per layer per variable, so a frame binding a color to both fill and stroke counts once.
  if (!opts.skipUsage) {
    const pages = opts.scope === 'page' ? [figma.currentPage] : (await figma.loadAllPagesAsync(), figma.root.children);
    for (const page of pages) {
      say(`Counting usage on "${page.name}"…`);
      for (const node of page.findAll()) {
        for (const id of boundVariableIds(node)) bump(usage, id);
        for (const id of new Set(usedStyleIds(node))) bump(styleUsage, id);
      }
    }
  }
  if (!opts.skipUsage) styles.forEach((s, i) => { s.usage = styleUsage.get(styleIds[i]) ?? 0; });

  const collections: Collection[] = rawCollections.map((c) => {
    const modes = [...c.modes].sort((a, b) => (a.modeId === c.defaultModeId ? -1 : b.modeId === c.defaultModeId ? 1 : 0));
    const parentId = (c as { parentVariableCollectionId?: string }).parentVariableCollectionId;
    const parent = parentId ? rawCollections.find((x) => x.id === parentId)?.name : undefined;
    return {
      name: c.name,
      modes: modes.map((m) => m.name),
      ...(parent ? { extends: parent } : {}),
      variables: c.variableIds.map((id) => byId.get(id)).filter((v): v is Variable => !!v).map((v) => {
        const values: Record<string, Value> = {};
        for (const m of modes) {
          const val = figmaValue(v.valuesByMode[m.modeId], v.resolvedType, nameOf);
          if (val) values[m.name] = val;
        }
        return {
          name: v.name, type: v.resolvedType, values,
          ...(v.hiddenFromPublishing ? { hidden: true } : {}),
          ...(v.description ? { description: v.description } : {}),
          ...(opts.skipUsage ? {} : { usage: usage.get(v.id) ?? 0 }),
        };
      }),
    };
  });

  say('Reading components…');
  const components: Component[] = [];
  if (opts.scope !== 'page') await figma.loadAllPagesAsync();
  const seen = new Set<string>();
  const pages = opts.scope === 'page' ? [figma.currentPage] : figma.root.children;
  for (const page of pages) {
    const nodes = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
    for (const node of nodes) {
      if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') continue;
      if (seen.has(node.name) || (opts.components && !opts.components.has(node.name))) continue;
      seen.add(node.name);
      const defs = node.componentPropertyDefinitions;
      const properties: Record<string, ComponentProperty> = {};
      for (const [key, d] of Object.entries(defs)) {
        const type = propertyType(d.type);
        if (type) properties[key.split('#')[0]] = { type, default: d.defaultValue as string | boolean };
      }
      const members = node.type === 'COMPONENT_SET' ? (node.children as ComponentNode[]) : [node];
      const variants: Variant[] = [];
      for (const m of members) {
        const v: Variant = { name: node.type === 'COMPONENT_SET' ? m.name : '', layers: layerPaths(m) };
        if (!opts.skipUsage) v.instances = (await m.getInstancesAsync()).length;
        variants.push(v);
      }
      components.push({ name: node.name, ...(node.description ? { description: node.description } : {}), properties, variants });
    }
  }

  return { source: `Figma: ${figma.root.name}`, collections, styles, components, hasUsage: !opts.skipUsage };
}
