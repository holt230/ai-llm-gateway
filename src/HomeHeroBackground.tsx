import { useEffect, useRef, useState, type RefObject } from 'react';

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouse_active;
uniform vec4 u_orbit;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.82, -0.57, 0.57, 0.82);
  for (int i = 0; i < 3; i++) {
    value += amp * noise(p);
    p = rot * p * 2.05 + vec2(2.4, 7.1);
    amp *= 0.5;
  }
  return value;
}

float auroraRibbon(vec2 uv, float centerY, float freq, float speed, float width, float phase) {
  float wave =
    sin(uv.x * freq + u_time * speed + phase) * 0.085 +
    (fbm(vec2(uv.x * 1.4 + phase, u_time * speed * 0.35)) - 0.5) * 0.16;
  float d = abs(uv.y - (centerY + wave));
  return exp(-d * width);
}

float starLayer(vec2 sky, float scale, float phase) {
  vec2 q = sky * scale;
  vec2 cell = floor(q);
  float seed = hash(cell + phase);
  vec2 center = 0.2 + 0.6 * vec2(hash(cell + 17.7), hash(cell + 34.1));
  vec2 offset = fract(q) - center;
  float size = mix(0.014, 0.05, seed * seed);
  float d = length(offset) / size;
  float flicker = 0.72 + 0.28 * sin(u_time * (0.8 + seed) + seed * 37.0);
  return exp(-d * d * 1.6) * smoothstep(0.42, 0.95, seed) * flicker;
}

vec3 vortex(vec3 space, vec2 p) {
  float turn = 0.33;
  vec2 q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * p;
  vec2 plane = vec2(q.x, q.y * 2.45);
  float r = length(plane);
  float a = atan(plane.y, plane.x + 0.00001);
  float horizon = length(q * vec2(1.0, 1.02));
  float front = 1.0 - smoothstep(-0.06, 0.025, q.y);
  float diskFade = smoothstep(0.137, 0.180, r) * (1.0 - smoothstep(0.42, 0.68, r));

  float flow = a - u_time * (0.13 + 0.037 / max(r, 0.15));
  vec2 angular = vec2(cos(flow), sin(flow));
  float detail = smoothstep(165.0, 328.0, u_orbit.w * u_resolution.y);
  float cloud = fbm(vec2(r * 24.0, 3.1) + angular * 4.3);
  float strands = noise(vec2(r * mix(68.0, 133.0, detail), 11.1) + angular * 5.2);
  float weave = r * mix(80.0, 138.0, detail) + cloud * 10.0 + 2.0 * sin(flow * 3.0);
  float filament = pow(0.5 + 0.5 * sin(weave), mix(2.5, 4.0, detail));
  float breakup = smoothstep(0.22, 0.75, cloud + 0.27 * strands);
  float wind = 0.38 + 0.62 * smoothstep(-0.75, 0.8, cos(a + 1.05));
  float bandLight = diskFade * breakup * wind * (0.37 + 0.52 * filament + 0.36 * strands);

  float heat = 1.0 - smoothstep(0.19, 0.43, r);
  vec3 coldBands = mix(vec3(0.20, 0.36, 0.92), vec3(0.32, 0.72, 0.97), smoothstep(-0.6, 0.85, sin(a - 0.5)));
  vec3 hotBands = mix(vec3(1.00, 0.44, 0.16), vec3(1.00, 0.82, 0.50), breakup);
  vec3 disk = mix(coldBands, hotBands, heat) * bandLight * (0.46 + 1.32 * heat);

  float haze = exp(-7.0 * length(q * vec2(1.03, 1.38)));
  space += haze * vec3(0.20, 0.19, 0.29);
  space += exp(-abs(r - 0.32) * 6.5) * diskFade * vec3(0.085, 0.12, 0.21);
  float silhouette = 1.0 - smoothstep(0.121, 0.127, horizon);
  space = mix(space + disk, vec3(0.002, 0.003, 0.008) + disk * front * 0.88, silhouette);

  // Light bends around the edge, then disappears behind the disk in the foreground.
  float rimDistance = abs(horizon - 0.126);
  float arcLight = mix(0.32, 1.0, smoothstep(-0.5, 0.82, cos(atan(q.y, q.x + 0.00001) - 1.0)));
  float rim = exp(-rimDistance * 655.0) * arcLight;
  float bloom = exp(-rimDistance * 75.0) * arcLight;
  space += (1.0 - silhouette * 0.42) * (1.0 - front * 0.70) *
    (rim * vec3(1.62, 1.00, 0.49) + bloom * vec3(0.49, 0.24, 0.10));

  float farArc = exp(-abs(length((q + vec2(0.012, -0.013)) * vec2(1.0, 1.17)) - 0.181) * 108.0);
  space += farArc * smoothstep(-0.015, 0.12, q.y) * vec3(0.21, 0.34, 0.67);
  return space;
}

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 sky = uv * aspect;
  vec2 pointerDelta = (uv - u_mouse) * aspect;
  float pull = exp(-length(pointerDelta) * 3.1) * u_mouse_active;
  vec2 warped = uv - pointerDelta * pull * 0.07;

  vec3 col = mix(vec3(0.014, 0.021, 0.037), vec3(0.034, 0.051, 0.089), smoothstep(0.0, 1.0, uv.y));
  float openSky = mix(0.34, 1.0, smoothstep(0.14, 0.62, uv.x));
  float indigo = auroraRibbon(warped, 0.42 + warped.x * 0.20, 3.6, 0.24, 6.5, 2.2);
  float teal = auroraRibbon(warped, 0.33 + warped.x * 0.16, 3.3, -0.20, 9.2, 4.4);
  float blueVeil = auroraRibbon(warped, 0.40 + warped.x * 0.15, 3.2, 0.21, 30.0, 1.7);
  float wisps = smoothstep(0.21, 0.77, fbm(vec2(sky.x * 3.9, sky.y * 8.0) + vec2(u_time * 0.042, 2.7)));
  col += openSky * (vec3(0.088, 0.091, 0.226) * indigo + vec3(0.033, 0.158, 0.186) * teal * wisps);
  col += blueVeil * wisps * openSky * vec3(0.070, 0.092, 0.181);
  col += pull * vec3(0.016, 0.036, 0.063);

  float tinyStars = starLayer(sky + vec2(u_time * 0.0011, 0.0), 56.0, 4.0);
  float nearStars = starLayer(sky + vec2(u_time * 0.0022, -u_time * 0.0004), 25.0, 13.0);
  col += openSky * (tinyStars * vec3(0.30, 0.38, 0.57) + nearStars * vec3(0.63, 0.76, 0.93));

  if (u_orbit.w > 0.0) {
    vec2 center = u_orbit.xy + u_orbit.zw * vec2(0.53, 0.51);
    vec2 p = (uv - center) * aspect / u_orbit.w;
    if (length(p) < 0.84) col = vortex(col, p);
  }

  gl_FragColor = vec4(1.0 - exp(-col * 1.15), 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function HomeHeroBackground({ orbitAnchor }: { orbitAnchor: RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextVersion, setContextVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.closest('section');
    const orbit = orbitAnchor.current;
    if (!canvas || !hero || !orbit) return;

    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const mouseLoc = gl.getUniformLocation(program, 'u_mouse');
    const mouseActiveLoc = gl.getUniformLocation(program, 'u_mouse_active');
    const orbitLoc = gl.getUniformLocation(program, 'u_orbit');

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let visible = true;
    let lost = false;
    let lastDraw = 0;
    let elapsed = 1.8;
    let orbitBounds: [number, number, number, number] = [0, 0, 0, 0];
    const targetMouse = { x: 0.65, y: 0.45 };
    const currentMouse = { x: 0.65, y: 0.45 };
    let targetActive = 0;
    let currentActive = 0;

    function resize() {
      if (!canvas || !gl || !orbit || lost) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const scale = Math.min(window.devicePixelRatio || 1, 1.25, 1120 / Math.max(rect.width, rect.height));
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const art = orbit.getBoundingClientRect();
      orbitBounds = [
        (art.left - rect.left) / rect.width,
        (rect.bottom - art.bottom) / rect.height,
        art.width / rect.width,
        art.height / rect.height,
      ];
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function draw(now: number) {
      frame = 0;
      if (!canvas || !gl || !hero || lost || !visible || document.hidden) return;
      if (!motion.matches && lastDraw && now - lastDraw < 29) {
        frame = requestAnimationFrame(draw);
        return;
      }

      if (lastDraw && !motion.matches) elapsed += Math.min((now - lastDraw) / 1000, 0.05);
      lastDraw = now;

      currentMouse.x += (targetMouse.x - currentMouse.x) * 0.14;
      currentMouse.y += (targetMouse.y - currentMouse.y) * 0.14;
      currentActive += (targetActive - currentActive) * 0.13;

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(timeLoc, motion.matches ? 1.8 : elapsed);
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform2f(mouseLoc, currentMouse.x, currentMouse.y);
      gl.uniform1f(mouseActiveLoc, motion.matches ? 0 : currentActive);
      gl.uniform4f(orbitLoc, ...orbitBounds);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (hero.dataset.heroScene !== 'ready') hero.dataset.heroScene = 'ready';

      if (!motion.matches) {
        frame = requestAnimationFrame(draw);
      }
    }

    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastDraw = 0;
      if (lost || !visible || document.hidden) return;
      frame = requestAnimationFrame(draw);
    }

    function onPointerMove(event: PointerEvent) {
      if (!hero || event.pointerType !== 'mouse' || motion.matches) return;
      const rect = hero.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      targetMouse.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      targetMouse.y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
      targetActive = 1;
    }

    function onPointerLeave() {
      targetActive = 0;
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      lost = true;
      if (hero) delete hero.dataset.heroScene;
      sync();
    }

    function onContextRestored() {
      setContextVersion(version => version + 1);
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    const dimensions = new ResizeObserver(() => {
      resize();
      sync();
    });

    observer.observe(canvas);
    dimensions.observe(canvas);
    dimensions.observe(orbit);
    hero.addEventListener('pointermove', onPointerMove, { passive: true });
    hero.addEventListener('pointerleave', onPointerLeave);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    resize();
    sync();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dimensions.disconnect();
      hero.removeEventListener('pointermove', onPointerMove);
      hero.removeEventListener('pointerleave', onPointerLeave);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      delete hero.dataset.heroScene;
      if (!lost) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      }
    };
  }, [contextVersion, orbitAnchor]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="home-aurora-fallback absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#06080c]/75 to-transparent" />
    </div>
  );
}
