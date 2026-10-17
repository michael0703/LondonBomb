// Random-bot stress test for 一夜終極狼人: plays many games over real sockets and
// re-derives every card move, night info line and winner independently.
// Usage: npm run test:werewolf [-- <games>]   (needs Node 22+ for the global WebSocket)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '3123';
const URL = `http://localhost:${PORT}`;

// Load the browser socket.io client into Node
const sandbox = { WebSocket, setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { userAgent: 'node' }, location: { protocol: 'http:', hostname: 'localhost', port: PORT } };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/node_modules/socket.io/client-dist/socket.io.js', 'utf8'), sandbox);
const io = sandbox.io;

const ORDER = ['werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'hunter', 'tanner', 'villager'];
const MAX = { werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, hunter: 1, tanner: 1, villager: 3 };
const TEAM = { werewolf: 'werewolf', minion: 'werewolf', tanner: 'tanner' };
const team = (r) => TEAM[r] || 'village';
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const shuffled = (a) => [...a].sort(() => Math.random() - 0.5);

function randomCounts(n) {
  for (;;) {
    const c = {}; let total = 0;
    ORDER.forEach(r => { c[r] = 0; });
    c.werewolf = 1 + rnd(2); total = c.werewolf;
    while (total < n + 3) {
      const r = pick(ORDER);
      if (c[r] < MAX[r]) { c[r]++; total++; }
      if (ORDER.every(x => c[x] >= MAX[x])) break;
    }
    if (total === n + 3) return c;
  }
}

function connect() {
  return new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, auth: { token: 'bot' + Math.random(), gameType: 'werewolf' } });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
}

const failures = [];
const fail = (g, msg) => { failures.push(`[game ${g}] ${msg}`); };

async function playGame(g) {
  const n = 3 + rnd(8);
  const custom = Math.random() < 0.5;
  const forceDawn = Math.random() < 0.15; // one player never acts, host forces dawn
  const bots = [];
  for (let i = 0; i < n; i++) bots.push({ s: await connect(), name: 'B' + i, state: null, action: undefined, acted: false, voted: false });
  const host = bots[0];
  const sleeper = forceDawn ? pick(bots.slice(1)) : null;

  let resolveEnd;
  const ended = new Promise(r => { resolveEnd = r; });
  const timeout = setTimeout(() => resolveEnd('timeout'), 15000);
  const errors = [];

  bots.forEach(b => {
    b.s.on('errorMsg', m => errors.push(`${b.name}: ${m}`));
    b.s.on('roomUpdate', st => {
      b.state = st;
      if (!st.gameStarted) return;
      if (st.roundPhase === 'night' && !b.acted && b !== sleeper && st.my) {
        b.acted = true;
        const others = st.players.filter(p => p.id !== b.s.id).map(p => p.id);
        let a = {};
        switch (st.my.startRole) {
          case 'werewolf': if (st.my.loneWolf && Math.random() < 0.8) a = { centerIndex: rnd(3) }; break;
          case 'seer': a = pick([{ skip: true }, { playerId: pick(others) }, { centerIndexes: shuffled([0, 1, 2]).slice(0, 2) }]); break;
          case 'robber': a = Math.random() < 0.2 ? { skip: true } : { playerId: pick(others) }; break;
          case 'troublemaker': a = others.length < 2 || Math.random() < 0.2 ? { skip: true } : { playerIds: shuffled(others).slice(0, 2) }; break;
          case 'drunk': a = { centerIndex: rnd(3) }; break;
        }
        b.action = a;
        // Random tiny delay so submissions interleave
        setTimeout(() => b.s.emit('werewolf_night', a), rnd(20));
        if (sleeper && b === host) {
          setTimeout(() => host.s.emit('werewolf_forceDawn'), 200);
        }
      }
      if (st.roundPhase === 'day' && b === host && !b.dayDone) { b.dayDone = true; setTimeout(() => b.s.emit('werewolf_startVoting'), rnd(20)); }
      if (st.roundPhase === 'voting' && !b.voted) {
        b.voted = true;
        const others = st.players.filter(p => p.id !== b.s.id).map(p => p.id);
        // Bias votes so deaths happen often
        const t = Math.random() < 0.6 ? others[0] : pick(others);
        setTimeout(() => b.s.emit('werewolf_vote', { targetId: t }), rnd(20));
      }
      if (st.gameEnded) resolveEnd('ok');
    });
  });

  host.s.emit('createRoom', { name: host.name, gameType: 'werewolf' });
  await new Promise(r => setTimeout(r, 60));
  const code = host.state.roomCode;
  for (const b of bots.slice(1)) b.s.emit('joinRoom', { name: b.name, roomCode: code, gameType: 'werewolf' });
  await new Promise(r => setTimeout(r, 80 + n * 10));
  let counts = host.state.setup.counts;
  if (custom) { counts = randomCounts(n); host.s.emit('werewolf_settings', { counts }); await new Promise(r => setTimeout(r, 40)); }
  if (host.state.setup.error) { fail(g, 'setup error ' + host.state.setup.error); }
  host.s.emit('startGame');

  const how = await ended;
  clearTimeout(timeout);
  // Wait for every bot to receive the final state
  await new Promise(r => setTimeout(r, 80));
  bots.forEach(b => { b.id = b.s.id; b.s.disconnect(); });
  if (how !== 'ok') { fail(g, `did not finish (n=${n}, phase=${host.state && host.state.roundPhase}, errors=${errors.join(' | ')})`); return; }
  if (errors.length) fail(g, 'server errors: ' + errors.join(' | '));
  verify(g, n, bots, sleeper, counts);
}

function verify(g, n, bots, sleeper, counts) {
  const st = bots[0].state;
  const byId = new Map(st.players.map(p => [p.id, p]));
  const botOf = new Map(bots.map(b => [b.id, b]));
  const name = (role) => st.roleInfo[role].name;

  // Card set must match the configured counts
  const all = [...st.players.map(p => p.startRole), ...st.center.start].sort();
  const want = ORDER.flatMap(r => Array(counts[r] || 0).fill(r)).sort();
  if (JSON.stringify(all) !== JSON.stringify(want)) fail(g, `card set mismatch ${all} vs ${want}`);

  // Re-apply the night in official order
  const card = new Map(st.players.map(p => [p.id, p.startRole]));
  const center = [...st.center.start];
  const startOf = (role) => st.players.filter(p => p.startRole === role);
  const act = (p) => (botOf.get(p.id) === sleeper ? null : botOf.get(p.id).action);
  startOf('robber').forEach(p => { const a = act(p); if (a && a.playerId) { const t = card.get(a.playerId); card.set(a.playerId, card.get(p.id)); card.set(p.id, t); } });
  startOf('troublemaker').forEach(p => { const a = act(p); if (a && a.playerIds) { const [x, y] = a.playerIds; const t = card.get(x); card.set(x, card.get(y)); card.set(y, t); } });
  startOf('drunk').forEach(p => {
    const a = act(p);
    let idx = a ? a.centerIndex : null;
    if (idx === null || idx === undefined) {
      const line = st.nightLog.find(l => l.startsWith(`🍺 酒鬼 ${p.name} 拿`));
      idx = line ? Number(line.match(/第 (\d) 張/)[1]) - 1 : -1;
    }
    const t = center[idx]; center[idx] = card.get(p.id); card.set(p.id, t);
  });
  st.players.forEach(p => { if (p.finalRole !== card.get(p.id)) fail(g, `${p.name} final ${p.finalRole}, expected ${card.get(p.id)}`); });
  if (JSON.stringify(center) !== JSON.stringify(st.center.final)) fail(g, `center final ${st.center.final}, expected ${center}`);

  // Night info each bot saw
  bots.forEach(b => {
    const me = byId.get(b.id);
    const info = (b.state.my && b.state.my.nightInfo) || [];
    const text = info.join('\n');
    const a = act(me);
    const role = me.startRole;
    if (role === 'werewolf') {
      const mates = startOf('werewolf').filter(p => p.id !== me.id);
      mates.forEach(m => { if (!text.includes(m.name)) fail(g, `wolf ${me.name} not told about ${m.name}`); });
      if (a && a.centerIndex !== undefined && !text.includes(`中間第 ${a.centerIndex + 1} 張：${st.roleInfo[st.center.start[a.centerIndex]].icon}${name(st.center.start[a.centerIndex])}`)) fail(g, `lone wolf peek wrong: ${text}`);
    }
    if (role === 'minion') startOf('werewolf').forEach(m => { if (!text.includes(m.name)) fail(g, `minion not told wolf ${m.name}`); });
    if (role === 'mason') startOf('mason').filter(p => p.id !== me.id).forEach(m => { if (!text.includes(m.name)) fail(g, `mason not told ${m.name}`); });
    if (role === 'seer' && a && a.playerId) {
      const t = byId.get(a.playerId);
      if (!text.includes(`${t.name} 的牌：${st.roleInfo[t.startRole].icon}${name(t.startRole)}`)) fail(g, `seer saw wrong: ${text} (target start ${t.startRole})`);
    }
    if (role === 'seer' && a && a.centerIndexes) a.centerIndexes.forEach(i => { if (!text.includes(`第 ${i + 1} 張 ${st.roleInfo[st.center.start[i]].icon}${name(st.center.start[i])}`)) fail(g, `seer center wrong: ${text}`); });
    if (role === 'robber' && a && a.playerId) {
      const t = byId.get(a.playerId);
      if (!text.includes(`現在你是：${st.roleInfo[t.startRole].icon}${name(t.startRole)}`)) fail(g, `robber saw wrong: ${text}`);
    }
    if (role === 'insomniac' && !text.includes(`自己的牌：${st.roleInfo[me.finalRole].icon}${name(me.finalRole)}`)) fail(g, `insomniac saw wrong: ${text} (final ${me.finalRole})`);
    // Nobody should get info belonging to another role
    if (['villager', 'hunter', 'tanner', 'troublemaker', 'drunk'].includes(role) && info.length) fail(g, `${role} got info: ${text}`);
  });

  // Votes, deaths, winners
  const r = st.result;
  const votes = r.votes;
  const tally = new Map();
  votes.forEach(v => tally.set(v.target, (tally.get(v.target) || 0) + 1));
  const max = Math.max(0, ...tally.values());
  const dead = max >= 2 ? [...tally].filter(([, c]) => c === max).map(([id]) => id) : [];
  [...dead].forEach(id => {
    if (card.get(id) === 'hunter') { const v = votes.find(x => x.voter === id); if (v && !dead.includes(v.target)) dead.push(v.target); }
  });
  if (JSON.stringify([...dead].sort()) !== JSON.stringify([...r.dead].sort())) fail(g, `dead ${r.dead.map(id => byId.get(id).name)} expected ${dead.map(id => byId.get(id).name)}`);
  const deadRoles = dead.map(id => card.get(id));
  const wolvesInPlay = st.players.some(p => card.get(p.id) === 'werewolf');
  const winners = new Set();
  if (deadRoles.includes('tanner')) winners.add('tanner');
  if (wolvesInPlay) {
    if (deadRoles.includes('werewolf')) winners.add('village');
    else if (!deadRoles.includes('tanner')) winners.add('werewolf');
  } else {
    if (!dead.length) winners.add('village');
    else if (st.players.some(p => card.get(p.id) === 'minion') && !deadRoles.includes('minion') && !deadRoles.includes('tanner')) winners.add('werewolf');
  }
  if (JSON.stringify([...winners].sort()) !== JSON.stringify([...r.winningTeams].sort())) fail(g, `winners ${r.winningTeams} expected ${[...winners]}`);
  const winnerIds = st.players.filter(p => winners.has(team(card.get(p.id)))).map(p => p.id).sort();
  if (JSON.stringify(winnerIds) !== JSON.stringify([...r.winnerIds].sort())) fail(g, 'winnerIds mismatch');
  if (votes.length !== n) fail(g, `only ${votes.length}/${n} votes`);
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res, rej) => {
    server.stdout.on('data', d => { if (String(d).includes('running on port')) res(server); });
    server.on('exit', code => rej(new Error(`server exited with ${code}`)));
  });
}

(async () => {
  const GAMES = Number(process.argv[2]) || 200;
  const server = await startServer();
  try {
    for (let g = 0; g < GAMES; g++) await playGame(g);
  } finally {
    server.kill();
  }
  console.log(`${GAMES} games, ${failures.length} failures`);
  failures.slice(0, 30).forEach(f => console.log(f));
  process.exit(failures.length ? 1 : 0);
})();
