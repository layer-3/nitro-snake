<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ethers } from 'ethers';
import { createAuthRequestMessage, createAuthVerifyMessage } from '@erc7824/nitrolite';
import { generateKeyPair } from '../crypto';

// Component state
const isConnected = ref(false);
const isConnecting = ref(false);
const isAuthenticated = ref(false);
const walletAddress = ref('');
const balance = ref(BigInt(0));
const walletError = ref('');
const ws = ref<WebSocket | null>(null);

// Storage keys
const BROKER_PRIVATE_KEY = 'nitro_broker_private_key';

// Connection settings
const WS_URL = 'ws://localhost:8000/ws';
const AUTH_TIMEOUT = 15000; // 15 seconds

// Event emitters
const emit = defineEmits<{
  'wallet-connected': [{ address: string, balance: bigint }],
  'wallet-disconnected': [],
  'error': [string]
}>();

// Wallet signer interface following server implementation
interface WalletSigner {
  publicKey: string;
  address: string;
  sign: (payload: any) => Promise<string>;
}

/**
 * Creates an ethers signer from a private key following server's implementation
 */
function createEthersSigner(privateKey: string): WalletSigner {
  try {
    // Create ethers wallet from private key
    const wallet = new ethers.Wallet(privateKey);

    return {
      publicKey: wallet.publicKey,
      address: wallet.address,
      sign: async (payload: any): Promise<string> => {
        try {
          // Convert payload to string if needed
          const payloadStr = typeof payload === 'string' 
            ? payload 
            : JSON.stringify(payload);
            
          // Hash the payload string
          const messageBytes = ethers.utils.arrayify(ethers.utils.id(payloadStr));

          // Sign the digest using the private key
          const flatSignature = await wallet._signingKey().signDigest(messageBytes);

          // Join the signature components into a single string
          const signature = ethers.utils.joinSignature(flatSignature);

          return signature;
        } catch (error) {
          console.error('Error signing message:', error);
          throw error;
        }
      }
    };
  } catch (error) {
    console.error('Error creating ethers signer:', error);
    throw error;
  }
}

/**
 * Gets or creates a wallet signer with a private key stored in localStorage
 */
async function getOrCreateWalletSigner(): Promise<WalletSigner> {
  // Check if we have a saved private key
  const savedPrivateKey = localStorage.getItem(BROKER_PRIVATE_KEY);
  
  if (savedPrivateKey) {
    console.log('Using existing private key from localStorage');
    return createEthersSigner(savedPrivateKey);
  }
  
  // Generate a new random keypair
  console.log('Generating new private key');
  const keypair = await generateKeyPair();
  
  // Save the private key for future use
  localStorage.setItem(BROKER_PRIVATE_KEY, keypair.privateKey);
  
  return createEthersSigner(keypair.privateKey);
}

/**
 * Connects to the WebSocket server
 */
function connectToWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(WS_URL);
    
    const connectTimeout = setTimeout(() => {
      reject(new Error('WebSocket connection timeout'));
    }, 10000);
    
    webSocket.onopen = () => {
      clearTimeout(connectTimeout);
      ws.value = webSocket;
      console.log('WebSocket connection established');
      resolve(webSocket);
    };
    
    webSocket.onerror = (error) => {
      clearTimeout(connectTimeout);
      console.error('WebSocket connection error:', error);
      reject(new Error('Failed to connect to WebSocket server'));
    };
    
    webSocket.onclose = () => {
      console.log('WebSocket connection closed');
      isConnected.value = false;
      isAuthenticated.value = false;
    };
  });
}

/**
 * Authenticates with the broker using the wallet signer
 */
async function authenticateWithBroker(webSocket: WebSocket, signer: WalletSigner): Promise<void> {
  return new Promise((resolve, reject) => {
    let authTimeout: number | null = null;
    
    // Clean up function
    const cleanup = () => {
      if (authTimeout) {
        clearTimeout(authTimeout);
        authTimeout = null;
      }
      webSocket.removeEventListener('message', authMessageHandler);
    };
    
    // Set authentication timeout
    authTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Authentication timeout'));
    }, AUTH_TIMEOUT) as unknown as number;
    
    // Message handler for authentication flow
    const authMessageHandler = async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Auth message received:', message);
        
        // Handle auth challenge
        if (message.res && message.res[1] === 'auth_challenge') {
          console.log('Received auth challenge, creating verify message');
          
          try {
            // Create auth verify message using raw challenge response
            const authVerify = await createAuthVerifyMessage(
              signer.sign,
              event.data, // Raw challenge data
              signer.address
            );
            
            console.log('Sending auth verify:', authVerify);
            webSocket.send(authVerify);
          } catch (error) {
            console.error('Failed to create auth verify message:', error);
            cleanup();
            reject(new Error('Failed to create auth verify message'));
          }
        }
        // Handle auth success
        else if (message.res && message.res[1] === 'auth_verify') {
          console.log('Authentication successful');
          cleanup();
          isAuthenticated.value = true;
          resolve();
        }
        // Handle auth error
        else if (message.res && message.res[1] === 'error') {
          const errorMessage = message.res[2] && message.res[2][0]?.error
            ? message.res[2][0].error
            : 'Unknown authentication error';
          console.error('Authentication error:', errorMessage);
          cleanup();
          reject(new Error(errorMessage));
        }
      } catch (error) {
        console.error('Error processing auth message:', error);
        // Don't reject yet, it might be an unrelated message
      }
    };
    
    // Add message listener
    webSocket.addEventListener('message', authMessageHandler);
    
    // Start authentication process
    console.log('Starting authentication with address:', signer.address);
    createAuthRequestMessage(signer.sign, signer.address)
      .then(authRequest => {
        console.log('Sending auth request:', authRequest);
        webSocket.send(authRequest);
      })
      .catch(error => {
        console.error('Failed to create auth request:', error);
        cleanup();
        reject(new Error('Failed to create auth request'));
      });
  });
}

/**
 * Main connect function that establishes connection and authenticates
 */
async function connectWallet() {
  if (isConnecting.value) return;
  
  isConnecting.value = true;
  walletError.value = '';
  
  try {
    // Get or create wallet signer
    const signer = await getOrCreateWalletSigner();
    walletAddress.value = signer.address;
    
    console.log('Using wallet with address:', signer.address);
    
    // Connect to WebSocket
    console.log('Connecting to WebSocket server...');
    const webSocket = await connectToWebSocket();
    
    // Authenticate with broker
    console.log('Authenticating with broker...');
    await authenticateWithBroker(webSocket, signer);
    
    // Set fake balance for display purposes
    balance.value = BigInt(1000000000000000000); // 1 ETH
    
    // Update connection state
    isConnected.value = true;
    
    // Emit success event
    emit('wallet-connected', {
      address: signer.address,
      balance: balance.value
    });
    
    // Set up message handler for ongoing communication
    webSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);
        // Handle different message types here
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
  } catch (error) {
    console.error('Failed to connect:', error);
    walletError.value = error instanceof Error ? error.message : 'Unknown error';
    emit('error', walletError.value);
  } finally {
    isConnecting.value = false;
  }
}

/**
 * Disconnects from the broker
 */
function disconnectWallet() {
  // Close WebSocket connection if it exists
  if (ws.value) {
    ws.value.close();
    ws.value = null;
  }
  
  // Reset all state variables
  isConnected.value = false;
  isAuthenticated.value = false;
  walletAddress.value = '';
  balance.value = BigInt(0);
  
  // Note: We don't remove the private key from localStorage
  // to maintain a consistent identity across sessions
  
  // Emit disconnected event
  emit('wallet-disconnected');
}

/**
 * Formats an address for display (e.g., 0x1234...5678)
 */
function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

/**
 * Formats a balance in wei to ETH with 4 decimal places
 */
function formatBalance(balanceWei: bigint): string {
  return (Number(balanceWei) / 1e18).toFixed(4);
}

// Try to reconnect on component mount if we have a stored key
onMounted(async () => {
  // Check if we have a stored private key
  const savedPrivateKey = localStorage.getItem(BROKER_PRIVATE_KEY);
  
  if (savedPrivateKey) {
    console.log('Found stored private key, attempting auto-connect');
    try {
      await connectWallet();
    } catch (error) {
      console.error('Auto-connect failed:', error);
    }
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
        {{ isConnecting ? 'Connecting...' : 'Connect to Broker' }}
      </button>
      <div v-if="walletError" class="error-message">{{ walletError }}</div>
    </div>

    <div v-else class="wallet-info">
      <div class="address">
        <span class="address-label">Wallet Address:</span>
        <span class="address-value">{{ formatAddress(walletAddress) }}</span>
      </div>

      <div class="connection-status">
        <span class="status-label">Status:</span>
        <span class="status-value" :class="{ 'status-authenticated': isAuthenticated }">
          {{ isAuthenticated ? 'Authenticated' : 'Connected' }}
        </span>
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

.address, .balance, .connection-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.address-label, .balance-label, .status-label {
  font-weight: 600;
  color: #666;
}

.address-value, .balance-value, .status-value {
  font-family: monospace;
  background-color: #e9ecef;
  padding: 4px 8px;
  border-radius: 4px;
}

.status-authenticated {
  background-color: #d4edda;
  color: #155724;
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
