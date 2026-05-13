import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Ticker } from 'pixi.js'
import { BASE_SPEED, GAME_COLORS, MAX_SPEED, PLAYER_RADIUS, SPEED_RAMP, WORLD_SCALE } from './constants'
import type { GameCallbacks, GamePhase, RunResult, RunStats } from './types'

type EntityKind = 'coin' | 'spike' | 'orb' | 'wall' | 'portal' | 'enemy'

interface GameEntity {
  id: number
  kind: EntityKind
  worldX: number
  y: number
  width: number
  height: number
  radius: number
  value: number
  gapY: number
  gapHeight: number
  graphic: Graphics
  spin: number
  wobble: number
}

interface Particle {
  graphic: Graphics
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
  private background = new Graphics()
  private hazardLayer = new Container()
  private pickupLayer = new Container()
  private particleLayer = new Container()
  private player = new Container()
  private playerArt = new Graphics()
  private playerSprite = new Sprite()
  private playerTextures: Texture[] = []
  private entities: GameEntity[] = []
  private particles: Particle[] = []
  private entityId = 1
  private rngState = 1
  private distance = 0
  private coins = 0
  private elapsedMs = 0
  private peakSpeed = 0
  private nextSpawnX = 760
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

    this.app.canvas.className = 'game-canvas'
    this.host.appendChild(this.app.canvas)
    this.app.stage.addChild(this.background, this.hazardLayer, this.pickupLayer, this.particleLayer, this.player)
    this.playerSprite.visible = false
    this.player.addChild(this.playerArt, this.playerSprite)
    this.app.ticker.add(this.tick)
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown, { passive: true })
    window.addEventListener('keydown', this.handleKeyDown)
    this.initialized = true
    void this.loadPlayerSprites()
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
    this.flow = clamp(this.flow + 24, 0, 100)
    this.speedKick = Math.min(0.55, this.speedKick + 0.28)
    this.shake = 1.2
    this.callbacks.onSummon?.()
    const pos = this.playerPosition()
    this.spawnBurst(pos.x + 34, pos.y - 18, GAME_COLORS.rankViolet, 20, 1.25)
    this.spawnSlash(pos.x + 42, pos.y - 18, GAME_COLORS.gateBlue, 1)
    this.clearThreats(pos.x + 640, true)
    this.emitStats(true)
  }

  private async loadPlayerSprites() {
    const paths = Array.from({ length: 6 }, (_, index) => `/assets/hunter/frame-${index}.png`)
    try {
      const textures = await Promise.all(paths.map(async (path) => (await Assets.load(path)) as Texture))
      if (this.destroyed) return
      this.playerTextures = textures
      this.playerSprite.texture = textures[0]
      this.playerSprite.anchor.set(0.5, 0.78)
      this.playerSprite.visible = true
    } catch {
      this.playerTextures = []
      this.playerSprite.visible = false
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
    this.jumpCooldown = secondJump ? 0.12 : 0.08
    this.attackTimer = secondJump ? 0.24 : 0.16
    this.speedKick = Math.min(0.5, this.speedKick + (secondJump ? 0.18 : 0.11))
    this.combo = Math.min(12, this.combo + 1)
    this.flow = clamp(this.flow + (secondJump ? 8 : 5), 0, 100)
    this.aura = clamp(this.aura + (secondJump ? 4 : 2), 0, AURA_MAX)
    this.callbacks.onJump?.(secondJump ? 0.9 : 0.58)

    const pos = this.playerPosition()
    this.spawnSlash(pos.x + 18, pos.y - 18, secondJump ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue, secondJump ? 0.88 : 0.56)
    this.spawnBurst(pos.x - 10, pos.y + 12, secondJump ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue, secondJump ? 9 : 5, 0.75)
  }

  private resetRun(startRunning: boolean) {
    const layout = this.layout()
    this.phase = startRunning ? 'running' : 'idle'
    this.callbacks.onPhaseChange?.(this.phase)
    this.entities.forEach((entity) => entity.graphic.destroy())
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
    this.portalFlash = 0
    this.shake = 0
    this.lastStatsAt = 0
    this.trailClock = 0
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
      if (this.summonTimer > 0) this.clearThreats(layout.playerX + 760, false)
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
    this.drawPlayer(layout)
    this.positionEntities(layout)
  }

  private drawBackground(layout: RunnerLayout) {
    const g = this.background
    const travel = this.distance * 0.48
    const speed = this.currentSpeed()
    const pulse = 0.5 + Math.sin(this.elapsedMs * 0.006) * 0.5

    g.clear()
    g.rect(0, 0, layout.width, layout.height).fill({ color: GAME_COLORS.ink })
    g.rect(0, layout.ceilingY, layout.width, layout.floorY - layout.ceilingY).fill({ color: GAME_COLORS.night, alpha: 0.82 })

    for (let x = -80 + (travel % 80); x < layout.width + 90; x += 80) {
      const alpha = x % 160 === 0 ? 0.12 : 0.045
      g.moveTo(x, layout.ceilingY).lineTo(x - 110, layout.floorY).stroke({ color: GAME_COLORS.rankViolet, alpha, width: 1 })
    }

    for (let y = layout.ceilingY; y <= layout.floorY + 80; y += 42) {
      const offset = (travel * (0.3 + y / layout.height)) % 64
      g.moveTo(-offset, y).lineTo(layout.width, y + Math.sin(this.elapsedMs * 0.001 + y) * 4).stroke({
        color: y > layout.floorY ? GAME_COLORS.rankViolet : GAME_COLORS.gateBlue,
        alpha: y > layout.floorY ? 0.13 : 0.055,
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
    g.rect(0, layout.floorY, layout.width, 3).fill({ color: floorGlow, alpha: 0.54 + pulse * 0.12 })
    g.rect(0, layout.floorY + 4, layout.width, layout.height - layout.floorY).fill({ color: GAME_COLORS.wall, alpha: 0.94 })
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

  private drawPlayer(layout: RunnerLayout) {
    const pos = this.playerPosition(layout)
    const frameIndex = this.playerFrameIndex()
    const cleanGlow = this.summonTimer > 0 ? 1 : this.attackTimer > 0 ? 0.8 : this.speedKick
    const shimmer = 0.5 + Math.sin(this.elapsedMs * 0.018) * 0.5

    this.player.position.set(pos.x, pos.y)
    this.player.rotation = this.jumpsUsed > 0 ? Math.sin(this.velocityY * 0.003) * 0.08 : Math.sin(this.elapsedMs * 0.012) * 0.01
    this.player.scale.set(1, 1)

    const g = this.playerArt
    g.clear()

    if (this.playerTextures.length > 0) {
      const texture = this.playerTextures[frameIndex] ?? this.playerTextures[0]
      this.playerSprite.visible = true
      if (this.playerSprite.texture !== texture) this.playerSprite.texture = texture
      this.playerSprite.anchor.set(0.44, frameIndex === 4 ? 0.8 : 0.82)
      this.playerSprite.position.set(frameIndex === 1 ? 3 : frameIndex === 5 ? 9 : 0, frameIndex === 3 ? 4 : 8)
      const baseHeight = frameIndex === 4 ? 126 : frameIndex === 0 ? 112 : frameIndex === 5 ? 118 : 106
      const spriteScale = (baseHeight + this.evolution * 1.6 + cleanGlow * 8) / texture.height
      this.playerSprite.scale.set(spriteScale)

      g.poly([18, -118, 75, -26, 16, 48, -34, -26], true).stroke({
        color: GAME_COLORS.rankViolet,
        alpha: 0.14 + this.flow / 500,
        width: 1.2,
      })
      g.poly([24, -88, 55, -20, 18, 36, -14, -18], true).stroke({
        color: GAME_COLORS.gateBlue,
        alpha: 0.12 + this.flow / 680,
        width: 1,
      })
      if (this.summonTimer > 0 || this.attackTimer > 0) {
        g.poly([38, -66 - shimmer * 8, 122, -30, 124, -10, 34, 12], true).fill({
          color: this.summonTimer > 0 ? GAME_COLORS.lime : GAME_COLORS.rankViolet,
          alpha: 0.16 + cleanGlow * 0.18,
        })
      }
      g.ellipse(20, 18, 36, 4).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
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
      this.addEntity('coin', 300 + i * 70, 0, -120 - Math.sin(i * 0.9) * 48, 16, 16, 8, 1, 0, 0)
    }
    this.addEntity('portal', 970, 0, -135, 66, 94, 34, 0, 0, 0)
  }

  private spawnAhead(layout: RunnerLayout) {
    const visibleAhead = layout.width + 820
    while (this.nextSpawnX < this.distance + visibleAhead) {
      const difficulty = Math.min(1, this.distance / 8500)
      const pattern = Math.floor(this.random() * 7)
      const x = this.nextSpawnX

      if (pattern === 0) {
        this.addEntity('spike', x, 0, 0, 38, 32, 20, 0, 0, 0)
        this.addCoinArc(x + 70, -118, 5)
      } else if (pattern === 1) {
        this.addEntity('wall', x, 0, 0, 28, layout.floorY - layout.ceilingY, 0, 0, layout.floorY - 120 - this.random() * 92, 118)
        this.addCoinArc(x + 52, -190, 4)
      } else if (pattern === 2) {
        this.addEntity('enemy', x + 28, 0, 0, 54, 68, 28, 0, 0, 0)
        this.addCoinArc(x + 130, -145, 5)
      } else if (pattern === 3) {
        this.addEntity('orb', x + 20, 0, -145 - this.random() * 92, 36, 36, 20, 0, 0, 0)
        this.addEntity('spike', x + 145, 0, 0, 38, 32, 20, 0, 0, 0)
      } else if (pattern === 4) {
        this.addEntity('portal', x + 40, 0, -126 - this.random() * 54, 66, 94, 34, 0, 0, 0)
        this.addCoinArc(x + 125, -170, 4)
      } else if (pattern === 5) {
        this.addEntity('enemy', x + 16, 0, 0, 54, 68, 28, 0, 0, 0)
        this.addEntity('orb', x + 170, 0, -205, 36, 36, 20, 0, 0, 0)
      } else {
        this.addCoinArc(x, -112 - this.random() * 120, 7)
      }

      this.nextSpawnX += 250 - difficulty * 66 + this.random() * (180 - difficulty * 42)
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
    const graphic = this.createEntityGraphic(kind, width, height, gapHeight)
    const entity: GameEntity = {
      id: this.entityId,
      kind,
      worldX,
      y: yOffset,
      width,
      height,
      radius,
      value,
      gapY,
      gapHeight,
      graphic,
      spin: (this.random() > 0.5 ? 1 : -1) * (2.2 + this.random() * 2.6),
      wobble: this.random() * Math.PI * 2,
    }
    this.entityId += 1

    if (kind === 'coin' || kind === 'portal') this.pickupLayer.addChild(graphic)
    else this.hazardLayer.addChild(graphic)
    this.entities.push(entity)
  }

  private createEntityGraphic(kind: EntityKind, width: number, height: number, gapHeight: number) {
    const g = new Graphics()

    if (kind === 'coin') {
      g.poly([0, -9, 9, 0, 0, 9, -9, 0], true).fill({ color: GAME_COLORS.amber })
      g.poly([0, -5, 5, 0, 0, 5, -5, 0], true).stroke({ color: GAME_COLORS.white, alpha: 0.86, width: 1.1 })
      g.circle(0, 0, 2).fill({ color: GAME_COLORS.rankViolet, alpha: 0.68 })
    }

    if (kind === 'spike') {
      g.poly([-22, 16, -10, -18, 0, 14, 11, -20, 23, 16], true).fill({ color: GAME_COLORS.coral, alpha: 0.96 })
      g.poly([-22, 16, -10, -18, 0, 14, 11, -20, 23, 16], true).stroke({ color: GAME_COLORS.white, alpha: 0.72, width: 1.2 })
    }

    if (kind === 'orb') {
      g.circle(0, 0, 20).stroke({ color: GAME_COLORS.rankViolet, alpha: 0.9, width: 2 })
      g.poly([0, -18, 16, 0, 0, 18, -16, 0], true).fill({ color: GAME_COLORS.gateBlue, alpha: 0.34 })
      g.circle(0, 0, 5).fill({ color: GAME_COLORS.white, alpha: 0.72 })
    }

    if (kind === 'enemy') {
      g.ellipse(0, 16, 26, 8).fill({ color: GAME_COLORS.shadow, alpha: 0.42 })
      g.poly([-16, 16, -6, -30, 16, -20, 22, 18, 0, 30], true).fill({ color: 0x130a1f, alpha: 0.98 })
      g.poly([-6, -25, 24, -45, 11, -13], true).fill({ color: GAME_COLORS.rankViolet, alpha: 0.84 })
      g.circle(7, -15, 3).fill({ color: GAME_COLORS.coral, alpha: 0.9 })
      g.rect(14, -4, 32, 2).fill({ color: GAME_COLORS.white, alpha: 0.72 })
    }

    if (kind === 'portal') {
      g.ellipse(0, 0, width * 0.45, height * 0.48).stroke({ color: GAME_COLORS.gateBlue, alpha: 0.86, width: 2 })
      g.ellipse(0, 0, width * 0.3, height * 0.36).stroke({ color: GAME_COLORS.rankViolet, alpha: 0.7, width: 1.4 })
      g.poly([0, -height * 0.36, width * 0.22, 0, 0, height * 0.36, -width * 0.22, 0], true).fill({
        color: GAME_COLORS.rankViolet,
        alpha: 0.17,
      })
    }

    if (kind === 'wall') {
      const halfW = width * 0.5
      const gap = Math.max(80, gapHeight)
      g.rect(-halfW, -height * 0.5, width, height * 0.5 - gap * 0.5).fill({ color: GAME_COLORS.rankViolet, alpha: 0.66 })
      g.rect(-halfW, gap * 0.5, width, height * 0.5 - gap * 0.5).fill({ color: GAME_COLORS.gateBlue, alpha: 0.48 })
      g.rect(-halfW - 4, -height * 0.5, 4, height).fill({ color: GAME_COLORS.white, alpha: 0.16 })
      g.rect(halfW, -height * 0.5, 4, height).fill({ color: GAME_COLORS.white, alpha: 0.16 })
    }

    return g
  }

  private updateEntities(dt: number, layout: RunnerLayout) {
    for (const entity of this.entities) {
      entity.graphic.rotation += entity.kind === 'coin' || entity.kind === 'orb' ? entity.spin * dt : 0
      if (entity.kind === 'portal') entity.graphic.rotation += dt * 0.8
      if (entity.kind === 'coin' || entity.kind === 'orb') {
        entity.y += Math.sin(this.elapsedMs * 0.006 + entity.wobble) * dt * 5
      }
    }

    const keep: GameEntity[] = []
    for (const entity of this.entities) {
      if (this.screenXFor(entity, layout) > -180) keep.push(entity)
      else entity.graphic.destroy()
    }
    this.entities = keep
  }

  private positionEntities(layout: RunnerLayout) {
    for (const entity of this.entities) {
      const x = this.screenXFor(entity, layout)
      const y = this.entityY(entity, layout)
      const pulse = 1 + Math.sin(this.elapsedMs * 0.009 + entity.id) * 0.06
      entity.graphic.position.set(x, y)
      entity.graphic.visible = x > -180 && x < layout.width + 220
      entity.graphic.scale.set(entity.kind === 'coin' || entity.kind === 'portal' ? pulse : 1)
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
        this.distance += 250
        this.flow = clamp(this.flow + 18, 0, 100)
        this.aura = clamp(this.aura + 24, 0, AURA_MAX)
        this.speedKick = Math.min(0.58, this.speedKick + 0.2)
        this.portalFlash = 1
        this.callbacks.onPortal?.()
        this.spawnBurst(x, y, GAME_COLORS.gateBlue, 22, 1.15)
        entity.graphic.destroy()
        continue
      }

      if (entity.kind === 'enemy' && Math.abs(dx) < 42 && Math.abs(dy) < 58) {
        if (attacking || this.velocityY > 190) {
          this.killEnemy(entity, x, y)
          continue
        }
        this.finishRun()
      }

      if (entity.kind === 'spike' && Math.abs(dx) < 32 && player.y > layout.floorY - 40) {
        if (attacking) {
          this.killThreat(entity, x, y)
          continue
        }
        this.finishRun()
      }

      if (entity.kind === 'orb' && Math.hypot(dx, dy) < entity.radius + PLAYER_RADIUS) {
        if (attacking) {
          this.killThreat(entity, x, y)
          continue
        }
        this.finishRun()
      }

      if (entity.kind === 'wall' && Math.abs(dx) < entity.width * 0.5 + PLAYER_RADIUS) {
        const gapTop = entity.gapY - entity.gapHeight * 0.5
        const gapBottom = entity.gapY + entity.gapHeight * 0.5
        if (player.y < gapTop || player.y > gapBottom) this.finishRun()
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
    this.spawnBurst(entity.graphic.x, entity.graphic.y, color, 6, force)
    entity.graphic.destroy()
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
    entity.graphic.destroy()
  }

  private killThreat(entity: GameEntity, x: number, y: number) {
    this.aura = clamp(this.aura + 10, 0, AURA_MAX)
    this.flow = clamp(this.flow + 6, 0, 100)
    this.callbacks.onStrike?.()
    this.spawnBurst(x, y, GAME_COLORS.gateBlue, 12, 1)
    entity.graphic.destroy()
  }

  private clearThreats(maxX: number, forceVisual: boolean) {
    const keep: GameEntity[] = []
    for (const entity of this.entities) {
      if ((entity.kind === 'enemy' || entity.kind === 'spike' || entity.kind === 'orb') && entity.graphic.x < maxX) {
        if (forceVisual || this.random() > 0.28) this.spawnBurst(entity.graphic.x, entity.graphic.y, GAME_COLORS.rankViolet, 10, 1)
        entity.graphic.destroy()
        this.aura = clamp(this.aura + 2, 0, AURA_MAX)
      } else {
        keep.push(entity)
      }
    }
    this.entities = keep
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
    const graphic = new Graphics()
      .poly([-length * 0.08, -5, length * 0.72, -12, length, -1, length * 0.72, 10, -length * 0.12, 5], true)
      .fill({ color, alpha: 0.64 })
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
    const flowBonus = 1 + this.flow / 520 + this.combo * 0.01 + this.speedKick + (this.evolution - 1) * 0.025
    return Math.min(MAX_SPEED * 1.24, ramp * flowBonus * (0.18 + introCurve * 0.82))
  }

  private playerFrameIndex() {
    if (this.phase !== 'running') return 0
    if (this.summonTimer > 0 || this.attackTimer > 0.08) return 5
    if (this.jumpsUsed > 0) return this.velocityY > 160 ? 4 : 3
    if (this.introTimer > 0.18) return 0
    return 1
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
