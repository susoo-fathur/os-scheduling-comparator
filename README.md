# OS Scheduling Comparator

OS Scheduling Comparator is a browser-based simulator for exploring how CPU scheduling policies affect process execution and performance metrics. It supports Operating Systems study through reproducible schedules, visual playback, worked scenarios, and side-by-side measurements. It uses vanilla JavaScript and CSS, with no runtime package dependencies or build step.

## Features

- Six scheduling configurations: FCFS, SJF, SRTF, Priority (non-preemptive), Priority (preemptive), and Round Robin.
- Editable manual datasets, deterministic seeded random datasets, saved datasets, and nine built-in presets (including focused teaching scenarios).
- Integer-time simulation with play, pause, step, reset, seek, and adjustable playback speed.
- SVG Gantt timeline, ready-queue and process status details, and per-process metric breakdowns.
- Deterministic explanations generated from scheduling decisions and computed results; no AI or network request.
- Single Experiment comparison of all six configurations over the same dataset, with charts, metric rankings, ties, and per-algorithm details.
- Random and saved-dataset benchmark modes, progress, cancellation, and aggregate statistics.
- Simulation, comparison, and benchmark history; CSV export and browser print (including save as PDF).
- Browser-local persistence for active settings, datasets, and reports; no backend or account.
- Optional integer context-switch overhead, disabled by default.
- Reduced-motion CSS rules for motion effects.
- Midnight Sage × Lavender visual theme.

## Supported algorithms

| Configuration | Selection rule | Preemption |
| --- | --- | --- |
| FCFS (First Come, First Served) | Earliest arrival; ties use input order. | No |
| SJF (Shortest Job First) | Smallest burst among ready processes. | No |
| SRTF (Shortest Remaining Time First) | Smallest remaining burst; equal-value arrival does not preempt running process. | Yes |
| Priority (non-preemptive) | Lowest numeric priority at dispatch. | No |
| Priority (preemptive) | Lowest numeric priority; only strictly higher priority preempts. | Yes |
| Round Robin | FIFO ready queue, bounded by configurable positive integer Time Quantum. | Yes, at quantum expiry |

Priority 1 is higher than priority 2. Exact tie-breaking, queue-boundary behavior, and overhead convention are specified in [docs/ALGORITHMS.md](docs/ALGORITHMS.md).

## Metrics

Per-process metrics use integer time units (tu):

- Turnaround Time (TAT) = completion time − arrival time; lower is better.
- Waiting Time (WT) = TAT − burst time; lower is better.
- Response Time (RT) = first CPU start − arrival time; lower is better.

Comparison and benchmark metrics:

- Average WT, TAT, and RT: arithmetic mean across processes; lower is better.
- CPU Utilization: productive process execution divided by makespan; higher is better. Idle and context-switch overhead are excluded from productive execution.
- Throughput: completed processes divided by makespan; higher is better.
- Makespan: elapsed schedule length from time zero to final completion; lower is better.
- Context Switches: counted process-to-process switches under engine convention; lower is better when switch cost matters.

No algorithm is universally best. Results depend on workload and configuration.

## Getting started

Requirements: Node.js for tests, and Python 3 for the documented local server. No npm packages need installing; `package.json` defines scripts but no dependencies.

From project directory:

```sh
npm start
```

- Open `http://localhost:8080`. `npm start` runs `python3 -m http.server 8080`; alternatively run that command directly. Because app uses classic scripts and no fetch or JavaScript modules, `index.html` can also be opened with `file://`, though a local HTTP server is recommended.

Run tests:

```sh
npm test
```

## Usage guide

1. In Simulate, load an educational preset, edit process rows, or generate a seeded dataset. Save datasets for reuse.
2. Choose scheduling configuration and parameters, then inspect the Gantt chart, ready queue, explanations, and per-process metrics during playback.
3. In Compare, run a Single Experiment to apply all six configurations to same dataset; inspect charts, rankings, ties, and algorithm details.
4. Run random benchmark for seeded nested dataset sizes, or saved-dataset benchmark for distinct saved cases. Use benchmark when comparing behavior across workloads, not as a claim of machine speed.
5. Review recorded results in Reports; export CSV or use browser print / save as PDF.

## Project structure

```text
index.html                 Entry point; classic script order is significant
package.json               start and test scripts; no package dependencies
src/
  state.js                  Dataset validation, seeded generator, presets
  scheduler.js              Scheduling engine and metric calculations
  playback.js               Playback state and timer controller
  comparison.js             Six-config runs, metric rankings, chart data
  explanations.js            Deterministic decision and metric explanations
  benchmark.js              Seeded and saved-dataset benchmark runner/statistics
  persistence.js             Browser localStorage records and saved datasets
  reports.js                 CSV generation
  components.js, viewkit.js  Shared markup, formatting, and chart helpers
  app.js                     Route shell and application controllers
  screen-*.js                Overview, simulation, comparison, and reports screens
  *.css                      Theme tokens, components, shell, and screen styling
test/                        Node assert-based unit, invariant, and stubbed-DOM suites
docs/ALGORITHMS.md            Algorithm rules, formulas, benchmark methodology
```

## Testing

Run `npm test`. At documentation update, all 11 suites passed (1,903 checks); run command again for current result. Suites cover scheduling, dataset state and presets, explanations, playback, comparison, benchmarks, reports, persistence, app smoke behavior, and motion-related DOM updates. App smoke/motion tests use stubbed DOM, not real-browser automation. Node may print an ExperimentalWarning about `localStorage`; tests passed despite warning.

## Limitations and assumptions

- Single CPU, integer time units, positive integer burst and priority, non-negative integer arrival; no I/O bursts, aging, or multiprocessor scheduling.
- Priority range in dataset editor is 1–99; lower number means higher priority.
- Up to 2,000 processes supported by dataset generation/simulation; large editor lists render only first 120 rows.
- Random benchmark uses deterministic derived round seeds and nested prefixes; size groups within one round are not independent samples. See algorithm reference.
- Saved-dataset benchmarks skip exact duplicates and require at least two distinct datasets.
- Browser storage is local to that browser/profile; no sync. Storage can be unavailable or quota-limited, in which case changes may only remain in memory for the session.
- Browser interaction and visual rendering have not been independently verified in this documentation task. Test coverage uses Node and stubbed DOM.
- HTML references Google Fonts, so those fonts require network access; app core has no runtime API/network calls.
