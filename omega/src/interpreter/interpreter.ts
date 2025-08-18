import { World, GRID } from "../world";
import { DIRS, clamp } from "../util";
import { Tank } from "../tanks/tanks";

// ---------------------- Omega Interpreter --------------------
// Extremely small line-by-line interpreter with a tiny grammar.
// We first tokenize to simple statements; expressions are limited to integers or $VARS.

// --- Runtime ---
export interface Runtime {
  pc: number; // program counter for top-level stmts
  stack: { name: string; pc: number; body: Stmt[] }[]; // simple call stack
  vars: Record<string, number>;
  enemySeen: number; // reflects $ENEMY for convenience
}

export function makeRuntime(): Runtime {
  return { pc: 0, stack: [], vars: {}, enemySeen: 0 };
}

export function getVal(expr: Expr, rt: Runtime): number {
  if (expr.kind === "number") return expr.value;
  return rt.vars[expr.name] ?? 0;
}

// Game API operations used by Omega
export function tankMove(world: World, dirWord: string, amount: number) {
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

export function tankTurn(world: World, side: "LEFT" | "RIGHT") {
  world.player.dir = ((world.player.dir + (side === "RIGHT" ? 1 : 3)) % 4) as any;
}

export function lineOfSight(a: Tank, b: Tank): { seen: boolean; distance: number; dirOk: boolean } {
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

export function tankScan(world: World, rt: Runtime) {
  const los = lineOfSight(world.player, world.enemy);
  rt.enemySeen = los.seen ? 1 : 0;
  rt.vars["ENEMY"] = rt.enemySeen;
  world.message = los.seen ? `Enemy spotted at ${los.distance} tiles.` : "No enemy in sight.";
}

export function tankAttack(world: World) {
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
export function stepProgram(world: World, prog: Program, rt: Runtime): boolean {
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
      tankMove(world, stmt.dir, amt);
      advance();
      world.message = `MOVE ${amt} ${stmt.dir}`;
      return true;
    }
    case "turn": {
      tankTurn(world, stmt.dir);
      advance();
      world.message = `TURN ${stmt.dir}`;
      return true;
    }
    case "scan": {
      tankScan(world, rt);
      advance();
      return true;
    }
    case "attack": {
      tankAttack(world);
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

export type Stmt =
  | { kind: "assign"; name: string; value: Expr }
  | { kind: "move"; amount: Expr; dir: "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" }
  | { kind: "turn"; dir: "LEFT" | "RIGHT" }
  | { kind: "scan" }
  | { kind: "attack" }
  | { kind: "if"; cond: Expr; thenStmt: Stmt; elseStmt?: Stmt | null | undefined }
  | { kind: "call"; name: string }
  | { kind: "noop" }
  | { kind: "function"; name: string; body: Stmt[] };

export type Expr = { kind: "number"; value: number } | { kind: "var"; name: string };

export interface Program {
  stmts: Stmt[];
  functions: Record<string, Stmt[]>;
}

// --- Parsing utilities ---
export function stripComments(s: string) {
  return s
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

export function tokenize(code: string): string[] {
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

export function parseExpr(tok: string): Expr {
  const v = tok.trim();
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return { kind: "var", name: v.slice(1) };
  const n = Number(v);
  if (!Number.isNaN(n)) return { kind: "number", value: n };
  // Fallback: treat unknown as 0
  return { kind: "number", value: 0 };
}

export function parseStmt(token: string): Stmt | null {
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

export function parseProgram(code: string): Program {
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
