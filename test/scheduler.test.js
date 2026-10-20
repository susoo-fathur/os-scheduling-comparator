/* Engine tests — hand-calculated fixtures + structural invariants.
   Run: node test/scheduler.test.js */
'use strict';
var assert = require('assert');
var path = require('path');
global.window = {};
require(path.resolve(__dirname, '../src/scheduler.js'));
var scheduler = global.window.scheduler;

var checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); checks++; }
function close(actual, expected, msg) { assert.ok(Math.abs(actual - expected) < 1e-9, msg + ' (got ' + actual + ', want ' + expected + ')'); checks++; }

function P(pid, arrivalTime, burstTime, priority) { return { pid: pid, arrivalTime: arrivalTime, burstTime: burstTime, priority: priority }; }
function sim(procs, cfg) {
  return scheduler.simulate(Object.assign({ processes: procs }, cfg));
}
function timeline(r) { return r.segments.map(function (s) { return (s.pid === null ? s.type : 'P' + s.pid) + ':' + s.start + '-' + s.end; }); }
function byPid(r, pid) { return r.processes.filter(function (p) { return p.pid === pid; })[0]; }
function assertInvariants(r, procs, label) {
  ok(r.segments.length > 0, label + ': has segments');
  eq(r.segments[0].start, 0, label + ': starts at 0');
  for (var i = 1; i < r.segments.length; i++) {
    eq(r.segments[i].start, r.segments[i - 1].end, label + ': contiguous at ' + i);
    ok(r.segments[i].end > r.segments[i].start, label + ': positive length at ' + i);
  }
  eq(r.makespan, r.segments[r.segments.length - 1].end, label + ': makespan = last end');
  eq(r.processes.length, procs.length, label + ': every process reported');
  var burstSum = 0, executed = 0;
  procs.forEach(function (p) {
    burstSum += p.burstTime;
    var ran = 0;
    r.segments.forEach(function (s) { if (s.type === 'process' && s.pid === p.pid) ran += s.end - s.start; });
    eq(ran, p.burstTime, label + ': P' + p.pid + ' executed exactly its burst');
    var m = byPid(r, p.pid);
    eq(m.turnaroundTime, m.completionTime - p.arrivalTime, label + ': TAT formula P' + p.pid);
    eq(m.waitingTime, m.turnaroundTime - p.burstTime, label + ': WT formula P' + p.pid);
    eq(m.responseTime, m.startTime - p.arrivalTime, label + ': RT formula P' + p.pid);
    ok(m.startTime >= p.arrivalTime, label + ': start >= arrival P' + p.pid);
  });
  r.segments.forEach(function (s) { if (s.type === 'process') executed += s.end - s.start; });
  eq(executed, burstSum, label + ': executed total = burst total');
  eq(r.executedTime, burstSum, label + ': reported executed time');
  close(r.cpuUtilization, executed / r.makespan, label + ': utilization definition');
  close(r.throughput, procs.length / r.makespan, label + ': throughput definition');
  var avgW = 0, avgT = 0, avgR = 0;
  r.processes.forEach(function (p) { avgW += p.waitingTime; avgT += p.turnaroundTime; avgR += p.responseTime; });
  close(r.averages.waiting, avgW / procs.length, label + ': AWT');
  close(r.averages.turnaround, avgT / procs.length, label + ': ATAT');
  close(r.averages.response, avgR / procs.length, label + ': ART');
  eq(r.idleTime + r.overheadTime + r.executedTime, r.makespan, label + ': time accounting');
}

/* ---------- FCFS ---------- */
(function () {
  var procs = [P(1, 0, 5, 2), P(2, 1, 3, 1), P(3, 2, 8, 3)];
  var r = sim(procs, { algorithm: 'fcfs' });
  eq(timeline(r), ['P1:0-5', 'P2:5-8', 'P3:8-16'], 'FCFS order');
  eq(r.processes.map(function (p) { return p.completionTime; }), [5, 8, 16], 'FCFS completion times');
  close(r.averages.waiting, 10 / 3, 'FCFS AWT');
  close(r.averages.turnaround, 26 / 3, 'FCFS ATAT');
  close(r.averages.response, 10 / 3, 'FCFS ART');
  eq(r.contextSwitches, 2, 'FCFS context switches (zero cost)');
  eq(r.makespan, 16, 'FCFS makespan');
  assertInvariants(r, procs, 'FCFS');
})();

/* ---------- SJF non-preemptive, equal bursts tie-break ---------- */
(function () {
  var procs = [P(1, 0, 7, 3), P(2, 2, 4, 1), P(3, 4, 1, 2), P(4, 5, 4, 4)];
  var r = sim(procs, { algorithm: 'sjf' });
  eq(timeline(r), ['P1:0-7', 'P3:7-8', 'P2:8-12', 'P4:12-16'], 'SJF order (arrival tie-break on equal bursts)');
  eq(r.processes.map(function (p) { return p.completionTime; }), [7, 12, 8, 16], 'SJF CT');
  close(r.averages.waiting, 4, 'SJF AWT');
  close(r.averages.turnaround, 8, 'SJF ATAT');
  var tie = sim([P(9, 0, 3, 1), P(4, 0, 3, 1), P(7, 0, 3, 1)], { algorithm: 'sjf' });
  eq(tie.segments.map(function (s) { return s.pid; }), [9, 4, 7], 'SJF equal burst/arrival uses input order');
  assertInvariants(r, procs, 'SJF');
})();

/* ---------- SRTF preemption + tie handling ---------- */
(function () {
  var procs = [P(1, 0, 7, 2), P(2, 2, 4, 1), P(3, 4, 1, 3)];
  var r = sim(procs, { algorithm: 'srtf' });
  eq(timeline(r), ['P1:0-2', 'P2:2-4', 'P3:4-5', 'P2:5-7', 'P1:7-12'], 'SRTF schedule');
  eq(r.processes.map(function (p) { return p.completionTime; }), [12, 7, 5], 'SRTF CT');
  eq(r.contextSwitches, 4, 'SRTF switches');
  close(r.averages.waiting, 2, 'SRTF AWT');
  close(r.averages.response, 0, 'SRTF ART');
  var tie = sim([P(1, 0, 4, 1), P(2, 2, 2, 1)], { algorithm: 'srtf' });
  eq(timeline(tie), ['P1:0-4', 'P2:4-6'], 'SRTF keeps running on a remaining-time tie');
  eq(byPid(tie, 2).responseTime, 2, 'SRTF tie: P2 response');
  assertInvariants(r, procs, 'SRTF');
})();

/* ---------- Priority non-preemptive ---------- */
(function () {
  var procs = [P(1, 0, 5, 3), P(2, 1, 3, 1), P(3, 2, 4, 2)];
  var r = sim(procs, { algorithm: 'priority', priorityMode: 'non-preemptive' });
  eq(timeline(r), ['P1:0-5', 'P2:5-8', 'P3:8-12'], 'Priority NP does not interrupt the running process');
  eq(r.processes.map(function (p) { return p.completionTime; }), [5, 8, 12], 'Priority NP CT');
  var tie = sim([P(3, 0, 2, 2), P(1, 0, 2, 2), P(2, 0, 2, 2)], { algorithm: 'priority' });
  eq(tie.segments.map(function (s) { return s.pid; }), [3, 1, 2], 'Priority equal values use input order');
  assertInvariants(r, procs, 'Priority NP');
})();

/* ---------- Priority preemptive ---------- */
(function () {
  var procs = [P(1, 0, 5, 3), P(2, 1, 3, 1), P(3, 2, 4, 2)];
  var r = sim(procs, { algorithm: 'priority', priorityMode: 'preemptive' });
  eq(timeline(r), ['P1:0-1', 'P2:1-4', 'P3:4-8', 'P1:8-12'], 'Priority P preempts on strictly higher priority');
  eq(r.processes.map(function (p) { return p.completionTime; }), [12, 4, 8], 'Priority P CT');
  var tie = sim([P(1, 0, 4, 2), P(2, 2, 3, 2)], { algorithm: 'priority', priorityMode: 'preemptive' });
  eq(timeline(tie), ['P1:0-4', 'P2:4-7'], 'Priority P equal priority does not preempt');
  assertInvariants(r, procs, 'Priority P');
})();

/* ---------- Round Robin ---------- */
(function () {
  var procs = [P(1, 0, 5, 1), P(2, 1, 3, 1), P(3, 2, 1, 1)];
  var r = sim(procs, { algorithm: 'rr', quantum: 2 });
  eq(timeline(r), ['P1:0-2', 'P2:2-4', 'P3:4-5', 'P1:5-7', 'P2:7-8', 'P1:8-9'], 'RR quantum 2 schedule');
  eq(r.processes.map(function (p) { return p.completionTime; }), [9, 8, 5], 'RR CT');
  close(r.averages.waiting, 10 / 3, 'RR AWT');
  var b = sim([P(1, 0, 6, 1), P(2, 2, 2, 1)], { algorithm: 'rr', quantum: 2 });
  eq(timeline(b), ['P1:0-2', 'P2:2-4', 'P1:4-8'], 'RR boundary arrival runs before requeued process');
  var big = sim(procs, { algorithm: 'rr', quantum: 100 });
  eq(timeline(big), ['P1:0-5', 'P2:5-8', 'P3:8-9'], 'RR quantum > burst = FCFS');
  assertInvariants(r, procs, 'RR');
})();

/* ---------- idle periods ---------- */
(function () {
  var procs = [P(1, 3, 2, 1), P(2, 10, 2, 1)];
  var r = sim(procs, { algorithm: 'fcfs' });
  eq(timeline(r), ['idle:0-3', 'P1:3-5', 'idle:5-10', 'P2:10-12'], 'initial and intermediate idle');
  eq(r.idleTime, 8, 'idle total');
  eq(byPid(r, 1).responseTime, 0, 'response excludes initial idle');
  close(r.cpuUtilization, 4 / 12, 'utilization with idle');
  assertInvariants(r, procs, 'idle FCFS');
  var rr = sim(procs, { algorithm: 'rr', quantum: 1 });
  eq(timeline(rr), ['idle:0-3', 'P1:3-5', 'idle:5-10', 'P2:10-12'], 'RR idle periods (same-PID slices merged)');
  assertInvariants(rr, procs, 'idle RR');
})();

/* ---------- context-switch overhead ---------- */
(function () {
  var procs = [P(1, 0, 2, 1), P(2, 0, 2, 1)];
  var r = sim(procs, { algorithm: 'fcfs', contextSwitchCost: 1 });
  eq(timeline(r), ['P1:0-2', 'context-switch:2-3', 'P2:3-5'], 'CS before a different process only');
  eq(r.contextSwitches, 1, 'one switch counted');
  eq(r.overheadTime, 1, 'overhead time');
  eq(r.makespan, 5, 'overhead extends makespan');
  eq(byPid(r, 2).startTime, 3, 'post-switch start');
  eq(byPid(r, 2).responseTime, 3, 'post-switch response includes overhead');
  close(r.cpuUtilization, 4 / 5, 'overhead not counted as CPU time');
  assertInvariants(r, procs, 'CS FCFS');

  var idle = sim([P(1, 2, 2, 1), P(2, 2, 2, 1)], { algorithm: 'fcfs', contextSwitchCost: 1 });
  eq(timeline(idle), ['idle:0-2', 'P1:2-4', 'context-switch:4-5', 'P2:5-7'], 'no CS before the first dispatch');
  eq(idle.contextSwitches, 1, 'idle CS count');

  var rr = sim([P(1, 0, 4, 1)], { algorithm: 'rr', quantum: 2, contextSwitchCost: 2 });
  eq(timeline(rr), ['P1:0-4'], 'single process never pays a switch');
  eq(rr.contextSwitches, 0, 'single process switch count');
  eq(rr.overheadTime, 0, 'single process overhead');

  var s = sim([P(1, 0, 7, 1), P(2, 2, 4, 1), P(3, 4, 1, 1)], { algorithm: 'srtf', contextSwitchCost: 1 });
  eq(timeline(s), ['P1:0-2', 'context-switch:2-3', 'P2:3-4', 'context-switch:4-5', 'P3:5-6', 'context-switch:6-7', 'P2:7-10', 'context-switch:10-11', 'P1:11-16'], 'SRTF with overhead');
  eq(s.contextSwitches, 4, 'SRTF overhead switch count');
  eq(s.overheadTime, 4, 'SRTF overhead time');
  eq(s.makespan, 16, 'SRTF overhead makespan');
  assertInvariants(s, [P(1, 0, 7, 1), P(2, 2, 4, 1), P(3, 4, 1, 1)], 'SRTF overhead');

  var pp = sim([P(1, 0, 5, 3), P(2, 1, 3, 1)], { algorithm: 'priority', priorityMode: 'preemptive', contextSwitchCost: 1 });
  eq(timeline(pp), ['P1:0-1', 'context-switch:1-2', 'P2:2-5', 'context-switch:5-6', 'P1:6-10'], 'preemptive Priority with overhead');
  eq(pp.contextSwitches, 2, 'preemptive Priority switch count');
  assertInvariants(pp, [P(1, 0, 5, 3), P(2, 1, 3, 1)], 'preemptive Priority overhead');

  // Decision revised during overhead: the overhead is paid once, and the process
  // chosen after the overhead runs (no second charge for the same transition).
  var rev = sim([P(1, 0, 7, 1), P(2, 2, 4, 1), P(3, 3, 1, 1)], { algorithm: 'srtf', contextSwitchCost: 3 });
  eq(timeline(rev), ['P1:0-2', 'context-switch:2-5', 'P3:5-6', 'context-switch:6-9', 'P2:9-13', 'context-switch:13-16', 'P1:16-21'], 'overhead re-evaluates the ready set');
  eq(rev.contextSwitches, 3, 'revised decision switch count');
  assertInvariants(rev, [P(1, 0, 7, 1), P(2, 2, 4, 1), P(3, 3, 1, 1)], 'overhead re-evaluation');
})();

/* ---------- single process / validation ---------- */
(function () {
  var r = sim([P(1, 0, 4, 2)], { algorithm: 'srtf' });
  eq(timeline(r), ['P1:0-4'], 'single process');
  eq(r.makespan, 4, 'single process makespan');
  eq(r.contextSwitches, 0, 'single process no switch');
  assertInvariants(r, [P(1, 0, 4, 2)], 'single process');

  function throws(fn, re, msg) { assert.throws(fn, re, msg); checks++; }
  throws(function () { sim([], { algorithm: 'fcfs' }); }, /empty dataset/, 'empty dataset rejected');
  throws(function () { sim([P(1, 0, 2, 1), P(1, 1, 2, 1)], { algorithm: 'fcfs' }); }, /duplicate pid/, 'duplicate pid rejected');
  throws(function () { sim([P(1, -1, 2, 1)], { algorithm: 'fcfs' }); }, /arrivalTime/, 'negative arrival rejected');
  throws(function () { sim([P(1, 0, 0, 1)], { algorithm: 'fcfs' }); }, /burstTime/, 'zero burst rejected');
  throws(function () { sim([P(1, 0, 1, 0)], { algorithm: 'fcfs' }); }, /priority/, 'priority 0 rejected');
  throws(function () { sim([P(1, 0, 1, 1)], { algorithm: 'rr', quantum: 0 }); }, /quantum/, 'quantum 0 rejected');
  throws(function () { sim([P(1, 0, 1, 1)], { algorithm: 'rr' }); }, /quantum/, 'missing quantum rejected');
  throws(function () { sim([P(1, 0, 1, 1)], { algorithm: 'fcfs', contextSwitchCost: -1 }); }, /contextSwitchCost/, 'negative overhead rejected');
  throws(function () { sim([P(1, 0, 1, 1)], { algorithm: 'fcfs', contextSwitchCost: 1.5 }); }, /contextSwitchCost/, 'fractional overhead rejected');
  throws(function () { sim([P(1, 0, 1, 1)], { algorithm: 'nope' }); }, /unknown algorithm/, 'unknown algorithm rejected');
  throws(function () { sim([P(1, 0, 1, 1)], { algorithm: 'fcfs', priorityMode: 'x' }); }, /priorityMode/, 'bad priority mode rejected');
})();

/* ---------- input immutability + determinism + invariants on a mixed set ---------- */
(function () {
  var procs = [P(1, 0, 5, 3), P(2, 1, 3, 1), P(3, 2, 8, 2), P(4, 2, 2, 1), P(5, 9, 4, 5)];
  var snapshot = JSON.stringify(procs);
  var cfgs = [
    { algorithm: 'fcfs' }, { algorithm: 'sjf' }, { algorithm: 'srtf' },
    { algorithm: 'priority', priorityMode: 'non-preemptive' },
    { algorithm: 'priority', priorityMode: 'preemptive' },
    { algorithm: 'rr', quantum: 2 }
  ];
  cfgs.forEach(function (c) {
    var a = sim(procs, c), b = sim(procs, c);
    eq(JSON.stringify(a), JSON.stringify(b), c.algorithm + ': deterministic');
    eq(JSON.stringify(procs), snapshot, c.algorithm + ': input not mutated');
    assertInvariants(a, procs, c.algorithm + '/' + (c.priorityMode || ''));
    var withCost = sim(procs, Object.assign({ contextSwitchCost: 2 }, c));
    assertInvariants(withCost, procs, c.algorithm + ' + overhead');
    ok(withCost.makespan >= a.makespan, c.algorithm + ': overhead cannot shorten makespan');
  });
})();

console.log('\n' + checks + ' checks passed');
console.log('all scheduler checks passed');
