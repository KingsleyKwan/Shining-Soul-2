import type Phaser from 'phaser';

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

export const AUDIO_REGISTRY_KEY = 'gameAudio';

/**
 * Placeholder OGG under public/assets/audio/.
 * Swap same-named files later (GBAMusRippy / custom) — keys stay identical.
 */
export class GameAudio {
  private bgm?: Phaser.Sound.BaseSound;
  private muted = false;
  private startedBgm = false;

  constructor(private readonly scene: Phaser.Scene) {}

  static preload(scene: Phaser.Scene): void {
    const base = 'assets/audio';
    for (const key of Object.keys(SFX_VOL)) {
      scene.load.audio(key, [`${base}/${key}.ogg`, `${base}/${key}.wav`]);
    }
    scene.load.audio(BGM_KEY, [`${base}/${BGM_KEY}.ogg`, `${base}/${BGM_KEY}.wav`]);
  }

  static get(scene: Phaser.Scene): GameAudio | undefined {
    return scene.registry.get(AUDIO_REGISTRY_KEY) as GameAudio | undefined;
  }

  playSfx(key: string): void {
    if (this.muted) return;
    if (!this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key, { volume: SFX_VOL[key] ?? 0.4 });
  }

  slash(): void {
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

  startBgm(): void {
    if (this.startedBgm) return;
    this.startedBgm = true;
    if (!this.scene.cache.audio.exists(BGM_KEY)) return;
    // Avoid stacked loops after scene.restart (R)
    this.scene.sound.stopByKey(BGM_KEY);
    this.bgm = this.scene.sound.add(BGM_KEY, {
      loop: true,
      volume: this.muted ? 0 : BGM_VOL,
    });
    try {
      this.bgm.play();
    } catch {
      // Autoplay may block until first gesture; unlock handler retries
    }
  }

  /** Resume BGM after browser unlocks audio. */
  ensurePlaying(): void {
    if (!this.bgm) {
      this.startBgm();
      return;
    }
    if (!this.bgm.isPlaying) {
      try {
        this.bgm.play();
      } catch {
        /* ignore */
      }
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.scene.sound.mute = this.muted;
    if (this.bgm && 'setVolume' in this.bgm) {
      (this.bgm as { setVolume: (v: number) => void }).setVolume(this.muted ? 0 : BGM_VOL);
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
