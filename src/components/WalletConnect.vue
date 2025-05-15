<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ethers } from "ethers";
import { createAuthRequestMessage, createAuthVerifyMessage, type NitroliteClientConfig } from "@erc7824/nitrolite";
import { generateKeyPair } from "../crypto";
import { createPublicClient, createWalletClient, custom, Hex, http } from "viem";
import clearNetService from "../services/ClearNetService";
import { CONTRACT_ADDRESSES, BROKER_WS_URL } from "../config";
import { polygon } from "viem/chains";
import { createEthersSigner } from "../crypto";

// Component state
const isConnected = ref(false);
const isConnecting = ref(false);
const isAuthenticated = ref(false);
const walletAddress = ref("");
const balance = ref(BigInt(0));
const walletError = ref("");
const ws = ref<WebSocket | null>(null);

// Storage keys
const KEY_PAIR = "crypto_keypair";

// Connection settings
const AUTH_TIMEOUT = 15000; // 15 seconds

// Event emitters
const emit = defineEmits<{
    "wallet-connected": [{ address: string; balance: bigint }];
    "wallet-disconnected": [];
    error: [string];
}>();

// Wallet signer interface following server implementation
interface WalletSigner {
    publicKey: string;
    address: string;
    sign: (payload: any) => Promise<string>;
}

/**
 * Gets or creates a wallet signer with a private key stored in localStorage
 */
async function getOrCreateWalletSigner(): Promise<WalletSigner> {
    let keyPair = null;
    const savedKeys = localStorage.getItem(KEY_PAIR);

    if (savedKeys) {
        try {
            keyPair = JSON.parse(savedKeys);
        } catch (error) {
            keyPair = null;
        }
    }

    if (!keyPair) {
        keyPair = await generateKeyPair();
        if (typeof window !== "undefined") {
            localStorage.setItem(KEY_PAIR, JSON.stringify(keyPair));
        }
    }

    return createEthersSigner(keyPair.privateKey);
}

/**
 * Connects to the WebSocket server
 */
function connectToWebSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const webSocket = new WebSocket(BROKER_WS_URL);

        const connectTimeout = setTimeout(() => {
            reject(new Error("WebSocket connection timeout"));
        }, 10000);

        webSocket.onopen = () => {
            clearTimeout(connectTimeout);
            ws.value = webSocket;
            console.log("WebSocket connection established");
            resolve(webSocket);
        };

        webSocket.onerror = (error) => {
            clearTimeout(connectTimeout);
            console.error("WebSocket connection error:", error);
            reject(new Error("Failed to connect to WebSocket server"));
        };

        webSocket.onclose = () => {
            console.log("WebSocket connection closed");
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
            webSocket.removeEventListener("message", authMessageHandler);
        };

        // Set authentication timeout
        authTimeout = setTimeout(() => {
            cleanup();
            reject(new Error("Authentication timeout"));
        }, AUTH_TIMEOUT) as unknown as number;

        // Message handler for authentication flow
        const authMessageHandler = async (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data);
                console.log("Auth message received:", message);

                // Handle auth challenge
                if (message.res && message.res[1] === "auth_challenge") {
                    console.log("Received auth challenge, creating verify message");

                    try {
                        // Create auth verify message using raw challenge response
                        const authVerify = await createAuthVerifyMessage(
                            signer.sign,
                            event.data, // Raw challenge data
                            signer.address
                        );

                        console.log("Sending auth verify:", authVerify);
                        webSocket.send(authVerify);
                    } catch (error) {
                        console.error("Failed to create auth verify message:", error);
                        cleanup();
                        reject(new Error("Failed to create auth verify message"));
                    }
                }
                // Handle auth success
                else if (message.res && message.res[1] === "auth_verify") {
                    console.log("Authentication successful");
                    cleanup();
                    isAuthenticated.value = true;
                    resolve();
                }
                // Handle auth error
                else if (message.res && message.res[1] === "error") {
                    const errorMessage = message.res[2] && message.res[2][0]?.error ? message.res[2][0].error : "Unknown authentication error";
                    console.error("Authentication error:", errorMessage);
                    cleanup();
                    reject(new Error(errorMessage));
                }
            } catch (error) {
                console.error("Error processing auth message:", error);
                // Don't reject yet, it might be an unrelated message
            }
        };

        // Add message listener
        webSocket.addEventListener("message", authMessageHandler);

        // Start authentication process
        console.log("Starting authentication with address:", signer.address);
        createAuthRequestMessage(signer.sign, signer.address)
            .then((authRequest) => {
                console.log("Sending auth request:", authRequest);
                webSocket.send(authRequest);
            })
            .catch((error) => {
                console.error("Failed to create auth request:", error);
                cleanup();
                reject(new Error("Failed to create auth request"));
            });
    });
}

/**
 * Main connect function that establishes connection and authenticates
 */
async function connectWallet() {
    if (isConnecting.value) return;

    isConnecting.value = true;
    walletError.value = "";

    try {
        // Get or create wallet signer
        const signer = await getOrCreateWalletSigner();
        walletAddress.value = signer.address;

        console.log("Using wallet with address:", signer.address);

        // Connect to WebSocket
        console.log("Connecting to WebSocket server...");
        const webSocket = await connectToWebSocket();

        // Authenticate with broker
        console.log("Authenticating with broker...");
        await authenticateWithBroker(webSocket, signer);

        // Set fake balance for display purposes
        balance.value = BigInt(1000000000000000000); // 1 ETH

        // Update connection state
        isConnected.value = true;

        // Initialize ClearNetService with proper wallet configuration
        try {
            // Generate or retrieve state keys for signing
            const CRYPTO_KEYPAIR_KEY = "crypto_keypair";
            let keyPair = null;
            const savedKeys = localStorage.getItem(CRYPTO_KEYPAIR_KEY);

            if (savedKeys) {
                try {
                    keyPair = JSON.parse(savedKeys);
                } catch (error) {
                    keyPair = null;
                }
            }

            if (!keyPair) {
                keyPair = await generateKeyPair();
                localStorage.setItem(CRYPTO_KEYPAIR_KEY, JSON.stringify(keyPair));
            }

            // Create a dedicated state wallet for signing
            const stateWallet = new ethers.Wallet(keyPair.privateKey);

            // Create a proper stateWalletClient for signing state updates
            const stateWalletClient = {
                account: {
                    address: stateWallet.address,
                },
                signMessage: async ({ message: { raw } }: { message: { raw: string } }) => {
                    try {
                        const flatSignature = await stateWallet._signingKey().signDigest(raw);

                        const signature = ethers.utils.joinSignature(flatSignature);

                        return signature as Hex;
                    } catch (error) {
                        console.error("Error signing with state wallet:", error);
                        throw error;
                    }
                },
            };

            const ethereum = (window as any).ethereum;

            const accounts = await ethereum.request({
                method: "eth_requestAccounts",
            });
            const address = accounts[0];

            // Create the wallet client using the ethereum provider
            const walletClient = createWalletClient({
                transport: custom(ethereum),
                chain: polygon,
                account: address as Hex,
            });

            const publicClient = createPublicClient({
                transport: http(),
                chain: polygon,
            });

            // Create contract addresses configuration following the EthTaipei pattern
            const ADDRESSES = {
                // Using Ethereum dummy addresses with correct checksums
                custody: CONTRACT_ADDRESSES.custody,
                adjudicator: CONTRACT_ADDRESSES.adjudicator,
                guestAddress: CONTRACT_ADDRESSES.guestAddress,
                tokenAddress: CONTRACT_ADDRESSES.tokenAddress,
            };

            // Create the actual Nitrolite configuration
            const nitroConfig: NitroliteClientConfig = {
                publicClient,
                walletClient,
                stateWalletClient,
                addresses: ADDRESSES,
                chainId: polygon.id,
                challengeDuration: BigInt(86400),
            };

            // Initialize the ClearNetService
            console.log("Initializing ClearNetService with config:", nitroConfig);
            const initialized = await clearNetService.initialize(nitroConfig);
            console.log("ClearNetService initialized:", initialized);
            if (!initialized) {
                throw new Error("Failed to initialize ClearNetService");
            }

            console.log("ClearNetService initialized successfully");
        } catch (error) {
            console.error("Error initializing ClearNetService:", error);
            walletError.value = "Failed to initialize payment channel services";
            emit("error", walletError.value);
        }

        // Emit success event
        emit("wallet-connected", {
            address: signer.address,
            balance: balance.value,
        });

        // Set up message handler for ongoing communication
        webSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log("Received message:", message);
                // Handle different message types here
            } catch (error) {
                console.error("Error parsing message:", error);
            }
        };
    } catch (error) {
        console.error("Failed to connect:", error);
        walletError.value = error instanceof Error ? error.message : "Unknown error";
        emit("error", walletError.value);
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
    walletAddress.value = "";
    balance.value = BigInt(0);

    // Note: We don't remove the private key from localStorage
    // to maintain a consistent identity across sessions

    // Emit disconnected event
    emit("wallet-disconnected");
}

/**
 * Formats an address for display (e.g., 0x1234...5678)
 */
function formatAddress(address: string): string {
    if (!address) return "";
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
    const savedPrivateKey = localStorage.getItem(KEY_PAIR);

    if (savedPrivateKey) {
        console.log("Found stored private key, attempting auto-connect");
        try {
            await connectWallet();
        } catch (error) {
            console.error("Auto-connect failed:", error);
        }
    }
});
</script>

<template>
    <div class="wallet-connect">
        <div v-if="!isConnected" class="connect-container">
            <button @click="connectWallet" class="connect-btn" :disabled="isConnecting">
                {{ isConnecting ? "Connecting..." : "Connect to Broker" }}
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
                    {{ isAuthenticated ? "Authenticated" : "Connected" }}
                </span>
            </div>

            <div class="balance">
                <span class="balance-label">Balance:</span>
                <span class="balance-value">{{ formatBalance(balance) }} ETH</span>
            </div>

            <button @click="disconnectWallet" class="disconnect-btn">Disconnect</button>
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
    background-color: #4caf50;
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
    background-color: #388e3c;
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

.address,
.balance,
.connection-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
}

.address-label,
.balance-label,
.status-label {
    font-weight: 600;
    color: #666;
}

.address-value,
.balance-value,
.status-value {
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
