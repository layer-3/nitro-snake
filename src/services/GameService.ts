import { ref } from 'vue';
import type { Ref } from 'vue';
import clearNetService from './ClearNetService';
import { GAMESERVER_WS_URL } from '../config';

export interface GameState {
  type: string;
  players: Array<{
    id: string;
    nickname: string;
    segments: Array<{ x: number; y: number }>;
    score: number;
    isDead: boolean;
  }>;
  food: { x: number; y: number };
  gridSize: { width: number; height: number };
  isGameOver: boolean;
  stateVersion: number;
  timestamp: number;
}

class GameService {
  private ws: WebSocket | null = null;
  private isConnected: Ref<boolean> = ref(false);
  private playerId: Ref<string> = ref('');
  private roomId: Ref<string> = ref('');
  private errorMessage: Ref<string> = ref('');
  private gameState: Ref<GameState | null> = ref(null);
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor() {
    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    this.messageHandlers.set('roomCreated', (data) => {
      this.roomId.value = data.roomId;
      this.playerId.value = data.playerId;
    });

    this.messageHandlers.set('roomJoined', (data) => {
      this.roomId.value = data.roomId;
      this.playerId.value = data.playerId;
    });

    this.messageHandlers.set('error', (data) => {
      this.errorMessage.value = data.message;
    });

    this.messageHandlers.set('gameState', (data) => {
      this.gameState.value = data;
    });

    this.messageHandlers.set('signState', (data) => {
      this.handleStateSignRequest(data.channelId, data.state, data.stateId);
    });

    this.messageHandlers.set('channelFinalized', (data) => {
      console.log(`Channel ${data.channelId} has been finalized`);
    });
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(GAMESERVER_WS_URL);

    this.ws.onopen = () => {
      this.isConnected.value = true;
      console.log('WebSocket connected');
    };

    this.ws.onclose = () => {
      this.isConnected.value = false;
      console.log('WebSocket disconnected');
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.errorMessage.value = 'Connection error. Please try again.';
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const handler = this.messageHandlers.get(data.type);
        if (handler) {
          handler(data);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  createRoom(nickname: string, channelId: string, walletAddress: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.errorMessage.value = 'Not connected to server';
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'createRoom',
      nickname,
      channelId,
      walletAddress
    }));
  }

  joinRoom(roomId: string, nickname: string, channelId: string, walletAddress: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.errorMessage.value = 'Not connected to server';
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'joinRoom',
      roomId,
      nickname,
      channelId,
      walletAddress
    }));
  }

  changeDirection(direction: 'up' | 'down' | 'left' | 'right') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'changeDirection',
      direction
    }));
  }

  playAgain() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'playAgain',
      roomId: this.roomId.value
    }));
  }

  finalizeGame() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'finalizeGame',
      roomId: this.roomId.value
    }));
  }

  private async handleStateSignRequest(channelId: string, state: any, stateId: string) {
    try {
      const signatureData = await clearNetService.signState(state, stateId, channelId);

      if (signatureData && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'stateSignature',
          channelId: signatureData.channelId,
          stateId: signatureData.stateId,
          signature: signatureData.signature,
          playerId: signatureData.playerId
        }));
      }
    } catch (error) {
      console.error('Error signing state:', error);
    }
  }

  // Getters for reactive state
  getIsConnected(): Ref<boolean> {
    return this.isConnected;
  }

  getPlayerId(): Ref<string> {
    return this.playerId;
  }

  getRoomId(): Ref<string> {
    return this.roomId;
  }

  getErrorMessage(): Ref<string> {
    return this.errorMessage;
  }

  getGameState(): Ref<GameState | null> {
    return this.gameState;
  }

  // Get the WebSocket instance
  getWebSocket(): WebSocket | null {
    return this.ws;
  }
}

// Create a singleton instance
const gameService = new GameService();
export default gameService;
