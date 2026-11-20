// End-to-end: Brand Inheritance in Chrome against a mock multi-brand file.
// Run: npm run build && node test/e2e/brand-inheritance.e2e.mjs [screenshot.png]
import assert from 'node:assert/strict';
import { openPlugin } from './browser.mjs';

const { browser, page, frame: f, errors } = await openPlugin('brand-inheritance', 'brandFile', { height: 1100 });
const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const value = (v, m, set) => page.evaluate(([v, m, s]) => window.value(v, m, s), [v, m, set]);
const rows = () => f.locator('#modes tbody tr');
const status = () => f.locator('#status').textContent();

await rows().first().waitFor();
assert.equal(await rows().count(), 3);
assert.equal(await f.locator('#sync').isDisabled(), true, 'nothing to sync before any mode has a parent');

// Link Acme and Zen to Base. Acme's primary differs from Base, so it becomes an override.
await rows().nth(1).locator('select').selectOption({ label: 'Base' });
await f.locator('#modes tbody tr:nth-child(2) td.num').first().filter({ hasText: /\d/ }).waitFor();
await rows().nth(2).locator('select').selectOption({ label: 'Base' });
await f.locator('#modes tbody tr:nth-child(3) td.num').first().filter({ hasText: /\d/ }).waitFor();
const stats = async (i) => (await rows().nth(i).locator('td.num').allTextContents()).map(Number);
assert.deepEqual(await stats(1), [1, 3], 'Acme: primary is an override; surface, radius, font inherited');
assert.deepEqual(await stats(2), [1, 3], 'Zen: surface is an override');
assert.match(await f.locator('#pending').textContent(), /in sync/);

// The base changes, and someone edits Zen's radius by hand.
await value('color/primary', 'Base', { r: 0.263, g: 0.22, b: 0.792, a: 1 }); // #4338ca
await value('radius/md', 'Base', 8);
await value('radius/md', 'Zen', 12);
await f.locator('#col').dispatchEvent('change'); // reload, as reopening the plugin would
await f.locator('#pending label').first().waitFor();
const pending = (await f.locator('#pending label').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
console.log('pending:', pending);
assert.equal(pending.length, 2);
assert.ok(pending.some((t) => /color\/primary in Zen #4f46e5 → #4338ca base changed/.test(t)));
assert.ok(pending.some((t) => /radius\/md in Acme 6 → 8 base changed/.test(t)));
assert.match(await f.locator('#noticed').textContent(), /radius\/md \(Zen\)/, 'hand edit noticed, not overwritten');

// Keep Zen's primary as an override; sync the rest.
await f.locator('#pending label', { hasText: 'in Zen' }).locator('input').check();
await f.locator('#sync').click();
await f.locator('#pending').filter({ hasText: 'in sync' }).waitFor();
assert.equal(hex(await value('color/primary', 'Zen')), '#4f46e5', 'kept as override');
assert.equal(await value('radius/md', 'Acme'), 8, 'followed base');
assert.equal(await value('radius/md', 'Zen'), 12, 'hand edit kept');
assert.equal(hex(await value('color/primary', 'Acme')), '#e11d48', 'existing override untouched');
assert.deepEqual(await stats(2), [3, 1], 'Zen now has 3 overrides');

// Reset Zen's radius back to inheriting.
await f.locator('#overrides label', { hasText: 'radius/md' }).locator('input').check();
await f.locator('#sync').click();
await f.locator('#overrides label', { hasText: 'radius/md' }).waitFor({ state: 'detached' });
assert.equal(await value('radius/md', 'Zen'), 8);

// Add a brand that inherits from Acme: starts as a full copy, all inherited.
await f.locator('#newName').fill('Acme Kids');
await f.locator('#newParent').selectOption({ label: 'Acme' });
await f.locator('#add').click();
await rows().nth(3).waitFor();
assert.deepEqual(await stats(3), [0, 4]);
assert.match(await f.locator('#col option').first().textContent(), /4 modes/);
assert.equal(hex(await value('color/primary', 'Acme Kids')), '#e11d48');

// Base change reaches the grandchild in one sync.
await value('font/family', 'Base', 'Geist');
await f.locator('#col').dispatchEvent('change');
await f.locator('#pending label').nth(2).waitFor();
assert.equal(await f.locator('#pending label').count(), 3, 'Acme, Zen and Acme Kids');
await f.locator('#sync').click();
await f.locator('#pending').filter({ hasText: 'in sync' }).waitFor();
assert.equal(await value('font/family', 'Acme Kids'), 'Geist');

// The plan's mode limit (4 in this file) comes back as a readable error.
await f.locator('#newName').fill('Fifth');
await f.locator('#add').click();
await f.locator('#status.error').waitFor();
assert.match(await status(), /plan may limit modes/);

// For the screenshot: a pending change and an override list.
await value('color/surface', 'Base', { r: 0.98, g: 0.98, b: 0.98, a: 1 });
await f.locator('#col').dispatchEvent('change');
await f.locator('#pending label').first().waitFor();
const shot = process.argv[2];
if (shot) { await page.locator('iframe').screenshot({ path: shot }); console.log('screenshot:', shot); }

assert.deepEqual(errors, []);
await browser.close();
console.log('e2e ok');
