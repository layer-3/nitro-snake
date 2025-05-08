import WebSocket from 'ws';
import type { GameState, Snake, Food, Direction, Position, GameCommand } from '../models/game';

// Configuration
const GRID_WIDTH = 30;
const GRID_HEIGHT = 20;
const GRID_SIZE = 20;
const GAME_TICK_RATE = 150; // milliseconds
const INITIAL_SNAKE_LENGTH = 3;

// Types specific to the game service
interface Room {
  id: string;
  players: Map<string, {
    name: string;
    color: string;
  }>;
  gameState: GameState;
  gameLoopInterval: NodeJS.Timeout | null;
  isGameStarted: boolean;
}

// Game service state
const rooms: Map<string, Room> = new Map();
const webSocketUrl = 'ws://localhost:3000';
let websocket: WebSocket | null = null;

// Connect to the WebSocket server
function connectToWebSocketServer() {
  websocket = new WebSocket(webSocketUrl);
  
  websocket.on('open', () => {
    console.log('Game service connected to WebSocket server');
    
    // Register as game service
    websocket.send(JSON.stringify({
      type: 'registerGameService'
    }));
  });
  
  websocket.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(message);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  websocket.on('close', () => {
    console.log('Connection to WebSocket server closed, reconnecting...');
    setTimeout(() => {
      connectToWebSocketServer();
    }, 5000);
  });
  
  websocket.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

// Handle incoming messages
function handleMessage(message: any) {
  switch (message.type) {
    case 'roomCreated':
      handleRoomCreated(message);
      break;
    
    case 'playerJoin':
      handlePlayerJoin(message);
      break;
    
    case 'playerLeave':
      handlePlayerLeave(message);
      break;
    
    case 'gameStart':
      handleGameStart(message);
      break;
    
    case 'gameCommand':
      handleGameCommand(message);
      break;
    
    default:
      console.log('Unknown message type:', message.type);
  }
}

// Handle room creation
function handleRoomCreated(message: any) {
  const { roomId } = message;
  
  // Initialize room
  const room: Room = {
    id: roomId,
    players: new Map(),
    gameState: {
      snakes: [],
      food: null,
      isGameOver: false,
      winner: null,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      gridSize: GRID_SIZE
    },
    gameLoopInterval: null,
    isGameStarted: false
  };
  
  rooms.set(roomId, room);
  console.log(`Room created: ${roomId}`);
  
  // Join the room
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      type: 'joinRoom',
      roomId,
      playerName: 'GameService'
    }));
  }
}

// Handle player join
function handlePlayerJoin(message: any) {
  const { roomId, playerId } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) return;
  
  const room = rooms.get(roomId)!;
  
  // Add player to room
  const color = getPlayerColor(room.players.size);
  room.players.set(playerId, {
    name: playerId,
    color
  });
  
  console.log(`Player joined: ${playerId} in room ${roomId}`);
  
  // If we have 2 players, initialize the game state
  if (room.players.size === 2) {
    initializeGameState(room);
    
    // Send initial game state to all clients
    broadcastGameState(room);
  }
}

// Handle player leave
function handlePlayerLeave(message: any) {
  const { roomId, playerId } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) return;
  
  const room = rooms.get(roomId)!;
  
  // Remove player from room
  room.players.delete(playerId);
  
  console.log(`Player left: ${playerId} from room ${roomId}`);
  
  // If the game is in progress, end it
  if (room.isGameStarted) {
    endGame(room, null);
  }
  
  // If room is empty, remove it
  if (room.players.size === 0) {
    if (room.gameLoopInterval) {
      clearInterval(room.gameLoopInterval);
    }
    rooms.delete(roomId);
    console.log(`Room removed: ${roomId}`);
  }
}

// Handle game start
function handleGameStart(message: any) {
  const { roomId, startTimestamp } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) return;
  
  const room = rooms.get(roomId)!;
  
  console.log(`Starting game in room ${roomId} at ${new Date(startTimestamp).toISOString()}`);
  
  // Calculate delay until start time
  const now = Date.now();
  const delay = startTimestamp - now;
  
  // Schedule game start
  setTimeout(() => {
    startGame(room);
  }, delay);
}

// Handle game command
function handleGameCommand(message: any) {
  const { roomId, command } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) return;
  
  const room = rooms.get(roomId)!;
  
  // Process command
  switch (command.type) {
    case 'changeDirection':
      handleDirectionChange(room, command);
      break;
    
    default:
      console.log('Unknown command:', command.type);
  }
}

// Handle direction change command
function handleDirectionChange(room: Room, command: GameCommand) {
  if (command.type !== 'changeDirection') return;
  
  const { playerId, direction } = command;
  
  // Find the player's snake
  const snake = room.gameState.snakes.find(s => s.id === playerId);
  
  if (!snake) return;
  
  // Prevent reversing direction (can't go directly opposite to current direction)
  if (
    (direction === 'up' && snake.direction === 'down') ||
    (direction === 'down' && snake.direction === 'up') ||
    (direction === 'left' && snake.direction === 'right') ||
    (direction === 'right' && snake.direction === 'left')
  ) {
    return;
  }
  
  // Update direction
  snake.direction = direction;
}

// Initialize game state
function initializeGameState(room: Room) {
  const gameState = room.gameState;
  gameState.snakes = [];
  gameState.isGameOver = false;
  gameState.winner = null;
  
  // Create snakes for each player
  let i = 0;
  for (const [playerId, player] of room.players.entries()) {
    // Place snakes at opposite corners
    let position: Position;
    let direction: Direction;
    
    if (i === 0) {
      position = { x: 5, y: 5 };
      direction = 'right';
    } else {
      position = { x: gameState.width - 5, y: gameState.height - 5 };
      direction = 'left';
    }
    
    const snake = createSnake(playerId, position, direction, player.color);
    gameState.snakes.push(snake);
    i++;
  }
  
  // Generate initial food
  gameState.food = generateFood(gameState);
}

// Create a snake with initial segments
function createSnake(id: string, headPosition: Position, direction: Direction, color: string): Snake {
  const segments = [];
  
  // Create segments in reverse direction
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    let x = headPosition.x;
    let y = headPosition.y;
    
    switch (direction) {
      case 'right':
        x -= i;
        break;
      case 'left':
        x += i;
        break;
      case 'down':
        y -= i;
        break;
      case 'up':
        y += i;
        break;
    }
    
    segments.push({ position: { x, y } });
  }
  
  return {
    id,
    segments,
    direction,
    color
  };
}

// Generate food in a random position
function generateFood(gameState: GameState): Food {
  const occupiedPositions = new Set<string>();
  
  // Add all snake segments to occupied positions
  gameState.snakes.forEach(snake => {
    snake.segments.forEach(segment => {
      occupiedPositions.add(`${segment.position.x},${segment.position.y}`);
    });
  });
  
  // Find an unoccupied position
  let position: Position;
  do {
    position = {
      x: Math.floor(Math.random() * gameState.width),
      y: Math.floor(Math.random() * gameState.height)
    };
  } while (occupiedPositions.has(`${position.x},${position.y}`));
  
  return { position };
}

// Start the game
function startGame(room: Room) {
  room.isGameStarted = true;
  
  // Start game loop
  room.gameLoopInterval = setInterval(() => {
    gameLoop(room);
  }, GAME_TICK_RATE);
  
  console.log(`Game started in room ${room.id}`);
}

// End the game
function endGame(room: Room, winner: string | null) {
  // Stop game loop
  if (room.gameLoopInterval) {
    clearInterval(room.gameLoopInterval);
    room.gameLoopInterval = null;
  }
  
  room.isGameStarted = false;
  room.gameState.isGameOver = true;
  room.gameState.winner = winner;
  
  // Broadcast game over message
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      type: 'gameCommand',
      roomId: room.id,
      command: {
        type: 'gameOver',
        winner
      }
    }));
  }
  
  // Broadcast final game state
  broadcastGameState(room);
  
  console.log(`Game over in room ${room.id}, winner: ${winner || 'none'}`);
}

// Game loop
function gameLoop(room: Room) {
  // Skip if game is over
  if (room.gameState.isGameOver) return;
  
  const gameState = room.gameState;
  
  // Move snakes and check collisions
  for (const snake of gameState.snakes) {
    // Get current head position
    const head = snake.segments[0];
    
    // Calculate new head position
    const newHead = { 
      position: { 
        x: head.position.x, 
        y: head.position.y 
      } 
    };
    
    // Move head based on direction
    switch (snake.direction) {
      case 'up':
        newHead.position.y--;
        break;
      case 'down':
        newHead.position.y++;
        break;
      case 'left':
        newHead.position.x--;
        break;
      case 'right':
        newHead.position.x++;
        break;
    }
    
    // Check for wall collision
    if (
      newHead.position.x < 0 || 
      newHead.position.x >= gameState.width || 
      newHead.position.y < 0 || 
      newHead.position.y >= gameState.height
    ) {
      const opponent = gameState.snakes.find(s => s.id !== snake.id);
      endGame(room, opponent ? opponent.id : null);
      return;
    }
    
    // Check for collision with any snake
    let collision = false;
    for (const otherSnake of gameState.snakes) {
      for (const segment of otherSnake.segments) {
        if (segment.position.x === newHead.position.x && segment.position.y === newHead.position.y) {
          collision = true;
          break;
        }
      }
      if (collision) break;
    }
    
    if (collision) {
      const opponent = gameState.snakes.find(s => s.id !== snake.id);
      endGame(room, opponent ? opponent.id : null);
      return;
    }
    
    // Add new head
    snake.segments.unshift(newHead);
    
    // Check if snake ate food
    if (
      gameState.food && 
      newHead.position.x === gameState.food.position.x && 
      newHead.position.y === gameState.food.position.y
    ) {
      // Generate new food
      gameState.food = generateFood(gameState);
    } else {
      // Remove tail if no food was eaten
      snake.segments.pop();
    }
  }
  
  // Broadcast updated game state
  broadcastGameState(room);
}

// Broadcast game state to all clients
function broadcastGameState(room: Room) {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      type: 'gameState',
      roomId: room.id,
      gameState: room.gameState
    }));
  }
}

// Get a color for a player based on index
function getPlayerColor(index: number): string {
  const colors = [
    '#3498db', // Blue
    '#2ecc71', // Green
    '#e74c3c', // Red
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Teal
    '#d35400', // Pumpkin
    '#2c3e50', // Dark Blue
  ];
  
  return colors[index % colors.length];
}

// Start the game service
function startGameService() {
  connectToWebSocketServer();
  console.log('Game service started');
}

// Start the service
startGameService();