# E-Rave Cambodia — Web Client 🎧🇰🇭

The browser side of **E-Rave Cambodia**, a virtual neon rave festival. Visitors build a blocky Roblox-style raver, drop into a crowd in front of an Angkor-crowned mega-stage, and dance to music the host DJ controls.

The multiplayer server lives in **[kckc101/hh](https://github.com/kckc101/hh)**. Without it, the client runs as an offline demo: simulated crowd, built-in music, and local DJ controls.

## Run locally

```bash
# 1. start the server (in a clone of kckc101/hh)
npm install && npm run dev        # → http://localhost:3001

# 2. start this web client
npm install && npm run dev        # → http://localhost:5173
```

- Open **http://localhost:5173**. Vite proxies `/socket.io`, `/api` and `/uploads` to the server on port 3001. Set `SERVER_URL` to proxy somewhere else.
- Host mode: **http://localhost:5173/?dj=true** and enter the server's DJ password.
- Phones on the same Wi-Fi: use the `Network:` URL Vite prints.

## Deploy

```bash
npm run build                     # → dist/
```

Pick one:

- **GitHub Pages:** `.github/workflows/deploy.yml` builds and publishes on every push to `main`. Set Pages' source to "GitHub Actions". The site runs the offline demo unless the repository variable `VITE_SERVER_URL` points at a hosted server.
- **Same origin:** let the server host the build: `STATIC_DIR=../nh/dist npm start` in the hh repo.
- **Separate hosts** (e.g. GitHub Pages / Netlify + Render): build with `VITE_SERVER_URL=https://your-server.example npm run build`. The build uses relative asset paths, so it also works from a sub-path.

## Features

| Area | What's there |
| --- | --- |
| Landing | Neon Angkor skyline reflected in a pool, laser and bass-pulse canvas, "reduce flashing lights" toggle |
| Avatar Studio | Name and DJ tag, skin tones, hairstyles and colours, neon vest / kroma jacket / tee / hoodie / mesh tank, LED bucket hat, Apsara crown, glow glasses, glowsticks, LED gloves, 6 glow accents. The live 3D preview dances to the stage music, which you hear muffled "from outside the venue". |
| World (Three.js) | Stage, DJ booth with decks, LED wall with 4 audio-reactive shader programs, truss, line arrays, pulsing subs, neon Angkor Wat prangs, Phnom Penh skyline, sugar palms, street-food stalls, Khmer neon signs, entrance arch, kroma flags, festoon bulbs |
| Lights & FX | Moving-head beams with floor light pools, 100-beam laser rig, strobes, fire cannons, CO2 jets, smoke, confetti, fireworks, bloom. All are driven by live kick detection and the track's arrangement. |
| Controls | WASD/arrows (Shift to run, Space to jump), drag to orbit, wheel or pinch to zoom, touch joystick. Dances on `1–5` with `0` to go back to vibing; reactions on `Z X C V`. |
| Social | Spatial name tags, chat bubbles, TikTok-style rising reactions, stream chat with quick-hype buttons, simulated ravers, real multiplayer |
| DJ panel | Queue and playback, built-in tracks, file upload, MP3 URL, Icecast radio, YouTube/SoundCloud, FX pad, announcements, live mic over WebRTC, tap tempo |

## Audio

- **Built-in tracks** (`src/audio/synth.js`) are procedural Khmer-pentatonic rave tunes with a "roneat" mallet lead, rendered deterministically from a seed. Every client plays the same arrangement in sync with the server clock.
- **Live analysis** (`src/audio/beat.js`, `src/audio/onset-worklet.js`):
  - Peak/RMS levels and kick detection come from an `AnalyserNode`.
  - Tempo is detected live by autocorrelating an onset envelope. The envelope is computed on the audio thread by an AudioWorklet, so it's accurate even at low frame rates; it falls back to per-frame spectral flux without HTTPS.
  - The detected tempo replaces fixed BPM values and drives a phase-locked beat clock for the dances.
- **YouTube/SoundCloud** iframes and streams without CORS can't be analysed, so the lights follow the DJ-set BPM instead.

## Performance on weak hardware

`src/world/perf.js` measures real frame time and keeps phones and integrated GPUs smooth:

- **Dynamic resolution.** The render scale drops while FPS is under 50 and climbs back when there's headroom.
- **Effect fallback.** Sustained FPS under 30 first turns off bloom/post-processing, then cuts heavy particles to 35% and shortens LOD ranges.
- **Recovery.** Effects come back after long smooth stretches; each recovery doubles the wait so it doesn't flap.
- **Avatar LOD.** Near avatars get the full rig. Mid-range avatars animate at a third of the rate. Far avatars become single-mesh stand-ins, and off-screen ones skip animation entirely.

The HUD stats line shows the FPS, the current resolution and the current effect tier. Settings has an "Auto performance" toggle.

## Mic and volume

- **Volume.** Music and the DJ's live mic both pass through one MasterGain node, so volume and mute control everything. YouTube/SoundCloud players follow the same volume through their own player APIs.
- **Live mic.** The DJ panel shows the microphone permission state and offers "Test mic" (works offline) and an input-device picker. It shows plain-language errors for blocked, missing or busy microphones and has a dB meter. If Web Audio can't run, the meter falls back to WebRTC stats.

## Fonts

Khmer text uses Kantumruy Pro and Koulen from Google Fonts. The Khmer subsets are preloaded before any canvas draws them.

Windows has no flag-emoji glyphs, so `country-flag-emoji-polyfill` loads a flags-only font there. It's self-hosted as `public/TwemojiCountryFlags.woff2`; Twemoji graphics are by Twitter and licensed CC-BY 4.0.

## Layout

```
shared/dj.js     Playlist state machine (same file as in the server repo; used for offline mode)
src/main.js      App flow: landing → studio → festival
src/audio/       Audio engine, synth, beat detector, embeds
src/net/         Socket.io client with offline fallback, WebRTC live mic
src/avatar/      Avatar catalogue, merged-geometry builder, dances, name tags
src/world/       Renderer + bloom, stage, LED wall, lights, lasers, particles, FX director, crowd, player, environment
src/ui/          Landing, studio, HUD, chat, DJ panel, joystick
```
