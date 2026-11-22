# Body models

Imported character bodies (e.g. from TripoAI), used instead of the generated body when
the sandbox is opened with `?model=<name>`. That loads `models/<name>.glb` and, if
present, `models/<name>.json` for its settings. Without `?model=` (or with
`?model=procedural`) the generated body is used, exactly as before.

`stand-in.glb` is a rough test model made by `scripts/make-standin.ts`.

## What to ask the generator for

- **A blank head, no face.** The face is drawn and animated by the game. A separate
  head mesh, or just a sphere, is ideal: it's cut off at the neck and replaced by the
  squishy goo head, which carries the face, hair and hats.
- **Standing in a neutral pose:** fins hanging a little out from the body, legs a
  little apart, facing forward.
- **Symmetrical, one watertight mesh, no clothes or accessories.**
- **Plain flat colour, no baked lighting.** Textures are ignored; the tenant's
  material colours it, so tenants can be any colour and wear painted clothes.
- **5,000–15,000 triangles.** 13 tenants share the screen.
- **.glb, uncompressed** (no Draco or meshopt). Its own rig, if any, is ignored.

## Bringing one in

1. Put it here as `public/models/tenant.glb` (any name).
2. Check it:

   ```bash
   npx tsx scripts/inspect-model.ts public/models/tenant.glb
   ```

   It lists what's in the file, how it measures up to the brief, the landmarks it
   found (feet, crotch, shoulders, neck, top), the fin and leg angles, and a profile.
3. If a landmark or angle is off, override it in `public/models/tenant.json`:

   ```json
   { "yaw": 180, "landmarks": { "neck": 1.02 }, "armAngle": 25, "legAngle": 5, "head": "goo" }
   ```

4. Test it: `npx tsx scripts/bodymodel.ts public/models/tenant.glb`
5. See it: open the sandbox with `?model=tenant`.

How the fitting works is described at the top of `src/ragdoll/bodyModel.ts`.
