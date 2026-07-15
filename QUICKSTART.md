# 🚀 Quick Start Guide

## 5-Minute Setup

### Step 1: Install Node.js (if not already installed)
Download from https://nodejs.org/ and install

### Step 2: Get Google Cloud Credentials

1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable "Cloud Speech-to-Text API" (APIs & Services > Library > Search "Speech-to-Text" > Enable)
4. Create a Service Account (APIs & Services > Credentials > Create Credentials > Service Account)
5. Create a JSON key (Service Account > Keys > Add Key > Create new key > JSON)
6. Download and save the key file

### Step 3: Set Up the Application

```bash
# Navigate to project directory
cd /Users/indranilsarmacharya/Documents/AI_STT

# Copy the key file
cp /path/to/downloaded/key.json ./google-cloud-key.json

# Create .env file
cat > .env << EOF
GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json
PORT=3000
EOF

# Install dependencies
npm install
```

### Step 4: Run the Application

```bash
npm start
```

You'll see:
```
Server is running on http://localhost:3000
Google Cloud Speech-to-Text (Medical Model) integrated
```

### Step 5: Open in Browser

Go to: **http://localhost:3000**

---

## What You'll See

### Main Interface
- 🎤 **Start Recording** - Record audio from your microphone
- ⏹️ **Stop Recording** - Stop the recording
- ⬆️ **Upload Audio File** - Upload pre-recorded audio
- 📋 **Copy Text** - Copy transcription to clipboard
- 💾 **Download Transcript** - Save as text file
- 🗑️ **Clear** - Clear all results

### Features
- ✅ Real-time recording
- ✅ Support for MP3, WAV, WebM, OGG formats
- ✅ Medical terminology optimization
- ✅ Confidence score display
- ✅ Processing time measurement
- ✅ Responsive mobile-friendly design

---

## Common Issues & Solutions

### "Error accessing microphone"
→ Check browser settings > Allow microphone for localhost

### "Authentication failed"
→ Verify the JSON key file path in .env matches `./google-cloud-key.json`

### "Port 3000 already in use"
→ Change PORT in .env to something else (e.g., 3001)

### "GOOGLE_APPLICATION_CREDENTIALS not found"
→ Ensure the JSON key file is in the project root directory

---

## Development Mode (Auto-reload)

```bash
npm run dev
```

This uses nodemon to automatically restart the server when you make changes.

---

## Cost Alert ⚠️

Google Cloud Speech-to-Text is a **paid service**:
- First 60 minutes/month: FREE
- After that: ~$0.024 per minute

Check your Google Cloud billing dashboard to monitor usage.

---

## Next Steps

1. Read the full [README.md](./README.md) for detailed documentation
2. Check API responses in browser DevTools (F12 > Network tab)
3. Try recording medical conversations to see the model in action
4. Customize the UI in `public/` folder as needed

---

## Project Structure

```
medical-speech-to-text/
├── src/server.js          ← Backend logic
├── public/
│   ├── index.html         ← Main page
│   ├── styles.css         ← Styling
│   └── app.js             ← Frontend logic
├── package.json           ← Dependencies
├── .env                   ← Configuration (create this)
└── google-cloud-key.json  ← Auth key (create this)
```

---

Happy transcribing! 🎉
