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

  /**
   * Initialize the ClearNet client
   */
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

  /**
   * Deposit funds and create a channel
   */
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

  /**
   * Get the current account balance
   */
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

  /**
   * Start a vApp session for the snake game
   */
  async openGameSession(initialGameState: string) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return null;
    }

    // In a real implementation, this would communicate with the backend
    // to start a new game session, but for now we'll just return a mock result
    return {
      sessionId: `session_${Date.now()}`,
      gameState: initialGameState
    };
  }

  /**
   * Update the game state in the channel
   */
  async updateGameState(newState: string, version: bigint) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return false;
    }

    // In a real implementation, this would communicate with the backend to update the game state
    // and get signatures, but for now we just update our local copy
    if (this.activeChannel.state) {
      this.activeChannel.state.stateData = newState;
      this.activeChannel.state.version = version;
    }

    return true;
  }
  
  /**
   * Sign a game state for the channel
   */
  async signState(stateData: any, stateId: string, channelId: string) {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      // In a real implementation, this would use NitroliteClient to sign the state
      // For this example, we'll generate a mock signature
      const mockSignature = `sig_${Date.now()}_${this.currentAddress?.substring(0, 8)}`;
      
      return {
        signature: mockSignature,
        stateId,
        channelId,
        playerId: this.currentAddress
      };
    } catch (error) {
      console.error("Failed to sign state:", error);
      return null;
    }
  }

  /**
   * Close the vApp session and finalize the channel
   */
  async closeGameSession(finalState: any) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return false;
    }

    try {
      // Close the channel with the final state
      await this.client.closeChannel({
        finalState
      });

      this.activeChannel = null;
      return true;
    } catch (error) {
      console.error("Failed to close game session:", error);
      return false;
    }
  }

  /**
   * Withdraw funds from the channel back to the wallet
   */
  async withdrawFunds(amount: bigint) {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return false;
    }

    try {
      await this.client.withdrawal(amount);
      return true;
    } catch (error) {
      console.error("Failed to withdraw funds:", error);
      return false;
    }
  }

  /**
   * Get all channels associated with the current account
   */
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

  /**
   * Check if we're connected to ClearNet
   */
  isClientConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Get the currently active channel, if any
   */
  getActiveChannel(): ChannelData | null {
    return this.activeChannel;
  }
}

// Export a singleton instance
export const clearNetService = new ClearNetService();
export default clearNetService;