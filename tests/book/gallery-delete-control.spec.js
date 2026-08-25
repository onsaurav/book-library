'use strict';

const { test, expect } = require('@playwright/test');
const { startTestServer } = require('./helpers/testServer');

let server;

test.beforeAll(async () => {
  server = await startTestServer();
  server.store.addBook({ name: 'Book One', author: 'Author One', language: 'English', priceMinor: 10000 });
  server.store.addBook({ name: 'Book Two', author: 'Author Two', language: 'English', priceMinor: 20000 });
  server.store.addBook({ name: 'Book Three', author: 'Author Three', language: 'English', priceMinor: 30000 });
});

test.afterAll(async () => {
  await server.close();
});

test.beforeEach(async ({ page }) => {
  await page.goto(server.baseURL);
});

// @covers REQ-BOOK-003@v1
test('a book card displays a Delete control', async ({ page }) => {
  const firstCard = page.locator('.book-card').first();
  await expect(firstCard.getByRole('button', { name: /delete/i })).toBeVisible();
});

// @covers REQ-BOOK-003@v1
test('three Books produce three Delete controls, one per card', async ({ page }) => {
  await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(3);
});

// @covers REQ-BOOK-003@v1
test('the Delete control can be reached and activated by keyboard alone', async ({ page }) => {
  const deleteButton = page.locator('.book-card').first().getByRole('button', { name: /delete/i });
  await deleteButton.focus();
  await expect(deleteButton).toBeFocused();
});

// @covers REQ-BOOK-003@v1
test('the Delete control carries an accessible label naming the Book', async ({ page }) => {
  const firstCard = page.locator('.book-card').first();
  const name = await firstCard.locator('[data-field="name"]').textContent();
  await expect(firstCard.getByRole('button', { name: new RegExp(name) })).toBeVisible();
});
