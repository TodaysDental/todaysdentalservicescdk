import axios from 'axios';

const AYRSHARE_URL = 'https://app.ayrshare.com/api';

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

export async function ayrshareDeleteProfile(apiKey: string, profileKey: string) {
  try {
    // Note: Ayrshare typically deletes via the main API key referencing the profileKey
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
    const res = await axios.post(`${AYRSHARE_URL}/profiles/generateJWT`,
      { domain, privateKey: profileKey },
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return res.data;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || 'Failed to generate JWT');
  }
}

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