'use strict';

(function () {
  const { renderGallery, createModalController, createAddBookForm } = window.BookLibrary;

  async function fetchBooks() {
    const response = await fetch('/api/books');
    const { books } = await response.json();
    return books;
  }

  async function main() {
    const galleryContainer = document.getElementById('gallery');
    const addBookButton = document.getElementById('add-book-button');
    const modalElement = document.getElementById('add-book-modal');
    const formElement = document.getElementById('add-book-form');
    const templates = {
      empty: document.getElementById('empty-library-template'),
      card: document.getElementById('book-card-template'),
    };

    const modal = createModalController(modalElement, addBookButton);
    addBookButton.addEventListener('click', () => modal.open());

    galleryContainer.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="open-add-book"]')) {
        modal.open();
      }
    });

    let books = await fetchBooks();
    renderGallery(books, galleryContainer, templates);

    createAddBookForm(formElement, {
      onSubmitted(book) {
        books = [book, ...books];
        renderGallery(books, galleryContainer, templates);
        modal.close();
      },
    });
  }

  document.addEventListener('DOMContentLoaded', main);
})();
