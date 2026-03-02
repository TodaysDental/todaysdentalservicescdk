/**
 * Connection Service
 *
 * Centralized helpers for looking up WebSocket connections.
 * Extracted from ws-default.ts to eliminate duplication across handlers.
 *
 * Includes short-lived in-memory caches to avoid redundant DynamoDB reads
 * within the same Lambda invocation (connections rarely change mid-request).
 */

import { GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env } from './db-clients';
import { createLogger } from './logger';
import type { SenderInfo, ConnectionRecord } from './types';

const log = createLogger('connection-service');

// ── In-memory caches (per Lambda invocation, short TTL) ─────────────
const CACHE_TTL_MS = 60_000; // 60 s — connections are very stable within a Lambda invocation

interface CacheEntry<T> { data: T; expiry: number; }

const _senderInfoCache = new Map<string, CacheEntry<SenderInfo | undefined>>();
const _connectionsByUserCache = new Map<string, CacheEntry<SenderInfo[]>>();
const _connectionRecordsByUserCache = new Map<string, CacheEntry<ConnectionRecord[]>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (entry && Date.now() < entry.expiry) return entry.data;
    cache.delete(key);
    return undefined;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
    cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

/**
 * Invalidate all caches for a given connectionId/userID (call on disconnect / stale).
 */
export function invalidateConnectionCache(connectionId?: string, userID?: string): void {
    if (connectionId) _senderInfoCache.delete(connectionId);
    if (userID) {
        _connectionsByUserCache.delete(userID);
        _connectionRecordsByUserCache.delete(userID);
    }
}

/**
 * Retrieves sender info (userID + connectionId) for a given connectionId.
 */
export async function getSenderInfo(connectionId: string): Promise<SenderInfo | undefined> {
    const cached = getCached(_senderInfoCache, connectionId);
    if (cached !== undefined) return cached;

    const result = await ddb.send(new GetCommand({
        TableName: env.CONNECTIONS_TABLE,
        Key: { connectionId },
    }));
    const item = result.Item;
    const info = item ? { connectionId: item.connectionId, userID: item.userID } as SenderInfo : undefined;
    setCache(_senderInfoCache, connectionId, info);
    return info;
}

/**
 * Retrieves all active connections for a User ID via the UserIDIndexV2 GSI.
 */
export async function getConnectionsByUserID(userID: string): Promise<SenderInfo[]> {
    const cached = getCached(_connectionsByUserCache, userID);
    if (cached) return cached;

    const result = await ddb.send(new QueryCommand({
        TableName: env.CONNECTIONS_TABLE,
        IndexName: 'UserIDIndexV2',
        KeyConditionExpression: 'userID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
    }));

    const infos = (result.Items || [])
        .map((item: any) => ({
            connectionId: item?.connectionId,
            userID: item?.userID,
        }))
        .filter((x: any): x is SenderInfo =>
            typeof x.connectionId === 'string' && typeof x.userID === 'string',
        );
    setCache(_connectionsByUserCache, userID, infos);
    return infos;
}

/**
 * Batch-fetch connections for multiple users in parallel.
 * Returns a Map<userID, SenderInfo[]>.
 */
export async function batchGetConnectionsByUserIDs(userIDs: string[]): Promise<Map<string, SenderInfo[]>> {
    const unique = [...new Set(userIDs)];
    const results = await Promise.all(unique.map(uid => getConnectionsByUserID(uid).then(conns => [uid, conns] as const)));
    return new Map(results);
}

/**
 * Retrieves a single connection for a user (first one found).
 */
export async function getOneConnectionForUser(userID: string): Promise<SenderInfo | undefined> {
    const all = await getConnectionsByUserID(userID);
    return all[0];
}

/**
 * Retrieves a single connectionId for a user (convenience for broadcast).
 */
export async function getConnectionIdForUser(userID: string): Promise<string | null> {
    const info = await getOneConnectionForUser(userID);
    return info?.connectionId ?? null;
}

/**
 * Batch-fetch one connectionId per user for a list of userIDs (parallel).
 * Returns Map<userID, connectionId | null>.
 */
export async function batchGetConnectionIdForUsers(userIDs: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIDs)];
    const results = await Promise.all(
        unique.map(uid => getConnectionIdForUser(uid).then(cid => [uid, cid] as const)),
    );
    return new Map(results);
}

/**
 * Retrieves full connection records (incl. deviceId/client) for a User ID.
 * With UserIDIndex projection=ALL, all fields are returned directly from the GSI
 * — no secondary GetCommand/BatchGetCommand needed.
 */
export async function getConnectionRecordsByUserID(userID: string): Promise<ConnectionRecord[]> {
    const cached = getCached(_connectionRecordsByUserCache, userID);
    if (cached) return cached;

    const result = await ddb.send(new QueryCommand({
        TableName: env.CONNECTIONS_TABLE,
        IndexName: 'UserIDIndexV2',
        KeyConditionExpression: 'userID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
    }));

    const records = (result.Items || [])
        .map((item: any) => ({
            connectionId: item?.connectionId,
            userID: item?.userID,
            deviceId: typeof item?.deviceId === 'string' ? item.deviceId : undefined,
            client: typeof item?.client === 'string' ? item.client : undefined,
        }))
        .filter((x: any): x is ConnectionRecord =>
            typeof x.connectionId === 'string' && typeof x.userID === 'string',
        );
    setCache(_connectionRecordsByUserCache, userID, records);
    return records;
}

/**
 * Removes a stale connection from DynamoDB and invalidates caches.
 */
export async function removeConnection(connectionId: string): Promise<void> {
    try {
        const info = _senderInfoCache.get(connectionId)?.data;
        invalidateConnectionCache(connectionId, info?.userID);
        await ddb.send(new DeleteCommand({
            TableName: env.CONNECTIONS_TABLE,
            Key: { connectionId },
        }));
    } catch (e) {
        log.warn('Failed to remove stale connection', { connectionId }, e as Error);
    }
}
