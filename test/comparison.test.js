/* Comparison layer tests — Node assert, real engine as source of truth.
   Run: node test/comparison.test.js */
'use strict';
var assert = require('assert');
var path = require('path');

global.window = {};
require(path.resolve(__dirname, '../src/scheduler.js'));
require(path.resolve(__dirname, '../src/comparison.js'));
var C = global.window.comparison;

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

var SMALL = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 8, priority: 3 }];
var SRTF_IN = [{ pid: 1, arrivalTime: 0, burstTime: 7, priority: 1 }, { pid: 2, arrivalTime: 2, burstTime: 4, priority: 2 }, { pid: 3, arrivalTime: 4, burstTime: 1, priority: 3 }, { pid: 4, arrivalTime: 5, burstTime: 4, priority: 4 }];

check('all six configurations run on a valid dataset', function () {
  var cmp = C.runComparison(SMALL, { quantum: 2, contextSwitchCost: 0 });
  assert.strictEqual(cmp.runs.length, 6);
  assert.strictEqual(cmp.validCount, 6);
  assert.deepStrictEqual(cmp.runs.map(function (r) { return r.id; }), ['fcfs', 'sjf', 'srtf', 'priority-np', 'priority-p', 'rr']);
  cmp.runs.forEach(function (r) { assert.ok(r.ok, r.label); assert.ok(r.result && r.summary); assert.ok(r.color); });
});

check('both priority modes are distinct and configured', function () {
  var cmp = C.runComparison(SMALL, { quantum: 2 });
  var np = cmp.runs.filter(function (r) { return r.id === 'priority-np'; })[0];
  var pp = cmp.runs.filter(function (r) { return r.id === 'priority-p'; })[0];
  assert.strictEqual(np.config.priorityMode, 'non-preemptive');
  assert.strictEqual(pp.config.priorityMode, 'preemptive');
  assert.notDeepStrictEqual(np.result.segments, pp.result.segments);
});

check('every run receives the same dataset snapshot', function () {
  var cmp = C.runComparison(SMALL, { quantum: 3, contextSwitchCost: 1 });
  var base = cmp.runs[0].result.processes.map(function (p) { return p.pid + ':' + p.arrivalTime + ':' + p.burstTime + ':' + p.priority; }).sort().join('|');
  cmp.runs.forEach(function (r) {
    var cur = r.result.processes.map(function (p) { return p.pid + ':' + p.arrivalTime + ':' + p.burstTime + ':' + p.priority; }).sort().join('|');
    assert.strictEqual(cur, base);
    assert.strictEqual(r.config.contextSwitchCost, 1);
  });
  assert.strictEqual(cmp.runs.filter(function (r) { return r.id === 'rr'; })[0].config.quantum, 3);
});

check('summary mirrors engine output exactly', function () {
  var cmp = C.runComparison(SMALL, { quantum: 2, contextSwitchCost: 1 });
  cmp.runs.forEach(function (r) {
    assert.strictEqual(r.summary.avgWaiting, r.result.averages.waiting);
    assert.strictEqual(r.summary.avgTurnaround, r.result.averages.turnaround);
    assert.strictEqual(r.summary.avgResponse, r.result.averages.response);
    assert.strictEqual(r.summary.cpuUtilization, r.result.cpuUtilization);
    assert.strictEqual(r.summary.throughput, r.result.throughput);
    assert.strictEqual(r.summary.makespan, r.result.makespan);
    assert.strictEqual(r.summary.contextSwitches, r.result.contextSwitches);
  });
});

check('context-switch overhead applies to every algorithm', function () {
  var cmp = C.runComparison(SMALL, { quantum: 2, contextSwitchCost: 2 });
  assert.strictEqual(cmp.validCount, 6);
  cmp.runs.forEach(function (r) { assert.ok(r.result.overheadTime > 0, r.label + ' paid overhead'); });
});

check('ranking direction follows each metric', function () {
  var cmp = C.runComparison(SRTF_IN, { quantum: 2 });
  assert.strictEqual(C.rank(cmp.runs, 'avgWaiting').direction, 'asc');
  assert.strictEqual(C.rank(cmp.runs, 'cpuUtilization').direction, 'desc');
  assert.strictEqual(C.rank(cmp.runs, 'throughput').direction, 'desc');
  assert.strictEqual(C.rank(cmp.runs, 'contextSwitches').direction, 'asc');
  var asc = C.rank(cmp.runs, 'avgWaiting');
  for (var i = 1; i < asc.rows.length; i++) assert.ok(asc.rows[i].value >= asc.rows[i - 1].value);
  assert.strictEqual(asc.rows[0].value, Math.min.apply(null, asc.rows.map(function (r) { return r.value; })));
});

check('ties share a rank and are flagged (competition ranking)', function () {
  var fake = [
    { id: 'a', label: 'A', ok: true, summary: { avgWaiting: 5 } },
    { id: 'b', label: 'B', ok: true, summary: { avgWaiting: 3 } },
    { id: 'c', label: 'C', ok: true, summary: { avgWaiting: 3 } },
    { id: 'd', label: 'D', ok: true, summary: { avgWaiting: 8 } }
  ];
  var r = C.rank(fake, 'avgWaiting', 'asc');
  var byId = {};
  r.rows.forEach(function (x) { byId[x.id] = x; });
  assert.strictEqual(byId.b.rank, 1);
  assert.strictEqual(byId.c.rank, 1);
  assert.ok(byId.b.tie && byId.c.tie);
  assert.strictEqual(byId.a.rank, 3);
  assert.strictEqual(byId.d.rank, 4);
  assert.ok(!byId.a.tie && !byId.d.tie);
});

check('bestByMetric returns all tied winners and never a fake winner', function () {
  var fake = [
    { id: 'a', label: 'A', color: '#1', ok: true, summary: { avgWaiting: 3 } },
    { id: 'b', label: 'B', color: '#2', ok: true, summary: { avgWaiting: 3 } },
    { id: 'c', label: 'C', color: '#3', ok: true, summary: { avgWaiting: 5 } }
  ];
  var best = C.bestByMetric(fake, 'avgWaiting');
  assert.strictEqual(best.tie, true);
  assert.deepStrictEqual(best.winners.map(function (w) { return w.id; }), ['a', 'b']);
  var unique = C.bestByMetric(fake.filter(function (x) { return x.id !== 'b'; }), 'avgWaiting');
  assert.strictEqual(unique.tie, false);
  assert.deepStrictEqual(unique.winners.map(function (w) { return w.id; }), ['a']);
  assert.strictEqual(C.bestByMetric([{ id: 'x', label: 'X', ok: false }], 'avgWaiting'), null);
});

check('failed runs are excluded from ranking and reported, not zero-filled', function () {
  var cmp = C.runComparison(SMALL, { contextSwitchCost: 0 }); // no quantum -> RR fails
  var rr = cmp.runs.filter(function (r) { return r.id === 'rr'; })[0];
  assert.strictEqual(rr.ok, false);
  assert.ok(/quantum/i.test(rr.error));
  assert.strictEqual(cmp.validCount, 5);
  var ranked = C.rank(cmp.runs, 'avgWaiting').rows.map(function (r) { return r.id; });
  assert.ok(ranked.indexOf('rr') === -1);
  cmp.runs.filter(function (r) { return r.ok; }).forEach(function (r) { assert.ok(typeof r.summary.avgWaiting === 'number'); });
});

check('empty dataset fails every run without throwing', function () {
  var cmp = C.runComparison([], { quantum: 2 });
  assert.strictEqual(cmp.validCount, 0);
  cmp.runs.forEach(function (r) { assert.strictEqual(r.ok, false); assert.ok(r.error); });
  assert.strictEqual(C.rank(cmp.runs, 'avgWaiting').rows.length, 0);
  assert.strictEqual(C.chartBars(cmp.runs, 'avgWaiting').hasData, false);
});

check('source dataset is never mutated', function () {
  var src = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }];
  var snap = JSON.parse(JSON.stringify(src));
  C.runComparison(src, { quantum: 2, contextSwitchCost: 1 });
  assert.deepStrictEqual(src, snap);
});

check('PID identity survives input reordering', function () {
  var orderA = [{ pid: 1, arrivalTime: 0, burstTime: 4, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 2, priority: 3 }];
  var orderB = [orderA[2], orderA[1], orderA[0]];
  [orderA, orderB].forEach(function (order) {
    C.runComparison(order, { quantum: 2 }).runs.forEach(function (r) {
      assert.strictEqual(r.result.processes.map(function (p) { return p.pid; }).sort().join(','), '1,2,3');
      r.result.processes.forEach(function (p) {
        var src = order.filter(function (x) { return x.pid === p.pid; })[0];
        assert.strictEqual(p.arrivalTime, src.arrivalTime);
        assert.strictEqual(p.burstTime, src.burstTime);
        assert.strictEqual(p.turnaroundTime, p.completionTime - p.arrivalTime);
      });
    });
  });
});

check('chart bars handle identical, zero and empty values', function () {
  var identical = [{ id: 'a', label: 'A', ok: true, summary: { avgWaiting: 5 } }, { id: 'b', label: 'B', ok: true, summary: { avgWaiting: 5 } }];
  var ci = C.chartBars(identical, 'avgWaiting');
  assert.ok(ci.bars.every(function (b) { return b.height === 1; }));
  assert.strictEqual(ci.allZero, false);
  var zeros = [{ id: 'a', label: 'A', ok: true, summary: { avgWaiting: 0 } }, { id: 'b', label: 'B', ok: true, summary: { avgWaiting: 0 } }];
  var cz = C.chartBars(zeros, 'avgWaiting');
  assert.strictEqual(cz.allZero, true);
  assert.ok(cz.bars.every(function (b) { return b.height === 0 && b.isZero; }));
  var none = C.chartBars([{ id: 'a', label: 'A', ok: false }], 'avgWaiting');
  assert.strictEqual(none.hasData, false);
  assert.strictEqual(none.bars.length, 0);
});

check('metric formatting respects units and percent metrics', function () {
  assert.strictEqual(C.formatMetric('avgWaiting', 3.3333), '3.33');
  assert.strictEqual(C.formatMetric('cpuUtilization', 0.8123), '81.2%');
  assert.strictEqual(C.formatMetric('makespan', 16), '16');
  assert.strictEqual(C.formatMetric('throughput', 0.1875), '0.188');
});

check('dataset change produces fresh results', function () {
  var a = C.runComparison(SMALL, { quantum: 2 });
  var b = C.runComparison(SRTF_IN, { quantum: 2 });
  var af = a.runs[0].summary, bf = b.runs[0].summary;
  assert.notStrictEqual(af.completedCount, bf.completedCount);
  assert.strictEqual(a.datasetSize, 3);
  assert.strictEqual(b.datasetSize, 4);
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all comparison checks passed');
