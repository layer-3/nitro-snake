import { Hex } from 'viem';

export interface Player {
  id: string;
  nickname: string;
  position: { x: number; y: number };
  direction: 'up' | 'down' | 'left' | 'right';
  segments: { x: number; y: number }[];
  score: number;
  isDead?: boolean;
}

export interface Room {
  id: string;
  players: Map<string, Player>;
  food: { x: number; y: number };
  gameInterval: NodeJS.Timeout | null;
  gridSize: { width: number; height: number };
  channelIds: Set<string>;
  playerAddresses: Map<string, string>;
  currentState: any;
  stateVersion: number;
  createdAt: number;
  appId?: Hex;
  isGameOver?: boolean;
  isClosingAppSession?: boolean;
}

export interface SnakeWebSocket extends WebSocket {
  playerId: string;
  roomId?: string;
  channelId?: string;
}
