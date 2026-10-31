#!/usr/bin/env bash

# ==============================================================================
# In Tha Route — Multi-Project Orchestrator
# Starts Backend (.NET 8 Web API), Frontend (Next.js), and Mobile (Expo on iOS Simulator)
# ==============================================================================

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prefer Node 22+ for Expo SDK 58 & Next.js
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"

# Color codes
BOLD='\033[1m'
NC='\033[0m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'

echo -e "${BOLD}${CYAN}====================================================================${NC}"
echo -e "${BOLD}${CYAN}      In Tha Route — Launching Backend, Frontend & iOS Simulator    ${NC}"
echo -e "${BOLD}${CYAN}====================================================================${NC}"

# Check prerequisites
if ! command -v dotnet &>/dev/null; then
  echo -e "${RED}❌ dotnet CLI not found. Please install .NET 8 SDK.${NC}"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo -e "${RED}❌ npm not found. Please install Node.js.${NC}"
  exit 1
fi

# Function to check and free port if needed
check_port() {
  local port=$1
  local name=$2
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo -e "${YELLOW}⚠ Port $port ($name) is currently in use by PID(s): $(echo $pids | tr '\n' ' '). Releasing...${NC}"
    for p in $pids; do
      kill -9 "$p" 2>/dev/null || true
    done
    sleep 1
  fi
}

echo -e "\n${YELLOW}→ Checking required ports (5000, 3000, 8081)...${NC}"
check_port 5000 "Backend .NET 8 API"
check_port 3000 "Frontend Next.js Web"
check_port 8081 "Mobile Expo Metro"
echo -e "${GREEN}✔ All ports ready.${NC}"

# Boot and Launch iOS Simulator
echo -e "\n${YELLOW}→ Initializing iOS Simulator...${NC}"
if command -v xcrun &>/dev/null; then
  if ! xcrun simctl list devices | grep -q "(Booted)"; then
    DEVICE_ID=$(xcrun simctl list devices available | grep -m 1 "iPhone 17 Pro " | awk -F '[()]' '{print $2}')
    if [ -z "$DEVICE_ID" ]; then
      DEVICE_ID=$(xcrun simctl list devices available | grep -m 1 "iPhone" | awk -F '[()]' '{print $2}')
    fi
    if [ -n "$DEVICE_ID" ]; then
      echo -e "${CYAN}→ Booting simulator device ($DEVICE_ID)...${NC}"
      xcrun simctl boot "$DEVICE_ID" 2>/dev/null || true
    fi
  else
    BOOTED_NAME=$(xcrun simctl list devices | grep "(Booted)" | head -n 1 | sed 's/^[ \t]*//' | cut -d'(' -f1)
    echo -e "${GREEN}✔ Simulator already running: ${BOLD}${BOOTED_NAME}${NC}"
  fi
  open -a Simulator 2>/dev/null || true
  echo -e "${GREEN}✔ iOS Simulator window active.${NC}\n"
fi

# Array to store child PIDs
PIDS=()

cleanup() {
  echo -e "\n\n${BOLD}${YELLOW}→ Shutting down all In Tha Route services...${NC}"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  echo -e "${GREEN}✔ All services stopped cleanly.${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo -e "${BOLD}Launching services in parallel:${NC}"
echo -e "  ${BLUE}● [Backend]${NC}   http://localhost:5000 (Swagger: http://localhost:5000/swagger)"
echo -e "  ${PURPLE}● [Frontend]${NC}  http://localhost:3000"
echo -e "  ${GREEN}● [Mobile]${NC}    http://localhost:8081 (Auto-launching on iOS Simulator)"
echo -e "${BOLD}${CYAN}--------------------------------------------------------------------${NC}\n"

# 1. Start Backend (.NET 8 Web API)
(
  cd "$ROOT_DIR/backend"
  dotnet run --urls "http://localhost:5000" 2>&1 | while IFS= read -r line; do
    echo -e "${BLUE}[backend]${NC}  $line"
  done
) &
PIDS+=($!)

# 2. Start Frontend (Next.js)
(
  cd "$ROOT_DIR/frontend"
  npm run dev -- --port 3000 2>&1 | while IFS= read -r line; do
    echo -e "${PURPLE}[frontend]${NC} $line"
  done
) &
PIDS+=($!)

# 3. Start Mobile (React Native Expo on iOS Simulator)
(
  cd "$ROOT_DIR/mobile"
  (sleep 4 && xcrun simctl openurl booted "exp://127.0.0.1:8081" 2>/dev/null || true) &
  echo "y" | npx expo start --ios --port 8081 2>&1 | while IFS= read -r line; do
    echo -e "${GREEN}[mobile]${NC}   $line"
  done
) &
PIDS+=($!)

# Wait for all background jobs
wait

