#!/usr/bin/env node

/**
 * Script to fetch Vercel logs using the Vercel API
 * Requires Vercel CLI to be authenticated
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const PROJECT_NAME = 'multiplayer-arcade';
const DEPLOYMENT_URL = process.argv[2] || null;

async function getVercelLogs() {
  console.log('Fetching Vercel logs...\n');
  
  try {
    // First, get recent deployments
    console.log('Getting recent deployments...');
    const deploymentsOutput = execSync(`npx vercel ls ${PROJECT_NAME}`, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: rootDir,
      timeout: 10000
    });
    
    // Parse deployment URLs from output
    const lines = deploymentsOutput.split('\n');
    const deploymentUrls = lines
      .filter(line => line.includes('https://') && line.includes('vercel.app'))
      .map(line => line.trim().split(/\s+/)[1] || line.trim())
      .filter(url => url);
    
    const deployments = deploymentUrls.map(url => ({ url }));
    
    if (deployments.length === 0) {
      console.log('No deployments found.');
      return;
    }
    
    console.log(`Found ${deployments.length} deployment(s)\n`);
    
    // Use the most recent deployment
    const deployment = deployments[0];
    const deploymentUrl = DEPLOYMENT_URL || deployment.url || deployment.name;
    
    console.log(`Fetching logs for: ${deploymentUrl}`);
    console.log(`Deployment ID: ${deployment.uid || 'N/A'}`);
    console.log(`Status: ${deployment.state || 'N/A'}`);
    console.log(`Created: ${deployment.created ? new Date(deployment.created).toLocaleString() : 'N/A'}\n`);
    
    // Try to get logs - note: vercel logs command streams logs and may wait for new ones
    console.log('Attempting to fetch logs (this may take a moment)...\n');
    console.log('Note: Vercel CLI logs command streams logs in real-time.');
    console.log('For historical logs, use the Vercel Dashboard:\n');
    console.log(`https://vercel.com/jrizzo9s-projects/${PROJECT_NAME}`);
    console.log(`→ Deployments → ${deploymentUrl} → Functions → api/render-logs\n`);
    
    // Try to get logs with a limited output
    try {
      const logsOutput = execSync(
        `npx vercel logs ${deploymentUrl} --json`,
        {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: rootDir,
          timeout: 5000 // 5 second timeout
        }
      );
      
      const logs = logsOutput.trim().split('\n').filter(line => line);
      const parsedLogs = logs.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
      
      if (parsedLogs.length > 0) {
        console.log(`\nFound ${parsedLogs.length} log entry(ies):\n`);
        parsedLogs.slice(0, 20).forEach((log, i) => {
          if (log.message) {
            console.log(`[${log.timestamp || 'N/A'}] ${log.message}`);
            if (log.meta) {
              console.log(`  Meta: ${JSON.stringify(log.meta)}`);
            }
          } else if (log.raw) {
            console.log(log.raw);
          }
        });
        
        if (parsedLogs.length > 20) {
          console.log(`\n... and ${parsedLogs.length - 20} more log entries`);
        }
      } else {
        console.log('No logs found in the last few minutes.');
        console.log('Vercel logs are real-time and may not have recent activity.');
      }
    } catch (error) {
      if (error.message.includes('timeout')) {
        console.log('Log streaming timed out (this is normal - logs stream in real-time).');
        console.log('To view logs, use one of these methods:\n');
      } else {
        console.log('Could not fetch logs via CLI. Error:', error.message);
        console.log('\nAlternative methods to view logs:\n');
      }
      
      console.log('1. Vercel Dashboard (Recommended):');
      console.log(`   https://vercel.com/jrizzo9s-projects/${PROJECT_NAME}`);
      console.log(`   → Deployments → ${deploymentUrl}`);
      console.log(`   → Functions → api/render-logs\n`);
      
      console.log('2. Vercel CLI (interactive):');
      console.log(`   npx vercel logs ${deploymentUrl}\n`);
    }
    
  } catch (error) {
    console.error('Error fetching Vercel logs:', error.message);
    console.log('\nMake sure you are logged in to Vercel:');
    console.log('  npx vercel login\n');
    console.log('Or check the dashboard directly:');
    console.log(`  https://vercel.com/jrizzo9s-projects/${PROJECT_NAME}\n`);
  }
}

getVercelLogs();

