// End-to-end: loads the built Import Preview plugin in Chrome with a mock file,
// drops DTCG files on it, previews, and checks what it reports.
// Run: npm run build && node test/e2e/import-preview.e2e.mjs [screenshot.png]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const harness = (await build({ entryPoints: ['test/e2e/harness.ts'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text;
const code = readFileSync('dist/import-preview/code.js', 'utf8');
const ui = readFileSync('dist/import-preview/ui.html', 'utf8');

const dir = mkdtempSync(join(tmpdir(), 'ip-'));
const files = {
  'Theme/Light.tokens.json': {
    color: {
      primary: { $type: 'color', $value: '{palette.indigo.700}' },
      error: { $type: 'color', $value: '{palette.red.600}' }, // renamed from color/danger
    },
    radius: { md: { $type: 'string', $value: '6px' } }, // was a number
  },
  'Theme/Dark.tokens.json': {
    color: {
      primary: { $type: 'color', $value: '#818cf8' },
      error: { $type: 'color', $value: '#f87171' },
    },
    radius: { md: { $type: 'string', $value: '6px' } },
  },
  'Primitives/Value.tokens.json': {
    palette: { indigo: { 600: { $type: 'color', $value: '#4f46e5' }, 700: { $type: 'color', $value: '#4338ca' } }, red: { 600: { $type: 'color', $value: '#dc2626' } } },
  },
};
const paths = [];
for (const [name, json] of Object.entries(files)) {
  const p = join(dir, name.replace('/', '__'));
  writeFileSync(p, JSON.stringify(json));
  paths.push({ p, name });
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 500, height: 960 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
await page.setContent('<!DOCTYPE html><body style="margin:20px;background:#f5f5f5"></body>');
await page.addScriptTag({ content: harness });
await page.evaluate(([c, u]) => { window.demoFile(); window.run(c, u); }, [code, ui]);
await page.waitForFunction(() => window.__ready);
const f = page.frameLocator('iframe');

// The browser can't set webkitRelativePath from a test, so give files their folder via the DataTransfer name.
await f.locator('#drop').evaluate(async (drop, list) => {
  const dt = new DataTransfer();
  for (const { name, text } of list) dt.items.add(new File([text], name, { type: 'application/json' }));
  drop.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
}, paths.map(({ p, name }) => ({ name, text: readFileSync(p, 'utf8') })));

await f.locator('#loaded').filter({ hasText: 'variables' }).waitFor();
const loaded = await f.locator('#loaded').textContent();
console.log('loaded:', loaded);
await f.locator('#go').click();
await f.locator('.sum').waitFor();

const summary = await f.locator('.sum').textContent();
const items = await f.locator('.sev li').evaluateAll((lis) => lis.map((li) => li.querySelector('.hd').textContent.replace(/\s+/g, ' ').trim()));
console.log(summary);
for (const i of items) console.log('  ', i);

assert.match(summary, /2 breaking/);
assert.ok(items.some((i) => /retyped.*radius\/md.*31 layers/.test(i)), 'retype with usage');
assert.ok(items.some((i) => /renamed.*color\/danger → color\/error.*12 layers/.test(i)), 'rename with usage');
assert.ok(items.some((i) => /changed.*Theme › color\/primary.*19 layers/.test(i)), 'value change with usage');
assert.ok(items.some((i) => /added.*palette\/indigo\/700/.test(i)));

// Copy-as-markdown and the report download exist once there are changes.
assert.equal(await f.locator('#actions').isVisible(), true);

const shot = process.argv[2];
if (shot) { await f.locator('details.sev-safe > summary').click(); await page.locator('iframe').screenshot({ path: shot }); console.log('screenshot:', shot); }
await browser.close();
console.log(process.exitCode ? 'FAILED' : 'e2e ok');
