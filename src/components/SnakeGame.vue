<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

// Game constants
const GRID_SIZE = 20; // Size of each grid cell in pixels
const GRID_WIDTH = 40; // Number of cells horizontally
const GRID_HEIGHT = 30; // Number of cells vertically
const GAME_SPEED = 150; // Initial game speed in ms

// Direction constants
type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

// Snake position type
interface SnakeSegment {
  x: number;
  y: number;
}

// Game state
const score = ref(0);
const gameOver = ref(false);
const gameRunning = ref(false); // Don't start automatically anymore

// Snake state
const snake = ref<SnakeSegment[]>([
  { x: 20, y: 15 }, // Head (center of grid)
  { x: 19, y: 15 },
  { x: 18, y: 15 },
  { x: 17, y: 15 },
  { x: 16, y: 15 },
]);
const direction = ref<Direction>('RIGHT');
const nextDirection = ref<Direction>('RIGHT');

// Food position
const food = ref<SnakeSegment>({ x: 0, y: 0 });

// Canvas refs
const gameCanvas = ref<HTMLCanvasElement | null>(null);
const ctx = ref<CanvasRenderingContext2D | null>(null);

// Game loop timer
let gameLoopInterval: number | null = null;

// Handle keyboard input
function handleKeyDown(event: KeyboardEvent) {
  // Prevent arrow keys from scrolling the page
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
    event.preventDefault();
  }
  
  // Handle game start with spacebar
  if (!gameRunning.value) {
    if (event.key === ' ') {
      gameRunning.value = true;
      return;
    } else {
      return; // Ignore other keys when game is not running
    }
  }
  
  // Handle game over state with spacebar
  if (gameOver.value) {
    if (event.key === ' ') {
      initGame();
      gameRunning.value = true;
    }
    return;
  }
  
  // Handle snake direction changes
  switch (event.key) {
    case 'ArrowUp':
      if (direction.value !== 'DOWN') {
        nextDirection.value = 'UP';
      }
      break;
    case 'ArrowDown':
      if (direction.value !== 'UP') {
        nextDirection.value = 'DOWN';
      }
      break;
    case 'ArrowLeft':
      if (direction.value !== 'RIGHT') {
        nextDirection.value = 'LEFT';
      }
      break;
    case 'ArrowRight':
      if (direction.value !== 'LEFT') {
        nextDirection.value = 'RIGHT';
      }
      break;
    case ' ': // Pause the game
      gameRunning.value = !gameRunning.value;
      break;
  }
}

// Initialize the game
onMounted(() => {
  if (gameCanvas.value) {
    ctx.value = gameCanvas.value.getContext('2d');
    initGame();
    
    // Draw the initial state
    draw();
    
    startGameLoop();
    
    // Add keyboard event listener
    window.addEventListener('keydown', handleKeyDown);
  }
});

// Clean up on component unmount
onUnmounted(() => {
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
    gameLoopInterval = null;
  }
  
  // Remove keyboard event listener
  window.removeEventListener('keydown', handleKeyDown);
});

// Initialize game state
function initGame() {
  // Reset snake position
  snake.value = [
    { x: 20, y: 15 }, // Head (center of grid)
    { x: 19, y: 15 },
    { x: 18, y: 15 },
    { x: 17, y: 15 },
    { x: 16, y: 15 },
  ];
  
  // Reset direction
  direction.value = 'RIGHT';
  nextDirection.value = 'RIGHT';
  
  // Reset score
  score.value = 0;
  
  // Reset game state
  gameOver.value = false;
  gameRunning.value = false; // Changed: Game needs to be started with spacebar
  
  // Place initial food
  placeFood();
}

// Start game loop
function startGameLoop() {
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
  }
  
  gameLoopInterval = setInterval(() => {
    // Only update the game state if the game is running and not over
    if (gameRunning.value && !gameOver.value) {
      update();
    }
    
    // Always draw the current state, even if game is not running or is over
    draw();
  }, GAME_SPEED);
}

// Update game state
function update() {
  if (gameOver.value || !gameRunning.value) return;
  
  // Update direction
  direction.value = nextDirection.value;
  
  // Calculate new head position
  const head = { ...snake.value[0] };
  
  // Update head position based on direction
  switch (direction.value) {
    case 'UP':
      head.y -= 1;
      break;
    case 'DOWN':
      head.y += 1;
      break;
    case 'LEFT':
      head.x -= 1;
      break;
    case 'RIGHT':
      head.x += 1;
      break;
  }
  
  // Check if snake hit the wall
  if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
    gameOver.value = true;
    return;
  }
  
  // Check if snake hit itself
  if (snake.value.some(segment => segment.x === head.x && segment.y === head.y)) {
    gameOver.value = true;
    return;
  }
  
  // Add new head to the beginning of snake array
  snake.value.unshift(head);
  
  // Check if snake ate food
  if (head.x === food.value.x && head.y === food.value.y) {
    // Increase score
    score.value += 1;
    
    // Generate new food
    placeFood();
  } else {
    // Remove tail if snake didn't eat food
    snake.value.pop();
  }
}

// Place food at random position
function placeFood() {
  let newFood: SnakeSegment;
  let foodOnSnake = true;
  
  // Keep generating positions until food is not on snake
  while (foodOnSnake) {
    newFood = {
      x: Math.floor(Math.random() * GRID_WIDTH),
      y: Math.floor(Math.random() * GRID_HEIGHT)
    };
    
    // Check if new food is on the snake
    foodOnSnake = snake.value.some(segment => 
      segment.x === newFood.x && segment.y === newFood.y
    );
  }
  
  food.value = newFood;
}

// Draw everything
function draw() {
  if (!ctx.value || !gameCanvas.value) return;
  
  const canvas = gameCanvas.value;
  const context = ctx.value;
  
  // Set canvas dimensions
  canvas.width = GRID_WIDTH * GRID_SIZE;
  canvas.height = GRID_HEIGHT * GRID_SIZE;
  
  // Clear the canvas
  context.fillStyle = '#8bac89'; // Base green color from screenshot
  context.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw grid lines
  context.strokeStyle = '#779977'; // Slightly darker green for grid lines
  context.lineWidth = 0.5;
  
  // Draw vertical grid lines
  for (let x = 0; x <= canvas.width; x += GRID_SIZE) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  
  // Draw horizontal grid lines
  for (let y = 0; y <= canvas.height; y += GRID_SIZE) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  
  // Draw food
  context.fillStyle = '#000000';
  const foodX = food.value.x * GRID_SIZE + GRID_SIZE / 2;
  const foodY = food.value.y * GRID_SIZE + GRID_SIZE / 2;
  
  context.beginPath();
  context.arc(foodX, foodY, GRID_SIZE / 4, 0, Math.PI * 2);
  context.fill();
  
  // Draw snake
  snake.value.forEach((segment) => {
    // Draw snake segment
    context.fillStyle = '#000000'; // Black snake as in screenshot
    context.fillRect(
      segment.x * GRID_SIZE + 1, 
      segment.y * GRID_SIZE + 1, 
      GRID_SIZE - 2, 
      GRID_SIZE - 2
    );
  });
  
  // Draw score
  context.fillStyle = '#000000';
  context.font = '16px monospace';
  context.fillText(`1P: ${score.value}`, 10, 20);
  
  // Draw game state messages
  context.font = '20px monospace';
  context.textAlign = 'center';
  
  if (gameOver.value) {
    // Game over message
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    
    context.fillStyle = 'white';
    context.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 10);
    context.fillText('Press SPACE to restart', canvas.width / 2, canvas.height / 2 + 20);
  } else if (!gameRunning.value) {
    // Start game message
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    
    context.fillStyle = 'white';
    context.fillText('NITRO SNAKE', canvas.width / 2, canvas.height / 2 - 10);
    context.fillText('Press SPACE to start', canvas.width / 2, canvas.height / 2 + 20);
  }
  
  // Reset text alignment for other text
  context.textAlign = 'left';
}
</script>

<template>
  <div class="game-container">
    <div class="game-board">
      <canvas ref="gameCanvas" class="game-canvas"></canvas>
    </div>
  </div>
</template>

<style scoped>
.game-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
}

.game-board {
  position: relative;
  border-top: 20px solid black;
  border-bottom: 20px solid black;
  width: 800px;
  height: 640px;
}

.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>