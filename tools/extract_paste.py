#!/usr/bin/env python3
"""Extract Paste enemy idle/walk/hurt frames from Spriters Resource sheet.

Source: public/assets/paste.png (Claire Starsword rip)
Chroma: multi-key yellow-green + neon green + magenta band colors

Band 0 (y=1..31) = first palette row (cyan Paste), 33 packed frames.
Assumptions:
  walk/idle bob ← indices [0, 1, 2]  (squash / mid / stretch)
  hurt         ← indices [23, 22, 28] (flattened / recoils)

Outputs:
  public/assets/generated/paste-atlas.png
  public/assets/generated/paste-atlas.json
  public/assets/generated/paste-frame-map.json

Run: python3 tools/extract_paste.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public/assets/paste.png"
OUT = ROOT / "public/assets/generated"

CHROMAS = [
    np.array([231, 239, 120], dtype=np.int16),
    np.array([48, 247, 32], dtype=np.int16),
    np.array([48, 240, 32], dtype=np.int16),
    np.array([240, 48, 232], dtype=np.int16),
    np.array([255, 255, 0], dtype=np.int16),
    np.array([0, 255, 255], dtype=np.int16),
    np.array([255, 200, 0], dtype=np.int16),
]
TOL = 45

WALK_IDX = [0, 1, 2]
HURT_IDX = [23, 22, 28]
BAND = (1, 31)


def split_band(mask: np.ndarray, y0: int, y1: int, min_w=6, min_h=8, min_col=3):
    W = mask.shape[1]
    sub = mask[y0 : y1 + 1]
    col_has = sub.sum(axis=0) >= min_col
    frames = []
    in_f = False
    xs = 0
    for x in range(W):
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
                fx0, fx1 = xs + int(cols[0]), xs + int(cols[-1])
                if fx1 - fx0 + 1 >= min_w and fy1 - fy0 + 1 >= min_h:
                    frames.append((fx0, fy0, fx1, fy1))
            in_f = False
    return frames


def chroma(arr: np.ndarray, box, pad=1):
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W - 1, x1 + pad), min(H - 1, y1 + pad)
    crop = arr[y0 : y1 + 1, x0 : x1 + 1].copy().astype(np.uint8)
    cdiff = np.min(
        [np.abs(crop[:, :, :3].astype(np.int16) - c).sum(axis=2) for c in CHROMAS],
        axis=0,
    )
    crop[cdiff <= TOL, 3] = 0
    return Image.fromarray(crop)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    arr = np.array(im).astype(np.int16)
    diff = np.min([np.abs(arr[:, :, :3] - c).sum(axis=2) for c in CHROMAS], axis=0)
    mask = diff > TOL

    cells = split_band(mask, *BAND)
    assert len(cells) >= 29, f"expected >=29 Paste cells, got {len(cells)}"

    entries = []
    boxes = {}
    for i, idx in enumerate(WALK_IDX):
        name = f"walk_{i}"
        entries.append((name, chroma(arr, cells[idx])))
        boxes[name] = cells[idx]
    for i, idx in enumerate(HURT_IDX):
        name = f"hurt_{i}"
        entries.append((name, chroma(arr, cells[idx])))
        boxes[name] = cells[idx]
    # idle = first walk frame alias stored separately for clarity
    entries.insert(0, ("idle_0", chroma(arr, cells[WALK_IDX[0]])))
    boxes["idle_0"] = cells[WALK_IDX[0]]

    pad = 2
    items = sorted(entries, key=lambda t: -t[1].height)
    atlas_w = 256
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
    atlas_w = max(128, ((max_x + pad + 3) // 4) * 4)

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

    atlas.save(OUT / "paste-atlas.png")
    with open(OUT / "paste-atlas.json", "w") as f:
        json.dump(
            {
                "frames": frames,
                "meta": {
                    "app": "extract_paste.py",
                    "version": "1.0",
                    "image": "paste-atlas.png",
                    "format": "RGBA8888",
                    "size": {"w": atlas_w, "h": atlas_h},
                    "scale": "1",
                },
            },
            f,
            indent=2,
        )
    with open(OUT / "paste-frame-map.json", "w") as f:
        json.dump(
            {
                "source": "paste.png (Claire Starsword / The Spriters Resource)",
                "chroma": "multi: yellow-green + neon green + magenta bands, tol=45",
                "band": {"y0": BAND[0], "y1": BAND[1], "palette_row": 0},
                "walk_idx": WALK_IDX,
                "hurt_idx": HURT_IDX,
                "boxes": {
                    k: {"x0": v[0], "y0": v[1], "x1": v[2], "y1": v[3]} for k, v in boxes.items()
                },
            },
            f,
            indent=2,
        )
    print(f"Wrote {len(frames)} frames → {OUT}/paste-atlas.png ({atlas_w}x{atlas_h})")


if __name__ == "__main__":
    main()
