# Testing the Ready-Up System

## Prerequisites

1. **Start the Backend Server** (Terminal 1):
```bash
cd server
npm install  # Only needed first time
npm run dev
```
Server should start on `http://localhost:8000`

2. **Start the Frontend** (Terminal 2):
```bash
npm install  # Only needed first time
npm run dev
```
Frontend should start on `http://localhost:3000`

## Test Scenario: Two Players Ready-Up Flow

### Step 1: Set Up Two Browser Windows

1. Open **Browser Window 1** (Player 1 - Host):
   - Navigate to `http://localhost:3000`
   - Create or select a profile

2. Open **Browser Window 2** (Player 2):
   - Navigate to `http://localhost:3000` (or use incognito/private window)
   - Create or select a different profile

### Step 2: Create and Join Room

**In Window 1 (Host):**
1. Click "MULTIPLAYER" from the menu
2. Click "Create Room"
3. Wait for room to be created
4. Copy the room ID from the URL (e.g., `?room=ABC123`)

**In Window 2 (Player 2):**
1. Click "MULTIPLAYER" from the menu
2. Either:
   - Click on the room from the "Available Rooms" list, OR
   - Manually enter the room ID in the URL: `http://localhost:3000?room=ABC123`

**Expected Result:**
- Both windows show "2/4 players" in the room
- Both windows show both players in the player list
- Window 1 shows "HOST" badge

### Step 3: Host Selects a Game

**In Window 1 (Host):**
1. Click "Back to Title" (stays in room)
2. Select a multiplayer game (e.g., "Pong")

**Expected Result:**
- Both windows should show:
  - The selected game name
  - "READY UP" section appears
  - Ready button is visible
  - Player list shows no one is ready yet

### Step 4: Test Ready-Up System

**In Window 1 (Host):**
1. Click "READY UP" button
2. Button should change to "UNREADY" (green background)
3. Player list should show "READY" badge next to Player 1

**In Window 2 (Player 2):**
1. Should see Player 1's ready status update (READY badge appears)
2. Ready count should show "1/2 players ready"
3. Click "READY UP" button
4. Button should change to "UNREADY" (green background)

**Expected Result:**
- Both windows show "2/2 players ready"
- **10-second countdown should start automatically**
- Large countdown number appears (10, 9, 8, 7...)
- Countdown pulses during final 3 seconds

### Step 5: Verify Countdown and Game Start

**During Countdown:**
- Countdown displays: 10 → 9 → 8 → 7 → 6 → 5 → 4 → 3 → 2 → 1
- Sound plays when countdown starts
- Sound plays for final 3 seconds (pulse animation)
- Ready buttons are disabled during countdown

**At Countdown End (0):**
- Both windows should automatically navigate to the selected game
- Game should start simultaneously for both players
- Both players should see the game at the same time

### Step 6: Test Edge Cases

#### Test 6a: Unready During Countdown

1. Start countdown (both players ready)
2. **Before countdown ends**, one player clicks "UNREADY"
3. Countdown should **cancel immediately**
4. Ready count resets
5. Countdown disappears

#### Test 6b: Player Disconnects During Countdown

1. Start countdown (both players ready)
2. **Before countdown ends**, close one browser window
3. Remaining window should:
   - Countdown cancels
   - Player count updates to 1/4
   - Ready status resets

#### Test 6c: New Player Joins During Countdown

1. Start countdown (both players ready)
2. **Before countdown ends**, have a third player join the room
3. Countdown should **cancel immediately**
4. Ready count shows "2/3 players ready"
5. All players need to ready up again

#### Test 6d: Host Selects Different Game

1. Both players ready up and countdown starts
2. Host clicks "Back to Title" and selects a different game
3. Ready status should reset
4. Countdown should cancel
5. New game selection should appear
6. Players need to ready up again for new game

## Visual Checklist

### Room Manager UI Should Show:
- [ ] Room ID displayed at top
- [ ] Player count (X/4 players)
- [ ] HOST badge (for host only)
- [ ] Player list with names, emojis, and colors
- [ ] READY badges next to ready players
- [ ] "READY UP" section (only when game is selected)
- [ ] Ready count (X/Y players ready)
- [ ] Ready/Unready button
- [ ] Countdown display (when all ready)
- [ ] Countdown number (large, centered)
- [ ] "Game starting in..." text

### Button States:
- [ ] Ready button: White border, white text (not ready)
- [ ] Ready button: Green background, black text (ready)
- [ ] Button disabled during countdown
- [ ] Button text changes: "READY UP" ↔ "UNREADY"

## Console Logs to Monitor

**Server Console (Terminal 1):**
- `[SOCKET] Player X readied in room Y. Ready: 1/2`
- `[SOCKET] Player X unreadied in room Y. Ready: 0/2`
- `[SOCKET] Game X started in room Y after countdown`
- `[SOCKET] Cancelled countdown in room Y due to...`

**Browser Console (F12):**
- `[RoomManager] Received game-selected event`
- `[RoomManager] Received game-start event`
- `[App] Handling game-start action`

## Troubleshooting

### Countdown Doesn't Start
- **Check:** Are at least 2 players in the room?
- **Check:** Are all players ready? (check ready count)
- **Check:** Server console for errors
- **Fix:** Refresh both browser windows

### Game Doesn't Start After Countdown
- **Check:** Browser console for errors
- **Check:** Server console for "game-start" event
- **Check:** Network tab for socket.io connection
- **Fix:** Verify both clients received `game-start` event

### Ready Status Not Syncing
- **Check:** Socket.io connection (Network tab → WS)
- **Check:** Both players in same room (verify room ID in URL)
- **Check:** Server console for `players-ready-updated` events
- **Fix:** Refresh and rejoin room

### Countdown Not Cancelling
- **Check:** Server console for disconnect/join events
- **Check:** Player count updates correctly
- **Fix:** Verify server-side countdown cancellation logic

## Quick Test Script

1. ✅ Start server and frontend
2. ✅ Create room (Window 1)
3. ✅ Join room (Window 2)
4. ✅ Host selects game
5. ✅ Both players ready up
6. ✅ Countdown starts (10 seconds)
7. ✅ Game starts simultaneously
8. ✅ Test unready during countdown
9. ✅ Test player disconnect during countdown
10. ✅ Test new player join during countdown

## Expected Behavior Summary

| Action | Expected Result |
|-------|----------------|
| Host selects game | All players see game selection, ready section appears |
| Player clicks Ready | Button turns green, READY badge appears, count updates |
| All players ready | 10-second countdown starts automatically |
| Countdown running | Large number displays, pulses at 3 seconds |
| Countdown ends | Game starts for all players simultaneously |
| Player unreadies | Countdown cancels immediately |
| Player disconnects | Countdown cancels, player removed |
| New player joins | Countdown cancels, ready status resets |
| Host changes game | Ready status resets, new game selected |

