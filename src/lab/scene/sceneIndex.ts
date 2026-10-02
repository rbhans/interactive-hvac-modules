import * as THREE from "three";

/**
 * Reads a module GLB that follows docs/asset-conventions.md into the structures
 * the runtime animates. Nothing here is module-specific.
 */

export type Motion = "rotate" | "translate" | "spin" | "link";

export interface PartNode {
  obj: THREE.Object3D;
  name: string;
  motion: Motion;
  range: [number, number];
  drives?: string;
  from?: THREE.Object3D;
  to?: THREE.Object3D;
  restLength?: number;
  baseQuat: THREE.Quaternion;
  basePos: THREE.Vector3;
  baseScale: THREE.Vector3;
  /** smoothed 0–1 drive value */
  value: number;
  /** accumulated spin angle, radians */
  spin: number;
}

export interface ExplodeNode {
  obj: THREE.Object3D;
  basePos: THREE.Vector3;
  /** offset in the parent's local frame */
  offset: THREE.Vector3;
}

export interface FlowPath {
  id: string;
  points: THREE.Vector3[];
  spreads: [number, number][];
}

/** Any lit material with a color and an emissive channel (standard or toon) */
export type EmissiveMaterial = THREE.Material & { color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number };

const isEmissive = (m: unknown): m is EmissiveMaterial => m instanceof THREE.Material && "emissive" in m;

export interface HighlightMesh {
  mesh: THREE.Mesh;
  material: EmissiveMaterial;
  baseColor: THREE.Color;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

export interface GhostMesh {
  mesh: THREE.Mesh;
  material: THREE.Material;
  edges: THREE.LineSegments;
  /** a panel all but disappears; a pipe stays a tinted glass shell with its outline, the liquid inside */
  kind: "panel" | "pipe";
}

export interface SceneIndex {
  root: THREE.Object3D;
  byName: Map<string, THREE.Object3D>;
  parts: PartNode[];
  explode: ExplodeNode[];
  ghosts: GhostMesh[];
  flows: Record<string, FlowPath>;
  anchors: Record<string, THREE.Vector3>;
  /** node name → meshes with their own cloned material, for fault/override tinting */
  highlightable: Map<string, HighlightMesh[]>;
  bounds: THREE.Box3;
}

/** Blender Z-up world offset → three.js Y-up */
const blenderToThree = (v: number[]) => new THREE.Vector3(v[0], v[2], -v[1]);

const isNum2 = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

export function indexScene(root: THREE.Object3D, highlightPrefixes: string[], pipePrefixes: string[] = []): SceneIndex {
  root.updateMatrixWorld(true);
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name && !byName.has(o.name)) byName.set(o.name, o);
  });

  const parts: PartNode[] = [];
  const explode: ExplodeNode[] = [];
  const ghosts: GhostMesh[] = [];
  const flowPts: Record<string, { i: number; p: THREE.Vector3; s?: [number, number] }[]> = {};
  const anchors: Record<string, THREE.Vector3> = {};
  const highlightable = new Map<string, HighlightMesh[]>();
  const ghosted = new Set<THREE.Mesh>();

  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpP = new THREE.Vector3();

  root.traverse((o) => {
    const x = o.userData ?? {};

    // flow chains: flow_<stream>_<NN>
    const flow = /^flow_([a-z0-9]+)_(\d+)$/.exec(o.name);
    if (flow) {
      (flowPts[flow[1]] ??= []).push({
        i: Number(flow[2]),
        p: o.getWorldPosition(new THREE.Vector3()),
        s: isNum2(x.spread) ? x.spread : undefined,
      });
      return;
    }
    if (o.name.startsWith("anchor_")) {
      anchors[o.name] = o.getWorldPosition(new THREE.Vector3());
      return;
    }

    if (typeof x.motion === "string") {
      parts.push({
        obj: o,
        name: o.name,
        motion: x.motion as Motion,
        range: isNum2(x.range) ? x.range : [0, 0],
        drives: typeof x.drives === "string" ? x.drives : undefined,
        from: typeof x.from === "string" ? byName.get(x.from) : undefined,
        to: typeof x.to === "string" ? byName.get(x.to) : undefined,
        baseQuat: o.quaternion.clone(),
        basePos: o.position.clone(),
        baseScale: o.scale.clone(),
        value: 0,
        spin: 0,
      });
    }

    if (Array.isArray(x.explode) && x.explode.length === 3) {
      const world = blenderToThree(x.explode as number[]);
      // into the parent's local frame
      const offset = world.clone();
      if (o.parent) {
        o.parent.matrixWorld.decompose(tmpP, tmpQ, tmpS);
        offset.applyQuaternion(tmpQ.invert()).divide(tmpS);
      }
      explode.push({ obj: o, basePos: o.position.clone(), offset });
    }

    const pipe = pipePrefixes.some((p) => o.name === p || o.name.startsWith(p));
    if (x.cutaway || pipe) {
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh) || ghosted.has(m)) return;
        ghosted.add(m);
        const material = (m.material as THREE.Material).clone();
        m.material = material;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(m.geometry, 25),
          new THREE.LineBasicMaterial({ color: "#8d8980", transparent: true, opacity: 0, depthWrite: false }),
        );
        edges.raycast = () => {};
        m.add(edges);
        ghosts.push({ mesh: m, material, edges, kind: pipe ? "pipe" : "panel" });
      });
    }
  });

  // link rods: rest length from their authored pose
  for (const p of parts) {
    if (p.motion === "link" && p.from && p.to) {
      p.restLength = p.from.getWorldPosition(new THREE.Vector3()).distanceTo(p.to.getWorldPosition(new THREE.Vector3())) || 1;
    }
  }

  // cloned materials for anything a highlight might tint (each mesh cloned once, shared between entries)
  const claimed = new Map<THREE.Mesh, HighlightMesh>();
  for (const [name, o] of byName) {
    if (!highlightPrefixes.some((h) => name === h || name.startsWith(h))) continue;
    const list: HighlightMesh[] = [];
    o.traverse((m) => {
      if (!(m instanceof THREE.Mesh) || !isEmissive(m.material)) return;
      let h = claimed.get(m);
      if (!h) {
        // a see-through mesh already has its own material, and the ghosting fades that one: tint it too
        const material = (ghosted.has(m) ? m.material : m.material.clone()) as EmissiveMaterial;
        m.material = material;
        h = { mesh: m, material, baseColor: material.color.clone(), baseEmissive: material.emissive.clone(), baseIntensity: material.emissiveIntensity };
        claimed.set(m, h);
      }
      list.push(h);
    });
    if (list.length) highlightable.set(name, list);
  }

  const flows: Record<string, FlowPath> = {};
  for (const [id, pts] of Object.entries(flowPts)) {
    pts.sort((a, b) => a.i - b.i);
    let last: [number, number] = pts.find((p) => p.s)?.s ?? [0.3, 0.3];
    flows[id] = {
      id,
      points: pts.map((p) => p.p),
      spreads: pts.map((p) => (p.s ? (last = p.s) : last)),
    };
  }

  const bounds = new THREE.Box3();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) bounds.expandByObject(o);
  });

  return { root, byName, parts, explode, ghosts, flows, anchors, highlightable, bounds };
}
