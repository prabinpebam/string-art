"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const UTIF = require("utif");
const { inspectHeader, fileType, transferFile, validateFile, validateDimensions, workingSize, validateTIFFPage, prepare, MAX_FILE_BYTES } = require("./image-import.js");

function bytes(text) {
  return Uint8Array.from(Buffer.from(text, "binary")).buffer;
}

test("recognizes native and fallback formats by signature, regardless of MIME or extension", () => {
  const png = new Uint8Array(24);
  png.set(new Uint8Array(bytes("\x89PNG\r\n\x1a\n")));
  new DataView(png.buffer).setUint32(16, 640);
  new DataView(png.buffer).setUint32(20, 480);
  assert.deepEqual(inspectHeader(png.buffer), { type: "image/png", width: 640, height: 480 });
  for (const [signature, type] of [
    ["\xff\xd8\xff", "image/jpeg"], ["RIFF\x00\x00\x00\x00WEBP", "image/webp"],
    ["II*\0", "image/tiff"], ["MM\0*", "image/tiff"], ["II+\0", "image/tiff"],
    ["<?xml version=\"1.0\"?><svg viewBox=\"0 0 10 10\"/>", "image/svg+xml"],
    ["\xff\x0a", "image/jxl"], ["\0\0\0\x0cJXL \r\n\x87\n", "image/jxl"],
    ["\0\0\0\x18ftypheic\0\0\0\0mif1heic", "image/heic"],
    ["\0\0\0\x18ftypmif1\0\0\0\0mif1avif", "image/avif"],
    ["\0\0\0\x18ftypmif1\0\0\0\0mif1msf1", "image/heif"]
  ]) {
    const header = inspectHeader(bytes(signature));
    assert.equal(header.type, type);
    assert.equal(fileType({ name: "wrong.txt", type: "text/plain" }, header), type);
  }
});

test("supports known extensions with missing or generic MIME types, without rejecting future image types", () => {
  for (const [name, type] of [
    ["photo.JPG", "image/jpeg"], ["image.jfif", "image/jpeg"], ["a.apng", "image/png"],
    ["a.avif", "image/avif"], ["a.TIFF", "image/tiff"], ["a.heic", "image/heic"],
    ["a.heif", "image/heif"], ["a.hif", "image/heif"], ["a.jxl", "image/jxl"],
    ["a.ico", "image/x-icon"], ["a.cur", "image/x-icon"], ["a.SVG", "image/svg+xml"]
  ]) {
    assert.equal(fileType({ name, type: "" }), type);
    assert.equal(fileType({ name, type: "application/octet-stream" }), type);
  }
  assert.equal(fileType({ name: "unknown", type: "image/future" }), "image/future");
  assert.equal(fileType({ name: "notes.txt", type: "text/plain" }), null);
  assert.equal(fileType({ name: "", type: "image/pjpeg" }), "image/jpeg");
});

test("clipboard and drop selection prefers an image among mixed files and ignores plain text", () => {
  const text = { name: "notes.txt", type: "text/plain" };
  const image = { name: "paste.png", type: "image/png" };
  assert.equal(transferFile({ files: [text, image] }), image);
  assert.equal(transferFile({ items: [
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "image/png", getAsFile: () => image }
  ] }), image);
  assert.equal(transferFile({ files: [text] }), null);
  assert.equal(transferFile(null), null);
  assert.equal(transferFile({ files: [{ name: "scan.tif", type: "" }] }).name, "scan.tif");
});

test("malformed and truncated headers do not read outside their buffer", () => {
  for (const signature of ["\x89PNG\r\n\x1a\n", "RIFF\0\0\0\0WEBP", "\0\0\0\x18ftypheic", "II*\0", "<svg/>"]) {
    for (let length = 0; length <= signature.length; length++) {
      assert.doesNotThrow(() => inspectHeader(bytes(signature.slice(0, length))));
    }
  }
});

test("byte and dimension limits reject invalid sources and preserve the working aspect ratio", () => {
  assert.throws(() => validateFile({ size: 0 }), /empty/);
  assert.throws(() => validateFile({ size: MAX_FILE_BYTES + 1 }), /100 MiB/);
  assert.doesNotThrow(() => validateFile({ size: MAX_FILE_BYTES }));
  for (const [width, height] of [[0, 1], [1, -1], [NaN, 1], [1.2, 5], [65536, 1], [10001, 10000]]) {
    assert.throws(() => validateDimensions(width, height), /dimensions|limit/);
  }
  assert.deepEqual(workingSize(12000, 8000), { width: 4096, height: 2731 });
  assert.deepEqual(workingSize(640, 480), { width: 640, height: 480 });
});

test("a real TIFF can be decoded and its pixel data validated", () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const buffer = UTIF.encodeImage(pixels.buffer, 2, 1);
  const pages = UTIF.decode(buffer);
  validateTIFFPage(pages[0], buffer.byteLength);
  UTIF.decodeImage(buffer, pages[0], pages);
  assert.deepEqual(UTIF.toRGBA8(pages[0]), pixels);
  assert.equal(inspectHeader(buffer).type, "image/tiff");
});

test("unsupported or corrupt TIFF data is rejected rather than producing blank artwork", () => {
  const page = { t256: [2], t257: [1], t273: [100], t279: [6], t258: [8, 8, 8] };
  assert.doesNotThrow(() => validateTIFFPage(page, 106));
  assert.throws(() => validateTIFFPage({ ...page, t259: [999] }, 106), /unsupported/);
  assert.throws(() => validateTIFFPage({ ...page, t284: [2] }, 106), /unsupported/);
  assert.throws(() => validateTIFFPage({ ...page, t339: [3] }, 106), /unsupported/);
  assert.throws(() => validateTIFFPage(page, 105), /damaged/);
  assert.throws(() => validateTIFFPage({ ...page, t273: [] }, 106), /damaged/);
});

function mockBrowser(t, { failNative = false, failDecoder = false } = {}) {
  const original = new Map();
  const drawing = [];
  const loads = [];
  const revoked = [];
  const decoded = [];
  function replace(key, value) {
    original.set(key, { value: globalThis[key], exists: Object.hasOwn(globalThis, key) });
    globalThis[key] = value;
  }
  t.after(() => {
    for (const [key, entry] of original) {
      if (entry.exists) globalThis[key] = entry.value;
      else delete globalThis[key];
    }
  });
  class FakeImage {
    naturalWidth = 640;
    naturalHeight = 480;
    set src(value) {
      this.value = value;
      if (value) queueMicrotask(() => failNative ? this.onerror?.() : this.onload?.());
    }
    get src() { return this.value || ""; }
  }
  replace("Image", FakeImage);
  replace("ImageData", class {
    constructor(data, width, height) { Object.assign(this, { data, width, height }); }
  });
  replace("UTIF", UTIF);
  replace("document", {
    head: {
      append(script) {
        loads.push(script.src);
        queueMicrotask(() => failDecoder ? script.onerror() : script.onload());
      }
    },
    createElement(tag) {
      if (tag === "script") return { remove() {} };
      return {
        getContext() {
          return {
            drawImage(...args) { drawing.push(args); },
            putImageData(image) { decoded.push(image); },
            setTransform() {}
          };
        },
        toBlob(callback, type) { callback(new Blob(["normalized image"], { type })); }
      };
    }
  });
  t.mock.method(URL, "createObjectURL", () => "blob:test");
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  return { drawing, loads, revoked, decoded };
}

test("native import normalizes supported images to a crop-ready PNG and releases its URL", async t => {
  const browser = mockBrowser(t);
  const file = new File(["image"], "photo.avif", { type: "" });
  const prepared = await prepare(file);
  assert.equal(prepared.type, "image/avif");
  assert.equal(prepared.blob.type, "image/png");
  assert.deepEqual([prepared.width, prepared.height], [640, 480]);
  assert.equal(browser.loads.length, 0);
  assert.equal(browser.drawing.length, 1);
  assert.deepEqual(browser.revoked, ["blob:test"]);
});

test("TIFF uses local fallback decoders when browser decoding is unavailable", async t => {
  const browser = mockBrowser(t, { failNative: true });
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const file = new File([UTIF.encodeImage(pixels.buffer, 2, 1)], "scan.tiff");
  const prepared = await prepare(file);
  assert.equal(prepared.type, "image/tiff");
  assert.deepEqual([prepared.width, prepared.height], [2, 1]);
  assert.deepEqual(browser.loads, ["vendor/pako.min.js", "vendor/UTIF.js"]);
});

test("16-bit big-endian TIFF retains channel values after decoder normalization", async t => {
  const browser = mockBrowser(t, { failNative: true });
  const prefix = UTIF.encode([{
    t256: [1], t257: [1], t258: [16, 16, 16, 16], t259: [1],
    t262: [2], t273: [1000], t277: [4], t278: [1], t279: [8]
  }]);
  const bytes = new Uint8Array(1008);
  bytes.set(new Uint8Array(prefix));
  bytes.set([255, 255, 0, 0, 128, 0, 255, 255], 1000);
  await prepare(new File([bytes], "rgb16.tif"));
  assert.deepEqual(Array.from(browser.decoded[0].data), [255, 0, 128, 255]);
});

test("decoder load failures are explicit and leave imports retryable", async t => {
  const browser = mockBrowser(t, { failNative: true, failDecoder: true });
  const file = new File(["heic"], "phone.heic");
  await assert.rejects(prepare(file), /local image decoder could not load/);
  await assert.rejects(prepare(file), /local image decoder could not load/);
  assert.deepEqual(browser.loads, ["vendor/heic-to.js", "vendor/heic-to.js"]);
});

test("unsupported native images and empty files report meaningful errors", async t => {
  mockBrowser(t, { failNative: true });
  await assert.rejects(prepare(new File(["broken"], "broken.webp")), /damaged|unsupported/);
  await assert.rejects(prepare(new File(["text"], "notes.txt")), /Choose an image/);
  await assert.rejects(prepare(new File([], "empty.png")), /empty/);
});
