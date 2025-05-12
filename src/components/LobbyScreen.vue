<script setup lang="ts">
import { defineEmits, defineProps } from 'vue';

const props = defineProps<{
  nickname: string;
  roomId: string;
  errorMessage: string;
}>();

const emit = defineEmits([
  'update:nickname',
  'update:roomId',
  'create-room',
  'join-room'
]);

const updateNickname = (e: Event) => {
  emit('update:nickname', (e.target as HTMLInputElement).value);
};

const updateRoomId = (e: Event) => {
  emit('update:roomId', (e.target as HTMLInputElement).value);
};

const createRoom = () => {
  emit('create-room');
};

const joinRoom = () => {
  emit('join-room');
};
</script>

<template>
  <div class="lobby">
    <!-- Username Card -->
    <div class="form-container">
      <h2>Set Username</h2>
      
      <div class="form-group">
        <label for="nickname">Your Nickname:</label>
        <input 
          id="nickname" 
          type="text" 
          :value="nickname" 
          @input="updateNickname" 
          placeholder="Enter your nickname"
        />
      </div>
    </div>
    
    <!-- Game Actions Card -->
    <div class="form-container">
      <h2>Game Options</h2>
      
      <div class="actions">
        <div class="action-group">
          <button @click="createRoom" class="btn primary">Create New Room</button>
        </div>
        
        <div class="divider">OR</div>
        
        <div class="action-group">
          <div class="form-group">
            <label for="roomId">Room ID:</label>
            <input 
              id="roomId" 
              type="text" 
              :value="roomId" 
              @input="updateRoomId" 
              placeholder="Enter room ID"
            />
          </div>
          <button @click="joinRoom" class="btn secondary">Join Existing Room</button>
        </div>
      </div>
      
      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
  gap: 20px;
}

.form-container {
  background-color: #f8f8f8;
  border-radius: 8px;
  padding: 30px;
  width: 100%;
  max-width: 500px;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.1);
}

h2 {
  text-align: center;
  margin-top: 0;
  margin-bottom: 25px;
  color: #333;
}

.form-group {
  margin-bottom: 20px;
}

label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
  color: #555;
}

input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
}

input:focus {
  border-color: #4CAF50;
  outline: none;
}

.actions {
  margin-top: 25px;
}

.action-group {
  margin-bottom: 20px;
}

.btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.primary {
  background-color: #4CAF50;
  color: white;
}

.primary:hover {
  background-color: #388E3C;
}

.secondary {
  background-color: #2196F3;
  color: white;
}

.secondary:hover {
  background-color: #1976D2;
}

.divider {
  text-align: center;
  margin: 15px 0;
  color: #888;
  position: relative;
}

.divider::before,
.divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 45%;
  height: 1px;
  background-color: #ddd;
}

.divider::before {
  left: 0;
}

.divider::after {
  right: 0;
}

.error-message {
  background-color: #ffebee;
  color: #c62828;
  padding: 10px;
  border-radius: 4px;
  margin-top: 20px;
  text-align: center;
}
</style>