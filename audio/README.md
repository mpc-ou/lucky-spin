# Adding real sounds

Every sound in the game is **synthesized in code** (Web Audio), so the game has sound even with no files. To replace a sound with a real recording:

1. Copy the file into this folder (`public/audio/`) and **name it exactly after the sound** in the tables below, for example `hitBall.mp3`, `music.mp3` or `applause.ogg`. Formats: `.mp3`, `.ogg`, `.wav`, `.m4a`, `.aac`, `.webm`, `.flac`.
2. Reload the page.
   - Any file with a matching name is picked up.
   - With `npm run dev`, adding a file reloads the page on its own.
   - A production build (`npm run build`) reads the file list at build time, so rebuild after adding files.

Tips:

- Keep short effects under 1 second and trim the silence at the start, or they will play late.
- Sounds without a file keep using the synthesized version.
- A broken or unreadable file logs a warning with its name in the console (F12).

**Optional:** to use files with other names, list them in `manifest.json`. Entries there take priority over same-named files:

```json
{ "files": { "hitBall": "ball-hit-v2.mp3", "music": "gala-theme.ogg" } }
```

Each play detunes the sound by ±8%, and sounds from the cage are positioned in 3D, so a single file doesn't sound repetitive.

## Sound names

### Effects (one-shot)

| Name | When it plays | Suggestion |
|---|---|---|
| `hitBall` | Balls hitting each other (cage, chute, tray) | Very short plastic/porcelain click, ~50–150 ms |
| `hitBrass` | A ball hitting the cage's brass bars | Small metallic ding, ~100–300 ms |
| `lidOpen` | Cage lid / ballot box opens | Metal hinge |
| `lid` | Cage lid closes, box set down | Heavy brass clack |
| `gate` | Outlet gate snaps open | |
| `roll` | Ball rolling down the chute | ~1 s |
| `whoosh` | Balls flying into the cage, ticket flying to camera | |
| `ballClose` | A ball "closing" while loading | Small snap |
| `shellOpen` | The ball splitting open | |
| `cymbal` | Opening the ball | Crash cymbal, 2–3 s |
| `confetti` | Confetti cannons | |
| `paper` | Ticket unfolding, filing, name cards dropping in | Paper rustle |
| `chime` | Host smiling, announcements | |
| `applause` | Audience applause (ticket held up and shown to camera) | Clapping + cheering, 3–4 s |
| `curtain` | Curtain opening/closing | Velvet drag, ~3 s |
| `crowd` | Audience murmur as the curtain opens | ~3 s |
| `lightOn` | Stage light switching on | |
| `footstep` | Each host step | Shoe on a wooden floor, very short |
| `rustle` | Host bowing / bending down | Cloth rustle |
| `clap` | Host clapping | One clap |
| `tick` | Hovering props and buttons | Very small click |
| `ratchet` | Turning the quality knob | |
| `lock` | Clicking something locked (e.g. the crank while spinning) | |
| `voiceStart` | Host greeting ("Let's start!") | **Only plays with a file.** Can be per character, see below |
| `voiceCongrats` | Ticket reveal ("Congratulations!") | **Only plays with a file.** Can be per character, see below |

### Loops

| Name | Role | Suggestion |
|---|---|---|
| `music` | Background music | Slow cello/piano, seamless loop (end matches start) |
| `room` | Large hall room tone | Very quiet, 5–10 s loop |
| `drumroll` | Drum roll while the cage slows down and the ball is presented | 1–2 s loop; the game fades it in and out |

## Per-character voice lines

Every character can have its own lines. Two ways:

- **Recommended:** put the files in the character's model pack (`src/assets/<pack>/voice/start.mp3`, `voice/congrats.mp3`) and list them under `voices` in its `info.json`.
- **Or here:** add the character id as a suffix, for example `voiceStart_fox.mp3`, `voiceCongrats_anime.mp3`, `voiceStart_mrbeast.mp3`.

Lookup order:

1. the pack's own file;
2. `voiceStart_<id>.mp3` in this folder;
3. the shared `voiceStart.mp3`;
4. the synthesized cue.

Voices play at their original pitch, without the random detune.

## Volume

Change it in the game's Settings (the radio on stage, or ⚙ in the bottom-right corner): Master, Music, Effects, Mute.
