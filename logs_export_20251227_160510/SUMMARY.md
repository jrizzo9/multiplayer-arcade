# Log Export Summary

Generated: $(date)

## File Sizes
- client-logs.json: 304KB (500 entries)
- server-events.json: 133KB (500 entries)  
- server.log: 26KB (500 lines)

## Recent Activity Overview

### Client Logs
- Contains diagnostic information from frontend
- Room management events
- Socket connection status
- Player join/leave events

### Server Events  
- Player connections/disconnections
- Room management operations
- Database operations
- Socket.io events

### Server Log
- Console output including errors
- Recent error detected: TypeError with readyPlayers.delete() on player disconnect

## Key Statistics

Run these commands to get more details:

```bash
# Count total log entries
jq '.logs | length' client-logs.json
jq '.logs | length' server-events.json

# Filter by log level
jq '.logs[] | select(.level == "error")' client-logs.json
jq '.logs[] | select(.level == "error")' server-events.json

# Get most recent entries
jq '.logs[-10:]' client-logs.json
jq '.logs[-10:]' server-events.json
```

