/**
 * Test script for NoCodeBackend integration
 * Run with: node test-nocode-backend.js
 */

const API_KEY = '4d00ba698fcab74d4269f9819557d85114bf634be820db33e133c9e7594f'
const BASE_URL = 'http://api.nocodebackend.com'

// Test 1: Create a match
async function testSaveMatch() {
  console.log('\n=== Test 1: Save Match ===')
  try {
    const matchData = {
      gameType: 'pong',
      winnerId: 'test-winner-123',
      winnerName: 'Test Winner',
      winnerScore: 5,
      loserId: 'test-loser-456',
      loserName: 'Test Loser',
      loserScore: 3,
      roomId: 'test-room-789',
      timestamp: new Date().toISOString()
    }

    // Try with X-API-Key header first
    let response = await fetch(`${BASE_URL}/create/Matches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(matchData)
    })

    // If that fails, try with apiKey query parameter
    if (!response.ok) {
      console.log('X-API-Key header failed, trying query parameter...')
      const url = new URL(`${BASE_URL}/create/Matches`)
      url.searchParams.append('apiKey', API_KEY)
      
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(matchData)
      })
    }

    // If that fails, try Authorization header
    if (!response.ok) {
      console.log('Query parameter failed, trying Authorization header...')
      response = await fetch(`${BASE_URL}/create/Matches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(matchData)
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Failed to save match:', response.status, errorText)
      return false
    }

    const result = await response.json()
    console.log('✅ Match saved successfully:', result)
    return result
  } catch (error) {
    console.error('❌ Error saving match:', error.message)
    return false
  }
}

// Test 2: Read matches
async function testReadMatches() {
  console.log('\n=== Test 2: Read Matches ===')
  try {
    // Try with X-API-Key header first
    let response = await fetch(`${BASE_URL}/read/Matches`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    })

    // If that fails, try with apiKey query parameter
    if (!response.ok) {
      console.log('X-API-Key header failed, trying query parameter...')
      const url = new URL(`${BASE_URL}/read/Matches`)
      url.searchParams.append('apiKey', API_KEY)
      
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Failed to read matches:', response.status, errorText)
      return false
    }

    const result = await response.json()
    console.log('✅ Matches retrieved:', Array.isArray(result) ? result.length : 'unknown format')
    console.log('First match:', result[0] || 'No matches found')
    return result
  } catch (error) {
    console.error('❌ Error reading matches:', error.message)
    return false
  }
}

// Test 3: Search matches
async function testSearchMatches() {
  console.log('\n=== Test 3: Search Matches ===')
  try {
    const searchData = {
      gameType: 'pong'
    }

    let response = await fetch(`${BASE_URL}/search/Matches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(searchData)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Failed to search matches:', response.status, errorText)
      return false
    }

    const result = await response.json()
    console.log('✅ Search results:', Array.isArray(result) ? result.length : 'unknown format')
    return result
  } catch (error) {
    console.error('❌ Error searching matches:', error.message)
    return false
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Testing NoCodeBackend Integration')
  console.log('API Key:', API_KEY.substring(0, 20) + '...')
  console.log('Base URL:', BASE_URL)

  const results = {
    saveMatch: await testSaveMatch(),
    readMatches: await testReadMatches(),
    searchMatches: await testSearchMatches()
  }

  console.log('\n=== Test Summary ===')
  console.log('Save Match:', results.saveMatch ? '✅ PASS' : '❌ FAIL')
  console.log('Read Matches:', results.readMatches ? '✅ PASS' : '❌ FAIL')
  console.log('Search Matches:', results.searchMatches ? '✅ PASS' : '❌ FAIL')
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error)
}

export { testSaveMatch, testReadMatches, testSearchMatches }

