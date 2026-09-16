// Headless harness: stubs canvas/DOM, then drives the real game.js logic.
const fs = require('fs');
const vm = require('vm');
const NL = '\n';

function stubCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return {};
      if (!(k in t)) t[k] = noop;
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const listeners = {};
function noop2() {}
function el(id) {
  return {
    id, textContent: '', hidden: false, dataset: {}, style: {},
    addEventListener: (ev, fn) => { (listeners[id + ':' + ev] ||= []).push(fn); },
    setAttribute: noop2, removeChild: noop2, appendChild: noop2,
    querySelector: () => el(id + '-title'),
    querySelectorAll: () => [],
    getContext: () => stubCtx(),
    get firstChild() { return null; },
    width: 448, height: 496
  };
}

let rafQueue = [];
const store = {};
const sandbox = {
  console, Math, Date, JSON, Array, Object, String, Number, parseInt, parseFloat, isNaN,
  setTimeout: () => 0,
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  },
  document: {
    getElementById: el,
    addEventListener: noop2,
    hidden: false,
    createElement: () => el('created'),
    createTextNode: () => ({})
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.AudioContext = null;
sandbox.webkitAudioContext = null;
sandbox.window.addEventListener = (ev, fn) => { (listeners['win:' + ev] ||= []).push(fn); };

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('game.js', 'utf8'), sandbox, { filename: 'game.js' });

const P = sandbox.PACMAN;
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK   ' : '  FAIL ') + msg); if (!cond) fail++; };
const head = (s) => console.log(NL + '--- ' + s + ' ---');

let clock = 0;
function tick(frames) {
  for (let i = 0; i < frames; i++) {
    clock += 1000 / 60;
    const q = rafQueue; rafQueue = [];
    q.forEach(fn => fn(clock));
  }
}

head('boot');
tick(2);
ok(P.game.state === 'ready', 'boots into ready state behind the title overlay');
ok(P.pellets() === 244, `board has 244 pellets (got ${P.pellets()})`);

head('start a game');
P.newGame();
tick(150);
ok(P.game.state === 'playing', `enters playing after READY (state=${P.game.state})`);

head('pac-man moves and eats');
const startX = P.game.pac.x, startY = P.game.pac.y;
tick(60);
ok(Math.abs(P.game.pac.x - startX) > 4 || Math.abs(P.game.pac.y - startY) > 4,
   `pac-man moves without input (dx=${(P.game.pac.x - startX).toFixed(1)})`);
ok(P.game.score > 0, `eating pellets scores points (score=${P.game.score})`);

head('steering');
P.steer('up'); tick(120);
ok(P.game.pac.y < startY - 4, `steering up moves pac-man up (y ${startY.toFixed(0)} -> ${P.game.pac.y.toFixed(0)})`);
P.steer('down'); tick(90);
P.steer('left'); tick(90);
P.steer('right'); tick(90);
ok(true, 'all four directions accepted without error');

head('pac-man never tunnels into a wall');
let insideWall = 0;
for (let i = 0; i < 3000; i++) {
  tick(1);
  P.game.lives = 9;
  if (P.game.state === 'over') P.newGame();
  const g = P.grid();
  const c = P.game.pac.col, r = P.game.pac.row;
  if (r >= 0 && r < 31 && c >= 0 && c < 28) {
    const t = g[r][c];
    if (t === '#' || t === 'X') insideWall++;
  }
  if (i % 37 === 0) P.steer(['up', 'down', 'left', 'right'][i % 4]);
}
ok(insideWall === 0, `pac-man stayed out of walls across 3000 frames (violations=${insideWall})`);

head('ghosts');
const outside = P.game.ghosts.filter(g => g.state === 'roam' || g.state === 'eaten').length;
ok(outside >= 2, `ghosts leave the house (${outside}/4 out roaming)`);
let ghostInWall = 0;
P.game.ghosts.forEach(g => {
  const t = P.grid()[g.row] && P.grid()[g.row][g.col];
  if (t === '#' || t === 'X') ghostInWall++;
});
ok(ghostInWall === 0, `ghosts sit on walkable tiles (violations=${ghostInWall})`);

head('scatter/chase alternates');
P.newGame(); tick(150);
const modeSeen = new Set();
for (let i = 0; i < 2400; i++) {          // 40s covers scatter(7s) -> chase(20s)
  tick(1);
  P.game.lives = 9;
  if (P.game.state === 'over') P.newGame();
  if (P.game.state === 'playing') modeSeen.add(P.game.mode);
}
ok(modeSeen.has('scatter') && modeSeen.has('chase'),
   `both scatter and chase occur (${[...modeSeen].join(',')})`);

head('power pellet frightens the ghosts');
P.newGame(); tick(150);
P.game.pac.x = 1 * 16 + 8; P.game.pac.y = 4 * 16 + 8;
P.game.pac.col = 1; P.game.pac.row = 4;
P.steer('up'); tick(30);
ok(P.game.frightTimer > 0 || P.game.ghosts.some(g => g.frightened),
   `eating a power pellet frightens ghosts (timer=${P.game.frightTimer.toFixed(2)})`);

head('eaten ghost returns home and revives');
const victim = P.game.ghosts.find(g => g.state === 'roam') || P.game.ghosts[0];
victim.state = 'eaten';
let revived = false;
for (let i = 0; i < 1200; i++) {
  tick(1);
  P.game.lives = 9;
  if (victim.state === 'roam' || victim.state === 'leaving' || victim.state === 'revive') { revived = true; break; }
}
ok(revived, `an eaten ghost finds its way home (state=${victim.state})`);

head('death costs a life');
P.newGame(); tick(150);
const livesBefore = P.game.lives;
const killer = P.game.ghosts.find(g => g.state === 'roam') || P.game.ghosts[0];
killer.state = 'roam'; killer.frightened = false;
killer.x = P.game.pac.x; killer.y = P.game.pac.y;
tick(180);
ok(P.game.lives === livesBefore - 1, `colliding with a ghost costs a life (${livesBefore} -> ${P.game.lives})`);

head('level clears when the board is empty');
P.newGame();
ok(P.pellets() === 244, `fresh level starts with 244 uneaten pellets (got ${P.pellets()})`);
tick(150);
const targets = [];
const gr = P.grid();
for (let r = 0; r < 31; r++) for (let c = 0; c < 28; c++) {
  if (gr[r][c] === '.' || gr[r][c] === 'o') targets.push([c, r]);
}
for (const [c, r] of targets) {
  if (P.game.state === 'levelclear' || P.game.level > 1) break;
  P.game.ghosts.forEach(g => { g.state = 'house'; });   // isolate: no deaths mid-sweep
  P.game.pac.x = c * 16 + 8; P.game.pac.y = r * 16 + 8;
  P.game.pac.col = c; P.game.pac.row = r;
  tick(1);
}
ok(P.pellets() === 0, `every pellet gets eaten through the real eat path (remaining=${P.pellets()})`);
ok(P.game.state === 'levelclear' || P.game.level > 1,
   `clearing the last pellet ends the level (state=${P.game.state})`);
tick(250);
ok(P.game.level === 2, `next level starts (level=${P.game.level})`);
ok(P.pellets() === 244, `board refills for the new level (pellets=${P.pellets()})`);

head('long burn-in: 90s of random play');
P.newGame(); tick(60);
let err = null;
try {
  for (let i = 0; i < 5400; i++) {
    tick(1);
    P.game.lives = 9;
    if (P.game.state === 'over') P.newGame();
    // Randomised, not a fixed cycle: a repeating input pattern drives pac-man
    // into a deterministic orbit and he stops meeting new pellets.
    if (i % 13 === 0) P.steer(['up', 'left', 'down', 'right'][(Math.random() * 4) | 0]);
  }
} catch (e) { err = e; }
ok(!err, 'no exception across 90s of play' + (err ? ' -> ' + err.message : ''));
ok(P.game.score >= 500, `score climbs through sustained play (score=${P.game.score}, level=${P.game.level})`);
ok(P.pellets() < 200, `board is being cleared (pellets left=${P.pellets()})`);
let finalWall = 0;
P.game.ghosts.forEach(g => {
  const t = P.grid()[g.row] && P.grid()[g.row][g.col];
  if (t === '#' || t === 'X') finalWall++;
});
ok(finalWall === 0, `no ghost ended up inside a wall (violations=${finalWall})`);

console.log(NL + (fail === 0 ? '=== ALL LOGIC TESTS PASSED ===' : '=== ' + fail + ' TEST(S) FAILED ==='));
process.exit(fail === 0 ? 0 : 1);
