"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RESOLUTIONS, workingResolution, createWorkingCrop, calculatePinCoords, linePixels, createGenerator, artworkSVG, stepsText } = require("./string-art.js");

const options = { numPins: 10, numChords: 100, lineWeight: 20, darkMode: false };

test("initial UI selects 1K and its canvas and badge match that default", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const html = readFileSync(join(__dirname, "index.html"), "utf8");
  assert.match(html, /<option value="1024" selected>/);
  assert.doesNotMatch(html, /<option value="500" selected>/);
  assert.match(html, /id="art-canvas" width="1024" height="1024"/);
  assert.match(html, /id="resolutionState"[^>]*>1024 &times; 1024</);
});

test("working resolution accepts only the four selectable presets", () => {
  assert.deepEqual(RESOLUTIONS, [500, 1024, 2048, 4096]);
  for (const size of RESOLUTIONS) assert.equal(workingResolution(String(size)), size);
  for (const value of [0, "", null, NaN, 501, 8192, "invalid"]) {
    assert.throws(() => workingResolution(value), /working resolution/);
  }
});

test("each preset generates at its actual pixel resolution and exports matching geometry", () => {
  for (const size of RESOLUTIONS) {
    const result = createGenerator(new Uint8Array(size * size).fill(128), options, size);
    while (!result.done) result.advance();
    assert.equal(result.size, size);
    assert.equal(result.steps.length, 100);
    assert.deepEqual(result.pins[0], { x: size - 1, y: size / 2 });
    assert.ok(result.pins.every(pin => pin.x >= 0 && pin.y >= 0 && pin.x < size && pin.y < size));
    const svg = artworkSVG(result, { paper: "#fff", ink: "#000" });
    assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"`));
    assert.ok(stepsText(result).includes(`Resolution: ${size} x ${size} pixels.`));
  }
});

test("resolution and pixel-buffer mismatches are rejected before generation", () => {
  for (const size of [0, 15, 4097, NaN, 500.5]) {
    assert.throws(() => createGenerator(new Uint8Array(0), options, size), /pixel buffer/);
  }
  assert.throws(() => createGenerator(new Uint8Array(500), options, 500), /pixel buffer/);
});

test("working crops always resample the retained master, without modifying it", t => {
  const originalDocument = globalThis.document;
  const master = { width: 2048, height: 2048 };
  const calls = [];
  const created = [];
  globalThis.document = {
    createElement() {
      const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
      const canvas = {
        getContext() {
          return {
            drawImage(...args) { calls.push(args); },
            getImageData() { return { data: pixels }; },
            putImageData() {}
          };
        }
      };
      created.push({ canvas, pixels });
      return canvas;
    }
  };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const small = createWorkingCrop(master, 500);
  const large = createWorkingCrop(master, 2048);
  assert.deepEqual(calls, [[master, 0, 0, 500, 500], [master, 0, 0, 2048, 2048]]);
  assert.deepEqual([small.width, small.height, large.width, large.height], [500, 500, 2048, 2048]);
  assert.deepEqual(master, { width: 2048, height: 2048 });
  assert.ok(created.every(({ pixels }) => pixels[0] === pixels[1] && pixels[1] === pixels[2] && pixels[3] === 255));
});

test("pins start at the right and increase clockwise inside the canvas", () => {
  const pins = calculatePinCoords(12, 500);
  assert.deepEqual(pins[0], { x: 499, y: 250 });
  assert.deepEqual(pins[3], { x: 250, y: 499 });
  assert.ok(pins.every(pin => pin.x >= 0 && pin.y >= 0 && pin.x < 500 && pin.y < 500));
});

test("cached line pixels include endpoints and omit short connections", () => {
  const pixels = linePixels({ x: 1, y: 1 }, { x: 25, y: 25 }, 32);
  assert.equal(pixels[0], 33);
  assert.equal(pixels.at(-1), 825);
  assert.ok(pixels.every(index => index < 32 * 32));
  assert.equal(linePixels({ x: 1, y: 1 }, { x: 2, y: 2 }, 32).length, 0);
});

test("minimum pin count finishes instead of deadlocking on recent-pin history", () => {
  const result = createGenerator(new Uint8Array(32 * 32), options, 32);
  for (let i = 0; i < 101 && !result.done; i++) result.advance();
  assert.equal(result.done, true);
  assert.equal(result.steps.length, 100);
  result.steps.forEach((step, i) => {
    assert.notEqual(step.from, step.to);
    if (i) assert.equal(step.from, result.steps[i - 1].to);
  });
  assert.equal(result.advance(), false);
  assert.equal(result.steps.length, 100);
});

test("default 1K, 300-pin design produces all 4,000 continuous chords", () => {
  const result = createGenerator(
    Uint8Array.from({ length: 1024 * 1024 }, (_, i) => i % 256),
    { ...options, numPins: 300, numChords: 4000 }
  );
  while (!result.done) result.advance();
  assert.equal(result.steps.length, 4000);
  assert.equal(result.pins.length, 300);
  assert.equal(result.size, 1024);
  result.steps.forEach((step, index) => {
    assert.ok(step.from >= 0 && step.from < 300 && step.to >= 0 && step.to < 300);
    if (index) assert.equal(step.from, result.steps[index - 1].to);
  });
});

test("generation is deterministic and dark mode targets highlights", () => {
  const pixels = Uint8Array.from({ length: 64 * 64 }, (_, i) => i % 64 < 32 ? 0 : 255);
  function run(darkMode) {
    const result = createGenerator(pixels, { ...options, numPins: 24, darkMode }, 64);
    while (!result.done) result.advance();
    return result.steps;
  }
  assert.deepEqual(run(false), run(false));
  assert.notDeepEqual(run(false), run(true));
});

test("invalid inputs are rejected, not silently replaced with defaults", () => {
  for (const invalid of [{ numPins: 9 }, { numPins: 10.5 }, { numChords: 0 }, { lineWeight: NaN }, { lineWeight: 0 }]) {
    assert.throws(() => createGenerator(new Uint8Array(1024), { ...options, ...invalid }, 32), /whole numbers/);
  }
});

test("exports use the generated snapshot and support partial designs", () => {
  const result = createGenerator(new Uint8Array(1024), options, 32);
  result.advance();
  result.advance();
  const svg = artworkSVG(result, { paper: "#fff", ink: "#000" });
  assert.match(svg, /viewBox="0 0 32 32"/);
  assert.equal((svg.match(/L/g) || []).length, 2);
  assert.match(svg, /stroke-opacity="1"/);
  const text = stepsText(result);
  assert.match(text, /10 pins; 2 chords/);
  assert.match(text, /pin 0 is at the right edge/);
  assert.match(text, /1: From Pin 0 to Pin \d+/);
  assert.match(text, /2: From Pin \d+ to Pin \d+/);
});

test("pasting replaces an existing image, interrupts generation, and invalidates stale callbacks", async () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const { runInNewContext } = require("node:vm");
  const { transferFile } = require("./image-import.js");
  const timers = [];
  const elements = new Map();
  const documentEvents = new Map();
  let clock = 0;

  class Element {
    constructor() {
      this.listeners = new Map();
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this.classList = { add() {}, remove() {} };
      this.open = false;
      this.width = this.height = 1024;
      this.clientWidth = 800;
      this.clientHeight = 600;
      this.context = {
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, putImageData() {},
        drawImage(source) { this.lastSource = source; },
        getImageData(x, y, width, height) { return { data: new Uint8ClampedArray(width * height * 4).fill(128) }; }
      };
    }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    emit(type, event = {}) {
      for (const callback of this.listeners.get(type) || []) callback(event);
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { if (name === "src") this._src = ""; }
    append(element) { element.parentElement = this; }
    getContext() { return this.context; }
    querySelectorAll() {
      return ["numPins", "numChords", "lineWeight", "workingResolution", "imageUpload"].map(id => element(id));
    }
    reportValidity() { return true; }
    showModal() { this.open = true; }
    close() { this.open = false; queueMicrotask(() => this.emit("close")); }
    click() { this.emit("click"); }
    set src(value) {
      this._src = value;
      if (value) queueMicrotask(() => this.onload?.());
    }
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }
  element("numPins").value = "10";
  element("numChords").value = "100";
  element("lineWeight").value = "20";
  element("workingResolution").value = "1024";
  element("settingsForm").elements = { artMode: { value: "light" } };
  const root = new Element();
  root.dataset.theme = "light";
  element("studio").dataset.mobileView = "preview";

  const sandbox = {
    document: {
      documentElement: root,
      getElementById: element,
      querySelector: () => element("studio"),
      createElement: () => new Element(),
      addEventListener(type, callback) { documentEvents.set(type, callback); }
    },
    URLSearchParams, location: { search: "" },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class { observe() {} },
    getComputedStyle: () => ({ getPropertyValue: name => name.includes("ink") ? "#000" : "#fff" }),
    performance: { now: () => (clock += 20) },
    setTimeout: callback => timers.push(callback),
    ImageImport: { transferFile, prepare: async () => ({ blob: {} }) },
    Cropper: class {
      constructor(image, options) { queueMicrotask(options.ready); }
      getData() { return { width: 64, height: 64 }; }
      getCroppedCanvas({ width, height }) {
        const canvas = new Element();
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      destroy() {}
    },
    console
  };
  runInNewContext(readFileSync(join(__dirname, "string-art.js"), "utf8"), sandbox);
  documentEvents.get("DOMContentLoaded")();
  function paste(name) {
    let prevented = false;
    documentEvents.get("paste")({
      clipboardData: { files: [{ name, type: "image/png" }] },
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true);
    assert.equal(element("cropModal").open, true);
  }
  const ready = () => new Promise(resolve => setImmediate(resolve));
  function generateOneChord() {
    element("settingsForm").emit("submit", { preventDefault() {} });
    timers.shift()();
    assert.equal(element("canvas-wrapper").attributes["aria-busy"], "true");
  }

  paste("first.png");
  await ready();
  element("cropConfirmBtn").click();
  generateOneChord();
  paste("replacement.png");
  assert.equal(element("canvas-wrapper").attributes["aria-busy"], "false");
  await ready();
  element("cropConfirmBtn").click();
  const replacementCanvas = element("art-canvas").context.lastSource;
  const replacementStatus = element("statusMessage").textContent;
  timers.splice(0).forEach(callback => callback());
  assert.equal(element("imageFileName").textContent, "Pasted replacement.png");
  assert.equal(element("previewState").textContent, "Original crop");
  assert.equal(element("downloadSVGBtn").disabled, true);
  assert.equal(element("statusMessage").textContent, replacementStatus);
  assert.equal(element("art-canvas").context.lastSource, replacementCanvas);

  paste("idle-replacement.png");
  await ready();
  element("cropConfirmBtn").click();
  assert.equal(element("imageFileName").textContent, "Pasted idle-replacement.png");
  generateOneChord();
  const partialPreview = element("previewState").textContent;
  paste("cancelled.png");
  await ready();
  element("cropCancelBtn").click();
  await ready();
  timers.splice(0).forEach(callback => callback());
  assert.equal(element("imageFileName").textContent, "Pasted idle-replacement.png");
  assert.equal(element("previewState").textContent, partialPreview);
  assert.equal(element("downloadSVGBtn").disabled, false);
  assert.equal(element("generateBtn").disabled, false);
});
