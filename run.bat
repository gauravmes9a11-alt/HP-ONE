@echo off
REM Project UDAAN — HP ONE Dashboard
REM Quick-start script for Windows.

echo == Project UDAAN — HP ONE Dashboard ==
cd /d "%~dp0backend"

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat
echo Installing dependencies...
pip install --upgrade pip -q
pip install -r requirements.txt -q

echo.
echo Starting backend API on http://localhost:8000 ...
echo Once it's up, open frontend\index.html in your browser.
echo.
uvicorn main:app --reload --port 8000
