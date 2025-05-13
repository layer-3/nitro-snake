import { WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { Player, Room } from '../interfaces';
import { getRoom } from './stateService';
import { closeAppSession } from './brokerService';

// Import websocketService to broadcast game state - imported at bottom of file to avoid circular dependency
let broadcastGameStateToClients: (roomId: string, gameState: any) => void;

// Generate a random room ID
export function generateRoomId(): string {
  return randomBytes(16).toString('hex');
}

// Generate a random food position
export function generateFood(
  gridSize: { width: number; height: number }, 
  players: Map<string, Player>
): { x: number; y: number } {
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

// Initialize a new player
export function initializePlayer(
  id: string, 
  nickname: string, 
  gridSize: { width: number; height: number }
): Player {
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

// Initialize broadcast function
export function initializeBroadcastFunction(
  broadcastFn: (roomId: string, gameState: any) => void
): void {
  broadcastGameStateToClients = broadcastFn;
}

// Process one game tick for a room
export async function gameTick(roomId: string): Promise<void> {
  const room = getRoom(roomId);
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
  await broadcastGameState(roomId);
}

// Broadcast game state to all clients in a room
export async function broadcastGameState(roomId: string): Promise<void> {
  const room = getRoom(roomId);
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
  
  // Store the current state in the room
  room.currentState = gameState;
  
  // If game is over, close the app session on the broker
  if (gameState.isGameOver && room.appId && room.channelIds.size > 0) {
    // Get the final allocations based on scores
    const players = Array.from(room.players.values());
    
    // Find the winner (player with highest score)
    const winner = players.reduce((highest, player) => 
      !highest || player.score > highest.score ? player : highest
    , players[0]);
    
    // Get the channel ID
    const channelId = Array.from(room.channelIds)[0];
    
    // Determine allocations
    // Give all the money to the player with the highest score
    // We could also distribute proportionally based on scores
    const allocations = [0, 0];
    
    // Lookup player address using playerId
    const winnerIndex = players.findIndex(p => p.id === winner.id);
    if (winnerIndex !== -1) {
      allocations[winnerIndex] = 100; // Give 100% to the winner
    }
    
    try {
      // Close the app session with the final state and allocations
      await closeAppSession(
        room.appId,
        channelId,
        {
          finalGameState: gameState,
          winner: winner.id,
          scores: players.map(p => ({ id: p.id, score: p.score })),
          timestamp: Date.now()
        },
        allocations
      );
      console.log(`Closed app session for room ${roomId} with winner ${winner.id}`);
    } catch (error) {
      console.error(`Error closing app session for room ${roomId}:`, error);
    }
  }
  
  // Broadcast to all players in the room if the broadcast function is initialized
  if (broadcastGameStateToClients) {
    broadcastGameStateToClients(roomId, gameState);
  }
}

// Mock ClearNet RPC for now
export const clearNetRPC = {
  getChannelInfo: async (channelId: string) => {
    return {
      id: channelId,
      participants: [],
      status: 'open'
    };
  },
  finalizeChannel: async (channelId: string, finalState: any) => {
    console.log(`Mock finalizing channel ${channelId} with state:`, finalState);
    return true;
  }
};