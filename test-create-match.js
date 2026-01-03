/**
 * Test script to create a match in NoCodeBackend
 * Run with: node test-create-match.js
 */

const API_KEY = '4d00ba698fcab74d4269f9819557d85114bf634be820db33e133c9e7594f'
const BASE_URL = 'http://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateMatch() {
  console.log('🚀 Testing NoCodeBackend - Create Match')
  console.log('========================================\n')

  const matchData = {
    gameType: 'pong',
    winnerId: 'test-winner-' + Date.now(),
    winnerName: 'Test Winner',
    winnerScore: 5,
    loserId: 'test-loser-' + Date.now(),
    loserName: 'Test Loser',
    loserScore: 3,
    roomId: 'test-room-' + Date.now(),
    timestamp: new Date().toISOString()
  }

  const url = `${BASE_URL}/create/Matches?Instance=${INSTANCE}`
  
  console.log('URL:', url)
  console.log('Method: POST')
  console.log('Headers:', {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY.substring(0, 20)}...`
  })
  console.log('Body:', JSON.stringify(matchData, null, 2))
  console.log('\n---\n')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(matchData)
    })

    console.log('Response Status:', response.status, response.statusText)
    console.log('Response Headers:', Object.fromEntries(response.headers.entries()))

    const responseText = await response.text()
    console.log('Response Body:', responseText)

    if (!response.ok) {
      console.error('\n❌ FAILED - Response not OK')
      return false
    }

    let result
    try {
      result = JSON.parse(responseText)
      console.log('\n✅ SUCCESS - Match created!')
      console.log('Result:', JSON.stringify(result, null, 2))
      return result
    } catch (parseError) {
      console.log('\n⚠️  Response is not JSON:', responseText)
      return responseText
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error.message)
    console.error('Stack:', error.stack)
    return false
  }
}

// Run the test
testCreateMatch()
  .then(result => {
    if (result) {
      console.log('\n✅ Test completed successfully!')
      process.exit(0)
    } else {
      console.log('\n❌ Test failed!')
      process.exit(1)
    }
  })
  .catch(error => {
    console.error('\n❌ Unhandled error:', error)
    process.exit(1)
  })

