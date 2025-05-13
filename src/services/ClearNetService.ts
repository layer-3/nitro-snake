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
      // Use the Nitrolite client to sign the state
      const stateString = JSON.stringify(stateData);
      const signature = await this.client.signMessage(stateString);
      
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
      // Join an existing channel with a deposit
      const result = await this.client.joinChannel({
        channelId,
        depositAmount,
        stateData
      });
      
      if (!result || !result.channelId) {
        throw new Error('Failed to join channel');
      }
      
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

  isClientConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  getActiveChannel(): ChannelData | null {
    return this.activeChannel;
  }
}

export const clearNetService = new ClearNetService();
export default clearNetService;