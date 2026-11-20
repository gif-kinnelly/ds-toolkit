/**
 * GitHub Action: compares design tokens/specs in the repo with Figma and
 * reports drift on the job summary and as one sticky PR comment.
 *
 * Figma side, either:
 *  - figma-snapshot: a snapshot committed from the Import Preview plugin (any plan), or
 *  - figma-file-key + FIGMA_TOKEN: the live file via the REST variables API (Enterprise).
 */
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load, type InputFile } from './adapters/load';
import { fromFigmaRest, type RestVariablesResponse } from './adapters/figma-rest';
import { diff, type Severity } from './core/diff';
import { renderMarkdown } from './core/render';
import type { Snapshot } from './core/snapshot';

const MARKER = '<!-- ds-toolkit:drift -->';

export const input = (name: string, fallback = '') =>
  (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim() || fallback;

function files(paths: string[]): InputFile[] {
  const out: InputFile[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const f = join(d, e.name);
          if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(f);
          else if (e.isFile() && e.name.endsWith('.json')) out.push({ path: relative(p, f) || e.name, text: readFileSync(f, 'utf8') });
        }
      };
      walk(p);
    } else out.push({ path: p, text: readFileSync(p, 'utf8') });
  }
  return out;
}

const list = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export async function figmaRest(fileKey: string, token: string, fetcher: typeof fetch = fetch): Promise<Snapshot> {
  const res = await fetcher(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/variables/local`, { headers: { 'X-Figma-Token': token } });
  if (res.status === 403) throw new Error('Figma refused the variables API (403). It needs an Enterprise plan and a token with the file_variables:read scope. On other plans, commit a snapshot from the Import Preview plugin and use figma-snapshot instead.');
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return fromFigmaRest((await res.json()) as RestVariablesResponse, `Figma file ${fileKey}`);
}

/** Creates or updates the one comment this action owns on the PR. */
export async function comment(body: string, ctx: { repo: string; pr: number; token: string; api?: string }, fetcher: typeof fetch = fetch) {
  const api = ctx.api ?? 'https://api.github.com';
  const h = { Authorization: `Bearer ${ctx.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const full = `${MARKER}\n${body}`;
  for (let page = 1; page < 20; page++) {
    const res = await fetcher(`${api}/repos/${ctx.repo}/issues/${ctx.pr}/comments?per_page=100&page=${page}`, { headers: h });
    if (!res.ok) throw new Error(`GitHub API ${res.status} listing comments`);
    const items = (await res.json()) as { id: number; body?: string }[];
    const mine = items.find((c) => c.body?.startsWith(MARKER));
    if (mine) {
      const u = await fetcher(`${api}/repos/${ctx.repo}/issues/comments/${mine.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ body: full }) });
      if (!u.ok) throw new Error(`GitHub API ${u.status} updating comment`);
      return 'updated';
    }
    if (items.length < 100) break;
  }
  const c = await fetcher(`${api}/repos/${ctx.repo}/issues/${ctx.pr}/comments`, { method: 'POST', headers: h, body: JSON.stringify({ body: full }) });
  if (!c.ok) throw new Error(`GitHub API ${c.status} creating comment (does the workflow have pull-requests: write?)`);
  return 'created';
}

export async function main(env = process.env): Promise<number> {
  const source = list(input('source'));
  if (!source.length) throw new Error('Set `source` to the token or spec files/folders in the repo.');
  const snapshotPath = input('figma-snapshot');
  const fileKey = input('figma-file-key');
  const figmaToken = env.FIGMA_TOKEN ?? input('figma-token');
  if (!snapshotPath && !fileKey) throw new Error('Set `figma-snapshot` (a committed snapshot) or `figma-file-key` (with FIGMA_TOKEN, Enterprise only).');

  const collection = input('collection') || undefined;
  const code = load(files(source), { collection });
  const figmaSide = snapshotPath ? load(files([snapshotPath]), { collection }) : await figmaRest(fileKey, figmaToken ?? '');
  // Drift = what syncing code into Figma would change.
  const r = diff(code, figmaSide, { missing: input('missing', 'keep') === 'remove' ? 'remove' : 'keep', wholeFile: input('whole-file') === 'true' });
  const title = input('title', 'Design system drift: code → Figma');
  const md = renderMarkdown(r, { title });

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `breaking=${r.counts.breaking}\nreview=${r.counts.review}\nsafe=${r.counts.safe}\nchanges=${r.changes.length}\n`);
  console.log(md);

  // Sticky PR comment, only on pull requests and only when there's something to say (or to clear).
  if (input('comment', 'true') === 'true' && env.GITHUB_EVENT_NAME?.startsWith('pull_request') && env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { pull_request?: { number: number } };
    const token = input('github-token') || env.GITHUB_TOKEN;
    if (ev.pull_request && token) {
      try {
        const how = await comment(r.changes.length ? md : `### ${title}\n\nNo drift: Figma matches the repo. ✅`, { repo: env.GITHUB_REPOSITORY!, pr: ev.pull_request.number, token, api: env.GITHUB_API_URL });
        console.log(`PR comment ${how}.`);
      } catch (e) {
        // A fork PR's token can't comment; that shouldn't fail the check.
        console.log(`::warning::Couldn't comment on the PR: ${(e as Error).message}`);
      }
    }
  }

  const failOn = input('fail-on', 'never') as Severity | 'never';
  if (failOn === 'breaking' && r.counts.breaking) { console.log(`::error::${r.counts.breaking} breaking change(s) between code and Figma.`); return 1; }
  if (failOn === 'review' && (r.counts.breaking || r.counts.review)) { console.log(`::error::${r.counts.breaking + r.counts.review} change(s) need review.`); return 1; }
  return 0;
}

if (process.env.GITHUB_ACTIONS === 'true' || process.argv.includes('--run')) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.log(`::error::${(e as Error).message}`); process.exitCode = 1; });
}
