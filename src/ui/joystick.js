import { el } from './dom.js';

/** Virtual thumb-stick for touch devices. Calls onMove(x, y) with values in -1..1 (y down = +). */
export function createJoystick(parent, onMove) {
  const base = el(`
    <div class="joystick pointer-events-auto absolute left-5 bottom-[calc(76px+env(safe-area-inset-bottom))] size-32 rounded-full glass touch-none select-none"
         style="box-shadow: inset 0 0 24px rgba(0,240,255,.18), 0 0 18px rgba(255,43,214,.18)" aria-label="Move">
      <div class="knob absolute left-1/2 top-1/2 size-14 -ml-7 -mt-7 rounded-full"
           style="background: radial-gradient(circle at 35% 30%, #fff, #00f0ff 40%, #8b5cff); box-shadow: 0 0 20px #00f0ff"></div>
    </div>`);
  const knob = base.querySelector('.knob');
  parent.append(base);
  let id = null;
  let cx = 0;
  let cy = 0;
  const R = 52;

  const set = (x, y) => {
    knob.style.transform = `translate(${x * R}px, ${y * R}px)`;
    onMove(x, y);
  };
  base.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    base.setPointerCapture(id);
    const r = base.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  });
  const move = (e) => {
    if (e.pointerId !== id) return;
    let x = (e.clientX - cx) / R;
    let y = (e.clientY - cy) / R;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    set(x, y);
  };
  base.addEventListener('pointermove', move);
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    set(0, 0);
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  return base;
}
