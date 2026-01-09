/**
 * Email Template Wrapper Utility
 * 
 * Wraps email content with proper branding, unsubscribe links, and disclaimers
 * to comply with AWS SES best practices and email regulations (CAN-SPAM, GDPR, CASL).
 * 
 * Required elements:
 * 1. Clear sender identification (clinic name, logo, address)
 * 2. Working unsubscribe link (SES subscription management)
 * 3. Disclaimer explaining why recipient is receiving the email
 * 4. Physical mailing address
 */

import { getClinicConfig, ClinicConfig } from './secrets-helper';

/**
 * Email branding configuration
 */
export interface EmailBrandingConfig {
  clinicId: string;
  clinicName: string;
  clinicEmail: string;
  clinicPhone: string;
  clinicAddress: string;
  clinicCity: string;
  clinicState: string;
  clinicZip: string;
  logoUrl: string;
  websiteUrl: string;
  unsubscribeUrl?: string; // SES generates this, but can be overridden
}

/**
 * Get branding configuration for a clinic
 */
export async function getClinicBranding(clinicId: string): Promise<EmailBrandingConfig | null> {
  const config = await getClinicConfig(clinicId);
  if (!config) return null;

  return {
    clinicId,
    clinicName: config.clinicName || 'Today\'s Dental',
    clinicEmail: config.clinicEmail || '',
    clinicPhone: config.clinicPhone || config.phoneNumber || '',
    clinicAddress: config.clinicAddress || '',
    clinicCity: config.clinicCity || '',
    clinicState: config.clinicState || '',
    clinicZip: config.clinicZipCode || '',
    logoUrl: config.logoUrl || 'https://assets.todaysdentalinsights.com/logos/todays-dental-logo.png',
    websiteUrl: config.websiteLink || 'https://todaysdentalinsights.com',
  };
}

/**
 * Format a full physical address for CAN-SPAM compliance
 */
function formatPhysicalAddress(branding: EmailBrandingConfig): string {
  const parts = [
    branding.clinicAddress,
    branding.clinicCity,
    branding.clinicState,
    branding.clinicZip,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Generate the email header with clinic branding
 */
function generateEmailHeader(branding: EmailBrandingConfig): string {
  return `
    <div style="background-color: #f8f9fa; padding: 20px 0; text-align: center;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center">
            <img src="${branding.logoUrl}" alt="${branding.clinicName}" 
                 style="max-width: 200px; max-height: 80px; display: block;" />
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top: 10px;">
            <span style="font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; color: #2c3e50;">
              ${branding.clinicName}
            </span>
          </td>
        </tr>
      </table>
    </div>
  `;
}

/**
 * Generate the email footer with unsubscribe link, disclaimer, and physical address
 * Uses SES's {{amazonSESUnsubscribeUrl}} placeholder for one-click unsubscribe
 */
function generateEmailFooter(branding: EmailBrandingConfig, patientName?: string): string {
  const physicalAddress = formatPhysicalAddress(branding);
  const recipientName = patientName || 'Valued Patient';
  
  // Use SES's built-in unsubscribe URL placeholder
  // This is replaced by SES when subscription management is enabled
  const unsubscribeUrl = branding.unsubscribeUrl || '{{amazonSESUnsubscribeUrl}}';
  
  return `
    <div style="background-color: #f8f9fa; padding: 30px 20px; margin-top: 30px; border-top: 1px solid #e9ecef;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; margin: 0 auto;">
        <!-- Contact Information -->
        <tr>
          <td align="center" style="padding-bottom: 20px;">
            <p style="font-family: Arial, sans-serif; font-size: 14px; color: #495057; margin: 0;">
              <strong>${branding.clinicName}</strong><br />
              ${physicalAddress}<br />
              Phone: ${branding.clinicPhone}<br />
              <a href="mailto:${branding.clinicEmail}" style="color: #007bff; text-decoration: none;">${branding.clinicEmail}</a>
            </p>
          </td>
        </tr>
        
        <!-- Why You Received This Email (Disclaimer) -->
        <tr>
          <td align="center" style="padding-bottom: 20px;">
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #6c757d; margin: 0; line-height: 1.6;">
              <strong>Why am I receiving this email?</strong><br />
              You are receiving this email because you are a patient of ${branding.clinicName}. 
              This message contains important information about your dental care, appointments, 
              or account. We are committed to keeping you informed about your oral health.
            </p>
          </td>
        </tr>
        
        <!-- Unsubscribe Link -->
        <tr>
          <td align="center" style="padding-bottom: 15px;">
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #6c757d; margin: 0;">
              If you no longer wish to receive these emails, you can 
              <a href="${unsubscribeUrl}" style="color: #007bff; text-decoration: underline;">unsubscribe here</a>.
            </p>
          </td>
        </tr>
        
        <!-- Copyright and Compliance -->
        <tr>
          <td align="center">
            <p style="font-family: Arial, sans-serif; font-size: 11px; color: #adb5bd; margin: 0;">
              © ${new Date().getFullYear()} ${branding.clinicName}. All rights reserved.<br />
              This email was sent to you as a patient communication from ${branding.clinicName}.
            </p>
          </td>
        </tr>
      </table>
    </div>
  `;
}

/**
 * Wrap email content with branding, header, footer, and unsubscribe functionality
 * 
 * @param htmlBody - The original HTML email body
 * @param branding - Clinic branding configuration
 * @param patientName - Optional patient name for personalization
 * @returns Wrapped HTML email with all required compliance elements
 */
export function wrapEmailWithBranding(
  htmlBody: string,
  branding: EmailBrandingConfig,
  patientName?: string
): string {
  const header = generateEmailHeader(branding);
  const footer = generateEmailFooter(branding, patientName);
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Email from ${branding.clinicName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset styles for email clients */
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; }
    
    /* Mobile responsive */
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .content-padding { padding: 15px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center">
        <table role="presentation" class="email-container" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; margin: 0 auto;">
          <!-- Header with Logo and Clinic Name -->
          <tr>
            <td>
              ${header}
            </td>
          </tr>
          
          <!-- Main Email Content -->
          <tr>
            <td class="content-padding" style="padding: 30px 20px; background-color: #ffffff;">
              ${htmlBody}
            </td>
          </tr>
          
          <!-- Footer with Disclaimer, Unsubscribe, and Physical Address -->
          <tr>
            <td>
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate a plain text version of the email with unsubscribe and disclaimer
 */
export function wrapTextEmailWithBranding(
  textBody: string,
  branding: EmailBrandingConfig,
  patientName?: string
): string {
  const physicalAddress = formatPhysicalAddress(branding);
  const unsubscribeUrl = branding.unsubscribeUrl || '{{amazonSESUnsubscribeUrl}}';
  
  return `
${branding.clinicName}
${'='.repeat(branding.clinicName.length)}

${textBody}

---

CONTACT US
${branding.clinicName}
${physicalAddress}
Phone: ${branding.clinicPhone}
Email: ${branding.clinicEmail}
Website: ${branding.websiteUrl}

---

WHY AM I RECEIVING THIS EMAIL?
You are receiving this email because you are a patient of ${branding.clinicName}. 
This message contains important information about your dental care, appointments, or account.

To unsubscribe from these emails, visit: ${unsubscribeUrl}

© ${new Date().getFullYear()} ${branding.clinicName}. All rights reserved.
  `.trim();
}

/**
 * Check if email content already has proper branding/wrapper
 * Helps avoid double-wrapping
 */
export function hasEmailBranding(htmlBody: string): boolean {
  // Check for common markers that indicate the email is already wrapped
  return (
    htmlBody.includes('amazonSESUnsubscribeUrl') ||
    htmlBody.includes('Why am I receiving this email') ||
    htmlBody.includes('unsubscribe here') ||
    htmlBody.includes('<!DOCTYPE html>')
  );
}

/**
 * Ensure email has branding - wraps if needed, returns as-is if already wrapped
 */
export async function ensureEmailBranding(
  htmlBody: string,
  clinicId: string,
  patientName?: string
): Promise<{ html: string; text: string }> {
  const branding = await getClinicBranding(clinicId);
  
  if (!branding) {
    console.warn(`[EmailWrapper] No branding found for clinic: ${clinicId}`);
    return { 
      html: htmlBody, 
      text: htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() 
    };
  }
  
  // If already branded, return as-is
  if (hasEmailBranding(htmlBody)) {
    return { 
      html: htmlBody, 
      text: htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() 
    };
  }
  
  // Wrap with branding
  const wrappedHtml = wrapEmailWithBranding(htmlBody, branding, patientName);
  const wrappedText = wrapTextEmailWithBranding(
    htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    branding,
    patientName
  );
  
  return { html: wrappedHtml, text: wrappedText };
}
