# Application Architecture & Deployment Analysis

**Generated:** 2025-01-27  
**Purpose:** Comprehensive technical analysis for deployment planning

---

## 1. Frontend Configuration

### Build Command
```bash
npm run build
```
- **Script:** `vite build` (defined in `package.json`)
- **Framework:** Vite 5.0.8 with React 18.2.0

### Output Directory
- **Path:** `dist/`
- **Default Vite output:** Static files in `dist/` directory
- **Contents:**
  - `dist/index.html`
  - `dist/assets/` (JS and CSS bundles)

### Socket Connection Initialization
- **File:** `src/utils/socket.js`
- **Current Implementation:**
  ```javascript
  const hostname = window.location.hostname
  const serverUrl = `http://${hostname}:8000`
  socketInstance = io(serverUrl, {...})
  ```
- **Issue:** Hardcoded port `8000` - does NOT use environment variables

### Environment Variables (Frontend)

#### Currently Used:
- **`VITE_API_URL`** - Used in multiple files for API calls:
  - `src/utils/profiles.js`
  - `src/components/ProfileSelector.jsx`
  - `src/components/ActiveProfilesManager.jsx`
  - `src/components/PlayerProfile.jsx`
  - `src/utils/playerColors.js`
  - `src/utils/pongOnlineGame.js` (also uses `VITE_API_BASE` and `VITE_USE_API`)

#### Fallback Behavior:
- If `VITE_API_URL` is not set, components fall back to: `http://${window.location.hostname}:8000`
- **Critical Gap:** `src/utils/socket.js` does NOT check for `VITE_API_URL` - it always uses hardcoded port 8000

#### Missing Environment Variable:
- **Socket Connection:** No environment variable support. Should use `VITE_SERVER_URL` or `VITE_API_URL` for WebSocket connection.

---

## 2. Backend Configuration

### Start Command
```bash
cd server && npm start
```
- **Script:** `node index.js` (defined in `server/package.json`)
- **Entry Point:** `server/index.js`

### Port Configuration
- **Current:** Hardcoded constant
  ```javascript
  const PORT = 8000
  ```
- **Location:** `server/index.js:3916`
- **Issue:** **NO environment variable support** - does not check `process.env.PORT`
- **Binding:** Listens on `0.0.0.0` (all interfaces)

### CORS Configuration
- **Location:** `server/index.js:13-34`
- **Current Implementation:** Hardcoded regex patterns:
  ```javascript
  const allowedOrigins = [
    /^http:\/\/localhost:3000$/,
    /^http:\/\/127\.0\.0\.1:3000$/,
    /^http:\/\/192\.168\.\d+\.\d+:3000$/, // 192.168.x.x
    /^http:\/\/10\.\d+\.\d+\.\d+:3000$/,  // 10.x.x.x
    /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:3000$/ // 172.16-31.x.x
  ]
  ```
- **Issue:** **NO environment variable support** - does not check `process.env.CLIENT_URL` or `process.env.CORS_ORIGIN`
- **Applied to:** Both Express CORS middleware and Socket.IO CORS config

### Environment Variables (Backend)
- **Currently Used:** NONE
- **Missing Variables:**
  - `PORT` - Should default to 8000 but allow override
  - `CLIENT_URL` or `CORS_ORIGIN` - Should allow dynamic CORS configuration
  - `NODE_ENV` - Not explicitly checked (could be used for dev vs prod configs)

---

## 3. Data Persistence

### Database Type
- **Technology:** SQLite3 (`better-sqlite3` v12.5.0)
- **File Location:** `server/multiplayer-arcade.db`
- **Database File:** Created at runtime in `server/` directory

### Database Schema
- **Tables:**
  - `rooms` - Game room metadata
  - `user_profiles` - User profile data
  - `players` - Active player sessions
  - `game_history` - Game event logs
  - `player_colors` - Available player colors
  - `active_sessions` - Active user sessions
  - `game_wins` - Win statistics

### Persistence Mechanism
- **File-based:** SQLite database file stored on local filesystem
- **Initialization:** `server/db.js` creates tables on first run
- **Migration:** Automatic schema migration on startup
- **Connection:** Single database connection per server instance

### In-Memory State
- **Location:** `server/index.js:96`
- **Storage:** `const rooms = new Map()` - Active game rooms stored in memory
- **Purpose:** Real-time game state (not persisted to database)

### Deployment Risk: Filesystem Dependency
- **CRITICAL:** SQLite database file (`multiplayer-arcade.db`) is stored in the `server/` directory
- **Issue:** Serverless platforms (Vercel, AWS Lambda) have ephemeral filesystems
- **Impact:** 
  - Database will be lost on serverless function restarts
  - No persistent storage between deployments
  - Not suitable for production serverless deployment without external storage

### Recommended Solutions:
1. **Use external database:** PostgreSQL, MySQL, or managed SQLite service
2. **Use persistent volume:** If deploying to VPS/container (Docker volume, EBS, etc.)
3. **Migrate to cloud database:** Use a managed database service

---

## 4. Directory Structure

### Root Paths
- **Client Root:** `/Users/joshuarizzo/Apps/Multiplayer Arcade/` (project root)
- **Server Root:** `/Users/joshuarizzo/Apps/Multiplayer Arcade/server/`
- **Build Output:** `/Users/joshuarizzo/Apps/Multiplayer Arcade/dist/`

### Key Directories
```
/
├── src/              # Frontend source code
├── server/           # Backend source code
├── dist/             # Frontend build output
├── node_modules/     # Frontend dependencies
└── server/node_modules/  # Backend dependencies
```

### Deployment Configuration Files
- **vercel.json:** ❌ Not found
- **render.yaml:** ❌ Not found
- **.env files:** ❌ Not found (no environment variable templates)

---

## 5. Deployment Risks

### Critical Issues

#### 1. Hardcoded Port (Backend)
- **Location:** `server/index.js:3916`
- **Issue:** `const PORT = 8000` - does not use `process.env.PORT`
- **Impact:** Cannot override port for deployment platforms (Heroku, Render, Railway, etc.)
- **Fix Required:** Change to `const PORT = process.env.PORT || 8000`

#### 2. Hardcoded CORS Origins
- **Location:** `server/index.js:14-20`
- **Issue:** CORS origins are hardcoded regex patterns for localhost/local network
- **Impact:** Production domains will be blocked by CORS
- **Fix Required:** Add environment variable support:
  ```javascript
  const allowedOrigins = process.env.CLIENT_URL 
    ? [process.env.CLIENT_URL] 
    : [/* default localhost patterns */]
  ```

#### 3. Hardcoded Socket Connection (Frontend)
- **Location:** `src/utils/socket.js:12`
- **Issue:** Socket connection hardcoded to `http://${hostname}:8000`
- **Impact:** Will not work in production if server is on different domain/port
- **Fix Required:** Use environment variable:
  ```javascript
  const serverUrl = import.meta.env.VITE_SERVER_URL || `http://${hostname}:8000`
  ```

#### 4. SQLite Filesystem Dependency
- **Location:** `server/db.js:37`
- **Issue:** Database file created in `server/` directory
- **Impact:** Data loss on serverless deployments, container restarts
- **Fix Required:** Migrate to external database or use persistent volumes

#### 5. No Environment Variable Templates
- **Issue:** No `.env.example` or `.env.template` files
- **Impact:** Deployment configuration unclear
- **Fix Required:** Create environment variable documentation

### Medium Priority Issues

#### 6. Hardcoded Frontend Port References
- **Location:** `server/index.js:83` - `const frontendPort = 3000`
- **Issue:** Hardcoded in connection info endpoint
- **Impact:** May cause confusion in production
- **Fix Required:** Use environment variable or remove if not needed

#### 7. Localhost References in Code
- **Locations:** Multiple files reference `localhost` in comments and fallback logic
- **Impact:** May cause confusion but not blocking
- **Fix Required:** Update comments/documentation

---

## 6. Summary

### Frontend
- ✅ Build system: Vite (standard)
- ✅ Output directory: `dist/`
- ⚠️ Socket connection: Hardcoded port 8000 (needs env var)
- ⚠️ API URL: Uses `VITE_API_URL` but socket.js doesn't

### Backend
- ✅ Start command: `node index.js`
- ❌ Port: Hardcoded (needs `process.env.PORT`)
- ❌ CORS: Hardcoded origins (needs `CLIENT_URL` env var)
- ❌ Database: SQLite file (needs external DB for serverless)

### Deployment Readiness
- **Current Status:** ⚠️ **NOT READY** for production deployment
- **Blocking Issues:** 4 critical issues (port, CORS, socket URL, database)
- **Recommended Actions:**
  1. Add environment variable support for port and CORS
  2. Fix socket connection to use environment variable
  3. Migrate to external database (PostgreSQL recommended)
  4. Create `.env.example` template
  5. Test deployment on staging environment

---

## 7. Required Environment Variables

### Frontend (`.env` or build-time)
```
VITE_API_URL=https://api.yourdomain.com
VITE_SERVER_URL=wss://api.yourdomain.com  # For WebSocket
```

### Backend (`.env` or platform environment)
```
PORT=8000
CLIENT_URL=https://yourdomain.com
NODE_ENV=production
```

### Database (if migrating from SQLite)
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
# OR
DB_HOST=localhost
DB_PORT=5432
DB_NAME=multiplayer_arcade
DB_USER=username
DB_PASSWORD=password
```

---

**Next Steps:** See `DEPLOYMENT_GUIDE.md` (to be generated) for step-by-step deployment instructions.

