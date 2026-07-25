"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { buildMorphPlan, morphFill, morphPathD } from "../lib/flower-morph";

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

interface FlowerMorphProps {
  svgA: string;
  svgB: string;
  className?: string;
  morphDuration?: number;
  holdDuration?: number;
  fold?: number;
}

export default function FlowerMorph({
  svgA,
  svgB,
  className,
  morphDuration = 1000,
  holdDuration = 800,
  fold,
}: FlowerMorphProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const plan = useMemo(
    () => buildMorphPlan(svgA, svgB, fold ? { fold } : undefined),
    [svgA, svgB, fold]
  );
  const initialFills = useMemo(
    () => plan.paths.map((p) => morphFill(p, 0)),
    [plan]
  );
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const gradRefs = useRef<(SVGRadialGradientElement | null)[]>([]);
  const stopRefs = useRef<(SVGStopElement | null)[][]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cycle = 2 * (morphDuration + holdDuration);
    let raf = 0;
    const startTime = performance.now();

    const frame = (now: number) => {
      const e = (now - startTime) % cycle;
      let t: number;
      if (e < holdDuration) {
        t = 0;
      } else if (e < holdDuration + morphDuration) {
        t = easeInOutCubic((e - holdDuration) / morphDuration);
      } else if (e < 2 * holdDuration + morphDuration) {
        t = 1;
      } else {
        t = 1 - easeInOutCubic((e - 2 * holdDuration - morphDuration) / morphDuration);
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
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [plan, morphDuration, holdDuration]);

  return (
    <svg
      viewBox={plan.viewBox}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Morphing flower illustration"
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
