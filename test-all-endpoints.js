/**
 * Comprehensive test for all NoCodeBackend endpoints
 */

const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

let createdMatchId = null
let createdProfileId = null

// Helper function for API requests
async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}?Instance=${INSTANCE}`
  const options = {
    method,
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
  }
  
  if (body) {
    options.body = JSON.stringify(body)
  }

  try {
    const response = await fetch(url, options)
    const responseText = await response.text()
    
    let result
    try {
      result = JSON.parse(responseText)
    } catch (e) {
      result = responseText
    }

    return {
      status: response.status,
      ok: response.ok,
      data: result,
      raw: responseText
    }
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message
    }
  }
}

// Test functions
async function testCreateMatch() {
  console.log('\n=== TEST 1: Create Match ===')
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
  
  const matchData = {
    // Don't send MatchID - it's auto-generated
    GameType: 'pong',
    WinnerID: 'test-winner-' + Date.now(),
    WinnerName: 'Test Winner',
    WinnerScore: 5,
    LoserID: 'test-loser-' + Date.now(),
    LoserName: 'Test Loser',
    LoserScore: 3,
    RoomID: 'test-room-' + Date.now(),
    MatchDate: dateString,
    CreatedAt: dateString,
    timestamp: dateString
  }

  const result = await apiRequest('/create/Matches', 'POST', matchData)
  console.log(`Status: ${result.status}`)
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok && result.data.id) {
    createdMatchId = result.data.id
    console.log('✅ SUCCESS - Match created with ID:', createdMatchId)
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testReadAllMatches() {
  console.log('\n=== TEST 2: Read All Matches ===')
  const result = await apiRequest('/read/Matches', 'GET')
  console.log(`Status: ${result.status}`)
  
  if (result.ok) {
    const matches = result.data.data || result.data
    console.log(`✅ SUCCESS - Found ${Array.isArray(matches) ? matches.length : 'unknown'} matches`)
    if (Array.isArray(matches) && matches.length > 0) {
      console.log('Sample match:', JSON.stringify(matches[0], null, 2))
    }
    return true
  } else {
    console.log('❌ FAILED:', result.data)
    return false
  }
}

async function testReadMatchById() {
  console.log('\n=== TEST 3: Read Match by ID ===')
  // Use ID 1 from the existing match we saw
  const matchId = createdMatchId || 1
  
  const result = await apiRequest(`/read/Matches/${matchId}`, 'GET')
  console.log(`Status: ${result.status}`)
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    console.log('✅ SUCCESS')
    if (!createdMatchId) createdMatchId = matchId
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testSearchMatches() {
  console.log('\n=== TEST 4: Search Matches ===')
  const searchData = {
    GameType: 'pong'
  }
  
  const result = await apiRequest('/search/Matches', 'POST', searchData)
  console.log(`Status: ${result.status}`)
  
  if (result.ok) {
    const matches = result.data.data || result.data
    console.log(`✅ SUCCESS - Found ${Array.isArray(matches) ? matches.length : 'unknown'} matches`)
    return true
  } else {
    console.log('❌ FAILED:', result.data)
    return false
  }
}

async function testUpdateMatch() {
  console.log('\n=== TEST 5: Update Match ===')
  // Use ID 1 from the existing match
  const matchId = createdMatchId || 1
  
  const updateData = {
    WinnerScore: 10,
    LoserScore: 7
  }
  
  const result = await apiRequest(`/update/Matches/${matchId}`, 'PUT', updateData)
  console.log(`Status: ${result.status}`)
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    console.log('✅ SUCCESS')
    if (!createdMatchId) createdMatchId = matchId
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testDeleteMatch() {
  console.log('\n=== TEST 6: Delete Match ===')
  if (!createdMatchId) {
    console.log('⏭️  SKIPPED - No match ID available')
    return null
  }
  
  const result = await apiRequest(`/delete/Matches/${createdMatchId}`, 'DELETE')
  console.log(`Status: ${result.status}`)
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    console.log('✅ SUCCESS - Match deleted')
    createdMatchId = null // Clear the ID since it's deleted
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testCreateProfile() {
  console.log('\n=== TEST 7: Create User Profile ===')
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
  
  // According to API docs, don't send 'id' - only name, color, emoji, createdAt, lastSeen
  const profileData = {
    name: 'Test Player ' + Date.now(),
    color: '#FF6B6B',
    emoji: '🦁',
    createdAt: dateString,
    lastSeen: dateString
  }

  // Try lowercase first
  let result = await apiRequest('/create/userprofiles', 'POST', profileData)
  console.log(`Status (lowercase): ${result.status}`)
  
  if (!result.ok) {
    // Try uppercase
    console.log('Trying uppercase...')
    result = await apiRequest('/create/UserProfiles', 'POST', profileData)
    console.log(`Status (uppercase): ${result.status}`)
  }
  
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    // ID might be in result.data.id or result.data.data.id
    createdProfileId = result.data.id || result.data.data?.id || result.data.data?.ID
    console.log('✅ SUCCESS - Profile created')
    if (createdProfileId) {
      console.log('Profile ID:', createdProfileId)
    }
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testReadAllProfiles() {
  console.log('\n=== TEST 8: Read All Profiles ===')
  
  // Try lowercase first
  let result = await apiRequest('/read/userprofiles', 'GET')
  console.log(`Status (lowercase): ${result.status}`)
  
  if (!result.ok) {
    // Try uppercase
    result = await apiRequest('/read/UserProfiles', 'GET')
    console.log(`Status (uppercase): ${result.status}`)
  }
  
  if (result.ok) {
    const profiles = result.data.data || result.data
    console.log(`✅ SUCCESS - Found ${Array.isArray(profiles) ? profiles.length : 'unknown'} profiles`)
    if (Array.isArray(profiles) && profiles.length > 0) {
      console.log('Sample profile:', JSON.stringify(profiles[0], null, 2))
    }
    return true
  } else {
    console.log('❌ FAILED:', result.data)
    return false
  }
}

async function testReadProfileById() {
  console.log('\n=== TEST 9: Read Profile by ID ===')
  if (!createdProfileId) {
    console.log('⏭️  SKIPPED - No profile ID available')
    return null
  }
  
  // Try lowercase first
  let result = await apiRequest(`/read/userprofiles/${createdProfileId}`, 'GET')
  console.log(`Status (lowercase): ${result.status}`)
  
  if (!result.ok) {
    // Try uppercase
    result = await apiRequest(`/read/UserProfiles/${createdProfileId}`, 'GET')
    console.log(`Status (uppercase): ${result.status}`)
  }
  
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    console.log('✅ SUCCESS')
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testSearchProfiles() {
  console.log('\n=== TEST 10: Search Profiles ===')
  const searchData = {
    name: 'Test'
  }
  
  // Try lowercase first
  let result = await apiRequest('/search/userprofiles', 'POST', searchData)
  console.log(`Status (lowercase): ${result.status}`)
  
  if (!result.ok) {
    // Try uppercase
    result = await apiRequest('/search/UserProfiles', 'POST', searchData)
    console.log(`Status (uppercase): ${result.status}`)
  }
  
  if (result.ok) {
    const profiles = result.data.data || result.data
    console.log(`✅ SUCCESS - Found ${Array.isArray(profiles) ? profiles.length : 'unknown'} profiles`)
    return true
  } else {
    console.log('❌ FAILED:', result.data)
    return false
  }
}

async function testUpdateProfile() {
  console.log('\n=== TEST 11: Update Profile ===')
  if (!createdProfileId) {
    console.log('⏭️  SKIPPED - No profile ID available')
    return null
  }
  
  const updateData = {
    name: 'Updated Test Player',
    lastSeen: new Date().toISOString().slice(0, 19).replace('T', ' ')
  }
  
  // Try lowercase first
  let result = await apiRequest(`/update/userprofiles/${createdProfileId}`, 'PUT', updateData)
  console.log(`Status (lowercase): ${result.status}`)
  
  if (!result.ok) {
    // Try uppercase
    result = await apiRequest(`/update/UserProfiles/${createdProfileId}`, 'PUT', updateData)
    console.log(`Status (uppercase): ${result.status}`)
  }
  
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    console.log('✅ SUCCESS')
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

async function testDeleteProfile() {
  console.log('\n=== TEST 12: Delete Profile ===')
  if (!createdProfileId) {
    console.log('⏭️  SKIPPED - No profile ID available')
    return null
  }
  
  // Try lowercase first
  let result = await apiRequest(`/delete/userprofiles/${createdProfileId}`, 'DELETE')
  console.log(`Status (lowercase): ${result.status}`)
  
  if (!result.ok) {
    // Try uppercase
    result = await apiRequest(`/delete/UserProfiles/${createdProfileId}`, 'DELETE')
    console.log(`Status (uppercase): ${result.status}`)
  }
  
  console.log('Response:', JSON.stringify(result.data, null, 2))
  
  if (result.ok) {
    console.log('✅ SUCCESS - Profile deleted')
    createdProfileId = null
    return true
  } else {
    console.log('❌ FAILED')
    return false
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Testing All NoCodeBackend Endpoints')
  console.log('=====================================')
  console.log(`API Key: ${API_KEY.substring(0, 20)}...`)
  console.log(`Instance: ${INSTANCE}`)
  console.log(`Base URL: ${BASE_URL}`)

  const results = {
    createMatch: await testCreateMatch(),
    readAllMatches: await testReadAllMatches(),
    readMatchById: await testReadMatchById(),
    searchMatches: await testSearchMatches(),
    updateMatch: await testUpdateMatch(),
    deleteMatch: await testDeleteMatch(),
    createProfile: await testCreateProfile(),
    readAllProfiles: await testReadAllProfiles(),
    readProfileById: await testReadProfileById(),
    searchProfiles: await testSearchProfiles(),
    updateProfile: await testUpdateProfile(),
    deleteProfile: await testDeleteProfile()
  }

  console.log('\n\n=== FINAL SUMMARY ===')
  console.log('Matches Table:')
  console.log(`  Create: ${results.createMatch ? '✅' : '❌'}`)
  console.log(`  Read All: ${results.readAllMatches ? '✅' : '❌'}`)
  console.log(`  Read By ID: ${results.readMatchById !== null ? (results.readMatchById ? '✅' : '❌') : '⏭️'}`)
  console.log(`  Search: ${results.searchMatches ? '✅' : '❌'}`)
  console.log(`  Update: ${results.updateMatch !== null ? (results.updateMatch ? '✅' : '❌') : '⏭️'}`)
  console.log(`  Delete: ${results.deleteMatch !== null ? (results.deleteMatch ? '✅' : '❌') : '⏭️'}`)
  
  console.log('\nUserProfiles Table:')
  console.log(`  Create: ${results.createProfile ? '✅' : '❌'}`)
  console.log(`  Read All: ${results.readAllProfiles ? '✅' : '❌'}`)
  console.log(`  Read By ID: ${results.readProfileById !== null ? (results.readProfileById ? '✅' : '❌') : '⏭️'}`)
  console.log(`  Search: ${results.searchProfiles ? '✅' : '❌'}`)
  console.log(`  Update: ${results.updateProfile !== null ? (results.updateProfile ? '✅' : '❌') : '⏭️'}`)
  console.log(`  Delete: ${results.deleteProfile !== null ? (results.deleteProfile ? '✅' : '❌') : '⏭️'}`)

  const totalTests = Object.values(results).filter(r => r !== null).length
  const passedTests = Object.values(results).filter(r => r === true).length
  const skippedTests = Object.values(results).filter(r => r === null).length
  
  console.log(`\nTotal: ${totalTests} tests, ${passedTests} passed, ${totalTests - passedTests - skippedTests} failed, ${skippedTests} skipped`)
}

runAllTests().catch(console.error)

