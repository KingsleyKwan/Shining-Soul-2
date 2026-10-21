#!/usr/bin/env python3
"""Extract Captain Gully walk/attack/hurt from Spriters Resource sheet.

Source: public/assets/captain-gully.png (darkbolt99 rip)
Chroma: magenta RGB(255,0,220)

Layout (heuristic, packed grid with teal labels):
  8 direction rows y≈40..543 — left = attack (~4 frames), right = walk (~4 frames)
  Dir order: down, DL, left, UL, up, UR, right, DR
  Bottom row y≈576..607 — Hit/Defeat (hurt + lie-down)

We keep 4-dir: down=row0, left=row2, up=row4, right=row6.

Outputs:
  public/assets/generated/gully-atlas.png
  public/assets/generated/gully-atlas.json
  public/assets/generated/gully-frame-map.json

Run: python3 tools/extract_gully.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public/assets/captain-gully.png"
OUT = ROOT / "public/assets/generated"
BG = np.array([255, 0, 220], dtype=np.int16)
TOL = 80

# (y0, y1) per direction row on the sheet
DIR_BANDS = {
    "down": (40, 74),
    "left": (174, 208),
    "up": (308, 342),
    "right": (442, 476),
}
HURT_BAND = (576, 607)
SPLIT_X = 325  # attack | walk


def split_section(mask, y0, y1, x0, x1, min_w=18, min_h=26, min_col=5):
    sub = mask[y0 : y1 + 1, x0 : x1 + 1]
    col_has = sub.sum(axis=0) >= min_col
    frames = []
    in_f = False
    xs = 0
    ww = x1 - x0 + 1
    for x in range(ww):
        if col_has[x] and not in_f:
            xs = x
            in_f = True
        elif (not col_has[x]) and in_f:
            xe = x - 1
            cell = sub[:, xs : xe + 1]
            rows = np.where(cell.any(axis=1))[0]
            cols = np.where(cell.any(axis=0))[0]
            if len(rows) and len(cols):
                fy0, fy1 = y0 + int(rows[0]), y0 + int(rows[-1])
                fx0, fx1 = x0 + xs + int(cols[0]), x0 + xs + int(cols[-1])
                if fx1 - fx0 + 1 >= min_w and fy1 - fy0 + 1 >= min_h:
                    frames.append((fx0, fy0, fx1, fy1))
            in_f = False
    return frames


def chroma(arr, box, pad=1):
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W - 1, x1 + pad), min(H - 1, y1 + pad)
    crop = arr[y0 : y1 + 1, x0 : x1 + 1].copy().astype(np.uint8)
    cdiff = np.abs(crop[:, :, :3].astype(np.int16) - BG).sum(axis=2)
    crop[cdiff <= TOL, 3] = 0
    return Image.fromarray(crop)


def pick_n(frames, n, prefer_end=False):
    """Take up to n character-sized frames (skip tiny junk/arrows)."""
    good = [f for f in frames if (f[2] - f[0] + 1) >= 20 and (f[3] - f[1] + 1) >= 28]
    if len(good) < n:
        good = frames
    if prefer_end and len(good) > n:
        return good[-n:]
    return good[:n]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    arr = np.array(im).astype(np.int16)
    H, W = arr.shape[:2]
    mask = np.abs(arr[:, :, :3] - BG).sum(axis=2) > TOL

    entries = []
    boxes = {}
    meta_dirs = {}

    for dname, (y0, y1) in DIR_BANDS.items():
        atk = pick_n(split_section(mask, y0, y1, 0, SPLIT_X - 1), 4, prefer_end=False)
        walk = pick_n(split_section(mask, y0, y1, SPLIT_X + 1, W - 1), 4, prefer_end=True)
        meta_dirs[dname] = {"attack": len(atk), "walk": len(walk)}
        for i, box in enumerate(walk):
            name = f"walk_{dname}_{i}"
            entries.append((name, chroma(arr, box)))
            boxes[name] = box
        for i, box in enumerate(atk):
            name = f"attack_{dname}_{i}"
            entries.append((name, chroma(arr, box)))
            boxes[name] = box

    # Hurt / defeat from bottom band (left section)
    hy0, hy1 = HURT_BAND
    hurt_cells = split_section(mask, hy0, hy1, 0, SPLIT_X - 1, min_w=14, min_h=20, min_col=4)
    # Skip portrait (tall narrow) — prefer mid-size sprites
    hurt_good = [
        f
        for f in hurt_cells
        if 18 <= (f[2] - f[0] + 1) <= 48 and 20 <= (f[3] - f[1] + 1) <= 48
    ]
    if len(hurt_good) >= 1:
        entries.append(("hurt_0", chroma(arr, hurt_good[0])))
        boxes["hurt_0"] = hurt_good[0]
    if len(hurt_good) >= 2:
        entries.append(("defeat_0", chroma(arr, hurt_good[1])))
        boxes["defeat_0"] = hurt_good[1]
    elif len(hurt_good) == 1:
        # reuse hurt as defeat fallback
        entries.append(("defeat_0", chroma(arr, hurt_good[0])))
        boxes["defeat_0"] = hurt_good[0]

    # idle = first walk_down
    if any(n == "walk_down_0" for n, _ in entries):
        idle_img = next(img for n, img in entries if n == "walk_down_0")
        entries.insert(0, ("idle_0", idle_img.copy()))
        boxes["idle_0"] = boxes["walk_down_0"]

    pad = 2
    items = sorted(entries, key=lambda t: -t[1].height)
    atlas_w = 512
    x = pad
    y = pad
    row_h = 0
    max_x = 0
    placed = []
    for name, img in items:
        if x + img.width + pad > atlas_w:
            x = pad
            y += row_h + pad
            row_h = 0
        placed.append((name, img, x, y))
        max_x = max(max_x, x + img.width)
        row_h = max(row_h, img.height)
        x += img.width + pad
    atlas_h = ((y + row_h + pad + 3) // 4) * 4
    atlas_w = max(512, ((max_x + pad + 3) // 4) * 4)

    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
    frames = {}
    for name, img, px, py in placed:
        atlas.paste(img, (px, py), img)
        frames[name] = {
            "frame": {"x": px, "y": py, "w": img.width, "h": img.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": img.width, "h": img.height},
            "sourceSize": {"w": img.width, "h": img.height},
            "pivot": {"x": 0.5, "y": 0.85},
        }

    atlas.save(OUT / "gully-atlas.png")
    with open(OUT / "gully-atlas.json", "w") as f:
        json.dump(
            {
                "frames": frames,
                "meta": {
                    "app": "extract_gully.py",
                    "version": "1.0",
                    "image": "gully-atlas.png",
                    "format": "RGBA8888",
                    "size": {"w": atlas_w, "h": atlas_h},
                    "scale": "1",
                },
            },
            f,
            indent=2,
        )
    with open(OUT / "gully-frame-map.json", "w") as f:
        json.dump(
            {
                "source": "captain-gully.png (darkbolt99 / The Spriters Resource)",
                "chroma": "RGB(255,0,220) tol=80",
                "split_x": SPLIT_X,
                "dir_bands": {k: {"y0": v[0], "y1": v[1]} for k, v in DIR_BANDS.items()},
                "hurt_band": {"y0": HURT_BAND[0], "y1": HURT_BAND[1]},
                "dir_counts": meta_dirs,
                "boxes": {
                    k: {"x0": v[0], "y0": v[1], "x1": v[2], "y1": v[3]} for k, v in boxes.items()
                },
                "notes": [
                    "4-dir only (down/left/up/right from 8-dir sheet)",
                    "Attack frame ~2 often has lunge/impact — used for boss melee cue",
                ],
            },
            f,
            indent=2,
        )
    print(f"Wrote {len(frames)} frames → {OUT}/gully-atlas.png ({atlas_w}x{atlas_h})")
    print("dirs", meta_dirs)
    print("keys", sorted(frames.keys()))


if __name__ == "__main__":
    main()
