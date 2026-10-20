/* OS Scheduling Comparator — comparison layer (pure logic, no DOM).
   Runs all six algorithm configurations over ONE identical dataset snapshot using
   the engine. Never re-implements an algorithm, never mutates the source dataset,
   and isolates per-algorithm failures (a failed run is reported, never zero-filled). */
(function () {
  'use strict';
  var scheduler = window.scheduler;

  var METRICS = [
    { id: 'avgWaiting', label: 'Average Waiting Time', short: 'Avg wait', unit: 'tu', lower: true, decimals: 2 },
    { id: 'avgTurnaround', label: 'Average Turnaround Time', short: 'Avg turnaround', unit: 'tu', lower: true, decimals: 2 },
    { id: 'avgResponse', label: 'Average Response Time', short: 'Avg response', unit: 'tu', lower: true, decimals: 2 },
    { id: 'cpuUtilization', label: 'CPU Utilization', short: 'CPU util', unit: '%', lower: false, decimals: 1, percent: true },
    { id: 'throughput', label: 'Throughput', short: 'Throughput', unit: 'proc/tu', lower: false, decimals: 3 },
    { id: 'makespan', label: 'Makespan', short: 'Makespan', unit: 'tu', lower: true, decimals: 0 },
    { id: 'contextSwitches', label: 'Context Switches', short: 'Context switches', unit: '', lower: true, decimals: 0 }
  ];

  var ALGORITHMS = [
    { id: 'fcfs', label: 'FCFS', full: 'First Come, First Served', algorithm: 'fcfs', preemptive: false, color: '#A5B4FC' },
    { id: 'sjf', label: 'SJF', full: 'Shortest Job First', algorithm: 'sjf', preemptive: false, color: '#7DD3FC' },
    { id: 'srtf', label: 'SRTF', full: 'Shortest Remaining Time First', algorithm: 'srtf', preemptive: true, color: '#6EE7B7' },
    { id: 'priority-np', label: 'Priority (NP)', full: 'Priority, non-preemptive', algorithm: 'priority', priorityMode: 'non-preemptive', preemptive: false, color: '#C4B5FD' },
    { id: 'priority-p', label: 'Priority (P)', full: 'Priority, preemptive', algorithm: 'priority', priorityMode: 'preemptive', preemptive: true, color: '#F0ABFC' },
    { id: 'rr', label: 'Round Robin', full: 'Round Robin', algorithm: 'rr', preemptive: true, color: '#FCD34D' }
  ];

  function summarize(result) {
    return {
      avgWaiting: result.averages.waiting,
      avgTurnaround: result.averages.turnaround,
      avgResponse: result.averages.response,
      cpuUtilization: result.cpuUtilization,
      throughput: result.throughput,
      makespan: result.makespan,
      contextSwitches: result.contextSwitches,
      overheadTime: result.overheadTime,
      idleTime: result.idleTime,
      completedCount: result.completedCount
    };
  }

  function cloneProcesses(processes) {
    return processes.map(function (p) {
      return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority };
    });
  }

  // Runs all six configurations over a fresh snapshot. Each run:
  // { id, label, full, color, ok, result?, summary?, error?, config }.
  function runComparison(processes, config) {
    config = config || {};
    var quantum = config.quantum;
    var ctx = config.contextSwitchCost == null ? 0 : config.contextSwitchCost;
    var snap = cloneProcesses(processes);
    var runs = ALGORITHMS.map(function (a) {
      var cfg = { algorithm: a.algorithm, contextSwitchCost: ctx, priorityMode: a.priorityMode || 'non-preemptive' };
      if (a.algorithm === 'rr') cfg.quantum = quantum;
      try {
        var result = scheduler.simulate({
          processes: snap,
          algorithm: cfg.algorithm,
          quantum: cfg.quantum,
          contextSwitchCost: cfg.contextSwitchCost,
          priorityMode: cfg.priorityMode
        });
        return { id: a.id, label: a.label, full: a.full, color: a.color, ok: true, result: result, summary: summarize(result), config: cfg };
      } catch (e) {
        return { id: a.id, label: a.label, full: a.full, color: a.color, ok: false, error: e && e.message ? e.message : String(e), config: cfg };
      }
    });
    return { runs: runs, validCount: runs.filter(function (r) { return r.ok; }).length, datasetSize: snap.length };
  }

  function metricById(id) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].id === id) return METRICS[i];
    return null;
  }

  // Competition ranking over valid runs: ties share a rank, the next rank skips.
  function rank(runs, metricId, direction) {
    var m = metricById(metricId);
    var dir = direction || (m && m.lower ? 'asc' : 'desc');
    var valid = runs.filter(function (r) { return r.ok; }).map(function (r) {
      return { id: r.id, label: r.label, color: r.color, value: r.summary[metricId] };
    });
    valid.sort(function (a, b) { return dir === 'asc' ? a.value - b.value : b.value - a.value; });
    var rows = [];
    for (var i = 0; i < valid.length; i++) {
      var v = valid[i];
      var first = i;
      while (first > 0 && valid[first - 1].value === v.value) first--;
      var tie = (i > 0 && valid[i - 1].value === v.value) || (i < valid.length - 1 && valid[i + 1].value === v.value);
      rows.push({ rank: first + 1, id: v.id, label: v.label, color: v.color, value: v.value, tie: tie });
    }
    return { metric: metricId, direction: dir, lower: m ? m.lower : true, rows: rows };
  }

  // Best value(s) for one metric; ties are returned as multiple winners.
  function bestByMetric(runs, metricId) {
    var r = rank(runs, metricId);
    if (!r.rows.length) return null;
    var best = r.rows[0].value;
    var winners = r.rows.filter(function (row) { return row.value === best; });
    return { metric: metricId, value: best, winners: winners, tie: winners.length > 1 };
  }

  // Bar-chart geometry for one metric across valid runs (SVG, no library).
  function chartBars(runs, metricId) {
    var valid = runs.filter(function (r) { return r.ok; }).map(function (r) {
      return { id: r.id, label: r.label, color: r.color, value: r.summary[metricId] };
    });
    var max = 0;
    for (var i = 0; i < valid.length; i++) if (valid[i].value > max) max = valid[i].value;
    var allZero = valid.length > 0 && max === 0;
    var scale = max > 0 ? max : 1;
    return {
      bars: valid.map(function (v) {
        return { id: v.id, label: v.label, color: v.color, value: v.value, height: v.value / scale, isZero: v.value === 0 };
      }),
      max: max, hasData: valid.length > 0, allZero: allZero
    };
  }

  function formatMetric(metricId, value) {
    var m = metricById(metricId);
    if (m && m.percent) return (value * 100).toFixed(m.decimals) + '%';
    var d = m ? m.decimals : 2;
    return Number(value).toFixed(d);
  }

  window.comparison = {
    runComparison: runComparison, rank: rank, bestByMetric: bestByMetric, chartBars: chartBars,
    summarize: summarize, metricById: metricById, formatMetric: formatMetric,
    cloneProcesses: cloneProcesses, ALGORITHMS: ALGORITHMS, METRICS: METRICS
  };
})();
