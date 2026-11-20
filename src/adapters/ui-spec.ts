/**
 * Component spec -> snapshot. The spec format is the one used by the
 * ui-components "UI Components Sync" plugin: tokens as collections of
 * variables (values literal or "{alias}"), text/effect styles, and components
 * whose variants are small auto-layout trees.
 */
import type { Collection, Component, Snapshot, Style, Value, Variable } from '../core/snapshot';
import { variantName } from '../core/snapshot';
import { normalizeHex } from '../core/values';

interface SpecNode { type: 'frame' | 'text'; name: string; children?: SpecNode[] }
interface SpecVariable { name: string; type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'; value?: string | number | boolean; values?: Record<string, string | number | boolean>; hidden?: boolean }
interface SpecCollection { name: string; modes: string[]; variables: SpecVariable[] }
interface SpecTextStyle { name: string; fontFamily: string; fontWeight: number; fontSize: string | number; lineHeight: string | number }
interface SpecEffectStyle { name: string; shadows: { color: string; x: number; y: number; blur: number; spread: number }[] }
export interface UiSpec {
  name: string;
  tokens?: { collections?: SpecCollection[]; textStyles?: SpecTextStyle[]; effectStyles?: SpecEffectStyle[] } | Record<string, Record<string, string | number>>;
  components: { name: string; description?: string; properties?: Record<string, { type: 'TEXT' | 'BOOLEAN'; default: string | boolean }>; variants: { props: Record<string, string>; root: SpecNode }[] }[];
}

export const isUiSpec = (x: unknown): x is UiSpec =>
  typeof x === 'object' && x !== null && typeof (x as UiSpec).name === 'string' && Array.isArray((x as UiSpec).components);

/** "color/primary" is a reference; "#hex" and numbers are literals (same rule as the plugin). */
const isRef = (v: unknown): v is string => typeof v === 'string' && !v.startsWith('#') && v.includes('/');

function value(raw: string | number | boolean, type: SpecVariable['type']): Value {
  if (typeof raw === 'string') {
    const m = /^\{(.+)\}$/.exec(raw);
    if (m) return { kind: 'alias', name: m[1] };
  }
  if (type === 'COLOR') return { kind: 'color', hex: normalizeHex(String(raw)) ?? String(raw) };
  if (type === 'FLOAT') return { kind: 'number', n: Number(raw) };
  if (type === 'BOOLEAN') return { kind: 'boolean', b: raw === true || raw === 'true' };
  return { kind: 'string', s: String(raw) };
}

/** The flat legacy form { group: { name: value } } becomes one "Theme" collection. */
function collections(tokens: UiSpec['tokens']): SpecCollection[] {
  if (!tokens) return [];
  if ('collections' in tokens || 'textStyles' in tokens || 'effectStyles' in tokens) {
    return ((tokens as { collections?: SpecCollection[] }).collections) ?? [];
  }
  const variables: SpecVariable[] = [];
  for (const [g, vals] of Object.entries(tokens as Record<string, Record<string, string | number>>)) {
    for (const [k, v] of Object.entries(vals)) variables.push({ name: `${g}/${k}`, type: typeof v === 'number' ? 'FLOAT' : 'COLOR', value: v });
  }
  return [{ name: 'Theme', modes: [], variables }];
}

function layerPaths(node: SpecNode, prefix = '', out: string[] = []): string[] {
  for (const c of node.children ?? []) {
    const p = prefix ? `${prefix}/${c.name}` : c.name;
    out.push(p);
    layerPaths(c, p, out);
  }
  return out;
}

export function fromUiSpec(spec: UiSpec, source = spec.name): Snapshot {
  const cols: Collection[] = collections(spec.tokens).map((cs) => {
    // A collection without declared modes gets Figma's default mode name.
    const modes = cs.modes.length ? cs.modes : ['Mode 1'];
    const variables: Variable[] = cs.variables.map((vs) => {
      const values: Record<string, Value> = {};
      for (const m of modes) {
        const raw = vs.values ? (m in vs.values ? vs.values[m] : vs.values[modes[0]]) : vs.value;
        if (raw !== undefined) values[m] = value(raw, vs.type);
      }
      return { name: vs.name, type: vs.type, values, ...(vs.hidden ? { hidden: true } : {}) };
    });
    return { name: cs.name, modes, variables };
  });

  const t = (spec.tokens ?? {}) as { textStyles?: SpecTextStyle[]; effectStyles?: SpecEffectStyle[] };
  const styles: Style[] = [
    ...(t.textStyles ?? []).map((s): Style => ({
      name: s.name, kind: 'text',
      props: {
        fontFamily: s.fontFamily, fontWeight: s.fontWeight,
        fontSize: isRef(s.fontSize) ? `var:${s.fontSize}` : s.fontSize,
        lineHeight: isRef(s.lineHeight) ? `var:${s.lineHeight}` : s.lineHeight,
      },
    })),
    ...(t.effectStyles ?? []).map((s): Style => {
      const props: Record<string, string | number> = {};
      s.shadows.forEach((sh, i) => {
        props[`shadow${i}.color`] = isRef(sh.color) ? `var:${sh.color}` : normalizeHex(sh.color) ?? sh.color;
        props[`shadow${i}.x`] = sh.x; props[`shadow${i}.y`] = sh.y;
        props[`shadow${i}.blur`] = sh.blur; props[`shadow${i}.spread`] = sh.spread;
      });
      return { name: s.name, kind: 'effect', props };
    }),
  ];

  const components: Component[] = spec.components.map((c) => {
    const axes = Object.keys(c.variants[0]?.props ?? {});
    return {
      name: c.name,
      ...(c.description !== undefined ? { description: c.description } : {}),
      properties: Object.fromEntries(Object.entries(c.properties ?? {}).map(([k, p]) => [k, { type: p.type, default: p.default }])),
      variants: c.variants.map((v) => ({
        name: variantName(Object.fromEntries(axes.map((a) => [a, v.props[a]]))),
        layers: layerPaths(v.root),
      })),
    };
  });

  return { source, collections: cols, styles, components };
}
