import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import axios from 'axios';

interface SnakeWebSocket extends WebSocket {
  playerId: string;
  roomId: string;
  channelId?: string; 
}

interface Player {
  id: string;
  nickname: string;
  position: { x: number; y: number };
  direction: 'up' | 'down' | 'left' | 'right';
  segments: Array<{ x: number; y: number }>;
  score: number;
  isDead?: boolean;
}

interface Room {
  id: string;
  players: Map<string, Player>;
  food: { x: number; y: number };
  gameInterval: NodeJS.Timeout | null;
  gridSize: { width: number; height: number };
  isGameOver?: boolean;
  channelIds: Set<string>;
  currentState: any;
  stateVersion: number;
  pendingSignatures: Map<string, { 
    channelId: string;
    state: any; 
    signatures: Map<string, string>;
    timestamp: number;
  }[]>; // indexed by channel ID
}

const rooms = new Map<string, Room>();

// ClearNet RPC configuration
const CLEARNET_RPC_URL = process.env.CLEARNET_RPC_URL || 'https://api.clearnet.dev/rpc';
const CLEARNET_API_KEY = process.env.CLEARNET_API_KEY || 'dev-key';

// ClearNet RPC client functions
const clearNetRPC = {
  async submitState(channelId: string, state: any): Promise<boolean> {
    try {
      const response = await axios.post(`${CLEARNET_RPC_URL}/channels/${channelId}/state`, 
        { state },
        { headers: { 'X-API-Key': CLEARNET_API_KEY } }
      );
      return response.status === 200;
    } catch (error) {
      console.error(`Error submitting state to ClearNet RPC for channel ${channelId}:`, error);
      return false;
    }
  },

  async registerWatchtower(channelId: string): Promise<boolean> {
    try {
      const response = await axios.post(`${CLEARNET_RPC_URL}/channels/${channelId}/watchtower`,
        {},
        { headers: { 'X-API-Key': CLEARNET_API_KEY } }
      );
      return response.status === 200;
    } catch (error) {
      console.error(`Error registering watchtower for channel ${channelId}:`, error);
      return false;
    }
  },

  async finalizeChannel(channelId: string, finalState: any): Promise<boolean> {
    try {
      const response = await axios.post(`${CLEARNET_RPC_URL}/channels/${channelId}/finalize`,
        { finalState },
        { headers: { 'X-API-Key': CLEARNET_API_KEY } }
      );
      return response.status === 200;
    } catch (error) {
      console.error(`Error finalizing channel ${channelId}:`, error);
      return false;
    }
  },

  async getChannelInfo(channelId: string): Promise<any> {
    try {
      const response = await axios.get(`${CLEARNET_RPC_URL}/channels/${channelId}`,
        { headers: { 'X-API-Key': CLEARNET_API_KEY } }
      );
      return response.data;
    } catch (error) {
      console.error(`Error getting info for channel ${channelId}:`, error);
      return null;
    }
  }
};

// Create HTTP server
const server = createServer();

// Create WebSocket server
const wss = new WebSocketServer({ server });

function generateRoomId(): string {
  return randomBytes(16).toString('hex');
}

function generateFood(gridSize: { width: number; height: number }, players: Map<string, Player>): { x: number; y: number } {
  let x: number, y: number;
  let validPosition = false;
  
  while (!validPosition) {
    x = Math.floor(Math.random() * gridSize.width);
    y = Math.floor(Math.random() * gridSize.height);
    
    validPosition = true;
    
    for (const player of players.values()) {
      for (const segment of player.segments) {
        if (segment.x === x && segment.y === y) {
          validPosition = false;
          break;
        }
      }
      if (!validPosition) break;
    }
  }
  
  return { x, y };
}

function initializePlayer(id: string, nickname: string, gridSize: { width: number; height: number }): Player {
  const x = Math.floor(Math.random() * (gridSize.width - 10)) + 5;
  const y = Math.floor(Math.random() * (gridSize.height - 10)) + 5;
  
  return {
    id,
    nickname,
    position: { x, y },
    direction: ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)] as 'up' | 'down' | 'left' | 'right',
    segments: [{ x, y }],
    score: 0
  };
}

// Game tick for a room
async function gameTick(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  // If game is over, don't process any more ticks
  if (room.isGameOver) {
    return;
  }
  
  const { players, food, gridSize } = room;
  const playersArray = Array.from(players.values());
  
  // Move each player
  for (const player of playersArray) {
    // Skip if player is dead
    if (player.isDead) continue;
    
    // Get current head position
    const head = { ...player.position };
    
    // Move head based on direction
    switch (player.direction) {
      case 'up':
        head.y = (head.y - 1 + gridSize.height) % gridSize.height;
        break;
      case 'down':
        head.y = (head.y + 1) % gridSize.height;
        break;
      case 'left':
        head.x = (head.x - 1 + gridSize.width) % gridSize.width;
        break;
      case 'right':
        head.x = (head.x + 1) % gridSize.width;
        break;
    }
    
    // Update player position
    player.position = head;
    
    // Check if player ate food
    if (head.x === food.x && head.y === food.y) {
      player.score += 10;
      // Add new segment (will be handled below - we don't remove the tail)
      // Generate new food
      room.food = generateFood(gridSize, players);
    } else {
      // Remove tail if didn't eat food
      player.segments.pop();
    }
    
    // Add new head to segments
    player.segments.unshift({ ...head });
    
    // Check for collisions with other players
    let isCollision = false;
    for (const otherPlayer of playersArray) {
      // Skip first segment of the current player
      const segments = otherPlayer === player ? 
        otherPlayer.segments.slice(1) : 
        otherPlayer.segments;
      
      for (const segment of segments) {
        if (head.x === segment.x && head.y === segment.y) {
          // Collision detected - mark player as dead
          isCollision = true;
          player.isDead = true;
          break;
        }
      }
      if (isCollision) break;
    }
  }
  
  // Check if game is over (only one player left alive or all players dead)
  if (playersArray.length > 1) {
    const alivePlayers = playersArray.filter(p => !p.isDead);
    if (alivePlayers.length <= 1) {
      room.isGameOver = true;
      
      // If there's an interval, clear it to stop the game
      if (room.gameInterval) {
        clearInterval(room.gameInterval);
        room.gameInterval = null;
      }
    }
  }
  
  // Broadcast game state to all players in the room
  broadcastGameState(roomId);
}

// Broadcast game state to all clients in a room and update ClearNet channels
async function broadcastGameState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  
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
  
  // Store the current state in the room for ClearNet
  room.currentState = gameState;
  
  // Submit state to all ClearNet channels associated with this room
  if (room.channelIds.size > 0) {
    // Create a simplified state for the channel to reduce size
    const channelState = {
      roomId,
      stateVersion: gameState.stateVersion,
      players: gameState.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        isDead: p.isDead
      })),
      isGameOver: gameState.isGameOver,
      timestamp: gameState.timestamp
    };
    
    // For each channel, request signatures from participants
    for (const channelId of room.channelIds) {
      // Create a pending signature entry for this state
      if (!room.pendingSignatures.has(channelId)) {
        room.pendingSignatures.set(channelId, []);
      }
      
      const pendingState = {
        channelId,
        state: channelState,
        signatures: new Map<string, string>(),
        timestamp: Date.now()
      };
      
      room.pendingSignatures.get(channelId)?.push(pendingState);
      
      // Request signatures from all players in the room
      wss.clients.forEach(client => {
        const snakeClient = client as SnakeWebSocket;
        if (snakeClient.roomId === roomId && snakeClient.readyState === WebSocket.OPEN) {
          const stateForSignature = {
            type: 'signState',
            channelId,
            state: channelState,
            stateId: `${roomId}-${channelState.stateVersion}`,
          };
          
          snakeClient.send(JSON.stringify(stateForSignature));
        }
      });
    }
    
    // Clean up old pending signatures (older than 1 minute)
    const ONE_MINUTE = 60 * 1000;
    for (const [channelId, pendingStates] of room.pendingSignatures.entries()) {
      const currentTime = Date.now();
      const validStates = pendingStates.filter(entry => 
        (currentTime - entry.timestamp) < ONE_MINUTE
      );
      room.pendingSignatures.set(channelId, validStates);
    }
  }
    
    // If game is over, finalize channels
    if (gameState.isGameOver) {
      const finalizePromises = Array.from(room.channelIds).map(channelId => 
        clearNetRPC.finalizeChannel(channelId, {
          ...channelState,
          finalizedAt: Date.now()
        })
      );
      
      try {
        await Promise.all(finalizePromises);
        console.log(`Finalized all channels for room ${roomId}`);
      } catch (error) {
        console.error(`Error finalizing channels for room ${roomId}:`, error);
      }
    }
  }
  
  // Broadcast to all players in the room
  wss.clients.forEach(client => {
    const snakeClient = client as SnakeWebSocket;
    if (snakeClient.roomId === roomId && snakeClient.readyState === WebSocket.OPEN) {
      snakeClient.send(JSON.stringify(gameState));
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');
  
  const snakeWs = ws as SnakeWebSocket;
  snakeWs.playerId = randomBytes(8).toString('hex');
  
  snakeWs.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'createRoom': {
          const roomId = generateRoomId();
          const { nickname } = data;
          const gridSize = { width: 40, height: 30 };
          
          // Create player
          const player = initializePlayer(snakeWs.playerId, nickname, gridSize);
          
          // Create room with channel support
          const room: Room = {
            id: roomId,
            players: new Map([[player.id, player]]),
            food: generateFood(gridSize, new Map([[player.id, player]])),
            gameInterval: null,
            gridSize,
            channelIds: new Set(),
            currentState: null,
            stateVersion: 0,
            pendingSignatures: new Map()
          };
          
          // Add channelId if provided
          if (data.channelId) {
            room.channelIds.add(data.channelId);
            snakeWs.channelId = data.channelId;
            
            // Register watchtower for the channel if needed
            try {
              await clearNetRPC.registerWatchtower(data.channelId);
            } catch (error) {
              console.error(`Error registering watchtower for channel ${data.channelId}:`, error);
            }
          }
          
          rooms.set(roomId, room);
          
          snakeWs.roomId = roomId;
          
          // Respond with room info
          snakeWs.send(JSON.stringify({
            type: 'roomCreated',
            roomId,
            playerId: player.id
          }));
          
          console.log(`Room created: ${roomId}`);
          break;
        }
        
        case 'joinRoom': {
          const { roomId, nickname } = data;
          const room = rooms.get(roomId);
          
          if (!room) {
            snakeWs.send(JSON.stringify({
              type: 'error',
              message: 'Room not found'
            }));
            return;
          }
          
          if (room.players.size >= 2) {
            snakeWs.send(JSON.stringify({
              type: 'error',
              message: 'Room is full'
            }));
            return;
          }
          
          // Create player
          const player = initializePlayer(snakeWs.playerId, nickname, room.gridSize);
          
          // Add player to room
          room.players.set(player.id, player);
          
          snakeWs.roomId = roomId;
          
          // Add channelId if provided
          if (data.channelId) {
            room.channelIds.add(data.channelId);
            snakeWs.channelId = data.channelId;
            
            // Register watchtower for the channel if needed
            try {
              await clearNetRPC.registerWatchtower(data.channelId);
            } catch (error) {
              console.error(`Error registering watchtower for channel ${data.channelId}:`, error);
            }
          }
          
          // Respond with room info
          snakeWs.send(JSON.stringify({
            type: 'roomJoined',
            roomId,
            playerId: player.id
          }));
          
          console.log(`Player joined room: ${roomId}`);
          
          // Start game if we have 2 players
          if (room.players.size === 2 && !room.gameInterval) {
            room.gameInterval = setInterval(async () => {
              await gameTick(roomId);
            }, 150);
            
            // Initial game state broadcast
            await broadcastGameState(roomId);
          }
          
          break;
        }
        
        case 'changeDirection': {
          const roomId = snakeWs.roomId;
          const { direction } = data;
          
          if (!roomId) return;
          
          const room = rooms.get(roomId);
          if (!room) return;
          
          // Don't process direction changes if game is over
          if (room.isGameOver) return;
          
          const player = room.players.get(snakeWs.playerId);
          if (!player) return;
          
          // Don't allow dead players to change direction
          if (player.isDead) return;
          
          // Prevent 180 degree turns
          if (player.direction === 'up' && direction === 'down') return;
          if (player.direction === 'down' && direction === 'up') return;
          if (player.direction === 'left' && direction === 'right') return;
          if (player.direction === 'right' && direction === 'left') return;
          
          player.direction = direction;
          break;
        }

        case 'playAgain': {
          const { roomId } = data;
          if (!roomId) return;
          
          const room = rooms.get(roomId);
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
          
          // Broadcast initial game state
          await broadcastGameState(roomId);
          
          break;
        }
        
        case 'stateSignature': {
          const { channelId, stateId, signature, playerId } = data;
          if (!channelId || !stateId || !signature || !playerId) return;
          
          const roomId = snakeWs.roomId;
          if (!roomId) return;
          
          const room = rooms.get(roomId);
          if (!room) return;
          
          // Find the pending state for this signature
          const pendingStates = room.pendingSignatures.get(channelId);
          if (!pendingStates || pendingStates.length === 0) return;
          
          // Extract state version from stateId (format: "roomId-stateVersion")
          const stateVersionStr = stateId.split('-')[1];
          if (!stateVersionStr) return;
          
          // Find the pending state with the matching version
          const stateVersion = parseInt(stateVersionStr);
          const pendingStateIndex = pendingStates.findIndex(p => p.state.stateVersion === stateVersion);
          
          if (pendingStateIndex >= 0) {
            const pendingState = pendingStates[pendingStateIndex];
            
            // Add signature to the pending state
            pendingState.signatures.set(playerId, signature);
            
            // If we have signatures from all players in the room, submit the state
            if (pendingState.signatures.size >= room.players.size) {
              try {
                // Add signatures to the state
                const stateWithSignatures = {
                  ...pendingState.state,
                  signatures: Object.fromEntries(pendingState.signatures)
                };
                
                // Submit state to ClearNet RPC
                await clearNetRPC.submitState(channelId, stateWithSignatures);
                
                // Remove this state from pending signatures
                pendingStates.splice(pendingStateIndex, 1);
                
                console.log(`Successfully submitted state ${stateId} to channel ${channelId}`);
              } catch (error) {
                console.error(`Error submitting state ${stateId} to channel ${channelId}:`, error);
              }
            }
          }
          
          break;
        }
        
        case 'finalizeChannel': {
          const { channelId, roomId } = data;
          if (!channelId || !roomId) return;
          
          const room = rooms.get(roomId);
          if (!room) return;
          
          // Finalize the channel
          try {
            const channelState = {
              roomId,
              stateVersion: room.stateVersion,
              players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                nickname: p.nickname,
                score: p.score,
                isDead: p.isDead || false
              })),
              isGameOver: true,
              finalizedAt: Date.now()
            };
            
            await clearNetRPC.finalizeChannel(channelId, channelState);
            
            // Remove the channel from the room
            room.channelIds.delete(channelId);
            
            snakeWs.send(JSON.stringify({
              type: 'channelFinalized',
              channelId
            }));
          } catch (error) {
            console.error(`Error finalizing channel ${channelId}:`, error);
            
            snakeWs.send(JSON.stringify({
              type: 'error',
              message: 'Failed to finalize channel'
            }));
          }
          
          break;
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  snakeWs.on('close', async () => {
    console.log('Client disconnected');
    
    const roomId = snakeWs.roomId;
    const channelId = snakeWs.channelId;
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Remove player from room
    room.players.delete(snakeWs.playerId);
    
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
      
      rooms.delete(roomId);
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
      
      // Broadcast updated game state
      await broadcastGameState(roomId);
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server is running on port ${PORT}`);
});
