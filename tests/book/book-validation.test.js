'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateBookDetails } = require('../../src/validation/bookValidation');

const validDetails = {
  name: 'The Namesake',
  author: 'Jhumpa Lahiri',
  language: 'English',
  price: '450.00',
};

test('a complete, valid submission is accepted', () => {
  const result = validateBookDetails(validDetails);
  assert.equal(result.valid, true);
});

// @covers REQ-BOOK-007@v1
test('a blank Name is refused and names Name as the fault', () => {
  const result = validateBookDetails({ ...validDetails, name: '' });
  assert.equal(result.valid, false);
  assert.match(result.errors.name, /Name/);
});

// @covers REQ-BOOK-007@v1
test('a blank Author is refused and names Author as the fault', () => {
  const result = validateBookDetails({ ...validDetails, author: '   ' });
  assert.equal(result.valid, false);
  assert.match(result.errors.author, /Author/);
});

// @covers REQ-BOOK-007@v1
test('a blank Language is refused and names Language as the fault', () => {
  const result = validateBookDetails({ ...validDetails, language: '' });
  assert.equal(result.valid, false);
  assert.match(result.errors.language, /Language/);
});

// @covers REQ-BOOK-007@v1
test('a blank Price is refused and names Price as the fault', () => {
  const result = validateBookDetails({ ...validDetails, price: '' });
  assert.equal(result.valid, false);
  assert.match(result.errors.price, /Price/);
});

// @covers REQ-BOOK-007@v1
test('a Price that is not a valid number is refused', () => {
  const result = validateBookDetails({ ...validDetails, price: 'free' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.price);
});

// @covers REQ-BOOK-007@v1
test('a negative Price is refused', () => {
  const result = validateBookDetails({ ...validDetails, price: '-5.00' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.price);
});

// @covers REQ-BOOK-006@v1
test('Language accepts any free-text value, not a fixed list', () => {
  const result = validateBookDetails({ ...validDetails, language: 'Bangla' });
  assert.equal(result.valid, true);
});

// @covers REQ-BOOK-006@v1
test('Price accepts up to two decimal places', () => {
  const result = validateBookDetails({ ...validDetails, price: '99.9' });
  assert.equal(result.valid, true);
  assert.equal(result.details.priceMinor, 9990);
});

// @covers REQ-BOOK-006@v1
test('Name and Author accept a non-Latin script such as Bangla', () => {
  const result = validateBookDetails({
    ...validDetails,
    name: 'পথের পাঁচালী',
    author: 'বিভূতিভূষণ বন্দ্যোপাধ্যায়',
  });
  assert.equal(result.valid, true);
  assert.equal(result.details.name, 'পথের পাঁচালী');
  assert.equal(result.details.author, 'বিভূতিভূষণ বন্দ্যোপাধ্যায়');
});
