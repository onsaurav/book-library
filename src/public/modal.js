'use strict';

(function () {
  const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  /**
   * @param {HTMLElement} modalElement
   * @param {HTMLElement} triggerElement Element focus returns to when the modal closes.
   */
  function createModalController(modalElement, triggerElement) {
    let lastFocused = null;

    function getFocusable() {
      return Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled')
      );
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = getFocusable();
        if (focusable.length === 0) {
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    function open() {
      lastFocused = document.activeElement;
      modalElement.hidden = false;
      const focusable = getFocusable();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
      document.addEventListener('keydown', onKeydown);
    }

    function close() {
      modalElement.hidden = true;
      document.removeEventListener('keydown', onKeydown);
      const returnTo = lastFocused && typeof lastFocused.focus === 'function' ? lastFocused : triggerElement;
      if (returnTo) {
        returnTo.focus();
      }
    }

    modalElement.querySelectorAll('[data-action="close-modal"]').forEach((el) => {
      el.addEventListener('click', close);
    });

    return { open, close };
  }

  window.BookLibrary = window.BookLibrary || {};
  window.BookLibrary.createModalController = createModalController;
})();
