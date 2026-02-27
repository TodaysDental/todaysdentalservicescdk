/**
 * Design Editor Templates – CRUD Lambda
 *
 * Endpoints:
 *   POST   /templates              – Create or update a template
 *   GET    /templates              – List all templates (paginated)
 *   GET    /templates/{templateId} – Get full template data (inc. canvas JSON)
 *   DELETE /templates/{templateId} – Delete a template
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    DeleteCommand,
    ScanCommand,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

const TEMPLATES_TABLE = process.env.DESIGN_TEMPLATES_TABLE!;
const MEDIA_BUCKET = process.env.MEDIA_BUCKET!;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const corsHeaders = await buildCorsHeadersAsync({
        allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'],
    }, event.headers?.origin || event.headers?.Origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        const path = event.path;
        const method = event.httpMethod;

        // -------------------------------------------------------------------
        // POST /templates – Create or update a template
        // -------------------------------------------------------------------
        if (path.endsWith('/templates') && method === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const {
                templateId: existingId,
                name,
                category,
                tags,
                canvasWidth,
                canvasHeight,
                pages,
                currentPageIndex,
                postCaption,
                thumbnailDataUrl,
            } = body;

            if (!name || !pages || !Array.isArray(pages) || pages.length === 0) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: false,
                        error: 'name and pages are required',
                    }),
                };
            }

            const isUpdate = !!existingId;
            const templateId = existingId || uuidv4();
            const createdBy =
                event.requestContext.authorizer?.email || 'unknown';
            const now = new Date().toISOString();

            // Build the full save payload (same shape as localStorage)
            const saveData = {
                version: 1,
                designName: name,
                canvasWidth: canvasWidth || 1080,
                canvasHeight: canvasHeight || 1080,
                pages,
                currentPageIndex: currentPageIndex ?? 0,
                postCaption: postCaption || '',
                savedAt: now,
            };

            // Store canvas data JSON in S3
            const s3DataKey = `templates/${templateId}/data.json`;
            await s3.send(
                new PutObjectCommand({
                    Bucket: MEDIA_BUCKET,
                    Key: s3DataKey,
                    Body: JSON.stringify(saveData),
                    ContentType: 'application/json',
                })
            );

            // Optionally store thumbnail image in S3
            let thumbnailUrl = '';
            if (thumbnailDataUrl && typeof thumbnailDataUrl === 'string' && thumbnailDataUrl.startsWith('data:')) {
                const matches = thumbnailDataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                    const contentType = matches[1];
                    const buffer = Buffer.from(matches[2], 'base64');
                    const ext = contentType.includes('png') ? 'png' : 'jpg';
                    const thumbKey = `templates/${templateId}/thumbnail.${ext}`;
                    await s3.send(
                        new PutObjectCommand({
                            Bucket: MEDIA_BUCKET,
                            Key: thumbKey,
                            Body: buffer,
                            ContentType: contentType,
                        })
                    );
                    thumbnailUrl = `https://${MEDIA_BUCKET}.s3.amazonaws.com/${thumbKey}`;
                }
            }

            // If it's the first page thumbnail from the pages array, fall back to it
            if (!thumbnailUrl && pages[0]?.thumbnail) {
                // We'll just use the inline thumbnail; it's base64 encoded already in the client
                thumbnailUrl = ''; // Keep empty – frontend falls back to the page thumbnail in the data
            }

            // Write / overwrite DynamoDB record
            const item: Record<string, any> = {
                templateId,
                name,
                category: category || 'uncategorized',
                thumbnailUrl,
                s3DataKey,
                canvasWidth: canvasWidth || 1080,
                canvasHeight: canvasHeight || 1080,
                pageCount: pages.length,
                createdBy,
                updatedAt: now,
                tags: tags || [],
            };
            if (!isUpdate) {
                item.createdAt = now;
            }

            // For updates, preserve the original createdAt
            if (isUpdate) {
                const existing = await ddb.send(
                    new GetCommand({
                        TableName: TEMPLATES_TABLE,
                        Key: { templateId },
                    })
                );
                if (existing.Item) {
                    item.createdAt = existing.Item.createdAt;
                    // Preserve original creator
                    item.createdBy = existing.Item.createdBy || createdBy;
                } else {
                    item.createdAt = now;
                }
            }

            await ddb.send(
                new PutCommand({ TableName: TEMPLATES_TABLE, Item: item })
            );

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    message: isUpdate
                        ? 'Template updated successfully'
                        : 'Template created successfully',
                    template: item,
                }),
            };
        }

        // -------------------------------------------------------------------
        // GET /templates – List all templates (paginated)
        // -------------------------------------------------------------------
        if (
            (path.endsWith('/templates') || path.endsWith('/templates/')) &&
            method === 'GET' &&
            !event.pathParameters?.templateId
        ) {
            const limit = parseInt(
                event.queryStringParameters?.limit || '50'
            );
            const nextToken = event.queryStringParameters?.nextToken;
            const category = event.queryStringParameters?.category;
            const search = event.queryStringParameters?.search;

            const scanParams: any = {
                TableName: TEMPLATES_TABLE,
                Limit: limit,
            };

            const filterConditions: string[] = [];
            const exprValues: Record<string, any> = {};
            const exprNames: Record<string, string> = {};

            if (category) {
                filterConditions.push('category = :cat');
                exprValues[':cat'] = category;
            }

            if (search) {
                filterConditions.push('contains(#n, :search)');
                exprValues[':search'] = search.toLowerCase();
                exprNames['#n'] = 'name';
            }

            if (filterConditions.length > 0) {
                scanParams.FilterExpression = filterConditions.join(' AND ');
                scanParams.ExpressionAttributeValues = exprValues;
                if (Object.keys(exprNames).length > 0) {
                    scanParams.ExpressionAttributeNames = exprNames;
                }
            }

            if (nextToken) {
                scanParams.ExclusiveStartKey = JSON.parse(
                    Buffer.from(nextToken, 'base64').toString()
                );
            }

            const scanRes = await ddb.send(new ScanCommand(scanParams));
            const templates = (scanRes.Items || []).sort(
                (a, b) =>
                    new Date(b.updatedAt || b.createdAt).getTime() -
                    new Date(a.updatedAt || a.createdAt).getTime()
            );

            let paginationToken = null;
            if (scanRes.LastEvaluatedKey) {
                paginationToken = Buffer.from(
                    JSON.stringify(scanRes.LastEvaluatedKey)
                ).toString('base64');
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    templates: templates.map((t) => ({
                        templateId: t.templateId,
                        name: t.name,
                        category: t.category,
                        thumbnailUrl: t.thumbnailUrl,
                        canvasWidth: t.canvasWidth,
                        canvasHeight: t.canvasHeight,
                        pageCount: t.pageCount,
                        createdBy: t.createdBy,
                        createdAt: t.createdAt,
                        updatedAt: t.updatedAt,
                        tags: t.tags,
                    })),
                    pagination: {
                        limit,
                        hasMore: !!paginationToken,
                        nextToken: paginationToken,
                    },
                }),
            };
        }

        // -------------------------------------------------------------------
        // GET /templates/{templateId} – Get full template (inc. canvas JSON)
        // -------------------------------------------------------------------
        if (event.pathParameters?.templateId && method === 'GET') {
            const templateId = event.pathParameters.templateId;

            const record = await ddb.send(
                new GetCommand({
                    TableName: TEMPLATES_TABLE,
                    Key: { templateId },
                })
            );

            if (!record.Item) {
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: false,
                        error: 'Template not found',
                    }),
                };
            }

            // Fetch canvas data from S3
            let designData: any = null;
            try {
                const obj = await s3.send(
                    new GetObjectCommand({
                        Bucket: MEDIA_BUCKET,
                        Key: record.Item.s3DataKey,
                    })
                );
                const bodyStr = await obj.Body?.transformToString('utf-8');
                designData = bodyStr ? JSON.parse(bodyStr) : null;
            } catch (err) {
                console.warn('Failed to read template data from S3:', err);
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    template: {
                        ...record.Item,
                        designData,
                    },
                }),
            };
        }

        // -------------------------------------------------------------------
        // DELETE /templates/{templateId}
        // -------------------------------------------------------------------
        if (event.pathParameters?.templateId && method === 'DELETE') {
            const templateId = event.pathParameters.templateId;

            const record = await ddb.send(
                new GetCommand({
                    TableName: TEMPLATES_TABLE,
                    Key: { templateId },
                })
            );

            if (!record.Item) {
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: false,
                        error: 'Template not found',
                    }),
                };
            }

            // Delete S3 objects (data + thumbnail)
            const keysToDelete = [record.Item.s3DataKey];
            if (record.Item.thumbnailUrl) {
                // Extract S3 key from URL
                const urlParts = record.Item.thumbnailUrl.split('.s3.amazonaws.com/');
                if (urlParts[1]) keysToDelete.push(urlParts[1]);
            }

            for (const key of keysToDelete) {
                try {
                    await s3.send(
                        new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key })
                    );
                } catch (err) {
                    console.warn('S3 delete error for key', key, err);
                }
            }

            // Delete DynamoDB record
            await ddb.send(
                new DeleteCommand({
                    TableName: TEMPLATES_TABLE,
                    Key: { templateId },
                })
            );

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    message: 'Template deleted successfully',
                    templateId,
                }),
            };
        }

        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Route not found' }),
        };
    } catch (err: any) {
        console.error('Templates Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: err.message }),
        };
    }
};
