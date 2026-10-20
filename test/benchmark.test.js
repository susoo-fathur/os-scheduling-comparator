/* Benchmark runner tests — deterministic, no DOM.
   Run: node test/benchmark.test.js */
'use strict';
var assert = require('assert');
var path = require('path');

global.window = {};
['scheduler', 'state', 'comparison', 'benchmark'].forEach(function (m) {
  require(path.resolve(__dirname, '../src/' + m + '.js'));
});
var benchmark = global.window.benchmark;
var comparison = global.window.comparison;
var store = global.window.store;

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

var CFG = {
  sizes: [5, 12],
  rounds: 2,
  seed: 'unit-test',
  generator: { arrival: { min: 0, max: 10 }, burst: { min: 1, max: 5 }, priority: { min: 1, max: 3 } },
  quantum: 2,
  contextSwitchCost: 0
};

check('validates configuration', function () {
  assert.strictEqual(benchmark.validateConfig(CFG).ok, true);
  assert.strictEqual(benchmark.validateConfig({ sizes: [], rounds: 2, quantum: 2, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [0], rounds: 2, quantum: 2, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [10, 10], rounds: 2, quantum: 2, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [10], rounds: 0, quantum: 2, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [10], rounds: 2, quantum: 0, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [10], rounds: 2, quantum: 2, contextSwitchCost: -1, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [2001], rounds: 1, quantum: 2, generator: CFG.generator }).ok, false);
  assert.strictEqual(benchmark.validateConfig({ sizes: [10], rounds: 2, quantum: 2, generator: { arrival: { min: 5, max: 2 }, burst: { min: 1, max: 2 }, priority: { min: 1, max: 2 } } }).ok, false);
});

check('statistics are correct (hand-calculated)', function () {
  var s = benchmark.stats([1, 2, 3, 4]);
  assert.strictEqual(s.n, 4);
  assert.strictEqual(s.mean, 2.5);
  assert.strictEqual(s.min, 1);
  assert.strictEqual(s.max, 4);
  assert.ok(Math.abs(s.stddev - Math.sqrt(5 / 3)) < 1e-12);
  assert.deepStrictEqual(benchmark.stats([7]), { n: 1, mean: 7, min: 7, max: 7, stddev: 0 });
  assert.strictEqual(benchmark.stats([]), null);
});

check('runs every algorithm for every size and round', function () {
  var r = benchmark.runSync(CFG);
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.cancelled, false);
  assert.strictEqual(r.cells.length, 6 * 2);
  r.cells.forEach(function (c) {
    assert.strictEqual(c.rounds, 2, c.algoId + '/' + c.size + ' has 2 rounds');
    assert.strictEqual(c.failures, 0);
    comparison.METRICS.forEach(function (m) {
      assert.ok(c.metrics[m.id], 'metric ' + m.id + ' present');
      assert.strictEqual(c.metrics[m.id].n, 2);
      assert.ok(c.metrics[m.id].min <= c.metrics[m.id].mean);
      assert.ok(c.metrics[m.id].mean <= c.metrics[m.id].max);
    });
  });
});

check('same config reproduces the same benchmark', function () {
  var a = benchmark.runSync(CFG);
  var b = benchmark.runSync(CFG);
  assert.deepStrictEqual(a.plan.seeds, b.plan.seeds);
  assert.deepStrictEqual(a.cells, b.cells);
});

check('different base seed produces different data', function () {
  var a = benchmark.runSync(CFG);
  var b = benchmark.runSync(Object.assign({}, CFG, { seed: 'other' }));
  assert.notDeepStrictEqual(a.plan.seeds, b.plan.seeds);
  assert.notDeepStrictEqual(a.cells, b.cells);
});

check('rounds use different seeds', function () {
  var r = benchmark.runSync(CFG);
  assert.strictEqual(r.plan.seeds.length, 2);
  assert.notStrictEqual(r.plan.seeds[0], r.plan.seeds[1]);
});

check('each size is an exact prefix of the round base dataset', function () {
  var v = benchmark.validateConfig(CFG).value;
  var base = benchmark.baseDataset(v, 0);
  var r = benchmark.runSync(Object.assign({}, CFG, { rounds: 1 }));
  var prefix = base.processes.slice(0, 5);
  var expected = comparison.runComparison(prefix, { quantum: CFG.quantum, contextSwitchCost: 0 });
  expected.runs.forEach(function (run) {
    var cell = r.cells.filter(function (c) { return c.algoId === run.id && c.size === 5; })[0];
    comparison.METRICS.forEach(function (m) {
      assert.ok(Math.abs(cell.metrics[m.id].mean - run.summary[m.id]) < 1e-12, m.id + ' matches direct run on prefix');
    });
  });
});

check('nested methodology is recorded', function () {
  var r = benchmark.runSync(CFG);
  assert.strictEqual(r.plan.nested, true);
  assert.ok(r.plan.note.indexOf('prefix') >= 0);
  assert.deepStrictEqual(r.plan.sizes, [5, 12]);
  assert.deepStrictEqual(r.plan.generator, CFG.generator);
});

check('context-switch overhead is applied consistently', function () {
  var r = benchmark.runSync(Object.assign({}, CFG, { contextSwitchCost: 1, sizes: [6], rounds: 1 }));
  assert.strictEqual(r.cells.length, 6);
  r.cells.forEach(function (c) { assert.strictEqual(c.failures, 0); });
  var fcfs = r.cells.filter(function (c) { return c.algoId === 'fcfs'; })[0];
  assert.ok(fcfs.metrics.contextSwitches.mean >= 0);
});

check('chunked runner exposes progress and cancellation', function () {
  var runner = benchmark.createRunner(CFG);
  var s1 = runner.step();
  assert.strictEqual(s1.unitsDone, 1);
  assert.strictEqual(s1.totalUnits, 4);
  runner.step();
  runner.cancel();
  var partial = runner.result();
  assert.strictEqual(partial.cancelled, true);
  assert.strictEqual(partial.complete, false);
  assert.strictEqual(partial.unitsDone, 2);
  // Partial results still report only units actually executed.
  var cell = partial.cells.filter(function (c) { return c.algoId === 'fcfs' && c.size === 5; })[0];
  assert.strictEqual(cell.rounds, 1);
  var cell2 = partial.cells.filter(function (c) { return c.algoId === 'fcfs' && c.size === 12; })[0];
  assert.strictEqual(cell2.rounds, 1);
  var cellRound2 = benchmark.runSync(Object.assign({}, CFG, { rounds: 2 })).cells.filter(function (c) { return c.algoId === 'fcfs' && c.size === 5; })[0];
  assert.strictEqual(cellRound2.rounds, 2);
});

check('start() drives to completion with an injected scheduler', function () {
  var runner = benchmark.createRunner(Object.assign({}, CFG, { sizes: [4], rounds: 1 }));
  var steps = 0, finished = null;
  runner.start({
    schedule: function (fn) { fn(); },
    onProgress: function () { steps++; },
    onDone: function (res) { finished = res; }
  });
  assert.strictEqual(steps, 1);
  assert.ok(finished);
  assert.strictEqual(finished.complete, true);
});

check('manual benchmark groups distinct saved datasets by size', function () {
  var dsA = { id: 'a', name: 'Case A', processes: [{ pid: 1, arrivalTime: 0, burstTime: 4, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 2, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 3, priority: 3 }, { pid: 4, arrivalTime: 4, burstTime: 1, priority: 2 }] };
  var dsB = { id: 'b', name: 'Case B', processes: [{ pid: 1, arrivalTime: 0, burstTime: 2, priority: 1 }, { pid: 2, arrivalTime: 0, burstTime: 5, priority: 3 }, { pid: 3, arrivalTime: 3, burstTime: 2, priority: 2 }, { pid: 4, arrivalTime: 5, burstTime: 4, priority: 1 }] };
  var dsC = { id: 'c', name: 'Case C', processes: [{ pid: 1, arrivalTime: 0, burstTime: 3, priority: 1 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 2 }, { pid: 3, arrivalTime: 2, burstTime: 3, priority: 3 }] };
  var r = benchmark.runManual([dsA, dsB, dsC], { quantum: 2, contextSwitchCost: 0 });
  assert.strictEqual(r.manual, true);
  assert.strictEqual(r.complete, true);
  assert.deepStrictEqual(r.plan.sizes, [3, 4]);
  assert.strictEqual(r.plan.datasets.length, 3);
  var c4 = r.cells.filter(function (c) { return c.algoId === 'fcfs' && c.size === 4; })[0];
  assert.strictEqual(c4.rounds, 2, 'two datasets of size 4');
  var c3 = r.cells.filter(function (c) { return c.algoId === 'fcfs' && c.size === 3; })[0];
  assert.strictEqual(c3.rounds, 1);
  assert.ok(/not independent random samples/.test(r.plan.note));
  // Identical datasets are skipped, not counted as independent samples.
  var dup = benchmark.runManual([dsA, Object.assign({}, dsA, { id: 'a2', name: 'Case A copy' }), dsB], { quantum: 2 });
  assert.strictEqual(dup.plan.datasets.length, 2);
  assert.strictEqual(dup.plan.duplicatesSkipped, 1);
  // One distinct dataset is a Single Experiment, not a benchmark.
  assert.throws(function () { benchmark.runManual([dsA], { quantum: 2 }); }, /at least two/);
  assert.throws(function () { benchmark.runManual([dsA, dsB], { quantum: 0 }); }, /quantum/);
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all benchmark checks passed');
