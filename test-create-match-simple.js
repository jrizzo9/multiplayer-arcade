/**
 * Test script with minimal data to see what fields are required
 */

const API_KEY = '4d00ba698fcab74d4269f9819557d85114bf634be820db33e133c9e7594f'
const BASE_URL = 'http://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateMatch() {
  console.log('🚀 Testing with minimal data\n')

  // Try with just the essential fields
  const testCases = [
    {
      name: 'Minimal - just gameType and winner',
      data: {
        gameType: 'pong',
        winnerId: 'test-winner-1',
        winnerName: 'Test Winner',
        winnerScore: 5
      }
    },
    {
      name: 'With all fields',
      data: {
        gameType: 'pong',
        winnerId: 'test-winner-2',
        winnerName: 'Test Winner',
        winnerScore: 5,
        loserId: 'test-loser-2',
        loserName: 'Test Loser',
        loserScore: 3,
        roomId: 'test-room-2',
        timestamp: new Date().toISOString()
      }
    },
    {
      name: 'CamelCase field names',
      data: {
        gameType: 'pong',
        winnerId: 'test-winner-3',
        winnerName: 'Test Winner',
        winnerScore: 5,
        loserId: 'test-loser-3',
        loserName: 'Test Loser',
        loserScore: 3
      }
    }
  ]

  for (const testCase of testCases) {
    console.log(`\n--- Testing: ${testCase.name} ---`)
    const url = `${BASE_URL}/create/Matches?Instance=${INSTANCE}`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(testCase.data)
      })

      const responseText = await response.text()
      console.log(`Status: ${response.status}`)
      console.log(`Response: ${responseText}`)

      if (response.ok) {
        console.log('✅ SUCCESS!')
        try {
          const result = JSON.parse(responseText)
          console.log('Result:', JSON.stringify(result, null, 2))
          return result
        } catch (e) {
          console.log('Response:', responseText)
        }
        break
      } else {
        console.log('❌ Failed')
      }
    } catch (error) {
      console.error('Error:', error.message)
    }
  }
}

testCreateMatch().catch(console.error)

