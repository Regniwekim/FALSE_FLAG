/**
 * Retro 8-bit audio synthesis utilities for game events.
 * Creates simple square-wave bleeps without external assets.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
}

function playTone(frequency: number, duration: number, type: "square" | "sine" = "square") {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Audio context may not be available or user denied access; silently continue.
  }
}

export function playIncomingQuestion() {
  // Ascending two-tone beep for incoming question
  playTone(440, 0.15);
  setTimeout(() => playTone(550, 0.15), 100);
}

export function playTurnChange() {
  // Short pulsing tone for turn change
  playTone(330, 0.1);
  setTimeout(() => playTone(330, 0.1), 120);
}

export function playRoundOver() {
  // Descending fanfare for round over
  playTone(600, 0.1);
  setTimeout(() => playTone(500, 0.15), 120);
  setTimeout(() => playTone(400, 0.2), 280);
}

export function playCorrectGuess() {
  // Ascending victory chime
  playTone(500, 0.1);
  setTimeout(() => playTone(600, 0.1), 100);
  setTimeout(() => playTone(700, 0.2), 200);
}

export function playWrongGuess() {
  // Descending error tone
  playTone(400, 0.1);
  setTimeout(() => playTone(300, 0.15), 100);
  setTimeout(() => playTone(200, 0.2), 260);
}

export function playButtonClick() {
  // Short click for UI interactions
  playTone(880, 0.05);
}
