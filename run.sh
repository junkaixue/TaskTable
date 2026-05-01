#!/bin/bash

# TaskTable - Build & Restart (async/daemonized)
# Kills any existing instances, rebuilds backend, starts both in background, then exits

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_PORT=8080
FRONTEND_PORT=3000
PID_FILE="$SCRIPT_DIR/.pids"

echo "=== TaskTable: Build & Restart ==="

# Kill existing processes
echo "Stopping existing processes..."
if [ -f "$PID_FILE" ]; then
    while read -r pid; do
        kill "$pid" 2>/dev/null
    done < "$PID_FILE"
    rm "$PID_FILE"
fi
lsof -ti:$BACKEND_PORT | xargs kill -9 2>/dev/null
lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null
sleep 1

# Build backend
echo "Building backend..."
cd "$BACKEND_DIR"
go build -o tasktable . || { echo "Build failed!"; exit 1; }
echo "Build successful."

# Start backend (daemonized)
nohup ./tasktable > "$SCRIPT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Start frontend (daemonized)
cd "$FRONTEND_DIR"
nohup python3 -m http.server $FRONTEND_PORT > "$SCRIPT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Save PIDs for next restart
echo "$BACKEND_PID" > "$PID_FILE"
echo "$FRONTEND_PID" >> "$PID_FILE"

echo ""
echo "=== TaskTable is running (background) ==="
echo "  Backend:  http://localhost:$BACKEND_PORT  (PID $BACKEND_PID)"
echo "  Frontend: http://localhost:$FRONTEND_PORT  (PID $FRONTEND_PID)"
echo ""
echo "  Logs: backend.log, frontend.log"
echo "  Stop: ./stop.sh"
