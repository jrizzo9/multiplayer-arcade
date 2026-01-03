/**
 * Script to rename all profiles in NoCodeBackend
 * Usage: 
 *   node rename-all-profiles.js
 *   node rename-all-profiles.js "Gamer 1" "Gamer 2" ...
 *   node rename-all-profiles.js --pattern "Player_%d"
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

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
    } else if (response.profiles && Array.isArray(response.profiles)) {
      profiles = response.profiles
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

// Default names - you can customize this array
const DEFAULT_NAMES = [
  'Alex',
  'Blake',
  'Casey',
  'Drew',
  'Emery',
  'Finley',
  'Gray',
  'Harper',
  'Jordan',
  'Kai',
  'Morgan',
  'Parker',
  'Quinn',
  'Riley',
  'Sage',
  'Taylor',
  'Avery',
  'Cameron',
  'Dakota',
  'Hayden'
]

async function renameAllProfiles() {
  const args = process.argv.slice(2)
  
  console.log('Fetching all profiles from NoCodeBackend...')
  const profiles = await getAllProfiles()
  
  if (profiles.length === 0) {
    console.log('No profiles found.')
    return
  }
  
  console.log(`\nFound ${profiles.length} profiles:`)
  profiles.forEach((p, i) => {
    console.log(`  ${i + 1}. ID: ${p.id}, Name: "${p.name}"`)
  })
  
  // Determine naming strategy
  let newNames = []
  
  if (args.length > 0 && args[0] === '--pattern') {
    // Pattern mode: e.g., --pattern "Player_%d"
    const pattern = args[1] || 'Player_%d'
    newNames = profiles.map((_, i) => pattern.replace('%d', (i + 1).toString()))
  } else if (args.length > 0) {
    // Custom names provided as arguments
    newNames = args
    if (newNames.length < profiles.length) {
      console.log(`\nWarning: Only ${newNames.length} names provided for ${profiles.length} profiles.`)
      console.log('Will use default names for remaining profiles.')
      newNames = [...newNames, ...DEFAULT_NAMES.slice(newNames.length)]
    }
  } else {
    // Use default names
    newNames = DEFAULT_NAMES.slice(0, profiles.length)
  }
  
  console.log(`\nRenaming strategy:`)
  profiles.forEach((p, i) => {
    console.log(`  "${p.name}" → "${newNames[i]}"`)
  })
  
  console.log('\nProceeding with rename...\n')
  
  const renamed = []
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i]
    const newName = newNames[i]
    
    if (profile.name === newName) {
      console.log(`  ✓ Profile ${profile.id} already named "${newName}", skipping`)
      continue
    }
    
    console.log(`  Renaming "${profile.name}" (ID: ${profile.id}) to "${newName}"...`)
    const result = await updateProfile(profile.id, { name: newName })
    
    if (result) {
      console.log(`  ✓ Successfully renamed to "${newName}"`)
      renamed.push({ old: profile.name, new: newName, id: profile.id })
    } else {
      console.log(`  ✗ Failed to rename "${profile.name}"`)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log(`\n✓ Renamed ${renamed.length} profiles:`)
  renamed.forEach(r => {
    console.log(`  "${r.old}" → "${r.new}" (ID: ${r.id})`)
  })
  
  if (renamed.length === 0) {
    console.log('\nAll profiles already have the target names.')
  }
}

// Run the script
renameAllProfiles().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
