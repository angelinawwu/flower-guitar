"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildMorphPlan, morphPathD } from "../lib/flower-morph";

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
  const plan = useMemo(
    () => buildMorphPlan(svgA, svgB, fold ? { fold } : undefined),
    [svgA, svgB, fold]
  );
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);

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
        pathRefs.current[i]?.setAttribute("d", morphPathD(plan.paths[i], t));
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
      {plan.paths.map((p, i) => (
        <path
          key={i}
          ref={(el) => {
            pathRefs.current[i] = el;
          }}
          d={morphPathD(p, 0)}
          fill={p.fill}
          fillOpacity={p.fillOpacity}
        />
      ))}
    </svg>
  );
}
