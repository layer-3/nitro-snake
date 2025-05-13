import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getAllRooms, getBrokerWebSocket } from '../services/stateService';
import { closeAppSession } from '../services/brokerService';

// Handle graceful shutdown of the server
export async function gracefulShutdown(server: Server, wss: WebSocketServer, signal: string = 'SIGTERM'): Promise<void> {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  // Close all WebSocket connections
  console.log('Closing WebSocket connections...');
  wss.clients.forEach(client => {
    client.close(1000, 'Server shutting down');
  });
  
  // Close app sessions for all active rooms
  console.log('Closing app sessions...');
  const closePromises: Promise<boolean>[] = [];
  const rooms = getAllRooms();
  
  for (const room of rooms.values()) {
    // Skip if no app session or not game over
    if (!room.appId || room.channelIds.size === 0) continue;
    
    // Mark all rooms as game over
    room.isGameOver = true;
    
    // Get the first channel ID (there should only be one in this new design)
    const channelId = Array.from(room.channelIds)[0];
    
    // Get the final allocations (equal split for server shutdown)
    const players = Array.from(room.players.values());
    const allocations = players.length > 0 ? [100 / players.length, 100 / players.length] : [50, 50];
    
    const finalState = {
      roomId: room.id,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        isDead: p.isDead || false
      })),
      isGameOver: true,
      finalizedAt: Date.now(),
      reason: 'server_shutdown'
    };
    
    closePromises.push(closeAppSession(room.appId, channelId, finalState, allocations));
  }
  
  try {
    // Wait for all app sessions to be closed
    if (closePromises.length > 0) {
      console.log(`Closing ${closePromises.length} app sessions...`);
      await Promise.all(closePromises);
      console.log('All app sessions closed successfully');
    } else {
      console.log('No active app sessions to close');
    }
  } catch (error) {
    console.error('Error closing app sessions:', error);
  }
  
  // Close broker connection
  const brokerWs = getBrokerWebSocket();
  if (brokerWs) {
    console.log('Closing broker connection...');
    brokerWs.close();
  }
  
  // Close the HTTP server
  console.log('Closing HTTP server...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  
  // If server doesn't close in 5 seconds, force exit
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 5000);
}