/** Figma side of the inventory: count the raw values used on layers. */
import type { Sample, TypeSample } from './cluster';
import { rgbaToHex } from '../core/values';
import { weightOf } from '../figma/read-file';

export interface Collected {
  colors: Sample<string>[];
  spacing: Sample<number>[];
  radii: Sample<number>[];
  fontSizes: Sample<number>[];
  type: Sample<TypeSample>[];
  layers: number;
}

type AnyNode = SceneNode & Record<string, unknown> & { boundVariables?: Record<string, unknown> };

class Counter<T> {
  private m = new Map<string, Sample<T>>();
  add(key: string, value: T, n = 1) { const s = this.m.get(key) ?? { value, count: 0 }; s.count += n; this.m.set(key, s); }
  list() { return [...this.m.values()]; }
}

export interface CollectOptions {
  /** Skip layers inside instances: they repeat their component's values. Default true. */
  skipInstances?: boolean;
  /** Also count values already bound to variables or using styles. Default false. */
  includeTokenized?: boolean;
}

export function collect(roots: readonly SceneNode[], opts: CollectOptions = {}): Collected {
  const skip = opts.skipInstances !== false;
  const all = !!opts.includeTokenized;
  const colors = new Counter<string>(), spacing = new Counter<number>(), radii = new Counter<number>(), sizes = new Counter<number>(), type = new Counter<TypeSample>();
  let layers = 0;
  const free = (n: AnyNode, prop: string) => all || !n.boundVariables || n.boundVariables[prop] === undefined;

  const paints = (n: AnyNode, key: 'fills' | 'strokes') => {
    if (!all && n[key === 'fills' ? 'fillStyleId' : 'strokeStyleId']) return;
    const list = n[key];
    if (!Array.isArray(list)) return;
    for (const p of list as Paint[]) {
      if (p.type !== 'SOLID' || p.visible === false) continue;
      if (!all && (p as SolidPaint).boundVariables?.color) continue;
      const opacity = p.opacity ?? 1;
      const hex = rgbaToHex({ ...(p as SolidPaint).color, a: opacity });
      colors.add(hex, hex);
    }
  };

  const visit = (node: SceneNode) => {
    if (skip && node.type === 'INSTANCE') return;
    const n = node as AnyNode;
    layers++;
    if ('fills' in n && n.type !== 'TEXT') paints(n, 'fills');
    if ('strokes' in n) paints(n, 'strokes');
    if ('topLeftRadius' in n) {
      const corners = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'].filter((c) => free(n, c)).map((c) => n[c] as number).filter((v) => typeof v === 'number' && v > 0);
      for (const v of new Set(corners)) radii.add(String(v), v);
    }
    if ('layoutMode' in n && n.layoutMode !== 'NONE') {
      if (n.primaryAxisAlignItems !== 'SPACE_BETWEEN' && typeof n.itemSpacing === 'number' && n.itemSpacing > 0 && free(n, 'itemSpacing')) spacing.add(String(n.itemSpacing), n.itemSpacing);
      const pads = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].filter((p) => free(n, p)).map((p) => n[p] as number).filter((v) => typeof v === 'number' && v > 0);
      for (const v of new Set(pads)) spacing.add(String(v), v);
    }
    if (node.type === 'TEXT') {
      paints(n, 'fills');
      if (all || !node.textStyleId) {
        // Mixed text is counted per styled run.
        const runs = node.getStyledTextSegments(['fontSize', 'fontName', 'lineHeight']);
        for (const r of runs) {
          const lh = r.lineHeight.unit === 'PIXELS' ? Math.round(r.lineHeight.value * 100) / 100 : r.lineHeight.unit === 'PERCENT' ? `${Math.round(r.lineHeight.value)}%` : 'auto';
          const t: TypeSample = { family: r.fontName.family, weight: weightOf(r.fontName.style), size: r.fontSize, lineHeight: lh };
          sizes.add(String(r.fontSize), r.fontSize);
          type.add(`${t.family}|${t.weight}|${t.size}|${t.lineHeight}`, t);
        }
      }
    }
    if ('children' in node) for (const c of node.children) visit(c);
  };
  for (const r of roots) visit(r);
  return { colors: colors.list(), spacing: spacing.list(), radii: radii.list(), fontSizes: sizes.list(), type: type.list(), layers };
}
