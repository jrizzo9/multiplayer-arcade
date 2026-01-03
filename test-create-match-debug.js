/**
 * Test with detailed error logging
 */

const API_KEY = '4d00ba698fcab74d4269f9819557d85114bf634be820db33e133c9e7594f'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateMatch() {
  console.log('🚀 Testing with detailed error logging\n')

  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ') // Format: "2026-01-01 00:00:00"

  const matchData = {
    MatchID: 0,
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

  const url = `${BASE_URL}/create/Matches?Instance=${INSTANCE}`
  
  console.log('URL:', url)
  console.log('Data:', JSON.stringify(matchData, null, 2))
  console.log('\n---\n')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(matchData)
    })

    console.log('Response Status:', response.status, response.statusText)
    console.log('Response Headers:')
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`)
    })

    const responseText = await response.text()
    console.log('\nResponse Body (raw):', responseText)
    
    try {
      const responseJson = JSON.parse(responseText)
      console.log('\nResponse Body (parsed):', JSON.stringify(responseJson, null, 2))
      
      // Check for nested error details
      if (responseJson.error) {
        console.log('\n❌ Error field:', responseJson.error)
      }
      if (responseJson.message) {
        console.log('❌ Message field:', responseJson.message)
      }
      if (responseJson.details) {
        console.log('❌ Details field:', responseJson.details)
      }
      if (responseJson.errors) {
        console.log('❌ Errors array:', responseJson.errors)
      }
    } catch (parseError) {
      console.log('\n⚠️  Response is not valid JSON')
    }

    if (!response.ok) {
      console.log('\n❌ Request failed')
      return false
    } else {
      console.log('\n✅ SUCCESS!')
      return true
    }
  } catch (error) {
    console.error('\n❌ Network/Fetch Error:', error.message)
    console.error('Stack:', error.stack)
    return false
  }
}

testCreateMatch().catch(console.error)

