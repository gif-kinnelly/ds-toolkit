import type { Value } from './snapshot';

const h2 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');

/** Figma RGBA (0..1) -> "#rrggbb" or "#rrggbbaa". */
export function rgbaToHex(c: { r: number; g: number; b: number; a?: number }): string {
  const a = c.a === undefined ? 1 : c.a;
  return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}${a >= 0.999 ? '' : h2(a)}`;
}

/** "#abc", "#aabbcc", "#aabbccdd" -> normalized lowercase hex, or null. */
export function normalizeHex(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return null;
  if (s.length <= 5) s = '#' + [...s.slice(1)].map((ch) => ch + ch).join('');
  if (s.length === 9 && s.endsWith('ff')) s = s.slice(0, 7);
  return s;
}

export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const s = normalizeHex(hex);
  if (!s) throw new Error(`Bad color "${hex}"`);
  const c = (i: number) => parseInt(s.slice(i, i + 2), 16) / 255;
  return { r: c(1), g: c(3), b: c(5), a: s.length === 9 ? c(7) : 1 };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'color': return a.hex === (b as typeof a).hex;
    case 'number': return round(a.n) === round((b as typeof a).n);
    case 'string': return a.s === (b as typeof a).s;
    case 'boolean': return a.b === (b as typeof a).b;
    case 'alias': return a.name === (b as typeof a).name;
  }
}

export function formatValue(v: Value | undefined): string {
  if (!v) return '—';
  switch (v.kind) {
    case 'color': return v.hex;
    case 'number': return String(round(v.n));
    case 'string': return JSON.stringify(v.s);
    case 'boolean': return String(v.b);
    case 'alias': return `{${v.name}}`;
  }
}

/** Follows aliases to a literal. Returns undefined on a missing target or a cycle. */
export function resolveValue(
  v: Value | undefined,
  lookup: (name: string) => Value | undefined,
  seen = new Set<string>(),
): Value | undefined {
  if (!v || v.kind !== 'alias') return v;
  if (seen.has(v.name)) return undefined;
  seen.add(v.name);
  return resolveValue(lookup(v.name), lookup, seen);
}
