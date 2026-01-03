/**
 * Test with lowercase table name
 */

const API_KEY = '4d00ba698fcab74d4269f9819557d85114bf634be820db33e133c9e7594f'
const BASE_URL = 'http://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateMatch() {
  console.log('🚀 Testing with lowercase table name: matches\n')

  const matchData = {
    gameType: 'pong',
    winnerId: 'test-winner-' + Date.now(),
    winnerName: 'Test Winner',
    winnerScore: 5,
    loserId: 'test-loser-' + Date.now(),
    loserName: 'Test Loser',
    loserScore: 3
  }

  // Try lowercase "matches"
  const url = `${BASE_URL}/create/matches?Instance=${INSTANCE}`
  
  console.log('URL:', url)
  console.log('Data:', JSON.stringify(matchData, null, 2))
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

    const responseText = await response.text()
    console.log(`Status: ${response.status}`)
    console.log(`Response: ${responseText}`)

    if (response.ok) {
      console.log('\n✅ SUCCESS!')
      const result = JSON.parse(responseText)
      console.log('Result:', JSON.stringify(result, null, 2))
      return result
    } else {
      console.log('\n❌ Failed')
      return false
    }
  } catch (error) {
    console.error('Error:', error.message)
    return false
  }
}

testCreateMatch().catch(console.error)

