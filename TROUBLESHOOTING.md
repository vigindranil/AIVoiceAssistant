# Troubleshooting Guide

## Common Issues & Solutions

---

## 🎤 Microphone & Recording Issues

### Issue: "Error accessing microphone"

**Symptoms:** Cannot start recording, browser shows permission error

**Solutions:**

1. **Check Browser Permissions**
   - Chrome: Settings > Privacy and security > Site settings > Microphone
   - Firefox: Preferences > Privacy > Permissions > Microphone
   - Safari: System Preferences > Security & Privacy > Microphone
   - Edge: Settings > Privacy > App permissions > Microphone

2. **Allow localhost**
   - Make sure microphone access is allowed for `localhost:3000`

3. **Check Operating System**
   - macOS: System Preferences > Security & Privacy > Microphone > Allow browser
   - Windows: Settings > Privacy & Security > Microphone > Allow app

4. **Use HTTPS**
   - Some browsers require HTTPS for microphone access
   - Use `https://` instead of `http://` if available

5. **Restart Browser**
   ```bash
   # Close all browser windows and restart
   ```

---

### Issue: "Recording works but no audio captured"

**Solutions:**

1. **Check Microphone Volume**
   - Ensure microphone volume is not muted
   - Test volume in system settings

2. **Use Different Microphone**
   - Try a different USB microphone
   - Check if built-in microphone works

3. **Clear Browser Cache**
   ```bash
   # Chrome: Ctrl+Shift+Delete (Cmd+Shift+Delete on Mac)
   # Firefox: Ctrl+Shift+Delete
   # Safari: Develop > Empty Web Storage
   ```

4. **Check Browser Console**
   - Press F12
   - Go to Console tab
   - Look for error messages

---

### Issue: "Audio file upload fails"

**Symptoms:** Upload button doesn't work or shows error

**Solutions:**

1. **Check File Format**
   - Supported: WAV, MP3, WebM, OGG
   - Verify file extension matches format

2. **Check File Size**
   ```
   Maximum: 1GB (Google Cloud limit)
   Recommended: Under 100MB
   ```

3. **Verify File Not Corrupted**
   - Try playing the file in another player
   - Re-encode the file if needed

4. **Browser Compatibility**
   - Try different browser
   - Update browser to latest version

---

## 🔐 Authentication & Credentials Issues

### Issue: "Transcription failed" with authentication error

**Symptoms:** API returns 401/403 error

**Solutions:**

1. **Verify Google Cloud Credentials**
   ```bash
   # Check if file exists
   ls -la google-cloud-key.json
   
   # Verify JSON format
   cat google-cloud-key.json | jq '.'
   ```

2. **Check .env Configuration**
   ```bash
   # Verify .env file
   cat .env | grep GOOGLE_APPLICATION_CREDENTIALS
   
   # Should output:
   # GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json
   ```

3. **Verify Service Account Permissions**
   - Go to Google Cloud Console
   - Check service account has "Cloud Speech-to-Text Editor" role
   - Add role if missing:
     ```
     IAM & Admin > Service Accounts > [Your Account] > Edit Roles
     Add: Cloud Speech-to-Text Editor
     ```

4. **Check API is Enabled**
   - Google Cloud Console > APIs & Services > Library
   - Search "Cloud Speech-to-Text"
   - Verify it shows "ENABLED"

5. **Regenerate Service Account Key**
   ```bash
   # If key is old or invalid:
   # 1. Go to Google Cloud Console
   # 2. IAM & Admin > Service Accounts > [Your Account] > Keys
   # 3. Delete old keys
   # 4. Create new JSON key
   # 5. Replace google-cloud-key.json with new key
   ```

---

### Issue: "GOOGLE_APPLICATION_CREDENTIALS not found"

**Solutions:**

1. **Create .env File**
   ```bash
   cp .env.example .env
   ```

2. **Add Credentials Path**
   ```bash
   echo "GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json" >> .env
   ```

3. **Verify Path is Correct**
   - Path should be relative to project root
   - Use `./` prefix for relative paths
   - Use absolute path if needed

4. **Check File Permissions**
   ```bash
   chmod 644 google-cloud-key.json
   chmod 644 .env
   ```

---

## 🖥️ Server & Port Issues

### Issue: "Server failed to start"

**Symptoms:** Cannot access http://localhost:3000

**Solutions:**

1. **Check if Dependencies are Installed**
   ```bash
   npm install
   ```

2. **Check Node.js Installation**
   ```bash
   node --version  # Should show v14 or higher
   npm --version   # Should show v6 or higher
   ```

3. **Check for Errors in Console**
   - Look at error messages carefully
   - Search for specific error in Google

4. **Try Verbose Start**
   ```bash
   DEBUG=* npm start
   ```

---

### Issue: "Port 3000 already in use"

**Symptoms:** Error: "EADDRINUSE: address already in use :::3000"

**Solutions:**

1. **Find Process Using Port**
   ```bash
   # macOS/Linux
   lsof -i :3000
   
   # Windows
   netstat -ano | findstr :3000
   ```

2. **Kill Process**
   ```bash
   # macOS/Linux
   kill -9 <PID>
   
   # Windows
   taskkill /PID <PID> /F
   ```

3. **Use Different Port**
   ```bash
   # Edit .env
   PORT=3001
   
   # Then restart server
   npm start
   ```

4. **Stop Previous Server Instance**
   ```bash
   # If using PM2
   pm2 stop medical-stt
   pm2 delete medical-stt
   ```

---

### Issue: "Cannot GET /"

**Symptoms:** Browser shows "Cannot GET /" error

**Solutions:**

1. **Check Server is Running**
   - Look at terminal for "Server is running on..."
   - Check http://localhost:3000/api/health
   - Should see: `{"status":"ok","message":"Server is running"}`

2. **Verify Public Files Exist**
   ```bash
   ls -la public/
   # Should show: index.html, styles.css, app.js
   ```

3. **Check File Permissions**
   ```bash
   chmod 644 public/index.html
   chmod 644 public/styles.css
   chmod 644 public/app.js
   ```

4. **Clear Browser Cache**
   - Press Ctrl+Shift+R (Cmd+Shift+R on Mac)
   - Or use private/incognito window

---

## 📊 Transcription Issues

### Issue: "No transcription result" / "Empty result"

**Symptoms:** API returns success but no text

**Solutions:**

1. **Check Audio Quality**
   - Record in quiet environment
   - Speak clearly at normal volume
   - Avoid background noise

2. **Check Audio Duration**
   - Audio should be at least 1 second
   - Max ~480 minutes per request

3. **Check Audio Format**
   - Use recommended format: WAV or MP3
   - Ensure proper encoding (16kHz sample rate)

4. **Check Google Cloud Quota**
   - Google Cloud Console > Speech-to-Text API > Quotas
   - Verify quota limits not exceeded

---

### Issue: "Very low confidence score" (< 50%)

**Symptoms:** Transcription appears but with very low confidence

**Solutions:**

1. **Improve Audio Quality**
   - Record in quiet room
   - Avoid echo or reverb
   - Use better microphone

2. **Slow Down Speech**
   - Speak at normal, deliberate pace
   - Avoid rushing words

3. **Try Different Audio Format**
   - Convert to WAV format
   - Ensure 16kHz sample rate

4. **Check for Background Noise**
   - Close windows and doors
   - Turn off fans, AC
   - Mute notifications

---

### Issue: "Medical terms not recognized"

**Symptoms:** Medical words transcribed incorrectly

**Solutions:**

1. **Verify Medical Model is Used**
   - Check server logs for: `model: 'medical_conversation'`
   - Restart server if not using medical model

2. **Speak Medical Terms Clearly**
   - Medical terms can be complex
   - Speak slowly and distinctly

3. **Check Pronunciation**
   - Ensure correct medical terminology
   - Google can sometimes phonetic spellings

4. **Use Custom Vocabulary** (Future Enhancement)
   - Add medical phrases to custom vocabulary
   - (Currently not implemented but planned)

---

## 🌐 Network & API Issues

### Issue: "Network error" / "Failed to fetch"

**Symptoms:** Browser shows network error when uploading

**Solutions:**

1. **Check Internet Connection**
   ```bash
   ping google.com
   ```

2. **Check Server is Running**
   ```bash
   curl http://localhost:3000/api/health
   ```

3. **Check File Size**
   - Very large files may timeout
   - Upload smaller files

4. **Check Firewall**
   - Firewall may block localhost
   - Add localhost to firewall exceptions

5. **Check Proxy Settings**
   - If behind corporate proxy, may need configuration

---

### Issue: "API rate limit exceeded"

**Symptoms:** Error mentions quota or rate limit

**Solutions:**

1. **Check Google Cloud Quota**
   - Google Cloud Console > Speech-to-Text API > Quotas
   - See current usage

2. **Request Quota Increase**
   - Click quota limit
   - Click "Edit Quotas"
   - Enter desired limit
   - Submit request

3. **Wait for Reset**
   - Quota resets daily at midnight UTC
   - Try again after reset

4. **Optimize Requests**
   - Use shorter audio clips
   - Batch requests efficiently

---

### Issue: "API key invalid" or "403 Forbidden"

**Solutions:**

1. **Check Billing is Enabled**
   - Google Cloud Console > Billing
   - Ensure payment method is on file
   - Ensure project is linked to billing account

2. **Check API is Enabled**
   ```bash
   # Google Cloud Console
   APIs & Services > Library > Search "Speech-to-Text"
   Verify: ENABLED
   ```

3. **Re-authenticate**
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```

4. **Create New Service Account**
   - Old account might have permission issues
   - Create new service account in Google Cloud Console

---

## 📱 Frontend Issues

### Issue: "Page doesn't load" / "Blank white screen"

**Symptoms:** Browser shows blank page

**Solutions:**

1. **Check JavaScript Errors**
   - Press F12
   - Go to Console tab
   - Look for red error messages

2. **Check Network Tab**
   - See if files loaded: index.html, styles.css, app.js
   - If 404, check public folder

3. **Hard Refresh**
   ```
   Ctrl+Shift+R (Cmd+Shift+R on Mac)
   ```

4. **Try Different Browser**
   - Check if issue is browser-specific

5. **Check Browser Console**
   ```
   # Look for errors like:
   # - CORS errors
   # - Module not found
   # - Syntax errors
   ```

---

### Issue: "Buttons not working"

**Symptoms:** Clicking buttons does nothing

**Solutions:**

1. **Check JavaScript Errors**
   - Press F12 > Console tab
   - Look for error messages

2. **Check Server Connection**
   - Run: `curl http://localhost:3000/api/health`
   - Should return JSON

3. **Check Browser Console**
   ```javascript
   // Try in console:
   fetch('/api/health').then(r => r.json()).then(console.log)
   // Should see response
   ```

4. **Clear Cache**
   - Ctrl+Shift+Delete (Cmd+Shift+Delete on Mac)

---

### Issue: "Styling looks broken"

**Symptoms:** UI looks ugly/misaligned

**Solutions:**

1. **Clear Browser Cache**
   - Hard refresh: Ctrl+Shift+R
   - Or clear all cache

2. **Check CSS File**
   - DevTools > Sources > public/styles.css
   - Ensure file loaded with 200 status

3. **Check Browser Zoom**
   - Reset zoom: Ctrl+0 (Cmd+0 on Mac)

4. **Try Different Browser**
   - Test in Chrome, Firefox, Safari

---

## 📝 File System Issues

### Issue: "Permission denied" errors

**Symptoms:** Cannot read/write files

**Solutions:**

```bash
# Fix file permissions
chmod 755 src/
chmod 644 src/server.js
chmod 755 public/
chmod 644 public/*

# Fix .env file
chmod 644 .env

# Fix credentials
chmod 600 google-cloud-key.json
```

---

### Issue: "Cannot find module"

**Symptoms:** Error: "Cannot find module 'express'"

**Solutions:**

```bash
# Reinstall all dependencies
rm -rf node_modules package-lock.json
npm install

# Or install specific package
npm install express

# Verify installation
npm list express
```

---

## 🐛 Getting Help

### Debugging Steps

1. **Enable Verbose Logging**
   ```bash
   DEBUG=* npm start
   ```

2. **Check All Logs**
   - Server console output
   - Browser DevTools (F12)
   - Network tab for API calls

3. **Test API Directly**
   ```bash
   # Test health endpoint
   curl http://localhost:3000/api/health
   
   # Test with audio file
   curl -X POST http://localhost:3000/api/transcribe \
     -F "audio=@/path/to/audio.wav"
   ```

4. **Verify Configuration**
   ```bash
   # Check .env
   cat .env
   
   # Check credentials
   cat google-cloud-key.json | jq '.'
   
   # Check packages
   npm list
   ```

---

### Useful Commands for Debugging

```bash
# Check Node version
node --version

# Check npm version
npm --version

# View server logs
tail -f npm-debug.log

# Monitor system resources
top -p $(pgrep -f "node src/server.js")

# Test microphone (macOS)
say "Test"

# Check disk space
df -h

# Check memory usage
free -h
```

---

## 📞 Reporting Bugs

If you find a bug:

1. **Collect Information**
   - Operating system and version
   - Browser and version
   - Node.js version
   - Error messages (from console and server)
   - Steps to reproduce

2. **Create Minimal Reproduction**
   - Document exact steps
   - Share configuration (without credentials)

3. **Check Existing Issues**
   - Search similar problems online
   - Check GitHub issues

4. **Contact Support**
   - Google Cloud Support for API issues
   - Browser support for browser-specific issues

---

## 📚 Additional Resources

- [Google Cloud Speech-to-Text Docs](https://cloud.google.com/speech-to-text/docs)
- [Express.js Documentation](https://expressjs.com/)
- [MDN Web Docs](https://developer.mozilla.org/)
- [Node.js Documentation](https://nodejs.org/docs/)

---

**Last Updated**: July 2026
**Version**: 1.0.0
