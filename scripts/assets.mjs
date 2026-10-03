#!/usr/bin/env node
// 3D asset pipeline.
//
//   node scripts/assets.mjs build    [module]   Blender headless -> build/<m>.blend, build/<m>.raw.glb
//   node scripts/assets.mjs compress [module] [--mode filter|quantize-safe|meshopt]
//                                               build/<m>.raw.glb -> public/lab/<m>/scene.glb (Meshopt)
//   node scripts/assets.mjs validate [module]   validator with the per-module args below (+ TRS compare vs raw)
//
// BLENDER=/path/to/Blender overrides the Blender binary.
//
// Compression: gltf-transform's quantize() folds the position dequantization
// transform into the node TRS of leaf mesh nodes, which moves pivots. So
// compress tries candidate modes, re-reads each result, and keeps the smallest
// one whose node TRS / extras / hierarchy still match the raw GLB:
//   meshopt        gltf-transform meshopt() (quantizes POSITION -> usually rejected)
//   quantize-safe  reorder + quantize everything except POSITION + EXT_meshopt_compression
//   filter         reorder + EXT_meshopt_compression with meshopt filters (float positions kept)
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { compareDocuments } from './validate-glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';

// Per-module validation table.
const MODULES = {
  economizer: {
    drives: ['oaBladePos', 'raBladePos', 'eaBladePos', 'actuatorPos', 'fanSpeed'],
    require: [
      'oa_damper', 'oa_blade_01', 'oa_blade_03', 'oa_blade_06', 'ra_damper', 'ra_blade_01', 'ra_blade_04',
      'ea_damper', 'ea_blade_01', 'ea_blade_04', 'oa_crank', 'oa_crank_pin', 'oa_actuator', 'oa_actuator_hub',
      'ea_crank', 'ea_crank_pin', 'link_rod_01', 'fan_wheel', 'fan_assembly', 'filter_bank', 'mat_sensor',
      'mat_sensor_head', 'housing_front', 'ra_duct', 'sa_duct', 'anchor_oa', 'anchor_ea', 'anchor_ra', 'anchor_mat',
      'anchor_actuator', 'anchor_fan', 'anchor_sa', 'flow_oa_00', 'flow_ra_00', 'flow_ea_00', 'flow_ma_00',
      'site_deck', 'site_wall', 'site_pavers',
    ],
    maxTris: 60000,
    maxBytes: 1_000_000,
  },
  coils: {
    drives: ['chwValvePos', 'hwValvePos', 'fanSpeed'],
    require: [
      'housing_front', 'housing_back', 'housing_roof', 'housing_floor', 'housing_end', 'filter_bank',
      'hw_coil', 'hw_coil_fins', 'hw_coil_casing', 'hw_coil_headers', 'hw_coil_bends',
      'chw_coil', 'chw_coil_fins', 'chw_coil_casing', 'chw_coil_headers', 'chw_coil_bends',
      'chw_drain_pan', 'chw_trap', 'dat_sensor', 'dat_sensor_head',
      'fan_assembly', 'fan_wheel', 'fan_wall', 'fan_inlet', 'fan_motor', 'fan_base', 'sa_duct',
      'hw_supply_pipe', 'hw_return_pipe', 'hw_valve', 'hw_valve_actuator', 'hw_valve_stem', 'hw_valve_indicator',
      'hw_ball_valve_01', 'hw_ball_valve_02', 'hw_balancing_valve', 'hw_thermometer_01', 'hw_thermometer_02',
      'chw_supply_pipe', 'chw_return_pipe', 'chw_valve', 'chw_valve_actuator', 'chw_valve_stem', 'chw_valve_indicator',
      'chw_ball_valve_01', 'chw_ball_valve_02', 'chw_balancing_valve', 'chw_thermometer_01', 'chw_thermometer_02',
      'anchor_eat', 'anchor_hw', 'anchor_chw', 'anchor_dat', 'anchor_hw_valve', 'anchor_chw_valve', 'anchor_sa',
      'anchor_pan', 'flow_chws_00', 'flow_chwr_00', 'flow_hws_00', 'flow_hwr_00', 'flow_air_00',
      'drip_a', 'drip_b', 'drip_pan', 'site_deck', 'site_wall', 'site_pavers',
    ],
    maxTris: 60000,
    maxBytes: 1_000_000,
  },
  vav: {
    drives: ['damperPos', 'actuatorPos'],
    require: [
      'room', 'room_floor', 'room_wall_back', 'room_wall_left', 'ceiling_tiles', 'ceiling_grid',
      'diffuser_01', 'diffuser_02', 'return_grille', 'tstat', 'desk', 'monitor', 'chair',
      'supply_main', 'neighbor_takeoff', 'static_tap', 'branch_duct', 'hangers',
      'vav_box', 'vav_inlet', 'vav_flow_cross', 'vav_sense_tubes', 'vav_damper_blade', 'vav_controller',
      'vav_actuator_hub', 'vav_casing', 'vav_casing_front', 'vav_hangers',
      'sa_discharge', 'sa_discharge_front', 'drop_01', 'drop_02',
      'anchor_static', 'anchor_flow', 'anchor_damper', 'anchor_box', 'anchor_diffuser', 'anchor_zone', 'anchor_tstat',
      'flow_main_00', 'flow_box_00', 'flow_d1e_00', 'flow_ret1_00',
    ],
    maxTris: 60000,
    maxBytes: 1_000_000,
  },
  reset: {
    drives: ['fanSpeed', 'damper1', 'damper2', 'damper3', 'damper4', 'actuator1', 'actuator2', 'actuator3', 'actuator4'],
    require: [
      'floor_slab', 'mech_floor', 'zone1_floor', 'zone2_floor', 'zone3_floor', 'zone4_floor',
      'wall_back', 'wall_left', 'partitions', 'ahu', 'ahu_front', 'fan_wheel', 'fan_motor', 'vfd',
      'riser', 'riser_front', 'supply_main', 'supply_main_front', 'static_tap', 'main_hangers',
      'vav1', 'vav1_damper_blade', 'vav1_actuator_hub', 'vav1_casing_front', 'vav2_damper_blade',
      'vav3_damper_blade', 'vav4', 'vav4_damper_blade', 'vav4_actuator_hub', 'vav4_drop', 'vav4_diffuser',
      'anchor_fan', 'anchor_static', 'anchor_vav1', 'anchor_vav2', 'anchor_vav3', 'anchor_vav4',
      'flow_ahu_00', 'flow_main_00', 'flow_b1_00', 'flow_b4_00', 'flow_t1e_00', 'flow_t4w_00',
    ],
    maxTris: 160000,
    maxBytes: 2_000_000,
  },
  pumps: {
    drives: ['pumpSpeed', 'valveTravel', 'suctionGauge', 'dischargeGauge'],
    require: [
      'floor_slab', 'pad', 'wall_back', 'pump', 'pump_casing', 'pump_casing_front', 'pump_impeller', 'pump_motor',
      'suction_pipe', 'discharge_pipe', 'suction_strainer', 'suction_valve', 'tdv', 'tdv_handwheel', 'flow_meter',
      'suction_gauge_needle', 'discharge_gauge_needle', 'vfd', 'anchor_pump', 'anchor_meter', 'anchor_valve',
      'anchor_gauges', 'anchor_strainer', 'anchor_vfd', 'flow_suc_00', 'flow_dis_00',
    ],
    maxTris: 100000,
    maxBytes: 1_500_000,
  },
  valves3: {
    drives: ['pumpSpeed', 'valvePos1', 'valvePos2', 'valvePos3'],
    require: [
      'floor_slab', 'wall_back', 'pump_casing', 'pump_impeller', 'sup_main', 'ret_main', 'suction', 'dp_sensor',
      'coil1_fins', 'coil2_fins', 'coil3_fins', 's1_pipe', 'r1_pipe', 'b1_pipe', 'b3_pipe', 'tv1_valve_stem', 'bv1',
      'anchor_pump', 'anchor_dp', 'anchor_ahu1', 'anchor_ahu3', 'flow_sup_00', 'flow_ret_00', 'flow_b1_00',
    ],
    maxTris: 140000,
    maxBytes: 2_000_000,
  },
};

const rawPath = (m) => path.join(ROOT, 'build', `${m}.raw.glb`);
const outPath = (m) => path.join(ROOT, 'public', 'lab', m, 'scene.glb');

// flags that take a value: that value is not the module name
const VALUE_FLAGS = new Set(['--mode']);

function moduleArg(args) {
  const m = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) || 'economizer';
  if (!/^[a-z][a-z0-9_]*$/.test(m)) throw new Error(`bad module name ${m}`);
  return m;
}

async function makeIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

function build(args) {
  const m = moduleArg(args);
  if (!fs.existsSync(BLENDER)) {
    console.error(`Blender not found at ${BLENDER} (set BLENDER=...)`);
    return 1;
  }
  const r = spawnSync(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1',
    '-P', path.join(ROOT, 'blender', 'build.py'), '--', m], { stdio: 'inherit', cwd: ROOT });
  if (r.error) console.error(`could not run Blender: ${r.error.message}`);
  return r.status ?? 1;
}

/** Bake the module's airflow field headless (blender/sims/<module>_flow.py). */
function flow(args) {
  const m = moduleArg(args);
  const script = path.join(ROOT, 'blender', 'sims', `${m}_flow.py`);
  if (!fs.existsSync(script)) {
    console.error(`no flow bake for module ${m} (${path.relative(ROOT, script)})`);
    return 1;
  }
  if (!fs.existsSync(BLENDER)) {
    console.error(`Blender not found at ${BLENDER} (set BLENDER=...)`);
    return 1;
  }
  const r = spawnSync(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script], { stdio: 'inherit', cwd: ROOT });
  if (r.error) console.error(`could not run Blender: ${r.error.message}`);
  return r.status ?? 1;
}

/** Check a baked field: header sane, data present, sizes match, boundary walls and openings, mass balance. */
function validateFlow(m) {
  const dir = path.join(ROOT, 'public', 'lab', m);
  const metaPath = path.join(dir, 'flow.json');
  if (!fs.existsSync(metaPath)) return 0; // optional
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const errors = [];
  const dataPath = path.join(dir, meta.data ?? 'flow.bin.gz');
  if (!fs.existsSync(dataPath)) errors.push(`missing ${path.relative(ROOT, dataPath)}`);
  else {
    const raw = fs.readFileSync(dataPath);
    const bytes = dataPath.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
    const [nx, ny, nz] = meta.n;
    // staggered faces: ux (nx+1)·ny·nz, uy nx·(ny+1)·nz, uz nx·ny·(nz+1)
    const sizes = { ux: (nx + 1) * ny * nz, uy: nx * (ny + 1) * nz, uz: nx * ny * (nz + 1) };
    const per = sizes.ux + sizes.uy + sizes.uz;
    if (meta.layout !== 'staggered') errors.push(`layout ${meta.layout}, expected staggered`);
    if (bytes.length !== per * meta.states.length) errors.push(`data is ${bytes.length} B, expected ${per * meta.states.length}`);
    meta.states.forEach((s, k) => {
      const base = k * per;
      const want = { ux: base, uy: base + sizes.ux, uz: base + sizes.ux + sizes.uy };
      for (const key of ['ux', 'uy', 'uz']) if (s[key] !== want[key]) errors.push(`state ${k} ${key} offset ${s[key]} != ${want[key]}`);
      if (!(s.vmax > 0 && Number.isFinite(s.vmax))) errors.push(`state ${k} vmax ${s.vmax}`);
    });
    // Every domain boundary face is a wall (-128) except the openings (on any of the six planes: a
    // duct end on x, diffuser necks on z), and every opening must carry flow. Checked for every state,
    // plus each state's mass balance.
    if (bytes.length === per * meta.states.length) {
      const q = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
      const ix = (i, j, k) => (k * ny + j) * (nx + 1) + i;
      const iy = (i, j, k) => (k * (ny + 1) + j) * nx + i;
      const iz = (i, j, k) => (k * ny + j) * nx + i;
      const A = meta.h * meta.h;
      meta.states.forEach((s, st) => {
        let inflow = 0, outflow = 0, noFlow = 0;
        // sign +1 on a min plane: flow along +axis there is into the field
        const face = (offset, index, sign) => {
          const v = q[offset + index];
          if (v === -128) return;
          if (v === 0) { noFlow++; return; }
          const flow = sign * Math.sign(v) * (v / 127) ** 2 * s.vmax * A; // > 0 = into the field
          if (flow > 0) inflow += flow; else outflow -= flow;
        };
        for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { face(s.ux, ix(0, j, k), 1); face(s.ux, ix(nx, j, k), -1); }
        for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { face(s.uy, iy(i, 0, k), 1); face(s.uy, iy(i, ny, k), -1); }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { face(s.uz, iz(i, j, 0), 1); face(s.uz, iz(i, j, nz), -1); }
        if (noFlow) errors.push(`state ${st}: ${noFlow} open boundary faces carry no flow (an opening must be a wall or a port)`);
        if (!(inflow > 0)) errors.push(`state ${st}: no inflow through the openings`);
        else if (Math.abs(inflow - outflow) > 0.01 * inflow) {
          errors.push(`state ${st}: openings don't balance: ${inflow.toFixed(4)} m³/s in, ${outflow.toFixed(4)} m³/s out`);
        }
      });
    }
    for (const st of meta.stages ?? []) {
      if (!(st.x > meta.lo[0] && st.x < meta.lo[0] + nx * meta.h)) errors.push(`stage ${st.id} at x=${st.x} is outside the field`);
    }
    const pos = meta.states.map((s) => s.pos);
    if (pos.some((p, k) => k && p <= pos[k - 1])) errors.push('state positions must increase');
    for (const [id, box] of Object.entries(meta.emit ?? {})) {
      for (let a = 0; a < 3; a++) {
        const lo = meta.lo[a], hi = meta.lo[a] + meta.n[a] * meta.h;
        if (box.lo[a] < lo || box.hi[a] > hi) errors.push(`emit box ${id} leaves the field on axis ${a}`);
      }
    }
    console.log(`  flow: ${meta.n.join('×')} @ ${meta.h} m, ${meta.states.length} states (${pos.join(', ')}), ${raw.length} B on disk`);
  }
  if (errors.length) {
    console.error('  flow FAIL\n   ' + errors.join('\n   '));
    return 1;
  }
  console.log('  flow PASS');
  return 0;
}

const MODES = {
  async meshopt(doc) {
    await doc.transform(dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  },
  async 'quantize-safe'(doc) {
    await doc.transform(
      dedup(),
      reorder({ encoder: MeshoptEncoder, target: 'size' }),
      quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/, quantizeNormal: 8 }),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  },
  async filter(doc) {
    await doc.transform(dedup(), reorder({ encoder: MeshoptEncoder, target: 'size' }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  },
};

async function compress(args) {
  const m = moduleArg(args);
  const modeIdx = args.indexOf('--mode');
  if (modeIdx >= 0 && !MODES[args[modeIdx + 1]]) {
    console.error(`--mode needs one of ${Object.keys(MODES).join(', ')}`);
    return 2;
  }
  const candidates = modeIdx >= 0 ? [args[modeIdx + 1]] : ['meshopt', 'quantize-safe', 'filter'];
  const src = rawPath(m);
  if (!fs.existsSync(src)) {
    console.error(`missing ${path.relative(ROOT, src)} (run assets:build first)`);
    return 1;
  }
  const io = await makeIO();
  const ref = await io.read(src);
  const rawBytes = fs.statSync(src).size;
  const results = [];
  for (const mode of candidates) {
    if (!MODES[mode]) throw new Error(`unknown mode ${mode}`);
    const doc = await io.read(src);
    await MODES[mode](doc);
    const bin = await io.writeBinary(doc);
    const back = await io.readBinary(bin);
    const cmp = compareDocuments(ref, back);
    results.push({ mode, bytes: bin.byteLength, ok: cmp.errors.length === 0, errors: cmp.errors, bin });
  }
  console.log(`compress ${path.relative(ROOT, src)} (${rawBytes} B)`);
  for (const r of results) {
    console.log(`  ${r.mode.padEnd(14)} ${String(r.bytes).padStart(8)} B  ${r.ok ? 'node TRS preserved' : `REJECTED: ${r.errors.length} node changes, e.g. ${r.errors[0]}`}`);
  }
  const ok = results.filter((r) => r.ok).sort((a, b) => a.bytes - b.bytes);
  if (!ok.length) {
    console.error('no compression mode preserved node transforms');
    return 1;
  }
  const best = ok[0];
  const dst = outPath(m);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, best.bin);
  console.log(`  -> ${path.relative(ROOT, dst)} (${best.bytes} B, mode "${best.mode}", ${(100 * best.bytes / rawBytes).toFixed(1)}% of raw)`);
  return 0;
}

function validate(args) {
  const m = moduleArg(args);
  const cfg = MODULES[m];
  if (!cfg) {
    console.error(`no validation table entry for module ${m}`);
    return 1;
  }
  const raw = args.includes('--raw');
  const file = raw ? rawPath(m) : outPath(m);
  const argv = [path.join(ROOT, 'scripts', 'validate-glb.mjs'), file,
    '--drives', cfg.drives.join(','), '--require-drives', cfg.drives.join(','),
    '--require', cfg.require.join(','), '--max-tris', String(cfg.maxTris)];
  // the byte budget is for the compressed GLB; the raw export is expected to be larger
  if (!raw) argv.push('--max-bytes', String(cfg.maxBytes));
  if (!raw && fs.existsSync(rawPath(m))) argv.push('--compare', rawPath(m));
  const r = spawnSync(process.execPath, argv, { stdio: 'inherit', cwd: ROOT });
  if (r.error) console.error(`could not run the GLB validator: ${r.error.message}`);
  const glb = r.status ?? 1;
  const field = validateFlow(m); // always checked, whatever the GLB result
  return glb || field;
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { build, compress, validate, flow };
if (!commands[cmd]) {
  console.error('usage: node scripts/assets.mjs <build|compress|validate|flow> [module] [--mode m] [--raw]');
  process.exit(2);
}
Promise.resolve(commands[cmd](rest)).then((code) => process.exit(code ?? 0), (err) => {
  console.error(err);
  process.exit(1);
});
