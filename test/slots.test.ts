import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRules, summarize, type SlotOccurrence } from '../src/slots/audit';

const occ = (i: number, children: SlotOccurrence['children'], violations: SlotOccurrence['violations'] = [], settings: Partial<SlotOccurrence['settings']> = {}): SlotOccurrence => ({
  component: 'Card', componentId: 'C1', local: true, slot: 'Content', propertyKey: 'Content#1:0', slotNodeId: `S${i}`, instanceName: `Card ${i}`,
  children, violations, settings: { preferred: 0, ...settings },
});
const media = { kind: 'instance' as const, name: 'Media', key: 'K-media', keyType: 'COMPONENT_SET' as const };
const text = { kind: 'instance' as const, name: 'Text block', key: 'K-text', keyType: 'COMPONENT' as const };
const raw = { kind: 'raw' as const, name: 'FRAME' };

test('rules read like people say them', () => {
  assert.deepEqual(describeRules({ min: 1, max: 3, preferred: 2, preferredOnly: true }), ['1–3 items', '2 preferred only']);
  assert.deepEqual(describeRules({ min: 1, max: 1, preferred: 0 }), ['exactly 1']);
  assert.deepEqual(describeRules({ preferred: 0 }), []);
});

test('usage, violations and preferred-value suggestions per slot', () => {
  const list: SlotOccurrence[] = [];
  for (let i = 0; i < 8; i++) list.push(occ(i, [media, text]));
  list.push(occ(8, [media, media, text, raw], ['ABOVE_MAX']));
  list.push(occ(9, [], ['BELOW_MIN']));
  // One-off: a raw frame and a rarely used component.
  list.push(occ(10, [text, { kind: 'instance', name: 'Promo', key: 'K-promo' }]));
  const [s] = summarize(list);
  assert.equal(s.uses, 11);
  assert.equal(s.empty, 1);
  assert.deepEqual(s.violations, { BELOW_MIN: ['S9'], ABOVE_MAX: ['S8'], HAS_NON_PREFERRED: [] });
  assert.deepEqual(s.content.map((c) => [c.name, c.slots]), [['Text block', 10], ['Media', 9], ['FRAME', 1], ['Promo', 1]]);
  assert.deepEqual(s.suggestedPreferred.map((p) => p.name), ['Text block', 'Media'], 'Promo (1 in 11) is under 10%; raw layers are never preferred');
  assert.equal(s.suggestedPreferred[1].type, 'COMPONENT_SET');
});

test('slots with violations first, then slots without rules', () => {
  const a = { ...occ(1, [text]), component: 'A', componentId: 'A', settings: { preferred: 1, min: 1 } };
  const b = { ...occ(2, [text]), component: 'B', componentId: 'B' };
  const c = { ...occ(3, [], ['BELOW_MIN']), component: 'C', componentId: 'C', settings: { preferred: 0, min: 1 } };
  assert.deepEqual(summarize([a, b, c]).map((s) => s.component), ['C', 'B', 'A']);
});
