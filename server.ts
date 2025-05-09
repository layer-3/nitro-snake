import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';

// Extend WebSocket type to include our custom properties
interface SnakeWebSocket extends WebSocket {
  playerId: string;
  roomId: string;
}

interface Player {
  id: string;
  nickname: string;
  position: { x: number; y: number };
  direction: 'up' | 'down' | 'left' | 'right';
  segments: Array<{ x: number; y: number }>;
  score: number;
}

interface Room {
  id: string;
  players: Map<string, Player>;
  food: { x: number; y: number };
  gameInterval: NodeJS.Timeout | null;
  gridSize: { width: number; height: number };
}

const rooms = new Map<string, Room>();

// Create HTTP server
const server = createServer();

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Generate room ID
function generateRoomId(): string {
  return randomBytes(16).toString('hex');
}

// Generate food position
function generateFood(gridSize: { width: number; height: number }, players: Map<string, Player>): { x: number; y: number } {
  let x: number, y: number;
  let validPosition = false;
  
  while (!validPosition) {
    x = Math.floor(Math.random() * gridSize.width);
    y = Math.floor(Math.random() * gridSize.height);
    
    validPosition = true;
    
    // Check if food position collides with any player segment
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

// Initialize player
function initializePlayer(id: string, nickname: string, gridSize: { width: number; height: number }): Player {
  // Place player randomly on the grid
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
function gameTick(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const { players, food, gridSize } = room;
  const playersArray = Array.from(players.values());
  
  // Move each player
  for (const player of playersArray) {
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
    for (const otherPlayer of playersArray) {
      // Skip first segment of the current player
      const segments = otherPlayer === player ? 
        otherPlayer.segments.slice(1) : 
        otherPlayer.segments;
      
      for (const segment of segments) {
        if (head.x === segment.x && head.y === segment.y) {
          // Collision detected - reset the player
          const { width, height } = gridSize;
          player.position = { 
            x: Math.floor(Math.random() * (width - 10)) + 5,
            y: Math.floor(Math.random() * (height - 10)) + 5
          };
          player.segments = [{ ...player.position }];
          player.score = Math.max(0, player.score - 20);
          break;
        }
      }
    }
  }
  
  // Broadcast game state to all players in the room
  broadcastGameState(roomId);
}

// Broadcast game state to all clients in a room
function broadcastGameState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const gameState = {
    type: 'gameState',
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      nickname: p.nickname,
      segments: p.segments,
      score: p.score
    })),
    food: room.food,
    gridSize: room.gridSize
  };
  
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
          
          // Create room
          const room: Room = {
            id: roomId,
            players: new Map([[player.id, player]]),
            food: generateFood(gridSize, new Map([[player.id, player]])),
            gameInterval: null,
            gridSize
          };
          
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
          
          // Respond with room info
          snakeWs.send(JSON.stringify({
            type: 'roomJoined',
            roomId,
            playerId: player.id
          }));
          
          console.log(`Player joined room: ${roomId}`);
          
          // Start game if we have 2 players
          if (room.players.size === 2 && !room.gameInterval) {
            room.gameInterval = setInterval(() => gameTick(roomId), 150);
            broadcastGameState(roomId);
          }
          
          break;
        }
        
        case 'changeDirection': {
          const roomId = snakeWs.roomId;
          const { direction } = data;
          
          if (!roomId) return;
          
          const room = rooms.get(roomId);
          if (!room) return;
          
          const player = room.players.get(snakeWs.playerId);
          if (!player) return;
          
          // Prevent 180 degree turns
          if (player.direction === 'up' && direction === 'down') return;
          if (player.direction === 'down' && direction === 'up') return;
          if (player.direction === 'left' && direction === 'right') return;
          if (player.direction === 'right' && direction === 'left') return;
          
          player.direction = direction;
          break;
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  snakeWs.on('close', () => {
    console.log('Client disconnected');
    
    const roomId = snakeWs.roomId;
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
      rooms.delete(roomId);
      console.log(`Room deleted: ${roomId}`);
    } else {
      // Broadcast updated game state
      broadcastGameState(roomId);
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server is running on port ${PORT}`);
});