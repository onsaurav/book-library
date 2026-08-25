'use strict';

(function () {
  function createBookCardElement(book, template) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.bookId = String(book.id);
    card.querySelector('[data-field="id"]').textContent = book.id;
    card.querySelector('[data-field="name"]').textContent = book.name;
    card.querySelector('[data-field="author"]').textContent = book.author;
    card.querySelector('[data-field="language"]').textContent = book.language;
    card.querySelector('[data-field="price"]').textContent = `BDT ${book.price}`;
    const deleteButton = card.querySelector('[data-action="delete-book"]');
    deleteButton.setAttribute('aria-label', `Delete ${book.name}`);
    return card;
  }

  /**
   * @param {object[]} books
   * @param {HTMLElement} container
   * @param {{ empty: HTMLTemplateElement, card: HTMLTemplateElement }} templates
   */
  function renderGallery(books, container, templates) {
    container.replaceChildren();
    if (books.length === 0) {
      container.appendChild(templates.empty.content.cloneNode(true));
      return;
    }
    for (const book of books) {
      container.appendChild(createBookCardElement(book, templates.card));
    }
  }

  window.BookLibrary = window.BookLibrary || {};
  window.BookLibrary.renderGallery = renderGallery;
})();
