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
    this.onEnded = null; // () => void — the video finished, or can't be played at all
    this.onDuration = null; // (seconds) => void — YouTube told us how long the video is
    this.posFn = null; // () => seconds — where playback should be now (the shared position)
    this.ytState = null; // last YouTube playerState (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued)
    this.stateAt = 0; // when it last changed (performance.now)
    this.duration = 0; // the video's length, once YouTube has said
    this.blocked = false; // the browser stopped autoplay with sound: needs a tap
    // Any tap / key press counts as permission to play: start a blocked video right then.
    const unblock = () => this.blocked && this.resume();
    addEventListener('pointerdown', unblock, true);
    addEventListener('keydown', unblock, true);
    // The YouTube player reports its state once we ask it to ("listening").
    addEventListener('message', (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow || !/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      let msg;
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = msg?.event === 'infoDelivery' ? msg.info : null;
      if (info?.playerState !== undefined && info.playerState !== this.ytState) {
        this.ytState = info.playerState;
        this.stateAt = performance.now();
        if (this.ytState === 1 || this.ytState === 3) this.blocked = false;
      }
      if (info?.duration > 0 && !this.duration) {
        this.duration = info.duration;
        this.onDuration?.(info.duration);
      }
      if (Number.isFinite(info?.currentTime)) this.keepInSync(info.currentTime);
      const ended = msg?.event === 'onError' || info?.playerState === 0 || (msg?.event === 'onStateChange' && msg.info === 0);
      if (ended) {
        if (msg.event === 'onError' && !this.endedSent) console.warn('[music] YouTube can\'t play this video (error ' + msg.info + ')');
        this.finish();
      }
    });
  }

  /**
   * Keep everyone on the same spot in the song. The player starts wherever the song was when it
   * began loading, so once it's playing steadily, nudge it onto the shared position if it's
   * drifted more than 2 s. A seek stalls the player while it buffers, so: never while it's
   * buffering or just started, at most every 10 s, backing off (up to a minute) when a seek
   * doesn't take, and never past the end — YouTube restarts the video there, which used to
   * loop its first seconds with a stall every 10 s. If the shared clock has passed the end, the
   * song is over: report it so the playlist moves on.
   */
  keepInSync(t) {
    const want = this.posFn?.();
    if (!Number.isFinite(want)) return;
    if (this.duration && want >= this.duration - 0.5) return this.finish();
    const now = performance.now();
    if (this.ytState !== 1 || now - this.stateAt < 2000 || now < this.nextSync) return;
    if (Math.abs(want - t) <= 2) {
      this.nextSync = now + 10000;
      this.syncBackoff = 10000;
      return;
    }
    this.command('seekTo', [want + 0.4, true]); // + seek latency
    this.nextSync = now + this.syncBackoff;
    this.syncBackoff = Math.min(60000, this.syncBackoff * 2);
  }

  /** The video's over (or can't play): tell the playlist, once. */
  finish() {
    if (this.endedSent) return;
    this.endedSent = true;
    this.onEnded?.();
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
    f.style.border = '0';
    if (info.type === 'youtube') {
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}?autoplay=1&playsinline=1&controls=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${Math.max(0, Math.floor(pos))}`;
    } else {
      f.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(info.url)}&auto_play=true&visual=true&hide_related=true&show_comments=false&show_teaser=false`;
    }
    this.kind = info.type;
    this.container.append(f);
    this.container.classList.remove('hidden');
    this.frame = f;
    this.endedSent = false;
    this.ytState = null;
    this.stateAt = performance.now();
    this.duration = 0;
    this.blocked = false;
    this.nextSync = 0;
    this.syncBackoff = 10000;
    clearTimeout(this.blockCheck);
    // The players only accept commands once loaded; re-send the volume a few times, and ask
    // YouTube to report its state (so a finished or blocked video moves the playlist on).
    f.addEventListener('load', () => {
      if (this.frame !== f) return; // a player that's since been closed
      this.retry.forEach(clearTimeout);
      this.retry = [0, 1000, 2500, 5000].map((ms) =>
        setTimeout(() => {
          this.postVolume();
          if (this.kind === 'youtube') f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
        }, ms),
      );
      // Still not playing a few seconds after loading: autoplay was blocked (no tap yet).
      clearTimeout(this.blockCheck);
      this.blockCheck = setTimeout(() => {
        if (this.frame === f && this.kind === 'youtube' && (this.ytState === -1 || this.ytState === 5 || this.ytState === null)) this.blocked = true;
      }, 3500);
    });
    return true;
  }

  /** Send a YouTube IFrame API command. */
  command(func, args = []) {
    if (this.kind === 'youtube') this.frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
  }

  /** Start (or restart) the YouTube player at the shared position — call from a tap. */
  resume() {
    if (!this.frame || this.kind !== 'youtube') return;
    const pos = this.posFn?.();
    if (Number.isFinite(pos)) this.command('seekTo', [Math.max(0, pos), true]);
    this.command('playVideo');
    this.nextSync = 0;
    this.postVolume();
    this.blocked = false;
    clearTimeout(this.blockCheck);
    this.blockCheck = setTimeout(() => {
      if (this.ytState !== 1 && this.ytState !== 3) this.blocked = true; // still nothing: ask again
    }, 3000);
  }

  /**
   * Tear the player down completely before the next one opens, so two never compete for the
   * network or memory: its timers, its callbacks, and the iframe itself (pointed at about:blank
   * first, which stops the stream at once rather than whenever the frame is collected).
   */
  close() {
    clearTimeout(this.blockCheck);
    this.blocked = false;
    this.retry.forEach(clearTimeout);
    this.retry = [];
    this.onEnded = this.onDuration = this.posFn = null;
    const f = this.frame;
    this.frame = null;
    if (f) {
      f.src = 'about:blank';
      f.remove();
    }
    this.container?.classList.add('hidden');
  }
}
