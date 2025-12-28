# Log Export

Generated: $(date)

## Files in this export:

1. **client-logs.json** - Last 500 client-side log entries from the API
2. **server-events.json** - Last 500 server event log entries from the API
3. **server.log** - Last 500 lines from the server log file

## Summary

- **Client Logs**: Contains diagnostic information, room management events, and debugging data from the frontend
- **Server Events**: Contains server-side events including player connections, disconnections, room management, and database operations
- **Server Log**: Raw server console output including errors and warnings

## Recent Issues Noted

From the server log, there appears to be a TypeError related to `readyPlayers.delete()` when a player disconnects, suggesting a potential issue with room cleanup when the host disconnects.

