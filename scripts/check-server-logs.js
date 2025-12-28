#!/usr/bin/env node

/**
 * Script to check server logs from Vercel and Render
 * 
 * Usage:
 *   node scripts/check-server-logs.js vercel
 *   node scripts/check-server-logs.js render
 *   node scripts/check-server-logs.js both
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const PROJECT_NAME = 'multiplayer-arcade';
const VERCEL_PROJECT = 'jrizzo9s-projects/multiplayer-arcade';
const RENDER_SERVICE_NAME = 'multiplayer-arcade-server';

function printSection(title) {
  console.log('\n' + '='.repeat(50));
  console.log(title);
  console.log('='.repeat(50) + '\n');
}

function checkVercelLogs() {
  printSection('Vercel Logs');
  
  console.log('Vercel logs can be accessed via:\n');
  
  console.log('1. Vercel Dashboard (Recommended):');
  console.log(`   https://vercel.com/${VERCEL_PROJECT}`);
  console.log('   → Deployments → Latest → Functions → api/render-logs\n');
  
  console.log('2. Vercel CLI:');
  console.log('   First, list deployments:');
  console.log(`   npx vercel ls ${PROJECT_NAME}\n`);
  console.log('   Then view logs for a specific deployment:');
  console.log('   npx vercel logs <deployment-url>\n');
  
  try {
    console.log('Checking Vercel authentication...');
    const whoami = execSync('npx vercel whoami', { 
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: rootDir 
    });
    console.log(`✓ Logged in as: ${whoami.trim()}\n`);
    
    console.log('Fetching recent deployments...');
    const deployments = execSync(`npx vercel ls ${PROJECT_NAME} --json`, { 
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: rootDir 
    });
    
    const deploymentList = JSON.parse(deployments);
    if (deploymentList.length > 0) {
      console.log(`\nFound ${deploymentList.length} recent deployment(s):\n`);
      deploymentList.slice(0, 5).forEach((deployment, index) => {
        console.log(`${index + 1}. ${deployment.url || deployment.name}`);
        console.log(`   State: ${deployment.state}`);
        console.log(`   Created: ${new Date(deployment.created).toLocaleString()}`);
        if (deployment.url) {
          console.log(`   View logs: npx vercel logs ${deployment.url}`);
        }
        console.log('');
      });
    }
  } catch (error) {
    console.log('⚠ Could not fetch deployments automatically.');
    console.log('  You may need to log in: npx vercel login\n');
    console.log('  Or check the dashboard directly:\n');
    console.log(`  https://vercel.com/${VERCEL_PROJECT}\n`);
  }
}

function checkRenderLogs() {
  printSection('Render Logs');
  
  console.log('Render logs can be accessed via:\n');
  
  console.log('1. Render Dashboard (Recommended):');
  console.log('   https://dashboard.render.com');
  console.log(`   → Navigate to service: ${RENDER_SERVICE_NAME}`);
  console.log('   → Click on "Logs" tab\n');
  
  console.log('2. Render API:');
  console.log('   Requires API key. See: https://render.com/docs/api\n');
  
  console.log('3. Check if logs are forwarded to Vercel:');
  console.log('   If VERCEL_LOG_ENDPOINT is configured in Render,');
  console.log('   Render logs will appear in Vercel function logs.\n');
  
  // Check if VERCEL_LOG_ENDPOINT is mentioned in server code
  try {
    const serverIndex = readFileSync(
      join(rootDir, 'server/index.js'), 
      'utf8'
    );
    if (serverIndex.includes('VERCEL_LOG_ENDPOINT')) {
      console.log('✓ Log forwarding is configured in server code');
      console.log('  Check Vercel logs to see Render backend logs\n');
    }
  } catch (error) {
    // Ignore if file doesn't exist
  }
}

function checkBoth() {
  checkVercelLogs();
  checkRenderLogs();
}

// Main
const command = process.argv[2] || 'both';

switch (command) {
  case 'vercel':
    checkVercelLogs();
    break;
  case 'render':
    checkRenderLogs();
    break;
  case 'both':
    checkBoth();
    break;
  default:
    console.log('Usage: node scripts/check-server-logs.js [vercel|render|both]');
    process.exit(1);
}

