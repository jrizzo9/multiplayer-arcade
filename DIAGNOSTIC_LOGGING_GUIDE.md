# Diagnostic Logging Guide

This document describes the diagnostic logging added to trace room creation and join flows.

## Overview

Diagnostic logs have been added throughout the codebase to trace:
1. **Create-room flow** (host side)
2. **Join-room flow** (second player)
3. **RoomProvider behavior** (snapshot storage)
4. **UI subscription correctness** (useRoom hook)
5. **Log spam identification** (duplicate listeners)

All diagnostic logs are prefixed with `[DIAG]` for easy filtering.

## Log Format

Each diagnostic log includes:
- **Step number/letter**: Sequential identifier for the flow
- **Component/function name**: Where the log originates
- **Relevant data**: roomId, socketId, types, counts, etc.
- **Timestamp**: For ordering events across devices

## Create-Room Flow (Host Side)

### Client-Side Steps

**Step 1** - `src/multiplayer/roomLifecycle.js` - `createRoom()` called
- Logs: socketId, socketConnected, payload
- **Check**: Socket is connected before proceeding

**Step 2** - `src/multiplayer/roomLifecycle.js` - About to emit `create-room`
- Logs: socketId, payload
- **Check**: Emit fires exactly once

**Step 3** - `src/multiplayer/roomLifecycle.js` - Received `room-created` event
- Logs: socketId, roomId, roomIdType, playersCount, hostUserProfileId
- **Check**: roomId type is consistent (should be string)

**Step 6** - `src/components/RoomManager.jsx` - Room created, setting localRoomId
- Logs: resultRoomId, resultRoomIdType, localRoomIdBefore
- **Check**: roomId is set correctly in local state

**Step 7** - `src/components/RoomManager.jsx` - localRoomId updated
- Logs: localRoomId, localRoomIdType
- **Check**: State update triggers correctly

**Step 8** - `src/components/RoomManager.jsx` - useRoom called with actualRoomId
- Logs: actualRoomId, actualRoomIdType, roomStateRoomId, playersCount, hasSnapshot
- **Check**: useRoom receives correct roomId and finds snapshot

### Server-Side Steps

**Step A** - `server/index.js` - Received `create-room`
- Logs: socketId, playerName, userProfileId
- **Check**: Server receives the create-room event

**Step B** - `server/index.js` - Room created in memory
- Logs: roomId, roomIdType, playersCount, hostUserProfileId
- **Check**: Room object created correctly

**Step C** - `server/index.js` - About to emit `room-created`
- Logs: roomId, roomIdType, playersCount
- **Check**: Emit fires once

**Step D** - `server/index.js` - About to emit `room-snapshot`
- Logs: roomId, roomIdType, playersCount, snapshotPayload
- **Check**: Snapshot payload is correct

### RoomProvider Steps

**Step 4** - `src/multiplayer/RoomProvider.jsx` - Received `room-snapshot`
- Logs: roomId, roomIdType, playersCount, players array
- **Check**: Snapshot arrives at RoomProvider

**Step 5** - `src/multiplayer/RoomProvider.jsx` - Storing snapshot in Map
- Logs: roomId, roomIdType, mapKeysBefore, mapKeysAfter, snapshotStored
- **Check**: Snapshot stored under correct key

## Join-Room Flow (Second Player)

### Client-Side Steps

**Step 1** - `src/multiplayer/roomLifecycle.js` - `joinRoom()` called
- Logs: socketId, socketConnected, roomId, roomIdType, payload
- **Check**: Socket connected, roomId is correct type

**Step 2** - `src/multiplayer/roomLifecycle.js` - About to emit `join-room`
- Logs: socketId, roomId, roomIdType
- **Check**: Emit fires once

**Step 3** - `src/multiplayer/roomLifecycle.js` - Received `player-joined` event
- Logs: socketId, playersCount, isHost, hostUserProfileId
- **Check**: Event received with correct data

**Step 4** - `src/components/RoomManager.jsx` - Room joined, setting localRoomId
- Logs: targetRoomId, targetRoomIdType, localRoomIdBefore
- **Check**: roomId set correctly

### Server-Side Steps

**Step A** - `server/index.js` - Received `join-room`
- Logs: socketId, roomId, roomIdType, userProfileId
- **Check**: Server receives join-room event

**Step B** - `server/index.js` - Player added to room
- Logs: roomId, roomIdType, playersCount, joiningUserProfileId
- **Check**: Player added to room object

**Step C** - `server/index.js` - About to emit `player-joined`
- Logs: roomId, playersCount
- **Check**: Emit fires once

**Step D** - `server/index.js` - About to emit `room-snapshot`
- Logs: roomId, roomIdType, playersCount, snapshotPayload
- **Check**: Snapshot includes both players

## RoomProvider Behavior Verification

### Listener Registration

**`src/multiplayer/RoomProvider.jsx`** - useEffect running
- Logs: listenersInitialized, socketId, socketConnected
- **Check**: Listeners initialized exactly once

**`src/multiplayer/RoomProvider.jsx`** - Listener count before/after
- Logs: listenerCountBefore, listenerCountAfter, duplicateDetected
- **Check**: No duplicate listeners (count should be 1 after first registration)

### Snapshot Storage

**`src/multiplayer/RoomProvider.jsx`** - Map state before/after update
- Logs: mapSize, mapKeys, mapKeysTypes, snapshotRoomId, snapshotRoomIdType
- **Check**: 
  - Map keys are consistent types (all strings or all numbers)
  - Snapshot stored under correct key
  - No type mismatches between roomId used to store vs. retrieve

### Component Re-renders

**`src/multiplayer/RoomProvider.jsx`** - Component re-rendered
- Logs: snapshotsSize
- **Check**: Re-renders don't cause duplicate listeners

## UI Subscription Verification

### useRoom Hook

**`src/multiplayer/RoomProvider.jsx`** - Hook called
- Logs: roomId, roomIdType, roomIdDefined, allSnapshotKeys, allSnapshotKeyTypes
- **Check**: 
  - roomId is defined and correct type
  - Snapshot keys match requested roomId type

**`src/multiplayer/RoomProvider.jsx`** - Returning snapshot
- Logs: requestedRoomId, requestedRoomIdType, snapshotFound, snapshotRoomId, playersCount
- **Check**: 
  - Snapshot found for requested roomId
  - Type matches between request and storage

**`src/components/RoomManager.jsx`** - useRoom called with actualRoomId
- Logs: actualRoomId, actualRoomIdType, roomStateRoomId, playersCount, hasSnapshot
- **Check**: 
  - actualRoomId is correct
  - Snapshot is found and has players

## Log Spam Identification

### Socket Listener Counts

**`src/components/RoomManager.jsx`** - Socket listener counts
- Logs: roomSnapshot, roomCreated
- **Check**: Counts don't increase on re-renders (should stay at 1-2)

**`src/multiplayer/RoomProvider.jsx`** - Listener count before/after
- Logs: listenerCountBefore, listenerCountAfter
- **Check**: Count doesn't increase beyond 1

## How to Use These Logs

### 1. Filter Console Logs

In browser DevTools, filter by `[DIAG]`:
```
[DIAG]
```

### 2. Trace a Specific Flow

Filter by step number:
```
[DIAG] [CREATE-ROOM] Step
[DIAG] [JOIN-ROOM] Step
```

### 3. Check for Type Mismatches

Look for `roomIdType` logs and compare:
- All should be `"string"` or all should be `"number"`
- Mismatch indicates root cause

### 4. Identify Duplicate Listeners

Check listener count logs:
- If `listenerCountAfter > 1` on first registration, duplicate detected
- If counts increase on re-renders, cleanup issue

### 5. Verify Snapshot Storage

Compare:
- `mapKeysAfter` should include the `roomId`
- `snapshotRoomIdType` should match `requestedRoomIdType`
- `snapshotFound: true` should appear in useRoom logs

### 6. Check Timing Issues

Compare timestamps:
- Snapshot should arrive after room-created
- useRoom should be called after snapshot stored
- If snapshot arrives but useRoom shows `snapshotFound: false`, timing issue

## Common Issues to Look For

1. **Type Mismatch**: roomId stored as string but retrieved as number (or vice versa)
2. **Duplicate Listeners**: Listener count increases on re-renders
3. **Missing Snapshot**: Snapshot emitted but not stored in Map
4. **Wrong Key**: Snapshot stored under different key than requested
5. **Timing Issue**: useRoom called before snapshot arrives
6. **Multiple Emits**: Same event emitted multiple times

## Next Steps

After running with diagnostic logs:

1. **Identify first failure point**: Look for step that doesn't log or logs incorrect data
2. **Check type consistency**: All roomId types should match
3. **Verify listener counts**: Should not increase beyond expected
4. **Compare timestamps**: Events should arrive in expected order
5. **Check Map storage**: Keys should match roomId used in useRoom()

Once root cause is identified, these logs can be removed or reduced to essential checks only.

