import {
  createIcons, Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Flame, Heart, Music, Mic, MicOff, Send,
  Maximize, Minimize, Settings, Wifi, WifiOff, Users, Radio, Upload, Link, Zap, Sparkles, PartyPopper, Disc3,
  Megaphone, X, MessageCircle, ChevronUp, ChevronDown, Trash2, Headphones, CloudFog, Dices, Gauge, Lock,
  Keyboard, Wind, Rocket, Hand, ListMusic, Plus, CircleHelp, Activity, Timer, AudioLines,
} from 'lucide';

const icons = {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Flame, Heart, Music, Mic, MicOff, Send, Maximize, Minimize,
  Settings, Wifi, WifiOff, Users, Radio, Upload, Link, Zap, Sparkles, PartyPopper, Disc3, Megaphone, X,
  MessageCircle, ChevronUp, ChevronDown, Trash2, Headphones, CloudFog, Dices, Gauge, Lock, Keyboard, Wind, Rocket,
  Hand, ListMusic, Plus, CircleHelp, Activity, Timer, AudioLines,
};

/** Replace every `<i data-lucide="name">` inside root with its SVG. */
export function renderIcons(root = document) {
  createIcons({ icons, root, attrs: { 'stroke-width': 2, 'aria-hidden': 'true' } });
}

export const icon = (name, cls = 'size-4') => `<i data-lucide="${name}" class="${cls}"></i>`;
