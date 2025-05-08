import fastify from 'fastify';
import { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

// Custom SocketStream interface to match the websocket structure
interface SocketStream {
  socket: WebSocket;
}

// Types for the WebSocket server
interface Room {
  id: string;
  clients: Map<string, {
    connection: SocketStream;
    name: string;
  }>;
  gameState: any;
}

// Server state
const rooms = new Map<string, Room>();
const gameService = new Map<string, SocketStream>();

// Create Fastify server
const server: FastifyInstance = fastify({
  logger: true
});

// Register WebSocket plugin
server.register(fastifyWebsocket);

// Setup route for WebSocket connections
server.register(async function (fastify) {
  fastify.get('/', { websocket: true }, (socket, req) => {
    // Generate a unique client ID
    const clientId = randomUUID();
    
    // Set up message handling
    socket.on('message', (message) => {
      handleMessage(message.toString(), clientId, { socket });
    });
    
    // Handle connection close
    socket.on('close', () => {
      handleClientDisconnect(clientId);
    });
    
    // Send welcome message
    sendToClient({ socket }, {
      type: 'welcome',
      clientId
    });
  });
});

// Handle incoming messages
function handleMessage(messageStr: string, clientId: string, connection: SocketStream) {
  try {
    const message = JSON.parse(messageStr);
    
    switch (message.type) {
      case 'createRoom':
        handleCreateRoom(message, clientId, connection);
        break;
        
      case 'joinRoom':
        handleJoinRoom(message, clientId, connection);
        break;
        
      case 'leaveRoom':
        handleLeaveRoom(message, clientId);
        break;
        
      case 'gameCommand':
        handleGameCommand(message, clientId);
        break;
        
      default:
        server.log.warn(`Unknown message type: ${message.type}`);
    }
  } catch (error) {
    server.log.error(`Error handling message: ${error}`);
  }
}

// Handle room creation
function handleCreateRoom(message: any, clientId: string, connection: SocketStream) {
  const { roomId, playerName } = message;
  
  // Check if room already exists
  if (rooms.has(roomId)) {
    sendToClient(connection, {
      type: 'error',
      message: 'Room already exists'
    });
    return;
  }
  
  // Create new room
  const room: Room = {
    id: roomId,
    clients: new Map(),
    gameState: null
  };
  
  // Add client to room
  room.clients.set(clientId, {
    connection,
    name: playerName
  });
  
  // Store room
  rooms.set(roomId, room);
  
  // Let client know room was created
  sendToClient(connection, {
    type: 'roomCreated',
    roomId,
    clientId
  });
  
  // Register the game service for this room
  registerGameService(roomId);
  
  server.log.info(`Room created: ${roomId} by ${playerName} (${clientId})`);
}

// Handle client joining a room
function handleJoinRoom(message: any, clientId: string, connection: SocketStream) {
  const { roomId, playerName } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) {
    sendToClient(connection, {
      type: 'error',
      message: 'Room does not exist'
    });
    return;
  }
  
  const room = rooms.get(roomId)!;
  
  // Add client to room
  room.clients.set(clientId, {
    connection,
    name: playerName
  });
  
  // Let client know they joined the room
  sendToClient(connection, {
    type: 'roomJoined',
    roomId,
    clientId
  });
  
  // Notify all clients in the room
  broadcastToRoom(room, {
    type: 'playerJoin',
    playerId: playerName,
    playerCount: room.clients.size
  });
  
  server.log.info(`Client joined: ${playerName} (${clientId}) joined room ${roomId}`);
  
  // If there are 2 players, start the game
  if (room.clients.size === 2) {
    // Calculate start time (5 seconds from now)
    const startTimestamp = Date.now() + 5000;
    
    broadcastToRoom(room, {
      type: 'gameStart',
      startTimestamp
    });
    
    server.log.info(`Starting game in room ${roomId}`);
  }
}

// Handle client leaving a room
function handleLeaveRoom(message: any, clientId: string) {
  const { roomId } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) {
    return;
  }
  
  const room = rooms.get(roomId)!;
  
  // Check if client is in room
  if (!room.clients.has(clientId)) {
    return;
  }
  
  const playerName = room.clients.get(clientId)!.name;
  
  // Remove client from room
  room.clients.delete(clientId);
  
  // Notify all clients in the room
  broadcastToRoom(room, {
    type: 'playerLeave',
    playerId: playerName,
    playerCount: room.clients.size
  });
  
  server.log.info(`Client left: ${playerName} (${clientId}) left room ${roomId}`);
  
  // If room is empty, remove it
  if (room.clients.size === 0) {
    rooms.delete(roomId);
    server.log.info(`Room removed: ${roomId}`);
  }
}

// Handle game commands
function handleGameCommand(message: any, clientId: string) {
  const { roomId, command } = message;
  
  // Check if room exists
  if (!rooms.has(roomId)) {
    return;
  }
  
  const room = rooms.get(roomId)!;
  
  // Check if client is in room
  if (!room.clients.has(clientId)) {
    return;
  }
  
  // Broadcast the command to all clients in the room, including the game service
  broadcastToRoom(room, {
    type: 'gameCommand',
    command
  });
}

// Handle client disconnect
function handleClientDisconnect(clientId: string) {
  // Find rooms that client is in
  for (const [roomId, room] of rooms.entries()) {
    if (room.clients.has(clientId)) {
      const playerName = room.clients.get(clientId)!.name;
      
      // Remove client from room
      room.clients.delete(clientId);
      
      // Notify all clients in the room
      broadcastToRoom(room, {
        type: 'playerLeave',
        playerId: playerName,
        playerCount: room.clients.size
      });
      
      server.log.info(`Client disconnected: ${playerName} (${clientId}) from room ${roomId}`);
      
      // If room is empty, remove it
      if (room.clients.size === 0) {
        rooms.delete(roomId);
        server.log.info(`Room removed: ${roomId}`);
      }
    }
  }
}

// Send a message to a specific client
function sendToClient(connection: SocketStream, message: any) {
  connection.socket.send(JSON.stringify(message));
}

// Broadcast a message to all clients in a room
function broadcastToRoom(room: Room, message: any) {
  for (const client of room.clients.values()) {
    sendToClient(client.connection, message);
  }
  
  // Also send to game service if registered
  if (gameService.has(room.id)) {
    sendToClient(gameService.get(room.id)!, message);
  }
}

// Register the game service for a room
function registerGameService(roomId: string) {
  // In a real implementation, this would create a connection
  // to the game service. For now, we'll simulate it.
  server.log.info(`Game service registered for room ${roomId}`);
}

// Start the server
const start = async () => {
  try {
    await server.listen({ port: 3000, host: '0.0.0.0' });
    server.log.info(`WebSocket server running on port 3000`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

export default server;