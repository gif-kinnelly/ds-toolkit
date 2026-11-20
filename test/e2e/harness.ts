/**
 * Browser harness: runs a built plugin the way Figma does. code.js runs in
 * this page against the mock figma API; ui.html runs in an iframe; messages go
 * through postMessage both ways, wrapped in { pluginMessage }.
 */
import { installMockFigma, node, alias } from '../mock-figma';

declare global { interface Window { __ready: boolean; __notes: string[] } }

export function demoFile() {
  const label = () => node('TEXT', 'Label');
  const icon = () => node('FRAME', 'Icon');
  const primary = node('COMPONENT', 'size=md, tone=primary', {}, [icon(), label()]);
  const danger = node('COMPONENT', 'size=md, tone=danger', {}, [label()]);
  const set = node('COMPONENT_SET', 'Button', { componentPropertyDefinitions: { 'Label#1:0': { type: 'TEXT', defaultValue: 'Button' } } }, [primary, danger]);
  const instances: ReturnType<typeof node>[] = [];
  for (let i = 0; i < 48; i++) instances.push(node('INSTANCE', 'Button', { mainComponent: primary }));
  for (let i = 0; i < 6; i++) instances.push(node('INSTANCE', 'Button', { mainComponent: danger }));
  const cards: ReturnType<typeof node>[] = [];
  for (let i = 0; i < 31; i++) cards.push(node('FRAME', `Card ${i}`));
  const m = installMockFigma({
    name: 'Acme Design System',
    collections: [{ name: 'Primitives', modes: ['Value'] }, { name: 'Theme', modes: ['Light', 'Dark'] }],
    variables: [
      { name: 'palette/indigo/600', collection: 'Primitives', type: 'COLOR', values: { Value: { r: 0.31, g: 0.275, b: 0.898, a: 1 } } },
      { name: 'palette/red/600', collection: 'Primitives', type: 'COLOR', values: { Value: { r: 0.863, g: 0.149, b: 0.149, a: 1 } } },
      { name: 'color/primary', collection: 'Theme', type: 'COLOR', values: { Light: '@palette/indigo/600', Dark: { r: 0.506, g: 0.549, b: 0.973, a: 1 } } },
      { name: 'color/danger', collection: 'Theme', type: 'COLOR', values: { Light: '@palette/red/600', Dark: { r: 0.973, g: 0.443, b: 0.443, a: 1 } } },
      { name: 'radius/md', collection: 'Theme', type: 'FLOAT', values: { Light: 6, Dark: 6 } },
    ],
    pages: [node('PAGE', 'Components', {}, [set]), node('PAGE', 'Screens', {}, [...instances, ...cards])],
  });
  const id = (n: string) => m.varIds.get(n)!;
  cards.forEach((c, i) => {
    c.fills = [{ type: 'SOLID', boundVariables: { color: alias(id(i < 19 ? 'color/primary' : 'color/danger')) } }];
    c.boundVariables = { topLeftRadius: alias(id('radius/md')) };
  });
}

export function run(codeJs: string, uiHtml: string) {
  window.__notes = [];
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:460px;height:900px;border:1px solid #ddd;border-radius:8px;background:#fff';
  document.body.appendChild(frame);
  const f = (globalThis as unknown as { figma: Record<string, unknown> }).figma;
  // Unwrap the strict proxy for the UI bits the plugin needs.
  const ui = { onmessage: null as null | ((m: unknown) => void), postMessage: (m: unknown) => frame.contentWindow!.postMessage({ pluginMessage: m }, '*') };
  const real = new Proxy(f, { get: (t, k) => (k === 'ui' ? ui : k === 'showUI' ? () => { frame.srcdoc = uiHtml; } : k === 'notify' ? (s: string) => window.__notes.push(s) : (t as Record<string | symbol, unknown>)[k]) });
  (globalThis as unknown as { figma: unknown }).figma = real;
  window.addEventListener('message', (e) => { if (e.source === frame.contentWindow && e.data?.pluginMessage) ui.onmessage?.(e.data.pluginMessage); });
  frame.onload = () => { window.__ready = true; };
  // eslint-disable-next-line no-new-func
  new Function('__html__', codeJs)(uiHtml);
}

Object.assign(window, { demoFile, run });
