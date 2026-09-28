"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { DETAIL } from "./toon";

/**
 * Inner ink lines: the comic-book detail lines inside a part's outline (creases, bevels, seams,
 * where one part meets another). The ink hulls only draw silhouettes.
 *
 * Each frame the equipment is drawn once more into an off-screen buffer as bare surface directions,
 * and a full-screen pass inks wherever the direction jumps between neighboring pixels. It sits just
 * after the opaque scene and before the air, so particles float in front of the lines.
 */

/** Meshes that get inner lines */
export const INK_LAYER = 1;
/** Meshes that hide what's behind them but never get lines themselves (fin packs, filter pleats, fan wheel) */
export const OCCLUDE_LAYER = 2;

const normalVertex = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const normalFragment = /* glsl */ `
  uniform float uMask;
  varying vec3 vN;
  void main() {
    gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, uMask);
  }
`;

const edgeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const edgeFragment = /* glsl */ `
  uniform sampler2D uNormals;
  uniform vec2 uStep;
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  float inkHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }
  void main() {
    // a slow waver in where the neighbors are read, so lines drift a little like a pen's (Moebius-style)
    vec2 fc = gl_FragCoord.xy;
    float h = inkHash(floor(fc / 11.0));
    vec2 uv = vUv + vec2(sin(fc.y * 0.07 + h * 6.28), cos(fc.x * 0.07 + h * 6.28)) * 0.6 * uStep;
    vec4 c = texture2D(uNormals, uv);
    vec4 d = texture2D(uNormals, uv + uStep);
    vec4 r = texture2D(uNormals, uv + vec2(uStep.x, 0.0));
    vec4 u = texture2D(uNormals, uv + vec2(0.0, uStep.y));
    vec4 l = texture2D(uNormals, uv - vec2(uStep.x, 0.0));
    vec4 b = texture2D(uNormals, uv - vec2(0.0, uStep.y));
    // only between two inkable surfaces: silhouettes are the hulls' job, fins and pleats stay clean
    float both = step(0.5, c.a) * step(0.5, d.a) * step(0.5, r.a) * step(0.5, u.a);
    // Roberts cross on the packed normals: |Δ| = sin(θ/2), so ~0.2 is a 25° crease, ~0.4 is 45°
    float e = max(length(c.rgb - d.rgb), length(r.rgb - u.rgb));
    // crevices (normals turning toward each other) get the heavier line, outside edges a lighter one,
    // the way an inker weights them
    float div = (r.x - l.x) + (u.y - b.y);
    float weight = mix(0.6, 1.15, 1.0 - smoothstep(-0.05, 0.05, div));
    float ink = smoothstep(0.17, 0.4, e) * both * uStrength * weight;
    if (ink < 0.01) discard;
    gl_FragColor = vec4(uColor, min(ink, 0.85));
    #include <colorspace_fragment>
  }
`;

export function InkEdges({ strength = 0.5, color = "#101114" }: { strength?: number; color?: THREE.ColorRepresentation }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const target = useMemo(() => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), []);
  const normals = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: normalVertex, fragmentShader: normalFragment, uniforms: { uMask: { value: 1 } } }),
    [],
  );
  const quad = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: edgeVertex,
        fragmentShader: edgeFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uNormals: { value: target.texture },
          uStep: { value: new THREE.Vector2() },
          uStrength: { value: strength },
          uColor: { value: new THREE.Color(color) },
        },
      }),
    );
    m.frustumCulled = false;
    // after the opaque scene, before the air and water particles (renderOrder 2+)
    m.renderOrder = 1;
    m.raycast = () => {};
    return m;
  }, [target, strength, color]);

  useEffect(() => {
    const w = Math.max(1, Math.round(size.width * dpr));
    const h = Math.max(1, Math.round(size.height * dpr));
    target.setSize(w, h);
    // sample about one CSS pixel apart, so the lines keep their weight on high-density screens
    const px = Math.max(1, dpr * 0.8);
    // the surface hatching is laid in screen space too
    DETAIL.uPixelRatio.value = dpr;
    (quad.material as THREE.ShaderMaterial).uniforms.uStep.value.set(px / w, px / h);
  }, [size, dpr, target, quad]);

  useEffect(
    () => () => {
      target.dispose();
      normals.dispose();
      quad.geometry.dispose();
      (quad.material as THREE.Material).dispose();
    },
    [target, normals, quad],
  );

  useFrame(() => {
    const prev = {
      target: gl.getRenderTarget(),
      override: scene.overrideMaterial,
      layers: camera.layers.mask,
      autoClear: gl.autoClear,
      clearAlpha: gl.getClearAlpha(),
      clearColor: gl.getClearColor(new THREE.Color()),
    };
    gl.setRenderTarget(target);
    gl.setClearColor(0x8080ff, 0);
    gl.clear(true, true, false);
    gl.autoClear = false;
    scene.overrideMaterial = normals;
    // inkable surfaces, then the occluders over them wherever they're in front
    normals.uniforms.uMask.value = 1;
    camera.layers.set(INK_LAYER);
    gl.render(scene, camera);
    normals.uniforms.uMask.value = 0;
    camera.layers.set(OCCLUDE_LAYER);
    gl.render(scene, camera);

    scene.overrideMaterial = prev.override;
    camera.layers.mask = prev.layers;
    gl.autoClear = prev.autoClear;
    gl.setClearColor(prev.clearColor, prev.clearAlpha);
    gl.setRenderTarget(prev.target);
  });

  return <primitive object={quad} />;
}
