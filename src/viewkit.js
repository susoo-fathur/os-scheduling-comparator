/* OS Scheduling Comparator — shared view helpers (HTML/SVG strings, no state).
   Used by the screen modules. Charts are native SVG; no charting library. */
(function () {
  'use strict';
  var ui = window.ui;
  var store = window.store;
  var comparison = window.comparison;

  /* Chart neutrals — aligned with tokens.css (SVG presentation attributes
     cannot consume CSS custom properties reliably). */
  var C = {
    idle: '#2A353B',
    switch: '#475569',
    labelDark: '#0C1112',
    labelLight: '#E5E7EB',
    axis: '#4B5A61',
    chartAxis: '#3F4B52',
    grid: '#263136',
    chartBg: '#0E1416'
  };

  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    if (d != null) return Number(n).toFixed(d);
    return Number.isInteger(n) ? String(n) : Number(n).toFixed(2);
  }
  function metricValue(id, v) { return v == null ? '—' : comparison.formatMetric(id, v); }
  function pct(v, d) { return v == null ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%'; }

  function processColor(procs, pid) {
    for (var i = 0; i < procs.length; i++) if (procs[i].pid === pid) return store.colorForIndex(i);
    return 'var(--idle)';
  }

  function ticksFor(makespan, count) {
    if (makespan <= 0) return [0];
    var n = Math.min(count || 8, makespan + 1);
    var out = [];
    for (var i = 0; i <= n; i++) out.push(Math.round((makespan * i) / n));
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  /* Gantt: SVG blocks on a linear time scale. Half-open [start,end) segments.
     The playback cursor is a separate absolutely-positioned element (id="sim-cursor")
     so a tick only changes one style, never re-renders the chart. */
  function gantt(result, procs, opts) {
    opts = opts || {};
    var makespan = result.makespan || 1;
    var height = opts.height || 58;
    var width = Math.max(560, Math.min(makespan * 18, 6000));
    var scale = width / makespan;
    var colors = {};
    procs.forEach(function (p, i) { colors[p.pid] = store.colorForIndex(i); });
    // Segments past the playhead are dimmed until they are reached; the flag is
    // applied here so the first paint is already correct, then a tick only
    // toggles the segments that actually crossed (see app.js paintTimeline).
    var reached = opts.reveal ? (opts.currentTime || 0) : Infinity;
    var blocks = result.segments.map(function (s) {
      var x = s.start * scale, w = Math.max((s.end - s.start) * scale, 1);
      var fill = s.type === 'process' ? colors[s.pid] : (s.type === 'idle' ? C.idle : C.switch);
      var label = s.type === 'process' ? 'P' + s.pid : (s.type === 'idle' ? 'idle' : 'switch');
      var title = label + ' [' + s.start + ', ' + s.end + ')';
      var cls = 'gantt-seg gantt-seg--' + s.type + (s.start > reached ? ' gantt-seg--future' : '');
      var text = w >= 30
        ? '<text x="' + (x + w / 2) + '" y="' + (height / 2 + 4) + '" text-anchor="middle" class="gantt-label" fill="' + (s.type === 'process' ? C.labelDark : C.labelLight) + '">' + ui.esc(label) + '</text>'
        : '';
      return '<g class="' + cls + '" data-start="' + s.start + '" data-end="' + s.end + '" data-type="' + s.type + '">' +
        '<title>' + ui.esc(title) + '</title><rect class="gantt-bar' + (s.type === 'context-switch' ? ' gantt-cs' : '') + '" x="' + x + '" y="10" width="' + w + '" height="' + (height - 24) + '" fill="' + fill + '" rx="1"/>' + text + '</g>';
    }).join('');
    var axis = ticksFor(makespan, opts.ticks || 8).map(function (t) {
      var x = t * scale;
      return '<line x1="' + x + '" y1="' + (height - 12) + '" x2="' + x + '" y2="' + (height - 7) + '" stroke="' + C.axis + '" />' +
        '<text x="' + x + '" y="' + (height - 1) + '" text-anchor="middle" class="gantt-tick">' + t + '</text>';
    }).join('');
    var cursor = opts.cursor === false ? '' :
      '<div class="gantt-cursor" id="sim-cursor" aria-hidden="true"></div>';
    var legend = opts.legend === false ? '' : '<div class="gantt-legend">' +
      procs.slice(0, 12).map(function (p, i) {
        return ui.processMarker({ color: store.colorForIndex(i), label: 'P' + p.pid, size: 'sm' });
      }).join('') +
      (procs.length > 12 ? '<span class="muted small">+' + (procs.length - 12) + ' more</span>' : '') +
      ui.processMarker({ color: C.idle, label: 'idle', size: 'sm' }) +
      ui.processMarker({ color: C.switch, label: 'switch', size: 'sm' }) + '</div>';
    return '<div class="gantt" data-scale="' + scale + '">' +
      '<div class="gantt-scroll" id="sim-track"><div class="gantt-inner" style="width:' + width + 'px">' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Execution timeline from 0 to ' + makespan + ' time units">' +
      '<title>Execution timeline, 0 to ' + makespan + ' time units</title>' +
      '<rect x="0" y="10" width="' + width + '" height="' + (height - 24) + '" fill="' + C.chartBg + '" />' + blocks + axis + '</svg>' +
      cursor + '</div></div>' + legend + '</div>';
  }

  function barChart(runs, metricId) {
    var data = comparison.chartBars(runs, metricId);
    var m = comparison.metricById(metricId);
    if (!data.hasData) return '<p class="muted small">No valid results to chart.</p>';
    var W = 560, H = 210, padL = 10, padR = 10, padT = 22, padB = 46, chartH = H - padT - padB;
    var n = data.bars.length, bw = (W - padL - padR) / n;
    var bars = data.bars.map(function (b, i) {
      var x = padL + i * bw;
      var h = Math.round(b.height * chartH);
      if (h < 2 && !b.isZero) h = 2;
      var y = padT + chartH - h;
      return '<g><title>' + ui.esc(b.label + ': ' + metricValue(metricId, b.value)) + '</title>' +
        '<rect class="chart-bar" style="animation-delay:' + (i * 18) + 'ms" x="' + (x + 6) + '" y="' + y + '" width="' + Math.max(bw - 12, 4) + '" height="' + Math.max(h, 1) + '" fill="' + b.color + '" rx="1" />' +
        '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" class="bar-value">' + metricValue(metricId, b.value) + '</text>' +
        '<text x="' + (x + bw / 2) + '" y="' + (H - padB + 16) + '" text-anchor="middle" class="bar-label">' + ui.esc(b.label) + '</text></g>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + ui.esc(m.label + ' by algorithm') + '">' +
      '<line x1="' + padL + '" y1="' + (padT + chartH) + '" x2="' + (W - padR) + '" y2="' + (padT + chartH) + '" stroke="' + C.chartAxis + '" />' +
      bars + '</svg>';
  }

  /* Multi-series line chart: values[algoId][size] = number. Sizes on x, evenly spaced. */
  function lineChart(series, sizes, metricId, opts) {
    opts = opts || {};
    if (!sizes.length) return '<p class="muted small">No benchmark data.</p>';
    var W = 720, H = 240, padL = 44, padR = 12, padT = 16, padB = 34;
    var chartW = W - padL - padR, chartH = H - padT - padB;
    var max = 0;
    series.forEach(function (s) { sizes.forEach(function (sz) { var v = s.values[sz]; if (v != null && v > max) max = v; }); });
    if (max <= 0) max = 1;
    function xAt(i) { return padL + (sizes.length === 1 ? chartW / 2 : (i * chartW) / (sizes.length - 1)); }
    function yAt(v) { return padT + chartH - (v / max) * chartH; }
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
      var y = padT + chartH - f * chartH;
      return '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + C.grid + '" />' +
        '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="axis-label">' + metricValue(metricId, max * f) + '</text>';
    }).join('');
    var xLabels = sizes.map(function (sz, i) {
      return '<text x="' + xAt(i) + '" y="' + (H - 10) + '" text-anchor="middle" class="axis-label">' + sz + '</text>';
    }).join('');
    var paths = series.map(function (s) {
      var pts = [], dots = [];
      sizes.forEach(function (sz, i) {
        var v = s.values[sz];
        if (v == null) return;
        pts.push([xAt(i), yAt(v)]);
        dots.push('<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(v).toFixed(1) + '" r="2.5" fill="' + s.color + '"><title>' +
          ui.esc(s.label + ' · ' + sz + ' processes · ' + metricValue(metricId, v)) + '</title></circle>');
      });
      if (!pts.length) return '';
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.8" />' + dots.join('');
    }).join('');
    var legend = series.map(function (s) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' + ui.esc(s.label) + '</span>';
    }).join('');
    return '<figure class="linechart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + ui.esc((opts.title || 'Metric') + ' by dataset size') + '">' +
      '<title>' + ui.esc(opts.title || '') + '</title>' + grid + xLabels + paths +
      '<text x="' + (padL + chartW / 2) + '" y="' + (H - 0) + '" text-anchor="middle" class="axis-label">processes</text>' +
      '</svg><figcaption class="legend">' + legend + '</figcaption></figure>';
  }

  function kv(rows) {
    return '<dl class="kv">' + rows.map(function (r) {
      return '<div class="kv__row"><dt>' + ui.esc(r.k) + '</dt><dd class="mono">' + (r.raw ? r.v : ui.esc(r.v)) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function stat(label, value, unit, opts) {
    opts = opts || {};
    return '<div class="stat' + (opts.accent ? ' stat--accent' : '') + '">' +
      '<span class="stat__label">' + ui.esc(label) + '</span>' +
      '<strong class="stat__value mono">' + value + (unit ? '<small>' + ui.esc(unit) + '</small>' : '') + '</strong>' +
      (opts.note ? '<span class="stat__note">' + ui.esc(opts.note) + '</span>' : '') + '</div>';
  }

  function algoChip(a) {
    return '<span class="algo-chip"><span class="algo-chip__dot" style="background:' + a.color + '"></span>' + ui.esc(a.label) + '</span>';
  }

  function kindBadge(kind) {
    var map = { simulation: ['Simulation', 'neutral'], comparison: ['Comparison', 'neutral'], benchmark: ['Benchmark', 'neutral'] };
    var v = map[kind] || ['Unknown', 'error'];
    return ui.badge({ text: v[0], variant: v[1] });
  }

  function timeAgo(ts) {
    var diff = Math.max(0, Date.now() - ts);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' h ago';
    return Math.floor(hrs / 24) + ' d ago';
  }
  function dateTime(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); } }

  /* Explanations: decision text comes from src/explanations.js (engine trace only).
     Rendered as compact blocks so the Simulate panel can patch them per tick. */
  function decisionExplanation(result, time, opts) {
    opts = opts || {};
    var ex = window.explanations;
    if (!ex || !result || !result.decisions) {
      return '<p class="muted small">No decision trace for this result.</p>';
    }
    var lastRecord = result.decisions.length ? result.decisions[result.decisions.length - 1] : null;
    if (result.traceTruncated && lastRecord && time > lastRecord.time) {
      return '<p class="muted small">The decision trace is limited to the first ' + result.decisions.length + ' decisions; no explanation is recorded after t=' + lastRecord.time + '.</p>';
    }
    var items = ex.forTime(result, time);
    if (!items.length) {
      return '<p class="muted small">No scheduling decision has occurred at or before t=' + time + '.</p>';
    }
    return items.map(function (it) {
      return '<div class="explain__item">' +
        '<span class="explain__badge mono">t=' + it.time + ' · ' + ui.esc(it.title) + '</span>' +
        '<p class="explain__text">' + ui.esc(it.text) + '</p>' +
        (it.tie ? '<p class="explain__note">' + ui.esc(it.tie) + '</p>' : '') +
        (it.detail ? '<p class="explain__detail mono">' + ui.esc(it.detail) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function statusBadge(status) {
    if (status === 'completed') return ui.badge({ text: 'completed', variant: 'success' });
    if (status === 'in-progress') return ui.badge({ text: 'in progress', variant: 'warning' });
    return ui.badge({ text: 'not started', variant: 'neutral' });
  }
  function calcText(calc, unit) {
    if (!calc) return '<span class="pending">pending</span>';
    return ui.esc(calc.a + ' - ' + calc.b + ' = ' + calc.value) + (unit ? ' ' + ui.esc(unit) : '');
  }
  function kvRow(label, value, raw) {
    return '<div class="kv__row"><dt>' + ui.esc(label) + '</dt><dd class="mono">' + (raw ? value : ui.esc(value)) + '</dd></div>';
  }

  /* Per-process metric breakdown with the formulas the app already uses.
     Values unavailable at `time` (playback position) stay explicitly pending. */
  function metricBreakdown(result, time, opts) {
    opts = opts || {};
    var ex = window.explanations;
    if (!ex || !result) return '<p class="muted small">No result to break down.</p>';
    var rows = ex.metricBreakdown(result, time);
    var limit = opts.limit || 120;
    var items = rows.slice(0, limit).map(function (r) {
      var head = r.status === 'completed'
        ? 'TAT ' + fmt(r.turnaroundTime) + ' · WT ' + fmt(r.waitingTime) + ' · RT ' + fmt(r.responseTime)
        : r.status === 'in-progress'
          ? 'RT ' + fmt(r.responseTime) + ' · completion pending'
          : 'no CPU time yet';
      return '<details class="metric-proc" data-metric-pid="' + r.pid + '">' +
        '<summary>' + ui.processMarker({ id: 'P' + r.pid, label: 'P' + r.pid, size: 'sm', color: opts.colorFor ? opts.colorFor(r.pid) : undefined }) +
        statusBadge(r.status) + '<span class="metric-proc__head mono">' + ui.esc(head) + '</span></summary>' +
        '<div class="metric-calc"><dl class="kv">' +
        kvRow('Arrival Time', String(r.arrivalTime)) +
        kvRow('Burst Time', String(r.burstTime)) +
        kvRow('First CPU Start', r.started ? String(r.startTime) : 'pending — not dispatched yet') +
        kvRow('Completion Time', r.status === 'completed' ? String(r.completionTime) : (r.status === 'in-progress' ? 'in progress — completion pending' : 'pending')) +
        kvRow('Turnaround Time', calcText(r.turnaround, 'tu'), true) +
        kvRow('Waiting Time', calcText(r.waiting, 'tu'), true) +
        kvRow('Response Time', calcText(r.response, 'tu'), true) +
        '</dl><p class="muted small">Turnaround = completion − arrival · Waiting = turnaround − burst · Response = first CPU start − arrival.</p></div></details>';
    }).join('');
    return '<div class="metric-list">' + items + '</div>' +
      (rows.length > limit ? '<p class="muted small">Showing the first ' + limit + ' of ' + rows.length + ' processes.</p>' : '');
  }

  /* Data-driven comparison explanations (one card per primary metric). */
  function comparisonExplanation(runs, opts) {
    opts = opts || {};
    var ex = window.explanations;
    if (!ex) return '<p class="muted small">Explanations unavailable.</p>';
    var cards = ex.compareSummary(runs, opts).map(function (r) {
      var badge = r.status === 'ok' ? ui.badge({ text: 'observed winner', variant: 'success' })
        : r.status === 'tie' ? ui.badge({ text: 'tie', variant: 'neutral' })
        : ui.badge({ text: r.status === 'partial' ? 'partial results' : r.status === 'stale' ? 'outdated' : 'unavailable', variant: 'warning' });
      return '<div class="explain-card"><div class="explain-card__head"><span class="explain-card__metric">' + ui.esc(r.label) + '</span>' + badge + '</div>' +
        '<p class="explain__text">' + ui.esc(r.text) + '</p>' +
        (r.rule && r.status !== 'stale' && r.status !== 'unavailable' ? '<p class="muted small">General rule: ' + ui.esc(r.rule) + '</p>' : '') +
        '</div>';
    }).join('');
    return '<div class="explain-cards">' + cards + '</div>';
  }

  window.kit = {
    fmt: fmt, metricValue: metricValue, pct: pct, processColor: processColor,
    gantt: gantt, barChart: barChart, lineChart: lineChart, kv: kv, stat: stat,
    algoChip: algoChip, kindBadge: kindBadge, timeAgo: timeAgo, dateTime: dateTime,
    ticksFor: ticksFor, decisionExplanation: decisionExplanation, metricBreakdown: metricBreakdown,
    comparisonExplanation: comparisonExplanation
  };
})();
