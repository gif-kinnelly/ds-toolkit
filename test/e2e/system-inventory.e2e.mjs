// End-to-end: System Inventory in Chrome against a mock file built without a system.
// Run: npm run build && node test/e2e/system-inventory.e2e.mjs [screenshot.png]
import assert from 'node:assert/strict';
import { openPlugin } from './browser.mjs';

const { browser, page, frame: f, errors } = await openPlugin('system-inventory', 'inventoryFile', { height: 1300 });

await f.locator('#scan').click();
await f.locator('.sum').waitFor();
const sum = await f.locator('.sum').textContent();
console.log(sum);
const chips = async (heading) => (await f.locator(`h3:has-text("${heading}") + .chips .chip`).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const colors = (await f.locator('.fam').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
console.log('colors:', colors);
console.log('spacing:', await chips('Spacing'));
console.log('radius:', await chips('Radius'));
console.log('font size:', await chips('Font size'));
const type = (await f.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
console.log('type:', type);

assert.match(sum, /3 near-duplicates merged/, '#4f47e6, #5046e4 into #4f46e5; #fefefe into #ffffff');
assert.ok(colors.some((c) => /^indigo .*#4f46e5 ×10 \+2/.test(c)), 'brand color with its two near-duplicates');
assert.ok(colors.some((c) => /^white .*#ffffff ×\d+ \+1/.test(c)));
assert.ok(colors.some((c) => /^green /.test(c) && c.includes('#15803d') && c.includes('#dcfce7')), 'badge text and background in one family');
assert.ok(colors.some((c) => /^red /.test(c) && c.includes('#b91c1c') && c.includes('#fee2e2')));
assert.ok(colors.some((c) => /^gray /.test(c)));
const spacing = await chips('Spacing');
assert.ok(spacing.some((c) => /^4 16px ×\d+ \+1$/.test(c)), '15px snaps to 16');
assert.ok(spacing.some((c) => /^22px ×1 off-grid$/.test(c)), '22px is off-grid');
const radius = await chips('Radius');
assert.deepEqual(radius.map((c) => c.split(' ')[0]), ['sm', 'md', 'full'], '7px snaps to 8px (radius/md); 9999 is full');
assert.ok(type.some((t) => /^heading-xl Inter 700 24 \/ 32 1$/.test(t)));
assert.deepEqual(type.map((t) => t.split(' ')[0]), ['title-lg', 'body-md', 'label-md', 'label-sm', 'heading-xl']);
assert.ok((await chips('Spacing')).includes('0.5 2px ×10'), '2px is half a grid step');

const shot = process.argv[2];
if (shot) { await page.locator('iframe').screenshot({ path: shot }); console.log('screenshot:', shot); }

// Create the variables and text styles.
await f.locator('#create').click();
await f.locator('.next').waitFor();
console.log(await f.locator('.next').textContent());
const made = await page.evaluate(async () => {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const vars = await figma.variables.getLocalVariablesAsync();
  const styles = await figma.getLocalTextStylesAsync();
  const c = cols.find((x) => x.name === 'Inventory');
  return {
    modes: c.modes.map((m) => m.name),
    names: vars.map((v) => v.name),
    scopes: Object.fromEntries(vars.map((v) => [v.name.split('/')[0], v.scopes.join()])),
    styles: styles.map((s) => [s.name, s.fontName.style, s.lineHeight.value, !!s.boundVariables.fontSize]),
    undo: window.__mock.undo.commits,
  };
});
assert.deepEqual(made.modes, ['Value']);
assert.ok(made.names.includes('space/4') && made.names.includes('radius/full') && made.names.includes('font-size/md'));
assert.ok(!made.names.some((n) => n.startsWith('space/5.5')), 'off-grid 22px is not a token');
assert.deepEqual(made.scopes, { palette: 'ALL_SCOPES', space: 'GAP', radius: 'CORNER_RADIUS', 'font-size': 'FONT_SIZE' });
assert.ok(made.styles.some(([n, st, lh, bound]) => n === 'typography/heading-xl' && st === 'Bold' && lh === 32 && bound));
assert.equal(made.undo, 1);

// Creating again with the same name is refused, not duplicated.
await f.locator('#create').click();
await f.locator('#status.error').waitFor();
assert.match(await f.locator('#status').textContent(), /already exists/);

assert.deepEqual(errors, []);
await browser.close();
console.log('e2e ok');
