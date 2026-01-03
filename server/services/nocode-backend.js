/**
 * NoCodeBackend Service (Server-side)
 * Handles match history and leaderboard queries from the server
 */

// NoCodeBackend configuration
const NOCODE_BACKEND_URL = process.env.NOCODE_BACKEND_URL || 'https://api.nocodebackend.com'
const API_KEY = process.env.NOCODE_BACKEND_KEY || 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

// Helper function to build URL with Instance parameter and optional query params
function buildUrl(endpoint, params = {}) {
  const baseUrl = `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
  const queryParams = new URLSearchParams(params).toString()
  return queryParams ? `${baseUrl}&${queryParams}` : baseUrl
}

// Helper function for API requests
async function apiRequest(url, options = {}) {
  const defaultHeaders = {
    'accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API request failed: ${response.status} ${errorText}`)
  }

  return response.json()
}

/**
 * Get all matches from NoCodeBackend
 * @returns {Promise<Array>} Array of all matches
 */
export async function getAllMatches() {
  try {
    const url = buildUrl('/read/Matches')
    const matches = await apiRequest(url, { method: 'GET' })
    return Array.isArray(matches) ? matches : []
  } catch (error) {
    console.error('[NoCodeBackend] Error getting all matches:', error)
    return []
  }
}

/**
 * Search matches by criteria
 * @param {Object} searchCriteria - Search criteria (e.g., { gameType: 'pong' })
 * @returns {Promise<Array>} Array of matching matches
 */
export async function searchMatches(searchCriteria) {
  try {
    const url = buildUrl('/search/Matches')
    const matches = await apiRequest(url, {
      method: 'POST',
      body: JSON.stringify(searchCriteria)
    })
    return Array.isArray(matches) ? matches : []
  } catch (error) {
    console.error('[NoCodeBackend] Error searching matches:', error)
    return []
  }
}

/**
 * Get the top winners from NoCodeBackend
 * @param {string} gameType - Optional filter by game type (e.g., 'pong')
 * @returns {Promise<Array>} Array of winners with win counts
 */
export async function getLeaderboard(gameType = null) {
  try {
    let matches = []
    
    if (gameType) {
      // Use search endpoint to filter by gameType
      matches = await searchMatches({ gameType })
    } else {
      // Get all matches
      matches = await getAllMatches()
    }

    // Aggregate wins by WinnerID (PascalCase from API)
    const winCounts = {}
    matches.forEach(match => {
      const winnerId = match.WinnerID || match.winnerId
      if (winnerId) {
        if (!winCounts[winnerId]) {
          winCounts[winnerId] = {
            winnerId: winnerId,
            winnerName: match.WinnerName || match.winnerName || 'Unknown',
            wins: 0,
            totalScore: 0,
            gameType: match.GameType || match.gameType
          }
        }
        winCounts[winnerId].wins++
        winCounts[winnerId].totalScore += (match.WinnerScore || match.winnerScore || 0)
      }
    })

    // Convert to array and sort by wins (descending)
    const leaderboard = Object.values(winCounts)
      .sort((a, b) => b.wins - a.wins)

    return leaderboard
  } catch (error) {
    console.error('[NoCodeBackend] Error fetching leaderboard:', error)
    return []
  }
}

/**
 * Get win count for a specific player and game type
 * @param {string} userProfileId - User profile ID
 * @param {string} gameType - Game type (e.g., 'pong')
 * @returns {Promise<number>} Win count
 */
export async function getWinCount(userProfileId, gameType) {
  try {
    const matches = await searchMatches({ gameType })
    return matches.filter(match => {
      const winnerId = match.WinnerID || match.winnerId
      return winnerId === userProfileId
    }).length
  } catch (error) {
    console.error('[NoCodeBackend] Error getting win count:', error)
    return 0
  }
}

/**
 * Get wins for multiple players
 * @param {Array<string>} userProfileIds - Array of user profile IDs
 * @param {string} gameType - Game type (e.g., 'pong')
 * @returns {Promise<Object>} Object mapping userProfileId to win count
 */
export async function getWinsForPlayers(userProfileIds, gameType) {
  try {
    const matches = await searchMatches({ gameType })
    const wins = {}
    
    // Initialize all players with 0 wins
    userProfileIds.forEach(id => {
      wins[id] = 0
    })
    
    // Count wins for each player
    matches.forEach(match => {
      const winnerId = match.WinnerID || match.winnerId
      if (winnerId && wins.hasOwnProperty(winnerId)) {
        wins[winnerId]++
      }
    })
    
    return wins
  } catch (error) {
    console.error('[NoCodeBackend] Error getting wins for players:', error)
    // Return zeros for all players on error
    const wins = {}
    userProfileIds.forEach(id => {
      wins[id] = 0
    })
    return wins
  }
}

/**
 * Get all profiles from NoCodeBackend
 * @returns {Promise<Array>} Array of profiles
 */
export async function getAllProfiles() {
  try {
    const url = buildUrl('/read/userprofiles', { limit: 1000 })
    const response = await apiRequest(url, { method: 'GET' })
    
    // Handle different response formats
    let profiles = []
    if (Array.isArray(response)) {
      profiles = response
    } else if (response && response.data && Array.isArray(response.data)) {
      profiles = response.data
    } else if (response && response.profiles && Array.isArray(response.profiles)) {
      profiles = response.profiles
    } else if (response && response.status === 'success' && response.data && Array.isArray(response.data)) {
      profiles = response.data
    }
    
    return profiles
  } catch (error) {
    console.error('[NoCodeBackend] Error getting profiles:', error)
    return []
  }
}

/**
 * Get a single profile by ID from NoCodeBackend
 * @param {number|string} profileId - Profile ID from NoCodeBackend
 * @returns {Promise<Object|null>} Profile data or null if not found
 */
export async function getProfile(profileId) {
  try {
    const profileIdStr = String(profileId)
    const url = buildUrl(`/read/userprofiles/${profileIdStr}`)
    const response = await apiRequest(url, { method: 'GET' })
    
    // Handle different response formats
    let profile = null
    if (Array.isArray(response)) {
      profile = response[0]
    } else if (response && response.id) {
      profile = response
    } else if (response && response.data) {
      profile = Array.isArray(response.data) ? response.data[0] : response.data
    } else if (response && response.status === 'success' && response.data) {
      profile = Array.isArray(response.data) ? response.data[0] : response.data
    }
    
    if (!profile || !profile.id) {
      return null
    }
    
    return profile
  } catch (error) {
    console.error('[NoCodeBackend] Error getting profile:', error)
    return null
  }
}

/**
 * Create or update a user profile in NoCodeBackend
 * @param {Object} profileData - Profile data
 * @param {string} profileData.name - Player name
 * @param {string} profileData.color - Color hex code (optional)
 * @param {string} profileData.emoji - Emoji (optional)
 * @returns {Promise<Object>} Response from NoCodeBackend
 */
export async function saveProfile(profileData) {
  try {
    const url = buildUrl('/create/userprofiles')
    const now = new Date()
    const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
    
    const payload = {
      name: profileData.name,
      color: profileData.color || null,
      emoji: profileData.emoji || null,
      createdAt: dateString,
      lastSeen: dateString
    }
    
    const response = await apiRequest(url, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    
    if (!response || !response.id) {
      throw new Error(`Invalid response from NoCodeBackend: missing profile ID`)
    }
    
    return {
      id: response.id,
      name: profileData.name,
      color: profileData.color || null,
      emoji: profileData.emoji || null,
      createdAt: dateString,
      lastSeen: dateString
    }
  } catch (error) {
    console.error('[NoCodeBackend] Error saving profile:', error)
    throw error
  }
}

/**
 * Update a user profile in NoCodeBackend
 * @param {number|string} profileId - Profile ID from NoCodeBackend
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Response from NoCodeBackend
 */
export async function updateProfile(profileId, updateData) {
  try {
    const url = buildUrl(`/update/userprofiles/${profileId}`)
    return await apiRequest(url, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    })
  } catch (error) {
    console.error('[NoCodeBackend] Error updating profile:', error)
    return null
  }
}

/**
 * Delete a user profile from NoCodeBackend
 * @param {number|string} profileId - Profile ID from NoCodeBackend
 * @returns {Promise<boolean>} Success status
 */
export async function deleteProfile(profileId) {
  try {
    const url = buildUrl(`/delete/userprofiles/${profileId}`)
    await apiRequest(url, { method: 'DELETE' })
    return true
  } catch (error) {
    console.error('[NoCodeBackend] Error deleting profile:', error)
    return false
  }
}

