/* Educational preset tests — real state store, real engine, real comparison.
   Run: node test/presets.test.js */
(function () {
  'use strict';
  var path = require('path');
  var fails = 0;
  function ok(c, m) { if (!c) { fails++; console.error('  FAIL: ' + m); } }
  function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
  function near(a, b, m) { ok(Math.abs(a - b) < 1e-9, m + ' (got ' + a + ', want ' + b + ')'); }

  global.window = {};
  require(path.resolve(__dirname, '../src/state.js'));
  require(path.resolve(__dirname, '../src/scheduler.js'));
  require(path.resolve(__dirname, '../src/comparison.js'));
  var store = global.window.store;
  var scheduler = global.window.scheduler;
  var comparison = global.window.comparison;
  var passed = 0;
  function tick() { passed++; }

  /* Proposed fixtures — expected definitions, verbatim. */
  var EXPECTED = {
    'fcfs-vs-sjf': [
      { pid: 1, arrivalTime: 0, burstTime: 10, priority: 3 },
      { pid: 2, arrivalTime: 0, burstTime: 4, priority: 2 },
      { pid: 3, arrivalTime: 0, burstTime: 2, priority: 1 },
      { pid: 4, arrivalTime: 0, burstTime: 1, priority: 4 }
    ],
    'srtf-preemption': [
      { pid: 1, arrivalTime: 0, burstTime: 8, priority: 3 },
      { pid: 2, arrivalTime: 1, burstTime: 4, priority: 2 },
      { pid: 3, arrivalTime: 2, burstTime: 2, priority: 1 }
    ],
    'preemptive-priority': [
      { pid: 1, arrivalTime: 0, burstTime: 7, priority: 3 },
      { pid: 2, arrivalTime: 2, burstTime: 3, priority: 1 },
      { pid: 3, arrivalTime: 3, burstTime: 2, priority: 2 }
    ],
    'round-robin-quantum': [
      { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 },
      { pid: 2, arrivalTime: 0, burstTime: 4, priority: 1 },
      { pid: 3, arrivalTime: 0, burstTime: 2, priority: 3 }
    ],
    'idle-staggered': [
      { pid: 1, arrivalTime: 3, burstTime: 2, priority: 2 },
      { pid: 2, arrivalTime: 8, burstTime: 1, priority: 1 },
      { pid: 3, arrivalTime: 12, burstTime: 3, priority: 3 }
    ]
  };
  var IDS = Object.keys(EXPECTED);

  function preset(id) { return store.PRESETS.filter(function (p) { return p.id === id; })[0] || null; }
  function segments(result) {
    return result.segments.map(function (s) { return (s.pid == null ? s.type : 'P' + s.pid) + ':' + s.start + '-' + s.end; }).join(' ');
  }
  function run(id, algorithm, opts) {
    opts = opts || {};
    var loaded = store.loadPreset(id);
    ok(loaded.ok, 'loadPreset ' + id + ' succeeds');
    return scheduler.simulate({
      processes: store.getState().processes, algorithm: algorithm,
      quantum: opts.quantum, contextSwitchCost: 0,
      priorityMode: opts.priorityMode || 'non-preemptive'
    });
  }

  /* ---------- definitions ---------- */
  IDS.forEach(function (id) {
    var p = preset(id);
    ok(!!p, 'preset ' + id + ' exists');
    if (!p) return;
    ok(typeof p.name === 'string' && p.name.trim().length > 0, id + ': has a title'); tick();
    ok(typeof p.description === 'string' && p.description.trim().length > 20, id + ': has a one-sentence description'); tick();
    ok(typeof p.takeaway === 'string' && p.takeaway.trim().length > 20, id + ': states what to watch'); tick();
    eq(JSON.stringify(p.processes), JSON.stringify(EXPECTED[id]), id + ': processes match the documented fixture'); tick();
    eq(p.processes.length, EXPECTED[id].length, id + ': process count'); tick();
  });

  var ids = store.PRESETS.map(function (p) { return p.id; });
  eq(ids.length, new Set(ids).size, 'preset ids are unique'); tick();
  ok(store.PRESETS.length >= 9, 'existing presets are preserved alongside the five new ones'); tick();
  ok(!!preset('small-demo'), 'legacy small-demo preset still present'); tick();

  IDS.forEach(function (id) {
    var p = preset(id);
    if (!p) return;
    var seen = {};
    p.processes.forEach(function (x) {
      ok(!seen[x.pid], id + ': pid ' + x.pid + ' is unique'); tick();
      seen[x.pid] = 1;
      ok(Number.isInteger(x.pid) && x.pid > 0, id + ': pid is a positive integer'); tick();
      var v = store.validateProcess(x);
      ok(v.ok, id + ': process P' + x.pid + ' passes store validation ' + JSON.stringify(v.errors)); tick();
      ok(x.arrivalTime >= 0 && x.arrivalTime <= store.LIMITS.ARRIVAL_MAX, id + ': arrival in bounds'); tick();
      ok(x.burstTime >= 1 && x.burstTime <= store.LIMITS.BURST_MAX, id + ': burst in bounds'); tick();
      ok(x.priority >= 1 && x.priority <= store.LIMITS.PRIORITY_MAX, id + ': priority in bounds'); tick();
    });
  });

  ok(preset('round-robin-quantum').suggested.quantum === 2, 'RR preset suggests quantum 2'); tick();
  store.PRESETS.forEach(function (p) {
    if (!p.suggested) return;
    ok(scheduler.ALGORITHMS.indexOf(p.suggested.algorithm) >= 0, p.id + ': suggested algorithm is supported'); tick();
  });

  /* ---------- loading into the active dataset ---------- */
  IDS.forEach(function (id) {
    store.loadPreset(id);
    eq(JSON.stringify(store.getState().processes), JSON.stringify(EXPECTED[id]), id + ': loaded into the shared active dataset'); tick();
    eq(store.getCount(), EXPECTED[id].length, id + ': active count matches'); tick();
    eq(store.matchesPreset(id), true, id + ': active dataset matches the preset'); tick();
  });

  eq(store.loadPreset('nope').ok, false, 'unknown preset rejected'); tick();

  // A later add gets the next free pid, not a preset pid.
  store.loadPreset('idle-staggered');
  var add = store.addProcess();
  eq(add.ok, true, 'processes can be added after loading a preset'); tick();
  eq(add.pid, 4, 'next pid follows the loaded dataset'); tick();

  // Modified input is only replaced by an explicit load.
  store.loadPreset('fcfs-vs-sjf');
  eq(store.matchesPreset('fcfs-vs-sjf'), true, 'untouched preset matches'); tick();
  store.updateProcess(1, 'burstTime', 99);
  eq(store.matchesPreset('fcfs-vs-sjf'), false, 'edited dataset no longer matches the preset (UI must confirm)'); tick();
  eq(store.getProcess(1).burstTime, 99, 'edit is preserved until the user loads a preset'); tick();
  store.loadPreset('fcfs-vs-sjf');
  eq(store.getProcess(1).burstTime, 10, 'explicit load restores the preset'); tick();

  /* ---------- engine behavior, per preset ---------- */
  // A — FCFS vs SJF waiting time.
  var aFcfs = run('fcfs-vs-sjf', 'fcfs');
  var aSjf = run('fcfs-vs-sjf', 'sjf');
  eq(segments(aFcfs), 'P1:0-10 P2:10-14 P3:14-16 P4:16-17', 'A: FCFS runs in input order'); tick();
  eq(segments(aSjf), 'P4:0-1 P3:1-3 P2:3-7 P1:7-17', 'A: SJF runs shortest first'); tick();
  eq(aFcfs.makespan, 17, 'A: FCFS makespan'); tick();
  eq(aSjf.makespan, 17, 'A: SJF makespan'); tick();
  near(aFcfs.averages.waiting, 10, 'A: FCFS average waiting'); tick();
  near(aSjf.averages.waiting, 2.75, 'A: SJF average waiting'); tick();
  ok(aSjf.averages.waiting < aFcfs.averages.waiting, 'A: SJF reduces average waiting on this workload'); tick();

  // B — SRTF preemption.
  var bSrtf = run('srtf-preemption', 'srtf');
  eq(segments(bSrtf), 'P1:0-1 P2:1-2 P3:2-4 P2:4-7 P1:7-14', 'B: SRTF preempts P1 at t=1 and P2 at t=2'); tick();
  near(bSrtf.averages.waiting, 8 / 3, 'B: SRTF average waiting'); tick();
  near(bSrtf.averages.response, 0, 'B: SRTF average response'); tick();
  eq(bSrtf.makespan, 14, 'B: makespan'); tick();
  var bFcfs = run('srtf-preemption', 'fcfs');
  eq(segments(bFcfs), 'P1:0-8 P2:8-12 P3:12-14', 'B: FCFS never preempts'); tick();
  ok(bSrtf.averages.waiting < bFcfs.averages.waiting, 'B: preemption improves average waiting here'); tick();

  // C — preemptive priority.
  var cP = run('preemptive-priority', 'priority', { priorityMode: 'preemptive' });
  var cNp = run('preemptive-priority', 'priority', { priorityMode: 'non-preemptive' });
  eq(segments(cP), 'P1:0-2 P2:2-5 P3:5-7 P1:7-12', 'C: P2 preempts P1; P3 does not preempt P2'); tick();
  eq(segments(cNp), 'P1:0-7 P2:7-10 P3:10-12', 'C: non-preemptive priority waits for P1 to finish'); tick();
  near(cP.averages.waiting, 7 / 3, 'C: preemptive average waiting'); tick();
  near(cNp.averages.waiting, 4, 'C: non-preemptive average waiting'); tick();
  ok(cP.averages.waiting < cNp.averages.waiting, 'C: preemption helps the higher-priority arrivals'); tick();

  // D — Round Robin quantum 2.
  var dRr = run('round-robin-quantum', 'rr', { quantum: 2 });
  eq(segments(dRr), 'P1:0-2 P2:2-4 P3:4-6 P1:6-8 P2:8-10 P1:10-11', 'D: q=2 rotates P1,P2,P3 and requeues unfinished jobs'); tick();
  near(dRr.averages.waiting, 16 / 3, 'D: RR q=2 average waiting'); tick();
  eq(dRr.makespan, 11, 'D: makespan'); tick();
  eq(dRr.processes.filter(function (p) { return p.pid === 3; })[0].completionTime, 6, 'D: P3 completes first'); tick();
  eq(dRr.processes.filter(function (p) { return p.pid === 1; })[0].completionTime, 11, 'D: P1 needs three slices'); tick();
  var dRr5 = run('round-robin-quantum', 'rr', { quantum: 5 });
  eq(segments(dRr5), 'P1:0-5 P2:5-9 P3:9-11', 'D: a quantum of 5 degenerates to input order'); tick();
  near(dRr5.averages.waiting, 14 / 3, 'D: q=5 average waiting differs from q=2'); tick();
  ok(dRr.averages.waiting > dRr5.averages.waiting, 'D: smaller quantum costs more waiting on this workload'); tick();

  // E — idle gaps.
  var eFcfs = run('idle-staggered', 'fcfs');
  eq(segments(eFcfs), 'idle:0-3 P1:3-5 idle:5-8 P2:8-9 idle:9-12 P3:12-15', 'E: idle segments precede each arrival'); tick();
  eq(eFcfs.makespan, 15, 'E: makespan includes idle time'); tick();
  eq(eFcfs.idleTime, 9, 'E: idle time is 9'); tick();
  near(eFcfs.cpuUtilization, 0.4, 'E: CPU utilization 40%'); tick();
  near(eFcfs.throughput, 3 / 15, 'E: throughput over elapsed time'); tick();
  near(eFcfs.averages.waiting, 0, 'E: no process waits'); tick();

  /* ---------- Simulate + Compare integration ---------- */
  IDS.forEach(function (id) {
    store.loadPreset(id);
    var result = scheduler.simulate({
      processes: store.getState().processes, algorithm: 'fcfs',
      contextSwitchCost: 0, priorityMode: 'non-preemptive'
    });
    eq(result.completedCount, EXPECTED[id].length, id + ': Simulate schedules every loaded process'); tick();
    eq(result.executedTime, EXPECTED[id].reduce(function (n, p) { return n + p.burstTime; }, 0), id + ': executed time equals total burst'); tick();

    var cmp = comparison.runComparison(store.getState().processes, { quantum: 2, contextSwitchCost: 0 });
    eq(cmp.datasetSize, EXPECTED[id].length, id + ': Compare uses the active dataset'); tick();
    eq(cmp.validCount, 6, id + ': all six algorithms run on the preset'); tick();
    cmp.runs.forEach(function (r) {
      ok(r.ok, id + ': ' + r.label + ' failed — ' + r.error); tick();
      if (r.ok) eq(r.result.completedCount, EXPECTED[id].length, id + ': ' + r.label + ' completes all processes'); tick();
    });
  });

  // Preset E produces the same timeline under every algorithm.
  store.loadPreset('idle-staggered');
  var eAll = comparison.runComparison(store.getState().processes, { quantum: 2, contextSwitchCost: 0 });
  eAll.runs.forEach(function (r) {
    eq(segments(r.result), 'idle:0-3 P1:3-5 idle:5-8 P2:8-9 idle:9-12 P3:12-15', 'E: ' + r.label + ' leaves the CPU idle'); tick();
    near(r.summary.cpuUtilization, 0.4, 'E: ' + r.label + ' CPU utilization'); tick();
  });

  if (fails) { console.error('\n' + fails + ' check(s) failed'); process.exit(1); }
  console.log('\n' + passed + ' checks passed');
  console.log('all educational preset checks passed');
})();
