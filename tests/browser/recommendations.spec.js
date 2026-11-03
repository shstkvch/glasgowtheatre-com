const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const core = require('../../src/js/sponsor-core');
const feed = require('../fixtures/theatre-118-sponsorship.json');
const fs = require('node:fs');
const dist = process.env.BUILD_OUTPUT || 'dist';
const metadata = JSON.parse(fs.readFileSync(`${dist}/data/sponsor-listings.json`, 'utf8'));
const sponsor = core.normalise(core.choose(feed, core.DEFAULTS, new Date('2026-11-03T12:00:00Z')), metadata);
const current = '/shows/citizens-othello.html';

async function mockSponsor(page, value = sponsor, status = 200) {
  await page.route('**/sponsorship?placement=*', route => route.fulfill({ status, json: { sponsor: value, expiresAt: Date.now() + 300000 } }));
  await page.route('**/sponsor-image?*', route => route.fulfill({ path: 'experiments/sponsored-show/assets/working-it-out.webp', contentType: 'image/webp' }));
  await page.route('**/track', route => route.fulfill({ status: 204 }));
}
const visible = page => page.locator('#you-may-also-like .event-card:visible');

test('recommendations show the sponsor first, two ranked shows and normal internal links', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockSponsor(page);
  await page.goto(current);
  await expect(visible(page)).toHaveCount(3);
  await expect(visible(page).first()).toHaveClass(/highlighted-show/);
  await expect(visible(page).first().locator('.listing-note')).toHaveText('Sponsored');
  await expect(visible(page).nth(1).locator('h3')).toHaveText('Do Not Pass Go');
  expect(await visible(page).evaluateAll(cards => new Set(cards.map(card => card.dataset.id)).size)).toBe(3);
  await expect(page.locator('#you-may-also-like [data-id="citizens-othello"]')).toHaveCount(0);
  await expect(visible(page).first().locator('h3 a')).toHaveAttribute('href', sponsor.detailUrl);
  const recommendations = page.locator('#you-may-also-like');
  await recommendations.scrollIntoViewIfNeeded();
  await expect.poll(() => visible(page).first().locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const spacing = await recommendations.evaluate(section => ({ left: section.getBoundingClientRect().left, right: innerWidth - section.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > innerWidth }));
  expect(spacing.left).toBeGreaterThanOrEqual(18);
  expect(spacing.right).toBeGreaterThanOrEqual(18);
  expect(spacing.overflow).toBe(false);
  const violations = (await new AxeBuilder({ page }).include('#you-may-also-like').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
  expect(violations.map(v => v.id)).toEqual([]);
  await page.evaluate(() => document.getElementById('you-may-also-like').scrollIntoView({ behavior: 'instant' }));
  await page.screenshot({ path: `test-results/recommendations-production-${info.project.name}.png` });
  const next = await visible(page).nth(1).locator('h3 a').getAttribute('href');
  await visible(page).nth(1).locator('h3 a').click();
  await expect(page).toHaveURL(new RegExp(next.replace('.html', '(?:.html)?') + '$'));
  await expect(visible(page)).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('unavailable sponsorship leaves three organic cards, and the sponsor never recommends itself', async ({ page }) => {
  await mockSponsor(page, null, 503);
  await page.goto(current);
  await expect(visible(page)).toHaveCount(3);
  await expect(page.locator('#show-placement')).toBeHidden();
  await page.unroute('**/sponsorship?placement=*');
  await mockSponsor(page);
  await page.goto(sponsor.detailUrl);
  await expect(page.locator('#show-placement')).toBeHidden();
  await expect(visible(page)).toHaveCount(3);
  await expect(page.locator(`#you-may-also-like [data-id="${sponsor.id}"]`)).toHaveCount(0);
});

test('changing sponsorship excludes duplicate recommendations and pausing restores the third organic card', async ({ page }) => {
  let selected = sponsor;
  await page.route('**/sponsorship?placement=*', route => route.fulfill({ json: { sponsor: selected, expiresAt: Date.now() + 300000 } }));
  await page.route('**/sponsor-image?*', route => route.fulfill({ path: 'experiments/sponsored-show/assets/working-it-out.webp', contentType: 'image/webp' }));
  await page.route('**/track', route => route.fulfill({ status: 204 }));
  await page.goto(current);
  await expect(visible(page)).toHaveCount(3);
  selected = { ...sponsor, id: 'citizens-do-not-pass-go', title: 'Do Not Pass Go', detailUrl: '/shows/citizens-do-not-pass-go.html', ticketUrl: await visible(page).nth(1).locator('.ticket-link').getAttribute('href') };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(visible(page).first().locator('h3')).toHaveText('Do Not Pass Go');
  await expect(visible(page)).toHaveCount(3);
  await expect(page.locator('#you-may-also-like [data-id="citizens-do-not-pass-go"]')).toHaveCount(1);
  selected = null;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#show-placement')).toBeHidden();
  await expect(visible(page)).toHaveCount(3);
  await expect(visible(page).first().locator('h3')).toHaveText('Do Not Pass Go');
});

test('homepage uses a regular grid card without duplicating the sponsored show', async ({ page }) => {
  await mockSponsor(page);
  await page.goto('/');
  const slot = page.locator('#show-placement');
  await expect(slot).not.toHaveAttribute('hidden');
  await expect(page.locator(`#events-grid [data-id="${sponsor.id}"]:visible`)).toHaveCount(1);
  await expect(page.locator('#events-grid .event-card:visible').first()).toHaveClass(/highlighted-show/);
  await slot.locator('h3 a').focus();
  await page.evaluate(() => document.dispatchEvent(new Event('change')));
  await expect(slot.locator('h3 a')).toBeFocused();
  const summary = page.locator('.filter-summary');
  if (await summary.isVisible()) await summary.click();
  await page.locator('#filter-search').fill('no-show-72819');
  await expect(slot).toHaveAttribute('hidden');
  await expect(page.locator('#events-grid .event-card:visible')).toHaveCount(0);
  await page.locator('.results-bar [data-reset]').click();
  await expect(slot).not.toHaveAttribute('hidden');
  const count = await page.evaluate(() => window.Listings.filterEvents(window.EVENTS).length);
  await expect(page.locator('#results-count')).toHaveText(`${count} shows`);
});

test('three recommendations are rendered without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}${current}`);
    await expect(visible(page)).toHaveCount(3);
  } finally { await context.close(); }
});


test('a sponsored show arriving before the daily build counts as one result', async ({ page }) => {
  await mockSponsor(page, { ...sponsor, id: 'theatre-118-new-show', title: 'New sponsored discovery', description: 'A unique sponsored discovery', detailUrl: null, ticketUrl: 'https://theatre118.com/whats-on/new-show' });
  await page.goto('/?q=unique sponsored discovery');
  await expect(page.locator('#show-placement')).not.toHaveAttribute('hidden');
  await expect(page.locator('#events-grid .event-card:visible')).toHaveCount(1);
  await expect(page.locator('#results-count')).toHaveText('1 show');
  await expect(page.locator('#no-results')).toBeHidden();
});

test('the EasyList rule used by uBlock cannot hide the listing wrapper or its disclosure', async ({ page }) => {
  await mockSponsor(page);
  await page.goto(current);
  await page.addStyleTag({ content: '.sponsored-slot { display: none !important; }' });
  await page.evaluate(() => {
    const control = document.createElement('div');
    control.id = 'blocking-control';
    control.className = 'sponsored-slot';
    control.textContent = 'Old listing wrapper';
    document.body.append(control);
  });
  // EasyList's generic ##.sponsored-slot rule must hide the old control while
  // leaving the real listing and its visible disclosure intact.
  await expect(page.locator('#blocking-control')).toBeHidden();
  await expect(visible(page)).toHaveCount(3);
  await expect(visible(page).first().locator('.listing-note')).toHaveText('Sponsored');
  await expect(visible(page).first().locator('.listing-note')).toBeVisible();
  await expect(page.locator('#you-may-also-like [class*="sponsor"], #you-may-also-like [id*="sponsor"]')).toHaveCount(0);
  await expect(visible(page).first().locator('.ticket-link')).toHaveAttribute('rel', 'sponsored');
});
