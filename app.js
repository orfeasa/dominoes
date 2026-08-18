import { PipDetector } from "./vision.js";

const elements = {
  shell: document.querySelector(".app-shell"),
  stage: document.querySelector("#camera-stage"),
  video: document.querySelector("#camera"),
  photoCanvas: document.querySelector("#photo-canvas"),
  detectionCanvas: document.querySelector("#detection-canvas"),
  analysisCanvas: document.querySelector("#analysis-canvas"),
  gate: document.querySelector("#camera-gate"),
  gateMessage: document.querySelector("#gate-message"),
  startCamera: document.querySelector("#start-camera"),
  photoTriggers: document.querySelectorAll("[data-choose-photo]"),
  photoInput: document.querySelector("#photo-input"),
  torchButton: document.querySelector("#torch-button"),
  score: document.querySelector("#score"),
  statusLine: document.querySelector("#status-line"),
  statusText: document.querySelector("#status-text"),
  freezeButton: document.querySelector("#freeze-button"),
  frozenControls: document.querySelector("#frozen-controls"),
  decrement: document.querySelector("#decrement-score"),
  increment: document.querySelector("#increment-score"),
  scanAgain: document.querySelector("#scan-again"),
};

const state = {
  detector: null,
  stream: null,
  track: null,
  frameRequest: null,
  fallbackTimer: null,
  lastAnalysis: 0,
  history: [],
  rawScore: 0,
  displayedScore: 0,
  adjustment: 0,
  stable: false,
  frozen: false,
  usingPhoto: false,
  torchOn: false,
  detectorFailed: false,
};

const MAX_HISTORY = 9;
const ANALYSIS_INTERVAL = 190;

function setStatus(message, status = "idle") {
  elements.statusText.textContent = message;
  elements.statusLine.dataset.state = status;
}

function setScore(value) {
  state.displayedScore = Math.max(0, Math.round(value));
  elements.score.value = String(state.displayedScore);
  elements.score.textContent = String(state.displayedScore);
}

function showGate(message, isError = false) {
  elements.stage.classList.remove("camera-active");
  elements.gateMessage.textContent = message;
  elements.gateMessage.classList.toggle("error", isError);
  elements.startCamera.textContent = isError ? "Try camera again" : "Start camera";
}

function coverSource(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return { sx: (sourceWidth - width) / 2, sy: 0, sw: width, sh: sourceHeight };
  }
  const height = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - height) / 2, sw: sourceWidth, sh: height };
}

function sizeAnalysisCanvas() {
  const stageWidth = Math.max(1, elements.stage.clientWidth);
  const stageHeight = Math.max(1, elements.stage.clientHeight);
  // Keep enough source pixels to separate dense Double-12 pips, while matching
  // the displayed stage aspect ratio so detection rings stay aligned.
  const width = 540;
  const height = Math.max(1, Math.round(width * (stageHeight / stageWidth)));
  if (elements.analysisCanvas.width !== width || elements.analysisCanvas.height !== height) {
    elements.analysisCanvas.width = width;
    elements.analysisCanvas.height = height;
    elements.detectionCanvas.width = width;
    elements.detectionCanvas.height = height;
    state.history = [];
  }
}

function drawSourceToAnalysis(source, sourceWidth, sourceHeight) {
  sizeAnalysisCanvas();
  const canvas = elements.analysisCanvas;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const crop = coverSource(sourceWidth, sourceHeight, canvas.width, canvas.height);
  context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
}

function fitSourceToAnalysis(source, sourceWidth, sourceHeight) {
  sizeAnalysisCanvas();
  const canvas = elements.analysisCanvas;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  context.fillStyle = "#0a0a0a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, x, y, width, height);
}

function drawDetections(detections, stable = false) {
  const canvas = elements.detectionCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = stable ? 3 : 2;
  context.strokeStyle = stable ? "oklch(0.76 0.16 145)" : "oklch(0.65 0.15 145)";
  context.shadowColor = "oklch(0.08 0 0 / 0.85)";
  context.shadowBlur = 3;
  for (const detection of detections) {
    context.beginPath();
    context.arc(detection.x, detection.y, Math.max(4, detection.radius * 1.12), 0, Math.PI * 2);
    context.stroke();
  }
  context.shadowBlur = 0;
}

function stableReading(count) {
  state.history.push(count);
  if (state.history.length > MAX_HISTORY) state.history.shift();

  const frequencies = new Map();
  for (const value of state.history) frequencies.set(value, (frequencies.get(value) || 0) + 1);
  const ranked = [...frequencies.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [mode, frequency] = ranked[0] || [count, 1];
  const recent = state.history.slice(-6);
  const spread = recent.length ? Math.max(...recent) - Math.min(...recent) : Infinity;
  const stable = state.history.length >= 5 && frequency >= 5 && spread <= 1;
  return { score: stable ? mode : count, stable };
}

function updateLiveResult(result) {
  state.rawScore = result.count;
  const reading = stableReading(result.count);
  state.stable = reading.stable;
  setScore(reading.score);
  drawDetections(result.detections, reading.stable);
  elements.freezeButton.disabled = false;

  if (result.count === 0) {
    setStatus("No pips found", "ready");
  } else if (reading.stable) {
    setStatus(`${reading.score} pips · score ready`, "stable");
  } else if (state.history.length < 4) {
    setStatus("Finding pips…", "ready");
  } else {
    setStatus("Hold steady", "ready");
  }
}

function processAnalysisFrame() {
  if (!state.detector || state.frozen) return;
  try {
    const result = state.detector.detect(elements.analysisCanvas);
    updateLiveResult(result);
  } catch (error) {
    console.error(error);
    setStatus("Detector paused · try again", "error");
  }
}

function scheduleNextFrame() {
  if (!state.stream || state.frozen) return;
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    state.frameRequest = elements.video.requestVideoFrameCallback(analyseVideoFrame);
  } else {
    state.fallbackTimer = window.setTimeout(() => analyseVideoFrame(performance.now()), ANALYSIS_INTERVAL);
  }
}

function analyseVideoFrame(now) {
  if (!state.stream || state.frozen) return;
  if (now - state.lastAnalysis >= ANALYSIS_INTERVAL && elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    state.lastAnalysis = now;
    drawSourceToAnalysis(elements.video, elements.video.videoWidth, elements.video.videoHeight);
    processAnalysisFrame();
  }
  scheduleNextFrame();
}

function stopFrameLoop() {
  if (state.frameRequest !== null && "cancelVideoFrameCallback" in HTMLVideoElement.prototype) {
    elements.video.cancelVideoFrameCallback(state.frameRequest);
  }
  if (state.fallbackTimer !== null) window.clearTimeout(state.fallbackTimer);
  state.frameRequest = null;
  state.fallbackTimer = null;
}

async function loadDetector() {
  if (state.detector || state.detectorFailed) return state.detector;
  setStatus("Loading detector…", "idle");
  try {
    const cv = await window.__opencvReady;
    state.detector = new PipDetector(cv);
    return state.detector;
  } catch (error) {
    state.detectorFailed = true;
    console.error(error);
    setStatus("Detector could not load", "error");
    showGate("The detector could not load. Check the connection and try again.", true);
    return null;
  }
}

async function configureTorch() {
  elements.torchButton.hidden = true;
  if (!state.track?.getCapabilities) return;
  const capabilities = state.track.getCapabilities();
  if (!capabilities.torch) return;
  elements.torchButton.hidden = false;
}

async function stopCamera() {
  stopFrameLoop();
  for (const track of state.stream?.getTracks?.() || []) track.stop();
  state.stream = null;
  state.track = null;
  elements.video.srcObject = null;
}

async function startCamera() {
  elements.startCamera.disabled = true;
  elements.startCamera.textContent = "Starting camera…";
  setStatus("Starting camera…", "idle");

  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    showGate("The camera needs a secure HTTPS connection. Choose a photo for now.", true);
    setStatus("HTTPS required for camera", "error");
    elements.startCamera.disabled = false;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showGate("This browser cannot open a live camera. Choose a photo instead.", true);
    setStatus("Live camera unavailable", "error");
    elements.startCamera.disabled = false;
    return;
  }

  try {
    await stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    state.track = state.stream.getVideoTracks()[0] || null;
    elements.video.srcObject = state.stream;
    await elements.video.play();
    state.usingPhoto = false;
    state.frozen = false;
    state.history = [];
    state.adjustment = 0;
    elements.stage.classList.add("camera-active");
    elements.stage.classList.remove("photo-mode", "frozen");
    elements.freezeButton.hidden = false;
    elements.frozenControls.hidden = true;
    elements.freezeButton.disabled = true;
    setStatus("Loading detector…", "idle");
    await configureTorch();
    if (await loadDetector()) {
      setStatus("Point at the dominoes", "ready");
      scheduleNextFrame();
    }
  } catch (error) {
    console.error(error);
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    showGate(
      denied
        ? "Camera access is off. Allow it in your browser settings, then try again—or choose a photo."
        : "The camera did not start. Try again or choose a photo.",
      true,
    );
    setStatus(denied ? "Camera access is off" : "Camera did not start", "error");
  } finally {
    elements.startCamera.disabled = false;
  }
}

function snapshotCurrentFrame() {
  const canvas = elements.photoCanvas;
  canvas.width = elements.analysisCanvas.width;
  canvas.height = elements.analysisCanvas.height;
  canvas.getContext("2d", { alpha: false }).drawImage(elements.analysisCanvas, 0, 0);
}

function freezeScore() {
  if (elements.freezeButton.disabled) return;
  state.frozen = true;
  state.adjustment = 0;
  stopFrameLoop();
  snapshotCurrentFrame();
  elements.stage.classList.add("frozen");
  elements.freezeButton.hidden = true;
  elements.frozenControls.hidden = false;
  setStatus(`${state.displayedScore} pips · frozen`, "stable");
}

function adjustScore(delta) {
  state.adjustment += delta;
  setScore(state.displayedScore + delta);
  setStatus(`${state.displayedScore} pips · corrected`, "stable");
}

async function scanAgain() {
  state.frozen = false;
  state.adjustment = 0;
  state.history = [];
  state.stable = false;
  elements.stage.classList.remove("frozen", "photo-mode");
  elements.freezeButton.hidden = false;
  elements.freezeButton.disabled = true;
  elements.frozenControls.hidden = true;
  setScore(0);
  drawDetections([]);

  if (state.stream) {
    await elements.video.play();
    setStatus("Point at the dominoes", "ready");
    scheduleNextFrame();
  } else {
    await startCamera();
  }
}

async function loadPhoto(file) {
  if (!file) return;
  setStatus("Reading photo…", "idle");
  const detector = await loadDetector();
  if (!detector) return;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    elements.stage.classList.add("camera-active", "photo-mode");
    elements.stage.classList.remove("frozen");
    state.usingPhoto = true;
    state.frozen = true;
    stopFrameLoop();
    fitSourceToAnalysis(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    snapshotCurrentFrame();
    const result = detector.detect(elements.analysisCanvas);
    state.rawScore = result.count;
    state.history = Array(MAX_HISTORY).fill(result.count);
    state.stable = true;
    setScore(result.count);
    drawDetections(result.detections, true);
    elements.freezeButton.hidden = true;
    elements.frozenControls.hidden = false;
    setStatus(result.count ? `${result.count} pips · photo counted` : "No pips found in photo", result.count ? "stable" : "ready");
  } catch (error) {
    console.error(error);
    setStatus("Could not read that photo", "error");
  } finally {
    elements.photoInput.value = "";
  }
}

async function toggleTorch() {
  if (!state.track) return;
  try {
    state.torchOn = !state.torchOn;
    await state.track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
    elements.torchButton.title = state.torchOn ? "Turn flash off" : "Turn flash on";
    elements.torchButton.querySelector(".sr-only").textContent = elements.torchButton.title;
    elements.torchButton.setAttribute("aria-pressed", String(state.torchOn));
  } catch (error) {
    state.torchOn = false;
    console.error(error);
    setStatus("Flash is unavailable", "error");
  }
}

elements.startCamera.addEventListener("click", startCamera);
for (const trigger of elements.photoTriggers) trigger.addEventListener("click", () => elements.photoInput.click());
elements.photoInput.addEventListener("change", (event) => loadPhoto(event.target.files?.[0]));
elements.freezeButton.addEventListener("click", freezeScore);
elements.decrement.addEventListener("click", () => adjustScore(-1));
elements.increment.addEventListener("click", () => adjustScore(1));
elements.scanAgain.addEventListener("click", scanAgain);
elements.torchButton.addEventListener("click", toggleTorch);
window.addEventListener("resize", () => {
  if (!state.frozen && state.stream) state.history = [];
});
window.addEventListener("pagehide", stopCamera);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}

loadDetector().then((detector) => {
  if (detector && !state.stream && !state.usingPhoto) setStatus("Camera not started", "idle");
});
