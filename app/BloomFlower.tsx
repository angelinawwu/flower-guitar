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



const BloomFlower = forwardRef<BloomFlowerHandle, BloomFlowerProps>(
  function BloomFlower(
    { plan, className, openDuration = 260, holdDuration = 200, closeDuration = 420, flowerKind, isHovered = false },
    ref
  ) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    const initialFills = useMemo(() => plan.paths.map((p) => morphFill(p, 0)), [plan]);
    const pathRefs1 = useRef<(SVGPathElement | null)[]>([]);
    const gradRefs1 = useRef<(SVGRadialGradientElement | null)[]>([]);
    const stopRefs1 = useRef<(SVGStopElement | null)[][]>([]);

    const pathRefs2 = useRef<(SVGPathElement | null)[]>([]);
    const gradRefs2 = useRef<(SVGRadialGradientElement | null)[]>([]);
    const stopRefs2 = useRef<(SVGStopElement | null)[][]>([]);

    const svg1Ref = useRef<SVGSVGElement>(null);
    const svg2Ref = useRef<SVGSVGElement>(null);
    const rafRef = useRef(0);
    const lastT = useRef(0);

    const isHoveredRef = useRef(isHovered);
    useEffect(() => {
      isHoveredRef.current = isHovered;
      applyRef.current(lastT.current);
    }, [isHovered]);

    const applyT = (t: number) => {
      lastT.current = t;

      if (svg1Ref.current) {
        svg1Ref.current.style.transform = `scale(${1 + 0.1 * t})`;
      }
      if (svg2Ref.current) {
        svg2Ref.current.style.transform = `scale(${1 + 0.1 * t})`;
        svg2Ref.current.style.opacity = String(t);
      }

      for (let i = 0; i < plan.paths.length; i++) {
        const p = plan.paths[i];
        
        const updateEl = (
          el: SVGPathElement | null,
          grad: SVGRadialGradientElement | null,
          stops: (SVGStopElement | null)[]
        ) => {
          if (!el) return;
          el.setAttribute("d", morphPathD(p, t));
          if (p.opacityFrom !== p.opacityTo) {
            el.setAttribute(
              "fill-opacity",
              (p.opacityFrom + (p.opacityTo - p.opacityFrom) * t).toFixed(3)
            );
          }
          if (!p.fillAnimates) return;
          const fs = morphFill(p, t);
          if (fs.kind === "value") {
            el.setAttribute("fill", fs.fill);
          } else {
            if (grad) {
              grad.setAttribute("gradientTransform", fs.transform);
              grad.setAttribute("cx", String(fs.cx));
              grad.setAttribute("cy", String(fs.cy));
              grad.setAttribute("r", String(fs.r));
            }
            for (let j = 0; j < fs.stops.length; j++) {
              const st = stops[j];
              if (!st) continue;
              st.setAttribute("offset", fs.stops[j].offset.toFixed(4));
              st.setAttribute("stop-color", fs.stops[j].color);
              st.setAttribute("stop-opacity", fs.stops[j].opacity.toFixed(3));
            }
          }
        };

        updateEl(pathRefs1.current[i], gradRefs1.current[i], stopRefs1.current[i] || []);
        updateEl(pathRefs2.current[i], gradRefs2.current[i], stopRefs2.current[i] || []);
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
      <div
        className={`flower-hover-scale relative ${className || ""}`}
        data-hovered={isHovered ? "true" : "false"}
      >
        <svg
          ref={svg1Ref}
          viewBox={plan.viewBox}
          className="block w-full h-full"
          style={{ transformOrigin: "center", overflow: "visible" }}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Flower"
        >
          <defs>
            {initialFills.map((f, i) =>
              f.kind === "gradient" ? (
                <radialGradient
                  key={i}
                  id={`${uid}-g1-${i}`}
                  cx={f.cx}
                  cy={f.cy}
                  r={f.r}
                  gradientUnits="userSpaceOnUse"
                  gradientTransform={f.transform}
                  ref={(el) => {
                    gradRefs1.current[i] = el;
                  }}
                >
                  {f.stops.map((s, j) => (
                    <stop
                      key={j}
                      offset={s.offset}
                      stopColor={s.color}
                      stopOpacity={s.opacity}
                      ref={(el) => {
                        (stopRefs1.current[i] ??= [])[j] = el;
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
                pathRefs1.current[i] = el;
              }}
              d={morphPathD(p, 0)}
              fill={
                initialFills[i].kind === "gradient"
                  ? `url(#${uid}-g1-${i})`
                  : (initialFills[i] as { fill: string }).fill
              }
              fillOpacity={p.opacityFrom}
            />
          ))}
        </svg>

        {/* The glowing layer on top */}
        <svg
          ref={svg2Ref}
          viewBox={plan.viewBox}
          className="absolute top-0 left-0 w-full h-full mix-blend-lighten pointer-events-none"
          style={{ transformOrigin: "center", overflow: "visible", filter: "blur(8px)", opacity: 0, willChange: "transform, opacity" }}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            {initialFills.map((f, i) =>
              f.kind === "gradient" ? (
                <radialGradient
                  key={i}
                  id={`${uid}-g2-${i}`}
                  cx={f.cx}
                  cy={f.cy}
                  r={f.r}
                  gradientUnits="userSpaceOnUse"
                  gradientTransform={f.transform}
                  ref={(el) => {
                    gradRefs2.current[i] = el;
                  }}
                >
                  {f.stops.map((s, j) => (
                    <stop
                      key={j}
                      offset={s.offset}
                      stopColor={s.color}
                      stopOpacity={s.opacity}
                      ref={(el) => {
                        (stopRefs2.current[i] ??= [])[j] = el;
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
                pathRefs2.current[i] = el;
              }}
              d={morphPathD(p, 0)}
              fill={
                initialFills[i].kind === "gradient"
                  ? `url(#${uid}-g2-${i})`
                  : (initialFills[i] as { fill: string }).fill
              }
              fillOpacity={p.opacityFrom}
            />
          ))}
        </svg>
      </div>
    );
  }
);

export default BloomFlower;
