import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWakeLockHolder, WAKE_HANDOFF_GRACE_MS, WAKE_REASK_MIN_HELD_MS, type WakeLockLike } from "./wake";

// The document's one Screen Wake Lock holder (operator 2026-10-12, plan L18), driven with a stub
// of navigator.wakeLock and of the page's visibility, as useWakeLock drives it: a lesson running
// holds the lock, a pause lets go, the hand-off to the next ayah keeps it for that page's lesson,
// and a hand-off nobody takes up ends after the grace.

/** navigator.wakeLock, recorded: each request("screen"), each release; `drop()` lets the browser
 *  drop the locks (the page hidden, or its own reasons); `refuse` makes requests fail. As a
 *  browser's WakeLockSentinel does, a sentinel fires "release" when it ends — by the page's own
 *  release() or by a drop. */
function stubLock() {
  type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: "release", cb: () => void): void; fire(): void };
  const log: string[] = [];
  const live = new Set<Sentinel>();
  let refuse = false;
  const wakeLock: WakeLockLike = {
    request(type) {
      log.push(`request:${type}`);
      if (refuse) return Promise.reject(new DOMException("refused", "NotAllowedError"));
      const listeners: (() => void)[] = [];
      const s: Sentinel = {
        released: false,
        release() {
          if (!s.released) {
            s.released = true;
            live.delete(s);
            log.push("release");
            s.fire();
          }
          return Promise.resolve();
        },
        addEventListener: (_type, cb) => void listeners.push(cb),
        fire: () => listeners.forEach((cb) => cb()),
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
        s.fire();
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

  it("dropped by the browser while the page is visible and a lesson runs: asked for again at once (the sentinel's release event)", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    await vi.advanceTimersByTimeAsync(WAKE_REASK_MIN_HELD_MS);
    lock.drop();
    await flush();
    expect(lock.log).toEqual(["request:screen", "dropped", "request:screen"]);
    expect(h.holding()).toBe(true);
    // …and again later, each time it had been kept a while.
    await vi.advanceTimersByTimeAsync(60_000);
    lock.drop();
    await flush();
    expect(lock.log).toEqual(["request:screen", "dropped", "request:screen", "dropped", "request:screen"]);
    expect(lock.held()).toBe(1);
  });

  it("a lock granted and dropped straight away is NOT asked for again: no loop — the next visible or hold tries", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    await vi.advanceTimersByTimeAsync(WAKE_REASK_MIN_HELD_MS - 1);
    lock.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lock.log).toEqual(["request:screen", "dropped"]);
    expect(h.holding()).toBe(false);
    // A browser that drops every lock it grants: one request per occasion, never a stream of them.
    h.visible();
    await flush();
    lock.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    h.hold();
    await flush();
    lock.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lock.log).toEqual(["request:screen", "dropped", "request:screen", "dropped", "request:screen", "dropped"]);
  });

  it("the re-ask after a drop refused: silent, not repeated", async () => {
    const { lock, h } = setup();
    h.hold();
    await flush();
    await vi.advanceTimersByTimeAsync(WAKE_REASK_MIN_HELD_MS);
    lock.refuse(true);
    lock.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lock.log).toEqual(["request:screen", "dropped", "request:screen"]);
    expect(h.holding()).toBe(false);
  });

  it("the page's own release is not a drop: nothing is asked for again; nor a drop while hidden, or during a hand-off's grace", async () => {
    const { lock, h, setVisible } = setup();
    h.hold();
    await flush();
    await vi.advanceTimersByTimeAsync(WAKE_REASK_MIN_HELD_MS);
    h.release(); // "Jeda": the sentinel fires release too
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lock.log).toEqual(["request:screen", "release"]);
    // Hidden: the browser drops it; asked again only once visible (visible()).
    h.hold();
    await flush();
    await vi.advanceTimersByTimeAsync(WAKE_REASK_MIN_HELD_MS);
    setVisible(false);
    lock.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lock.log).toEqual(["request:screen", "release", "request:screen", "dropped"]);
    setVisible(true);
    h.visible();
    await flush();
    await vi.advanceTimersByTimeAsync(WAKE_REASK_MIN_HELD_MS);
    // The hand-off's grace: no lesson runs just now; the next lesson's hold() asks.
    h.handOff();
    lock.drop();
    await flush();
    expect(lock.log).toEqual(["request:screen", "release", "request:screen", "dropped", "request:screen", "dropped"]);
    h.arrived();
    h.hold();
    await flush();
    expect(lock.log).toHaveLength(7);
    expect(h.holding()).toBe(true);
  });

  it("a released lock's own release event arriving late (browsers fire it after the fact) does not disturb the lock taken since", async () => {
    // Sentinels whose "release" event the test fires.
    const log: string[] = [];
    const sentinels: { released: boolean; fire: () => void }[] = [];
    const wakeLock: WakeLockLike = {
      request() {
        log.push("request");
        const listeners: (() => void)[] = [];
        const s = {
          released: false,
          release() {
            if (!s.released) {
              s.released = true;
              log.push("release");
            }
            return Promise.resolve();
          },
          addEventListener: (_type: "release", cb: () => void) => void listeners.push(cb),
          fire: () => listeners.forEach((cb) => cb()),
        };
        sentinels.push(s);
        return Promise.resolve(s);
      },
    };
    const h = createWakeLockHolder({ wakeLock: () => wakeLock, visible: () => true });
    h.hold();
    await flush();
    h.release(); // "Jeda"
    h.hold(); // "Lanjutkan" at once: a second lock
    await flush();
    sentinels[0].fire(); // the first lock's release event, only now
    await flush();
    expect(h.holding()).toBe(true);
    expect(log).toEqual(["request", "release", "request"]);
    // "Jeda" again: the lock held now is the one let go.
    h.release();
    expect(log).toEqual(["request", "release", "request", "release"]);
    expect(sentinels[1].released).toBe(true);
  });

  it("a sentinel without events (an older engine) still holds and lets go", async () => {
    const log: string[] = [];
    const wakeLock: WakeLockLike = {
      request: () => {
        log.push("request");
        const s = { released: false, release: () => ((s.released = true), log.push("release"), Promise.resolve()) };
        return Promise.resolve(s);
      },
    };
    const h = createWakeLockHolder({ wakeLock: () => wakeLock, visible: () => true });
    h.hold();
    await flush();
    expect(h.holding()).toBe(true);
    h.release();
    expect(log).toEqual(["request", "release"]);
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
