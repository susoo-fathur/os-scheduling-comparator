/* Educational explanation tests — engine trace, per-process formulas, comparison text.
   Run: node test/explanations.test.js */
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
  require(path.resolve(__dirname, '../src/playback.js'));
  require(path.resolve(__dirname, '../src/comparison.js'));
  require(path.resolve(__dirname, '../src/explanations.js'));
  var store = global.window.store;
  var scheduler = global.window.scheduler;
  var playback = global.window.playback;
  var comparison = global.window.comparison;
  var ex = global.window.explanations;
  var passed = 0;
  function tick() { passed++; }

  function sim(processes, algorithm, opts) {
    opts = opts || {};
    return scheduler.simulate({
      processes: processes, algorithm: algorithm,
      quantum: opts.quantum, priorityMode: opts.priorityMode || 'non-preemptive',
      contextSwitchCost: opts.contextSwitchCost || 0, trace: true, traceLimit: opts.traceLimit
    });
  }
  function preset(id) { return store.PRESETS.filter(function (p) { return p.id === id; })[0]; }
  function presetSim(id, algorithm, opts) {
    var p = preset(id);
    return sim(p.processes.map(function (x) { return Object.assign({}, x); }), algorithm, opts);
  }
  function ofType(result, type) { return result.decisions.filter(function (d) { return d.type === type; }); }
  function texts(result, t) {
    return ex.forTime(result, t).map(function (e) { return e.text + ' ' + (e.tie || ''); }).join(' ');
  }
  function segs(result) { return result.segments.map(function (s) { return (s.pid == null ? s.type : 'P' + s.pid) + ':' + s.start + '-' + s.end; }).join(' '); }

  /* ---------- trace is opt-in and cannot change results ---------- */
  var A = preset('fcfs-vs-sjf').processes;
  [['fcfs', {}], ['sjf', {}], ['srtf', {}], ['priority', { priorityMode: 'non-preemptive' }],
    ['priority', { priorityMode: 'preemptive' }], ['rr', { quantum: 2 }]].forEach(function (c) {
    var base = scheduler.simulate({ processes: A, algorithm: c[0], quantum: c[1].quantum,
      priorityMode: c[1].priorityMode || 'non-preemptive', contextSwitchCost: 0 });
    var traced = sim(A, c[0], c[1]);
    eq(base.decisions, undefined, c[0] + ': no trace unless requested'); tick();
    eq(traced.traceTruncated, false, c[0] + ': trace not truncated'); tick();
    ok(traced.decisions.length > 0, c[0] + ': trace recorded'); tick();
    eq(segs(traced), segs(base), c[0] + ': segments unchanged by trace'); tick();
    eq(JSON.stringify(traced.processes), JSON.stringify(base.processes), c[0] + ': per-process metrics unchanged'); tick();
    eq(JSON.stringify(traced.averages), JSON.stringify(base.averages), c[0] + ': averages unchanged'); tick();
    eq(traced.makespan, base.makespan, c[0] + ': makespan unchanged'); tick();
    eq(traced.idleTime, base.idleTime, c[0] + ': idle unchanged'); tick();
    eq(traced.contextSwitches, base.contextSwitches, c[0] + ': switches unchanged'); tick();
  });

  // Context-switch overhead: trace timestamps land after the overhead, results unchanged.
  var ctxTrace = sim(A, 'fcfs', { contextSwitchCost: 2 });
  var ctxPlain = scheduler.simulate({ processes: A, algorithm: 'fcfs', contextSwitchCost: 2 });
  eq(segs(ctxTrace), segs(ctxPlain), 'trace does not change context-switch segments'); tick();
  eq(JSON.stringify(ctxTrace.averages), JSON.stringify(ctxPlain.averages), 'trace does not change metrics with overhead'); tick();
  eq(ctxTrace.decisions.filter(function (d) { return d.type === 'dispatch'; })[1].time, 12, 'dispatch explanation uses the post-overhead time'); tick();

  // Bounded trace: candidate lists and total records are capped.
  var many = [];
  for (var i = 0; i < 20; i++) many.push({ pid: i + 1, arrivalTime: 0, burstTime: 5, priority: 1 });
  var bounded = sim(many, 'fcfs', { traceLimit: 5 });
  eq(bounded.decisions.length, 5, 'trace limit caps stored decisions'); tick();
  eq(bounded.traceTruncated, true, 'truncation is reported'); tick();
  ok(bounded.decisions[0].candidates.length <= 8, 'candidate list is capped'); tick();
  eq(bounded.decisions[0].readyCount, 20, 'ready count still reports the full queue'); tick();
  eq(segs(bounded), segs(scheduler.simulate({ processes: many, algorithm: 'fcfs' })), 'capped trace does not change the schedule'); tick();

  /* ---------- FCFS ---------- */
  var fcfsA = presetSim('fcfs-vs-sjf', 'fcfs');
  var d0 = fcfsA.decisions[0];
  eq(d0.type, 'dispatch', 'FCFS first decision is a dispatch'); tick();
  eq(d0.time, 0, 'FCFS dispatch at t=0'); tick();
  eq(d0.pid, 1, 'FCFS selects P1'); tick();
  eq(d0.criterion, 'arrival', 'FCFS criterion is arrival order'); tick();
  eq(d0.readyCount, 4, 'FCFS reports four ready candidates'); tick();
  eq(JSON.stringify(d0.candidates.map(function (c) { return c.pid; })), JSON.stringify([1, 2, 3, 4]), 'FCFS candidates in arrival/input order'); tick();
  eq(d0.tieBreak, 'input-order', 'FCFS reports the input-order tie'); tick();
  ok(texts(fcfsA, 0).indexOf('earliest arrival time') >= 0, 'FCFS text names the criterion'); tick();
  ok(texts(fcfsA, 0).indexOf('input order') >= 0, 'FCFS text explains the tie'); tick();
  eq(ofType(fcfsA, 'preempt').length, 0, 'FCFS never preempts'); tick();
  var fcfsC = presetSim('preemptive-priority', 'fcfs');
  var fcfsCont = ofType(fcfsC, 'continue');
  ok(fcfsCont.length >= 1, 'FCFS records arrivals that cannot preempt'); tick();
  eq(fcfsCont[0].time, 2, 'FCFS continuation recorded at the arrival time'); tick();
  eq(fcfsCont[0].reason, 'non-preemptive', 'FCFS continue reason'); tick();
  eq(JSON.stringify(fcfsCont[0].arrived), JSON.stringify([2]), 'FCFS continuation names the arrival'); tick();
  ok(texts(fcfsC, 2).indexOf('non-preemptive') >= 0, 'FCFS continuation text explains the rule'); tick();

  /* ---------- SJF ---------- */
  var sjfA = presetSim('fcfs-vs-sjf', 'sjf');
  eq(sjfA.decisions[0].pid, 4, 'SJF selects P4 first'); tick();
  eq(sjfA.decisions[0].criterion, 'burst', 'SJF criterion is burst time'); tick();
  eq(sjfA.decisions[0].value, 1, 'SJF reports the winning burst'); tick();
  eq(sjfA.decisions[0].tieBreak, null, 'SJF first choice has no tie'); tick();
  ok(texts(sjfA, 0).indexOf('Burst Time (1)') >= 0, 'SJF text names the winning burst'); tick();
  var sjfA3 = sjfA.decisions.filter(function (d) { return d.time === 3; })[0];
  eq(sjfA3.pid, 2, 'SJF selects P2 at t=3'); tick();
  eq(sjfA3.readyCount, 2, 'SJF reports the remaining ready pair'); tick();

  // Tie on burst -> earlier arrival breaks it.
  var tieArrival = sim([
    { pid: 3, arrivalTime: 0, burstTime: 5, priority: 1 },
    { pid: 1, arrivalTime: 1, burstTime: 4, priority: 1 },
    { pid: 2, arrivalTime: 2, burstTime: 4, priority: 1 }
  ], 'sjf');
  var tieD = tieArrival.decisions.filter(function (d) { return d.time === 5; })[0];
  eq(tieD.pid, 1, 'SJF tie selects the earlier arrival'); tick();
  eq(tieD.tieBreak, 'arrival', 'SJF tie break is reported as arrival'); tick();
  ok(texts(tieArrival, 5).indexOf('broken by earlier arrival') >= 0, 'SJF tie text explains arrival order'); tick();

  // Tie on burst and arrival -> input order.
  var tieInput = sim([
    { pid: 1, arrivalTime: 0, burstTime: 4, priority: 2 },
    { pid: 2, arrivalTime: 0, burstTime: 4, priority: 1 }
  ], 'sjf');
  eq(tieInput.decisions[0].tieBreak, 'input-order', 'SJF equal burst and arrival uses input order'); tick();
  ok(texts(tieInput, 0).indexOf('input order') >= 0, 'SJF input-order tie text'); tick();

  /* ---------- SRTF ---------- */
  var srtfB = presetSim('srtf-preemption', 'srtf');
  var pre = ofType(srtfB, 'preempt');
  eq(pre.length, 2, 'SRTF records two preemptions'); tick();
  eq(pre[0].time, 1, 'SRTF first preemption at t=1'); tick();
  eq(pre[0].from, 1, 'SRTF preempts P1'); tick();
  eq(pre[0].pid, 2, 'SRTF runs P2'); tick();
  eq(pre[0].fromValue, 7, 'SRTF compares P1 remaining 7'); tick();
  eq(pre[0].value, 4, 'SRTF compares P2 remaining 4'); tick();
  ok(texts(srtfB, 1).indexOf('P2 preempted P1') >= 0, 'SRTF preemption text names both processes'); tick();
  ok(texts(srtfB, 1).indexOf('Remaining Time (4)') >= 0, 'SRTF preemption text states the shorter remaining time'); tick();
  ok(texts(srtfB, 1).indexOf('remaining time (7)') >= 0, 'SRTF preemption text states the old remaining time'); tick();
  eq(pre[1].time, 2, 'SRTF second preemption at t=2'); tick();
  eq(pre[1].from, 2, 'SRTF preempts P2'); tick();
  eq(pre[1].pid, 3, 'SRTF runs P3'); tick();
  eq(srtfB.decisions.filter(function (d) { return d.time === 2 && d.type === 'dispatch'; })[0].pid, 3, 'SRTF dispatch after preemption selects P3'); tick();
  eq(ex.forTime(srtfB, 2).length, 2, 'SRTF shows the preemption and the dispatch at t=2'); tick();
  eq(ex.forTime(srtfB, 2)[0].title, 'Preemption', 'preemption is shown first'); tick();

  // Equal remaining time: no preemption, explained as a tie.
  var srtfTie = sim([
    { pid: 1, arrivalTime: 0, burstTime: 10, priority: 1 },
    { pid: 2, arrivalTime: 2, burstTime: 8, priority: 1 }
  ], 'srtf');
  var cont = ofType(srtfTie, 'continue')[0];
  ok(!!cont, 'SRTF records a continuation on a remaining-time tie'); tick();
  eq(cont.reason, 'tie-keeps-running', 'SRTF continuation reason is a tie'); tick();
  eq(cont.candidate, 2, 'SRTF tie names the other candidate'); tick();
  eq(cont.candidateValue, 8, 'SRTF tie reports the equal remaining time'); tick();
  ok(texts(srtfTie, 2).indexOf('does not preempt on a tie') >= 0, 'SRTF tie text is explicit'); tick();

  /* ---------- Priority (non-preemptive) ---------- */
  var priNp = presetSim('preemptive-priority', 'priority', { priorityMode: 'non-preemptive' });
  eq(priNp.decisions[0].criterion, 'priority', 'Priority NP criterion is priority'); tick();
  ok(texts(priNp, 0).indexOf('highest priority (3)') >= 0, 'Priority text states the winning priority'); tick();
  ok(texts(priNp, 0).indexOf('Lower numbers represent higher priority') >= 0, 'Priority text states the direction'); tick();
  var npCont = ofType(priNp, 'continue')[0];
  eq(npCont.time, 2, 'Priority NP records the arrival at t=2'); tick();
  eq(npCont.reason, 'non-preemptive', 'Priority NP continuation reason'); tick();
  eq(JSON.stringify(npCont.arrived), JSON.stringify([2]), 'Priority NP names the arriving process'); tick();
  ok(texts(priNp, 2).indexOf('is non-preemptive') >= 0, 'Priority NP text explains why it continued'); tick();
  eq(ofType(priNp, 'preempt').length, 0, 'Priority NP never preempts'); tick();

  /* ---------- Priority (preemptive) ---------- */
  var priP = presetSim('preemptive-priority', 'priority', { priorityMode: 'preemptive' });
  var pPre = ofType(priP, 'preempt')[0];
  eq(pPre.time, 2, 'Priority P preempts at t=2'); tick();
  eq(pPre.from, 1, 'Priority P preempts P1'); tick();
  eq(pPre.pid, 2, 'Priority P runs P2'); tick();
  eq(pPre.fromValue, 3, 'Priority P reports P1 priority 3'); tick();
  eq(pPre.value, 1, 'Priority P reports P2 priority 1'); tick();
  ok(texts(priP, 2).indexOf('strictly higher') >= 0, 'Priority P text states strict preemption'); tick();
  var pCont = ofType(priP, 'continue')[0];
  eq(pCont.time, 3, 'Priority P records the t=3 arrival'); tick();
  eq(pCont.reason, 'still-best', 'Priority P continues because P3 is not higher priority'); tick();
  eq(pCont.candidate, 3, 'Priority P names P3 as the best other candidate'); tick();
  ok(texts(priP, 3).indexOf('no ready process had a higher priority') >= 0, 'Priority P continuation text'); tick();

  /* ---------- Round Robin ---------- */
  var rrD = presetSim('round-robin-quantum', 'rr', { quantum: 2 });
  var quanta = ofType(rrD, 'quantum');
  eq(quanta.length, 3, 'RR records three quantum expiries'); tick();
  eq(quanta[0].time, 2, 'RR first quantum expiry at t=2'); tick();
  eq(quanta[0].pid, 1, 'RR first expiry belongs to P1'); tick();
  eq(quanta[0].remaining, 3, 'RR reports P1 remaining 3'); tick();
  eq(JSON.stringify(quanta[0].queueAfter), JSON.stringify([2, 3, 1]), 'RR requeues P1 behind P2 and P3'); tick();
  eq(JSON.stringify(quanta[1].queueAfter), JSON.stringify([3, 1, 2]), 'RR requeues P2 behind P3 and P1'); tick();
  eq(rrD.decisions[0].criterion, 'rr-queue', 'RR dispatch criterion is queue order'); tick();
  eq(JSON.stringify(rrD.decisions[0].queue.map(function (c) { return c.pid; })), JSON.stringify([1, 2, 3]), 'RR dispatch reports the queue order'); tick();
  ok(texts(rrD, 2).indexOf('time quantum expired') >= 0, 'RR text explains the expiry'); tick();
  ok(texts(rrD, 2).indexOf('end of the ready queue') >= 0, 'RR text explains the requeue'); tick();
  eq(ex.forTime(rrD, 2)[0].title, 'Time quantum expired', 'RR shows the expiry before the next dispatch'); tick();
  var rrNoExpiry = rrD.decisions.filter(function (d) { return d.type === 'quantum' && d.pid === 3; });
  eq(rrNoExpiry.length, 0, 'RR does not record an expiry for a process that completes its slice'); tick();

  /* ---------- CPU idle ---------- */
  var idleE = presetSim('idle-staggered', 'fcfs');
  var idles = ofType(idleE, 'idle');
  eq(idles.length, 3, 'idle preset records three idle gaps'); tick();
  eq(idles[0].time, 0, 'first idle gap starts at 0'); tick();
  eq(idles[0].until, 3, 'first idle gap ends at the next arrival'); tick();
  eq(idles[1].until, 8, 'second idle gap ends at t=8'); tick();
  eq(idles[2].until, 12, 'third idle gap ends at t=12'); tick();
  ok(texts(idleE, 1).indexOf('No process was ready at t=0') >= 0, 'idle text states no process was ready'); tick();
  ok(texts(idleE, 1).indexOf('until the next arrival at t=3') >= 0, 'idle text states the next arrival'); tick();
  eq(ex.forTime(idleE, 1)[0].type, 'idle', 'mid-idle playback shows the idle decision'); tick();
  ['fcfs', 'sjf', 'srtf', 'priority', 'rr'].forEach(function (alg) {
    var r = presetSim('idle-staggered', alg, { quantum: 2, priorityMode: 'preemptive' });
    eq(ofType(r, 'idle').length, 3, alg + ': idle gaps recorded'); tick();
  });

  /* ---------- per-process metric breakdown ---------- */
  var sjfBreak = presetSim('fcfs-vs-sjf', 'sjf');
  var at0 = ex.metricBreakdown(sjfBreak, 0);
  var p1At0 = at0.filter(function (p) { return p.pid === 1; })[0];
  eq(p1At0.status, 'pending', 'P1 is pending at t=0'); tick();
  eq(p1At0.turnaround, null, 'pending process has no turnaround value'); tick();
  eq(p1At0.waiting, null, 'pending process has no waiting value'); tick();
  eq(p1At0.response, null, 'pending process has no response value'); tick();
  var p4At0 = at0.filter(function (p) { return p.pid === 4; })[0];
  eq(p4At0.status, 'in-progress', 'P4 is in progress at t=0'); tick();
  eq(p4At0.response.value, 0, 'P4 response available once started'); tick();
  eq(p4At0.turnaround, null, 'in-progress process has no final turnaround'); tick();

  var at8 = ex.metricBreakdown(sjfBreak, 8);
  var p1At8 = at8.filter(function (p) { return p.pid === 1; })[0];
  eq(p1At8.status, 'in-progress', 'P1 is in progress at t=8'); tick();
  eq(p1At8.response.a, 7, 'P1 response uses first start 7'); tick();
  eq(p1At8.response.b, 0, 'P1 response uses arrival 0'); tick();
  eq(p1At8.response.value, 7, 'P1 response = 7 - 0'); tick();
  eq(p1At8.waiting, null, 'P1 waiting pending until completion'); tick();

  var done = ex.metricBreakdown(sjfBreak, sjfBreak.makespan);
  var p1Done = done.filter(function (p) { return p.pid === 1; })[0];
  eq(p1Done.status, 'completed', 'P1 completed at makespan'); tick();
  eq(p1Done.turnaround.a, 17, 'turnaround uses completion 17'); tick();
  eq(p1Done.turnaround.b, 0, 'turnaround uses arrival 0'); tick();
  eq(p1Done.turnaround.value, 17, 'turnaround = 17 - 0'); tick();
  eq(p1Done.waiting.a, 17, 'waiting uses turnaround 17'); tick();
  eq(p1Done.waiting.b, 10, 'waiting uses burst 10'); tick();
  eq(p1Done.waiting.value, 7, 'waiting = 17 - 10'); tick();
  eq(p1Done.response.value, 7, 'response = 7 - 0'); tick();
  done.forEach(function (p) {
    eq(p.turnaround.value, p.turnaround.a - p.turnaround.b, 'P' + p.pid + ' turnaround formula'); tick();
    eq(p.waiting.value, p.waiting.a - p.waiting.b, 'P' + p.pid + ' waiting formula'); tick();
    eq(p.response.value, p.response.a - p.response.b, 'P' + p.pid + ' response formula'); tick();
  });

  /* ---------- comparison explanations ---------- */
  var cmpA = comparison.runComparison(preset('fcfs-vs-sjf').processes, { quantum: 2, contextSwitchCost: 0 });
  var cfg = { quantum: 2, contextSwitchCost: 0 };
  var awt = ex.compareMetric(cmpA.runs, 'avgWaiting', { config: cfg });
  eq(awt.status, 'tie', 'AWT is reported as a tie on preset A'); tick();
  eq(awt.value, 2.75, 'AWT winning value'); tick();
  eq(awt.winners.length, 2, 'AWT tie has two winners'); tick();
  eq(awt.winners.map(function (w) { return w.label; }).join(' + '), 'SJF + SRTF', 'AWT winners are SJF and SRTF'); tick();
  eq(awt.next.label, 'Priority (NP)', 'AWT next best algorithm'); tick();
  near(awt.difference, 3.25, 'AWT difference to next best'); tick();
  ok(awt.text.indexOf('tied for the lowest Average Waiting Time') >= 0, 'AWT tie text'); tick();
  ok(awt.text.indexOf('2.75 tu') >= 0, 'AWT text states the value'); tick();
  ok(awt.text.indexOf('3.25 tu higher at 6.00 tu') >= 0, 'AWT text states the difference'); tick();
  ok(awt.text.indexOf('this dataset and configuration') >= 0, 'AWT text scopes the conclusion'); tick();
  ok(awt.rule.indexOf('shortest Burst Time') >= 0, 'AWT rule states the SJF rule separately'); tick();

  var atat = ex.compareMetric(cmpA.runs, 'avgTurnaround', { config: cfg });
  eq(atat.status, 'tie', 'ATAT tie'); tick();
  near(atat.value, 7, 'ATAT winning value'); tick();
  var art = ex.compareMetric(cmpA.runs, 'avgResponse', { config: cfg });
  eq(art.status, 'tie', 'ART tie'); tick();
  eq(art.next.label, 'Round Robin', 'ART next best is RR'); tick();
  near(art.difference, 0.25, 'ART difference'); tick();

  var cmpE = comparison.runComparison(preset('idle-staggered').processes, { quantum: 2, contextSwitchCost: 0 });
  var allTie = ex.compareMetric(cmpE.runs, 'avgWaiting', { config: cfg });
  eq(allTie.status, 'tie', 'all-six tie reported as a tie'); tick();
  eq(allTie.winners.length, 6, 'all six algorithms share the AWT tie'); tick();
  ok(allTie.text.indexOf('All 6 algorithms tied at 0.00 tu') >= 0, 'all-six tie text'); tick();

  // Unique winner and difference.
  var unique = comparison.runComparison([
    { pid: 1, arrivalTime: 0, burstTime: 9, priority: 2 },
    { pid: 2, arrivalTime: 1, burstTime: 2, priority: 1 },
    { pid: 3, arrivalTime: 3, burstTime: 5, priority: 3 },
    { pid: 4, arrivalTime: 4, burstTime: 1, priority: 2 }
  ], { quantum: 2, contextSwitchCost: 0 });
  var uw = ex.compareMetric(unique.runs, 'avgWaiting', { config: cfg });
  eq(uw.status, 'ok', 'unique AWT winner'); tick();
  eq(uw.winners.length, 1, 'unique winner count'); tick();
  eq(uw.winners[0].label, 'SRTF', 'SRTF wins AWT on this dataset'); tick();
  near(uw.value, 2.25, 'unique winner value'); tick();
  eq(uw.next.label, 'Priority (P)', 'runner-up for unique winner'); tick();
  near(uw.difference, 2.25, 'unique winner difference'); tick();
  ok(uw.text.indexOf('SRTF achieved the lowest Average Waiting Time') >= 0, 'unique winner text'); tick();
  ok(uw.text.indexOf('2.25 tu higher at 4.50 tu') >= 0, 'unique winner difference text'); tick();

  // Missing / invalid / partial / stale.
  var none = ex.compareMetric([], 'avgWaiting', {});
  eq(none.status, 'unavailable', 'empty comparison is unavailable'); tick();
  var failed = cmpA.runs.map(function (r) { return Object.assign({}, r, { ok: false, error: 'boom' }); });
  eq(ex.compareMetric(failed, 'avgWaiting', {}).status, 'unavailable', 'all-failed comparison is unavailable'); tick();
  var partial = cmpA.runs.map(function (r, i) { return i === 0 ? Object.assign({}, r, { ok: false }) : r; });
  var partialRes = ex.compareMetric(partial, 'avgWaiting', {});
  eq(partialRes.status, 'partial', 'one failed run makes the result partial'); tick();
  ok(partialRes.text.indexOf('Only 5 of 6 algorithms') >= 0, 'partial text counts valid algorithms'); tick();
  eq(ex.compareMetric(cmpA.runs, 'avgWaiting', { stale: true }).status, 'stale', 'stale results are refused'); tick();
  ok(ex.compareMetric(cmpA.runs, 'avgWaiting', { stale: true }).text.indexOf('outdated') >= 0, 'stale text is explicit'); tick();
  eq(ex.compareMetric(cmpA.runs, 'notAMetric', {}).status, 'unavailable', 'unknown metric is unavailable'); tick();
  eq(ex.compareSummary(cmpA.runs, {}).length, 3, 'comparison summary covers the three primary metrics'); tick();

  /* ---------- preset integration ---------- */
  var PRESET_CASES = [
    ['fcfs-vs-sjf', 'fcfs', {}, 'dispatch'],
    ['srtf-preemption', 'srtf', {}, 'preempt'],
    ['preemptive-priority', 'priority', { priorityMode: 'preemptive' }, 'preempt'],
    ['round-robin-quantum', 'rr', { quantum: 2 }, 'quantum'],
    ['idle-staggered', 'fcfs', {}, 'idle']
  ];
  PRESET_CASES.forEach(function (c) {
    var p = preset(c[0]);
    var r = sim(p.processes.map(function (x) { return Object.assign({}, x); }), c[1], c[2]);
    ok(ofType(r, c[3]).length > 0, c[0] + ': produces a ' + c[3] + ' explanation'); tick();
    var seen = {};
    r.decisions.forEach(function (d) {
      if (seen[d.time]) return;
      seen[d.time] = 1;
      var items = ex.forTime(r, d.time);
      ok(items.length > 0, c[0] + ': explanation at t=' + d.time); tick();
      items.forEach(function (it) {
        ok(it.text.length > 10, c[0] + ': explanation text is substantive'); tick();
        ok(it.text.indexOf('undefined') < 0 && it.text.indexOf('NaN') < 0, c[0] + ': no placeholder values'); tick();
      });
    });
    ok(p.description && p.takeaway, c[0] + ': preset educational copy still present'); tick();
  });

  /* ---------- playback preservation ---------- */
  var traced = sim(A, 'srtf');
  var plain = scheduler.simulate({ processes: A, algorithm: 'srtf', contextSwitchCost: 0 });
  var pbTraced = playback.createPlayback(traced, {});
  var pbPlain = playback.createPlayback(plain, {});
  [0, 1, 2, 4, 7, 14].forEach(function (t) {
    var a = pbTraced.reconstruct(t);
    var b = pbPlain.reconstruct(t);
    eq(JSON.stringify(a), JSON.stringify(b), 'playback snapshot unchanged at t=' + t); tick();
  });
  pbTraced.stepForward();
  eq(pbTraced.getState().currentTime, 1, 'Step still advances one time unit with a trace'); tick();
  eq(pbTraced.snapshot().running, pbPlain.reconstruct(1).running, 'running process unchanged'); tick();

  if (fails) { console.error('\n' + fails + ' check(s) failed'); process.exit(1); }
  console.log('\n' + passed + ' checks passed');
  console.log('all explanation checks passed');
})();
