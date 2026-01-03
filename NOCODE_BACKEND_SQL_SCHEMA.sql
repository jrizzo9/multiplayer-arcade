-- NoCodeBackend Database Schema
-- Run these CREATE statements in your NoCodeBackend SQL editor
-- Note: Table names must be lowercase (matches) to match the API

-- ============================================
-- 1. Matches Table (Match History)
-- ============================================
-- Drop table if it exists with wrong case, then create with lowercase name
DROP TABLE IF EXISTS Matches;
DROP TABLE IF EXISTS matches;

-- Create the table with lowercase name (matches) but PascalCase field names to match the API
-- Note: NoCodeBackend uses MariaDB syntax and table names are case-sensitive
CREATE TABLE matches (
    MatchID INT AUTO_INCREMENT PRIMARY KEY,
    GameType VARCHAR(255) NOT NULL,
    WinnerID VARCHAR(255) NOT NULL,
    WinnerName VARCHAR(255) NOT NULL,
    WinnerScore INT NOT NULL,
    LoserID VARCHAR(255),
    LoserName VARCHAR(255),
    LoserScore INT,
    RoomID VARCHAR(255),
    MatchDate DATETIME,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    timestamp DATETIME
);

-- Indexes for matches table
CREATE INDEX idx_matches_gameType ON matches(GameType);
CREATE INDEX idx_matches_winnerId ON matches(WinnerID);
CREATE INDEX idx_matches_timestamp ON matches(timestamp);
CREATE INDEX idx_matches_roomId ON matches(RoomID);
CREATE INDEX idx_matches_matchDate ON matches(MatchDate);

-- ============================================
-- 2. UserProfiles Table
-- ============================================
-- Stores user profile information
CREATE TABLE IF NOT EXISTS userprofiles (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    color VARCHAR(255),
    emoji VARCHAR(255),
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for userprofiles table
CREATE INDEX idx_userprofiles_name ON userprofiles(name);
CREATE INDEX idx_userprofiles_lastSeen ON userprofiles(lastSeen);

-- ============================================
-- 3. PlayerStats Table (Optional - for aggregated statistics)
-- ============================================
-- Stores aggregated player statistics per game type
CREATE TABLE IF NOT EXISTS playerstats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userProfileId VARCHAR(255) NOT NULL,
    gameType VARCHAR(255) NOT NULL,
    totalWins INT DEFAULT 0,
    totalLosses INT DEFAULT 0,
    totalMatches INT DEFAULT 0,
    bestScore INT DEFAULT 0,
    averageScore DECIMAL(10,2) DEFAULT 0,
    lastPlayed DATETIME,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_game (userProfileId, gameType)
);

-- Indexes for playerstats table
CREATE INDEX idx_playerstats_userProfileId ON playerstats(userProfileId);
CREATE INDEX idx_playerstats_gameType ON playerstats(gameType);
CREATE INDEX idx_playerstats_totalWins ON playerstats(totalWins);

-- ============================================
-- Notes:
-- ============================================
-- 1. Matches table stores individual match results
-- 2. UserProfiles table stores player profile data
-- 3. PlayerStats table can be updated via triggers or application logic
--    to aggregate statistics from Matches table
-- 4. All timestamps use DATETIME type (MariaDB compatible)
-- 5. NoCodeBackend uses MariaDB, so use VARCHAR instead of TEXT
-- 6. AUTO_INCREMENT instead of AUTOINCREMENT
-- 7. INT instead of INTEGER

