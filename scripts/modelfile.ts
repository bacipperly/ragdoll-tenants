// Loads a body model for scripts the way the sandbox does: the .glb, plus its .json
// settings next to it if there is one (overrides on top).
import { existsSync, readFileSync } from 'node:fs';
import { prepareBodyModel, type BodyModel, type BodyModelSettings } from '../src/ragdoll/bodyModel';
import { readGlb } from './glb';
export function loadModelFile(file: string, overrides: BodyModelSettings = {}, name = 'm'): BodyModel {
  const g = readGlb(file);
  const sf = file.replace(/\.glb$/i, '.json');
  const settings: BodyModelSettings = { ...(existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')) : {}), ...overrides };
  return prepareBodyModel(name, g.positions, g.normals, g.index, settings, { part: g.part, rig: g.rig });
}
