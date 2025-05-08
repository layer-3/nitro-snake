# Nitro-Snake

A web client, with websocket pubsub snake game for 2 players games.
The application is using 3 components:

- The Vue frontend for snake
- A micro WebSocket service with pubsub per roomId (rooms are identified by a SHA256)
- A snake game service websocket client which syncronise and enforce game rules.

## Communication flow

- First web client create a websocket room with a random SHA256 string (topic)
- The second web client join the room with the same id
- The snake-service automatically join the same room
- When both participant are connected, the snake-service start the game by pushing the start game timestamp (5 second from server time)
- Participant move their snake using json-rpc commands published in the websocket topic
- Clients and game-service consume the message to reflect snakes positions
- At every iteration, a dot will be drawn randomly on the map so one of the snake can eat it to earn point but also grow in length
- If one of the snake hit a wall or the tail of a snake, he loose the game.
- Server announce the outcome of the game.

## Stack

- Vue 3 + TypeScript + Vite
- Fastify (fastify.dev) for websocket pubsub server

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).
