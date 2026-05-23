import type { Point } from '../geometry/point';

export function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutBack(t: number): number {
  const c = 1.70158;
  const t1 = t - 1;
  return t1 * t1 * ((c + 1) * t1 + c) + 1;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export type EasingFn = (t: number) => number;

export interface AnimationHandle {
  cancel(): void;
  promise: Promise<void>;
  done: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface TweenState {
  cancelled: boolean;
  resolve: () => void;
  handle: AnimationHandle;
}

function runTween(
  duration: number,
  easing: EasingFn,
  onUpdate: (t: number) => void,
): AnimationHandle {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });

  const handle: AnimationHandle = {
    cancel() {
      state.cancelled = true;
      if (!handle.done) {
        handle.done = true;
        resolve();
      }
    },
    promise,
    done: false,
  };

  const state: TweenState = { cancelled: false, resolve, handle };

  if (prefersReducedMotion() || duration <= 0) {
    onUpdate(1);
    handle.done = true;
    resolve();
    return handle;
  }

  const startTime = performance.now();

  function tick(now: number): void {
    if (state.cancelled) return;

    const elapsed = now - startTime;
    const rawT = Math.min(elapsed / duration, 1);
    const easedT = easing(rawT);

    onUpdate(easedT);

    if (rawT < 1) {
      requestAnimationFrame(tick);
    } else {
      handle.done = true;
      resolve();
    }
  }

  requestAnimationFrame(tick);
  return handle;
}

export class AnimationManager {
  private readonly active: Set<AnimationHandle> = new Set();

  animatePieceMove(
    pieceId: number,
    from: Point,
    to: Point,
    duration: number = 300,
    easing: EasingFn = easeInOutCubic,
    onUpdate: (pieceId: number, pos: Point) => void,
  ): AnimationHandle {
    const handle = runTween(duration, easing, (t) => {
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      onUpdate(pieceId, { x, y });
    });

    this.track(handle);
    return handle;
  }

  animatePieceRotate(
    pieceId: number,
    fromAngle: number,
    toAngle: number,
    duration: number = 200,
    easing: EasingFn = easeInOutCubic,
    onUpdate: (pieceId: number, angle: number) => void,
  ): AnimationHandle {
    const handle = runTween(duration, easing, (t) => {
      const angle = fromAngle + (toAngle - fromAngle) * t;
      onUpdate(pieceId, angle);
    });

    this.track(handle);
    return handle;
  }

  animateSnap(
    pieceId: number,
    targetPos: Point,
    currentPos: Point,
    duration: number = 250,
    onUpdate: (pieceId: number, pos: Point) => void,
  ): AnimationHandle {
    const handle = runTween(duration, easeOutBack, (t) => {
      const x = currentPos.x + (targetPos.x - currentPos.x) * t;
      const y = currentPos.y + (targetPos.y - currentPos.y) * t;
      onUpdate(pieceId, { x, y });
    });

    this.track(handle);
    return handle;
  }

  animateSolutionReveal(
    pieces: number[],
    currentPositions: Point[],
    solutionPositions: Point[],
    stagger: number = 100,
    durationPerPiece: number = 300,
    easing: EasingFn = easeOutCubic,
    onUpdate: (pieceId: number, pos: Point) => void,
  ): AnimationHandle[] {
    const handles: AnimationHandle[] = [];

    for (let i = 0; i < pieces.length; i++) {
      const pieceId = pieces[i];
      const from = currentPositions[i];
      const to = solutionPositions[i];
      const delay = stagger * i;
      const handle = this.animatePieceMove(
        pieceId,
        from,
        to,
        durationPerPiece,
        easing,
        onUpdate,
      );

      if (delay > 0 && !prefersReducedMotion()) {
        handle.cancel();
        handles.push(
          this.createDelayed(
            delay,
            () =>
              this.animatePieceMove(
                pieceId,
                from,
                to,
                durationPerPiece,
                easing,
                onUpdate,
              ),
          ),
        );
      } else {
        handles.push(handle);
      }
    }

    return handles;
  }

  cancel(handle: AnimationHandle): void {
    handle.cancel();
    this.active.delete(handle);
  }

  cancelAll(): void {
    for (const handle of this.active) {
      handle.cancel();
    }
    this.active.clear();
  }

  private track(handle: AnimationHandle): void {
    this.active.add(handle);
    handle.promise.finally(() => {
      this.active.delete(handle);
    });
  }

  private createDelayed(delayMs: number, factory: () => AnimationHandle): AnimationHandle {
    let innerHandle: AnimationHandle | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolve!: () => void;

    const promise = new Promise<void>((res) => { resolve = res; });

    const handle: AnimationHandle = {
      cancel() {
        clearTimeout(timer);
        innerHandle?.cancel();
        if (!handle.done) {
          handle.done = true;
          resolve();
        }
      },
      promise,
      done: false,
    };

    this.track(handle);

    timer = setTimeout(() => {
      if (handle.done) return;
      innerHandle = factory();
      innerHandle.promise.then(() => {
        if (!handle.done) {
          handle.done = true;
          resolve();
        }
      });
    }, delayMs);

    return handle;
  }
}
