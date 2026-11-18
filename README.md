# Ragdoll tenants

Little physics characters for a cozy browser game: active ragdolls (capsule skeletons
with spring-motor muscles) under a smooth skin, with a glop head, moods, gestures,
age/weight/fitness traits and per-character looks.

**Live sandbox:** https://bacipperly.github.io/ragdoll-tenants/

## Controls

| Key | |
|---|---|
| WASD | walk (camera-relative), Shift to stroll |
| Space | jump |
| G | pick up what's in front of you (a thing or another tenant); again to throw |
| V | put down |
| F | get shoved · K knock out / get up · R reset |
| M | next mood · 1–0 wave, hop, spin, bow, celebrate, shrug, stomp, sigh, nod, shake |
| Click | become another tenant |
| Drag / wheel / Q E | orbit and zoom · C game camera · B show the skeleton |

The **Tuning** panel has sliders for everything: traits, mood, the character's look,
muscles, walk, jump, head goo. On the live site settings can be copied and pasted;
saving to files works when running locally.

## Running it locally

```bash
npm install
npm run dev
```

Locally, **Save to project** writes `src/ragdoll/tuning.json` (how bodies move) and the
**Characters** panel saves looks to `characters.json`.

## Layout

- `src/ragdoll/` — the ragdoll module (only depends on three.js and Rapier): physics
  skeleton and controllers, skin, goo head, face, moods, gestures, traits, recipes.
- `src/` — the sandbox: scene, crowd, things to play with, tuning panel.
- `scripts/` — headless checks (`npx tsx scripts/moods.ts`, `gestures.ts`, `profile.ts`…).
