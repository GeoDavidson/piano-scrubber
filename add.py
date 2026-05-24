"""
add.py  —  one-command pipeline: YouTube URL → piano roll webpage.

Usage:
  python add.py <youtube-url> [options]

Run `python add.py --help` for all options.
"""

import argparse
import datetime
import json
import pathlib
import sys
import webbrowser

ROOT = pathlib.Path(__file__).parent
VIDEOS_DIR = ROOT / "videos"

sys.path.insert(0, str(ROOT))

from lib import download as dl
from lib import gui as gui_mod
from lib import keyboard as kb
from lib import library as lib
from lib import roll


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Add a YouTube video to the piano-thing library.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("url", help="YouTube video URL")

    # Roll generation (power-user overrides; GUI handles keyboard / timing)
    p.add_argument("--title",  default=None,  help="override the gallery title")
    p.add_argument("--speed",      type=float, default=0.2,  help="roll stretch (default: 0.2)")
    p.add_argument("--scale",      type=float, default=1.0,  help="frame scale 0–1 (default: 1.0 = full quality)")
    p.add_argument("--saturation", type=float, default=1.4,  help="colour saturation boost on roll (default: 1.4, 1.0 = off)")
    p.add_argument("--y",      type=int,   default=24,   help="note-sampling band y (default: 24)")

    # Behaviour
    p.add_argument("--keep-video",  action="store_true", help="keep source.mp4 after processing")
    p.add_argument("--preview",     action="store_true", help="show OpenCV preview while building roll")
    p.add_argument("--open",        action="store_true", dest="open_browser",
                   help="open the gallery in a browser when done")
    p.add_argument("--reprocess",   action="store_true",
                   help="re-use cached source.mp4 and overwrite roll / keyboard images")

    return p.parse_args()


def _load_saved_settings(meta_file: pathlib.Path) -> dict:
    """Return settings from an existing meta.json, or empty dict."""
    try:
        return json.loads(meta_file.read_text(encoding="utf-8")).get("settings", {})
    except Exception:
        return {}


def main() -> None:
    args = parse_args()

    # ── 0. Fetch metadata (no download) ────────────────────────────────────
    print("[0/5] Fetching video info…")
    info = dl.get_info(args.url)
    video_id  = info["id"]
    title     = args.title or info["title"]
    video_dir = VIDEOS_DIR / video_id
    meta_file = video_dir / "meta.json"

    print(f"       Title : {title}")
    print(f"       ID    : {video_id}")

    if meta_file.exists() and not args.reprocess:
        print(f"\nVideo already in library (id={video_id}).")
        print("Pass --reprocess to overwrite roll and keyboard images.")
        sys.exit(0)

    # ── 1. Download ──────────────────────────────────────────────────────────
    print("\n[1/5] Downloading…")
    mp4_path = dl.download_video(
        args.url, video_dir, info["thumbnail"],
        skip_if_exists=args.reprocess,
    )

    if not mp4_path.exists():
        print(f"ERROR: {mp4_path} was not created.", file=sys.stderr)
        sys.exit(1)

    # Pre-fill GUI from saved settings when reprocessing
    saved = _load_saved_settings(meta_file) if args.reprocess else {}

    # ── 2. GUI parameter picker ──────────────────────────────────────────────
    print("\n[2/5] Opening parameter picker…")
    params = gui_mod.get_parameters(
        mp4_path, title,
        keyboard_time = saved.get("keyboard_time", 0.0),
        kb_top        = saved.get("kb_top",        0),
        kb_bot        = saved.get("kb_bot",        0),
        y             = saved.get("y",             args.y),
        start_sec     = saved.get("start_sec",     0.0),
        end_sec       = saved.get("end_sec",       0.0),
    )

    if params is None:
        print("Cancelled.")
        if not args.reprocess:
            mp4_path.unlink(missing_ok=True)
            try: video_dir.rmdir()
            except OSError: pass
        sys.exit(0)

    keyboard_time = params["keyboard_time"]
    kb_top        = params["kb_top"]
    kb_bot        = params["kb_bot"]
    note_y        = params["y"]
    start_sec     = params["start_sec"]
    end_sec       = params["end_sec"]

    # ── 3. Build roll ────────────────────────────────────────────────────────
    print("\n[3/5] Building piano roll…")
    roll.build_roll(
        mp4_path, video_dir / "roll.png",
        speed      = args.speed,
        scale      = args.scale,
        y          = note_y,
        start_sec  = start_sec,
        end_sec    = end_sec,
        show_preview = args.preview,
        saturation = args.saturation,
    )

    # ── 4. Extract keyboard ──────────────────────────────────────────────────
    print("\n[4/5] Extracting keyboard…")
    kb.extract_keyboard(
        mp4_path, video_dir / "keyboard.png",
        at_sec = keyboard_time,
        kb_top = kb_top,
        kb_bot = kb_bot,
        scale  = args.scale,
    )

    if not args.keep_video:
        mp4_path.unlink(missing_ok=True)
        print("  [cleanup] removed source.mp4  (--keep-video to retain)")

    # ── 5. Update library ────────────────────────────────────────────────────
    print("\n[5/5] Updating library…")
    meta_record = {
        "id":       video_id,
        "title":    title,
        "url":      args.url,
        "added_at": datetime.datetime.utcnow().isoformat() + "Z",
        "settings": {
            "keyboard_time": keyboard_time,
            "kb_top":        kb_top,
            "kb_bot":        kb_bot,
            "y":             note_y,
            "speed":         args.speed,
            "scale":         args.scale,
            "start_sec":     start_sec,
            "end_sec":       end_sec,
        },
    }
    meta_file.write_text(json.dumps(meta_record, indent=2, ensure_ascii=False), encoding="utf-8")
    lib.add_entry(meta_record)
    print(f"  [library] '{title}' added")

    print("\nDone!  Open index.html to view the gallery.")

    if args.open_browser:
        webbrowser.open(str(ROOT / "index.html"))


if __name__ == "__main__":
    main()
