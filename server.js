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
    roles = [true, true, true, true, false, false, false, false];
  } else if (playerCount === 8) {
    roles = [true, true, true, true, true, false, false, false];
  }
  shuffle(roles);
  return roles.slice(0, playerCount);
}

// Helper: Sanitize room state to send to clients (hide secrets!)
function getSanitizedRoomState(room, socketId) {
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
      secretHand: isSelf && !p.readyToDeploy ? p.secretHand : null
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
  socket.on('createRoom', ({ name }) => {
    if (!name || name.trim() === '') {
      socket.emit('errorMsg', '請輸入有效的名字。');
      return;
    }

    const code = generateRoomCode();
    const room = {
      roomCode: code,
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
      isBot: true,
      successDeclared: 0,
      bombDeclared: 0
    });

    addLog(room, 'system', `${botName} (AI 機器人) 已加入房間。`);
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
    if (playerCount < 4 || playerCount > 8) {
      socket.emit('errorMsg', '遊戲需要 4 到 8 名玩家/機器人才能開始。');
      return;
    }

    room.gameStarted = true;
    room.gameEnded = false;
    room.summaryRevealed = false;
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
    room.players.forEach((p, idx) => {
      p.role = roles[idx] ? 'Sherlock' : 'Moriarty';
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
      p.successDeclared = 0;
      p.bombDeclared = 0;
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

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
