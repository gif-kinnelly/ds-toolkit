// Token Rebinder — main thread. Scans for raw values, suggests variables,
// binds the ones you approve. One apply is one undo step.
import { familyOf, group, isColorField, type Group, type MatchOptions } from '../../src/rebind/match';
import { bind, candidates, scan, type ScanFinding } from '../../src/rebind/scan';
import { withOpacity } from '../../src/rebind/match';

figma.showUI(__html__, { width: 500, height: 720, themeColors: true });

type ScanMsg = { type: 'scan'; scope: 'selection' | 'page' | 'file'; libraries: string[]; skipInstances: boolean } & MatchOptions;
type Msg = { type: 'init' } | ScanMsg | { type: 'select'; key: string } | { type: 'apply'; choices: { key: string; variableId: string }[] };

let last: { msg: ScanMsg; groups: Group[]; vars: Map<string, Variable> } | null = null;
const say = (text: string) => figma.ui.postMessage({ type: 'progress', text });

async function libraries() {
  try {
    const cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    return cols.map((c) => ({ key: c.key, name: c.name, library: c.libraryName }));
  } catch { return []; } // no team library access (e.g. drafts) is fine: local variables still work
}

async function roots(scope: ScanMsg['scope']): Promise<readonly SceneNode[]> {
  if (scope === 'selection') {
    if (!figma.currentPage.selection.length) throw new Error('Select some layers first, or scan the page.');
    return figma.currentPage.selection;
  }
  if (scope === 'page') return figma.currentPage.children;
  await figma.loadAllPagesAsync();
  return figma.root.children.flatMap((p) => [...p.children]);
}

async function run(msg: ScanMsg) {
  say('Reading variables…');
  const vars: Variable[] = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.resolvedType === 'COLOR' || v.resolvedType === 'FLOAT');
  for (const key of msg.libraries) {
    say('Importing library variables…');
    for (const lv of await figma.teamLibrary.getVariablesInLibraryCollectionAsync(key)) {
      if (lv.resolvedType !== 'COLOR' && lv.resolvedType !== 'FLOAT') continue;
      vars.push(await figma.variables.importVariableByKeyAsync(lv.key));
    }
  }
  const cands = await candidates(vars);
  say('Scanning layers…');
  const findings: ScanFinding[] = scan(await roots(msg.scope), { skipInstances: msg.skipInstances });
  const groups = group(findings, cands, msg);
  last = { msg, groups, vars: new Map(vars.map((v) => [v.id, v])) };
  const layers = new Set(findings.map((f) => f.nodeId)).size;
  figma.ui.postMessage({
    type: 'groups',
    candidates: cands.length,
    layers,
    groups: groups.map((g) => ({
      key: g.key,
      family: familyOf(g.field),
      color: isColorField(g.field),
      value: g.value.kind === 'color' ? withOpacity(g.value.hex, g.value.opacity) : String(Math.round(g.value.n * 100) / 100),
      count: g.findings.length,
      layerCount: new Set(g.findings.map((f) => f.nodeId)).size,
      layers: [...new Set(g.findings.map((f) => f.nodeName))].slice(0, 4),
      suggestions: g.suggestions.slice(0, 8).map((s) => ({ id: s.candidate.id, name: s.candidate.name, collection: s.candidate.collection, distance: Math.round(s.distance * 10) / 10, value: s.candidate.values[s.candidate.defaultModeId] })),
    })),
  });
}

async function select(key: string) {
  const g = last?.groups.find((x) => x.key === key);
  if (!g) return;
  const nodes = (await Promise.all(g.findings.map((f) => figma.getNodeByIdAsync(f.nodeId)))).filter((n): n is SceneNode => !!n && 'visible' in n);
  // Selection works per page: go to the page with the first layer and select what's there.
  let page: BaseNode | null = nodes[0] ?? null;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page as PageNode);
  const here = nodes.filter((n) => { let p: BaseNode | null = n; while (p && p.type !== 'PAGE') p = p.parent; return p === figma.currentPage; });
  figma.currentPage.selection = here;
  if (here.length) figma.viewport.scrollAndZoomIntoView(here);
}

async function apply(choices: { key: string; variableId: string }[]) {
  if (!last) return;
  const items = [];
  for (const c of choices) {
    const g = last.groups.find((x) => x.key === c.key);
    const s = g?.suggestions.find((x) => x.candidate.id === c.variableId);
    const variable = last.vars.get(c.variableId);
    if (!g || !s || !variable) continue;
    for (const finding of g.findings) items.push({ finding: finding as ScanFinding, variable, suggestion: s });
  }
  const { done, skipped } = await bind(items);
  figma.commitUndo();
  figma.notify(`Bound ${done} value${done === 1 ? '' : 's'} to variables${skipped ? ` (${skipped} changed since the scan, skipped)` : ''}. ⌘Z undoes it.`);
  figma.ui.postMessage({ type: 'applied', done, skipped });
  await run(last.msg);
}

figma.ui.onmessage = async (msg: Msg) => {
  try {
    if (msg.type === 'init') figma.ui.postMessage({ type: 'init', libraries: await libraries(), selection: figma.currentPage.selection.length });
    if (msg.type === 'scan') await run(msg);
    if (msg.type === 'select') await select(msg.key);
    if (msg.type === 'apply') await apply(msg.choices);
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
