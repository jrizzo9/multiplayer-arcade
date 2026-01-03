/**
 * Test with correct field names (PascalCase)
 */

const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateMatch() {
  console.log('🚀 Testing with correct PascalCase field names\n')

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

    const responseText = await response.text()
    console.log(`Status: ${response.status}`)
    console.log(`Response: ${responseText}`)

    if (response.ok) {
      console.log('\n✅ SUCCESS! Match created!')
      try {
        const result = JSON.parse(responseText)
        console.log('Result:', JSON.stringify(result, null, 2))
        return result
      } catch (e) {
        console.log('Response:', responseText)
      }
    } else {
      console.log('\n❌ Failed')
    }
  } catch (error) {
    console.error('Error:', error.message)
  }
}

testCreateMatch().catch(console.error)

