import { useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { Play, RotateCcw, Sparkles, Swords, Volume2, VolumeX, Zap } from 'lucide-react'
import { GameCanvas, type GameCanvasHandle } from './components/GameCanvas'
import { defaultSave, loadLocalSave, recordRun, updateMuted, type LocalSave } from './game/persistence'
import type { GamePhase, RunResult, RunStats } from './game/types'

const initialStats: RunStats = {
  phase: 'idle',
  distance: 0,
  coins: 0,
  speed: 0,
  peakSpeed: 0,
  flow: 0,
  combo: 0,
  charge: 0,
  aura: 0,
  auraReady: false,
  evolution: 0,
  invincible: false,
  summonActive: false,
  auraMode: 'none',
  jumps: 0,
  bestDistance: 0,
  fps: 0,
}

function App() {
  const gameRef = useRef<GameCanvasHandle | null>(null)
  const [save, setSave] = useState<LocalSave>(() => {
    if (typeof window === 'undefined') return defaultSave
    return loadLocalSave()
  })
  const [stats, setStats] = useState<RunStats>({ ...initialStats, bestDistance: save.bestDistance })
  const [phase, setPhase] = useState<GamePhase>('idle')

  const handleRunComplete = useCallback((run: RunResult) => {
    setSave((current) => {
      const next = recordRun(current, run)
      setStats((existing) => ({ ...existing, bestDistance: next.bestDistance }))
      return next
    })
  }, [])

  const toggleMuted = useCallback(() => {
    setSave((current) => updateMuted(current, !current.muted))
  }, [])

  const rank = useMemo(() => rankFor(stats), [stats])
  const auraLabel =
    stats.auraMode === 'beast'
      ? 'BEAST'
      : stats.auraMode === 'sword'
        ? 'SWORD'
        : stats.auraMode === 'shield'
          ? 'SHIELD'
          : stats.evolution >= 3
            ? 'BEAST'
            : stats.evolution >= 2
              ? 'SWORD'
              : stats.evolution >= 1
                ? 'SHIELD'
                : 'AURA'
  const showLaunch = phase === 'idle' || phase === 'gameover'
  const handleRestartPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    gameRef.current?.restart()
  }, [])
  const handleRestartClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.detail === 0) gameRef.current?.restart()
  }, [])
  const handleMutePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    toggleMuted()
  }, [toggleMuted])
  const handleMuteClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.detail === 0) toggleMuted()
  }, [toggleMuted])
  const handleSummonPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    gameRef.current?.summon()
  }, [])
  const handleSummonClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.detail === 0) gameRef.current?.summon()
  }, [])
  const handleStartPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    gameRef.current?.jump()
  }, [])
  const handleStartClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.detail === 0) gameRef.current?.jump()
  }, [])

  return (
    <main className="aura-shell">
      <section className="run-stage">
        <GameCanvas
          ref={gameRef}
          muted={save.muted}
          bestDistance={save.bestDistance}
          onStats={setStats}
          onPhaseChange={setPhase}
          onRunComplete={handleRunComplete}
        />

        <div className={`top-hud${showLaunch ? ' is-launch' : ''}`}>
          <div className="hud-left">
            <button
              className="hud-icon"
              type="button"
              title="Reset run"
              aria-label="Reset run"
              onPointerDown={handleRestartPointerDown}
              onClick={handleRestartClick}
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="hud-icon"
              type="button"
              title="Toggle sound"
              aria-label="Toggle sound"
              onPointerDown={handleMutePointerDown}
              onClick={handleMuteClick}
            >
              {save.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>

          <div className="hud-score">
            <span>HEIGHT</span>
            <strong>{stats.distance}<em>M</em></strong>
            <small>BEST {save.bestDistance}M</small>
          </div>

          <div
            className={`hud-right${stats.summonActive ? ' is-summoned' : ''}${stats.invincible ? ' is-invincible' : ''}`}
            style={{ '--aura-progress': `${stats.aura}%` } as CSSProperties}
          >
            <button
              className={`summon-button${stats.auraReady ? ' is-ready' : ''}${stats.invincible ? ' is-active' : ''}`}
              type="button"
              disabled={!stats.auraReady || phase !== 'running'}
              onPointerDown={handleSummonPointerDown}
              onClick={handleSummonClick}
            >
              <Sparkles size={20} />
              <span>{auraLabel}</span>
            </button>
            <div className="aura-rail">
              <i />
            </div>
            <div className="aura-pips" aria-hidden="true">
              <span className={stats.evolution >= 1 ? 'on' : ''} />
              <span className={stats.evolution >= 2 ? 'on' : ''} />
              <span className={stats.evolution >= 3 ? 'on glow' : ''} />
            </div>
          </div>
        </div>

        {showLaunch && (
          <div className="launch-layer">
            <div className="brand-mark">
              <Swords size={18} />
              <strong>AURA FARM</strong>
              <span>WALL RUN</span>
            </div>
            <div className="rank-sigil">
              <span>{phase === 'gameover' ? `RANK ${rank}` : 'AURA READY'}</span>
              <strong>{phase === 'gameover' ? `${stats.distance}M` : 'CLIMB'}</strong>
            </div>
            <button
              className="ignite-button"
              type="button"
              onPointerDown={handleStartPointerDown}
              onClick={handleStartClick}
            >
              <span>{phase === 'gameover' ? 'RETRY' : 'START'}</span>
              <Play size={18} fill="currentColor" />
            </button>
            <p className="launch-hint">
              <Zap size={12} /> BEST {save.bestDistance}M
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

function rankFor(stats: RunStats) {
  const score = stats.distance * 1.1 + stats.coins * 8 + stats.evolution * 60 + stats.jumps * 4
  if (score >= 1400) return 'SS'
  if (score >= 900) return 'S'
  if (score >= 520) return 'A'
  if (score >= 260) return 'B'
  return 'D'
}

export default App
