import { useMemo, useState } from 'react';
import { compassName, sunPosition } from '../../shared/sun';
import { useApp } from '../store';
import { Icon } from './Icon';

const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const PRESETS: [string, string][] = [
  ['Lente', '03-21'],
  ['Zomer', '06-21'],
  ['Herfst', '09-22'],
  ['Winter', '12-21'],
];

/** Zonnestand instellen: datum en tijd, met snelkeuzes voor de seizoenen. */
export function SunControl() {
  const sun = useApp((s) => s.sun);
  const setSun = useApp((s) => s.setSun);
  const lamps = useApp((s) => s.lamps);
  const setLamps = useApp((s) => s.setLamps);
  const [open, setOpen] = useState(false);

  const pos = useMemo(() => {
    const [y, m, d] = sun.date.split('-').map(Number);
    return sunPosition(new Date(y, m - 1, d, Math.floor(sun.minutes / 60), sun.minutes % 60));
  }, [sun]);
  const up = pos.elevation > 0;
  const year = sun.date.slice(0, 4);

  return (
    <div className="sunctl">
      <button className={`icon ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Zon en lichtinval" aria-label="Zon">
        <Icon name={up ? 'sun' : 'moon'} />
      </button>
      {open && (
        <div className="sun-pop glass">
          <div className="sun-head">
            <strong>{fmtTime(sun.minutes)}</strong>
            <span className="muted small-text">
              {up ? `zon in het ${compassName(pos.azimuth)}, ${Math.round(pos.elevation)}° hoog` : 'zon onder'}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={24 * 60 - 15}
            step={15}
            value={sun.minutes}
            onChange={(e) => setSun({ minutes: Number(e.target.value) })}
            aria-label="Tijd"
          />
          <div className="row">
            <input type="date" value={sun.date} onChange={(e) => e.target.value && setSun({ date: e.target.value })} aria-label="Datum" />
          </div>
          <div className="row presets">
            {PRESETS.map(([label, md]) => (
              <button key={label} className={`small ${sun.date.endsWith(md) ? 'on' : ''}`} onClick={() => setSun({ date: `${year}-${md}` })}>
                {label}
              </button>
            ))}
            <button className="small" onClick={() => setSun({ date: new Date().toISOString().slice(0, 10) })}>
              Vandaag
            </button>
          </div>
          <div className="row presets">
            <button className="small" onClick={() => setSun({ minutes: 8 * 60 })}>
              Ochtend
            </button>
            <button className="small" onClick={() => setSun({ minutes: 14 * 60 })}>
              Middag
            </button>
            <button className={`small ${!up ? 'on' : ''}`} onClick={() => setSun({ minutes: 22 * 60 })} title="Avondsfeer: lampen aan">
              Avond
            </button>
          </div>
          <div className="lamp-row">
            <span className="muted small-text">
              <Icon name="bulb" size={14} /> Lampen
            </span>
            <div className="seg mini">
              {(
                [
                  ['auto', 'Auto', 'Aan na zonsondergang'],
                  ['on', 'Aan', 'Altijd aan'],
                  ['off', 'Uit', 'Altijd uit'],
                ] as const
              ).map(([m, label, title]) => (
                <button key={m} className={lamps === m ? 'on' : ''} onClick={() => setLamps(m)} title={title}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small-text">Waalstraat 16, Nijverdal. Voorgevel op het westen, tuin op het oosten.</p>
        </div>
      )}
    </div>
  );
}
