# Architecture & Technical Documentation

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Browser                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Frontend (React-like Vanilla JS)            │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  • Audio Recording (MediaRecorder API)        │ │  │
│  │  │  • File Upload Handling                       │ │  │
│  │  │  • UI/UX Components                           │ │  │
│  │  │  • Transcription Display                      │ │  │
│  │  │  • Copy & Download Functionality             │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│              Node.js/Express Server                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Express.js Framework                               │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  GET  /api/health                             │ │  │
│  │  │  POST /api/transcribe  (audio/multipart-form)│ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │                                                       │  │
│  │  Middleware:                                         │  │
│  │  • Express.static (public files)                    │  │
│  │  • Multer (file upload)                            │  │
│  │  • Error handling                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓ gRPC/HTTP
┌─────────────────────────────────────────────────────────────┐
│       Google Cloud Speech-to-Text API                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Model: medical_conversation                         │  │
│  │  Features:                                           │  │
│  │  • Medical terminology recognition                  │  │
│  │  • Automatic punctuation                            │  │
│  │  • Enhanced audio processing                        │  │
│  │  • Confidence scoring                               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend
- **HTML5**: Semantic structure
- **CSS3**: Responsive design with Flexbox
- **Vanilla JavaScript**: No framework dependencies
- **Web APIs**:
  - `MediaRecorder API`: Audio recording
  - `getUserMedia`: Microphone access
  - `Fetch API`: Server communication
  - `Blob`: Binary audio data handling

### Backend
- **Node.js**: JavaScript runtime
- **Express.js**: Web framework
  - Routing
  - Static file serving
  - Middleware support
- **Multer**: Multipart form data handling
- **@google-cloud/speech**: Google Cloud SDK
- **dotenv**: Environment configuration

### Cloud Services
- **Google Cloud Speech-to-Text API**
  - Medical model (`medical_conversation`)
  - Sample rate: 16kHz
  - Supported encodings: LINEAR16, MP3, WEBM_OPUS, OGG_OPUS
  - Maximum file size: 1GB

## Data Flow

### Recording Flow
```
1. User clicks "Start Recording"
   ↓
2. Browser requests microphone permission
   ↓
3. MediaRecorder captures audio chunks
   ↓
4. Audio chunks stored in memory
   ↓
5. User clicks "Stop Recording"
   ↓
6. Audio chunks converted to Blob (WAV format)
   ↓
7. FormData created with audio blob
   ↓
8. POST request sent to /api/transcribe
   ↓
9. Response: Transcription + Confidence Score
   ↓
10. Results displayed in UI
```

### File Upload Flow
```
1. User clicks "Upload Audio File"
   ↓
2. File input dialog opens
   ↓
3. User selects audio file
   ↓
4. FileReader reads file as ArrayBuffer
   ↓
5. Blob created from ArrayBuffer
   ↓
6. FormData created with blob
   ↓
7. POST request sent to /api/transcribe
   ↓
8. Response: Transcription + Confidence Score
   ↓
9. Results displayed in UI
```

### Server Processing Flow
```
1. Receive POST /api/transcribe
   ↓
2. Extract audio file from multipart form
   ↓
3. Get audio buffer from file
   ↓
4. Determine audio encoding (MIME type)
   ↓
5. Build Google Cloud Speech-to-Text request
   ├─ config:
   │  ├─ encoding (based on MIME type)
   │  ├─ sampleRateHertz: 16000
   │  ├─ languageCode: 'en-US'
   │  ├─ model: 'medical_conversation'
   │  ├─ useEnhanced: true
   │  └─ enableAutomaticPunctuation: true
   └─ audio:
      └─ content: base64-encoded audio
   ↓
6. Call Google Cloud API: speechClient.recognize(request)
   ↓
7. Parse response:
   ├─ Extract transcription from results
   └─ Calculate average confidence
   ↓
8. Return JSON response:
   ├─ success: true
   ├─ transcription: string
   ├─ confidence: number (percentage)
   └─ resultCount: number
```

## API Reference

### GET /api/health
Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "message": "Server is running"
}
```

### POST /api/transcribe
Transcribe audio file using medical model

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body:
  - `audio`: Binary audio file

**Supported Audio Formats:**
| Format | MIME Type | Encoding |
|--------|-----------|----------|
| WAV    | audio/wav | LINEAR16 |
| MP3    | audio/mpeg | MP3 |
| WebM   | audio/webm | WEBM_OPUS |
| OGG    | audio/ogg | OGG_OPUS |

**Response (Success):**
```json
{
  "success": true,
  "transcription": "The patient reports symptoms of...",
  "confidence": "94.23",
  "resultCount": 3
}
```

**Response (Error):**
```json
{
  "error": "Transcription failed",
  "details": "Error message details"
}
```

## Configuration

### Environment Variables (.env)

```env
# Google Cloud Authentication
GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json

# Server Configuration
PORT=3000

# Optional Debug Mode
DEBUG=false
```

### Google Cloud Configuration

**Service Account JSON Structure:**
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "service-account@project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/..."
}
```

## Medical Model Details

The `medical_conversation` model is specifically trained for:

### Optimized For:
- Medical terminology
- Clinical conversations
- Doctor-patient interactions
- Healthcare-specific vocabulary
- Medical abbreviations and acronyms

### Features:
- Better accuracy for health-related content
- Recognition of medical procedures and conditions
- Medication names pronunciation
- Anatomical terms

### Performance Characteristics:
- Accuracy: 85-95% depending on audio quality
- Processing: ~1-5 seconds for typical recordings
- Language: English (US) - en-US
- Sample Rate: 16kHz recommended

## File Upload Limits

- **Maximum file size**: 1GB (Google Cloud limit)
- **Recommended**: Under 100MB for optimal performance
- **Audio duration**: Up to 480 minutes total per request

## Performance Optimization Tips

1. **Audio Recording**:
   - Use quiet environment
   - Speak clearly and at normal pace
   - Avoid background noise

2. **File Format**:
   - WAV: Best quality, larger file size
   - MP3: Compressed, faster upload
   - WebM: Modern, good compression
   - OGG: Efficient, good support

3. **Sample Rate**:
   - 16kHz: Optimal for speech
   - 8kHz: Lower quality but faster
   - 44.1kHz: Higher quality but larger files

## Security Considerations

### Authentication
- Uses Google Cloud service account authentication
- JSON key file must be kept secure
- Never commit credentials to version control

### Data Privacy
- Audio is sent directly to Google Cloud
- No data persistence on the server
- Audio not logged or stored

### HTTPS
- Use HTTPS in production
- Enable CORS if needed
- Validate file uploads

## Error Handling

### Client-Side Errors
1. Microphone not available
2. Browser doesn't support required APIs
3. Network timeout
4. Invalid file format

### Server-Side Errors
1. Invalid audio file
2. API authentication failed
3. API quota exceeded
4. Unsupported audio encoding

### Google Cloud Errors
1. API disabled
2. Quota exceeded
3. Invalid request format
4. Service unavailable

## Deployment Considerations

### Environment Setup
- Node.js LTS version recommended
- Set NODE_ENV=production for production
- Use process manager (PM2, forever)

### Scaling
- Stateless design allows horizontal scaling
- No session storage required
- Load balance across multiple instances

### Monitoring
- Log API calls and responses
- Track API usage and costs
- Monitor error rates
- Set up alerts for quota limits

### Database (Optional Future)
- Store transcription history
- User management
- Audit logs

## Browser Compatibility

| Browser | Version | Support |
|---------|---------|---------|
| Chrome  | 25+     | ✅ Full |
| Firefox | 25+     | ✅ Full |
| Safari  | 14.1+   | ✅ Full |
| Edge    | 79+     | ✅ Full |
| Opera   | 15+     | ✅ Full |

Required Features:
- MediaRecorder API
- getUserMedia
- Fetch API
- Blob support
- ArrayBuffer support

## Costs & Billing

### Google Cloud Speech-to-Text Pricing
- First 60 minutes/month: FREE
- Standard pricing: ~$0.024 per minute
- Premium pricing: ~$0.048 per minute (for new features)

### Estimated Monthly Costs
- Light usage (2 hours/month): FREE
- Medium usage (20 hours/month): ~$29
- Heavy usage (100 hours/month): ~$144

### Cost Optimization
- Cache results when possible
- Compress audio files
- Use regional endpoints
- Monitor usage dashboard

## Logging & Debugging

### Server Logs
- Check console output for startup messages
- API errors logged with details
- Request/response timing

### Client Logs
- Browser DevTools (F12)
- Console tab for JavaScript errors
- Network tab for API calls

### Debug Mode
Set `DEBUG=true` in .env for verbose logging

---

**Last Updated**: July 2026
**Version**: 1.0.0
