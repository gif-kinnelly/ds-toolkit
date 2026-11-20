/**
 * Draws a DocModel as a frame next to its component. The frame is generated:
 * it's found again by plugin data and rebuilt on every run, so it can't drift
 * from the component.
 */
import { FIELD, tokenUses, type DocModel } from './model';

export const DOC_KEY = 'ds_doc_for';
const WIDTH = 560;
const INK = { r: 0.12, g: 0.12, b: 0.13 };
const MUTED = { r: 0.42, g: 0.42, b: 0.45 };
const LINE = { r: 0.9, g: 0.9, b: 0.92 };
const WARN = { r: 0.6, g: 0.38, b: 0 };
const FONTS = { regular: { family: 'Inter', style: 'Regular' }, semibold: { family: 'Inter', style: 'Semi Bold' }, bold: { family: 'Inter', style: 'Bold' } };

export async function loadDocFonts() {
  for (const f of Object.values(FONTS)) await figma.loadFontAsync(f);
}

function text(parent: FrameNode, chars: string, o: { size?: number; weight?: keyof typeof FONTS; color?: RGB; width?: number | 'fill'; name?: string } = {}) {
  const t = figma.createText();
  t.fontName = FONTS[o.weight ?? 'regular'];
  t.fontSize = o.size ?? 13;
  t.characters = chars;
  t.fills = [{ type: 'SOLID', color: o.color ?? INK }];
  t.name = o.name ?? chars.slice(0, 40);
  parent.appendChild(t);
  if (o.width === 'fill') { t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT'; }
  else if (typeof o.width === 'number') { t.resize(o.width, t.height || 16); t.textAutoResize = 'HEIGHT'; }
  return t;
}

function stack(parent: FrameNode | null, name: string, dir: 'VERTICAL' | 'HORIZONTAL', gap: number) {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir;
  f.itemSpacing = gap;
  f.fills = [];
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = dir === 'VERTICAL' ? 'FIXED' : 'AUTO';
  if (parent) { parent.appendChild(f); f.layoutSizingHorizontal = 'FILL'; }
  return f;
}

function section(root: FrameNode, title: string) {
  const s = stack(root, title, 'VERTICAL', 6);
  text(s, title, { size: 11, weight: 'semibold', color: MUTED, name: `${title} heading` });
  return s;
}

type Cell = [text: string, width: number | 'fill', weight?: keyof typeof FONTS];
function row(parent: FrameNode, cells: Cell[]) {
  const r = stack(parent, 'Row', 'HORIZONTAL', 12);
  r.paddingTop = r.paddingBottom = 6;
  r.strokes = [{ type: 'SOLID', color: LINE }];
  r.strokeTopWeight = 0; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 1;
  for (const [chars, width, weight] of cells) text(r, chars || '—', { size: 12, width, weight, color: chars ? INK : MUTED });
  return r;
}

/** Creates or rebuilds the doc frame for a component; returns it. */
export async function renderDoc(doc: DocModel, component: SceneNode): Promise<FrameNode> {
  const parent = component.parent as (BaseNode & ChildrenMixin) | null;
  const holder = (parent && parent.type === 'PAGE' ? parent : figma.currentPage) as PageNode;
  let root = holder.children.find((n) => n.type === 'FRAME' && n.getPluginData(DOC_KEY) === component.id) as FrameNode | undefined;
  if (root) for (const c of [...root.children]) c.remove();
  else {
    root = stack(null, `Docs · ${doc.name}`, 'VERTICAL', 20);
    holder.appendChild(root);
    root.x = component.x + component.width + 80;
    root.y = component.y;
    root.setPluginData(DOC_KEY, component.id);
  }
  root.name = `Docs · ${doc.name}`;
  root.resize(WIDTH, Math.max(root.height, 100));
  root.paddingTop = root.paddingBottom = root.paddingLeft = root.paddingRight = 32;
  root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  root.cornerRadius = 12;
  root.strokes = [{ type: 'SOLID', color: LINE }];

  const head = stack(root, 'Header', 'VERTICAL', 6);
  text(head, doc.name, { size: 24, weight: 'bold', width: 'fill', name: 'Title' });
  const facts = [`${doc.variants} variant${doc.variants === 1 ? '' : 's'}`];
  if (doc.instances !== undefined) facts.push(`${doc.instances} instance${doc.instances === 1 ? '' : 's'} in this file`);
  text(head, facts.join(' · '), { size: 12, color: MUTED, width: 'fill', name: 'Facts' });
  text(head, doc.description || 'No description. Add one to the component and regenerate.', { size: 14, color: doc.description ? INK : MUTED, width: 'fill', name: 'Description' });

  if (doc.axes.length || doc.properties.length) {
    const s = section(root, 'PROPERTIES');
    row(s, [['Name', 140, 'semibold'], ['Type', 90, 'semibold'], ['Options / default', 'fill', 'semibold']]);
    for (const a of doc.axes) row(s, [[a.name, 140], ['variant', 90], [a.options.map((o) => (o === a.default ? `${o} (default)` : o)).join(' · '), 'fill']]);
    for (const p of doc.properties) row(s, [[p.name, 140], [p.type.toLowerCase().replace('_', ' '), 90], [p.default ?? '', 'fill']]);
  }
  if (doc.tokens.length) {
    const s = section(root, 'TOKENS');
    for (const t of doc.tokens) row(s, [[t.variable, 200, 'semibold'], [tokenUses(t), 'fill']]);
  }
  if (doc.styles.length) {
    const s = section(root, 'STYLES');
    for (const st of doc.styles) row(s, [[st.style, 200, 'semibold'], [`${st.kind} · ${[...new Set(st.layers)].join(', ')}`, 'fill']]);
  }
  if (doc.raw.length) {
    const fields = [...new Set(doc.raw.map((r) => `${r.layer || 'root'} ${FIELD[r.field] ?? r.field}`))];
    text(root, `Not tokenized: ${fields.slice(0, 8).join(', ')}${fields.length > 8 ? ` and ${fields.length - 8} more` : ''}.`, { size: 12, color: WARN, width: 'fill', name: 'Not tokenized' });
  }
  text(root, 'Generated from the component by Component Docs. Edit the component, then regenerate.', { size: 11, color: MUTED, width: 'fill', name: 'Footer' });
  return root;
}
