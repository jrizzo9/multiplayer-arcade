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

// Get all profiles from NoCodeBackend only
export async function getAllProfiles(forceRefresh = false) {
  // If forcing refresh, clear cache and promise
  if (forceRefresh) {
    profilesCache = null
    profilesLoadPromise = null
  }
  
  // If there's a pending load and we're not forcing refresh, return it
  if (profilesLoadPromise && !forceRefresh) {
    return profilesLoadPromise
  }
  
  console.log('[getAllProfiles] Fetching profiles from NoCodeBackend...', forceRefresh ? '(forced refresh)' : '')
  
  profilesLoadPromise = (async () => {
    try {
      const { getAllProfilesFromNCB } = await import('../services/db')
      const ncbProfiles = await getAllProfilesFromNCB()
      console.log('[getAllProfiles] Loaded', ncbProfiles.length, 'profiles from NoCodeBackend')
      
      profilesCache = ncbProfiles
      return profilesCache
    } catch (error) {
      console.error('[getAllProfiles] Error loading NoCodeBackend profiles:', error)
      profilesCache = []
      return []
    } finally {
      profilesLoadPromise = null
    }
  })()
  
  return profilesLoadPromise
}

// Get a specific profile by ID or name
export async function getProfile(profileIdOrName) {
  const profiles = await getAllProfiles()
  return profiles.find(p => p.id === profileIdOrName || p.name === profileIdOrName) || null
}

// Create a new profile in NoCodeBackend
export async function createProfile(name) {
  try {
    console.log('[createProfile] Creating profile with name:', name)
    const { saveProfile } = await import('../services/db')
    const { getProfileAnimal } = await import('./playerColors')
    
    // Get existing profiles to determine the index for color/emoji assignment
    const existingProfiles = await getAllProfiles()
    const profileIndex = existingProfiles.length
    
    // Get color and emoji for this profile index
    const { color, emoji } = getProfileAnimal(profileIndex)
    
    console.log('[createProfile] Assigning color and emoji:', { color, emoji, profileIndex })
    
    // Create profile in NoCodeBackend with color and emoji
    console.log('[createProfile] Calling saveProfile...')
    const result = await saveProfile({
      name: name.trim(),
      color: color,
      emoji: emoji
    })
    
    console.log('[createProfile] saveProfile returned:', result)
    
    if (!result || !result.id) {
      console.error('[createProfile] Invalid response from saveProfile:', result)
      throw new Error('Failed to create profile in NoCodeBackend: Invalid response - no profile ID returned')
    }
    
    // Clear cache to force reload on next getAllProfiles call
    profilesCache = null
    profilesLoadPromise = null
    
    // Small delay to ensure NoCodeBackend has processed the creation
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Transform to frontend format
    const newProfile = {
      id: result.id.toString(), // Convert numeric ID to string
      name: result.name || name.trim(), // Use name from result or fallback to input
      createdAt: result.createdAt || new Date().toISOString(),
      emoji: result.emoji || emoji, // Add emoji property for direct access
      animal: result.emoji || emoji, // Keep animal for backward compatibility
      color: result.color || color,   // Use color from result or assigned color
      scores: {},
      source: 'nocodebackend'
    }
    
    console.log('[createProfile] Created profile successfully:', newProfile)
    return newProfile
  } catch (error) {
    console.error('[createProfile] Error creating profile:', error)
    console.error('[createProfile] Error stack:', error.stack)
    // Re-throw with more context
    const errorMessage = error.message || 'Failed to create profile. Please check your connection and try again.'
    throw new Error(errorMessage)
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

// Delete a profile from NoCodeBackend
export async function deleteProfile(profileIdOrName) {
  try {
    // Get profile to find the ID if name was provided
    const profile = await getProfile(profileIdOrName)
    if (!profile) {
      throw new Error('Profile not found')
    }
    
    // Use the profile ID directly (already a string from NoCodeBackend)
    const { deleteProfile: deleteNCBProfile } = await import('../services/db')
    const success = await deleteNCBProfile(profile.id)
    
    if (!success) {
      throw new Error('Failed to delete profile from NoCodeBackend')
    }
    
    // Clear current profile if it was deleted
    if (currentProfileName === profileIdOrName || currentProfileName === profile.name) {
      currentProfileName = null
      localStorage.removeItem('multiplayer_arcade_current_profile_name')
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
  const profile = await getProfile(currentProfileName)
  // Ensure profile has emoji property (should always be set from NoCodeBackend)
  if (profile && !profile.emoji && profile.animal) {
    profile.emoji = profile.animal
  }
  return profile
}

// Set current profile (stored in memory and localStorage)
// Note: NoCodeBackend doesn't track active sessions, so we only store locally
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
  
  // Update lastSeen in NoCodeBackend
  if (profileName) {
    try {
      const profile = await getProfile(profileName)
      if (profile) {
        const { updateProfile } = await import('../services/db')
        const now = new Date()
        const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
        await updateProfile(profile.id, { lastSeen: dateString })
      }
    } catch (error) {
      console.error('Error updating profile lastSeen:', error)
    }
  }
}

// Clear current profile (remove from memory and localStorage)
export async function clearCurrentProfile() {
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

