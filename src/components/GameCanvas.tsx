import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { RetroAudioDirector } from '../game/audio'
import { RetroNinjaEngine } from '../game/engine'
import type { GamePhase, RunResult, RunStats } from '../game/types'

export interface GameCanvasHandle {
  jump: () => void
  restart: () => void
  summon: () => void
}

interface GameCanvasProps {
  muted: boolean
  bestDistance: number
  onStats: (stats: RunStats) => void
  onPhaseChange: (phase: GamePhase) => void
  onRunComplete: (run: RunResult) => void
}

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  { muted, bestDistance, onStats, onPhaseChange, onRunComplete },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RetroNinjaEngine | null>(null)
  const audioRef = useRef<RetroAudioDirector | null>(null)
  const mutedRef = useRef(muted)
  const initialBestDistanceRef = useRef(bestDistance)
  const statsRef = useRef(onStats)
  const phaseRef = useRef(onPhaseChange)
  const runRef = useRef(onRunComplete)

  mutedRef.current = muted
  statsRef.current = onStats
  phaseRef.current = onPhaseChange
  runRef.current = onRunComplete

  useImperativeHandle(ref, () => ({
    jump: () => engineRef.current?.jump(),
    restart: () => engineRef.current?.restart(),
    summon: () => engineRef.current?.summon(),
  }))

  useEffect(() => {
    audioRef.current?.setMuted(muted)
  }, [muted])

  useEffect(() => {
    engineRef.current?.setBestDistance(bestDistance)
  }, [bestDistance])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const audio = new RetroAudioDirector()
    audio.setMuted(mutedRef.current)
    audioRef.current = audio

    const engine = new RetroNinjaEngine(
      host,
      {
        onStats: (stats) => {
          statsRef.current(stats)
          audio.setIntensity(Math.min(1, stats.speed / 760 + stats.flow / 260 + stats.aura / 500))
        },
        onPhaseChange: (phase) => {
          phaseRef.current(phase)
          if (phase === 'running') audio.resumeMusic()
          else audio.stopMusic()
        },
        onRunComplete: (run) => runRef.current(run),
        onFirstInput: () => {
          audio.setMuted(mutedRef.current)
          void audio.start()
        },
        onJump: (quality) => audio.jump(quality),
        onCoin: (value) => audio.coin(value),
        onPortal: () => audio.portal(),
        onSummon: () => audio.summon(),
        onStrike: () => audio.strike(),
        onCrash: () => audio.crash(),
      },
      initialBestDistanceRef.current,
    )

    engineRef.current = engine
    let cancelled = false
    void engine.init().then(() => {
      if (cancelled) engine.destroy()
    })

    return () => {
      cancelled = true
      engine.destroy()
      audio.dispose()
      if (engineRef.current === engine) engineRef.current = null
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [])

  return <div ref={hostRef} className="game-canvas-host" aria-label="Aura Quest game canvas" />
})
