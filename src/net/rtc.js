// Live DJ microphone over WebRTC. The DJ opens one peer connection per listener (mesh —
// fine for a club-sized crowd); Socket.io carries the signalling. Listeners duck the music
// while the DJ talks.

import { Emitter } from '../core/events.js';

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export class LiveMic extends Emitter {
  constructor(net, audio) {
    super();
    this.net = net;
    this.audio = audio;
    this.stream = null; // DJ side
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.liveDJ = null; // listener side: id of broadcasting DJ

    net.on('rtc:request', ({ from }) => this.stream && this.connectListener(from));
    net.on('rtc:live', ({ id, live }) => (live ? this.listen(id) : this.stopListening(id)));
    net.on('rtc:signal', ({ from, data }) => this.onSignal(from, data));
    net.on('player:leave', (id) => this.closePeer(id));
  }

  get supported() {
    return !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined';
  }

  get live() {
    return !!this.stream;
  }

  // ---------------------------------------------------------------- DJ side

  async start() {
    if (!this.net.online) throw new Error('Live mic needs the multiplayer server');
    if (!this.supported) throw new Error('This browser cannot capture audio (needs HTTPS or localhost)');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.net.rtc('rtc:live', true);
    this.emit('change', true);
    return this.stream;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.net.rtc('rtc:live', false);
    this.emit('change', false);
  }

  async connectListener(id) {
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
      if (pc.connectionState === 'failed') this.closePeer(id);
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
