import pathlib

import cv2


def extract_keyboard(
    video_path: pathlib.Path,
    out_path: pathlib.Path,
    *,
    at_sec: float = 0.0,
    kb_top: int,
    kb_bot: int,
    scale: float = 1.0,
) -> None:
    """Crop rows kb_top:kb_bot (original coords) from the frame at at_sec.

    scale must match the value used for build_roll so both images end up
    the same pixel width.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open: {video_path}")

    if at_sec > 0:
        cap.set(cv2.CAP_PROP_POS_MSEC, at_sec * 1000.0)

    ok, frame = cap.read()
    cap.release()

    if not ok or frame is None:
        raise RuntimeError(
            f"Could not read frame at {at_sec:.2f}s — "
            "is the timestamp within the video duration?"
        )

    if scale != 1.0:
        frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    h = frame.shape[0]
    top = max(0, min(int(kb_top * scale), h - 1))
    bot = max(top + 1, min(int(kb_bot * scale), h))
    cv2.imwrite(str(out_path), frame[top:bot])
    print(f"  [keyboard] rows {top}–{bot} at t={at_sec}s  (scale={scale})")
