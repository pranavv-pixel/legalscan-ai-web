#!/bin/bash
echo "Starting LegalScan AI locally..."
echo "Do not close this window while using the app."
( sleep 1 && open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null ) &
python3 -m http.server 8000
