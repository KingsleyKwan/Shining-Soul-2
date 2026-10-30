import type Phaser from 'phaser';

/**
 * AudioManager / GameAudio — procedural WebAudio BGM + SFX.
 *
 * Original synth loops and cues (not GBA ROM rips). Loaded OGG/WAV under
 * public/assets/audio/ still play for slash / hit / chest / door / hurt / boss
 * when the cache has them; bgm-dungeon is the fallback if WebAudio is missing.
 *
 * Mute persists in localStorage (`MUTE_STORAGE_KEY`), separate from B1 save.
 * Call shutdown() on GameScene leave so a loop never stacks across restart.
 */

const SFX_VOL: Record<string, number> = {
  'sfx-slash': 0.52,
  'sfx-hit': 0.6,
  'sfx-chest': 0.58,
  'sfx-door': 0.52,
  'sfx-hurt': 0.66,
  'sfx-boss': 0.68,
};

/** Optional file keys. Not preloaded — synth plays when the cache misses. */
const OPTIONAL_SFX_VOL: Record<string, number> = {
  'sfx-ui': 0.42,
  'sfx-pickup': 0.48,
  'sfx-clear': 0.5,
  'sfx-boss-telegraph': 0.5,
  'sfx-boss-phase': 0.55,
};

const BGM_KEY = 'bgm-dungeon';
/** Synth master. Per-note levels sit under this. */
const BGM_VOL = 0.78;
/** Full-mix OGG fallback — keep it quieter than the synth master. */
const PHASER_BGM_VOL = 0.22;

export type BgmTrack = 'title' | 'village' | 'stage1' | 'stage2' | 'stage3' | 'boss';

/** Registry key for the shared audio manager (game-wide). */
export const AUDIO_REGISTRY_KEY = 'gameAudio';

/** Mute flag — independent of shining-soul-2-save-v1. */
export const MUTE_STORAGE_KEY = 'shining-soul-2-mute-v1';

type OscKind = OscillatorType;

type SynthTone = {
  type?: OscKind;
  freq: number;
  freqEnd?: number;
  dur: number;
  vol: number;
  delay?: number;
};

type BgmNote = {
  beat: number;
  beats: number;
  freq: number;
  type: OscKind;
  vol: number;
};

type BgmDef = {
  bpm: number;
  /** Loop length in beats. */
  beats: number;
  drones?: { freq: number; type: OscKind; vol: number }[];
  notes: BgmNote[];
};

// Original loops, ~4–8s. Registers are split so the four cues don't blur together.
const BGM_DEFS: Record<BgmTrack, BgmDef> = {
  // High, quick C-major sparkle for the title cards.
  title: {
    bpm: 100,
    beats: 8,
    drones: [{ freq: 392, type: 'sine', vol: 0.03 }],
    notes: [
      { beat: 0, beats: 0.7, freq: 523.25, type: 'sine', vol: 0.11 },
      { beat: 1, beats: 0.7, freq: 659.25, type: 'sine', vol: 0.11 },
      { beat: 2, beats: 0.7, freq: 783.99, type: 'sine', vol: 0.1 },
      { beat: 3, beats: 0.7, freq: 659.25, type: 'sine', vol: 0.1 },
      { beat: 4, beats: 0.7, freq: 523.25, type: 'sine', vol: 0.11 },
      { beat: 5, beats: 0.7, freq: 392, type: 'sine', vol: 0.1 },
      { beat: 6, beats: 0.7, freq: 329.63, type: 'sine', vol: 0.1 },
      { beat: 7, beats: 0.7, freq: 392, type: 'sine', vol: 0.1 },
    ],
  },
  // Warm F-major arpeggio, slower, with a soft low drone.
  village: {
    bpm: 72,
    beats: 8,
    drones: [
      { freq: 174.61, type: 'triangle', vol: 0.07 },
      { freq: 261.63, type: 'sine', vol: 0.035 },
    ],
    notes: [
      { beat: 0, beats: 1.6, freq: 174.61, type: 'triangle', vol: 0.07 },
      { beat: 0, beats: 0.95, freq: 349.23, type: 'triangle', vol: 0.12 },
      { beat: 1, beats: 0.95, freq: 440, type: 'sine', vol: 0.11 },
      { beat: 2, beats: 0.95, freq: 523.25, type: 'triangle', vol: 0.11 },
      { beat: 3, beats: 0.95, freq: 698.46, type: 'sine', vol: 0.1 },
      { beat: 4, beats: 1.6, freq: 174.61, type: 'triangle', vol: 0.07 },
      { beat: 4, beats: 0.95, freq: 523.25, type: 'triangle', vol: 0.11 },
      { beat: 5, beats: 0.95, freq: 440, type: 'sine', vol: 0.1 },
      { beat: 6, beats: 0.95, freq: 659.25, type: 'triangle', vol: 0.1 },
      { beat: 7, beats: 0.95, freq: 523.25, type: 'sine', vol: 0.1 },
    ],
  },
  // Mid-tempo earthy A minor. Busier than the deep corridor.
  stage1: {
    bpm: 108,
    beats: 8,
    drones: [{ freq: 110, type: 'triangle', vol: 0.08 }],
    notes: [
      { beat: 0, beats: 0.4, freq: 110, type: 'square', vol: 0.05 },
      { beat: 0, beats: 1.35, freq: 220, type: 'triangle', vol: 0.12 },
      { beat: 1.5, beats: 1.2, freq: 261.63, type: 'sine', vol: 0.1 },
      { beat: 3, beats: 1.2, freq: 329.63, type: 'triangle', vol: 0.11 },
      { beat: 4, beats: 0.4, freq: 110, type: 'square', vol: 0.05 },
      { beat: 4, beats: 1.3, freq: 196, type: 'triangle', vol: 0.11 },
      { beat: 5.5, beats: 1.15, freq: 233.08, type: 'sine', vol: 0.09 },
      { beat: 7, beats: 0.95, freq: 293.66, type: 'triangle', vol: 0.1 },
    ],
  },
  // Slow, cold, mostly a low drone with three sparse high notes.
  stage2: {
    bpm: 60,
    beats: 8,
    drones: [
      { freq: 73.42, type: 'sine', vol: 0.11 },
      { freq: 110, type: 'sine', vol: 0.03 },
    ],
    notes: [
      { beat: 0, beats: 1.8, freq: 587.33, type: 'sine', vol: 0.05 },
      { beat: 3.5, beats: 1.5, freq: 622.25, type: 'sine', vol: 0.038 },
      { beat: 6.2, beats: 1.6, freq: 440, type: 'sine', vol: 0.042 },
    ],
  },
  // Ash-ember bed for the stage 3 shrine stub. Not the fort or the cold corridor.
  stage3: {
    bpm: 84,
    beats: 8,
    drones: [
      { freq: 92.5, type: 'triangle', vol: 0.07 },
      { freq: 138.59, type: 'sine', vol: 0.035 },
    ],
    notes: [
      { beat: 0, beats: 1.2, freq: 233.08, type: 'triangle', vol: 0.09 },
      { beat: 2, beats: 0.8, freq: 311.13, type: 'sine', vol: 0.07 },
      { beat: 3.5, beats: 1.1, freq: 196, type: 'triangle', vol: 0.08 },
      { beat: 5, beats: 1.0, freq: 349.23, type: 'sine', vol: 0.06 },
      { beat: 6.5, beats: 1.2, freq: 246.94, type: 'triangle', vol: 0.075 },
    ],
  },
  // Low pulse and clashing stabs. No shared melody with the stage beds.
  boss: {
    bpm: 126,
    beats: 8,
    drones: [{ freq: 55, type: 'sawtooth', vol: 0.05 }],
    notes: [
      { beat: 0, beats: 0.32, freq: 110, type: 'square', vol: 0.08 },
      { beat: 1, beats: 0.32, freq: 110, type: 'square', vol: 0.055 },
      { beat: 2, beats: 0.32, freq: 110, type: 'square', vol: 0.08 },
      { beat: 3, beats: 0.32, freq: 110, type: 'square', vol: 0.055 },
      { beat: 4, beats: 0.32, freq: 110, type: 'square', vol: 0.09 },
      { beat: 5, beats: 0.32, freq: 110, type: 'square', vol: 0.055 },
      { beat: 6, beats: 0.32, freq: 116.54, type: 'square', vol: 0.08 },
      { beat: 7, beats: 0.32, freq: 103.83, type: 'square', vol: 0.07 },
      { beat: 0, beats: 0.48, freq: 164.81, type: 'sawtooth', vol: 0.05 },
      { beat: 2, beats: 0.42, freq: 174.61, type: 'sawtooth', vol: 0.05 },
      { beat: 4, beats: 0.48, freq: 155.56, type: 'square', vol: 0.06 },
      { beat: 6, beats: 0.45, freq: 185, type: 'sawtooth', vol: 0.05 },
    ],
  },
};

function readStoredMute(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(MUTE_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

function writeStoredMute(muted: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode / quota */
  }
}

/**
 * Shared BGM/SFX manager. Prefer GameAudio.attach(scene) so one instance
 * survives scene restart and keeps mute + the current loop consistent.
 */
export class GameAudio {
  private bgm?: Phaser.Sound.BaseSound;
  private muted: boolean;
  private currentTrack: BgmTrack | null = null;
  private bgmActive = false;
  private phaserBgmOn = false;
  private fallbackCtx: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private bgmOscs: OscillatorNode[] = [];
  private bgmTimer: number | undefined;
  private bgmGen = 0;
  private nextLoopStart = 0;

  constructor(private scene: Phaser.Scene) {
    this.muted = readStoredMute();
    try {
      this.scene.sound.mute = this.muted;
    } catch {
      /* sound manager not ready */
    }
  }

  /** Preload placeholder OGG (+ WAV fallback) from public/assets/audio/. */
  static preload(scene: Phaser.Scene): void {
    const base = 'assets/audio';
    for (const key of Object.keys(SFX_VOL)) {
      scene.load.audio(key, [`${base}/${key}.ogg`, `${base}/${key}.wav`]);
    }
    scene.load.audio(BGM_KEY, [`${base}/${BGM_KEY}.ogg`, `${base}/${BGM_KEY}.wav`]);
  }

  /**
   * Get or create the registry singleton and rebind it to the active scene.
   * Rebinding keeps mute applied after scene.restart / stop→start.
   */
  static attach(scene: Phaser.Scene): GameAudio {
    const existing = scene.registry.get(AUDIO_REGISTRY_KEY) as GameAudio | undefined;
    if (existing) {
      existing.rebind(scene);
      return existing;
    }
    const audio = new GameAudio(scene);
    scene.registry.set(AUDIO_REGISTRY_KEY, audio);
    return audio;
  }

  static get(scene: Phaser.Scene): GameAudio | undefined {
    return scene.registry.get(AUDIO_REGISTRY_KEY) as GameAudio | undefined;
  }

  /** Point at the live scene (sound + cache are game-level; mute re-applied). */
  rebind(scene: Phaser.Scene): void {
    this.scene = scene;
    try {
      this.scene.sound.mute = this.muted;
    } catch {
      /* ignore */
    }
  }

  playSfx(key: string): void {
    if (this.muted) return;
    try {
      if (!this.scene.cache.audio.exists(key)) return;
      const vol = SFX_VOL[key] ?? OPTIONAL_SFX_VOL[key] ?? 0.45;
      this.scene.sound.play(key, { volume: vol });
    } catch {
      /* missing decode / autoplay / disposed manager */
    }
  }

  slash(): void {
    this.playSfx('sfx-slash');
    this.playSynth([{ type: 'square', freq: 240, freqEnd: 90, dur: 0.06, vol: 0.05 }]);
  }
  /** Skill cast — reuse slash until a dedicated cue exists. */
  skill(): void {
    this.slash();
  }
  hit(): void {
    this.playSfx('sfx-hit');
    this.playSynth([{ type: 'square', freq: 1400, freqEnd: 400, dur: 0.04, vol: 0.045 }]);
  }
  chest(): void {
    this.playSfx('sfx-chest');
  }
  door(): void {
    this.playSfx('sfx-door');
  }
  hurt(): void {
    this.playSfx('sfx-hurt');
    this.playSynth([{ type: 'sine', freq: 160, freqEnd: 70, dur: 0.12, vol: 0.07 }]);
  }
  bossDefeat(): void {
    this.playSfx('sfx-boss');
  }

  /** Soft menu / NPC / depart blip. */
  confirm(): void {
    this.unlock();
    this.playKeyOrSynth('sfx-ui', [
      { type: 'sine', freq: 660, freqEnd: 880, dur: 0.07, vol: 0.12 },
    ]);
  }

  /** Coin / item sparkle. */
  pickup(): void {
    this.playKeyOrSynth('sfx-pickup', [
      { type: 'square', freq: 988, dur: 0.05, vol: 0.06 },
      { type: 'sine', freq: 1319, dur: 0.08, vol: 0.11, delay: 0.05 },
      { type: 'triangle', freq: 1760, dur: 0.1, vol: 0.05, delay: 0.1 },
    ]);
  }

  /** Short resolve when the last Paste in a combat room falls. */
  roomClear(): void {
    this.playKeyOrSynth('sfx-clear', [
      { type: 'triangle', freq: 523.25, dur: 0.32, vol: 0.09 },
      { type: 'sine', freq: 659.25, dur: 0.36, vol: 0.08, delay: 0.04 },
      { type: 'triangle', freq: 783.99, dur: 0.4, vol: 0.07, delay: 0.08 },
    ]);
  }

  /** Low warning when a boss telegraph starts. */
  bossTelegraph(): void {
    this.playKeyOrSynth('sfx-boss-telegraph', [
      { type: 'sawtooth', freq: 78, freqEnd: 46, dur: 0.18, vol: 0.14 },
      { type: 'sine', freq: 55, freqEnd: 40, dur: 0.2, vol: 0.1, delay: 0.1 },
    ]);
  }

  /** Rising sting when Gully changes phase. */
  bossPhase(): void {
    this.playKeyOrSynth('sfx-boss-phase', [
      { type: 'square', freq: 196, freqEnd: 523, dur: 0.26, vol: 0.1 },
      { type: 'triangle', freq: 392, freqEnd: 784, dur: 0.3, vol: 0.08, delay: 0.05 },
      { type: 'sine', freq: 880, dur: 0.16, vol: 0.07, delay: 0.18 },
    ]);
  }

  /**
   * Stop whatever is playing and start `track` as a seamless loop.
   * Same track already running is left alone (volume / mute refreshed).
   */
  startBgm(track: BgmTrack = 'stage1'): void {
    if (this.currentTrack === track && this.bgmActive) {
      this.applyBgmVolume();
      this.unlock();
      return;
    }
    this.stopSynthBgm();
    this.clearPhaserBgm();
    this.currentTrack = track;
    const out = this.webAudio();
    if (!out) {
      this.startPhaserFallback();
      return;
    }
    this.unlock();
    try {
      this.armTrack(out.ctx, out.dest, track);
    } catch {
      this.stopSynthBgm();
      this.currentTrack = track;
      this.startPhaserFallback();
    }
  }

  /** Stop the current loop. */
  stopBgm(): void {
    this.shutdown();
  }

  /** Resume the current track after the browser unlocks audio. */
  ensurePlaying(): void {
    this.unlock();
    if (!this.currentTrack) return;
    if (!this.bgmActive) {
      this.startBgm(this.currentTrack);
      return;
    }
    if (this.phaserBgmOn && this.bgm && !isSoundPlaying(this.bgm)) {
      try {
        this.bgm.play();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Stop + remove BGM. Call from GameScene SHUTDOWN so leave / restart
   * never leaves a looping orphan under the next scene.
   */
  shutdown(): void {
    this.stopSynthBgm();
    this.clearPhaserBgm();
    this.currentTrack = null;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeStoredMute(this.muted);
    try {
      this.scene.sound.mute = this.muted;
    } catch {
      /* ignore */
    }
    this.applyBgmVolume();
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private playKeyOrSynth(key: string, tones: SynthTone[]): void {
    if (this.muted) return;
    try {
      if (this.scene.cache.audio.exists(key)) {
        const vol = SFX_VOL[key] ?? OPTIONAL_SFX_VOL[key] ?? 0.45;
        this.scene.sound.play(key, { volume: vol });
        return;
      }
    } catch {
      /* synth below */
    }
    this.playSynth(tones);
  }

  /** Short one-shot tones. Not tracked, so a BGM switch does not cut them. */
  private playSynth(tones: SynthTone[]): void {
    if (this.muted || tones.length === 0) return;
    const out = this.webAudio();
    if (!out) return;
    this.unlock();
    const now = out.ctx.currentTime;
    for (const tone of tones) {
      const dur = Math.max(0.03, tone.dur);
      const t0 = now + Math.max(0, tone.delay ?? 0);
      this.spawnTone(out.ctx, out.dest, t0, dur, tone.freq, tone.freqEnd, tone.type ?? 'sine', tone.vol, null);
    }
  }

  private webAudio(): { ctx: AudioContext; dest: AudioNode } | null {
    try {
      const snd = this.scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>;
      if (snd.context) {
        return { ctx: snd.context, dest: snd.destination ?? snd.context.destination };
      }
    } catch {
      /* html5 audio or a disposed manager */
    }
    if (!this.fallbackCtx) {
      try {
        this.fallbackCtx = new AudioContext();
      } catch {
        return null;
      }
    }
    return { ctx: this.fallbackCtx, dest: this.fallbackCtx.destination };
  }

  private unlock(): void {
    const out = this.webAudio();
    if (!out) return;
    if (out.ctx.state === 'suspended') {
      void out.ctx.resume().catch(() => {
        /* autoplay still locked */
      });
    }
  }

  private applyBgmVolume(): void {
    const v = this.muted ? 0 : BGM_VOL;
    if (this.bgmGain) {
      try {
        this.bgmGain.gain.value = v;
      } catch {
        /* ignore */
      }
    }
    if (this.bgm && 'setVolume' in this.bgm) {
      try {
        (this.bgm as { setVolume: (n: number) => void }).setVolume(this.muted ? 0 : PHASER_BGM_VOL);
      } catch {
        /* ignore */
      }
    }
  }

  private armTrack(ctx: AudioContext, dest: AudioNode, track: BgmTrack): void {
    const def = BGM_DEFS[track];
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : BGM_VOL;
    master.connect(dest);
    this.bgmGain = master;
    this.bgmActive = true;
    const gen = this.bgmGen;
    for (const drone of def.drones ?? []) {
      this.startDrone(ctx, master, drone.freq, drone.type, drone.vol);
    }
    const beatSec = 60 / def.bpm;
    const loopSec = def.beats * beatSec;
    this.nextLoopStart = ctx.currentTime + 0.05;
    this.pumpBgm(gen, ctx, master, def, beatSec, loopSec);
  }

  private pumpBgm(
    gen: number,
    ctx: AudioContext,
    dest: AudioNode,
    def: BgmDef,
    beatSec: number,
    loopSec: number,
  ): void {
    if (gen !== this.bgmGen || !this.bgmActive) return;
    const now = ctx.currentTime;
    if (this.nextLoopStart < now - 0.02) {
      const skip = Math.ceil((now - this.nextLoopStart) / loopSec);
      this.nextLoopStart += skip * loopSec;
    }
    while (this.nextLoopStart < now + 0.3) {
      this.scheduleLoop(ctx, dest, def, this.nextLoopStart, beatSec);
      this.nextLoopStart += loopSec;
    }
    this.bgmTimer = window.setTimeout(() => this.pumpBgm(gen, ctx, dest, def, beatSec, loopSec), 90);
  }

  private scheduleLoop(
    ctx: AudioContext,
    dest: AudioNode,
    def: BgmDef,
    loopStart: number,
    beatSec: number,
  ): void {
    const now = ctx.currentTime;
    for (const note of def.notes) {
      const t0 = loopStart + note.beat * beatSec;
      const dur = Math.max(0.05, note.beats * beatSec);
      if (t0 < now - 0.04) continue;
      this.spawnTone(ctx, dest, t0, dur, note.freq, undefined, note.type, note.vol, this.bgmOscs);
    }
  }

  private startDrone(ctx: AudioContext, dest: AudioNode, freq: number, type: OscKind, vol: number): void {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = vol;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      this.bgmOscs.push(osc);
    } catch {
      /* ignore a single drone failure */
    }
  }

  private spawnTone(
    ctx: AudioContext,
    dest: AudioNode,
    t0: number,
    dur: number,
    freq: number,
    freqEnd: number | undefined,
    type: OscKind,
    peak: number,
    track: OscillatorNode[] | null,
  ): void {
    try {
      const start = Math.max(t0, ctx.currentTime + 0.005);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(30, freq), start);
      if (freqEnd !== undefined) {
        osc.frequency.linearRampToValueAtTime(Math.max(30, freqEnd), start + dur);
      }
      this.shapeGain(gain, start, dur, Math.max(0.0002, peak));
      osc.connect(gain);
      gain.connect(dest);
      osc.start(start);
      osc.stop(start + dur + 0.03);
      if (track) {
        track.push(osc);
        osc.onended = () => {
          const i = track.indexOf(osc);
          if (i >= 0) track.splice(i, 1);
        };
      }
    } catch {
      /* ignore a single voice */
    }
  }

  private shapeGain(gain: GainNode, t0: number, dur: number, peak: number): void {
    const atk = Math.min(Math.max(0.008, dur * 0.18), dur * 0.4);
    const end = t0 + dur;
    const mid = t0 + Math.max(atk + 0.005, dur * 0.62);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    if (mid < end - 0.004) gain.gain.setValueAtTime(peak, mid);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  private stopSynthBgm(): void {
    this.bgmGen += 1;
    this.bgmActive = false;
    if (this.bgmTimer !== undefined) {
      window.clearTimeout(this.bgmTimer);
      this.bgmTimer = undefined;
    }
    const oscs = this.bgmOscs;
    this.bgmOscs = [];
    for (const osc of oscs) {
      try {
        osc.onended = null;
      } catch {
        /* ignore */
      }
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        osc.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      this.bgmGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.bgmGain = null;
  }

  /** OGG loop when WebAudio cannot start. Same file for every track. */
  private startPhaserFallback(): void {
    try {
      if (!this.scene.cache.audio.exists(BGM_KEY)) return;
      this.bgm = this.scene.sound.add(BGM_KEY, {
        loop: true,
        volume: this.muted ? 0 : PHASER_BGM_VOL,
      });
      this.phaserBgmOn = true;
      this.bgmActive = true;
      try {
        this.bgm.play();
      } catch {
        /* autoplay — ensurePlaying retries */
      }
    } catch {
      this.bgm = undefined;
      this.phaserBgmOn = false;
      this.bgmActive = false;
    }
  }

  /** Stop and destroy every Phaser sound on the fallback BGM key. */
  private clearPhaserBgm(): void {
    this.phaserBgmOn = false;
    try {
      this.scene.sound.stopByKey(BGM_KEY);
    } catch {
      /* ignore */
    }
    try {
      this.scene.sound.removeByKey(BGM_KEY);
    } catch {
      /* ignore */
    }
    if (this.bgm) {
      try {
        if (this.bgm.isPlaying) this.bgm.stop();
      } catch {
        /* ignore */
      }
      try {
        this.bgm.destroy();
      } catch {
        /* ignore */
      }
    }
    this.bgm = undefined;
  }
}

/** Clearer API alias — same class, drop-in for call sites / docs. */
export { GameAudio as AudioManager };

function isSoundPlaying(sound: Phaser.Sound.BaseSound): boolean {
  try {
    return !!sound.isPlaying;
  } catch {
    return false;
  }
}
