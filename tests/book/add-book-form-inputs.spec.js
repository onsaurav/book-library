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

// @covers REQ-BOOK-006@v1
test('the modal form presents inputs for Name, Author, Language and Price', async ({ page }) => {
  await expect(page.locator('#book-name')).toBeVisible();
  await expect(page.locator('#book-author')).toBeVisible();
  await expect(page.locator('#book-language')).toBeVisible();
  await expect(page.locator('#book-price')).toBeVisible();
});

// @covers REQ-BOOK-006@v1
test('the modal form presents a control that submits the entered details', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Add Book', exact: true })).toBeVisible();
});

// @covers REQ-BOOK-006@v1
test('no Book ID input is present in the modal form', async ({ page }) => {
  await expect(page.locator('#add-book-form [name="id"], #book-id')).toHaveCount(0);
});

// @covers REQ-BOOK-006@v1
test("the Name input is labelled for the book's title", async ({ page }) => {
  await expect(page.locator('label[for="book-name"]')).toContainText(/title/i);
});

// @covers REQ-BOOK-006@v1
test('the Language input is a free-text field, not a fixed list', async ({ page }) => {
  const language = page.locator('#book-language');
  const tagName = await language.evaluate((el) => el.tagName);
  expect(tagName).toBe('INPUT');
  await language.fill('Bangla');
  await expect(language).toHaveValue('Bangla');
});

// @covers REQ-BOOK-006@v1
test('the Price input accepts a value with up to two decimal places', async ({ page }) => {
  const price = page.locator('#book-price');
  await price.fill('450.00');
  await expect(price).toHaveValue('450.00');
});

// @covers REQ-BOOK-006@v1
test('the Price input refuses a negative value', async ({ page }) => {
  await page.locator('#book-name').fill('A Book');
  await page.locator('#book-author').fill('An Author');
  await page.locator('#book-language').fill('English');
  await page.locator('#book-price').fill('-5.00');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await expect(page.locator('[data-error-for="price"]')).not.toHaveText('');
});
