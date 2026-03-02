import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt } from '../../shared/utils/permissions-helper';

const ddb = getDynamoDBClient();

const AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || '';

/**
 * GET /admin/agents/online
 *
 * Returns a list of agents that are currently marked as "active" (i.e., have
 * an entry in the AgentActive table with state = "active").
 *
 * Query parameters:
 *   - clinicId (optional): filter to a specific clinic
 *   - excludeOnCall (optional, bool): if "true", exclude agents currently on a call
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestOrigin = event.headers.origin || event.headers.Origin;
    const corsHeaders = await buildCorsHeadersAsync({}, requestOrigin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        // ── Auth ──────────────────────────────────────────────────────────
        const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            return {
                statusCode: verifyResult.code || 401,
                headers: corsHeaders,
                body: JSON.stringify({ message: verifyResult.message }),
            };
        }

        const callerAgentId = getUserIdFromJwt(verifyResult.payload!);
        if (!callerAgentId) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Unauthorized' }),
            };
        }

        // ── Query params ──────────────────────────────────────────────────
        const filterClinicId = event.queryStringParameters?.clinicId;
        const excludeOnCallRaw = event.queryStringParameters?.excludeOnCall;
        const excludeOnCall = excludeOnCallRaw === 'true' || excludeOnCallRaw === '1';

        // ── Query the AgentActive table ───────────────────────────────────
        // AgentActive PK = clinicId, SK = agentId. We need to scan or query by clinic.
        // If clinicId is provided, do a targeted query; otherwise scan all active entries.
        let activeItems: any[] = [];

        if (filterClinicId) {
            const result = await ddb.send(new QueryCommand({
                TableName: AGENT_ACTIVE_TABLE_NAME,
                KeyConditionExpression: 'clinicId = :clinicId',
                FilterExpression: '#state = :active',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: {
                    ':clinicId': filterClinicId,
                    ':active': 'active',
                },
                ProjectionExpression: 'agentId, clinicId, #state, updatedAt',
            }));
            activeItems = result.Items || [];
        } else {
            // No clinicId filter — pull caller's authorized clinics from JWT and query each
            const payload = verifyResult.payload as any;
            const authorizedClinicIds: string[] = payload.clinicIds || payload.authorizedClinics || [];

            if (authorizedClinicIds.length === 0) {
                // If no clinic context in token, return empty
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ agents: [], totalOnline: 0 }),
                };
            }

            // Query each clinic (fan-out, parallel). Limit to 20 clinics to avoid overloading.
            const clinicIds = authorizedClinicIds.slice(0, 20);
            const results = await Promise.allSettled(
                clinicIds.map((clinicId) =>
                    ddb.send(new QueryCommand({
                        TableName: AGENT_ACTIVE_TABLE_NAME,
                        KeyConditionExpression: 'clinicId = :clinicId',
                        FilterExpression: '#state = :active',
                        ExpressionAttributeNames: { '#state': 'state' },
                        ExpressionAttributeValues: {
                            ':clinicId': clinicId,
                            ':active': 'active',
                        },
                        ProjectionExpression: 'agentId, clinicId, #state, updatedAt',
                    }))
                )
            );

            for (const r of results) {
                if (r.status === 'fulfilled') {
                    activeItems.push(...(r.value.Items || []));
                }
            }
        }

        // ── De-duplicate agents (an agent may be active in multiple clinics) ─
        // Group by agentId, collect all their active clinicIds
        const agentMap = new Map<string, { agentId: string; activeClinicIds: string[]; updatedAt?: string }>();
        for (const item of activeItems) {
            const agentId = item.agentId as string;
            if (!agentId) continue;
            const existing = agentMap.get(agentId);
            if (existing) {
                existing.activeClinicIds.push(item.clinicId);
            } else {
                agentMap.set(agentId, {
                    agentId,
                    activeClinicIds: [item.clinicId],
                    updatedAt: item.updatedAt,
                });
            }
        }

        const uniqueAgentIds = Array.from(agentMap.keys());

        if (uniqueAgentIds.length === 0) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ agents: [], totalOnline: 0 }),
            };
        }

        // ── Enrich with staff profile (name/email) if table is configured ──
        const staffProfiles = new Map<string, { email?: string; givenName?: string; familyName?: string }>();
        if (STAFF_USER_TABLE) {
            try {
                // BatchGetItem supports up to 100 keys per call
                const batches: string[][] = [];
                for (let i = 0; i < uniqueAgentIds.length; i += 100) {
                    batches.push(uniqueAgentIds.slice(i, i + 100));
                }

                for (const batch of batches) {
                    const keys = batch.map((agentId) => ({ userId: agentId }));
                    const batchResult = await ddb.send(new BatchGetCommand({
                        RequestItems: {
                            [STAFF_USER_TABLE]: {
                                Keys: keys,
                                ProjectionExpression: 'userId, email, givenName, familyName',
                            },
                        },
                    }));

                    const items = batchResult.Responses?.[STAFF_USER_TABLE] || [];
                    for (const item of items) {
                        if (item.userId) {
                            staffProfiles.set(String(item.userId), {
                                email: item.email,
                                givenName: item.givenName,
                                familyName: item.familyName,
                            });
                        }
                    }
                }
            } catch (err) {
                // Non-fatal: if we can't enrich, just return raw agentIds
                console.warn('[get-online-agents] Could not enrich with staff profiles:', err);
            }
        }

        // ── Build the response list ────────────────────────────────────────
        const agents = uniqueAgentIds.map((agentId) => {
            const info = agentMap.get(agentId)!;
            const profile = staffProfiles.get(agentId);

            // Use email as agentId fallback for display
            const email = profile?.email || agentId;
            const firstName = profile?.givenName;
            const lastName = profile?.familyName;
            const name = firstName && lastName
                ? `${firstName} ${lastName}`
                : firstName || lastName || email.split('@')[0];

            return {
                agentId,
                email,
                name,
                firstName,
                lastName,
                status: 'Online',         // They're in the AgentActive table → online
                activeClinicIds: info.activeClinicIds,
                isAvailable: true,        // Active agents are available for transfers
                updatedAt: info.updatedAt,
            };
        });

        // Optional: if excludeOnCall is true, we'd need to cross-reference the
        // presence table. For now, all agents in AgentActive are available unless
        // you have a way to know they're on a call (future enhancement).
        const filtered = excludeOnCall
            ? agents.filter((a) => a.status !== 'On Call')
            : agents;

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                agents: filtered,
                totalOnline: filtered.length,
            }),
        };
    } catch (error) {
        console.error('[get-online-agents] Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Failed to fetch online agents',
                error: error instanceof Error ? error.message : 'Unknown',
            }),
        };
    }
};
