<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import GameRoom from './components/GameRoom.vue';
import LobbyScreen from './components/LobbyScreen.vue';
import clearNetService from './services/ClearNetService';
import gameService from './services/GameService';

const nickname = ref('');
const roomId = ref('');
const currentScreen = ref('lobby'); // 'lobby' or 'game'
const errorMessage = ref('');
const channelData = ref(null);
const gameSessionId = ref('');
const isConnecting = ref(true);

// Create a new game room
const createRoom = () => {
  if (!nickname.value.trim()) {
    errorMessage.value = 'Please enter a nickname';
    return;
  }

  // Check if we have an active channel
  const activeChannel = clearNetService.getActiveChannel();
  if (!activeChannel) {
    errorMessage.value = 'Please create a channel first';
    return;
  }

  const walletAddress = clearNetService.client.walletClient.account.address;
  gameService.createRoom(
    nickname.value.trim(),
    activeChannel.channelId,
    walletAddress
  );
};

// Join an existing game room
const joinRoom = () => {
  if (!nickname.value.trim()) {
    errorMessage.value = 'Please enter a nickname';
    return;
  }

  if (!roomId.value.trim()) {
    errorMessage.value = 'Please enter a room ID';
    return;
  }

  // Check if we have an active channel
  const activeChannel = clearNetService.getActiveChannel();
  if (!activeChannel) {
    errorMessage.value = 'Please join a channel first';
    return;
  }

  const walletAddress = clearNetService.client.walletClient.account.address;
  gameService.joinRoom(
    roomId.value.trim(),
    nickname.value.trim(),
    activeChannel.channelId,
    walletAddress
  );
};

// Watch for game over
watch(() => currentScreen.value, (newScreen, oldScreen) => {
  if (oldScreen === 'game' && newScreen === 'lobby') {
    // Game ended, handle channel closing
    gameService.finalizeGame();
  }
});

// Watch for connection state changes
watch(gameService.getIsConnected(), (isConnected) => {
  isConnecting.value = false;
  if (!isConnected) {
    errorMessage.value = 'Lost connection to server. Please refresh the page.';
  }
});

onMounted(() => {
  // Initialize WebSocket connection
  gameService.connect();

  // Set a timeout to handle connection failure
  setTimeout(() => {
    if (!gameService.getIsConnected().value) {
      isConnecting.value = false;
      errorMessage.value = 'Failed to connect to server. Please refresh the page.';
    }
  }, 5000);
});

onUnmounted(() => {
  gameService.disconnect();
});
</script>

<template>
  <div class="container">
    <header>
      <h1>Nitro Snake</h1>
    </header>

    <main>
      <div v-if="isConnecting" class="connection-status">
        Connecting to server...
      </div>
      <div v-else-if="!gameService.getIsConnected().value" class="connection-error">
        {{ errorMessage || 'Connection lost. Please refresh the page.' }}
      </div>
      <div v-else>
        <LobbyScreen v-if="currentScreen === 'lobby'" v-model:nickname="nickname" v-model:roomId="roomId"
          :errorMessage="gameService.getErrorMessage().value" @create-room="createRoom" @join-room="joinRoom" />

        <GameRoom v-else-if="currentScreen === 'game'" :socket="gameService.getWebSocket()"
          :roomId="gameService.getRoomId().value" :playerId="gameService.getPlayerId().value" :nickname="nickname"
          @exit-game="currentScreen = 'lobby'" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}

header {
  text-align: center;
  margin-bottom: 30px;
}

h1 {
  color: #4CAF50;
  margin: 0;
  font-size: 2.5rem;
}

.connection-status,
.connection-error {
  text-align: center;
  padding: 20px;
  background-color: #f8f8f8;
  border-radius: 8px;
  color: #666;
}
.connection-error {
  color: #f44336;
}
</style>
