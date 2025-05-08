<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import Game from './components/Game.vue';
import RoomManager from './components/RoomManager.vue';
import { 
  initWebSocket, 
  createRoom as wsCreateRoom, 
  joinRoom as wsJoinRoom,
  leaveRoom as wsLeaveRoom,
  closeWebSocket,
  connectionState,
  roomId,
  playerId,
  ConnectionState
} from './services/websocket';

const isInRoom = ref(false);

// Handle room creation
function handleCreateRoom(data: { roomId: string, playerName: string }) {
  wsCreateRoom(data.roomId, data.playerName);
  isInRoom.value = true;
}

// Handle room joining
function handleJoinRoom(data: { roomId: string, playerName: string }) {
  wsJoinRoom(data.roomId, data.playerName);
  isInRoom.value = true;
}

// Handle leaving the game
function handleLeaveGame() {
  wsLeaveRoom();
  isInRoom.value = false;
}

onMounted(() => {
  // Initialize WebSocket connection
  initWebSocket();
});

onUnmounted(() => {
  // Clean up WebSocket connection
  closeWebSocket();
});
</script>

<template>
  <div class="app-container">
    <div v-if="!isInRoom">
      <RoomManager 
        @createRoom="handleCreateRoom"
        @joinRoom="handleJoinRoom"
      />
    </div>
    
    <div v-else>
      <div class="game-header">
        <h1>Nitro Snake</h1>
        <div class="game-info">
          <p v-if="roomId">Room: <span class="highlight">{{ roomId }}</span></p>
          <p v-if="playerId">Player: <span class="highlight">{{ playerId }}</span></p>
          <p>Status: 
            <span :class="['connection-status', connectionState]">
              {{ connectionState }}
            </span>
          </p>
        </div>
        <button @click="handleLeaveGame" class="leave-btn">Leave Game</button>
      </div>
      
      <Game />
    </div>
  </div>
</template>

<style>
body {
  margin: 0;
  font-family: 'Arial', sans-serif;
  background-color: #f9f9f9;
}

.app-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 20px;
}

.game-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 20px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.game-header h1 {
  margin: 0 0 15px 0;
  color: #333;
}

.game-info {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 15px;
}

.game-info p {
  margin: 0;
  color: #555;
}

.highlight {
  font-weight: bold;
  color: #333;
}

.connection-status {
  font-weight: bold;
}

.connection-status.connected {
  color: #2ecc71;
}

.connection-status.connecting {
  color: #f39c12;
}

.connection-status.disconnected, .connection-status.error {
  color: #e74c3c;
}

.leave-btn {
  background-color: #e74c3c;
  color: white;
  border: none;
  padding: 10px 15px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.leave-btn:hover {
  background-color: #c0392b;
}
</style>