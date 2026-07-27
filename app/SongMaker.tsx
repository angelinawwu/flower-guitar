"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildMorphPlan, type MorphPlan } from "../lib/flower-morph";
import { playFlowerNote, type FlowerKind } from "../lib/sounds";
import BloomFlower, { type BloomFlowerHandle } from "./BloomFlower";
import ShaderOverlay from "./ShaderOverlay";

import { Play, Pause, ArrowCounterClockwise } from "@phosphor-icons/react";

const COLS = 32;
const ROWS = 14;

/**
 * Row -> semitone transposition (major pentatonic). Row 0 is the top of the
 * grid: only slightly above each sound's default pitch. The bottom row is
 * substantially lower (about 2.25 octaves down).
 */
const ROW_SEMITONES = [
  4, 2, 0, -3, -5, -8, -10, -12, -15, -17, -20, -22, -24, -27,
];

interface Note {
  col: number;
  row: number;
  flower: FlowerKind;
}

type Notes = Map<string, Note>;

const keyOf = (col: number, row: number) => `${col}:${row}`;

interface SongMakerProps {
  svgs: Record<FlowerKind, { closed: string; open: string }>;
}

const FLOWERS: FlowerKind[] = ["A", "B", "C"];

const FLOWER_INDEX: Record<FlowerKind, number> = { A: 0, B: 1, C: 2 };

export default function SongMaker({ svgs }: SongMakerProps) {
  const plans = useMemo<Record<FlowerKind, MorphPlan>>(
    () => ({
      A: buildMorphPlan(svgs.A.closed, svgs.A.open),
      B: buildMorphPlan(svgs.B.closed, svgs.B.open),
      C: buildMorphPlan(svgs.C.closed, svgs.C.open),
    }),
    [svgs]
  );

  const [notes, setNotes] = useState<Notes>(() => new Map());
  const [selected, setSelected] = useState<FlowerKind>("A");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5); // columns per second
  const [hoverCell, setHoverCell] = useState<{ col: number; row: number } | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [drag, setDrag] = useState<{
    key: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const [isHoldingClear, setIsHoldingClear] = useState(false);
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startClearHold = () => {
    setIsHoldingClear(true);
    clearTimerRef.current = setTimeout(() => {
      setNotes(new Map());
      setIsHoldingClear(false);
    }, 750);
  };

  const cancelClearHold = () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setIsHoldingClear(false);
  };

  const gridRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const bloomRefs = useRef<Map<string, BloomFlowerHandle>>(new Map());
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const positionRef = useRef(0); // playhead position in columns (float)
  const paletteRefs = useRef<Map<FlowerKind, BloomFlowerHandle>>(new Map());
  const lastPaintedCellRef = useRef<{ col: number; row: number } | null>(null);
  const isPaintingRef = useRef(isPainting);
  isPaintingRef.current = isPainting;

  const triggerColumn = useCallback((col: number) => {
    for (const [key, note] of notesRef.current) {
      if (note.col !== col) continue;
      playFlowerNote(note.flower, ROW_SEMITONES[note.row], speedRef.current);
      bloomRefs.current.get(key)?.bloom();
    }
  }, []);

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      const prev = positionRef.current;
      let next = prev + dt * speedRef.current;
      const prevCol = Math.floor(prev);
      let nextCol = Math.floor(next);
      // fire every column boundary crossed (handles wrap + fast tempos)
      for (let c = prevCol + 1; c <= nextCol; c++) {
        triggerColumn(c % COLS);
      }
      if (next >= COLS) {
        next -= COLS;
        nextCol = Math.floor(next);
      }
      positionRef.current = next;
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${(next / COLS) * 100}cqw)`;
      }
      raf = requestAnimationFrame(frame);
    };
    // fire column 0 immediately when starting from the very beginning
    if (positionRef.current === 0) triggerColumn(0);
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, triggerColumn]);

  const cellFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { col, row };
  }, []);

  const getCellsOnLine = useCallback(
    (p0: { col: number; row: number }, p1: { col: number; row: number }) => {
      const cells: Array<{ col: number; row: number }> = [];
      const dx = Math.abs(p1.col - p0.col);
      const dy = Math.abs(p1.row - p0.row);
      const sx = p0.col < p1.col ? 1 : -1;
      const sy = p0.row < p1.row ? 1 : -1;
      let err = dx - dy;

      let currCol = p0.col;
      let currRow = p0.row;

      while (true) {
        if (currCol >= 0 && currCol < COLS && currRow >= 0 && currRow < ROWS) {
          cells.push({ col: currCol, row: currRow });
        }
        if (currCol === p1.col && currRow === p1.row) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          currCol += sx;
        }
        if (e2 < dx) {
          err += dx;
          currRow += sy;
        }
      }
      return cells;
    },
    []
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const key = keyOf(cell.col, cell.row);
    gridRef.current?.setPointerCapture(e.pointerId);

    if (notes.has(key)) {
      // potential drag (or click-to-remove on pointerup)
      setDrag({ key, x: e.clientX, y: e.clientY, moved: false });
    } else {
      const note: Note = { col: cell.col, row: cell.row, flower: selected };
      setNotes((prev) => {
        const next = new Map(prev);
        next.set(key, note);
        return next;
      });
      playFlowerNote(selected, ROW_SEMITONES[cell.row], speed);
      requestAnimationFrame(() => bloomRefs.current.get(key)?.bloom());
      setIsPainting(true);
      lastPaintedCellRef.current = cell;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag) {
      const moved =
        drag.moved ||
        Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5;
      setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
      setHoverCell(moved ? cellFromEvent(e) : null);
    } else if (isPaintingRef.current && lastPaintedCellRef.current) {
      const currentCell = cellFromEvent(e);
      if (!currentCell) return;
      setHoverCell(currentCell);

      const path = getCellsOnLine(lastPaintedCellRef.current, currentCell);
      lastPaintedCellRef.current = currentCell;

      const newNotesToBloom: Array<{ key: string; row: number; flower: FlowerKind }> = [];

      setNotes((prev) => {
        let changed = false;
        const next = new Map(prev);

        for (const c of path) {
          const k = keyOf(c.col, c.row);
          const existingNote = next.get(k);
          if (!existingNote || existingNote.flower !== selected) {
            next.set(k, { col: c.col, row: c.row, flower: selected });
            newNotesToBloom.push({ key: k, row: c.row, flower: selected });
            changed = true;
          }
        }

        return changed ? next : prev;
      });

      if (newNotesToBloom.length > 0) {
        for (const item of newNotesToBloom) {
          playFlowerNote(item.flower, ROW_SEMITONES[item.row], speed);
        }
        requestAnimationFrame(() => {
          for (const item of newNotesToBloom) {
            bloomRefs.current.get(item.key)?.bloom();
          }
        });
      }
    } else {
      setHoverCell(cellFromEvent(e));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (gridRef.current?.hasPointerCapture(e.pointerId)) {
      gridRef.current.releasePointerCapture(e.pointerId);
    }
    if (isPainting) {
      setIsPainting(false);
      lastPaintedCellRef.current = null;
    }
    if (!drag) return;
    const cell = cellFromEvent(e);
    setNotes((prev) => {
      const next = new Map(prev);
      const note = next.get(drag.key);
      if (!note) return prev;
      if (!drag.moved) {
        // simple click on a flower removes it
        next.delete(drag.key);
        return next;
      }
      if (cell) {
        const targetKey = keyOf(cell.col, cell.row);
        if (targetKey === drag.key || !next.has(targetKey)) {
          next.delete(drag.key);
          next.set(targetKey, { ...note, col: cell.col, row: cell.row });
          if (targetKey !== drag.key) {
            playFlowerNote(note.flower, ROW_SEMITONES[cell.row], speed);
          }
        }
      }
      return next;
    });
    setDrag(null);
  };

  const togglePlay = () => {
    setPlaying((p) => {
      if (p && playheadRef.current) {
        // keep playhead visible where it paused
        return false;
      }
      return !p;
    });
  };

  const restart = () => {
    positionRef.current = 0;
    if (playheadRef.current) playheadRef.current.style.transform = "translateX(0)";
    setPlaying(false);
  };

  const dragNote = drag ? notes.get(drag.key) : undefined;
  const gridRect = gridRef.current?.getBoundingClientRect();

  return (
    <div className="flex h-dvh flex-col bg-[#1E1E1E] text-zinc-300 select-none">
      <ShaderOverlay />
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="btn-tactile flex h-11 w-11 items-center justify-center rounded-none text-white/50 hover:bg-white/10 hover:text-white"
        >
          {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button
          onClick={restart}
          aria-label="Restart"
          className="btn-tactile flex h-11 w-11 items-center justify-center rounded-none text-white/50 hover:bg-white/10 hover:text-white"
        >
          <ArrowCounterClockwise weight="bold" />
        </button>

        <div className="mx-2 h-6 w-px bg-white/10" />

        {/* Flower palette */}
        <div className="flex items-center gap-1.5">
          {FLOWERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setSelected(f);
                paletteRefs.current.get(f)?.bloom();
                playFlowerNote(f, 0, speed);
              }}
              aria-label={`Select flower ${f}`}
              aria-pressed={selected === f}
              className={`palette-btn group flex h-11 w-11 items-center justify-center rounded-none ${selected === f
                ? "bg-white/20 ring-1 ring-white/30 text-white"
                : "text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
            >
              <BloomFlower
                ref={(h) => {
                  if (h) paletteRefs.current.set(f, h);
                  else paletteRefs.current.delete(f);
                }}
                plan={plans[f]}
                flowerKind={f}
                isHovered={selected === f}
                className="h-8 w-8"
              />
            </button>
          ))}
        </div>

        <div className="mx-2 h-6 w-px bg-white/10" />

        {/* Speed slider */}
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-medium uppercase tracking-wider text-white/50">
            Speed
          </span>
          <input
            type="range"
            min={1.5}
            max={12}
            step={0.5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="speed-slider w-36"
            aria-label="Song speed"
          />
          <span className="w-8 text-xs tabular-nums text-white/50">
            {speed.toFixed(1)}
          </span>
        </div>

        <div className="flex-1" />

        <button
          onPointerDown={startClearHold}
          onPointerUp={cancelClearHold}
          onPointerLeave={cancelClearHold}
          onPointerCancel={cancelClearHold}
          aria-label="Hold to clear grid"
          className="btn-tactile relative flex h-11 items-center justify-center px-4 rounded-none text-xs font-medium uppercase tracking-wider text-white/50 hover:bg-white/10 hover:text-white overflow-hidden select-none"
        >
          <span className="relative z-10">Hold Clear</span>
          <div
            className="absolute inset-0 bg-red-500/25 pointer-events-none"
            style={{
              clipPath: isHoldingClear ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
              transition: isHoldingClear
                ? "clip-path 750ms linear"
                : "clip-path 200ms cubic-bezier(.25, .46, .45, .94)",
            }}
          />
        </button>
      </div>

      {/* Grid */}
      <div className="relative flex-1 overflow-x-auto overflow-y-hidden border-t border-white/10 touch-pan-x">
        <div
          ref={gridRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => !drag && !isPainting && setHoverCell(null)}
          className="song-grid relative h-full cursor-pointer touch-none"
          style={
            {
              "--cols": COLS,
              "--rows": ROWS,
              aspectRatio: `${COLS} / ${ROWS}`,
              minWidth: "max-content",
            } as React.CSSProperties
          }
        >
          {/* hover ghost */}
          {hoverCell && !dragNote && !notes.has(keyOf(hoverCell.col, hoverCell.row)) && (
            <div
              className="pointer-events-none absolute opacity-30"
              style={{
                left: `${(hoverCell.col / COLS) * 100}%`,
                top: `${(hoverCell.row / ROWS) * 100}%`,
                width: `${100 / COLS}%`,
                height: `${100 / ROWS}%`,
              }}
            >
              <div className="absolute inset-0 scale-[3]">
                <BloomFlower
                  plan={plans[selected]}
                  flowerKind={selected}
                  isHovered={true}
                  className="h-full w-full p-[8%]"
                />
              </div>
            </div>
          )}

          {/* drop target ghost while dragging */}
          {dragNote && drag?.moved && hoverCell && (
            <div
              className="pointer-events-none absolute rounded-none bg-white/5 ring-1 ring-white/15"
              style={{
                left: `${(hoverCell.col / COLS) * 100}%`,
                top: `${(hoverCell.row / ROWS) * 100}%`,
                width: `${100 / COLS}%`,
                height: `${100 / ROWS}%`,
              }}
            />
          )}

          {/* placed flowers */}
          {[...notes.entries()].map(([key, note]) => {
            const isDragging = drag?.key === key && drag.moved;
            return (
              <div
                key={key}
                className="pointer-events-none absolute"
                style={
                  isDragging && gridRect
                    ? {
                      left: drag.x - gridRect.left,
                      top: drag.y - gridRect.top,
                      width: `${100 / COLS}%`,
                      height: `${100 / ROWS}%`,
                      transform: "translate(-50%, -50%) scale(1.15)",
                      zIndex: 10,
                      filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
                      transition: "none",
                    }
                    : {
                      left: `${(note.col / COLS) * 100}%`,
                      top: `${(note.row / ROWS) * 100}%`,
                      width: `${100 / COLS}%`,
                      height: `${100 / ROWS}%`,
                      transform: "translate(0, 0) scale(1)",
                      filter: "drop-shadow(0 0 0 rgba(0,0,0,0))",
                      transition: "transform 180ms cubic-bezier(.215, .61, .355, 1), filter 180ms ease-out, left 180ms cubic-bezier(.215, .61, .355, 1), top 180ms cubic-bezier(.215, .61, .355, 1)",
                    }
                }
              >
                <div className="absolute inset-0 scale-[3]">
                  <BloomFlower
                    ref={(h) => {
                      if (h) bloomRefs.current.set(key, h);
                      else bloomRefs.current.delete(key);
                    }}
                    plan={plans[note.flower]}
                    flowerKind={note.flower}
                    isHovered={hoverCell?.col === note.col && hoverCell?.row === note.row}
                    className="h-full w-full p-[6%]"
                  />
                </div>
              </div>
            );
          })}

          {/* playhead */}
          <div
            ref={playheadRef}
            className="pointer-events-none absolute inset-y-0 left-0 z-20 will-change-transform"
            style={{
              width: `${100 / COLS}%`,
              visibility: playing || positionRef.current > 0 ? "visible" : "hidden",
            }}
          >
            <div className="absolute inset-y-0 left-0 w-px bg-white/40" />
            <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent" />
          </div>
        </div>
      </div>
      <div className="orientation-warning portrait:flex hidden fixed inset-0 z-50 bg-[#1c1c1c] items-center justify-center p-8 text-center text-zinc-300">
        Please turn your phone to landscape mode for the best experience.
      </div>
    </div>
  );
}
