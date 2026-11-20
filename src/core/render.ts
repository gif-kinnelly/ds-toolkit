import type { Change, DiffResult, Severity } from './diff';

const HEAD: Record<Severity, string> = { breaking: 'Will break things', review: 'Worth a look', safe: 'Safe' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function summary(r: DiffResult): string {
  if (!r.changes.length) return 'No changes: Figma already matches the source.';
  const parts = [];
  if (r.counts.breaking) parts.push(`${r.counts.breaking} breaking`);
  if (r.counts.review) parts.push(`${r.counts.review} to review`);
  if (r.counts.safe) parts.push(`${r.counts.safe} safe`);
  return `${plural(r.changes.length, 'change')}: ${parts.join(', ')}.`;
}

const impact = (c: Change) => (c.impact ? ` (${plural(c.impact.count, c.impact.unit.replace(/s$/, ''))})` : '');

export function renderText(r: DiffResult): string {
  const lines = [`${r.source} → ${r.target}`, summary(r)];
  for (const sev of ['breaking', 'review', 'safe'] as Severity[]) {
    const list = r.changes.filter((c) => c.severity === sev);
    if (!list.length) continue;
    lines.push('', `${HEAD[sev].toUpperCase()} (${list.length})`);
    for (const c of list) {
      lines.push(`  [${c.kind}] ${c.subject}${impact(c)}`, `      ${c.detail}`);
      for (const row of c.rows ?? []) lines.push(`      ${row.label}: ${row.before} → ${row.after}`);
    }
  }
  if (!r.hasUsage) lines.push('', 'Usage unknown: the target isn\'t a live Figma file, so impact counts are missing.');
  return lines.join('\n');
}

const md = (s: string) => s.replace(/([|*_`<>])/g, '\\$1');

export function renderMarkdown(r: DiffResult, opts: { title?: string; maxSafe?: number } = {}): string {
  const out = [`### ${opts.title ?? 'Design system changes'}`, '', `**${summary(r)}** \`${md(r.source)}\` → \`${md(r.target)}\``];
  for (const sev of ['breaking', 'review', 'safe'] as Severity[]) {
    let list = r.changes.filter((c) => c.severity === sev);
    if (!list.length) continue;
    const icon = sev === 'breaking' ? '🔴' : sev === 'review' ? '🟡' : '🟢';
    const body: string[] = ['', '| | Change | What happens |', '|---|---|---|'];
    const max = sev === 'safe' ? opts.maxSafe ?? 50 : Infinity;
    const more = list.length - max;
    if (more > 0) list = list.slice(0, max);
    for (const c of list) {
      const rows = (c.rows ?? []).map((x) => `<br>${md(x.label)}: \`${md(x.before)}\` → \`${md(x.after)}\``).join('');
      body.push(`| ${c.kind} | ${md(c.subject)}${impact(c)} | ${md(c.detail)}${rows} |`);
    }
    if (more > 0) body.push(`| | …and ${more} more | |`);
    out.push('', sev === 'safe'
      ? `<details><summary>${icon} ${HEAD[sev]} (${r.counts[sev]})</summary>\n${body.join('\n')}\n\n</details>`
      : `#### ${icon} ${HEAD[sev]} (${r.counts[sev]})\n${body.join('\n')}`);
  }
  if (!r.hasUsage) out.push('', '_Impact counts need a snapshot exported from Figma with usage._');
  return out.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
/** A swatch for a value that is, or ends in, a hex color ("{palette/x} #4338ca"). */
const swatch = (v: string) => { const m = /(#[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i.exec(v); return m ? `<i class="sw" style="background:${m[1]}"></i>` : ''; };

/** The change list as an HTML fragment; styles are in REPORT_CSS. */
export function renderHtmlFragment(r: DiffResult): string {
  if (!r.changes.length) return `<p class="empty">${esc(summary(r))}</p>`;
  const parts = [`<p class="sum">${esc(summary(r))}</p>`];
  for (const sev of ['breaking', 'review', 'safe'] as Severity[]) {
    const list = r.changes.filter((c) => c.severity === sev);
    if (!list.length) continue;
    const items = list.map((c) => {
      const rows = c.rows?.length
        ? `<table>${c.rows.map((x) => `<tr><th>${esc(x.label)}</th><td>${swatch(x.before)}${esc(x.before)}</td><td>→</td><td>${swatch(x.after)}${esc(x.after)}</td></tr>`).join('')}</table>`
        : '';
      const imp = c.impact ? `<span class="imp">${esc(plural(c.impact.count, c.impact.unit.replace(/s$/, '')))}</span>` : '';
      return `<li><div class="hd"><span class="k k-${c.kind}">${c.kind}</span><b>${esc(c.subject)}</b>${imp}</div><div class="dt">${esc(c.detail)}</div>${rows}</li>`;
    }).join('');
    parts.push(`<details class="sev sev-${sev}"${sev === 'safe' ? '' : ' open'}><summary>${HEAD[sev]} <span>${list.length}</span></summary><ul>${items}</ul></details>`);
  }
  if (!r.hasUsage) parts.push('<p class="note">Impact counts need a live Figma file or a snapshot exported with usage.</p>');
  return parts.join('');
}

/** Uses Figma's theme variables when present (in a plugin), with light fallbacks elsewhere. */
export const REPORT_CSS = `
.sum{font-weight:600;margin:0 0 10px}
.empty,.note{color:var(--figma-color-text-secondary,#666)}
.sev{border:1px solid var(--figma-color-border,#e5e5e5);border-radius:8px;margin-bottom:10px;overflow:hidden}
.sev>summary{cursor:pointer;padding:8px 10px;font-weight:600;list-style:none;display:flex;justify-content:space-between}
.sev>summary span{font-variant-numeric:tabular-nums;opacity:.7}
.sev-breaking>summary{background:var(--figma-color-bg-danger-tertiary,#fde8e8);color:var(--figma-color-text-danger,#b42318)}
.sev-review>summary{background:var(--figma-color-bg-warning-tertiary,#fff4d6);color:var(--figma-color-text-warning,#8a5a00)}
.sev-safe>summary{background:var(--figma-color-bg-success-tertiary,#e7f6ec);color:var(--figma-color-text-success,#1a7f37)}
.sev ul{list-style:none;margin:0;padding:0}
.sev li{padding:8px 10px;border-top:1px solid var(--figma-color-border,#eee)}
.hd{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.hd b{font-weight:600;word-break:break-word}
.k{font:600 10px/1 ui-monospace,monospace;text-transform:uppercase;padding:3px 5px;border-radius:4px;background:var(--figma-color-bg-secondary,#f0f0f0)}
.imp{margin-left:auto;font-size:11px;padding:2px 6px;border-radius:10px;background:var(--figma-color-bg-secondary,#f0f0f0)}
.dt{color:var(--figma-color-text-secondary,#555);margin-top:3px}
.sev table{margin-top:4px;font:11px ui-monospace,monospace;border-collapse:collapse}
.sev th{text-align:left;font-weight:500;padding-right:8px;color:var(--figma-color-text-secondary,#666)}
.sev td{padding:1px 4px 1px 0;overflow-wrap:anywhere;vertical-align:top}
.sev td:nth-child(3){color:var(--figma-color-text-tertiary,#999)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
`;

export function renderHtmlPage(r: DiffResult, title = 'Design system changes'): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1a1a1a}h1{font-size:20px;margin:0 0 4px}.src{color:#666;margin:0 0 16px;font-size:13px}${REPORT_CSS}</style></head>
<body><h1>${esc(title)}</h1><p class="src">${esc(r.source)} → ${esc(r.target)}</p>${renderHtmlFragment(r)}</body></html>`;
}
