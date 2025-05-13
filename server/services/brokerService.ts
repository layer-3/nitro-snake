import { WebSocket } from 'ws';
import { ethers } from 'ethers';
import { 
  BROKER_WS_URL, 
  SERVER_PRIVATE_KEY 
} from '../config';
import { 
  setBrokerWebSocket, 
  getBrokerWebSocket,
  addPendingRequest,
  getPendingRequest,
  clearPendingRequest 
} from './stateService';

// Connects to the Nitrolite broker
export function connectToBroker(): void {
  const brokerWs = getBrokerWebSocket();
  if (brokerWs && (brokerWs.readyState === WebSocket.OPEN || brokerWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`Connecting to Nitrolite broker at ${BROKER_WS_URL}`);
  const ws = new WebSocket(BROKER_WS_URL);
  setBrokerWebSocket(ws);

  ws.on('open', async () => {
    console.log('Connected to Nitrolite broker');
    
    // Authenticate with the broker
    try {
      await authenticateWithBroker();
      console.log('Successfully authenticated with the broker');
    } catch (error) {
      console.error('Authentication failed:', error);
    }
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleBrokerMessage(message);
    } catch (error) {
      console.error('Error parsing message from broker:', error);
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from Nitrolite broker, will reconnect in 5 seconds');
    setTimeout(connectToBroker, 5000);
  });

  ws.on('error', (error) => {
    console.error('Error in broker WebSocket connection:', error);
  });
}

// Authenticates with the broker using the server's private key - two step process
export async function authenticateWithBroker(): Promise<any> {
  const brokerWs = getBrokerWebSocket();
  if (!brokerWs || brokerWs.readyState !== WebSocket.OPEN) {
    throw new Error('Not connected to broker');
  }

  // Step 1: Send auth request
  const wallet = new ethers.Wallet(SERVER_PRIVATE_KEY);
  const authRequest = {
    jsonrpc: "2.0",
    method: "auth_request",
    params: {
      address: wallet.address
    },
    id: `auth-${Date.now()}`
  };

  // Send auth request and wait for challenge
  const challengeResponse = await sendToBroker(authRequest);
  
  // Extract challenge message - should handle both response formats
  let challenge;
  if (challengeResponse.params?.challenge) {
    challenge = challengeResponse.params.challenge;
  } else if (challengeResponse[2] && challengeResponse[2][0]?.challenge_message) {
    challenge = challengeResponse[2][0].challenge_message;
  } else {
    console.error('Challenge message not found in response:', challengeResponse);
    throw new Error('No challenge received from broker');
  }
  
  console.log('Received challenge:', challenge);

  // Step 2: Sign the challenge and send verification
  const signature = await wallet.signMessage(challenge);
  const timestamp = Date.now();
  
  const verifyRequest = {
    jsonrpc: "2.0",
    method: "auth_verify",
    params: {
      address: wallet.address,
      signature: signature,
      timestamp: timestamp
    },
    id: `verify-${timestamp}`
  };

  // Send verification and get result
  return sendToBroker(verifyRequest);
}

// Handles messages received from the broker
export function handleBrokerMessage(message: any): void {
  // First check if it's an array-format response with res field
  if (message.res && Array.isArray(message.res)) {
    // Check if it's a response to a pending request (res[0] might be the request ID)
    const requestId = message.res[0];
    if (typeof requestId === 'string' || typeof requestId === 'number') {
      const pendingRequest = getPendingRequest(requestId.toString());
      if (pendingRequest) {
        const { resolve, reject, timeout } = pendingRequest;
        clearTimeout(timeout);

        // Check if it's an error (based on the protocol's structure)
        if (message.res[1] === 'error') {
          reject(new Error(JSON.stringify(message.res[2] || 'Unknown error')));
        } else {
          // For successful responses, return the res array itself
          resolve(message.res);
        }
        return;
      }
    }
  }

  // Standard JSON-RPC response format
  if (message.id && getPendingRequest(message.id)) {
    const pendingRequest = getPendingRequest(message.id);
    if (!pendingRequest) return;
    
    const { resolve, reject, timeout } = pendingRequest;
    clearTimeout(timeout);

    if (message.error) {
      reject(new Error(message.error.message || 'Unknown error'));
    } else {
      resolve(message.result || message);
    }
    return;
  }

  // Handle other broker messages
  console.log('Received message from broker:', message);
}

// Sends a request to the broker and returns a promise
export function sendToBroker(request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const brokerWs = getBrokerWebSocket();
    if (!brokerWs || brokerWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to broker'));
      return;
    }

    const requestId = request.id || `req-${Date.now()}`;
    request.id = requestId;

    const timeout = setTimeout(() => {
      clearPendingRequest(requestId);
      reject(new Error('Request timeout'));
    }, 10000); // 10 second timeout

    addPendingRequest(requestId, resolve, reject, timeout);
    brokerWs.send(JSON.stringify(request));
  });
}

// Creates an application session in the broker
export async function createAppSession(
  channelId: string, 
  participants: string[], 
  appId: string, 
  initialState: any
): Promise<string> {
  const request = {
    jsonrpc: "2.0",
    method: "create_app_session",
    params: {
      channel_id: channelId,
      participants: participants,
      weights: [0, 0, 100], // Alice: 0, Bob: 0, Server: 100
      quorum: 100, // Server has full decision power
      initial_state: JSON.stringify(initialState),
      app_id: appId
    },
    id: `create-app-${Date.now()}`
  };

  try {
    const result = await sendToBroker(request);
    console.log(`Created app session ${appId} for channel ${channelId}`);
    // Handle both result formats
    return result.app_id || (result[2] && result[2][0]?.app_id);
  } catch (error) {
    console.error(`Error creating app session for channel ${channelId}:`, error);
    throw error;
  }
}

// Closes an application session in the broker
export async function closeAppSession(
  appId: string, 
  channelId: string, 
  finalState: any, 
  allocations: number[]
): Promise<boolean> {
  const request = {
    jsonrpc: "2.0",
    method: "close_app_session",
    params: {
      app_id: appId,
      channel_id: channelId,
      allocations: allocations,
      final_state: JSON.stringify(finalState)
    },
    id: `close-app-${Date.now()}`
  };

  try {
    await sendToBroker(request);
    console.log(`Closed app session ${appId} for channel ${channelId}`);
    return true;
  } catch (error) {
    console.error(`Error closing app session ${appId}:`, error);
    return false;
  }
}