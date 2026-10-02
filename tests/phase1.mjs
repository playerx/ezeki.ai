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
  await page.fill('#f-pickup', 'Porch pickup, any evening');

  await page.getByRole('button', { name: 'Post for free' }).click();
  await page.waitForURL(/#\/listing\//);
  await page.getByRole('heading', { name: 'Wooden dining chair' }).waitFor();
  const price = await page.locator('.detail .price').textContent();
  if (price.trim() !== 'Free') throw new Error(`expected Free, got ${price}`);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings')));
  if (stored.length !== 1 || stored[0].price !== null || stored[0].status !== 'listed') {
    throw new Error('stored listing has wrong shape: ' + JSON.stringify(stored[0], null, 2).slice(0, 300));
  }

  await page.goto(BASE + '/#/');
  await page.getByText('Wooden dining chair').waitFor();

  fs.mkdirSync('tests/screens', { recursive: true });
  await page.screenshot({ path: 'tests/screens/home.png' });
  await page.getByText('Wooden dining chair').click();
  await page.screenshot({ path: 'tests/screens/listing.png', fullPage: true });
  console.log('PASS: photo -> manual/back -> draft -> edit -> post -> listing');
} catch (err) {
  console.error('FAIL:', err.message);
  await page.screenshot({ path: 'tests/screens/failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
