# Pac-Man

A playable Pac-Man style arcade game in **vanilla JavaScript and HTML5 canvas**. No dependencies, no build step, no bundler — three static files and a `<script>` tag.

### ▶ [**Play it here**](https://hammadshakeelai.github.io/pacman/)

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS-yellow.svg)

---

## Controls

| Action | Input |
| --- | --- |
| Move | Arrow keys, `W` `A` `S` `D`, on-screen d-pad, or swipe |
| Start / restart | `Enter` or `Space` |
| Pause | `P` |
| Mute | `M` |

## What's implemented

This is a real implementation of the arcade rules, not a static maze with a sprite on it:

- **Tile-aligned movement with input queuing.** Press a direction early and the turn fires the moment you reach a junction where it's legal — the single thing that makes most clones feel broken. A 180° reversal applies instantly, anywhere.
- **Four ghosts, four personalities**, each with the original's targeting rule:
  - **Blinky** (red) chases your tile directly.
  - **Pinky** (pink) aims four tiles ahead of you, cutting you off.
  - **Inky** (cyan) targets the vector from Blinky to two tiles ahead of you, doubled — so he gets erratic when Blinky is close.
  - **Clyde** (orange) chases while he's far away, then peels off to his corner within eight tiles.
- **Scatter / chase waves.** Ghosts alternate between hunting you and retreating to their home corners on the arcade's timing, reversing direction on every switch.
- **Power pellets** turn ghosts blue and edible, with a flashing warning before the effect ends. Eating them in a chain scores 200 → 400 → 800 → 1600.
- **Eyes return home.** An eaten ghost becomes a pair of eyes that navigates back to the ghost house and respawns.
- **Ghost house release order** driven by pellets eaten, plus an idle timer so nobody gets stuck.
- **Side tunnel** with screen wrap — and ghosts slow down inside it, exactly as they do in the original.
- Bonus fruit, lives, level progression with escalating difficulty, and a high score saved to `localStorage`.

The maze is the classic 28 × 31 board with all **244 pellets**.

## Running it locally

There is no build step. Clone and open `index.html` — or serve the folder if you prefer:

```bash
git clone https://github.com/hammadshakeelai/pacman.git
```

```bash
cd pacman && python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying your own copy

Fork the repo, then in **Settings → Pages** set the source to the `main` branch, `/` root. That's the whole deployment — GitHub Pages serves the files as-is, so there is nothing to build and no Actions workflow to configure.

## How it works

| File | Role |
| --- | --- |
| `index.html` | Markup, HUD and overlay |
| `style.css` | Layout, responsive rules, touch d-pad |
| `game.js` | Everything else — maze, movement, ghost AI, rendering, audio |

A few implementation notes:

**Movement resolution.** Entities hold pixel-precise positions but only ever make decisions sitting exactly on a tile centre. The `advance()` function walks an entity forward in slices that stop on each centre, so a turn is never missed at high speed, and the position is snapped back to an exact centre every tile — floating-point drift can't accumulate into a wall.

**Fixed timestep.** Physics runs at a fixed 120 Hz accumulator independent of the render rate, so the game behaves identically on a 60 Hz and a 144 Hz display, and a backgrounded tab can't fast-forward it.

**No assets.** Every sprite — Pac-Man, the ghosts, the maze walls, the fruit — is drawn with canvas primitives, and the sound effects are synthesised with the Web Audio API. The repo ships no images or audio files, which keeps it entirely self-contained and free of third-party asset licensing.

## Testing

```bash
node test/logic.test.js
```

Game logic is verified headlessly by stubbing the canvas and DOM and driving the real `game.js` through a Node `vm` context — no browser required. The suite checks that Pac-Man never enters a wall across thousands of frames, that ghosts leave the house and stay on walkable tiles, that scatter and chase alternate, that power pellets frighten ghosts, that eaten ghosts find their way home, that collisions cost a life, and that eating all 244 pellets advances the level and refills the board.

## Notes

Written from scratch as an original implementation of the arcade's published mechanics. PAC-MAN is a trademark of Bandai Namco Entertainment Inc.; this project is an unaffiliated, non-commercial tribute and ships none of the original's code or assets.

## License

[MIT](LICENSE) © hammadshakeelai
