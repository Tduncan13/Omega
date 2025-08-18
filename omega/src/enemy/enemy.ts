import { World, GRID } from '../world/world';
import { clamp, DIRS } from '../util';
import { lineOfSight } from '../interpreter';

// ---------------------- Enemy AI -----------------------------
export function enemyStep(world: World) {
  const e = world.enemy;
  const p = world.player;
  if (e.hp <= 0) return;
  // Simple chase: if in line-of-sight, move towards; else wander slightly toward player
  const los = lineOfSight(e, p);
  if (los.seen && los.distance <= 3 && los.dirOk) {
    // Enemy attacks
    world.player.hp = Math.max(0, world.player.hp - 15);
    world.message = world.message + " | Enemy fires (-15 HP)";
    return;
  }
  // turn towards target
  const dx = Math.sign(p.x - e.x);
  const dy = Math.sign(p.y - e.y);
  const pref = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  e.dir = pref as any;
  const d = DIRS[e.dir];
  e.x = clamp(e.x + d.dx, 0, GRID - 1);
  e.y = clamp(e.y + d.dy, 0, GRID - 1);
}
