"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { MorphPlan } from "../lib/flower-morph";
import { morphFill, morphPathD } from "../lib/flower-morph";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export interface BloomFlowerHandle {
  bloom: () => void;
}

interface BloomFlowerProps {
  plan: MorphPlan;
  className?: string;
  /** Time to morph from state 1 to state 2, in ms. */
  openDuration?: number;
  /** Time spent fully bloomed, in ms. */
  holdDuration?: number;
  /** Time to morph back to state 1, in ms. */
  closeDuration?: number;
  flowerKind?: "A" | "B" | "C";
  isHovered?: boolean;
}

const GLOW_COLORS = {
  A: "#D77EFE", // Indigo/Purple
  B: "#FED672", // Orange
  C: "#FC9DF2", // Pink
};

const BloomFlower = forwardRef<BloomFlowerHandle, BloomFlowerProps>(
  function BloomFlower(
    { plan, className, openDuration = 260, holdDuration = 200, closeDuration = 420, flowerKind, isHovered = false },
    ref
  ) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    const initialFills = useMemo(() => plan.paths.map((p) => morphFill(p, 0)), [plan]);
    const pathRefs = useRef<(SVGPathElement | null)[]>([]);
    const gradRefs = useRef<(SVGRadialGradientElement | null)[]>([]);
    const stopRefs = useRef<(SVGStopElement | null)[][]>([]);
    const svgRef = useRef<SVGSVGElement>(null);
    const rafRef = useRef(0);
    const lastT = useRef(0);

    const isHoveredRef = useRef(isHovered);
    useEffect(() => {
      isHoveredRef.current = isHovered;
      applyRef.current(lastT.current);
    }, [isHovered]);

    const applyT = (t: number) => {
      lastT.current = t;
      if (svgRef.current) {
        svgRef.current.style.transform = `scale(${1 + 0.1 * t})`;
        
        // Form-fitting drop shadow based on morph state and hover
        const hovered = isHoveredRef.current;
        const blurRadius = (hovered ? 6 : 0) + (t * 8);
        if (blurRadius > 0 && flowerKind) {
          const color = GLOW_COLORS[flowerKind];
          // Stack shadows for a tight, vibrant core and a softer outer glow
          svgRef.current.style.filter = `drop-shadow(0 0 ${blurRadius}px ${color}) drop-shadow(0 0 ${blurRadius * 0.5}px ${color})`;
        } else {
          svgRef.current.style.filter = "none";
        }
      }
      for (let i = 0; i < plan.paths.length; i++) {
        const p = plan.paths[i];
        const el = pathRefs.current[i];
        if (!el) continue;
        el.setAttribute("d", morphPathD(p, t));
        if (p.opacityFrom !== p.opacityTo) {
          el.setAttribute(
            "fill-opacity",
            (p.opacityFrom + (p.opacityTo - p.opacityFrom) * t).toFixed(3)
          );
        }
        if (!p.fillAnimates) continue;
        const fs = morphFill(p, t);
        if (fs.kind === "value") {
          el.setAttribute("fill", fs.fill);
        } else {
          const grad = gradRefs.current[i];
          if (grad) {
            grad.setAttribute("gradientTransform", fs.transform);
            grad.setAttribute("cx", String(fs.cx));
            grad.setAttribute("cy", String(fs.cy));
            grad.setAttribute("r", String(fs.r));
          }
          for (let j = 0; j < fs.stops.length; j++) {
            const st = stopRefs.current[i]?.[j];
            if (!st) continue;
            st.setAttribute("offset", fs.stops[j].offset.toFixed(4));
            st.setAttribute("stop-color", fs.stops[j].color);
            st.setAttribute("stop-opacity", fs.stops[j].opacity.toFixed(3));
          }
        }
      }
    };

    const applyRef = useRef(applyT);
    applyRef.current = applyT;

    useImperativeHandle(ref, () => ({
      bloom() {
        cancelAnimationFrame(rafRef.current);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          applyRef.current(1);
          window.setTimeout(() => applyRef.current(0), holdDuration + openDuration);
          return;
        }
        const start = performance.now();
        const total = openDuration + holdDuration + closeDuration;
        const frame = (now: number) => {
          const e = now - start;
          let t: number;
          if (e < openDuration) {
            t = easeOutCubic(e / openDuration);
          } else if (e < openDuration + holdDuration) {
            t = 1;
          } else if (e < total) {
            t = 1 - easeOutCubic((e - openDuration - holdDuration) / closeDuration);
          } else {
            applyRef.current(0);
            return;
          }
          
          applyRef.current(t);
          rafRef.current = requestAnimationFrame(frame);
        };
        rafRef.current = requestAnimationFrame(frame);
      },
    }));

    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    return (
      <svg
        ref={svgRef}
        viewBox={plan.viewBox}
        className={className}
        style={{ transformOrigin: "center" }}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Flower"
      >
        <defs>
          {initialFills.map((f, i) =>
            f.kind === "gradient" ? (
              <radialGradient
                key={i}
                id={`${uid}-g${i}`}
                cx={f.cx}
                cy={f.cy}
                r={f.r}
                gradientUnits="userSpaceOnUse"
                gradientTransform={f.transform}
                ref={(el) => {
                  gradRefs.current[i] = el;
                }}
              >
                {f.stops.map((s, j) => (
                  <stop
                    key={j}
                    offset={s.offset}
                    stopColor={s.color}
                    stopOpacity={s.opacity}
                    ref={(el) => {
                      (stopRefs.current[i] ??= [])[j] = el;
                    }}
                  />
                ))}
              </radialGradient>
            ) : null
          )}
        </defs>
        {plan.paths.map((p, i) => (
          <path
            key={i}
            ref={(el) => {
              pathRefs.current[i] = el;
            }}
            d={morphPathD(p, 0)}
            fill={
              initialFills[i].kind === "gradient"
                ? `url(#${uid}-g${i})`
                : (initialFills[i] as { fill: string }).fill
            }
            fillOpacity={p.opacityFrom}
          />
        ))}
      </svg>
    );
  }
);

export default BloomFlower;
