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
- **Beat detection** (`src/audio/beat.js`) uses an adaptive threshold on the 35–120 Hz band of an `AnalyserNode` and feeds a phase-locked beat clock for the dances.
- **YouTube/SoundCloud** iframes and streams without CORS can't be analysed, so the lights follow the DJ-set BPM instead.

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
