type Pt = [number, number];
type Seg = [Pt, Pt, Pt];

interface Subpath {
  start: Pt;
  segs: Seg[];
  closed: boolean;
}

export interface GradStop {
  offset: number;
  color: [number, number, number];
  opacity: number;
}

export interface RadialGrad {
  cx: number;
  cy: number;
  r: number;
  tx: number;
  ty: number;
  rot: number;
  sx: number;
  sy: number;
  stops: GradStop[];
}

export type Fill =
  | { type: "solid"; color: [number, number, number] }
  | { type: "gradient"; grad: RadialGrad }
  | { type: "raw"; value: string };

export type FillState =
  | { kind: "value"; fill: string }
  | {
      kind: "gradient";
      cx: number;
      cy: number;
      r: number;
      transform: string;
      stops: { offset: number; color: string; opacity: number }[];
    };

interface ParsedPath {
  subpaths: Subpath[];
  fill: Fill;
  fillOpacity: number;
}

export interface MorphSub {
  from: number[];
  to: number[];
  closed: boolean;
}

export interface MorphPath {
  subs: MorphSub[];
  fillFrom: Fill;
  fillTo: Fill;
  opacityFrom: number;
  opacityTo: number;
  fillAnimates: boolean;
}

export interface MorphPlan {
  viewBox: string;
  paths: MorphPath[];
}

const TOKEN_RE = /[a-df-z]|-?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?/gi;

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function lineSeg(p: Pt, q: Pt): Seg {
  return [lerpPt(p, q, 1 / 3), lerpPt(p, q, 2 / 3), q];
}

function quadSeg(p: Pt, q1: Pt, q: Pt): Seg {
  return [lerpPt(p, q1, 2 / 3), lerpPt(q, q1, 2 / 3), q];
}

function reflect(ctrl: Pt, about: Pt): Pt {
  return [2 * about[0] - ctrl[0], 2 * about[1] - ctrl[1]];
}

export function parsePathD(d: string): Subpath[] {
  const tokens = d.match(TOKEN_RE) ?? [];
  const subpaths: Subpath[] = [];
  let sub: Subpath | null = null;
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let cmd = "";
  let prevCubic: Pt | null = null;
  let prevQuad: Pt | null = null;
  let i = 0;

  const num = () => parseFloat(tokens[i++]);
  const flush = () => {
    if (sub && sub.segs.length) subpaths.push(sub);
    sub = null;
  };
  const ensureSub = () => {
    if (!sub) sub = { start: [...cur] as Pt, segs: [], closed: false };
    return sub;
  };
  const pt = (rel: boolean): Pt => {
    const x = num();
    const y = num();
    return rel ? [cur[0] + x, cur[1] + y] : [x, y];
  };

  while (i < tokens.length) {
    const tk = tokens[i];
    if (/[a-z]/i.test(tk)) {
      cmd = tk;
      i++;
    } else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";

    const rel = cmd >= "a";
    const C = cmd.toUpperCase();

    if (C === "M") {
      flush();
      cur = pt(rel);
      start = [...cur] as Pt;
      sub = { start: [...cur] as Pt, segs: [], closed: false };
    } else if (C === "L") {
      const q = pt(rel);
      ensureSub().segs.push(lineSeg(cur, q));
      cur = q;
    } else if (C === "H") {
      const x = num();
      const q: Pt = [rel ? cur[0] + x : x, cur[1]];
      ensureSub().segs.push(lineSeg(cur, q));
      cur = q;
    } else if (C === "V") {
      const y = num();
      const q: Pt = [cur[0], rel ? cur[1] + y : y];
      ensureSub().segs.push(lineSeg(cur, q));
      cur = q;
    } else if (C === "C") {
      const c1 = pt(rel);
      const c2 = pt(rel);
      const q = pt(rel);
      ensureSub().segs.push([c1, c2, q]);
      prevCubic = c2;
      cur = q;
    } else if (C === "S") {
      const c1 = prevCubic ? reflect(prevCubic, cur) : ([...cur] as Pt);
      const c2 = pt(rel);
      const q = pt(rel);
      ensureSub().segs.push([c1, c2, q]);
      prevCubic = c2;
      cur = q;
    } else if (C === "Q") {
      const q1 = pt(rel);
      const q = pt(rel);
      ensureSub().segs.push(quadSeg(cur, q1, q));
      prevQuad = q1;
      cur = q;
    } else if (C === "T") {
      const q1: Pt = prevQuad ? reflect(prevQuad, cur) : ([...cur] as Pt);
      const q = pt(rel);
      ensureSub().segs.push(quadSeg(cur, q1, q));
      prevQuad = q1;
      cur = q;
    } else if (C === "Z") {
      if (sub) {
        if (cur[0] !== start[0] || cur[1] !== start[1]) {
          sub.segs.push(lineSeg(cur, start));
        }
        sub.closed = true;
        subpaths.push(sub);
        sub = null;
      }
      cur = [...start] as Pt;
    } else {
      break;
    }

    if (C !== "C" && C !== "S") prevCubic = null;
    if (C !== "Q" && C !== "T") prevQuad = null;
  }
  flush();
  return subpaths;
}

function splitCubic(p0: Pt, seg: Seg, t: number): [Seg, Seg] {
  const [c1, c2, p3] = seg;
  const p01 = lerpPt(p0, c1, t);
  const p12 = lerpPt(c1, c2, t);
  const p23 = lerpPt(c2, p3, t);
  const p012 = lerpPt(p01, p12, t);
  const p123 = lerpPt(p12, p23, t);
  const p0123 = lerpPt(p012, p123, t);
  return [
    [p01, p012, p0123],
    [p123, p23, p3],
  ];
}

function splitCubicInto(p0: Pt, seg: Seg, k: number): Seg[] {
  const out: Seg[] = [];
  let head = p0;
  let rest = seg;
  for (let j = k; j > 1; j--) {
    const [first, second] = splitCubic(head, rest, 1 / j);
    out.push(first);
    head = first[2];
    rest = second;
  }
  out.push(rest);
  return out;
}

function upsample(sub: Subpath, m: number): Subpath {
  const n = sub.segs.length;
  if (n >= m) return sub;
  if (n === 0) {
    const s = sub.start;
    return {
      start: s,
      segs: Array.from({ length: m }, () => [s, s, s] as Seg),
      closed: sub.closed,
    };
  }
  const base = Math.floor(m / n);
  const extra = m - base * n;
  const segs: Seg[] = [];
  let p0 = sub.start;
  for (let idx = 0; idx < n; idx++) {
    const k = base + (idx < extra ? 1 : 0);
    segs.push(...splitCubicInto(p0, sub.segs[idx], k));
    p0 = sub.segs[idx][2];
  }
  return { start: sub.start, segs, closed: sub.closed };
}

function flatten(sub: Subpath): number[] {
  const out: number[] = [sub.start[0], sub.start[1]];
  for (const [c1, c2, p] of sub.segs) {
    out.push(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
  }
  return out;
}

const FNUM = "(-?(?:\\d*\\.\\d+|\\d+\\.?)(?:e[+-]?\\d+)?)";

function parseColor(s: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function parseGradientTransform(s: string) {
  const t = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 };
  const tr = new RegExp(`translate\\(\\s*${FNUM}(?:[\\s,]+${FNUM})?`, "i").exec(s);
  if (tr) {
    t.tx = parseFloat(tr[1]);
    t.ty = tr[2] ? parseFloat(tr[2]) : 0;
  }
  const ro = new RegExp(`rotate\\(\\s*${FNUM}`, "i").exec(s);
  if (ro) t.rot = parseFloat(ro[1]);
  const sc = new RegExp(`scale\\(\\s*${FNUM}(?:[\\s,]+${FNUM})?`, "i").exec(s);
  if (sc) {
    t.sx = parseFloat(sc[1]);
    t.sy = sc[2] ? parseFloat(sc[2]) : t.sx;
  }
  return t;
}

function parseGradients(svg: string): Map<string, RadialGrad> {
  const map = new Map<string, RadialGrad>();
  const re = /<radialGradient\b([^>]*)>([\s\S]*?)<\/radialGradient>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const id = /\bid="([^"]*)"/.exec(m[1])?.[1];
    if (!id) continue;
    const tf = /gradientTransform="([^"]*)"/.exec(m[1])?.[1] ?? "";
    const stops: GradStop[] = [];
    const stopRe = /<stop\b[^>]*\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = stopRe.exec(m[2]))) {
      const tag = sm[0];
      stops.push({
        offset: parseFloat(/\boffset="([^"]*)"/.exec(tag)?.[1] ?? "0") || 0,
        color: parseColor(/stop-color="([^"]*)"/.exec(tag)?.[1] ?? "#000") ?? [0, 0, 0],
        opacity: parseFloat(/stop-opacity="([^"]*)"/.exec(tag)?.[1] ?? "1"),
      });
    }
    map.set(id, {
      cx: parseFloat(/\bcx="([^"]*)"/.exec(m[1])?.[1] ?? "0"),
      cy: parseFloat(/\bcy="([^"]*)"/.exec(m[1])?.[1] ?? "0"),
      r: parseFloat(/\br="([^"]*)"/.exec(m[1])?.[1] ?? "1"),
      ...parseGradientTransform(tf),
      stops,
    });
  }
  return map;
}

function resolveFill(attr: string, grads: Map<string, RadialGrad>): Fill {
  const url = /^url\(#([^)]+)\)$/.exec(attr.trim());
  if (url) {
    const g = grads.get(url[1]);
    if (g) return { type: "gradient", grad: g };
    return { type: "raw", value: attr };
  }
  const c = parseColor(attr);
  if (c) return { type: "solid", color: c };
  return { type: "raw", value: attr };
}

function padStops(g: RadialGrad, n: number): RadialGrad {
  const stops = g.stops.slice();
  const last = stops[stops.length - 1] ?? { offset: 1, color: [0, 0, 0] as [number, number, number], opacity: 1 };
  while (stops.length < n) stops.push({ ...last, color: [...last.color] as [number, number, number] });
  return { ...g, stops };
}

function solidToGrad(color: [number, number, number], like: RadialGrad): RadialGrad {
  return {
    ...like,
    stops: like.stops.map((s) => ({
      offset: s.offset,
      color: [...color] as [number, number, number],
      opacity: 1,
    })),
  };
}

function pairFills(a: Fill, b: Fill): [Fill, Fill] {
  if (a.type === "raw" || b.type === "raw") return [a, a];
  if (a.type === "gradient" && b.type === "solid") {
    return [a, { type: "gradient", grad: solidToGrad(b.color, a.grad) }];
  }
  if (a.type === "solid" && b.type === "gradient") {
    return [{ type: "gradient", grad: solidToGrad(a.color, b.grad) }, b];
  }
  if (a.type === "gradient" && b.type === "gradient") {
    const n = Math.max(a.grad.stops.length, b.grad.stops.length);
    return [
      { type: "gradient", grad: padStops(a.grad, n) },
      { type: "gradient", grad: padStops(b.grad, n) },
    ];
  }
  return [a, b];
}

function extractPaths(svg: string): ParsedPath[] {
  const grads = parseGradients(svg);
  const paths: ParsedPath[] = [];
  const tagRe = /<path\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(svg))) {
    const tag = match[0];
    const d = /\bd="([^"]*)"/.exec(tag)?.[1];
    if (!d) continue;
    paths.push({
      subpaths: parsePathD(d),
      fill: resolveFill(/\bfill="([^"]*)"/.exec(tag)?.[1] ?? "currentColor", grads),
      fillOpacity: parseFloat(/\bfill-opacity="([^"]*)"/.exec(tag)?.[1] ?? "1"),
    });
  }
  return paths;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function mapRing(r: number, fromRings: number, toRings: number): number {
  if (fromRings <= 1) return 0;
  return Math.round((r * (toRings - 1)) / (fromRings - 1));
}

function pairSubpaths(a: Subpath[], b: Subpath[]): MorphSub[] {
  const count = Math.max(a.length, b.length);
  const subs: MorphSub[] = [];
  for (let i = 0; i < count; i++) {
    const sa = a[Math.min(i, a.length - 1)];
    const sb = b[Math.min(i, b.length - 1)];
    const m = Math.max(sa.segs.length, sb.segs.length);
    subs.push({
      from: flatten(upsample(sa, m)),
      to: flatten(upsample(sb, m)),
      closed: sa.closed || sb.closed,
    });
  }
  return subs;
}

export function buildMorphPlan(
  svgA: string,
  svgB: string,
  options?: { fold?: number }
): MorphPlan {
  const a = extractPaths(svgA);
  const b = extractPaths(svgB);
  if (!a.length || !b.length) {
    throw new Error("Both SVGs must contain at least one <path> element");
  }
  const viewBox =
    /viewBox="([^"]*)"/.exec(svgA)?.[1] ??
    /viewBox="([^"]*)"/.exec(svgB)?.[1] ??
    "0 0 100 100";

  const fold = options?.fold ?? gcd(a.length, b.length);
  const ringsA = a.length / fold;
  const ringsB = b.length / fold;
  const rings = Math.max(ringsA, ringsB);

  const paths: MorphPath[] = [];
  for (let r = 0; r < rings; r++) {
    for (let p = 0; p < fold; p++) {
      const pa = a[mapRing(r, rings, ringsA) * fold + p];
      const pb = b[mapRing(r, rings, ringsB) * fold + p];
      const [fillFrom, fillTo] = pairFills(pa.fill, pb.fill);
      paths.push({
        subs: pairSubpaths(pa.subpaths, pb.subpaths),
        fillFrom,
        fillTo,
        opacityFrom: pa.fillOpacity,
        opacityTo: pb.fillOpacity,
        fillAnimates: JSON.stringify(fillFrom) !== JSON.stringify(fillTo),
      });
    }
  }
  return { viewBox, paths };
}

const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;

function hexColor(c: [number, number, number]): string {
  return (
    "#" +
    c
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  return hexColor([
    lerpNum(a[0], b[0], t),
    lerpNum(a[1], b[1], t),
    lerpNum(a[2], b[2], t),
  ]);
}

export function morphFill(path: MorphPath, t: number): FillState {
  const a = path.fillFrom;
  const b = path.fillTo;
  if (a.type === "raw") return { kind: "value", fill: a.value };
  if (a.type === "solid" && b.type === "solid") {
    return { kind: "value", fill: lerpColor(a.color, b.color, t) };
  }
  if (a.type === "gradient" && b.type === "gradient") {
    const g = a.grad;
    const h = b.grad;
    const dRot = ((((h.rot - g.rot + 180) % 360) + 360) % 360) - 180;
    return {
      kind: "gradient",
      cx: lerpNum(g.cx, h.cx, t),
      cy: lerpNum(g.cy, h.cy, t),
      r: lerpNum(g.r, h.r, t),
      transform: `translate(${lerpNum(g.tx, h.tx, t).toFixed(2)} ${lerpNum(g.ty, h.ty, t).toFixed(2)}) rotate(${(g.rot + dRot * t).toFixed(2)}) scale(${lerpNum(g.sx, h.sx, t).toFixed(3)} ${lerpNum(g.sy, h.sy, t).toFixed(3)})`,
      stops: g.stops.map((s, i) => ({
        offset: lerpNum(s.offset, h.stops[i].offset, t),
        color: lerpColor(s.color, h.stops[i].color, t),
        opacity: lerpNum(s.opacity, h.stops[i].opacity, t),
      })),
    };
  }
  return { kind: "value", fill: a.type === "solid" ? hexColor(a.color) : "none" };
}

export function morphPathD(path: MorphPath, t: number): string {
  let d = "";
  for (const sub of path.subs) {
    const { from, to } = sub;
    const n = from.length;
    const v = (i: number) => (from[i] + (to[i] - from[i]) * t).toFixed(2);
    d += `M${v(0)} ${v(1)}`;
    for (let i = 2; i < n; i += 6) {
      d += `C${v(i)} ${v(i + 1)} ${v(i + 2)} ${v(i + 3)} ${v(i + 4)} ${v(i + 5)}`;
    }
    if (sub.closed) d += "Z";
  }
  return d;
}
