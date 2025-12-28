#!/usr/bin/env node

/**
 * Script to fetch and display all available logs:
 * 1. Local server logs (API and file)
 * 2. Vercel logs (if accessible)
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function getLocalServerLogs() {
  console.log('='.repeat(60));
  console.log('LOCAL SERVER LOGS (via API)');
  console.log('='.repeat(60));
  console.log();
  
  try {
    const response = await fetch('http://localhost:8000/api/debug/server-events?limit=50');
    const data = await response.json();
    
    console.log(`Total logs available: ${data.total}`);
    console.log(`Showing last ${data.returned} events:\n`);
    
    data.logs.forEach((log, i) => {
      const timestamp = new Date(log.timestamp || log.serverTimestamp).toLocaleString();
      console.log(`[${timestamp}] [${log.level?.toUpperCase() || 'INFO'}] ${log.message}`);
      if (log.data) {
        try {
          const parsed = JSON.parse(log.data);
          if (Object.keys(parsed).length > 0) {
            console.log(`  Data: ${JSON.stringify(parsed, null, 2).split('\n').slice(0, 3).join('\n')}`);
          }
        } catch {}
      }
      console.log();
    });
  } catch (error) {
    console.log('Could not fetch local server logs via API:', error.message);
    console.log('Is the server running on port 8000?');
  }
}

async function getLocalFileLogs() {
  console.log('='.repeat(60));
  console.log('LOCAL SERVER LOGS (from file)');
  console.log('='.repeat(60));
  console.log();
  
  try {
    const logFile = join(rootDir, 'server/server.log');
    const logs = readFileSync(logFile, 'utf8');
    const lines = logs.split('\n').filter(l => l.trim());
    const recentLines = lines.slice(-30);
    
    console.log(`Showing last 30 lines from server.log:\n`);
    recentLines.forEach(line => {
      console.log(line);
    });
  } catch (error) {
    console.log('Could not read server.log file:', error.message);
  }
}

async function getVercelLogs() {
  console.log('='.repeat(60));
  console.log('VERCEL LOGS');
  console.log('='.repeat(60));
  console.log();
  
  try {
    // Get deployments
    const deploymentsOutput = execSync(`npx vercel ls multiplayer-arcade`, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: rootDir,
      timeout: 10000
    });
    
    const lines = deploymentsOutput.split('\n');
    const deploymentUrls = lines
      .filter(line => line.includes('https://') && line.includes('vercel.app'))
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return parts.find(p => p.includes('vercel.app')) || parts[1] || line.trim();
      })
      .filter(url => url && url.startsWith('https://'));
    
    if (deploymentUrls.length === 0) {
      console.log('No deployments found.');
      return;
    }
    
    const latestDeployment = deploymentUrls[0];
    console.log(`Latest deployment: ${latestDeployment}\n`);
    console.log('Note: Vercel CLI logs command streams in real-time.');
    console.log('To view logs, run:');
    console.log(`  npx vercel logs ${latestDeployment}\n`);
    console.log('Or view in dashboard:');
    console.log('  https://vercel.com/jrizzo9s-projects/multiplayer-arcade');
    console.log('  → Deployments → Latest → Functions → api/render-logs\n');
    
    // Try to get a few log lines (with timeout)
    console.log('Attempting to fetch recent logs (5 second timeout)...\n');
    try {
      const logsOutput = execSync(
        `npx vercel logs ${latestDeployment} --json`,
        {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: rootDir,
          timeout: 5000
        }
      );
      
      const logLines = logsOutput.trim().split('\n').filter(l => l);
      if (logLines.length > 0) {
        console.log(`Found ${logLines.length} log entry(ies):\n`);
        logLines.slice(0, 10).forEach(line => {
          try {
            const log = JSON.parse(line);
            const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A';
            console.log(`[${time}] ${log.message || log.raw || JSON.stringify(log)}`);
          } catch {
            console.log(line);
          }
        });
        if (logLines.length > 10) {
          console.log(`\n... and ${logLines.length - 10} more entries`);
        }
      } else {
        console.log('No recent logs found (logs stream in real-time).');
      }
    } catch (error) {
      if (error.message.includes('timeout')) {
        console.log('Log streaming timed out (normal - logs stream in real-time).');
      } else {
        console.log('Could not fetch logs:', error.message);
      }
    }
  } catch (error) {
    console.log('Could not access Vercel:', error.message);
    console.log('Make sure you are logged in: npx vercel login');
  }
}

// Main
console.log('\n');
await getLocalServerLogs();
console.log('\n');
await getLocalFileLogs();
console.log('\n');
await getVercelLogs();
console.log('\n');

