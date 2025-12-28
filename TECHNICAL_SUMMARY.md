# Technical Summary - Multiplayer Arcade Project

## 1. Project Structure

```
Multiplayer Arcade/
├── server/
│   ├── api/
│   │   ├── debug-logs.js
│   │   └── game-state.js
│   ├── db.js
│   ├── index.js
│   ├── multiplayer-arcade.db
│   ├── multiplayer-arcade.db.backup
│   ├── package.json
│   └── README.md
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   ├── components/
│   │   ├── ActiveProfilesManager.jsx
│   │   ├── Collaboration.jsx
│   │   ├── ConfirmationDialog.jsx
│   │   ├── CrashBandicoot.jsx
│   │   ├── ErrorLogger.jsx
│   │   ├── Game.jsx
│   │   ├── GrandTheftAuto.jsx
│   │   ├── Menu.jsx
│   │   ├── MobileController.jsx
│   │   ├── MultiplayerGame.jsx
│   │   ├── Notification.jsx
│   │   ├── PacMan.jsx
│   │   ├── Pinball.jsx
│   │   ├── PlayerProfile.jsx
│   │   ├── Pong.jsx
│   │   ├── ProfileSelector.jsx
│   │   ├── RoomManager.jsx
│   │   ├── SocketTest.jsx
│   │   └── microgames/
│   │       ├── AvoidObstaclesMicrogame.jsx
│   │       ├── CatchFallingMicrogame.jsx
│   │       ├── ClickButtonMicrogame.jsx
│   │       ├── CountNumbersMicrogame.jsx
│   │       ├── MatchColorsMicrogame.jsx
│   │       └── TapFastMicrogame.jsx
│   ├── games/
│   │   └── pong/
│   │       └── network.js
│   ├── multiplayer/
│   │   ├── roomLifecycle.js
│   │   └── RoomProvider.jsx
│   └── utils/
│       ├── games.js
│       ├── music.js
│       ├── playerColors.js
│       ├── pongOnlineGame.js
│       ├── profiles.js
│       ├── roomState.js
│       ├── socket.js
│       └── sounds.js
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
└── vite.config.js
```

## 2. Dependencies

### Frontend (package.json)
```json
{
  "name": "multiplayer-arcade",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "socket.io-client": "^4.8.3"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "vite": "^5.0.8"
  }
}
```

### Backend (server/package.json)
```json
{
  "name": "multiplayer-arcade-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch index.js",
    "start": "node index.js"
  },
  "dependencies": {
    "better-sqlite3": "^12.5.0",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  }
}
```

## 3. Backend Entry Point

**File:** `server/index.js`

The server entry point is a large file (2949 lines) that sets up:
- Express HTTP server
- Socket.IO server with CORS enabled
- In-memory room management
- Database integration via `db.js`
- REST API routes for game state and debug logs
- Socket event handlers for room creation, joining, game actions, etc.

**Key Setup:**
```javascript
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { dbHelpers } from './db.js'
import db from './db.js'
import gameStateRouter from './api/game-state.js'
import debugLogsRouter, { addServerEventLog } from './api/debug-logs.js'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// API routes
app.use('/api', gameStateRouter)
app.use('/api/debug', debugLogsRouter)

// In-memory room storage
const rooms = new Map()

// Socket.IO connection handler
io.on('connection', (socket) => {
  // Handles: create-room, join-room, game-selected, game-start, 
  // ready-up, pong-game-start, pong-paddle-move, pong-game-state, etc.
})
```

**Port:** Backend runs on port 8000 (as per project memory)

## 4. Database Models

**File:** `server/db.js`

The database uses SQLite (better-sqlite3) with the following schema:

### Tables:

1. **rooms**
   - `id` (TEXT PRIMARY KEY) - Room identifier
   - `created_at` (DATETIME)
   - `state` (TEXT) - 'waiting', 'playing', 'ended'
   - `last_activity` (DATETIME)
   - `host_user_profile_id` (TEXT) - Foreign key to user_profiles

2. **user_profiles**
   - `id` (TEXT PRIMARY KEY) - User profile identifier
   - `name` (TEXT NOT NULL UNIQUE) - Profile name
   - `color_id` (INTEGER) - Foreign key to player_colors
   - `created_at` (DATETIME)
   - `last_seen` (DATETIME)

3. **players**
   - `id` (TEXT PRIMARY KEY) - Player identifier (uses user_profile_id)
   - `room_id` (TEXT NOT NULL) - Foreign key to rooms
   - `socket_id` (TEXT NOT NULL) - Ephemeral socket connection ID
   - `name` (TEXT NOT NULL)
   - `user_profile_id` (TEXT) - Foreign key to user_profiles
   - `color_id` (INTEGER) - Foreign key to player_colors
   - `score` (INTEGER DEFAULT 0)
   - `joined_at` (DATETIME)
   - `left_at` (DATETIME) - NULL if still active

4. **game_history**
   - `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
   - `room_id` (TEXT) - Foreign key to rooms
   - `player_id` (TEXT) - Foreign key to players
   - `event_type` (TEXT) - Event type identifier
   - `event_data` (TEXT) - JSON stringified event data
   - `score` (INTEGER)
   - `created_at` (DATETIME)

5. **player_colors**
   - `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
   - `color` (TEXT) - Hex color code
   - `emoji` (TEXT) - Emoji identifier
   - `name` (TEXT) - Color name
   - `display_order` (INTEGER)

6. **active_sessions**
   - `user_profile_id` (TEXT PRIMARY KEY) - Foreign key to user_profiles
   - `created_at` (DATETIME)

### Key Database Helpers:

The `dbHelpers` object exports functions for:
- Room operations: `createRoom`, `getRoom`, `updateRoomState`, `getAllRooms`, `deleteRoom`
- User profile operations: `getOrCreateUserProfile`, `getUserProfile`, `deleteUserProfile`
- Player operations: `addPlayer`, `getPlayer`, `getPlayersByRoom`, `removePlayer`, `getPlayerBySocket`
- Game history: `addGameEvent`, `getGameHistory`
- Player colors: `getAllPlayerColors`, `getPlayerColorById`

## 5. Current Socket/API Setup

### Socket.IO Events (server/index.js)

**Client → Server:**
- `create-room` - Create a new game room
- `join-room` - Join an existing room
- `update-player-name` - Update player name
- `player-action` - Generic player action
- `game-selected` - Host selects a game
- `game-start` - Host starts the game (after ready-up)
- `ready-up` - Player marks themselves as ready
- `pong-game-start` - Start Pong game
- `pong-paddle-move` - Update paddle position
- `pong-game-state` - Update game state
- `game-state-update` - Update general game state
- `microgame-start` - Start a microgame
- `microgame-end` - End a microgame
- `test-message` - Test socket connection
- `request-user-count` - Request current user count

**Server → Client:**
- `room-created` - Room creation confirmation
- `room-joined` - Room join confirmation
- `player-joined` - New player joined notification
- `player-left` - Player left notification
- `room-snapshot` - Canonical room state snapshot
- `room-list-updated` - Room list update (broadcast to LOBBY)
- `game-selected` - Game selection broadcast
- `game-start` - Game start broadcast
- `countdown-start` - Countdown started
- `countdown-cancelled` - Countdown cancelled
- `pong-game-start` - Pong game started
- `pong-paddle-move` - Paddle position update
- `pong-game-state` - Game state update
- `room-error` - Error notification
- `user-count-update` - User count update
- `host-reconnected` - Host reconnected notification

### REST API Routes

**File:** `server/api/game-state.js`
- `GET /api/game-state?roomId=<id>` - Retrieve game state
- `POST /api/game-state?roomId=<id>` - Update game state

**File:** `server/api/debug-logs.js`
- `POST /api/debug/client-logs` - Receive client logs
- `GET /api/debug/client-logs` - Retrieve client logs
- `DELETE /api/debug/client-logs` - Clear client logs
- `GET /api/debug/server-events` - Retrieve server event logs

### Room Management Architecture

**In-Memory Room Structure:**
```javascript
{
  id: string,                    // Room ID (6-digit number)
  players: Map<userProfileId, {  // Keyed by userProfileId (stable)
    userProfileId: string,
    socketId: string,            // Ephemeral
    name: string,
    score: number,
    ready: boolean,
    color: string,
    emoji: string,
    colorId: number,
    profileName: string,
    profileCreatedAt: string,
    profileLastSeen: string
  }>,
  socketIds: Map<userProfileId, socketId>,  // Reverse mapping
  hostUserProfileId: string,     // Persistent host identifier
  hostSocketId: string,          // Current host socket (ephemeral)
  readyPlayers: Set<userProfileId>,
  countdownInterval: NodeJS.Timeout | null,
  countdownSeconds: number | null,
  gameState: {
    state: 'waiting' | 'playing' | 'gameover',
    selectedGame: string | null,
    // Game-specific state...
  },
  createdAt: Date,
  lastActivity: string
}
```

**Key Design Decisions:**
- Rooms are stored both in-memory (for real-time state) and in database (for persistence)
- Players are keyed by `userProfileId` (stable) rather than `socketId` (ephemeral)
- Host is tracked by `userProfileId` (persistent) with current `socketId` (ephemeral)
- Room state is synchronized via `room-snapshot` events (canonical source of truth)

## 6. Frontend Connection

**File:** `src/utils/socket.js`

```javascript
import { io } from 'socket.io-client'

let socketInstance = null

export function getSocket() {
  if (!socketInstance) {
    const serverUrl = `http://${window.location.hostname}:8000`
    socketInstance = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      forceNew: false,
      timeout: 20000
    })

    socketInstance.on('connect', () => {
      console.log('[Socket] Connected:', socketInstance.id)
    })

    socketInstance.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason)
    })

    socketInstance.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error)
    })
  }

  return socketInstance
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}

export default getSocket
```

**File:** `src/main.jsx`

Frontend entry point that:
- Initializes React app
- Disables browser notifications (UI notifications only)
- Renders `App` component

**File:** `src/App.jsx`

Main application component that:
- Manages room state and multiplayer mode
- Handles profile selection
- Coordinates between Menu, RoomManager, and game components
- Manages URL-based room joining (room ID in query parameter)
- Persists room state to localStorage
- Handles socket reconnection and room state restoration

**Key Frontend Architecture:**
- Single socket instance shared across components (via `getSocket()`)
- Room state managed in `App.jsx` with localStorage persistence
- Room ID stored in URL query parameter (`?room=<id>`) as single source of truth
- `RoomManager` component handles socket events and room lifecycle
- `RoomProvider` (Context API) provides room state to child components

**Port:** Frontend runs on port 3000 (as per project memory)

---

## Additional Notes

- **Database:** SQLite with better-sqlite3 (synchronous operations)
- **Real-time:** Socket.IO for bidirectional communication
- **State Management:** Mix of React state, localStorage, and in-memory server state
- **Room Lifecycle:** Rooms persist in database, real-time state in memory
- **Player Identity:** Stable `userProfileId` with ephemeral `socketId` mapping
- **Host Management:** Host tracked by profile ID, socket ID updated on reconnect
- **Game Types:** Supports multiple games (Pong, PacMan, Crash Bandicoot, Pinball, GTA, Microgames)
- **Multiplayer Flow:** Create/Join → Ready Up → Countdown → Game Start

