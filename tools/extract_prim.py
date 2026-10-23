#!/usr/bin/env python3
"""Extract Prim (Priestess) walk + attack + hurt + death.

Source: public/assets/prim-priestess.png (Claire Starsword / Spriters Resource)
Chroma: gray-green RGB(151,167,151) — same family as Eric sheet.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from atlas_attack_util import expand_with_swoosh, scrub_ghost_fragments

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public/assets/prim-priestess.png"
OUT = ROOT / "public/assets/generated"
BG = np.array([151, 167, 151], dtype=np.int16)
TOL = 45

WALK_MAP = {
    "walk_down": [0, 5, 6, 7, 8],
    "walk_up": [4, 21, 22, 23, 24],
    "walk_left": [2, 9, 10, 12],
}
# Main pose row only (y=400..432). Upper row stacked into cells 0..2 caused clones.
ATK_MAP = {
    "attack_down": [0, 1, 7, 5],
    "attack_right": [8, 9, 10, 11],
    "attack_up": [13, 12, 14, 18],
    "attack_left": [15, 16, 17, 6],
}
HURT_MAP = {
    "hurt_down": 0,
    "hurt_right": 2,
    "hurt_left": 4,
    "hurt_up": 8,
}
DEATH_IDX = [0, 1, 2, 3, 4]


def split_band(mask: np.ndarray, y0: int, y1: int, min_w=8, min_h=12, min_col=4):
    w = mask.shape[1]
    sub = mask[y0 : y1 + 1, :]
    col_has = sub.sum(axis=0) >= min_col
    frames = []
    in_f = False
    xs = 0
    for x in range(w):
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


def chroma(arr, box, pad=1):
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W - 1, x1 + pad), min(H - 1, y1 + pad)
    crop = arr[y0 : y1 + 1, x0 : x1 + 1].copy().astype(np.uint8)
    cdiff = np.abs(crop[:, :, :3].astype(np.int16) - BG).sum(axis=2)
    crop[cdiff <= TOL, 3] = 0
    # punch cyan markers
    cyan = (crop[:, :, 0] < 40) & (crop[:, :, 1] > 200) & (crop[:, :, 2] > 180)
    crop[cyan, 3] = 0
    return Image.fromarray(crop)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    arr = np.array(im).astype(np.int16)
    H, W = arr.shape[:2]
    mask = np.abs(arr[:, :, :3] - BG).sum(axis=2) > TOL
    cyan = (arr[:, :, 0] < 40) & (arr[:, :, 1] > 200) & (arr[:, :, 2] > 180)
    mask &= ~cyan
    rgb = arr[:, :, :3]
    swoosh = mask & (rgb[:, :, 0] > 200) & (rgb[:, :, 1] > 200) & (rgb[:, :, 2] > 200)

    walk = split_band(mask, 1, 31)
    atk = split_band(mask, 400, 432, min_w=10, min_h=14, min_col=4)
    death_band = split_band(mask, 56, 84)
    hurt_band = split_band(mask, 100, 126, min_w=8, min_h=10, min_col=3)
    assert len(walk) >= 25, len(walk)
    assert len(atk) >= 16, len(atk)
    assert len(death_band) >= 5, len(death_band)
    assert len(hurt_band) >= 9, len(hurt_band)

    entries = []
    boxes = {}
    for prefix, idxs in WALK_MAP.items():
        for i, idx in enumerate(idxs):
            name = f"{prefix}_{i}"
            entries.append((name, chroma(arr, walk[idx])))
            boxes[name] = walk[idx]
    for prefix, idxs in ATK_MAP.items():
        for i, idx in enumerate(idxs):
            name = f"{prefix}_{i}"
            box = expand_with_swoosh(mask, swoosh, atk[idx], W, H, neighbors=atk)
            entries.append((name, scrub_ghost_fragments(chroma(arr, box))))
            boxes[name] = box
    for name, idx in HURT_MAP.items():
        frame_name = f"{name}_0"
        entries.append((frame_name, chroma(arr, hurt_band[idx])))
        boxes[frame_name] = hurt_band[idx]
    for i, idx in enumerate(DEATH_IDX):
        name = f"death_{i}"
        entries.append((name, chroma(arr, death_band[idx])))
        boxes[name] = death_band[idx]

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
            "pivot": {"x": 0.5, "y": 0.5},
        }

    atlas.save(OUT / "prim-atlas.png")
    with open(OUT / "prim-atlas.json", "w") as f:
        json.dump(
            {
                "frames": frames,
                "meta": {
                    "app": "extract_prim.py",
                    "version": "1.0",
                    "image": "prim-atlas.png",
                    "format": "RGBA8888",
                    "size": {"w": atlas_w, "h": atlas_h},
                    "scale": "1",
                },
            },
            f,
            indent=2,
        )
    with open(OUT / "prim-frame-map.json", "w") as f:
        json.dump(
            {
                "source": "prim-priestess.png (Claire Starsword / The Spriters Resource)",
                "chroma": "RGB(151,167,151) tol=45",
                "walk_band": "y=1..31",
                "attack_band": "y=400..432 (main pose row; avoids stacked clone bodies)",
                "death_band": "y=56..84",
                "hurt_band": "y=100..126",
                "walk_map": WALK_MAP,
                "attack_map": ATK_MAP,
                "hurt_map": HURT_MAP,
                "death_idx": DEATH_IDX,
            },
            f,
            indent=2,
        )
    print(f"Wrote {len(frames)} frames → prim-atlas.png ({atlas_w}x{atlas_h})")


if __name__ == "__main__":
    main()
