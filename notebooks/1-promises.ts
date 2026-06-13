// ============================================================
// 1 · Promises
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
// # 1 · Promises
//
// A **Promise** represents a value that may not be available yet. It is always in one of three states:
//
// - **pending** — not yet settled
// - **fulfilled** — completed, has a value (`resolve` was called)
// - **rejected** — failed, has a reason (`reject` was called)
//
// Once a promise **settles** it never changes state again. That immutability is the core mental model.
//
// > Tip: Run each cell with **ctrl-shift-enter** (Zed). The Deno kernel auto-displays the last expression of a cell.
//
// ## Creating a promise
//
// The executor function runs **immediately** (synchronously). You call `resolve(value)` on success or `reject(error)` on failure.

const coinFlip = new Promise<string>((resolve, reject) => {
  const landed = Math.random() > 0.5 ? "heads" : "tails";
  if (landed === "heads") resolve(landed);
  else reject(new Error("got tails"));
});

// Consuming it: .then on fulfill, .catch on reject, .finally always.
await coinFlip
  .then((r) => "fulfilled: " + r)
  .catch((e) => "rejected: " + e.message);

// %%
// ## Promises are asynchronous
//
// Even an **already-resolved** promise defers its `.then` callback to the microtask queue. Predict the output order before running:

const out: string[] = [];
out.push("A — sync, first");
Promise.resolve("done").then(() => out.push("C — microtask, last"));
out.push("B — sync, second");
// Give the microtask a tick to run, then show the order:
await Promise.resolve();
out; // expect: A, B, C

// %%
// ## Promisifying a timer
//
// This is how you wrap old callback/timer APIs into promises. `delay` is reused throughout this notebook.

function delay<T>(ms: number, value?: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value as T), ms));
}
await delay(100, "resolved after 100ms");

// %%
// ## Chaining & error propagation
//
// Each `.then()` returns a **new** promise. Returning a value passes it down; returning a *promise* pauses the chain until it settles. A `throw` anywhere skips to the nearest `.catch`, then the chain **recovers**.

await Promise.resolve(2)
  .then((n) => n * 10)   // 20
  .then((n) => n + 5)    // 25
  .then((n) => { throw new Error("boom at " + n); })
  .then(() => "SKIPPED") // jumped over
  .catch((e) => "caught: " + e.message)
  .then((msg) => msg + " → chain recovered");

// %%
// ### The "forgot to return" bug
//
// Without `return`, the chain does **not** wait for the inner promise. Watch the timestamps:

const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
await Promise.resolve()
  .then(() => { slow(100); /* BUG: no return → chain does NOT wait */ })
  .then(() => "elapsed ~" + Math.round(performance.now() - t0) + "ms (NOT ~100)");

// %%
// ## async / await
//
// Sugar over promises. An `async` function **always** returns a promise; `await` pauses until a promise settles. Rejections become thrown errors you catch with `try/catch`.

function delay2<T>(ms: number, v?: T) {
  return new Promise<T>((r) => setTimeout(() => r(v as T), ms));
}
async function run() {
  try {
    await delay2(30, "ok");
    throw new Error("something broke");
  } catch (e) {
    return "caught: " + (e as Error).message;
  } finally {
    console.log("finally always runs");
  }
}
await run();

// %%
// ## The sequential-vs-parallel trap
//
// The **#1 async/await performance mistake**. Independent work should not be `await`ed one-by-one.

function delay3<T>(ms: number, v: T) {
  return new Promise<T>((r) => setTimeout(() => r(v), ms));
}

// SLOW: each await waits for the previous (~300ms)
const s0 = performance.now();
await delay3(100, "a"); await delay3(100, "b"); await delay3(100, "c");
const seq = Math.round(performance.now() - s0);

// FAST: all start at once (~100ms)
const p0 = performance.now();
await Promise.all([delay3(100, "a"), delay3(100, "b"), delay3(100, "c")]);
const par = Math.round(performance.now() - p0);

`sequential ~${seq}ms vs parallel ~${par}ms`;

// %%
// ## Combinators — `all` / `allSettled` / `race` / `any`
//
// These combine multiple promises. Picking the right one is half of writing good concurrent code.

function delay4<T>(ms: number, v: T) { return new Promise<T>((r) => setTimeout(() => r(v), ms)); }
function fail(ms: number, m: string) { return new Promise<never>((_, rej) => setTimeout(() => rej(new Error(m)), ms)); }

// all: every result IN ORDER, rejects fast if ANY rejects
const all = await Promise.all([delay4(50, "first"), delay4(10, "third")]);

// allSettled: never rejects, gives every outcome
const settled = await Promise.allSettled([delay4(10, "A"), fail(10, "B exploded")]);

// race: first to settle (success OR failure) — basis of timeouts
const race = await Promise.race([delay4(100, "slow"), delay4(20, "fast")]);

// any: first to SUCCEED; AggregateError only if all fail
const any = await Promise.any([fail(10, "down"), delay4(40, "mirror2 ok")]);

({ all, settled, race, any });

// %%
// ## Pitfalls cheat-sheet
//
// | Bug | Fix |
// |-----|-----|
// | `await` inside a `for` loop for independent work | `Promise.all(items.map(fn))` |
// | `array.forEach(async …)` — does **not** await | `for…of` + await, or `map`+`Promise.all` |
// | Rejected promise with no `.catch` | always handle — Node/Deno crash on unhandled rejection |
// | `throw "string"` | `throw new Error(...)` — strings have no stack |
// | `new Promise((res) => fetch().then(res))` | just `return fetch()` — don't wrap a promise |
//
// You've finished Promises. Next: **2 · Event Emitters**.
