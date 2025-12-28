# Multiplayer Socket Architecture Refactoring Summary

This document summarizes the refactoring changes made to stabilize presence, rooms, and Pong networking.

## Changes Made

### 1. Single Shared Socket.IO Client Instance ✅

**File Created:** `src/utils/socket.js`
- Exports `getSocket()` function that returns a singleton socket instance
- All components now import and reuse this single connection
- Prevents multiple socket connections per client

**Files Modified:**
- `src/components/RoomManager.jsx` - Uses shared socket
- `src/components/MultiplayerGame.jsx` - Uses shared socket
- `src/components/Pong.jsx` - Uses shared socket
- `src/components/MicroGames.jsx` - Uses shared socket
- `src/components/MobileController.jsx` - Uses shared socket

**Why:** Eliminates connection overhead and ensures consistent connection state across components.

---

### 2. Decoupled Player Identity from Socket IDs ✅

**Server Changes (`server/index.js`):**

**Room Structure Updated:**
- `room.players` Map now keyed by `userProfileId` (stable) instead of `socket.id` (ephemeral)
- Added `room.socketIds` Map: `userProfileId -> socketId` for reverse lookup
- Player data structure now includes `userProfileId` as primary identifier, `socketId` as ephemeral field

**Helper Function Added:**
```javascript
function findUserProfileIdBySocket(room, socketId)
```
- Finds userProfileId by socketId using the socketIds map

**Database Changes:**
- Player records now use `userProfileId` as the primary player ID in database
- `socket_id` field is still stored but treated as ephemeral connection data
- Updated all database queries to use `userProfileId` where appropriate

**Event Payload Changes:**
- `player-left` now sends `userProfileId` instead of `playerId`
- `player-position` now sends `userProfileId` instead of `playerId`
- `score-update` now sends `userProfileId` instead of `playerId`
- `game-action` now sends `userProfileId` instead of `playerId`

**Why:** Socket IDs change on reconnection. Using `userProfileId` provides stable identity that persists across reconnects.

---

### 3. In-Memory Room State as Source of Truth ✅

**Changes:**
- Room presence queries now use `rooms` Map instead of database
- `findUserProfileIdBySocket()` uses in-memory `socketIds` map
- Stale socket cleanup uses in-memory room state
- Database is only queried for historical data and metadata

**Why:** Database queries are slow. In-memory state provides instant, accurate presence information.

---

### 4. Canonical Room Snapshot Event ✅

**New Event:** `room-snapshot`

**Structure:**
```javascript
{
  roomId: string,
  hostUserProfileId: string,
  status: 'waiting' | 'playing' | 'gameover',
  selectedGame: string | null,
  players: [{
    userProfileId: string,
    socketId: string,
    name: string,
    score: number,
    ready: boolean,
    color: string,
    emoji: string,
    // ... other fields
  }]
}
```

**Emitted After:**
- Room creation
- Player join
- Player leave
- Ready status toggle
- Host reconnect
- Game selection

**Helper Function:** `emitRoomSnapshot(room)`

**Why:** Provides a single, complete source of truth for room state. Clients can render UI exclusively from this snapshot.

---

### 5. LOBBY Namespace for Room List Updates ✅

**Changes:**
- All sockets automatically join `'LOBBY'` namespace on connection
- `room-list-updated` events now broadcast only to `LOBBY` instead of all sockets
- Reduces unnecessary network traffic for clients already in rooms

**Why:** Clients on the room-join screen need room list updates. Clients in active rooms don't need these updates, reducing network overhead.

---

### 6. Host Disconnect Guardrails ✅

**Grace Period:** 60 seconds

**Behavior:**
- When host disconnects, room stays open
- 60-second timeout starts
- If host reconnects within grace period, timeout is cleared
- If host does NOT reconnect within 60 seconds:
  - Room is automatically closed
  - All players receive `room-closed` event
  - Room marked as 'ended' in database
  - Room deleted from memory
  - `room-list-updated` (deleted) sent to LOBBY

**Why:** Prevents rooms from staying open indefinitely when host abandons the game.

---

### 7. Pong Network Efficiency Improvements ✅

**Throttling Added:**
- Broadcast rate: ~30 Hz (33ms intervals)
- Changed from: Every animation frame (~60fps)
- Changed to: Maximum once every 33ms

**Implementation:**
- Added `lastBroadcastTimeRef` to track last broadcast
- Added `BROADCAST_THROTTLE_MS = 33` constant
- Broadcasts only when `(now - lastBroadcastTime >= 33ms)`

**Why:** Reduces network traffic by ~50% while maintaining smooth gameplay. 30 Hz is sufficient for Pong's physics.

---

## Breaking Changes & Migration Notes

### Client-Side Updates Needed

**Event Payload Changes:**
Some events now send `userProfileId` instead of `playerId` or `socket.id`:
- `player-left`: `{ userProfileId, players }` (was `{ playerId, players }`)
- `player-position`: `{ userProfileId, kiwiY, kiwiVelocity }` (was `{ playerId, ... }`)
- `score-update`: `{ userProfileId, score }` (was `{ playerId, score }`)
- `game-action`: `{ userProfileId, action, data }` (was `{ playerId, ... }`)

**Client Components Should:**
- Update event handlers to use `userProfileId` for player identification
- Use `userProfileId` to match players instead of `socket.id`
- Listen for `room-snapshot` event and use it as primary source of truth

**Backward Compatibility:**
- Old events (`player-joined`, `room-created`) still work but should be supplemented with `room-snapshot`
- Socket IDs are still available in player data but should not be used as primary identifiers

---

## Testing Recommendations

1. **Reconnection:** Test host and player reconnection scenarios
2. **Host Timeout:** Verify room closes after 60 seconds if host doesn't reconnect
3. **Room Snapshot:** Verify clients receive complete room state after any change
4. **LOBBY Updates:** Verify room list only updates for clients in LOBBY
5. **Pong Throttling:** Verify game still feels smooth with 30 Hz broadcasts
6. **Identity Stability:** Verify players maintain identity across socket reconnections

---

## Files Modified

### Server
- `server/index.js` - Major refactoring for userProfileId-based identity

### Client
- `src/utils/socket.js` - NEW: Shared socket instance
- `src/components/RoomManager.jsx` - Uses shared socket
- `src/components/MultiplayerGame.jsx` - Uses shared socket
- `src/components/Pong.jsx` - Uses shared socket, added throttling
- `src/components/MicroGames.jsx` - Uses shared socket
- `src/components/MobileController.jsx` - Uses shared socket

---

## Next Steps (Optional Future Improvements)

1. Update client components to use `room-snapshot` as primary state source
2. Update client event handlers to use `userProfileId` consistently
3. Add client-side interpolation for Pong game state (smooth between 30 Hz updates)
4. Consider adding server-side game state validation for Pong (currently client-authoritative)

