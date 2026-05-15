import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { RetroNinjaEngine } from '../game/engine'
import type { GamePhase, RunResult, RunStats } from '../game/types'
import type { RetroAudioDirector } from '../game/audio'

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

    let disposed = false
    let audioPromise: Promise<RetroAudioDirector> | null = null

    const ensureAudio = async () => {
      if (audioRef.current) return audioRef.current
      if (!audioPromise) {
        audioPromise = import('../game/audio').then(({ RetroAudioDirector }) => {
          const audio = new RetroAudioDirector()
          audio.setMuted(mutedRef.current)
          if (disposed) {
            audio.dispose()
            throw new Error('Audio disposed before startup')
          }
          audioRef.current = audio
          return audio
        })
      }
      return audioPromise
    }

    const engine = new RetroNinjaEngine(
      host,
      {
        onStats: (stats) => {
          statsRef.current(stats)
          audioRef.current?.setIntensity(Math.min(1, stats.speed / 760 + stats.flow / 260 + stats.aura / 500))
        },
        onPhaseChange: (phase) => {
          phaseRef.current(phase)
          const audio = audioRef.current
          if (!audio) return
          if (phase === 'running') audio.resumeMusic()
          else audio.stopMusic()
        },
        onRunComplete: (run) => runRef.current(run),
        onFirstInput: () => {
          void ensureAudio()
            .then((audio) => {
              audio.setMuted(mutedRef.current)
              return audio.start()
            })
            .catch(() => {
              // Audio is optional; gameplay should never block on a mobile autoplay edge case.
            })
        },
        onJump: (quality) => audioRef.current?.jump(quality),
        onCoin: (value) => audioRef.current?.coin(value),
        onPortal: () => audioRef.current?.portal(),
        onSummon: () => audioRef.current?.summon(),
        onStrike: () => audioRef.current?.strike(),
        onCrash: () => audioRef.current?.crash(),
      },
      initialBestDistanceRef.current,
    )

    engineRef.current = engine
    let cancelled = false
    void engine.init().then(() => {
      if (cancelled) engine.destroy()
    })

    return () => {
      disposed = true
      cancelled = true
      engine.destroy()
      audioRef.current?.dispose()
      if (engineRef.current === engine) engineRef.current = null
      audioRef.current = null
    }
  }, [])

  return <div ref={hostRef} className="game-canvas-host" aria-label="Aura Farm game canvas" />
})
