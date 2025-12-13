import axios from 'axios';

// Use the correct Ayrshare API base URL (api.ayrshare.com, not app.ayrshare.com)
const AYRSHARE_URL = 'https://api.ayrshare.com/api';

// ============================================
// PROFILE MANAGEMENT
// ============================================

export async function ayrshareCreateProfile(apiKey: string, title: string) {
  try {
    // Correct endpoint: POST /profiles (not /profiles/profile)
    // Available on Business, Enterprise plans
    const res = await axios.post(`${AYRSHARE_URL}/profiles`, 
      { title }, 
      { 
        headers: { 
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        } 
      }
    );
    return res.data; 
  } catch (err: any) {
    console.error('Create Profile Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to create profile');
  }
}

export async function ayrshareGetProfile(apiKey: string, profileKey: string) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/user`, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get profile');
  }
}

export async function ayrshareDeleteProfile(apiKey: string, profileKey: string) {
  try {
    // Correct endpoint: DELETE /profiles (not /profiles/profile)
    // Available on Business, Enterprise plans
    const res = await axios.delete(`${AYRSHARE_URL}/profiles`, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey,
        'Content-Type': 'application/json'
      }
    });
    return res.data;
  } catch (err: any) {
    console.warn('Delete Profile Error (might already be deleted):', err.message);
    return null; 
  }
}

export async function ayrshareGenerateJWT(
  apiKey: string, 
  profileKey: string, 
  domain: string,
  privateKey: string,
  expiresIn: number = 300
) {
  try {
    console.log('Ayrshare generateJWT request - domain:', domain, 'profileKey:', profileKey.substring(0, 10) + '...', 'expiresIn:', expiresIn);
    
    // Validate required fields
    if (!privateKey) {
      throw new Error('AYRSHARE_PRIVATE_KEY is not configured. Please set the private key in environment variables.');
    }
    
    const res = await axios.post(`${AYRSHARE_URL}/profiles/generateJWT`,
      { 
        domain, 
        profileKey,
        privateKey,
        expiresIn
      },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    
    console.log('Ayrshare generateJWT response status:', res.status);
    console.log('Ayrshare generateJWT response data keys:', Object.keys(res.data || {}));
    
    // Ayrshare returns { url: "https://..." } or { jwtUrl: "https://..." }
    // Normalize the response to always have 'url'
    const responseData = res.data;
    if (responseData.jwtUrl && !responseData.url) {
      responseData.url = responseData.jwtUrl;
    }
    
    return responseData;
  } catch (err: any) {
    console.error('Ayrshare generateJWT error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || err.response?.data?.error || 'Failed to generate JWT');
  }
}

// ============================================
// POSTING & SCHEDULING
// ============================================

export async function ayrsharePost(apiKey: string, profileKey: string, postData: any) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/post`,
      postData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to post');
  }
}

export async function ayrshareDeletePost(apiKey: string, profileKey: string, postId: string) {
  try {
    const res = await axios.delete(`${AYRSHARE_URL}/post`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        },
        data: { id: postId }
      }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to delete post');
  }
}

// ============================================
// ANALYTICS & HISTORY
// ============================================

export async function ayrshareGetHistory(apiKey: string, profileKey: string, params?: {
  lastRecords?: number;
  lastDays?: number;
}) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/history`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get history');
  }
}

export async function ayrshareGetAnalytics(apiKey: string, profileKey: string, postId: string) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/analytics/post`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: { id: postId }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get analytics');
  }
}

export async function ayrshareGetSocialStats(apiKey: string, profileKey: string, platforms: string[]) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/analytics/social`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: { platforms: platforms.join(',') }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get social stats');
  }
}

// ============================================
// COMMENTS MANAGEMENT
// ============================================

export async function ayrshareGetComments(apiKey: string, profileKey: string, postId: string) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/comments`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: { id: postId }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get comments');
  }
}

export async function ayrshareReplyToComment(
  apiKey: string, 
  profileKey: string, 
  commentId: string,
  replyText: string,
  platform: string
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/comments`,
      {
        commentId,
        comment: replyText,
        platform
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to reply to comment');
  }
}

// ============================================
// MEDIA MANAGEMENT
// ============================================

export async function ayrshareUploadMedia(apiKey: string, profileKey: string, file: Buffer, fileName: string) {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([file]), fileName);

    const res = await axios.post(`${AYRSHARE_URL}/upload`, formData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey,
        'Content-Type': 'multipart/form-data'
      }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to upload media');
  }
}

// ============================================
// AUTO-SCHEDULING
// ============================================

export async function ayrshareSetAutoSchedule(
  apiKey: string, 
  profileKey: string, 
  schedule: {
    scheduleDate: string[];
    scheduleTime: string[];
    title: string;
  }
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/auto-schedule/set`,
      schedule,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to set auto-schedule');
  }
}

export async function ayrshareGetAutoSchedule(apiKey: string, profileKey: string) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/auto-schedule/list`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get auto-schedule');
  }
}

export async function ayrshareDeleteAutoSchedule(apiKey: string, profileKey: string, title: string) {
  try {
    const res = await axios.delete(`${AYRSHARE_URL}/auto-schedule`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey,
        'Content-Type': 'application/json'
      },
      data: { title }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to delete auto-schedule');
  }
}

// ============================================
// WEBHOOK MANAGEMENT
// ============================================

export type WebhookAction = 'social' | 'message' | 'analytics' | 'comment' | 'feed';

export async function ayrshareRegisterWebhook(
  apiKey: string, 
  action: WebhookAction,
  url: string,
  secret: string,
  profileKey?: string
) {
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    if (profileKey) {
      headers['Profile-Key'] = profileKey;
    }
    
    const res = await axios.post(`${AYRSHARE_URL}/hook/webhook`,
      { action, url, secret },
      { headers }
    );
    return res.data;
  } catch (err: any) {
    console.error('Register Webhook Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to register webhook');
  }
}

export async function ayrshareUnregisterWebhook(
  apiKey: string,
  action: WebhookAction,
  profileKey?: string
) {
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    if (profileKey) {
      headers['Profile-Key'] = profileKey;
    }
    
    const res = await axios.delete(`${AYRSHARE_URL}/hook/webhook`,
      {
        headers,
        data: { action }
      }
    );
    return res.data;
  } catch (err: any) {
    console.error('Unregister Webhook Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to unregister webhook');
  }
}

export async function ayrshareGetWebhooks(apiKey: string, profileKey?: string) {
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`
    };
    
    if (profileKey) {
      headers['Profile-Key'] = profileKey;
    }
    
    const res = await axios.get(`${AYRSHARE_URL}/hook/webhook`, { headers });
    return res.data;
  } catch (err: any) {
    console.error('Get Webhooks Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get webhooks');
  }
}

// ============================================
// HASHTAGS
// ============================================

export async function ayrshareAutoHashtag(
  apiKey: string,
  text: string,
  max: number = 5,
  position: 'start' | 'end' | 'auto' = 'end'
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/hashtags/auto`, 
      { post: text, max, position },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to auto-generate hashtags');
  }
}

export async function ayrshareRecommendHashtags(
  apiKey: string,
  keyword: string,
  limit: number = 10
) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/hashtags/recommend`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      params: { keyword, limit }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get hashtag recommendations');
  }
}

export async function ayrshareSearchHashtags(
  apiKey: string,
  query: string,
  platform: string = 'instagram'
) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/hashtags/search`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      params: { query, platform }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to search hashtags');
  }
}

export async function ayrshareCheckBannedHashtags(apiKey: string, hashtags: string[]) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/hashtags/check-banned`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      params: { hashtags: hashtags.join(',') }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to check banned hashtags');
  }
}

// ============================================
// DIRECT MESSAGING
// ============================================

export async function ayrshareGetMessages(
  apiKey: string,
  profileKey: string,
  platform: string,
  limit: number = 20
) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/messages`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: { platform, limit }
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get messages');
  }
}

export async function ayrshareSendMessage(
  apiKey: string,
  profileKey: string,
  platform: string,
  recipientId: string,
  message: string
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/messages/send`, 
      { platform, recipientId, message },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to send message');
  }
}

// ============================================
// VALIDATION & CONTENT MODERATION
// ============================================

export async function ayrshareValidatePost(
  apiKey: string,
  content: string,
  platforms: string[],
  mediaUrls?: string[]
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/validate/post`, 
      { post: content, platforms, mediaUrls },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to validate post');
  }
}

export async function ayrshareValidateMedia(
  apiKey: string,
  mediaUrls: string[],
  platforms: string[]
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/media/verifyUrl`, 
      { mediaUrls, platforms },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to validate media');
  }
}

export async function ayrshareContentModeration(apiKey: string, content: string) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/validate/contentModeration`, 
      { text: content },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to moderate content');
  }
}

// ============================================
// MEDIA UTILITIES
// ============================================

export async function ayrshareResizeImage(
  apiKey: string,
  imageUrl: string,
  width: number,
  height: number
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/media/resize`, 
      { imageUrl, width, height },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to resize image');
  }
}

export async function ayrshareVerifyMediaUrl(apiKey: string, url: string) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/media/verifyUrl`, 
      { url },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to verify media URL');
  }
}

// ============================================
// LINK ANALYTICS
// ============================================

export async function ayrshareGetLinkAnalytics(
  apiKey: string,
  profileKey: string,
  postId?: string
) {
  try {
    const params: any = {};
    if (postId) params.id = postId;
    
    const res = await axios.get(`${AYRSHARE_URL}/analytics/links`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params
    });
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to get link analytics');
  }
}