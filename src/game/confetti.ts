import confetti from 'canvas-confetti';

const fire = (opts: confetti.Options) => {
  void confetti({ disableForReducedMotion: true, zIndex: 400, ...opts });
};

export function burst(colors: string[], origin = { x: 0.5, y: 0.45 }) {
  fire({ particleCount: 70, spread: 75, startVelocity: 38, scalar: 0.9, colors, origin, ticks: 160 });
}

export function celebrate(colors: string[]) {
  const end = Date.now() + 1600;
  const frame = () => {
    fire({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, startVelocity: 55 });
    fire({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, startVelocity: 55 });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
  setTimeout(() => fire({ particleCount: 140, spread: 110, startVelocity: 45, origin: { x: 0.5, y: 0.35 }, colors, scalar: 1.1 }), 300);
}
