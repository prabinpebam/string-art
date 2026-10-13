# String Studio

Created by Prabin Pebam.

Turn a photo into continuous string artwork, then export the design and the pin-by-pin instructions to make it with real thread.

[Try String Studio](https://prabinpebam.github.io/string-art/)

## Studio workflow

1. Choose an image from the upload card, drop it onto the preview, or paste a copied image with **Ctrl+V** (**Cmd+V** on macOS). Pasted images open the same crop dialog even when an image or generated artwork is already present. Confirming the crop replaces the workspace image and resets its generated artwork; cancelling keeps the current image/design.
2. Frame your subject in the square crop dialog. Drag to reposition; scroll or pinch to zoom. Cancel leaves your current design intact.
3. Adjust construction settings:
   - **Working resolution**: 500 x 500 (Fast), 1,024 x 1,024 (Balanced, default), 2,048 x 2,048 (Detail), or 4,096 x 4,096 (Maximum). This controls image sampling, generation, canvas backing size, and SVG dimensions, not preview zoom. Higher resolutions use more memory and take longer.
   - **Number of pins**: default 300, minimum 10. Pins are evenly spaced around a circle.
   - **Number of chords**: default 4,000, minimum 100. Each chord connects two pins; more chords build richer tones.
   - **Line weight**: default 20, minimum 1. This is the tone removed per chord, not the rendered stroke width (0.5 pixels). Smaller values layer more thread.
4. Choose **Dark thread** on white paper (targets shadows) or **Light thread** on dark paper (targets highlights).
5. Select **Generate string art**. The preview updates as the design builds. **Stop generation** keeps a partial design that can be exported.
6. Compare with **Original**, zoom to inspect details, or select **Fit**.
7. Download **SVG artwork** or **Pin steps (.txt)**.

Pins are numbered from **0** at the right edge, increasing clockwise. Each step begins where the preceding step ends. Step exports include the generated pin count, chord count, line weight, and resolution.

Changing settings does not silently replace the current artwork. Generate again to apply them. Until then, exports use the last generated settings and the preview marks the design as previous settings. Adjusting or replacing the crop resets the generated artwork.

Resolution can be chosen before uploading or changed later without cropping again. A source-detail master crop is retained separately from the working image; regenerating at a larger resolution resamples that master instead of enlarging the previous low-resolution crop. Small source images still cannot gain detail through upscaling. The preview dimensions badge shows the current design's size, which may differ from a pending resolution selection.

## Interface

The preview-first layout follows the companion Stipple Studio: a large preview, compact right-hand settings, grouped controls, upload card, segmented appearance controls, persistent actions, and a collapsible guide.

- On smaller screens, **Preview** and **Settings** switch views while generation and export actions remain accessible.
- Light/dark interface themes follow your system until explicitly selected; the preference is saved locally when storage is available. `?scoutTheme=light` or `?scoutTheme=dark` overrides the saved preference for that visit.
- Interface theme and artwork colors are independent. Switching the interface theme never regenerates or recolors artwork.
- Design tokens use the Clawpilot warm surfaces, a purple brand accent, Segoe UI typography, restrained borders, and consistent spacing.
- Generation/export controls reflect readiness and busy states. Progress and errors are announced through live status regions.
- Canvas backing resolution follows the current crop/design, independent of display size. Resizing, zooming, or switching views does not clear the design or change export geometry. Resolution editing is disabled while generating.

## How generation works

The cropped image is composited onto white paper and converted to grayscale. In dark-thread mode the per-pixel error is `255 - brightness`; light-thread mode uses `brightness`.

A greedy algorithm chooses the eligible chord with the highest total error, then subtracts line weight along its pixels. Recent pins are excluded to avoid repetitive connections. History is shortened for small pin counts so the minimum supported count can still finish.

Generation yields between time-budgeted chunks. Line samples are stored in typed arrays and cached for up to eight starting pins instead of precomputing every possible connection. Large pin counts and resolutions take longer; a single chord evaluation may exceed the chunk budget. Controls that could change a running design are disabled. A stopped run can be restarted from the crop.

All image processing happens locally. Cropper.js 1.5.13 and its stylesheet load from the existing CDN; a network connection is needed for those assets. A visible error appears if the crop library or image cannot load. Bootstrap is no longer required.

## Image inputs and formats

Upload, drop, and clipboard paste use the same importer. Screenshots and copied image pixels work through the browser's normal paste event, without clipboard-read permission. Text paste into settings remains unchanged. Copying an image URL or HTML alone does not import remote images.

- **Native browser formats:** PNG/APNG, JPEG/JFIF, WebP, AVIF, GIF, BMP, SVG, ICO/CUR, and any other format the browser can decode. Availability can vary by browser.
- **TIFF:** a local UTIF/pako fallback supports standard grayscale, RGB/RGBA, paletted, and CMYK images, with uncompressed, fax, LZW, JPEG, Deflate, and PackBits encodings supported by the decoder. Unsupported color layouts, floating-point/planar data, and BigTIFF produce a conversion suggestion rather than blank artwork.
- **HEIC/HEIF:** a local heic-to/libheif fallback converts images when the browser cannot decode them natively. Conversion runs in a worker; the first image in a sequence is used.
- **JPEG XL:** accepted and detected, but requires native browser support. Unsupported formats and damaged files display actionable errors.

File signatures take priority over filename extensions and MIME types. Known extensions work even when the operating system reports a blank or generic MIME type. Animated images and multi-page TIFFs use one frame/page. Images are normalized to PNG before cropping, retaining transparency until the crop is composited onto white paper.

The importer accepts files up to 100 MiB and decoded images up to 100 megapixels / 65,535 px per edge. Crop preparation limits the longest edge to 4,096 px, preserving aspect ratio and never enlarging small images. Native decoding may allocate the original image before dimensions can be checked. Cancelling or replacing an in-flight import prevents its result from replacing the current image. Upload/drop imports are blocked during generation, but image paste stops the active run and opens the crop dialog immediately. Cancelling that crop retains the stopped partial artwork, or the original crop if no chords were drawn. Superseded generation callbacks cannot overwrite a replacement image.

Fallback decoder assets are served from `vendor/` and lazy-loaded only when needed; images are never sent to a conversion service. Third-party licenses, notices, and source directions are included in `vendor/NOTICE.txt`.

## UI/UX audit and improvements

| Previous issue | Improvement |
| --- | --- |
| Fixed 400px sidebar and 480px minimum canvas overflowed narrow screens | Responsive studio with mobile Preview/Settings views and persistent actions |
| Blank canvas gave no starting guidance | Illustrated empty state, upload action, drag-and-drop affordance, and source hints |
| Controls lacked hierarchy and parameter explanations | Source, Construction, and Appearance groups with concise helper text |
| Resizing cleared the canvas | Stable backing resolution with independent display sizing and zoom |
| Dark mode coupled interface appearance to generation | Independent interface theme and explicit thread polarity |
| Exports and generation were available before the image was ready | Readiness/busy states, input validation, and inline error messages |
| Runs could overlap and mutate shared generation state | Isolated generated snapshots, locked editing during generation, and cancellation |
| All chord samples were allocated before progress could update | Time-budgeted generation with bounded typed-array caches |
| Small pin counts could exhaust history and never complete | Pin-count-aware history and explicit termination |
| Crop cancellation and changed settings did not clearly communicate what would be retained | Cancel preserves the design; changed settings are marked and exports retain the generated snapshot |
| Physical construction guidance was missing from exported steps | Pin numbering, orientation, and construction settings are included |

## Local development and validation

This is a static site with checked-in decoder assets. No build or package installation is needed to run it.

From the project directory, serve it with:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080`.

Run the algorithm/export and image-import tests with Node.js after installing the pinned test/vendor dependencies:

```powershell
npm ci --ignore-scripts --no-audit --no-fund --registry=https://packagefeedproxy.microsoft.io/npm/
npm test
```

To refresh decoder assets from the pinned packages, run `npm run vendor`. Keep the accompanying license files and notices when deploying or redistributing the site.

The tests cover all four resolution presets and matching export geometry, master-crop resampling, pin geometry, line sampling, minimum-pin completion, default 4,000-chord generation, artwork polarity, invalid settings, partial-design exports, format recognition, clipboard/drop selection, import limits, native normalization, TIFF decoding, and decoder failures. Browser validation should cover resolution changes, paste/upload/drop, TIFF/HEIC conversion, crop/cancel, generation/stop, downloads, source comparison, resizing, theme independence, and mobile view switching.
