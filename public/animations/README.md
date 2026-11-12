# Dance clips

Drop pre-baked clips for the rave emotes here and they replace the procedural moves.
You don't need to change any code.

## Humanoid clips (Mixamo-style)

`dance_tiktok.glb` is a standard humanoid clip, with Mixamo bone names such as `Hips`,
`LeftArm`, `LeftForeArm` and `LeftUpLeg`. Clips like this are **retargeted onto the avatar
rig when the page loads** (`src/avatar/retarget.js`):

- Each limb's direction is solved into the rig's joints, so the source's bone axes and rest
  pose don't matter.
- The feet are kept on the floor.
- The dance's tempo and beat phase are detected. It uses the bounce when the motion has a
  clear one, otherwise the spacing between movement accents.
- The loop is rounded to whole beats and played straight off the room's beat clock, so it
  stays on the kick at any BPM.

The browser console logs the result as `[dance] … humanoid clip retargeted {…}`.

To add another humanoid dance, put the `.glb` here, add it to `DANCE_MOVES` in
`src/avatar/clips.js`, and give it a button in `RAVE_EMOTES` in `src/avatar/dances.js`. If
other players should see it, also add it to the server's allowed moves.

## Rig clips

| File | Move | Recorded at |
| --- | --- | --- |
| `muzzing.glb` | Muzzing | 150 BPM |
| `hakken.glb` | Hakken | 160 BPM |
| `groove.glb` | Groove | 124 BPM |

The file names and tempos are set in `DANCE_MOVES` in `src/avatar/clips.js`. Playback speed
scales from the recorded tempo to the room's live BPM.

## What a clip needs

- A binary glTF (`.glb`) whose **first animation** is the dance. It should loop seamlessly over
  a whole number of beats.
- Tracks that target the avatar rig's node names: `body`, `torso`, `head`, `armL`, `foreL`,
  `armR`, `foreR`, `legL`, `shinL`, `legR`, `shinR`. Use `.quaternion` or `.rotation` on
  each node, and `.position` on `body` only.
- The same axes as the procedural poses:
  - Torso and head pitch on X, turn on Y and roll on Z.
  - Arms swing on X (negative = forward / up), open sideways on Z and twist on Y (Euler
    order XZY).
  - Forearms (`foreL`, `foreR`) bend at the elbow on X (negative = forward).
  - Legs swing on X and open on Z.
  - Shins (`shinL`, `shinR`) bend at the knee on X (positive = back).
  - `body.position` is the bounce and sway, in rig units. `body.rotation.y` is the yaw.

Mixamo or FBX mocap uses a different skeleton, so retarget it onto these node names first,
e.g. with `SkeletonUtils.retargetClip`, then export to `.glb`.

If a file is missing or can't be read, that move keeps its procedural version. Failures are
logged to the browser console as a `[dance]` warning.
