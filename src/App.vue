<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import GameRoom from './components/GameRoom.vue';
import LobbyScreen from './components/LobbyScreen.vue';

const nickname = ref('');
const roomId = ref('');
const socket = ref<WebSocket | null>(null);
const isConnected = ref(false);
const currentScreen = ref('lobby'); // 'lobby' or 'game'
const playerId = ref('');
const errorMessage = ref('');

const connectWebSocket = () => {
  // Use localhost for development, would need proper deployment URL for production
  const wsUrl = `ws://${window.location.hostname}:3001`;
  socket.value = new WebSocket(wsUrl);
  
  socket.value.onopen = () => {
    isConnected.value = true;
    console.log('WebSocket connected');
  };
  
  socket.value.onclose = () => {
    isConnected.value = false;
    console.log('WebSocket disconnected');
  };
  
  socket.value.onerror = (error) => {
    console.error('WebSocket error:', error);
    errorMessage.value = 'Connection error. Please try again.';
  };
  
  socket.value.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'roomCreated' || data.type === 'roomJoined') {
        roomId.value = data.roomId;
        playerId.value = data.playerId;
        currentScreen.value = 'game';
        errorMessage.value = '';
      } else if (data.type === 'error') {
        errorMessage.value = data.message;
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  };
};

const createRoom = () => {
  if (!socket.value || socket.value.readyState !== WebSocket.OPEN) {
    errorMessage.value = 'Not connected to server';
    return;
  }
  
  if (!nickname.value.trim()) {
    errorMessage.value = 'Please enter a nickname';
    return;
  }
  
  socket.value.send(JSON.stringify({
    type: 'createRoom',
    nickname: nickname.value.trim()
  }));
};

const joinRoom = () => {
  if (!socket.value || socket.value.readyState !== WebSocket.OPEN) {
    errorMessage.value = 'Not connected to server';
    return;
  }
  
  if (!nickname.value.trim()) {
    errorMessage.value = 'Please enter a nickname';
    return;
  }
  
  if (!roomId.value.trim()) {
    errorMessage.value = 'Please enter a room ID';
    return;
  }
  
  socket.value.send(JSON.stringify({
    type: 'joinRoom',
    roomId: roomId.value.trim(),
    nickname: nickname.value.trim()
  }));
};

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  if (socket.value) {
    socket.value.close();
  }
});
</script>

<template>
  <div class="container">
    <header>
      <h1>Nitro Snake</h1>
    </header>
    
    <main>
      <div v-if="!isConnected" class="connection-error">
        Connecting to server...
      </div>
      
      <div v-else>
        <LobbyScreen 
          v-if="currentScreen === 'lobby'"
          v-model:nickname="nickname"
          v-model:roomId="roomId"
          :errorMessage="errorMessage"
          @create-room="createRoom"
          @join-room="joinRoom"
        />
        
        <GameRoom 
          v-else-if="currentScreen === 'game'"
          :socket="socket"
          :roomId="roomId"
          :playerId="playerId"
          :nickname="nickname"
        />
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

.connection-error {
  text-align: center;
  padding: 20px;
  background-color: #f8f8f8;
  border-radius: 8px;
  color: #666;
}
</style>