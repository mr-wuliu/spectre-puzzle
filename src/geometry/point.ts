export interface Point {
  x: number;
  y: number;
}

const { cos, sin, sqrt, abs } = Math;

export function create(x: number, y: number): Point {
  return { x, y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(p: Point, s: number): Point {
  return { x: p.x * s, y: p.y * s };
}

export function rotate(p: Point, angle: number): Point {
  const c = cos(angle);
  const s = sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function rotateAround(p: Point, center: Point, angle: number): Point {
  return add(rotate(subtract(p, center), angle), center);
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return sqrt(dx * dx + dy * dy);
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function magnitude(p: Point): number {
  return sqrt(p.x * p.x + p.y * p.y);
}

export function normalize(p: Point): Point {
  const m = magnitude(p);
  return { x: p.x / m, y: p.y / m };
}

export function equals(a: Point, b: Point, epsilon: number = 1e-10): boolean {
  return abs(a.x - b.x) < epsilon && abs(a.y - b.y) < epsilon;
}
