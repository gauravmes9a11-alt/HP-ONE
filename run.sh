#!/usr/bin/env bash
# Project UDAAN — HP ONE Dashboard
# Quick-start script for macOS / Linux.
set -e

echo "== Project UDAAN — HP ONE Dashboard =="

cd "$(dirname "$0")/backend"

if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
echo "Installing dependencies..."
pip install --upgrade pip -q
pip install -r requirements.txt -q

echo ""
echo "Starting backend API on http://localhost:8000 ..."
echo "Once it's up, open frontend/index.html in your browser (or run: python3 -m http.server 5500 --directory ../frontend)"
echo ""
uvicorn main:app --reload --port 8000
