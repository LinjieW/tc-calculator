/* ============================================================
   select-menu.js — replace the native single-select popup with a styled
   listbox, WITHOUT replacing the select.
   Zero dependencies, zero network. Drop it in; it wires itself.

   The real <select> stays in the DOM and stays the owner of everything
   that matters: the form value, the label association, focus, and every
   `change` handler already written against it. This file only borrows
   the popup — which is the one part of a select the browser will not let
   you style.

   DESIGN RULE — browsing the list is TENTATIVE.
   Arrows, Home/End and typeahead move the HIGHLIGHT only. Nothing is
   selected, no value changes, no event fires. Only Enter, Space or a
   click on an option COMMITS, and even then `input` + `change` are
   dispatched only if the selection actually changed. This is the native
   macOS behaviour, and it is what lets a keyboard user look through the
   options of an expensive control (one that re-runs something on change)
   without setting it off at every step. Escape, Tab, a click outside and
   losing focus all abandon the browse and leave the value untouched.

   CSS contract: .ui-select-menu (the listbox), .ui-select-group (an
   optgroup heading), .ui-select-option, .ui-select-option.active (the
   highlight — NOT the selection).
   ============================================================ */
(() => {
  'use strict';
  let current = null, serial = 0;

  // Only take over the selects the native popup is actually used for. A multiple
  // or sized select renders as an inline list box, which is already styleable and
  // already has its own keyboard model — hijacking it would be a regression.
  const eligible = node => node instanceof HTMLSelectElement && !node.disabled && !node.multiple && node.size <= 1;
  const enabled = option => !!option && !option.disabled && !(option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled) && !option.hidden;

  function close() {
    if (!current) return;
    const {select, menu} = current;
    select.setAttribute('aria-expanded', 'false');
    select.removeAttribute('aria-controls');
    select.removeAttribute('aria-activedescendant');
    menu.remove(); current = null;
  }

  // Moves the highlight only — see the design rule above. aria-activedescendant is
  // how the screen reader follows it while focus stays on the select.
  function highlight(index) {
    const c = current;
    if (!c || !c.options[index] || !enabled(c.options[index])) return;
    c.index = index;
    c.rows.forEach((row, i) => row.classList.toggle('active', i === index));
    c.select.setAttribute('aria-activedescendant', c.rows[index].id);
    c.rows[index].scrollIntoView({block:'nearest'});
  }

  function move(direction) {
    const c = current;
    // Step over disabled/hidden options, and stop at the ends rather than wrapping:
    // a list that wraps makes "hold down arrow" impossible to land with.
    for (let i = c.index + direction; i >= 0 && i < c.options.length; i += direction) {
      if (enabled(c.options[i])) { highlight(i); break; }
    }
  }

  function commit(index) {
    const c = current;
    if (!c || !enabled(c.options[index]) || !eligible(c.select)) return;
    const changed = c.select.selectedIndex !== index;
    c.select.selectedIndex = index;
    close();
    c.select.focus({preventScroll:true});
    // Only a real change fires. Re-picking what was already selected is a no-op, and
    // dispatching anyway would re-trigger whatever the app does on change.
    if (changed) {
      c.select.dispatchEvent(new Event('input', {bubbles:true}));
      c.select.dispatchEvent(new Event('change', {bubbles:true}));
    }
  }

  function open(select) {
    close();
    const options = Array.from(select.options);
    if (!options.length) return;
    const menu = document.createElement('div');
    menu.className = 'ui-select-menu'; menu.id = `ui-select-${++serial}`;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', select.getAttribute('aria-label') || Array.from(select.labels || [], l => l.textContent).join(' ') || select.id);
    // popover=manual takes the menu into the top layer, so it escapes any ancestor
    // overflow/transform/z-index that would otherwise clip it. "manual" because this
    // file owns every open and close path itself.
    menu.setAttribute('popover', 'manual');
    let group = null;
    const rows = options.map((option, index) => {
      if (option.parentElement.tagName === 'OPTGROUP' && option.parentElement !== group) {
        group = option.parentElement;
        const heading = document.createElement('div'); heading.className = 'ui-select-group';
        heading.textContent = group.label; menu.appendChild(heading);
      }
      const row = document.createElement('div'); row.className = 'ui-select-option';
      row.id = `${menu.id}-${index}`; row.textContent = option.label;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === select.selectedIndex));
      row.setAttribute('aria-disabled', String(!enabled(option))); row.hidden = option.hidden;
      // Focus must never leave the select: it stays the focus owner so that label
      // clicks, :focus-visible styling and the page's own focus handling keep working.
      row.addEventListener('pointerdown', e => e.preventDefault());
      row.addEventListener('click', () => commit(index));
      row.addEventListener('pointermove', () => highlight(index));
      menu.appendChild(row); return row;
    });
    document.body.appendChild(menu);
    if (menu.showPopover) menu.showPopover();
    const rect = select.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    // Flip up only when below is genuinely too short AND up is roomier — flipping on
    // "below is smaller" alone makes the menu jump sides on a barely-scrolled page.
    const upward = below < 200 && above > below;
    menu.style.minWidth = Math.min(rect.width, innerWidth - 16) + 'px';
    menu.style.maxHeight = Math.max(40, Math.min(320, upward ? above : below)) + 'px';
    // Measure AFTER min-width/max-height are applied: the width below is the laid-out
    // width (long labels widen it past the select), not the select's own.
    const width = menu.getBoundingClientRect().width;
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
    menu.style.top = (upward ? Math.max(8, rect.top - menu.offsetHeight - 5) : rect.bottom + 5) + 'px';
    current = {select, menu, options, rows, index:select.selectedIndex, prefix:'', typedAt:0};
    select.setAttribute('aria-expanded', 'true'); select.setAttribute('aria-controls', menu.id);
    select.focus({preventScroll:true});
    // Open onto the current value; if that one is disabled, onto the first that is not.
    highlight(enabled(options[select.selectedIndex]) ? select.selectedIndex : options.findIndex(enabled));
  }

  // pointerdown, not click: preventDefault here is what stops the browser's own
  // popup from ever appearing. By click it is already up.
  document.addEventListener('pointerdown', e => {
    if (eligible(e.target)) {
      e.preventDefault();
      if (current && current.select === e.target) close(); else open(e.target);
    } else if (current && !current.menu.contains(e.target)) close();
  });

  // Capture phase: Escape has to be claimed before a page-level Escape handler
  // (a dialog, a drawer) sees it and closes something behind the menu instead.
  document.addEventListener('keydown', e => {
    const select = e.target;
    if (!eligible(select)) return;
    if (e.key === 'Tab') { close(); return; }   // abandon the browse; let focus move on
    if (e.key === 'Escape') {
      // Only swallow it while open. A stray Escape on a closed select still belongs
      // to whatever the page wants it for.
      if (current) { e.preventDefault(); e.stopPropagation(); close(); }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;   // leave browser/OS shortcuts alone
    if (['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key)) {
      e.preventDefault();
      if (!current || current.select !== select) { open(select); return; }
      if (e.key === 'Enter' || e.key === ' ') { commit(current.index); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') move(e.key === 'ArrowDown' ? 1 : -1);
      else {
        const indices = current.options.map((o,i) => enabled(o) ? i : -1).filter(i => i >= 0);
        highlight(e.key === 'Home' ? indices[0] : indices[indices.length - 1]);
      }
    } else if (e.key.length === 1) {
      e.preventDefault();
      if (!current || current.select !== select) open(select);
      if (!current) return;
      // Typeahead: keys within 700ms extend the prefix, a later key starts over.
      // That window is what makes both "s, s, s" (cycle-ish) and "sa" (a real prefix)
      // land where the user meant.
      const now = Date.now();
      current.prefix = now - current.typedAt > 700 ? e.key : current.prefix + e.key;
      current.typedAt = now;
      const prefix = current.prefix.toLocaleLowerCase();
      const index = current.options.findIndex(o => enabled(o) && o.label.toLocaleLowerCase().startsWith(prefix));
      if (index >= 0) highlight(index);
    }
  }, true);

  // Teardown paths. A menu is positioned once, in viewport coordinates, so anything
  // that moves the select out from under it must close it rather than let it float
  // somewhere wrong.
  document.addEventListener('focusin', e => { if (current && e.target !== current.select) close(); });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', e => { if (current && !current.menu.contains(e.target)) close(); }, true);
  // ...including the cases no event announces: the select being removed, disabled or
  // hidden by a re-render while its menu is up.
  new MutationObserver(() => {
    if (current && (!current.select.isConnected || !eligible(current.select) || !current.select.getClientRects().length)) close();
  }).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['disabled','class','hidden']});
})();
