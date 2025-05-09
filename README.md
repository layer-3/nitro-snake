# Nitro-Snake

An online two-player snake game built with Vue and WebSocket.

## Features

- Realtime multiplayer gameplay with WebSocket
- Random SHA256 room ID generation for private games
- Interactive lobby to create or join games
- Player nicknames and scores
- Collision detection and game physics
- Clean, responsive UI

## Stack

- Vue 3 + TypeScript + Vite
- WebSocket for realtime communication
- Canvas-based game rendering

## How to Play

1. Enter your nickname
2. Create a new game room or join an existing one with a room ID
3. Share the room ID with your friend
4. Use arrow keys or WASD to control your snake
5. Eat food to grow your snake and earn points
6. Avoid collisions with other snakes and their tails

## Game Rules

- Each player controls a snake in the game area
- Eat food to grow your snake and earn points
- If you collide with another snake or their tail, your snake will reset and you'll lose points
- The game continues until players decide to leave

## Running Locally

```bash
# Install dependencies
npm install

# Start the WebSocket server
npm run server

# In another terminal, start the frontend
npm run dev
```

Visit `http://localhost:5173` in your browser to play the game.

## Communication Flow

1. First player creates a room with a random SHA256 string
2. Second player joins the room using the same ID
3. When both players are connected, the game starts
4. Players control their snakes using keyboard inputs
5. Game state is synchronized between all clients in real-time