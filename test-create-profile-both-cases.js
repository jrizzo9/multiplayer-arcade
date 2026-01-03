/**
 * Test creating profile with both uppercase and lowercase table names
 */

const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testCreateProfile(endpoint, data, testName) {
  console.log(`\n--- Testing: ${testName} ---`)
  const url = `${BASE_URL}${endpoint}?Instance=${INSTANCE}`
  console.log('URL:', url)
  console.log('Data:', JSON.stringify(data, null, 2))
  
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
      try {
        const result = JSON.parse(responseText)
        return { success: true, result, endpoint }
      } catch (e) {
        return { success: true, result: responseText, endpoint }
      }
    } else {
      console.log('❌ Failed')
      return { success: false, endpoint }
    }
  } catch (error) {
    console.error('Error:', error.message)
    return { success: false, endpoint, error: error.message }
  }
}

async function runTests() {
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')

  const profileData = {
    id: 'test-profile-' + Date.now(),
    name: 'Test Player ' + Date.now(),
    color: '#FF6B6B',
    emoji: '🦁',
    createdAt: dateString,
    lastSeen: dateString
  }

  // Test lowercase
  const result1 = await testCreateProfile(
    '/create/userprofiles',
    profileData,
    'Lowercase: /create/userprofiles'
  )

  // Test uppercase
  const result2 = await testCreateProfile(
    '/create/UserProfiles',
    { ...profileData, id: 'test-profile-' + (Date.now() + 1) },
    'Uppercase: /create/UserProfiles'
  )

  console.log('\n=== Summary ===')
  if (result1.success) {
    console.log('✅ Lowercase endpoint works!')
  } else {
    console.log('❌ Lowercase endpoint failed')
  }
  
  if (result2.success) {
    console.log('✅ Uppercase endpoint works!')
  } else {
    console.log('❌ Uppercase endpoint failed')
  }
}

runTests().catch(console.error)

