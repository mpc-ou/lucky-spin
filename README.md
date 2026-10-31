# Lucky Spin

[![Version](https://img.shields.io/github/package-json/v/mpc-ou/lucky-spin?label=version&color=b8893b)](package.json)
[![Source](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/mpc-ou/lucky-spin)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Deploy](https://github.com/mpc-ou/lucky-spin/actions/workflows/deploy-gh-pages.yml/badge.svg)](https://github.com/mpc-ou/lucky-spin/actions/workflows/deploy-gh-pages.yml)

A cinematic 3D lucky-draw game for gala nights.

A host character walks on stage with a ballot box, loads the balls into a brass cage and turns the crank. Then the host picks up the drawn ball, opens it and reveals the winning ticket. The stage has velvet curtains, spotlights, smoke and confetti.

The list editor is the only 2D screen; everything else is done through 3D props.

> **Note:** this project was built with **Claude Opus 5.5** (Anthropic) through Claude Code.

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [GPU acceleration](#gpu-acceleration)
- [Model packs (host characters)](#model-packs-host-characters)
- [Configuration](#configuration)
- [Performance](#performance)
- [Project structure](#project-structure)
- [Versioning and deployment](#versioning-and-deployment)
- [Contributing](#contributing)
- [Authors](#authors)
- [License](#license)

## Features

- **Fair draw:** the winner is chosen with `crypto.getRandomValues` at the moment the ball leaves the cage. The balls are only a visual stand-in, up to 200 of them.
- **Host characters:**
  - Specs the Fox (default), anime girl and MrBeast.
  - Procedural animation: two-bone IK, a skipping walk, gaze, and spring physics for hair and ears.
  - New characters are added as data-driven [model packs](#model-packs-host-characters), from source or uploaded as a `.zip`.
- **Physics:**
  - Cage spin: inertia, bearing friction and an off-centre weight make it rock 2–3 times before stopping.
  - Balls: a custom solver handles 200 balls in about 1 ms per frame.
- **Show:**
  - Camera director, lighting cues, depth of field, bloom, stage smoke and confetti.
  - Synthesized Web Audio, so every sound has a fallback without files.
- **List editor:**
  - Paste, import `.txt` / `.csv` or load sample data.
  - Mask ID numbers (`2251052127` → `225xxxx127`).
  - Optional winner limit, and an option to exclude previous winners.
- **Ticket box (draw history):**
  - Export to CSV.
  - Strike a ticket off. The person either goes back into the draw, or stays out as absent.
- **First-visit setup:** a short onboarding for the background image, host and music. It can be skipped, and every choice can be changed later in Settings.
- **Quality presets:** Low / Medium / High / Ultra, plus Auto (adapts to the measured FPS) and per-option overrides.

## Installation

Requirements: Node.js 20+ and npm or pnpm. You also need a desktop browser with WebGL 2: Chrome, Edge or Firefox.

```bash
git clone https://github.com/konya007/lucky-draw-0.git
cd lucky-draw-0
npm install        # or: pnpm install
npm run dev        # http://localhost:5173
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript check |
| `npm run compress-model -- <pack>` | Compress `src/assets/<pack>/source/source.glb` into `host.glb` |

## Usage

1. **First visit:** the onboarding checks GPU acceleration (with steps to enable it) and lets you preview and pick a background image, a host character and background music. You can skip it.
2. **Start the draw:** press **Start the draw** and paste the list, one entry per line. `Name | Prize | Note`, tab-separated text and CSV all work. Then press **Run the draw**.
3. **Loading:** the host holds the open ballot box in front of the curtain while the names drop in. Then the curtain rises and the host walks on, waving. The host opens the box and the balls fly into the cage.
4. **Spin:** click the glowing **crank** to let the host spin it, or drag it in circles to spin it yourself.
5. **Reveal:** the ball rolls into the tray and the host picks it up. Click the ball to open it and reveal the ticket.
6. **Next round:** click the ticket, or swipe it up, to file it in the ticket box and draw again.

| Shortcut | Action |
|---|---|
| `Space` | Spin / continue |
| `Enter` | Open the ball |
| `Esc` | Close the ticket, settings or history |
| `F` | ×2 speed |

URL parameters:

| Parameter | Effect |
|---|---|
| `?debug` | `r3f-perf` overlay (FPS, draw calls, triangles) |
| `?quality=low\|medium\|high\|ultra\|auto` | Force a graphics preset |

**Ending early:** hover the bottom-right corner, then press **Curtain down** twice.

## GPU acceleration

The game renders with WebGL 2, so it needs the browser to use the GPU. Without GPU access, the browser falls back to software rendering and the game runs at a few FPS.

<details>
<summary><b>How to enable GPU / WebGPU through browser flags</b></summary>

First check the current state.

**Chrome / Edge:** open `chrome://gpu` or `edge://gpu`. *WebGL* and *WebGL2* should say **Hardware accelerated**.

**Chrome / Edge**

1. Settings → System → turn on **Use graphics acceleration when available**, then restart the browser.
2. Open `chrome://flags` (`edge://flags` on Edge) and set:
   - `#ignore-gpu-blocklist` (*Override software rendering list*) → **Enabled**. This forces the GPU on drivers the browser has blocklisted.
   - `#use-angle` (*Choose ANGLE graphics backend*) → **D3D11** on Windows, or **Metal** on macOS.
   - `#enable-unsafe-webgpu` (*Unsafe WebGPU Support*) → **Enabled**. Only needed for WebGPU experiments (Linux, or older versions).
   - `#enable-gpu-rasterization` → **Enabled**.
3. Press **Relaunch**.

**Firefox**

1. Settings → General → Performance → untick *Use recommended performance settings* → tick **Use hardware acceleration when available**.
2. Open `about:config` and set:
   - `webgl.force-enabled` → `true`
   - `gfx.webrender.all` → `true`
   - `dom.webgpu.enabled` → `true` (WebGPU, Firefox 141+ on Windows has it on by default)
3. Restart Firefox. `about:support` → *Graphics* should show the GPU and **WebGL 2 Driver Renderer**.

**Laptops with two GPUs (Windows):** Settings → System → Display → Graphics → add the browser and choose **High performance**. On NVIDIA you can do the same in *NVIDIA Control Panel → Manage 3D settings → Program settings*.

**Check:** open the game with `?debug`. FPS should be above 60 on Medium.

</details>

## Model packs (host characters)

Each character is one folder in [`src/assets/`](src/assets) with:

- `info.json`: name, author, license, bone mapping and motion tuning;
- `host.glb`: the model;
- optional voice lines, thumbnail and extra clips.

The game loads every folder automatically. Two ways to add a character:

- **From source:** copy `src/assets/_template/`, drop in your `host.glb` and edit `info.json`.
- **Without code:** zip the folder and upload it in **Settings → Character → Upload .zip**. Uploaded packs are stored in the browser (IndexedDB). You can download a template zip from the same place.

The full guide, the JSON Schema (`model.schema.json`) and a ready-to-use AI prompt for writing `info.json` are in [`src/assets/README.md`](src/assets/README.md). The animation system is described in [`src/scene/Host/HostRig.md`](src/scene/Host/HostRig.md).

## Configuration

**Settings** are opened with the radio on stage, the **Settings** button on the home screen, or ⚙ in the bottom-right corner:

- volume and mute;
- background image and music uploads (kept in IndexedDB);
- host character and model packs;
- graphics preset and detailed overrides;
- ×2 speed.

**Sounds:** every sound is synthesized. To replace one, drop a file named after it into `public/audio/` (for example `cymbal.mp3`). The list of names and per-character voice lines is in [`public/audio/README.md`](public/audio/README.md).

**Stage:** edit [`public/stage-config.json`](public/stage-config.json) and reload; no rebuild is needed.

- `backstage`: backdrop image, size, position, brightness, tint and fit.
- `propLights`: fake spotlights on props.

**Colours and cues:**

| What | Where |
|---|---|
| Palette | `COLORS` / `BALL_COLORS` in `src/scene/layout.ts` |
| UI tokens | `@theme` in `src/index.css` |
| Light positions | `FIXTURES` in `src/scene/Lights.tsx` |
| Light cues | `src/director/LightDirector.ts` |
| Camera shots | `src/director/cameraShots.ts` |

## Performance

- **Auto quality:** starts at Medium, moves down below 50 FPS and up above 58 FPS. It only switches between draws.
- **Balls:** all 200 are drawn as one InstancedMesh.
- **Lights:** no point or area lights. Glows are sprites and particles.
- **Shadows:** re-rendered only while something moves.
- **Pausing:** the game pauses when the tab is hidden.
- **Editor open:** the stage behind the list editor renders at half resolution.
- **Loading animation:**
  - capped at 18 name cards and 48 flying balls;
  - only `transform` and `opacity` are animated.

## Project structure

```
src/
  app/        App shell (shortcuts, pause), Scene (Canvas)
  assets/     model packs: one folder per host character (info.json + host.glb …)
  audio/      Web Audio engine (synth + file overrides)
  director/   Director (phase timeline), camera, lights, spin physics, shared channels
  lib/        list parsing, crypto RNG, IndexedDB media, model-pack zips, ID masking
  quality/    presets and auto-tuning
  scene/      stage, curtain, cage, balls, host (animator + IK), props, VFX
  store/      game state machine, settings
  ui/         home, onboarding, list editor, packing overlay, history, settings, version tag
scripts/      compress-model.mjs
```

## Versioning and deployment

[`.github/workflows/deploy-gh-pages.yml`](.github/workflows/deploy-gh-pages.yml) runs on every push to `main`, including merged pull requests:

1. It bumps the version in `package.json` and `package-lock.json`:
   - patch by default;
   - put `#minor` or `#major` in a commit message for a bigger step.
2. It commits `chore(release): vX.Y.Z [skip ci]` and tags it `vX.Y.Z`.
3. It builds that commit and deploys `dist/` to the `gh-pages` branch.

The version and author from `package.json` are shown in the bottom-left corner of the game.

**One-time GitHub setup:**

- **Settings → Pages:** *Deploy from a branch*, using `gh-pages` and `/ (root)`.
- **Settings → Actions → General:** *Workflow permissions* set to *Read and write*.
- **Branch protection on `main`:** if it blocks pushes, allow `github-actions[bot]` to push.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

- run `npm run typecheck` and `npm run build`;
- keep docs in English.

Add a new character as a model pack, not as code.

## Authors

- **Mobile Programming Club** (<https://www.mpclub.dev>)
- Built with Claude Opus 5.5 (Anthropic).

## License

Released under the [MIT License](LICENSE).

The bundled 3D models keep their original authors' licenses; see each pack's `info.json` and `README.md` in `src/assets/`.
