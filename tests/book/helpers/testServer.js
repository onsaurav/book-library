'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../../../src/server');
const { createBookStore } = require('../../../src/store/bookStore');

/**
 * Starts an isolated instance of the application on an OS-assigned port,
 * backed by a fresh SQLite file in a temp directory, so each spec file gets
 * its own Library with no state shared across test files.
 */
function startTestServer() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-library-e2e-')), 'library.sqlite');
  const store = createBookStore(dbPath);
  const app = createApp(store);

  return new Promise((resolve) => {
    app.listen(0, () => {
      const { port } = app.address();
      resolve({
        baseURL: `http://localhost:${port}`,
        store,
        async close() {
          store.close();
          await new Promise((res) => {
            app.close(res);
            // A still-open keep-alive connection (e.g. a Playwright page that
            // hasn't navigated away yet) would otherwise make close() hang
            // forever: http.Server.close() only stops accepting new
            // connections, it does not close existing ones.
            app.closeAllConnections();
          });
        },
      });
    });
  });
}

module.exports = { startTestServer };
