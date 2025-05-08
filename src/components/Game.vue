<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import GameCanvas from './GameCanvas.vue';
import { 
  gameState,
  connectionState,
  ConnectionState,
  sendDirectionChange,
  addListener,
  removeListener
} from '../services/websocket';

const canvas = ref<HTMLCanvasElement | null>(null);
const countdown = ref<number | null>(null);
const countdownInterval = ref<number | null>(null);

// Draw the game state on the canvas
function draw() {
  if (!canvas.value) return;
  
  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;
  
  // Clear canvas
  ctx.clearRect(0, 0, gameState.width * gameState.gridSize, gameState.height * gameState.gridSize);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, gameState.width * gameState.gridSize, gameState.height * gameState.gridSize);
  
  // Draw grid
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= gameState.width; i++) {
    ctx.beginPath();
    ctx.moveTo(i * gameState.gridSize, 0);
    ctx.lineTo(i * gameState.gridSize, gameState.height * gameState.gridSize);
    ctx.stroke();
  }
  for (let i = 0; i <= gameState.height; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * gameState.gridSize);
    ctx.lineTo(gameState.width * gameState.gridSize, i * gameState.gridSize);
    ctx.stroke();
  }
  
  // Draw snakes
  gameState.snakes.forEach(snake => {
    snake.segments.forEach((segment, index) => {
      ctx.fillStyle = snake.color;
      
      // Draw rounded rectangles for snake segments
      const x = segment.position.x * gameState.gridSize;
      const y = segment.position.y * gameState.gridSize;
      const size = gameState.gridSize - 2;
      const radius = index === 0 ? 8 : 4; // Head has larger radius
      
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + size, y, x + size, y + size, radius);
      ctx.arcTo(x + size, y + size, x, y + size, radius);
      ctx.arcTo(x, y + size, x, y, radius);
      ctx.arcTo(x, y, x + size, y, radius);
      ctx.closePath();
      ctx.fill();
      
      // Draw eyes for the head
      if (index === 0) {
        ctx.fillStyle = 'white';
        
        // Calculate eye positions based on direction
        let leftEyeX, leftEyeY, rightEyeX, rightEyeY;
        const eyeOffset = gameState.gridSize / 4;
        
        switch (snake.direction) {
          case 'right':
            leftEyeX = x + size - eyeOffset;
            leftEyeY = y + eyeOffset;
            rightEyeX = x + size - eyeOffset;
            rightEyeY = y + size - eyeOffset;
            break;
          case 'left':
            leftEyeX = x + eyeOffset;
            leftEyeY = y + eyeOffset;
            rightEyeX = x + eyeOffset;
            rightEyeY = y + size - eyeOffset;
            break;
          case 'up':
            leftEyeX = x + eyeOffset;
            leftEyeY = y + eyeOffset;
            rightEyeX = x + size - eyeOffset;
            rightEyeY = y + eyeOffset;
            break;
          case 'down':
            leftEyeX = x + eyeOffset;
            leftEyeY = y + size - eyeOffset;
            rightEyeX = x + size - eyeOffset;
            rightEyeY = y + size - eyeOffset;
            break;
          default:
            leftEyeX = x + size - eyeOffset;
            leftEyeY = y + eyeOffset;
            rightEyeX = x + size - eyeOffset;
            rightEyeY = y + size - eyeOffset;
        }
        
        const eyeRadius = gameState.gridSize / 8;
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Pupils
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeRadius / 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeRadius / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
  
  // Draw food
  if (gameState.food) {
    ctx.fillStyle = '#ff4757';
    const foodX = gameState.food.position.x * gameState.gridSize;
    const foodY = gameState.food.position.y * gameState.gridSize;
    const foodSize = gameState.gridSize - 4;
    
    ctx.beginPath();
    ctx.arc(foodX + gameState.gridSize / 2, foodY + gameState.gridSize / 2, foodSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw countdown
  if (countdown.value !== null && countdown.value > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, gameState.width * gameState.gridSize, gameState.height * gameState.gridSize);
    
    ctx.fillStyle = 'white';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.fillText(
      countdown.value.toString(), 
      (gameState.width * gameState.gridSize) / 2, 
      (gameState.height * gameState.gridSize) / 2
    );
  }
  
  // Draw game over message
  if (gameState.isGameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, gameState.width * gameState.gridSize, gameState.height * gameState.gridSize);
    
    ctx.fillStyle = 'white';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const message = gameState.winner 
      ? `Game Over! Player ${gameState.winner} wins!` 
      : 'Game Over!';
    
    ctx.fillText(
      message, 
      (gameState.width * gameState.gridSize) / 2, 
      (gameState.height * gameState.gridSize) / 2
    );
  }
}

// Handle keyboard input
function handleKeydown(event: KeyboardEvent) {
  if (gameState.isGameOver || countdown.value !== null) return;
  if (connectionState.value !== ConnectionState.CONNECTED) return;
  
  switch (event.key) {
    case 'ArrowUp':
      sendDirectionChange('up');
      break;
    case 'ArrowDown':
      sendDirectionChange('down');
      break;
    case 'ArrowLeft':
      sendDirectionChange('left');
      break;
    case 'ArrowRight':
      sendDirectionChange('right');
      break;
  }
}

// Handle game start event
function handleGameStart(startTimestamp: number) {
  const now = Date.now();
  const timeUntilStart = startTimestamp - now;
  
  // Calculate initial countdown value (in seconds)
  countdown.value = Math.ceil(timeUntilStart / 1000);
  
  // Clear previous interval if exists
  if (countdownInterval.value !== null) {
    clearInterval(countdownInterval.value);
  }
  
  // Update countdown every second
  countdownInterval.value = setInterval(() => {
    if (countdown.value !== null && countdown.value > 0) {
      countdown.value--;
      
      // When countdown reaches 0, clear interval
      if (countdown.value === 0) {
        if (countdownInterval.value !== null) {
          clearInterval(countdownInterval.value);
          countdownInterval.value = null;
        }
        
        // After a brief display of 0, remove the countdown
        setTimeout(() => {
          countdown.value = null;
        }, 1000);
      }
    }
    
    // Redraw
    draw();
  }, 1000) as unknown as number;
  
  // Initial draw
  draw();
}

// Register WebSocket event listeners
function registerEventListeners() {
  // Listen for game state updates
  addListener('onGameStateUpdate', () => {
    draw();
  });
  
  // Listen for game start
  addListener('onGameStart', handleGameStart);
}

// Clean up WebSocket event listeners
function cleanupEventListeners() {
  removeListener('onGameStateUpdate', () => {
    draw();
  });
  
  removeListener('onGameStart', handleGameStart);
  
  if (countdownInterval.value !== null) {
    clearInterval(countdownInterval.value);
    countdownInterval.value = null;
  }
}

// Watch for canvas changes
watch(() => canvas.value, (newCanvas) => {
  if (newCanvas) {
    draw();
  }
});

onMounted(() => {
  canvas.value = document.querySelector<HTMLCanvasElement>('.game-canvas');
  window.addEventListener('keydown', handleKeydown);
  registerEventListeners();
  draw();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  cleanupEventListeners();
});
</script>

<template>
  <div class="game-container">
    <GameCanvas 
      ref="gameCanvas"
      :width="gameState.width"
      :height="gameState.height"
      :gridSize="gameState.gridSize"
    />
    
    <div class="game-instructions">
      <h3>Instructions:</h3>
      <p>Use arrow keys to control your snake.</p>
      <p>Eat the red food to grow.</p>
      <p>Avoid hitting the walls or another snake.</p>
    </div>
  </div>
</template>

<style scoped>
.game-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.game-instructions {
  margin-top: 30px;
  padding: 15px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  text-align: left;
}

.game-instructions h3 {
  margin-top: 0;
  color: #333;
}

.game-instructions p {
  margin: 5px 0;
  color: #555;
}
</style>