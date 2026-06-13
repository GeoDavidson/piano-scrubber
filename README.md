# piano-thing

Turn a Synthesia YouTube video into a scrollable, learnable piano roll webpage.

## Quick start

**1. Install dependencies**
```
pip install -r requirements.txt
```
> Note: merging audio+video formats requires **ffmpeg** on your PATH.
> Download from https://ffmpeg.org/download.html if needed.

**2. Add a video**
```
python add.py "https://www.youtube.com/watch?v=<id>" --keyboard-time 1.0
```

**3. Open `index.html`** in your browser — the video appears as a card.
Click it to open the scrollable roll viewer.

---

## All options

| Flag | Default | Description |
|------|---------|-------------|
| `--keyboard-time SEC` | `0.0` | Timestamp (seconds) to grab the keyboard screenshot from |
| `--keyboard-height PX` | `180` | Pixels to crop from the bottom of the frame |
| `--title TEXT` | YouTube title | Override the gallery title |
| `--speed FLOAT` | `0.2` | Roll stretch factor (lower = more spread out) |
| `--scale FLOAT` | `0.5` | Frame scale (0.5 = half res, faster processing) |
| `--y INT` | `24` | Y-position of the note-sampling band |
| `--start SEC` | `0` | Start time in the video |
| `--end SEC` | `0` | End time (0 = until end) |
| `--keep-video` | off | Keep `source.mp4` after processing |
| `--preview` | off | Show OpenCV preview window while building roll |
| `--open` | off | Open the gallery in a browser when done |
| `--reprocess` | off | Re-use cached video and overwrite roll/keyboard |

## Re-processing a video

If the keyboard alignment is off, adjust `--keyboard-time` without re-downloading:

```
python add.py "https://..." --reprocess --keyboard-time 2.5
```

## Aligning the roll with the keyboard

Open `viewer.html` and tweak the two CSS variables at the top:

```css
--roll-scale: 0.769;   /* shrink/grow the roll horizontally */
--roll-x: -18px;       /* shift the roll left (-) or right (+) */
```

## File layout

```
videos/
  library.js            ← auto-updated index (loaded by index.html)
  <video-id>/
    roll.png            ← scrollable piano roll
    keyboard.png        ← keyboard at bottom of viewer
    thumb.jpg           ← gallery thumbnail
    meta.json           ← title, URL, settings used
```