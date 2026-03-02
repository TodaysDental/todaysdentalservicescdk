/**
 * Team Service
 *
 * Shared helpers for team/group lookup used across multiple handlers.
 * Includes in-memory caching and batch operations.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env } from './db-clients';
import type { Team } from './types';

// In-memory team cache (2 min TTL — team metadata changes infrequently)
const _teamCache = new Map<string, { data: Team | undefined; expiry: number }>();
const TEAM_CACHE_TTL = 2 * 60 * 1000;

/**
 * Safely fetches a team by teamID using QueryCommand (cached 2 min).
 * Works whether the table has a simple PK or composite PK+SK.
 */
export async function getTeamByID(teamID: string): Promise<Team | undefined> {
    if (!env.TEAMS_TABLE) return undefined;

    const cached = _teamCache.get(teamID);
    if (cached && Date.now() < cached.expiry) return cached.data;

    const result = await ddb.send(new QueryCommand({
        TableName: env.TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    const team = (result.Items?.[0] as Team) || undefined;
    _teamCache.set(teamID, { data: team, expiry: Date.now() + TEAM_CACHE_TTL });
    return team;
}

/**
 * Batch-fetch multiple teams in parallel. Returns Map<teamID, Team | undefined>.
 * Uses the per-team cache, so repeated lookups within the same invocation are free.
 */
export async function batchGetTeams(teamIDs: string[]): Promise<Map<string, Team | undefined>> {
    const unique = [...new Set(teamIDs)];
    const results = await Promise.all(
        unique.map(tid => getTeamByID(tid).then(team => [tid, team] as const).catch(() => [tid, undefined] as const)),
    );
    return new Map(results);
}

/**
 * Invalidate a team's cache entry (call after team mutation).
 */
export function invalidateTeamCache(teamID: string): void {
    _teamCache.delete(teamID);
}

/**
 * Normalizes team members to a string array.
 * Handles cases where members might be a DynamoDB Set or undefined.
 */
export function normalizeMembers(members: unknown): string[] {
    if (!members) return [];
    if (Array.isArray(members)) return members.filter((m): m is string => typeof m === 'string');
    if (members instanceof Set) return Array.from(members) as string[];
    return [];
}

// In-memory cache for user team IDs (1 min TTL)
const _userTeamsCache = new Map<string, { data: string[]; expiry: number }>();
const USER_TEAMS_CACHE_TTL = 60_000;

/**
 * Fast team ID lookup via the denormalized UserTeams table (cached 1 min).
 * Falls back to scanning the Teams table if UserTeams table is not configured,
 * with a warning log since the scan path should be eliminated.
 */
export async function getUserTeamIDsFast(userID: string): Promise<string[]> {
    const cached = _userTeamsCache.get(userID);
    if (cached && Date.now() < cached.expiry) return cached.data;

    let teamIDs: string[];

    if (env.USER_TEAMS_TABLE) {
        const result = await ddb.send(new QueryCommand({
            TableName: env.USER_TEAMS_TABLE,
            KeyConditionExpression: 'userID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ProjectionExpression: 'teamID',
        }));
        teamIDs = (result.Items || []).map((item: any) => item.teamID as string);
    } else if (env.TEAMS_TABLE) {
        console.warn('[PERF] USER_TEAMS_TABLE not configured — falling back to Teams table scan. Configure USER_TEAMS_TABLE to eliminate this.');
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        const result = await ddb.send(new ScanCommand({
            TableName: env.TEAMS_TABLE,
            FilterExpression: 'contains(members, :uid)',
            ExpressionAttributeValues: { ':uid': userID },
            ProjectionExpression: 'teamID',
        }));
        teamIDs = (result.Items || []).map((item: any) => item.teamID as string);
    } else {
        teamIDs = [];
    }

    _userTeamsCache.set(userID, { data: teamIDs, expiry: Date.now() + USER_TEAMS_CACHE_TTL });
    return teamIDs;
}

/**
 * Syncs the UserTeams denormalized table when team membership changes.
 * Call this whenever members are added/removed from a team.
 */
export async function syncUserTeamsMembership(
    teamID: string,
    members: string[],
    previousMembers?: string[],
): Promise<void> {
    if (!env.USER_TEAMS_TABLE) return;

    const { PutCommand, DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    const nowIso = new Date().toISOString();

    const adds = previousMembers
        ? members.filter(m => !previousMembers.includes(m))
        : members;
    const removes = previousMembers
        ? previousMembers.filter(m => !members.includes(m))
        : [];

    const ops: Promise<any>[] = [];

    for (const userID of adds) {
        ops.push(ddb.send(new PutCommand({
            TableName: env.USER_TEAMS_TABLE,
            Item: { userID, teamID, joinedAt: nowIso },
        })));
    }

    for (const userID of removes) {
        ops.push(ddb.send(new DeleteCommand({
            TableName: env.USER_TEAMS_TABLE,
            Key: { userID, teamID },
        })));
    }

    await Promise.all(ops);
}
