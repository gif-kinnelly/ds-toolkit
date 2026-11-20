/**
 * W3C Design Tokens (DTCG) -> snapshot. Covers:
 * - Figma's native "Export variables" output: one file per mode, Figma data in
 *   $extensions under "com.figma.*" keys or a nested "com.figma" object;
 * - hand-written DTCG (2025.10 color/dimension objects, or plain "#hex" / "16px" strings);
 * - single files that keep modes in $extensions.mode / $extensions.modes (TokensBrücke style).
 *
 * Tokens become variables named with "/" ("color.brand.500" -> "color/brand/500").
 * Typography and shadow tokens become text and effect styles.
 */
import type { Collection, Snapshot, Style, Value, Variable, VariableType } from '../core/snapshot';
import { normalizeHex, rgbaToHex } from '../core/values';

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);

export interface DtcgFile {
  /** File path or name; "Colors/Light.tokens.json" gives collection "Colors", mode "Light". */
  path: string;
  json: unknown;
}

export interface DtcgOptions {
  /** Collection name for files not in a folder. Default "Tokens". */
  collection?: string;
  /** Root font size for rem conversion. Default 16. */
  remPx?: number;
}

/** "Colors/Light Mode.tokens.json" -> { collection: "Colors", mode: "Light Mode" } */
export function nameFromPath(path: string, fallbackCollection: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const file = parts.pop() || 'tokens.json';
  const mode = file.replace(/\.json$/i, '').replace(/\.tokens$/i, '');
  return { collection: parts.length ? parts[parts.length - 1] : fallbackCollection, mode };
}

interface Raw { name: string; type?: string; value: unknown; ext: Json; description?: string }

/** Walks the token tree, inheriting $type from groups. */
function walk(node: unknown, path: string[], inherited: string | undefined, out: Raw[]) {
  if (!isObj(node)) return;
  const type = typeof node.$type === 'string' ? node.$type : inherited;
  if ('$value' in node) {
    out.push({ name: path.join('/'), type, value: node.$value, ext: isObj(node.$extensions) ? node.$extensions : {}, description: typeof node.$description === 'string' ? node.$description : undefined });
    return;
  }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, [...path, k], type, out);
}

/** Reads "com.figma.x" from either the flat or the nested $extensions shape. */
function figmaExt(ext: Json, key: string): unknown {
  if (`com.figma.${key}` in ext) return ext[`com.figma.${key}`];
  const nested = ext['com.figma'];
  return isObj(nested) ? nested[key] : undefined;
}

const ALIAS = /^\{([^{}]+)\}$/;
const aliasName = (s: string) => s.replace(/\./g, '/');

function parseColor(v: unknown): string | null {
  if (typeof v === 'string') return normalizeHex(v);
  if (isObj(v)) {
    const alpha = typeof v.alpha === 'number' ? v.alpha : 1;
    if (typeof v.hex === 'string') {
      const hex = normalizeHex(v.hex);
      return hex && alpha < 0.999 ? rgbaToHex({ ...hexRgb(hex), a: alpha }) : hex;
    }
    const c = v.components;
    if (Array.isArray(c) && c.length >= 3 && (v.colorSpace === undefined || v.colorSpace === 'srgb')) {
      return rgbaToHex({ r: Number(c[0]), g: Number(c[1]), b: Number(c[2]), a: alpha });
    }
  }
  return null;
}
function hexRgb(hex: string) {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: c(1), g: c(3), b: c(5) };
}

function parseNumber(v: unknown, remPx: number): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(-?[\d.]+)\s*(px|rem|em|ms|s|%)?$/.exec(v.trim());
    if (!m) return null;
    const n = parseFloat(m[1]);
    return m[2] === 'rem' || m[2] === 'em' ? n * remPx : m[2] === 's' ? n * 1000 : n;
  }
  if (isObj(v) && typeof v.value === 'number') {
    return v.unit === 'rem' || v.unit === 'em' ? v.value * remPx : v.unit === 's' ? v.value * 1000 : v.value;
  }
  return null;
}

const NUMERIC = new Set(['dimension', 'number', 'fontWeight', 'duration', 'float']);
const COMPOSITE = new Set(['typography', 'shadow']);

function variableType(raw: Raw): VariableType | null {
  const figmaType = figmaExt(raw.ext, 'type');
  if (figmaType === 'boolean' || figmaType === 'BOOLEAN') return 'BOOLEAN';
  if (figmaType === 'string' || figmaType === 'STRING') return 'STRING';
  const t = raw.type;
  if (t === 'color') return 'COLOR';
  if (t && NUMERIC.has(t)) return 'FLOAT';
  if (t === 'fontFamily' || t === 'string') return 'STRING';
  if (t === 'boolean') return 'BOOLEAN';
  if (t && COMPOSITE.has(t)) return null;
  // Untyped: infer from the value.
  if (typeof raw.value === 'boolean') return 'BOOLEAN';
  if (typeof raw.value === 'number') return 'FLOAT';
  if (typeof raw.value === 'string' && normalizeHex(raw.value)) return 'COLOR';
  if (typeof raw.value === 'string' && ALIAS.test(raw.value)) return undefined as unknown as VariableType; // resolved later
  if (typeof raw.value === 'string') return parseNumber(raw.value, 16) !== null ? 'FLOAT' : 'STRING';
  return null;
}

function toValue(v: unknown, type: VariableType | undefined, remPx: number): Value | null {
  if (typeof v === 'string') {
    const m = ALIAS.exec(v);
    if (m) return { kind: 'alias', name: aliasName(m[1]) };
  }
  switch (type) {
    case 'COLOR': { const hex = parseColor(v); return hex ? { kind: 'color', hex } : null; }
    case 'FLOAT': { const n = parseNumber(v, remPx); return n === null ? null : { kind: 'number', n }; }
    case 'BOOLEAN': return typeof v === 'boolean' ? { kind: 'boolean', b: v } : v === 'true' || v === 'false' ? { kind: 'boolean', b: v === 'true' } : null;
    case 'STRING': return { kind: 'string', s: Array.isArray(v) ? String(v[0]) : String(v) };
    default: return null;
  }
}

/** Per-mode values kept inside one file ($extensions.mode / .modes). */
function inlineModes(ext: Json): Json | null {
  for (const k of ['mode', 'modes']) if (isObj(ext[k])) return ext[k] as Json;
  return null;
}

const ref = (v: unknown) => (typeof v === 'string' && ALIAS.test(v) ? `var:${aliasName(ALIAS.exec(v)![1])}` : undefined);

function styleFrom(raw: Raw, remPx: number): Style | null {
  const v = raw.value;
  if (raw.type === 'typography' && isObj(v)) {
    const props: Record<string, string | number> = {};
    const fam = v.fontFamily;
    props.fontFamily = ref(fam) ?? (Array.isArray(fam) ? String(fam[0]) : String(fam));
    if (v.fontWeight !== undefined) props.fontWeight = ref(v.fontWeight) ?? weightNumber(v.fontWeight);
    if (v.fontSize !== undefined) props.fontSize = ref(v.fontSize) ?? parseNumber(v.fontSize, remPx) ?? String(v.fontSize);
    if (v.lineHeight !== undefined) {
      const lh = v.lineHeight;
      // DTCG lineHeight is a unitless multiple of the font size; px values are kept as px.
      props.lineHeight = ref(lh) ?? (typeof lh === 'number' ? `${Math.round(lh * 1000) / 10}%` : parseNumber(lh, remPx) ?? String(lh));
    }
    if (v.letterSpacing !== undefined) props.letterSpacing = ref(v.letterSpacing) ?? parseNumber(v.letterSpacing, remPx) ?? String(v.letterSpacing);
    return { name: raw.name, kind: 'text', props };
  }
  if (raw.type === 'shadow') {
    const list = Array.isArray(v) ? v : [v];
    const props: Record<string, string | number> = {};
    list.forEach((s, i) => {
      if (!isObj(s)) return;
      props[`shadow${i}.color`] = ref(s.color) ?? parseColor(s.color) ?? String(s.color);
      props[`shadow${i}.x`] = parseNumber(s.offsetX, remPx) ?? 0;
      props[`shadow${i}.y`] = parseNumber(s.offsetY, remPx) ?? 0;
      props[`shadow${i}.blur`] = parseNumber(s.blur, remPx) ?? 0;
      props[`shadow${i}.spread`] = parseNumber(s.spread, remPx) ?? 0;
    });
    return { name: raw.name, kind: 'effect', props };
  }
  return null;
}

const WEIGHTS: Record<string, number> = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
export function weightNumber(w: unknown): number | string {
  if (typeof w === 'number') return w;
  const k = String(w).toLowerCase().replace(/[\s_-]/g, '');
  return WEIGHTS[k] ?? String(w);
}

export function fromDtcg(files: DtcgFile[], opts: DtcgOptions = {}): Snapshot {
  const remPx = opts.remPx ?? 16;
  const fallback = opts.collection ?? 'Tokens';
  const collections = new Map<string, Collection>();
  const vars = new Map<string, Map<string, Variable>>();
  const styles = new Map<string, Style>();
  const warnings: string[] = [];

  for (const f of files) {
    const { collection, mode } = nameFromPath(f.path, fallback);
    const raws: Raw[] = [];
    walk(f.json, [], undefined, raws);
    let c = collections.get(collection);
    if (!c) { c = { name: collection, modes: [], variables: [] }; collections.set(collection, c); vars.set(collection, new Map()); }
    const byName = vars.get(collection)!;
    // In a file that keeps modes inline, a token with one plain value applies to every mode.
    const fileModes = [...new Set(raws.flatMap((r) => Object.keys(inlineModes(r.ext) ?? {})))];

    for (const raw of raws) {
      const style = styleFrom(raw, remPx);
      if (style) { styles.set(`${style.kind}:${style.name}`, style); continue; }
      const type = variableType(raw);
      if (type === null) { warnings.push(`${raw.name}: unsupported type "${raw.type}"`); continue; }
      let v = byName.get(raw.name);
      if (!v) {
        v = { name: raw.name, type, values: {} };
        if (raw.description) v.description = raw.description;
        const hidden = figmaExt(raw.ext, 'hiddenFromPublishing');
        if (hidden === true) v.hidden = true;
        byName.set(raw.name, v);
        c.variables.push(v);
      }
      const inline = inlineModes(raw.ext);
      const entries: [string, unknown][] = inline
        ? Object.entries(inline)
        : fileModes.length ? fileModes.map((m) => [m, raw.value]) : [[mode, raw.value]];
      for (const [m, val] of entries) {
        if (!c.modes.includes(m)) c.modes.push(m);
        const value = toValue(val, v.type, remPx);
        if (value) v.values[m] = value;
        else warnings.push(`${raw.name} (${m}): can't read value ${JSON.stringify(val)}`);
      }
    }
  }

  // Aliases with no $type take the type of what they point at.
  const all = new Map<string, Variable>();
  for (const m of vars.values()) for (const [n, v] of m) all.set(n, v);
  const typeOf = (v: Variable, seen = new Set<string>()): VariableType | undefined => {
    if (v.type) return v.type;
    const a = Object.values(v.values).find((x) => x.kind === 'alias');
    if (!a || a.kind !== 'alias' || seen.has(v.name)) return undefined;
    seen.add(v.name);
    const t = all.get(a.name);
    return t ? typeOf(t, seen) : undefined;
  };
  for (const v of all.values()) if (!v.type) v.type = typeOf(v) ?? 'COLOR';

  return {
    source: files.map((f) => f.path).join(', ') || 'DTCG',
    collections: [...collections.values()], styles: [...styles.values()], components: [],
    ...(warnings.length ? { warnings } : {}),
  };
}
