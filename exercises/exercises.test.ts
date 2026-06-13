// ============================================================
// Deno test suite — run: deno task test   (or: deno test -A)
// To check the reference answers instead, change the import
// below from "./exercises.ts" to "./solutions.ts".
// ============================================================
import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { EventEmitter } from "node:events";

import {
  EventBus,
  eventToPromise,
  mapLimit,
  mapParallel,
  mapSeries,
  promisify,
  retry,
  withTimeout,
} from "./exercises.ts";

const delay = <T>(ms: number, v?: T) =>
  new Promise<T>((r) => setTimeout(() => r(v as T), ms));

describe("EX1 promisify", () => {
  test("resolves", async () => {
    const cb = (x: number, cb: (e: Error | null, r?: number) => void) =>
      cb(null, x * 2);
    expect(await promisify(cb)(21)).toBe(42);
  });
  test("rejects on error", async () => {
    const cb = (_x: number, cb: (e: Error | null) => void) =>
      cb(new Error("boom"));
    await expect(promisify(cb)(1)).rejects.toThrow("boom");
  });
});

describe("EX2 mapSeries", () => {
  test("order preserved, runs sequentially", async () => {
    const finished: number[] = [];
    const out = await mapSeries([30, 10, 20], async (ms) => {
      await delay(ms);
      finished.push(ms);
      return ms * 2;
    });
    expect(out).toEqual([60, 20, 40]);
    expect(finished).toEqual([30, 10, 20]); // sequential → input order
  });
});

describe("EX3 mapParallel", () => {
  test("order preserved, runs concurrently", async () => {
    const start = Date.now();
    const out = await mapParallel([50, 50, 50], async (ms) => {
      await delay(ms);
      return ms + 1;
    });
    expect(out).toEqual([51, 51, 51]);
    expect(Date.now() - start).toBeLessThan(120); // parallel ≈ 50ms
  });
});

describe("EX4 mapLimit", () => {
  test("respects limit, preserves order", async () => {
    let active = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      max = Math.max(max, active);
      await delay(20);
      active--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(max).toBeLessThanOrEqual(2);
  });
});

describe("EX5 withTimeout", () => {
  test("resolves fast work", async () => {
    expect(await withTimeout(delay(10, "ok"), 100)).toBe("ok");
  });
  test("rejects slow work", async () => {
    // Use a CANCELLABLE slow op so that when withTimeout rejects at
    // 50ms, we can clear the abandoned 200ms timer — otherwise Deno's
    // leak sanitizer (rightly) complains about the dangling timer.
    let slowTimer: ReturnType<typeof setTimeout>;
    const slow = new Promise<string>((r) => {
      slowTimer = setTimeout(() => r("slow"), 200);
    });
    try {
      await expect(withTimeout(slow, 50)).rejects.toThrow("timeout");
    } finally {
      clearTimeout(slowTimer!);
    }
  });
});

describe("EX6 retry", () => {
  test("succeeds after failures", async () => {
    let calls = 0;
    const result = await retry(async () => {
      calls++;
      if (calls < 3) throw new Error("fail " + calls);
      return "won";
    }, 5);
    expect(result).toBe("won");
    expect(calls).toBe(3);
  });
  test("rejects with last error", async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new Error("err " + calls);
      }, 3),
    ).rejects.toThrow("err 3");
  });
});

describe("EX7 EventBus", () => {
  test("on/emit with args", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on("hi", (a, b) => seen.push([a, b]));
    bus.on("hi", (a) => seen.push(["second", a]));
    bus.emit("hi", 1, 2);
    expect(seen).toEqual([[1, 2], ["second", 1]]);
  });
  test("off removes a listener", () => {
    const bus = new EventBus();
    let count = 0;
    const fn = () => count++;
    bus.on("x", fn);
    bus.emit("x");
    bus.off("x", fn);
    bus.emit("x");
    expect(count).toBe(1);
  });
});

describe("EX8 eventToPromise", () => {
  test("resolves with first emitted arg", async () => {
    const ee = new EventEmitter();
    setTimeout(() => ee.emit("ready", "payload"), 20);
    expect(await eventToPromise<string>(ee, "ready")).toBe("payload");
  });
});
