// Start the preview server first; see README.md.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  const origin = process.env.AD_PREVIEW_URL || 'http://127.0.0.1:4187';
  try {
    const page = await browser.newPage({ viewport: { width: 970, height: 250 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${origin}/ad.html`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.ad')).not.toHaveClass(/opening/);
    await expect(page.locator('h1')).toHaveText('SMALL STAGE.BIG FEELINGS.');
    // Automatic scene change, then manual selection and pause.
    await expect(page.getByRole('button', { name: 'Comedy', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
    await page.mouse.move(800, 80);
    await expect.poll(() => page.locator('.ad').evaluate(el => el.style.getPropertyValue('--spot-x'))).not.toBe('');
    await page.getByRole('button', { name: 'Pause animation' }).click();
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('LESS SCROLL.MORE LIVE.');
    await page.getByRole('button', { name: 'Theatre', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('h1')).toHaveText('SMALL STAGE.BIG FEELINGS.');

    // A booking click really opens the current programme.
    await page.context().route('https://theatre118.com/**', route => route.fulfill({ body: '<h1>Programme destination</h1>', contentType: 'text/html' }));
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'SEE WHAT’S ON' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://theatre118.com/whats-on');
    await popup.close();

    // Every intended size keeps the essential content inside the ad.
    for (const width of [970, 728, 521, 520, 390, 360, 320]) {
      const height = width <= 520 ? 300 : 250;
      await page.setViewportSize({ width, height });
      const bounds = await page.evaluate(() => {
        const selectors = ['.identity', 'h1', '.scene-picker', '.booking'];
        return {
          overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          elements: selectors.map(selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }),
        };
      });
      assert.equal(bounds.overflow, false, `Overflow at ${width}px`);
      for (const box of bounds.elements) {
        assert(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= height, `${box.selector} outside ${width} × ${height}`);
      }
    }

    // Reduced motion starts static, remains interactive, and has no dead playback control.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('.curtain-left')).toBeHidden();
    await expect(page.locator('.motion')).toBeHidden();
    await page.getByRole('button', { name: 'Comedy', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('BIG LAUGHS.UP CLOSE.');
    assert.equal(await page.locator('.message').evaluate(el => getComputedStyle(el).animationName), 'none');

    // Preview controls change the real iframe, and replay triggers the entrance.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(origin);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('.ad')).not.toHaveClass(/opening/);
    await page.getByRole('button', { name: 'Mobile', exact: true }).click();
    await expect(page.locator('.frame-shell')).toHaveClass(/mobile/);
    await expect.poll(async () => Math.round((await page.locator('iframe').boundingBox()).width)).toBe(360);
    await page.getByRole('button', { name: 'Replay the entrance' }).click();
    await expect(frame.locator('.ad')).toHaveClass(/opening/);
    await expect(frame.locator('.ad')).not.toHaveClass(/opening/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await expect(page.getByRole('button', { name: 'Mobile', exact: true })).toHaveAttribute('aria-pressed', 'true');

    assert.deepEqual(errors, []);
    console.log('PASS: automatic and manual scenes, keyboard, booking destination, 7 banner sizes, reduced motion, preview sizes, replay, and clean resource/console checks.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
