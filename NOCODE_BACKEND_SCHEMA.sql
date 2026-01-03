-- ============================================
-- NoCodeBackend Database Schema
-- Multiplayer Arcade - Complete Schema Script
-- ============================================
-- Run this entire script in your NoCodeBackend SQL editor
-- This script is idempotent - safe to run multiple times
-- Instance: 55050_multiplayer_arcade
-- ============================================

-- ============================================
-- 1. MATCHES TABLE (Match History)
-- ============================================
-- Stores individual match results with winner/loser information

-- Drop existing table if needed (uncomment if you need to recreate)
-- DROP TABLE IF EXISTS matches;

CREATE TABLE IF NOT EXISTS matches (
    MatchID INT AUTO_INCREMENT PRIMARY KEY,
    GameType VARCHAR(255) NOT NULL,
    WinnerID VARCHAR(255) NOT NULL,
    WinnerName VARCHAR(255) NOT NULL,
    WinnerScore INT NOT NULL,
    LoserID VARCHAR(255) NULL,
    LoserName VARCHAR(255) NULL,
    LoserScore INT NULL,
    RoomID VARCHAR(255) NULL,
    MatchDate DATETIME NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    timestamp DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create indexes for matches table
-- Note: If indexes already exist, these will fail - that's okay, just skip them
CREATE INDEX idx_matches_gameType ON matches(GameType);
CREATE INDEX idx_matches_winnerId ON matches(WinnerID);
CREATE INDEX idx_matches_loserId ON matches(LoserID);
CREATE INDEX idx_matches_timestamp ON matches(timestamp);
CREATE INDEX idx_matches_roomId ON matches(RoomID);
CREATE INDEX idx_matches_matchDate ON matches(MatchDate);
CREATE INDEX idx_matches_createdAt ON matches(CreatedAt);

-- ============================================
-- 2. USERPROFILES TABLE (User Profiles)
-- ============================================
-- Stores user profile information with auto-generated IDs

-- Drop existing table if needed (uncomment if you need to recreate)
-- DROP TABLE IF EXISTS userprofiles;

CREATE TABLE IF NOT EXISTS userprofiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    color VARCHAR(255) NULL,
    emoji VARCHAR(255) NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create indexes for userprofiles table
-- Note: If indexes already exist, these will fail - that's okay, just skip them
CREATE INDEX idx_userprofiles_name ON userprofiles(name);
CREATE INDEX idx_userprofiles_lastSeen ON userprofiles(lastSeen);
CREATE INDEX idx_userprofiles_createdAt ON userprofiles(createdAt);

-- ============================================
-- 3. ALTER EXISTING TABLES (Optional - only if needed)
-- ============================================
-- Uncomment and run these if you need to add missing columns to existing tables

-- Add missing columns to matches table (run only if columns don't exist)
-- ALTER TABLE matches ADD COLUMN timestamp DATETIME NULL;
-- ALTER TABLE matches ADD COLUMN MatchDate DATETIME NULL;

-- If userprofiles table has VARCHAR id instead of INT, you'll need to migrate
-- This requires backing up data, dropping the table, and recreating with INT id
-- Uncomment the DROP statement above and recreate the table

-- ============================================
-- 4. VERIFICATION QUERIES
-- ============================================
-- Run these to verify the schema is correct

-- Check matches table structure
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
-- FROM information_schema.COLUMNS 
-- WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matches'
-- ORDER BY ORDINAL_POSITION;

-- Check userprofiles table structure
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
-- FROM information_schema.COLUMNS 
-- WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'userprofiles'
-- ORDER BY ORDINAL_POSITION;

-- Check indexes
-- SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME 
-- FROM information_schema.STATISTICS 
-- WHERE TABLE_SCHEMA = DATABASE() 
-- AND TABLE_NAME IN ('matches', 'userprofiles')
-- ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

-- ============================================
-- SCHEMA SUMMARY
-- ============================================
-- 
-- MATCHES TABLE:
--   - MatchID: Auto-increment primary key
--   - GameType: Game type (pong, snake, memory, magnet-mayhem)
--   - WinnerID: User profile ID of winner
--   - WinnerName: Name of winner
--   - WinnerScore: Final score of winner
--   - LoserID: User profile ID of loser (nullable)
--   - LoserName: Name of loser (nullable)
--   - LoserScore: Final score of loser (nullable)
--   - RoomID: Room ID where match was played (nullable)
--   - MatchDate: Date/time of match (nullable)
--   - CreatedAt: Auto-set timestamp
--   - timestamp: Additional timestamp field (nullable)
--
-- USERPROFILES TABLE:
--   - id: Auto-increment primary key (INT, not VARCHAR)
--   - name: Profile name (unique, required)
--   - color: Hex color code (nullable)
--   - emoji: Emoji character (nullable)
--   - createdAt: Auto-set timestamp
--   - lastSeen: Auto-updated timestamp
--
-- NOTES:
--   1. All table names are lowercase to match NoCodeBackend API
--   2. Field names use PascalCase to match API expectations
--   3. NoCodeBackend uses MariaDB/MySQL syntax
--   4. AUTO_INCREMENT is used for primary keys
--   5. VARCHAR(255) is used instead of TEXT for better indexing
--   6. utf8mb4 charset supports emoji characters
--   7. Indexes are created for commonly queried fields
-- ============================================

