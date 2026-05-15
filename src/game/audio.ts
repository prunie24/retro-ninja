import * as Tone from 'tone'

type TonePart = { dispose: () => void }
type NoteTrigger = { triggerAttackRelease: (note: string, duration: string, time?: number, velocity?: number) => unknown }
type NoiseTrigger = { triggerAttackRelease: (duration: string, time?: number, velocity?: number) => unknown }
type ReleaseTrigger = { triggerRelease: (time?: number) => unknown }

export class RetroAudioDirector {
  private started = false
  private muted = false
  private loopIds: number[] = []
  private parts: TonePart[] = []
  private bass?: Tone.MonoSynth
  private lead?: Tone.FMSynth
  private arp?: Tone.Synth
  private bell?: Tone.Synth
  private choir?: Tone.Synth
  private kick?: Tone.MembraneSynth
  private hat?: Tone.NoiseSynth
  private snare?: Tone.NoiseSynth
  private impact?: Tone.NoiseSynth
  private jumpFx?: Tone.Synth
  private coinFx?: Tone.Synth
  private gain?: Tone.Gain
  private auraGain?: Tone.Gain
  private intensity = 0
  private musicActive = false
  private playRequested = false
  private lastJumpFxAt = 0
  private lastCoinFxAt = 0
  private lastPortalFxAt = 0
  private lastSummonFxAt = 0
  private lastStrikeFxAt = 0
  private lastCrashFxAt = 0

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.started) Tone.Destination.mute = muted
    if (muted) {
      if (this.started && this.musicActive) Tone.Transport.stop()
      this.musicActive = false
    } else if (this.playRequested) {
      this.resumeMusic()
    }
  }

  async start() {
    if (this.started) {
      this.resumeMusic()
      return
    }
    if (this.muted) return

    await Tone.start()
    Tone.Destination.mute = this.muted
    Tone.Transport.stop()
    Tone.Transport.cancel()
    this.started = true

    const limiter = new Tone.Limiter(-7).toDestination()
    const reverb = new Tone.Reverb({ decay: 4.6, wet: 0.28 }).connect(limiter)
    const shimmer = new Tone.Reverb({ decay: 7.2, wet: 0.34 }).connect(limiter)
    const delay = new Tone.FeedbackDelay('8n.', 0.28).connect(reverb)
    const drive = new Tone.Distortion(0.18).connect(delay)
    const lowPass = new Tone.Filter(5800, 'lowpass').connect(drive)
    this.gain = new Tone.Gain(0.7).connect(lowPass)
    this.auraGain = new Tone.Gain(0.36).connect(shimmer)

    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.006, decay: 0.2, sustain: 0.34, release: 0.08 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.22,
        sustain: 0.16,
        release: 0.2,
        baseFrequency: 72,
        octaves: 2.9,
      },
    }).connect(this.gain)

    this.lead = new Tone.FMSynth({
      harmonicity: 1.5,
      modulationIndex: 6,
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0.1, release: 0.14 },
      modulation: { type: 'triangle' },
      modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.2, release: 0.1 },
    }).connect(delay)

    this.arp = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.08, sustain: 0.03, release: 0.12 },
    }).connect(delay)

    this.bell = new Tone.Synth({
      oscillator: { type: 'pulse', width: 0.35 },
      envelope: { attack: 0.004, decay: 0.08, sustain: 0.12, release: 0.22 },
    }).connect(reverb)

    this.choir = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.18, decay: 0.8, sustain: 0.42, release: 0.9 },
    }).connect(this.auraGain)

    this.jumpFx = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.04, sustain: 0.02, release: 0.08 },
    }).connect(delay)

    this.coinFx = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.06, sustain: 0.04, release: 0.14 },
    }).connect(reverb)

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 8,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.22, sustain: 0.01, release: 0.04 },
    }).connect(limiter)

    this.hat = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 },
    }).connect(limiter)

    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.04 },
    }).connect(reverb)

    this.impact = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.002, decay: 0.38, sustain: 0, release: 0.12 },
    }).connect(limiter)

    this.parts.push(
      limiter,
      reverb,
      shimmer,
      delay,
      drive,
      lowPass,
      this.gain,
      this.auraGain,
      this.bass,
      this.lead,
      this.arp,
      this.bell,
      this.choir,
      this.jumpFx,
      this.coinFx,
      this.kick,
      this.hat,
      this.snare,
      this.impact,
    )

    Tone.Transport.bpm.value = 132
    Tone.Transport.swing = 0.09

    const bassLine = ['C2', 'C2', 'G1', 'Bb1', 'C2', 'Eb2', 'Bb1', 'G1', 'Ab1', 'Ab1', 'Eb2', 'G1', 'Bb1', 'C2', 'G1', 'Bb1']
    const arpLine = ['C4', 'G4', 'Bb4', 'C5', 'Eb5', 'C5', 'Bb4', 'G4', 'Ab4', 'C5', 'Eb5', 'G5', 'F5', 'Eb5', 'C5', 'Bb4']
    const leadLine = ['C5', 'Eb5', 'G5', 'Bb5', 'C6', 'Bb5', 'G5', 'Eb5']
    const choirChords = [
      ['C3', 'G3', 'Eb4', 'Bb4'],
      ['Ab2', 'Eb3', 'G3', 'C4'],
      ['Bb2', 'F3', 'Ab3', 'D4'],
      ['G2', 'D3', 'Bb3', 'Eb4'],
    ]
    let bassStep = 0
    let arpStep = 0
    let leadStep = 0
    let drumStep = 0
    let choirStep = 0

    this.loopIds = [
      Tone.Transport.scheduleRepeat((time) => {
        const note = bassLine[bassStep % bassLine.length]
        bassStep += 1
        this.playNote(this.bass, note, '16n', time, 0.62 + this.intensity * 0.18)
      }, '8n'),
      Tone.Transport.scheduleRepeat((time) => {
        const strong = drumStep % 8 === 0
        const ghost = drumStep % 4 === 2
        if (strong) this.playNote(this.kick, 'C1', '16n', time, 0.82 + this.intensity * 0.15)
        if (ghost && this.intensity > 0.28) this.playNote(this.kick, 'G1', '32n', time, 0.28 + this.intensity * 0.18)
        if (drumStep % 8 === 4) this.playNoise(this.snare, '32n', time, 0.08 + this.intensity * 0.08)
        drumStep += 1
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        const open = arpStep % 4 === 0
        this.playNoise(this.hat, open ? '32n' : '64n', time, open ? 0.14 + this.intensity * 0.06 : 0.08)
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        const note = arpLine[arpStep % arpLine.length]
        arpStep += 1
        if (arpStep % 2 === 0 || this.intensity > 0.45) this.playNote(this.arp, note, '32n', time, 0.08 + this.intensity * 0.1)
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        if (this.intensity < 0.18 && leadStep % 2 === 1) {
          leadStep += 1
          return
        }
        const note = leadLine[leadStep % leadLine.length]
        leadStep += 1
        this.playNote(this.lead, note, '64n', time, 0.08 + this.intensity * 0.13)
      }, '4n'),
      Tone.Transport.scheduleRepeat((time) => {
        const chord = choirChords[choirStep % choirChords.length]
        choirStep += 1
        this.playNote(this.choir, chord[2], '2n', time, 0.07 + this.intensity * 0.04)
        this.playNote(this.bell, chord[2].replace('3', '5').replace('2', '4'), '8n', time, 0.05 + this.intensity * 0.03)
      }, '1m'),
    ]

    Tone.Transport.start()
    this.musicActive = true
    this.playRequested = true
  }

  resumeMusic() {
    this.playRequested = true
    if (!this.started || this.muted || this.musicActive) return
    Tone.Transport.start()
    this.musicActive = true
  }

  stopMusic() {
    this.playRequested = false
    if (!this.started || !this.musicActive) return
    Tone.Transport.stop()
    this.releaseSustainedNotes()
    this.musicActive = false
  }

  setIntensity(amount: number) {
    if (!this.started) return
    const clamped = Math.max(0, Math.min(1, amount))
    this.intensity = clamped
    Tone.Transport.bpm.rampTo(132 + clamped * 38, 0.35)
    this.gain?.gain.rampTo(0.58 + clamped * 0.2, 0.25)
    this.auraGain?.gain.rampTo(0.28 + clamped * 0.22, 0.35)
  }

  jump(quality = 0.4) {
    if (!this.started || this.muted || !this.musicActive) return
    if (!this.canPlayFx('jump', 0.095)) return
    this.playNote(this.jumpFx, quality > 0.72 ? 'G6' : 'C6', '64n', Tone.now() + 0.01, 0.1 + quality * 0.08)
  }

  coin(value: number) {
    if (!this.started || this.muted || !this.musicActive) return
    if (!this.canPlayFx('coin', 0.035)) return
    const note = value > 1 ? 'A5' : 'E5'
    this.playNote(this.coinFx, note, '32n', Tone.now() + 0.01, 0.16)
  }

  portal() {
    if (!this.started || this.muted || !this.musicActive) return
    if (!this.canPlayFx('portal', 0.5)) return
    const now = Tone.now()
    this.playNote(this.jumpFx, 'G5', '8n', now + 0.01, 0.14)
    this.playNote(this.coinFx, 'C6', '16n', now + 0.03, 0.16)
  }

  summon() {
    if (!this.started || this.muted || !this.musicActive) return
    if (!this.canPlayFx('summon', 0.85)) return
    const now = Tone.now()
    this.playNote(this.jumpFx, 'C6', '8n', now + 0.01, 0.2)
    this.playNote(this.coinFx, 'C7', '16n', now + 0.04, 0.18)
    this.playNote(this.kick, 'C1', '8n', now + 0.02, 1)
    this.playNoise(this.impact, '4n', now + 0.03, 0.75)
  }

  strike() {
    if (!this.started || this.muted || !this.musicActive) return
    if (!this.canPlayFx('strike', 0.1)) return
    this.playNote(this.jumpFx, 'Bb6', '64n', Tone.now() + 0.005, 0.18)
    this.playNoise(this.hat, '32n', Tone.now() + 0.006, 0.2)
  }

  crash() {
    if (!this.started || this.muted) return
    if (!this.canPlayFx('crash', 0.35)) return
    this.playNoise(this.impact, '8n', Tone.now() + 0.02, 0.85)
  }

  private canPlayFx(kind: 'jump' | 'coin' | 'portal' | 'summon' | 'strike' | 'crash', gap: number) {
    const now = Tone.now()
    if (kind === 'jump') {
      if (now - this.lastJumpFxAt < gap) return false
      this.lastJumpFxAt = now
      return true
    }
    if (kind === 'coin') {
      if (now - this.lastCoinFxAt < gap) return false
      this.lastCoinFxAt = now
      return true
    }
    if (kind === 'portal') {
      if (now - this.lastPortalFxAt < gap) return false
      this.lastPortalFxAt = now
      return true
    }
    if (kind === 'summon') {
      if (now - this.lastSummonFxAt < gap) return false
      this.lastSummonFxAt = now
      return true
    }
    if (kind === 'strike') {
      if (now - this.lastStrikeFxAt < gap) return false
      this.lastStrikeFxAt = now
      return true
    }
    if (now - this.lastCrashFxAt < gap) return false
    this.lastCrashFxAt = now
    return true
  }

  private releaseSustainedNotes() {
    const now = Tone.now()
    this.releaseNote(this.bass, now)
    this.releaseNote(this.lead, now)
    this.releaseNote(this.arp, now)
    this.releaseNote(this.bell, now)
    this.releaseNote(this.choir, now)
    this.releaseNote(this.jumpFx, now)
    this.releaseNote(this.coinFx, now)
  }

  private playNote(synth: NoteTrigger | undefined, note: string, duration: string, time?: number, velocity?: number) {
    if (!synth) return
    try {
      synth.triggerAttackRelease(note, duration, time, velocity)
    } catch {
      // Tone can reject dense repeated input; audio should never interrupt gameplay.
    }
  }

  private playNoise(synth: NoiseTrigger | undefined, duration: string, time?: number, velocity?: number) {
    if (!synth) return
    try {
      synth.triggerAttackRelease(duration, time, velocity)
    } catch {
      // Tone can reject dense repeated input; audio should never interrupt gameplay.
    }
  }

  private releaseNote(synth: ReleaseTrigger | undefined, time?: number) {
    if (!synth) return
    try {
      synth.triggerRelease(time)
    } catch {
      // Ignore stale release calls from rapid restarts.
    }
  }

  dispose() {
    this.loopIds.forEach((id) => Tone.Transport.clear(id))
    this.loopIds = []
    this.parts.forEach((part) => part.dispose())
    this.parts = []
    this.intensity = 0
    Tone.Transport.stop()
    Tone.Transport.cancel()
    this.started = false
    this.musicActive = false
    this.playRequested = false
  }
}
