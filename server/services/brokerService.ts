import { WebSocket } from "ws";
import { ethers } from "ethers";
import {
    createAuthRequestMessage,
    createAuthVerifyMessage,
    RequestData,
    ResponsePayload,
    MessageSigner,
    NitroliteClient,
    NitroliteClientConfig,
    createAppSessionMessage,
    Intent,
    AppDefinition,
    NitroliteRPC,
    getRequestId,
    createGetLedgerBalancesMessage,
} from "@erc7824/nitrolite";
import { BROKER_WS_URL, CONTRACT_ADDRESSES, POLYGON_RPC_URL, WALLET_PRIVATE_KEY } from "../config";
import { setBrokerWebSocket, getBrokerWebSocket, addPendingRequest, getPendingRequest, clearPendingRequest } from "./stateService";
import { Hex, createWalletClient, createPublicClient, http } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_PROTOCOL = "app_aura_nitrolite_v0";
const DEFAULT_WEIGHTS: number[] = [0, 0, 100]; // Alice: 0, Bob: 0, Server: 100
const DEFAULT_QUORUM: number = 100; // server alone decides the outcome

// Flag to indicate if we've authenticated with the broker
let isAuthenticated = false;
let client: NitroliteClient = await createClient();

async function createClient(): Promise<NitroliteClient> {
    // Create the wallet client using the ethereum provider

    const wallet = privateKeyToAccount(WALLET_PRIVATE_KEY);
    const address = wallet.address;
    const walletClient = createWalletClient({
        transport: http(process.env.POLYGON_RPC_URL),
        chain: polygon,
        account: wallet,
    });

    const publicClient = createPublicClient({
        transport: http(POLYGON_RPC_URL),
        chain: polygon,
    });

    // Create a dedicated client for signing state updates
    const stateWallet = new ethers.Wallet(WALLET_PRIVATE_KEY);
    const stateWalletClient = {
        account: {
            address: address,
        },
        signMessage: async ({ message: { raw } }) => {
            console.log("Signing message:", raw);
            const signature = await wallet.sign({ hash: raw });
            console.log("Signature:", signature);
            return signature;
        },
    };
    const config: NitroliteClientConfig = {
        publicClient,
        walletClient,
        stateWalletClient,
        account: address,
        addresses: CONTRACT_ADDRESSES,
        chainId: polygon.id,
        challengeDuration: BigInt(86400), // 1 day in seconds
    };
    const client = new NitroliteClient(config);
    await createBrokerChannel(client);

    return client;
}

async function createBrokerChannel(client: NitroliteClient): Promise<void> {
    // Verify if the channel already exists
    const channels = await client.getAccountChannels(); // on chain, get_channels from the broker
    console.log("Channels", channels);
    if (channels.length > 0) {
        console.log("Channel already exists, skipping creation");
        return;
    }

    // Create a channel with the broker
    const createChannelResponse = await client.createChannel({
        initialAllocationAmounts: [0n, 0n],
        stateData: "0x",
    });
    console.log("Created channel", createChannelResponse);
}

// Connects to the Nitrolite broker
export function connectToBroker(): void {
    const brokerWs = getBrokerWebSocket();
    if (brokerWs && (brokerWs.readyState === WebSocket.OPEN || brokerWs.readyState === WebSocket.CONNECTING)) {
        return;
    }

    console.log(`Connecting to Nitrolite broker at ${BROKER_WS_URL}`);
    const ws = new WebSocket(BROKER_WS_URL);
    setBrokerWebSocket(ws);
    isAuthenticated = false;

    ws.on("open", async () => {
        console.log("Connected to Nitrolite broker");

        // Authenticate with the broker immediately upon connection
        try {
            await authenticateWithBroker();
            console.log("Successfully authenticated with broker");
        } catch (error) {
            console.error("Authentication with broker failed:", error);
        }
    });

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleBrokerMessage(message);
        } catch (error) {
            console.error("Error parsing message from broker:", error);
        }
    });

    ws.on("close", () => {
        console.log("Disconnected from Nitrolite broker, will reconnect in 5 seconds");
        isAuthenticated = false;
        setTimeout(connectToBroker, 5000);
    });

    ws.on("error", (error) => {
        console.error("Error in broker WebSocket connection:", error);
    });
}

// Authenticate with the broker using server's wallet and nitrolite package
async function authenticateWithBroker(): Promise<void> {
    const brokerWs = getBrokerWebSocket();
    if (!brokerWs || brokerWs.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
    }

    // Create the wallet signer using our factory
    const signer = createEthersSigner(WALLET_PRIVATE_KEY);
    const serverAddress = signer.address;
    if (!serverAddress) {
        throw new Error("Server address not found");
    }

    return new Promise((resolve, reject) => {
        let authTimeout: NodeJS.Timeout;

        // Clean up function to remove listeners and clear timeout
        const cleanup = () => {
            brokerWs.removeListener("message", authMessageHandler);
            clearTimeout(authTimeout);
        };

        // Create a one-time message handler for authentication
        const authMessageHandler = async (data: WebSocket.Data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log("Auth process message received:", message);

                // Check for auth_challenge response (response to our auth_request)
                if (message.res && message.res[1] === "auth_challenge") {
                    console.log("Received auth_challenge, preparing auth_verify...");

                    try {
                        // Use nitrolite's createAuthVerifyMessage, passing the raw challenge response and our signer
                        const authVerify = await createAuthVerifyMessage(
                            signer.sign,
                            data.toString(), // Pass the raw challenge response
                            serverAddress
                        );
                        const getBalances = await createGetLedgerBalancesMessage(
                            signer.sign,
                            "0x0ca18249bd1305abaf465686d94a0815f4a057086419e60185e5e0d7e6795f7a"
                        );

                        console.log("getBalances", getBalances);

                        console.log("Sending auth_verify:", authVerify);

                        brokerWs.send(authVerify);
                        const paramsForChannels = [{ participant: signer.address }];
                        const getChannelsMessage = NitroliteRPC.createRequest(10, "get_channels", paramsForChannels);
                        const getChannelMessage = await NitroliteRPC.signRequestMessage(getChannelsMessage, signer.sign);
                        brokerWs.send(getBalances);
                        brokerWs.send(JSON.stringify(getChannelMessage));
                    } catch (error) {
                        console.error("Error creating auth verify message:", error);
                        cleanup();
                        reject(new Error(`Failed to create auth verify message: ${error.message}`));
                    }
                }
                // Check for auth_verify success response
                else if (message.res && message.res[1] === "auth_verify") {
                    isAuthenticated = true;
                    cleanup();
                    resolve();
                }
                // Check for error responses
                else if (message.res && message.res[1] === "error") {
                    const errorMessage = message.res[2] && message.res[2][0]?.error ? message.res[2][0].error : "Unknown authentication error";
                    console.error("Authentication error:", errorMessage);
                    cleanup();
                    reject(new Error(errorMessage));
                }
            } catch (error) {
                console.error("Error processing authentication message:", error);
                cleanup();
                reject(new Error(`Authentication processing error: ${error.message}`));
            }
        };

        // Set timeout for auth process
        authTimeout = setTimeout(() => {
            cleanup();
            reject(new Error("Authentication timeout"));
        }, 15000); // 15 second timeout

        // Add temporary listener for authentication messages
        brokerWs.on("message", authMessageHandler);

        // Create and send the auth request using nitrolite
        console.log("Starting authentication with address:", serverAddress);
        console.log("Server wallet address:", serverAddress);
        console.log("Private key used (first 4 chars):", WALLET_PRIVATE_KEY.substring(0, 6) + "...");

        // Generate the auth request using nitrolite and our properly typed signer
        createAuthRequestMessage(signer.sign, serverAddress)
            .then((authRequest) => {
                console.log("Sending auth_request:", authRequest);
                brokerWs.send(authRequest);
            })
            .catch((error) => {
                console.error("Error creating auth request:", error);
                cleanup();
                reject(new Error(`Failed to create auth request: ${error.message}`));
            });
    });
}

// Handles messages received from the broker
export function handleBrokerMessage(message: any): void {
    try {
        // Log the raw message for debugging
        console.log("Received message from broker:", message);

        // Handle RPC format (new format with 'res' array)
        if (message.res && Array.isArray(message.res)) {
            // Check if it's an error message
            if (message.res[1] === "error") {
                console.log("Received error from broker:", message.res[2]);

                // Check if it's a response to a pending request
                const requestId = message.res[0];
                if (typeof requestId === "string" || typeof requestId === "number") {
                    const pendingRequest = getPendingRequest(requestId.toString());
                    if (pendingRequest) {
                        const { reject, timeout } = pendingRequest;
                        clearTimeout(timeout);
                        clearPendingRequest(requestId.toString());

                        const errorMessage = message.res[2] && message.res[2][0]?.error ? message.res[2][0].error : "Unknown error";
                        reject(new Error(errorMessage));
                    }
                }
                return;
            }

            // Handle successful response to a pending request
            const requestId = message.res[0];
            if (typeof requestId === "string" || typeof requestId === "number") {
                const pendingRequest = getPendingRequest(requestId.toString());
                if (pendingRequest) {
                    const { resolve, timeout } = pendingRequest;
                    clearTimeout(timeout);
                    clearPendingRequest(requestId.toString());

                    // For successful responses, return the result data (typically in res[2])
                    const resultData = message.res[2] || [];
                    resolve(resultData.length === 1 ? resultData[0] : resultData);
                    return;
                }
            }
        }

        // Legacy JSON-RPC response format (should rarely be used with new broker)
        if (message.id && typeof message.id === "string") {
            const pendingRequest = getPendingRequest(message.id);
            if (pendingRequest) {
                const { resolve, reject, timeout } = pendingRequest;
                clearTimeout(timeout);
                clearPendingRequest(message.id);

                if (message.error) {
                    reject(new Error(message.error.message || "Unknown error"));
                } else {
                    resolve(message.result || message);
                }
                return;
            }
        }

        // Handle other message types like notifications
        // (in a real implementation, you might want to emit events for these)
    } catch (error) {
        console.error("Error handling broker message:", error);
    }
}

// Check authentication status
export function isAuthenticatedWithBroker(): boolean {
    return isAuthenticated;
}

// Re-export the authentication function for external use
export { authenticateWithBroker };

// Sends a request to the broker and returns a promise
export async function sendToBroker(request: any): Promise<any> {
    // Check authentication first before creating the Promise
    if (!isAuthenticated && !(request.req && request.req[1] === "auth_request") && !(request.req && request.req[1] === "auth_verify")) {
        try {
            console.log("Not authenticated with broker, authenticating first...");
            await authenticateWithBroker();
        } catch (error) {
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    return new Promise((resolve, reject) => {
        const brokerWs = getBrokerWebSocket();
        if (!brokerWs || brokerWs.readyState !== WebSocket.OPEN) {
            reject(new Error("Not connected to broker"));
            return;
        }

        // Prepare the request using a Promise chain
        const prepareRequest = async (): Promise<{ req: any; requestId: string | number }> => {
            let requestId: string | number;
            let preparedRequest = request;

            // Check if the request is in the new format
            if (request.req && Array.isArray(request.req)) {
                requestId = request.req[0] || Date.now();
                preparedRequest.req[0] = requestId;

                // If the signature is empty or missing, add it
                if (!preparedRequest.sig || preparedRequest.sig.length === 0 || !preparedRequest.sig[0]) {
                    const signature = await signRpcRequest(preparedRequest.req);
                    preparedRequest.sig = [signature];
                }
            } else {
                // Legacy format - convert to new format
                requestId = request.id || `req-${Date.now()}`;
                const reqData = [requestId, request.method, request.params ? [request.params] : [], Math.floor(Date.now() / 1000)];

                // Sign the request
                const signature = await signRpcRequest(reqData);

                preparedRequest = {
                    req: reqData,
                    sig: [signature],
                };
            }

            return { req: preparedRequest, requestId };
        };

        // Execute the async preparation outside the Promise executor
        prepareRequest()
            .then(({ req, requestId }) => {
                // Convert requestId to string for tracking
                const requestIdStr = requestId.toString();

                const timeout = setTimeout(() => {
                    clearPendingRequest(requestIdStr);
                    reject(new Error("Request timeout"));
                }, 10000); // 10 second timeout

                addPendingRequest(requestIdStr, resolve, reject, timeout);
                brokerWs.send(JSON.stringify(req));
            })
            .catch((error) => {
                reject(new Error(`Failed to prepare request: ${error.message}`));
            });
    });
}

// Creates an application session in the broker
export async function createAppSession(participantA: Hex, participantB: Hex): Promise<string> {
    // Ensure we're authenticated before creating an app session
    if (!isAuthenticated) {
        try {
            await authenticateWithBroker();
        } catch (error) {
            console.error(`Authentication failed before creating app session: ${error.message}`);
            throw new Error(`Authentication required to create app session: ${error.message}`);
        }
    }

    // Get the server's wallet address
    const signer = createEthersSigner(WALLET_PRIVATE_KEY);
    if (!signer.address) {
        throw new Error("Server wallet address not found");
    }

    // Prepare the request object

    // const requestId = Date.now();
    // const method = "create_app_session";
    // const intents = [Number(allocations[0]), Number(allocations[1]), 0];
    // const reqParams = [{
    //   definition: {
    //     protocol: "nitroliterpc",
    //     participants: participants.map(p => p as Hex),
    //     weights: [0, 0, 100], // Alice: 0, Bob: 0, Server: 100
    //     quorum: 100,
    //     challenge: 0,
    //     nonce: Date.now(),
    //   },
    //   token: CONTRACT_ADDRESSES.tokenAddress as Hex,
    //   allocations: intents
    // }];
    // const timestamp = Math.floor(Date.now() / 1000);
    // console.log({ requestId, method, reqParams: reqParams[0], timestamp, participants: reqParams[0].definition.participants });
    const participants = [participantA, participantB, signer.address as Hex];
    const initialIntent = [BigInt(0), BigInt(0), BigInt(0)];
    console.log("signer", signer);
    console.log("Participants", participants);
    console.log("Initial intent", initialIntent);

    const appDefinition: AppDefinition = {
        protocol: DEFAULT_PROTOCOL,
        participants,
        weights: DEFAULT_WEIGHTS,
        quorum: DEFAULT_QUORUM,
        challenge: 0,
        nonce: Date.now(),
    };

    const signedMessage = await createAppSessionMessage(
        signer.sign,
        [
            {
                definition: appDefinition,
                token: CONTRACT_ADDRESSES.tokenAddress as Hex,
                allocations: initialIntent,
            },
        ],
        initialIntent
    );
    console.log("Signed message", signedMessage);

    // Create request data - we'll sign it in sendToBroker
    // const request = {
    //   req: [requestId, method, reqParams, timestamp],
    //   sig: [""], // Will be filled in by sendToBroker
    //   int: intents
    // };

    const result = await sendToBroker(signedMessage);
    const appId = result.app_id || (typeof result[0] === "object" ? result[0].app_id : null);
    console.log(`Created app session ${appId}`);
    return appId;
}

// Closes an application session in the broker
export async function closeAppSession(appId: string, channelId: string, finalState: any, allocations: number[]): Promise<boolean> {
    // Ensure we're authenticated before closing an app session
    if (!isAuthenticated) {
        try {
            await authenticateWithBroker();
        } catch (error) {
            console.error(`Authentication failed before closing app session: ${error.message}`);
            return false;
        }
    }

    // Prepare the request object
    const requestId = Date.now();
    const method = "close_app_session";
    const reqParams = [
        {
            app_id: appId,
            channel_id: channelId,
            allocations: allocations,
            final_state: JSON.stringify(finalState),
        },
    ];
    const timestamp = Math.floor(Date.now() / 1000);

    // Create request data - we'll sign it in sendToBroker
    const request = {
        req: [requestId, method, reqParams, timestamp],
        sig: [""], // Will be filled in by sendToBroker
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

// Helper function to sign state data with the server's private key
export async function signStateData(stateData: string): Promise<{ signature: string; address: Hex }> {
    const signer = createEthersSigner(WALLET_PRIVATE_KEY);
    return {
        signature: await signer.sign(stateData as unknown as RequestData),
        address: signer.address as Hex,
    };
}

/**
 * Interface for a wallet signer that can sign messages
 */
export interface WalletSigner {
    /** Public key in hexadecimal format */
    publicKey: string;
    /** Optional Ethereum address derived from the public key */
    address?: Hex;
    /** Function to sign a message and return a hex signature */
    sign: MessageSigner;
}

/**
 * Creates a signer from a private key using ethers.js
 *
 * @param privateKey - The private key to create the signer from
 * @returns A WalletSigner object that can sign messages
 * @throws Error if signer creation fails
 */
export function createEthersSigner(privateKey: string): WalletSigner {
    try {
        // Create ethers wallet from private key
        const wallet = new ethers.Wallet(privateKey);
        return {
            publicKey: wallet.publicKey,
            address: wallet.address as Hex,
            sign: async (payload: RequestData | ResponsePayload): Promise<Hex> => {
                try {
                    const messageBytes = ethers.utils.arrayify(ethers.utils.id(JSON.stringify(payload)));
                    const flatSignature = wallet._signingKey().signDigest(messageBytes);
                    const signature = ethers.utils.joinSignature(flatSignature);
                    return signature as Hex;
                } catch (error) {
                    console.error("Error signing message:", error);
                    throw error;
                }
            },
        };
    } catch (error) {
        console.error("Error creating ethers signer:", error);
        throw error;
    }
}

// Helper function to sign RPC request data for the broker
export async function signRpcRequest(requestData: any[]): Promise<string> {
    const signer = createEthersSigner(WALLET_PRIVATE_KEY);
    return signer.sign(requestData as RequestData);
}

// Verify a signature against a message and expected signer
export function verifySignature(message: string, signature: string, expectedAddress: string): boolean {
    try {
        // Use standard Ethereum message verification
        const recoveredAddress = ethers.verifyMessage(message, signature);

        // Check if the recovered address matches the expected address
        return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
        console.error("Error verifying signature:", error);
        return false;
    }
}

// Sign and send game state updates
export async function updateAppState(appId: string, channelId: string, newState: any, stateVersion: number): Promise<boolean> {
    // Ensure we're authenticated
    if (!isAuthenticated) {
        try {
            await authenticateWithBroker();
        } catch (error) {
            console.error(`Authentication failed before updating app state: ${error.message}`);
            return false;
        }
    }

    try {
        // Convert state to string
        const stateString = JSON.stringify(newState);

        // Sign the state data
        const { signature, address } = await signStateData(stateString);

        // Prepare the request object
        const requestId = Date.now();
        const method = "update_app_state";
        const reqParams = [
            {
                app_id: appId,
                channel_id: channelId,
                state: stateString,
                signature, // The signature of the state
                signer: address,
                state_version: stateVersion,
            },
        ];
        const timestamp = Math.floor(Date.now() / 1000);

        // Create request data - we'll let sendToBroker sign it
        const request = {
            req: [requestId, method, reqParams, timestamp],
            sig: [signature], // Initially use the state signature, sendToBroker will replace if needed
        };

        // Send the update request
        await sendToBroker(request);
        console.log(`Updated app state for ${appId} in channel ${channelId}`);
        return true;
    } catch (error) {
        console.error(`Error updating app state: ${error}`);
        return false;
    }
}

// Get channel information from the broker
export async function getChannelInfo(channelId: string): Promise<any> {
    try {
        // Prepare the request object
        const requestId = Date.now();
        const method = "get_channel_info";
        const reqParams = [
            {
                channel_id: channelId,
            },
        ];
        const timestamp = Math.floor(Date.now() / 1000);

        // Create request data - we'll let sendToBroker sign it
        const request = {
            req: [requestId, method, reqParams, timestamp],
            sig: [""], // Will be signed by sendToBroker
        };

        const result = await sendToBroker(request);
        return result;
    } catch (error) {
        console.error(`Error getting channel info: ${error}`);
        return null;
    }
}
