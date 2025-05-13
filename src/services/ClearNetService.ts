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

  async initialize(config: NitroConfig): Promise<boolean> {
    try {
      this.client = new NitroliteClient(config);
      this.isConnected = true;
      this.currentAddress = config.walletClient.account.address;
      return true;
    } catch (error) {
      console.error("Failed to initialize ClearNet client:", error);
      return false;
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
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return null;
    }

    try {
      // Send the initial game state to the server through WebSocket
      // The server will handle creating the actual session
      const response = await fetch('/api/game-sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId: this.activeChannel.channelId,
          initialState: initialGameState
        })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return {
        sessionId: data.sessionId,
        gameState: initialGameState
      };
    } catch (error) {
      console.error("Failed to open game session:", error);
      return null;
    }
  }

  async updateGameState(newState: string, version: bigint) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
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
      
      // Send this state to the server for other participants to sign
      if (this.client && this.activeChannel) {
        fetch(`/api/channels/${this.activeChannel.channelId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: updatedState,
            signature: signature,
            address: this.currentAddress
          })
        }).catch(err => console.error("Failed to submit state to server:", err));
      }
      
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
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
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
      
      // Close the channel with the properly formatted state
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
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }
    
    try {
      // Get channel details from the server
      const response = await fetch(`/api/channels/${channelId}`, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get channel details: ${response.status}`);
      }
      
      const channelDetails = await response.json();
      return channelDetails;
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
      // First, we need to deposit funds since Nitrolite doesn't have a direct joinChannel method
      const depositTxHash = await this.client.deposit(depositAmount);
      
      if (!depositTxHash) {
        throw new Error('Failed to deposit funds');
      }
      
      // Get channel information from the server
      const channelInfo = await this.getChannelDetails(channelId);
      
      if (!channelInfo) {
        throw new Error('Failed to get channel information');
      }
      
      // Create a state object to sign
      const initialState = {
        channelId,
        stateData,
        version: BigInt(Math.floor(Date.now() / 1000)),
        // Use allocations from channel info or create a default one
        allocations: channelInfo.allocations || [
          { destination: this.currentAddress || '', amount: depositAmount }
        ]
      };
      
      // Sign the state
      const stateHash = await this.getStateHash(initialState);
      const signature = await this.client.config.walletClient.signMessage({ 
        message: { raw: stateHash } 
      });
      
      // Submit the signed state to the server
      const response = await fetch(`/api/channels/${channelId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signature,
          state: initialState,
          address: this.currentAddress
        })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status} while joining channel`);
      }
      
      const result = await response.json();
      
      this.activeChannel = {
        channelId: result.channelId,
        state: result.state
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
}

export const clearNetService = new ClearNetService();
export default clearNetService;