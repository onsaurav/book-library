'use strict';

const crypto = require('node:crypto');
const { validateBookDetails } = require('../validation/bookValidation');
const logger = require('../logger');

const MAX_BODY_BYTES = 1_000_000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        if (typeof req.destroy === 'function') {
          req.destroy();
        }
      }
    });
    req.on('end', () => {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * @param {{ addBook: Function, listBooks: Function }} store
 */
function createBooksRouter(store) {
  async function list(req, res) {
    sendJson(res, 200, { books: store.listBooks() });
  }

  async function add(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'The request body must be valid JSON.' });
      return;
    }

    const result = validateBookDetails(body);
    if (!result.valid) {
      sendJson(res, 422, { errors: result.errors });
      return;
    }

    try {
      const book = store.addBook(result.details);
      sendJson(res, 201, { book });
    } catch (err) {
      const correlationId = crypto.randomUUID();
      logger.error('Failed to add Book', { correlationId, error: err.message });
      sendJson(res, 500, {
        error: 'The Book could not be added. Please try again.',
        correlationId,
      });
    }
  }

  return { list, add };
}

module.exports = { createBooksRouter };
