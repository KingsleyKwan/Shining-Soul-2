#!/usr/bin/env python3
"""Scrub leftover flat cell fills from generated atlases.

Gully's sheet keyed magenta but left an opaque light-gray box
(RGB 216,216,216) inside walk/attack/defeat cells. Slash FX is a
separate near-white (about 248,248,248) and must stay.

Hero atlases (eric/prim/raizen/ryle) and Paste keep their white
swooshes and slime highlights. This pass only drops large flat
mid-gray components, never pixels brighter than the slash range.

Rewrites a PNG only when pixels change. Frame JSON is not touched.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "public" / "assets" / "generated"

# Gully cell fill. Exact — the sheet has no anti-aliased fringe on this key.
GULLY_GRAY = (216, 216, 216)
# Full-bleed ground rule under every walk/attack cell. Not the outfit:
# outfit teal never spans the whole frame width as one flat row.
GULLY_RULE = (0, 127, 127)


def punch_exact(arr: np.ndarray, color: tuple[int, int, int]) -> int:
    rgb = arr[:, :, :3]
    hit = (
        (rgb[:, :, 0] == color[0])
        & (rgb[:, :, 1] == color[1])
        & (rgb[:, :, 2] == color[2])
        & (arr[:, :, 3] > 0)
    )
    n = int(hit.sum())
    if n:
        arr[hit, 3] = 0
    return n


def punch_flat_gray_blobs(arr: np.ndarray, min_area: int = 80) -> int:
    """Drop large connected mid-gray fills. Leave bright slash pixels."""
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3] > 0
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    # Below slash white (~247–255) and above character shadows.
    cand = alpha & (lum >= 185) & (lum <= 230) & (sat <= 8)
    if not cand.any():
        return 0
    h, w = cand.shape
    seen = np.zeros((h, w), dtype=bool)
    remove = np.zeros((h, w), dtype=bool)
    ys, xs = np.where(cand)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        comp: list[tuple[int, int]] = []
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(comp) >= min_area:
            for y, x in comp:
                remove[y, x] = True
    n = int(remove.sum())
    if n:
        arr[remove, 3] = 0
    return n


def punch_gully_ground_rule(arr: np.ndarray, json_path: Path) -> int:
    """Clear full-width flat teal rules inside gully frames. Keep slash FX."""
    if not json_path.is_file():
        return 0
    meta = json.loads(json_path.read_text(encoding="utf-8"))
    removed = 0
    tr, tg, tb = GULLY_RULE
    for fr in meta.get("frames", {}).values():
        box = fr.get("frame")
        if not box:
            continue
        x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
        if w < 8 or h < 8:
            continue
        cell = arr[y : y + h, x : x + w]
        for row in range(h):
            line = cell[row]
            rgb = line[:, :3]
            opaque = line[:, 3] > 0
            if int(opaque.sum()) < w:
                continue
            if not (
                np.all(rgb[:, 0] == tr) and np.all(rgb[:, 1] == tg) and np.all(rgb[:, 2] == tb)
            ):
                continue
            line[:, 3] = 0
            removed += w
    return removed


def scrub_file(path: Path, gully: bool) -> int:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    before = arr.copy()
    removed = 0
    if gully:
        removed += punch_exact(arr, GULLY_GRAY)
        # Flat teal rules (horizontal ground line + left frame bar). The
        # goblin outline is a darker teal, not this exact key.
        removed += punch_exact(arr, GULLY_RULE)
        removed += punch_gully_ground_rule(arr, path.with_suffix(".json"))
    removed += punch_flat_gray_blobs(arr)
    if removed and not np.array_equal(arr, before):
        Image.fromarray(arr).save(path)
    return removed


def main() -> None:
    if not GEN.is_dir():
        raise SystemExit(f"missing {GEN}")
    total = 0
    for path in sorted(GEN.glob("*-atlas.png")):
        n = scrub_file(path, gully=path.name.startswith("gully-"))
        total += n
        print(f"{path.name}: removed {n} leftover fill pixels")
    print(f"scrub_atlases done ({total} pixels)")


if __name__ == "__main__":
    main()
