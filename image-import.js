"use strict";

(() => {
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_SOURCE_PIXELS = 100000000;
  const MAX_SOURCE_EDGE = 65535;
  const MIME_TYPES = {
    jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg",
    png: "image/png", apng: "image/png", webp: "image/webp", avif: "image/avif",
    gif: "image/gif", bmp: "image/bmp", dib: "image/bmp", ico: "image/x-icon",
    cur: "image/x-icon", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
    heic: "image/heic", heif: "image/heif", hif: "image/heif", jxl: "image/jxl"
  };
  const decoderScripts = new Map();

  function inspectHeader(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    if (bytes.length >= 24 && ascii(0, 8) === "\x89PNG\r\n\x1a\n") {
      return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) {
      return { type: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { type: "image/jpeg" };
    if (bytes.length >= 26 && ascii(0, 2) === "BM") {
      return view.getUint32(14, true) === 12 ?
        { type: "image/bmp", width: view.getUint16(18, true), height: view.getUint16(20, true) } :
        { type: "image/bmp", width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    }
    if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { type: "image/webp" };
    if (bytes.length >= 6 && view.getUint16(0, true) === 0 && [1, 2].includes(view.getUint16(2, true))) return { type: "image/x-icon" };
    if (bytes.length >= 4 && ["II*\0", "MM\0*", "II+\0", "MM\0+"].includes(ascii(0, 4))) return { type: "image/tiff" };
    if (bytes.length >= 12 && ascii(4, 4) === "ftyp") {
      const brands = [ascii(8, 4)];
      const end = Math.min(bytes.length, view.getUint32(0), 256);
      for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(offset, 4));
      if (brands.some(brand => ["avif", "avis"].includes(brand))) return { type: "image/avif" };
      if (brands.some(brand => ["heic", "heix", "hevc", "hevx"].includes(brand))) return { type: "image/heic" };
      if (brands.some(brand => ["mif1", "msf1"].includes(brand))) return { type: "image/heif" };
    }
    if ((bytes[0] === 255 && bytes[1] === 10) ||
        (bytes.length >= 12 && ascii(4, 8) === "JXL \r\n\x87\n")) return { type: "image/jxl" };
    const text = new TextDecoder().decode(bytes.subarray(0, 4096));
    if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      return { type: "image/svg+xml" };
    }
    return {};
  }

  function fileType(file, header = {}) {
    if (header.type) return header.type;
    const extension = (file.name || "").split(".").pop().toLowerCase();
    if (Object.hasOwn(MIME_TYPES, extension)) return MIME_TYPES[extension];
    const type = (file.type || "").toLowerCase();
    if (["image/jpg", "image/pjpeg"].includes(type)) return "image/jpeg";
    if (type === "image/x-tiff") return "image/tiff";
    return type.startsWith("image/") ? type : null;
  }

  function transferFile(transfer) {
    if (!transfer) return null;
    const items = Array.from(transfer.items || []);
    const files = items.filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean);
    files.push(...Array.from(transfer.files || []));
    return files.find(file => fileType(file)) ||
      files.find(file => !file.type || file.type === "application/octet-stream") || null;
  }

  function validateFile(file) {
    if (!file.size) throw new Error("This file is empty. Choose an image containing data.");
    if (file.size > MAX_FILE_BYTES) throw new Error("This image exceeds the 100 MiB limit. Resize or compress it before importing.");
  }

  function validateDimensions(width, height) {
    if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1) {
      throw new Error("The image has invalid dimensions.");
    }
    if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
      throw new Error("This image exceeds the 100 megapixel or 65,535 px edge limit. Resize it before importing.");
    }
  }

  function workingSize(width, height, edge = 4096) {
    validateDimensions(width, height);
    const scale = Math.min(1, edge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function withTimeout(promise, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 60000);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function loadDecoder(path) {
    if (decoderScripts.has(path)) return decoderScripts.get(path);
    const loaded = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = path;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error("The local image decoder could not load. Reload the page and try again."));
      };
      document.head.append(script);
    });
    const request = withTimeout(loaded, "Loading the image decoder timed out. Reload the page and try again.")
      .catch(error => {
        decoderScripts.delete(path);
        throw error;
      });
    decoderScripts.set(path, request);
    return request;
  }

  function nativeImage(blob) {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    return withTimeout(new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The browser could not decode this image."));
      image.src = url;
    }), "Image decoding timed out. Try a smaller image.").then(source => {
      URL.revokeObjectURL(url);
      return source;
    }, error => {
      image.src = "";
      URL.revokeObjectURL(url);
      throw error;
    }).finally(() => { image.onload = image.onerror = null; });
  }

  function validateTIFFPage(page, byteLength) {
    validateDimensions(page.t256?.[0], page.t257?.[0]);
    const compression = page.t259?.[0] || 1;
    if (![1, 3, 4, 5, 6, 7, 8, 32773, 32809].includes(compression) ||
        page.t284?.[0] === 2 || page.t339?.some(value => value !== 1)) {
      throw new Error("This TIFF encoding is unsupported. Export it as PNG or a standard interleaved TIFF.");
    }
    const offsets = page.t273 || page.t324;
    const lengths = page.t279 || page.t325;
    if (!offsets?.length || !lengths?.length || offsets.length !== lengths.length ||
        offsets.some((offset, i) => !Number.isSafeInteger(offset) || !Number.isSafeInteger(lengths[i]) ||
          offset < 0 || lengths[i] < 1 || offset + lengths[i] > byteLength)) {
      throw new Error("This TIFF contains missing or damaged pixel data.");
    }
  }

  function orientTIFF(canvas, orientation) {
    if (orientation === 1 || !orientation) return canvas;
    if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
      throw new Error("This TIFF has an invalid orientation.");
    }
    const width = canvas.width, height = canvas.height;
    const oriented = document.createElement("canvas");
    oriented.width = orientation >= 5 ? height : width;
    oriented.height = orientation >= 5 ? width : height;
    const context = oriented.getContext("2d");
    const transforms = {
      2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height],
      4: [1, 0, 0, -1, 0, height], 5: [0, 1, 1, 0, 0, 0],
      6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width],
      8: [0, -1, 1, 0, 0, width]
    };
    context.setTransform(...transforms[orientation]);
    context.drawImage(canvas, 0, 0);
    return oriented;
  }

  async function decodeTIFF(blob) {
    await loadDecoder("vendor/pako.min.js");
    await loadDecoder("vendor/UTIF.js");
    const buffer = await blob.arrayBuffer();
    const signature = new Uint8Array(buffer);
    if (signature[2] === 43 || signature[3] === 43) throw new Error("BigTIFF is unsupported. Export it as PNG or a standard TIFF.");
    const pages = globalThis.UTIF.decode(buffer);
    const page = pages.find(value => value.t256 && value.t257);
    if (!page) throw new Error("This TIFF contains no image page.");
    validateTIFFPage(page, buffer.byteLength);
    globalThis.UTIF.decodeImage(buffer, page, pages);
    const photo = page.t262?.[0] ?? 2;
    const bits = page.t258?.[0] ?? 1;
    const supportedBits = { 0: [1, 4, 8], 1: [1, 2, 8, 16], 2: [8, 16], 3: [8], 5: [8] };
    if (!supportedBits[photo]?.includes(bits)) {
      throw new Error("This TIFF color encoding is unsupported. Export it as PNG or an RGB TIFF.");
    }
    if ((page.t258 && page.t258.some(value => value !== bits)) ||
        (photo === 2 && ![3, 4].includes(page.t258?.length || 3)) ||
        (photo === 5 && ![4, 5].includes(page.t258?.length || 4)) ||
        (photo === 3 && !(page.t320?.length >= 768))) {
      throw new Error("This TIFF channel layout is unsupported. Export it as PNG or an RGB TIFF.");
    }
    const rgba = globalThis.UTIF.toRGBA8(page);
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), page.width, page.height), 0, 0);
    return orientTIFF(canvas, page.t274?.[0] || 1);
  }

  async function prepare(file) {
    validateFile(file);
    const header = inspectHeader(await file.slice(0, 256 * 1024).arrayBuffer());
    const type = fileType(file, header);
    if (!type) throw new Error("Choose an image file, such as PNG, JPEG, WebP, SVG, TIFF, or HEIC.");
    if (header.width !== undefined) validateDimensions(header.width, header.height);
    const blob = file.slice(0, file.size, type);
    let source;
    try {
      try {
        source = await nativeImage(blob);
      } catch (nativeError) {
        if (type === "image/tiff") {
          console.info("Using the local TIFF decoder; native decoding is unavailable.");
          source = await decodeTIFF(blob);
        } else if (["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"].includes(type)) {
          console.info("Using the local HEIC/HEIF decoder; native decoding is unavailable.");
          await loadDecoder("vendor/heic-to.js");
          const converted = await withTimeout(
            globalThis.HeicTo({ blob, type: "image/png" }),
            "HEIC/HEIF conversion timed out. Try a smaller image."
          );
          source = await nativeImage(converted);
        } else {
          throw new Error("This image is damaged or its format is unsupported by your browser. Convert it to PNG, JPEG, or WebP.", { cause: nativeError });
        }
      }
      const width = source.naturalWidth || source.width;
      const height = source.naturalHeight || source.height;
      const dimensions = workingSize(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The image-processing canvas could not be allocated. Try a smaller image.");
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const normalized = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not prepare this image for cropping.")), "image/png");
      });
      return { blob: normalized, type, width, height };
    } catch (error) {
      throw new Error(`Could not import ${file.name || "the pasted image"}. ${error.message || "Try converting it to PNG or JPEG."}`, { cause: error });
    } finally {
      if (source && typeof source.src === "string") source.src = "";
    }
  }

  const importer = { inspectHeader, fileType, transferFile, validateFile, validateDimensions, workingSize, validateTIFFPage, prepare, MAX_FILE_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = importer;
  else globalThis.ImageImport = importer;
})();
