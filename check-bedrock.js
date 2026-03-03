// Check the actual inline policies attached to the BedrockAgentRole
// Uses AWS SDK's STS from the runtime (available as transitive dep)
const https = require('https');

async function main() {
  const region = 'us-east-1';
  const roleName = 'TodaysDentalInsightsAiAgentsN1-BedrockAgentRole';
  
  // Use the BedrockAgentRuntimeClient to test InvokeAgent directly
  // this tests from the Lambda's perspective
  const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
  
  console.log('=== TEST INVOKING AGENT GL60VB0RMQ ===');
  const client = new BedrockAgentRuntimeClient({ region });
  
  try {
    const resp = await client.send(new InvokeAgentCommand({
      agentId: 'GL60VB0RMQ',
      agentAliasId: '1INRPJGQSM',
      sessionId: 'diag-test-' + Date.now(),
      inputText: 'say hi',
      enableTrace: false,
    }));
    
    let fullText = '';
    if (resp.completion) {
      for await (const event of resp.completion) {
        if (event.chunk?.bytes) {
          fullText += new TextDecoder().decode(event.chunk.bytes);
        }
      }
    }
    console.log('SUCCESS! Response:', fullText.substring(0, 200));
  } catch (e) {
    console.log('ERROR:', e.name);
    console.log('Message:', e.message?.substring(0, 500));
    if (e.$metadata) console.log('HTTP Status:', e.$metadata.httpStatusCode);
  }
}
main().catch(e => console.error('FATAL:', e.message));
