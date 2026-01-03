/**
 * Test creating profile with different field name formats
 */

const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateProfile(data, testName) {
  console.log(`\n--- Testing: ${testName} ---`)
  const url = `${BASE_URL}/create/userprofiles?Instance=${INSTANCE}`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(data)
    })

    const responseText = await response.text()
    console.log(`Status: ${response.status}`)
    console.log(`Response: ${responseText}`)

    if (response.ok) {
      console.log('✅ SUCCESS!')
      return true
    } else {
      console.log('❌ Failed')
      return false
    }
  } catch (error) {
    console.error('Error:', error.message)
    return false
  }
}

async function runTests() {
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')

  // Test 1: Lowercase field names (matching SQL schema)
  await testCreateProfile({
    id: 'test-1-' + Date.now(),
    name: 'Test Player 1',
    color: '#FF6B6B',
    emoji: '🦁',
    createdAt: dateString,
    lastSeen: dateString
  }, 'Lowercase fields (id, name, color, emoji, createdAt, lastSeen)')

  // Test 2: PascalCase field names
  await testCreateProfile({
    ID: 'test-2-' + Date.now(),
    Name: 'Test Player 2',
    Color: '#FF6B6B',
    Emoji: '🦁',
    CreatedAt: dateString,
    LastSeen: dateString
  }, 'PascalCase fields (ID, Name, Color, Emoji, CreatedAt, LastSeen)')

  // Test 3: Minimal fields (just id and name)
  await testCreateProfile({
    id: 'test-3-' + Date.now(),
    name: 'Test Player 3'
  }, 'Minimal fields (just id and name)')
}

runTests().catch(console.error)

