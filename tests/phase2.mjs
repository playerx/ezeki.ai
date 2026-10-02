// Claim loop walkthrough, offline (manual draft path, stubbed geocoder/tiles,
// pinned clock): giver lists -> finder claims (address revealed) -> second
// finder joins waitlist (no address) -> giver cancels (waitlist promoted) ->
// window passes -> check-in closes it.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgA//Z', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = async () => page.locator('main').textContent();
const setClock = (iso) => page.evaluate((v) => localStorage.setItem('giveaway.clock', v), iso);

await page.route('**/api/geocode**', (route) => route.fulfill({ json: [{ label: 'Bernal Heights, San Francisco, California', lat: 37.7389, lon: -122.4152 }] }));
await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
// Pin "now" to a Monday morning so the upcoming windows are predictable.
await page.addInitScript(() => { if (!localStorage.getItem('giveaway.clock')) localStorage.setItem('giveaway.clock', '2026-10-05T09:00:00'); });

try {
  // Giver lists an item available Mon evenings and Sat mornings.
  await page.goto(BASE + '/#/new');
  await page.setInputFiles('#photo-input', { name: 'chair.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await page.getByRole('button', { name: 'Fill in the details myself' }).click();
  await page.fill('#f-title', 'Wooden dining chair');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.fill('#p-area', 'Bernal Heights');
  await page.locator('#area-suggest button').first().click();
  await page.fill('#p-address', '123 Example St');
  await page.fill('#p-notes', 'Porch pickup, side gate.');
  await page.locator('[data-slot="mon-eve"]').click();
  await page.locator('[data-slot="sat-am"]').click();
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByRole('button', { name: 'List it' }).click();
  await page.waitForURL(/#\/listing\/[^/]+$/);
  await page.getByText('No one has claimed it yet.').waitFor();

  // Finder (first person) claims the Monday evening window.
  await page.getByRole('button', { name: 'Finding' }).click();
  await page.locator('#claim-form').waitFor();
  const windows = await page.locator('.windows button').allTextContents();
  must(windows.length === 3, 'expected 3 windows in the next week, got ' + JSON.stringify(windows));
  must(/Mon.*evening/.test(windows[0]) && /Sat.*morning/.test(windows[1]), 'window order/labels wrong: ' + JSON.stringify(windows));
  must(!(await text()).includes('123 Example St'), 'address visible before claiming');
  await page.fill('#c-name', 'Sam');
  await page.getByRole('button', { name: 'Confirm pickup' }).click(); // no window picked yet
  await page.locator('#claim-error:visible').waitFor();
  await page.locator('.windows button').first().click();
  await page.fill('#c-msg', 'I have a car');
  await page.getByRole('button', { name: 'Confirm pickup' }).click();
  await page.locator('#my-claim').waitFor();
  must((await text()).includes("It's yours") && (await text()).includes('123 Example St') && (await text()).includes('Porch pickup, side gate.'), 'claim confirmation missing address or notes');

  // Finder home: row note and "pickup today" banner (window is this evening).
  await page.goto(BASE + '/#/');
  await page.getByText('yours to pick up').waitFor();
  await page.getByText('Pickup today:').waitFor();

  // Giver sees the claim.
  await page.getByRole('button', { name: 'Giving' }).click();
  await page.locator('.listing-row').click();
  await page.waitForURL(/#\/listing\/[^/]+$/);
  await page.locator('.claim-card h3', { hasText: 'Claimed' }).waitFor();
  must((await text()).includes('Sam') && (await text()).includes('I have a car'), 'giver should see claimer name and message');
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings'))[0]);
  must(stored.status === 'claimed' && stored.requests.length === 1 && stored.requests[0].status === 'accepted', 'stored claim wrong');

  // A second finder joins the waitlist and must not see the address.
  await page.evaluate(() => localStorage.setItem('giveaway.me', JSON.stringify({ id: 'second-person', name: '' })));
  await page.getByRole('button', { name: 'Finding' }).click();
  await page.getByText('Already claimed. Join the waitlist?').waitFor();
  await page.fill('#c-name', 'Alex');
  await page.locator('.windows button').nth(1).click();
  await page.getByRole('button', { name: 'Join waitlist' }).click();
  await page.getByText("You're #1 in line").waitFor();
  must(!(await text()).includes('123 Example St'), 'waitlisted finder must not see the address');

  // Giver cancels the pickup: Alex is promoted automatically.
  await page.getByRole('button', { name: 'Giving' }).click();
  await page.getByText('Waitlist (1)').waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancel this pickup' }).click();
  await page.getByText('Alex').first().waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings'))[0]);
  must(stored.status === 'claimed' && stored.requests[0].status === 'cancelled' && stored.requests[0].cancelledBy === 'giver' && stored.requests[1].status === 'accepted', 'promotion after cancel wrong: ' + JSON.stringify(stored.requests.map((r) => r.status)));
  must((await text()).includes('Sat'), 'promoted claim should keep its own window');

  // Alex now sees the address.
  await page.getByRole('button', { name: 'Finding' }).click();
  await page.locator('#my-claim').waitFor();
  must((await text()).includes('123 Example St'), 'promoted finder should see the address');

  // Saturday afternoon: the window has passed, both sides get the check-in.
  await setClock('2026-10-10T13:00:00');
  await page.reload();
  await page.getByText('Did you pick it up?').waitFor();
  await page.goto(BASE + '/#/');
  await page.getByText('Did the pickup of').waitFor();
  await page.getByRole('button', { name: 'Giving' }).click();
  await page.locator('.listing-row').click();
  await page.waitForURL(/#\/listing\/[^/]+$/);
  await page.getByText('Did the pickup happen?').waitFor();
  await page.getByRole('button', { name: "Yes, it's gone" }).click();
  await page.getByText('Given away.').waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings'))[0]);
  must(stored.status === 'completed' && stored.requests[1].status === 'completed', 'check-in did not complete the listing');

  // Finder board no longer shows it.
  await page.getByRole('button', { name: 'Finding' }).click();
  await page.goto(BASE + '/#/');
  await page.getByText('Nothing free nearby right now.').waitFor();

  // No-show path on a fresh listing: finder claims, giver says no-show, item goes back on the board.
  await page.getByRole('button', { name: 'Giving' }).click();
  await page.goto(BASE + '/#/new');
  await page.setInputFiles('#photo-input', { name: 'lamp.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await page.getByRole('button', { name: 'Fill in the details myself' }).click();
  await page.fill('#f-title', 'Desk lamp');
  await page.getByRole('button', { name: 'Next: pickup' }).click();
  await page.locator('#pickup-form').waitFor(); // prefilled from defaults
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByRole('button', { name: 'List it' }).click();
  await page.waitForURL(/#\/listing\/[^/]+$/);
  await page.getByRole('button', { name: 'Finding' }).click();
  await page.fill('#c-name', 'Alex');
  await page.locator('.windows button').first().click();
  await page.getByRole('button', { name: 'Confirm pickup' }).click();
  await page.locator('#my-claim').waitFor();
  // Alex picked Mon 12 Oct evening (the first window after Sat morning passed). Next morning: due, not yet lapsed.
  await setClock('2026-10-13T09:00:00');
  await page.getByRole('button', { name: 'Giving' }).click();
  await page.getByRole('button', { name: 'No-show' }).click();
  await page.getByText('No one has claimed it yet.').waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings'))[0]);
  must(stored.status === 'listed' && stored.requests[0].status === 'no_show' && stored.requests[0].noShowBy === 'recipient', 'no-show should reopen and record against the recipient');

  // No answer for a day after the window: the claim lapses on its own and the item is relisted.
  await page.getByRole('button', { name: 'Finding' }).click();
  await page.locator('.windows button').first().click();
  await page.getByRole('button', { name: 'Confirm pickup' }).click();
  await page.locator('#my-claim').waitFor();
  await setClock('2026-11-01T09:00:00');
  await page.reload();
  await page.locator('#claim-form').waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway.listings'))[0]);
  must(stored.status === 'listed' && stored.requests.at(-1).status === 'no_show' && stored.requests.at(-1).noShowBy === 'unknown', 'unanswered claim should lapse after a day');

  fs.mkdirSync('tests/screens', { recursive: true });
  await page.screenshot({ path: 'tests/screens/phase2-giver.png', fullPage: true });
  console.log('PASS: list -> claim (address shown) -> waitlist (hidden) -> giver cancel -> promoted -> check-in complete -> no-show reopens');
} catch (err) {
  console.error('FAIL:', err.message);
  await page.screenshot({ path: 'tests/screens/failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
