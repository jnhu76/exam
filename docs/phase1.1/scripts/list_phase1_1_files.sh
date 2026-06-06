#!/usr/bin/env bash
set -euo pipefail

echo "Phase 1.1 / Phase 2 pack files:"
find docs scripts -maxdepth 3 -type f | sort
