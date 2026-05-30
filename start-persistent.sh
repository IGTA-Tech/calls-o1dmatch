#!/bin/bash
# Start Sevyn SMS Agent with persistent tunnel
cd /home/innovativeautomations/sevyn-sms-agent

# Kill any existing processes
pkill -f "node sevyn-sms" 2>/dev/null
pkill -f "lt.*3850" 2>/dev/null
sleep 2

# Start the server
nohup node sevyn-sms.js > logs/sevyn.log 2>&1 &
echo "Server started PID: $!"

# Wait for server to be ready
sleep 3

# Start localtunnel
nohup lt --port 3850 --subdomain sevyn-sms > logs/tunnel.log 2>&1 &
echo "Tunnel started PID: $!"

echo "Done! Check logs/sevyn.log and logs/tunnel.log"
