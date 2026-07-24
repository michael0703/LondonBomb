const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Global state for rooms
const rooms = new Map();

// Bot Names
const BOT_NAMES = ['福爾摩斯機器人', '華生機器人', '雷斯特雷德機器人', '哈德森太太機器人', '麥考夫特機器人', '艾琳艾德勒機器人', '莫蘭上校機器人', '格雷格森機器人'];

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
  room.players.forEach(p => {
    if (p.connected && !p.isBot) {
      io.to(p.id).emit('roomUpdate', getSanitizedRoomState(room, p.id));
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
    socket.join(code);
    
    addLog(room, 'system', `${name.trim()} 建立了遊戲房間 ${code}。`);
    socket.emit('roomCreated', code);
    broadcastRoomUpdate(room);
  });

  // Event: Join Room
  socket.on('joinRoom', ({ name, roomCode }) => {
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

    if (room.gameStarted) {
      socket.emit('errorMsg', '該房間的遊戲已經開始。');
      return;
    }

    if (room.players.length >= 8) {
      socket.emit('errorMsg', '房間人數已滿（最多8人）。');
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

    socket.join(code);
    addLog(room, 'system', `${name.trim()} 加入了房間。`);
    broadcastRoomUpdate(room);
  });

  // Event: Add AI Bot
  socket.on('addBot', () => {
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }
    if (!room || room.gameStarted || room.players.length >= 8) return;
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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
      if (playerCount < 4 || playerCount > 8) {
        socket.emit('errorMsg', '遊戲需要 4 到 8 名玩家/機器人才能開始。');
        return;
      }
    } else if (room.gameType === 'skull') {
      if (playerCount < 2 || playerCount > 8) {
        socket.emit('errorMsg', '遊戲需要 2 到 8 名玩家/機器人才能開始。');
        return;
      }
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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }
    if (!room || !room.gameStarted || room.gameEnded) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.roleRevealed) return;

    player.roleRevealed = true;
    broadcastRoomUpdate(room);
  });

  // Event: Deploy Cards
  socket.on('deployCards', () => {
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

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
    let room = null;
    for (const r of rooms.values()) {
      if (r.players.some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.host) return;

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

    addLog(room, 'system', '房主重設了對局，返回候戰室。');
    broadcastRoomUpdate(room);
  });

  // Event: Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const [code, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        
        if (!room.gameStarted) {
          room.players.splice(playerIndex, 1);
          addLog(room, 'system', `${player.name} 離開了房間。`);
          
          if (room.players.length === 0) {
            if (room.declarationIntervalId) clearInterval(room.declarationIntervalId);
            rooms.delete(code);
            console.log(`Room ${code} deleted (empty).`);
          } else {
            if (player.host) {
              room.players[0].host = true;
              addLog(room, 'system', `${room.players[0].name} 現在是新的房主。`);
            }
            broadcastRoomUpdate(room);
          }
        } else {
          player.connected = false;
          addLog(room, 'system', `⚠️ ${player.name} 失去連接。`);
          
          const allDisconnected = room.players.every(p => !p.connected);
          if (allDisconnected) {
            if (room.declarationIntervalId) clearInterval(room.declarationIntervalId);
            rooms.delete(code);
            console.log(`Room ${code} deleted (all players disconnected).`);
          } else {
            if (player.host) {
              const nextActive = room.players.find(p => p.connected && !p.isBot);
              if (nextActive) {
                nextActive.host = true;
                player.host = false;
                addLog(room, 'system', `${nextActive.name} 現在是新的房主。`);
              }
            }
            broadcastRoomUpdate(room);
          }
        }
        break;
      }
    }
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

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
