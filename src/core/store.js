// Storage can throw (private mode, blocked site data) — every access is guarded.

export function load(key, fallback = null, storage = 'local') {
  try {
    const s = storage === 'session' ? sessionStorage : localStorage;
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value, storage = 'local') {
  try {
    const s = storage === 'session' ? sessionStorage : localStorage;
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
