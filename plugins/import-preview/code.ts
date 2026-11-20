// Import Preview — main thread. Reads the open file into a snapshot; the UI
// does the parsing, diffing and rendering.
import { readFigmaFile } from '../../src/figma/read-file';

figma.showUI(__html__, { width: 460, height: 680, themeColors: true });

type Msg = { type: 'read'; id: number; scope: 'file' | 'page'; components?: string[]; skipUsage?: boolean };

figma.ui.onmessage = async (msg: Msg) => {
  if (msg.type !== 'read') return;
  try {
    const snapshot = await readFigmaFile({
      scope: msg.scope,
      skipUsage: msg.skipUsage,
      components: msg.components ? new Set(msg.components) : undefined,
      onProgress: (text) => figma.ui.postMessage({ type: 'progress', id: msg.id, text }),
    });
    figma.ui.postMessage({ type: 'snapshot', id: msg.id, snapshot });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', id: msg.id, message: String((e as Error)?.message ?? e) });
  }
};
