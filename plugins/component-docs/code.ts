// Component Docs — main thread.
import { readComponent } from '../../src/docs/read';
import { loadDocFonts, renderDoc } from '../../src/docs/render-figma';
import { toMarkdown } from '../../src/docs/model';

figma.showUI(__html__, { width: 420, height: 420, themeColors: true });

type Msg = { type: 'init' } | { type: 'generate'; scope: 'selection' | 'page' } | { type: 'markdown'; scope: 'page' | 'file' };

/** Component sets, and components that aren't variants of a set. */
function componentsIn(nodes: readonly SceneNode[]): (ComponentSetNode | ComponentNode)[] {
  const out: (ComponentSetNode | ComponentNode)[] = [];
  const visit = (n: SceneNode) => {
    if (n.type === 'COMPONENT_SET') { out.push(n); return; }
    if (n.type === 'COMPONENT') { if (n.parent?.type !== 'COMPONENT_SET') out.push(n); return; }
    if (n.type === 'INSTANCE') return;
    if ('children' in n) for (const c of n.children) visit(c);
  };
  for (const n of nodes) visit(n.type === 'COMPONENT' && n.parent?.type === 'COMPONENT_SET' ? (n.parent as ComponentSetNode) : n);
  return [...new Set(out)];
}

function counts() {
  return { selection: componentsIn(figma.currentPage.selection).length, page: componentsIn(figma.currentPage.children).length };
}

figma.on('selectionchange', () => figma.ui.postMessage({ type: 'counts', ...counts() }));

figma.ui.onmessage = async (msg: Msg) => {
  try {
    if (msg.type === 'init') figma.ui.postMessage({ type: 'counts', ...counts() });
    if (msg.type === 'generate') {
      const comps = componentsIn(msg.scope === 'selection' ? figma.currentPage.selection : figma.currentPage.children);
      if (!comps.length) throw new Error(msg.scope === 'selection' ? 'Select a component or component set.' : 'No components on this page.');
      await loadDocFonts();
      const frames = [];
      for (const c of comps) {
        figma.ui.postMessage({ type: 'progress', text: `Documenting ${c.name}…` });
        frames.push(await renderDoc(await readComponent(c, { instances: true }), c));
      }
      figma.commitUndo();
      figma.viewport.scrollAndZoomIntoView(frames);
      figma.ui.postMessage({ type: 'done', text: `Documented ${comps.length} component${comps.length === 1 ? '' : 's'}. Run again any time to update the same frames.` });
    }
    if (msg.type === 'markdown') {
      let nodes: readonly SceneNode[] = figma.currentPage.children;
      if (msg.scope === 'file') { await figma.loadAllPagesAsync(); nodes = figma.root.children.flatMap((p) => [...p.children]); }
      const docs = [];
      for (const c of componentsIn(nodes)) docs.push(await readComponent(c, { instances: true }));
      figma.ui.postMessage({ type: 'markdown', text: toMarkdown(docs, { title: `${figma.root.name} components` }), count: docs.length });
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
