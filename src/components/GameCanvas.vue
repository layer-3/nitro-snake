<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

const props = defineProps<{
  width: number;
  height: number;
  gridSize: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const canvasWidth = computed(() => props.width * props.gridSize);
const canvasHeight = computed(() => props.height * props.gridSize);

function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.5;
  
  // Draw vertical lines
  for (let i = 0; i <= props.width; i++) {
    ctx.beginPath();
    ctx.moveTo(i * props.gridSize, 0);
    ctx.lineTo(i * props.gridSize, canvasHeight.value);
    ctx.stroke();
  }
  
  // Draw horizontal lines
  for (let i = 0; i <= props.height; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * props.gridSize);
    ctx.lineTo(canvasWidth.value, i * props.gridSize);
    ctx.stroke();
  }
}

function clearCanvas(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value);
}

onMounted(() => {
  if (canvas.value) {
    const ctx = canvas.value.getContext('2d');
    if (ctx) {
      clearCanvas(ctx);
      drawGrid(ctx);
    }
  }
});
</script>

<template>
  <div class="game-canvas-container">
    <canvas 
      ref="canvas" 
      :width="canvasWidth" 
      :height="canvasHeight" 
      class="game-canvas"
    ></canvas>
  </div>
</template>

<style scoped>
.game-canvas-container {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 20px 0;
}

.game-canvas {
  border: 2px solid #333;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
</style>