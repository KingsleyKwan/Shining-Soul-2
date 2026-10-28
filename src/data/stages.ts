import type { DungeonOptions } from '../systems/MapGenerator';

/** Numeric stage ids used in saves and the registry. */
export type StageId = 1 | 2;

/** Per-stage look — tint/fog/props so stages do not share one palette. */
export type StageVisual = {
  /** Camera / void behind the map. */
  bgColor: string;
  /** Tint applied to ground layer (0xRRGGBB). */
  groundTint: number;
  /** Tint applied to walls layer. */
  wallTint: number;
  /** Semi-transparent fog fill over the map. */
  fogColor: number;
  fogAlpha: number;
  /** HUD / nameplate accent (#hex). */
  nameplateColor: string;
  /** MapGenerator prop density multiplier. */
  propDensity: number;
  floorStyle: 'checker' | 'stripe' | 'dense';
};

export type StageDef = {
  id: StageId;
  nameZh: string;
  shortName: string;
  /** MapGenerator knobs — stage 1 keeps stock Paste counts/HP. */
  mapOptions: DungeonOptions;
  visual: StageVisual;
  /** BGM track key for GameAudio.startBgm. */
  bgm: 'stage1' | 'stage2';
};

/** Phaser registry key for the stage chosen on StageSelectScene. */
export const SELECTED_STAGE_KEY = 'selectedStageId';

export const STAGES: readonly StageDef[] = [
  {
    id: 1,
    nameZh: '哥不林要塞',
    shortName: '要塞',
    mapOptions: { propDensity: 0.9, floorStyle: 'checker' },
    visual: {
      // Early Klantol / Goblin Fort — warm mossy greens & earth.
      bgColor: '#1a1810',
      groundTint: 0xd8e8a8,
      wallTint: 0xc4b070,
      fogColor: 0x3a5020,
      fogAlpha: 0.1,
      nameplateColor: '#c8e878',
      propDensity: 0.9,
      floorStyle: 'checker',
    },
    bgm: 'stage1',
  },
  {
    id: 2,
    nameZh: '深層迴廊',
    shortName: '深層',
    // Tougher Pastes + denser cold corridor props.
    mapOptions: {
      pasteHpScale: 1.5,
      pasteCountBonus: 1,
      propDensity: 1.45,
      floorStyle: 'dense',
    },
    visual: {
      // Later corridor — cold blue-purple, heavier fog.
      bgColor: '#0a0c18',
      groundTint: 0x88a0d8,
      wallTint: 0x7060a8,
      fogColor: 0x182848,
      fogAlpha: 0.2,
      nameplateColor: '#a8c0ff',
      propDensity: 1.45,
      floorStyle: 'dense',
    },
    bgm: 'stage2',
  },
];

const BY_ID: Record<StageId, StageDef> = {
  1: STAGES[0]!,
  2: STAGES[1]!,
};

export function isStageId(value: unknown): value is StageId {
  return value === 1 || value === 2;
}

export function getStage(id: StageId): StageDef {
  return BY_ID[id];
}

/** Fresh / missing saves always unlock stage 1. */
export function defaultUnlockedStages(): StageId[] {
  return [1];
}

/** Next stage after `id`, or null if this is the last. */
export function nextStageId(id: StageId): StageId | null {
  const next = (id + 1) as number;
  return isStageId(next) ? next : null;
}

/** Coerce registry / URL junk to a known stage (default 1). */
export function coerceStageId(value: unknown): StageId {
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (isStageId(n)) return n;
  }
  if (isStageId(value)) return value;
  return 1;
}
