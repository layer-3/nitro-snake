<script setup lang="ts">
import { ref, onMounted } from 'vue';
import clearNetService, { NitroConfig } from '../services/ClearNetService';

const isConnected = ref(false);
const isConnecting = ref(false);
const accountAddress = ref('');
const balance = ref<bigint | null>(null);
const walletError = ref('');

// Contract addresses from server environment
const getContractAddresses = async () => {
  try {
    const response = await fetch('/api/contract-addresses');
    if (!response.ok) {
      throw new Error(`Failed to fetch contract addresses: ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      console.error('Error parsing contract addresses response:', error);
      throw new Error('Invalid response from server. Make sure the server is running.');
    }
  } catch (error) {
    console.error('Error fetching contract addresses:', error);
    throw error;
  }
};

const challengeDuration = 100n; // Challenge duration in blocks - could be configured from server too

// Event emitters
const emit = defineEmits(['wallet-connected', 'wallet-disconnected', 'error']);

// Connect to wallet
async function connectWallet() {
  if (isConnecting.value) return;

  isConnecting.value = true;
  walletError.value = '';

  try {
    // Get actual contract addresses from server
    const contractAddresses = await getContractAddresses();

    // Connect to a wallet using viem, ethers.js, or Web3Modal
    // This is a simplified example, you would use your actual wallet connection code
    const { ethereum } = window as any;

    if (!ethereum) {
      throw new Error('MetaMask or compatible wallet not found');
    }

    // Request account access
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];

    // Get chain ID
    const chainId = await ethereum.request({ method: 'eth_chainId' });

    // Create viem compatible clients
    const publicClient = {
      getChainId: () => Promise.resolve(parseInt(chainId, 16)),
      getBalance: async () => {
        const balance = await ethereum.request({
          method: 'eth_getBalance',
          params: [address, 'latest']
        });
        return BigInt(balance);
      }
    };

    const walletClient = {
      account: {
        address,
      },
      signMessage: async (message: any) => {
        return await ethereum.request({
          method: 'personal_sign',
          params: [message.message.raw || message, address]
        });
      },
      writeContract: async (params: any) => {
        // Convert params to format expected by wallet
        const txParams = {
          from: address,
          to: params.address,
          data: params.data,
          value: params.value ? params.value.toString(16) : '0x0'
        };
        const hash = await ethereum.request({
          method: 'eth_sendTransaction',
          params: [txParams]
        });
        return { hash };
      }
    };
    
    // Create a dedicated state wallet client using a local private key
    // This wallet is optimized for fast, frequent state signings without requiring user confirmation
    // For a real implementation, you would generate and securely store this private key
    const stateWalletPrivateKey = '0x' + Array.from({length: 64}, () => 
      Math.floor(Math.random() * 16).toString(16)).join('');
      
    const stateWalletClient = {
      account: {
        address, // Use the same address for simplicity
      },
      signMessage: async (message: any) => {
        // In a real implementation, you would use ethers.js or similar to sign with the private key
        // For demo purposes, we're using the same signing method as the main wallet
        console.log("Signing state with dedicated state wallet client");
        return await ethereum.request({
          method: 'personal_sign',
          params: [message.message.raw || message, address]
        });
      }
    };

    const config: NitroConfig = {
      publicClient,
      walletClient,
      stateWalletClient, // Add the state wallet client
      addresses: contractAddresses,
      challengeDuration,
      serverAddress: '0xServerAddress123456789012345678901234567890', // The game server's Ethereum address
    };

    // Initialize the ClearNet client
    const success = await clearNetService.initialize(config);

    if (success) {
      isConnected.value = true;
      accountAddress.value = walletClient.account.address;

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
  clearNetService.cleanup(); // Clean up the WebSocket connection
  emit('wallet-disconnected');
}

function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

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
