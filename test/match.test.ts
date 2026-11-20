import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorDistance, group, suggest, type Candidate, type Finding } from '../src/rebind/match';

const cand = (name: string, values: Record<string, string | number>, more: Partial<Candidate> = {}): Candidate => ({
  id: name, name, collectionId: 'theme', collection: 'Theme', type: typeof Object.values(values)[0] === 'number' ? 'FLOAT' : 'COLOR',
  scopes: ['ALL_SCOPES'], hidden: false, alias: false, values, defaultModeId: 'light', ...more,
});

const cands: Candidate[] = [
  cand('palette/indigo/600', { v: '#4f46e5' }, { collectionId: 'prim', collection: 'Primitives', defaultModeId: 'v', hidden: true }),
  cand('palette/indigo/500', { v: '#6366f1' }, { collectionId: 'prim', collection: 'Primitives', defaultModeId: 'v' }),
  cand('color/primary', { light: '#4f46e5', dark: '#818cf8' }, { alias: true, scopes: ['FRAME_FILL', 'SHAPE_FILL', 'STROKE_COLOR'] }),
  cand('color/text-link', { light: '#4f46e5', dark: '#a5b4fc' }, { alias: true, scopes: ['TEXT_FILL'] }),
  cand('color/scrim', { light: '#00000080', dark: '#00000099' }, { alias: true }),
  cand('space/4', { light: 16, dark: 16 }, { scopes: ['GAP'] }),
  cand('radius/md', { light: 6, dark: 6 }, { scopes: ['CORNER_RADIUS'] }),
  cand('size/16', { light: 16, dark: 16 }, { scopes: ['WIDTH_HEIGHT'] }),
];
const color = (hex: string, opacity = 1) => ({ kind: 'color' as const, hex, opacity });
const num = (n: number) => ({ kind: 'number' as const, n });
const names = (s: ReturnType<typeof suggest>) => s.map((x) => x.candidate.name);

test('color distance is perceptual and zero for equal colors', () => {
  assert.equal(colorDistance('#4f46e5', '#4f46e5'), 0);
  assert.ok(colorDistance('#4f46e5', '#4f47e5') < 1);
  assert.ok(colorDistance('#4f46e5', '#6366f1') > 4);
});

test('scopes decide which tokens a field can use; semantic tokens beat hidden primitives', () => {
  assert.deepEqual(names(suggest({ field: 'fill', value: color('#4f46e5'), modes: {} }, cands)), ['color/primary']);
  assert.deepEqual(names(suggest({ field: 'text-fill', value: color('#4f46e5'), modes: {} }, cands)), ['color/text-link']);
  assert.deepEqual(names(suggest({ field: 'fill', value: color('#4f46e5'), modes: {} }, cands, { includeHidden: true })), ['color/primary', 'palette/indigo/600']);
  assert.deepEqual(names(suggest({ field: 'gap', value: num(16), modes: {} }, cands)), ['space/4'], 'size/16 is scoped to width/height');
  assert.deepEqual(names(suggest({ field: 'radius', value: num(16), modes: {} }, cands)), []);
});

test('the layer\'s mode picks which value to compare', () => {
  assert.deepEqual(names(suggest({ field: 'fill', value: color('#818cf8'), modes: { theme: 'dark' } }, cands)), ['color/primary']);
  assert.deepEqual(names(suggest({ field: 'fill', value: color('#818cf8'), modes: {} }, cands)), [], 'light mode by default');
});

test('near matches only within the threshold, exact first', () => {
  const s = suggest({ field: 'fill', value: color('#4f47e6'), modes: {} }, cands);
  assert.equal(s[0].candidate.name, 'color/primary');
  assert.ok(s[0].distance > 0 && s[0].distance < 2);
  assert.deepEqual(suggest({ field: 'fill', value: color('#4f47e6'), modes: {} }, cands, { maxColorDistance: 0 }), []);
  assert.deepEqual(names(suggest({ field: 'gap', value: num(15), modes: {} }, cands, { maxNumberDistance: 2 })), ['space/4']);
});

test('a black paint at 50% matches a token that carries the alpha itself', () => {
  const s = suggest({ field: 'fill', value: color('#000000', 0.5), modes: {} }, cands);
  assert.equal(s[0].candidate.name, 'color/scrim');
  assert.equal(s[0].absorbsOpacity, true);
});

test('group: same field family and value in one row, biggest first', () => {
  const f = (nodeId: string, field: Finding['field'], value: Finding['value'], modes = {}): Finding => ({ nodeId, nodeName: nodeId, field, value, modes });
  const gs = group([
    f('a', 'fill', color('#4f46e5')), f('b', 'fill', color('#4f46e5')), f('c', 'fill', color('#4f46e5'), { theme: 'light' }),
    f('d', 'gap', num(16)), f('e', 'fill', color('#123456')),
  ], cands);
  assert.deepEqual(gs.map((g) => [g.field, g.findings.length, g.suggestions[0]?.candidate.name ?? null]), [
    ['fill', 3, 'color/primary'], ['fill', 1, null], ['gap', 1, 'space/4'],
  ]);
});

test('group: gap and padding share a spacing row', () => {
  const f = (nodeId: string, field: Finding['field']): Finding => ({ nodeId, nodeName: nodeId, field, value: num(16), modes: {} });
  const gs = group([f('a', 'gap'), f('b', 'padding')], cands);
  assert.equal(gs.length, 1);
  assert.equal(gs[0].findings.length, 2);
});
