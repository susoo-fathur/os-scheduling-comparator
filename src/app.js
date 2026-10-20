/* OS Scheduling Comparator — shell, router, controller, playback lifecycle. */
(function () {
  'use strict';
  var ui = window.ui, kit = window.kit, store = window.store, scheduler = window.scheduler;
  var playback = window.playback, comparison = window.comparison, benchmark = window.benchmark;
  var reports = window.reports, persistence = window.persistence;

  var persist = persistence.create();
  var ROUTES = [
    { path: 'overview', label: 'Overview' },
    { path: 'simulate', label: 'Simulate' },
    { path: 'compare', label: 'Compare' },
    { path: 'reports', label: 'Reports' }
  ];
  var DEFAULT_PATH = 'overview';

  var runConfig = { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: 2, contextSwitchCost: 0 };
  var datasetMeta = { source: 'preset', seed: null, name: 'Small demo' };
  var sim = { result: null, sig: null, playback: null, speed: 1, recordedSig: null, error: null };
  var cmp = { mode: 'single', metric: 'avgWaiting', sort: null, detailId: null, recordedSig: null };
  var bench = {
    form: { sizes: '10, 50, 100, 250, 500, 1000', rounds: 10, seed: 'bench-1', quantum: 2, ctx: 0,
      arrivalMin: 0, arrivalMax: 20, burstMin: 1, burstMax: 10, priorityMin: 1, priorityMax: 5 },
    runner: null, result: null, running: false, progress: null, error: null, metric: 'avgWaiting'
  };
  var report = { kind: 'simulation', selectedId: null };

  /* ---------- restore active state ---------- */
  (function restore() {
    var active = persist.loadActive();
    if (!active) return;
    var r = store.replaceAll(active.dataset);
    if (!r.ok) return;
    runConfig = active.config;
    if (active.meta) datasetMeta = active.meta;
  })();

  function currentPath() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    return ROUTES.some(function (r) { return r.path === h; }) ? h : DEFAULT_PATH;
  }
  function signature() {
    return JSON.stringify({
      d: store.getState().processes,
      a: runConfig.algorithm, pm: runConfig.priorityMode,
      q: runConfig.quantum, c: runConfig.contextSwitchCost
    });
  }

  var persistTimer = null;
  function persistActive() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      persist.saveActive({ dataset: store.getState().processes, config: runConfig, meta: datasetMeta });
    }, 400);
  }

  /* ---------- playback lifecycle ---------- */
  function ensureSimulation() {
    var procs = store.getState().processes;
    if (!procs.length) {
      if (sim.playback) { sim.playback.dispose(); sim.playback = null; }
      sim.result = null; sim.error = null; sim.sig = null;
      return;
    }
    var sig = signature();
    if (sim.sig === sig && sim.playback) return;
    var changed = sim.sig !== sig;
    if (sim.playback) { sim.playback.dispose(); sim.playback = null; }
    sim.sig = sig;
    if (changed) sim.recordedSig = null;
    try {
      sim.result = scheduler.simulate({
        processes: procs, algorithm: runConfig.algorithm, quantum: runConfig.quantum,
        contextSwitchCost: runConfig.contextSwitchCost, priorityMode: runConfig.priorityMode,
        trace: true
      });
      sim.error = null;
      sim.playback = playback.createPlayback(sim.result, { speed: sim.speed });
      sim.playback.onChange = function (state, snap) {
        renderLive(state, snap);
        if (state.status === 'complete') recordSimulation();
      };
    } catch (e) {
      sim.result = null; sim.error = e && e.message ? e.message : String(e);
      sim.playback = null;
    }
  }

  function recordSimulation() {
    if (!sim.result || sim.recordedSig === sim.sig) return;
    var label = sim.result.algorithm === 'priority'
      ? 'Priority ' + (runConfig.priorityMode === 'preemptive' ? 'P' : 'NP')
      : sim.result.algorithm.toUpperCase();
    var dataset = store.getState().processes;
    // Large runs: keep metrics + per-process table, omit the timeline to stay
    // within the storage budget. Small runs keep the full timeline.
    // The explanation trace is display-only and never persisted.
    var snapshot = Object.assign({}, sim.result);
    delete snapshot.decisions;
    delete snapshot.traceTruncated;
    if (dataset.length > 500) {
      snapshot = Object.assign(snapshot, { segments: [], timelineOmitted: true });
    }
    var res = persist.addRecord({
      kind: 'simulation',
      name: 'Simulation · ' + label + ' · ' + sim.result.completedCount + ' processes',
      dataset: dataset,
      config: { algorithm: runConfig.algorithm, priorityMode: runConfig.priorityMode, quantum: runConfig.quantum, contextSwitchCost: runConfig.contextSwitchCost },
      result: snapshot
    });
    if (res.ok) {
      sim.recordedSig = sim.sig;
      toast('Run recorded to history', 'success');
    } else toast(res.error, 'error');
  }

  /* ---------- live DOM updates (no full re-render) ---------- */
  // Handles cached per rendered screen so a playback tick touches only what
  // actually changed. Reset whenever the Gantt element is replaced.
  var live = { host: null, segs: [], revealed: -1, active: -1, queueSig: null, cpuKey: null, statusKey: null, iconKey: null, rows: null,
    explainHost: null, explainKey: null, metricHost: null, metricSig: null };

  function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }

  function segmentCache(gantt) {
    if (live.host === gantt) return;
    var nodes = document.querySelectorAll('.gantt-seg');
    var segs = [];
    for (var i = 0; i < nodes.length; i++) {
      segs.push({
        el: nodes[i],
        start: parseFloat(nodes[i].getAttribute('data-start')),
        end: parseFloat(nodes[i].getAttribute('data-end')),
        type: nodes[i].getAttribute('data-type')
      });
    }
    segs.sort(function (a, b) { return a.start - b.start; });
    live.host = gantt; live.segs = segs;
    live.revealed = -1; live.active = -1;
    live.queueSig = null; live.cpuKey = null; live.statusKey = null; live.iconKey = null; live.rows = null;
  }

  // Reveal reached segments and flag the one under the playhead. Segments are
  // sorted, so one crossing count is enough and class writes happen only for
  // the segments that changed — never a full chart re-render per tick.
  function paintTimeline(gantt, t, isPlaying) {
    segmentCache(gantt);
    var segs = live.segs, i;
    if (segs.length) {
      var count = 0;
      while (count < segs.length && segs[count].start <= t) count++;
      if (live.revealed < 0) {
        for (i = 0; i < segs.length; i++) segs[i].el.classList.toggle('gantt-seg--future', segs[i].start > t);
      } else if (count > live.revealed) {
        for (i = live.revealed; i < count; i++) segs[i].el.classList.remove('gantt-seg--future');
      } else if (count < live.revealed) {
        for (i = count; i < live.revealed; i++) segs[i].el.classList.add('gantt-seg--future');
      }
      live.revealed = count;
      var active = (count > 0 && segs[count - 1].end > t && segs[count - 1].type === 'process') ? count - 1 : -1;
      if (active !== live.active) {
        if (live.active >= 0) segs[live.active].el.classList.remove('is-active');
        if (active >= 0) segs[active].el.classList.add('is-active');
        live.active = active;
      }
    }
    if (gantt.classList) gantt.classList.toggle('is-playing', !!isPlaying);
  }

  function renderReadyQueue(snap) {
    var rq = document.getElementById('sim-ready');
    if (!rq) return;
    var sig = snap.readyQueue.join(',');
    if (sig === live.queueSig) return;
    var prev = live.queueSig === null ? null : live.queueSig.split(',');
    live.queueSig = sig;
    var procs = store.getState().processes;
    var html = snap.readyQueue.slice(0, 40).map(function (pid) {
      var isNew = prev && prev.indexOf(String(pid)) < 0;
      return '<li' + (isNew ? ' class="is-enter"' : '') + '>' +
        ui.processMarker({ color: kit.processColor(procs, pid), label: 'P' + pid, size: 'sm' }) + '</li>';
    }).join('');
    if (snap.readyQueue.length > 40) html += '<li class="muted small">+' + (snap.readyQueue.length - 40) + '</li>';
    rq.innerHTML = html || '<li class="muted small">empty</li>';
  }

  // Build rows once, then patch only the cells whose text differs. With 200
  // rows this turns a per-tick table rebuild into a handful of text writes.
  function renderProcessTable(snap) {
    var body = document.getElementById('sim-procs-body');
    if (!body) return;
    var list = snap.processes.slice(0, 200);
    var refs = live.rows;
    if (!refs || refs.length !== list.length || (refs.length && refs[0].node.parentNode !== body)) {
      body.innerHTML = list.map(function (p) {
        return '<tr data-pid="' + p.pid + '"><td class="mono">P' + p.pid + '</td><td class="mono">' + p.arrivalTime +
          '</td><td class="mono">' + p.burstTime + '</td><td class="mono">' + p.priority +
          '</td><td><span class="status status--' + p.status + '">' + p.status + '</span></td>' +
          '<td class="mono">' + p.remaining + '</td><td class="mono">' + (p.status === 'completed' ? p.completionTime : '—') + '</td></tr>';
      }).join('') + (snap.processes.length > 200 ? '<tr><td colspan="7" class="muted small">Showing 200 of ' + snap.processes.length + ' processes.</td></tr>' : '');
      refs = [];
      var rows = body.querySelectorAll('tr');
      for (var i = 0; i < list.length && i < rows.length; i++) {
        var cs = rows[i].querySelectorAll('td');
        if (cs.length < 7) { refs = null; break; }
        refs.push({ node: rows[i], status: cs[4].firstElementChild || cs[4], rem: cs[5], comp: cs[6] });
      }
      live.rows = refs;
      if (!refs) return; // minimal DOM (tests): the rebuild above is all we can do
    }
    for (var j = 0; j < refs.length; j++) {
      var p = list[j], r = refs[j];
      if (r.status.textContent !== p.status) {
        r.status.textContent = p.status;
        r.status.className = 'status status--' + p.status;
      }
      setText(r.rem, String(p.remaining));
      setText(r.comp, p.status === 'completed' ? String(p.completionTime) : '—');
    }
  }

  function renderExplanation(t) {
    var body = document.getElementById('sim-explain-body');
    if (!body || !sim.result) return;
    var timeEl = document.getElementById('sim-explain-time');
    if (timeEl) setText(timeEl, 't=' + t);
    var key = sim.sig + ':' + t;
    if (live.explainHost === body && live.explainKey === key) return;
    live.explainHost = body; live.explainKey = key;
    body.innerHTML = kit.decisionExplanation(sim.result, t);
  }

  // Rebuild only when a process changes status; formula values themselves are final
  // once their inputs exist, so per-tick rebuilds would be wasted work.
  function renderMetricBreakdown(snap) {
    var host = document.getElementById('sim-metrics');
    if (!host || !sim.result) return;
    var sig = snap.processes.map(function (p) { return p.status; }).join(',');
    if (live.metricHost === host && live.metricSig === sig) return;
    live.metricHost = host; live.metricSig = sig;
    host.innerHTML = kit.metricBreakdown(sim.result, snap.time, {
      colorFor: function (pid) { return kit.processColor(store.getState().processes, pid); }
    });
  }

  function renderLive(state, snap) {
    var timeEl = document.getElementById('sim-time');
    if (!timeEl) return; // not on the Simulate screen
    if (document.hidden) return; // tab hidden: keep simulation, skip decoration
    setText(timeEl, 't = ' + state.currentTime + ' / ' + state.duration);
    var statusEl = document.getElementById('sim-status');
    if (statusEl) {
      if (live.statusKey !== state.status) { statusEl.textContent = state.status; live.statusKey = state.status; }
      var statusCls = 'pb-state pb-state--' + state.status;
      if (statusEl.className !== statusCls) statusEl.className = statusCls;
    }
    var gantt = document.querySelector('.gantt[data-scale]');
    if (gantt) {
      var scale = parseFloat(gantt.getAttribute('data-scale')) || 0;
      var cursor = document.getElementById('sim-cursor');
      if (cursor && cursor.style) cursor.style.transform = 'translateX(' + (state.currentTime * scale) + 'px)';
      paintTimeline(gantt, state.currentTime, state.isPlaying);
      var track = document.getElementById('sim-track');
      if (track && state.isPlaying) {
        var x = state.currentTime * scale;
        if (x > track.scrollLeft + track.clientWidth - 120) track.scrollLeft = Math.max(0, x - 120);
      }
    }
    var scrub = document.getElementById('sim-scrub');
    if (scrub && document.activeElement !== scrub) scrub.value = state.currentTime;
    var toggle = document.querySelector('[data-action="pb-toggle"]');
    if (toggle) {
      var label = toggle.querySelector('.btn__label');
      if (label) setText(label, state.isPlaying ? 'Pause' : 'Start');
      var icon = toggle.querySelector('.btn__icon');
      var iconKey = state.isPlaying ? 'pause' : 'play';
      if (icon && live.iconKey !== iconKey) { icon.innerHTML = ui.icon(iconKey, 15); live.iconKey = iconKey; }
    }
    var cpu = document.getElementById('sim-cpu');
    if (cpu) {
      var cpuKey = snap.running == null ? snap.cpuState : 'P' + snap.running;
      var cpuText = snap.cpuState === 'process' ? 'P' + snap.running
        : snap.cpuState === 'idle' ? 'idle'
        : snap.cpuState === 'context-switch' ? 'context switch'
        : snap.cpuState === 'done' ? 'finished' : '—';
      setText(cpu, cpuText);
      if (live.cpuKey !== null && live.cpuKey !== cpuKey && cpu.classList) {
        cpu.classList.remove('is-swap');
        void cpu.offsetWidth;
        cpu.classList.add('is-swap');
      }
      live.cpuKey = cpuKey;
    }
    renderReadyQueue(snap);
    var na = document.getElementById('sim-na');
    if (na) setText(na, snap.notArrived.length ? snap.notArrived.slice(0, 20).map(function (p) { return 'P' + p; }).join(', ') + (snap.notArrived.length > 20 ? ' …' : '') : '—');
    var done = document.getElementById('sim-completed');
    if (done) setText(done, snap.completed.length ? snap.completed.slice(0, 20).map(function (p) { return 'P' + p; }).join(', ') + (snap.completed.length > 20 ? ' …' : '') : '—');
    renderProcessTable(snap);
    renderExplanation(snap.time);
    renderMetricBreakdown(snap);
  }

  /* ---------- shell ---------- */
  function shellHTML() {
    var nav = ROUTES.map(function (r) {
      return '<li><a class="nav__link" href="#/' + r.path + '" data-nav="' + r.path + '">' + ui.esc(r.label) + '</a></li>';
    }).join('');
    return '<div class="shell">' +
      '<aside class="sidebar" id="sidebar" aria-label="Primary navigation">' +
      '<div class="sidebar__brand"><span class="brand__mark" aria-hidden="true"><svg viewBox="0 0 28 28" width="22" height="22"><path d="M3 19 L3 9 L10 9 L10 19 L18 19 L18 9 L25 9" fill="none" stroke="currentColor" stroke-width="2.5"/></svg></span>' +
      '<span class="brand__name">Scheduling<br/>Comparator</span></div>' +
      '<nav class="nav" aria-label="Sections"><ul class="nav__list">' + nav + '</ul></nav>' +
      '<div class="sidebar__meta"><span class="sidebar__meta-label">Active dataset</span>' +
      '<strong class="mono" id="nav-count">' + store.getCount() + ' processes</strong>' +
      '<span class="muted small" id="nav-source">' + ui.esc(datasetMeta.source || 'manual') + '</span></div>' +
      '<div class="sidebar__foot">Six algorithms · engine v' + scheduler.ENGINE_VERSION + '<br/>Local only · no network</div>' +
      '</aside>' +
      '<div class="main"><header class="topbar">' +
      '<button class="btn btn--icon btn--ghost topbar__menu" id="menu-btn" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">' + ui.icon('menu', 18) + '</button>' +
      '<div class="topbar__title" id="page-title">Overview</div>' +
      '<div class="topbar__actions"><span class="topbar__storage" id="storage-state"></span><a class="btn btn--primary btn--sm" href="#/simulate">' + ui.icon('play', 14) + '<span>New run</span></a></div>' +
      '</header><main class="content" id="content" tabindex="-1"></main></div>' +
      '<div class="scrim" id="scrim" hidden></div><div id="modal-mount"></div></div>';
  }

  function updateChrome() {
    var countEl = document.getElementById('nav-count');
    if (countEl) countEl.textContent = store.getCount() + ' process' + (store.getCount() === 1 ? '' : 'es');
    var src = document.getElementById('nav-source');
    if (src) src.textContent = datasetMeta.source || 'manual';
    var st = document.getElementById('storage-state');
    if (st) st.textContent = persist.storageAvailable() ? 'saved locally' : 'memory only';
  }

  function ctx() {
    return {
      ui: ui, kit: kit, store: store, scheduler: scheduler, comparison: comparison, benchmark: benchmark,
      reports: reports, persist: persist, runConfig: runConfig, sim: sim, cmp: cmp, bench: bench, report: report,
      datasetMeta: datasetMeta, signature: signature
    };
  }

  /* ---------- render ---------- */
  var lastPath = null;
  function render() {
    var path = currentPath();
    var pathChanged = path !== lastPath;
    lastPath = path;
    if (path !== 'simulate' && sim.playback) { sim.playback.dispose(); sim.playback = null; }
    var route = ROUTES.filter(function (r) { return r.path === path; })[0];
    document.title = route.label + ' · OS Scheduling Comparator';
    var titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = route.label;
    var links = document.querySelectorAll('.nav__link');
    for (var i = 0; i < links.length; i++) {
      var active = links[i].getAttribute('data-nav') === path;
      links[i].classList.toggle('is-active', active);
      if (active) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
    if (path === 'simulate') ensureSimulation();
    var content = document.getElementById('content');
    content.innerHTML = window.screens[path] ? window.screens[path](ctx()) : window.screens.overview(ctx());
    wireTabs(content);
    updateChrome();
    if (path === 'simulate' && sim.playback) renderLive(sim.playback.getState(), sim.playback.snapshot());
    // Enter animation belongs to route changes only — tab/metric re-renders
    // inside a screen stay instant.
    if (pathChanged) {
      content.classList.remove('page-enter');
      void content.offsetWidth;
      content.classList.add('page-enter');
    }
    content.focus({ preventScroll: true });
    var sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('is-open');
    var scrim = document.getElementById('scrim');
    if (scrim) scrim.hidden = true;
  }

  /* ---------- tabs ---------- */
  function selectTab(tab) {
    if (tab.disabled || tab.classList.contains('is-disabled')) return;
    var list = tab.closest('.tabs');
    if (!list) return;
    var tabs = list.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i] === tab;
      tabs[i].classList.toggle('is-active', on);
      tabs[i].setAttribute('aria-selected', String(on));
      tabs[i].tabIndex = on ? 0 : -1;
    }
  }
  function wireTabs(root) {
    var lists = root.querySelectorAll('.tabs');
    for (var i = 0; i < lists.length; i++) {
      (function (list) {
        list.addEventListener('keydown', function (e) {
          var ts = Array.prototype.filter.call(list.querySelectorAll('.tab'), function (t) { return !t.disabled; });
          var idx = ts.indexOf(document.activeElement);
          if (idx < 0) return;
          var n = -1;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (idx + 1) % ts.length;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (idx - 1 + ts.length) % ts.length;
          else if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = ts.length - 1;
          if (n >= 0) { e.preventDefault(); ts[n].focus(); selectTab(ts[n]); ts[n].click(); }
        });
      })(lists[i]);
    }
  }

  /* ---------- toast / dialogs / downloads ---------- */
  function toast(message, variant) {
    var region = document.getElementById('toast-region');
    if (!region) return;
    var icons = { success: 'success', error: 'error', warning: 'alert', neutral: 'info' };
    var el = document.createElement('div');
    el.className = 'toast toast--' + (variant || 'neutral');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="toast__icon" aria-hidden="true">' + ui.icon(icons[variant] || 'info', 15) + '</span>' +
      '<span class="toast__msg">' + ui.esc(message) + '</span>' +
      '<button type="button" class="toast__close" aria-label="Dismiss notification">' + ui.icon('x', 13) + '</button>';
    region.appendChild(el);
    var show = window.requestAnimationFrame || function (fn) { fn(); };
    show(function () { el.classList.add('is-visible'); });
    var close = function () {
      el.classList.remove('is-visible');
      setTimeout(function () { el.remove(); }, 200);
    };
    el.querySelector('.toast__close').addEventListener('click', close);
    setTimeout(close, 4000);
  }

  function confirmDialog(opts) {
    var mount = document.getElementById('modal-mount');
    if (!mount) { if (opts.onConfirm) opts.onConfirm(); return; }
    var id = 'confirm-dlg';
    mount.innerHTML = ui.modal({
      id: id, title: opts.title || 'Confirm',
      body: '<p class="modal__text">' + ui.esc(opts.message || '') + '</p>',
      actions: ui.button({ label: opts.confirmLabel || 'Confirm', variant: opts.danger ? 'danger' : 'primary', data: { 'confirm-yes': '1' } }) +
        ui.button({ label: 'Cancel', variant: 'ghost', data: { 'close-modal': id } })
    });
    var dlg = document.getElementById(id);
    if (!dlg) return;
    dlg.querySelector('[data-confirm-yes]').addEventListener('click', function () {
      dlg.close();
      if (opts.onConfirm) opts.onConfirm();
    });
    dlg.addEventListener('close', function () { mount.innerHTML = ''; });
    if (dlg.showModal) dlg.showModal();
  }

  function promptDialog(opts) {
    var mount = document.getElementById('modal-mount');
    if (!mount) { if (opts.onConfirm) opts.onConfirm((opts.value || '').trim()); return; }
    var id = 'prompt-dlg';
    mount.innerHTML = ui.modal({
      id: id, title: opts.title || 'Name',
      body: '<div class="field"><label class="field__label" for="prompt-input">' + ui.esc(opts.label || 'Name') + '</label>' +
        '<input class="field__input" id="prompt-input" type="text" maxlength="80" value="' + ui.esc(opts.value || '') + '" />' +
        '<p class="field__error" id="prompt-err" role="alert"></p></div>',
      actions: ui.button({ label: opts.confirmLabel || 'Save', variant: 'primary', data: { 'prompt-yes': '1' } }) +
        ui.button({ label: 'Cancel', variant: 'ghost', data: { 'close-modal': id } })
    });
    var dlg = document.getElementById(id);
    if (!dlg) return;
    var inp = document.getElementById('prompt-input');
    var err = document.getElementById('prompt-err');
    function submit() {
      var val = (inp.value || '').trim();
      if (!val) { err.textContent = 'Name cannot be empty.'; inp.focus(); return; }
      dlg.close();
      if (opts.onConfirm) opts.onConfirm(val);
    }
    dlg.querySelector('[data-prompt-yes]').addEventListener('click', submit);
    dlg.addEventListener('close', function () { mount.innerHTML = ''; });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    if (dlg.showModal) dlg.showModal();
    inp.focus(); inp.select();
  }

  function downloadFile(filename, text, mime) {
    try {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        var blob = new Blob([text], { type: mime || 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
        return true;
      }
    } catch (e) {}
    var mount = document.getElementById('modal-mount');
    if (mount) {
      var id = 'text-fb';
      mount.innerHTML = ui.modal({ id: id, title: 'Copy export',
        body: '<p class="modal__text">Automatic download is unavailable. Copy the text below.</p><textarea class="json-fallback" readonly aria-label="Exported text">' + ui.esc(text) + '</textarea>',
        actions: ui.button({ label: 'Close', variant: 'ghost', data: { 'close-modal': id } }) });
      var d = document.getElementById(id);
      if (d) { d.addEventListener('close', function () { mount.innerHTML = ''; }); if (d.showModal) d.showModal(); }
    }
    return false;
  }

  /* ---------- form readers ---------- */
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function intVal(id) { var n = parseInt(val(id), 10); return Number.isFinite(n) ? n : NaN; }
  function readGenConfig() {
    return {
      count: intVal('gen-count'),
      arrival: { min: intVal('gen-arr-min'), max: intVal('gen-arr-max') },
      burst: { min: intVal('gen-bst-min'), max: intVal('gen-bst-max') },
      priority: { min: intVal('gen-pri-min'), max: intVal('gen-pri-max') },
      seed: val('gen-seed')
    };
  }
  function parseSizes(raw) {
    var out = [];
    String(raw).split(',').forEach(function (tok) {
      tok = tok.trim();
      if (!tok) return;
      var m = tok.match(/^(\d+)\s*-\s*(\d+)(?:\s*:\s*(\d+))?$/);
      if (m) {
        var a = Number(m[1]), b = Number(m[2]);
        var step = m[3] ? Number(m[3]) : Math.max(1, Math.ceil((b - a) / 10));
        if (step < 1) throw new Error('Range step must be at least 1.');
        for (var v = a; v <= b; v += step) out.push(v);
        if (out[out.length - 1] !== b) out.push(b);
      } else if (/^\d+$/.test(tok)) out.push(Number(tok));
      else throw new Error('Invalid dataset size: "' + tok + '".');
    });
    out = out.filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    return out;
  }
  function readBenchForm() {
    var f = bench.form;
    ['sizes', 'seed'].forEach(function (k) { var el = document.getElementById('bench-' + k); if (el) f[k] = el.value; });
    var map = { 'bench-rounds': 'rounds', 'bench-quantum': 'quantum', 'bench-ctx': 'ctx', 'bench-arr-min': 'arrivalMin', 'bench-arr-max': 'arrivalMax', 'bench-bst-min': 'burstMin', 'bench-bst-max': 'burstMax', 'bench-pri-min': 'priorityMin', 'bench-pri-max': 'priorityMax' };
    Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) f[map[id]] = parseInt(el.value, 10); });
    var sizes;
    try { sizes = parseSizes(f.sizes); } catch (e) { return { error: e.message }; }
    return {
      sizes: sizes, rounds: f.rounds, seed: String(f.seed || ''),
      generator: { arrival: { min: f.arrivalMin, max: f.arrivalMax }, burst: { min: f.burstMin, max: f.burstMax }, priority: { min: f.priorityMin, max: f.priorityMax } },
      quantum: f.quantum, contextSwitchCost: f.ctx
    };
  }

  /* ---------- live field validation ---------- */
  function onFieldInput(e, content) {
    var inp = e.target.closest ? e.target.closest('[data-field]') : null;
    if (!inp || !content.contains(inp)) return;
    var pid = Number(inp.getAttribute('data-pid'));
    var field = inp.getAttribute('data-field');
    var res = store.updateProcess(pid, field, inp.value);
    var errEl = document.getElementById('err-' + field + '-' + pid);
    if (res.ok) {
      inp.removeAttribute('aria-invalid');
      if (errEl) errEl.textContent = '';
      datasetMeta = { source: 'manual', seed: null, name: 'Edited dataset' };
      persistActive();
      var dirty = document.getElementById('sim-dirty');
      if (dirty && sim.result && sim.sig !== signature()) dirty.hidden = false;
    } else {
      inp.setAttribute('aria-invalid', 'true');
      if (errEl) errEl.textContent = res.error;
    }
  }

  /* ---------- delegation ---------- */
  function initContentDelegation(content) {
    content.addEventListener('input', function (e) {
      onFieldInput(e, content);
      var scrub = e.target.closest ? e.target.closest('[data-action="pb-scrub"]') : null;
      if (scrub && content.contains(scrub) && sim.playback) sim.playback.seek(Number(scrub.value));
      var bid = e.target.id || '';
      if (bid.indexOf('bench-') === 0 && bench.form) {
        var map = { 'bench-sizes': 'sizes', 'bench-seed': 'seed', 'bench-rounds': 'rounds', 'bench-quantum': 'quantum', 'bench-ctx': 'ctx', 'bench-arr-min': 'arrivalMin', 'bench-arr-max': 'arrivalMax', 'bench-bst-min': 'burstMin', 'bench-bst-max': 'burstMax', 'bench-pri-min': 'priorityMin', 'bench-pri-max': 'priorityMax' };
        if (map[bid]) bench.form[map[bid]] = bid === 'bench-sizes' || bid === 'bench-seed' ? e.target.value : parseInt(e.target.value, 10);
      }
    });
    content.addEventListener('change', function (e) {
      onFieldInput(e, content);
      var set = e.target.closest ? e.target.closest('[data-setting]') : null;
      if (set && content.contains(set)) {
        var key = set.getAttribute('data-setting');
        var n = parseInt(set.value, 10);
        if (Number.isFinite(n) && ((key === 'quantum' && n >= 1) || (key === 'contextSwitchCost' && n >= 0))) {
          runConfig[key] = n;
          persistActive();
          render();
        } else toast('Invalid value — previous setting kept', 'error');
      }
    });
    content.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest ? e.target.closest('[data-action="cmp-detail"]') : null;
      if (row && content.contains(row)) {
        e.preventDefault();
        cmp.detailId = row.getAttribute('data-algo');
        render();
      }
    });

    content.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab && content.contains(tab)) {
        var group = tab.closest('.tabs').getAttribute('data-tabs');
        var id = tab.getAttribute('data-tab');
        selectTab(tab);
        if (group === 'algo') {
          if (id === 'priority-np') { runConfig.algorithm = 'priority'; runConfig.priorityMode = 'non-preemptive'; }
          else if (id === 'priority-p') { runConfig.algorithm = 'priority'; runConfig.priorityMode = 'preemptive'; }
          else runConfig.algorithm = id;
          persistActive();
          render();
        } else if (group === 'speed') {
          sim.speed = Number(id);
          if (sim.playback) sim.playback.setSpeed(sim.speed);
        } else if (group === 'cmp-metric') { cmp.metric = id; render(); }
        else if (group === 'cmp-mode') { cmp.mode = id; render(); }
        else if (group === 'bench-metric') { bench.metric = id; render(); }
        else if (group === 'bench-source') { bench.form.source = id; bench.error = null; render(); }
        else if (group === 'report-kind') { report.kind = id; report.selectedId = null; render(); }
        return;
      }

      /* playback */
      if (sim.playback) {
        if (e.target.closest('[data-action="pb-toggle"]')) {
          if (sim.sig !== signature()) { render(); if (sim.playback) sim.playback.play(); return; }
          var st = sim.playback.getState();
          if (st.isPlaying) sim.playback.pause(); else sim.playback.play();
          return;
        }
        if (e.target.closest('[data-action="pb-step"]')) {
          if (sim.sig !== signature()) { render(); if (sim.playback) sim.playback.stepForward(); return; }
          sim.playback.stepForward(); return;
        }
        if (e.target.closest('[data-action="pb-reset"]')) { sim.playback.reset(); return; }
      }
      if (e.target.closest('[data-action="sim-recompute"]')) { render(); return; }

      /* dataset */
      if (e.target.closest('[data-action="add-process"]')) {
        var add = store.addProcess();
        if (!add.ok) { toast(add.error, 'error'); return; }
        datasetMeta = { source: 'manual', seed: null, name: 'Edited dataset' };
        persistActive();
        render();
        var input = content.querySelector('tbody tr:last-child [data-field="arrivalTime"]');
        if (input) input.focus();
        return;
      }
      var rm = e.target.closest('[data-action="remove-process"]');
      if (rm) {
        store.removeProcess(Number(rm.getAttribute('data-pid')));
        datasetMeta = { source: 'manual', seed: null, name: 'Edited dataset' };
        persistActive();
        render();
        return;
      }
      if (e.target.closest('[data-action="clear-all"]')) {
        confirmDialog({ title: 'Clear the dataset?', danger: true, message: 'Every process is removed from the active dataset. Recorded experiments are not affected.', confirmLabel: 'Clear dataset',
          onConfirm: function () { store.clearAll(); datasetMeta = { source: 'manual', seed: null, name: 'Empty dataset' }; persistActive(); render(); } });
        return;
      }
      var preset = e.target.closest('[data-action="load-preset"]');
      if (preset) {
        var pid = preset.getAttribute('data-preset');
        var load = function () {
          var r = store.loadPreset(pid);
          if (!r.ok) { toast(r.error, 'error'); return; }
          var p = store.PRESETS.filter(function (x) { return x.id === pid; })[0];
          datasetMeta = { source: 'preset', seed: null, name: p ? p.name : pid };
          persistActive();
          render();
        };
        if (store.getCount() && !store.matchesPreset(pid)) confirmDialog({ title: 'Replace the dataset?', message: 'Loading a preset replaces the current process set, including unsaved edits. Recorded experiments keep their own snapshots.', confirmLabel: 'Replace', onConfirm: load });
        else load();
        return;
      }
      if (e.target.closest('[data-action="generate"]')) {
        var cfg = readGenConfig();
        var v = store.validateGeneratorConfig(cfg);
        var errEl = document.getElementById('gen-error');
        if (!v.ok) { if (errEl) errEl.textContent = v.errors.join(' '); return; }
        if (errEl) errEl.textContent = '';
        var run = function () {
          var r = store.loadGenerated(cfg);
          if (!r.ok) { toast(r.error, 'error'); return; }
          datasetMeta = { source: 'generator', seed: String(r.seed), name: 'Generated dataset' };
          persistActive();
          render();
        };
        if (store.getCount()) confirmDialog({ title: 'Replace the dataset?', message: 'Generating replaces the current process set.', confirmLabel: 'Generate', onConfirm: run });
        else run();
        return;
      }
      if (e.target.closest('[data-action="save-dataset"]')) {
        if (!store.getCount()) { toast('Nothing to save', 'error'); return; }
        promptDialog({ title: 'Save dataset', label: 'Dataset name', value: 'Dataset ' + (persist.listDatasets().length + 1),
          onConfirm: function (name) {
            var r = persist.saveDataset(name, store.getState().processes);
            if (r.ok) { toast('Dataset saved', 'success'); render(); } else toast(r.error, 'error');
          } });
        return;
      }
      var ld = e.target.closest('[data-action="load-dataset"]');
      if (ld) {
        var ds = persist.getDataset(ld.getAttribute('data-dsid'));
        if (!ds) { toast('Dataset not found', 'error'); return; }
        confirmDialog({ title: 'Load dataset?', message: 'This replaces the active dataset with “' + ds.name + '”.', confirmLabel: 'Load',
          onConfirm: function () {
            var r = store.replaceAll(ds.processes);
            if (!r.ok) { toast(r.error, 'error'); return; }
            datasetMeta = { source: 'saved', seed: null, name: ds.name };
            persistActive();
            render();
          } });
        return;
      }
      var del = e.target.closest('[data-action="delete-dataset"]');
      if (del) {
        var id = del.getAttribute('data-dsid');
        confirmDialog({ title: 'Delete saved dataset?', danger: true, message: 'This removes the saved dataset from local storage. Recorded experiments are unaffected.', confirmLabel: 'Delete',
          onConfirm: function () { persist.deleteDataset(id); render(); } });
        return;
      }

      /* comparison */
      var sortBtn = e.target.closest('[data-action="cmp-sort"]');
      if (sortBtn) {
        var mid = sortBtn.getAttribute('data-metric');
        var m = comparison.metricById(mid);
        if (cmp.sort && cmp.sort.metric === mid) cmp.sort.dir = cmp.sort.dir === 'asc' ? 'desc' : 'asc';
        else cmp.sort = { metric: mid, dir: m && !m.lower ? 'desc' : 'asc' };
        render();
        return;
      }
      var row = e.target.closest('[data-action="cmp-detail"]');
      if (row) { cmp.detailId = row.getAttribute('data-algo'); render(); return; }
      if (e.target.closest('[data-action="record-comparison"]')) {
        var procs = store.getState().processes;
        if (!procs.length) { toast('No dataset to record', 'error'); return; }
        var run = comparison.runComparison(procs, { quantum: runConfig.quantum, contextSwitchCost: runConfig.contextSwitchCost });
        var res = persist.addRecord({
          kind: 'comparison',
          name: 'Comparison · ' + procs.length + ' processes',
          dataset: procs,
          config: { algorithm: runConfig.algorithm, priorityMode: runConfig.priorityMode, quantum: runConfig.quantum, contextSwitchCost: runConfig.contextSwitchCost },
          comparison: {
            runs: run.runs.map(function (r) {
              return { id: r.id, label: r.label, color: r.color, ok: r.ok, summary: r.summary || null, error: r.error || null };
            }),
            validCount: run.validCount, datasetSize: run.datasetSize
          }
        });
        if (res.ok) { cmp.recordedSig = signature(); toast('Comparison recorded', 'success'); render(); }
        else toast(res.error, 'error');
        return;
      }

      /* benchmark */
      if (e.target.closest('[data-action="bench-start"]')) { startBenchmark(); return; }
      if (e.target.closest('[data-action="bench-cancel"]')) {
        if (bench.runner) { bench.runner.cancel(); toast('Cancelling benchmark…', 'warning'); }
        return;
      }

      /* reports */
      var sel = e.target.closest('[data-action="report-select"]');
      if (sel) { report.selectedId = sel.getAttribute('data-rid'); render(); return; }
      var csvBtn = e.target.closest('[data-action="report-csv"]');
      if (csvBtn) {
        var rec = persist.get(csvBtn.getAttribute('data-rid'));
        if (!rec) { toast('Report not found', 'error'); return; }
        downloadFile(reports.filenameFor(rec), reports.csvFor(rec), 'text/csv');
        toast('CSV exported', 'success');
        return;
      }
      if (e.target.closest('[data-action="report-print"]')) { window.print(); return; }
      var delBtn = e.target.closest('[data-action="report-delete"]');
      if (delBtn) {
        var rid = delBtn.getAttribute('data-rid');
        confirmDialog({ title: 'Delete report?', danger: true, message: 'This permanently removes the recorded snapshot from local history.', confirmLabel: 'Delete',
          onConfirm: function () { var r = persist.remove(rid); if (!r.ok) toast(r.error, 'error'); else { report.selectedId = null; toast('Report deleted', 'warning'); render(); } } });
        return;
      }
      if (e.target.closest('[data-action="clear-storage"]')) {
        confirmDialog({ title: 'Clear all local data?', danger: true, message: 'This deletes every recorded experiment, saved dataset and the active-state snapshot in this browser. It cannot be undone.', confirmLabel: 'Clear everything',
          onConfirm: function () {
            var r = persist.clearAll();
            toast(r.ok ? 'Local data cleared' : 'Cleared in memory; storage reported an error', r.ok ? 'warning' : 'error');
            report.selectedId = null;
            render();
          } });
        return;
      }
    });
  }

  /* ---------- benchmark driver ---------- */
  function updateBenchProgress(s) {
    var bar = document.getElementById('bench-bar');
    var label = document.getElementById('bench-progress-label');
    if (bar && s.totalUnits) bar.style.transform = 'scaleX(' + (s.unitsDone / s.totalUnits) + ')';
    if (label) label.textContent = s.unitsDone + ' / ' + s.totalUnits + ' units';
  }
  function startBenchmark() {
    var cfg = readBenchForm();
    if (cfg.error) { bench.error = cfg.error; render(); return; }
    if ((bench.form.source || 'random') === 'manual') {
      var boxes = document.querySelectorAll('[data-bench-ds]');
      var ids = [];
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) ids.push(boxes[i].getAttribute('data-bench-ds'));
      if (ids.length < 2) { bench.error = 'Select at least two distinct saved datasets.'; render(); return; }
      var datasets = ids.map(function (id) { return persist.getDataset(id); }).filter(Boolean);
      var res;
      try { res = benchmark.runManual(datasets, { quantum: cfg.quantum, contextSwitchCost: cfg.contextSwitchCost }); }
      catch (e) { bench.error = e && e.message ? e.message : String(e); render(); return; }
      bench.error = null; bench.running = false; bench.progress = null; bench.result = res;
      var saved = persist.addRecord({
        kind: 'benchmark',
        name: 'Manual benchmark · ' + res.plan.datasets.length + ' datasets',
        config: { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: res.config.quantum, contextSwitchCost: res.config.contextSwitchCost },
        benchmark: res
      });
      if (saved.ok) toast('Manual benchmark recorded', 'success'); else toast(saved.error, 'error');
      render();
      return;
    }
    var v = benchmark.validateConfig(cfg);
    if (!v.ok) { bench.error = v.errors.join(' '); render(); return; }
    bench.error = null; bench.result = null; bench.running = true;
    bench.progress = { unitsDone: 0, totalUnits: v.value.sizes.length * v.value.rounds, round: 0 };
    var runner;
    try { runner = benchmark.createRunner(cfg); }
    catch (e) { bench.running = false; bench.error = e.message; render(); return; }
    bench.runner = runner;
    render();
    runner.start({
      schedule: function (fn) { setTimeout(fn, 0); },
      onProgress: function (s) { bench.progress = s; updateBenchProgress(s); },
      onDone: function (res) {
        bench.running = false; bench.runner = null; bench.result = res;
        if (res.complete || res.cancelled) {
          var sizes = res.plan.sizes.join('/');
          var saved = persist.addRecord({
            kind: 'benchmark',
            name: 'Benchmark · ' + sizes + ' · ' + res.config.rounds + ' rounds',
            config: { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: res.config.quantum, contextSwitchCost: res.config.contextSwitchCost },
            benchmark: res
          });
          if (saved.ok) toast(res.cancelled ? 'Partial benchmark recorded' : 'Benchmark recorded', res.cancelled ? 'warning' : 'success');
          else toast(saved.error, 'error');
        }
        render();
      }
    });
  }

  /* ---------- global delegation / lifecycle ---------- */
  function initGlobalDelegation() {
    document.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'DIALOG' && e.target.classList.contains('modal')) { e.target.close(); return; }
      var closer = e.target.closest('[data-close-modal]');
      if (closer) { var d = document.getElementById(closer.getAttribute('data-close-modal')); if (d) d.close(); return; }
      if (e.target.closest('#menu-btn')) {
        var sb = document.getElementById('sidebar');
        var scrim = document.getElementById('scrim');
        var open = !sb.classList.contains('is-open');
        sb.classList.toggle('is-open', open);
        scrim.hidden = !open;
        e.target.closest('#menu-btn').setAttribute('aria-expanded', String(open));
        return;
      }
      if (e.target.closest('#scrim')) {
        document.getElementById('sidebar').classList.remove('is-open');
        document.getElementById('scrim').hidden = true;
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var sb = document.getElementById('sidebar');
        if (sb && sb.classList.contains('is-open')) {
          sb.classList.remove('is-open');
          document.getElementById('scrim').hidden = true;
        }
      }
    });
  }

  function init() {
    var app = document.getElementById('app');
    app.innerHTML = shellHTML();
    var content = document.getElementById('content');
    initContentDelegation(content);
    initGlobalDelegation();
    store.subscribe(function () {
      updateChrome();
      if (currentPath() === 'simulate') {
        var dirty = document.getElementById('sim-dirty');
        if (dirty && sim.result && sim.sig !== signature()) dirty.hidden = false;
      } else render();
    });
    if (!location.hash) history.replaceState(null, '', '#/' + DEFAULT_PATH);
    render();
    window.addEventListener('hashchange', render);
    // A hidden tab skips live DOM writes; catch up once it is visible again.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && sim.playback && document.getElementById('sim-time')) {
        renderLive(sim.playback.getState(), sim.playback.snapshot());
      }
    });
    window.CSL = {
      store: store, scheduler: scheduler, comparison: comparison, benchmark: benchmark,
      persist: persist, runConfig: runConfig, sim: sim, cmp: cmp, bench: bench, report: report,
      toast: toast, parseSizes: parseSizes, startBenchmark: startBenchmark, render: render
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
