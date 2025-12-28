# Multiplayer System Guide

This document describes how the multiplayer room system works and how to integrate it into new games.

## Overview

The multiplayer system uses a combination of:
- **REST API** for room creation and management
- **Socket.IO** for real-time communication and game state synchronization
- **SQLite Database** for persistent room and player data
- **React State Management** for UI synchronization

## Architecture

### Components

1. **RoomManager** (`src/components/RoomManager.jsx`)
   - Handles room creation, joining, and management UI
   - Manages Socket.IO connections
   - Displays player list and host controls

2. **App.jsx** (`src/App.jsx`)
   - Orchestrates room state management
   - Routes between menu, room manager, and games
   - Persists room state to localStorage

3. **Server** (`server/index.js`)
   - Express REST API for room operations
   - Socket.IO server for real-time events
   - Database helpers for persistence

### Database Schema

**Rooms Table:**
- `id` (TEXT PRIMARY KEY) - 6-digit room ID
- `created_at` (DATETIME) - Room creation timestamp
- `state` (TEXT) - 'waiting', 'playing', 'ended'
- `last_activity` (DATETIME) - Last activity timestamp
- `host_user_profile_id` (TEXT) - Profile ID of the room host (persistent)

**Players Table:**
- `id` (TEXT PRIMARY KEY) - Socket ID
- `room_id` (TEXT) - Room ID
- `socket_id` (TEXT) - Socket ID (same as id)
- `name` (TEXT) - Player name
- `user_profile_id` (TEXT) - User profile ID
- `color_id` (INTEGER) - Player color ID
- `score` (INTEGER) - Player score
- `joined_at` (DATETIME) - Join timestamp
- `left_at` (DATETIME) - Leave timestamp (NULL if active)

**User Profiles Table:**
- `id` (TEXT PRIMARY KEY) - Profile ID
- `name` (TEXT) - Profile name
- `color_id` (INTEGER) - Color ID
- `created_at` (DATETIME) - Creation timestamp
- `last_seen` (DATETIME) - Last seen timestamp

## REST API Endpoints

### Create Room
```
POST /api/rooms/create
Body: {
  playerName: string,
  userProfileId: string,
  colorId: number
}
Response: {
  success: true,
  roomId: string,
  hostUserProfileId: string,
  playerName: string,
  color: string,
  emoji: string
}
```

### Get Active Rooms
```
GET /api/rooms/active
Response: Array<{
  id: string,
  playerCount: number,
  maxPlayers: number,
  state: 'waiting' | 'playing',
  lastActivity: string
}>
```

### Get Room Details
```
GET /api/rooms/:roomId
Response: {
  id: string,
  state: string,
  created_at: string,
  last_activity: string,
  host_user_profile_id: string
}
```

### Get Room Players
```
GET /api/rooms/:roomId/players
Response: Array<{
  id: string,
  name: string,
  score: number,
  color: string,
  emoji: string,
  user_profile_id: string,
  joined_at: string,
  left_at: string | null
}>
```

### Close Room (Admin/Host Only)
```
POST /api/admin/close-room/:roomId
Body: {
  userProfileId: string
}
Response: {
  success: true,
  message: string
}
```

## Socket.IO Events

### Client → Server Events

**create-room**
```javascript
socket.emit('create-room', {
  playerName: string,
  userProfileId: string,
  colorId: number
})
```
Creates a new room. Legacy method - prefer REST API.

**join-room**
```javascript
socket.emit('join-room', {
  roomId: string,
  playerName: string,
  userProfileId: string,
  colorId: number
})
```
Joins an existing room.

**leave-room**
```javascript
socket.emit('leave-room', {
  roomId: string
})
```
Leaves the current room.

**get-room-players**
```javascript
socket.emit('get-room-players', {
  roomId: string
})
```
Requests current player list.

**game-state-update** (Host only)
```javascript
socket.emit('game-state-update', {
  roomId: string,
  gameState: object
})
```
Updates game state. Only host can emit this.

### Server → Client Events

**room-created**
```javascript
socket.on('room-created', ({ roomId, players }) => {
  // Room was created successfully
})
```

**player-joined**
```javascript
socket.on('player-joined', ({ players, gameState, isHost }) => {
  // A player joined (including yourself)
  // isHost: boolean - whether the joining player is the host
})
```

**player-left**
```javascript
socket.on('player-left', ({ playerId, players }) => {
  // A player left the room
})
```

**room-closed**
```javascript
socket.on('room-closed', ({ reason, message }) => {
  // Room was closed by host or admin
})
```

**room-closed-broadcast**
```javascript
socket.on('room-closed-broadcast', ({ roomId, reason, message }) => {
  // Broadcast version - check roomId matches your room
})
```

**host-disconnected**
```javascript
socket.on('host-disconnected', ({ message, reconnectTimeout }) => {
  // Host disconnected (room stays open for reconnection)
})
```

**host-reconnected**
```javascript
socket.on('host-reconnected', ({ message }) => {
  // Host reconnected
})
```

**room-list-updated**
```javascript
socket.on('room-list-updated', ({ roomId, action, room }) => {
  // Room list changed (created, updated, deleted)
})
```

**room-error**
```javascript
socket.on('room-error', ({ message }) => {
  // Error occurred (e.g., permission denied)
})
```

## Host vs Player Roles

### Host Responsibilities
- **Room Creation**: Only the creator becomes the host
- **Game Control**: Only host can start games and update game state
- **Room Management**: Only host can close the room
- **Persistence**: Host status is tied to `userProfileId`, not socket ID
  - Host can refresh/reconnect and maintain host status
  - Room stays open if host disconnects (allows reconnection)

### Host Identification
- Host is identified by `host_user_profile_id` in the database
- When a player joins, server checks if their `userProfileId` matches `host_user_profile_id`
- Server sends `isHost: true` in `player-joined` event if player is host

### Host Controls
Host-only UI elements:
- "Start Game" button (customize per game)
- "Close Room" button
- Host indicator in player list

## Room Lifecycle

1. **Creation**
   - User clicks "Create Room" → REST API creates room → Returns `roomId`
   - Frontend updates state with `roomId` and `isHost: true`
   - Socket.IO connects and joins the room
   - Server adds player to room and emits `player-joined`

2. **Joining**
   - User selects room from list or enters room ID
   - Socket.IO connects and emits `join-room`
   - Server checks if room exists and has space
   - Server adds player and emits `player-joined` to all players

3. **Playing**
   - Host starts game (game-specific logic)
   - Host emits `game-state-update` events
   - All players receive updates via Socket.IO
   - Game state synchronized in real-time

4. **Leaving**
   - Player clicks "Leave Room" or closes tab
   - Socket.IO emits `leave-room` or disconnects
   - Server removes player and notifies others
   - Room closes if all players leave

5. **Closing**
   - Host clicks "Close Room" → Calls admin endpoint
   - Server notifies all players via `room-closed` event
   - All players removed from room
   - Room state set to 'ended'

## State Management

### Room State (App.jsx)
```javascript
roomState = {
  roomId: string,
  isHost: boolean,
  inRoom: boolean,
  players: Array<Player>,
  playerCount: number,
  maxPlayers: number,
  showRoomManager: boolean
}
```

### Persistence
- Room state saved to `localStorage` via `saveRoomState()`
- On page load, checks for saved room state
- Verifies room still exists and user is still in it
- Auto-rejoins if valid

### URL Parameters
- Room ID stored in URL: `?room=123456`
- Allows sharing room links
- Auto-join on page load if room ID in URL

## Integrating Multiplayer into a New Game

### 1. Component Setup
```javascript
import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

function YourGame({ roomId, isHost, players, profile }) {
  const socketRef = useRef(null)
  const [gameState, setGameState] = useState(initialState)
  
  // Initialize Socket.IO
  useEffect(() => {
    if (!roomId) return
    
    const socket = io(`http://${window.location.hostname}:8000`)
    socketRef.current = socket
    
    socket.on('connect', () => {
      // Socket connected
    })
    
    // Listen for game state updates (from host)
    socket.on('game-state-update', ({ gameState: newState }) => {
      if (!isHost) {
        setGameState(newState)
      }
    })
    
    return () => {
      socket.disconnect()
    }
  }, [roomId, isHost])
  
  // Host: Update game state
  const updateGameState = (newState) => {
    if (!isHost) return
    
    setGameState(newState)
    socketRef.current.emit('game-state-update', {
      roomId,
      gameState: newState
    })
  }
  
  // ... your game logic
}
```

### 2. Host-Only Actions
```javascript
// Only host can start the game
const handleStartGame = () => {
  if (!isHost) {
    console.warn('Only host can start the game')
    return
  }
  
  // Start game logic
  updateGameState({ state: 'playing' })
}
```

### 3. Player Synchronization
```javascript
// Host sends updates to all players
const handlePlayerAction = (action) => {
  if (isHost) {
    // Update local state
    const newState = processAction(action)
    setGameState(newState)
    
    // Broadcast to all players
    socketRef.current.emit('game-state-update', {
      roomId,
      gameState: newState
    })
  } else {
    // Non-host players send actions to host
    socketRef.current.emit('player-action', {
      roomId,
      action,
      playerId: profile.id
    })
  }
}
```

### 4. Add to App.jsx
```javascript
// In handleSelectGame
if (game === 'yourgame') {
  if (!roomState?.inRoom || !roomState?.roomId) {
    // Not in a room - show room manager
    onRoomStateChange({ action: 'show' })
    return
  }
  
  // Start game with multiplayer props
  setMultiplayerMode({
    roomId: roomState.roomId,
    isHost: roomState.isHost,
    profile: selectedProfile,
    gameType: 'yourgame',
    players: roomState.players
  })
}

// In render
{multiplayerMode?.gameType === 'yourgame' ? (
  <YourGame
    roomId={multiplayerMode.roomId}
    isHost={multiplayerMode.isHost}
    players={multiplayerMode.players}
    profile={multiplayerMode.profile}
    onBack={handleLeaveRoom}
  />
) : ...}
```

### 5. Add Start Button to RoomManager
```javascript
// In RoomManager.jsx, add your game's start button
{isHost && players.length > 1 && (
  <button
    onClick={() => {
      if (onStartYourGame && roomId) {
        onStartYourGame(roomId, isHost, players)
      }
    }}
    className="..."
  >
    START YOUR GAME
  </button>
)}
```

## Best Practices

1. **Host Authority**: Always validate host actions on the server
2. **State Synchronization**: Host is authoritative - players receive updates
3. **Error Handling**: Listen for `room-error` events and handle gracefully
4. **Reconnection**: Handle socket disconnects and reconnections
5. **Room Closure**: Listen for `room-closed` events and exit gracefully
6. **Player Count**: Check `players.length` before starting games
7. **Profile Management**: Always use `userProfileId` for persistent identification

## Common Patterns

### Starting a Game
```javascript
// Host clicks "Start Game"
const handleStart = () => {
  if (!isHost) return
  
  socket.emit('game-start', {
    roomId,
    gameType: 'yourgame'
  })
  
  // Update local state
  setGameState({ state: 'playing' })
}
```

### Broadcasting Updates
```javascript
// Host broadcasts game state
const broadcastUpdate = (update) => {
  if (!isHost) return
  
  socket.emit('game-state-update', {
    roomId,
    gameState: { ...gameState, ...update }
  })
}
```

### Handling Player Actions
```javascript
// Non-host players send actions to host
socket.on('player-action', ({ action, playerId }) => {
  if (isHost) {
    // Process action and broadcast result
    const result = processAction(action)
    broadcastUpdate(result)
  }
})
```

## Troubleshooting

### Room not creating
- Check REST API endpoint is accessible
- Verify profile is selected
- Check browser console for errors

### Not joining room
- Verify socket is connecting
- Check `roomId` is set correctly
- Ensure room exists and has space

### Host controls not showing
- Verify `isHost` is `true` in state
- Check server is sending `isHost: true` in `player-joined`
- Ensure `propIsHost` is passed correctly

### Players not syncing
- Verify host is emitting `game-state-update`
- Check all players are listening for updates
- Ensure socket is connected

### Room closes unexpectedly
- Check if host disconnected (room should stay open)
- Verify room closure logic
- Check for errors in server logs

## Server Configuration

### Ports
- Frontend: `3000`
- Backend: `8000`

### Database
- SQLite database: `server/game.db`
- Auto-migrates on server start
- Tables: `rooms`, `players`, `user_profiles`, `game_history`

### Socket.IO
- CORS enabled for all origins (development)
- Supports reconnection
- Room-based message routing

## Security Considerations

1. **Host Validation**: Server validates host actions by `userProfileId`
2. **Room Access**: Server checks room exists and has space before joining
3. **Player Limits**: Maximum 4 players per room
4. **State Validation**: Server can validate game state updates if needed

## Future Enhancements

- Private rooms with passwords
- Spectator mode
- Room persistence across server restarts
- Replay system using game history
- Custom room settings (max players, game modes)

