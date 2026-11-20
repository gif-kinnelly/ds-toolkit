/**
 * ds-toolkit diff <source files…> --against <target files…> [options]
 *
 * Compares what you're about to import (source) with what's there now (target):
 * DTCG files, Figma's variables export, a component spec, a Figma REST
 * variables response, or a snapshot exported by the Import Preview plugin.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load, type InputFile } from './adapters/load';
import { diff, type Severity } from './core/diff';
import { renderHtmlPage, renderMarkdown, renderText } from './core/render';

const HELP = `Usage: ds-toolkit diff <source…> --against <target…> [options]

Paths can be files or folders (folders are read recursively for *.json).

Options:
  --missing keep|remove   What your importer does with things only in the target (default keep)
  --whole-file            Also report collections/styles/components the source doesn't mention
  --collection <name>     Collection name for DTCG files not in a folder (default "Tokens")
  --format text|md|html   Output format (default text)
  --out <file>            Write the report to a file instead of stdout
  --fail-on breaking|review
                          Exit 1 if any change is at least this severe (for CI)
  --title <text>          Report title (md/html)
`;

function expand(paths: string[]): InputFile[] {
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

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd !== 'diff' || rest.includes('--help') || rest.includes('-h')) { process.stdout.write(HELP); return cmd === 'diff' || !cmd ? 0 : 2; }
  const src: string[] = [], tgt: string[] = [];
  const opt: Record<string, string | boolean> = {};
  let into = src;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--against') into = tgt;
    else if (a === '--whole-file') opt.whole = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = rest[++i];
    else into.push(a);
  }
  if (!src.length || !tgt.length) { process.stderr.write('Need source files and --against target files.\n\n' + HELP); return 2; }

  const collection = typeof opt.collection === 'string' ? opt.collection : undefined;
  const source = load(expand(src), { collection });
  const target = load(expand(tgt), { collection });
  const r = diff(source, target, { missing: opt.missing === 'remove' ? 'remove' : 'keep', wholeFile: !!opt.whole });
  const title = typeof opt.title === 'string' ? opt.title : undefined;
  const report = opt.format === 'md' ? renderMarkdown(r, { title }) : opt.format === 'html' ? renderHtmlPage(r, title) : renderText(r);
  if (typeof opt.out === 'string') writeFileSync(opt.out, report + '\n'); else process.stdout.write(report + '\n');
  for (const w of [...(source.warnings ?? []), ...(target.warnings ?? [])]) process.stderr.write(`warning: ${w}\n`);

  const failOn = opt['fail-on'] as Severity | undefined;
  if (failOn === 'breaking' && r.counts.breaking) return 1;
  if (failOn === 'review' && (r.counts.breaking || r.counts.review)) return 1;
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`ds-toolkit: ${(e as Error).message}\n`); process.exitCode = 2; }
