#!/usr/bin/env node
// Validates a lab GLB against docs/asset-conventions.md.
//
//   node scripts/validate-glb.mjs <file.glb>
//     [--drives a,b,c]          allowed `drives` values
//     [--require-drives a,b,c]  drives that must be used by at least one node
//     [--require n1,n2]         node names that must exist
//     [--max-tris 60000] [--max-bytes 1000000]
//     [--compare raw.glb]       node TRS + extras must match this file (compression check)
//
// Exits 1 with a readable report on failure.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export const NAME_RE = /^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*(_\d{2})?$/;
const FLOW_RE = /^flow_(.+)_(\d{2})$/;
const MOTIONS = new Set(['rotate', 'translate', 'spin', 'link']);
const PIVOT_PAD = 0.02;

export async function readDocument(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(file);
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---- geometry helpers -------------------------------------------------------

function primitiveTris(prim) {
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : prim.getAttribute('POSITION')?.getCount() ?? 0;
  switch (prim.getMode()) {
    case 4: return Math.floor(count / 3); // TRIANGLES
    case 5: // TRIANGLE_STRIP
    case 6: return Math.max(0, count - 2); // TRIANGLE_FAN
    default: return 0;
  }
}

function meshBounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const el = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    for (let i = 0, n = pos.getCount(); i < n; i++) {
      pos.getElement(i, el); // denormalizes quantized data
      for (let k = 0; k < 3; k++) {
        if (el[k] < min[k]) min[k] = el[k];
        if (el[k] > max[k]) max[k] = el[k];
      }
    }
  }
  return { min, max };
}

// local-space bounds of the geometry a node owns: its own mesh, or (if a tool
// moved the mesh onto an unnamed child) that child's mesh through its TRS
function nodeLocalBounds(node) {
  const mesh = node.getMesh();
  if (mesh) return meshBounds(mesh);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const child of node.listChildren()) {
    if (child.getName() || !child.getMesh()) continue;
    const b = meshBounds(child.getMesh());
    const m = child.getMatrix();
    for (const cx of [b.min[0], b.max[0]]) for (const cy of [b.min[1], b.max[1]]) for (const cz of [b.min[2], b.max[2]]) {
      const p = [
        m[0] * cx + m[4] * cy + m[8] * cz + m[12],
        m[1] * cx + m[5] * cy + m[9] * cz + m[13],
        m[2] * cx + m[6] * cy + m[10] * cz + m[14],
      ];
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

// Fraction of triangles whose winding (glTF: CCW = front) disagrees with the
// exported vertex normals -- catches flipped faces / broken normals.
function flippedRatio(mesh) {
  let bad = 0;
  let total = 0;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const na = [0, 0, 0], nb = [0, 0, 0], nc = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const pos = prim.getAttribute('POSITION');
    const nor = prim.getAttribute('NORMAL');
    if (!pos || !nor) continue;
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const at = (i) => (idx ? idx.getScalar(i) : i);
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = at(t), i1 = at(t + 1), i2 = at(t + 2);
      pos.getElement(i0, a); pos.getElement(i1, b); pos.getElement(i2, c);
      nor.getElement(i0, na); nor.getElement(i1, nb); nor.getElement(i2, nc);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(f[0], f[1], f[2]);
      if (len < 1e-12) continue;
      total++;
      const s = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      if (f[0] * s[0] + f[1] * s[1] + f[2] * s[2] < 0) bad++;
    }
  }
  return total ? bad / total : 0;
}

function countTriangles(doc) {
  let tris = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) tris += primitiveTris(prim);
  }
  return tris;
}

// ---- checks -----------------------------------------------------------------

export function validateDocument(doc, opts = {}) {
  const errors = [];
  const warnings = [];
  const info = {};
  const nodes = doc.getRoot().listNodes();
  const byName = new Map();

  for (const node of nodes) {
    const name = node.getName();
    if (!name) {
      // unnamed helper nodes (e.g. created by a tool) are only allowed without extras
      if (Object.keys(node.getExtras() || {}).length) errors.push('unnamed node carries extras');
      continue;
    }
    if (!NAME_RE.test(name)) errors.push(`name "${name}" does not match ${NAME_RE}`);
    if (byName.has(name)) errors.push(`duplicate node name "${name}"`);
    byName.set(name, node);
  }

  const allowed = opts.drives ? new Set(opts.drives) : null;
  const usedDrives = new Set();
  const moving = [];
  for (const [name, node] of byName) {
    const ex = node.getExtras() || {};
    if ('explode' in ex && !(Array.isArray(ex.explode) && ex.explode.length === 3 && ex.explode.every(isNum))) {
      errors.push(`${name}: explode must be [x, y, z] numbers`);
    }
    if ('cutaway' in ex && ex.cutaway !== true) errors.push(`${name}: cutaway must be true`);
    if ('spread' in ex && !(Array.isArray(ex.spread) && ex.spread.length === 2 && ex.spread.every(isNum))) {
      errors.push(`${name}: spread must be [across, normal] numbers`);
    }
    if (!('motion' in ex)) continue;
    const m = ex.motion;
    if (!MOTIONS.has(m)) {
      errors.push(`${name}: motion "${m}" is not one of ${[...MOTIONS].join('|')}`);
      continue;
    }
    moving.push(name);
    if (m === 'link') {
      for (const k of ['from', 'to']) {
        if (typeof ex[k] !== 'string') errors.push(`${name}: link needs string "${k}"`);
        else if (!byName.has(ex[k])) errors.push(`${name}: link ${k}="${ex[k]}" is not a node`);
      }
      continue;
    }
    if (!(Array.isArray(ex.range) && ex.range.length === 2 && ex.range.every(isNum))) {
      errors.push(`${name}: range must be [min, max] numbers`);
    }
    if (typeof ex.drives !== 'string' || !ex.drives) {
      errors.push(`${name}: drives must be a non-empty string`);
    } else {
      usedDrives.add(ex.drives);
      if (allowed && !allowed.has(ex.drives)) errors.push(`${name}: drives "${ex.drives}" not in [${[...allowed].join(', ')}]`);
    }
  }
  for (const d of opts.requireDrives || []) {
    if (!usedDrives.has(d)) errors.push(`required drive "${d}" is not used by any node`);
  }
  info.moving = moving.length;
  info.drives = [...usedDrives].sort();

  // pivots: origin must lie inside the (padded) local bbox of the node's mesh
  for (const name of moving) {
    const node = byName.get(name);
    const b = nodeLocalBounds(node);
    if (!b) {
      if (node.getExtras().motion !== 'link') warnings.push(`${name}: moving node has no mesh`);
      continue;
    }
    const inside = [0, 1, 2].every((k) => b.min[k] - PIVOT_PAD <= 0 && 0 <= b.max[k] + PIVOT_PAD);
    if (!inside) {
      const fmt = (v) => v.map((x) => x.toFixed(3)).join(', ');
      errors.push(`${name}: pivot (node origin) is outside its mesh bbox [${fmt(b.min)}]..[${fmt(b.max)}] +${PIVOT_PAD}m`);
    }
  }

  // flows
  const flows = new Map();
  for (const name of byName.keys()) {
    const m = FLOW_RE.exec(name);
    if (m) {
      if (!flows.has(m[1])) flows.set(m[1], []);
      flows.get(m[1]).push(Number(m[2]));
    }
  }
  info.flows = {};
  for (const [stream, idx] of flows) {
    idx.sort((a, b) => a - b);
    info.flows[stream] = idx.length;
    if (idx.length < 2) errors.push(`flow_${stream}: needs at least 2 points (has ${idx.length})`);
    idx.forEach((v, i) => {
      if (v !== i) errors.push(`flow_${stream}: indices not contiguous from 00 (${idx.join(',')})`);
    });
  }
  const errsSeen = new Set();
  for (let i = errors.length - 1; i >= 0; i--) {
    if (errsSeen.has(errors[i])) errors.splice(i, 1);
    else errsSeen.add(errors[i]);
  }

  // anchors
  const anchors = [...byName.keys()].filter((n) => n.startsWith('anchor_'));
  info.anchors = anchors;
  if (!anchors.length) errors.push('no anchor_* nodes');

  for (const r of opts.require || []) if (!byName.has(r)) errors.push(`required node "${r}" is missing`);

  for (const [name, node] of byName) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const r = flippedRatio(mesh);
    if (r > 0.01) errors.push(`${name}: ${(100 * r).toFixed(1)}% of triangles disagree with their normals (flipped?)`);
    else if (r > 0) warnings.push(`${name}: ${(100 * r).toFixed(2)}% of triangles disagree with their normals`);
  }

  info.triangles = countTriangles(doc);
  if (opts.maxTris && info.triangles > opts.maxTris) errors.push(`triangles ${info.triangles} > budget ${opts.maxTris}`);
  info.materials = doc.getRoot().listMaterials().map((m) => m.getName()).sort();
  info.nodes = byName.size;
  return { errors, warnings, info };
}

function quatClose(a, b, eps) {
  const d1 = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const d2 = Math.max(...a.map((v, i) => Math.abs(v + b[i])));
  return Math.min(d1, d2) <= eps;
}

// Compare node TRS (+ extras) between two documents, matched by node name.
export function compareDocuments(docA, docB, eps = 1e-4) {
  const errors = [];
  const mapB = new Map(docB.getRoot().listNodes().filter((n) => n.getName()).map((n) => [n.getName(), n]));
  let compared = 0;
  for (const a of docA.getRoot().listNodes()) {
    const name = a.getName();
    if (!name) continue;
    const b = mapB.get(name);
    if (!b) {
      errors.push(`${name}: missing after compression`);
      continue;
    }
    compared++;
    const [ta, ra, sa] = [a.getTranslation(), a.getRotation(), a.getScale()];
    const [tb, rb, sb] = [b.getTranslation(), b.getRotation(), b.getScale()];
    const diff = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i])));
    if (diff(ta, tb) > eps) errors.push(`${name}: translation moved [${ta.map((v) => v.toFixed(4))}] -> [${tb.map((v) => v.toFixed(4))}]`);
    if (!quatClose(ra, rb, eps)) errors.push(`${name}: rotation changed`);
    if (diff(sa, sb) > eps) errors.push(`${name}: scale changed [${sa.map((v) => v.toFixed(4))}] -> [${sb.map((v) => v.toFixed(4))}]`);
    if (JSON.stringify(a.getExtras() || {}) !== JSON.stringify(b.getExtras() || {})) errors.push(`${name}: extras changed`);
    const pa = a.getParentNode()?.getName() ?? null;
    const pb = b.getParentNode()?.getName() ?? null;
    if (pa !== pb) errors.push(`${name}: parent changed ${pa} -> ${pb}`);
    if (a.getMesh() && !b.getMesh()) errors.push(`${name}: mesh moved off the node (quantization wrapper?)`);
    if (a.getMesh() && b.getMesh()) {
      const ba = meshBounds(a.getMesh());
      const bb = meshBounds(b.getMesh());
      const d = Math.max(diff(ba.min, bb.min), diff(ba.max, bb.max));
      if (d > 0.002) errors.push(`${name}: mesh bounds differ by ${d.toFixed(4)} m`);
    }
  }
  return { errors, compared };
}

// ---- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const out = { file: null };
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--drives') out.drives = list(next());
    else if (a === '--require-drives') out.requireDrives = list(next());
    else if (a === '--require') out.require = list(next());
    else if (a === '--max-tris') out.maxTris = Number(next());
    else if (a === '--max-bytes') out.maxBytes = Number(next());
    else if (a === '--compare') out.compare = next();
    else if (!a.startsWith('--') && !out.file) out.file = a;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.file) {
    console.error('usage: validate-glb.mjs <file.glb> [--drives a,b] [--require-drives a,b] [--require n,m] [--max-tris N] [--max-bytes N] [--compare raw.glb]');
    return 2;
  }
  const doc = await readDocument(opts.file);
  const { errors, warnings, info } = validateDocument(doc, opts);
  const bytes = fs.statSync(opts.file).size;
  if (opts.maxBytes && bytes > opts.maxBytes) errors.push(`file size ${bytes} B > budget ${opts.maxBytes} B`);
  let compared = null;
  if (opts.compare) {
    const ref = await readDocument(opts.compare);
    const cmp = compareDocuments(ref, doc);
    compared = cmp.compared;
    errors.push(...cmp.errors.map((e) => `[compare] ${e}`));
  }

  const rel = path.relative(process.cwd(), opts.file);
  console.log(`validate ${rel}`);
  console.log(`  nodes ${info.nodes}, moving ${info.moving}, triangles ${info.triangles}${opts.maxTris ? ` / ${opts.maxTris}` : ''}, ` +
    `size ${bytes} B${opts.maxBytes ? ` / ${opts.maxBytes}` : ''}`);
  console.log(`  drives: ${info.drives.join(', ')}`);
  console.log(`  flows: ${Object.entries(info.flows).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  console.log(`  anchors: ${info.anchors.join(', ')}`);
  console.log(`  materials: ${info.materials.join(', ')}`);
  if (compared !== null) console.log(`  compared TRS/extras of ${compared} nodes against ${path.relative(process.cwd(), opts.compare)}`);
  for (const w of warnings) console.log(`  warn: ${w}`);
  if (errors.length) {
    console.log(`FAIL (${errors.length} problem${errors.length > 1 ? 's' : ''})`);
    for (const e of errors) console.log(`  - ${e}`);
    return 1;
  }
  console.log('PASS');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
