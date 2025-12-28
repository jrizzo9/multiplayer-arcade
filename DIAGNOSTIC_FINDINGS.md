# Diagnostic Findings - Room Creation/Join Flow

## Summary

Diagnostic logs reveal the root cause: **Server is emitting snapshots with only 1 player even when 2 players are in the room**.

## Key Findings

### 1. JOIN-ROOM Flow Works (Client-Side)
✅ **Step 1**: `joinRoom()` called successfully
- Socket connected: ✓
- roomId type: `string` (consistent)
- Payload includes correct userProfileId

✅ **Step 2**: `join-room` emit fires
- Emit happens once per join attempt
- roomId type: `string` (consistent)

✅ **Step 3**: `player-joined` event received
- Event arrives successfully
- **CRITICAL**: `playersCount: 1` (should be 2 when second player joins)

### 2. Room Snapshot Storage Works (Client-Side)
✅ **Step 4**: Room-snapshot received by RoomProvider
- Snapshot arrives successfully
- roomId type: `string` (consistent)
- **CRITICAL**: `playersCount: 1` (should be 2 when both players in room)

✅ **Step 5**: Snapshot stored in Map
- Storage works correctly
- Key type matches: `string`
- Snapshot found: `true`

### 3. useRoom Hook Works
✅ Snapshot retrieval works
- `requestedRoomId`: `"920691"` (string)
- `snapshotRoomId`: `"920691"` (string)
- Types match: ✓
- `snapshotFound`: `true`

### 4. Root Cause Identified

**Problem**: Server emits snapshots with `playersCount: 1` even when 2 players have joined.

**Evidence from logs**:
```
[12:47:33 AM] [JOIN-ROOM] Step 3: Received player-joined event
  playersCount: 1  ← Should be 2!
  isHost: false
  hostUserProfileId: "1766695461175o5x13gh"

[12:47:40 AM] [JOIN-ROOM] Step 3: Received player-joined event  
  playersCount: 1  ← Should be 2!
  isHost: true
  hostUserProfileId: "1766695461175o5x13gh"
```

**Room snapshots also show only 1 player**:
- At 12:47:33 AM: Snapshot shows only "Someone else" (1 player)
- At 12:47:40 AM: Snapshot shows only "Josh" (1 player)
- **Both players never appear in the same snapshot**

## Issues Identified

### Issue #1: Server Not Including All Players in Snapshot
**Location**: `server/index.js` - `emitRoomSnapshot()` function
**Symptom**: When second player joins, snapshot only contains 1 player
**Expected**: Snapshot should contain all players in the room (2 players)

### Issue #2: Server Not Including All Players in player-joined Event
**Location**: `server/index.js` - `join-room` handler
**Symptom**: `player-joined` event shows `playersCount: 1` when 2 players exist
**Expected**: Should show `playersCount: 2` when second player joins

### Issue #3: Duplicate Snapshot Receipt
**Symptom**: Same snapshot received 3 times by RoomProvider
**Possible Cause**: Multiple listeners or server emitting multiple times
**Impact**: Excessive logging, but doesn't break functionality

### Issue #4: Excessive useRoom Re-renders
**Symptom**: `useRoom` hook called many times with same data
**Possible Cause**: React re-renders triggering hook
**Impact**: Performance, but doesn't break functionality

## What's Working

✅ Socket connection lifecycle
✅ roomId type consistency (all strings)
✅ Snapshot storage in Map
✅ Snapshot retrieval via useRoom
✅ Client-side join flow
✅ Event emission/receipt

## What's Broken

❌ Server includes only 1 player in snapshots when 2+ players exist
❌ Server includes only 1 player in player-joined events when 2+ players exist
❌ UI shows only 1 player because snapshot only contains 1 player

## Next Steps for Investigation

1. **Check server-side room.players Map**:
   - Verify `room.players.size` when emitting snapshot
   - Check if players are being removed from Map incorrectly
   - Verify `Array.from(room.players.values())` includes all players

2. **Check server-side join-room handler**:
   - Verify player is added to `room.players` Map before emitting
   - Check if existing players are being removed when new player joins
   - Verify `playersArray` includes all players before emitting

3. **Check for race conditions**:
   - Verify both players are in room.players Map simultaneously
   - Check if one player is being removed when other joins

## Diagnostic Log Evidence

### Join Flow (Second Player - "Someone else")
```
[12:47:33 AM] [JOIN-ROOM] Step 1: joinRoom called
  roomId: "920691"
  userProfileId: "1766695503427dpry7h6"

[12:47:33 AM] [JOIN-ROOM] Step 2: About to emit join-room

[12:47:33 AM] [JOIN-ROOM] Step 3: Received player-joined event
  playersCount: 1  ← PROBLEM: Should be 2
  isHost: false
```

### Snapshot Received (After Second Player Joins)
```
[12:47:33 AM] [ROOM-PROVIDER] Step 4: Received room-snapshot
  roomId: "920691"
  playersCount: 1  ← PROBLEM: Should be 2
  players: [
    { userProfileId: "1766695503427dpry7h6", name: "Someone else" }
  ]
  ← Missing: Host player "Josh"
```

### Join Flow (Host Rejoins - "Josh")
```
[12:47:40 AM] [JOIN-ROOM] Step 1: joinRoom called
  roomId: "920691"
  userProfileId: "1766695461175o5x13gh"

[12:47:40 AM] [JOIN-ROOM] Step 3: Received player-joined event
  playersCount: 1  ← PROBLEM: Should be 2
  isHost: true
```

### Snapshot Received (After Host Rejoins)
```
[12:47:40 AM] [ROOM-PROVIDER] Step 4: Received room-snapshot
  roomId: "920691"
  playersCount: 1  ← PROBLEM: Should be 2
  players: [
    { userProfileId: "1766695461175o5x13gh", name: "Josh" }
  ]
  ← Missing: Second player "Someone else"
```

## Conclusion

**Root Cause**: Server-side bug in `join-room` handler or `emitRoomSnapshot()` function. The server is not including all players in the room when emitting snapshots or player-joined events.

**Fix Location**: `server/index.js`
- `join-room` handler (around line 338)
- `emitRoomSnapshot()` function (around line 62)

The client-side code is working correctly - it's receiving and storing the snapshots properly, but the snapshots themselves are incomplete (missing players).

