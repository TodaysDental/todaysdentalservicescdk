"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// connect-api/realtime-publisher.ts
var realtime_publisher_exports = {};
__export(realtime_publisher_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(realtime_publisher_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_client_connect2 = require("@aws-sdk/client-connect");

// connect-api/websocket.ts
var import_client_apigatewaymanagementapi = require("@aws-sdk/client-apigatewaymanagementapi");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_client_connect = require("@aws-sdk/client-connect");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var connectClient = new import_client_connect.ConnectClient({});
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "";
var CONNECT_INSTANCE_ARN = process.env.CONNECT_INSTANCE_ARN || "";
var REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
var USER_POOL_ID = process.env.USER_POOL_ID;
var ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : void 0;
async function sendToConnection(apiGateway, connectionId, message) {
  try {
    await apiGateway.send(new import_client_apigatewaymanagementapi.PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
  } catch (err) {
    console.error(`Failed to send message to ${connectionId}:`, err);
    if (err.statusCode === 410) {
      try {
        await dynamoClient.send(new import_client_dynamodb.DeleteItemCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId: { S: connectionId } }
        }));
        console.log(`Removed stale connection: ${connectionId}`);
      } catch (deleteErr) {
        console.error("Failed to remove stale connection:", deleteErr);
      }
    }
  }
}
async function broadcastToSubscribers(eventType, data, userEmail) {
  try {
    const scan = await dynamoClient.send(new import_client_dynamodb.ScanCommand({
      TableName: CONNECTIONS_TABLE,
      FilterExpression: userEmail ? "contains(subscriptions, :eventType) AND userEmail = :userEmail" : "contains(subscriptions, :eventType)",
      ExpressionAttributeValues: userEmail ? {
        ":eventType": { S: eventType },
        ":userEmail": { S: userEmail }
      } : {
        ":eventType": { S: eventType }
      }
    }));
    const connections = scan.Items || [];
    const promises = connections.map(async (item) => {
      const connectionId = item.connectionId?.S;
      const domain = item.domain?.S;
      const stage = item.stage?.S;
      if (!connectionId || !domain || !stage) return;
      const apiGateway = new import_client_apigatewaymanagementapi.ApiGatewayManagementApiClient({
        endpoint: `https://${domain}/${stage}`
      });
      await sendToConnection(apiGateway, connectionId, {
        type: eventType,
        data,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    await Promise.allSettled(promises);
  } catch (err) {
    console.error("Failed to broadcast to subscribers:", err);
  }
}

// connect-api/realtime-publisher.ts
var dynamoClient2 = new import_client_dynamodb2.DynamoDBClient({});
var connectClient2 = new import_client_connect2.ConnectClient({});
var CONNECTIONS_TABLE2 = process.env.CONNECTIONS_TABLE || "";
var AGENT_STATE_TABLE = process.env.AGENT_STATE_TABLE || "";
var CONNECT_INSTANCE_ARN2 = process.env.CONNECT_INSTANCE_ARN || "";
var handler = async (event) => {
  console.log("Real-time publisher triggered:", (/* @__PURE__ */ new Date()).toISOString());
  try {
    if (!CONNECT_INSTANCE_ARN2) {
      console.error("CONNECT_INSTANCE_ARN not configured");
      return;
    }
    const activeUsers = await getActiveUsers();
    console.log(`Monitoring ${activeUsers.length} active users`);
    const promises = activeUsers.map((userEmail) => processUserRealtime(userEmail));
    await Promise.allSettled(promises);
    console.log("Real-time publisher completed");
  } catch (err) {
    console.error("Real-time publisher error:", err);
  }
};
async function getActiveUsers() {
  try {
    const scan = await dynamoClient2.send(new import_client_dynamodb2.ScanCommand({
      TableName: CONNECTIONS_TABLE2,
      ProjectionExpression: "userEmail"
    }));
    const items = scan.Items || [];
    const users = items.map((item) => item.userEmail?.S).filter((email) => !!email);
    return [...new Set(users)];
  } catch (err) {
    console.error("Failed to get active users:", err);
    return [];
  }
}
async function processUserRealtime(userEmail) {
  try {
    const instanceId = arnTail(CONNECT_INSTANCE_ARN2);
    const userId = await getConnectUserIdByEmail(instanceId, userEmail);
    if (!userId) {
      console.warn(`Connect user not found for email: ${userEmail}`);
      return;
    }
    const currentData = await connectClient2.send(
      new import_client_connect2.GetCurrentUserDataCommand({
        InstanceId: instanceId,
        Filters: {
          Agents: [userId]
        }
      })
    );
    const records = currentData.UserDataList || [];
    const user = records[0];
    if (!user) {
      console.warn(`No user data found for userId: ${userId}`);
      return;
    }
    const currentAgentStatus = user.Status?.StatusName || "Unknown";
    const currentContacts = (user.Contacts || []).map((c) => ({
      contactId: c.ContactId,
      channel: c.Channel,
      initiationMethod: c.InitiationMethod,
      state: c.AgentContactState,
      queue: c.Queue,
      customerEndpoint: c.ConnectedToAgentTimestamp
      // CustomerEndpoint doesn't exist, using available field
    }));
    const previousState = await getPreviousAgentState(userEmail);
    const agentStatusChanged = !previousState || previousState.agentStatus !== currentAgentStatus;
    const contactChanges = detectContactChanges(previousState?.contacts || [], currentContacts);
    if (agentStatusChanged) {
      console.log(`Agent status changed for ${userEmail}: ${previousState?.agentStatus} -> ${currentAgentStatus}`);
      const agentEvent = {
        userEmail,
        agentStatus: currentAgentStatus,
        previousStatus: previousState?.agentStatus
      };
      await broadcastToSubscribers("agent", agentEvent, userEmail);
    }
    if (contactChanges.length > 0) {
      console.log(`Contact changes for ${userEmail}:`, contactChanges);
      for (const change of contactChanges) {
        await broadcastToSubscribers("contacts", change, userEmail);
      }
      await broadcastToSubscribers("contacts", { contacts: currentContacts }, userEmail);
    }
    await updateAgentState(userEmail, {
      userEmail,
      agentStatus: currentAgentStatus,
      contacts: currentContacts,
      lastUpdated: Date.now()
    });
  } catch (err) {
    console.error(`Failed to process realtime for user ${userEmail}:`, err);
  }
}
async function getPreviousAgentState(userEmail) {
  try {
    const response = await dynamoClient2.send(new import_client_dynamodb2.GetItemCommand({
      TableName: AGENT_STATE_TABLE,
      Key: {
        userEmail: { S: userEmail }
      }
    }));
    const item = response.Item;
    if (!item) return null;
    return {
      userEmail: item.userEmail?.S || "",
      agentStatus: item.agentStatus?.S || "",
      contacts: JSON.parse(item.contacts?.S || "[]"),
      lastUpdated: parseInt(item.lastUpdated?.N || "0")
    };
  } catch (err) {
    console.error(`Failed to get previous agent state for ${userEmail}:`, err);
    return null;
  }
}
async function updateAgentState(userEmail, state) {
  try {
    await dynamoClient2.send(new import_client_dynamodb2.PutItemCommand({
      TableName: AGENT_STATE_TABLE,
      Item: {
        userEmail: { S: state.userEmail },
        agentStatus: { S: state.agentStatus },
        contacts: { S: JSON.stringify(state.contacts) },
        lastUpdated: { N: state.lastUpdated.toString() }
      }
    }));
  } catch (err) {
    console.error(`Failed to update agent state for ${userEmail}:`, err);
  }
}
function detectContactChanges(previousContacts, currentContacts) {
  const changes = [];
  const prevMap = new Map(previousContacts.map((c) => [c.contactId, c]));
  const currentMap = new Map(currentContacts.map((c) => [c.contactId, c]));
  for (const [contactId, contact] of currentMap) {
    if (!prevMap.has(contactId)) {
      changes.push({
        contactId,
        state: contact.state,
        channel: contact.channel,
        previousState: void 0
      });
    } else {
      const prevContact = prevMap.get(contactId);
      if (prevContact.state !== contact.state) {
        changes.push({
          contactId,
          state: contact.state,
          channel: contact.channel,
          previousState: prevContact.state
        });
      }
    }
  }
  for (const [contactId, prevContact] of prevMap) {
    if (!currentMap.has(contactId)) {
      changes.push({
        contactId,
        state: "ended",
        channel: prevContact.channel,
        previousState: prevContact.state
      });
    }
  }
  return changes;
}
function arnTail(arn) {
  const parts = String(arn).split("/");
  return parts[parts.length - 1] || arn;
}
async function getConnectUserIdByEmail(instanceId, email) {
  try {
    const search = await connectClient2.send(
      new import_client_connect2.SearchUsersCommand({
        InstanceId: instanceId,
        SearchCriteria: {
          StringCondition: {
            FieldName: "identity_info.email",
            Value: email,
            ComparisonType: "EXACT"
          }
        },
        SearchFilter: {},
        MaxResults: 1
      })
    );
    const users = search?.Users || [];
    return users[0]?.Id;
  } catch {
    return void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
