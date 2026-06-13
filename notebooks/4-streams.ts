// ============================================================
// 4 · Streams
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
// # 4 · Streams
//
// A **stream** processes data **incrementally** — chunk by chunk — instead of loading everything into memory at once. Reading a 4 GB log file into a single string would blow up your heap; streaming it lets you handle it a kilobyte at a time at constant memory.
//
// Three core abstractions, all part of the **Web Streams** standard (built into Deno, browsers, and modern Node):
//
// | Type | Role | You implement |
// |------|------|----------------|
// | `ReadableStream` | **source** — produces chunks | `pull`/`start` |
// | `WritableStream` | **sink** — consumes chunks | `write` |
// | `TransformStream` | **middle** — chunk in → chunk out | `transform` |
//
// The other half of the story is **backpressure**: a slow consumer automatically slows a fast producer, so memory stays bounded. We'll see it in action.
//
// > We use **Web Streams** throughout (the cross-platform standard). `node:stream` interop is covered at the end.
//
// ## Creating a ReadableStream
//
// A source is defined by an object with controller callbacks:
//
// - **`start(controller)`** — runs once; seed initial chunks here.
// - **`pull(controller)`** — called whenever the consumer wants more; enqueue the next chunk. Return a promise to pull asynchronously.
// - **`controller.enqueue(chunk)`** pushes a chunk; **`controller.close()`** ends the stream.
//
// This stream emits the numbers 1..5, one per `pull`.

let next = 1;
const numbers = new ReadableStream<number>({
  pull(controller) {
    if (next > 5) {
      controller.close();
      return;
    }
    controller.enqueue(next++);
  },
});

// Collect the whole stream just to inspect it here.
const collected: number[] = [];
for await (const n of numbers) collected.push(n);
collected; // [1, 2, 3, 4, 5]

// %%
// ## Two ways to consume
//
// A `ReadableStream` is **async-iterable**, so `for await...of` is the easy path. For finer control use a **reader** (`getReader()`): each `read()` returns `{ value, done }`. A reader **locks** the stream so nothing else can read it concurrently; release it with `releaseLock()`.

function makeStream(): ReadableStream<string> {
  const words = ["stream", "data", "incrementally"];
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= words.length) controller.close();
      else controller.enqueue(words[i++]);
    },
  });
}

// Manual reader: explicit read loop until done.
const reader = makeStream().getReader();
const seen: string[] = [];
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  seen.push(value);
}
reader.releaseLock();
seen; // ["stream", "data", "incrementally"]

// %%
// ## TransformStream — chunk in, chunk out
//
// A `TransformStream` has a **writable** side (you write into it) and a **readable** side (transformed chunks come out). The `transform(chunk, controller)` callback runs per chunk and `enqueue`s zero or more outputs. Here we uppercase each word.

const upper = new TransformStream<string, string>({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});

// Write into the writable side...
const writer = upper.writable.getWriter();
(async () => {
  for (const w of ["alpha", "beta", "gamma"]) await writer.write(w);
  await writer.close();
})();

// ...and read transformed chunks off the readable side.
const out: string[] = [];
for await (const c of upper.readable) out.push(c);
out; // ["ALPHA", "BETA", "GAMMA"]

// %%
// ## Composing — `.pipeThrough()` and `.pipeTo()`
//
// This is where streams shine. `source.pipeThrough(transform)` returns a new readable (the transform's output), so you **chain** transforms. `.pipeTo(writable)` drains a readable into a sink and resolves when done — and it wires up backpressure for you.

function digits(): ReadableStream<number> {
  let n = 1;
  return new ReadableStream({
    pull(c) {
      if (n > 4) c.close();
      else c.enqueue(n++);
    },
  });
}

const double = new TransformStream<number, number>({
  transform: (n, c) => c.enqueue(n * 2),
});
const label = new TransformStream<number, string>({
  transform: (n, c) => c.enqueue("#" + n),
});

// Collect results into a sink via a WritableStream.
const sink: string[] = [];
await digits()
  .pipeThrough(double) // 2, 4, 6, 8
  .pipeThrough(label) // "#2", "#4", "#6", "#8"
  .pipeTo(new WritableStream({ write: (chunk) => void sink.push(chunk) }));

sink; // ["#2", "#4", "#6", "#8"]

// %%
// ## Backpressure
//
// A stream has an internal **queue** with a *high-water mark*. If the consumer is slow, that queue fills; the producer's `pull` (or a writer's `write`) is then **not** called again until the consumer drains it. The fast producer is throttled to the slow consumer's pace — memory stays bounded automatically.
//
// Below, the producer wants to push as fast as it can, but the sink takes ~30 ms per chunk. We log the timestamp each time `pull` runs: they're spaced out, proving the producer was held back.

const gaps: number[] = [];
let last = performance.now();
let value = 0;

const fastSource = new ReadableStream<number>({
  pull(controller) {
    const now = performance.now();
    gaps.push(Math.round(now - last)); // time since previous pull
    last = now;
    if (value >= 4) controller.close();
    else controller.enqueue(value++);
  },
}, { highWaterMark: 1 }); // tiny buffer → backpressure kicks in immediately

// Slow sink: ~30ms to "process" each chunk.
const slowSink = new WritableStream<number>({
  async write() {
    await new Promise((r) => setTimeout(r, 30));
  },
}, { highWaterMark: 1 });

await fastSource.pipeTo(slowSink);
// First pull is ~0ms; later pulls are spaced ~30ms by the slow sink.
gaps;

// %%
// ## Practical example — line-by-line text processing
//
// The everyday job: take raw bytes, decode to text, split into **lines**, transform each line. We compose three transforms:
//
// 1. `TextDecoderStream` — bytes → text (built in).
// 2. a custom **line splitter** — buffers partial chunks and emits complete lines (note the `flush` to emit the trailing line).
// 3. a per-line transform — here, number each non-empty line.
//
// This pattern is exactly how you'd stream-parse a large CSV or log file at constant memory.

// Source of raw bytes (as if read from a file/socket), split mid-line on purpose.
const bytes = new ReadableStream<Uint8Array>({
  start(c) {
    const enc = new TextEncoder();
    c.enqueue(enc.encode("alpha\nbe"));
    c.enqueue(enc.encode("ta\ngamma\n"));
    c.enqueue(enc.encode("delta")); // no trailing newline
    c.close();
  },
});

// Stateful splitter: holds a buffer of the partial last line across chunks.
function splitLines(): TransformStream<string, string> {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? ""; // last piece may be incomplete
      for (const line of parts) controller.enqueue(line);
    },
    flush(controller) {
      if (buffer) controller.enqueue(buffer); // emit trailing line
    },
  });
}

let lineNo = 0;
const numberLines = new TransformStream<string, string>({
  transform: (line, c) => c.enqueue(`${++lineNo}: ${line}`),
});

const lines: string[] = [];
await bytes
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(splitLines())
  .pipeThrough(numberLines)
  .pipeTo(new WritableStream({ write: (l) => void lines.push(l) }));

lines; // ["1: alpha", "2: beta", "3: gamma", "4: delta"]

// %%
// ## node:stream interop
//
// Older Node APIs (`fs.createReadStream`, HTTP request/response bodies) use Node's **object-mode / classic** streams, not Web Streams. Bridge between the two worlds with the static helpers on `node:stream`'s `Readable`:
//
// - **`Readable.toWeb(nodeStream)`** → a `ReadableStream` you can `pipeThrough`.
// - **`Readable.fromWeb(webStream)`** → a Node `Readable` for legacy APIs.
//
// (`Writable.toWeb` / `Duplex.toWeb` exist too.) Prefer Web Streams for new code; reach for these only at the boundary with old Node libraries.

import { Readable } from "node:stream";

// A classic Node Readable (push-based, object mode here).
const nodeStream = Readable.from(["one", "two", "three"]);

// Convert it to a Web ReadableStream and consume it the standard way.
const web = Readable.toWeb(nodeStream) as ReadableStream<string>;
const collected: string[] = [];
for await (const chunk of web) collected.push(chunk);

collected; // ["one", "two", "three"]

// %%
// ## Takeaways
//
// - Stream when data is **large or unbounded** — constant memory beats buffering everything.
// - **`ReadableStream`** (source) / **`WritableStream`** (sink) / **`TransformStream`** (middle) are the three building blocks.
// - Consume with `for await...of` (easy) or `getReader()` (manual control; remember `releaseLock`).
// - Compose with **`.pipeThrough(transform)`** and finish with **`.pipeTo(sink)`**.
// - **Backpressure** is automatic — a slow sink throttles a fast source so memory stays bounded.
// - Bridge to legacy Node with **`Readable.toWeb` / `Readable.fromWeb`**, but prefer Web Streams.
//
// That's the tour. Practice in **`exercises/`** with `deno task test`.
