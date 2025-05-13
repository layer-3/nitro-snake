import { Express } from 'express';
import { ethers } from 'ethers';
import { randomBytes } from 'crypto';
import { SERVER_PRIVATE_KEY, CONTRACT_ADDRESSES } from '../config';
import { getRoom, getAllRooms } from '../services/stateService';
import { clearNetRPC } from '../services/gameService';

// Setup API routes for the Express app
export function setupApiRoutes(app: Express): void {
  // Contract addresses endpoint
  app.get('/api/contract-addresses', (req, res) => {
    const wallet = new ethers.Wallet(SERVER_PRIVATE_KEY);
    res.json({
      custody: CONTRACT_ADDRESSES.custody,
      adjudicator: CONTRACT_ADDRESSES.adjudicator,
      guestAddress: CONTRACT_ADDRESSES.guestAddress, 
      tokenAddress: CONTRACT_ADDRESSES.tokenAddress,
      serverAddress: wallet.address // Return the server's Ethereum address
    });
  });

  // Get active rooms
  app.get('/api/rooms', (req, res) => {
    const activeRooms = Array.from(getAllRooms().entries())
      .filter(([_, room]) => room.players.size < 2) // Only return rooms that aren't full
      .map(([id, room]) => ({
        id,
        playerCount: room.players.size,
        createdAt: room.createdAt
      }));
    
    res.json(activeRooms);
  });

  // Get room details
  app.get('/api/rooms/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json({
      id: roomId,
      playerCount: room.players.size,
      isGameOver: room.isGameOver || false,
      channelIds: Array.from(room.channelIds),
      createdAt: room.createdAt
    });
  });

  // Room channel endpoint
  app.get('/api/rooms/:roomId/channel', (req, res) => {
    const roomId = req.params.roomId;
    const room = getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Get the first channelId in the room
    const channelIds = Array.from(room.channelIds);
    if (channelIds.length === 0) {
      return res.status(404).json({ error: 'No channel found for this room' });
    }
    
    res.json({
      channelId: channelIds[0],
      roomId
    });
  });

  // Game sessions endpoint
  app.post('/api/game-sessions', async (req, res) => {
    const { channelId, initialState } = req.body;
    
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }
    
    try {
      // Check if channel exists in any room
      let foundRoom = null;
      for (const room of getAllRooms().values()) {
        if (room.channelIds.has(channelId)) {
          foundRoom = room;
          break;
        }
      }
      
      if (!foundRoom) {
        return res.status(404).json({ error: 'Channel not found in any active room' });
      }
      
      // Create a session ID
      const sessionId = `session_${randomBytes(8).toString('hex')}`;
      
      // Get channel info from ClearNet RPC
      const channelInfo = await clearNetRPC.getChannelInfo(channelId);
      
      res.json({
        sessionId,
        channelId,
        channelInfo
      });
    } catch (error) {
      console.error('Error creating game session:', error);
      res.status(500).json({ error: 'Failed to create game session' });
    }
  });

  // Get game session channel state
  app.get('/api/game-sessions/:sessionId/state', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
      // In a real implementation, we would look up the session by ID
      // For now, extract the channelId from the sessionId format (session_<random>)
      const channelId = req.query.channelId as string;
      
      if (!channelId) {
        return res.status(400).json({ error: 'Channel ID is required as a query parameter' });
      }
      
      // Get channel info from ClearNet RPC
      const channelInfo = await clearNetRPC.getChannelInfo(channelId);
      
      if (!channelInfo) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      
      // Find the associated room
      let foundRoom = null;
      for (const room of getAllRooms().values()) {
        if (room.channelIds.has(channelId)) {
          foundRoom = room;
          break;
        }
      }
      
      if (!foundRoom) {
        return res.status(404).json({ error: 'Room not found for this channel' });
      }
      
      // Return the current state
      res.json({
        sessionId,
        channelId,
        roomId: foundRoom.id,
        state: foundRoom.currentState,
        isGameOver: foundRoom.isGameOver || false,
        stateVersion: foundRoom.stateVersion,
        players: Array.from(foundRoom.players.values()).map(p => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          isDead: p.isDead || false
        }))
      });
    } catch (error) {
      console.error('Error getting game session state:', error);
      res.status(500).json({ error: 'Failed to get game session state' });
    }
  });
}