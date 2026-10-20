/* OS Scheduling Comparator — playback controller (pure logic, no DOM).
   Consumes the engine result and derives every displayed state from it. It never
   re-decides the schedule.

   Simulation time is integer and independent of wall-clock time. Step advances
   exactly ONE simulation-time unit (not an animation frame, not an event jump).
   Speeds (0.5x, 1x, 2x, 4x) change only the wall-clock rate.

   At integer t (half-open segments):
     active segment : start <= t < end
     running        : active process segment's pid, else null
     arrived        : arrivalTime <= t
     completed      : completionTime <= t
     remaining      : burstTime - execution before t (computed from segments)
   Ready-queue order is derived from each algorithm's documented tie-break, so it
   matches what the engine would pick next. */
(function () {
  'use strict';

  var SPEEDS = [0.5, 1, 2, 4];
  var TICK_MS = 50;
  var SCALE = 0.02; // sim units per ms at 1x (~50 ms per time unit)

  var defaultTimer = {
    now: function () { return Date.now(); },
    setInterval: function (fn, ms) { return setInterval(fn, ms); },
    clearInterval: function (id) { clearInterval(id); }
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function buildEvents(segments, procs, duration) {
    var ev = [{ time: 0, type: 'start' }];
    procs.forEach(function (p) { ev.push({ time: p.arrivalTime, type: 'arrival', pid: p.pid }); });
    segments.forEach(function (s) {
      if (s.type === 'process') {
        ev.push({ time: s.start, type: 'dispatch', pid: s.pid });
        var p = null;
        for (var i = 0; i < procs.length; i++) if (procs[i].pid === s.pid) p = procs[i];
        if (p && s.end < p.completionTime) ev.push({ time: s.end, type: 'preempt', pid: s.pid });
      } else if (s.type === 'idle') {
        ev.push({ time: s.start, type: 'idle-start' });
        ev.push({ time: s.end, type: 'idle-end' });
      } else if (s.type === 'context-switch') {
        ev.push({ time: s.start, type: 'cs-start' });
        ev.push({ time: s.end, type: 'cs-end' });
      }
    });
    procs.forEach(function (p) { ev.push({ time: p.completionTime, type: 'complete', pid: p.pid }); });
    ev.push({ time: duration, type: 'sim-complete' });
    ev.sort(function (a, b) { return a.time - b.time; });
    return ev;
  }

  function createPlayback(result, options) {
    options = options || {};
    var timer = options.timer || defaultTimer;
    var segments = result.segments;
    var procs = result.processes;
    var algorithm = result.algorithm;
    var duration = result.makespan;

    // Per-process execution segments + cumulative executed time, for O(log n) lookups.
    var byPid = {};
    procs.forEach(function (p) { byPid[p.pid] = { segs: [], cum: [] }; });
    segments.forEach(function (s) {
      if (s.type !== 'process' || !byPid[s.pid]) return;
      var rec = byPid[s.pid];
      var prev = rec.cum.length ? rec.cum[rec.cum.length - 1] : 0;
      rec.segs.push({ start: s.start, end: s.end });
      rec.cum.push(prev + (s.end - s.start));
    });

    function executedBefore(pid, t) {
      var rec = byPid[pid];
      if (!rec || !rec.segs.length) return 0;
      var lo = 0, hi = rec.segs.length - 1, idx = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (rec.segs[mid].start < t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (idx < 0) return 0;
      var seg = rec.segs[idx];
      var before = idx > 0 ? rec.cum[idx - 1] : 0;
      return before + Math.max(0, Math.min(seg.end, t) - seg.start);
    }

    var state = { currentTime: 0, duration: duration, isPlaying: false, speed: options.speed || 1, status: 'ready', runId: 1 };
    var frac = 0;
    var intervalId = null;
    var onChange = null;
    var events = buildEvents(segments, procs, duration);

    var bset = {};
    function addB(x) { if (x >= 0 && x <= duration) bset[x] = 1; }
    addB(0); addB(duration);
    segments.forEach(function (s) { addB(s.start); addB(s.end); });
    procs.forEach(function (p) { addB(p.arrivalTime); addB(p.completionTime); });
    var boundaries = Object.keys(bset).map(Number).sort(function (a, b) { return a - b; });

    function nextBoundary(t) { for (var i = 0; i < boundaries.length; i++) if (boundaries[i] > t) return boundaries[i]; return null; }
    function prevBoundary(t) { var prev = null; for (var i = 0; i < boundaries.length; i++) { if (boundaries[i] < t) prev = boundaries[i]; else break; } return prev; }

    function orderReady(ready, t) {
      function key(p) {
        if (algorithm === 'fcfs') return [p.arrivalTime, p.index, p.pid];
        if (algorithm === 'sjf') return [p.burstTime, p.arrivalTime, p.index, p.pid];
        if (algorithm === 'srtf') return [p.remaining, p.arrivalTime, p.index, p.pid];
        if (algorithm === 'priority') return [p.priority, p.arrivalTime, p.index, p.pid];
        var le = p.arrivalTime;
        var rec = byPid[p.pid];
        if (rec) {
          for (var i = 0; i < rec.segs.length; i++) {
            var s = rec.segs[i];
            if (s.end <= t && p.completionTime > s.end && s.end > le) le = s.end;
          }
        }
        var kind = le === p.arrivalTime ? 0 : 1;
        return [le, kind, p.arrivalTime, p.index, p.pid];
      }
      return ready.slice().sort(function (a, b) {
        var ka = key(a), kb = key(b);
        for (var i = 0; i < Math.max(ka.length, kb.length); i++) {
          var x = ka[i] == null ? 0 : ka[i], y = kb[i] == null ? 0 : kb[i];
          if (x !== y) return x - y;
        }
        return 0;
      });
    }

    function reconstruct(t) {
      t = clamp(Math.round(t), 0, duration);
      var active = null;
      for (var i = 0; i < segments.length; i++) {
        var s = segments[i];
        if (s.start <= t && t < s.end) { active = s; break; }
      }
      var cpuState = active ? active.type : (t >= duration ? 'done' : 'idle');
      var running = (active && active.type === 'process') ? active.pid : null;

      var ps = procs.map(function (p, idx) {
        var remaining = p.burstTime - executedBefore(p.pid, t);
        var arrived = p.arrivalTime <= t;
        var completed = p.completionTime <= t;
        var status = !arrived ? 'not-arrived' : completed ? 'completed' : (running === p.pid ? 'running' : 'ready');
        return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority,
          completionTime: p.completionTime, index: idx, remaining: remaining, status: status };
      });

      var ready = orderReady(ps.filter(function (p) { return p.status === 'ready'; }), t);
      return {
        time: t, running: running, cpuState: cpuState, processes: ps,
        readyQueue: ready.map(function (p) { return p.pid; }),
        notArrived: ps.filter(function (p) { return p.status === 'not-arrived'; }).map(function (p) { return p.pid; }),
        completed: ps.filter(function (p) { return p.status === 'completed'; }).map(function (p) { return p.pid; })
      };
    }

    /* ---- timer / emit ---- */
    function emit() { if (onChange) onChange(getState(), reconstruct(state.currentTime)); }
    function stopTimer() { if (intervalId != null) { timer.clearInterval(intervalId); intervalId = null; } }

    function finish() {
      stopTimer();
      state.isPlaying = false;
      state.currentTime = duration;
      state.status = 'complete';
      emit();
    }

    function play() {
      if (state.status === 'disposed') return;
      if (state.status === 'complete') { state.currentTime = 0; frac = 0; state.status = 'ready'; }
      if (state.isPlaying) return; // never create a second timer
      state.isPlaying = true;
      state.status = 'playing';
      var last = timer.now();
      intervalId = timer.setInterval(function () {
        var now = timer.now();
        var dtMs = now - last; last = now;
        frac += dtMs * state.speed * SCALE;
        var moved = false;
        while (frac >= 1 && state.currentTime < state.duration) { state.currentTime++; frac -= 1; moved = true; }
        if (state.currentTime >= state.duration) { frac = 0; finish(); return; }
        if (moved) emit();
      }, TICK_MS);
      emit();
    }

    function pause() {
      if (!state.isPlaying) return;
      stopTimer();
      state.isPlaying = false;
      state.status = (state.currentTime >= state.duration) ? 'complete' : 'paused';
      emit();
    }

    // Step advances exactly one simulation-time unit, not an event jump.
    function stepForward() {
      stopTimer(); state.isPlaying = false;
      state.currentTime = clamp(state.currentTime + 1, 0, state.duration);
      state.status = state.currentTime >= state.duration ? 'complete' : 'paused';
      emit();
    }

    function stepBackward() {
      stopTimer(); state.isPlaying = false;
      state.currentTime = clamp(state.currentTime - 1, 0, state.duration);
      state.status = state.currentTime <= 0 ? 'ready' : 'paused';
      emit();
    }

    function seek(t) {
      stopTimer(); state.isPlaying = false;
      state.currentTime = clamp(Math.round(t), 0, state.duration);
      state.status = state.currentTime >= state.duration ? 'complete' : (state.currentTime <= 0 ? 'ready' : 'paused');
      emit();
    }

    function reset() {
      stopTimer(); state.isPlaying = false;
      state.currentTime = 0; frac = 0;
      state.status = 'ready';
      emit();
    }

    function setSpeed(s) { state.speed = SPEEDS.indexOf(s) >= 0 ? s : 1; }

    function dispose() {
      stopTimer();
      state.isPlaying = false;
      state.status = 'disposed';
      state.runId++;
      onChange = null;
    }

    function getState() {
      return { currentTime: state.currentTime, duration: state.duration, isPlaying: state.isPlaying,
        speed: state.speed, status: state.status, runId: state.runId };
    }

    return {
      play: play, pause: pause, stepForward: stepForward, stepBackward: stepBackward,
      seek: seek, reset: reset, dispose: dispose, setSpeed: setSpeed,
      getState: getState, snapshot: function () { return reconstruct(state.currentTime); },
      reconstruct: reconstruct, getBoundaries: function () { return boundaries.slice(); },
      getEvents: function () { return events.slice(); },
      set onChange(fn) { onChange = fn; },
      _timerActive: function () { return intervalId != null; }
    };
  }

  window.playback = { createPlayback: createPlayback, SPEEDS: SPEEDS };
})();
