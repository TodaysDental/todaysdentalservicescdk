/**
 * Google Ads Refresh Token Generator - Manual Code Entry
 * 
 * This script generates a refresh token using manual code entry.
 * No local server needed - just copy/paste the code from the browser.
 * 
 * Usage:
 *   npx ts-node scripts/get-refresh-token-manual.ts <AUTH_CODE>
 * 
 * Steps:
 *   1. Run this script without arguments to get the auth URL
 *   2. Visit the URL in browser and sign in
 *   3. Copy the "code" parameter from the redirect URL
 *   4. Run this script again with the code as argument
 */

import { google } from 'googleapis';

// Google Ads API credentials (from global-secrets.json)
const CLIENT_ID = '584598112747-e6oc5dku2m7bk6m8eirn9lg4ipg0t59k.apps.googleusercontent.com';
const CLIENT_SECRET = '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';

// Use "urn:ietf:wg:oauth:2.0:oob" replacement - redirect to localhost and extract code manually
const REDIRECT_URI = 'http://localhost:8080/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/adwords'];

async function main() {
  const authCode = process.argv[2];

  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  if (!authCode) {
    // Step 1: Show the authorization URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    console.log('');
    console.log('='.repeat(70));
    console.log('STEP 1: Open this URL in your browser and sign in:');
    console.log('='.repeat(70));
    console.log('');
    console.log(authUrl);
    console.log('');
    console.log('='.repeat(70));
    console.log('STEP 2: After you authorize, you will be redirected to a URL like:');
    console.log('='.repeat(70));
    console.log('');
    console.log('http://localhost:8080/oauth2callback?code=4/0XXXXXXX...&scope=...');
    console.log('');
    console.log('Copy the value after "code=" and before "&scope"');
    console.log('');
    console.log('='.repeat(70));
    console.log('STEP 3: Run this command with the code:');
    console.log('='.repeat(70));
    console.log('');
    console.log('npx ts-node scripts/get-refresh-token-manual.ts "YOUR_CODE_HERE"');
    console.log('');
  } else {
    // Step 2: Exchange the code for tokens
    console.log('');
    console.log('Exchanging authorization code for tokens...');
    console.log('');

    try {
      const { tokens } = await oauth2Client.getToken(authCode);

      console.log('='.repeat(70));
      console.log('SUCCESS! Here is your refresh token:');
      console.log('='.repeat(70));
      console.log('');
      console.log(tokens.refresh_token);
      console.log('');
      console.log('='.repeat(70));
      console.log('');
      console.log('Copy this token and I will update global-secrets.json for you.');
      console.log('');
    } catch (error: any) {
      console.error('Error exchanging code:', error.message);
      console.log('');
      console.log('Common issues:');
      console.log('- Code has already been used (codes are single-use)');
      console.log('- Code has expired (codes expire after a few minutes)');
      console.log('- Code was not copied correctly');
      console.log('');
      console.log('Please try again from Step 1.');
    }
  }
}

main();
