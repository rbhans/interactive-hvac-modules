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

/**
 * The hand-drawn pass every toon surface shares, after the way comic and Moebius-style renderers
 * place detail where it has a cause:
 *  - hatching only inside real shadow (cast or deep), in screen-space strokes like a pen would lay
 *    them, single strokes first and a cross-stroke only where it's darkest
 *  - hard toon glints on metal, per material
 *  - drawn seams and rivets, per material; a soft paint grain; a little grime near the deck
 * One set of knobs for the whole scene; the per-material ones live on each material.
 */
export const DETAIL = {
  /** how much a hatch stroke darkens */
  uHatch: { value: 0.3 },
  /** pen strokes: CSS px between them */
  uHatchSpacing: { value: 6.5 },
  /** light level (1 = full sun on the face) below which single strokes start, and cross-strokes */
  uShade: { value: new THREE.Vector2(0.45, 0.17) },
  /** direct light on a face in full sun, for normalizing the light level (depends on the scene's lights) */
  uLitRef: { value: 0.91 },
  /** device pixels per CSS pixel, so strokes keep their spacing on any screen */
  uPixelRatio: { value: 1 },
  /** paint grain strength, 0–1 */
  uGrain: { value: 1 },
  /** direction toward the key light, world space */
  uKeyDir: { value: new THREE.Vector3(-4, 7, 6).normalize() },
};

// dev-only handle for tuning the detail pass live from the console
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __detail?: typeof DETAIL }).__detail = DETAIL;

const detailVertexPars = /* glsl */ `
  varying vec3 vDetailPos;
  varying vec3 vDetailNrm;
  varying vec3 vDetailWorldNrm;
  varying float vDetailHeight;
`;

const detailVertex = /* glsl */ `
  {
    float detailScale = length(modelMatrix[0].xyz);
    vDetailPos = transformed * detailScale;
    vDetailNrm = objectNormal;
    vDetailWorldNrm = normalize(mat3(modelMatrix) * objectNormal);
    vDetailHeight = (modelMatrix * vec4(transformed, 1.0)).y;
  }
`;

const detailFragmentPars = /* glsl */ `
  varying vec3 vDetailPos;
  varying vec3 vDetailNrm;
  varying vec3 vDetailWorldNrm;
  varying float vDetailHeight;
  uniform vec4 uSeam;
  uniform vec2 uRivet;
  uniform vec2 uGlint;
  uniform vec2 uXray;
  uniform float uHatch;
  uniform float uHatchSpacing;
  uniform vec2 uShade;
  uniform float uLitRef;
  uniform float uPixelRatio;
  uniform float uGrain;
  uniform vec3 uKeyDir;

  float detailHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float detailNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(detailHash(i), detailHash(i + vec3(1, 0, 0)), f.x), mix(detailHash(i + vec3(0, 1, 0)), detailHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(detailHash(i + vec3(0, 0, 1)), detailHash(i + vec3(1, 0, 1)), f.x), mix(detailHash(i + vec3(0, 1, 1)), detailHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  /** A drawn seam every spacing m along one axis, about 5 mm wide, faded out when it would alias */
  float detailSeam(float x, float spacing) {
    if (spacing <= 0.0) return 0.0;
    float d = abs(fract(x / spacing + 0.5) - 0.5) * spacing;
    float w = fwidth(x);
    return (1.0 - smoothstep(0.0025 - w, 0.0025 + w, d)) * (1.0 - smoothstep(0.004, 0.012, w));
  }
  /** Distance to the nearest seam on this axis, m */
  float detailSeamDist(float x, float spacing) {
    return spacing <= 0.0 ? 1e3 : abs(fract(x / spacing + 0.5) - 0.5) * spacing;
  }
  /** A pen stroke family in screen space: 1 on a stroke, about 1.2 px wide, anti-aliased */
  float detailPen(float x, float spacing) {
    float d = abs(mod(x, spacing) - spacing * 0.5);
    return 1.0 - smoothstep(0.5, 1.2, d);
  }
`;

const detailFragment = /* glsl */ `
  // x-ray (a see-through pipe): clear where it faces you, solid toward its silhouette, like a glass tube
  if (uXray.x > 0.0) {
    float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
    float edge = pow(1.0 - facing, 2.2);
    diffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, uXray.y), edge * uXray.x);
  }
  {
    vec3 n = normalize(vDetailNrm);
    // how much direct light actually reaches this spot, 1 = full sun on the face (shadows included)
    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    float lum = dot(reflectedLight.directDiffuse, W) / max(dot(diffuseColor.rgb, W), 1e-3) / uLitRef;

    // hatching only in shadow: single strokes, then a cross-stroke where it's darkest. Screen space,
    // like a pen, with a slow wobble so they read drawn rather than ruled.
    vec2 px = gl_FragCoord.xy / uPixelRatio;
    float wob = (detailNoise(vec3(px * 0.035, 1.7)) - 0.5) * 3.0;
    float light = 1.0 - smoothstep(uShade.x - 0.08, uShade.x, lum);
    float dark = 1.0 - smoothstep(uShade.y - 0.06, uShade.y, lum);
    float hatch = max(detailPen(px.x + px.y + wob, uHatchSpacing) * light, detailPen(px.x - px.y - wob * 0.7, uHatchSpacing * 1.2) * dark);
    outgoingLight *= 1.0 - uHatch * hatch;

    // hard toon glint on metal (per material), only where the key light reaches
    if (uGlint.y > 0.0) {
      vec3 L = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
      float nh = max(dot(geometryNormal, normalize(L + geometryViewDir)), 0.0);
      float g = smoothstep(0.55, 0.62, pow(nh, uGlint.x)) * smoothstep(uShade.x, uShade.x + 0.15, lum);
      outgoingLight = mix(outgoingLight, vec3(1.0), g * uGlint.y);
    }

    // paint grain: broad mottling and a finer tooth, a few percent each
    float broad = detailNoise(vDetailPos * 5.0) - 0.5;
    float fine = (detailNoise(vDetailPos * 38.0) - 0.5) * (1.0 - smoothstep(0.3, 0.8, fwidth(vDetailPos.x * 38.0) + fwidth(vDetailPos.y * 38.0)));
    outgoingLight *= 1.0 + uGrain * (broad * 0.07 + fine * 0.05);

    // drawn seams (per material): panel joints across x, y and z, never on a face that faces along the
    // same axis (it would be all seam or none), with rivet dots along them
    if (uSeam.w > 0.0) {
      vec3 p = vDetailPos;
      vec3 a = abs(n);
      float seam = max(max(detailSeam(p.x, uSeam.x) * (1.0 - a.x), detailSeam(p.y, uSeam.y) * (1.0 - a.y)), detailSeam(p.z, uSeam.z) * (1.0 - a.z));
      float rivet = 0.0;
      if (uRivet.x > 0.0) {
        // along each seam, one dot every uRivet.x m, 1 cm from the joint on the near side
        float along = a.y > 0.5 ? p.z : p.y;
        float dAlong = abs(fract(along / uRivet.x + 0.5) - 0.5) * uRivet.x;
        float dSeam = abs(detailSeamDist(p.x, uSeam.x) - 0.012) * (1.0 - a.x);
        float r = length(vec2(dSeam, dAlong));
        float w = fwidth(p.x) + fwidth(p.y) + fwidth(p.z);
        rivet = (1.0 - smoothstep(uRivet.y - w, uRivet.y + w, r)) * (1.0 - smoothstep(0.004, 0.01, w)) * (1.0 - a.x);
      }
      outgoingLight *= 1.0 - uSeam.w * max(seam, rivet * 0.8);
    }

    // a little grime where things meet the deck, broken up so it doesn't read as a gradient
    float low = 1.0 - smoothstep(0.02, 0.42, vDetailHeight + (detailNoise(vDetailPos * 7.0) - 0.5) * 0.12);
    outgoingLight *= 1.0 - 0.1 * uGrain * low;
  }
`;

/**
 * MeshToonMaterial plus the detail pass. A subclass (not a per-instance hook) so the clones the scene
 * index makes for cutaway ghosts and highlights keep it.
 */
export class DetailToonMaterial extends THREE.MeshToonMaterial {
  /** Drawn seams: spacing along object x, y, z (m, 0 = none) and darkness */
  seam = new THREE.Vector4(0, 0, 0, 0);
  /** Rivets along the x seams: spacing along the seam and dot radius (m); 0 = none */
  rivet = new THREE.Vector2(0, 0);
  /** Toon glint: sharpness exponent and strength; 0 = none */
  glint = new THREE.Vector2(0, 0);
  /** X-ray: how far it's on (0–1) and the opacity it keeps at its silhouette; the cutaway drives it for pipes */
  xray = new THREE.Vector2(0, 0.6);

  onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms) {
    Object.assign(shader.uniforms, DETAIL, { uSeam: { value: this.seam }, uRivet: { value: this.rivet }, uGlint: { value: this.glint }, uXray: { value: this.xray } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + detailVertexPars)
      .replace("#include <project_vertex>", "#include <project_vertex>\n" + detailVertex);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + detailFragmentPars)
      .replace("#include <opaque_fragment>", detailFragment + "\n#include <opaque_fragment>");
  }
  customProgramCacheKey() {
    return "detail-toon-4";
  }

  copy(source: DetailToonMaterial) {
    super.copy(source);
    this.seam.copy(source.seam);
    this.rivet.copy(source.rivet);
    this.glint.copy(source.glint);
    this.xray.copy(source.xray);
    return this;
  }
}

/**
 * Surface detail by material: where panels, duct sections and roof sheets join (spacings in the part's
 * own axes: glTF x along the unit, y up, z across), and which materials are shiny. Kept sparse on purpose.
 */
const SURFACE: Record<string, { seam?: [number, number, number, number]; rivet?: [number, number]; glint?: [number, number] }> = {
  mat_housing: { seam: [0.6, 0, 0, 0.42], rivet: [0.16, 0.0045] },
  mat_duct: { seam: [0.55, 0, 0, 0.36], rivet: [0.14, 0.004] },
  mat_deck: { seam: [1.3, 0, 1.3, 0.2] },
  mat_wall: { seam: [0, 0.62, 1.25, 0.24] },
  // metal and plastic parts catch a hard highlight; the graphite frame gets edge glints on its bevels
  mat_valve: { glint: [60, 0.75] },
  mat_copper: { glint: [50, 0.6] },
  mat_steel: { glint: [40, 0.55] },
  mat_blade: { glint: [30, 0.4] },
  mat_actuator: { glint: [90, 0.5] },
  mat_pump: { glint: [70, 0.45] },
  mat_frame: { glint: [45, 0.35] },
  mat_sensor: { glint: [50, 0.5] },
};

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
  const swapped = new Map<THREE.Material, DetailToonMaterial>();
  const convert = (m: THREE.Material) => {
    let t = swapped.get(m);
    if (t) return t;
    const src = m as Partial<Emissive> & THREE.Material;
    t = new DetailToonMaterial({
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
    const surface = SURFACE[m.name];
    if (surface?.seam) t.seam.set(...surface.seam);
    if (surface?.rivet) t.rivet.set(...surface.rivet);
    if (surface?.glint) t.glint.set(...surface.glint);
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
export function addInkHulls(
  root: THREE.Object3D,
  opts: ToonOptions & { ownHull?: Set<THREE.Mesh>; skip?: (m: THREE.Mesh) => boolean } = {},
): InkHulls {
  const color = opts.lineColor ?? "#101114";
  const shared = inkMaterial(color);
  const own = new Map<THREE.Mesh, THREE.Mesh>();
  const materials = [shared];
  const creased = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.isHull && !(o instanceof THREE.InstancedMesh) && !opts.skip?.(o)) meshes.push(o);
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
