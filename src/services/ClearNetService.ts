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

    // Mock implementation for demo purposes
    return {
      sessionId: `session_${Date.now()}`,
      gameState: initialGameState
    };
  }

  async updateGameState(newState: string, version: bigint) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return false;
    }

    if (this.activeChannel.state) {
      this.activeChannel.state.stateData = newState;
      this.activeChannel.state.version = version;
    }

    return true;
  }
  
  async signState(stateData: any, stateId: string, channelId: string) {
    if (!this.client || !this.isConnected) {
      console.error("ClearNet client not initialized");
      return null;
    }

    try {
      // Mock signature for demo purposes
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

  async closeGameSession(finalState: any) {
    if (!this.client || !this.isConnected || !this.activeChannel) {
      console.error("ClearNet client not initialized or no active channel");
      return false;
    }

    try {
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

  isClientConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  getActiveChannel(): ChannelData | null {
    return this.activeChannel;
  }
}

export const clearNetService = new ClearNetService();
export default clearNetService;