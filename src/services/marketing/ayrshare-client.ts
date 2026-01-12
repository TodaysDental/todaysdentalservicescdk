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
    console.log('[ayrsharePost] Posting to Ayrshare:', {
      profileKey: profileKey.substring(0, 10) + '...',
      platforms: postData.platforms,
      hasPost: !!postData.post,
      hasMediaUrls: !!(postData.mediaUrls?.length)
    });
    
    const res = await axios.post(`${AYRSHARE_URL}/post`,
      postData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );
    console.log('[ayrsharePost] Success:', res.data?.id || res.data?.status);
    return res.data;
  } catch (err: any) {
    const errorData = err.response?.data;
    console.error('[ayrsharePost] Error response:', JSON.stringify(errorData || err.message));
    console.error('[ayrsharePost] Status:', err.response?.status);
    
    // Extract more specific error message from Ayrshare response
    const errorMessage = errorData?.message || errorData?.error || errorData?.errors?.[0]?.message || 'Failed to post';
    throw new Error(errorMessage);
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

// ============================================
// META ADS API (Facebook/Instagram Ads via Ayrshare)
// ============================================

/**
 * Boost an existing Facebook/Instagram post
 * Requires the Ads add-on enabled in your Ayrshare account
 */
export interface BoostPostParams {
  postId: string;            // The Ayrshare post ID to boost
  budget: number;            // Daily budget in USD (min $1)
  durationDays: number;      // Number of days to run the ad (1-30)
  targetAudience?: {
    ageMin?: number;         // Minimum age (13-65)
    ageMax?: number;         // Maximum age (13-65)
    genders?: ('male' | 'female' | 'all')[];
    locations?: string[];    // Country codes (e.g., 'US', 'CA')
    interests?: string[];    // Interest targeting keywords
  };
  objective?: 'engagement' | 'reach' | 'traffic' | 'awareness';
}

export async function ayrshareBoostPost(
  apiKey: string,
  profileKey: string,
  params: BoostPostParams
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/ads/boost`,
      {
        id: params.postId,
        budget: params.budget,
        durationDays: params.durationDays,
        ...(params.targetAudience && {
          targeting: {
            ageMin: params.targetAudience.ageMin,
            ageMax: params.targetAudience.ageMax,
            genders: params.targetAudience.genders,
            geoLocations: params.targetAudience.locations,
            interests: params.targetAudience.interests
          }
        }),
        objective: params.objective || 'engagement'
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
    console.error('Boost Post Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to boost post');
  }
}

/**
 * Create a new Facebook/Instagram ad campaign
 */
export interface CreateAdCampaignParams {
  name: string;              // Campaign name
  objective: 'engagement' | 'reach' | 'traffic' | 'awareness' | 'conversions';
  budget: number;            // Daily budget in USD
  startDate: string;         // ISO date string
  endDate?: string;          // Optional end date (ISO string)
  platforms: ('facebook' | 'instagram')[];
  creative: {
    headline: string;
    body: string;
    mediaUrls?: string[];
    callToAction?: 'LEARN_MORE' | 'SHOP_NOW' | 'BOOK_NOW' | 'CONTACT_US' | 'SIGN_UP';
    link?: string;           // Destination URL
  };
  targeting?: {
    ageMin?: number;
    ageMax?: number;
    genders?: ('male' | 'female' | 'all')[];
    locations?: string[];
    interests?: string[];
    customAudiences?: string[];
  };
}

export async function ayrshareCreateAdCampaign(
  apiKey: string,
  profileKey: string,
  params: CreateAdCampaignParams
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/ads/campaign`,
      {
        name: params.name,
        objective: params.objective,
        budget: params.budget,
        schedule: {
          startDate: params.startDate,
          endDate: params.endDate
        },
        platforms: params.platforms,
        creative: params.creative,
        targeting: params.targeting
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
    console.error('Create Ad Campaign Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to create ad campaign');
  }
}

/**
 * Get all ad campaigns for a profile
 */
export async function ayrshareGetAdCampaigns(
  apiKey: string,
  profileKey: string,
  params?: {
    status?: 'active' | 'paused' | 'completed' | 'all';
    limit?: number;
  }
) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/ads/campaigns`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: {
        status: params?.status || 'all',
        limit: params?.limit || 50
      }
    });
    return res.data;
  } catch (err: any) {
    console.error('Get Ad Campaigns Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get ad campaigns');
  }
}

/**
 * Get a single ad campaign by ID
 */
export async function ayrshareGetAdCampaign(
  apiKey: string,
  profileKey: string,
  campaignId: string
) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/ads/campaign`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: { id: campaignId }
    });
    return res.data;
  } catch (err: any) {
    console.error('Get Ad Campaign Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get ad campaign');
  }
}

/**
 * Update an existing ad campaign
 */
export async function ayrshareUpdateAdCampaign(
  apiKey: string,
  profileKey: string,
  campaignId: string,
  updates: {
    status?: 'active' | 'paused';
    budget?: number;
    endDate?: string;
  }
) {
  try {
    const res = await axios.put(`${AYRSHARE_URL}/ads/campaign`,
      {
        id: campaignId,
        ...updates
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
    console.error('Update Ad Campaign Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to update ad campaign');
  }
}

/**
 * Delete/stop an ad campaign
 */
export async function ayrshareDeleteAdCampaign(
  apiKey: string,
  profileKey: string,
  campaignId: string
) {
  try {
    const res = await axios.delete(`${AYRSHARE_URL}/ads/campaign`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey,
        'Content-Type': 'application/json'
      },
      data: { id: campaignId }
    });
    return res.data;
  } catch (err: any) {
    console.error('Delete Ad Campaign Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to delete ad campaign');
  }
}

/**
 * Get ad analytics for a campaign or boosted post
 */
export interface AdAnalyticsResponse {
  campaignId?: string;
  postId?: string;
  platform: string;
  metrics: {
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number;            // Click-through rate
    spend: number;          // Amount spent in USD
    cpc: number;            // Cost per click
    cpm: number;            // Cost per 1000 impressions
    engagements: number;
    conversions?: number;
  };
  dateRange: {
    start: string;
    end: string;
  };
}

export async function ayrshareGetAdAnalytics(
  apiKey: string,
  profileKey: string,
  params: {
    campaignId?: string;
    postId?: string;        // For boosted posts
    startDate?: string;
    endDate?: string;
  }
): Promise<AdAnalyticsResponse> {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/ads/analytics`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: {
        id: params.campaignId,
        postId: params.postId,
        startDate: params.startDate,
        endDate: params.endDate
      }
    });
    return res.data;
  } catch (err: any) {
    console.error('Get Ad Analytics Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get ad analytics');
  }
}

/**
 * Get ad account info and billing status
 */
export async function ayrshareGetAdAccount(apiKey: string, profileKey: string) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/ads/account`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      }
    });
    return res.data;
  } catch (err: any) {
    console.error('Get Ad Account Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get ad account info');
  }
}

// ============================================
// META LEAD FORM APIs
// ============================================

/**
 * Lead form question types
 */
export interface LeadFormQuestion {
  type: 'FULL_NAME' | 'EMAIL' | 'PHONE' | 'CUSTOM';
  key: string;
  label: string;
  required?: boolean;
  fieldType?: 'TEXT' | 'MULTIPLE_CHOICE' | 'DROPDOWN';
  options?: { value: string; label: string }[];
}

/**
 * Parameters for creating a lead form
 */
export interface CreateLeadFormParams {
  name: string;
  questions: LeadFormQuestion[];
  privacyPolicy?: {
    url: string;
    text: string;
  };
  thankYouPage?: {
    title: string;
    body: string;
  };
  pageId?: string;
}

/**
 * Create a lead generation form on Facebook
 */
export async function ayrshareCreateLeadForm(
  apiKey: string,
  profileKey: string,
  params: CreateLeadFormParams
) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/ads/leadgen/form`,
      {
        name: params.name,
        questions: params.questions.map(q => ({
          type: q.type,
          key: q.key,
          label: q.label,
          required: q.required !== false,
          ...(q.fieldType && { fieldType: q.fieldType }),
          ...(q.options && { options: q.options })
        })),
        privacyPolicy: params.privacyPolicy,
        thankYouScreen: params.thankYouPage ? {
          title: params.thankYouPage.title,
          body: params.thankYouPage.body
        } : undefined,
        pageId: params.pageId
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
    console.error('Create Lead Form Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to create lead form');
  }
}

/**
 * Get all lead forms for a profile
 */
export async function ayrshareGetLeadForms(apiKey: string, profileKey: string) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/ads/leadgen/forms`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      }
    });
    return res.data;
  } catch (err: any) {
    console.error('Get Lead Forms Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get lead forms');
  }
}

/**
 * Get leads collected from a form
 */
export async function ayrshareGetLeads(
  apiKey: string,
  profileKey: string,
  formId: string,
  params?: {
    limit?: number;
    startDate?: string;
    endDate?: string;
  }
) {
  try {
    const res = await axios.get(`${AYRSHARE_URL}/ads/leadgen/leads`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      },
      params: {
        formId,
        limit: params?.limit || 100,
        startDate: params?.startDate,
        endDate: params?.endDate
      }
    });
    return res.data;
  } catch (err: any) {
    console.error('Get Leads Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get leads');
  }
}

// ============================================
// FULL CAMPAIGN CREATION (Campaign + AdSet + Ad)
// ============================================

/**
 * Full campaign parameters for 8-step wizard
 */
export interface FullCampaignParams {
  // Step 1: Campaign
  campaignName: string;
  objective: 'LEAD_GENERATION' | 'TRAFFIC' | 'ENGAGEMENT' | 'CONVERSIONS' | 'REACH' | 'AWARENESS';
  budgetType: 'DAILY' | 'LIFETIME';
  dailyBudget: number;
  startDate: string;
  endDate?: string;
  
  // Step 2: Audience Targeting
  targeting: {
    ageMin: number;
    ageMax: number;
    genders?: number[]; // 1=male, 2=female
    locations?: Array<{
      city?: string;
      cityKey?: string;
      state?: string;
      country?: string;
      radius?: number;
    }>;
    interests?: Array<{
      id: string;
      name: string;
    }>;
    behaviors?: Array<{
      id: string;
      name: string;
    }>;
  };
  
  // Step 3: Identity
  identity: {
    facebookPageId?: string;
    instagramAccountId?: string;
    adFormat: 'SINGLE_IMAGE' | 'VIDEO' | 'CAROUSEL';
  };
  
  // Step 4: Destination
  destination: {
    type: 'LEAD_FORM' | 'WEBSITE' | 'PHONE' | 'MESSENGER';
    leadFormId?: string;
    websiteUrl?: string;
    phoneNumber?: string;
  };
  
  // Step 5: Creative
  creative: {
    imageUrl?: string;
    videoUrl?: string;
    primaryText: string;
    headline: string;
    description?: string;
    callToAction: 'SIGN_UP' | 'BOOK_NOW' | 'LEARN_MORE' | 'CONTACT_US' | 'CALL_NOW' | 'SEND_MESSAGE' | 'APPLY_NOW' | 'GET_QUOTE';
  };
  
  // Step 6: Tracking
  tracking?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    pixelId?: string;
    conversionEvents?: string[];
  };
}

/**
 * Create a full campaign with Campaign, AdSet, and Ad in one call
 * This orchestrates the complete 8-step wizard data into Meta Ads
 */
export async function ayrshareCreateFullCampaign(
  apiKey: string,
  profileKey: string,
  params: FullCampaignParams
) {
  try {
    // Step 1: Create Campaign
    console.log(`Creating campaign: ${params.campaignName}`);
    const campaignRes = await axios.post(`${AYRSHARE_URL}/ads/campaign`,
      {
        name: params.campaignName,
        objective: params.objective,
        status: 'PAUSED', // Start paused for Meta review
        specialAdCategories: [], // Required for some objectives
        budgetType: params.budgetType,
        dailyBudget: Math.round(params.dailyBudget * 100), // Convert to cents
        schedule: {
          startTime: params.startDate,
          endTime: params.endDate
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );
    
    const campaignId = campaignRes.data.id || campaignRes.data.campaignId;
    console.log(`Campaign created: ${campaignId}`);

    // Step 2: Create Ad Set with targeting
    console.log('Creating ad set...');
    const adSetRes = await axios.post(`${AYRSHARE_URL}/ads/adset`,
      {
        campaignId,
        name: `${params.campaignName} - Ad Set`,
        status: 'PAUSED',
        dailyBudget: Math.round(params.dailyBudget * 100),
        billingEvent: 'IMPRESSIONS',
        optimizationGoal: params.objective === 'LEAD_GENERATION' ? 'LEAD_GENERATION' : 'LINK_CLICKS',
        targeting: {
          ageMin: params.targeting.ageMin,
          ageMax: params.targeting.ageMax,
          genders: params.targeting.genders || [1, 2],
          geoLocations: params.targeting.locations?.length ? {
            cities: params.targeting.locations.map(loc => ({
              key: loc.cityKey,
              name: loc.city,
              region: loc.state,
              country: loc.country || 'US',
              radius: loc.radius || 25,
              distanceUnit: 'mile'
            }))
          } : undefined,
          interests: params.targeting.interests?.map(i => ({
            id: i.id,
            name: i.name
          })),
          behaviors: params.targeting.behaviors?.map(b => ({
            id: b.id,
            name: b.name
          }))
        },
        startTime: params.startDate,
        endTime: params.endDate
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );

    const adSetId = adSetRes.data.id || adSetRes.data.adSetId;
    console.log(`Ad Set created: ${adSetId}`);

    // Step 3: Create Ad with creative
    console.log('Creating ad...');
    
    // Build destination URL with UTM parameters
    let destinationUrl = params.destination.websiteUrl;
    if (destinationUrl && params.tracking) {
      const utmParams = new URLSearchParams();
      if (params.tracking.utmSource) utmParams.set('utm_source', params.tracking.utmSource);
      if (params.tracking.utmMedium) utmParams.set('utm_medium', params.tracking.utmMedium);
      if (params.tracking.utmCampaign) utmParams.set('utm_campaign', params.tracking.utmCampaign);
      if (params.tracking.utmContent) utmParams.set('utm_content', params.tracking.utmContent);
      
      const separator = destinationUrl.includes('?') ? '&' : '?';
      destinationUrl = `${destinationUrl}${separator}${utmParams.toString()}`;
    }

    const adRes = await axios.post(`${AYRSHARE_URL}/ads/ad`,
      {
        adSetId,
        name: params.campaignName,
        status: 'PAUSED',
        creative: {
          objectStorySpec: {
            pageId: params.identity.facebookPageId,
            instagramActorId: params.identity.instagramAccountId,
            linkData: {
              message: params.creative.primaryText,
              name: params.creative.headline,
              description: params.creative.description,
              link: destinationUrl,
              imageUrl: params.creative.imageUrl,
              callToAction: {
                type: params.creative.callToAction,
                value: params.destination.type === 'LEAD_FORM' 
                  ? { leadGenFormId: params.destination.leadFormId }
                  : params.destination.type === 'PHONE'
                    ? { phoneNumber: params.destination.phoneNumber }
                    : { link: destinationUrl }
              }
            }
          }
        },
        trackingSpecs: params.tracking?.pixelId ? [{
          'action.type': ['offsite_conversion'],
          fbPixel: [params.tracking.pixelId]
        }] : undefined
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Profile-Key': profileKey
        }
      }
    );

    const adId = adRes.data.id || adRes.data.adId;
    console.log(`Ad created: ${adId}`);

    return {
      success: true,
      campaignId,
      adSetId,
      adId,
      status: 'PENDING_REVIEW'
    };
  } catch (err: any) {
    console.error('Create Full Campaign Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to create full campaign');
  }
}

/**
 * Update campaign status (activate/pause)
 */
export async function ayrshareActivateCampaign(
  apiKey: string,
  profileKey: string,
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED'
) {
  try {
    const res = await axios.put(`${AYRSHARE_URL}/ads/campaign`,
      {
        id: campaignId,
        status
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
    console.error('Activate Campaign Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to update campaign status');
  }
}