export type Position = {
  x: number;
  y: number;
};

export type Direction = 'up' | 'down' | 'left' | 'right';

export type SnakeSegment = {
  position: Position;
};

export type Snake = {
  id: string;
  segments: SnakeSegment[];
  direction: Direction;
  color: string;
};

export type Food = {
  position: Position;
};

export type GameState = {
  snakes: Snake[];
  food: Food | null;
  isGameOver: boolean;
  winner: string | null;
  width: number;
  height: number;
  gridSize: number;
};

export type Room = {
  id: string;
  players: string[];
  gameState: GameState | null;
};

export type GameCommand = {
  type: 'changeDirection';
  playerId: string;
  direction: Direction;
} | {
  type: 'startGame';
  startTimestamp: number;
} | {
  type: 'gameOver';
  winner: string | null;
};