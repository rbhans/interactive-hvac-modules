import type { ComponentType } from "react";

/**
 * The module contract. A module is a pure model, a GLB, and declarative wiring;
 * the shell does everything else.
 */

export type PointStatus = "ok" | "fault" | "overridden" | "alarm";
export type Outputs = Record<string, number>;

export interface LabModel<I, S, O extends Outputs> {
  init(inputs: I, seed?: Partial<S>): S;
  /** Pure: (state, inputs, dt seconds) → next state */
  step(state: S, inputs: I, dt: number): S;
  outputs(state: S, inputs: I): O;
}

// ── bindings.ts ─────────────────────────────────────────────────────────────

export interface FlowBinding<O> {
  /** 0–1 share of the stream's particles that are alive */
  rate: (o: O) => number;
  /** Air/water temperature in °F — colored on the shared heat ramp */
  tempF: (o: O) => number;
  /** Particle style */
  medium?: "air" | "water";
  /**
   * Water with `Bindings.liquid`: the radius of the liquid core drawn along the path, m. Keep it inside
   * the bare pipe's bore, so the core hides wherever the pipe isn't see-through (valves, fittings).
   */
  radius?: number;
  /**
   * Keep this air stream when the module has a solved `field`: for air the field doesn't cover
   * (a supply main running past, air mixing in a room). Other air streams are only the field's fallback.
   */
  withField?: boolean;
  /** Only draw the stream while this returns true (its pipe hidden otherwise, see `Bindings.visibility`) */
  visible?: (o: O) => boolean;
}

/**
 * A baked airflow field (see blender/sims). Particles are advected through the solved
 * velocity field instead of riding authored paths.
 */
export interface FieldBinding<O> {
  url: string;
  /** 0–1 position the baked states are indexed by (e.g. physical damper position) */
  position: (o: O) => number;
  /** Relative emission rate for each emit box in the field file (1 = full airflow) */
  emit: Record<string, (o: O) => number>;
  /** Temperature of air entering at each emit box, °F */
  tempF: Record<string, (o: O) => number>;
  /**
   * Temperature after each stage plane in the field file (`stages: [{ id, x }]`), °F.
   * Air takes on each stage's temperature as it crosses it: a mixing plane, a coil, and so on.
   */
  stages: Record<string, (o: O) => number>;
  /**
   * Scale on the baked velocities, 1 = the airflow the field was solved at. For equipment whose airflow
   * varies a lot (a VAV box runs 15–100 %), so the air visibly speeds up and slows down.
   */
  speed?: (o: O) => number;
}

export interface Highlight<O> {
  /** Node names or prefixes (`oa_blade_` matches `oa_blade_01…`) */
  parts: string[];
  when: (o: O) => "fault" | "overridden" | null;
}

export interface Callout<O> {
  anchor: string;
  /** Nudge from the anchor, Blender coords (m): to pull apart callouts whose anchors line up on screen */
  offset?: [number, number, number];
  label: string;
  value: (o: O) => string;
  tone?: (o: O) => "neutral" | "cold" | "warm" | "fault" | "overridden";
  /** Show a hand icon when this returns true */
  hand?: (o: O) => boolean;
  /** Only show while this returns true */
  when?: (o: O) => boolean;
}

/** Recolor parts by a temperature on the shared heat ramp (pipes, coil fins). */
export interface Tint<O> {
  /** Node names or prefixes */
  parts: string[];
  tempF: (o: O) => number;
  /** 0–1 blend from the part's own color toward the heat color; a function lets it follow the model */
  amount?: number | ((o: O) => number);
  /** Only tint while this returns true; otherwise the part keeps its own color */
  when?: (o: O) => boolean;
}

/** Condensate dripping off a coil into a pan. */
export interface Condensate<O> {
  /** Two empties marking the drip edge */
  from: [string, string];
  /** Empty at the water surface in the pan */
  to: string;
  /** 0–1 */
  rate: (o: O) => number;
}

/** An axis-aligned box in Blender coordinates (Z up), the space the airflow field is solved in. */
export interface RideBox {
  lo: [number, number, number];
  hi: [number, number, number];
}

/**
 * "Be the air": a first-person trip along a path traced through the solved airflow field.
 * Needs `field`. Zones and exits are boxes in Blender coordinates; the first match wins.
 */
export interface RideBinding<O> {
  /** Where a trip can begin: an emit box in the field file, and the stream temperature it carries */
  starts: { id: string; label: string; emit: string; hint?: string }[];
  /** Where you are along the way */
  zones: (RideBox & { label: string; note?: (o: O) => string })[];
  /** How the trip ends, tested against the last point of the path */
  exits: (RideBox & { label: string; note: (o: O) => string })[];
}

export interface Bindings<I, O> {
  /** First-person trip through the airflow field */
  ride?: RideBinding<O>;
  /**
   * Water drawn as liquid inside its pipes: these node names or prefixes (the pipes' insulation jackets)
   * turn see-through in the cutaway view, and every `medium: "water"` stream becomes a flowing liquid
   * core along its path instead of streaks.
   */
  liquid?: { pipes: string[] };
  /** Parts shown only while `when` returns true: equipment that comes and goes with a setting */
  visibility?: { parts: string[]; when: (o: O) => boolean }[];
  /**
   * Node names or prefixes that receive the key light's shadows but don't cast them: a room's walls,
   * floor and ceiling, which would otherwise throw the whole room into the "sun's" shadow.
   */
  noCastShadow?: string[];
  /** Normalizers for GLB `drives` names → 0–1. Missing entries read `outputs[drives]` directly. */
  drives?: Partial<Record<string, (o: O) => number>>;
  /** Flow stream id (`flow_<id>_NN` in the GLB) → rate + temperature. The fallback when there's no `field`. */
  flows: Record<string, FlowBinding<O>>;
  /** Solved airflow field; when present it replaces the path-following air streams (water streams still run) */
  field?: FieldBinding<O>;
  tints?: Tint<O>[];
  condensate?: Condensate<O>;
  highlights?: Highlight<O>[];
  callouts?: Callout<O>[];
  /**
   * Optional per-node range override, e.g. to re-sign blades for a parallel-blade variant.
   * `lookup` returns another node's authored range.
   */
  range?: (
    node: string,
    authored: [number, number],
    inputs: I,
    lookup: (name: string) => [number, number] | undefined,
  ) => [number, number];
  /** Temperatures shown as markers on the heat legend */
  legend?: (o: O) => { label: string; tempF: number }[];
  /** Status chips pinned to the display */
  status?: (o: O) => { label: string; state: PointStatus | "off" }[];
  /** One-sentence description of the scene for screen readers */
  describe?: (o: O) => string;
}

// ── controls.ts ─────────────────────────────────────────────────────────────

interface Base {
  id: string;
  label: string;
  hint?: string;
  /** Only show while this returns true (e.g. controls that belong to one mode) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  when?: (inputs: any, outputs: any) => boolean;
}

export interface SliderControl<I, O> extends Base {
  kind: "slider";
  unit: string;
  min: number;
  max: number;
  step: number;
  get: (i: I) => number;
  set: (i: I, v: number) => I;
  /** Small markers drawn on the scale (e.g. setpoint, high limit) */
  marks?: (i: I, o: O) => { label: string; value: number }[];
}

export interface SetpointControl<I> extends Base {
  kind: "setpoint";
  point: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  get: (i: I) => number;
  set: (i: I, v: number) => I;
}

export interface KnobControl<I> extends Base {
  kind: "knob";
  unit: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  color?: "orange" | "blue" | "green" | "white";
  /** Values past this read as "too hot" on the knob's arc */
  warnAbove?: number;
  get: (i: I) => number;
  set: (i: I, v: number) => I;
}

export interface SegmentedControl<I> extends Base {
  kind: "segmented";
  options: { value: string; label: string }[];
  get: (i: I) => string;
  set: (i: I, v: string) => I;
}

export interface OverrideControl<I, O> extends Base {
  kind: "override";
  point: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  get: (i: I) => { mode: "auto" | "manual"; value: number };
  set: (i: I, v: { mode: "auto" | "manual"; value: number }) => I;
  /** The value the program is writing at its own priority */
  programValue: (o: O) => number;
  programPriority: number;
  activePriority: (o: O) => number;
  /** Other occupied priority slots (e.g. a safety at 5); NaN or null means empty */
  otherSlots?: (o: O) => Record<number, number | null>;
}

export interface ReadoutControl<O> extends Base {
  kind: "readout";
  point: string;
  unit: string;
  digits?: number;
  value: (o: O) => number;
  status?: (o: O) => PointStatus;
  /** Physical truth the BAS can't see — rendered on the "reality" layer */
  reality?: boolean;
  /** Command vs feedback pair */
  pair?: { label: string; value: (o: O) => number };
}

export interface TrendPen<O> {
  id: string;
  label: string;
  unit: string;
  axis: "temp" | "pct";
  color: string;
  dashed?: boolean;
  value: (o: O) => number;
}

/** The trend's left axis, for pens on `axis: "temp"`; defaults to °F */
export interface TrendAxis {
  /** Unit after each tick label (° for temperature; often blank) */
  tick: string;
  /** Tick spacing, smallest span shown, decimals in the legend */
  step: number;
  minSpan: number;
  digits: number;
  /** Never range below this (0 for a pressure) */
  floor?: number;
}

export interface TrendControl<O> extends Base {
  kind: "trend";
  /** Rolling window, seconds of sim time */
  window: number;
  pens: TrendPen<O>[];
  left?: TrendAxis;
}

export interface FaultToggle<I> {
  kind: "toggle";
  id: string;
  label: string;
  hint: string;
  get: (i: I) => boolean;
  /** `capture` is the current live value the fault should freeze at (e.g. blade position) */
  set: (i: I, on: boolean, capture: number) => I;
  capture?: string;
}

export interface FaultSlider<I> {
  kind: "slider";
  id: string;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  get: (i: I) => number;
  set: (i: I, v: number) => I;
}

export interface FaultsControl<I> extends Base {
  kind: "faults";
  items: (FaultToggle<I> | FaultSlider<I>)[];
  active: (i: I) => number;
}

export interface CustomControl<I, O> extends Base {
  kind: "custom";
  Component: ComponentType<{ inputs: I; outputs: O; setInputs: (fn: (i: I) => I) => void }>;
}

export type Control<I, O> =
  | SliderControl<I, O>
  | SetpointControl<I>
  | KnobControl<I>
  | SegmentedControl<I>
  | OverrideControl<I, O>
  | ReadoutControl<O>
  | TrendControl<O>
  | FaultsControl<I>
  | CustomControl<I, O>;

export interface ControlSection<I, O> {
  id: string;
  title: string;
  /** One plain-language line under the title, for people new to HVAC */
  description?: string;
  /** Layout slot: `side` is the right-hand rack, `bench` the instrument row under the display */
  slot: "side" | "bench";
  controls: Control<I, O>[];
}

// ── presets.ts ──────────────────────────────────────────────────────────────

export interface Preset<I, S> {
  id: string;
  label: string;
  /** One-line "what to look for" shown when the preset loads */
  cue: string;
  breakIt?: boolean;
  inputs: I;
  seed?: Partial<S>;
}

// ── module ──────────────────────────────────────────────────────────────────

export interface LabModule<I, S, O extends Outputs> {
  slug: string;
  number: string;
  title: string;
  insight: string;
  /** Plain-language orientation shown under the headline */
  intro?: string;
  /** Terms the explainer can define inline with <Term id="…"> */
  glossary?: Record<string, { term: string; def: string }>;
  glb: string;
  camera: { position: [number, number, number]; target: [number, number, number]; fov?: number };
  /**
   * Extra lights, shadowless, three.js coords. For an interior scene: the office under a ceiling is
   * lit from inside, not by the key light the rest of the scene plays as the sun.
   */
  lights?: { position: [number, number, number]; intensity: number; color?: string }[];
  model: LabModel<I, S, O>;
  bindings: Bindings<I, O>;
  controls: ControlSection<I, O>[];
  presets: Preset<I, S>[];
  defaultPreset: string;
  /** Sim-time sample period for trends, s */
  samplePeriod?: number;
  Card: ComponentType;
  cardSections: { id: string; title: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLabModule = LabModule<any, any, any>;
