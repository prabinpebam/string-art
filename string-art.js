"use strict";

const RESOLUTIONS = Object.freeze([500, 1024, 2048, 4096]);

function workingResolution(value) {
  const size = Number(value);
  if (!RESOLUTIONS.includes(size)) throw new Error("Choose a working resolution: 500 px, 1K, 2K, or 4K.");
  return size;
}

function createWorkingCrop(master, size) {
  workingResolution(size);
  const crop = document.createElement("canvas");
  crop.width = crop.height = size;
  const context = crop.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The working canvas could not be allocated. Try a lower resolution.");
  context.imageSmoothingQuality = "high";
  context.drawImage(master, 0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = 0.3 * image.data[i] + 0.59 * image.data[i + 1] + 0.11 * image.data[i + 2];
    image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
  }
  context.putImageData(image, 0, 0);
  return crop;
}

function calculatePinCoords(numPins, size) {
  const center = size / 2;
  return Array.from({ length: numPins }, (_, i) => {
    const angle = 2 * Math.PI * i / numPins;
    return {
      x: Math.floor(center + (center - 1) * Math.cos(angle)),
      y: Math.floor(center + (center - 1) * Math.sin(angle))
    };
  });
}

function linePixels(from, to, size) {
  const distance = Math.floor(Math.hypot(to.x - from.x, to.y - from.y));
  if (distance < 10) return new Uint32Array(0);
  const pixels = new Uint32Array(distance);
  for (let k = 0; k < distance; k++) {
    const t = k / (distance - 1);
    pixels[k] = Math.floor(from.y + t * (to.y - from.y)) * size +
      Math.floor(from.x + t * (to.x - from.x));
  }
  return pixels;
}

function createGenerator(pixels, options, size = 1024) {
  const { numPins, numChords, lineWeight, darkMode } = options;
  if (![numPins, numChords, lineWeight].every(Number.isSafeInteger) ||
      numPins < 10 || numChords < 100 || lineWeight < 1) {
    throw new Error("Use whole numbers: at least 10 pins, 100 chords, and line weight 1.");
  }
  if (!Number.isSafeInteger(size) || size < 16 || size > 4096 || !pixels || pixels.length !== size * size) {
    throw new Error("The pixel buffer must match a square resolution between 16 and 4,096 pixels.");
  }
  const pins = calculatePinCoords(numPins, size);
  const errors = Float32Array.from(pixels, brightness => darkMode ? brightness : 255 - brightness);
  const steps = [];
  const cache = new Map();
  const history = [];
  let currentPin = 0;
  let done = false;
  return {
    pins, steps, options, size,
    get done() { return done; },
    advance() {
      if (done) return false;
      let candidates = cache.get(currentPin);
      if (!candidates) {
        candidates = pins.map(pin => linePixels(pins[currentPin], pin, size));
        // Bound cached pin bundles instead of allocating every possible chord up front.
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(currentPin, candidates);
      }
      let bestPin = -1;
      let bestError = -1;
      for (let offset = 1; offset < numPins; offset++) {
        const testPin = (currentPin + offset) % numPins;
        if (history.includes(testPin) || !candidates[testPin].length) continue;
        let sum = 0;
        for (const index of candidates[testPin]) sum += errors[index];
        if (sum > bestError) {
          bestError = sum;
          bestPin = testPin;
        }
      }
      if (bestPin === -1) {
        done = true;
        return false;
      }
      steps.push({ from: currentPin, to: bestPin });
      for (const index of candidates[bestPin]) errors[index] = Math.max(0, errors[index] - lineWeight);
      history.push(bestPin);
      // Leave candidates available even for the minimum supported pin count.
      if (history.length > Math.min(20, numPins - 2)) history.shift();
      currentPin = bestPin;
      done = steps.length >= numChords;
      return true;
    }
  };
}

function artworkSVG(result, palette) {
  const lines = result.steps.map(step => {
    const from = result.pins[step.from], to = result.pins[step.to];
    return `M${from.x} ${from.y}L${to.x} ${to.y}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.size} ${result.size}" width="${result.size}" height="${result.size}"><rect width="100%" height="100%" fill="${palette.paper}"/><path d="${lines}" fill="none" stroke="${palette.ink}" stroke-opacity="${result.options.darkMode ? 0.5 : 1}" stroke-width="0.5"/></svg>`;
}

function stepsText(result) {
  return `String Art Steps:\n${result.options.numPins} pins; ${result.steps.length} chords; line weight ${result.options.lineWeight}.\nResolution: ${result.size} x ${result.size} pixels.\nPins are zero-based: pin 0 is at the right edge, increasing clockwise.\n\n` +
    result.steps.map((step, index) => `${index + 1}: From Pin ${step.from} to Pin ${step.to}\n`).join("");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RESOLUTIONS, workingResolution, createWorkingCrop, calculatePinCoords, linePixels, createGenerator, artworkSVG, stepsText };
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  const canvas = $("art-canvas");
  const ctx = canvas.getContext("2d");
  const form = $("settingsForm");
  const stage = $("canvas-wrapper");
  const dialog = $("cropModal");
  const systemTheme = matchMedia("(prefers-color-scheme: dark)");
  let themePreference = new URLSearchParams(location.search).get("scoutTheme");
  let croppedCanvas = null;
  let masterCrop = null;
  let source = null;
  let pendingSource = null;
  let cropper = null;
  let result = null;
  let busy = false;
  let stopRequested = false;
  let showSource = false;
  let zoom = 1;
  let dirty = false;
  let importId = 0;
  let generationId = 0;

  function status(message, tone = "") {
    $("statusMessage").textContent = message;
    $("statusMessage").dataset.tone = tone;
  }
  function cropStatus(message, tone = "") {
    $("cropStatus").textContent = message;
    $("cropStatus").dataset.tone = tone;
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("themeToggle").setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
  }
  try {
    if (themePreference !== "light" && themePreference !== "dark") themePreference = localStorage.getItem("string-theme");
  } catch (error) {
    console.warn("Theme preference could not be read.", error);
  }
  applyTheme(themePreference === "light" || themePreference === "dark" ? themePreference : systemTheme.matches ? "dark" : "light");
  systemTheme.addEventListener("change", event => {
    if (themePreference !== "light" && themePreference !== "dark") applyTheme(event.matches ? "dark" : "light");
  });
  $("themeToggle").addEventListener("click", () => {
    themePreference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(themePreference);
    try { localStorage.setItem("string-theme", themePreference); }
    catch (error) { console.warn("Theme preference could not be saved.", error); }
  });

  const mobileLayout = matchMedia("(max-width: 1023px)");
  function applyView() {
    const settingsVisible = mobileLayout.matches && document.querySelector(".studio").dataset.mobileView === "settings";
    $("previewWorkspace").inert = settingsVisible;
    $("settingsPanel").inert = mobileLayout.matches && !settingsVisible;
    $("previewViewButton").setAttribute("aria-pressed", String(!settingsVisible));
    $("settingsViewButton").setAttribute("aria-pressed", String(settingsVisible));
    (mobileLayout.matches ? document.querySelector(".studio") : $("settingsPanel")).append($("actionPanel"));
    fitCanvas();
  }
  function switchView(view) {
    document.querySelector(".studio").dataset.mobileView = view;
    applyView();
  }
  $("previewViewButton").addEventListener("click", () => switchView("preview"));
  $("settingsViewButton").addEventListener("click", () => switchView("settings"));
  mobileLayout.addEventListener("change", applyView);

  function fitCanvas() {
    const fit = Math.max(1, Math.min(stage.clientWidth - 48, stage.clientHeight - 48));
    const displaySize = Math.floor(fit * zoom);
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    $("canvasFrame").style.width = `${displaySize + 48}px`;
    $("canvasFrame").style.height = `${displaySize + 48}px`;
    $("zoomValue").textContent = `${Math.round(zoom * 100)}%`;
  }
  new ResizeObserver(fitCanvas).observe(stage);
  $("zoomInButton").addEventListener("click", () => { zoom = Math.min(4, zoom + 0.25); fitCanvas(); });
  $("zoomOutButton").addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.25); fitCanvas(); });
  $("zoomFitButton").addEventListener("click", () => { zoom = 1; fitCanvas(); stage.scrollTo(0, 0); });
  function palette(dark) {
    const styles = getComputedStyle(document.documentElement);
    return {
      paper: styles.getPropertyValue(dark ? "--cp-paper-dark" : "--cp-paper-light").trim(),
      ink: styles.getPropertyValue(dark ? "--cp-ink-light" : "--cp-ink-dark").trim()
    };
  }
  function render() {
    if (!croppedCanvas) return;
    const size = result ? result.size : croppedCanvas.width;
    if (canvas.width !== size) canvas.width = canvas.height = size;
    $("resolutionState").textContent = `${size} \u00d7 ${size}`;
    $("sourceButton").setAttribute("aria-pressed", String(showSource));
    if (showSource || !result) {
      ctx.drawImage(croppedCanvas, 0, 0, size, size);
      $("previewState").textContent = "Original crop";
      return;
    }
    const colors = palette(result.options.darkMode);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = colors.ink;
    ctx.globalAlpha = result.options.darkMode ? 0.5 : 1;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const step of result.steps) {
      const from = result.pins[step.from], to = result.pins[step.to];
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    $("previewState").textContent = `${result.steps.length.toLocaleString()} chords${dirty ? " (previous settings)" : ""}`;
  }
  $("sourceButton").addEventListener("click", () => { showSource = !showSource; render(); });
  function updateControls() {
    form.querySelectorAll("input, select").forEach(input => { input.disabled = busy; });
    $("emptyUploadButton").disabled = busy;
    $("recropButton").disabled = busy || !source;
    $("generateBtn").disabled = busy || !croppedCanvas;
    $("generateBtn").hidden = busy;
    $("stopBtn").hidden = !busy;
    $("downloadSVGBtn").disabled = $("downloadStepsBtn").disabled = busy || !result?.steps.length;
    $("sourceButton").disabled = !result?.steps.length;
    ["zoomInButton", "zoomOutButton", "zoomFitButton"].forEach(id => { $(id).disabled = !croppedCanvas; });
    stage.setAttribute("aria-busy", String(busy));
  }
  form.addEventListener("input", event => {
    if (event.target.id === "imageUpload") return;
    if (!croppedCanvas) {
      if (event.target.id === "workingResolution") {
        const size = workingResolution(event.target.value);
        $("resolutionState").textContent = `${size} \u00d7 ${size}`;
      }
      return;
    }
    dirty = Boolean(result);
    status("Settings changed. Generate to apply; exports keep the last generated design.");
    render();
  });

  function resetCrop() {
    if (cropper) cropper.destroy();
    cropper = null;
    const image = $("cropImage");
    image.onload = image.onerror = null;
    image.removeAttribute("src");
    if (pendingSource && pendingSource !== source) URL.revokeObjectURL(pendingSource.url);
    pendingSource = null;
  }
  function beginCrop() {
    const id = ++importId;
    resetCrop();
    $("cropConfirmBtn").disabled = true;
    cropStatus("Preparing image...");
    if (!dialog.open) dialog.showModal();
    return id;
  }
  function showCrop(candidate, id) {
    pendingSource = candidate;
    const image = $("cropImage");
    image.onload = () => {
      if (!dialog.open || id !== importId) return;
      if (typeof Cropper === "undefined") {
        cropStatus("The cropping library could not load. Check your connection and reload the page.", "error");
        return;
      }
      try {
        cropper = new Cropper(image, {
          aspectRatio: 1, viewMode: 1, autoCropArea: 1,
          ready() {
            if (!dialog.open || id !== importId) return;
            $("cropConfirmBtn").disabled = false;
            cropStatus("Adjust the square crop, then use your image.");
          }
        });
      } catch (error) {
        console.error("Could not initialize image cropping.", error);
        cropStatus("Could not prepare this image for cropping. Try another image.", "error");
      }
    };
    image.onerror = () => {
      if (id === importId && dialog.open) cropStatus("The prepared image could not load. Try importing it again.", "error");
    };
    image.src = candidate.url;
  }
  async function importFile(file, pasted = false) {
    if (!file) return;
    if (busy) {
      if (!pasted) {
        status("Stop generation or wait for it to finish before importing another image.", "error");
        return;
      }
      generationId++;
      stopRequested = false;
      if (!result?.steps.length) result = null;
      finish("Generation stopped to paste a new image. Confirm the crop to replace it, or cancel to keep the current design.");
    }
    const id = beginCrop();
    try {
      const prepared = await ImageImport.prepare(file);
      if (id !== importId || !dialog.open) return;
      const name = pasted ? `Pasted ${file.name || "image"}` : file.name || "Image";
      showCrop({ url: URL.createObjectURL(prepared.blob), name }, id);
    } catch (error) {
      console.error("Image import failed.", error);
      if (id !== importId || !dialog.open) return;
      cropStatus(error.message, "error");
    }
  }
  $("imageUpload").addEventListener("change", event => {
    importFile(event.target.files[0]);
    event.target.value = "";
  });
  $("emptyUploadButton").addEventListener("click", () => $("imageUpload").click());
  $("recropButton").addEventListener("click", () => showCrop(source, beginCrop()));
  $("cropCancelBtn").addEventListener("click", () => dialog.close());
  $("cropCloseBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    importId++;
    resetCrop();
  });
  $("cropConfirmBtn").addEventListener("click", () => {
    try {
      const size = workingResolution($("workingResolution").value);
      const data = cropper.getData();
      const masterSize = Math.max(1, Math.min(4096, Math.ceil(Math.max(data.width, data.height))));
      // Retain source detail so increasing resolution does not upscale the previous working crop.
      const master = cropper.getCroppedCanvas({ width: masterSize, height: masterSize, fillColor: palette(false).paper });
      if (!master?.width) throw new Error("No crop is available.");
      const crop = createWorkingCrop(master, size);
      if (source && source !== pendingSource) URL.revokeObjectURL(source.url);
      source = pendingSource;
      croppedCanvas = crop;
      masterCrop = master;
      result = null;
      dirty = false;
      showSource = false;
      zoom = 1;
      $("imageFileName").textContent = $("previewTitle").textContent = source.name;
      $("imageFileName").title = $("previewTitle").title = source.name;
      $("emptyState").hidden = true;
      $("canvasFrame").hidden = false;
      dialog.close();
      render();
      updateControls();
      switchView("preview");
      status("Image ready. Refine your settings, then generate.");
    } catch (error) {
      console.error("Image cropping failed.", error);
      cropStatus("Could not crop this image. Try adjusting the crop or choosing another image.", "error");
    }
  });
  stage.addEventListener("dragover", event => {
    event.preventDefault();
    if (!busy) stage.classList.add("is-dragging");
  });
  stage.addEventListener("dragleave", event => {
    if (!stage.contains(event.relatedTarget)) stage.classList.remove("is-dragging");
  });
  stage.addEventListener("drop", event => {
    event.preventDefault();
    stage.classList.remove("is-dragging");
    importFile(ImageImport.transferFile(event.dataTransfer) || event.dataTransfer.files[0]);
  });
  document.addEventListener("paste", event => {
    const file = ImageImport.transferFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    importFile(file, true);
  });

  function updateProgress() {
    const percent = result.steps.length / result.options.numChords * 100;
    $("progressBar").style.width = `${percent}%`;
    $("progressBar").setAttribute("aria-valuenow", String(Math.floor(percent)));
    $("progressValue").textContent = `${Math.floor(percent)}%`;
    $("progressLabel").textContent = `${result.steps.length.toLocaleString()} / ${result.options.numChords.toLocaleString()} chords`;
  }
  function finish(message, tone = "") {
    busy = false;
    $("progressSection").hidden = true;
    render();
    updateControls();
    status(message, tone);
  }
  function generateChunk(id) {
    if (id !== generationId || !busy) return;
    try {
      if (stopRequested) {
        finish(`Stopped at ${result.steps.length.toLocaleString()} chords. ${result.steps.length ? "You can export this partial design." : "Generate again to start over."}`);
        return;
      }
      const deadline = performance.now() + 16;
      do { result.advance(); } while (!result.done && performance.now() < deadline);
      updateProgress();
      render();
      if (result.done) {
        finish(result.steps.length === result.options.numChords ?
          `Complete. ${result.steps.length.toLocaleString()} chords, ready to export.` :
          `Finished early at ${result.steps.length.toLocaleString()} chords: no more eligible connections.`, "success");
      } else setTimeout(() => generateChunk(id), 0);
    } catch (error) {
      console.error("String art generation failed.", error);
      result = null;
      finish("Generation failed. Try fewer pins or chords, then generate again.", "error");
    }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy || !croppedCanvas || !form.reportValidity()) return;
    const previous = { croppedCanvas, result, dirty, showSource };
    try {
      const size = workingResolution($("workingResolution").value);
      const crop = croppedCanvas.width === size ? croppedCanvas : createWorkingCrop(masterCrop, size);
      const imageData = crop.getContext("2d").getImageData(0, 0, size, size);
      const pixels = Uint8Array.from({ length: size * size }, (_, i) => imageData.data[i * 4]);
      const next = createGenerator(pixels, {
        numPins: Number($("numPins").value), numChords: Number($("numChords").value),
        lineWeight: Number($("lineWeight").value), darkMode: form.elements.artMode.value === "dark"
      }, size);
      croppedCanvas = crop;
      result = next;
      busy = true;
      dirty = false;
      stopRequested = false;
      showSource = false;
      $("stopBtn").disabled = false;
      $("progressSection").hidden = false;
      updateControls();
      updateProgress();
      render();
      switchView("preview");
      status("Building your artwork. You can stop and keep the partial design.");
      const id = ++generationId;
      setTimeout(() => generateChunk(id), 0);
    } catch (error) {
      console.error("Could not start generation.", error);
      ({ croppedCanvas, result, dirty, showSource } = previous);
      busy = false;
      $("progressSection").hidden = true;
      updateControls();
      status(error.message, "error");
      render();
    }
  });
  $("stopBtn").addEventListener("click", () => {
    stopRequested = true;
    $("stopBtn").disabled = true;
    status("Stopping generation...");
  });
  function download(content, type, filename) {
    try {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(`Download requested: ${filename}${dirty ? " (last generated settings)" : ""}.`);
    } catch (error) {
      console.error("Artwork download failed.", error);
      status("Could not download this file. Please try again.", "error");
    }
  }
  $("downloadSVGBtn").addEventListener("click", () => {
    if (result?.steps.length && !busy) download(artworkSVG(result, palette(result.options.darkMode)), "image/svg+xml;charset=utf-8", "string_art.svg");
  });
  $("downloadStepsBtn").addEventListener("click", () => {
    if (result?.steps.length && !busy) download(stepsText(result), "text/plain;charset=utf-8", "string_art_steps.txt");
  });
  applyView();
  updateControls();
});
