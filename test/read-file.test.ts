import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFigma, node, alias } from './mock-figma';
import { readFigmaFile } from '../src/figma/read-file';
import { diff } from '../src/core/diff';
import { fromDtcg } from '../src/adapters/dtcg';

function setup() {
  const btn = node('COMPONENT', 'size=md', {}, [node('TEXT', 'Label')]);
  const set = node('COMPONENT_SET', 'Button', { componentPropertyDefinitions: { 'Label#1:2': { type: 'TEXT', defaultValue: 'Go' }, size: { type: 'VARIANT', defaultValue: 'md' } } }, [btn]);
  const page = node('PAGE', 'Components', {}, [set]);
  const screens = node('PAGE', 'Screens', {}, [
    node('INSTANCE', 'Button', { mainComponent: btn }),
    node('INSTANCE', 'Button', { mainComponent: btn }),
    node('FRAME', 'Card', { textStyleId: '', fills: [{ type: 'SOLID', boundVariables: { color: null } }] }),
  ]);
  const m = installMockFigma({
    collections: [{ name: 'Theme', modes: ['Light', 'Dark'] }],
    variables: [
      { name: 'blue', collection: 'Theme', type: 'COLOR', values: { Light: { r: 0, g: 0, b: 1, a: 1 }, Dark: { r: 0, g: 0, b: 0.5, a: 1 } } },
      { name: 'primary', collection: 'Theme', type: 'COLOR', values: { Light: '@blue', Dark: '@blue' } },
      { name: 'gap', collection: 'Theme', type: 'FLOAT', values: { Light: 8, Dark: 8 } },
    ],
    pages: [page, screens],
  });
  const card = screens.children[2];
  // Same variable on fill and stroke counts once for the layer; a field binding counts too.
  card.fills = [{ type: 'SOLID', boundVariables: { color: alias(m.varIds.get('primary')!) } }];
  card.strokes = [{ type: 'SOLID', boundVariables: { color: alias(m.varIds.get('primary')!) } }];
  card.boundVariables = { itemSpacing: alias(m.varIds.get('gap')!), paddingLeft: alias(m.varIds.get('gap')!) };
  btn.boundVariables = { itemSpacing: alias(m.varIds.get('gap')!) };
  return m;
}

test('reads variables with aliases, usage and instances', async () => {
  setup();
  const s = await readFigmaFile();
  const theme = s.collections[0];
  const v = (n: string) => theme.variables.find((x) => x.name === n)!;
  assert.deepEqual(v('primary').values.Light, { kind: 'alias', name: 'blue' });
  assert.deepEqual(v('blue').values.Dark, { kind: 'color', hex: '#000080' });
  assert.equal(v('primary').usage, 1);
  assert.equal(v('gap').usage, 2, 'card and the button component');
  assert.equal(v('blue').usage, 0);
  const button = s.components[0];
  assert.deepEqual(button.properties, { Label: { type: 'TEXT', default: 'Go' } }, 'VARIANT axes are not properties');
  assert.deepEqual(button.variants, [{ name: 'size=md', layers: ['Label'], instances: 2 }]);
  assert.equal(s.hasUsage, true);
});

test('end to end: DTCG files vs the mock file', async () => {
  setup();
  const target = await readFigmaFile();
  const source = fromDtcg([
    { path: 'Theme/Light.tokens.json', json: { blue: { $type: 'color', $value: '#0000ff' }, brand: { $type: 'color', $value: '{blue}' }, gap: { $type: 'dimension', $value: '12px' } } },
    { path: 'Theme/Dark.tokens.json', json: { blue: { $type: 'color', $value: '#000080' }, brand: { $type: 'color', $value: '{blue}' }, gap: { $type: 'dimension', $value: '12px' } } },
  ]);
  const r = diff(source, target);
  const subjects = r.changes.map((c) => `${c.severity}:${c.kind}:${c.subject}`);
  assert.deepEqual(subjects, [
    'breaking:renamed:Theme › primary → brand',
    'review:changed:Theme › gap',
  ]);
});
