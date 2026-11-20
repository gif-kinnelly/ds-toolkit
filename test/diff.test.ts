import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, type Change } from '../src/core/diff';
import type { Snapshot } from '../src/core/snapshot';
import { renderMarkdown, renderText, renderHtmlPage } from '../src/core/render';

const col = (hex: string) => ({ kind: 'color' as const, hex });

const figmaNow: Snapshot = {
  source: 'Figma', hasUsage: true, styles: [],
  collections: [{
    name: 'Theme', modes: ['Light', 'Dark'],
    variables: [
      { name: 'color/primary', type: 'COLOR', values: { Light: col('#4f46e5'), Dark: col('#818cf8') }, usage: 120 },
      { name: 'color/danger', type: 'COLOR', values: { Light: col('#dc2626'), Dark: col('#f87171') }, usage: 14 },
      { name: 'radius/md', type: 'FLOAT', values: { Light: { kind: 'number', n: 6 }, Dark: { kind: 'number', n: 6 } }, usage: 40 },
      { name: 'legacy/unused', type: 'COLOR', values: { Light: col('#000000'), Dark: col('#000000') }, usage: 0 },
    ],
  }, { name: 'Other', modes: ['Mode 1'], variables: [] }],
  components: [{
    name: 'Button',
    properties: { Label: { type: 'TEXT', default: 'Button' }, Icon: { type: 'BOOLEAN', default: false } },
    variants: [
      { name: 'size=md, tone=primary', layers: ['Label', 'Icon'], instances: 300 },
      { name: 'size=md, tone=danger', layers: ['Label'], instances: 12 },
      { name: 'size=xl, tone=primary', layers: ['Label'], instances: 0 },
    ],
  }],
};

const incoming: Snapshot = {
  source: 'tokens', styles: [],
  collections: [{
    name: 'Theme', modes: ['Light', 'Dark', 'HighContrast'],
    variables: [
      { name: 'color/primary', type: 'COLOR', values: { Light: col('#4338ca'), Dark: col('#818cf8'), HighContrast: col('#000000') } },
      // renamed from color/danger, same values
      { name: 'color/error', type: 'COLOR', values: { Light: col('#dc2626'), Dark: col('#f87171'), HighContrast: col('#000000') } },
      // number -> string: Figma can't retype
      { name: 'radius/md', type: 'STRING', values: { Light: { kind: 'string', s: '6px' }, Dark: { kind: 'string', s: '6px' } } },
    ],
  }],
  components: [{
    name: 'Button',
    properties: { Label: { type: 'TEXT', default: 'Continue' } },
    variants: [
      { name: 'size=md, tone=primary', layers: ['Label'] }, // Icon layer removed
      { name: 'size=md, tone=critical', layers: ['Label'] }, // renamed from danger
    ],
  }],
};

const find = (cs: Change[], kind: string, subject: string | RegExp) =>
  cs.find((c) => c.kind === kind && (typeof subject === 'string' ? c.subject === subject : subject.test(c.subject)));

test('ranks what breaks first, with impact', () => {
  const r = diff(incoming, figmaNow);
  const cs = r.changes;

  const retype = find(cs, 'retyped', 'Theme › radius/md')!;
  assert.equal(retype.severity, 'breaking');
  assert.deepEqual(retype.impact, { count: 40, unit: 'layers' });

  const rename = find(cs, 'renamed', 'Theme › color/danger → color/error')!;
  assert.equal(rename.severity, 'breaking', 'used variable renamed by name-matching importer');
  assert.match(rename.detail, /14 layers bound to it won't move/);

  const value = find(cs, 'changed', 'Theme › color/primary')!;
  assert.equal(value.severity, 'review');
  assert.deepEqual(value.rows, [{ label: 'Light', before: '#4f46e5', after: '#4338ca' }]);

  assert.equal(find(cs, 'added', 'Theme › mode HighContrast')!.severity, 'safe');
  assert.equal(find(cs, 'kept', 'Theme › legacy/unused')!.severity, 'safe');
  assert.equal(find(cs, 'kept', 'Other'), undefined, 'collections the source does not mention are ignored by default');

  const variant = find(cs, 'renamed', /Button › size=md, tone=danger → size=md, tone=critical/)!;
  assert.equal(variant.severity, 'breaking');
  assert.deepEqual(variant.impact, { count: 12, unit: 'instances' });

  const layer = find(cs, 'removed', 'Button › size=md, tone=primary › layer Icon')!;
  assert.deepEqual(layer.impact, { count: 300, unit: 'instances' });

  assert.equal(find(cs, 'changed', 'Button › property Label')!.rows![0].after, 'Continue');
  assert.equal(find(cs, 'kept', 'Button › property Icon')!.severity, 'safe');
  assert.equal(find(cs, 'kept', 'Button › size=xl, tone=primary')!.severity, 'safe', 'unused leftover variant');

  // Sorted: breaking first, biggest impact first.
  assert.equal(cs[0].severity, 'breaking');
  assert.equal(cs[0].impact!.count, 40);
  assert.deepEqual(r.counts, { breaking: 3, review: 3, safe: 4 });
});

test('"remove" mode: deletions of used things are breaking', () => {
  const src: Snapshot = { ...incoming, collections: [{ ...incoming.collections[0], modes: ['Light'] }] };
  const r = diff(src, figmaNow, { missing: 'remove', wholeFile: true });
  assert.equal(find(r.changes, 'removed', 'Theme › mode Dark')!.severity, 'breaking');
  assert.equal(find(r.changes, 'removed', 'Theme › legacy/unused')!.severity, 'review', 'unused: worth a look, not breaking');
  assert.equal(find(r.changes, 'removed', 'Button › property Icon')!.severity, 'breaking');
  assert.equal(find(r.changes, 'removed', 'Other')!.severity, 'review');
});

test('no changes', () => {
  const r = diff(figmaNow, figmaNow);
  assert.equal(r.changes.length, 0);
  assert.match(renderText(r), /No changes/);
});

test('renderers', () => {
  const r = diff(incoming, figmaNow);
  const md = renderMarkdown(r);
  assert.match(md, /🔴 Will break things \(3\)/);
  assert.match(md, /<details><summary>🟢 Safe/);
  assert.match(md, /color\/danger → color\/error \(14 layers\)/);
  const html = renderHtmlPage(r);
  assert.match(html, /<i class="sw" style="background:#4338ca"><\/i>/);
  assert.doesNotMatch(html, /<script/);
});

test('default mode renamed, not added: values compared across it', () => {
  const t: Snapshot = { source: 'Figma', styles: [], components: [], collections: [{ name: 'Theme', modes: ['Mode 1'], variables: [
    { name: 'bg', type: 'COLOR', values: { 'Mode 1': col('#ffffff') } },
  ] }] };
  const s: Snapshot = { source: 'src', styles: [], components: [], collections: [{ name: 'Theme', modes: ['Light', 'Dark'], variables: [
    { name: 'bg', type: 'COLOR', values: { Light: col('#fafafa'), Dark: col('#000000') } },
  ] }] };
  const subjects = diff(s, t).changes.map((c) => `${c.kind}:${c.subject}`);
  assert.deepEqual(subjects.sort(), ['added:Theme › mode Dark', 'changed:Theme › bg', 'renamed:Theme › mode Mode 1 → Light'].sort());
  const bg = diff(s, t).changes.find((c) => c.subject === 'Theme › bg')!;
  assert.deepEqual(bg.rows, [{ label: 'Light', before: '#ffffff', after: '#fafafa' }]);
});
