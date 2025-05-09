<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps<{
  socket: WebSocket | null;
  roomId: string;
  playerId: string;
  nickname: string;
}>();

interface Player {
  id: string;
  nickname: string;
  segments: Array<{ x: number; y: number }>;
  score: number;
}

interface GameState {
  players: Player[];
  food: { x: number; y: number };
  gridSize: { width: number; height: number };
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
const ctx = ref<CanvasRenderingContext2D | null>(null);
const gameState = ref<GameState | null>(null);
const cellSize = ref(15); // Size of each cell in pixels
const isGameStarted = ref(false);
const waitingForPlayer = ref(false);

// Handle incoming WebSocket messages
const handleMessage = (event: MessageEvent) => {
  try {
    const data = JSON.parse(event.data);
    
    if (data.type === 'gameState') {
      gameState.value = data;
      isGameStarted.value = true;
      waitingForPlayer.value = false;
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
};

// Handle keyboard input
const handleKeyDown = (event: KeyboardEvent) => {
  if (!props.socket || !isGameStarted.value) return;

  let direction: string | null = null;
  
  switch (event.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      direction = 'up';
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      direction = 'down';
      break;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      direction = 'left';
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      direction = 'right';
      break;
  }
  
  if (direction) {
    props.socket.send(JSON.stringify({
      type: 'changeDirection',
      direction
    }));
  }
};

// Draw game on canvas
const drawGame = () => {
  if (!ctx.value || !gameState.value || !canvasRef.value) return;
  
  const { width, height } = gameState.value.gridSize;
  const canvas = canvasRef.value;
  
  // Set canvas size
  canvas.width = width * cellSize.value;
  canvas.height = height * cellSize.value;
  
  // Clear canvas
  ctx.value.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw grid (optional)
  ctx.value.strokeStyle = '#eee';
  ctx.value.lineWidth = 0.5;
  
  for (let x = 0; x <= width; x++) {
    ctx.value.beginPath();
    ctx.value.moveTo(x * cellSize.value, 0);
    ctx.value.lineTo(x * cellSize.value, height * cellSize.value);
    ctx.value.stroke();
  }
  
  for (let y = 0; y <= height; y++) {
    ctx.value.beginPath();
    ctx.value.moveTo(0, y * cellSize.value);
    ctx.value.lineTo(width * cellSize.value, y * cellSize.value);
    ctx.value.stroke();
  }
  
  // Draw food
  const { food } = gameState.value;
  ctx.value.fillStyle = '#e91e63';
  ctx.value.beginPath();
  ctx.value.arc(
    (food.x + 0.5) * cellSize.value,
    (food.y + 0.5) * cellSize.value,
    cellSize.value / 2,
    0,
    Math.PI * 2
  );
  ctx.value.fill();
  
  // Draw players
  const colors = ['#4CAF50', '#2196F3']; // Green for player 1, blue for player 2
  
  gameState.value.players.forEach((player, index) => {
    const color = colors[index % colors.length];
    const isCurrentPlayer = player.id === props.playerId;
    
    // Draw snake segments
    player.segments.forEach((segment, segIndex) => {
      ctx.value!.fillStyle = color;
      
      // Draw head slightly larger and with a border if it's the current player
      if (segIndex === 0) {
        if (isCurrentPlayer) {
          // Draw border for head of current player
          ctx.value!.fillRect(
            segment.x * cellSize.value,
            segment.y * cellSize.value,
            cellSize.value,
            cellSize.value
          );
          
          // Draw white eyes
          ctx.value!.fillStyle = 'white';
          ctx.value!.beginPath();
          ctx.value!.arc(
            (segment.x + 0.3) * cellSize.value,
            (segment.y + 0.3) * cellSize.value,
            cellSize.value / 8,
            0,
            Math.PI * 2
          );
          ctx.value!.arc(
            (segment.x + 0.7) * cellSize.value,
            (segment.y + 0.3) * cellSize.value,
            cellSize.value / 8,
            0,
            Math.PI * 2
          );
          ctx.value!.fill();
        } else {
          // Regular head for other player
          ctx.value!.fillRect(
            segment.x * cellSize.value,
            segment.y * cellSize.value,
            cellSize.value,
            cellSize.value
          );
        }
      } else {
        // Regular body segment
        ctx.value!.fillRect(
          segment.x * cellSize.value + 1,
          segment.y * cellSize.value + 1,
          cellSize.value - 2,
          cellSize.value - 2
        );
      }
    });
    
    // Draw player nickname and score
    ctx.value!.fillStyle = color;
    ctx.value!.font = '14px Arial';
    ctx.value!.textAlign = 'left';
    const scoreY = index === 0 ? 20 : 40;
    ctx.value!.fillText(`${player.nickname}: ${player.score}`, 10, scoreY);
  });
};

// Animation loop
const animationFrame = ref<number>(0);
const animate = () => {
  drawGame();
  animationFrame.value = requestAnimationFrame(animate);
};

// Set up game when component is mounted
onMounted(() => {
  if (props.socket) {
    props.socket.addEventListener('message', handleMessage);
  }
  
  window.addEventListener('keydown', handleKeyDown);
  
  if (canvasRef.value) {
    ctx.value = canvasRef.value.getContext('2d');
    
    // Start animation loop
    animationFrame.value = requestAnimationFrame(animate);
  }
  
  // If we don't receive a game state soon, show waiting message
  setTimeout(() => {
    if (!isGameStarted.value) {
      waitingForPlayer.value = true;
    }
  }, 1000);
});

// Clean up when component is unmounted
onUnmounted(() => {
  if (props.socket) {
    props.socket.removeEventListener('message', handleMessage);
  }
  
  window.removeEventListener('keydown', handleKeyDown);
  
  if (animationFrame.value) {
    cancelAnimationFrame(animationFrame.value);
  }
});

// Watch for changes to socket and re-attach event listener
watch(() => props.socket, (newSocket) => {
  if (newSocket) {
    newSocket.addEventListener('message', handleMessage);
  }
});
</script>

<template>
  <div class="game-container">
    <div class="room-info">
      <h2>Room: {{ roomId }}</h2>
      <p>Share this room ID with your friend to play together!</p>
    </div>
    
    <div v-if="waitingForPlayer" class="waiting-message">
      Waiting for another player to join...
    </div>
    
    <div class="game-board" :class="{ 'game-started': isGameStarted }">
      <canvas ref="canvasRef"></canvas>
    </div>
    
    <div class="controls-info">
      <h3>Controls</h3>
      <p>Use arrow keys or WASD to control your snake.</p>
    </div>
  </div>
</template>

<style scoped>
.game-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.room-info {
  margin-bottom: 20px;
  text-align: center;
}

.room-info h2 {
  color: #333;
  margin-bottom: 5px;
}

.room-info p {
  color: #666;
  margin: 0;
}

.waiting-message {
  background-color: #fff8e1;
  color: #ff8f00;
  padding: 15px;
  border-radius: 8px;
  margin: 20px 0;
  text-align: center;
  font-weight: 600;
}

.game-board {
  display: flex;
  justify-content: center;
  align-items: center;
  border: 2px solid #ddd;
  border-radius: 4px;
  margin: 20px 0;
  overflow: hidden;
}

.game-board.game-started {
  border-color: #4CAF50;
}

canvas {
  display: block;
}

.controls-info {
  background-color: #f5f5f5;
  padding: 15px;
  border-radius: 8px;
  margin-top: 20px;
  text-align: center;
  max-width: 400px;
}

.controls-info h3 {
  margin-top: 0;
  color: #333;
}

.controls-info p {
  margin-bottom: 0;
  color: #666;
}
</style>