import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromDtcg, nameFromPath } from '../src/adapters/dtcg';
import { fromUiSpec } from '../src/adapters/ui-spec';
import { fromFigmaRest } from '../src/adapters/figma-rest';
import { detect, load } from '../src/adapters/load';

// Shaped like Figma's native "Export variables": one file per mode, color objects, flat com.figma.* keys.
const light = {
  color: {
    blue: { 600: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.149, 0.388, 0.922], alpha: 1, hex: '#2563EB' }, $extensions: { 'com.figma.hiddenFromPublishing': true } } },
    primary: { $type: 'color', $value: '{color.blue.600}' },
    overlay: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 } },
  },
  space: { $type: 'dimension', md: { $value: { value: 1, unit: 'rem' } }, sm: { $value: '8px' } },
  flag: { $value: true, $extensions: { 'com.figma': { type: 'boolean' } } },
};
const dark = { color: { blue: { 600: { $type: 'color', $value: '#60a5fa' } }, primary: { $type: 'color', $value: '{color.blue.600}' } } };

test('DTCG: modes from file names, collection from folder', () => {
  assert.deepEqual(nameFromPath('Colors/Light Mode.tokens.json', 'Tokens'), { collection: 'Colors', mode: 'Light Mode' });
  assert.deepEqual(nameFromPath('tokens.json', 'Tokens'), { collection: 'Tokens', mode: 'tokens' });
});

test('DTCG: Figma native export shape', () => {
  const s = fromDtcg([{ path: 'Theme/Light.tokens.json', json: light }, { path: 'Theme/Dark.tokens.json', json: dark }]);
  const c = s.collections[0];
  assert.equal(c.name, 'Theme');
  assert.deepEqual(c.modes, ['Light', 'Dark']);
  const v = (n: string) => c.variables.find((x) => x.name === n)!;
  assert.deepEqual(v('color/blue/600').values, { Light: { kind: 'color', hex: '#2563eb' }, Dark: { kind: 'color', hex: '#60a5fa' } });
  assert.equal(v('color/blue/600').hidden, true);
  assert.deepEqual(v('color/primary').values.Light, { kind: 'alias', name: 'color/blue/600' });
  assert.deepEqual(v('color/overlay').values.Light, { kind: 'color', hex: '#00000080' });
  assert.deepEqual(v('space/md').values.Light, { kind: 'number', n: 16 }, 'rem converts at 16px');
  assert.equal(v('space/sm').type, 'FLOAT');
  assert.equal(v('flag').type, 'BOOLEAN');
});

test('DTCG: inline modes, untyped aliases, composite styles', () => {
  const s = fromDtcg([{ path: 'tokens.json', json: {
    base: { $value: '#ffffff', $extensions: { mode: { Light: '#ffffff', Dark: '#000000' } } },
    surface: { $value: '{base}' },
    heading: { $type: 'typography', $value: { fontFamily: ['Inter', 'sans-serif'], fontWeight: 'semibold', fontSize: '1.5rem', lineHeight: 1.25 } },
    card: { $type: 'shadow', $value: { color: '#0000001a', offsetX: '0px', offsetY: '2px', blur: '8px', spread: '0px' } },
  } }]);
  const c = s.collections[0];
  assert.deepEqual(c.modes, ['Light', 'Dark']);
  const surface = c.variables.find((v) => v.name === 'surface')!;
  assert.equal(surface.type, 'COLOR');
  assert.deepEqual(Object.keys(surface.values), ['Light', 'Dark'], 'plain token applies to every inline mode');
  assert.deepEqual(s.styles.find((x) => x.name === 'heading')!.props, { fontFamily: 'Inter', fontWeight: 600, fontSize: 24, lineHeight: '125%' });
  assert.equal(s.styles.find((x) => x.name === 'card')!.props['shadow0.blur'], 8);
});

test('component spec (ui-components format)', () => {
  const s = fromUiSpec({
    name: 'Drafts',
    tokens: { collections: [{ name: 'Theme', modes: ['Light', 'Dark'], variables: [{ name: 'color/info', type: 'COLOR', values: { Light: '{palette/blue/600}', Dark: '#60A5FA' } }] }] },
    components: [{
      name: 'Toast',
      properties: { Title: { type: 'TEXT', default: 'Saved' } },
      variants: [
        { props: { tone: 'info', size: 'md' }, root: { type: 'frame', name: 'Toast', children: [{ type: 'frame', name: 'Text', children: [{ type: 'text', name: 'Title' }] }] } },
        { props: { size: 'sm', tone: 'info' }, root: { type: 'frame', name: 'Toast' } },
      ],
    }],
  });
  assert.deepEqual(s.collections[0].variables[0].values.Dark, { kind: 'color', hex: '#60a5fa' });
  assert.deepEqual(s.components[0].variants.map((v) => v.name), ['tone=info, size=md', 'tone=info, size=sm'], 'axis order follows the first variant, like the plugin');
  assert.deepEqual(s.components[0].variants[0].layers, ['Text', 'Text/Title']);
});

test('Figma REST variables', () => {
  const s = fromFigmaRest({ meta: {
    variableCollections: { c1: { id: 'c1', name: 'Theme', modes: [{ modeId: 'm2', name: 'Dark' }, { modeId: 'm1', name: 'Light' }], defaultModeId: 'm1' } },
    variables: {
      v1: { id: 'v1', name: 'blue', variableCollectionId: 'c1', resolvedType: 'COLOR', valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 }, m2: { r: 0, g: 0, b: 0.5, a: 1 } } },
      v2: { id: 'v2', name: 'primary', variableCollectionId: 'c1', resolvedType: 'COLOR', valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'v1' }, m2: { type: 'VARIABLE_ALIAS', id: 'v1' } } },
    },
  } });
  assert.deepEqual(s.collections[0].modes, ['Light', 'Dark'], 'default mode first');
  assert.deepEqual(s.collections[0].variables[1].values.Light, { kind: 'alias', name: 'blue' });
});

test('load: detects formats and merges', () => {
  assert.equal(detect({ name: 'x', components: [] }), 'ui-spec');
  assert.equal(detect({ source: 's', collections: [], styles: [], components: [] }), 'snapshot');
  const s = load([
    { path: 'Theme/Light.tokens.json', text: JSON.stringify(light) },
    { path: 'Theme/Dark.tokens.json', text: JSON.stringify(dark) },
    { path: 'spec.json', text: JSON.stringify({ name: 'S', components: [{ name: 'Badge', variants: [{ props: { tone: 'a' }, root: { type: 'frame', name: 'Badge' } }] }] }) },
  ]);
  assert.equal(s.collections[0].name, 'Theme');
  assert.equal(s.components[0].name, 'Badge');
  assert.throws(() => load([{ path: 'bad.json', text: '{' }]), /bad.json: not valid JSON/);
});
