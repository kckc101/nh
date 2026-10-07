import { load, save } from './store.js';

export const params = new URLSearchParams(location.search);

export const isTouch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
export const isMobile = isTouch && Math.min(screen.width, screen.height) <= 900;

const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const settings = Object.assign(
  {
    quality: isMobile ? 'medium' : 'high',
    reduceFlash: prefersReducedMotion,
    bots: isMobile ? 22 : 46,
    autoFx: true,
    autoPerf: true, // dynamic resolution + automatic effect fallback
  },
  load('erave.settings', {}),
);

export function saveSettings() {
  save('erave.settings', settings);
}

export function qualityProfile(level = settings.quality) {
  const dpr = window.devicePixelRatio || 1;
  switch (level) {
    case 'low':
      return { level, pixelRatio: Math.min(dpr, 1), bloom: false, antialias: false };
    case 'medium':
      return { level, pixelRatio: Math.min(dpr, 1.25), bloom: true, antialias: false };
    default:
      return { level: 'high', pixelRatio: Math.min(dpr, 1.75), bloom: true, antialias: true };
  }
}
