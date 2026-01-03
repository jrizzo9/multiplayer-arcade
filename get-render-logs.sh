#!/bin/bash
# Script to retrieve and display client logs from Render server

SERVER_URL="https://multiplayer-arcade-server.onrender.com"
LIMIT=${1:-50}
LEVEL=${2:-""}

echo "=== Fetching Client Logs from Render Server (last $LIMIT) ==="
echo "Server: $SERVER_URL"
echo ""

# Build URL with optional level filter
URL="${SERVER_URL}/api/debug/client-logs?limit=${LIMIT}"
if [ -n "$LEVEL" ]; then
  URL="${URL}&level=${LEVEL}"
fi

# Fetch and format logs
curl -s "$URL" | python3 -c "
import json
import sys
from datetime import datetime

try:
    data = json.load(sys.stdin)
    logs = data.get('logs', [])
    total = data.get('total', 0)
    
    print(f'Total logs available: {total}')
    print(f'Returned: {len(logs)}')
    print('')
    
    if not logs:
        print('No logs found. The server may have just woken up or no logs have been sent yet.')
        sys.exit(0)
    
    # Group by level
    errors = [log for log in logs if log.get('level') == 'error']
    warnings = [log for log in logs if log.get('level') == 'warn']
    info = [log for log in logs if log.get('level') == 'info']
    
    print(f'📊 Summary:')
    print(f'  Errors: {len(errors)}')
    print(f'  Warnings: {len(warnings)}')
    print(f'  Info: {len(info)}')
    print('')
    
    # Show recent errors first
    if errors:
        print('🔴 RECENT ERRORS:')
        print('=' * 80)
        for log in errors[-10:]:  # Last 10 errors
            timestamp = log.get('serverTimestamp', log.get('timestamp', 'N/A'))
            message = log.get('message', 'No message')
            print(f'[{timestamp}] {message}')
        print('')
    
    # Show recent warnings
    if warnings:
        print('⚠️  RECENT WARNINGS:')
        print('=' * 80)
        for log in warnings[-5:]:  # Last 5 warnings
            timestamp = log.get('serverTimestamp', log.get('timestamp', 'N/A'))
            message = log.get('message', 'No message')
            print(f'[{timestamp}] {message}')
        print('')
    
    # Show most recent logs
    print('📝 MOST RECENT LOGS:')
    print('=' * 80)
    for log in logs[-20:]:  # Last 20 logs
        level = log.get('level', 'info').upper()
        timestamp = log.get('serverTimestamp', log.get('timestamp', 'N/A'))
        message = log.get('message', 'No message')
        
        # Color coding
        if level == 'ERROR':
            prefix = '🔴'
        elif level == 'WARN':
            prefix = '⚠️ '
        else:
            prefix = 'ℹ️ '
        
        print(f'{prefix} [{level}] [{timestamp}] {message}')
    
except json.JSONDecodeError as e:
    print(f'Error parsing JSON: {e}')
    print('Raw response:')
    sys.stdin.seek(0)
    print(sys.stdin.read())
except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
"

