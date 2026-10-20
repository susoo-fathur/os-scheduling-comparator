/* Headless app smoke test — stubbed DOM, real modules, real engine output.
   Run: node test/app.smoke.js */
'use strict';
var assert = require('assert');
var path = require('path');

function makeEl(id) {
  var classes = {};
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    style: {}, attrs: {}, files: null,
    classList: {
      add: function (c) { classes[c] = 1; },
      remove: function (c) { delete classes[c]; },
      toggle: function (c, force) { var on = force === undefined ? !classes[c] : force; if (on) classes[c] = 1; else delete classes[c]; return on; },
      contains: function (c) { return !!classes[c]; }
    },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    addEventListener: function () {},
    focus: function () {},
    appendChild: function () {},
    remove: function () {},
    querySelector: function (sel) { return sel === '.toast__close' ? makeEl(sel) : null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; }
  };
}

var elements = {};
var docHandlers = {};
var winHandlers = {};

global.window = global;
global.document = {
  readyState: 'complete',
  title: '',
  body: makeEl('body'),
  getElementById: function (id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function (tag) { return makeEl(tag); },
  addEventListener: function (type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); }
};
global.location = { hash: '' };
global.history = { replaceState: function (a, b, h) { global.location.hash = h; } };
global.requestAnimationFrame = function (fn) { fn(); };
global.addEventListener = function (type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); };
global.setTimeout = global.setTimeout;

var scripts = ['components', 'state', 'scheduler', 'playback', 'comparison', 'explanations', 'benchmark', 'reports', 'persistence', 'viewkit', 'screen-overview', 'screen-simulate', 'screen-compare', 'screen-reports', 'app'];
scripts.forEach(function (s) { require(path.resolve(__dirname, '../src/' + s + '.js')); });

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
function nav(hash) {
  global.location.hash = hash;
  (winHandlers.hashchange || []).forEach(function (fn) { fn(); });
}
function content() { return document.getElementById('content').innerHTML; }

check('boots into Overview with an honest empty state', function () {
  assert.ok(content().indexOf('Overview') >= 0);
  assert.ok(content().indexOf('Active dataset') >= 0);
  assert.ok(content().indexOf('No comparison recorded yet') >= 0);
  assert.ok(content().indexOf('No completed experiment') >= 0);
});

check('Simulate renders a real schedule and metrics', function () {
  nav('#/simulate');
  var html = content();
  assert.ok(html.indexOf('Execution timeline') >= 0);
  assert.ok(html.indexOf('t = 0 / 16') >= 0, 'default preset makespan 16');
  assert.ok(html.indexOf('3.33') >= 0, 'FCFS average waiting 10/3');
  assert.ok(html.indexOf('data-scale=') >= 0, 'gantt rendered');
  assert.ok(html.indexOf('P1') >= 0);
  var sim = global.CSL.sim;
  assert.ok(sim.result && sim.result.makespan === 16);
  assert.ok(sim.playback);
});

check('Step advances exactly one simulation-time unit', function () {
  var pb = global.CSL.sim.playback;
  pb.stepForward();
  assert.strictEqual(pb.getState().currentTime, 1);
  pb.stepForward();
  assert.strictEqual(pb.getState().currentTime, 2);
  pb.reset();
  assert.strictEqual(pb.getState().currentTime, 0);
});

check('Compare renders six algorithms with computed values', function () {
  nav('#/compare');
  var html = content();
  ['FCFS', 'SJF', 'SRTF', 'Priority (NP)', 'Priority (P)', 'Round Robin'].forEach(function (l) {
    assert.ok(html.indexOf(l) >= 0, l + ' present');
  });
  assert.ok(html.indexOf('Best per metric') >= 0);
  assert.ok(html.indexOf('Ranking') >= 0);
  assert.ok(html.indexOf('3.33') >= 0);
  assert.ok(html.indexOf('100.0%') >= 0, 'CPU utilization shown');
});

check('Reports start empty for each category', function () {
  nav('#/reports');
  assert.ok(content().indexOf('No simulation reports') >= 0);
  assert.ok(content().indexOf('Export CSV') === -1);
});

check('recording a run makes it available in Reports', function () {
  var store = global.CSL.store, scheduler = global.CSL.scheduler, persist = global.CSL.persist;
  var res = scheduler.simulate({ processes: store.getState().processes, algorithm: 'fcfs' });
  var r = persist.addRecord({
    kind: 'simulation', name: 'Smoke run', dataset: store.getState().processes,
    config: { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: 2, contextSwitchCost: 0 }, result: res
  });
  assert.strictEqual(r.ok, true, r.error);
  nav('#/overview');
  assert.ok(content().indexOf('Smoke run') >= 0, 'overview shows last experiment');
  nav('#/reports');
  var html = content();
  assert.ok(html.indexOf('Smoke run') >= 0);
  assert.ok(html.indexOf('Export CSV') >= 0);
  assert.ok(html.indexOf('Per-process metrics') >= 0);
  assert.ok(html.indexOf('Metric breakdown') >= 0, 'recorded report shows metric formulas');
  assert.ok(html.indexOf('16') >= 0);
});

check('benchmark form parsing supports lists and ranges', function () {
  assert.deepStrictEqual(global.CSL.parseSizes('10, 50, 100'), [10, 50, 100]);
  assert.deepStrictEqual(global.CSL.parseSizes('10-100:20'), [10, 30, 50, 70, 90, 100]);
  assert.deepStrictEqual(global.CSL.parseSizes('5, 5, 3'), [3, 5]);
});

check('benchmark does not start on its own', function () {
  nav('#/compare');
  var bench = global.CSL.bench;
  bench.mode = 'benchmark';
  global.CSL.cmp.mode = 'benchmark';
  nav('#/compare');
  var html = content();
  assert.ok(html.indexOf('Run benchmark') >= 0);
  assert.ok(html.indexOf('Benchmark configuration') >= 0);
  assert.strictEqual(bench.running, false);
  assert.strictEqual(bench.result, null);
});

check('no screen renders undefined or NaN placeholders', function () {
  ['#/overview', '#/simulate', '#/compare', '#/reports'].forEach(function (h) {
    nav(h);
    var html = content();
    assert.ok(html.indexOf('undefined') === -1, h + ' has undefined');
    assert.ok(html.indexOf('NaN') === -1, h + ' has NaN');
    assert.ok(html.indexOf('[object Object]') === -1, h + ' has object coercion');
  });
});

check('benchmark results render without starting a run', function () {
  var b = global.window.benchmark;
  var run = b.runSync({
    sizes: [6, 12], rounds: 1, seed: 'ui-smoke',
    generator: { arrival: { min: 0, max: 10 }, burst: { min: 1, max: 5 }, priority: { min: 1, max: 3 } },
    quantum: 2, contextSwitchCost: 0
  });
  global.CSL.bench.result = run;
  global.CSL.bench.running = false;
  global.CSL.cmp.mode = 'benchmark';
  nav('#/compare');
  var html = content();
  assert.ok(html.indexOf('Benchmark result') >= 0);
  assert.ok(html.indexOf('Round seeds') >= 0);
  assert.ok(html.indexOf('Std dev') >= 0);
  assert.ok(html.indexOf('ui-smoke') >= 0);
  assert.ok(html.indexOf('<svg') >= 0, 'trend chart rendered');
  global.CSL.cmp.mode = 'single';
  global.CSL.bench.result = null;
});

check('comparison and benchmark records render in Reports', function () {
  var C = global.CSL;
  var procs = C.store.getState().processes;
  var run = C.comparison.runComparison(procs, { quantum: 2, contextSwitchCost: 0 });
  var c = C.persist.addRecord({
    kind: 'comparison', name: 'Smoke comparison', dataset: procs,
    config: { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: 2, contextSwitchCost: 0 },
    comparison: { runs: run.runs.map(function (r) { return { id: r.id, label: r.label, color: r.color, ok: r.ok, summary: r.summary, error: r.error || null }; }), validCount: run.validCount, datasetSize: run.datasetSize }
  });
  assert.strictEqual(c.ok, true, c.error);
  var bench = global.window.benchmark.runSync({ sizes: [6], rounds: 1, seed: 'rep', generator: { arrival: { min: 0, max: 5 }, burst: { min: 1, max: 3 }, priority: { min: 1, max: 2 } }, quantum: 2, contextSwitchCost: 0 });
  var br = C.persist.addRecord({ kind: 'benchmark', name: 'Smoke benchmark', config: { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: 2, contextSwitchCost: 0 }, benchmark: bench });
  assert.strictEqual(br.ok, true, br.error);

  C.report.kind = 'comparison'; C.report.selectedId = null; nav('#/reports');
  assert.ok(content().indexOf('Smoke comparison') >= 0);
  assert.ok(content().indexOf('all six') >= 0);

  C.report.kind = 'benchmark'; C.report.selectedId = null; nav('#/reports');
  assert.ok(content().indexOf('Smoke benchmark') >= 0);
  assert.ok(content().indexOf('Round seeds') >= 0);
  assert.ok(content().indexOf('Average waiting time vs dataset size') >= 0);
});

check('manual benchmark mode lists saved datasets', function () {
  var C = global.CSL;
  var procs = C.store.getState().processes;
  var alt = procs.map(function (p) { return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime + 1, priority: p.priority }; });
  assert.strictEqual(C.persist.saveDataset('Case A', procs).ok, true);
  assert.strictEqual(C.persist.saveDataset('Case B', alt).ok, true);
  C.bench.form.source = 'manual';
  C.cmp.mode = 'benchmark';
  nav('#/compare');
  var html = content();
  assert.ok(html.indexOf('Run manual benchmark') >= 0);
  assert.ok(html.indexOf('data-bench-ds=') >= 0);
  assert.ok(html.indexOf('Case A') >= 0 && html.indexOf('Case B') >= 0);
  C.bench.form.source = 'random';
  C.cmp.mode = 'single';
});

check('educational presets render previews before loading', function () {
  nav('#/simulate');
  var html = content();
  ['fcfs-vs-sjf', 'srtf-preemption', 'preemptive-priority', 'round-robin-quantum', 'idle-staggered'].forEach(function (id) {
    assert.ok(html.indexOf('data-preset-card="' + id + '"') >= 0, id + ' preview card present');
  });
  assert.ok(html.indexOf('What to watch:') >= 0, 'learning objective shown');
  assert.ok(html.indexOf('Suggested starting point:') >= 0, 'suggested algorithm shown without restricting others');
  assert.ok(html.indexOf('arr 12 · burst 3 · prio 3') >= 0, 'preview lists process values');
  assert.ok(html.indexOf('data-action="load-preset"') >= 0, 'load button lives inside the preview');
});

check('loading a preset drives Simulate and Compare, without starting playback', function () {
  var C = global.CSL;
  assert.strictEqual(C.store.loadPreset('idle-staggered').ok, true);
  nav('#/simulate');
  var html = content();
  assert.ok(html.indexOf('t = 0 / 15') >= 0, 'Simulate uses the preset makespan');
  assert.ok(html.indexOf('40.0%') >= 0, 'idle preset CPU utilization');
  assert.strictEqual(C.sim.playback.getState().isPlaying, false, 'playback stays paused');
  assert.strictEqual(C.bench.running, false, 'benchmark stays idle');

  nav('#/compare');
  var cmp = content();
  assert.ok(cmp.indexOf('3 processes') >= 0, 'Compare header uses the active preset');
  assert.ok(cmp.indexOf('40.0%') >= 0, 'Compare shows the same utilization');
  C.store.loadPreset('small-demo');
});

check('Simulate explains the actual dispatch and metric formulas', function () {
  var C = global.CSL;
  nav('#/simulate');
  var html = content();
  assert.ok(html.indexOf('Why this decision') >= 0, 'explanation section present');
  assert.ok(html.indexOf('earliest arrival time') >= 0, 'FCFS dispatch explained from the trace');
  assert.ok(html.indexOf('id="sim-explain-body"') >= 0, 'explanation body is patchable');
  assert.ok(html.indexOf('Metric breakdown') >= 0, 'metric breakdown panel present');
  assert.ok(html.indexOf('data-metric-pid="1"') >= 0, 'per-process breakdown rows');
  assert.ok(html.indexOf('not started') >= 0, 'pending processes are explicit');
  assert.ok(html.indexOf('Turnaround = completion') >= 0, 'formulas stated');

  C.sim.playback.seek(5);
  var body = document.getElementById('sim-explain-body').innerHTML;
  assert.ok(body.indexOf('P2 was selected') >= 0, 'explanation follows the playback position');
  var metrics = document.getElementById('sim-metrics').innerHTML;
  assert.ok(metrics.indexOf('5 - 0 = 5') >= 0, 'metric breakdown follows completion state');
  C.sim.playback.seek(0);
});

check('Compare explains metric winners with real numbers and ties', function () {
  nav('#/compare');
  var html = content();
  assert.ok(html.indexOf('Why these numbers') >= 0, 'comparison explanation panel present');
  assert.ok(html.indexOf('tied for the lowest Average Waiting Time') >= 0, 'AWT tie explained');
  assert.ok(html.indexOf('this dataset and configuration') >= 0, 'conclusion is scoped');
  assert.ok(html.indexOf('General rule:') >= 0, 'general rules are labelled separately');
  assert.ok(html.indexOf('Metric breakdown') >= 0, 'detail metric breakdown present');
  assert.ok(html.indexOf('5 - 0 = 5') >= 0, 'actual turnaround calculation shown');
});

check('preset explanations follow real decisions and are not persisted', function () {
  var C = global.CSL;
  assert.strictEqual(C.store.loadPreset('srtf-preemption').ok, true);
  C.runConfig.algorithm = 'srtf';
  nav('#/simulate');
  C.sim.playback.seek(2);
  var body = document.getElementById('sim-explain-body').innerHTML;
  assert.ok(body.indexOf('P3 preempted P2') >= 0, 'preset preemption explained');
  assert.ok(body.indexOf('Remaining Time (2)') >= 0, 'preemption numbers come from the trace');
  C.sim.playback.seek(C.sim.result.makespan);
  var rec = C.persist.list('simulation')[0];
  assert.ok(rec && rec.result, 'simulation recorded');
  assert.strictEqual(rec.result.decisions, undefined, 'decision trace is not persisted');
  C.runConfig.algorithm = 'fcfs';
  C.store.loadPreset('small-demo');
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all app smoke checks passed');
