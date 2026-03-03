/**
 * email-ai-handler.ts
 *
 * Lambda handler for AI-powered email response generation using AWS Bedrock.
 * Invoked when staff requests an AI-drafted reply to a patient email.
 *
 * Input event:
 *   { emailBody: string; subject: string; clinicName?: string }
 *
 * Output:
 *   { suggestedReply: string }
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

export const handler = async (event: {
    emailBody?: string;
    subject?: string;
    clinicName?: string;
    [key: string]: unknown;
}): Promise<{ suggestedReply: string }> => {
    const { emailBody = '', subject = '', clinicName = "Today's Dental" } = event;

    if (!emailBody) {
        return { suggestedReply: '' };
    }

    const systemPrompt = `You are a helpful dental clinic receptionist for ${clinicName}. 
Your job is to draft professional, warm, and concise email replies to patient inquiries.
Keep replies friendly, under 200 words, and avoid making specific clinical recommendations.
For appointment requests, direct them to call or use the online booking system.`;

    const userMessage = `Please draft a reply to this patient email:

Subject: ${subject}

${emailBody}

Draft a professional and friendly reply:`;

    const body = JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
    });

    const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: Buffer.from(body),
    });

    const response = await bedrock.send(command);
    const parsed = JSON.parse(Buffer.from(response.body).toString('utf-8'));
    const suggestedReply: string = parsed?.content?.[0]?.text ?? '';

    return { suggestedReply };
};
