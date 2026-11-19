import RAPIER from '@dimforge/rapier3d-compat';
import { ActiveRagdoll } from './ActiveRagdoll';
// Applies the saved tuning (tuning.json) over config.ts before any ragdoll exists.
import './tuning';

export { ActiveRagdoll } from './ActiveRagdoll';
export type { ActiveRagdollOptions } from './ActiveRagdoll';
export { RAPIER };
export type { Recipe } from './recipe';
export { parseRecipe, randomRecipe, recipeFromEditor, loadIntoEditor, sameLook } from './recipe';

/** Fixed physics step. Small bodies at this scale need a short step to stay stable. */
export const FIXED_DT = 1 / 90;
/** Never simulate more than this per frame, so a long pause (background tab) can't explode it. */
const MAX_FRAME_SECONDS = 0.1;

/**
 * Owns the Rapier world and steps every ragdoll together on a fixed time step.
 * Rapier's wasm is inlined in the -compat build, so this bundles into one file.
 */
export class RagdollPhysics {
  readonly world: RAPIER.World;
  readonly ragdolls: ActiveRagdoll[] = [];
  private accumulator = 0;
  /** Called before every fixed step, e.g. so props can keep their pose for drawing (see alpha). */
  readonly beforeStep: (() => void)[] = [];

  /**
   * How far into the next physics step this frame is, 0..1: draw bodies this far from
   * their pose before the latest step to their current one, so motion looks smooth on
   * screens that don't run at the physics rate.
   */
  get alpha(): number { return this.accumulator / FIXED_DT; }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    // Bodies here are ~0.1 units across; tell Rapier so its tolerances scale down.
    this.world.lengthUnit = 0.5;
    // Extra internal solver passes keep knee/elbow limits holding while strong hip
    // muscles whip the legs (1 pass let knees bend ~30° backwards). Cheaper than
    // raising numSolverIterations: ~0.85 ms vs ~1.1 ms per frame for 13 ragdolls.
    this.world.numInternalPgsIterations = 4;
  }

  /** Rapier must be initialised (async) before any world exists. */
  static async create(): Promise<RagdollPhysics> {
    await RAPIER.init();
    return new RagdollPhysics();
  }

  createRagdoll(options?: ConstructorParameters<typeof ActiveRagdoll>[1]): ActiveRagdoll {
    const r = new ActiveRagdoll(this.world, options);
    this.ragdolls.push(r);
    return r;
  }

  /** Removes a ragdoll from the world and frees it. */
  removeRagdoll(r: ActiveRagdoll): void {
    const i = this.ragdolls.indexOf(r);
    if (i >= 0) this.ragdolls.splice(i, 1);
    r.dispose();
  }

  /** Call once per frame with real elapsed seconds (0 and huge values are both fine). */
  step(seconds: number): number {
    this.accumulator += Math.min(Math.max(seconds, 0), MAX_FRAME_SECONDS);
    let steps = 0;
    while (this.accumulator >= FIXED_DT) {
      for (const f of this.beforeStep) f();
      for (const r of this.ragdolls) { r.rememberPose(); r.fixedUpdate(FIXED_DT); }
      this.world.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    // Draw each body between its last two steps, by how far we are into the next one.
    const alpha = this.alpha;
    for (const r of this.ragdolls) r.syncMeshes(Math.min(Math.max(seconds, 0), MAX_FRAME_SECONDS), alpha);
    return steps;
  }
}
