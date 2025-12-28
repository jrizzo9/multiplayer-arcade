# Multiplayer Foundation Refactor - Summary

## Overview
Migrated all game components to use the reusable multiplayer foundation. All room, roster, host status, and selectedGame UI now comes exclusively from `useRoom(roomId)` and `room-snapshot` events.

## Files Created

### 1. `src/multiplayer/RoomProvider.jsx`
- **Purpose**: Provides room state context and `useRoom()` hook
- **Key Features**:
  - Subscribes to `room-snapshot` events
  - Stores snapshots by `roomId` in a Map
  - Exposes derived helpers: `players`, `hostUserProfileId`, `selectedGame`, `status`, `isHost(userProfileId)`, `getPlayer(userProfileId)`
  - Uses shared socket singleton via `getSocket()`

### 2. `src/multiplayer/roomLifecycle.js`
- **Purpose**: Thin wrappers over socket events for room operations
- **Functions**:
  - `createRoom(payload)` - Returns Promise
  - `joinRoom(roomId, payload)` - Returns Promise
  - `leaveRoom(roomId, payload)` - Void
  - `setReady(roomId, ready)` - Void
  - `selectGame(roomId, game)` - Void (host only)

### 3. `src/games/pong/network.js`
- **Purpose**: Pong-specific networking layer (separated from room/presence logic)
- **Functions**:
  - `emitPaddleMove(roomId, playerNumber, paddleY)` - Emit paddle movement
  - `emitGameStart(roomId, gameState)` - Emit game start (host only)
  - `emitGameState(roomId, gameState)` - Emit game state (host only, throttled)
  - `subscribeToPongEvents(handlers)` - Subscribe to Pong events, returns cleanup function

## Files Modified

### 1. `src/App.jsx`
- **Changes**: Wrapped entire app with `<RoomProvider>` to provide multiplayer context
- **Impact**: All child components can now use `useRoom()` hook

### 2. `src/components/RoomManager.jsx`
- **Changes**:
  - Replaced local player tracking with `useRoom(roomId)` hook
  - Uses lifecycle helpers (`createRoom`, `joinRoom`, `leaveRoom`, `setReady`)
  - Renders roster and status exclusively from `room-snapshot` state
  - Removed `player-joined`, `player-left` event handlers for roster updates (kept only for optional side effects)
  - All player identification uses `userProfileId` (React keys, comparisons)
  - Player list keys changed from `player.id` to `player.userProfileId`

### 3. `src/components/MultiplayerGame.jsx`
- **Changes**:
  - Added `useRoom(roomId)` to get room state
  - Added `getCurrentProfile()` to get `userProfileId`
  - Replaced local `players` state with `roomState.players`
  - Replaced `isHost` prop with `roomState.isHost(currentProfile.id)`
  - Updated `player-position` and `score-update` events to use `userProfileId`
  - Updated `otherPlayers` Map to key by `userProfileId` instead of `playerId`
  - Removed `player-joined`/`player-left` handlers for roster (kept for optional side effects)
  - All player comparisons and React keys use `userProfileId`

### 4. `src/components/Pong.jsx`
- **Changes**:
  - Added `useRoom(roomId)` to get room state
  - Added `getCurrentProfile()` to get `userProfileId`
  - Replaced local `players` state with `roomState.players`
  - Replaced `isHost` prop with `roomState.isHost(currentProfile.id)`
  - Moved all Pong socket emits/listeners to `pong/network.js`:
    - `subscribeToPongEvents()` for event subscriptions
    - `emitPaddleMove()`, `emitGameStart()`, `emitGameState()` for emits
  - Removed `player-joined`/`player-left` handlers for roster (roster comes from room-snapshot)
  - Player number determined from position in `players` array (using `userProfileId`)
  - Player display uses `userProfileId` for keys and identification
  - Broadcast throttling remains at ~30 Hz (33ms intervals)
  - Host still runs physics loop, non-host renders received state

### 5. `src/components/MicroGames.jsx`
- **Changes**:
  - Added `useRoom(roomId)` to get room state
  - Replaced local `players` state with `roomState.players`
  - Replaced `isHost` prop with `roomState.isHost(propProfile.id)`
  - Changed `playerIdRef` to `userProfileIdRef` (uses `userProfileId` instead of `socket.id`)
  - Updated `microgame-playing` and `microgame-end` events to use `userProfileId`
  - Removed `player-joined`/`player-left` handlers for roster (roster comes from room-snapshot)
  - All player comparisons and React keys use `userProfileId`
  - Score attribution uses `userProfileId`

### 6. `src/components/MobileController.jsx`
- **Changes**:
  - Added `useRoom(roomId)` to get room state
  - Player number determined from position in `players` array (using `userProfileId`)
  - Uses `subscribeToPongEvents()` from `pong/network.js` for Pong events
  - Uses `emitPaddleMove()` from `pong/network.js` for paddle movements
  - Removed `player-joined` handler (roster comes from room-snapshot)
  - Removed room joining logic (handled by RoomManager)
  - All player identification uses `userProfileId`

## Key Architectural Changes

### 1. Single Source of Truth
- **Before**: Each component tracked its own player list from `player-joined`/`player-left` events
- **After**: All components read from `room-snapshot` via `useRoom()` hook
- **Benefit**: Consistent roster state across all components, no sync issues

### 2. Stable Player Identity
- **Before**: Used `socket.id` for player identification (ephemeral)
- **After**: Uses `userProfileId` everywhere (stable across reconnects)
- **Benefit**: Players can disconnect/reconnect without losing identity

### 3. Separation of Concerns
- **Before**: Room logic and game logic mixed in components
- **After**: Room/presence via `useRoom()`, game events via game-specific network layers (e.g., `pong/network.js`)
- **Benefit**: Cleaner code, easier to add new games

### 4. Reusable Foundation
- **Before**: Each game component duplicated room management logic
- **After**: All games use the same `useRoom()` hook and lifecycle helpers
- **Benefit**: Consistent behavior, less code duplication

## Bugs Fixed

1. **RoomManager**: Fixed duplicate `isHost` calculation - now uses `roomState.isHost(userProfileId)` consistently
2. **Pong**: Fixed player number determination - now based on position in `players` array using `userProfileId`, not socket.id
3. **MicroGames**: Fixed score attribution - now uses `userProfileId` instead of `socket.id`
4. **MobileController**: Fixed player number determination - now uses `userProfileId` from room state

## Verification Checklist

### ✅ Create room as host, roster shows correctly
- RoomManager uses `useRoom()` to get players from room-snapshot
- Players array is populated from snapshot

### ✅ Join room as player from second browser, roster updates on both
- Both clients receive `room-snapshot` events
- `RoomProvider` updates snapshot Map
- Both `useRoom()` hooks return updated players array

### ✅ Player leaves room, roster updates correctly
- Server emits `room-snapshot` after player leaves
- All clients receive updated snapshot
- Roster UI updates automatically via `useRoom()`

### ✅ Host disconnects and reconnects within grace period, host remains host
- Server tracks host by `userProfileId` (stable)
- Reconnection logic uses `userProfileId` to identify host
- `room-snapshot` includes `hostUserProfileId`

### ✅ Host disconnects beyond grace period, room closes and lobby updates
- Server closes room after grace period
- Emits `room-closed` to room and `room-list-updated` to LOBBY
- Clients receive events and update UI

### ✅ Pong starts, paddle moves sync, state updates are throttled
- Host uses `emitGameStart()` and `emitGameState()` from `pong/network.js`
- Non-host uses `subscribeToPongEvents()` to receive updates
- Broadcast throttling at 33ms intervals (~30 Hz) maintained
- Paddle moves use `emitPaddleMove()` and sync correctly

## Notes

- All components now use `userProfileId` for player identification (keys, comparisons, lookups)
- No component maintains its own roster - all read from `room-snapshot`
- Game-specific networking is separated into `src/games/pong/network.js`
- Socket singleton is used everywhere via `getSocket()`
- No UI/UX behavior changed - only internal state management refactored

