import { useCallback, useEffect, useRef, useState } from "react";

interface Player {
  x: number;
  y: number;
  w: number;
  h: number;
  hits: number;
}

interface Ball {
  x: number;
  y: number;
  speed: number;
  vy: number;
  trail: { x: number; y: number }[];
}

interface GameState {
  p1: Player;
  p2: Player;
  balls: Ball[];
  gameOver: boolean;
  lastThrow1: number;
  lastThrow2: number;
  keys: Record<string, boolean>;
  animFrameId: number;
  p1Flash: number;
  p2Flash: number;
}

const CANVAS_W = 800;
const CANVAS_H = 400;
const COOLDOWN = 750;
const MAX_HITS = 3;
const BALL_SPEED = 7;

function makeInitialState(): GameState {
  return {
    p1: { x: 50, y: 180, w: 44, h: 56, hits: 0 },
    p2: { x: 706, y: 180, w: 44, h: 56, hits: 0 },
    balls: [],
    gameOver: false,
    lastThrow1: 0,
    lastThrow2: 0,
    keys: {},
    animFrameId: 0,
    p1Flash: 0,
    p2Flash: 0,
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(makeInitialState());
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [winner, setWinner] = useState<string | null>(null);

  const resetGame = useCallback(() => {
    const s = stateRef.current;
    const fresh = makeInitialState();
    s.p1 = fresh.p1;
    s.p2 = fresh.p2;
    s.balls = fresh.balls;
    s.gameOver = false;
    s.lastThrow1 = 0;
    s.lastThrow2 = 0;
    s.p1Flash = 0;
    s.p2Flash = 0;
    setScore({ p1: 0, p2: 0 });
    setWinner(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      s.keys[e.key] = true;
      const now = Date.now();

      if ((e.key === "f" || e.key === "F") && !s.gameOver) {
        if (now - s.lastThrow1 > COOLDOWN) {
          s.balls.push({
            x: s.p1.x + s.p1.w + 4,
            y: s.p1.y + s.p1.h / 2,
            speed: BALL_SPEED,
            vy: (Math.random() - 0.5) * 2,
            trail: [],
          });
          s.lastThrow1 = now;
        }
      }

      if ((e.key === "l" || e.key === "L") && !s.gameOver) {
        if (now - s.lastThrow2 > COOLDOWN) {
          s.balls.push({
            x: s.p2.x - 4,
            y: s.p2.y + s.p2.h / 2,
            speed: -BALL_SPEED,
            vy: (Math.random() - 0.5) * 2,
            trail: [],
          });
          s.lastThrow2 = now;
        }
      }

      if (e.key === "1") {
        resetGame();
      }

      // prevent arrow key scrolling
      if (["ArrowUp", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      s.keys[e.key] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- Drawing helpers ----
    function drawPlayer(p: Player, color: string, flash: number) {
      const alpha =
        flash > 0 && Math.floor(Date.now() / 80) % 2 === 0 ? 0.35 : 1;
      ctx!.save();
      ctx!.globalAlpha = alpha;

      // Shadow glow
      ctx!.shadowColor = color;
      ctx!.shadowBlur = 18;

      // Body
      ctx!.fillStyle = color;
      ctx!.beginPath();
      ctx!.roundRect(p.x, p.y, p.w, p.h, 6);
      ctx!.fill();

      // Highlight stripe
      ctx!.shadowBlur = 0;
      ctx!.fillStyle = "rgba(255,255,255,0.25)";
      ctx!.beginPath();
      ctx!.roundRect(p.x + 6, p.y + 6, p.w - 12, 10, 3);
      ctx!.fill();

      // Eyes
      ctx!.fillStyle = "white";
      const eyeY = p.y + 16;
      ctx!.beginPath();
      ctx!.arc(p.x + p.w * 0.35, eyeY, 5, 0, Math.PI * 2);
      ctx!.arc(p.x + p.w * 0.65, eyeY, 5, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = "#111";
      ctx!.beginPath();
      ctx!.arc(
        p.x + p.w * 0.35 + (color === "#ef4444" ? -1 : 1),
        eyeY,
        2.5,
        0,
        Math.PI * 2,
      );
      ctx!.arc(
        p.x + p.w * 0.65 + (color === "#ef4444" ? -1 : 1),
        eyeY,
        2.5,
        0,
        Math.PI * 2,
      );
      ctx!.fill();

      ctx!.restore();
    }

    function drawBall(b: Ball) {
      // Draw trail
      for (let t = 0; t < b.trail.length; t++) {
        const ratio = t / b.trail.length;
        ctx!.beginPath();
        ctx!.arc(b.trail[t].x, b.trail[t].y, 7 * ratio, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255, 220, 80, ${ratio * 0.35})`;
        ctx!.fill();
      }

      // Ball
      ctx!.save();
      ctx!.shadowColor = "#ffd700";
      ctx!.shadowBlur = 14;
      const grad = ctx!.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, 8);
      grad.addColorStop(0, "#fffde7");
      grad.addColorStop(0.5, "#ffd700");
      grad.addColorStop(1, "#ff9800");
      ctx!.fillStyle = grad;
      ctx!.beginPath();
      ctx!.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    function drawField() {
      // Green field
      ctx!.fillStyle = "#1a5c32";
      ctx!.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Grass stripes
      for (let i = 0; i < 8; i++) {
        ctx!.fillStyle = i % 2 === 0 ? "#1e6638" : "#1a5c32";
        ctx!.fillRect(i * 100, 0, 100, CANVAS_H);
      }

      // Center line
      ctx!.save();
      ctx!.setLineDash([12, 8]);
      ctx!.strokeStyle = "rgba(255,255,255,0.25)";
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.moveTo(CANVAS_W / 2, 0);
      ctx!.lineTo(CANVAS_W / 2, CANVAS_H);
      ctx!.stroke();
      ctx!.restore();

      // Center circle
      ctx!.save();
      ctx!.strokeStyle = "rgba(255,255,255,0.2)";
      ctx!.lineWidth = 2;
      ctx!.setLineDash([6, 6]);
      ctx!.beginPath();
      ctx!.arc(CANVAS_W / 2, CANVAS_H / 2, 60, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.restore();
    }

    function drawHitIndicators() {
      // P1 health dots
      for (let i = 0; i < MAX_HITS; i++) {
        ctx!.beginPath();
        ctx!.arc(60 + i * 18, CANVAS_H - 20, 6, 0, Math.PI * 2);
        ctx!.fillStyle = i < s.p1.hits ? "#ef4444" : "#22c55e";
        ctx!.fill();
      }
      // P2 health dots
      for (let i = 0; i < MAX_HITS; i++) {
        ctx!.beginPath();
        ctx!.arc(
          CANVAS_W - 60 - (MAX_HITS - 1 - i) * 18,
          CANVAS_H - 20,
          6,
          0,
          Math.PI * 2,
        );
        ctx!.fillStyle = i < s.p2.hits ? "#ef4444" : "#22c55e";
        ctx!.fill();
      }
    }

    function drawGameOver() {
      ctx!.fillStyle = "rgba(0,0,0,0.65)";
      ctx!.fillRect(0, 0, CANVAS_W, CANVAS_H);

      const winnerText =
        s.p1.hits >= MAX_HITS ? "⚡ PLAYER 2 WINS! ⚡" : "⚡ PLAYER 1 WINS! ⚡";

      ctx!.save();
      ctx!.font = "bold 46px 'Bricolage Grotesque', sans-serif";
      ctx!.textAlign = "center";
      ctx!.shadowColor = "#ffd700";
      ctx!.shadowBlur = 30;
      ctx!.fillStyle = "#ffd700";
      ctx!.fillText(winnerText, CANVAS_W / 2, CANVAS_H / 2 - 20);

      ctx!.shadowBlur = 0;
      ctx!.font = "22px 'Figtree', sans-serif";
      ctx!.fillStyle = "rgba(255,255,255,0.85)";
      ctx!.fillText(
        "Press  [ 1 ]  to Restart",
        CANVAS_W / 2,
        CANVAS_H / 2 + 30,
      );
      ctx!.restore();
    }

    function update() {
      if (s.gameOver) return;

      // Player 1 movement
      if (s.keys.w || s.keys.W) s.p1.y -= 5;
      if (s.keys.s || s.keys.S) s.p1.y += 5;
      s.p1.y = Math.max(0, Math.min(CANVAS_H - s.p1.h, s.p1.y));

      // Player 2 movement
      if (s.keys.ArrowUp) s.p2.y -= 5;
      if (s.keys.ArrowDown) s.p2.y += 5;
      s.p2.y = Math.max(0, Math.min(CANVAS_H - s.p2.h, s.p2.y));

      // Flash timers
      if (s.p1Flash > 0) s.p1Flash--;
      if (s.p2Flash > 0) s.p2Flash--;

      // Ball movement
      for (let i = s.balls.length - 1; i >= 0; i--) {
        const b = s.balls[i];

        // Add to trail
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 6) b.trail.shift();

        b.x += b.speed;
        b.y += b.vy;

        // Bounce off top/bottom
        if (b.y < 8 || b.y > CANVAS_H - 8) b.vy *= -1;

        // Hit Player 2
        if (
          b.speed > 0 &&
          b.x + 8 > s.p2.x &&
          b.x - 8 < s.p2.x + s.p2.w &&
          b.y + 8 > s.p2.y &&
          b.y - 8 < s.p2.y + s.p2.h
        ) {
          s.p2.hits++;
          s.p2Flash = 20;
          s.balls.splice(i, 1);
          setScore({ p1: s.p1.hits, p2: s.p2.hits });
          continue;
        }

        // Hit Player 1
        if (
          b.speed < 0 &&
          b.x + 8 > s.p1.x &&
          b.x - 8 < s.p1.x + s.p1.w &&
          b.y + 8 > s.p1.y &&
          b.y - 8 < s.p1.y + s.p1.h
        ) {
          s.p1.hits++;
          s.p1Flash = 20;
          s.balls.splice(i, 1);
          setScore({ p1: s.p1.hits, p2: s.p2.hits });
          continue;
        }

        // Out of bounds
        if (b.x < -20 || b.x > CANVAS_W + 20) {
          s.balls.splice(i, 1);
        }
      }

      if (s.p1.hits >= MAX_HITS || s.p2.hits >= MAX_HITS) {
        s.gameOver = true;
        setWinner(s.p1.hits >= MAX_HITS ? "PLAYER 2" : "PLAYER 1");
      }
    }

    function draw() {
      drawField();
      drawHitIndicators();
      drawPlayer(s.p1, "#3b82f6", s.p1Flash);
      drawPlayer(s.p2, "#ef4444", s.p2Flash);
      s.balls.forEach(drawBall);
      if (s.gameOver) drawGameOver();
    }

    function loop() {
      update();
      draw();
      s.animFrameId = requestAnimationFrame(loop);
    }

    s.animFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(s.animFrameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [resetGame]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{
        background:
          "linear-gradient(160deg, #0d0d1a 0%, #0a1a0f 50%, #0d0d1a 100%)",
      }}
    >
      {/* Title */}
      <div className="mb-4 text-center">
        <h1
          className="title-pulse text-4xl md:text-5xl font-extrabold tracking-tight uppercase"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            color: "#ffd700",
            letterSpacing: "0.08em",
          }}
        >
          🏐 Super Dodge Ball
        </h1>
        <p
          className="text-sm mt-1"
          style={{
            color: "oklch(0.65 0.04 260)",
            fontFamily: "'Figtree', sans-serif",
          }}
        >
          2 PLAYER EDITION
        </p>
      </div>

      {/* Score board */}
      <div className="score-badge flex items-center gap-6 px-6 py-3 rounded-xl mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-sm"
            style={{ background: "#3b82f6", boxShadow: "0 0 8px #3b82f6" }}
          />
          <span
            style={{
              fontFamily: "'Bricolage Grotesque', sans-serif",
              color: "white",
              fontWeight: 700,
            }}
          >
            P1 Hits:
          </span>
          <span
            className="text-xl font-black"
            style={{
              color: score.p1 > 0 ? "#ef4444" : "#22c55e",
              fontFamily: "'Bricolage Grotesque', sans-serif",
            }}
          >
            {score.p1}
          </span>
        </div>
        <div style={{ color: "oklch(0.4 0.04 260)", fontWeight: 700 }}>VS</div>
        <div className="flex items-center gap-2">
          <span
            className="text-xl font-black"
            style={{
              color: score.p2 > 0 ? "#ef4444" : "#22c55e",
              fontFamily: "'Bricolage Grotesque', sans-serif",
            }}
          >
            {score.p2}
          </span>
          <span
            style={{
              fontFamily: "'Bricolage Grotesque', sans-serif",
              color: "white",
              fontWeight: 700,
            }}
          >
            :P2 Hits
          </span>
          <div
            className="w-4 h-4 rounded-sm"
            style={{ background: "#ef4444", boxShadow: "0 0 8px #ef4444" }}
          />
        </div>
      </div>

      {/* Canvas */}
      <div
        style={{
          border: "2px solid oklch(0.35 0.08 145)",
          borderRadius: "8px",
          boxShadow:
            "0 0 40px oklch(0.4 0.15 145 / 0.4), 0 0 80px oklch(0.3 0.1 145 / 0.2)",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          id="game"
          width={CANVAS_W}
          height={CANVAS_H}
          data-ocid="game.canvas_target"
          tabIndex={0}
          style={{ display: "block" }}
        />
      </div>

      {/* Restart button (shown when game over) */}
      {winner && (
        <button
          type="button"
          onClick={resetGame}
          data-ocid="game.primary_button"
          className="mt-4 px-8 py-3 rounded-lg font-bold text-lg uppercase tracking-wide transition-all hover:scale-105 active:scale-95"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            background: "linear-gradient(135deg, #ffd700, #ff9800)",
            color: "#111",
            boxShadow: "0 0 20px rgba(255,215,0,0.5)",
          }}
        >
          🔄 Restart Game
        </button>
      )}

      {/* Controls legend */}
      <div className="mt-4 grid grid-cols-2 gap-4 w-full max-w-2xl px-4">
        <div
          className="p-4 rounded-xl"
          style={{
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.3)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ background: "#3b82f6" }}
            />
            <span
              className="font-bold text-sm uppercase tracking-wide"
              style={{
                color: "#3b82f6",
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}
            >
              Player 1 (Blue)
            </span>
          </div>
          <div
            className="text-sm space-y-1"
            style={{
              color: "rgba(255,255,255,0.75)",
              fontFamily: "'Figtree', sans-serif",
            }}
          >
            <div>
              <kbd
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                W
              </kbd>
              {" / "}
              <kbd
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                S
              </kbd>
              {" — Move Up / Down"}
            </div>
            <div>
              <kbd
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                F
              </kbd>
              {" — Throw Ball"}
            </div>
          </div>
        </div>

        <div
          className="p-4 rounded-xl"
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ background: "#ef4444" }}
            />
            <span
              className="font-bold text-sm uppercase tracking-wide"
              style={{
                color: "#ef4444",
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}
            >
              Player 2 (Red)
            </span>
          </div>
          <div
            className="text-sm space-y-1"
            style={{
              color: "rgba(255,255,255,0.75)",
              fontFamily: "'Figtree', sans-serif",
            }}
          >
            <div>
              <kbd
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                ↑
              </kbd>
              {" / "}
              <kbd
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                ↓
              </kbd>
              {" — Move Up / Down"}
            </div>
            <div>
              <kbd
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                L
              </kbd>
              {" — Throw Ball"}
            </div>
          </div>
        </div>
      </div>

      <div
        className="mt-3 text-xs"
        style={{
          color: "rgba(255,255,255,0.35)",
          fontFamily: "'Figtree', sans-serif",
        }}
      >
        First to receive{" "}
        <strong style={{ color: "rgba(255,255,255,0.55)" }}>3 hits</strong>{" "}
        loses &nbsp;•&nbsp; Press{" "}
        <kbd
          className="px-1 py-0.5 rounded"
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
          }}
        >
          1
        </kbd>{" "}
        to restart
      </div>

      {/* Footer */}
      <footer
        className="mt-6 text-xs"
        style={{
          color: "rgba(255,255,255,0.25)",
          fontFamily: "'Figtree', sans-serif",
        }}
      >
        © {new Date().getFullYear()}.{" "}
        <a
          href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
          target="_blank"
          rel="noreferrer"
          style={{
            color: "rgba(255,255,255,0.35)",
            textDecoration: "underline",
          }}
        >
          Built with ❤ using caffeine.ai
        </a>
      </footer>
    </div>
  );
}
