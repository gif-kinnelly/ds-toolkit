/**
 * Turns the raw values found in a file into a proposed token set: colors
 * merged when they're visually the same and named by hue and lightness,
 * spacing and radii snapped to a grid, font sizes named around the body size,
 * and the typography combinations people actually use. Pure: no Figma API.
 */
import { colorDistance } from '../rebind/match';

export interface Sample<T> { value: T; count: number }

// ---------- colors ----------

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** OKLCH: lightness 0..1, chroma, hue in degrees. */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const n = (i: number) => lin(parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = [n(1), n(3), n(5)];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** Hue bands (OKLCH degrees) to familiar names; edges are midpoints between Tailwind's 600 hues. */
const HUES: [number, string][] = [[9, 'pink'], [22, 'rose'], [34, 'red'], [50, 'orange'], [67, 'amber'], [104, 'yellow'], [140, 'lime'], [156, 'green'], [174, 'emerald'], [203, 'teal'], [232, 'cyan'], [252, 'sky'], [270, 'blue'], [285, 'indigo'], [298, 'violet'], [312, 'purple'], [341, 'fuchsia'], [360, 'pink']];
/**
 * OKLCH lightness for the usual 50–950 steps, from Tailwind's palettes: grays
 * (zinc) and saturated hues (mean of blue, indigo, red, green) sit at
 * different lightness for the same step. Names are suggestions, not a standard.
 */
const NEUTRAL: [number, number][] = [[50, 0.985], [100, 0.967], [200, 0.92], [300, 0.871], [400, 0.705], [500, 0.552], [600, 0.442], [700, 0.37], [800, 0.274], [900, 0.21], [950, 0.141]];
const CHROMATIC: [number, number][] = [[50, 0.971], [100, 0.94], [200, 0.89], [300, 0.818], [400, 0.719], [500, 0.642], [600, 0.565], [700, 0.494], [800, 0.429], [900, 0.382], [950, 0.266]];
const STEPS = NEUTRAL;

/** Pale or muted tints drift in hue; they join a stronger color's family within this many degrees. */
const TINT_CHROMA = 0.09;
const TINT_HUE_RANGE = 30;
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function colorName(hex: string): { family: string; step: number | null } {
  const { l, c, h } = oklch(hex);
  if (l > 0.995 && c < 0.01) return { family: 'white', step: null };
  if (l < 0.03) return { family: 'black', step: null };
  const neutral = c < 0.025;
  const family = neutral ? 'gray' : HUES.find(([max]) => h < max)![1];
  const table = neutral ? NEUTRAL : CHROMATIC;
  const step = table.reduce((best, s) => (Math.abs(s[1] - l) < Math.abs(best[1] - l) ? s : best))[0];
  return { family, step };
}

export interface ColorCluster {
  hex: string;
  count: number;
  /** Other colors merged into this one, with their counts. */
  merged: Sample<string>[];
  name: string;
}

/**
 * Merges colors within `maxDistance` (OKLab ΔE ×100) into the most-used one,
 * then names each cluster. Clashing names take the nearest free step.
 */
export function clusterColors(samples: Sample<string>[], maxDistance = 2): ColorCluster[] {
  const sorted = [...samples].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const clusters: { hex: string; count: number; merged: Sample<string>[] }[] = [];
  for (const s of sorted) {
    const into = clusters.find((c) => colorDistance(c.hex, s.value) <= maxDistance);
    if (into) { into.count += s.count; into.merged.push(s); } else clusters.push({ hex: s.value, count: s.count, merged: [] });
  }
  const taken = new Set<string>();
  // Saturated colors anchor families; a pale tint near one in hue joins it (green-100 next to green-700, not "emerald").
  const anchors = clusters.map((c) => ({ ...oklch(c.hex.slice(0, 7)), family: colorName(c.hex.slice(0, 7)).family })).filter((a) => a.c >= TINT_CHROMA && a.family !== 'gray');
  const familyOf = (hex: string, family: string) => {
    const o = oklch(hex);
    if (o.c >= TINT_CHROMA || family === 'gray' || family === 'white' || family === 'black') return family;
    const near = anchors.filter((a) => hueGap(a.h, o.h) <= TINT_HUE_RANGE).sort((a, b) => hueGap(a.h, o.h) - hueGap(b.h, o.h))[0];
    return near ? near.family : family;
  };
  // Name the most-used first so they get the "natural" step.
  return clusters.map((c) => {
    const alpha = c.hex.length === 9 ? c.hex.slice(7) : '';
    const named = colorName(c.hex.slice(0, 7));
    const step = named.step;
    const family = familyOf(c.hex.slice(0, 7), named.family);
    let name: string;
    if (step === null) name = `palette/${family}`;
    else {
      const order = [...STEPS.map((s) => s[0])].sort((a, b) => Math.abs(a - step) - Math.abs(b - step) || a - b);
      const free = order.find((s) => !taken.has(`palette/${family}/${s}`));
      name = free !== undefined ? `palette/${family}/${free}` : `palette/${family}/${step}-${clusters.length}`;
    }
    if (alpha) name += `-a${Math.round((parseInt(alpha, 16) / 255) * 100)}`;
    let unique = name, i = 2;
    while (taken.has(unique)) unique = `${name}-${i++}`;
    taken.add(unique);
    return { ...c, name: unique };
  });
}

// ---------- numbers ----------

export interface ScaleStep { value: number; count: number; merged: Sample<number>[]; name: string; offGrid?: boolean }

/** Snaps values within `tolerance` of a multiple of `base` onto it; keeps the rest as off-grid. */
export function snap(samples: Sample<number>[], base: number, tolerance: number) {
  const steps = new Map<number, ScaleStep>();
  for (const s of samples) {
    // Half a step (2px on a 4px grid) is a normal value too.
    const half = base / 2;
    const nearest = Math.abs(s.value - half) <= Math.min(tolerance, half / 2) ? half : Math.round(s.value / base) * base;
    const onGrid = Math.abs(nearest - s.value) <= tolerance && nearest > 0;
    const v = onGrid ? nearest : s.value;
    const st = steps.get(v) ?? { value: v, count: 0, merged: [], name: '', ...(onGrid ? {} : { offGrid: true }) };
    st.count += s.count;
    if (s.value !== v) st.merged.push(s);
    steps.set(v, st);
  }
  return [...steps.values()].sort((a, b) => a.value - b.value);
}

/** Spacing: Tailwind-style names by multiples of 4 (space/4 = 16px). Off-grid values are reported, not named. */
export function spacingScale(samples: Sample<number>[], base = 4, tolerance = 1): ScaleStep[] {
  return snap(samples, base, tolerance).map((s) => ({ ...s, name: s.offGrid ? '' : `space/${Number((s.value / 4).toFixed(2))}` }));
}

const T_SHIRT = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
/** Names a sorted scale around an anchor step (the anchor gets "md"). */
function tShirt(values: number[], anchor: number, prefix: string): string[] {
  const ai = values.indexOf(anchor);
  return values.map((_, i) => {
    const k = T_SHIRT.indexOf('md') + (i - ai);
    return `${prefix}/${k >= 0 && k < T_SHIRT.length ? T_SHIRT[k] : `${i}`}`;
  });
}

/** Radii: 999+ is "full"; the rest named around the most used one. */
export function radiusScale(samples: Sample<number>[], tolerance = 1): ScaleStep[] {
  const full = samples.filter((s) => s.value >= 999);
  const rest = snap(samples.filter((s) => s.value < 999), 2, tolerance);
  const anchor = [...rest].sort((a, b) => b.count - a.count || b.value - a.value)[0]?.value; // ties: the larger is the usual "md"
  const names = tShirt(rest.map((r) => r.value), anchor, 'radius');
  const out: ScaleStep[] = rest.map((r, i) => ({ value: r.value, count: r.count, merged: r.merged, name: names[i] }));
  if (full.length) out.push({ value: 9999, count: full.reduce((n, s) => n + s.count, 0), merged: full.filter((s) => s.value !== 9999), name: 'radius/full' });
  return out;
}

/** Font sizes: exact values (no snapping), named around the most used size. */
export function fontSizeScale(samples: Sample<number>[]): ScaleStep[] {
  const steps = snap(samples, 1, 0.01);
  const anchor = [...steps].sort((a, b) => b.count - a.count || b.value - a.value)[0]?.value;
  const names = tShirt(steps.map((s) => s.value), anchor, 'font-size');
  return steps.map((s, i) => ({ value: s.value, count: s.count, merged: s.merged, name: names[i] }));
}

// ---------- typography ----------

export interface TypeSample { family: string; weight: number; size: number; lineHeight: number | string }
export interface TypeStyle extends TypeSample { count: number; name: string }

/** The combinations actually used, most common first, named by role guess + size. */
export function typeStyles(samples: Sample<TypeSample>[], sizes: ScaleStep[], max = 12): TypeStyle[] {
  const byKey = new Map<string, TypeStyle>();
  for (const s of samples) {
    const k = `${s.value.family}|${s.value.weight}|${s.value.size}|${s.value.lineHeight}`;
    const t = byKey.get(k) ?? { ...s.value, count: 0, name: '' };
    t.count += s.count;
    byKey.set(k, t);
  }
  const sizeName = (v: number) => sizes.find((x) => x.value === v)?.name.split('/')[1] ?? String(v);
  const body = [...sizes].sort((a, b) => b.count - a.count)[0]?.value ?? 14;
  const top = [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, max);
  const used = new Set<string>();
  return top.map((t) => {
    const role = t.size >= body * 1.4 ? 'heading' : t.size > body && t.weight >= 600 ? 'title' : t.weight >= 500 ? 'label' : t.size < body ? 'caption' : 'body';
    let name = `typography/${role}-${sizeName(t.size)}`;
    let i = 2;
    while (used.has(name)) name = `typography/${role}-${sizeName(t.size)}-${t.weight}${i++ > 2 ? `-${i}` : ''}`;
    used.add(name);
    return { ...t, name };
  });
}

// ---------- output ----------

export interface Proposal {
  colors: ColorCluster[];
  spacing: ScaleStep[];
  radii: ScaleStep[];
  fontSizes: ScaleStep[];
  type: TypeStyle[];
}

/** DTCG tokens for the proposal: one file, ready for Figma's import or this kit's Import Preview. */
export function toDtcg(p: Proposal): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (path: string, token: unknown) => {
    const parts = path.split('/');
    let o = out as Record<string, unknown>;
    for (const k of parts.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
    o[parts[parts.length - 1]] = token;
  };
  const used = (n: number, merged: number) => `Used ${n}×${merged ? `; merges ${merged} near-duplicate${merged === 1 ? '' : 's'}` : ''}.`;
  for (const c of p.colors) put(c.name, { $type: 'color', $value: c.hex, $description: used(c.count, c.merged.length) });
  for (const s of p.spacing.filter((x) => !x.offGrid)) put(s.name, { $type: 'dimension', $value: `${s.value}px`, $description: used(s.count, s.merged.length) });
  for (const r of p.radii) put(r.name, { $type: 'dimension', $value: `${r.value}px`, $description: used(r.count, r.merged.length) });
  for (const f of p.fontSizes) put(f.name, { $type: 'dimension', $value: `${f.value}px`, $description: used(f.count, 0) });
  for (const t of p.type) {
    put(t.name, {
      $type: 'typography',
      $value: { fontFamily: t.family, fontWeight: t.weight, fontSize: `{${p.fontSizes.find((f) => f.value === t.size)?.name.replace(/\//g, '.') ?? ''}}`.replace('{}', `${t.size}px`), lineHeight: typeof t.lineHeight === 'number' ? Number((t.lineHeight / t.size).toFixed(3)) : t.lineHeight },
      $description: `Used ${t.count}×.`,
    });
  }
  return out;
}
