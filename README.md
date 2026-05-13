# Shadow Ninja

Shadow Ninja is a focused one-button anime fantasy domain runner. The current build is pure skill: click to jump, click again for a double jump, collect sigil coins, cut through enemies, enter portals, survive procedural domain walls, and chase distance.

## Key Parts

- `src/game/engine.ts`: PixiJS game loop, generated anime hunter sprite frames, jump/double-jump movement, procedural domain hazards, portals, enemies, coins, aura summon timing, particles, and difficulty ramp.
- `src/game/audio.ts`: Tone.js soundtrack and reactive SFX.
- `src/game/persistence.ts`: local best distance, recent runs, mute state, and lifetime coins.
- `src/components/GameCanvas.tsx`: React bridge for the Pixi engine and audio director.

## Run

```bash
npm install
npm run dev
```

## Design Notes

- Geometry Dash informed the instant reset, readable spikes, one-input precision, and rhythm-adjacent pacing.
- Jetpack Joyride informed the low-friction endless-run structure and fast one-touch reflex loop.
- Tiny Wings informed the hold/release “flow” rhythm: pressure builds speed, release converts timing into distance.
- Dark fantasy anime informed the hunter-rank atmosphere: gate geometry, violet-blue edge light, athletic sprite animation, enemies, portals, and sharper shadow motion.
- The visual system is now anime fantasy: black-violet infinite domain, top-right aura meter, summon button, angular HUD, and generated high-detail character frames.
