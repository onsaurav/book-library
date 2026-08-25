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

async function fillValidForm(page) {
  await page.getByRole('button', { name: '+ Add Book' }).click();
  await page.locator('#book-name').fill('The Namesake');
  await page.locator('#book-author').fill('Jhumpa Lahiri');
  await page.locator('#book-language').fill('English');
  await page.locator('#book-price').fill('450.00');
}

// @covers REQ-BOOK-005@v1
test('a successful add closes the modal by itself', async ({ page }) => {
  await fillValidForm(page);
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

// @covers REQ-BOOK-008@v1
test('a successful add shows the new Book in the gallery', async ({ page }) => {
  await fillValidForm(page);
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await expect(page.locator('.book-card', { hasText: 'The Namesake' })).toBeVisible();
});
