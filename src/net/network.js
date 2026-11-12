// Network layer. Talks to the Socket.io server when it's reachable; otherwise runs an
// in-browser "local hub" with the same DJ state machine so the festival works standalone
// (bots + you, full DJ controls).

import { io } from 'socket.io-client';
import { Emitter } from '../core/events.js';
import { DJController } from '../../shared/dj.js';
import { BOTTLE_TIERS, SIGN_STYLE_IDS, BOTTLE_GAP_MS, cleanSignText } from '../../shared/aura.js';
import { LIGHT_DEFAULTS, cleanLight } from '../../shared/lighting.js';
import { DRONECAM_DEFAULTS, cleanDroneCam } from '../../shared/dronecam.js';
import { SHOW_DEFAULTS, cleanShow } from '../../shared/show.js';
import { load, save } from '../core/store.js';

// Where the multiplayer server lives. Empty = same origin (Vite dev proxy, or the server
// hosting this build via STATIC_DIR). Set VITE_SERVER_URL when they're on different hosts.
const SERVER = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

const SERVER_EVENTS = [
  'hello', 'online', 'players', 'player:join', 'player:leave', 'player:avatar', 'player:emote',
  'react', 'chat', 'dj:state', 'fx', 'announce', 'rtc:live', 'rtc:signal', 'rtc:request', 'dm', 'say',
  'aura:bottle', 'aura:queue', 'AVATAR_DANCE_CHANGE', 'light', 'dronecam', 'show', 'ticket:replaced',
];

/** A random per-browser secret the server remembers this raver's aura glow under. */
function auraKey() {
  let k = load('erave.auraKey', null);
  if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    k = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    save('erave.auraKey', k);
  }
  return k;
}

export class Network extends Emitter {
  constructor() {
    super();
    this.online = false;
    this.socket = null;
    this.id = 'me';
    this.offset = 0;
    this.rtt = 0;
    this.local = null;
    this.isDJ = false;
    this.djKey = null;
    this.profile = null;
    this.joined = false;
    this.status = 'connecting';
    this.lastState = null; // our latest [x, y, z, yaw, dance, moving]
    this.aura = { style: null };
    this.localBottleFree = 0; // offline demo: when the local "VIP line" is free again
    this.lightState = { ...LIGHT_DEFAULTS }; // offline demo: the strobe lighting state
    this.droneState = { ...DRONECAM_DEFAULTS }; // offline demo: the drone cam state
    this.showState = { ...SHOW_DEFAULTS }; // offline demo: the laser show
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  /**
   * Resolves true once connected. Falls back to offline mode quickly when the server is
   * clearly absent (repeated connect errors, e.g. static hosting). The hard timeout only
   * catches hung connections — a busy main thread (shader compiles on slow devices) can
   * delay the handshake by seconds, so it must not be short.
   */
  connect(timeoutMs = 20000) {
    return new Promise((resolve) => {
      const opts = { transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 4000 };
      const socket = (this.pending = SERVER ? io(SERVER, opts) : io(opts));
      let settled = false;
      let errors = 0;
      socket.on('connect_error', (err) => {
        console.warn('[net] connect error:', err?.message);
        if (!settled && ++errors >= 3) finish(false);
      });
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          socket.close();
          this.startOffline();
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);

      for (const ev of SERVER_EVENTS) socket.on(ev, (data) => this.emit(ev, data));

      socket.on('connect', async () => {
        if (settled && !this.online && !this.joined) return;
        clearTimeout(timer);
        this.socket = socket;
        this.online = true;
        this.id = socket.id;
        await this.syncTime();
        this.setStatus('online');
        if (this.joined && settled) {
          // Reconnected after a drop: the server forgot us — join again.
          const welcome = await this.join(this.profile, this.djKey, this.ticket).catch(() => null);
          if (welcome) this.emit('rejoined', welcome);
        }
        finish(true);
      });
      socket.on('disconnect', () => {
        if (settled && this.online) this.setStatus('reconnecting');
      });
    });
  }

  async syncTime(samples = 5) {
    const results = [];
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const st = await this.socket.timeout(2000).emitWithAck('time').catch(() => null);
      const t1 = Date.now();
      if (typeof st === 'number') results.push({ rtt: t1 - t0, offset: st + (t1 - t0) / 2 - t1 });
    }
    if (!results.length) return;
    results.sort((a, b) => a.rtt - b.rtt);
    this.offset = results[0].offset;
    this.rtt = results[0].rtt;
    if (!this.pingTimer) {
      this.pingTimer = setInterval(async () => {
        if (!this.socket?.connected) return;
        const t0 = Date.now();
        const st = await this.socket.timeout(3000).emitWithAck('time').catch(() => null);
        if (typeof st !== 'number') return;
        const rtt = Date.now() - t0;
        this.rtt = Math.round(this.rtt * 0.6 + rtt * 0.4);
        if (rtt < this.rtt * 1.5) this.offset += (st + rtt / 2 - Date.now() - this.offset) * 0.2;
        this.emit('ping', this.rtt);
      }, 4000);
    }
  }

  startOffline() {
    this.online = false;
    this.local = new DJController(() => Date.now());
    this.setStatus('offline');
    setInterval(() => this.local.tick() && this.emit('dj:state', this.local.snapshot()), 500);
    this.aura = { style: load('erave.aura.offline', null)?.style || null };
    queueMicrotask(() => this.emit('hello', { dj: this.local.snapshot(), online: 1 }));
  }

  async checkDJ(key) {
    if (!this.online) return true;
    return this.socket.timeout(4000).emitWithAck('dj:auth', key).catch(() => false);
  }

  /**
   * Join the rave. `ticket` is the pass's signed token: the server verifies it and turns away
   * anyone without a valid one (the DJ's password aside) — that throws, with code TICKET_REQUIRED.
   */
  async join(profile, djKey, ticket) {
    this.profile = profile;
    this.djKey = djKey || null;
    this.ticket = ticket || null;
    this.joined = true;
    if (this.online) {
      const welcome = await this.socket.timeout(6000).emitWithAck('join', { ...profile, djKey: this.djKey, ticket: this.ticket, auraKey: auraKey() });
      if (welcome?.error) {
        this.joined = false;
        throw Object.assign(new Error('Entry refused: no valid ticket'), { code: welcome.error, reason: welcome.reason });
      }
      this.isDJ = !!welcome.isDJ;
      if (welcome.aura) {
        if (welcome.aura.key && welcome.aura.key !== auraKey()) save('erave.auraKey', welcome.aura.key);
        this.aura = { style: welcome.aura.style };
      }
      return welcome;
    }
    this.isDJ = !!djKey;
    return { id: this.id, isDJ: this.isDJ, players: [], dj: this.local.snapshot(), chat: [], liveMic: null, aura: { ...this.aura }, bottle: null };
  }

  sendState(arr) {
    this.lastState = arr;
    if (this.online) this.socket.volatile.emit('state', arr);
  }

  /**
   * Order VIP Bottle Service (free): { tier, signText, signStyle }. Resolves with
   * { ok, position } or { ok: false, error }. Offline, the presentation plays locally.
   */
  async bottle(req) {
    if (this.online) {
      try {
        return await this.socket.timeout(6000).emitWithAck('AURA_BOTTLE_TRIGGER', req);
      } catch {
        return { ok: false, error: "The server didn't answer — try again." };
      }
    }
    const cfg = BOTTLE_TIERS[req?.tier];
    if (!cfg) return { ok: false, error: 'Unknown bottle tier.' };
    if (this.localBottleFree > Date.now() + 60000) return { ok: false, error: 'The VIP line is full — try again in a minute.' };
    const style = SIGN_STYLE_IDS.includes(req.signStyle) ? req.signStyle : SIGN_STYLE_IDS[0];
    this.aura = { style };
    save('erave.aura.offline', this.aura);
    const now = Date.now();
    const startAt = Math.max(now, this.localBottleFree);
    this.localBottleFree = startAt + cfg.durationMs + BOTTLE_GAP_MS;
    setTimeout(() => {
      const [x = 0, y = 0, z = 12] = this.lastState || [];
      this.emit('aura:bottle', {
        userId: this.id,
        userName: this.profile?.name || 'You',
        tier: Number(req.tier),
        signText: cleanSignText(req.signText) || this.profile?.name || 'VIP',
        signStyle: style,
        userCoords: { x, y, z },
        durationMs: cfg.durationMs,
        timestamp: Date.now(),
      });
    }, startAt - now);
    return { ok: true, position: startAt > now ? 2 : 1 };
  }

  emote(dance) {
    if (this.online) this.socket.emit('emote', dance);
  }

  /** Rave emote on (move id) or off (null): the AVATAR_DANCE_CHANGE message. */
  danceChange(move) {
    if (this.online) this.socket.emit('AVATAR_DANCE_CHANGE', { type: 'AVATAR_DANCE_CHANGE', userId: this.id, move, timestamp: Date.now() });
  }

  react(type) {
    if (this.online) this.socket.emit('react', type);
  }

  updateProfile(profile) {
    this.profile = profile;
    if (this.online) this.socket.emit('avatar', profile);
  }

  chat(text) {
    if (this.online) return this.socket.emit('chat', text);
    this.emit('chat', {
      id: this.id,
      name: this.profile?.name || 'You',
      color: this.profile?.avatar?.accent,
      isDJ: this.isDJ,
      text: String(text).slice(0, 140),
      ts: Date.now(),
    });
  }

  /** Private message to one player (server relays it to them only). */
  dm(to, text) {
    if (this.online) this.socket.emit('dm', { to, text });
  }

  /** Short line shown in a bubble above your head for everyone nearby (not in the chat log). */
  say(text) {
    if (this.online) this.socket.emit('say', text);
  }

  dj(action, arg) {
    if (this.online) return this.socket.emit('dj', { action, arg });
    if (this.local.apply(action, arg)) this.emit('dj:state', this.local.snapshot());
  }

  /** DJ: strobe lighting mode / rate / flash length ({ mode, rate, flashMs }, any subset). */
  light(update) {
    if (this.online) return this.socket.emit('dj:light', update);
    const { hold, ...rest } = update || {};
    this.lightState = cleanLight(rest, this.lightState);
    this.emit('light', { ...this.lightState, by: this.profile?.name });
  }

  /** DJ: the laser show ({ action: 'auto' | 'phase' | 'blackout' | 'stop', phase }); starts on the next beat. */
  show(cmd) {
    if (this.online) return this.socket.emit('dj:show', cmd);
    this.showState = cleanShow(cmd, this.showState, this.local?.snapshot(), this.serverNow());
    this.emit('show', this.showState);
  }

  /** DJ: drone cam flight mode / speed / live feed ({ mode, speed, feed }, any subset). */
  dronecam(update) {
    if (this.online) return this.socket.emit('dj:dronecam', update);
    this.droneState = cleanDroneCam(update, this.droneState, this.serverNow());
    this.emit('dronecam', this.droneState);
  }

  /** DJ: the hold-to-flash button pressed (true) or released (false). */
  lightHold(on) {
    if (this.online) return this.socket.emit('dj:light:hold', !!on);
    this.lightState = cleanLight({ hold: !!on }, this.lightState);
    this.emit('light', this.lightState);
  }

  fx(type) {
    if (this.online) return this.socket.emit('dj:fx', type);
    this.emit('fx', { type, by: this.profile?.name });
  }

  announce(text) {
    if (this.online) return this.socket.emit('dj:announce', text);
    this.emit('announce', { text: String(text).slice(0, 80), by: this.profile?.name });
  }

  trackEnded(uid) {
    if (this.online) return this.socket.emit('track:ended', uid);
    if (this.local.reportEnded(uid)) this.emit('dj:state', this.local.snapshot());
  }

  /** The player found out how long a track is (YouTube): the server can advance it on time. */
  trackDuration(uid, seconds) {
    if (this.online) return this.socket.emit('track:duration', { uid, duration: seconds });
    if (this.local.reportDuration(uid, seconds)) this.emit('dj:state', this.local.snapshot());
  }

  async upload(file) {
    if (!this.online) return URL.createObjectURL(file);
    const res = await fetch(`${SERVER}/api/upload`, {
      method: 'POST',
      headers: {
        'x-dj-key': this.djKey || '',
        'x-filename': encodeURIComponent(file.name),
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return SERVER && data.url.startsWith('/') ? SERVER + data.url : data.url;
  }

  rtc(event, payload) {
    if (this.online) this.socket.emit(event, payload);
  }
}
