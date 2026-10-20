/* OS Scheduling Comparator — deterministic educational explanations.
   Pure logic, no DOM, no network, no generated text. Every sentence is built from
   the engine's own decision trace or from values the engine already calculated;
   nothing is inferred from the currently displayed process name.

   Decision trace records come from scheduler.simulate({ trace: true }). */
(function () {
  'use strict';
  var comparison = window.comparison;

  function P(pid) { return pid == null ? '—' : 'P' + pid; }
  function tu(n) { return n + ' time unit' + (n === 1 ? '' : 's'); }
  function algoShort(result) {
    if (result.algorithm === 'priority') return 'Priority scheduling';
    return result.algorithm.toUpperCase();
  }
  function criterionLabel(c) {
    if (c === 'arrival') return 'arrival time';
    if (c === 'burst') return 'Burst Time';
    if (c === 'remaining') return 'Remaining Time';
    if (c === 'priority') return 'priority';
    if (c === 'rr-queue') return 'queue position';
    return c;
  }
  function valueLabel(c, v) {
    if (c === 'arrival') return 'arrived ' + v;
    if (c === 'burst') return 'burst ' + v;
    if (c === 'remaining') return 'remaining ' + v;
    if (c === 'priority') return 'priority ' + v;
    return String(v);
  }

  function candidateText(candidates, criterion, opts) {
    opts = opts || {};
    if (!candidates || !candidates.length) return '';
    var shown = candidates.slice(0, opts.max || 5);
    var parts = shown.map(function (c) {
      if (criterion === 'rr-queue') return P(c.pid);
      return P(c.pid) + ' (' + valueLabel(criterion, criterion === 'remaining' ? c.remaining : (criterion === 'burst' ? c.burstTime : (criterion === 'priority' ? c.priority : c.arrivalTime))) + ')';
    });
    var more = candidates.length > shown.length ? ' +' + (candidates.length - shown.length) + ' more' : '';
    return (opts.prefix || 'Ready') + ': ' + parts.join(', ') + more;
  }

  function tieText(d, result) {
    if (!d.tieBreak) return '';
    var label = criterionLabel(d.criterion);
    if (d.tieBreak === 'arrival') return 'A tie on ' + label + ' (' + d.value + ') was broken by earlier arrival time.';
    return 'A tie on ' + label + ' (' + d.value + ') was broken by input order.';
  }

  /* ---------- one decision → one explanation ---------- */
  function build(d, result) {
    var text = '', title = '', detail = '', tie = '';
    var time = d.time;

    if (d.type === 'dispatch') {
      title = 'Dispatch';
      if (d.criterion === 'arrival') {
        text = 'At t=' + time + ', ' + P(d.pid) + ' was selected because it had the earliest arrival time among the ' + d.readyCount + ' ready process' + (d.readyCount === 1 ? '' : 'es') + ' (FCFS).';
        if (d.tieBreak === 'input-order') tie = 'The ready processes arrived together, so input order decided.';
      } else if (d.criterion === 'burst') {
        text = 'At t=' + time + ', ' + P(d.pid) + ' was selected because its Burst Time (' + d.value + ') was the shortest among the ready processes.';
        tie = tieText(d, result);
      } else if (d.criterion === 'remaining') {
        text = 'At t=' + time + ', ' + P(d.pid) + ' was selected because its Remaining Time (' + d.value + ') was the shortest among the ready processes.';
        tie = tieText(d, result);
      } else if (d.criterion === 'priority') {
        text = 'At t=' + time + ', ' + P(d.pid) + ' was selected because it had the highest priority (' + d.value + ') among the ready processes. Lower numbers represent higher priority.';
        tie = tieText(d, result);
      } else {
        text = 'At t=' + time + ', ' + P(d.pid) + ' was selected because it was at the head of the FIFO ready queue.';
        detail = 'Ready queue: ' + (d.queue || []).map(function (c) { return P(c.pid); }).join(', ') + '.';
      }
      if (d.criterion !== 'rr-queue') detail = candidateText(d.candidates, d.criterion);
    } else if (d.type === 'preempt') {
      title = 'Preemption';
      if (d.criterion === 'remaining') {
        text = 'At t=' + time + ', ' + P(d.pid) + ' preempted ' + P(d.from) + ' because its Remaining Time (' + d.value + ') was shorter than ' + P(d.from) + '\'s remaining time (' + d.fromValue + ').';
      } else {
        text = 'At t=' + time + ', ' + P(d.pid) + ' preempted ' + P(d.from) + ' because its priority (' + d.value + ') was strictly higher than ' + P(d.from) + '\'s (' + d.fromValue + '). Lower numbers represent higher priority.';
      }
      detail = candidateText(d.candidates, d.criterion);
    } else if (d.type === 'continue') {
      title = 'No preemption';
      if (d.reason === 'non-preemptive') {
        text = 'At t=' + time + ', ' + P(d.pid) + ' kept the CPU after ' + d.arrived.map(P).join(', ') + ' arrived, because ' + algoShort(result) + ' is non-preemptive: a running process is not interrupted.';
      } else if (d.criterion === 'remaining') {
        if (d.reason === 'tie-keeps-running') {
          text = 'At t=' + time + ', ' + P(d.pid) + ' kept the CPU because ' + P(d.candidate) + '\'s Remaining Time (' + d.candidateValue + ') tied ' + P(d.pid) + '\'s (' + d.value + '); SRTF does not preempt on a tie.';
        } else {
          text = 'At t=' + time + ', ' + P(d.pid) + ' kept the CPU because its Remaining Time (' + d.value + ') was still shorter than the best other candidate, ' + P(d.candidate) + ' (' + d.candidateValue + ').';
        }
      } else {
        if (d.reason === 'tie-keeps-running') {
          text = 'At t=' + time + ', ' + P(d.pid) + ' kept the CPU because ' + P(d.candidate) + '\'s priority (' + d.candidateValue + ') only tied ' + P(d.pid) + '\'s (' + d.value + '); preemption requires a strictly higher priority.';
        } else {
          text = 'At t=' + time + ', ' + P(d.pid) + ' kept the CPU because no ready process had a higher priority than ' + P(d.pid) + ' (' + d.value + ').';
        }
      }
      detail = candidateText(d.candidates, d.criterion);
    } else if (d.type === 'idle') {
      title = 'CPU idle';
      text = 'No process was ready at t=' + time + '. The CPU stays idle until the next arrival at t=' + d.until + '.';
    } else if (d.type === 'quantum') {
      title = 'Time quantum expired';
      text = P(d.pid) + '\'s ' + d.quantum + '-unit time quantum expired at t=' + time + ' with ' + d.remaining + ' unit' + (d.remaining === 1 ? '' : 's') + ' of burst remaining, so ' + P(d.pid) + ' was placed at the end of the ready queue.';
      detail = 'Queue after requeue: ' + (d.queueAfter || []).map(P).join(', ') + '.';
    }
    return { time: time, type: d.type, title: title, text: text, detail: detail, tie: tie };
  }

  function forTime(result, t) {
    var decisions = result && result.decisions;
    if (!decisions || !decisions.length) return [];
    var idx = -1;
    for (var i = 0; i < decisions.length; i++) if (decisions[i].time <= t) idx = i;
    if (idx < 0) return [];
    var time = decisions[idx].time;
    var same = [];
    for (var j = 0; j < decisions.length; j++) if (decisions[j].time === time) same.push(decisions[j]);
    return same.slice(-3).map(function (d) { return build(d, result); });
  }

  /* ---------- per-process metric breakdown ---------- */
  function metricBreakdown(result, time) {
    var t = time == null ? result.makespan : Math.max(0, Math.min(Math.round(time), result.makespan));
    return result.processes.map(function (p) {
      var started = p.startTime <= t;
      var completed = p.completionTime <= t;
      return {
        pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime,
        startTime: p.startTime, completionTime: p.completionTime,
        turnaroundTime: p.turnaroundTime, waitingTime: p.waitingTime, responseTime: p.responseTime,
        started: started, completed: completed,
        status: completed ? 'completed' : started ? 'in-progress' : 'pending',
        turnaround: completed ? { a: p.completionTime, b: p.arrivalTime, value: p.turnaroundTime } : null,
        waiting: completed ? { a: p.turnaroundTime, b: p.burstTime, value: p.waitingTime } : null,
        response: started ? { a: p.startTime, b: p.arrivalTime, value: p.responseTime } : null
      };
    });
  }

  /* ---------- comparison metric explanation ---------- */
  var RULES = {
    fcfs: 'FCFS selects the process that arrived first.',
    sjf: 'SJF selects the ready process with the shortest Burst Time.',
    srtf: 'SRTF selects the shortest Remaining Time and preempts when a strictly shorter candidate arrives.',
    'priority-np': 'Priority (NP) selects the highest-priority ready process and never preempts.',
    'priority-p': 'Priority (P) preempts only for a strictly higher priority (lower number).',
    rr: 'Round Robin runs the head of the FIFO ready queue for at most one quantum.'
  };

  function fmt(metricId, v) { return comparison.formatMetric(metricId, v); }
  function names(list) {
    if (list.length === 1) return list[0];
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function compareMetric(runs, metricId, opts) {
    opts = opts || {};
    var m = comparison.metricById(metricId);
    if (!m) return { status: 'unavailable', metricId: metricId, text: 'Unknown metric.' };
    var base = { metricId: metricId, label: m.label, unit: m.unit, lower: m.lower };
    if (opts.stale) {
      return Object.assign(base, { status: 'stale', text: 'These results are outdated for the current dataset or configuration. Recompute before drawing a conclusion.' });
    }
    if (!Array.isArray(runs) || !runs.length) {
      return Object.assign(base, { status: 'unavailable', text: 'No comparison results are available for ' + m.label + '.' });
    }
    var valid = runs.filter(function (r) {
      return r && r.ok && r.summary && typeof r.summary[metricId] === 'number' && isFinite(r.summary[metricId]);
    });
    if (!valid.length) {
      return Object.assign(base, { status: 'unavailable', text: 'No algorithm produced a valid ' + m.label + ' for this dataset.' });
    }
    if (valid.length < runs.length || valid.length < 2) {
      return Object.assign(base, { status: 'partial', validCount: valid.length, totalCount: runs.length,
        text: 'Only ' + valid.length + ' of ' + runs.length + ' algorithms produced a valid ' + m.label + '. No winner is claimed from partial results.' });
    }

    var best = comparison.bestByMetric(valid, metricId);
    var winners = best.winners;
    var winnerNames = names(winners.map(function (w) { return w.label; }));
    var cfg = opts.config;
    var context = ' on this dataset and configuration' + (cfg && cfg.quantum != null
      ? ' (quantum ' + cfg.quantum + ', context-switch cost ' + (cfg.contextSwitchCost || 0) + ' tu)'
      : '');
    var next = valid.filter(function (r) { return r.summary[metricId] > best.value; })
      .sort(function (a, b) { return a.summary[metricId] - b.summary[metricId]; })[0];
    var difference = next ? next.summary[metricId] - best.value : null;
    var text;

    if (winners.length === valid.length) {
      text = 'All ' + valid.length + ' algorithms tied at ' + fmt(metricId, best.value) + ' ' + m.unit + ' for ' + m.label + context + '.';
    } else if (winners.length > 1) {
      text = winnerNames + ' tied for the lowest ' + m.label + context + ' at ' + fmt(metricId, best.value) + ' ' + m.unit + '.';
      if (next) text += ' The next best, ' + next.label + ', was ' + fmt(metricId, difference) + ' ' + m.unit + ' higher at ' + fmt(metricId, next.summary[metricId]) + ' ' + m.unit + '.';
    } else {
      text = winnerNames + ' achieved the lowest ' + m.label + context + ': ' + fmt(metricId, best.value) + ' ' + m.unit + '.';
      if (next) text += ' The next best, ' + next.label + ', was ' + fmt(metricId, difference) + ' ' + m.unit + ' higher at ' + fmt(metricId, next.summary[metricId]) + ' ' + m.unit + '.';
    }

    var rule = winners.map(function (w) { return RULES[w.id]; }).filter(Boolean).join(' ');
    return Object.assign(base, {
      status: winners.length > 1 ? 'tie' : 'ok',
      value: best.value, winners: winners.map(function (w) { return { id: w.id, label: w.label, value: w.value }; }),
      next: next ? { id: next.id, label: next.label, value: next.summary[metricId] } : null,
      difference: difference, text: text, rule: rule, validCount: valid.length, totalCount: runs.length
    });
  }

  function compareSummary(runs, opts) {
    return ['avgWaiting', 'avgTurnaround', 'avgResponse'].map(function (id) {
      return compareMetric(runs, id, opts);
    });
  }

  window.explanations = {
    forTime: forTime, build: build, metricBreakdown: metricBreakdown,
    compareMetric: compareMetric, compareSummary: compareSummary,
    criterionLabel: criterionLabel, RULES: RULES
  };
})();
