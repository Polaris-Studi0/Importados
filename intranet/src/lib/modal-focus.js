import { useEffect } from 'react';

const panels = '.overlay > .modal, .overlay > .drawer, .modal-layer > .pqrs-detail, .modal-layer > [role="dialog"]';
const focusable = 'a[href], button, input, select, textarea, summary, [tabindex]';
const visible = element => Boolean(element.getClientRects().length) && !element.closest('[inert]');
const controls = panel => [...panel.querySelectorAll(focusable)].filter(element =>
  !element.disabled && element.tabIndex >= 0 && visible(element)
);
let titleSequence = 0;

// Covers the retained order drawers and PQRS editor while they are migrated to
// shared components. Native inputs keep their ordinary keyboard behavior.
export function useModalFocus() {
  useEffect(() => {
    let active = null;
    let restoreFocus = null;
    let isolated = [];
    let previousOverflow = '';
    let disposed = false;

    function release() {
      if (!active) return;
      isolated.forEach(element => { element.inert = false; });
      isolated = [];
      document.body.style.overflow = previousOverflow;
      active = null;
      if (restoreFocus?.isConnected && visible(restoreFocus)) restoreFocus.focus({ preventScroll: true });
      restoreFocus = null;
    }

    function activate(panel) {
      const previous = active?.contains(document.activeElement) ? restoreFocus : document.activeElement;
      release();
      active = panel;
      restoreFocus = previous;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      if (!panel.hasAttribute('aria-label') && !panel.hasAttribute('aria-labelledby')) {
        const title = panel.querySelector('h1, h2, h3');
        if (title) {
          if (!title.id) title.id = `operation-dialog-${++titleSequence}`;
          panel.setAttribute('aria-labelledby', title.id);
        } else panel.setAttribute('aria-label', 'Detalle');
      }
      if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
      const close = panel.querySelector('.close, .modal-x');
      if (close && !close.hasAttribute('aria-label')) close.setAttribute('aria-label', 'Cerrar');

      // Keep the scrim clickable, but remove the application behind its overlay
      // from keyboard and screen-reader navigation.
      let layer = panel.closest('.overlay, .modal-layer') || panel;
      while (layer.parentElement) {
        for (const sibling of layer.parentElement.children) {
          if (sibling !== layer && !sibling.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
            sibling.inert = true;
            isolated.push(sibling);
          }
        }
        if (layer.parentElement === document.body) break;
        layer = layer.parentElement;
      }
      queueMicrotask(() => {
        if (disposed || active !== panel || !panel.isConnected) return;
        if (!panel.contains(document.activeElement)) {
          const target = panel.querySelector('[autofocus], [data-autofocus]') || controls(panel)[0] || panel;
          target.focus({ preventScroll: true });
        }
      });
    }

    function synchronize() {
      const candidates = [...document.querySelectorAll(panels)].filter(element => element.getClientRects().length);
      const panel = candidates.at(-1) || null;
      if (panel === active) return;
      if (panel) activate(panel);
      else release();
    }

    function keydown(event) {
      if (!active) return;
      if (event.key === 'Escape') {
        const close = active.querySelector('.close, .modal-x, [data-dialog-close], [aria-label="Cerrar"]');
        if (close && !close.disabled) { event.preventDefault(); event.stopPropagation(); close.click(); }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = controls(active);
      const first = items[0];
      const last = items.at(-1);
      if (!first) { event.preventDefault(); active.focus(); return; }
      if (!active.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', keydown, true);
    synchronize();
    return () => { disposed = true; observer.disconnect(); document.removeEventListener('keydown', keydown, true); release(); };
  }, []);
}
