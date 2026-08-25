'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBookStore } = require('../../src/store/bookStore');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-store-test-')), 'library.sqlite');
}

// @covers REQ-BOOK-008@v1
test('addBook assigns a numeric Book ID that the caller did not supply', () => {
  const store = createBookStore(tempDbPath());
  const book = store.addBook({ name: 'A', author: 'B', language: 'English', priceMinor: 100 });
  assert.equal(typeof book.id, 'number');
  store.close();
});

// @covers REQ-BOOK-008@v1
test("the stored Book's fields equal what was passed to addBook", () => {
  const store = createBookStore(tempDbPath());
  const book = store.addBook({
    name: 'The Namesake',
    author: 'Jhumpa Lahiri',
    language: 'English',
    priceMinor: 45000,
  });
  assert.equal(book.name, 'The Namesake');
  assert.equal(book.author, 'Jhumpa Lahiri');
  assert.equal(book.language, 'English');
  assert.equal(book.price, '450.00');
  store.close();
});

// @covers REQ-BOOK-008@v1
test('two Books with the same Name and Author can both be added', () => {
  const store = createBookStore(tempDbPath());
  const details = { name: 'Same', author: 'Same Author', language: 'English', priceMinor: 100 };
  const first = store.addBook(details);
  const second = store.addBook(details);
  assert.notEqual(first.id, second.id);
  assert.equal(store.listBooks().length, 2);
  store.close();
});

// @covers REQ-BOOK-008@v1
test('an added Book is present in the SQLite file, not only in memory', () => {
  const dbPath = tempDbPath();
  const store = createBookStore(dbPath);
  store.addBook({ name: 'Persisted', author: 'Author', language: 'English', priceMinor: 100 });
  store.close();

  const reopened = createBookStore(dbPath);
  const books = reopened.listBooks();
  assert.equal(books.length, 1);
  assert.equal(books[0].name, 'Persisted');
  reopened.close();
});

test('listBooks returns every stored Book', () => {
  const store = createBookStore(tempDbPath());
  store.addBook({ name: 'One', author: 'A', language: 'English', priceMinor: 100 });
  store.addBook({ name: 'Two', author: 'B', language: 'English', priceMinor: 200 });
  assert.equal(store.listBooks().length, 2);
  store.close();
});
