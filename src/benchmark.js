/* OS Scheduling Comparator — benchmark runner (pure logic, no DOM).
   Random benchmark methodology:
     - one base dataset per round, generated from that round's recorded seed;
     - each requested size uses a PREFIX of the base dataset, so sizes within a
       round are nested and reproducible (documented: nested prefixes are not
       independent samples across sizes);
     - all six algorithms run on the exact same dataset for each size/round;
     - different rounds use different derived seeds.
   The runner is chunked: one (round, size) unit per step, so the caller can yield
   to the browser between units. Cancellation keeps completed units and marks the
   result cancelled — partial aggregates are reported as such, never fabricated. */
(function () {
  'use strict';
  var store = window.store;
  var comparison = window.comparison;

  var DEFAULT_SIZES = [10, 50, 100, 250, 500, 1000];
  var DEFAULT_CONFIG = {
    sizes: DEFAULT_SIZES.slice(),
    rounds: 10,
    seed: 'benchmark',
    generator: { arrival: { min: 0, max: 20 }, burst: { min: 1, max: 10 }, priority: { min: 1, max: 5 } },
    quantum: 2,
    contextSwitchCost: 0
  };
  var LIMITS = { MAX_SIZE: 2000, MAX_ROUNDS: 100, MAX_UNITS: 2000 };

  function isInt(n) { return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n; }

  function validateConfig(cfg) {
    cfg = cfg || {};
    var errors = [];
    var sizes = Array.isArray(cfg.sizes) ? cfg.sizes.slice() : null;
    if (!sizes || !sizes.length) errors.push('At least one dataset size is required.');
    else {
      var seen = {};
      for (var i = 0; i < sizes.length; i++) {
        var s = sizes[i];
        if (!isInt(s) || s < 1 || s > LIMITS.MAX_SIZE) errors.push('Dataset size ' + s + ' must be a whole number from 1 to ' + LIMITS.MAX_SIZE + '.');
        else if (seen[s]) errors.push('Duplicate dataset size ' + s + '.');
        else seen[s] = 1;
      }
      sizes.sort(function (a, b) { return a - b; });
    }
    var rounds = cfg.rounds;
    if (!isInt(rounds) || rounds < 1 || rounds > LIMITS.MAX_ROUNDS) errors.push('Rounds must be a whole number from 1 to ' + LIMITS.MAX_ROUNDS + '.');
    var quantum = cfg.quantum;
    if (!isInt(quantum) || quantum < 1) errors.push('Time quantum must be a positive whole number.');
    var ctx = cfg.contextSwitchCost == null ? 0 : cfg.contextSwitchCost;
    if (!isInt(ctx) || ctx < 0) errors.push('Context-switch cost must be a non-negative whole number.');
    var gen = cfg.generator;
    if (!gen) errors.push('Generator ranges are required.');
    else {
      ['arrival', 'burst', 'priority'].forEach(function (k) {
        var r = gen[k];
        if (!r || !isInt(r.min) || !isInt(r.max)) errors.push(k + ' range needs whole-number min and max.');
        else if (r.min < 0 || r.min > r.max) errors.push(k + ' range is invalid.');
      });
      if (gen.burst && isInt(gen.burst.min) && gen.burst.min < 1) errors.push('Burst minimum must be at least 1.');
      if (gen.priority && isInt(gen.priority.min) && gen.priority.min < 1) errors.push('Priority minimum must be at least 1.');
    }
    var seed = cfg.seed == null || String(cfg.seed) === '' ? 'benchmark' : String(cfg.seed);
    if (sizes && rounds && sizes.length * rounds > LIMITS.MAX_UNITS) errors.push('Too many units (' + sizes.length * rounds + '); reduce sizes or rounds.');
    return {
      ok: errors.length === 0, errors: errors,
      value: { sizes: sizes || [], rounds: rounds, seed: seed, generator: gen, quantum: quantum, contextSwitchCost: ctx }
    };
  }

  function roundSeed(baseSeed, round) { return store.hashSeed(String(baseSeed) + ':round:' + round); }

  // Deterministic base dataset for a round: largest requested size.
  function baseDataset(cfg, round) {
    var seed = roundSeed(cfg.seed, round);
    var gen = store.generateDataset({
      count: Math.max.apply(null, cfg.sizes),
      arrival: cfg.generator.arrival,
      burst: cfg.generator.burst,
      priority: cfg.generator.priority,
      seed: seed
    });
    return { processes: gen.processes, seed: seed };
  }

  function stats(values) {
    if (!values.length) return null;
    var n = values.length, sum = 0, min = Infinity, max = -Infinity;
    for (var i = 0; i < n; i++) { var v = values[i]; sum += v; if (v < min) min = v; if (v > max) max = v; }
    var mean = sum / n, sq = 0;
    for (var j = 0; j < n; j++) sq += (values[j] - mean) * (values[j] - mean);
    return { n: n, mean: mean, min: min, max: max, stddev: n > 1 ? Math.sqrt(sq / (n - 1)) : 0 };
  }

  function emptyAccumulator(sizes) {
    var acc = {};
    comparison.ALGORITHMS.forEach(function (a) {
      sizes.forEach(function (size) {
        acc[a.id + '|' + size] = { algoId: a.id, label: a.label, color: a.color, size: size, values: {}, failures: [] };
      });
    });
    return acc;
  }

  function addRun(acc, run, size) {
    var cell = acc[run.id + '|' + size];
    if (!cell) return;
    if (!run.ok) { cell.failures.push(run.error || 'failed'); return; }
    comparison.METRICS.forEach(function (m) {
      if (!cell.values[m.id]) cell.values[m.id] = [];
      cell.values[m.id].push(run.summary[m.id]);
    });
  }

  function cellsFromAccumulator(acc, sizes) {
    var cells = [];
    comparison.ALGORITHMS.forEach(function (a) {
      sizes.forEach(function (size) {
        var c = acc[a.id + '|' + size];
        var metrics = {};
        comparison.METRICS.forEach(function (m) { metrics[m.id] = stats(c.values[m.id] || []); });
        cells.push({
          algoId: a.id, label: a.label, color: a.color, size: size,
          rounds: (c.values[comparison.METRICS[0].id] || []).length,
          failures: c.failures.length, metrics: metrics
        });
      });
    });
    return cells;
  }

  /* Chunked runner. step() executes one (round, size) unit. */
  function createRunner(rawConfig) {
    var v = validateConfig(rawConfig);
    if (!v.ok) throw new Error(v.errors.join(' '));
    var cfg = v.value;
    var acc = emptyAccumulator(cfg.sizes);
    var seeds = [];
    var current = { round: 0, sizeIndex: 0, base: null };
    var cancelled = false, done = false;
    var unitsDone = 0;
    var totalUnits = cfg.sizes.length * cfg.rounds;

    function step() {
      if (done || cancelled) return { done: true, cancelled: cancelled };
      if (current.sizeIndex === 0) {
        var b = baseDataset(cfg, current.round);
        current.base = b.processes;
        seeds[current.round] = b.seed;
      }
      var size = cfg.sizes[current.sizeIndex];
      var prefix = current.base.slice(0, size);
      var cmp = comparison.runComparison(prefix, { quantum: cfg.quantum, contextSwitchCost: cfg.contextSwitchCost });
      cmp.runs.forEach(function (run) { addRun(acc, run, size); });
      unitsDone++;
      current.sizeIndex++;
      if (current.sizeIndex >= cfg.sizes.length) { current.sizeIndex = 0; current.round++; }
      if (current.round >= cfg.rounds) done = true;
      return { done: done, unitsDone: unitsDone, totalUnits: totalUnits, round: current.round, size: size };
    }

    function result() {
      return {
        kind: 'benchmark',
        config: cfg,
        plan: {
          sizes: cfg.sizes.slice(), rounds: cfg.rounds, seeds: seeds.slice(),
          generator: JSON.parse(JSON.stringify(cfg.generator)),
          nested: true,
          note: 'Each size uses a prefix of the round dataset; nested sizes share processes and are not independent samples.'
        },
        completedRounds: Math.min(seeds.length, cfg.rounds),
        unitsDone: unitsDone, totalUnits: totalUnits,
        cancelled: cancelled, complete: done && !cancelled,
        cells: cellsFromAccumulator(acc, cfg.sizes)
      };
    }

    function cancel() { if (!done) cancelled = true; }

    // Convenience driver with an injected scheduler (default setTimeout).
    function start(opts) {
      opts = opts || {};
      var schedule = opts.schedule || function (fn) { return setTimeout(fn, 0); };
      function tick() {
        if (cancelled || done) { if (opts.onDone) opts.onDone(result()); return; }
        var s = step();
        if (opts.onProgress) opts.onProgress(s, result());
        if (s.done) { if (opts.onDone) opts.onDone(result()); return; }
        schedule(tick);
      }
      schedule(tick);
    }

    return { step: step, result: result, cancel: cancel, start: start, isDone: function () { return done; }, isCancelled: function () { return cancelled; } };
  }

  // Synchronous full run (tests / small benchmarks).
  function runSync(rawConfig) {
    var r = createRunner(rawConfig);
    while (!r.isDone()) r.step();
    return r.result();
  }

  /* Manual benchmark: distinct saved datasets, grouped by actual size.
     Identical datasets are skipped (not counted as independent samples), and a
     single distinct dataset is rejected — that case is a Single Experiment. */
  function datasetSignature(procs) {
    return JSON.stringify(procs.map(function (p) { return [p.pid, p.arrivalTime, p.burstTime, p.priority]; }));
  }

  function runManual(datasets, config) {
    config = config || {};
    var quantum = config.quantum, ctx = config.contextSwitchCost == null ? 0 : config.contextSwitchCost;
    if (!isInt(quantum) || quantum < 1) throw new Error('Time quantum must be a positive whole number.');
    if (!isInt(ctx) || ctx < 0) throw new Error('Context-switch cost must be a non-negative whole number.');
    if (!Array.isArray(datasets)) throw new Error('Datasets must be an array.');
    var seen = {}, unique = [], duplicates = 0;
    datasets.forEach(function (d) {
      if (!d || !Array.isArray(d.processes) || !d.processes.length) throw new Error('A selected dataset is empty or invalid.');
      if (d.processes.length > LIMITS.MAX_SIZE) throw new Error('Dataset "' + (d.name || d.id) + '" exceeds the size limit.');
      var sig = datasetSignature(d.processes);
      if (seen[sig]) { duplicates++; return; }
      seen[sig] = 1;
      unique.push(d);
    });
    if (unique.length < 2) throw new Error('Select at least two distinct saved datasets (or use Single Experiment).');
    var sizes = unique.map(function (d) { return d.processes.length; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort(function (a, b) { return a - b; });
    var acc = emptyAccumulator(sizes);
    unique.forEach(function (d) {
      var cmp = comparison.runComparison(d.processes, { quantum: quantum, contextSwitchCost: ctx });
      cmp.runs.forEach(function (run) { addRun(acc, run, d.processes.length); });
    });
    return {
      kind: 'benchmark', manual: true,
      config: { sizes: sizes, rounds: 1, seed: null, generator: null, quantum: quantum, contextSwitchCost: ctx },
      plan: {
        sizes: sizes, rounds: 1, seeds: [], manual: true,
        datasets: unique.map(function (d) { return { id: d.id, name: d.name, size: d.processes.length }; }),
        duplicatesSkipped: duplicates,
        note: 'Manual datasets are distinct cases grouped by size; they are not independent random samples.'
      },
      completedRounds: unique.length, unitsDone: unique.length, totalUnits: unique.length,
      cancelled: false, complete: true,
      cells: cellsFromAccumulator(acc, sizes)
    };
  }

  window.benchmark = {
    createRunner: createRunner, runSync: runSync, runManual: runManual, validateConfig: validateConfig,
    stats: stats, baseDataset: baseDataset, roundSeed: roundSeed, datasetSignature: datasetSignature,
    DEFAULT_CONFIG: DEFAULT_CONFIG, DEFAULT_SIZES: DEFAULT_SIZES, LIMITS: LIMITS
  };
})();
