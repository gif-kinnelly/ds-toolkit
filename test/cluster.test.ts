import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterColors, colorName, fontSizeScale, radiusScale, spacingScale, toDtcg, typeStyles } from '../src/inventory/cluster';
import { load } from '../src/adapters/load';

test('color names: hue family and a 50–950 step from lightness', () => {
  // Tailwind's zinc scale lands on its own steps.
  const zinc = { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b' };
  for (const [step, hex] of Object.entries(zinc)) assert.deepEqual(colorName(hex), { family: 'gray', step: Number(step) }, hex);
  assert.deepEqual(colorName('#dc2626'), { family: 'red', step: 600 });
  assert.equal(colorName('#4f46e5').family, 'indigo');
  assert.equal(colorName('#16a34a').family, 'green');
  assert.equal(colorName('#2563eb').family, 'blue');
  const tw = { red: '#dc2626', orange: '#ea580c', amber: '#d97706', yellow: '#ca8a04', lime: '#65a30d', green: '#16a34a', emerald: '#059669', teal: '#0d9488', cyan: '#0891b2', sky: '#0284c7', blue: '#2563eb', indigo: '#4f46e5', violet: '#7c3aed', purple: '#9333ea', fuchsia: '#c026d3', pink: '#db2777', rose: '#e11d48' };
  for (const [family, hex] of Object.entries(tw)) assert.equal(colorName(hex).family, family, hex);
  assert.deepEqual(colorName('#ffffff'), { family: 'white', step: null });
  // Lighter tints get lower steps within a family.
  const steps = ['#e0e7ff', '#a5b4fc', '#6366f1', '#4338ca', '#312e81'].map((h) => colorName(h).step!);
  assert.deepEqual([...steps].sort((a, b) => a - b), steps);
});

test('near-duplicate colors merge into the most used one', () => {
  const c = clusterColors([
    { value: '#4f46e5', count: 120 }, { value: '#4f47e6', count: 3 }, { value: '#5046e4', count: 2 },
    { value: '#dc2626', count: 40 }, { value: '#ffffff', count: 300 }, { value: '#fefefe', count: 4 },
  ]);
  assert.deepEqual(c.map((x) => [x.name, x.hex, x.count, x.merged.length]), [
    ['palette/white', '#ffffff', 304, 1],
    [`palette/indigo/${colorName('#4f46e5').step}`, '#4f46e5', 125, 2],
    ['palette/red/600', '#dc2626', 40, 0],
  ]);
});

test('two colors wanting the same step: the less used one takes the nearest free step', () => {
  const c = clusterColors([{ value: '#4f46e5', count: 10 }, { value: '#4338ca', count: 5 }, { value: '#5b52f0', count: 1 }], 1);
  const names = c.map((x) => x.name);
  assert.equal(new Set(names).size, 3);
  assert.equal(names[0], `palette/indigo/${colorName('#4f46e5').step}`);
});

test('spacing snaps to a 4px grid; odd values are reported off-grid', () => {
  const s = spacingScale([{ value: 16, count: 50 }, { value: 15, count: 3 }, { value: 8, count: 30 }, { value: 7, count: 1 }, { value: 22, count: 2 }, { value: 2, count: 4 }]);
  assert.deepEqual(s.map((x) => [x.value, x.count, x.name, !!x.offGrid]), [[2, 4, 'space/0.5', false], [8, 31, 'space/2', false], [16, 53, 'space/4', false], [22, 2, '', true]]);
});

test('radii and font sizes are named around the most used value', () => {
  const r = radiusScale([{ value: 4, count: 5 }, { value: 8, count: 40 }, { value: 12, count: 6 }, { value: 9999, count: 9 }]);
  assert.deepEqual(r.map((x) => x.name), ['radius/sm', 'radius/md', 'radius/lg', 'radius/full']);
  const f = fontSizeScale([{ value: 12, count: 10 }, { value: 14, count: 200 }, { value: 16, count: 30 }, { value: 24, count: 4 }]);
  assert.deepEqual(f.map((x) => x.name), ['font-size/sm', 'font-size/md', 'font-size/lg', 'font-size/xl']);
});

test('typography combos become styles; the proposal round-trips through the DTCG adapter', () => {
  const sizes = fontSizeScale([{ value: 14, count: 200 }, { value: 24, count: 4 }, { value: 12, count: 9 }]);
  const type = typeStyles([
    { value: { family: 'Inter', weight: 400, size: 14, lineHeight: 20 }, count: 150 },
    { value: { family: 'Inter', weight: 600, size: 24, lineHeight: 32 }, count: 4 },
    { value: { family: 'Inter', weight: 500, size: 12, lineHeight: 16 }, count: 9 },
  ], sizes);
  assert.deepEqual(type.map((t) => t.name), ['typography/body-md', 'typography/label-sm', 'typography/heading-lg']);
  const tokens = toDtcg({ colors: clusterColors([{ value: '#4f46e5', count: 3 }]), spacing: spacingScale([{ value: 16, count: 2 }]), radii: [], fontSizes: sizes, type });
  const snap = load([{ path: 'Inventory/Value.tokens.json', text: JSON.stringify(tokens) }]);
  const names = snap.collections[0].variables.map((v) => v.name);
  assert.ok(names.includes(`palette/indigo/${colorName('#4f46e5').step}`) && names.includes('space/4') && names.includes('font-size/md'));
  assert.deepEqual(snap.styles.find((s) => s.name === 'typography/body-md')!.props, { fontFamily: 'Inter', fontWeight: 400, fontSize: 'var:font-size/md', lineHeight: '142.9%' });
});

test('pale tints join the family of a nearby saturated color', () => {
  const c = clusterColors([{ value: '#15803d', count: 6 }, { value: '#dcfce7', count: 6 }, { value: '#b91c1c', count: 4 }, { value: '#fee2e2', count: 4 }]);
  assert.deepEqual(c.map((x) => x.name.split('/')[1]), ['green', 'green', 'red', 'red']);
  // Alone, a pale tint keeps its own hue name.
  assert.equal(clusterColors([{ value: '#dcfce7', count: 1 }])[0].name.split('/')[1], colorName('#dcfce7').family);
});
