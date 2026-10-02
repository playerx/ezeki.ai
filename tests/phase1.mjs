// Walkthrough: photo -> draft -> details -> pickup -> review -> listed, plus
// manual fallback, Back, mid-flow reload, edit, remove, resume banner.
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
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

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
  must((await page.locator('.photo-grid img').count()) === 1, 'photos should survive Back');

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
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByText('Pick at least one time window').waitFor();
  await page.locator('[data-slot="mon-eve"]').click();
  await page.locator('[data-slot="sat-am"]').click();

  // A reload mid-flow must come back to the same step with everything typed.
  await page.waitForTimeout(500); // debounced persist
  await page.reload();
  await page.locator('#pickup-form').waitFor();
  must((await page.inputValue('#p-area')) === 'Bernal Heights', 'area lost on reload');
  must((await page.inputValue('#p-notes')) === 'Porch pickup, any evening', 'notes lost on reload');
  must((await page.locator('.chip[aria-pressed="true"]').count()) === 2, 'availability lost on reload');

  // Back to details and forward again must keep what was typed.
  await page.locator('#back-link').click();
  await page.locator('#edit-form').waitFor();
  must((await page.inputValue('#f-title')) === 'Wooden dining chair', 'details lost on Back');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.locator('#pickup-form').waitFor();
  must((await page.inputValue('#p-area')) === 'Bernal Heights', 'pickup fields lost on Back');
  await page.getByRole('button', { name: 'Next: review' }).click();

  // Review step shows everything including the private address, then lists it.
  await page.locator('#review').waitFor();
  const review = await page.locator('main').textContent();
  must(review.includes('Wooden dining chair') && review.includes('Bernal Heights') && review.includes('123 Example St'), 'review missing content');
  await page.getByRole('button', { name: 'List it' }).click();
  await page.waitForURL(/#\/listing\/[^/]+$/);
  await page.getByRole('heading', { name: 'Wooden dining chair' }).waitFor();
  must((await page.locator('.detail .price').textContent()).trim() === 'Free', 'expected Free');
  const pageText = await page.locator('main').textContent();
  must(pageText.includes('Pickup in Bernal Heights'), 'area missing from listing');
  must(pageText.includes('Mon evening') && pageText.includes('Sat morning'), 'availability missing from listing');
  must(!pageText.includes('123 Example St'), 'private address leaked onto the listing page');
  must((await page.locator('a.map-link').getAttribute('href')).includes('Bernal%20Heights'), 'map link missing');

  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings')));
  must(stored.length === 1 && stored[0].price === null && stored[0].status === 'listed', 'stored listing has wrong shape');
  const pk = stored[0].pickup;
  must(pk && pk.area === 'Bernal Heights' && pk.address === '123 Example St' && pk.availability.length === 2 && pk.notes === 'Porch pickup, any evening', 'stored pickup wrong: ' + JSON.stringify(pk));
  const giver = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.giver')));
  must(giver && giver.area === 'Bernal Heights' && giver.availability.length === 2, 'giver defaults not saved');
  must((await page.evaluate(() => localStorage.getItem('giveaway.draft'))) === null, 'new-listing draft should be cleared after listing');

  // Edit the listing: change the title, keep pickup, save.
  await page.getByRole('link', { name: 'Edit listing' }).click();
  await page.locator('#edit-form').waitFor();
  must((await page.inputValue('#f-title')) === 'Wooden dining chair', 'edit form not prefilled');
  await page.fill('#f-title', 'Oak dining chair');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.locator('#pickup-form').waitFor();
  must((await page.inputValue('#p-address')) === '123 Example St', 'edit pickup not prefilled');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('heading', { name: 'Oak dining chair' }).waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings')));
  must(stored.length === 1 && stored[0].title === 'Oak dining chair' && stored[0].pickup.availability.length === 2 && stored[0].updatedAt, 'edit not saved correctly');

  await page.goto(BASE + '/#/');
  await page.getByText('Oak dining chair').waitFor();
  await page.getByText('Bernal Heights').first().waitFor();
  must((await page.locator('#resume-banner').count()) === 0, 'no resume banner expected yet');
  fs.mkdirSync('tests/screens', { recursive: true });
  await page.screenshot({ path: 'tests/screens/home.png' });
  await page.getByText('Oak dining chair').click();
  await page.screenshot({ path: 'tests/screens/listing.png', fullPage: true });

  // Second listing via the manual path: pickup step prefilled from defaults,
  // then leaving mid-flow shows a resume banner on home.
  await page.goto(BASE + '/#/new');
  await page.setInputFiles('#photo-input', { name: 'lamp.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await page.getByRole('button', { name: 'Fill in the details myself' }).click();
  await page.fill('#f-title', 'Desk lamp');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.locator('#pickup-form').waitFor();
  must((await page.inputValue('#p-area')) === 'Bernal Heights', 'area not prefilled from defaults');
  must((await page.inputValue('#p-address')) === '123 Example St', 'address not prefilled from defaults');
  must((await page.locator('.chip[aria-pressed="true"]').count()) === 2, 'availability not prefilled from defaults');
  await page.goto(BASE + '/#/');
  await page.locator('#resume-banner').waitFor();
  await page.getByRole('link', { name: 'Resume' }).click();
  await page.locator('#pickup-form').waitFor();
  must((await page.inputValue('#p-area')) === 'Bernal Heights', 'resume lost pickup fields');
  await page.goto(BASE + '/#/');
  await page.locator('#discard-draft').click();
  must((await page.locator('#resume-banner').count()) === 0, 'banner should disappear after discard');

  // Remove the listing.
  await page.getByText('Oak dining chair').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.waitForURL(/#\/$/);
  await page.getByText('Nothing listed yet').waitFor();

  console.log('PASS: draft -> details -> pickup -> reload -> review -> listed -> edit -> resume banner -> remove');
} catch (err) {
  console.error('FAIL:', err.message);
  await page.screenshot({ path: 'tests/screens/failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
