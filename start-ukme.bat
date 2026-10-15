@echo off
cd /d "%~dp0"
if not exist node_modules\mongodb (
  echo Installing MongoDB driver, one moment...
  call npm install --omit=dev
)
start "" http://127.0.0.1:3000
node server.js
pause
