@echo off
cd /d "%~dp0"
echo === Pokemon MMO Catcher Setup ===
echo.

if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Make sure Node.js is installed: https://nodejs.org
    pause
    exit /b 1
  )
) else (
  echo Dependencies already installed.
)

REM ============ Environment configuration ============
REM JWT secret — change this to a long random string for production
set JWT_SECRET=okmo-pokemon-mmo-jwt-secret-change-me-in-production

REM PayPal credentials (Sandbox mode for testing)
set PAYPAL_MODE=sandbox
set PAYPAL_CLIENT_ID=AcXS9b46b1W37tMmJZbo7Q55UODmIXgroQU8FfTYZ-nWYcmuq0fWRRa68z2keiW_RjDUhIZjhdUsMYBy
set PAYPAL_CLIENT_SECRET=ELTwlBDiKJpjdiPOnRDEZq3gt5IISfDz2iBFuXHUw6U-820d9ODnngxSQ6XHjGqMRhILbcj1jXuKoPIR

REM For production switch to live credentials and set PAYPAL_MODE=live
REM set PAYPAL_MODE=live
REM set PAYPAL_CLIENT_ID=...your-live-client-id...
REM set PAYPAL_CLIENT_SECRET=...your-live-secret...

echo.
echo Starting server at http://localhost:3000 ...
echo Open this URL in your browser. Press Ctrl+C here to stop the server.
echo.

call npm start
pause
