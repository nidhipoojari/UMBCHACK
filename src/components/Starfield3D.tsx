'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * The night-sky field behind the landing page, after the Lenis site: hundreds
 * of pinprick stars that each twinkle on their own clock and drift upward on
 * their own, near ones faster than far ones, so the field reads as depth rather
 * than a pattern. Scrolling adds a little parallax; the cursor does nothing.
 * Every so often a shooting star crosses it.
 *
 * TWO COLOURS STILL. The stars are the page's ink on its paper, read from the
 * CSS custom properties at mount, so if the palette changes this follows it.
 *
 * EVERYTHING IS IN SCREEN SPACE. Both shaders write gl_Position straight from
 * pixel coordinates, so there is no camera to reason about and a star's size
 * is its size in CSS pixels. Nothing sets React state per frame: the scroll
 * and the clock go into uniforms inside useFrame.
 */

type Props = { reduced: boolean };

/** Small seeded PRNG (mulberry32). The field is laid out once from a fixed
 *  seed, which keeps render pure and gives every visit the same sky. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse a CSS colour token (hex or rgb()) into a THREE.Color. */
function cssColor(name: string, fallback: string): THREE.Color {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(raw || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

// --- Stars ----------------------------------------------------------------

const STAR_VERT = /* glsl */ `
  attribute vec2 aPos;     // x in [0,1] across, y in [0,1] down the field
  attribute float aDepth;  // 0.15 far .. 1.0 near
  attribute float aSize;   // base diameter in CSS px
  attribute float aPhase;
  attribute float aSpeed;  // twinkle rate, rad/s
  attribute float aFlash;  // 1 for the few stars that flare now and then

  uniform float uTime;
  uniform float uScroll;
  uniform vec2 uViewport;
  uniform float uDpr;

  varying float vAlpha;
  varying float vGlint;

  void main() {
    // The field is taller than the screen so wrapping happens off-screen.
    float margin = 80.0;
    float field = uViewport.y + margin * 2.0;

    // The field drifts upward on its own, near stars faster than far ones, and
    // near stars also move more on scroll: that is the parallax.
    float travel = uScroll * (0.08 + aDepth * 0.32) + uTime * (6.0 + aDepth * 18.0);
    float y = mod(aPos.y * field - travel, field) - margin;

    // A gentle private sway, so each star wanders a little as it rises.
    float x = aPos.x * uViewport.x + sin(uTime * 0.22 + aPhase) * (4.0 + aDepth * 9.0);

    gl_Position = vec4(x / uViewport.x * 2.0 - 1.0, 1.0 - y / uViewport.y * 2.0, 0.0, 1.0);

    // Twinkle: a soft breathe for everyone, a sharp flare for a few.
    float breathe = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase);
    float flare = aFlash * pow(max(0.0, sin(uTime * aSpeed * 0.35 + aPhase * 1.7)), 24.0);
    vAlpha = (0.22 + aDepth * 0.5) * breathe + flare * 0.6;
    vGlint = flare;

    gl_PointSize = aSize * (0.65 + aDepth * 0.6) * (1.0 + flare * 1.6) * uDpr;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vGlint;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    // A hard core with a soft halo, so a 2px star still reads as round.
    float core = smoothstep(0.5, 0.12, d);
    // Flaring stars grow a faint four-point cross.
    float cross = vGlint * (exp(-abs(p.x) * 40.0) + exp(-abs(p.y) * 40.0)) * smoothstep(0.5, 0.0, d);
    float a = (core + cross * 0.8) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function Stars({ count, color, reduced }: { count: number; color: THREE.Color; reduced: boolean }) {
  const { size, viewport } = useThree();
  const points = useRef<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 2);
    const depth = new Float32Array(count);
    const sz = new Float32Array(count);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const flash = new Float32Array(count);
    const random = prng(0x5eed);
    for (let i = 0; i < count; i++) {
      pos[i * 2] = random();
      pos[i * 2 + 1] = random();
      // Mostly far and faint, a few near and bright: squares skew the spread.
      const d = random();
      depth[i] = 0.15 + d * d * 0.85;
      const s = random();
      sz[i] = 1.6 + s * s * s * 3.4;
      phase[i] = random() * Math.PI * 2;
      speed[i] = 0.4 + random() * 1.4;
      flash[i] = random() < 0.06 ? 1 : 0;
    }
    g.setAttribute('aPos', new THREE.BufferAttribute(pos, 2));
    g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    g.setAttribute('aFlash', new THREE.BufferAttribute(flash, 1));
    // Positions live in the attributes, not in `position`; three still wants one
    // to know how many points to draw.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uScroll: { value: 0 },
          uViewport: { value: new THREE.Vector2(1, 1) },
          uDpr: { value: 1 },
          uColor: { value: color },
        },
      }),
    [color],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state) => {
    if (!points.current) return;
    const u = points.current.material.uniforms;
    u.uViewport.value.set(size.width, size.height);
    u.uDpr.value = viewport.dpr;
    if (reduced) return;
    u.uTime.value = state.clock.elapsedTime;
    // Lenis eases the real scroll position, so reading it here is already smooth.
    u.uScroll.value = window.scrollY;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

// --- Shooting stars -------------------------------------------------------

const TRAIL_VERT = /* glsl */ `
  attribute vec2 aCorner;  // x: 0 tail .. 1 head, y: -1..1 across
  uniform vec2 uHead;
  uniform vec2 uDir;
  uniform float uLen;
  uniform float uWidth;
  uniform vec2 uViewport;
  varying vec2 vCorner;

  void main() {
    vec2 n = vec2(-uDir.y, uDir.x);
    vec2 p = uHead - uDir * uLen * (1.0 - aCorner.x) + n * uWidth * aCorner.y;
    gl_Position = vec4(p.x / uViewport.x * 2.0 - 1.0, 1.0 - p.y / uViewport.y * 2.0, 0.0, 1.0);
    vCorner = aCorner;
  }
`;

const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vCorner;

  void main() {
    // Thin toward the tail, bright at the head.
    float along = pow(vCorner.x, 2.2);
    float across = 1.0 - smoothstep(along * 0.9, along, abs(vCorner.y));
    float head = smoothstep(0.9, 1.0, vCorner.x) * (1.0 - abs(vCorner.y));
    float a = (along * across * 0.7 + head * 0.6) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

type Shot = { active: boolean; x: number; y: number; dx: number; dy: number; speed: number; len: number; age: number; life: number };

const MAX_SHOTS = 3;

function ShootingStars({ color }: { color: THREE.Color }) {
  const { size } = useThree();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // Two triangles: tail-bottom, head-bottom, head-top, tail-top.
    const corner = new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]);
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, []);

  const materials = useMemo(
    () =>
      Array.from(
        { length: MAX_SHOTS },
        () =>
          new THREE.ShaderMaterial({
            vertexShader: TRAIL_VERT,
            fragmentShader: TRAIL_FRAG,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            uniforms: {
              uHead: { value: new THREE.Vector2() },
              uDir: { value: new THREE.Vector2(1, 0) },
              uLen: { value: 0 },
              uWidth: { value: 1.2 },
              uViewport: { value: new THREE.Vector2(1, 1) },
              uColor: { value: color },
              uAlpha: { value: 0 },
            },
          }),
      ),
    [color],
  );

  useEffect(() => () => {
    geometry.dispose();
    materials.forEach((m) => m.dispose());
  }, [geometry, materials]);

  const shots = useRef<Shot[]>(
    Array.from({ length: MAX_SHOTS }, () => ({ active: false, x: 0, y: 0, dx: 0, dy: 0, speed: 0, len: 0, age: 0, life: 1 })),
  );
  // First one arrives soon, so a visitor sees it before scrolling away.
  const nextAt = useRef(1.8);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    if (t >= nextAt.current) {
      const free = shots.current.find((s) => !s.active);
      if (free) {
        // Enter from the upper part of the screen, heading down and across.
        const leftward = Math.random() < 0.5;
        const angle = (18 + Math.random() * 22) * (Math.PI / 180);
        free.active = true;
        free.x = size.width * (leftward ? 0.45 + Math.random() * 0.55 : Math.random() * 0.55);
        free.y = size.height * Math.random() * 0.45;
        free.dx = Math.cos(angle) * (leftward ? -1 : 1);
        free.dy = Math.sin(angle);
        free.speed = 700 + Math.random() * 600;
        free.len = 110 + Math.random() * 150;
        free.age = 0;
        free.life = 0.7 + Math.random() * 0.6;
      }
      nextAt.current = t + 0.3;
    }

    shots.current.forEach((s, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uViewport.value.set(size.width, size.height);
      if (!s.active) {
        u.uAlpha.value = 0;
        return;
      }
      s.age += dt;
      s.x += s.dx * s.speed * dt;
      s.y += s.dy * s.speed * dt;
      const k = s.age / s.life;
      if (k >= 1) {
        s.active = false;
        u.uAlpha.value = 0;
        return;
      }
      // Quick fade in, long fade out, and the trail stretches as it goes.
      u.uAlpha.value = Math.min(1, k * 8) * (1 - k) * 0.85;
      u.uHead.value.set(s.x, s.y);
      u.uDir.value.set(s.dx, s.dy);
      u.uLen.value = s.len * Math.min(1, k * 3);
    });
  });

  return (
    <>
      {materials.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          geometry={geometry}
          material={m}
          frustumCulled={false}
        />
      ))}
    </>
  );
}

// --- Canvas ---------------------------------------------------------------

export default function Starfield3D({ reduced }: Props) {
  const color = useMemo(() => cssColor('--ink', '#0b2545'), []);

  // Density follows the screen: roughly one star per 2,400 px², within limits.
  // Sparse on purpose; on paper a dense field starts to read as dust.
  const count = useMemo(() => {
    const area = window.innerWidth * window.innerHeight;
    return Math.round(Math.min(750, Math.max(180, area / 2400)));
  }, []);

  return (
    <Canvas
      className="starfield__canvas"
      dpr={[1, 2]}
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
      // No camera is used: both shaders position themselves in screen space.
      orthographic
    >
      <Stars count={count} color={color} reduced={reduced} />
      {!reduced && <ShootingStars color={color} />}
    </Canvas>
  );
}
