import type Phaser from 'phaser';

/**
 * AudioManager / GameAudio — BGM + SFX for the Phaser remake.
 *
 * Drop-in asset keys (swap files under public/assets/audio/; names stay identical
 * for GBAMusRippy / custom rips later):
 *   BGM  bgm-dungeon
 *   SFX  sfx-slash | sfx-hit | sfx-chest | sfx-door | sfx-hurt | sfx-boss
 *
 * Mute persists in localStorage (`MUTE_STORAGE_KEY`), separate from B1 save.
 * Call shutdown() on GameScene leave so BGM never stacks across restart / 選角.
 */

const SFX_VOL: Record<string, number> = {
  'sfx-slash': 0.35,
  'sfx-hit': 0.42,
  'sfx-chest': 0.5,
  'sfx-door': 0.45,
  'sfx-hurt': 0.48,
  'sfx-boss': 0.55,
};

const BGM_KEY = 'bgm-dungeon';
const BGM_VOL = 0.22;

/** Registry key for the shared audio manager (game-wide). */
export const AUDIO_REGISTRY_KEY = 'gameAudio';

/** Mute flag — independent of shining-soul-2-save-v1. */
export const MUTE_STORAGE_KEY = 'shining-soul-2-mute-v1';

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
 * survives scene restart and keeps mute + BGM handoff consistent.
 */
export class GameAudio {
  private bgm?: Phaser.Sound.BaseSound;
  private muted: boolean;
  private startedBgm = false;

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
      this.scene.sound.play(key, { volume: SFX_VOL[key] ?? 0.4 });
    } catch {
      /* missing decode / autoplay / disposed manager */
    }
  }

  slash(): void {
    this.playSfx('sfx-slash');
  }
  /** Skill cast — reuse slash until a dedicated cue exists. */
  skill(): void {
    this.playSfx('sfx-slash');
  }
  hit(): void {
    this.playSfx('sfx-hit');
  }
  chest(): void {
    this.playSfx('sfx-chest');
  }
  door(): void {
    this.playSfx('sfx-door');
  }
  hurt(): void {
    this.playSfx('sfx-hurt');
  }
  bossDefeat(): void {
    this.playSfx('sfx-boss');
  }

  /**
   * Start (or keep) the dungeon BGM loop. Always clears orphans first so
   * scene.restart / 選角→再入 never stacks loops.
   */
  startBgm(): void {
    if (this.startedBgm && this.bgm && isSoundPlaying(this.bgm)) {
      this.applyBgmVolume();
      return;
    }
    this.clearBgm();
    try {
      if (!this.scene.cache.audio.exists(BGM_KEY)) return;
      this.bgm = this.scene.sound.add(BGM_KEY, {
        loop: true,
        volume: this.muted ? 0 : BGM_VOL,
      });
      this.startedBgm = true;
      try {
        this.bgm.play();
      } catch {
        // Autoplay may block until first gesture; ensurePlaying retries.
      }
    } catch {
      this.bgm = undefined;
      this.startedBgm = false;
    }
  }

  /** Resume BGM after browser unlocks audio. */
  ensurePlaying(): void {
    if (!this.bgm || !this.startedBgm) {
      this.startBgm();
      return;
    }
    if (!isSoundPlaying(this.bgm)) {
      try {
        this.bgm.play();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Stop + remove BGM. Call from GameScene SHUTDOWN so leave / restart
   * never leaves a looping orphan under SelectScene or a double on recreate.
   */
  shutdown(): void {
    this.clearBgm();
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

  private applyBgmVolume(): void {
    if (!this.bgm) return;
    try {
      if ('setVolume' in this.bgm) {
        (this.bgm as { setVolume: (v: number) => void }).setVolume(this.muted ? 0 : BGM_VOL);
      }
    } catch {
      /* ignore */
    }
  }

  /** Stop and destroy every sound with the BGM key (guards against orphans). */
  private clearBgm(): void {
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
    this.startedBgm = false;
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
