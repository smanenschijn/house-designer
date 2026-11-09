import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Item } from '../../shared/recipe';
import { useApp } from '../store';
import { roomEnvironment } from './environment';
import { useItemObject } from './Furniture';
import { pendingModels } from './glbModel';

/**
 * Voorvertoning van één meubel (rendermodus ?render={item:…}) voor Claude:
 * op ware grootte, op een vloer met een raster van 10 cm, met de maten in beeld.
 */
export function ItemStage({ itemId, azimuth, elevation }: { itemId: string; azimuth: number; elevation: number }) {
  const item = useApp((s) => s.items.find((i) => i.id === itemId));
  const loaded = useApp((s) => s.loaded);
  if (!loaded) return null;
  if (!item) return <div className="stage-label">Meubel niet gevonden</div>;
  const s = item.recipe.size;
  return (
    <>
      <Canvas shadows dpr={1} frameloop="always" gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}>
        <Stage item={item} azimuth={azimuth} elevation={elevation} />
      </Canvas>
      <div className="stage-label">
        <strong>{item.name}</strong>
        <span>
          {Math.round(s.width * 100)} × {Math.round(s.depth * 100)} × {Math.round(s.height * 100)} cm (b × d × h) · raster 10 cm
        </span>
      </div>
    </>
  );
}

function gridTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ece9e3';
  ctx.fillRect(0, 0, 512, 512);
  // 1 m per textuur: dunne lijnen per 10 cm, dikkere per 50 cm en 1 m
  for (let i = 0; i <= 10; i++) {
    const p = (i / 10) * 512;
    ctx.fillStyle = i % 10 === 0 ? 'rgba(0,0,0,0.32)' : i % 5 === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.09)';
    const w = i % 5 === 0 ? 3 : 1.5;
    ctx.fillRect(p - w / 2, 0, w, 512);
    ctx.fillRect(0, p - w / 2, 512, w);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function Stage({ item, azimuth, elevation }: { item: Item; azimuth: number; elevation: number }) {
  const { gl, scene, camera } = useThree();
  const obj = useItemObject(item);
  const { width, depth, height } = item.recipe.size;
  const floorSize = Math.max(4, Math.ceil(Math.max(width, depth) * 2.5));
  const grid = useMemo(() => {
    const t = gridTexture();
    t.repeat.set(floorSize, floorSize);
    return t;
  }, [floorSize]);

  useEffect(() => {
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.environment = roomEnvironment(gl);
    scene.environmentIntensity = 0.3;
    scene.background = new THREE.Color('#e4e1db');
  }, [gl, scene]);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 30;
    const center = new THREE.Vector3(0, height / 2, 0);
    const radius = Math.max(0.25, Math.hypot(width, depth, height) / 2);
    const dist = (radius / Math.sin(((cam.fov / 2) * Math.PI) / 180)) * 1.08;
    const az = (azimuth * Math.PI) / 180;
    const el = (elevation * Math.PI) / 180;
    // azimuth 0 = recht van voren (voorkant wijst naar +z)
    cam.position.set(Math.sin(az) * Math.cos(el) * dist, center.y + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    cam.near = dist / 50;
    cam.far = dist * 10;
    cam.lookAt(center);
    cam.updateProjectionMatrix();
  }, [camera, width, depth, height, azimuth, elevation]);

  // klaarmelden zodra het object er staat (en alle modellen geladen zijn)
  const frames = useRef(0);
  useFrame(() => {
    if (!obj || pendingModels() > 0) return;
    frames.current += 1;
    if (frames.current >= 4) (window as unknown as { __renderReady: boolean }).__renderReady = true;
  });

  const r = Math.max(width, depth, height);
  return (
    <>
      <hemisphereLight args={['#ffffff', '#b9ad96', 0.45]} />
      <directionalLight
        position={[-r * 1.6, r * 3, r * 2.2]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r * 1.5}
        shadow-camera-right={r * 1.5}
        shadow-camera-top={r * 1.5}
        shadow-camera-bottom={-r * 1.5}
        shadow-bias={-0.0002}
        shadow-normalBias={0.01}
      />
      <directionalLight position={[r * 2, r, -r]} intensity={0.4} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial map={grid} roughness={0.95} />
      </mesh>
      {obj && <primitive object={obj} position={[0, item.recipe.elevation ?? 0, 0]} />}
    </>
  );
}
