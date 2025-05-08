import { ref, reactive } from 'vue';
import type { GameCommand, GameState, Direction } from '../models/game';

// WebSocket connection states
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

// Default WebSocket server URL
const DEFAULT_WS_URL = 'ws://localhost:3000';

// Connection settings
let wsUrl = DEFAULT_WS_URL;
let socket: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000; // 2 seconds

// Reactive state
export const connectionState = ref<ConnectionState>(ConnectionState.DISCONNECTED);
export const connectedPlayers = ref<string[]>([]);
export const lastError = ref<string | null>(null);
export const roomId = ref<string | null>(null);
export const playerId = ref<string | null>(null);
export const gameState = reactive<GameState>({
  snakes: [],
  food: null,
  isGameOver: false,
  winner: null,
  width: 30,
  height: 20,
  gridSize: 20
});

// Event callbacks
const eventListeners = {
  onConnect: [] as Array<() => void>,
  onDisconnect: [] as Array<() => void>,
  onMessage: [] as Array<(data: any) => void>,
  onError: [] as Array<(error: any) => void>,
  onGameStateUpdate: [] as Array<(state: GameState) => void>,
  onPlayerJoin: [] as Array<(playerId: string) => void>,
  onPlayerLeave: [] as Array<(playerId: string) => void>,
  onGameStart: [] as Array<(timestamp: number) => void>,
  onGameOver: [] as Array<(winner: string | null) => void>
};

/**
 * Initialize the WebSocket connection
 */
export function initWebSocket(serverUrl: string = DEFAULT_WS_URL) {
  wsUrl = serverUrl;
  connectionState.value = ConnectionState.CONNECTING;
  lastError.value = null;
  
  try {
    socket = new WebSocket(wsUrl);
    
    socket.onopen = handleSocketOpen;
    socket.onmessage = handleSocketMessage;
    socket.onclose = handleSocketClose;
    socket.onerror = handleSocketError;
  } catch (error) {
    handleConnectionError(error);
  }
}

/**
 * Close the WebSocket connection
 */
export function closeWebSocket() {
  if (socket) {
    // Remove all event listeners
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    
    // Close the connection
    socket.close();
    socket = null;
  }
  
  connectionState.value = ConnectionState.DISCONNECTED;
  roomId.value = null;
  playerId.value = null;
  reconnectAttempts = 0;
  
  // Trigger disconnect callbacks
  eventListeners.onDisconnect.forEach(callback => callback());
}

/**
 * Create a new game room
 */
export function createRoom(newRoomId: string, playerName: string) {
  if (!socket || connectionState.value !== ConnectionState.CONNECTED) {
    initWebSocket();
  }
  
  roomId.value = newRoomId;
  playerId.value = playerName;
  
  sendMessage({
    type: 'createRoom',
    roomId: newRoomId,
    playerName
  });
}

/**
 * Join an existing game room
 */
export function joinRoom(existingRoomId: string, playerName: string) {
  if (!socket || connectionState.value !== ConnectionState.CONNECTED) {
    initWebSocket();
  }
  
  roomId.value = existingRoomId;
  playerId.value = playerName;
  
  sendMessage({
    type: 'joinRoom',
    roomId: existingRoomId,
    playerName
  });
}

/**
 * Leave the current room
 */
export function leaveRoom() {
  if (roomId.value && socket && connectionState.value === ConnectionState.CONNECTED) {
    sendMessage({
      type: 'leaveRoom',
      roomId: roomId.value,
      playerName: playerId.value
    });
  }
  
  roomId.value = null;
  playerId.value = null;
}

/**
 * Send a direction change command
 */
export function sendDirectionChange(direction: Direction) {
  if (!roomId.value || !playerId.value) return;
  
  const command: GameCommand = {
    type: 'changeDirection',
    playerId: playerId.value,
    direction
  };
  
  sendMessage({
    type: 'gameCommand',
    roomId: roomId.value,
    command
  });
}

/**
 * Send a message through the WebSocket
 */
export function sendMessage(data: any) {
  if (socket && connectionState.value === ConnectionState.CONNECTED) {
    socket.send(JSON.stringify(data));
  } else {
    console.error('Cannot send message: WebSocket is not connected');
    lastError.value = 'Cannot send message: WebSocket is not connected';
  }
}

/**
 * Add event listeners
 */
export function addListener<T extends keyof typeof eventListeners>(
  event: T,
  callback: typeof eventListeners[T][number]
) {
  eventListeners[event].push(callback as any);
}

/**
 * Remove event listeners
 */
export function removeListener<T extends keyof typeof eventListeners>(
  event: T,
  callback: typeof eventListeners[T][number]
) {
  eventListeners[event] = eventListeners[event].filter(cb => cb !== callback) as any;
}

/**
 * Handle WebSocket open event
 */
function handleSocketOpen() {
  connectionState.value = ConnectionState.CONNECTED;
  reconnectAttempts = 0;
  
  // If we have room info, join the room immediately
  if (roomId.value && playerId.value) {
    joinRoom(roomId.value, playerId.value);
  }
  
  // Trigger connect callbacks
  eventListeners.onConnect.forEach(callback => callback());
}

/**
 * Handle WebSocket message event
 */
function handleSocketMessage(event: MessageEvent) {
  try {
    const data = JSON.parse(event.data);
    
    // Trigger message callbacks
    eventListeners.onMessage.forEach(callback => callback(data));
    
    // Handle different message types
    switch (data.type) {
      case 'gameState':
        updateGameState(data.gameState);
        break;
      
      case 'playerJoin':
        handlePlayerJoin(data.playerId);
        break;
      
      case 'playerLeave':
        handlePlayerLeave(data.playerId);
        break;
      
      case 'gameStart':
        handleGameStart(data.startTimestamp);
        break;
      
      case 'gameOver':
        handleGameOver(data.winner);
        break;
    }
  } catch (error) {
    console.error('Error parsing WebSocket message:', error);
  }
}

/**
 * Handle WebSocket close event
 */
function handleSocketClose(event: CloseEvent) {
  console.log('WebSocket connection closed:', event.code, event.reason);
  
  // If the connection was established and then closed, attempt to reconnect
  if (connectionState.value === ConnectionState.CONNECTED) {
    attemptReconnect();
  } else {
    connectionState.value = ConnectionState.DISCONNECTED;
  }
  
  // Trigger disconnect callbacks
  eventListeners.onDisconnect.forEach(callback => callback());
}

/**
 * Handle WebSocket error event
 */
function handleSocketError(event: Event) {
  console.error('WebSocket error:', event);
  lastError.value = 'WebSocket connection error';
  connectionState.value = ConnectionState.ERROR;
  
  // Trigger error callbacks
  eventListeners.onError.forEach(callback => callback(event));
}

/**
 * Handle connection error
 */
function handleConnectionError(error: any) {
  console.error('WebSocket connection error:', error);
  lastError.value = 'Could not establish WebSocket connection';
  connectionState.value = ConnectionState.ERROR;
  socket = null;
  
  // Trigger error callbacks
  eventListeners.onError.forEach(callback => callback(error));
}

/**
 * Attempt to reconnect to the WebSocket server
 */
function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('Maximum reconnection attempts reached');
    lastError.value = 'Maximum reconnection attempts reached';
    connectionState.value = ConnectionState.ERROR;
    return;
  }
  
  reconnectAttempts++;
  connectionState.value = ConnectionState.CONNECTING;
  
  console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  
  // Wait before attempting to reconnect
  setTimeout(() => {
    initWebSocket(wsUrl);
  }, RECONNECT_DELAY);
}

/**
 * Update the game state
 */
function updateGameState(newState: GameState) {
  Object.assign(gameState, newState);
  
  // Trigger game state update callbacks
  eventListeners.onGameStateUpdate.forEach(callback => callback(gameState));
}

/**
 * Handle player join
 */
function handlePlayerJoin(newPlayerId: string) {
  if (!connectedPlayers.value.includes(newPlayerId)) {
    connectedPlayers.value.push(newPlayerId);
  }
  
  // Trigger player join callbacks
  eventListeners.onPlayerJoin.forEach(callback => callback(newPlayerId));
}

/**
 * Handle player leave
 */
function handlePlayerLeave(leftPlayerId: string) {
  connectedPlayers.value = connectedPlayers.value.filter(id => id !== leftPlayerId);
  
  // Trigger player leave callbacks
  eventListeners.onPlayerLeave.forEach(callback => callback(leftPlayerId));
}

/**
 * Handle game start
 */
function handleGameStart(startTimestamp: number) {
  // Trigger game start callbacks
  eventListeners.onGameStart.forEach(callback => callback(startTimestamp));
}

/**
 * Handle game over
 */
function handleGameOver(winner: string | null) {
  gameState.isGameOver = true;
  gameState.winner = winner;
  
  // Trigger game over callbacks
  eventListeners.onGameOver.forEach(callback => callback(winner));
}