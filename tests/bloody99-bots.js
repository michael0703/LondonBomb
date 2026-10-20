// Random-bot stress test for 血腥99: plays many games over real sockets and
// checks every play against the rules (totals, busts, drawing, A / 7, empty
// hands, turn order, card conservation), plus teams, kings and the winner.
// Usage: npm run test:bloody99 [-- <games>]   (needs Node 22+ for the global WebSocket)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '3126';
const URL = `http://localhost:${PORT}`;
const LIMIT = 99;

const sandbox = { WebSocket, setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { userAgent: 'node' }, location: { protocol: 'http:', hostname: 'localhost', port: PORT } };
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/node_modules/socket.io/client-dist/socket.io.js', 'utf8'), sandbox);
const io = sandbox.io;

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const failures = [];
const stats = { red: 0, black: 0, plays: 0, busts: 0, emptyDeaths: 0, sevenKills: 0, rounds: [] };
const fail = (g, msg) => failures.push(`[game ${g}] ${msg}`);

function connect() {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, auth: { token: 'bot' + Math.random(), gameType: 'bloody99' } });
    s.on('connect', () => res(s));
  });
}

// What the bot on turn does: mostly safe cards, sometimes anything
function chooseAction(st, me) {
  const hand = st.my.hand;
  const others = st.players.filter(p => !p.dead && !p.left && p.id !== me);
  const safe = hand.filter(c => ![2, 3, 6, 8, 9].includes(c.rank) || st.total + c.rank <= LIMIT);
  const card = safe.length && Math.random() < 0.9 ? pick(safe) : pick(hand);
  const action = { cardId: card.id };
  if (card.rank === 10 || card.rank === 12) action.sign = st.total + (card.rank === 10 ? 10 : 20) <= LIMIT && Math.random() < 0.5 ? '+' : '-';
  if (card.rank === 1) action.targetId = pick(others.filter(p => p.handCount > 0) .concat(others)).id;
  if (card.rank === 5 || card.rank === 7) action.targetId = pick(others).id;
  return action;
}

function checkPlay(g, prev, st) {
  const e = st.last;
  const actorPrev = prev.players.find(p => p.id === e.by);
  const actorNow = st.players.find(p => p.id === e.by);
  const r = e.card.rank;
  const seats = st.players;
  stats.plays++;
  if (prev.turnId !== e.by) fail(g, `${actorPrev.name} played out of turn (turn was ${prev.turnId})`);
  if (e.before !== prev.total) fail(g, `play before=${e.before} but total was ${prev.total}`);
  // Total rules
  let ok;
  if ([2, 3, 6, 8, 9].includes(r)) ok = e.after === e.before + r;
  else if (r === 10 || r === 12) { const n = r === 10 ? 10 : 20; ok = e.after === Math.max(0, e.before - n) || e.after === e.before + n; }
  else if (r === 13) ok = e.after === LIMIT;
  else ok = e.after === e.before;
  if (!ok) fail(g, `rank ${r}: ${e.before} -> ${e.after}`);
  if (e.after < 0) fail(g, `negative total ${e.after}`);
  if (!!e.bust !== e.after > LIMIT) fail(g, `bust flag ${e.bust} for total ${e.after}`);

  const deaths = st.players.filter(p => p.dead && !prev.players.find(q => q.id === p.id).dead);
  if (e.bust) {
    stats.busts++;
    if (!actorNow.dead) fail(g, `${actorNow.name} busted but is alive`);
  } else {
    // Drawing: A / 7 draw nothing, others draw one if the deck had cards
    const target = e.targetId ? st.players.find(p => p.id === e.targetId) : null;
    const targetPrev = e.targetId ? prev.players.find(p => p.id === e.targetId) : null;
    if (r === 1) {
      if (prev.deckCount !== st.deckCount) fail(g, 'A drew from the deck');
      if (!actorNow.dead && actorNow.handCount !== actorPrev.handCount) fail(g, `A: hand ${actorPrev.handCount} -> ${actorNow.handCount}`);
      if (!target.dead && target.handCount !== targetPrev.handCount - 1) fail(g, `A: target hand ${targetPrev.handCount} -> ${target.handCount}`);
      if (targetPrev.handCount === 1 && !target.dead) fail(g, 'A took the last card but the target lives');
    } else if (r === 7) {
      if (prev.deckCount !== st.deckCount) fail(g, '7 drew from the deck');
      if (!actorNow.dead && actorNow.handCount !== targetPrev.handCount) fail(g, `7: actor now ${actorNow.handCount}, target had ${targetPrev.handCount}`);
      if (!target.dead && target.handCount !== actorPrev.handCount - 1) fail(g, `7: target now ${target.handCount}, actor had ${actorPrev.handCount}`);
      if (actorPrev.handCount === 1) { if (!target.dead) fail(g, 'empty-hand 7 did not kill'); else stats.sevenKills++; }
    } else if (prev.deckCount > 0) {
      if (st.deckCount !== prev.deckCount - 1) fail(g, `deck ${prev.deckCount} -> ${st.deckCount} on rank ${r}`);
      if (!actorNow.dead && actorNow.handCount !== actorPrev.handCount) fail(g, `rank ${r}: hand ${actorPrev.handCount} -> ${actorNow.handCount}`);
    } else if (!actorNow.dead && actorNow.handCount !== actorPrev.handCount - 1) fail(g, `rank ${r} with empty deck: hand ${actorPrev.handCount} -> ${actorNow.handCount}`);
  }
  // Nobody alive has an empty hand; every death resets the total
  st.players.filter(p => !p.dead && !p.left).forEach(p => { if (p.handCount === 0) fail(g, `${p.name} alive with 0 cards`); });
  deaths.filter(p => p.id !== e.by || !e.bust).forEach(() => stats.emptyDeaths++);
  if (deaths.length && st.total !== LIMIT) fail(g, `total ${st.total} after a death (should reset to ${LIMIT})`);

  // Card conservation
  const inHands = st.players.reduce((s, p) => s + (p.dead ? 0 : p.handCount), 0);
  const c = st.cardStats;
  if (st.deckCount + inHands + c.played + c.dumped !== c.total) fail(g, `cards: deck ${st.deckCount} + hands ${inHands} + played ${c.played} + dumped ${c.dumped} != ${c.total}`);

  // Turn order
  if (!st.gameEnded) {
    if (r === 4 && !e.bust && st.dir !== -prev.dir) fail(g, '4 did not reverse');
    const alive = (id) => { const p = st.players.find(x => x.id === id); return p && !p.dead && !p.left; };
    const nextAfter = (id) => {
      const i = seats.findIndex(p => p.id === id);
      for (let k = 1; k <= seats.length; k++) { const p = seats[((i + k * st.dir) % seats.length + seats.length) % seats.length]; if (!p.dead && !p.left) return p.id; }
      return null;
    };
    let want;
    if (r === 5 && !e.bust && alive(e.targetId)) want = e.targetId;
    else want = nextAfter(e.by);
    if (st.turnId !== want) fail(g, `turn went to ${st.turnId}, expected ${want} (rank ${r}, bust ${!!e.bust})`);
  }
}

async function playGame(g) {
  const n = 4 + rnd(7);
  const decks = 1 + rnd(3);
  const kingsPublic = Math.random() < 0.5;
  const bots = [];
  for (let i = 0; i < n; i++) bots.push({ s: await connect(), name: 'B' + i, errs: [] });
  const host = bots[0];
  let done;
  const ended = new Promise(r => { done = r; });
  const timeout = setTimeout(() => done('timeout'), Number(process.env.GAME_TIMEOUT) || 30000);
  let prev = null;
  const acted = new Set();

  bots.forEach((b, i) => {
    b.s.on('errorMsg', m => b.errs.push(m));
    b.s.on('roomUpdate', st => {
      b.st = st;
      if (!st.gameStarted) return;
      if (i === 0) {
        if (prev && st.playCount > prev.playCount) {
          if (st.playCount !== prev.playCount + 1) fail(g, `missed a play (${prev.playCount} -> ${st.playCount})`);
          checkPlay(g, prev, st);
        }
        // Identities stay hidden from the observer while the game runs
        if (!st.gameEnded) st.players.forEach(p => {
          if (p.id === b.s.id) return;
          if (p.team && !(kingsPublic && p.king)) fail(g, `observer sees ${p.name}'s team`);
          if (!kingsPublic && p.king !== null) fail(g, `observer sees ${p.name}'s king flag with hidden kings`);
        });
        prev = st;
      }
      if (st.gameEnded) return done('ok');
      if (st.turnId === b.s.id && st.my && !st.my.dead) {
        const key = `${st.playCount}`;
        if (acted.has(key)) return;
        acted.add(key);
        setTimeout(() => b.s.emit('bloody99_play', chooseAction(st, b.s.id)), rnd(8));
      }
    });
  });

  host.s.emit('createRoom', { name: host.name, gameType: 'bloody99' });
  await wait(60);
  for (const b of bots.slice(1)) b.s.emit('joinRoom', { name: b.name, roomCode: host.st.roomCode, gameType: 'bloody99' });
  await wait(80 + n * 10);
  host.s.emit('bloody99_settings', { decks, kingsPublic });
  await wait(40);
  host.s.emit('startGame');

  const how = await ended;
  clearTimeout(timeout);
  await wait(60);
  bots.forEach(b => b.s.disconnect());
  const st = host.st;
  if (how !== 'ok') return fail(g, `did not finish (n=${n}, phase=${st && st.roundPhase}, plays=${st && st.playCount}, errs=${bots.flatMap(b => b.errs).join('|')})`);

  // Teams and kings
  const black = st.players.filter(p => p.team === 'black').length;
  if (black !== Math.ceil(n / 2) || st.players.filter(p => p.team === 'red').length !== Math.floor(n / 2)) fail(g, `teams ${black} black of ${n}`);
  ['red', 'black'].forEach(t => { const k = st.players.filter(p => p.team === t && p.king).length; if (k !== 1) fail(g, `${t} has ${k} kings`); });
  if (st.decks !== decks || st.kingsPublic !== kingsPublic) fail(g, `settings not applied ${st.decks}/${st.kingsPublic}`);
  if (st.cardStats.total !== decks * 52) fail(g, `card total ${st.cardStats.total} for ${decks} decks`);
  // Winner: the other team of the (only) dead king, or the last one standing
  const deadKings = st.players.filter(p => p.king && p.dead);
  if (deadKings.length === 1) { if (st.winner === deadKings[0].team) fail(g, `winner ${st.winner} but its king died`); }
  else if (deadKings.length > 1) fail(g, `${deadKings.length} kings dead`);
  else if (st.players.filter(p => !p.dead).length > 1) fail(g, `game ended with no dead king and ${st.players.filter(p => !p.dead).length} alive`);
  const errs = bots.flatMap(b => b.errs);
  if (errs.length) fail(g, `server errors: ${errs.join(' | ')}`);
  stats[st.winner]++;
  stats.rounds.push(st.playCount);
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res, rej) => {
    server.stdout.on('data', d => { if (String(d).includes('running on port')) res(server); });
    server.on('exit', code => rej(new Error(`server exited with ${code}`)));
  });
}

(async () => {
  const GAMES = Number(process.argv[2]) || 150;
  const server = await startServer();
  try {
    for (let g = 0; g < GAMES; g++) await playGame(g);
  } finally {
    server.kill();
  }
  console.log(`${GAMES} games, ${failures.length} failures`);
  console.log(`winners: red ${stats.red}, black ${stats.black}; ${stats.plays} plays checked, ${stats.busts} busts, ${stats.emptyDeaths} empty-hand deaths (${stats.sevenKills} by an empty-hand 7)`);
  console.log(`plays per game: avg ${(stats.rounds.reduce((a, b) => a + b, 0) / Math.max(1, stats.rounds.length)).toFixed(1)}, max ${Math.max(0, ...stats.rounds)}`);
  failures.slice(0, 30).forEach(f => console.log(f));
  process.exit(failures.length ? 1 : 0);
})();
