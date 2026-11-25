import { useEffect, useRef } from 'react';
import { createFluidCursor } from './fluid-cursor';

const FORCE = 6000;
const COLOR_INTERVAL = 100;
const IDLE_TIME = 1800;

type Point = { x: number; y: number };
type Color = [number, number, number];
type Splat = Point & { dx: number; dy: number; color: Color };

function nextColor(): Color {
  const hue = Math.random() * 6;
  const intermediate = 0.15 * (1 - Math.abs(hue % 2 - 1));
  const colors: Color[] = [
    [0.15, intermediate, 0],
    [intermediate, 0.15, 0],
    [0, 0.15, intermediate],
    [0, intermediate, 0.15],
    [intermediate, 0, 0.15],
    [0.15, 0, intermediate],
  ];
  return colors[Math.floor(hue)];
}

export function HomePointerTrail() {
  const layer = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = layer.current;
    if (!canvas) return;

    const motion = window.matchMedia('(any-pointer: fine) and (prefers-reduced-motion: no-preference)');
    let fluid: ReturnType<typeof createFluidCursor>;
    let triedContext = false;
    let previous: Point | null = null;
    let pendingMove: Splat | null = null;
    let pendingClick: Splat | null = null;
    let color = nextColor();
    let colorChanged = 0;
    let lastInput = 0;
    let lastFrame = 0;
    let frame = 0;

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
      previous = null;
      pendingMove = null;
      pendingClick = null;
      fluid?.clear();
    }

    function resize() {
      if (!canvas || !fluid) return;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const scale = Math.min(1, 1600 / Math.max(width, height));
      try {
        fluid.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      } catch {
        fluid.dispose();
        fluid = null;
      }
    }

    function paint(time: number) {
      frame = 0;
      if (!fluid || time - lastInput > IDLE_TIME) {
        stop();
        return;
      }

      if (pendingClick) {
        fluid.splat(pendingClick.x, pendingClick.y, pendingClick.dx, pendingClick.dy, pendingClick.color);
        pendingClick = null;
      }
      if (pendingMove) {
        fluid.splat(pendingMove.x, pendingMove.y, pendingMove.dx, pendingMove.dy, pendingMove.color);
        pendingMove = null;
      }

      fluid.step(lastFrame ? Math.min((time - lastFrame) / 1000, 1 / 30) : 1 / 60);
      lastFrame = time;
      frame = requestAnimationFrame(paint);
    }

    function pointerPosition(event: PointerEvent) {
      if (!canvas || event.pointerType !== 'mouse' || !motion.matches || document.hidden) return null;
      if (!triedContext) {
        triedContext = true;
        fluid = createFluidCursor(canvas);
        resize();
      }
      if (!fluid) return null;

      return {
        x: event.clientX / Math.max(1, canvas.clientWidth),
        y: 1 - event.clientY / Math.max(1, canvas.clientHeight),
      };
    }

    function wake() {
      lastInput = performance.now();
      if (!frame) frame = requestAnimationFrame(paint);
    }

    function move(event: PointerEvent) {
      const point = pointerPosition(event);
      if (!point || !canvas) return;

      const from = previous;
      previous = point;
      if (!from) return;

      const aspect = canvas.width / canvas.height;
      const dx = (point.x - from.x) * Math.min(1, aspect) * FORCE;
      const dy = (point.y - from.y) / Math.max(1, aspect) * FORCE;
      if (!dx && !dy) return;

      const now = performance.now();
      if (now - colorChanged >= COLOR_INTERVAL) {
        color = nextColor();
        colorChanged = now;
      }

      pendingMove = {
        ...point,
        dx: dx + (pendingMove?.dx ?? 0),
        dy: dy + (pendingMove?.dy ?? 0),
        color,
      };
      wake();
    }

    function click(event: PointerEvent) {
      if (event.button !== 0) return;
      const point = pointerPosition(event);
      if (!point) return;

      previous = point;
      const [r, g, b] = nextColor();
      pendingClick = {
        ...point,
        dx: (Math.random() - 0.5) * 10,
        dy: (Math.random() - 0.5) * 30,
        color: [r * 10, g * 10, b * 10],
      };
      wake();
    }

    function leave() {
      previous = null;
    }

    function contextLost(event: Event) {
      event.preventDefault();
      fluid = null;
      stop();
    }

    function contextRestored() {
      triedContext = false;
    }

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', click, { passive: true });
    window.addEventListener('resize', resize);
    window.addEventListener('blur', stop);
    document.documentElement.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', stop);
    motion.addEventListener('change', stop);
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', click);
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', stop);
      document.documentElement.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', stop);
      motion.removeEventListener('change', stop);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      stop();
      fluid?.dispose();
    };
  }, []);

  return <canvas ref={layer} className="pointer-events-none fixed inset-0 z-30 size-full" data-home-fluid-cursor aria-hidden="true" />;
}
