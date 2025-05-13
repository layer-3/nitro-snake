import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { Room, SnakeWebSocket } from '../interfaces';
import { getRoom, addRoom, removeRoom } from './stateService';
import {
  generateRoomId,
  generateFood,
  initializePlayer,
  gameTick,
  clearNetRPC,
  initializeBroadcastFunction
} from './gameService';
import { createAppSession } from './brokerService';
import { SERVER_PRIVATE_KEY } from '../config';

// Global reference to the WebSocket server
let webSocketServer: WebSocketServer;

// Setup WebSocket handlers
export function setupWebSocketHandlers(wss: WebSocketServer): void {
  webSocketServer = wss;

  // Initialize the broadcast function in gameService
  initializeBroadcastFunction(broadcastGameState);

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');

    const snakeWs = ws as SnakeWebSocket;
    snakeWs.playerId = randomBytes(8).toString('hex');

    snakeWs.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        await handleWebSocketMessage(snakeWs, data);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    snakeWs.on('close', async () => {
      await handleDisconnect(snakeWs);
    });
  });
}

// Get WebSocketServer instance
export function getWebSocketServer(): WebSocketServer {
  return webSocketServer;
}

// Broadcast game state to all clients in a room
export function broadcastGameState(roomId: string, gameState: any): void {
  webSocketServer.clients.forEach(client => {
    const snakeClient = client as SnakeWebSocket;
    if (snakeClient.roomId === roomId && snakeClient.readyState === WebSocket.OPEN) {
      snakeClient.send(JSON.stringify(gameState));
    }
  });
}

// Handle WebSocket message
async function handleWebSocketMessage(ws: SnakeWebSocket, data: any): Promise<void> {
  switch (data.type) {
    case 'createRoom': {
      await handleCreateRoom(ws, data);
      break;
    }

    case 'joinRoom': {
      await handleJoinRoom(ws, data);
      break;
    }

    case 'changeDirection': {
      await handleChangeDirection(ws, data);
      break;
    }

    case 'playAgain': {
      await handlePlayAgain(ws, data);
      break;
    }

    case 'finalizeGame': {
      await handleFinalizeGame(ws, data);
      break;
    }
  }
}

// Handle create room message
async function handleCreateRoom(ws: SnakeWebSocket, data: any): Promise<void> {
  const roomId = generateRoomId();
  const { nickname, channelId, walletAddress } = data;
  const gridSize = { width: 40, height: 30 };

  // Create player
  const player = initializePlayer(ws.playerId, nickname, gridSize);

  // Create room with channel support
  const room: Room = {
    id: roomId,
    players: new Map([[player.id, player]]),
    food: generateFood(gridSize, new Map([[player.id, player]])),
    gameInterval: null,
    gridSize,
    channelIds: new Set(),
    playerAddresses: new Map([[player.id, walletAddress]]),
    currentState: null,
    stateVersion: 0,
    createdAt: Date.now()
  };

  // Add channelId if provided
  if (channelId) {
    room.channelIds.add(channelId);
    ws.channelId = channelId;
  }

  // Store the room
  addRoom(roomId, room);

  ws.roomId = roomId;

  // Respond with room info
  ws.send(JSON.stringify({
    type: 'roomCreated',
    roomId,
    playerId: player.id
  }));

  console.log(`Room created: ${roomId}, Player: ${player.id}, Address: ${walletAddress}`);
}

// Handle join room message
async function handleJoinRoom(ws: SnakeWebSocket, data: any): Promise<void> {
  const { roomId, nickname, channelId, walletAddress } = data;
  const room = getRoom(roomId);

  if (!room) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Room not found'
    }));
    return;
  }

  if (room.players.size >= 2) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Room is full'
    }));
    return;
  }

  // Create player
  const player = initializePlayer(ws.playerId, nickname, room.gridSize);

  // Add player to room
  room.players.set(player.id, player);
  room.playerAddresses.set(player.id, walletAddress);

  ws.roomId = roomId;

  // Add channelId if provided
  if (channelId) {
    room.channelIds.add(channelId);
    ws.channelId = channelId;
  }

  // Respond with room info
  ws.send(JSON.stringify({
    type: 'roomJoined',
    roomId,
    playerId: player.id
  }));

  console.log(`Player joined room: ${roomId}, Player: ${player.id}, Address: ${walletAddress}`);

  // If we have 2 players and a channel, create the app session
  if (room.players.size === 2 && room.channelIds.size > 0) {
    try {
      // Get the channel ID
      const channelId = Array.from(room.channelIds)[0];

      // Get player addresses
      const playerAddresses = Array.from(room.playerAddresses.values());

      // Create the app ID
      const appId = `snake_${roomId}_${Date.now()}`;

      // Get the server's wallet address
      const wallet = new ethers.Wallet(SERVER_PRIVATE_KEY);

      // Create the participants array with server as third participant
      const participants = [...playerAddresses, wallet.address];

      // Create the app session
      const createdAppId = await createAppSession(
        channelId,
        participants,
        appId,
        {
          gameId: roomId,
          initialState: "game_started",
          timestamp: Date.now()
        }
      );

      // Store the app ID in the room
      room.appId = createdAppId;

      console.log(`Created app session ${createdAppId} for room ${roomId}`);

      // Start the game
      room.gameInterval = setInterval(async () => {
        await gameTick(roomId);
      }, 150);

      // Initial game state broadcast
      const gameState = {
        type: 'gameState',
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          nickname: p.nickname,
          segments: p.segments,
          score: p.score,
          isDead: p.isDead || false
        })),
        food: room.food,
        gridSize: room.gridSize,
        isGameOver: room.isGameOver || false,
        stateVersion: ++room.stateVersion,
        timestamp: Date.now()
      };

      // Store the current state in the room
      room.currentState = gameState;

      // Broadcast to all players in the room
      broadcastGameState(roomId, gameState);
    } catch (error) {
      console.error(`Error creating app session for room ${roomId}:`, error);

      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to create app session'
      }));
    }
  }
}

// Handle change direction message
async function handleChangeDirection(ws: SnakeWebSocket, data: any): Promise<void> {
  const roomId = ws.roomId;
  const { direction } = data;

  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room) return;

  // Don't process direction changes if game is over
  if (room.isGameOver) return;

  const player = room.players.get(ws.playerId);
  if (!player) return;

  // Don't allow dead players to change direction
  if (player.isDead) return;

  // Prevent 180 degree turns
  if (player.direction === 'up' && direction === 'down') return;
  if (player.direction === 'down' && direction === 'up') return;
  if (player.direction === 'left' && direction === 'right') return;
  if (player.direction === 'right' && direction === 'left') return;

  player.direction = direction;
}

// Handle play again message
async function handlePlayAgain(ws: SnakeWebSocket, data: any): Promise<void> {
  const { roomId } = data;
  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room) return;

  // Reset game state
  room.isGameOver = false;

  // Reset players
  for (const player of room.players.values()) {
    const { width, height } = room.gridSize;
    const x = Math.floor(Math.random() * (width - 10)) + 5;
    const y = Math.floor(Math.random() * (height - 10)) + 5;

    player.position = { x, y };
    player.direction = ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)] as 'up' | 'down' | 'left' | 'right';
    player.segments = [{ x, y }];
    player.score = 0;
    player.isDead = false;
  }

  // Create new food
  room.food = generateFood(room.gridSize, room.players);

  // Reset state version
  room.stateVersion = 0;

  // Restart game interval if needed
  if (!room.gameInterval) {
    room.gameInterval = setInterval(async () => {
      await gameTick(roomId);
    }, 150);
  }

  // Create and broadcast initial game state
  const gameState = {
    type: 'gameState',
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      nickname: p.nickname,
      segments: p.segments,
      score: p.score,
      isDead: p.isDead || false
    })),
    food: room.food,
    gridSize: room.gridSize,
    isGameOver: room.isGameOver || false,
    stateVersion: ++room.stateVersion,
    timestamp: Date.now()
  };

  // Store the current state in the room
  room.currentState = gameState;

  // Broadcast to all players in the room
  broadcastGameState(roomId, gameState);
}

// Handle finalize game message
async function handleFinalizeGame(ws: SnakeWebSocket, data: any): Promise<void> {
  const roomId = ws.roomId;
  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room || !room.appId) return;

  // For manual finalization - end the game immediately
  if (room.gameInterval) {
    clearInterval(room.gameInterval);
    room.gameInterval = null;
  }

  room.isGameOver = true;

  // Create and broadcast final game state
  const gameState = {
    type: 'gameState',
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      nickname: p.nickname,
      segments: p.segments,
      score: p.score,
      isDead: p.isDead || false
    })),
    food: room.food,
    gridSize: room.gridSize,
    isGameOver: true,
    stateVersion: ++room.stateVersion,
    timestamp: Date.now()
  };

  // Store the current state in the room
  room.currentState = gameState;

  // Broadcast to all players in the room
  broadcastGameState(roomId, gameState);
}

// Handle client disconnect
async function handleDisconnect(ws: SnakeWebSocket): Promise<void> {
  console.log('Client disconnected');

  const roomId = ws.roomId;
  const channelId = ws.channelId;
  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room) return;

  // Remove player from room
  room.players.delete(ws.playerId);

  // If room is empty, clean up
  if (room.players.size === 0) {
    if (room.gameInterval) {
      clearInterval(room.gameInterval);
    }

    // Finalize any remaining channels
    if (room.channelIds.size > 0) {
      const finalState = {
        roomId,
        stateVersion: room.stateVersion,
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          isDead: p.isDead || false
        })),
        isGameOver: true,
        finalizedAt: Date.now(),
        reason: 'room_closed'
      };

      const finalizePromises = Array.from(room.channelIds).map(id =>
        clearNetRPC.finalizeChannel(id, finalState)
      );

      try {
        await Promise.all(finalizePromises);
        console.log(`Finalized all channels for closing room ${roomId}`);
      } catch (error) {
        console.error(`Error finalizing channels for room ${roomId}:`, error);
      }
    }

    removeRoom(roomId);
    console.log(`Room deleted: ${roomId}`);
  } else {
    // If this client had a channel associated, mark the game as over
    if (channelId && room.channelIds.has(channelId)) {
      room.isGameOver = true;

      // Finalize this channel
      try {
        const finalState = {
          roomId,
          stateVersion: room.stateVersion,
          players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            nickname: p.nickname,
            score: p.score,
            isDead: p.isDead || false
          })),
          isGameOver: true,
          finalizedAt: Date.now(),
          reason: 'player_disconnected'
        };

        await clearNetRPC.finalizeChannel(channelId, finalState);
        room.channelIds.delete(channelId);
        console.log(`Finalized channel ${channelId} due to player disconnect`);
      } catch (error) {
        console.error(`Error finalizing channel ${channelId}:`, error);
      }
    }

    // Create updated game state
    const gameState = {
      type: 'gameState',
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        segments: p.segments,
        score: p.score,
        isDead: p.isDead || false
      })),
      food: room.food,
      gridSize: room.gridSize,
      isGameOver: room.isGameOver || false,
      stateVersion: ++room.stateVersion,
      timestamp: Date.now()
    };

    // Store the current state in the room
    room.currentState = gameState;

    // Broadcast to all remaining players in the room
    broadcastGameState(roomId, gameState);
  }
}
