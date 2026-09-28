"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useRuntime, useRuntimeStore } from "../shell/runtime";
import type { FieldBinding, Outputs, RideBinding } from "../types";
import { loadAirField, type AirField } from "./airField";
import { planTrip, tripIndex, tripPoint, tripTemp, type Trip } from "./ride";

const FOV = 72;
const LOOK_AHEAD = 0.55; // m along the path
const RATE = { 1: 1, 4: 1.8, 16: 3 } as const; // the transport's speed keys also hurry the ride
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FPM = 196.85; // ft/min per m/s

/**
 * "Be the air": while a ride is on, the camera follows one traced path through the airflow field,
 * first person. Orbit controls are off for the trip and the authored view comes back after.
 */
export function RideCamera({ active }: { active: boolean }) {
  const store = useRuntimeStore();
  const ride = useRuntime((s) => s.ride);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const [plan, setPlan] = useState<{ trip: Trip; field: AirField } | null>(null);
  const play = useRef({ s: 0, v: 0, hud: 0, done: false, fresh: true });
  const tmp = useMemo(
    () => ({
      a: new Float32Array(3),
      b: new Float32Array(3),
      pos: new THREE.Vector3(),
      look: new THREE.Vector3(),
      up: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
    }),
    [],
  );

  // plan a trip whenever a ride starts (or restarts)
  const nonce = ride?.nonce;
  const startId = ride?.start;
  useEffect(() => {
    const { mod } = store.getState();
    const field = mod.bindings.field as FieldBinding<Outputs> | undefined;
    const rideB = mod.bindings.ride as RideBinding<Outputs> | undefined;
    if (!nonce || !startId || !field || !rideB) {
      setPlan(null);
      return;
    }
    let live = true;
    loadAirField(field.url)
      .then((f) => {
        if (!live) return;
        const pos = Math.min(1, Math.max(0, field.position(store.getState().outputs)));
        const trip = planTrip(f, pos, rideB, startId);
        if (!trip) return store.getState().endRide();
        play.current = { s: 0, v: 0, hud: 1, done: false, fresh: true };
        setPlan({ trip, field: f });
      })
      .catch(() => live && store.getState().endRide());
    return () => {
      live = false;
    };
  }, [nonce, startId, store]);

  // take the camera for the trip and hand it back after
  useEffect(() => {
    if (!plan) return;
    const saved = { fov: camera.fov, near: camera.near };
    if (controls) controls.enabled = false;
    camera.fov = FOV;
    camera.near = 0.01;
    camera.updateProjectionMatrix();
    invalidate();
    return () => {
      camera.fov = saved.fov;
      camera.near = saved.near;
      camera.updateProjectionMatrix();
      if (controls) controls.enabled = true;
      invalidate();
    };
  }, [plan, camera, controls, invalidate]);

  useFrame((_, delta) => {
    if (!plan) return;
    const st = store.getState();
    const { trip, field } = plan;
    const P = play.current;
    const dt = Math.min(delta, 0.05);

    // move: a scaled version of the real air speed, eased so jets through damper gaps don't jolt
    const moving = st.running && !P.done;
    if (moving) {
      const real = trip.speed[tripIndex(trip, P.s)];
      // about a third of real speed: slow enough to read each stretch, still quick through the fan
      const target = Math.min(1.3, Math.max(0.28, 0.32 * real)) * RATE[st.speed];
      P.v += (target - P.v) * (1 - Math.exp(-dt / 0.35));
      P.s = Math.min(trip.length, P.s + P.v * dt);
      if (P.s >= trip.length - 1e-3) P.done = true;
    }

    // pose: on the path, looking a little way ahead along it (three.js axes: x, z, -y)
    tripPoint(trip, P.s, tmp.a);
    tmp.pos.set(tmp.a[0], tmp.a[2], -tmp.a[1]);
    const ahead = P.s + LOOK_AHEAD;
    if (ahead <= trip.length) {
      tripPoint(trip, ahead, tmp.b);
      tmp.look.set(tmp.b[0], tmp.b[2], -tmp.b[1]);
    } else {
      // past the end: keep the last heading
      tripPoint(trip, trip.length - LOOK_AHEAD, tmp.b);
      tmp.look.set(tmp.b[0], tmp.b[2], -tmp.b[1]).sub(tmp.pos).negate().add(tmp.pos);
    }
    camera.position.copy(tmp.pos);
    if (tmp.look.distanceToSquared(tmp.pos) > 1e-8) {
      // up: the camera's own, eased back toward world up, so a vertical stretch (down through the
      // return damper) doesn't flip the view
      tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion).lerp(WORLD_UP, P.fresh ? 1 : 0.06).normalize();
      tmp.m.lookAt(tmp.pos, tmp.look, tmp.up);
      tmp.q.setFromRotationMatrix(tmp.m);
      if (P.fresh) camera.quaternion.copy(tmp.q);
      else camera.quaternion.slerp(tmp.q, 1 - Math.exp(-dt / 0.22));
    }
    P.fresh = false;

    // the readout, a few times a second
    P.hud += dt;
    if (P.hud > 0.12 || (P.done && !st.rideHud?.done)) {
      P.hud = 0;
      const mod = st.mod;
      const rideB = mod.bindings.ride as RideBinding<Outputs>;
      const fieldB = mod.bindings.field as FieldBinding<Outputs>;
      const o = st.outputs;
      const start = rideB.starts.find((x) => x.id === st.ride?.start) ?? rideB.starts[0];
      const i = tripIndex(trip, P.s);
      const zone = trip.zone[i] >= 0 ? rideB.zones[trip.zone[i]] : null;
      const source = fieldB.tempF[start.emit]?.(o) ?? 70;
      const tempF = tripTemp(trip, P.s, source, (k) => fieldB.stages[field.stages[k].id]?.(o) ?? source);
      const exit = trip.exit >= 0 ? rideB.exits[trip.exit] : null;
      st.setRideHud({
        start: start.label,
        zone: zone?.label ?? start.label,
        note: zone?.note?.(o) ?? "",
        tempF,
        fpm: trip.speed[i] * FPM,
        progress: trip.length > 0 ? P.s / trip.length : 1,
        done: P.done
          ? exit
            ? { label: exit.label, note: exit.note(o) }
            : { label: "Caught in an eddy", note: "Some air circles in a dead spot for a while before it moves on. Ride again for a different path." }
          : null,
      });
    }
    // keep frames coming while the trip moves or the view is still turning
    if (active && (moving || 1 - Math.abs(camera.quaternion.dot(tmp.q)) > 1e-6)) invalidate();
  });

  return null;
}
