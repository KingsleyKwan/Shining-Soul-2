import type { DungeonOptions } from '../systems/MapGenerator';

/** Numeric stage ids used in saves and the registry. */
export type StageId = 1 | 2;

export type StageDef = {
  id: StageId;
  nameZh: string;
  shortName: string;
  /** MapGenerator knobs — stage 1 keeps stock Paste counts/HP. */
  mapOptions: DungeonOptions;
};

/** Phaser registry key for the stage chosen on StageSelectScene. */
export const SELECTED_STAGE_KEY = 'selectedStageId';

export const STAGES: readonly StageDef[] = [
  {
    id: 1,
    nameZh: '遺跡大廳',
    shortName: '遺跡',
    mapOptions: {},
  },
  {
    id: 2,
    nameZh: '深層迴廊',
    shortName: '深層',
    // Tougher Pastes + one extra per combat room (placement falls back to base).
    mapOptions: { pasteHpScale: 1.5, pasteCountBonus: 1 },
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
