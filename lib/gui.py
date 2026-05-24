"""Interactive parameter picker — canvas with draggable lines."""

import pathlib
import tkinter as tk
from tkinter import ttk, messagebox

import cv2
import numpy as np

try:
    from PIL import Image, ImageTk
except ImportError:
    raise SystemExit("Pillow is required: pip install Pillow")

PREVIEW_W = 854
DRAG_ZONE = 10      # px hit-zone around each draggable line
SCROLL_STEP = 1.0   # seconds per scroll-wheel notch


def _ts(s: float) -> str:
    s = max(0.0, s)
    m, sec = divmod(int(s), 60)
    return f"{m}:{sec:02d}.{int((s % 1) * 10)}"


def _to_photo(bgr: np.ndarray, w: int, h: int) -> "ImageTk.PhotoImage":
    resized = cv2.resize(bgr, (max(1, w), max(1, h)), interpolation=cv2.INTER_AREA)
    return ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)))


def get_parameters(
    video_path: pathlib.Path,
    title: str,
    *,
    keyboard_time: float = 0.0,
    kb_top: int = 0,
    kb_bot: int = 0,
    y: int = 24,
    start_sec: float = 0.0,
    end_sec: float = 0.0,
) -> dict | None:
    """Open the parameter picker.

    Returns {keyboard_time, kb_top, kb_bot, y, start_sec, end_sec}
    or None if cancelled.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open: {video_path}")

    orig_w    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps       = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_sec = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    preview_h = int(PREVIEW_W * orig_h / orig_w) if orig_w else 480
    yscale    = preview_h / orig_h if orig_h else 1.0

    def _to_cv(orig):  return int(orig * yscale)
    def _to_orig(cv):  return int(cv / yscale)

    # Draggable line canvas-y positions
    note_y = [_to_cv(y)]
    top_y  = [_to_cv(kb_top) if kb_top > 0 else int(preview_h * 0.75)]
    bot_y  = [_to_cv(kb_bot) if kb_bot > 0 else preview_h - 2]

    result: dict = {}
    cancelled  = [False]
    pending    = [None]
    last_frame = [None]
    dragging   = [None]   # 'note' | 'top' | 'bot' | None

    # ── Root ─────────────────────────────────────────────────────────────────
    root = tk.Tk()
    root.title(f"Piano Thing — {title[:70]}")
    root.resizable(False, False)

    BG, BG2  = "#1c1c1c", "#252525"
    FG, DIM  = "#e8e8e8", "#666666"
    ACCENT   = "#5a96d8"
    GREEN    = "#88dd00"   # note sampling line
    CYAN     = "#00ddff"   # keyboard top
    RED      = "#ff5f5f"   # keyboard bottom

    root.configure(bg=BG)

    st = ttk.Style()
    st.theme_use("clam")
    st.configure("TScale",  background=BG, troughcolor="#3a3a3a", sliderthickness=18)
    st.configure("TButton", background="#333", foreground=FG, borderwidth=0, padding="6 4")
    st.map("TButton", background=[("active", "#444")])
    st.configure("Go.TButton", background=ACCENT, foreground="#fff",
                 padding="10 6", font=("", 10, "bold"))
    st.map("Go.TButton", background=[("active", "#4880bc")])

    outer = tk.Frame(root, bg=BG, padx=10, pady=8)
    outer.pack()

    tk.Label(outer, text=title, bg=BG, fg=FG, font=("", 11, "bold"),
             wraplength=PREVIEW_W, justify="left").pack(anchor="w", pady=(0, 4))

    # ── Canvas ────────────────────────────────────────────────────────────────
    canvas = tk.Canvas(outer, width=PREVIEW_W, height=preview_h,
                       bg="#000", highlightthickness=0, cursor="arrow")
    canvas.pack()
    _img_id = canvas.create_image(0, 0, anchor="nw")

    def _draw_overlay():
        canvas.delete("ov")
        ny, ty, by = note_y[0], top_y[0], bot_y[0]

        # Keyboard region tint
        canvas.create_rectangle(0, ty, PREVIEW_W, by,
                                fill=CYAN, stipple="gray25", outline="", tags="ov")

        # Note sampling line (green)
        canvas.create_line(0, ny, PREVIEW_W, ny, fill=GREEN, width=2, dash=(6, 4), tags="ov")
        canvas.create_rectangle(6, ny + 3, 200, ny + 17,
                                fill=BG, outline="", tags="ov")
        canvas.create_text(8, ny + 10, text="— Note sampling line (drag me)",
                           anchor="w", fill=GREEN, font=("", 8, "bold"), tags="ov")

        # Keyboard top (cyan)
        canvas.create_line(0, ty, PREVIEW_W, ty, fill=CYAN, width=2, tags="ov")
        canvas.create_rectangle(6, ty - 17, 196, ty - 3,
                                fill=BG, outline="", tags="ov")
        canvas.create_text(8, ty - 10, text="▲ Keyboard top (drag me)",
                           anchor="w", fill=CYAN, font=("", 8, "bold"), tags="ov")

        # Keyboard bottom (red)
        canvas.create_line(0, by, PREVIEW_W, by, fill=RED, width=2, tags="ov")
        canvas.create_rectangle(6, by + 3, 202, by + 17,
                                fill=BG, outline="", tags="ov")
        canvas.create_text(8, by + 10, text="▼ Keyboard bottom (drag me)",
                           anchor="w", fill=RED, font=("", 8, "bold"), tags="ov")

    def _show_frame(frame: np.ndarray):
        photo = _to_photo(frame, PREVIEW_W, preview_h)
        canvas.itemconfig(_img_id, image=photo)
        canvas._photo = photo
        _draw_overlay()

    def _refresh_kb():
        frame = last_frame[0]
        if frame is None:
            return
        ty_o = max(0, _to_orig(top_y[0]))
        by_o = min(orig_h, _to_orig(bot_y[0]))
        strip = frame[ty_o:by_o]
        if strip.shape[0] > 0:
            disp_h = max(1, int((by_o - ty_o) * yscale))
            photo = _to_photo(strip, PREVIEW_W, disp_h)
            kb_lbl.configure(image=photo, height=disp_h)
            kb_lbl.image = photo

    def _load_frame(sec: float):
        cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000.0)
        ok, frame = cap.read()
        if ok:
            last_frame[0] = frame
            _show_frame(frame)
            _refresh_kb()

    # StringVar for the time label — created before any widget so _go_to can
    # safely reference it regardless of widget creation order.
    cur_time_sv = tk.StringVar(value=f"  {_ts(keyboard_time)}")
    cur_sec = [keyboard_time]
    _in_goto = [False]   # reentrance guard: slider.set() re-fires the command

    def _go_to(sec: float, immediate: bool = False):
        if _in_goto[0]:
            return
        sec = max(0.0, min(total_sec, sec))
        cur_sec[0] = sec
        cur_time_sv.set(f"  {_ts(sec)}")
        _in_goto[0] = True
        slider.set(sec)
        _in_goto[0] = False
        if immediate:
            _load_frame(sec)
        else:
            if pending[0]: root.after_cancel(pending[0])
            pending[0] = root.after(60, lambda: _load_frame(sec))

    # ── Canvas mouse drag ─────────────────────────────────────────────────────
    def _near(y_pos, target): return abs(y_pos - target) <= DRAG_ZONE

    def on_press(e):
        dists = {"note": abs(e.y - note_y[0]),
                 "top":  abs(e.y - top_y[0]),
                 "bot":  abs(e.y - bot_y[0])}
        closest = min(dists, key=dists.get)
        dragging[0] = closest if dists[closest] <= DRAG_ZONE else None

    def on_drag(e):
        if dragging[0] == "note":
            note_y[0] = max(0, min(e.y, preview_h - 1))
        elif dragging[0] == "top":
            top_y[0] = max(0, min(e.y, bot_y[0] - 10))
        elif dragging[0] == "bot":
            bot_y[0] = max(top_y[0] + 10, min(e.y, preview_h - 2))
        else:
            return
        _draw_overlay()
        if dragging[0] in ("top", "bot"):
            _refresh_kb()

    def on_release(e): dragging[0] = None

    def on_motion(e):
        near_any = (_near(e.y, note_y[0]) or
                    _near(e.y, top_y[0]) or
                    _near(e.y, bot_y[0]))
        canvas.configure(cursor="sb_v_double_arrow" if near_any else "arrow")

    # ── Scroll wheel ──────────────────────────────────────────────────────────
    def on_scroll(e):
        # Windows: delta is ±120 per notch; positive = scroll up = go back
        step = SCROLL_STEP * (-1 if e.delta > 0 else 1)
        _go_to(cur_sec[0] + step, immediate=True)

    canvas.bind("<ButtonPress-1>",   on_press)
    canvas.bind("<B1-Motion>",       on_drag)
    canvas.bind("<ButtonRelease-1>", on_release)
    canvas.bind("<Motion>",          on_motion)
    canvas.bind("<MouseWheel>",      on_scroll)

    # ── Scrub slider ──────────────────────────────────────────────────────────
    srow = tk.Frame(outer, bg=BG)
    srow.pack(fill="x", pady=(4, 0))
    tk.Label(srow, text="0:00", bg=BG, fg=DIM, font=("", 8)).pack(side="left")
    slider = ttk.Scale(srow, from_=0, to=max(total_sec, 1),
                       orient="horizontal",
                       command=lambda v: _go_to(float(v)))
    slider.set(keyboard_time)
    slider.pack(side="left", fill="x", expand=True, padx=6)
    tk.Label(srow, text=_ts(total_sec), bg=BG, fg=DIM, font=("", 8)).pack(side="right")

    tk.Label(outer, textvariable=cur_time_sv, bg=BG, fg=ACCENT, font=("", 9)
             ).pack(anchor="w", pady=(2, 6))

    # ── Keyboard strip preview ────────────────────────────────────────────────
    tk.Label(outer, text="Keyboard crop preview:", bg=BG, fg=DIM, font=("", 9)
             ).pack(anchor="w", pady=(0, 2))
    kb_lbl = tk.Label(outer, bg="#111", width=PREVIEW_W, height=80)
    kb_lbl.pack()

    # ── Time stamp buttons ────────────────────────────────────────────────────
    _kb_time = [keyboard_time]
    _start   = [start_sec]
    _end     = [end_sec]

    kb_time_sv = tk.StringVar(value=_ts(keyboard_time))
    start_sv   = tk.StringVar(value=_ts(start_sec))
    end_sv     = tk.StringVar(value=_ts(end_sec))

    def _set_kb():    _kb_time[0] = cur_sec[0]; kb_time_sv.set(_ts(cur_sec[0]))
    def _set_start(): _start[0]   = cur_sec[0]; start_sv.set(_ts(cur_sec[0]))
    def _set_end():   _end[0]     = cur_sec[0]; end_sv.set(_ts(cur_sec[0]))

    trow = tk.Frame(outer, bg=BG)
    trow.pack(fill="x", pady=(10, 0))

    def _time_col(parent, col, name, hint, sv, cmd):
        f = tk.Frame(parent, bg=BG2, padx=10, pady=8)
        f.grid(row=0, column=col, sticky="nsew", padx=(0 if col == 0 else 8, 0))
        parent.columnconfigure(col, weight=1)
        tk.Label(f, text=name,  bg=BG2, fg=DIM,    font=("", 8)             ).pack(anchor="w")
        tk.Label(f, textvariable=sv, bg=BG2, fg=ACCENT, font=("", 13, "bold")).pack(anchor="w")
        tk.Label(f, text=hint,  bg=BG2, fg=DIM,    font=("", 7)             ).pack(anchor="w")
        ttk.Button(f, text="← Set from current", command=cmd).pack(anchor="w", pady=(6, 0))

    _time_col(trow, 0, "Keyboard time",  "",                   kb_time_sv, _set_kb)
    _time_col(trow, 1, "Start time",     "0:00.0 = beginning", start_sv,   _set_start)
    _time_col(trow, 2, "End time",       "0:00.0 = until end", end_sv,     _set_end)

    # ── Bottom bar ────────────────────────────────────────────────────────────
    brow = tk.Frame(outer, bg=BG)
    brow.pack(fill="x", pady=(12, 0))

    tk.Label(brow,
             text="Scroll wheel = step through video  |  Drag lines on video to adjust regions",
             bg=BG, fg=DIM, font=("", 8)).pack(side="left")

    ttk.Button(brow, text="Cancel",          command=lambda: _cancel()  ).pack(side="right", padx=(8, 0))
    ttk.Button(brow, text="Process Video →", style="Go.TButton",
               command=lambda: _process()).pack(side="right")

    def _process():
        ty_o = max(0, _to_orig(top_y[0]))
        by_o = min(orig_h, _to_orig(bot_y[0]))
        if by_o <= ty_o:
            messagebox.showerror("Invalid", "Keyboard bottom must be below keyboard top.")
            return
        result.update(
            keyboard_time = _kb_time[0],
            kb_top        = ty_o,
            kb_bot        = by_o,
            y             = _to_orig(note_y[0]),
            start_sec     = _start[0],
            end_sec       = _end[0],
        )
        root.destroy()

    def _cancel():
        cancelled[0] = True
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", _cancel)

    _load_frame(keyboard_time)

    root.mainloop()
    cap.release()

    return None if cancelled[0] else (result or None)
