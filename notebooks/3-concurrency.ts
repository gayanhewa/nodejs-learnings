// ============================================================
// 3 · Concurrency
// ============================================================
// Zed REPL: put the cursor in a cell and press ctrl-shift-enter
// to run it. Cells are separated by `// %%`. Output appears
// inline below the cell; the Deno kernel auto-displays each
// cell's final expression.
//
// One-time setup: `deno jupyter --install` (kernel already
// installed on this machine), then set Deno as the TS kernel —
// see .zed/settings.json in this repo.
// ============================================================

// %%
// # 3 · Concurrency
//
// Your JS runs on a **single thread**. Concurrency comes from the **event loop**: many async ops *in flight* at once. Two queues drive ordering:
//
// - **microtasks** — promise callbacks, `queueMicrotask`
// - **macrotasks** — `setTimeout`, `setImmediate`, I/O
//
// After each macrotask the entire microtask queue drains before the next macrotask.

const order: string[] = [];
order.push("1 sync start");
setTimeout(() => order.push("4 setTimeout (macro)"), 0);
queueMicrotask(() => order.push("3 microtask"));
order.push("2 sync end");
// Let both queues flush:
await new Promise((r) => setTimeout(r, 5));
order; // 1, 2, 3, 4

// %%
// ### Blocking the loop is fatal
//
// A long synchronous loop freezes **everything** — no timers, no I/O, no promise resolution.

const events: string[] = [];
setTimeout(() => events.push("timer (was starved during the block)"), 10);
const start = Date.now();
while (Date.now() - start < 50) { /* busy-wait 50ms, blocks the thread */ }
events.push("blocked ~50ms; the 10ms timer could NOT fire until now");
await new Promise((r) => setTimeout(r, 0));
events;

// %%
// ## Orchestration patterns
//
// `delay` simulates async work (network/disk). Compare sequential vs parallel.

function delay<T>(ms: number, v: T) { return new Promise<T>((r) => setTimeout(() => r(v), ms)); }

// sequential — only when each step depends on the last (~150ms)
const s0 = performance.now();
await delay(50, 0); await delay(50, 0); await delay(50, 0);
const seq = Math.round(performance.now() - s0);

// parallel — independent work (~50ms)
const p0 = performance.now();
await Promise.all([delay(50, 0), delay(50, 0), delay(50, 0)]);
const par = Math.round(performance.now() - p0);

`sequential ~${seq}ms vs parallel ~${par}ms`;

// %%
// ## Bounded concurrency (a pool)
//
// Firing 1000 requests at once exhausts sockets/memory. Run at most **N** at a time. This is the everyday batch-job pattern. Results stay in input order.

function delay<T>(ms: number, v: T) { return new Promise<T>((r) => setTimeout(() => r(v), ms)); }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let maxActive = 0, active = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;                 // claim next index
      active++; maxActive = Math.max(maxActive, active);
      results[i] = await fn(items[i], i);
      active--;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { results, maxActive };
}

await mapLimit([1, 2, 3, 4, 5], 2, (n) => delay(30, n * 10));
// maxActive should be 2

// %%
// ## True parallelism — Web Workers / worker threads
//
// Promises give concurrent **I/O** on one thread; they do **not** help CPU-bound work, which blocks the thread. To see why this matters, run the SAME heavy compute two ways and compare.
//
// ### Version 1: inline (blocks the main thread)
//
// We run the heavy loop three times directly on the main thread. To make the blocking *visible*, we also start a timer that ticks every 10ms. While the compute runs, the event loop is stuck, so the timer **cannot fire** — its ticks are starved until the compute finishes.

function heavy(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.sqrt(i) * Math.sin(i);
  return sum;
}

// A probe: this SHOULD tick every 10ms. Count how many times it does.
let ticks = 0;
const probe = setInterval(() => ticks++, 10);

const t0 = performance.now();
const results = [heavy(2e7), heavy(2e7), heavy(2e7)]; // all on the main thread
const elapsed = Math.round(performance.now() - t0);

clearInterval(probe);
// ticks is ~0: the 10ms timer was starved the whole time the loop ran,
// because synchronous CPU work blocks the single thread.
`inline: ~${elapsed}ms, results ${results.length}, timer ticked ${ticks}x while blocked`;

// %%
// ### Version 2: offloaded to Web Workers (main thread stays free)
//
// Same compute, same probe — but each call runs in its own **Worker** thread. Now the main thread is idle while the workers crunch, so the 10ms timer **keeps ticking**. The three computations also run truly in parallel on separate threads, so total time is closer to one computation, not three.
//
// Deno uses the standard **Web Worker** API. *(This cell builds the worker from an in-memory blob, runs it, then cleans up.)*

// Same heavy loop, but as a worker that messages its result back.
const workerSrc = `
  self.onmessage = (e) => {
    let sum = 0;
    for (let i = 0; i < e.data; i++) sum += Math.sqrt(i) * Math.sin(i);
    self.postMessage(sum);
  };
`;
const url = URL.createObjectURL(new Blob([workerSrc], { type: "application/typescript" }));

function runWorker(n: number): Promise<number> {
  return new Promise((resolve) => {
    const w = new Worker(url, { type: "module" });
    w.onmessage = (e) => { resolve(e.data); w.terminate(); };
    w.postMessage(n);
  });
}

// Same probe as the inline version.
let ticks = 0;
const probe = setInterval(() => ticks++, 10);

const t0 = performance.now();
const results = await Promise.all([runWorker(2e7), runWorker(2e7), runWorker(2e7)]);
const elapsed = Math.round(performance.now() - t0);

clearInterval(probe);
URL.revokeObjectURL(url);
// ticks is well above 0 AND elapsed is roughly ONE computation's time,
// not three: the main thread stayed free and the work ran in parallel.
`workers: ~${elapsed}ms, results ${results.length}, timer ticked ${ticks}x while working`;

// %%
// **Read the two outputs side by side.** Inline: the timer ticked ~0 times (event loop frozen) and time is the sum of all three loops. Workers: the timer kept ticking (main thread free) and time is close to a single loop (parallel). That gap is the entire reason worker threads exist.
//
// > Workers have real startup and message-passing cost, so they only pay off for genuinely heavy CPU work. For light tasks the overhead is larger than the savings. For many small tasks, reuse a **pool** of workers instead of spawning one per task.
//
// ## Production patterns: timeout & retry
//
// Copy-paste building blocks for real code.

function delay<T>(ms: number, v?: T) { return new Promise<T>((r) => setTimeout(() => r(v as T), ms)); }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("timeout after " + ms + "ms")), ms));
  return Promise.race([p, timeout]);
}

async function retry<T>(fn: (attempt: number) => Promise<T>, attempts = 3, base = 20): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); }
    catch (e) { last = e; if (i < attempts - 1) await delay(base * 2 ** i); }
  }
  throw last;
}

const timedOut = await withTimeout(delay(200, "slow"), 50).catch((e) => e.message);
let calls = 0;
const recovered = await retry((i) => {
  calls++; // count invocations so the output shows the retry actually happened
  return i < 2 ? Promise.reject(new Error("flaky")) : Promise.resolve("ok@" + i);
}, 5);
// calls === 3: failed at i=0 and i=1, succeeded at i=2.
({ timedOut, recovered, calls });

// %%
// ## Decision cheat-sheet
//
// ```
// One future value?           → Promise / async-await
// Many independent I/O ops?   → Promise.all
// Many, but cap the load?     → bounded pool (mapLimit)
// Some allowed to fail?       → Promise.allSettled
// First success wins?         → Promise.any
// Need a timeout?             → Promise.race
// A stream of pushed events?  → EventEmitter (on/once)
// Bridge events→async/await?  → events.once / events.on
// Heavy CPU computation?      → Worker / worker_threads
// ```
//
// That's the full tour. Practice in **`exercises/`** with `deno task test`.
