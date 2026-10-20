/* Dataset state tests — pure logic, no DOM, no framework.
   Run: node test/state.test.js */
(function () {
  'use strict';
  var fails = 0;
  function ok(c, m) { if (!c) { fails++; console.error('  FAIL: ' + m); } }
  function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

  global.window = {};
  require(require('path').resolve(__dirname, '../src/state.js'));
  var s = global.window.store;
  var passed = 0;
  function tick() { passed++; }

  function fresh() { s.resetDefault(); }
  function pids() { return s.getState().processes.map(function (p) { return p.pid; }); }

  // ---- add / edit / delete ----
  fresh();
  var startCount = s.getCount();
  var add = s.addProcess();
  ok(add.ok, 'addProcess succeeds under the limit'); tick();
  eq(s.getCount(), startCount + 1, 'addProcess increments count'); tick();
  ok(add.pid > 0, 'addProcess returns a positive pid'); tick();

  var target = s.getState().processes[0];
  var upd = s.updateProcess(target.pid, 'burstTime', 7);
  ok(upd.ok, 'updateProcess with a valid burst commits'); tick();
  eq(s.getProcess(target.pid).burstTime, 7, 'edited burst is stored'); tick();

  var before = s.getCount();
  s.removeProcess(target.pid);
  eq(s.getCount(), before - 1, 'removeProcess decrements count'); tick();
  eq(s.getProcess(target.pid), null, 'removed process is gone'); tick();

  // ---- PID uniqueness & stability ----
  fresh();
  var p0 = pids().slice();
  var removedPid = p0[1];
  s.removeProcess(removedPid);
  var after = pids();
  ok(after.indexOf(removedPid) === -1, 'removed pid no longer present'); tick();
  ok(after.length === p0.length - 1, 'only the one pid was removed'); tick();
  for (var i = 0; i < after.length; i++) { ok(p0.indexOf(after[i]) !== -1, 'remaining pid stable'); tick(); }
  var newAdd = s.addProcess();
  ok(newAdd.pid !== removedPid, 'new pid does not reuse the removed pid (monotonic)'); tick();

  // ---- arrival 0 accepted ----
  fresh();
  eq(s.validateField('arrivalTime', '0').ok, true, 'arrival 0 is accepted'); tick();
  var z = s.addProcess();
  eq(s.updateProcess(z.pid, 'arrivalTime', '0').ok, true, 'committing arrival 0 succeeds'); tick();

  // ---- field validation ----
  eq(s.validateField('burstTime', '0').ok, false, 'burst 0 is rejected'); tick();
  eq(s.updateProcess(z.pid, 'burstTime', '0').ok, false, 'committing burst 0 fails'); tick();
  ok(s.getProcess(z.pid).burstTime !== 0, 'invalid burst is not stored'); tick();
  eq(s.validateField('priority', '0').ok, false, 'priority 0 is rejected (lower number = higher priority, min 1)'); tick();
  eq(s.validateField('priority', '1').ok, true, 'priority 1 is accepted'); tick();
  eq(s.validateField('arrivalTime', '').ok, false, 'empty rejected'); tick();
  eq(s.validateField('arrivalTime', '-1').ok, false, 'negative rejected'); tick();
  eq(s.validateField('burstTime', '2.5').ok, false, 'fraction rejected'); tick();
  eq(s.validateField('priority', '-0').ok, false, 'signed zero rejected'); tick();
  eq(s.validateField('arrivalTime', '1e3').ok, false, 'exponent rejected'); tick();
  eq(s.validateField('arrivalTime', 'abc').ok, false, 'text rejected'); tick();
  eq(s.validateField('burstTime', '10001').ok, false, 'burst over max rejected'); tick();
  eq(s.validateField('priority', '100').ok, false, 'priority over max rejected'); tick();
  eq(s.validateField('arrivalTime', '10001').ok, false, 'arrival over max rejected'); tick();

  // ---- process count limit ----
  var max = s.LIMITS.MAX_PROCESSES;
  var big = [];
  for (var k = 0; k < max; k++) big.push({ pid: k + 1, arrivalTime: k % 20, burstTime: 1 + (k % 10), priority: 1 + (k % 5) });
  eq(s.replaceAll(big).ok, true, 'replaceAll accepts the maximum dataset size'); tick();
  eq(s.getCount(), max, 'count reaches the maximum'); tick();
  eq(s.addProcess().ok, false, 'add over the limit is rejected'); tick();
  eq(s.replaceAll(big.concat([{ pid: max + 1, arrivalTime: 0, burstTime: 1, priority: 1 }])).ok, false, 'dataset above the limit rejected'); tick();

  // ---- generator ----
  var cfg = { count: 6, arrival: { min: 0, max: 20 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 }, seed: 'abc' };
  eq(s.validateGeneratorConfig(cfg).ok, true, 'valid generator config passes'); tick();
  var gen = s.generateDataset(cfg);
  eq(gen.processes.length, 6, 'generator produces the requested count'); tick();
  var gpids = gen.processes.map(function (p) { return p.pid; });
  ok(gpids.length === new Set(gpids).size, 'generator pids are unique'); tick();
  ok(gen.processes.every(function (p) { return p.burstTime >= 1 && p.priority >= 1; }), 'generator respects positive burst/priority'); tick();
  ok(gen.processes.every(function (p) { return Number.isInteger(p.arrivalTime) && Number.isInteger(p.burstTime) && Number.isInteger(p.priority); }), 'generator values are integers'); tick();
  ok(gen.processes.every(function (p) { return p.arrivalTime >= 0 && p.arrivalTime <= 20 && p.burstTime <= 10 && p.priority <= 5; }), 'generator values within configured bounds'); tick();

  eq(s.validateGeneratorConfig({ count: 0, arrival: { min: 0, max: 8 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 } }).ok, false, 'count 0 rejected'); tick();
  eq(s.validateGeneratorConfig({ count: 3, arrival: { min: 5, max: 2 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 } }).ok, false, 'inverted arrival range rejected'); tick();
  eq(s.validateGeneratorConfig({ count: 3, arrival: { min: 0, max: 8 }, burst: { min: 0, max: 10 }, priority: { min: 1, max: 5 } }).ok, false, 'burst min 0 rejected'); tick();
  eq(s.validateGeneratorConfig({ count: 2001, arrival: { min: 0, max: 8 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 } }).ok, false, 'count over the limit rejected'); tick();

  var g1 = s.generateDataset(cfg);
  var g2 = s.generateDataset(cfg);
  eq(JSON.stringify(g1.processes), JSON.stringify(g2.processes), 'same seed yields identical datasets'); tick();
  eq(g1.seed, g2.seed, 'same seed value reported'); tick();
  var g3 = s.generateDataset(Object.assign({}, cfg, { seed: 'abd' }));
  ok(JSON.stringify(g1.processes) !== JSON.stringify(g3.processes), 'different seed yields a different dataset'); tick();
  // Prefix stability: a smaller count is a prefix of a larger count for the same seed.
  var gBig = s.generateDataset(Object.assign({}, cfg, { count: 20 }));
  var gSmall = s.generateDataset(Object.assign({}, cfg, { count: 7 }));
  eq(JSON.stringify(gSmall.processes), JSON.stringify(gBig.processes.slice(0, 7)), 'smaller count is a prefix of a larger one (same seed)'); tick();

  // ---- presets ----
  fresh();
  var small = s.PRESETS.filter(function (p) { return p.id === 'small-demo'; })[0];
  eq(small.processes.length, 3, 'small-demo preset has 3 processes'); tick();
  eq(s.loadPreset('small-demo').ok, true, 'loadPreset small-demo succeeds'); tick();
  eq(s.getCount(), 3, 'preset loaded into store'); tick();
  eq(s.getState().processes[0].burstTime, 5, 'preset first process burst is 5'); tick();
  eq(s.loadPreset('nope').ok, false, 'unknown preset rejected'); tick();
  ok(s.PRESETS.every(function (p) { return p.processes.every(function (x) { return x.priority >= 1; }); }), 'all preset priorities are positive'); tick();

  // ---- reset / replace ----
  s.clearAll();
  eq(s.getCount(), 0, 'clearAll empties the dataset'); tick();
  eq(s.resetDefault().ok, true, 'resetDefault succeeds'); tick();
  ok(s.getCount() > 0, 'resetDefault restores processes'); tick();
  s.clearAll(); s.loadPreset('small-demo');
  var beforeReplace = s.getCount();
  eq(s.replaceAll([{ pid: 1, arrivalTime: 0, burstTime: 0, priority: 1 }]).ok, false, 'replaceAll rejects invalid dataset'); tick();
  eq(s.getCount(), beforeReplace, 'replaceAll does not mutate on invalid input'); tick();
  eq(s.replaceAll([{ pid: 1, arrivalTime: 0, burstTime: 1, priority: 1 }, { pid: 1, arrivalTime: 1, burstTime: 1, priority: 1 }]).ok, false, 'replaceAll rejects duplicate pid'); tick();

  // ---- shared state ----
  ok(s.getState() === s.getState(), 'getState returns the shared state instance'); tick();
  fresh();
  var snap = pids();
  s.addProcess();
  ok(s.getState().processes.length === snap.length + 1, 'mutation visible through the same state reference'); tick();

  // ---- empty dataset ----
  s.clearAll();
  eq(s.getState().processes.length, 0, 'empty dataset has no processes'); tick();
  ok(s.getProcess(1) === null, 'getProcess on empty returns null'); tick();
  ok(typeof s.colorForIndex(0) === 'string', 'colorForIndex returns a color string'); tick();

  if (fails) { console.error('\n' + fails + ' check(s) failed'); process.exit(1); }
  console.log('\n' + passed + ' checks passed');
  console.log('all dataset state checks passed');
})();
