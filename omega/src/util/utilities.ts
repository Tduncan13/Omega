import { GRID } from '../world';

// ---------------------- Types & Helpers ----------------------
// Directions: 0=up,1=right,2=down,3=left
export const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function inBounds(x: number, y: number) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}
