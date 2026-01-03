/**
 * Test script to create a profile in NoCodeBackend
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

function buildUrl(endpoint) {
  return `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
}

async function testCreateProfile() {
  const url = buildUrl('/create/userprofiles')
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
  
  const testName = `Test Profile ${Date.now()}`
  
  console.log('Testing profile creation...')
  console.log('URL:', url)
  console.log('Name:', testName)
  console.log('Payload:', {
    name: testName,
    color: null,
    emoji: null,
    createdAt: dateString,
    lastSeen: dateString
  })
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        name: testName,
        color: null,
        emoji: null,
        createdAt: dateString,
        lastSeen: dateString
      })
    })
    
    console.log('\nResponse Status:', response.status, response.statusText)
    const text = await response.text()
    console.log('Response Body:', text)
    
    if (!response.ok) {
      console.error('\n❌ Profile creation failed!')
      return
    }
    
    let data
    try {
      data = JSON.parse(text)
      console.log('Parsed Response:', JSON.stringify(data, null, 2))
    } catch (e) {
      console.log('Could not parse as JSON')
    }
    
    if (data && data.id) {
      console.log('\n✅ Profile created successfully!')
      console.log('Profile ID:', data.id)
      console.log('Profile Name:', data.name)
    } else {
      console.log('\n⚠️  Response received but no ID found')
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

testCreateProfile()
