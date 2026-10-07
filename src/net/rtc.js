// Live DJ microphone over WebRTC. The DJ opens one peer connection per listener (mesh —
// fine for a club-sized crowd); Socket.io carries the signalling. Listeners duck the music
// while the DJ talks.
//
// Also: microphone permission state (Permissions API, live-updating), friendly errors for
// every getUserMedia failure, a local "test mic" mode that works without the server,
// input-device selection, and a WebRTC-stats level reading used as a fallback meter.

import { Emitter } from '../core/events.js';

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Turn a getUserMedia / mic failure into something a DJ can act on. */
export function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access is blocked. Click the icon left of the address bar → Site settings → Microphone → Allow, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found. Plug one in (or turn it on in your system privacy settings) and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is busy or blocked by the system. Close other apps using it (Zoom, Discord, OBS…) and try again.';
    case 'OverconstrainedError':
      return 'That microphone can’t be used with these settings. Pick another input device.';
    case 'SecurityError':
      return 'The microphone only works on HTTPS or localhost.';
    case 'AbortError':
      return 'The microphone stopped unexpectedly. Try again.';
    default:
      return err?.message || 'Could not start the microphone.';
  }
}

export class LiveMic extends Emitter {
  constructor(net, audio) {
    super();
    this.net = net;
    this.audio = audio;
    this.stream = null; // DJ side: the captured mic
    this.broadcasting = false;
    this.deviceId = '';
    this.permission = 'unknown'; // granted | prompt | denied | insecure | unsupported | unknown
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.liveDJ = null; // listener side: id of broadcasting DJ

    net.on('rtc:request', ({ from }) => this.broadcasting && this.connectListener(from));
    net.on('rtc:live', ({ id, live }) => (live ? this.listen(id) : this.stopListening(id)));
    net.on('rtc:signal', ({ from, data }) => this.onSignal(from, data));
    net.on('player:leave', (id) => this.closePeer(id));
  }

  get supported() {
    return !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined';
  }

  get live() {
    return this.broadcasting;
  }

  get testing() {
    return !!this.stream && !this.broadcasting;
  }

  get status() {
    return { live: this.broadcasting, testing: this.testing, permission: this.permission };
  }

  setPermission(p) {
    if (p === this.permission) return;
    this.permission = p;
    this.emit('permission', p);
  }

  /** Query (and keep watching) the microphone permission without prompting the user. */
  async checkPermission() {
    if (!window.isSecureContext) return this.setPermission('insecure');
    if (!this.supported) return this.setPermission('unsupported');
    try {
      const st = await navigator.permissions.query({ name: 'microphone' });
      this.setPermission(st.state);
      st.onchange = () => this.setPermission(st.state);
    } catch {
      this.setPermission('unknown'); // e.g. browsers that can't query 'microphone'
    }
    return this.permission;
  }

  async devices() {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  /** Capture the mic (prompts if needed). Throws an Error with a friendly message. */
  async open() {
    if (this.stream) return this.stream;
    if (!window.isSecureContext) {
      this.setPermission('insecure');
      throw new Error(micErrorMessage({ name: 'SecurityError' }));
    }
    if (!this.supported) {
      this.setPermission('unsupported');
      throw new Error('This browser can’t capture audio. Try an up-to-date Chrome, Edge, Firefox or Safari.');
    }
    const audio = this.deviceId ? { ...CONSTRAINTS, deviceId: { exact: this.deviceId } } : CONSTRAINTS;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      if (err?.name === 'OverconstrainedError' && this.deviceId) {
        this.deviceId = '';
        return this.open(); // chosen device vanished — fall back to the default input
      }
      if (err?.name === 'NotAllowedError') this.setPermission('denied');
      throw Object.assign(new Error(micErrorMessage(err)), { code: err?.name });
    }
    this.setPermission('granted');
    this.stream = stream;
    const [track] = stream.getAudioTracks();
    track?.addEventListener('ended', () => {
      this.emit('error', 'The microphone was disconnected.');
      this.stop();
    });
    return stream;
  }

  /** Local mic check — capture and meter it without broadcasting (works offline too). */
  async test() {
    await this.open();
    this.emit('change', this.status);
  }

  async start() {
    if (!this.net.online) throw new Error('Going live needs the multiplayer server. Use “Test mic” to check your microphone meanwhile.');
    await this.open();
    this.broadcasting = true;
    this.net.rtc('rtc:live', true);
    this.emit('change', this.status);
    return this.stream;
  }

  stop() {
    const wasLive = this.broadcasting;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.broadcasting = false;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (wasLive) this.net.rtc('rtc:live', false);
    this.emit('change', this.status);
  }

  /** Switch input device; restarts capture (and live peers) if the mic is open. */
  async setDevice(id) {
    this.deviceId = id;
    if (!this.stream) return;
    const live = this.broadcasting;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.open();
    if (live) for (const pid of [...this.peers.keys()]) this.connectListener(pid);
    this.emit('change', this.status);
  }

  /** Fallback meter source: the encoder's input level from WebRTC stats (0..1), if any. */
  async statsLevel() {
    let level = null;
    for (const pc of this.peers.values()) {
      try {
        const report = await pc.getStats();
        report.forEach((s) => {
          if (s.type === 'media-source' && s.kind === 'audio' && typeof s.audioLevel === 'number') level = Math.max(level ?? 0, s.audioLevel);
        });
      } catch {
        /* peer closing */
      }
    }
    return level;
  }

  async connectListener(id) {
    if (!this.stream) return;
    this.closePeer(id);
    const pc = this.makePeer(id);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.net.rtc('rtc:signal', { to: id, data: { sdp: pc.localDescription } });
  }

  // ---------------------------------------------------------------- listener side

  listen(djId) {
    if (djId === this.net.id) return;
    this.liveDJ = djId;
    this.net.rtc('rtc:request', { to: djId });
  }

  stopListening(djId) {
    if (this.liveDJ !== djId) return;
    this.liveDJ = null;
    this.closePeer(djId);
    this.audio.stopMic();
  }

  // ---------------------------------------------------------------- shared

  makePeer(id) {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = (e) => e.candidate && this.net.rtc('rtc:signal', { to: id, data: { candidate: e.candidate } });
    pc.ontrack = (e) => this.audio.playMic(e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed') return;
      if (id === this.liveDJ) this.emit('error', 'Couldn’t connect to the DJ’s microphone (network blocked the audio link).');
      this.closePeer(id);
    };
    this.peers.set(id, pc);
    return pc;
  }

  async onSignal(from, data) {
    try {
      if (data?.sdp?.type === 'offer') {
        if (from !== this.liveDJ) return;
        this.closePeer(from);
        const pc = this.makePeer(from);
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.net.rtc('rtc:signal', { to: from, data: { sdp: pc.localDescription } });
      } else if (data?.sdp?.type === 'answer') {
        await this.peers.get(from)?.setRemoteDescription(data.sdp);
      } else if (data?.candidate) {
        await this.peers.get(from)?.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.warn('[rtc]', err);
    }
  }

  closePeer(id) {
    const pc = this.peers.get(id);
    if (!pc) return;
    pc.close();
    this.peers.delete(id);
  }
}
