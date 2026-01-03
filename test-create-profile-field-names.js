/**
 * Test different field name formats for userprofiles
 */

const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateProfile(data, testName) {
  console.log(`\n--- ${testName} ---`)
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
    
    if (response.ok) {
      console.log('✅ SUCCESS!')
      console.log('Response:', responseText)
      return true
    } else {
      console.log('❌ Failed:', responseText)
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
  const timestamp = Date.now()

  // Test 1: PascalCase (like Matches table)
  await testCreateProfile({
    ID: 'test-pascal-' + timestamp,
    Name: 'Test Pascal',
    Color: '#FF6B6B',
    Emoji: '🦁',
    CreatedAt: dateString,
    LastSeen: dateString
  }, 'Test 1: PascalCase (ID, Name, Color, Emoji, CreatedAt, LastSeen)')

  // Test 2: camelCase
  await testCreateProfile({
    id: 'test-camel-' + timestamp,
    name: 'Test Camel',
    color: '#FF6B6B',
    emoji: '🦁',
    createdAt: dateString,
    lastSeen: dateString
  }, 'Test 2: camelCase (id, name, color, emoji, createdAt, lastSeen)')

  // Test 3: snake_case
  await testCreateProfile({
    id: 'test-snake-' + timestamp,
    name: 'Test Snake',
    color: '#FF6B6B',
    emoji: '🦁',
    created_at: dateString,
    last_seen: dateString
  }, 'Test 3: snake_case (id, name, color, emoji, created_at, last_seen)')

  // Test 4: Just id and name (minimal)
  await testCreateProfile({
    id: 'test-minimal-' + timestamp,
    name: 'Test Minimal'
  }, 'Test 4: Minimal (just id and name)')

  // Test 5: Match SQL schema exactly
  await testCreateProfile({
    id: 'test-sql-' + timestamp,
    name: 'Test SQL',
    color: '#FF6B6B',
    emoji: '🦁',
    createdAt: dateString,
    lastSeen: dateString
  }, 'Test 5: Match SQL schema (id, name, color, emoji, createdAt, lastSeen)')
}

runTests().catch(console.error)

