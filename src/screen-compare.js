/* Compare screen — single-dataset comparison and multi-size benchmark. */
(function () {
  'use strict';
  window.screens = window.screens || {};

  function fmtStat(id, s) { return s ? window.kit.metricValue(id, s.mean) : '—'; }

  window.screens.compare = function (ctx) {
    var ui = ctx.ui, kit = ctx.kit, store = ctx.store, comparison = ctx.comparison;
    var procs = store.getState().processes;
    var mode = ctx.cmp.mode;
    var head = '<div class="page-head"><div class="page-head__row"><div><p class="kicker">Six algorithms · one workload</p><h1 class="page-head__title">Compare</h1>' +
      '<p class="page-head__desc">Every algorithm receives the identical dataset snapshot and configuration. Best depends on the metric, workload and parameters — no universal winner.</p></div>' +
      '<div class="page-head__actions"><span class="mono small">' + procs.length + ' processes</span></div></div></div>';
    var modeTabs = ui.tabs({
      id: 'cmp-mode', label: 'Comparison mode',
      items: [{ id: 'single', label: 'Single experiment' }, { id: 'benchmark', label: 'Benchmark' }],
      active: mode
    });

    if (mode === 'benchmark') {
      return head + '<div class="stack">' + modeTabs + benchmarkPanel(ctx) + '</div>';
    }

    if (!procs.length) {
      return head + '<div class="stack">' + modeTabs +
        ui.emptyState({ icon: ui.icon('chart', 24), title: 'No processes defined', description: 'Build a dataset in Simulate, then return here.', action: '<a class="btn btn--primary" href="#/simulate">Open Simulate</a>' }) + '</div>';
    }

    var cmp = comparison.runComparison(procs, { quantum: ctx.runConfig.quantum, contextSwitchCost: ctx.runConfig.contextSwitchCost });
    var metric = comparison.metricById(ctx.cmp.metric) || comparison.METRICS[0];
    var metricTabs = ui.tabs({
      id: 'cmp-metric', label: 'Comparison metric',
      items: comparison.METRICS.map(function (m) { return { id: m.id, label: m.short }; }),
      active: metric.id
    });

    var bestCards = comparison.METRICS.map(function (m) {
      var best = comparison.bestByMetric(cmp.runs, m.id);
      if (!best) return '<div class="best-card best-card--empty"><span class="best-card__metric">' + ui.esc(m.short) + '</span><span class="muted small">no valid result</span></div>';
      return '<div class="best-card"><span class="best-card__metric">' + ui.esc(m.short) + '</span>' +
        '<strong class="best-card__algo">' + best.winners.map(function (w) { return ui.esc(w.label); }).join(' = ') + (best.tie ? ' <span class="tag">tie</span>' : '') + '</strong>' +
        '<span class="best-card__value mono">' + kit.metricValue(m.id, best.value) + (m.unit && !m.percent ? ' ' + ui.esc(m.unit) : '') + '</span>' +
        '<span class="best-card__dir">' + (m.lower ? 'lower is better' : 'higher is better') + '</span></div>';
    }).join('');

    var rankRes = comparison.rank(cmp.runs, metric.id);
    var rankGrid = '<div class="rank-grid">' + comparison.METRICS.map(function (m) {
      var rr = comparison.rank(cmp.runs, m.id);
      if (!rr.rows.length) return '<div class="rank-card"><span class="muted small">' + ui.esc(m.short) + ': no valid result</span></div>';
      var top = rr.rows[0];
      return '<details class="rank-card"><summary><span class="rank-card__metric">' + ui.esc(m.short) + '</span>' +
        '<span class="rank-card__winner"><span class="algo-dot" style="background:' + top.color + '"></span>' + ui.esc(top.label) +
        ' <span class="mono">' + kit.metricValue(m.id, top.value) + '</span>' + (top.tie ? ' <span class="tag">tie</span>' : '') + '</span></summary>' +
        '<ol class="rank-detail">' + rr.rows.map(function (r) {
          return '<li><span class="mono">#' + r.rank + '</span><span>' + ui.esc(r.label) + '</span><span class="mono">' + kit.metricValue(m.id, r.value) + '</span></li>';
        }).join('') + '</ol></details>';
    }).join('') + '</div>';
    var rankList = rankRes.rows.length
      ? '<ol class="rank-list">' + rankRes.rows.map(function (r) {
          return '<li class="rank-row"><span class="rank-num mono">#' + r.rank + '</span>' +
            '<span class="rank-label"><span class="algo-dot" style="background:' + r.color + '"></span>' + ui.esc(r.label) + '</span>' +
            '<span class="mono rank-val">' + kit.metricValue(metric.id, r.value) + '</span>' +
            (r.tie ? '<span class="tag">tie</span>' : '') + '</li>';
        }).join('') + '</ol>'
      : '<p class="muted small">No valid results to rank.</p>';

    // sortable summary table
    var sort = ctx.cmp.sort;
    var runs = cmp.runs.slice().sort(function (a, b) {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      if (!sort) return 0;
      if (!a.ok) return 0;
      return sort.dir === 'asc' ? a.summary[sort.metric] - b.summary[sort.metric] : b.summary[sort.metric] - a.summary[sort.metric];
    });
    var cols = comparison.METRICS;
    var header = '<th>Algorithm</th>' + cols.map(function (m) {
      var ind = sort && sort.metric === m.id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
      return '<th><button type="button" class="th-sort" data-action="cmp-sort" data-metric="' + m.id + '">' + ui.esc(m.short) + ind + '</button></th>';
    }).join('') + '<th>Status</th>';
    var body = runs.map(function (r) {
      var cells = r.ok
        ? cols.map(function (m) { return '<td class="mono">' + kit.metricValue(m.id, r.summary[m.id]) + '</td>'; }).join('')
        : '<td colspan="' + cols.length + '" class="cell-error">Failed — ' + ui.esc(r.error) + '</td>';
      return '<tr class="cmp-row' + (r.id === ctx.cmp.detailId ? ' is-active' : '') + (r.ok ? '' : ' is-failed') + '" data-action="cmp-detail" data-algo="' + r.id + '" tabindex="0">' +
        '<td><span class="algo-dot" style="background:' + r.color + '"></span>' + ui.esc(r.label) + '</td>' + cells +
        '<td>' + (r.ok ? ui.badge({ text: 'ok', variant: 'success' }) : ui.badge({ text: 'failed', variant: 'error' })) + '</td></tr>';
    }).join('');

    var detailRun = cmp.runs.filter(function (r) { return r.id === ctx.cmp.detailId && r.ok; })[0] || cmp.runs.filter(function (r) { return r.ok; })[0];
    var detail = '';
    if (detailRun) {
      ctx.cmp.detailId = detailRun.id;
      var dRows = detailRun.result.processes.slice(0, 300).map(function (p) {
        return '<tr><td class="mono">P' + p.pid + '</td><td class="mono">' + p.arrivalTime + '</td><td class="mono">' + p.burstTime + '</td><td class="mono">' + p.priority + '</td>' +
          '<td class="mono">' + p.startTime + '</td><td class="mono">' + p.completionTime + '</td><td class="mono">' + p.turnaroundTime + '</td><td class="mono">' + p.waitingTime + '</td><td class="mono">' + p.responseTime + '</td></tr>';
      }).join('');
      detail = '<div class="stack">' +
        '<div class="detail-head"><h3>' + ui.esc(detailRun.label) + ' — execution timeline</h3><span class="muted small mono">makespan ' + detailRun.result.makespan + ' tu · ' + detailRun.result.contextSwitches + ' switches</span></div>' +
        kit.gantt(detailRun.result, procs, { cursor: false }) +
        '<div class="table-scroll"><table class="tbl tbl--dense"><thead><tr><th>PID</th><th>Arrival</th><th>Burst</th><th>Priority</th><th>Start</th><th>Completion</th><th>TAT</th><th>WT</th><th>RT</th></tr></thead><tbody>' + dRows + '</tbody></table></div>' +
        (detailRun.result.processes.length > 300 ? '<p class="muted small">Showing the first 300 processes; CSV export contains every row.</p>' : '') +
        '<details class="explain"><summary><span class="explain__title">Metric breakdown — ' + ui.esc(detailRun.label) + '</span><span class="explain__time mono">final values</span></summary>' +
        '<div class="explain__body">' + kit.metricBreakdown(detailRun.result, detailRun.result.makespan, { limit: 300, colorFor: function (pid) { return kit.processColor(procs, pid); } }) + '</div></details>' +
        '</div>';
    } else {
      detail = '<p class="muted small">No algorithm produced a valid result for this dataset.</p>';
    }

    var recorded = ctx.cmp.recordedSig === ctx.signature();
    return head + '<div class="stack">' + modeTabs +
      '<div class="compare-toolbar"><div class="cluster">' + metricTabs + '</div>' +
      '<div class="cluster">' + ui.button({ label: recorded ? 'Recorded' : 'Record comparison', variant: recorded ? 'ghost' : 'primary', size: 'sm', disabled: recorded || cmp.validCount === 0, data: { action: 'record-comparison' } }) +
      '<a class="btn btn--ghost btn--sm" href="#/reports">Reports</a></div></div>' +
      '<div class="grid-lab"><section class="panel"><div class="panel__head"><h2 class="panel__title">' + ui.esc(metric.label) + ' by algorithm</h2></div><div class="panel__body">' + kit.barChart(cmp.runs, metric.id) +
      '<p class="muted small">Bars use each algorithm’s identity color. Failed algorithms are omitted, never shown as zero. Exact values are in the table.</p></div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Ranking — ' + ui.esc(metric.short) + '</h2></div><div class="panel__body">' + rankList + '</div></section></div>' +
      '<section class="panel"><div class="panel__head"><div><h2 class="panel__title">Best per metric</h2><p class="muted small">Ties are reported as ties.</p></div></div><div class="panel__body"><div class="best-grid">' + bestCards + '</div></div></section>' +
      '<section class="panel"><div class="panel__head"><div><h2 class="panel__title">Why these numbers</h2>' +
      '<p class="muted small">Winner statements are observations from this dataset and configuration (q=' + ctx.runConfig.quantum + ', context-switch cost ' + ctx.runConfig.contextSwitchCost + ' tu). General rules describe how an algorithm chooses — they do not guarantee a win.</p></div></div>' +
      '<div class="panel__body">' + kit.comparisonExplanation(cmp.runs, { config: ctx.runConfig, stale: false }) + '</div></section>' +
      '<section class="panel"><div class="panel__head"><div><h2 class="panel__title">Rankings by metric</h2><p class="muted small">Each criterion ranked separately; expand a metric for the full order.</p></div></div><div class="panel__body">' + rankGrid + '</div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Summary metrics</h2><span class="muted small">' + cmp.validCount + ' of 6 valid · q=' + ctx.runConfig.quantum + ' · ctx=' + ctx.runConfig.contextSwitchCost + ' tu</span></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-scroll"><table class="tbl tbl--dense"><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="muted small" style="padding:10px 14px 0">Select a column to sort; select a row to inspect its timeline and per-process metrics.</p></div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Algorithm detail</h2></div><div class="panel__body">' + detail + '</div></section>' +
      '</div>';
  };

  function benchmarkPanel(ctx) {
    var ui = ctx.ui, kit = ctx.kit, comparison = ctx.comparison, b = ctx.bench;
    var f = b.form;
    var running = b.running;
    var source = f.source || 'random';
    var saved = ctx.persist.listDatasets();
    var sourceTabs = ui.tabs({
      id: 'bench-source', label: 'Benchmark data source',
      items: [{ id: 'random', label: 'Random datasets' }, { id: 'manual', label: 'Saved datasets' }],
      active: source
    });
    var randomControls =
      '<div class="field"><label class="field__label" for="bench-sizes">Dataset sizes</label>' +
      '<input class="field__input field__input--mono" id="bench-sizes" type="text" value="' + ui.esc(f.sizes) + '" aria-describedby="bench-sizes-hint" ' + (running ? 'disabled' : '') + ' />' +
      '<p class="field__hint" id="bench-sizes-hint">Comma list, e.g. 10, 50, 100. Ranges allowed: 10-100:20 → 10, 30, 50, 70, 90.</p></div>' +
      '<div class="bench-grid">' +
      ui.numberField({ id: 'bench-rounds', label: 'Rounds per size', value: f.rounds, min: 1, max: 100, step: 1, disabled: running }) +
      '<div class="field"><label class="field__label" for="bench-seed">Base seed</label><input class="field__input field__input--mono" id="bench-seed" type="text" value="' + ui.esc(f.seed) + '" ' + (running ? 'disabled' : '') + ' /></div>' +
      '</div>' +
      '<p class="field__label">Generator ranges</p><div class="bench-grid bench-grid--ranges">' +
      ui.numberField({ id: 'bench-arr-min', label: 'Arrival min', value: f.arrivalMin, min: 0, step: 1, disabled: running }) +
      ui.numberField({ id: 'bench-arr-max', label: 'Arrival max', value: f.arrivalMax, min: 0, step: 1, disabled: running }) +
      ui.numberField({ id: 'bench-bst-min', label: 'Burst min', value: f.burstMin, min: 1, step: 1, disabled: running }) +
      ui.numberField({ id: 'bench-bst-max', label: 'Burst max', value: f.burstMax, min: 1, step: 1, disabled: running }) +
      ui.numberField({ id: 'bench-pri-min', label: 'Priority min', value: f.priorityMin, min: 1, step: 1, disabled: running }) +
      ui.numberField({ id: 'bench-pri-max', label: 'Priority max', value: f.priorityMax, min: 1, step: 1, disabled: running }) +
      '</div>';
    var manualControls = saved.length < 2
      ? '<div class="notice notice--warn"><span>Save at least two distinct datasets in Simulate to run a manual benchmark.</span><a class="btn btn--secondary btn--sm" href="#/simulate">Open Simulate</a></div>'
      : '<p class="field__label">Saved datasets — select at least two distinct cases</p><ul class="ds-checks">' +
        saved.map(function (d) {
          return '<li><label class="ds-check"><input type="checkbox" data-bench-ds="' + ui.esc(d.id) + '" ' + (running ? 'disabled' : '') + ' />' +
            '<span>' + ui.esc(d.name) + '</span><span class="mono muted small">' + d.processes.length + 'p</span></label></li>';
        }).join('') + '</ul>' +
        '<p class="field__hint">Identical datasets are skipped. One distinct dataset is a Single Experiment, not a benchmark.</p>';
    var form = '<div class="bench-form">' + sourceTabs + (source === 'random' ? randomControls : manualControls) +
      '<div class="bench-grid"><div class="field"><label class="field__label" for="bench-quantum">Time quantum (RR)</label>' +
      '<input class="field__input field__input--mono" id="bench-quantum" type="number" min="1" step="1" value="' + ui.esc(f.quantum) + '" ' + (running ? 'disabled' : '') + ' /></div>' +
      '<div class="field"><label class="field__label" for="bench-ctx">Context-switch cost</label>' +
      '<input class="field__input field__input--mono" id="bench-ctx" type="number" min="0" step="1" value="' + ui.esc(f.ctx) + '" ' + (running ? 'disabled' : '') + ' /></div></div>' +
      '<div class="cluster bench-actions">' +
      (running
        ? ui.button({ label: 'Cancel benchmark', variant: 'danger', data: { action: 'bench-cancel' } })
        : ui.button({ label: source === 'manual' ? 'Run manual benchmark' : 'Run benchmark', variant: 'primary', icon: ui.icon('chart', 15), data: { action: 'bench-start' } })) +
      '<span class="muted small">' + (source === 'manual'
        ? 'Distinct saved datasets are grouped by actual size; they are not independent random samples.'
        : 'Nested sizes: each size uses a prefix of the round dataset, so sizes share processes and are not independent samples.') + '</span>' +
      '</div>' + (b.error ? '<p class="gen-error" role="alert">' + ui.esc(b.error) + '</p>' : '') +
      '</div>';

    var progress = '';
    if (running && b.progress) {
      var pct = b.progress.totalUnits ? Math.round((b.progress.unitsDone / b.progress.totalUnits) * 100) : 0;
      progress = '<div class="bench-progress" role="status" aria-live="polite"><div class="bench-progress__bar" id="bench-bar" style="transform:scaleX(' + (pct / 100) + ')"></div>' +
        '<span class="bench-progress__label mono" id="bench-progress-label">' + b.progress.unitsDone + ' / ' + b.progress.totalUnits + ' units · round ' + Math.min(b.progress.round + 1, f.rounds) + ' · ' + pct + '%</span></div>';
    }

    var results = '';
    if (b.result) {
      var r = b.result;
      var sizes = r.plan.sizes;
      var metric = comparison.metricById(b.metric) || comparison.METRICS[0];
      var metricTabs = ui.tabs({ id: 'bench-metric', label: 'Benchmark metric', items: comparison.METRICS.map(function (m) { return { id: m.id, label: m.short }; }), active: metric.id });
      var series = comparison.ALGORITHMS.map(function (a) {
        var values = {};
        r.cells.filter(function (c) { return c.algoId === a.id; }).forEach(function (c) {
          var s = c.metrics[metric.id];
          if (s) values[c.size] = s.mean;
        });
        return { id: a.id, label: a.label, color: a.color, values: values };
      });
      var cellRows = comparison.ALGORITHMS.map(function (a) {
        return sizes.map(function (sz) {
          var c = r.cells.filter(function (x) { return x.algoId === a.id && x.size === sz; })[0];
          var s = c ? c.metrics[metric.id] : null;
          return '<tr><td><span class="algo-dot" style="background:' + a.color + '"></span>' + ui.esc(a.label) + '</td><td class="mono">' + sz + '</td>' +
            '<td class="mono">' + (c ? c.rounds : 0) + '</td><td class="mono">' + (s ? kit.metricValue(metric.id, s.mean) : '—') + '</td>' +
            '<td class="mono">' + (s ? kit.metricValue(metric.id, s.min) : '—') + '</td><td class="mono">' + (s ? kit.metricValue(metric.id, s.max) : '—') + '</td>' +
            '<td class="mono">' + (s ? kit.metricValue(metric.id, s.stddev) : '—') + '</td>' +
            '<td>' + (c && c.failures ? ui.badge({ text: c.failures + ' failed', variant: 'error' }) : ui.badge({ text: 'ok', variant: 'success' })) + '</td></tr>';
        }).join('');
      }).join('');
      results = '<section class="panel"><div class="panel__head"><div><h2 class="panel__title">Benchmark result</h2>' +
        '<p class="muted small">' + (r.complete ? 'Complete' : (r.cancelled ? 'Cancelled — partial results only' : 'Incomplete')) + ' · ' + r.completedRounds + ' of ' + r.config.rounds + ' rounds · ' + r.cells.length + ' cells</p></div>' +
        '<div class="panel__actions">' + ui.badge({ text: r.cancelled ? 'partial' : (r.complete ? 'complete' : 'incomplete'), variant: r.complete ? 'success' : 'warning' }) + '</div></div>' +
        '<div class="panel__body"><div class="bench-meta">' +
        kit.kv([
          { k: 'Mode', v: r.plan.manual ? 'saved datasets' : 'random datasets' },
          { k: 'Base seed', v: r.plan.manual ? '—' : String(r.config.seed) },
          { k: 'Round seeds', v: r.plan.manual ? '—' : (r.plan.seeds.join(', ') || '—') },
          { k: 'Datasets', v: r.plan.manual ? r.plan.datasets.map(function (d) { return d.name; }).join(', ') : 'generated per round' },
          { k: 'Sizes', v: sizes.join(', ') }, { k: 'Rounds / size', v: String(r.config.rounds) },
          { k: 'Quantum / overhead', v: r.config.quantum + ' / ' + r.config.contextSwitchCost + ' tu' }
        ]) + '</div>' +
        '<div class="cluster" style="margin:14px 0 8px">' + metricTabs + '</div>' +
        kit.lineChart(series, sizes, metric.id, { title: metric.label + ' vs dataset size' }) +
        '<div class="table-scroll"><table class="tbl tbl--dense"><thead><tr><th>Algorithm</th><th>Size</th><th>Rounds</th><th>Mean</th><th>Min</th><th>Max</th><th>Std dev</th><th>Status</th></tr></thead><tbody>' + cellRows + '</tbody></table></div>' +
        '<p class="muted small">Mean, minimum, maximum and sample standard deviation over completed rounds. ' + ui.esc(r.plan.note) + '</p>' +
        '</div></section>';
    }

    return '<section class="panel"><div class="panel__head"><div><h2 class="panel__title">Benchmark configuration</h2><p class="muted small">Runs six algorithms across dataset sizes. Nothing starts until you press Run.</p></div></div>' +
      '<div class="panel__body">' + form + progress + '</div></section>' + results;
  }

  window.screens.compareHelpers = { fmtStat: fmtStat };
})();
