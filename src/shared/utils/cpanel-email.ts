/**
 * cPanel Email Account Creation Utility
 * 
 * Creates email accounts on todaysdentalpartners.com using cPanel API
 * Used during user registration to create a dedicated email for each user.
 * 
 * Authentication: Uses cPanel API Token (not Basic Auth)
 * Header format: Authorization: cpanel username:API_TOKEN
 * 
 * Credentials are fetched from GlobalSecrets DynamoDB table at runtime.
 */

import https from 'https';
import { getCpanelCredentials } from './secrets-helper';

// Cached credentials (fetched from GlobalSecrets on first use)
let cachedCredentials: {
  host: string;
  port: number;
  username: string;
  apiToken: string;
  domain: string;
} | null = null;

// Fallback configuration (used only if GlobalSecrets lookup fails)
const CPANEL_FALLBACK_CONFIG = {
  host: process.env.CPANEL_HOST || 'box2383.bluehost.com',
  port: parseInt(process.env.CPANEL_PORT || '2083', 10),
  username: process.env.CPANEL_USER || 'todayse4',
  domain: process.env.CPANEL_DOMAIN || 'todaysdentalpartners.com',
};

/**
 * Get cPanel credentials from GlobalSecrets (with caching)
 */
async function getCredentials(): Promise<{
  host: string;
  port: number;
  username: string;
  apiToken: string;
  domain: string;
}> {
  // Return cached credentials if available
  if (cachedCredentials) {
    return cachedCredentials;
  }

  // Fetch from GlobalSecrets
  const creds = await getCpanelCredentials();
  
  if (creds) {
    cachedCredentials = creds;
    console.log('[cpanel-email] Loaded credentials from GlobalSecrets');
    return creds;
  }

  // Fallback to environment variables (for backward compatibility)
  const apiToken = process.env.CPANEL_API_TOKEN || process.env.CPANEL_PASSWORD;
  if (!apiToken) {
    throw new Error('cPanel API token not configured in GlobalSecrets or environment');
  }

  console.warn('[cpanel-email] Using fallback environment credentials');
  cachedCredentials = {
    ...CPANEL_FALLBACK_CONFIG,
    apiToken,
  };
  return cachedCredentials;
}

// Default password for all created email accounts
const DEFAULT_EMAIL_PASSWORD = 'Clinic@202020212022!';

interface CreateEmailResult {
  success: boolean;
  email: string;
  password: string;
  error?: string;
}

/**
 * Generate email username from user's primary email
 * e.g., john.doe@example.com -> john.doe
 */
function generateEmailUsername(primaryEmail: string): string {
  // Extract the local part from the primary email
  const localPart = primaryEmail.split('@')[0];
  
  // Clean up the username - remove special chars except dots and underscores
  const cleaned = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30); // Limit to 30 chars
  
  return cleaned || 'user';
}

/**
 * Make an authenticated request to cPanel API using API Token
 * 
 * Uses the cPanel API Token authentication format:
 * Authorization: cpanel username:API_TOKEN
 * 
 * This method is more reliable than Basic Auth as it bypasses
 * some security restrictions that block password-based authentication.
 */
async function cpanelRequest(
  endpoint: string,
  params: Record<string, string>
): Promise<{ success: boolean; data?: any; error?: string }> {
  // Get credentials from GlobalSecrets (or fallback)
  let credentials;
  try {
    credentials = await getCredentials();
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to get cPanel credentials' };
  }

  const { host, port, username, apiToken } = credentials;

  // Build query string for GET request (cPanel API Token works best with GET)
  const queryString = new URLSearchParams(params).toString();
  const path = `/execute/${endpoint}?${queryString}`;
  
  console.log(`[cpanelRequest] Calling GET ${endpoint} with params:`, JSON.stringify(params));
  
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: host,
      port: port,
      path: path,
      method: 'GET',
      headers: {
        // cPanel API Token authentication format
        'Authorization': `cpanel ${username}:${apiToken}`,
      },
      rejectUnauthorized: true,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`[cpanelRequest] Response status: ${res.statusCode}`);
        console.log(`[cpanelRequest] Response body: ${data.substring(0, 500)}`);
        
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.status === 1 || parsed.result === 1) {
            resolve({ success: true, data: parsed.data });
          } else {
            const errorMsg = parsed.errors?.join(', ') || parsed.error || parsed.cpanelresult?.error || 'Unknown cPanel error';
            console.log(`[cpanelRequest] API returned error:`, parsed);
            resolve({ success: false, error: errorMsg });
          }
        } catch (e) {
          // If not JSON, check HTTP status
          if (res.statusCode === 200) {
            resolve({ success: true, data: data });
          } else {
            resolve({ 
              success: false, 
              error: `cPanel API error: HTTP ${res.statusCode}` 
            });
          }
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`[cpanelRequest] Connection error:`, e.message);
      resolve({ success: false, error: `Connection error: ${e.message}` });
    });
    
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout' });
    });
    
    req.end();
  });
}

/**
 * Check if an email account already exists
 */
export async function emailExists(email: string): Promise<boolean> {
  const [username, emailDomain] = email.split('@');
  
  // Get domain from credentials if not in email
  let domain = emailDomain;
  if (!domain) {
    try {
      const creds = await getCredentials();
      domain = creds.domain;
    } catch {
      domain = CPANEL_FALLBACK_CONFIG.domain;
    }
  }
  
  const result = await cpanelRequest('Email/list_pops', {
    domain: domain,
  });
  
  if (!result.success || !result.data) {
    return false;
  }
  
  const accounts = Array.isArray(result.data) ? result.data : [];
  return accounts.some((acc: any) => acc.email === email);
}

/**
 * Create a new email account on todaysdentalpartners.com
 * 
 * @param primaryEmail - The user's primary email (used to generate username)
 * @param givenName - Optional given name for generating a friendly email
 * @param familyName - Optional family name for generating a friendly email
 * @returns Result with created email address and password
 */
export async function createEmailAccount(
  primaryEmail: string,
  givenName?: string,
  familyName?: string
): Promise<CreateEmailResult> {
  // Get domain from credentials
  let domain: string;
  try {
    const creds = await getCredentials();
    domain = creds.domain;
  } catch (err: any) {
    console.error('[createEmailAccount] Failed to get credentials:', err.message);
    return {
      success: false,
      email: '',
      password: '',
      error: err.message || 'Failed to get cPanel credentials',
    };
  }
  
  // Generate username from given/family name if available, otherwise from primary email
  let username: string;
  if (givenName && familyName) {
    // Prefer firstname.lastname format
    username = `${givenName.toLowerCase().replace(/[^a-z]/g, '')}.${familyName.toLowerCase().replace(/[^a-z]/g, '')}`;
  } else if (givenName) {
    username = givenName.toLowerCase().replace(/[^a-z]/g, '');
  } else {
    username = generateEmailUsername(primaryEmail);
  }
  
  // Ensure username is unique by adding a number if needed
  const baseUsername = username.slice(0, 30);
  let finalUsername = baseUsername;
  let email = `${finalUsername}@${domain}`;
  
  // Check if email already exists, add number suffix if needed
  let counter = 1;
  while (await emailExists(email)) {
    finalUsername = `${baseUsername}${counter}`;
    email = `${finalUsername}@${domain}`;
    counter++;
    
    if (counter > 100) {
      return {
        success: false,
        email: '',
        password: '',
        error: 'Unable to generate unique email address',
      };
    }
  }
  
  // Validate username is not empty
  if (!finalUsername || finalUsername.trim() === '') {
    console.error(`[createEmailAccount] Empty username generated from primaryEmail=${primaryEmail}, givenName=${givenName}, familyName=${familyName}`);
    return {
      success: false,
      email: '',
      password: '',
      error: 'Failed to generate valid username for email',
    };
  }

  console.log(`[createEmailAccount] Attempting to create email: username=${finalUsername}, domain=${domain}`);

  // Create the email account using cPanel UAPI
  // Try with 'email' as username only first (standard UAPI format)
  let result = await cpanelRequest('Email/add_pop', {
    email: finalUsername,
    password: DEFAULT_EMAIL_PASSWORD,
    quota: '500', // 500 MB quota
    domain: domain,
  });
  
  // If that fails, try alternate parameter names used by some cPanel versions
  if (!result.success && result.error?.includes('invalid')) {
    console.log(`[createEmailAccount] First attempt failed, trying alternate API format...`);
    result = await cpanelRequest('Email/add_pop', {
      email: finalUsername,
      password: DEFAULT_EMAIL_PASSWORD,
      quota: '500',
      domain: domain,
      skip_update_db: '0',
    });
  }
  
  if (!result.success) {
    console.error(`[createEmailAccount] Failed to create email ${email}:`, result.error);
    return {
      success: false,
      email: '',
      password: '',
      error: result.error || 'Failed to create email account',
    };
  }
  
  console.log(`[createEmailAccount] Successfully created email: ${email}`);
  
  return {
    success: true,
    email: email,
    password: DEFAULT_EMAIL_PASSWORD,
  };
}

/**
 * Delete an email account (for cleanup/testing)
 */
export async function deleteEmailAccount(email: string): Promise<{ success: boolean; error?: string }> {
  const [username, emailDomain] = email.split('@');
  
  // Get domain from credentials if not in email
  let domain = emailDomain;
  if (!domain) {
    try {
      const creds = await getCredentials();
      domain = creds.domain;
    } catch {
      domain = CPANEL_FALLBACK_CONFIG.domain;
    }
  }
  
  const result = await cpanelRequest('Email/delete_pop', {
    email: username,
    domain: domain,
  });
  
  return {
    success: result.success,
    error: result.error,
  };
}

/**
 * Get email account credentials structure for storage
 */
export function getEmailCredentials(email: string): {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
} {
  // Extract domain from email to use correct mail server
  const domain = email.split('@')[1] || CPANEL_FALLBACK_CONFIG.domain;
  const mailHost = `mail.${domain}`;
  
  return {
    email: email,
    password: DEFAULT_EMAIL_PASSWORD,
    imapHost: mailHost,
    imapPort: 993,
    smtpHost: mailHost,
    smtpPort: 465,
  };
}

/**
 * Clear cached credentials (useful for testing or forcing refresh)
 */
export function clearCpanelCredentialsCache(): void {
  cachedCredentials = null;
  console.log('[cpanel-email] Credentials cache cleared');
}

