# String Art Generator
by Prabin Pebam

This project generates string art from an input image by simulating the process of drawing continuous chords between pins arranged on a circle. The resulting artwork is a visual approximation of the original image, rendered on an HTML canvas.

## How It Works

1. **Image Processing:**
   - The user uploads an image, which is then cropped to a square and converted to grayscale.
   - The grayscale image is processed into an "error array" where each pixel’s error reflects its brightness.
     - In **light mode**, the error is calculated as `255 - brightness`, so darker regions (with lower brightness) have higher error.
     - In **dark mode**, the error is computed as `brightness`, targeting the bright areas instead.

2. **Pin Placement:**
   - A fixed number of pins (default 300) are placed evenly along the circumference of a circle within the image.
   - These pins act as anchor points for drawing chords (strings).

3. **Chord Selection & Error Reduction:**
   - The algorithm uses a greedy iterative approach:
     - It evaluates potential chords (lines connecting two pins) by summing the error values along each chord’s path.
     - The chord that results in the maximum error reduction is selected.
     - After drawing a chord, the error values along its path are decreased, simulating the “filling in” of that area.
   - This process is repeated for a specified number of chords (default 4000), gradually building up the string art.

4. **Rendering:**
   - The chosen chords are rendered on an HTML canvas with antialiasing enabled for smooth lines.
   - The canvas is resized to fit the available viewport while maintaining a square aspect ratio.
   - In **light mode**, the artwork is drawn as black strings on a white background.
   - In **dark mode**, the artwork is rendered as white strings on a dark grey background (`#333`).

5. **Dark Mode:**
   - A dark mode toggle in the control pane lets users switch between light and dark themes.
   - When dark mode is activated:
     - The canvas and its container immediately update to dark grey (`#333`).
     - The error calculation is reversed (using brightness directly) so that bright areas are targeted for string drawing.
     - If an image has already been cropped, the string art is regenerated immediately to reflect the new theme.

## Additional Features

- **Asynchronous Generation:**  
  The chord selection process is performed in asynchronous chunks to keep the UI responsive, with a progress bar displayed during generation.

- **Download Options:**  
  Users can download the generated chord steps as a text file or export the final string art as an SVG.

This approach combines creative coding techniques with modern web technologies to produce a dynamic and interactive string art generator.
