import { useCallback, useEffect, useRef, useState } from "react";
import { useActor } from "./hooks/useActor";

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

type GameMode = "2p" | "ai" | "online";

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
  mode: GameMode;
}

const CANVAS_W = 800;
const CANVAS_H = 400;
const COOLDOWN = 750;
const MAX_HITS = 3;
const BALL_SPEED = 7;
const AI_SPEED = 3.2;
const AI_THROW_COOLDOWN = 900;

function makeInitialState(mode: GameMode): GameState {
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
    mode,
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<GameMode>("2p");
  const stateRef = useRef<GameState>(makeInitialState("2p"));
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [winner, setWinner] = useState<string | null>(null);

  // Online multiplayer state
  const { actor } = useActor();
  const actorRef = useRef(actor);
  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  type OnlineScreen = "lobby" | "waiting" | "ingame";
  const [onlineScreen, setOnlineScreen] = useState<OnlineScreen>("lobby");
  const [playerRole, setPlayerRole] = useState<"host" | "guest" | null>(null);
  const [roomCode, setRoomCode] = useState<string>("");
  const [codeInput, setCodeInput] = useState<string>("");
  const [onlineLoading, setOnlineLoading] = useState<
    false | "creating" | "joining"
  >(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  // Refs for online sync (avoid stale closures in intervals)
  const onlineRoleRef = useRef<"host" | "guest" | null>(null);
  const roomCodeRef = useRef<string>("");
  const p2ThrowPendingRef = useRef(false);
  const latestServerStateRef = useRef<{
    p1Y: number;
    p2Y: number;
    balls: Array<{ x: number; y: number; vy: number; speed: number }>;
    p1Hits: number;
    p2Hits: number;
    gameOver: boolean;
    winner: string;
    p2Joined: boolean;
    p2ThrowBall: boolean;
  } | null>(null);

  const resetGame = useCallback((newMode?: GameMode) => {
    const m = newMode ?? stateRef.current.mode;
    const s = stateRef.current;
    const fresh = makeInitialState(m);
    s.p1 = fresh.p1;
    s.p2 = fresh.p2;
    s.balls = fresh.balls;
    s.gameOver = false;
    s.lastThrow1 = 0;
    s.lastThrow2 = 0;
    s.p1Flash = 0;
    s.p2Flash = 0;
    s.mode = m;
    setScore({ p1: 0, p2: 0 });
    setWinner(null);
    latestServerStateRef.current = null;
  }, []);

  const switchMode = useCallback(
    (m: GameMode) => {
      setMode(m);
      stateRef.current.mode = m;
      resetGame(m);
      if (m === "online") {
        setOnlineScreen("lobby");
        setPlayerRole(null);
        setRoomCode("");
        setCodeInput("");
        setOnlineError(null);
        setConnectionLost(false);
        onlineRoleRef.current = null;
        roomCodeRef.current = "";
      }
    },
    [resetGame],
  );

  // Online: Create room (P1 / host)
  const handleCreateRoom = useCallback(async () => {
    const a = actorRef.current;
    if (!a) return;
    setOnlineLoading("creating");
    setOnlineError(null);
    try {
      const code = await a.createRoom();
      setRoomCode(code);
      roomCodeRef.current = code;
      setPlayerRole("host");
      onlineRoleRef.current = "host";
      setOnlineScreen("waiting");
      resetGame("online");
    } catch {
      setOnlineError("Failed to create room. Try again.");
    } finally {
      setOnlineLoading(false);
    }
  }, [resetGame]);

  // Online: Join room (P2 / guest)
  const handleJoinRoom = useCallback(async () => {
    const a = actorRef.current;
    if (!a || !codeInput.trim()) return;
    const code = codeInput.trim().toUpperCase();
    setOnlineLoading("joining");
    setOnlineError(null);
    try {
      const ok = await a.joinRoom(code);
      if (!ok) {
        setOnlineError("Room not found or already full.");
        return;
      }
      setRoomCode(code);
      roomCodeRef.current = code;
      setPlayerRole("guest");
      onlineRoleRef.current = "guest";
      resetGame("online");
      setOnlineScreen("ingame");
    } catch {
      setOnlineError("Failed to join room. Try again.");
    } finally {
      setOnlineLoading(false);
    }
  }, [codeInput, resetGame]);

  // Online: copy room code to clipboard
  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomCode]);

  // Online: waiting room polling (P1 waits for P2 to join)
  useEffect(() => {
    if (
      mode !== "online" ||
      onlineScreen !== "waiting" ||
      playerRole !== "host"
    )
      return;
    const interval = setInterval(async () => {
      const a = actorRef.current;
      if (!a) return;
      try {
        const state = await a.getState(roomCodeRef.current);
        if (state?.p2Joined) {
          setOnlineScreen("ingame");
        }
      } catch {
        // ignore poll errors
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [mode, onlineScreen, playerRole]);

  // Online: game sync interval
  // Push and pull run in parallel to halve the per-tick latency.
  useEffect(() => {
    if (mode !== "online" || onlineScreen !== "ingame") return;

    let syncing = false;

    const interval = setInterval(async () => {
      if (syncing) return; // skip tick if previous one is still in-flight
      const a = actorRef.current;
      const code = roomCodeRef.current;
      const role = onlineRoleRef.current;
      const s = stateRef.current;
      if (!a || !code || !role) return;

      syncing = true;
      try {
        if (role === "host") {
          const ballData = s.balls.map((b) => ({
            x: b.x,
            y: b.y,
            vy: b.vy,
            speed: b.speed,
          }));
          // Push and pull in parallel
          const [, serverState] = await Promise.all([
            a.pushHostState(
              code,
              s.p1.y,
              s.p2.y,
              ballData,
              BigInt(s.p1.hits),
              BigInt(s.p2.hits),
              s.gameOver,
              s.gameOver
                ? s.p2.hits >= MAX_HITS
                  ? "PLAYER 1"
                  : "PLAYER 2"
                : "",
            ),
            a.getState(code),
          ]);
          if (serverState) {
            latestServerStateRef.current = {
              ...serverState,
              p1Hits: Number(serverState.p1Hits),
              p2Hits: Number(serverState.p2Hits),
            };
          } else {
            setConnectionLost(true);
          }
        } else {
          const throwNow = p2ThrowPendingRef.current;
          p2ThrowPendingRef.current = false;
          // Push and pull in parallel
          const [, serverState] = await Promise.all([
            a.pushGuestInput(code, s.p2.y, throwNow),
            a.getState(code),
          ]);
          if (serverState) {
            latestServerStateRef.current = {
              ...serverState,
              p1Hits: Number(serverState.p1Hits),
              p2Hits: Number(serverState.p2Hits),
            };
          } else {
            setConnectionLost(true);
          }
        }
      } catch {
        // ignore transient errors
      } finally {
        syncing = false;
      }
    }, 80);

    return () => clearInterval(interval);
  }, [mode, onlineScreen]);

  // Main game loop
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
        // P1 throw: only in 2p, ai, or online-host
        const isOnlineHost =
          s.mode === "online" && onlineRoleRef.current === "host";
        const canP1Throw = s.mode !== "online" || isOnlineHost;
        if (canP1Throw && now - s.lastThrow1 > COOLDOWN) {
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
        if (s.mode === "2p") {
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
        } else if (s.mode === "online" && onlineRoleRef.current === "guest") {
          // Guest flags throw; interval will send it
          p2ThrowPendingRef.current = true;
        }
      }

      if (e.key === "1") {
        if (s.mode !== "online") resetGame();
      }

      if (["ArrowUp", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      s.keys[e.key] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- AI logic ----
    function updateAI() {
      if (s.gameOver || s.mode !== "ai") return;
      const now = Date.now();
      const ai = s.p2;
      const p1 = s.p1;

      let threatBall: Ball | null = null;
      let minDist = Number.POSITIVE_INFINITY;
      for (const b of s.balls) {
        if (b.speed > 0) {
          const dist = ai.x - b.x;
          if (dist > 0 && dist < minDist) {
            minDist = dist;
            threatBall = b;
          }
        }
      }

      let targetY: number;
      if (threatBall && minDist < 350) {
        const timeToReach = minDist / Math.abs(threatBall.speed);
        const predictedY = threatBall.y + threatBall.vy * timeToReach;
        const aiMid = ai.y + ai.h / 2;
        targetY = predictedY < aiMid ? ai.y + ai.h : ai.y - ai.h;
      } else {
        targetY = p1.y + p1.h / 2 - ai.h / 2;
      }

      const aiMid = ai.y + ai.h / 2;
      const targetMid = targetY + ai.h / 2;
      if (Math.abs(aiMid - targetMid) > 4) {
        ai.y += aiMid < targetMid ? AI_SPEED : -AI_SPEED;
      }
      ai.y = Math.max(0, Math.min(CANVAS_H - ai.h, ai.y));

      const aligned = Math.abs(ai.y + ai.h / 2 - (p1.y + p1.h / 2)) < 40;
      if (aligned && now - s.lastThrow2 > AI_THROW_COOLDOWN) {
        if (Math.random() < 0.3) {
          s.balls.push({
            x: ai.x - 4,
            y: ai.y + ai.h / 2,
            speed: -BALL_SPEED,
            vy: (Math.random() - 0.5) * 2,
            trail: [],
          });
          s.lastThrow2 = now;
        }
      }
    }

    function drawPlayer(
      p: Player,
      color: string,
      flash: number,
      label?: string,
    ) {
      const alpha =
        flash > 0 && Math.floor(Date.now() / 80) % 2 === 0 ? 0.35 : 1;
      ctx!.save();
      ctx!.globalAlpha = alpha;
      ctx!.shadowColor = color;
      ctx!.shadowBlur = 18;
      ctx!.fillStyle = color;
      ctx!.beginPath();
      ctx!.roundRect(p.x, p.y, p.w, p.h, 6);
      ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.fillStyle = "rgba(255,255,255,0.25)";
      ctx!.beginPath();
      ctx!.roundRect(p.x + 6, p.y + 6, p.w - 12, 10, 3);
      ctx!.fill();
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
      if (label) {
        ctx!.globalAlpha = 0.9;
        ctx!.font = "bold 10px sans-serif";
        ctx!.textAlign = "center";
        ctx!.fillStyle = "#ffd700";
        ctx!.shadowColor = "#000";
        ctx!.shadowBlur = 4;
        ctx!.fillText(label, p.x + p.w / 2, p.y - 6);
        ctx!.shadowBlur = 0;
      }
      ctx!.restore();
    }

    function drawBall(b: Ball) {
      for (let t = 0; t < b.trail.length; t++) {
        const ratio = t / b.trail.length;
        ctx!.beginPath();
        ctx!.arc(b.trail[t].x, b.trail[t].y, 7 * ratio, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255, 220, 80, ${ratio * 0.35})`;
        ctx!.fill();
      }
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
      ctx!.fillStyle = "#1a5c32";
      ctx!.fillRect(0, 0, CANVAS_W, CANVAS_H);
      for (let i = 0; i < 8; i++) {
        ctx!.fillStyle = i % 2 === 0 ? "#1e6638" : "#1a5c32";
        ctx!.fillRect(i * 100, 0, 100, CANVAS_H);
      }
      ctx!.save();
      ctx!.setLineDash([12, 8]);
      ctx!.strokeStyle = "rgba(255,255,255,0.25)";
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.moveTo(CANVAS_W / 2, 0);
      ctx!.lineTo(CANVAS_W / 2, CANVAS_H);
      ctx!.stroke();
      ctx!.restore();
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
      for (let i = 0; i < MAX_HITS; i++) {
        ctx!.beginPath();
        ctx!.arc(60 + i * 18, CANVAS_H - 20, 6, 0, Math.PI * 2);
        ctx!.fillStyle = i < s.p1.hits ? "#ef4444" : "#22c55e";
        ctx!.fill();
      }
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
      const isAI = s.mode === "ai";
      const winnerText =
        s.p1.hits >= MAX_HITS
          ? isAI
            ? "⚡ AI WINS! ⚡"
            : "⚡ PLAYER 2 WINS! ⚡"
          : "⚡ PLAYER 1 WINS! ⚡";
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
      if (s.mode !== "online") {
        ctx!.fillText(
          "Press  [ 1 ]  to Restart",
          CANVAS_W / 2,
          CANVAS_H / 2 + 30,
        );
      }
      ctx!.restore();
    }

    function updateOnlineHost() {
      if (s.gameOver) return;
      // P1 movement
      if (s.keys.w || s.keys.W) s.p1.y -= 5;
      if (s.keys.s || s.keys.S) s.p1.y += 5;
      s.p1.y = Math.max(0, Math.min(CANVAS_H - s.p1.h, s.p1.y));

      // P2 position from server
      const srv = latestServerStateRef.current;
      if (srv) {
        s.p2.y = srv.p2Y;
        if (srv.p2ThrowBall) {
          const now = Date.now();
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
      }

      s.p2.y = Math.max(0, Math.min(CANVAS_H - s.p2.h, s.p2.y));
    }

    function updateOnlineGuest() {
      // Guest controls P2 locally for responsiveness
      if (s.keys.ArrowUp) s.p2.y -= 5;
      if (s.keys.ArrowDown) s.p2.y += 5;
      s.p2.y = Math.max(0, Math.min(CANVAS_H - s.p2.h, s.p2.y));

      // Override authoritative state from server
      const srv = latestServerStateRef.current;
      if (srv) {
        s.p1.y = srv.p1Y;
        // Rebuild balls from server (preserve no trail — fresh each frame)
        s.balls = srv.balls.map((b) => ({
          x: b.x,
          y: b.y,
          speed: b.speed,
          vy: b.vy,
          trail: [],
        }));
        const newP1Hits = srv.p1Hits;
        const newP2Hits = srv.p2Hits;
        if (newP1Hits !== s.p1.hits || newP2Hits !== s.p2.hits) {
          s.p1.hits = newP1Hits;
          s.p2.hits = newP2Hits;
          setScore({ p1: s.p1.hits, p2: s.p2.hits });
        }
        if (srv.gameOver && !s.gameOver) {
          s.gameOver = true;
          setWinner(srv.winner || "PLAYER 1");
        }
      }
    }

    function update() {
      if (s.gameOver) return;

      if (s.mode === "online") {
        if (onlineRoleRef.current === "host") {
          updateOnlineHost();
          // Run physics for balls (host is authoritative)
        } else if (onlineRoleRef.current === "guest") {
          updateOnlineGuest();
          // Guest doesn't run physics — just renders server state
          if (s.p1Flash > 0) s.p1Flash--;
          if (s.p2Flash > 0) s.p2Flash--;
          return;
        }
      } else if (s.mode === "2p") {
        if (s.keys.w || s.keys.W) s.p1.y -= 5;
        if (s.keys.s || s.keys.S) s.p1.y += 5;
        s.p1.y = Math.max(0, Math.min(CANVAS_H - s.p1.h, s.p1.y));
        if (s.keys.ArrowUp) s.p2.y -= 5;
        if (s.keys.ArrowDown) s.p2.y += 5;
        s.p2.y = Math.max(0, Math.min(CANVAS_H - s.p2.h, s.p2.y));
      } else {
        // AI mode
        if (s.keys.w || s.keys.W) s.p1.y -= 5;
        if (s.keys.s || s.keys.S) s.p1.y += 5;
        s.p1.y = Math.max(0, Math.min(CANVAS_H - s.p1.h, s.p1.y));
        updateAI();
      }

      if (s.p1Flash > 0) s.p1Flash--;
      if (s.p2Flash > 0) s.p2Flash--;

      for (let i = s.balls.length - 1; i >= 0; i--) {
        const b = s.balls[i];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 6) b.trail.shift();
        b.x += b.speed;
        b.y += b.vy;
        if (b.y < 8 || b.y > CANVAS_H - 8) b.vy *= -1;

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

        if (b.x < -20 || b.x > CANVAS_W + 20) {
          s.balls.splice(i, 1);
        }
      }

      if (s.p1.hits >= MAX_HITS || s.p2.hits >= MAX_HITS) {
        s.gameOver = true;
        const isAI = s.mode === "ai";
        setWinner(
          s.p1.hits >= MAX_HITS ? (isAI ? "AI" : "PLAYER 2") : "PLAYER 1",
        );
      }
    }

    function draw() {
      drawField();
      drawHitIndicators();
      drawPlayer(s.p1, "#3b82f6", s.p1Flash);
      drawPlayer(
        s.p2,
        "#ef4444",
        s.p2Flash,
        s.mode === "ai" ? "AI" : undefined,
      );
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

  const kbdStyle = {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
  };

  const isOnlineActive = mode === "online";
  const showCanvas = !isOnlineActive || onlineScreen === "ingame";

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
          {mode === "2p"
            ? "2 PLAYER EDITION"
            : mode === "ai"
              ? "VS AI EDITION"
              : "ONLINE MULTIPLAYER"}
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          data-ocid="game.tab.1"
          onClick={() => switchMode("2p")}
          className="px-5 py-2 rounded-lg font-bold text-sm uppercase tracking-wide transition-all"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            background:
              mode === "2p"
                ? "linear-gradient(135deg,#3b82f6,#1d4ed8)"
                : "rgba(255,255,255,0.07)",
            color: mode === "2p" ? "white" : "rgba(255,255,255,0.5)",
            border:
              mode === "2p"
                ? "1px solid #3b82f6"
                : "1px solid rgba(255,255,255,0.15)",
            boxShadow:
              mode === "2p" ? "0 0 14px rgba(59,130,246,0.45)" : "none",
          }}
        >
          👥 2 Player
        </button>
        <button
          type="button"
          data-ocid="game.tab.2"
          onClick={() => switchMode("ai")}
          className="px-5 py-2 rounded-lg font-bold text-sm uppercase tracking-wide transition-all"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            background:
              mode === "ai"
                ? "linear-gradient(135deg,#ef4444,#b91c1c)"
                : "rgba(255,255,255,0.07)",
            color: mode === "ai" ? "white" : "rgba(255,255,255,0.5)",
            border:
              mode === "ai"
                ? "1px solid #ef4444"
                : "1px solid rgba(255,255,255,0.15)",
            boxShadow: mode === "ai" ? "0 0 14px rgba(239,68,68,0.45)" : "none",
          }}
        >
          🤖 vs AI
        </button>
        <button
          type="button"
          data-ocid="game.tab.3"
          onClick={() => switchMode("online")}
          className="px-5 py-2 rounded-lg font-bold text-sm uppercase tracking-wide transition-all"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            background:
              mode === "online"
                ? "linear-gradient(135deg,#22c55e,#15803d)"
                : "rgba(255,255,255,0.07)",
            color: mode === "online" ? "white" : "rgba(255,255,255,0.5)",
            border:
              mode === "online"
                ? "1px solid #22c55e"
                : "1px solid rgba(255,255,255,0.15)",
            boxShadow:
              mode === "online" ? "0 0 14px rgba(34,197,94,0.45)" : "none",
          }}
        >
          🌐 Online
        </button>
      </div>

      {/* Score board */}
      {(!isOnlineActive || onlineScreen === "ingame") && (
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
          <div style={{ color: "oklch(0.4 0.04 260)", fontWeight: 700 }}>
            VS
          </div>
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
              :{mode === "ai" ? "AI Hits" : "P2 Hits"}
            </span>
            <div
              className="w-4 h-4 rounded-sm"
              style={{ background: "#ef4444", boxShadow: "0 0 8px #ef4444" }}
            />
          </div>
        </div>
      )}

      {/* Canvas area */}
      <div
        style={{
          border: "2px solid oklch(0.35 0.08 145)",
          borderRadius: "8px",
          boxShadow:
            "0 0 40px oklch(0.4 0.15 145 / 0.4), 0 0 80px oklch(0.3 0.1 145 / 0.2)",
          overflow: "hidden",
          width: CANVAS_W,
          minHeight: showCanvas ? undefined : CANVAS_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Canvas — always rendered so game loop stays alive */}
        <canvas
          ref={canvasRef}
          id="game"
          width={CANVAS_W}
          height={CANVAS_H}
          data-ocid="game.canvas_target"
          tabIndex={0}
          style={{ display: showCanvas ? "block" : "none" }}
        />

        {/* Online Lobby */}
        {isOnlineActive && onlineScreen === "lobby" && (
          <div
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              background: "linear-gradient(135deg, #0a1a0f 0%, #0d1a2a 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 32,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🌐</div>
              <h2
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  color: "#ffd700",
                  fontSize: 28,
                  fontWeight: 800,
                  margin: 0,
                }}
              >
                Online Multiplayer
              </h2>
              <p
                style={{
                  fontFamily: "'Figtree', sans-serif",
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 14,
                  marginTop: 6,
                }}
              >
                Play with a friend anywhere in the world
              </p>
            </div>

            {onlineError && (
              <div
                data-ocid="online.error_state"
                style={{
                  background: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.4)",
                  borderRadius: 8,
                  padding: "10px 20px",
                  color: "#ef4444",
                  fontFamily: "'Figtree', sans-serif",
                  fontSize: 14,
                }}
              >
                {onlineError}
              </div>
            )}

            <div style={{ display: "flex", gap: 24 }}>
              {/* Create Game */}
              <div
                style={{
                  background: "rgba(59,130,246,0.12)",
                  border: "1px solid rgba(59,130,246,0.35)",
                  borderRadius: 16,
                  padding: "28px 36px",
                  textAlign: "center",
                  minWidth: 200,
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎮</div>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    color: "white",
                    fontWeight: 700,
                    fontSize: 16,
                    marginBottom: 6,
                  }}
                >
                  Create Game
                </div>
                <div
                  style={{
                    fontFamily: "'Figtree', sans-serif",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  Get a room code to share
                </div>
                <button
                  type="button"
                  data-ocid="online.primary_button"
                  disabled={onlineLoading === "creating"}
                  onClick={handleCreateRoom}
                  style={{
                    background:
                      onlineLoading === "creating"
                        ? "rgba(59,130,246,0.4)"
                        : "linear-gradient(135deg,#3b82f6,#1d4ed8)",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 24px",
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: onlineLoading === "creating" ? "wait" : "pointer",
                    boxShadow: "0 0 14px rgba(59,130,246,0.35)",
                    width: "100%",
                  }}
                >
                  {onlineLoading === "creating" ? "Creating..." : "Create Room"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: "rgba(255,255,255,0.25)",
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  fontWeight: 700,
                }}
              >
                OR
              </div>

              {/* Join Game */}
              <div
                style={{
                  background: "rgba(34,197,94,0.1)",
                  border: "1px solid rgba(34,197,94,0.3)",
                  borderRadius: 16,
                  padding: "28px 36px",
                  textAlign: "center",
                  minWidth: 200,
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔗</div>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    color: "white",
                    fontWeight: 700,
                    fontSize: 16,
                    marginBottom: 6,
                  }}
                >
                  Join Game
                </div>
                <div
                  style={{
                    fontFamily: "'Figtree', sans-serif",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  Enter a friend&apos;s room code
                </div>
                <input
                  type="text"
                  data-ocid="online.input"
                  value={codeInput}
                  onChange={(e) =>
                    setCodeInput(e.target.value.toUpperCase().slice(0, 6))
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                  placeholder="XXXXXX"
                  maxLength={6}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(34,197,94,0.35)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    color: "#ffd700",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: "0.25em",
                    textAlign: "center",
                    width: "100%",
                    marginBottom: 12,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  data-ocid="online.submit_button"
                  disabled={onlineLoading === "joining" || codeInput.length < 6}
                  onClick={handleJoinRoom}
                  style={{
                    background:
                      onlineLoading === "joining" || codeInput.length < 6
                        ? "rgba(34,197,94,0.3)"
                        : "linear-gradient(135deg,#22c55e,#15803d)",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 24px",
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor:
                      onlineLoading === "joining" || codeInput.length < 6
                        ? "not-allowed"
                        : "pointer",
                    boxShadow:
                      codeInput.length === 6
                        ? "0 0 14px rgba(34,197,94,0.35)"
                        : "none",
                    width: "100%",
                  }}
                >
                  {onlineLoading === "joining" ? "Joining..." : "Join Room"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Waiting Screen */}
        {isOnlineActive && onlineScreen === "waiting" && (
          <div
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              background: "linear-gradient(135deg, #0a1a0f 0%, #0d1a2a 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 28,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>📋</div>
              <h2
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  color: "#ffd700",
                  fontSize: 26,
                  fontWeight: 800,
                  margin: 0,
                }}
              >
                Room Created!
              </h2>
              <p
                style={{
                  fontFamily: "'Figtree', sans-serif",
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 14,
                  marginTop: 6,
                }}
              >
                Share this code with your friend
              </p>
            </div>

            <button
              type="button"
              data-ocid="online.primary_button"
              onClick={handleCopyCode}
              title="Click to copy"
              style={{
                background: "rgba(255,215,0,0.08)",
                border: "2px solid rgba(255,215,0,0.5)",
                borderRadius: 16,
                padding: "20px 40px",
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: "0 0 30px rgba(255,215,0,0.2)",
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 48,
                  fontWeight: 700,
                  color: "#ffd700",
                  letterSpacing: "0.3em",
                  textShadow: "0 0 20px rgba(255,215,0,0.6)",
                }}
              >
                {roomCode}
              </div>
              <div
                style={{
                  fontFamily: "'Figtree', sans-serif",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 12,
                  marginTop: 8,
                  textAlign: "center",
                }}
              >
                {copied ? "✅ Copied!" : "Click to copy"}
              </div>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#22c55e",
                      animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
              <span
                style={{
                  fontFamily: "'Figtree', sans-serif",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 15,
                }}
              >
                Waiting for Player 2...
              </span>
            </div>

            <button
              type="button"
              data-ocid="online.cancel_button"
              onClick={() => {
                setOnlineScreen("lobby");
                setPlayerRole(null);
                setRoomCode("");
                onlineRoleRef.current = null;
                roomCodeRef.current = "";
              }}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 8,
                padding: "8px 20px",
                color: "rgba(255,255,255,0.4)",
                fontFamily: "'Figtree', sans-serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Restart button (non-online) */}
      {winner && mode !== "online" && (
        <button
          type="button"
          onClick={() => resetGame()}
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

      {/* Online game over — back to lobby */}
      {winner && mode === "online" && (
        <button
          type="button"
          onClick={() => {
            switchMode("online");
          }}
          data-ocid="online.secondary_button"
          className="mt-4 px-8 py-3 rounded-lg font-bold text-lg uppercase tracking-wide transition-all hover:scale-105 active:scale-95"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            background: "linear-gradient(135deg, #ffd700, #ff9800)",
            color: "#111",
            boxShadow: "0 0 20px rgba(255,215,0,0.5)",
          }}
        >
          🔄 Play Again
        </button>
      )}

      {/* Connection lost banner */}
      {connectionLost && mode === "online" && onlineScreen === "ingame" && (
        <div
          data-ocid="online.error_state"
          className="mt-3"
          style={{
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 8,
            padding: "8px 20px",
            color: "#ef4444",
            fontFamily: "'Figtree', sans-serif",
            fontSize: 14,
          }}
        >
          ⚠️ Connection lost — attempting to reconnect...
        </div>
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
              {mode === "online" && playerRole === "guest"
                ? "Player 1 (Blue) — Opponent"
                : "Player 1 (Blue)"}
            </span>
          </div>
          {mode === "online" && playerRole === "guest" ? (
            <div
              className="text-sm"
              style={{
                color: "rgba(255,255,255,0.45)",
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              Controlled by your opponent online
            </div>
          ) : (
            <div
              className="text-sm space-y-1"
              style={{
                color: "rgba(255,255,255,0.75)",
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              <div>
                <kbd className="px-1.5 py-0.5 rounded text-xs" style={kbdStyle}>
                  W
                </kbd>
                {" / "}
                <kbd className="px-1.5 py-0.5 rounded text-xs" style={kbdStyle}>
                  S
                </kbd>
                {" — Move Up / Down"}
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded text-xs" style={kbdStyle}>
                  F
                </kbd>
                {" — Throw Ball"}
              </div>
            </div>
          )}
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
              {mode === "ai"
                ? "AI Opponent 🤖"
                : mode === "online" && playerRole === "host"
                  ? "Player 2 (Red) — Opponent"
                  : "Player 2 (Red)"}
            </span>
          </div>
          {mode === "ai" ? (
            <div
              className="text-sm"
              style={{
                color: "rgba(255,255,255,0.55)",
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              Controlled by the computer. Good luck!
            </div>
          ) : mode === "online" && playerRole === "host" ? (
            <div
              className="text-sm"
              style={{
                color: "rgba(255,255,255,0.45)",
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              Controlled by your opponent online
            </div>
          ) : (
            <div
              className="text-sm space-y-1"
              style={{
                color: "rgba(255,255,255,0.75)",
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              <div>
                <kbd className="px-1.5 py-0.5 rounded text-xs" style={kbdStyle}>
                  ↑
                </kbd>
                {" / "}
                <kbd className="px-1.5 py-0.5 rounded text-xs" style={kbdStyle}>
                  ↓
                </kbd>
                {" — Move Up / Down"}
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded text-xs" style={kbdStyle}>
                  L
                </kbd>
                {" — Throw Ball"}
              </div>
            </div>
          )}
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
        loses
        {mode !== "online" && (
          <>
            {" "}
            &nbsp;•&nbsp; Press{" "}
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
          </>
        )}
      </div>

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

      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
