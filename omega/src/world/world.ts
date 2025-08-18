import { Tank, Enemy } from "../tanks/tanks";

export const GRID = 20; // 20x20 level one
export const CELL = 28; // pixels per tile
export const CANVAS_SIZE = GRID * CELL;

export interface World {
  player: Tank;
  enemy: Enemy;
  tick: number;
  message: string;
}

export function makeInitialWorld(): World {
  return {
    player: { x: 2, y: GRID - 3, dir: 0, hp: 100 },
    enemy: { x: GRID - 3, y: 2, dir: 2, hp: 100 },
    tick: 0,
    message: "",
  };
}
