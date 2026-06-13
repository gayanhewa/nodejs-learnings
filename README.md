# Node.js Async: Promises, Event Emitters, Concurrency & Streams

A hands-on TypeScript curriculum, Deno-only, set up for Zed:

- **Interactive lessons** (`notebooks/`): `.ts` files split into cells you run inline in Zed's REPL.
- **Exercises** (`exercises/`): implement TypeScript stubs, check yourself with Deno's built-in test runner.

The async concepts (promises, the event loop, emitters, streams) are the same across Node, Deno and Bun. This project uses Deno because it has a Jupyter kernel that Zed drives and a built-in test runner, so the whole thing needs one tool.

## One-time setup

This machine already has Deno `2.7.14` and the Deno Jupyter kernel. To reinstall the kernel if needed:

```bash
deno jupyter --install   # idempotent; safe to re-run
```

Zed config lives in `.zed/settings.json`. It sets the Deno LSP for TypeScript and selects the Deno kernel for the REPL. Open the folder in Zed and it picks this up automatically.

## The lessons

| Lesson | Topics |
|--------|--------|
| `notebooks/1-promises.ts` | states, chaining, error propagation, async/await, the sequential-vs-parallel trap, `all`/`allSettled`/`race`/`any`, pitfalls |
| `notebooks/2-event-emitters.ts` | `on`/`once`/`off`/`emit`, extending `EventEmitter`, the special `error` event, bridging events and async/await with `events.once`/`on` |
| `notebooks/3-concurrency.ts` | event loop and microtasks, blocking is fatal, parallel patterns, bounded pools, Web Workers for CPU work, timeout/retry |
| `notebooks/4-streams.ts` | why streams (constant memory), `ReadableStream`/`WritableStream`/`TransformStream`, consuming via `for await` and `getReader()`, `pipeThrough`/`pipeTo`, backpressure, line-by-line processing, `node:stream` interop |

Each prose section is a comment block above the code it explains, so each `// %%` cell is "read the explanation, then run the code." Every code cell is self-contained (it defines the helpers it uses), so you can run cells in any order while exploring.

## How to run a lesson in Zed

The lessons are plain `.ts` files divided into cells by `// %%` marker lines. Zed's built-in Jupyter REPL runs them cell by cell, with output shown inline below each cell.

1. **Open the folder in Zed**: `zed /Users/gayanhewa/Workspace/nodejs-learnings` (or `File > Open`). Opening the folder picks up `.zed/settings.json`, which selects the Deno kernel.
2. **Open a lesson**, e.g. `notebooks/1-promises.ts`.
3. **Put your cursor inside a cell** (any line between two `// %%` markers).
4. **Press `ctrl-shift-enter`** to run that cell (the `repl: run` command). Output appears inline directly below the cell.
   - The Deno kernel auto-displays the cell's last expression, which is why most cells end with a bare value.
   - To run the next cell, move the cursor into it and press `ctrl-shift-enter` again. Work top to bottom the first time through.
5. **Useful REPL commands** (open the command palette with `cmd-shift-p` and type "repl"):
   - `repl: run`: run the current cell (`ctrl-shift-enter`)
   - `repl: clear outputs`: clear all inline outputs
   - `repl: sessions`: see or stop running kernels

The first run of a cell in a session starts the Deno kernel and may download deps, so give it a few seconds. Later runs are instant.

If `ctrl-shift-enter` does nothing, check that the Deno Jupyter kernel is installed (`deno jupyter --install`) and that you opened the folder (not just the single file) so Zed applies `.zed/settings.json`. Confirm the kernel via `repl: sessions`.

### Editing the lessons

The `.ts` lesson files are generated from a single source so they stay consistent. Edit `.tools/lessons.ts`, then:

```bash
deno task cells:build    # regenerate notebooks/*.ts from lessons.ts
deno task cells:verify   # run every code cell under Deno, assert none throw
```

You can also edit the `notebooks/*.ts` directly, but a rebuild overwrites them.

## The exercises

Implement the 8 stubs in `exercises/exercises.ts`, then:

```bash
deno task test           # or: deno test -A exercises/
```

`promisify`, `mapSeries`, `mapParallel`, `mapLimit`, `withTimeout`, `retry`, `EventBus`, `eventToPromise`. Each maps to a concept from the lessons.

Reference answers are in `exercises/solutions.ts`. To check they pass, temporarily change the import at the top of `exercises/exercises.test.ts` from `./exercises.ts` to `./solutions.ts`.

Deno's test runner has a leak sanitizer that fails a test if it leaves a timer dangling. That's deliberate practice here: see `withTimeout`, where you need to `clearTimeout` the losing timer.

## Mental model

Your JavaScript runs on a single thread. Promises and the event loop let many I/O operations be in flight at once without blocking, which is concurrency, not parallelism. Event emitters are the push-based counterpart: you pull a single future value with a promise and subscribe to a stream of events with an emitter. Streams process data incrementally at constant memory with backpressure, so a slow consumer throttles a fast producer. For CPU-bound work that would block the thread, use worker threads or Web Workers for real parallelism. Most of the skill is picking the right one for the problem.

## Decision cheat-sheet

```
One future value?           -> Promise / async-await
Many independent I/O ops?   -> Promise.all
Many, but cap the load?     -> bounded pool (mapLimit)
Some allowed to fail?       -> Promise.allSettled
First success wins?         -> Promise.any
Need a timeout?             -> Promise.race
A stream of pushed events?  -> EventEmitter (on/once)
Bridge events to async?     -> events.once / events.on
Heavy CPU computation?      -> Worker / worker_threads
Large/continuous data?      -> Streams (ReadableStream + pipeThrough)
Need backpressure?          -> Streams (slow consumer throttles producer)
```

## Project layout

```
notebooks/        Deno // %% cell-scripts: study and run inline in Zed
exercises/        TypeScript stubs + Deno test suite + solutions
.tools/           lesson source (lessons.ts) + generator + verifier
.zed/             Zed settings: Deno LSP + Deno REPL kernel
deno.json         tasks (test, cells:build, cells:verify) + imports
```

## Commands

```bash
deno task test           # run the exercise tests
deno task cells:build    # regenerate lesson .ts files from lessons.ts
deno task cells:verify   # verify every lesson cell runs clean
deno fmt                 # format
deno lint                # lint
```
