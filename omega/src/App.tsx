import React, { useEffect, useMemo, useRef, useState } from "react";

// Omega Tanks — single-file React demo
// ------------------------------------------------------------
// What this includes
// - 20x20 neon grid map (each cell ~= size of tank)
// - Player tank you program with the tiny 'Omega' language
// - Simple enemy with basic chase AI
// - Text editor, Run / Step / Reset buttons
// - An interpreter for a subset of Omega:
//   * Variables: NAME = 5; use with $NAME
//   * MOVE n FORWARD|BACKWARD|LEFT|RIGHT;
//   * TURN LEFT|RIGHT;
//   * SCAN_FOR_ENEMY;  // sets $ENEMY to 1 if enemy is in line-of-sight (row/col), else 0
//   * IF $NAME THEN <stmt> ELSE <stmt>;
//   * ATTACK;          // damages enemy if in front and within 3 tiles unobstructed
//   * FUNCTION Name: ... END;
//   * CALL Name;
// - Tick-based execution (Play/Step)
//
// Notes
// - This is a teaching/prototype build. It’s intentionally compact and commented.
// - No external state managers — just React hooks.
// - Graphics are Canvas 2D with a Tron-like neon vibe.

// ---------------------- Types & Helpers ----------------------
const GRID = 20; // 20x20 level one
const CELL = 28; // pixels per tile
const CANVAS_SIZE = GRID * CELL;

// Directions: 0=up,1=right,2=down,3=left
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function inBounds(x: number, y: number) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}

// ---------------------- Game State ---------------------------
interface Tank {
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  hp: number; // 0..100
}

interface Enemy extends Tank { }

interface World {
  player: Tank;
  enemy: Enemy;
  tick: number;
  message: string;
}

function makeInitialWorld(): World {
  return {
    player: { x: 2, y: GRID - 3, dir: 0, hp: 100 },
    enemy: { x: GRID - 3, y: 2, dir: 2, hp: 100 },
    tick: 0,
    message: "",
  };
}

// ---------------------- Omega Interpreter --------------------
// Extremely small line-by-line interpreter with a tiny grammar.
// We first tokenize to simple statements; expressions are limited to integers or $VARS.

type Stmt =
  | { kind: "assign"; name: string; value: Expr }
  | { kind: "move"; amount: Expr; dir: "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" }
  | { kind: "turn"; dir: "LEFT" | "RIGHT" }
  | { kind: "scan" }
  | { kind: "attack" }
  | { kind: "if"; cond: Expr; thenStmt: Stmt; elseStmt?: Stmt }
  | { kind: "call"; name: string }
  | { kind: "noop" }
  | { kind: "function"; name: string; body: Stmt[] };

type Expr = { kind: "number"; value: number } | { kind: "var"; name: string };

interface Program {
  stmts: Stmt[];
  functions: Record<string, Stmt[]>;
}

// --- Parsing utilities ---
function stripComments(s: string) {
  return s
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function tokenize(code: string): string[] {
  // Split on semicolons, but keep function blocks intact (FUNCTION Name: ... END)
  const lines = stripComments(code).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const tokens: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^FUNCTION\s+/i.test(line)) {
      const header = line;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^END\b/i.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      // consume END
      if (i < lines.length && /^END\b/i.test(lines[i])) i++;
      tokens.push([header, ...body, "END"].join("\n"));
    } else {
      // Regular statements can be split by ; on the same line
      const parts = line.split(";").map((p) => p.trim()).filter(Boolean);
      for (const p of parts) tokens.push(p + ";");
      i++;
    }
  }
  return tokens;
}

function parseExpr(tok: string): Expr {
  const v = tok.trim();
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return { kind: "var", name: v.slice(1) };
  const n = Number(v);
  if (!Number.isNaN(n)) return { kind: "number", value: n };
  // Fallback: treat unknown as 0
  return { kind: "number", value: 0 };
}

function parseStmt(token: string): Stmt | null {
  const t = token.trim();
  if (!t) return null;

  // FUNCTION Name: ... END
  if (/^FUNCTION\s+/i.test(t)) {
    const m = t.match(/^FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\n([\s\S]*?)\nEND$/i);
    if (m) {
      const name = m[1];
      const bodyRaw = m[2];
      const innerTokens = tokenize(bodyRaw);
      const body: Stmt[] = innerTokens.map(parseStmt).filter(Boolean) as Stmt[];
      return { kind: "function", name, body };
    }
  }

  // IF cond THEN stmt ELSE stmt;
  if (/^IF\s+/i.test(t)) {
    // Very small IF grammar: IF <expr> THEN <simpleStmt> (ELSE <simpleStmt>)?;
    const m = t.match(/^IF\s+(.+?)\s+THEN\s+(.+?)(?:\s+ELSE\s+(.+))?;?$/i);
    if (m) {
      const cond = parseExpr(m[1]);
      const thenStmt = parseStmt(m[2]!.trim() + (m[2]!.trim().endsWith(";") ? "" : ";"));
      const elseRaw = m[3]?.trim();
      const elseStmt = elseRaw ? parseStmt(elseRaw + (elseRaw.endsWith(";") ? "" : ";")) : undefined;
      if (thenStmt) return { kind: "if", cond, thenStmt, elseStmt };
    }
  }

  // Assignment: NAME = 5;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t)) {
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+);?$/);
    if (m) return { kind: "assign", name: m[1], value: parseExpr(m[2]!) };
  }

  // MOVE n DIRECTION;
  if (/^MOVE\s+/i.test(t)) {
    const m = t.match(/^MOVE\s+(.+)\s+(FORWARD|BACKWARD|LEFT|RIGHT);?$/i);
    if (m) return { kind: "move", amount: parseExpr(m[1]!), dir: m[2]!.toUpperCase() as any };
  }

  // TURN LEFT|RIGHT;
  if (/^TURN\s+/i.test(t)) {
    const m = t.match(/^TURN\s+(LEFT|RIGHT);?$/i);
    if (m) return { kind: "turn", dir: m[1]!.toUpperCase() as any };
  }

  if (/^SCAN_FOR_ENEMY;?$/i.test(t)) return { kind: "scan" };
  if (/^ATTACK;?$/i.test(t)) return { kind: "attack" };
  if (/^CALL\s+/i.test(t)) {
    const m = t.match(/^CALL\s+([A-Za-z_][A-Za-z0-9_]*);?$/i);
    if (m) return { kind: "call", name: m[1]! };
  }

  if (/^;?$/.test(t)) return { kind: "noop" };
  return { kind: "noop" };
}

function parseProgram(code: string): Program {
  const tokens = tokenize(code);
  const stmts: Stmt[] = [];
  const functions: Record<string, Stmt[]> = {};
  for (const tok of tokens) {
    const s = parseStmt(tok);
    if (!s) continue;
    if (s.kind === "function") {
      functions[s.name] = s.body;
    } else {
      stmts.push(s);
    }
  }
  return { stmts, functions };
}

// --- Runtime ---
interface Runtime {
  pc: number; // program counter for top-level stmts
  stack: { name: string; pc: number; body: Stmt[] }[]; // simple call stack
  vars: Record<string, number>;
  enemySeen: number; // reflects $ENEMY for convenience
}

function makeRuntime(): Runtime {
  return { pc: 0, stack: [], vars: {}, enemySeen: 0 };
}

function getVal(expr: Expr, rt: Runtime): number {
  if (expr.kind === "number") return expr.value;
  return rt.vars[expr.name] ?? 0;
}

// Game API operations used by Omega
function apiMove(world: World, dirWord: string, amount: number) {
  const p = world.player;
  let dx = 0, dy = 0;
  switch (dirWord) {
    case "FORWARD": { const d = DIRS[p.dir]; dx = d.dx; dy = d.dy; break; }
    case "BACKWARD": { const d = DIRS[p.dir]; dx = -d.dx; dy = -d.dy; break; }
    case "LEFT": { const d = DIRS[(p.dir + 3) % 4]; dx = d.dx; dy = d.dy; break; }
    case "RIGHT": { const d = DIRS[(p.dir + 1) % 4]; dx = d.dx; dy = d.dy; break; }
  }
  for (let i = 0; i < amount; i++) {
    const nx = clamp(p.x + dx, 0, GRID - 1);
    const ny = clamp(p.y + dy, 0, GRID - 1);
    p.x = nx; p.y = ny;
  }
}

function apiTurn(world: World, side: "LEFT" | "RIGHT") {
  world.player.dir = ((world.player.dir + (side === "RIGHT" ? 1 : 3)) % 4) as any;
}

function lineOfSight(a: Tank, b: Tank): { seen: boolean; distance: number; dirOk: boolean } {
  if (a.x === b.x) {
    const dy = Math.sign(b.y - a.y);
    const dist = Math.abs(b.y - a.y);
    // same column — visible
    const facing = (dy < 0 && a.dir === 0) || (dy > 0 && a.dir === 2);
    return { seen: dist > 0, distance: dist, dirOk: facing };
  }
  if (a.y === b.y) {
    const dx = Math.sign(b.x - a.x);
    const dist = Math.abs(b.x - a.x);
    const facing = (dx > 0 && a.dir === 1) || (dx < 0 && a.dir === 3);
    return { seen: dist > 0, distance: dist, dirOk: facing };
  }
  return { seen: false, distance: 999, dirOk: false };
}

function apiScan(world: World, rt: Runtime) {
  const los = lineOfSight(world.player, world.enemy);
  rt.enemySeen = los.seen ? 1 : 0;
  rt.vars["ENEMY"] = rt.enemySeen;
  world.message = los.seen ? `Enemy spotted at ${los.distance} tiles.` : "No enemy in sight.";
}

function apiAttack(world: World) {
  const los = lineOfSight(world.player, world.enemy);
  // Attack only if in facing direction and within 3 tiles
  if (los.seen && los.dirOk && los.distance <= 3) {
    world.enemy.hp = Math.max(0, world.enemy.hp - 40);
    world.message = "ATTACK hit! Enemy -40 HP";
  } else {
    world.message = "ATTACK missed.";
  }
}

// Step one statement. Returns whether it executed something.
function stepProgram(world: World, prog: Program, rt: Runtime): boolean {
  const frame = rt.stack.at(-1);
  const list = frame ? frame.body : prog.stmts;
  let pc = frame ? frame.pc : rt.pc;
  if (pc >= list.length) {
    if (frame) { rt.stack.pop(); return true; }
    return false; // finished top-level
  }
  const stmt = list[pc];
  const advance = () => {
    if (frame) frame.pc++; else rt.pc++;
  };

  switch (stmt.kind) {
    case "assign": {
      rt.vars[stmt.name] = getVal(stmt.value, rt);
      advance();
      world.message = `$${stmt.name} = ${rt.vars[stmt.name]}`;
      return true;
    }
    case "move": {
      const amt = Math.max(0, Math.floor(getVal(stmt.amount, rt)));
      apiMove(world, stmt.dir, amt);
      advance();
      world.message = `MOVE ${amt} ${stmt.dir}`;
      return true;
    }
    case "turn": {
      apiTurn(world, stmt.dir);
      advance();
      world.message = `TURN ${stmt.dir}`;
      return true;
    }
    case "scan": {
      apiScan(world, rt);
      advance();
      return true;
    }
    case "attack": {
      apiAttack(world);
      advance();
      return true;
    }
    case "if": {
      const cond = getVal(stmt.cond, rt);
      // Inline one-level THEN/ELSE by temporarily executing that stmt now
      const chosen = cond !== 0 ? stmt.thenStmt : stmt.elseStmt;
      // Replace current stmt with chosen by executing it immediately (doesn't change pc)
      if (chosen) {
        // Execute chosen single statement by creating a tiny frame
        const tmpBody = [chosen];
        rt.stack.push({ name: "<if>", pc: 0, body: tmpBody });
      } else {
        advance();
      }
      if (!chosen) world.message = `IF (${cond}) no-op`;
      return true;
    }
    case "call": {
      const body = prog.functions[stmt.name];
      if (body) {
        rt.stack.push({ name: stmt.name, pc: 0, body: body });
      }
      advance();
      world.message = `CALL ${stmt.name}`;
      return true;
    }
    case "noop":
      advance();
      return true;
    case "function":
      // Functions are not in the sequence (filtered at parse). But safe to skip.
      advance();
      return true;
  }
}

// ---------------------- Enemy AI -----------------------------
function enemyStep(world: World) {
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

// ---------------------- Rendering ----------------------------
function drawGrid(ctx: CanvasRenderingContext2D) {
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

function drawTank(ctx: CanvasRenderingContext2D, t: Tank, color = "#00e5ff") {
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

// ---------------------- UI Component -------------------------
const DEFAULT_CODE = `// Omega sample
MOVEMENT = 2;
SCAN_FOR_ENEMY;
IF $ENEMY THEN ATTACK ELSE MOVE $MOVEMENT FORWARD;

FUNCTION Patrol:
  MOVE 1 LEFT;
  MOVE 1 RIGHT;
END;

CALL Patrol;`;

export default function OmegaTanks() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [world, setWorld] = useState<World>(makeInitialWorld());
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [prog, setProg] = useState<Program>(() => parseProgram(DEFAULT_CODE));
  const [rt, setRt] = useState<Runtime>(() => makeRuntime());
  const [isRunning, setIsRunning] = useState(false);
  const [speedMs, setSpeedMs] = useState(380);

  // Re-parse when code changes
  useEffect(() => {
    const p = parseProgram(code);
    setProg(p);
  }, [code]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawGrid(ctx);
    drawTank(ctx, world.player, "#00e5ff");
    drawTank(ctx, world.enemy, "#ff2ad1");
  }, [world]);

  // Game loop when running
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      stepOnce();
    }, speedMs);
    return () => clearInterval(id);
  }, [isRunning, speedMs, world, prog, rt]);

  function stepOnce() {
    setWorld((w) => {
      const w2: World = JSON.parse(JSON.stringify(w));
      const rt2: Runtime = { ...rt, vars: { ...rt.vars }, stack: rt.stack.map((f) => ({ ...f, body: f.body })) };
      const did = stepProgram(w2, prog, rt2);
      enemyStep(w2);
      w2.tick++;
      setRt(rt2);
      // win/lose messages
      if (w2.enemy.hp <= 0) w2.message = (w2.message ? w2.message + " | " : "") + "Enemy destroyed!";
      if (w2.player.hp <= 0) w2.message = (w2.message ? w2.message + " | " : "") + "You were destroyed.";
      return did ? w2 : w2; // always advance enemy
    });
  }

  function resetAll() {
    setWorld(makeInitialWorld());
    setRt(makeRuntime());
    setIsRunning(false);
  }

  function runOnce() {
    setIsRunning(true);
  }

  function stopRun() {
    setIsRunning(false);
  }

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Canvas & HUD */}
        <div className="space-y-4">
          <div className="rounded-2xl p-3 bg-slate-950 shadow-xl border border-cyan-500/20">
            <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="w-full rounded-xl" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <button onClick={stepOnce} className="rounded-2xl px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 shadow">Step</button>
            {!isRunning ? (
              <button onClick={runOnce} className="rounded-2xl px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 shadow">Run</button>
            ) : (
              <button onClick={stopRun} className="rounded-2xl px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 shadow">Pause</button>
            )}
            <button onClick={resetAll} className="rounded-2xl px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 shadow">Reset</button>
          </div>

          <div className="rounded-2xl bg-slate-950 border border-cyan-500/20 p-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase text-cyan-300/80">Player</div>
              <div className="text-lg">HP: {world.player.hp}</div>
              <div className="text-sm text-slate-400">Pos: ({world.player.x},{world.player.y}) Dir: {world.player.dir}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-rose-300/80">Enemy</div>
              <div className="text-lg">HP: {world.enemy.hp}</div>
              <div className="text-sm text-slate-400">Pos: ({world.enemy.x},{world.enemy.y}) Dir: {world.enemy.dir}</div>
            </div>
            <div className="col-span-2 text-sm text-cyan-200">Tick: {world.tick} — {world.message || "Ready."}</div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <label className="opacity-80">Speed</label>
            <input type="range" min={120} max={800} value={speedMs} onChange={(e) => setSpeedMs(parseInt(e.target.value))} />
            <span>{speedMs} ms/step</span>
          </div>
        </div>

        {/* Right: Editor & Docs */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-950 p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold">Omega Editor</h2>
              <div className="text-sm opacity-70">Write and run your tank logic</div>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full h-[360px] font-mono text-sm bg-black/60 border border-cyan-500/20 rounded-xl p-3 outline-none focus:border-cyan-400/50"
            />
            <div className="text-xs text-slate-400 mt-2">
              Tip: Semicolons end statements. Functions are defined with <code>FUNCTION Name: ... END</code> and invoked with <code>CALL Name;</code>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-slate-950 p-4">
            <h3 className="text-lg font-semibold mb-2">Omega — v0.1 Syntax</h3>
            <ul className="list-disc ml-5 space-y-1 text-sm">
              <li><code>NAME = 5;</code> — integer vars; use as <code>$NAME</code></li>
              <li><code>MOVE n FORWARD|BACKWARD|LEFT|RIGHT;</code></li>
              <li><code>TURN LEFT|RIGHT;</code></li>
              <li><code>SCAN_FOR_ENEMY;</code> — sets <code>$ENEMY</code> to 1/0 if enemy in same row/col</li>
              <li><code>IF $ENEMY THEN ATTACK ELSE MOVE 1 FORWARD;</code></li>
              <li><code>ATTACK;</code> — hits if facing enemy within 3 tiles</li>
              <li><code>FUNCTION Patrol:\n  MOVE 1 LEFT;\nEND;  CALL Patrol;</code></li>
            </ul>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-slate-950 p-4 text-sm text-slate-300">
            <h3 className="text-lg font-semibold mb-2">Level 1</h3>
            <p>Size: 20×20 units (one unit ≈ tank size). Destroy the pink enemy before it destroys you. Line-of-sight is straight row/column.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
