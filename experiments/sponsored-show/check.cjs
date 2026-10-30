const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const origin = process.env.SPONSOR_PREVIEW_URL || 'http://127.0.0.1:4188';
const artifacts = path.resolve(__dirname, '../../test-results');
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  try {
    for (const width of [1440, 900, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1100 } });
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      const beacons = [];
      await page.route('**/track', async route => {
        beacons.push(JSON.parse(route.request().postData()));
        await route.fulfill({ status: 204 });
      });
      async function outboundClick(link, surface, kind = 'click') {
        const before = beacons.length;
        await link.evaluate((anchor, eventName) => anchor.addEventListener(eventName, event => event.preventDefault(), { once: true }), kind === 'middle' ? 'auxclick' : 'click');
        if (kind === 'keyboard') { await link.focus(); await page.keyboard.press('Enter'); }
        else await link.click(kind === 'middle' ? { button: 'middle' } : {});
        await expect.poll(() => beacons.length).toBe(before + 1);
        const event = beacons.at(-1);
        assert.equal(event.kind, 'click');
        assert.equal(event.surface, surface);
        assert.equal(event.path, new URL(page.url()).pathname);
        assert.equal(event.show, await link.getAttribute('data-track-show'));
        return event;
      }
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.clock.setFixedTime(new Date('2026-10-30T12:00:00Z'));
      await page.goto(origin);
      await page.evaluate(() => document.fonts.ready);
      const slot = page.locator('#sponsored-show');
      await expect(slot).toBeVisible();
      await expect(slot.getByRole('heading')).toHaveText('Working it Out - November 2026');
      await expect(slot).toContainText('Sponsored Show');
      await expect(slot).toContainText('Paid placement by Theatre 118');
      await expect(slot).toContainText('Scratch / new material');
      assert.equal(await slot.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
      await page.screenshot({ path: path.join(artifacts, `sponsored-home-${width}.png`) });

      const violations = (await new AxeBuilder({ page }).include('#sponsored-show').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      assert.deepEqual(violations.map(v => `${v.id}: ${v.description}`), [], `Sponsor accessibility at ${width}px`);

      if (width <= 720) await page.locator('.filter-summary').click();
      await page.locator('#filter-venue').selectOption('theatre-118');
      await expect(slot).toBeVisible();
      await page.locator('[data-form="scratch"]').click();
      await expect(slot).toBeVisible();
      await page.locator('[data-form="cabaret"]').click();
      await expect(slot).toBeHidden();
      await page.locator('[data-form="scratch"]').click();
      await expect(slot).toBeVisible();
      await page.getByLabel('Search shows').fill('poetry');
      await expect(slot).toBeVisible();
      await page.locator('#filter-date-from').fill('2026-11-16');
      await page.locator('#filter-date-to').fill('2026-11-16');
      await expect(slot).toBeVisible();
      await page.reload();
      await expect(slot).toBeVisible(); // Combined URL filters survive reload.
      if (width <= 720) await page.locator('.filter-summary').click();

      await page.locator('#filter-venue').selectOption('tron');
      await expect(slot).toBeHidden();
      await page.locator('#filter-venue').selectOption('theatre-118');
      await expect(slot).toBeVisible();
      await page.locator('[data-form="pantomime"]').click();
      await expect(slot).toBeHidden(); // Does not swap in the later sponsored show.
      await page.locator('[data-form="scratch"]').click();
      await expect(slot).toBeVisible();
      await page.getByLabel('Search shows').fill('Othello');
      await expect(slot).toBeHidden();
      await page.getByLabel('Search shows').fill('Working it Out');
      await expect(slot).toBeVisible();
      await page.locator('#filter-date-to').fill('2026-11-15');
      await expect(slot).toBeHidden();
      await expect(page.locator('#no-results')).toContainText('Choose an end date');
      await page.locator('.results-bar [data-reset]').click();
      await expect(slot).toBeVisible();
      await page.getByRole('button', { name: 'Just the next 7 days' }).click();
      await expect(slot).toBeHidden();
      const gap = await page.evaluate(() => document.querySelector('#events-grid').getBoundingClientRect().top - document.querySelector('.results-bar').getBoundingClientRect().bottom);
      assert(gap < 30, `Hidden sponsor left an empty gap at ${width}px: ${gap}`);
      await page.locator('.results-bar [data-reset]').click();
      await expect(slot).toBeVisible();
      const count = await page.locator('#results-count').innerText();
      const unique = await page.evaluate(() => window.Listings.filterEvents(window.EVENTS).length);
      assert.equal(count, `${unique} shows`); // Paid placement doesn't inflate totals.
      const ticket = slot.getByRole('link', { name: 'Tickets for Working it Out - November 2026' });
      await expect(ticket).toHaveAttribute('href', 'https://theatre118.com/whats-on/working-it-out');
      await expect(ticket).toHaveAttribute('rel', 'sponsored');
      await slot.locator('h2 a').focus();
      await page.keyboard.press('Tab');
      assert(await ticket.evaluate(el => el === document.activeElement));
      assert.equal(await ticket.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');

      // All three sponsored destinations count once; keyboard and middle
      // clicks retain the paid-placement attribution too.
      await outboundClick(slot.locator('.sponsor-art'), 'sponsored-home');
      await outboundClick(slot.locator('h2 a'), 'sponsored-home', 'middle');
      await outboundClick(ticket, 'sponsored-home', 'keyboard');
      const sponsoredId = await ticket.getAttribute('data-track-show');
      await outboundClick(page.locator(`#events-grid [data-id="${sponsoredId}"] .ticket-link`), 'card');

      // Navigate through a real homepage link into the detail-page mockup.
      await page.locator('#citizens-othello h3 a').click();
      await expect(page).toHaveURL(/\/shows\/citizens-othello\.html$/);
      await expect(page.locator('.show-hero h1')).toHaveText('Othello');
      await expect(page.locator('.sponsored-show')).toHaveCount(1);
      await slot.scrollIntoViewIfNeeded();
      await expect(slot).toBeVisible();
      await expect(slot).toContainText('Working it Out - November 2026');
      await expect.poll(() => slot.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      const position = await page.evaluate(() => ({
        bodyBottom: document.querySelector('.show-body').getBoundingClientRect().bottom,
        slotTop: document.querySelector('#sponsored-show').getBoundingClientRect().top,
        slotBottom: document.querySelector('#sponsored-show').getBoundingClientRect().bottom,
        footerTop: document.querySelector('.site-footer').getBoundingClientRect().top,
      }));
      assert(position.slotTop >= position.bodyBottom && position.slotBottom <= position.footerTop, `Detail slot placement at ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Detail overflow at ${width}px`);
      await page.screenshot({ path: path.join(artifacts, `sponsored-detail-${width}.png`) });
      const detailViolations = (await new AxeBuilder({ page }).include('.detail-sponsor').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      assert.deepEqual(detailViolations.map(v => v.id), []);
      for (const selector of ['.sponsor-art', 'h2 a', '.sponsor-ticket']) {
        const event = await outboundClick(slot.locator(selector), 'sponsored-detail');
        assert.equal(event.show, sponsoredId); // Credit WIO, not the host show.
        assert.equal(event.venue, 'theatre-118');
      }
      await outboundClick(page.locator('.show-hero .btn'), 'show-hero');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(slot).toBeVisible(); // The site's periodic filter pass must not hide it.
      await page.clock.setFixedTime(new Date('2026-11-16T21:00:00Z'));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(page.locator('.detail-sponsor')).toBeHidden();
      await page.clock.setFixedTime(new Date('2026-10-30T12:00:00Z'));

      await page.goto(`${origin}/shows/theatre-118-sleeping-beauty-the-new-republic-of-port-dundas.html`);
      await expect(slot).toBeVisible(); // Other shows at the same venue still carry it.
      await page.goto(`${origin}/shows/${sponsoredId}.html`);
      await expect(page.locator('#sponsored-show, .detail-sponsor')).toHaveCount(0);
      await expect(page.locator('.show-hero h1')).toHaveText('Working it Out - November 2026');
      await page.locator('.back-link').click();
      await expect(page).toHaveURL(origin + '/');
      await expect(slot).toBeVisible();
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: homepage and detail placement at 4 widths; filter combinations; availability expiry; no self-promotion; local page navigation; separate sponsored/organic click beacons; mouse, keyboard and middle clicks; WCAG AA checks; no browser/resource errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
