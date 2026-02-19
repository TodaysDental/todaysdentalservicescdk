var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/shared/utils/secrets-helper.ts
var secrets_helper_exports = {};
__export(secrets_helper_exports, {
  clearAllCaches: () => clearAllCaches,
  clearClinicCache: () => clearClinicCache,
  clearGlobalSecretCache: () => clearGlobalSecretCache,
  getAllClinicConfigs: () => getAllClinicConfigs,
  getAllClinicSecrets: () => getAllClinicSecrets,
  getAyrshareApiKey: () => getAyrshareApiKey,
  getAyrshareDomain: () => getAyrshareDomain,
  getAyrsharePrivateKey: () => getAyrsharePrivateKey,
  getClinicConfig: () => getClinicConfig,
  getClinicConfigsByState: () => getClinicConfigsByState,
  getClinicIds: () => getClinicIds,
  getClinicSecret: () => getClinicSecret,
  getClinicSecrets: () => getClinicSecrets,
  getCpanelCredentials: () => getCpanelCredentials,
  getFCMCredentials: () => getFCMCredentials,
  getFullClinicData: () => getFullClinicData,
  getGlobalSecret: () => getGlobalSecret,
  getGlobalSecretEntry: () => getGlobalSecretEntry,
  getGlobalSecretsByType: () => getGlobalSecretsByType,
  getGmailOAuthCredentials: () => getGmailOAuthCredentials,
  getOdooApiKey: () => getOdooApiKey,
  getOdooConfig: () => getOdooConfig,
  getTwilioCredentials: () => getTwilioCredentials
});
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new DynamoDB({});
  }
  return dynamoClient;
}
function isCacheValid(entry) {
  return entry !== void 0 && entry.expiresAt > Date.now();
}
function setCacheEntry(cache, key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}
async function getClinicSecrets(clinicId) {
  const cached = clinicSecretsCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_SECRETS_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No secrets found for clinic: ${clinicId}`);
      return null;
    }
    const secrets = unmarshall(response.Item);
    setCacheEntry(clinicSecretsCache, clinicId, secrets);
    return secrets;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic secrets for ${clinicId}:`, error);
    throw error;
  }
}
async function getClinicSecret(clinicId, secretName) {
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) {
    return null;
  }
  return secrets[secretName] || null;
}
async function getAllClinicSecrets() {
  try {
    const response = await getDynamoClient().scan({
      TableName: CLINIC_SECRETS_TABLE
    });
    if (!response.Items) {
      return [];
    }
    const secrets = response.Items.map((item) => unmarshall(item));
    secrets.forEach((secret) => {
      setCacheEntry(clinicSecretsCache, secret.clinicId, secret);
    });
    return secrets;
  } catch (error) {
    console.error("[SecretsHelper] Error fetching all clinic secrets:", error);
    throw error;
  }
}
async function getGlobalSecret(secretId, secretType) {
  const cacheKey = `${secretId}#${secretType}`;
  const cached = globalSecretsCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: GLOBAL_SECRETS_TABLE,
      Key: {
        secretId: { S: secretId },
        secretType: { S: secretType }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No global secret found: ${secretId}/${secretType}`);
      return null;
    }
    const entry = unmarshall(response.Item);
    setCacheEntry(globalSecretsCache, cacheKey, entry.value);
    return entry.value;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secret ${secretId}/${secretType}:`, error);
    throw error;
  }
}
async function getGlobalSecretEntry(secretId, secretType) {
  try {
    const response = await getDynamoClient().getItem({
      TableName: GLOBAL_SECRETS_TABLE,
      Key: {
        secretId: { S: secretId },
        secretType: { S: secretType }
      }
    });
    if (!response.Item) {
      return null;
    }
    return unmarshall(response.Item);
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secret entry ${secretId}/${secretType}:`, error);
    throw error;
  }
}
async function getGlobalSecretsByType(secretId) {
  try {
    const response = await getDynamoClient().query({
      TableName: GLOBAL_SECRETS_TABLE,
      KeyConditionExpression: "secretId = :sid",
      ExpressionAttributeValues: {
        ":sid": { S: secretId }
      }
    });
    if (!response.Items) {
      return [];
    }
    return response.Items.map((item) => unmarshall(item));
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secrets for ${secretId}:`, error);
    throw error;
  }
}
async function getClinicConfig(clinicId) {
  const cached = clinicConfigCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No config found for clinic: ${clinicId}`);
      return null;
    }
    const config = unmarshall(response.Item);
    setCacheEntry(clinicConfigCache, clinicId, config);
    return config;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic config for ${clinicId}:`, error);
    throw error;
  }
}
async function getAllClinicConfigs() {
  try {
    const response = await getDynamoClient().scan({
      TableName: CLINIC_CONFIG_TABLE
    });
    if (!response.Items) {
      return [];
    }
    const configs = response.Items.map((item) => unmarshall(item));
    configs.forEach((config) => {
      setCacheEntry(clinicConfigCache, config.clinicId, config);
    });
    return configs;
  } catch (error) {
    console.error("[SecretsHelper] Error fetching all clinic configs:", error);
    throw error;
  }
}
async function getClinicConfigsByState(state) {
  try {
    const response = await getDynamoClient().query({
      TableName: CLINIC_CONFIG_TABLE,
      IndexName: "byState",
      KeyConditionExpression: "clinicState = :state",
      ExpressionAttributeValues: {
        ":state": { S: state }
      }
    });
    if (!response.Items) {
      return [];
    }
    return response.Items.map((item) => unmarshall(item));
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic configs for state ${state}:`, error);
    throw error;
  }
}
async function getFullClinicData(clinicId) {
  const [config, secrets] = await Promise.all([
    getClinicConfig(clinicId),
    getClinicSecrets(clinicId)
  ]);
  if (!config || !secrets) {
    return null;
  }
  return { config, secrets };
}
async function getClinicIds() {
  const configs = await getAllClinicConfigs();
  return configs.map((c) => c.clinicId);
}
function clearAllCaches() {
  clinicSecretsCache.clear();
  globalSecretsCache.clear();
  clinicConfigCache.clear();
  console.log("[SecretsHelper] All caches cleared");
}
function clearClinicCache(clinicId) {
  clinicSecretsCache.delete(clinicId);
  clinicConfigCache.delete(clinicId);
}
function clearGlobalSecretCache(secretId, secretType) {
  globalSecretsCache.delete(`${secretId}#${secretType}`);
}
async function getAyrshareApiKey() {
  return getGlobalSecret("ayrshare", "api_key");
}
async function getAyrsharePrivateKey() {
  return getGlobalSecret("ayrshare", "private_key");
}
async function getAyrshareDomain() {
  return getGlobalSecret("ayrshare", "domain");
}
async function getOdooApiKey() {
  return getGlobalSecret("odoo", "api_key");
}
async function getOdooConfig() {
  const [configEntry, apiKey] = await Promise.all([
    getGlobalSecretEntry("odoo", "config"),
    getGlobalSecret("odoo", "api_key")
  ]);
  if (!configEntry || !apiKey) {
    return null;
  }
  return {
    url: configEntry.value,
    database: configEntry.metadata?.database || "todays-dental-services",
    apiKey,
    username: configEntry.metadata?.username
    // Odoo login email (e.g., admin@company.com)
  };
}
async function getGmailOAuthCredentials() {
  const [clientId, clientSecret] = await Promise.all([
    getGlobalSecret("gmail", "client_id"),
    getGlobalSecret("gmail", "client_secret")
  ]);
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}
async function getTwilioCredentials() {
  const [accountSid, authToken] = await Promise.all([
    getGlobalSecret("twilio", "account_sid"),
    getGlobalSecret("twilio", "auth_token")
  ]);
  if (!accountSid || !authToken) {
    return null;
  }
  return { accountSid, authToken };
}
async function getCpanelCredentials() {
  const [apiTokenEntry, configEntry] = await Promise.all([
    getGlobalSecretEntry("cpanel", "api_token"),
    getGlobalSecretEntry("cpanel", "config")
  ]);
  if (!apiTokenEntry) {
    console.warn("[SecretsHelper] cPanel API token not found in GlobalSecrets");
    return null;
  }
  const metadata = apiTokenEntry.metadata || configEntry?.metadata || {};
  return {
    host: metadata.host || configEntry?.value || "box2383.bluehost.com",
    port: parseInt(metadata.port || "2083", 10),
    username: metadata.user || "todayse4",
    apiToken: apiTokenEntry.value,
    domain: metadata.domain || "todaysdentalpartners.com"
  };
}
async function getFCMCredentials() {
  const [projectId, serviceAccountKey] = await Promise.all([
    getGlobalSecret("fcm", "project_id"),
    getGlobalSecret("fcm", "service_account")
  ]);
  if (!projectId || !serviceAccountKey) {
    console.warn("[SecretsHelper] FCM credentials not found in GlobalSecrets");
    return null;
  }
  return { projectId, serviceAccountKey };
}
var dynamoClient, CLINIC_SECRETS_TABLE, GLOBAL_SECRETS_TABLE, CLINIC_CONFIG_TABLE, CACHE_TTL_MS, clinicSecretsCache, globalSecretsCache, clinicConfigCache;
var init_secrets_helper = __esm({
  "src/shared/utils/secrets-helper.ts"() {
    "use strict";
    dynamoClient = null;
    CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
    GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
    CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
    CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);
    clinicSecretsCache = /* @__PURE__ */ new Map();
    globalSecretsCache = /* @__PURE__ */ new Map();
    clinicConfigCache = /* @__PURE__ */ new Map();
  }
});

// src/services/accounting/matching/index.ts
var matching_exports = {};
__export(matching_exports, {
  calculateReconciliationSummary: () => calculateReconciliationSummary,
  getMatchingStrategy: () => getMatchingStrategy,
  runReconciliation: () => runReconciliation
});
function normalizeReference(ref) {
  if (!ref)
    return "";
  return ref.toString().trim().toUpperCase().replace(/\s+/g, "");
}
function amountsMatch(expected, received, tolerance = 0.01) {
  return Math.abs(expected - received) <= tolerance;
}
function generateRowId() {
  return `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
function determineMatchStatus(expected, received) {
  if (received === void 0 || received === null) {
    return "UNMATCHED";
  }
  if (amountsMatch(expected, received)) {
    return "MATCHED";
  }
  return "PARTIAL";
}
function getMatchingStrategy(mode) {
  const strategy = strategies.get(mode);
  if (!strategy) {
    throw new Error(`No matching strategy found for payment mode: ${mode}`);
  }
  return strategy;
}
function runReconciliation(mode, openDentalRows, bankRows) {
  const strategy = getMatchingStrategy(mode);
  return strategy.match(openDentalRows, bankRows);
}
function calculateReconciliationSummary(results) {
  let matchedCount = 0;
  let partialCount = 0;
  let unmatchedCount = 0;
  let totalExpected = 0;
  let totalReceived = 0;
  for (const result of results) {
    const { row } = result;
    totalExpected += row.expectedAmount;
    totalReceived += row.receivedAmount || 0;
    switch (row.status) {
      case "MATCHED":
        matchedCount++;
        break;
      case "PARTIAL":
        partialCount++;
        break;
      case "UNMATCHED":
        unmatchedCount++;
        break;
    }
  }
  return {
    totalRows: results.length,
    matchedCount,
    partialCount,
    unmatchedCount,
    totalExpected,
    totalReceived,
    totalDifference: totalReceived - totalExpected
  };
}
var BaseMatchingStrategy, EFTMatchingStrategy, ChequeMatchingStrategy, CreditCardMatchingStrategy, PayConnectMatchingStrategy, SunbitMatchingStrategy, AuthorizeNetMatchingStrategy, CherryMatchingStrategy, CareCreditMatchingStrategy, strategies;
var init_matching = __esm({
  "src/services/accounting/matching/index.ts"() {
    "use strict";
    BaseMatchingStrategy = class {
      match(openDentalRows, bankRows) {
        const results = [];
        const usedBankRows = /* @__PURE__ */ new Set();
        const usedOpenDentalRows = /* @__PURE__ */ new Set();
        const bankRowsByKey = /* @__PURE__ */ new Map();
        for (const bankRow of bankRows) {
          const key = this.getMatchingKey(bankRow);
          if (key) {
            if (!bankRowsByKey.has(key)) {
              bankRowsByKey.set(key, []);
            }
            bankRowsByKey.get(key).push(bankRow);
          }
        }
        for (const odRow of openDentalRows) {
          const key = this.getMatchingKey(odRow);
          if (!key) {
            results.push(this.createUnmatchedResult(odRow));
            usedOpenDentalRows.add(odRow.rowId);
            continue;
          }
          const matchingBankRows = bankRowsByKey.get(key) || [];
          let matched = false;
          for (const bankRow of matchingBankRows) {
            if (usedBankRows.has(bankRow.rowId))
              continue;
            const status = determineMatchStatus(odRow.expectedAmount, bankRow.amount);
            if (status === "MATCHED" || status === "PARTIAL") {
              results.push(this.createMatchedResult(odRow, bankRow, status));
              usedBankRows.add(bankRow.rowId);
              usedOpenDentalRows.add(odRow.rowId);
              matched = true;
              break;
            }
          }
          if (!matched) {
            results.push(this.createUnmatchedResult(odRow));
            usedOpenDentalRows.add(odRow.rowId);
          }
        }
        for (const bankRow of bankRows) {
          if (!usedBankRows.has(bankRow.rowId)) {
            results.push(this.createUnexpectedBankResult(bankRow));
          }
        }
        return results;
      }
      createMatchedResult(odRow, bankRow, status) {
        const difference = (bankRow.amount || 0) - odRow.expectedAmount;
        return {
          row: {
            rowId: generateRowId(),
            referenceId: odRow.referenceId,
            expectedAmount: odRow.expectedAmount,
            receivedAmount: bankRow.amount,
            status,
            difference,
            reason: status === "PARTIAL" ? "Amount mismatch" : void 0,
            openDentalRowId: odRow.rowId,
            bankRowId: bankRow.rowId,
            patientName: odRow.patientName
          },
          openDentalRow: odRow,
          bankRow
        };
      }
      createUnmatchedResult(odRow) {
        return {
          row: {
            rowId: generateRowId(),
            referenceId: odRow.referenceId,
            expectedAmount: odRow.expectedAmount,
            receivedAmount: void 0,
            status: "UNMATCHED",
            difference: -odRow.expectedAmount,
            reason: "No matching bank transaction found",
            openDentalRowId: odRow.rowId,
            patientName: odRow.patientName
          },
          openDentalRow: odRow
        };
      }
      createUnexpectedBankResult(bankRow) {
        return {
          row: {
            rowId: generateRowId(),
            referenceId: bankRow.reference,
            expectedAmount: 0,
            receivedAmount: bankRow.amount,
            status: "UNMATCHED",
            difference: bankRow.amount,
            reason: "Bank transaction has no matching OpenDental payment",
            bankRowId: bankRow.rowId
          },
          bankRow
        };
      }
    };
    EFTMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "EFT";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    ChequeMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "CHEQUE";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    CreditCardMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "CREDIT_CARD";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    PayConnectMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "PAYCONNECT";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    SunbitMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "SUNBIT";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    AuthorizeNetMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "AUTHORIZE_NET";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    CherryMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "CHERRY";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    CareCreditMatchingStrategy = class extends BaseMatchingStrategy {
      constructor() {
        super(...arguments);
        this.mode = "CARE_CREDIT";
      }
      getMatchingKey(row) {
        const ref = row.referenceId || row.reference;
        return normalizeReference(ref);
      }
    };
    strategies = /* @__PURE__ */ new Map([
      ["EFT", new EFTMatchingStrategy()],
      ["CHEQUE", new ChequeMatchingStrategy()],
      ["CREDIT_CARD", new CreditCardMatchingStrategy()],
      ["PAYCONNECT", new PayConnectMatchingStrategy()],
      ["SUNBIT", new SunbitMatchingStrategy()],
      ["AUTHORIZE_NET", new AuthorizeNetMatchingStrategy()],
      ["CHERRY", new CherryMatchingStrategy()],
      ["CARE_CREDIT", new CareCreditMatchingStrategy()]
    ]);
  }
});

// src/services/accounting/index.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TextractClient } from "@aws-sdk/client-textract";

// node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
import crypto2 from "crypto";
var native_default = {
  randomUUID: crypto2.randomUUID
};

// node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// src/services/accounting/index.ts
init_secrets_helper();

// src/shared/utils/odoo-api.ts
var requestId = 0;
function getNextRequestId() {
  return ++requestId;
}
async function makeJsonRpcCall(url, method, params) {
  const request = {
    jsonrpc: "2.0",
    method,
    params,
    id: getNextRequestId()
  };
  console.log(`[Odoo] Making JSON-RPC call: ${method}`, JSON.stringify(params, null, 2));
  const response = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(`Odoo HTTP error: ${response.status} ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    console.error("[Odoo] JSON-RPC error:", result.error);
    throw new Error(`Odoo API error: ${result.error.message}`);
  }
  return result.result;
}
async function authenticateOdoo(config) {
  console.log(`[Odoo] Authenticating with ${config.url}`);
  const uid = await makeJsonRpcCall(config.url, "call", {
    service: "common",
    method: "authenticate",
    args: [
      config.database,
      config.username || "api",
      config.apiKey,
      {}
    ]
  });
  if (!uid) {
    throw new Error("Odoo authentication failed: No user ID returned");
  }
  console.log(`[Odoo] Authenticated successfully as uid: ${uid}`);
  return uid;
}
async function fetchBankTransactions(uid, config, options) {
  console.log(`[Odoo] Fetching bank transactions for company ${options.companyId} from ${options.dateStart} to ${options.dateEnd}`);
  const domain = [
    ["company_id", "=", options.companyId],
    ["date", ">=", options.dateStart],
    ["date", "<=", options.dateEnd]
  ];
  const fields = [
    "id",
    "date",
    "ref",
    "payment_ref",
    "amount",
    "partner_id",
    "statement_id",
    "company_id",
    "name",
    "narration"
  ];
  const transactions = await makeJsonRpcCall(config.url, "call", {
    service: "object",
    method: "execute_kw",
    args: [
      config.database,
      uid,
      config.apiKey,
      "account.bank.statement.line",
      "search_read",
      [domain],
      {
        fields,
        limit: options.limit || 1e3,
        order: "date desc"
      }
    ]
  });
  console.log(`[Odoo] Found ${transactions.length} bank transactions`);
  return transactions;
}
async function getCompanies(uid, config) {
  console.log(`[Odoo] Fetching companies`);
  const companies = await makeJsonRpcCall(config.url, "call", {
    service: "object",
    method: "execute_kw",
    args: [
      config.database,
      uid,
      config.apiKey,
      "res.company",
      "search_read",
      [[]],
      {
        fields: ["id", "name", "partner_id"]
      }
    ]
  });
  console.log(`[Odoo] Found ${companies.length} companies`);
  return companies;
}
async function getBankJournals(uid, config, companyId) {
  console.log(`[Odoo] Fetching bank journals for company ${companyId}`);
  const journals = await makeJsonRpcCall(config.url, "call", {
    service: "object",
    method: "execute_kw",
    args: [
      config.database,
      uid,
      config.apiKey,
      "account.journal",
      "search_read",
      [[
        ["company_id", "=", companyId],
        ["type", "=", "bank"]
      ]],
      {
        fields: ["id", "name", "code", "company_id", "type"]
      }
    ]
  });
  console.log(`[Odoo] Found ${journals.length} bank journals`);
  return journals;
}
async function fetchInvoices(uid, config, options) {
  const types = options.moveTypes || [
    "in_invoice",
    "in_refund",
    "out_invoice",
    "out_refund",
    "entry"
  ];
  console.log(`[Odoo] Fetching invoices for company ${options.companyId}, types: ${types.join(", ")}`);
  const domain = [
    ["company_id", "=", options.companyId],
    ["move_type", "in", types]
  ];
  if (options.dateStart) {
    domain.push(["invoice_date", ">=", options.dateStart]);
  }
  if (options.dateEnd) {
    domain.push(["invoice_date", "<=", options.dateEnd]);
  }
  if (options.state) {
    domain.push(["state", "=", options.state]);
  }
  const fields = [
    "id",
    "name",
    "ref",
    "move_type",
    "partner_id",
    "invoice_date",
    "invoice_date_due",
    "amount_total",
    "amount_residual",
    "state",
    "payment_state",
    "company_id",
    "currency_id",
    "invoice_origin",
    "narration"
  ];
  const invoices = await makeJsonRpcCall(config.url, "call", {
    service: "object",
    method: "execute_kw",
    args: [
      config.database,
      uid,
      config.apiKey,
      "account.move",
      "search_read",
      [domain],
      {
        fields,
        limit: options.limit || 5e3,
        order: "invoice_date desc"
      }
    ]
  });
  console.log(`[Odoo] Found ${invoices.length} invoices`);
  return invoices;
}
function getOdooConfigFromEnv() {
  const url = process.env.ODOO_URL;
  const database = process.env.ODOO_DATABASE;
  const apiKey = process.env.ODOO_API_KEY;
  if (!url || !database || !apiKey) {
    throw new Error("Missing Odoo configuration. Required: ODOO_URL, ODOO_DATABASE, ODOO_API_KEY");
  }
  return {
    url,
    database,
    apiKey
  };
}
var OdooClient = class _OdooClient {
  constructor(config) {
    this.uid = null;
    this.config = config;
  }
  static fromEnv() {
    return new _OdooClient(getOdooConfigFromEnv());
  }
  async authenticate() {
    if (!this.uid) {
      this.uid = await authenticateOdoo(this.config);
    }
    return this.uid;
  }
  async getBankTransactions(options) {
    const uid = await this.authenticate();
    return fetchBankTransactions(uid, this.config, options);
  }
  async getInvoices(options) {
    const uid = await this.authenticate();
    return fetchInvoices(uid, this.config, options);
  }
  async getCompanies() {
    const uid = await this.authenticate();
    return getCompanies(uid, this.config);
  }
  async getBankJournals(companyId) {
    const uid = await this.authenticate();
    return getBankJournals(uid, this.config, companyId);
  }
};

// src/shared/utils/permissions-helper.ts
import { inflateSync } from "zlib";
function parseClinicRoles(clinicRolesValue) {
  if (Array.isArray(clinicRolesValue)) {
    return clinicRolesValue;
  }
  if (typeof clinicRolesValue !== "string") {
    return [];
  }
  const raw = clinicRolesValue.trim();
  if (!raw)
    return [];
  try {
    if (raw.startsWith("z:")) {
      const b64 = raw.slice(2);
      const json = inflateSync(Buffer.from(b64, "base64")).toString("utf-8");
      return JSON.parse(json);
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse clinicRoles from authorizer context:", err);
    return [];
  }
}
function getUserPermissions(event) {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer)
    return null;
  try {
    const clinicRoles = parseClinicRoles(authorizer.clinicRolesZ ?? authorizer.clinicRoles);
    const isSuperAdmin = authorizer.isSuperAdmin === "true";
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === "true";
    const email = authorizer.email || "";
    const givenName = authorizer.givenName || "";
    const familyName = authorizer.familyName || "";
    return {
      email,
      givenName,
      familyName,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin
    };
  } catch (err) {
    console.error("Failed to parse user permissions:", err);
    return null;
  }
}
function getAllowedClinicIds(clinicRoles, isSuperAdmin, isGlobalSuperAdmin) {
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return /* @__PURE__ */ new Set(["*"]);
  }
  const clinicIds = clinicRoles.map((cr) => cr.clinicId);
  return new Set(clinicIds);
}
function hasClinicAccess(allowedClinics, clinicId) {
  return allowedClinics.has("*") || allowedClinics.has(clinicId);
}

// src/services/accounting/index.ts
var INVOICES_TABLE = process.env.INVOICES_TABLE;
var BANK_STATEMENTS_TABLE = process.env.BANK_STATEMENTS_TABLE;
var OPENDENTAL_REPORTS_TABLE = process.env.OPENDENTAL_REPORTS_TABLE;
var RECONCILIATION_TABLE = process.env.RECONCILIATION_TABLE;
var COLUMN_CONFIG_TABLE = process.env.COLUMN_CONFIG_TABLE;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
var s3 = new S3Client({});
var textract = new TextractClient({});
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
};
var httpErr = (code, message) => ({
  statusCode: code,
  headers: corsHeaders,
  body: JSON.stringify({ success: false, message })
});
var httpOk = (data) => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify({ success: true, ...data })
});
var httpCreated = (data) => ({
  statusCode: 201,
  headers: corsHeaders,
  body: JSON.stringify({ success: true, ...data })
});
function hasClinicAccess2(allowedClinics, clinicId) {
  return hasClinicAccess(allowedClinics, clinicId);
}
function getAllowedClinics(userPerms) {
  return getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
}
async function handler(event) {
  console.log("[Accounting] Event:", JSON.stringify(event, null, 2));
  const method = event.httpMethod || event.requestContext?.http?.method;
  let path = event.path || event.rawPath || "";
  path = path.replace(/^\/accounting/, "");
  if (method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(401, "Unauthorized: No authorizer context or invalid permissions");
  }
  const allowedClinics = getAllowedClinics(userPerms);
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};
  let body = {};
  try {
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    }
  } catch {
    return httpErr(400, "Invalid JSON body");
  }
  try {
    if (method === "GET" && path.match(/^\/invoices\/?$/)) {
      const { clinicId } = queryParams;
      if (!clinicId)
        return httpErr(400, "clinicId is required");
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await listInvoices(clinicId);
    }
    if (method === "POST" && path.match(/^\/invoices\/sync-odoo\/?$/)) {
      const { clinicId } = body;
      if (!clinicId)
        return httpErr(400, "clinicId is required");
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await syncOdooInvoices(clinicId);
    }
    if (method === "POST" && path.match(/^\/invoices\/upload\/?$/)) {
      const { clinicId, source, fileName, contentType } = body;
      if (!clinicId || !source || !fileName) {
        return httpErr(400, "clinicId, source, and fileName are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await createInvoiceUploadUrl(clinicId, source, fileName, contentType || "application/pdf");
    }
    if (method === "GET" && pathParams.invoiceId) {
      return await getInvoice(pathParams.invoiceId, allowedClinics);
    }
    if (method === "PUT" && pathParams.invoiceId) {
      return await updateInvoice(pathParams.invoiceId, body, allowedClinics);
    }
    if (method === "DELETE" && pathParams.invoiceId) {
      return await deleteInvoice(pathParams.invoiceId, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/brs\/open-dental\/?$/)) {
      const { clinicId, paymentMode, dateStart, dateEnd } = queryParams;
      if (!clinicId || !paymentMode || !dateStart || !dateEnd) {
        return httpErr(400, "clinicId, paymentMode, dateStart, dateEnd are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await fetchOpenDentalPayments(clinicId, paymentMode, dateStart, dateEnd);
    }
    if (method === "GET" && path.match(/^\/brs\/odoo\/?$/)) {
      const { clinicId, dateStart, dateEnd } = queryParams;
      if (!clinicId || !dateStart || !dateEnd) {
        return httpErr(400, "clinicId, dateStart, dateEnd are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await fetchOdooBankTransactions(clinicId, dateStart, dateEnd);
    }
    if (method === "POST" && path.match(/^\/brs\/bank-file\/upload\/?$/)) {
      const { clinicId, paymentMode, fileName, contentType } = body;
      if (!clinicId || !paymentMode || !fileName) {
        return httpErr(400, "clinicId, paymentMode, and fileName are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await createBankFileUploadUrl(clinicId, paymentMode, fileName, contentType || "text/csv");
    }
    if (method === "GET" && path.match(/^\/brs\/bank-file\/?$/)) {
      const { clinicId, paymentMode } = queryParams;
      if (!clinicId || !paymentMode) {
        return httpErr(400, "clinicId and paymentMode are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await getBankStatements(clinicId, paymentMode);
    }
    if (method === "POST" && path.match(/^\/brs\/reconcile\/?$/)) {
      const { clinicId, paymentMode, dateStart, dateEnd, bankStatementId } = body;
      if (!clinicId || !paymentMode || !dateStart || !dateEnd) {
        return httpErr(400, "clinicId, paymentMode, dateStart, dateEnd are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await generateReconciliation(clinicId, paymentMode, dateStart, dateEnd, bankStatementId);
    }
    if (method === "GET" && pathParams.reconciliationId) {
      return await getReconciliation(pathParams.reconciliationId, allowedClinics);
    }
    if (method === "POST" && path.match(/^\/brs\/approve\/?$/)) {
      const { reconciliationId } = body;
      if (!reconciliationId) {
        return httpErr(400, "reconciliationId is required");
      }
      return await approveReconciliation(reconciliationId, userPerms, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/brs\/column-config\/?$/)) {
      const { clinicId, paymentMode } = queryParams;
      if (!clinicId || !paymentMode) {
        return httpErr(400, "clinicId and paymentMode are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await getColumnConfig(clinicId, paymentMode);
    }
    if (method === "PUT" && path.match(/^\/brs\/column-config\/?$/)) {
      const { clinicId, paymentMode, columns } = body;
      if (!clinicId || !paymentMode || !columns) {
        return httpErr(400, "clinicId, paymentMode, and columns are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await updateColumnConfig(clinicId, paymentMode, columns, userPerms.email);
    }
    return httpErr(404, `Not found: ${method} ${path}`);
  } catch (error) {
    console.error("[Accounting] Error:", error);
    return httpErr(500, error.message || "Internal server error");
  }
}
async function listInvoices(clinicId) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: INVOICES_TABLE,
    IndexName: "byClinic",
    KeyConditionExpression: "clinicId = :clinicId",
    ExpressionAttributeValues: { ":clinicId": clinicId },
    ScanIndexForward: false
    // Most recent first
  }));
  return httpOk({ invoices: Items || [] });
}
async function createInvoiceUploadUrl(clinicId, source, fileName, contentType) {
  const invoiceId = v4_default();
  const s3Key = `invoices/${clinicId}/${invoiceId}/${fileName}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const invoice = {
    invoiceId,
    clinicId,
    source,
    status: "SCANNED",
    fileUrl: `https://${DOCUMENTS_BUCKET}.s3.amazonaws.com/${s3Key}`,
    s3Key,
    createdAt: now
  };
  await ddb.send(new PutCommand({
    TableName: INVOICES_TABLE,
    Item: invoice
  }));
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ContentType: contentType
    }),
    { expiresIn: 3600 }
  );
  return httpCreated({ invoiceId, uploadUrl, s3Key });
}
async function getInvoice(invoiceId, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  if (!Item)
    return httpErr(404, "Invoice not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  return httpOk({ invoice: Item });
}
async function updateInvoice(invoiceId, updates, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  if (!Item)
    return httpErr(404, "Invoice not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  const updateExpressions = [];
  const expressionValues = {};
  const expressionNames = {};
  if (updates.vendorName !== void 0) {
    updateExpressions.push("#vendorName = :vendorName");
    expressionNames["#vendorName"] = "vendorName";
    expressionValues[":vendorName"] = updates.vendorName;
  }
  if (updates.vendorId !== void 0) {
    updateExpressions.push("#vendorId = :vendorId");
    expressionNames["#vendorId"] = "vendorId";
    expressionValues[":vendorId"] = updates.vendorId;
  }
  if (updates.dueDate !== void 0) {
    updateExpressions.push("#dueDate = :dueDate");
    expressionNames["#dueDate"] = "dueDate";
    expressionValues[":dueDate"] = updates.dueDate;
  }
  if (updates.amount !== void 0) {
    updateExpressions.push("#amount = :amount");
    expressionNames["#amount"] = "amount";
    expressionValues[":amount"] = updates.amount;
  }
  if (updates.status !== void 0) {
    updateExpressions.push("#status = :status");
    expressionNames["#status"] = "status";
    expressionValues[":status"] = updates.status;
  }
  updateExpressions.push("#updatedAt = :updatedAt");
  expressionNames["#updatedAt"] = "updatedAt";
  expressionValues[":updatedAt"] = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues
  }));
  return httpOk({ invoiceId, message: "Invoice updated successfully" });
}
async function deleteInvoice(invoiceId, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  if (!Item)
    return httpErr(404, "Invoice not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  await ddb.send(new DeleteCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  return httpOk({ message: "Invoice deleted successfully" });
}
async function syncOdooInvoices(clinicId) {
  const clinicConfig = await getClinicConfig(clinicId);
  if (!clinicConfig) {
    return httpErr(404, `Clinic config not found for ${clinicId}`);
  }
  const odooCompanyId = clinicConfig.odooCompanyId;
  if (!odooCompanyId) {
    return httpErr(400, `Odoo company ID not configured for clinic ${clinicId}`);
  }
  try {
    const odooConfig = await getOdooConfig();
    if (!odooConfig) {
      return httpErr(500, "Odoo credentials not configured.");
    }
    const odooClient = new OdooClient(odooConfig);
    console.log(`[Accounting] Syncing Odoo invoices for clinic ${clinicId}, company ${odooCompanyId}`);
    const odooInvoices = await odooClient.getInvoices({
      companyId: Number(odooCompanyId)
    });
    console.log(`[Accounting] Fetched ${odooInvoices.length} invoices from Odoo`);
    const { Items: existingInvoices } = await ddb.send(new QueryCommand({
      TableName: INVOICES_TABLE,
      IndexName: "byClinic",
      KeyConditionExpression: "clinicId = :clinicId",
      ExpressionAttributeValues: { ":clinicId": clinicId }
    }));
    const existingOdooIds = new Set(
      (existingInvoices || []).filter((inv) => inv.odooId).map((inv) => inv.odooId)
    );
    const mapOdooStatus = (state, paymentState) => {
      if (state === "cancel")
        return "ERROR";
      if (paymentState === "paid")
        return "READY_FOR_AP";
      if (state === "posted")
        return "DUE_DATE_EXTRACTED";
      return "VENDOR_IDENTIFIED";
    };
    const mapMoveType = (moveType) => {
      switch (moveType) {
        case "in_invoice":
          return "VENDOR_BILL";
        case "in_refund":
          return "VENDOR_CREDIT_NOTE";
        case "out_invoice":
          return "CUSTOMER_INVOICE";
        case "out_refund":
          return "CUSTOMER_CREDIT_NOTE";
        case "entry":
          return "JOURNAL_ENTRY";
        default:
          return "OTHER";
      }
    };
    let synced = 0;
    let skipped = 0;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const odooInv of odooInvoices) {
      if (existingOdooIds.has(odooInv.id)) {
        skipped++;
        continue;
      }
      const vendorName = odooInv.partner_id ? odooInv.partner_id[1] : void 0;
      const vendorId = odooInv.partner_id ? String(odooInv.partner_id[0]) : void 0;
      const dueDate = odooInv.invoice_date_due ? String(odooInv.invoice_date_due) : void 0;
      const invoice = {
        invoiceId: v4_default(),
        clinicId,
        source: "ODOO",
        vendorId,
        vendorName,
        dueDate,
        amount: odooInv.amount_total,
        status: mapOdooStatus(odooInv.state, odooInv.payment_state),
        invoiceType: mapMoveType(odooInv.move_type),
        fileUrl: "",
        // No file URL for Odoo-sourced invoices
        s3Key: "",
        // No S3 key for Odoo-sourced invoices
        odooId: odooInv.id,
        odooRef: odooInv.name,
        odooMoveType: odooInv.move_type,
        createdAt: odooInv.invoice_date ? new Date(String(odooInv.invoice_date)).toISOString() : now
      };
      await ddb.send(new PutCommand({
        TableName: INVOICES_TABLE,
        Item: invoice
      }));
      synced++;
    }
    console.log(`[Accounting] Odoo sync complete: ${synced} synced, ${skipped} skipped (already exist)`);
    const { Items } = await ddb.send(new QueryCommand({
      TableName: INVOICES_TABLE,
      IndexName: "byClinic",
      KeyConditionExpression: "clinicId = :clinicId",
      ExpressionAttributeValues: { ":clinicId": clinicId },
      ScanIndexForward: false
    }));
    return httpOk({
      invoices: Items || [],
      syncResult: {
        totalFromOdoo: odooInvoices.length,
        newlySynced: synced,
        alreadyExisted: skipped
      }
    });
  } catch (error) {
    console.error("[Accounting] Error syncing Odoo invoices:", error);
    return httpErr(500, `Failed to sync Odoo invoices: ${error.message}`);
  }
}
async function fetchOpenDentalPayments(clinicId, paymentMode, dateStart, dateEnd) {
  const reportId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const { getClinicSecrets: getClinicSecrets2 } = await Promise.resolve().then(() => (init_secrets_helper(), secrets_helper_exports));
    const secrets = await getClinicSecrets2(clinicId);
    if (!secrets || !secrets.openDentalDeveloperKey || !secrets.openDentalCustomerKey) {
      console.error(`[Accounting] No OpenDental credentials found for clinic: ${clinicId}`);
      return httpErr(400, `No OpenDental credentials configured for clinic ${clinicId}`);
    }
    const authHeader = `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`;
    console.log(`[Accounting] Fetching OpenDental payments for clinic=${clinicId}, mode=${paymentMode}, range=${dateStart} to ${dateEnd}`);
    const odPayments = await callOpenDentalApi(
      "GET",
      `/payments?DateEntry=${dateStart}`,
      authHeader
    );
    if (!Array.isArray(odPayments)) {
      console.warn("[Accounting] OpenDental payments response is not an array:", typeof odPayments);
      const report2 = {
        reportId,
        clinicId,
        paymentMode,
        reportDate: now,
        dateStart,
        dateEnd,
        rows: [],
        createdAt: now
      };
      return httpOk({ report: report2 });
    }
    console.log(`[Accounting] OpenDental returned ${odPayments.length} total payments since ${dateStart}`);
    const filteredPayments = odPayments.filter((p) => {
      const payDate = p.PayDate || p.payDate || "";
      const normalizedDate = payDate.substring(0, 10);
      return normalizedDate <= dateEnd;
    });
    console.log(`[Accounting] ${filteredPayments.length} payments within date range ${dateStart} to ${dateEnd}`);
    const uniquePatNums = [...new Set(filteredPayments.map((p) => p.PatNum || p.patNum).filter(Boolean))];
    const patientNameCache = /* @__PURE__ */ new Map();
    const BATCH_SIZE = 10;
    for (let i = 0; i < uniquePatNums.length; i += BATCH_SIZE) {
      const batch = uniquePatNums.slice(i, i + BATCH_SIZE);
      const patientPromises = batch.map(async (patNum) => {
        try {
          const patient = await callOpenDentalApi("GET", `/patients/${patNum}`, authHeader);
          const fName = patient?.FName || patient?.fName || "";
          const lName = patient?.LName || patient?.lName || "";
          patientNameCache.set(patNum, `${lName}, ${fName}`.trim());
        } catch (err) {
          console.warn(`[Accounting] Failed to fetch patient ${patNum}:`, err);
          patientNameCache.set(patNum, `Patient #${patNum}`);
        }
      });
      await Promise.all(patientPromises);
    }
    const rows = filteredPayments.map((p) => {
      const patNum = p.PatNum || p.patNum || 0;
      const payAmt = p.PayAmt || p.payAmt || 0;
      const payDate = (p.PayDate || p.payDate || "").substring(0, 10);
      const payNum = p.PayNum || p.payNum || 0;
      const payType = p.PayType || p.payType || 0;
      const payNote = p.PayNote || p.payNote || "";
      return {
        rowId: `od-${payNum}`,
        patNum,
        patientName: patientNameCache.get(patNum) || `Patient #${patNum}`,
        paymentDate: payDate,
        expectedAmount: Number(payAmt),
        paymentMode,
        referenceId: payNote || `PAY-${payNum}`,
        sourceType: "PATIENT",
        payType
      };
    });
    console.log(`[Accounting] Mapped ${rows.length} OpenDental payment rows`);
    const report = {
      reportId,
      clinicId,
      paymentMode,
      reportDate: now,
      dateStart,
      dateEnd,
      rows,
      createdAt: now
    };
    try {
      await ddb.send(new PutCommand({
        TableName: OPENDENTAL_REPORTS_TABLE,
        Item: report
      }));
    } catch (cacheErr) {
      console.warn("[Accounting] Failed to cache OpenDental report:", cacheErr);
    }
    return httpOk({ report });
  } catch (error) {
    console.error("[Accounting] Error fetching OpenDental payments:", error);
    return httpErr(500, `Failed to fetch OpenDental payments: ${error.message}`);
  }
}
async function callOpenDentalApi(method, apiPath, authorizationHeader, body) {
  const https = await import("https");
  const API_HOST = "api.opendental.com";
  const API_BASE = "/api/v1";
  const fullPath = `${API_BASE}${apiPath}`;
  const headers = {
    "Authorization": authorizationHeader,
    "Content-Type": "application/json"
  };
  if (body) {
    headers["Content-Length"] = Buffer.byteLength(body).toString();
  }
  return new Promise((resolve, reject) => {
    const options = { hostname: API_HOST, path: fullPath, method, headers };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`OpenDental API returned ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on("error", reject);
    if (body)
      req.write(body);
    req.end();
  });
}
async function fetchOdooBankTransactions(clinicId, dateStart, dateEnd) {
  const clinicConfig = await getClinicConfig(clinicId);
  if (!clinicConfig) {
    return httpErr(404, `Clinic config not found for ${clinicId}`);
  }
  const odooCompanyId = clinicConfig.odooCompanyId;
  if (!odooCompanyId) {
    return httpErr(400, `Odoo company ID not configured for clinic ${clinicId}`);
  }
  try {
    const odooConfig = await getOdooConfig();
    if (!odooConfig) {
      console.error("[Accounting] Missing Odoo credentials in GlobalSecrets");
      return httpErr(500, "Odoo credentials not configured. Please set odoo/config and odoo/api_key in GlobalSecrets.");
    }
    const odooClient = new OdooClient(odooConfig);
    console.log(`[Accounting] Fetching Odoo bank transactions for clinic ${clinicId}, company ${odooCompanyId}, range ${dateStart} to ${dateEnd}`);
    const transactions = await odooClient.getBankTransactions({
      companyId: Number(odooCompanyId),
      dateStart,
      dateEnd
    });
    console.log(`[Accounting] Fetched ${transactions.length} transactions from Odoo`);
    return httpOk({
      clinicId,
      odooCompanyId,
      dateStart,
      dateEnd,
      transactions
    });
  } catch (error) {
    console.error("[Accounting] Error fetching Odoo bank transactions:", error);
    return httpErr(500, `Failed to fetch Odoo bank transactions: ${error.message}`);
  }
}
async function createBankFileUploadUrl(clinicId, paymentMode, fileName, contentType) {
  const bankStatementId = v4_default();
  const s3Key = `bank-files/${clinicId}/${paymentMode}/${bankStatementId}/${fileName}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const bankStatement = {
    bankStatementId,
    clinicId,
    paymentMode,
    uploadDate: now,
    s3FileKey: s3Key,
    fileName,
    parsedRows: [],
    status: "UPLOADED"
  };
  await ddb.send(new PutCommand({
    TableName: BANK_STATEMENTS_TABLE,
    Item: bankStatement
  }));
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ContentType: contentType
    }),
    { expiresIn: 3600 }
  );
  return httpCreated({ bankStatementId, uploadUrl, s3Key });
}
async function getBankStatements(clinicId, paymentMode) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: BANK_STATEMENTS_TABLE,
    IndexName: "byClinic",
    KeyConditionExpression: "clinicId = :clinicId",
    FilterExpression: "paymentMode = :paymentMode",
    ExpressionAttributeValues: {
      ":clinicId": clinicId,
      ":paymentMode": paymentMode
    },
    ScanIndexForward: false
  }));
  return httpOk({ bankStatements: Items || [] });
}
async function generateReconciliation(clinicId, paymentMode, dateStart, dateEnd, bankStatementId) {
  const reconciliationId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { runReconciliation: runReconciliation2 } = await Promise.resolve().then(() => (init_matching(), matching_exports));
  let openDentalRows = [];
  try {
    const { getClinicSecrets: getClinicSecrets2 } = await Promise.resolve().then(() => (init_secrets_helper(), secrets_helper_exports));
    const secrets = await getClinicSecrets2(clinicId);
    if (secrets?.openDentalDeveloperKey && secrets?.openDentalCustomerKey) {
      const authHeader = `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`;
      console.log(`[Reconciliation] Fetching OpenDental payments for ${clinicId}, mode=${paymentMode}, range=${dateStart} to ${dateEnd}`);
      const odPayments = await callOpenDentalApi(
        "GET",
        `/payments?DateEntry=${dateStart}`,
        authHeader
      );
      if (Array.isArray(odPayments)) {
        const filteredPayments = odPayments.filter((p) => {
          const payDate = (p.PayDate || p.payDate || "").substring(0, 10);
          return payDate <= dateEnd;
        });
        const uniquePatNums = [...new Set(filteredPayments.map((p) => p.PatNum || p.patNum).filter(Boolean))];
        const patientNameCache = /* @__PURE__ */ new Map();
        const BATCH_SIZE = 10;
        for (let i = 0; i < uniquePatNums.length; i += BATCH_SIZE) {
          const batch = uniquePatNums.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (patNum) => {
            try {
              const patient = await callOpenDentalApi("GET", `/patients/${patNum}`, authHeader);
              const fName = patient?.FName || patient?.fName || "";
              const lName = patient?.LName || patient?.lName || "";
              patientNameCache.set(patNum, `${lName}, ${fName}`.trim());
            } catch {
              patientNameCache.set(patNum, `Patient #${patNum}`);
            }
          }));
        }
        openDentalRows = filteredPayments.map((p) => {
          const patNum = p.PatNum || p.patNum || 0;
          const payAmt = p.PayAmt || p.payAmt || 0;
          const payDate = (p.PayDate || p.payDate || "").substring(0, 10);
          const payNum = p.PayNum || p.payNum || 0;
          const payNote = p.PayNote || p.payNote || "";
          return {
            rowId: `od-${payNum}`,
            patNum,
            patientName: patientNameCache.get(patNum) || `Patient #${patNum}`,
            paymentDate: payDate,
            expectedAmount: Number(payAmt),
            paymentMode,
            referenceId: payNote || `PAY-${payNum}`,
            sourceType: "PATIENT"
          };
        });
        console.log(`[Reconciliation] Got ${openDentalRows.length} OpenDental payment rows`);
      }
    } else {
      console.warn(`[Reconciliation] No OpenDental credentials for clinic ${clinicId}`);
    }
  } catch (err) {
    console.error("[Reconciliation] Error fetching OpenDental payments:", err.message);
  }
  let bankRows = [];
  if (bankStatementId) {
    try {
      const { Item } = await ddb.send(new GetCommand({
        TableName: BANK_STATEMENTS_TABLE,
        Key: { bankStatementId }
      }));
      if (Item?.parsedRows) {
        bankRows = Item.parsedRows;
        console.log(`[Reconciliation] Got ${bankRows.length} rows from uploaded bank file`);
      }
    } catch (err) {
      console.error("[Reconciliation] Error loading bank file:", err.message);
    }
  } else {
    try {
      const clinicConfig = await getClinicConfig(clinicId);
      const odooCompanyId = clinicConfig?.odooCompanyId;
      if (odooCompanyId) {
        const odooConfig = await getOdooConfig();
        if (odooConfig) {
          const odooClient = new OdooClient(odooConfig);
          const transactions = await odooClient.getBankTransactions({
            companyId: Number(odooCompanyId),
            dateStart,
            dateEnd
          });
          console.log(`[Reconciliation] Got ${transactions.length} Odoo bank transactions`);
          bankRows = transactions.map((txn, idx) => ({
            rowId: `odoo-${txn.id || idx}`,
            date: txn.date || "",
            reference: txn.payment_ref || txn.ref || "",
            description: txn.payment_ref || txn.ref || "",
            amount: Math.abs(txn.amount || 0),
            type: (txn.amount || 0) >= 0 ? "CREDIT" : "DEBIT"
          }));
        }
      }
    } catch (err) {
      console.error("[Reconciliation] Error fetching Odoo transactions:", err.message);
    }
  }
  console.log(`[Reconciliation] Running ${paymentMode} matching: ${openDentalRows.length} OD rows vs ${bankRows.length} bank rows`);
  const matchResults = runReconciliation2(paymentMode, openDentalRows, bankRows);
  const reconRows = matchResults.map((r) => r.row);
  console.log(`[Reconciliation] Matching complete: ${reconRows.length} result rows`);
  const reconciliation = {
    reconciliationId,
    clinicId,
    paymentMode,
    status: "DRAFT",
    dateStart,
    dateEnd,
    rows: reconRows,
    createdAt: now
  };
  await ddb.send(new PutCommand({
    TableName: RECONCILIATION_TABLE,
    Item: reconciliation
  }));
  return httpCreated({ reconciliation });
}
async function getReconciliation(reconciliationId, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId }
  }));
  if (!Item)
    return httpErr(404, "Reconciliation not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  return httpOk({ reconciliation: Item });
}
async function approveReconciliation(reconciliationId, userPerms, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId }
  }));
  if (!Item)
    return httpErr(404, "Reconciliation not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  if (Item.status === "APPROVED") {
    return httpErr(400, "Reconciliation is already approved");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId },
    UpdateExpression: "SET #status = :status, approvedAt = :approvedAt, approvedBy = :approvedBy",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":status": "APPROVED",
      ":approvedAt": now,
      ":approvedBy": userPerms.email
    }
  }));
  return httpOk({ status: "APPROVED", approvedAt: now, approvedBy: userPerms.email });
}
async function getColumnConfig(clinicId, paymentMode) {
  const configKey = `${clinicId}#${paymentMode}`;
  const { Item } = await ddb.send(new GetCommand({
    TableName: COLUMN_CONFIG_TABLE,
    Key: { configKey }
  }));
  if (!Item) {
    return httpOk({
      columnConfig: getDefaultColumnConfig(clinicId, paymentMode)
    });
  }
  return httpOk({ columnConfig: Item });
}
async function updateColumnConfig(clinicId, paymentMode, columns, updatedBy) {
  const configKey = `${clinicId}#${paymentMode}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const columnConfig = {
    configKey,
    clinicId,
    paymentMode,
    columns,
    updatedAt: now,
    updatedBy
  };
  await ddb.send(new PutCommand({
    TableName: COLUMN_CONFIG_TABLE,
    Item: columnConfig
  }));
  return httpOk({ columnConfig });
}
function getDefaultColumnConfig(clinicId, paymentMode) {
  return {
    configKey: `${clinicId}#${paymentMode}`,
    clinicId,
    paymentMode,
    columns: [
      { key: "referenceId", label: "Reference ID", visible: true, order: 1 },
      { key: "patientName", label: "Patient Name", visible: true, order: 2 },
      { key: "expectedAmount", label: "Expected Amount", visible: true, order: 3 },
      { key: "receivedAmount", label: "Received Amount", visible: true, order: 4 },
      { key: "difference", label: "Difference", visible: true, order: 5 },
      { key: "status", label: "Status", visible: true, order: 6 },
      { key: "reason", label: "Reason", visible: true, order: 7 }
    ],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
export {
  handler
};
