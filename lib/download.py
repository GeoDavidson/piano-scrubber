import pathlib
import shutil
import urllib.request

import yt_dlp


def _video_format() -> str:
    """Best available format: merges highest-quality streams if ffmpeg is present."""
    if shutil.which("ffmpeg"):
        return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
    return "best[ext=mp4]/best[ext=webm]/best"


def get_info(url: str) -> dict:
    """Fetch video metadata without downloading. Returns {id, title, url, thumbnail}."""
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "id": info["id"],
        "title": info.get("title", info["id"]),
        "url": url,
        "thumbnail": info.get("thumbnail", ""),
    }


def download_video(url: str, video_dir: pathlib.Path, thumb_url: str, *, skip_if_exists: bool = False) -> pathlib.Path:
    """Download video to video_dir/source.mp4 and thumbnail to video_dir/thumb.jpg."""
    video_dir.mkdir(parents=True, exist_ok=True)
    mp4_path = video_dir / "source.mp4"
    thumb_path = video_dir / "thumb.jpg"

    if skip_if_exists and mp4_path.exists():
        print("  [skip] using cached source.mp4")
    else:
        ydl_opts = {
            "format": _video_format(),
            "outtmpl": str(mp4_path),
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        print(f"  [downloaded] source.mp4")

    if not thumb_path.exists() and thumb_url:
        urllib.request.urlretrieve(thumb_url, str(thumb_path))
        print("  [thumbnail] saved")

    return mp4_path
