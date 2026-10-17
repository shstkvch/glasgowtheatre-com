const { test, expect } = require("@playwright/test");

test("the API documentation lists the contract and links to the playground", async ({
  page,
}) => {
  await page.goto("/api/");

  await expect(page).toHaveTitle(/API for developers/);
  await expect(page.locator("h1")).toContainText("Glasgow’s stages");
  await expect(page.locator(".api-table")).toHaveCount(2);
  await expect(page.locator('a[href="/api/examples.html"]').first()).toBeVisible();
  await expect(page.locator('a[href$="openapi.json"]').first()).toBeVisible();
  await expect(page.locator('a[href="/api/v1/shows.json"]').first()).toBeVisible();
});

test("the playground starts with an editable example and switches language", async ({
  page,
}) => {
  await page.goto("/api/examples.html");

  await expect(page).toHaveTitle(/Try the Glasgow Theatre API/);
  await expect(page.locator(".lang-tab")).toHaveCount(5);
  await expect(page.locator("#api-code")).toHaveValue(/upcoming shows/);
  await expect(page.locator("#api-output")).toContainText("Press Run");

  await page.locator('.lang-tab[data-lang="python"]').click();
  await expect(page.locator("#api-code")).toHaveValue(/import json/);
  await expect(page.locator('.lang-tab[data-lang="python"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.locator('.lang-tab[data-lang="c"]').click();
  await expect(page.locator("#api-code")).toHaveValue(/#include <stdio.h>/);

  await page.locator("#api-reset").click();
  await expect(page.locator("#api-code")).toHaveValue(/#include <stdio.h>/);
});
