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

/** A "Brand" collection with a base mode and two brands, for Brand Inheritance. */
export function brandFile() {
  installMockFigma({
    name: 'Multi-brand DS',
    modeLimit: 4,
    collections: [{ name: 'Brand', modes: ['Base', 'Acme', 'Zen'] }],
    variables: [
      { name: 'color/primary', collection: 'Brand', type: 'COLOR', values: { Base: { r: 0.31, g: 0.275, b: 0.898, a: 1 }, Acme: { r: 0.882, g: 0.114, b: 0.282, a: 1 }, Zen: { r: 0.31, g: 0.275, b: 0.898, a: 1 } } },
      { name: 'color/surface', collection: 'Brand', type: 'COLOR', values: { Base: { r: 1, g: 1, b: 1, a: 1 }, Acme: { r: 1, g: 1, b: 1, a: 1 }, Zen: { r: 0.98, g: 0.976, b: 0.961, a: 1 } } },
      { name: 'radius/md', collection: 'Brand', type: 'FLOAT', values: { Base: 6, Acme: 6, Zen: 6 } },
      { name: 'font/family', collection: 'Brand', type: 'STRING', values: { Base: 'Inter', Acme: 'Inter', Zen: 'Inter' } },
    ],
    pages: [node('PAGE', 'Page 1')],
  });
}

/** Test helper: read or set a value by variable and mode name. */
export async function value(varName: string, modeName: string, set?: unknown) {
  const f = (globalThis as unknown as { figma: { variables: { getLocalVariablesAsync(): Promise<{ name: string; variableCollectionId: string; valuesByMode: Record<string, unknown>; setValueForMode(m: string, v: unknown): void }[]>; getLocalVariableCollectionsAsync(): Promise<{ id: string; modes: { modeId: string; name: string }[] }[]> } } }).figma;
  const v = (await f.variables.getLocalVariablesAsync()).find((x) => x.name === varName)!;
  const c = (await f.variables.getLocalVariableCollectionsAsync()).find((x) => x.id === v.variableCollectionId)!;
  const mode = c.modes.find((m) => m.name === modeName)!.modeId;
  if (set !== undefined) v.setValueForMode(mode, set);
  return v.valuesByMode[mode];
}

/** A page of hand-built UI with raw values, some matching tokens exactly, some nearly, some not at all. */
export function rebindFile() {
  const rgb = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
  const solid = (hex: string, opacity = 1) => ({ type: 'SOLID', visible: true, opacity, color: rgb(hex) });
  const text = (name: string, hex: string, size: number) => node('TEXT', name, { fills: [solid(hex)], textStyleId: '', fontSize: size, fillStyleId: '' });
  const card = (i: number, extra = {}) => node('FRAME', `Card ${i}`, {
    fills: [solid('#ffffff')], fillStyleId: '', strokes: [solid('#e4e4e7')], strokeStyleId: '', strokeWeight: 1,
    topLeftRadius: 8, topRightRadius: 8, bottomLeftRadius: 8, bottomRightRadius: 8,
    layoutMode: 'VERTICAL', primaryAxisAlignItems: 'MIN', itemSpacing: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, ...extra,
  }, [text('Title', '#18181b', 16), text('Body', '#71717a', 14),
    node('FRAME', 'Button', { fills: [solid(i === 2 ? '#4f47e6' : '#4f46e5')], fillStyleId: '', topLeftRadius: 6, topRightRadius: 6, bottomLeftRadius: 6, bottomRightRadius: 6, layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER', itemSpacing: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }, [text('Label', '#ffffff', 14)])]);
  const page = node('PAGE', 'Screens', {}, [
    card(0), card(1), card(2), card(3),
    node('FRAME', 'Promo', { fills: [solid('#123456')], fillStyleId: '' }),
    node('FRAME', 'Scrim', { fills: [solid('#000000', 0.5)], fillStyleId: '' }),
    node('INSTANCE', 'Avatar', { fills: [solid('#4f46e5')], fillStyleId: '' }),
  ]);
  const m = installMockFigma({
    name: 'App screens',
    collections: [{ name: 'Primitives', modes: ['Value'] }, { name: 'Theme', modes: ['Light', 'Dark'] }],
    variables: [
      { name: 'palette/indigo/600', collection: 'Primitives', type: 'COLOR', values: { Value: rgb('#4f46e5') }, hidden: true },
      { name: 'palette/zinc/900', collection: 'Primitives', type: 'COLOR', values: { Value: rgb('#18181b') }, hidden: true },
      { name: 'color/primary', collection: 'Theme', type: 'COLOR', values: { Light: '@palette/indigo/600', Dark: rgb('#818cf8') }, scopes: ['FRAME_FILL', 'SHAPE_FILL'] },
      { name: 'color/on-primary', collection: 'Theme', type: 'COLOR', values: { Light: rgb('#ffffff'), Dark: rgb('#ffffff') }, scopes: ['TEXT_FILL'] },
      { name: 'color/surface', collection: 'Theme', type: 'COLOR', values: { Light: rgb('#ffffff'), Dark: rgb('#18181b') }, scopes: ['FRAME_FILL'] },
      { name: 'color/text', collection: 'Theme', type: 'COLOR', values: { Light: '@palette/zinc/900', Dark: rgb('#fafafa') }, scopes: ['TEXT_FILL'] },
      { name: 'color/text-muted', collection: 'Theme', type: 'COLOR', values: { Light: rgb('#71717a'), Dark: rgb('#a1a1aa') }, scopes: ['TEXT_FILL'] },
      { name: 'color/border', collection: 'Theme', type: 'COLOR', values: { Light: rgb('#e4e4e7'), Dark: rgb('#3f3f46') }, scopes: ['STROKE_COLOR'] },
      { name: 'color/scrim', collection: 'Theme', type: 'COLOR', values: { Light: { r: 0, g: 0, b: 0, a: 0.5 }, Dark: { r: 0, g: 0, b: 0, a: 0.6 } } },
      { name: 'radius/md', collection: 'Theme', type: 'FLOAT', values: { Light: 6, Dark: 6 }, scopes: ['CORNER_RADIUS'] },
      { name: 'radius/lg', collection: 'Theme', type: 'FLOAT', values: { Light: 8, Dark: 8 }, scopes: ['CORNER_RADIUS'] },
      { name: 'space/2', collection: 'Theme', type: 'FLOAT', values: { Light: 8, Dark: 8 }, scopes: ['GAP'] },
      { name: 'space/3', collection: 'Theme', type: 'FLOAT', values: { Light: 12, Dark: 12 }, scopes: ['GAP'] },
      { name: 'space/4', collection: 'Theme', type: 'FLOAT', values: { Light: 16, Dark: 16 }, scopes: ['GAP'] },
      { name: 'font-size/sm', collection: 'Theme', type: 'FLOAT', values: { Light: 14, Dark: 14 }, scopes: ['FONT_SIZE'] },
    ],
    pages: [page],
  });
  // Card 3 is in dark mode, but someone painted it with the light surface by hand.
  const theme = m.collections.find((c) => c.name === 'Theme')!;
  // Modes are inherited by everything inside the frame.
  const dark = (n: ReturnType<typeof node>) => { n.resolvedVariableModes = { [theme.id]: theme.modes[1].modeId }; n.children.forEach(dark); };
  dark(page.children[3]);
  (window as unknown as { __undo: unknown }).__undo = m.undo;
  (window as unknown as { __page: unknown }).__page = page;
}

Object.assign(window, { demoFile, brandFile, rebindFile, value, run });
