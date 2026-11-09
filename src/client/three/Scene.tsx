import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera, Sky } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { House } from '../../shared/house';
import { sunDirection, sunPosition } from '../../shared/sun';
import { useApp } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { viewState } from '../viewState';
import { roomEnvironment } from './environment';
import { installDebugBridge } from './debug';
import { renderParams } from '../renderMode';
import { FurnitureLayer } from './Furniture';
import { HouseView } from './HouseView';
import { WalkControls } from './WalkControls';
import { WallHighlight } from './WallHighlight';
import { RoomFocus } from './RoomFocus';
import { KeyboardNav } from './KeyboardNav';

const POLAR = 0.95; // ~54° vanaf verticaal
const FOV = 40;
/** bovenaanzicht: (bijna) recht naar beneden; niet exact 0 zodat de draairichting behouden blijft */
const TOP_POLAR = 0.0008;
const isMobile = () => typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;

function houseExtent(house: House) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of house.levels[0].rooms)
    for (const [x, z] of r.polygon) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  return { center: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), size: Math.max(x1 - x0, z1 - z0) };
}

function roomExtent(house: House, roomId: string) {
  for (const level of house.levels)
    for (const r of level.rooms)
      if (r.id === roomId) {
        const xs = r.polygon.map((p) => p[0]);
        const zs = r.polygon.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
        return { center: new THREE.Vector3((x0 + x1) / 2, level.elevation, (z0 + z1) / 2), size: Math.max(x1 - x0, z1 - z0, 3) };
      }
  return null;
}

/** Meldt aan de server (headless browser) dat de afbeelding klaar is. */
function RenderReady() {
  const loaded = useApp((s) => s.loaded);
  const frames = useRef(0);
  const since = useRef(0);
  useFrame(() => {
    if (!renderParams || !loaded) return;
    if (!since.current) since.current = performance.now();
    frames.current += 1;
    // software-rendering is traag: een paar volledige frames na het laden is genoeg
    if (frames.current >= 4 && performance.now() - since.current > 800) (window as unknown as { __renderReady: boolean }).__renderReady = true;
  });
  return null;
}

/** zichtbare hoogte (m) in beeld, om tussen iso-zoom en perspectief-afstand te wisselen */
const visibleHeight = { value: 18 };

function CameraRig({ house }: { house: House }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const level = useApp((s) => s.level);
  const camMode = useApp((s) => s.camMode);
  const rotateRequest = useApp((s) => s.rotateRequest);
  const focusRequest = useApp((s) => s.focusRequest);
  const anim = useRef<{ az: number } | null>(null);
  const targetY = useRef(0);
  const lastRot = useRef(0);
  const initFor = useRef<THREE.Camera | null>(null);
  const persp = camMode === 'persp';
  const top = camMode === 'top';

  const place = (c: OrbitControlsImpl, target: THREE.Vector3, az: number, polar: number) => {
    const isPersp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const dist = isPersp ? visibleHeight.value / 2 / Math.tan((FOV / 2) * (Math.PI / 180)) : 80;
    c.target.copy(target);
    camera.position.set(target.x + dist * Math.sin(polar) * Math.sin(az), target.y + dist * Math.cos(polar), target.z + dist * Math.sin(polar) * Math.cos(az));
    if (!isPersp) {
      const cam = camera as THREE.OrthographicCamera;
      cam.zoom = size.height / visibleHeight.value;
      cam.updateProjectionMatrix();
    }
    c.update();
  };

  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    // eerste frame met deze camera: positie overnemen (ook bij wisselen iso/perspectief)
    if (initFor.current !== camera) {
      const first = initFor.current === null;
      if (first) {
        const st = useApp.getState();
        const focus = st.focusRoom ? roomExtent(house, st.focusRoom) : null;
        const { center, size: s } = focus ?? houseExtent(house);
        visibleHeight.value = s * (focus ? 1.6 : 1.25) * Math.max(1, size.height / size.width);
        place(c, center, st.azimuth, st.camMode === 'top' ? TOP_POLAR : camera.type === 'PerspectiveCamera' ? 0.85 : POLAR);
      } else {
        const mode = useApp.getState().camMode;
        const prev = c.getPolarAngle();
        // van bovenaanzicht naar iso/perspectief: weer schuin kijken
        const polar = mode === 'top' ? TOP_POLAR : prev < 0.05 ? (mode === 'persp' ? 0.85 : POLAR) : Math.min(prev, camera.type === 'OrthographicCamera' ? 1.25 : 1.5);
        // plattegrond: recht uitlijnen op de dichtstbijzijnde kwartslag (straat onder bij 0°)
        const az0 = useApp.getState().azimuth;
        const az = mode === 'top' ? Math.round(az0 / (Math.PI / 2)) * (Math.PI / 2) : az0;
        place(c, viewState.target.clone(), az, polar);
      }
      initFor.current = camera;
      invalidate();
    }
    const dy = targetY.current - c.target.y;
    if (Math.abs(dy) > 0.001) {
      const step = dy * Math.min(1, dt * 8);
      c.target.y += step;
      camera.position.y += step;
      c.update();
      invalidate();
    }
    if (anim.current) {
      const cur = c.getAzimuthalAngle();
      let diff = anim.current.az - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const stepAz = Math.abs(diff) < 0.002 ? diff : diff * Math.min(1, dt * 7);
      const offset = camera.position.clone().sub(c.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), stepAz);
      camera.position.copy(c.target).add(offset);
      c.update();
      if (Math.abs(diff) < 0.002) anim.current = null;
      invalidate();
    }
    viewState.target.copy(c.target);
    // zichtbare hoogte bijhouden voor het wisselen van camera
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) visibleHeight.value = size.height / (camera as THREE.OrthographicCamera).zoom;
    else visibleHeight.value = 2 * camera.position.distanceTo(c.target) * Math.tan((FOV / 2) * (Math.PI / 180));
    const az = c.getAzimuthalAngle();
    if (Math.abs(az - useApp.getState().azimuth) > 0.01) useApp.getState().setAzimuth(az);
  });

  useEffect(() => {
    const li = level === 'all' ? 1 : level;
    targetY.current = house.levels[Math.min(li, house.levels.length - 1)].elevation;
  }, [level, house]);

  useEffect(() => {
    if (!rotateRequest || !controls.current) return;
    const cur = controls.current.getAzimuthalAngle();
    const step = Math.PI / 2;
    const snapped = Math.round((cur - Math.PI / 4) / step) * step + Math.PI / 4;
    const dir = rotateRequest > lastRot.current ? 1 : -1;
    lastRot.current = rotateRequest;
    anim.current = { az: snapped + dir * step };
    invalidate();
  }, [rotateRequest]);

  useEffect(() => {
    if (!focusRequest || !controls.current) return;
    const roomId = useApp.getState().focusRoom;
    const focus = roomId ? roomExtent(house, roomId) : null;
    const { center, size: s } = focus ?? houseExtent(house);
    visibleHeight.value = s * (focus ? 1.6 : 1.25) * Math.max(1, size.height / size.width);
    if (focus) {
      // naar de verdieping van die kamer
      const li = house.levels.findIndex((l) => Math.abs(l.elevation - focus.center.y) < 0.01);
      if (li >= 0 && useApp.getState().level !== li) useApp.getState().setLevel(li);
    }
    place(controls.current, new THREE.Vector3(center.x, controls.current.target.y, center.z), controls.current.getAzimuthalAngle(), controls.current.getPolarAngle());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minPolarAngle={top ? TOP_POLAR : persp ? 0.15 : 0.45}
      maxPolarAngle={top ? TOP_POLAR : persp ? 1.5 : 1.25}
      minZoom={8}
      maxZoom={400}
      minDistance={1.5}
      maxDistance={120}
      screenSpacePanning={false}
      zoomSpeed={persp ? 2.2 : 1}
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}

/** Zon op de berekende stand voor Nijverdal, plus hemel- en omgevingslicht. */
function SunAndSky({ house }: { house: House }) {
  const { gl, scene, get } = useThree();
  const getCam = () => get().camera;
  const sun = useApp((s) => s.sun);
  const camMode = useApp((s) => s.camMode);
  const mobile = isMobile();

  const { dir, elevation } = useMemo(() => {
    const [y, m, d] = sun.date.split('-').map(Number);
    const date = new Date(y, m - 1, d, Math.floor(sun.minutes / 60), sun.minutes % 60);
    const p = sunPosition(date);
    return { dir: new THREE.Vector3(...sunDirection(p, house.north)), elevation: p.elevation };
  }, [sun, house]);

  const day = THREE.MathUtils.smoothstep(elevation, -4, 12);
  const sunStrength = THREE.MathUtils.smoothstep(elevation, -1, 8);
  // laag staande zon: warmer licht
  const sunColor = new THREE.Color().setHSL(0.09, 0.9, THREE.MathUtils.lerp(0.62, 0.97, THREE.MathUtils.smoothstep(elevation, 0, 25)));
  const center = useMemo(() => new THREE.Vector3(1.5, 0, 0), []);
  const pos = center.clone().add(dir.clone().multiplyScalar(60));

  useEffect(() => {
    gl.shadowMap.type = THREE.PCFShadowMap;
    // de zon staat stil: schaduw alleen opnieuw berekenen als er iets verandert (zie ShadowUpdater)
    gl.shadowMap.autoUpdate = !!renderParams;
    gl.shadowMap.needsUpdate = true;
    scene.environment = roomEnvironment(gl);
    if (import.meta.env.DEV) installDebugBridge(scene, gl, () => getCam());
    return () => {
      scene.environment = null;
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = 0.06 + 0.14 * day;
    scene.background = camMode !== 'iso' ? null : new THREE.Color().lerpColors(new THREE.Color('#1d2430'), new THREE.Color('#dfe7ec'), day);
  }, [scene, day, camMode]);

  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(center);
    return o;
  }, [center]);

  return (
    <>
      {camMode !== 'iso' && <Sky distance={4000} sunPosition={[dir.x, dir.y, dir.z]} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} mieDirectionalG={0.8} />}
      <hemisphereLight args={['#dfeaf5', '#9a8f7c', 0.15 + 0.55 * day]} />
      <primitive object={target} />
      <directionalLight
        position={pos}
        target={target}
        color={sunColor}
        intensity={4.2 * sunStrength}
        castShadow={sunStrength > 0}
        shadow-mapSize={[mobile || renderParams ? 2048 : 4096, mobile || renderParams ? 2048 : 4096]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
        shadow-radius={3}
      />
    </>
  );
}

/**
 * Werkt de schaduwkaart bij als zon, meubels, varianten of verdieping veranderen
 * (niet bij camerabewegingen: het licht en de schaduwcamera staan vast).
 */
function ShadowUpdater() {
  const { gl, invalidate } = useThree();
  const deps = useApp(useShallow((s) => [s.sun, s.placements, s.items, s.variants, s.active, s.level, s.camMode] as const));
  useEffect(() => {
    // twee frames: de eerste na het opbouwen van nieuwe objecten, de tweede voor de zekerheid
    gl.shadowMap.needsUpdate = true;
    invalidate();
    const t = setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, invalidate, ...deps]);
  return null;
}

function Effects() {
  const mobile = isMobile();
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={0.8} distanceFalloff={0.6} intensity={2.2} quality={mobile || renderParams ? 'performance' : 'medium'} />
      <SMAA />
    </EffectComposer>
  );
}

export function Scene({ house }: { house: House }) {
  const camMode = useApp((s) => s.camMode);
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return (
    <Canvas
      shadows
      // alleen tekenen als er iets verandert; tijdens rondlopen (en voor afbeeldingen) continu
      frameloop={camMode === 'walk' || renderParams ? 'always' : 'demand'}
      // vaste resolutie: geen wisselingen tijdens bewegen (die gaven flikkering)
      dpr={renderParams ? 1 : coarse ? [1, 1.5] : [1, 1.75]}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      <OrthographicCamera makeDefault={camMode === 'iso'} position={[-40, 50, 60]} near={1} far={600} zoom={40} />
      <OrthographicCamera makeDefault={camMode === 'top'} position={[0, 80, 0]} near={1} far={600} zoom={40} />
      {/* near/far zo krap mogelijk: betere dieptenauwkeurigheid, geen z-fighting op afstand */}
      <PerspectiveCamera makeDefault={camMode === 'persp'} position={[-20, 20, 30]} fov={FOV} near={0.3} far={5000} />
      <PerspectiveCamera makeDefault={camMode === 'walk'} position={[0, 1.6, 0]} fov={72} near={0.08} far={5000} />
      {camMode === 'walk' ? <WalkControls house={house} /> : <CameraRig house={house} />}
      {camMode !== 'walk' && !renderParams && <KeyboardNav />}
      <SunAndSky house={house} />
      <Suspense fallback={null}>
        <HouseView house={house} />
        <FurnitureLayer house={house} />
        <WallHighlight house={house} />
        <RoomFocus house={house} />
      </Suspense>
      <Effects />
      <ShadowUpdater />
      <RenderReady />
    </Canvas>
  );
}
