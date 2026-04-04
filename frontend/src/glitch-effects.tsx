import { useEffect, useRef, useState } from "react";
import { WORLD_MAP_MARKER_POSITIONS } from "./world-map-marker-positions";

interface GlitchArtifact {
  id: number;
  type: "tear" | "block" | "static";
  x: number;
  y: number;
  width: number;
  height: number;
}

const TYPES: GlitchArtifact["type"][] = ["tear", "block", "static"];
const MAX_CONCURRENT = 3;
const MIN_INTERVAL = 2000;
const MAX_INTERVAL = 6000;

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function spawnArtifact(id: number): GlitchArtifact {
  const type = TYPES[Math.floor(Math.random() * TYPES.length)];
  const x = Math.random() * 100;
  const y = Math.random() * 100;

  let width: number;
  let height: number;
  switch (type) {
    case "tear":
      width = randomBetween(100, 400);
      height = randomBetween(2, 6);
      break;
    case "block":
      width = randomBetween(30, 120);
      height = randomBetween(10, 40);
      break;
    case "static":
      width = randomBetween(20, 60);
      height = randomBetween(20, 60);
      break;
  }

  return { id, type, x, y, width, height };
}

export function GlitchEffects() {
  const [artifacts, setArtifacts] = useState<GlitchArtifact[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function scheduleNext() {
      const delay = randomBetween(MIN_INTERVAL, MAX_INTERVAL);
      timer = setTimeout(() => {
        setArtifacts((prev) => {
          if (prev.length >= MAX_CONCURRENT) return prev;
          return [...prev, spawnArtifact(nextId.current++)];
        });
        scheduleNext();
      }, delay);
    }

    scheduleNext();
    return () => clearTimeout(timer);
  }, []);

  function handleAnimationEnd(id: number) {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="glitch-container" aria-hidden="true">
      {artifacts.map((a) => (
        <div
          key={a.id}
          className={`glitch-artifact glitch-${a.type}`}
          style={{
            left: `${a.x}%`,
            top: `${a.y}%`,
            width: `${a.width}px`,
            height: `${a.height}px`,
          }}
          onAnimationEnd={() => handleAnimationEnd(a.id)}
        />
      ))}
    </div>
  );
}

/* ── Flying-dot effect ─────────────────────────────────────── */

interface FlyingDot {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  duration: number;
}

interface MapGlitchBurst {
  id: number;
  type: "tear" | "block" | "static";
  x: number;
  y: number;
  width: number;
  height: number;
}

const DOT_MAX_CONCURRENT = 2;
const DOT_MIN_INTERVAL = 2000;
const DOT_MAX_INTERVAL = 5000;
const DOT_SPEED = 800; // map-pixels per second

const flagCodes = Object.keys(WORLD_MAP_MARKER_POSITIONS);

function spawnDot(id: number): FlyingDot {
  const fromCode = flagCodes[Math.floor(Math.random() * flagCodes.length)];
  let toCode = fromCode;
  while (toCode === fromCode) {
    toCode = flagCodes[Math.floor(Math.random() * flagCodes.length)];
  }
  const from = WORLD_MAP_MARKER_POSITIONS[fromCode];
  const to = WORLD_MAP_MARKER_POSITIONS[toCode];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return {
    id,
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    duration: (distance / DOT_SPEED) * 1000,
  };
}

function spawnBurst(id: number, x: number, y: number): MapGlitchBurst {
  const type = TYPES[Math.floor(Math.random() * TYPES.length)];
  let width: number;
  let height: number;
  switch (type) {
    case "tear":
      width = randomBetween(60, 200);
      height = randomBetween(2, 5);
      break;
    case "block":
      width = randomBetween(20, 80);
      height = randomBetween(8, 30);
      break;
    case "static":
      width = randomBetween(16, 50);
      height = randomBetween(16, 50);
      break;
  }
  return { id, type, x, y, width, height };
}

export function MapFlyingDots() {
  const [dots, setDots] = useState<FlyingDot[]>([]);
  const [bursts, setBursts] = useState<MapGlitchBurst[]>([]);
  const nextDotId = useRef(0);
  const nextBurstId = useRef(0);
  const pendingArrivals = useRef<Map<number, boolean>>(new Map());

  function addBurst(x: number, y: number) {
    setBursts((prev) => [...prev, spawnBurst(nextBurstId.current++, x, y)]);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function scheduleNext() {
      const delay = randomBetween(DOT_MIN_INTERVAL, DOT_MAX_INTERVAL);
      timer = setTimeout(() => {
        setDots((prev) => {
          if (prev.length >= DOT_MAX_CONCURRENT) return prev;
          const dot = spawnDot(nextDotId.current++);
          const roll = Math.random();
          if (roll < 0.4) {
            // origin only
            addBurst(dot.fromX, dot.fromY);
          } else if (roll < 0.7) {
            // destination only — flag for arrival
            pendingArrivals.current.set(dot.id, true);
          } else {
            // both
            addBurst(dot.fromX, dot.fromY);
            pendingArrivals.current.set(dot.id, true);
          }
          return [...prev, dot];
        });
        scheduleNext();
      }, delay);
    }

    scheduleNext();
    return () => clearTimeout(timer);
  }, []);

  function handleDotEnd(dot: FlyingDot) {
    setDots((prev) => prev.filter((d) => d.id !== dot.id));
    if (pendingArrivals.current.has(dot.id)) {
      pendingArrivals.current.delete(dot.id);
      addBurst(dot.toX, dot.toY);
    }
  }

  function handleBurstEnd(id: number) {
    setBursts((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className="flying-dots-container" aria-hidden="true">
      {dots.map((d) => (
        <div
          key={d.id}
          className="flying-dot"
          style={{
            "--from-x": `${d.fromX}px`,
            "--from-y": `${d.fromY}px`,
            "--to-x": `${d.toX}px`,
            "--to-y": `${d.toY}px`,
            animationDuration: `${d.duration}ms`,
          } as React.CSSProperties}
          onAnimationEnd={() => handleDotEnd(d)}
        />
      ))}
      {bursts.map((b) => (
        <div
          key={`burst-${b.id}`}
          className={`glitch-artifact glitch-${b.type} map-glitch-burst`}
          style={{
            left: `${b.x}px`,
            top: `${b.y}px`,
            width: `${b.width}px`,
            height: `${b.height}px`,
          }}
          onAnimationEnd={() => handleBurstEnd(b.id)}
        />
      ))}
    </div>
  );
}
