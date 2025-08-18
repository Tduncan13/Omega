import React, { useEffect, useMemo, useRef, useState } from "react";

import { enemyStep } from "./enemy";
import { clamp } from './util/utilities';
import { World, makeInitialWorld, CANVAS_SIZE } from './world/world';
import { drawGrid, drawTank } from "./ui";
import { parseProgram, Program, Runtime, makeRuntime, stepProgram } from "./interpreter";

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
