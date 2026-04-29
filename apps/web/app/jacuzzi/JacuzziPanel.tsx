"use client";

/**
 * Jacuzzi control panel — drop-in replacement for apps/web/app/jacuzzi/page.tsx
 *
 * Self-contained: Tailwind only, no extra UI libs, no framer-motion.
 * Default export = <Page /> (the harness with local state + console-logged callbacks).
 * Named export = <JacuzziPanel /> (the controlled component to wire to your real endpoints).
 *
 * Wiring to your existing API:
 *   onToggle(fn, on)        ->  POST /api/jacuzzi/toggle    { fn, on }
 *   onSetPresetTemp(temp)   ->  POST /api/jacuzzi/preset-temp { temp }
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JacuzziFn =
  | "power"
  | "heater"
  | "filter"
  | "jets"
  | "bubbles"
  | "sanitizer";

export interface JacuzziPanelProps {
  power: boolean;
  heaterOn: boolean;
  filterOn: boolean;
  jetsOn: boolean;
  bubblesOn: boolean;
  sanitizerOn: boolean;
  currentTempC: number; // 15-40
  presetTempC: number;  // 15-40
  reachable: boolean;
  errorCode: string | null;
  onToggle: (fn: JacuzziFn, on: boolean) => void;
  onSetPresetTemp: (temp: number) => void;
  /** "iso" | "top" | "three-quarter" — defaults to "iso" */
  view?: "iso" | "top" | "three-quarter";
  /** IP/host du module Wi-Fi (ex. "192.168.0.69"). */
  host?: string | null;
  /** Nom de la prise Tuya en amont (ex. "Prise Jacuzzi"). */
  plugName?: string | null;
  /** Puissance instantanee mesuree par la prise Tuya (W). */
  plugPowerW?: number | null;
  /** ISO timestamp de la derniere lecture de la prise Tuya. */
  plugTs?: string | null;
}

interface TubState {
  power: boolean;
  heaterOn: boolean;
  filterOn: boolean;
  jetsOn: boolean;
  bubblesOn: boolean;
  sanitizerOn: boolean;
  currentTempC: number;
  presetTempC: number;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const TEMP_MIN = 15;
const TEMP_MAX = 40;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function waterColor(t: number) {
  const k = clamp01((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
  const L = 0.72 + (0.74 - 0.72) * k;
  const C = 0.18 + 0.02 * k;
  const H = 230 + (50 - 230) * k;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

function waterGlow(t: number) {
  const k = clamp01((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
  const H = 230 + (50 - 230) * k;
  return `oklch(0.78 0.22 ${H.toFixed(1)})`;
}

function hueForTemp(t: number) {
  const k = clamp01((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
  return 230 + (50 - 230) * k;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const Icons = {
  power: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </svg>
  ),
  heater: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2s1.5 2 1.5 4S8 10 8 12s1.5 4 1.5 4" />
      <path d="M14 2s1.5 2 1.5 4S14 10 14 12s1.5 4 1.5 4" />
      <path d="M5 18h14" />
      <path d="M7 22h10" />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M5 7c2.5-2 5-2 7 0s4.5 2 7 0" />
      <path d="M5 12c2.5-2 5-2 7 0s4.5 2 7 0" />
      <path d="M5 17c2.5-2 5-2 7 0s4.5 2 7 0" />
    </svg>
  ),
  jets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h6" />
      <path d="M9 8l4 4-4 4" />
      <path d="M14 6c2 1 4 3 4 6s-2 5-4 6" />
      <path d="M18 4c3 1 5 4 5 8s-2 7-5 8" />
    </svg>
  ),
  bubbles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="14" r="4" />
      <circle cx="16" cy="9" r="3" />
      <circle cx="13" cy="17" r="2" />
    </svg>
  ),
  sanitizer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L4 7v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7l-8-5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  spinner: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
    </svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.41 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  ),
} as const;

// ---------------------------------------------------------------------------
// Inline keyframes (one-shot stylesheet so the .tsx is self-contained)
// ---------------------------------------------------------------------------

const KEYFRAMES = `
@keyframes jcz-spin { to { transform: rotate(360deg); } }
@keyframes jcz-led-pulse { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }
@keyframes jcz-btn-pulse { 0%,100% { opacity: .6; } 50% { opacity: 1; } }
@keyframes jcz-heat-pulse { 0%,100% { opacity: .7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }
@keyframes jcz-uv-blink { 0%,100% { opacity: .5; } 45% { opacity: 1; } 50% { opacity: .3; } 55% { opacity: 1; } }
@keyframes jcz-uv-halo { 0%,100% { opacity: .3; transform: scale(.95); } 50% { opacity: .7; transform: scale(1.1); } }
@keyframes jcz-swirl { to { transform: rotate(360deg); } }
@keyframes jcz-wave-drift { to { transform: translateX(-40px); } }
@keyframes jcz-jet-l { 0%,100% { opacity: .3; transform: translateX(-4px); } 50% { opacity: 1; transform: translateX(0); } }
@keyframes jcz-jet-r { 0%,100% { opacity: .3; transform: translateX(4px); } 50% { opacity: 1; transform: translateX(0); } }
@keyframes jcz-ripple { 0% { r: 20; opacity: .4; } 100% { r: 100; opacity: 0; } }
`;

function useKeyframes() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("jacuzzi-keyframes")) return;
    const style = document.createElement("style");
    style.id = "jacuzzi-keyframes";
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
  }, []);
}

// ---------------------------------------------------------------------------
// Tub schematic (iso / top / three-quarter)
// ---------------------------------------------------------------------------

function IsoTub({ state }: { state: TubState }) {
  const { power, heaterOn, filterOn, jetsOn, bubblesOn, sanitizerOn, currentTempC, presetTempC } = state;
  const water = waterColor(currentTempC);
  const glow = waterGlow(currentTempC);
  const cx = 250, cy = 210, rx = 150, ry = 75;

  const bubbles = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({
      id: i,
      x: cx + (Math.random() - 0.5) * rx * 1.3,
      delay: (i * 0.4) % 3.2,
      dur: 2.2 + Math.random() * 1.6,
      r: 2 + Math.random() * 3,
    })),
    []
  );

  return (
    <svg viewBox="0 0 500 380" className="w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <pattern id="jcz-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="oklch(0.7 0.15 200 / 0.06)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="jcz-water" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={water} stopOpacity="0.95" />
          <stop offset="100%" stopColor={water} stopOpacity="0.7" />
        </radialGradient>
        <linearGradient id="jcz-tub-side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.34 0.02 250)" />
          <stop offset="100%" stopColor="oklch(0.20 0.02 250)" />
        </linearGradient>
        <linearGradient id="jcz-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.45 0.02 250)" />
          <stop offset="100%" stopColor="oklch(0.30 0.02 250)" />
        </linearGradient>
        <radialGradient id="jcz-swirl">
          <stop offset="0%" stopColor="oklch(0.85 0.15 200)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.85 0.15 200)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="jcz-heat">
          <stop offset="0%" stopColor="oklch(0.78 0.20 50)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="oklch(0.78 0.20 50)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="jcz-uv">
          <stop offset="0%" stopColor="oklch(0.75 0.22 305)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.75 0.22 305)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="jcz-water-clip">
          <ellipse cx={cx} cy={cy} rx={rx - 18} ry={ry - 9} />
        </clipPath>
        <pattern id="jcz-waves" x="0" y="0" width="40" height="8" patternUnits="userSpaceOnUse">
          <path d="M 0 4 Q 10 0, 20 4 T 40 4" fill="none" stroke="oklch(1 0 0 / 0.18)" strokeWidth="0.8" />
        </pattern>
        <filter id="jcz-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <rect x="0" y="0" width="500" height="380" fill="url(#jcz-grid)" />
      <ellipse cx={cx} cy={cy + 95} rx={rx + 10} ry={ry * 0.35} fill="oklch(0 0 0 / 0.5)" filter="url(#jcz-soft)" />

      {power && heaterOn && (
        <ellipse cx={cx} cy={cy + 30} rx={rx + 30} ry={ry + 15} fill="url(#jcz-heat)" style={{ animation: "jcz-heat-pulse 2.4s ease-in-out infinite", transformOrigin: `${cx}px ${cy + 30}px` }} />
      )}

      <path
        d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy} L ${cx + rx} ${cy + 80} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy + 80} Z`}
        fill="url(#jcz-tub-side)"
        stroke="oklch(0.5 0.02 250 / 0.5)"
        strokeWidth="0.8"
      />
      {[0, 1, 2].map((i) => (
        <ellipse key={i} cx={cx} cy={cy + 14 + i * 22} rx={rx} ry={ry} fill="none" stroke="oklch(0.5 0.02 250 / 0.35)" strokeWidth="1" />
      ))}
      {[0, 1, 2].map((i) => (
        <ellipse key={`s${i}`} cx={cx} cy={cy + 22 + i * 22} rx={rx} ry={ry} fill="none" stroke="oklch(0.12 0.02 250 / 0.6)" strokeWidth="2" />
      ))}

      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#jcz-rim)" stroke="oklch(0.55 0.02 250 / 0.6)" strokeWidth="1" />
      <ellipse cx={cx} cy={cy - 4} rx={rx - 6} ry={ry - 3} fill="url(#jcz-rim)" opacity="0.6" />

      <g clipPath="url(#jcz-water-clip)">
        <ellipse cx={cx} cy={cy} rx={rx - 18} ry={ry - 9} fill="url(#jcz-water)" />
        <ellipse cx={cx - 30} cy={cy - 12} rx={50} ry={14} fill="oklch(1 0 0 / 0.1)" />
        {power && (
          <g style={{ animation: "jcz-wave-drift 6s linear infinite" }}>
            <rect x={cx - rx} y={cy - ry} width={rx * 2 + 40} height={ry * 2} fill="url(#jcz-waves)" opacity="0.5" />
          </g>
        )}
        {power && bubblesOn && bubbles.map((b) => (
          <circle key={b.id} cx={b.x} cy={cy + ry - 6} r={b.r} fill="oklch(1 0 0 / 0.7)">
            <animate attributeName="cy" from={cy + ry - 6} to={cy - ry + 4} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.1;0.85;1" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>
      <ellipse cx={cx} cy={cy} rx={rx - 18} ry={ry - 9} fill="none" stroke="oklch(0.1 0.02 250 / 0.7)" strokeWidth="1.5" />

      {power && jetsOn && (
        <g>
          <g style={{ animation: "jcz-jet-l 1.4s ease-out infinite" }}>
            <path d={`M ${cx - rx + 14} ${cy + 2} l 16 -3 l -3 3 l 3 3 z`} fill="oklch(0.85 0.15 230)" />
            <circle cx={cx - rx + 12} cy={cy + 2} r="2.5" fill="oklch(0.6 0.12 230)" />
          </g>
          <g style={{ animation: "jcz-jet-r 1.4s ease-out infinite", animationDelay: "0.7s" }}>
            <path d={`M ${cx + rx - 14} ${cy + 2} l -16 -3 l 3 3 l -3 3 z`} fill="oklch(0.85 0.15 230)" />
            <circle cx={cx + rx - 12} cy={cy + 2} r="2.5" fill="oklch(0.6 0.12 230)" />
          </g>
        </g>
      )}

      {/* Filter cartridge */}
      <g transform={`translate(${cx + rx + 8}, ${cy - 8})`}>
        <rect x="0" y="0" width="36" height="62" rx="6" fill="oklch(0.24 0.02 250)" stroke="oklch(0.4 0.02 250)" strokeWidth="1" />
        <rect x="3" y="6" width="30" height="50" rx="3" fill="oklch(0.16 0.02 250)" />
        {power && filterOn ? (
          <g transform="translate(18, 31)">
            <g style={{ animation: "jcz-swirl 1.6s linear infinite", transformOrigin: "0 0" }}>
              <circle r="12" fill="url(#jcz-swirl)" />
              <path d="M -10 0 A 10 10 0 0 1 10 0" fill="none" stroke="oklch(0.85 0.15 200)" strokeWidth="2" strokeLinecap="round" />
              <path d="M -6 0 A 6 6 0 0 0 6 0" fill="none" stroke="oklch(0.9 0.15 200)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            </g>
          </g>
        ) : (
          <g transform="translate(18, 31)">
            <circle r="10" fill="none" stroke="oklch(0.4 0.02 250)" strokeWidth="1.2" strokeDasharray="3 3" />
          </g>
        )}
      </g>

      {/* Sanitizer UV lamp */}
      <g transform={`translate(${cx - rx - 32}, ${cy - 14})`}>
        <rect x="0" y="0" width="22" height="40" rx="4" fill="oklch(0.24 0.02 250)" stroke="oklch(0.4 0.02 250)" />
        <rect x="4" y="6" width="14" height="28" rx="2" fill={power && sanitizerOn ? "oklch(0.4 0.18 305)" : "oklch(0.18 0.02 250)"} />
        {power && sanitizerOn && (
          <>
            <rect x="4" y="6" width="14" height="28" rx="2" fill="url(#jcz-uv)" style={{ animation: "jcz-uv-blink 1.6s ease-in-out infinite" }} />
            <circle cx="11" cy="20" r="22" fill="oklch(0.7 0.22 305 / 0.18)" style={{ animation: "jcz-uv-halo 1.6s ease-in-out infinite", transformOrigin: "11px 20px" }} />
          </>
        )}
      </g>

      {/* Power LED */}
      <g transform="translate(60, 50)">
        <rect x="0" y="0" width="86" height="26" rx="6" fill="oklch(0.18 0.02 250)" stroke="oklch(0.32 0.02 250)" />
        <circle cx="14" cy="13" r="5" fill={power ? "oklch(0.78 0.22 145)" : "oklch(0.4 0.02 250)"} />
        {power && <circle cx="14" cy="13" r="9" fill="oklch(0.78 0.22 145 / 0.4)" style={{ animation: "jcz-led-pulse 2s ease-in-out infinite", transformOrigin: "14px 13px" }} />}
        <text x="28" y="17" fontSize="9" fill="oklch(0.78 0.05 145)" fontFamily="ui-monospace,monospace" letterSpacing="1.5">
          PWR {power ? "ON" : "OFF"}
        </text>
      </g>

      {/* Center temperature readout */}
      <g transform={`translate(${cx}, ${cy + 4})`}>
        <rect x="-58" y="-22" width="116" height="44" rx="10" fill="oklch(0.10 0.02 250 / 0.85)" stroke={glow} strokeOpacity="0.6" strokeWidth="1" />
        <text x="0" y="-4" textAnchor="middle" fontSize="9" fill="oklch(0.7 0.05 250)" fontFamily="ui-monospace,monospace" letterSpacing="2">CURRENT</text>
        <text x="0" y="14" textAnchor="middle" fontSize="20" fill="oklch(0.98 0.02 250)" fontFamily="ui-monospace,monospace" fontWeight="600">
          {currentTempC.toFixed(1)}°
        </text>
      </g>
      <g transform={`translate(${cx}, ${cy - ry - 14})`}>
        <text x="0" y="0" textAnchor="middle" fontSize="8" fill="oklch(0.6 0.05 250)" fontFamily="ui-monospace,monospace" letterSpacing="2">SET {presetTempC}°C</text>
      </g>

      {!power && <rect x="0" y="0" width="500" height="380" fill="oklch(0.12 0.02 250 / 0.55)" pointerEvents="none" />}
    </svg>
  );
}

function TopTub({ state }: { state: TubState }) {
  const { power, heaterOn, filterOn, jetsOn, bubblesOn, sanitizerOn, currentTempC, presetTempC } = state;
  const water = waterColor(currentTempC);
  const cx = 250, cy = 200, R = 130, r = 105;

  const bubbles = useMemo(() =>
    Array.from({ length: 16 }, (_, i) => ({
      id: i,
      angle: (i / 16) * Math.PI * 2,
      dist: 30 + Math.random() * 60,
      delay: (i * 0.25) % 3,
      dur: 1.8 + Math.random() * 1.2,
      r: 2 + Math.random() * 3,
    })), []);

  return (
    <svg viewBox="0 0 500 380" className="w-full h-full">
      <defs>
        <pattern id="jcz-grid2" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="oklch(0.7 0.15 200 / 0.06)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="jcz-water2" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={water} stopOpacity="1" />
          <stop offset="100%" stopColor={water} stopOpacity="0.75" />
        </radialGradient>
        <radialGradient id="jcz-heat2">
          <stop offset="0%" stopColor="oklch(0.78 0.20 50)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="oklch(0.78 0.20 50)" stopOpacity="0" />
        </radialGradient>
        <marker id="jcz-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="oklch(0.85 0.15 230)" />
        </marker>
      </defs>

      <rect width="500" height="380" fill="url(#jcz-grid2)" />
      {power && heaterOn && (
        <circle cx={cx} cy={cy} r={R + 30} fill="url(#jcz-heat2)" style={{ animation: "jcz-heat-pulse 2.4s ease-in-out infinite", transformOrigin: `${cx}px ${cy}px` }} />
      )}
      <circle cx={cx} cy={cy} r={R} fill="oklch(0.32 0.02 250)" stroke="oklch(0.5 0.02 250 / 0.5)" />
      {Array.from({ length: 18 }).map((_, i) => {
        const a = (i / 18) * Math.PI * 2;
        return (
          <line key={i}
            x1={cx + Math.cos(a) * (r + 4)} y1={cy + Math.sin(a) * (r + 4)}
            x2={cx + Math.cos(a) * (R - 4)} y2={cy + Math.sin(a) * (R - 4)}
            stroke="oklch(0.4 0.02 250 / 0.6)" strokeWidth="1" />
        );
      })}
      <circle cx={cx} cy={cy} r={r} fill="url(#jcz-water2)" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="oklch(0.1 0.02 250 / 0.6)" strokeWidth="2" />

      {power && [0, 1, 2].map((i) => (
        <circle key={i} cx={cx} cy={cy} r={20} fill="none" stroke="oklch(1 0 0 / 0.25)" strokeWidth="1"
          style={{ animation: `jcz-ripple 4s ease-out ${i * 1.3}s infinite` }} />
      ))}

      {power && bubblesOn && bubbles.map((b) => {
        const x = cx + Math.cos(b.angle) * b.dist;
        const y = cy + Math.sin(b.angle) * b.dist;
        return (
          <circle key={b.id} cx={x} cy={y} r={b.r} fill="oklch(1 0 0 / 0.7)">
            <animate attributeName="r" values={`${b.r * 0.4};${b.r * 1.2};${b.r * 0.4}`} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;0" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
          </circle>
        );
      })}

      {power && jetsOn && [0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x1 = cx + Math.cos(a) * (r - 6);
        const y1 = cy + Math.sin(a) * (r - 6);
        const x2 = cx + Math.cos(a) * (r - 30);
        const y2 = cy + Math.sin(a) * (r - 30);
        return (
          <g key={i} style={{ animation: "jcz-jet-l 1.4s ease-out infinite", animationDelay: `${i * 0.2}s` }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="oklch(0.85 0.15 230)" strokeWidth="3" strokeLinecap="round" markerEnd="url(#jcz-arrow)" />
          </g>
        );
      })}

      <g transform={`translate(${cx + R - 6}, ${cy - 18})`}>
        <rect x="0" y="0" width="40" height="36" rx="4" fill="oklch(0.24 0.02 250)" stroke="oklch(0.4 0.02 250)" />
        {power && filterOn ? (
          <g transform="translate(20, 18)" style={{ animation: "jcz-swirl 1.6s linear infinite", transformOrigin: "0 0" }}>
            <path d="M -12 0 A 12 12 0 0 1 12 0" fill="none" stroke="oklch(0.85 0.15 200)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M -7 0 A 7 7 0 0 0 7 0" fill="none" stroke="oklch(0.9 0.15 200)" strokeWidth="1.5" />
          </g>
        ) : (
          <circle cx={20} cy={18} r="10" fill="none" stroke="oklch(0.4 0.02 250)" strokeDasharray="3 3" />
        )}
      </g>
      <g transform={`translate(${cx - R - 32}, ${cy - 12})`}>
        <rect x="0" y="0" width="24" height="24" rx="4" fill={power && sanitizerOn ? "oklch(0.4 0.18 305)" : "oklch(0.22 0.02 250)"} stroke="oklch(0.4 0.02 250)" />
        {power && sanitizerOn && <circle cx="12" cy="12" r="14" fill="oklch(0.7 0.22 305 / 0.3)" style={{ animation: "jcz-uv-blink 1.6s ease-in-out infinite" }} />}
      </g>

      <g transform={`translate(${cx}, ${cy})`}>
        <rect x="-50" y="-18" width="100" height="36" rx="8" fill="oklch(0.10 0.02 250 / 0.85)" stroke={waterGlow(currentTempC)} strokeOpacity="0.6" />
        <text x="0" y="-2" textAnchor="middle" fontSize="8" fill="oklch(0.7 0.05 250)" fontFamily="ui-monospace,monospace" letterSpacing="2">SET {presetTempC}°C</text>
        <text x="0" y="14" textAnchor="middle" fontSize="16" fontWeight="600" fill="oklch(0.98 0.02 250)" fontFamily="ui-monospace,monospace">
          {currentTempC.toFixed(1)}°
        </text>
      </g>

      {!power && <rect width="500" height="380" fill="oklch(0.12 0.02 250 / 0.55)" />}
    </svg>
  );
}

function ThreeQuarterTub({ state }: { state: TubState }) {
  const { power, heaterOn, filterOn, jetsOn, bubblesOn, sanitizerOn, currentTempC, presetTempC } = state;
  const water = waterColor(currentTempC);
  const cx = 250, cy = 175, rx = 160, ry = 50;

  const bubbles = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      x: cx + (Math.random() - 0.5) * rx * 1.2,
      delay: (i * 0.3) % 3,
      dur: 2 + Math.random() * 1.4,
      r: 2 + Math.random() * 3,
    })), []);

  return (
    <svg viewBox="0 0 500 380" className="w-full h-full">
      <defs>
        <pattern id="jcz-grid3" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="oklch(0.7 0.15 200 / 0.06)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="jcz-water3" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor={water} stopOpacity="1" />
          <stop offset="100%" stopColor={water} stopOpacity="0.75" />
        </radialGradient>
        <linearGradient id="jcz-side3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.36 0.02 250)" />
          <stop offset="1" stopColor="oklch(0.18 0.02 250)" />
        </linearGradient>
        <radialGradient id="jcz-heat3">
          <stop offset="0%" stopColor="oklch(0.78 0.20 50)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="oklch(0.78 0.20 50)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="jcz-water-clip3">
          <ellipse cx={cx} cy={cy} rx={rx - 16} ry={ry - 8} />
        </clipPath>
      </defs>

      <rect width="500" height="380" fill="url(#jcz-grid3)" />
      {power && heaterOn && (
        <ellipse cx={cx} cy={cy + 60} rx={rx + 50} ry={ry + 30} fill="url(#jcz-heat3)" style={{ animation: "jcz-heat-pulse 2.4s ease-in-out infinite", transformOrigin: `${cx}px ${cy + 60}px` }} />
      )}
      <ellipse cx={cx} cy={cy + 130} rx={rx + 16} ry={18} fill="oklch(0 0 0 / 0.45)" />

      <path d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy} L ${cx + rx} ${cy + 110} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy + 110} Z`} fill="url(#jcz-side3)" />
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx={cx} cy={cy + 18 + i * 23} rx={rx} ry={ry} fill="none" stroke="oklch(0.5 0.02 250 / 0.35)" />
      ))}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="oklch(0.42 0.02 250)" stroke="oklch(0.55 0.02 250 / 0.5)" />

      <g clipPath="url(#jcz-water-clip3)">
        <ellipse cx={cx} cy={cy} rx={rx - 16} ry={ry - 8} fill="url(#jcz-water3)" />
        <ellipse cx={cx - 30} cy={cy - 8} rx={60} ry={10} fill="oklch(1 0 0 / 0.12)" />
        {power && bubblesOn && bubbles.map((b) => (
          <circle key={b.id} cx={b.x} cy={cy + ry - 6} r={b.r} fill="oklch(1 0 0 / 0.7)">
            <animate attributeName="cy" from={cy + ry - 6} to={cy - ry + 4} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.9;0.9;0" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>
      <ellipse cx={cx} cy={cy} rx={rx - 16} ry={ry - 8} fill="none" stroke="oklch(0.1 0.02 250 / 0.7)" strokeWidth="1.5" />

      {power && jetsOn && (
        <g>
          <g style={{ animation: "jcz-jet-l 1.4s ease-out infinite" }}>
            <path d={`M ${cx - rx + 14} ${cy + 4} l 22 -3 l -4 3 l 4 4 z`} fill="oklch(0.85 0.15 230)" />
          </g>
          <g style={{ animation: "jcz-jet-r 1.4s ease-out infinite", animationDelay: "0.6s" }}>
            <path d={`M ${cx + rx - 14} ${cy + 4} l -22 -3 l 4 3 l -4 4 z`} fill="oklch(0.85 0.15 230)" />
          </g>
        </g>
      )}

      <g transform={`translate(${cx + rx + 10}, ${cy - 4})`}>
        <rect x="0" y="0" width="40" height="70" rx="6" fill="oklch(0.24 0.02 250)" stroke="oklch(0.4 0.02 250)" />
        {power && filterOn ? (
          <g transform="translate(20, 35)" style={{ animation: "jcz-swirl 1.6s linear infinite", transformOrigin: "0 0" }}>
            <path d="M -12 0 A 12 12 0 0 1 12 0" fill="none" stroke="oklch(0.85 0.15 200)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M -7 0 A 7 7 0 0 0 7 0" fill="none" stroke="oklch(0.9 0.15 200)" strokeWidth="1.5" />
          </g>
        ) : (
          <circle cx={20} cy={35} r="10" fill="none" stroke="oklch(0.4 0.02 250)" strokeDasharray="3 3" />
        )}
      </g>
      <g transform={`translate(${cx - rx - 38}, ${cy - 8})`}>
        <rect x="0" y="0" width="24" height="50" rx="4" fill={power && sanitizerOn ? "oklch(0.4 0.18 305)" : "oklch(0.22 0.02 250)"} stroke="oklch(0.4 0.02 250)" />
        {power && sanitizerOn && <rect x="3" y="3" width="18" height="44" rx="2" fill="oklch(0.7 0.22 305 / 0.5)" style={{ animation: "jcz-uv-blink 1.6s ease-in-out infinite" }} />}
      </g>

      <g transform={`translate(${cx}, ${cy + 4})`}>
        <rect x="-58" y="-22" width="116" height="44" rx="10" fill="oklch(0.10 0.02 250 / 0.85)" stroke={waterGlow(currentTempC)} strokeOpacity="0.6" />
        <text x="0" y="-4" textAnchor="middle" fontSize="9" fill="oklch(0.7 0.05 250)" fontFamily="ui-monospace,monospace" letterSpacing="2">CURRENT</text>
        <text x="0" y="14" textAnchor="middle" fontSize="20" fontWeight="600" fill="oklch(0.98 0.02 250)" fontFamily="ui-monospace,monospace">
          {currentTempC.toFixed(1)}°
        </text>
      </g>

      {!power && <rect width="500" height="380" fill="oklch(0.12 0.02 250 / 0.55)" />}
    </svg>
  );
}

function JacuzziTub({ view, state }: { view: NonNullable<JacuzziPanelProps["view"]>; state: TubState }) {
  if (view === "top") return <TopTub state={state} />;
  if (view === "three-quarter") return <ThreeQuarterTub state={state} />;
  return <IsoTub state={state} />;
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

const ACTION_THEMES: Record<JacuzziFn, { hue: number; label: string; accent: string }> = {
  power:     { hue: 145, label: "POWER",     accent: "oklch(0.78 0.18 145)" },
  heater:    { hue:  50, label: "HEATER",    accent: "oklch(0.78 0.18 50)"  },
  filter:    { hue: 200, label: "FILTER",    accent: "oklch(0.82 0.15 200)" },
  jets:      { hue: 230, label: "JETS",      accent: "oklch(0.78 0.16 230)" },
  bubbles:   { hue: 260, label: "BUBBLES",   accent: "oklch(0.74 0.18 260)" },
  sanitizer: { hue: 305, label: "SANITIZER", accent: "oklch(0.74 0.20 305)" },
};

interface ActionButtonProps {
  name: JacuzziFn;
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: (on: boolean) => void;
}

function ActionButton({ name, on, onClick, disabled, busy }: ActionButtonProps) {
  const theme = ACTION_THEMES[name];
  const Icon = Icons[name];
  return (
    <button
      type="button"
      onClick={() => !disabled && !busy && onClick(!on)}
      disabled={disabled}
      aria-pressed={on}
      aria-label={theme.label}
      className="group relative flex flex-col items-center justify-center gap-2 p-4 rounded-2xl font-mono text-[11px] tracking-[0.18em] transition-all duration-300 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        color: on ? "white" : "oklch(0.7 0 0 / 0.55)",
        background: on
          ? `radial-gradient(120% 120% at 50% 0%, oklch(0.32 0.10 ${theme.hue} / 0.55) 0%, oklch(0.18 0.04 ${theme.hue} / 0.85) 70%)`
          : "linear-gradient(180deg, oklch(0.26 0.02 250 / 0.7), oklch(0.18 0.02 250 / 0.7))",
        border: `1px solid ${on ? theme.accent : "oklch(0.4 0.02 250 / 0.4)"}`,
        boxShadow: on
          ? `0 0 0 1px ${theme.accent} inset, 0 0 24px ${theme.accent}aa, 0 6px 18px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.08)`
          : "inset 0 1px 0 oklch(1 0 0 / 0.04), inset 0 -1px 0 oklch(0 0 0 / 0.4), 0 4px 12px oklch(0 0 0 / 0.35)",
      }}
    >
      {on && (
        <span aria-hidden className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ border: `1px solid ${theme.accent}`, animation: "jcz-btn-pulse 2.2s ease-in-out infinite" }} />
      )}
      <span
        className="w-7 h-7"
        style={{
          color: on ? theme.accent : "oklch(0.65 0.02 250)",
          filter: on ? `drop-shadow(0 0 8px ${theme.accent})` : "none",
          transition: "color 240ms ease-out, filter 240ms ease-out",
        }}
      >
        {busy ? (
          <span className="inline-block w-7 h-7" style={{ animation: "jcz-spin 0.9s linear infinite" }}>
            {Icons.spinner}
          </span>
        ) : Icon}
      </span>
      <span className="leading-none">{theme.label}</span>
      <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
        style={{
          background: on ? theme.accent : "oklch(0.35 0.02 250)",
          boxShadow: on ? `0 0 8px ${theme.accent}` : "none",
        }} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Thermostat dial
// ---------------------------------------------------------------------------

const ARC_START = 135;
const ARC_END = 405;

function tempToAngle(t: number) {
  const k = (t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
  return ARC_START + k * (ARC_END - ARC_START);
}
function angleToTemp(a: number) {
  let aa = a;
  while (aa < ARC_START) aa += 360;
  while (aa > ARC_END) aa -= 360;
  if (aa < ARC_START) aa = ARC_START;
  if (aa > ARC_END) aa = ARC_END;
  const k = (aa - ARC_START) / (ARC_END - ARC_START);
  return Math.round(TEMP_MIN + k * (TEMP_MAX - TEMP_MIN));
}
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

interface ThermoDialProps {
  presetTempC: number;
  currentTempC: number;
  onChange: (t: number) => void;
  disabled?: boolean;
}

function ThermoDial({ presetTempC, currentTempC, onChange, disabled }: ThermoDialProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const cx = 130, cy = 130, R = 100;
  const angle = tempToAngle(presetTempC);
  const presetHue = hueForTemp(presetTempC);

  const onPointer = useCallback((e: PointerEvent | React.PointerEvent) => {
    if (disabled) return;
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = (((e as PointerEvent).clientX - rect.left) / rect.width) * 260;
    const py = (((e as PointerEvent).clientY - rect.top) / rect.height) * 260;
    const dx = px - cx;
    const dy = py - cy;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    onChange(angleToTemp(deg));
  }, [disabled, onChange]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onPointer(e);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, onPointer]);

  const ticks: React.ReactNode[] = [];
  for (let t = TEMP_MIN; t <= TEMP_MAX; t++) {
    const a = tempToAngle(t);
    const isMajor = t % 5 === 0;
    const inner = isMajor ? R - 12 : R - 8;
    const [x1, y1] = polar(cx, cy, R - 2, a);
    const [x2, y2] = polar(cx, cy, inner, a);
    const past = t <= presetTempC;
    ticks.push(
      <line key={t} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={past ? `oklch(0.85 0.18 ${hueForTemp(t)})` : "oklch(0.4 0.02 250 / 0.5)"}
        strokeWidth={isMajor ? 2 : 1}
        strokeLinecap="round"
        style={{ filter: past ? `drop-shadow(0 0 3px oklch(0.85 0.18 ${hueForTemp(t)}))` : "none" }}
      />
    );
  }

  const [hx, hy] = polar(cx, cy, R - 6, angle);

  return (
    <div className="relative select-none touch-none">
      <svg
        ref={ref}
        viewBox="0 0 260 260"
        className="w-full max-w-[280px]"
        role="slider"
        aria-valuemin={TEMP_MIN}
        aria-valuemax={TEMP_MAX}
        aria-valuenow={presetTempC}
        aria-label="Set point temperature"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { onChange(Math.min(TEMP_MAX, presetTempC + 1)); e.preventDefault(); }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") { onChange(Math.max(TEMP_MIN, presetTempC - 1)); e.preventDefault(); }
        }}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDragging(true);
          onPointer(e);
        }}
      >
        <defs>
          <radialGradient id="jcz-dial-bg">
            <stop offset="0%" stopColor="oklch(0.20 0.02 250)" />
            <stop offset="100%" stopColor="oklch(0.10 0.02 250)" />
          </radialGradient>
          <filter id="jcz-handle-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r={R + 18} fill={`oklch(0.5 0.18 ${presetHue} / 0.08)`} />
        <circle cx={cx} cy={cy} r={R + 6} fill="url(#jcz-dial-bg)" stroke="oklch(0.32 0.02 250 / 0.7)" />
        <path d={arcPath(cx, cy, R, ARC_START, ARC_END)} stroke="oklch(0.28 0.02 250)" strokeWidth="6" fill="none" strokeLinecap="round" />
        {ticks}
        <path d={arcPath(cx, cy, R, ARC_START, angle)}
          stroke={`oklch(0.78 0.18 ${presetHue})`} strokeWidth="3" fill="none" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px oklch(0.78 0.18 ${presetHue}))`, transition: "d 250ms ease-out, stroke 250ms ease-out" }} />

        <g style={{ transition: "transform 250ms ease-out", transform: `translate(${hx - cx}px, ${hy - cy}px)`, transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r={14} fill={`oklch(0.85 0.18 ${presetHue} / 0.3)`} filter="url(#jcz-handle-glow)" />
          <circle cx={cx} cy={cy} r={8} fill="oklch(0.96 0.02 250)" stroke={`oklch(0.78 0.18 ${presetHue})`} strokeWidth="2" />
        </g>

        <text x={cx} y={cy - 28} textAnchor="middle" fontSize="9" fill="oklch(0.65 0.05 250)" fontFamily="ui-monospace,monospace" letterSpacing="3">SET TO</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="44" fontWeight="600" fill="oklch(0.98 0.02 250)" fontFamily="ui-monospace,monospace">
          {presetTempC}°
        </text>
        <text x={cx} y={cy + 32} textAnchor="middle" fontSize="9" fill="oklch(0.6 0.05 250)" fontFamily="ui-monospace,monospace" letterSpacing="2">CELSIUS</text>
        <text x={cx} y={cy + 56} textAnchor="middle" fontSize="10" fill={`oklch(0.78 0.18 ${hueForTemp(currentTempC)})`} fontFamily="ui-monospace,monospace" letterSpacing="2">
          NOW {currentTempC.toFixed(1)}°
        </text>

        <text x={polar(cx, cy, R + 16, ARC_START)[0]} y={polar(cx, cy, R + 16, ARC_START)[1] + 4} textAnchor="middle" fontSize="9" fill="oklch(0.6 0.05 250)" fontFamily="ui-monospace,monospace">15°</text>
        <text x={polar(cx, cy, R + 16, ARC_END)[0]} y={polar(cx, cy, R + 16, ARC_END)[1] + 4} textAnchor="middle" fontSize="9" fill="oklch(0.6 0.05 250)" fontFamily="ui-monospace,monospace">40°</text>
      </svg>

      <div className="flex items-center justify-center gap-3 mt-1">
        <button
          type="button"
          aria-label="Decrease set temperature"
          disabled={disabled || presetTempC <= TEMP_MIN}
          onClick={() => onChange(Math.max(TEMP_MIN, presetTempC - 1))}
          className="w-10 h-10 rounded-full grid place-items-center text-white/80 hover:text-white transition disabled:opacity-30 bg-[oklch(0.20_0.02_250/0.7)] border border-white/10 hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <span className="w-4 h-4">{Icons.minus}</span>
        </button>
        <div className="font-mono text-[11px] text-white/50 tracking-widest w-10 text-center">{presetTempC}°C</div>
        <button
          type="button"
          aria-label="Increase set temperature"
          disabled={disabled || presetTempC >= TEMP_MAX}
          onClick={() => onChange(Math.min(TEMP_MAX, presetTempC + 1))}
          className="w-10 h-10 rounded-full grid place-items-center text-white/80 hover:text-white transition disabled:opacity-30 bg-[oklch(0.20_0.02_250/0.7)] border border-white/10 hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <span className="w-4 h-4">{Icons.plus}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

function ConnectivityBanner({ reachable }: { reachable: boolean }) {
  return (
    <div role="status" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-[11px] tracking-[0.18em] backdrop-blur"
      style={{
        background: reachable ? "oklch(0.22 0.06 145 / 0.5)" : "oklch(0.22 0.10 25 / 0.5)",
        border: `1px solid ${reachable ? "oklch(0.78 0.18 145 / 0.5)" : "oklch(0.72 0.20 25 / 0.5)"}`,
        color: reachable ? "oklch(0.92 0.10 145)" : "oklch(0.92 0.10 25)",
      }}>
      <span className="w-1.5 h-1.5 rounded-full"
        style={{
          background: reachable ? "oklch(0.78 0.18 145)" : "oklch(0.72 0.20 25)",
          boxShadow: `0 0 8px ${reachable ? "oklch(0.78 0.18 145)" : "oklch(0.72 0.20 25)"}`,
          animation: "jcz-led-pulse 2s ease-in-out infinite",
        }} />
      {reachable ? "ONLINE" : "OFFLINE"}
    </div>
  );
}

function ErrorBanner({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <div role="alert" className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-[11px] tracking-[0.12em] backdrop-blur"
      style={{
        background: "oklch(0.22 0.10 25 / 0.6)",
        border: "1px solid oklch(0.72 0.20 25 / 0.6)",
        color: "oklch(0.95 0.08 25)",
        boxShadow: "0 0 18px oklch(0.72 0.20 25 / 0.25)",
      }}>
      <span className="w-4 h-4" style={{ color: "oklch(0.85 0.20 25)" }}>{Icons.warn}</span>
      <span className="opacity-80">FAULT</span>
      <span className="font-semibold">{code}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel (named export — wire this to your endpoints)
// ---------------------------------------------------------------------------

export function JacuzziPanel(props: JacuzziPanelProps) {
  useKeyframes();

  const {
    power, heaterOn, filterOn, jetsOn, bubblesOn, sanitizerOn,
    currentTempC, presetTempC, reachable, errorCode,
    onToggle, onSetPresetTemp, view = "iso",
    host, plugName, plugPowerW, plugTs,
  } = props;

  // Tick chaque seconde pour rafraichir l'age affiche du dernier reading.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ageS = plugTs ? Math.max(0, Math.floor((now - new Date(plugTs).getTime()) / 1000)) : null;
  const stale = ageS !== null && ageS > 60;

  const [busy, setBusy] = useState<Partial<Record<JacuzziFn, boolean>>>({});

  const handleToggle = useCallback((fn: JacuzziFn, on: boolean) => {
    setBusy((b) => ({ ...b, [fn]: true }));
    onToggle(fn, on);
    setTimeout(() => setBusy((b) => ({ ...b, [fn]: false })), 350);
  }, [onToggle]);

  const offline = !reachable;

  return (
    <div className="relative w-full min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-10 overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(60% 80% at 70% 0%, oklch(0.22 0.08 280 / 0.6), transparent 60%)," +
          "radial-gradient(50% 60% at 0% 100%, oklch(0.22 0.10 200 / 0.4), transparent 60%)," +
          "oklch(0.10 0.02 260)",
      }}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 2px, oklch(1 0 0) 2px 3px)" }} />
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 80% at 50% 50%, transparent 50%, oklch(0 0 0 / 0.6))" }} />

      <div className="relative w-full max-w-[1200px]">
        <header className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center"
              style={{
                background: "linear-gradient(180deg, oklch(0.30 0.08 200), oklch(0.18 0.04 200))",
                border: "1px solid oklch(0.6 0.15 200 / 0.5)",
                boxShadow: "0 0 18px oklch(0.6 0.15 200 / 0.4)",
              }}>
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="oklch(0.92 0.12 200)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 17c2.5-2 5-2 7.5 0s5 2 7.5 0 2.5-2 5 0" />
                <path d="M2 12c2.5-2 5-2 7.5 0s5 2 7.5 0 2.5-2 5 0" />
                <path d="M8 7V4M16 7V4" />
              </svg>
            </div>
            <div>
              <div className="text-lg sm:text-xl font-semibold tracking-tight">JACUZZI / INTEX-CTRL</div>
              <div className="font-mono text-[10px] sm:text-[11px] tracking-[0.22em] text-white/40">
                NODE {host ?? "—"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {plugPowerW !== null && plugPowerW !== undefined && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-[11px] tracking-[0.18em] backdrop-blur"
                style={{
                  background: stale ? "oklch(0.22 0.06 30 / 0.5)" : "oklch(0.22 0.08 75 / 0.5)",
                  border: `1px solid ${stale ? "oklch(0.72 0.16 30 / 0.5)" : "oklch(0.78 0.18 75 / 0.5)"}`,
                  color: stale ? "oklch(0.92 0.12 30)" : "oklch(0.95 0.10 75)",
                }}>
                <span className="opacity-70">{plugName ?? "PLUG"}</span>
                <span className="font-semibold">{Math.round(plugPowerW)} W</span>
                {ageS !== null && (
                  <span className="opacity-50 text-[10px]">
                    · {ageS < 60 ? `${ageS}s` : `${Math.floor(ageS / 60)}min`}
                  </span>
                )}
              </div>
            )}
            <ConnectivityBanner reachable={reachable} />
          </div>
        </header>

        {errorCode && <div className="mb-4"><ErrorBanner code={errorCode} /></div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          <section className="lg:col-span-8 rounded-3xl p-4 sm:p-6 backdrop-blur-md relative"
            style={{
              background: "oklch(0.14 0.02 250 / 0.65)",
              border: "1px solid oklch(0.4 0.02 250 / 0.3)",
              boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04), 0 20px 60px oklch(0 0 0 / 0.5)",
            }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-[11px] tracking-[0.22em] text-white/55">SCHEMATIC · {view.toUpperCase()}</div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-white/35">live render</div>
            </div>
            <div className="aspect-[5/3.4] w-full">
              <JacuzziTub view={view} state={{ power, heaterOn, filterOn, jetsOn, bubblesOn, sanitizerOn, currentTempC, presetTempC }} />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3 font-mono text-[10px] tracking-[0.14em]">
              {([
                ["PWR", power, "oklch(0.78 0.18 145)"],
                ["HEAT", heaterOn, "oklch(0.78 0.18 50)"],
                ["FILT", filterOn, "oklch(0.82 0.15 200)"],
                ["JETS", jetsOn, "oklch(0.78 0.16 230)"],
                ["BUBL", bubblesOn, "oklch(0.74 0.18 260)"],
                ["UV", sanitizerOn, "oklch(0.74 0.20 305)"],
              ] as const).map(([k, v, c]) => (
                <div key={k} className="flex items-center gap-2 px-2 py-1.5 rounded-md"
                  style={{
                    background: "oklch(0.10 0.02 250 / 0.7)",
                    border: `1px solid ${v ? c : "oklch(0.3 0.02 250 / 0.4)"}`,
                  }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: v ? c : "oklch(0.35 0.02 250)", boxShadow: v ? `0 0 6px ${c}` : "none" }} />
                  <span className="text-white/70">{k}</span>
                  <span className="ml-auto text-white/50">{v ? "ON" : "OFF"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="lg:col-span-4 rounded-3xl p-4 sm:p-6 backdrop-blur-md flex flex-col items-center justify-center"
            style={{
              background: "oklch(0.14 0.02 250 / 0.65)",
              border: "1px solid oklch(0.4 0.02 250 / 0.3)",
              boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04), 0 20px 60px oklch(0 0 0 / 0.5)",
            }}>
            <div className="w-full flex items-center justify-between mb-2">
              <div className="font-mono text-[11px] tracking-[0.22em] text-white/55">SETPOINT</div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-white/35">15° – 40°</div>
            </div>
            <ThermoDial
              presetTempC={presetTempC}
              currentTempC={currentTempC}
              onChange={onSetPresetTemp}
              disabled={offline}
            />
          </section>

          <section className="lg:col-span-12 rounded-3xl p-4 sm:p-6 backdrop-blur-md"
            style={{
              background: "oklch(0.14 0.02 250 / 0.65)",
              border: "1px solid oklch(0.4 0.02 250 / 0.3)",
              boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04), 0 20px 60px oklch(0 0 0 / 0.5)",
            }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[11px] tracking-[0.22em] text-white/55">SUBSYSTEMS</div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-white/35">tap to toggle</div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
              <ActionButton name="power"     on={power}       busy={busy.power}     disabled={offline} onClick={(on) => handleToggle("power", on)} />
              <ActionButton name="heater"    on={heaterOn}    busy={busy.heater}    disabled={offline || !power} onClick={(on) => handleToggle("heater", on)} />
              <ActionButton name="filter"    on={filterOn}    busy={busy.filter}    disabled={offline || !power} onClick={(on) => handleToggle("filter", on)} />
              <ActionButton name="jets"      on={jetsOn}      busy={busy.jets}      disabled={offline || !power} onClick={(on) => handleToggle("jets", on)} />
              <ActionButton name="bubbles"   on={bubblesOn}   busy={busy.bubbles}   disabled={offline || !power} onClick={(on) => handleToggle("bubbles", on)} />
              <ActionButton name="sanitizer" on={sanitizerOn} busy={busy.sanitizer} disabled={offline || !power} onClick={(on) => handleToggle("sanitizer", on)} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
