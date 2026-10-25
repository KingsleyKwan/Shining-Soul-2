#!/usr/bin/env python3
"""Extract Eric (Warrior) walk + slash + hurt + death from Spriters Resource sheet.

Source: public/assets/eric-warrior.png (Claire Starsword rip)
Chroma: gray-green RGB(159,167,143)

Frame layout assumptions (packed sheet, heuristic):
  walk   y=0..31     — see WALK_MAP
  attack y=465..512  — see ATK_MAP (swoosh-expanded)
  death  y=39..70    — 5-frame knockdown (band1 cells 0..4)
  hurt   y=97..126   — pairs hurt/lie per facing (band2):
                       down hurt=0, right=2, left=4, up=8
                       (lie-down singles 1/3/5/9 unused; death uses band1)

Outputs:
  public/assets/generated/eric-atlas.png
  public/assets/generated/eric-atlas.json
  public/assets/generated/frame-map.json

Run from project root:  python3 tools/extract_eric.py
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
SRC = ROOT / "public/assets/eric-warrior.png"
OUT = ROOT / "public/assets/generated"
BG = np.array([159, 167, 143], dtype=np.int16)
TOL = 45

WALK_MAP = {
    "walk_down": [0, 5, 6, 7, 8],
    "walk_up": [4, 21, 22, 23, 24],
    "walk_left": [2, 9, 10, 12],
}
# Side attacks: sheet cells 6–9 face LEFT (cape bias matches walk_left; swoosh
# is in front on the left). Previously labeled attack_right → slash looked
# opposite to move/hitbox facing. No clean native right-facing side poses →
# pack attack_right as horizontal flips of attack_left (same as Prim).
ATK_MAP = {
    "attack_down": [0, 1, 3, 4],
    "attack_left": [6, 7, 8, 9],
    "attack_up": [10, 12, 14, 17],
}
ATK_RIGHT_FROM_LEFT = [0, 1, 2, 3]
# band2 (y=97..126) directional hurt standing frames
HURT_MAP = {
    "hurt_down": 0,
    "hurt_right": 2,
    "hurt_left": 4,
    "hurt_up": 8,
}
# band1 (y=39..70) full knockdown → death
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
    return Image.fromarray(crop)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    arr = np.array(im).astype(np.int16)
    H, W = arr.shape[:2]
    mask = np.abs(arr[:, :, :3] - BG).sum(axis=2) > TOL
    rgb = arr[:, :, :3]
    swoosh = mask & (rgb[:, :, 0] > 200) & (rgb[:, :, 1] > 200) & (rgb[:, :, 2] > 200)

    walk = split_band(mask, 0, 31)
    atk = split_band(mask, 465, 512, min_w=12, min_h=16, min_col=5)
    death_band = split_band(mask, 39, 70)
    hurt_band = split_band(mask, 97, 126, min_w=8, min_h=10, min_col=3)
    assert len(walk) >= 25, len(walk)
    assert len(atk) >= 21, len(atk)
    assert len(death_band) >= 5, len(death_band)
    assert len(hurt_band) >= 9, len(hurt_band)

    entries = []
    boxes = {}
    for prefix, idxs in WALK_MAP.items():
        for i, idx in enumerate(idxs):
            name = f"{prefix}_{i}"
            entries.append((name, chroma(arr, walk[idx])))
            boxes[name] = walk[idx]
    left_imgs = []
    for prefix, idxs in ATK_MAP.items():
        for i, idx in enumerate(idxs):
            name = f"{prefix}_{i}"
            box = expand_with_swoosh(mask, swoosh, atk[idx], W, H, neighbors=atk)
            img = scrub_ghost_fragments(chroma(arr, box))
            entries.append((name, img))
            boxes[name] = box
            if prefix == "attack_left":
                left_imgs.append(img)
    for i in ATK_RIGHT_FROM_LEFT:
        name = f"attack_right_{i}"
        flipped = left_imgs[i].transpose(Image.FLIP_LEFT_RIGHT)
        entries.append((name, flipped))
        boxes[name] = boxes[f"attack_left_{i}"]  # source box (pre-flip)

    for name, idx in HURT_MAP.items():
        frame_name = f"{name}_0"
        entries.append((frame_name, chroma(arr, hurt_band[idx])))
        boxes[frame_name] = hurt_band[idx]

    for i, idx in enumerate(DEATH_IDX):
        name = f"death_{i}"
        entries.append((name, chroma(arr, death_band[idx])))
        boxes[name] = death_band[idx]

    # Keep tiny dummy for any leftover refs
    dummy = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dummy)
    dd.ellipse([1, 1, 22, 22], fill=(180, 60, 60, 255), outline=(40, 10, 10, 255))
    dd.ellipse([6, 6, 12, 12], fill=(220, 120, 120, 255))
    entries.append(("dummy", dummy))

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

    atlas.save(OUT / "eric-atlas.png")
    with open(OUT / "eric-atlas.json", "w") as f:
        json.dump(
            {
                "frames": frames,
                "meta": {
                    "app": "extract_eric.py",
                    "version": "1.3",
                    "image": "eric-atlas.png",
                    "format": "RGBA8888",
                    "size": {"w": atlas_w, "h": atlas_h},
                    "scale": "1",
                },
            },
            f,
            indent=2,
        )
    with open(OUT / "frame-map.json", "w") as f:
        json.dump(
            {
                "source": "eric-warrior.png (Claire Starsword / The Spriters Resource)",
                "chroma": "RGB(159,167,143) tol=45",
                "walk_band": "y=0..31",
                "attack_band": "y=465..512",
                "death_band": "y=39..70 (knockdown 5 frames)",
                "hurt_band": "y=97..126 (directional hurt standing)",
                "walk_map": WALK_MAP,
                "attack_map": {**ATK_MAP, "attack_right": "flip(attack_left)"},
                "attack_right_from_left": ATK_RIGHT_FROM_LEFT,
                "hurt_map": HURT_MAP,
                "death_idx": DEATH_IDX,
                "boxes": {
                    k: {"x0": v[0], "y0": v[1], "x1": v[2], "y1": v[3]} for k, v in boxes.items()
                },
                "notes": [
                    "4-dir walk; Phaser flipX left→right for walk",
                    "hurt has native 4-dir frames; death is shared knockdown then lie",
                    "attack boxes expand via swoosh only, clamped to neighbor midpoints (no clone bodies)",
                    "attack_left = sheet cells 6–9 (left-facing front slash); attack_right = flip(attack_left)",
                    "old map had 6–9 as attack_right and up-ish cells as attack_left → L/R slash reversed vs facing",
                ],
            },
            f,
            indent=2,
        )
    print(f"Wrote {len(frames)} frames → {OUT}/eric-atlas.png ({atlas_w}x{atlas_h})")
    print("  hurt:", list(HURT_MAP))
    print("  death:", [f"death_{i}" for i in range(len(DEATH_IDX))])


if __name__ == "__main__":
    main()
