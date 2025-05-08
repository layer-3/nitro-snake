<script setup lang="ts">
import { ref, computed } from 'vue';
import { generateRoomId } from '../services/utils';

const roomId = ref('');
const playerName = ref('');
const isCreatingRoom = ref(false);

const emit = defineEmits(['joinRoom', 'createRoom']);

// Computed property to check if form is valid
const isFormValid = computed(() => {
  if (isCreatingRoom.value) {
    return playerName.value.trim().length > 0;
  } else {
    return roomId.value.trim().length > 0 && playerName.value.trim().length > 0;
  }
});

// Toggle between create and join room forms
function toggleForm() {
  isCreatingRoom.value = !isCreatingRoom.value;
  if (isCreatingRoom.value) {
    roomId.value = generateRoomId();
  } else {
    roomId.value = '';
  }
}

// Handle form submission
function handleSubmit() {
  if (!isFormValid.value) return;

  if (isCreatingRoom.value) {
    emit('createRoom', {
      roomId: roomId.value,
      playerName: playerName.value
    });
  } else {
    emit('joinRoom', {
      roomId: roomId.value,
      playerName: playerName.value
    });
  }
}

// Generate a new room ID for the create form
function generateNewRoomId() {
  roomId.value = generateRoomId();
}
</script>

<template>
  <div class="room-manager">
    <h2>{{ isCreatingRoom ? 'Create a Room' : 'Join a Room' }}</h2>
    
    <form @submit.prevent="handleSubmit" class="room-form">
      <div class="form-group">
        <label for="playerName">Your Name:</label>
        <input 
          type="text" 
          id="playerName" 
          v-model="playerName" 
          placeholder="Enter your name"
          required
        />
      </div>
      
      <div class="form-group" v-if="isCreatingRoom">
        <label for="roomId">Room ID:</label>
        <div class="room-id-container">
          <input 
            type="text" 
            id="roomId" 
            v-model="roomId" 
            placeholder="Room ID will be generated" 
            readonly
          />
          <button 
            type="button" 
            class="regenerate-btn" 
            @click="generateNewRoomId" 
            title="Generate new room ID"
          >
            ↻
          </button>
        </div>
        <p class="room-id-info">Share this ID with your friend to join the game</p>
      </div>
      
      <div class="form-group" v-else>
        <label for="roomId">Room ID:</label>
        <input 
          type="text" 
          id="roomId" 
          v-model="roomId" 
          placeholder="Enter room ID"
          required
        />
      </div>
      
      <div class="form-actions">
        <button 
          type="submit" 
          class="primary-btn" 
          :disabled="!isFormValid"
        >
          {{ isCreatingRoom ? 'Create Room' : 'Join Room' }}
        </button>
        
        <button 
          type="button" 
          class="secondary-btn" 
          @click="toggleForm"
        >
          {{ isCreatingRoom ? 'Join Existing Room' : 'Create New Room' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.room-manager {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
  max-width: 500px;
  margin: 0 auto;
}

h2 {
  margin-top: 0;
  color: #333;
  text-align: center;
  margin-bottom: 20px;
}

.room-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

label {
  font-weight: bold;
  color: #555;
}

input {
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
}

input:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
}

.room-id-container {
  display: flex;
  gap: 10px;
}

.room-id-container input {
  flex: 1;
  background-color: #f8f9fa;
}

.regenerate-btn {
  background-color: #f1f1f1;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 18px;
  cursor: pointer;
  transition: background-color 0.2s;
  padding: 0 15px;
}

.regenerate-btn:hover {
  background-color: #e1e1e1;
}

.room-id-info {
  font-size: 14px;
  color: #777;
  margin: 5px 0 0 0;
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

button {
  padding: 12px;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.primary-btn {
  background-color: #3498db;
  color: white;
}

.primary-btn:hover:not(:disabled) {
  background-color: #2980b9;
}

.primary-btn:disabled {
  background-color: #95a5a6;
  cursor: not-allowed;
}

.secondary-btn {
  background-color: #f1f1f1;
  color: #333;
}

.secondary-btn:hover {
  background-color: #e1e1e1;
}
</style>