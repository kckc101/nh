// E-Rave Cambodia — app flow: ticket gate → avatar studio → festival.
//
// The gate (ui/gate.js) is all that runs at first: no 3D scene, no music, no multiplayer
// connection. Only a verified ticket (or the DJ entrance) gets past it; the rave's code (three.js,
// the world, the HUD) is fetched in the background meanwhile and only started after Enter.

import './style.css';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import { AudioEngine } from './audio/engine.js';
import { Network } from './net/network.js';
import { BOTTLE_TIERS } from '../shared/aura.js';
import { showGate, clearPass, setGateMessage } from './ui/gate.js';
import { toast, el } from './ui/dom.js';
import { params, settings, saveSettings, isMobile } from './core/device.js';
import { load, save } from './core/store.js';
import { normalizeAvatar, randomAvatar } from './avatar/options.js';
import { isPhotoUrl } from './avatar/photo.js';
import { VENUE, CENTER_Z, vipSpot } from './world/venue.js';

/** The rave's code, fetched once: everything 3D and in-rave. Nothing in it runs until it's used. */
let festivalCode = null;
const loadFestival = () =>
  (festivalCode ||= Promise.all([
    import('./world/world.js'), import('./ui/hud.js'), import('./ui/djpanel.js'), import('./ui/dm.js'), import('./ui/saybox.js'),
    import('./ui/seat.js'), import('./ui/aura.js'), import('./ui/dronepip.js'), import('./world/sign.js'), import('./net/rtc.js'),
    import('./avatar/clips.js'), import('./ui/studio.js'),
  ]).then(([world, hud, djpanel, dm, saybox, seat, aura, dronepip, sign, rtc, clips, studio]) => ({
    World: world.World, HUD: hud.HUD, DJPanel: djpanel.DJPanel, DMPanel: dm.DMPanel, botReply: dm.botReply, SayBox: saybox.SayBox,
    SeatBar: seat.SeatBar, AuraUI: aura.AuraUI, DronePipPanel: dronepip.DronePipPanel, styleMeta: sign.styleMeta, LiveMic: rtc.LiveMic,
    loadDanceClips: clips.loadDanceClips, clipFor: clips.clipFor, clipStatus: clips.clipStatus, showStudio: studio.showStudio,
  })));

// Windows has no flag-emoji glyphs (🇰🇭 shows as "KH"): load a flags-only web font there.
// Self-hosted next to index.html so it works offline and from a GitHub Pages sub-path.
polyfillCountryFlagEmojis('Twemoji Country Flags', new URL('TwemojiCountryFlags.woff2', document.baseURI).href);

const ui = document.getElementById('ui');
const app = document.getElementById('app');
const flashEl = document.getElementById('flash');

const audio = new AudioEngine();
// Ravers' YouTube / SoundCloud player, mounted from the start (see hud.js for the DJ's). It
// stays rendered — on screen, a real (2 px) size, all but transparent, behind everything —
// because browsers throttle iframes that are display:none, zero-sized or off-screen. Tiny also
// means YouTube streams the smallest video alongside the audio.
const hiddenEmbed = document.createElement('div');
hiddenEmbed.className = '[&>iframe]:w-full [&>iframe]:h-full';
hiddenEmbed.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden';
hiddenEmbed.setAttribute('aria-hidden', 'true');
document.body.append(hiddenEmbed);
audio.mountEmbed(hiddenEmbed);
const net = new Network();
audio.serverNow = () => net.serverNow();
window.erave = { audio, net }; // console debugging

let djState = null;
const applyDJ = (s) => {
  if (!s) return;
  djState = s;
  audio.sync(s);
};
net.on('hello', (h) => applyDJ(h.dj));
net.on('dj:state', applyDJ);
audio.on('ended', (uid) => net.trackEnded(uid));
audio.on('duration', (uid, seconds) => net.trackDuration(uid, seconds));
audio.on('notice', (m) => net.isDJ && toast(m)); // source / track problems are the DJ's business

const FX_LABEL = {
  drop: '💥 THE DROP', breakdown: '🌌 BREAKDOWN',
  fire: '🔥 FIRE CANNONS', co2: '💨 CO2 JETS', smoke: '🌫️ SMOKE BURST', blackout: '⚡ BLACKOUT STROBE',
  lasers: '🟢 LASER STORM', confetti: '🎊 CONFETTI DROP', fireworks: '🎆 FIREWORKS', hype: '🙌 CROWD HYPE',
};

async function fontsReady() {
  // Google Fonts splits each family into unicode-range subsets; pass sample text so the
  // Khmer subsets are fetched before any canvas (signs, LED wall, name tags) draws Khmer.
  const KM = 'កម្ពុជា ភ្នំពេញ សួស្តី';
  const loads = [
    document.fonts.load('48px Koulen', 'E-RAVE'),
    document.fonts.load('48px Koulen', KM),
    document.fonts.load('600 32px "Chakra Petch"'),
    document.fonts.load('32px "Kantumruy Pro"', KM),
    document.fonts.load('600 32px "Kantumruy Pro"', KM),
    document.fonts.load('32px "Twemoji Country Flags"', '🇰🇭'),
  ];
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 2500))]);
}

function savedProfile() {
  const p = load('erave.profile');
  return {
    name: p?.name || '',
    tag: p?.tag || '',
    avatar: normalizeAvatar(p?.avatar || randomAvatar()),
    photo: isPhotoUrl(p?.photo) ? p.photo : null,
  };
}

function ledLines(text) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 16 && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

async function boot() {
  const wantsDJ = params.has('dj') && params.get('dj') !== 'false';
  const quick = params.has('quick');
  await fontsReady();

  // The gate: nothing past this point runs without a verified ticket (or the DJ entrance).
  const pass = await showGate(ui, { wantsDJ, quick, name: savedProfile().name, onEnter: () => audio.init(), preload: loadFestival });
  if (quick) audio.init();
  const code = await loadFestival();
  const { showStudio } = code;
  // Dance clips in public/animations/ (and the retargeted TikTok dance) load in the background,
  // so the avatar studio can preview them too.
  code.loadDanceClips().then((ids) => ids.length && console.info(`[dance] using clips for: ${ids.join(', ')}`));
  audio.setMuffled(true, 0.01);
  const netReady = net.connect();

  let result;
  if (quick) {
    await netReady;
    const profile = savedProfile();
    profile.name ||= pass?.name?.slice(0, 18) || `Raver${Math.floor(Math.random() * 900 + 100)}`;
    result = { profile, djKey: wantsDJ ? params.get('key') || (net.online ? '' : 'local') : null };
  } else {
    const profile = savedProfile();
    profile.name ||= pass?.name?.slice(0, 18) || ''; // the name on your ticket, to start with
    result = await showStudio({ root: ui, audio, net, profile, wantsDJ, netReady });
  }
  save('erave.profile', result.profile);
  await netReady;
  if (djState) audio.sync(djState); // re-seek now that the clock offset is known

  let welcome;
  try {
    welcome = await net.join(result.profile, result.djKey, pass?.token);
  } catch (err) {
    if (err.code === 'TICKET_REQUIRED') {
      // The server turned the ticket away (never verified, a test ticket after sales opened,
      // revoked): back to the gate, which says why.
      if (err.reason !== 'NO_TICKET') clearPass();
      setGateMessage(err.reason === 'TEST_TICKET' ? 'That was a test ticket from before real ticket sales started. Get a ticket to enter.' : "Your ticket wasn't accepted at the door. Get a ticket, or enter your ticket code.");
      location.reload();
      return;
    }
    toast('Could not join the server — continuing with the local crowd', 'error');
    welcome = { players: [], chat: [], isDJ: false, dj: djState };
  }
  if (wantsDJ && !welcome.isDJ) toast('DJ password not accepted — joined as a raver', 'error', 4500);
  enterFestival(code, result.profile, welcome, pass);
}

function enterFestival(code, profile, welcome, pass) {
  const { World, HUD, DJPanel, DMPanel, botReply, SayBox, SeatBar, AuraUI, DronePipPanel, styleMeta, LiveMic, clipFor, clipStatus } = code;
  const isDJ = !!welcome.isDJ;
  // Your ticket's tier, as the server verified it (offline: as the gate last verified it).
  const tier = isDJ ? null : welcome.tier || pass?.type || 'general';
  const vip = tier === 'vip';
  const world = new World(app, audio);
  const player = world.setPlayer(profile, isDJ, { vip });
  const crowd = world.crowd;
  const mic = new LiveMic(net, audio);

  const doDance = (id) => {
    player.setDance(id);
    hud.setDance(id);
    net.emote(id);
  };
  // Rave emotes toggle: picking the active one again stops it and blends back to idle.
  const doEmote = (move) => {
    const stop = player.dance === move;
    if (!stop && clipStatus(move) && !clipFor(move)) {
      toast(clipStatus(move) === 'loading' ? 'That dance is still loading — try again in a second' : 'That dance couldn’t be loaded', 'info', 2500);
      if (clipStatus(move) === 'loading') return;
    }
    const next = stop ? (isDJ ? 'dj' : 'idle') : move;
    player.setDance(next);
    hud.setDance(next);
    net.danceChange(stop ? null : move);
    if (stop && isDJ) net.emote('dj');
  };
  const doReact = (type) => {
    crowd.react(player.avatar, type, 'me');
    hud.floatReaction(type);
    net.react(type);
  };

  const hud = new HUD(ui, {
    audio,
    net,
    isDJ,
    actions: {
      dance: doDance,
      emote: doEmote,
      react: doReact,
      chat: (t) => net.chat(t),
      quick: (t, r) => {
        net.chat(t);
        doReact(r);
      },
      joystick: (x, y) => player.setJoystick(x, y),
      toggleDJ: () => djPanel?.toggle(),
      drone: (on) => world.setDroneView(on ?? !world.droneView),
      pip: () => dronePip.toggle(),
      pov: () => togglePov(),
      quality: (q) => world.setQuality(q),
      cinematic: (on) => world.setCinematic(on),
      autoPerf: (on) => {
        world.gov.setEnabled(on);
        world.applyPerf();
      },
      bots: (n) => {
        settings.bots = n;
        saveSettings();
        crowd.setBotCount(n);
      },
    },
  });
  const djPanel = isDJ ? new DJPanel(ui, { net, audio, mic }) : null;
  hud.setDance(player.dance);

  // ---------------------------------------------------------------- strobe / beat-blackout lighting
  const lighting = world.lighting;
  let warnedStrobe = false;
  let lightReady = false;
  const applyLight = (s) => {
    const was = lighting.active;
    const wasArena = lighting.state.arena;
    lighting.set(s);
    djPanel?.setLight(lighting.state);
    if (lightReady && !isDJ && !wasArena && lighting.state.arena) toast('🌑 Arena blackout: eyes on the stage', 'fx', 2600);
    if (!isDJ && !was && lighting.active && !settings.reduceFlash && !warnedStrobe) {
      warnedStrobe = true;
      toast('⚡ Strobe lighting — turn on “Reduce flashing lights” in Settings if flashes bother you', 'fx', 6000);
    }
  };
  applyLight(welcome.light || {});
  lightReady = true;
  net.on('light', applyLight);

  // ---------------------------------------------------------------- the laser show (MAIN DROP)
  const applyShow = (s) => {
    world.show.applyState(s);
    djPanel?.setShow(s);
  };
  world.show.onStatus = (status, state) => djPanel?.setShowStatus(status, state);
  applyShow(welcome.show || {});
  net.on('show', applyShow);

  // ---------------------------------------------------------------- drone cam (flight + live feed)
  const applyDroneCam = (s) => {
    world.droneCam.applyState(s);
    world.broadcast.applyState(world.droneCam.state); // which camera each screen shows, the director
    djPanel?.setDroneCam(world.droneCam.state);
  };
  // The DJ panel shows what's on air on each output (the director's cuts too).
  world.broadcast.onCut = (out, cam) => djPanel?.setOnAir(out, cam);
  if (djPanel) for (const out of ['dj', 'raver']) djPanel.setOnAir(out, world.broadcast.output(out).cam);
  applyDroneCam(welcome.dronecam || {});
  net.on('dronecam', applyDroneCam);
  if (isDJ) {
    // H = hold to flash, L = cycle Normal → Auto strobe → Blackout; N = the next camera on the DJ
    // screen, Shift+N on the raver screens, M = both back to the auto director.
    const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    addEventListener('keydown', (e) => {
      if (typing(e.target) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyH') djPanel.holdFlash(true);
      else if (e.code === 'KeyL') djPanel.cycleLight();
      else if (e.code === 'KeyN') djPanel.nextCamera(e.shiftKey ? 'raver' : 'dj');
      else if (e.code === 'KeyM') djPanel.autoAll();
      else if (e.code === 'KeyK') djPanel.toggleArena(); // Arena Blackout (B is the drone)
    });
    addEventListener('keyup', (e) => e.code === 'KeyH' && djPanel.holdFlash(false));
    addEventListener('blur', () => djPanel.holdFlash(false));
  }

  // ---------------------------------------------------------------- camera views
  const togglePov = () => {
    const view = player.view === 'pov' && !world.droneView ? 'third' : 'pov';
    if (world.droneView) world.setDroneView(false);
    player.setView(view);
    hud.setPov(view === 'pov');
  };

  // ---------------------------------------------------------------- tap a raver
  // Someone else → private chat. Yourself → a line in a bubble above your head.
  const dm = new DMPanel(ui, {
    onSend: (peer, text) => {
      if (peer.kind === 'player') return net.dm(peer.id, text);
      setTimeout(() => dm.receive(peer, botReply()), 1200 + Math.random() * 1800); // simulated raver
    },
  });
  const sayBox = new SayBox(ui, {
    onSay: (text) => {
      player.avatar.say(text, 8);
      net.say(text);
      if (player.view === 'pov') toast(`💬 Above your head: “${text}”`);
    },
  });
  const peerOf = (av) => {
    for (const [id, r] of crowd.remotes) if (r.av === av) return { id, kind: 'player', name: r.name, accent: av.config.accent, isDJ: r.isDJ };
    if (av.botId || av === crowd.resident) return { id: av.botId || 'bot-resident', kind: 'bot', name: av.name, accent: av.config.accent };
    return null;
  };
  player.onTap = (x, y) => {
    const av = world.pick(x, y);
    if (!av) {
      // A seat in the stands: sit there (anywhere in the stadium).
      const seat = !isDJ && world.pickSeat(x, y);
      if (seat) player.sitAt(seat);
      return;
    }
    if (av === player.avatar) return sayBox.open();
    const peer = peerOf(av);
    if (peer) dm.open(peer);
  };
  // Hover (mouse): what's under the pointer is looked up once it comes to rest, not on every move.
  let hoverTimer = 0;
  player.onHover = (x, y) => {
    clearTimeout(hoverTimer);
    if (x === null) {
      world.hoverSeat = null;
      return;
    }
    hoverTimer = setTimeout(() => {
      if (world.droneView) return;
      const av = world.pick(x, y);
      world.hoverSeat = !av && !isDJ ? world.pickSeat(x, y) : null;
      world.renderer.domElement.style.cursor = av || world.hoverSeat ? 'pointer' : '';
    }, 120);
  };

  // ---------------------------------------------------------------- seats in the stands
  const seatBar = new SeatBar(ui, {
    onSit: () => player.seatHint && player.sitAt(player.seatHint),
    onStand: () => player.standUp(),
    onFace: (f) => player.face(f),
  });
  player.onSeatHint = (on) => seatBar.setHint(on);
  player.onSeat = (s) => {
    const was = seatBar.facing;
    seatBar.setSeated(s?.facing ?? null);
    hud.setSeated(!!s);
    hud.setDance(player.dance);
    if (!was !== !s) net.emote(player.dance); // sat down ('sit') / got up ('idle')
  };

  player.onAction = (kind, val) => {
    if (kind === 'dance') doDance(isDJ && val === 'idle' ? 'dj' : val);
    else if (kind === 'emote') doEmote(val);
    else if (kind === 'react') doReact(val);
    else if (kind === 'chat') hud.chat.focus();
    else if (kind === 'drone') world.setDroneView(!world.droneView);
    else if (kind === 'pip') dronePip.toggle();
    else if (kind === 'pov') togglePov();
    else if (kind === 'say') sayBox.toggle();
  };

  // ---------------------------------------------------------------- host / DJ presence
  const hostName = () => {
    if (isDJ) return profile.name;
    for (const r of crowd.remotes.values()) if (r.isDJ) return r.name;
    return 'DJ ANGKOR';
  };
  const refreshHost = () => hud.setHost(hostName());

  for (const p of welcome.players || []) crowd.addRemote(p);
  // Ravers arrive in a seat in the stands (the pitch is the stage's and the walkers'), facing
  // the DJ — clear of anyone already sitting there. The DJ arrives in the booth.
  // VIP ticket holders arrive on a VIP deck (east or west), the decks being theirs alone.
  if (vip) player.arriveAt(vipSpot(Math.random() < 0.5 ? 1 : -1));
  else if (!isDJ) player.sitAt(world.spawnSeat((welcome.players || []).filter((p) => p.id !== net.id)));
  let ropeAt = 0;
  player.onVipOnly = () => {
    const now = performance.now();
    if (now - ropeAt < 4000) return;
    ropeAt = now;
    toast('🥂 VIP deck: VIP ticket holders only', 'fx', 2600);
  };
  for (const m of welcome.chat || []) hud.chat.add(m);
  if (welcome.dj) applyDJ(welcome.dj);
  if (djState) djPanel?.render(djState);
  if (welcome.liveMic) {
    mic.listen(welcome.liveMic);
    hud.setMicLive(true);
  }
  hud.setTrack(audio.track);
  refreshHost();

  // ---------------------------------------------------------------- aura farming: VIP bottle service
  const auraUI = new AuraUI(ui, { slot: hud.vipSlot, name: profile.name, onOrder: (req) => net.bottle(req) });

  // ---------------------------------------------------------------- the live drone cam, picture-in-picture (I)
  const dronePip = new DronePipPanel(ui, {
    world,
    onChange: (on) => hud.setPip(on),
    onNoRoom: () => toast(`📹 No room for the drone cam picture-in-picture here — turn your phone upright, or ${isMobile ? 'tap the drone button' : 'press B'} to ride the drone`, 'info', 4000),
  });
  const myAura = welcome.aura?.style ?? net.aura.style;
  if (myAura) player.avatar.setAura(styleMeta(myAura).color);
  net.on('aura:queue', (q) => auraUI.setQueue(q));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Siren (tier 3) → air horn → DJ shoutout (tier 2+). Tier 3 ducks the music for it.
  const shoutout = async (evt) => {
    try {
      if (evt.tier >= 3) {
        audio.duckMusic(-3.5, 0.5);
        audio.playSting('siren');
        await sleep(1700);
      }
      const horn = audio.playSting('horn');
      if (evt.tier >= 2) {
        await sleep((horn || 0.9) * 1000 + 250);
        await audio.speak(`Big shout out to ${evt.userName}! V I P bottle service, coming through!`);
      }
    } catch (err) {
      console.warn('[aura] shoutout failed', err);
    } finally {
      if (evt.tier >= 3) audio.releaseMusicDuck(0.8);
    }
  };
  const bottles = world.bottles;
  bottles.resolve = (id) => (id === net.id ? player.avatar : crowd.remote(id));
  bottles.onStart = (evt, late) => {
    const mine = evt.userId === net.id;
    if (mine) auraUI.setQueue(null);
    hud.chat.add({ system: true, text: `🍾 ${mine ? 'You' : evt.userName} ordered ${BOTTLE_TIERS[evt.tier].label} bottle service — “${evt.signText}”` });
    if (late) return; // joined mid-show: no horn or shoutout
    if (evt.tier >= 2) hud.announce(`BOTTLES FOR ${evt.userName.toUpperCase()}`, '🍾 VIP BOTTLE SERVICE');
    else toast(`🍾 Bottle service for ${mine ? 'you' : evt.userName}!`, 'fx', 3000);
    crowd.erupt('vip', 0.45);
    shoutout(evt);
    // The drone's on them (and on the LED wall): offer the ride-along.
    setTimeout(() => {
      if (!world.droneView && bottles.active?.evt === evt) {
        toast(`📹 The drone cam is on ${mine ? 'you' : evt.userName} — ${isMobile ? 'tap the drone button' : 'press B'} to watch`, 'fx', 4000);
      }
    }, 2500);
  };
  bottles.onEnd = (evt) => evt.userId === net.id && toast('✨ Aura unlocked — your glow stays with you tonight', 'fx', 3500);
  net.on('aura:bottle', (evt) => bottles.play(evt));
  if (welcome.bottle) bottles.play(welcome.bottle);

  // ---------------------------------------------------------------- network → world
  net.on('players', (list) => crowd.applySnapshot(list, net.id));
  net.on('player:join', (p) => {
    crowd.addRemote(p);
    refreshHost();
  });
  net.on('player:leave', (id) => {
    crowd.removeRemote(id);
    dm.peerLeft(id);
    refreshHost();
  });
  net.on('say', ({ id, text }) => crowd.remote(id)?.say(text, 8));
  net.on('dm', (m) => dm.receive({ id: m.from, kind: 'player', name: m.name, accent: m.color, isDJ: m.isDJ }, m.text));
  net.on('player:avatar', (p) => crowd.setRemoteProfile(p));
  net.on('player:emote', ({ id, dance }) => crowd.remote(id)?.setDance(dance));
  net.on('AVATAR_DANCE_CHANGE', ({ userId, move }) => crowd.remote(userId)?.setDance(move || 'idle'));
  net.on('react', ({ id, type }) => {
    const av = crowd.remote(id);
    if (av) crowd.react(av, type, 'remote');
    hud.floatReaction(type);
  });
  net.on('chat', (m) => {
    hud.chat.add(m);
    const av = m.id === net.id ? player.avatar : crowd.remote(m.id);
    av?.say(m.text);
  });
  net.on('dj:state', (s) => djPanel?.render(s));
  net.on('fx', ({ type, by }) => {
    world.fx.trigger(type);
    toast(`${FX_LABEL[type] || type}${by ? ` — ${by}` : ''}`, 'fx', 2400);
    if (type === 'hype') {
      hud.hype('MAKE SOME NOISE!', '#00f0ff');
      crowd.erupt('drop', 0.95);
    } else if (type === 'drop') crowd.erupt('drop', 0.9);
    else if (type !== 'breakdown') crowd.erupt('fx', type === 'blackout' ? 0.2 : 0.35);
  });
  net.on('announce', ({ text, by }) => {
    hud.announce(text, by);
    world.stage.led.setText(ledLines(text), '', 8);
  });
  net.on('rtc:live', ({ live }) => hud.setMicLive(live));
  mic.on('change', (s) => hud.setMicLive(s.live));
  mic.on('error', (text) => !isDJ && toast(text, 'error', 5000)); // the DJ panel shows its own errors inline
  net.on('rejoined', (w) => {
    crowd.clearRemotes();
    for (const p of w.players || []) crowd.addRemote(p);
    if (w.dj) applyDJ(w.dj);
    if (w.light) applyLight(w.light);
    if (w.dronecam) applyDroneCam(w.dronecam);
    refreshHost();
    toast('Reconnected to the festival');
  });

  // ---------------------------------------------------------------- audio → world
  const onTrack = (t) => {
    hud.setTrack(t);
    world.fx.setMode(t?.type === 'synth' ? 'synth' : 'energy');
    if (!t) return;
    // Track info stays with the DJ: no "now playing" on the LED wall or in the chat.
    if (isDJ) hud.chat.add({ system: true, text: `🎶 Now playing: ${t.title} — ${t.artist}` });
    crowd.chatSoon('track', 3);
  };
  audio.on('track', onTrack);
  world.fx.setMode(audio.track?.type === 'synth' ? 'synth' : 'energy');
  if (audio.section) {
    world.fx.onSection(audio.section.name, audio.section.bar, true);
    crowd.setSection(audio.section.name);
  }
  audio.on('section', (name, bar, immediate) => {
    world.fx.onSection(name, bar, immediate);
    crowd.setSection(name);
    if (name === 'drop' && !immediate) {
      hud.hype('DROP!', '#ff2bd6');
      crowd.erupt('drop');
    }
  });
  audio.beat.on('kick', (s) => {
    world.fx.onKick(s);
    crowd.onKick();
  });
  audio.beat.on('surge', () => {
    if (world.fx.mode !== 'energy') return;
    world.fx.onSurge();
    hud.hype('DROP!', '#ff2bd6');
    crowd.erupt('drop');
  });

  // ---------------------------------------------------------------- crowd → HUD
  crowd.onBotChat = (av, text) => {
    hud.chat.add({ name: av.name, color: av.config.accent, text, bot: true });
    av.say(text);
  };
  crowd.onReaction = (type, source) => {
    if (source === 'bot' && Math.random() < 0.6) hud.floatReaction(type);
  };

  // ---------------------------------------------------------------- status & loop extras
  const refreshStatus = () => hud.setStatus(net.status, crowd.headcount);
  net.on('status', refreshStatus);
  net.on('online', refreshStatus);
  setInterval(refreshStatus, 2000);
  refreshStatus();
  world.on('fps', (fps) => hud.setStats(fps, net.online ? net.rtt : 0));
  world.on('perf', (s) => hud.setPerf(s));
  hud.setPerf(world.gov.state);
  world.on('degrade', (s) => toast(s.tier === 1 ? 'Low frame rate: turned off bloom to keep it smooth' : 'Still struggling: lighter particles and simpler distant avatars', 'info', 3500));
  world.on('drone', (on) => {
    hud.setDrone(on);
    seatBar.setDrone(on);
  });
  world.on('quality', (q) => {
    hud.markQuality(q);
    toast(`Graphics: ${q}`);
  });

  setInterval(() => net.sendState(player.netState()), 100);

  let flashOpacity = '';
  const strobeLoop = () => {
    const s = world.fx.mood.strobe;
    const fxFlash = settings.reduceFlash ? 0 : Math.min(0.18, s * 0.2);
    const o = Math.max(fxFlash, world.lighting.overlay).toFixed(3); // + the DJ strobe's white-out
    if (o !== flashOpacity) flashEl.style.opacity = flashOpacity = o; // the DOM only when it changes
    requestAnimationFrame(strobeLoop);
  };
  strobeLoop();

  world.start();
  // Arrive on a wide shot of the stadium (from the east, ~60° map pitch, both pylons in frame).
  player.introFrom({ x: 215, y: 150, z: CENTER_Z + 20 }, { x: 0, y: 8, z: CENTER_Z + 8 });
  audio.setMuffled(false, 2.2);
  setTimeout(() => hud.announce('WELCOME TO E-RAVE CAMBODIA', `${VENUE.name.toUpperCase()} · ${VENUE.city.toUpperCase()}`), 900);
  hud.chat.add({
    system: true,
    text: vip
      ? isMobile
        ? "You're on the VIP deck! Stick to move, bottom bar to dance, tap a seat to sit. Tap a name to message that raver, 👁 for POV."
        : "You're on the VIP deck! WASD to move · 1–9 Q E R F to dance · click any seat to sit · click a name to message that raver · P for POV · B for the drone cam."
      : isMobile
      ? isDJ
        ? 'You made it in! Stick to move, bottom bar to dance. Tap a name to message that raver, tap yourself to say something, 👁 for POV.'
        : "You're in your seat! Tap Stand up (or push the stick) to walk, the seat bar turns you, tap any seat to move. Tap a name to message that raver, 👁 for POV."
      : isDJ
        ? 'You made it in! WASD to move · 1–9 Q E R F to dance · click a name to message that raver · click yourself (or Y) to say something · P for POV · B for the drone cam.'
        : "You're in your seat! Space to stand · W to walk · 1–4 to turn · click any seat to move · 1–9 Q E R F to dance once you're up · click a name to message that raver · P for POV · B for the drone cam.",
  });
  if (isDJ) {
    toast('You are hosting — the booth is yours 🎧', 'fx', 4000);
    if (!isMobile) djPanel.toggle(true);
  }
  if (vip) {
    hud.chat.add({ system: true, text: '🥂 VIP access: you\'re on the VIP deck. The decks are VIP-only, and your name tag wears the gold VIP badge.' });
    setTimeout(() => toast('🥂 VIP access: welcome to the VIP deck', 'fx', 3500), 2500);
  }

  // One pass, one raver: entering with this ticket somewhere else lets this session go.
  net.on('ticket:replaced', () => {
    const veil = el(`
      <div class="pointer-events-auto fixed inset-0 z-[70] grid place-items-center bg-black/80 backdrop-blur-sm p-4 text-center">
        <div class="glass-strong rounded-2xl p-6 max-w-sm flex flex-col items-center gap-3">
          <div class="font-display text-3xl">PASS IN USE</div>
          <p class="text-sm text-white/70">Your ticket was just used to enter on another device or tab. A pass admits one raver at a time.</p>
          <button type="button" class="btn-rave rounded-xl px-6 py-3 font-display text-xl tracking-wider text-white">ENTER HERE INSTEAD</button>
        </div>
      </div>`);
    veil.querySelector('button').addEventListener('click', () => location.reload());
    document.body.append(veil);
    audio.setMuffled(true, 0.6);
  });

  // Expose for debugging in the console.
  Object.assign(window.erave, { world, crowd, player });
}

boot().catch((err) => {
  console.error(err);
  toast(`Something went wrong: ${err.message}`, 'error', 8000);
});
