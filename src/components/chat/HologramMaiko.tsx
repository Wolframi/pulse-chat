"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Region =
  | "fur" | "furDark" | "tan"
  | "hoodie" | "hoodieDark"
  | "denim" | "shoe" | "shoeCap"
  | "eye" | "eyeWhite"
  | "cap";

interface Point {
  x: number; y: number; z: number;
  region: Region;
  phase: number;
  sizeMul: number;
  delay: number;
  offX: number;
  offY: number;
  offR: number;
}

const REGION_COLORS: Record<Region, [number, number, number]> = {
  fur:        [255, 140, 60],
  furDark:    [200, 90, 40],
  tan:        [255, 220, 165],
  hoodie:     [80, 140, 230],
  hoodieDark: [50, 90, 170],
  denim:      [120, 170, 220],
  shoe:       [230, 60, 60],
  shoeCap:    [245, 245, 250],
  eye:        [30, 20, 40],
  eyeWhite:   [255, 255, 255],
  cap:        [225, 228, 235],
};

function fib(i: number, n: number): [number, number, number] {
  const phi = Math.acos(1 - 2 * (i + 0.5) / n);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return [
    Math.cos(theta) * Math.sin(phi),
    Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
  ];
}

function makePoint(x: number, y: number, z: number, region: Region): Point {
  const angle = Math.random() * Math.PI * 2;
  return {
    x, y, z,
    region,
    phase: Math.random() * Math.PI * 2,
    sizeMul: 0.85 + Math.random() * 0.35,
    delay: Math.random() * 0.45,
    offX: Math.cos(angle),
    offY: Math.sin(angle),
    offR: 1.4 + Math.random() * 1.6,
  };
}

function ellipsoid(cx: number, cy: number, cz: number,
                   rx: number, ry: number, rz: number,
                   n: number, region: Region): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = fib(i, n);
    out.push(makePoint(cx + x * rx, cy + y * ry, cz + z * rz, region));
  }
  return out;
}

function sphere(cx: number, cy: number, cz: number, r: number, n: number, region: Region): Point[] {
  return ellipsoid(cx, cy, cz, r, r, r, n, region);
}

function capsule(ax: number, ay: number, az: number,
                 bx: number, by: number, bz: number,
                 r: number, n: number, region: Region): Point[] {
  const out: Point[] = [];
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const ux = dx / len, uy = dy / len, uz = dz / len;

  let vx: number, vy: number, vz: number;
  if (Math.abs(uy) < 0.9) { vx = uz; vy = 0; vz = -ux; }
  else { vx = 0; vy = -uz; vz = uy; }
  const vl = Math.hypot(vx, vy, vz) || 1e-6;
  vx /= vl; vy /= vl; vz /= vl;

  const wx = uy * vz - uz * vy;
  const wy = uz * vx - ux * vz;
  const wz = ux * vy - uy * vx;

  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const along = Math.random();
    const ca = Math.cos(angle), sa = Math.sin(angle);
    out.push(makePoint(
      ax + dx * along + (ca * vx + sa * wx) * r,
      ay + dy * along + (ca * vy + sa * wy) * r,
      az + dz * along + (ca * vz + sa * wz) * r,
      region,
    ));
  }
  const capN = Math.floor(n * 0.2);
  const ends: Array<[number, number, number, number]> = [
    [ax, ay, az, -1], [bx, by, bz, 1],
  ];
  for (const [ex, ey, ez, sign] of ends) {
    let added = 0, i = 0;
    while (added < capN && i < capN * 4) {
      const [nx, ny, nz] = fib(i, capN * 2);
      i++;
      const dot = nx * ux + ny * uy + nz * uz;
      if (dot * sign <= 0) continue;
      out.push(makePoint(ex + nx * r, ey + ny * r, ez + nz * r, region));
      added++;
    }
  }
  return out;
}

function buildMaiko(): Point[] {
  const pts: Point[] = [];

  // ГОЛОВА
  pts.push(...ellipsoid(0, 0.72, 0, 0.42, 0.36, 0.42, 330, "fur"));
  pts.push(...ellipsoid(0, 0.60, 0.14, 0.28, 0.22, 0.28, 145, "tan"));
  pts.push(...ellipsoid(0, 0.62, 0.34, 0.16, 0.12, 0.15, 88, "tan"));
  pts.push(...sphere(0, 0.65, 0.46, 0.045, 30, "eye"));

  // ГЛАЗА
  pts.push(...sphere(-0.14, 0.80, 0.32, 0.07, 56, "eyeWhite"));
  pts.push(...sphere(-0.14, 0.80, 0.37, 0.045, 33, "eye"));
  pts.push(...sphere( 0.14, 0.80, 0.32, 0.07, 56, "eyeWhite"));
  pts.push(...sphere( 0.14, 0.80, 0.37, 0.045, 33, "eye"));

  // УШКИ
  pts.push(...capsule(-0.24, 0.98, -0.02, -0.30, 1.32, -0.05, 0.12, 120, "fur"));
  pts.push(...capsule( 0.24, 0.98, -0.02,  0.30, 1.32, -0.05, 0.12, 120, "fur"));
  pts.push(...capsule(-0.24, 1.00, 0.02, -0.29, 1.28, 0.00, 0.05, 38, "furDark"));
  pts.push(...capsule( 0.24, 1.00, 0.02,  0.29, 1.28, 0.00, 0.05, 38, "furDark"));

  // ТОЛСТОВКА
  pts.push(...ellipsoid(0, 0.08, 0, 0.42, 0.42, 0.32, 415, "hoodie"));
  pts.push(...ellipsoid(0, 0.36, -0.10, 0.32, 0.14, 0.28, 120, "hoodieDark"));
  pts.push(...ellipsoid(0, -0.08, 0.24, 0.28, 0.20, 0.08, 95, "hoodieDark"));

  // ШНУРКИ
  pts.push(...capsule(-0.08, 0.30, 0.22, -0.10, 0.05, 0.28, 0.03, 23, "cap"));
  pts.push(...capsule( 0.08, 0.30, 0.22,  0.10, 0.05, 0.28, 0.03, 23, "cap"));

  // РУКИ
  pts.push(...capsule(-0.42, 0.15, 0.05, -0.42, -0.20, 0.10, 0.13, 103, "hoodie"));
  pts.push(...capsule( 0.42, 0.15, 0.05,  0.42, -0.20, 0.10, 0.13, 103, "hoodie"));
  pts.push(...sphere(-0.42, -0.22, 0.12, 0.10, 53, "fur"));
  pts.push(...sphere( 0.42, -0.22, 0.12, 0.10, 53, "fur"));

  // ДЖИНСЫ
  pts.push(...capsule(-0.17, -0.35, 0, -0.17, -0.78, 0.02, 0.14, 113, "denim"));
  pts.push(...capsule( 0.17, -0.35, 0,  0.17, -0.78, 0.02, 0.14, 113, "denim"));
  pts.push(...capsule(-0.17, -0.78, 0.02, -0.17, -0.85, 0.02, 0.15, 35, "denim"));
  pts.push(...capsule( 0.17, -0.78, 0.02,  0.17, -0.85, 0.02, 0.15, 35, "denim"));

  // КРОССОВКИ
  pts.push(...ellipsoid(-0.18, -0.95, 0.05, 0.15, 0.09, 0.24, 125, "shoe"));
  pts.push(...ellipsoid( 0.18, -0.95, 0.05, 0.15, 0.09, 0.24, 125, "shoe"));
  pts.push(...ellipsoid(-0.18, -0.97, 0.22, 0.13, 0.06, 0.09, 48, "shoeCap"));
  pts.push(...ellipsoid( 0.18, -0.97, 0.22, 0.13, 0.06, 0.09, 48, "shoeCap"));

  // ХВОСТ
  // Корень внутри низа толстовки, дальше уходит назад-вниз-вверх.
  // Верх хвоста останавливаем на y ≈ 0.30 (уровень лопаток), а не на 0.70,
  // чтобы не лезть к голове (её низ начинается около y = 0.36).
  // Весь хвост сдвинут по z в минус — за спиной, сбоку от корпуса.
  const TAIL_N = 475;
  for (let i = 0; i < TAIL_N; i++) {
    const t = i / (TAIL_N - 1);
    let px: number, py: number, pz: number;
    if (t < 0.55) {
      const u = t / 0.55;
      // Изнутри тела наружу-вниз-назад: спокойный выход из-под толстовки.
      px = 0.05 + u * 0.42;
      py = -0.30 - u * 0.15;
      pz = -0.20 - u * 0.50;
    } else {
      const u = (t - 0.55) / 0.45;
      // Плавный подъём наверх-вперёд: пушистая «запятая», но ниже уровня уха.
      px = 0.47 - u * 0.10;
      py = -0.45 + u * 0.75;
      pz = -0.70 + u * 0.25;
    }
    // Толщина: корень толстый, середина пушистая, кончик тоньше.
    const thick = 0.14 + Math.sin(t * Math.PI) * 0.15;
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const rr = Math.pow(Math.random(), 0.55) * thick;
    const jx = Math.sin(b) * Math.cos(a) * rr;
    const jy = Math.sin(b) * Math.sin(a) * rr;
    const jz = Math.cos(b) * rr * 0.9;
    pts.push(makePoint(
      px + jx, py + jy, pz + jz,
      Math.random() < 0.18 ? "furDark" : "fur",
    ));
  }

  for (const p of pts) {
    p.y -= 0.1;
    p.z += 0.15;
  }
  return pts;
}

// ---------- RENDER ----------

/** Сборка длится 2.2 сек. */
const ASSEMBLY_MS = 2200;
/**
 * Сколько полных оборотов модель делает за время сборки.
 * Должно быть целым, тогда в момент окончания сборки угол
 * кратен 2π — модель смотрит точно лицом к зрителю.
 */
const SPINS_DURING_ASSEMBLY = 2;
/** Итоговый угол сборки: -(N × 2π) ≡ 0 по модулю 2π. */
const FINAL_ANGLE = -SPINS_DURING_ASSEMBLY * Math.PI * 2;
/**
 * Скорость вращения после сборки, рад/с.
 * -1.0 ≈ один полный оборот за ~6 секунд.
 */
const AFTER_SPIN_SPEED = -1.0;

function renderFrame(
  ctx: CanvasRenderingContext2D,
  W: number, H: number, dpr: number,
  points: Point[],
  elapsedMs: number,
) {
  ctx.clearRect(0, 0, W, H);
  const t = elapsedMs / 1000;

  const entryT = Math.min(1, elapsedMs / ASSEMBLY_MS);

  // Вращение:
  //   • во время сборки — линейно от 0 до FINAL_ANGLE (2 оборота вправо);
  //   • ровно на 2.2 с угол кратен 2π — модель смотрит прямо на зрителя;
  //   • после — продолжает вращаться с AFTER_SPIN_SPEED.
  let rotY: number;
  if (elapsedMs < ASSEMBLY_MS) {
    rotY = (elapsedMs / ASSEMBLY_MS) * FINAL_ANGLE;
  } else {
    const afterT = (elapsedMs - ASSEMBLY_MS) / 1000;
    rotY = FINAL_ANGLE + afterT * AFTER_SPIN_SPEED;
  }
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);

  const bob = Math.sin(t * 1.3) * 0.015;
  const tiltX = -0.06 + Math.sin(t * 0.7) * 0.04;
  const cosX = Math.cos(tiltX);
  const sinX = Math.sin(tiltX);

  const cssW = W / dpr;
  const cssH = H / dpr;

  const scale = Math.min(cssW, cssH) * 0.6 * dpr;
  const cx = W / 2;
  const cy = H / 2;
  const half = Math.hypot(cssW, cssH) * 0.5 * dpr;
  const camZ = 3.1;

  const proj: {
    sx: number; sy: number; z: number;
    r: number; g: number; b: number;
    size: number; a: number;
  }[] = [];

  for (const p of points) {
    const localT = Math.max(
      0,
      Math.min(1, (entryT - p.delay) / Math.max(0.0001, 1 - p.delay)),
    );
    const entryEase = 1 - Math.pow(1 - localT, 3);
    const invEase = 1 - entryEase;

    const y0 = p.y + bob;
    const x1 = p.x * cosY - p.z * sinY;
    const z1 = p.x * sinY + p.z * cosY;
    const y2 = y0 * cosX - z1 * sinX;
    const z2 = y0 * sinX + z1 * cosX;

    const d = camZ - z2;
    if (d < 0.5) continue;
    const k = scale / d;

    const baseSx = cx + x1 * k;
    const baseSy = cy - y2 * k;

    const sx = baseSx + p.offX * p.offR * half * invEase;
    const sy = baseSy + p.offY * p.offR * half * invEase;

    const depthNorm = Math.max(0, Math.min(1, (z2 + 1.4) / 2.8));
    const alpha = (0.35 + 0.65 * depthNorm) * entryEase;
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2 + p.phase);
    const dotR = (0.7 + 1.65 * depthNorm) * dpr * p.sizeMul;

    const [r, g, b] = REGION_COLORS[p.region] ?? [200, 220, 255];
    const cyanMix = 0.55 * (1 - depthNorm);
    const fr = (r * (1 - cyanMix) + 90  * cyanMix) | 0;
    const fg = (g * (1 - cyanMix) + 220 * cyanMix) | 0;
    const fb = (b * (1 - cyanMix) + 255 * cyanMix) | 0;

    proj.push({ sx, sy, z: z2, r: fr, g: fg, b: fb, size: dotR, a: alpha * pulse });
  }

  proj.sort((a, b) => a.z - b.z);

  ctx.globalCompositeOperation = "lighter";

  for (const q of proj) {
    if (q.a > 0.35) {
      ctx.fillStyle = `rgba(${q.r},${q.g},${q.b},${(q.a * 0.16).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, q.size * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(${q.r},${q.g},${q.b},${q.a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(q.sx, q.sy, q.size, 0, Math.PI * 2);
    ctx.fill();
    if (q.a > 0.72) {
      ctx.fillStyle = `rgba(230,250,255,${((q.a - 0.72) * 1.4).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, q.size * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = "source-over";
}

export function HologramMaiko() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[] | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!pointsRef.current) pointsRef.current = buildMaiko();
    const pts = pointsRef.current;

    let W = 0, H = 0, dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.max(1, window.innerWidth);
      const cssH = Math.max(1, window.innerHeight);
      W = Math.max(1, Math.round(cssW * dpr));
      H = Math.max(1, Math.round(cssH * dpr));
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    resize();

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    const start = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      renderFrame(ctx, W, H, dpr, pts, now - start);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <canvas ref={canvasRef} className="hologram-maiko" aria-hidden />,
    document.body,
  );
}