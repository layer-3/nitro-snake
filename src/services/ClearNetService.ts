import { NitroliteClient } from '@erc7824/nitrolite';

export interface NitroConfig {
  publicClient: any;
  walletClient: any;
  addresses: {
    custody: string;
    adjudicator: string;
    guestAddress: string;
    tokenAddress: string;
  };
  challengeDuration: bigint;
}

export interface ChannelData {
  channelId: string;
  state: any;
}

class ClearNetService {
  private client: NitroliteClient | null = null;
  private isConnected = false;
  private currentAddress: string | null = null;
  private activeChannel: ChannelData | null = null;
  private wsConnection: WebSocket | null = null;
  private readonly wsUrl = 'wss://ethtaipei-production.up.railway.app/ws';

  async initialize(config: NitroConfig): Promise<boolean> {
    try {
      // Initialize the Nitrolite client
      this.client = new NitroliteClient(config);
      this.currentAddress = config.walletClient.account.address;
      
      // Initialize WebSocket connection to ClearNet
      await this.initializeWebSocket();
      
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error("Failed to initialize ClearNet client:", error);
      return false;
    }
  }
  
  private initializeWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wsConnection = new WebSocket(this.wsUrl);
        
        this.wsConnection.onopen = () => {
          console.log("WebSocket connection established");
          resolve();
        };
        
        this.wsConnection.onerror = (error) => {
          console.error("WebSocket connection error:", error);
          reject(error);
        };
        
        this.wsConnection.onclose = () => {
          console.log("WebSocket connection closed");
          this.isConnected = false;
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
  
  private handleWebSocketMessage(message: any) {
    console.log("Received WebSocket message:", message);
    
    // Handle different message types
    switch (message.type) {
      case 'channelUpdate':
        if (this.activeChannel && message.channelId === this.activeChannel.channelId) {
          this.activeChannel.state = message.state;
        }
        break;
      case 'stateSignatureRequest':
        this.handleStateSignatureRequest(message);
        break;
      // Add other message types as needed
    }
  }
  
  private async handleStateSignatureRequest(message: any) {
    if (!this.client || !this.currentAddress) return;
    
    try {
      const { channelId, state, stateId } = message;
      
      // Sign the state
      const signedState = await this.signState(state, stateId, channelId);
      
      // Send the signature back
      if (signedState && this.wsConnection) {
        this.wsConnection?.send(JSON.stringify({
          type: 'stateSignature',
          channelId,
          stateId,
          signature: signedState.signature,
          playerId: this.currentAddress
        }));
      }
    } catch (error) {
      console.error("Error handling signature request:", error);
    }
  }

  async depositAndCreateChannel(amount: bigint, allocationAmounts: [bigint, bigint], stateData: string): Promise<ChannelData | null> {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      const result = await this.client.depositAndCreateChannel(
        amount,
        {
          initialAllocationAmounts: allocationAmounts,
          stateData
        }
      );

      this.activeChannel = {
        channelId: result.channelId,
        state: result.initialState
      };

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

  async openGameSession(initialGameState: string) {
    if (!this.client || !this.isConnected || !this.activeChannel || !this.wsConnection) {
      console.error("ClearNet client not initialized, no active channel, or WebSocket not connected");
      return null;
    }

    try {
      // Create a session ID based on channel and timestamp
      const sessionId = `session_${this.activeChannel.channelId}_${Date.now()}`;
      
      // Format the message according to NitroliteRPC standard
      const message = {
        jsonrpc: "2.0",
        method: "createGameSession",
        params: {
          channelId: this.activeChannel.channelId,
          initialState: initialGameState,
          sessionId: sessionId
        },
        id: Date.now()
      };
      
      // Send message through WebSocket
      this.wsConnection.send(JSON.stringify(message));
      
      // Return the session info
      return {
        sessionId: sessionId,
        gameState: initialGameState
      };
    } catch (error) {
      console.error("Failed to open game session:", error);
      return null;
    }
  }

  async updateGameState(newState: string, version: bigint) {
    if (!this.client || !this.isConnected || !this.activeChannel || !this.wsConnection) {
      console.error("ClearNet client not initialized, no active channel, or WebSocket not connected");
      return false;
    }

    try {
      // First, get the current state
      if (!this.activeChannel.state) {
        throw new Error("No active channel state found");
      }
      
      // Create an updated state
      const updatedState = {
        ...this.activeChannel.state,
        stateData: newState,
        version: version,
        // Make sure to include the channel ID
        channelId: this.activeChannel.channelId
      };
      
      // Sign the updated state
      const stateHash = await this.getStateHash(updatedState);
      const signature = await this.client.config.walletClient.signMessage({ 
        message: { raw: stateHash } 
      });
      
      // Update our local state
      this.activeChannel.state = updatedState;
      
      // Add our signature to the state
      this.activeChannel.state.signatures = {
        ...this.activeChannel.state.signatures,
        [this.currentAddress || '']: signature
      };
      
      // Format the message according to NitroliteRPC standard
      const message = {
        jsonrpc: "2.0",
        method: "updateChannelState",
        params: {
          channelId: this.activeChannel.channelId,
          state: updatedState,
          signature: signature,
          address: this.currentAddress
        },
        id: Date.now()
      };
      
      // Send message through WebSocket
      this.wsConnection.send(JSON.stringify(message));
      
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
      
      // Use the wallet client to sign the message with the player's private key
      // This creates a cryptographic signature that proves this state update was authorized
      const stateHash = await this.getStateHash(state);
      const signature = await this.client.config.walletClient.signMessage({ 
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

  async closeGameSession(finalState: any) {
    if (!this.client || !this.isConnected || !this.activeChannel || !this.wsConnection) {
      console.error("ClearNet client not initialized, no active channel, or WebSocket not connected");
      return false;
    }

    try {
      // Prepare the final state according to Nitrolite SDK requirements
      const channelId = this.activeChannel.channelId;
      
      // Format the state properly for the Nitrolite SDK
      const formattedFinalState = {
        channelId,
        stateData: JSON.stringify(finalState.gameData || finalState),
        // Make sure we're using the latest allocations for final payout
        allocations: finalState.allocations || this.activeChannel.state.allocations,
        // Use a monotonically increasing version
        version: BigInt(Math.floor(Date.now() / 1000)),
        // Mark as final
        isFinal: true
      };
      
      // Get signatures if they exist in the final state
      if (finalState.signatures) {
        formattedFinalState.signatures = finalState.signatures;
      }
      
      // Sign the final state
      const stateHash = await this.getStateHash(formattedFinalState);
      const signature = await this.client.config.walletClient.signMessage({ 
        message: { raw: stateHash } 
      });
      
      // Add our signature to the final state
      formattedFinalState.signatures = {
        ...(formattedFinalState.signatures || {}),
        [this.currentAddress || '']: signature
      };
      
      // Format the message according to NitroliteRPC standard
      const message = {
        jsonrpc: "2.0",
        method: "finalizeChannel",
        params: {
          channelId,
          finalState: formattedFinalState,
          signature
        },
        id: Date.now()
      };
      
      // Send message through WebSocket
      this.wsConnection.send(JSON.stringify(message));
      
      // Also close the channel with the properly formatted state using the client
      await this.client.closeChannel({
        finalState: formattedFinalState
      });

      this.activeChannel = null;
      return true;
    } catch (error) {
      console.error("Failed to close game session:", error);
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
    if (!this.client || !this.isConnected || !this.wsConnection) {
      console.error("ClearNet client not initialized or WebSocket not connected");
      return null;
    }
    
    try {
      // First, we need to deposit funds since Nitrolite doesn't have a direct joinChannel method
      const depositTxHash = await this.client.deposit(depositAmount);
      
      if (!depositTxHash) {
        throw new Error('Failed to deposit funds');
      }
      
      // Create a state object to sign
      const initialState = {
        channelId,
        stateData,
        version: BigInt(Math.floor(Date.now() / 1000)),
        // Create a default allocation
        allocations: [
          { destination: this.currentAddress || '', amount: depositAmount }
        ]
      };
      
      // Sign the state
      const stateHash = await this.getStateHash(initialState);
      const signature = await this.client.config.walletClient.signMessage({ 
        message: { raw: stateHash } 
      });
      
      // Format the message according to NitroliteRPC standard
      const message = {
        jsonrpc: "2.0",
        method: "joinChannel",
        params: {
          channelId,
          depositAmount: depositAmount.toString(),
          state: initialState,
          signature,
          address: this.currentAddress
        },
        id: Date.now()
      };
      
      // Send message through WebSocket
      this.wsConnection.send(JSON.stringify(message));
      
      // Create a local record of the channel
      // In a real implementation, we would wait for a response from the WebSocket
      // For now, we'll create a placeholder that will be updated when we receive channel updates
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