<script setup lang="ts">
import SnakeGame from './components/SnakeGame.vue'
</script>

<template>
  <div class="app-container">
    <h1>Nitro Snake</h1>
    <SnakeGame />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-height: 100vh;
  padding-top: 20px;
}

h1 {
  margin-bottom: 1rem;
  color: white;
}
</style>
