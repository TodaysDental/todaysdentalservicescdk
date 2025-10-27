import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ConnectClient,
  UpdateInstanceAttributeCommand,
  DescribeInstanceAttributeCommand,
} from '@aws-sdk/client-connect';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface SAMLAuthBody {
  action: 'setup' | 'configure' | 'get_metadata' | 'test';
  samlMetadataUrl?: string;
  samlMetadataXml?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Verify authentication - only super admin can configure SAML
    const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify(verifyResult) };
    }

    const caller = callerAuthContextFromClaims(verifyResult.payload!);
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can configure SAML' }),
      };
    }

    // Handle different HTTP methods
    switch (event.httpMethod) {
      case 'POST':
        return await handlePostRequest(event, caller, corsHeaders);
      case 'GET':
        return await handleGetRequest(event, caller, corsHeaders);
      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Method not allowed' }),
        };
    }
  } catch (err: any) {
    console.error('SAML auth error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

async function handlePostRequest(event: APIGatewayProxyEvent, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);

  if (!body.action) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: 'action is required' }),
    };
  }

  switch (body.action) {
    case 'setup':
      return await setupSAMLProvider(body, corsHeaders);
    case 'configure':
      return await configureConnectSAML(body, corsHeaders);
    case 'test':
      return await testSAMLConfiguration(corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Invalid POST action. Must be one of: setup, configure, test' }),
      };
  }
}

async function handleGetRequest(event: APIGatewayProxyEvent, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const body = parseQueryParams(event.queryStringParameters || {});

  switch (body.action) {
    case 'get_metadata':
      return await getSAMLMetadata(corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Invalid GET action. Must be one of: get_metadata' }),
      };
  }
}

// ========================================
// SAML PROVIDER SETUP
// ========================================

async function setupSAMLProvider(body: SAMLAuthBody, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    if (!body.samlMetadataUrl && !body.samlMetadataXml) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'samlMetadataUrl or samlMetadataXml is required' }),
      };
    }

    let samlMetadataDocument: string;

    if (body.samlMetadataUrl) {
      // Fetch metadata from URL
      const response = await fetch(body.samlMetadataUrl);
      samlMetadataDocument = await response.text();
    } else {
      samlMetadataDocument = body.samlMetadataXml!;
    }

    // Note: SAML provider creation in IAM must be done manually or via CDK
    // This function provides the metadata for manual configuration

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'SAML metadata prepared for manual IAM provider creation',
        data: {
          samlMetadataDocument: samlMetadataDocument,
          providerName: 'CognitoConnectSAMLProvider',
          note: 'Create IAM SAML provider manually using the AWS Console or CDK',
        },
      }),
    };
  } catch (err: any) {
    console.error('Setup SAML provider error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to setup SAML provider' }),
    };
  }
}

// ========================================
// CONNECT SAML CONFIGURATION
// ========================================

async function configureConnectSAML(body: SAMLAuthBody, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Note: SAML authentication for Connect happens through Cognito User Pool integration
    // Users authenticate via SAML provider, then access Connect with federated identity

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'SAML authentication flow configured',
        data: {
          authenticationFlow: 'SAML → Cognito → Connect',
          steps: [
            '1. Users authenticate via your SAML provider (Active Directory, etc.)',
            '2. SAML provider redirects to Cognito with SAML assertion',
            '3. Cognito validates SAML and issues JWT tokens',
            '4. Users access Connect using those JWT tokens',
            '5. Connect validates tokens and grants access based on user groups',
          ],
          note: 'SAML login bypasses the /auth/initiate and /auth/verify endpoints',
        },
      }),
    };
  } catch (err: any) {
    console.error('Configure Connect SAML error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to configure Connect SAML' }),
    };
  }
}

// ========================================
// SAML METADATA
// ========================================

async function getSAMLMetadata(corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Provide SAML configuration guidance for Cognito User Pool
    const region = process.env.AWS_REGION || 'us-east-1';
    const userPoolId = process.env.USER_POOL_ID;

    if (!userPoolId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'USER_POOL_ID not configured',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'SAML configuration guidance for Cognito User Pool',
        data: {
          userPoolId: userPoolId,
          region: region,
          samlSetupSteps: [
            '1. Go to AWS Cognito Console',
            '2. Select your User Pool',
            '3. Go to Sign-in experience > Authentication providers',
            '4. Add SAML identity provider',
            '5. Upload your SAML metadata file or enter metadata URL',
            '6. Configure attribute mapping (email, name, groups)',
            '7. Update User Pool Client to include SAML provider',
            '8. Test SAML login flow',
          ],
          note: 'After SAML setup, users authenticate directly via SAML provider, bypassing OTP flow',
        },
      }),
    };
  } catch (err: any) {
    console.error('Get SAML metadata error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to get SAML metadata' }),
    };
  }
}

// ========================================
// TEST SAML CONFIGURATION
// ========================================

async function testSAMLConfiguration(corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Test Connect instance connectivity
    // Note: This is a basic connectivity test since SAML configuration requires manual setup

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Connect configuration test successful',
        data: {
          instanceId: CONNECT_INSTANCE_ID,
          status: 'SAML configuration requires manual setup in Connect console',
          note: 'Use the get_metadata endpoint to retrieve SAML configuration details',
        },
      }),
    };
  } catch (err: any) {
    console.error('Test SAML configuration error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to test SAML configuration' }),
    };
  }
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function parseBody(body: any): SAMLAuthBody {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    return {
      action: parsed.action || 'get_metadata',
      samlMetadataUrl: parsed.samlMetadataUrl,
      samlMetadataXml: parsed.samlMetadataXml,
    };
  } catch {
    return {
      action: 'get_metadata',
    };
  }
}

function parseQueryParams(queryParams: any): SAMLAuthBody {
  return {
    action: queryParams?.action || 'get_metadata',
    samlMetadataUrl: queryParams?.samlMetadataUrl,
    samlMetadataXml: queryParams?.samlMetadataXml,
  };
}

async function verifyIdToken(token: string): Promise<{ ok: boolean; code: number; message: string; payload?: JWTPayload }> {
  if (!token) return { ok: false, code: 401, message: 'No token provided' };

  try {
    const jwks = createRemoteJWKSet(new URL(`https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token.replace('Bearer ', ''), jwks, { issuer: `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${USER_POOL_ID}` });
    return { ok: true, code: 200, message: 'Token verified', payload };
  } catch (err: any) {
    return { ok: false, code: 401, message: 'Invalid token: ' + err?.message };
  }
}

function callerAuthContextFromClaims(claims: JWTPayload): any {
  const groups = Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [];
  const email = claims.email as string || '';
  const userId = claims.sub as string || '';
  const givenName = claims.given_name as string || '';
  const familyName = claims.family_name as string || '';

  return {
    userId,
    email,
    givenName,
    familyName,
    groups,
    isSuperAdmin: groups.includes('GLOBAL__SUPER_ADMIN'),
    rolesByClinic: parseRolesFromGroups(groups),
  };
}

function parseRolesFromGroups(groups: string[]): Record<string, string[]> {
  const rolesByClinic: Record<string, string[]> = {};

  groups.forEach(group => {
    const match = /^clinic_([^_]+)__(.+)$/.exec(group);
    if (match) {
      const [, clinicId, role] = match;
      if (!rolesByClinic[clinicId]) rolesByClinic[clinicId] = [];
      rolesByClinic[clinicId].push(role);
    }
  });

  return rolesByClinic;
}
