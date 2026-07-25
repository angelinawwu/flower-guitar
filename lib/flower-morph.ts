type Pt = [number, number];
type Seg = [Pt, Pt, Pt];

interface Subpath {
  start: Pt;
  segs: Seg[];
  closed: boolean;
}

interface ParsedPath {
  subpaths: Subpath[];
  fill: string;
  fillOpacity: string;
}

export interface MorphSub {
  from: number[];
  to: number[];
  closed: boolean;
}

export interface MorphPath {
  subs: MorphSub[];
  fill: string;
  fillOpacity: string;
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

function extractPaths(svg: string): ParsedPath[] {
  const paths: ParsedPath[] = [];
  const tagRe = /<path\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(svg))) {
    const tag = match[0];
    const d = /\bd="([^"]*)"/.exec(tag)?.[1];
    if (!d) continue;
    paths.push({
      subpaths: parsePathD(d),
      fill: /\bfill="([^"]*)"/.exec(tag)?.[1] ?? "currentColor",
      fillOpacity: /\bfill-opacity="([^"]*)"/.exec(tag)?.[1] ?? "1",
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
      paths.push({
        subs: pairSubpaths(pa.subpaths, pb.subpaths),
        fill: pa.fill,
        fillOpacity: pa.fillOpacity,
      });
    }
  }
  return { viewBox, paths };
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
