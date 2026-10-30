#!/usr/bin/env python3
"""Pack village-hub NPC standing sprites into a Phaser atlas.

Sources (embedded base64, also written to public/assets/ for local inspect):
  public/assets/npc-king.png
  public/assets/npc-girl.png

Outputs:
  public/assets/generated/npc-atlas.png
  public/assets/generated/npc-atlas.json

Frames: king_idle_0/1, girl_idle_0/1.
Idle bob shifts content up 1px inside a canvas padded with transparent rows
above the hair so the crown/hair never clips out of the frame.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "assets"
GEN = ROOT / "public" / "assets" / "generated"
KING = SRC / "npc-king.png"
GIRL = SRC / "npc-girl.png"
DST_PNG = GEN / "npc-atlas.png"
DST_JSON = GEN / "npc-atlas.json"

PAD_TOP = 2  # transparent rows above standee; absorbs 1px idle bob
BOB_PX = 1

# Player-scale standees (~22x33), purple-crown king + red-dress girl (teal scrubbed).
_KING_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAABcAAAAiCAYAAAC0nUK+AAAFKklEQVR4nI2XIZDjOgyGv94cEBQ0"
    "NDQ0DAwMDCwMLCwsLCwsLCwsDCwMDAwMNDQ0FPMD2e7t3nZunmY6zSiez+ovWXJ3vLGOjkxmYQGg"
    "pUEiFcmUWXfzhx8gEFhZ32H49c5Z/Fq7odRAACCRGY6B8eZZWOsnWHwdjlY97v/Dk2WG3hgOVj2u"
    "hkZr6xewlee4x+OriNTb1egjgNR3nLdwX/zuejf2veN6bWh9Rv3wIcOTNmTmu+KlMJxA0d07zltn"
    "R4t0S31cHOBBWygTlMymgMPSwnPMHG+OTP7/cBWpQwNDD84LIvLlrWEGVoyS4XCFnB2J9IP1+x1c"
    "FLrOcR9BAATMtm9BMDPMDATGm+d5g+H5k/MDLkidLw51StsJZoWyGhoiosrymAEjdhErZds1GuEZ"
    "6sq6+yf8dhBEwawgBUoSclJUDKMQfES8Y5nuhOjIuRDV8TcY3mguIjU4mG6OkoV1EbzzIBmnDvGR"
    "aXxSSsGFhHfKcCmk9afub+F5PJDWhRAaCkrJGe//JHVNRggByso4PsFHTqf5B/xHnYvBsiZKAUSZ"
    "LXB+TN+y0hxuYAlEUFFKKij6N+onXHF0pyfP1QDDS6Zv47c150MLrgEzzuPK6TbR0/9bc4+vp6MS"
    "+yPj44HDOPQRvtX5hxWjOd45ng4ENU6nB1PK72WJBPreExSCPDieThR1tIcHaVlJy5/Ot84Lbn/j"
    "fNqz33dImWjaQMC/7TF4fJ2nR7Uy1+dtqGUeaslzvV2PtQ2uPg+xjodY70OsItT8bKqVpaa7q3kd"
    "a5pvVf5qYF/q3D6f2v5AWkaYDuybADnSXz6OoEAae9StPC89oT+jItshe53kr5p3tLSXWI+HAayQ"
    "c6JvH4gI3i9cDob4PaJCmUbQTHcMODy4wnM+b+GVjAt7zGz3RXMhp4SVhFHYt08a7YjSQO65jorY"
    "AnmE0NCfAo32BG2Q4rhe7luOS/4m9e9NkIK6gK03uj002pFtxTDa6IiNcj4rYKQszE/HsYelPIna"
    "Md5m+jDgu/s3+K+BPW6v9TD0DGeI2gKQLZEtAaDqIHdYHnDigQLAUiYE8BLojkIumZInXon9rSip"
    "ZO73iSAQuoyVzDonchaK5a37YX/abU4UyyDg4kQQJRRHjHtynv6WBQxDcKj5XYYqCKorJgVVpT/O"
    "eGfMUwIcpncoIDgEBXvVm3yHv8x5ITZSc1JSUcriEXNAYl2eTNnoO8e6ClgEZmJUnFd0KTDzrRZ/"
    "rbLSxIB3imnGx0QIiQI4WoRALjAvDSl13EcHGEqHE0+ShHPbLaeJHkTouoZI4Peiax1PF3JKHMeJ"
    "cQIrsC5KoxFkBfNo6bZaToUQRxQhSMPlNiP7wP2ZOZ8HwHg8Lnjt66+XUmbGvos8psTh8sTjt99m"
    "r771oeVHE9tGqqLFc7rPHA8dJb/qfFvz6/XwkmrfNd9q9U9+bAvDjJLSF5+hKtvCz43tBf9uZoaI"
    "cb4+aYcJs4x8RgrJlq0NWOJ6nTju18+N/tTLtslntQggIuRStoE+rAx95nKJiOu5dg9gG9jaHLlc"
    "LsShYEDwHhH5RJulbaR1NPR9W5fpVqN3VaCqSB2i1sZLFaHC94/ItqYPUluvmw+p4/1UrcxVRCt8"
    "dMVIZGWtDc1uYkJF6nnvKdlIubBmY872mc99EFQEHxzTkplWKFZ2gtTtAvWlKy4sGLabmBCox1ax"
    "XLZb1Qewpdu9gnklP6WMF4jOCAQM273An5F/NUXfjqpI3E1MOLTam/cOt/v7T8B/4+zWSWxuvRMA"
    "AAAASUVORK5CYII="
)
_GIRL_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAABMAAAAgCAYAAADwvkPPAAADvUlEQVR4nH2WLZTyPBCFHzivGDky"
    "srKyEolErqxEIpHIlUjkSiQSiaysrIyMjBw5Lp9It8C3ezY9PSU/c3NnJncC/NIu7QWB8vsr5Tcb"
    "gNX/B0QoAmzbBnBAfhg9YgIEd3+zf+uoUDZtQLyi/tXcnZggeV4w1q+MmqAIwuGj+xNIgMOuo20g"
    "EBa3F1QVSnXt7yYC7s/+ODmZym4971S6oG8upGxkszc2ADnXMZvnRI3vpKyX3ebFKWdiNm7HHT5T"
    "iNm4HDakbJjXNQAxZfQltuvKhMXQHESEZtMw3o7E2VCbhvFrj+OYQ7a6PqgQFBQt/+DJakoZFbh+"
    "ftDsLiCQ7sfF0ebjgggMlz3b4xWZbbPXMMwxExyI9yPu0J8HkuXFne+IJTNizmxPNwQYb0emZIiD"
    "Yau1CGXb6ryFcek7bueeGBOqOgNV7t/9+7nn0m+wmGjDa8xmH4MqYX9FBdo28M14CcK3jbBqG0UV"
    "utMdFaFrlUAoK4HSBiWoMMQMItjjyJuMXsXgjjuEjwuCE0RQVVKClQilUyWaowIqQjQHHHucnqd0"
    "/ur2DAKtKiI1q0EgZeWfO6spWwEIQZmScVBhq4rphvvpOOvU2X1euKkQVfjMTheU7PWoGPm9aIhI"
    "cc/FLZVH0OIWa99zcYvF8lTuqsUsF7NcguhbOVqErqJlHIdlQl0Yut3LTkrc9iiVqAjcH1808hT6"
    "vyWuGO0sdIsTIk5wmNruiTeXN0sRbVraboO9qH4NtYwMQ2VlOXI4nZlmuaiDulcgnOywP36CO4Jw"
    "e1xpaJ5CNzJd1y61ZRhHALI79QHHie4kd8ZxWqg2TZhXwLoRLadN850B9odPPhBalZr6GSC704ig"
    "Ajt3+n4PQBA4bZWGpqwzRt9vII34eMeHkV4EFUERZP4qdawRYQNMwwhpAktsdx2OVzebroU8MQ4P"
    "dkCYC5wAASGILGP1N2yBcXggNtFuWkRgrR7IZqRsHM4Puj/ukTkHtKLsBPanK9mcZI641jsgoEXE"
    "uajQqNYKyVOS/gtwCkrOmZM56oFEWi0SEJFi8QFA3PR/AqFC8/jCzNl2RxJpBS+3kyBFgJvCNqf/"
    "Wb+UIgDLDO2GDwNFl9vpx40eCAU1xnMPwH1KnK4j8auydYf2eKsgnn/Y/2hBZ5FbLNfPfakhuBfP"
    "Y7E8lfCixz+bzpXDpqGMQctJpYhQhqBlCFrnLBWVn39g3miKUAYRoJ5+A77MeQBnnE61LpzDt3Mw"
    "t9WvYIr+2C0QiMRVmOdq4RAcR9ElkwD/ASdFHDayBJxuAAAAAElFTkSuQmCC"
)


def ensure_sources() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    KING.write_bytes(base64.b64decode("".join(_KING_PNG_B64.split())))
    GIRL.write_bytes(base64.b64decode("".join(_GIRL_PNG_B64.split())))


def pad_standee(im: Image.Image, pad_top: int = PAD_TOP) -> Image.Image:
    """Add transparent rows above hair so bob travel stays inside the frame."""
    w, h = im.size
    canvas = Image.new("RGBA", (w, h + pad_top), (0, 0, 0, 0))
    canvas.paste(im, (0, pad_top), im)
    return canvas


def bob_frame(padded: Image.Image, bob: int = BOB_PX) -> Image.Image:
    """Shift content up by bob px; top pad absorbs the travel (no clip)."""
    w, h = padded.size
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(padded, (0, -bob), padded)
    return canvas


def main() -> None:
    ensure_sources()
    king = pad_standee(Image.open(KING).convert("RGBA"))
    girl = pad_standee(Image.open(GIRL).convert("RGBA"))
    frames_imgs = {
        "king_idle_0": king,
        "king_idle_1": bob_frame(king),
        "girl_idle_0": girl,
        "girl_idle_1": bob_frame(girl),
    }
    pad = 2
    total_w = sum(im.width + pad for im in frames_imgs.values()) + pad
    total_h = max(im.height for im in frames_imgs.values()) + pad * 2
    atlas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    frames_meta: dict = {}
    x = pad
    for name, im in frames_imgs.items():
        y = pad
        atlas.paste(im, (x, y), im)
        frames_meta[name] = {
            "frame": {"x": x, "y": y, "w": im.width, "h": im.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
            "sourceSize": {"w": im.width, "h": im.height},
        }
        x += im.width + pad

    GEN.mkdir(parents=True, exist_ok=True)
    atlas.save(DST_PNG, optimize=True)
    meta = {
        "frames": frames_meta,
        "meta": {
            "app": "shining-soul-2-web/tools/make_npc_atlas.py",
            "image": "npc-atlas.png",
            "format": "RGBA8888",
            "size": {"w": atlas.width, "h": atlas.height},
            "scale": "1",
        },
    }
    DST_JSON.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote NPC atlas → {DST_PNG.name} ({atlas.width}x{atlas.height}, "
        f"{len(frames_meta)} frames, pad_top={PAD_TOP}, bob={BOB_PX})"
    )


if __name__ == "__main__":
    main()
