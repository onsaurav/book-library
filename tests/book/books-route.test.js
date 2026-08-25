'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBookStore } = require('../../src/store/bookStore');
const { createBooksRouter } = require('../../src/routes/books');

function fakeRequest(body) {
  const req = new EventEmitter();
  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(body)));
    }
    req.emit('end');
  });
  return req;
}

function fakeResponse() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(statusCode, headers) {
      res.statusCode = statusCode;
      res.headers = headers;
    },
    end(payload) {
      res.body = payload ? JSON.parse(payload) : null;
    },
  };
  return res;
}

function tempStore() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'books-route-test-')), 'library.sqlite');
  return createBookStore(dbPath);
}

const validBody = { name: 'A Book', author: 'An Author', language: 'English', price: '100.00' };

test('GET lists every Book from the store', async () => {
  const store = tempStore();
  store.addBook({ name: 'X', author: 'Y', language: 'English', priceMinor: 100 });
  const router = createBooksRouter(store);
  const res = fakeResponse();
  await router.list(fakeRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.books.length, 1);
  store.close();
});

// @covers REQ-BOOK-008@v1
test('POST with valid details adds exactly one Book and returns it', async () => {
  const store = tempStore();
  const router = createBooksRouter(store);
  const res = fakeResponse();
  await router.add(fakeRequest(validBody), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.book.name, 'A Book');
  assert.equal(store.listBooks().length, 1);
  store.close();
});

// @covers REQ-BOOK-008@v1
test('POST does not accept a client-supplied Book ID', async () => {
  const store = tempStore();
  const router = createBooksRouter(store);
  const res = fakeResponse();
  await router.add(fakeRequest({ ...validBody, id: 999 }), res);
  assert.notEqual(res.body.book.id, 999);
  store.close();
});

// @covers REQ-BOOK-007@v1
test('POST with a blank required field creates no Book and names the field', async () => {
  const store = tempStore();
  const router = createBooksRouter(store);
  const res = fakeResponse();
  await router.add(fakeRequest({ ...validBody, name: '' }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.errors.name, /Name/);
  assert.equal(store.listBooks().length, 0);
  store.close();
});

// @covers REQ-BOOK-007@v1
test('POST with an invalid Price creates no Book', async () => {
  const store = tempStore();
  const router = createBooksRouter(store);
  const res = fakeResponse();
  await router.add(fakeRequest({ ...validBody, price: 'not a number' }), res);
  assert.equal(res.statusCode, 422);
  assert.equal(store.listBooks().length, 0);
  store.close();
});

// @covers REQ-BOOK-007@v1
test('the server rejects invalid details on its own, independent of any client-side check', async () => {
  const store = tempStore();
  const router = createBooksRouter(store);
  const res = fakeResponse();
  await router.add(fakeRequest({ name: '', author: '', language: '', price: '-1' }), res);
  assert.equal(res.statusCode, 422);
  assert.equal(store.listBooks().length, 0);
  store.close();
});

// @covers REQ-BOOK-008@v1
test('a second Book with the same Name and Author as an existing one is also added', async () => {
  const store = tempStore();
  const router = createBooksRouter(store);
  await router.add(fakeRequest(validBody), fakeResponse());
  const res = fakeResponse();
  await router.add(fakeRequest(validBody), res);
  assert.equal(res.statusCode, 201);
  assert.equal(store.listBooks().length, 2);
  store.close();
});

// @covers REQ-BOOK-008@v1
test('a store failure on add surfaces a visible error message, not a silent failure', async () => {
  const brokenStore = {
    addBook() {
      throw new Error('disk full');
    },
    listBooks() {
      return [];
    },
  };
  const router = createBooksRouter(brokenStore);
  const res = fakeResponse();
  await router.add(fakeRequest(validBody), res);
  assert.equal(res.statusCode, 500);
  assert.ok(res.body.error);
  assert.doesNotMatch(res.body.error, /disk full/);
});
