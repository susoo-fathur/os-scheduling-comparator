/* Persistence tests — fake storage, no DOM, no browser.
   Run: node test/persistence.test.js */
'use strict';
var assert = require('assert');
var path = require('path');

global.window = {};
require(path.resolve(__dirname, '../src/scheduler.js'));
require(path.resolve(__dirname, '../src/persistence.js'));
var scheduler = global.window.scheduler;
var persistence = global.window.persistence;

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

function fakeStorage(initial) {
  var map = Object.assign({}, initial || {});
  var s = {
    failWrites: false,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { if (s.failWrites) throw new Error('QuotaExceededError'); map[k] = String(v); },
    removeItem: function (k) { delete map[k]; },
    dump: function () { return map; },
    seed: function (k, v) { map[k] = v; }
  };
  return s;
}

var PROC = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 8, priority: 3 }];
var CFG = { algorithm: 'fcfs', priorityMode: 'non-preemptive', quantum: 2, contextSwitchCost: 0 };
function simRecord(name) {
  return {
    kind: 'simulation', name: name || 'Run',
    dataset: PROC, config: CFG,
    result: scheduler.simulate({ processes: PROC, algorithm: 'fcfs' })
  };
}

check('adds and reads a simulation record', function () {
  var p = persistence.createPersistence(fakeStorage());
  var r = p.addRecord(simRecord('First run'));
  assert.strictEqual(r.ok, true);
  assert.ok(r.id);
  assert.strictEqual(r.persisted, true);
  var all = p.list();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].name, 'First run');
  assert.strictEqual(all[0].schemaVersion, 2);
  assert.strictEqual(all[0].result.makespan, 16);
  assert.ok(p.get(r.id));
});

check('record snapshot is independent of the live dataset', function () {
  var p = persistence.createPersistence(fakeStorage());
  var live = PROC.map(function (x) { return Object.assign({}, x); });
  var r = p.addRecord({ kind: 'simulation', name: 'Snapshot', dataset: live, config: CFG, result: scheduler.simulate({ processes: live, algorithm: 'fcfs' }) });
  live[0].burstTime = 99;
  var rec = p.get(r.id);
  assert.strictEqual(rec.dataset[0].burstTime, 5);
  rec.dataset[0].burstTime = 42;
  assert.strictEqual(p.get(r.id).dataset[0].burstTime, 5, 'get returns a clone');
});

check('rejects invalid records without mutating the collection', function () {
  var p = persistence.createPersistence(fakeStorage());
  p.addRecord(simRecord('ok'));
  var bad = [
    Object.assign(simRecord('bad kind'), { kind: 'nope' }),
    Object.assign(simRecord(''), { name: '   ' }),
    Object.assign(simRecord('bad dataset'), { dataset: [{ pid: 1, arrivalTime: -1, burstTime: 2, priority: 1 }] }),
    Object.assign(simRecord('bad config'), { config: { algorithm: 'nope' } }),
    Object.assign(simRecord('bad result'), { result: { processes: [], segments: [] } }),
    Object.assign(simRecord('dup pid'), { dataset: [{ pid: 1, arrivalTime: 0, burstTime: 1, priority: 1 }, { pid: 1, arrivalTime: 1, burstTime: 1, priority: 1 }] })
  ];
  bad.forEach(function (b) { assert.strictEqual(p.addRecord(b).ok, false, 'rejected: ' + b.name); });
  assert.strictEqual(p.list().length, 1);
});

check('supports comparison and benchmark records', function () {
  var p = persistence.createPersistence(fakeStorage());
  var c = p.addRecord({ kind: 'comparison', name: 'Compare', dataset: PROC, config: CFG, comparison: { runs: [{ id: 'fcfs', label: 'FCFS', ok: true, summary: { avgWaiting: 1 } }], validCount: 1 } });
  assert.strictEqual(c.ok, true);
  var b = p.addRecord({ kind: 'benchmark', name: 'Bench', config: CFG, benchmark: { config: {}, plan: { sizes: [10], rounds: 1, seeds: [1] }, cells: [], complete: true } });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(p.list('comparison').length, 1);
  assert.strictEqual(p.list('benchmark').length, 1);
  assert.strictEqual(p.list('simulation').length, 0);
  assert.strictEqual(p.addRecord({ kind: 'benchmark', name: 'Bad', config: CFG, benchmark: { config: {} } }).ok, false);
});

check('enforces the history limit', function () {
  var p = persistence.createPersistence(fakeStorage());
  for (var i = 0; i < persistence.LIMITS.MAX_RECORDS; i++) assert.strictEqual(p.addRecord(simRecord('r' + i)).ok, true);
  var over = p.addRecord(simRecord('over'));
  assert.strictEqual(over.ok, false);
  assert.ok(/limit/i.test(over.error));
});

check('survives a quota write failure without losing in-memory data', function () {
  var st = fakeStorage();
  var p = persistence.createPersistence(st);
  st.failWrites = true;
  var r = p.addRecord(simRecord('quota'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.persisted, false);
  assert.ok(/write|storage|quota/i.test(p.lastError));
  assert.strictEqual(p.list().length, 1);
});

check('never auto-wipes corrupt storage', function () {
  var st = fakeStorage({ 'csl.experiments.v2': '{not json' });
  var p = persistence.createPersistence(st);
  assert.strictEqual(p.list().length, 0);
  assert.ok(/corrupt/i.test(p.lastError));
  assert.strictEqual(st.dump()['csl.experiments.v2'], '{not json', 'raw value untouched');
});

check('works in memory when storage is unavailable', function () {
  var p = persistence.createPersistence(null);
  assert.strictEqual(p.storageAvailable(), false);
  assert.ok(/unavailable/i.test(p.lastError));
  assert.strictEqual(p.addRecord(simRecord('mem')).ok, true);
  assert.strictEqual(p.list().length, 1);
  assert.strictEqual(p.addRecord(simRecord('mem2')).persisted, false);
});

check('persists across instances (reload simulation)', function () {
  var st = fakeStorage();
  var p1 = persistence.createPersistence(st);
  var id = p1.addRecord(simRecord('persisted')).id;
  p1.saveDataset('My dataset', PROC);
  p1.saveActive({ dataset: PROC, config: CFG, meta: { source: 'generator', seed: 'x' } });
  var p2 = persistence.createPersistence(st);
  assert.strictEqual(p2.list().length, 1);
  assert.strictEqual(p2.get(id).name, 'persisted');
  assert.strictEqual(p2.listDatasets().length, 1);
  assert.strictEqual(p2.loadActive().dataset.length, 3);
  assert.strictEqual(p2.loadActive().meta.seed, 'x');
});

check('migrates schema v1 records as outdated simulations', function () {
  var st = fakeStorage({
    'csl.experiments.v1': JSON.stringify({ schemaVersion: 1, experiments: [
      { id: 'exp-1', name: 'Legacy', createdAt: 1700000000000, updatedAt: 1700000000000, schemaVersion: 1, dataset: PROC, config: CFG, summary: {} }
    ] })
  });
  var p = persistence.createPersistence(st);
  var all = p.list();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].kind, 'simulation');
  assert.strictEqual(all[0].result, null);
  assert.ok(/legacy|migrated/i.test(p.lastError));
});

check('saved datasets: save, list, get, delete', function () {
  var p = persistence.createPersistence(fakeStorage());
  var r = p.saveDataset('  Group A  ', PROC);
  assert.strictEqual(r.ok, true);
  var all = p.listDatasets();
  assert.strictEqual(all[0].name, 'Group A');
  assert.strictEqual(p.getDataset(all[0].id).processes.length, 3);
  assert.strictEqual(p.saveDataset('', PROC).ok, false);
  assert.strictEqual(p.saveDataset('bad', [{ pid: 1, arrivalTime: 0, burstTime: 0, priority: 1 }]).ok, false);
  assert.strictEqual(p.deleteDataset(all[0].id).ok, true);
  assert.strictEqual(p.listDatasets().length, 0);
});

check('active state round-trips and validates', function () {
  var p = persistence.createPersistence(fakeStorage());
  assert.strictEqual(p.loadActive(), null);
  assert.strictEqual(p.saveActive({ dataset: [], config: CFG }).ok, true, 'empty active dataset allowed');
  assert.strictEqual(p.loadActive().dataset.length, 0);
  assert.strictEqual(p.saveActive({ dataset: [{ pid: 1, arrivalTime: 0, burstTime: 0, priority: 1 }], config: CFG }).ok, false);
  assert.strictEqual(p.saveActive({ dataset: PROC, config: { algorithm: 'rr', quantum: 0 } }).ok, false);
});

check('remove and clearAll', function () {
  var st = fakeStorage();
  var p = persistence.createPersistence(st);
  var a = p.addRecord(simRecord('a')).id;
  p.addRecord(simRecord('b'));
  p.saveDataset('ds', PROC);
  assert.strictEqual(p.remove(a).ok, true);
  assert.strictEqual(p.list().length, 1);
  assert.strictEqual(p.remove('missing').ok, false);
  var cleared = p.clearAll();
  assert.strictEqual(cleared.ok, true);
  assert.strictEqual(p.list().length, 0);
  assert.strictEqual(p.listDatasets().length, 0);
  assert.strictEqual(st.dump()['csl.experiments.v2'], undefined);
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all persistence checks passed');
