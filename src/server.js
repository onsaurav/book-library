'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createBookStore } = require('./store/bookStore');
const { createBooksRouter } = require('./routes/books');
const logger = require('./logger');

const PUBLIC_DIR = path.join(__dirname, 'public');

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serveStatic(pathname, res) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${requestedPath}`);

  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const contentType = STATIC_CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

/**
 * @param {ReturnType<typeof createBookStore>} store
 */
function createApp(store) {
  const booksRouter = createBooksRouter(store);

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/books' && req.method === 'GET') {
      booksRouter.list(req, res);
      return;
    }
    if (url.pathname === '/api/books' && req.method === 'POST') {
      booksRouter.add(req, res);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    serveStatic(url.pathname, res);
  });
}

/**
 * @param {number} port
 * @param {string} dbPath
 */
function start(port, dbPath) {
  const store = createBookStore(dbPath);
  const app = createApp(store);
  app.listen(port);
  return { app, store };
}

module.exports = { createApp, start };

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const dbPath = process.env.BOOK_LIBRARY_DB || path.join(__dirname, '..', 'data', 'library.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  start(port, dbPath);
  logger.info('Book Library listening', { port });
}
