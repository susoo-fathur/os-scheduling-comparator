/* Report/CSV tests — pure logic, no DOM.
   Run: node test/reports.test.js */
'use strict';
var assert = require('assert');
var path = require('path');

global.window = {};
['scheduler', 'state', 'comparison', 'reports'].forEach(function (m) {
  require(path.resolve(__dirname, '../src/' + m + '.js'));
});
var reports = global.window.reports;
var comparison = global.window.comparison;
var scheduler = global.window.scheduler;

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

var PROC = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 8, priority: 3 }];
var CFG = { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: 2, contextSwitchCost: 0 };

check('CSV quoting handles commas, quotes and newlines', function () {
  var csv = reports.toCSV([['a,b', 'say "hi"', 'line\nbreak'], [1, 2, 3]]);
  assert.strictEqual(csv, '"a,b","say ""hi""","line\nbreak"\r\n1,2,3\r\n');
});

check('simulation CSV carries real values and per-process rows', function () {
  var rec = { kind: 'simulation', name: 'Demo run', createdAt: 1700000000000, dataset: PROC, config: CFG,
    result: scheduler.simulate({ processes: PROC, algorithm: 'fcfs' }) };
  var csv = reports.simulationCSV(rec);
  assert.ok(csv.indexOf('OS Scheduling Comparator — Simulation report') === 0);
  assert.ok(csv.indexOf('Demo run') >= 0);
  assert.ok(csv.indexOf('PID,Arrival,Burst,Priority,First start,Completion,Turnaround,Waiting,Response') >= 0);
  assert.ok(csv.indexOf('1,0,5,2,0,5,5,0,0') >= 0);
  assert.ok(csv.indexOf('Makespan (tu),16') >= 0);
  assert.ok(csv.indexOf('Average waiting (tu),3.333') >= 0);
  assert.ok(csv.indexOf('CPU utilization (%)') >= 0);
});

check('simulation CSV marks a missing result instead of inventing one', function () {
  var rec = { kind: 'simulation', name: 'Legacy', createdAt: 1700000000000, dataset: PROC, config: CFG, result: null };
  var csv = reports.simulationCSV(rec);
  assert.ok(/unavailable/i.test(csv));
  assert.ok(csv.indexOf('PID,Arrival') === -1);
});

check('comparison CSV includes all six algorithms and errors', function () {
  var cmp = comparison.runComparison(PROC, { quantum: 2, contextSwitchCost: 0 });
  var rec = { kind: 'comparison', name: 'Compare', createdAt: 1700000000000, dataset: PROC, config: CFG, comparison: cmp };
  var csv = reports.comparisonCSV(rec);
  assert.ok(csv.indexOf('Algorithm,Status') >= 0);
  ['FCFS', 'SJF', 'SRTF', 'Priority (NP)', 'Priority (P)', 'Round Robin'].forEach(function (l) {
    assert.ok(csv.indexOf(l) >= 0, l + ' present');
  });
  assert.ok(csv.indexOf('ok') >= 0);
  // Failed runs are reported with the error and blank metric cells.
  var failed = { kind: 'comparison', name: 'C', createdAt: 1, dataset: PROC, config: CFG,
    comparison: { runs: [{ id: 'x', label: 'Broken', ok: false, error: 'boom' }], validCount: 0 } };
  var csv2 = reports.comparisonCSV(failed);
  assert.ok(csv2.indexOf('failed: boom') >= 0);
  assert.ok(csv2.indexOf('Broken,failed: boom,,,,,,,') >= 0);
});

check('benchmark CSV includes config, seeds and statistics', function () {
  var stats = { n: 2, mean: 3.5, min: 2, max: 5, stddev: 2.121 };
  var cells = [{
    algoId: 'fcfs', label: 'FCFS', size: 10, rounds: 2, failures: 0,
    metrics: { avgWaiting: stats, avgTurnaround: stats, avgResponse: stats, cpuUtilization: stats, throughput: stats, makespan: stats, contextSwitches: stats }
  }];
  var rec = { kind: 'benchmark', name: 'Bench', createdAt: 1700000000000, config: CFG,
    benchmark: { complete: true, cancelled: false, config: { rounds: 2, seed: 'abc', quantum: 2, contextSwitchCost: 0, generator: { arrival: { min: 0, max: 20 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 } } }, plan: { sizes: [10], rounds: 2, seeds: [111, 222] }, cells: cells } };
  var csv = reports.benchmarkCSV(rec);
  assert.ok(csv.indexOf('Rounds per size,2') >= 0);
  assert.ok(csv.indexOf('Base seed,abc') >= 0);
  assert.ok(csv.indexOf('Round seeds,111 222') >= 0);
  assert.ok(csv.indexOf('FCFS,10,2,0') >= 0);
  assert.ok(csv.indexOf('3.5') >= 0);
  assert.ok(csv.indexOf('2.121') >= 0);
});

check('cancelled benchmark is labelled partial', function () {
  var rec = { kind: 'benchmark', name: 'B', createdAt: 1, config: CFG,
    benchmark: { complete: false, cancelled: true, config: { rounds: 10, seed: 'x', quantum: 2, contextSwitchCost: 0, generator: { arrival: { min: 0, max: 1 }, burst: { min: 1, max: 1 }, priority: { min: 1, max: 1 } } }, plan: { sizes: [], rounds: 10, seeds: [] }, cells: [] } };
  assert.ok(/cancelled \(partial\)/.test(reports.benchmarkCSV(rec)));
});

check('csvFor dispatches by kind and filename is sanitized', function () {
  assert.strictEqual(reports.csvFor({ kind: 'benchmark', name: 'x', createdAt: 1, config: CFG, benchmark: { config: {}, plan: {}, cells: [] } }).indexOf('Benchmark report') >= 0, true);
  assert.strictEqual(reports.filenameFor({ kind: 'simulation', name: 'My Run / 01!' }), 'my-run-01-simulation.csv');
  assert.strictEqual(reports.filenameFor({ kind: 'comparison', name: '' }), 'report-comparison.csv');
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all report checks passed');
