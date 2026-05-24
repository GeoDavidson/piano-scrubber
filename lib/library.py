import json
import pathlib

VIDEOS_DIR = pathlib.Path(__file__).parent.parent / "videos"
LIBRARY_JS = VIDEOS_DIR / "library.js"


def _load() -> list:
    if not LIBRARY_JS.exists():
        return []
    text = LIBRARY_JS.read_text(encoding="utf-8").strip()
    prefix = "const LIBRARY = "
    if text.startswith(prefix):
        text = text[len(prefix):]
    if text.endswith(";"):
        text = text[:-1]
    return json.loads(text)


def save(entries: list) -> None:
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    js = "const LIBRARY = " + json.dumps(entries, indent=2, ensure_ascii=False) + ";"
    LIBRARY_JS.write_text(js, encoding="utf-8")


def add_entry(meta: dict) -> None:
    entries = [e for e in _load() if e.get("id") != meta["id"]]
    entries.insert(0, meta)
    save(entries)


def remove_entry(video_id: str) -> None:
    save([e for e in _load() if e.get("id") != video_id])
