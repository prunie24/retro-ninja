import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Ticker } from 'pixi.js'
import { BASE_SPEED, GAME_COLORS, MAX_SPEED, PLAYER_RADIUS, SPEED_RAMP, WORLD_SCALE } from './constants'
import type { GameCallbacks, GamePhase, RunResult, RunStats } from './types'

type EntityKind = 'coin' | 'spike' | 'orb' | 'wall' | 'portal' | 'enemy'
type DomainTextureKey = 'coin' | 'spike' | 'orb' | 'block' | 'portal' | 'crawler' | 'wraith' | 'slash'
type PlayerMotion = 'idle' | 'run' | 'jump' | 'fall' | 'attack' | 'summon'
type GuardianMotion = 'emerge' | 'guard' | 'attack'

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
  idle: 78,
  run: 74,
  jump: 80,
  fall: 82,
  attack: 80,
  summon: 82,
}

const motionPath = (root: 'hunter' | 'summon', motion: string, index: number) =>
  `/assets/${root}/motion/${motion}-${String(index).padStart(2, '0')}.webp`

interface GameEntity {
  id: number
  kind: EntityKind
  textureKey?: DomainTextureKey
  worldX: number
  y: number
  width: number
  height: number
  radius: number
  value: number
  gapY: number
  gapHeight: number
  container: Container
  graphic: Graphics
  sprite?: Sprite
  spin: number
  wobble: number
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

interface RunnerLayout {
  width: number
  height: number
  playerX: number
  floorY: number
  ceilingY: number
  horizonY: number
}

const GRAVITY = 1280
const FIRST_JUMP = -570
const DOUBLE_JUMP = -510
const INTRO_SECONDS = 1.15
const SUMMON_SECONDS = 3.3
const AURA_MAX = 100

export class RetroNinjaEngine {
  private app = new Application()
  private readonly callbacks: GameCallbacks
  private readonly host: HTMLElement
  private phase: GamePhase = 'idle'
  private backgroundArtLayer = new Container()
  private background = new Graphics()
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
  private playerFrame = 0
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
  private nextSpawnX = 760
  private nextPortalX = 1800
  private playerY = 0
  private velocityY = 0
  private jumpsUsed = 0
  private flow = 0
  private combo = 0
  private aura = 0
  private evolution = 1
  private speedKick = 0
  private introTimer = 0
  private jumpCooldown = 0
  private attackTimer = 0
  private summonTimer = 0
  private guardianTimer = 0
  private guardianStrikeClock = 0
  private portalFlash = 0
  private shake = 0
  private bestDistance = 0
  private lastStatsAt = 0
  private trailClock = 0
  private destroyed = false
  private firstInputSent = false
  private initialized = false

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
    this.app.stage.addChild(this.backgroundArtLayer, this.background, this.hazardLayer, this.pickupLayer, this.particleLayer, this.guardianLayer, this.player)
    this.guardianLayer.visible = false
    this.summonSprite.visible = false
    this.guardianLayer.addChild(this.summonArt, this.summonSprite)
    this.playerSprite.visible = false
    this.playerGhostSprite.visible = false
    this.player.addChild(this.playerArt, this.playerGhostSprite, this.playerSprite)
    this.app.ticker.add(this.tick)
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown, { passive: true })
    window.addEventListener('keydown', this.handleKeyDown)
    this.initialized = true
    await Promise.all([this.loadDomainArt(), this.loadPlayerSprites()])
    if (this.destroyed) return
    this.resetRun(false)
    this.emitStats(true)
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
    if (this.phase !== 'running' || this.aura < AURA_MAX) return
    this.aura = 0
    this.evolution = Math.min(9, this.evolution + 1)
    this.summonTimer = SUMMON_SECONDS
    this.guardianTimer = SUMMON_SECONDS
    this.guardianStrikeClock = 0
    this.flow = clamp(this.flow + 24, 0, 100)
    this.speedKick = Math.min(0.68, this.speedKick + 0.34)
    this.shake = 1.7
    this.callbacks.onSummon?.()
    const pos = this.playerPosition()
    this.spawnBurst(pos.x + 38, pos.y - 34, GAME_COLORS.rankViolet, 34, 1.45)
    this.spawnSlash(pos.x + 72, pos.y - 34, GAME_COLORS.gateBlue, 1.35)
    this.spawnGuardianRift(pos.x + 64, pos.y - 10)
    this.clearThreats(pos.x + 920, true, true)
    this.emitStats(true)
  }

  private async loadPlayerSprites() {
    const legacyPaths = [
      '/assets/hunter/frame-0.png',
      '/assets/hunter/tween-idle-run.png',
      '/assets/hunter/frame-1.png',
      '/assets/hunter/tween-run-jump.png',
      '/assets/hunter/frame-3.png',
      '/assets/hunter/tween-jump-land.png',
      '/assets/hunter/frame-4.png',
      '/assets/hunter/tween-jump-slash.png',
      '/assets/hunter/frame-5.png',
      '/assets/hunter/tween-run-slash.png',
      '/assets/hunter/frame-2.png',
      '/assets/hunter/tween-charge-jump.png',
    ]
    try {
      const loaded = await Promise.all(
        PLAYER_MOTIONS.map(async (motion) => {
          const textures = await Promise.all(
            Array.from({ length: PLAYER_MOTION_COUNTS[motion] }, (_, index) => Assets.load(motionPath('hunter', motion, index)) as Promise<Texture>),
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
      const firstTexture = groups.idle?.[0] ?? this.playerTextures[0]
      this.playerSprite.texture = firstTexture
      this.playerSprite.anchor.set(0.5, 0.78)
      this.playerGhostSprite.texture = firstTexture
      this.playerGhostSprite.anchor.set(0.5, 0.78)
      this.playerSprite.visible = true
    } catch {
      try {
        const textures = await Promise.all(legacyPaths.map(async (path) => (await Assets.load(path)) as Texture))
        if (this.destroyed) return
        this.playerMotionTextures = {}
        this.playerTextures = textures
        this.playerSprite.texture = textures[0]
        this.playerSprite.anchor.set(0.5, 0.78)
        this.playerGhostSprite.texture = textures[0]
        this.playerGhostSprite.anchor.set(0.5, 0.78)
        this.playerSprite.visible = true
      } catch {
        this.playerMotionTextures = {}
        this.playerTextures = []
        this.playerSprite.visible = false
      }
    }
  }

  private async loadDomainArt() {
    try {
      const [background, coin, spike, orb, block, portal, crawler, wraith, slash, summonEmerge, summonGuard, summonAttack] = await Promise.all([
        Assets.load('/assets/backgrounds/aura-domain.webp') as Promise<Texture>,
        Assets.load('/assets/domain/sigil-coin.png') as Promise<Texture>,
        Assets.load('/assets/domain/crystal-spike.png') as Promise<Texture>,
        Assets.load('/assets/domain/eye-orb.png') as Promise<Texture>,
        Assets.load('/assets/domain/rune-block.png') as Promise<Texture>,
        Assets.load('/assets/domain/portal.png') as Promise<Texture>,
        Assets.load('/assets/domain/crawler.png') as Promise<Texture>,
        Assets.load('/assets/domain/wraith.png') as Promise<Texture>,
        Assets.load('/assets/domain/slash.png') as Promise<Texture>,
        Assets.load('/assets/summon/summon-emerge.png') as Promise<Texture>,
        Assets.load('/assets/summon/summon-guard.png') as Promise<Texture>,
        Assets.load('/assets/summon/summon-attack.png') as Promise<Texture>,
      ])
      if (this.destroyed) return
      this.backgroundTexture = background
      this.backgroundSprites = [new Sprite(background), new Sprite(background), new Sprite(background)]
      for (const sprite of this.backgroundSprites) {
        sprite.alpha = 0.92
        this.backgroundArtLayer.addChild(sprite)
      }
      this.domainTextures = { coin, spike, orb, block, portal, crawler, wraith, slash }
      this.summonTextures = [summonEmerge, summonGuard, summonAttack]
      this.summonSprite.texture = summonGuard
      this.summonSprite.anchor.set(0.5)
    } catch {
      this.backgroundTexture = undefined
      this.domainTextures = {}
      this.summonTextures = []
    }

    try {
      const loaded = await Promise.all(
        GUARDIAN_MOTIONS.map(async (motion) => {
          const textures = await Promise.all(
            Array.from({ length: GUARDIAN_MOTION_COUNTS[motion] }, (_, index) => Assets.load(motionPath('summon', motion, index)) as Promise<Texture>),
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
    } catch {
      this.guardianMotionTextures = {}
    }
  }

  private handlePointerDown = () => {
    this.handlePrimaryAction()
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'Enter') {
      event.preventDefault()
      this.handlePrimaryAction()
    }
  }

  private handlePrimaryAction() {
    if (!this.firstInputSent) {
      this.firstInputSent = true
      this.callbacks.onFirstInput?.()
    }

    if (this.phase !== 'running') {
      this.resetRun(true)
      return
    }

    this.performJump()
  }

  private performJump() {
    if (this.jumpCooldown > 0 || this.jumpsUsed >= 2) return

    const secondJump = this.jumpsUsed === 1
    this.velocityY = secondJump ? DOUBLE_JUMP : FIRST_JUMP
    this.jumpsUsed += 1
    this.jumpCooldown = secondJump ? 0.1 : 0.07
    this.attackTimer = secondJump ? 0.28 : 0.15
    this.speedKick = Math.min(0.5, this.speedKick + (secondJump ? 0.16 : 0.09))
    this.combo = Math.min(12, this.combo + 1)
    this.flow = clamp(this.flow + (secondJump ? 8 : 5), 0, 100)
    this.aura = clamp(this.aura + (secondJump ? 4 : 2), 0, AURA_MAX)
    this.callbacks.onJump?.(secondJump ? 0.9 : 0.58)

    const pos = this.playerPosition()
    this.spawnSlash(pos.x + 16, pos.y - 22, secondJump ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue, secondJump ? 1 : 0.52)
    this.spawnBurst(pos.x - 8, pos.y + 10, secondJump ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue, secondJump ? 12 : 5, secondJump ? 0.92 : 0.7)
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
    this.nextSpawnX = 760
    this.nextPortalX = 1800 + this.random() * 520
    this.playerY = layout.floorY
    this.velocityY = 0
    this.jumpsUsed = 0
    this.flow = 0
    this.combo = 0
    this.aura = 0
    this.evolution = 1
    this.speedKick = startRunning ? 0.18 : 0
    this.introTimer = startRunning ? INTRO_SECONDS : 0
    this.jumpCooldown = 0
    this.attackTimer = 0
    this.summonTimer = 0
    this.guardianTimer = 0
    this.guardianStrikeClock = 0
    this.portalFlash = 0
    this.shake = 0
    this.lastStatsAt = 0
    this.trailClock = 0
    this.playerFrame = 0
    this.playerTextureKey = ''
    this.frameBlend = 1
    this.guardianLayer.visible = false
    this.summonArt.clear()
    this.spawnOpeningDomain()
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
    this.elapsedMs += dt * (this.phase === 'running' ? 1000 : 420)
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt)
    this.attackTimer = Math.max(0, this.attackTimer - dt)
    this.summonTimer = Math.max(0, this.summonTimer - dt)
    this.guardianTimer = Math.max(0, this.guardianTimer - dt)
    this.portalFlash = Math.max(0, this.portalFlash - dt * 1.8)
    this.shake = Math.max(0, this.shake - dt * 9)
    this.speedKick = Math.max(0, this.speedKick - dt * 0.42)

    if (this.phase === 'running') {
      this.introTimer = Math.max(0, this.introTimer - dt)
      const speed = this.currentSpeed()
      this.distance += speed * dt
      this.peakSpeed = Math.max(this.peakSpeed, speed)
      this.flow = clamp(this.flow - dt * (1.8 + Math.max(0, this.combo - 4) * 0.18), 0, 100)

      this.velocityY += GRAVITY * dt
      this.playerY += this.velocityY * dt
      if (this.playerY >= layout.floorY) {
        this.playerY = layout.floorY
        this.velocityY = 0
        this.jumpsUsed = 0
        this.combo = Math.max(0, this.combo - dt * 1.8)
      }

      this.spawnAhead(layout)
      this.updateEntities(dt, layout)
      if (this.guardianTimer > 0) {
        this.guardianStrikeClock += dt
        if (this.guardianStrikeClock > 0.24) {
          this.guardianStrikeClock = 0
          this.guardianSweep(layout)
        }
        this.clearThreats(layout.playerX + 860, false, true)
      } else if (this.summonTimer > 0) {
        this.clearThreats(layout.playerX + 760, false)
      }
      this.checkCollisions(layout)
      this.spawnSpeedTrail(dt)
      this.emitStats()
    } else {
      this.playerY = layout.floorY
    }

    this.updateParticles(dt)
  }

  private render() {
    const layout = this.layout()
    const shakeX = this.shake > 0 ? (this.random() - 0.5) * this.shake * 7 : 0
    const shakeY = this.shake > 0 ? (this.random() - 0.5) * this.shake * 4 : 0
    this.app.stage.position.set(shakeX, shakeY)
    this.drawBackground(layout)
    this.drawSummon(layout)
    this.drawPlayer(layout)
    this.positionEntities(layout)
  }

  private drawBackground(layout: RunnerLayout) {
    const g = this.background
    const travel = this.distance * 0.48
    const speed = this.currentSpeed()
    const pulse = 0.5 + Math.sin(this.elapsedMs * 0.006) * 0.5

    this.positionBackgroundArt(layout)
    g.clear()
    g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.ink, alpha: this.backgroundTexture ? 0.2 : 1 })
    g.rect(0, layout.ceilingY, layout.width, layout.floorY - layout.ceilingY).fill({
      color: GAME_COLORS.night,
      alpha: this.backgroundTexture ? 0.28 : 0.82,
    })

    for (let x = -80 + (travel % 80); x < layout.width + 90; x += 80) {
      const alpha = x % 160 === 0 ? 0.12 : 0.045
      g.moveTo(x, layout.ceilingY).lineTo(x - 110, layout.floorY).stroke({ color: GAME_COLORS.rankViolet, alpha, width: 1 })
    }

    for (let y = layout.ceilingY; y <= layout.floorY + 80; y += 42) {
      const offset = (travel * (0.3 + y / layout.height)) % 64
      g.moveTo(-offset, y).lineTo(layout.width, y + Math.sin(this.elapsedMs * 0.001 + y) * 4).stroke({
        color: y > layout.floorY ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue,
        alpha: y > layout.floorY ? 0.16 : 0.048,
        width: 1,
      })
    }

    for (let gate = -240 + ((travel * 1.12) % 240); gate < layout.width + 260; gate += 240) {
      const cy = layout.horizonY + Math.sin((gate + travel) * 0.005) * 16
      const gateW = 118
      const gateH = 80
      const alpha = 0.055 + pulse * 0.028 + this.flow / 2400
      g.poly([gate, cy - gateH, gate + gateW * 0.5, cy, gate, cy + gateH, gate - gateW * 0.5, cy], true).stroke({
        color: GAME_COLORS.rankViolet,
        alpha,
        width: 1.1,
      })
      g.poly([gate, cy - gateH * 0.58, gate + gateW * 0.28, cy, gate, cy + gateH * 0.58, gate - gateW * 0.28, cy], true).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: alpha * 0.85,
        width: 1,
      })
    }

    const floorGlow = this.summonTimer > 0 ? GAME_COLORS.lime : this.portalFlash > 0 ? GAME_COLORS.gateBlue : GAME_COLORS.rankViolet
    g.rect(0, layout.floorY - 2, layout.width, 5).fill({ color: floorGlow, alpha: 0.5 + pulse * 0.18 })
    g.rect(0, layout.floorY + 4, layout.width, layout.height - layout.floorY).fill({
      color: GAME_COLORS.wall,
      alpha: this.backgroundTexture ? 0.38 : 0.94,
    })
    g.rect(0, layout.floorY + 8, layout.width, 2).fill({ color: GAME_COLORS.rankViolet, alpha: 0.28 + this.flow / 500 })
    g.rect(0, layout.ceilingY - 2, layout.width, 2).fill({ color: GAME_COLORS.gateBlue, alpha: 0.22 })

    const streaks = Math.floor(6 + speed / 88)
    for (let i = 0; i < streaks; i += 1) {
      const y = layout.ceilingY + fract(Math.sin(i * 81.41 + Math.floor(travel / 120)) * 9871.4) * (layout.floorY - layout.ceilingY)
      const x = (layout.width - ((this.elapsedMs * (0.18 + i * 0.018) + i * 137) % (layout.width + 140))) + 70
      g.moveTo(x, y).lineTo(x - 58, y + 2).stroke({ color: GAME_COLORS.white, alpha: 0.045 + this.flow / 4000, width: 1 })
    }

    if (this.portalFlash > 0) {
      g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.gateBlue, alpha: this.portalFlash * 0.1 })
    }
    if (this.summonTimer > 0) {
      g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.rankViolet, alpha: 0.035 + pulse * 0.025 })
    }
  }

  private positionBackgroundArt(layout: RunnerLayout) {
    const texture = this.backgroundTexture
    if (!texture || this.backgroundSprites.length === 0) return

    const scale = Math.max(layout.width / texture.width, layout.height / texture.height)
    const spriteWidth = texture.width * scale
    const offset = -((this.distance * 0.08) % spriteWidth)
    const y = Math.min(0, layout.height - texture.height * scale)

    this.backgroundArtLayer.visible = true
    this.backgroundSprites.forEach((sprite, index) => {
      sprite.texture = texture
      sprite.scale.set(scale)
      sprite.position.set(offset + index * spriteWidth, y)
      sprite.alpha = 0.88
    })
  }

  private drawSummon(layout: RunnerLayout) {
    const g = this.summonArt
    g.clear()

    if (this.guardianTimer <= 0) {
      this.guardianLayer.visible = false
      this.summonSprite.visible = false
      return
    }

    const pos = this.playerPosition(layout)
    const age = SUMMON_SECONDS - this.guardianTimer
    const fadeIn = clamp(age / 0.22, 0, 1)
    const fadeOut = clamp(this.guardianTimer / 0.42, 0, 1)
    const alpha = Math.min(fadeIn, fadeOut)
    const pulse = 0.5 + Math.sin(this.elapsedMs * 0.021) * 0.5
    const strikePose = this.guardianStrikeClock < 0.11
    const motion: GuardianMotion = age < 0.42 ? 'emerge' : strikePose ? 'attack' : 'guard'
    const fallbackIndex = motion === 'emerge' ? 0 : motion === 'attack' ? 2 : 1
    const frames = this.guardianMotionTextures[motion] ?? []
    const frameRate = motion === 'attack' ? 48 : motion === 'emerge' ? 68 : 78
    const texture = frames.length > 0 ? frames[Math.floor(this.elapsedMs / frameRate) % frames.length] : this.summonTextures[fallbackIndex]

    this.guardianLayer.visible = true
    if (texture) {
      const targetHeight = motion === 'emerge' ? 188 : motion === 'attack' ? 154 : 142
      const scale = (targetHeight + pulse * 5) / texture.height
      const breath = Math.sin(this.elapsedMs * 0.014)
      this.summonSprite.visible = true
      this.summonSprite.texture = texture
      this.summonSprite.alpha = alpha * (motion === 'attack' ? 0.96 : 0.84)
      this.summonSprite.anchor.set(motion === 'attack' ? 0.34 : motion === 'emerge' ? 0.5 : 0.45, motion === 'emerge' ? 0.82 : 0.66)
      this.summonSprite.position.set(
        motion === 'attack' ? pos.x + 188 : motion === 'emerge' ? pos.x + 76 : pos.x + 82,
        motion === 'emerge' ? layout.floorY + 8 : pos.y - 36 + Math.sin(this.elapsedMs * 0.008) * 4,
      )
      this.summonSprite.rotation = motion === 'attack' ? -0.025 : Math.sin(this.elapsedMs * 0.006) * 0.035
      this.summonSprite.skew.set(motion === 'attack' ? -0.035 : breath * 0.018, 0)
      this.summonSprite.scale.set(scale * (1 + breath * 0.015), scale * (1 - breath * 0.01))
    } else {
      this.summonSprite.visible = false
    }

    const shieldAlpha = alpha * (0.34 + pulse * 0.12)
    const shieldColor = strikePose ? GAME_COLORS.lime : GAME_COLORS.rankViolet
    g.ellipse(pos.x + 4, pos.y - 36, 42 + pulse * 4, 58 + pulse * 5).stroke({
      color: GAME_COLORS.gateBlue,
      alpha: shieldAlpha,
      width: 2,
    })
    g.poly([pos.x + 4, pos.y - 110, pos.x + 54, pos.y - 38, pos.x + 2, pos.y + 32, pos.x - 48, pos.y - 36], true).stroke({
      color: shieldColor,
      alpha: alpha * 0.42,
      width: 1.4,
    })
    g.poly([pos.x + 4, pos.y - 80, pos.x + 33, pos.y - 36, pos.x + 2, pos.y + 8, pos.x - 26, pos.y - 36], true).stroke({
      color: GAME_COLORS.gateBlue,
      alpha: alpha * 0.34,
      width: 1,
    })
    for (let i = 0; i < 6; i += 1) {
      const angle = this.elapsedMs * 0.0024 + i * (Math.PI / 3)
      const rx = 49 + Math.sin(this.elapsedMs * 0.006 + i) * 4
      const x = pos.x + Math.cos(angle) * rx
      const y = pos.y - 36 + Math.sin(angle) * 34
      const s = 4 + pulse * 1.8
      g.poly([x, y - s, x + s, y, x, y + s, x - s, y], true).fill({
        color: i % 2 === 0 ? GAME_COLORS.gateBlue : GAME_COLORS.rankViolet,
        alpha: alpha * 0.36,
      })
    }

    if (age < 0.48) {
      const ring = clamp(age / 0.48, 0, 1)
      g.ellipse(pos.x + 66, layout.floorY + 2, 56 + ring * 46, 12 + ring * 10).stroke({
        color: GAME_COLORS.rankViolet,
        alpha: alpha * (0.72 - ring * 0.34),
        width: 2,
      })
      g.ellipse(pos.x + 66, layout.floorY - 2, 34 + ring * 26, 6 + ring * 8).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: alpha * 0.56,
        width: 1.2,
      })
    }

    if (strikePose) {
      const reach = 180 + pulse * 32
      g.poly([pos.x + 90, pos.y - 54, pos.x + reach, pos.y - 68, pos.x + reach + 68, pos.y - 42, pos.x + 92, pos.y - 24], true).fill({
        color: GAME_COLORS.rankViolet,
        alpha: alpha * 0.18,
      })
      g.moveTo(pos.x + 92, pos.y - 38).lineTo(pos.x + reach + 78, pos.y - 56).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: alpha * 0.62,
        width: 2,
      })
    }
  }

  private drawPlayer(layout: RunnerLayout) {
    const pos = this.playerPosition(layout)
    const motion = this.playerMotionKey()
    const motionFrames = this.playerMotionTextures[motion]
    const hasMotionFrames = Boolean(motionFrames && motionFrames.length > 0)
    const frames = hasMotionFrames ? motionFrames : this.playerTextures
    const frameIndex = hasMotionFrames ? this.playerFrameIndex(motion, frames?.length ?? 1) : this.legacyPlayerFrameIndex()
    const phase = frameIndex / Math.max(1, (frames?.length ?? 1) - 1)
    const stride = Math.sin(phase * Math.PI * 2)
    const cleanGlow = this.summonTimer > 0 ? 1 : this.attackTimer > 0 ? 0.8 : this.speedKick
    const shimmer = 0.5 + Math.sin(this.elapsedMs * 0.018) * 0.5
    const jumpLean = clamp(this.velocityY / 1260, -0.18, 0.18)
    const groundedLean = motion === 'run' ? stride * 0.018 : motion === 'attack' ? -0.035 : motion === 'summon' ? 0.025 : 0
    const bodyPulse = motion === 'run' ? Math.sin(this.elapsedMs * 0.04) * 0.007 : motion === 'idle' ? Math.sin(this.elapsedMs * 0.012) * 0.004 : 0

    this.player.position.set(pos.x, pos.y)
    this.player.rotation = this.jumpsUsed > 0 ? jumpLean : groundedLean
    this.player.scale.set(1 + bodyPulse, 1 - bodyPulse * 0.45)

    const g = this.playerArt
    g.clear()

    if (frames && frames.length > 0) {
      const texture = frames[frameIndex % frames.length] ?? frames[0]
      const previousTexture = this.playerSprite.texture
      const textureKey = hasMotionFrames ? `${motion}:${frameIndex}` : `legacy:${frameIndex}`
      const bob =
        motion === 'run'
          ? Math.sin(this.elapsedMs * 0.038) * 2.4
          : motion === 'idle'
            ? Math.sin(this.elapsedMs * 0.012) * 1.2
            : motion === 'summon'
              ? Math.sin(this.elapsedMs * 0.018) * 1.8
              : 0
      this.playerSprite.visible = true
      if (this.playerTextureKey !== textureKey && previousTexture) {
        this.playerGhostSprite.texture = previousTexture
        this.playerGhostSprite.visible = true
        this.playerGhostSprite.alpha = 0.08
        this.frameBlend = 0
      }
      this.playerFrame = frameIndex
      this.playerTextureKey = textureKey
      this.playerSprite.texture = texture
      this.frameBlend = Math.min(1, this.frameBlend + (motion === 'run' ? 0.74 : 0.62))

      const anchorY = motion === 'jump' || motion === 'fall' ? 0.78 : motion === 'attack' || motion === 'summon' ? 0.8 : 0.82
      const spriteX = motion === 'run' ? stride * 2.8 : motion === 'attack' ? 6 : motion === 'summon' ? 2 : motion === 'fall' ? 1 : 0
      const spriteY = 8 + bob + (motion === 'jump' ? 3 : motion === 'fall' ? 2 : 0)
      this.playerSprite.anchor.set(0.44, anchorY)
      this.playerGhostSprite.anchor.set(0.44, anchorY)
      this.playerSprite.position.set(spriteX, spriteY)
      this.playerGhostSprite.position.copyFrom(this.playerSprite.position)

      const baseHeight = PLAYER_MOTION_HEIGHTS[motion] ?? 80
      const spriteScale = (baseHeight + this.evolution * 0.85 + cleanGlow * 4.5) / texture.height
      const squash = motion === 'run' ? Math.abs(stride) * 0.018 : motion === 'summon' ? Math.sin(this.elapsedMs * 0.02) * 0.02 : 0
      const scaleX = motion === 'attack' ? 1.045 : motion === 'fall' ? 0.985 : 1 + squash
      const scaleY = motion === 'jump' ? 1.025 : motion === 'attack' ? 0.985 : 1 - squash * 0.62
      const skewX = motion === 'run' ? stride * 0.034 : motion === 'attack' ? -0.035 : motion === 'summon' ? 0.018 : 0
      this.playerSprite.scale.set(spriteScale * scaleX, spriteScale * scaleY)
      this.playerGhostSprite.scale.set(spriteScale * scaleX, spriteScale * scaleY)
      this.playerSprite.skew.set(skewX, 0)
      this.playerGhostSprite.skew.set(skewX, 0)
      this.playerGhostSprite.alpha = Math.max(0, 0.06 * (1 - this.frameBlend))
      if (this.frameBlend >= 1) this.playerGhostSprite.visible = false

      g.poly([14 + stride * 2, -84, 58, -20, 12, 34, -26, -18], true).stroke({
        color: GAME_COLORS.rankViolet,
        alpha: 0.13 + this.flow / 520,
        width: 1.2,
      })
      g.poly([18 + stride, -62, 43, -15, 14, 27, -11, -13], true).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: 0.12 + this.flow / 680,
        width: 1,
      })
      if (this.summonTimer > 0 || this.attackTimer > 0) {
        g.poly([28, -48 - shimmer * 7, 94, -22, 96, -6, 26, 12], true).fill({
          color: this.summonTimer > 0 ? GAME_COLORS.lime : GAME_COLORS.rankViolet,
          alpha: 0.16 + cleanGlow * 0.18,
        })
      }
      g.ellipse(14, 18, 28, 3.4).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
      return
    }

    this.playerSprite.visible = false
    g.poly([-8, -60, 22, -70, 48, -25, 34, 18, -6, 20, -24, -18], true).fill({ color: GAME_COLORS.abyss, alpha: 0.96 })
    g.poly([20, -52, 60, -36, 58, -26, 18, -38], true).fill({ color: GAME_COLORS.coral, alpha: 0.94 })
    g.rect(40, -31, 44, 2).fill({ color: GAME_COLORS.white, alpha: 0.9 })
    g.ellipse(14, 20, 24, 3).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
  }

  private spawnOpeningDomain() {
    for (let i = 0; i < 7; i += 1) {
      this.addEntity('coin', 320 + i * 72, 0, -118 - Math.sin(i * 0.9) * 44, 18, 18, 9, 1, 0, 0)
    }
  }

  private spawnAhead(layout: RunnerLayout) {
    const visibleAhead = layout.width + 920
    while (this.nextSpawnX < this.distance + visibleAhead) {
      const difficulty = Math.min(1, this.distance / 11000)
      const x = this.nextSpawnX

      if (x < 1500) {
        this.addCoinArc(x, -116 - this.random() * 72, 6)
        this.nextSpawnX += 310 + this.random() * 130
        continue
      }

      if (x < 2300) {
        this.addCoinArc(x, -124 - this.random() * 92, 7)
        this.nextSpawnX += 360 + this.random() * 160
        continue
      }

      if (this.distance > 650 && x >= this.nextPortalX) {
        this.addEntity('portal', x + 70, 0, -138 - this.random() * 36, 72, 108, 36, 0, 0, 0)
        this.addCoinArc(x + 188, -164, 4)
        this.nextPortalX = x + 2300 + this.random() * 1700
        this.nextSpawnX += 380 + this.random() * 160
        continue
      }

      const pattern = Math.floor(this.random() * 9)
      if (pattern === 0) {
        this.addEntity('spike', x, 0, 0, 42, 34, 18, 0, 0, 0)
        this.addCoinArc(x + 90, -126, 5)
      } else if (pattern === 1) {
        const gapY = clamp(layout.floorY - 178 - this.random() * 72, layout.ceilingY + 112, layout.floorY - 108)
        this.addEntity('wall', x, 0, 0, 34, layout.floorY - layout.ceilingY, 0, 0, gapY, 172)
        this.addCoinArc(x + 74, -194, 4)
      } else if (pattern === 2) {
        this.addEntity('enemy', x + 38, 0, 0, 58, 62, 24, 0, 0, 0)
        this.addCoinArc(x + 150, -142, 5)
      } else if (pattern === 3) {
        this.addEntity('orb', x + 34, 0, -136 - this.random() * 76, 36, 36, 18, 0, 0, 0)
        this.addCoinArc(x + 128, -105 - this.random() * 52, 4)
      } else if (pattern === 4) {
        this.addEntity('spike', x + 24, 0, 0, 42, 34, 18, 0, 0, 0)
        this.addEntity('orb', x + 190, 0, -186, 36, 36, 18, 0, 0, 0)
        this.addCoinArc(x + 98, -158, 3)
      } else if (pattern === 5) {
        this.addEntity('enemy', x + 26, 0, 0, 58, 62, 24, 0, 0, 0)
        this.addCoinArc(x + 128, -214, 4)
      } else if (pattern === 6) {
        this.addCoinArc(x, -116 - this.random() * 106, 7)
      } else if (pattern === 7) {
        this.addEntity('spike', x + 64, 0, 0, 42, 34, 18, 0, 0, 0)
        this.addCoinArc(x + 10, -198, 5)
      } else {
        this.addCoinArc(x, -112 - this.random() * 96, 6)
      }

      this.nextSpawnX += 330 - difficulty * 58 + this.random() * (230 - difficulty * 50)
    }
  }

  private addCoinArc(startX: number, yOffset: number, count: number) {
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0 : i / (count - 1)
      const arc = Math.sin(t * Math.PI) * 62
      this.addEntity('coin', startX + i * 36, 0, yOffset - arc, 16, 16, 8, 1, 0, 0)
    }
  }

  private addEntity(
    kind: EntityKind,
    worldX: number,
    _y: number,
    yOffset: number,
    width: number,
    height: number,
    radius: number,
    value: number,
    gapY: number,
    gapHeight: number,
  ) {
    const textureKey = this.textureKeyFor(kind)
    const { container, graphic, sprite } = this.createEntityGraphic(kind, width, height, gapHeight, textureKey)
    const entity: GameEntity = {
      id: this.entityId,
      kind,
      textureKey,
      worldX,
      y: yOffset,
      width,
      height,
      radius,
      value,
      gapY,
      gapHeight,
      container,
      graphic,
      sprite,
      spin: (this.random() > 0.5 ? 1 : -1) * (2.2 + this.random() * 2.6),
      wobble: this.random() * Math.PI * 2,
    }
    this.entityId += 1

    if (kind === 'coin' || kind === 'portal') this.pickupLayer.addChild(container)
    else this.hazardLayer.addChild(container)
    this.entities.push(entity)
  }

  private textureKeyFor(kind: EntityKind): DomainTextureKey | undefined {
    if (kind === 'coin') return 'coin'
    if (kind === 'spike') return 'spike'
    if (kind === 'orb') return 'orb'
    if (kind === 'wall') return 'block'
    if (kind === 'portal') return 'portal'
    if (kind === 'enemy') return this.random() > 0.52 ? 'wraith' : 'crawler'
    return undefined
  }

  private createEntityGraphic(kind: EntityKind, width: number, height: number, gapHeight: number, textureKey?: DomainTextureKey) {
    const container = new Container()
    const g = new Graphics()
    const sprite = this.createEntitySprite(kind, width, height, textureKey)
    if (sprite) container.addChild(sprite)
    container.addChild(g)

    if (kind === 'coin') {
      g.poly([0, -10, 10, 0, 0, 10, -10, 0], true).fill({ color: GAME_COLORS.amber, alpha: sprite ? 0.18 : 1 })
      g.poly([0, -5, 5, 0, 0, 5, -5, 0], true).stroke({ color: GAME_COLORS.white, alpha: 0.86, width: 1.1 })
      g.circle(0, 0, 2).fill({ color: GAME_COLORS.rankViolet, alpha: 0.68 })
    }

    if (kind === 'spike') {
      g.poly([-22, 16, -10, -18, 0, 14, 11, -20, 23, 16], true).fill({ color: GAME_COLORS.coral, alpha: sprite ? 0.14 : 0.96 })
      g.poly([-22, 16, -10, -18, 0, 14, 11, -20, 23, 16], true).stroke({ color: GAME_COLORS.white, alpha: 0.72, width: 1.2 })
    }

    if (kind === 'orb') {
      g.circle(0, 0, 20).stroke({ color: GAME_COLORS.rankViolet, alpha: 0.9, width: 2 })
      g.poly([0, -18, 16, 0, 0, 18, -16, 0], true).fill({ color: GAME_COLORS.gateBlue, alpha: 0.34 })
      g.circle(0, 0, 5).fill({ color: GAME_COLORS.white, alpha: 0.72 })
    }

    if (kind === 'enemy') {
      g.ellipse(0, 16, 26, 8).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
      if (!sprite) {
        g.poly([-16, 16, -6, -30, 16, -20, 22, 18, 0, 30], true).fill({ color: 0x130a1f, alpha: 0.98 })
        g.poly([-6, -25, 24, -45, 11, -13], true).fill({ color: GAME_COLORS.rankViolet, alpha: 0.84 })
        g.circle(7, -15, 3).fill({ color: GAME_COLORS.coral, alpha: 0.9 })
        g.rect(14, -4, 32, 2).fill({ color: GAME_COLORS.white, alpha: 0.72 })
      }
    }

    if (kind === 'portal') {
      g.ellipse(0, 0, width * 0.49, height * 0.5).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.86, width: 2 })
      g.ellipse(0, 0, width * 0.34, height * 0.38).stroke({ color: GAME_COLORS.rankViolet, alpha: 0.7, width: 1.4 })
      g.poly([0, -height * 0.36, width * 0.22, 0, 0, height * 0.36, -width * 0.22, 0], true).fill({
        color: GAME_COLORS.rankViolet,
        alpha: 0.17,
      })
    }

    if (kind === 'wall') {
      const halfW = width * 0.5
      const gap = Math.max(80, gapHeight)
      g.rect(-halfW, -height * 0.5, width, height * 0.5 - gap * 0.5).fill({ color: GAME_COLORS.rankViolet, alpha: 0.5 })
      g.rect(-halfW, gap * 0.5, width, height * 0.5 - gap * 0.5).fill({ color: GAME_COLORS.gateBlue, alpha: 0.36 })
      g.rect(-halfW - 5, -height * 0.5, 5, height).fill({ color: GAME_COLORS.white, alpha: 0.14 })
      g.rect(halfW, -height * 0.5, 5, height).fill({ color: GAME_COLORS.white, alpha: 0.14 })
      g.rect(-halfW - 2, -gap * 0.5 - 4, width + 4, 4).fill({ color: GAME_COLORS.rankViolet, alpha: 0.72 })
      g.rect(-halfW - 2, gap * 0.5, width + 4, 4).fill({ color: GAME_COLORS.gateBlue, alpha: 0.62 })
    }

    return { container, graphic: g, sprite }
  }

  private createEntitySprite(kind: EntityKind, _width: number, height: number, textureKey?: DomainTextureKey) {
    if (!textureKey) return undefined
    const texture = this.domainTextures[textureKey]
    if (!texture) return undefined

    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)

    const target =
      kind === 'coin'
        ? { width: 24, height: 24 }
        : kind === 'spike'
          ? { width: 48, height: 52 }
          : kind === 'orb'
            ? { width: 46, height: 46 }
            : kind === 'enemy'
              ? { width: textureKey === 'wraith' ? 66 : 62, height: textureKey === 'wraith' ? 78 : 54 }
              : kind === 'portal'
                ? { width: 82, height: 116 }
                : { width: 48, height: Math.max(86, height * 0.42) }

    const scale = Math.min(target.width / texture.width, target.height / texture.height)
    sprite.scale.set(scale)
    if (kind === 'spike') sprite.position.y = 2
    if (kind === 'enemy') sprite.position.y = textureKey === 'crawler' ? -2 : -8
    if (kind === 'wall') sprite.alpha = 0.3
    return sprite
  }

  private destroyEntity(entity: GameEntity) {
    entity.container.destroy({ children: true })
  }

  private updateEntities(dt: number, layout: RunnerLayout) {
    for (const entity of this.entities) {
      entity.container.rotation += entity.kind === 'coin' || entity.kind === 'orb' ? entity.spin * dt : 0
      if (entity.kind === 'portal') {
        entity.graphic.rotation -= dt * 0.65
      }
      if (entity.kind === 'enemy') entity.container.rotation = Math.sin(this.elapsedMs * 0.006 + entity.wobble) * 0.025
      if (entity.kind === 'coin' || entity.kind === 'orb') {
        entity.y += Math.sin(this.elapsedMs * 0.006 + entity.wobble) * dt * 5
      }
    }

    const keep: GameEntity[] = []
    for (const entity of this.entities) {
      if (this.screenXFor(entity, layout) > -180) keep.push(entity)
      else this.destroyEntity(entity)
    }
    this.entities = keep
  }

  private positionEntities(layout: RunnerLayout) {
    for (const entity of this.entities) {
      const x = this.screenXFor(entity, layout)
      const y = this.entityY(entity, layout)
      const phase = this.elapsedMs * 0.006 + entity.wobble
      const pulse = 1 + Math.sin(phase) * 0.06
      entity.container.position.set(x, y)
      entity.container.visible = x > -180 && x < layout.width + 220
      let scaleX = 1
      let scaleY = 1
      if (entity.kind === 'coin') {
        scaleX = 0.72 + Math.abs(Math.sin(phase * 1.8)) * 0.32
        scaleY = 1.04 + Math.cos(phase * 1.8) * 0.05
      } else if (entity.kind === 'portal') {
        scaleX = pulse * (1 + Math.sin(phase * 0.72) * 0.035)
        scaleY = pulse * (1 + Math.cos(phase * 0.82) * 0.028)
      } else if (entity.kind === 'enemy') {
        scaleX = 1 + Math.sin(phase * 1.35) * 0.03
        scaleY = 1 - Math.sin(phase * 1.35) * 0.018
      } else if (entity.kind === 'orb') {
        scaleX = 1 + Math.sin(phase * 1.4) * 0.045
        scaleY = 1 + Math.cos(phase * 1.4) * 0.045
      } else if (entity.kind === 'spike') {
        scaleY = 1 + Math.sin(phase * 1.1) * 0.018
      }
      entity.container.scale.set(scaleX, scaleY)
      if (entity.sprite) {
        entity.sprite.skew.set(entity.kind === 'enemy' ? Math.sin(phase) * 0.025 : entity.kind === 'portal' ? Math.sin(phase * 1.2) * 0.018 : 0, 0)
      }
    }
  }

  private checkCollisions(layout: RunnerLayout) {
    const player = this.playerPosition(layout)
    const keep: GameEntity[] = []

    for (const entity of this.entities) {
      const x = this.screenXFor(entity, layout)
      const y = this.entityY(entity, layout)
      const dx = player.x - x
      const dy = player.y - y
      const attacking = this.attackTimer > 0 || this.summonTimer > 0

      if (entity.kind === 'coin' && Math.hypot(dx, dy) <= entity.radius + PLAYER_RADIUS * 1.5) {
        this.collectEntity(entity, GAME_COLORS.amber, 1.2)
        continue
      }

      if (entity.kind === 'portal' && Math.hypot(dx, dy) <= entity.radius + PLAYER_RADIUS * 1.9) {
        this.distance += 70
        this.flow = clamp(this.flow + 12, 0, 100)
        this.aura = clamp(this.aura + 14, 0, AURA_MAX)
        this.speedKick = Math.min(0.44, this.speedKick + 0.12)
        this.summonTimer = Math.max(this.summonTimer, 0.72)
        this.portalFlash = 1
        this.callbacks.onPortal?.()
        this.spawnBurst(x, y, GAME_COLORS.gateBlue, 22, 1.15)
        this.destroyEntity(entity)
        continue
      }

      if (entity.kind === 'enemy' && Math.abs(dx) < 36 && Math.abs(dy) < 48) {
        if (attacking || this.velocityY > 190) {
          this.killEnemy(entity, x, y)
          continue
        }
        this.finishRun()
      }

      if (entity.kind === 'spike' && Math.abs(dx) < 28 && player.y > layout.floorY - 34) {
        if (attacking) {
          this.killThreat(entity, x, y)
          continue
        }
        this.finishRun()
      }

      if (entity.kind === 'orb' && Math.hypot(dx, dy) < entity.radius + PLAYER_RADIUS * 0.86) {
        if (attacking) {
          this.killThreat(entity, x, y)
          continue
        }
        this.finishRun()
      }

      if (entity.kind === 'wall' && Math.abs(dx) < entity.width * 0.5 + PLAYER_RADIUS * 0.72) {
        const gapTop = entity.gapY - entity.gapHeight * 0.5
        const gapBottom = entity.gapY + entity.gapHeight * 0.5
        if (player.y < gapTop + 12 || player.y > gapBottom - 12) this.finishRun()
        else this.flow = clamp(this.flow + 0.35, 0, 100)
      }

      keep.push(entity)
    }

    this.entities = keep
  }

  private collectEntity(entity: GameEntity, color: number, force: number) {
    this.coins += entity.value
    this.aura = clamp(this.aura + 7 + this.evolution, 0, AURA_MAX)
    this.flow = clamp(this.flow + 2, 0, 100)
    this.spawnBurst(entity.container.x, entity.container.y, color, 6, force)
    this.destroyEntity(entity)
    this.callbacks.onCoin?.(entity.value)
  }

  private killEnemy(entity: GameEntity, x: number, y: number) {
    this.coins += 2
    this.aura = clamp(this.aura + 18, 0, AURA_MAX)
    this.flow = clamp(this.flow + 10, 0, 100)
    this.combo = Math.min(18, this.combo + 2)
    this.speedKick = Math.min(0.62, this.speedKick + 0.18)
    this.callbacks.onStrike?.()
    this.spawnSlash(x + 22, y - 16, GAME_COLORS.rankViolet, 1)
    this.spawnBurst(x, y, GAME_COLORS.coral, 18, 1.2)
    this.destroyEntity(entity)
  }

  private killThreat(entity: GameEntity, x: number, y: number) {
    this.aura = clamp(this.aura + 10, 0, AURA_MAX)
    this.flow = clamp(this.flow + 6, 0, 100)
    this.callbacks.onStrike?.()
    this.spawnBurst(x, y, GAME_COLORS.gateBlue, 12, 1)
    this.destroyEntity(entity)
  }

  private guardianSweep(layout: RunnerLayout) {
    const pos = this.playerPosition(layout)
    const minX = layout.playerX - 40
    const maxX = layout.playerX + 920
    const keep: GameEntity[] = []
    let hits = 0

    for (const entity of this.entities) {
      const x = entity.container.x
      if (this.isThreat(entity, true) && x > minX && x < maxX) {
        const y = entity.kind === 'wall' ? layout.floorY - 78 : entity.container.y
        this.spawnGuardianHit(x, y, hits)
        this.destroyEntity(entity)
        this.aura = clamp(this.aura + (entity.kind === 'enemy' ? 5 : 2), 0, AURA_MAX)
        this.flow = clamp(this.flow + 1.4, 0, 100)
        hits += 1
      } else {
        keep.push(entity)
      }
    }

    if (hits > 0) {
      this.spawnSlash(pos.x + 112, pos.y - 44, GAME_COLORS.rankViolet, 1.45)
      this.callbacks.onStrike?.()
    }
    this.entities = keep
  }

  private spawnGuardianHit(x: number, y: number, index: number) {
    this.spawnBurst(x, y, index % 2 === 0 ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue, 18, 1.28)
    const graphic = new Graphics()
    const size = 36 + index * 3
    graphic.poly([0, -size, size * 0.8, 0, 0, size, -size * 0.8, 0], true).stroke({
      color: index % 2 === 0 ? GAME_COLORS.gateBlue : GAME_COLORS.rankViolet,
      alpha: 0.82,
      width: 1.7,
    })
    graphic.poly([-size * 0.9, -5, size * 1.3, -16, size * 1.8, 0, size * 1.1, 16, -size, 6], true).fill({
      color: GAME_COLORS.rankViolet,
      alpha: 0.24,
    })
    const particle: Particle = {
      graphic,
      x,
      y,
      vx: 26,
      vy: -10,
      life: 0.22,
      maxLife: 0.22,
      drag: 2.8,
    }
    this.particleLayer.addChild(graphic)
    this.particles.push(particle)
  }

  private spawnGuardianRift(x: number, y: number) {
    const graphic = new Graphics()
    graphic.ellipse(0, 8, 82, 14).stroke({ color: GAME_COLORS.rankViolet, alpha: 0.76, width: 2 })
    graphic.ellipse(0, 5, 54, 8).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.62, width: 1.4 })
    graphic.poly([0, -58, 56, 0, 0, 54, -56, 0], true).stroke({ color: GAME_COLORS.rankViolet, alpha: 0.5, width: 1.2 })
    const particle: Particle = {
      graphic,
      x,
      y,
      vx: -18,
      vy: -8,
      life: 0.48,
      maxLife: 0.48,
      drag: 2,
    }
    this.particleLayer.addChild(graphic)
    this.particles.push(particle)
  }

  private clearThreats(maxX: number, forceVisual: boolean, includeWalls = false) {
    const keep: GameEntity[] = []
    for (const entity of this.entities) {
      if (this.isThreat(entity, includeWalls) && entity.container.x < maxX) {
        if (forceVisual || this.random() > 0.28) this.spawnBurst(entity.container.x, entity.container.y, GAME_COLORS.rankViolet, 10, 1)
        this.destroyEntity(entity)
        this.aura = clamp(this.aura + 2, 0, AURA_MAX)
      } else {
        keep.push(entity)
      }
    }
    this.entities = keep
  }

  private isThreat(entity: GameEntity, includeWalls = false) {
    return entity.kind === 'enemy' || entity.kind === 'spike' || entity.kind === 'orb' || (includeWalls && entity.kind === 'wall')
  }

  private finishRun() {
    if (this.phase !== 'running' || this.summonTimer > 0) return
    this.phase = 'gameover'
    this.shake = 2.5
    this.callbacks.onPhaseChange?.(this.phase)
    this.callbacks.onCrash?.()
    const result: RunResult = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.floor(this.random() * 99999)}`,
      distance: Math.floor(this.distance * WORLD_SCALE),
      coins: this.coins,
      durationMs: Math.floor(this.elapsedMs),
      peakSpeed: Math.floor(this.peakSpeed * WORLD_SCALE),
      createdAt: new Date().toISOString(),
    }
    this.callbacks.onRunComplete?.(result)
    this.emitStats(true)
  }

  private updateParticles(dt: number) {
    const keep: Particle[] = []
    for (const particle of this.particles) {
      particle.life -= dt
      particle.vx *= 1 - particle.drag * dt
      particle.vy *= 1 - particle.drag * dt
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.vy += 72 * dt
      particle.graphic.position.set(particle.x, particle.y)
      particle.graphic.alpha = Math.max(0, particle.life / particle.maxLife)

      if (particle.life > 0) keep.push(particle)
      else particle.graphic.destroy()
    }
    this.particles = keep
  }

  private spawnSpeedTrail(dt: number) {
    this.trailClock += dt
    if (this.trailClock < 0.035 || this.phase !== 'running') return
    this.trailClock = 0
    const pos = this.playerPosition()
    const color = this.summonTimer > 0 ? GAME_COLORS.lime : this.flow > 58 ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue
    const size = 18 + this.flow / 5 + this.speedKick * 80
    const graphic = new Graphics().poly([0, -2, -size, -4, -size - 18, 0, -size, 4, 0, 2], true).fill({ color, alpha: 0.34 })
    const particle: Particle = {
      graphic,
      x: pos.x - 14,
      y: pos.y - 36 + (this.random() - 0.5) * 18,
      vx: -180 - this.flow * 2,
      vy: -18 - this.random() * 24,
      life: 0.18 + this.flow / 1000,
      maxLife: 0.26 + this.flow / 900,
      drag: 3.2,
    }
    this.particleLayer.addChild(graphic)
    this.particles.push(particle)
  }

  private spawnSlash(x: number, y: number, color: number, quality: number) {
    const length = 54 + quality * 66
    const graphic = new Container()
    const slashTexture = this.domainTextures.slash
    if (slashTexture) {
      const sprite = new Sprite(slashTexture)
      sprite.anchor.set(0.45, 0.5)
      sprite.scale.set(Math.min((length * 0.9) / slashTexture.width, 54 / slashTexture.height))
      sprite.alpha = 0.72
      graphic.addChild(sprite)
    }
    graphic.addChild(
      new Graphics()
        .poly([-length * 0.08, -5, length * 0.72, -12, length, -1, length * 0.72, 10, -length * 0.12, 5], true)
        .fill({ color, alpha: slashTexture ? 0.28 : 0.64 }),
    )
    graphic.rotation = -0.12
    const particle: Particle = {
      graphic,
      x,
      y,
      vx: 64,
      vy: -24,
      life: 0.18,
      maxLife: 0.18,
      drag: 4,
    }
    this.particleLayer.addChild(graphic)
    this.particles.push(particle)
  }

  private spawnBurst(x: number, y: number, color: number, count: number, force: number) {
    for (let i = 0; i < count; i += 1) {
      const angle = this.random() * Math.PI * 2
      const speed = (64 + this.random() * 180) * force
      const size = 1.5 + this.random() * 3.4
      const graphic = new Graphics().rect(-size / 2, -size / 2, size, size).fill({ color })
      const particle: Particle = {
        graphic,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.24 + this.random() * 0.26,
        maxLife: 0.52,
        drag: 2.2,
      }
      this.particleLayer.addChild(graphic)
      this.particles.push(particle)
    }
  }

  private emitStats(force = false) {
    if (!this.callbacks.onStats) return
    if (!force && this.elapsedMs - this.lastStatsAt < 80) return
    this.lastStatsAt = this.elapsedMs
    const stats: RunStats = {
      phase: this.phase,
      distance: Math.floor(this.distance * WORLD_SCALE),
      coins: this.coins,
      speed: Math.floor(this.currentSpeed() * WORLD_SCALE),
      peakSpeed: Math.floor(this.peakSpeed * WORLD_SCALE),
      flow: Math.round(this.flow),
      combo: Math.floor(this.combo),
      charge: Math.round(this.portalFlash * 100),
      aura: Math.round(this.aura),
      auraReady: this.aura >= AURA_MAX,
      evolution: this.evolution,
      invincible: this.summonTimer > 0,
      summonActive: this.guardianTimer > 0,
      jumps: Math.max(0, 2 - this.jumpsUsed),
      bestDistance: this.bestDistance,
      fps: Math.round(this.app.ticker.FPS || 0),
    }
    this.callbacks.onStats(stats)
  }

  private currentSpeed() {
    if (this.phase !== 'running') return BASE_SPEED * 0.18
    const intro = this.introTimer > 0 ? 1 - this.introTimer / INTRO_SECONDS : 1
    const introCurve = intro * intro
    const ramp = Math.min(MAX_SPEED, BASE_SPEED + this.distance * SPEED_RAMP)
    const flowBonus = 1 + this.flow / 640 + this.combo * 0.007 + this.speedKick + (this.evolution - 1) * 0.018
    return Math.min(MAX_SPEED * 1.18, ramp * flowBonus * (0.18 + introCurve * 0.82))
  }

  private playerFrameIndex() {
    if (this.phase !== 'running') return 0
    if (this.summonTimer > 0) return Math.floor(this.elapsedMs / 90) % 2 === 0 ? 8 : 9
    if (this.attackTimer > 0.08) return this.jumpsUsed > 1 ? 7 : 9
    if (this.jumpsUsed > 0) {
      if (this.velocityY < -120) return Math.floor(this.elapsedMs / 95) % 2 === 0 ? 3 : 4
      return Math.floor(this.elapsedMs / 95) % 2 === 0 ? 5 : 6
    }
    if (this.introTimer > 0.42) return Math.floor(this.elapsedMs / 120) % 2 === 0 ? 0 : 1
    return Math.floor(this.elapsedMs / 86) % 3 === 1 ? 2 : 1
  }

  private playerPosition(layout = this.layout()) {
    const intro = this.phase === 'running' && this.introTimer > 0 ? 1 - this.introTimer / INTRO_SECONDS : 1
    const dashOffset = this.phase === 'running' ? -80 * (1 - intro) + Math.sin(intro * Math.PI) * 18 : -16
    return {
      x: layout.playerX + dashOffset,
      y: this.playerY,
    }
  }

  private screenXFor(entity: GameEntity, layout: RunnerLayout) {
    return layout.playerX + (entity.worldX - this.distance)
  }

  private entityY(entity: GameEntity, layout: RunnerLayout) {
    if (entity.kind === 'spike') return layout.floorY - entity.height * 0.5
    if (entity.kind === 'enemy') return layout.floorY - entity.height * 0.5
    if (entity.kind === 'wall') return entity.gapY
    return layout.floorY + entity.y
  }

  private layout(): RunnerLayout {
    const { width, height } = this.app.screen
    const floorY = Math.round(height * (height < 520 ? 0.76 : 0.78))
    const ceilingY = Math.max(54, Math.round(height * 0.14))
    return {
      width,
      height,
      playerX: Math.round(Math.min(width * 0.25, 340)),
      floorY,
      ceilingY,
      horizonY: Math.round(ceilingY + (floorY - ceilingY) * 0.46),
    }
  }

  private random() {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0
    return this.rngState / 4294967296
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function fract(value: number) {
  return value - Math.floor(value)
}
