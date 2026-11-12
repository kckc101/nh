// Private chat: tap a raver's name tag (or the raver) to open a one-to-one conversation.
// Real players are messaged through the server; simulated ravers answer with canned lines.
// Messages that arrive for a closed conversation show up as a tappable "new message" pill.

import { el, esc, markKhmer } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { accentColor } from '../avatar/options.js';

export class DMPanel {
  /** @param onSend (peer, text) => void */
  constructor(parent, { onSend }) {
    this.onSend = onSend;
    this.convos = new Map(); // peer id -> { peer, msgs: [{ text, mine, system }], unread, gone }
    this.current = null;

    this.node = el(`
      <div class="dm hidden pointer-events-auto absolute left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 right-auto md:right-4 top-[104px] md:top-[120px]
                  w-[min(92vw,330px)] h-[min(52dvh,430px)] glass-strong rounded-2xl flex-col overflow-hidden">
        <header class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/10">
          <span class="dot size-2.5 rounded-full shrink-0"></span>
          <div class="min-w-0 flex-1">
            <div class="name font-semibold text-sm truncate"></div>
            <div class="sub text-[10px] tracking-[.18em] text-white/45">PRIVATE CHAT</div>
          </div>
          <button type="button" class="close act rounded-lg size-8 grid place-items-center" aria-label="Close private chat">${icon('x', 'size-4')}</button>
        </header>
        <div class="log flex-1 overflow-y-auto scroll-thin px-3 py-2.5 flex flex-col gap-1.5" aria-live="polite"></div>
        <form class="flex gap-2 p-2.5 border-t border-white/10">
          <input class="field flex-1 min-w-0 !py-2 text-sm text-white placeholder:text-white/40" maxlength="200" placeholder="Message…" aria-label="Private message"/>
          <button class="act glass rounded-xl px-3 border border-white/10" aria-label="Send">${icon('send', 'size-4')}</button>
        </form>
      </div>`);
    this.pill = el(`
      <button type="button" class="dm-pill hidden pointer-events-auto absolute left-1/2 -translate-x-1/2 top-[104px] md:top-[64px] glass-strong rounded-full h-9 pl-3 pr-3.5
                     items-center gap-2 text-[13px] max-w-[min(86vw,360px)] border border-magenta/50 shadow-[0_0_18px_rgba(255,43,214,.35)]">
        <span>💌</span><span class="who font-semibold shrink-0"></span><span class="preview text-white/70 truncate"></span>
        <span class="count hidden rounded-full bg-magenta text-black text-[10px] font-bold px-1.5"></span>
      </button>`);
    parent.append(this.node, this.pill);
    renderIcons(this.node);

    this.log = this.node.querySelector('.log');
    this.input = this.node.querySelector('input');
    this.node.querySelector('.close').addEventListener('click', () => this.close());
    this.node.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      const c = this.current && this.convos.get(this.current);
      if (!text || !c || c.gone) return;
      this.input.value = '';
      this.push(c.peer, { text, mine: true });
      this.onSend(c.peer, text);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      e.stopPropagation(); // typing here must not move or dance the raver
    });
    this.pill.addEventListener('click', () => {
      const next = [...this.convos.values()].reverse().find((c) => c.unread);
      if (next) this.open(next.peer);
    });
  }

  get isOpen() {
    return !this.node.classList.contains('hidden');
  }

  convo(peer) {
    let c = this.convos.get(peer.id);
    if (!c) {
      c = { peer, msgs: [], unread: 0, gone: false };
      this.convos.set(peer.id, c);
    } else {
      c.peer = { ...c.peer, ...peer };
      c.gone = false;
    }
    return c;
  }

  /** Open (or switch to) the conversation with `peer` = { id, name, accent, kind, isDJ }. */
  open(peer) {
    const c = this.convo(peer);
    c.unread = 0;
    this.current = peer.id;
    const color = accentColor(c.peer.accent);
    this.node.querySelector('.dot').style.cssText = `background:${color};box-shadow:0 0 10px ${color}`;
    const name = this.node.querySelector('.name');
    name.textContent = c.peer.name;
    name.style.color = color;
    this.node.querySelector('.sub').textContent = c.peer.kind === 'bot' ? 'PRIVATE CHAT · IN THE CROWD' : 'PRIVATE CHAT';
    this.node.style.setProperty('--accent', color);
    this.log.replaceChildren(...c.msgs.map((m) => this.row(m, c.peer)));
    if (!c.msgs.length) this.log.append(this.row({ system: true, hint: true, text: `Say hi to ${c.peer.name} — only they can see this.` }, c.peer));
    this.setGone(c.gone);
    this.node.classList.remove('hidden');
    this.node.classList.add('flex');
    this.log.scrollTop = this.log.scrollHeight;
    this.refreshPill();
    setTimeout(() => this.input.focus(), 30);
  }

  close() {
    this.current = null;
    this.input.blur();
    this.node.classList.add('hidden');
    this.node.classList.remove('flex');
    this.refreshPill();
  }

  /** Incoming message from `peer`. */
  receive(peer, text) {
    this.push(peer, { text, mine: false });
  }

  /** Another raver left: keep the history, stop sending. */
  peerLeft(id) {
    const c = this.convos.get(id);
    if (!c || c.gone) return;
    c.gone = true;
    this.push(c.peer, { system: true, text: `${c.peer.name} left the festival.` }, false);
    if (this.current === id) this.setGone(true);
  }

  push(peer, msg, countUnread = true) {
    const c = this.convo(peer);
    c.msgs.push(msg);
    if (c.msgs.length > 60) c.msgs.shift();
    if (this.current === peer.id && this.isOpen) {
      if (this.log.firstElementChild?.dataset.hint) this.log.replaceChildren();
      this.log.append(this.row(msg, c.peer));
      this.log.scrollTop = this.log.scrollHeight;
    } else if (!msg.mine && countUnread) {
      c.unread++;
      this.refreshPill(c, msg.text);
    }
  }

  setGone(gone) {
    this.input.disabled = gone;
    this.input.placeholder = gone ? 'They left the festival' : 'Message…';
  }

  row(m, peer) {
    const r = document.createElement('div');
    if (m.system) {
      r.className = 'self-center text-[11px] text-white/45 italic text-center px-2';
      if (m.hint) r.dataset.hint = '1';
      r.textContent = m.text;
      return r;
    }
    const color = accentColor(peer.accent);
    r.className = `msg-in max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug break-words ${m.mine ? 'self-end rounded-br-md bg-white/12' : 'self-start rounded-bl-md'}`;
    if (!m.mine) r.style.cssText = `background:color-mix(in srgb, ${color} 20%, transparent);border:1px solid color-mix(in srgb, ${color} 40%, transparent)`;
    r.innerHTML = esc(m.text);
    markKhmer(r, m.text);
    return r;
  }

  refreshPill(c, preview) {
    const unread = [...this.convos.values()].filter((x) => x.unread);
    const total = unread.reduce((n, x) => n + x.unread, 0);
    const show = total > 0;
    this.pill.classList.toggle('hidden', !show);
    this.pill.classList.toggle('flex', show);
    if (!show) return;
    const latest = c && c.unread ? c : unread[unread.length - 1];
    const who = this.pill.querySelector('.who');
    who.textContent = latest.peer.name;
    who.style.color = accentColor(latest.peer.accent);
    if (preview !== undefined) this.pill.querySelector('.preview').textContent = preview;
    const count = this.pill.querySelector('.count');
    count.textContent = String(total);
    count.classList.toggle('hidden', total < 2);
  }
}

// Replies from simulated ravers (they're bots, but friendly ones).
const BOT_REPLIES = [
  'heyy 👋 having fun?', 'this DJ is insane rn 🔥', 'meet at the north pylon later?', 'love your fit ✨',
  'first time at E-Rave?', 'សួស្តី! 😄', 'come dance near the front!', 'drop is coming, get ready 🙌',
  'haha same', 'where are you from?', 'PLUR 💜', 'my legs are dead but I can’t stop 😂', 'ID on this track?? 👀',
  'see you at the next one 🫶', 'សប្បាយណាស់!',
];
export const botReply = () => BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
