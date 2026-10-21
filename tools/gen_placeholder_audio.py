#!/usr/bin/env python3
"""Generate placeholder SFX + soft loop BGM (WAV + OGG). Not SS2 rips."""
from __future__ import annotations

import math
import struct
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "audio"
SR = 22050


def write_wav(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(
            struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples
        )
        w.writeframes(frames)


def to_ogg(wav: Path) -> None:
    ogg = wav.with_suffix(".ogg")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(wav),
            "-c:a",
            "libvorbis",
            "-q:a",
            "4",
            str(ogg),
        ],
        check=True,
    )


def env(i: int, n: int, attack: float = 0.02, release: float = 0.15) -> float:
    t = i / SR
    dur = n / SR
    a = min(1.0, t / attack) if attack > 0 else 1.0
    r = 1.0
    if release > 0 and t > dur - release:
        r = max(0.0, (dur - t) / release)
    return a * r


def tone(
    dur: float,
    freq: float,
    vol: float = 0.4,
    wave_kind: str = "sine",
    attack: float = 0.01,
    release: float = 0.08,
    slide_to: float | None = None,
) -> list[float]:
    n = int(SR * dur)
    out: list[float] = []
    for i in range(n):
        t = i / SR
        f = freq
        if slide_to is not None:
            f = freq + (slide_to - freq) * (i / max(1, n - 1))
        phase = 2 * math.pi * f * t
        if wave_kind == "square":
            s = 1.0 if math.sin(phase) >= 0 else -1.0
        elif wave_kind == "triangle":
            s = 2 * abs(2 * (t * f % 1) - 1) - 1
        elif wave_kind == "noise":
            # cheap LCG noise
            s = ((i * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF * 2 - 1
        else:
            s = math.sin(phase)
        out.append(s * vol * env(i, n, attack, release))
    return out


def mix(*parts: list[float]) -> list[float]:
    n = max(len(p) for p in parts)
    out = [0.0] * n
    for p in parts:
        for i, v in enumerate(p):
            out[i] += v
    peak = max(1e-6, max(abs(x) for x in out))
    if peak > 0.95:
        out = [x * 0.95 / peak for x in out]
    return out


def pad(samples: list[float], silence: float = 0.02) -> list[float]:
    z = [0.0] * int(SR * silence)
    return z + samples + z


def make_slash() -> list[float]:
    # short descending whoosh-ish
    return pad(
        mix(
            tone(0.09, 880, 0.28, "square", 0.002, 0.06, slide_to=420),
            tone(0.07, 1320, 0.12, "sine", 0.001, 0.05, slide_to=600),
        )
    )


def make_hit() -> list[float]:
    return pad(
        mix(
            tone(0.06, 180, 0.45, "square", 0.001, 0.05),
            tone(0.05, 90, 0.25, "noise", 0.001, 0.04),
        )
    )


def make_chest() -> list[float]:
    # bright open chime
    return pad(
        mix(
            tone(0.12, 523.25, 0.3, "sine", 0.005, 0.1),
            tone(0.14, 659.25, 0.22, "sine", 0.01, 0.12),
            tone(0.16, 783.99, 0.18, "sine", 0.02, 0.12),
        )
    )


def make_door() -> list[float]:
    return pad(
        mix(
            tone(0.18, 140, 0.35, "triangle", 0.01, 0.12, slide_to=90),
            tone(0.1, 60, 0.2, "noise", 0.005, 0.08),
        )
    )


def make_hurt() -> list[float]:
    return pad(
        mix(
            tone(0.12, 320, 0.4, "square", 0.002, 0.1, slide_to=140),
            tone(0.08, 200, 0.2, "noise", 0.001, 0.06),
        )
    )


def make_boss() -> list[float]:
    # little fanfare stub
    notes = [(392, 0.12), (523.25, 0.12), (659.25, 0.14), (784, 0.28)]
    acc: list[float] = []
    t0 = 0.0
    for freq, dur in notes:
        chunk = tone(dur, freq, 0.32, "triangle", 0.01, 0.08)
        # append with tiny gap
        gap = [0.0] * int(SR * 0.03)
        acc.extend(chunk)
        acc.extend(gap)
        t0 += dur
    # low drone under last bit
    drone = tone(0.55, 98, 0.12, "sine", 0.05, 0.2)
    return pad(mix(acc, drone))


def make_bgm() -> list[float]:
    """Soft 4-bar-ish loop ~4s, gentle arpeggio + drone."""
    # Am-ish: A2 drone + C4 E4 A4 pattern
    beat = 0.25
    pattern = [
        220.0,
        261.63,
        329.63,
        440.0,
        329.63,
        261.63,
        196.0,
        261.63,
    ]
    bars = 2
    melody: list[float] = []
    for _ in range(bars):
        for f in pattern:
            melody.extend(tone(beat, f, 0.11, "sine", 0.02, 0.12))
    dur = len(melody) / SR
    drone = tone(dur, 110.0, 0.06, "sine", 0.2, 0.3)
    soft = tone(dur, 164.81, 0.04, "triangle", 0.3, 0.3)
    return mix(melody, drone, soft)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "sfx-slash": make_slash(),
        "sfx-hit": make_hit(),
        "sfx-chest": make_chest(),
        "sfx-door": make_door(),
        "sfx-hurt": make_hurt(),
        "sfx-boss": make_boss(),
        "bgm-dungeon": make_bgm(),
    }
    for name, samples in files.items():
        wav = OUT / f"{name}.wav"
        write_wav(wav, samples)
        to_ogg(wav)
        print(f"wrote {wav.name} + .ogg ({len(samples)/SR:.2f}s)")
    readme = OUT / "README.txt"
    readme.write_text(
        "Placeholder audio (procedural). Replace with GBAMusRippy / custom assets later.\n"
        "Expected keys: sfx-slash, sfx-hit, sfx-chest, sfx-door, sfx-hurt, sfx-boss, bgm-dungeon\n"
        "Prefer .ogg (loaded by the game); .wav kept as source.\n"
    )
    print("done ->", OUT)


if __name__ == "__main__":
    main()
