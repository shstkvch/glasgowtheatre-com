const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');
const password = fs.readFileSync(path.join(__dirname, '../../.dev.vars'), 'utf8').match(/^SPONSOR_ADMIN_PASSWORD=(.+)$/m)[1].trim();
const origin = 'http://127.0.0.1:4191';
async function signIn(page) {
  await page.goto('/admin/sponsorships/');
  await page.getByLabel('Admin password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await expect(page.locator('#manager')).toBeVisible();
}
async function save(page) {
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.locator('#admin-message')).toContainText('Sponsorship saved');
  await expect(page.locator('#saved-at')).toHaveText('All changes saved');
}

test('admin edits persist, placements and schedules control the actual public endpoint', async ({ page, context }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  const original = (await (await context.request.get('/admin/api/sponsorship')).json()).settings;
  try {
    await expect(page.locator('#creative-preview')).toContainText('Working it Out - November 2026');
    await page.locator('[name=description]').fill('Try something new at Theatre 118.');
    await save(page);
    await page.reload();
    await expect(page.locator('[name=description]')).toHaveValue('Try something new at Theatre 118.');
    let publicState = await (await context.request.get('/sponsorship?placement=home')).json();
    expect(publicState.sponsor.promotionalDescription).toBe('Try something new at Theatre 118.');
    await page.locator('[name=enabled]').uncheck();
    await save(page);
    expect((await (await context.request.get('/sponsorship?placement=home')).json()).sponsor).toBeNull();
    await page.locator('[name=enabled]').check();
    await page.locator('[name=home]').uncheck();
    await save(page);
    expect((await (await context.request.get('/sponsorship?placement=home')).json()).sponsor).toBeNull();
    expect((await (await context.request.get('/sponsorship?placement=detail')).json()).sponsor).not.toBeNull();
    await page.locator('[name=home]').check();
    await page.locator('[name=startsOn]').fill('2027-01-01');
    await save(page);
    expect((await (await context.request.get('/sponsorship?placement=home')).json()).sponsor).toBeNull();
    await page.locator('[name=startsOn]').fill('');
    await page.locator('[name=endsOn]').fill('2026-10-01');
    await save(page);
    expect((await (await context.request.get('/sponsorship?placement=home')).json()).sponsor).toBeNull();
    await page.locator('[name=endsOn]').fill('');
    await page.locator('[name=mode][value=specific]').check();
    await page.locator('[name=showSlug]').selectOption('sleeping-beauty-the-new-republic-of-port-dundas');
    await save(page);
    publicState = await (await context.request.get('/sponsorship?placement=home')).json();
    expect(publicState.sponsor.title).toContain('Sleeping Beauty');
    await page.reload();
    await expect(page.locator('#creative-preview')).toContainText('Sleeping Beauty');
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    expect(violations.map(v => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/sponsor-manager-${info.project.name}.png`, fullPage: true });
    const stale = await context.request.put('/admin/api/sponsorship', { headers: { Origin: origin }, data: original });
    expect(stale.status()).toBe(409);
    const forbidden = await context.request.put('/admin/api/sponsorship', { headers: { Origin: 'https://other.test' }, data: original });
    expect(forbidden.status()).toBe(403);
  } finally {
    const current = await (await context.request.get('/admin/api/sponsorship')).json();
    const response = await context.request.put('/admin/api/sponsorship', { headers: { Origin: origin }, data: { ...original, revision: current.settings.revision } });
    expect(response.status()).toBe(200);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#sign-in-panel')).toBeVisible();
  expect((await context.request.get('/admin/api/sponsorship')).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('public cards follow filters, appear below details, omit self-promotion and count clicks separately', async ({ page, context }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.goto('/');
  const slot = page.locator('#sponsored-slot');
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('Scratch / new material');
  await slot.locator('h2 a').focus();
  await page.evaluate(() => document.dispatchEvent(new Event('change')));
  await expect(slot.locator('h2 a')).toBeFocused();
  if (info.project.name === 'mobile') await page.locator('.filter-summary').click();
  await page.locator('[data-form=scratch]').click();
  await expect(slot).toBeVisible();
  await page.locator('[data-form=cabaret]').click();
  await expect(slot).toBeHidden();
  await page.locator('[data-form=scratch]').click();
  await page.locator('#filter-venue').selectOption('theatre-118');
  await page.locator('#filter-search').fill('poetry');
  await page.locator('#filter-date-from').fill('2026-11-16');
  await page.locator('#filter-date-to').fill('2026-11-16');
  await expect(slot).toBeVisible();
  await page.locator('#filter-venue').selectOption('tron');
  await expect(slot).toBeHidden();
  await page.locator('.results-bar [data-reset]').click();
  await expect(slot).toBeVisible();
  await page.screenshot({ path: `test-results/sponsor-live-home-${info.project.name}.png` });
  async function clickPaid(surface) {
    const ticket = slot.locator('.sponsor-ticket');
    const before = (await (await context.request.get('/admin/api/sponsorship')).json()).report.surfaces[surface].totals.all.clicks;
    const sent = page.waitForResponse(response => response.url().endsWith('/track') && response.request().method() === 'POST');
    await ticket.evaluate(link => link.addEventListener('click', event => event.preventDefault(), { once: true }));
    await ticket.click();
    expect((await sent).status()).toBe(204);
    await expect.poll(async () => (await (await context.request.get('/admin/api/sponsorship')).json()).report.surfaces[surface].totals.all.clicks).toBe(before + 1);
  }
  await clickPaid('sponsored-home');
  await page.goto('/shows/citizens-othello.html');
  await expect(slot).toBeVisible();
  await slot.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => ({ before: document.querySelector('.show-body').getBoundingClientRect().bottom, start: document.querySelector('#sponsored-slot').getBoundingClientRect().top, end: document.querySelector('#sponsored-slot').getBoundingClientRect().bottom, after: document.querySelector('.site-footer').getBoundingClientRect().top }));
  expect(position.start).toBeGreaterThanOrEqual(position.before);
  expect(position.end).toBeLessThanOrEqual(position.after);
  await expect.poll(() => slot.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await clickPaid('sponsored-detail');
  await page.screenshot({ path: `test-results/sponsor-live-detail-${info.project.name}.png` });
  const violations = (await new AxeBuilder({ page }).include('#sponsored-slot').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
  expect(violations.map(v => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goto('/shows/theatre-118-working-it-out-october-2026.html');
  await expect(slot).toBeHidden();
  await page.goto('/admin/sponsorships/');
  await expect.poll(async () => {
    const report = await (await context.request.get('/admin/api/sponsorship')).json();
    return report.report.sponsored.totals.today.clicks;
  }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#placement-counts')).toContainText('Homepage');
  await page.getByRole('button', { name: 'Refresh counts', exact: true }).click();
  await expect(page.locator('#admin-message')).toHaveText('Click counts refreshed.');
  expect(errors).toEqual([]);
});
