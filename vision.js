const TAU = Math.PI * 2;

function oddBetween(value, minimum, maximum) {
  const bounded = Math.max(minimum, Math.min(maximum, Math.round(value)));
  return bounded % 2 === 0 ? bounded + 1 : bounded;
}

function colourStats(imageData, cx, cy, radius, inner) {
  const { data, width, height } = imageData;
  let luminance = 0;
  let chroma = 0;
  let samples = 0;

  if (inner) {
    const limit = Math.max(1, Math.round(radius * 0.68));
    const step = Math.max(1, Math.round(radius / 4));
    for (let y = -limit; y <= limit; y += step) {
      for (let x = -limit; x <= limit; x += step) {
        if (x * x + y * y > limit * limit) continue;
        const px = Math.round(cx + x);
        const py = Math.round(cy + y);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const index = (py * width + px) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        samples += 1;
      }
    }
  } else {
    for (const multiplier of [1.45, 1.85]) {
      for (let index = 0; index < 24; index += 1) {
        const angle = (index / 24) * TAU;
        const px = Math.round(cx + Math.cos(angle) * radius * multiplier);
        const py = Math.round(cy + Math.sin(angle) * radius * multiplier);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const offset = (py * width + px) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        samples += 1;
      }
    }
  }

  return samples ? { luminance: luminance / samples, chroma: chroma / samples } : null;
}

function removeDuplicates(candidates) {
  const accepted = [];
  for (const candidate of candidates.sort((a, b) => b.quality - a.quality)) {
    const overlaps = accepted.some((existing) => {
      const distance = Math.hypot(candidate.x - existing.x, candidate.y - existing.y);
      return distance < Math.max(candidate.radius, existing.radius) * 0.9;
    });
    if (!overlaps) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Counts visible domino pips with local-contrast thresholding and contour filters.
 * The contour/radius approach is informed by the public-domain Domino_App_Project:
 * https://github.com/ZaneDaPayne/Domino_App_Project
 */
export class PipDetector {
  constructor(cv) {
    this.cv = cv;
  }

  detect(canvas, debugCanvas = null) {
    const cv = this.cv;
    const imageData = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    const minimumDimension = Math.min(canvas.width, canvas.height);
    const minimumRadius = Math.max(2, minimumDimension * 0.0035);
    const maximumRadius = Math.max(9, minimumDimension * 0.046);
    const blockSize = oddBetween(minimumDimension / 10, 25, 51);

    const source = cv.imread(canvas);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const binary = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    const candidates = [];
    const diagnostics = {
      contours: 0,
      radiusRejected: 0,
      shapeRejected: 0,
      backgroundRejected: 0,
      radiusDetails: [],
      shapeDetails: [],
      rejected: [],
    };

    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      cv.adaptiveThreshold(
        blurred,
        binary,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY_INV,
        blockSize,
        7,
      );
      cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel);
      if (debugCanvas) cv.imshow(debugCanvas, binary);
      // LIST keeps circular pip contours even when a domino edge, glare or an
      // existing camera overlay connects several foreground regions together.
      cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      diagnostics.contours = contours.size();

      for (let index = 0; index < contours.size(); index += 1) {
        const contour = contours.get(index);
        try {
          const area = cv.contourArea(contour, false);
          const perimeter = cv.arcLength(contour, true);
          if (area <= 0 || perimeter <= 0) continue;

          const circle = cv.minEnclosingCircle(contour);
          const { radius, center } = circle;
          if (radius < minimumRadius || radius > maximumRadius) {
            diagnostics.radiusRejected += 1;
            if (debugCanvas) diagnostics.radiusDetails.push({ x: center.x, y: center.y, radius });
            continue;
          }

          const bounds = cv.boundingRect(contour);
          const aspect = Math.max(bounds.width, bounds.height) / Math.max(1, Math.min(bounds.width, bounds.height));
          const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
          const fill = area / (Math.PI * radius * radius);
          if (aspect > 1.55 || circularity < 0.38 || fill < 0.34 || fill > 1.18) {
            diagnostics.shapeRejected += 1;
            if (debugCanvas) diagnostics.shapeDetails.push({ x: center.x, y: center.y, radius, aspect, circularity, fill });
            continue;
          }

          const inner = colourStats(imageData, center.x, center.y, radius, true);
          const outer = colourStats(imageData, center.x, center.y, radius, false);
          if (!inner || !outer) continue;

          const lightContrast = outer.luminance - inner.luminance;
          const colourContrast = inner.chroma - outer.chroma;
          const looksLikePipColour = inner.luminance < 120 || inner.chroma > 0.2;
          const sitsOnDomino =
            inner.luminance < 190 &&
            looksLikePipColour &&
            outer.luminance > 105 &&
            (lightContrast > 11 || colourContrast > 0.075);
          if (!sitsOnDomino) {
            diagnostics.backgroundRejected += 1;
            if (debugCanvas) {
              diagnostics.rejected.push({
                x: center.x,
                y: center.y,
                radius,
                innerLuminance: inner.luminance,
                outerLuminance: outer.luminance,
                innerChroma: inner.chroma,
                outerChroma: outer.chroma,
              });
            }
            continue;
          }

          const quality = circularity * 0.45 + Math.min(1, fill) * 0.2 + Math.min(1, Math.max(lightContrast / 55, colourContrast * 2)) * 0.35;
          candidates.push({
            x: center.x,
            y: center.y,
            radius,
            quality,
            contrast: Math.max(lightContrast, colourContrast * 100),
            innerLuminance: inner.luminance,
            outerLuminance: outer.luminance,
            innerChroma: inner.chroma,
            outerChroma: outer.chroma,
          });
        } finally {
          contour.delete();
        }
      }
    } finally {
      source.delete();
      gray.delete();
      blurred.delete();
      binary.delete();
      contours.delete();
      hierarchy.delete();
      kernel.delete();
    }

    const detections = removeDuplicates(candidates);
    const meanQuality = detections.length
      ? detections.reduce((sum, detection) => sum + detection.quality, 0) / detections.length
      : 0;

    return {
      count: detections.length,
      detections,
      confidence: Math.max(0, Math.min(1, meanQuality)),
      diagnostics,
    };
  }
}
