"use strict";

// Global variables for canvas and image processing
let canvas, ctx;
let processedImageData = null;
let errorArray = [];
let pinCoords = [];
let lineCache = {}; // Caches precomputed line points: key "i_j" → array of points
let steps = [];

// Parameters with defaults
let numPins = 300;
let numChords = 4000;
let lineWeight = 20; // Default line weight is now 20
let imgSize = 500;   // Working square size for processing

let darkMode = false; // Global flag for dark mode (false by default)

let cropper = null;
let croppedImage = null;

// For progress display
let progressBar;

document.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById("art-canvas");
  ctx = canvas.getContext("2d");
  // Enable antialiasing (image smoothing)
  ctx.imageSmoothingEnabled = true;
  progressBar = document.getElementById("progressBar");

  // Set up event listeners
  document.getElementById("imageUpload").addEventListener("change", handleImageUpload);
  document.getElementById("generateBtn").addEventListener("click", () => {
    numPins = parseInt(document.getElementById("numPins").value) || 300;
    numChords = parseInt(document.getElementById("numChords").value) || 4000;
    lineWeight = parseInt(document.getElementById("lineWeight").value) || 20;
    if (!croppedImage) {
      alert("Please upload and crop an image first.");
      return;
    }
    // Show progress section when generation starts
    document.getElementById("progressSection").style.display = "block";
    updateProgress(0);
    generateStringArt();
  });
  document.getElementById("downloadStepsBtn").addEventListener("click", downloadSteps);
  document.getElementById("downloadSVGBtn").addEventListener("click", downloadSVG);
  document.getElementById("toggleDarkMode").addEventListener("change", toggleDarkMode);

  // When the crop modal is shown, initialize Cropper at the right time.
  document.getElementById("cropModal").addEventListener("shown.bs.modal", () => {
    const cropImage = document.getElementById("cropImage");
    if (cropper) {
      cropper.destroy();
    }
    cropper = new Cropper(cropImage, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 1
    });
  });
  // Update cropper on window resize
  window.addEventListener("resize", () => {
    if (cropper) {
      cropper.update();
    }
    resizeCanvas();
  });

  resizeCanvas();
});

// Resize the canvas so that it fills the available viewport (minus the 400px control pane) while remaining square (min 480px)
function resizeCanvas() {
  const rightPaneWidth = 400;
  const availableWidth = window.innerWidth - rightPaneWidth;
  const availableHeight = window.innerHeight;
  const size = Math.max(480, Math.min(availableWidth, availableHeight));
  canvas.width = size;
  canvas.height = size;
  // Also update the canvas container's background in dark mode
  document.getElementById("canvas-wrapper").style.backgroundColor = darkMode ? "#333" : "#fff";
}

// Update progress bar display
function updateProgress(percent) {
  percent = Math.min(100, Math.max(0, percent));
  progressBar.style.width = percent + "%";
  progressBar.textContent = Math.floor(percent) + "%";
}

// --- Dark Mode Toggle ---
function toggleDarkMode(event) {
    darkMode = event.target.checked;
    const newBgColor = darkMode ? "#333" : "#fff";
    // Immediately update the canvas and container background colors.
    canvas.style.backgroundColor = newBgColor;
    document.getElementById("canvas-wrapper").style.backgroundColor = newBgColor;
    
    // Clear the canvas immediately with the new background color.
    ctx.fillStyle = newBgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  
    // If an image has been cropped, re-generate string art in the new mode.
    if (croppedImage) {
      document.getElementById("progressSection").style.display = "block";
      updateProgress(0);
      generateStringArt();
    }
  }
  

// --- Image Upload and Cropping ---
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    showCropModal(e.target.result);
  };
  reader.onerror = (err) => {
    console.error("Error reading file", err);
    alert("Error reading file");
  };
  reader.readAsDataURL(file);
}

function showCropModal(imageUrl) {
  const cropImage = document.getElementById("cropImage");
  cropImage.src = imageUrl;
  // The crop image is styled via CSS to fill the modal.
  const cropModal = new bootstrap.Modal(document.getElementById("cropModal"), {
    backdrop: 'static',
    keyboard: false
  });
  cropModal.show();
  // (Cropper will be initialized in the "shown.bs.modal" handler above.)
}

document.getElementById("cropConfirmBtn").addEventListener("click", () => {
  try {
    // Get the cropped canvas from Cropper
    const croppedCanvas = cropper.getCroppedCanvas({
      width: imgSize,
      height: imgSize
    });
    // Convert to grayscale by processing pixel data
    const ctx2 = croppedCanvas.getContext("2d");
    const imageData = ctx2.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const gray = 0.3 * r + 0.59 * g + 0.11 * b;
      data[i] = data[i+1] = data[i+2] = gray;
    }
    ctx2.putImageData(imageData, 0, 0);
    // Create a new image from the grayscale data
    croppedImage = new Image();
    croppedImage.src = croppedCanvas.toDataURL("image/jpeg");
    croppedImage.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(croppedImage, 0, 0, canvas.width, canvas.height);
    };
  } catch (err) {
    console.error("Error during cropping", err);
    alert("Error during cropping");
  }
});

// --- String Art Generation ---
function generateStringArt() {
  try {
    // Reset arrays and caches
    steps = [];
    errorArray = [];
    pinCoords = [];
    lineCache = {};
    
    const offCanvas = document.createElement("canvas");
    offCanvas.width = imgSize;
    offCanvas.height = imgSize;
    const offCtx = offCanvas.getContext("2d");
    offCtx.drawImage(croppedImage, 0, 0, imgSize, imgSize);
    processedImageData = offCtx.getImageData(0, 0, imgSize, imgSize);

    // Build error array:
    // Light mode: error = 255 - brightness (target dark areas)
    // Dark mode: error = brightness (target bright areas)
    for (let i = 0; i < processedImageData.data.length; i += 4) {
      const brightness = processedImageData.data[i];
      errorArray.push(darkMode ? brightness : 255 - brightness);
    }

    calculatePinCoords();
    precalculateAllPotentialLines();
    calculateLinesChunked();
  } catch (err) {
    console.error("Error in generateStringArt:", err);
    alert("An error occurred during string art generation.");
  }
}

function calculatePinCoords() {
  const center = imgSize / 2;
  const radius = center - 1;
  pinCoords = [];
  for (let i = 0; i < numPins; i++) {
    const angle = (2 * Math.PI * i) / numPins;
    const x = Math.floor(center + radius * Math.cos(angle));
    const y = Math.floor(center + radius * Math.sin(angle));
    pinCoords.push({ x, y });
  }
}

function precalculateAllPotentialLines() {
  for (let i = 0; i < numPins; i++) {
    for (let j = i + 1; j < numPins; j++) {
      const dx = pinCoords[j].x - pinCoords[i].x;
      const dy = pinCoords[j].y - pinCoords[i].y;
      const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
      if (dist < 10) continue;
      const pts = linspacePoints(pinCoords[i], pinCoords[j], dist);
      lineCache[`${i}_${j}`] = pts;
      lineCache[`${j}_${i}`] = pts;
    }
  }
}

function linspacePoints(p0, p1, numPoints) {
  const points = [];
  for (let k = 0; k < numPoints; k++) {
    const t = k / (numPoints - 1);
    const x = Math.floor(p0.x + t * (p1.x - p0.x));
    const y = Math.floor(p0.y + t * (p1.y - p0.y));
    points.push({ x, y });
  }
  return points;
}

// Process chord generation in chunks so the UI remains responsive.
function calculateLinesChunked() {
  let currentPin = 0;
  const lastPins = [];
  const maxHistory = 20;
  let chord = 0;
  const chunkSize = 50;

  function processChunk() {
    const end = Math.min(chord + chunkSize, numChords);
    for (; chord < end; chord++) {
      let bestPin = -1;
      let maxLineError = -1;
      let bestKey = null;
      for (let offset = 1; offset < numPins; offset++) {
        const testPin = (currentPin + offset) % numPins;
        if (lastPins.includes(testPin)) continue;
        const key = currentPin < testPin ? `${currentPin}_${testPin}` : `${testPin}_${currentPin}`;
        const pts = lineCache[key];
        if (!pts) continue;
        let sumError = 0;
        for (const pt of pts) {
          const idx = pt.y * imgSize + pt.x;
          sumError += errorArray[idx];
        }
        if (sumError > maxLineError) {
          maxLineError = sumError;
          bestPin = testPin;
          bestKey = key;
        }
      }
      if (bestPin === -1) break;
      steps.push({ from: currentPin, to: bestPin });
      const pts = lineCache[bestKey];
      for (const pt of pts) {
        const idx = pt.y * imgSize + pt.x;
        errorArray[idx] = Math.max(errorArray[idx] - lineWeight, 0);
      }
      lastPins.push(bestPin);
      if (lastPins.length > maxHistory) lastPins.shift();
      currentPin = bestPin;
    }
    updateProgress((chord / numChords) * 100);
    if (chord < numChords) {
      setTimeout(processChunk, 1);
    } else {
      updateProgress(100);
      renderStringArt();
      showSuccessMessage();
    }
  }
  processChunk();
}

function renderStringArt() {
    // Fill background based on mode
    ctx.fillStyle = darkMode ? "#333" : "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Set stroke style: translucent white in dark mode, black in light mode
    ctx.strokeStyle = darkMode ? "rgba(255, 255, 255, 0.5)" : "#000";
    ctx.lineWidth = 0.5; // Reduced line thickness for a finer look
    ctx.beginPath();
    const scale = canvas.width / imgSize;
    for (const step of steps) {
      const pFrom = pinCoords[step.from];
      const pTo = pinCoords[step.to];
      ctx.moveTo(pFrom.x * scale, pFrom.y * scale);
      ctx.lineTo(pTo.x * scale, pTo.y * scale);
    }
    ctx.stroke();
  }
  

function showSuccessMessage() {
  const progressSection = document.getElementById("progressSection");
  const progressMessage = document.getElementById("progressMessage");
  progressSection.querySelector(".progress").style.display = "none";
  progressMessage.style.display = "block";
  progressMessage.style.opacity = 1;
  progressMessage.textContent = "Generation complete!";
  setTimeout(() => {
    progressMessage.style.transition = "opacity 1s";
    progressMessage.style.opacity = 0;
    setTimeout(() => {
      progressMessage.style.display = "none";
      progressSection.style.display = "none";
      progressSection.querySelector(".progress").style.display = "block";
      updateProgress(0);
    }, 1000);
  }, 2000);
}

// --- Download Options ---
function downloadSteps() {
  if (steps.length === 0) {
    alert("No steps generated. Please generate the string art first.");
    return;
  }
  let content = "String Art Steps:\n";
  steps.forEach((step, idx) => {
    content += `${idx + 1}: From Pin ${step.from} to Pin ${step.to}\n`;
  });
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "string_art_steps.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSVG() {
    if (steps.length === 0) {
      alert("No steps generated. Please generate the string art first.");
      return;
    }
    let bgColor = darkMode ? "#333" : "#fff";
    let strokeColor = darkMode ? "rgba(255, 255, 255, 0.5)" : "#000";
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imgSize} ${imgSize}" width="${imgSize}" height="${imgSize}">`;
    svgContent += `<rect width="100%" height="100%" fill="${bgColor}"/>`;
    for (const step of steps) {
      const pFrom = pinCoords[step.from];
      const pTo = pinCoords[step.to];
      svgContent += `<line x1="${pFrom.x}" y1="${pFrom.y}" x2="${pTo.x}" y2="${pTo.y}" stroke="${strokeColor}" stroke-width="0.5" />`;
    }
    svgContent += `</svg>`;
    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "string_art.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
