// ============================================================
// 2 · Event Emitters
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
// # 2 · Event Emitters
//
// The **publish/subscribe** (observer) pattern. Objects **emit** named events; functions **subscribe** and run when the event fires. Streams, HTTP servers, sockets — all EventEmitters underneath.
//
// We import Node's `events` module — Deno supports Node built-ins via the `node:` prefix.

import EventEmitter from "node:events";

const bus = new EventEmitter();
const log: string[] = [];

// Many listeners per event run in registration order.
bus.on("greet", (name: string) => log.push("A: hello " + name));
bus.on("greet", (name: string) => log.push("B: hi " + name));

bus.emit("greet", "Avindu"); // SYNCHRONOUS — blocks until listeners run
log.push("emit returned (listeners already ran)");
log;

// %%
// ## `once`, multiple args, removal, introspection

import EventEmitter2 from "node:events";
const e = new EventEmitter2();
const log: string[] = [];

e.once("boot", () => log.push("booted (fires once)"));
e.emit("boot"); e.emit("boot"); // 2nd ignored

e.on("order", (id: number, qty: number, item: string) =>
  log.push(`order ${id}: ${qty}x ${item}`));
e.emit("order", 1001, 3, "coffee");

const tick = () => log.push("tick");
e.on("tick", tick); e.emit("tick");
e.off("tick", tick); e.emit("tick"); // removed → no second tick

log.push("events: " + e.eventNames().join(","));
log;

// %%
// ## Building your own emitting class
//
// The idiomatic Node pattern: **extend EventEmitter** so your objects emit domain events. The class doesn't know who's listening — that decoupling is the whole point.

import EventEmitter3 from "node:events";

class JobQueue extends EventEmitter3 {
  private jobs: { id: number; willFail?: boolean }[] = [];
  private processing = false;

  add(job: { id: number; willFail?: boolean }) {
    this.jobs.push(job);
    this.emit("added", job);
    if (!this.processing) this.run();
    return this;
  }
  private async run() {
    this.processing = true;
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      try {
        await new Promise((res, rej) =>
          setTimeout(() => job.willFail ? rej(new Error("job " + job.id + " failed")) : res(0), 20));
        this.emit("success", job);
      } catch (err) {
        this.emit("error", job, err); // domain error (job + err), not the special contract
      }
    }
    this.processing = false;
    this.emit("drain");
  }
}

const trace: string[] = [];
const q = new JobQueue()
  .on("added", (j) => trace.push("+ queued " + j.id))
  .on("success", (j) => trace.push("✓ " + j.id))
  .on("error", (j, e) => trace.push("✗ " + (e as Error).message))
  .on("drain", () => trace.push("drained"));

q.add({ id: 1 }); q.add({ id: 2, willFail: true }); q.add({ id: 3 });
await new Promise((r) => setTimeout(r, 120));
trace;

// %%
// ## The special `error` event
//
// If an emitter emits `"error"` with **no** `error` listener, it **throws** and crashes the process. Always attach one.

import EventEmitter4 from "node:events";
const e = new EventEmitter4();
let handled = "";
e.on("error", (err: Error) => { handled = "handled: " + err.message; });
e.emit("error", new Error("boom")); // safe because we have a listener
handled;

// %%
// ## Bridging events into async/await
//
// `events.once` turns the next emission into an awaitable promise. `events.on` turns a stream of events into an **async iterator** you can `for await` over.

import { on, once } from "node:events";
import EventEmitter5 from "node:events";

// once → await a single event
const e1 = new EventEmitter5();
setTimeout(() => e1.emit("ready", "config-loaded"), 30);
const [payload] = await once(e1, "ready");

// on → consume a stream of events
const e2 = new EventEmitter5();
let n = 0;
const timer = setInterval(() => e2.emit("pulse", ++n), 15);
const pulses: number[] = [];
for await (const [v] of on(e2, "pulse")) {
  pulses.push(v);
  if (v >= 3) { clearInterval(timer); break; }
}

({ payload, pulses });

// %%
// ### Does the loop register a listener per iteration?
//
// No. `on(emitter, name)` is called **once**, before the loop runs, and returns one async iterator. The `for await` loop just pulls values from that single iterator, so exactly **one** listener is attached (regardless of how many times the loop body runs).
//
// Desugared, the loop is:
//
// ```ts
// const it = on(e, "pulse");   // called ONCE, attaches one listener
// while (true) {
//   const { value, done } = await it.next();  // each iteration pulls
//   if (done) break;
//   // ...loop body...
// }
// // it.return() runs on break/throw to detach the listener
// ```
//
// This is **pull-based with buffering**, unlike `e.on("pulse", fn)` which is **push-based**. Internally `on()` registers one listener that pushes each event into a queue; `it.next()` drains that queue (or waits if it is empty). Two consequences:
//
// - Events that fire **while your loop body is busy** are queued, not dropped. A plain `.on()` handler has no such buffer.
// - That queue is **unbounded**, so a producer that outpaces the consumer grows memory. Watch for this in real code.

import { on } from "node:events";
import EventEmitterBuf from "node:events";

// Prove (1) only ONE listener is attached, and (2) events that arrive
// while the loop body is awaiting are BUFFERED, not lost.
const e = new EventEmitterBuf();
const iter = on(e, "pulse");
const listeners = e.listenerCount("pulse"); // 1, not growing per iteration

// Fire 5 pulses quickly, every 10ms.
let n = 0;
const timer = setInterval(() => e.emit("pulse", ++n), 10);

const slowDelay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seen: number[] = [];
for await (const [v] of iter) {
  await slowDelay(40); // body is SLOWER than the producer (10ms)
  seen.push(v);        // yet we still see every value, in order
  if (v >= 5) { clearInterval(timer); break; }
}

// listeners === 1 even though the loop ran 5 times; seen is 1..5 with
// none dropped despite the consumer being 4x slower than the producer.
({ listeners, seen });

// %%
// **Takeaways:** `emit` is synchronous and ignores async-listener completion. Always handle `"error"`. Use `once`/`on` to cross into the promise world. `on()` attaches a single buffering listener (not one per loop turn), so slow consumers queue rather than drop events, but watch that unbounded queue. Watch the *MaxListeners* warning too; it usually means a leak.
//
// Next: **3 · Concurrency**.
