import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Ticker } from 'pixi.js'
import {
  AURA_FILL_PER_SEC,
  AURA_MAX,
  AURA_ORB_FILL,
  AURA_TIER_1,
  AURA_TIER_2,
  BASE_CLIMB_SPEED,
  BEAST_SECONDS,
  CLIMB_RAMP,
  GAME_COLORS,
  HOP_ARC_LIFT,
  HOP_DURATION_BASE,
  INTRO_SECONDS,
  MAX_CLIMB_SPEED,
  MAX_WALL_THICKNESS,
  MIN_WALL_THICKNESS,
  PLAYER_INSET,
  PLAYER_RADIUS,
  PLAYER_SCREEN_Y_PCT,
  SHIELD_SECONDS,
  SLASH_COST,
  SLASH_SECONDS,
  WALL_INSET_PX,
  WALL_THICKNESS_PCT,
} from './constants'
import type { GameCallbacks, GamePhase, RunResult, RunStats } from './types'

type WallSide = 'left' | 'right'
type EntityKind = 'wall-spike' | 'wall-trap' | 'wall-flame' | 'wall-mob' | 'gate-spear' | 'air-bird' | 'mini-boss' | 'aura-orb' | 'portal' | 'coin'
type DomainTextureKey = 'coin' | 'spike' | 'orb' | 'block' | 'portal' | 'crawler' | 'wraith' | 'slash'
type PlayerMotion = 'idle' | 'run' | 'jump' | 'fall' | 'attack' | 'summon'
type GuardianMotion = 'emerge' | 'guard' | 'attack'
type CoinPattern = 'wall-sparks' | 'switch-breadcrumbs' | 'risk-pair' | 'portal-spark' | 'boss-prize'

const PLAYER_MOTIONS: PlayerMotion[] = ['idle', 'run', 'jump', 'fall', 'attack', 'summon']
const GUARDIAN_MOTIONS: GuardianMotion[] = ['emerge', 'guard', 'attack']

const PLAYER_MOTION_COUNTS: Record<PlayerMotion, number> = {
  idle: 4,
  run: 10,
  jump: 6,
  fall: 6,
  attack: 6,
  summon: 6,
}

const GUARDIAN_MOTION_COUNTS: Record<GuardianMotion, number> = {
  emerge: 5,
  guard: 6,
  attack: 6,
}

const PLAYER_MOTION_HEIGHTS: Record<PlayerMotion, number> = {
  idle: 52,
  run: 56,
  jump: 58,
  fall: 58,
  attack: 62,
  summon: 64,
}

const motionPath = (root: 'hunter' | 'summon', motion: string, index: number) =>
  `/assets/${root}/motion/${motion}-${String(index).padStart(2, '0')}.webp`

const smoothStep = (amount: number) => {
  const t = Math.max(0, Math.min(1, amount))
  return t * t * (3 - 2 * t)
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

interface GameEntity {
  id: number
  kind: EntityKind
  textureKey?: DomainTextureKey
  side?: WallSide
  screenX: number
  screenY: number
  width: number
  height: number
  radius: number
  value: number
  velocityX: number
  killed: boolean
  killFx: number
  spin: number
  wobble: number
  container: Container
  graphic: Graphics
  sprite?: Sprite
}

interface Particle {
  graphic: Container
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  drag: number
}

interface VerticalLayout {
  width: number
  height: number
  wallThickness: number
  leftWallInner: number
  rightWallInner: number
  laneCenter: number
  playerScreenY: number
}

export class RetroNinjaEngine {
  private app = new Application()
  private readonly callbacks: GameCallbacks
  private readonly host: HTMLElement
  private phase: GamePhase = 'idle'

  private backgroundArtLayer = new Container()
  private background = new Graphics()
  private wallLayer = new Graphics()
  private hazardLayer = new Container()
  private pickupLayer = new Container()
  private particleLayer = new Container()
  private guardianLayer = new Container()
  private summonArt = new Graphics()
  private summonSprite = new Sprite()
  private summonTextures: Texture[] = []
  private guardianMotionTextures: Partial<Record<GuardianMotion, Texture[]>> = {}

  private player = new Container()
  private playerArt = new Graphics()
  private playerGhostSprite = new Sprite()
  private playerSprite = new Sprite()
  private playerTextures: Texture[] = []
  private playerMotionTextures: Partial<Record<PlayerMotion, Texture[]>> = {}
  private playerTextureKey = ''
  private frameBlend = 1

  private backgroundTexture?: Texture
  private backgroundSprites: Sprite[] = []
  private domainTextures: Partial<Record<DomainTextureKey, Texture>> = {}

  private entities: GameEntity[] = []
  private particles: Particle[] = []
  private entityId = 1
  private rngState = 1

  private distance = 0
  private coins = 0
  private elapsedMs = 0
  private peakSpeed = 0

  private playerSide: WallSide = 'left'
  private playerAttached = true
  private playerX = 0
  private playerVX = 0
  private playerStartX = 0
  private playerTargetX = 0
  private playerHopT = 0
  private playerHopDuration = HOP_DURATION_BASE
  private playerFacing = 1
  private inputLockMs = 0
  private playerLaunchSide: WallSide = 'left'
  private wallContactFlash = 0

  private hopsThisRun = 0
  private aura = 0
  private auraLevel = 0
  private shieldTimer = 0
  private shieldCharges = 0
  private slashTimer = 0
  private beastTimer = 0
  private beastVisualTimer = 0
  private beastAttackX = 0
  private beastAttackY = 0
  private guardianStrikeClock = 0
  private speedKick = 0
  private introTimer = 0
  private portalFlash = 0
  private shake = 0

  private bestDistance = 0
  private lastStatsAt = 0
  private trailClock = 0
  private footstepClock = 0
  private nextSpawnAtScreenY = -160
  private nextPortalDistance = 800
  private nextOrbDistance = 360
  private nextMiniBossDistance = 640
  private nextCoinDistance = 240
  private nextGateDistance = 720

  private destroyed = false
  private firstInputSent = false
  private initialized = false
  private assetsReady = false
  private queuedStart = false

  constructor(host: HTMLElement, callbacks: GameCallbacks = {}, bestDistance = 0) {
    this.host = host
    this.callbacks = callbacks
    this.bestDistance = bestDistance
  }

  async init() {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    })
    if (this.destroyed) {
      this.app.destroy(true)
      return
    }

    this.app.canvas.className = 'game-canvas'
    this.host.appendChild(this.app.canvas)
    this.app.stage.addChild(
      this.backgroundArtLayer,
      this.background,
      this.wallLayer,
      this.pickupLayer,
      this.hazardLayer,
      this.particleLayer,
      this.guardianLayer,
      this.player,
    )
    this.guardianLayer.visible = false
    this.summonSprite.visible = false
    this.guardianLayer.addChild(this.summonArt, this.summonSprite)
    this.playerSprite.visible = false
    this.playerGhostSprite.visible = false
    this.player.addChild(this.playerArt, this.playerGhostSprite, this.playerSprite)
    this.app.ticker.add(this.tick)
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('keydown', this.handleKeyDown)
    this.initialized = true
    await Promise.all([this.loadDomainArt(), this.loadPlayerSprites()])
    if (this.destroyed) return
    this.assetsReady = true
    this.resetRun(false)
    this.emitStats(true)
    if (this.queuedStart) {
      this.queuedStart = false
      this.handlePrimaryAction()
    }
  }

  destroy() {
    this.destroyed = true
    window.removeEventListener('keydown', this.handleKeyDown)
    if (this.initialized) {
      this.app.canvas.removeEventListener('pointerdown', this.handlePointerDown)
      this.app.ticker.remove(this.tick)
      this.app.destroy(true)
      this.initialized = false
    }
  }

  setBestDistance(bestDistance: number) {
    this.bestDistance = bestDistance
  }

  restart() {
    this.resetRun(true)
  }

  jump() {
    this.handlePrimaryAction()
  }

  summon() {
    if (this.phase !== 'running') return
    if (this.beastTimer > 0 || this.slashTimer > 0 || this.shieldTimer > 0) return

    if (this.aura >= AURA_MAX) {
      this.aura = 0
      this.auraLevel = 0
      this.beastTimer = BEAST_SECONDS
      this.shieldTimer = 0
      this.shieldCharges = 0
      this.slashTimer = 0
      this.beastVisualTimer = 0
      this.guardianStrikeClock = 0
      this.speedKick = Math.min(0.5, this.speedKick + 0.2)
      this.shake = 0.9
      this.callbacks.onSummon?.()
      const layout = this.layout()
      const pos = this.playerPosition(layout)
      this.spawnBurst(pos.x, pos.y - 20, GAME_COLORS.rankViolet, 22, 1.1)
      this.spawnBurst(pos.x, pos.y - 20, GAME_COLORS.gateBlue, 14, 0.9)
      this.spawnGuardianRift(pos.x, pos.y)
      this.emitStats(true)
      return
    }

    if (this.aura >= AURA_TIER_2) {
      this.aura = Math.max(0, this.aura - AURA_TIER_2)
      this.auraLevel = this.auraTier()
      this.slashTimer = SLASH_SECONDS
      this.speedKick = Math.min(0.42, this.speedKick + 0.12)
      this.callbacks.onStrike?.()
      const layout = this.layout()
      const pos = this.playerPosition(layout)
      this.spawnSlash(pos.x, pos.y - 16, GAME_COLORS.gateBlue, 0.72)
      this.spawnBurst(pos.x, pos.y - 6, GAME_COLORS.rankViolet, 10, 0.7)
      this.emitStats(true)
      return
    }

    if (this.aura >= AURA_TIER_1) {
      this.aura = Math.max(0, this.aura - SLASH_COST)
      this.auraLevel = this.auraTier()
      this.shieldTimer = SHIELD_SECONDS
      this.shieldCharges = 1
      this.speedKick = Math.min(0.35, this.speedKick + 0.08)
      const layout = this.layout()
      const pos = this.playerPosition(layout)
      this.spawnBurst(pos.x, pos.y - 8, GAME_COLORS.gateBlue, 8, 0.55)
      this.emitStats(true)
    }
  }

  private async loadPlayerSprites() {
    try {
      const loaded = await Promise.all(
        PLAYER_MOTIONS.map(async (motion) => {
          const textures = await Promise.all(
            Array.from({ length: PLAYER_MOTION_COUNTS[motion] }, (_, index) =>
              Assets.load(motionPath('hunter', motion, index)) as Promise<Texture>,
            ),
          )
          return { motion, textures }
        }),
      )
      if (this.destroyed) return
      const groups: Partial<Record<PlayerMotion, Texture[]>> = {}
      loaded.forEach(({ motion, textures }) => {
        groups[motion] = textures
      })
      this.playerMotionTextures = groups
      this.playerTextures = loaded.flatMap(({ textures }) => textures)
      const first = groups.idle?.[0] ?? this.playerTextures[0]
      if (first) {
        this.playerSprite.texture = first
        this.playerGhostSprite.texture = first
        this.playerSprite.anchor.set(0.5, 0.78)
        this.playerGhostSprite.anchor.set(0.5, 0.78)
        this.playerSprite.visible = true
      }
    } catch {
      this.playerMotionTextures = {}
      this.playerTextures = []
      this.playerSprite.visible = false
    }
  }

  private async loadDomainArt() {
    try {
      const [background, coin, spike, orb, block, portal, crawler, wraith, slash] = await Promise.all([
        Assets.load('/assets/backgrounds/aura-domain.webp') as Promise<Texture>,
        Assets.load('/assets/domain/sigil-coin.png') as Promise<Texture>,
        Assets.load('/assets/domain/crystal-spike.png') as Promise<Texture>,
        Assets.load('/assets/domain/eye-orb.png') as Promise<Texture>,
        Assets.load('/assets/domain/rune-block.png') as Promise<Texture>,
        Assets.load('/assets/domain/portal-mystic.webp') as Promise<Texture>,
        Assets.load('/assets/domain/crawler.png') as Promise<Texture>,
        Assets.load('/assets/domain/wraith.png') as Promise<Texture>,
        Assets.load('/assets/domain/slash.png') as Promise<Texture>,
      ])
      if (this.destroyed) return
      this.backgroundTexture = background
      this.backgroundSprites = [new Sprite(background), new Sprite(background), new Sprite(background)]
      for (const sprite of this.backgroundSprites) {
        sprite.alpha = 0.78
        this.backgroundArtLayer.addChild(sprite)
      }
      this.domainTextures = { coin, spike, orb, block, portal, crawler, wraith, slash }
    } catch {
      this.backgroundTexture = undefined
      this.domainTextures = {}
    }

    try {
      const loaded = await Promise.all(
        GUARDIAN_MOTIONS.map(async (motion) => {
          const textures = await Promise.all(
            Array.from({ length: GUARDIAN_MOTION_COUNTS[motion] }, (_, index) =>
              Assets.load(motionPath('summon', motion, index)) as Promise<Texture>,
            ),
          )
          return { motion, textures }
        }),
      )
      if (this.destroyed) return
      const groups: Partial<Record<GuardianMotion, Texture[]>> = {}
      loaded.forEach(({ motion, textures }) => {
        groups[motion] = textures
      })
      this.guardianMotionTextures = groups
      this.summonTextures = loaded.flatMap(({ textures }) => textures)
      if (this.summonTextures[0]) {
        this.summonSprite.texture = groups.guard?.[0] ?? this.summonTextures[0]
        this.summonSprite.anchor.set(0.5, 0.66)
      }
    } catch {
      this.guardianMotionTextures = {}
      this.summonTextures = []
    }
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    this.handlePrimaryAction()
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'Enter') {
      event.preventDefault()
      this.handlePrimaryAction()
    } else if (event.code === 'KeyZ' || event.code === 'KeyX') {
      event.preventDefault()
      this.summon()
    }
  }

  private handlePrimaryAction() {
    if (!this.assetsReady) {
      this.queuedStart = true
      return
    }

    if (!this.firstInputSent) {
      this.firstInputSent = true
      this.callbacks.onFirstInput?.()
    }
    if (this.phase !== 'running') {
      this.resetRun(true)
      this.inputLockMs = 180
      return
    }
    if (this.inputLockMs > 0) return
    this.switchGravity()
  }

  private switchGravity() {
    const layout = this.layout()
    const launch = this.visualWallSide()
    const target: WallSide = this.playerSide === 'left' ? 'right' : 'left'
    const targetX = target === 'left' ? layout.leftWallInner + PLAYER_INSET : layout.rightWallInner - PLAYER_INSET
    const sign = target === 'right' ? 1 : -1

    this.playerAttached = false
    this.playerLaunchSide = launch
    this.playerHopT = 0
    this.playerHopDuration = HOP_DURATION_BASE
    this.playerStartX = this.playerX
    this.playerTargetX = targetX
    if (Math.sign(this.playerVX) !== sign) this.playerVX *= 0.22
    this.playerVX = clamp(this.playerVX + sign * 360, -880, 880)
    this.playerFacing = sign
    this.playerSide = target
    this.wallContactFlash = 0.9
    this.inputLockMs = 42
    this.hopsThisRun += 1
    this.speedKick = Math.min(0.55, this.speedKick + 0.055)
    this.callbacks.onJump?.(0.5 + Math.min(0.35, Math.abs(this.playerVX) / 1900))
    const pos = this.playerPosition(layout)
    this.spawnSlash(pos.x + sign * 12, pos.y - 12, GAME_COLORS.gateBlue, 0.44)
    this.spawnBurst(pos.x - sign * 8, pos.y + 6, GAME_COLORS.rankViolet, 6, 0.58)
  }

  private resetRun(startRunning: boolean) {
    const layout = this.layout()
    this.phase = startRunning ? 'running' : 'idle'
    this.callbacks.onPhaseChange?.(this.phase)

    this.entities.forEach((entity) => this.destroyEntity(entity))
    this.particles.forEach((particle) => particle.graphic.destroy())
    this.entities = []
    this.particles = []
    this.hazardLayer.removeChildren()
    this.pickupLayer.removeChildren()
    this.particleLayer.removeChildren()

    this.rngState = (Date.now() ^ Math.floor(Math.random() * 999999)) >>> 0
    this.distance = 0
    this.coins = 0
    this.elapsedMs = 0
    this.peakSpeed = 0
    this.hopsThisRun = 0

    this.playerSide = 'left'
    this.playerAttached = true
    this.playerX = layout.leftWallInner + PLAYER_INSET
    this.playerVX = 0
    this.playerStartX = this.playerX
    this.playerTargetX = this.playerX
    this.playerHopT = 0
    this.playerFacing = 1
    this.inputLockMs = 0
    this.playerLaunchSide = 'left'
    this.wallContactFlash = 0

    this.aura = 0
    this.auraLevel = 0
    this.shieldTimer = 0
    this.shieldCharges = 0
    this.slashTimer = 0
    this.beastTimer = 0
    this.beastVisualTimer = 0
    this.beastAttackX = this.playerX
    this.beastAttackY = layout.playerScreenY
    this.guardianStrikeClock = 0
    this.speedKick = startRunning ? 0.15 : 0
    this.introTimer = startRunning ? INTRO_SECONDS : 0
    this.portalFlash = 0
    this.shake = 0
    this.lastStatsAt = 0
    this.trailClock = 0
    this.footstepClock = 0

    this.playerTextureKey = ''
    this.frameBlend = 1
    this.guardianLayer.visible = false
    this.summonArt.clear()

    this.nextSpawnAtScreenY = -200
    this.nextPortalDistance = 3000 + this.random() * 1400
    this.nextOrbDistance = 820 + this.random() * 360
    this.nextMiniBossDistance = 500 + this.random() * 260
    this.nextCoinDistance = 360 + this.random() * 180
    this.nextGateDistance = 620 + this.random() * 260
    this.spawnOpening(layout)
    this.emitStats(true)
  }

  private tick = (ticker: Ticker) => {
    if (this.destroyed) return
    const dt = Math.min(0.034, ticker.deltaMS / 1000)
    this.update(dt)
    this.render()
  }

  private update(dt: number) {
    const layout = this.layout()
    this.elapsedMs += dt * (this.phase === 'running' ? 1000 : 480)
    this.inputLockMs = Math.max(0, this.inputLockMs - dt * 1000)
    this.wallContactFlash = Math.max(0, this.wallContactFlash - dt * 7)
    this.shieldTimer = Math.max(0, this.shieldTimer - dt)
    if (this.shieldTimer <= 0) this.shieldCharges = 0
    this.slashTimer = Math.max(0, this.slashTimer - dt)
    this.beastTimer = Math.max(0, this.beastTimer - dt)
    this.beastVisualTimer = Math.max(0, this.beastVisualTimer - dt)
    this.portalFlash = Math.max(0, this.portalFlash - dt * 1.7)
    this.shake = Math.max(0, this.shake - dt * 9)
    this.speedKick = Math.max(0, this.speedKick - dt * 0.42)

    if (this.phase === 'running') {
      this.introTimer = Math.max(0, this.introTimer - dt)
      const speed = this.currentSpeed()
      this.distance += speed * dt
      this.peakSpeed = Math.max(this.peakSpeed, speed)

      if (this.shieldTimer <= 0 && this.slashTimer <= 0 && this.beastTimer <= 0) {
        this.aura = Math.min(AURA_MAX, this.aura + AURA_FILL_PER_SEC * dt)
        this.auraLevel = this.auraTier()
      }

      this.updatePlayer(dt, layout)
      this.scrollEntities(dt, speed, layout)
      this.spawnAhead(layout)
      if (this.beastTimer > 0) {
        this.guardianStrikeClock += dt
        if (this.guardianStrikeClock > 0.32) {
          this.guardianStrikeClock = 0
          this.guardianSweep(layout)
        }
      }
      this.checkCollisions(layout)
      this.spawnSpeedTrail(dt, layout)
      this.emitStats()
    }

    this.updateParticles(dt)
  }

  private updatePlayer(dt: number, layout: VerticalLayout) {
    const leftX = layout.leftWallInner + PLAYER_INSET
    const rightX = layout.rightWallInner - PLAYER_INSET
    const targetX = this.playerSide === 'left' ? leftX : rightX

    if (this.playerAttached) {
      this.playerX += (targetX - this.playerX) * Math.min(1, dt * 22)
      this.playerFacing = this.playerSide === 'left' ? 1 : -1
      this.spawnWallRunFootstep(dt, layout)
      return
    }

    this.playerHopT += dt
    const dir = targetX >= this.playerX ? 1 : -1
    const gravity = 4300
    const airDrag = Math.pow(0.86, dt * 60)
    this.playerVX = clamp((this.playerVX + dir * gravity * dt) * airDrag, -940, 940)
    const nextX = clamp(this.playerX + this.playerVX * dt, leftX, rightX)
    const reachedWall = dir > 0 ? nextX >= targetX - 1 : nextX <= targetX + 1
    this.playerX = reachedWall ? targetX : nextX

    if (reachedWall) {
      this.playerX = targetX
      this.playerTargetX = targetX
      this.playerVX = 0
      this.playerAttached = true
      this.playerHopT = 0
      this.wallContactFlash = 1
      this.spawnBurst(this.playerX, layout.playerScreenY + 4, GAME_COLORS.gateBlue, 7, 0.6)
      this.shake = Math.max(this.shake, 0.4)
    }
  }

  private scrollEntities(dt: number, speed: number, layout: VerticalLayout) {
    const drop = speed * dt
    for (let i = this.entities.length - 1; i >= 0; i -= 1) {
      const entity = this.entities[i]
      entity.screenY += drop
      if (entity.killed) {
        entity.killFx += dt
        if (entity.killFx > 0.32) {
          this.destroyEntity(entity)
          this.entities.splice(i, 1)
          continue
        }
      }
      if (entity.kind === 'air-bird') {
        entity.screenX += entity.velocityX * dt
        const halfThickness = layout.wallThickness * 0.5
        if (entity.screenX < layout.leftWallInner - halfThickness - 60) {
          this.destroyEntity(entity)
          this.entities.splice(i, 1)
          continue
        }
        if (entity.screenX > layout.rightWallInner + halfThickness + 60) {
          this.destroyEntity(entity)
          this.entities.splice(i, 1)
          continue
        }
      }
      if (entity.kind === 'mini-boss') {
        entity.screenX += entity.velocityX * dt
        const minX = layout.leftWallInner + 40
        const maxX = layout.rightWallInner - 40
        if (entity.screenX < minX) {
          entity.screenX = minX
          entity.velocityX = Math.abs(entity.velocityX)
          entity.side = 'left'
        } else if (entity.screenX > maxX) {
          entity.screenX = maxX
          entity.velocityX = -Math.abs(entity.velocityX)
          entity.side = 'right'
        }
      }
      if (entity.screenY > layout.height + 120) {
        this.destroyEntity(entity)
        this.entities.splice(i, 1)
      }
    }
  }

  private spawnAhead(layout: VerticalLayout) {
    while (this.nextSpawnAtScreenY < -40) {
      const baseY = this.nextSpawnAtScreenY
      this.scheduleSpawn(baseY, layout)
      const difficulty = Math.min(1, this.distance / 5600)
      const gap = 205 - difficulty * 90 + this.random() * (78 - difficulty * 30)
      this.nextSpawnAtScreenY += gap
    }

    if (this.distance >= this.nextOrbDistance) {
      this.addEntity('aura-orb', this.pickSide(), layout, -60, 20, 20, 12)
      this.nextOrbDistance = this.distance + 900 + this.random() * 620
    }

    if (this.distance >= this.nextMiniBossDistance) {
      this.spawnMiniBoss(layout, -140)
      this.nextMiniBossDistance = this.distance + 620 + this.random() * 460
    }

    if (this.distance >= this.nextPortalDistance) {
      this.spawnPortal(layout)
      this.nextPortalDistance = this.distance + 3600 + this.random() * 1900
    }

    if (this.distance >= this.nextGateDistance) {
      this.spawnSwitchGate(layout, -150)
      this.nextGateDistance = this.distance + 560 + this.random() * 420
    }
  }

  private scheduleSpawn(screenY: number, layout: VerticalLayout) {
    const difficulty = Math.min(1, this.distance / 5600)
    const r = this.random()
    if (this.distance < 300) {
      if (r < 0.18 && this.distance >= this.nextCoinDistance) {
        this.addCoinTrail(layout, screenY, this.pickSide())
        this.nextCoinDistance = this.distance + 260 + this.random() * 220
      } else {
        const kind: EntityKind = r > 0.72 ? 'wall-flame' : 'wall-spike'
        this.addEntity(kind, this.pickSide(), layout, screenY, kind === 'wall-flame' ? 28 : 42, kind === 'wall-flame' ? 42 : 38, kind === 'wall-flame' ? 15 : 18)
      }
      return
    }

    if (r < 0.18) {
      this.addEntity('wall-spike', this.pickSide(), layout, screenY, 42, 38, 18)
    } else if (r < 0.32) {
      this.addEntity('wall-flame', this.pickSide(), layout, screenY, 28, 42, 15)
    } else if (r < 0.46) {
      this.addEntity('wall-trap', this.pickSide(), layout, screenY, 44, 42, 19)
    } else if (r < 0.58) {
      this.addEntity('wall-mob', this.pickSide(), layout, screenY, 50, 54, 22)
    } else if (r < 0.72) {
      this.spawnAirBird(layout, screenY)
    } else if (r < 0.84) {
      this.addEntity('gate-spear', this.pickSide(), layout, screenY, 74 + difficulty * 14, 24, 20)
    } else if (r < 0.9 && this.distance >= this.nextCoinDistance) {
      this.addCoinTrail(layout, screenY, this.pickSide())
      this.nextCoinDistance = this.distance + 360 + this.random() * 460
    } else {
      if (this.distance > 900 && this.random() > 0.68) this.spawnMiniBoss(layout, screenY)
      else this.spawnSwitchGate(layout, screenY)
    }
  }

  private spawnAirBird(layout: VerticalLayout, screenY: number) {
    const fromLeft = this.random() < 0.5
    const startX = fromLeft ? layout.leftWallInner - 40 : layout.rightWallInner + 40
    const speed = 210 + this.random() * 110
    const entity = this.addEntity('air-bird', fromLeft ? 'left' : 'right', layout, screenY, 36, 30, 16)
    entity.screenX = startX
    entity.velocityX = fromLeft ? speed : -speed
  }

  private spawnSwitchGate(layout: VerticalLayout, screenY: number) {
    const difficulty = Math.min(1, this.distance / 5600)
    const side = this.pickSide()
    const opposite: WallSide = side === 'left' ? 'right' : 'left'
    const spearWidth = 76 + difficulty * 18
    const paired = this.random() < 0.52 + difficulty * 0.22

    if (paired) {
      this.addEntity('gate-spear', 'left', layout, screenY, spearWidth, 24, 20)
      this.addEntity('gate-spear', 'right', layout, screenY + this.random() * 18 - 9, spearWidth, 24, 20)
      if (difficulty > 0.35 && this.random() > 0.46) {
        const staggerSide = this.random() > 0.5 ? 'left' : 'right'
        this.addEntity('wall-flame', staggerSide, layout, screenY - 118 - this.random() * 42, 28, 42, 15)
      }
      return
    }

    this.addEntity('gate-spear', side, layout, screenY, spearWidth, 24, 20)
    this.addEntity(this.random() > 0.5 ? 'wall-flame' : 'wall-spike', side, layout, screenY - 108 - this.random() * 38, 34, 38, 17)
    if (difficulty > 0.28) {
      this.addEntity('wall-trap', opposite, layout, screenY - 186 - this.random() * 56, 42, 40, 18)
    }
  }

  private addCoinTrail(layout: VerticalLayout, screenY: number, side: WallSide) {
    const roll = this.random()
    const pattern: CoinPattern = this.distance < 520
      ? roll < 0.64
        ? 'wall-sparks'
        : 'switch-breadcrumbs'
      : roll < 0.42
        ? 'wall-sparks'
        : roll < 0.76
          ? 'switch-breadcrumbs'
          : 'risk-pair'
    this.addCoinPattern(layout, screenY, side, pattern)
  }

  private addCoinPattern(layout: VerticalLayout, screenY: number, side: WallSide, pattern: CoinPattern) {
    const safeLeft = layout.leftWallInner + 38
    const safeRight = layout.rightWallInner - 38
    const laneWidth = safeRight - safeLeft
    const sideX = side === 'left' ? safeLeft : safeRight
    const oppositeX = side === 'left' ? safeRight : safeLeft
    const oppositeSide: WallSide = side === 'left' ? 'right' : 'left'
    const inward = side === 'left' ? 1 : -1
    const jitter = (amount: number) => (this.random() - 0.5) * amount

    if (pattern === 'wall-sparks') {
      const count = 2 + Math.floor(this.random() * 3)
      let y = screenY
      for (let i = 0; i < count; i += 1) {
        const x = sideX + inward * (10 + this.random() * 28)
        this.addCoinAt(layout, x + jitter(5), y + jitter(14), side)
        y -= 58 + this.random() * 44
      }
      return
    }

    if (pattern === 'switch-breadcrumbs') {
      const count = 3 + Math.floor(this.random() * 2)
      const travel = 180 + this.random() * 80
      for (let i = 0; i < count; i += 1) {
        const t = clamp(i / Math.max(1, count - 1) + jitter(0.08), 0, 1)
        const eased = smoothStep(t)
        const arc = Math.sin(t * Math.PI)
        const x = lerp(sideX, oppositeX, eased) + arc * inward * (8 + this.random() * 24) + jitter(12)
        const y = screenY - t * travel + arc * (8 + this.random() * 18) + jitter(16)
        this.addCoinAt(layout, x, y, t < 0.52 ? side : oppositeSide)
      }
      return
    }

    if (pattern === 'risk-pair') {
      const count = this.random() > 0.72 ? 3 : 2
      const bias = this.random() > 0.5 ? 1 : -1
      for (let i = 0; i < count; i += 1) {
        const x = layout.laneCenter + bias * laneWidth * (0.1 + this.random() * 0.18) + jitter(10)
        const y = screenY - i * (66 + this.random() * 34) + jitter(20)
        this.addCoinAt(layout, x, y, x < layout.laneCenter ? 'left' : 'right')
      }
      return
    }

    if (pattern === 'portal-spark') {
      const offsets = [
        [jitter(20), -94 - this.random() * 20],
        [inward * (36 + this.random() * 26), -22 + jitter(18)],
        [-inward * (34 + this.random() * 24), 68 + jitter(20)],
      ]
      for (const [dx, dy] of offsets) {
        this.addCoinAt(layout, layout.laneCenter + dx, screenY + dy, dx < 0 ? 'left' : 'right')
      }
      return
    }

    const count = 2 + Math.floor(this.random() * 2)
    const cx = side === 'left' ? layout.leftWallInner + 74 : layout.rightWallInner - 74
    for (let i = 0; i < count; i += 1) {
      const x = cx + inward * (i * 24 + this.random() * 18) + jitter(10)
      const y = screenY + 26 - i * (48 + this.random() * 24) + jitter(12)
      this.addCoinAt(layout, x, y, x < layout.laneCenter ? 'left' : 'right')
    }
  }

  private addCoinAt(layout: VerticalLayout, x: number, y: number, side: WallSide) {
    const size = 18 + this.random() * 5
    const coin = this.addEntity('coin', side, layout, y, size, size, Math.max(9, size * 0.46))
    coin.screenX = clamp(x, layout.leftWallInner + 34, layout.rightWallInner - 34)
    coin.wobble += Math.abs(x - layout.laneCenter) * 0.015 + this.random() * 2.2
    coin.spin *= 0.65 + this.random() * 0.9
    coin.container.alpha = 0.9 + this.random() * 0.1
    return coin
  }

  private spawnPortal(layout: VerticalLayout) {
    const entity = this.addEntity('portal', 'left', layout, -220, 44, 66, 24)
    entity.screenX = layout.laneCenter
    if (this.random() > 0.25) this.addCoinPattern(layout, entity.screenY, 'left', 'portal-spark')
  }

  private spawnMiniBoss(layout: VerticalLayout, screenY: number, forceCenter = false) {
    if (this.entities.some((entity) => entity.kind === 'mini-boss' && !entity.killed && entity.screenY > -220 && entity.screenY < layout.height + 80)) return

    const fromLeft = this.random() < 0.5
    const side: WallSide = fromLeft ? 'left' : 'right'
    const entity = this.addEntity('mini-boss', side, layout, screenY, 42, 52, 20)
    const laneWidth = layout.rightWallInner - layout.leftWallInner
    entity.screenX = forceCenter
      ? layout.laneCenter + (fromLeft ? -laneWidth * 0.18 : laneWidth * 0.18)
      : fromLeft
        ? layout.leftWallInner + 38
        : layout.rightWallInner - 38
    entity.velocityX = fromLeft ? 72 + this.random() * 40 : -72 - this.random() * 40
    if (this.random() > 0.45) this.addCoinPattern(layout, screenY, side, 'boss-prize')
  }

  private pickSide(): WallSide {
    return this.random() < 0.5 ? 'left' : 'right'
  }

  private spawnOpening(layout: VerticalLayout) {
    this.addCoinPattern(layout, -150, 'left', 'wall-sparks')
    this.addCoinPattern(layout, -420, 'right', 'switch-breadcrumbs')
    this.addEntity('aura-orb', this.pickSide(), layout, -610, 20, 20, 12)
  }

  private addEntity(
    kind: EntityKind,
    side: WallSide,
    layout: VerticalLayout,
    screenY: number,
    width: number,
    height: number,
    radius: number,
  ): GameEntity {
    const textureKey = this.textureKeyFor(kind)
    const { container, graphic, sprite } = this.createEntityGraphic(kind, width, height, textureKey)

    const screenX =
      kind === 'portal'
        ? layout.laneCenter
        : kind === 'air-bird'
          ? layout.laneCenter
          : kind === 'gate-spear'
            ? side === 'left'
              ? layout.leftWallInner + width * 0.42
              : layout.rightWallInner - width * 0.42
          : kind === 'aura-orb' || kind === 'coin'
            ? side === 'left'
              ? layout.leftWallInner + 56
              : layout.rightWallInner - 56
            : side === 'left'
              ? layout.leftWallInner + WALL_INSET_PX
              : layout.rightWallInner - WALL_INSET_PX

    const value = kind === 'coin' ? 1 : kind === 'aura-orb' ? AURA_ORB_FILL : 0

    const entity: GameEntity = {
      id: this.entityId++,
      kind,
      textureKey,
      side,
      screenX,
      screenY,
      width,
      height,
      radius,
      value,
      velocityX: 0,
      killed: false,
      killFx: 0,
      spin: (this.random() > 0.5 ? 1 : -1) * (1.8 + this.random() * 2.2),
      wobble: this.random() * Math.PI * 2,
      container,
      graphic,
      sprite,
    }

    if (kind === 'coin' || kind === 'aura-orb' || kind === 'portal') {
      this.pickupLayer.addChild(container)
    } else {
      this.hazardLayer.addChild(container)
    }
    this.entities.push(entity)
    return entity
  }

  private textureKeyFor(kind: EntityKind): DomainTextureKey | undefined {
    if (kind === 'coin') return 'coin'
    if (kind === 'wall-spike') return 'spike'
    if (kind === 'wall-trap') return 'spike'
    if (kind === 'wall-flame') return undefined
    if (kind === 'gate-spear') return undefined
    if (kind === 'wall-mob') return this.random() > 0.5 ? 'wraith' : 'crawler'
    if (kind === 'air-bird') return 'orb'
    if (kind === 'mini-boss') return 'wraith'
    if (kind === 'aura-orb') return 'orb'
    if (kind === 'portal') return 'portal'
    return undefined
  }

  private createEntityGraphic(kind: EntityKind, width: number, height: number, textureKey?: DomainTextureKey) {
    const container = new Container()
    const g = new Graphics()
    const sprite = this.createEntitySprite(kind, width, height, textureKey)
    if (sprite) container.addChild(sprite)
    container.addChild(g)

    if (kind === 'coin') {
      g.circle(0, 0, 13).stroke({ color: GAME_COLORS.amber, alpha: sprite ? 0.38 : 0.72, width: 1.2 })
      g.poly([0, -11, 11, 0, 0, 11, -11, 0], true).fill({ color: GAME_COLORS.amber, alpha: sprite ? 0.14 : 1 })
      g.poly([0, -5, 5, 0, 0, 5, -5, 0], true).stroke({ color: GAME_COLORS.white, alpha: 0.86, width: 1.1 })
      g.moveTo(-7, -9).lineTo(-2, -13).lineTo(3, -10).stroke({ color: GAME_COLORS.white, alpha: 0.58, width: 1 })
    } else if (kind === 'wall-spike') {
      g.poly([-22, 18, -10, -18, 0, 14, 11, -20, 23, 18], true).fill({ color: GAME_COLORS.coral, alpha: sprite ? 0.18 : 0.96 })
      g.poly([-22, 18, -10, -18, 0, 14, 11, -20, 23, 18], true).stroke({ color: GAME_COLORS.white, alpha: 0.72, width: 1.2 })
    } else if (kind === 'wall-trap') {
      const side = width * 0.5
      g.poly([-side, -22, 0, -6, side, -22, 20, 8, 0, 26, -20, 8], true).fill({ color: GAME_COLORS.coral, alpha: sprite ? 0.16 : 0.9 })
      g.poly([-side, -22, 0, -6, side, -22, 20, 8, 0, 26, -20, 8], true).stroke({ color: GAME_COLORS.magenta, alpha: 0.8, width: 1.5 })
      g.rect(-side * 0.62, 16, side * 1.24, 3).fill({ color: GAME_COLORS.gateBlue, alpha: 0.46 })
    } else if (kind === 'wall-flame') {
      this.drawWallFlameGlyph(g, 0, 4, 1, 0.95, 0.76)
    } else if (kind === 'gate-spear') {
      const dir = 1
      const base = -width * 0.44
      const tip = width * 0.5
      g.poly([base, -8, tip, 0, base, 8, base + 13, 0], true).fill({ color: GAME_COLORS.gateBlue, alpha: 0.82 })
      g.poly([base + 8, -12, tip - 16, 0, base + 8, 12, base + 24, 0], true).stroke({ color: GAME_COLORS.white, alpha: 0.66, width: 1.1 })
      g.rect(base - 5 * dir, -15, 12, 30).fill({ color: GAME_COLORS.deepPurple, alpha: 0.86 })
      g.rect(base - 2 * dir, -19, 4, 38).fill({ color: GAME_COLORS.magenta, alpha: 0.5 })
      g.circle(base + 10, 0, 5).fill({ color: GAME_COLORS.white, alpha: 0.46 })
    } else if (kind === 'wall-mob') {
      g.ellipse(0, height * 0.45, width * 0.35, 6).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
      g.moveTo(-width * 0.28, -height * 0.16).lineTo(-width * 0.5, height * 0.08).stroke({ color: GAME_COLORS.magenta, alpha: 0.46, width: 1.4 })
      g.moveTo(width * 0.2, -height * 0.12).lineTo(width * 0.48, height * 0.16).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.42, width: 1.2 })
      g.circle(width * 0.08, -height * 0.24, 3.2).fill({ color: GAME_COLORS.white, alpha: 0.85 })
      g.circle(width * 0.2, -height * 0.2, 2.6).fill({ color: GAME_COLORS.gateBlue, alpha: 0.75 })
    } else if (kind === 'mini-boss') {
      g.ellipse(0, height * 0.42, width * 0.38, 7).fill({ color: GAME_COLORS.shadow, alpha: 0.46 })
      g.circle(0, -height * 0.22, width * 0.34).stroke({ color: GAME_COLORS.magenta, alpha: 0.72, width: 2 })
      g.poly([-18, -height * 0.45, 0, -height * 0.62, 18, -height * 0.45, 10, -height * 0.38, 0, -height * 0.48, -10, -height * 0.38], true).fill({
        color: GAME_COLORS.rankViolet,
        alpha: 0.72,
      })
      g.moveTo(-34, -height * 0.1).lineTo(34, -height * 0.22).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.72, width: 2 })
      g.moveTo(-width * 0.44, height * 0.06).lineTo(-width * 0.18, -height * 0.06).lineTo(width * 0.14, height * 0.04).lineTo(width * 0.46, -height * 0.12).stroke({
        color: GAME_COLORS.white,
        alpha: 0.38,
        width: 1.2,
      })
    } else if (kind === 'air-bird') {
      if (!sprite) {
        g.poly([-18, 0, -2, -10, 12, -2, 18, 8, 0, 12, -14, 8], true).fill({ color: GAME_COLORS.rankViolet, alpha: 0.9 })
        g.circle(6, -3, 3).fill({ color: GAME_COLORS.white, alpha: 0.85 })
      }
    } else if (kind === 'aura-orb') {
      g.circle(0, 0, 16).stroke({ color: GAME_COLORS.magenta, alpha: 0.95, width: 2 })
      g.circle(0, 0, 10).fill({ color: GAME_COLORS.rankViolet, alpha: 0.7 })
      g.circle(0, 0, 4).fill({ color: GAME_COLORS.white, alpha: 0.9 })
    } else if (kind === 'portal') {
      this.drawPortalRunes(g, width, height)
    }
    return { container, graphic: g, sprite }
  }

  private drawPortalRunes(g: Graphics, width: number, height: number) {
    const halfW = width * 0.5
    const halfH = height * 0.5
    g.ellipse(0, 0, halfW * 1.04, halfH).stroke({ color: GAME_COLORS.magenta, alpha: 0.44, width: 2.4 })
    g.ellipse(0, 0, halfW * 0.76, halfH * 0.84).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.38, width: 1.5 })
    g.ellipse(0, 0, halfW * 0.48, halfH * 0.62).stroke({ color: GAME_COLORS.white, alpha: 0.18, width: 1 })

    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2
      const x = Math.cos(angle) * halfW * 0.92
      const y = Math.sin(angle) * halfH * 0.92
      const size = i % 3 === 0 ? 6 : 4
      g.poly([x, y - size, x + size, y, x, y + size, x - size, y], true).fill({
        color: i % 2 === 0 ? GAME_COLORS.gateBlue : GAME_COLORS.magenta,
        alpha: 0.46,
      })
    }

    for (let i = 0; i < 5; i += 1) {
      const side = i % 2 === 0 ? -1 : 1
      const y = -halfH * 0.56 + i * halfH * 0.28
      const x = side * (halfW + 8 + i * 2)
      g.poly([x, y - 14, x + side * 20, y - 4, x + side * 14, y + 14, x - side * 4, y + 3], true).stroke({
        color: i % 2 === 0 ? GAME_COLORS.magenta : GAME_COLORS.gateBlue,
        alpha: 0.38,
        width: 1.2,
      })
    }

    g.moveTo(-halfW * 0.24, -halfH * 0.52).lineTo(halfW * 0.28, -halfH * 0.18).lineTo(-halfW * 0.18, halfH * 0.16).lineTo(halfW * 0.26, halfH * 0.52).stroke({
      color: GAME_COLORS.gateBlue,
      alpha: 0.28,
      width: 1.4,
    })
    g.moveTo(halfW * 0.18, -halfH * 0.58).lineTo(-halfW * 0.28, -halfH * 0.2).lineTo(halfW * 0.16, halfH * 0.14).lineTo(-halfW * 0.22, halfH * 0.56).stroke({
      color: GAME_COLORS.magenta,
      alpha: 0.26,
      width: 1.2,
    })
  }

  private createEntitySprite(kind: EntityKind, width: number, height: number, textureKey?: DomainTextureKey) {
    if (!textureKey) return undefined
    const texture = this.domainTextures[textureKey]
    if (!texture) return undefined
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    if (kind === 'wall-spike') {
      const scale = Math.max(width, height) / Math.max(texture.width, texture.height)
      sprite.scale.set(scale * 1.4)
    } else if (kind === 'wall-trap') {
      const scale = Math.max(width, height) / Math.max(texture.width, texture.height)
      sprite.scale.set(scale * 1.2)
      sprite.alpha = 0.78
    } else if (kind === 'wall-mob') {
      const scale = Math.max(width, height) / Math.max(texture.width, texture.height)
      sprite.scale.set(scale * 1.25)
      sprite.alpha = 0.82
    } else if (kind === 'mini-boss') {
      const scale = Math.max(width, height) / Math.max(texture.width, texture.height)
      sprite.scale.set(scale * 0.95)
      sprite.alpha = 0.86
    } else if (kind === 'air-bird') {
      const scale = width / texture.width
      sprite.scale.set(scale * 1.4)
    } else if (kind === 'aura-orb') {
      const scale = (width * 1.2) / texture.width
      sprite.scale.set(scale)
    } else if (kind === 'portal') {
      const scale = Math.min(width / texture.width, height / texture.height) * 0.98
      sprite.scale.set(scale)
      sprite.alpha = 0.9
    } else if (kind === 'coin') {
      const scale = (width * 1.05) / texture.width
      sprite.scale.set(scale)
    }
    return sprite
  }

  private destroyEntity(entity: GameEntity) {
    entity.container.destroy({ children: true })
  }

  private checkCollisions(layout: VerticalLayout) {
    const pos = this.playerPosition(layout)
    const shielded = this.shieldTimer > 0 && this.shieldCharges > 0
    const armed = this.slashTimer > 0 || this.beastTimer > 0

    for (let i = this.entities.length - 1; i >= 0; i -= 1) {
      const entity = this.entities[i]
      if (entity.killed) continue

      const dx = entity.screenX - pos.x
      const dy = entity.screenY - pos.y
      const touchRadius = entity.radius + PLAYER_RADIUS
      if (dx * dx + dy * dy > touchRadius * touchRadius) continue

      if (entity.kind === 'coin') {
        entity.killed = true
        this.coins += 1
        this.callbacks.onCoin?.(1)
        this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.amber, 5, 0.6)
        continue
      }

      if (entity.kind === 'aura-orb') {
        entity.killed = true
        this.aura = Math.min(AURA_MAX, this.aura + AURA_ORB_FILL)
        this.auraLevel = this.auraTier()
        this.callbacks.onCoin?.(2)
        this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.magenta, 10, 0.9)
        this.spawnSlash(entity.screenX, entity.screenY, GAME_COLORS.rankViolet, 0.4)
        continue
      }

      if (entity.kind === 'portal') {
        entity.killed = true
        this.aura = Math.min(AURA_MAX, this.aura + 36)
        this.auraLevel = this.auraTier()
        this.portalFlash = 1
        this.shake = Math.max(this.shake, 0.55)
        this.speedKick = Math.min(0.56, this.speedKick + 0.18)
        this.callbacks.onPortal?.()
        this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.magenta, 16, 0.9)
        this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.gateBlue, 8, 0.7)
        continue
      }

      if (shielded) {
        entity.killed = true
        this.shieldCharges = 0
        this.shieldTimer = 0
        this.callbacks.onStrike?.()
        this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.gateBlue, 15, 0.85)
        this.spawnSlash(entity.screenX, entity.screenY, GAME_COLORS.gateBlue, 0.48)
        this.shake = Math.max(this.shake, 0.55)
        continue
      }

      if (armed) {
        entity.killed = true
        this.callbacks.onStrike?.()
        this.triggerBeastStrike(entity.screenX, entity.screenY, entity.kind === 'mini-boss' ? 1.25 : 0.82)
        this.spawnSlash(entity.screenX, entity.screenY, entity.kind === 'mini-boss' ? GAME_COLORS.lime : GAME_COLORS.gateBlue, entity.kind === 'mini-boss' ? 1.12 : 0.7)
        this.spawnBurst(entity.screenX, entity.screenY, entity.kind === 'mini-boss' ? GAME_COLORS.lime : GAME_COLORS.rankViolet, entity.kind === 'mini-boss' ? 22 : 9, entity.kind === 'mini-boss' ? 1.15 : 0.8)
        this.coins += entity.kind === 'mini-boss' ? 6 : 1
        if (this.beastTimer <= 0) this.aura = Math.min(AURA_MAX, this.aura + (entity.kind === 'mini-boss' ? 4 : 0.5))
        this.auraLevel = this.auraTier()
        this.shake = Math.max(this.shake, 0.5)
        continue
      }

      this.handleCrash(entity)
      return
    }
  }

  private handleCrash(entity: GameEntity) {
    this.phase = 'gameover'
    this.callbacks.onPhaseChange?.('gameover')
    this.callbacks.onCrash?.()
    entity.killed = true
    this.shake = 2.2
    this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.coral, 24, 1.4)
    this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.rankViolet, 14, 1)

    const distanceWhole = Math.round(this.distance)
    const result: RunResult = {
      id: `${Date.now()}`,
      distance: distanceWhole,
      coins: this.coins,
      durationMs: Math.round(this.elapsedMs),
      peakSpeed: Math.round(this.peakSpeed),
      createdAt: new Date().toISOString(),
    }
    this.callbacks.onRunComplete?.(result)
    this.emitStats(true)
  }

  private guardianSweep(layout: VerticalLayout) {
    let cleared = 0
    let hitX = 0
    let hitY = 0
    const pos = this.playerPosition(layout)
    for (const entity of this.entities) {
      if (entity.killed) continue
      if (this.isThreat(entity)) {
        const nearPlayer = Math.abs(entity.screenY - pos.y) < 150 && Math.abs(entity.screenX - pos.x) < layout.width * 0.42
        if (nearPlayer) {
          entity.killed = true
          cleared += 1
          hitX += entity.screenX
          hitY += entity.screenY
          this.spawnSlash(entity.screenX, entity.screenY, GAME_COLORS.lime, entity.kind === 'mini-boss' ? 1.15 : 0.65)
          this.spawnBurst(entity.screenX, entity.screenY, GAME_COLORS.lime, entity.kind === 'mini-boss' ? 18 : 8, 0.8)
        }
      }
    }
    if (cleared > 0) {
      this.triggerBeastStrike(hitX / cleared, hitY / cleared, cleared > 2 ? 1.18 : 0.9)
      this.callbacks.onStrike?.()
      this.shake = Math.max(this.shake, 0.4)
    }
  }

  private isThreat(entity: GameEntity) {
    return entity.kind === 'wall-spike' || entity.kind === 'wall-trap' || entity.kind === 'wall-flame' || entity.kind === 'wall-mob' || entity.kind === 'gate-spear' || entity.kind === 'air-bird' || entity.kind === 'mini-boss'
  }

  private triggerBeastStrike(x: number, y: number, intensity: number) {
    this.beastVisualTimer = Math.max(this.beastVisualTimer, 0.46 + intensity * 0.12)
    this.beastAttackX = x
    this.beastAttackY = y
  }

  private render() {
    const layout = this.layout()
    const shakeX = this.shake > 0 ? (this.random() - 0.5) * this.shake * 6 : 0
    const shakeY = this.shake > 0 ? (this.random() - 0.5) * this.shake * 4 : 0
    this.app.stage.position.set(shakeX, shakeY)
    this.drawBackground(layout)
    this.drawWalls(layout)
    this.drawSummon(layout)
    this.drawPlayer(layout)
    this.positionEntities()
  }

  private drawBackground(layout: VerticalLayout) {
    const g = this.background
    const travel = this.distance * 0.55
    const pulse = 0.5 + Math.sin(this.elapsedMs * 0.0055) * 0.5

    this.positionBackgroundArt(layout)
    g.clear()
    g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.ink, alpha: this.backgroundTexture ? 0.18 : 1 })
    g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.night, alpha: this.backgroundTexture ? 0.18 : 0.7 })

    for (let y = -80 + (travel % 64); y < layout.height + 80; y += 64) {
      const alpha = ((Math.floor((y + travel) / 64)) % 4 === 0) ? 0.12 : 0.04
      g.moveTo(layout.leftWallInner + 8, y).lineTo(layout.rightWallInner - 8, y).stroke({
        color: GAME_COLORS.rankViolet,
        alpha,
        width: 1,
      })
    }

    const runeBase = (travel * 0.9) % 220
    for (let y = -runeBase; y < layout.height + 80; y += 220) {
      const alpha = 0.06 + pulse * 0.04
      g.poly(
        [
          layout.laneCenter, y,
          layout.laneCenter + 22, y + 36,
          layout.laneCenter, y + 72,
          layout.laneCenter - 22, y + 36,
        ],
        true,
      ).stroke({ color: GAME_COLORS.gateBlue, alpha, width: 1 })
    }

    if (this.portalFlash > 0) {
      g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.magenta, alpha: this.portalFlash * 0.12 })
    }
    if (this.beastTimer > 0) {
      g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.lime, alpha: 0.04 + pulse * 0.02 })
    } else if (this.slashTimer > 0) {
      g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.rankViolet, alpha: 0.05 + pulse * 0.02 })
    }
  }

  private positionBackgroundArt(layout: VerticalLayout) {
    const texture = this.backgroundTexture
    if (!texture || this.backgroundSprites.length === 0) return

    const scale = Math.max(layout.width / texture.width, layout.height / texture.height)
    const spriteHeight = texture.height * scale
    const offset = (this.distance * 0.18) % spriteHeight
    const x = Math.min(0, (layout.width - texture.width * scale) * 0.5)

    this.backgroundArtLayer.visible = true
    this.backgroundSprites.forEach((sprite, index) => {
      sprite.texture = texture
      sprite.scale.set(scale)
      sprite.position.set(x, offset + (index - 1) * spriteHeight)
      sprite.alpha = 0.7
    })
  }

  private drawWalls(layout: VerticalLayout) {
    const g = this.wallLayer
    g.clear()
    const travel = this.distance * 0.55
    const slowTravel = this.distance * 0.24
    const thickness = layout.wallThickness
    const leftWallX = layout.leftWallInner - thickness
    const rightWallX = layout.rightWallInner

    g.rect(0, 0, leftWallX, layout.height).fill({ color: GAME_COLORS.abyss, alpha: 0.36 })
    g.rect(rightWallX + thickness, 0, layout.width - rightWallX - thickness, layout.height).fill({ color: GAME_COLORS.abyss, alpha: 0.36 })

    g.rect(leftWallX, 0, thickness, layout.height).fill({ color: 0x090613, alpha: 0.82 })
    g.rect(rightWallX, 0, thickness, layout.height).fill({ color: 0x090613, alpha: 0.82 })

    g.rect(leftWallX + 4, 0, Math.max(4, thickness - 9), layout.height).fill({ color: GAME_COLORS.deepPurple, alpha: 0.22 })
    g.rect(rightWallX + 5, 0, Math.max(4, thickness - 9), layout.height).fill({ color: GAME_COLORS.deepPurple, alpha: 0.18 })

    const leftInner = layout.leftWallInner
    const rightInner = layout.rightWallInner
    g.rect(leftInner - 4, 0, 1.5, layout.height).fill({ color: GAME_COLORS.magenta, alpha: 0.28 })
    g.rect(leftInner - 2, 0, 2, layout.height).fill({ color: GAME_COLORS.rankViolet, alpha: 0.48 })
    g.rect(leftInner, 0, 1, layout.height).fill({ color: GAME_COLORS.white, alpha: 0.13 })
    g.rect(rightInner, 0, 2, layout.height).fill({ color: GAME_COLORS.gateBlue, alpha: 0.54 })
    g.rect(rightInner + 2.5, 0, 1.5, layout.height).fill({ color: GAME_COLORS.blue, alpha: 0.24 })
    g.rect(rightInner - 1, 0, 1, layout.height).fill({ color: GAME_COLORS.white, alpha: 0.12 })

    for (let y = -120 + (travel % 86); y < layout.height + 120; y += 86) {
      const alpha = 0.14 + Math.sin((y + travel) * 0.018) * 0.04
      g.moveTo(leftWallX + 5, y).lineTo(leftInner - 7, y + 10).stroke({ color: GAME_COLORS.rankViolet, alpha, width: 1 })
      g.moveTo(rightWallX + 7, y + 10).lineTo(rightWallX + thickness - 5, y).stroke({ color: GAME_COLORS.gateBlue, alpha: alpha * 0.9, width: 1 })
    }

    const runeStep = 158
    for (let y = -runeStep + (travel * 1.04 % runeStep); y < layout.height + runeStep; y += runeStep) {
      const lx = leftWallX + thickness * 0.52
      const rx = rightWallX + thickness * 0.48
      const size = 5.5 + Math.sin((y + this.elapsedMs * 0.001) * 0.02) * 1.2
      g.poly([lx, y - size, lx + size, y, lx, y + size, lx - size, y], true).stroke({
        color: GAME_COLORS.magenta,
        alpha: 0.34,
        width: 1,
      })
      g.poly([rx, y - size, rx + size, y, rx, y + size, rx - size, y], true).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: 0.36,
        width: 1,
      })
    }

    const flameStep = 236
    for (let y = -flameStep + (slowTravel % flameStep); y < layout.height + flameStep; y += flameStep) {
      const pulse = 0.5 + Math.sin(this.elapsedMs * 0.006 + y * 0.03) * 0.5
      this.drawWallFlameGlyph(g, leftInner - 6, y + 58, 1, 0.22 + pulse * 0.1, 0.46)
      this.drawWallFlameGlyph(g, rightInner + 6, y + 174, -1, 0.2 + pulse * 0.09, 0.44)
    }
  }

  private drawWallFlameGlyph(g: Graphics, x: number, y: number, side: number, alpha: number, scale = 1) {
    const s = scale
    g.poly(
      [
        x,
        y + 18 * s,
        x + side * 9 * s,
        y + 5 * s,
        x + side * 5 * s,
        y - 8 * s,
        x + side * 17 * s,
        y - 28 * s,
        x + side * 3 * s,
        y - 18 * s,
        x - side * 3 * s,
        y - 38 * s,
        x - side * 11 * s,
        y - 13 * s,
        x - side * 7 * s,
        y + 6 * s,
      ],
      true,
    ).fill({ color: GAME_COLORS.gateBlue, alpha })
    g.poly(
      [
        x + side * 1 * s,
        y + 10 * s,
        x + side * 7 * s,
        y - 4 * s,
        x + side * 2 * s,
        y - 13 * s,
        x + side * 8 * s,
        y - 24 * s,
        x - side * 2 * s,
        y - 16 * s,
        x - side * 6 * s,
        y - 2 * s,
      ],
      true,
    ).fill({ color: GAME_COLORS.magenta, alpha: alpha * 0.64 })
    g.circle(x + side * 1.5 * s, y + 12 * s, 5 * s).fill({ color: GAME_COLORS.white, alpha: alpha * 0.34 })
  }

  private drawPlayer(layout: VerticalLayout) {
    const pos = this.playerPosition(layout)
    const motion = this.playerMotionKey()
    const motionFrames = this.playerMotionTextures[motion]
    const hasMotionFrames = Boolean(motionFrames && motionFrames.length > 0)
    const frames = hasMotionFrames ? motionFrames : this.playerTextures
    const frameIndex = hasMotionFrames
      ? this.playerFrameIndex(motion, frames?.length ?? 1)
      : this.legacyPlayerFrameIndex()
    const cleanGlow = this.beastTimer > 0 ? 1 : this.slashTimer > 0 ? 0.72 : this.speedKick
    const shimmer = 0.5 + Math.sin(this.elapsedMs * 0.018) * 0.5

    this.player.position.set(pos.x, pos.y)
    this.player.rotation = 0
    this.player.scale.set(1)

    const g = this.playerArt
    g.clear()

    if (frames && frames.length > 0) {
      const texture = frames[frameIndex % frames.length] ?? frames[0]
      const previousTexture = this.playerSprite.texture
      const textureKey = hasMotionFrames ? `${motion}:${frameIndex}` : `legacy:${frameIndex}`
      const bob =
        motion === 'run'
          ? Math.sin(this.elapsedMs * 0.034) * 1.6
          : motion === 'idle'
            ? Math.sin(this.elapsedMs * 0.012) * 1
            : 0
      const hopT = this.gravitySwitchProgress()
      const hopEase = smoothStep(hopT)
      const visualSide = this.visualWallSide()
      const wallDir = visualSide === 'left' ? -1 : 1
      const wallContact = wallDir * (PLAYER_INSET - 8)
      const contactBlend = this.playerAttached ? 1 : Math.abs(Math.cos(hopT * Math.PI))
      const startAngle = this.wallRunAngle(this.playerLaunchSide)
      const endAngle = this.wallRunAngle(this.playerSide)
      const airTurn = Math.sin(hopT * Math.PI) * 0.16 * Math.sign(this.playerVX || this.playerFacing)
      const spriteRotation = this.playerAttached ? this.wallRunAngle(this.playerSide) : lerp(startAngle, endAngle, hopEase) + airTurn
      const spriteFlip = this.wallRunFlip(visualSide)
      const footPress = this.playerAttached ? Math.sin(this.elapsedMs * 0.055) * 1.6 : 0
      const spriteX = wallContact * contactBlend + wallDir * footPress
      const spriteY = (this.playerAttached ? Math.sin(this.elapsedMs * 0.032) * 1.2 : Math.sin(hopT * Math.PI) * -3) + bob

      this.playerSprite.visible = true
      if (this.playerTextureKey !== textureKey && previousTexture) {
        this.playerGhostSprite.texture = previousTexture
        this.playerGhostSprite.visible = true
        this.playerGhostSprite.alpha = 0.08
        this.frameBlend = 0
      }
      this.playerTextureKey = textureKey
      this.playerSprite.texture = texture
      this.frameBlend = Math.min(1, this.frameBlend + 0.7)

      const anchorY = motion === 'jump' || motion === 'fall' ? 0.74 : 0.8
      this.playerSprite.anchor.set(0.48, anchorY)
      this.playerGhostSprite.anchor.set(0.48, anchorY)
      this.playerSprite.position.set(spriteX, spriteY)
      this.playerGhostSprite.position.copyFrom(this.playerSprite.position)
      this.playerSprite.rotation = spriteRotation
      this.playerGhostSprite.rotation = spriteRotation

      const baseHeight = PLAYER_MOTION_HEIGHTS[motion] ?? 70
      const spriteScale = (baseHeight + cleanGlow * 4) / texture.height
      this.playerSprite.scale.set(spriteScale * spriteFlip, spriteScale)
      this.playerGhostSprite.scale.set(spriteScale * spriteFlip, spriteScale)
      this.playerGhostSprite.alpha = Math.max(0, 0.06 * (1 - this.frameBlend))
      if (this.frameBlend >= 1) this.playerGhostSprite.visible = false

      if (this.beastTimer > 0 || this.slashTimer > 0) {
        const color = this.beastTimer > 0 ? GAME_COLORS.lime : GAME_COLORS.rankViolet
        g.circle(0, -22, 36 + shimmer * 4).stroke({ color, alpha: 0.4, width: 2 })
        g.circle(0, -22, 24).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.32, width: 1 })
      }

      if (this.playerAttached) {
        const flash = this.wallContactFlash
        const contactX = (this.playerSide === 'left' ? -1 : 1) * (PLAYER_INSET - 3)
        g.ellipse(contactX, 10, 5 + flash * 6, 30 + flash * 10).fill({ color: GAME_COLORS.shadow, alpha: 0.34 })
        g.moveTo(contactX, -34).lineTo(contactX, 30).stroke({
          color: this.playerSide === 'left' ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue,
          alpha: 0.28 + flash * 0.3,
          width: 2 + flash,
        })
        for (let i = 0; i < 3; i += 1) {
          const y = -20 + i * 21 + Math.sin(this.elapsedMs * 0.035 + i) * 4
          g.moveTo(contactX, y).lineTo(contactX - (this.playerSide === 'left' ? -1 : 1) * (8 + flash * 10), y + 5).stroke({
            color: GAME_COLORS.white,
            alpha: 0.16 + flash * 0.18,
            width: 1,
          })
        }
      } else {
        g.ellipse(0, 22, 18, 4).fill({ color: GAME_COLORS.shadow, alpha: 0.2 })
      }
      return
    }

    this.playerSprite.visible = false
    g.poly([-8, -60, 22, -70, 48, -25, 34, 18, -6, 20, -24, -18], true).fill({ color: GAME_COLORS.abyss, alpha: 0.96 })
    g.poly([20, -52, 60, -36, 58, -26, 18, -38], true).fill({ color: GAME_COLORS.coral, alpha: 0.94 })
    g.rect(40, -31, 44, 2).fill({ color: GAME_COLORS.white, alpha: 0.9 })
    g.ellipse(0, 14, 22, 4).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
  }

  private drawSummon(layout: VerticalLayout) {
    const g = this.summonArt
    g.clear()

    if (this.beastTimer <= 0 && this.slashTimer <= 0 && this.shieldTimer <= 0 && this.beastVisualTimer <= 0) {
      this.guardianLayer.visible = false
      this.summonSprite.visible = false
      return
    }

    const pos = this.playerPosition(layout)
    const visualActive = this.beastVisualTimer > 0
    const followActive = this.beastTimer > 0
    const age = BEAST_SECONDS - this.beastTimer
    const alpha = visualActive ? Math.min(1, this.beastVisualTimer / 0.16) : followActive ? Math.min(0.82, this.beastTimer / 0.7) : 0
    const pulse = 0.5 + Math.sin(this.elapsedMs * 0.018) * 0.5
    const motion: GuardianMotion = visualActive ? 'attack' : age < 0.45 && followActive ? 'emerge' : 'guard'
    const fallbackIndex = motion === 'emerge' ? 0 : motion === 'attack' ? 2 : 1

    const frames = this.guardianMotionTextures[motion] ?? []
    const frameRate = motion === 'attack' ? 48 : motion === 'emerge' ? 70 : 90
    const texture = frames.length > 0 ? frames[Math.floor(this.elapsedMs / frameRate) % frames.length] : this.summonTextures[fallbackIndex]

    this.guardianLayer.visible = true

    const followSide = this.playerSide === 'left' ? 1 : -1
    const beastSide = visualActive ? (this.beastAttackX >= pos.x ? 1 : -1) : followSide
    const followX = pos.x + followSide * (54 + pulse * 4)
    const followY = pos.y + 34 + Math.sin(this.elapsedMs * 0.01) * 4
    const beastX = visualActive ? this.beastAttackX - beastSide * 34 : followX
    const beastY = visualActive ? this.beastAttackY - 12 + Math.sin(this.elapsedMs * 0.02) * 3 : followY

    if (texture && (visualActive || followActive)) {
      const targetHeight = visualActive ? 112 : motion === 'emerge' ? 108 : 96
      const scale = (targetHeight + pulse * 3) / texture.height
      this.summonSprite.visible = true
      this.summonSprite.texture = texture
      this.summonSprite.alpha = visualActive ? alpha * 0.95 : alpha * 0.74
      this.summonSprite.anchor.set(0.5, 0.7)
      this.summonSprite.position.set(beastX, beastY)
      this.summonSprite.scale.set(scale * beastSide, scale)
      this.summonSprite.rotation = visualActive ? -0.04 * beastSide : Math.sin(this.elapsedMs * 0.008) * 0.025
    } else {
      this.summonSprite.visible = false
    }

    if (this.shieldTimer > 0) {
      const radius = 34 + pulse * 2
      for (let i = 0; i < 6; i += 1) {
        const a1 = (i / 6) * Math.PI * 2 + this.elapsedMs * 0.0015
        const a2 = ((i + 1) / 6) * Math.PI * 2 + this.elapsedMs * 0.0015
        g.moveTo(pos.x + Math.cos(a1) * radius, pos.y - 18 + Math.sin(a1) * radius).lineTo(pos.x + Math.cos(a2) * radius, pos.y - 18 + Math.sin(a2) * radius).stroke({
          color: GAME_COLORS.gateBlue,
          alpha: 0.32 + pulse * 0.08,
          width: 1.5,
        })
      }
    }

    if (followActive || this.slashTimer > 0) {
      const auraAlpha = followActive ? 0.24 : 0.2
      g.circle(pos.x, pos.y - 28, 30 + pulse * 3).stroke({
        color: followActive ? GAME_COLORS.lime : GAME_COLORS.rankViolet,
        alpha: auraAlpha + pulse * 0.08,
        width: 1.4,
      })
      g.circle(pos.x, pos.y - 28, 42 + pulse * 5).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: 0.1 + pulse * 0.05,
        width: 1.2,
      })
    }

    if (followActive && !visualActive) {
      g.moveTo(pos.x, pos.y - 22).lineTo(followX, followY - 14).stroke({
        color: GAME_COLORS.rankViolet,
        alpha: 0.18 + pulse * 0.08,
        width: 1.2,
      })
    }

    if (visualActive) {
      g.moveTo(pos.x, pos.y - 34).lineTo(this.beastAttackX, this.beastAttackY).stroke({
        color: GAME_COLORS.lime,
        alpha: alpha * 0.46,
        width: 2,
      })
      g.poly(
        [
          this.beastAttackX - beastSide * 64,
          this.beastAttackY - 28,
          this.beastAttackX + beastSide * 28,
          this.beastAttackY - 42,
          this.beastAttackX + beastSide * 70,
          this.beastAttackY - 4,
          this.beastAttackX - beastSide * 42,
          this.beastAttackY + 24,
        ],
        true,
      ).fill({ color: GAME_COLORS.rankViolet, alpha: alpha * 0.2 })

      for (let i = 0; i < 6; i += 1) {
        const angle = this.elapsedMs * 0.004 + i * (Math.PI / 3)
        const rx = 28 + Math.sin(this.elapsedMs * 0.006 + i) * 3
        const x = this.beastAttackX + Math.cos(angle) * rx
        const y = this.beastAttackY + Math.sin(angle) * 20
        const s = 4 + pulse * 1.6
        g.poly([x, y - s, x + s, y, x, y + s, x - s, y], true).fill({
          color: i % 2 === 0 ? GAME_COLORS.gateBlue : GAME_COLORS.magenta,
          alpha: alpha * 0.5,
        })
      }
    }
  }

  private positionEntities() {
    for (const entity of this.entities) {
      entity.container.position.set(entity.screenX, entity.screenY)
      entity.wobble += 0.04
      if (entity.kind === 'coin' || entity.kind === 'aura-orb') {
        const tilt = Math.sin(entity.wobble) * 0.2
        entity.container.rotation = tilt
        const scale = 1 + Math.sin(entity.wobble) * 0.08
        entity.container.scale.set(entity.killed ? Math.max(0, 1 - entity.killFx * 3) : scale)
      } else if (entity.kind === 'wall-trap') {
        const pulse = 1 + Math.sin(entity.wobble * 1.5) * 0.035
        entity.container.scale.set(entity.killed ? Math.max(0, 1 - entity.killFx * 3) : pulse)
        entity.container.rotation = entity.side === 'left' ? -0.16 : 0.16
        if (entity.sprite) {
          entity.sprite.rotation = entity.side === 'left' ? -0.42 : 0.42
          entity.sprite.scale.x = (entity.side === 'left' ? 1 : -1) * Math.abs(entity.sprite.scale.x)
        }
      } else if (entity.kind === 'wall-flame') {
        const pulse = entity.killed ? Math.max(0, 1 - entity.killFx * 3) : 0.9 + Math.sin(entity.wobble * 1.8) * 0.1
        entity.container.scale.set((entity.side === 'left' ? 1 : -1) * pulse, pulse)
        entity.container.rotation = (entity.side === 'left' ? -0.04 : 0.04) + Math.sin(entity.wobble * 0.9) * 0.035
      } else if (entity.kind === 'gate-spear') {
        const charge = entity.killed ? Math.max(0, 1 - entity.killFx * 3) : 1 + Math.sin(entity.wobble * 2.2) * 0.025
        entity.container.scale.set((entity.side === 'left' ? 1 : -1) * charge, charge)
        entity.container.rotation = Math.sin(entity.wobble * 1.6) * 0.018
        entity.graphic.alpha = 0.86 + Math.sin(this.elapsedMs * 0.018 + entity.id) * 0.1
      } else if (entity.kind === 'wall-mob') {
        const crawl = Math.sin(entity.wobble * 1.1)
        const wallDir = entity.side === 'left' ? 1 : -1
        entity.container.rotation = crawl * 0.045
        entity.container.x += wallDir * Math.sin(entity.wobble * 1.7) * 0.18
        if (entity.sprite) entity.sprite.scale.x = (entity.side === 'left' ? 1 : -1) * Math.abs(entity.sprite.scale.x)
      } else if (entity.kind === 'mini-boss') {
        const hover = Math.sin(entity.wobble * 0.85) * 0.045
        const pulse = 1 + Math.sin(entity.wobble * 1.4) * 0.035
        entity.container.rotation = hover
        entity.container.scale.set(entity.killed ? Math.max(0, 1 - entity.killFx * 2.2) : pulse)
        if (entity.sprite) entity.sprite.scale.x = (entity.velocityX >= 0 ? 1 : -1) * Math.abs(entity.sprite.scale.x)
      } else if (entity.kind === 'wall-spike') {
        if (entity.sprite) {
          entity.sprite.rotation = entity.side === 'left' ? -0.3 : 0.3
          entity.sprite.scale.x = (entity.side === 'left' ? 1 : -1) * Math.abs(entity.sprite.scale.x)
        }
      } else if (entity.kind === 'air-bird') {
        const flap = Math.sin(this.elapsedMs * 0.022 + entity.wobble) * 0.18
        entity.container.rotation = flap
        if (entity.sprite) entity.sprite.scale.x = (entity.velocityX > 0 ? 1 : -1) * Math.abs(entity.sprite.scale.x)
      } else if (entity.kind === 'portal') {
        const tilt = Math.sin(entity.wobble * 0.52) * 0.026
        const pulse = 1 + Math.sin(entity.wobble * 0.8) * 0.045
        const shimmer = 0.74 + Math.sin(this.elapsedMs * 0.02 + entity.id) * 0.18
        entity.container.rotation = tilt
        entity.graphic.rotation = -tilt * 1.6
        entity.container.scale.set(entity.killed ? Math.max(0, 1 - entity.killFx * 2.5) : pulse, entity.killed ? Math.max(0, 1 - entity.killFx * 2.5) : 1 + Math.cos(entity.wobble * 0.7) * 0.025)
        if (entity.sprite) {
          entity.sprite.rotation -= 0.018
          entity.sprite.alpha = Math.max(0.18, shimmer * 0.38)
        }
      }
      if (entity.killed) entity.container.alpha = Math.max(0, 1 - entity.killFx * 3)
    }
  }

  private playerMotionKey(): PlayerMotion {
    if (this.phase !== 'running') return 'idle'
    if (!this.playerAttached) {
      if (this.beastTimer > 0 || this.slashTimer > 0) return 'attack'
      return this.playerHopT > this.playerHopDuration * 0.55 ? 'fall' : 'jump'
    }
    return 'run'
  }

  private playerFrameIndex(motion: PlayerMotion, length: number) {
    if (motion === 'run') {
      const rate = Math.max(46, 72 - this.currentSpeed() * 0.028)
      return Math.floor(this.elapsedMs / rate) % length
    }

    const rate =
      motion === 'idle'
          ? 180
          : motion === 'jump' || motion === 'fall'
            ? 64
            : motion === 'attack'
              ? 44
              : 62
    return Math.floor(this.elapsedMs / rate) % length
  }

  private legacyPlayerFrameIndex() {
    if (!this.playerAttached) return 3
    return Math.floor(this.elapsedMs / 80) % Math.max(1, this.playerTextures.length)
  }

  private playerPosition(layout?: VerticalLayout) {
    const lay = layout ?? this.layout()
    const progress = this.gravitySwitchProgress()
    const arc = this.playerAttached ? 0 : Math.sin(progress * Math.PI) * HOP_ARC_LIFT
    return { x: this.playerX, y: lay.playerScreenY - arc }
  }

  private wallRunAngle(side: WallSide) {
    return side === 'left' ? Math.PI * 0.5 : -Math.PI * 0.5
  }

  private wallRunFlip(side: WallSide) {
    return side === 'left' ? -1 : 1
  }

  private visualWallSide() {
    if (this.playerAttached) return this.playerSide
    return this.gravitySwitchProgress() < 0.56 ? this.playerLaunchSide : this.playerSide
  }

  private gravitySwitchProgress() {
    if (this.playerAttached) return 1
    const distance = this.playerTargetX - this.playerStartX
    if (Math.abs(distance) < 1) return clamp(this.playerHopT / HOP_DURATION_BASE, 0, 1)
    return clamp((this.playerX - this.playerStartX) / distance, 0, 1)
  }

  private spawnWallRunFootstep(dt: number, layout: VerticalLayout) {
    if (this.phase !== 'running') return
    if (this.slashTimer > 0 || this.beastTimer > 0) return
    this.footstepClock += dt
    if (this.footstepClock < 0.085) return
    this.footstepClock = 0

    const wallDir = this.playerSide === 'left' ? -1 : 1
    const pos = this.playerPosition(layout)
    const g = new Graphics()
    g.rect(-1, -7, 2, 14).fill({ color: GAME_COLORS.gateBlue, alpha: 0.46 })
    g.position.set(pos.x + wallDir * (PLAYER_INSET - 3), pos.y + 12 + (this.random() - 0.5) * 20)
    this.particleLayer.addChild(g)
    this.particles.push({
      graphic: g,
      x: g.position.x,
      y: g.position.y,
      vx: -wallDir * (24 + this.random() * 18),
      vy: 70 + this.random() * 40,
      life: 0.22,
      maxLife: 0.22,
      drag: 0.9,
    })
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        p.graphic.destroy()
        this.particles.splice(i, 1)
        continue
      }
      p.vx *= p.drag
      p.vy *= p.drag
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.graphic.position.set(p.x, p.y)
      p.graphic.alpha = Math.max(0, p.life / p.maxLife)
      p.graphic.scale.set(Math.max(0.2, p.life / p.maxLife))
    }
  }

  private spawnBurst(x: number, y: number, color: number, count: number, intensity: number) {
    for (let i = 0; i < count; i += 1) {
      const g = new Graphics()
      g.circle(0, 0, 3 + this.random() * 2).fill({ color, alpha: 0.95 })
      g.position.set(x, y)
      this.particleLayer.addChild(g)
      const angle = this.random() * Math.PI * 2
      const speed = (80 + this.random() * 200) * intensity
      this.particles.push({
        graphic: g,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + this.random() * 0.4,
        maxLife: 0.9,
        drag: 0.86,
      })
    }
  }

  private spawnSlash(x: number, y: number, color: number, intensity: number) {
    const slashTexture = this.domainTextures.slash
    const g = new Container()
    if (slashTexture) {
      const sprite = new Sprite(slashTexture)
      sprite.anchor.set(0.5)
      const scale = (80 + intensity * 40) / slashTexture.width
      sprite.scale.set(scale)
      sprite.tint = color
      g.addChild(sprite)
    } else {
      const blade = new Graphics()
      blade.poly([-40, 0, -10, -8, 50, 0, -10, 8], true).fill({ color, alpha: 0.9 })
      g.addChild(blade)
    }
    g.position.set(x, y)
    g.rotation = this.random() * Math.PI
    this.particleLayer.addChild(g)
    this.particles.push({
      graphic: g,
      x, y,
      vx: 0,
      vy: 0,
      life: 0.32,
      maxLife: 0.32,
      drag: 1,
    })
  }

  private spawnGuardianRift(x: number, y: number) {
    for (let i = 0; i < 16; i += 1) {
      const g = new Graphics()
      const color = i % 2 === 0 ? GAME_COLORS.magenta : GAME_COLORS.gateBlue
      g.circle(0, 0, 4 + this.random() * 3).fill({ color, alpha: 0.9 })
      g.position.set(x, y)
      this.particleLayer.addChild(g)
      const angle = (i / 16) * Math.PI * 2
      const speed = 140 + this.random() * 90
      this.particles.push({
        graphic: g,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0.6 + this.random() * 0.3,
        maxLife: 0.9,
        drag: 0.92,
      })
    }
  }

  private spawnSpeedTrail(dt: number, layout: VerticalLayout) {
    this.trailClock += dt
    if (this.trailClock < 0.05) return
    this.trailClock = 0
    if (this.playerAttached && this.slashTimer <= 0 && this.beastTimer <= 0 && this.speedKick < 0.18) return

    const pos = this.playerPosition(layout)
    const g = new Graphics()
    const color = this.beastTimer > 0 ? GAME_COLORS.lime : this.slashTimer > 0 ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue
    g.circle(0, 0, 4).fill({ color, alpha: 0.7 })
    g.position.set(pos.x, pos.y + 10)
    this.particleLayer.addChild(g)
    this.particles.push({
      graphic: g,
      x: pos.x,
      y: pos.y + 10,
      vx: 0,
      vy: 80,
      life: 0.4,
      maxLife: 0.4,
      drag: 0.94,
    })
  }

  private layout(): VerticalLayout {
    const width = this.app.screen.width || this.host.clientWidth || 360
    const height = this.app.screen.height || this.host.clientHeight || 720
    const rawThickness = width * WALL_THICKNESS_PCT
    const wallThickness = Math.max(MIN_WALL_THICKNESS, Math.min(MAX_WALL_THICKNESS, rawThickness))
    const leftWallInner = WALL_INSET_PX + wallThickness
    const rightWallInner = width - WALL_INSET_PX - wallThickness
    const laneCenter = (leftWallInner + rightWallInner) * 0.5
    const playerScreenY = height * PLAYER_SCREEN_Y_PCT
    return { width, height, wallThickness, leftWallInner, rightWallInner, laneCenter, playerScreenY }
  }

  private currentSpeed() {
    const ramp = 1 + this.distance * CLIMB_RAMP * 0.00135
    const base = Math.min(MAX_CLIMB_SPEED, BASE_CLIMB_SPEED * ramp)
    return base + this.speedKick * 190
  }

  private auraTier() {
    if (this.aura >= AURA_MAX) return 3
    if (this.aura >= AURA_TIER_2) return 2
    if (this.aura >= AURA_TIER_1) return 1
    return 0
  }

  private random() {
    let x = this.rngState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rngState = x >>> 0
    return (this.rngState & 0xffffffff) / 0x100000000
  }

  private emitStats(force = false) {
    const now = this.elapsedMs
    if (!force && now - this.lastStatsAt < 60) return
    this.lastStatsAt = now
    const auraReady = this.aura >= AURA_TIER_1 || this.aura >= AURA_MAX
    const auraMode = this.beastTimer > 0 ? 'beast' : this.slashTimer > 0 ? 'sword' : this.shieldTimer > 0 ? 'shield' : 'none'
    const stats: RunStats = {
      phase: this.phase,
      distance: Math.round(this.distance),
      coins: this.coins,
      speed: Math.round(this.currentSpeed()),
      peakSpeed: Math.round(this.peakSpeed),
      flow: Math.round(Math.min(100, this.speedKick * 200)),
      combo: this.hopsThisRun,
      charge: Math.round(this.aura),
      aura: Math.round(this.aura),
      auraReady,
      evolution: this.auraLevel,
      invincible: this.shieldTimer > 0 || this.slashTimer > 0 || this.beastTimer > 0,
      summonActive: this.beastTimer > 0,
      auraMode,
      jumps: this.hopsThisRun,
      bestDistance: this.bestDistance,
      fps: Math.round(this.app.ticker?.FPS ?? 0),
    }
    this.callbacks.onStats?.(stats)
  }
}
