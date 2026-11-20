import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, comment, figmaRest } from '../src/action';
import type { Snapshot } from '../src/core/snapshot';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  mkdirSync(join(dir, 'tokens/Theme'), { recursive: true });
  writeFileSync(join(dir, 'tokens/Theme/Light.tokens.json'), JSON.stringify({ color: { primary: { $type: 'color', $value: '#4338ca' }, error: { $type: 'color', $value: '#dc2626' } } }));
  const snap: Snapshot = {
    source: 'Figma: DS', hasUsage: true, styles: [], components: [],
    collections: [{ name: 'Theme', modes: ['Light'], variables: [
      { name: 'color/primary', type: 'COLOR', values: { Light: { kind: 'color', hex: '#4f46e5' } }, usage: 40 },
      { name: 'color/danger', type: 'COLOR', values: { Light: { kind: 'color', hex: '#dc2626' } }, usage: 9 },
    ] }],
  };
  writeFileSync(join(dir, 'figma-snapshot.json'), JSON.stringify(snap));
  writeFileSync(join(dir, 'summary.md'), '');
  writeFileSync(join(dir, 'output.txt'), '');
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 7 } }));
  return dir;
}

/** Minimal GitHub API: one page of comments, records writes. */
function fakeGitHub(existing: { id: number; body: string }[] = []) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body as string | undefined });
    const json = method === 'GET' ? existing : { id: 99 };
    return new Response(JSON.stringify(json), { status: method === 'POST' ? 201 : 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

async function withEnv(env: Record<string, string>, fn: () => Promise<number>) {
  const saved = { ...process.env };
  const log = console.log;
  console.log = () => {};
  Object.assign(process.env, env);
  try { return await fn(); } finally { process.env = saved; console.log = log; }
}

test('reports drift to the job summary and outputs; fail-on breaking', async () => {
  const dir = workspace();
  const gh = fakeGitHub();
  const saved = globalThis.fetch;
  globalThis.fetch = gh.fetcher;
  try {
    const code = await withEnv({
      INPUT_SOURCE: join(dir, 'tokens'), 'INPUT_FIGMA-SNAPSHOT': join(dir, 'figma-snapshot.json'), 'INPUT_FAIL-ON': 'breaking',
      GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), GITHUB_OUTPUT: join(dir, 'output.txt'),
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_REPOSITORY: 'acme/ds', GITHUB_TOKEN: 't',
    }, () => main());
    assert.equal(code, 1, 'the rename of a used variable is breaking');
    const summary = readFileSync(join(dir, 'summary.md'), 'utf8');
    assert.match(summary, /Design system drift: code → Figma/);
    assert.match(summary, /color\/danger → color\/error \(9 layers\)/);
    assert.match(summary, /color\/primary \(40 layers\)/);
    assert.equal(readFileSync(join(dir, 'output.txt'), 'utf8'), 'breaking=1\nreview=1\nsafe=0\nchanges=2\n');
    const post = gh.calls.find((c) => c.method === 'POST')!;
    assert.match(post.url, /repos\/acme\/ds\/issues\/7\/comments$/);
    assert.match(JSON.parse(post.body!).body, /^<!-- ds-toolkit:drift -->/);
  } finally { globalThis.fetch = saved; }
});

test('the PR comment is updated in place, not duplicated', async () => {
  const gh = fakeGitHub([{ id: 1, body: 'hello' }, { id: 5, body: '<!-- ds-toolkit:drift -->\nold' }]);
  const how = await comment('new', { repo: 'acme/ds', pr: 7, token: 't' }, gh.fetcher);
  assert.equal(how, 'updated');
  const patch = gh.calls.find((c) => c.method === 'PATCH')!;
  assert.match(patch.url, /issues\/comments\/5$/);
  assert.equal(gh.calls.filter((c) => c.method === 'POST').length, 0);
});

test('no fail by default; a clear error without a Figma side', async () => {
  const dir = workspace();
  assert.equal(await withEnv({ INPUT_SOURCE: join(dir, 'tokens'), 'INPUT_FIGMA-SNAPSHOT': join(dir, 'figma-snapshot.json'), INPUT_COMMENT: 'false' }, () => main()), 0);
  await assert.rejects(withEnv({ INPUT_SOURCE: join(dir, 'tokens') }, () => main()), /figma-snapshot.*figma-file-key/);
});

test('REST: a 403 explains the Enterprise requirement', async () => {
  const f = (async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(figmaRest('KEY', 'tok', f), /Enterprise plan.*figma-snapshot/);
});
