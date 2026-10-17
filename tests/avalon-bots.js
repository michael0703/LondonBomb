// Random-bot stress test for 阿瓦隆: plays many games over real sockets with
// random settings and checks roles, night info, votes, quests, the Lady of the
// Lake and the final winner against an independent re-computation.
// Usage: npm run test:avalon [-- <games>]   (needs Node 22+ for the global WebSocket)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '3124';
const URL = `http://localhost:${PORT}`;

const sandbox = { WebSocket, setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { userAgent: 'node' }, location: { protocol: 'http:', hostname: 'localhost', port: PORT } };
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/node_modules/socket.io/client-dist/socket.io.js', 'utf8'), sandbox);
const io = sandbox.io;

const TEAMS = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
const SIZES = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5] };
const EVIL = ['assassin', 'morgana', 'mordred', 'oberon', 'minion'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const shuffled = (a) => [...a].sort(() => Math.random() - 0.5);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const failures = [];
const stats = { evil: 0, good: 0, byReason: {} };
const fail = (g, msg) => failures.push(`[game ${g}] ${msg}`);

function connect() {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, auth: { token: 'bot' + Math.random(), gameType: 'avalon' } });
    s.on('connect', () => res(s));
  });
}

async function playGame(g) {
  const n = 5 + rnd(6);
  const evilSlots = TEAMS[n][1] - 1;
  const extras = shuffled(['percival', 'morgana', 'mordred', 'oberon']).filter(() => Math.random() < 0.5);
  // Keep the evil extras within the evil seats so the game can start
  const evilExtras = extras.filter(r => r !== 'percival').slice(0, evilSlots);
  const chosen = [...(extras.includes('percival') ? ['percival'] : []), ...evilExtras];
  const lady = Math.random() < 0.5;
  // Some games vote mostly no, so the 5-rejections rule gets exercised
  const approveRate = Math.random() < 0.25 ? 0.15 : 0.65;
  const bots = [];
  for (let i = 0; i < n; i++) bots.push({ s: await connect(), name: 'A' + i, errs: [] });
  const host = bots[0];
  const expect = { votes: [], quests: [], ladyChecks: [] };
  let done;
  const ended = new Promise(r => { done = r; });
  const timeout = setTimeout(() => done('timeout'), 30000);
  const acted = new Set();
  const once = (key) => { if (acted.has(key)) return false; acted.add(key); return true; };

  bots.forEach(b => {
    b.s.on('errorMsg', m => b.errs.push(m));
    b.s.on('roomUpdate', st => {
      b.st = st;
      if (!st.gameStarted) return;
      if (st.gameEnded) return done('ok');
      const id = b.s.id;
      const roundKey = `${st.quest}-${st.rounds.length}-${st.roundPhase}`;
      const active = st.players.filter(p => !p.left).map(p => p.id);
      if (st.roundPhase === 'proposal' && st.leaderId === id && once(`prop-${roundKey}`)) {
        setTimeout(() => b.s.emit('avalon_propose', { team: shuffled(active).slice(0, st.questSizes[st.quest]) }), rnd(10));
      }
      if (st.roundPhase === 'vote' && once(`vote-${roundKey}-${id}`)) {
        // Lean towards approving so games don't always end on 5 rejections
        const approve = Math.random() < approveRate;
        setTimeout(() => b.s.emit('avalon_vote', { approve }), rnd(10));
      }
      if (st.roundPhase === 'quest' && st.team.includes(id) && once(`quest-${roundKey}-${id}`)) {
        const evil = st.my.team === 'evil';
        // Good bots also try to fail now and then: the server must refuse it
        if (!evil && Math.random() < 0.2) b.s.emit('avalon_quest', { card: 'fail' });
        const card = evil && Math.random() < 0.6 ? 'fail' : 'success';
        b.card = card;
        setTimeout(() => b.s.emit('avalon_quest', { card }), rnd(10) + 5);
      }
      if (st.roundPhase === 'quest_result' && b === host && once(`cont-${roundKey}`)) {
        setTimeout(() => b.s.emit('avalon_continue'), rnd(10));
      }
      if (st.roundPhase === 'lady' && st.ladyHolderId === id && once(`lady-${roundKey}`)) {
        const targets = active.filter(t => t !== id && !st.ladyUsedIds.includes(t));
        const t = pick(targets);
        expect.ladyChecks.push({ holder: id, target: t });
        setTimeout(() => b.s.emit('avalon_lady', { targetId: t }), rnd(10));
      }
      if (st.roundPhase === 'assassin' && st.assassinId === id && once('assassin')) {
        setTimeout(() => b.s.emit('avalon_assassinate', { targetId: pick(active.filter(t => t !== id)) }), rnd(10));
      }
    });
  });

  host.s.emit('createRoom', { name: host.name, gameType: 'avalon' });
  await wait(60);
  for (const b of bots.slice(1)) b.s.emit('joinRoom', { name: b.name, roomCode: host.st.roomCode, gameType: 'avalon' });
  await wait(80 + n * 10);
  host.s.emit('avalon_settings', { extras: chosen, lady });
  await wait(40);
  if (host.st.setup.error) fail(g, 'setup error: ' + host.st.setup.error);
  host.s.emit('startGame');

  const how = await ended;
  clearTimeout(timeout);
  await wait(80);
  bots.forEach(b => { b.id = b.s.id; b.s.disconnect(); });
  if (how !== 'ok') return fail(g, `did not finish (n=${n}, phase=${host.st && host.st.roundPhase})`);
  verify(g, n, bots, chosen, lady);
}

function verify(g, n, bots, chosen, lady) {
  const st = bots[0].st;
  const byId = new Map(st.players.map(p => [p.id, p]));
  const roleOf = (id) => byId.get(id).role;
  const isEvil = (id) => EVIL.includes(roleOf(id));
  const name = (id) => byId.get(id).name;

  // Roles: right counts, Merlin and the assassin always, chosen extras exactly once
  const roles = st.players.map(p => p.role);
  const evilCount = roles.filter(r => EVIL.includes(r)).length;
  if (evilCount !== TEAMS[n][1]) fail(g, `evil count ${evilCount} for ${n} players`);
  ['merlin', 'assassin', ...chosen].forEach(r => { if (roles.filter(x => x === r).length !== 1) fail(g, `role ${r} appears ${roles.filter(x => x === r).length} times`); });
  ['percival', 'morgana', 'mordred', 'oberon'].filter(r => !chosen.includes(r)).forEach(r => { if (roles.includes(r)) fail(g, `unchosen role ${r} in game`); });

  // Night info each bot saw (kept from its last game state)
  bots.forEach(b => {
    const me = byId.get(b.id);
    const info = (b.st.my && b.st.my.nightInfo || []).join('\n');
    const others = st.players.filter(p => p.id !== b.id);
    const shown = (p) => info.includes(p.name);
    const mustSee = [], mustNot = [];
    if (me.role === 'merlin') others.forEach(p => (isEvil(p.id) && p.role !== 'mordred' ? mustSee : mustNot).push(p));
    else if (me.role === 'percival') others.forEach(p => (['merlin', 'morgana'].includes(p.role) ? mustSee : mustNot).push(p));
    else if (EVIL.includes(me.role) && me.role !== 'oberon') others.forEach(p => (isEvil(p.id) && p.role !== 'oberon' ? mustSee : mustNot).push(p));
    else others.forEach(p => mustNot.push(p));
    // Names like A1 are prefixes of A10, so only check exact tokens
    const tokens = new Set(info.split(/[：、\s（）]/));
    mustSee.forEach(p => { if (!tokens.has(p.name)) fail(g, `${me.role} ${me.name} not told about ${p.name} (${p.role}): ${info}`); });
    mustNot.forEach(p => { if (tokens.has(p.name)) fail(g, `${me.role} ${me.name} wrongly sees ${p.name} (${p.role}): ${info}`); });
  });

  // Every proposal: vote majority, team size, quest result
  let rejectsInRow = 0, maxRejects = 0;
  const results = [];
  st.rounds.forEach((r, i) => {
    if (r.team.length !== SIZES[n][r.quest]) fail(g, `round ${i} team size ${r.team.length} != ${SIZES[n][r.quest]}`);
    if (!r.votes) return;
    const yes = Object.values(r.votes).filter(v => v).length;
    const total = Object.values(r.votes).length;
    if (total !== n) fail(g, `round ${i}: ${total}/${n} votes`);
    if ((yes > total / 2) !== r.approved) fail(g, `round ${i}: ${yes}/${total} yes but approved=${r.approved}`);
    if (!r.approved) { rejectsInRow++; maxRejects = Math.max(maxRejects, rejectsInRow); return; }
    rejectsInRow = 0;
    if (!r.result) return fail(g, `round ${i} approved but no quest result`);
    const goodFails = r.team.filter(id => !isEvil(id));
    if (r.result.fails > r.team.filter(isEvil).length) fail(g, `round ${i}: ${r.result.fails} fails but only ${r.team.filter(isEvil).length} evil on team (good members: ${goodFails.map(name)})`);
    const needed = r.quest === 3 && n >= 7 ? 2 : 1;
    if ((r.result.fails < needed) !== r.result.success) fail(g, `quest ${r.quest + 1}: ${r.result.fails} fails, needed ${needed}, success=${r.result.success}`);
    results.push(r.result.success ? 'success' : 'fail');
  });
  if (JSON.stringify(results) !== JSON.stringify(st.results)) fail(g, `results ${st.results} vs recomputed ${results}`);

  // Lady of the Lake: only when enabled, after quests 2-4, correct team shown privately
  if (!lady && expect_lady(st)) fail(g, 'lady used while disabled');
  bots.forEach(b => {
    (b.st.my && b.st.my.ladyInfo || []).forEach(line => {
      const target = st.players.find(p => line.includes(`查驗了 ${p.name}：`));
      if (!target) return fail(g, `unparsable lady info ${line}`);
      const said = line.includes('壞人陣營') ? 'evil' : 'good';
      if (said !== (isEvil(target.id) ? 'evil' : 'good')) fail(g, `lady says ${target.name} is ${said} but role is ${target.role}`);
    });
  });

  // Winner
  const wins = results.filter(r => r === 'success').length;
  const losses = results.filter(r => r === 'fail').length;
  let want;
  if (maxRejects >= 5) want = 'evil';
  else if (losses >= 3) want = 'evil';
  else if (wins >= 3) want = roleOf(st.assassinTarget) === 'merlin' ? 'evil' : 'good';
  if (want !== st.winner) fail(g, `winner ${st.winner}, expected ${want} (wins ${wins}, losses ${losses}, rejects ${maxRejects}, stab ${st.assassinTarget && roleOf(st.assassinTarget)})`);
  if (wins >= 3 && !st.assassinTarget) fail(g, 'good won 3 quests but nobody was stabbed');
  stats[st.winner] = (stats[st.winner] || 0) + 1;
  stats.byReason[st.reason.replace(/[A-Z]\d+/g, 'X')] = (stats.byReason[st.reason.replace(/[A-Z]\d+/g, 'X')] || 0) + 1;

  // Good bots that tried to play a fail card must have been refused
  bots.forEach(b => {
    if (b.errs.some(e => e !== '好人只能出成功。')) fail(g, `${b.name} unexpected errors: ${b.errs.join(' | ')}`);
  });
}

const expect_lady = (st) => st.history.some(h => h.text.includes('湖中女神查驗'));

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
  console.log(`winners: good ${stats.good || 0}, evil ${stats.evil || 0}`);
  Object.entries(stats.byReason).forEach(([r, c]) => console.log(`  ${c}× ${r}`));
  failures.slice(0, 30).forEach(f => console.log(f));
  process.exit(failures.length ? 1 : 0);
})();
