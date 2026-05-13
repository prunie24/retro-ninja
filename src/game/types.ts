export type GamePhase = 'idle' | 'running' | 'gameover'

export interface RunStats {
  phase: GamePhase
  distance: number
  coins: number
  speed: number
  peakSpeed: number
  flow: number
  combo: number
  charge: number
  aura: number
  auraReady: boolean
  evolution: number
  invincible: boolean
  summonActive: boolean
  jumps: number
  bestDistance: number
  fps: number
}

export interface RunResult {
  id: string
  distance: number
  coins: number
  durationMs: number
  peakSpeed: number
  createdAt: string
}

export interface GameCallbacks {
  onStats?: (stats: RunStats) => void
  onPhaseChange?: (phase: GamePhase) => void
  onRunComplete?: (run: RunResult) => void
  onFirstInput?: () => void
  onJump?: (quality: number) => void
  onCoin?: (value: number) => void
  onPortal?: () => void
  onSummon?: () => void
  onStrike?: () => void
  onCrash?: () => void
}
