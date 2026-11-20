// Shared: open a built plugin in Chrome against a mock file set up by `setup` (a harness function name).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
({ chromium } = require('playwright-core'));

export async function openPlugin(plugin, setup, { height = 960 } = {}) {
  const harness = (await build({ entryPoints: ['test/e2e/harness.ts'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text;
  const code = readFileSync(`dist/${plugin}/code.js`, 'utf8');
  const ui = readFileSync(`dist/${plugin}/ui.html`, 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 560, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!DOCTYPE html><body style="margin:20px;background:#f5f5f5"></body>');
  await page.addScriptTag({ content: harness });
  await page.evaluate(([s, c, u, h]) => { window[s](); window.run(c, u); document.querySelector('iframe').style.height = h + 'px'; }, [setup, code, ui, height - 60]);
  await page.waitForFunction(() => window.__ready);
  return { browser, page, frame: page.frameLocator('iframe'), errors };
}
