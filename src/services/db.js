/**
 * NoCodeBackend Database Service
 * Handles match history persistence and leaderboard queries
 */

// NoCodeBackend configuration
const NOCODE_BACKEND_URL = import.meta.env.VITE_NOCODE_BACKEND_URL || 'https://api.nocodebackend.com'
const API_KEY = import.meta.env.VITE_NOCODE_BACKEND_KEY || 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
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
 * Save a completed match to NoCodeBackend
 * @param {Object} matchData - Match data to save
 * @param {string} matchData.gameType - Type of game (e.g., 'pong')
 * @param {string} matchData.winnerId - User profile ID of the winner
 * @param {string} matchData.winnerName - Name of the winner
 * @param {number} matchData.winnerScore - Final score of the winner
 * @param {string} matchData.loserId - User profile ID of the loser (optional)
 * @param {string} matchData.loserName - Name of the loser (optional)
 * @param {number} matchData.loserScore - Final score of the loser (optional)
 * @param {string} matchData.roomId - Room ID where the match was played (optional)
 * @returns {Promise<Object>} Response from NoCodeBackend
 */
export async function saveMatch(matchData) {
  try {
    const url = buildUrl('/create/Matches')
    const now = new Date()
    const dateString = now.toISOString().slice(0, 19).replace('T', ' ') // Format: "2026-01-01 00:00:00"
    
    const response = await apiRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        // Don't send MatchID - it's auto-incremented by database
        GameType: matchData.gameType,
        WinnerID: matchData.winnerId,
        WinnerName: matchData.winnerName,
        WinnerScore: matchData.winnerScore,
        LoserID: matchData.loserId || null,
        LoserName: matchData.loserName || null,
        LoserScore: matchData.loserScore || null,
        RoomID: matchData.roomId || null,
        MatchDate: dateString,
        CreatedAt: dateString,
        timestamp: dateString
      })
    })

    console.log('[NoCodeBackend] Match saved successfully:', response)
    return response
  } catch (error) {
    console.error('[NoCodeBackend] Error saving match:', error)
    // Don't throw - allow game to continue even if save fails
    return null
  }
}

/**
 * Get a specific match by ID
 * @param {string|number} matchId - Match ID
 * @returns {Promise<Object>} Match data
 */
export async function getMatch(matchId) {
  try {
    const url = buildUrl(`/read/Matches/${matchId}`)
    return await apiRequest(url, { method: 'GET' })
  } catch (error) {
    console.error('[NoCodeBackend] Error getting match:', error)
    return null
  }
}

/**
 * Update a match record
 * @param {string|number} matchId - Match ID
 * @param {Object} matchData - Updated match data
 * @returns {Promise<Object>} Updated match data
 */
export async function updateMatch(matchId, matchData) {
  try {
    const url = buildUrl(`/update/Matches/${matchId}`)
    return await apiRequest(url, {
      method: 'PUT',
      body: JSON.stringify(matchData)
    })
  } catch (error) {
    console.error('[NoCodeBackend] Error updating match:', error)
    return null
  }
}

/**
 * Delete a match record
 * @param {string|number} matchId - Match ID
 * @returns {Promise<boolean>} Success status
 */
export async function deleteMatch(matchId) {
  try {
    const url = buildUrl(`/delete/Matches/${matchId}`)
    await apiRequest(url, { method: 'DELETE' })
    return true
  } catch (error) {
    console.error('[NoCodeBackend] Error deleting match:', error)
    return false
  }
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
 * Get the top 10 winners from NoCodeBackend
 * @param {string} gameType - Optional filter by game type (e.g., 'pong')
 * @returns {Promise<Array>} Array of top 10 winners with win counts
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
      .slice(0, 10)

    console.log('[NoCodeBackend] Leaderboard fetched:', leaderboard.length, 'players')
    return leaderboard
  } catch (error) {
    console.error('[NoCodeBackend] Error fetching leaderboard:', error)
    // Return empty array on error so UI doesn't break
    return []
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
    const dateString = now.toISOString().slice(0, 19).replace('T', ' ') // Format: "2026-01-01 00:00:00"
    
    const payload = {
      name: profileData.name,
      color: profileData.color || null,
      emoji: profileData.emoji || null,
      createdAt: dateString,
      lastSeen: dateString
    }
    
    console.log('[NoCodeBackend] Saving profile:', { url, payload })
    
    // Don't send 'id' - it's auto-generated by NoCodeBackend
    const response = await apiRequest(url, {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    console.log('[NoCodeBackend] Profile save response:', response)
    
    // Validate response
    if (!response || !response.id) {
      console.error('[NoCodeBackend] Invalid response - missing ID:', response)
      throw new Error(`Invalid response from NoCodeBackend: missing profile ID. Response: ${JSON.stringify(response)}`)
    }
    
    // API returns { status: "success", message: "...", id: number }
    // Return the full profile data with the ID from the response
    const savedProfile = {
      id: response.id,
      name: profileData.name,
      color: profileData.color || null,
      emoji: profileData.emoji || null,
      createdAt: dateString,
      lastSeen: dateString,
      status: response.status,
      message: response.message
    }
    
    console.log('[NoCodeBackend] Profile saved successfully:', savedProfile)
    return savedProfile
  } catch (error) {
    console.error('[NoCodeBackend] Error saving profile:', error)
    console.error('[NoCodeBackend] Error details:', {
      message: error.message,
      stack: error.stack,
      profileData: profileData
    })
    // Throw the error so createProfile can handle it properly
    throw error
  }
}

/**
 * Get all profiles from NoCodeBackend
 * @returns {Promise<Array>} Array of profiles
 */
export async function getAllProfilesFromNCB() {
  try {
    // Use read endpoint with a high limit to get ALL profiles
    // NoCodeBackend read endpoint has pagination with default limit of 10
    // We'll use limit=1000 to ensure we get all profiles
    const url = buildUrl('/read/userprofiles', { limit: 1000 })
    const response = await apiRequest(url, { method: 'GET' })
    
    console.log('[getAllProfilesFromNCB] Raw response type:', typeof response, Array.isArray(response) ? 'array' : 'object')
    console.log('[getAllProfilesFromNCB] Raw response keys:', response && typeof response === 'object' ? Object.keys(response) : 'N/A')
    
    // Handle different response formats
    let profiles = []
    if (Array.isArray(response)) {
      profiles = response
      console.log('[getAllProfilesFromNCB] Response is array, length:', profiles.length)
    } else if (response && response.data && Array.isArray(response.data)) {
      profiles = response.data
      console.log('[getAllProfilesFromNCB] Found profiles in response.data, length:', profiles.length)
    } else if (response && response.profiles && Array.isArray(response.profiles)) {
      profiles = response.profiles
      console.log('[getAllProfilesFromNCB] Found profiles in response.profiles, length:', profiles.length)
    } else if (response && response.status === 'success' && response.data && Array.isArray(response.data)) {
      // Handle { status: "success", data: [...] } format
      profiles = response.data
      console.log('[getAllProfilesFromNCB] Found profiles in response.status=success.data, length:', profiles.length)
    } else {
      console.warn('[getAllProfilesFromNCB] Unexpected response format:', response)
      // Return empty array instead of crashing
      profiles = []
    }
    
    console.log('[getAllProfilesFromNCB] Extracted profiles:', profiles.length)
    
    // Check if there are more pages (pagination)
    if (response && response.metadata && response.metadata.hasMore) {
      console.warn('[getAllProfilesFromNCB] There are more profiles available (pagination). Current limit may not be enough.')
      console.log('[getAllProfilesFromNCB] Metadata:', response.metadata)
    }
    
    // Transform to match frontend profile format
    // CRITICAL: Always use emoji/color from NoCodeBackend - never assign based on index
    // Index-based assignment causes different emojis for the same profile
    const transformed = profiles.map((profile) => {
      // Use exactly what's in NoCodeBackend - no fallbacks, no index-based assignment
      // If emoji/color is missing, it means it's not set in NoCodeBackend and should remain null
      const emoji = profile.emoji || null
      const color = profile.color || null
      
      return {
        id: profile.id.toString(), // Convert to string for consistency
        name: profile.name,
        createdAt: profile.createdAt || profile.created_at || new Date().toISOString(),
        emoji: emoji, // Use emoji from NoCodeBackend exactly as stored
        animal: emoji, // Keep animal for backward compatibility (same as emoji)
        color: color, // Use color from NoCodeBackend exactly as stored
        isActive: false, // NoCodeBackend doesn't track active status
        scores: {},
        source: 'nocodebackend'
      }
    })
    
    console.log('[getAllProfilesFromNCB] Transformed profiles:', transformed.length)
    return transformed
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
    // Ensure profileId is a string for the URL
    const profileIdStr = String(profileId)
    const url = buildUrl(`/read/userprofiles/${profileIdStr}`)
    
    console.log('[NoCodeBackend] Fetching profile:', { profileId, profileIdStr, url })
    
    const response = await apiRequest(url, { method: 'GET' })
    
    console.log('[NoCodeBackend] Profile response:', response)
    
    // Handle different response formats
    let profile = null
    if (Array.isArray(response)) {
      // If response is an array, take the first item
      profile = response[0]
    } else if (response && response.id) {
      // Direct profile object
      profile = response
    } else if (response && response.data) {
      // Wrapped in data property
      profile = Array.isArray(response.data) ? response.data[0] : response.data
    } else if (response && response.status === 'success' && response.data) {
      // Success response with data
      profile = Array.isArray(response.data) ? response.data[0] : response.data
    }
    
    if (!profile || !profile.id) {
      console.warn('[NoCodeBackend] Profile not found or invalid response:', { profileId, response })
      return null
    }
    
    // Transform to match frontend profile format
    const transformed = {
      id: profile.id.toString(),
      name: profile.name,
      createdAt: profile.createdAt || profile.created_at || new Date().toISOString(),
      lastSeen: profile.lastSeen || profile.last_seen || new Date().toISOString(),
      emoji: profile.emoji || null,
      color: profile.color || null
    }
    
    console.log('[NoCodeBackend] Transformed profile:', transformed)
    return transformed
  } catch (error) {
    console.error('[NoCodeBackend] Error getting profile:', error)
    console.error('[NoCodeBackend] Error details:', {
      profileId,
      message: error.message,
      stack: error.stack
    })
    return null
  }
}

/**
 * Update a user profile in NoCodeBackend
 * @param {number|string} profileId - Profile ID from NoCodeBackend
 * @param {Object} updateData - Data to update (e.g., { lastSeen: "2026-01-01 00:00:00" })
 * @returns {Promise<Object>} Response from NoCodeBackend
 */
export async function updateProfile(profileId, updateData) {
  try {
    const url = buildUrl(`/update/userprofiles/${profileId}`)
    const response = await apiRequest(url, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    })

    console.log('[NoCodeBackend] Profile updated successfully:', response)
    return response
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

