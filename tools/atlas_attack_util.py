"""Shared helpers for hero attack-frame extraction.

Attack bands on Spriters Resource sheets often stack two pose rows, and white
slash VFX sits between neighbors. Expanding a cell by raw mask+margin then
swallows adjacent bodies → atlas frames that look like the hero「四分五裂」.
These helpers keep one body + its swoosh.
"""
from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image


def expand_with_swoosh(
    mask: np.ndarray,
    swoosh: np.ndarray,
    box: tuple[int, int, int, int],
    W: int,
    H: int,
    neighbors: list[tuple[int, int, int, int]] | tuple = (),
    margin: int = 12,
    max_w: int = 44,
    max_h: int = 40,
) -> tuple[int, int, int, int]:
    """Grow *box* to include nearby white slash pixels, clamped away from neighbors."""
    x0, y0, x1, y1 = box
    left_lim, right_lim = 0, W - 1
    top_lim, bot_lim = 0, H - 1
    for nb in neighbors:
        if nb == box:
            continue
        nx0, ny0, nx1, ny1 = nb
        if nx1 < x0:
            left_lim = max(left_lim, (nx1 + x0) // 2 + 1)
        elif nx0 > x1:
            right_lim = min(right_lim, (x1 + nx0) // 2 - 1)
        if ny1 < y0:
            top_lim = max(top_lim, (ny1 + y0) // 2 + 1)
        elif ny0 > y1:
            bot_lim = min(bot_lim, (y1 + ny0) // 2 - 1)

    sx0 = max(left_lim, x0 - margin)
    sx1 = min(right_lim, x1 + margin)
    sy0 = max(top_lim, y0 - margin)
    sy1 = min(bot_lim, y1 + margin)

    ox0, oy0, ox1, oy1 = x0, y0, x1, y1
    sw = swoosh[sy0 : sy1 + 1, sx0 : sx1 + 1]
    if sw.any():
        sr = np.where(sw.any(axis=1))[0]
        sc = np.where(sw.any(axis=0))[0]
        ox0 = min(ox0, sx0 + int(sc[0]))
        ox1 = max(ox1, sx0 + int(sc[-1]))
        oy0 = min(oy0, sy0 + int(sr[0]))
        oy1 = max(oy1, sy0 + int(sr[-1]))

    ox0 = max(left_lim, ox0)
    ox1 = min(right_lim, ox1)
    oy0 = max(top_lim, oy0)
    oy1 = min(bot_lim, oy1)

    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if ox1 - ox0 + 1 > max_w:
        ox0 = max(left_lim, int(cx - max_w / 2))
        ox1 = min(right_lim, ox0 + max_w - 1)
    if oy1 - oy0 + 1 > max_h:
        oy0 = max(top_lim, int(cy - max_h / 2))
        oy1 = min(bot_lim, oy0 + max_h - 1)

    ox0, oy0 = max(0, ox0), max(0, oy0)
    ox1, oy1 = min(W - 1, ox1), min(H - 1, oy1)

    cell = mask[oy0 : oy1 + 1, ox0 : ox1 + 1] | swoosh[oy0 : oy1 + 1, ox0 : ox1 + 1]
    if cell.any():
        rows = np.where(cell.any(axis=1))[0]
        cols = np.where(cell.any(axis=0))[0]
        return (
            ox0 + int(cols[0]),
            oy0 + int(rows[0]),
            ox0 + int(cols[-1]),
            oy0 + int(rows[-1]),
        )
    return (ox0, oy0, ox1, oy1)


def scrub_ghost_fragments(img: Image.Image) -> Image.Image:
    """Keep the main body blob + white swoosh; drop disconnected clone bodies."""
    arr = np.array(img)
    h, w = arr.shape[:2]
    opaque = arr[:, :, 3] > 0
    if not opaque.any():
        return img

    swoosh = (
        opaque
        & (arr[:, :, 0] > 200)
        & (arr[:, :, 1] > 200)
        & (arr[:, :, 2] > 200)
    )
    body = opaque & ~swoosh
    if not body.any():
        return img

    ys, xs = np.where(body)
    cy, cx = int(ys.mean()), int(xs.mean())
    if not body[cy, cx]:
        # snap seed to nearest body pixel
        d2 = (ys - cy) ** 2 + (xs - cx) ** 2
        i = int(np.argmin(d2))
        cy, cx = int(ys[i]), int(xs[i])

    kept = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    q.append((cy, cx))
    kept[cy, cx] = True
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and body[ny, nx] and not kept[ny, nx]:
                kept[ny, nx] = True
                q.append((ny, nx))

    keep = kept | swoosh
    out = arr.copy()
    out[~keep, 3] = 0
    # trim transparent borders
    if keep.any():
        rows = np.where(keep.any(axis=1))[0]
        cols = np.where(keep.any(axis=0))[0]
        out = out[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
    return Image.fromarray(out)
