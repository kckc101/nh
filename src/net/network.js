// Network layer. Talks to the Socket.io server when it's reachable; otherwise runs an
// in-browser "local hub" with the same DJ state machine so the festival works standalone
// (bots + you, full DJ controls).

import { io } from 'socket.io-client';
import { Emitter } from '../core/events.js';
import { DJController } from '../../shared/dj.js';

// Where the multiplayer server lives. Empty = same origin (Vite dev proxy, or the server
// hosting this build via STATIC_DIR). Set VITE_SERVER_URL when they're on different hosts.
const SERVER = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

const SERVER_EVENTS = [
  'hello', 'online', 'players', 'player:join', 'player:leave', 'player:avatar', 'player:emote',
  'react', 'chat', 'dj:state', 'fx', 'announce', 'rtc:live', 'rtc:signal', 'rtc:request',
];

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
          const welcome = await this.join(this.profile, this.djKey).catch(() => null);
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
    queueMicrotask(() => this.emit('hello', { dj: this.local.snapshot(), online: 1 }));
  }

  async checkDJ(key) {
    if (!this.online) return true;
    return this.socket.timeout(4000).emitWithAck('dj:auth', key).catch(() => false);
  }

  async join(profile, djKey) {
    this.profile = profile;
    this.djKey = djKey || null;
    this.joined = true;
    if (this.online) {
      const welcome = await this.socket.timeout(6000).emitWithAck('join', { ...profile, djKey: this.djKey });
      this.isDJ = !!welcome.isDJ;
      return welcome;
    }
    this.isDJ = !!djKey;
    return { id: this.id, isDJ: this.isDJ, players: [], dj: this.local.snapshot(), chat: [], liveMic: null };
  }

  sendState(arr) {
    if (this.online) this.socket.volatile.emit('state', arr);
  }

  emote(dance) {
    if (this.online) this.socket.emit('emote', dance);
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

  dj(action, arg) {
    if (this.online) return this.socket.emit('dj', { action, arg });
    if (this.local.apply(action, arg)) this.emit('dj:state', this.local.snapshot());
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
