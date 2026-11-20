import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adopt, order, plan, valueKey, type VarInput } from '../src/brands/inherit';

const c = (hex: string) => {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5), a: 1 };
};
const modes = ['base', 'acme', 'acmeDark', 'zen'];
// acme and zen inherit from base; acmeDark inherits from acme.
const cfg = { parents: { acme: 'base', acmeDark: 'acme', zen: 'base' } };

test('order: parents before children; loops are an error', () => {
  assert.deepEqual(order(cfg.parents, modes), ['acme', 'acmeDark', 'zen']);
  assert.throws(() => order({ a: 'b', b: 'a' }, ['a', 'b']), /loop: a → b → a/);
  assert.throws(() => order({ a: 'gone' }, ['a']), /no longer exists/);
});

test('valueKey: tolerant of float noise; aliases by id', () => {
  assert.equal(valueKey({ r: 0.1000001, g: 0, b: 0, a: 1 }), valueKey({ r: 0.1, g: 0, b: 0 }));
  assert.equal(valueKey({ type: 'VARIABLE_ALIAS', id: 'V:1' }), '@V:1');
  assert.notEqual(valueKey(1), valueKey('1'));
});

function setup(): VarInput[] {
  const vars: VarInput[] = [
    { id: 'primary', name: 'color/primary', values: { base: c('#4f46e5'), acme: c('#e11d48'), acmeDark: c('#e11d48'), zen: c('#4f46e5') } },
    { id: 'radius', name: 'radius/md', values: { base: 6, acme: 6, acmeDark: 6, zen: 12 } },
  ];
  // First-time setup, mode by mode (parents first).
  for (const [child, parent] of Object.entries(cfg.parents)) {
    for (const [id, meta] of Object.entries(adopt(vars, child, parent))) {
      const v = vars.find((x) => x.id === id)!;
      v.meta = { ...v.meta, [child]: meta };
    }
  }
  return vars;
}

const apply = (vars: VarInput[], p: ReturnType<typeof plan>) => {
  for (const w of p.writes) vars.find((v) => v.id === w.varId)!.values[w.modeId] = w.value;
  for (const v of vars) v.meta = p.meta[v.id];
};

test('adopt: same as parent = inherited, different = override', () => {
  const vars = setup();
  assert.deepEqual(vars[0].meta, { acme: { o: true }, acmeDark: { l: valueKey(c('#e11d48')) }, zen: { l: valueKey(c('#4f46e5')) } });
  assert.deepEqual(vars[1].meta!.zen, { o: true });
});

test('base change flows down; overrides and hand edits are kept', () => {
  const vars = setup();
  assert.equal(plan(vars, cfg, modes).writes.length, 0, 'in sync after setup');

  vars[0].values.base = c('#4338ca'); // base primary changes
  vars[1].values.base = 8; // base radius changes
  vars[1].values.acmeDark = 4; // someone edits acmeDark radius by hand
  const p = plan(vars, cfg, modes);
  const ev = p.events.map((e) => `${e.kind}:${e.variable}:${e.mode}`).sort();
  assert.deepEqual(ev, [
    'detected-override:radius/md:acmeDark',
    'followed:color/primary:zen',
    'followed:radius/md:acme',
  ].sort());
  apply(vars, p);
  assert.equal(valueKey(vars[0].values.zen), valueKey(c('#4338ca')));
  assert.equal(valueKey(vars[0].values.acme), valueKey(c('#e11d48')), 'override kept');
  assert.equal(vars[1].values.acme, 8);
  assert.equal(vars[1].values.acmeDark, 4, 'hand edit kept');
  assert.deepEqual(vars[1].meta!.acmeDark, { o: true });
  assert.deepEqual(p.stats.acmeDark, { overrides: 1, inherited: 1 });
});

test('grandchildren follow a parent changed in the same sync', () => {
  const vars = setup();
  vars[1].values.base = 10;
  const p = plan(vars, cfg, modes);
  apply(vars, p);
  assert.equal(vars[1].values.acme, 10);
  assert.equal(vars[1].values.acmeDark, 10, 'acmeDark inherits from acme, which just changed');
});

test('new variables: untouched default is filled, a value set by hand is kept', () => {
  const vars = setup();
  // Created after setup: Figma put #ffffff in every mode, then the designer set base and gave zen its own.
  vars.push({ id: 'accent', name: 'color/accent', values: { base: c('#f59e0b'), acme: c('#ffffff'), acmeDark: c('#ffffff'), zen: c('#14b8a6') } });
  const p = plan(vars, cfg, modes);
  const ev = p.events.filter((e) => e.variable === 'color/accent').map((e) => `${e.kind}:${e.mode}`).sort();
  assert.deepEqual(ev, ['filled:acme', 'filled:acmeDark', 'new-override:zen']);
});

test('reset puts an override back to inheriting; keep turns a pending sync into an override', () => {
  const vars = setup();
  vars[0].values.base = c('#000000');
  const p = plan(vars, cfg, modes, { reset: [{ varId: 'primary', modeId: 'acme' }], keep: [{ varId: 'primary', modeId: 'zen' }] });
  apply(vars, p);
  assert.equal(valueKey(vars[0].values.acme), valueKey(c('#000000')));
  assert.equal(valueKey(vars[0].values.acmeDark), valueKey(c('#000000')), 'and its child follows');
  assert.deepEqual(vars[0].meta!.acme, { l: valueKey(c('#000000')) });
  assert.equal(valueKey(vars[0].values.zen), valueKey(c('#4f46e5')), 'kept');
  assert.deepEqual(vars[0].meta!.zen, { o: true });
});

test('aliases inherit as aliases', () => {
  const alias = { type: 'VARIABLE_ALIAS', id: 'VariableID:9' };
  const vars: VarInput[] = [{ id: 'x', name: 'x', values: { base: alias, acme: c('#ffffff') }, meta: { acme: { l: valueKey(c('#ffffff')) } } }];
  const p = plan(vars, { parents: { acme: 'base' } }, ['base', 'acme']);
  assert.deepEqual(p.writes, [{ varId: 'x', modeId: 'acme', value: alias }]);
});
