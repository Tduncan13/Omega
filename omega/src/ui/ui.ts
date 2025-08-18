import { CANVAS_SIZE, CELL, GRID } from "../world";
import { Tank } from "../tanks/tanks";
import { DIRS } from '../util/utilities';

// ---------------------- Rendering ----------------------------
export function drawGrid(ctx: CanvasRenderingContext2D) {
  // Tron-like neon grid on dark
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = "#070a12";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.strokeStyle = "rgba(0, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * CELL + 0.5);
    ctx.lineTo(CANVAS_SIZE, i * CELL + 0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(i * CELL + 0.5, 0);
    ctx.lineTo(i * CELL + 0.5, CANVAS_SIZE);
    ctx.stroke();
  }

  // Glow effect overlay
  const grad = ctx.createRadialGradient(
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 4,
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
    CANVAS_SIZE
  );
  grad.addColorStop(0, "rgba(0,255,255,0.06)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

export function drawTank(ctx: CanvasRenderingContext2D, t: Tank, color = "#00e5ff") {
  const x = t.x * CELL;
  const y = t.y * CELL;
  // body
  ctx.shadowBlur = 12;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 6);
  ctx.stroke();

  // turret line showing direction
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  const d = DIRS[t.dir];
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + d.dx * (CELL / 2 - 4), cy + d.dy * (CELL / 2 - 4));
  ctx.stroke();

  // hp bar
  ctx.shadowBlur = 0;
  const w = Math.max(0, Math.min(1, t.hp / 100)) * (CELL - 8);
  ctx.fillStyle = "#00ffaa";
  ctx.fillRect(x + 4, y + CELL - 6, w, 2);
}
