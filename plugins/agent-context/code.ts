// Agent Context — main thread. Reads the file's tokens, styles and components
// and writes design-system.md / .json for coding agents.
import { readFigmaFile } from '../../src/figma/read-file';
import { readComponent } from '../../src/docs/read';
import { buildManifest } from '../../src/agent/manifest';

figma.showUI(__html__, { width: 520, height: 640, themeColors: true });

figma.ui.onmessage = async (msg: { type: 'build' }) => {
  if (msg.type !== 'build') return;
  try {
    const snap = await readFigmaFile({ skipUsage: true, onProgress: (text) => figma.ui.postMessage({ type: 'progress', text }) });
    figma.ui.postMessage({ type: 'progress', text: 'Reading components…' });
    await figma.loadAllPagesAsync();
    const docs = [];
    for (const page of figma.root.children) {
      for (const n of page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })) {
        if (n.type === 'COMPONENT' && n.parent?.type === 'COMPONENT_SET') continue;
        docs.push(await readComponent(n));
      }
    }
    const { markdown, json } = buildManifest({ ...snap, components: [] }, docs, { title: figma.root.name });
    figma.ui.postMessage({ type: 'manifest', markdown, json: JSON.stringify(json, null, 2), stats: { tokens: json.collections.reduce((n, c) => n + c.tokens.length, 0), components: json.components.length, rules: json.rules.length } });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
