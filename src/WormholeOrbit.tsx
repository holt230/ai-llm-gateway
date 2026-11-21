import { useEffect, useRef } from 'react';

// The particles follow the projection used by the static orbital illustration.
function point(radius: number, angle: number): [number, number] {
  const depth = Math.log(radius / 26) / Math.log(285 / 26);
  const x = radius * Math.cos(angle);
  const y = radius * 0.53 * Math.sin(angle);
  return [
    353 - 106 * depth + 34 * depth * depth + 0.883 * x + 0.469 * y,
    184 + 58 * depth * depth - 0.469 * x + 0.883 * y
  ];
}

// Background cosmic stars placed organically across the deep space field
const COSMIC_STARS = [
  { x: 70, y: 50, r: 0.9, speed: 1.1, phase: 0.2 },
  { x: 115, y: 105, r: 0.7, speed: 0.8, phase: 1.4 },
  { x: 160, y: 40, r: 1.2, speed: 1.4, phase: 2.1 },
  { x: 210, y: 80, r: 0.8, speed: 0.9, phase: 3.5 },
  { x: 270, y: 45, r: 1.0, speed: 1.2, phase: 0.7 },
  { x: 330, y: 65, r: 0.7, speed: 0.7, phase: 4.2 },
  { x: 420, y: 48, r: 1.1, speed: 1.3, phase: 5.1 },
  { x: 480, y: 70, r: 0.8, speed: 1.0, phase: 1.8 },
  { x: 540, y: 45, r: 1.3, speed: 1.5, phase: 2.9 },
  { x: 585, y: 95, r: 0.7, speed: 0.8, phase: 3.1 },
  { x: 595, y: 175, r: 0.9, speed: 1.1, phase: 0.5 },
  { x: 565, y: 255, r: 1.0, speed: 0.9, phase: 4.7 },
  { x: 575, y: 340, r: 0.8, speed: 1.2, phase: 2.3 },
  { x: 520, y: 385, r: 1.1, speed: 1.4, phase: 1.1 },
  { x: 450, y: 395, r: 0.7, speed: 0.7, phase: 3.8 },
  { x: 360, y: 390, r: 0.9, speed: 1.0, phase: 5.4 },
  { x: 260, y: 400, r: 1.2, speed: 1.3, phase: 0.9 },
  { x: 170, y: 375, r: 0.8, speed: 0.8, phase: 2.6 },
  { x: 95, y: 340, r: 1.0, speed: 1.1, phase: 4.0 },
  { x: 55, y: 280, r: 0.7, speed: 0.9, phase: 1.7 },
  { x: 45, y: 190, r: 0.8, speed: 1.2, phase: 3.3 },
  { x: 85, y: 140, r: 1.1, speed: 1.0, phase: 0.3 }
];

type Particle = {
  radius: number;
  angle: number;
  baseSpeed: number;
  radialSpeed: number;
  size: number;
  trail: [number, number][];
};

export function WormholeOrbit() {
  const layer = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = layer.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 780px)');

    const count = narrow.matches ? 36 : 72;
    const particles: Particle[] = Array.from({ length: count }, (_, i) => {
      const radius = 28 + Math.pow(i / count, 0.75) * 255;
      const angle = (i * 2.39996) % (Math.PI * 2);
      const baseSpeed = 0.85 + (i % 7) * 0.08;
      const radialSpeed = 2.6 + (i % 5) * 0.6;
      const size = 0.85 + (i % 6) * 0.26;
      const omega = (baseSpeed * 2.5) / Math.sqrt(radius);

      const trail: [number, number][] = [];
      for (let t = 0; t < 5; t++) {
        const pastAngle = angle - omega * (t + 1) * 0.035;
        const pastRadius = Math.min(285, radius + radialSpeed * (t + 1) * 0.035);
        trail.push(point(pastRadius, pastAngle));
      }

      return {
        radius,
        angle,
        baseSpeed,
        radialSpeed,
        size,
        trail
      };
    });

    let visible = false;
    let frame = 0;
    let lastTime = 0;
    let totalTime = 0;

    function paint(dt: number) {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, 620, 420);

      // 1. Core Accretion Disk Ambient Glow
      const coreGlow = ctx.createRadialGradient(351.34, 184.01, 6, 351.34, 184.01, 110);
      coreGlow.addColorStop(0, 'rgba(252, 205, 132, 0.28)');
      coreGlow.addColorStop(0.28, 'rgba(240, 180, 95, 0.16)');
      coreGlow.addColorStop(0.65, 'rgba(145, 195, 222, 0.06)');
      coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(351.34, 184.01, 110, 0, Math.PI * 2);
      ctx.fill();

      // 2. Event Horizon Photon Ring (inner rim accent)
      ctx.save();
      ctx.translate(351.34, 184.01);
      ctx.rotate((-28 * Math.PI) / 180);
      ctx.beginPath();
      ctx.ellipse(0, 0, 27.2, 14.4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 232, 185, 0.42)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();

      // 3. Ambient Deep-Space Celestial Stars (smooth twinkle, no clipping)
      for (let i = 0; i < COSMIC_STARS.length; i++) {
        const s = COSMIC_STARS[i];
        const alpha = Math.max(0.12, 0.28 + 0.38 * Math.sin(totalTime * s.speed + s.phase));
        ctx.fillStyle = s.r > 1.0 ? `rgba(248, 225, 188, ${alpha})` : `rgba(182, 218, 235, ${alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Inward Accretion Stream Particles with Luminous Tails
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Keplerian orbital acceleration: faster near the center
        const omega = (p.baseSpeed * 2.5) / Math.sqrt(p.radius);
        p.angle += omega * dt;
        p.radius -= p.radialSpeed * dt;

        // When plunged into event horizon, rebirth at outer rim
        if (p.radius < 26.5) {
          p.radius = 274 + Math.random() * 11;
          p.angle = Math.random() * Math.PI * 2;
          p.trail = [];
        }

        const [x, y] = point(p.radius, p.angle);

        // Record trail history
        p.trail.unshift([x, y]);
        if (p.trail.length > 6) p.trail.pop();

        // Warmth factor based on disk orientation (warm illuminated top-right, cooler bottom-left)
        const warmth = Math.max(0, Math.min(1, (Math.cos(p.angle - 0.35) + 1) / 2));
        const nearCore = Math.max(0, 1 - (p.radius - 26) / 90);
        const warmFactor = Math.min(1, warmth * 0.8 + nearCore * 0.7);

        // Draw luminous tapered trail
        if (p.trail.length > 1) {
          for (let j = 0; j < p.trail.length - 1; j++) {
            const segAlpha = (1 - j / p.trail.length) * 0.52;
            const pt1 = p.trail[j];
            const pt2 = p.trail[j + 1];
            ctx.strokeStyle = warmFactor > 0.4
              ? `rgba(247, 194, 125, ${segAlpha})`
              : `rgba(165, 206, 226, ${segAlpha})`;
            ctx.lineWidth = p.size * (1 - j * 0.14);
            ctx.beginPath();
            ctx.moveTo(pt1[0], pt1[1]);
            ctx.lineTo(pt2[0], pt2[1]);
            ctx.stroke();
          }
        }

        // Particle head glow
        if (p.size > 1.25 || nearCore > 0.4) {
          ctx.fillStyle = warmFactor > 0.4
            ? 'rgba(255, 205, 130, 0.28)'
            : 'rgba(180, 225, 245, 0.25)';
          ctx.beginPath();
          ctx.arc(x, y, p.size * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Particle core
        ctx.fillStyle = nearCore > 0.6
          ? '#fff9ee'
          : warmFactor > 0.4
            ? '#fedca8'
            : '#d2effa';
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(now: number) {
      if (!lastTime) lastTime = now;
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      totalTime += dt;

      paint(dt);
      if (visible && !motion.matches) {
        frame = requestAnimationFrame(tick);
      }
    }

    function sync() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (!visible || document.hidden) return;
      paint(0.016);
      if (!motion.matches) frame = requestAnimationFrame(tick);
    }

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      ctx.setTransform(canvas.width / 620, 0, 0, canvas.height / 420, 0, 0);
      sync();
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    const dimensions = new ResizeObserver(resize);
    observer.observe(canvas);
    dimensions.observe(canvas);

    motion.addEventListener('change', sync);
    narrow.addEventListener('change', resize);
    document.addEventListener('visibilitychange', sync);

    resize();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dimensions.disconnect();
      motion.removeEventListener('change', sync);
      narrow.removeEventListener('change', resize);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return (
    <div className="orbit-art" aria-hidden="true">
      <img className="hero-orbit" src="/wormhole-orbit.svg" width="620" height="420" alt="" />
      <canvas ref={layer} className="orbit-particles" />
    </div>
  );
}
