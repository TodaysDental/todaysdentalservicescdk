# Marketing Stack API Documentation

## Overview

The Marketing Stack provides comprehensive social media management capabilities for dental clinics, powered by Ayrshare integration. It enables multi-clinic social media posting, comment management, analytics tracking, and media asset management across platforms including Facebook, Instagram, Twitter, and LinkedIn.

**Base URL:** `https://apig.todaysdentalinsights.com/marketing`

**Alternative URL:** `https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod`

All endpoints (except webhooks) require JWT authentication via the Authorization header.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Profile Management](#2-profile-management)
3. [Post Management](#3-post-management)
4. [Comment Management](#4-comment-management)
5. [Analytics](#5-analytics)
6. [Media Management](#6-media-management)
7. [Webhooks](#7-webhooks)
8. [Error Responses](#8-error-responses)
9. [Data Models](#9-data-models)
10. [Infrastructure Components](#10-infrastructure-components)

---

## 1. Authentication

All Marketing Stack endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <accessToken>
```

The custom Lambda authorizer validates tokens and caches permissions for efficient access control.

---

## 2. Profile Management

Profile management endpoints handle Ayrshare profile creation and social account linking for each clinic.

### 2.1 Initialize Profiles

Creates Ayrshare profiles for multiple clinics at once.

**Endpoint:** `POST /profiles/initialize`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "clinics": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "clinicEmail": "info@brightsmile.com",
      "address": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "phone": "(512) 555-1234",
      "website": "https://brightsmile.com",
      "logoUrl": "https://cdn.example.com/logo.png"
    }
  ]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| clinics | array | Yes | Array of clinic objects to initialize |
| clinics[].clinicId | string | Yes | Unique clinic identifier |
| clinics[].clinicName | string | Yes | Display name for the clinic |
| clinics[].clinicEmail | string | No | Contact email for the clinic |
| clinics[].address | string | No | Street address |
| clinics[].city | string | No | City name |
| clinics[].state | string | No | State code (e.g., "TX") |
| clinics[].phone | string | No | Contact phone number |
| clinics[].website | string | No | Clinic website URL |
| clinics[].logoUrl | string | No | URL to clinic logo image |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Created 5 Ayrshare profiles",
  "profiles": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "ayrshareProfileKey": "ayr-profile-abc123",
      "ayrshareRefId": "ref-xyz789",
      "status": "active",
      "jwtUrl": "https://app.ayrshare.com/social/link?jwt=..."
    }
  ],
  "failed": [
    {
      "clinicId": "clinic-456",
      "error": "Invalid clinic data"
    }
  ]
}
```

---

### 2.2 Get All Profiles

Retrieves all clinic profiles with optional filtering.

**Endpoint:** `GET /profiles`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | Filter by profile status (`active`, `pending`) |
| platform | string | No | Filter by connected platform (`facebook`, `instagram`, `twitter`, `linkedin`) |

**Success Response (200):**
```json
{
  "success": true,
  "profiles": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "ayrshareRefId": "ref-xyz789",
      "status": "active",
      "connectedPlatforms": ["facebook", "instagram"],
      "clinicMetadata": {
        "address": "123 Main St",
        "city": "Austin",
        "state": "TX",
        "phone": "(512) 555-1234",
        "email": "info@brightsmile.com",
        "website": "https://brightsmile.com",
        "logoUrl": "https://cdn.example.com/logo.png"
      },
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-20T14:45:00.000Z"
    }
  ],
  "totalProfiles": 27,
  "activeProfiles": 25,
  "pendingProfiles": 2
}
```

---

### 2.3 Get Single Profile

Retrieves detailed information for a specific clinic profile.

**Endpoint:** `GET /profiles/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Unique clinic identifier |

**Success Response (200):**
```json
{
  "success": true,
  "profile": {
    "clinicId": "clinic-123",
    "clinicName": "Bright Smile Dental",
    "ayrshareRefId": "ref-xyz789",
    "status": "active",
    "connectedPlatforms": ["facebook", "instagram", "twitter"],
    "platformDetails": [
      {
        "platform": "facebook",
        "pageName": "Bright Smile Dental",
        "pageId": "fb-12345"
      },
      {
        "platform": "instagram",
        "username": "@brightsmile_dental"
      }
    ],
    "clinicMetadata": {
      "address": "123 Main St",
      "city": "Austin",
      "state": "TX"
    },
    "recentActivity": {
      "lastPostAt": "2024-01-20T09:00:00.000Z",
      "totalPosts": 45
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-20T14:45:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Profile not found"
}
```

---

### 2.4 Generate Social Linking JWT

Generates a JWT URL for connecting social media accounts to a clinic profile.

**Endpoint:** `POST /profiles/{clinicId}/generate-jwt`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Unique clinic identifier |

**Request Body:**
```json
{
  "expiresIn": 300
}
```

**Request Fields:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| expiresIn | number | No | 300 | JWT expiration time in seconds |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "clinicName": "Bright Smile Dental",
  "jwtUrl": "https://app.ayrshare.com/social/link?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2024-01-20T15:05:00.000Z",
  "instructions": "Open this URL in a new window to connect social media accounts. The link expires in 5 minutes."
}
```

---

### 2.5 Unlink Social Platform

Disconnects a social media platform from a clinic profile.

**Endpoint:** `DELETE /profiles/{clinicId}/social/{platform}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Unique clinic identifier |
| platform | string | Platform to unlink (`facebook`, `instagram`, `twitter`, `linkedin`) |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Successfully unlinked facebook from Bright Smile Dental",
  "clinicId": "clinic-123",
  "platform": "facebook",
  "remainingPlatforms": ["instagram", "twitter"]
}
```

---

## 3. Post Management

Post management endpoints handle creating, scheduling, updating, and deleting social media posts.

### 3.1 Create Post

Creates a post across one or multiple clinics and platforms.

**Endpoint:** `POST /posts`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "clinicIds": ["clinic-123", "clinic-456"],
  "postContent": "🦷 Did you know that regular dental checkups can prevent 90% of dental problems? Book your appointment today! #DentalHealth #HealthySmile",
  "platforms": ["facebook", "instagram", "twitter"],
  "mediaUrls": [
    "https://cdn.example.com/dental-tips.jpg"
  ],
  "scheduleDate": "2024-01-25T10:00:00.000Z",
  "postOptions": {
    "shortenLinks": true
  }
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| clinicIds | string[] | Yes | Array of clinic IDs to post for. Use `["*"]` for all clinics |
| postContent | string | Yes | The post text content |
| platforms | string[] | Yes | Target platforms (`facebook`, `instagram`, `twitter`, `linkedin`) |
| mediaUrls | string[] | No | Array of media URLs to include |
| scheduleDate | string | No | ISO 8601 date for scheduled posts. If omitted, publishes immediately |
| postOptions | object | No | Additional post options |
| postOptions.shortenLinks | boolean | No | Whether to shorten links (default: true) |

**Success Response (200):**
```json
{
  "success": true,
  "postId": "post-uuid-12345",
  "message": "Post successfully created for 2 clinics",
  "results": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "success": true,
      "ayrsharePostId": "ayr-post-abc",
      "platformPostIds": {
        "facebook": "fb-post-123",
        "instagram": "ig-post-456",
        "twitter": "tw-post-789"
      },
      "scheduledFor": "2024-01-25T10:00:00.000Z"
    }
  ],
  "failed": [],
  "summary": {
    "totalClinics": 2,
    "successfulClinics": 2,
    "failedClinics": 0,
    "totalPlatforms": 6,
    "successfulPlatforms": 6
  }
}
```

---

### 3.2 Bulk Create Posts

Creates multiple posts at once with different content and schedules.

**Endpoint:** `POST /posts/bulk`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "posts": [
    {
      "clinicIds": ["*"],
      "postContent": "Monday motivation: Your smile is your best accessory! 😁",
      "platforms": ["facebook", "instagram"],
      "mediaUrls": [],
      "scheduleDate": "2024-01-22T09:00:00.000Z"
    },
    {
      "clinicIds": ["clinic-123"],
      "postContent": "New patient special: 50% off first cleaning!",
      "platforms": ["facebook", "twitter"],
      "mediaUrls": ["https://cdn.example.com/promo.jpg"],
      "scheduleDate": "2024-01-23T10:00:00.000Z"
    }
  ]
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Created 2 posts successfully",
  "posts": [
    {
      "postId": "post-uuid-001",
      "status": "scheduled",
      "clinicsAffected": 27,
      "scheduleDate": "2024-01-22T09:00:00.000Z"
    },
    {
      "postId": "post-uuid-002",
      "status": "scheduled",
      "clinicsAffected": 1,
      "scheduleDate": "2024-01-23T10:00:00.000Z"
    }
  ],
  "summary": {
    "totalPosts": 2,
    "successfulPosts": 2,
    "failedPosts": 0
  }
}
```

---

### 3.3 Get All Posts

Retrieves posts with optional filtering and pagination.

**Endpoint:** `GET /posts`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | No | Filter by clinic ID |
| status | string | No | Filter by status (`scheduled`, `published`, `failed`) |
| limit | number | No | Number of posts to return (default: 50) |
| nextToken | string | No | Pagination token from previous response |

**Success Response (200):**
```json
{
  "success": true,
  "posts": [
    {
      "postId": "post-uuid-12345",
      "postContent": "🦷 Did you know that regular dental checkups...",
      "clinicIds": ["clinic-123", "clinic-456"],
      "platforms": ["facebook", "instagram", "twitter"],
      "mediaUrls": ["https://cdn.example.com/dental-tips.jpg"],
      "status": "published",
      "scheduleDate": null,
      "publishedAt": "2024-01-20T10:00:00.000Z",
      "createdBy": "admin@example.com",
      "createdAt": "2024-01-20T09:30:00.000Z",
      "analytics": {
        "totalLikes": 150,
        "totalComments": 25,
        "totalShares": 10,
        "totalViews": 5000,
        "lastSyncedAt": "2024-01-20T15:00:00.000Z"
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextToken": "eyJwb3N0SWQiOiJwb3N0LXV1aWQtMTIzNDUi..."
  }
}
```

---

### 3.4 Get Single Post

Retrieves detailed information for a specific post.

**Endpoint:** `GET /posts/{postId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| postId | string | Unique post identifier |

**Success Response (200):**
```json
{
  "success": true,
  "post": {
    "postId": "post-uuid-12345",
    "postContent": "🦷 Did you know that regular dental checkups...",
    "clinicIds": ["clinic-123", "clinic-456"],
    "platforms": ["facebook", "instagram", "twitter"],
    "mediaUrls": ["https://cdn.example.com/dental-tips.jpg"],
    "status": "published",
    "scheduleDate": null,
    "publishedAt": "2024-01-20T10:00:00.000Z",
    "ayrsharePostIds": {
      "clinic-123": "ayr-post-abc",
      "clinic-456": "ayr-post-def"
    },
    "platformPostIds": {
      "clinic-123": {
        "facebook": "fb-post-123",
        "instagram": "ig-post-456"
      }
    },
    "createdBy": "admin@example.com",
    "createdAt": "2024-01-20T09:30:00.000Z",
    "analytics": {
      "totalLikes": 150,
      "totalComments": 25,
      "totalShares": 10,
      "totalViews": 5000,
      "lastSyncedAt": "2024-01-20T15:00:00.000Z"
    }
  }
}
```

---

### 3.5 Update Post

Updates a scheduled post (cannot update published posts).

**Endpoint:** `PATCH /posts/{postId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| postId | string | Unique post identifier |

**Request Body:**
```json
{
  "postContent": "Updated post content here...",
  "scheduleDate": "2024-01-26T11:00:00.000Z",
  "platforms": ["facebook", "instagram"]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| postContent | string | No | Updated post text |
| scheduleDate | string | No | New schedule date (ISO 8601) |
| platforms | string[] | No | Updated target platforms |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Post updated successfully",
  "postId": "post-uuid-12345",
  "updatedFields": ["postContent", "scheduleDate"]
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Cannot update published posts"
}
```

---

### 3.6 Delete Post

Deletes a post from the system and optionally from social platforms.

**Endpoint:** `DELETE /posts/{postId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| postId | string | Unique post identifier |

**Request Body:**
```json
{
  "deleteFromPlatforms": true
}
```

**Request Fields:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| deleteFromPlatforms | boolean | No | false | Also delete from social media platforms |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Post deleted successfully",
  "postId": "post-uuid-12345",
  "deletedFromPlatforms": ["clinic-123", "clinic-456"],
  "failedPlatforms": []
}
```

---

## 4. Comment Management

Comment management endpoints handle viewing and responding to social media comments.

### 4.1 Get Comments

Retrieves comments with optional filtering and pagination.

**Endpoint:** `GET /comments`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | No | Filter by clinic ID |
| postId | string | No | Filter by post ID |
| platform | string | No | Filter by platform (`facebook`, `instagram`, `twitter`) |
| isRead | string | No | Filter by read status (`true`, `false`) |
| hasReply | string | No | Filter by reply status (`true`, `false`) |
| sentiment | string | No | Filter by sentiment (`positive`, `neutral`, `negative`) |
| limit | number | No | Number of comments to return (default: 50) |
| nextToken | string | No | Pagination token |

**Success Response (200):**
```json
{
  "success": true,
  "comments": [
    {
      "commentId": "comment-uuid-123",
      "postId": "post-uuid-12345",
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "platform": "facebook",
      "commentText": "Great post! Just booked my appointment.",
      "authorId": "fb-user-789",
      "authorName": "Jane Smith",
      "authorProfileUrl": "https://facebook.com/jane.smith",
      "createdAt": "2024-01-20T11:30:00.000Z",
      "hasReply": true,
      "replyText": "Thank you, Jane! We look forward to seeing you!",
      "replyBy": "admin@example.com",
      "replyAt": "2024-01-20T12:00:00.000Z",
      "isRead": true,
      "readBy": "admin@example.com",
      "readAt": "2024-01-20T11:45:00.000Z",
      "sentiment": "positive"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false
  },
  "summary": {
    "totalComments": 25,
    "unreadComments": 5,
    "unrepliedComments": 8
  }
}
```

---

### 4.2 Reply to Comment

Posts a reply to a social media comment.

**Endpoint:** `POST /comments/{commentId}/reply`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| commentId | string | Unique comment identifier |

**Request Body:**
```json
{
  "replyText": "Thank you for your kind words! We're glad you enjoyed our content."
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| replyText | string | Yes | Text of the reply |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Reply posted successfully",
  "commentId": "comment-uuid-123",
  "replyId": "ayr-reply-456",
  "platform": "facebook",
  "replyText": "Thank you for your kind words! We're glad you enjoyed our content.",
  "repliedBy": "admin@example.com",
  "repliedAt": "2024-01-20T12:00:00.000Z"
}
```

---

### 4.3 Mark Comment as Read

Marks a single comment as read.

**Endpoint:** `PATCH /comments/{commentId}/read`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| commentId | string | Unique comment identifier |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Comment marked as read",
  "commentId": "comment-uuid-123",
  "readBy": "admin@example.com",
  "readAt": "2024-01-20T11:45:00.000Z"
}
```

---

### 4.4 Bulk Mark Comments as Read

Marks multiple comments as read at once.

**Endpoint:** `POST /comments/bulk-read`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "commentIds": [
    "comment-uuid-123",
    "comment-uuid-456",
    "comment-uuid-789"
  ]
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Marked 3 comments as read",
  "commentIds": [
    "comment-uuid-123",
    "comment-uuid-456",
    "comment-uuid-789"
  ],
  "readBy": "admin@example.com",
  "readAt": "2024-01-20T11:45:00.000Z"
}
```

---

## 5. Analytics

Analytics endpoints provide insights into social media performance.

### 5.1 Get Dashboard Analytics

Retrieves aggregated analytics for all clinics in a date range.

**Endpoint:** `GET /analytics/dashboard`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| startDate | string | Yes | Start date (ISO 8601) |
| endDate | string | Yes | End date (ISO 8601) |

**Success Response (200):**
```json
{
  "success": true,
  "dateRange": {
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T23:59:59.000Z"
  },
  "overview": {
    "totalClinics": 27,
    "activeClinics": 25,
    "totalPosts": 150,
    "totalLikes": 4500,
    "totalComments": 800,
    "totalShares": 250,
    "totalReach": 125000,
    "totalImpressions": 200000,
    "avgEngagementRate": "5.2"
  },
  "topPerformingClinics": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "totalEngagement": 450,
      "engagementRate": "8.5",
      "totalPosts": 12
    },
    {
      "clinicId": "clinic-456",
      "clinicName": "Family Dental Care",
      "totalEngagement": 380,
      "engagementRate": "7.2",
      "totalPosts": 10
    }
  ],
  "platformPerformance": {
    "facebook": {
      "totalEngagement": 1800,
      "avgEngagementRate": 5.8,
      "reach": 62500
    },
    "instagram": {
      "totalEngagement": 1350,
      "avgEngagementRate": 5.1,
      "reach": 37500
    },
    "twitter": {
      "totalEngagement": 900,
      "avgEngagementRate": 6.9,
      "reach": 18750
    },
    "linkedin": {
      "totalEngagement": 450,
      "avgEngagementRate": 4.2,
      "reach": 6250
    }
  }
}
```

---

### 5.2 Get Post Analytics

Retrieves detailed analytics for a specific post.

**Endpoint:** `GET /analytics/posts/{postId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| postId | string | Unique post identifier |

**Success Response (200):**
```json
{
  "success": true,
  "postId": "post-uuid-12345",
  "clinics": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Bright Smile Dental",
      "byPlatform": {
        "facebook": {
          "likes": 85,
          "comments": 12,
          "shares": 5,
          "reach": 2500
        },
        "instagram": {
          "likes": 120,
          "comments": 8,
          "saves": 15,
          "reach": 1800
        }
      },
      "total": {
        "totalLikes": 205,
        "totalComments": 20,
        "totalShares": 20,
        "totalViews": 4300
      }
    }
  ],
  "aggregated": {
    "totalLikes": 150,
    "totalComments": 25,
    "totalShares": 10,
    "totalReach": 5000,
    "totalImpressions": 8000,
    "avgEngagement": 3.7
  },
  "history": [
    {
      "syncedAt": "2024-01-20T15:00:00.000Z",
      "likes": 150,
      "comments": 25
    }
  ],
  "lastSyncedAt": "2024-01-20T15:00:00.000Z"
}
```

---

### 5.3 Get Clinic Analytics

Retrieves analytics for a specific clinic.

**Endpoint:** `GET /analytics/clinics/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Unique clinic identifier |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| startDate | string | Yes | Start date (ISO 8601) |
| endDate | string | Yes | End date (ISO 8601) |
| platform | string | No | Filter by specific platform |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "clinicName": "Bright Smile Dental",
  "dateRange": {
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T23:59:59.000Z"
  },
  "summary": {
    "totalPosts": 12,
    "totalLikes": 450,
    "totalComments": 85,
    "totalShares": 30,
    "totalReach": 12500,
    "totalImpressions": 18000,
    "avgEngagementRate": "8.5"
  },
  "byPlatform": {
    "facebook": {
      "posts": 12,
      "likes": 180,
      "comments": 34,
      "shares": 15,
      "reach": 6250,
      "avgEngagement": 5.5
    },
    "instagram": {
      "posts": 12,
      "likes": 158,
      "comments": 30,
      "saves": 6,
      "reach": 3750,
      "avgEngagement": 4.7
    },
    "twitter": {
      "posts": 12,
      "likes": 68,
      "retweets": 6,
      "replies": 13,
      "impressions": 1800,
      "avgEngagement": 6.5
    },
    "linkedin": {
      "posts": 12,
      "likes": 45,
      "comments": 9,
      "shares": 3,
      "impressions": 1800,
      "avgEngagement": 4.2
    }
  },
  "trends": {
    "bestPerformingPlatform": "twitter",
    "bestPerformingDay": "Monday",
    "bestPerformingTime": "10:00 AM",
    "growthRate": 12.5
  }
}
```

---

## 6. Media Management

Media management endpoints handle uploading and organizing media assets.

### 6.1 Upload Media

Initializes a media upload and returns a presigned URL for direct S3 upload.

**Endpoint:** `POST /media/upload`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "fileName": "dental-promo.jpg",
  "fileType": "image",
  "mimeType": "image/jpeg",
  "fileSize": 2048576,
  "tags": ["promo", "whitening", "summer-2024"],
  "clinicIds": ["clinic-123", "clinic-456"]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| fileName | string | Yes | Original file name |
| mimeType | string | Yes | MIME type (e.g., `image/jpeg`, `video/mp4`) |
| fileType | string | No | File type (`image`, `video`). Auto-detected if omitted |
| fileSize | number | No | File size in bytes |
| tags | string[] | No | Array of tags for organization |
| clinicIds | string[] | No | Clinics this media is associated with |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Media upload initialized",
  "media": {
    "mediaId": "media-uuid-12345",
    "fileName": "dental-promo.jpg",
    "fileType": "image",
    "mimeType": "image/jpeg",
    "publicUrl": "https://todaysdentalinsights-marketing-media.s3.amazonaws.com/uploads/media-uuid-12345/dental-promo.jpg",
    "uploadUrl": "https://todaysdentalinsights-marketing-media.s3.amazonaws.com/uploads/media-uuid-12345/dental-promo.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
    "uploadedBy": "admin@example.com",
    "uploadedAt": "2024-01-20T14:30:00.000Z",
    "tags": ["promo", "whitening", "summer-2024"],
    "clinicIds": ["clinic-123", "clinic-456"]
  }
}
```

**Usage Note:** After receiving the response, upload the file directly to the `uploadUrl` using a PUT request with the file content.

---

### 6.2 Get Media Library

Retrieves the media library with optional filtering.

**Endpoint:** `GET /media`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| fileType | string | No | Filter by file type (`image`, `video`) |
| tags | string | No | Comma-separated list of tags to filter by |
| clinicId | string | No | Filter by associated clinic |
| limit | number | No | Number of items to return (default: 50) |
| nextToken | string | No | Pagination token |

**Success Response (200):**
```json
{
  "success": true,
  "media": [
    {
      "mediaId": "media-uuid-12345",
      "fileName": "dental-promo.jpg",
      "fileType": "image",
      "publicUrl": "https://todaysdentalinsights-marketing-media.s3.amazonaws.com/uploads/media-uuid-12345/dental-promo.jpg",
      "thumbnailUrl": "https://todaysdentalinsights-marketing-media.s3.amazonaws.com/uploads/media-uuid-12345/dental-promo.jpg",
      "dimensions": {
        "width": 1920,
        "height": 1080
      },
      "fileSize": 2048576,
      "uploadedBy": "admin@example.com",
      "uploadedAt": "2024-01-20T14:30:00.000Z",
      "tags": ["promo", "whitening"],
      "usedInPosts": 5
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false
  },
  "summary": {
    "totalMedia": 125,
    "totalImages": 100,
    "totalVideos": 25
  }
}
```

---

### 6.3 Delete Media

Deletes a media asset from S3 and the database.

**Endpoint:** `DELETE /media/{mediaId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| mediaId | string | Unique media identifier |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Media deleted successfully",
  "mediaId": "media-uuid-12345"
}
```

---

## 7. Webhooks

Webhook endpoints handle external integrations and Ayrshare callbacks.

### 7.1 Register Webhook

Registers a new webhook for receiving events.

**Endpoint:** `POST /webhooks`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "url": "https://your-server.com/webhook/marketing",
  "events": ["post.published", "post.failed", "comment.new", "analytics.updated"]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | Webhook endpoint URL |
| events | string[] | Yes | Events to subscribe to |

**Available Events:**
| Event | Description |
|-------|-------------|
| `post.published` | Post successfully published |
| `post.failed` | Post failed to publish |
| `comment.new` | New comment received |
| `analytics.updated` | Analytics data updated |
| `profile.connected` | Social account connected |
| `profile.disconnected` | Social account disconnected |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Webhook registered successfully",
  "webhookId": "webhook-uuid-12345",
  "url": "https://your-server.com/webhook/marketing",
  "events": ["post.published", "post.failed", "comment.new", "analytics.updated"]
}
```

---

### 7.2 Ayrshare Webhook Handler

Receives webhook events from Ayrshare. **No authentication required** (external webhook).

**Endpoint:** `POST /webhooks/ayrshare`

**Webhook Payload Examples:**

**New Comment:**
```json
{
  "action": "comment",
  "type": "new",
  "profileKey": "ayr-profile-abc123",
  "postId": "ayr-post-xyz",
  "platform": "facebook",
  "comment": {
    "id": "fb-comment-123",
    "text": "Great post!",
    "author": {
      "id": "fb-user-456",
      "name": "Jane Smith",
      "profileUrl": "https://facebook.com/jane.smith"
    },
    "created": "2024-01-20T11:30:00.000Z"
  }
}
```

**Post Success:**
```json
{
  "action": "post",
  "type": "success",
  "profileKey": "ayr-profile-abc123",
  "post": {
    "id": "ayr-post-xyz",
    "platforms": ["facebook", "instagram"],
    "publishedAt": "2024-01-20T10:00:00.000Z"
  }
}
```

**Profile Connected:**
```json
{
  "action": "profile",
  "type": "connected",
  "profileKey": "ayr-profile-abc123",
  "platform": "instagram"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Webhook processed"
}
```

---

## 8. Error Responses

All endpoints return consistent error responses.

### Standard Error Format

```json
{
  "success": false,
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

### Common Error Messages

| Error | Description |
|-------|-------------|
| `clinicId required` | Missing required clinicId parameter |
| `Profile not found` | Clinic profile doesn't exist |
| `Post not found` | Post doesn't exist |
| `Comment not found` | Comment doesn't exist |
| `Cannot update published posts` | Attempted to modify a published post |
| `clinics array required` | Missing required clinics array in request |
| `startDate and endDate required` | Missing date range for analytics |

---

## 9. Data Models

### Profile

| Field | Type | Description |
|-------|------|-------------|
| clinicId | string | Unique clinic identifier |
| clinicName | string | Display name |
| ayrshareProfileKey | string | Ayrshare profile key |
| ayrshareRefId | string | Ayrshare reference ID |
| profileStatus | string | Status (`active`, `pending`) |
| connectedPlatforms | string[] | Connected social platforms |
| clinicMetadata | object | Clinic contact information |
| createdAt | string | ISO 8601 creation timestamp |
| updatedAt | string | ISO 8601 last update timestamp |
| createdBy | string | Email of creator |

### Post

| Field | Type | Description |
|-------|------|-------------|
| postId | string | Unique post identifier |
| clinicIds | string[] | Clinics this post belongs to |
| postContent | string | Post text content |
| mediaUrls | string[] | Attached media URLs |
| platforms | string[] | Target platforms |
| status | string | Status (`scheduled`, `published`, `failed`) |
| scheduleDate | string | Scheduled publish date (ISO 8601) |
| publishedAt | string | Actual publish date (ISO 8601) |
| ayrsharePostIds | object | Map of clinicId to Ayrshare post ID |
| platformPostIds | object | Map of clinicId to platform post IDs |
| analytics | object | Engagement metrics |
| createdBy | string | Email of creator |
| createdAt | string | ISO 8601 creation timestamp |

### Comment

| Field | Type | Description |
|-------|------|-------------|
| commentId | string | Unique comment identifier |
| postId | string | Parent post ID |
| clinicId | string | Associated clinic |
| platform | string | Source platform |
| commentText | string | Comment content |
| authorId | string | Author's platform ID |
| authorName | string | Author's display name |
| authorProfileUrl | string | Author's profile URL |
| hasReply | boolean | Whether replied to |
| replyText | string | Reply content |
| replyBy | string | Email of responder |
| replyAt | string | Reply timestamp |
| isRead | boolean | Whether read |
| readBy | string | Email of reader |
| readAt | string | Read timestamp |
| sentiment | string | Sentiment analysis (`positive`, `neutral`, `negative`) |
| createdAt | string | Comment creation timestamp |

### Media

| Field | Type | Description |
|-------|------|-------------|
| mediaId | string | Unique media identifier |
| fileName | string | Original file name |
| fileType | string | Type (`image`, `video`) |
| mimeType | string | MIME type |
| s3Bucket | string | S3 bucket name |
| s3Key | string | S3 object key |
| publicUrl | string | Public access URL |
| fileSize | number | File size in bytes |
| dimensions | object | Width and height |
| uploadedBy | string | Email of uploader |
| uploadedAt | string | Upload timestamp |
| tags | string[] | Organization tags |
| clinicIds | string[] | Associated clinics |
| usedInPosts | string[] | Posts using this media |

---

## 10. Infrastructure Components

### DynamoDB Tables

| Table | Partition Key | Sort Key | GSIs |
|-------|---------------|----------|------|
| MarketingProfiles | clinicId | - | - |
| MarketingPosts | postId | createdAt | ByClinic, ByStatus |
| MarketingComments | postId | commentId | ByClinic |
| MarketingMedia | mediaId | - | ByUploader |
| MarketingAnalytics | postId | syncedAt | - |

### S3 Bucket

| Bucket | Purpose |
|--------|---------|
| todaysdentalinsights-marketing-media | Media file storage |

### Lambda Functions

| Function | Purpose | Timeout |
|----------|---------|---------|
| MarketingProfilesFn | Profile management | 30s |
| MarketingPostsFn | Post operations | 60s |
| MarketingCommentsFn | Comment management | 30s |
| MarketingAnalyticsFn | Analytics retrieval | 30s |
| MarketingMediaFn | Media management | 60s |
| MarketingWebhooksFn | Webhook handling | 30s |
| MarketingAnalyticsSyncFn | Scheduled sync | 300s |

### External Integrations

| Service | Purpose |
|---------|---------|
| Ayrshare | Social media publishing and analytics |

---

## Appendix: Supported Platforms

| Platform | Posting | Comments | Analytics |
|----------|---------|----------|-----------|
| Facebook | ✅ | ✅ | ✅ |
| Instagram | ✅ | ✅ | ✅ |
| Twitter | ✅ | ✅ | ✅ |
| LinkedIn | ✅ | ✅ | ✅ |

