'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A signature box.
 *
 * Draws to a canvas and writes a PNG data URL into a hidden input, so the
 * signature travels with the form it belongs to rather than through a separate
 * upload — which matters because a signature is only evidence of anything if it
 * is written in the same transaction as the thing it signs.
 *
 * POINTER EVENTS, not mouse events. Most people signing a register in a school
 * are doing it on a phone or a tablet at a desk by the door, and a mouse-only
 * pad is a pad that works for nobody who actually uses it. Pointer events cover
 * mouse, touch and stylus in one path.
 *
 * The canvas is deliberately small — 600×200 backing store. A signature is a
 * few strokes of ink, and a retina-scaled 2000px canvas would produce a data
 * URL tens of times larger for no visible gain, on a row that is read back on
 * every timesheet page.
 */

const WIDTH = 600;
const HEIGHT = 200;

export function SignaturePad({
  name,
  label = 'Signature',
  hint,
  required = false,
  defaultValue = null,
}: {
  /** The form field the PNG data URL is written into. */
  name: string;
  label?: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(defaultValue));

  const context = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Ink is always dark, whatever the page theme is doing. The canvas is
    // exported as a PNG with a transparent ground, and a signature drawn in a
    // theme colour would be invisible against the paper it prints on.
    ctx.strokeStyle = '#0f172a';
    return ctx;
  }, []);

  useEffect(() => {
    if (!defaultValue) return;
    const ctx = context();
    if (!ctx) return;
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
    image.src = defaultValue;
  }, [defaultValue, context]);

  /** Canvas coordinates from a pointer event, accounting for CSS scaling. */
  function pointAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    if (!ctx) return;
    // Capture keeps the stroke going when a finger slides off the box, which is
    // what happens to the tail of almost every real signature.
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = pointAt(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setHasInk(true);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = pointAt(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone; nothing to release and nothing to fix.
    }
    commit();
  }

  function commit() {
    const canvas = canvasRef.current;
    const input = inputRef.current;
    if (!canvas || !input) return;
    input.value = canvas.toDataURL('image/png');
  }

  function clear() {
    const ctx = context();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (inputRef.current) inputRef.current.value = '';
    setHasInk(false);
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-rose-600">*</span>}
        </label>
        {hasInk && (
          <button
            type="button"
            onClick={clear}
            className="text-[11px] font-medium text-slate-500 underline hover:text-slate-800"
          >
            Clear
          </button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          // Without this a touch drag scrolls the page instead of drawing, which
          // makes the pad unusable on exactly the devices it is for.
          className="block h-28 w-full cursor-crosshair touch-none"
        />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-slate-400">
            Sign here
          </span>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 bottom-5 border-b border-slate-200"
        />
      </div>

      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}

      <input ref={inputRef} type="hidden" name={name} defaultValue={defaultValue ?? ''} />

      {/*
        A canvas is invisible to anybody working without one, so the same field
        can be typed instead. A typed name is a weaker signature than a drawn
        one, but it is a far better record than a form a person cannot complete.
      */}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-800">
          Cannot draw? Type your name instead
        </summary>
        <input
          type="text"
          placeholder="Full name, typed"
          onChange={(e) => {
            const value = e.target.value.trim();
            if (!inputRef.current) return;
            if (!value) {
              clear();
              return;
            }
            const ctx = context();
            const canvas = canvasRef.current;
            if (!ctx || !canvas) return;
            ctx.clearRect(0, 0, WIDTH, HEIGHT);
            ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
            ctx.fillStyle = '#0f172a';
            ctx.textBaseline = 'middle';
            ctx.fillText(value.slice(0, 40), 24, HEIGHT / 2);
            setHasInk(true);
            commit();
          }}
          className="mt-1 h-8 w-full rounded-lg border-0 px-2 text-xs text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
        />
      </details>
    </div>
  );
}
