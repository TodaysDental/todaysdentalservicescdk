# Marketing Module - Complete API Documentation

## Ayrshare Integration - All Endpoints & Features

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture & Infrastructure](#2-architecture--infrastructure)
3. [S3 Bucket Configuration](#3-s3-bucket-configuration)
4. [Database Schema](#4-database-schema)
5. [Core API Endpoints](#5-core-api-endpoints)
6. [Auto Schedule Endpoints](#6-auto-schedule-endpoints)
7. [Analytics Endpoints](#7-analytics-endpoints)
8. [Hashtags Endpoints](#8-hashtags-endpoints)
9. [History Endpoints](#9-history-endpoints)
10. [Media Endpoints](#10-media-endpoints)
11. [Messages Endpoints](#11-messages-endpoints)
12. [Validate Endpoints](#12-validate-endpoints)
13. [Webhooks](#13-webhooks)
14. [Error Handling](#14-error-handling)
15. [Testing Guide](#15-testing-guide)

---

## 1. Overview

### Purpose
Complete marketing automation system for 27 dental clinics with social media posting, analytics, comments, and media management.

### Supported Platforms
- Facebook Pages
- Instagram Business
- LinkedIn Company Pages
- X/Twitter
- YouTube
- TikTok
- Pinterest
- Reddit
- Google Business Profile
- Telegram
- Threads
- Bluesky
- Snapchat

### Key Features
- Multi-clinic posting (all 27 or selective)
- Multi-platform support (13 networks)
- Scheduled & auto-scheduled posts
- Media upload to S3 bucket
- Comment management
- Real-time analytics
- Auto hashtag generation
- Post validation
- Direct messaging
- Webhook notifications

---

## 2. Architecture & Infrastructure

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React TypeScript)               │
│  - Post Creator                                              │
│  - Media Uploader                                            │
│  - Analytics Dashboard                                       │
│  - Comment Manager                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              AWS API Gateway + Lambda Functions              │
│  - JWT Authentication                                        │
│  - Marketing Module Endpoints                                │
│  - Ayrshare API Integration                                  │
└──────────────┬────────────────────┬─────────────────────────┘
               │                    │
               ▼                    ▼
    ┌──────────────────┐    ┌──────────────────┐
    │   DynamoDB       │    │   S3 Bucket      │
    │  - Posts         │    │  - Images        │
    │  - Comments      │    │  - Videos        │
    │  - Analytics     │    │  - Media Files   │
    └──────────────────┘    └──────────────────┘
               │
               ▼
    ┌──────────────────────────────────────┐
    │       Ayrshare API                    │
    │  - Post to 13 platforms               │
    │  - Get analytics                      │
    │  - Manage comments                    │
    └──────────────────────────────────────┘
```

### Base URL
```
https://apig.todaysdentalinsights.com/marketing/
```

---

## 3. S3 Bucket Configuration

### Bucket Name
`todaysdentalinsights-marketing-media`

### Bucket Structure

```
s3://todaysdentalinsights-marketing-media/
├── images/
│   ├── dentistinnewbritain/
│   │   ├── 2025/12/
│   │   │   ├── post_123_image1.jpg
│   │   │   └── post_123_image2.jpg
│   └── dentistingreenville/
│       └── 2025/12/
│           └── post_456_image1.jpg
├── videos/
│   ├── dentistinnewbritain/
│   │   └── 2025/12/
│   │       └── post_789_video1.mp4
├── temp/
│   └── uploads/
│       └── temp_file_abc123.jpg (auto-deleted after 1 day)
└── uploads/
    └── {mediaId}/
        └── filename.jpg
```

### Lifecycle Rules
- **DeleteTempUploads**: Files in `temp/uploads/` are deleted after 1 day
- **TransitionToStandardIA**: Files transition to Standard-IA after 90 days
- **TransitionToGlacier**: Files transition to Glacier after 365 days

---

## 4. Database Schema

### Tables

| Table | Partition Key | Sort Key | Description |
|-------|---------------|----------|-------------|
| MarketingProfiles | clinicId (S) | - | Ayrshare profile mappings |
| MarketingPosts | postId (S) | createdAt (S) | Social media posts |
| MarketingComments | postId (S) | commentId (S) | Comments on posts |
| MarketingMedia | mediaId (S) | - | Uploaded media files |
| MarketingAnalytics | postId (S) | syncedAt (S) | Analytics data |

---

## 5. Core API Endpoints

### 5.1 POST /posts - Create and Publish Post

**Request:**
```http
POST /marketing/posts
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "clinicIds": ["dentistinnewbritain", "dentistingreenville"],
  "postContent": "Check out our special offer this week! 🦷✨",
  "platforms": ["facebook", "instagram", "linkedin"],
  "mediaUrls": ["https://...s3.amazonaws.com/images/promo.jpg"],
  "scheduleDate": "2025-12-15T10:00:00Z",
  "postOptions": {
    "shortenLinks": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "postId": "post_abc123xyz",
  "message": "Post successfully created for 2 clinics",
  "results": [
    {
      "clinicId": "dentistinnewbritain",
      "clinicName": "Dentist in New Britain",
      "success": true,
      "ayrsharePostId": "ayr_xyz789",
      "platformPostIds": {
        "facebook": "123456789_987654321",
        "instagram": "IG_abc123"
      }
    }
  ],
  "failed": [],
  "summary": {
    "totalClinics": 2,
    "successfulClinics": 2,
    "failedClinics": 0
  }
}
```

### 5.2 GET /posts - List Posts

**Request:**
```http
GET /marketing/posts?status=published&clinicId=dentistinnewbritain&limit=20
Authorization: Bearer JWT_TOKEN
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | all/draft/scheduled/published/failed |
| clinicId | string | Filter by clinic |
| limit | number | Results per page (default: 50) |
| nextToken | string | Pagination token |

### 5.3 GET /posts/:postId - Get Post Details

```http
GET /marketing/posts/{postId}
Authorization: Bearer JWT_TOKEN
```

### 5.4 PATCH /posts/:postId - Update Post

```http
PATCH /marketing/posts/{postId}
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "postContent": "Updated content",
  "scheduleDate": "2025-12-16T10:00:00Z"
}
```

### 5.5 DELETE /posts/:postId - Delete Post

```http
DELETE /marketing/posts/{postId}
Authorization: Bearer JWT_TOKEN

{
  "deleteFromPlatforms": true
}
```

### 5.6 GET /posts/:postId/comments - Get Comments for Post

```http
GET /marketing/posts/{postId}/comments
Authorization: Bearer JWT_TOKEN
```

---

## 6. Auto Schedule Endpoints

### 6.1 POST /auto-schedule/set - Create Schedule

```http
POST /marketing/auto-schedule/set
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "clinicId": "dentistinnewbritain",
  "title": "Daily Posts",
  "schedule": ["09:00", "14:00", "18:00"],
  "days": ["Mon", "Wed", "Fri"],
  "timezone": "America/New_York"
}
```

### 6.2 GET /auto-schedule/list - List Schedules

```http
GET /marketing/auto-schedule/list?clinicId=dentistinnewbritain
Authorization: Bearer JWT_TOKEN
```

### 6.3 DELETE /auto-schedule - Delete Schedule

```http
DELETE /marketing/auto-schedule
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "clinicId": "dentistinnewbritain",
  "title": "Daily Posts"
}
```

---

## 7. Analytics Endpoints

### 7.1 GET /analytics/dashboard - Dashboard Analytics

```http
GET /marketing/analytics/dashboard?startDate=2025-01-01&endDate=2025-12-31
Authorization: Bearer JWT_TOKEN
```

### 7.2 GET /analytics/posts/:postId - Post Analytics

```http
GET /marketing/analytics/posts/{postId}
Authorization: Bearer JWT_TOKEN
```

### 7.3 GET /analytics/clinics/:clinicId - Clinic Analytics

```http
GET /marketing/analytics/clinics/{clinicId}?startDate=2025-01-01&endDate=2025-12-31
Authorization: Bearer JWT_TOKEN
```

### 7.4 GET /analytics/social - Social Account Analytics

```http
GET /marketing/analytics/social?clinicId=dentistinnewbritain&platforms=facebook,instagram
Authorization: Bearer JWT_TOKEN
```

### 7.5 GET /analytics/links - Link Analytics

```http
GET /marketing/analytics/links?clinicId=dentistinnewbritain&postId=post_abc123
Authorization: Bearer JWT_TOKEN
```

---

## 8. Hashtags Endpoints

### 8.1 POST /hashtags/auto - Auto Generate Hashtags

```http
POST /marketing/hashtags/auto
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "text": "We're offering a special discount on teeth whitening!",
  "max": 5,
  "position": "end"
}
```

**Response:**
```json
{
  "success": true,
  "originalText": "We're offering a special discount...",
  "modifiedText": "We're offering... #TeethWhitening #DentalCare",
  "hashtags": ["TeethWhitening", "DentalCare", "SmileBright"]
}
```

### 8.2 GET /hashtags/recommend - Get Recommendations

```http
GET /marketing/hashtags/recommend?keyword=dental&limit=10
Authorization: Bearer JWT_TOKEN
```

### 8.3 GET /hashtags/search - Search Hashtags

```http
GET /marketing/hashtags/search?query=dental&platform=instagram
Authorization: Bearer JWT_TOKEN
```

### 8.4 GET /hashtags/check-banned - Check Banned Hashtags

```http
GET /marketing/hashtags/check-banned?hashtags=dental,dentist,smile
Authorization: Bearer JWT_TOKEN
```

---

## 9. History Endpoints

### 9.1 GET /history - Get Post History

```http
GET /marketing/history?clinicId=dentistinnewbritain&platform=facebook&lastDays=30
Authorization: Bearer JWT_TOKEN
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Required - Clinic ID |
| platform | string | Filter by platform |
| lastRecords | number | Number of records (default: 25) |
| lastDays | number | Posts from last N days |

---

## 10. Media Endpoints

### 10.1 POST /media/upload - Upload Media

```http
POST /marketing/media/upload
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "fileName": "promo.jpg",
  "mimeType": "image/jpeg",
  "fileType": "image",
  "clinicIds": ["dentistinnewbritain"]
}
```

**Response:**
```json
{
  "success": true,
  "media": {
    "mediaId": "media_abc123",
    "fileName": "promo.jpg",
    "publicUrl": "https://...s3.amazonaws.com/uploads/...",
    "uploadUrl": "https://...s3.amazonaws.com/...?X-Amz-Algorithm=..."
  }
}
```

### 10.2 GET /media/upload-url - Get Pre-Signed URL

```http
GET /marketing/media/upload-url?fileName=promo.jpg&fileType=image/jpeg&clinicId=dentistinnewbritain
Authorization: Bearer JWT_TOKEN
```

### 10.3 GET /media - List Media Library

```http
GET /marketing/media?fileType=image&limit=20
Authorization: Bearer JWT_TOKEN
```

### 10.4 DELETE /media/:mediaId - Delete Media

```http
DELETE /marketing/media/{mediaId}
Authorization: Bearer JWT_TOKEN
```

### 10.5 POST /media/resize - Resize Image

```http
POST /marketing/media/resize
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "imageUrl": "https://...s3.amazonaws.com/images/promo.jpg",
  "width": 1080,
  "height": 1080
}
```

### 10.6 POST /media/verify-url - Verify Media URL

```http
POST /marketing/media/verify-url
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "url": "https://example.com/image.jpg"
}
```

---

## 11. Messages Endpoints

### 11.1 GET /messages - Get Messages

```http
GET /marketing/messages?clinicId=dentistinnewbritain&platform=instagram&limit=20
Authorization: Bearer JWT_TOKEN
```

### 11.2 POST /messages/send - Send Direct Message

```http
POST /marketing/messages/send
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "clinicId": "dentistinnewbritain",
  "platform": "instagram",
  "recipientId": "john_doe",
  "message": "Thank you for your interest!"
}
```

---

## 12. Validate Endpoints

### 12.1 POST /validate/post - Validate Post Content

```http
POST /marketing/validate/post
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "content": "Check out our special offer!",
  "platforms": ["facebook", "twitter", "instagram"],
  "mediaUrls": ["https://...s3.amazonaws.com/image.jpg"]
}
```

**Response:**
```json
{
  "success": true,
  "valid": true,
  "content": {
    "length": 28,
    "hasMedia": true
  },
  "platformResults": {
    "facebook": { "valid": true, "characterCount": 28, "characterLimit": 63206 },
    "twitter": { "valid": true, "characterCount": 28, "characterLimit": 280 },
    "instagram": { "valid": true, "characterCount": 28, "characterLimit": 2200 }
  }
}
```

### 12.2 POST /validate/media - Validate Media Files

```http
POST /marketing/validate/media
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "mediaUrls": ["https://...s3.amazonaws.com/video.mp4"],
  "platforms": ["instagram", "tiktok"]
}
```

### 12.3 POST /validate/content-moderation - Content Moderation

```http
POST /marketing/validate/content-moderation
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "content": "Check out this amazing offer!"
}
```

---

## 13. Webhooks

### 13.1 GET /webhooks - Get Registered Webhooks

```http
GET /marketing/webhooks
Authorization: Bearer JWT_TOKEN
```

### 13.2 POST /webhooks - Register Webhook

```http
POST /marketing/webhooks
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "action": "social",
  "url": "https://api.todaysdentalinsights.com/marketing/webhooks/ayrshare"
}
```

### 13.3 DELETE /webhooks - Unregister Webhook

```http
DELETE /marketing/webhooks
Authorization: Bearer JWT_TOKEN
Content-Type: application/json

{
  "action": "social"
}
```

### 13.4 POST /webhooks/ayrshare - Webhook Handler

*No authentication required - HMAC signature verified*

```http
POST /marketing/webhooks/ayrshare
Content-Type: application/json

{
  "event": "post.published",
  "data": { ... }
}
```

---

## 14. Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| INVALID_REQUEST | 400 | Missing or invalid parameters |
| UNAUTHORIZED | 401 | Invalid or missing JWT token |
| FORBIDDEN | 403 | User lacks permission |
| NOT_FOUND | 404 | Resource not found |
| CLINIC_NOT_FOUND | 404 | Clinic ID doesn't exist |
| POST_NOT_FOUND | 404 | Post ID doesn't exist |
| AYRSHARE_ERROR | 500 | Error from Ayrshare API |
| S3_UPLOAD_FAILED | 500 | S3 upload failed |
| INTERNAL_ERROR | 500 | Server error |

---

## 15. Testing Guide

### Complete Test Flow

**Step 1: Upload Media**
```bash
# Get upload URL
curl -X GET "https://apig.todaysdentalinsights.com/marketing/media/upload-url?fileName=promo.jpg&fileType=image/jpeg&clinicId=dentistinnewbritain" \
  -H "Authorization: Bearer JWT_TOKEN"

# Upload file to S3 using returned uploadUrl
curl -X PUT "UPLOAD_URL" \
  -H "Content-Type: image/jpeg" \
  --data-binary @promo.jpg
```

**Step 2: Validate Post**
```bash
curl -X POST https://apig.todaysdentalinsights.com/marketing/validate/post \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Check out our special offer!",
    "platforms": ["facebook", "instagram"],
    "mediaUrls": ["FILE_URL_FROM_STEP_1"]
  }'
```

**Step 3: Create Post**
```bash
curl -X POST https://apig.todaysdentalinsights.com/marketing/posts \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "postContent": "Check out our special offer!",
    "mediaUrls": ["FILE_URL_FROM_STEP_1"],
    "platforms": ["facebook", "instagram"],
    "clinicIds": ["dentistinnewbritain"]
  }'
```

**Step 4: Get Analytics**
```bash
curl -X GET "https://apig.todaysdentalinsights.com/marketing/analytics/posts/POST_ID" \
  -H "Authorization: Bearer JWT_TOKEN"
```

---

## Postman Collection Structure

```
Marketing Module
├── 1. Media Management
│   ├── Get Upload URL
│   ├── Upload Media
│   ├── List Media
│   ├── Resize Image
│   ├── Verify Media URL
│   └── Delete Media
├── 2. Posts
│   ├── Create Post
│   ├── Create Bulk Posts
│   ├── Get Posts
│   ├── Get Post Details
│   ├── Get Post Comments
│   ├── Update Post
│   └── Delete Post
├── 3. Auto Schedule
│   ├── Set Schedule
│   ├── List Schedules
│   └── Delete Schedule
├── 4. Analytics
│   ├── Get Dashboard
│   ├── Get Post Analytics
│   ├── Get Clinic Analytics
│   ├── Get Social Analytics
│   └── Get Link Analytics
├── 5. Comments
│   ├── Get Comments
│   ├── Reply to Comment
│   ├── Bulk Mark Read
│   └── Mark Comment Read
├── 6. Hashtags
│   ├── Auto Generate
│   ├── Recommend
│   ├── Search
│   └── Check Banned
├── 7. History
│   └── Get Post History
├── 8. Messages
│   ├── Get Messages
│   └── Send Message
├── 9. Validate
│   ├── Validate Post
│   ├── Validate Media
│   └── Content Moderation
└── 10. Webhooks
    ├── Get Webhooks
    ├── Register Webhook
    └── Unregister Webhook
```

---

## Clinic Configuration

All 27 clinics have been configured with Ayrshare integration in `clinics.json`:

```json
{
  "clinicId": "dentistinnewbritain",
  "ayrshare": {
    "profileKey": "BE260A0D-89684181-8BBD2B90-792038F2",
    "refId": "96e3954b0e507953e8671586286b4969d69b1385",
    "enabled": true,
    "connectedPlatforms": ["facebook"],
    "facebook": {
      "connected": true,
      "pageId": "749712698232047",
      "pageName": "Dentist in New Britain"
    }
  }
}
```

---

**Document Version:** 2.0  
**Last Updated:** December 14, 2025  
**Endpoints Documented:** 40+
