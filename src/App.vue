<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import GameRoom from './components/GameRoom.vue';
import LobbyScreen from './components/LobbyScreen.vue';
import clearNetService from './services/ClearNetService';

const nickname = ref('');
const roomId = ref('');
const socket = ref<WebSocket | null>(null);
const isConnected = ref(false);
const currentScreen = ref('lobby'); // 'lobby' or 'game'
const playerId = ref('');
const errorMessage = ref('');
const channelData = ref(null);
const gameSessionId = ref('');

const connectWebSocket = () => {
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
        
        // Start vApp session with ClearNet
        startGameSession(data.roomId, data.playerId);
      } else if (data.type === 'error') {
        errorMessage.value = data.message;
      } else if (data.type === 'gameState') {
        // Update state in ClearNet channel on game state changes
        if (gameSessionId.value) {
          updateGameState(JSON.stringify(data));
        }
      } else if (data.type === 'signState') {
        // Sign state update for the channel
        const { channelId, state, stateId } = data;
        handleStateSignRequest(channelId, state, stateId);
      } else if (data.type === 'channelFinalized') {
        console.log(`Channel ${data.channelId} has been finalized`);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  };
};

// Start a ClearNet game session
const startGameSession = async (gameRoomId: string, gamePlayerId: string) => {
  // Initialize the game state for the channel
  const initialState = {
    roomId: gameRoomId,
    playerId: gamePlayerId,
    nickname: nickname.value,
    timestamp: Date.now()
  };
  
  try {
    // Get active channel from ClearNet service
    const activeChannel = clearNetService.getActiveChannel();
    if (!activeChannel) {
      console.error('No active channel available');
      errorMessage.value = 'No active channel found. Please create or join a channel first.';
      return;
    }
    
    // Start the game session
    const session = await clearNetService.openGameSession(JSON.stringify(initialState));
    if (session) {
      gameSessionId.value = session.sessionId;
      // Move to game screen now that we have both a game room and channel session
      currentScreen.value = 'game';
      errorMessage.value = '';
    } else {
      errorMessage.value = 'Failed to start game session';
    }
  } catch (error) {
    console.error('Error starting game session:', error);
    errorMessage.value = 'Error starting game session';
  }
};

const updateGameState = async (stateData: string) => {
  try {
    const version = BigInt(Math.floor(Date.now() / 1000));
    await clearNetService.updateGameState(stateData, version);
  } catch (error) {
    console.error('Error updating game state:', error);
  }
};

const handleStateSignRequest = async (channelId: string, state: any, stateId: string) => {
  try {
    const signatureData = await clearNetService.signState(state, stateId, channelId);
    
    if (signatureData && socket.value && socket.value.readyState === WebSocket.OPEN) {
      socket.value.send(JSON.stringify({
        type: 'stateSignature',
        channelId: signatureData.channelId,
        stateId: signatureData.stateId,
        signature: signatureData.signature,
        playerId: signatureData.playerId
      }));
    }
  } catch (error) {
    console.error('Error signing state:', error);
  }
};

// Handle game over and channel closing
const handleGameOver = async () => {
  try {
    const activeChannel = clearNetService.getActiveChannel();
    if (activeChannel && gameSessionId.value) {
      // Add final game state with game over flag
      const finalState = {
        ...activeChannel.state,
        gameOver: true,
        endTimestamp: Date.now()
      };
      
      // Close the game session and finalize the channel
      await clearNetService.closeGameSession(finalState);
      gameSessionId.value = '';
    }
  } catch (error) {
    console.error('Error handling game over:', error);
  }
};

// Create a new game room
const createRoom = () => {
  if (!socket.value || socket.value.readyState !== WebSocket.OPEN) {
    errorMessage.value = 'Not connected to server';
    return;
  }
  
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
  
  // Include channel ID in room creation request
  socket.value.send(JSON.stringify({
    type: 'createRoom',
    nickname: nickname.value.trim(),
    channelId: activeChannel.channelId // Send channel ID to server
  }));
};

// Join an existing game room
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
  
  // Check if we have an active channel
  const activeChannel = clearNetService.getActiveChannel();
  if (!activeChannel) {
    errorMessage.value = 'Please join a channel first';
    return;
  }
  
  // Include channel ID in join request
  socket.value.send(JSON.stringify({
    type: 'joinRoom',
    roomId: roomId.value.trim(),
    nickname: nickname.value.trim(),
    channelId: activeChannel.channelId // Send channel ID to server
  }));
};

// Watch for game over
watch(() => currentScreen.value, (newScreen, oldScreen) => {
  if (oldScreen === 'game' && newScreen === 'lobby') {
    // Game ended, handle channel closing
    handleGameOver();
  }
});

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  if (socket.value) {
    socket.value.close();
  }
  
  // Clean up game session if needed
  if (gameSessionId.value) {
    handleGameOver();
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
          @exit-game="currentScreen = 'lobby'"
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