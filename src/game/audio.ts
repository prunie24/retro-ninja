import * as Tone from 'tone'

type TonePart = { dispose: () => void }

export class RetroAudioDirector {
  private started = false
  private muted = false
  private loopIds: number[] = []
  private parts: TonePart[] = []
  private bass?: Tone.MonoSynth
  private lead?: Tone.FMSynth
  private bell?: Tone.PolySynth
  private kick?: Tone.MembraneSynth
  private hat?: Tone.NoiseSynth
  private impact?: Tone.NoiseSynth
  private jumpFx?: Tone.PolySynth
  private coinFx?: Tone.PolySynth
  private gain?: Tone.Gain

  setMuted(muted: boolean) {
    this.muted = muted
    Tone.Destination.mute = muted
  }

  async start() {
    if (this.started || this.muted) return

    await Tone.start()
    Tone.Transport.stop()
    Tone.Transport.cancel()
    this.started = true

    const limiter = new Tone.Limiter(-8).toDestination()
    const reverb = new Tone.Reverb({ decay: 3.2, wet: 0.24 }).connect(limiter)
    const delay = new Tone.FeedbackDelay('8n.', 0.22).connect(reverb)
    const drive = new Tone.Distortion(0.22).connect(delay)
    this.gain = new Tone.Gain(0.74).connect(drive)

    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.18, sustain: 0.28, release: 0.08 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.25,
        sustain: 0.16,
        release: 0.2,
        baseFrequency: 80,
        octaves: 2.4,
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

    this.bell = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'pulse', width: 0.35 },
      envelope: { attack: 0.004, decay: 0.08, sustain: 0.12, release: 0.22 },
    }).connect(reverb)

    this.jumpFx = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.04, sustain: 0.02, release: 0.08 },
    }).connect(delay)

    this.coinFx = new Tone.PolySynth(Tone.Synth, {
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

    this.impact = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.002, decay: 0.38, sustain: 0, release: 0.12 },
    }).connect(limiter)

    this.parts.push(
      limiter,
      reverb,
      delay,
      drive,
      this.gain,
      this.bass,
      this.lead,
      this.bell,
      this.jumpFx,
      this.coinFx,
      this.kick,
      this.hat,
      this.impact,
    )

    Tone.Transport.bpm.value = 140
    Tone.Transport.swing = 0.07

    const bassLine = ['C2', 'C2', 'Bb1', 'G1', 'C2', 'Eb2', 'Ab1', 'G1']
    const leadLine = ['C4', 'Eb4', 'G4', 'Bb4', 'C5', 'Bb4', 'G4', 'Eb4']
    let bassStep = 0
    let leadStep = 0

    this.loopIds = [
      Tone.Transport.scheduleRepeat((time) => {
        const note = bassLine[bassStep % bassLine.length]
        bassStep += 1
        this.bass?.triggerAttackRelease(note, '16n', time, 0.72)
      }, '8n'),
      Tone.Transport.scheduleRepeat((time) => {
        if (Math.random() > 0.24) this.hat?.triggerAttackRelease('32n', time, 0.18)
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        this.kick?.triggerAttackRelease('C1', '16n', time, 0.72)
      }, '2n'),
      Tone.Transport.scheduleRepeat((time) => {
        const note = leadLine[leadStep % leadLine.length]
        leadStep += 1
        this.lead?.triggerAttackRelease(note, '64n', time, 0.17)
      }, '4n'),
      Tone.Transport.scheduleRepeat((time) => {
        this.bell?.triggerAttackRelease(['C5', 'Eb5', 'G5'], '16n', time, 0.08)
      }, '1m'),
    ]

    Tone.Transport.start()
  }

  setIntensity(amount: number) {
    if (!this.started) return
    const clamped = Math.max(0, Math.min(1, amount))
    Tone.Transport.bpm.rampTo(140 + clamped * 36, 0.35)
    this.gain?.gain.rampTo(0.66 + clamped * 0.14, 0.25)
  }

  jump(quality = 0.4) {
    if (!this.started || this.muted) return
    this.jumpFx?.triggerAttackRelease(quality > 0.72 ? 'G6' : 'C6', '64n', Tone.now() + 0.01, 0.1 + quality * 0.08)
  }

  coin(value: number) {
    if (!this.started || this.muted) return
    const note = value > 1 ? 'A5' : 'E5'
    this.coinFx?.triggerAttackRelease(note, '32n', Tone.now() + 0.01, 0.16)
  }

  portal() {
    if (!this.started || this.muted) return
    this.bell?.triggerAttackRelease(['C5', 'G5', 'C6'], '16n', Tone.now() + 0.01, 0.13)
    this.lead?.triggerAttackRelease('C6', '32n', Tone.now() + 0.03, 0.18)
  }

  summon() {
    if (!this.started || this.muted) return
    this.bell?.triggerAttackRelease(['C4', 'Eb5', 'G5', 'C6'], '8n', Tone.now() + 0.01, 0.17)
    this.kick?.triggerAttackRelease('C1', '8n', Tone.now() + 0.02, 0.95)
  }

  strike() {
    if (!this.started || this.muted) return
    this.jumpFx?.triggerAttackRelease('Bb6', '64n', Tone.now() + 0.005, 0.18)
    this.hat?.triggerAttackRelease('32n', Tone.now() + 0.006, 0.2)
  }

  crash() {
    if (!this.started || this.muted) return
    this.impact?.triggerAttackRelease('8n', Tone.now() + 0.02, 0.85)
  }

  dispose() {
    this.loopIds.forEach((id) => Tone.Transport.clear(id))
    this.loopIds = []
    this.parts.forEach((part) => part.dispose())
    this.parts = []
    this.started = false
  }
}
