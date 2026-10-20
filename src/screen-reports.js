/* Reports screen — recorded experiments only: CSV, print, history management. */
(function () {
  'use strict';
  window.screens = window.screens || {};

  function statusOf(rec, scheduler) {
    if (rec.engineVersion != null && scheduler && rec.engineVersion !== scheduler.ENGINE_VERSION)
      return { text: 'outdated', variant: 'warning', note: 'Recorded with engine v' + rec.engineVersion + '; current engine is v' + scheduler.ENGINE_VERSION + '.' };
    if (rec.kind === 'simulation') {
      if (!rec.result) return { text: 'outdated', variant: 'warning', note: 'No result snapshot; recompute this run.' };
      return { text: 'complete', variant: 'success' };
    }
    if (rec.kind === 'comparison') {
      var ok = (rec.comparison.runs || []).filter(function (r) { return r.ok; }).length;
      if (!ok) return { text: 'failed', variant: 'error', note: 'No algorithm produced a valid result.' };
      if (ok < 6) return { text: 'partial', variant: 'warning', note: ok + ' of 6 algorithms valid.' };
      return { text: 'complete', variant: 'success' };
    }
    if (rec.benchmark.complete) return { text: 'complete', variant: 'success' };
    if (rec.benchmark.cancelled) return { text: 'partial', variant: 'warning', note: 'Cancelled before all rounds completed.' };
    return { text: 'incomplete', variant: 'warning' };
  }

  function simulationDetail(rec, ctx) {
    var ui = ctx.ui, kit = ctx.kit, comparison = ctx.comparison;
    if (!rec.result) {
      return '<div class="notice notice--warn">This record has no stored result snapshot. Re-run the simulation to produce a current report.</div>' +
        '<div class="table-scroll"><table class="tbl tbl--dense"><thead><tr><th>PID</th><th>Arrival</th><th>Burst</th><th>Priority</th></tr></thead><tbody>' +
        rec.dataset.map(function (p) { return '<tr><td class="mono">P' + p.pid + '</td><td class="mono">' + p.arrivalTime + '</td><td class="mono">' + p.burstTime + '</td><td class="mono">' + p.priority + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }
    var r = rec.result;
    var stats = '<div class="stat-row stat-row--metrics">' +
      kit.stat('Avg waiting', kit.metricValue('avgWaiting', r.averages.waiting), 'tu', { accent: true }) +
      kit.stat('Avg turnaround', kit.metricValue('avgTurnaround', r.averages.turnaround), 'tu') +
      kit.stat('Avg response', kit.metricValue('avgResponse', r.averages.response), 'tu') +
      kit.stat('CPU utilization', kit.pct(r.cpuUtilization), '') +
      kit.stat('Throughput', kit.metricValue('throughput', r.throughput), 'proc/tu') +
      kit.stat('Makespan', String(r.makespan), 'tu') +
      kit.stat('Context switches', String(r.contextSwitches), '') +
      kit.stat('Overhead', String(r.overheadTime), 'tu') + '</div>';
    var rows = r.processes.slice(0, 300).map(function (p) {
      return '<tr><td class="mono">P' + p.pid + '</td><td class="mono">' + p.arrivalTime + '</td><td class="mono">' + p.burstTime + '</td><td class="mono">' + p.priority + '</td>' +
        '<td class="mono">' + p.startTime + '</td><td class="mono">' + p.completionTime + '</td><td class="mono">' + p.turnaroundTime + '</td><td class="mono">' + p.waitingTime + '</td><td class="mono">' + p.responseTime + '</td></tr>';
    }).join('');
    return stats + (r.timelineOmitted
      ? '<div class="notice notice--warn"><span>Timeline omitted for this large run; metrics and per-process values were retained.</span></div>'
      : '<div class="report-chart">' + kit.gantt(r, rec.dataset, { cursor: false }) + '</div>') +
      '<h3 class="subhead">Per-process metrics</h3><div class="table-scroll"><table class="tbl tbl--dense"><thead><tr><th>PID</th><th>Arrival</th><th>Burst</th><th>Priority</th><th>Start</th><th>Completion</th><th>TAT</th><th>WT</th><th>RT</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (r.processes.length > 300 ? '<p class="muted small">Showing 300 of ' + r.processes.length + ' rows; CSV export includes all.</p>' : '') +
      '<details class="explain"><summary><span class="explain__title">Metric breakdown</span><span class="explain__time mono">recorded values</span></summary>' +
      '<div class="explain__body">' + kit.metricBreakdown(r, r.makespan, { limit: 300, colorFor: function (pid) { return kit.processColor(rec.dataset, pid); } }) + '</div></details>';
  }

  function comparisonDetail(rec, ctx) {
    var ui = ctx.ui, kit = ctx.kit, comparison = ctx.comparison;
    var runs = rec.comparison.runs || [];
    var bestCards = comparison.METRICS.map(function (m) {
      var best = comparison.bestByMetric(runs, m.id);
      if (!best) return '';
      return '<div class="best-card"><span class="best-card__metric">' + ui.esc(m.short) + '</span>' +
        '<strong class="best-card__algo">' + best.winners.map(function (w) { return ui.esc(w.label); }).join(' = ') + (best.tie ? ' <span class="tag">tie</span>' : '') + '</strong>' +
        '<span class="best-card__value mono">' + kit.metricValue(m.id, best.value) + '</span></div>';
    }).join('');
    var cols = comparison.METRICS;
    var header = '<th>Algorithm</th>' + cols.map(function (m) { return '<th>' + ui.esc(m.short) + '</th>'; }).join('') + '<th>Status</th>';
    var body = runs.map(function (r) {
      var cells = r.ok ? cols.map(function (m) { return '<td class="mono">' + kit.metricValue(m.id, r.summary[m.id]) + '</td>'; }).join('')
        : '<td colspan="' + cols.length + '" class="cell-error">Failed — ' + ui.esc(r.error) + '</td>';
      return '<tr><td>' + ui.esc(r.label) + '</td>' + cells + '<td>' + (r.ok ? 'ok' : 'failed') + '</td></tr>';
    }).join('');
    return '<div class="best-grid">' + bestCards + '</div>' +
      '<div class="table-scroll"><table class="tbl tbl--dense"><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="muted small">Dataset snapshot: ' + rec.dataset.length + ' processes · quantum ' + rec.config.quantum + ' · context switch ' + rec.config.contextSwitchCost + ' tu.</p>';
  }

  function benchmarkDetail(rec, ctx) {
    var ui = ctx.ui, kit = ctx.kit, comparison = ctx.comparison;
    var b = rec.benchmark;
    var sizes = (b.plan && b.plan.sizes) || [];
    var series = comparison.ALGORITHMS.map(function (a) {
      var values = {};
      (b.cells || []).forEach(function (c) {
        if (c.algoId !== a.id) return;
        var s = c.metrics && c.metrics.avgWaiting;
        if (s) values[c.size] = s.mean;
      });
      return { id: a.id, label: a.label, color: a.color, values: values };
    });
    var rows = (b.cells || []).map(function (c) {
      var cells = comparison.METRICS.map(function (m) {
        var s = c.metrics ? c.metrics[m.id] : null;
        return '<td class="mono">' + (s ? kit.metricValue(m.id, s.mean) : '—') + '</td>';
      }).join('');
      return '<tr><td>' + ui.esc(c.label) + '</td><td class="mono">' + c.size + '</td><td class="mono">' + c.rounds + '</td>' + cells + '<td>' + (c.failures ? c.failures + ' failed' : 'ok') + '</td></tr>';
    }).join('');
    var header = '<th>Algorithm</th><th>Size</th><th>Rounds</th>' + comparison.METRICS.map(function (m) { return '<th>' + ui.esc(m.short) + ' (mean)</th>'; }).join('') + '<th>Status</th>';
    return '<div class="report-meta">' + kit.kv([
      { k: 'Status', v: b.complete ? 'complete' : (b.cancelled ? 'cancelled (partial)' : 'incomplete') },
      { k: 'Mode', v: b.plan.manual ? 'saved datasets' : 'random datasets' },
      { k: 'Sizes', v: sizes.join(', ') },
      { k: 'Rounds / size', v: String(b.plan.rounds) },
      { k: 'Base seed', v: b.plan.manual ? '—' : String(b.config.seed) },
      { k: 'Round seeds', v: b.plan.manual ? '—' : ((b.plan.seeds || []).join(', ') || '—') },
      { k: 'Datasets', v: b.plan.manual ? (b.plan.datasets || []).map(function (d) { return d.name + ' (' + d.size + 'p)'; }).join(', ') : 'generated per round' },
      { k: 'Generator', v: b.config.generator ? 'arrival ' + b.config.generator.arrival.min + '–' + b.config.generator.arrival.max + ' · burst ' + b.config.generator.burst.min + '–' + b.config.generator.burst.max + ' · priority ' + b.config.generator.priority.min + '–' + b.config.generator.priority.max : '—' }
    ]) + '</div>' +
      '<div class="report-chart">' + kit.lineChart(series, sizes, 'avgWaiting', { title: 'Average waiting time vs dataset size' }) + '</div>' +
      '<div class="table-scroll"><table class="tbl tbl--dense"><thead><tr>' + header + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted small">Means shown; CSV export includes minimum, maximum and standard deviation per cell. ' + ui.esc(b.plan.note || '') + '</p>';
  }

  window.screens.reports = function (ctx) {
    var ui = ctx.ui, kit = ctx.kit;
    var kind = ctx.report.kind;
    var all = ctx.persist.list(kind);
    var selected = all.filter(function (r) { return r.id === ctx.report.selectedId; })[0] || all[0] || null;
    if (selected) ctx.report.selectedId = selected.id;

    var kindTabs = ui.tabs({
      id: 'report-kind', label: 'Report category',
      items: [
        { id: 'simulation', label: 'Simulation' },
        { id: 'comparison', label: 'Comparison' },
        { id: 'benchmark', label: 'Benchmark' }
      ],
      active: kind
    });

    var list = all.length ? '<ul class="report-list">' + all.map(function (r) {
      var st = statusOf(r, ctx.scheduler);
      return '<li><button type="button" class="report-item' + (selected && r.id === selected.id ? ' is-active' : '') + '" data-action="report-select" data-rid="' + r.id + '">' +
        '<span class="report-item__name">' + ui.esc(r.name) + '</span>' +
        '<span class="report-item__meta">' + kit.dateTime(r.createdAt) + ' · ' + (r.dataset ? r.dataset.length + 'p' : 'config only') + '</span>' +
        ui.badge({ text: st.text, variant: st.variant }) + '</button></li>';
    }).join('') + '</ul>' : ui.emptyState({ icon: ui.icon('bookmark', 24), title: 'No ' + kind + ' reports', description: 'Complete a run and record it to populate this category.' });

    var detail = '';
    if (selected) {
      var st = statusOf(selected, ctx.scheduler);
      var cfg = selected.config || {};
      var meta = [
        ['Recorded', kit.dateTime(selected.createdAt)],
        ['Kind', selected.kind],
        ['Processes', selected.dataset ? String(selected.dataset.length) : 'benchmark config'],
        ['Algorithm', selected.kind === 'comparison' ? 'all six' : (cfg.algorithm ? cfg.algorithm.toUpperCase() : '—')],
        ['Priority mode', cfg.priorityMode || '—'],
        ['Quantum', String(cfg.quantum)],
        ['Context switch', cfg.contextSwitchCost + ' tu']
      ];
      detail = '<article class="report-detail" id="report-detail">' +
        '<div class="report-detail__head"><div><div class="cluster">' + kit.kindBadge(selected.kind) + ui.badge({ text: st.text, variant: st.variant }) + '</div>' +
        '<h2 class="report-detail__title">' + ui.esc(selected.name) + '</h2>' +
        '<p class="muted small">' + kit.dateTime(selected.createdAt) + (st.note ? ' · ' + ui.esc(st.note) : '') + '</p></div>' +
        '<div class="cluster report-actions">' +
        ui.button({ label: 'Export CSV', variant: 'secondary', size: 'sm', data: { action: 'report-csv', rid: selected.id } }) +
        ui.button({ label: 'Print', variant: 'ghost', size: 'sm', data: { action: 'report-print' } }) +
        ui.button({ label: 'Delete', variant: 'danger', size: 'sm', data: { action: 'report-delete', rid: selected.id } }) +
        '</div></div>' +
        '<div class="report-body">' + kit.kv(meta.map(function (m) { return { k: m[0], v: m[1] }; })) +
        (selected.kind === 'simulation' ? simulationDetail(selected, ctx) : selected.kind === 'comparison' ? comparisonDetail(selected, ctx) : benchmarkDetail(selected, ctx)) +
        '</div></article>';
    } else {
      detail = ui.emptyState({ icon: ui.icon('inbox', 24), title: 'Nothing selected', description: 'Record a run to create a report.' });
    }

    var storage = ctx.persist.lastError ? ui.errorPanel({ message: 'Local storage notice', detail: ctx.persist.lastError }) : '';
    return '<div class="page-head"><div class="page-head__row"><div><p class="kicker">Local history</p><h1 class="page-head__title">Reports</h1>' +
      '<p class="page-head__desc">Reports are built only from recorded snapshots. CSV export and browser printing (save as PDF) are available per report.</p></div>' +
      '<div class="page-head__actions">' + ui.button({ label: 'Clear all local data', variant: 'danger', size: 'sm', data: { action: 'clear-storage' } }) + '</div></div></div>' +
      '<div class="stack">' + storage + '<div class="cluster">' + kindTabs + '<span class="muted small">' + all.length + ' recorded</span></div>' +
      '<div class="report-layout"><aside class="report-side" aria-label="Recorded reports">' + list + '</aside><div class="report-main">' + detail + '</div></div></div>';
  };

  window.screens.reportStatus = statusOf;
})();
