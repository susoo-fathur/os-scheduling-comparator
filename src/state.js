/* CPU Scheduling Lab — dataset state manager (pure logic, no DOM).
   Phase 2: single source of truth for the active process set.
   No scheduling algorithms, no metrics, no persistence. */
(function () {
  'use strict';

  /* ---------- Limits (documented in README) ---------- */
  var LIMITS = {
    MIN_PROCESSES: 1,
    MAX_PROCESSES: 2000,
    ARRIVAL_MIN: 0,   ARRIVAL_MAX: 10000,
    BURST_MIN: 1,     BURST_MAX: 10000,
    PRIORITY_MIN: 1,  PRIORITY_MAX: 99
  };

  var PROCESS_PALETTE = ['#6EE7B7', '#C4B5FD', '#7DD3FC', '#FDA4AF', '#FDE68A', '#F0ABFC'];
  function colorForIndex(i) { return PROCESS_PALETTE[((i % PROCESS_PALETTE.length) + PROCESS_PALETTE.length) % PROCESS_PALETTE.length]; }

  /* ---------- Validation ----------
     raw is the user-typed string (or a number). Rejects empty, fractions,
     negatives, signs, and out-of-bounds values. Returns {ok, value|message}. */
  var FIELD_BOUNDS = {
    arrivalTime: { lo: LIMITS.ARRIVAL_MIN, hi: LIMITS.ARRIVAL_MAX, label: 'Arrival', allowZero: true },
    burstTime:   { lo: LIMITS.BURST_MIN,   hi: LIMITS.BURST_MAX,   label: 'Burst',   allowZero: false },
    priority:    { lo: LIMITS.PRIORITY_MIN, hi: LIMITS.PRIORITY_MAX, label: 'Priority', allowZero: false }
  };

  function validateField(field, raw) {
    var b = FIELD_BOUNDS[field];
    if (!b) return { ok: false, message: 'Unknown field.' };
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { ok: false, message: 'Required.' };
    // Whole, non-negative integers only: no sign, no decimal point, no exponent.
    if (!/^\d+$/.test(s)) return { ok: false, message: 'Whole numbers only — no fractions, signs, or text.' };
    var n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, message: 'Not a valid number.' };
    if (!b.allowZero && n < b.lo) return { ok: false, message: b.label + ' must be at least ' + b.lo + '.' };
    if (b.allowZero && n < b.lo) return { ok: false, message: b.label + ' cannot be below ' + b.lo + '.' };
    if (n > b.hi) return { ok: false, message: b.label + ' cannot exceed ' + b.hi + '.' };
    return { ok: true, value: n };
  }

  function validateProcess(p) {
    var fields = ['arrivalTime', 'burstTime', 'priority'];
    var errors = {};
    for (var i = 0; i < fields.length; i++) {
      var r = validateField(fields[i], p[fields[i]]);
      if (!r.ok) errors[fields[i]] = r.message;
    }
    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  /* ---------- Seeded PRNG (mulberry32) + string seed hashing ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
    var s = String(seed);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }

  /* ---------- Generator ---------- */
  function validateGeneratorConfig(cfg) {
    var errors = [];
    if (!cfg) return { ok: false, errors: ['Missing configuration.'] };
    var c = Number(cfg.count);
    if (!Number.isInteger(c) || c < LIMITS.MIN_PROCESSES || c > LIMITS.MAX_PROCESSES)
      errors.push('Process count must be a whole number from ' + LIMITS.MIN_PROCESSES + ' to ' + LIMITS.MAX_PROCESSES + '.');
    function rangeErr(r, lo, hi, label, minFloor) {
      if (!r || !Number.isInteger(r.min) || !Number.isInteger(r.max)) { errors.push(label + ' range needs whole-number min and max.'); return; }
      var effMin = (minFloor != null ? Math.max(minFloor, r.min) : r.min);
      if (r.min < lo) errors.push(label + ' range min cannot be below ' + lo + '.');
      if (minFloor != null && r.min < minFloor) errors.push(label + ' range min must be at least ' + minFloor + '.');
      if (r.max > hi) errors.push(label + ' range max cannot exceed ' + hi + '.');
      if (effMin > r.max) errors.push(label + ' range min must not exceed max.');
    }
    if (!cfg.arrival) errors.push('Arrival range required.'); else rangeErr(cfg.arrival, LIMITS.ARRIVAL_MIN, LIMITS.ARRIVAL_MAX, 'Arrival');
    if (!cfg.burst) errors.push('Burst range required.'); else rangeErr(cfg.burst, LIMITS.BURST_MIN, LIMITS.BURST_MAX, 'Burst', LIMITS.BURST_MIN);
    if (!cfg.priority) errors.push('Priority range required.'); else rangeErr(cfg.priority, LIMITS.PRIORITY_MIN, LIMITS.PRIORITY_MAX, 'Priority');
    return { ok: errors.length === 0, errors: errors };
  }

  function generateDataset(cfg) {
    var v = validateGeneratorConfig(cfg);
    if (!v.ok) throw new Error(v.errors.join(' '));
    var seed = (cfg.seed != null && String(cfg.seed) !== '') ? hashSeed(cfg.seed) : (Math.random() * 4294967296) >>> 0;
    var rng = mulberry32(seed);
    var count = Math.max(LIMITS.MIN_PROCESSES, Math.min(LIMITS.MAX_PROCESSES, Number(cfg.count)));
    var arr = [];
    for (var i = 0; i < count; i++) {
      arr.push({
        pid: i + 1,
        arrivalTime: randInt(rng, cfg.arrival.min, cfg.arrival.max),
        burstTime: randInt(rng, Math.max(LIMITS.BURST_MIN, cfg.burst.min), cfg.burst.max),
        priority: randInt(rng, cfg.priority.min, cfg.priority.max)
      });
    }
    return { processes: arr, seed: seed };
  }

  /* ---------- Presets (real input datasets, not simulation results) ---------- */
  var DEFAULT_GENERATOR = { count: 12, arrival: { min: 0, max: 20 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 } };
  var PRESETS = [
    {
      id: 'small-demo', name: 'Small demo',
      description: '3 processes — classic textbook mix.',
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 },
        { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1 },
        { pid: 3, arrivalTime: 2, burstTime: 8, priority: 3 }
      ]
    },
    {
      id: 'same-arrival', name: 'Same arrival',
      description: '4 processes all arrive at t=0.',
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 7, priority: 3 },
        { pid: 2, arrivalTime: 0, burstTime: 4, priority: 1 },
        { pid: 3, arrivalTime: 0, burstTime: 1, priority: 4 },
        { pid: 4, arrivalTime: 0, burstTime: 4, priority: 2 }
      ]
    },
    {
      id: 'varied-arrival', name: 'Varied arrival',
      description: '5 processes with staggered arrivals.',
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 6, priority: 2 },
        { pid: 2, arrivalTime: 2, burstTime: 4, priority: 1 },
        { pid: 3, arrivalTime: 4, burstTime: 3, priority: 3 },
        { pid: 4, arrivalTime: 6, burstTime: 5, priority: 2 },
        { pid: 5, arrivalTime: 8, burstTime: 2, priority: 1 }
      ]
    },
    {
      id: 'mixed', name: 'Mixed burst & priority',
      description: '5 processes with wide spread of burst and priority.',
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 10, priority: 5 },
        { pid: 2, arrivalTime: 1, burstTime: 2, priority: 1 },
        { pid: 3, arrivalTime: 3, burstTime: 6, priority: 9 },
        { pid: 4, arrivalTime: 5, burstTime: 1, priority: 1 },
        { pid: 5, arrivalTime: 6, burstTime: 8, priority: 3 }
      ]
    },

    /* Teaching scenarios. Descriptions and takeaways were verified against the
       engine (all six algorithms, q=2, contextSwitchCost=0) — see test/presets.test.js. */
    {
      id: 'fcfs-vs-sjf', name: 'FCFS vs SJF — waiting time',
      description: 'Four jobs arrive together with bursts 10, 4, 2 and 1, so input order and shortest-first order produce very different queues.',
      takeaway: 'FCFS averages 10.00 waiting units, SJF only 2.75 on this workload — but SJF needs burst times in advance and can postpone long jobs.',
      suggested: { algorithm: 'sjf' },
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 10, priority: 3 },
        { pid: 2, arrivalTime: 0, burstTime: 4, priority: 2 },
        { pid: 3, arrivalTime: 0, burstTime: 2, priority: 1 },
        { pid: 4, arrivalTime: 0, burstTime: 1, priority: 4 }
      ]
    },
    {
      id: 'srtf-preemption', name: 'SRTF — preemption',
      description: 'P1 starts alone at t=0, then shorter jobs arrive at t=1 and t=2 and become better candidates.',
      takeaway: 'SRTF interrupts P1 at t=1 and P2 at t=2; P1 resumes at t=7, so one process owns several timeline slices and averages 2.67 waiting units.',
      suggested: { algorithm: 'srtf' },
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 8, priority: 3 },
        { pid: 2, arrivalTime: 1, burstTime: 4, priority: 2 },
        { pid: 3, arrivalTime: 2, burstTime: 2, priority: 1 }
      ]
    },
    {
      id: 'preemptive-priority', name: 'Preemptive Priority',
      description: 'P1 runs at priority 3; P2 (priority 1) arrives at t=2 and interrupts it, while P3 (priority 2) arrives at t=3 and does not.',
      takeaway: 'Lower numbers mean higher priority: only a strictly higher-priority arrival preempts, so P2 finishes before P3 and P1 resumes last.',
      suggested: { algorithm: 'priority', priorityMode: 'preemptive' },
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 7, priority: 3 },
        { pid: 2, arrivalTime: 2, burstTime: 3, priority: 1 },
        { pid: 3, arrivalTime: 3, burstTime: 2, priority: 2 }
      ]
    },
    {
      id: 'round-robin-quantum', name: 'Round Robin — time quantum',
      description: 'Three jobs arrive together and rotate through 2-unit slices, so unfinished jobs return to the back of the ready queue.',
      takeaway: 'P1, P2, P3 run in FIFO rotation; P3 finishes first at t=6 and P1 needs three slices. Try q=1 or q=4 to see the quantum trade-off.',
      suggested: { algorithm: 'rr', quantum: 2 },
      processes: [
        { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2 },
        { pid: 2, arrivalTime: 0, burstTime: 4, priority: 1 },
        { pid: 3, arrivalTime: 0, burstTime: 2, priority: 3 }
      ]
    },
    {
      id: 'idle-staggered', name: 'CPU idle & staggered arrivals',
      description: 'Jobs arrive at t=3, t=8 and t=12, so the CPU has nothing to run for long stretches.',
      takeaway: 'Idle gaps are real timeline segments: 9 of 15 time units are idle, makespan is 15 and CPU utilization is only 40%.',
      suggested: null,
      processes: [
        { pid: 1, arrivalTime: 3, burstTime: 2, priority: 2 },
        { pid: 2, arrivalTime: 8, burstTime: 1, priority: 1 },
        { pid: 3, arrivalTime: 12, burstTime: 3, priority: 3 }
      ]
    }
  ];

  function cloneProc(p) { return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority }; }
  function cloneList(arr) { return arr.map(cloneProc); }

  /* ---------- Store ---------- */
  var state = { processes: cloneList(PRESETS[0].processes) };
  var nextPid = 1;
  function recomputeNextPid() {
    var max = 0;
    for (var i = 0; i < state.processes.length; i++) if (state.processes[i].pid > max) max = state.processes[i].pid;
    nextPid = max + 1;
  }
  recomputeNextPid();

  var listeners = [];
  function subscribe(fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function notify() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  function getState() { return state; }
  function getCount() { return state.processes.length; }
  function getProcess(pid) {
    for (var i = 0; i < state.processes.length; i++) if (state.processes[i].pid === pid) return state.processes[i];
    return null;
  }

  function addProcess() {
    if (state.processes.length >= LIMITS.MAX_PROCESSES)
      return { ok: false, error: 'Maximum of ' + LIMITS.MAX_PROCESSES + ' processes reached.' };
    var pid = nextPid++; // monotonic: never reuses a removed pid
    state.processes.push({ pid: pid, arrivalTime: 0, burstTime: 1, priority: 1 });
    notify();
    return { ok: true, pid: pid };
  }

  // Commits only valid values; returns {ok, error} so the UI can show live errors.
  function updateProcess(pid, field, raw) {
    var p = getProcess(pid);
    if (!p) return { ok: false, error: 'Process not found.' };
    var r = validateField(field, raw);
    if (!r.ok) return { ok: false, error: r.message };
    p[field] = r.value;
    notify();
    return { ok: true };
  }

  function removeProcess(pid) {
    var before = state.processes.length;
    state.processes = state.processes.filter(function (p) { return p.pid !== pid; });
    if (state.processes.length !== before) { notify(); return { ok: true }; }
    return { ok: false, error: 'Process not found.' };
  }

  function clearAll() { state.processes = []; notify(); return { ok: true }; }

  function resetDefault() { state.processes = cloneList(PRESETS[0].processes); recomputeNextPid(); notify(); return { ok: true }; }

  function replaceAll(newProcesses) {
    if (!Array.isArray(newProcesses)) return { ok: false, error: 'Invalid dataset.' };
    if (newProcesses.length > LIMITS.MAX_PROCESSES) return { ok: false, error: 'Dataset exceeds the limit of ' + LIMITS.MAX_PROCESSES + ' processes.' };
    var seen = {};
    for (var i = 0; i < newProcesses.length; i++) {
      var p = newProcesses[i];
      var v = validateProcess(p);
      if (!v.ok) return { ok: false, error: 'Invalid process (pid ' + p.pid + '): ' + Object.keys(v.errors).map(function (k) { return k + ' ' + v.errors[k]; }).join('; ') };
      if (seen[p.pid]) return { ok: false, error: 'Duplicate PID ' + p.pid + '.' };
      seen[p.pid] = 1;
    }
    state.processes = cloneList(newProcesses);
    recomputeNextPid();
    notify();
    return { ok: true };
  }

  function loadPreset(id) {
    var p = presetById(id);
    if (!p) return { ok: false, error: 'Unknown preset.' };
    return replaceAll(p.processes);
  }

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  // True when the active dataset is exactly the preset's dataset (order included),
  // so the UI can skip the replace confirmation when nothing would be lost.
  function matchesPreset(id) {
    var p = presetById(id);
    if (!p || state.processes.length !== p.processes.length) return false;
    for (var i = 0; i < p.processes.length; i++) {
      var a = state.processes[i], b = p.processes[i];
      if (a.pid !== b.pid || a.arrivalTime !== b.arrivalTime || a.burstTime !== b.burstTime || a.priority !== b.priority) return false;
    }
    return true;
  }

  function loadGenerated(cfg) {
    try {
      var gen = generateDataset(cfg);
      var r = replaceAll(gen.processes);
      return r.ok ? { ok: true, seed: gen.seed } : r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  window.store = {
    LIMITS: LIMITS,
    PROCESS_PALETTE: PROCESS_PALETTE,
    PRESETS: PRESETS,
    DEFAULT_GENERATOR: DEFAULT_GENERATOR,
    hashSeed: hashSeed,
    colorForIndex: colorForIndex,
    validateField: validateField,
    validateProcess: validateProcess,
    validateGeneratorConfig: validateGeneratorConfig,
    generateDataset: generateDataset,
    getState: getState,
    getCount: getCount,
    getProcess: getProcess,
    addProcess: addProcess,
    updateProcess: updateProcess,
    removeProcess: removeProcess,
    clearAll: clearAll,
    resetDefault: resetDefault,
    replaceAll: replaceAll,
    loadPreset: loadPreset,
    matchesPreset: matchesPreset,
    loadGenerated: loadGenerated,
    subscribe: subscribe
  };
})();
