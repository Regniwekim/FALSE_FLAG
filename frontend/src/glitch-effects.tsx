import { useEffect, useRef, useState } from "react";

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
