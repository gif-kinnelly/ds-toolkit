// Slot Audit — main thread.
import { summarize, type SlotSummary } from '../../src/slots/audit';
import { collectSlots } from '../../src/slots/collect';

figma.showUI(__html__, { width: 500, height: 720, themeColors: true });

type Msg =
  | { type: 'scan'; scope: 'page' | 'file'; share: number }
  | { type: 'select'; ids: string[] }
  | { type: 'prefer'; componentId: string; propertyKey: string; keys: { key: string; type: 'COMPONENT' | 'COMPONENT_SET' }[]; only: boolean; scope: 'page' | 'file'; share: number };

let last: SlotSummary[] = [];

async function scan(scope: 'page' | 'file', share: number) {
  let roots: readonly SceneNode[] = figma.currentPage.children;
  if (scope === 'file') { await figma.loadAllPagesAsync(); roots = figma.root.children.flatMap((p) => [...p.children]); }
  figma.ui.postMessage({ type: 'progress', text: 'Reading slots…' });
  const occ = await collectSlots(roots, (n) => figma.ui.postMessage({ type: 'progress', text: `Reading slots… ${n} instances` }));
  last = summarize(occ, { share });
  figma.ui.postMessage({ type: 'summary', slots: last, instances: new Set(occ.map((o) => o.instanceName)).size });
}

async function select(ids: string[]) {
  const nodes = (await Promise.all(ids.map((id) => figma.getNodeByIdAsync(id)))).filter((n): n is SceneNode => !!n && n.type !== 'PAGE' && n.type !== 'DOCUMENT');
  let page: BaseNode | null = nodes[0] ?? null;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page as PageNode);
  const here = nodes.filter((n) => { let p: BaseNode | null = n; while (p && p.type !== 'PAGE') p = p.parent; return p === figma.currentPage; });
  figma.currentPage.selection = here;
  if (here.length) figma.viewport.scrollAndZoomIntoView(here);
}

/** Sets a local slot's preferred components (and optionally "preferred only"), keeping its other settings. */
async function prefer(m: Extract<Msg, { type: 'prefer' }>) {
  const owner = (await figma.getNodeByIdAsync(m.componentId)) as ComponentNode | ComponentSetNode | null;
  if (!owner || owner.remote) throw new Error('That component is in a library: change its slot settings in the library file.');
  const def = owner.componentPropertyDefinitions[m.propertyKey];
  owner.editComponentProperty(m.propertyKey, {
    preferredValues: m.keys,
    slotSettings: { ...(def?.slotSettings ?? {}), allowPreferredValuesOnly: m.only },
  });
  figma.commitUndo();
  figma.notify(`Set ${m.keys.length} preferred component${m.keys.length === 1 ? '' : 's'} on ${owner.name} › ${m.propertyKey.split('#')[0]}`);
  await scan(m.scope, m.share);
}

figma.ui.onmessage = async (msg: Msg) => {
  try {
    if (msg.type === 'scan') await scan(msg.scope, msg.share);
    if (msg.type === 'select') await select(msg.ids);
    if (msg.type === 'prefer') await prefer(msg);
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
