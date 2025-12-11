import axios from 'axios';

const AYRSHARE_URL = 'https://app.ayrshare.com/api';

// ============================================
// PROFILE MANAGEMENT
// ============================================

export async function ayrshareCreateProfile(apiKey: string, title: string) {
  try {
    const res = await axios.post(`${AYRSHARE_URL}/profiles/profile`, 
      { title }, 
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
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
    const res = await axios.delete(`${AYRSHARE_URL}/profiles/profile`, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Profile-Key': profileKey
      }
    });
    return res.data;
  } catch (err: any) {
    console.warn('Delete Profile Error (might already be deleted):', err.message);
    return null; 
  }
}

export async function ayrshareGenerateJWT(apiKey: string, profileKey: string, domain: string) {
  try {
    console.log('Ayrshare generateJWT request - domain:', domain, 'profileKey:', profileKey.substring(0, 10) + '...');
    
    const res = await axios.post(`${AYRSHARE_URL}/profiles/generateJWT`,
      { domain, privateKey: profileKey },
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