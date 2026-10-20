/* OS Scheduling Comparator — pure scheduling engine (no DOM, no input mutation).
   Algorithms: FCFS, SJF, SRTF, Priority (non-preemptive), Priority (preemptive), Round Robin.
   Integer time units. Deterministic. Half-open [start,end) segments.

   Tie-breaking (every algorithm), lexicographic on [primaryValue, arrivalTime, inputIndex, pid]:
     FCFS     primary = arrivalTime            -> arrival, input order
     SJF      primary = burstTime              -> shortest, arrival, input order
     SRTF     primary = remainingTime          -> shortest remaining, arrival, input order
     Priority primary = priority (lower wins)  -> highest priority, arrival, input order
     RR       FIFO queue; arrivals enqueue in [arrival, inputIndex, pid] order.
   Ties never preempt: SRTF keeps the running process when it ties for the smallest
   remaining time; Priority (preemptive) preempts only on a strictly higher priority.

   Context-switch policy (single documented model, used by all six algorithms):
     - contextSwitchCost = non-negative integer, default 0.
     - A switch is charged only on a DIRECT transition from executing process A to
       executing a different process B: not before the first dispatch, not after an
       idle period, not when the same process resumes.
     - The cost is a real 'context-switch' timeline segment [t, t+cost). No process
       executes during it; arrivals during it are recorded at their arrival times.
     - After the overhead the scheduler re-evaluates the ready set (preemptive
       algorithms and RR queue order included) and runs the winner. No second
       switch is charged for that re-evaluation: the single overhead pays for
       leaving the previous process context. If the re-evaluation selects the
       previous process again (an arrival during overhead changed the decision),
       the overhead is still spent but no process-to-process transition occurred,
       so it is not counted as a context switch.
     - Overhead is never counted as burst time or productive CPU time.
*/
(function () {
  'use strict';

  var ALGORITHMS = ['fcfs', 'sjf', 'srtf', 'priority', 'rr'];
  var ENGINE_VERSION = 2;
  var GUARD = 5000000;

  function SchedulerError(message) {
    this.name = 'SchedulerError';
    this.message = message;
    if (Error.captureStackTrace) Error.captureStackTrace(this, SchedulerError);
  }
  SchedulerError.prototype = Object.create(Error.prototype);
  SchedulerError.prototype.constructor = SchedulerError;
  function fail(msg) { throw new SchedulerError(msg); }

  function isInt(n) { return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n; }

  /* ---------- validation + clone (input is never mutated) ---------- */
  function validateAndClone(procs) {
    if (!Array.isArray(procs)) fail('processes must be an array');
    if (procs.length === 0) fail('cannot simulate an empty dataset');
    var seen = {};
    var out = [];
    for (var i = 0; i < procs.length; i++) {
      var p = procs[i];
      if (!p || typeof p !== 'object') fail('process at index ' + i + ' is not an object');
      var pid = p.pid, arr = p.arrivalTime, burst = p.burstTime, pri = p.priority;
      if (!isInt(pid)) fail('process at index ' + i + ' has an invalid pid (must be an integer)');
      if (seen[pid]) fail('duplicate pid: ' + pid);
      seen[pid] = 1;
      if (!isInt(arr) || arr < 0) fail('process ' + pid + ': arrivalTime must be a non-negative integer');
      if (!isInt(burst) || burst < 1) fail('process ' + pid + ': burstTime must be a positive integer');
      if (!isInt(pri) || pri < 1) fail('process ' + pid + ': priority must be a positive integer');
      out.push({ pid: pid, arrivalTime: arr, burstTime: burst, priority: pri, index: i,
        remaining: burst, firstStart: null, completion: null });
    }
    return out;
  }

  function validateConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') fail('missing configuration');
    var algo = cfg.algorithm;
    if (ALGORITHMS.indexOf(algo) < 0) fail('unknown algorithm: ' + algo);
    var quantum = cfg.quantum;
    if (algo === 'rr') {
      if (!isInt(quantum) || quantum < 1) fail('Round Robin requires a positive integer quantum');
    } else if (quantum != null && (!isInt(quantum) || quantum < 1)) {
      fail('quantum must be a positive integer when provided');
    }
    var ctx = cfg.contextSwitchCost == null ? 0 : cfg.contextSwitchCost;
    if (!isInt(ctx) || ctx < 0) fail('contextSwitchCost must be a non-negative integer');
    var pm = cfg.priorityMode || 'non-preemptive';
    if (pm !== 'non-preemptive' && pm !== 'preemptive') fail('priorityMode must be "non-preemptive" or "preemptive"');
    return { algorithm: algo, quantum: quantum, contextSwitchCost: ctx, priorityMode: pm };
  }

  // Lexicographic comparator on [primary, arrival, index, pid]; lower wins.
  function lessThan(a, b, primary) {
    var pa = primary(a), pb = primary(b);
    if (pa !== pb) return pa < pb;
    if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime < b.arrivalTime;
    if (a.index !== b.index) return a.index < b.index;
    return a.pid < b.pid;
  }

  function argmin(list, primary) {
    var best = list[0];
    for (var i = 1; i < list.length; i++) if (lessThan(list[i], best, primary)) best = list[i];
    return best;
  }

  /* ---------- decision trace (opt-in, bounded; never affects scheduling) ----------
     Records why each dispatch / preemption / idle gap / RR quantum expiry happened.
     Candidate lists are the first TRACE_CANDIDATES in the algorithm's own order, so
     the selected process is always included. traceLimit bounds memory; benchmarks
     and comparisons do not request a trace at all. */
  var TRACE_CANDIDATES = 8;
  function newTrace(limit) { return { list: [], truncated: false, limit: limit || 600 }; }
  function tracePush(trace, rec) {
    if (!trace) return;
    if (trace.list.length >= trace.limit) { trace.truncated = true; return; }
    trace.list.push(rec);
  }
  function candidateSnap(p) {
    return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority, remaining: p.remaining };
  }
  function topCandidates(list, primary) {
    var sorted = list.slice().sort(function (a, b) {
      if (lessThan(a, b, primary)) return -1;
      if (lessThan(b, a, primary)) return 1;
      return 0;
    });
    return sorted.slice(0, TRACE_CANDIDATES).map(candidateSnap);
  }
  function tieBreakOf(list, primary, selected) {
    var tied = list.filter(function (x) { return primary(x) === primary(selected); });
    if (tied.length < 2) return null;
    for (var i = 0; i < tied.length; i++) if (tied[i].arrivalTime !== selected.arrivalTime) return 'arrival';
    return 'input-order';
  }

  function nextArrival(procs, time) {
    var next = Infinity;
    for (var i = 0; i < procs.length; i++) {
      var p = procs[i];
      if (p.remaining > 0 && p.arrivalTime > time && p.arrivalTime < next) next = p.arrivalTime;
    }
    return next;
  }

  function readyAt(procs, time) {
    var out = [];
    for (var i = 0; i < procs.length; i++) if (procs[i].arrivalTime <= time && procs[i].remaining > 0) out.push(procs[i]);
    return out;
  }

  /* ---------- non-preemptive runner (FCFS, SJF, non-preemptive Priority) ---------- */
  function runNonPreemptive(procs, primary, ctx, trace, criterion) {
    var pending = procs.slice();
    var time = 0, lastPid = null, lastWasProcess = false, segs = [], guard = 0;
    while (pending.length) {
      if (guard++ > GUARD) fail('internal: non-preemptive loop guard exceeded');
      var ready = [];
      for (var i = 0; i < pending.length; i++) if (pending[i].arrivalTime <= time) ready.push(pending[i]);
      if (ready.length === 0) {
        var nextArr = Infinity;
        for (var j = 0; j < pending.length; j++) if (pending[j].arrivalTime < nextArr) nextArr = pending[j].arrivalTime;
        if (!(nextArr > time)) fail('internal: no ready process but an arrival is <= current time');
        tracePush(trace, { time: time, type: 'idle', until: nextArr });
        segs.push({ pid: null, start: time, end: nextArr, type: 'idle' });
        time = nextArr; lastWasProcess = false; continue;
      }
      var p = argmin(ready, primary);
      if (ctx > 0 && lastPid !== null && lastPid !== p.pid && lastWasProcess) {
        segs.push({ pid: null, start: time, end: time + ctx, type: 'context-switch' });
        time += ctx; lastWasProcess = false;
        continue; // re-evaluate after overhead: arrivals during it are now ready
      }
      if (p.firstStart === null) p.firstStart = time;
      tracePush(trace, { time: time, type: 'dispatch', pid: p.pid, criterion: criterion, value: primary(p),
        readyCount: ready.length, candidates: topCandidates(ready, primary), tieBreak: tieBreakOf(ready, primary, p) });
      var runStart = time;
      segs.push({ pid: p.pid, start: time, end: time + p.burstTime, type: 'process' });
      time += p.burstTime;
      p.remaining = 0; p.completion = time;
      lastPid = p.pid; lastWasProcess = true;
      pending = pending.filter(function (x) { return x !== p; });
      // A process arriving while this one runs cannot preempt it: record that fact once.
      var arrivalDuring = Infinity, arrivedPids = null;
      for (var k = 0; k < pending.length; k++) {
        var q = pending[k];
        if (q.arrivalTime > runStart && q.arrivalTime < time) {
          if (q.arrivalTime < arrivalDuring) { arrivalDuring = q.arrivalTime; arrivedPids = [q.pid]; }
          else if (q.arrivalTime === arrivalDuring) arrivedPids.push(q.pid);
        }
      }
      if (arrivedPids) tracePush(trace, { time: arrivalDuring, type: 'continue', pid: p.pid, criterion: criterion,
        reason: 'non-preemptive', arrived: arrivedPids, until: time });
    }
    return segs;
  }

  /* ---------- preemptive runner (SRTF, preemptive Priority) ---------- */
  function runPreemptive(procs, primary, ctx, trace, criterion) {
    // primary returns the value to MINIMIZE (remaining time, or priority number).
    var time = 0, running = null, lastPid = null, lastWasProcess = false, segs = [], guard = 0;
    var totalRemaining = 0;
    for (var i = 0; i < procs.length; i++) totalRemaining += procs[i].remaining;
    while (totalRemaining > 0) {
      if (guard++ > GUARD) fail('internal: preemptive loop guard exceeded');
      if (!running) {
        var ready = readyAt(procs, time);
        if (ready.length === 0) {
          var nextArr = nextArrival(procs, time);
          if (nextArr === Infinity) fail('internal: no ready process and no future arrivals');
          tracePush(trace, { time: time, type: 'idle', until: nextArr });
          segs.push({ pid: null, start: time, end: nextArr, type: 'idle' });
          time = nextArr; lastWasProcess = false; continue;
        }
        var best = argmin(ready, primary);
        if (ctx > 0 && lastPid !== null && lastPid !== best.pid && lastWasProcess) {
          segs.push({ pid: null, start: time, end: time + ctx, type: 'context-switch' });
          time += ctx; lastWasProcess = false;
          continue; // re-evaluate after overhead
        }
        tracePush(trace, { time: time, type: 'dispatch', pid: best.pid, criterion: criterion, value: primary(best),
          readyCount: ready.length, candidates: topCandidates(ready, primary), tieBreak: tieBreakOf(ready, primary, best) });
        running = best;
        if (running.firstStart === null) running.firstStart = time;
      }
      var nextArrivalTime = nextArrival(procs, time);
      var completion = time + running.remaining;
      var nextEvent = Math.min(nextArrivalTime, completion);
      var slice = nextEvent - time;
      if (slice <= 0) fail('internal: zero-length execution slice');
      segs.push({ pid: running.pid, start: time, end: nextEvent, type: 'process' });
      running.remaining -= slice; totalRemaining -= slice; time = nextEvent;
      if (running.remaining === 0) {
        running.completion = time; lastPid = running.pid; lastWasProcess = true; running = null;
      } else {
        var readyNow = readyAt(procs, time);
        var cand = argmin(readyNow, primary);
        if (primary(cand) < primary(running)) { // strictly better only
          tracePush(trace, { time: time, type: 'preempt', from: running.pid, pid: cand.pid, criterion: criterion,
            fromValue: primary(running), value: primary(cand), candidates: topCandidates(readyNow, primary) });
          lastPid = running.pid; lastWasProcess = true; running = null;
        } else {
          // An arrival happened (otherwise the slice would have completed the process).
          // Compare against the best *other* ready process, not the running process.
          var others = readyNow.filter(function (x) { return x !== running; });
          var bestOther = others.length ? argmin(others, primary) : null;
          tracePush(trace, { time: time, type: 'continue', pid: running.pid, criterion: criterion,
            reason: bestOther && primary(bestOther) === primary(running) ? 'tie-keeps-running' : 'still-best',
            value: primary(running), candidate: bestOther ? bestOther.pid : null,
            candidateValue: bestOther ? primary(bestOther) : null,
            candidates: topCandidates(readyNow, primary) });
        }
      }
    }
    return segs;
  }

  /* ---------- Round Robin ---------- */
  function runRR(procs, quantum, ctx, trace) {
    var arrOrder = procs.slice().sort(function (a, b) {
      if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime - b.arrivalTime;
      if (a.index !== b.index) return a.index - b.index;
      return a.pid - b.pid;
    });
    var arrIdx = 0, queue = [], time = 0, lastPid = null, lastWasProcess = false, segs = [], guard = 0;
    var totalRemaining = 0;
    for (var i = 0; i < procs.length; i++) totalRemaining += procs[i].remaining;
    function enqueueArrivals(upto) {
      while (arrIdx < arrOrder.length && arrOrder[arrIdx].arrivalTime <= upto) { queue.push(arrOrder[arrIdx]); arrIdx++; }
    }
    function queueSnap() { return queue.slice(0, TRACE_CANDIDATES).map(candidateSnap); }
    while (totalRemaining > 0) {
      if (guard++ > GUARD) fail('internal: Round Robin loop guard exceeded');
      enqueueArrivals(time);
      if (queue.length === 0) {
        if (arrIdx >= arrOrder.length) fail('internal: Round Robin has unfinished work but no ready or arriving process');
        var nextArr = arrOrder[arrIdx].arrivalTime;
        if (!(nextArr > time)) fail('internal: Round Robin idle advance did not move forward');
        tracePush(trace, { time: time, type: 'idle', until: nextArr });
        segs.push({ pid: null, start: time, end: nextArr, type: 'idle' });
        time = nextArr; lastWasProcess = false;
        continue;
      }
      var p = queue[0];
      if (ctx > 0 && lastPid !== null && lastPid !== p.pid && lastWasProcess) {
        segs.push({ pid: null, start: time, end: time + ctx, type: 'context-switch' });
        time += ctx; lastWasProcess = false;
        enqueueArrivals(time); // arrivals during overhead are ready before the next dispatch
        continue;
      }
      queue.shift();
      if (p.firstStart === null) p.firstStart = time;
      tracePush(trace, { time: time, type: 'dispatch', pid: p.pid, criterion: 'rr-queue',
        readyCount: queue.length + 1, queue: [candidateSnap(p)].concat(queueSnap()) });
      var slice = Math.min(quantum, p.remaining);
      if (slice <= 0) fail('internal: Round Robin zero-length slice');
      segs.push({ pid: p.pid, start: time, end: time + slice, type: 'process' });
      time += slice; p.remaining -= slice; totalRemaining -= slice;
      lastPid = p.pid; lastWasProcess = true;
      enqueueArrivals(time); // arrivals at the boundary enqueue BEFORE the preempted process
      if (p.remaining > 0) {
        queue.push(p);
        tracePush(trace, { time: time, type: 'quantum', pid: p.pid, quantum: quantum,
          remaining: p.remaining, queueAfter: queue.slice(0, TRACE_CANDIDATES).map(function (x) { return x.pid; }) });
      } else p.completion = time;
    }
    return segs;
  }

  /* ---------- result assembly ---------- */
  function buildResult(cfg, procs, segs) {
    var merged = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.end <= s.start) continue; // never emit zero-length segments
      var prev = merged[merged.length - 1];
      if (prev && prev.type === 'process' && s.type === 'process' && prev.pid === s.pid && prev.end === s.start) prev.end = s.end;
      else merged.push({ pid: s.pid, start: s.start, end: s.end, type: s.type });
    }
    if (merged.length === 0) fail('internal: empty timeline');
    if (merged[0].start !== 0) fail('internal: timeline does not start at 0');

    var procResults = procs.map(function (p) {
      if (p.completion == null) fail('internal: process ' + p.pid + ' did not complete');
      if (p.firstStart == null) fail('internal: process ' + p.pid + ' never started');
      var turnaround = p.completion - p.arrivalTime;
      return {
        pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority,
        startTime: p.firstStart, completionTime: p.completion,
        turnaroundTime: turnaround, waitingTime: turnaround - p.burstTime,
        responseTime: p.firstStart - p.arrivalTime
      };
    });

    var makespan = 0, executed = 0, idle = 0, overhead = 0, switches = 0;
    var prevProcPid = null;
    for (var j = 0; j < merged.length; j++) {
      var m = merged[j];
      if (m.end > makespan) makespan = m.end;
      if (m.type === 'process') {
        executed += m.end - m.start;
        if (prevProcPid !== null && prevProcPid !== m.pid) switches++;
        prevProcPid = m.pid;
      } else if (m.type === 'idle') {
        idle += m.end - m.start;
        prevProcPid = null; // idle breaks a process-to-process transition
      } else {
        overhead += m.end - m.start;
        prevProcPid = null; // overhead is not execution; count it separately below
      }
    }
    // Each context-switch segment is one charged switch; direct process->process
    // transitions only exist when cost is 0.
    for (var k = 0; k < merged.length; k++) if (merged[k].type === 'context-switch') switches++;

    var n = procResults.length;
    var sumBurst = 0, sumW = 0, sumT = 0, sumR = 0;
    for (var q = 0; q < n; q++) {
      sumBurst += procResults[q].burstTime;
      sumW += procResults[q].waitingTime;
      sumT += procResults[q].turnaroundTime;
      sumR += procResults[q].responseTime;
    }
    if (executed !== sumBurst) fail('internal: executed time (' + executed + ') != total burst (' + sumBurst + ')');
    if (makespan <= 0) fail('internal: non-positive makespan');

    return {
      engineVersion: ENGINE_VERSION,
      algorithm: cfg.algorithm,
      config: cfg,
      processes: procResults,
      segments: merged,
      makespan: makespan,
      executedTime: executed,
      idleTime: idle,
      overheadTime: overhead,
      contextSwitches: switches,
      cpuUtilization: executed / makespan,
      throughput: n / makespan,
      averages: { waiting: sumW / n, turnaround: sumT / n, response: sumR / n },
      completedCount: n
    };
  }

  /* ---------- public API ---------- */
  function simulate(input) {
    var cfg = validateConfig(input);
    var procs = validateAndClone(input && input.processes);
    var trace = input && input.trace ? newTrace(input.traceLimit) : null;
    var segs;
    if (cfg.algorithm === 'fcfs') segs = runNonPreemptive(procs, function (p) { return p.arrivalTime; }, cfg.contextSwitchCost, trace, 'arrival');
    else if (cfg.algorithm === 'sjf') segs = runNonPreemptive(procs, function (p) { return p.burstTime; }, cfg.contextSwitchCost, trace, 'burst');
    else if (cfg.algorithm === 'priority') {
      if (cfg.priorityMode === 'preemptive') segs = runPreemptive(procs, function (p) { return p.priority; }, cfg.contextSwitchCost, trace, 'priority');
      else segs = runNonPreemptive(procs, function (p) { return p.priority; }, cfg.contextSwitchCost, trace, 'priority');
    } else if (cfg.algorithm === 'srtf') segs = runPreemptive(procs, function (p) { return p.remaining; }, cfg.contextSwitchCost, trace, 'remaining');
    else segs = runRR(procs, cfg.quantum, cfg.contextSwitchCost, trace);
    var result = buildResult(cfg, procs, segs);
    if (trace) { result.decisions = trace.list; result.traceTruncated = trace.truncated; }
    return result;
  }

  window.scheduler = { simulate: simulate, ALGORITHMS: ALGORITHMS, SchedulerError: SchedulerError, ENGINE_VERSION: ENGINE_VERSION };
})();
