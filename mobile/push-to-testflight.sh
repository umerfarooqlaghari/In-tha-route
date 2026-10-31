#!/usr/bin/env bash

# ==============================================================================
# In Tha Route — Push to Apple TestFlight / App Store Script
# Builds iOS production release (Local Xcode or EAS Cloud) & submits to TestFlight
# Uses App Store Connect API Key (VTVNRS996B) & Distribution Certificate (dist-cert.p12)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR/mobile" ]; then
  MOBILE_DIR="$SCRIPT_DIR/mobile"
else
  MOBILE_DIR="$SCRIPT_DIR"
fi

cd "$MOBILE_DIR"

# Ensure Node 22+ and Homebrew tools (eas, fastlane, pod) are on PATH
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"

# Colors
BOLD='\033[1m'
NC='\033[0m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'

echo -e "${BOLD}${CYAN}====================================================${NC}"
echo -e "${BOLD}${CYAN}     In Tha Route — Apple App Store / TestFlight    ${NC}"
echo -e "${BOLD}${CYAN}====================================================${NC}"

# Check EAS CLI
if ! command -v eas &>/dev/null; then
  echo -e "${RED}❌ Error: 'eas' command not found.${NC}"
  echo -e "Install EAS CLI with: ${YELLOW}npm install -g eas-cli${NC}"
  exit 1
fi

# Verify credentials
if [ ! -f "$MOBILE_DIR/credentials/AuthKey_VTVNRS996B.p8" ]; then
  echo -e "${RED}❌ Missing App Store Connect API key in $MOBILE_DIR/credentials/AuthKey_VTVNRS996B.p8${NC}"
  exit 1
fi

if [ ! -f "$MOBILE_DIR/credentials/dist-cert.p12" ]; then
  echo -e "${RED}❌ Missing Distribution Certificate in $MOBILE_DIR/credentials/dist-cert.p12${NC}"
  exit 1
fi

if [ ! -f "$MOBILE_DIR/credentials/InThaRouteAppStore.mobileprovision" ]; then
  echo -e "${RED}❌ Missing Provisioning Profile in $MOBILE_DIR/credentials/InThaRouteAppStore.mobileprovision${NC}"
  exit 1
fi

echo -e "${GREEN}✔ Bundle ID: com.in-tha-route.delivery (App ID: 6829069581)${NC}"
echo -e "${GREEN}✔ App Store Connect Key verified: credentials/AuthKey_VTVNRS996B.p8${NC}"
echo -e "${GREEN}✔ Apple Distribution Certificate verified: credentials/dist-cert.p12${NC}"
echo -e "${GREEN}✔ Provisioning Profile verified: credentials/InThaRouteAppStore.mobileprovision${NC}"

CHOICE="${1:-}"
if [ -z "$CHOICE" ]; then
  echo -e "\n${BOLD}${CYAN}Select Deployment Mode:${NC}"
  echo -e "1) ${BOLD}Local Mac Xcode Build + Auto-Submit to TestFlight${NC} (Recommended — Bypasses EAS Free Plan Cloud Quota)"
  echo -e "2) EAS Cloud Build + Auto-Submit to TestFlight"
  echo -e "3) Submit existing local build-in-tha-route.ipa to TestFlight"
  read -p "Select option [1-3] (Default: 1): " -r USER_CHOICE
  CHOICE="${USER_CHOICE:-1}"
fi

case "$CHOICE" in
  1|local)
    echo -e "\n${GREEN}→ Building iOS Production IPA locally via Xcode & EAS...${NC}"
    eas build --platform ios --profile production --local --non-interactive --output build-in-tha-route.ipa
    echo -e "\n${GREEN}→ Uploading build-in-tha-route.ipa to Apple TestFlight...${NC}"
    eas submit --platform ios --profile production --path build-in-tha-route.ipa --non-interactive
    ;;
  2|cloud)
    echo -e "\n${GREEN}→ Initiating EAS Cloud iOS Production Build with Auto-Submit...${NC}"
    eas build --platform ios --profile production --auto-submit --non-interactive
    ;;
  3|submit)
    echo -e "\n${GREEN}→ Submitting build-in-tha-route.ipa to App Store Connect TestFlight...${NC}"
    eas submit --platform ios --profile production --path build-in-tha-route.ipa --non-interactive
    ;;
  *)
    echo -e "${RED}Invalid choice '$CHOICE'. Use 1 (local), 2 (cloud), or 3 (submit).${NC}"
    exit 1
    ;;
esac

echo -e "\n${BOLD}${GREEN}✔ Deployment to TestFlight completed!${NC}"
echo -e "View build status on App Store Connect:"
echo -e "${CYAN}https://appstoreconnect.apple.com/apps/6829069581/testflight/ios${NC}\n"
