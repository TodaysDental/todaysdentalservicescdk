/**
 * cPanel Email Account Creation Utility
 * 
 * Creates email accounts on todaysdentalservices.com using cPanel API
 * Used during user registration to create a dedicated email for each user.
 */

import https from 'https';

// cPanel configuration from environment variables
const CPANEL_CONFIG = {
  host: process.env.CPANEL_HOST || 'box2383.bluehost.com',
  port: parseInt(process.env.CPANEL_PORT || '2083', 10),
  username: process.env.CPANEL_USER || 'todayse4',
  password: process.env.CPANEL_PASSWORD || '',
  domain: process.env.CPANEL_DOMAIN || 'todaysdentalpartners.com',
};

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
 * Make an authenticated request to cPanel API using POST
 */
async function cpanelRequest(
  endpoint: string,
  params: Record<string, string>
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { host, port, username, password } = CPANEL_CONFIG;
  
  if (!password) {
    return { success: false, error: 'CPANEL_PASSWORD not configured' };
  }

  // Build form data for POST body
  const formData = new URLSearchParams(params).toString();
  const path = `/execute/${endpoint}`;
  
  console.log(`[cpanelRequest] Calling POST ${endpoint} with params:`, JSON.stringify(params));
  
  // Base64 encode credentials for Basic Auth
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: host,
      port: port,
      path: path,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData),
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
      resolve({ success: false, error: `Connection error: ${e.message}` });
    });
    
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout' });
    });
    
    // Write the form data to POST body
    req.write(formData);
    req.end();
  });
}

/**
 * Check if an email account already exists
 */
export async function emailExists(email: string): Promise<boolean> {
  const [username, domain] = email.split('@');
  
  const result = await cpanelRequest('Email/list_pops', {
    domain: domain || CPANEL_CONFIG.domain,
  });
  
  if (!result.success || !result.data) {
    return false;
  }
  
  const accounts = Array.isArray(result.data) ? result.data : [];
  return accounts.some((acc: any) => acc.email === email);
}

/**
 * Create a new email account on todaysdentalservices.com
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
  const domain = CPANEL_CONFIG.domain;
  
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
  const [username, domain] = email.split('@');
  
  const result = await cpanelRequest('Email/delete_pop', {
    email: username,
    domain: domain || CPANEL_CONFIG.domain,
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
  const domain = email.split('@')[1] || CPANEL_CONFIG.domain;
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

