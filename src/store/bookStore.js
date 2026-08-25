'use strict';

const Database = require('better-sqlite3');

function formatPrice(priceMinor) {
  return (priceMinor / 100).toFixed(2);
}

function toBook(row) {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    language: row.language,
    price: formatPrice(row.price_minor),
  };
}

/**
 * @param {string} dbPath Path to the SQLite file. Created if it does not exist.
 * @returns {{ addBook: (details: { name: string, author: string, language: string, priceMinor: number }) => object,
 *             listBooks: () => object[],
 *             close: () => void }}
 */
function createBookStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      author TEXT NOT NULL,
      language TEXT NOT NULL,
      price_minor INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const insertBook = db.prepare(
    'INSERT INTO books (name, author, language, price_minor) VALUES (@name, @author, @language, @priceMinor)'
  );
  const selectAll = db.prepare('SELECT * FROM books ORDER BY id DESC');

  function addBook(details) {
    const result = insertBook.run(details);
    return {
      id: Number(result.lastInsertRowid),
      name: details.name,
      author: details.author,
      language: details.language,
      price: formatPrice(details.priceMinor),
    };
  }

  function listBooks() {
    return selectAll.all().map(toBook);
  }

  function close() {
    db.close();
  }

  return { addBook, listBooks, close };
}

module.exports = { createBookStore };
