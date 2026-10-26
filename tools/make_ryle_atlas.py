#!/usr/bin/env python3
"""Build ryle-atlas from the committed/generated raizen sheet.

Ryle has no dedicated Spriters sheet. We palette-shift the same Claire
Starsword hero atlas already used for eric/prim/raizen (fan learning only)
toward forest-green / leather tones. Frame names stay identical so
FourDirAnimController wiring matches the other heroes. Arrow VFX are
procedural in PlayerBase — not part of this sheet.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "public" / "assets" / "generated"
SRC_PNG = GEN / "raizen-atlas.png"
SRC_JSON = GEN / "raizen-atlas.json"
DST_PNG = GEN / "ryle-atlas.png"
DST_JSON = GEN / "ryle-atlas.json"


def shift(r: int, g: int, b: int) -> tuple[int, int, int]:
    # Red accents → warm brown leather
    if r > g + 30 and r > b + 30 and r > 80:
        return (
            min(255, int(r * 0.85 + 40)),
            min(255, int(g * 0.55 + 50)),
            min(255, int(b * 0.35 + 20)),
        )
    # Teal / dark body → forest green
    if g >= r - 10 and b >= r - 20 and 20 < max(r, g, b) < 180:
        lum = (r + g + b) / 3
        return (int(lum * 0.35), int(min(255, lum * 0.95 + 30)), int(lum * 0.40))
    # Deep blue → deep green cloak
    if b > r + 20 and b > g:
        return (int(r * 0.5), int(min(255, g * 0.8 + 40)), int(b * 0.35))
    # Light gray highlights → soft cream
    if abs(r - g) < 25 and abs(g - b) < 25 and r > 160:
        return (min(255, r), min(255, int(g * 0.95)), min(255, int(b * 0.85)))
    return r, g, b


def main() -> None:
    if not SRC_PNG.is_file() or not SRC_JSON.is_file():
        raise SystemExit(f"missing raizen atlas at {SRC_PNG}")
    im = Image.open(SRC_PNG).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            nr, ng, nb = shift(r, g, b)
            px[x, y] = (nr, ng, nb, a)
    DST_PNG.parent.mkdir(parents=True, exist_ok=True)
    im.save(DST_PNG, optimize=True)
    shutil.copyfile(SRC_JSON, DST_JSON)
    # Sanity: JSON must list walk_down_0
    meta = json.loads(DST_JSON.read_text(encoding="utf-8"))
    if "walk_down_0" not in meta.get("frames", {}):
        raise SystemExit("ryle atlas JSON missing walk_down_0")
    print(f"Wrote ryle atlas → {DST_PNG.name} ({w}x{h}, {len(meta['frames'])} frames)")


if __name__ == "__main__":
    main()
