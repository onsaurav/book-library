'use strict';

(function () {
  const FIELDS = ['name', 'author', 'language', 'price'];

  function clearErrors(form) {
    for (const field of [...FIELDS, 'general']) {
      const el = form.querySelector(`[data-error-for="${field}"]`);
      if (el) {
        el.textContent = '';
      }
    }
  }

  function showErrors(form, errors) {
    clearErrors(form);
    for (const [field, message] of Object.entries(errors)) {
      const el = form.querySelector(`[data-error-for="${field}"]`);
      if (el) {
        el.textContent = message;
      }
    }
  }

  function readFormValues(form) {
    const data = new FormData(form);
    return {
      name: data.get('name') || '',
      author: data.get('author') || '',
      language: data.get('language') || '',
      price: data.get('price') || '',
    };
  }

  /**
   * @param {HTMLFormElement} form
   * @param {{ onSubmitted: (book: object) => void }} handlers
   */
  function createAddBookForm(form, { onSubmitted }) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);

      let response;
      try {
        response = await fetch('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(readFormValues(form)),
        });
      } catch {
        showErrors(form, { general: 'Could not reach the application. Please try again.' });
        return;
      }

      if (response.status === 201) {
        const { book } = await response.json();
        form.reset();
        onSubmitted(book);
        return;
      }

      if (response.status === 422) {
        const { errors } = await response.json();
        showErrors(form, errors);
        return;
      }

      showErrors(form, { general: 'The Book could not be added. Please try again.' });
    });

    return {
      reset() {
        form.reset();
        clearErrors(form);
      },
    };
  }

  window.BookLibrary = window.BookLibrary || {};
  window.BookLibrary.createAddBookForm = createAddBookForm;
})();
