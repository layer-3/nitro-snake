# Nitro-Snake

An online two-player snake game built with Vue and WebSocket, featuring state channels integration for secure, off-chain gameplay payments.

## Features

- Realtime multiplayer gameplay with WebSocket
- Random SHA256 room ID generation for private games
- Interactive lobby to create or join games
- Player nicknames and scores
- Collision detection and game physics
- Clean, responsive UI
- ClearNet RPC integration for state channels
- Secure payment handling through state channels
- Real-time state signing and submission
- Automated channel finalization on game over

## Stack

- Vue 3 + TypeScript + Vite
- Node.js + Express for backend API
- WebSocket for realtime communication
- Canvas-based game rendering
- @erc7824/nitrolite for state channel management
- Ethereum wallet integration

## How to Play

1. Connect your wallet to the game
2. Enter your nickname
3. Create or join a payment channel with your deposit
4. Create a new game room or join an existing one with a room ID
5. Share the room ID with your friend
6. Use arrow keys or WASD to control your snake
7. Eat food to grow your snake and earn points
8. Avoid collisions with your own tail or the other player's snake
9. When the game is over, the winner gets a larger share of the deposited funds
10. Withdraw your funds back to your wallet

## Game Rules

- Each player controls a snake in the game area
- Eat food to grow your snake and earn points
- If you collide with another snake, your own tail, or the other player's snake, your snake dies
- Game ends when only one player is left alive or all players are dead
- The player with the highest score wins
- The winner receives 90% of the total channel funds, loser receives the remaining 10%

## Running Locally

```bash
# Install dependencies
npm install

# Set up environment variables (create .env file)
echo "CLEARNET_RPC_URL=https://api.clearnet.dev/rpc
CLEARNET_API_KEY=your_api_key
PORT=3001" > .env

# Start the WebSocket server
npm run server

# In another terminal, start the frontend
npm run dev
```

Visit `http://localhost:5173` in your browser to play the game.

## Environment Variables

- `CLEARNET_RPC_URL`: URL for the ClearNet RPC service
- `CLEARNET_API_KEY`: API key for accessing the ClearNet RPC
- `PORT`: Port number for the WebSocket server
- `CUSTODY_ADDRESS`: Address of the custody contract (optional)
- `ADJUDICATOR_ADDRESS`: Address of the adjudicator contract (optional)
- `GUEST_ADDRESS`: Address of the guest wallet (optional)
- `TOKEN_ADDRESS`: Address of the token contract (optional)

## Communication Flow

1. Player connects their wallet and creates a state channel with a deposit
2. First player creates a room with a random SHA256 string
3. Second player joins the room using the same ID and creates/joins the channel
4. When both players are connected, the game starts
5. Players control their snakes using keyboard inputs
6. Game state is synchronized between all clients in real-time
7. State updates are signed by both participants and submitted to the ClearNet RPC
8. When the game ends, the final state is submitted and the channel is finalized
9. Funds are distributed according to the game outcome
10. Players can withdraw their funds back to their wallets

## State Channel Integration

The game uses ClearNet state channels for:

1. **Secure payments**: Players deposit funds when creating or joining a channel
2. **Real-time state updates**: Game state is signed by all participants
3. **Off-chain transactions**: All gameplay happens off-chain for better performance
4. **Verifiable outcomes**: Game results are cryptographically secured
5. **Fair fund distribution**: Funds are distributed based on game outcome
6. **Watchtower integration**: Third-party service monitors channel state for security

## API Endpoints

- `/api/contract-addresses` - Get contract addresses for channel setup
- `/api/channels` - Get channels for a wallet address
- `/api/channels/:channelId` - Get details for a specific channel
- `/api/rooms/:roomId/channel` - Get channel info for a specific room
- `/api/game-sessions` - Create a new game session
- `/api/game-sessions/:sessionId/state` - Get the state of a game session