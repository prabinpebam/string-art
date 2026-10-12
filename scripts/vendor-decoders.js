"use strict";

const { copyFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const root = join(__dirname, "..");
const files = [
  ["pako", "dist/pako.min.js", "pako.min.js"],
  ["pako", "LICENSE", "pako-LICENSE.txt"],
  ["utif", "UTIF.js", "UTIF.js"],
  ["utif", "LICENSE", "utif-LICENSE.txt"],
  ["heic-to", "dist/iife/heic-to.js", "heic-to.js"],
  ["heic-to", "LICENSE", "heic-to-LICENSE.txt"],
  ["heic-to", "README.md", "heic-source/README.md"],
  ["heic-to", "esbuild.mjs", "heic-source/esbuild.mjs"],
  ["heic-to", "package.json", "heic-source/package.json"],
  ["heic-to", "src/index.js", "heic-source/src/index.js"],
  ["heic-to", "src/iife.js", "heic-source/src/iife.js"],
  ["heic-to", "src/worker.js", "heic-source/src/worker.js"]
];
for (const [packageName, source, target] of files) {
  const destination = join(root, "vendor", target);
  mkdirSync(join(destination, ".."), { recursive: true });
  copyFileSync(join(root, "node_modules", packageName, source), destination);
}
console.log("Copied pinned image decoders, notices, and HEIC wrapper sources to vendor.");
