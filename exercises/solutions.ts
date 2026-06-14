// ============================================================
// REFERENCE SOLUTIONS (TypeScript) — peek only after trying.
// To check these pass: temporarily change the import in
// exercises.test.ts from "./exercises" to "./solutions".
// ============================================================

export function promisify<A, R>(
  fn: (arg: A, cb: (err: Error | null, result?: R) => void) => void,
): (arg: A) => Promise<R> {
  return (arg: A) =>
    new Promise<R>((resolve, reject) => {
      fn(arg, (err, result) => (err ? reject(err) : resolve(result as R)));
    });
}

export async function mapSeries<T, R>(
  items: T[],
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) results.push(await fn(item)); // await each before next
  return results;
}

export async function mapParallel<T, R>(
  items: T[],
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  return Promise.all(items.map(fn)); // all at once
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (x: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++; // claim an index
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  // clearTimeout in finally so the losing timer never leaks once
  // the race settles (Deno's test sanitizer flags leaked timers).
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

type Listener = (...args: any[]) => void;
export class EventBus {
  private listeners = new Map<string, Listener[]>();
  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
    return this;
  }
  off(event: string, listener: Listener): this {
    const arr = this.listeners.get(event);
    if (arr) {
      const i = arr.indexOf(listener);
      if (i !== -1) arr.splice(i, 1);
    }
    return this;
  }
  emit(event: string, ...args: any[]): boolean {
    const arr = this.listeners.get(event);
    if (!arr) return false;
    for (const l of [...arr]) l(...args); // copy so off() during emit is safe
    return true;
  }
}

import type { EventEmitter } from "node:events";
export function eventToPromise<T = unknown>(
  emitter: EventEmitter,
  eventName: string,
): Promise<T> {
  return new Promise<T>((resolve) =>
    emitter.once(eventName, (first: T) => resolve(first))
  );
}

export async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  // for await over a ReadableStream drains it chunk by chunk and
  // releases the lock automatically when the stream closes.
  for await (const chunk of stream) out.push(chunk);
  return out;
}

export function mapStream<I, O>(fn: (chunk: I) => O): TransformStream<I, O> {
  return new TransformStream<I, O>({
    transform(chunk, controller) {
      controller.enqueue(fn(chunk)); // one in, one out
    },
  });
}

export function take<T>(
  stream: ReadableStream<T>,
  n: number,
): ReadableStream<T> {
  const reader = stream.getReader();
  let taken = 0;
  return new ReadableStream<T>({
    async pull(controller) {
      if (taken >= n) {
        controller.close();
        await reader.cancel(); // stop pulling from the source
        return;
      }
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      taken++;
      controller.enqueue(value);
      if (taken >= n) {
        controller.close();
        await reader.cancel();
      }
    },
    async cancel() {
      await reader.cancel(); // propagate downstream cancellation upstream
    },
  });
}
