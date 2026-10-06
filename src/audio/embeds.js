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
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}?autoplay=1&playsinline=1&controls=0&modestbranding=1&start=${Math.max(0, Math.floor(pos))}`;
    } else {
      f.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(info.url)}&auto_play=true&visual=true&hide_related=true&show_comments=false&show_teaser=false`;
    }
    this.container.append(f);
    this.container.classList.remove('hidden');
    this.frame = f;
    return true;
  }

  close() {
    this.frame?.remove();
    this.frame = null;
    this.container?.classList.add('hidden');
  }
}
