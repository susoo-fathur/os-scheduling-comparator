/* Overview screen — honest summary of the active dataset and recorded history. */
(function () {
  'use strict';
  window.screens = window.screens || {};

  window.screens.overview = function (ctx) {
    var ui = ctx.ui, kit = ctx.kit, store = ctx.store, comparison = ctx.comparison;
    var procs = store.getState().processes;
    var count = procs.length;
    var totalBurst = procs.reduce(function (a, p) { return a + p.burstTime; }, 0);
    var arrivalMax = procs.reduce(function (a, p) { return Math.max(a, p.arrivalTime); }, 0);
    var history = ctx.persist.list();
    var last = history[0] || null;
    var lastCmp = ctx.persist.list('comparison')[0] || null;

    function bestGrid() {
      if (!lastCmp) {
        return ui.emptyState({
          icon: ui.icon('chart', 24),
          title: 'No comparison recorded yet',
          description: 'Run the six algorithms on one dataset and record the result to see which method leads each metric.',
          action: '<a class="btn btn--secondary" href="#/compare">Open Compare</a>'
        });
      }
      var runs = lastCmp.comparison.runs;
      var cards = comparison.METRICS.map(function (m) {
        var best = comparison.bestByMetric(runs, m.id);
        if (!best) return '';
        var names = best.winners.map(function (w) { return w.label; }).join(' = ');
        return '<div class="best-card">' +
          '<span class="best-card__metric">' + ui.esc(m.short) + '</span>' +
          '<strong class="best-card__algo">' + ui.esc(names) + (best.tie ? ' <span class="tag">tie</span>' : '') + '</strong>' +
          '<span class="best-card__value mono">' + kit.metricValue(m.id, best.value) + (m.unit && !m.percent ? ' ' + ui.esc(m.unit) : '') + '</span>' +
          '<span class="best-card__dir">' + (m.lower ? 'lower is better' : 'higher is better') + '</span>' +
          '</div>';
      }).join('');
      return '<div class="best-grid">' + cards + '</div>' +
        '<p class="muted small">From “' + ui.esc(lastCmp.name) + '” · ' + kit.dateTime(lastCmp.createdAt) + '. No algorithm is universally best; each figure is the best value for that criterion.</p>';
    }

    function lastExperimentPanel() {
      if (!last) {
        return ui.emptyState({
          icon: ui.icon('bookmark', 24),
          title: 'No completed experiment',
          description: 'A simulation is recorded when playback reaches the end; comparisons and benchmarks are recorded when you run them.',
          action: '<a class="btn btn--primary" href="#/simulate">Start a simulation</a>'
        });
      }
      var rows = [];
      if (last.kind === 'simulation' && last.result) {
        var r = last.result;
        rows = [
          ['Avg waiting', kit.metricValue('avgWaiting', r.averages.waiting) + ' tu'],
          ['Avg turnaround', kit.metricValue('avgTurnaround', r.averages.turnaround) + ' tu'],
          ['Avg response', kit.metricValue('avgResponse', r.averages.response) + ' tu'],
          ['Makespan', r.makespan + ' tu']
        ];
      } else if (last.kind === 'comparison') {
        var ok = (last.comparison.runs || []).filter(function (x) { return x.ok; });
        var best = ok.length ? comparison.bestByMetric(last.comparison.runs, 'avgWaiting') : null;
        rows = [
          ['Algorithms run', ok.length + ' of 6'],
          ['Best avg waiting', best ? best.winners.map(function (w) { return w.label; }).join(' = ') + ' · ' + kit.metricValue('avgWaiting', best.value) + ' tu' : 'no valid result'],
          ['Dataset', last.dataset.length + ' processes']
        ];
      } else if (last.kind === 'benchmark') {
        var b = last.benchmark;
        rows = [
          ['Sizes', (b.plan.sizes || []).join(', ')],
          ['Rounds / size', b.plan.rounds],
          ['Status', b.complete ? 'complete' : (b.cancelled ? 'cancelled (partial)' : 'incomplete')]
        ];
      }
      return '<div class="last-exp">' +
        '<div class="last-exp__head"><div>' + kit.kindBadge(last.kind) + '<h3 class="last-exp__name">' + ui.esc(last.name) + '</h3>' +
        '<p class="muted small">' + kit.dateTime(last.createdAt) + '</p></div>' +
        '<a class="btn btn--ghost btn--sm" href="#/reports">Open report</a></div>' +
        kit.kv(rows.map(function (r) { return { k: r[0], v: r[1] }; })) + '</div>';
    }

    var countBadge = ui.badge({ text: count + ' process' + (count === 1 ? '' : 'es'), variant: count ? 'neutral' : 'warning' });
    return '<div class="page-head"><div class="page-head__row"><div><p class="kicker">Workstation</p><h1 class="page-head__title">Overview</h1>' +
      '<p class="page-head__desc">Active workload, the last recorded experiment, and the current leader for each metric. All figures come from the engine or from recorded snapshots.</p></div>' +
      '<div class="page-head__actions">' + countBadge + '<a class="btn btn--primary btn--sm" href="#/simulate">' + ui.icon('play', 15) + '<span>Simulate</span></a></div></div></div>' +

      '<div class="overview-grid">' +
        '<section class="panel"><div class="panel__head"><h2 class="panel__title">Active dataset</h2>' +
        '<div class="panel__actions"><a class="text-link" href="#/simulate">Edit</a></div></div>' +
        '<div class="panel__body">' +
        (count ? '<div class="stat-row">' +
          kit.stat('Processes', String(count)) +
          kit.stat('Total burst', String(totalBurst), 'tu') +
          kit.stat('Arrival window', '0–' + arrivalMax, 'tu') +
          kit.stat('Source', ctx.datasetMeta && ctx.datasetMeta.source ? ctx.datasetMeta.source : 'manual') +
          '</div>' +
          '<div class="mini-table-wrap"><table class="tbl tbl--mini"><thead><tr><th>PID</th><th>Arrival</th><th>Burst</th><th>Priority</th></tr></thead><tbody>' +
          procs.slice(0, 6).map(function (p, i) {
            return '<tr><td>' + ui.processMarker({ color: store.colorForIndex(i), label: 'P' + p.pid, size: 'sm' }) + '</td>' +
              '<td class="mono">' + p.arrivalTime + '</td><td class="mono">' + p.burstTime + '</td><td class="mono">' + p.priority + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (count > 6 ? '<p class="muted small">Showing 6 of ' + count + ' processes.</p>' : '') +
          (ctx.datasetMeta && ctx.datasetMeta.seed ? '<p class="muted small mono">seed ' + ui.esc(ctx.datasetMeta.seed) + '</p>' : '')
        : ui.emptyState({ icon: ui.icon('list', 24), title: 'Dataset is empty', description: 'Generate a dataset or add processes to begin.', action: '<a class="btn btn--primary" href="#/simulate">Build a dataset</a>' })) +
        '</div></section>' +

        '<section class="panel"><div class="panel__head"><h2 class="panel__title">Last completed experiment</h2></div>' +
        '<div class="panel__body">' + lastExperimentPanel() + '</div></section>' +
      '</div>' +

      '<section class="panel panel--wide"><div class="panel__head"><div><h2 class="panel__title">Best algorithm per metric</h2>' +
      '<p class="muted small">Latest recorded comparison' + (lastCmp ? ' · ' + ui.esc(lastCmp.name) : '') + '</p></div></div>' +
      '<div class="panel__body">' + bestGrid() + '</div></section>' +

      '<div class="quick-grid">' +
        '<a class="quick-card" href="#/simulate"><span class="quick-card__icon">' + ui.icon('play', 18) + '</span><span><strong>Simulate</strong><small>Run one algorithm with step-by-step playback.</small></span></a>' +
        '<a class="quick-card" href="#/compare"><span class="quick-card__icon">' + ui.icon('chart', 18) + '</span><span><strong>Compare</strong><small>Six algorithms on one dataset, or benchmark sizes.</small></span></a>' +
        '<a class="quick-card" href="#/reports"><span class="quick-card__icon">' + ui.icon('bookmark', 18) + '</span><span><strong>Reports</strong><small>Recorded results, CSV export, printable reports.</small></span></a>' +
      '</div>';
  };
})();
