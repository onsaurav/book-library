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

// @covers REQ-BOOK-004@v1
test('the home page displays a button labelled "+ Add Book"', async ({ page }) => {
  await expect(page.getByRole('button', { name: '+ Add Book' })).toBeVisible();
});

// @covers REQ-BOOK-004@v1
test('the button is displayed when the Library holds no Books', async ({ page }) => {
  await expect(page.getByRole('button', { name: '+ Add Book' })).toBeVisible();
});

// @covers REQ-BOOK-004@v1
test('an empty-library message is shown alongside the button when the Library is empty', async ({ page }) => {
  await expect(page.locator('.empty-library')).toContainText(/empty/i);
});
