import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { House } from '../../shared/house';
import { PASSAGE_OK, PASSAGE_TIGHT, clearance } from '../../shared/clearance';
import { useApp, visiblePlacements } from '../store';

const STYLE = {
  tight: { line: '#ee7d74', bg: '#ee7d74', fg: '#1d0b09' },
  narrow: { line: '#e8b04a', bg: '#e8b04a', fg: '#1c1508' },
  ok: { line: '#dfe9e2', bg: 'rgba(10,12,11,0.82)', fg: '#d3eadb' },
};
type Kind = keyof typeof STYLE;

/** labeltextuur (pil met tekst), gedeeld per tekst+soort */
const texCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
function labelTexture(text: string, kind: Kind) {
  const key = `${kind}|${text}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const s = STYLE[kind];
  const scale = 3;
  const font = `600 ${12 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + 18 * scale);
  const h = 22 * scale;
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = s.bg;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, h / 2);
  ctx.fill();
  if (kind === 'ok') {
    ctx.strokeStyle = 'rgba(196,226,207,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = s.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + scale);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const out = { tex, aspect: w / h };
  texCache.set(key, out);
  return out;
}

/** tekstlabel dat altijd naar de camera kijkt en op het scherm even groot blijft */
function Label({ position, text, kind }: { position: [number, number, number]; text: string; kind: Kind }) {
  const { tex, aspect } = labelTexture(text, kind);
  const material = useMemo(() => new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }), [tex]);
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<THREE.Sprite>(null);
  // vaste grootte op het scherm (22 px hoog), voor zowel de iso- als de perspectiefcamera
  useFrame(({ camera, size }) => {
    const s = ref.current;
    if (!s) return;
    let perPx: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const c = camera as THREE.OrthographicCamera;
      perPx = (c.top - c.bottom) / c.zoom / size.height;
    } else {
      const c = camera as THREE.PerspectiveCamera;
      perPx = (2 * c.position.distanceTo(s.position) * Math.tan((c.fov * Math.PI) / 360)) / size.height;
    }
    const h = 22 * perPx;
    s.scale.set(h * aspect, h, 1);
  });
  return <sprite ref={ref} position={position} material={material} renderOrder={6} />;
}

/**
 * Maatlijnen rond het geselecteerde meubel (ook tijdens slepen): vrije ruimte tot muur,
 * inbouw of ander meubel. Rood < 60 cm, oranje < 70 cm.
 */
export function ClearanceOverlay({ house }: { house: House }) {
  const selectedId = useApp((s) => s.selectedId);
  const placements = useApp((s) => s.placements);
  const variants = useApp((s) => s.variants);
  const active = useApp((s) => s.active);
  const items = useApp((s) => s.items);
  const level = useApp((s) => s.level);
  const editMode = useApp((s) => s.editMode);
  const camMode = useApp((s) => s.camMode);

  const data = useMemo(() => {
    if (!selectedId || level === 'all' || !editMode || camMode === 'walk') return null;
    const visible = visiblePlacements({ placements, variants, active });
    const p = visible.find((q) => q.id === selectedId);
    if (!p || p.levelId !== house.levels[level].id) return null;
    return { result: clearance(house, p, visible, items), elevation: house.levels[level].elevation };
  }, [selectedId, placements, variants, active, items, level, editMode, camMode, house]);

  if (!data) return null;
  const y = data.elevation + 0.02;
  return (
    <group>
      {data.result.gaps
        .filter((g) => g.dist >= 0.02)
        .map((g) => {
          const kind: Kind = g.dist < PASSAGE_TIGHT ? 'tight' : g.dist < PASSAGE_OK ? 'narrow' : 'ok';
          const color = STYLE[kind].line;
          const len = g.dist;
          const mid: [number, number, number] = [(g.from[0] + g.to[0]) / 2, y, (g.from[1] + g.to[1]) / 2];
          const angle = Math.atan2(-(g.to[1] - g.from[1]), g.to[0] - g.from[0]);
          return (
            <group key={g.side}>
              <group position={mid} rotation-y={angle}>
                <mesh renderOrder={5}>
                  <boxGeometry args={[len, 0.008, 0.018]} />
                  <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
                </mesh>
                {/* eindstreepjes */}
                {[-len / 2, len / 2].map((x) => (
                  <mesh key={x} position={[x, 0, 0]} renderOrder={5}>
                    <boxGeometry args={[0.012, 0.008, 0.14]} />
                    <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
                  </mesh>
                ))}
              </group>
              <Label position={[mid[0], y + 0.05, mid[2]]} text={`${Math.round(g.dist * 100)} cm`} kind={kind} />
            </group>
          );
        })}
    </group>
  );
}
