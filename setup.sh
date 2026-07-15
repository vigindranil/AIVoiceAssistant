#!/bin/bash

# Medical Speech-to-Text Setup Script
# This script helps set up the application automatically

echo "================================================"
echo "Medical Speech-to-Text Setup"
echo "================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please download from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo "✅ npm found: $(npm --version)"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  Important: Edit .env and add your Google Cloud credentials"
    echo "   1. Set GOOGLE_APPLICATION_CREDENTIALS to your key file path"
    echo "   2. Ensure your google-cloud-key.json is in the project root"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "================================================"
echo "✨ Setup Complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Ensure your Google Cloud credentials are set up"
echo "2. Edit .env with your GOOGLE_APPLICATION_CREDENTIALS path"
echo "3. Run: npm start"
echo "4. Open: http://localhost:3000"
echo ""
echo "For detailed instructions, see README.md"
echo ""
