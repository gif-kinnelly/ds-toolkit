// End-to-end: Component Docs in Chrome against a mock design system file.
// Run: npm run build && node test/e2e/component-docs.e2e.mjs [screenshot.png]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { openPlugin } from './browser.mjs';

const { browser, page, frame: f, errors } = await openPlugin('component-docs', 'docsFile', { height: 500 });

await f.locator('#page').filter({ hasText: '(2)' }).waitFor();
await f.locator('#page').click();
await f.locator('#status').filter({ hasText: 'Documented 2 components' }).waitFor();

/** The doc frames on the Components page, as text in reading order. */
const docs = () => page.evaluate(() => {
  const texts = (n) => (n.type === 'TEXT' ? [n.characters] : n.children.flatMap(texts));
  return window.__pages[0].children.filter((n) => n.getPluginData('ds_doc_for')).map((d) => ({ id: d.id, name: d.name, x: d.x, lines: texts(d) }));
});
let out = await docs();
assert.deepEqual(out.map((d) => d.name), ['Docs · Button', 'Docs · Badge']);
const button = out[0].lines.join('\n');
console.log(button);
assert.equal(out[0].x, 380, 'placed 80px right of the component');
assert.match(button, /^Button\n4 variants · 3 instances in this file\nTriggers an action/);
assert.match(button, /size\nvariant\nsm · md \(default\)/);
assert.match(button, /Label\ntext\nContinue/);
assert.match(button, /Show icon\nboolean\nfalse/);
assert.match(button, /color\/danger\nroot \(fill\)/, 'token used only by the danger variants is listed');
assert.match(button, /space\/4\nroot \(padding\)/, 'left+right padding collapse to one "padding"');
assert.match(button, /color\/on-primary\nLabel \(fill\)/);
assert.match(button, /typography\/label\ntext · Label/);
assert.match(button, /Not tokenized: Focus ring stroke\./);
assert.match(out[1].lines.join('\n'), /No description\./);

// Change the component, regenerate: the same frame updates; nothing is duplicated.
const before = out[0].id;
await page.evaluate(() => {
  const set = window.__pages[0].children[0];
  set.description = 'Starts an action.';
  set.componentPropertyDefinitions.size.variantOptions.push('lg');
});
await f.locator('#page').click();
await f.locator('#status').filter({ hasText: 'Documented' }).waitFor();
await page.waitForTimeout(100);
out = await docs();
assert.equal(out.length, 2);
assert.equal(out[0].id, before, 'same frame');
assert.match(out[0].lines.join('\n'), /Starts an action\./);
assert.match(out[0].lines.join('\n'), /sm · md \(default\) · lg/);

// Markdown for the repo.
await f.locator('#mdFile').click();
await f.locator('#status').filter({ hasText: 'Downloaded docs for 2 components' }).waitFor();
const md = await f.locator('body').evaluate(() => window.__lastMarkdown);
console.log(md);
assert.match(md, /^# Acme DS components/);
assert.match(md, /\| size \| variant \| `sm` \*\*`md`\*\* `lg` \|/);
assert.match(md, /- `space\/4` _\(Theme\)_: root \(padding\)/);
assert.match(md, /> ⚠️ Not tokenized: Focus ring stroke\./);

const shot = process.argv[2];
if (shot) {
  // Draw the generated Button doc frame as HTML so it can be looked at.
  const html = await page.evaluate(() => {
    const d = window.__pages[0].children.find((n) => n.name === 'Docs · Button');
    const css = (n) => (n.fontSize ? `font-size:${n.fontSize}px;font-weight:${/Bold/.test(n.fontName?.style) ? (n.fontName.style === 'Bold' ? 700 : 600) : 400};color:rgb(${n.fills[0].color.r * 255},${n.fills[0].color.g * 255},${n.fills[0].color.b * 255});` : '');
    const draw = (n) => n.type === 'TEXT'
      ? `<div style="${css(n)}${n.width && n.layoutSizingHorizontal !== 'FILL' ? `width:${n.width}px;flex:none;` : 'flex:1;'}">${n.characters}</div>`
      : `<div style="display:flex;flex-direction:${n.layoutMode === 'HORIZONTAL' ? 'row' : 'column'};gap:${n.itemSpacing}px;padding:${n.paddingTop ?? 0}px ${n.paddingRight ?? 0}px ${n.paddingBottom ?? 0}px ${n.paddingLeft ?? 0}px;${n.strokeBottomWeight ? 'border-bottom:1px solid #e6e6eb;' : ''}${n === d ? `width:${d.width}px;background:#fff;border:1px solid #e6e6eb;border-radius:12px;box-sizing:border-box;` : ''}">${n.children.map(draw).join('')}</div>`;
    return `<body style="margin:24px;background:#f0f0f0;font-family:Inter,system-ui,sans-serif;line-height:1.4">${draw(d)}</body>`;
  });
  const p2 = await browser.newPage({ viewport: { width: 620, height: 900 }, deviceScaleFactor: 2 });
  await p2.setContent(html);
  await p2.screenshot({ path: shot, fullPage: true });
  console.log('screenshot:', shot);
}

assert.deepEqual(errors, []);
await browser.close();
console.log('e2e ok');
