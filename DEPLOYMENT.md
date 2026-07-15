# Deployment Guide

## Local Development

### 1. Development Environment Setup

```bash
# Install dependencies
npm install

# Install development dependencies
npm install --save-dev nodemon

# Create .env file
cp .env.example .env

# Add your Google Cloud credentials to .env
echo "GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json" >> .env
echo "PORT=3000" >> .env
```

### 2. Run Development Server

```bash
# With auto-reload (recommended for development)
npm run dev

# Or manually
npm start
```

Access at: `http://localhost:3000`

### 3. Testing

```bash
# Manual testing
1. Open http://localhost:3000
2. Test microphone recording
3. Test file upload
4. Check DevTools (F12) for errors
```

---

## Deployment to Heroku

### Prerequisites
- Heroku account (heroku.com)
- Heroku CLI installed
- Git repository initialized

### Step 1: Prepare for Deployment

```bash
# Make sure you're in the project directory
cd /Users/indranilsarmacharya/Documents/AI_STT

# Initialize git if not already done
git init
git add .
git commit -m "Initial commit"

# Remove sensitive files from git
echo ".env" >> .gitignore
echo "google-cloud-key.json" >> .gitignore
```

### Step 2: Create Heroku App

```bash
# Login to Heroku
heroku login

# Create a new app
heroku create your-medical-stt-app

# Or add to existing app
heroku git:remote -a your-medical-stt-app
```

### Step 3: Set Environment Variables

```bash
# Set PORT (Heroku assigns dynamically)
heroku config:set PORT=0

# Set Node environment
heroku config:set NODE_ENV=production

# Add Google Cloud credentials
# Option 1: Read from file and set as config var
heroku config:set GOOGLE_ACCOUNT_JSON="$(cat google-cloud-key.json)"

# Option 2: Set GOOGLE_APPLICATION_CREDENTIALS to use a file path
# (This requires uploading the file to Heroku)
```

### Step 4: Create Procfile

Create a `Procfile` in the project root:

```
web: node src/server.js
```

### Step 5: Deploy to Heroku

```bash
# Push to Heroku
git push heroku main

# Or if using master branch
git push heroku master

# Check logs
heroku logs --tail
```

### Step 6: Test Deployment

```bash
# Open the app in browser
heroku open

# Check status
heroku ps

# View logs
heroku logs --tail
```

---

## Deployment to Google Cloud Run

### Prerequisites
- Google Cloud account
- gcloud CLI installed
- Docker (optional, Cloud Run builds automatically)

### Step 1: Install Google Cloud SDK

```bash
# On macOS
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init
```

### Step 2: Create Dockerfile (Optional but Recommended)

Create `Dockerfile` in project root:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY .env* ./

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Start server
CMD ["npm", "start"]
```

### Step 3: Deploy to Cloud Run

```bash
# Login to Google Cloud
gcloud auth login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# Deploy
gcloud run deploy medical-stt \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated

# Set environment variables
gcloud run services update medical-stt \
  --set-env-vars GOOGLE_APPLICATION_CREDENTIALS=/workspace/key.json \
  --region us-central1
```

### Step 4: Add Google Cloud Credentials to Cloud Run

```bash
# Create a secret for the service account key
gcloud secrets create google-cloud-key --data-file=google-cloud-key.json

# Grant Cloud Run service access to the secret
gcloud secrets add-iam-policy-binding google-cloud-key \
  --member=serviceAccount:PROJECT_ID@appspot.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

---

## Deployment to AWS (EC2/Elastic Beanstalk)

### Option 1: EC2 Instance

```bash
# SSH into EC2 instance
ssh -i your-key.pem ec2-user@your-instance-ip

# Update system
sudo yum update -y

# Install Node.js
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Clone your repository
git clone https://github.com/yourusername/medical-stt.git
cd medical-stt

# Install dependencies
npm install

# Copy credentials
cp /path/to/google-cloud-key.json ./

# Create .env
nano .env

# Start with PM2
npm install -g pm2
pm2 start src/server.js --name "medical-stt"
pm2 startup
pm2 save
```

### Option 2: Elastic Beanstalk

```bash
# Install EB CLI
pip install awsebcli

# Initialize EB app
eb init -p node.js-18 medical-stt

# Create environment
eb create production

# Deploy
git push
eb deploy

# Set environment variables
eb setenv GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json
```

---

## Deployment to DigitalOcean (App Platform)

### Prerequisites
- DigitalOcean account
- Repository on GitHub

### Step 1: Create App

1. Go to DigitalOcean Dashboard
2. Click "Create" → "Apps"
3. Connect your GitHub repository
4. Select the repository and branch

### Step 2: Configure App

```yaml
# app.yaml
name: medical-stt
services:
  - name: api
    github:
      repo: yourusername/medical-stt
      branch: main
    build_command: npm install
    run_command: npm start
    http_port: 3000
    envs:
      - key: GOOGLE_APPLICATION_CREDENTIALS
        value: ./google-cloud-key.json
```

### Step 3: Deploy

Click "Deploy" and wait for completion.

---

## Docker Deployment

### Build Docker Image

```bash
# Build image
docker build -t medical-stt:latest .

# Run container
docker run -d \
  -p 3000:3000 \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/google-cloud-key.json \
  -v $(pwd)/google-cloud-key.json:/app/google-cloud-key.json \
  --name medical-stt-container \
  medical-stt:latest

# Check logs
docker logs -f medical-stt-container
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./google-cloud-key.json:/app/google-cloud-key.json
    restart: always
```

Run with:
```bash
docker-compose up -d
```

---

## Production Best Practices

### 1. Security

```bash
# Use HTTPS
# Install SSL certificate (Let's Encrypt recommended)
# Use environment variables for all secrets
# Never commit credentials

# Example with HTTPS (Node.js)
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('path/to/key.pem'),
  cert: fs.readFileSync('path/to/cert.pem')
};

https.createServer(options, app).listen(443);
```

### 2. Process Management (PM2)

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start src/server.js --name "medical-stt"

# Set up auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 monit

# View logs
pm2 logs medical-stt
```

### 3. Reverse Proxy (Nginx)

```nginx
# /etc/nginx/sites-available/medical-stt
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4. Monitoring & Logging

```bash
# Monitor CPU and memory
top -p $(pgrep -f "node src/server.js")

# Use PM2 Plus for advanced monitoring
pm2 plus

# Set up log rotation
npm install -g pm2-logrotate
pm2 install pm2-logrotate
```

### 5. Backup & Recovery

```bash
# Backup important files
tar -czf backup-$(date +%Y%m%d).tar.gz \
  src/ public/ package.json package-lock.json

# Store in cloud storage
aws s3 cp backup-*.tar.gz s3://your-bucket/backups/
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Expected response
# {"status":"ok","message":"Server is running"}
```

### Performance Monitoring

```bash
# Monitor API response times
npm install --save-dev clinic

# Run clinic
clinic doctor -- node src/server.js

# Test under load
npm install -g autocannon
autocannon http://localhost:3000/api/health
```

### Log Management

```bash
# View application logs
tail -f logs/app.log

# Check error logs
grep "Error" logs/app.log

# Archive old logs
gzip logs/app.log.*
```

---

## Scaling Strategies

### Horizontal Scaling (Multiple Instances)

```bash
# Using Load Balancer with Nginx
upstream backend {
  server instance1:3000;
  server instance2:3000;
  server instance3:3000;
}

server {
  listen 80;
  
  location / {
    proxy_pass http://backend;
  }
}
```

### Vertical Scaling (Larger Instance)

```bash
# Increase Node.js heap size
NODE_OPTIONS="--max-old-space-size=4096" npm start

# Use clustering for multi-core
npm install -g cluster-master
```

### Database Integration (Optional)

```bash
# For transcription history storage
npm install mongoose postgresql

# Create MongoDB connection
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
```

---

## Troubleshooting Deployment

### Issue: "Cannot find module"
```bash
# Solution: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Issue: "Port already in use"
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Issue: "Google Cloud Authentication Failed"
```bash
# Check credentials
gcloud auth list

# Re-authenticate
gcloud auth login

# Verify JSON key
cat google-cloud-key.json | jq '.'
```

### Issue: "CORS Errors"
```javascript
// Add CORS middleware
const cors = require('cors');
app.use(cors());
```

---

## Rollback Procedures

### Git Rollback
```bash
# See previous commits
git log --oneline

# Rollback to previous commit
git revert <commit-hash>
git push
```

### Heroku Rollback
```bash
# View releases
heroku releases

# Rollback to previous release
heroku releases:rollback v123
```

### PM2 Rollback
```bash
# Restart with previous version
pm2 delete medical-stt
git checkout previous-version
npm install
pm2 start src/server.js
```

---

**Last Updated**: July 2026
**Version**: 1.0.0
