import { CognitoJwtVerifier } from 'aws-jwt-verify';

// --- Environment Variables (from CDK stack) ---
const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;

// Initialize the verifier once globally
const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    clientId: USER_POOL_CLIENT_ID,
    tokenUse: 'id', // We expect the 'idtoken' query string parameter
});

/**
 * Helper function to generate an IAM policy for the authorizer
 */
const generatePolicy = (principalId: string, effect: 'Allow' | 'Deny', resource: string, context: Record<string, any>) => ({
    principalId,
    policyDocument: {
        Version: '2012-10-17',
        Statement: [{
            Action: 'execute-api:Invoke',
            Effect: effect,
            Resource: resource,
        }],
    },
    // The context object is passed to the $connect route (connect.ts)
    context, 
});

/**
 * AWS API Gateway V2 WebSocket Custom (REQUEST) Authorizer handler.
 * Validates the Cognito ID token and returns an IAM policy.
 */
export const handler = async (event: any) => {
    // The ID token is passed in the query string as 'idtoken'
    const token = event.queryStringParameters?.idtoken;
    const resourceArn = event.methodArn;

    if (!token) {
        // Deny access if no token is provided
        return generatePolicy('user', 'Deny', resourceArn, { message: 'No token provided' });
    }

    try {
        // 1. Verify the token using aws-jwt-verify
        const payload = await verifier.verify(token);
        
        // 2. Extract the user ID (sub) and cognito:username (email)
        const sub = payload.sub;
        const username = payload['cognito:username'] || payload.email;

        // 3. Generate an 'Allow' policy
        // We inject the claims into the context to be accessible by the $connect Lambda
        const context = {
            claims: {
                sub: sub,
                'cognito:username': username,
                // These claims are now accessible in connect.ts via event.requestContext.authorizer.claims
            },
        };
        
        // This grants permission for the user to connect
        return generatePolicy(sub, 'Allow', resourceArn, context);

    } catch (e: any) {
        console.error("Token verification failed:", e);
        // On any failure, deny the connection
        return generatePolicy('user', 'Deny', resourceArn, { message: 'Unauthorized' });
    }
};