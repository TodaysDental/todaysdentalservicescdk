"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

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
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new import_client_dynamodb.DynamoDB({});
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
    const secrets = (0, import_util_dynamodb.unmarshall)(response.Item);
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
    const secrets = response.Items.map((item) => (0, import_util_dynamodb.unmarshall)(item));
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
    const entry = (0, import_util_dynamodb.unmarshall)(response.Item);
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
    return (0, import_util_dynamodb.unmarshall)(response.Item);
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
    return response.Items.map((item) => (0, import_util_dynamodb.unmarshall)(item));
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
    const config = (0, import_util_dynamodb.unmarshall)(response.Item);
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
    const configs = response.Items.map((item) => (0, import_util_dynamodb.unmarshall)(item));
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
    return response.Items.map((item) => (0, import_util_dynamodb.unmarshall)(item));
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
    apiKey
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
var import_client_dynamodb, import_util_dynamodb, dynamoClient, CLINIC_SECRETS_TABLE, GLOBAL_SECRETS_TABLE, CLINIC_CONFIG_TABLE, CACHE_TTL_MS, clinicSecretsCache, globalSecretsCache, clinicConfigCache;
var init_secrets_helper = __esm({
  "src/shared/utils/secrets-helper.ts"() {
    "use strict";
    import_client_dynamodb = require("@aws-sdk/client-dynamodb");
    import_util_dynamodb = require("@aws-sdk/util-dynamodb");
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

// src/integrations/communication/notify.ts
var notify_exports = {};
__export(notify_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(notify_exports);
var import_https = __toESM(require("https"));
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var import_client_ssm = require("@aws-sdk/client-ssm");

// src/infrastructure/configs/clinic-config.json
var clinic_config_default = [
  {
    clinicId: "dentistinnewbritain",
    microsoftClarityProjectId: "prdkd0ahi0",
    ga4PropertyId: "460776013",
    odooCompanyId: 22,
    clinicAddress: "446 S Main St, New Britain CT 06051-3516, USA",
    clinicCity: "New Britain",
    clinicEmail: "dentalcare@dentistinnewbritain.com",
    clinicFax: "(860) 770-6774",
    clinicName: "Dentist in New Britain",
    clinicZipCode: "29607",
    clinicPhone: "860-259-4141",
    clinicState: "Connecticut",
    timezone: "America/New_York",
    logoUrl: "https://dentistinnewbritain.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/1wKzE8B2jbxQJaHB8",
    scheduleUrl: "https://dentistinnewbritain.com/patient-portal",
    websiteLink: "https://dentistinnewbritain.com",
    wwwUrl: "https://www.dentistinnewbritain.com",
    phoneNumber: "+18602612866",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinnewbritain.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinnewbritain",
    hostedZoneId: "Z01685649197DPKW71B2",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinnewbritain@gmail.com",
        fromEmail: "dentistinnewbritain@gmail.com",
        fromName: "Dentist in New Britain"
      },
      domain: {
        imapHost: "mail.dentistinnewbritain.com",
        imapPort: 993,
        smtpHost: "mail.dentistinnewbritain.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinnewbritain.com",
        fromEmail: "dentalcare@dentistinnewbritain.com",
        fromName: "Dentist in New Britain"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "749712698232047",
        pageName: "Dentist in New Britain"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6882337378"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistingreenville",
    microsoftClarityProjectId: "prcd3zvx6c",
    ga4PropertyId: "437418111",
    odooCompanyId: 14,
    clinicAddress: "4 Market Point Drive Suite E, Greenville SC 29607",
    clinicCity: "Greenville",
    clinicEmail: "dentalcare@dentistingreenville.com",
    clinicFax: "864-284-0066",
    clinicName: "Dentist in Greenville",
    clinicPhone: "864-284-0066",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "06051-3516",
    logoUrl: "https://dentistingreenville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/TP79MgS1EcycndPy8",
    scheduleUrl: "https://dentistingreenville.com/patient-portal",
    websiteLink: "https://dentistingreenville.com",
    wwwUrl: "https://www.dentistingreenville.com",
    phoneNumber: "+18643192704",
    aiPhoneNumber: "+14439272295",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistingreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistingreenville",
    hostedZoneId: "Z02737791R5YBM2QQE4CP",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistingreenville@gmail.com",
        fromEmail: "dentistingreenville@gmail.com",
        fromName: "Dentist in Greenville"
      },
      domain: {
        imapHost: "mail.dentistingreenville.com",
        imapPort: 993,
        smtpHost: "mail.dentistingreenville.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistingreenville.com",
        fromEmail: "dentalcare@dentistingreenville.com",
        fromName: "Dentist in Greenville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "749186571616901",
        pageName: "Dentist in Greenville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "2978902821"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalcayce",
    microsoftClarityProjectId: "pqbgmaxpjv",
    ga4PropertyId: "397796880",
    odooCompanyId: 4,
    clinicAddress: "1305 Knox Abbott Dr suite 101, Cayce, SC 29033, United States",
    clinicCity: "Cayce",
    clinicEmail: "Dentist@TodaysDentalCayce.com",
    clinicFax: "(803) 753-1442",
    clinicName: "Todays Dental Cayce",
    clinicPhone: "803-233-6141",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29033",
    logoUrl: "https://todaysdentalcayce.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/eU4TuxoySfuqfwib7",
    scheduleUrl: "https://todaysdentalcayce.com/patient-portal",
    websiteLink: "https://todaysdentalcayce.com",
    wwwUrl: "https://www.todaysdentalcayce.com",
    phoneNumber: "+18033027525",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalcayce.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalcayce",
    hostedZoneId: "Z0652651QLHSQU2T54IO",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalcayce@gmail.com",
        fromEmail: "todaysdentalcayce@gmail.com",
        fromName: "Todays Dental Cayce"
      },
      domain: {
        imapHost: "mail.todaysdentalcayce.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalcayce.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalCayce.com",
        fromEmail: "Dentist@TodaysDentalCayce.com",
        fromName: "Todays Dental Cayce"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "860746843779381",
        pageName: "Todays Dental Cayce"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "1505658809"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "creekcrossingdentalcare",
    microsoftClarityProjectId: "q5nwcwxs47",
    ga4PropertyId: "473416830",
    odooCompanyId: 33,
    clinicAddress: "1927 FAITHON P LUCAS SR BLVD Ste 120 MESQUITE TX 75181-1698",
    clinicCity: "Mesquite",
    clinicEmail: "dentist@creekcrossingdentalcare.com",
    clinicFax: "469-333-6159",
    clinicName: "Creek Crossing Dental Care",
    clinicPhone: "469-333-6158",
    clinicState: "Texas",
    timezone: "America/Chicago",
    clinicZipCode: "75181",
    logoUrl: "https://creekcrossingdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/k9Be93nCmmcaE3CG7",
    scheduleUrl: "https://creekcrossingdentalcare.com/patient-portal",
    websiteLink: "https://creekcrossingdentalcare.com",
    wwwUrl: "https://www.creekcrossingdentalcare.com",
    phoneNumber: "+14692250064",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/creekcrossingdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "creekcrossingdentalcare",
    hostedZoneId: "Z04673793CNYTEEDV0F48",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "creekcrossingdentalcare@gmail.com",
        fromEmail: "creekcrossingdentalcare@gmail.com",
        fromName: "Creek Crossing Dental Care"
      },
      domain: {
        imapHost: "mail.creekcrossingdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.creekcrossingdentalcare.com",
        smtpPort: 465,
        smtpUser: "dentist@creekcrossingdentalcare.com",
        fromEmail: "dentist@creekcrossingdentalcare.com",
        fromName: "Creek Crossing Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "802545442940105",
        pageName: "Creek Crossing Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6327290560"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinwinston-salem",
    microsoftClarityProjectId: "pvgkbe95f9",
    ga4PropertyId: "476844030",
    odooCompanyId: 35,
    clinicAddress: "3210 Silas Creek Pkwy, Suite-4 Winston salem, NC, 27103",
    clinicCity: "Winston-Salem",
    clinicEmail: "dentalcare@dentistinwinston-salem.com",
    clinicFax: "336-802-1898",
    clinicName: "Dentist in Winston-Salem",
    clinicPhone: "336-802-1894",
    clinicState: "North Carolina",
    timezone: "America/New_York",
    clinicZipCode: "27103",
    logoUrl: "https://dentistinwinston-salem.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/fAV5H59kFt1dfuMW9",
    scheduleUrl: "https://dentistinwinston-salem.com/patient-portal",
    websiteLink: "https://dentistinwinston-salem.com",
    wwwUrl: "https://www.dentistinwinston-salem.com",
    phoneNumber: "+13362836627",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinwinston-salem.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinwinston-salem",
    hostedZoneId: "Z0684688QGCIEZOQLTOQ",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinwinstonsalem@gmail.com",
        fromEmail: "dentistinwinstonsalem@gmail.com",
        fromName: "Dentist in Winston-Salem"
      },
      domain: {
        imapHost: "mail.dentistinwinston-salem.com",
        imapPort: 993,
        smtpHost: "mail.dentistinwinston-salem.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinwinston-salem.com",
        fromEmail: "dentalcare@dentistinwinston-salem.com",
        fromName: "Dentist in Winston-Salem"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "798270746700728",
        pageName: "Dentist in Winston-Salem"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8916450096"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistincentennial",
    microsoftClarityProjectId: "qxtfof6tvo",
    ga4PropertyId: "479242236",
    odooCompanyId: 37,
    clinicAddress: "20269 E Smoky Hill Rd, Centennial, CO 80015, USA",
    clinicCity: "Centennial",
    clinicEmail: "dentalcare@dentistincentennial.com",
    clinicFax: "",
    clinicName: "Dentist in centennial",
    clinicPhone: "303-923-9068",
    clinicState: "Colorado",
    timezone: "America/Denver",
    clinicZipCode: "80015",
    logoUrl: "https://dentistincentennial.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/HjGoQovp8s1QbsC66",
    scheduleUrl: "https://dentistincentennial.com/patient-portal",
    websiteLink: "https://dentistincentennial.com",
    wwwUrl: "https://www.dentistincentennial.com",
    phoneNumber: "+17207020009",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistincentennial.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistincentennial",
    hostedZoneId: "Z01521441Y3EX4DY9YZAZ",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistincentennial@gmail.com",
        fromEmail: "dentistincentennial@gmail.com",
        fromName: "Dentist in centennial"
      },
      domain: {
        imapHost: "mail.dentistincentennial.com",
        imapPort: 993,
        smtpHost: "mail.dentistincentennial.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistincentennial.com",
        fromEmail: "dentalcare@dentistincentennial.com",
        fromName: "Dentist in centennial"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "804637432728253",
        pageName: "Dentist in centennial"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8705012352"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "renodentalcareandorthodontics",
    microsoftClarityProjectId: "tetwfq1mjm",
    ga4PropertyId: "479275245",
    odooCompanyId: 38,
    clinicAddress: "8040 S VIRGINIA ST STE 1 RENO NV 89511-8939",
    clinicCity: "Reno",
    clinicEmail: "dentalcare@renodentalcareandorthodontics.com",
    clinicFax: "775-339-9894",
    clinicName: "Reno Dental Care and Orthodontics",
    clinicPhone: "775-339-9893",
    clinicState: "Nevada",
    timezone: "America/Los_Angeles",
    clinicZipCode: "89511",
    logoUrl: "https://renodentalcareandorthodontics.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/yqVa3N8mNwCgwBGv6",
    scheduleUrl: "https://renodentalcareandorthodontics.com/patient-portal",
    websiteLink: "https://renodentalcareandorthodontics.com",
    wwwUrl: "https://www.renodentalcareandorthodontics.com",
    phoneNumber: "+17752538664",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/renodentalcareandorthodontics.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "renodentalcareandorthodontics",
    hostedZoneId: "Z06718466K032QAKNVB6",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinrenonv@gmail.com",
        fromEmail: "dentistinrenonv@gmail.com",
        fromName: "Reno Dental Care and Orthodontics"
      },
      domain: {
        imapHost: "mail.renodentalcareandorthodontics.com",
        imapPort: 993,
        smtpHost: "mail.renodentalcareandorthodontics.com",
        smtpPort: 465,
        smtpUser: "dentalcare@renodentalcareandorthodontics.com",
        fromEmail: "dentalcare@renodentalcareandorthodontics.com",
        fromName: "Reno Dental Care and Orthodontics"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "780646868466800",
        pageName: "Reno Dental Care and orthodontics"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8844529656"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalalexandria",
    microsoftClarityProjectId: "prcjdqxsau",
    ga4PropertyId: "323970788",
    odooCompanyId: 8,
    clinicAddress: "4601 Pinecrest Office Park Dr D, Alexandria, VA 22312, United States",
    clinicCity: "Alexandria",
    clinicEmail: "Dentist@TodaysDentalAlexandria.com",
    clinicFax: "(703) 256-5076",
    clinicName: "Todays Dental Alexandria",
    clinicPhone: "(703) 256-2085",
    clinicState: "Virginia",
    timezone: "America/New_York",
    clinicZipCode: "22312",
    logoUrl: "https://todaysdentalalexandria.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/vqABURPKCfMrFuuX9",
    scheduleUrl: "https://todaysdentalalexandria.com/patient-portal",
    websiteLink: "https://todaysdentalalexandria.com",
    wwwUrl: "https://www.todaysdentalalexandria.com",
    phoneNumber: "+17036728308",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalalexandria.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalalexandria",
    hostedZoneId: "Z03912831F1RMPO1B73A1",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalalexandria@gmail.com",
        fromEmail: "todaysdentalalexandria@gmail.com",
        fromName: "Todays Dental Alexandria"
      },
      domain: {
        imapHost: "mail.todaysdentalalexandria.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalalexandria.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalAlexandria.com",
        fromEmail: "Dentist@TodaysDentalAlexandria.com",
        fromName: "Todays Dental Alexandria"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "854025807784463",
        pageName: "Todays Dental Alexandria"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5285406194"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalgreenville",
    microsoftClarityProjectId: "prc4w966rh",
    ga4PropertyId: "329785564",
    odooCompanyId: 5,
    clinicAddress: "1530 Poinsett Hwy Greenville, SC 29609, USA",
    clinicCity: "Greenville",
    clinicEmail: "Dentist@TodaysDentalGreenville.com",
    clinicFax: "(864) 274-0708",
    clinicName: "Todays Dental Greenville",
    clinicPhone: "(864) 999-9899",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29609",
    logoUrl: "https://todaysdentalgreenville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/ksQRNsjQsjH7VNUa9",
    scheduleUrl: "https://todaysdentalgreenville.com/patient-portal",
    websiteLink: "https://todaysdentalgreenville.com",
    wwwUrl: "https://www.todaysdentalgreenville.com",
    phoneNumber: "+18643192662",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalgreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalgreenville",
    hostedZoneId: "Z04077501PVREEA4QQROH",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalgreenville@gmail.com",
        fromEmail: "todaysdentalgreenville@gmail.com",
        fromName: "Todays Dental Greenville"
      },
      domain: {
        imapHost: "mail.todaysdentalgreenville.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalgreenville.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalGreenville.com",
        fromEmail: "Dentist@TodaysDentalGreenville.com",
        fromName: "Todays Dental Greenville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "785393261324026",
        pageName: "Todays Dental Greenville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "3865885156"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalwestcolumbia",
    microsoftClarityProjectId: "prcle83ice",
    ga4PropertyId: "256860978",
    odooCompanyId: 6,
    clinicAddress: "115 Medical Cir West Columbia, SC 29169, USA",
    clinicCity: "West Columbia",
    clinicEmail: "Dentist@TodaysDentalWestColumbia.com",
    clinicFax: "(803) 233-8178",
    clinicName: "Todays Dental West Columbia",
    clinicPhone: "(803) 233-8177",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29169",
    logoUrl: "https://todaysdentalwestcolumbia.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/NfpA3W9nsMdxC2gy5",
    scheduleUrl: "https://todaysdentalwestcolumbia.com/patient-portal",
    websiteLink: "https://todaysdentalwestcolumbia.com",
    wwwUrl: "https://www.todaysdentalwestcolumbia.com",
    phoneNumber: "+18032988480",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalwestcolumbia.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalwestcolumbia",
    hostedZoneId: "Z04061862KUE9GXTYR3B8",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalwestcolumbia@gmail.com",
        fromEmail: "todaysdentalwestcolumbia@gmail.com",
        fromName: "Todays Dental West Columbia"
      },
      domain: {
        imapHost: "mail.todaysdentalwestcolumbia.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalwestcolumbia.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalWestColumbia.com",
        fromEmail: "Dentist@TodaysDentalWestColumbia.com",
        fromName: "Todays Dental West Columbia"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "780972621763947",
        pageName: "Todays Dental West Columbia"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6830227762"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinconcord",
    microsoftClarityProjectId: "prd9vboz9f",
    ga4PropertyId: "436453348",
    odooCompanyId: 20,
    clinicAddress: "2460 Wonder DR STE C, Kannapolis, NC 28083",
    clinicCity: "Concord",
    clinicEmail: "DentalCare@DentistinConcord.com",
    clinicFax: "(704) 707-3621",
    clinicName: "Dentist in Concord",
    clinicPhone: "(704) 707-3620",
    clinicState: "North Carolina",
    timezone: "America/New_York",
    clinicZipCode: "28083",
    logoUrl: "https://dentistinconcord.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/PRVNRH5U7tnv4erA8",
    scheduleUrl: "https://dentistinconcord.com/patient-portal",
    websiteLink: "https://dentistinconcord.com",
    wwwUrl: "https://www.dentistinconcord.com",
    phoneNumber: "+17043682506",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinconcord.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinconcord",
    hostedZoneId: "Z0424286J6ADTB4LRPD5",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinconcord@gmail.com",
        fromEmail: "dentistinconcord@gmail.com",
        fromName: "Dentist in Concord"
      },
      domain: {
        imapHost: "mail.dentistinconcord.com",
        imapPort: 993,
        smtpHost: "mail.dentistinconcord.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinConcord.com",
        fromEmail: "DentalCare@DentistinConcord.com",
        fromName: "Dentist in Concord"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "818707804648788",
        pageName: "Dentist in Concord"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "1771094795"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinedgewater",
    microsoftClarityProjectId: "prd2n502ae",
    ga4PropertyId: "454102815",
    odooCompanyId: 15,
    clinicAddress: "15 Lee Airpark Dr, Suite 100, Edgewater MD 21037",
    clinicCity: "Edgewater",
    clinicEmail: "DentalCare@DentistinEdgewater.com",
    clinicFax: "(443) 334-6689",
    clinicName: "Dentist in EdgeWater",
    clinicPhone: "(443) 334-6689",
    clinicState: "Maryland",
    timezone: "America/New_York",
    clinicZipCode: "21037",
    logoUrl: "https://dentistinedgewatermd.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/x97PmcG9KJH5Rdu16",
    scheduleUrl: "https://dentistinedgewatermd.com/patient-portal",
    websiteLink: "https://dentistinedgewatermd.com",
    wwwUrl: "https://www.dentistinedgewatermd.com",
    phoneNumber: "+14432038433",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinedgewatermd.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinedgewater",
    hostedZoneId: "Z0681492267AQBV6TNPKG",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinedgewatermd@gmail.com",
        fromEmail: "dentistinedgewatermd@gmail.com",
        fromName: "Dentist in EdgeWater"
      },
      domain: {
        imapHost: "mail.dentistinedgewater.com",
        imapPort: 993,
        smtpHost: "mail.dentistinedgewater.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinEdgewater.com",
        fromEmail: "DentalCare@DentistinEdgewater.com",
        fromName: "Dentist in EdgeWater"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "815231321665315",
        pageName: "Dentist in EdgeWater"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6571919715"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "lawrencevilledentistry",
    microsoftClarityProjectId: "prcvlw68k2",
    ga4PropertyId: "320151183",
    odooCompanyId: 11,
    clinicAddress: "1455 Pleasant Hill Road, Lawrenceville, Suite 807A, georgia 30044, USA",
    clinicCity: "Lawrenceville",
    clinicEmail: "Dentist@LawrencevilleDentistry.com",
    clinicFax: "(770) 415-4995",
    clinicName: "Lawrenceville Dentistry",
    clinicZipCode: "30044",
    clinicPhone: "(770)-415-0077",
    clinicState: "Georgia",
    timezone: "America/New_York",
    logoUrl: "https://lawrencevilledentistry.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/MFnMPmHSsdyHaGZe9",
    scheduleUrl: "https://lawrencevilledentistry.com/book-appointment",
    websiteLink: "https://lawrencevilledentistry.com",
    wwwUrl: "https://www.lawrencevilledentistry.com",
    phoneNumber: "+17702840555",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/lawrencevilledentistry.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "lawrencevilledentistry",
    hostedZoneId: "Z065164017R8THSISNPT8",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "lawrencevilledentistry@gmail.com",
        fromEmail: "lawrencevilledentistry@gmail.com",
        fromName: "Lawrenceville Dentistry"
      },
      domain: {
        imapHost: "mail.lawrencevilledentistry.com",
        imapPort: 993,
        smtpHost: "mail.lawrencevilledentistry.com",
        smtpPort: 465,
        smtpUser: "Dentist@LawrencevilleDentistry.com",
        fromEmail: "Dentist@LawrencevilleDentistry.com",
        fromName: "Lawrenceville Dentistry"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "764215823445811",
        pageName: "Lawrenceville Dentistry"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9954954552"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinlouisville",
    microsoftClarityProjectId: "prdfvmoubk",
    ga4PropertyId: "457162663",
    odooCompanyId: 21,
    clinicAddress: "6826 Bardstown Road, Louisville Kentucky 40291, USA",
    clinicCity: "Louisville",
    clinicEmail: "dentalcare@dentistinlouisville.com",
    clinicFax: "(502) 212-9629",
    clinicName: "Dentist In Louisville",
    clinicZipCode: "40291",
    clinicPhone: "(502)-239-9751",
    clinicState: "Kentucky",
    timezone: "America/New_York",
    logoUrl: "https://dentistinlouisville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/m76QtysK96poeUWy7",
    scheduleUrl: "https://dentistinlouisville.com/book-appointment",
    websiteLink: "https://dentistinlouisville.com",
    wwwUrl: "https://www.dentistinlouisville.com",
    phoneNumber: "+15022158254",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinlouisville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinlouisville",
    hostedZoneId: "Z01681663I51Z0MKKI4RU",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinlouisvillekentucky@gmail.com",
        fromEmail: "dentistinlouisvillekentucky@gmail.com",
        fromName: "Dentist In Louisville"
      },
      domain: {
        imapHost: "mail.dentistinlouisville.com",
        imapPort: 993,
        smtpHost: "mail.dentistinlouisville.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinlouisville.com",
        fromEmail: "dentalcare@dentistinlouisville.com",
        fromName: "Dentist In Louisville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "830585603464796",
        pageName: "Dentist In Louisville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9277361743"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistatsaludapointe",
    microsoftClarityProjectId: "prcqs5tiew",
    ga4PropertyId: "308606507",
    odooCompanyId: 7,
    clinicAddress: "105 Saluda Pointe Ct Suite C, Lexington, SC 29072, USA",
    clinicCity: "SaludaPointe",
    clinicEmail: "DentalCare@DentistatSaludaPointe.com",
    clinicFax: "",
    clinicName: "Todays Dental Saluda Pointe",
    clinicZipCode: "29072",
    clinicPhone: "(803) 399-8236",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    logoUrl: "https://dentistatsaludapointe.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/ybcArAkBw4JLHqmY7",
    scheduleUrl: "https://dentistatsaludapointe.com/book-appointment",
    websiteLink: "https://dentistatsaludapointe.com",
    wwwUrl: "https://www.dentistatsaludapointe.com",
    phoneNumber: "+18032919970",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistatsaludapointe.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistatsaludapointe",
    hostedZoneId: "Z065149151EMKCBPQEVL",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistatsaludapointe@gmail.com",
        fromEmail: "dentistatsaludapointe@gmail.com",
        fromName: "Todays Dental Saluda Pointe"
      },
      domain: {
        imapHost: "mail.dentistatsaludapointe.com",
        imapPort: 993,
        smtpHost: "mail.dentistatsaludapointe.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistatSaludaPointe.com",
        fromEmail: "DentalCare@DentistatSaludaPointe.com",
        fromName: "Todays Dental Saluda Pointe"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "830923773419024",
        pageName: "Dentist At Saluda Pointe"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9490955129"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinoregonoh",
    microsoftClarityProjectId: "prdbm63nqu",
    ga4PropertyId: "435942957",
    odooCompanyId: 25,
    clinicAddress: "3555 Navarre Ave Stre 12, Oregon OH 43616",
    clinicCity: "Oregon",
    clinicEmail: "dentalcare@dentistinoregonoh.com",
    clinicFax: "(419) 391-9906",
    clinicName: "Dentist in Oregon",
    clinicPhone: "(419) 690-0320",
    clinicState: "Ohio",
    timezone: "America/New_York",
    clinicZipCode: "43616",
    logoUrl: "https://dentistinoregonoh.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/dHUuSUYSeot1YxBw5",
    scheduleUrl: "https://dentistinOregonoh.com/patient-portal",
    websiteLink: "https://dentistinoregonoh.com",
    wwwUrl: "https://www.dentistinoregonoh.com",
    phoneNumber: "+14193183371",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinoregonoh.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinoregonoh",
    hostedZoneId: "Z0424621RYEA9FEBS0JY",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinoregonoh@gmail.com",
        fromEmail: "dentistinoregonoh@gmail.com",
        fromName: "Dentist in Oregon"
      },
      domain: {
        imapHost: "mail.dentistinoregonoh.com",
        imapPort: 993,
        smtpHost: "mail.dentistinoregonoh.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinoregonoh.com",
        fromEmail: "dentalcare@dentistinoregonoh.com",
        fromName: "Dentist in Oregon"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "761336133733464",
        pageName: "Dentist in Oregon"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "2121863652"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentallexington",
    microsoftClarityProjectId: "prcooafwqn",
    ga4PropertyId: "322576361",
    odooCompanyId: 2,
    clinicAddress: "458 Old Cherokee Rd Suite 100, Lexington, SC 29072, USA",
    clinicCity: "Lexington",
    clinicEmail: "Dentist@TodaysDentalLexington.com",
    clinicFax: "",
    clinicName: "Todays Dental Lexington",
    clinicPhone: "(803) 756-4353",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "43616",
    logoUrl: "https://todaysdentallexington.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/nBnxjeHrWU8mxDgV7",
    scheduleUrl: "https://todaysdentallexington.com/patient-portal",
    websiteLink: "https://todaysdentallexington.com",
    wwwUrl: "https://www.todaysdentallexington.com",
    phoneNumber: "+18032210987",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentallexington.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "daysdentallexington",
    hostedZoneId: "Z040331235NMZIX4ZLLGE",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentallexington@gmail.com",
        fromEmail: "todaysdentallexington@gmail.com",
        fromName: "Todays Dental Lexington"
      },
      domain: {
        imapHost: "mail.todaysdentallexington.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentallexington.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalLexington.com",
        fromEmail: "Dentist@TodaysDentalLexington.com",
        fromName: "Todays Dental Lexington"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "739288799274944",
        pageName: "Todays Dental Lexington"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9085359447"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinbowie",
    microsoftClarityProjectId: "prctr500z6",
    ga4PropertyId: "317138480",
    odooCompanyId: 9,
    clinicAddress: "14999 Health Center Dr #110 Bowie, MD 20716, USA",
    clinicCity: "Bowie",
    clinicEmail: "DentalCare@DentistinBowie.com",
    clinicFax: "(301) 880-0940",
    clinicName: "Dentist in Bowie",
    clinicZipCode: "20716",
    clinicPhone: "(301) 880-0504",
    clinicState: "Maryland",
    timezone: "America/New_York",
    logoUrl: "https://dentistinbowie.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Tb2ZSscmYFCkdEsLA",
    scheduleUrl: "https://dentistinbowie.com/patient-portal",
    websiteLink: "https://dentistinbowie.com",
    wwwUrl: "https://www.dentistinbowie.com",
    phoneNumber: "+13012416572",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinbowie.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinbowie",
    hostedZoneId: "Z06428572342W1A3EK5HA",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinbowie@gmail.com",
        fromEmail: "dentistinbowie@gmail.com",
        fromName: "Dentist in Bowie"
      },
      domain: {
        imapHost: "mail.dentistinbowie.com",
        imapPort: 993,
        smtpHost: "mail.dentistinbowie.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinBowie.com",
        fromEmail: "DentalCare@DentistinBowie.com",
        fromName: "Dentist in Bowie"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "786812141180019",
        pageName: "Dentist in Bowie"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4551655949"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinpowellohio",
    microsoftClarityProjectId: "prdd94j7x5",
    ga4PropertyId: "441589993",
    odooCompanyId: 16,
    clinicAddress: "4091 W Powell Rd#1, Powell, OH 43065",
    clinicCity: "Powell",
    clinicEmail: "DentalCare@DentistinPowellOhio.com",
    clinicFax: "(614) 664-9667",
    clinicName: "Dentist in Powell",
    clinicZipCode: "43065",
    clinicPhone: "(614) 659-0018",
    clinicState: "Ohio",
    timezone: "America/New_York",
    logoUrl: "https://dentistinpowellohio.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/eR4MznoQ3gj897NX8",
    scheduleUrl: "https://dentistinpowellohio.com/patient-portal",
    websiteLink: "https://dentistinpowellohio.com",
    wwwUrl: "https://www.dentistinpowellohio.com",
    phoneNumber: "+16144898815",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinpowellohio.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinpowellohio",
    hostedZoneId: "Z06449472H2KB1S9FS2K5",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinpowellohio@gmail.com",
        fromEmail: "dentistinpowellohio@gmail.com",
        fromName: "Dentist in Powell"
      },
      domain: {
        imapHost: "mail.dentistinpowellohio.com",
        imapPort: 993,
        smtpHost: "mail.dentistinpowellohio.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinPowellOhio.com",
        fromEmail: "DentalCare@DentistinPowellOhio.com",
        fromName: "Dentist in Powell"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "779484698582071",
        pageName: "Dentist in Powell"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4638071933"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinperrysburg",
    microsoftClarityProjectId: "prcxhz2cnj",
    ga4PropertyId: "375431202",
    odooCompanyId: 10,
    clinicAddress: "110 E South Boundary St, Perrysburg, OH 43551, USA",
    clinicCity: "Perrysburg",
    clinicEmail: "Dentalcare@dentistinperrysburg.com",
    clinicFax: "(419) 792-1263",
    clinicName: "Dentist in PerrysBurg",
    clinicZipCode: "43551",
    clinicPhone: "(419) 792-1264",
    clinicState: "Ohio",
    timezone: "America/New_York",
    logoUrl: "https://dentistinperrysburg.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/aVCiTAY9UvGYXQaR8",
    scheduleUrl: "https://dentistinperrysburg.com/patient-portal",
    websiteLink: "https://dentistinperrysburg.com",
    wwwUrl: "https://www.dentistinperrysburg.com",
    phoneNumber: "+14193183386",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinperrysburg.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinperrysburg",
    hostedZoneId: "Z0190676238ABL9C3TV32",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinperrysburg@gmail.com",
        fromEmail: "dentistinperrysburg@gmail.com",
        fromName: "Dentist in PerrysBurg"
      },
      domain: {
        imapHost: "mail.dentistinperrysburg.com",
        imapPort: 993,
        smtpHost: "mail.dentistinperrysburg.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinperrysburg.com",
        fromEmail: "Dentalcare@dentistinperrysburg.com",
        fromName: "Dentist in PerrysBurg"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "743300888873794",
        pageName: "Dentist in PerrysBurg"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "7421865491"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinaustin",
    microsoftClarityProjectId: "q5ntnauzgw",
    ga4PropertyId: "473412339",
    odooCompanyId: 34,
    clinicAddress: "2110 W Slaughter Ln Ste 190 Austin, TX 78748",
    clinicCity: "Austin",
    clinicEmail: "Dentalcare@dentistinaustintx.com",
    clinicFax: "(512) 430-4563",
    clinicName: "Dentist in Austin",
    clinicZipCode: "78748",
    clinicPhone: "512-430-4472",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinaustintx.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/BbvkUzQb14p6YhH77",
    scheduleUrl: "https://dentistinaustintx.com/patient-portal",
    websiteLink: "https://dentistinaustintx.com",
    wwwUrl: "https://www.dentistinaustintx.com",
    phoneNumber: "+15123095624",
    aiPhoneNumber: "+17377074552",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinaustintx.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinaustin",
    hostedZoneId: "Z039585419DY53TZXW8SA",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinaustin@gmail.com",
        fromEmail: "dentistinaustin@gmail.com",
        fromName: "Dentist in Austin"
      },
      domain: {
        imapHost: "mail.dentistinaustintx.com",
        imapPort: 993,
        smtpHost: "mail.dentistinaustintx.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinaustintx.com",
        fromEmail: "Dentalcare@dentistinaustintx.com",
        fromName: "Dentist in Austin"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "787337507798286",
        pageName: "Dentist in Austin"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5770542490"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "therimdentalcare",
    microsoftClarityProjectId: "prdn6xu3rx",
    ga4PropertyId: "475875370",
    odooCompanyId: 29,
    clinicAddress: "6028 WORTH PKWY STE 101, SAN ANTONIO, TX 78257-5071",
    clinicCity: "SAN ANTONIO",
    clinicEmail: "Dentist@therimdentalcare.com",
    clinicFax: "(726) 215-9920",
    clinicName: "The Rim Dental Care",
    clinicPhone: "(726) 215-9920",
    clinicState: "Texas",
    timezone: "America/Chicago",
    clinicZipCode: "78257-5071",
    logoUrl: "https://therimdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/cabosKW6nqkmPCQs8",
    scheduleUrl: "https://therimdentalcare.com/patient-portal",
    websiteLink: "https://therimdentalcare.com",
    wwwUrl: "https://www.therimdentalcare.com",
    phoneNumber: "+17262023123",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/therimdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "therimdentalcare",
    hostedZoneId: "Z062554333J0IQ9RHN2OP",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "therimdentalcare@gmail.com",
        fromEmail: "therimdentalcare@gmail.com",
        fromName: "The Rim Dental Care"
      },
      domain: {
        imapHost: "mail.therimdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.therimdentalcare.com",
        smtpPort: 465,
        smtpUser: "Dentist@therimdentalcare.com",
        fromEmail: "Dentist@therimdentalcare.com",
        fromName: "The Rim Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "737273779478519",
        pageName: "The Rim Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5001733364"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinbloomingdale",
    microsoftClarityProjectId: "prdid5gc91",
    ga4PropertyId: "470493714",
    odooCompanyId: 27,
    clinicAddress: "366 W Army Trail Rd #310a, Bloomingdale, IL 60108, USA",
    clinicCity: "Bloomingdale",
    clinicEmail: "Dentalcare@dentistinbloomingdaleil.com",
    clinicFax: "(630) 686-1327",
    clinicName: "Dentist in Bloomingdale",
    clinicZipCode: "60108",
    clinicPhone: "(630) 686-1328",
    clinicState: "Illinois",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinbloomingdaleil.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/e7WeCV2FKXuTbyMA6",
    scheduleUrl: "https://dentistinbloomingdaleil.com/patient-portal",
    websiteLink: "https://dentistinbloomingdaleil.com",
    wwwUrl: "https://www.dentistinbloomingdaleil.com",
    phoneNumber: "+16302969003",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinbloomingdaleil.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinbloomingdale",
    hostedZoneId: "Z0168184178UA6OJU34E4",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinbloomingdale@gmail.com",
        fromEmail: "dentistinbloomingdale@gmail.com",
        fromName: "Dentist in Bloomingdale"
      },
      domain: {
        imapHost: "mail.dentistinbloomingdaleil.com",
        imapPort: 993,
        smtpHost: "mail.dentistinbloomingdaleil.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinbloomingdaleil.com",
        fromEmail: "Dentalcare@dentistinbloomingdaleil.com",
        fromName: "Dentist in Bloomingdale"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "795753343619807",
        pageName: "Dentist in Bloomingdale"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5553837131"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinvernonhills",
    microsoftClarityProjectId: "prdmxxnpab",
    ga4PropertyId: "470562527",
    odooCompanyId: 32,
    clinicAddress: "6826 Bardstown Road, VernonHills, Illinois, 40291, USA",
    clinicCity: "VernonHills",
    clinicEmail: "DentalCare@DentistinVernonHills.com",
    clinicFax: "",
    clinicName: "Dentist in Vernon Hills",
    clinicZipCode: "40291",
    clinicPhone: "(847) 978-4077",
    clinicState: "Illinois",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinvernonhills.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/3EJBccxEGW41P8Rh7",
    scheduleUrl: "https://dentistinvernonhills.com/patient-portal",
    websiteLink: "https://dentistinvernonhills.com",
    wwwUrl: "https://www.dentistinvernonhills.com",
    phoneNumber: "+18472608875",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinvernonhills.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinvernonhills",
    hostedZoneId: "Z01676602Q7T5NJOJ0NZU",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinvernonhills@gmail.com",
        fromEmail: "dentistinvernonhills@gmail.com",
        fromName: "Dentist in Vernon Hills"
      },
      domain: {
        imapHost: "mail.dentistinvernonhills.com",
        imapPort: 993,
        smtpHost: "mail.dentistinvernonhills.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinVernonHills.com",
        fromEmail: "DentalCare@DentistinVernonHills.com",
        fromName: "Dentist in Vernon Hills"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "817804011415991",
        pageName: "Dentist in Vernon Hills"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4656582027"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "meadowsdentalcare",
    microsoftClarityProjectId: "q5nl2vx1uk",
    ga4PropertyId: "472533442",
    odooCompanyId: 36,
    clinicAddress: "9600 S I-35 Frontage Rd Bldg S #275, Austin, TX 78748, United States",
    clinicCity: "Austin",
    clinicEmail: "dentist@themeadowsdentalcare.com",
    clinicFax: "(737) 263-1592",
    clinicName: "Meadows Dental Care",
    clinicZipCode: "78748",
    clinicPhone: "(737) 263-1581",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://themeadowsdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Hz4S86nieDoEJyZi6",
    scheduleUrl: "https://themeadowsdentalcare.com/patient-portal",
    websiteLink: "https://themeadowsdentalcare.com",
    wwwUrl: "https://www.themeadowsdentalcare.com",
    phoneNumber: "+17372273831",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/themeadowsdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "meadowsdentalcare",
    hostedZoneId: "Z0228748YTYJQTBTCWH1",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "meadowsdentalcare@gmail.com",
        fromEmail: "meadowsdentalcare@gmail.com",
        fromName: "Meadows Dental Care"
      },
      domain: {
        imapHost: "mail.themeadowsdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.themeadowsdentalcare.com",
        smtpPort: 465,
        smtpUser: "dentist@themeadowsdentalcare.com",
        fromEmail: "dentist@themeadowsdentalcare.com",
        fromName: "Meadows Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "761234307081671",
        pageName: "Meadows Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "7115897921"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinstillwater",
    microsoftClarityProjectId: "qxvqxbsvlr",
    ga4PropertyId: "489087064",
    odooCompanyId: 39,
    clinicAddress: "5619 W. Loop, 1604 N Ste 112, San Antonio, TX 78253-5795",
    clinicCity: "San Antonio",
    clinicEmail: "dentalcare@stillwaterdentalcareandortho.com",
    clinicFax: "",
    clinicName: "Dentist in Still Water",
    clinicZipCode: "78253-5795",
    clinicPhone: "254-492-3224",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://stillwaterdentalcareandortho.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Gc14g4dakEXrwbTi7",
    scheduleUrl: "https://stillwaterdentalcareandortho.com/patient-portal",
    websiteLink: "https://stillwaterdentalcareandortho.com",
    wwwUrl: "https://www.stillwaterdentalcareandortho.com",
    phoneNumber: "+12542250133",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/stillwaterdentalcareandortho.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinstillwater",
    hostedZoneId: "Z029178313VFV0GYWY3NS",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinstillwater@gmail.com",
        fromEmail: "dentistinstillwater@gmail.com",
        fromName: "Dentist in Still Water"
      },
      domain: {
        imapHost: "mail.stillwaterdentalcareandortho.com",
        imapPort: 993,
        smtpHost: "mail.stillwaterdentalcareandortho.com",
        smtpPort: 465,
        smtpUser: "dentalcare@stillwaterdentalcareandortho.com",
        fromEmail: "dentalcare@stillwaterdentalcareandortho.com",
        fromName: "Dentist in Still Water"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "717972378076257",
        pageName: "Dentist in Still Water"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9116392960"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "pearlanddentalcare",
    microsoftClarityProjectId: "sff0eb093t",
    ga4PropertyId: "501638627",
    odooCompanyId: 40,
    clinicAddress: "1921 N Main St Ste 115, Pearland TX 77581",
    clinicCity: "Pearland",
    clinicEmail: "dentalcare@pearlanddentalcare.com",
    clinicFax: "",
    clinicName: "Pearland Dental Care",
    clinicZipCode: "77581",
    clinicPhone: "832-955-1682",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://pearlanddentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/9ZFsgFAnRKyJmj5s6",
    scheduleUrl: "https://pearlanddentalcare.com/patient-portal",
    websiteLink: "https://pearlanddentalcare.com",
    wwwUrl: "https://www.pearlanddentalcare.com",
    phoneNumber: "+18322806867",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/pearlanddentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "pearlanddentalcare",
    hostedZoneId: "Z02753391M42GQCRXDDCE",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "pearlanddentalcare@gmail.com",
        fromEmail: "pearlanddentalcare@gmail.com",
        fromName: "Pearland Dental Care"
      },
      domain: {
        imapHost: "mail.pearlanddentalcare.com",
        imapPort: 993,
        smtpHost: "mail.pearlanddentalcare.com",
        smtpPort: 465,
        smtpUser: "dentalcare@pearlanddentalcare.com",
        fromEmail: "dentalcare@pearlanddentalcare.com",
        fromName: "Pearland Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "764480776752152",
        pageName: "Pearland Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8278105993"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  }
];

// src/shared/utils/cors.ts
init_secrets_helper();
var clinicsData = clinic_config_default;
function toOrigin(maybeUrl) {
  try {
    const s = String(maybeUrl || "").trim();
    if (!s)
      return null;
    return new URL(s).origin;
  } catch {
    return null;
  }
}
var STATIC_ALLOWED_ORIGIN_INPUTS = [
  "https://todaysdentalinsights.com",
  "https://www.todaysdentalinsights.com",
  // Local development origins (frontend runs on port 3000 via Vite)
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...clinicsData.map((c) => c.websiteLink).filter(Boolean),
  ...clinicsData.map((c) => c.wwwUrl).filter(Boolean)
];
var ALLOWED_ORIGINS_LIST = Array.from(
  new Set(STATIC_ALLOWED_ORIGIN_INPUTS.map(toOrigin).filter(Boolean))
);
var DEFAULT_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
var DEFAULT_HEADERS = ["Content-Type", "Authorization", "X-Requested-With", "Referer", "X-Clinic-Id"];
function getAllowedOrigin(requestOrigin, allowedOrigins = ALLOWED_ORIGINS_LIST) {
  const origin = requestOrigin?.trim();
  console.log("[CORS] Determining allowed origin", { requestOrigin: origin, allowedOrigins: allowedOrigins.slice(0, 5) });
  if (!origin) {
    return allowedOrigins[0];
  }
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return origin;
  }
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)) {
    return origin;
  }
  if (allowedOrigins.includes(origin)) {
    return origin;
  }
  console.warn("[CORS] Request origin not allowed, using default:", { requestOrigin: origin, defaultOrigin: allowedOrigins[0] });
  return allowedOrigins[0];
}
function buildCorsHeaders(options = {}, requestOrigin) {
  const allowOrigin = options.allowOrigin || getAllowedOrigin(requestOrigin);
  const allowMethods = (options.allowMethods || DEFAULT_METHODS).join(", ");
  const uniqueHeaders = Array.from(/* @__PURE__ */ new Set([...options.allowHeaders || [], ...DEFAULT_HEADERS]));
  const allowHeaders = uniqueHeaders.join(", ");
  const headers = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": allowMethods,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Credentials": "true"
  };
  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (maxAgeSeconds > 0)
    headers["Access-Control-Max-Age"] = String(maxAgeSeconds);
  console.log("[CORS] Generated headers:", headers);
  return headers;
}

// src/shared/utils/permissions-helper.ts
var import_zlib = require("zlib");
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
      const json = (0, import_zlib.inflateSync)(Buffer.from(b64, "base64")).toString("utf-8");
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
function isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin) {
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return true;
  }
  for (const cr of clinicRoles) {
    if (cr.role === "Admin" || cr.role === "SuperAdmin" || cr.role === "Global super admin") {
      return true;
    }
  }
  return false;
}
function hasModulePermission(clinicRoles, module2, permission, isSuperAdmin, isGlobalSuperAdmin, clinicId) {
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }
  for (const cr of clinicRoles) {
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }
    const moduleAccess = cr.moduleAccess?.find((ma) => ma.module === module2);
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }
  return false;
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

// src/integrations/communication/notify.ts
init_secrets_helper();

// src/shared/utils/clinic-placeholders.ts
init_secrets_helper();
async function buildClinicPlaceholders(clinicId) {
  const clinic = await getClinicConfig(clinicId);
  if (!clinic) {
    console.warn(`[ClinicPlaceholders] No config found for clinic: ${clinicId}`);
    return {
      clinic_name: "",
      phone_number: "",
      clinic_address: "",
      clinic_url: "",
      clinic_email: "",
      maps_url: "",
      schedule_url: "",
      logo_url: "",
      fax_number: "",
      clinic_city: "",
      clinic_state: "",
      clinic_zip: ""
    };
  }
  const addressParts = [
    clinic.clinicAddress || ""
  ].filter(Boolean);
  const fullAddress = addressParts.join(", ");
  const placeholders = {
    // Primary placeholders (as requested)
    clinic_name: String(clinic.clinicName || ""),
    phone_number: String(clinic.clinicPhone || clinic.phoneNumber || ""),
    clinic_phone: String(clinic.clinicPhone || clinic.phoneNumber || ""),
    // Alias for phone_number
    clinic_address: fullAddress,
    clinic_url: String(clinic.websiteLink || ""),
    clinic_email: String(clinic.clinicEmail || ""),
    maps_url: String(clinic.mapsUrl || ""),
    // Additional useful placeholders
    schedule_url: String(clinic.scheduleUrl || ""),
    logo_url: String(clinic.logoUrl || ""),
    fax_number: String(clinic.clinicFax || ""),
    clinic_city: String(clinic.clinicCity || ""),
    clinic_state: String(clinic.clinicState || ""),
    clinic_zip: String(clinic.clinicZipCode || ""),
    // Also include original field names for backwards compatibility
    clinicName: String(clinic.clinicName || ""),
    clinicPhone: String(clinic.clinicPhone || ""),
    clinicAddress: String(clinic.clinicAddress || ""),
    clinicEmail: String(clinic.clinicEmail || ""),
    clinicCity: String(clinic.clinicCity || ""),
    clinicState: String(clinic.clinicState || ""),
    CliniczipCode: String(clinic.clinicZipCode || ""),
    clinicFax: String(clinic.clinicFax || ""),
    websiteLink: String(clinic.websiteLink || ""),
    mapsUrl: String(clinic.mapsUrl || ""),
    scheduleUrl: String(clinic.scheduleUrl || ""),
    logoUrl: String(clinic.logoUrl || ""),
    phoneNumber: String(clinic.phoneNumber || "")
  };
  return placeholders;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function renderTemplate(template, context) {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    const safeValue = String(value);
    const doubleBraceRegex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    const singleBraceRegex = new RegExp(`\\{${escapeRegExp(key)}\\}`, "g");
    result = result.replace(doubleBraceRegex, safeValue).replace(singleBraceRegex, safeValue);
  }
  return result;
}
async function buildTemplateContext(clinicId, additionalData) {
  const clinicContext = await buildClinicPlaceholders(clinicId);
  if (!additionalData) {
    return clinicContext;
  }
  const mergedContext = { ...clinicContext };
  for (const [key, value] of Object.entries(additionalData)) {
    if (value !== void 0 && value !== null) {
      mergedContext[key] = String(value);
    }
  }
  const fname = String(additionalData.FName || additionalData.fname || additionalData.FirstName || additionalData.firstName || additionalData.first_name || "").trim();
  const lname = String(additionalData.LName || additionalData.lname || additionalData.LastName || additionalData.lastName || additionalData.last_name || "").trim();
  if (fname || lname) {
    const fullName = [fname, lname].filter(Boolean).join(" ");
    mergedContext["patient_name"] = fullName;
    mergedContext["first_name"] = fname;
    mergedContext["last_name"] = lname;
    if (fname && !mergedContext["FName"])
      mergedContext["FName"] = fname;
    if (lname && !mergedContext["LName"])
      mergedContext["LName"] = lname;
  }
  return mergedContext;
}

// src/integrations/communication/notify.ts
var import_client_sesv2 = require("@aws-sdk/client-sesv2");
var import_crypto2 = require("crypto");

// src/services/shared/unsubscribe.ts
var import_crypto = require("crypto");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "todays-dental-unsubscribe-secret-key-2024";
function generateUnsubscribeToken(payload) {
  const tokenPayload = {
    ...payload,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1e3
    // 30 days expiration
  };
  const data = JSON.stringify(tokenPayload);
  const base64Data = Buffer.from(data).toString("base64url");
  const signature = (0, import_crypto.createHmac)("sha256", UNSUBSCRIBE_SECRET).update(base64Data).digest("base64url");
  return `${base64Data}.${signature}`;
}
function generateUnsubscribeLink(baseUrl, payload) {
  const token = generateUnsubscribeToken(payload);
  return `${baseUrl}/unsubscribe/${encodeURIComponent(token)}`;
}
function generateListUnsubscribeHeader(unsubscribeUrl, clinicEmail) {
  return {
    listUnsubscribe: `<${unsubscribeUrl}>, <mailto:${clinicEmail}?subject=unsubscribe>`,
    listUnsubscribePost: "List-Unsubscribe=One-Click"
  };
}
async function isUnsubscribed(ddb2, tableName, identifier, clinicId, channel) {
  try {
    let pk;
    if (identifier.patientId) {
      pk = `PREF#${identifier.patientId}`;
    } else if (identifier.email) {
      pk = `EMAIL#${identifier.email.toLowerCase()}`;
    } else if (identifier.phone) {
      pk = `PHONE#${normalizePhone(identifier.phone)}`;
    } else {
      return false;
    }
    const clinicPref = await ddb2.send(new import_lib_dynamodb.GetCommand({
      TableName: tableName,
      Key: { pk, sk: `CLINIC#${clinicId}` }
    }));
    if (clinicPref.Item) {
      const pref = clinicPref.Item;
      if (pref.unsubscribedChannels?.includes(channel)) {
        return true;
      }
    }
    const globalPref = await ddb2.send(new import_lib_dynamodb.GetCommand({
      TableName: tableName,
      Key: { pk, sk: "GLOBAL" }
    }));
    if (globalPref.Item) {
      const pref = globalPref.Item;
      if (pref.unsubscribedChannels?.includes(channel)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error("Error checking unsubscribe status:", error);
    return false;
  }
}
function normalizePhone(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+"))
    return cleaned;
  if (cleaned.length === 10)
    return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1"))
    return `+${cleaned}`;
  return `+${cleaned}`;
}
function generateEmailUnsubscribeFooter(unsubscribeLink, clinicName) {
  return `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666;">
      <p>
        You received this email because you are a patient of ${clinicName || "our dental clinic"}. 
        If you no longer wish to receive these emails, you can 
        <a href="${unsubscribeLink}" style="color: #0066cc;">unsubscribe here</a>.
      </p>
    </div>
  `;
}
function generateSmsUnsubscribeText(shortUrl) {
  if (shortUrl) {
    return `

Reply STOP to unsubscribe or visit ${shortUrl}`;
  }
  return "\n\nReply STOP to unsubscribe.";
}

// src/integrations/communication/notify.ts
var { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require("@aws-sdk/client-pinpoint-sms-voice-v2");
var REQUIRED_ENV_VARS = ["TEMPLATES_TABLE", "NOTIFICATIONS_TABLE"];
var ENV_VARS = REQUIRED_ENV_VARS.reduce((acc, key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return { ...acc, [key]: value };
}, {});
var ddb = import_lib_dynamodb2.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var ses = new import_client_sesv2.SESv2Client({});
var sms = new PinpointSMSVoiceV2Client({});
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var SMA_ID_MAP_PARAMETER_NAME = process.env.SMA_ID_MAP_PARAMETER_NAME || "";
var VOICE_CALL_ANALYTICS_TABLE = process.env.VOICE_CALL_ANALYTICS_TABLE || "";
var chimeMeetings = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
var chimeVoice = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var ssm = new import_client_ssm.SSMClient({ region: process.env.AWS_REGION || "us-east-1" });
var cachedSmaIdMap = null;
async function getSmaIdMap() {
  if (cachedSmaIdMap)
    return cachedSmaIdMap;
  if (!SMA_ID_MAP_PARAMETER_NAME) {
    console.warn("[Notify/CALL] SMA_ID_MAP_PARAMETER_NAME not configured; CALL notifications will fail");
    cachedSmaIdMap = {};
    return cachedSmaIdMap;
  }
  try {
    const resp = await ssm.send(new import_client_ssm.GetParameterCommand({ Name: SMA_ID_MAP_PARAMETER_NAME }));
    cachedSmaIdMap = resp.Parameter?.Value ? JSON.parse(resp.Parameter.Value) : {};
    return cachedSmaIdMap || {};
  } catch (err) {
    console.error("[Notify/CALL] Failed to load SMA ID map from SSM:", err);
    cachedSmaIdMap = {};
    return cachedSmaIdMap;
  }
}
async function getSmaIdForClinic(clinicId) {
  const map = await getSmaIdMap();
  if (map[clinicId])
    return map[clinicId];
  return map["default"] || Object.values(map)[0];
}
async function getClinicSesIdentityArn(clinicId) {
  const config = await getClinicConfig(clinicId);
  return config?.sesIdentityArn;
}
async function getClinicSmsOriginationArn(clinicId) {
  const config = await getClinicConfig(clinicId);
  return config?.smsOriginationArn;
}
async function getClinicEmail(clinicId) {
  const config = await getClinicConfig(clinicId);
  return config?.clinicEmail;
}
async function getClinicName(clinicId) {
  const config = await getClinicConfig(clinicId);
  return config?.clinicName || "Dental Clinic";
}
var UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || "";
var UNSUBSCRIBE_BASE_URL = process.env.UNSUBSCRIBE_BASE_URL || "https://apig.todaysdentalinsights.com/notifications";
var getCorsHeaders = (event) => buildCorsHeaders({}, event.headers?.origin);
var MODULE_NAME = "Marketing";
var METHOD_PERMISSIONS = {
  GET: "read",
  POST: "write",
  PUT: "put",
  DELETE: "delete"
};
function http(code, body, event) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return { statusCode: code, headers: getCorsHeaders(event), body: payload };
}
function parseBody(body) {
  try {
    return typeof body === "string" ? JSON.parse(body) : body || {};
  } catch {
    return {};
  }
}
async function handleSendNotification(event, userPerms, allowedClinics) {
  const pathClinicId = event.pathParameters?.clinicId;
  if (!pathClinicId)
    return http(400, { error: "Missing clinicId in path" }, event);
  if (!hasClinicAccess(allowedClinics, pathClinicId)) {
    return http(403, { error: "Forbidden: no access to this clinic" }, event);
  }
  if (!hasModulePermission(
    userPerms.clinicRoles,
    "Marketing",
    "write",
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    pathClinicId
  )) {
    return http(403, { error: "You do not have permission to send notifications for this clinic" }, event);
  }
  const sentBy = userPerms.email || "authenticated_user";
  const body = parseBody(event.body);
  const clinicId = pathClinicId;
  const patNum = String(body.PatNum || "").trim();
  const templateMessage = String(body.templateMessage || "").trim();
  const notificationTypes = Array.isArray(body.notificationTypes) ? body.notificationTypes : ["EMAIL"];
  const fname = String(body.FName || "").trim();
  const lname = String(body.LName || "").trim();
  let email = String(body.email || body.toEmail || body.Email || "").trim();
  let phone = String(body.toPhone || body.phone || body.phoneNumber || body.SMS || "").trim();
  const customEmailSubject = String(body.customEmailSubject || "").trim();
  const customEmailHtml = String(body.customEmailHtml || body.customEmailBody || "").trim();
  const customSmsText = String(body.customSmsText || body.textMessage || "").trim();
  const customVoiceText = String(body.customVoiceText || "").trim();
  if (!patNum)
    return http(400, { error: "PatNum is required" }, event);
  const needEmail = notificationTypes.includes("EMAIL") && (!email || !email.includes("@"));
  const needPhone = notificationTypes.includes("SMS") && !phone;
  if (needEmail || needPhone) {
    try {
      const contact = await fetchPatientContact(clinicId, patNum);
      if (needEmail && contact.email)
        email = contact.email;
      if (needPhone && contact.phone)
        phone = contact.phone;
    } catch (lookupErr) {
      console.warn("[Notify] Best-effort patient contact lookup failed (non-fatal):", lookupErr);
    }
  }
  if (notificationTypes.includes("EMAIL") && (!email || !email.includes("@"))) {
    return http(400, { error: "Valid email is required for EMAIL notification type" }, event);
  }
  const isCustomEmail = !templateMessage && (!!customEmailSubject || !!customEmailHtml);
  const isCustomSms = !templateMessage && !!customSmsText;
  const isCustomCall = !templateMessage && !!customVoiceText;
  let template = null;
  if (templateMessage) {
    template = await fetchTemplateByName(templateMessage);
    if (!template) {
      return http(400, { error: `Template not found: ${templateMessage}` }, event);
    }
  }
  if (notificationTypes.includes("EMAIL") && !template && !isCustomEmail) {
    return http(400, { error: "Either templateMessage or custom email content (customEmailSubject/customEmailHtml) is required for EMAIL" }, event);
  }
  if (notificationTypes.includes("SMS") && !template && !isCustomSms) {
    return http(400, { error: "Either templateMessage or customSmsText is required for SMS" }, event);
  }
  if (notificationTypes.includes("CALL") && !template && !isCustomCall) {
    return http(400, { error: "Either templateMessage or customVoiceText is required for CALL" }, event);
  }
  const results = { email: null, sms: null, skipped: [] };
  const mergedCtx = await buildTemplateContext(clinicId, { FName: fname, LName: lname });
  if (notificationTypes.includes("EMAIL")) {
    const emailUnsubscribed = UNSUBSCRIBE_TABLE ? await isUnsubscribed(
      ddb,
      UNSUBSCRIBE_TABLE,
      { patientId: patNum, email },
      clinicId,
      "EMAIL"
    ) : false;
    if (emailUnsubscribed) {
      console.log(`Skipping EMAIL for patient ${patNum} - unsubscribed`);
      results.skipped.push({ channel: "EMAIL", reason: "unsubscribed" });
      await storeNotification({
        patNum,
        clinicId,
        type: "EMAIL",
        email,
        templateName: templateMessage || "custom",
        sentBy,
        status: "SKIPPED_UNSUBSCRIBED"
      });
    } else {
      try {
        let subjectStr;
        let htmlStr;
        if (isCustomEmail) {
          subjectStr = renderTemplateString(customEmailSubject || "Notification", mergedCtx);
          htmlStr = renderTemplateString(customEmailHtml, mergedCtx);
        } else {
          subjectStr = template ? renderTemplateString(String(template.email_subject || "Notification"), mergedCtx) : "Notification";
          htmlStr = template ? renderTemplateString(String(template.email_body || ""), mergedCtx) : "";
        }
        const textAltStr = htmlStr ? htmlStr.replace(/<[^>]+>/g, " ") : "";
        const unsubscribeLink = generateUnsubscribeLink(UNSUBSCRIBE_BASE_URL, {
          patientId: patNum,
          email,
          clinicId,
          channel: "EMAIL"
        });
        const clinicName = await getClinicName(clinicId);
        const unsubscribeFooter = generateEmailUnsubscribeFooter(unsubscribeLink, clinicName);
        htmlStr = htmlStr + unsubscribeFooter;
        await sendEmail({
          clinicId,
          to: email,
          subject: subjectStr,
          html: htmlStr || textAltStr,
          text: textAltStr || htmlStr,
          patNum,
          templateName: templateMessage || "custom",
          sentBy,
          unsubscribeLink
        });
        results.email = email;
        await storeNotification({
          patNum,
          clinicId,
          type: "EMAIL",
          email,
          subject: subjectStr,
          message: htmlStr || textAltStr,
          templateName: templateMessage || "custom",
          sentBy,
          status: "SENT"
        });
      } catch (error) {
        console.error("Failed to send email:", {
          clinicId,
          to: email,
          errorName: error?.name,
          errorMessage: error?.message,
          errorCode: error?.$metadata?.httpStatusCode,
          requestId: error?.$metadata?.requestId
        });
        await storeNotification({
          patNum,
          clinicId,
          type: "EMAIL",
          email,
          templateName: templateMessage || "custom",
          sentBy,
          status: "FAILED"
        });
        return http(500, { error: "Failed to send email notification", details: error?.message || "Unknown error" }, event);
      }
    }
  }
  if (notificationTypes.includes("SMS")) {
    const normalizedPhone = normalizePhone2(phone);
    if (!normalizedPhone)
      return http(400, { error: "No phone provided for SMS" }, event);
    const smsUnsubscribed = UNSUBSCRIBE_TABLE ? await isUnsubscribed(
      ddb,
      UNSUBSCRIBE_TABLE,
      { patientId: patNum, phone: normalizedPhone },
      clinicId,
      "SMS"
    ) : false;
    if (smsUnsubscribed) {
      console.log(`Skipping SMS for patient ${patNum} - unsubscribed`);
      results.skipped.push({ channel: "SMS", reason: "unsubscribed" });
      await storeNotification({
        patNum,
        clinicId,
        type: "SMS",
        phone: normalizedPhone,
        templateName: templateMessage || "custom",
        sentBy,
        status: "SKIPPED_UNSUBSCRIBED"
      });
    } else {
      let smsBody;
      if (isCustomSms) {
        smsBody = renderTemplateString(customSmsText, mergedCtx);
      } else {
        smsBody = template ? renderTemplateString(String(template.text_message || ""), mergedCtx) : "";
      }
      if (!smsBody)
        return http(400, { error: "No SMS content provided (template or custom)" }, event);
      smsBody = smsBody + generateSmsUnsubscribeText();
      try {
        await sendSms({ clinicId, to: normalizedPhone, body: smsBody });
        results.sms = normalizedPhone;
        await storeNotification({
          patNum,
          clinicId,
          type: "SMS",
          phone: normalizedPhone,
          message: smsBody,
          templateName: templateMessage || "custom",
          sentBy,
          status: "SENT"
        });
      } catch (error) {
        console.error("Failed to send SMS:", error);
        await storeNotification({
          patNum,
          clinicId,
          type: "SMS",
          phone: normalizedPhone,
          message: smsBody,
          templateName: templateMessage || "custom",
          sentBy,
          status: "FAILED"
        });
        return http(500, { error: "Failed to send SMS notification" }, event);
      }
    }
  }
  if (notificationTypes.includes("CALL")) {
    let phoneRaw = String(body.toPhone || body.phone || body.phoneNumber || body.CALL || "").trim();
    if (!phoneRaw) {
      try {
        const contact = await fetchPatientContact(clinicId, patNum);
        phoneRaw = String(contact.phone || "").trim();
      } catch (err) {
        console.warn("[Notify/CALL] Failed to fetch patient contact (non-fatal):", err);
      }
    }
    const toPhone = normalizePhone2(phoneRaw);
    if (!toPhone)
      return http(400, { error: "No phone provided for CALL" }, event);
    const clinicConfig = await getClinicConfig(clinicId);
    const fromPhone = normalizePhone2(String(clinicConfig?.phoneNumber || clinicConfig?.clinicPhone || ""));
    if (!fromPhone)
      return http(400, { error: `Clinic ${clinicId} does not have a valid outbound phoneNumber configured` }, event);
    let callText;
    if (isCustomCall) {
      callText = renderTemplateString(customVoiceText, mergedCtx);
    } else {
      const tplText = String(template?.voice_message || template?.text_message || "");
      callText = renderTemplateString(tplText, mergedCtx);
    }
    callText = String(callText || "").trim();
    if (!callText)
      return http(400, { error: "No CALL content provided (template.voice_message or customVoiceText)" }, event);
    const voiceId = String(body.voiceId || template?.voice_voiceId || "Joanna").trim() || "Joanna";
    const engineRaw = String(body.voiceEngine || template?.voice_engine || "neural").toLowerCase();
    const voiceEngine = engineRaw === "standard" ? "standard" : "neural";
    const voiceLanguageCode = String(body.voiceLanguageCode || template?.voice_languageCode || "en-US").trim() || "en-US";
    const smaId = await getSmaIdForClinic(clinicId);
    if (!smaId) {
      return http(500, { error: `No SIP Media Application configured for clinic ${clinicId}` }, event);
    }
    const externalMeetingId = `mkt-call-${clinicId}-${patNum}-${Date.now()}`.slice(0, 64);
    const meetingRes = await chimeMeetings.send(new import_client_chime_sdk_meetings.CreateMeetingCommand({
      ClientRequestToken: (0, import_crypto2.randomUUID)(),
      MediaRegion: CHIME_MEDIA_REGION,
      ExternalMeetingId: externalMeetingId
    }));
    const meetingId = meetingRes.Meeting?.MeetingId;
    if (!meetingId) {
      return http(500, { error: "Failed to create meeting for CALL" }, event);
    }
    try {
      const callRes = await chimeVoice.send(new import_client_chime_sdk_voice.CreateSipMediaApplicationCallCommand({
        FromPhoneNumber: fromPhone,
        ToPhoneNumber: toPhone,
        SipMediaApplicationId: smaId,
        ArgumentsMap: {
          callType: "MarketingOutbound",
          clinicId: String(clinicId),
          fromClinicId: String(clinicId),
          meetingId: String(meetingId),
          patNum: String(patNum),
          patientName: String([fname, lname].filter(Boolean).join(" ")),
          templateName: String(templateMessage || "custom"),
          sentBy: String(sentBy),
          voice_message: callText,
          voice_voiceId: String(voiceId),
          voice_engine: String(voiceEngine),
          voice_languageCode: String(voiceLanguageCode),
          toPhoneNumber: String(toPhone),
          fromPhoneNumber: String(fromPhone)
        }
      }));
      const callId = callRes?.SipMediaApplicationCall?.TransactionId;
      results.call = { to: toPhone, callId };
      await storeNotification({
        patNum,
        clinicId,
        type: "CALL",
        phone: toPhone,
        message: callText,
        templateName: templateMessage || "custom",
        sentBy,
        status: "SENT"
      }).catch((err) => console.warn("[Notify/CALL] Failed to store notification record (non-fatal):", err));
      if (VOICE_CALL_ANALYTICS_TABLE && callId) {
        const now = /* @__PURE__ */ new Date();
        const ttl = Math.floor(now.getTime() / 1e3) + 365 * 24 * 60 * 60;
        await ddb.send(new import_lib_dynamodb2.PutCommand({
          TableName: VOICE_CALL_ANALYTICS_TABLE,
          Item: {
            callId,
            clinicId,
            patNum,
            patientName: String([fname, lname].filter(Boolean).join(" ")),
            recipientPhone: toPhone,
            fromPhoneNumber: fromPhone,
            templateName: templateMessage || "custom",
            status: "INITIATED",
            startedAt: now.toISOString(),
            voiceId,
            voiceEngine,
            voiceLanguageCode,
            meetingId,
            sentBy,
            source: "send",
            ttl
          }
        }));
      }
    } catch (err) {
      try {
        await chimeMeetings.send(new import_client_chime_sdk_meetings.DeleteMeetingCommand({ MeetingId: meetingId }));
      } catch (cleanupErr) {
        console.warn("[Notify/CALL] Failed to cleanup meeting after call failure:", cleanupErr);
      }
      console.error("Failed to start CALL:", err);
      await storeNotification({
        patNum,
        clinicId,
        type: "CALL",
        phone: toPhone,
        message: callText,
        templateName: templateMessage || "custom",
        sentBy,
        status: "FAILED"
      }).catch(() => void 0);
      return http(500, { error: "Failed to start CALL notification" }, event);
    }
  }
  return http(200, { success: true, sent: results, clinicId, patNum, template: templateMessage || "custom", sent_by: sentBy }, event);
}
var handler = async (event) => {
  try {
    console.log("[NotifyHandler] requestContext.authorizer:", JSON.stringify(event.requestContext?.authorizer || {}));
  } catch (err) {
  }
  if (event.httpMethod === "OPTIONS")
    return http(204, "", event);
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return http(401, { error: "Unauthorized - Invalid token" }, event);
  }
  const requiredPermission = METHOD_PERMISSIONS[event.httpMethod] || "read";
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return http(403, { error: `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module` }, event);
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin) || allowedClinics.has("*");
  const path = event.path || "";
  const isGetNotifications = path.endsWith("/notifications/notifications");
  if (event.httpMethod === "GET" && isGetNotifications) {
    return await handleGetNotifications(event, userPerms, allowedClinics, isAdmin);
  }
  const isClinicNotification = path.match(/\/clinic\/([^\/]+)\/notification$/);
  if (event.httpMethod === "POST" && isClinicNotification) {
    return await handleSendNotification(event, userPerms, allowedClinics);
  }
  const isSmsDashboard = path.endsWith("/sms-analytics/dashboard");
  if (event.httpMethod === "GET" && isSmsDashboard) {
    return await handleGetSmsAnalytics(event, allowedClinics, isAdmin);
  }
  const isSmsMessages = path.endsWith("/sms-analytics/messages");
  if (event.httpMethod === "GET" && isSmsMessages) {
    return await handleGetSmsMessages(event, allowedClinics, isAdmin);
  }
  return http(405, { error: "Method Not Allowed" }, event);
};
async function handleGetNotifications(event, userPerms, allowedClinics, isAdmin) {
  try {
    console.log("[handleGetNotifications] userPerms:", JSON.stringify(userPerms || {}));
  } catch (err) {
  }
  const query = event.queryStringParameters || {};
  const patNum = String(query.PatNum || "").trim();
  const email = String(query.email || "").trim();
  const clinicId = String(query.clinicId || "").trim();
  if (!patNum) {
    return http(400, { error: "PatNum query parameter is required" }, event);
  }
  const hasAccess = allowedClinics.size > 0 || isAdmin;
  if (!hasAccess)
    return http(403, { error: "Forbidden: no clinic access" }, event);
  if (clinicId && !isAdmin && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: "Forbidden: not authorized for this clinic" }, event);
  }
  let notifications = [];
  if (clinicId) {
    notifications = await getNotificationsForPatient(patNum, email, clinicId);
  } else if (isAdmin) {
    notifications = await getNotificationsForPatient(patNum, email);
  } else {
    const clinicList = Array.from(allowedClinics);
    const clinicPromises = clinicList.map((clinic) => getNotificationsForPatient(patNum, email, clinic));
    const clinicResults = await Promise.all(clinicPromises);
    notifications = clinicResults.flat();
  }
  return http(200, {
    success: true,
    patNum,
    email,
    clinicId: clinicId || null,
    notifications,
    total: notifications.length
  }, event);
}
async function fetchTemplateByName(templateName) {
  const res = await ddb.send(new import_lib_dynamodb2.ScanCommand({ TableName: ENV_VARS.TEMPLATES_TABLE }));
  const items = res.Items || [];
  return items.find((t) => String(t.template_name).toLowerCase() === String(templateName).toLowerCase()) || null;
}
function renderTemplateString(tpl, ctx) {
  return renderTemplate(tpl, ctx);
}
function normalizePhone2(p) {
  const s = String(p || "").trim();
  if (!s)
    return void 0;
  const cleaned = s.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+")) {
    const digits2 = cleaned.slice(1).replace(/\D/g, "");
    if (digits2.length < 7)
      return void 0;
    return `+${digits2}`;
  }
  const digits = cleaned.replace(/\D/g, "");
  if (!digits)
    return void 0;
  if (digits.length === 10)
    return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1"))
    return `+${digits}`;
  if (digits.length >= 7)
    return `+${digits}`;
  return void 0;
}
async function fetchPatientContact(clinicId, patNum) {
  const { getClinicSecrets: getClinicSecrets2 } = await Promise.resolve().then(() => (init_secrets_helper(), secrets_helper_exports));
  const secrets = await getClinicSecrets2(clinicId);
  if (!secrets)
    return {};
  const API_HOST = "api.opendental.com";
  const API_BASE = "/api/v1";
  const path = `${API_BASE}/patients/Simple?PatNum=${encodeURIComponent(patNum)}`;
  const headers = { Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`, "Content-Type": "application/json" };
  const resp = await httpRequest({ hostname: API_HOST, path, method: "GET", headers });
  let body;
  try {
    body = JSON.parse(resp.body);
  } catch {
    body = resp.body;
  }
  let row;
  if (Array.isArray(body)) {
    row = body.find((r) => String(r?.PatNum ?? r?.patNum ?? "") === String(patNum)) || body[0] || {};
  } else {
    row = body || {};
  }
  return extractEmailAndPhone(row);
}
async function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = import_https.default.request({ hostname: opts.hostname, path: opts.path, method: opts.method, headers: opts.headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body)
      req.write(body);
    req.end();
  });
}
function extractEmailAndPhone(row) {
  const preferredEmailFields = [
    "Email",
    "email",
    "EmailAddress",
    "emailAddress",
    "PatientEmail",
    "patientEmail"
  ];
  const preferredPhoneFields = [
    "WirelessPhone",
    "CellPhone",
    "MobilePhone",
    "Mobile",
    "Cell",
    "HmPhone",
    "HomePhone",
    "WkPhone",
    "WorkPhone",
    "Phone"
  ];
  let email;
  for (const field of preferredEmailFields) {
    const value = row?.[field];
    const str = String(value || "").trim();
    if (str && /@/.test(str)) {
      email = str;
      break;
    }
  }
  let phone;
  for (const field of preferredPhoneFields) {
    const value = row?.[field];
    const normalized = normalizePhone2(String(value || ""));
    if (normalized) {
      phone = normalized;
      break;
    }
  }
  if (!email) {
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k).toLowerCase();
      if (key.includes("clinic") || key.includes("practice"))
        continue;
      if (!/email/.test(key))
        continue;
      const val = String(v || "").trim();
      if (/@/.test(val)) {
        email = val;
        break;
      }
    }
  }
  if (!phone) {
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k).toLowerCase();
      if (!/(wireless|mobile|cell|phone|hmphone|wkphone|home|work)/.test(key))
        continue;
      const normalized = normalizePhone2(String(v || ""));
      if (normalized) {
        phone = normalized;
        break;
      }
    }
  }
  return { email, phone };
}
function sanitizeTagValue(value) {
  return value.replace(/[^a-zA-Z0-9_\-\.@]/g, "_");
}
async function sendEmail(options) {
  const { clinicId, to, subject, html, text, patNum, templateName, sentBy, unsubscribeLink } = options;
  const identityArn = await getClinicSesIdentityArn(clinicId);
  if (!identityArn)
    return { success: false };
  const clinicEmail = await getClinicEmail(clinicId);
  let from;
  if (!clinicEmail) {
    const fromDomain = identityArn.split(":identity/")[1] || "todaysdentalinsights.com";
    from = `no-reply@${fromDomain}`;
  } else {
    from = clinicEmail;
  }
  const configurationSetName = process.env.SES_CONFIGURATION_SET_NAME;
  const listUnsubscribeHeaders = {};
  if (unsubscribeLink && clinicEmail) {
    const { listUnsubscribe, listUnsubscribePost } = generateListUnsubscribeHeader(unsubscribeLink, clinicEmail);
    listUnsubscribeHeaders["List-Unsubscribe"] = listUnsubscribe;
    listUnsubscribeHeaders["List-Unsubscribe-Post"] = listUnsubscribePost;
  }
  const simpleContent = {
    Subject: { Data: subject },
    Body: {
      Html: { Data: html },
      Text: { Data: text || html.replace(/<[^>]+>/g, " ") }
    }
  };
  if (Object.keys(listUnsubscribeHeaders).length > 0) {
    simpleContent.Headers = Object.entries(listUnsubscribeHeaders).map(([name, value]) => ({
      Name: name,
      Value: value
    }));
  }
  const cmd = new import_client_sesv2.SendEmailCommand({
    FromEmailAddress: from,
    FromEmailAddressIdentityArn: identityArn,
    Destination: { ToAddresses: [to] },
    Content: { Simple: simpleContent },
    // Add configuration set for event tracking
    ConfigurationSetName: configurationSetName,
    // Add tags for tracking context
    EmailTags: [
      { Name: "clinicId", Value: sanitizeTagValue(clinicId) },
      ...patNum ? [{ Name: "patNum", Value: sanitizeTagValue(patNum) }] : [],
      ...templateName ? [{ Name: "templateName", Value: sanitizeTagValue(templateName) }] : []
    ]
  });
  let response;
  try {
    response = await ses.send(cmd);
  } catch (err) {
    if (err?.name === "ValidationException" && simpleContent.Headers) {
      console.warn("[sendEmail] SES rejected Headers field, retrying without List-Unsubscribe headers");
      delete simpleContent.Headers;
      const retryCmd = new import_client_sesv2.SendEmailCommand({
        FromEmailAddress: from,
        FromEmailAddressIdentityArn: identityArn,
        Destination: { ToAddresses: [to] },
        Content: { Simple: simpleContent },
        ConfigurationSetName: configurationSetName,
        EmailTags: [
          { Name: "clinicId", Value: sanitizeTagValue(clinicId) },
          ...patNum ? [{ Name: "patNum", Value: sanitizeTagValue(patNum) }] : [],
          ...templateName ? [{ Name: "templateName", Value: sanitizeTagValue(templateName) }] : []
        ]
      });
      response = await ses.send(retryCmd);
    } else {
      throw err;
    }
  }
  const messageId = response.MessageId;
  if (messageId) {
    await createEmailTrackingRecord({
      messageId,
      clinicId,
      recipientEmail: to,
      patNum,
      subject,
      templateName,
      sentBy
    });
  }
  return { messageId, success: true };
}
async function createEmailTrackingRecord(record) {
  const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE;
  if (!EMAIL_ANALYTICS_TABLE)
    return;
  const now = /* @__PURE__ */ new Date();
  const ttl = Math.floor(now.getTime() / 1e3) + 365 * 24 * 60 * 60;
  try {
    await ddb.send(new import_lib_dynamodb2.PutCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Item: {
        messageId: record.messageId,
        clinicId: record.clinicId,
        recipientEmail: record.recipientEmail,
        patNum: record.patNum,
        subject: record.subject,
        templateName: record.templateName,
        sentBy: record.sentBy,
        sentAt: now.toISOString(),
        status: "QUEUED",
        ttl
      }
    }));
  } catch (error) {
    console.error("Error creating email tracking record:", error);
  }
}
async function sendSms({ clinicId, to, body }) {
  const originationArn = await getClinicSmsOriginationArn(clinicId);
  if (!originationArn) {
    throw new Error(`No SMS origination identity configured for clinic ${clinicId}`);
  }
  const cmd = new SendTextMessageCommand({
    DestinationPhoneNumber: to,
    MessageBody: body,
    OriginationIdentity: originationArn,
    MessageType: "TRANSACTIONAL"
  });
  await sms.send(cmd);
}
async function storeNotification(notification) {
  const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;
  if (!NOTIFICATIONS_TABLE)
    return;
  const notificationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const item = {
    PatNum: notification.patNum,
    notificationId,
    clinicId: notification.clinicId,
    type: notification.type,
    email: notification.email,
    phone: notification.phone,
    subject: notification.subject,
    message: notification.message,
    templateName: notification.templateName,
    sentBy: notification.sentBy,
    sentAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: notification.status
  };
  try {
    await ddb.send(new import_lib_dynamodb2.PutCommand({
      TableName: ENV_VARS.NOTIFICATIONS_TABLE,
      Item: item
    }));
  } catch (err) {
    console.error("Error storing notification:", err);
    throw new Error(`Failed to store notification: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function getNotificationsForPatient(patNum, email, clinicId) {
  try {
    let items = [];
    if (clinicId) {
      const queryParams = {
        TableName: ENV_VARS.NOTIFICATIONS_TABLE,
        KeyConditionExpression: "PatNum = :patNum",
        ExpressionAttributeValues: {
          ":patNum": patNum
        }
      };
      queryParams.FilterExpression = "clinicId = :clinicId";
      queryParams.ExpressionAttributeValues[":clinicId"] = clinicId;
      const res = await ddb.send(new import_lib_dynamodb2.QueryCommand(queryParams));
      items = res.Items || [];
    } else {
      const res = await ddb.send(new import_lib_dynamodb2.ScanCommand({
        TableName: ENV_VARS.NOTIFICATIONS_TABLE,
        FilterExpression: "PatNum = :patNum",
        ExpressionAttributeValues: { ":patNum": patNum }
      }));
      items = res.Items || [];
    }
    if (email) {
      items = items.filter((n) => String(n.email || "").toLowerCase() === email.toLowerCase());
    }
    return items;
  } catch (err) {
    console.error("Error querying notifications:", err);
    return [];
  }
}
async function querySmsNotificationsByClinic(clinicId, startDate, endDate, statusFilter, limit) {
  const items = [];
  let lastEvaluatedKey = void 0;
  const maxItems = limit || 1e4;
  const expressionValues = {
    ":clinicId": clinicId,
    ":smsType": "SMS"
  };
  let keyCondition = "clinicId = :clinicId";
  if (startDate && endDate) {
    keyCondition += " AND sentAt BETWEEN :startDate AND :endDate";
    expressionValues[":startDate"] = startDate;
    expressionValues[":endDate"] = endDate;
  } else if (startDate) {
    keyCondition += " AND sentAt >= :startDate";
    expressionValues[":startDate"] = startDate;
  }
  let filterExpr = "#notifType = :smsType";
  const expressionNames = { "#notifType": "type" };
  if (statusFilter) {
    filterExpr += " AND #st = :statusFilter";
    expressionNames["#st"] = "status";
    expressionValues[":statusFilter"] = statusFilter.toUpperCase();
  }
  do {
    const params = {
      TableName: ENV_VARS.NOTIFICATIONS_TABLE,
      IndexName: "clinicId-sentAt-index",
      KeyConditionExpression: keyCondition,
      FilterExpression: filterExpr,
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames: expressionNames,
      ScanIndexForward: false,
      // newest first
      ExclusiveStartKey: lastEvaluatedKey
    };
    const res = await ddb.send(new import_lib_dynamodb2.QueryCommand(params));
    items.push(...res.Items || []);
    lastEvaluatedKey = res.LastEvaluatedKey;
    if (items.length >= maxItems)
      break;
  } while (lastEvaluatedKey);
  return items.slice(0, maxItems);
}
async function handleGetSmsAnalytics(event, allowedClinics, isAdmin) {
  const query = event.queryStringParameters || {};
  const clinicId = String(query.clinicId || "").trim();
  const period = String(query.period || "30d").trim();
  if (!clinicId) {
    return http(400, { error: "clinicId query parameter is required" }, event);
  }
  if (!isAdmin && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: "Forbidden: not authorized for this clinic" }, event);
  }
  const now = /* @__PURE__ */ new Date();
  const periodDays = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const startDate = new Date(now.getTime() - periodDays * 864e5).toISOString();
  const endDate = now.toISOString();
  try {
    const smsNotifications = await querySmsNotificationsByClinic(clinicId, startDate, endDate);
    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    for (const n of smsNotifications) {
      const status = String(n.status || "").toUpperCase();
      if (status === "SENT") {
        totalSent++;
      } else if (status === "FAILED") {
        totalFailed++;
      } else if (status === "SKIPPED_UNSUBSCRIBED") {
        totalSkipped++;
      }
    }
    const totalAttempted = smsNotifications.length;
    const deliverable = totalSent + totalFailed;
    const deliveryRate = deliverable > 0 ? Math.round(totalSent / deliverable * 100) : 0;
    return http(200, {
      clinicId,
      period,
      totalSent,
      totalDelivered: totalSent,
      // In Pinpoint SMS, successful send = delivered (no carrier receipt)
      totalFailed,
      totalPending: 0,
      // SMS is synchronous — no pending state
      totalSkipped,
      totalAttempted,
      deliveryRate,
      periodStart: startDate,
      periodEnd: endDate
    }, event);
  } catch (err) {
    console.error("[handleGetSmsAnalytics] Error:", err);
    return http(500, { error: "Failed to fetch SMS analytics" }, event);
  }
}
async function handleGetSmsMessages(event, allowedClinics, isAdmin) {
  const query = event.queryStringParameters || {};
  const clinicId = String(query.clinicId || "").trim();
  const statusFilter = String(query.status || "").trim();
  const limit = Math.min(parseInt(query.limit || "200", 10) || 200, 1e3);
  if (!clinicId) {
    return http(400, { error: "clinicId query parameter is required" }, event);
  }
  if (!isAdmin && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: "Forbidden: not authorized for this clinic" }, event);
  }
  try {
    const smsNotifications = await querySmsNotificationsByClinic(
      clinicId,
      void 0,
      // no start date — get all
      void 0,
      statusFilter || void 0,
      limit
    );
    const messages = smsNotifications.map((n) => ({
      notificationId: n.notificationId,
      clinicId: n.clinicId,
      patNum: n.PatNum,
      recipientPhone: n.phone,
      recipientName: n.recipientName || (n.FName ? `${n.FName} ${n.LName || ""}`.trim() : void 0),
      message: n.message,
      templateName: n.templateName,
      status: String(n.status || "").toLowerCase(),
      sentAt: n.sentAt,
      sentBy: n.sentBy
    }));
    return http(200, { messages, total: messages.length }, event);
  } catch (err) {
    console.error("[handleGetSmsMessages] Error:", err);
    return http(500, { error: "Failed to fetch SMS messages" }, event);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
