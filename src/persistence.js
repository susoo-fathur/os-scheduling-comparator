/* OS Scheduling Comparator — browser-local persistence (pure logic, injectable storage).
   One namespaced key per concern:
     csl.experiments.v2 — recorded experiments (simulation | comparison | benchmark)
     csl.datasets.v1    — saved datasets
     csl.active.v1      — active dataset + run settings
   Safety rules:
     - corrupt storage is NEVER auto-wiped; the in-memory collection stays empty and
       lastError explains the problem (the user decides whether to clear);
     - write failures (quota) keep the in-memory data and report it is not permanent;
     - schema v1 records are migrated on read (result unavailable -> marked outdated);
     - importing/adding validates before committing; a bad record is rejected whole.
   Records store a deep clone of the dataset + config + result snapshot, so later
   edits to the active dataset never change recorded history. */
(function () {
  'use strict';
  var scheduler = window.scheduler;

  var KEY = 'csl.experiments.v2';
  var KEY_V1 = 'csl.experiments.v1';
  var KEY_DATASETS = 'csl.datasets.v1';
  var KEY_ACTIVE = 'csl.active.v1';
  var SCHEMA_VERSION = 2;
  var LIMITS = { MAX_NAME: 80, MAX_RECORDS: 100, MAX_DATASETS: 50, MAX_ACTIVE_BYTES: 4 * 1024 * 1024 };
  var KINDS = ['simulation', 'comparison', 'benchmark'];
  var ALGOS = ['fcfs', 'sjf', 'srtf', 'priority', 'rr'];

  function isInt(n) { return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n; }
  function now() { return Date.now(); }
  function newId(prefix) { return (prefix || 'rec') + '-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function cloneProc(p) { return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority }; }
  function cloneDeep(x) { return JSON.parse(JSON.stringify(x)); }
  function toMs(t) {
    if (isInt(t) && t >= 0) return t;
    if (typeof t === 'string') { var p = Date.parse(t); if (!isNaN(p)) return p; }
    return null;
  }

  function validateDataset(procs, allowEmpty) {
    if (!Array.isArray(procs)) return { ok: false, error: 'Dataset must be an array of processes.' };
    if (!allowEmpty && procs.length === 0) return { ok: false, error: 'Dataset is empty.' };
    var seen = {};
    for (var i = 0; i < procs.length; i++) {
      var p = procs[i];
      if (!p || typeof p !== 'object') return { ok: false, error: 'Process at index ' + i + ' is invalid.' };
      if (!isInt(p.pid)) return { ok: false, error: 'Process pid must be an integer.' };
      if (seen[p.pid]) return { ok: false, error: 'Duplicate PID: ' + p.pid + '.' };
      seen[p.pid] = 1;
      if (!isInt(p.arrivalTime) || p.arrivalTime < 0) return { ok: false, error: 'Process ' + p.pid + ': invalid arrivalTime.' };
      if (!isInt(p.burstTime) || p.burstTime < 1) return { ok: false, error: 'Process ' + p.pid + ': invalid burstTime.' };
      if (!isInt(p.priority) || p.priority < 1) return { ok: false, error: 'Process ' + p.pid + ': invalid priority.' };
    }
    return { ok: true, value: procs.map(cloneProc) };
  }

  function validateConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Configuration is missing.' };
    if (ALGOS.indexOf(cfg.algorithm) < 0) return { ok: false, error: 'Unknown algorithm: ' + cfg.algorithm };
    var pm = cfg.priorityMode == null ? 'non-preemptive' : cfg.priorityMode;
    if (pm !== 'non-preemptive' && pm !== 'preemptive') return { ok: false, error: 'Invalid priorityMode.' };
    var q = cfg.quantum == null ? 2 : cfg.quantum;
    if (!isInt(q) || q < 1) return { ok: false, error: 'Quantum must be a positive integer.' };
    var ctx = cfg.contextSwitchCost == null ? 0 : cfg.contextSwitchCost;
    if (!isInt(ctx) || ctx < 0) return { ok: false, error: 'Context-switch cost must be a non-negative integer.' };
    return { ok: true, value: { algorithm: cfg.algorithm, priorityMode: pm, quantum: q, contextSwitchCost: ctx } };
  }

  function validateResult(r) {
    if (!r || typeof r !== 'object') return false;
    if (!Array.isArray(r.processes) || !Array.isArray(r.segments)) return false;
    if (!isInt(r.makespan) || r.makespan < 1) return false;
    for (var i = 0; i < r.processes.length; i++) {
      var p = r.processes[i];
      if (!isInt(p.pid) || !isInt(p.completionTime) || !isInt(p.startTime)) return false;
    }
    for (var j = 0; j < r.segments.length; j++) {
      var s = r.segments[j];
      if (!isInt(s.start) || !isInt(s.end) || s.end <= s.start) return false;
    }
    return true;
  }

  function validateRecord(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Record is not an object.' };
    if (typeof raw.id !== 'string' || !raw.id) return { ok: false, error: 'Record id is missing.' };
    if (KINDS.indexOf(raw.kind) < 0) return { ok: false, error: 'Unknown record kind: ' + raw.kind };
    var name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return { ok: false, error: 'Record name cannot be empty.' };
    if (name.length > LIMITS.MAX_NAME) return { ok: false, error: 'Record name is too long (max ' + LIMITS.MAX_NAME + ').' };
    var created = toMs(raw.createdAt);
    var updated = toMs(raw.updatedAt == null ? raw.createdAt : raw.updatedAt);
    if (created == null || updated == null) return { ok: false, error: 'Record timestamps are invalid.' };
    var cf = validateConfig(raw.config);
    if (!cf.ok) return { ok: false, error: cf.error };
    var ds = raw.dataset == null ? { ok: true, value: null } : validateDataset(raw.dataset, raw.kind === 'benchmark');
    if (!ds.ok) return { ok: false, error: ds.error };
    var rec = {
      id: raw.id, kind: raw.kind, name: name, createdAt: created, updatedAt: updated,
      schemaVersion: SCHEMA_VERSION, engineVersion: isInt(raw.engineVersion) ? raw.engineVersion : null,
      dataset: ds.value, config: cf.value
    };
    if (raw.kind === 'simulation') {
      if (raw.result != null) {
        if (!validateResult(raw.result)) return { ok: false, error: 'Simulation result snapshot is malformed.' };
        rec.result = raw.result;
      } else rec.result = null;
    } else if (raw.kind === 'comparison') {
      var cmp = raw.comparison;
      if (!cmp || !Array.isArray(cmp.runs)) return { ok: false, error: 'Comparison snapshot is missing.' };
      rec.comparison = cmp;
    } else {
      var b = raw.benchmark;
      if (!b || !Array.isArray(b.cells)) return { ok: false, error: 'Benchmark snapshot is missing.' };
      rec.benchmark = b;
    }
    return { ok: true, value: rec };
  }

  function lsAdapter() {
    try {
      if (typeof localStorage === 'undefined') return null;
      localStorage.getItem('__osc_probe__');
      return {
        getItem: function (k) { return localStorage.getItem(k); },
        setItem: function (k, v) { localStorage.setItem(k, v); },
        removeItem: function (k) { localStorage.removeItem(k); }
      };
    } catch (e) { return null; }
  }

  function createPersistence(storage) {
    var records = [];
    var datasets = [];
    var active = null;
    var lastError = null;

    function readJSON(key) {
      if (!storage) return { ok: false, missing: true };
      var raw;
      try { raw = storage.getItem(key); } catch (e) { return { ok: false, error: 'Could not read ' + key + '.' }; }
      if (raw == null) return { ok: false, missing: true };
      try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: 'Stored data in ' + key + ' is corrupt and was not deleted.' }; }
    }

    function load() {
      if (!storage) { lastError = 'Local storage is unavailable — history and datasets will not persist across reloads.'; return; }
      var r = readJSON(KEY);
      if (r.ok) {
        var parsed = r.value;
        if (!parsed || !Array.isArray(parsed.records)) { lastError = 'Saved history has an unexpected shape. It was not deleted.'; }
        else {
          var bad = 0;
          parsed.records.forEach(function (raw) {
            var v = validateRecord(raw);
            if (v.ok) records.push(v.value); else bad++;
          });
          if (bad) lastError = bad + ' saved record(s) were invalid and skipped (not deleted).';
        }
      } else if (r.error) lastError = r.error;
      else {
        // Schema v1 migration: dataset + config snapshots, no result -> outdated.
        var v1 = readJSON(KEY_V1);
        if (v1.ok && v1.value && Array.isArray(v1.value.experiments)) {
          v1.value.experiments.forEach(function (e) {
            var migrated = validateRecord({
              id: e.id || newId('exp'), kind: 'simulation', name: e.name || 'Imported experiment',
              createdAt: e.createdAt, updatedAt: e.updatedAt, engineVersion: 1,
              dataset: e.dataset, config: e.config, result: null
            });
            if (migrated.ok) records.push(migrated.value);
          });
          if (records.length) lastError = records.length + ' legacy record(s) migrated from schema v1; results must be recomputed.';
        }
      }
      var d = readJSON(KEY_DATASETS);
      if (d.ok && d.value && Array.isArray(d.value.datasets)) {
        d.value.datasets.forEach(function (x) {
          var v = validateDataset(x.processes, false);
          if (v.ok && typeof x.name === 'string' && x.name.trim()) {
            datasets.push({ id: typeof x.id === 'string' ? x.id : newId('ds'), name: x.name.trim().slice(0, LIMITS.MAX_NAME), createdAt: toMs(x.createdAt) || now(), processes: v.value });
          }
        });
      }
      var a = readJSON(KEY_ACTIVE);
      if (a.ok && a.value && a.value.dataset) {
        var av = validateDataset(a.value.dataset, true);
        var ac = validateConfig(a.value.config || {});
        if (av.ok && ac.ok) active = { dataset: av.value, config: ac.value, meta: a.value.meta || null, savedAt: a.value.savedAt || null };
      }
    }

    function persistKey(key, payload) {
      if (!storage) { lastError = 'Local storage is unavailable — changes are in memory only.'; return false; }
      try {
        var raw = JSON.stringify(payload);
        if (key === KEY_ACTIVE && raw.length > LIMITS.MAX_ACTIVE_BYTES) { lastError = 'Active dataset is too large to persist.'; return false; }
        storage.setItem(key, raw);
        return true;
      } catch (e) {
        lastError = 'Could not write ' + key + ': ' + (e && e.message ? e.message : 'storage write failed') + '. Changes remain in memory for this session.';
        return false;
      }
    }
    function persistRecords() { return persistKey(KEY, { schemaVersion: SCHEMA_VERSION, records: records }); }
    function persistDatasets() { return persistKey(KEY_DATASETS, { schemaVersion: 1, datasets: datasets }); }

    load();

    function indexOf(id) { for (var i = 0; i < records.length; i++) if (records[i].id === id) return i; return -1; }

    function addRecord(raw) {
      if (records.length >= LIMITS.MAX_RECORDS) return { ok: false, error: 'History limit reached (' + LIMITS.MAX_RECORDS + ' records). Delete old records first.' };
      var candidate = Object.assign({}, raw, {
        id: raw.id || newId(raw.kind || 'rec'),
        createdAt: raw.createdAt || now(),
        updatedAt: now(),
        schemaVersion: SCHEMA_VERSION,
        engineVersion: scheduler ? scheduler.ENGINE_VERSION : null
      });
      var v = validateRecord(candidate);
      if (!v.ok) return { ok: false, error: v.error };
      records.unshift(v.value); // newest first
      var persisted = persistRecords();
      return { ok: true, id: v.value.id, persisted: persisted, error: persisted ? null : lastError };
    }

    function remove(id) {
      var i = indexOf(id);
      if (i < 0) return { ok: false, error: 'Record not found.' };
      records.splice(i, 1);
      return { ok: true, persisted: persistRecords() };
    }

    function clearAll() {
      records = [];
      datasets = [];
      active = null;
      var ok = true;
      if (storage) {
        try { storage.removeItem(KEY); storage.removeItem(KEY_DATASETS); storage.removeItem(KEY_ACTIVE); }
        catch (e) { ok = false; lastError = 'Could not clear stored data: ' + (e && e.message ? e.message : 'storage error'); }
      } else ok = false;
      return { ok: ok, persisted: ok };
    }

    function get(id) { var i = indexOf(id); return i >= 0 ? cloneDeep(records[i]) : null; }
    function list(kind) {
      return records.filter(function (r) { return !kind || r.kind === kind; })
        .slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    }

    /* ---- saved datasets ---- */
    function saveDataset(name, processes) {
      if (datasets.length >= LIMITS.MAX_DATASETS) return { ok: false, error: 'Saved-dataset limit reached (' + LIMITS.MAX_DATASETS + ').' };
      var n = typeof name === 'string' ? name.trim() : '';
      if (!n) return { ok: false, error: 'Dataset name cannot be empty.' };
      if (n.length > LIMITS.MAX_NAME) return { ok: false, error: 'Dataset name is too long.' };
      var v = validateDataset(processes, false);
      if (!v.ok) return { ok: false, error: v.error };
      var ds = { id: newId('ds'), name: n, createdAt: now(), processes: v.value };
      datasets.unshift(ds);
      return { ok: true, id: ds.id, persisted: persistDatasets() };
    }
    function listDatasets() { return datasets.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }); }
    function getDataset(id) { for (var i = 0; i < datasets.length; i++) if (datasets[i].id === id) return cloneDeep(datasets[i]); return null; }
    function deleteDataset(id) {
      var before = datasets.length;
      datasets = datasets.filter(function (d) { return d.id !== id; });
      if (datasets.length === before) return { ok: false, error: 'Dataset not found.' };
      return { ok: true, persisted: persistDatasets() };
    }

    /* ---- active dataset + settings ---- */
    function saveActive(payload) {
      var v = validateDataset(payload.dataset, true);
      if (!v.ok) return { ok: false, error: v.error };
      var c = validateConfig(payload.config || {});
      if (!c.ok) return { ok: false, error: c.error };
      active = { dataset: v.value, config: c.value, meta: payload.meta || null, savedAt: now() };
      return { ok: true, persisted: persistKey(KEY_ACTIVE, { schemaVersion: 1, dataset: active.dataset, config: active.config, meta: active.meta, savedAt: active.savedAt }) };
    }
    function loadActive() { return active ? cloneDeep(active) : null; }

    function storageAvailable() { return !!storage; }

    return {
      addRecord: addRecord, remove: remove, clearAll: clearAll, get: get, list: list,
      saveDataset: saveDataset, listDatasets: listDatasets, getDataset: getDataset, deleteDataset: deleteDataset,
      saveActive: saveActive, loadActive: loadActive,
      get lastError() { return lastError; }, clearLastError: function () { lastError = null; },
      storageAvailable: storageAvailable,
      KEY: KEY, SCHEMA_VERSION: SCHEMA_VERSION, LIMITS: LIMITS
    };
  }

  window.persistence = {
    createPersistence: createPersistence,
    create: function () { return createPersistence(lsAdapter()); },
    SCHEMA_VERSION: SCHEMA_VERSION, LIMITS: LIMITS,
    validateRecord: validateRecord, validateDataset: validateDataset, validateConfig: validateConfig
  };
})();
