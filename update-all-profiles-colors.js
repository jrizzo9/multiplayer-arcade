/**
 * Script to update all profiles in NoCodeBackend with colors and emojis
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

function buildUrl(endpoint) {
  return `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
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
    const url = buildUrl('/read/userprofiles')
    const response = await apiRequest(url, { method: 'GET' })
    
    let profiles = []
    if (Array.isArray(response)) {
      profiles = response
    } else if (response.data && Array.isArray(response.data)) {
      profiles = response.data
    } else if (response.status === 'success' && response.data && Array.isArray(response.data)) {
      profiles = response.data
    }
    
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
  
  console.log(`\nFound ${profiles.length} profiles:`)
  profiles.forEach((p, i) => {
    const hasColor = p.color && p.color !== null && p.color !== 'null'
    const hasEmoji = p.emoji && p.emoji !== null && p.emoji !== 'null'
    console.log(`  ${i + 1}. ID: ${p.id}, Name: "${p.name}", Color: ${hasColor ? p.color : 'MISSING'}, Emoji: ${hasEmoji ? p.emoji : 'MISSING'}`)
  })
  
  console.log('\nUpdating profiles with colors and emojis...\n')
  
  const updated = []
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i]
    const { color, emoji } = FALLBACK_COLORS[i % FALLBACK_COLORS.length]
    
    const needsUpdate = !profile.color || profile.color === null || profile.color === 'null' ||
                        !profile.emoji || profile.emoji === null || profile.emoji === 'null'
    
    if (!needsUpdate) {
      console.log(`  ✓ Profile ${profile.id} "${profile.name}" already has color and emoji, skipping`)
      continue
    }
    
    console.log(`  Updating profile ${profile.id} "${profile.name}" with color: ${color}, emoji: ${emoji}...`)
    const result = await updateProfile(profile.id, { color, emoji })
    
    if (result) {
      console.log(`  ✓ Successfully updated`)
      updated.push({ id: profile.id, name: profile.name, color, emoji })
    } else {
      console.log(`  ✗ Failed to update`)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log(`\n✓ Updated ${updated.length} profiles:`)
  updated.forEach(u => {
    console.log(`  "${u.name}" (ID: ${u.id}) → ${u.emoji} ${u.color}`)
  })
  
  if (updated.length === 0) {
    console.log('\nAll profiles already have colors and emojis.')
  }
}

// Run the script
updateAllProfiles().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})

