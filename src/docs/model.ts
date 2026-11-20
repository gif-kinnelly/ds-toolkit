/**
 * A component's documentation, read from the component itself: what you can
 * set (properties, variant options), what it's made of (the tokens each layer
 * uses) and how much it's used. Pure; rendered to Markdown here and to a
 * Figma frame by the plugin.
 */

export interface DocProperty { name: string; type: string; default?: string; options?: string[]; description?: string }
export interface DocToken { variable: string; collection?: string; uses: { layer: string; field: string }[] }
export interface DocStyle { style: string; kind: 'text' | 'effect' | 'paint'; layers: string[] }

export interface DocModel {
  id: string;
  name: string;
  description: string;
  /** Variant axes with their options, in Figma's order. */
  axes: { name: string; options: string[]; default?: string }[];
  properties: DocProperty[];
  variants: number;
  tokens: DocToken[];
  styles: DocStyle[];
  /** Layers with raw values instead of tokens, for the "not tokenized" note. */
  raw: { layer: string; field: string; value: string }[];
  instances?: number;
  page?: string;
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s: string) => `\`${s.replace(/`/g, '')}\``;

/** Field names people recognize. */
export const FIELD: Record<string, string> = {
  fill: 'fill', stroke: 'stroke', itemSpacing: 'gap', paddingLeft: 'padding', paddingRight: 'padding', paddingTop: 'padding', paddingBottom: 'padding',
  topLeftRadius: 'radius', topRightRadius: 'radius', bottomLeftRadius: 'radius', bottomRightRadius: 'radius', fontSize: 'font size',
  strokeWeight: 'stroke width', opacity: 'opacity', width: 'width', height: 'height', minWidth: 'min width', maxWidth: 'max width',
  characters: 'text', visible: 'visibility', lineHeight: 'line height', letterSpacing: 'letter spacing', fontFamily: 'font family', fontWeight: 'font weight',
};

/** One line per variable: where it's used, with repeated fields collapsed ("padding" not four times). */
export function tokenUses(t: DocToken): string {
  const byLayer = new Map<string, Set<string>>();
  for (const u of t.uses) byLayer.set(u.layer, (byLayer.get(u.layer) ?? new Set()).add(FIELD[u.field] ?? u.field));
  return [...byLayer.entries()].map(([l, f]) => `${l || 'root'} (${[...f].join(', ')})`).join('; ');
}

export function toMarkdown(docs: DocModel[], opts: { title?: string } = {}): string {
  const out: string[] = [`# ${opts.title ?? 'Components'}`, '', '_Generated from the Figma components. Edit the components, not this file._', ''];
  for (const d of docs) {
    out.push(`## ${d.name}`, '');
    if (d.description) out.push(d.description, '');
    const facts = [`${d.variants} variant${d.variants === 1 ? '' : 's'}`];
    if (d.instances !== undefined) facts.push(`${d.instances} instance${d.instances === 1 ? '' : 's'} in this file`);
    if (d.page) facts.push(`on page "${d.page}"`);
    out.push(facts.join(' · '), '');
    if (d.axes.length || d.properties.length) {
      out.push('| Property | Type | Options / default |', '|---|---|---|');
      for (const a of d.axes) out.push(`| ${esc(a.name)} | variant | ${a.options.map((o) => (o === a.default ? `**${code(o)}**` : code(o))).join(' ')} |`);
      for (const p of d.properties) out.push(`| ${esc(p.name)} | ${p.type.toLowerCase().replace('_', ' ')} | ${p.default !== undefined && p.default !== '' ? code(p.default) : ''}${p.description ? ` ${esc(p.description)}` : ''} |`);
      out.push('');
    }
    if (d.tokens.length) {
      out.push('**Tokens**', '');
      for (const t of d.tokens) out.push(`- ${code(t.variable)}${t.collection ? ` _(${t.collection})_` : ''}: ${esc(tokenUses(t))}`);
      out.push('');
    }
    if (d.styles.length) {
      out.push('**Styles**', '');
      for (const s of d.styles) out.push(`- ${s.kind} style ${code(s.style)}: ${esc([...new Set(s.layers)].join(', '))}`);
      out.push('');
    }
    if (d.raw.length) {
      const fields = [...new Set(d.raw.map((r) => `${r.layer || 'root'} ${FIELD[r.field] ?? r.field}`))];
      out.push(`> ⚠️ Not tokenized: ${esc(fields.slice(0, 8).join(', '))}${fields.length > 8 ? ` and ${fields.length - 8} more` : ''}.`, '');
    }
  }
  return out.join('\n');
}
