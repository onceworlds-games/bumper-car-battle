# Carnevale

A masked ball where everyone looks alike. Blend in, find your quarry, unmask them. Inspired by SpyParty.

Play it at [onceworlds.com/play/carnevale](https://onceworlds.com/play/carnevale).

## How to play

You are one mask in a crowd of revellers at dusk in a Venetian plaza. Eight troupes (Medico, Arlecchino, Moretta,
Volto, Colombina, Gatto, Bauta, Jolly) walk the same choreography on every screen: promenades, pauses at the
fountain, a dance by the stage. You wear one troupe's costume and take one place in its formation. Your **shadow**
on the ground shows where that place is right now; stand on it and you are **in step**: nobody can tell you from
the revellers, and your **poise** (the fan) fills.

Your card names your **quarry**: their troupe from the start, and every 40 seconds the district they were last seen
in. Find the figure that moves like a person (late to a turn, walking where its troupe isn't, kicking up dust at a
sprint, a wave answered too late or too fast: your wave gets its answer marked over them) and unmask them. Unmask a mere reveller and your own mask slips, so everyone near can see you. Someone else is
hunting you all the while: a heartbeat means your pursuer is close. At midnight the fireworks start and everyone
freezes for the **Hush**; unmasks then count double.

Each round: the assignment (10 s), **Blend** (20 s, no unmasking), the **Hunt**, the **Hush** (25 s), results.

| | Points |
|---|---|
| Unmask your quarry | +100 (x2 in the Hush, +25 if clean: no faux pas in the last 30 s) |
| Survive the round | +50 |
| Your pursuer blunders within 3 m of you | +15 |
| Someone unmasks your decoy | +15 |
| Unmask a reveller (faux pas) | -15 |
| Unmask a player who isn't your quarry | -10 (+10 to them) |
| Being unmasked | -25, then 10 s in the Powder Room and back in a new costume |

## Controls

| Keyboard and mouse | |
|---|---|
| W A S D or arrows | Walk (always at the crowd's pace) |
| Click | Walk there, or mark a figure you suspect |
| F | Back into step (walks you to your shadow) |
| Shift | Sprint: quick but loud, costs poise |
| E | Unmask the figure in front of you |
| G | Greet, or answer a greeting |
| 1, 2 | Your two tricks |
| Space | Flourish (your victory pose) |
| Tab or M | The map with your quarry's district |
| Right drag, Z, X / wheel | Turn the camera / zoom |

**Touch**: the stick walks; **Unmask**, **Greet**, **Sprint** and **Trick** (tap for the first trick, hold for the
second) sit on the right. Tap the ground to walk there, tap a figure to mark it, tap your shadow to fall back into
step, tap the trick buttons beside the poise fan, tap the quarry card for the map, and use two fingers to turn and
zoom.

## Modes and settings

The host picks these on the lobby card:

- **Mode**: **Masquerade** (everyone hunts and is hunted, in a ring) or **Spot the Mask** (bot impostors hide in the
  crowd and you hunt them down; scored by speed and by faux pas; the results say who was found and who got away).
- **Rounds** 1, 3 or 5; **Round** length 3, 5 or 7 minutes.
- **Crowd**: Light (48 revellers), Normal (72) or Packed (96).
- **Loadouts**: Standard (pick two tricks) or Chaos (two at random, any level).
- **Bots**: Novice, Adept, Master or Off. Bots fill a Masquerade to eight maskers and are marked "(bot)" in the
  results. They act only on what a player could see.

Rounds move between three plazas: **the Piazza** (fountain, clock tower, stage, canal bridges, four arcades),
**the Quay** (pier, twin columns, bandstand, fish market) and **the Palazzo** (a courtyard with a grand stair, a
terrace and balconies).

**Tricks**: Smoke Pearl (a cloud that blocks sight and unmasking), Decoy (a copy of you stands in the crowd),
Opera Glass (zoom in and spot flustered maskers from afar; drains poise), Lantern Toss (heads turn to it and stop
gaining poise), Swap (trade places and costume with a nearby reveller of another troupe). Sprint is always yours.

New players get a short guided rehearsal before their first ball.

## Progression

Rounds give XP up to level 30. Levels unlock Lantern Toss (2) and Swap (4), unmask flourishes (rose petals, gold
leaf, feathers, teal ribbons, fireflies), victory poses (flourish, twirl, juggle, applause) and the banner that hangs
by your name on the results. None of them changes your costume during a round, since that would give you away.

**Badges**: First Unmask, Faux Pas, Ghost, Hush Hero, Close Call, Master of Disguise, Sharp Eye, Case Closed,
Full House, Level 10, Bait.

**Leaderboards**: `best-round` (best Masquerade round), `case-file` (best Spot the Mask round),
`career-unmasks` (unmasks over all time).

## Multiplayer

Up to ten players share a room. The host's page runs each round from the room's match clock (assignments, clues,
the Hush, scoring) and keeps every player's quarry as that player's private value, so a reloaded player gets their
seat back and a new host carries on the same round, whichever phase it is in. Nobody else's page holds your quarry:
even a close call is told to the quarry alone, by message. A player whose page has gone stands in their place in
their troupe until they are back; someone untouched for a long while leaves the round as audience (a figure standing
in its place gets a minute, and the Hush never counts).

## How it's built

Vite and three.js; every model, texture, sound and tune is made in code (the two fonts are bundled).

```
src/
  sim/      the pure simulation, no DOM: plazas and districts, navigation, troupe choreography, the deterministic
            crowd, the round rules, player movement, bots and a headless world for tests and the balance harness
  render/   three.js: costumes, instanced figures, the plazas, sky, water, lanterns, fireworks, effects, camera, and
            the high tier's bloom and grade (high: shadows from a low sun, bloom, grade; medium: smaller shadows;
            low: neither)
  game/     the round on screen: input, your walker, the crowd view, events, the match driver, saves and levels,
            the rehearsal
  net/      the wire format (every read validated), the host loop and the session
  ui/       the HUD, the cards between moments, the map, icons and badge art
  audio/    a small synth: plucked strings, accordion, bells, the crowd, the barcarolle
  poster.js store-art scenes; testhook.js the ?test hooks
```

The crowd is a pure function of the round's seed and the clock, so every page draws the same revellers without
sending them over the network.

## Run it locally

```
npm install
npm run dev        # standalone at http://localhost:5181 with bots
npm test           # unit, property and fuzz tests (node --test): the rules, the crowd, the wire format, the host against
                   # a stand-in room (host changes in every phase, secrecy, hostile requests), the camera (kept out of every wall,
                   # the stage, the roofs and the houses: checked against the plazas' own built scenery, not just their data)
npm run balance    # headless rounds with bots: the balance table (node scripts/balance.mjs 30 for more rounds)
npm run build      # dist/
npm run smoke      # loads dist/ headless with ?test=auto and fails on any error
npm run store      # captures store/ from ?poster= scenes (GPU Chrome; SOFTWARE_GL=1 forces software)
```

On a local Onceworlds platform, build first and deploy with the Onceworlds CLI. The platform doesn't pass query
strings to the game, so the `?test` and `?poster` hooks are for the standalone page.

## License

MIT. See `LICENSE`. The fonts (Bodoni Moda, Jost) are under the SIL Open Font License; see `src/fonts`.
