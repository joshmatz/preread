import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollToChange } from "../src/scroll-to-change.ts";

function fixture() {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const view = new EventTarget();
  const feed = {};
  let resize = () => {};
  let observed: unknown;
  let disconnected = false;
  let documentTop = 40_000;
  let scrollY = 0;
  const options: ScrollIntoViewOptions[] = [];
  const target = {
    isConnected: true,
    closest: (selector: string) => (selector === ".review-feed" ? feed : null),
    scrollIntoView: (option: ScrollIntoViewOptions) => {
      options.push(option);
      scrollY = documentTop - 18;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: view });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: unknown) {
        observed = element;
      }
      disconnect() {
        disconnected = true;
      }
    },
  });
  return {
    target: target as unknown as HTMLElement,
    feed,
    options,
    get observed() { return observed; },
    get disconnected() { return disconnected; },
    get viewportTop() { return documentTop - scrollY; },
    growAbove(pixels: number) { documentTop += pixels; },
    resize() { resize(); },
    input(type: string, key?: string) {
      const event = new Event(type);
      if (key) Object.defineProperty(event, "key", { value: key });
      view.dispatchEvent(event);
    },
    restore() {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (originalObserver) Object.defineProperty(globalThis, "ResizeObserver", originalObserver);
      else Reflect.deleteProperty(globalThis, "ResizeObserver");
    },
  };
}

test("a late-file jump follows successive lazy diff and image expansion above it", () => {
  const f = fixture();
  const stop = scrollToChange(f.target);
  try {
    assert.equal(f.observed, f.feed);
    assert.equal(f.viewportTop, 18);
    for (const growth of [5700, 2400, 600]) {
      f.growAbove(growth);
      assert.ok(f.viewportTop > 18);
      f.resize();
      assert.equal(f.viewportTop, 18);
    }
    assert.ok(f.options.every((option) => option.block === "start" && option.behavior === "instant"));
  } finally {
    stop();
    f.restore();
  }
});

test("pointer, wheel, touch and keyboard scrolling release the destination", () => {
  for (const [type, key] of [
    ["wheel"], ["touchstart"], ["pointerdown"],
    ...["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab", "Enter", "Escape"].map((key) => ["keydown", key]),
  ]) {
    const f = fixture();
    const stop = scrollToChange(f.target);
    try {
      f.input(type, key);
      assert.equal(f.disconnected, true, `${type} ${key ?? ""}`);
      f.growAbove(2000);
      f.resize();
      assert.equal(f.viewportTop, 2018);
      assert.equal(f.options.length, 1);
    } finally {
      stop();
      f.restore();
    }
  }
});

test("typing and modifier keys keep the destination stable", () => {
  const f = fixture();
  const stop = scrollToChange(f.target);
  try {
    f.input("keydown", "a");
    f.input("keydown", "Shift");
    f.growAbove(1200);
    f.resize();
    assert.equal(f.viewportTop, 18);
    assert.equal(f.disconnected, false);
  } finally {
    stop();
    f.restore();
  }
});

test("cancelled jumps and removed destinations cannot move a later view", () => {
  for (const remove of [false, true]) {
    const f = fixture();
    const stop = scrollToChange(f.target);
    try {
      if (remove) Object.defineProperty(f.target, "isConnected", { value: false });
      else stop();
      f.growAbove(1200);
      f.resize();
      assert.equal(f.disconnected, true);
      assert.equal(f.viewportTop, 1218);
      assert.equal(f.options.length, 1);
      stop();
    } finally {
      stop();
      f.restore();
    }
  }
});
