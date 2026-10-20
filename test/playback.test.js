/* Playback tests — Node assert, deterministic fake clock, hand-computed states.
   Run: node test/playback.test.js */
'use strict';
var assert = require('assert');
var path = require('path');

global.window = {};
require(path.resolve(__dirname, '../src/scheduler.js'));
require(path.resolve(__dirname, '../src/playback.js'));
var simulate = global.window.scheduler.simulate;
var createPlayback = global.window.playback.createPlayback;

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

function fakeTimer() {
  var t = 0, slots = [], nextId = 1;
  return {
    now: function () { return t; },
    setT: function (v) { t = v; },
    advance: function (ms) { t += ms; },
    setInterval: function (fn) { var id = nextId++; slots.push({ id: id, fn: fn }); return id; },
    clearInterval: function (id) { slots = slots.filter(function (s) { return s.id !== id; }); },
    fire: function () { slots.slice().forEach(function (s) { s.fn(); }); },
    count: function () { return slots.length; }
  };
}
function mk(input, cfg, opts) {
  return createPlayback(simulate(Object.assign({ processes: input }, cfg)), opts || { timer: fakeTimer() });
}
function statuses(s) { var o = {}; s.processes.forEach(function (p) { o[p.pid] = p.status; }); return o; }
function remainings(s) { var o = {}; s.processes.forEach(function (p) { o[p.pid] = p.remaining; }); return o; }

var FCFS_IN = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 8, priority: 3 }];
var SRTF_IN = [{ pid: 1, arrivalTime: 0, burstTime: 7, priority: 1 }, { pid: 2, arrivalTime: 2, burstTime: 4, priority: 2 }, { pid: 3, arrivalTime: 4, burstTime: 1, priority: 3 }, { pid: 4, arrivalTime: 5, burstTime: 4, priority: 4 }];
var PREEMPT_IN = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 3 }, { pid: 2, arrivalTime: 2, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 4, burstTime: 1, priority: 2 }];
var NONPREEMPT_IN = [{ pid: 1, arrivalTime: 0, burstTime: 4, priority: 3 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 1, priority: 4 }, { pid: 4, arrivalTime: 3, burstTime: 2, priority: 2 }];
var RR_IN = [{ pid: 1, arrivalTime: 0, burstTime: 5, priority: 1 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }, { pid: 3, arrivalTime: 2, burstTime: 8, priority: 1 }];

/* initial state */
check('initial state', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  var st = pb.getState();
  assert.strictEqual(st.currentTime, 0);
  assert.strictEqual(st.duration, 16);
  assert.strictEqual(st.isPlaying, false);
  assert.strictEqual(st.status, 'ready');
  assert.strictEqual(pb.snapshot().running, 1);
});

/* play / pause / single timer / freeze */
check('play then pause', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  pb.play();
  assert.strictEqual(pb.getState().isPlaying, true);
  assert.strictEqual(pb.getState().status, 'playing');
  pb.pause();
  assert.strictEqual(pb.getState().isPlaying, false);
  assert.strictEqual(pb.getState().status, 'paused');
});
check('repeated play creates one timer', function () {
  var ft = fakeTimer();
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft });
  pb.play(); pb.play(); pb.play();
  assert.strictEqual(ft.count(), 1);
});
check('pause freezes simulation time', function () {
  var ft = fakeTimer();
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft });
  pb.play(); ft.advance(300); ft.fire();
  var t1 = pb.getState().currentTime;
  assert.ok(t1 > 0);
  pb.pause(); ft.advance(300); ft.fire();
  assert.strictEqual(pb.getState().currentTime, t1);
});

/* stepping is exactly one simulation-time unit */
check('step forward advances exactly one time unit', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  pb.stepForward(); assert.strictEqual(pb.getState().currentTime, 1);
  pb.stepForward(); assert.strictEqual(pb.getState().currentTime, 2);
  pb.stepForward(); assert.strictEqual(pb.getState().currentTime, 3);
  assert.strictEqual(pb.getState().status, 'paused');
  assert.strictEqual(pb.snapshot().running, 1);
  assert.deepStrictEqual(remainings(pb.snapshot()), { 1: 2, 2: 3, 3: 8 });
});
check('step backward moves exactly one time unit and clamps at 0', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  pb.seek(8);
  pb.stepBackward(); assert.strictEqual(pb.getState().currentTime, 7);
  pb.seek(0); pb.stepBackward(); assert.strictEqual(pb.getState().currentTime, 0);
  assert.strictEqual(pb.getState().status, 'ready');
});
check('step at the end stays complete and does not overflow', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  pb.seek(16); pb.stepForward();
  assert.strictEqual(pb.getState().currentTime, 16);
  assert.strictEqual(pb.getState().status, 'complete');
});
check('step pauses a playing run', function () {
  var ft = fakeTimer();
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft });
  pb.play(); pb.stepForward();
  assert.strictEqual(pb.getState().isPlaying, false);
  assert.strictEqual(ft.count(), 0);
});

/* seek / reset / completion */
check('seek start/middle/end and clamp', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  pb.seek(16); assert.strictEqual(pb.getState().status, 'complete');
  pb.seek(0); assert.strictEqual(pb.getState().status, 'ready');
  pb.seek(7); assert.strictEqual(pb.getState().status, 'paused');
  pb.seek(-99); assert.strictEqual(pb.getState().currentTime, 0);
  pb.seek(9999); assert.strictEqual(pb.getState().currentTime, 16);
});
check('reset returns to start and preserves the result', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  pb.seek(10); pb.play(); pb.reset();
  assert.strictEqual(pb.getState().currentTime, 0);
  assert.strictEqual(pb.getState().isPlaying, false);
  assert.strictEqual(pb.getState().status, 'ready');
  assert.strictEqual(pb.snapshot().running, 1);
  assert.strictEqual(pb.getState().duration, 16);
});
check('completion stops playback and clears the timer', function () {
  var ft = fakeTimer();
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft });
  pb.seek(15); pb.play();
  ft.advance(100000); ft.fire();
  assert.strictEqual(pb.getState().status, 'complete');
  assert.strictEqual(pb.getState().isPlaying, false);
  assert.strictEqual(ft.count(), 0);
  assert.strictEqual(pb.snapshot().running, null);
});

/* empty dataset rejected upstream */
check('empty dataset is rejected before playback', function () {
  assert.throws(function () { simulate({ processes: [], algorithm: 'fcfs' }); }, /empty/);
});

/* reconstruction: idle + context switch */
check('idle interval reconstructed', function () {
  var pb = mk([{ pid: 1, arrivalTime: 0, burstTime: 2, priority: 1 }, { pid: 2, arrivalTime: 5, burstTime: 2, priority: 1 }], { algorithm: 'fcfs' });
  var s = pb.reconstruct(3);
  assert.strictEqual(s.cpuState, 'idle');
  assert.strictEqual(s.running, null);
  assert.deepStrictEqual(s.completed, [1]);
  assert.deepStrictEqual(s.notArrived, [2]);
  assert.deepStrictEqual(s.readyQueue, []);
});
check('context-switch interval reconstructed', function () {
  var pb = mk([{ pid: 1, arrivalTime: 0, burstTime: 3, priority: 1 }, { pid: 2, arrivalTime: 0, burstTime: 3, priority: 1 }], { algorithm: 'fcfs', contextSwitchCost: 2 });
  var s3 = pb.reconstruct(3);
  assert.strictEqual(s3.cpuState, 'context-switch');
  assert.strictEqual(s3.running, null);
  assert.deepStrictEqual(s3.completed, [1]);
  assert.deepStrictEqual(s3.readyQueue, [2]);
  var s5 = pb.reconstruct(5);
  assert.strictEqual(s5.cpuState, 'process');
  assert.strictEqual(s5.running, 2);
});

/* remaining time and status */
check('remaining burst decreases correctly', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  assert.deepStrictEqual(remainings(pb.reconstruct(0)), { 1: 5, 2: 3, 3: 8 });
  assert.deepStrictEqual(remainings(pb.reconstruct(2)), { 1: 3, 2: 3, 3: 8 });
  assert.deepStrictEqual(remainings(pb.reconstruct(5)), { 1: 0, 2: 3, 3: 8 });
  assert.deepStrictEqual(remainings(pb.reconstruct(16)), { 1: 0, 2: 0, 3: 0 });
});
check('process states at a mid-run time', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  var s = pb.reconstruct(6);
  assert.deepStrictEqual(statuses(s), { 1: 'completed', 2: 'running', 3: 'ready' });
  assert.strictEqual(s.running, 2);
  assert.deepStrictEqual(s.readyQueue, [3]);
});

/* per-algorithm queue order */
check('SRTF preemption reconstructed', function () {
  var pb = mk(SRTF_IN, { algorithm: 'srtf' });
  var s2 = pb.reconstruct(2);
  assert.strictEqual(s2.running, 2);
  assert.deepStrictEqual(statuses(s2), { 1: 'ready', 2: 'running', 3: 'not-arrived', 4: 'not-arrived' });
  assert.deepStrictEqual(s2.readyQueue, [1]);
  assert.strictEqual(remainings(s2)[1], 5);
  var s4 = pb.reconstruct(4);
  assert.strictEqual(s4.running, 3);
  assert.deepStrictEqual(s4.readyQueue, [2, 1]);
});
check('preemptive priority interruption and queue order', function () {
  var pb = mk(PREEMPT_IN, { algorithm: 'priority', priorityMode: 'preemptive' });
  var s2 = pb.reconstruct(2);
  assert.strictEqual(s2.running, 2);
  assert.deepStrictEqual(s2.readyQueue, [1]);
  var s4 = pb.reconstruct(4);
  assert.strictEqual(s4.running, 2);
  assert.deepStrictEqual(s4.readyQueue, [3, 1]);
  var evs = pb.getEvents().filter(function (e) { return e.type === 'preempt'; });
  assert.ok(evs.some(function (e) { return e.time === 2 && e.pid === 1; }));
});
check('non-preemptive priority queue order', function () {
  var pb = mk(NONPREEMPT_IN, { algorithm: 'priority', priorityMode: 'non-preemptive' });
  assert.strictEqual(pb.reconstruct(2).running, 1);
  assert.deepStrictEqual(pb.reconstruct(2).readyQueue, [2, 3]);
  assert.strictEqual(pb.reconstruct(4).running, 2);
  assert.deepStrictEqual(pb.reconstruct(4).readyQueue, [4, 3]);
  assert.strictEqual(pb.getEvents().filter(function (e) { return e.type === 'preempt'; }).length, 0);
});
check('RR queue order follows FIFO at boundaries', function () {
  var pb = mk(RR_IN, { algorithm: 'rr', quantum: 2 });
  assert.deepStrictEqual(pb.reconstruct(0).readyQueue, []);
  assert.deepStrictEqual(pb.reconstruct(2).readyQueue, [3, 1]);
  assert.strictEqual(pb.reconstruct(2).running, 2);
  assert.deepStrictEqual(pb.reconstruct(4).readyQueue, [1, 2]);
});
check('RR with context-switch overhead reconstructs overhead segments', function () {
  var pb = mk([{ pid: 1, arrivalTime: 0, burstTime: 2, priority: 1 }, { pid: 2, arrivalTime: 0, burstTime: 2, priority: 1 }], { algorithm: 'rr', quantum: 2, contextSwitchCost: 1 });
  assert.strictEqual(pb.reconstruct(2).cpuState, 'context-switch');
  assert.strictEqual(pb.reconstruct(3).running, 2);
});

/* half-open boundaries */
check('half-open [start,end) at exact boundaries', function () {
  var pb = mk(FCFS_IN, { algorithm: 'fcfs' });
  assert.strictEqual(pb.reconstruct(4).running, 1);
  assert.strictEqual(pb.reconstruct(5).running, 2);
  assert.strictEqual(statuses(pb.reconstruct(5))[1], 'completed');
  var end = pb.reconstruct(16);
  assert.strictEqual(end.running, null);
  assert.strictEqual(end.cpuState, 'done');
  end.processes.forEach(function (p) { assert.strictEqual(p.status, 'completed'); });
});

/* speed independence */
check('speed does not change reconstructed states', function () {
  var a = mk(FCFS_IN, { algorithm: 'fcfs' }); a.setSpeed(4);
  var b = mk(FCFS_IN, { algorithm: 'fcfs' }); b.setSpeed(0.5);
  a.getBoundaries().forEach(function (t) { assert.deepStrictEqual(a.reconstruct(t), b.reconstruct(t)); });
});
check('speed changes wall-clock rate only', function () {
  var ft1 = fakeTimer(), ft2 = fakeTimer();
  var a = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft1 }); a.setSpeed(1);
  var b = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft2 }); b.setSpeed(4);
  a.play(); b.play();
  ft1.advance(100); ft1.fire();
  ft2.advance(100); ft2.fire();
  assert.ok(b.getState().currentTime > a.getState().currentTime);
  assert.strictEqual(a.getState().duration, b.getState().duration);
});

/* lifecycle */
check('dispose clears the timer and blocks late callbacks', function () {
  var ft = fakeTimer();
  var pb1 = mk(FCFS_IN, { algorithm: 'fcfs' }, { timer: ft });
  pb1.play();
  assert.ok(pb1._timerActive());
  pb1.dispose();
  assert.strictEqual(pb1.getState().status, 'disposed');
  assert.strictEqual(ft.count(), 0);
  var pb2 = mk(SRTF_IN, { algorithm: 'srtf' }, { timer: ft });
  pb2.play();
  var tBefore = pb1.getState().currentTime;
  ft.advance(500); ft.fire();
  assert.strictEqual(pb1.getState().currentTime, tBefore);
  assert.ok(pb2.getState().currentTime > 0);
  pb2.dispose();
});
check('algorithm change produces different reconstructions', function () {
  var r1 = simulate({ processes: SRTF_IN, algorithm: 'fcfs' });
  var r2 = simulate({ processes: SRTF_IN, algorithm: 'sjf' });
  var pb1 = createPlayback(r1, { timer: fakeTimer() });
  var pb2 = createPlayback(r2, { timer: fakeTimer() });
  assert.notDeepStrictEqual(pb1.reconstruct(7), pb2.reconstruct(7));
  assert.strictEqual(pb1.reconstruct(7).running, 2);
  assert.strictEqual(pb2.reconstruct(7).running, 3);
});

/* result immutability */
check('result and input are not mutated by playback', function () {
  var input = [{ pid: 1, arrivalTime: 0, burstTime: 4, priority: 2 }, { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 }];
  var result = simulate({ processes: input, algorithm: 'fcfs' });
  var segSnap = JSON.parse(JSON.stringify(result.segments));
  var procSnap = JSON.parse(JSON.stringify(result.processes));
  var snapInput = JSON.parse(JSON.stringify(input));
  var pb = createPlayback(result, { timer: fakeTimer() });
  pb.play(); pb.seek(2); pb.stepForward(); pb.stepBackward(); pb.reset(); pb.reconstruct(2); pb.getEvents();
  assert.deepStrictEqual(result.segments, segSnap);
  assert.deepStrictEqual(result.processes, procSnap);
  assert.deepStrictEqual(input, snapInput);
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all playback checks passed');
