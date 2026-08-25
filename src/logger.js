'use strict';

function write(stream, level, message, meta) {
  stream.write(`${JSON.stringify({ level, message, ...meta })}\n`);
}

function info(message, meta) {
  write(process.stdout, 'info', message, meta);
}

function error(message, meta) {
  write(process.stderr, 'error', message, meta);
}

module.exports = { info, error };
