import {
  NitroliteClient,
  createAuthRequestMessage,
  createAuthVerifyMessage,
  type NitroliteClientConfig,
  type RequestData,
  type ResponsePayload
} from '@erc7824/nitrolite';

export interface NitroConfig {
  publicClient: any;
  walletClient: any;
  // Optional: Separate wallet client for signing states
  stateWalletClient?: any;
  addresses: {
    custody: string;
    adjudicator: string;
    guestAddress: string;
    tokenAddress: string;
  };
  challengeDuration: bigint;
  serverAddress?: string; // Game server's ethereum address
}

export interface ChannelData {
  channelId: string;
  state: any;
}

class ClearNetService {
  private client: NitroliteClient | null = null;
  private config: any = null; // Store the config for wallet client access
  private isConnected = false;
  private currentAddress: string | null = null;
  private activeChannel: ChannelData | null = null;
  private wsConnection: WebSocket | null = null;
  private readonly wsUrl = 'ws://localhost:8000/ws';
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  // Keep track of pending signature requests to prevent duplicate prompts
  private pendingSignatures = new Map<string, Promise<string>>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  async initialize(config: NitroliteClientConfig): Promise<boolean> {
    try {
      // Validate the config
      if (!config) {
        throw new Error('Config object is required');
      }

      // Check for required config properties
      if (!config.walletClient) {
        throw new Error('walletClient is required in config');
      }

      if (!config.walletClient.account || !config.walletClient.account.address) {
        throw new Error('walletClient.account.address is required');
      }

      console.log("Initializing with wallet address:", config.walletClient.account.address);

      // Store the config for later use with wallet client
      this.config = config;
      
      // Initialize the Nitrolite client
      this.client = new NitroliteClient(config);
      this.currentAddress = config.walletClient.account.address;

      // Initialize WebSocket connection to ClearNet
      console.log("Initializing WebSocket connection...");
      await this.initializeWebSocket();

      this.isConnected = true;
      console.log("ClearNet client initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize ClearNet client:", error);
      return false;
    }
  }

  private initializeWebSocket(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    return new Promise((resolve, reject) => {
      try {
        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
          return resolve();
        }

        // Check if wallet address is available
        if (!this.currentAddress) {
          console.error("Cannot initialize WebSocket: No wallet address available");
          return reject(new Error("No wallet address available"));
        }

        // Check ethereum provider availability
        const { ethereum } = window as any;
        if (!ethereum) {
          console.error("Cannot initialize WebSocket: No ethereum provider found");
          return reject(new Error("No ethereum provider found"));
        }

        console.log("Creating WebSocket connection to:", this.wsUrl);
        this.wsConnection = new WebSocket(this.wsUrl);

        let connectTimeout = setTimeout(() => {
          console.error("WebSocket connection timeout");
          reject(new Error("WebSocket connection timeout"));
        }, 10000);

        this.wsConnection.onopen = async () => {
          clearTimeout(connectTimeout);
          console.log("WebSocket connection established");

          try {
            // Log wallet client details for debugging
            console.log("Wallet client account:", this.client?.config?.walletClient?.account);
            console.log("Current address:", this.currentAddress);

            // Authenticate with the broker
            await this.authenticateWithBroker();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            resolve();
          } catch (error) {
            console.error("Authentication failed:", error);
            this.wsConnection?.close();
            reject(error);
          }
        };

        this.wsConnection.onerror = (error) => {
          console.error("WebSocket connection error:", error);
          reject(error);
        };

        this.wsConnection.onclose = () => {
          console.log("WebSocket connection closed");
          this.isConnected = false;
          this.handleReconnect();
        };

        this.wsConnection.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
          }
        };
      } catch (error) {
        console.error("Error initializing WebSocket:", error);
        reject(error);
      }
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      this.initializeWebSocket().catch(() => {
        console.log('Reconnect attempt failed');
      });
    }, delay);
  }

  /**
   * Creates a wallet signer that's compatible with nitrolite's authentication functions
   * Uses the wallet client provided during initialization instead of direct MetaMask access
   *
   * @returns A signer object with address and sign function
   */
  private createWalletSigner() {
    // Use the wallet client that was provided during initialization
    if (!this.currentAddress) {
      throw new Error('No wallet address available - connect wallet first');
    }

    // Get the walletClient from our stored config
    if (!this.config?.walletClient) {
      throw new Error('No wallet client available - initialize with wallet client first');
    }
    
    const walletClient = this.config.walletClient;
    
    return {
      address: this.currentAddress as string,

      // Create a sign function that works with nitrolite
      sign: async (message: RequestData | ResponsePayload | string): Promise<string> => {
        try {
          // Convert to string if needed
          const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

          console.log("Message to sign:", messageStr);

          // Check if we already have a pending signature request for this message
          if (this.pendingSignatures.has(messageStr)) {
            console.log("Using existing signature request for this message");
            return this.pendingSignatures.get(messageStr)!;
          }

          // Create a new signature request promise
          const signaturePromise = (async () => {
            try {
              // Use the wallet client's signMessage function
              console.log("Signing with wallet client");
              
              // Use our stored wallet client for signing
              const signature = await walletClient.signMessage({
                message: messageStr
              });

              console.log("Signature from wallet client:", signature);
              return signature;
            } finally {
              // Remove from pending map when done (whether success or error)
              this.pendingSignatures.delete(messageStr);
            }
          })();

          // Store the promise in our pending map
          this.pendingSignatures.set(messageStr, signaturePromise);

          // Return the promise
          return signaturePromise;
        } catch (error) {
          console.error("Error signing message:", error);
          throw error;
        }
      }
    };
  }

  private authenticationInProgress: Promise<void> | null = null;

  private async authenticateWithBroker(): Promise<void> {
    // If authentication is already in progress, return the existing promise
    if (this.authenticationInProgress) {
      console.log('Authentication already in progress, reusing existing authentication flow');
      return this.authenticationInProgress;
    }

    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Create a wallet signer that will work with nitrolite
    const signer = this.createWalletSigner();

    // Create a new authentication promise and store it
    const authPromise = new Promise<void>((resolve, reject) => {
      let authTimeout: number;

      // Create a one-time message handler for authentication
      const authMessageHandler = async (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Auth process message received:', message);

          // Check for auth_challenge response
          if (message.res && message.res[1] === 'auth_challenge') {
            console.log('Received auth_challenge, preparing auth_verify...');
            // Log the exact structure of the response to help us debug
            console.log('Challenge full response:', message);
            console.log('Challenge res array:', message.res);
            console.log('Challenge data:', message.res[2]);

            try {
              // Let's try to extract the challenge directly from the raw response
              const rawData = event.data;
              console.log('Raw challenge response:', rawData);

              // Extract the challenge from the response - more safely
              let challenge = null;
              const responseData = message.res[2];

              if (Array.isArray(responseData) && responseData.length > 0) {
                if (typeof responseData[0] === 'object') {
                  // Try both challenge and challenge_message fields
                  challenge = responseData[0]?.challenge || responseData[0]?.challenge_message;
                } else if (typeof responseData[0] === 'string') {
                  challenge = responseData[0];
                }
              } else if (typeof responseData === 'object') {
                challenge = responseData.challenge || responseData.challenge_message;
              } else if (typeof responseData === 'string') {
                challenge = responseData;
              }

              console.log('Extracted challenge:', challenge);

              if (!challenge) {
                throw new Error('No challenge received in auth_challenge response');
              }

              console.log('Challenge received:', challenge);

              // Use raw challenge data directly for verification
              console.log('Using raw challenge response for verification');

              // Pass the raw challenge response to createAuthVerifyMessage
              // This should match what the server is doing
              const authVerify = await createAuthVerifyMessage(
                signer.sign,
                rawData, // Raw challenge response as a string
                signer.address
              );

              console.log('Auth verify created by nitrolite:', authVerify);
              console.log('Sending auth_verify:', authVerify);
              this.wsConnection?.send(authVerify);
            } catch (error) {
              console.error('Error creating auth verify message:', error);
              cleanup();
              reject(new Error(`Failed to create auth verify message: ${error.message}`));
            }
          }
          // Check for auth_verify success response
          else if (message.res && message.res[1] === 'auth_verify') {
            console.log('Authentication successful');
            cleanup();
            resolve();
          }
          // Check for error responses
          else if (message.res && message.res[1] === 'error') {
            const errorMessage = message.res[2] && message.res[2][0]?.error
              ? message.res[2][0].error
              : 'Unknown authentication error';
            console.error('Authentication error:', errorMessage);
            cleanup();
            reject(new Error(errorMessage));
          }
        } catch (error) {
          console.error('Error processing authentication message:', error);
          // Don't reject yet, it might be an unrelated message
        }
      };

      // Clean up function to remove listeners and clear timeout
      const cleanup = () => {
        this.wsConnection?.removeEventListener('message', authMessageHandler);
        clearTimeout(authTimeout);
        this.authenticationInProgress = null; // Reset authentication in progress
      };

      // Set timeout for auth process
      authTimeout = setTimeout(() => {
        cleanup();
        reject(new Error('Authentication timeout'));
      }, 15000); // 15 second timeout

      // Add temporary listener for authentication messages
      this.wsConnection?.addEventListener('message', authMessageHandler);

      // Use nitrolite's createAuthRequestMessage directly
      console.log('Starting authentication with address:', signer.address);

      // Use the same approach as the server
      createAuthRequestMessage(signer.sign, signer.address)
        .then(authRequest => {

          console.log('Sending auth_request:', authRequest);
          this.wsConnection?.send(authRequest);
        })
        .catch(error => {
          console.error('Error creating auth request:', error);
          cleanup();
          reject(new Error(`Failed to create auth request: ${error.message}`));
        });
    });

    // Store the promise and return it
    this.authenticationInProgress = authPromise;
    return authPromise;
  }

  private handleWebSocketMessage(message: any): void {
    console.log("Received WebSocket message:", message);

    // Check if it's a response to a pending request
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(message.id)!;
      clearTimeout(timeout);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'Unknown error'));
      } else {
        resolve(message.result || message.res?.[2]);
      }
      return;
    }

    // Handle other message types
    if (message.method) {
      switch (message.method) {
        case 'channel_update':
          // Handle channel state update
          if (this.activeChannel && message.params?.channel_id === this.activeChannel.channelId) {
            this.activeChannel.state = message.params.state;
          }
          break;

        case 'app_update':
          // Handle application update
          console.log('Received app update:', message.params);
          break;
      }
    }
  }

  /**
   * Sends a JSONRPC request to the broker and waits for the response
   */
  private async sendJsonRpcRequest(request: any): Promise<any> {
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      await this.initializeWebSocket();

      if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }
    }

    return new Promise((resolve, reject) => {
      const requestId = request.id || `req-${Date.now()}`;
      request.id = requestId;

      // Set timeout for the request
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 15000); // 15 second timeout

      // Add the request to pending requests
      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      // Send the request
      this.wsConnection?.send(JSON.stringify(request));
    });
  }

  async depositAndCreateChannel(amount: bigint, stateData: string): Promise<ChannelData | null> {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      // Step 1: Open channel on the broker using Nitrolite client
      // This uses the native ethereum transaction flow rather than WebSocket RPC
      const result = await this.client.createChannel({
        initialAllocationAmounts: [amount, BigInt(0)],
        stateData
      });

      if (!result || !result.channelId) {
        throw new Error('Failed to create channel: Invalid response');
      }

      // Save the channel data
      this.activeChannel = {
        channelId: result.channelId,
        state: result.initialState
      };

      console.log(`Channel created successfully with ID: ${result.channelId}`);

      // Store channel in localStorage for persistence
      try {
        localStorage.setItem('nitro_channel_id', result.channelId);
        localStorage.setItem('nitro_channel_state', JSON.stringify(result.initialState,
          (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value)
        );
      } catch (error) {
        console.error('Failed to save channel to localStorage:', error);
      }

      return this.activeChannel;
    } catch (error) {
      console.error("Failed to deposit and create channel:", error);
      return null;
    }
  }

  async getAccountInfo() {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      return await this.client.getAccountInfo();
    } catch (error) {
      console.error("Failed to get account info:", error);
      return null;
    }
  }

  async createAppSession(participants: string[], initialGameState: string) {
    if (!this.client || !this.isConnected || !this.activeChannel || !this.wsConnection) {
      console.error("ClearNet client not initialized, no active channel, or WebSocket not connected");
      return null;
    }

    try {
      // Create an app session on the broker with the server account
      // This is typically done by the server, but we include this code for reference
      // to show the expected message format

      // Get the app definition parameters
      const appId = `snake_game_${Date.now()}`;
      const tokenAddress = this.client.config.addresses.tokenAddress;

      // Format the message for create_app_session
      // In a real implementation, this would be signed by the server
      const createAppSessionMessage = {
        jsonrpc: "2.0",
        method: "create_app_session",
        params: {
          channel_id: this.activeChannel.channelId,
          app_definition: {
            protocol: "nitroliterpc",
            participants: participants, // e.g. [alice_address, bob_address, server_address]
            weights: [0, 0, 100], // Alice: 0, Bob: 0, Server: 100
            quorum: 100, // Server has full decision power
            challenge: 0,
            nonce: Date.now()
          },
          token: tokenAddress,
          allocations: [100, 0], // Initial allocations - all funds start with Alice (player A)
          app_id: appId,
          initial_state: initialGameState
        },
        id: `create-app-${Date.now()}`
      };

      // In a real implementation, the server would sign and send this message
      // Here we return the app session info that the server would create
      return {
        appId: appId,
        channelId: this.activeChannel.channelId,
        initialState: initialGameState
      };
    } catch (error) {
      console.error("Failed to create app session:", error);
      return null;
    }
  }

  // This method notifies the game server about a player joining a room
  async joinGameRoom(roomId: string, nickname: string) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return null;
    }

    try {
      // In a real implementation, this would connect to the game server WebSocket
      // and send a joinRoom message with the channel ID

      // For reference, a joinRoom message might look like:
      const joinRoomMessage = {
        type: 'joinRoom',
        roomId,
        nickname,
        channelId: this.activeChannel.channelId,
        walletAddress: this.currentAddress
      };

      // This would normally be sent to the game server WebSocket

      return {
        roomId,
        playerId: `player_${Math.floor(Math.random() * 1000)}`,
        channelId: this.activeChannel.channelId
      };
    } catch (error) {
      console.error("Failed to join game room:", error);
      return null;
    }
  }

  async updateGameState(newState: string, version: bigint) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return false;
    }

    try {
      // In the new design, game state updates are handled by the game server
      // and not directly by the client. The game server maintains the game state
      // and calls the broker to update the app session state when necessary.

      // This function would typically just notify the game server about
      // client-side events like direction changes, but doesn't directly
      // update the channel or app session state.

      // For documentation purposes, a game state update message to the game server
      // might look like this:
      const gameStateUpdateMessage = {
        type: 'gameStateUpdate',
        channelId: this.activeChannel.channelId,
        state: newState,
        version: version.toString(),
        timestamp: Date.now()
      };

      // In a real implementation, this would be sent to the game server's WebSocket

      console.log('Game state update:', gameStateUpdateMessage);

      return true;
    } catch (error) {
      console.error("Failed to update game state:", error);
      return false;
    }
  }

  async signState(stateData: any, stateId: string, channelId: string) {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      // We need to properly format the state according to Nitrolite SDK specs
      // The state must include the channelId, version, and any allocations
      const state = {
        channelId,
        stateData: JSON.stringify(stateData),
        version: BigInt(Math.floor(Date.now() / 1000)),
        allocations: this.activeChannel?.state?.allocations || [],
        stateId
      };

      // Use the state wallet client if available, otherwise fall back to regular wallet client
      // This creates a cryptographic signature that proves this state update was authorized
      const stateHash = await this.getStateHash(state);

      // Choose which wallet client to use for signing
      const signingClient = this.client.config.stateWalletClient || this.client.config.walletClient;
      const signature = await signingClient.signMessage({
        message: { raw: stateHash }
      });

      return {
        signature,
        stateId,
        channelId,
        playerId: this.currentAddress
      };
    } catch (error) {
      console.error("Failed to sign state:", error);
      return null;
    }
  }

  async leaveGame() {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return false;
    }

    try {
      // In the new design, the client doesn't directly close game sessions
      // Only the server can close an app session since it has 100% of the weight

      // This method would typically just notify the game server that the player
      // is leaving the game, and the server would handle the rest

      // For documentation purposes, a leave game message might look like:
      const leaveGameMessage = {
        type: 'leaveGame',
        channelId: this.activeChannel.channelId,
        playerAddress: this.currentAddress,
        timestamp: Date.now()
      };

      // In a real implementation, this would be sent to the game server's WebSocket

      console.log('Player leaving game:', leaveGameMessage);

      // Clear our local channel reference
      this.activeChannel = null;

      // Clear storage
      try {
        localStorage.removeItem('nitro_channel_id');
        localStorage.removeItem('nitro_channel_state');
      } catch (error) {
        console.error('Failed to clear storage:', error);
      }

      return true;
    } catch (error) {
      console.error("Failed to leave game:", error);
      return false;
    }
  }

  // This function would be used if the player wants to withdraw funds from a channel
  async closeChannel() {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return false;
    }

    try {
      // If we have an active channel, try to close it
      if (this.activeChannel) {
        // Call the Nitrolite SDK to close the channel
        await this.client.closeChannel({
          channelId: this.activeChannel.channelId
        });

        // Clear local storage
        try {
          localStorage.removeItem('nitro_channel_id');
          localStorage.removeItem('nitro_channel_state');
        } catch (error) {
          console.error('Failed to clear storage:', error);
        }

        this.activeChannel = null;
      }

      return true;
    } catch (error) {
      console.error("Failed to close channel:", error);
      return false;
    }
  }

  async withdrawFunds(amount: bigint) {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return false;
    }

    try {
      // Ensure amount is valid
      if (amount <= 0n) {
        throw new Error("Withdrawal amount must be greater than zero");
      }

      // Check available balance first
      const accountInfo = await this.client.getAccountInfo();
      if (!accountInfo || accountInfo.available < amount) {
        throw new Error("Insufficient balance for withdrawal");
      }

      // Proceed with withdrawal
      const withdrawalTx = await this.client.withdrawal(amount);

      // Log transaction details for easier tracking
      console.log(`Withdrawal transaction initiated: ${withdrawalTx.hash || '(no hash)'}`);
      console.log(`Withdrawn amount: ${amount.toString()}`);
      console.log(`Account: ${this.currentAddress}`);

      return true;
    } catch (error) {
      console.error("Failed to withdraw funds:", error);
      return false;
    }
  }

  // Get detailed channel information from ClearNet RPC
  async getChannelDetails(channelId: string): Promise<any> {
    if (!this.client || !this.isConnected || !this.wsConnection) {
      console.error("ClearNet client not initialized or WebSocket not connected");
      return null;
    }

    try {
      // Create a promise that will be resolved when we receive the channel details
      return new Promise((resolve, reject) => {
        // Generate a unique message ID for this request
        const messageId = Date.now();

        // Create a timeout to reject the promise if we don't get a response
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for channel details"));
        }, 10000); // 10 second timeout

        // Set up a one-time message handler for this specific request
        const messageHandler = (event: MessageEvent) => {
          try {
            const response = JSON.parse(event.data);

            // Check if this is the response to our request
            if (response.id === messageId && response.result && response.result.channelId === channelId) {
              // Clean up
              clearTimeout(timeout);
              this.wsConnection?.removeEventListener('message', messageHandler);

              // Resolve with the channel details
              resolve(response.result);
            }
          } catch (error) {
            // Ignore parse errors or messages that don't match our criteria
          }
        };

        // Add the temporary event listener
        this.wsConnection?.addEventListener('message', messageHandler);

        // Format the message according to NitroliteRPC standard
        const message = {
          jsonrpc: "2.0",
          method: "getChannelDetails",
          params: { channelId },
          id: messageId
        };

        // Send message through WebSocket
        this.wsConnection.send(JSON.stringify(message));
      });
    } catch (error) {
      console.error(`Failed to get details for channel ${channelId}:`, error);
      return null;
    }
  }

  async getAccountChannels() {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return [];
    }

    try {
      return await this.client.getAccountChannels();
    } catch (error) {
      console.error("Failed to get account channels:", error);
      return [];
    }
  }

  async joinChannel(channelId: string, depositAmount: bigint, stateData: string): Promise<ChannelData | null> {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      // First, deposit funds using the Nitrolite client
      const depositTxHash = await this.client.deposit(depositAmount);

      if (!depositTxHash) {
        throw new Error('Failed to deposit funds');
      }

      // We need to get the current channel state to properly join
      const channelInfo = await this.client.getChannelInfo(channelId);

      if (!channelInfo) {
        throw new Error('Failed to get channel information');
      }

      // Now, join the channel by updating its state and signatures
      // Depending on the SDK, this might be done by the following steps:
      // 1. Get the current state
      // 2. Sign it
      // 3. Submit the signed state

      // Create a state object to sign (this format depends on the Nitrolite SDK)
      const initialState = channelInfo.state;

      // Sign the state
      const stateHash = await this.getStateHash(initialState);
      const signingClient = this.client.config.stateWalletClient || this.client.config.walletClient;
      const signature = await signingClient.signMessage({
        message: { raw: stateHash }
      });

      // Store channel in localStorage for persistence
      try {
        localStorage.setItem('nitro_channel_id', channelId);
        localStorage.setItem('nitro_channel_state', JSON.stringify(initialState,
          (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value)
        );
      } catch (error) {
        console.error('Failed to save channel to localStorage:', error);
      }

      // Store the active channel
      this.activeChannel = {
        channelId,
        state: initialState
      };

      return this.activeChannel;
    } catch (error) {
      console.error("Failed to join channel:", error);
      return null;
    }
  }

  // Helper method to hash a state with the Nitrolite protocol standard
  getStateHash(state: any): string {
    if (!this.client) {
      throw new Error("ClearNet client not initialized");
    }

    // Format the state as required by the ERC-7824 specification
    const stateString = JSON.stringify(state);

    try {
      // Add the nitro protocol prefix for state hashing
      const prefixedState = `nitro-state:${stateString}`;

      // Convert to Uint8Array for hashing
      const encoder = new TextEncoder();
      const data = encoder.encode(prefixedState);

      // Use the browser's crypto API to create the state hash
      // This follows the ERC-7824 state hashing specification
      return window.crypto.subtle.digest('SHA-256', data)
        .then(hash => {
          // Convert hash to hex string
          return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        });
    } catch (error) {
      console.error("Failed to hash state:", error);
      throw error;
    }
  }

  isClientConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  getActiveChannel(): ChannelData | null {
    return this.activeChannel;
  }

  // Get the current WebSocket connection
  getWebSocketConnection(): WebSocket | null {
    return this.wsConnection;
  }

  // Cleanup method to close WebSocket connection
  cleanup() {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }

    this.isConnected = false;
    this.activeChannel = null;
  }
}

export const clearNetService = new ClearNetService();
export default clearNetService;
