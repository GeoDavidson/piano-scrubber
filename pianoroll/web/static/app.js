const video = document.getElementById("video-source");
const canvas = document.getElementById("frame-canvas");
const ctx = canvas.getContext("2d");
const picker = document.getElementById("picker");
const fileInput = document.getElementById("video-file");
const hud = document.getElementById("hud");
const hudFrame = document.getElementById("hud-frame");
const hudTime = document.getElementById("hud-time");
const hudDuration = document.getElementById("hud-duration");
const progressBar = document.getElementById("progress-bar");
const progressFill = document.getElementById("progress-fill");
const selectionFill = document.getElementById("selection-fill");
const sensitivityInput = document.getElementById("sensitivity");
const sensitivityValue = document.getElementById("sensitivity-value");
const fpsInput = document.getElementById("fps");
const scrubAudioToggle = document.getElementById("scrub-audio");
const stage = document.getElementById("stage");

// Selection / playback elements
const selInBtn = document.getElementById("sel-in-btn");
const selOutBtn = document.getElementById("sel-out-btn");
const selClearBtn = document.getElementById("sel-clear-btn");
const selPlayBtn = document.getElementById("sel-play-btn");
const selLoopToggle = document.getElementById("sel-loop");
const selSpeedInput = document.getElementById("sel-speed");
const selSpeedValue = document.getElementById("sel-speed-value");
const selInfo = document.getElementById("sel-info");
const accentInput = document.getElementById("accent-color");

const state = {
  duration: 0,
  fps: 30,
  sensitivity: 3,
  currentTime: 0,
  frameTime: 1 / 30,
  seeking: false,
  pendingTime: null,
  objectUrl: null,
  // Audio scrub
  audioCtx: null,
  audioBuffer: null,
  scrubAudio: true,
  lastAudioMs: 0,   // throttle: only one snippet per snippet-duration
  // Selection / playback
  selIn: null,
  selOut: null,
  playing: false,
  looping: true,
  playbackSpeed: 1.0,
  playRafId: null,
};

// ── Formatting ──

function formatTime(sec) {
  var m = Math.floor(sec / 60);
  var s = sec - m * 60;
  return m + ":" + s.toFixed(3).padStart(6, "0");
}

// ── Audio scrub ──

function initAudioContext() {
  if (state.audioCtx) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function decodeAudioFromFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    initAudioContext();
    state.audioCtx.decodeAudioData(reader.result, function (buffer) {
      state.audioBuffer = buffer;
    }, function () {
      state.audioBuffer = null;
    });
  };
  reader.readAsArrayBuffer(file);
}

function playScrubSnippet(time) {
  if (!state.scrubAudio || !state.audioBuffer || !state.audioCtx) return;

  // Throttle to one snippet per snippet-duration. The previous snippet's
  // scheduled gain envelope fades it to silence at exactly snippetDuration —
  // so we must NOT call stop() early. An early stop() is immediate and fires
  // while the gain is still non-zero, which is what causes the click/pop.
  // Instead we let each snippet expire on its own and only start the next one
  // once the prior fade-out has completed (~58 ms).
  var nowMs = performance.now();
  if (nowMs - state.lastAudioMs < 58) return;
  state.lastAudioMs = nowMs;

  var snippetDuration = 0.06;
  var fadeDuration = 0.008;
  var offset = Math.max(0, Math.min(time, state.audioBuffer.duration - snippetDuration));
  if (offset < 0) offset = 0;

  var actx = state.audioCtx;
  var now = actx.currentTime;

  var gain = actx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + fadeDuration);
  gain.gain.setValueAtTime(1, now + snippetDuration - fadeDuration);
  gain.gain.linearRampToValueAtTime(0, now + snippetDuration);
  gain.connect(actx.destination);

  var source = actx.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(gain);
  source.start(0, offset, snippetDuration);
  // No stop() call — the source's scheduled duration + gain ramp handle
  // clean termination. The AudioContext GCs nodes after they finish.
}

// ── HUD ──

function updateSelectionOverlay() {
  if (state.selIn !== null && state.selOut !== null && state.duration > 0) {
    var leftPct = (state.selIn / state.duration) * 100;
    var widthPct = ((state.selOut - state.selIn) / state.duration) * 100;
    selectionFill.style.left = leftPct + "%";
    selectionFill.style.width = widthPct + "%";
    selectionFill.style.display = "block";
  } else {
    selectionFill.style.display = "none";
  }
}

function updateHud() {
  var frame = Math.round(state.currentTime * state.fps);
  hudFrame.textContent = "Frame " + frame;
  hudTime.textContent = formatTime(state.currentTime);
  var pct = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
  progressFill.style.width = pct + "%";
  updateSelectionOverlay();
}

function updateSelInfo() {
  if (state.selIn !== null && state.selOut !== null) {
    var inF = Math.round(state.selIn * state.fps);
    var outF = Math.round(state.selOut * state.fps);
    selInfo.textContent = "Frame " + inF + " \u2014 " + outF + " (" + formatTime(state.selOut - state.selIn) + ")";
    selPlayBtn.disabled = false;
  } else if (state.selIn !== null) {
    selInfo.textContent = "In: Frame " + Math.round(state.selIn * state.fps);
    selPlayBtn.disabled = true;
  } else {
    selInfo.textContent = "";
    selPlayBtn.disabled = true;
  }
}

// ── Seek pipeline ──

function drawFrame() {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  updateHud();
}

// Clamp time to selection bounds when looping is active, wrapping around
function clampWithLoop(t) {
  if (state.looping && state.selIn !== null && state.selOut !== null) {
    var len = state.selOut - state.selIn;
    if (len > 0) {
      if (t > state.selOut) {
        // Wrap forward past out → back to in
        t = state.selIn + ((t - state.selIn) % len);
      } else if (t < state.selIn) {
        // Wrap backward past in → to out
        var diff = state.selIn - t;
        t = state.selOut - (diff % len);
      }
    }
  }
  return Math.max(0, Math.min(t, state.duration));
}

function seekToTime(t, scrubSound) {
  t = clampWithLoop(t);
  state.currentTime = t;

  if (scrubSound !== false) {
    playScrubSnippet(t);
  }

  if (state.seeking) {
    state.pendingTime = t;
    return;
  }

  state.seeking = true;
  video.currentTime = t;
}

video.addEventListener("seeked", function () {
  drawFrame();
  if (state.pendingTime !== null) {
    var t = state.pendingTime;
    state.pendingTime = null;
    state.currentTime = t;
    video.currentTime = t;
  } else {
    state.seeking = false;
  }
});

// ── File loading ──

function loadFile(file) {
  if (!file || !file.type.startsWith("video/")) return;

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }

  stopPlayback();
  clearSelection();

  state.objectUrl = URL.createObjectURL(file);
  video.src = state.objectUrl;

  // Decode audio for scrub snippets
  state.audioBuffer = null;
  decodeAudioFromFile(file);
}

fileInput.addEventListener("change", function () {
  var file = fileInput.files && fileInput.files[0];
  if (file) loadFile(file);
});

video.addEventListener("loadedmetadata", function () {
  state.duration = video.duration;
  state.currentTime = 0;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  picker.style.display = "none";
  canvas.style.display = "block";
  hud.style.display = "flex";

  hudDuration.textContent = formatTime(state.duration);

  seekToTime(0, false);
});

// ── Drag and drop ──

stage.addEventListener("dragover", function (e) {
  if (currentMode !== "scrubber") return;
  e.preventDefault();
  stage.classList.add("drag-over");
});

stage.addEventListener("dragleave", function (e) {
  if (currentMode !== "scrubber") return;
  if (!stage.contains(e.relatedTarget)) {
    stage.classList.remove("drag-over");
  }
});

stage.addEventListener("drop", function (e) {
  if (currentMode !== "scrubber") return;
  e.preventDefault();
  stage.classList.remove("drag-over");
  var file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// ── Scroll handling ──
// Batch multiple wheel ticks within a single animation frame into one seek.
// This prevents a backlog of pending seeks when scrolling quickly, keeping
// the display in sync with input and eliminating perceptible lag.

var _wheelAccum = 0;
var _wheelRaf = null;

stage.addEventListener("wheel", function (e) {
  if (currentMode !== "scrubber") return;
  if (state.duration === 0) return;
  e.preventDefault();
  stopPlayback();
  _wheelAccum += -Math.sign(e.deltaY) * state.sensitivity * state.frameTime;
  if (!_wheelRaf) {
    _wheelRaf = requestAnimationFrame(function () {
      _wheelRaf = null;
      var d = _wheelAccum;
      _wheelAccum = 0;
      seekToTime(state.currentTime + d);
    });
  }
}, { passive: false });

// ── Touch handling ──

var touchStartY = null;
var touchStartTime = 0;

stage.addEventListener("touchstart", function (e) {
  if (currentMode !== "scrubber") return;
  if (state.duration === 0) return;
  stopPlayback();
  touchStartY = e.touches[0].clientY;
  touchStartTime = state.currentTime;
}, { passive: true });

stage.addEventListener("touchmove", function (e) {
  if (currentMode !== "scrubber") return;
  if (state.duration === 0 || touchStartY === null) return;
  e.preventDefault();
  var deltaY = e.touches[0].clientY - touchStartY;
  var frameDelta = Math.round(deltaY / 10) * state.sensitivity;
  var newTime = touchStartTime + frameDelta * state.frameTime;
  seekToTime(newTime);
}, { passive: false });

stage.addEventListener("touchend", function () {
  touchStartY = null;
});

// ── Keyboard ──

document.addEventListener("keydown", function (e) {
  if (currentMode !== "scrubber") return;
  if (state.duration === 0) return;
  if (e.target.tagName === "INPUT") return;

  switch (e.key) {
    case "ArrowRight":
      e.preventDefault();
      stopPlayback();
      seekToTime(state.currentTime + state.frameTime);
      break;
    case "ArrowLeft":
      e.preventDefault();
      stopPlayback();
      seekToTime(state.currentTime - state.frameTime);
      break;
    case "PageDown":
      e.preventDefault();
      stopPlayback();
      seekToTime(state.currentTime + 1);
      break;
    case "PageUp":
      e.preventDefault();
      stopPlayback();
      seekToTime(state.currentTime - 1);
      break;
    case "Home":
      e.preventDefault();
      stopPlayback();
      seekToTime(0);
      break;
    case "End":
      e.preventDefault();
      stopPlayback();
      seekToTime(state.duration);
      break;
    case " ":
      e.preventDefault();
      if (state.playing) {
        stopPlayback();
      } else if (state.selIn !== null && state.selOut !== null) {
        startPlayback();
      }
      break;
    case "i":
      e.preventDefault();
      setSelIn();
      break;
    case "o":
      e.preventDefault();
      setSelOut();
      break;
  }
});

// ── Progress bar ──

function seekFromProgressBar(e) {
  var rect = progressBar.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekToTime(ratio * state.duration);
}

var progressDragging = false;

progressBar.addEventListener("mousedown", function (e) {
  if (state.duration === 0) return;
  stopPlayback();
  progressDragging = true;
  seekFromProgressBar(e);
});

document.addEventListener("mousemove", function (e) {
  if (progressDragging) {
    seekFromProgressBar(e);
  }
});

document.addEventListener("mouseup", function () {
  progressDragging = false;
});

// ── Controls ──

sensitivityInput.addEventListener("input", function () {
  state.sensitivity = parseInt(sensitivityInput.value, 10);
  sensitivityValue.textContent = sensitivityInput.value;
});

fpsInput.addEventListener("change", function () {
  var v = parseInt(fpsInput.value, 10);
  if (v >= 1 && v <= 120) {
    state.fps = v;
    state.frameTime = 1 / v;
    updateSelInfo();
  }
});

scrubAudioToggle.addEventListener("change", function () {
  state.scrubAudio = scrubAudioToggle.checked;
  if (state.scrubAudio && state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
});

selSpeedInput.addEventListener("input", function () {
  var v = parseFloat(selSpeedInput.value);
  state.playbackSpeed = v;
  selSpeedValue.textContent = v.toFixed(1) + "x";
  // Apply live to playing video
  if (state.playing) {
    video.playbackRate = v;
  }
});

// ── Selection ──

function setSelIn() {
  state.selIn = state.currentTime;
  if (state.selOut !== null && state.selOut <= state.selIn) {
    state.selOut = null;
  }
  updateSelInfo();
  updateSelectionOverlay();
}

function setSelOut() {
  if (state.selIn === null) return;
  if (state.currentTime <= state.selIn) return;
  state.selOut = state.currentTime;
  updateSelInfo();
  updateSelectionOverlay();
}

function clearSelection() {
  stopPlayback();
  state.selIn = null;
  state.selOut = null;
  updateSelInfo();
  updateSelectionOverlay();
}

selInBtn.addEventListener("click", setSelIn);
selOutBtn.addEventListener("click", setSelOut);
selClearBtn.addEventListener("click", clearSelection);

selLoopToggle.addEventListener("change", function () {
  state.looping = selLoopToggle.checked;
});

// ── Playback ──

function startPlayback() {
  if (state.selIn === null || state.selOut === null) return;
  if (state.playing) return;

  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }

  state.playing = true;
  selPlayBtn.innerHTML = "Stop <kbd>space</kbd>";

  video.currentTime = state.selIn;
  state.currentTime = state.selIn;
  video.playbackRate = state.playbackSpeed;
  video.play();

  function onFrame() {
    if (!state.playing) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    state.currentTime = video.currentTime;
    updateHud();

    if (video.currentTime >= state.selOut) {
      if (state.looping) {
        video.currentTime = state.selIn;
        state.currentTime = state.selIn;
      } else {
        stopPlayback();
        return;
      }
    }

    state.playRafId = requestAnimationFrame(onFrame);
  }

  state.playRafId = requestAnimationFrame(onFrame);
}

function stopPlayback() {
  if (!state.playing) return;
  state.playing = false;
  video.pause();
  video.playbackRate = 1.0;
  selPlayBtn.innerHTML = "Play <kbd>space</kbd>";
  if (state.playRafId) {
    cancelAnimationFrame(state.playRafId);
    state.playRafId = null;
  }
  drawFrame();
}

selPlayBtn.addEventListener("click", function () {
  if (state.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

// ── Accent color ──

function toHex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

function applyAccent(hex) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  // bright: blend 65% original + 35% white
  var bright = "#" + toHex2(r * 0.65 + 89.25) + toHex2(g * 0.65 + 89.25) + toHex2(b * 0.65 + 89.25);
  // dim: 70% of original
  var dim = "#" + toHex2(r * 0.7) + toHex2(g * 0.7) + toHex2(b * 0.7);
  var root = document.documentElement;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-bright", bright);
  root.style.setProperty("--accent-dim", dim);
  root.style.setProperty("--accent-glow", "rgba(" + r + "," + g + "," + b + ",0.15)");
  root.style.setProperty("--accent-glow-strong", "rgba(" + r + "," + g + "," + b + ",0.3)");
  try { localStorage.setItem("accent", hex); } catch (_) {}
}

// Restore saved accent on load
(function () {
  try {
    var saved = localStorage.getItem("accent");
    if (saved && /^#[0-9a-f]{6}$/i.test(saved)) {
      accentInput.value = saved;
      applyAccent(saved);
    }
  } catch (_) {}
}());

accentInput.addEventListener("input", function () {
  applyAccent(accentInput.value);
});

// ── Cleanup ──

window.addEventListener("beforeunload", function () {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }
  if (state.audioCtx) {
    state.audioCtx.close();
  }
});

// ── Mode switching ──

var currentMode = "scrubber";
var stitcherActivated = false;

var modeScrubBtn = document.getElementById("mode-scrub-btn");
var modeStitchBtn = document.getElementById("mode-stitch-btn");
var stageScrubber = document.getElementById("stage-scrubber");
var stageStitcher = document.getElementById("stage-stitcher");

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  if (mode === "stitcher") {
    stopPlayback();
    stageScrubber.hidden = true;
    stageStitcher.hidden = false;
    hud.style.display = "none";
    modeScrubBtn.classList.remove("active");
    modeStitchBtn.classList.add("active");
    if (!stitcherActivated) {
      stitcherActivated = true;
      window.Stitcher.activate();
    } else {
      window.Stitcher.show();
    }
  } else {
    stageStitcher.hidden = true;
    stageScrubber.hidden = false;
    if (state.duration > 0) hud.style.display = "flex";
    modeStitchBtn.classList.remove("active");
    modeScrubBtn.classList.add("active");
    window.Stitcher.hide();
  }
}

modeScrubBtn.addEventListener("click", function () { setMode("scrubber"); });
modeStitchBtn.addEventListener("click", function () { setMode("stitcher"); });
