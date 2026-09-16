/*!
 * Pac-Man — vanilla HTML5 canvas arcade game.
 * Copyright (c) 2026 hammadshakeelai. MIT License.
 * No dependencies, no build step. Everything is drawn with canvas primitives.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- maze
  // '#' wall   '.' pellet   'o' power pellet   '-' ghost-house door
  // ' ' empty walkable   'X' void (outside the maze; never walkable, never drawn)
  var MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    'XXXXX#.##### ## #####.#XXXXX',
    'XXXXX#.##          ##.#XXXXX',
    'XXXXX#.##X###--###X##.#XXXXX',
    '######.##X#      #X##.######',
    '      .   #      #   .      ',
    '######.##X#      #X##.######',
    'XXXXX#.##X########X##.#XXXXX',
    'XXXXX#.##XXXXXXXXXX##.#XXXXX',
    'XXXXX#.##XXXXXXXXXX##.#XXXXX',
    '######.##XXXXXXXXXX##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################'
  ];

  var COLS = 28, ROWS = 31, TILE = 16;
  var W = COLS * TILE, H = ROWS * TILE;

  // Tunnel row + ghost-house geometry, derived once from the layout above.
  var TUNNEL_ROW = 14;
  var DOOR_ROW = 12, DOOR_COL_A = 13, DOOR_COL_B = 14;
  var HOUSE_CX = 13.5, HOUSE_CY = 14;      // tile coords of the house centre
  var PAC_START = { col: 13.5, row: 23 };
  // Bonus fruit sits in the corridor above the ghost house. It MUST be a tile
  // Pac-Man can actually stand on, so the pickup test can succeed -- the classic
  // arcade spot below the house is void in this layout. test/logic.test.js
  // flood-fills the board and fails if this tile is ever unreachable.
  var FRUIT_TILE = { col: 13.5, row: 11.5 };

  // ---------------------------------------------------------------- tuning
  var PAC_SPEED = 8.4;        // tiles per second
  var GHOST_SPEED = 7.6;
  var FRIGHT_SPEED = 4.6;
  var EYES_SPEED = 17;
  var FRIGHT_BASE = 7;        // seconds of frightened time at level 1
  var STEP = 1 / 120;         // fixed physics timestep

  // Classic scatter/chase alternation (seconds). Ghosts reverse on each switch.
  var WAVES = [7, 20, 7, 20, 5, 20, 5, Infinity];

  var PELLET_PTS = 10, POWER_PTS = 50, FRUIT_PTS = 100;
  var GHOST_PTS = [200, 400, 800, 1600];

  var UP = { x: 0, y: -1, name: 'up' };
  var DOWN = { x: 0, y: 1, name: 'down' };
  var LEFT = { x: -1, y: 0, name: 'left' };
  var RIGHT = { x: 1, y: 0, name: 'right' };
  var NONE = { x: 0, y: 0, name: 'none' };
  // Ghost tie-break order is the arcade's: up, left, down, right.
  var TURN_ORDER = [UP, LEFT, DOWN, RIGHT];
  var DIR_BY_NAME = { up: UP, down: DOWN, left: LEFT, right: RIGHT };

  function opposite(d) {
    if (d === UP) return DOWN;
    if (d === DOWN) return UP;
    if (d === LEFT) return RIGHT;
    if (d === RIGHT) return LEFT;
    return NONE;
  }

  // ---------------------------------------------------------------- grid
  var grid = [];        // mutable copy of MAZE, pellets get cleared from it
  var pelletTotal = 0;
  var pelletsLeft = 0;

  function resetGrid() {
    grid = MAZE.map(function (row) { return row.split(''); });
    pelletTotal = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var ch = grid[r][c];
        if (ch === '.' || ch === 'o') pelletTotal++;
      }
    }
    pelletsLeft = pelletTotal;
  }

  function tileAt(col, row) {
    if (row < 0 || row >= ROWS) return '#';
    // The tunnel row wraps horizontally; every other row is walled at the edges.
    if (col < 0 || col >= COLS) return row === TUNNEL_ROW ? ' ' : '#';
    return grid[row][col];
  }

  // Solid for drawing purposes: walls and the void behind them.
  function isSolid(col, row) {
    var t = tileAt(col, row);
    return t === '#' || t === 'X';
  }

  // Passable for an entity. Ghosts may cross the house door; Pac-Man may not.
  function passable(col, row, allowDoor) {
    var t = tileAt(col, row);
    if (t === '#' || t === 'X') return false;
    if (t === '-') return !!allowDoor;
    return true;
  }

  function wrapX(x) {
    if (x < 0) return x + W;
    if (x >= W) return x - W;
    return x;
  }

  // ---------------------------------------------------------------- movement
  // Entities keep pixel-precise positions but only ever make decisions when
  // sitting exactly on a tile centre. `advance` walks the entity forward in
  // slices that stop on each centre, so a turn is never missed at high speed
  // and floating-point drift is snapped away every tile.

  function makeEntity(col, row) {
    return {
      x: (col + 0.5) * TILE,
      y: (row + 0.5) * TILE,
      dir: NONE,
      next: NONE,
      col: Math.floor(col),
      row: Math.floor(row)
    };
  }

  function cellCentre(x) { return (Math.floor(x / TILE) + 0.5) * TILE; }

  // Distance along `dir` until the next tile centre. 0 means we are on one.
  function distToCentre(e) {
    if (e.dir === RIGHT) { var cx = cellCentre(e.x); return e.x <= cx ? cx - e.x : cx + TILE - e.x; }
    if (e.dir === LEFT)  { var cl = cellCentre(e.x); return e.x >= cl ? e.x - cl : e.x - (cl - TILE); }
    if (e.dir === DOWN)  { var cy = cellCentre(e.y); return e.y <= cy ? cy - e.y : cy + TILE - e.y; }
    if (e.dir === UP)    { var cu = cellCentre(e.y); return e.y >= cu ? e.y - cu : e.y - (cu - TILE); }
    return 0;
  }

  function snapToCentre(e) {
    e.col = Math.floor(wrapX(e.x) / TILE);
    e.row = Math.floor(e.y / TILE);
    e.x = (e.col + 0.5) * TILE;
    e.y = (e.row + 0.5) * TILE;
  }

  function shift(e, dist) {
    e.x = wrapX(e.x + e.dir.x * dist);
    e.y += e.dir.y * dist;
  }

  // `onCentre` decides the next heading; returning nothing leaves dir as-is.
  function advance(e, dist, onCentre) {
    var guard = 0;
    while (dist > 1e-9 && guard++ < 512) {
      var d = e.dir === NONE ? 0 : distToCentre(e);
      if (d <= 1e-9) {
        snapToCentre(e);
        onCentre(e);
        if (e.dir === NONE) return;
        var s1 = Math.min(dist, TILE);
        shift(e, s1);
        dist -= s1;
      } else {
        var s2 = Math.min(dist, d);
        shift(e, s2);
        dist -= s2;
        if (s2 === d) snapToCentre(e);
      }
    }
  }

  // ---------------------------------------------------------------- ghosts
  // Each ghost is the arcade personality: a different target tile, same rules.
  var GHOST_DEFS = [
    { key: 'blinky', colour: '#ff3c3c', scatter: { col: 25, row: 0 },  start: { col: 13.5, row: 11 }, dot: 0,  home: false },
    { key: 'pinky',  colour: '#ffb0dd', scatter: { col: 2,  row: 0 },  start: { col: 13.5, row: 14 }, dot: 0,  home: true },
    { key: 'inky',   colour: '#3ce0ff', scatter: { col: 27, row: 30 }, start: { col: 11.5, row: 14 }, dot: 30, home: true },
    { key: 'clyde',  colour: '#ffab4a', scatter: { col: 0,  row: 30 }, start: { col: 15.5, row: 14 }, dot: 60, home: true }
  ];

  function makeGhost(def) {
    var g = makeEntity(def.start.col, def.start.row);
    g.key = def.key;
    g.colour = def.colour;
    g.scatter = def.scatter;
    g.startAt = def.start;
    g.dotLimit = def.dot;
    g.state = def.home ? 'house' : 'roam';   // house | leaving | roam | eaten
    g.dir = def.home ? UP : LEFT;
    g.frightened = false;
    g.bob = Math.random() * Math.PI * 2;
    return g;
  }

  function ghostTarget(g, game) {
    if (g.state === 'eaten') return { col: HOUSE_CX, row: HOUSE_CY };
    if (g.frightened) return null;                       // frightened = random
    if (game.mode === 'scatter') return g.scatter;

    var pac = game.pac;
    var pc = pac.col, pr = pac.row, pd = pac.dir;

    if (g.key === 'blinky') return { col: pc, row: pr };

    if (g.key === 'pinky') {
      // Four tiles ahead of Pac-Man.
      return { col: pc + pd.x * 4, row: pr + pd.y * 4 };
    }

    if (g.key === 'inky') {
      // Vector from Blinky to two-ahead-of-Pac, doubled.
      var b = game.ghosts[0];
      var ax = pc + pd.x * 2, ay = pr + pd.y * 2;
      return { col: ax + (ax - b.col), row: ay + (ay - b.row) };
    }

    // Clyde: chases while far, retreats to his corner within eight tiles.
    var dx = g.col - pc, dy = g.row - pr;
    if (dx * dx + dy * dy > 64) return { col: pc, row: pr };
    return g.scatter;
  }

  function ghostSpeed(g) {
    if (g.state === 'eaten') return EYES_SPEED;
    if (g.state === 'house' || g.state === 'leaving') return GHOST_SPEED * 0.6;
    if (g.frightened) return FRIGHT_SPEED;
    // Ghosts crawl through the side tunnel, as in the original.
    if (g.row === TUNNEL_ROW && (g.col <= 5 || g.col >= 22)) return GHOST_SPEED * 0.55;
    return GHOST_SPEED;
  }

  // Decide a heading at a tile centre: never reverse, pick the legal move that
  // lands nearest the target, tie-broken up > left > down > right.
  function ghostDecide(g, game) {
    var allowDoor = g.state === 'eaten' || g.state === 'leaving' || g.state === 'house';
    var target = ghostTarget(g, game);
    var back = opposite(g.dir);
    var options = [], i, d;

    for (i = 0; i < TURN_ORDER.length; i++) {
      d = TURN_ORDER[i];
      if (d === back) continue;
      if (passable(g.col + d.x, g.row + d.y, allowDoor)) options.push(d);
    }
    if (!options.length) { g.dir = back; return; }

    if (!target) {                                   // frightened: pick at random
      g.dir = options[(Math.random() * options.length) | 0];
      return;
    }

    var best = options[0], bestD = Infinity;
    for (i = 0; i < options.length; i++) {
      d = options[i];
      var nx = g.col + d.x - target.col, ny = g.row + d.y - target.row;
      var dist = nx * nx + ny * ny;
      if (dist < bestD) { bestD = dist; best = d; }
    }
    g.dir = best;
  }

  // ---------------------------------------------------------------- state
  var game = {
    state: 'ready',      // ready | playing | dying | levelclear | over | paused
    pac: null,
    ghosts: [],
    score: 0,
    high: 0,
    lives: 3,
    level: 1,
    mode: 'scatter',
    wave: 0,
    waveTimer: 0,
    frightTimer: 0,
    ghostChain: 0,
    dotsThisLife: 0,
    releaseTimer: 0,
    timer: 0,            // generic phase timer (ready / dying / levelclear)
    fruit: null,
    fruitTimer: 0,
    fruitsShown: 0,
    pops: []             // floating score popups
  };

  function resetActors() {
    game.pac = makeEntity(PAC_START.col, PAC_START.row);
    game.pac.dir = LEFT;
    game.pac.next = LEFT;
    game.pac.mouth = 0;
    game.pac.dead = 0;

    game.ghosts = GHOST_DEFS.map(makeGhost);
    game.mode = 'scatter';
    game.wave = 0;
    game.waveTimer = WAVES[0];
    game.frightTimer = 0;
    game.ghostChain = 0;
    game.dotsThisLife = 0;
    game.releaseTimer = 0;
    game.fruit = null;
    game.fruitTimer = 0;
  }

  function startLevel(nextLevel) {
    if (nextLevel) { game.level++; game.fruitsShown = 0; resetGrid(); }
    resetActors();
    game.state = 'ready';
    game.timer = 2;
    syncHud();
  }

  function newGame() {
    game.score = 0;
    game.lives = 3;
    game.level = 1;
    game.fruitsShown = 0;
    game.pops = [];
    resetGrid();
    resetActors();
    game.state = 'ready';
    game.timer = 2;
    syncHud();
    hideOverlay();
  }

  function addScore(n) {
    game.score += n;
    if (game.score > game.high) {
      game.high = game.score;
      try { localStorage.setItem('pacman.high', String(game.high)); } catch (e) { /* private mode */ }
    }
    syncHud();
  }

  function popup(x, y, text, colour) {
    game.pops.push({ x: x, y: y, text: text, colour: colour || '#fff', life: 1 });
  }

  // ---------------------------------------------------------------- pac-man
  function updatePac(dt) {
    var pac = game.pac;

    // A 180° turn is legal anywhere, so reversing feels instant.
    if (pac.next !== NONE && pac.next === opposite(pac.dir) &&
        passable(pac.col + pac.next.x, pac.row + pac.next.y, false)) {
      pac.dir = pac.next;
    }

    advance(pac, PAC_SPEED * TILE * dt, function (e) {
      if (e.next !== NONE && passable(e.col + e.next.x, e.row + e.next.y, false)) {
        e.dir = e.next;
      }
      if (!passable(e.col + e.dir.x, e.row + e.dir.y, false)) e.dir = NONE;
    });

    if (pac.dir !== NONE) pac.mouth += dt * 11;
    eatAt(pac.col, pac.row);
  }

  function eatAt(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    var t = grid[row][col];
    if (t !== '.' && t !== 'o') return;

    grid[row][col] = ' ';
    pelletsLeft--;
    game.dotsThisLife++;

    if (t === '.') {
      addScore(PELLET_PTS);
      sfx.waka();
    } else {
      addScore(POWER_PTS);
      sfx.power();
      game.ghostChain = 0;
      game.frightTimer = Math.max(FRIGHT_BASE - (game.level - 1) * 0.6, 1.5);
      game.ghosts.forEach(function (g) {
        if (g.state === 'roam') { g.frightened = true; g.dir = opposite(g.dir); }
      });
    }

    // Bonus fruit appears twice a level, as pellets run down.
    var eaten = pelletTotal - pelletsLeft;
    if ((eaten === 70 && game.fruitsShown === 0) || (eaten === 170 && game.fruitsShown === 1)) {
      game.fruitsShown++;
      game.fruit = { col: FRUIT_TILE.col, row: FRUIT_TILE.row };
      game.fruitTimer = 9.5;
    }

    if (pelletsLeft === 0) {
      game.state = 'levelclear';
      game.timer = 2.2;
      sfx.levelUp();
    }
  }

  // ---------------------------------------------------------------- ghosts
  function updateGhost(g, dt) {
    if (g.state === 'house') {
      // Bob in place until this ghost's dot quota (or the idle timer) frees it.
      g.bob += dt * 3.4;
      g.y = (g.startAt.row + 0.5) * TILE + Math.sin(g.bob) * TILE * 0.36;
      var freed = game.dotsThisLife >= g.dotLimit || game.releaseTimer > 4;
      if (freed) { g.state = 'leaving'; game.releaseTimer = 0; }
      return;
    }

    if (g.state === 'leaving') {
      // Slide to the door column, then rise out of the house.
      var tx = HOUSE_CX * TILE, ty = (DOOR_ROW - 0.5) * TILE;
      var sp = GHOST_SPEED * 0.72 * TILE * dt;
      if (Math.abs(g.x - tx) > 0.5) {
        g.x += Math.sign(tx - g.x) * Math.min(sp, Math.abs(tx - g.x));
        g.dir = UP;
      } else {
        g.x = tx;
        g.y -= Math.min(sp, g.y - ty);
        g.dir = UP;
        if (g.y <= ty + 0.5) {
          g.y = ty;
          g.x = tx;
          g.state = 'roam';
          g.dir = LEFT;          // set last: the ghost is out and heading off
          g.frightened = game.frightTimer > 0;
          snapToCentre(g);
        }
      }
      return;
    }

    if (g.state === 'revive') {
      var rx = HOUSE_CX * TILE, ry = (HOUSE_CY + 0.5) * TILE;
      var rs = EYES_SPEED * 0.55 * TILE * dt;
      g.x += Math.sign(rx - g.x) * Math.min(rs, Math.abs(rx - g.x));
      g.y += Math.sign(ry - g.y) * Math.min(rs, Math.abs(ry - g.y));
      if (Math.abs(g.x - rx) < 0.5 && Math.abs(g.y - ry) < 0.5) {
        g.x = rx; g.y = ry;
        g.state = 'leaving';
        g.frightened = false;
      }
      return;
    }

    advance(g, ghostSpeed(g) * TILE * dt, function (e) { ghostDecide(e, game); });

    // Eyes that have found their way back to the door drop inside and respawn.
    if (g.state === 'eaten' && g.row >= DOOR_ROW && g.col >= 11 && g.col <= 16) {
      g.state = 'revive';
    }
  }

  function updateModes(dt) {
    if (game.frightTimer > 0) {
      game.frightTimer -= dt;
      if (game.frightTimer <= 0) {
        game.frightTimer = 0;
        game.ghosts.forEach(function (g) { g.frightened = false; });
      }
      return;   // the scatter/chase clock pauses while ghosts are frightened
    }

    game.waveTimer -= dt;
    if (game.waveTimer <= 0 && game.wave < WAVES.length - 1) {
      game.wave++;
      game.mode = game.mode === 'scatter' ? 'chase' : 'scatter';
      game.waveTimer = WAVES[game.wave];
      game.ghosts.forEach(function (g) {
        if (g.state === 'roam') g.dir = opposite(g.dir);
      });
    }
  }

  function checkCollisions() {
    var pac = game.pac;
    for (var i = 0; i < game.ghosts.length; i++) {
      var g = game.ghosts[i];
      if (g.state === 'eaten' || g.state === 'revive') continue;

      var dx = Math.abs(g.x - pac.x);
      dx = Math.min(dx, W - dx);              // account for the tunnel wrap
      var dy = Math.abs(g.y - pac.y);
      if (dx * dx + dy * dy > (TILE * 0.72) * (TILE * 0.72)) continue;

      if (g.frightened) {
        var pts = GHOST_PTS[Math.min(game.ghostChain, GHOST_PTS.length - 1)];
        game.ghostChain++;
        addScore(pts);
        popup(g.x, g.y, String(pts), '#3ce0ff');
        g.frightened = false;
        g.state = 'eaten';
        sfx.eatGhost();
      } else if (g.state === 'roam') {
        game.state = 'dying';
        game.timer = 1.85;
        pac.dead = 0;
        sfx.death();
        return;
      }
    }

    // Bonus fruit pickup.
    if (game.fruit) {
      var fx = Math.abs(game.fruit.col * TILE - pac.x);
      var fy = Math.abs(game.fruit.row * TILE - pac.y);
      if (fx < TILE * 0.8 && fy < TILE * 0.8) {
        var fp = FRUIT_PTS * game.level;
        addScore(fp);
        popup(pac.x, pac.y, String(fp), '#ffd54a');
        game.fruit = null;
        sfx.fruit();
      }
    }
  }

  // ---------------------------------------------------------------- loop
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  function update(dt) {
    var i;

    for (i = game.pops.length - 1; i >= 0; i--) {
      game.pops[i].life -= dt * 1.1;
      game.pops[i].y -= dt * 14;
      if (game.pops[i].life <= 0) game.pops.splice(i, 1);
    }

    if (game.state === 'ready') {
      game.timer -= dt;
      if (game.timer <= 0) game.state = 'playing';
      return;
    }

    if (game.state === 'dying') {
      game.timer -= dt;
      game.pac.dead = Math.min(1, 1 - game.timer / 1.85);
      if (game.timer <= 0) {
        game.lives--;
        syncHud();
        if (game.lives <= 0) {
          game.state = 'over';
          showOverlay('Game Over', 'Final score ' + game.score + '.', 'Play Again');
        } else {
          resetActors();
          game.state = 'ready';
          game.timer = 1.6;
        }
      }
      return;
    }

    if (game.state === 'levelclear') {
      game.timer -= dt;
      if (game.timer <= 0) startLevel(true);
      return;
    }

    if (game.state !== 'playing') return;

    game.releaseTimer += dt;
    updateModes(dt);
    updatePac(dt);
    for (i = 0; i < game.ghosts.length; i++) updateGhost(game.ghosts[i], dt);
    checkCollisions();

    if (game.fruit) {
      game.fruitTimer -= dt;
      if (game.fruitTimer <= 0) game.fruit = null;
    }
  }

  var acc = 0, last = 0;
  function frame(now) {
    if (!last) last = now;
    var delta = Math.min((now - last) / 1000, 0.25);   // clamp after a tab switch
    last = now;
    acc += delta;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- render
  function drawMaze(t) {
    var c, r;

    // Walls are drawn as outlines along every solid/open boundary, which gives
    // the corridors the twin-line look of the arcade board.
    ctx.strokeStyle = '#2a2ad8';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(60,60,255,.75)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (!isSolid(c, r)) continue;
        var x = c * TILE, y = r * TILE;
        if (!isSolid(c, r - 1)) { ctx.moveTo(x, y); ctx.lineTo(x + TILE, y); }
        if (!isSolid(c, r + 1)) { ctx.moveTo(x, y + TILE); ctx.lineTo(x + TILE, y + TILE); }
        if (!isSolid(c - 1, r)) { ctx.moveTo(x, y); ctx.lineTo(x, y + TILE); }
        if (!isSolid(c + 1, r)) { ctx.moveTo(x + TILE, y); ctx.lineTo(x + TILE, y + TILE); }
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Ghost-house door.
    ctx.strokeStyle = '#ff9ec4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(DOOR_COL_A * TILE + 1, DOOR_ROW * TILE + TILE / 2);
    ctx.lineTo((DOOR_COL_B + 1) * TILE - 1, DOOR_ROW * TILE + TILE / 2);
    ctx.stroke();

    // Pellets.
    var pulse = 0.5 + 0.5 * Math.sin(t * 6);
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var tile = grid[r][c];
        if (tile !== '.' && tile !== 'o') continue;
        var px = c * TILE + TILE / 2, py = r * TILE + TILE / 2;
        if (tile === '.') {
          ctx.fillStyle = '#ffe8b0';
          ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
        } else {
          ctx.fillStyle = '#ffd54a';
          ctx.shadowColor = 'rgba(255,213,74,.9)';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(px, py, 3.6 + pulse * 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  function drawPac() {
    var pac = game.pac;
    var r = TILE * 0.62;
    ctx.save();
    ctx.translate(pac.x, pac.y);

    if (game.state === 'dying') {
      // Death: the wedge opens until Pac-Man vanishes.
      var open = pac.dead * Math.PI;
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * (1 - pac.dead * 0.25), open, Math.PI * 2 - open);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    var ang = pac.dir === LEFT ? Math.PI
            : pac.dir === UP ? -Math.PI / 2
            : pac.dir === DOWN ? Math.PI / 2 : 0;
    ctx.rotate(ang);

    var mouth = (game.state === 'playing' && pac.dir !== NONE)
      ? Math.abs(Math.sin(pac.mouth)) * 0.32 : 0.1;

    ctx.fillStyle = '#ffd54a';
    ctx.shadowColor = 'rgba(255,213,74,.55)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, mouth * Math.PI, Math.PI * 2 - mouth * Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGhost(g, t) {
    var r = TILE * 0.6;
    var x = g.x, y = g.y;
    var flashing = g.frightened && game.frightTimer < 2 && Math.floor(t * 8) % 2 === 0;
    var eyesOnly = (g.state === 'eaten');
    var i, k;

    if (!eyesOnly) {
      ctx.fillStyle = g.frightened ? (flashing ? '#ffffff' : '#2438d8') : g.colour;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.12, r, Math.PI, 0);
      // Wavy skirt.
      var base = y + r * 0.85, legs = 4, span = (r * 2) / legs;
      ctx.lineTo(x + r, base);
      for (i = 0; i < legs; i++) {
        var x0 = x + r - i * span;
        var dip = (i % 2 === 0) ? r * 0.26 : 0;
        ctx.quadraticCurveTo(x0 - span / 2, base - dip - r * 0.18, x0 - span, base - dip);
      }
      ctx.lineTo(x - r, y - r * 0.12);
      ctx.closePath();
      ctx.fill();
    }

    if (g.frightened && !eyesOnly) {
      // Frightened face: dot eyes and a zig-zag mouth.
      ctx.fillStyle = flashing ? '#d81919' : '#ffffff';
      ctx.fillRect(x - r * 0.42, y - r * 0.28, 3, 3);
      ctx.fillRect(x + r * 0.24, y - r * 0.28, 3, 3);
      ctx.strokeStyle = flashing ? '#d81919' : '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (k = 0; k <= 4; k++) {
        var zx = x - r * 0.55 + (k * r * 1.1) / 4;
        var zy = y + r * 0.3 + ((k % 2) ? -3 : 0);
        if (k === 0) { ctx.moveTo(zx, zy); } else { ctx.lineTo(zx, zy); }
      }
      ctx.stroke();
      return;
    }

    // Eyes track the direction of travel.
    var dx = g.dir.x * r * 0.22, dy = g.dir.y * r * 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.34, y - r * 0.18, r * 0.3, r * 0.36, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.34, y - r * 0.18, r * 0.3, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a4a';
    ctx.beginPath();
    ctx.arc(x - r * 0.34 + dx, y - r * 0.18 + dy, r * 0.16, 0, Math.PI * 2);
    ctx.arc(x + r * 0.34 + dx, y - r * 0.18 + dy, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFruit() {
    if (!game.fruit) return;
    var x = game.fruit.col * TILE, y = game.fruit.row * TILE;
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(x - 3, y + 2, 5, 0, Math.PI * 2);
    ctx.arc(x + 3, y + 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3ddc6b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 1);
    ctx.quadraticCurveTo(x + 4, y - 8, x + 9, y - 9);
    ctx.stroke();
  }

  function centreText(text, y, size, colour) {
    ctx.font = '700 ' + size + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    ctx.fillText(text, W / 2, y);
  }

  function render(t) {
    var i;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    drawMaze(t);
    drawFruit();

    if (game.state !== 'levelclear') {
      for (i = 0; i < game.ghosts.length; i++) drawGhost(game.ghosts[i], t);
    }
    if (game.state !== 'over') drawPac();

    for (i = 0; i < game.pops.length; i++) {
      var pop = game.pops[i];
      ctx.globalAlpha = Math.max(0, pop.life);
      centreText(pop.text, pop.y, 13, pop.colour);
      ctx.globalAlpha = 1;
    }

    if (game.state === 'ready') {
      centreText('READY!', (PAC_START.row - 3) * TILE + TILE / 2, 17, '#ffd54a');
    } else if (game.state === 'levelclear') {
      centreText('LEVEL ' + game.level + ' CLEAR', H / 2 - 20, 18, '#3ce0ff');
    } else if (game.state === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, W, H);
      centreText('PAUSED', H / 2, 22, '#ffd54a');
      centreText('press P to resume', H / 2 + 26, 12, '#9a9ac0');
    }
  }

  // ---------------------------------------------------------------- audio
  // Tiny synthesised bleeps via WebAudio, so the repo ships no sound assets.
  var sfx = (function () {
    var actx = null, muted = false;

    function ac() {
      if (actx) return actx;
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try { actx = new Ctor(); } catch (e) { actx = null; }
      return actx;
    }

    function tone(freq, dur, type, gain, slideTo) {
      if (muted) return;
      var a = ac();
      if (!a) return;
      if (a.state === 'suspended') a.resume();
      var osc = a.createOscillator();
      var amp = a.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, a.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
      amp.gain.setValueAtTime(gain || 0.05, a.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      osc.connect(amp);
      amp.connect(a.destination);
      osc.start();
      osc.stop(a.currentTime + dur + 0.02);
    }

    var wakaUp = false;
    return {
      unlock: function () { var a = ac(); if (a && a.state === 'suspended') a.resume(); },
      isMuted: function () { return muted; },
      toggle: function () { muted = !muted; return muted; },
      waka: function () { wakaUp = !wakaUp; tone(wakaUp ? 420 : 300, 0.055, 'square', 0.035); },
      power: function () { tone(180, 0.32, 'sawtooth', 0.05, 520); },
      eatGhost: function () { tone(300, 0.26, 'square', 0.055, 900); },
      fruit: function () { tone(680, 0.16, 'triangle', 0.06, 1180); },
      death: function () { tone(520, 0.75, 'sawtooth', 0.07, 70); },
      levelUp: function () { tone(520, 0.14, 'square', 0.05, 780); setTimeout(function () { tone(780, 0.22, 'square', 0.05, 1180); }, 150); }
    };
  }());

  // ---------------------------------------------------------------- dom
  var elScore = document.getElementById('score');
  var elHigh = document.getElementById('high');
  var elLevel = document.getElementById('level');
  var elLives = document.getElementById('lives');
  var overlay = document.getElementById('overlay');
  var overlayText = document.getElementById('overlay-text');
  var startBtn = document.getElementById('start-btn');
  var muteBtn = document.getElementById('mute-btn');
  var restartBtn = document.getElementById('restart-btn');

  function syncHud() {
    elScore.textContent = game.score;
    elHigh.textContent = game.high;
    elLevel.textContent = game.level;
    elLives.textContent = game.lives > 0 ? new Array(game.lives + 1).join('●') : '—';
  }

  function showOverlay(title, text, button) {
    // Built as DOM nodes rather than innerHTML so no string ever reaches the parser.
    var titleEl = overlay.querySelector('.title');
    while (titleEl.firstChild) titleEl.removeChild(titleEl.firstChild);
    if (title === 'PACMAN') {
      titleEl.appendChild(document.createTextNode('PAC'));
      var span = document.createElement('span');
      span.textContent = 'MAN';
      titleEl.appendChild(span);
    } else {
      titleEl.textContent = title;
    }
    overlayText.textContent = text;
    startBtn.textContent = button;
    overlay.hidden = false;
  }

  function hideOverlay() { overlay.hidden = true; }

  // ---------------------------------------------------------------- input
  var KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right'
  };

  function steer(name) {
    var d = DIR_BY_NAME[name];
    if (!d || !game.pac) return;
    game.pac.next = d;
    // Standing still against a wall? Turn the instant a legal direction arrives.
    if (game.pac.dir === NONE && passable(game.pac.col + d.x, game.pac.row + d.y, false)) {
      game.pac.dir = d;
    }
  }

  function togglePause() {
    if (game.state === 'playing') { game.state = 'paused'; }
    else if (game.state === 'paused') { game.state = 'playing'; }
  }

  function primaryAction() {
    sfx.unlock();
    if (game.state === 'over' || game.state === 'title') { newGame(); }
    else if (!overlay.hidden) { hideOverlay(); newGame(); }
  }

  window.addEventListener('keydown', function (e) {
    var dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      sfx.unlock();
      steer(dir);
      return;
    }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); return; }
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); applyMute(sfx.toggle()); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!overlay.hidden) primaryAction();
      else if (game.state === 'paused') togglePause();
    }
  }, { passive: false });

  startBtn.addEventListener('click', primaryAction);
  restartBtn.addEventListener('click', function () { sfx.unlock(); newGame(); });

  function applyMute(isMuted) {
    muteBtn.textContent = isMuted ? '🔇 Muted' : '🔊 Sound';
    muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  }
  muteBtn.addEventListener('click', function () { applyMute(sfx.toggle()); });

  // On-screen d-pad (touch devices).
  var pad = document.getElementById('pad');
  Array.prototype.forEach.call(pad.querySelectorAll('.pad-btn'), function (btn) {
    var go = function (e) { e.preventDefault(); sfx.unlock(); steer(btn.dataset.dir); };
    btn.addEventListener('touchstart', go, { passive: false });
    btn.addEventListener('mousedown', go);
  });

  // Swipe anywhere on the board.
  var swipe = null;
  canvas.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0];
    swipe = { x: t.clientX, y: t.clientY };
    sfx.unlock();
  }, { passive: true });

  canvas.addEventListener('touchend', function (e) {
    if (!swipe) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
    if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 'right' : 'left');
    else steer(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  // Pause when the tab loses focus mid-game.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === 'playing') game.state = 'paused';
  });

  // ---------------------------------------------------------------- boot
  try { game.high = parseInt(localStorage.getItem('pacman.high'), 10) || 0; }
  catch (e) { game.high = 0; }

  resetGrid();
  resetActors();
  game.state = 'ready';
  game.timer = 1e9;          // hold the board still behind the title overlay
  syncHud();
  applyMute(false);
  requestAnimationFrame(frame);

  // Expose a tiny handle so the page can be smoke-tested from the console.
  window.PACMAN = {
    game: game, steer: steer, newGame: newGame,
    grid: function () { return grid; },
    pellets: function () { return pelletsLeft; },
    fruitTile: function () { return FRUIT_TILE; }
  };
}());
