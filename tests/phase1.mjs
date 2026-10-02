// Phase 1 walkthrough: photo -> draft -> edit -> post -> listing page.
// Run with the dev servers up: `npm run dev`, then `npm test`.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// Tiny valid 1x1 JPEG so the browser resize step has something real to decode.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgA//Z',
  'base64',
);

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });

try {
  await page.goto(BASE + '/#/');
  await page.getByRole('link', { name: 'Give something away' }).click();
  await page.setInputFiles('#photo-input', { name: 'chair.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await page.locator('.photo-grid img').first().waitFor();
  // Manual path first: skip the AI, land on the form, then Back must return to the photo step.
  await page.getByRole('button', { name: 'Fill in the details myself' }).click();
  await page.locator('#edit-form').waitFor();
  await page.getByText('Fill in the details yourself.').waitFor();
  await page.locator('#back-link').click();
  await page.getByRole('button', { name: 'Draft listing' }).waitFor();
  if ((await page.locator('.photo-grid img').count()) !== 1) throw new Error('photos should survive Back');

  // Photo remove then re-add.
  await page.locator('.thumb .remove').click();
  await page.locator('.add.big').waitFor();
  await page.setInputFiles('#photo-input', { name: 'chair.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await page.locator('.photo-grid img').first().waitFor();

  await page.getByRole('button', { name: 'Draft listing' }).click();
  await page.locator('#edit-form').waitFor({ timeout: 60000 });
  const notice = (await page.locator('.notice, p.muted').first().textContent()).trim();
  console.log('draft:', notice.includes('no API key') ? 'stub (no API key)' : notice.includes("doesn't look like a photo") ? 'real AI draft, flagged as not a photo (expected for the 1x1 test image)' : 'real AI draft');

  await page.fill('#f-title', 'Wooden dining chair');
  await page.fill('#f-desc', 'Solid oak chair, one small scratch on the back leg.');
  await page.selectOption('#f-cat', 'furniture');
  await page.selectOption('#f-cond', 'good');
  await page.getByRole('button', { name: 'Next: pickup' }).click();

  // Pickup step: public area, private address, availability windows, notes.
  await page.locator('#pickup-form').waitFor();
  await page.fill('#p-area', 'Bernal Heights');
  await page.fill('#p-address', '123 Example St');
  await page.fill('#p-notes', 'Porch pickup, any evening');
  // Posting with no window selected must be refused.
  await page.getByRole('button', { name: 'Post for free' }).click();
  await page.getByText('Pick at least one time window').waitFor();
  await page.locator('[data-slot="mon-eve"]').click();
  await page.locator('[data-slot="sat-am"]').click();
  // Back to details and forward again must keep what was typed.
  await page.locator('#back-link').click();
  await page.locator('#edit-form').waitFor();
  if ((await page.inputValue('#f-title')) !== 'Wooden dining chair') throw new Error('details lost on Back');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.locator('#pickup-form').waitFor();
  if ((await page.inputValue('#p-area')) !== 'Bernal Heights') throw new Error('pickup fields lost on Back');
  if ((await page.locator('.chip[aria-pressed="true"]').count()) !== 2) throw new Error('availability lost on Back');

  await page.getByRole('button', { name: 'Post for free' }).click();
  await page.waitForURL(/#\/listing\//);
  await page.getByRole('heading', { name: 'Wooden dining chair' }).waitFor();
  const price = await page.locator('.detail .price').textContent();
  if (price.trim() !== 'Free') throw new Error(`expected Free, got ${price}`);
  const pageText = await page.locator('main').textContent();
  if (!pageText.includes('Pickup in Bernal Heights')) throw new Error('area missing from listing');
  if (!pageText.includes('Mon evening') || !pageText.includes('Sat morning')) throw new Error('availability missing from listing');
  if (pageText.includes('123 Example St')) throw new Error('private address leaked onto the listing page');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings')));
  if (stored.length !== 1 || stored[0].price !== null || stored[0].status !== 'listed') {
    throw new Error('stored listing has wrong shape: ' + JSON.stringify(stored[0], null, 2).slice(0, 300));
  }
  const pk = stored[0].pickup;
  if (!pk || pk.area !== 'Bernal Heights' || pk.address !== '123 Example St' || pk.availability.length !== 2 || pk.notes !== 'Porch pickup, any evening') {
    throw new Error('stored pickup has wrong shape: ' + JSON.stringify(pk));
  }
  const giver = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.giver')));
  if (!giver || giver.area !== 'Bernal Heights' || giver.availability.length !== 2) throw new Error('giver defaults not saved');

  // Second listing via the manual path: pickup step must be prefilled from the defaults.
  await page.goto(BASE + '/#/new');
  await page.setInputFiles('#photo-input', { name: 'lamp.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await page.getByRole('button', { name: 'Fill in the details myself' }).click();
  await page.fill('#f-title', 'Desk lamp');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.locator('#pickup-form').waitFor();
  if ((await page.inputValue('#p-area')) !== 'Bernal Heights') throw new Error('area not prefilled from defaults');
  if ((await page.inputValue('#p-address')) !== '123 Example St') throw new Error('address not prefilled from defaults');
  if ((await page.locator('.chip[aria-pressed="true"]').count()) !== 2) throw new Error('availability not prefilled from defaults');

  await page.goto(BASE + '/#/');
  await page.getByText('Wooden dining chair').waitFor();
  await page.getByText('Bernal Heights').first().waitFor();

  fs.mkdirSync('tests/screens', { recursive: true });
  await page.screenshot({ path: 'tests/screens/home.png' });
  await page.getByText('Wooden dining chair').click();
  await page.screenshot({ path: 'tests/screens/listing.png', fullPage: true });
  console.log('PASS: photo -> manual/back -> draft -> details -> pickup -> post -> listing, defaults prefilled');
} catch (err) {
  console.error('FAIL:', err.message);
  await page.screenshot({ path: 'tests/screens/failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
