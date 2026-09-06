@echo off
echo Starting LegalScan AI locally...
echo Do not close this window while using the app.
start http://localhost:8000
python -m http.server 8000
pause
