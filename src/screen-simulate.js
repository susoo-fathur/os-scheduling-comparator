/* Simulate screen — dataset editor + single-algorithm playback. */
(function () {
  'use strict';
  window.screens = window.screens || {};

  var ALGO_TABS = [
    { id: 'fcfs', label: 'FCFS' }, { id: 'sjf', label: 'SJF' }, { id: 'srtf', label: 'SRTF' },
    { id: 'priority-np', label: 'Priority NP' }, { id: 'priority-p', label: 'Priority P' }, { id: 'rr', label: 'Round Robin' }
  ];

  function currentTab(cfg) {
    if (cfg.algorithm === 'priority') return cfg.priorityMode === 'preemptive' ? 'priority-p' : 'priority-np';
    return cfg.algorithm;
  }

  function cellInput(pid, field, value, label) {
    return '<td class="num-cell"><input class="field__input field__input--mono" type="text" inputmode="numeric" autocomplete="off" ' +
      'data-pid="' + pid + '" data-field="' + field + '" aria-label="' + ctxEscape(label) + ' for P' + pid + '" value="' + ctxEscape(value) + '" />' +
      '<p class="cell-err" id="err-' + field + '-' + pid + '" role="alert"></p></td>';
  }
  function ctxEscape(s) { return window.ui.esc(s); }

  window.screens.simulate = function (ctx) {
    var ui = ctx.ui, kit = ctx.kit, store = ctx.store, comparison = ctx.comparison;
    var procs = store.getState().processes;
    var count = procs.length;
    var max = store.LIMITS.MAX_PROCESSES;
    var sim = ctx.sim;
    var cfg = ctx.runConfig;
    var activeTab = currentTab(cfg);
    var canRun = count > 0 && !!sim.result && !sim.error;
    var pbState = sim.playback ? sim.playback.getState() : { currentTime: 0, duration: 0, isPlaying: false, status: 'ready', speed: 1 };

    var algoTabs = ui.tabs({
      id: 'algo', label: 'Algorithm',
      items: ALGO_TABS.map(function (a) { return { id: a.id, label: a.label }; }),
      active: activeTab
    });
    var speedTabs = ui.tabs({
      id: 'speed', label: 'Playback speed',
      items: [{ id: '0.5', label: '0.5×' }, { id: '1', label: '1×' }, { id: '2', label: '2×' }, { id: '4', label: '4×' }],
      active: String(sim.speed)
    });

    /* ---------- dataset editor ---------- */
    var rowsShown = Math.min(count, 120);
    var tableRows = procs.slice(0, rowsShown).map(function (p, i) {
      return '<tr data-row="' + p.pid + '"><td>' + ui.processMarker({ color: store.colorForIndex(i), label: 'P' + p.pid, size: 'sm' }) + '</td>' +
        cellInput(p.pid, 'arrivalTime', p.arrivalTime, 'Arrival') +
        cellInput(p.pid, 'burstTime', p.burstTime, 'Burst') +
        cellInput(p.pid, 'priority', p.priority, 'Priority') +
        '<td class="row-action">' + ui.iconButton({ ariaLabel: 'Remove P' + p.pid, icon: ui.icon('trash', 15), data: { action: 'remove-process', pid: String(p.pid) } }) + '</td></tr>';
    }).join('');

    var editor = '<div class="table-scroll table-scroll--editor"><table class="tbl tbl--dense"><thead><tr><th>Process</th><th>Arrival</th><th>Burst</th><th>Priority</th><th><span class="vh">Remove</span></th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
      (count > rowsShown ? '<p class="muted small">Editing the first ' + rowsShown + ' of ' + count + ' processes. Generate or load a smaller dataset to edit every row inline.</p>' : '') +
      '<p class="muted small">Whole numbers only. Arrival 0–' + store.LIMITS.ARRIVAL_MAX + ', burst 1–' + store.LIMITS.BURST_MAX + ', priority 1–' + store.LIMITS.PRIORITY_MAX + ' (lower number = higher priority).</p>';

    var presetCards = store.PRESETS.map(function (p) {
      var rows = p.processes.map(function (x) {
        return '<li><span class="mono">P' + x.pid + '</span><span class="muted mono">arr ' + x.arrivalTime +
          ' · burst ' + x.burstTime + ' · prio ' + x.priority + '</span></li>';
      }).join('');
      return '<details class="preset" data-preset-card="' + ui.esc(p.id) + '">' +
        '<summary><span class="preset__title">' + ui.esc(p.name) + '</span>' +
        '<span class="preset__count mono">' + p.processes.length + 'p</span></summary>' +
        '<div class="preset__body">' +
        '<p class="preset__desc">' + ui.esc(p.description) + '</p>' +
        '<ul class="ds-list preset__procs">' + rows + '</ul>' +
        (p.takeaway ? '<p class="preset__takeaway"><strong>What to watch:</strong> ' + ui.esc(p.takeaway) + '</p>' : '') +
        '<p class="muted small">' + ui.esc(presetSuggestion(p)) + '</p>' +
        ui.button({ label: 'Load preset', variant: 'secondary', size: 'sm', data: { action: 'load-preset', preset: p.id } }) +
        '</div></details>';
    }).join('');

    var savedDs = ctx.persist.listDatasets();
    var savedList = savedDs.length
      ? '<ul class="ds-list">' + savedDs.map(function (d) {
          return '<li><span>' + ui.esc(d.name) + ' <span class="muted mono">' + d.processes.length + 'p</span></span>' +
            '<span class="cluster"><button type="button" class="btn btn--ghost btn--sm" data-action="load-dataset" data-dsid="' + d.id + '">Load</button>' +
            '<button type="button" class="btn btn--danger btn--sm" data-action="delete-dataset" data-dsid="' + d.id + '">Delete</button></span></li>';
        }).join('') + '</ul>'
      : '<p class="muted small">No saved datasets yet.</p>';

    var datasetPanel = ui.panel({
      title: 'Dataset',
      actions: '<span class="cluster">' + ui.badge({ text: count + ' / ' + max, variant: count ? 'neutral' : 'warning' }) +
        ui.button({ label: 'Add', icon: ui.icon('plus', 15), variant: 'secondary', size: 'sm', disabled: count >= max, data: { action: 'add-process' } }) +
        ui.button({ label: 'Clear', variant: 'danger', size: 'sm', disabled: count === 0, data: { action: 'clear-all' } }) + '</span>',
      body: (count ? editor : ui.emptyState({ icon: ui.icon('list', 24), title: 'No processes', description: 'Add a process, load a preset, or generate a dataset.', action: ui.button({ label: 'Add process', variant: 'primary', data: { action: 'add-process' } }) })) +
        '<div class="dataset-tools">' +
        '<fieldset class="fieldset"><legend>Random generator</legend><div class="gen-grid">' +
        ui.numberField({ id: 'gen-count', label: 'Count', value: 12, min: 1, max: max, step: 1 }) +
        ui.numberField({ id: 'gen-arr-min', label: 'Arrival min', value: 0, min: 0, step: 1 }) +
        ui.numberField({ id: 'gen-arr-max', label: 'Arrival max', value: 20, min: 0, step: 1 }) +
        ui.numberField({ id: 'gen-bst-min', label: 'Burst min', value: 1, min: 1, step: 1 }) +
        ui.numberField({ id: 'gen-bst-max', label: 'Burst max', value: 10, min: 1, step: 1 }) +
        ui.numberField({ id: 'gen-pri-min', label: 'Priority min', value: 1, min: 1, step: 1 }) +
        ui.numberField({ id: 'gen-pri-max', label: 'Priority max', value: 5, min: 1, step: 1 }) +
        '</div><div class="field-row"><div class="field"><label class="field__label" for="gen-seed">Seed</label>' +
        '<input class="field__input field__input--mono" id="gen-seed" type="text" value="demo-1" aria-describedby="gen-hint" /></div>' +
        ui.button({ label: 'Generate', variant: 'primary', data: { action: 'generate' } }) + '</div>' +
        '<p class="field__hint" id="gen-hint">Same seed and ranges reproduce the same dataset. Defaults: arrival 0–20, burst 1–10, priority 1–5.</p>' +
        '<p class="gen-error" id="gen-error" role="alert"></p></fieldset>' +
        '<fieldset class="fieldset"><legend>Presets</legend><div class="preset-list">' + presetCards + '</div>' +
        '<p class="field__hint">Preview a dataset, then load it. Loading replaces the active set (with confirmation if it holds other data) and never starts a run.</p></fieldset>' +
        '<fieldset class="fieldset"><legend>Saved datasets</legend><div class="cluster" style="margin-bottom:8px;">' +
        ui.button({ label: 'Save current', variant: 'secondary', size: 'sm', disabled: count === 0, data: { action: 'save-dataset' } }) + '</div>' + savedList + '</fieldset>' +
        '</div>'
    });

    /* ---------- run settings + playback ---------- */
    var settings = ui.panel({
      title: 'Algorithm & parameters',
      body: algoTabs +
        '<div class="settings-row">' +
        ui.numberField({ id: 'quantum', label: 'Time quantum', value: cfg.quantum, min: 1, step: 1, unit: 'tu', hint: 'Round Robin only.', data: { setting: 'quantum' } }) +
        ui.numberField({ id: 'ctx', label: 'Context-switch cost', value: cfg.contextSwitchCost, min: 0, step: 1, unit: 'tu', hint: 'Charged on process-to-process transitions.', data: { setting: 'contextSwitchCost' } }) +
        '</div>' +
        '<p class="muted small">' + ui.esc(algorithmNote(cfg)) + '</p>'
    });

    var dirty = sim.result && sim.sig !== ctx.signature() ? true : false;
    var errorPanel = sim.error ? ui.errorPanel({ message: 'Simulation cannot run', detail: sim.error }) : '';
    var dirtyBanner = '<div class="notice notice--warn" id="sim-dirty"' + (dirty ? '' : ' hidden') + '><span>The dataset or parameters changed since this result was computed.</span>' +
      ui.button({ label: 'Recompute', variant: 'secondary', size: 'sm', data: { action: 'sim-recompute' } }) + '</div>';

    var runPanel;
    if (!count) {
      runPanel = ui.panel({ title: 'Run', body: ui.emptyState({ icon: ui.icon('play', 24), title: 'Nothing to schedule', description: 'The active dataset is empty.' }) });
    } else if (sim.error) {
      runPanel = ui.panel({ title: 'Run', body: errorPanel });
    } else if (!sim.result) {
      runPanel = ui.panel({ title: 'Run', body: ui.emptyState({ icon: ui.icon('play', 24), title: 'No result', description: 'Recompute to build the schedule.' }) });
    } else {
      var r = sim.result;
      var recorded = sim.recordedSig === sim.sig;
      var presetTag = ctx.datasetMeta && ctx.datasetMeta.source === 'preset' && ctx.datasetMeta.name
        ? '<span class="tag">preset · ' + ui.esc(ctx.datasetMeta.name) + '</span>' : '';
      var explainPanel = '<details class="explain" id="sim-explain" open>' +
        '<summary><span class="explain__title">Why this decision</span>' + presetTag +
        '<span class="explain__time mono" id="sim-explain-time">t=' + pbState.currentTime + '</span></summary>' +
        '<div class="explain__body" id="sim-explain-body">' + kit.decisionExplanation(r, pbState.currentTime) + '</div></details>';
      var metrics = '<div class="stat-row stat-row--metrics">' +
        kit.stat('Avg waiting', kit.metricValue('avgWaiting', r.averages.waiting), 'tu', { accent: true }) +
        kit.stat('Avg turnaround', kit.metricValue('avgTurnaround', r.averages.turnaround), 'tu') +
        kit.stat('Avg response', kit.metricValue('avgResponse', r.averages.response), 'tu') +
        kit.stat('CPU utilization', kit.pct(r.cpuUtilization), '', {}) +
        kit.stat('Throughput', kit.metricValue('throughput', r.throughput), 'proc/tu') +
        kit.stat('Makespan', String(r.makespan), 'tu') +
        kit.stat('Context switches', String(r.contextSwitches), '') +
        kit.stat('Overhead', String(r.overheadTime), 'tu') +
        '</div>';
      var controls = '<div class="pb-controls">' +
        '<div class="pb-buttons">' +
        ui.button({ label: pbState.isPlaying ? 'Pause' : 'Start', icon: ui.icon(pbState.isPlaying ? 'pause' : 'play', 15), variant: 'primary', ariaLabel: 'Start or pause playback', data: { action: 'pb-toggle' } }) +
        ui.button({ label: 'Step', icon: ui.icon('step-fwd', 15), variant: 'secondary', data: { action: 'pb-step' } }) +
        ui.button({ label: 'Reset', icon: ui.icon('reset', 15), variant: 'ghost', data: { action: 'pb-reset' } }) +
        '<span class="pb-speed">' + speedTabs + '</span>' +
        '<span class="mono pb-time" id="sim-time">t = ' + pbState.currentTime + ' / ' + r.makespan + '</span>' +
        '<span class="pb-state pb-state--' + pbState.status + '" id="sim-status">' + ui.esc(pbState.status) + '</span>' +
        '</div>' +
        '<label class="vh" for="sim-scrub">Timeline position</label>' +
        '<input type="range" class="pb-scrub" id="sim-scrub" min="0" max="' + r.makespan + '" value="' + pbState.currentTime + '" step="1" aria-label="Timeline position" data-action="pb-scrub" />' +
        '</div>';
      var live = '<div class="live-grid">' +
        '<div class="live-cell"><span class="live-label">CPU</span><strong class="mono live-value" id="sim-cpu">—</strong></div>' +
        '<div class="live-cell"><span class="live-label">Ready queue</span><ul class="queue" id="sim-ready"></ul></div>' +
        '<div class="live-cell"><span class="live-label">Not arrived</span><span class="mono small" id="sim-na">—</span></div>' +
        '<div class="live-cell"><span class="live-label">Completed</span><span class="mono small" id="sim-completed">—</span></div>' +
        '</div>';
      var procTable = '<div class="table-scroll"><table class="tbl tbl--dense"><thead><tr><th>PID</th><th>Arrival</th><th>Burst</th><th>Priority</th><th>Status</th><th>Remaining</th><th>Completion</th></tr></thead><tbody id="sim-procs-body"></tbody></table></div>';
      runPanel = ui.panel({
        title: 'Execution timeline — ' + ui.esc(algorithmLabel(cfg)),
        actions: '<span class="cluster">' + ui.badge({ text: 'engine v' + r.engineVersion, variant: 'neutral' }) +
          (recorded ? ui.badge({ text: 'Recorded', variant: 'success' }) : '') + '</span>',
        body: dirtyBanner + kit.gantt(r, procs, { cursor: true, reveal: true, currentTime: pbState.currentTime }) + metrics + explainPanel,
        footer: controls
      }) +
      '<div class="grid-lab"><section class="panel"><div class="panel__head"><h2 class="panel__title">Live state</h2></div><div class="panel__body">' + live + '</div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Per-process status</h2></div><div class="panel__body panel__body--flush">' + procTable + '</div></section></div>' +
      '<section class="panel"><div class="panel__head"><div><h2 class="panel__title">Metric breakdown</h2>' +
      '<p class="muted small">Expand a process to see how its metrics were calculated at the current playback time. Incomplete processes stay pending.</p></div></div>' +
      '<div class="panel__body" id="sim-metrics">' + kit.metricBreakdown(r, pbState.currentTime, { colorFor: function (pid) { return kit.processColor(procs, pid); } }) + '</div></section>';
    }

    return '<div class="page-head"><div class="page-head__row"><div><p class="kicker">Single run</p><h1 class="page-head__title">Simulate</h1>' +
      '<p class="page-head__desc">Run one algorithm on the active dataset. Step advances exactly one simulation-time unit; speed changes wall-clock rate only.</p></div>' +
      '<div class="page-head__actions"><a class="btn btn--secondary btn--sm" href="#/compare">Compare all six</a></div></div></div>' +
      '<div class="stack">' + settings + runPanel + datasetPanel + '</div>';
  };

  function algorithmLabel(cfg) {
    if (cfg.algorithm === 'priority') return 'Priority (' + (cfg.priorityMode === 'preemptive' ? 'preemptive' : 'non-preemptive') + ')';
    if (cfg.algorithm === 'rr') return 'Round Robin · q=' + cfg.quantum;
    return cfg.algorithm.toUpperCase();
  }
  function algorithmNote(cfg) {
    if (cfg.algorithm === 'rr') return 'Round Robin is preemptive with a FIFO ready queue; quantum ' + cfg.quantum + ' tu.';
    if (cfg.algorithm === 'priority') return cfg.priorityMode === 'preemptive'
      ? 'Preemptive Priority interrupts only on a strictly higher priority (lower number).'
      : 'Non-preemptive Priority chooses the highest-priority ready process at each dispatch.';
    if (cfg.algorithm === 'srtf') return 'SRTF is preemptive: a shorter remaining time preempts; ties keep the running process.';
    return cfg.algorithm.toUpperCase() + ' is non-preemptive.';
  }
  function presetSuggestion(p) {
    if (!p.suggested) return 'Works with all six algorithms — compare them to see which metric each one changes.';
    var s = p.suggested, label;
    if (s.algorithm === 'priority') label = 'Priority (' + (s.priorityMode === 'preemptive' ? 'preemptive' : 'non-preemptive') + ')';
    else if (s.algorithm === 'rr') label = 'Round Robin';
    else label = s.algorithm.toUpperCase();
    return 'Suggested starting point: ' + label + (s.quantum ? ' with quantum ' + s.quantum : '') + ' — every algorithm stays available.';
  }
  window.screens.simulateAlgorithmLabel = algorithmLabel;
})();
