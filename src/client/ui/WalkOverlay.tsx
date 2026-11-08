import { useRef, useState } from 'react';
import { useApp } from '../store';
import { walkInput } from '../walkInput';
import { Icon } from './Icon';

const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Joystick (touch) en uitleg voor de rondloopmodus. */
export function WalkOverlay() {
  const setCamMode = useApp((s) => s.setCamMode);
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const active = useRef<number | null>(null);

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const max = r.width / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    setKnob({ x: dx, y: dy });
    walkInput.moveX = dx / max;
    walkInput.moveY = -dy / max;
  };
  const end = () => {
    active.current = null;
    setKnob(null);
    walkInput.moveX = 0;
    walkInput.moveY = 0;
  };

  return (
    <>
      <div className="walk-hint glass">
        {coarse ? 'Joystick = lopen · vegen = rondkijken' : 'Klik in beeld om rond te kijken · WASD/pijltjes = lopen · Shift = rennen · Esc = muis los'}
        <button className="small" onClick={() => setCamMode('persp')}>
          <Icon name="close" size={14} /> Stoppen
        </button>
      </div>
      {coarse && (
        <div
          ref={base}
          className="joystick glass"
          onPointerDown={(e) => {
            active.current = e.pointerId;
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* niet beschikbaar: werkt ook zonder */
            }
            update(e);
          }}
          onPointerMove={(e) => active.current === e.pointerId && update(e)}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <div className="joystick-knob" style={{ transform: `translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)` }} />
        </div>
      )}
      <div className="crosshair" />
    </>
  );
}
