"use client";

import { useEffect, useRef } from "react";

const VERTEX_SHADER = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform float u_time;
  uniform vec2 u_resolution;

  // Pseudo-random generator
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    
    // 1. High frequency film grain (scaled up 2.5x for larger grain size)
    vec2 grainCoord = floor(gl_FragCoord.xy / 2.0);
    float grain = hash(grainCoord);
    
    // 2. Halftone / Dither pattern (scaled up)
    float scale = 0.75;
    vec2 p = mod(gl_FragCoord.xy / scale, 6.0);
    float dither = length(p - 3.0) < 2.0 ? 1.0 : 0.0;
    
    // 3. Haziness / Vignetting
    float dist = distance(st, vec2(0.5));
    float vignette = smoothstep(0.5, 1.6, dist);

    // In 'overlay' blend mode, exactly 0.5 is invisible.
    // > 0.5 lightens the background, < 0.5 darkens it.
    vec3 color = vec3(0.5);

    // Apply grain (more prominent)
    color += (grain - 0.5) * 0.2;
    
    // Apply halftone dots (more prominent)
    color += (dither - 0.5) * 0.1;
    
    // Apply vignette (darken edges slightly less)
    color -= vignette * 0.08;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    throw new Error("Shader compilation failed");
  }
  return shader;
}

export default function ShaderOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) return;

    const vShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }

    // Full screen triangle
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      3, -1,
      -1, 3
    ]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const uTimeLoc = gl.getUniformLocation(program, "u_time");
    const uResolutionLoc = gl.getUniformLocation(program, "u_resolution");

    const draw = () => {
      // Resize canvas to display size
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = Math.floor(canvas.clientWidth * dpr);
      const displayHeight = Math.floor(canvas.clientHeight * dpr);

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      gl.useProgram(program);
      gl.uniform1f(uTimeLoc, 0); // Static noise
      gl.uniform2f(uResolutionLoc, canvas.width, canvas.height);

      // Clear with transparent black
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    draw();

    const resizeObserver = new ResizeObserver(() => {
      draw();
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vShader);
      gl.deleteShader(fShader);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
      style={{ mixBlendMode: "overlay", opacity: 0.8 }} // Overlay blend mode makes grain look very tactile
    />
  );
}
