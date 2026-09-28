import * as THREE from "three";
import { toCreasedNormals } from "three-stdlib";

/**
 * Light cel shading: stepped toon lighting plus inverted-hull ink outlines.
 * Aimed at a restrained comic-book look: a few soft bands and thin, constant-width lines.
 */

export interface ToonOptions {
  /** Brightness of each lighting band, dark to light (0–255) */
  bands?: number[];
  /** Outline width in CSS pixels */
  lineWidth?: number;
  lineColor?: THREE.ColorRepresentation;
}

const DEFAULT_BANDS = [96, 160, 214, 255];

type Emissive = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number; color: THREE.Color };

function gradientMap(bands: number[]) {
  const tex = new THREE.DataTexture(new Uint8Array(bands), bands.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Swap every PBR material under `root` for a toon material with the same color and emissive. */
export function toonify(root: THREE.Object3D, opts: ToonOptions = {}) {
  const map = gradientMap(opts.bands ?? DEFAULT_BANDS);
  const swapped = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const convert = (m: THREE.Material) => {
    let t = swapped.get(m);
    if (t) return t;
    const src = m as Partial<Emissive> & THREE.Material;
    t = new THREE.MeshToonMaterial({
      name: m.name,
      color: src.color?.clone() ?? new THREE.Color("#ffffff"),
      emissive: src.emissive?.clone() ?? new THREE.Color("#000000"),
      emissiveIntensity: src.emissiveIntensity ?? 1,
      gradientMap: map,
      transparent: m.transparent,
      opacity: m.opacity,
      // the generated meshes are closed solids; single-sided keeps the ink hulls clean
      side: THREE.FrontSide,
    });
    swapped.set(m, t);
    return t;
  };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
  });
  return map;
}

const inkVertex = /* glsl */ `
  uniform float thickness;
  uniform vec2 size;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
    float len = length(dir);
    if (len > 1e-5) clip.xy += (dir / len) * thickness / size * clip.w * 2.0;
    gl_Position = clip;
  }
`;

const inkFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  void main() {
    gl_FragColor = vec4(color, opacity);
    #include <colorspace_fragment>
  }
`;

export function inkMaterial(color: THREE.ColorRepresentation, transparent = false) {
  return new THREE.ShaderMaterial({
    vertexShader: inkVertex,
    fragmentShader: inkFragment,
    side: THREE.BackSide,
    transparent,
    depthWrite: !transparent,
    uniforms: {
      color: { value: new THREE.Color(color) },
      opacity: { value: 1 },
      thickness: { value: 2 },
      size: { value: new THREE.Vector2(1, 1) },
    },
  });
}

export interface InkHulls {
  shared: THREE.ShaderMaterial;
  /** mesh → its hull, for meshes that need their own fading hull (cutaway ghosts) */
  own: Map<THREE.Mesh, THREE.Mesh>;
  materials: THREE.ShaderMaterial[];
  lineWidth: number;
}

/**
 * Give every mesh a slightly inflated, back-faced, ink-colored twin. Only its rim shows around
 * the silhouette, which draws outlines at every part boundary. Normals are fully smoothed so the
 * hull doesn't crack open at hard edges.
 */
export function addInkHulls(root: THREE.Object3D, opts: ToonOptions & { ownHull?: Set<THREE.Mesh> } = {}): InkHulls {
  const color = opts.lineColor ?? "#101114";
  const shared = inkMaterial(color);
  const own = new Map<THREE.Mesh, THREE.Mesh>();
  const materials = [shared];
  const creased = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.isHull && !(o instanceof THREE.InstancedMesh)) meshes.push(o);
  });
  for (const m of meshes) {
    let g = creased.get(m.geometry);
    if (!g) {
      g = toCreasedNormals(m.geometry, Math.PI);
      creased.set(m.geometry, g);
    }
    const needsOwn = opts.ownHull?.has(m);
    const mat = needsOwn ? inkMaterial(color, true) : shared;
    if (needsOwn) materials.push(mat);
    const hull = new THREE.Mesh(g, mat);
    hull.userData.isHull = true;
    hull.raycast = () => {};
    hull.castShadow = false;
    m.add(hull);
    if (needsOwn) own.set(m, hull);
  }
  return { shared, own, materials, lineWidth: opts.lineWidth ?? 1.4 };
}
