(function () {

  var stitchVideo = document.getElementById("stitch-video");
  var stitchPicker = document.getElementById("stitch-picker");
  var stitchHint = document.getElementById("stitch-hint");
  var stitchFile = document.getElementById("stitch-file");
  var stitchStartBtn = document.getElementById("stitch-start-btn");
  var stitchProgress = document.getElementById("stitch-progress");
  var stitchProgressLabel = document.getElementById("stitch-progress-label");
  var stitchProgressFill = document.getElementById("stitch-progress-fill");
  var stitchProgressDetail = document.getElementById("stitch-progress-detail");
  var stitchCancelBtn = document.getElementById("stitch-cancel-btn");
  var stitchViewer = document.getElementById("stitch-viewer");
  var stitchScroll = document.getElementById("stitch-scroll");
  var stitchCanvas = document.getElementById("stitch-canvas");
  var stitchImageFile = document.getElementById("stitch-image-file");
  var stitchDownloadBtn = document.getElementById("stitch-download-btn");
  var stitchRestartBtn = document.getElementById("stitch-restart-btn");
  var stageStitcher = document.getElementById("stage-stitcher");

  var objectUrl = null;
  var aborted = false;
  var stitching = false;

  // -- Seek --

  function seekTo(t) {
    return new Promise(function (resolve) {
      if (!stitchVideo.seeking && Math.abs(stitchVideo.currentTime - t) < 0.0001) {
        resolve();
        return;
      }
      stitchVideo.addEventListener("seeked", resolve, { once: true });
      stitchVideo.currentTime = t;
    });
  }

  // -- File load --

  function loadFile(file) {
    if (!file || !file.type.startsWith("video/")) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    stitchVideo.src = objectUrl;
  }

  stitchFile.addEventListener("change", function () {
    var file = stitchFile.files && stitchFile.files[0];
    if (file) loadFile(file);
  });

  // -- Drag and drop --

  stageStitcher.addEventListener("dragover", function (e) {
    e.preventDefault();
    stageStitcher.classList.add("drag-over");
  });

  stageStitcher.addEventListener("dragleave", function (e) {
    if (!stageStitcher.contains(e.relatedTarget)) {
      stageStitcher.classList.remove("drag-over");
    }
  });

  stageStitcher.addEventListener("drop", function (e) {
    e.preventDefault();
    stageStitcher.classList.remove("drag-over");
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  stitchVideo.addEventListener("loadedmetadata", function () {
    showPhase("picker");
    stitchHint.textContent =
      "Ready — " + Math.ceil(stitchVideo.duration) + "s video loaded. Click \"Stitch\" to begin.";
    stitchStartBtn.hidden = false;
  });

  // -- Phase management --

  function showPhase(phase) {
    stitchPicker.hidden = phase !== "picker";
    stitchProgress.hidden = phase !== "progress";
    stitchViewer.hidden = phase !== "viewer";
  }

  // -- Auto-detect scroll per frame (dy) --
  //
  // Compares pairs of adjacent frames to find how many pixels the image
  // shifts between each frame. Uses sum-of-absolute-differences (SAD) on a
  // small downsampled grayscale copy to keep analysis fast.

  async function detectDy(fps) {
    var duration = stitchVideo.duration;
    var W = stitchVideo.videoWidth;
    var H = stitchVideo.videoHeight;

    var AW = 64;
    var AH = Math.round(H * AW / W);
    var maxDy = Math.max(1, Math.floor(AH * 0.2));
    var stillThreshold = 6;

    var sampleStart = Math.floor(duration * 0.3 * fps);
    var detected = [];

    var ac = document.createElement("canvas");
    ac.width = AW; ac.height = AH;
    var ax = ac.getContext("2d");

    stitchProgressLabel.textContent = "Analyzing scroll rate...";
    stitchProgressFill.style.width = "0%";
    stitchProgressDetail.textContent = "";

    for (var si = 0; si < 8 && !aborted; si++) {
      var fA = sampleStart + si;
      if ((fA + 1) / fps >= duration) break;

      await seekTo(fA / fps);
      ax.drawImage(stitchVideo, 0, 0, AW, AH);
      var dA, gA;
      try {
        dA = ax.getImageData(0, 0, AW, AH).data;
      } catch (e) {
        // Canvas tainted — fall back to default dy
        ac.width = 1; ac.height = 1;
        return 4;
      }
      gA = new Uint8Array(AW * AH);
      for (var pi = 0; pi < gA.length; pi++) gA[pi] = (dA[pi * 4] + dA[pi * 4 + 1] + dA[pi * 4 + 2]) / 3;

      await seekTo((fA + 1) / fps);
      ax.drawImage(stitchVideo, 0, 0, AW, AH);
      var dB = ax.getImageData(0, 0, AW, AH).data;
      var gB = new Uint8Array(AW * AH);
      for (var qi = 0; qi < gB.length; qi++) gB[qi] = (dB[qi * 4] + dB[qi * 4 + 1] + dB[qi * 4 + 2]) / 3;

      var bestDy = 1, bestSad = Infinity;
      for (var testDy = 1; testDy <= maxDy; testDy++) {
        var sad = 0;
        for (var row = testDy; row < AH; row++) {
          for (var col = 0; col < AW; col++) {
            sad += Math.abs(gA[(row - testDy) * AW + col] - gB[row * AW + col]);
          }
        }
        var norm = sad / ((AH - testDy) * AW);
        if (norm < bestSad) { bestSad = norm; bestDy = testDy; }
      }

      if (bestSad <= stillThreshold) detected.push(bestDy);
      stitchProgressFill.style.width = ((si + 1) / 8 * 30) + "%";
      await new Promise(function (r) { setTimeout(r, 0); });
    }

    ac.width = 1; ac.height = 1;

    if (detected.length < 3) {
      stitchProgressLabel.textContent =
        "Auto-detect inconclusive (" + detected.length + " valid samples) — using 4 px/frame default";
      return 4;
    }

    detected.sort(function (a, b) { return a - b; });
    var median = detected[Math.floor(detected.length / 2)];
    return Math.max(1, Math.round(median * H / AH));
  }

  // -- Frame stitching loop --
  //
  // Synthesia notes scroll DOWN: top of frame = future, bottom = "now".
  // Between frame N and N+1 content shifts down by dy pixels.
  // We extract the top dy rows of each successive frame and stack them below.
  //
  // Layout in master canvas:
  //   Frame 0: full playfield occupies rows [0, H)
  //   Frame i (i>=1): top dy rows go at rows [H + (i-1)*dy, H + i*dy)
  //
  // Top of master = beginning of song. User scrolls DOWN to advance through time.

  async function startStitch() {
    if (stitching || !stitchVideo.duration) return;
    stitching = true;
    aborted = false;

    var fps = parseInt(document.getElementById("fps").value, 10) || 30;
    var duration = stitchVideo.duration;
    var W = stitchVideo.videoWidth;
    var H = stitchVideo.videoHeight;
    var frameCount = Math.floor(duration * fps);

    showPhase("progress");
    stitchProgressDetail.textContent = "Frame 0 / " + frameCount;

    try {
      var dy = await detectDy(fps);
      if (aborted) { stitching = false; showPhase("picker"); return; }

      var masterH = H + (frameCount - 1) * dy;
      if (masterH > 30000) {
        stitchProgressLabel.textContent =
          "Video too long — stitched canvas would be " + masterH +
          "px tall (browser limit ~30kpx). Lower the FPS or use a shorter clip.";
        stitching = false;
        return;
      }

      stitchCanvas.width = W;
      stitchCanvas.height = masterH;
      var mc = stitchCanvas.getContext("2d");

      var wc = document.createElement("canvas");
      wc.width = W; wc.height = H;
      var wx = wc.getContext("2d");

      stitchProgressLabel.textContent = "Stitching frames...";
      var t0 = performance.now();

      for (var i = 0; i < frameCount && !aborted; i++) {
        await seekTo(i / fps);
        wx.drawImage(stitchVideo, 0, 0, W, H);

        if (i === 0) {
          mc.drawImage(wc, 0, 0);
        } else {
          mc.drawImage(wc, 0, 0, W, dy, 0, H + (i - 1) * dy, W, dy);
        }

        stitchProgressFill.style.width = (30 + (i / frameCount) * 70) + "%";

        var elapsed = (performance.now() - t0) / 1000;
        var etaS = i > 0 ? Math.round((elapsed / i) * (frameCount - i)) : null;
        stitchProgressDetail.textContent =
          "Frame " + (i + 1) + " / " + frameCount +
          (etaS !== null
            ? " — ~" + (etaS < 60 ? etaS + "s" : Math.round(etaS / 60) + "m") + " remaining"
            : " — estimating...");

        if (i % 10 === 0) await new Promise(function (r) { setTimeout(r, 0); });
      }

      wc.width = 1; wc.height = 1;

      if (aborted) { stitching = false; showPhase("picker"); return; }

      stitching = false;
      showPhase("viewer");
      stitchScroll.scrollTop = 0;

    } catch (err) {
      stitching = false;
      stitchProgressLabel.textContent = "Stitch failed: " + err.message;
      stitchProgressDetail.textContent = "Try a different video format or check the browser console.";
      console.error("Stitch error:", err);
    }
  }

  // -- Load saved image --

  stitchImageFile.addEventListener("change", function () {
    var file = stitchImageFile.files && stitchImageFile.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      stitchCanvas.width = img.naturalWidth;
      stitchCanvas.height = img.naturalHeight;
      stitchCanvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      showPhase("viewer");
      stitchScroll.scrollTop = 0;
    };
    img.src = url;
  });

  stitchStartBtn.addEventListener("click", startStitch);
  stitchCancelBtn.addEventListener("click", function () { aborted = true; });

  stitchDownloadBtn.addEventListener("click", function () {
    stitchCanvas.toBlob(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "stitched-piano-roll.png";
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  });

  stitchRestartBtn.addEventListener("click", function () {
    showPhase("picker");
  });

  // -- Public API (called by app.js mode switch) --

  window.Stitcher = {
    activate: function () {},
    show: function () {},
    hide: function () {}
  };

  // -- Cleanup --

  window.addEventListener("beforeunload", function () {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

}());
