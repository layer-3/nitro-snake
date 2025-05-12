<script setup lang="ts">
import { ref, onMounted } from 'vue';
import clearNetService, { NitroConfig } from '../services/ClearNetService';

const isConnected = ref(false);
const isConnecting = ref(false);
const accountAddress = ref('');
const balance = ref<bigint | null>(null);
const walletError = ref('');

// Placeholder values - in a real app, these would be fetched from an environment file or configuration
const CONTRACT_ADDRESSES = {
  custody: '0x1234567890123456789012345678901234567890',
  adjudicator: '0x0987654321098765432109876543210987654321',
  guestAddress: '0x2345678901234567890123456789012345678901',
  tokenAddress: '0x3456789012345678901234567890123456789012'
};

const challengeDuration = 100n; // Challenge duration in blocks

// Event emitters
const emit = defineEmits(['wallet-connected', 'wallet-disconnected', 'error']);

// Connect to wallet
async function connectWallet() {
  if (isConnecting.value) return;
  
  isConnecting.value = true;
  walletError.value = '';
  
  try {
    // In a real implementation, you would use viem, ethers.js, or Web3Modal to connect to a wallet
    // For this example, we'll simulate a connection
    const mockPublicClient = {
      getChainId: () => Promise.resolve(1),
      getBalance: () => Promise.resolve(1000000000000000000n) // 1 ETH
    };
    
    const mockWalletClient = {
      account: {
        address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      },
      signMessage: () => Promise.resolve('0x1234567890'),
      writeContract: () => Promise.resolve({ hash: '0x1234567890' })
    };
    
    const config: NitroConfig = {
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      addresses: CONTRACT_ADDRESSES,
      challengeDuration,
    };
    
    // Initialize the ClearNet client
    const success = await clearNetService.initialize(config);
    
    if (success) {
      isConnected.value = true;
      accountAddress.value = mockWalletClient.account.address;
      
      // Get account info
      const accountInfo = await clearNetService.getAccountInfo();
      if (accountInfo) {
        balance.value = accountInfo.available;
      }
      
      emit('wallet-connected', { address: accountAddress.value, balance: balance.value });
    } else {
      walletError.value = 'Failed to initialize ClearNet client';
      emit('error', walletError.value);
    }
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    walletError.value = 'Failed to connect wallet';
    emit('error', walletError.value);
  } finally {
    isConnecting.value = false;
  }
}

// Disconnect wallet
function disconnectWallet() {
  isConnected.value = false;
  accountAddress.value = '';
  balance.value = null;
  emit('wallet-disconnected');
}

// Format address for display
function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Format balance for display
function formatBalance(balanceWei: bigint | null): string {
  if (balanceWei === null) return '0';
  return (Number(balanceWei) / 1e18).toFixed(4);
}

// Check if wallet is already connected on component mount
onMounted(() => {
  const isAlreadyConnected = clearNetService.isClientConnected();
  if (isAlreadyConnected) {
    isConnected.value = true;
    // Would need to get the actual address from the service in a real implementation
  }
});
</script>

<template>
  <div class="wallet-connect">
    <div v-if="!isConnected" class="connect-container">
      <button 
        @click="connectWallet" 
        class="connect-btn"
        :disabled="isConnecting"
      >
        {{ isConnecting ? 'Connecting...' : 'Connect Wallet' }}
      </button>
      <div v-if="walletError" class="error-message">{{ walletError }}</div>
    </div>
    
    <div v-else class="wallet-info">
      <div class="address">
        <span class="address-label">Address:</span>
        <span class="address-value">{{ formatAddress(accountAddress) }}</span>
      </div>
      
      <div class="balance">
        <span class="balance-label">Balance:</span>
        <span class="balance-value">{{ formatBalance(balance) }} ETH</span>
      </div>
      
      <button @click="disconnectWallet" class="disconnect-btn">
        Disconnect
      </button>
    </div>
  </div>
</template>

<style scoped>
.wallet-connect {
  padding: 15px;
  border-radius: 8px;
  background-color: #f8f9fa;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
  width: 100%;
  max-width: 500px;
}

.connect-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.connect-btn {
  background-color: #4CAF50;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;
  max-width: 250px;
}

.connect-btn:hover {
  background-color: #388E3C;
}

.connect-btn:disabled {
  background-color: #9e9e9e;
  cursor: not-allowed;
}

.wallet-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.address, .balance {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.address-label, .balance-label {
  font-weight: 600;
  color: #666;
}

.address-value, .balance-value {
  font-family: monospace;
  background-color: #e9ecef;
  padding: 4px 8px;
  border-radius: 4px;
}

.disconnect-btn {
  background-color: #f44336;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-top: 10px;
  align-self: flex-end;
}

.disconnect-btn:hover {
  background-color: #d32f2f;
}

.error-message {
  color: #f44336;
  margin-top: 10px;
  text-align: center;
}
</style>