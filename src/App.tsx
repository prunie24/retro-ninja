import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
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

  const toggleMuted = () => {
    setSave((current) => updateMuted(current, !current.muted))
  }

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

        <div className="top-hud">
          <div className="hud-left">
            <button
              className="hud-icon"
              type="button"
              title="Reset run"
              aria-label="Reset run"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => gameRef.current?.restart()}
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="hud-icon"
              type="button"
              title="Toggle sound"
              aria-label="Toggle sound"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={toggleMuted}
            >
              {save.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>

          <div className="hud-score">
            <span>HEIGHT</span>
            <strong>{stats.distance}<em>M</em></strong>
            <small>BEST {save.bestDistance}M · RANK {rank}</small>
          </div>

          <div
            className={`hud-right${stats.summonActive ? ' is-summoned' : ''}${stats.invincible ? ' is-invincible' : ''}`}
            style={{ '--aura-progress': `${stats.aura}%` } as CSSProperties}
          >
            <button
              className={`summon-button${stats.auraReady ? ' is-ready' : ''}${stats.invincible ? ' is-active' : ''}`}
              type="button"
              disabled={!stats.auraReady || phase !== 'running'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => gameRef.current?.summon()}
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

        {phase !== 'running' && (
          <div className="launch-layer">
            <div className="brand-mark">
              <Swords size={18} />
              <strong>AURA QUEST</strong>
              <span>WALL CLIMB</span>
            </div>
            <div className="rank-sigil">
              <span>{phase === 'gameover' ? rank : 'READY'}</span>
              <strong>{phase === 'gameover' ? `${stats.distance}M` : 'ASCEND'}</strong>
            </div>
            <button
              className="ignite-button"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => gameRef.current?.jump()}
            >
              <span>{phase === 'gameover' ? 'RUN AGAIN' : 'START RUN'}</span>
              <Play size={18} fill="currentColor" />
            </button>
            <p className="launch-hint">
              <Zap size={12} /> SURVIVE THE DOMAIN
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
