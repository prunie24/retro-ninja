import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Coins, Crosshair, Flame, Play, RotateCcw, Sparkles, Swords, Volume2, VolumeX, Zap } from 'lucide-react'
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
  evolution: 1,
  invincible: false,
  summonActive: false,
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

        <div className="hud-line">
          <div className="identity-lockup">
            <div className="identity-mark">
              <Swords size={17} />
            </div>
            <div>
              <strong>AURA QUEST</strong>
              <span>DOMAIN RUN</span>
            </div>
          </div>

          <div className="control-ring">
            <button className="blade-button reset-button" type="button" title="Reset run" aria-label="Reset run" onClick={() => gameRef.current?.restart()}>
              <RotateCcw size={17} />
              <span>RESET</span>
            </button>
            <button className="blade-button" type="button" title="Toggle soundtrack" aria-label="Toggle soundtrack" onClick={toggleMuted}>
              {save.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
          </div>
        </div>

        {phase !== 'running' && (
          <div className="launch-layer">
            <div className="rank-sigil">
              <span>{phase === 'gameover' ? rank : 'GATE'}</span>
              <strong>{phase === 'gameover' ? `${stats.distance}M` : 'ENTER'}</strong>
            </div>
            <button className="ignite-button" type="button" onClick={() => gameRef.current?.jump()}>
              <span>{phase === 'gameover' ? 'RUN AGAIN' : 'START RUN'}</span>
              <Play size={18} fill="currentColor" />
            </button>
          </div>
        )}

        <div
          className={`aura-stack${stats.summonActive ? ' is-summoned' : ''}${stats.invincible ? ' is-invincible' : ''}`}
          aria-live="polite"
          style={{ '--aura-progress': `${stats.aura}%` } as CSSProperties}
        >
          <div className="aura-topline">
            <span>AURA LV {stats.evolution}</span>
            <strong>{stats.aura}</strong>
          </div>
          <div className="aura-track">
            <i />
          </div>
          <div className="aura-foot">
            <span>BEST {save.bestDistance}M</span>
            <b>{rank}</b>
          </div>
          <button
            className="summon-button"
            type="button"
            disabled={!stats.auraReady || phase !== 'running'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => gameRef.current?.summon()}
          >
            <Sparkles size={13} />
            <span>{stats.summonActive ? 'GUARDIAN' : stats.invincible ? 'INVINCIBLE' : 'SUMMON'}</span>
          </button>
        </div>

        <div className="run-readout" aria-live="polite">
          <Readout icon={<Zap size={14} />} label="DIST" value={`${stats.distance}M`} />
          <Readout icon={<Flame size={14} />} label="FLOW" value={`${stats.flow}%`} />
          <Readout icon={<Crosshair size={14} />} label="JUMP" value={`${stats.jumps}/2`} />
          <Readout icon={<Coins size={14} />} label="COIN" value={stats.coins.toString()} />
        </div>

        <div className="rotate-device">
          <strong>LANDSCAPE</strong>
          <span>ROTATE DEVICE</span>
        </div>
      </section>
    </main>
  )
}

function Readout({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="readout-cell">
      {icon}
      <p>{label}</p>
      <b>{value}</b>
    </div>
  )
}

function rankFor(stats: RunStats) {
  const score = stats.distance * 0.85 + stats.coins * 9 + stats.flow * 2.4 + stats.combo * 18 + stats.evolution * 24
  if (score >= 900) return 'SS'
  if (score >= 620) return 'S'
  if (score >= 390) return 'A'
  if (score >= 210) return 'B'
  return 'D'
}

export default App
