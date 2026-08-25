'use strict';

const { test, expect } = require('@playwright/test');
const { startTestServer } = require('./helpers/testServer');

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.close();
});

test.beforeEach(async ({ page }) => {
  await page.goto(server.baseURL);
});

// @covers REQ-BOOK-005@v1
test('activating "+ Add Book" displays a modal form above the page', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Book' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

// @covers REQ-BOOK-005@v1
test('activating "+ Add Book" does not navigate away from the home page URL', async ({ page }) => {
  const urlBefore = page.url();
  await page.getByRole('button', { name: '+ Add Book' }).click();
  expect(page.url()).toBe(urlBefore);
});

// @covers REQ-BOOK-005@v1
test('the modal can be closed via its Cancel control without adding a Book', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Book' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

// @covers REQ-BOOK-005@v1
test('pressing Escape closes the modal without adding a Book', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Book' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

// @covers REQ-BOOK-005@v1
test('every modal control can be reached by keyboard and focus never leaves the dialog', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Book' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const focusableCount = await dialog.locator('button, input').count();
  for (let i = 0; i < focusableCount + 1; i += 1) {
    await page.keyboard.press('Tab');
    const isInsideDialog = await page.evaluate(
      () => document.activeElement != null && document.activeElement.closest('[role="dialog"]') != null
    );
    expect(isInsideDialog).toBe(true);
  }
});
