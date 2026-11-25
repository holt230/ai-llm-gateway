/*!
 * Adapted from Inspira UI Fluid Cursor and Pavel Dobryakov's WebGL Fluid Simulation.
 * https://github.com/unovue/inspira-ui/blob/eec920b047589058b4b02ba64deb614869e7237a/app/components/inspira/ui/fluid-cursor/FluidCursor.vue
 * https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 *
 * MIT License
 * Copyright (c) 2024-2026 rahulv.dev
 * Copyright (c) 2017 Pavel Dobryakov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const VERTEX = `#version 300 es
precision highp float;
uniform vec2 texelSize;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;

void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = uv;
  vL = uv - vec2(texelSize.x, 0.0);
  vR = uv + vec2(texelSize.x, 0.0);
  vT = uv + vec2(0.0, texelSize.y);
  vB = uv - vec2(0.0, texelSize.y);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const DISPLAY = `
uniform sampler2D uTexture;
uniform vec2 texelSize;
void main() {
  vec3 color = texture(uTexture, vUv).rgb;
  #ifndef MANUAL_FILTERING
  float dx = length(texture(uTexture, vR).rgb) - length(texture(uTexture, vL).rgb);
  float dy = length(texture(uTexture, vT).rgb) - length(texture(uTexture, vB).rgb);
  vec3 normal = normalize(vec3(dx, dy, length(texelSize)));
  color *= clamp(normal.z + 0.7, 0.7, 1.0);
  #endif
  float alpha = min(1.0, max(color.r, max(color.g, color.b)));
  fragColor = vec4(color, alpha);
}
`;

const CLEAR = `
uniform sampler2D uTexture;
uniform float value;
void main () {
  fragColor = value * texture(uTexture, vUv);
}
`;

const SPLAT = `
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
  vec2 p = vUv - point.xy;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture(uTarget, vUv).xyz;
  fragColor = vec4(base + splat, 1.0);
}
`;

const ADVECTION = `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main () {
  #ifdef MANUAL_FILTERING
    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
    vec4 result = bilerp(uSource, coord, dyeTexelSize);
  #else
    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
    vec4 result = texture(uSource, coord);
  #endif
  float decay = 1.0 + dissipation * dt;
  fragColor = result / decay;
}
`;

const DIVERGENCE = `
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const CURL = `
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

const VORTICITY = `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity += force * dt;
  velocity = min(max(velocity, -1000.0), 1000.0);
  fragColor = vec4(velocity, 0.0, 1.0);
}
`;

const PRESSURE = `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const GRADIENT_SUBTRACT = `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}
`;

type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

class TargetPair {
  constructor(public read: Target, public write: Target) {}

  swap() {
    [this.read, this.write] = [this.write, this.read];
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw Error('Unable to create fluid shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

  const message = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw Error(message || 'Unable to compile fluid shader');
}

export function createFluidCursor(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!context?.getExtension('EXT_color_buffer_float')) return null;
  const gl = context;

  const linear = Boolean(gl.getExtension('OES_texture_float_linear'));
  const programs: WebGLProgram[] = [];
  const targets: Target[] = [];
  let vertex: WebGLShader | null = null;

  function releaseTargets() {
    for (const target of targets.splice(0)) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
  }

  function dispose() {
    releaseTargets();
    for (const program of programs.splice(0)) gl.deleteProgram(program);
    gl.deleteShader(vertex);
    vertex = null;
  }

  function createProgram(source: string) {
    const fragment = compile(gl!, gl.FRAGMENT_SHADER, `#version 300 es
${linear ? '' : '#define MANUAL_FILTERING'}
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
${source}`);
    try {
      const program = gl.createProgram();
      if (!program) throw Error('Unable to create fluid program');
      programs.push(program);
      gl.attachShader(program, vertex!);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw Error(gl.getProgramInfoLog(program) || 'Unable to link fluid program');
      }

      const locations = new Map<string, WebGLUniformLocation | null>();
      function location(name: string) {
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
        return locations.get(name) ?? null;
      }
      return {
        bind: () => gl.useProgram(program),
        scalar: (name: string, value: number) => gl.uniform1f(location(name), value),
        vector: (name: string, x: number, y: number) => gl.uniform2f(location(name), x, y),
        color: (name: string, r: number, g: number, b: number) => gl.uniform3f(location(name), r, g, b),
        input(name: string, target: Target, unit = 0) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, target.texture);
          gl.uniform1i(location(name), unit);
        },
        texels(target: Target) {
          gl.uniform2f(location('texelSize'), 1 / target.width, 1 / target.height);
        },
      };
    } finally {
      gl.deleteShader(fragment);
    }
  }

  function target(resolution: number, internalFormat: number, format: number, filtering: number = gl.NEAREST): Target {
    const aspect = canvas.width / canvas.height;
    const width = Math.max(1, Math.round(resolution * Math.max(1, aspect)));
    const height = Math.max(1, Math.round(resolution * Math.max(1, 1 / aspect)));
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      throw Error('Unable to allocate fluid texture');
    }

    const buffer = { texture, framebuffer, width, height };
    targets.push(buffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw Error('Fluid texture format is unavailable');
    }
    return buffer;
  }

  function framebuffers() {
    releaseTargets();
    const filtering = linear ? gl.LINEAR : gl.NEAREST;
    const dyeResolution = linear ? 560 : 256;
    const simResolution = 128;
    const dye = () => target(dyeResolution, gl.RGBA16F, gl.RGBA, filtering);
    const velocity = () => target(simResolution, gl.RG16F, gl.RG, filtering);
    const pressure = () => target(simResolution, gl.R16F, gl.RED);
    return {
      dye: new TargetPair(dye(), dye()),
      velocity: new TargetPair(velocity(), velocity()),
      pressure: new TargetPair(pressure(), pressure()),
      curl: pressure(),
      divergence: pressure(),
    };
  }

  function draw(output: Target | null) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, output?.framebuffer ?? null);
    gl.viewport(0, 0, output?.width ?? canvas.width, output?.height ?? canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  try {
    vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const display = createProgram(DISPLAY);
    const splat = createProgram(SPLAT);
    const advect = createProgram(ADVECTION);
    const curlPass = createProgram(CURL);
    const vorticity = createProgram(VORTICITY);
    const divergencePass = createProgram(DIVERGENCE);
    const dissipation = createProgram(CLEAR);
    const solvePressure = createProgram(PRESSURE);
    const subtractGradient = createProgram(GRADIENT_SUBTRACT);

    let buffers: ReturnType<typeof framebuffers> | null = null;
    gl.clearColor(0, 0, 0, 0);

    return {
      resize(width: number, height: number) {
        if (buffers && width === canvas.width && height === canvas.height) return;
        canvas.width = width;
        canvas.height = height;
        buffers = framebuffers();
      },
      clear() {
        for (const buffer of targets) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      splat(x: number, y: number, dx: number, dy: number, color: [number, number, number]) {
        if (!buffers) return;
        const { dye, velocity } = buffers;
        const aspect = canvas.width / canvas.height;

        splat.bind();
        splat.vector('point', x, y);
        splat.scalar('aspectRatio', aspect);
        splat.scalar('radius', 0.002 * Math.max(1, aspect));
        splat.input('uTarget', velocity.read);
        splat.color('color', dx, dy, 0);
        draw(velocity.write);
        velocity.swap();

        splat.input('uTarget', dye.read);
        splat.color('color', ...color);
        draw(dye.write);
        dye.swap();
      },
      step(dt: number) {
        if (!buffers) return;
        const { dye, velocity, pressure, curl, divergence } = buffers;

        curlPass.bind();
        curlPass.texels(velocity.read);
        curlPass.input('uVelocity', velocity.read);
        draw(curl);

        vorticity.bind();
        vorticity.texels(velocity.read);
        vorticity.input('uVelocity', velocity.read);
        vorticity.input('uCurl', curl, 1);
        vorticity.scalar('curl', 3);
        vorticity.scalar('dt', dt);
        draw(velocity.write);
        velocity.swap();

        divergencePass.bind();
        divergencePass.texels(velocity.read);
        divergencePass.input('uVelocity', velocity.read);
        draw(divergence);

        dissipation.bind();
        dissipation.input('uTexture', pressure.read);
        dissipation.scalar('value', 0.1);
        draw(pressure.write);
        pressure.swap();

        solvePressure.bind();
        solvePressure.texels(pressure.read);
        solvePressure.input('uDivergence', divergence);
        for (let i = 0; i < 20; i++) {
          solvePressure.input('uPressure', pressure.read, 1);
          draw(pressure.write);
          pressure.swap();
        }

        subtractGradient.bind();
        subtractGradient.texels(velocity.read);
        subtractGradient.input('uPressure', pressure.read);
        subtractGradient.input('uVelocity', velocity.read, 1);
        draw(velocity.write);
        velocity.swap();

        advect.bind();
        advect.texels(velocity.read);
        advect.scalar('dt', dt);
        for (const [field, decay] of [[velocity, 2], [dye, 3.5]] as const) {
          advect.input('uVelocity', velocity.read);
          advect.input('uSource', field.read, 1);
          advect.vector('dyeTexelSize', 1 / field.read.width, 1 / field.read.height);
          advect.scalar('dissipation', decay);
          draw(field.write);
          field.swap();
        }

        display.bind();
        display.vector('texelSize', 1 / canvas.width, 1 / canvas.height);
        display.input('uTexture', dye.read);
        draw(null);
      },
      dispose,
    };
  } catch {
    dispose();
    return null;
  }
}
