<script setup lang="ts">
import { ref, computed } from 'vue';
import clearNetService from '../services/ClearNetService';

const props = defineProps<{
  isWalletConnected: boolean;
  roomId: string;
  roomCreator: boolean;
}>();

const emit = defineEmits(['channel-created', 'channel-joined', 'error']);

const depositAmount = ref<string>('0.01');
const errorMessage = ref('');
const isCreating = ref(false);
const isJoining = ref(false);
const showAdvanced = ref(false);
const channelData = ref(null);

// Convert ETH to Wei
const depositAmountWei = computed(() => {
  try {
    return BigInt(Math.floor(parseFloat(depositAmount.value) * 1e18));
  } catch (e) {
    return 0n;
  }
});

// Validate that the amount is a valid number
const isValidAmount = computed(() => {
  const amount = parseFloat(depositAmount.value);
  return !isNaN(amount) && amount > 0;
});

// Create a new channel
async function createChannel() {
  if (!props.isWalletConnected) {
    errorMessage.value = 'Please connect your wallet first';
    emit('error', errorMessage.value);
    return;
  }

  if (!isValidAmount.value) {
    errorMessage.value = 'Please enter a valid deposit amount';
    emit('error', errorMessage.value);
    return;
  }

  isCreating.value = true;
  errorMessage.value = '';

  try {
    // Calculate a fair allocation for channel participants
    // The creator puts up the entire amount, but it will be fairly divided 
    // when the game ends based on the outcomes
    const hostAmount = depositAmountWei.value; // Initial deposit amount
    const guestAmount = 0n; // Guest will add their own deposit when they join

    // Create more detailed initial state with game parameters
    const initialStateData = JSON.stringify({
      roomId: props.roomId,
      gameType: 'snake',
      createdAt: Date.now(),
      initialFunding: depositAmountWei.value.toString(),
      status: 'created'
    });
    
    // Create the channel
    const result = await clearNetService.depositAndCreateChannel(
      depositAmountWei.value,
      [hostAmount, guestAmount],
      initialStateData
    );

    if (result) {
      channelData.value = result;
      emit('channel-created', result);
    } else {
      errorMessage.value = 'Failed to create channel';
      emit('error', errorMessage.value);
    }
  } catch (error) {
    console.error('Error creating channel:', error);
    errorMessage.value = 'Error creating channel: ' + (error instanceof Error ? error.message : String(error));
    emit('error', errorMessage.value);
  } finally {
    isCreating.value = false;
  }
}

// Join an existing channel
async function joinChannel() {
  if (!props.isWalletConnected) {
    errorMessage.value = 'Please connect your wallet first';
    emit('error', errorMessage.value);
    return;
  }
  
  if (!isValidAmount.value) {
    errorMessage.value = 'Please enter a valid deposit amount';
    emit('error', errorMessage.value);
    return;
  }

  isJoining.value = true;
  errorMessage.value = '';

  try {
    // Get channel details from the server for this room
    const response = await fetch(`/api/rooms/${props.roomId}/channel`);
    
    if (!response.ok) {
      throw new Error(`Failed to get channel information: ${response.status}`);
    }
    
    const channelInfo = await response.json();
    
    // Get the deposit amount specified by the user
    const depositAmount = depositAmountWei.value;
    
    // Join the channel with our deposit
    // In a real implementation, this would call the join method on the channel
    // and handle the deposit funds appropriately
    const joinedChannel = await clearNetService.joinChannel(
      channelInfo.channelId, 
      depositAmount, 
      `game:${props.roomId}:joined`
    );
    
    if (!joinedChannel) {
      throw new Error('Failed to join channel');
    }
    
    channelData.value = joinedChannel;
    emit('channel-joined', joinedChannel);
  } catch (error) {
    console.error('Error joining channel:', error);
    errorMessage.value = 'Error joining channel: ' + (error instanceof Error ? error.message : String(error));
    emit('error', errorMessage.value);
  } finally {
    isJoining.value = false;
  }
}

// Toggle advanced options
function toggleAdvanced() {
  showAdvanced.value = !showAdvanced.value;
}
</script>

<template>
  <div class="channel-setup">
    <h3>{{ roomCreator ? 'Create Game Channel' : 'Join Game Channel' }}</h3>
    
    <div class="form-group">
      <label for="depositAmount">Deposit Amount (ETH):</label>
      <input 
        id="depositAmount" 
        v-model="depositAmount" 
        type="number" 
        step="0.001"
        min="0.001"
        :disabled="isCreating || isJoining"
      />
      <small>This amount will be used to fund your game channel.</small>
    </div>
    
    <div class="actions">
      <template v-if="roomCreator">
        <button 
          @click="createChannel" 
          class="create-btn"
          :disabled="!isWalletConnected || isCreating || !isValidAmount"
        >
          {{ isCreating ? 'Creating...' : 'Create & Fund Channel' }}
        </button>
      </template>
      <template v-else>
        <button 
          @click="joinChannel" 
          class="join-btn"
          :disabled="!isWalletConnected || isJoining || !isValidAmount"
        >
          {{ isJoining ? 'Joining...' : 'Join & Fund Channel' }}
        </button>
      </template>
    </div>
    
    <div class="advanced-toggle" @click="toggleAdvanced">
      {{ showAdvanced ? 'Hide' : 'Show' }} Advanced Options
    </div>
    
    <div v-if="showAdvanced" class="advanced-options">
      <div class="form-group">
        <label for="roomId">Room ID:</label>
        <input id="roomId" type="text" :value="roomId" disabled />
      </div>
      
      <div class="form-group">
        <label for="role">Your Role:</label>
        <input id="role" type="text" :value="roomCreator ? 'Room Creator' : 'Room Joiner'" disabled />
      </div>
    </div>
    
    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>
    
    <div v-if="channelData" class="channel-info">
      <div class="info-item">
        <span class="label">Channel ID:</span>
        <span class="value">{{ channelData.channelId }}</span>
      </div>
      <div class="info-item">
        <span class="label">Status:</span>
        <span class="value success">Created</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.channel-setup {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  width: 100%;
  max-width: 500px;
}

h3 {
  margin-top: 0;
  margin-bottom: 20px;
  color: #333;
}

.form-group {
  margin-bottom: 15px;
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

small {
  display: block;
  color: #888;
  margin-top: 4px;
  font-size: 0.85em;
}

.actions {
  margin-top: 20px;
}

.create-btn, .join-btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.create-btn {
  background-color: #4CAF50;
  color: white;
}

.create-btn:hover:not(:disabled) {
  background-color: #388E3C;
}

.join-btn {
  background-color: #2196F3;
  color: white;
}

.join-btn:hover:not(:disabled) {
  background-color: #1976D2;
}

.create-btn:disabled, .join-btn:disabled {
  background-color: #9e9e9e;
  cursor: not-allowed;
}

.advanced-toggle {
  text-align: center;
  margin-top: 15px;
  color: #2196F3;
  cursor: pointer;
  font-size: 0.9em;
}

.advanced-toggle:hover {
  text-decoration: underline;
}

.advanced-options {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.error-message {
  background-color: #ffebee;
  color: #c62828;
  padding: 10px;
  border-radius: 4px;
  margin-top: 20px;
  text-align: center;
}

.channel-info {
  margin-top: 20px;
  padding: 15px;
  background-color: #e8f5e9;
  border-radius: 4px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.info-item:last-child {
  margin-bottom: 0;
}

.label {
  font-weight: 600;
  color: #555;
}

.value {
  font-family: monospace;
}

.success {
  color: #4CAF50;
  font-weight: bold;
}
</style>