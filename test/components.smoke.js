/* Smoke test for the component library. No framework — plain asserts.
   Run: node test/components.smoke.js
   Stubs `window` so the browser-targeted IIFE can be loaded under Node. */
(function () {
  'use strict';
  var fails = 0;
  function ok(cond, msg) {
    if (!cond) { fails++; console.error('  FAIL: ' + msg); }
    else console.log('  ok: ' + msg);
  }
  function has(str, sub, msg) { ok(str.indexOf(sub) !== -1, msg); }

  global.window = {};
  require('../src/components.js');
  var ui = global.window.ui;

  console.log('components.js smoke test');

  // esc turns HTML-breaking characters into entities, in the correct order.
  ok(ui.esc('<b>"&\'</b>') === '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;', 'esc escapes < > " & \' to entities');

  has(ui.button({ label: 'Run', variant: 'primary' }), '<button', 'button emits <button');
  has(ui.button({ label: 'Run', variant: 'primary' }), 'btn--primary', 'button applies primary variant');
  has(ui.button({ label: 'Run', variant: 'primary', disabled: true }), 'disabled', 'button disabled state');
  has(ui.button({ label: 'Run', loading: true }), 'is-loading', 'button loading state');
  has(ui.button({ label: 'Run', loading: true }), 'aria-busy="true"', 'button loading is aria-busy');
  has(ui.button({ label: 'Go', data: { 'open-modal': 'x' } }), 'data-open-modal="x"', 'button forwards data-* attrs');

  has(ui.iconButton({ ariaLabel: 'Play', icon: '▶' }), 'aria-label="Play"', 'iconButton has accessible name');
  has(ui.iconButton({ ariaLabel: 'Play', icon: '▶' }), 'btn--icon', 'iconButton is icon-sized');

  has(ui.badge({ text: 'ok', variant: 'success' }), 'badge--success', 'badge success variant');
  has(ui.badge({ text: 'ok', variant: 'success' }), 'badge__text', 'badge carries text (not color-only)');

  has(ui.input({ id: 'q', label: 'Query' }), '<label', 'input has a label');
  has(ui.input({ id: 'q', label: 'Query', error: 'bad' }), 'aria-invalid="true"', 'input error sets aria-invalid');
  has(ui.input({ id: 'q', label: 'Query', error: 'bad' }), 'role="alert"', 'input error is announced');

  has(ui.numberField({ id: 'n', label: 'Quantum', value: 2, unit: 'tu' }), 'type="number"', 'numberField is number type');
  has(ui.numberField({ id: 'n', label: 'Quantum', value: 2, unit: 'tu' }), 'field__input--mono', 'numberField uses mono font');

  has(ui.panel({ title: 'T', body: 'B' }), 'panel__title', 'panel has title');
  has(ui.panel({ title: 'T', body: 'B', elevated: true }), 'panel--elevated', 'panel elevated variant');

  var t = ui.tabs({ id: 'alg', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], active: 'a' });
  has(t, 'role="tablist"', 'tabs has tablist role');
  has(t, 'aria-selected="true"', 'tabs marks active as selected');
  has(t, 'tabindex="-1"', 'tabs uses roving tabindex');

  has(ui.tip('help', 'x'), 'role="tooltip"', 'tip has tooltip role');
  has(ui.tip('help', 'x'), 'tabindex="0"', 'tip is keyboard focusable');

  has(ui.modal({ id: 'm', title: 'M', body: 'B' }), '<dialog', 'modal uses native dialog');
  has(ui.modal({ id: 'm', title: 'M', body: 'B' }), 'data-close-modal="m"', 'modal has close control');

  has(ui.emptyState({ title: 'Empty' }), 'empty__title', 'emptyState has title');
  has(ui.errorPanel({ message: 'boom' }), 'role="alert"', 'errorPanel is an alert region');
  has(ui.loading({ label: 'loading' }), 'spinner', 'loading has spinner');

  var pm = ui.processMarker({ id: 'P1' });
  has(pm, '--pcolor:#E8A849', 'processMarker uses P1 palette color');
  has(pm, 'pmarker__label', 'processMarker has a text label');

  if (fails) { console.error('\n' + fails + ' check(s) failed'); process.exit(1); }
  console.log('\nall checks passed');
})();
