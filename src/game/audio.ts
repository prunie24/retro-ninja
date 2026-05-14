import * as Tone from 'tone'

type TonePart = { dispose: () => void }

export class RetroAudioDirector {
  private started = false
  private muted = false
  private loopIds: number[] = []
  private parts: TonePart[] = []
  private bass?: Tone.MonoSynth
  private lead?: Tone.FMSynth
  private arp?: Tone.PolySynth
  private bell?: Tone.PolySynth
  private choir?: Tone.PolySynth
  private kick?: Tone.MembraneSynth
  private hat?: Tone.NoiseSynth
  private snare?: Tone.NoiseSynth
  private impact?: Tone.NoiseSynth
  private jumpFx?: Tone.PolySynth
  private coinFx?: Tone.PolySynth
  private gain?: Tone.Gain
  private auraGain?: Tone.Gain
  private intensity = 0

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

    this.arp = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.08, sustain: 0.03, release: 0.12 },
    }).connect(delay)

    this.bell = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'pulse', width: 0.35 },
      envelope: { attack: 0.004, decay: 0.08, sustain: 0.12, release: 0.22 },
    }).connect(reverb)

    this.choir = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.18, decay: 0.8, sustain: 0.58, release: 1.8 },
    }).connect(this.auraGain)

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
        this.bass?.triggerAttackRelease(note, '16n', time, 0.62 + this.intensity * 0.18)
      }, '8n'),
      Tone.Transport.scheduleRepeat((time) => {
        const strong = drumStep % 8 === 0
        const ghost = drumStep % 4 === 2
        if (strong) this.kick?.triggerAttackRelease('C1', '16n', time, 0.82 + this.intensity * 0.15)
        if (ghost && this.intensity > 0.28) this.kick?.triggerAttackRelease('G1', '32n', time, 0.28 + this.intensity * 0.18)
        if (drumStep % 8 === 4) this.snare?.triggerAttackRelease('32n', time, 0.08 + this.intensity * 0.08)
        drumStep += 1
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        const open = arpStep % 4 === 0
        this.hat?.triggerAttackRelease(open ? '32n' : '64n', time, open ? 0.14 + this.intensity * 0.06 : 0.08)
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        const note = arpLine[arpStep % arpLine.length]
        arpStep += 1
        if (arpStep % 2 === 0 || this.intensity > 0.45) this.arp?.triggerAttackRelease(note, '32n', time, 0.08 + this.intensity * 0.1)
      }, '16n'),
      Tone.Transport.scheduleRepeat((time) => {
        if (this.intensity < 0.18 && leadStep % 2 === 1) {
          leadStep += 1
          return
        }
        const note = leadLine[leadStep % leadLine.length]
        leadStep += 1
        this.lead?.triggerAttackRelease(note, '64n', time, 0.08 + this.intensity * 0.13)
      }, '4n'),
      Tone.Transport.scheduleRepeat((time) => {
        const chord = choirChords[choirStep % choirChords.length]
        choirStep += 1
        this.choir?.triggerAttackRelease(chord, '1m', time, 0.08 + this.intensity * 0.06)
        this.bell?.triggerAttackRelease(chord.map((note) => note.replace('3', '5').replace('2', '4')), '8n', time, 0.045 + this.intensity * 0.04)
      }, '1m'),
    ]

    Tone.Transport.start()
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
    const now = Tone.now()
    this.choir?.triggerAttackRelease(['Bb3', 'Eb4', 'G4', 'C5'], '2n', now + 0.01, 0.16)
    this.bell?.triggerAttackRelease(['C5', 'G5', 'C6', 'Eb6'], '8n', now + 0.02, 0.16)
    this.lead?.triggerAttackRelease('C6', '16n', now + 0.04, 0.2)
  }

  summon() {
    if (!this.started || this.muted) return
    const now = Tone.now()
    this.choir?.triggerAttackRelease(['C3', 'G3', 'Eb4', 'Bb4', 'C5'], '1m', now + 0.01, 0.22)
    this.bell?.triggerAttackRelease(['C4', 'Eb5', 'G5', 'C6'], '4n', now + 0.015, 0.2)
    this.kick?.triggerAttackRelease('C1', '8n', now + 0.02, 1)
    this.impact?.triggerAttackRelease('4n', now + 0.03, 0.75)
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
    this.intensity = 0
    Tone.Transport.stop()
    Tone.Transport.cancel()
    this.started = false
  }
}
