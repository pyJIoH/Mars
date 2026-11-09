// Curved monochrome CRT. The original 800×264 ROM raster is the only source.
const CRT_VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const CRT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D raster;
uniform vec2 sourceSize;
uniform float scanlines;
uniform bool fadeOnly;
in vec2 uv;
out vec4 color;

float beam(vec2 p, float level) {
  // Remove the original green-black background before calculating phosphor glow.
  return max(0.0, (textureLod(raster, p, level).g - 16.0 / 255.0) / (210.0 / 255.0));
}

void main() {
  if (fadeOnly) { color = vec4(0.0); return; }
  vec2 c = uv * 2.0 - 1.0;
  const float CURVATURE = 0.025;
  vec2 p = c * (1.0 + dot(c, c) * CURVATURE) / (1.0 + CURVATURE) * 0.5 + 0.5;
  vec2 content = (p - 0.5) / vec2(0.95, 0.92) + 0.5;
  bool inside = all(greaterThanEqual(content, vec2(0.0))) && all(lessThanEqual(content, vec2(1.0)));
  vec2 side = vec2(0.55 / sourceSize.x, 0.0);
  float spot = inside ? (beam(content - side, 0.0) + 2.0 * beam(content, 0.0) + beam(content + side, 0.0)) * 0.25 : 0.0;
  float halo = inside ? beam(content, 3.0) * 0.55 + beam(content, 5.0) * 0.5 : 0.0;

  // The scanlines bow gently across the glass, including its unlit areas.
  const float GLASS_CURVATURE = 0.035;
  vec2 glassPoint = c * (1.0 + dot(c, c) * GLASS_CURVATURE) / (1.0 + GLASS_CURVATURE) * 0.5 + 0.5;
  float line = 0.5 + 0.5 * cos(glassPoint.y * scanlines * 6.2831853);
  float scan = mix(0.42 + 0.25 * spot, 1.17, line);

  const vec2 halfTube = vec2(4.0 / 3.0, 1.0);
  const float radius = 0.11;
  vec2 inner = abs(c) * halfTube - halfTube + radius;
  float edge = length(max(inner, 0.0)) + min(max(inner.x, inner.y), 0.0) - radius;
  float shade = mix(0.54, 1.0, smoothstep(0.0, 0.38, -edge));
  vec2 toSheen = (c - vec2(-0.42, 0.58)) * vec2(1.25, 2.3);
  float sheen = exp(-dot(toSheen, toSheen)) * 0.035;

  const vec3 phosphor = vec3(0.45, 0.98, 0.57);
  vec3 lit = phosphor * (spot * 1.20 + halo * 0.32) * scan + vec3(spot * spot * 0.15);
  vec3 glass = (vec3(0.025, 0.037, 0.029) * mix(0.86, 1.08, line) + lit) * shade + vec3(sheen);
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  glass += (grain - 0.5) * 2.0 / 255.0;
  float mask = 1.0 - smoothstep(-0.007, 0.002, edge);
  color = vec4(mix(vec3(0.014, 0.020, 0.015), glass, mask), 1.0);
}`;

export class CrtDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.stale = true;
    this.resetHistory = true;
    this.lost = false;
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (this.gl) {
      this.init();
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
      canvas.addEventListener('webglcontextrestored', () => { this.init(); this.lost = false; this.fit(); });
    } else {
      this.context = canvas.getContext('2d', { alpha: false });
    }
    this.fit();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fit()).observe(canvas);
    window.addEventListener('resize', () => this.fit());
  }

  init() {
    const gl = this.gl;
    const compile = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, CRT_VERTEX), fragment = compile(gl.FRAGMENT_SHADER, CRT_FRAGMENT);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.uniforms = Object.fromEntries(['raster', 'sourceSize', 'scanlines', 'fadeOnly'].map(name => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(this.uniforms.raster, 0);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.scanlines, Math.min(288, this.canvas.height / 3));
    this.stale = this.resetHistory = true;
  }

  fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round((this.canvas.clientWidth || 800) * dpr));
    const height = Math.max(1, Math.round((this.canvas.clientHeight || 600) * dpr));
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width; this.canvas.height = height;
    this.resetHistory = true;
    if (this.gl && !this.lost) {
      this.gl.viewport(0, 0, width, height);
      this.gl.uniform1f(this.uniforms.scanlines, Math.min(288, height / 3));
    }
  }

  render(raster, changed, elapsedMs) {
    if (this.lost) return;
    this.fit();
    const gl = this.gl;
    if (!gl) {
      if (changed || this.resetHistory) {
        const ctx = this.context, { width, height } = this.canvas;
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#061009'; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(raster, width * .025, height * .04, width * .95, height * .92);
      }
      this.resetHistory = false;
      return;
    }
    if (changed || this.stale) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform2f(this.uniforms.sourceSize, raster.width, raster.height);
      this.stale = false;
    }
    if (this.resetHistory) {
      gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      this.resetHistory = false;
    } else {
      gl.enable(gl.BLEND);
      gl.uniform1i(this.uniforms.fadeOnly, 1);
      gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, Math.exp(-Math.max(1, elapsedMs) / 25));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.uniform1i(this.uniforms.fadeOnly, 0);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
