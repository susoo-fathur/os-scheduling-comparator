/* OS Scheduling Comparator — report export (pure logic, no DOM).
   CSV is built only from recorded experiment snapshots. Missing/failed values are
   written as empty cells or an explicit error column — never invented. */
(function () {
  'use strict';
  var comparison = window.comparison;

  function cell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) { return rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n'; }

  function iso(ts) { try { return new Date(ts).toISOString(); } catch (e) { return String(ts); } }
  function algoLabel(rec) {
    var a = rec.config && rec.config.algorithm ? rec.config.algorithm.toUpperCase() : '';
    if (a === 'PRIORITY') return 'Priority (' + (rec.config.priorityMode === 'preemptive' ? 'preemptive' : 'non-preemptive') + ')';
    if (a === 'RR') return 'Round Robin';
    return a;
  }
  function configRows(rec) {
    var c = rec.config || {};
    return [
      ['Algorithm', algoLabel(rec)],
      ['Priority mode', c.priorityMode || 'n/a'],
      ['Time quantum', c.quantum == null ? 'n/a' : c.quantum],
      ['Context-switch cost (tu)', c.contextSwitchCost == null ? 0 : c.contextSwitchCost],
      ['Processes', rec.dataset ? rec.dataset.length : '']
    ];
  }
  function summaryRows(r) {
    return [
      ['Makespan (tu)', r.makespan],
      ['Average waiting (tu)', r.averages.waiting],
      ['Average turnaround (tu)', r.averages.turnaround],
      ['Average response (tu)', r.averages.response],
      ['CPU utilization (%)', (r.cpuUtilization * 100)],
      ['Throughput (proc/tu)', r.throughput],
      ['Context switches', r.contextSwitches],
      ['Idle time (tu)', r.idleTime],
      ['Overhead time (tu)', r.overheadTime]
    ];
  }

  function simulationCSV(rec) {
    var rows = [
      ['OS Scheduling Comparator — Simulation report'],
      ['Name', rec.name],
      ['Recorded', iso(rec.createdAt)],
      ['Kind', 'simulation']
    ];
    configRows(rec).forEach(function (r) { rows.push(r); });
    if (!rec.result) {
      rows.push(['Result', 'unavailable — recompute required']);
    } else {
      summaryRows(rec.result).forEach(function (r) { rows.push(r); });
      rows.push([]);
      rows.push(['PID', 'Arrival', 'Burst', 'Priority', 'First start', 'Completion', 'Turnaround', 'Waiting', 'Response']);
      rec.result.processes.forEach(function (p) {
        rows.push([p.pid, p.arrivalTime, p.burstTime, p.priority, p.startTime, p.completionTime, p.turnaroundTime, p.waitingTime, p.responseTime]);
      });
    }
    return toCSV(rows);
  }

  function comparisonCSV(rec) {
    var rows = [
      ['OS Scheduling Comparator — Comparison report'],
      ['Name', rec.name],
      ['Recorded', iso(rec.createdAt)],
      ['Processes', rec.dataset ? rec.dataset.length : ''],
      ['Time quantum (RR)', rec.config && rec.config.quantum],
      ['Context-switch cost (tu)', rec.config ? rec.config.contextSwitchCost : 0],
      []
    ];
    var header = ['Algorithm', 'Status'];
    comparison.METRICS.forEach(function (m) { header.push(m.label + (m.unit ? ' (' + m.unit + ')' : '')); });
    rows.push(header);
    var runs = (rec.comparison && rec.comparison.runs) || [];
    runs.forEach(function (run) {
      var row = [run.label, run.ok ? 'ok' : 'failed: ' + (run.error || 'unknown')];
      comparison.METRICS.forEach(function (m) { row.push(run.ok && run.summary ? run.summary[m.id] : ''); });
      rows.push(row);
    });
    return toCSV(rows);
  }

  function benchmarkCSV(rec) {
    var b = rec.benchmark || {};
    var cfg = b.config || {};
    var rows = [
      ['OS Scheduling Comparator — Benchmark report'],
      ['Name', rec.name],
      ['Recorded', iso(rec.createdAt)],
      ['Status', b.complete ? 'complete' : (b.cancelled ? 'cancelled (partial)' : 'incomplete')],
      ['Mode', b.plan && b.plan.manual ? 'saved datasets' : 'random datasets'],
      ['Datasets', b.plan && b.plan.manual ? b.plan.datasets.map(function (d) { return d.name + ' (' + d.size + 'p)'; }).join('; ') : ''],
      ['Rounds per size', cfg.rounds],
      ['Dataset sizes', (b.plan && b.plan.sizes ? b.plan.sizes.join(' ') : '')],
      ['Base seed', cfg.seed],
      ['Time quantum (RR)', cfg.quantum],
      ['Context-switch cost (tu)', cfg.contextSwitchCost],
      ['Arrival range', cfg.generator ? cfg.generator.arrival.min + '-' + cfg.generator.arrival.max : ''],
      ['Burst range', cfg.generator ? cfg.generator.burst.min + '-' + cfg.generator.burst.max : ''],
      ['Priority range', cfg.generator ? cfg.generator.priority.min + '-' + cfg.generator.priority.max : ''],
      ['Round seeds', (b.plan && b.plan.seeds ? b.plan.seeds.join(' ') : '')],
      []
    ];
    var header = ['Algorithm', 'Dataset size', 'Rounds', 'Failures'];
    comparison.METRICS.forEach(function (m) { header.push(m.short + ' mean', m.short + ' min', m.short + ' max', m.short + ' stddev'); });
    rows.push(header);
    (b.cells || []).forEach(function (c) {
      var row = [c.label, c.size, c.rounds, c.failures];
      comparison.METRICS.forEach(function (m) {
        var s = c.metrics ? c.metrics[m.id] : null;
        row.push(s ? s.mean : '', s ? s.min : '', s ? s.max : '', s ? s.stddev : '');
      });
      rows.push(row);
    });
    return toCSV(rows);
  }

  function csvFor(rec) {
    if (rec.kind === 'comparison') return comparisonCSV(rec);
    if (rec.kind === 'benchmark') return benchmarkCSV(rec);
    return simulationCSV(rec);
  }

  function filenameFor(rec) {
    var base = String(rec.name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
    return base + '-' + (rec.kind || 'report') + '.csv';
  }

  window.reports = { toCSV: toCSV, csvFor: csvFor, filenameFor: filenameFor, simulationCSV: simulationCSV, comparisonCSV: comparisonCSV, benchmarkCSV: benchmarkCSV };
})();
