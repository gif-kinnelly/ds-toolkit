import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildManifest, usesOf } from '../src/agent/manifest';
import { load } from '../src/adapters/load';

const ex = (p: string) => ({ path: p, text: readFileSync(`examples/tokens/${p}`, 'utf8') });

test('tiers: aliased collections are semantic, their targets are lower tiers', () => {
  const snap = load([ex('Primitives/Value.tokens.json'), ex('Theme/Light.tokens.json'), ex('Theme/Dark.tokens.json')]);
  const { json, markdown } = buildManifest(snap, [], { title: 'Example' });
  assert.deepEqual(json.collections.map((c) => [c.name, c.role]), [['Primitives', 'primitive'], ['Theme', 'semantic']]);
  assert.match(json.rules[1], /Use semantic tokens \("Theme"\)\. "Primitives" is a lower tier .* don't use `palette\/\*` directly/);
  assert.match(markdown, /\| `color\/primary` \| fills, accents \| `\{palette\/indigo\/700\} = #4338ca` \| `\{palette\/indigo\/400\} = #818cf8` \|/);
  assert.match(markdown, /## Tokens: Primitives \(lower tier: don't use directly\)\n\n`palette\/indigo` \(3\)/);
  // Semantic tokens come first in the file.
  assert.ok(markdown.indexOf('## Tokens: Theme') < markdown.indexOf('## Tokens: Primitives'));
});

test('use-for: scopes win; otherwise inferred from the name', () => {
  const v = (name: string, scopes?: string[]) => ({ name, type: 'COLOR', values: {}, ...(scopes ? { scopes } : {}) });
  assert.deepEqual(usesOf(v('color/x', ['TEXT_FILL'])), ['text color']);
  assert.deepEqual(usesOf(v('color/text-muted')), ['text color']);
  assert.deepEqual(usesOf(v('color/primary-fg')), ['text color']);
  assert.deepEqual(usesOf(v('color/danger-bg')), ['backgrounds']);
  assert.deepEqual(usesOf(v('color/border')), ['borders']);
  assert.deepEqual(usesOf({ ...v('space/4'), type: 'FLOAT' }), ['spacing (gap, padding)']);
});
