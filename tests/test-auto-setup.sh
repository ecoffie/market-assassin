#!/bin/bash
# Auto-Setup ("Set up my Mindy") unit tests.
#
# Thin wrapper so `npm test` / run-all-tests.sh picks up the TS unit test. The
# real assertions live in auto-setup.test.ts and run against local source via
# Node type stripping — no server, no auth, no network.
#
# Usage: bash tests/test-auto-setup.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node --experimental-strip-types "$SCRIPT_DIR/auto-setup.test.ts"
exit $?
