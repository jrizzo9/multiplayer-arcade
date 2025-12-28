// Profile management utility - loads from backend database only
// Use current hostname to support local network access (same as socket connections)
const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // Use current hostname and protocol (works for both localhost and IP access)
  // Always use the same protocol as the current page to avoid mixed content errors
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:8000`
}

// Cache for profiles
let profilesCache = null
let profilesLoadPromise = null

// Current profile stored in memory and localStorage for persistence
let currentProfileName = null

// Load current profile from localStorage on module load
const loadStoredProfile = () => {
  try {
    const stored = localStorage.getItem('multiplayer_arcade_current_profile_name')
    if (stored) {
      currentProfileName = stored
    }
  } catch (error) {
    console.error('Error loading stored profile:', error)
  }
}

// Initialize on module load
loadStoredProfile()

// Get all profiles from backend database
export async function getAllProfiles() {
  if (profilesLoadPromise) {
    return profilesLoadPromise
  }
  
  const apiUrl = `${getApiUrl()}/api/user-profiles`
  console.log('[getAllProfiles] Fetching profiles from:', apiUrl)
  
  profilesLoadPromise = fetch(apiUrl)
    .then(res => {
      console.log('[getAllProfiles] Response status:', res.status, res.statusText)
      if (!res.ok) {
        return res.text().then(text => {
          console.error('[getAllProfiles] Error response body:', text)
          throw new Error(`Failed to fetch profiles: ${res.status} ${res.statusText}`)
        })
      }
      return res.json()
    })
    .then(data => {
      console.log('[getAllProfiles] Received data:', data)
      if (!data || !data.profiles) {
        console.warn('[getAllProfiles] Invalid response format, expected { profiles: [...] }')
        profilesCache = []
        return []
      }
      // Transform backend format to frontend format
      profilesCache = data.profiles.map(p => ({
        id: p.id,
        name: p.name,
        createdAt: p.created_at,
        animal: p.emoji,
        color: p.color,
        isActive: p.isActive || false, // Profile is currently in use
        scores: {} // Scores are now stored in database, not in memory
      }))
      console.log('[getAllProfiles] Transformed profiles:', profilesCache.length, 'profiles')
      return profilesCache
    })
    .catch(error => {
      console.error('[getAllProfiles] Error loading profiles from backend:', error)
      console.error('[getAllProfiles] API URL was:', apiUrl)
      console.error('[getAllProfiles] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
      profilesCache = []
      return []
    })
    .finally(() => {
      profilesLoadPromise = null
    })
  
  return profilesLoadPromise
}

// Get a specific profile by ID or name
export async function getProfile(profileIdOrName) {
  const profiles = await getAllProfiles()
  return profiles.find(p => p.id === profileIdOrName || p.name === profileIdOrName) || null
}

// Create a new profile
export async function createProfile(name) {
  try {
    const response = await fetch(`${getApiUrl()}/api/user-profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: name.trim() })
    })
    
    if (!response.ok) {
      throw new Error('Failed to create profile')
    }
    
    const backendProfile = await response.json()
    
    // Clear cache to force reload
    profilesCache = null
    
    // Transform to frontend format
    const newProfile = {
      id: backendProfile.id,
      name: backendProfile.name,
      createdAt: new Date().toISOString(),
      animal: backendProfile.emoji,
      color: backendProfile.color,
      scores: {} // Scores are stored in database
    }
    
    return newProfile
  } catch (error) {
    console.error('Error creating profile:', error)
    throw error
  }
}

// Update a profile's score - scores are now tracked in the database via game events
// This function is kept for backward compatibility but scores are persisted via game_history table
export async function updateProfileScore(profileIdOrName, gameType, scoreData) {
  // Scores are now automatically tracked in the database via game_history events
  // This function is kept for backward compatibility but doesn't need to do anything
  // The backend tracks scores through game events (score_update, microgame_end, etc.)
  console.log('Profile score update requested:', { profileIdOrName, gameType, scoreData })
  return await getProfile(profileIdOrName)
}

// Delete a profile
export async function deleteProfile(profileIdOrName) {
  try {
    // Get profile to find the ID if name was provided
    const profile = await getProfile(profileIdOrName)
    if (!profile) {
      throw new Error('Profile not found')
    }
    
    const response = await fetch(`${getApiUrl()}/api/user-profiles/${profile.id}`, {
      method: 'DELETE'
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to delete profile' }))
      throw new Error(errorData.error || 'Failed to delete profile')
    }
    
    // Clear current profile if it was deleted
    if (currentProfileName === profileIdOrName || currentProfileName === profile.name) {
      currentProfileName = null
    }
    
    // Clear active session for deleted profile
    try {
      const response = await fetch(`${getApiUrl()}/api/user-profiles/${profile.id}/deactivate`, {
        method: 'POST'
      })
      if (!response.ok) {
        console.error('Failed to deactivate profile session on delete')
      }
    } catch (error) {
      console.error('Error deactivating profile session on delete:', error)
    }
    
    // Clear cache to force reload
    profilesCache = null
    
    // Reload profiles
    return await getAllProfiles()
  } catch (error) {
    console.error('Error deleting profile:', error)
    throw error
  }
}

// Get current selected profile (from memory only)
export async function getCurrentProfile() {
  if (!currentProfileName) return null
  return await getProfile(currentProfileName)
}

// Set current profile (stored in memory, localStorage, and database)
export async function setCurrentProfile(profileName) {
  currentProfileName = profileName
  
  // Persist to localStorage
  try {
    if (profileName) {
      localStorage.setItem('multiplayer_arcade_current_profile_name', profileName)
    } else {
      localStorage.removeItem('multiplayer_arcade_current_profile_name')
    }
    // Dispatch custom event to notify other components in the same window
    window.dispatchEvent(new Event('profile-selected'))
  } catch (error) {
    console.error('Error saving profile to localStorage:', error)
  }
  
  // Mark profile as active in database
  if (profileName) {
    try {
      const profile = await getProfile(profileName)
      if (profile) {
        const response = await fetch(`${getApiUrl()}/api/user-profiles/${profile.id}/activate`, {
          method: 'POST'
        })
        if (!response.ok) {
          console.error('Failed to activate profile session')
        }
      }
    } catch (error) {
      console.error('Error activating profile session:', error)
    }
  }
}

// Clear current profile (remove from memory, localStorage, and database)
export async function clearCurrentProfile() {
  if (currentProfileName) {
    try {
      const profile = await getProfile(currentProfileName)
      if (profile) {
        const response = await fetch(`${getApiUrl()}/api/user-profiles/${profile.id}/deactivate`, {
          method: 'POST'
        })
        if (!response.ok) {
          console.error('Failed to deactivate profile session')
        }
      }
    } catch (error) {
      console.error('Error deactivating profile session:', error)
    }
  }
  currentProfileName = null
  
  // Remove from localStorage
  try {
    localStorage.removeItem('multiplayer_arcade_current_profile_name')
    // Dispatch custom event to notify other components in the same window
    window.dispatchEvent(new Event('profile-cleared'))
  } catch (error) {
    console.error('Error removing profile from localStorage:', error)
  }
}

// Clear old localStorage profile data (migration helper)
// NOTE: Does NOT clear 'multiplayer_arcade_current_profile_name' as that's needed for persistence
export function clearLocalStorageProfiles() {
  try {
    // Remove all old profile-related localStorage data (but keep current profile name)
    localStorage.removeItem('multiplayer_arcade_profiles')
    localStorage.removeItem('multiplayer_arcade_current_profile')
    // Don't remove 'multiplayer_arcade_current_profile_name' - that's the new persistence mechanism
    // Remove all score keys
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('multiplayer_arcade_profile_scores_')) {
        localStorage.removeItem(key)
      }
    })
    console.log('Cleared old localStorage profile data (kept current profile)')
  } catch (error) {
    console.error('Error clearing localStorage:', error)
  }
}

// Check if a profile is a CPU player (auto-plays)
export function isCPUProfile(profile) {
  if (!profile) return false
  // Check by name (case-insensitive)
  const name = profile.name || ''
  const cpuNames = ['autobot', 'roboplayer']
  return cpuNames.includes(name.toLowerCase())
}

// Get profile statistics from the database
export async function getProfileStats(profileIdOrName, gameType = null) {
  const profile = await getProfile(profileIdOrName)
  if (!profile) {
    return {
      totalGames: 0,
      totalScore: 0,
      averageScore: 0,
      bestScore: 0,
      wins: 0,
      winRate: 0
    }
  }
  
  // Fetch stats from backend API
  const getApiUrl = () => {
    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL
    }
    // Always use the same protocol as the current page to avoid mixed content errors
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${window.location.hostname}:8000`
  }
  
  try {
    const response = await fetch(`${getApiUrl()}/api/user-profiles/${profile.id}${gameType ? `?gameType=${gameType}` : ''}`)
    if (!response.ok) {
      throw new Error('Failed to fetch profile stats')
    }
    const data = await response.json()
    
    if (gameType && data.stats?.byGame?.[gameType]) {
      const gameStats = data.stats.byGame[gameType]
      const averageScore = gameStats.gamesPlayed > 0
        ? Math.round(gameStats.totalScore / gameStats.gamesPlayed)
        : 0
      return {
        totalGames: gameStats.gamesPlayed || 0,
        totalScore: gameStats.totalScore || 0,
        averageScore,
        bestScore: gameStats.bestScore || 0,
        wins: 0, // Wins not tracked separately
        winRate: 0
      }
    }
    
    // Return overall stats
    const overall = data.stats?.overall || {}
    const averageScore = overall.gamesWithScore > 0
      ? Math.round(overall.totalScore / overall.gamesWithScore)
      : 0
    
    return {
      totalGames: overall.gamesWithScore || 0,
      totalScore: overall.totalScore || 0,
      averageScore,
      bestScore: overall.bestScore || 0,
      wins: 0,
      winRate: 0
    }
  } catch (error) {
    console.error('Error fetching profile stats:', error)
    return {
      totalGames: 0,
      totalScore: 0,
      averageScore: 0,
      bestScore: 0,
      wins: 0,
      winRate: 0
    }
  }
}

