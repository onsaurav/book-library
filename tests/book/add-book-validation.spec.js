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
  await page.getByRole('button', { name: '+ Add Book' }).click();
});

// @covers REQ-BOOK-007@v1
test('submitting with Name left blank shows a message naming Name, and adds no Book', async ({ page }) => {
  await page.locator('#book-author').fill('An Author');
  await page.locator('#book-language').fill('English');
  await page.locator('#book-price').fill('100.00');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();

  await expect(page.locator('[data-error-for="name"]')).toContainText(/name/i);
  await expect(page.getByRole('dialog')).toBeVisible();
});

// @covers REQ-BOOK-007@v1
test('submitting a Price that is not a valid number shows an error and adds no Book', async ({ page }) => {
  await page.locator('#book-name').fill('A Book');
  await page.locator('#book-author').fill('An Author');
  await page.locator('#book-language').fill('English');
  await page.locator('#book-price').fill('abc');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();

  await expect(page.locator('[data-error-for="price"]')).not.toHaveText('');
  await expect(page.getByRole('dialog')).toBeVisible();
});

// @covers REQ-BOOK-007@v1
test('a failed add displays a clear error message in the form', async ({ page }) => {
  await page.route('**/api/books', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    }
    return route.continue();
  });

  await page.locator('#book-name').fill('A Book');
  await page.locator('#book-author').fill('An Author');
  await page.locator('#book-language').fill('English');
  await page.locator('#book-price').fill('100.00');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();

  await expect(page.locator('[data-error-for="general"]')).not.toHaveText('');
});
