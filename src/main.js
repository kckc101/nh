// E-Rave Cambodia — app flow: landing → avatar studio → festival.

import './style.css';
import { AudioEngine } from './audio/engine.js';
import { Network } from './net/network.js';
import { LiveMic } from './net/rtc.js';
import { World } from './world/world.js';
import { HUD } from './ui/hud.js';
import { DJPanel } from './ui/djpanel.js';
import { showLanding } from './ui/landing.js';
import { showStudio } from './ui/studio.js';
import { toast } from './ui/dom.js';
import { params, settings, saveSettings, isMobile } from './core/device.js';
import { load, save } from './core/store.js';
import { normalizeAvatar, randomAvatar } from './avatar/options.js';

const ui = document.getElementById('ui');
const app = document.getElementById('app');
const flashEl = document.getElementById('flash');

const audio = new AudioEngine();
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
audio.on('notice', (m) => toast(m));

const FX_LABEL = {
  fire: '🔥 FIRE CANNONS', co2: '💨 CO2 JETS', smoke: '🌫️ SMOKE BURST', blackout: '⚡ BLACKOUT STROBE',
  lasers: '🟢 LASER STORM', confetti: '🎊 CONFETTI DROP', fireworks: '🎆 FIREWORKS', hype: '🙌 CROWD HYPE',
};

async function fontsReady() {
  const loads = [
    document.fonts.load('48px Koulen'),
    document.fonts.load('600 32px "Chakra Petch"'),
    document.fonts.load('32px "Kantumruy Pro"', 'កម្ពុជា'),
  ];
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 2500))]);
}

function savedProfile() {
  const p = load('erave.profile');
  return {
    name: p?.name || '',
    tag: p?.tag || '',
    avatar: normalizeAvatar(p?.avatar || randomAvatar()),
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

  if (quick) audio.init();
  else await showLanding(ui, () => audio.init());
  audio.setMuffled(true, 0.01);
  const netReady = net.connect();

  let result;
  if (quick) {
    await netReady;
    const profile = savedProfile();
    profile.name ||= `Raver${Math.floor(Math.random() * 900 + 100)}`;
    result = { profile, djKey: wantsDJ ? params.get('key') || (net.online ? '' : 'local') : null };
  } else {
    result = await showStudio({ root: ui, audio, net, profile: savedProfile(), wantsDJ, netReady });
  }
  save('erave.profile', result.profile);
  await netReady;
  if (djState) audio.sync(djState); // re-seek now that the clock offset is known

  let welcome;
  try {
    welcome = await net.join(result.profile, result.djKey);
  } catch {
    toast('Could not join the server — continuing with the local crowd', 'error');
    welcome = { players: [], chat: [], isDJ: false, dj: djState };
  }
  if (wantsDJ && !welcome.isDJ) toast('DJ password not accepted — joined as a raver', 'error', 4500);
  enterFestival(result.profile, welcome);
}

function enterFestival(profile, welcome) {
  const isDJ = !!welcome.isDJ;
  const world = new World(app, audio);
  const player = world.setPlayer(profile, isDJ);
  const crowd = world.crowd;
  const mic = new LiveMic(net, audio);

  const doDance = (id) => {
    player.setDance(id);
    hud.setDance(id);
    net.emote(id);
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
      react: doReact,
      chat: (t) => net.chat(t),
      quick: (t, r) => {
        net.chat(t);
        doReact(r);
      },
      joystick: (x, y) => player.setJoystick(x, y),
      toggleDJ: () => djPanel?.toggle(),
      quality: (q) => world.setQuality(q),
      bots: (n) => {
        settings.bots = n;
        saveSettings();
        crowd.setBotCount(n);
      },
    },
  });
  const djPanel = isDJ ? new DJPanel(ui, { net, audio, mic }) : null;
  hud.setDance(player.dance);

  player.onAction = (kind, val) => {
    if (kind === 'dance') doDance(isDJ && val === 'idle' ? 'dj' : val);
    else if (kind === 'react') doReact(val);
    else if (kind === 'chat') hud.chat.focus();
  };

  // ---------------------------------------------------------------- host / DJ presence
  const hostName = () => {
    if (isDJ) return profile.name;
    for (const r of crowd.remotes.values()) if (r.isDJ) return r.name;
    return 'DJ ANGKOR';
  };
  const refreshHost = () => hud.setHost(hostName());

  for (const p of welcome.players || []) crowd.addRemote(p);
  for (const m of welcome.chat || []) hud.chat.add(m);
  if (welcome.dj) applyDJ(welcome.dj);
  if (djState) djPanel?.render(djState);
  if (welcome.liveMic) {
    mic.listen(welcome.liveMic);
    hud.setMicLive(true);
  }
  hud.setTrack(audio.track);
  refreshHost();

  // ---------------------------------------------------------------- network → world
  net.on('players', (list) => crowd.applySnapshot(list, net.id));
  net.on('player:join', (p) => {
    crowd.addRemote(p);
    refreshHost();
  });
  net.on('player:leave', (id) => {
    crowd.removeRemote(id);
    refreshHost();
  });
  net.on('player:avatar', (p) => crowd.setRemoteProfile(p));
  net.on('player:emote', ({ id, dance }) => crowd.remote(id)?.setDance(dance));
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
    } else crowd.erupt('fx', type === 'blackout' ? 0.2 : 0.35);
  });
  net.on('announce', ({ text, by }) => {
    hud.announce(text, by);
    world.stage.led.setText(ledLines(text), '', 8);
  });
  net.on('rtc:live', ({ live }) => hud.setMicLive(live));
  mic.on('change', (live) => hud.setMicLive(live));
  net.on('rejoined', (w) => {
    crowd.clearRemotes();
    for (const p of w.players || []) crowd.addRemote(p);
    if (w.dj) applyDJ(w.dj);
    refreshHost();
    toast('Reconnected to the festival');
  });

  // ---------------------------------------------------------------- audio → world
  const onTrack = (t) => {
    hud.setTrack(t);
    world.fx.setMode(t?.type === 'synth' ? 'synth' : 'energy');
    if (!t) return;
    world.stage.led.setText(['NOW PLAYING', ...ledLines(t.title).slice(0, 2)], '', 6);
    hud.chat.add({ system: true, text: `🎶 Now playing: ${t.title} — ${t.artist}` });
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
  world.on('quality', (q) => {
    hud.markQuality(q);
    toast(`Graphics: ${q}`);
  });

  setInterval(() => net.sendState(player.netState()), 100);

  const strobeLoop = () => {
    const s = world.fx.mood.strobe;
    flashEl.style.opacity = settings.reduceFlash ? '0' : String(Math.min(0.18, s * 0.2));
    requestAnimationFrame(strobeLoop);
  };
  strobeLoop();

  world.start();
  audio.setMuffled(false, 2.2);
  setTimeout(() => hud.announce('WELCOME TO E-RAVE CAMBODIA', 'សូមស្វាគមន៍ · WELCOME'), 900);
  hud.chat.add({
    system: true,
    text: isMobile ? 'You made it in! Use the stick to move and the bottom bar to dance.' : 'You made it in! WASD to move · 1–5 to dance · Z X C V to react · Enter to chat.',
  });
  if (isDJ) {
    toast('You are hosting — the booth is yours 🎧', 'fx', 4000);
    if (!isMobile) djPanel.toggle(true);
  }

  // Expose for debugging in the console.
  Object.assign(window.erave, { world, crowd, player });
}

boot().catch((err) => {
  console.error(err);
  toast(`Something went wrong: ${err.message}`, 'error', 8000);
});
