/**
 * Design system context for coding agents (CLAUDE.md, AGENTS.md, an MCP
 * resource): the rules, tokens and components, written so a model generates
 * UI that stays on the system. Built from a snapshot (any source) and,
 * optionally, component docs read from Figma.
 */
import type { Collection, Component, Snapshot, Variable } from '../core/snapshot';
import type { DocModel } from '../docs/model';
import { formatValue, resolveValue } from '../core/values';

/** Figma scopes → what a person would call that use. */
const USE: Record<string, string> = {
  ALL_FILLS: 'fills', FRAME_FILL: 'backgrounds', SHAPE_FILL: 'shape fills', TEXT_FILL: 'text color', STROKE_COLOR: 'borders',
  EFFECT_COLOR: 'shadows', CORNER_RADIUS: 'corner radius', GAP: 'spacing (gap, padding)', WIDTH_HEIGHT: 'width/height',
  FONT_SIZE: 'font size', LINE_HEIGHT: 'line height', LETTER_SPACING: 'letter spacing', FONT_FAMILY: 'font family',
  FONT_WEIGHT: 'font weight', OPACITY: 'opacity', STROKE_FLOAT: 'border width', EFFECT_FLOAT: 'shadow size', TEXT_CONTENT: 'text content',
};
/** Without scopes, guess the use from the name; good names make this reliable. */
const NAME_USES: [RegExp, string][] = [
  [/(^|\/)(text|fg|foreground|on-|content)|-(text|fg)$/i, 'text color'], [/(border|stroke|outline|divider)/i, 'borders'],
  [/(surface|background|bg|canvas|container)|-bg$/i, 'backgrounds'], [/(shadow|elevation)/i, 'shadows'], [/focus|ring/i, 'focus rings'],
  [/^(space|spacing|gap|padding|inset)/i, 'spacing (gap, padding)'], [/^(radius|rounded|corner)/i, 'corner radius'],
  [/^(font-size|text-size|size\/text)/i, 'font size'], [/^(line-height|leading)/i, 'line height'], [/^(font-weight)/i, 'font weight'],
];
export function usesOf(v: Variable): string[] {
  if (v.scopes?.length) return [...new Set(v.scopes.map((s) => USE[s] ?? s.toLowerCase()))];
  const hit = NAME_USES.find(([re]) => re.test(v.name));
  if (hit) return [hit[1]];
  return v.type === 'COLOR' && /^colou?r\//i.test(v.name) ? ['fills, accents'] : [];
}

export interface ManifestOptions {
  title?: string;
  /** Rows per token table before summarizing. Default 80. */
  maxTokens?: number;
}

export interface ManifestJson {
  name: string;
  rules: string[];
  collections: { name: string; modes: string[]; role: 'semantic' | 'primitive' | 'mixed'; tokens: { name: string; type: string; use: string[]; values: Record<string, string>; description?: string; hidden?: boolean }[] }[];
  styles: { name: string; kind: string; props: Record<string, string | number> }[];
  components: { name: string; description?: string; variants: Record<string, string[]>; properties: Record<string, { type: string; default?: string | boolean }>; tokens?: string[] }[];
}

/**
 * A collection is semantic when most of its values alias other variables, and
 * primitive when it's mostly hidden or named like one. A collection whose
 * tokens are mostly the targets of other collections' aliases is an
 * internal tier (e.g. Brand between palette and Theme): not for direct use.
 */
function role(c: Collection, referenced: Set<string>): 'semantic' | 'primitive' | 'mixed' {
  const values = c.variables.flatMap((v) => Object.values(v.values));
  if (!values.length) return 'mixed';
  if (c.variables.filter((v) => referenced.has(v.name)).length / c.variables.length >= 0.5) return 'primitive';
  const aliased = values.filter((x) => x.kind === 'alias').length / values.length;
  const hidden = c.variables.filter((v) => v.hidden).length / c.variables.length;
  if (aliased >= 0.5) return 'semantic';
  if (hidden >= 0.5 || /primitive|palette|core|base/i.test(c.name)) return 'primitive';
  return 'mixed';
}

/** Splits names on the first segment: "color/text/muted" → "color". */
const group = (name: string) => name.split('/')[0];

export function buildManifest(snap: Snapshot, docs: DocModel[] = [], opts: ManifestOptions = {}): { json: ManifestJson; markdown: string } {
  const byName = new Map<string, { v: Variable; c: Collection }>();
  for (const c of snap.collections) for (const v of c.variables) byName.set(v.name, { v, c });
  const resolve = (v: Variable, mode: string) => {
    let m = mode;
    return resolveValue(v.values[mode], (n) => { const hit = byName.get(n); if (!hit) return undefined; if (!hit.c.modes.includes(m)) m = hit.c.modes[0]; return hit.v.values[m]; });
  };
  const show = (v: Variable, mode: string) => {
    const raw = v.values[mode];
    if (!raw) return '';
    const r = resolve(v, mode);
    return raw.kind === 'alias' ? `${formatValue(raw)}${r ? ` = ${formatValue(r)}` : ''}` : formatValue(raw);
  };

  // Names aliased from a different collection: lower tiers.
  const referenced = new Set<string>();
  for (const c of snap.collections) for (const v of c.variables) for (const val of Object.values(v.values)) {
    if (val.kind === 'alias' && byName.get(val.name)?.c !== c) referenced.add(val.name);
  }
  const cols = snap.collections.map((c) => ({ c, role: role(c, referenced) }));
  const semantic = cols.filter((x) => x.role === 'semantic');
  const primitive = cols.filter((x) => x.role === 'primitive');

  // ---- rules, derived from the data ----
  const rules: string[] = [];
  rules.push('Never hardcode colors, spacing, radii or font sizes. Use the tokens below; if none fits, say so instead of inventing a value.');
  if (semantic.length && primitive.length) {
    const lower = [...new Set(primitive.flatMap((x) => x.c.variables.map((v) => v.name.split('/').slice(0, group(v.name) === 'brand' ? 2 : 1).join('/'))))];
    rules.push(`Use semantic tokens (${semantic.map((x) => `"${x.c.name}"`).join(', ')}). ${primitive.map((x) => `"${x.c.name}"`).join(' and ')} ${primitive.length > 1 ? 'are lower tiers' : 'is a lower tier'} that semantic tokens point to: don't use ${lower.map((g) => `\`${g}/*\``).join(', ')} directly.`);
  }
  const hidden = snap.collections.flatMap((c) => c.variables.filter((v) => v.hidden));
  if (hidden.length && !(semantic.length && primitive.length)) rules.push(`${hidden.length} tokens are hidden from publishing (primitives); don't use them directly.`);
  const scoped = snap.collections.flatMap((c) => c.variables).filter((v) => v.scopes?.length);
  if (scoped.length) rules.push('Each token lists what it\'s for ("use for"). Only use a token for that: a text-color token is for text, not backgrounds.');
  for (const { c, role: r } of cols) {
    if (c.modes.length < 2) continue;
    const modes = c.modes.map((m) => `"${m}"`).join(', ');
    rules.push(r === 'primitive'
      ? `"${c.name}" switches with modes ${modes}: set the mode on a container; the tokens you use stay the same.`
      : `"${c.name}" has modes ${modes}: reference the token, never the value of one mode, so switching mode works.`);
  }
  if (snap.styles.some((s) => s.kind === 'text')) rules.push('Set text with the text styles below rather than font size and weight one by one.');
  if (snap.components.length || docs.length) rules.push('Build UI from the components below before composing from scratch. Respect each component\'s variants and properties; don\'t restyle it with overrides.');

  // ---- json ----
  const max = opts.maxTokens ?? 80;
  const json: ManifestJson = {
    name: opts.title ?? snap.source,
    rules,
    collections: cols.map(({ c, role: r }) => ({
      name: c.name, modes: c.modes, role: r,
      tokens: c.variables.map((v) => ({
        name: v.name, type: v.type, use: usesOf(v),
        values: Object.fromEntries(c.modes.map((m) => [m, show(v, m)]).filter(([, x]) => x)),
        ...(v.description ? { description: v.description } : {}), ...(v.hidden ? { hidden: true } : {}),
      })),
    })),
    styles: snap.styles.map((s) => ({ name: s.name, kind: s.kind, props: s.props })),
    components: mergeComponents(snap.components, docs),
  };

  // ---- markdown ----
  const md: string[] = [`# ${json.name}: design system`, '', '_Generated. Regenerate it instead of editing._', '', '## Rules', '', ...rules.map((r) => `- ${r}`), ''];
  const ordered = [...json.collections].sort((a, b) => (a.role === 'semantic' ? -1 : b.role === 'semantic' ? 1 : 0));
  for (const c of ordered) {
    md.push(`## Tokens: ${c.name}${c.role === 'primitive' ? ' (lower tier: don\'t use directly)' : ''}`, '');
    if (c.role === 'primitive') {
      if (c.modes.length > 1) md.push(`Modes: ${c.modes.join(', ')} (set on a parent frame, not per token).`, '');
      // Primitives are summarized: the agent needs to recognize them, not pick from them.
      const groups = new Map<string, number>();
      for (const t of c.tokens) groups.set(t.name.split('/').slice(0, 2).join('/'), (groups.get(t.name.split('/').slice(0, 2).join('/')) ?? 0) + 1);
      md.push([...groups.entries()].map(([g, n]) => `\`${g}\` (${n})`).join(', '), '');
      continue;
    }
    const multi = c.modes.length > 1;
    md.push(`| Token | Use for | ${multi ? c.modes.join(' | ') : 'Value'} |`, `|---|---|${c.modes.map(() => '---').join('|')}|`);
    for (const t of c.tokens.slice(0, max)) {
      md.push(`| \`${t.name}\` | ${t.use.join(', ') || (t.description ?? '')} | ${c.modes.map((m) => (t.values[m] ? `\`${t.values[m]}\`` : '')).join(' | ')} |`);
    }
    if (c.tokens.length > max) md.push(`| …${c.tokens.length - max} more in design-system.json | | ${c.modes.map(() => '').join(' | ')} |`);
    md.push('');
  }
  const textStyles = json.styles.filter((s) => s.kind === 'text');
  if (textStyles.length) {
    md.push('## Text styles', '', '| Style | Font | Size / line height |', '|---|---|---|');
    for (const s of textStyles) md.push(`| \`${s.name}\` | ${s.props.fontFamily} ${s.props.fontWeight ?? ''} | ${s.props.fontSize} / ${s.props.lineHeight ?? ''} |`);
    md.push('');
  }
  if (json.components.length) {
    md.push('## Components', '');
    for (const c of json.components) {
      md.push(`### ${c.name}`, '');
      if (c.description) md.push(c.description, '');
      const props = [
        ...Object.entries(c.variants).map(([k, o]) => `\`${k}\`: ${o.map((x) => `\`${x}\``).join(' | ')}`),
        ...Object.entries(c.properties).map(([k, p]) => `\`${k}\` (${p.type.toLowerCase()}${p.default !== undefined && p.default !== '' ? `, default \`${p.default}\`` : ''})`),
      ];
      if (props.length) md.push(...props.map((p) => `- ${p}`), '');
      if (c.tokens?.length) md.push(`Uses ${c.tokens.map((t) => `\`${t}\``).join(', ')}.`, '');
    }
  }
  return { json, markdown: md.join('\n') };
}

/** Components from a snapshot (spec or Figma), enriched with docs when available. */
function mergeComponents(comps: Component[], docs: DocModel[]): ManifestJson['components'] {
  const out = new Map<string, ManifestJson['components'][number]>();
  for (const c of comps) {
    const variants: Record<string, string[]> = {};
    for (const v of c.variants) for (const part of v.name.split(',')) {
      const [k, val] = part.split('=').map((x) => x.trim());
      if (k && val) variants[k] = [...new Set([...(variants[k] ?? []), val])];
    }
    out.set(c.name, { name: c.name, ...(c.description ? { description: c.description } : {}), variants, properties: Object.fromEntries(Object.entries(c.properties).map(([k, p]) => [k, { type: p.type, ...(p.default !== undefined ? { default: p.default } : {}) }])) });
  }
  for (const d of docs) {
    out.set(d.name, {
      name: d.name, ...(d.description ? { description: d.description } : {}),
      variants: Object.fromEntries(d.axes.map((a) => [a.name, a.options])),
      properties: Object.fromEntries(d.properties.map((p) => [p.name, { type: p.type, ...(p.default !== undefined ? { default: p.default } : {}) }])),
      tokens: d.tokens.map((t) => t.variable),
    });
  }
  return [...out.values()];
}
