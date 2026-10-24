const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const TOPTEN_TOPICS = require('./topics.json');
const WHOAMI_CELEBRITIES = require('./celebrities.json');
const UNDERCOVER_WORDS = require('./undercover-words.json');
const DECRYPTO_WORDS = require('./decrypto-words.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Bug reports / feature requests from the site become GitHub issues (report.js)
require('./report').setupReports(app, express);

// Global state for rooms
const rooms = new Map();

// Bot Names
const BOT_NAMES = ['福爾摩斯機器人', '華生機器人', '雷斯特雷德機器人', '哈德森太太機器人', '麥考夫特機器人', '艾琳艾德勒機器人', '莫蘭上校機器人', '格雷格森機器人', '托比機器人', '威金斯機器人'];

// Helper: Get random bot name not taken in room
function getRandomBotName(room) {
  const existingNames = room.players.map(p => p.name.toLowerCase());
  const availableNames = BOT_NAMES.filter(name => !existingNames.includes(name.toLowerCase()));
  if (availableNames.length > 0) {
    return availableNames[Math.floor(Math.random() * availableNames.length)];
  }
  return `探員 AI-${Math.floor(Math.random() * 100)}`;
}

// Helper: Generate unique 4-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

// Helper: Fisher-Yates Shuffle
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Helper: Build the wire deck based on player count
function buildWireDeck(playerCount) {
  const successCount = playerCount; // 1 success wire per player
  const bombCount = 1;              // 1 bomb card in the entire game
  const totalCards = playerCount * 5;
  const safeCount = totalCards - successCount - bombCount;

  const deck = [];
  for (let i = 0; i < successCount; i++) deck.push('success');
  for (let i = 0; i < bombCount; i++) deck.push('bomb');
  for (let i = 0; i < safeCount; i++) deck.push('safe');

  return shuffle(deck);
}

// 9 and 10 players are not in the official rules; they follow its pattern
// (about 40% Moriarty, and with 9 one card of a 10-card set stays hidden)
const TIMEBOMB_MAX_PLAYERS = 10;

// Helper: Select role cards
function selectRoles(playerCount) {
  let roles = [];
  if (playerCount === 4) {
    roles = [true, true, true, false, false];
  } else if (playerCount === 5) {
    roles = [true, true, true, false, false];
  } else if (playerCount === 6) {
    roles = [true, true, true, true, false, false];
  } else if (playerCount === 7) {
    roles = [true, true, true, true, true, false, false, false];
  } else if (playerCount === 8) {
    roles = [true, true, true, true, true, false, false, false];
  } else if (playerCount === 9 || playerCount === 10) {
    roles = [true, true, true, true, true, true, false, false, false, false];
  }
  shuffle(roles);
  return roles.slice(0, playerCount);
}

// Helper: Sanitize room state to send to clients (hide secrets!)
function getSanitizedRoomState(room, socketId) {
  if (room.gameType === 'skull') {
    const sanitizedPlayers = room.players.map(p => {
      const isSelf = p.id === socketId;
      return {
        id: p.id,
        name: p.name,
        host: p.host,
        connected: p.connected,
        isBot: p.isBot || false,
        score: p.score || 0,
        passed: p.passed || false,
        eliminated: p.eliminated || false,
        readyToDeploy: p.readyToDeploy || false,
        playedCardsCount: p.playedCards ? p.playedCards.length : 0,
        playedCards: p.playedCards ? p.playedCards.map(c => ({
          revealed: c.revealed,
          type: c.revealed || room.gameEnded ? c.type : 'hidden'
        })) : [],
        remainingHandSize: p.cards ? p.cards.length : 0
      };
    });

    const me = room.players.find(p => p.id === socketId);

    return {
      roomCode: room.roomCode,
      gameType: room.gameType,
      gameStarted: room.gameStarted,
      gameEnded: room.gameEnded,
      winnerTeam: room.winnerTeam,
      round: room.round,
      roundPhase: room.roundPhase || 'placing',
      activePlayerId: room.activePlayerId,
      challengerId: room.challengerId,
      highestBid: room.highestBid || 0,
      revealedCardsCount: room.revealedCardsCount || 0,
      players: sanitizedPlayers,
      history: room.history,
      me: me ? {
        id: me.id,
        host: me.host || false,
        cards: me.cards || [],
        eliminated: me.eliminated || false,
        readyToDeploy: me.readyToDeploy || false,
        passed: me.passed || false
      } : null
    };
  }

  if (room.gameType === 'topten') {
    const sanitizedPlayers = room.players.map(p => {
      const isSelf = p.id === socketId;
      return {
        id: p.id,
        name: p.name,
        host: p.host,
        connected: p.connected,
        isBot: p.isBot || false,
        readyToDeploy: p.readyToDeploy || false,
        answerText: p.answerText || '',
        hasAnswered: p.hasAnswered || false,
        isRevealed: p.isRevealed || false,
        cardNumber: p.isRevealed || room.gameEnded || isSelf ? p.cardNumber : null
      };
    });

    const me = room.players.find(p => p.id === socketId);

    return {
      roomCode: room.roomCode,
      gameType: room.gameType,
      gameStarted: room.gameStarted,
      gameEnded: room.gameEnded,
      winnerTeam: room.winnerTeam,
      round: room.round,
      roundPhase: room.roundPhase || 'lobby',
      totalRounds: room.totalRounds || 5,
      currentRound: room.currentRound || 1,
      lives: room.lives !== undefined ? room.lives : 8,
      captainIndex: room.captainIndex || 0,
      currentTopic: room.currentTopic || null,
      players: sanitizedPlayers,
      revealedSequence: room.revealedSequence || [],
      history: room.history,
      me: me ? {
        id: me.id,
        host: me.host || false,
        cardNumber: me.cardNumber,
        answerText: me.answerText || '',
        hasAnswered: me.hasAnswered || false,
        isRevealed: me.isRevealed || false,
        readyToDeploy: me.readyToDeploy || false
      } : null
    };
  }

  if (isWhoamiGame(room)) {
    return getWhoamiRoomState(room, socketId);
  }

  if (room.gameType === 'undercover') {
    return getUndercoverRoomState(room, socketId);
  }

  if (room.gameType === 'mascarade') {
    return getMascaradeRoomState(room, socketId);
  }

  if (room.gameType === 'werewolf') {
    return getWerewolfRoomState(room, socketId);
  }

  if (room.gameType === 'avalon') {
    return getAvalonRoomState(room, socketId);
  }

  if (room.gameType === 'bloody99') {
    return getBloody99RoomState(room, socketId);
  }

  if (room.gameType === 'decrypto') {
    return getDecryptoRoomState(room, socketId);
  }

  const sanitizedPlayers = room.players.map(p => {
    const isSelf = p.id === socketId;
    return {
      id: p.id,
      name: p.name,
      host: p.host,
      connected: p.connected,
      readyToDeploy: p.readyToDeploy,
      readyToDeclare: p.readyToDeclare || false,
      roleRevealed: p.roleRevealed || false,
      role: (isSelf || room.gameEnded) ? p.role : null,
      isBot: p.isBot || false,
      successDeclared: p.successDeclared || 0,
      bombDeclared: p.bombDeclared || 0,
      cards: p.cards.map(c => ({
        revealed: c.revealed,
        type: c.revealed || room.gameEnded ? c.type : 'hidden'
      })),
      secretHand: isSelf && !p.readyToDeploy ? p.secretHand : null,
      initialHand: isSelf ? p.initialHand : null
    };
  });

  return {
    roomCode: room.roomCode,
    players: sanitizedPlayers,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    summaryRevealed: room.summaryRevealed || false,
    winnerTeam: room.winnerTeam,
    round: room.round,
    roundPhase: room.roundPhase || 'deploying',
    declarationTimer: room.declarationTimer || 0,
    cutsRemaining: room.cutsRemaining,
    cutterOwnerId: room.cutterOwnerId,
    history: room.history,
    successCablesTotal: room.successCablesTotal,
    successCablesCut: room.successCablesCut,
    safeWiresCut: room.safeWiresCut || 0,
    safeWiresTotal: room.safeWiresTotal || 0,
    lastCutPlayerId: room.lastCutPlayerId || null,
    lastCutCardIndex: room.lastCutCardIndex !== undefined ? room.lastCutCardIndex : null,
    boobyTrapCut: room.boobyTrapCut,
    allDeployed: room.players.every(p => p.readyToDeploy)
  };
}

// Helper: Broadcast room update to all players in the room
function broadcastRoomUpdate(room) {
  // Who is still looking at the last game's results (see restartGame / lobby_back)
  if (room.gameStarted) room.resultViewers = [];
  const viewers = (room.resultViewers || []).filter(id => room.players.some(p => p.id === id && p.connected));
  room.resultViewers = viewers;
  room.players.forEach(p => {
    if (p.connected && !p.isBot) {
      io.to(p.id).emit('roomUpdate', getSanitizedRoomState(room, p.id));
      io.to(p.id).emit('resultViewers', { ids: viewers });
    }
  });
}

// Helper: Add entry to history log
function addLog(room, type, text) {
  const logEntry = {
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    type,
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
  room.history.push(logEntry);
}

// ================= SESSION / RECONNECT =================
// Each browser tab sends a random token (socket.io auth) that survives page
// refreshes. When a socket connects with a token that owns a seat, the seat's
// old socket id is swapped for the new one everywhere in the room state, so
// game logic keyed by player id keeps working unchanged.

const LOBBY_RECONNECT_GRACE_MS = 20 * 1000;
const WHOAMI_TURN_RECONNECT_GRACE_MS = 60 * 1000;
const HOST_RECONNECT_GRACE_MS = 60 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

function getSessionToken(socket) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  return typeof token === 'string' && token.length >= 8 ? token : null;
}

// A tab can only hold one seat at a time
function claimSessionToken(socket, player) {
  const token = getSessionToken(socket);
  if (!token) return;
  for (const r of rooms.values()) {
    r.players.forEach(p => { if (p.token === token) p.token = null; });
  }
  player.token = token;
}

function replaceIdDeep(value, oldId, newId, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  // Only walk plain data; skip timers and other class instances
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (value[key] === oldId) value[key] = newId;
    else replaceIdDeep(value[key], oldId, newId, seen);
  }
}

function resumeSession(socket) {
  const token = getSessionToken(socket);
  const gameType = socket.handshake.auth && socket.handshake.auth.gameType;
  if (!token) return;

  for (const room of rooms.values()) {
    const player = room.players.find(p => p.token === token);
    if (!player || room.gameType !== gameType) continue;

    const oldId = player.id;
    replaceIdDeep(room, oldId, socket.id);
    player.connected = true;
    clearTimeout(player.disconnectTimer);
    clearTimeout(player.hostTransferTimer);
    player.disconnectTimer = null;
    player.hostTransferTimer = null;
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    socket.join(room.roomCode);

    // Same token still attached to an older socket (e.g. duplicated tab): drop it
    const staleSocket = io.sockets.sockets.get(oldId);
    if (staleSocket) staleSocket.disconnect(true);

    // Take over hosting only if the host is gone for good (not just mid-refresh)
    const currentHost = room.players.find(p => p.host);
    if (!currentHost || (!currentHost.connected && !currentHost.hostTransferTimer)) {
      if (currentHost) currentHost.host = false;
      player.host = true;
    }

    if (room.gameStarted) addLog(room, 'system', `🔌 ${player.name} 重新連線了。`);
    broadcastRoomUpdate(room);
    return;
  }
}

function deleteRoom(room) {
  if (rooms.get(room.roomCode) !== room) return;
  if (room.declarationIntervalId) clearInterval(room.declarationIntervalId);
  clearTimeout(room.cleanupTimer);
  clearTimeout(room.wwDayTimer);
  room.players.forEach(p => {
    clearTimeout(p.disconnectTimer);
    clearTimeout(p.hostTransferTimer);
  });
  rooms.delete(room.roomCode);
  console.log(`Room ${room.roomCode} deleted.`);
}

function removeLobbyPlayer(room, player) {
  const idx = room.players.indexOf(player);
  if (idx === -1) return;
  clearTimeout(player.disconnectTimer);
  room.players.splice(idx, 1);
  addLog(room, 'system', `${player.name} 離開了房間。`);

  if (room.players.every(p => p.isBot)) {
    deleteRoom(room);
    return;
  }
  if (player.host) {
    const nextHost = room.players.find(p => !p.isBot && p.connected) || room.players.find(p => !p.isBot);
    nextHost.host = true;
    addLog(room, 'system', `${nextHost.name} 現在是新的房主。`);
  }
  broadcastRoomUpdate(room);
}

function transferHost(room, player) {
  const nextHost = room.players.find(p => p.connected && !p.isBot && p !== player);
  if (!nextHost) return;
  nextHost.host = true;
  player.host = false;
  addLog(room, 'system', `${nextHost.name} 現在是新的房主。`);
}

function handlePlayerDeparture(room, player, permanent) {
  if (!player || (!player.connected && !permanent)) return;
  player.connected = false;
  if (permanent) player.token = null;

  if (!room.gameStarted) {
    if (permanent) {
      removeLobbyPlayer(room, player);
    } else {
      player.disconnectTimer = setTimeout(() => {
        if (!room.gameStarted && !player.connected) removeLobbyPlayer(room, player);
      }, LOBBY_RECONNECT_GRACE_MS);
      broadcastRoomUpdate(room);
    }
    return;
  }

  addLog(room, 'system', permanent ? `🚪 ${player.name} 離開了遊戲。` : `⚠️ ${player.name} 失去連接，等待重新連線...`);

  if (room.gameType === 'undercover' && permanent) {
    handleUndercoverDeparture(room, player);
  }
  if (room.gameType === 'mascarade' && permanent) {
    handleMascaradeDeparture(room, player);
  }
  if (room.gameType === 'werewolf' && permanent) {
    handleWerewolfDeparture(room, player);
  }
  if (room.gameType === 'avalon' && permanent) {
    handleAvalonDeparture(room, player);
  }
  if (room.gameType === 'bloody99' && permanent) {
    handleBloody99Departure(room, player);
  }
  if (room.gameType === 'decrypto' && permanent) {
    handleDecryptoDeparture(room, player);
  }

  if (isWhoamiGame(room)) {
    if (permanent) {
      handleWhoamiDisconnect(room, player);
      checkWhoamiProposal(room);
      const asker = room.players.find(p => p.id === room.activePlayerId);
      if (asker) resolveWhoamiGuess(room, asker);
    } else if (player.whoamiStatus === 'active') {
      // Give the asker a minute to come back before skipping their turn
      player.disconnectTimer = setTimeout(() => {
        if (player.connected || rooms.get(room.roomCode) !== room) return;
        handleWhoamiDisconnect(room, player);
        broadcastRoomUpdate(room);
      }, WHOAMI_TURN_RECONNECT_GRACE_MS);
    }
  }

  if (player.host) {
    if (permanent) {
      transferHost(room, player);
    } else {
      // A refresh shouldn't cost the host their role; hand it over only if they stay away
      player.hostTransferTimer = setTimeout(() => {
        player.hostTransferTimer = null;
        if (player.connected || !player.host || rooms.get(room.roomCode) !== room) return;
        transferHost(room, player);
        broadcastRoomUpdate(room);
      }, HOST_RECONNECT_GRACE_MS);
    }
  }

  const humans = room.players.filter(p => !p.isBot);
  if (humans.every(p => !p.connected)) {
    if (humans.every(p => !p.token)) {
      deleteRoom(room);
      return;
    }
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => deleteRoom(room), EMPTY_ROOM_TTL_MS);
  }
  broadcastRoomUpdate(room);
}

// Transition helpers for Declaration and Cutting phases
function startDeclarationPhase(room) {
  room.roundPhase = 'declaring';
  room.players.forEach(p => {
    p.readyToDeclare = false;
  });

  addLog(room, 'system', `第 ${room.round} 輪宣告階段開始！請向大家宣告你的手牌。`);
  
  // Staggered bot declarations
  triggerBotsDeclarations(room);

  // Check if bots are present
  const hasBots = room.players.some(p => p.isBot);
  if (hasBots) {
    const timerSeconds = 10 + Math.floor(Math.random() * 21); // 10 - 30 seconds
    room.declarationTimer = timerSeconds;
    addLog(room, 'system', `偵測到 AI 機器人參戰，本輪宣告限時：${timerSeconds} 秒。`);

    if (room.declarationIntervalId) {
      clearInterval(room.declarationIntervalId);
    }

    room.declarationIntervalId = setInterval(() => {
      room.declarationTimer--;
      if (room.declarationTimer <= 0) {
        clearInterval(room.declarationIntervalId);
        room.declarationIntervalId = null;
        startCuttingPhase(room);
      } else {
        broadcastRoomUpdate(room);
      }
    }, 1000);
  }

  broadcastRoomUpdate(room);
}

// Start cutting phase
function startCuttingPhase(room) {
  room.roundPhase = 'cutting';
  if (room.declarationIntervalId) {
    clearInterval(room.declarationIntervalId);
    room.declarationIntervalId = null;
  }
  addLog(room, 'system', `宣告階段結束！第 ${room.round} 輪剪線行動正式開始。`);
  triggerBotCutIfActive(room);
  broadcastRoomUpdate(room);
}

// Proceed to next round helper
function proceedToNextRound(room) {
  if (!room.gameStarted || room.gameEnded || room.roundPhase !== 'round_ending') return;

  const nextRound = room.round + 1;
  const unrevealedCards = [];
  room.players.forEach(p => {
    p.cards.forEach(c => {
      if (!c.revealed) {
        unrevealedCards.push(c.type);
      }
    });
    p.cards = [];
    p.readyToDeploy = false;
    p.readyToDeclare = false;
    p.successDeclared = 0;
    p.bombDeclared = 0;
  });

  room.deck = shuffle(unrevealedCards);
  const cardsPerPlayer = 5 - (nextRound - 1);
  room.players.forEach(p => {
    const hand = [];
    for (let i = 0; i < cardsPerPlayer; i++) {
      hand.push(room.deck.pop());
    }
    p.secretHand = hand;
    p.initialHand = [...hand];
  });

  room.round = nextRound;
  room.roundPhase = 'deploying';
  room.cutsRemaining = room.players.length;
  room.lastCutPlayerId = null;
  room.lastCutCardIndex = null;

  addLog(room, 'system', `第 ${nextRound} 輪開始！每位玩家獲得 ${cardsPerPlayer} 張牌。請部署引線繼續行動。`);
  triggerBotsAutoDeploy(room);
  broadcastRoomUpdate(room);
}

// Socket Connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  resumeSession(socket);

  // Event: Create Room
  socket.on('createRoom', ({ name, gameType }) => {
    if (!name || name.trim() === '') {
      socket.emit('errorMsg', '請輸入有效的名字。');
      return;
    }

    const code = generateRoomCode();
    const room = {
      roomCode: code,
      gameType: gameType || 'timebomb',
      players: [{
        id: socket.id,
        name: name.trim(),
        host: true,
        connected: true,
        readyToDeploy: false,
        readyToDeclare: false,
        roleRevealed: false,
        role: null,
        cards: [],
        secretHand: null,
        initialHand: null,
        isBot: false,
        successDeclared: 0,
        bombDeclared: 0
      }],
      gameStarted: false,
      gameEnded: false,
      winnerTeam: null,
      round: 1,
      roundPhase: 'deploying',
      declarationTimer: 0,
      declarationIntervalId: null,
      cutsRemaining: 0,
      cutterOwnerId: null,
      safeWiresCut: 0,
      safeWiresTotal: 0,
      lastCutPlayerId: null,
      lastCutCardIndex: null,
      history: [],
      deck: [],
      successCablesTotal: 0,
      successCablesCut: 0,
      boobyTrapCut: false
    };

    rooms.set(code, room);
    claimSessionToken(socket, room.players[0]);
    socket.join(code);
    
    addLog(room, 'system', `${name.trim()} 建立了遊戲房間 ${code}。`);
    socket.emit('roomCreated', code);
    broadcastRoomUpdate(room);
  });

  // Event: Join Room
  socket.on('joinRoom', ({ name, roomCode, gameType }) => {
    if (!name || name.trim() === '') {
      socket.emit('errorMsg', '請輸入有效的名字。');
      return;
    }
    if (!roomCode) {
      socket.emit('errorMsg', '請輸入房間代碼。');
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('errorMsg', '未找到該房間。');
      return;
    }

    if (gameType && room.gameType !== gameType) {
      socket.emit('errorMsg', '這個房號是其他桌遊的房間。');
      return;
    }

    if (room.gameStarted) {
      socket.emit('errorMsg', '該房間的遊戲已經開始。');
      return;
    }

    const maxPlayers = room.gameType === 'undercover' ? UNDERCOVER_MAX_PLAYERS
      : room.gameType === 'mascarade' ? MASCARADE_MAX_PLAYERS
      : room.gameType === 'werewolf' ? WEREWOLF_MAX_PLAYERS
      : room.gameType === 'avalon' ? AVALON_MAX_PLAYERS
      : room.gameType === 'bloody99' ? B99_MAX_PLAYERS
      : room.gameType === 'decrypto' ? DECRYPTO_MAX_PLAYERS
      : isWhoamiGame(room) ? WHOAMI_MAX_PLAYERS
      : room.gameType === 'timebomb' ? TIMEBOMB_MAX_PLAYERS : 8;
    if (room.players.length >= maxPlayers) {
      socket.emit('errorMsg', `房間人數已滿（最多${maxPlayers}人）。`);
      return;
    }

    const nameExists = room.players.some(p => p.name.toLowerCase() === name.trim().toLowerCase());
    if (nameExists) {
      socket.emit('errorMsg', '該名字在房間中已被佔用。');
      return;
    }

    room.players.push({
      id: socket.id,
      name: name.trim(),
      host: false,
      connected: true,
      readyToDeploy: false,
      readyToDeclare: false,
      roleRevealed: false,
      role: null,
      cards: [],
      secretHand: null,
      initialHand: null,
      isBot: false,
      successDeclared: 0,
      bombDeclared: 0
    });
    claimSessionToken(socket, room.players[room.players.length - 1]);

    socket.join(code);
    addLog(room, 'system', `${name.trim()} 加入了房間。`);
    broadcastRoomUpdate(room);
  });

  // Event: Add AI Bot
  socket.on('addBot', () => {
    let room = getRoomBySocket(socket);
    if (!room || room.gameStarted) return;
    if (room.players.length >= (room.gameType === 'timebomb' ? TIMEBOMB_MAX_PLAYERS : 8)) return;
    if (isWhoamiGame(room)) {
      socket.emit('errorMsg', '名人猜猜我是誰需要真人回答，無法加入 AI 機器人。');
      return;
    }
    if (room.gameType === 'undercover') {
      socket.emit('errorMsg', '誰是臥底需要真人描述，無法加入 AI 機器人。');
      return;
    }
    if (room.gameType === 'mascarade') {
      socket.emit('errorMsg', '化裝舞會需要真人一起玩，無法加入 AI 機器人。');
      return;
    }
    if (room.gameType === 'werewolf') {
      socket.emit('errorMsg', '一夜終極狼人需要真人一起玩，無法加入 AI 機器人。');
      return;
    }
    if (room.gameType === 'avalon') {
      socket.emit('errorMsg', '阿瓦隆需要真人一起玩，無法加入 AI 機器人。');
      return;
    }
    if (room.gameType === 'bloody99') {
      socket.emit('errorMsg', '血腥99需要真人一起玩，無法加入 AI 機器人。');
      return;
    }
    if (room.gameType === 'decrypto') {
      socket.emit('errorMsg', '截碼戰需要真人一起玩，無法加入 AI 機器人。');
      return;
    }
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) return;

    const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
    const botName = getRandomBotName(room);

    room.players.push({
      id: botId,
      name: botName,
      host: false,
      connected: true,
      readyToDeploy: false,
      readyToDeclare: false,
      roleRevealed: true,
      role: null,
      cards: [],
      secretHand: null,
      initialHand: null,
      isBot: true,
      successDeclared: 0,
      bombDeclared: 0
    });

    addLog(room, 'system', `${botName} (AI 機器人) 已加入房間。`);
    broadcastRoomUpdate(room);
  });

  // Event: Kick Player (called by Host in waiting room lobby)
  socket.on('kickPlayer', ({ targetId }) => {
    let room = getRoomBySocket(socket);

    if (!room) {
      socket.emit('errorMsg', '房間未找到。');
      return;
    }

    if (room.gameStarted) {
      socket.emit('errorMsg', '遊戲已經開始，無法剔除成員。');
      return;
    }

    const hostPlayer = room.players.find(p => p.id === socket.id);
    if (!hostPlayer || !hostPlayer.host) {
      socket.emit('errorMsg', '只有房主才能剔除成員。');
      return;
    }

    const targetIdx = room.players.findIndex(p => p.id === targetId);
    if (targetIdx === -1) {
      socket.emit('errorMsg', '未找到該成員。');
      return;
    }

    const targetPlayer = room.players[targetIdx];
    if (targetPlayer.id === socket.id) {
      socket.emit('errorMsg', '房主不能剔除自己。');
      return;
    }

    // Remove from player list
    room.players.splice(targetIdx, 1);

    if (targetPlayer.isBot) {
      addLog(room, 'system', `${targetPlayer.name} (AI 機器人) 已被房主剔除出房間。`);
    } else {
      addLog(room, 'system', `${targetPlayer.name} 已被房主剔除出房間。`);
      io.to(targetPlayer.id).emit('kicked');
    }

    broadcastRoomUpdate(room);
  });

  // Event: Start Game
  socket.on('startGame', () => {
    let room = getRoomBySocket(socket);

    if (!room) {
      socket.emit('errorMsg', '房間未找到。');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) {
      socket.emit('errorMsg', '只有房主才能開始遊戲。');
      return;
    }

    const playerCount = room.players.length;
    if (room.gameType === 'timebomb') {
      if (playerCount < 4 || playerCount > TIMEBOMB_MAX_PLAYERS) {
        socket.emit('errorMsg', `遊戲需要 4 到 ${TIMEBOMB_MAX_PLAYERS} 名玩家/機器人才能開始。`);
        return;
      }
    } else if (room.gameType === 'skull') {
      if (playerCount < 2 || playerCount > 8) {
        socket.emit('errorMsg', '遊戲需要 2 到 8 名玩家/機器人才能開始。');
        return;
      }
    } else if (room.gameType === 'topten') {
      if (playerCount < 4 || playerCount > 8) {
        socket.emit('errorMsg', '遊戲需要 4 到 8 名玩家/機器人才能開始。');
        return;
      }
    } else if (isWhoamiGame(room)) {
      if (playerCount < 2 || playerCount > WHOAMI_MAX_PLAYERS) {
        socket.emit('errorMsg', `遊戲需要 2 到 ${WHOAMI_MAX_PLAYERS} 名玩家才能開始。`);
        return;
      }
    }

    if (isWhoamiGame(room)) {
      startWhoamiGame(room);
      return;
    }

    if (room.gameType === 'undercover') {
      const setupError = undercoverSetupError(getUndercoverSetup(room));
      if (setupError) {
        socket.emit('errorMsg', setupError);
        return;
      }
      startUndercoverGame(room);
      return;
    }

    if (room.gameType === 'mascarade') {
      const setupError = mascaradeSetupError(getMascaradeSetup(room));
      if (setupError) {
        socket.emit('errorMsg', setupError);
        return;
      }
      startMascaradeGame(room);
      return;
    }

    if (room.gameType === 'werewolf') {
      const setupError = werewolfSetupError(getWerewolfSetup(room));
      if (setupError) {
        socket.emit('errorMsg', setupError);
        return;
      }
      startWerewolfGame(room);
      return;
    }

    if (room.gameType === 'avalon') {
      const setupError = avalonSetupError(getAvalonSetup(room));
      if (setupError) {
        socket.emit('errorMsg', setupError);
        return;
      }
      startAvalonGame(room);
      broadcastRoomUpdate(room);
      return;
    }

    if (room.gameType === 'bloody99') {
      const setupError = bloody99SetupError(getBloody99Setup(room));
      if (setupError) {
        socket.emit('errorMsg', setupError);
        return;
      }
      startBloody99Game(room);
      broadcastRoomUpdate(room);
      return;
    }

    if (room.gameType === 'decrypto') {
      const setupError = decryptoSetupError(room);
      if (setupError) {
        socket.emit('errorMsg', setupError);
        return;
      }
      startDecryptoGame(room);
      broadcastRoomUpdate(room);
      return;
    }

    if (room.gameType === 'skull') {
      room.gameStarted = true;
      room.gameEnded = false;
      room.winnerTeam = null;
      room.round = 1;
      room.roundPhase = 'placing';
      room.challengerId = null;
      room.highestBid = 0;
      room.revealedCardsCount = 0;
      room.history = [];

      room.players.forEach(p => {
        p.cards = ['flower', 'flower', 'flower', 'skull'];
        p.playedCards = [];
        p.score = 0;
        p.passed = false;
        p.eliminated = false;
        p.readyToDeploy = true;
      });

      const randomPlayer = room.players[Math.floor(Math.random() * playerCount)];
      room.activePlayerId = randomPlayer.id;

      addLog(room, 'system', '💀 骷髏牌對局開始！每位探員分發 3張鮮花牌 與 1張骷髏牌。');
      addLog(room, 'system', `起始玩家為：${randomPlayer.name}。出牌階段開始！`);
      broadcastRoomUpdate(room);
      triggerSkullBotAction(room);
      return;
    }

    if (room.gameType === 'topten') {
      room.gameStarted = true;
      room.gameEnded = false;
      room.winnerTeam = null;
      room.round = 1;
      room.currentRound = 1;
      room.totalRounds = 5;
      room.lives = 8;
      room.captainIndex = 0;
      room.revealedSequence = [];
      room.history = [];
      room.usedTopics = [];
      room.currentTopic = drawTopTenTopic(room);

      startTopTenRound(room);
      return;
    }

    room.gameStarted = true;
    room.gameEnded = false;
    room.winnerTeam = null;
    room.round = 1;
    room.roundPhase = 'deploying';
    room.cutsRemaining = playerCount;
    room.successCablesTotal = playerCount;
    room.successCablesCut = 0;
    room.safeWiresCut = 0;
    room.safeWiresTotal = (playerCount * 4) - 1;
    room.lastCutPlayerId = null;
    room.lastCutCardIndex = null;
    room.boobyTrapCut = false;
    room.history = [];

    const roles = selectRoles(playerCount);
    // Double Randomization: shuffle player index mapping to eliminate any seating or join-order bias
    const randomizedIndices = shuffle(Array.from({ length: playerCount }, (_, i) => i));
    room.players.forEach((p, idx) => {
      const assignedRoleIdx = randomizedIndices[idx];
      p.role = roles[assignedRoleIdx] ? 'Sherlock' : 'Moriarty';
      p.readyToDeploy = false;
      p.readyToDeclare = false;
      p.roleRevealed = p.isBot ? true : false;
      p.successDeclared = 0;
      p.bombDeclared = 0;
    });

    room.deck = buildWireDeck(playerCount);

    room.players.forEach(p => {
      const hand = [];
      for (let i = 0; i < 5; i++) {
        hand.push(room.deck.pop());
      }
      p.secretHand = hand;
      p.initialHand = [...hand];
      p.cards = [];
    });

    const randomPlayer = room.players[Math.floor(Math.random() * playerCount)];
    room.cutterOwnerId = randomPlayer.id;

    addLog(room, 'system', '遊戲正式開始！身份已秘密分配。');
    addLog(room, 'system', `第 1 輪：每位玩家收到 5 張引線牌。請開啟「檢查引線」查看並部署。`);
    addLog(room, 'system', `${randomPlayer.name} 獲得初始剪線鉗。`);

    broadcastRoomUpdate(room);
    triggerBotsAutoDeploy(room);
  });

  // Event: Confirm Role Reveal (ceremony button)
  socket.on('confirmRoleReveal', () => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.roleRevealed) return;

    player.roleRevealed = true;
    broadcastRoomUpdate(room);
  });

  // Event: Deploy Cards
  socket.on('deployCards', () => {
    let room = getRoomBySocket(socket);

    if (!room || !room.gameStarted || room.gameEnded) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.readyToDeploy) return;

    const shuffledHand = shuffle([...player.secretHand]);
    player.cards = shuffledHand.map(type => ({
      type,
      revealed: false
    }));

    player.secretHand = null;
    player.readyToDeploy = true;

    addLog(room, 'system', `${player.name} 已洗牌並背面朝上部署了引線。`);

    const allDeployed = room.players.every(p => p.readyToDeploy);
    if (allDeployed) {
      startDeclarationPhase(room);
    } else {
      broadcastRoomUpdate(room);
    }
  });

  // Event: Declare Hand (adjust numbers)
  socket.on('declareHand', ({ successDeclared }) => {
    let room = getRoomBySocket(socket);

    if (!room || !room.gameStarted || room.gameEnded || room.roundPhase !== 'declaring') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.readyToDeclare) return;

    const maxCards = 5 - (room.round - 1);
    const sDec = Math.max(0, parseInt(successDeclared) || 0);

    if (sDec > maxCards) {
      socket.emit('errorMsg', `宣告數量不能超過本輪手牌數（${maxCards}張）。`);
      return;
    }

    player.successDeclared = sDec;
    player.bombDeclared = 0;
    broadcastRoomUpdate(room);
  });

  // Event: Confirm Declaration (ready to start cutting)
  socket.on('confirmDeclaration', () => {
    let room = getRoomBySocket(socket);

    if (!room || !room.gameStarted || room.gameEnded || room.roundPhase !== 'declaring') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.readyToDeclare) return;

    player.readyToDeclare = true;
    addLog(room, 'system', `${player.name} 已確認手牌宣告。`);

    // Check if all humans are ready to declare
    const allHumansReady = room.players.filter(p => !p.isBot).every(p => p.readyToDeclare);
    if (allHumansReady) {
      startCuttingPhase(room);
    } else {
      broadcastRoomUpdate(room);
    }
  });

  // Event: Make Cut
  socket.on('makeCut', ({ targetPlayerId, cardIndex }) => {
    let room = getRoomBySocket(socket);

    if (!room || !room.gameStarted || room.gameEnded) return;

    if (room.roundPhase !== 'cutting') {
      socket.emit('errorMsg', '宣告階段尚未結束，請先完成宣告！');
      return;
    }

    if (room.cutterOwnerId !== socket.id) {
      socket.emit('errorMsg', '你目前沒有持有剪線鉗。');
      return;
    }

    if (targetPlayerId === socket.id) {
      socket.emit('errorMsg', '你不能剪自己的引線牌。');
      return;
    }

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) {
      socket.emit('errorMsg', '目標探員未找到。');
      return;
    }

    if (cardIndex < 0 || cardIndex >= targetPlayer.cards.length) {
      socket.emit('errorMsg', '無效的卡牌索引。');
      return;
    }

    const card = targetPlayer.cards[cardIndex];
    if (card.revealed) {
      socket.emit('errorMsg', '這根引線已經被剪斷了。');
      return;
    }

    // Cut action
    card.revealed = true;
    room.cutsRemaining--;
    
    room.lastCutPlayerId = targetPlayer.id;
    room.lastCutCardIndex = cardIndex;

    const cutterOwner = room.players.find(p => p.id === socket.id);
    room.cutterOwnerId = targetPlayerId;

    const cardTypeName = card.type === 'success' ? '成功引線 ✅' : card.type === 'bomb' ? '引爆裝置 💥' : '安全引線 ❌';
    addLog(room, 'cut', `${cutterOwner.name} 剪斷了 ${targetPlayer.name} 的引線，發現了：${cardTypeName}。`);

    if (card.type === 'success') {
      room.successCablesCut++;
      if (room.successCablesCut === room.successCablesTotal) {
        room.gameEnded = true;
        room.summaryRevealed = false;
        room.winnerTeam = 'Sherlock';
        if (room.declarationIntervalId) {
          clearInterval(room.declarationIntervalId);
          room.declarationIntervalId = null;
        }
        addLog(room, 'system', '🏆 大偵探陣營獲勝！所有成功引線均已被剪斷，炸彈已成功解除！');
        broadcastRoomUpdate(room);
        return;
      }
    } else if (card.type === 'bomb') {
      room.boobyTrapCut = true;
      room.gameEnded = true;
      room.summaryRevealed = false;
      room.winnerTeam = 'Moriarty';
      if (room.declarationIntervalId) {
        clearInterval(room.declarationIntervalId);
        room.declarationIntervalId = null;
      }
      addLog(room, 'system', '💥 莫里亞蒂陣營獲勝！引爆裝置被剪斷！炸彈爆炸了！');
      broadcastRoomUpdate(room);
      return;
    } else if (card.type === 'safe') {
      room.safeWiresCut++;
    }

    if (room.cutsRemaining === 0) {
      if (room.round >= 4) {
        room.gameEnded = true;
        room.summaryRevealed = false;
        room.winnerTeam = 'Moriarty';
        if (room.declarationIntervalId) {
          clearInterval(room.declarationIntervalId);
          room.declarationIntervalId = null;
        }
        addLog(room, 'system', '⏳ 莫里亞蒂陣營獲勝！時間耗盡（4輪結束），倫敦化為廢墟！');
        broadcastRoomUpdate(room);
      } else {
        room.roundPhase = 'round_ending';
        addLog(room, 'system', `本輪剪線已耗盡！請檢查翻牌結果。等待房主點擊開啟下一輪任務...`);
        broadcastRoomUpdate(room);
      }
    } else {
      addLog(room, 'system', `${targetPlayer.name} 現在持有了剪線鉗。本輪還剩 ${room.cutsRemaining} 次剪線機會。`);
      triggerBotCutIfActive(room);
      broadcastRoomUpdate(room);
    }
  });

  // Event: Start Next Round (called by Host during round_ending phase)
  socket.on('startNextRound', () => {
    let room = getRoomBySocket(socket);

    if (!room || !room.gameStarted || room.gameEnded || room.roundPhase !== 'round_ending') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) {
      socket.emit('errorMsg', '只有房主才能點擊開始下一輪。');
      return;
    }

    proceedToNextRound(room);
  });

  // Event: Reveal Game Summary (called by Host to pop up modal for everyone)
  socket.on('revealSummary', () => {
    let room = getRoomBySocket(socket);

    if (!room || !room.gameEnded || room.summaryRevealed) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) {
      socket.emit('errorMsg', '只有房主才能點擊顯示結算報告。');
      return;
    }

    room.summaryRevealed = true;
    addLog(room, 'system', '房主揭曉了最終任務結算報告。');
    broadcastRoomUpdate(room);
  });

  // Event: Restart Game (called by Host to return to waiting room)
  socket.on('restartGame', () => {
    let room = getRoomBySocket(socket);

    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    // Mid-game only the host can reset; once the game is over anyone can bring everyone back to the lobby
    if (!player || (!player.host && !room.gameEnded)) return;
    // After a finished game, everyone else may keep looking at the results;
    // they come back to the lobby on their own (lobby_back)
    const finished = room.gameEnded;
    room.resultViewers = finished ? room.players.filter(p => p.id !== player.id && !p.isBot).map(p => p.id) : [];

    // Reset room state
    room.gameStarted = false;
    room.gameEnded = false;
    room.summaryRevealed = false;
    room.winnerTeam = null;
    room.round = 1;
    room.roundPhase = 'deploying';
    room.cutsRemaining = 0;
    room.cutterOwnerId = null;
    room.safeWiresCut = 0;
    room.safeWiresTotal = 0;
    room.lastCutPlayerId = null;
    room.lastCutCardIndex = null;
    room.boobyTrapCut = false;
    room.history = [];
    if (room.declarationIntervalId) {
      clearInterval(room.declarationIntervalId);
      room.declarationIntervalId = null;
    }

    // Reset players
    room.players.forEach(p => {
      p.readyToDeploy = false;
      p.readyToDeclare = false;
      p.roleRevealed = p.isBot ? true : false;
      p.role = null;
      p.cards = [];
      p.secretHand = null;
      p.initialHand = null;
      p.successDeclared = 0;
      p.bombDeclared = 0;
      
      // Skull properties reset
      p.playedCards = [];
      p.score = 0;
      p.passed = false;
      p.eliminated = false;
    });

    if (isWhoamiGame(room)) {
      resetWhoamiRoom(room);
    }
    if (room.gameType === 'undercover') {
      resetUndercoverRoom(room);
    }
    if (room.gameType === 'mascarade') {
      resetMascaradeRoom(room);
    }
    if (room.gameType === 'werewolf') {
      resetWerewolfRoom(room);
    }
    if (room.gameType === 'avalon') {
      resetAvalonRoom(room);
    }
    if (room.gameType === 'bloody99') {
      resetBloody99Room(room);
    }
    if (room.gameType === 'decrypto') {
      resetDecryptoRoom(room);
    }

    addLog(room, 'system', finished ? `🏠 ${player.name} 回到大廳了，其他人可以看完結果再回來。` : '房主重設了對局，返回候戰室。');
    broadcastRoomUpdate(room);
  });

  // Event: Back to the lobby after looking at the results (the room was already reset)
  socket.on('lobby_back', () => {
    const room = getRoomBySocket(socket);
    if (!room || !room.resultViewers || !room.resultViewers.includes(socket.id)) return;
    room.resultViewers = room.resultViewers.filter(id => id !== socket.id);
    broadcastRoomUpdate(room);
  });

  // Event: TopTen Submit Answer
  socket.on('topten_submitAnswer', ({ answerText }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;

    if (room.roundPhase !== 'answering') {
      socket.emit('errorMsg', '目前不是回答階段。');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.hasAnswered) return;

    player.answerText = answerText.trim();
    player.hasAnswered = true;
    addLog(room, 'system', `✍️ ${player.name} 已經提交了回答。`);

    const everyoneAnswered = room.players.every(p => p.hasAnswered);
    if (everyoneAnswered) {
      room.roundPhase = 'sorting';
      room.revealedSequence = [];
      const captain = room.players[room.captainIndex];
      addLog(room, 'system', `🔊 所有探員都已提交答案！進入【隊長排序階段】。`);
      addLog(room, 'system', `請隊長【${captain.name}】點擊玩家卡牌，由小到大逐一翻開秘密數字。`);
    }

    broadcastRoomUpdate(room);
  });

  // Event: TopTen Reveal Player Card (only Captain can trigger)
  socket.on('topten_revealPlayer', ({ targetPlayerId }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;

    if (room.roundPhase !== 'sorting') {
      socket.emit('errorMsg', '目前不是翻牌排序階段。');
      return;
    }

    const captain = room.players[room.captainIndex];
    if (captain.id !== socket.id) {
      socket.emit('errorMsg', '只有當前隊長才能點擊翻牌！');
      return;
    }

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || targetPlayer.isRevealed) return;

    targetPlayer.isRevealed = true;
    
    // Check ordering rules
    const val = targetPlayer.cardNumber;
    let sequenceBroke = false;
    
    if (room.revealedSequence.length > 0) {
      const prevVal = room.revealedSequence[room.revealedSequence.length - 1];
      if (val < prevVal) {
        sequenceBroke = true;
      }
    }
    
    room.revealedSequence.push(val);

    if (sequenceBroke) {
      addLog(room, 'system', `💥 翻開了 ${targetPlayer.name} 的數字【${val}】！糟糕，數字比上一張【${room.revealedSequence[room.revealedSequence.length - 2]}】還要小，發生數字倒退！`);
    } else {
      addLog(room, 'system', `🔍 翻開了 ${targetPlayer.name} 的數字【${val}】！順序正確，安全過關。`);
    }

    // Check if everyone is revealed
    const everyoneRevealed = room.players.every(p => p.isRevealed);
    if (everyoneRevealed) {
      room.roundPhase = 'revealing_complete';
      room.players.forEach(p => p.readyToDeploy = false);
      addLog(room, 'system', `🏁 本回合所有數字皆已揭曉！`);
      triggerTopTenBotsReady(room);
    }

    broadcastRoomUpdate(room);
  });

  // Event: TopTen Next Round
  socket.on('topten_nextRound', () => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;

    if (room.roundPhase !== 'round_result') {
      socket.emit('errorMsg', '當前不能進入下一回合。');
      return;
    }

    // Verify if host or captain is triggerer
    const player = room.players.find(p => p.id === socket.id);
    if (!player || (!player.host && room.players[room.captainIndex].id !== socket.id)) {
      socket.emit('errorMsg', '只有房主或當前隊長可以開啟下一回合。');
      return;
    }

    room.currentRound++;
    // Rotate captain to the next player (cyclic)
    room.captainIndex = (room.captainIndex + 1) % room.players.length;
    room.currentTopic = drawTopTenTopic(room);
    startTopTenRound(room);
  });

  // Event: TopTen Ready for Next Round
  socket.on('topten_readyToDeploy', () => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.readyToDeploy) return;

    player.readyToDeploy = true;
    addLog(room, 'system', `🆗 ${player.name} 已宣告就緒。`);

    const everyoneReady = room.players.every(p => p.readyToDeploy);
    if (everyoneReady) {
      if (room.currentRound === room.totalRounds) {
        room.gameEnded = true;
        room.winnerTeam = 'Sherlock';
        room.roundPhase = 'game_over';
        addLog(room, 'system', `🏆 恭喜通關！完成了全部 5 個回合的考驗，贏得了完美的默契大勝利！`);
      } else {
        room.roundPhase = 'round_result';
        addLog(room, 'system', `📢 全員已就緒，本回合結算完成！請隊長或房主開啟下一回合。`);
      }
    }

    broadcastRoomUpdate(room);
  });

  // Event: TopTen Skip Topic (only Host can trigger during answering phase)
  socket.on('topten_skipTopic', () => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;

    if (room.roundPhase !== 'answering') {
      socket.emit('errorMsg', '只有在回答階段才能更換題目！');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) {
      socket.emit('errorMsg', '只有房主（工坊主）才能更換題目！');
      return;
    }

    // Draw new topic
    room.currentTopic = drawTopTenTopic(room);
    addLog(room, 'system', `🔄 房主更換了題目！`);
    addLog(room, 'system', `新題目為：『${room.currentTopic.question}』`);
    addLog(room, 'system', `（數字 1 代表：『${room.currentTopic.minDescription}』 ➔ 數字 10 代表：『${room.currentTopic.maxDescription}』）`);

    // Reset player answer statuses so they can answer the new topic
    room.players.forEach(p => {
      p.answerText = '';
      p.hasAnswered = false;
    });

    broadcastRoomUpdate(room);

    // Retrigger bot answering loop for the new topic!
    triggerTopTenBotAction(room);
  });

  // Event: TopTen Custom Topic (only Captain can trigger during answering phase)
  socket.on('topten_setCustomTopic', ({ question, minDescription, maxDescription }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;

    if (room.roundPhase !== 'answering') {
      socket.emit('errorMsg', '只有在回答階段才能自訂題目！');
      return;
    }

    const captain = room.players[room.captainIndex];
    if (!captain || captain.id !== socket.id) {
      socket.emit('errorMsg', '只有當前隊長才能自訂題目！');
      return;
    }

    const q = (question || '').trim();
    const minD = (minDescription || '').trim();
    const maxD = (maxDescription || '').trim();

    if (!q || !minD || !maxD) {
      socket.emit('errorMsg', '自訂題目與刻度描述不能為空！');
      return;
    }

    room.currentTopic = {
      id: 'custom_' + Date.now(),
      question: q,
      minDescription: minD,
      maxDescription: maxD
    };

    addLog(room, 'system', `✍️ 隊長 ${captain.name} 手動自訂了新題目：『${q}』！`);
    addLog(room, 'system', `（數字 1 代表：『${minD}』 ➔ 數字 10 代表：『${maxD}』）`);

    // Reset player answer statuses so they can answer the new topic
    room.players.forEach(p => {
      p.answerText = '';
      p.hasAnswered = false;
    });

    broadcastRoomUpdate(room);

    // Retrigger bot answering loop for the new topic!
    triggerTopTenBotAction(room);
  });

  // Event: Leave room on purpose (exit buttons) — no reconnect grace period
  socket.on('leaveRoom', (ack) => {
    const room = getRoomBySocket(socket);
    if (room) {
      socket.leave(room.roomCode);
      handlePlayerDeparture(room, room.players.find(p => p.id === socket.id), true);
    }
    if (typeof ack === 'function') ack();
  });

  // Event: Disconnect (refresh, phone lock, network drop) — seat is kept for reconnecting
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const room = getRoomBySocket(socket);
    if (!room) return;
    handlePlayerDeparture(room, room.players.find(p => p.id === socket.id), false);
  });
});

// ================= BOT ENGINE LOGIC =================

function triggerBotsAutoDeploy(room) {
  room.players.forEach(p => {
    if (p.isBot && !p.readyToDeploy) {
      setTimeout(() => {
        if (!room.gameStarted || room.gameEnded) return;

        const shuffledHand = shuffle([...p.secretHand]);
        p.cards = shuffledHand.map(type => ({
          type,
          revealed: false
        }));

        p.secretHand = null;
        p.readyToDeploy = true;

        addLog(room, 'system', `${p.name} 已洗牌並背面朝上部署了引線。`);

        const allDeployed = room.players.every(pl => pl.readyToDeploy);
        if (allDeployed) {
          startDeclarationPhase(room);
        }

        broadcastRoomUpdate(room);
      }, 1000 + Math.random() * 1500);
    }
  });
}

function triggerBotsDeclarations(room) {
  room.players.forEach(p => {
    if (p.isBot) {
      setTimeout(() => {
        if (!room.gameStarted || room.gameEnded || room.roundPhase !== 'declaring') return;

        const successCount = p.cards.filter(c => c.type === 'success').length;
        const bombCount = p.cards.filter(c => c.type === 'bomb').length;
        
        let sDec = 0;

        if (p.role === 'Sherlock') {
          sDec = successCount;
        } else {
          // Moriarty bot bluffing logic
          if (bombCount > 0) {
            sDec = Math.random() > 0.5 ? 1 : 2;
          } else if (successCount > 0) {
            sDec = 0;
          } else {
            sDec = Math.random() > 0.5 ? 1 : 0;
          }
        }

        const maxCards = 5 - (room.round - 1);
        if (sDec > maxCards) {
          sDec = maxCards;
        }

        p.successDeclared = sDec;
        p.bombDeclared = 0;
        p.readyToDeclare = true; // Bot is ready

        addLog(room, 'system', `${p.name} 宣告手牌含有成功引線：✅ ${sDec}`);
        broadcastRoomUpdate(room);
      }, 1000 + Math.random() * 2000);
    }
  });
}

function triggerBotCutIfActive(room) {
  const currentCutter = room.players.find(p => p.id === room.cutterOwnerId);
  if (currentCutter && currentCutter.isBot && room.gameStarted && !room.gameEnded && room.roundPhase === 'cutting') {
    scheduleBotCut(room);
  }
}

function scheduleBotCut(room) {
  setTimeout(() => {
    if (!room.gameStarted || room.gameEnded || room.roundPhase !== 'cutting') return;

    const bot = room.players.find(p => p.id === room.cutterOwnerId);
    if (!bot || !bot.isBot) return;

    const validTargets = [];
    room.players.forEach(p => {
      if (p.id !== bot.id) {
        p.cards.forEach((c, idx) => {
          if (!c.revealed) {
            validTargets.push({ targetPlayer: p, cardIndex: idx });
          }
        });
      }
    });

    if (validTargets.length === 0) return;

    let selectedTarget = null;
    if (bot.role === 'Sherlock') {
      selectedTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
    } else {
      selectedTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
    }

    const { targetPlayer, cardIndex } = selectedTarget;
    const card = targetPlayer.cards[cardIndex];

    card.revealed = true;
    room.cutsRemaining--;
    
    room.lastCutPlayerId = targetPlayer.id;
    room.lastCutCardIndex = cardIndex;

    room.cutterOwnerId = targetPlayer.id;

    const cardTypeName = card.type === 'success' ? '成功引線 ✅' : card.type === 'bomb' ? '引爆裝置 💥' : '安全引線 ❌';
    addLog(room, 'cut', `${bot.name} 剪斷了 ${targetPlayer.name} 的引線，發現了：${cardTypeName}。`);

    if (card.type === 'success') {
      room.successCablesCut++;
      if (room.successCablesCut === room.successCablesTotal) {
        room.gameEnded = true;
        room.winnerTeam = 'Sherlock';
        if (room.declarationIntervalId) {
          clearInterval(room.declarationIntervalId);
          room.declarationIntervalId = null;
        }
        addLog(room, 'system', '🏆 大偵探陣營獲勝！所有成功引線均已被剪斷，炸彈已成功解除！');
        broadcastRoomUpdate(room);
        return;
      }
    } else if (card.type === 'bomb') {
      room.boobyTrapCut = true;
      room.gameEnded = true;
      room.winnerTeam = 'Moriarty';
      if (room.declarationIntervalId) {
        clearInterval(room.declarationIntervalId);
        room.declarationIntervalId = null;
      }
      addLog(room, 'system', '💥 莫里亞蒂陣營獲勝！引爆裝置被剪斷！炸彈爆炸了！');
      broadcastRoomUpdate(room);
      return;
    } else if (card.type === 'safe') {
      room.safeWiresCut++;
    }

    if (room.cutsRemaining === 0) {
      if (room.round >= 4) {
        room.gameEnded = true;
        room.winnerTeam = 'Moriarty';
        if (room.declarationIntervalId) {
          clearInterval(room.declarationIntervalId);
          room.declarationIntervalId = null;
        }
        addLog(room, 'system', '⏳ 莫里亞蒂陣營獲勝！時間耗盡（4輪結束），倫敦化為廢墟！');
        broadcastRoomUpdate(room);
      } else {
        room.roundPhase = 'round_ending';
        addLog(room, 'system', `本輪剪線已耗盡！請檢查翻牌結果。等待房主點擊開啟下一輪任務...`);
        broadcastRoomUpdate(room);
      }
    } else {
      addLog(room, 'system', `${targetPlayer.name} 現在持有了剪線鉗。本輪還剩 ${room.cutsRemaining} 次剪線機會。`);
      triggerBotCutIfActive(room);
      broadcastRoomUpdate(room);
    }
  }, 2500 + Math.random() * 1500);
}

// ==========================================
// SKULL (骷髏牌) GAME LOGIC EVENT HANDLERS
// ==========================================

io.on('connection', (socket) => {
  // Event: Skull Place Card
  socket.on('skull_placeCard', ({ cardType }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;

    if (room.roundPhase !== 'placing') {
      socket.emit('errorMsg', '當前不是出牌階段。');
      return;
    }

    if (room.activePlayerId !== socket.id) {
      socket.emit('errorMsg', '還沒有輪到你的回合。');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;

    const cardIndex = player.cards.indexOf(cardType);
    if (cardIndex === -1) {
      socket.emit('errorMsg', `你的手牌中沒有：${cardType === 'flower' ? '🌸 鮮花牌' : '💀 骷髏牌'}。`);
      return;
    }

    // Place card
    player.cards.splice(cardIndex, 1);
    player.playedCards.push({ type: cardType, revealed: false });
    
    addLog(room, 'system', `${player.name} 秘密放置了一張卡牌到其牌堆。`);

    // Advance turn
    advanceSkullTurn(room);
  });

  // Event: Skull Bid (challenge)
  socket.on('skull_bid', ({ bidAmount }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;

    if (room.roundPhase !== 'placing' && room.roundPhase !== 'bidding') {
      socket.emit('errorMsg', '當前不能進行競標。');
      return;
    }

    if (room.activePlayerId !== socket.id) {
      socket.emit('errorMsg', '還沒有輪到你的回合。');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated || player.passed) return;

    // Check if everyone has placed at least 1 card (required to start bidding)
    const everyonePlayedOne = room.players.filter(p => !p.eliminated).every(p => p.playedCards.length >= 1);
    if (!everyonePlayedOne) {
      socket.emit('errorMsg', '所有探員都必須至少出過 1 張牌，才能發起挑戰競標。');
      return;
    }

    // Check bid constraints
    let totalCardsOnTable = 0;
    room.players.forEach(p => {
      totalCardsOnTable += p.playedCards.length;
    });

    const amount = parseInt(bidAmount);
    if (isNaN(amount) || amount <= (room.highestBid || 0) || amount > totalCardsOnTable) {
      socket.emit('errorMsg', `無效的競標數。必須大於 ${room.highestBid || 0} 且小於等於 ${totalCardsOnTable}。`);
      return;
    }

    // Switch phase to bidding if was placing
    if (room.roundPhase === 'placing') {
      room.roundPhase = 'bidding';
      // Reset passed flag for all survivors
      room.players.forEach(p => {
        p.passed = false;
      });
    }

    room.highestBid = amount;
    room.challengerId = player.id;
    addLog(room, 'system', `📣 ${player.name} 提升競標，出價：【${amount} 張】！`);

    // Check if bid reached the maximum possible
    if (amount === totalCardsOnTable) {
      startSkullRevealing(room);
    } else {
      advanceSkullTurn(room);
    }
  });

  // Event: Skull Pass Bidding
  socket.on('skull_pass', () => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;

    if (room.roundPhase !== 'bidding') {
      socket.emit('errorMsg', '目前不是競標階段。');
      return;
    }

    if (room.activePlayerId !== socket.id) {
      socket.emit('errorMsg', '還沒有輪到你的回合。');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated || player.passed) return;

    player.passed = true;
    addLog(room, 'system', `💨 ${player.name} 選擇了放棄本輪競標。`);

    // Check how many players have not passed
    const activeBidders = room.players.filter(p => !p.eliminated && !p.passed);
    if (activeBidders.length === 1) {
      room.challengerId = activeBidders[0].id;
      startSkullRevealing(room);
    } else if (activeBidders.length === 0) {
      startSkullRevealing(room);
    } else {
      advanceSkullTurn(room);
    }
  });

  // Event: Skull Reveal Card (called by challenger during revealing phase)
  socket.on('skull_revealCard', ({ targetPlayerId }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;

    if (room.roundPhase !== 'revealing') {
      socket.emit('errorMsg', '當前不是翻牌結算階段。');
      return;
    }

    // Check if a skull has already been revealed in this room (meaning challenge failure has already been hit and is resolving)
    const skullAlreadyRevealed = room.players.some(p => p.playedCards.some(c => c.type === 'skull' && c.revealed));
    if (skullAlreadyRevealed) {
      socket.emit('errorMsg', '挑戰已失敗，正在處理懲罰中。');
      return;
    }

    if (room.challengerId !== socket.id) {
      socket.emit('errorMsg', '只有挑戰者才能進行翻牌。');
      return;
    }

    const challenger = room.players.find(p => p.id === socket.id);
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    
    if (!targetPlayer || targetPlayer.eliminated || targetPlayer.playedCards.length === 0) {
      socket.emit('errorMsg', '無效的翻牌目標。');
      return;
    }

    // Reveal order constraint: challenger must reveal all own played cards first
    const challengerHasUnrevealed = challenger.playedCards.some(c => !c.revealed);
    if (challengerHasUnrevealed && targetPlayerId !== socket.id) {
      socket.emit('errorMsg', '你必須先將自己牌堆的所有卡牌全部翻開！');
      return;
    }

    // Get the top unrevealed card
    const cardToReveal = [...targetPlayer.playedCards].reverse().find(c => !c.revealed);
    if (!cardToReveal) {
      socket.emit('errorMsg', '該探員牌堆中已無未翻開的卡牌。');
      return;
    }

    cardToReveal.revealed = true;
    room.revealedCardsCount++;

    // Broadcast flip sound
    io.to(room.roomCode).emit('skull_cardRevealedSound', { cardType: cardToReveal.type });

    addLog(room, 'system', `🔍 ${challenger.name} 翻開了 ${targetPlayer.name} 的一張牌，是：【${cardToReveal.type === 'flower' ? '🌸 鮮花牌' : '💀 骷髏牌'}】。`);

    if (cardToReveal.type === 'skull') {
      resolveSkullChallengeFailure(room, targetPlayerId);
    } else {
      if (room.revealedCardsCount === room.highestBid) {
        resolveSkullChallengeSuccess(room);
      } else {
        broadcastRoomUpdate(room);
        triggerSkullBotAction(room);
      }
    }
  });

  // Event: Skull Discard Choice (called by failed challenger after own-skull self-explosion)
  socket.on('skull_discardChoice', ({ cardIndex }) => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;

    const challenger = room.players.find(p => p.id === socket.id);
    if (!challenger || challenger.id !== room.challengerId || challenger.cards.length === 0) return;

    if (cardIndex < 0 || cardIndex >= challenger.cards.length) return;

    const discardedType = challenger.cards.splice(cardIndex, 1)[0];
    addLog(room, 'system', `⚙️ ${challenger.name} 秘密選擇丟棄了自己的一張手牌。`);
    
    socket.emit('skull_cardLost', { cardType: discardedType, isSelfExplode: true });

    postSkullChallengeCleanup(room, challenger.id, true);
  });

  // Event: Skull Ready for Next Round
  socket.on('skull_readyToDeploy', () => {
    let room = getRoomBySocket(socket);
    if (!room || !room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;

    player.readyToDeploy = true;
    addLog(room, 'system', `🆗 ${player.name} 已宣告就緒。`);

    const everyoneReady = room.players.filter(p => !p.eliminated).every(p => p.readyToDeploy);
    if (everyoneReady) {
      room.players.forEach(p => {
        if (!p.eliminated) {
          p.playedCards.forEach(c => {
            p.cards.push(c.type);
          });
          p.playedCards = [];
          shuffle(p.cards);
        }
      });

      room.highestBid = 0;
      room.challengerId = null;
      room.revealedCardsCount = 0;
      room.round++;
      room.roundPhase = 'placing';

      addLog(room, 'system', `--- 🌀 第 ${room.round} 回合開始 🌀 ---`);
      addLog(room, 'system', `首位出牌探員為：${room.players.find(p => p.id === room.activePlayerId).name}。`);
    }

    broadcastRoomUpdate(room);
    triggerSkullBotAction(room);
  });
});

// ==========================================
// SKULL HELPER FUNCTIONS & BOT ACTIONS
// ==========================================

function getRoomBySocket(socket) {
  for (const r of rooms.values()) {
    if (r.players.some(p => p.id === socket.id)) {
      return r;
    }
  }
  return null;
}

function getNextSkullActivePlayerId(room, currentId) {
  const index = room.players.findIndex(p => p.id === currentId);
  const len = room.players.length;
  for (let i = 1; i <= len; i++) {
    const nextP = room.players[(index + i) % len];
    if (!nextP.eliminated) {
      return nextP.id;
    }
  }
  return currentId;
}

function getNextSkullBidderId(room, currentId) {
  const index = room.players.findIndex(p => p.id === currentId);
  const len = room.players.length;
  for (let i = 1; i <= len; i++) {
    const nextP = room.players[(index + i) % len];
    if (!nextP.eliminated && !nextP.passed) {
      return nextP.id;
    }
  }
  return currentId;
}

function advanceSkullTurn(room) {
  if (room.roundPhase === 'placing') {
    room.activePlayerId = getNextSkullActivePlayerId(room, room.activePlayerId);
  } else if (room.roundPhase === 'bidding') {
    room.activePlayerId = getNextSkullBidderId(room, room.activePlayerId);
  }
  
  broadcastRoomUpdate(room);
  triggerSkullBotAction(room);
}

function startSkullRevealing(room) {
  room.roundPhase = 'revealing';
  room.activePlayerId = room.challengerId;
  room.revealedCardsCount = 0;
  
  addLog(room, 'system', `🔎 競標結束！挑戰者【${room.players.find(p => p.id === room.challengerId).name}】必須成功翻開 ${room.highestBid} 張鮮花牌。`);
  
  broadcastRoomUpdate(room);
  triggerSkullBotAction(room);
}

function resolveSkullChallengeSuccess(room) {
  const challenger = room.players.find(p => p.id === room.challengerId);
  challenger.score++;
  
  addLog(room, 'system', `🎉 恭喜！${challenger.name} 挑戰成功！目前累計得分：【${challenger.score}/2】。`);
  
  if (challenger.score >= 2) {
    room.gameEnded = true;
    room.winnerTeam = challenger.id;
    addLog(room, 'system', `🏆 最終勝利！${challenger.name} 成功完成了 2 次挑戰，贏得了遊戲！`);
  } else {
    room.players.forEach(p => {
      p.readyToDeploy = false;
    });
    room.activePlayerId = challenger.id;
    room.roundPhase = 'revealing_complete';
    triggerSkullBotsReady(room);
  }
  
  broadcastRoomUpdate(room);
}

function resolveSkullChallengeFailure(room, skullOwnerId) {
  const challenger = room.players.find(p => p.id === room.challengerId);
  const owner = room.players.find(p => p.id === skullOwnerId);
  
  if (challenger.id === owner.id) {
    addLog(room, 'system', `💣 挑戰者踩到了自己放置的骷髏！必須自行秘密選擇丟棄 1 張手牌。`);
    
    if (challenger.isBot) {
      const randomIndex = Math.floor(Math.random() * challenger.cards.length);
      const discardedType = challenger.cards.splice(randomIndex, 1)[0];
      addLog(room, 'system', `⚙️ ${challenger.name} (AI 機器人) 秘密選擇丟棄了自己的一張手牌。`);
      postSkullChallengeCleanup(room, challenger.id, true);
    } else {
      const socket = io.sockets.sockets.get(challenger.id);
      if (socket) {
        socket.emit('skull_mustDiscardSelf', { remainingCards: challenger.cards });
      }
    }
  } else {
    const randomIndex = Math.floor(Math.random() * challenger.cards.length);
    const discardedType = challenger.cards.splice(randomIndex, 1)[0];
    
    addLog(room, 'system', `💥 挑戰者踩中了 ${owner.name} 的骷髏！${owner.name} 隨機抽取並丢棄了挑戰者的一張手牌。`);
    
    const socket = io.sockets.sockets.get(challenger.id);
    if (socket) {
      socket.emit('skull_cardLost', { cardType: discardedType, isSelfExplode: false, byPlayerName: owner.name });
    }
    
    postSkullChallengeCleanup(room, owner.id, false);
  }
}

function postSkullChallengeCleanup(room, nextStartingPlayerId, isSelfExplode) {
  const challenger = room.players.find(p => p.id === room.challengerId);
  
  if (challenger.cards.length === 0) {
    challenger.eliminated = true;
    addLog(room, 'system', `💀 【${challenger.name}】已失去所有卡牌，不幸被淘汰出局！`);
    
    const survivors = room.players.filter(p => !p.eliminated);
    if (survivors.length === 1) {
      room.gameEnded = true;
      room.winnerTeam = survivors[0].id;
      addLog(room, 'system', `🏆 最後倖存！恭喜 ${survivors[0].name} 成為場上唯一的倖存者，贏得了對局！`);
      broadcastRoomUpdate(room);
      return;
    }
  }

  room.players.forEach(p => {
    p.readyToDeploy = false;
  });

  if (isSelfExplode) {
    if (!challenger.eliminated) {
      room.activePlayerId = challenger.id;
    } else {
      room.activePlayerId = getNextSkullActivePlayerId(room, challenger.id);
    }
  } else {
    const owner = room.players.find(p => p.id === nextStartingPlayerId);
    if (owner && !owner.eliminated) {
      room.activePlayerId = owner.id;
    } else {
      room.activePlayerId = getNextSkullActivePlayerId(room, nextStartingPlayerId);
    }
  }

  room.roundPhase = 'revealing_complete';
  triggerSkullBotsReady(room);
  broadcastRoomUpdate(room);
}

function triggerSkullBotsReady(room) {
  room.players.forEach(p => {
    if (p.isBot && !p.eliminated && !p.readyToDeploy) {
      setTimeout(() => {
        if (!room.gameStarted || room.gameEnded || room.gameType !== 'skull') return;
        
        p.readyToDeploy = true;
        addLog(room, 'system', `🆗 ${p.name} (AI 機器人) 已宣告就緒。`);
        
        const everyoneReady = room.players.filter(pl => !pl.eliminated).every(pl => pl.readyToDeploy);
        if (everyoneReady) {
          room.players.forEach(pl => {
            if (!pl.eliminated) {
              pl.playedCards.forEach(c => {
                pl.cards.push(c.type);
              });
              pl.playedCards = [];
              shuffle(pl.cards);
            }
          });

          room.highestBid = 0;
          room.challengerId = null;
          room.revealedCardsCount = 0;
          room.round++;
          room.roundPhase = 'placing';

          addLog(room, 'system', `--- 🌀 第 ${room.round} 回合開始 🌀 ---`);
          addLog(room, 'system', `首位出牌探員為：${room.players.find(pl => pl.id === room.activePlayerId).name}。`);
        }
        
        broadcastRoomUpdate(room);
        triggerSkullBotAction(room);
      }, 1000 + Math.random() * 1000);
    }
  });
}

function triggerSkullBotAction(room) {
  if (room.gameEnded) return;
  
  const bot = room.players.find(p => p.id === room.activePlayerId);
  if (!bot || !bot.isBot || bot.eliminated) return;

  setTimeout(() => {
    const currentBot = room.players.find(p => p.id === room.activePlayerId);
    if (!currentBot || !currentBot.isBot || currentBot.eliminated || room.gameEnded) return;

    if (room.roundPhase === 'placing') {
      const everyonePlayedOne = room.players.filter(p => !p.eliminated).every(p => p.playedCards.length >= 1);
      const noHand = currentBot.cards.length === 0;
      
      if (noHand) {
        botBidHeuristics(room, currentBot);
      } else if (!everyonePlayedOne) {
        botPlaceHeuristics(room, currentBot);
      } else {
        if (Math.random() < 0.7) {
          botPlaceHeuristics(room, currentBot);
        } else {
          botBidHeuristics(room, currentBot);
        }
      }
    } else if (room.roundPhase === 'bidding') {
      if (currentBot.passed) return;
      botBidHeuristics(room, currentBot);
    } else if (room.roundPhase === 'revealing') {
      if (room.challengerId === currentBot.id) {
        botRevealHeuristics(room, currentBot);
      }
    }
  }, 1500 + Math.random() * 1000);
}

// Bot sub-heuristics: Place card
function botPlaceHeuristics(room, bot) {
  const hasSkull = bot.cards.includes('skull');
  let chosenCard = 'flower';
  if (hasSkull && Math.random() < 0.3) {
    chosenCard = 'skull';
  } else {
    chosenCard = bot.cards.includes('flower') ? 'flower' : 'skull';
  }

  const idx = bot.cards.indexOf(chosenCard);
  bot.cards.splice(idx, 1);
  bot.playedCards.push({ type: chosenCard, revealed: false });
  
  addLog(room, 'system', `${bot.name} (AI 機器人) 秘密放置了一張卡牌到其牌堆。`);
  advanceSkullTurn(room);
}

// Bot sub-heuristics: Bid
function botBidHeuristics(room, bot) {
  const hasSelfSkull = bot.playedCards.some(c => c.type === 'skull');
  const currentHighest = room.highestBid || 0;
  
  let totalCardsOnTable = 0;
  room.players.forEach(p => {
    totalCardsOnTable += p.playedCards.length;
  });

  const nextBid = currentHighest + 1;

  if (nextBid > totalCardsOnTable) {
    botPassHeuristics(room, bot);
    return;
  }

  if (hasSelfSkull) {
    if (nextBid < 3 && Math.random() < 0.35) {
      executeBotBid(room, bot, nextBid);
    } else {
      botPassHeuristics(room, bot);
    }
  } else {
    const mySafeCount = bot.playedCards.length;
    const otherCardsCount = totalCardsOnTable - mySafeCount;
    const botEstimateLimit = Math.floor(mySafeCount + (otherCardsCount * 0.5));
    
    if (nextBid <= botEstimateLimit || (nextBid === 1)) {
      executeBotBid(room, bot, nextBid);
    } else {
      botPassHeuristics(room, bot);
    }
  }
}

function executeBotBid(room, bot, amount) {
  if (room.roundPhase === 'placing') {
    room.roundPhase = 'bidding';
    room.players.forEach(p => {
      p.passed = false;
    });
  }

  room.highestBid = amount;
  room.challengerId = bot.id;
  addLog(room, 'system', `📣 ${bot.name} (AI 機器人) 提升競標，出價：【${amount} 張】！`);

  let totalCards = 0;
  room.players.forEach(p => {
    totalCards += p.playedCards.length;
  });

  if (amount === totalCards) {
    startSkullRevealing(room);
  } else {
    advanceSkullTurn(room);
  }
}

function botPassHeuristics(room, bot) {
  if (room.roundPhase === 'placing') {
    executeBotBid(room, bot, Math.max(1, (room.highestBid || 0) + 1));
    return;
  }
  
  bot.passed = true;
  addLog(room, 'system', `💨 ${bot.name} (AI 機器人) 選擇了放棄本輪競標。`);

  const activeBidders = room.players.filter(p => !p.eliminated && !p.passed);
  if (activeBidders.length === 1) {
    room.challengerId = activeBidders[0].id;
    startSkullRevealing(room);
  } else {
    advanceSkullTurn(room);
  }
}

function botRevealHeuristics(room, bot) {
  const unrevealedOwn = bot.playedCards.some(c => !c.revealed);
  if (unrevealedOwn) {
    revealCardOnServer(room, bot.id);
    return;
  }

  const targets = room.players.filter(p => p.id !== bot.id && !p.eliminated && p.playedCards.some(c => !c.revealed));
  if (targets.length === 0) return;

  const earlyPassers = targets.filter(p => p.passed);
  let selectedTarget = null;
  if (earlyPassers.length > 0 && Math.random() < 0.7) {
    selectedTarget = earlyPassers[Math.floor(Math.random() * earlyPassers.length)];
  } else {
    selectedTarget = targets[Math.floor(Math.random() * targets.length)];
  }

  revealCardOnServer(room, selectedTarget.id);
}

function revealCardOnServer(room, targetPlayerId) {
  const challenger = room.players.find(p => p.id === room.challengerId);
  const targetPlayer = room.players.find(p => p.id === targetPlayerId);

  const cardToReveal = [...targetPlayer.playedCards].reverse().find(c => !c.revealed);
  if (!cardToReveal) return;

  cardToReveal.revealed = true;
  room.revealedCardsCount++;

  io.to(room.roomCode).emit('skull_cardRevealedSound', { cardType: cardToReveal.type });

  addLog(room, 'system', `🔍 ${challenger.name} (AI 機器人) 翻開了 ${targetPlayer.name} 的一張牌，是：【${cardToReveal.type === 'flower' ? '🌸 鮮花牌' : '💀 骷髏牌'}】。`);

  if (cardToReveal.type === 'skull') {
    resolveSkullChallengeFailure(room, targetPlayerId);
  } else {
    let totalCards = 0;
    room.players.forEach(p => {
      totalCards += p.playedCards.length;
    });

    if (room.revealedCardsCount === room.highestBid) {
      resolveSkullChallengeSuccess(room);
    } else {
      broadcastRoomUpdate(room);
      triggerSkullBotAction(room);
    }
  }
}

// ================= TOPTEN (天才猜心王) GAME ENGINE LOGIC =================


const BOT_ANSWER_TEMPLATES = {
  1: [
    "這絕對是世界末日等級的慘烈災難啊，簡直不忍直視！",
    "超級地獄級別的體驗，糟糕透頂，完全無法接受！",
    "簡直就是一場徹底的悲劇與災難，沒有最慘只有更慘！"
  ],
  2: [
    "真的挺糟糕的，讓人感到十分無奈和搖頭...",
    "水準非常低下，粗製濫造，看了讓人直搖頭。",
    "缺點多到數不清，體驗相當不愉快，十分差勁。"
  ],
  3: [
    "不太行耶，感覺缺點很多，不甚滿意。",
    "稍微有一點差勁，勉強算是在及格邊緣試探。",
    "讓人感到有些失望，整體表現乏善可陳。"
  ],
  4: [
    "稍微低於一般標準，但也還勉強說得過去。",
    "普普通通偏下一點點，沒有什麼亮點。",
    "馬馬虎虎吧，勉強湊合，但完全不吸引人。"
  ],
  5: [
    "中規中矩吧，就是極其普通、毫無亮點的表現。",
    "標準的平均水準，不上不下，毫無特色。",
    "沒有特別好也沒有特別壞，就是最平凡的狀態。"
  ],
  6: [
    "感覺還不錯，比一般的表現稍微好上一點點。",
    "略高於平均標準，整體感覺還算可以。",
    "馬馬虎虎過得去，稍微有一點點可取之處。"
  ],
  7: [
    "挺推薦的，各方面水準都在及格線以上！",
    "相當不錯的表現，值得給予正面肯定的評價。",
    "品質穩定，表現優良，比大多數情況都好。"
  ],
  8: [
    "非常優異，品質極佳，讓人感到相當驚艷！",
    "高水準發揮，非常出色，讓人十分滿意！",
    "相當有水準，體驗很棒，非常推薦大家。"
  ],
  9: [
    "簡直完美無瑕，水準高超，強烈推薦！",
    "極度優秀，幾乎找不到任何缺點，令人拍案叫絕！",
    "超乎想像的精采表現，接近完美的極致水準！"
  ],
  10: [
    "宇宙至高神級的終極完美體驗，不接受任何反駁！",
    "登峰造極的無上神作，堪稱完美，讓人頂禮膜拜！",
    "這已經超越了完美的極限，簡直是奇蹟般的表現！"
  ]
};

function drawTopTenTopic(room) {
  if (!room.usedTopics) room.usedTopics = [];
  const available = TOPTEN_TOPICS.filter(t => !room.usedTopics.includes(t.id));
  if (available.length === 0) {
    room.usedTopics = []; // reset if all used
    return TOPTEN_TOPICS[Math.floor(Math.random() * TOPTEN_TOPICS.length)];
  }
  const chosen = available[Math.floor(Math.random() * available.length)];
  room.usedTopics.push(chosen.id);
  return chosen;
}

function getBotAnswerText(cardNumber) {
  const scaleIndex = Math.min(10, Math.max(1, Math.ceil(cardNumber / 10)));
  const arr = BOT_ANSWER_TEMPLATES[scaleIndex] || BOT_ANSWER_TEMPLATES[5];
  return arr[Math.floor(Math.random() * arr.length)];
}

function startTopTenRound(room) {
  room.roundPhase = 'answering';
  room.revealedSequence = [];
  const humanPlayers = room.players.filter(p => !p.isBot);
  if (humanPlayers.length > 0) {
    const humanCaptain = humanPlayers[(room.currentRound - 1) % humanPlayers.length];
    room.captainIndex = room.players.findIndex(p => p.id === humanCaptain.id);
  } else {
    room.captainIndex = 0;
  }

  // Draw 1-100 non-repeating numbers and distribute them
  const numbers = shuffle(Array.from({ length: 100 }, (_, i) => i + 1));

  room.players.forEach((p, idx) => {
    p.cardNumber = numbers[idx];
    p.answerText = '';
    p.hasAnswered = false;
    p.isRevealed = false;
    p.readyToDeploy = false;
  });

  const captain = room.players[room.captainIndex];
  addLog(room, 'system', `--- 🌀 第 ${room.currentRound} 回合開始 (總共 5 回合) 🌀 ---`);
  addLog(room, 'system', `本回合隊長為：【${captain.name}】。`);
  addLog(room, 'system', `題目為：『${room.currentTopic.question}』`);
  addLog(room, 'system', `（數字 1 代表：『${room.currentTopic.minDescription}』 ➔ 數字 100 代表：『${room.currentTopic.maxDescription}』）`);
  addLog(room, 'system', `請各位探員秘密查看自己的數字並提交回答，請避免直接說出數字喔！`);

  broadcastRoomUpdate(room);

  // Trigger bot replies automatically
  triggerTopTenBotAction(room);
}

function triggerTopTenBotAction(room) {
  if (room.gameEnded || room.roundPhase !== 'answering') return;

  room.players.forEach(p => {
    if (p.isBot && !p.hasAnswered) {
      const delay = 2000 + Math.random() * 3000;
      setTimeout(() => {
        if (room.gameEnded || room.roundPhase !== 'answering') return;
        const currentBot = room.players.find(pl => pl.id === p.id);
        if (!currentBot || !currentBot.isBot || currentBot.hasAnswered) return;

        currentBot.answerText = getBotAnswerText(currentBot.cardNumber);
        currentBot.hasAnswered = true;
        addLog(room, 'system', `✍️ ${currentBot.name} (AI 機器人) 已經提交了回答。`);

        const everyoneAnswered = room.players.every(pl => pl.hasAnswered);
        if (everyoneAnswered) {
          room.roundPhase = 'sorting';
          room.revealedSequence = [];
          const captain = room.players[room.captainIndex];
          addLog(room, 'system', `🔊 所有探員都已提交答案！進入【隊長排序階段】。`);
          addLog(room, 'system', `請隊長【${captain.name}】點擊玩家卡牌，由小到大逐一翻開秘密數字。`);
        }

        broadcastRoomUpdate(room);
      }, delay);
    }
  });
}

function triggerTopTenBotsReady(room) {
  room.players.forEach(p => {
    if (p.isBot && !p.readyToDeploy) {
      setTimeout(() => {
        if (!room.gameStarted || room.gameEnded || room.gameType !== 'topten') return;
        p.readyToDeploy = true;
        addLog(room, 'system', `🆗 ${p.name} (AI 機器人) 已宣告就緒。`);
        
        const everyoneReady = room.players.every(pl => pl.readyToDeploy);
        if (everyoneReady) {
          if (room.currentRound === room.totalRounds) {
            room.gameEnded = true;
            room.winnerTeam = 'Sherlock';
            room.roundPhase = 'game_over';
            addLog(room, 'system', `🏆 恭喜通關！完成了全部 5 個回合的考驗，贏得了完美的默契大勝利！`);
          } else {
            room.roundPhase = 'round_result';
            addLog(room, 'system', `📢 全員已就緒，本回合結算完成！請隊長或房主開啟下一回合。`);
          }
        }
        broadcastRoomUpdate(room);
      }, 1000 + Math.random() * 1000);
    }
  });
}

// ================= WHOAMI (名人猜猜我是誰) GAME ENGINE LOGIC =================
// Each player draws a hidden celebrity that everyone else can see. Players take
// turns; the active player keeps asking questions until they guess correctly or
// give up. Guesses don't count as questions, but a player may only have made
// (questions asked + 1) guesses in total. Fewest questions wins.

// 'pass' = chose not to answer; it still counts, so the asker can move on
const WHOAMI_ANSWERS = ['yes', 'no', 'unsure', 'text', 'pass'];
const WHOAMI_JUDGES_NEEDED = 2;
const WHOAMI_MAX_PLAYERS = 10;

// 數字猜猜我是誰 (whonum) runs on the same engine: the "celebrity" is a number
// 1–100 (repeats allowed), guesses are checked by the server instead of judges,
// and there is no redraw.
const WHONUM_MIN = 1;
const WHONUM_MAX = 100;

function isWhoamiGame(room) {
  return room.gameType === 'whoami' || room.gameType === 'whonum';
}

function parseWhonum(text) {
  const n = Number(String(text || '').trim());
  return Number.isInteger(n) && n >= WHONUM_MIN && n <= WHONUM_MAX ? n : null;
}

function drawWhoamiCelebrity(room) {
  if (room.gameType === 'whonum') {
    const n = WHONUM_MIN + Math.floor(Math.random() * (WHONUM_MAX - WHONUM_MIN + 1));
    return { id: `num_${n}`, name: String(n), category: '數字' };
  }
  if (!room.usedCelebrityIds) room.usedCelebrityIds = [];
  let available = WHOAMI_CELEBRITIES.filter(c => !room.usedCelebrityIds.includes(c.id));
  if (available.length === 0) {
    // Only reuse celebrities nobody is currently holding
    room.usedCelebrityIds = room.players.filter(p => p.celebrity).map(p => p.celebrity.id);
    available = WHOAMI_CELEBRITIES.filter(c => !room.usedCelebrityIds.includes(c.id));
  }
  const chosen = available[Math.floor(Math.random() * available.length)];
  room.usedCelebrityIds.push(chosen.id);
  return chosen;
}

function resetWhoamiPlayer(p) {
  p.questions = [];
  p.guesses = [];
}

function resetWhoamiRoom(room) {
  room.whoamiProposal = null;
  room.whoamiTurnOrder = [];
  room.activePlayerId = null;
  room.pendingGuess = null;
  room.players.forEach(p => {
    p.celebrity = null;
    p.whoamiStatus = null;
    resetWhoamiPlayer(p);
  });
}

function whoamiGuessesLeft(p) {
  return p.questions.length + 1 - p.guesses.length;
}

function getWhoamiRanking(room) {
  const finishedRank = { solved: 0, gaveup: 1, left: 2 };
  return room.players
    .filter(p => p.whoamiStatus in finishedRank)
    .sort((a, b) => {
      const byStatus = finishedRank[a.whoamiStatus] - finishedRank[b.whoamiStatus];
      if (byStatus !== 0) return byStatus;
      return a.questions.length - b.questions.length;
    })
    .map(p => p.id);
}

function getWhoamiRoomState(room, socketId) {
  const players = room.players.map(p => {
    const isSelf = p.id === socketId;
    const finished = ['solved', 'gaveup', 'left'].includes(p.whoamiStatus);
    const canSeeCelebrity = !isSelf || finished || room.gameEnded;
    return {
      id: p.id,
      name: p.name,
      host: p.host,
      connected: p.connected,
      isBot: false,
      status: p.whoamiStatus || 'waiting',
      celebrity: canSeeCelebrity ? (p.celebrity || null) : null,
      questions: p.questions || [],
      guesses: p.guesses || [],
      questionCount: p.questions ? p.questions.length : 0,
      guessesLeft: p.questions ? whoamiGuessesLeft(p) : 1
    };
  });

  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    roundPhase: room.roundPhase,
    activePlayerId: room.activePlayerId || null,
    turnOrder: room.whoamiTurnOrder || [],
    pendingGuess: room.pendingGuess || null,
    judgesNeeded: room.pendingGuess && room.activePlayerId
      ? whoamiJudgesNeeded(room, room.players.find(p => p.id === room.activePlayerId))
      : 0,
    proposal: getWhoamiProposalView(room, socketId),
    ranking: room.gameEnded ? getWhoamiRanking(room) : [],
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

function startWhoamiGame(room) {
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  room.usedCelebrityIds = [];
  resetWhoamiRoom(room);

  room.players.forEach(p => {
    p.celebrity = drawWhoamiCelebrity(room);
    p.whoamiStatus = 'waiting';
  });
  room.whoamiTurnOrder = shuffle(room.players.map(p => p.id));

  const orderNames = room.whoamiTurnOrder.map(id => room.players.find(p => p.id === id).name);
  addLog(room, 'system', room.gameType === 'whonum'
    ? `🔢 數字猜猜我是誰開始！每個人都抽到一個 ${WHONUM_MIN}–${WHONUM_MAX} 的數字，你看得到別人的，卻看不到自己的。`
    : '🎭 名人猜猜我是誰開始！每個人都抽到了一位名人，你看得到別人的，卻看不到自己的。');
  addLog(room, 'system', `猜題順序：${orderNames.join(' ➔ ')}`);
  advanceWhoamiTurn(room);
  broadcastRoomUpdate(room);
}

function advanceWhoamiTurn(room) {
  room.pendingGuess = null;
  room.whoamiProposal = null;
  const next = room.whoamiTurnOrder
    .map(id => room.players.find(p => p.id === id))
    .find(p => p && p.whoamiStatus === 'waiting' && p.connected);

  if (!next) {
    room.players.forEach(p => { if (p.whoamiStatus === 'waiting') p.whoamiStatus = 'left'; });
    room.activePlayerId = null;
    room.roundPhase = 'game_over';
    room.gameEnded = true;
    addLog(room, 'system', '🏁 所有人都完成了！來看看誰用最少的問題猜出自己是誰。');
    return;
  }

  next.whoamiStatus = 'active';
  room.activePlayerId = next.id;
  room.roundPhase = 'asking';
  addLog(room, 'system', `👉 輪到【${next.name}】發問！其他人請誠實回答。`);
}

function getWhoamiTurnContext(socket, phase) {
  const room = getRoomBySocket(socket);
  if (!room || !isWhoamiGame(room) || !room.gameStarted || room.gameEnded) return null;
  if (phase && room.roundPhase !== phase) return null;
  const player = room.players.find(p => p.id === socket.id);
  const active = room.players.find(p => p.id === room.activePlayerId);
  if (!player || !active) return null;
  return { room, player, active };
}

function whoamiJudges(room, active) {
  return room.players.filter(p => p.id !== active.id && p.connected && p.whoamiStatus !== 'left');
}

function whoamiJudgesNeeded(room, active) {
  return Math.min(WHOAMI_JUDGES_NEEDED, Math.max(1, whoamiJudges(room, active).length));
}

// force: the host stops waiting; the judgments so far decide (a tie or none counts as wrong)
function resolveWhoamiGuess(room, active, { force = false } = {}) {
  const pending = room.pendingGuess;
  if (!pending || room.roundPhase !== 'judging') return;
  const judgeIds = whoamiJudges(room, active).map(p => p.id);
  const judgments = pending.judgments.filter(j => judgeIds.includes(j.playerId));
  const needed = whoamiJudgesNeeded(room, active);
  const yes = judgments.filter(j => j.correct);
  const no = judgments.filter(j => !j.correct);

  let isCorrect;
  if (yes.length >= needed) isCorrect = true;
  else if (no.length >= needed) isCorrect = false;
  else if (judgments.length >= judgeIds.length) isCorrect = false; // everyone judged but split: not confirmed
  else if (force) isCorrect = yes.length > no.length;
  else return;

  const deciders = (isCorrect ? yes : no).map(j => j.name).join('、') || judgments.map(j => j.name).join('、') || '房主';
  active.guesses.push({
    text: pending.text,
    correct: isCorrect,
    judgeName: deciders,
    afterQuestions: active.questions.length
  });
  room.pendingGuess = null;

  if (isCorrect) {
    active.whoamiStatus = 'solved';
    addLog(room, 'system', `🎉 ${active.name} 猜對了！是【${active.celebrity.name}】，共問了 ${active.questions.length} 題。（${deciders} 判定）`);
    advanceWhoamiTurn(room);
  } else {
    room.roundPhase = 'asking';
    addLog(room, 'system', `❌ 猜錯了！（${deciders} 判定）${active.name} 繼續發問。`);
  }
}

// Custom celebrity proposals: during A's turn someone else suggests a celebrity
// for A. Everyone except A and the proposer votes; it passes with more yes than
// no votes. A never sees the suggested name.
function whoamiProposalVoters(room) {
  const pr = room.whoamiProposal;
  if (!pr) return [];
  return room.players.filter(p => p.id !== pr.targetId && p.id !== pr.proposerId && p.whoamiStatus !== 'left');
}

function getWhoamiProposalView(room, socketId) {
  const pr = room.whoamiProposal;
  if (!pr) return null;
  const voters = whoamiProposalVoters(room);
  return {
    proposerId: pr.proposerId,
    targetId: pr.targetId,
    name: socketId === pr.targetId ? null : pr.name,
    yesIds: pr.yesIds,
    noIds: pr.noIds,
    voterIds: voters.map(p => p.id)
  };
}

function checkWhoamiProposal(room) {
  const pr = room.whoamiProposal;
  if (!pr) return;
  const target = room.players.find(p => p.id === pr.targetId);
  const proposer = room.players.find(p => p.id === pr.proposerId);
  const voterIds = whoamiProposalVoters(room).filter(p => p.connected).map(p => p.id);
  const yes = pr.yesIds.filter(id => voterIds.includes(id)).length;
  const no = pr.noIds.filter(id => voterIds.includes(id)).length;
  const remaining = voterIds.length - yes - no;
  // With fewer than 3 players nobody else can vote, so the proposer's own agreement is enough
  const solo = whoamiProposalVoters(room).length === 0;

  if (solo || yes > no + remaining) {
    room.whoamiProposal = null;
    target.celebrity = { id: `custom_${Date.now()}`, name: pr.name, category: `自訂（${proposer ? proposer.name : '?'} 出題）` };
    resetWhoamiPlayer(target);
    room.pendingGuess = null;
    room.roundPhase = 'asking';
    addLog(room, 'system', solo
      ? `✏️ ${proposer ? proposer.name : '?'} 幫 ${target.name} 換成自訂題目（人數少於 3 人，不用投票），題數重新計算。`
      : `✏️ 投票通過（${yes} 同意／${no} 不同意）！${target.name} 的名人換成自訂題目，題數重新計算。`);
  } else if (yes + remaining <= no) {
    room.whoamiProposal = null;
    addLog(room, 'system', `🙅 自訂題目沒有通過（${yes} 同意／${no} 不同意），${target.name} 的名人不變。`);
  }
}

function handleWhoamiDisconnect(room, player) {
  if (room.gameEnded || !['waiting', 'active'].includes(player.whoamiStatus)) return;
  const wasActive = player.whoamiStatus === 'active';
  player.whoamiStatus = 'left';
  if (wasActive) {
    addLog(room, 'system', `${player.name} 在猜題途中離開了，換下一位。`);
    advanceWhoamiTurn(room);
  }
}

io.on('connection', (socket) => {
  // Event: Active player asks a question
  socket.on('whoami_ask', ({ text } = {}) => {
    const ctx = getWhoamiTurnContext(socket, 'asking');
    if (!ctx) return;
    const { room, player, active } = ctx;
    if (player.id !== active.id) {
      socket.emit('errorMsg', '現在不是你的發問回合。');
      return;
    }
    const question = String(text || '').trim().slice(0, 80);
    if (!question) {
      socket.emit('errorMsg', '問題不能是空的。');
      return;
    }
    const last = active.questions[active.questions.length - 1];
    if (last && last.answers.length === 0) {
      socket.emit('errorMsg', '請等其他人回答上一題，再問下一題。');
      return;
    }

    active.questions.push({ id: active.questions.length + 1, text: question, answers: [] });
    addLog(room, 'question', `❓ ${active.name} 問第 ${active.questions.length} 題：${question}`);
    broadcastRoomUpdate(room);
  });

  // Event: Other players answer one of the active player's questions
  socket.on('whoami_answer', ({ questionId, answer, note } = {}) => {
    const ctx = getWhoamiTurnContext(socket);
    if (!ctx) return;
    const { room, player, active } = ctx;
    if (player.id === active.id) return;
    if (!WHOAMI_ANSWERS.includes(answer)) return;
    // Only the latest question is open for answers
    const question = active.questions[active.questions.length - 1];
    if (!question || question.id !== questionId) return;
    const cleanNote = String(note || '').trim().slice(0, 60);
    if (answer === 'text' && !cleanNote) return;

    const entry = {
      playerId: player.id,
      name: player.name,
      answer,
      note: cleanNote
    };
    const existing = question.answers.findIndex(a => a.playerId === player.id);
    if (existing === -1) question.answers.push(entry);
    else question.answers[existing] = entry;

    broadcastRoomUpdate(room);
  });

  // Event: Active player makes a guess (doesn't count as a question)
  socket.on('whoami_guess', ({ text } = {}) => {
    const ctx = getWhoamiTurnContext(socket, 'asking');
    if (!ctx) return;
    const { room, player, active } = ctx;
    if (player.id !== active.id) return;
    const isNum = room.gameType === 'whonum';
    const guess = isNum ? parseWhonum(text) : String(text || '').trim().slice(0, 40);
    if (!guess) {
      socket.emit('errorMsg', isNum ? `請輸入 ${WHONUM_MIN}–${WHONUM_MAX} 的整數。` : '請輸入你猜的名人。');
      return;
    }
    if (whoamiGuessesLeft(active) <= 0) {
      socket.emit('errorMsg', '猜測次數已用完（最多＝已問題數＋1），請再問一題。');
      return;
    }

    if (isNum) {
      // Numbers are checked right away, no judges needed
      const correct = String(guess) === active.celebrity.name;
      active.guesses.push({ text: String(guess), correct, judgeName: '系統', afterQuestions: active.questions.length });
      if (correct) {
        active.whoamiStatus = 'solved';
        addLog(room, 'system', `🎉 ${active.name} 猜 ${guess}，猜對了！共問了 ${active.questions.length} 題。`);
        advanceWhoamiTurn(room);
      } else {
        addLog(room, 'guess', `❌ ${active.name} 猜 ${guess}，猜錯了！繼續發問。`);
      }
      broadcastRoomUpdate(room);
      return;
    }

    room.pendingGuess = { text: guess, judgments: [] };
    room.roundPhase = 'judging';
    addLog(room, 'guess', `🎯 ${active.name} 猜：「${guess}」，請其他人判定！`);
    broadcastRoomUpdate(room);
  });

  // Event: Other players judge the pending guess. A verdict needs 2 matching
  // judgments (or 1 if there's only one judge), so one mis-tap can't decide it.
  socket.on('whoami_judge', ({ correct } = {}) => {
    const ctx = getWhoamiTurnContext(socket, 'judging');
    if (!ctx) return;
    const { room, player, active } = ctx;
    if (player.id === active.id || !room.pendingGuess) return;

    const pending = room.pendingGuess;
    pending.judgments = pending.judgments.filter(j => j.playerId !== player.id);
    pending.judgments.push({ playerId: player.id, name: player.name, correct: correct === true });
    resolveWhoamiGuess(room, active);
    broadcastRoomUpdate(room);
  });

  // Event: Active player gives up
  // Event: Host stops waiting for judges; the judgments so far decide
  socket.on('whoami_forceJudge', () => {
    const ctx = getWhoamiTurnContext(socket, 'judging');
    if (!ctx || !ctx.player.host) return;
    const { room, active } = ctx;
    addLog(room, 'system', '⏭️ 房主不等了，用目前的判定結算。');
    resolveWhoamiGuess(room, active, { force: true });
    broadcastRoomUpdate(room);
  });

  socket.on('whoami_giveUp', () => {
    const ctx = getWhoamiTurnContext(socket);
    if (!ctx) return;
    const { room, player, active } = ctx;
    if (player.id !== active.id) return;

    active.whoamiStatus = 'gaveup';
    addLog(room, 'system', `🏳️ ${active.name} 放棄了，答案是【${active.celebrity.name}】。`);
    advanceWhoamiTurn(room);
    broadcastRoomUpdate(room);
  });

  // Event: Someone other than the asker proposes a custom celebrity for them
  socket.on('whoami_proposeCustom', ({ name } = {}) => {
    const ctx = getWhoamiTurnContext(socket, 'asking');
    if (!ctx) return;
    const { room, player, active } = ctx;
    if (player.id === active.id) return;
    if (room.whoamiProposal) {
      socket.emit('errorMsg', '已經有一個自訂題目在投票中了。');
      return;
    }
    const isNum = room.gameType === 'whonum';
    const celebName = isNum ? String(parseWhonum(name) || '') : String(name || '').trim().slice(0, 30);
    if (!celebName) {
      socket.emit('errorMsg', isNum ? `請輸入 ${WHONUM_MIN}–${WHONUM_MAX} 的整數。` : '請輸入要出的名人。');
      return;
    }
    room.whoamiProposal = { proposerId: player.id, targetId: active.id, name: celebName, yesIds: [], noIds: [] };
    if (whoamiProposalVoters(room).length === 0) {
      checkWhoamiProposal(room);
    } else {
      addLog(room, 'system', `✏️ ${player.name} 提議幫 ${active.name} 換一個自訂的名人，請其他人投票！`);
    }
    broadcastRoomUpdate(room);
  });

  // Event: Vote on the pending custom celebrity proposal
  socket.on('whoami_voteCustom', ({ agree } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || !isWhoamiGame(room) || !room.gameStarted || room.gameEnded) return;
    const pr = room.whoamiProposal;
    if (!pr || !whoamiProposalVoters(room).some(p => p.id === socket.id)) return;
    pr.yesIds = pr.yesIds.filter(id => id !== socket.id);
    pr.noIds = pr.noIds.filter(id => id !== socket.id);
    (agree === true ? pr.yesIds : pr.noIds).push(socket.id);
    checkWhoamiProposal(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host skips the current asker; they keep their questions and go to the back of the queue
  socket.on('whoami_skipTurn', () => {
    const room = getRoomBySocket(socket);
    if (!room || !isWhoamiGame(room) || !room.gameStarted || room.gameEnded) return;
    const host = room.players.find(p => p.id === socket.id);
    if (!host || !host.host) {
      socket.emit('errorMsg', '只有房主可以跳過玩家。');
      return;
    }
    const active = room.players.find(p => p.id === room.activePlayerId);
    if (!active) return;

    active.whoamiStatus = 'waiting';
    room.whoamiTurnOrder = room.whoamiTurnOrder.filter(id => id !== active.id).concat(active.id);
    addLog(room, 'system', `⏭️ 房主跳過了 ${active.name}，他已問的 ${active.questions.length} 題會保留，排到最後再繼續。`);
    advanceWhoamiTurn(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host redraws a player's celebrity (e.g. nobody knows who it is)
  socket.on('whoami_redraw', ({ targetPlayerId } = {}) => {
    const room = getRoomBySocket(socket);
    // Number edition has no redraw: everyone knows every number
    if (!room || room.gameType !== 'whoami' || !room.gameStarted || room.gameEnded) return;
    const host = room.players.find(p => p.id === socket.id);
    if (!host || !host.host) {
      socket.emit('errorMsg', '只有房主可以換牌。');
      return;
    }
    const target = room.players.find(p => p.id === targetPlayerId);
    if (!target || !['waiting', 'active'].includes(target.whoamiStatus)) return;

    target.celebrity = drawWhoamiCelebrity(room);
    resetWhoamiPlayer(target);
    if (target.id === room.activePlayerId) {
      room.pendingGuess = null;
      room.roundPhase = 'asking';
    }
    addLog(room, 'system', `🔄 房主幫 ${target.name} 換了一張名人牌，題數重新計算。`);
    broadcastRoomUpdate(room);
  });
});

// ================= UNDERCOVER (誰是臥底) GAME ENGINE LOGIC =================
// Civilians share one word, undercovers get a similar word, and blanks get no
// word at all. Nobody is told their role (blanks can tell from the empty card).
// Players describe their word out loud in turn, then vote someone out. The
// civilians win once every undercover/blank is out; the undercover side wins
// when the civilians no longer outnumber them.

const UNDERCOVER_MIN_PLAYERS = 4;
const UNDERCOVER_MAX_PLAYERS = 10;
const UNDERCOVER_ROLE_NAMES = { civilian: '平民', undercover: '臥底', blank: '白板' };

function defaultUndercoverCount(playerCount) {
  return playerCount >= 7 ? 2 : 1;
}

function getUndercoverSetup(room) {
  const total = room.players.length;
  const settings = room.ucSettings || {};
  const undercover = Number.isInteger(settings.undercover) ? settings.undercover : defaultUndercoverCount(total);
  const blank = Number.isInteger(settings.blank) ? settings.blank : 0;
  return { total, undercover, blank, civilian: total - undercover - blank };
}

function undercoverSetupError(setup) {
  if (setup.total < UNDERCOVER_MIN_PLAYERS || setup.total > UNDERCOVER_MAX_PLAYERS) {
    return `誰是臥底需要 ${UNDERCOVER_MIN_PLAYERS} 到 ${UNDERCOVER_MAX_PLAYERS} 名玩家才能開始。`;
  }
  if (setup.undercover < 1) return '至少要有 1 個臥底。';
  if (setup.civilian <= setup.undercover + setup.blank) return '平民人數必須多於臥底＋白板，請減少臥底或白板。';
  return null;
}

function resetUndercoverRoom(room) {
  room.ucPair = null;
  room.ucRound = 0;
  room.ucSpeakOrder = [];
  room.ucSpeakIndex = 0;
  room.ucVotes = [];
  room.ucCandidates = null;
  room.ucRevote = false;
  room.ucResult = null;
  room.ucNext = null;
  room.ucEarlyVote = null;
  room.ucEarlyProposers = [];
  room.players.forEach(p => {
    p.ucRole = null;
    p.ucWord = null;
    p.ucAlive = true;
    p.ucLeft = false;
  });
}

function undercoverAlive(room) {
  return room.players.filter(p => p.ucAlive);
}

function getUndercoverRoomState(room, socketId) {
  const viewer = room.players.find(p => p.id === socketId);
  // Eliminated players watch the rest of the game with everything revealed
  const viewerIsGhost = !!(room.gameStarted && viewer && viewer.ucAlive === false);
  const revealAll = room.gameEnded || viewerIsGhost;
  const players = room.players.map(p => {
    const isSelf = p.id === socketId;
    // Roles stay secret until someone is voted out; a blank can tell from their empty card
    const roleKnown = revealAll || p.ucAlive === false || (isSelf && p.ucRole === 'blank');
    return {
      id: p.id,
      name: p.name,
      host: p.host,
      connected: p.connected,
      isBot: false,
      alive: p.ucAlive !== false,
      left: !!p.ucLeft,
      role: roleKnown ? p.ucRole : null,
      word: (isSelf || revealAll) ? (p.ucWord || null) : null
    };
  });

  const setup = getUndercoverSetup(room);
  const votes = room.ucVotes || [];
  const myVote = votes.find(v => v.voter === socketId);
  // How many of each role this game has, and how many are still in. Everyone who
  // is out has their role revealed, so the remaining counts give nothing away.
  const roleCounts = {};
  if (room.gameStarted) {
    ['civilian', 'undercover', 'blank'].forEach(role => {
      const holders = room.players.filter(p => p.ucRole === role);
      roleCounts[role] = { total: holders.length, alive: holders.filter(p => p.ucAlive).length };
    });
  }
  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    winnerTeam: room.winnerTeam,
    roundPhase: room.roundPhase,
    round: room.ucRound || 0,
    setup: { ...setup, defaultUndercover: defaultUndercoverCount(setup.total), auto: !room.ucSettings || room.ucSettings.undercover === null, error: undercoverSetupError(setup) },
    pair: revealAll ? room.ucPair : null,
    viewerIsGhost,
    roleCounts,
    speakOrder: room.ucSpeakOrder || [],
    speakIndex: room.ucSpeakIndex || 0,
    candidates: room.ucCandidates || null,
    revote: !!room.ucRevote,
    votedIds: votes.map(v => v.voter),
    myVote: myVote ? myVote.target : null,
    earlyVote: room.ucEarlyVote ? {
      ...room.ucEarlyVote,
      needed: undercoverEarlyVoteNeeded(room),
      alive: undercoverAlive(room).length
    } : null,
    earlyProposers: room.ucEarlyProposers || [],
    result: room.ucResult || null,
    next: room.ucNext || null,
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

// Someone who had a special role last game is half as likely to get it again,
// so roles rotate more evenly without it being noticeable
const UNDERCOVER_REPEAT_WEIGHT = 0.5;

function drawWeighted(pool, weightOf) {
  const total = pool.reduce((sum, p) => sum + weightOf(p), 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= weightOf(p);
    if (r < 0) return p;
  }
  return pool[pool.length - 1];
}

function assignUndercoverRoles(room, setup) {
  const pool = shuffle([...room.players]);
  pool.forEach(p => { p.ucRole = 'civilian'; });
  [['blank', setup.blank], ['undercover', setup.undercover]].forEach(([role, count]) => {
    for (let i = 0; i < count; i++) {
      const pick = drawWeighted(pool, p => (p.ucLastRole === role ? UNDERCOVER_REPEAT_WEIGHT : 1));
      pick.ucRole = role;
      pool.splice(pool.indexOf(pick), 1);
    }
  });
  room.players.forEach(p => { p.ucLastRole = p.ucRole; });
}

function startUndercoverGame(room) {
  const setup = getUndercoverSetup(room);
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  resetUndercoverRoom(room);

  // Avoid repeating a pair until the whole bank has been used in this room
  if (!room.ucUsedPairs || room.ucUsedPairs.length >= UNDERCOVER_WORDS.length) room.ucUsedPairs = [];
  const available = UNDERCOVER_WORDS.map((_, i) => i).filter(i => !room.ucUsedPairs.includes(i));
  const pairIndex = available[Math.floor(Math.random() * available.length)];
  room.ucUsedPairs.push(pairIndex);
  const [civilianWord, undercoverWord] = shuffle([...UNDERCOVER_WORDS[pairIndex]]);
  room.ucPair = { civilian: civilianWord, undercover: undercoverWord };

  assignUndercoverRoles(room, setup);
  room.players.forEach(p => {
    p.ucWord = p.ucRole === 'civilian' ? civilianWord : p.ucRole === 'undercover' ? undercoverWord : null;
  });

  const blankText = setup.blank ? `、${setup.blank} 個白板` : '';
  addLog(room, 'system', `🕵️ 誰是臥底開始！這局有 ${setup.civilian} 個平民、${setup.undercover} 個臥底${blankText}。`);
  startUndercoverRound(room);
  broadcastRoomUpdate(room);
}

function startUndercoverRound(room) {
  room.ucRound += 1;
  room.roundPhase = 'speaking';
  room.ucVotes = [];
  room.ucCandidates = null;
  room.ucRevote = false;
  room.ucResult = null;
  room.ucNext = null;
  room.ucEarlyVote = null;
  room.ucEarlyProposers = [];

  // Go around the table from a random starting player; a blank never opens the round
  const alive = undercoverAlive(room);
  const openers = alive.filter(p => p.ucRole !== 'blank');
  const pool = openers.length ? openers : alive;
  const first = pool[Math.floor(Math.random() * pool.length)];
  const start = alive.indexOf(first);
  room.ucSpeakOrder = [...alive.slice(start), ...alive.slice(0, start)].map(p => p.id);
  room.ucSpeakIndex = 0;
  addLog(room, 'system', `🗣️ 第 ${room.ucRound} 輪描述開始，由【${first.name}】先說。`);
}

// Move past speakers who have left; once everyone has spoken, open the vote
function advanceUndercoverSpeaker(room) {
  while (room.ucSpeakIndex < room.ucSpeakOrder.length) {
    const p = room.players.find(pl => pl.id === room.ucSpeakOrder[room.ucSpeakIndex]);
    if (p && p.ucAlive) return;
    room.ucSpeakIndex += 1;
  }
  startUndercoverVoting(room, null);
}

function startUndercoverVoting(room, candidates) {
  room.ucEarlyVote = null;
  room.roundPhase = 'voting';
  room.ucVotes = [];
  room.ucCandidates = candidates;
  room.ucRevote = !!candidates;
  addLog(room, 'system', candidates ? '⚖️ 平票！請在平票的人之中再投一次。' : '🗳️ 描述結束，開始投票！');
}

function undercoverWinner(room) {
  const alive = undercoverAlive(room);
  const bad = alive.filter(p => p.ucRole !== 'civilian').length;
  const good = alive.length - bad;
  if (bad === 0) return 'civilian';
  if (good <= bad) return 'undercover';
  return null;
}

function endUndercoverIfWon(room) {
  const winner = undercoverWinner(room);
  if (!winner) return false;
  room.winnerTeam = winner;
  room.gameEnded = true;
  room.roundPhase = 'game_over';
  room.ucNext = 'end';
  const words = `平民的詞是「${room.ucPair.civilian}」，臥底的詞是「${room.ucPair.undercover}」。`;
  addLog(room, 'system', winner === 'civilian'
    ? `🎉 臥底全部出局，平民獲勝！${words}`
    : `🕵️ 臥底撐到最後，臥底陣營獲勝！${words}`);
  return true;
}

function resolveUndercoverVotes(room) {
  const counts = new Map();
  room.ucVotes.forEach(v => counts.set(v.target, (counts.get(v.target) || 0) + 1));
  const tally = [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  const votes = room.ucVotes.map(v => ({ ...v }));
  const max = tally.length ? tally[0].count : 0;
  const top = tally.filter(t => t.count === max).map(t => t.id);
  const nameOf = (id) => room.players.find(p => p.id === id).name;

  room.roundPhase = 'reveal';
  if (top.length === 1) {
    const out = room.players.find(p => p.id === top[0]);
    out.ucAlive = false;
    room.ucResult = { votes, tally, eliminatedId: out.id, tied: [] };
    addLog(room, 'system', `☠️ ${out.name} 以 ${max} 票出局，身分是【${UNDERCOVER_ROLE_NAMES[out.ucRole]}】。`);
    if (!endUndercoverIfWon(room)) room.ucNext = 'round';
  } else if (!room.ucRevote) {
    room.ucResult = { votes, tally, eliminatedId: null, tied: top };
    room.ucNext = 'revote';
    addLog(room, 'system', `⚖️ ${top.map(nameOf).join('、')} 平票，要在他們之中再投一次。`);
  } else {
    room.ucResult = { votes, tally, eliminatedId: null, tied: top };
    room.ucNext = 'round';
    addLog(room, 'system', '⚖️ 再次平票，這輪沒有人出局。');
  }
}

function maybeResolveUndercoverVotes(room) {
  if (room.roundPhase !== 'voting') return;
  const voters = undercoverAlive(room).filter(p => p.connected);
  if (voters.length && voters.every(p => room.ucVotes.some(v => v.voter === p.id))) {
    resolveUndercoverVotes(room);
  }
}

// A player who leaves for good is out of the game (their role stays secret until the end)
function handleUndercoverDeparture(room, player) {
  if (room.gameEnded || player.ucAlive === false) return;
  player.ucAlive = false;
  player.ucLeft = true;
  if (endUndercoverIfWon(room)) return;

  if (room.roundPhase === 'speaking') {
    checkUndercoverEarlyVote(room);
    if (room.roundPhase === 'speaking') advanceUndercoverSpeaker(room);
  } else if (room.roundPhase === 'voting') {
    // Votes for or by the leaver no longer make sense: start this vote over
    const remaining = room.ucCandidates ? room.ucCandidates.filter(id => id !== player.id) : null;
    startUndercoverVoting(room, remaining && remaining.length >= 2 ? remaining : null);
  }
}

// Early vote: during the descriptions anyone alive can propose skipping straight
// to the vote; it passes once at least 2/3 of the living players agree
function undercoverEarlyVoteNeeded(room) {
  return Math.ceil(undercoverAlive(room).length * 2 / 3);
}

function checkUndercoverEarlyVote(room) {
  const ev = room.ucEarlyVote;
  if (!ev || room.roundPhase !== 'speaking') return;
  const aliveIds = undercoverAlive(room).map(p => p.id);
  ev.yesIds = ev.yesIds.filter(id => aliveIds.includes(id));
  ev.noIds = ev.noIds.filter(id => aliveIds.includes(id));
  const needed = undercoverEarlyVoteNeeded(room);
  const nameOf = (id) => room.players.find(p => p.id === id).name;
  if (ev.yesIds.length >= needed) {
    addLog(room, 'system', `⏩ ${ev.yesIds.length} 人同意提早投票，跳過剩下的描述！`);
    startUndercoverVoting(room, null);
  } else if (aliveIds.length - ev.noIds.length < needed) {
    addLog(room, 'system', `🙅 ${nameOf(ev.proposerId)} 的提早投票提議沒有通過，繼續描述。`);
    room.ucEarlyVote = null;
  }
}

function getUndercoverContext(socket, phase) {
  const room = getRoomBySocket(socket);
  if (!room || room.gameType !== 'undercover' || !room.gameStarted || room.gameEnded) return null;
  if (phase && room.roundPhase !== phase) return null;
  const player = room.players.find(p => p.id === socket.id);
  if (!player) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  // Event: Host sets how many undercovers / blanks the next game has
  socket.on('undercover_settings', ({ undercover, blank } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'undercover' || room.gameStarted) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) return;
    if (!room.ucSettings) room.ucSettings = { undercover: null, blank: 0 };
    if (undercover === null) room.ucSettings.undercover = null; // back to the automatic default
    else if (Number.isInteger(undercover)) room.ucSettings.undercover = Math.max(1, Math.min(4, undercover));
    if (Number.isInteger(blank)) room.ucSettings.blank = Math.max(0, Math.min(3, blank));
    broadcastRoomUpdate(room);
  });

  // Event: The current speaker (or the host, for someone who's away) finishes describing
  socket.on('undercover_doneSpeaking', () => {
    const ctx = getUndercoverContext(socket, 'speaking');
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.id !== room.ucSpeakOrder[room.ucSpeakIndex] && !player.host) return;
    room.ucSpeakIndex += 1;
    advanceUndercoverSpeaker(room);
    broadcastRoomUpdate(room);
  });

  // Event: Propose skipping the rest of the descriptions (once per player per round)
  socket.on('undercover_proposeEarlyVote', () => {
    const ctx = getUndercoverContext(socket, 'speaking');
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.ucAlive || room.ucEarlyVote) return;
    if (room.ucEarlyProposers.includes(player.id)) {
      socket.emit('errorMsg', '這一輪你已經提議過了。');
      return;
    }
    room.ucEarlyProposers.push(player.id);
    room.ucEarlyVote = { proposerId: player.id, yesIds: [player.id], noIds: [] };
    addLog(room, 'system', `🗳️ ${player.name} 提議提早投票，需要 ${undercoverEarlyVoteNeeded(room)} 人同意。`);
    checkUndercoverEarlyVote(room);
    broadcastRoomUpdate(room);
  });

  // Event: Agree / disagree with the early vote proposal
  socket.on('undercover_earlyVoteAnswer', ({ agree } = {}) => {
    const ctx = getUndercoverContext(socket, 'speaking');
    if (!ctx) return;
    const { room, player } = ctx;
    const ev = room.ucEarlyVote;
    if (!ev || !player.ucAlive) return;
    ev.yesIds = ev.yesIds.filter(id => id !== player.id);
    ev.noIds = ev.noIds.filter(id => id !== player.id);
    (agree === true ? ev.yesIds : ev.noIds).push(player.id);
    checkUndercoverEarlyVote(room);
    broadcastRoomUpdate(room);
  });

  // Event: Cast (or change) a secret vote
  socket.on('undercover_vote', ({ targetId } = {}) => {
    const ctx = getUndercoverContext(socket, 'voting');
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.ucAlive) return;
    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.ucAlive || target.id === player.id) return;
    if (room.ucCandidates && !room.ucCandidates.includes(target.id)) return;

    room.ucVotes = room.ucVotes.filter(v => v.voter !== player.id);
    room.ucVotes.push({ voter: player.id, target: target.id });
    maybeResolveUndercoverVotes(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host closes the vote early (e.g. someone dropped off and won't vote)
  socket.on('undercover_forceTally', () => {
    const ctx = getUndercoverContext(socket, 'voting');
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.host || room.ucVotes.length === 0) return;
    resolveUndercoverVotes(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host moves on from the vote result (it stays on screen until then)
  socket.on('undercover_continue', () => {
    const ctx = getUndercoverContext(socket, 'reveal');
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.host) return;
    if (room.ucNext === 'revote') {
      startUndercoverVoting(room, room.ucResult.tied);
    } else {
      startUndercoverRound(room);
    }
    broadcastRoomUpdate(room);
  });
});

// ================= MASCARADE (化裝舞會) GAME ENGINE LOGIC =================
// Every seat has one face-down character card and 6 coins. On your turn you
// either swap (or pretend to swap) your card with someone, peek at your own
// card, or claim to be a character. Others may counter-claim; then everyone
// involved reveals, liars pay 1 coin to the court and the real one uses the
// power. Unchallenged claims just work, true or not. First to 13 coins wins;
// if anyone hits 0 coins, the richest player wins. The table talks in person:
// phones only hold the secret cards and the buttons.

const MASCARADE_MIN_PLAYERS = 4;
const MASCARADE_MAX_PLAYERS = 13;
const MASCARADE_START_COINS = 6;
const MASCARADE_WIN_COINS = 13;
const MASCARADE_FORCED_SWAP_TURNS = 4;

const MASCARADE_ROLES = {
  king: { name: '國王', icon: '👑', desc: '從銀行拿 3 金幣。' },
  queen: { name: '皇后', icon: '👸', desc: '從銀行拿 2 金幣。' },
  judge: { name: '法官', icon: '⚖️', desc: '拿走法院裡所有的金幣。' },
  bishop: { name: '主教', icon: '⛪', desc: '從最有錢的玩家（不含自己）拿 2 金幣。' },
  thief: { name: '小偷', icon: '🦹', desc: '從左右兩邊的玩家各拿 1 金幣。' },
  witch: { name: '女巫', icon: '🧙', desc: '可以把自己全部的金幣和另一位玩家互換。' },
  cheat: { name: '騙子', icon: '🃏', desc: '有 10 枚以上金幣時直接獲勝。' },
  peasant: { name: '農夫', icon: '👨‍🌾', desc: '拿 1 金幣；兩個農夫一起亮牌的話各拿 2 金幣。' },
  spy: { name: '間諜', icon: '🕵️', desc: '偷看自己和另一張牌，再決定要不要交換。' },
  fool: { name: '愚者', icon: '🤡', desc: '拿 1 金幣，並可以交換（或假裝交換）另外兩位玩家的牌，自己不能看。' },
  inquisitor: { name: '審判官', icon: '🔥', desc: '指定一位玩家猜自己的角色，猜錯要付你 4 金幣。' },
  widow: { name: '寡婦', icon: '🖤', desc: '從銀行拿金幣，直到自己有 10 枚。' }
};

// Recommended character sets by player count (4-5 players use 6 cards, the extras go face-down in the middle)
const MASCARADE_BASE_SET = ['king', 'queen', 'judge', 'bishop', 'thief', 'witch'];
function defaultMascaradeSet(playerCount) {
  const set = [...MASCARADE_BASE_SET];
  if (playerCount === 7) set.push('cheat');
  if (playerCount === 8) set.push('peasant');
  if (playerCount >= 9) set.push('cheat', 'peasant');
  if (playerCount >= 10) set.push('spy');
  if (playerCount >= 11) set.push('fool');
  if (playerCount >= 12) set.push('inquisitor');
  if (playerCount >= 13) set.push('widow');
  return set;
}

// A role set lists each role once; the peasant always comes as a pair of cards
function mascaradeCardsFor(roleSet) {
  return roleSet.flatMap(r => (r === 'peasant' ? ['peasant', 'peasant'] : [r]));
}

function getMascaradeSetup(room) {
  const total = room.players.length;
  const settings = room.msSettings || {};
  const roles = Array.isArray(settings.roles) ? settings.roles : defaultMascaradeSet(total);
  const cardsNeeded = Math.max(total, 6);
  return {
    total,
    roles,
    auto: !Array.isArray(settings.roles),
    keepLog: !!settings.keepLog,
    cardCount: mascaradeCardsFor(roles).length,
    cardsNeeded,
    centerCount: cardsNeeded - total
  };
}

function mascaradeSetupError(setup) {
  if (setup.total < MASCARADE_MIN_PLAYERS || setup.total > MASCARADE_MAX_PLAYERS) {
    return `化裝舞會需要 ${MASCARADE_MIN_PLAYERS} 到 ${MASCARADE_MAX_PLAYERS} 名玩家才能開始。`;
  }
  if (setup.cardCount !== setup.cardsNeeded) {
    return `角色牌要剛好 ${setup.cardsNeeded} 張（農夫算 2 張），目前是 ${setup.cardCount} 張。`;
  }
  return null;
}

function resetMascaradeRoom(room) {
  room.msCenter = [];
  room.msCourt = 0;
  room.msTurn = 0;
  room.activePlayerId = null;
  room.msClaim = null;
  room.msAbility = null;
  room.msResult = null;
  room.msLastAction = null;
  room.msRevealLog = [];
  room.msWinners = [];
  room.msCenterStart = [];
  room.msJustRevealedIds = [];
  room.msMustSwap = false;
  room.players.forEach(p => {
    p.msCard = null;
    p.msStartCard = null;
    p.msCoins = 0;
    p.msLeft = false;
  });
}

const msRoleName = (role) => (MASCARADE_ROLES[role] ? `${MASCARADE_ROLES[role].icon}${MASCARADE_ROLES[role].name}` : '?');

function msPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

// Cards can sit with a player or face-down in the middle ("center0", "center1")
function msTargetLabel(room, targetId) {
  if (String(targetId).startsWith('center')) return `中間第 ${Number(String(targetId).slice(6)) + 1} 張牌`;
  const p = msPlayer(room, targetId);
  return p ? p.name : '?';
}

function msGetCard(room, targetId) {
  if (String(targetId).startsWith('center')) return room.msCenter[Number(String(targetId).slice(6))];
  const p = msPlayer(room, targetId);
  return p ? p.msCard : undefined;
}

function msSetCard(room, targetId, card) {
  if (String(targetId).startsWith('center')) room.msCenter[Number(String(targetId).slice(6))] = card;
  else msPlayer(room, targetId).msCard = card;
}

function msValidTarget(room, targetId, excludeIds = []) {
  if (excludeIds.includes(targetId)) return false;
  if (String(targetId).startsWith('center')) {
    const idx = Number(String(targetId).slice(6));
    return Number.isInteger(idx) && idx >= 0 && idx < room.msCenter.length;
  }
  const p = msPlayer(room, targetId);
  return !!p && !p.msLeft;
}

function msSwapCards(room, a, b) {
  const cardA = msGetCard(room, a);
  msSetCard(room, a, msGetCard(room, b));
  msSetCard(room, b, cardA);
}

function msActivePlayers(room) {
  return room.players.filter(p => !p.msLeft);
}

function getMascaradeRoomState(room, socketId) {
  const viewer = msPlayer(room, socketId);
  const revealAll = room.gameEnded || room.roundPhase === 'intro';
  const ability = room.msAbility;
  const setup = getMascaradeSetup(room);

  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    host: p.host,
    connected: p.connected,
    isBot: false,
    left: !!p.msLeft,
    coins: p.msCoins || 0,
    card: revealAll ? p.msCard : null,
    startCard: room.gameEnded ? p.msStartCard : null
  }));

  // Only the spy sees what they peeked at
  let spyView = null;
  if (ability && ability.type === 'spy' && ability.playerId === socketId && ability.targetId) {
    spyView = {
      ownRole: viewer ? viewer.msCard : null,
      targetId: ability.targetId,
      targetLabel: msTargetLabel(room, ability.targetId),
      targetRole: msGetCard(room, ability.targetId)
    };
  }

  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    roundPhase: room.roundPhase,
    setup: { ...setup, error: mascaradeSetupError(setup), defaultRoles: defaultMascaradeSet(setup.total) },
    roleInfo: MASCARADE_ROLES,
    rolesInGame: room.gameStarted ? (room.msRolesInGame || []) : setup.roles,
    center: (room.msCenter || []).map((card, i) => ({
      id: `center${i}`,
      card: revealAll ? card : null,
      startCard: room.gameEnded ? (room.msCenterStart || [])[i] || null : null
    })),
    court: room.msCourt || 0,
    turn: room.msTurn || 0,
    forcedSwap: (room.msTurn || 0) < MASCARADE_FORCED_SWAP_TURNS || !!room.msMustSwap,
    mustSwapAfterReveal: !!room.msMustSwap,
    forcedSwapTurns: MASCARADE_FORCED_SWAP_TURNS,
    winCoins: MASCARADE_WIN_COINS,
    activePlayerId: room.activePlayerId || null,
    claim: room.msClaim ? {
      claimerId: room.msClaim.claimerId,
      role: room.msClaim.role,
      challengerIds: room.msClaim.responses.filter(r => r.challenge).map(r => r.id),
      respondedIds: room.msClaim.responses.map(r => r.id),
      responderIds: msClaimResponders(room).map(p => p.id)
    } : null,
    ability: ability ? {
      type: ability.type,
      playerId: ability.playerId,
      options: ability.options || null,
      targetId: ability.targetId || null
    } : null,
    spyView,
    result: room.msResult || null,
    lastAction: room.msLastAction || null,
    revealLog: setup.keepLog ? (room.msRevealLog || []) : [],
    winners: room.msWinners || [],
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

function startMascaradeGame(room) {
  const setup = getMascaradeSetup(room);
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  resetMascaradeRoom(room);

  room.msRolesInGame = [...setup.roles];
  const cards = shuffle(mascaradeCardsFor(setup.roles));
  room.players.forEach((p, i) => {
    p.msCard = cards[i];
    p.msStartCard = cards[i];
    p.msCoins = MASCARADE_START_COINS;
  });
  room.msCenter = cards.slice(room.players.length);
  room.msCenterStart = [...room.msCenter];

  const first = room.players[Math.floor(Math.random() * room.players.length)];
  room.activePlayerId = first.id;
  room.roundPhase = 'intro';
  addLog(room, 'system', `🎭 化裝舞會開始！先記住大家一開始的角色，房主按下「蓋牌」後由【${first.name}】先開始。`);
  broadcastRoomUpdate(room);
}

function msNextTurn(room) {
  room.msTurn += 1;
  room.msClaim = null;
  room.msAbility = null;
  room.msResult = null;
  const seats = room.players;
  const idx = seats.findIndex(p => p.id === room.activePlayerId);
  for (let step = 1; step <= seats.length; step++) {
    const next = seats[(idx + step) % seats.length];
    if (!next.msLeft) {
      room.activePlayerId = next.id;
      break;
    }
  }
  // A player whose card was revealed during the turn just played already knows
  // who they are, so if it's their turn right away they may only swap
  room.msMustSwap = (room.msJustRevealedIds || []).includes(room.activePlayerId);
  room.msJustRevealedIds = [];
  room.roundPhase = 'action';
}

// Peek and claim are not allowed in the opening turns or right after your card was revealed
function msSwapOnlyError(room) {
  if (room.msTurn < MASCARADE_FORCED_SWAP_TURNS) return `前 ${MASCARADE_FORCED_SWAP_TURNS} 回合只能交換。`;
  if (room.msMustSwap) return '你的牌上一回合剛被翻開，你已經知道自己是誰了，這回合只能交換。';
  return null;
}

// Everyone except the claimer gets to counter-claim (players who left are skipped)
function msClaimResponders(room) {
  const claim = room.msClaim;
  if (!claim) return [];
  return room.players.filter(p => p.id !== claim.claimerId && !p.msLeft);
}

function msPay(from, to, amount) {
  const paid = Math.min(amount, from.msCoins);
  from.msCoins -= paid;
  to.msCoins += paid;
  return paid;
}

function msCheckGameEnd(room, cheatWinnerId) {
  let winners = [];
  const active = msActivePlayers(room);
  if (cheatWinnerId) {
    winners = [cheatWinnerId];
  } else {
    const rich = active.filter(p => p.msCoins >= MASCARADE_WIN_COINS);
    const broke = active.some(p => p.msCoins <= 0);
    if (rich.length || broke) {
      const max = Math.max(...active.map(p => p.msCoins));
      winners = active.filter(p => p.msCoins === max).map(p => p.id);
    }
  }
  if (!winners.length) return false;
  room.msWinners = winners;
  room.gameEnded = true;
  room.roundPhase = 'game_over';
  const names = winners.map(id => msPlayer(room, id).name).join('、');
  addLog(room, 'system', cheatWinnerId ? `🃏 ${names} 是真正的騙子，帶著 10 枚以上金幣獲勝！` : `🏆 遊戲結束！${names} 獲勝！`);
  return true;
}

function resolveMascaradeClaim(room) {
  const claim = room.msClaim;
  const role = claim.role;
  const claimer = msPlayer(room, claim.claimerId);
  // Claimer first, then counter-claimers in seat order after them
  const seats = room.players;
  const start = seats.indexOf(claimer);
  const ordered = [...seats.slice(start), ...seats.slice(0, start)];
  const claimants = ordered.filter(p => p.id === claimer.id || claim.responses.some(r => r.id === p.id && r.challenge));

  const result = { type: 'claim', claimerId: claimer.id, role, reveals: [], effects: [] };
  room.msResult = result;
  let performers;
  if (claimants.length === 1) {
    performers = [claimer];
    result.effects.push(`沒有人質疑，${claimer.name} 以${msRoleName(role)}的身分發動能力（不用亮牌）。`);
  } else {
    result.reveals = claimants.map(p => ({ id: p.id, name: p.name, role: p.msCard, truthful: p.msCard === role }));
    room.msJustRevealedIds = claimants.map(p => p.id);
    if (room.msSettings && room.msSettings.keepLog) {
      room.msRevealLog.push({ turn: room.msTurn + 1, claimRole: role, entries: result.reveals.map(r => ({ name: r.name, role: r.role })) });
    }
    performers = claimants.filter(p => p.msCard === role);
    claimants.filter(p => p.msCard !== role).forEach(p => {
      const paid = Math.min(1, p.msCoins);
      p.msCoins -= paid;
      room.msCourt += paid;
      result.effects.push(`${p.name} 說謊，付 ${paid} 金幣到法院。`);
    });
    if (!performers.length) result.effects.push(`沒有人是真的${msRoleName(role)}，能力不發動。`);
  }
  addLog(room, 'claim', claimants.length === 1
    ? `📢 ${claimer.name} 宣告自己是${msRoleName(role)}，沒有人質疑。`
    : `📢 ${claimer.name} 宣告自己是${msRoleName(role)}，${claimants.slice(1).map(p => p.name).join('、')} 跳出來說自己才是！全部亮牌。`);

  // Apply the power; some powers need the performer to pick something first
  const bothPeasants = role === 'peasant' && performers.length === 2;
  for (const p of performers) {
    if (applyMascaradePower(room, p, role, { bothPeasants })) return; // waiting for a choice
  }
  finishMascaradeClaim(room);
}

// Returns true if the power needs a follow-up choice from the performer
function applyMascaradePower(room, p, role, { bothPeasants } = {}) {
  const fx = room.msResult.effects;
  const others = msActivePlayers(room).filter(o => o.id !== p.id);
  switch (role) {
    case 'king':
      p.msCoins += 3; fx.push(`${p.name} 拿了 3 金幣。`); return false;
    case 'queen':
      p.msCoins += 2; fx.push(`${p.name} 拿了 2 金幣。`); return false;
    case 'judge': {
      const amount = room.msCourt;
      p.msCoins += amount; room.msCourt = 0;
      fx.push(`${p.name} 拿走法院的 ${amount} 金幣。`); return false;
    }
    case 'widow': {
      const gain = Math.max(0, 10 - p.msCoins);
      p.msCoins += gain; fx.push(`${p.name} 補到 10 枚金幣（拿了 ${gain} 枚）。`); return false;
    }
    case 'peasant': {
      const gain = bothPeasants ? 2 : 1;
      p.msCoins += gain; fx.push(`${p.name} 拿了 ${gain} 金幣。`); return false;
    }
    case 'cheat':
      if (p.msCoins >= 10) {
        room.msResult.cheatWinnerId = p.id;
        fx.push(`${p.name} 有 ${p.msCoins} 枚金幣，騙子直接獲勝！`);
      } else {
        fx.push(`${p.name} 只有 ${p.msCoins} 枚金幣，騙子要 10 枚以上才能獲勝。`);
      }
      return false;
    case 'thief': {
      const seats = msActivePlayers(room);
      const i = seats.indexOf(p);
      const neighbours = [...new Set([seats[(i - 1 + seats.length) % seats.length], seats[(i + 1) % seats.length]])].filter(o => o !== p);
      neighbours.forEach(o => {
        const paid = msPay(o, p, 1);
        fx.push(`${p.name} 從 ${o.name} 那裡偷了 ${paid} 金幣。`);
      });
      return false;
    }
    case 'bishop': {
      const max = Math.max(...others.map(o => o.msCoins));
      const richest = others.filter(o => o.msCoins === max);
      if (richest.length === 1) {
        const paid = msPay(richest[0], p, 2);
        fx.push(`${p.name} 從最有錢的 ${richest[0].name} 那裡拿了 ${paid} 金幣。`);
        return false;
      }
      room.msAbility = { type: 'bishop', playerId: p.id, options: richest.map(o => o.id) };
      room.roundPhase = 'ability';
      return true;
    }
    case 'witch':
      room.msAbility = { type: 'witch', playerId: p.id, options: others.map(o => o.id) };
      room.roundPhase = 'ability';
      return true;
    case 'spy':
      room.msAbility = {
        type: 'spy',
        playerId: p.id,
        options: [...others.map(o => o.id), ...room.msCenter.map((_, i) => `center${i}`)],
        targetId: null
      };
      room.roundPhase = 'ability';
      return true;
    case 'fool':
      p.msCoins += 1;
      fx.push(`${p.name} 拿了 1 金幣。`);
      room.msAbility = { type: 'fool', playerId: p.id, options: others.map(o => o.id) };
      room.roundPhase = 'ability';
      return true;
    case 'inquisitor':
      room.msAbility = { type: 'inquisitor', playerId: p.id, options: others.map(o => o.id), targetId: null };
      room.roundPhase = 'ability';
      return true;
    default:
      return false;
  }
}

function finishMascaradeClaim(room) {
  room.msAbility = null;
  room.roundPhase = 'result';
  msCheckGameEnd(room, room.msResult && room.msResult.cheatWinnerId);
}

function msSetLastAction(room, text) {
  room.msLastAction = text;
  addLog(room, 'action', text);
}

// A player who leaves for good keeps their seat (cards stay in play) but is skipped
function handleMascaradeDeparture(room, player) {
  if (room.gameEnded || player.msLeft) return;
  player.msLeft = true;
  if (msActivePlayers(room).length < 2) {
    // Not enough people left to play on: the richest remaining player wins
    const remaining = msActivePlayers(room);
    const max = Math.max(...remaining.map(p => p.msCoins));
    room.msWinners = remaining.filter(p => p.msCoins === max).map(p => p.id);
    room.gameEnded = true;
    room.roundPhase = 'game_over';
    addLog(room, 'system', '🏁 剩下的人不夠繼續，遊戲結束。');
    return;
  }
  if (room.roundPhase === 'claim') {
    maybeResolveMascaradeClaim(room);
  } else if (room.roundPhase === 'ability' && room.msAbility && (room.msAbility.playerId === player.id || room.msAbility.targetId === player.id)) {
    room.msResult.effects.push(`${player.name} 離開了，能力取消。`);
    finishMascaradeClaim(room);
  } else if (room.activePlayerId === player.id && room.roundPhase === 'action') {
    msNextTurn(room);
  }
}

function maybeResolveMascaradeClaim(room) {
  if (room.roundPhase !== 'claim' || !room.msClaim) return;
  const waiting = msClaimResponders(room).filter(p => p.connected && !room.msClaim.responses.some(r => r.id === p.id));
  if (waiting.length === 0) resolveMascaradeClaim(room);
}

function getMascaradeContext(socket, phase) {
  const room = getRoomBySocket(socket);
  if (!room || room.gameType !== 'mascarade' || !room.gameStarted || room.gameEnded) return null;
  if (phase && room.roundPhase !== phase) return null;
  const player = msPlayer(room, socket.id);
  if (!player || player.msLeft) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  // Event: Host changes lobby settings (role set / keep reveal log)
  socket.on('mascarade_settings', ({ roles, keepLog } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'mascarade' || room.gameStarted) return;
    const player = msPlayer(room, socket.id);
    if (!player || !player.host) return;
    if (!room.msSettings) room.msSettings = { roles: null, keepLog: false };
    if (roles === null) room.msSettings.roles = null; // back to the recommended set
    else if (Array.isArray(roles)) {
      room.msSettings.roles = [...new Set(roles.filter(r => MASCARADE_ROLES[r]))];
    }
    if (typeof keepLog === 'boolean') room.msSettings.keepLog = keepLog;
    broadcastRoomUpdate(room);
  });

  // Event: Host ends the opening look at everyone's cards
  socket.on('mascarade_beginPlay', () => {
    const ctx = getMascaradeContext(socket, 'intro');
    if (!ctx || !ctx.player.host) return;
    ctx.room.roundPhase = 'action';
    addLog(ctx.room, 'system', '🙈 大家蓋牌了！遊戲開始。');
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Swap (or pretend to swap) your card with another card
  socket.on('mascarade_swap', ({ targetId, doSwap } = {}) => {
    const ctx = getMascaradeContext(socket, 'action');
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.activePlayerId !== player.id) return;
    if (!msValidTarget(room, targetId, [player.id])) return;
    if (doSwap === true) msSwapCards(room, player.id, targetId);
    msSetLastAction(room, `🔄 ${player.name} 拿了自己和 ${msTargetLabel(room, targetId)} 的牌，交換了…或假裝交換。`);
    msNextTurn(room);
    broadcastRoomUpdate(room);
  });

  // Event: Peek at your own card (shown privately for a few seconds)
  socket.on('mascarade_look', () => {
    const ctx = getMascaradeContext(socket, 'action');
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.activePlayerId !== player.id) return;
    const swapOnly = msSwapOnlyError(room);
    if (swapOnly) {
      socket.emit('errorMsg', swapOnly);
      return;
    }
    socket.emit('mascarade_peek', { cards: [{ label: '你的牌', role: player.msCard }] });
    msSetLastAction(room, `👀 ${player.name} 偷看了自己的牌。`);
    msNextTurn(room);
    broadcastRoomUpdate(room);
  });

  // Event: Claim to be a character
  socket.on('mascarade_claim', ({ role } = {}) => {
    const ctx = getMascaradeContext(socket, 'action');
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.activePlayerId !== player.id) return;
    const swapOnly = msSwapOnlyError(room);
    if (swapOnly) {
      socket.emit('errorMsg', swapOnly);
      return;
    }
    if (!room.msRolesInGame.includes(role)) return;
    room.msClaim = { claimerId: player.id, role, responses: [] };
    room.roundPhase = 'claim';
    room.msLastAction = `📢 ${player.name} 宣告：「我是${msRoleName(role)}！」`;
    broadcastRoomUpdate(room);
  });

  // Event: Others respond to a claim: counter-claim ("No, I am!") or let it go
  socket.on('mascarade_respond', ({ challenge } = {}) => {
    const ctx = getMascaradeContext(socket, 'claim');
    if (!ctx) return;
    const { room, player } = ctx;
    const claim = room.msClaim;
    if (!claim || player.id === claim.claimerId) return;
    if (claim.responses.some(r => r.id === player.id)) return; // answers are final, like saying it out loud
    claim.responses.push({ id: player.id, challenge: challenge === true });
    maybeResolveMascaradeClaim(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host stops waiting for players who haven't responded
  socket.on('mascarade_forceResolve', () => {
    const ctx = getMascaradeContext(socket, 'claim');
    if (!ctx || !ctx.player.host) return;
    resolveMascaradeClaim(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Performer makes the choice their power needs
  socket.on('mascarade_ability', ({ targetId, targetIds, doSwap, skip } = {}) => {
    const ctx = getMascaradeContext(socket, 'ability');
    if (!ctx) return;
    const { room, player } = ctx;
    const ab = room.msAbility;
    if (!ab || ab.playerId !== player.id) return;
    const fx = room.msResult.effects;

    if (ab.type === 'bishop') {
      if (!ab.options.includes(targetId)) return;
      const target = msPlayer(room, targetId);
      const paid = msPay(target, player, 2);
      fx.push(`${player.name} 從最有錢的 ${target.name} 那裡拿了 ${paid} 金幣。`);
      finishMascaradeClaim(room);
    } else if (ab.type === 'witch') {
      if (skip === true) {
        fx.push(`${player.name} 決定不交換金幣。`);
      } else {
        if (!ab.options.includes(targetId)) return;
        const target = msPlayer(room, targetId);
        [player.msCoins, target.msCoins] = [target.msCoins, player.msCoins];
        fx.push(`${player.name} 和 ${target.name} 交換了全部金幣（${target.msCoins} ⇄ ${player.msCoins}）。`);
      }
      finishMascaradeClaim(room);
    } else if (ab.type === 'spy') {
      if (!ab.targetId) {
        if (!ab.options.includes(targetId)) return;
        ab.targetId = targetId; // spy now sees both cards in their own state
      } else {
        if (doSwap === true) msSwapCards(room, player.id, ab.targetId);
        fx.push(`${player.name} 偷看了自己和 ${msTargetLabel(room, ab.targetId)} 的牌，交換了…或假裝交換。`);
        finishMascaradeClaim(room);
      }
    } else if (ab.type === 'fool') {
      if (skip === true) {
        fx.push(`${player.name} 沒有動別人的牌。`);
      } else {
        if (!Array.isArray(targetIds) || targetIds.length !== 2 || targetIds[0] === targetIds[1]) return;
        if (!targetIds.every(id => ab.options.includes(id))) return;
        if (doSwap === true) msSwapCards(room, targetIds[0], targetIds[1]);
        fx.push(`${player.name} 拿了 ${msTargetLabel(room, targetIds[0])} 和 ${msTargetLabel(room, targetIds[1])} 的牌，交換了…或假裝交換。`);
      }
      finishMascaradeClaim(room);
    } else if (ab.type === 'inquisitor') {
      if (ab.targetId || !ab.options.includes(targetId)) return;
      ab.targetId = targetId;
      ab.type = 'inquisition';
      fx.push(`${player.name} 指定 ${msPlayer(room, targetId).name} 猜自己的角色。`);
    }
    broadcastRoomUpdate(room);
  });

  // Event: The player picked by the inquisitor guesses their own character
  socket.on('mascarade_inquisitionGuess', ({ role } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'mascarade' || room.roundPhase !== 'ability') return;
    const ab = room.msAbility;
    if (!ab || ab.type !== 'inquisition' || ab.targetId !== socket.id) return;
    if (!room.msRolesInGame.includes(role)) return;
    const target = msPlayer(room, socket.id);
    const inquisitor = msPlayer(room, ab.playerId);
    const fx = room.msResult.effects;
    const correct = target.msCard === role;
    room.msResult.reveals.push({ id: target.id, name: target.name, role: target.msCard, truthful: correct });
    room.msJustRevealedIds = [...new Set([...(room.msJustRevealedIds || []), target.id])];
    if (room.msSettings && room.msSettings.keepLog) {
      room.msRevealLog.push({ turn: room.msTurn + 1, claimRole: 'inquisitor', entries: [{ name: target.name, role: target.msCard }] });
    }
    if (correct) {
      fx.push(`${target.name} 猜自己是${msRoleName(role)}，猜對了！`);
    } else {
      const paid = msPay(target, inquisitor, 4);
      fx.push(`${target.name} 猜自己是${msRoleName(role)}，猜錯了，付給 ${inquisitor.name} ${paid} 金幣。`);
    }
    finishMascaradeClaim(room);
    broadcastRoomUpdate(room);
  });

  // Event: Move on from the claim result (the claimer or the host)
  socket.on('mascarade_continue', () => {
    const ctx = getMascaradeContext(socket, 'result');
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.host && room.activePlayerId !== player.id) return;
    msNextTurn(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host cancels a power that is stuck waiting on someone who is away
  socket.on('mascarade_cancelAbility', () => {
    const ctx = getMascaradeContext(socket, 'ability');
    if (!ctx || !ctx.player.host) return;
    ctx.room.msResult.effects.push('房主取消了這次的能力。');
    finishMascaradeClaim(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Host skips a player who is away
  socket.on('mascarade_skipTurn', () => {
    const ctx = getMascaradeContext(socket, 'action');
    if (!ctx || !ctx.player.host) return;
    const { room } = ctx;
    const active = msPlayer(room, room.activePlayerId);
    msSetLastAction(room, `⏭️ 房主跳過了 ${active ? active.name : '?'} 的回合。`);
    msNextTurn(room);
    broadcastRoomUpdate(room);
  });
});

// ================= ONE NIGHT WEREWOLF (一夜終極狼人) GAME ENGINE LOGIC =================
// Cards = players + 3 (three face down in the middle). There is one night:
// everyone does their night action on their phone at the same time and the
// server applies the card moves in the official order (robber, troublemaker,
// drunk), so phones never reveal who woke up. Then the table talks face to
// face, everyone votes once, and teams are judged by the cards people end with.

const WEREWOLF_MIN_PLAYERS = 3;
const WEREWOLF_MAX_PLAYERS = 10;
const WEREWOLF_CENTER = 3;

const WEREWOLF_ROLES = {
  werewolf: { name: '狼人', icon: '🐺', team: 'werewolf', max: 2, desc: '晚上和其他狼人互相確認。只有你一隻狼人的話，可以偷看中間 1 張牌。' },
  minion: { name: '爪牙', icon: '😈', team: 'werewolf', max: 1, desc: '晚上看得到誰是狼人（狼人不知道你）。和狼人同一陣營，你死了但狼人沒死，狼人陣營也算贏。' },
  mason: { name: '守夜人', icon: '👷', team: 'village', max: 2, desc: '晚上和另一位守夜人互相確認。' },
  seer: { name: '預言家', icon: '🔮', team: 'village', max: 1, desc: '晚上偷看一位玩家的牌，或中間 2 張牌。' },
  robber: { name: '強盜', icon: '🦹', team: 'village', max: 1, desc: '晚上可以和一位玩家換牌，並看自己換到什麼，之後就是那個身分。' },
  troublemaker: { name: '搗蛋鬼', icon: '🃏', team: 'village', max: 1, desc: '晚上可以交換另外兩位玩家的牌，自己不能看。' },
  drunk: { name: '酒鬼', icon: '🍺', team: 'village', max: 1, desc: '晚上一定要拿自己的牌和中間 1 張交換，不能看。' },
  insomniac: { name: '失眠者', icon: '😴', team: 'village', max: 1, desc: '天亮前看自己最後的牌。' },
  hunter: { name: '獵人', icon: '🏹', team: 'village', max: 1, desc: '沒有夜晚行動。你被票死的話，你投的那個人也一起死。' },
  tanner: { name: '皮匠', icon: '🪡', team: 'tanner', max: 1, desc: '你討厭這份工作。沒有夜晚行動，被票死你就單獨獲勝。' },
  villager: { name: '村民', icon: '🙂', team: 'village', max: 3, desc: '沒有特殊能力，靠推理找出狼人。' }
};
const WEREWOLF_ROLE_ORDER = ['werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'hunter', 'tanner', 'villager'];

function defaultWerewolfCounts(playerCount) {
  const c = { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 };
  if (playerCount >= 4) c.drunk = 1;
  if (playerCount >= 5) c.insomniac = 1;
  if (playerCount >= 6) c.minion = 1;
  if (playerCount >= 7) c.hunter = 1;
  if (playerCount >= 8) c.tanner = 1;
  if (playerCount >= 9) { c.mason = 2; c.villager = 0; }
  if (playerCount >= 10) c.villager = 1;
  return c;
}

// Recommended set for every supported player count, shown in the lobby
const WEREWOLF_RECOMMENDED = [];
for (let n = WEREWOLF_MIN_PLAYERS; n <= WEREWOLF_MAX_PLAYERS; n++) {
  WEREWOLF_RECOMMENDED.push({ players: n, counts: defaultWerewolfCounts(n) });
}

function werewolfCardList(counts) {
  return WEREWOLF_ROLE_ORDER.flatMap(r => Array(counts[r] || 0).fill(r));
}

function getWerewolfSetup(room) {
  const total = room.players.length;
  const settings = room.wwSettings || {};
  const counts = settings.counts || defaultWerewolfCounts(total);
  const cards = werewolfCardList(counts);
  return {
    total,
    counts,
    auto: !settings.counts,
    cardCount: cards.length,
    cardsNeeded: total + WEREWOLF_CENTER,
    discussMinutes: settings.discussMinutes || 5
  };
}

function werewolfSetupError(setup) {
  if (setup.total < WEREWOLF_MIN_PLAYERS || setup.total > WEREWOLF_MAX_PLAYERS) {
    return `一夜終極狼人需要 ${WEREWOLF_MIN_PLAYERS} 到 ${WEREWOLF_MAX_PLAYERS} 名玩家才能開始。`;
  }
  if (setup.cardCount !== setup.cardsNeeded) {
    return `身分牌要剛好 ${setup.cardsNeeded} 張（人數＋3），目前是 ${setup.cardCount} 張。`;
  }
  if (!setup.counts.werewolf) return '至少要有 1 張狼人。';
  return null;
}

function resetWerewolfRoom(room) {
  clearTimeout(room.wwDayTimer);
  room.wwDayTimer = null;
  room.wwCenterStart = [];
  room.wwCenter = [];
  room.wwNightLog = [];
  room.wwVotes = [];
  room.wwDayEndsAt = null;
  room.wwResult = null;
  room.players.forEach(p => {
    p.wwStart = null;
    p.wwCard = null;
    p.wwNightDone = false;
    p.wwNightAction = null;
    p.wwNightInfo = [];
    p.wwLeft = false;
  });
}

const wwRoleName = (role) => (WEREWOLF_ROLES[role] ? `${WEREWOLF_ROLES[role].icon}${WEREWOLF_ROLES[role].name}` : '?');
const wwPlayer = (room, id) => room.players.find(p => p.id === id);

function startWerewolfGame(room) {
  const setup = getWerewolfSetup(room);
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  resetWerewolfRoom(room);

  const cards = shuffle(werewolfCardList(setup.counts));
  room.players.forEach((p, i) => {
    p.wwStart = cards[i];
    p.wwCard = cards[i];
  });
  room.wwCenterStart = cards.slice(room.players.length);
  room.wwCenter = [...room.wwCenterStart];
  room.wwRolesInGame = WEREWOLF_ROLE_ORDER.filter(r => setup.counts[r]).map(r => ({ role: r, count: setup.counts[r] }));
  room.wwDiscussMinutes = setup.discussMinutes;
  room.roundPhase = 'night';

  // Information some roles get just by waking up
  const startOf = (role) => room.players.filter(p => p.wwStart === role);
  room.players.forEach(p => {
    if (p.wwStart === 'werewolf') {
      const others = startOf('werewolf').filter(o => o !== p).map(o => o.name);
      p.wwNightInfo.push(others.length ? `另一隻狼人是：${others.join('、')}` : '你是唯一的狼人！可以偷看中間 1 張牌。');
    } else if (p.wwStart === 'minion') {
      const wolves = startOf('werewolf').map(o => o.name);
      p.wwNightInfo.push(wolves.length ? `狼人是：${wolves.join('、')}` : '場上沒有玩家拿到狼人（都在中間）。');
    } else if (p.wwStart === 'mason') {
      const others = startOf('mason').filter(o => o !== p).map(o => o.name);
      p.wwNightInfo.push(others.length ? `另一位守夜人是：${others.join('、')}` : '另一張守夜人在中間，你是唯一的守夜人。');
    }
  });

  addLog(room, 'system', '🌙 天黑請閉眼……每個人在自己的手機上完成夜晚行動。');
  broadcastRoomUpdate(room);
}

// Validate a night action for the player's starting role; returns an error string or null
function werewolfNightError(room, p, action) {
  const others = room.players.filter(o => o !== p);
  const isOther = (id) => others.some(o => o.id === id);
  const isCenter = (i) => Number.isInteger(i) && i >= 0 && i < WEREWOLF_CENTER;
  const lone = room.players.filter(o => o.wwStart === 'werewolf').length === 1;
  switch (p.wwStart) {
    case 'werewolf':
      if (lone && action.centerIndex !== undefined && !isCenter(action.centerIndex)) return '請選中間的牌。';
      return null;
    case 'seer':
      if (action.skip) return null;
      if (action.playerId !== undefined) return isOther(action.playerId) ? null : '請選一位其他玩家。';
      if (Array.isArray(action.centerIndexes) && action.centerIndexes.length === 2
        && action.centerIndexes.every(isCenter) && action.centerIndexes[0] !== action.centerIndexes[1]) return null;
      return '請選一位玩家，或中間 2 張牌。';
    case 'robber':
      if (action.skip) return null;
      return isOther(action.playerId) ? null : '請選一位其他玩家。';
    case 'troublemaker':
      if (action.skip) return null;
      if (Array.isArray(action.playerIds) && action.playerIds.length === 2
        && action.playerIds.every(isOther) && action.playerIds[0] !== action.playerIds[1]) return null;
      return '請選兩位其他玩家。';
    case 'drunk':
      return isCenter(action.centerIndex) ? null : '請選中間的一張牌。';
    default:
      return null;
  }
}

// Looks that happen before any card moves are answered right away
function werewolfImmediateInfo(room, p, action) {
  if (p.wwStart === 'werewolf' && action.centerIndex !== undefined) {
    p.wwNightInfo.push(`你偷看了中間第 ${action.centerIndex + 1} 張：${wwRoleName(room.wwCenterStart[action.centerIndex])}`);
  } else if (p.wwStart === 'seer' && action.playerId !== undefined) {
    const t = wwPlayer(room, action.playerId);
    p.wwNightInfo.push(`你看了 ${t.name} 的牌：${wwRoleName(t.wwStart)}`);
  } else if (p.wwStart === 'seer' && action.centerIndexes) {
    p.wwNightInfo.push(`你看了中間的牌：${action.centerIndexes.map(i => `第 ${i + 1} 張 ${wwRoleName(room.wwCenterStart[i])}`).join('、')}`);
  } else if (p.wwStart === 'robber' && action.playerId !== undefined) {
    const t = wwPlayer(room, action.playerId);
    // Nothing moves before the robber, so the target still holds their starting card
    p.wwNightInfo.push(`你搶了 ${t.name} 的牌，現在你是：${wwRoleName(t.wwStart)}`);
  }
}

function maybeEndWerewolfNight(room) {
  if (room.roundPhase !== 'night') return;
  const waiting = room.players.filter(p => p.connected && !p.wwLeft && !p.wwNightDone);
  if (waiting.length === 0) endWerewolfNight(room);
}

// Apply card moves in the official order, then dawn
function endWerewolfNight(room) {
  const log = room.wwNightLog;
  const byStart = (role) => room.players.filter(p => p.wwStart === role);
  const swap = (a, b) => { [a.wwCard, b.wwCard] = [b.wwCard, a.wwCard]; };

  byStart('werewolf').forEach(p => {
    if (p.wwNightAction && p.wwNightAction.centerIndex !== undefined) log.push(`🐺 ${p.name}（唯一的狼人）偷看了中間第 ${p.wwNightAction.centerIndex + 1} 張：${wwRoleName(room.wwCenterStart[p.wwNightAction.centerIndex])}`);
  });
  byStart('seer').forEach(p => {
    const a = p.wwNightAction || {};
    if (a.playerId) log.push(`🔮 預言家 ${p.name} 看了 ${wwPlayer(room, a.playerId).name} 的牌（${wwRoleName(wwPlayer(room, a.playerId).wwStart)}）`);
    else if (a.centerIndexes) log.push(`🔮 預言家 ${p.name} 看了中間第 ${a.centerIndexes.map(i => i + 1).join('、')} 張`);
  });
  byStart('robber').forEach(p => {
    const a = p.wwNightAction || {};
    if (a.playerId) {
      const t = wwPlayer(room, a.playerId);
      swap(p, t);
      log.push(`🦹 強盜 ${p.name} 搶了 ${t.name} 的牌，變成${wwRoleName(p.wwCard)}`);
    }
  });
  byStart('troublemaker').forEach(p => {
    const a = p.wwNightAction || {};
    if (a.playerIds) {
      const [x, y] = a.playerIds.map(id => wwPlayer(room, id));
      swap(x, y);
      log.push(`🃏 搗蛋鬼 ${p.name} 交換了 ${x.name} 和 ${y.name} 的牌`);
    }
  });
  byStart('drunk').forEach(p => {
    // A drunk who never acted (left / skipped by the host) still has to swap
    const idx = p.wwNightAction && Number.isInteger(p.wwNightAction.centerIndex) ? p.wwNightAction.centerIndex : Math.floor(Math.random() * WEREWOLF_CENTER);
    [p.wwCard, room.wwCenter[idx]] = [room.wwCenter[idx], p.wwCard];
    log.push(`🍺 酒鬼 ${p.name} 拿自己的牌換了中間第 ${idx + 1} 張`);
  });
  byStart('insomniac').forEach(p => {
    p.wwNightInfo.push(`天亮前你看了自己的牌：${wwRoleName(p.wwCard)}`);
    log.push(`😴 失眠者 ${p.name} 醒來看到自己是${wwRoleName(p.wwCard)}`);
  });

  room.roundPhase = 'day';
  room.wwDayEndsAt = Date.now() + room.wwDiscussMinutes * 60 * 1000;
  clearTimeout(room.wwDayTimer);
  room.wwDayTimer = setTimeout(() => {
    if (rooms.get(room.roomCode) !== room || room.roundPhase !== 'day') return;
    startWerewolfVoting(room);
    broadcastRoomUpdate(room);
  }, room.wwDiscussMinutes * 60 * 1000);
  addLog(room, 'system', `☀️ 天亮了！討論 ${room.wwDiscussMinutes} 分鐘後投票。`);
}

function startWerewolfVoting(room) {
  clearTimeout(room.wwDayTimer);
  room.wwDayTimer = null;
  room.roundPhase = 'voting';
  room.wwVotes = [];
  addLog(room, 'system', '🗳️ 投票時間！');
}

function maybeResolveWerewolfVotes(room) {
  if (room.roundPhase !== 'voting') return;
  const voters = room.players.filter(p => p.connected && !p.wwLeft);
  if (voters.every(p => room.wwVotes.some(v => v.voter === p.id))) resolveWerewolfVotes(room);
}

function resolveWerewolfVotes(room) {
  const counts = new Map();
  room.wwVotes.forEach(v => counts.set(v.target, (counts.get(v.target) || 0) + 1));
  const max = Math.max(0, ...counts.values());
  // Nobody dies unless someone got at least 2 votes; ties all die
  let dead = max >= 2 ? [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id) : [];
  const events = [];
  if (!dead.length) events.push('沒有人得到 2 票以上，沒有人死亡。');
  // A dying hunter takes the person they voted for along
  dead.forEach(id => {
    const p = wwPlayer(room, id);
    if (p.wwCard === 'hunter') {
      const shot = room.wwVotes.find(v => v.voter === id);
      if (shot && !dead.includes(shot.target)) {
        dead.push(shot.target);
        events.push(`🏹 ${p.name} 是獵人，帶走了 ${wwPlayer(room, shot.target).name}！`);
      }
    }
  });

  const deadPlayers = dead.map(id => wwPlayer(room, id));
  const isWolf = (p) => p.wwCard === 'werewolf';
  const wolvesInPlay = room.players.filter(isWolf);
  const wolfDied = deadPlayers.some(isWolf);
  const tannerDied = deadPlayers.some(p => p.wwCard === 'tanner');
  const winners = new Set();
  if (tannerDied) winners.add('tanner');
  if (wolvesInPlay.length) {
    if (wolfDied) winners.add('village');
    else if (!tannerDied) winners.add('werewolf');
  } else {
    // No werewolf among the players: the village wins if nobody dies;
    // a minion wins if someone else dies
    const minionDied = deadPlayers.some(p => p.wwCard === 'minion');
    if (!deadPlayers.length) winners.add('village');
    else if (room.players.some(p => p.wwCard === 'minion') && !minionDied && !tannerDied) winners.add('werewolf');
  }

  const teamOf = (p) => WEREWOLF_ROLES[p.wwCard].team;
  room.wwResult = {
    votes: room.wwVotes.map(v => ({ ...v })),
    tally: [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    dead,
    events,
    winningTeams: [...winners],
    winnerIds: room.players.filter(p => winners.has(teamOf(p))).map(p => p.id)
  };
  room.roundPhase = 'game_over';
  room.gameEnded = true;
  const teamNames = { village: '好人陣營', werewolf: '狼人陣營', tanner: '皮匠' };
  addLog(room, 'system', winners.size ? `🏁 ${[...winners].map(t => teamNames[t]).join('、')}獲勝！` : '🏁 這局沒有任何陣營獲勝。');
}

function getWerewolfRoomState(room, socketId) {
  const me = wwPlayer(room, socketId);
  const reveal = room.gameEnded;
  const setup = getWerewolfSetup(room);
  const votes = room.wwVotes || [];
  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    host: p.host,
    connected: p.connected,
    isBot: false,
    left: !!p.wwLeft,
    nightDone: !!p.wwNightDone,
    startRole: reveal ? p.wwStart : null,
    finalRole: reveal ? p.wwCard : null
  }));
  const myVote = votes.find(v => v.voter === socketId);
  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    roundPhase: room.roundPhase,
    setup: { ...setup, error: werewolfSetupError(setup), defaultCounts: defaultWerewolfCounts(setup.total) },
    recommended: WEREWOLF_RECOMMENDED,
    roleInfo: WEREWOLF_ROLES,
    roleOrder: WEREWOLF_ROLE_ORDER,
    rolesInGame: room.gameStarted ? (room.wwRolesInGame || []) : [],
    dayEndsAt: room.wwDayEndsAt || null,
    serverNow: Date.now(),
    votedIds: votes.map(v => v.voter),
    myVote: myVote ? myVote.target : null,
    my: me ? {
      startRole: me.wwStart,
      nightDone: !!me.wwNightDone,
      nightInfo: me.wwNightInfo || [],
      loneWolf: me.wwStart === 'werewolf' && room.players.filter(o => o.wwStart === 'werewolf').length === 1
    } : null,
    center: reveal ? { start: room.wwCenterStart, final: room.wwCenter } : null,
    nightLog: reveal ? room.wwNightLog : [],
    result: room.wwResult || null,
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

function handleWerewolfDeparture(room, player) {
  if (room.gameEnded || player.wwLeft) return;
  player.wwLeft = true;
  if (room.roundPhase === 'night') maybeEndWerewolfNight(room);
  else if (room.roundPhase === 'voting') maybeResolveWerewolfVotes(room);
}

function getWerewolfContext(socket, phase) {
  const room = getRoomBySocket(socket);
  if (!room || room.gameType !== 'werewolf' || !room.gameStarted || room.gameEnded) return null;
  if (phase && room.roundPhase !== phase) return null;
  const player = wwPlayer(room, socket.id);
  if (!player || player.wwLeft) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  // Event: Host changes the role counts / discussion time
  socket.on('werewolf_settings', ({ counts, discussMinutes } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'werewolf' || room.gameStarted) return;
    const player = wwPlayer(room, socket.id);
    if (!player || !player.host) return;
    if (!room.wwSettings) room.wwSettings = { counts: null, discussMinutes: 5 };
    if (counts === null) room.wwSettings.counts = null; // back to the recommended set
    else if (counts && typeof counts === 'object') {
      const clean = {};
      WEREWOLF_ROLE_ORDER.forEach(r => {
        const n = Number(counts[r]) || 0;
        clean[r] = Math.max(0, Math.min(WEREWOLF_ROLES[r].max, Math.floor(n)));
      });
      room.wwSettings.counts = clean;
    }
    if (Number.isInteger(discussMinutes)) room.wwSettings.discussMinutes = Math.max(1, Math.min(15, discussMinutes));
    broadcastRoomUpdate(room);
  });

  // Event: Submit your night action (everyone submits, even roles without one)
  socket.on('werewolf_night', (action = {}) => {
    const ctx = getWerewolfContext(socket, 'night');
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.wwNightDone) return;
    const error = werewolfNightError(room, player, action);
    if (error) {
      socket.emit('errorMsg', error);
      return;
    }
    player.wwNightAction = action;
    player.wwNightDone = true;
    werewolfImmediateInfo(room, player, action);
    maybeEndWerewolfNight(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host ends the night for players who are away
  socket.on('werewolf_forceDawn', () => {
    const ctx = getWerewolfContext(socket, 'night');
    if (!ctx || !ctx.player.host) return;
    endWerewolfNight(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Host cuts the discussion short and opens the vote
  socket.on('werewolf_startVoting', () => {
    const ctx = getWerewolfContext(socket, 'day');
    if (!ctx || !ctx.player.host) return;
    startWerewolfVoting(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Vote for someone (can be changed until everyone has voted)
  socket.on('werewolf_vote', ({ targetId } = {}) => {
    const ctx = getWerewolfContext(socket, 'voting');
    if (!ctx) return;
    const { room, player } = ctx;
    const target = wwPlayer(room, targetId);
    if (!target || target.id === player.id) return;
    room.wwVotes = room.wwVotes.filter(v => v.voter !== player.id);
    room.wwVotes.push({ voter: player.id, target: target.id });
    maybeResolveWerewolfVotes(room);
    broadcastRoomUpdate(room);
  });

  // Event: Host closes the vote early
  socket.on('werewolf_forceTally', () => {
    const ctx = getWerewolfContext(socket, 'voting');
    if (!ctx || !ctx.player.host) return;
    resolveWerewolfVotes(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });
});

// ================= DECRYPTO (截碼戰) =================
const DECRYPTO_MAX_PLAYERS = 12;
const DECRYPTO_MAX_ROUNDS = 8;
const DECRYPTO_TARGET_DEFAULT = 2;
const DECRYPTO_TARGET_MIN = 1;
const DECRYPTO_TARGET_MAX = 4;
// Time limit for each guessing turn (host setting, 0 = no limit). When it runs
// out, teams that haven't sent get 5 more seconds; then the guess is settled.
const DECRYPTO_GUESS_SECONDS = [0, 60, 90, 120, 180, 240];
const DECRYPTO_GUESS_DEFAULT = 120;
const DECRYPTO_GRACE_MS = 5000;
// Phones auto-send a complete pick at the end of the grace period; wait a moment for it
const DECRYPTO_AUTOSEND_WAIT_MS = 1500;
const DECRYPTO_TEAM_NAMES = ['🔵 藍隊', '🔴 紅隊'];
// All 24 codes: three different digits from 1-4
const DECRYPTO_CODES = (() => {
  const codes = [];
  for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) for (let c = 1; c <= 4; c++) {
    if (a !== b && b !== c && a !== c) codes.push([a, b, c]);
  }
  return codes;
})();

const dcPlayer = (room, id) => room.players.find(p => p.id === id);
const dcActiveMembers = (room, team) => room.players.filter(p => p.dcTeam === team && !p.dcLeft);
const dcCodeText = (code) => (code ? code.join('-') : '?');
// Tokens needed to decide the game (host setting); every extra token adds 2 rounds
const decryptoTarget = (room) => (room.dcSettings && room.dcSettings.target) || DECRYPTO_TARGET_DEFAULT;
const decryptoMaxRounds = (target) => DECRYPTO_MAX_ROUNDS + (target - DECRYPTO_TARGET_DEFAULT) * 2;
const decryptoGuessSeconds = (room) => {
  const v = room.dcSettings && room.dcSettings.guessSeconds;
  return DECRYPTO_GUESS_SECONDS.includes(v) ? v : DECRYPTO_GUESS_DEFAULT;
};

function isValidDecryptoCode(code) {
  return Array.isArray(code) && code.length === 3 && code.every(d => Number.isInteger(d) && d >= 1 && d <= 4) && new Set(code).size === 3;
}

// Lobby: everyone without a team joins the smaller one
function ensureDecryptoTeams(room) {
  room.players.forEach(p => {
    if (p.dcTeam === 0 || p.dcTeam === 1) return;
    const size = (t) => room.players.filter(o => o.dcTeam === t).length;
    p.dcTeam = size(0) <= size(1) ? 0 : 1;
  });
}

function decryptoSetupError(room) {
  const sizes = [0, 1].map(t => room.players.filter(p => p.dcTeam === t).length);
  if (room.players.length < 4) return '至少要 4 個人（兩隊各 2 人）才能開始。';
  if (sizes[0] < 2 || sizes[1] < 2) return '每一隊至少要 2 個人。';
  return null;
}

function resetDecryptoRoom(room) {
  room.dcWords = [[], []];
  room.dcRound = 0;
  room.dcEncIdx = [-1, -1];
  room.dcEncryptors = [null, null];
  room.dcCodeDecks = [[], []];
  room.dcCodes = [null, null];
  room.dcClues = [null, null];
  room.dcActive = 0;
  room.dcGuess = null;
  room.dcHistory = [];
  room.dcResult = null;
  clearTimeout(room.dcGuessTimer);
  room.dcGuessTimer = null;
  room.players.forEach(p => { p.dcLeft = false; });
}

function startDecryptoGame(room) {
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  resetDecryptoRoom(room);
  room.dcTarget = decryptoTarget(room);
  room.dcMaxRounds = decryptoMaxRounds(room.dcTarget);
  room.dcGuessSeconds = decryptoGuessSeconds(room);
  const words = shuffle([...DECRYPTO_WORDS]);
  room.dcWords = [words.slice(0, 4), words.slice(4, 8)];
  room.dcCodeDecks = [shuffle(DECRYPTO_CODES.map(c => [...c])), shuffle(DECRYPTO_CODES.map(c => [...c]))];
  addLog(room, 'system', '🔐 截碼戰開始！兩隊各拿到 4 個關鍵字。');
  startDecryptoRound(room);
}

function pickDecryptoEncryptor(room, team) {
  const members = dcActiveMembers(room, team);
  if (!members.length) return null;
  room.dcEncIdx[team] = (room.dcEncIdx[team] + 1) % members.length;
  return members[room.dcEncIdx[team]].id;
}

function startDecryptoRound(room) {
  room.dcRound += 1;
  room.roundPhase = 'clue';
  room.dcActive = 0;
  room.dcGuess = null;
  [0, 1].forEach(t => {
    room.dcEncryptors[t] = pickDecryptoEncryptor(room, t);
    room.dcCodes[t] = room.dcCodeDecks[t].pop();
    room.dcClues[t] = null;
  });
  const names = [0, 1].map(t => `${DECRYPTO_TEAM_NAMES[t]} ${(dcPlayer(room, room.dcEncryptors[t]) || {}).name || '?'}`);
  addLog(room, 'system', `📡 第 ${room.dcRound} 回合：這回合的加密者是 ${names.join('、')}。`);
}

function startDecryptoGuessing(room, team) {
  room.roundPhase = 'guess';
  room.dcActive = team;
  const seconds = room.dcGuessSeconds;
  const endsAt = seconds ? Date.now() + seconds * 1000 : null;
  room.dcGuess = {
    decode: null, decodeBy: null,
    intercept: null, interceptBy: null,
    interceptAllowed: room.dcRound > 1,
    endsAt,
    graceEndsAt: endsAt ? endsAt + DECRYPTO_GRACE_MS : null
  };
  clearTimeout(room.dcGuessTimer);
  room.dcGuessTimer = null;
  if (endsAt) {
    const guess = room.dcGuess;
    room.dcGuessTimer = setTimeout(() => {
      room.dcGuessTimer = null;
      if (room.dcGuess !== guess || room.roundPhase !== 'guess' || room.gameEnded) return;
      addLog(room, 'system', '⏰ 時間到！還沒送出的隊伍當作沒猜。');
      forceRevealDecrypto(room);
      broadcastRoomUpdate(room);
    }, endsAt + DECRYPTO_GRACE_MS + DECRYPTO_AUTOSEND_WAIT_MS - Date.now());
  }
}

// Settle the current guess now: a missing decode counts as wrong, a missing intercept as no attempt
function forceRevealDecrypto(room) {
  const g = room.dcGuess;
  if (!g || room.roundPhase !== 'guess') return;
  if (!g.decode) g.decode = [0, 0, 0];
  if (!g.intercept) g.interceptAllowed = false;
  revealDecrypto(room);
}

function maybeRevealDecrypto(room) {
  const g = room.dcGuess;
  if (!g || room.roundPhase !== 'guess') return;
  if (g.decode && (g.intercept || !g.interceptAllowed)) revealDecrypto(room);
}

function revealDecrypto(room) {
  clearTimeout(room.dcGuessTimer);
  room.dcGuessTimer = null;
  const t = room.dcActive;
  const g = room.dcGuess;
  const code = room.dcCodes[t];
  const same = (a) => !!a && a.every((d, i) => d === code[i]);
  const entry = {
    round: room.dcRound,
    team: t,
    encryptorId: room.dcEncryptors[t],
    clues: room.dcClues[t],
    code,
    decode: g.decode,
    decodeOk: same(g.decode),
    intercept: g.interceptAllowed ? g.intercept : null,
    interceptOk: g.interceptAllowed ? same(g.intercept) : null
  };
  room.dcHistory.push(entry);
  room.roundPhase = 'reveal';
  const parts = [`密碼是 ${dcCodeText(code)}`];
  parts.push(entry.decodeOk ? `${DECRYPTO_TEAM_NAMES[t]}解碼成功` : `${DECRYPTO_TEAM_NAMES[t]}解碼失敗（猜 ${dcCodeText(g.decode)}），得到 1 個❌失誤`);
  if (entry.interceptOk) parts.push(`${DECRYPTO_TEAM_NAMES[1 - t]}攔截成功，得到 1 個🎯攔截`);
  else if (entry.intercept) parts.push(`${DECRYPTO_TEAM_NAMES[1 - t]}攔截失敗（猜 ${dcCodeText(entry.intercept)}）`);
  addLog(room, 'system', `🔓 ${parts.join('，')}。`);
}

function decryptoTokens(room) {
  const tokens = [{ intercepts: 0, misses: 0 }, { intercepts: 0, misses: 0 }];
  (room.dcHistory || []).forEach(h => {
    if (!h.decodeOk) tokens[h.team].misses += 1;
    if (h.interceptOk) tokens[1 - h.team].intercepts += 1;
  });
  return tokens;
}

function endDecryptoGame(room, winner, reason) {
  clearTimeout(room.dcGuessTimer);
  room.dcGuessTimer = null;
  room.dcResult = { winner, reason };
  room.roundPhase = 'game_over';
  room.gameEnded = true;
  room.winnerTeam = winner === null ? null : String(winner);
  addLog(room, 'system', winner === null ? `🏁 平手！${reason}` : `🏁 ${DECRYPTO_TEAM_NAMES[winner]}獲勝！${reason}`);
}

// After both teams have played the round: check tokens, otherwise start the next round
function finishDecryptoRound(room) {
  const tk = decryptoTokens(room);
  const target = room.dcTarget;
  const win = [0, 1].map(t => tk[t].intercepts >= target || tk[1 - t].misses >= target);
  const lastRound = room.dcRound >= room.dcMaxRounds;
  if (win[0] !== win[1]) {
    const w = win[0] ? 0 : 1;
    const reason = tk[w].intercepts >= target ? `成功攔截對手 ${target} 次。` : `對手解碼失敗 ${target} 次。`;
    endDecryptoGame(room, w, reason);
    return;
  }
  if (win[0] || lastRound) {
    // Both sides triggered at once, or the rounds ran out: intercepts minus misses decides
    const score = tk.map(x => x.intercepts - x.misses);
    const head = lastRound && !win[0] ? `${room.dcMaxRounds} 回合結束，` : '兩隊同時達成條件，';
    if (score[0] !== score[1]) {
      const w = score[0] > score[1] ? 0 : 1;
      endDecryptoGame(room, w, `${head}比分數（攔截－失誤）${score[w]} 比 ${score[1 - w]}。`);
    } else {
      endDecryptoGame(room, null, `${head}分數（攔截－失誤）一樣都是 ${score[0]}。`);
    }
    return;
  }
  startDecryptoRound(room);
}

function getDecryptoRoomState(room, socketId) {
  if (!room.gameStarted) ensureDecryptoTeams(room);
  const me = dcPlayer(room, socketId);
  const myTeam = me && (me.dcTeam === 0 || me.dcTeam === 1) ? me.dcTeam : null;
  const reveal = room.gameEnded;
  const phase = room.roundPhase;
  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    host: p.host,
    connected: p.connected,
    isBot: false,
    team: p.dcTeam,
    left: !!p.dcLeft
  }));
  const tokens = decryptoTokens(room);
  const teams = [0, 1].map(t => ({
    name: DECRYPTO_TEAM_NAMES[t],
    memberIds: room.players.filter(p => p.dcTeam === t).map(p => p.id),
    encryptorId: room.gameStarted ? room.dcEncryptors[t] : null,
    words: room.gameStarted && (reveal || myTeam === t) ? room.dcWords[t] : null,
    cluesReady: !!(room.dcClues && room.dcClues[t]),
    intercepts: tokens[t].intercepts,
    misses: tokens[t].misses
  }));
  const amEncryptor = room.gameStarted && myTeam !== null && room.dcEncryptors[myTeam] === socketId;
  const g = room.dcGuess;
  const active = room.dcActive;
  let current = null;
  if (room.gameStarted && (phase === 'guess' || phase === 'reveal')) {
    current = {
      team: active,
      encryptorId: room.dcEncryptors[active],
      clues: room.dcClues[active],
      interceptAllowed: g ? g.interceptAllowed : false,
      decodeDone: !!(g && g.decode),
      interceptDone: !!(g && g.intercept),
      // Your own team's submission is visible to your team; the rest waits for the reveal
      decode: g && (phase === 'reveal' || myTeam === active) ? g.decode : null,
      decodeBy: g ? g.decodeBy : null,
      intercept: g && (phase === 'reveal' || myTeam === 1 - active) ? g.intercept : null,
      interceptBy: g ? g.interceptBy : null,
      result: phase === 'reveal' ? room.dcHistory[room.dcHistory.length - 1] : null,
      endsAt: g ? g.endsAt : null,
      graceEndsAt: g ? g.graceEndsAt : null
    };
  }
  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    roundPhase: phase,
    setupError: room.gameStarted ? null : decryptoSetupError(room),
    round: room.dcRound || 0,
    target: room.gameStarted ? room.dcTarget : decryptoTarget(room),
    maxRounds: room.gameStarted ? room.dcMaxRounds : decryptoMaxRounds(decryptoTarget(room)),
    targetRange: [DECRYPTO_TARGET_MIN, DECRYPTO_TARGET_MAX],
    guessSeconds: room.gameStarted ? room.dcGuessSeconds : decryptoGuessSeconds(room),
    guessSecondsOptions: DECRYPTO_GUESS_SECONDS,
    serverNow: Date.now(),
    teams,
    myTeam,
    myCode: amEncryptor && phase === 'clue' ? room.dcCodes[myTeam] : (amEncryptor && phase === 'guess' && active === myTeam ? room.dcCodes[myTeam] : null),
    myCluesDraftNeeded: amEncryptor && phase === 'clue' && !room.dcClues[myTeam],
    current,
    dcHistory: room.dcHistory || [],
    result: room.dcResult || null,
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

function handleDecryptoDeparture(room, player) {
  if (!room.gameStarted || room.gameEnded || player.dcLeft) return;
  player.dcLeft = true;
  const t = player.dcTeam;
  if (t !== 0 && t !== 1) return;
  if (!dcActiveMembers(room, t).length) {
    endDecryptoGame(room, 1 - t, `${DECRYPTO_TEAM_NAMES[t]}的人都離開了。`);
    return;
  }
  // The encryptor left before writing clues: hand the same code to a teammate
  if (room.roundPhase === 'clue' && room.dcEncryptors[t] === player.id && !room.dcClues[t]) {
    room.dcEncryptors[t] = pickDecryptoEncryptor(room, t);
    addLog(room, 'system', `🔁 改由 ${(dcPlayer(room, room.dcEncryptors[t]) || {}).name} 當${DECRYPTO_TEAM_NAMES[t]}的加密者。`);
  }
}

function getDecryptoContext(socket, phase) {
  const room = getRoomBySocket(socket);
  if (!room || room.gameType !== 'decrypto' || !room.gameStarted || room.gameEnded) return null;
  if (phase && room.roundPhase !== phase) return null;
  const player = dcPlayer(room, socket.id);
  if (!player || player.dcLeft) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  // Event: Lobby - join the other team
  socket.on('decrypto_switchTeam', ({ team, targetId } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'decrypto' || room.gameStarted) return;
    const me = dcPlayer(room, socket.id);
    if (!me) return;
    // The host may move other players; everyone else only moves themselves
    const target = targetId && me.host ? dcPlayer(room, targetId) : me;
    if (!target || (team !== 0 && team !== 1)) return;
    target.dcTeam = team;
    broadcastRoomUpdate(room);
  });

  // Event: Lobby - host shuffles the teams evenly
  socket.on('decrypto_shuffleTeams', () => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'decrypto' || room.gameStarted) return;
    const me = dcPlayer(room, socket.id);
    if (!me || !me.host) return;
    shuffle([...room.players]).forEach((p, i) => { p.dcTeam = i % 2; });
    broadcastRoomUpdate(room);
  });

  // Event: Host changes how many tokens decide the game
  socket.on('decrypto_settings', ({ target, guessSeconds } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'decrypto' || room.gameStarted) return;
    const player = dcPlayer(room, socket.id);
    if (!player || !player.host) return;
    if (!room.dcSettings) room.dcSettings = {};
    if (Number.isInteger(target)) room.dcSettings.target = Math.max(DECRYPTO_TARGET_MIN, Math.min(DECRYPTO_TARGET_MAX, target));
    if (DECRYPTO_GUESS_SECONDS.includes(guessSeconds)) room.dcSettings.guessSeconds = guessSeconds;
    broadcastRoomUpdate(room);
  });

  // Event: Encryptor submits the three clues
  socket.on('decrypto_clues', ({ clues } = {}) => {
    const ctx = getDecryptoContext(socket, 'clue');
    if (!ctx) return;
    const { room, player } = ctx;
    const t = player.dcTeam;
    if (room.dcEncryptors[t] !== player.id || room.dcClues[t]) return;
    const clean = Array.isArray(clues) ? clues.slice(0, 3).map(c => String(c || '').trim().slice(0, 20)) : [];
    if (clean.length !== 3 || clean.some(c => !c)) {
      socket.emit('errorMsg', '三個提示都要填。');
      return;
    }
    room.dcClues[t] = clean;
    addLog(room, 'system', `✍️ ${player.name} 寫好提示了。`);
    if (room.dcClues[0] && room.dcClues[1]) {
      startDecryptoGuessing(room, 0);
      addLog(room, 'system', `📢 先猜${DECRYPTO_TEAM_NAMES[0]}的密碼，請 ${(dcPlayer(room, room.dcEncryptors[0]) || {}).name} 唸出提示。`);
    }
    broadcastRoomUpdate(room);
  });

  // Event: A team submits its guess (decode own code, or intercept the other team's)
  socket.on('decrypto_guess', ({ code } = {}) => {
    const ctx = getDecryptoContext(socket, 'guess');
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.dcGuess;
    const t = room.dcActive;
    if (!isValidDecryptoCode(code)) {
      socket.emit('errorMsg', '請為每個提示選一個不同的數字。');
      return;
    }
    if (player.dcTeam === t) {
      if (room.dcEncryptors[t] === player.id || g.decode) return;
      g.decode = [...code];
      g.decodeBy = player.id;
    } else {
      if (!g.interceptAllowed || g.intercept) return;
      g.intercept = [...code];
      g.interceptBy = player.id;
    }
    maybeRevealDecrypto(room);
    broadcastRoomUpdate(room);
  });

  // Event: Move on from the reveal (anyone can press it)
  socket.on('decrypto_next', () => {
    const ctx = getDecryptoContext(socket, 'reveal');
    if (!ctx) return;
    const { room } = ctx;
    if (room.dcActive === 0) {
      startDecryptoGuessing(room, 1);
      addLog(room, 'system', `📢 換猜${DECRYPTO_TEAM_NAMES[1]}的密碼，請 ${(dcPlayer(room, room.dcEncryptors[1]) || {}).name} 唸出提示。`);
    } else {
      finishDecryptoRound(room);
    }
    broadcastRoomUpdate(room);
  });

  // Event: Host reveals now; a missing decode counts as wrong, a missing intercept as no attempt
  socket.on('decrypto_forceReveal', () => {
    const ctx = getDecryptoContext(socket, 'guess');
    if (!ctx || !ctx.player.host) return;
    forceRevealDecrypto(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Host hands the encryptor job to the next teammate (e.g. the encryptor dropped)
  socket.on('decrypto_reassign', ({ team } = {}) => {
    const ctx = getDecryptoContext(socket, 'clue');
    if (!ctx || !ctx.player.host || (team !== 0 && team !== 1)) return;
    const { room } = ctx;
    if (room.dcClues[team] || dcActiveMembers(room, team).length < 2) return;
    room.dcEncryptors[team] = pickDecryptoEncryptor(room, team);
    addLog(room, 'system', `🔁 房主讓 ${(dcPlayer(room, room.dcEncryptors[team]) || {}).name} 改當${DECRYPTO_TEAM_NAMES[team]}的加密者。`);
    broadcastRoomUpdate(room);
  });
});

// ================= AVALON (阿瓦隆) =================
// Good vs evil. Each round a leader proposes a quest team, everyone votes on it
// at the same time, and an approved team secretly plays success/fail cards.
// Three failed quests (or five rejected proposals in a row) and evil wins.
// Three successful quests and the assassin gets one guess at Merlin: right and
// evil wins after all. The table talks face to face; phones hold the secret
// roles, the votes and the quest cards.

const AVALON_MIN_PLAYERS = 5;
const AVALON_MAX_PLAYERS = 10;
const AVALON_TEAM_SIZES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] }; // [good, evil]
const AVALON_QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5]
};
const AVALON_MAX_REJECTS = 5;

const AVALON_ROLES = {
  merlin: { name: '梅林', icon: '🧙‍♂️', team: 'good', desc: '知道所有壞人是誰（莫德雷德除外）。要暗中帶領好人，又不能被刺客認出來。' },
  percival: { name: '派西維爾', icon: '🛡️', team: 'good', desc: '看得到梅林和魔甘娜，但分不出誰是誰。要保護真正的梅林。' },
  servant: { name: '亞瑟的忠臣', icon: '🙂', team: 'good', desc: '沒有特殊資訊，靠推理找出壞人。' },
  assassin: { name: '刺客', icon: '🗡️', team: 'evil', desc: '壞人。好人完成 3 個任務後，由你指定一個人；猜中梅林，壞人逆轉獲勝。' },
  morgana: { name: '魔甘娜', icon: '🔮', team: 'evil', desc: '壞人。在派西維爾眼中看起來像梅林。' },
  mordred: { name: '莫德雷德', icon: '👿', team: 'evil', desc: '壞人。梅林看不到你。' },
  oberon: { name: '奧伯倫', icon: '👻', team: 'evil', desc: '壞人，但你不知道其他壞人，其他壞人也不知道你。' },
  minion: { name: '莫德雷德的爪牙', icon: '😈', team: 'evil', desc: '壞人。知道其他壞人是誰（奧伯倫除外）。' }
};
const AVALON_EXTRA_ROLES = ['percival', 'morgana', 'mordred', 'oberon'];
const AVALON_TEAM_NAMES = { good: '好人陣營', evil: '壞人陣營' };

const avPlayer = (room, id) => room.players.find(p => p.id === id);
const avActive = (room) => room.players.filter(p => !p.avLeft);
const avRoleName = (role) => (AVALON_ROLES[role] ? `${AVALON_ROLES[role].icon}${AVALON_ROLES[role].name}` : '?');
const avIsEvil = (p) => !!p.avRole && AVALON_ROLES[p.avRole].team === 'evil';

function getAvalonSetup(room) {
  const total = room.players.length;
  const settings = room.avSettings || {};
  const extras = (settings.extras || []).filter(r => AVALON_EXTRA_ROLES.includes(r));
  return { total, extras, lady: !!settings.lady, teams: AVALON_TEAM_SIZES[total] || null, questSizes: AVALON_QUEST_SIZES[total] || null };
}

function avalonSetupError(setup) {
  if (setup.total < AVALON_MIN_PLAYERS || setup.total > AVALON_MAX_PLAYERS) {
    return `阿瓦隆需要 ${AVALON_MIN_PLAYERS} 到 ${AVALON_MAX_PLAYERS} 名玩家才能開始。`;
  }
  const evilSpecials = 1 + setup.extras.filter(r => AVALON_ROLES[r].team === 'evil').length;
  if (evilSpecials > setup.teams[1]) {
    return `${setup.total} 人只有 ${setup.teams[1]} 個壞人，放不下刺客加上 ${evilSpecials - 1} 個進階壞人角色。`;
  }
  return null;
}

// Two fails are needed on quest 4 with 7 or more players
const avFailsNeeded = (room, questIdx) => (questIdx === 3 && room.players.length >= 7 ? 2 : 1);

function resetAvalonRoom(room) {
  room.avQuest = 0;
  room.avResults = [];
  room.avRejects = 0;
  room.avLeaderId = null;
  room.avTeam = [];
  room.avVotes = {};
  room.avQuestCards = {};
  room.avHistory = [];
  room.avLastQuest = null;
  room.avLadyHolderId = null;
  room.avLadyUsedIds = [];
  room.avWinner = null;
  room.avReason = '';
  room.avAssassinTarget = null;
  room.players.forEach(p => {
    p.avRole = null;
    p.avLeft = false;
    p.avLadyInfo = [];
  });
}

function startAvalonGame(room) {
  const setup = getAvalonSetup(room);
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  resetAvalonRoom(room);

  const [goodCount, evilCount] = setup.teams;
  const good = ['merlin', ...setup.extras.filter(r => AVALON_ROLES[r].team === 'good')];
  const evil = ['assassin', ...setup.extras.filter(r => AVALON_ROLES[r].team === 'evil')];
  while (good.length < goodCount) good.push('servant');
  while (evil.length < evilCount) evil.push('minion');
  const roles = shuffle([...good, ...evil]);
  room.players.forEach((p, i) => { p.avRole = roles[i]; });
  room.avRolesInGame = [...new Set([...good, ...evil])];
  room.avLady = setup.lady;

  const first = Math.floor(Math.random() * room.players.length);
  room.avLeaderId = room.players[first].id;
  // The Lady of the Lake starts with the player to the leader's right
  if (setup.lady) room.avLadyHolderId = room.players[(first - 1 + room.players.length) % room.players.length].id;
  room.roundPhase = 'proposal';
  addLog(room, 'system', `🏰 阿瓦隆開始！好人 ${goodCount} 人、壞人 ${evilCount} 人。先點身分卡確認自己的角色和情報。`);
  addLog(room, 'system', `👑 第一位隊長是 ${room.players[first].name}，請提名第 1 個任務的 ${setup.questSizes[0]} 位隊員。`);
}

function avNextLeader(room) {
  const seats = room.players;
  const idx = seats.findIndex(p => p.id === room.avLeaderId);
  for (let step = 1; step <= seats.length; step++) {
    const next = seats[(idx + step) % seats.length];
    if (!next.avLeft) {
      room.avLeaderId = next.id;
      return;
    }
  }
}

function avEndGame(room, winner, reason) {
  room.avWinner = winner;
  room.avReason = reason;
  room.winnerTeam = winner;
  room.roundPhase = 'game_over';
  room.gameEnded = true;
  addLog(room, 'system', `🏁 ${AVALON_TEAM_NAMES[winner]}獲勝！${reason}`);
}

function avStartProposal(room) {
  room.avTeam = [];
  room.avVotes = {};
  room.avQuestCards = {};
  room.roundPhase = 'proposal';
  const leader = avPlayer(room, room.avLeaderId);
  const size = AVALON_QUEST_SIZES[room.players.length][room.avQuest];
  addLog(room, 'system', `👑 隊長是 ${leader ? leader.name : '?'}，請提名第 ${room.avQuest + 1} 個任務的 ${size} 位隊員。`);
}

function avVoters(room) {
  return avActive(room);
}

function maybeResolveAvalonVote(room, force = false) {
  if (room.roundPhase !== 'vote') return;
  const voters = avVoters(room);
  const cast = voters.filter(p => room.avVotes[p.id] !== undefined);
  if (!force && cast.length < voters.length) return;
  const approve = cast.filter(p => room.avVotes[p.id]).length;
  const approved = approve > cast.length / 2;
  const entry = room.avHistory[room.avHistory.length - 1];
  entry.votes = Object.fromEntries(cast.map(p => [p.id, room.avVotes[p.id]]));
  entry.approved = approved;
  const tally = `（同意 ${approve}／反對 ${cast.length - approve}）`;
  if (approved) {
    room.avRejects = 0;
    room.avQuestCards = {};
    room.roundPhase = 'quest';
    addLog(room, 'vote', `✅ 隊伍通過${tally}！${room.avTeam.map(id => avPlayer(room, id).name).join('、')} 出任務。`);
    return;
  }
  room.avRejects += 1;
  addLog(room, 'vote', `❌ 隊伍被否決${tally}，連續否決 ${room.avRejects}/${AVALON_MAX_REJECTS} 次。`);
  if (room.avRejects >= AVALON_MAX_REJECTS) {
    avEndGame(room, 'evil', `連續 ${AVALON_MAX_REJECTS} 次提名都被否決。`);
    return;
  }
  avNextLeader(room);
  avStartProposal(room);
}

// force: the host stops waiting; missing cards count as success
function maybeResolveAvalonQuest(room, force = false) {
  if (room.roundPhase !== 'quest') return;
  const members = room.avTeam.map(id => avPlayer(room, id)).filter(p => p && !p.avLeft);
  const waiting = members.filter(p => !room.avQuestCards[p.id]);
  if (!force && waiting.length) return;
  const fails = members.filter(p => room.avQuestCards[p.id] === 'fail').length;
  const needed = avFailsNeeded(room, room.avQuest);
  const success = fails < needed;
  room.avResults.push(success ? 'success' : 'fail');
  room.avLastQuest = { quest: room.avQuest, fails, success, needed, size: room.avTeam.length };
  room.avHistory[room.avHistory.length - 1].result = { fails, success };
  room.roundPhase = 'quest_result';
  addLog(room, 'quest', success
    ? `🏆 第 ${room.avQuest + 1} 個任務成功！（${fails} 張失敗）`
    : `💥 第 ${room.avQuest + 1} 個任務失敗！（${fails} 張失敗）`);
}

function avalonAfterQuest(room) {
  const wins = room.avResults.filter(r => r === 'success').length;
  const losses = room.avResults.filter(r => r === 'fail').length;
  if (losses >= 3) {
    avEndGame(room, 'evil', '3 個任務失敗。');
    return;
  }
  if (wins >= 3) {
    room.roundPhase = 'assassin';
    addLog(room, 'system', '🗡️ 好人完成了 3 個任務！壞人可以討論，最後由刺客在手機上指定誰是梅林。');
    return;
  }
  room.avQuest += 1;
  avNextLeader(room);
  // The Lady of the Lake is used after quests 2, 3 and 4
  if (room.avLady && room.avQuest >= 2 && room.avQuest <= 4 && avPlayer(room, room.avLadyHolderId)) {
    room.roundPhase = 'lady';
    addLog(room, 'system', `🌊 ${avPlayer(room, room.avLadyHolderId).name} 拿著湖中女神，選一位玩家查驗陣營。`);
    return;
  }
  avStartProposal(room);
}

// Whoever may pick Merlin: the assassin, or another evil player if the assassin left
function avAssassin(room) {
  return room.players.find(p => p.avRole === 'assassin' && !p.avLeft)
    || room.players.find(p => avIsEvil(p) && !p.avLeft);
}

// What a player learned at night, from their role
function avNightInfo(room, me) {
  if (!me || !me.avRole) return [];
  const names = (list) => list.map(p => p.name).join('、');
  const others = room.players.filter(p => p.id !== me.id);
  switch (me.avRole) {
    case 'merlin': {
      const seen = others.filter(p => avIsEvil(p) && p.avRole !== 'mordred');
      const info = [`壞人是：${names(seen) || '（看不到任何人）'}`];
      if (room.avRolesInGame.includes('mordred')) info.push('莫德雷德也是壞人，但你看不到他。');
      return info;
    }
    case 'percival': {
      const seen = others.filter(p => p.avRole === 'merlin' || p.avRole === 'morgana');
      return [seen.length > 1 ? `梅林是 ${names(seen)} 其中一位（另一位是魔甘娜）。` : `梅林是：${names(seen)}`];
    }
    case 'oberon':
      return ['你不知道其他壞人是誰，他們也不知道你。'];
    case 'servant':
      return ['你沒有額外情報，靠推理找出壞人。'];
    default: {
      const mates = others.filter(p => avIsEvil(p) && p.avRole !== 'oberon');
      const info = [`你的壞人同伴：${names(mates) || '（沒有）'}`];
      if (room.avRolesInGame.includes('oberon')) info.push('奧伯倫也是壞人，但你們互相不知道。');
      return info;
    }
  }
}

function getAvalonRoomState(room, socketId) {
  const me = avPlayer(room, socketId);
  const setup = getAvalonSetup(room);
  const reveal = room.gameEnded;
  const phase = room.roundPhase;
  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    host: p.host,
    connected: p.connected,
    isBot: false,
    left: !!p.avLeft,
    voted: phase === 'vote' && room.avVotes[p.id] !== undefined,
    questDone: phase === 'quest' && !!room.avQuestCards[p.id],
    role: reveal ? p.avRole : null
  }));
  const assassin = room.gameStarted ? avAssassin(room) : null;
  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    roundPhase: phase,
    setup: { ...setup, error: avalonSetupError(setup) },
    roleInfo: AVALON_ROLES,
    extraRoles: AVALON_EXTRA_ROLES,
    teamSizes: AVALON_TEAM_SIZES,
    questSizeTable: AVALON_QUEST_SIZES,
    rolesInGame: room.gameStarted ? room.avRolesInGame : [],
    lady: room.gameStarted ? !!room.avLady : setup.lady,
    questSizes: AVALON_QUEST_SIZES[room.players.length] || null,
    failsNeeded: [0, 1, 2, 3, 4].map(i => avFailsNeeded(room, i)),
    quest: room.avQuest || 0,
    results: room.avResults || [],
    rejects: room.avRejects || 0,
    maxRejects: AVALON_MAX_REJECTS,
    leaderId: room.avLeaderId || null,
    team: room.avTeam || [],
    lastQuest: room.avLastQuest || null,
    rounds: room.avHistory || [],
    ladyHolderId: room.avLadyHolderId || null,
    ladyUsedIds: room.avLadyUsedIds || [],
    assassinId: phase === 'assassin' && assassin ? assassin.id : null,
    winner: room.avWinner || null,
    reason: room.avReason || '',
    assassinTarget: room.avAssassinTarget || null,
    my: me && me.avRole ? {
      role: me.avRole,
      team: AVALON_ROLES[me.avRole].team,
      nightInfo: avNightInfo(room, me),
      ladyInfo: me.avLadyInfo || [],
      vote: phase === 'vote' ? (room.avVotes[me.id] === undefined ? null : room.avVotes[me.id]) : null,
      questCard: phase === 'quest' ? room.avQuestCards[me.id] || null : null
    } : null,
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

function handleAvalonDeparture(room, player) {
  if (!room.gameStarted || room.gameEnded || player.avLeft) return;
  player.avLeft = true;
  if (avActive(room).length < 2) {
    avEndGame(room, avIsEvil(avActive(room)[0] || player) ? 'evil' : 'good', '其他人都離開了。');
    return;
  }
  if (room.roundPhase === 'proposal' && room.avLeaderId === player.id) {
    avNextLeader(room);
    avStartProposal(room);
  } else if (room.roundPhase === 'vote') {
    maybeResolveAvalonVote(room);
  } else if (room.roundPhase === 'quest') {
    maybeResolveAvalonQuest(room);
  } else if (room.roundPhase === 'lady' && room.avLadyHolderId === player.id) {
    avStartProposal(room);
  }
}

function getAvalonContext(socket, phase) {
  const room = getRoomBySocket(socket);
  if (!room || room.gameType !== 'avalon' || !room.gameStarted || room.gameEnded) return null;
  if (phase && room.roundPhase !== phase) return null;
  const player = avPlayer(room, socket.id);
  if (!player || player.avLeft) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  // Event: Host picks the advanced roles / Lady of the Lake in the lobby
  socket.on('avalon_settings', ({ extras, lady } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'avalon' || room.gameStarted) return;
    const player = avPlayer(room, socket.id);
    if (!player || !player.host) return;
    if (!room.avSettings) room.avSettings = { extras: [], lady: false };
    if (Array.isArray(extras)) room.avSettings.extras = [...new Set(extras.filter(r => AVALON_EXTRA_ROLES.includes(r)))];
    if (typeof lady === 'boolean') room.avSettings.lady = lady;
    broadcastRoomUpdate(room);
  });

  // Event: Leader proposes the quest team
  socket.on('avalon_propose', ({ team } = {}) => {
    const ctx = getAvalonContext(socket, 'proposal');
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.avLeaderId !== player.id) return;
    const size = AVALON_QUEST_SIZES[room.players.length][room.avQuest];
    const ids = Array.isArray(team) ? [...new Set(team)] : [];
    if (ids.length !== size || !ids.every(id => { const p = avPlayer(room, id); return p && !p.avLeft; })) {
      socket.emit('errorMsg', `請選剛好 ${size} 位隊員。`);
      return;
    }
    room.avTeam = ids;
    room.avVotes = {};
    room.avHistory.push({ quest: room.avQuest, leaderId: player.id, team: ids, votes: null, approved: null, result: null });
    room.roundPhase = 'vote';
    addLog(room, 'vote', `👑 ${player.name} 提名 ${ids.map(id => avPlayer(room, id).name).join('、')}，大家投票！`);
    broadcastRoomUpdate(room);
  });

  // Event: Vote on the proposed team (can be changed until everyone has voted)
  socket.on('avalon_vote', ({ approve } = {}) => {
    const ctx = getAvalonContext(socket, 'vote');
    if (!ctx || typeof approve !== 'boolean') return;
    ctx.room.avVotes[ctx.player.id] = approve;
    maybeResolveAvalonVote(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Team member plays a quest card (good players can only succeed)
  socket.on('avalon_quest', ({ card } = {}) => {
    const ctx = getAvalonContext(socket, 'quest');
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.avTeam.includes(player.id) || room.avQuestCards[player.id]) return;
    if (card !== 'success' && card !== 'fail') return;
    if (card === 'fail' && !avIsEvil(player)) {
      socket.emit('errorMsg', '好人只能出成功。');
      return;
    }
    room.avQuestCards[player.id] = card;
    maybeResolveAvalonQuest(room);
    broadcastRoomUpdate(room);
  });

  // Event: Move on after the quest result (anyone can press it)
  socket.on('avalon_continue', () => {
    const ctx = getAvalonContext(socket, 'quest_result');
    if (!ctx) return;
    avalonAfterQuest(ctx.room);
    broadcastRoomUpdate(ctx.room);
  });

  // Event: Lady of the Lake holder checks someone's loyalty
  socket.on('avalon_lady', ({ targetId } = {}) => {
    const ctx = getAvalonContext(socket, 'lady');
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.avLadyHolderId !== player.id) return;
    const target = avPlayer(room, targetId);
    if (!target || target.avLeft || target.id === player.id || room.avLadyUsedIds.includes(target.id)) {
      socket.emit('errorMsg', '請選一位還沒拿過湖中女神的其他玩家。');
      return;
    }
    player.avLadyInfo.push(`🌊 你查驗了 ${target.name}：${AVALON_TEAM_NAMES[AVALON_ROLES[target.avRole].team]}`);
    room.avLadyUsedIds.push(player.id);
    room.avLadyHolderId = target.id;
    addLog(room, 'system', `🌊 ${player.name} 用湖中女神查驗了 ${target.name}，湖中女神交給 ${target.name}。`);
    avStartProposal(room);
    broadcastRoomUpdate(room);
  });

  // Event: Assassin names Merlin
  socket.on('avalon_assassinate', ({ targetId } = {}) => {
    const ctx = getAvalonContext(socket, 'assassin');
    if (!ctx) return;
    const { room, player } = ctx;
    const assassin = avAssassin(room);
    if (!assassin || assassin.id !== player.id) return;
    const target = avPlayer(room, targetId);
    if (!target || target.id === player.id) return;
    room.avAssassinTarget = target.id;
    if (target.avRole === 'merlin') avEndGame(room, 'evil', `刺客 ${player.name} 刺中了梅林 ${target.name}！`);
    else avEndGame(room, 'good', `刺客 ${player.name} 刺殺了 ${target.name}，但他不是梅林。`);
    broadcastRoomUpdate(room);
  });

  // Event: Host stops waiting (missing votes are ignored, missing quest cards count as success)
  socket.on('avalon_force', () => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'avalon' || !room.gameStarted || room.gameEnded) return;
    const player = avPlayer(room, socket.id);
    if (!player || !player.host) return;
    if (room.roundPhase === 'vote') {
      addLog(room, 'system', '⏭️ 房主不等了，沒投票的人不計。');
      maybeResolveAvalonVote(room, true);
    } else if (room.roundPhase === 'quest') {
      addLog(room, 'system', '⏭️ 房主不等了，沒出牌的隊員算成功。');
      maybeResolveAvalonQuest(room, true);
    } else if (room.roundPhase === 'proposal') {
      addLog(room, 'system', '⏭️ 房主跳過了這位隊長。');
      avNextLeader(room);
      avStartProposal(room);
    } else if (room.roundPhase === 'lady') {
      addLog(room, 'system', '⏭️ 房主跳過了湖中女神。');
      avStartProposal(room);
    } else return;
    broadcastRoomUpdate(room);
  });
});

// ================= ROOM CHAT (every game) =================
// A small text chat per room, shown by public/shared/chat.js. The room keeps
// the latest messages so people who join or reconnect can catch up.

const CHAT_MAX_MESSAGES = 100;
const CHAT_MAX_LENGTH = 200;
const CHAT_MIN_INTERVAL_MS = 400;

io.on('connection', (socket) => {
  // Event: Ask for the room's recent messages (on joining / reconnecting)
  socket.on('chat_history', () => {
    const room = getRoomBySocket(socket);
    if (!room) return;
    socket.emit('chat_history', { roomCode: room.roomCode, messages: room.chat || [] });
  });

  // Event: Send a chat message to everyone in the room
  socket.on('chat_send', ({ text } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return;
    const now = Date.now();
    if (socket.data.lastChatAt && now - socket.data.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
    socket.data.lastChatAt = now;

    const message = { id: `${now}-${Math.random().toString(36).slice(2, 6)}`, playerId: player.id, name: player.name, text: clean, time: now };
    if (!room.chat) room.chat = [];
    room.chat.push(message);
    if (room.chat.length > CHAT_MAX_MESSAGES) room.chat.splice(0, room.chat.length - CHAT_MAX_MESSAGES);
    room.players.forEach(p => {
      if (p.connected && !p.isBot) io.to(p.id).emit('chat_message', message);
    });
  });
});

// ================= BLOODY 99 (血腥99) =================
// 99 with teams. The total starts at 99; play a card, change the total, draw
// one card (A and 7 draw nothing). Several cards can be played together as one
// card whose rank is their sum (A=1 … K=13, at most 13): 2+5 is a 7. A combo
// still draws only one card. When the deck runs out, the played cards (and
// dead players' cards) are shuffled into a new deck. A dead player's team is shown. Whoever pushes the total over 99 dies, and
// so does anyone whose hand ends up empty. Two hidden teams (red / black, black
// gets the extra player) each have a king: the team whose king dies first loses.
// The host picks which kings are public: both, only black's, or none;
// nobody else ever reveals a team.
//   A: take a random card from someone's hand    4: reverse    5: pick next player
//   7: swap your whole hand with someone          10: ±10       Q: ±20
//   J: pass                                        K: total becomes 99
//   2 3 6 8 9: add their value                     (the total never goes below 0)

const B99_MIN_PLAYERS = 4;
const B99_MAX_PLAYERS = 10;
const B99_HAND = 5;
const B99_MAX_COMBO = 13;
const B99_LIMIT = 99;
const B99_SUITS = ['♠', '♥', '♦', '♣'];
const B99_RANK_NAMES = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const B99_TEAM_NAMES = { red: '🔴 紅隊', black: '⚫ 黑隊' };
// Which kings everyone knows: both, only black's (black has the extra player
// with an odd count, so revealing its king evens things out), or none
const B99_KING_REVEALS = ['both', 'black', 'none'];

const b9Player = (room, id) => room.players.find(p => p.id === id);
const b9Alive = (room) => room.players.filter(p => !p.b9Dead && !p.b9Left);
const b9CardName = (c) => `${c.suit}${B99_RANK_NAMES[c.rank] || c.rank}`;
const b9DefaultDecks = (n) => (n <= 5 ? 1 : 2);
const b9KingPublic = (room, p) => p.b9King && (room.b9KingsReveal === 'both' || (room.b9KingsReveal === 'black' && p.b9Team === 'black'));

function getBloody99Setup(room) {
  const total = room.players.length;
  const settings = room.b9Settings || {};
  return {
    total,
    decks: settings.decks || b9DefaultDecks(total),
    autoDecks: !settings.decks,
    kingsReveal: B99_KING_REVEALS.includes(settings.kingsReveal) ? settings.kingsReveal : 'both'
  };
}

function bloody99SetupError(setup) {
  if (setup.total < B99_MIN_PLAYERS || setup.total > B99_MAX_PLAYERS) {
    return `血腥99需要 ${B99_MIN_PLAYERS} 到 ${B99_MAX_PLAYERS} 名玩家才能開始。`;
  }
  return null;
}

function resetBloody99Room(room) {
  room.b9Deck = [];
  room.b9Total = B99_LIMIT;
  room.b9Dir = 1;
  room.b9TurnId = null;
  room.b9Last = null;
  room.b9Plays = [];
  room.b9Winner = null;
  room.b9Reason = '';
  room.b9Discard = [];
  room.b9Reshuffles = 0;
  room.players.forEach(p => {
    p.b9Hand = [];
    p.b9Team = null;
    p.b9King = false;
    p.b9Dead = false;
    p.b9Left = false;
    p.b9DeathReason = null;
  });
}

function startBloody99Game(room) {
  const setup = getBloody99Setup(room);
  room.gameStarted = true;
  room.gameEnded = false;
  room.winnerTeam = null;
  room.history = [];
  resetBloody99Room(room);
  room.b9Decks = setup.decks;
  room.b9KingsReveal = setup.kingsReveal;

  let id = 0;
  const deck = [];
  for (let d = 0; d < setup.decks; d++) {
    B99_SUITS.forEach(suit => { for (let rank = 1; rank <= 13; rank++) deck.push({ id: id++, suit, rank }); });
  }
  room.b9Deck = shuffle(deck);
  room.b9CardTotal = deck.length;

  // Teams: black gets the extra player when the count is odd; one king each
  const order = shuffle([...room.players]);
  const blackCount = Math.ceil(order.length / 2);
  order.forEach((p, i) => { p.b9Team = i < blackCount ? 'black' : 'red'; });
  ['red', 'black'].forEach(team => {
    const members = order.filter(p => p.b9Team === team);
    members[Math.floor(Math.random() * members.length)].b9King = true;
  });
  room.players.forEach(p => { p.b9Hand = room.b9Deck.splice(0, B99_HAND); });

  const first = room.players[Math.floor(Math.random() * room.players.length)];
  room.b9TurnId = first.id;
  room.roundPhase = 'play';
  addLog(room, 'system', `🩸 血腥99開始！點數從 ${B99_LIMIT} 起跳。紅隊 ${room.players.length - blackCount} 人、黑隊 ${blackCount} 人，各有一位王。`);
  const publicKings = room.players.filter(p => b9KingPublic(room, p));
  if (publicKings.length) {
    const kings = publicKings.map(p => `${B99_TEAM_NAMES[p.b9Team]}的王是 ${p.name}`);
    addLog(room, 'system', `👑 ${kings.join('，')}${room.b9KingsReveal === 'black' ? `；${B99_TEAM_NAMES.red}的王不公開` : ''}。`);
  }
  addLog(room, 'system', `👉 由 ${first.name} 先出牌。`);
}

// Next living player from `fromId` in the current direction
function b9NextAlive(room, fromId) {
  const seats = room.players;
  const idx = seats.findIndex(p => p.id === fromId);
  for (let step = 1; step <= seats.length; step++) {
    const next = seats[((idx + step * room.b9Dir) % seats.length + seats.length) % seats.length];
    if (!next.b9Dead && !next.b9Left) return next;
  }
  return null;
}

function b9EndGame(room, winner, reason) {
  room.b9Winner = winner;
  room.b9Reason = reason;
  room.winnerTeam = winner;
  room.roundPhase = 'game_over';
  room.gameEnded = true;
  addLog(room, 'system', `🏁 ${B99_TEAM_NAMES[winner]}獲勝！${reason}`);
}

// Returns true if the game ended
function b9Kill(room, p, reason) {
  if (p.b9Dead) return false;
  p.b9Dead = true;
  p.b9DeathReason = reason;
  // A dead player's cards go to the discard pile (they come back if the deck is reshuffled)
  room.b9Discard.push(...p.b9Hand);
  p.b9Hand = [];
  room.b9Total = B99_LIMIT;
  addLog(room, 'death', `💀 ${p.name} ${reason}，死亡！點數重設為 ${B99_LIMIT}。`);
  if (p.b9King) {
    const other = p.b9Team === 'red' ? 'black' : 'red';
    b9EndGame(room, other, `${B99_TEAM_NAMES[p.b9Team]}的王 ${p.name} 倒下了。`);
    return true;
  }
  if (b9Alive(room).length < 2) {
    const last = b9Alive(room)[0];
    b9EndGame(room, last ? last.b9Team : 'black', '只剩一個人了。');
    return true;
  }
  return false;
}

// Anyone left with an empty hand dies right away (actor first, so their seat decides the turn)
function b9KillEmptyHands(room) {
  for (const p of b9Alive(room)) {
    if (p.b9Hand.length === 0 && b9Kill(room, p, '手上沒有牌')) return true;
  }
  return false;
}

// Draw one card; reshuffle the discard pile into a new deck when the deck is empty
function b9Draw(room, player) {
  if (!room.b9Deck.length && room.b9Discard.length) {
    room.b9Deck = shuffle(room.b9Discard);
    room.b9Discard = [];
    room.b9Reshuffles += 1;
    addLog(room, 'system', `🔀 牌堆用完了，把出過的 ${room.b9Deck.length} 張牌洗成新的牌堆。`);
  }
  if (room.b9Deck.length) player.b9Hand.push(room.b9Deck.shift());
}

// Plays one card, or several cards as one card of their summed rank; returns
// an error string, or null when done
function b9Play(room, player, { cardIds, cardId, sign, targetId } = {}) {
  const ids = Array.isArray(cardIds) ? cardIds : (cardId !== undefined ? [cardId] : []);
  if (!ids.length || new Set(ids).size !== ids.length) return '請選要出的牌。';
  const cards = ids.map(id => player.b9Hand.find(c => c.id === id));
  if (cards.some(c => !c)) return '你手上沒有這張牌。';
  const rank = cards.reduce((sum, c) => sum + c.rank, 0);
  if (rank > B99_MAX_COMBO) return `合起來是 ${rank}，超過 ${B99_MAX_COMBO} 不能出。`;
  const target = targetId !== undefined ? b9Player(room, targetId) : null;
  const needsTarget = rank === 1 || rank === 5 || rank === 7;
  if (needsTarget && (!target || target.id === player.id || target.b9Dead || target.b9Left)) return '請選一位其他還活著的玩家。';
  if (rank === 1 && target.b9Hand.length === 0) return '他手上沒有牌可以抽。';
  if ((rank === 10 || rank === 12) && sign !== '+' && sign !== '-') return '請選加或減。';

  player.b9Hand = player.b9Hand.filter(c => !ids.includes(c.id));
  room.b9Discard.push(...cards);
  const before = room.b9Total;
  let text = '';
  let nextId = null;
  switch (rank) {
    case 1: {
      const taken = target.b9Hand.splice(Math.floor(Math.random() * target.b9Hand.length), 1)[0];
      player.b9Hand.push(taken);
      text = `抽走了 ${target.name} 的一張牌`;
      break;
    }
    case 4:
      room.b9Dir *= -1;
      text = '迴轉！出牌順序反過來';
      break;
    case 5:
      nextId = target.id;
      text = `指定 ${target.name} 下一個出牌`;
      break;
    case 7: {
      const mine = player.b9Hand;
      player.b9Hand = target.b9Hand;
      target.b9Hand = mine;
      text = `和 ${target.name} 交換了全部手牌`;
      break;
    }
    case 10:
    case 12: {
      const amount = rank === 10 ? 10 : 20;
      room.b9Total = Math.max(0, room.b9Total + (sign === '+' ? amount : -amount));
      text = `${sign === '+' ? '+' : '−'}${amount}`;
      break;
    }
    case 11:
      text = 'Pass';
      break;
    case 13:
      room.b9Total = B99_LIMIT;
      text = `點數直接變成 ${B99_LIMIT}`;
      break;
    default:
      room.b9Total += rank;
      text = `+${rank}`;
  }
  const played = cards.map(c => ({ suit: c.suit, rank: c.rank }));
  const entry = { by: player.id, cards: played, rank, text, before, after: room.b9Total, targetId: target ? target.id : null };
  room.b9Last = entry;
  room.b9Plays.push(entry);
  const label = cards.length > 1 ? `${cards.map(b9CardName).join('+')}（當 ${B99_RANK_NAMES[rank] || rank}）` : b9CardName(cards[0]);
  addLog(room, 'play', `🃏 ${player.name} 出了 ${label}：${text}（點數 ${before} ➔ ${room.b9Total}）`);

  // Bust: the player who went over dies, the next seat continues
  if (room.b9Total > B99_LIMIT) {
    entry.bust = true;
    const next = b9NextAlive(room, player.id);
    if (b9Kill(room, player, `把點數加到 ${room.b9Total}，爆了`)) return null;
    room.b9TurnId = next.id;
    return null;
  }

  // Draw one card, even after a combo (an A or a 7 draws nothing)
  const reshufflesBefore = room.b9Reshuffles;
  if (rank !== 1 && rank !== 7) b9Draw(room, player);
  entry.reshuffled = room.b9Reshuffles !== reshufflesBefore;

  const next = nextId ? b9Player(room, nextId) : b9NextAlive(room, player.id);
  if (b9KillEmptyHands(room)) return null;
  room.b9TurnId = next && !next.b9Dead ? next.id : (b9NextAlive(room, player.id) || {}).id;
  return null;
}

function getBloody99RoomState(room, socketId) {
  const me = b9Player(room, socketId);
  const setup = getBloody99Setup(room);
  const reveal = room.gameEnded;
  const players = room.players.map(p => {
    // A dead player's team is revealed
    const kingKnown = reveal || p.id === socketId || b9KingPublic(room, p) || !!p.b9Dead;
    return {
      id: p.id,
      name: p.name,
      host: p.host,
      connected: p.connected,
      isBot: false,
      dead: !!p.b9Dead,
      left: !!p.b9Left,
      deathReason: p.b9DeathReason || null,
      handCount: (p.b9Hand || []).length,
      king: kingKnown ? !!p.b9King : null,
      team: kingKnown && (reveal || p.id === socketId || p.b9King || p.b9Dead) ? p.b9Team : null
    };
  });
  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    roundPhase: room.roundPhase,
    setup: { ...setup, error: bloody99SetupError(setup), defaultDecks: b9DefaultDecks(setup.total) },
    limit: B99_LIMIT,
    total: room.gameStarted ? room.b9Total : B99_LIMIT,
    dir: room.b9Dir || 1,
    turnId: room.b9TurnId || null,
    deckCount: (room.b9Deck || []).length,
    discardCount: (room.b9Discard || []).length,
    cardStats: { total: room.b9CardTotal || 0, discard: (room.b9Discard || []).length, reshuffles: room.b9Reshuffles || 0 },
    decks: room.b9Decks || setup.decks,
    kingsReveal: room.gameStarted ? room.b9KingsReveal : setup.kingsReveal,
    last: room.b9Last || null,
    playCount: (room.b9Plays || []).length,
    plays: (room.b9Plays || []).slice(-30),
    winner: room.b9Winner || null,
    reason: room.b9Reason || '',
    my: me && me.b9Team ? { team: me.b9Team, king: !!me.b9King, hand: me.b9Hand || [], dead: !!me.b9Dead } : null,
    players,
    history: room.history,
    me: players.find(p => p.id === socketId) || null
  };
}

function handleBloody99Departure(room, player) {
  if (!room.gameStarted || room.gameEnded || player.b9Left || player.b9Dead) return;
  const wasTurn = room.b9TurnId === player.id;
  const next = wasTurn ? b9NextAlive(room, player.id) : null;
  player.b9Left = true;
  if (b9Kill(room, player, '離開了遊戲')) return;
  if (wasTurn && next) room.b9TurnId = next.id;
}

function getBloody99Context(socket) {
  const room = getRoomBySocket(socket);
  if (!room || room.gameType !== 'bloody99' || !room.gameStarted || room.gameEnded) return null;
  const player = b9Player(room, socket.id);
  if (!player || player.b9Dead || player.b9Left) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  // Event: Host changes the number of decks / whether the kings are public
  socket.on('bloody99_settings', ({ decks, kingsReveal } = {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameType !== 'bloody99' || room.gameStarted) return;
    const player = b9Player(room, socket.id);
    if (!player || !player.host) return;
    if (!room.b9Settings) room.b9Settings = { decks: null, kingsReveal: 'both' };
    if (decks === null) room.b9Settings.decks = null; // back to the recommended count
    else if (Number.isInteger(decks)) room.b9Settings.decks = Math.max(1, Math.min(3, decks));
    if (B99_KING_REVEALS.includes(kingsReveal)) room.b9Settings.kingsReveal = kingsReveal;
    broadcastRoomUpdate(room);
  });

  // Event: Play a card on your turn
  socket.on('bloody99_play', (action = {}) => {
    const ctx = getBloody99Context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.b9TurnId !== player.id) {
      socket.emit('errorMsg', '還沒輪到你。');
      return;
    }
    const error = b9Play(room, player, action);
    if (error) socket.emit('errorMsg', error);
    broadcastRoomUpdate(room);
  });

  // Event: Host skips a player who is away (they don't play this turn)
  socket.on('bloody99_skip', () => {
    const ctx = getBloody99Context(socket);
    if (!ctx || !ctx.player.host) return;
    const { room } = ctx;
    const current = b9Player(room, room.b9TurnId);
    const next = b9NextAlive(room, room.b9TurnId);
    if (!current || !next) return;
    room.b9TurnId = next.id;
    addLog(room, 'system', `⏭️ 房主跳過了 ${current.name}。`);
    broadcastRoomUpdate(room);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
