(function (globalScope) {
  'use strict';

  /**
   * Initialize closedby="any" light-dismiss fallback for browsers without native closedBy.
   */
  function initDialogLightDismissFallback() {
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && outside(e, dialog)) {
          dialog.close('');
        }
        pressedOutside = false;
      });
    }
  }

  /**
   * Keep aria-invalid and aria-describedby synchronized with :user-invalid (and fallback)
   * and announce errors politely via a single page live region.
   */
  function initFormValidationA11y() {
    const linkError = (el, shown) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
      else el.removeAttribute('aria-describedby');
    };

    const announcer = document.createElement('div');
    announcer.setAttribute('aria-live', 'polite');
    announcer.classList.add('visually-hidden');
    document.body.append(announcer);
    let announceTimer;
    let announcedField;

    const spokenText = (node) => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
        n.replaceWith(`${n.getAttribute('aria-label')}: `);
      });
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };

    const announceError = (el) => {
      const error = document.getElementById(el.dataset.error);
      if (!error) return;
      const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
      clearTimeout(announceTimer);
      announcer.textContent = '';
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = label + spokenText(error);
      }, 500);
    };

    const supportsUserInvalid = CSS.supports('selector(:user-invalid)');
    const dirtyState = new WeakMap();
    const flagged = new WeakSet();
    const announced = new WeakSet();

    const isFieldInvalid = (el) => {
      if (supportsUserInvalid) {
        return el.matches(':user-invalid');
      }
      return el.classList.contains('user-invalid-fallback');
    };

    const syncAria = (el, announce = false) => {
      if (!el.matches?.('input, select, textarea')) return;
      const invalid = isFieldInvalid(el);
      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = '';
        }
      }
    };

    const refreshAllFields = (root = document) => {
      root.querySelectorAll('input, select, textarea').forEach((el) => {
        if (!supportsUserInvalid) {
          dirtyState.delete(el);
          el.classList.remove('user-invalid-fallback', 'user-valid-fallback');
        }
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
      });
    };

    document.querySelectorAll('input, select, textarea').forEach((el) => syncAria(el));

    if (!supportsUserInvalid) {
      const updateFallbackState = (input, announce) => {
        const isValid = input.validity.valid;
        input.classList.toggle('user-invalid-fallback', !isValid);
        input.classList.toggle('user-valid-fallback', isValid);
        syncAria(input, announce);
      };

      const handleFallbackEvent = (event) => {
        const input = event.target;
        if (!input?.matches?.('input, select, textarea')) return;

        if (event.type === 'invalid') {
          dirtyState.set(input, { hasInteracted: true, hasBlurred: true });
          announced.add(input);
          updateFallbackState(input, false);
          return;
        }

        if (event.type === 'input' || event.type === 'change') {
          const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
          state.hasInteracted = true;
          dirtyState.set(input, state);
          if (state.hasBlurred || event.type === 'change') {
            updateFallbackState(input, event.type === 'change');
          }
        } else if (event.type === 'blur') {
          const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
          state.hasBlurred = true;
          dirtyState.set(input, state);
          if (state.hasInteracted) {
            updateFallbackState(input, true);
          }
        }
      };

      document.addEventListener('blur', handleFallbackEvent, true);
      document.addEventListener('input', handleFallbackEvent);
      document.addEventListener('change', handleFallbackEvent, true);
      document.addEventListener('invalid', handleFallbackEvent, true);
    } else {
      document.addEventListener('blur', (e) => syncAria(e.target, true), true);
      document.addEventListener('input', (e) => {
        if (e.target.hasAttribute?.('aria-invalid')) syncAria(e.target);
      });
      document.addEventListener('change', (e) => syncAria(e.target, true), true);
      document.addEventListener(
        'invalid',
        (e) => {
          announced.add(e.target);
          syncAria(e.target);
        },
        true
      );
    }

    document.addEventListener(
      'reset',
      (e) => {
        setTimeout(() => refreshAllFields(e.target));
      },
      true
    );

    return { syncAria, refreshAllFields };
  }

  /**
   * Persistent toast manager using popover="manual" with focus pause,
   * ariaNotify() + live-region fallback, and deferral while a modal dialog is open.
   */
  function createToastManager() {
    const region = document.getElementById('toast-region');
    const liveRegion = document.getElementById('toast-live-region');
    const supportsPopover = Object.hasOwn(HTMLElement.prototype, 'popover');
    const deferredQueue = [];
    let toastSeq = 0;
    let lastFocusedBeforeToast = null;

    function announceToast(message) {
      if (typeof document.ariaNotify === 'function') {
        document.ariaNotify(message);
      } else if (liveRegion) {
        liveRegion.textContent = '';
        requestAnimationFrame(() => {
          liveRegion.textContent = message;
        });
      }
    }

    function openPopoverEl(el) {
      if (supportsPopover && typeof el.showPopover === 'function') {
        try {
          el.showPopover();
        } catch (_err) {
          el.classList.add(':popover-open');
        }
      } else {
        el.classList.add(':popover-open');
      }
    }

    function hidePopoverEl(el) {
      if (supportsPopover && typeof el.hidePopover === 'function') {
        try {
          el.hidePopover();
        } catch (_err) {
          el.classList.remove(':popover-open');
        }
      } else {
        el.classList.remove(':popover-open');
      }
    }

    function dismissToast(el, fromUser) {
      if (!el || !el.isConnected) return;
      if (el._dismissTimer) {
        clearTimeout(el._dismissTimer);
        el._dismissTimer = null;
      }

      const activeInside = el.contains(document.activeElement);
      hidePopoverEl(el);
      const nextToast = el.nextElementSibling || el.previousElementSibling;
      el.remove();

      if (fromUser && activeInside) {
        if (nextToast && nextToast.querySelector('.toast-close')) {
          nextToast.querySelector('.toast-close').focus();
        } else if (lastFocusedBeforeToast && lastFocusedBeforeToast.isConnected) {
          lastFocusedBeforeToast.focus();
        }
      }
    }

    function renderToast(message, variant, durationMs) {
      if (!region) return;
      toastSeq += 1;
      const toastId = `toast-item-${toastSeq}`;

      const toast = document.createElement('div');
      toast.id = toastId;
      toast.className = `toast toast--${variant}`;
      toast.setAttribute('popover', 'manual');

      const textSpan = document.createElement('span');
      textSpan.className = 'toast-message';
      textSpan.textContent = message;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'toast-close';
      closeBtn.setAttribute('popovertarget', toastId);
      closeBtn.setAttribute('popovertargetaction', 'hide');
      closeBtn.setAttribute('aria-label', 'Close notification');
      closeBtn.textContent = 'Close';

      toast.append(textSpan, closeBtn);
      region.append(toast);

      if (!region.contains(document.activeElement)) {
        lastFocusedBeforeToast = document.activeElement;
      }

      openPopoverEl(toast);
      announceToast(message);

      let remaining = durationMs;
      let startedAt = Date.now();
      let paused = false;

      const scheduleTimer = () => {
        if (durationMs <= 0 || paused) return;
        startedAt = Date.now();
        toast._dismissTimer = setTimeout(() => {
          dismissToast(toast, false);
        }, remaining);
      };

      toast.addEventListener('focusin', () => {
        paused = true;
        if (toast._dismissTimer) {
          clearTimeout(toast._dismissTimer);
          toast._dismissTimer = null;
          remaining = Math.max(1500, remaining - (Date.now() - startedAt));
        }
      });

      toast.addEventListener('focusout', (e) => {
        if (!toast.contains(e.relatedTarget)) {
          paused = false;
          scheduleTimer();
        }
      });

      toast.addEventListener('mouseenter', () => {
        paused = true;
        if (toast._dismissTimer) {
          clearTimeout(toast._dismissTimer);
          toast._dismissTimer = null;
          remaining = Math.max(1500, remaining - (Date.now() - startedAt));
        }
      });

      toast.addEventListener('mouseleave', () => {
        if (!toast.contains(document.activeElement)) {
          paused = false;
          scheduleTimer();
        }
      });

      closeBtn.addEventListener('click', () => {
        dismissToast(toast, true);
      });

      scheduleTimer();
    }

    function show(message, options = {}) {
      const variant = options.variant || 'info';
      const durationMs = options.durationMs ?? (variant === 'error' ? 0 : 5000);

      // Suppress toast while a modal dialog is open; flush once closed.
      if (document.querySelector('dialog:modal')) {
        deferredQueue.push({ message, variant, durationMs });
        return;
      }

      renderToast(message, variant, durationMs);
    }

    function flushDeferred() {
      if (document.querySelector('dialog:modal')) return;
      while (deferredQueue.length > 0) {
        const next = deferredQueue.shift();
        renderToast(next.message, next.variant, next.durationMs);
      }
    }

    for (const dlg of document.querySelectorAll('dialog')) {
      dlg.addEventListener('close', () => {
        setTimeout(flushDeferred, 40);
      });
    }

    return { show, flushDeferred };
  }

  const api = {
    initDialogLightDismissFallback,
    initFormValidationA11y,
    createToastManager,
  };

  if (globalScope) {
    globalScope.PuppyUIHelpers = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
