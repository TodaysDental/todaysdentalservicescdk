# Push Notifications Setup Guide

This guide explains how to set up AWS SNS Push Notifications for iOS (APNs) and Android (FCM) in the TodaysDentalInsights CDK project.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐
│   iOS App       │     │  Android App    │
│  (APNs Token)   │     │  (FCM Token)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │ Device Token
                     ▼
         ┌───────────────────────┐
         │   API Gateway         │
         │   /push/register      │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Register Device      │
         │      Lambda           │
         └───────────┬───────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   DynamoDB   │ │ SNS APNs    │ │ SNS FCM      │
│ DeviceTokens │ │ Platform    │ │ Platform     │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Prerequisites

### 1. iOS (APNs) Setup

You need an Apple Developer account with push notification capabilities.

#### Generate APNs Authentication Key (Recommended - Token-based)

1. Go to [Apple Developer Portal](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Select **Keys** → Click **+** to create a new key
4. Enter a name (e.g., "TodaysDental Push Key")
5. Enable **Apple Push Notifications service (APNs)**
6. Click **Continue** → **Register**
7. **Download the `.p8` file** (you can only download it once!)
8. Note the **Key ID** (10-character string)
9. Note your **Team ID** (found in Membership section)

#### Get Your Bundle ID

Your iOS app's bundle identifier (e.g., `com.todaysdentalinsights.app`)

### 2. Android (FCM) Setup

You need a Firebase project linked to your Android app.

#### Get FCM Server Key

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project (or create one)
3. Click the gear icon → **Project Settings**
4. Go to **Cloud Messaging** tab
5. Under **Cloud Messaging API (Legacy)**, find the **Server key**
   - If not visible, you may need to enable the Cloud Messaging API
6. Copy the **Server key**

> **Note:** Firebase recommends migrating to FCM HTTP v1 API, but SNS currently requires the legacy server key.

## AWS Secrets Manager Setup

Store your credentials securely in AWS Secrets Manager.

### Create APNs Secret

```bash
# Using AWS CLI
aws secretsmanager create-secret \
  --name "todaysdentalinsights/push/apns" \
  --description "APNs credentials for iOS push notifications" \
  --secret-string '{
    "signingKey": "-----BEGIN PRIVATE KEY-----\nMIGT...your-key-content...\n-----END PRIVATE KEY-----",
    "keyId": "ABC123DEFG",
    "teamId": "TEAM123456",
    "bundleId": "com.todaysdentalinsights.app"
  }'
```

**Secret Structure:**
| Field | Description | Example |
|-------|-------------|---------|
| `signingKey` | Contents of your `.p8` file | `-----BEGIN PRIVATE KEY-----\n...` |
| `keyId` | 10-character Key ID from Apple | `ABC123DEFG` |
| `teamId` | Your Apple Team ID | `TEAM123456` |
| `bundleId` | Your iOS app bundle identifier | `com.yourcompany.app` |

### Create FCM Secret

```bash
# Using AWS CLI
aws secretsmanager create-secret \
  --name "todaysdentalinsights/push/fcm" \
  --description "FCM credentials for Android push notifications" \
  --secret-string '{
    "serverKey": "AAAA...your-server-key..."
  }'
```

**Secret Structure:**
| Field | Description |
|-------|-------------|
| `serverKey` | Firebase Cloud Messaging Server Key |

## Enable Platform Applications in CDK

After creating the secrets, update `infra.ts`:

```typescript
const pushNotificationsStack = new PushNotificationsStack(app, 'TodaysDentalInsightsPushN1', {
  env,
  apnsSecretName: 'todaysdentalinsights/push/apns',
  fcmSecretName: 'todaysdentalinsights/push/fcm',
  enableApnsSandbox: true, // Set to false for production-only
});
```

Then deploy:

```bash
npm run build && cdk deploy TodaysDentalInsightsPushN1
```

## API Reference

Base URL: `https://apig.todaysdentalinsights.com/push`

### Register Device

Register a device token from a mobile app.

```http
POST /push/register
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "deviceToken": "abc123...",
  "platform": "ios",  // or "android"
  "environment": "sandbox",  // iOS only: "sandbox" or "production"
  "deviceName": "iPhone 15 Pro",
  "appVersion": "1.0.0",
  "osVersion": "17.0"
}
```

**Response:**
```json
{
  "success": true,
  "deviceId": "device_abc123",
  "endpointArn": "arn:aws:sns:us-east-1:...:endpoint/APNS/...",
  "platform": "ios",
  "environment": "sandbox"
}
```

### Get Registered Devices

List all devices registered for the current user.

```http
GET /push/devices
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "devices": [
    {
      "deviceId": "device_abc123",
      "platform": "ios",
      "environment": "sandbox",
      "deviceName": "iPhone 15 Pro",
      "enabled": true,
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

### Unregister Device

Remove a device registration.

```http
POST /push/unregister
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "deviceToken": "abc123..."
}
```

Or by device ID:

```http
DELETE /push/devices/{deviceId}
Authorization: Bearer <jwt-token>
```

### Send Push Notification

Send a push notification (requires Marketing write permission).

```http
POST /push/send
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "userId": "user-123",
  "notification": {
    "title": "Appointment Reminder",
    "body": "Your appointment is tomorrow at 2:00 PM",
    "type": "appointment_reminder",
    "data": {
      "appointmentId": "apt-456"
    }
  }
}
```

### Send to Clinic

Send push notification to all users in a clinic.

```http
POST /push/clinic/{clinicId}/send
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "notification": {
    "title": "Office Closed",
    "body": "Our office will be closed on Monday for the holiday.",
    "type": "general"
  },
  "dryRun": false
}
```

## Mobile App Integration

### iOS (Swift)

```swift
import UserNotifications
import UIKit

class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        registerForPushNotifications()
        return true
    }
    
    func registerForPushNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }
    
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenParts = deviceToken.map { String(format: "%02.2hhx", $0) }
        let token = tokenParts.joined()
        
        // Send to your backend
        registerDeviceToken(token: token, platform: "ios")
    }
    
    func registerDeviceToken(token: String, platform: String) {
        // POST to /push/register with the token
        let body: [String: Any] = [
            "deviceToken": token,
            "platform": platform,
            "environment": "sandbox" // or "production"
        ]
        // ... make API call
    }
}
```

### Android (Kotlin)

```kotlin
class MyFirebaseMessagingService : FirebaseMessagingService() {
    
    override fun onNewToken(token: String) {
        // Send to your backend
        registerDeviceToken(token, "android")
    }
    
    private fun registerDeviceToken(token: String, platform: String) {
        // POST to /push/register with the token
        val body = mapOf(
            "deviceToken" to token,
            "platform" to platform
        )
        // ... make API call
    }
    
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        remoteMessage.notification?.let { notification ->
            showNotification(notification.title, notification.body)
        }
    }
}
```

### Flutter

```dart
import 'package:firebase_messaging/firebase_messaging.dart';

class PushNotificationService {
  final FirebaseMessaging _fcm = FirebaseMessaging.instance;

  Future<void> initialize() async {
    // Request permission
    await _fcm.requestPermission();
    
    // Get token
    String? token = await _fcm.getToken();
    if (token != null) {
      await _registerToken(token);
    }
    
    // Listen for token refresh
    _fcm.onTokenRefresh.listen(_registerToken);
  }
  
  Future<void> _registerToken(String token) async {
    // POST to /push/register
    await apiClient.post('/push/register', body: {
      'deviceToken': token,
      'platform': Platform.isIOS ? 'ios' : 'android',
      'environment': kDebugMode ? 'sandbox' : 'production',
    });
  }
}
```

## Notification Types

| Type | Description | Use Case |
|------|-------------|----------|
| `appointment_reminder` | Upcoming appointment | 24h/1h before appointment |
| `appointment_confirmation` | Appointment confirmed | After booking |
| `new_message` | New chat message | Real-time messaging |
| `treatment_update` | Treatment plan update | Clinical updates |
| `payment_due` | Payment reminder | Billing notifications |
| `staff_alert` | Staff notification | Internal alerts |
| `general` | General notification | Announcements |

## Troubleshooting

### "Platform application not configured"
- Ensure secrets are created in Secrets Manager
- Update `infra.ts` with secret names
- Redeploy the stack

### Push not received on iOS
- Verify bundle ID matches your app
- Check APNs certificate/key is valid
- Use sandbox environment for development builds

### Push not received on Android
- Verify FCM server key is correct
- Check google-services.json is in your Android app
- Ensure FCM is enabled in Firebase Console

### Endpoint disabled
- Device tokens expire when users uninstall/reinstall
- Mobile app should re-register token on each launch
- Use `SetEndpointAttributes` to re-enable

## Security Considerations

1. **Secrets**: APNs/FCM credentials are stored in Secrets Manager, not in code
2. **Authorization**: All endpoints require JWT authentication
3. **Permissions**: Sending notifications requires Marketing module write access
4. **Clinic Access**: Users can only send to clinics they have access to
5. **Token Hashing**: Device tokens are hashed for the device ID to prevent enumeration

