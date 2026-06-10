#!/bin/sh

set -euo pipefail

IMAGE="${1:-exam-app:latest}"

echo "================================"
echo "Image Size Analysis: $IMAGE"
echo "================================"

echo ""
echo "1. Image Size:"
docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{printf "%.2f MB\n", $1 / 1024 / 1024}'

echo ""
echo "2. Docker History (largest 15 layers):"
docker history "$IMAGE" --format "{{.Size}}\t{{.CreatedBy}}" --no-trunc | grep -E "^[0-9]" | sort -hr | head -15

echo ""
echo "3. Directory Sizes (inside image):"
docker run --rm --entrypoint /bin/sh "$IMAGE" -lc 'for dir in /app /app/node_modules /app/apps /app/packages /app/packages/db/migrations /app/apps/api/public; do if [ -d "$dir" ]; then du -sh "$dir"; else echo "MISSING\t$dir"; fi; done' 2>&1 || echo "Note: Some paths may not exist in this image"

echo ""
echo "================================"
echo "Analysis Complete"
echo "================================"