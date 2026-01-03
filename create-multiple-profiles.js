/**
 * Create multiple user profiles in NoCodeBackend
 */

const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const BASE_URL = 'https://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#E74C3C']
const emojis = ['🦁', '🐯', '🐻', '🐨', '🐼', '🦊', '🐺', '🐸', '🐷', '🐰', '🐹', '🐭', '🐶', '🐱', '🦄', '🐲', '🐉', '🦅', '🦉', '🐧']

async function createProfile(name, color, emoji) {
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
  
  const profileData = {
    name: name,
    color: color,
    emoji: emoji,
    createdAt: dateString,
    lastSeen: dateString
  }

  const url = `${BASE_URL}/create/userprofiles?Instance=${INSTANCE}`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(profileData)
    })

    const responseText = await response.text()
    
    if (response.ok) {
      const result = JSON.parse(responseText)
      return { success: true, id: result.id, name }
    } else {
      console.error(`Failed to create ${name}:`, responseText)
      return { success: false, name, error: responseText }
    }
  } catch (error) {
    console.error(`Error creating ${name}:`, error.message)
    return { success: false, name, error: error.message }
  }
}

async function createMultipleProfiles(count = 20) {
  console.log(`🚀 Creating ${count} profiles...\n`)
  
  const results = {
    success: [],
    failed: []
  }

  for (let i = 0; i < count; i++) {
    const name = `Player ${i + 1}`
    const color = colors[i % colors.length]
    const emoji = emojis[i % emojis.length]
    
    process.stdout.write(`Creating ${name}... `)
    const result = await createProfile(name, color, emoji)
    
    if (result.success) {
      console.log(`✅ ID: ${result.id}`)
      results.success.push(result)
    } else {
      console.log(`❌ Failed`)
      results.failed.push(result)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log('\n=== Summary ===')
  console.log(`✅ Successfully created: ${results.success.length}`)
  console.log(`❌ Failed: ${results.failed.length}`)
  
  if (results.success.length > 0) {
    console.log('\nCreated profiles:')
    results.success.forEach(p => {
      console.log(`  - ${p.name} (ID: ${p.id})`)
    })
  }
  
  if (results.failed.length > 0) {
    console.log('\nFailed profiles:')
    results.failed.forEach(p => {
      console.log(`  - ${p.name}: ${p.error}`)
    })
  }

  return results
}

// Get count from command line or default to 20
const count = parseInt(process.argv[2]) || 20
createMultipleProfiles(count).catch(console.error)

