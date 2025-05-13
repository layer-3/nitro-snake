<script setup lang="ts">
import { ref, onMounted } from 'vue';
import clearNetService, { NitroConfig } from '../services/ClearNetService';
import { createAuthRequestMessage, createAuthVerifyMessage } from '@erc7824/nitrolite';

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

    // Create a wallet client that will be compatible with nitrolite
    const walletClient = {
      account: {
        address: address,
      },
      // Provide more robust signMessage function
      signMessage: async (message: any) => {
        // Handle different message formats
        let messageToSign;
        
        if (typeof message === 'string') {
          messageToSign = message;
        } else if (message && message.message) {
          if (typeof message.message === 'string') {
            messageToSign = message.message;
          } else if (message.message.raw) {
            messageToSign = message.message.raw;
          } else {
            messageToSign = JSON.stringify(message.message);
          }
        } else {
          messageToSign = JSON.stringify(message);
        }
        
        console.log("Signing message:", messageToSign);
        
        return await ethereum.request({
          method: 'personal_sign',
          params: [messageToSign, address]
        });
      },
      // Add contract interaction support
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

    // Create the configuration object
    const config = {
      publicClient,
      walletClient,
      stateWalletClient, // Add the state wallet client
      addresses: contractAddresses,
      challengeDuration,
      serverAddress: '0x14791697260E4c9A71f18484C9f997B308e59325', // Use the actual server address
    };

    console.log("Initializing ClearNet client with config:", {
      ...config,
      walletClient: {
        ...config.walletClient,
        account: config.walletClient.account
      }
    });

    // Initialize the ClearNet client
    const success = await clearNetService.initialize(config);

    if (success) {
      isConnected.value = true;
      accountAddress.value = walletClient.account.address;

      try {
        // Connect to broker server and authenticate using server's connectToBroker approach
        // We'll implement a similar function to handle authentication with the broker
        await connectToBroker();
        
        // Get account info
        const accountInfo = await clearNetService.getAccountInfo();
        if (accountInfo) {
          balance.value = accountInfo.available;
        }

        emit('wallet-connected', { address: accountAddress.value, balance: balance.value });
      } catch (error) {
        console.error('Error during broker authentication:', error);
        walletError.value = 'Connected to wallet but broker authentication failed';
        emit('error', walletError.value);
      }
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

// Connect to broker and authenticate
async function connectToBroker(): Promise<void> {
  console.log('Connecting to broker and authenticating...');
  
  try {
    // Get the WebSocket from ClearNetService
    const ws = clearNetService.getWebSocketConnection();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    
    // Create a wallet signer that will work with nitrolite
    const { ethereum } = window as any;
    if (!ethereum) {
      throw new Error('No ethereum provider found');
    }
    
    // Get current wallet address
    const address = accountAddress.value;
    if (!address) {
      throw new Error('No wallet address available');
    }
    
    // Create a wallet signer for authentication
    const signer = {
      address,
      sign: async (message: any): Promise<string> => {
        // Convert to string if needed
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        console.log("Message to sign:", messageStr);
        
        // Sign with MetaMask
        return ethereum.request({
          method: 'personal_sign',
          params: [messageStr, address]
        });
      }
    };
    
    // Use the authenticate function (based on the React implementation)
    await authenticate(ws, signer, 15000); // 15 second timeout
    console.log('Successfully authenticated with broker');
  } catch (error) {
    console.error('Error in connectToBroker:', error);
    throw error;
  }
}

/**
 * Authenticates with the WebSocket server using a challenge-response flow.
 *
 * @param ws - The WebSocket connection
 * @param signer - The signer to use for authentication
 * @param timeout - Timeout in milliseconds for the entire process
 * @returns A Promise that resolves when authenticated
 */
async function authenticate(ws: WebSocket, signer: any, timeout: number): Promise<void> {
  if (!ws) throw new Error('WebSocket not connected');

  const authRequest = await createAuthRequestMessage(signer.sign, signer.address);

  console.log('Sending authRequest:', authRequest);
  ws.send(authRequest);

  return new Promise((resolve, reject) => {
    if (!ws) return reject(new Error('WebSocket not connected'));

    let authTimeoutId: number | null = null;

    const cleanup = () => {
      if (authTimeoutId) {
        clearTimeout(authTimeoutId);
        authTimeoutId = null;
      }
      ws.removeEventListener('message', handleAuthResponse);
    };

    const resetTimeout = () => {
      if (authTimeoutId) {
        clearTimeout(authTimeoutId);
      }
      authTimeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Authentication timeout'));
      }, timeout);
    };

    const handleAuthResponse = async (event: MessageEvent) => {
      let response;

      try {
        response = JSON.parse(event.data);
        console.log('Received auth message:', response);
      } catch (error) {
        console.error('Error parsing auth response:', error);
        console.log('Raw auth message:', event.data);
        // Don't reject yet, maybe the next message is valid
        return;
      }

      try {
        // Check for challenge response: [<id>, "auth_challenge", [{challenge_message: "..."}], <ts>]
        if (response.res && response.res[1] === 'auth_challenge') {
          console.log('Received auth_challenge, preparing auth_verify...');
          resetTimeout(); // Reset timeout while we process and send verify

          // Create and send verification message
          const authVerify = await createAuthVerifyMessage(
            signer.sign,
            event.data, // Pass the raw challenge response
            signer.address,
          );

          console.log('Sending authVerify:', authVerify);
          ws.send(authVerify);
          // Keep listening for the final success/error
        }
        // Check for success response: [<id>, "auth_verify", ...] 
        else if (response.res && response.res[1] === 'auth_verify') {
          console.log('Authentication successful');
          cleanup();
          resolve();
        }
        // Check for error response
        else if (response.res && response.res[1] === 'error') {
          const errorMsg = response.res[2] && response.res[2][0]?.error 
            ? response.res[2][0].error 
            : 'Authentication failed';

          console.error('Authentication failed:', errorMsg);
          cleanup();
          reject(new Error(String(errorMsg)));
        } 
        // Check for alternate error format
        else if (response.err && response.err[1] === 'error') {
          const errorMsg = response.err ? response.err[1] : response.error || 'Authentication failed';

          console.error('Authentication failed:', errorMsg);
          cleanup();
          reject(new Error(String(errorMsg)));
        } else {
          console.warn('Received unexpected auth message structure:', response);
          // Keep listening if it wasn't a final success/error
        }
      } catch (error) {
        console.error('Error handling auth response:', error);
        cleanup();
        reject(new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`));
      }
    };

    ws.addEventListener('message', handleAuthResponse);
    resetTimeout(); // Start the initial timeout
  });
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
