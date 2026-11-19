import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BODY, BUTT, CLUMSY, EMOTION, GAIT, GRAVITY_COMP, HOVER, JUMP, KNOCKOUT, LIMITS, MOVE, MUSCLES, UPRIGHT } from './config';
import { GooHead, type GooContact } from './goo';
import { Face, acquireSkin, releaseSkin } from './skin';
import { bodyDims, type BodyDims } from './proportions';
import { MoodBlender, MOOD_NAMES, type MoodName } from './mood';
import { traitEffects, type TraitEffects } from './traits';
import { recipeFromEditor, type Recipe } from './recipe';
import { GesturePlayer, GESTURE_NAMES, type GestureEvent, type GestureName } from './gestures';

/*
 * An active ragdoll: a physics skeleton of capsules with a smooth skin draped over it.
 *
 * Skeleton (11 rigid bodies, 10 joints), in the proportions of the character drawing:
 *
 *                    ( head )           big, light, floating just above the body
 *                       | neck          ball joint: bobbly
 *     upperArm ----- chest ----- upperArm      shoulders: very loose ball joints
 *        | elbow       | spine    elbow |      spine: soft ball joint, the body bends
 *     forearm        torso (belly)     forearm  elbows: hinges that bend the fin forward
 *                hip  / \  hip                  hips: ball joints
 *               thigh     thigh
 *           knee  |         |  knee              knees: hinges with limits
 *               shin       shin
 *
 * Every joint has angular spring motors pulling it toward a procedural pose. The
 * skin (skin.ts) is one SkinnedMesh whose bones are these bodies, so it bends
 * smoothly at every joint. The capsules themselves are invisible unless you ask to
 * see the skeleton.
 *
 * How it stays up: the legs do NOT hold the weight. A downward raycast from the
 * belly feeds a PID that pushes it to standing height, and a PD torque keeps it
 * upright and facing the way it's going. The legs just swing in a walk cycle under
 * it. That's the usual trick for game active ragdolls: robust, cheap, and the parts
 * still lag, overshoot and flop because they're real bodies on springy joints.
 *
 * Knockout drops every joint's spring stiffness to zero and switches off the
 * hover and upright controllers, so it collapses. Recovery ramps them back in.
 */

/** Collision groups: 16 bits of "what I am" << 16, then 16 bits of "what I collide with". */
const GROUP_WORLD = 0x0001;
const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;
/**
 * Each tenant gets its own group bit (bits 1..15), and collides with the world and every
 * other tenant's bit, but not its own. That keeps self-collision off (overlapping capsules
 * at the shoulders and hips would fight the joints and jitter) while tenants bump into
 * each other. Past 15 tenants, bits are shared, and tenants sharing one pass through
 * each other.
 */
const FIRST_TENANT_BIT = 1, TENANT_BITS = 15;
const ALL_TENANTS = ((1 << (FIRST_TENANT_BIT + TENANT_BITS)) - 1) & ~GROUP_WORLD;
/** How many live tenants hold each bit. */
const bitUsers = new Array<number>(TENANT_BITS).fill(0);
function takeTenantBit(): number {
  let best = 0;
  for (let i = 1; i < TENANT_BITS; i++) if (bitUsers[i] < bitUsers[best]) best = i;
  bitUsers[best]++;
  return best;
}
const tenantGroups = (slot: number) => {
  const bit = 1 << (FIRST_TENANT_BIT + slot);
  return groups(bit, GROUP_WORLD | (ALL_TENANTS & ~bit));
};
/** The hover ray only sees the world, so it never hits the ragdoll's own legs. */
const RAY_GROUPS = groups(GROUP_WORLD, GROUP_WORLD);

type PartName =
  | 'torso' | 'chest' | 'head'
  | 'upperArmL' | 'forearmL' | 'upperArmR' | 'forearmR'
  | 'thighL' | 'shinL' | 'thighR' | 'shinR';

/**
 * A muscle, described by how it behaves rather than raw Rapier numbers:
 * `frequency` (rad/s) is how quickly the joint snaps to its target, `dampingRatio`
 * how much it overshoots (1 = none, lower = springier). Stiffness and damping are
 * worked out per joint from the inertia of everything hanging off it.
 */
interface Gains { frequency: number; dampingRatio: number }

interface PartDef {
  name: PartName;
  /** Centre of the collider in the rest pose, relative to the leg tips, facing +z. */
  center: THREE.Vector3;
  halfHeight: number;
  radius: number;
  density: number;
  parent?: PartName;
  /** Joint position in the rest pose (same space as center). */
  jointAt?: THREE.Vector3;
  jointType?: 'ball' | 'hinge';
  gains?: Gains;
  /** Hinge limits, in the joint's own angle sign. */
  hingeLimits?: readonly [number, number];
}

/**
 * Builds the rest pose: standing straight, arms hanging down, everything axis-aligned.
 * Bodies are created with identity rotation in this pose, so every joint's
 * reference frame is identity and a motor target of 0 means "back to rest".
 * The skin is built in this same pose, so it's also the skin's bind pose.
 */
/** How big the head is compared with the belly, relative to the drawing (1 = as drawn). */
function headVsBelly(B: BodyDims): number {
  const bellyScale = Math.cbrt((B.bellyR / BODY.bellyR) ** 2 * (B.bellyLen / BODY.bellyLen));
  return B.headScale / bellyScale;
}

function buildParts(B: BodyDims): PartDef[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const elbowY = B.shoulderY - B.upperArmLen;
  const kneeY = B.hipY - B.thighLen;
  // Capsules span a joint-to-joint length exactly: halfHeight = len/2 − radius.
  const span = (len: number, r: number) => Math.max(0.001, len / 2 - r);
  const d = BODY.density;
  // Wider fins keep the drawn fins' weight too (they'd otherwise drag the body about).
  const finDensity = d / Math.max(1, B.finWidthScale) ** 2;

  const parts: PartDef[] = [
    { name: 'torso', center: v(0, B.bellyY, 0), halfHeight: span(B.bellyLen, B.bellyR), radius: B.bellyR, density: BODY.bellyDensity },
    {
      name: 'chest', center: v(0, B.spineY + B.chestLen / 2, 0), halfHeight: span(B.chestLen, B.chestR), radius: B.chestR,
      density: d, parent: 'torso', jointAt: v(0, B.spineY, 0), jointType: 'ball', gains: MUSCLES.spine,
    },
    {
      name: 'head', center: v(0, B.headY, 0), halfHeight: 0.001, radius: B.headColliderR,
      // A head that's big FOR ITS BODY is a bigger balloon, not a heavier rock: it's
      // lightened so it's never heavier, relative to the belly, than in the drawing, or
      // the belly can't balance it (a slim baby: big head, tiny belly). Relatively
      // smaller heads just get lighter.
      density: BODY.headDensity / Math.max(1, headVsBelly(B)) ** 3,
      parent: 'chest', jointAt: v(0, B.neckY, 0), jointType: 'ball', gains: MUSCLES.neck,
    },
  ];
  // +x is the character's LEFT when it faces +z.
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    parts.push(
      {
        name: `upperArm${side}`, center: v(sx * B.shoulderX, B.shoulderY - B.upperArmLen / 2, 0),
        halfHeight: span(B.upperArmLen, B.upperArmR), radius: B.upperArmR, density: finDensity,
        parent: 'chest', jointAt: v(sx * B.shoulderX, B.shoulderY, 0), jointType: 'ball', gains: MUSCLES.shoulder,
      },
      {
        // A hinge across the fin's flat face, so it bends forward like a flipper rather
        // than edgewise. Forward (tip toward +z) is a negative rotation about +x.
        name: `forearm${side}`, center: v(sx * B.shoulderX, elbowY - B.forearmLen / 2, 0),
        halfHeight: span(B.forearmLen, B.forearmR), radius: B.forearmR, density: finDensity,
        parent: `upperArm${side}`, jointAt: v(sx * B.shoulderX, elbowY, 0), jointType: 'hinge', gains: MUSCLES.elbow,
        hingeLimits: [-LIMITS.finBend[1], -LIMITS.finBend[0]],
      },
      {
        name: `thigh${side}`, center: v(sx * B.hipX, B.hipY - B.thighLen / 2, 0),
        halfHeight: span(B.thighLen, B.thighR), radius: B.thighR, density: d,
        parent: 'torso', jointAt: v(sx * B.hipX, B.hipY, 0), jointType: 'ball', gains: MUSCLES.hip,
      },
      {
        name: `shin${side}`, center: v(sx * B.hipX, kneeY - B.shinLen / 2, 0),
        halfHeight: span(B.shinLen, B.shinR), radius: B.shinR, density: d,
        parent: `thigh${side}`, jointAt: v(sx * B.hipX, kneeY, 0), jointType: 'hinge', gains: MUSCLES.knee,
        // Knees bend the tip backward (−z), a positive rotation about +x.
        hingeLimits: [LIMITS.kneeBend[0], LIMITS.kneeBend[1]],
      },
    );
  }
  return parts;
}

interface Part {
  def: PartDef;
  body: RAPIER.RigidBody;
  /** The skin bone that follows this body. */
  bone: THREE.Bone;
  /** The capsule, drawn only when the skeleton is shown. */
  debugMesh: THREE.Mesh;
  collider: RAPIER.Collider;
  /** Its mass, read once (it never changes), so the per-step code needn't ask Rapier. */
  mass: number;
  /** Its pose before the latest physics step: the drawn pose blends from this to the current one. */
  prevPos: THREE.Vector3;
  prevRot: THREE.Quaternion;
}

interface Joint {
  def: PartDef;
  /** Set for ball joints (3 angular motors). */
  ball?: RAPIER.SphericalImpulseJoint;
  /** Set for hinges (1 motor about the parent's x axis). */
  hinge?: RAPIER.RevoluteImpulseJoint;
  /** Motor targets, radians, in the parent's frame: rotation about x, y, z. Hinges use x only. */
  target: THREE.Vector3;
  /**
   * How fast the target itself is moving (rad/s, same axes). Rapier's motor damping
   * pulls the joint toward THIS velocity; with 0 it would brake every fast swing and
   * the legs would only reach about half their stride.
   */
  targetVel: THREE.Vector3;
  /** Inertia of the whole limb below this joint, about the joint (kg·u²). Scales the muscle. */
  inertia: number;
}

const STAGGER_SECONDS = 0.7;
/** Ground checks around the belly, for edges. */
const EDGE_PROBES = 8, PROBES_PER_STEP = 1;
/** How long an idle blink holds the eyes shut. */
const BLINK_SECONDS = 0.09;
/** How far (radians, per axis) the neck may turn to keep the head level. */
const MAX_NECK_ANGLE = 0.7;
const ZERO = new THREE.Vector3();

const AXES = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ] as const;

// Debug capsule geometry is shared between every ragdoll.
const sharedCapsules = new Map<string, THREE.BufferGeometry>();
function capsuleGeometry(halfHeight: number, radius: number): THREE.BufferGeometry {
  const key = `${halfHeight.toFixed(4)}:${radius.toFixed(4)}`;
  let geo = sharedCapsules.get(key);
  if (!geo) {
    geo = new THREE.CapsuleGeometry(radius, halfHeight * 2, 4, 10);
    sharedCapsules.set(key, geo);
  }
  return geo;
}
const skeletonMaterial = new THREE.MeshBasicMaterial({
  color: 0xff3366, wireframe: true, depthTest: false, transparent: true, opacity: 0.6,
});

export interface ActiveRagdollOptions {
  /**
   * The tenant's look (see recipe.ts): shape, traits, colour and starting mood. Without
   * one it takes the shared look (PROPORTIONS + TRAITS) and `color`.
   */
  recipe?: Recipe;
  color?: string;
  /** Where the leg tips start, in world space. */
  position?: THREE.Vector3;
  /** Facing, radians around y. 0 faces +z; positive turns toward +x. */
  facing?: number;
}

export class ActiveRagdoll {
  /** Add to the scene. Everything inside is placed in world space every frame. */
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  /** The skin. Also what a mouse click should raycast against. */
  readonly skin: THREE.SkinnedMesh;

  private readonly world: RAPIER.World;
  /** This ragdoll's size and shape, fixed when it's created (from PROPORTIONS and TRAITS). */
  readonly dims: BodyDims;
  /** What its age, weight and fitness do to how it moves, fixed when it's created. */
  readonly traits: TraitEffects;
  /** Its look, as given (or as the shared look was when it was made). Kept up to date by setColor. */
  readonly recipe: Recipe;
  private readonly parts = new Map<PartName, Part>();
  /** This tenant's collision bit (see takeTenantBit). */
  private readonly collisionSlot = takeTenantBit();
  /**
   * The collision groups its body uses: the world and other tenants, never itself.
   * Something it holds uses these too, so it doesn't bump its carrier.
   */
  readonly collisionGroups = tenantGroups(this.collisionSlot);
  private readonly joints: Joint[] = [];
  private readonly torso: Part;
  private readonly chest: Part;
  private readonly skeletonGroup = new THREE.Group();
  private readonly face: Face;
  /** How awake the face looks, 0..1: eased toward its target so eyes close and open smoothly. */
  private faceAwake = 1;
  /** When the next idle blink starts, in seconds of this ragdoll's time. */
  private nextBlink = 2 + Math.random() * 3;

  // ---- Mood ----
  /** Seconds left of looking startled after a shove. */
  private surpriseTimer = 0;
  /** Goes up 1 per shove and drains over time; at EMOTION.shovesToAnger it gets angry. */
  private annoyance = 0;
  /** Seconds left of being angry. */
  private angryTimer = 0;
  /** When the last shove landed, in this ragdoll's time. */
  private lastShoveTime = -Infinity;
  /** Eased 0..1 amounts shown on the face and body. */
  private surprise = 0;
  private anger = 0;
  /** Moods and reactions, blended into posture and face letters (see mood.ts). */
  private readonly moods = new MoodBlender();
  /** One-off gestures and reactions (wave, bow, stomp...) played over the mood. */
  private readonly gestures = new GesturePlayer();
  /** What a gesture's events do: hop, a little startled hop, a stomp's thump. */
  private readonly fireGesture = (e: GestureEvent): void => {
    if (e === 'hop') this.jump();
    else if (e === 'smallHop') {
      if (!this.grounded || this.jumpPhase !== 'ground') return;
      this.force.x = 0; this.force.y = (1.4 * this.traits.jump - this.vel.y) * this.totalMass; this.force.z = 0;
      this.torso.body.applyImpulse(this.force, true);
      this.jumpPhase = 'air';
      this.airTime = 0;
    } else if (e === 'thump') {
      this.squash = 1;
      this.tmpV.set(0, -1.2, 0); // the head's goo jolts down
      this.goo.kick(this.tmpV, this.part('head').bone.quaternion);
    }
  };
  /** Reaction strengths handed to the blender each step (reused, not reallocated). */
  private readonly reactions = { angry: 0, surprised: 0, focused: 0, teetering: 0 };

  // Clumsiness (see CLUMSY): edge probes around the belly, teetering, slips and trips.
  /** Which of the EDGE_PROBES directions have ground under them (one is re-checked each step). */
  private readonly edgeSupported = new Array<boolean>(EDGE_PROBES).fill(true);
  private edgeProbe = 0;
  /** Seconds spent at an edge; at CLUMSY.teeterSeconds it slips or catches itself. */
  private edgeTime = 0;
  private edgeCooldown = 0;
  /** Unit direction toward the drop (horizontal), and how much of its footing is gone. */
  private readonly edgeDir = new THREE.Vector3();
  private edgeShare = 0;
  /** Eased 0..1: how hard it's teetering (pose, lean and face). */
  private teeter = 0;
  /** Was it standing last step, the highest its belly got while not, and a landing waiting to be judged. */
  private wasStanding = true;
  private peakY = -Infinity;
  private landPending = -1;
  private landImpact = 0;
  /** Knocked down by a slip or trip (not by K or a throw): gets up by itself after this long. */
  private tumbleTimer = 0;
  private tumbling = false;
  private bumpCooldown = 0;
  /** Phase of the breathing cycle (its rate changes with energy, so it's accumulated). */
  private breathPhase = 0;
  /** Eased 0..1 serious "game face", worn while jumping. */
  private focus = 0;
  /** Seconds the game face lingers after landing. */
  private focusHold = 0;
  // ---- Head goo (visual glop, see goo.ts) ----
  private goo!: GooHead;
  private readonly lastHeadVel = new THREE.Vector3();
  private readonly headVel = new THREE.Vector3();
  /** The head's acceleration, summed over this frame's physics steps (and how many), for the goo. */
  private readonly headAccelSum = new THREE.Vector3();
  private headAccelSteps = 0;
  private readonly headAccel = new THREE.Vector3();
  /** What the head's touching this step, for the goo to flatten against. */
  private readonly gooContact: GooContact = { active: false, normal: new THREE.Vector3(0, 1, 0), reach: 0 };
  // Head contacts found this step: summed normals, and the callbacks (made once, so the
  // per-step contact query allocates nothing).
  private readonly contactSum = new THREE.Vector3();
  private readonly contactNormal = { x: 0, y: 0, z: 0 };
  private contactCount = 0;
  private onHeadPair!: (other: RAPIER.Collider) => void;
  private onHeadManifold!: (m: RAPIER.TempContactManifold, flipped: boolean) => void;
  private readonly baseColor = new THREE.Color();
  private readonly flushColor = new THREE.Color(EMOTION.flushColor);
  private readonly totalMass: number;
  private readonly torsoInertia: number;

  // ---- Inputs ----
  /** Wanted move direction on the ground plane, world space, length 0..1. */
  private readonly moveInput = new THREE.Vector2();
  private strolling = false;
  private knockedOut = false;

  // ---- Controller state ----
  /** 0 = limp, 1 = full strength. Drops to 0 instantly on knockout, ramps back up on recovery. */
  private muscle = 1;
  private facing = 0;
  private gaitPhase = 0;
  /** How fast gaitPhase advances, rad/s. Needed for the motors' velocity targets. */
  private gaitRate = 0;
  private gaitWeight = 0;
  private heightIntegral = 0;
  private time = 0;
  private grounded = false;
  private groundY = 0;
  /** Seconds left of a shove stagger, during which balance and steering are weakened. */
  private stagger = 0;

  // ---- Jump ----
  private jumpPhase: 'ground' | 'crouch' | 'air' = 'ground';
  /** Seconds left of the take-off crouch. */
  private crouchTimer = 0;
  /** Seconds since take-off. */
  private airTime = 0;
  /** Eased 0..1: how much of the airborne pose (tucked legs, flung-up fins) to show. */
  private air = 0;

  // ---- Carrying ----
  /** Holding something overhead (wanted, and eased 0..1 for the pose). */
  private holdWanted = false;
  private heldBody: RAPIER.RigidBody | null = null;
  /** In front, hugged in the fins (things), or hoisted overhead (someone else). */
  private holdStyle: 'front' | 'overhead' = 'front';
  private hold = 0;
  /** Being carried by someone else: weightless, kicking, startled. */
  private carried = false;
  /** 0..1 landing squash, decaying after touchdown. */
  private squash = 0;

  // ---- Scratch objects: nothing is allocated per step ----
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly vel = { x: 0, y: 0, z: 0 };
  private readonly angVel = { x: 0, y: 0, z: 0 };
  private readonly force = { x: 0, y: 0, z: 0 };
  private readonly torque = { x: 0, y: 0, z: 0 };
  private readonly qTarget = new THREE.Quaternion();
  private readonly qLean = new THREE.Quaternion();
  private readonly qCur = new THREE.Quaternion();
  private readonly qErr = new THREE.Quaternion();
  private readonly qHead = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly qTip = new THREE.Quaternion();
  private readonly tmpAxis = new THREE.Vector3();
  // The butt's jiggle: a spring bone that follows the belly (see syncMeshes).
  private readonly buttBone = new THREE.Bone();
  private readonly buttRest = new THREE.Vector3();
  private readonly buttFromTorso = new THREE.Vector3();
  private readonly torso0 = new THREE.Vector3();
  private readonly buttVel = new THREE.Vector3();
  private readonly buttTarget = new THREE.Vector3();
  private readonly buttTargetVel = new THREE.Vector3();
  private buttSettled = false;
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);

  constructor(world: RAPIER.World, options: ActiveRagdollOptions = {}) {
    this.world = world;
    this.recipe = structuredClone(options.recipe ?? recipeFromEditor('Tenant', options.color ?? '#3a86ff', 'calm'));
    this.material = new THREE.MeshStandardMaterial({
      color: this.recipe.color, roughness: 0.7, metalness: 0,
      // Both sides: where skinning folds the skin over itself (a fin pressed to the chest)
      // the fold shows skin, not a hole.
      side: THREE.DoubleSide,
      shadowSide: THREE.BackSide, // only the inside casts shadows, so the skin doesn't shadow itself in stripes
    });
    this.baseColor.copy(this.material.color);
    const start = options.position ?? new THREE.Vector3();
    this.facing = options.facing ?? 0;
    this.dims = bodyDims(this.recipe.proportions, this.recipe.traits);
    this.traits = traitEffects(this.recipe.traits);
    this.moods.base = this.traits.posture;
    const defs = buildParts(this.dims);

    // Bodies first, in the rest pose (rotated to the starting facing). Each gets a
    // bone for the skin, which simply copies the body's transform every frame.
    const qFacing = new THREE.Quaternion().setFromAxisAngle(this.axisY, this.facing);
    for (const def of defs) {
      const p = def.center.clone().applyQuaternion(qFacing).add(start);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation(qFacing)
          // A touch of damping keeps idle parts from buzzing; not enough to look floaty.
          .setLinearDamping(0.1)
          .setAngularDamping(0.4)
          .setCanSleep(false),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(def.halfHeight, def.radius)
          .setDensity(def.density)
          .setFriction(BODY.limbFriction)
          .setCollisionGroups(this.collisionGroups),
        body,
      );
      const bone = new THREE.Bone();
      bone.name = def.name;
      bone.position.copy(p);
      bone.quaternion.copy(qFacing);
      this.group.add(bone);
      const debugMesh = new THREE.Mesh(capsuleGeometry(def.halfHeight, def.radius), skeletonMaterial);
      debugMesh.renderOrder = 20;
      this.skeletonGroup.add(debugMesh);
      this.parts.set(def.name, { def, body, bone, debugMesh, collider, mass: body.mass(), prevPos: p.clone(), prevRot: qFacing.clone() });
    }
    this.skeletonGroup.visible = false;
    this.group.add(this.skeletonGroup);

    // The skin. Its bind pose is the rest pose at the origin, facing +z, so each
    // bone's inverse bind matrix just undoes that part's rest position.
    // Plus one bone that isn't a physics body: the butt, which springs after the belly.
    const C = this.dims.cheeks;
    this.torso0.copy(defs.find((d) => d.name === 'torso')!.center);
    this.buttRest.set(0, C.y, C.z);
    this.buttFromTorso.copy(this.buttRest).sub(this.torso0);
    this.buttBone.position.copy(this.buttRest).applyQuaternion(qFacing).add(start);
    this.group.add(this.buttBone);
    const bones = [...defs.map((d) => this.part(d.name).bone), this.buttBone];
    const boneInverses = [
      ...defs.map((d) => new THREE.Matrix4().makeTranslation(-d.center.x, -d.center.y, -d.center.z)),
      new THREE.Matrix4().makeTranslation(0, -C.y, -C.z),
    ];
    const skeleton = new THREE.Skeleton(bones, boneInverses);
    const boneIndex = (name: string) =>
      name === 'butt' ? defs.length : name === '__count' ? defs.length + 1 : defs.findIndex((d) => d.name === name);
    this.skin = new THREE.SkinnedMesh(acquireSkin(boneIndex, this.dims), this.material);
    this.skin.bind(skeleton, new THREE.Matrix4());
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    // The skin moves far from where it was built; its rest-pose bounds would cull it wrongly.
    this.skin.frustumCulled = false;
    this.group.add(this.skin);

    // The head: a ball of goo on the head bone (the shared skin has no head).
    this.goo = new GooHead(this.dims.headR, this.material);
    this.part('head').bone.add(this.goo.mesh);
    this.gooContact.reach = this.dims.headColliderR;
    // The face rides on the head bone.
    // The face is laid out for the drawn head size, then scaled with the head.
    // Each tenant favours a side when it concentrates (from its name, so it stays put).
    let h = 0;
    for (const c of this.recipe.name) h = (h * 31 + c.charCodeAt(0)) | 0;
    this.face = new Face(BODY.headR, this.dims.face, h & 1 ? -1 : 1);
    this.face.root.scale.setScalar(this.dims.headScale);
    this.face.pinTo(this.goo, this.dims.headScale);
    this.part('head').bone.add(this.face.root);

    // Then joints. Identity rotations at rest mean the joint frames are identity,
    // so anchors are just "joint position minus body centre" in each body's space.
    for (const part of this.parts.values()) {
      const def = part.def;
      if (!def.parent || !def.jointAt || !def.jointType) continue;
      const parent = this.part(def.parent);
      const a1 = def.jointAt.clone().sub(parent.def.center);
      const a2 = def.jointAt.clone().sub(def.center);
      const joint: Joint = {
        def, target: new THREE.Vector3(), targetVel: new THREE.Vector3(), inertia: this.chainInertia(def),
      };

      // Force-based motors, not acceleration-based: Rapier's acceleration-based motors
      // only account for the body directly on the joint, so a hip motor ignores the
      // shin hanging below and barely moves the leg (−6° of a 46° swing in a test).
      // Force-based motors with stiffness scaled by the whole limb's inertia track it.
      if (def.jointType === 'ball') {
        const raw = world.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), parent.body, part.body, true);
        // rapier3d-compat 0.21 builds spherical joints as generic ones and hands back a
        // class without the motor methods. Re-wrapping the same handle as a
        // SphericalImpulseJoint gives us the per-axis motor API for it.
        const ball = new RAPIER.SphericalImpulseJoint(world.impulseJoints.raw, world.bodies, raw.handle);
        for (const axis of AXES) ball.configureMotorModel(axis, RAPIER.MotorModel.ForceBased);
        joint.ball = ball;
      } else {
        const data = RAPIER.JointData.revolute(a1, a2, this.axisX);
        const hinge = world.createImpulseJoint(data, parent.body, part.body, true) as RAPIER.RevoluteImpulseJoint;
        // Limits must be set on the created joint: rapier3d-compat 0.21 ignores
        // `limitsEnabled`/`limits` on JointData, which let knees bend backwards.
        hinge.setLimits(def.hingeLimits![0], def.hingeLimits![1]);
        hinge.configureMotorModel(RAPIER.MotorModel.ForceBased);
        joint.hinge = hinge;
      }
      this.joints.push(joint);
    }

    this.torso = this.part('torso');
    this.chest = this.part('chest');
    let mass = 0;
    for (const p of this.parts.values()) mass += p.body.mass();
    this.totalMass = mass;
    // The balance torque is applied to the belly alone (it's an explicit force, so it
    // must stay within what the belly can absorb in one step, or it overshoots and
    // blows up). The belly is made dense, like a pelvis, so it can anchor the rest.
    const I = this.torso.body.principalInertia();
    this.torsoInertia = ((I.x + I.y + I.z) / 3) * UPRIGHT.inertiaBoost;

    // Head contact callbacks for the goo. The normal Rapier reports points
    // from the first collider of the manifold to the second, so it's flipped as needed
    // to point out of the surface, into the head.
    const headCollider = this.part('head').collider;
    this.onHeadManifold = (m, flipped) => {
      if (m.numContacts() === 0) return;
      m.normal(this.contactNormal as RAPIER.Vector);
      const s = flipped ? 1 : -1;
      this.contactSum.x += s * this.contactNormal.x;
      this.contactSum.y += s * this.contactNormal.y;
      this.contactSum.z += s * this.contactNormal.z;
      this.contactCount++;
    };
    this.onHeadPair = (other) => this.world.contactPair(headCollider, other, this.onHeadManifold);

    this.setMood(this.recipe.mood);
    this.poseLimbs();
    this.applyMotors();
  }

  // ------------------------------------------------------------------ inputs

  /** The meshes a mouse click should hit to pick this tenant (visible, real geometry). */
  get hitMeshes(): THREE.Mesh[] {
    return [this.skin, this.goo.mesh];
  }

  /** Its colour, as '#rrggbb'. */
  setColor(hex: string): void {
    this.recipe.color = hex;
    this.baseColor.set(hex);
    this.material.color.set(hex);
  }

  /** Wanted movement on the ground plane in world space (x east, z north), length 0..1. */
  setMoveInput(x: number, z: number, strolling = false): void {
    this.moveInput.set(x, z);
    if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();
    this.strolling = strolling;
  }

  /** Knock out (all joint spring stiffness → 0, balance off) or start getting back up. */
  setKnockedOut(out: boolean): void {
    if (!out) this.tumbling = false;
    if (out === this.knockedOut) return;
    this.knockedOut = out;
    if (out) {
      this.muscle = 0; // instant: a knockout is a switch, not a fade
      this.gestures.stop();
      this.heightIntegral = 0;
      this.applyMotors();
    }
  }

  get isKnockedOut(): boolean { return this.knockedOut; }

  /** Show the physics capsules (the skeleton) drawn over the skin. */
  setShowSkeleton(show: boolean): void { this.skeletonGroup.visible = show; }
  get showingSkeleton(): boolean { return this.skeletonGroup.visible; }

  /**
   * A shove: a velocity change for the whole body, in units/s. It's applied to the
   * belly scaled by the WHOLE body's mass (the rest is dragged along through the
   * joints), then balance and steering go weak for a moment so it staggers and
   * windmills instead of being braked on the spot.
   */
  push(dv: THREE.Vector3): void {
    const m = this.totalMass;
    this.force.x = dv.x * m; this.force.y = dv.y * m; this.force.z = dv.z * m;
    this.torso.body.applyImpulse(this.force, true);
    this.stagger = STAGGER_SECONDS;
    // Mood: every shove startles it, and too many close together make it angry.
    // Shoving it while it's already angry keeps it angry for longer.
    this.surpriseTimer = EMOTION.surpriseSeconds;
    this.annoyance = Math.min(EMOTION.shovesToAnger, this.annoyance + 1);
    this.lastShoveTime = this.time;
    if (this.annoyance >= EMOTION.shovesToAnger) this.angryTimer = EMOTION.angrySeconds;
  }

  /**
   * Jump, if it's standing on something and has its strength. It crouches for a moment
   * first (so the jump reads), then launches; see updateJump.
   */
  jump(): void {
    if (this.knockedOut || this.muscle < 0.8 || !this.grounded || this.jumpPhase !== 'ground') return;
    this.jumpPhase = 'crouch';
    this.crouchTimer = JUMP.crouchSeconds;
  }

  get isAirborne(): boolean { return this.jumpPhase === 'air' || !this.grounded; }

  /**
   * Plays a gesture or reaction (see gestures.ts): wave, hop, spin, wiggle, bow, slump,
   * stomp, flinch, startle, celebrate, shrug, sigh, nod, shake. Starting one cuts over
   * from any already playing. Ignored while knocked out.
   */
  playGesture(name: GestureName): void {
    if (this.knockedOut || this.carried) return;
    this.gestures.play(name);
  }
  get gesture(): GestureName | null { return this.gestures.name; }
  static readonly gestureNames = GESTURE_NAMES;

  /** Sets the mood it's in (see mood.ts for the list). It crossfades over about half a second. */
  setMood(mood: MoodName, strength = 1): void {
    this.moods.mood = mood;
    this.moods.strength = Math.max(0, Math.min(1, strength));
  }
  get mood(): MoodName { return this.moods.mood; }
  static readonly moodNames = MOOD_NAMES;

  /**
   * Holding something overhead: fins up, a little lean back. The caller attaches the
   * held thing (see `holdPoint` and `chestBody`); this only does the pose.
   */
  /**
   * @param body what it's holding, if it's a free body jointed to the chest: jumps and
   *   bounces take it along at the same speed, so its inertia doesn't wrench the carrier.
   */
  setHolding(on: boolean, style: 'front' | 'overhead' = 'front', body: RAPIER.RigidBody | null = null): void {
    this.holdWanted = on;
    this.heldBody = on ? body : null;
    if (on) this.holdStyle = style;
  }

  /** Gives the held body (if any) this upward speed, keeping its sideways speed. */
  private liftHeld(upSpeed: number): void {
    const b = this.heldBody;
    if (!b || !b.isValid()) return;
    const v = b.linvel();
    b.setLinvel({ x: v.x, y: upSpeed, z: v.z }, true);
  }
  get isHolding(): boolean { return this.holdWanted; }

  /**
   * Being carried by someone else: it floats weightless on whatever joint holds it (so it
   * doesn't drag its carrier down), kicks its legs and flails its fins, and looks
   * startled. Balance, hover and walking are off. Let go of it with `setCarried(false)`;
   * to throw it, knock it out first (it goes limp in the air and gets up after landing).
   */
  setCarried(on: boolean): void {
    if (on === this.carried) return;
    this.carried = on;
    if (on) {
      this.gestures.stop();
      this.jumpPhase = 'ground';
      this.setMoveInput(0, 0);
    }
  }
  get isCarried(): boolean { return this.carried; }
  /** The whole body's mass. */
  get mass(): number { return this.totalMass; }

  /** The chest, for attaching something held overhead. */
  get chestBody(): RAPIER.RigidBody { return this.chest.body; }
  /** The belly, for being held by. */
  get bellyBody(): RAPIER.RigidBody { return this.torso.body; }
  /** Where a held thing goes, in the chest's own frame: up above the head. */
  holdPoint(extra = 0, style: 'front' | 'overhead' = 'front'): { x: number; y: number; z: number } {
    const d = this.dims;
    if (style === 'overhead') {
      const aboveHead = d.headY + d.headR - (d.spineY + d.chestLen / 2);
      return { x: 0, y: aboveHead + 0.04 + extra, z: 0.02 };
    }
    // In front of the chest, a little low, between the fins: just clear of the body.
    return { x: 0, y: -0.02, z: d.chestR + 0.03 + extra };
  }

  /**
   * Bounced into the air (a trampoline): upward speed in units/s. Works standing, or
   * coming down from a bounce once it's back at standing height, so it rebounds the
   * moment it lands instead of first squashing and settling. Returns whether it did.
   */
  launch(upSpeed: number): boolean {
    if (this.knockedOut || this.carried || !this.grounded || this.jumpPhase === 'crouch') return false;
    if (this.jumpPhase === 'air') {
      const height = this.torso.body.translation().y - this.groundY;
      if (this.vel.y > 0 || height > this.dims.hoverHeight + 0.02) return false;
    }
    // Every part leaves at the same upward speed, so the whole body goes up together
    // instead of the belly yanking the limbs after it.
    for (const p of this.parts.values()) {
      const v = p.body.linvel();
      p.body.setLinvel({ x: v.x, y: upSpeed, z: v.z }, true);
    }
    this.liftHeld(upSpeed);
    this.jumpPhase = 'air';
    this.airTime = 0;
    this.heightIntegral = 0;
    return true;
  }

  /** Is it angry right now (from too many shoves)? */
  get isAngry(): boolean { return this.angryTimer > 0; }

  /** Teleports to a standing rest pose at `position`, facing `facing`, with everything still. */
  reset(position: THREE.Vector3, facing = this.facing): void {
    this.facing = facing;
    this.qTarget.setFromAxisAngle(this.axisY, facing);
    const zero = { x: 0, y: 0, z: 0 };
    for (const p of this.parts.values()) {
      this.tmpV.copy(p.def.center).applyQuaternion(this.qTarget).add(position);
      p.body.setTranslation(this.tmpV, true);
      p.body.setRotation(this.qTarget, true);
      p.body.setLinvel(zero, true);
      p.body.setAngvel(zero, true);
      p.body.resetForces(true);
      p.body.resetTorques(true);
    }
    this.buttSettled = false;
    this.knockedOut = false;
    this.tumbling = false;
    this.teeter = this.edgeTime = this.edgeCooldown = 0;
    this.peakY = -Infinity;
    this.landPending = -1;
    this.bumpCooldown = 0;
    this.wasStanding = true;
    this.edgeSupported.fill(true);
    this.muscle = 1;
    this.heightIntegral = 0;
    this.gaitWeight = 0;
    this.stagger = 0;
    this.lastHeadVel.set(0, 0, 0);
    this.headAccelSum.set(0, 0, 0);
    this.headAccelSteps = 0;
    this.goo.reset();
    this.face.followSurface();
    this.jumpPhase = 'ground';
    this.air = this.squash = 0;
    this.gestures.stop();
    this.carried = false;
    this.holdWanted = false;
    this.heldBody = null;
    this.hold = 0;
    this.faceAwake = 1;
    this.surpriseTimer = this.annoyance = this.angryTimer = this.surprise = this.anger = 0;
    this.focus = this.focusHold = 0;
    this.face.setExpression(1, this.moods.letters);
    this.material.color.copy(this.baseColor);
    this.poseLimbs();
    this.applyMotors();
    this.rememberPose(); // a teleport: don't draw it sliding across from where it was
  }

  // ------------------------------------------------------------------ stepping

  /**
   * Call before each world.step(): keeps every body's pose, so syncMeshes can draw the body
   * partway between the last two steps. Physics runs at a fixed rate the screen doesn't
   * match (90 Hz on a 60 Hz screen is 1, 2, 1, 2 steps a frame), and drawing only the
   * latest step makes the body stutter against a smoothly moving camera.
   */
  rememberPose(): void {
    for (const p of this.parts.values()) {
      const t = p.body.translation(), r = p.body.rotation();
      p.prevPos.set(t.x, t.y, t.z);
      p.prevRot.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Call once per fixed physics step, BEFORE world.step(). */
  fixedUpdate(dt: number): void {
    this.time += dt;
    const torso = this.torso.body;

    // Safety net: if the simulation ever produces garbage or the body falls out of
    // the world, snap back to standing rather than flying off.
    const t = torso.translation();
    if (!Number.isFinite(t.x + t.y + t.z) || t.y < this.groundY - 3) {
      this.tmpV.set(Number.isFinite(t.x) ? t.x : 0, this.groundY, Number.isFinite(t.z) ? t.z : 0);
      this.reset(this.tmpV);
      return;
    }

    // Muscles come back over time after a knockout, so getting up looks wobbly.
    if (!this.knockedOut && this.muscle < 1) {
      this.muscle = Math.min(1, this.muscle + dt / (KNOCKOUT.recoverSeconds * this.traits.recover));
    }
    // Ease-in curve: the first moments of recovery are very weak, then it firms up.
    const strength = this.muscle * this.muscle;

    // Rapier keeps added forces until they're reset, so clear them each step. Only the
    // belly is ever given a torque, so only it needs its torques cleared.
    for (const p of this.parts.values()) p.body.resetForces(true);
    torso.resetTorques(true);
    torso.linvel(this.vel as RAPIER.Vector);

    this.updateMood(dt);
    const P = this.moods.letters;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    // Energy changes how fast it chooses to walk: a tired shuffle, an excited scurry.
    const maxSpeed = (this.strolling ? MOVE.strollSpeed : MOVE.walkSpeed) * (1 + 0.25 * P.energy) * this.traits.speed;
    const wantX = this.knockedOut || this.carried ? 0 : this.moveInput.x * maxSpeed;
    const wantZ = this.knockedOut || this.carried ? 0 : this.moveInput.y * maxSpeed;

    this.updateFacing(dt);
    this.updateGait(dt, speed);

    // Staggering: steering and balance come back gradually over the stagger time.
    this.stagger = Math.max(0, this.stagger - dt);
    const steady = 1 - 0.85 * (this.stagger / STAGGER_SECONDS);

    // Ease the overhead-holding pose in and out.
    this.hold += ((this.holdWanted ? 1 : 0) - this.hold) * Math.min(1, dt * 6);

    if (this.carried) {
      // Carried: weightless (every part lifted by its own weight, so it doesn't drag its
      // carrier down), startled, and none of its own balance or walking.
      for (const p of this.parts.values()) {
        this.force.x = 0; this.force.y = p.mass * 9.81; this.force.z = 0;
        p.body.addForce(this.force, true);
      }
      this.surpriseTimer = Math.max(this.surpriseTimer, 0.3);
      this.grounded = false;
    } else if (strength > 0) {
      this.applyGravityCompensation(strength);
      this.updateJump(dt);
      this.applyHover(dt, t, strength);
      this.applyMove(wantX, wantZ, strength * steady * steady);
      this.applyUpright(wantX, wantZ, speed, strength * (0.4 + 0.6 * steady));
    }

    this.updateClumsy(dt);
    this.poseLimbs();
    this.applyMotors();
    this.updateFace(dt);
    this.trackHead(dt);
  }

  /**
   * Bumps between two tenants, checked after each physics step: if their heads or
   * bellies touch while closing fast, each staggers, and may be knocked over, by how
   * hard it was hit (the lighter one takes more of it) and how clumsy it is.
   */
  static checkBump(a: ActiveRagdoll, b: ActiveRagdoll): void {
    if (a.carried || b.carried) return;
    const ta = a.torso.body.translation(), tb = b.torso.body.translation();
    let nx = tb.x - ta.x, ny = tb.y - ta.y, nz = tb.z - ta.z;
    let d = Math.hypot(nx, ny, nz);
    let touching = d < a.dims.bellyR + b.dims.bellyR + 0.03;
    if (!touching) {
      const ha = a.part('head'), hb = b.part('head');
      const pa = ha.body.translation(), pb = hb.body.translation();
      const hx = pb.x - pa.x, hy = pb.y - pa.y, hz = pb.z - pa.z, hd = Math.hypot(hx, hy, hz);
      if (hd < ha.def.radius + hb.def.radius + 0.02) { touching = true; nx = hx; ny = hy; nz = hz; d = hd; }
    }
    if (!touching || d < 1e-6) return;
    nx /= d; ny /= d; nz /= d;
    const va = a.torso.body.linvel(), vb = b.torso.body.linvel();
    const closing = (va.x - vb.x) * nx + (va.y - vb.y) * ny + (va.z - vb.z) * nz;
    if (closing < CLUMSY.bumpSafe) return;
    const ma = a.totalMass, mb = b.totalMass;
    a.bumped(closing * (2 * mb / (ma + mb)), -nx, -nz);
    b.bumped(closing * (2 * ma / (ma + mb)), nx, nz);
  }

  /** Hit this hard (u/s, already weighted by mass), from the side opposite (dx, dz). */
  private bumped(hit: number, dx: number, dz: number): void {
    if (this.knockedOut || this.bumpCooldown > 0) return;
    const C = CLUMSY;
    const s = THREE.MathUtils.smoothstep(hit, C.bumpSafe, C.bumpSure);
    if (s <= 0) return;
    this.bumpCooldown = C.bumpCooldown;
    this.stagger = Math.max(this.stagger, STAGGER_SECONDS * (0.4 + 0.6 * s));
    if (s > 0.3) this.surpriseTimer = Math.max(this.surpriseTimer, EMOTION.surpriseSeconds * s);
    if (Math.random() < Math.min(0.95, s * C.bumpTrip * C.amount * this.traits.clumsy)) {
      const h = Math.hypot(dx, dz) || 1;
      const k = 0.4 + 0.4 * s;
      this.tumble(this.tmpV.set((dx / h) * k, 0.3, (dz / h) * k));
    }
  }

  /** Slipped off an edge or tripped up, or lying there after one. */
  get isTumbling(): boolean { return this.tumbling; }

  /**
   * Knocked over by its own clumsiness: goes limp with a nudge `dv` (units/s, whole
   * body), and gets up by itself once it's lain there a moment.
   */
  tumble(dv: THREE.Vector3): void {
    if (this.knockedOut || this.carried) return;
    this.setKnockedOut(true);
    const m = this.totalMass;
    this.force.x = dv.x * m; this.force.y = dv.y * m; this.force.z = dv.z * m;
    this.torso.body.applyImpulse(this.force, true);
    this.tumbling = true;
    this.tumbleTimer = CLUMSY.tumbleSeconds;
    this.surpriseTimer = EMOTION.surpriseSeconds;
    this.teeter = 0;
    this.edgeTime = 0;
  }

  /**
   * Clumsiness, once per step: feel for edges around the belly and teeter on them
   * (slipping off, or catching itself and stepping back), judge landings (a hard one
   * may trip it or make it stagger), and get up after a tumble.
   */
  private updateClumsy(dt: number): void {
    const C = CLUMSY, chance = C.amount * this.traits.clumsy;
    const vel = this.vel;
    if (this.tumbling) {
      this.tumbleTimer -= dt;
      if (this.tumbleTimer <= 0 && Math.hypot(vel.x, vel.y, vel.z) < 0.6) this.setKnockedOut(false);
    }
    const standing = this.grounded && this.jumpPhase === 'ground' && !this.knockedOut && !this.carried && this.muscle > 0.9;

    // Landings. Judged a moment after touching down, so a trampoline's rebound (which
    // leaves again at once) never counts.
    const y = this.torso.body.translation().y;
    if (!standing && !this.knockedOut) this.peakY = Math.max(this.peakY, y);
    if (standing && !this.wasStanding) {
      // How far it fell: from its highest to standing on what it landed on.
      this.landImpact = this.peakY - (this.groundY + this.dims.hoverHeight);
      this.landPending = this.landImpact > C.dropSafe ? 0.08 : -1;
      this.peakY = -Infinity;
    }
    if (this.knockedOut) this.peakY = -Infinity;
    this.wasStanding = standing;
    if (this.landPending >= 0) {
      if (!standing) this.landPending = -1;
      else if ((this.landPending -= dt) < 0) {
        const hard = THREE.MathUtils.smoothstep(this.landImpact, C.dropSafe, C.dropSure);
        if (Math.random() < Math.min(0.95, hard * chance)) {
          // Stumbled: tripped right over (pitching the way it was going), or a stagger.
          const sp = Math.hypot(vel.x, vel.z);
          if (Math.random() < C.landTrip) {
            const fx = sp > 0.2 ? vel.x / sp : Math.sin(this.facing), fz = sp > 0.2 ? vel.z / sp : Math.cos(this.facing);
            this.tumble(this.tmpV.set(fx * (0.6 + 0.3 * sp), 0.4, fz * (0.6 + 0.3 * sp)));
          } else {
            this.stagger = STAGGER_SECONDS;
            this.squash = 1;
          }
        }
      }
    }

    // Edges: re-check one of the probes around the belly each step (all of them in 1/11 s).
    this.edgeCooldown = Math.max(0, this.edgeCooldown - dt);
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    let onEdge = false;
    if (standing) {
      const t = this.torso.body.translation();
      const r = this.dims.bellyR * 1.3;
      for (let k = 0; k < PROBES_PER_STEP; k++) {
        const i = this.edgeProbe = (this.edgeProbe + 1) % EDGE_PROBES;
        const a = (i / EDGE_PROBES) * Math.PI * 2;
        this.ray.origin.x = t.x + Math.sin(a) * r; this.ray.origin.y = this.groundY + 0.08; this.ray.origin.z = t.z + Math.cos(a) * r;
        const hit = this.world.castRay(this.ray, 0.2, true, undefined, RAY_GROUPS);
        this.edgeSupported[i] = hit !== null && hit.timeOfImpact < 0.13;
      }
      let dx = 0, dz = 0, gone = 0;
      for (let i = 0; i < EDGE_PROBES; i++) {
        if (this.edgeSupported[i]) continue;
        const a = (i / EDGE_PROBES) * Math.PI * 2;
        dx += Math.sin(a); dz += Math.cos(a); gone++;
      }
      const len = Math.hypot(dx, dz);
      if (gone > 0 && len > 1e-3) {
        onEdge = true;
        this.edgeDir.set(dx / len, 0, dz / len);
        this.edgeShare = gone / EDGE_PROBES;
      }
    } else {
      this.edgeSupported.fill(true);
    }

    if (onEdge && this.edgeCooldown === 0) {
      this.edgeTime += dt;
      if (this.edgeTime >= C.teeterSeconds) {
        // Decide: moving toward the drop, or with more of its footing gone, it's likelier to go.
        const toward = Math.max(0, vel.x * this.edgeDir.x + vel.z * this.edgeDir.z);
        const p = C.edgeSlip * chance * (0.5 + 2 * this.edgeShare + toward);
        if (Math.random() < Math.min(0.95, p)) {
          this.tumble(this.tmpV.copy(this.edgeDir).multiplyScalar(0.9).setY(0.3));
        } else {
          // Caught itself: a hop back from the edge, still wobbly.
          const k = -0.7 * this.totalMass;
          this.force.x = this.edgeDir.x * k; this.force.y = 0; this.force.z = this.edgeDir.z * k;
          this.torso.body.applyImpulse(this.force, true);
          this.stagger = Math.max(this.stagger, 0.4 * STAGGER_SECONDS);
          this.edgeCooldown = C.edgeCooldown;
        }
        this.edgeTime = 0;
      }
    } else {
      this.edgeTime = Math.max(0, this.edgeTime - 2 * dt);
    }
    const want = standing && onEdge && this.edgeCooldown === 0 ? Math.min(1, 0.3 + this.edgeTime / C.teeterSeconds) : 0;
    this.teeter += (want - this.teeter) * Math.min(1, dt * (want > this.teeter ? 12 : 5));
  }

  /**
   * For the head's goo: how hard the head is speeding up or slowing down (the goo lags
   * behind that), and what it's touching (the goo flattens against it). The goo itself
   * runs once per rendered frame, in syncMeshes.
   */
  private trackHead(dt: number): void {
    const head = this.part('head');
    const v = head.body.linvel();
    this.headVel.set(v.x, v.y, v.z);
    // Acceleration this step, capped so a teleport or a glitch can't fling the goo.
    this.tmpV.subVectors(this.headVel, this.lastHeadVel).divideScalar(dt);
    if (this.tmpV.length() > 60) this.tmpV.setLength(60);
    this.lastHeadVel.copy(this.headVel);
    this.headAccelSum.add(this.tmpV);
    this.headAccelSteps++;

    this.contactSum.set(0, 0, 0);
    this.contactCount = 0;
    this.world.contactPairsWith(head.collider, this.onHeadPair);
    this.gooContact.active = this.contactCount > 0;
    if (this.gooContact.active) this.gooContact.normal.copy(this.contactSum).normalize();
  }

  /**
   * Eyes and mouth follow the muscles: knocked out, the eyes shut and the jaw goes
   * slack; coming round, they open again once the muscles are a third of the way
   * back. While awake it blinks now and then.
   */
  private updateFace(dt: number): void {
    let target = this.knockedOut ? 0 : THREE.MathUtils.smoothstep(this.muscle, 0.2, 0.6);
    // Idle blink: a quick dip to nearly shut, every few seconds.
    if (target === 1 && this.time >= this.nextBlink) {
      const t = this.time - this.nextBlink;
      if (t < BLINK_SECONDS) target = 0.15;
      else this.nextBlink = this.time + 2.5 + Math.random() * 4;
    }
    // Closing is quick (a knockout, a blink); opening is a bit slower and dozier.
    const rate = target < this.faceAwake ? 25 : 10;
    this.faceAwake += (target - this.faceAwake) * Math.min(1, dt * rate);
    this.face.setExpression(this.faceAwake, this.moods.letters);
    // Flush red with anger (only while awake), so it reads even at the game's distance.
    this.material.color.copy(this.baseColor).lerp(this.flushColor, EMOTION.flushAmount * this.anger * this.faceAwake);
  }

  /**
   * Reaction timers (shoves → surprise, too many → anger; jumping → game face), then
   * blend the mood and the reactions into this step's posture and face letters.
   */
  private updateMood(dt: number): void {
    // Reaction timers. Annoyance drains only once there's been a pause since the last
    // shove, and not while angry; it's spent once the anger wears off, so it takes a
    // fresh run of shoves to set it off again.
    this.surpriseTimer = Math.max(0, this.surpriseTimer - dt);
    if (this.angryTimer > 0) {
      this.angryTimer = Math.max(0, this.angryTimer - dt);
      if (this.angryTimer === 0) this.annoyance = 0;
    } else if (this.time - this.lastShoveTime > EMOTION.annoyanceGraceSeconds) {
      this.annoyance = Math.max(0, this.annoyance - EMOTION.annoyanceDrainPerSecond * dt);
    }
    // Ease the shown amounts: surprise snaps on and fades; anger builds and simmers down.
    const ease = (cur: number, want: number, up: number, down: number) =>
      cur + (want - cur) * Math.min(1, dt * (want > cur ? up : down));
    this.surprise = ease(this.surprise, this.surpriseTimer > 0 ? 1 : 0, 30, 5);
    this.anger = ease(this.anger, this.angryTimer > 0 ? 1 : 0, 6, 1.5);
    // Game face: on as it crouches to jump, kept through the air, and for a beat after
    // landing before it relaxes back into a smile.
    if (this.jumpPhase !== 'ground') this.focusHold = 0.3;
    else this.focusHold = Math.max(0, this.focusHold - dt);
    this.focus = ease(this.focus, this.focusHold > 0 ? 1 : 0, 30, 5);

    this.reactions.angry = this.anger;
    this.reactions.surprised = this.surprise;
    this.reactions.focused = this.focus;
    this.reactions.teetering = this.teeter;
    this.moods.update(dt, this.reactions);
    // Fidgeting also makes the eyes dart about.
    const L = this.moods.letters;
    L.gazeX = Math.max(-1, Math.min(1, L.gazeX + 0.8 * L.fidget * this.noise(0)));
    L.gazeY = Math.max(-1, Math.min(1, L.gazeY + 0.4 * L.fidget * this.noise(1)));
    // A gesture plays over everything else, for as long as it lasts.
    this.gestures.update(dt, L, this.fireGesture);
    this.breathPhase = (this.breathPhase + dt * 2.1 * (1 + 0.3 * L.energy)) % (Math.PI * 2);
  }

  /**
   * Smooth, wandering −1..1 values (a few out-of-step sines), one per channel: for
   * fidgeting, so restless motions never repeat in an obvious loop.
   */
  private noise(channel: number): number {
    const t = this.time + channel * 17.3;
    return 0.6 * Math.sin(t * 1.7) * Math.sin(t * 0.43 + 1.3) + 0.4 * Math.sin(t * 3.1 + channel);
  }

  /** Copies body transforms onto the skin's bones. Call once per rendered frame. */
  /**
   * @param alpha how far the drawn pose is from the previous physics step (0) to the
   *   latest (1); see rememberPose.
   */
  syncMeshes(dt = 1 / 60, alpha = 1): void {
    const showSkeleton = this.skeletonGroup.visible;
    for (const p of this.parts.values()) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.bone.position.set(t.x, t.y, t.z).sub(p.prevPos).multiplyScalar(alpha).add(p.prevPos);
      this.tmpQ.set(r.x, r.y, r.z, r.w);
      p.bone.quaternion.slerpQuaternions(p.prevRot, this.tmpQ, alpha);
      if (showSkeleton) {
        p.debugMesh.position.copy(p.bone.position);
        p.debugMesh.quaternion.copy(p.bone.quaternion);
      }
    }
    // The head's goo runs once per rendered frame, on the head's average acceleration
    // over this frame's physics steps; then the face is moved to ride its surface.
    if (this.headAccelSteps > 0) {
      this.headAccel.copy(this.headAccelSum).divideScalar(this.headAccelSteps);
      this.headAccelSum.set(0, 0, 0);
      this.headAccelSteps = 0;
    }
    this.goo.update(dt, this.part('head').bone.quaternion, this.headAccel, this.gooContact, this.traits.squish, this.muscle * this.muscle);
    this.face.followSurface();
    this.jiggleButt(dt);
  }

  /**
   * The butt bone chases its spot on the belly through an underdamped spring, so the
   * cheeks lag, overshoot and wobble back whenever the belly moves: steps, landings,
   * shoves. It turns with the belly. Allocation-free.
   */
  private jiggleButt(dt: number): void {
    const torso = this.torso.bone;
    const b = this.buttBone;
    b.quaternion.copy(torso.quaternion);
    // Walking shakes it: each footfall drops the cheeks and sways them toward the
    // planted foot, and the spring turns that into lag, overshoot and wobble.
    const kick = BUTT.walkBounce * this.dims.cheeks.r * this.gaitWeight;
    this.buttTarget.set(
      kick * Math.sin(this.gaitPhase),
      -kick * Math.abs(Math.sin(this.gaitPhase)),
      0,
    ).add(this.buttFromTorso).applyQuaternion(torso.quaternion).add(torso.position);
    const lv = this.torso.body.linvel();
    this.buttTargetVel.set(lv.x, lv.y, lv.z);
    if (!this.buttSettled) { // first frame or after a teleport: start at rest
      b.position.copy(this.buttTarget);
      this.buttVel.copy(this.buttTargetVel);
      this.buttSettled = true;
      return;
    }
    const w = 2 * Math.PI * BUTT.frequency;
    const k = w * w, c = 2 * BUTT.dampingRatio * w;
    const steps = Math.max(1, Math.ceil(Math.min(dt, 0.1) / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    const maxTravel = BUTT.travel * this.dims.cheeks.r;
    for (let i = 0; i < steps; i++) {
      // a = k·(target − pos) + c·(targetVel − vel), semi-implicit Euler.
      this.tmpV.copy(this.buttTarget).sub(b.position).multiplyScalar(k);
      this.buttVel.addScaledVector(this.tmpV, h);
      this.tmpV.copy(this.buttTargetVel).sub(this.buttVel).multiplyScalar(c);
      this.buttVel.addScaledVector(this.tmpV, h);
      b.position.addScaledVector(this.buttVel, h);
    }
    // Never let it wobble right off the body.
    this.tmpV.copy(b.position).sub(this.buttTarget);
    const d = this.tmpV.length();
    if (d > maxTravel) {
      b.position.copy(this.buttTarget).addScaledVector(this.tmpV, maxTravel / d);
      this.buttVel.copy(this.buttTargetVel);
    }
  }

  /** Belly centre as drawn this frame (between physics steps): for cameras to follow. */
  drawnMiddle(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.torso.bone.position);
  }

  /** Belly centre in world space. */
  middle(target: THREE.Vector3): THREE.Vector3 {
    const t = this.torso.body.translation();
    return target.set(t.x, t.y, t.z);
  }

  /** A snapshot for the HUD. */
  debugState() {
    return {
      muscle: this.muscle,
      grounded: this.grounded,
      gait: this.gaitWeight,
      knockedOut: this.knockedOut,
      groundY: this.groundY,
      facing: this.facing,
      mood: this.moods.mood,
      gesture: this.gestures.name,
      carried: this.carried,
      holding: this.holdWanted,
      reaction: this.angryTimer > 0 ? 'angry' : this.surpriseTimer > 0 ? 'surprised' : this.focus > 0.5 ? 'focused' : '',
      annoyance: this.annoyance,
      totalMass: this.totalMass,
    };
  }

  /**
   * Makes this tenant's body pass through `other` (it takes `other`'s groups), e.g. while
   * `other` holds it overhead. `null` goes back to its own.
   */
  shareCollisionWith(other: ActiveRagdoll | null): void {
    const g = other ? other.collisionGroups : this.collisionGroups;
    for (const p of this.parts.values()) p.collider.setCollisionGroups(g);
  }

  dispose(): void {
    bitUsers[this.collisionSlot]--;
    for (const p of this.parts.values()) this.world.removeRigidBody(p.body); // also removes its colliders + joints
    this.parts.clear();
    this.joints.length = 0;
    this.material.dispose();
    this.skin.skeleton.dispose();
    this.goo.dispose();
    releaseSkin(this.dims);
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------------ controllers

  private part(name: PartName): Part {
    return this.parts.get(name)!;
  }

  /**
   * Inertia, about the joint, of the part on that joint plus everything attached beyond
   * it (e.g. thigh + shin for a hip, chest + head + fins for the spine), measured in the
   * rest pose. Point-mass parallel axis term plus each body's own average inertia:
   * rough, but it puts every muscle on the same footing so `frequency` means the same
   * thing at the hip and the elbow.
   */
  private chainInertia(def: PartDef): number {
    let inertia = 0;
    for (const p of this.parts.values()) {
      // Is p this part or a descendant of it?
      let n: PartName | undefined = p.def.name;
      while (n && n !== def.name) n = this.part(n).def.parent;
      if (!n) continue;
      const own = p.body.principalInertia();
      inertia += p.body.mass() * p.def.center.distanceToSquared(def.jointAt!) + (own.x + own.y + own.z) / 3;
    }
    return inertia;
  }

  /** Turn the facing target toward the move direction, at a capped rate. */
  private updateFacing(dt: number): void {
    if (this.knockedOut || this.moveInput.lengthSq() < 0.01) return;
    const want = Math.atan2(this.moveInput.x, this.moveInput.y); // 0 faces +z, + toward +x
    let diff = want - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way round
    const maxStep = UPRIGHT.turnRate * dt;
    this.facing += Math.max(-maxStep, Math.min(maxStep, diff));
  }

  /** Advance the walk cycle from how fast the body is actually moving, so legs stay in time with it. */
  private updateGait(dt: number, speed: number): void {
    const moving = this.knockedOut ? 0 : Math.min(1, speed / GAIT.fadeSpeed);
    // Smooth the blend so the legs settle rather than freeze when stopping.
    this.gaitWeight += (moving - this.gaitWeight) * Math.min(1, dt * 6);
    // Energy speeds up or slows down the step tempo.
    const hz = Math.min(GAIT.maxCycleHz, GAIT.baseCycleHz + GAIT.cycleHzPerSpeed * speed)
      * (1 + 0.3 * this.moods.letters.energy) * this.traits.cadence;
    this.gaitRate = hz * Math.PI * 2;
    this.gaitPhase = (this.gaitPhase + dt * this.gaitRate) % (Math.PI * 2);
  }

  /**
   * Gravity compensation: while the muscles are on, lift each part by (a share of) its
   * own weight and hang that same weight on the belly instead. The body's total weight
   * is unchanged, so the hover and falling behave exactly as before, but the joint
   * motors no longer have to hold parts up against gravity. Without this a leg asked to
   * swing 46° forward sags to ~26°. On knockout `strength` is 0, so every part gets its
   * full weight back and drops.
   */
  private applyGravityCompensation(strength: number): void {
    let carried = 0;
    for (const p of this.parts.values()) {
      const share = GRAVITY_COMP[p.def.name] ?? 0;
      if (share <= 0) continue;
      const lift = p.mass * 9.81 * share * strength;
      carried += lift;
      this.force.x = 0; this.force.y = lift; this.force.z = 0;
      p.body.addForce(this.force, true);
    }
    this.force.x = 0; this.force.y = -carried; this.force.z = 0;
    this.torso.body.addForce(this.force, true);
  }

  /** Jump phases: count down the crouch, launch, time the air, ease the poses. */
  private updateJump(dt: number): void {
    if (this.jumpPhase === 'crouch') {
      this.crouchTimer -= dt;
      if (this.crouchTimer <= 0) {
        // Launch: set the belly's upward speed, with the WHOLE body's mass behind it so
        // everything comes along (the limbs trail a little through the joints).
        this.force.x = 0; this.force.y = (JUMP.velocity * this.traits.jump - this.vel.y) * this.totalMass; this.force.z = 0;
        this.torso.body.applyImpulse(this.force, true);
        this.liftHeld(JUMP.velocity * this.traits.jump);
        this.jumpPhase = 'air';
        this.airTime = 0;
        this.heightIntegral = 0;
      }
    } else if (this.jumpPhase === 'air') {
      this.airTime += dt;
      // Safety: if it never "lands" (e.g. caught on something), give up after a while.
      if (this.airTime > 3) this.jumpPhase = 'ground';
    }
    const inAir = this.jumpPhase === 'air' ? 1 : 0;
    this.air += (inAir - this.air) * Math.min(1, dt * (inAir ? 14 : 8));
    this.squash = Math.max(0, this.squash - dt * 5);
  }

  /** Raycast PID: hold the belly at standing height above whatever is below it. */
  private applyHover(dt: number, t: RAPIER.Vector, strength: number): void {
    this.ray.origin.x = t.x; this.ray.origin.y = t.y; this.ray.origin.z = t.z;
    const hit = this.world.castRay(this.ray, this.dims.rayLength, true, undefined, RAY_GROUPS);
    this.grounded = hit !== null;
    if (!hit) {
      // Airborne (off a ledge, or shoved up): no hover, let gravity have it.
      this.heightIntegral *= 0.95;
      return;
    }
    this.groundY = t.y - hit.timeOfImpact;

    // Breathing when idle, a bob per step when walking. Both tiny: it's a small body.
    // Low energy breathes deeper and slower; high energy bounces on the spot.
    const P = this.moods.letters;
    const idle = 1 - this.gaitWeight;
    const breathe = 0.005 * (1 + 1.5 * Math.max(0, -P.energy)) * Math.sin(this.breathPhase) * idle;
    const bounce = 0.014 * Math.max(0, P.energy) * Math.abs(Math.sin(this.time * 7)) * idle;
    const bob = -GAIT.bob * this.traits.bob * Math.max(0, 1 + 0.8 * P.energy) * this.gaitWeight * Math.abs(Math.sin(this.gaitPhase));

    if (this.jumpPhase === 'air') {
      // In the air the hover is off, or it would hold the body down. Land once it's on
      // its way down and back at standing height.
      if (this.airTime > 0.12 && this.vel.y <= 0 && hit.timeOfImpact < this.dims.hoverHeight + 0.02) {
        this.jumpPhase = 'ground';
        this.squash = Math.min(1, -this.vel.y / 3); // harder landing, deeper squash
        this.heightIntegral = 0;
      } else {
        return;
      }
    }
    // Dip into the take-off crouch, and squash on landing.
    const crouch = this.jumpPhase === 'crouch' ? 1 - this.crouchTimer / JUMP.crouchSeconds : 0;
    const dip = JUMP.crouchDepth * crouch + JUMP.landSquash * this.squash + this.gestures.extras.dip;
    const error = this.dims.hoverHeight + breathe + bounce + bob - dip - hit.timeOfImpact;

    // Only integrate near the target. While lying down or getting up the error is
    // large for seconds, and integrating it then winds up and overshoots the stand.
    if (Math.abs(error) < 0.05) {
      this.heightIntegral = THREE.MathUtils.clamp(
        this.heightIntegral + error * dt, -HOVER.integralLimit, HOVER.integralLimit,
      );
    }
    // Derivative on velocity, not on error, so target changes don't cause kicks.
    const accel = 9.81 + HOVER.kp * error + HOVER.ki * this.heightIntegral - HOVER.kd * this.vel.y;
    // Push only (it's a hover, not a tether), and capped, so it can't launch the body.
    const a = THREE.MathUtils.clamp(accel, 0, HOVER.maxAccel) * strength;
    // The whole body's weight hangs off the belly, so lift with total mass.
    this.force.x = 0; this.force.y = a * this.totalMass; this.force.z = 0;
    this.torso.body.addForce(this.force, true);
  }

  /** WASD: a force on the belly that steers its horizontal velocity toward the wanted one. */
  private applyMove(wantX: number, wantZ: number, strength: number): void {
    // Only a little steering in the air, none if it's fallen off something.
    if (this.jumpPhase === 'air') strength *= JUMP.airControl;
    else if (!this.grounded) return;
    let ax = (wantX - this.vel.x) * MOVE.response;
    let az = (wantZ - this.vel.z) * MOVE.response;
    const len = Math.hypot(ax, az);
    if (len > MOVE.maxAccel) { ax *= MOVE.maxAccel / len; az *= MOVE.maxAccel / len; }
    this.force.x = ax * this.totalMass * strength;
    this.force.y = 0;
    this.force.z = az * this.totalMass * strength;
    this.torso.body.addForce(this.force, true);
  }

  /** PD torque: belly upright, facing `facing`, leaning into acceleration, waddling with the steps. */
  private applyUpright(wantX: number, wantZ: number, speed: number, strength: number): void {
    const body = this.torso.body;
    // Forward lean: some with speed, more when wanted speed is ahead of actual (starting),
    // backward when it's behind (stopping). Measured along the facing direction.
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    const wantedAlong = wantX * fx + wantZ * fz;
    const actualAlong = this.vel.x * fx + this.vel.z * fz;
    const P = this.moods.letters;
    const lean = THREE.MathUtils.clamp(
      UPRIGHT.leanPerSpeed * speed + UPRIGHT.leanPerAccelError * (wantedAlong - actualAlong) + 0.25 * P.lean,
      -UPRIGHT.maxLean, UPRIGHT.maxLean,
    );
    // Standing: a slow weight shift side to side. Walking: a waddle, rocking onto each
    // stance leg, and a twist against the stride.
    const gs = Math.sin(this.gaitPhase);
    const sway = (0.035 + 0.08 * P.sway) * Math.sin(this.time * 0.8) * (1 - this.gaitWeight)
      + GAIT.stepRoll * this.traits.waddle * gs * this.gaitWeight;
    const twist = GAIT.stepTwist * gs * this.gaitWeight;
    const X = this.gestures.extras;

    this.qTarget.setFromAxisAngle(this.axisY, this.facing + twist + X.yaw);
    // Teetering: the top tips out over the drop (a world-space tilt about up × dir).
    if (this.teeter > 0.01) {
      const d = this.edgeDir;
      this.qTip.setFromAxisAngle(this.tmpAxis.set(d.z, 0, -d.x), CLUMSY.teeterLean * this.teeter);
      this.qTarget.premultiply(this.qTip);
    }
    // Positive rotation about local +x tips the top toward local +z (forward).
    this.qLean.setFromAxisAngle(this.axisX, lean + X.bow);
    this.qTarget.multiply(this.qLean);
    this.qLean.setFromAxisAngle(this.axisZ, sway + X.bellyRoll);
    this.qTarget.multiply(this.qLean);

    const r = body.rotation();
    this.qCur.set(r.x, r.y, r.z, r.w);
    // Error rotation that takes the current orientation to the target, in world space.
    this.qErr.copy(this.qTarget).multiply(this.qCur.invert());
    if (this.qErr.w < 0) { // shortest arc
      this.qErr.x = -this.qErr.x; this.qErr.y = -this.qErr.y; this.qErr.z = -this.qErr.z; this.qErr.w = -this.qErr.w;
    }
    const w = Math.min(1, this.qErr.w);
    const s = Math.sqrt(1 - w * w);
    const angle = 2 * Math.acos(w);
    const k = s < 1e-6 ? 2 : angle / s; // rotation vector = axis · angle
    body.angvel(this.angVel as RAPIER.Vector);

    const I = this.torsoInertia * strength;
    this.torque.x = I * (UPRIGHT.kp * this.qErr.x * k - UPRIGHT.kd * this.angVel.x);
    this.torque.y = I * (UPRIGHT.kp * this.qErr.y * k - UPRIGHT.kd * this.angVel.y);
    this.torque.z = I * (UPRIGHT.kp * this.qErr.z * k - UPRIGHT.kd * this.angVel.z);
    body.addTorque(this.torque, true);
  }

  /**
   * Procedural pose: walk cycle blended over idle. Targets are rotations in the parent's
   * frame (right-hand rule). For a body facing +z:
   *   − about x swings a limb forward; + about x bends a knee (tip back);
   *   + about z moves the left (+x) limb outward; + about z tips the chest toward −x.
   */
  private poseLimbs(): void {
    const w = this.gaitWeight;
    const s = Math.sin(this.gaitPhase);
    const c = Math.cos(this.gaitPhase);
    const breathe = Math.sin(this.breathPhase);
    const P = this.moods.letters;
    // Stride and energy scale the walk: a shuffle takes small steps, a strut big ones.
    const hipSwing = GAIT.hipSwing * this.traits.stride * Math.max(0.2, 1 + 0.5 * P.stride);
    const kneeLift = GAIT.kneeLift * this.traits.stride * Math.max(0.2, 1 + 0.6 * P.stride);
    const armSwingAmp = GAIT.armSwing * Math.max(0.2, 1 + 0.4 * P.energy);
    const shake = (rate: number) => P.tremble * Math.sin(this.time * rate);
    const X = this.gestures.extras;
    // Being carried: legs kick and fins flail. Holding something: fins up overhead.
    const kick = this.carried ? 1 : 0;
    const flail = (rate: number, phase: number) => kick * Math.sin(this.time * rate + phase);
    const hold = this.hold;
    // Front: fins swing forward and wrap in round it. Overhead: fins up in a V, straight.
    const hugging = this.holdStyle === 'front' ? hold : 0;
    const hoisting = this.holdStyle === 'overhead' ? hold : 0;
    // Rates of change of s and c, for the motors' velocity targets.
    const ds = c * this.gaitRate;
    const dc = -s * this.gaitRate;

    for (const j of this.joints) {
      j.targetVel.set(0, 0, 0);
      const name = j.def.name;
      const left = name.endsWith('L');
      const side = left ? 1 : -1;
      // Left leg goes forward on the first half of the cycle, right leg on the second.
      const legSwing = (left ? s : -s) * hipSwing * w;
      // A leg is moving forward when the derivative of its swing is positive.
      const legForwardness = (left ? c : -c);

      switch (name) {
        case 'chest':
          // The noodly wiggle: as the belly rocks onto a leg, the chest swings back the
          // other way. Plus a little breathing when standing.
          // Spine letter: slumped forward (+x) or chest puffed out (−x).
          j.target.set(
            0.03 * breathe * (1 - w) - 0.4 * P.spine,
            0,
            -GAIT.chestCounterRoll * GAIT.stepRoll * s * w + 0.03 * shake(33) + X.chestRoll,
          );
          j.targetVel.z = -GAIT.chestCounterRoll * GAIT.stepRoll * ds * w;
          break;
        case 'head': {
          // Hold the head level in the WORLD, facing the way it's going, whatever the
          // body is doing: the neck counter-rotates the chest's lean and wobble, like a
          // real head stabilising. The neck motor works in the chest's frame, so the
          // target is chest⁻¹ · level. A small nod with the steps and with breathing.
          const r = this.chest.body.rotation();
          this.qCur.set(r.x, r.y, r.z, r.w).invert();
          // Head letters: turned away (plus restless glances when fidgeting), chin up or
          // hanging, cocked to one side.
          const turn = 0.6 * P.headTurn + 0.35 * P.fidget * this.noise(2);
          this.qHead.setFromAxisAngle(this.axisY, this.facing + X.yaw + turn).premultiply(this.qCur);
          this.qLean.setFromAxisAngle(this.axisX, 0.05 * Math.abs(s) * w + 0.015 * breathe * (1 - w) - 0.5 * P.headPitch);
          this.qHead.multiply(this.qLean);
          this.qLean.setFromAxisAngle(this.axisZ, 0.4 * P.headTilt);
          this.qHead.multiply(this.qLean);
          if (this.qHead.w < 0) {
            this.qHead.set(-this.qHead.x, -this.qHead.y, -this.qHead.z, -this.qHead.w);
          }
          const hw = Math.min(1, this.qHead.w);
          const hs = Math.sqrt(1 - hw * hw);
          const hk = hs < 1e-6 ? 2 : (2 * Math.acos(hw)) / hs; // quaternion → rotation vector
          // Clamp so a fast turn or a big tumble never asks the neck to wrench around.
          const lim = MAX_NECK_ANGLE;
          j.target.set(
            THREE.MathUtils.clamp(this.qHead.x * hk, -lim, lim),
            THREE.MathUtils.clamp(this.qHead.y * hk, -lim, lim),
            THREE.MathUtils.clamp(this.qHead.z * hk, -lim, lim),
          );
          // Trembling: a fast little shake.
          j.target.z += 0.05 * shake(38);
          break;
        }
        case 'thighL':
        case 'thighR':
          // In the air the legs swing up in front; crouching/landing bends them a bit too.
          // A gesture can lift one knee (a stomp).
          j.target.set(
            -legSwing * (1 - this.air) - JUMP.kneesUp * this.air - 0.3 * this.bend() - (left ? X.legLiftL : X.legLiftR)
              - 0.7 * flail(11, left ? 0 : Math.PI),
            0, side * 0.04,
          );
          j.targetVel.x = -(left ? ds : -ds) * hipSwing * w;
          break;
        case 'shinL':
        case 'shinR':
          j.target.set(
            GAIT.kneeBase + kneeLift * w * Math.max(0, legForwardness) * (1 - this.air)
              + JUMP.tuck * this.air + 0.6 * this.bend() + 1.3 * (left ? X.legLiftL : X.legLiftR)
              + kick * (0.6 + 0.5 * Math.sin(this.time * 11 + (left ? 1.5 : 1.5 + Math.PI))),
            0, 0,
          );
          if (legForwardness > 0) j.targetVel.x = kneeLift * w * (left ? dc : -dc);
          break;
        case 'upperArmL':
        case 'upperArmR': {
          // Fins swing opposite to the leg on the same side, splayed out as in the drawing.
          // No swinging while holding something: the fins are busy.
          const armSwing = -(left ? s : -s) * armSwingAmp * w * (1 - hold);
          // Fin letters: pulled back or held forward; flared or tucked; raised high or
          // drooping (a droop also pulls them in). Plus fidgety twitches and trembling.
          const lift = 0.9 * Math.max(0, P.finsLift) + 0.35 * Math.min(0, P.finsLift);
          j.target.set(
            -armSwing + 0.7 * P.finsBack + 0.25 * P.fidget * this.noise(left ? 3 : 4) - (left ? X.finFwdL : X.finFwdR)
              - 0.15 * hoisting - 1.25 * hugging,
            0,
            side * (GAIT.armOut + 0.03 * breathe * (1 - w) + 0.35 * P.finsSpread + lift
              + JUMP.finsUp * this.air + 0.05 * shake(41) + (left ? X.finRaiseL : X.finRaiseR)
              + 1.75 * hoisting - 0.25 * hugging + kick * 0.7 + 0.5 * flail(9, left ? 0 : 1.7)),
          );
          j.targetVel.x = (left ? ds : -ds) * armSwingAmp * w * (1 - hold);
          break;
        }
        case 'forearmL':
        case 'forearmR': {
          // The lower fin bends forward a little (one soft curve), and more as the fin
          // swings forward, like a flipper following through.
          const swingingForward = Math.max(0, -(left ? s : -s)) * w;
          // Elbow letter: bent forward (the hinge stops it bending far backward).
          // Hoisting straightens the fins into a clear V above the shoulders.
          j.target.set(-((GAIT.finCurl + GAIT.finFollow * swingingForward + 0.9 * P.elbowBend + (left ? X.elbowL : X.elbowR)) * (1 - hoisting) + 0.9 * hugging), 0, 0);
          break;
        }
      }
    }
  }

  /** How much the legs bend for the take-off crouch and the landing squash, 0..1. */
  private bend(): number {
    const crouch = this.jumpPhase === 'crouch' ? 1 - this.crouchTimer / JUMP.crouchSeconds : 0;
    return Math.max(crouch, this.squash);
  }

  /** Push the targets and the current muscle strength into Rapier's joint motors. */
  private applyMotors(): void {
    const strength = this.muscle * this.muscle;
    // Tension letter: tight muscles snap to the pose faster, loose ones lag and flop.
    const tension = Math.max(0.3, 1 + 0.35 * this.moods.letters.tension);
    for (const j of this.joints) {
      const g = j.def.gains!;
      // Traits: a baby's neck is extra wobbly, a senior's joints stiffer and slower.
      const neck = j.def.name === 'head';
      // Holding something braces the shoulders: firmer and calmer, so the pose holds
      // while walking instead of the fins sagging and flapping.
      const brace = j.def.jointType === 'ball' && j.def.name.startsWith('upperArm') ? this.hold : 0;
      const freq = g.frequency * tension * (neck ? this.traits.neckSpeed : this.traits.muscleSpeed) * (1 + 0.8 * brace);
      const ratio = g.dampingRatio * (neck ? this.traits.neckDamping : this.traits.muscleDamping) * (1 + 0.8 * brace);
      // Spring-damper with natural frequency ω and damping ratio ζ on inertia I:
      // stiffness = I·ω², damping = 2·ζ·ω·I.
      const k = j.inertia * freq * freq * strength;
      // Keep a little damping while limp, like joint friction, so it flops and settles.
      const d = j.inertia * freq * Math.max(MUSCLES.limpDamping, 2 * ratio * strength);
      // While limp, there's no target motion to follow: damping just resists movement.
      const v = strength > 0 ? j.targetVel : ZERO;
      if (j.ball) {
        j.ball.configureMotor(RAPIER.JointAxis.AngX, j.target.x, v.x, k, d);
        j.ball.configureMotor(RAPIER.JointAxis.AngY, j.target.y, v.y, k, d);
        j.ball.configureMotor(RAPIER.JointAxis.AngZ, j.target.z, v.z, k, d);
      } else if (j.hinge) {
        j.hinge.configureMotor(j.target.x, v.x, k, d);
      }
    }
  }
}
