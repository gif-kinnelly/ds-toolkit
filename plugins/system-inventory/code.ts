// System Inventory — main thread. Counts the raw values in use, proposes a
// token set, and can create it as variables and text styles.
import { clusterColors, fontSizeScale, radiusScale, spacingScale, toDtcg, typeStyles, type Proposal } from '../../src/inventory/cluster';
import { collect } from '../../src/inventory/collect';
import { hexToRgba } from '../../src/core/values';

figma.showUI(__html__, { width: 520, height: 760, themeColors: true });

type Msg =
  | { type: 'scan'; scope: 'selection' | 'page' | 'file'; merge: number; grid: number; includeTokenized: boolean }
  | { type: 'create'; collection: string };

let proposal: Proposal | null = null;

async function roots(scope: string): Promise<readonly SceneNode[]> {
  if (scope === 'selection') {
    if (!figma.currentPage.selection.length) throw new Error('Select some frames first, or scan the page.');
    return figma.currentPage.selection;
  }
  if (scope === 'page') return figma.currentPage.children;
  await figma.loadAllPagesAsync();
  return figma.root.children.flatMap((p) => [...p.children]);
}

const STYLE: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

async function create(name: string) {
  if (!proposal) throw new Error('Scan first.');
  const existing = await figma.variables.getLocalVariableCollectionsAsync();
  if (existing.some((c) => c.name === name)) throw new Error(`A collection named "${name}" already exists. Pick another name.`);
  const col = figma.variables.createVariableCollection(name);
  const mode = col.modes[0].modeId;
  col.renameMode(mode, 'Value');
  const made = new Map<string, Variable>();
  const add = (n: string, type: 'COLOR' | 'FLOAT', value: VariableValue, scopes: VariableScope[]) => {
    const v = figma.variables.createVariable(n, col, type);
    v.setValueForMode(mode, value);
    v.scopes = scopes;
    made.set(n, v);
  };
  for (const c of proposal.colors) add(c.name, 'COLOR', hexToRgba(c.hex), ['ALL_SCOPES']);
  for (const s of proposal.spacing.filter((x) => !x.offGrid)) add(s.name, 'FLOAT', s.value, ['GAP']);
  for (const r of proposal.radii) add(r.name, 'FLOAT', r.value, ['CORNER_RADIUS']);
  for (const f of proposal.fontSizes) add(f.name, 'FLOAT', f.value, ['FONT_SIZE']);

  const existingStyles = new Set((await figma.getLocalTextStylesAsync()).map((s) => s.name));
  let styles = 0;
  const skipped: string[] = [];
  for (const t of proposal.type) {
    if (existingStyles.has(t.name)) { skipped.push(t.name); continue; }
    const fontName = { family: t.family, style: STYLE[t.weight] ?? 'Regular' };
    try { await figma.loadFontAsync(fontName); } catch { skipped.push(`${t.name} (font ${t.family} ${fontName.style} not available)`); continue; }
    const s = figma.createTextStyle();
    s.name = t.name;
    s.fontName = fontName;
    const sizeVar = made.get(proposal.fontSizes.find((f) => f.value === t.size)?.name ?? '');
    s.fontSize = t.size;
    if (sizeVar) s.setBoundVariable('fontSize', sizeVar);
    s.lineHeight = typeof t.lineHeight === 'number' ? { unit: 'PIXELS', value: t.lineHeight } : t.lineHeight === 'auto' ? { unit: 'AUTO' } : { unit: 'PERCENT', value: parseFloat(t.lineHeight) };
    styles++;
  }
  figma.commitUndo();
  return { variables: made.size, styles, skipped };
}

figma.ui.onmessage = async (msg: Msg) => {
  try {
    if (msg.type === 'scan') {
      figma.ui.postMessage({ type: 'progress', text: 'Counting values…' });
      const c = collect(await roots(msg.scope), { includeTokenized: msg.includeTokenized });
      const fontSizes = fontSizeScale(c.fontSizes);
      proposal = {
        colors: clusterColors(c.colors, msg.merge),
        spacing: spacingScale(c.spacing, msg.grid, msg.grid >= 8 ? 2 : 1),
        radii: radiusScale(c.radii),
        fontSizes,
        type: typeStyles(c.type, fontSizes),
      };
      const raw = { colors: c.colors.length, spacing: c.spacing.length, radii: c.radii.length, fontSizes: c.fontSizes.length, type: c.type.length };
      figma.ui.postMessage({ type: 'proposal', proposal, raw, layers: c.layers, dtcg: JSON.stringify(toDtcg(proposal), null, 2) });
    }
    if (msg.type === 'create') {
      const r = await create(msg.collection.trim() || 'Inventory');
      figma.ui.postMessage({ type: 'created', ...r });
      figma.notify(`Created ${r.variables} variables and ${r.styles} text styles`);
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
