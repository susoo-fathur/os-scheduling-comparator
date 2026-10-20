/* CPU Scheduling Lab — reusable UI components (vanilla, zero deps).
   Each function returns an HTML string built from design tokens.
   States (default/hover/focus/disabled/loading) are handled in components.css. */
(function () {
  'use strict';

  // Escape untrusted text so static demos cannot inject markup.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function dataAttrs(data) {
    return Object.keys(data || {})
      .map(function (k) { return 'data-' + k + '="' + esc(data[k]) + '"'; })
      .join(' ');
  }

  // Inline SVG line-icon set (no dependency). Single 24×24 viewBox,
  // stroke=currentColor so icons inherit button/text color. Filled marks
  // (play, dots) override fill per-path.
  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>',
    play: '<path d="M7 4.5 L19 12 L7 19.5 Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
    'step-back': '<line x1="18.5" y1="5" x2="18.5" y2="19"/><path d="M14.5 5 L5.5 12 L14.5 19 Z" fill="currentColor" stroke="none"/>',
    'step-fwd': '<line x1="5.5" y1="5" x2="5.5" y2="19"/><path d="M9.5 5 L18.5 12 L9.5 19 Z" fill="currentColor" stroke="none"/>',
    reset: '<path d="M4 12 A8 8 0 1 0 6.5 6"/><polyline points="4 4 4 7 7 7"/>',
    chart: '<line x1="4" y1="20" x2="21" y2="20"/><rect x="6" y="13" width="3" height="7" rx="0.5"/><rect x="11" y="9" width="3" height="11" rx="0.5"/><rect x="16" y="15" width="3" height="5" rx="0.5"/>',
    bookmark: '<path d="M6 3.5 H18 V21 L12 16.5 L6 21 Z"/>',
    inspect: '<circle cx="11" cy="11" r="6.5"/><line x1="15.5" y1="15.5" x2="20" y2="20"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    x: '<line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5"/>',
    check: '<path d="M5 12.5 L10 17.5 L19 7"/>',
    alert: '<path d="M12 4 L21 19 L3 19 Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="15.5"/><circle cx="12" cy="8.2" r="0.9" fill="currentColor" stroke="none"/>',
    error: '<circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12.5 L10.5 15.5 L16.5 8.5"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<line x1="4" y1="7" x2="20" y2="7"/><path d="M9 7 V4.5 H15 V7"/><path d="M6.5 7 L7.5 20 H16.5 L17.5 7"/>',
    inbox: '<path d="M4 13 L8 13 L10 16 L14 16 L16 13 L20 13"/><path d="M4 13 L4 5 H20 V13 L18 19 H6 L4 13 Z"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5"/><line x1="9" y1="3" x2="9" y2="6"/><line x1="15" y1="3" x2="15" y2="6"/><line x1="9" y1="18" x2="9" y2="21"/><line x1="15" y1="18" x2="15" y2="21"/><line x1="3" y1="9" x2="6" y2="9"/><line x1="3" y1="15" x2="6" y2="15"/><line x1="18" y1="9" x2="21" y2="9"/><line x1="18" y1="15" x2="21" y2="15"/>'
  };
  function icon(name, size) {
    size = size || 18;
    var body = ICONS[name] || ICONS.info;
    return '<svg class="icon" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  var VARIANTS = ['primary', 'secondary', 'ghost', 'danger'];

  function button(opts) {
    opts = opts || {};
    var variant = VARIANTS.indexOf(opts.variant) >= 0 ? opts.variant : 'secondary';
    var cls = ['btn', 'btn--' + variant];
    if (opts.size === 'sm') cls.push('btn--sm');
    if (opts.loading) cls.push('is-loading');
    var blocked = opts.disabled || opts.loading;
    var attrs = [
      'class="' + cls.join(' ') + '"',
      'type="' + (opts.type || 'button') + '"',
      blocked ? 'disabled' : '',
      opts.loading ? 'aria-busy="true"' : '',
      opts.ariaLabel ? 'aria-label="' + esc(opts.ariaLabel) + '"' : '',
      dataAttrs(opts.data)
    ].filter(Boolean).join(' ');
    var spin = opts.loading ? '<span class="spinner" aria-hidden="true"></span>' : '';
    var icon = opts.icon ? '<span class="btn__icon" aria-hidden="true">' + opts.icon + '</span>' : '';
    return '<button ' + attrs + '>' + spin + icon + '<span class="btn__label">' + esc(opts.label) + '</span></button>';
  }

  function iconButton(opts) {
    opts = opts || {};
    var variant = VARIANTS.indexOf(opts.variant) >= 0 ? opts.variant : 'ghost';
    var cls = ['btn', 'btn--icon', 'btn--' + variant];
    if (opts.size === 'sm') cls.push('btn--sm');
    var attrs = [
      'class="' + cls.join(' ') + '"',
      'type="button"',
      opts.disabled ? 'disabled' : '',
      'aria-label="' + esc(opts.ariaLabel || opts.label) + '"',
      'title="' + esc(opts.ariaLabel || opts.label) + '"',
      dataAttrs(opts.data)
    ].filter(Boolean).join(' ');
    return '<button ' + attrs + '><span class="btn__icon" aria-hidden="true">' + (opts.icon || '') + '</span></button>';
  }

  function badge(opts) {
    opts = opts || {};
    var variant = ['neutral', 'success', 'warning', 'error'].indexOf(opts.variant) >= 0 ? opts.variant : 'neutral';
    var dot = opts.dot !== false ? '<span class="badge__dot" aria-hidden="true"></span>' : '';
    return '<span class="badge badge--' + variant + '">' + dot + '<span class="badge__text">' + esc(opts.text) + '</span></span>';
  }

  function input(opts) {
    opts = opts || {};
    var id = opts.id;
    var errId = opts.error ? id + '-err' : '';
    var hintId = opts.hint ? id + '-hint' : '';
    var described = [errId, hintId].filter(Boolean).join(' ');
    var attrs = [
      'id="' + esc(id) + '"',
      'type="' + (opts.type || 'text') + '"',
      'class="field__input' + (opts.error ? ' is-invalid' : '') + '"',
      opts.value != null ? 'value="' + esc(opts.value) + '"' : '',
      opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : '',
      opts.disabled ? 'disabled' : '',
      described ? 'aria-describedby="' + esc(described) + '"' : '',
      opts.error ? 'aria-invalid="true"' : '',
      opts.ariaLabel ? 'aria-label="' + esc(opts.ariaLabel) + '"' : ''
    ].filter(Boolean).join(' ');
    return '<div class="field">' +
      '<label class="field__label" for="' + esc(id) + '">' + esc(opts.label) + '</label>' +
      '<input ' + attrs + ' />' +
      (opts.hint ? '<p class="field__hint" id="' + hintId + '">' + esc(opts.hint) + '</p>' : '') +
      (opts.error ? '<p class="field__error" id="' + errId + '" role="alert">' + esc(opts.error) + '</p>' : '') +
      '</div>';
  }

  function numberField(opts) {
    opts = opts || {};
    var id = opts.id;
    var hintId = opts.hint ? id + '-hint' : '';
    var attrs = [
      'id="' + esc(id) + '"',
      'type="number"',
      'class="field__input field__input--mono"',
      opts.value !== '' && opts.value != null ? 'value="' + esc(opts.value) + '"' : '',
      opts.min != null ? 'min="' + esc(opts.min) + '"' : '',
      opts.max != null ? 'max="' + esc(opts.max) + '"' : '',
      'step="' + esc(opts.step != null ? opts.step : 1) + '"',
      opts.disabled ? 'disabled' : '',
      hintId ? 'aria-describedby="' + esc(hintId) + '"' : '',
      dataAttrs(opts.data)
    ].filter(Boolean).join(' ');
    return '<div class="field">' +
      '<label class="field__label" for="' + esc(id) + '">' + esc(opts.label) + '</label>' +
      '<div class="field__control">' +
      '<input ' + attrs + ' />' +
      (opts.unit ? '<span class="field__unit" aria-hidden="true">' + esc(opts.unit) + '</span>' : '') +
      '</div>' +
      (opts.hint ? '<p class="field__hint" id="' + hintId + '">' + esc(opts.hint) + '</p>' : '') +
      '</div>';
  }

  function panel(opts) {
    opts = opts || {};
    var cls = ['panel', opts.elevated ? 'panel--elevated' : ''].filter(Boolean).join(' ');
    var head = (opts.title || opts.actions) ?
      '<div class="panel__head">' +
      (opts.title ? '<h2 class="panel__title">' + esc(opts.title) + '</h2>' : '') +
      (opts.actions ? '<div class="panel__actions">' + opts.actions + '</div>' : '') +
      '</div>' : '';
    var foot = opts.footer ? '<div class="panel__footer">' + opts.footer + '</div>' : '';
    return '<section class="' + cls + '"' + (opts.id ? ' id="' + esc(opts.id) + '"' : '') + '>' +
      head + '<div class="panel__body">' + opts.body + '</div>' + foot + '</section>';
  }

  function tabs(opts) {
    opts = opts || {};
    var btns = opts.items.map(function (it) {
      var sel = it.id === opts.active;
      var cls = ['tab', sel ? 'is-active' : '', it.disabled ? 'is-disabled' : ''].filter(Boolean).join(' ');
      return '<button type="button" role="tab" class="' + cls + '"' +
        ' id="' + esc(opts.id) + '-tab-' + esc(it.id) + '"' +
        ' aria-selected="' + sel + '"' +
        ' tabindex="' + (sel ? 0 : -1) + '"' +
        ' data-tab="' + esc(it.id) + '"' +
        (it.disabled ? ' disabled' : '') + '><span>' + esc(it.label) + '</span></button>';
    }).join('');
    return '<div class="tabs" role="tablist" aria-label="' + esc(opts.label || opts.id) + '" data-tabs="' + esc(opts.id) + '">' + btns + '</div>';
  }

  // Tooltip: wraps content; tip text is in-DOM (role=tooltip), shown on hover/focus.
  function tip(text, inner) {
    return '<span class="tip" tabindex="0">' + inner + '<span class="tip__text" role="tooltip">' + esc(text) + '</span></span>';
  }

  function modal(opts) {
    opts = opts || {};
    return '<dialog class="modal" id="' + esc(opts.id) + '" aria-labelledby="' + esc(opts.id) + '-title">' +
      '<div class="modal__box">' +
      '<div class="modal__head">' +
      '<h2 class="modal__title" id="' + esc(opts.id) + '-title">' + esc(opts.title) + '</h2>' +
      '<button type="button" class="btn btn--icon btn--ghost modal__close" aria-label="Close dialog" data-close-modal="' + esc(opts.id) + '"><span class="btn__icon" aria-hidden="true">' + icon('x', 16) + '</span></button>' +
      '</div>' +
      '<div class="modal__body">' + opts.body + '</div>' +
      (opts.actions ? '<div class="modal__footer">' + opts.actions + '</div>' : '') +
      '</div></dialog>';
  }

  function emptyState(opts) {
    opts = opts || {};
    return '<div class="empty">' +
      '<div class="empty__icon" aria-hidden="true">' + (opts.icon || icon('inbox', 26)) + '</div>' +
      '<p class="empty__title">' + esc(opts.title) + '</p>' +
      (opts.description ? '<p class="empty__desc">' + esc(opts.description) + '</p>' : '') +
      (opts.action ? '<div class="empty__action">' + opts.action + '</div>' : '') +
      '</div>';
  }

  function errorPanel(opts) {
    opts = opts || {};
    return '<div class="errpanel" role="alert">' +
      '<div class="errpanel__icon" aria-hidden="true">' + icon('alert', 16) + '</div>' +
      '<div class="errpanel__content">' +
      '<p class="errpanel__title">' + esc(opts.message) + '</p>' +
      (opts.detail ? '<p class="errpanel__detail">' + esc(opts.detail) + '</p>' : '') +
      '</div></div>';
  }

  function loading(opts) {
    opts = opts || {};
    return '<div class="loader" role="status" aria-live="polite">' +
      '<span class="spinner spinner--lg" aria-hidden="true"></span>' +
      '<span class="loader__label">' + esc(opts.label || 'Loading…') + '</span></div>';
  }

  var PROCESS_COLORS = {
    P1: '#6EE7B7', P2: '#C4B5FD', P3: '#7DD3FC',
    P4: '#FDA4AF', P5: '#FDE68A', P6: '#F0ABFC', Idle: '#2A353B'
  };

  function processMarker(opts) {
    opts = opts || {};
    // Explicit color/label win; fall back to palette-by-id (P1..P6/Idle) for Phase 1 callers.
    var color = opts.color || PROCESS_COLORS[opts.id] || PROCESS_COLORS.Idle;
    var label = opts.label || opts.id;
    return '<span class="pmarker pmarker--' + (opts.size || 'md') + '" style="--pcolor:' + color + '">' +
      '<span class="pmarker__dot" aria-hidden="true"></span>' +
      '<span class="pmarker__label">' + esc(label) + '</span></span>';
  }

  window.ui = {
    esc: esc,
    button: button,
    iconButton: iconButton,
    badge: badge,
    input: input,
    numberField: numberField,
    panel: panel,
    tabs: tabs,
    tip: tip,
    modal: modal,
    emptyState: emptyState,
    errorPanel: errorPanel,
    loading: loading,
    processMarker: processMarker,
    PROCESS_COLORS: PROCESS_COLORS,
    icon: icon,
    ICONS: ICONS
  };
})();
