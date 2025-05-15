export interface Room {
  id: string;
  players: Map<string, Player>;
  food: Food;
  gameInterval: NodeJS.Timeout | null;
  gridSize: { width: number; height: number };
  channelIds: Set<string>;
  playerAddresses: Map<string, string>;
  playerAllocations: Map<string, number>;
  currentState: any;
  stateVersion: number;
  createdAt: number;
  isGameOver?: boolean;
  appId?: string;
}
