import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { House } from '../../shared/house';
import { useApp } from '../store';
import { HouseView } from './HouseView';
import { FurnitureLayer } from './Furniture';
import { viewState } from '../viewState';
import { roomEnvironment } from './environment';

const POLAR = 0.95; // ~54° vanaf verticaal: isometrisch gevoel
const RADIUS = 80;

function houseCenter(house: House, levelIndex: number) {
  const lv = house.levels[Math.min(levelIndex, house.levels.length - 1)];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of house.levels[0].rooms)
    for (const [x, z] of r.polygon) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  return { center: new THREE.Vector3((x0 + x1) / 2, lv.elevation, (z0 + z1) / 2), size: Math.max(x1 - x0, z1 - z0) };
}

function CameraRig({ house }: { house: House }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const level = useApp((s) => s.level);
  const rotateRequest = useApp((s) => s.rotateRequest);
  const focusRequest = useApp((s) => s.focusRequest);
  const anim = useRef<{ az: number } | null>(null);
  const targetY = useRef(0);
  const lastAz = useRef(0);
  const initFor = useRef<OrbitControlsImpl | null>(null);

  // begin: kader het huis (in de eerste frame, zodat de controls zeker bestaan)
  const init = (c: OrbitControlsImpl) => {
    const { center, size: s } = houseCenter(house, 0);
    const az = useApp.getState().azimuth;
    const cam = camera as THREE.OrthographicCamera;
    c.target.copy(center);
    camera.position.set(center.x + RADIUS * Math.sin(POLAR) * Math.sin(az), center.y + RADIUS * Math.cos(POLAR), center.z + RADIUS * Math.sin(POLAR) * Math.cos(az));
    cam.zoom = Math.min(size.width, size.height) / (s * 1.25);
    cam.updateProjectionMatrix();
    c.update();
    initFor.current = c;
  };

  // verdieping wisselen: doelhoogte mee laten schuiven
  useEffect(() => {
    const li = level === 'all' ? 1 : level;
    targetY.current = house.levels[Math.min(li, house.levels.length - 1)].elevation;
  }, [level, house]);

  // 90° draaien
  useEffect(() => {
    if (!rotateRequest || !controls.current) return;
    const cur = controls.current.getAzimuthalAngle();
    const step = Math.PI / 2;
    const snapped = Math.round((cur - Math.PI / 4) / step) * step + Math.PI / 4;
    const dir = rotateRequest > lastAz.current ? 1 : -1;
    lastAz.current = rotateRequest;
    anim.current = { az: snapped + dir * step };
  }, [rotateRequest]);

  useEffect(() => {
    if (!focusRequest || !controls.current) return;
    const { center, size: s } = houseCenter(house, 0);
    const c = controls.current;
    const delta = new THREE.Vector3(center.x, c.target.y, center.z).sub(c.target);
    c.target.add(delta);
    camera.position.add(delta);
    (camera as THREE.OrthographicCamera).zoom = Math.min(size.width, size.height) / (s * 1.25);
    camera.updateProjectionMatrix();
    c.update();
  }, [focusRequest, house, camera, size]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    if (initFor.current !== c) init(c);
    // doelhoogte animeren
    const dy = targetY.current - c.target.y;
    if (Math.abs(dy) > 0.001) {
      const step = dy * Math.min(1, dt * 8);
      c.target.y += step;
      camera.position.y += step;
      c.update();
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
    }
    viewState.target.copy(c.target);
    const az = c.getAzimuthalAngle();
    if (Math.abs(az - useApp.getState().azimuth) > 0.01) useApp.getState().setAzimuth(az);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minPolarAngle={0.45}
      maxPolarAngle={1.25}
      minZoom={8}
      maxZoom={400}
      screenSpacePanning={false}
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}

function Lights() {
  const { gl, scene } = useThree();
  const mobile = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;
  useEffect(() => {
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    // zachte omgevingsreflectie (lokaal gegenereerd) zodat metaal en glas er goed uitzien
    const env = roomEnvironment(gl);
    scene.environment = env;
    scene.environmentIntensity = 0.35;
    return () => {
      scene.environment = null;
    };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={['#ffffff', '#b9ad96', 1.6]} />
      <directionalLight
        position={[-14, 22, 10]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[mobile ? 1024 : 2048, mobile ? 1024 : 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      >
        <object3D attach="target" position={[2.8, 0, 3]} />
      </directionalLight>
    </>
  );
}

export function Scene({ house }: { house: House }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#e9e4da']} />
      <OrthographicCamera makeDefault position={[-40, 50, 60]} near={-200} far={400} zoom={40} />
      <CameraRig house={house} />
      <Lights />
      <Suspense fallback={null}>
        <HouseView house={house} />
        <FurnitureLayer house={house} />
      </Suspense>
    </Canvas>
  );
}
