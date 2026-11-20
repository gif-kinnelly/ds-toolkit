/**
 * Matching raw values on layers to variables. Pure: no Figma API, so it's
 * tested on plain data. The plugin feeds it findings from a scan and
 * candidate variables with their values resolved per mode.
 */

export type Field = 'fill' | 'text-fill' | 'stroke' | 'radius' | 'gap' | 'padding' | 'font-size' | 'stroke-weight';

/** Figma scopes that allow a variable to be used for a field (ALL_SCOPES allows everything). */
export const SCOPES: Record<Field, string[]> = {
  fill: ['ALL_SCOPES', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL'],
  'text-fill': ['ALL_SCOPES', 'ALL_FILLS', 'TEXT_FILL'],
  stroke: ['ALL_SCOPES', 'STROKE_COLOR'],
  radius: ['ALL_SCOPES', 'CORNER_RADIUS'],
  gap: ['ALL_SCOPES', 'GAP'],
  padding: ['ALL_SCOPES', 'GAP'],
  'font-size': ['ALL_SCOPES', 'FONT_SIZE'],
  'stroke-weight': ['ALL_SCOPES', 'STROKE_FLOAT'],
};
export const isColorField = (f: Field) => f === 'fill' || f === 'text-fill' || f === 'stroke';

/** Words in a variable name that suggest it's meant for a field; used to rank equal matches. */
const HINTS: Record<Field, RegExp> = {
  fill: /\b(bg|background|surface|fill|container)\b/i,
  'text-fill': /\b(text|fg|foreground|content|on)\b/i,
  stroke: /\b(border|stroke|outline|divider|line)\b/i,
  radius: /\b(radius|rounded|corner)\b/i,
  gap: /\b(space|spacing|gap)\b/i,
  padding: /\b(space|spacing|padding|inset)\b/i,
  'font-size': /\b(font|size|text|type)\b/i,
  'stroke-weight': /\b(border|stroke|width)\b/i,
};

export interface Candidate {
  id: string;
  name: string;
  collectionId: string;
  collection: string;
  /** "COLOR" or "FLOAT". */
  type: string;
  scopes: string[];
  hidden: boolean;
  /** True when the variable's own value is an alias (a semantic token over a primitive). */
  alias: boolean;
  /** Resolved value per modeId of its collection: "#rrggbb[aa]" or a number. */
  values: Record<string, string | number>;
  defaultModeId: string;
}

export type Raw = { kind: 'color'; hex: string; opacity: number } | { kind: 'number'; n: number };

export interface Finding {
  nodeId: string;
  nodeName: string;
  field: Field;
  /** Index into fills/strokes for paints. */
  index?: number;
  value: Raw;
  /** collectionId -> modeId in effect on this layer (Figma resolvedVariableModes). */
  modes: Record<string, string>;
}

export interface Suggestion {
  candidate: Candidate;
  /** 0 = exact. For colors, ΔE in OKLab ×100 (≈1 is barely visible); for numbers, the difference. */
  distance: number;
  /** For colors matched by including the paint's opacity: the paint opacity becomes 1. */
  absorbsOpacity?: boolean;
}

// ---------- color distance ----------

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab(hex: string): [number, number, number] {
  const n = (i: number) => lin(parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = [n(1), n(3), n(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const alphaOf = (hex: string) => (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1);

/** Perceptual distance between two colors (OKLab ΔE ×100), plus alpha difference. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a), [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100 + Math.abs(alphaOf(a) - alphaOf(b)) * 100;
}

const h2 = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
/** "#rrggbb" + opacity -> "#rrggbbaa" (or "#rrggbb" when opaque). */
export const withOpacity = (hex: string, opacity: number) => (opacity >= 0.999 ? hex.slice(0, 7) : hex.slice(0, 7) + h2(opacity));

// ---------- matching ----------

export interface MatchOptions {
  /** Largest color ΔE to suggest as a near match. Default 2 (subtle). 0 = exact only. */
  maxColorDistance?: number;
  /** Largest numeric difference to suggest. Default 0 (exact only). */
  maxNumberDistance?: number;
  /** Suggest variables hidden from publishing (usually primitives). Default false. */
  includeHidden?: boolean;
}

/** Best candidates first: exact before near, then scoped to this field, then semantic (alias) over primitive, then a name that fits the field. */
export function suggest(f: Pick<Finding, 'field' | 'value' | 'modes'>, candidates: Candidate[], opts: MatchOptions = {}): Suggestion[] {
  const maxC = opts.maxColorDistance ?? 2;
  const maxN = opts.maxNumberDistance ?? 0;
  const wantColor = f.value.kind === 'color';
  const out: (Suggestion & { rank: number[] })[] = [];
  for (const c of candidates) {
    if ((c.type === 'COLOR') !== wantColor) continue;
    if (c.hidden && !opts.includeHidden) continue;
    if (!c.scopes.some((s) => SCOPES[f.field].includes(s))) continue;
    const v = c.values[f.modes[c.collectionId] ?? c.defaultModeId] ?? c.values[c.defaultModeId];
    if (v === undefined) continue;
    let s: Suggestion | null = null;
    if (f.value.kind === 'color' && typeof v === 'string') {
      const opaque = alphaOf(v) >= 0.999;
      // Variable is opaque: bind it and keep the paint's own opacity.
      const d1 = opaque ? colorDistance(f.value.hex, v) : Infinity;
      // Variable carries alpha: compare with the paint's opacity folded in; binding then sets opacity to 1.
      const d2 = opaque ? Infinity : colorDistance(withOpacity(f.value.hex, f.value.opacity), v);
      const d = Math.min(d1, d2);
      if (d <= Math.max(maxC, 0.05)) s = { candidate: c, distance: d < 0.05 ? 0 : d, ...(d2 < d1 ? { absorbsOpacity: true } : {}) };
    } else if (f.value.kind === 'number' && typeof v === 'number') {
      const d = Math.abs(f.value.n - v);
      if (d <= Math.max(maxN, 0.01)) s = { candidate: c, distance: d < 0.01 ? 0 : d };
    }
    if (!s) continue;
    const scoped = c.scopes.includes('ALL_SCOPES') ? 1 : 0; // a variable scoped for exactly this use ranks first
    out.push({ ...s, rank: [s.distance, scoped, c.alias ? 0 : 1, HINTS[f.field].test(c.name.replace(/[/_-]/g, ' ')) ? 0 : 1, c.name.length] });
  }
  out.sort((a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return a.candidate.name.localeCompare(b.candidate.name); });
  return out.map(({ rank: _, ...s }) => s);
}

export interface Group {
  key: string;
  field: Field;
  value: Raw;
  findings: Finding[];
  suggestions: Suggestion[];
}

const valueKeyOf = (v: Raw) => (v.kind === 'color' ? withOpacity(v.hex, v.opacity) : `${Math.round(v.n * 100) / 100}`);
/** Field families that read the same in a report. */
const FAMILY: Record<Field, string> = { fill: 'fill', 'text-fill': 'text', stroke: 'stroke', radius: 'radius', gap: 'spacing', padding: 'spacing', 'font-size': 'font size', 'stroke-weight': 'stroke width' };
export const familyOf = (f: Field) => FAMILY[f];

/**
 * Groups findings that would get the same suggestions: same field family
 * (gap and padding are both spacing),
 * same value, same modes. Biggest groups first.
 */
export function group(findings: Finding[], candidates: Candidate[], opts: MatchOptions = {}): Group[] {
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const modes = Object.entries(f.modes).sort().map(([c, m]) => `${c}=${m}`).join(',');
    // Fields in one family (gap and padding) take the same tokens, so they share a row.
    const key = `${FAMILY[f.field]}|${valueKeyOf(f.value)}|${modes}`;
    let g = groups.get(key);
    if (!g) { g = { key, field: f.field, value: f.value, findings: [], suggestions: suggest(f, candidates, opts) }; groups.set(key, g); }
    g.findings.push(f);
  }
  // Merge groups that differ only by mode but get the same top suggestion, so one row covers them.
  const merged = new Map<string, Group>();
  for (const g of groups.values()) {
    const top = g.suggestions[0]?.candidate.id ?? 'none';
    const k = `${FAMILY[g.field]}|${valueKeyOf(g.value)}|${top}`;
    const m = merged.get(k);
    if (m) m.findings.push(...g.findings); else merged.set(k, { ...g, key: k });
  }
  return [...merged.values()].sort((a, b) => b.findings.length - a.findings.length || a.key.localeCompare(b.key));
}
