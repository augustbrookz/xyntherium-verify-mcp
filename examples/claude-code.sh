#!/usr/bin/env sh
# Add the hosted Xyntherium Verify MCP server to Claude Code.
# Get a key at https://xyntherium.com/account/api-keys, then: XYN_API_KEY=xyn_live_… sh examples/claude-code.sh
set -eu
: "${XYN_API_KEY:?set XYN_API_KEY to your Xyntherium API key}"
claude mcp add --transport http xyntherium-verify https://www.xyntherium.com/mcp \
  --header "Authorization: Bearer $XYN_API_KEY" "$@"
# Check it: claude mcp list
# Make it available in every project: add --scope user to the command above.
