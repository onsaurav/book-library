'use strict';

const REQUIRED_TEXT_FIELDS = ['name', 'author', 'language'];

function isBlank(value) {
  return typeof value !== 'string' || value.trim().length === 0;
}

function capitalize(field) {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

function parsePrice(rawPrice) {
  const trimmed = rawPrice.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, minorUnits: Math.round(Number.parseFloat(trimmed) * 100) };
}

/**
 * @param {{ name?: unknown, author?: unknown, language?: unknown, price?: unknown }} details
 * @returns {{ valid: true, errors: {}, details: { name: string, author: string, language: string, priceMinor: number } }
 *         | { valid: false, errors: Record<string, string> }}
 */
function validateBookDetails(details) {
  const input = details && typeof details === 'object' ? details : {};
  const errors = {};

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (isBlank(input[field])) {
      errors[field] = `${capitalize(field)} is required.`;
    }
  }

  let priceMinor = null;
  if (isBlank(input.price)) {
    errors.price = 'Price is required.';
  } else {
    const parsed = parsePrice(input.price);
    if (!parsed.ok) {
      errors.price = 'Price must be a number with up to two decimal places.';
    } else if (parsed.minorUnits < 0) {
      errors.price = 'Price cannot be negative.';
    } else {
      priceMinor = parsed.minorUnits;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    details: {
      name: input.name.trim(),
      author: input.author.trim(),
      language: input.language.trim(),
      priceMinor,
    },
  };
}

module.exports = { validateBookDetails };
