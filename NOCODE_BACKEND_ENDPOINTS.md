# NoCodeBackend API Endpoints

**Base URL:** `http://api.nocodebackend.com`  
**Instance:** `55050_multiplayer_arcade`  
**Authentication:** `Authorization: Bearer {API_KEY}`

**All endpoints require the `Instance` query parameter:** `?Instance=55050_multiplayer_arcade`

---

## Matches Table Endpoints

### 1. Create Match
**POST** `/create/Matches?Instance=55050_multiplayer_arcade`

Creates a new match record.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {API_KEY}
```

**Request Body:**
```json
{
  "gameType": "pong",
  "winnerId": "user-profile-id-123",
  "winnerName": "Player Name",
  "winnerScore": 5,
  "loserId": "user-profile-id-456",
  "loserName": "Opponent Name",
  "loserScore": 3,
  "roomId": "room-id-789",
  "timestamp": "2026-01-03T09:28:31.345Z"
}
```

**Used in:** `saveMatch()` function

---

### 2. Read All Matches
**GET** `/read/Matches?Instance=55050_multiplayer_arcade`

Retrieves all match records.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {API_KEY}
```

**Response:** Array of match objects

**Used in:** `getAllMatches()` and `getLeaderboard()` functions

---

### 3. Read Match by ID
**GET** `/read/Matches/{id}?Instance=55050_multiplayer_arcade`

Retrieves a specific match by ID.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {API_KEY}
```

**Used in:** `getMatch(matchId)` function

---

### 4. Search Matches
**POST** `/search/Matches?Instance=55050_multiplayer_arcade`

Searches for matches based on criteria.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {API_KEY}
```

**Request Body:**
```json
{
  "gameType": "pong"
}
```

**Used in:** `searchMatches(criteria)` and `getLeaderboard()` functions

---

### 5. Update Match
**PUT** `/update/Matches/{id}?Instance=55050_multiplayer_arcade`

Updates an existing match record.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {API_KEY}
```

**Request Body:** JSON object with fields to update

**Used in:** `updateMatch(matchId, matchData)` function

---

### 6. Delete Match
**DELETE** `/delete/Matches/{id}?Instance=55050_multiplayer_arcade`

Deletes a match record.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {API_KEY}
```

**Used in:** `deleteMatch(matchId)` function

---

## Current Implementation

### Functions in `src/services/db.js`:

1. **`saveMatch(matchData)`**
   - Uses: `POST /create/Matches?Instance=55050_multiplayer_arcade`
   - Called from: `Pong.jsx` (4 locations when game ends)

2. **`getMatch(matchId)`**
   - Uses: `GET /read/Matches/{id}?Instance=55050_multiplayer_arcade`
   - Get a specific match by ID

3. **`getAllMatches()`**
   - Uses: `GET /read/Matches?Instance=55050_multiplayer_arcade`
   - Get all matches

4. **`searchMatches(searchCriteria)`**
   - Uses: `POST /search/Matches?Instance=55050_multiplayer_arcade`
   - Search matches by criteria

5. **`updateMatch(matchId, matchData)`**
   - Uses: `PUT /update/Matches/{id}?Instance=55050_multiplayer_arcade`
   - Update a match record

6. **`deleteMatch(matchId)`**
   - Uses: `DELETE /delete/Matches/{id}?Instance=55050_multiplayer_arcade`
   - Delete a match record

7. **`getLeaderboard(gameType?)`**
   - Uses: `getAllMatches()` or `searchMatches()` internally
   - Aggregates wins and returns top 10 players
   - Not yet integrated into UI

---

## Example Usage

### Save a Match:
```javascript
import { saveMatch } from './services/db'

await saveMatch({
  gameType: 'pong',
  winnerId: 'user-123',
  winnerName: 'Alice',
  winnerScore: 5,
  loserId: 'user-456',
  loserName: 'Bob',
  loserScore: 3,
  roomId: 'room-789'
})
```

### Get Leaderboard:
```javascript
import { getLeaderboard } from './services/db'

// Get all matches
const allMatches = await getLeaderboard()

// Get pong matches only
const pongMatches = await getLeaderboard('pong')
```

---

## Notes

- All endpoints require the `Authorization: Bearer {API_KEY}` header
- The API key is stored in `VITE_NOCODE_BACKEND_KEY` environment variable
- Instance is specified in the API docs URL but not needed in endpoint URLs
- Table name is case-sensitive: `Matches` (capital M)

