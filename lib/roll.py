import pathlib

import cv2
import numpy as np


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _frame_to_row(frame_bgr: np.ndarray, y0: int, bh: int) -> np.ndarray:
    h = frame_bgr.shape[0]
    y0 = _clamp(y0, 0, h - 1)
    bh = _clamp(bh, 1, h - y0)
    return frame_bgr[y0:y0 + bh, :, :].mean(axis=0).astype(np.uint8)


def _boost_saturation(img: np.ndarray, factor: float) -> np.ndarray:
    """Multiply the HSV saturation channel by factor, clamp to 0-255."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * factor, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def build_roll(
    video_path: pathlib.Path,
    out_path: pathlib.Path,
    *,
    speed: float = 0.2,
    scale: float = 0.5,
    y: int = 24,
    band_h: int = 1,
    frame_step: int = 1,
    start_sec: float = 0.0,
    end_sec: float = 0.0,
    show_preview: bool = False,
    saturation: float = 1.4,
) -> None:
    """Build a scrollable piano-roll image from a Synthesia-style video."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    if start_sec > 0:
        cap.set(cv2.CAP_PROP_POS_MSEC, start_sec * 1000.0)

    ok, first = cap.read()
    if not ok:
        raise RuntimeError("Could not read first frame — check start_sec / file.")

    if scale != 1.0:
        first = cv2.resize(first, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    H, W = first.shape[:2]
    y_c = _clamp(y, 0, H - 1)
    bh_c = _clamp(band_h, 1, H)

    # Re-open so we don't skip the first frame
    cap.release()
    cap = cv2.VideoCapture(str(video_path))
    if start_sec > 0:
        cap.set(cv2.CAP_PROP_POS_MSEC, start_sec * 1000.0)

    end_msec = end_sec * 1000.0 if end_sec > 0 else None
    rows = []
    frame_idx = 0
    repeat = int(round(1.0 / speed)) if speed < 1.0 else 1

    print("  [roll] processing", end="", flush=True)

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if scale != 1.0:
            frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

        if end_msec is not None and cap.get(cv2.CAP_PROP_POS_MSEC) >= end_msec:
            break

        if frame_idx % frame_step == 0:
            row = _frame_to_row(frame, y_c, bh_c)
            for _ in range(repeat):
                rows.append(row)

        if show_preview:
            vis = frame.copy()
            cv2.line(vis, (0, y_c), (W - 1, y_c), (255, 255, 255), 1)
            cv2.line(vis, (0, y_c + bh_c), (W - 1, y_c + bh_c), (255, 255, 255), 1)
            cv2.imshow("Preview (ESC to stop)", vis)
            if cv2.waitKey(int(round(1000 / fps))) & 0xFF == 27:
                break

        frame_idx += 1
        if frame_idx % 500 == 0:
            print(".", end="", flush=True)

    cap.release()
    if show_preview:
        cv2.destroyAllWindows()

    if not rows:
        raise RuntimeError("No frames were processed — check settings.")

    out = np.stack(rows[::-1], axis=0)
    if saturation != 1.0:
        out = _boost_saturation(out, saturation)
    cv2.imwrite(str(out_path), out)
    print(f" done (W={out.shape[1]}, H={out.shape[0]})")
