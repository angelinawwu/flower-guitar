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
  uniform vec2 u_pointer;
  
  uniform int u_bloomCount;
  uniform vec4 u_blooms[32]; // x, y, intensity, type(0, 1, 2 for colors)

  // Pseudo-random generator
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  vec3 getBloomColor(float type) {
    if (type < 0.5) return vec3(0.5, 1.0, 0.6); // A: Greenish/Mint
    if (type < 1.5) return vec3(1.0, 0.8, 0.4); // B: Orange/Gold
    return vec3(0.5, 0.7, 1.0);                 // C: Blueish
  }

  void main() {
    // Normalised pixel coordinates (from 0 to 1)
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    
    // Correct aspect ratio for distance calculations
    float aspect = u_resolution.x / u_resolution.y;
    vec2 uv = st;
    uv.x *= aspect;

    vec3 color = vec3(0.0);

    // 1. Blooms
    for (int i = 0; i < 32; i++) {
      if (i >= u_bloomCount) break;
      
      vec2 bPos = u_blooms[i].xy;
      // Invert Y because WebGL coordinates are bottom-left, but CSS/mouse are top-left
      bPos.y = 1.0 - bPos.y; 
      bPos.x *= aspect;
      
      float intensity = u_blooms[i].z;
      float type = u_blooms[i].w;

      float d = distance(uv, bPos);
      
      // Make the glow soft and organic
      float glow = exp(-d * 5.0) * intensity;
      // Add a smaller, brighter core
      float core = exp(-d * 12.0) * intensity * 1.5;
      
      // Add a bit of noise to the glow to make it look "tactile"
      float n = noise(uv * 15.0 - u_time * 0.5);
      
      vec3 bColor = getBloomColor(type);
      color += bColor * (glow + core) * (0.8 + 0.2 * n);
    }

    // 2. Pointer Hover Glow
    if (u_pointer.x >= 0.0 && u_pointer.y >= 0.0) {
      vec2 pPos = u_pointer;
      pPos.y = 1.0 - pPos.y;
      pPos.x *= aspect;
      float d = distance(uv, pPos);
      
      // Subtle pulse based on time
      float pulse = 1.0 + 0.1 * sin(u_time * 2.0);
      float hoverGlow = exp(-d * 6.0) * 0.3 * pulse;
      
      float n = noise(uv * 20.0 - u_time * 0.2);
      color += vec3(0.7, 0.85, 0.6) * hoverGlow * (0.9 + 0.1 * n);
    }

    // 3. Screen-wide Effects: Grain & Halftone/Haziness
    
    // Vignetting / Haziness at edges
    float vignette = 1.0 - smoothstep(0.4, 1.2, length(st - 0.5));
    
    // Subtle Dither / Halftone based on screen coordinates
    // Using a 2x2 bayer matrix approximation via noise
    float dither = noise(gl_FragCoord.xy * 0.5);
    
    // High frequency film grain
    float grain = hash(gl_FragCoord.xy + u_time * 100.0);

    // Apply grain mostly in darker/mid areas, less on bright areas
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float grainIntensity = 0.05 * (1.0 - smoothstep(0.5, 1.0, luma));
    
    color += (grain - 0.5) * grainIntensity;
    
    // Add subtle halftone texture overlay
    color += (dither - 0.5) * 0.015;
    
    // Apply vignette
    color *= vignette;

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

// Module-level state for performance, avoiding React renders
type ActiveBloom = {
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  type: number;
  startTime: number;
};
let activeBlooms: ActiveBloom[] = [];
let pointer = { x: -1, y: -1 };

export function addGlowBloom(x: number, y: number, type: number) {
  activeBlooms.push({ x, y, type, startTime: performance.now() });
}

export function updateGlowPointer(x: number, y: number) {
  pointer.x = x;
  pointer.y = y;
}

const BLOOM_DURATION_MS = 620; // 260 + 200 + 420 is full morph, but we want glow to be sharp then fade.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

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
      -1,  3
    ]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const uTimeLoc = gl.getUniformLocation(program, "u_time");
    const uResolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const uPointerLoc = gl.getUniformLocation(program, "u_pointer");
    const uBloomCountLoc = gl.getUniformLocation(program, "u_bloomCount");
    const uBloomsLoc = gl.getUniformLocation(program, "u_blooms");

    let rafId = 0;
    
    const loop = (time: number) => {
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
      gl.uniform1f(uTimeLoc, time * 0.001);
      gl.uniform2f(uResolutionLoc, canvas.width, canvas.height);
      gl.uniform2f(uPointerLoc, pointer.x, pointer.y);

      // Process blooms
      const now = performance.now();
      const currentBlooms: { x: number, y: number, intensity: number, type: number }[] = [];
      
      for (let i = activeBlooms.length - 1; i >= 0; i--) {
        const b = activeBlooms[i];
        const elapsed = now - b.startTime;
        if (elapsed > BLOOM_DURATION_MS) {
          activeBlooms.splice(i, 1);
        } else {
          // Calculate intensity: sharp peak, smooth fade
          let intensity = 0;
          if (elapsed < 100) {
            intensity = easeOutCubic(elapsed / 100);
          } else {
            intensity = 1.0 - easeOutCubic((elapsed - 100) / (BLOOM_DURATION_MS - 100));
          }
          currentBlooms.push({ x: b.x, y: b.y, intensity, type: b.type });
        }
      }

      // WebGL uniform limits apply, we only send max 32 blooms
      const count = Math.min(currentBlooms.length, 32);
      gl.uniform1i(uBloomCountLoc, count);
      
      if (count > 0) {
        const bloomData = new Float32Array(32 * 4);
        for (let i = 0; i < count; i++) {
          bloomData[i * 4 + 0] = currentBlooms[i].x;
          bloomData[i * 4 + 1] = currentBlooms[i].y;
          bloomData[i * 4 + 2] = currentBlooms[i].intensity;
          bloomData[i * 4 + 3] = currentBlooms[i].type;
        }
        gl.uniform4fv(uBloomsLoc, bloomData);
      }

      // Clear with transparent black
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rafId = requestAnimationFrame(loop);
    };
    
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      gl.deleteProgram(program);
      gl.deleteShader(vShader);
      gl.deleteShader(fShader);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      style={{ mixBlendMode: "plus-lighter" }}
    />
  );
}
