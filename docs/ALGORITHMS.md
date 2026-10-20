# Scheduling algorithms and measurement reference

This reference describes behavior in `src/scheduler.js`, `src/comparison.js`, and `src/benchmark.js`. Integer time units are used throughout. Timeline intervals are half-open `[start, end)`; idle and context-switch periods are explicit segments.

## Selection and preemption

- FCFS: among arrived processes, choose earliest arrival. Run to completion.
- SJF: among arrived processes, choose smallest burst time. Run to completion; later arrivals do not interrupt.
- SRTF: choose smallest remaining time. Reconsider at each process arrival and completion. Preempt only when another ready process has strictly smaller remaining time; equal remaining time keeps current process.
- Priority (non-preemptive): at dispatch choose lowest numeric priority among arrived processes; run to completion.
- Priority (preemptive): choose lowest numeric priority. Preempt only when another ready process has strictly smaller priority number; equal priority keeps current process.
- Round Robin: FIFO ready queue. Run queue head for `min(Time Quantum, remaining time)`. A positive integer Time Quantum is required. Incomplete process returns to queue tail after its slice.

FCFS, SJF, and non-preemptive Priority do not preempt. SRTF and preemptive Priority are event-driven preemptive policies. Round Robin preempts at quantum boundaries. Priority 1 outranks 2. For non-RR selection, ties are ordered lexicographically by `[primaryValue, arrivalTime, inputIndex, pid]`, ascending. For RR, arrivals are ordered by `[arrivalTime, inputIndex, pid]` and appended FIFO.

At an RR boundary, arrivals with arrival time `<=` boundary are enqueued before the unfinished process is appended to queue tail. An arrival exactly at a running process completion becomes eligible at the next dispatch. When no process is ready, timeline includes idle interval up to next arrival; all algorithms start scheduling from `t=0`.

## Context-switch count and optional overhead

`contextSwitchCost` is a non-negative integer, default `0`. With zero cost, a context switch is counted for each adjacent transition between different process PIDs; initial dispatch, idle-to-process, and repeated same-PID slices do not count. Idle breaks transition counting.

With positive cost, one real `context-switch` segment is charged only after a process directly yields to a different selected process. No charge before first dispatch, after idle, or when same process resumes. No process executes during overhead; arrivals retain their arrival time and scheduler reevaluates at overhead end. One charge covers that reevaluation even if it selects a different process; if it selects previous PID again, overhead was spent but no process-to-process switch is counted. Each emitted context-switch segment counts once. Overhead contributes to makespan, not productive execution, burst, or idle time.

## Metric formulas

For process `i` with arrival `Aᵢ`, burst `Bᵢ`, first execution start `Sᵢ`, and completion `Cᵢ`:

- Turnaround: `TATᵢ = Cᵢ − Aᵢ`
- Waiting: `WTᵢ = TATᵢ − Bᵢ`
- Response: `RTᵢ = Sᵢ − Aᵢ`
- Average metric: sum of per-process values divided by process count.
- Makespan: maximum segment end; schedule begins at `t=0`, so initial CPU idle is included.
- Executed time: total duration of process segments (equals sum of bursts).
- CPU utilization: executed time / makespan. Overhead and idle are excluded from numerator.
- Throughput: completed process count / makespan.
- Idle time: total idle-segment duration.
- Overhead time: total context-switch-segment duration.
- Context switches: number of direct different-PID process transitions when cost is zero; otherwise number of context-switch segments.

Averages are calculated over completed processes; engine requires every input process to finish before returning a result. Comparison ranking uses competition ranks: ties share rank and subsequent rank skips; lower is preferred for waiting, turnaround, response, makespan, and context-switch count, while higher is preferred for utilization and throughput.

## Benchmark methodology

### Random mode

Default sizes are 10, 50, 100, 250, 500, and 1,000; default is 10 rounds. Each round derives a seed by hashing `baseSeed + ':round:' + zeroBasedRoundIndex`. A single deterministic dataset at largest requested size is generated per round; each requested size takes a prefix of that same dataset. Thus sizes within round are nested, not independent samples. All six configurations run on identical dataset for each size/round. Configurable generator ranges, seed, quantum, and switch cost are stored with result. Limits: 2,000 processes, 100 rounds, and 2,000 total size/round units.

Execution advances one `(round, size)` unit per step, allowing UI progress and cancellation. A cancelled run retains completed units and marks result partial. Failed algorithm runs are tracked, not filled with zero. Per metric, aggregate completed values using arithmetic mean, min, max, and sample standard deviation with denominator `n − 1`; for `n = 1`, standard deviation is `0`. No completed values yield no statistic.

### Saved-dataset mode

Runs six configurations on each distinct saved dataset. Exact process-array signatures identify duplicates, which are skipped. At least two distinct datasets required. Results group by actual dataset size; cases at same size contribute observations to aggregate statistics. These are selected cases, not independent random samples.

## Validation and test coverage

Engine validates non-empty process arrays, unique integer PIDs, non-negative integer arrival times, positive integer bursts and priorities, valid algorithm/mode, positive integer RR quantum, and non-negative integer switch cost. It clones input; simulation does not mutate dataset. Dataset editor applies limits (1–2,000 processes, arrivals 0–10,000, bursts 1–10,000, priorities 1–99).

Run `npm test`. Tests include hand-calculated algorithm fixtures; deterministic ties; preemption and quantum-boundary arrivals; idle gaps; context-switch transitions and arrivals during overhead; segment continuity and total execution invariants; invalid input; comparison ranking and failure isolation; seeded benchmark reproducibility, nested prefixes, cancellation and sample statistics; and reports/persistence behavior. Suites are Node assert-based; app/motion checks use stubbed DOM, not browser automation.
