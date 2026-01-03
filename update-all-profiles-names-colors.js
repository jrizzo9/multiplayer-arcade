/**
 * Script to update all profiles in NoCodeBackend with names and colors/emojis
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

const FALLBACK_COLORS = [
  { color: '#FF6B6B', emoji: '🦁' },
  { color: '#4ECDC4', emoji: '🐘' },
  { color: '#FFE66D', emoji: '🐼' },
  { color: '#95E1D3', emoji: '🦊' },
  { color: '#FF9F43', emoji: '🐯' },
  { color: '#A29BFE', emoji: '🐻' },
  { color: '#00D2D3', emoji: '🐬' },
  { color: '#FF6348', emoji: '🦄' },
  { color: '#FDCB6E', emoji: '🐨' },
  { color: '#6C5CE7', emoji: '🐸' },
  { color: '#00B894', emoji: '🐢' },
  { color: '#E17055', emoji: '🐺' },
  { color: '#74B9FF', emoji: '🐧' },
  { color: '#FDCB6E', emoji: '🦉' },
  { color: '#A29BFE', emoji: '🦅' },
  { color: '#00D2D3', emoji: '🦆' },
  { color: '#FF6348', emoji: '🐿️' },
  { color: '#6C5CE7', emoji: '🐰' },
  { color: '#00B894', emoji: '🐹' },
  { color: '#E17055', emoji: '🐭' },
  { color: '#74B9FF', emoji: '🐶' },
  { color: '#FDCB6E', emoji: '🐱' },
  { color: '#A29BFE', emoji: '🐴' },
  { color: '#00D2D3', emoji: '🦓' },
  { color: '#FF6348', emoji: '🦒' },
  { color: '#6C5CE7', emoji: '🐪' },
  { color: '#00B894', emoji: '🦘' },
  { color: '#E17055', emoji: '🐷' },
  { color: '#74B9FF', emoji: '🐮' },
  { color: '#FDCB6E', emoji: '🐔' },
  { color: '#A29BFE', emoji: '🦃' },
  { color: '#00D2D3', emoji: '🐝' },
  { color: '#FF6348', emoji: '🦋' },
  { color: '#6C5CE7', emoji: '🐛' },
  { color: '#00B894', emoji: '🦗' },
  { color: '#E17055', emoji: '🦂' },
  { color: '#74B9FF', emoji: '🦀' },
  { color: '#FDCB6E', emoji: '🦞' },
  { color: '#A29BFE', emoji: '🦐' },
  { color: '#00D2D3', emoji: '🐙' },
  { color: '#FF6348', emoji: '🦑' },
  { color: '#6C5CE7', emoji: '🐟' },
  { color: '#00B894', emoji: '🐠' },
  { color: '#E17055', emoji: '🦈' },
  { color: '#74B9FF', emoji: '🐳' },
  { color: '#FDCB6E', emoji: '🐋' },
  { color: '#A29BFE', emoji: '🦭' },
]

const DEFAULT_NAMES = [
  'Alex', 'Blake', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Jordan', 'Kai',
  'Morgan', 'Parker', 'Quinn', 'Riley', 'Sage', 'Taylor', 'Avery', 'Cameron', 'Dakota', 'Hayden',
  'River', 'Skyler', 'Phoenix', 'Rowan', 'Sage', 'Indigo', 'Ocean', 'Sky', 'Storm', 'Winter',
  'Nova', 'Luna', 'Aurora', 'Zephyr', 'Orion', 'Atlas', 'Cosmo', 'Nyx', 'Helios', 'Selene',
  'Athena', 'Apollo', 'Artemis', 'Hermes', 'Zeus', 'Hera', 'Poseidon', 'Demeter', 'Ares', 'Aphrodite'
]

function buildUrl(endpoint, params = {}) {
  const baseUrl = `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
  const queryParams = new URLSearchParams(params).toString()
  return queryParams ? `${baseUrl}&${queryParams}` : baseUrl
}

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

async function getAllProfiles() {
  try {
    const url = buildUrl('/read/userprofiles', { limit: 1000 })
    const response = await apiRequest(url, { method: 'GET' })
    
    let profiles = []
    if (Array.isArray(response)) {
      profiles = response
    } else if (response.data && Array.isArray(response.data)) {
      profiles = response.data
    } else if (response.status === 'success' && response.data && Array.isArray(response.data)) {
      profiles = response.data
    }
    
    // Sort by ID to ensure consistent ordering
    profiles.sort((a, b) => a.id - b.id)
    
    return profiles
  } catch (error) {
    console.error('Error getting profiles:', error)
    return []
  }
}

async function updateProfile(profileId, updateData) {
  try {
    const url = buildUrl(`/update/userprofiles/${profileId}`)
    const response = await apiRequest(url, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    })
    return response
  } catch (error) {
    console.error(`Error updating profile ${profileId}:`, error)
    return null
  }
}

async function updateAllProfiles() {
  console.log('Fetching all profiles from NoCodeBackend...')
  const profiles = await getAllProfiles()
  
  if (profiles.length === 0) {
    console.log('No profiles found.')
    return
  }
  
  console.log(`\nFound ${profiles.length} profiles`)
  console.log('Current state:')
  profiles.forEach((p, i) => {
    const hasColor = p.color && p.color !== null && p.color !== 'null' && p.color !== ''
    const hasEmoji = p.emoji && p.emoji !== null && p.emoji !== 'null' && p.emoji !== ''
    console.log(`  ${i + 1}. ID: ${p.id}, Name: "${p.name}", Color: ${hasColor ? p.color : 'MISSING'}, Emoji: ${hasEmoji ? p.emoji : 'MISSING'}`)
  })
  
  console.log('\nUpdating all profiles with names and colors/emojis...\n')
  
  // Build a set of used names to avoid duplicates
  const usedNames = new Set()
  profiles.forEach(p => usedNames.add(p.name))
  
  const updated = []
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i]
    const { color, emoji } = FALLBACK_COLORS[i % FALLBACK_COLORS.length]
    
    // Get base name, but ensure it's unique
    let baseName = DEFAULT_NAMES[i % DEFAULT_NAMES.length] || `Player ${i + 1}`
    let newName = baseName
    let nameCounter = 1
    
    // If name is already used by another profile, append a number
    while (usedNames.has(newName) && profile.name !== newName) {
      newName = `${baseName} ${nameCounter}`
      nameCounter++
    }
    
    // Add the new name to used names set
    if (profile.name !== newName) {
      usedNames.delete(profile.name)
      usedNames.add(newName)
    }
    
    const needsNameUpdate = profile.name !== newName
    const needsColorUpdate = !profile.color || profile.color === null || profile.color === 'null' || profile.color === '' ||
                            !profile.emoji || profile.emoji === null || profile.emoji === 'null' || profile.emoji === ''
    
    if (!needsNameUpdate && !needsColorUpdate) {
      console.log(`  ✓ Profile ${profile.id} "${profile.name}" already up to date, skipping`)
      continue
    }
    
    const updateData = {}
    if (needsNameUpdate) {
      updateData.name = newName
    }
    if (needsColorUpdate) {
      updateData.color = color
      updateData.emoji = emoji
    }
    
    console.log(`  Updating profile ${profile.id} "${profile.name}" → "${newName}" with ${emoji} ${color}...`)
    const result = await updateProfile(profile.id, updateData)
    
    if (result) {
      console.log(`  ✓ Successfully updated`)
      updated.push({ 
        id: profile.id, 
        oldName: profile.name, 
        newName: newName, 
        color, 
        emoji 
      })
    } else {
      console.log(`  ✗ Failed to update`)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log(`\n✓ Updated ${updated.length} profiles:`)
  updated.forEach(u => {
    console.log(`  "${u.oldName}" → "${u.newName}" (ID: ${u.id}) ${u.emoji} ${u.color}`)
  })
  
  if (updated.length === 0) {
    console.log('\nAll profiles already have correct names and colors/emojis.')
  }
}

// Run the script
updateAllProfiles().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})

