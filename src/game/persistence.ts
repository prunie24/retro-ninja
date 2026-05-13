import type { RunResult } from './types'

const STORAGE_KEY = 'retro-ninja-save-v1'

export interface LocalSave {
  bestDistance: number
  bestCoins: number
  bestDurationMs: number
  lifetimeCoins: number
  runsPlayed: number
  nickname: string
  muted: boolean
  recentRuns: RunResult[]
}

export const defaultSave: LocalSave = {
  bestDistance: 0,
  bestCoins: 0,
  bestDurationMs: 0,
  lifetimeCoins: 0,
  runsPlayed: 0,
  nickname: '',
  muted: false,
  recentRuns: [],
}

export function loadLocalSave(): LocalSave {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSave

    const parsed = JSON.parse(raw) as Partial<LocalSave>
    return {
      ...defaultSave,
      ...parsed,
      recentRuns: Array.isArray(parsed.recentRuns) ? parsed.recentRuns.slice(0, 10) : [],
    }
  } catch {
    return defaultSave
  }
}

export function writeLocalSave(save: LocalSave): LocalSave {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(save))
  return save
}

export function recordRun(save: LocalSave, run: RunResult): LocalSave {
  return writeLocalSave({
    ...save,
    bestDistance: Math.max(save.bestDistance, run.distance),
    bestCoins: Math.max(save.bestCoins, run.coins),
    bestDurationMs: Math.max(save.bestDurationMs, run.durationMs),
    lifetimeCoins: save.lifetimeCoins + run.coins,
    runsPlayed: save.runsPlayed + 1,
    recentRuns: [run, ...save.recentRuns].slice(0, 10),
  })
}

export function updateNickname(save: LocalSave, nickname: string): LocalSave {
  return writeLocalSave({ ...save, nickname: nickname.slice(0, 18) })
}

export function updateMuted(save: LocalSave, muted: boolean): LocalSave {
  return writeLocalSave({ ...save, muted })
}
