/**
 * One temperature → color scale shared by every module, air and water alike.
 * Stops are in °F. The ramp is interpolated in OKLab so it stays even to the eye,
 * and every stop is bright enough to read on the dark display.
 */

const STOPS: [number, string][] = [
  [-10, "#5b3cff"],
  [25, "#2f62ff"],
  [45, "#27b7ff"],
  [60, "#bfe9f2"],
  [70, "#f3eee4"],
  [78, "#ffd59a"],
  [88, "#ff8a2a"],
  [100, "#ff3d1f"],
  [140, "#e2104f"],
  [200, "#b5007d"],
];

type Lab = [number, number, number];

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function linearToOklab([r, g, b]: [number, number, number]): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const LAB_STOPS = STOPS.map(([t, hex]) => [t, linearToOklab(hexToRgb(hex).map(toLinear) as [number, number, number])] as const);

export const HEAT_MIN = STOPS[0][0];
export const HEAT_MAX = STOPS[STOPS.length - 1][0];

/** Linear-RGB triple (0–1) — for three.js colors, which work in linear space. */
export function heatLinear(tempF: number): [number, number, number] {
  const t = Math.min(HEAT_MAX, Math.max(HEAT_MIN, tempF));
  let i = 0;
  while (i < LAB_STOPS.length - 2 && t > LAB_STOPS[i + 1][0]) i++;
  const [t0, c0] = LAB_STOPS[i];
  const [t1, c1] = LAB_STOPS[i + 1];
  const k = (t - t0) / (t1 - t0);
  const lab: Lab = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
  return oklabToLinear(lab).map((c) => Math.min(1, Math.max(0, c))) as [number, number, number];
}

/** CSS color string for the same temperature, optionally with alpha. */
export function heatCss(tempF: number, alpha = 1): string {
  const [r, g, b] = heatLinear(tempF).map((c) => Math.round(toSrgb(c) * 255));
  return alpha < 1 ? `rgb(${r} ${g} ${b} / ${alpha})` : `rgb(${r} ${g} ${b})`;
}

/** CSS gradient covering [lo, hi] °F, for legends. */
export function heatGradient(lo: number, hi: number, steps = 16): string {
  const parts: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = lo + ((hi - lo) * k) / steps;
    parts.push(`${heatCss(t)} ${((k / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
