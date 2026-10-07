// YouTube / SoundCloud players. These are cross-origin iframes, so their audio can't reach
// the Web Audio analyser — the beat detector falls back to the DJ-set BPM clock for them.

export function parseMediaUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? { type: 'youtube', id } : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    let id = u.searchParams.get('v');
    if (!id) id = u.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{6,})/)?.[1];
    return id ? { type: 'youtube', id } : null;
  }
  if (host.endsWith('soundcloud.com')) return { type: 'soundcloud', url: u.href };
  return null;
}

export class EmbedPlayer {
  constructor() {
    this.container = null;
    this.frame = null;
    this.kind = null;
    this.volume = 1;
    this.retry = [];
  }

  /** Mirror the master volume into the embedded player (both accept postMessage commands). */
  setVolume(v) {
    this.volume = v;
    this.postVolume();
  }

  postVolume() {
    const win = this.frame?.contentWindow;
    if (!win) return;
    const pct = Math.round(this.volume * this.volume * 100); // same curve as the master gain
    if (this.kind === 'youtube') {
      const cmd = (func, args = []) => win.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
      cmd('setVolume', [pct]);
      cmd(pct === 0 ? 'mute' : 'unMute');
    } else if (this.kind === 'soundcloud') {
      win.postMessage(JSON.stringify({ method: 'setVolume', value: pct }), 'https://w.soundcloud.com');
    }
  }

  mount(container) {
    this.container = container;
  }

  open(track, pos) {
    this.close();
    const info = parseMediaUrl(track.src);
    if (!this.container || !info) return false;
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media';
    f.title = track.title;
    if (info.type === 'youtube') {
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}?autoplay=1&playsinline=1&controls=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${Math.max(0, Math.floor(pos))}`;
    } else {
      f.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(info.url)}&auto_play=true&visual=true&hide_related=true&show_comments=false&show_teaser=false`;
    }
    this.kind = info.type;
    this.container.append(f);
    this.container.classList.remove('hidden');
    this.frame = f;
    // The players only accept commands once loaded; re-send the volume a few times.
    f.addEventListener('load', () => {
      this.retry.forEach(clearTimeout);
      this.retry = [0, 1000, 2500, 5000].map((ms) => setTimeout(() => this.postVolume(), ms));
    });
    return true;
  }

  close() {
    this.retry.forEach(clearTimeout);
    this.frame?.remove();
    this.frame = null;
    this.container?.classList.add('hidden');
  }
}
