import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWakeLockHolder, WAKE_HANDOFF_GRACE_MS, type WakeLockLike } from "./wake";

// The document's one Screen Wake Lock holder (operator 2026-10-12, plan L18), driven with a stub
// of navigator.wakeLock and of the page's visibility, as useWakeLock drives it: a lesson running
// holds the lock, a pause lets go, the hand-off to the next ayah keeps it for that page's lesson,
// and a hand-off nobody takes up ends after the grace.

/** navigator.wakeLock, recorded: each request("screen"), each release; `drop()` lets the browser
 *  drop the locks (the page hidden); `refuse` makes requests fail. */
function stubLock() {
  const log: string[] = [];
  const live = new Set<{ released: boolean }>();
  let refuse = false;
  const wakeLock: WakeLockLike = {
    request(type) {
      log.push(`request:${type}`);
      if (refuse) return Promise.reject(new DOMException("refused", "NotAllowedError"));
      const s: { released: boolean; release(): Promise<void> } = {
        released: false,
        release() {
          if (!s.released) {
            s.released = true;
            live.delete(s);
            log.push("release");
          }
          return Promise.resolve();
        },
      };
      live.add(s);
      return Promise.resolve(s);
    },
  };
  return {
    wakeLock,
    log,
    held: () => live.size,
    drop: () => {
      for (const s of [...live]) {
        s.released = true;
        live.delete(s);
        log.push("dropped");
      }
    },
    refuse: (v: boolean) => {
      refuse = v;
    },
  };
}

function setup() {
  const lock = stubLock();
  let visible = true;
  const h = createWakeLockHolder({ wakeLock: () => lock.wakeLock, visible: () => visible });
  return { lock, h, setVisible: (v: boolean) => (visible = v) };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("the wake-lock holder (wake.ts createWakeLockHolder)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a lesson running asks for the screen lock once; another hold while it is held asks for nothing", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    h.hold();
    h.hold();
    await flush();
    expect(lock.log).toEqual(["request:screen"]);
    expect(h.holding()).toBe(true);
  });

  it("a pause lets go at once; resuming asks again", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    h.release();
    expect(lock.log).toEqual(["request:screen", "release"]);
    expect(h.holding()).toBe(false);
    h.hold();
    await flush();
    expect(lock.log).toEqual(["request:screen", "release", "request:screen"]);
  });

  it("the hand-off keeps the lock: the next ayah's page arrives, its lesson runs, and adopts it — no release, no new request", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    h.handOff(); // the ayah's page unmounts, handing off
    h.arrived(); // the next ayah's page mounts
    await vi.advanceTimersByTimeAsync(800); // its lesson starts by itself a moment later
    h.hold();
    await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS * 3);
    expect(lock.log).toEqual(["request:screen"]);
    expect(h.holding()).toBe(true);
  });

  it("a hand-off nobody takes up (the next lesson does not run) is released after the grace from the next page's mount", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    h.handOff();
    await vi.advanceTimersByTimeAsync(3_000); // a slow page change
    h.arrived();
    await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS - 1);
    expect(lock.log).toEqual(["request:screen"]);
    expect(h.holding()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(lock.log).toEqual(["request:screen", "release"]);
    expect(h.holding()).toBe(false);
    // Nothing later brings it back by itself.
    h.visible();
    h.arrived();
    await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS * 2);
    expect(lock.log).toEqual(["request:screen", "release"]);
  });

  it("the next page's lesson paused before the grace ends lets go at once", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    h.handOff();
    h.arrived();
    h.hold();
    h.release();
    expect(lock.log).toEqual(["request:screen", "release"]);
  });

  it("nothing held, nothing handed off: a page view never asks", async () => {
    const { lock, h } = setup();
    h.handOff();
    h.arrived();
    h.visible();
    await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS * 2);
    expect(lock.log).toEqual([]);
  });

  it("hidden: nothing asked for; visible again while a lesson runs: asked for again (browsers drop it on hiding)", async () => {
    const { lock, h, setVisible } = setup();
    setVisible(false);
    h.hold();
    await flush();
    expect(lock.log).toEqual([]);
    setVisible(true);
    h.visible();
    await flush();
    expect(lock.log).toEqual(["request:screen"]);
    setVisible(false);
    lock.drop();
    h.visible(); // a visibilitychange to hidden is not passed on; even if it were, hidden asks nothing
    await flush();
    expect(lock.log).toEqual(["request:screen", "dropped"]);
    setVisible(true);
    h.visible();
    await flush();
    expect(lock.log).toEqual(["request:screen", "dropped", "request:screen"]);
    // Dropped during a hand-off's grace: the next lesson asks again when it runs.
    h.handOff();
    lock.drop();
    h.arrived();
    h.hold();
    await flush();
    expect(lock.log).toEqual(["request:screen", "dropped", "request:screen", "dropped", "request:screen"]);
  });

  it("a refusal is silent and not retried in a loop; the next visible or hold tries again", async () => {
    const { lock, h } = setup();
    lock.refuse(true);
    h.hold();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lock.log).toEqual(["request:screen"]);
    expect(h.holding()).toBe(false);
    lock.refuse(false);
    h.visible();
    await flush();
    expect(lock.log).toEqual(["request:screen", "request:screen"]);
    expect(h.holding()).toBe(true);
  });

  it("let go while the request is still out: the lock that arrives is released at once", async () => {
    const { lock, h } = setup();
    h.hold();
    h.release();
    await flush();
    expect(lock.log).toEqual(["request:screen", "release"]);
    expect(lock.held()).toBe(0);
  });

  it("no Screen Wake Lock API (an older browser): nothing happens, nothing throws", async () => {
    const h = createWakeLockHolder({ wakeLock: () => undefined, visible: () => true });
    expect(() => {
      h.hold();
      h.handOff();
      h.arrived();
      h.visible();
      h.release();
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS * 2);
    expect(h.holding()).toBe(false);
  });
});
