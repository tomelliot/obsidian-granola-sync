#!/bin/bash
# Fetch a single document from the Granola API and save the response to a JSON file.
# Usage: ./scripts/fetch-document.sh <document-id>

set -euo pipefail

DOC_ID="${1:?Usage: $0 <document-id>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../docs/api-response"
CREDS_PATH="$HOME/Library/Application Support/Granola/supabase.json"

mkdir -p "$OUTPUT_DIR"

# Extract access token from Granola credentials
if [ ! -f "$CREDS_PATH" ]; then
  echo "Error: Credentials file not found at $CREDS_PATH" >&2
  exit 1
fi

ACCESS_TOKEN=$(python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
tokens = json.loads(data['workos_tokens'])
print(tokens['access_token'])
" "$CREDS_PATH")

echo "Fetching documents from Granola API..."

# Fetch all documents and filter for the target ID using jq
RESPONSE=$(curl -s --compressed -X POST "https://api.granola.ai/v2/get-documents" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: */*" \
  -H "User-Agent: Undefined" \
  -H "X-Client-Version: 1.0.0" \
  -d "{\"limit\": 100, \"offset\": 0, \"include_last_viewed_panel\": true}")

# Save the full response
echo "$RESPONSE" | python3 -m json.tool > "$OUTPUT_DIR/get-documents-response.json"
echo "Saved full get-documents response to $OUTPUT_DIR/get-documents-response.json"

# Extract the single document by ID
FILTERED=$(echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
docs = data.get('docs', [])
match = [d for d in docs if d.get('id') == '$DOC_ID']
if not match:
    print(f'Warning: Document $DOC_ID not found in response ({len(docs)} docs checked)', file=sys.stderr)
    json.dump(data, sys.stdout, indent=2)
else:
    json.dump(match[0], sys.stdout, indent=2)
")

DOC_OUTPUT="$OUTPUT_DIR/get-document-$DOC_ID.json"
echo "$FILTERED" > "$DOC_OUTPUT"
echo "Saved document to $DOC_OUTPUT"

# Also fetch the transcript
echo "Fetching transcript..."
TRANSCRIPT=$(curl -s --compressed -X POST "https://api.granola.ai/v1/get-document-transcript" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: */*" \
  -H "User-Agent: Undefined" \
  -H "X-Client-Version: 1.0.0" \
  -d "{\"document_id\": \"$DOC_ID\"}")

TRANSCRIPT_OUTPUT="$OUTPUT_DIR/get-document-transcript-$DOC_ID.json"
echo "$TRANSCRIPT" | python3 -m json.tool > "$TRANSCRIPT_OUTPUT"
echo "Saved transcript to $TRANSCRIPT_OUTPUT"
