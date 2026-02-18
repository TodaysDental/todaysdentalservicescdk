"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/ai-agents/agents.ts
var agents_exports = {};
__export(agents_exports, {
  AVAILABLE_MODELS: () => AVAILABLE_MODELS,
  CHAT_NEGATIVE_PROMPT: () => CHAT_NEGATIVE_PROMPT,
  CHAT_SYSTEM_PROMPT: () => CHAT_SYSTEM_PROMPT,
  DEFAULT_NEGATIVE_PROMPT: () => MEDIUM_NEGATIVE_PROMPT,
  DEFAULT_SYSTEM_PROMPT: () => MEDIUM_SYSTEM_PROMPT,
  VOICE_NEGATIVE_PROMPT: () => VOICE_NEGATIVE_PROMPT,
  VOICE_SYSTEM_PROMPT: () => VOICE_SYSTEM_PROMPT,
  buildSystemPromptWithDate: () => buildMediumSystemPromptWithDate,
  default: () => agents_default,
  handler: () => handler
});
module.exports = __toCommonJS(agents_exports);
var import_client_dynamodb3 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent = require("@aws-sdk/client-bedrock-agent");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
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
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
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
    aiPhoneNumber: "+14439272295",
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

// src/shared/utils/secrets-helper.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
var CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);

// src/shared/utils/cors.ts
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
function getUserDisplayName(permissions) {
  return permissions.givenName || permissions.email || "system";
}

// src/shared/prompts/ai-prompts.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1e3;
var CLINIC_NAME_CACHE_TTL_MS = 5 * 60 * 1e3;
function getDateContext(timezone = "America/Chicago") {
  const now = /* @__PURE__ */ new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find((p) => p.type === type)?.value || "";
  const today = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
  const todayInTz = /* @__PURE__ */ new Date(`${today}T12:00:00`);
  const tomorrowInTz = new Date(todayInTz);
  tomorrowInTz.setDate(tomorrowInTz.getDate() + 1);
  const nextWeekDates = {};
  for (let i = 0; i < 7; i++) {
    const futureDate = new Date(todayInTz);
    futureDate.setDate(futureDate.getDate() + i);
    const fp = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(futureDate);
    nextWeekDates[fp.find((p) => p.type === "weekday")?.value || ""] = `${fp.find((p) => p.type === "year")?.value}-${fp.find((p) => p.type === "month")?.value}-${fp.find((p) => p.type === "day")?.value}`;
  }
  return {
    today,
    dayName: getPart("weekday"),
    tomorrowDate: new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrowInTz),
    nextWeekDates,
    currentTime: `${getPart("hour")}:${getPart("minute")} ${getPart("dayPeriod")}`,
    timezone
  };
}
var SHARED_CORE_TOOLS = `=== CORE TOOLS ===

CLINIC INFO (No PatNum needed):
\u2022 getClinicInfo - name, address, phone, hours, website, mapsUrl

PATIENT:
\u2022 searchPatients(LName, FName, Birthdate YYYY-MM-DD)
\u2022 createPatient(LName, FName, Birthdate, WirelessPhone?, Email?, Address?, City?, State?, Zip?)
\u2022 getPatientByPatNum(PatNum), getPatientInfo(PatNum)

APPOINTMENTS:
\u2022 getAppointmentSlots(date?, dateStart?, dateEnd?, lengthMinutes?, ProvNum?, OpNum?) - get available slots from OpenDental
\u2022 getClinicAppointmentTypes() - Get appointment types: label, duration, opNum, defaultProvNum, AppointmentTypeNum
\u2022 scheduleAppointment(PatNum, Reason, Date, Op, ProvNum?, AppointmentTypeNum?, duration?)
\u2022 getUpcomingAppointments(PatNum), getHistAppointments(PatNum)
\u2022 getAppointment(AptNum), getAppointments(PatNum?, date?, dateStart?, dateEnd?)
\u2022 rescheduleAppointment(AptNum, NewDateTime 'YYYY-MM-DD HH:mm:ss')
\u2022 cancelAppointment(AptNum), breakAppointment(AptNum)

INSURANCE - NO PATNUM NEEDED:
\u2022 suggestInsuranceCoverage(insuranceName, groupNumber?, groupName?) - "Do you accept my insurance?"
\u2022 checkProcedureCoverage(insuranceName, groupNumber, procedure) - coverage + cost estimate
\u2022 getCoverageBreakdown(insuranceName, groupNumber) - percentages by category
\u2022 getDeductibleInfo, getAnnualMaxInfo, getWaitingPeriodInfo, getCopayAndFrequencyInfo
\u2022 getCoordinationOfBenefits - dual insurance explanation
\u2022 getPaymentInfo - payment plans, financing, HSA/FSA
\u2022 getEstimateExplanation - why estimates may differ

PATIENT-SPECIFIC INSURANCE (PatNum required):
\u2022 getBenefits(PatNum), getClaims(PatNum), getPatPlans(PatNum)

FEES:
\u2022 getFeeForProcedure(procCode) - single procedure
\u2022 getFeeScheduleAmounts(procedures[]) - multiple, natural language OK

ACCOUNT (PatNum required):
\u2022 getAccountAging(PatNum), getPatientBalances(PatNum), getPatientAccountSummary(PatNum)

TREATMENT:
\u2022 getProcedureLogs(PatNum, ProcStatus?) - TP=treatment planned, C=completed
\u2022 getTreatmentPlans(PatNum), getProcedureCode(ProcCode)`;
var SHARED_CDT_CODES = `=== CDT CODES ===
DIAGNOSTIC: D0120 periodic exam | D0150 comprehensive/new patient | D0210 full mouth xrays | D0274 4 bitewings | D0330 panoramic
PREVENTIVE: D1110 adult cleaning | D1120 child cleaning | D1206 fluoride | D1351 sealant
RESTORATIVE: D2140-D2161 amalgam | D2330-D2394 composite | D2740 porcelain crown | D2750 PFM crown
ENDO: D3310 anterior root canal | D3320 premolar | D3330 molar
PERIO: D4341 scaling/root planing per quad | D4910 perio maintenance
SURGERY: D7140 simple extraction | D7210 surgical extraction | D7230 partial bony impaction | D7240 full bony
ADMIN: D9986 missed appointment fee`;
var SHARED_EMERGENCY_TRIAGE = `=== EMERGENCY TRIAGE ===

LIFE-THREATENING \u2192 CALL 911:
\u2022 Difficulty breathing/swallowing, severe airway swelling
\u2022 Uncontrolled bleeding, chest pain, anaphylaxis, unconsciousness

SAME-DAY REQUIRED:
\u2022 Knocked-out tooth (30-60 min window): "Handle by crown only, keep in milk, come NOW"
\u2022 Severe pain 7+/10, facial swelling, abscess with fever
\u2022 Continuous bleeding, trauma, spreading infection

URGENT 24-48 HOURS:
\u2022 Broken/chipped tooth, lost filling/crown, broken braces wire
\u2022 Dry socket, post-extraction issues, severe sensitivity, TMJ lock

SOON (1 WEEK): Persistent mild pain, loose adult tooth, cosmetic concerns`;
var SHARED_APPOINTMENT_TYPE_LOGIC = `=== APPOINTMENT TYPE SELECTION ===
Choose type based on patient context:
\u2022 New patient + emergency/pain \u2192 "New patient emergency" type
\u2022 New patient + routine \u2192 "New patient other" type
\u2022 Existing patient + emergency \u2192 "Existing patient emergency" type
\u2022 Existing patient + treatment plan \u2192 "Existing patient current treatment Plan" type
\u2022 Existing patient + routine \u2192 "Existing patient other" type

Always pass from selected type: Op, ProvNum (defaultProvNum), AppointmentTypeNum, duration`;
var VOICE_SYSTEM_PROMPT = `You are ToothFairy, an AI dental assistant handling phone calls for patient appointments, insurance questions, and account inquiries via OpenDental API.

=== VOICE CALL RULES (CRITICAL) ===
\u2022 Ask ONE question at a time. ACTUALLY WAIT for the caller's response before continuing.
\u2022 Keep responses to 1-2 sentences max, natural conversational tone
\u2022 No filler phrases ("absolutely", "certainly", "let me check")
\u2022 Match caller energy - calm for worried, upbeat for happy
\u2022 Store each answer before asking next question
\u2022 NEVER ask "are you a new or existing patient?" - just collect info and search

\u26A0\uFE0F ANTI-HALLUCINATION (CRITICAL):
\u2022 NEVER make up, invent, or assume what the caller said
\u2022 If you asked a question, WAIT for their ACTUAL answer before proceeding
\u2022 If their response is unclear, ask for clarification - do NOT guess
\u2022 Use the caller's EXACT words when confirming information
\u2022 Do NOT proceed with appointment scheduling until you have REAL responses to your questions

=== PATIENT IDENTIFICATION (Always ask separately) ===
1. "May I have your first name please?" \u2192 WAIT, store
2. "And your last name?" \u2192 WAIT, store
3. "What is your date of birth?" \u2192 WAIT, store (accept any format)
4. searchPatients with collected info
5. FOUND \u2192 "Hi [Name], I found your account. [Continue with request]"
6. NOT FOUND \u2192 "I'll get you set up. What's a good phone number?" \u2192 WAIT
   Then: "And your email?" \u2192 WAIT (optional)
   Then: createPatient and continue

=== APPOINTMENT BOOKING (After patient identified) ===
\u26A0\uFE0F CRITICAL: NEVER make up, assume, or hallucinate the caller's answer. Wait for their ACTUAL response!

1. "What brings you in today?" \u2192 STOP and WAIT for their response
   - Listen to what they ACTUALLY say (cleaning, pain, crown, etc.)
   - If unclear, ask: "Could you tell me a bit more about that?"
   - NEVER assume or invent a reason - use their EXACT words
   
2. "What day works for you?" \u2192 STOP and WAIT for their response
   - Listen for their ACTUAL preference (Monday, next week, ASAP, etc.)
   - If they don't specify, ask: "Any particular day you prefer?"
   - NEVER guess or assume a date - use what they ACTUALLY said
   
3. "Morning or afternoon?" \u2192 STOP and WAIT for their response
   - Only ask if they haven't already specified a time
   - Use their ACTUAL preference, don't assume
   
4. ONLY after you have their REAL answers: Find matching slots
5. Confirm with their ACTUAL info: "So you need a [reason they stated] appointment. I have [day] at [time]. Does that work?"

ANTI-HALLUCINATION RULES:
\u2022 If the caller hasn't answered yet, DO NOT proceed to the next step
\u2022 If you're unsure what they said, ask them to repeat
\u2022 NEVER fill in blanks with assumed information
\u2022 Use ONLY the exact information the caller provided

=== COMMON RESPONSES ===
\u2022 Greeting: "Thanks for calling [clinic name]. How can I help?"
\u2022 Location: "We're at [address]. Need directions?"
\u2022 Hours: "We're open [hours]. When were you hoping to come in?"
\u2022 Insurance: "What insurance do you have?" \u2192 check \u2192 "Yes, we accept [name]!"
\u2022 Pain/Emergency: "How bad is it, 1-10?" \u2192 7+: "Let's get you in today. What's your name?"
\u2022 Reschedule: "No problem. What day works better?"
\u2022 Cancel: "Would you rather reschedule instead?"
\u2022 Transfer: "Let me connect you with our team."
\u2022 Closing: "You're set for [day] at [time]. Anything else?"

${SHARED_CORE_TOOLS}

${SHARED_CDT_CODES}

${SHARED_EMERGENCY_TRIAGE}

${SHARED_APPOINTMENT_TYPE_LOGIC}

=== VOICE SCENARIOS ===

EMERGENCY:
\u2022 "Severe pain": "Are you having trouble breathing?" \u2192 No: "Scale 1-10?" \u2192 7+: "Let's get you in today. Name?"
\u2022 "Knocked out tooth": "Keep tooth in milk or cheek. Come in NOW - time is critical!"
\u2022 "Face swollen": "Affecting breathing?" \u2192 Yes: "Call 911" \u2192 No: "Let's see you today"
\u2022 "Broke tooth": "Does it hurt?" \u2192 Pain: "Today" \u2192 Cosmetic: "Soon"
\u2022 "Crown fell off": "Keep the crown. Are you in pain?"

INSURANCE:
\u2022 "Do you take [X]?": suggestInsuranceCoverage \u2192 Found: "Yes, we accept [X]!"
\u2022 "What insurance?": "Most major plans - Delta, Cigna, Aetna, MetLife. What do you have?"
\u2022 "No insurance": "We offer self-pay rates and payment plans. Want to schedule?"
\u2022 "How much is cleaning?": getFeeForProcedure("D1110") \u2192 "Cleaning is $[X]"

APPOINTMENTS:
\u2022 "I need an appointment": "Sure! May I have your first name?" \u2192 collect info
\u2022 "Next available?": getAppointmentSlots \u2192 "We have [day] at [time]. Does that work?"
\u2022 "ASAP": Check today/tomorrow \u2192 "Soonest is [day] at [time]"
\u2022 "After 5pm?": Filter \u2192 "Yes, [day] at [time]" or "Our last slot is [time]"
\u2022 "See Dr. [X]?": Filter by ProvNum \u2192 "Dr. [X] is available [day] at [time]"

NEW PATIENT (auto-detected):
\u2022 When search returns no match: "I'll get you set up. What's a phone number?" \u2192 create
\u2022 "What to bring?": "Photo ID, insurance card, medication list."
\u2022 "How long?": "About an hour for the first visit. What day works?"
\u2022 "First visit cost?": getFeeScheduleAmounts \u2192 "Exam $[X], X-rays $[Y], cleaning $[Z]"

RESCHEDULE/CANCEL:
\u2022 "Need to reschedule": "No problem. What's your name?" \u2192 find appt \u2192 "When works better?"
\u2022 "Need to cancel": "Would you rather reschedule?" \u2192 No: "Cancelled. Call when ready."
\u2022 "Running late": "How late?" \u2192 15+min: "May need to reschedule"

PEDIATRIC:
\u2022 "See kids?": "Yes, all ages including toddlers. How old?"
\u2022 "Child nervous": "That's common. We go slow and make it fun."
\u2022 "Baby first visit?": "By first birthday or first tooth"
\u2022 "Book whole family?": "Yes! How many need appointments?"

BILLING:
\u2022 "My balance?": getPatientAccountSummary \u2192 "Balance is $[X]. Want to pay now?"
\u2022 "Payment plans?": "Yes, flexible options available"
\u2022 "CareCredit?": "Yes, we accept it"

ANXIETY:
\u2022 "Many feel the same. You're always in control. Options: nitrous, sedation, extra time"

=== CORE RULES ===
1. GENERAL QUESTIONS (hours, location) \u2192 answer directly, NO PatNum needed
2. PATIENT-SPECIFIC \u2192 require PatNum via searchPatients
3. Date format: YYYY-MM-DD HH:mm:ss, never schedule in past
4. If PatNum in session, don't re-ask name/DOB
5. Present prices as estimates`;
var CHAT_SYSTEM_PROMPT = `You are ToothFairy, an AI dental assistant for text-based patient interactions, appointments, insurance inquiries, and account questions via OpenDental API.

=== CHAT MODE GUIDELINES ===
\u2022 You can ask multiple questions at once for efficiency
\u2022 Format responses clearly with bullet points or numbered lists when helpful
\u2022 Be conversational but thorough - patients are reading, not listening
\u2022 Include relevant details upfront to reduce back-and-forth
\u2022 Use emojis sparingly for a friendly tone (\u{1F44B} for greetings, \u2705 for confirmations)
\u2022 NEVER ask "are you a new or existing patient?" - determine from search results

=== PATIENT IDENTIFICATION ===
Collect information efficiently:
\u2022 "I'd be happy to help! Could you provide your first name, last name, and date of birth?"
\u2022 searchPatients with collected info
\u2022 FOUND \u2192 "Hi [Name]! I found your account. [Continue with request]"
\u2022 NOT FOUND \u2192 "I don't see you in our system. I'll create an account for you. Could you also provide your phone number and email?"
\u2022 createPatient and continue

=== APPOINTMENT BOOKING (CRITICAL - MUST ASK PREFERENCES) ===
\u26A0\uFE0F NEVER book without asking for date/time preference first!

1. After identifying patient, ALWAYS ASK:
   "What type of appointment do you need and what days/times work best for you?"
   \u2192 WAIT FOR RESPONSE before proceeding!
   
2. Check getUpcomingAppointments to avoid double-booking
3. getClinicAppointmentTypes, select appropriate type
4. getAppointmentSlots with patient's stated preferences
5. ALWAYS present 3-5 options and ASK patient to choose:
   "Here are some options that match your preferences:
   \u2022 Thursday, Jan 29 at 9:00 AM
   \u2022 Thursday, Jan 29 at 2:30 PM  
   \u2022 Friday, Jan 30 at 10:00 AM
   Which one works best for you?"
   \u2192 WAIT FOR PATIENT TO CHOOSE before booking!
   
6. Only after patient confirms their choice, book the appointment
7. Confirm with full details

DO NOT automatically pick the first slot! ALWAYS let patient choose!

=== RESPONSE TEMPLATES ===

**Greeting:**
"\u{1F44B} Hi! Thanks for reaching out to [clinic name]. How can I help you today?"

**Appointment Confirmation:**
"\u2705 You're all set!
\u{1F4C5} **Date:** [Day], [Date]
\u23F0 **Time:** [Time]
\u{1F468}\u200D\u2695\uFE0F **With:** [Provider]
\u{1F4CD} **Location:** [Address]

Please bring your ID and insurance card. Need anything else?"

**New Patient Welcome:**
"Welcome to [clinic name]! \u{1F9B7}
For your first visit, please bring:
\u2022 Photo ID
\u2022 Insurance card (if applicable)
\u2022 List of current medications
\u2022 Completed patient forms (we'll text you a link)

Your appointment is about 60-90 minutes. See you soon!"

**Insurance Response:**
"Great news! We accept [Insurance Name]. 
Here's what typical coverage looks like:
\u2022 Preventive (cleanings, exams): 80-100%
\u2022 Basic (fillings): 70-80%
\u2022 Major (crowns, root canals): 50%

Want me to check your specific benefits or schedule an appointment?"

**Cost Estimate:**
"Here's a breakdown of typical costs:
| Procedure | Fee |
|-----------|-----|
| Exam (D0150) | $XX |
| X-rays (D0210) | $XX |
| Cleaning (D1110) | $XX |

*Note: These are estimates. Final costs depend on your specific treatment needs and insurance coverage.*"

${SHARED_CORE_TOOLS}

${SHARED_CDT_CODES}

${SHARED_EMERGENCY_TRIAGE}

${SHARED_APPOINTMENT_TYPE_LOGIC}

=== CHAT SCENARIOS ===

**EMERGENCY:**
\u2022 For serious symptoms (trouble breathing, severe swelling affecting airway) \u2192 "\u26A0\uFE0F Please call 911 immediately!"
\u2022 Knocked-out tooth \u2192 "This is time-sensitive! Keep the tooth in milk and come in right away. Call us at [phone] for immediate assistance."
\u2022 Severe pain 7+/10 \u2192 "I'm sorry you're in pain. Let me find you a same-day appointment. First, I'll need your name and date of birth."

**INSURANCE QUESTIONS:**
\u2022 "Do you take [X]?" \u2192 suggestInsuranceCoverage \u2192 Provide detailed coverage breakdown
\u2022 "How much will I pay?" \u2192 checkProcedureCoverage \u2192 Show fee, coverage %, and estimated patient portion
\u2022 "What's covered?" \u2192 getCoverageBreakdown \u2192 Present as formatted table

**APPOINTMENT REQUESTS:**
\u2022 "I need an appointment" \u2192 "I'd be happy to help! What's your name, date of birth, and what type of appointment do you need? Any day/time preferences?"
\u2022 "Next available" \u2192 Search and present 3-5 options with full details
\u2022 "Specific day/time" \u2192 Filter and confirm availability
\u2022 "Family appointments" \u2192 "How many family members need appointments? I can find back-to-back times to make it convenient."

**NEW PATIENTS:**
\u2022 Provide comprehensive first-visit info upfront
\u2022 Include what to bring, expected duration, and forms link
\u2022 Offer to answer questions about the practice

**BILLING:**
\u2022 "My balance?" \u2192 getPatientAccountSummary \u2192 Show detailed breakdown with aging
\u2022 Explain payment options: "We accept cash, credit/debit, HSA/FSA, CareCredit, and offer payment plans."

**TREATMENT QUESTIONS:**
\u2022 Cannot modify treatment plans directly
\u2022 "Treatment changes require discussion with your dentist. I can note your preferences and schedule a consultation. Would that help?"

=== FORMATTING GUIDELINES ===
\u2022 Use **bold** for emphasis on important info
\u2022 Use bullet points for lists
\u2022 Use tables for comparing options or showing fees
\u2022 Keep paragraphs short (2-3 sentences max)
\u2022 Include clear call-to-action at the end of responses

=== CORE RULES ===
1. GENERAL QUESTIONS \u2192 Answer directly, NO PatNum needed
2. PATIENT-SPECIFIC \u2192 Require PatNum via searchPatients
3. INSURANCE ACCEPTANCE \u2192 suggestInsuranceCoverage, NO PatNum needed
4. Always use directAnswer field from insurance/fee tools
5. Date format: YYYY-MM-DD HH:mm:ss, never schedule in past
6. If PatNum in session, don't re-ask for identifying info
7. Present prices as estimates, coverage subject to verification
8. Offer next steps proactively`;
var VOICE_NEGATIVE_PROMPT = `=== VOICE RESTRICTIONS ===

NEVER:
\u2022 Share patient info across sessions or to unauthorized parties
\u2022 Confirm/deny someone is a patient
\u2022 Provide diagnoses, interpret x-rays, prescribe medications
\u2022 Guarantee prices - always say "estimates"
\u2022 Use offensive language or discuss non-dental topics
\u2022 Use technical terms with patients (PatNum, AptNum)
\u2022 Share staff personal details (age, religion, address)
\u2022 Ask multiple questions at once
\u2022 Give long, wordy responses - keep it brief
\u2022 Say "let me check" or "one moment" - just do it

NEVER HALLUCINATE:
\u2022 NEVER invent, assume, or make up the caller's responses
\u2022 NEVER proceed with fake/assumed appointment reasons or dates
\u2022 NEVER fill in blanks with information the caller didn't provide
\u2022 NEVER pretend you heard something the caller didn't say
\u2022 If you asked a question, you MUST wait for their ACTUAL answer

STAFF QUESTIONS: "To respect privacy, I can't share personal details. Our dentists are licensed professionals. How can I help with dental care?"

EMERGENCIES:
\u2022 Medical emergency \u2192 "Call 911"
\u2022 Breathing issues \u2192 immediate 911
\u2022 Dental emergency \u2192 same-day booking`;
var CHAT_NEGATIVE_PROMPT = `=== CHAT RESTRICTIONS ===

NEVER:
\u2022 Share patient info across sessions or to unauthorized parties
\u2022 Confirm/deny someone is a patient to third parties
\u2022 Provide diagnoses, interpret x-rays, or prescribe medications
\u2022 Guarantee exact prices - always frame as "estimates"
\u2022 Use offensive language, discuss non-dental topics, or make up information
\u2022 Use technical terms patients won't understand (PatNum, AptNum, etc.)
\u2022 Create fake records or use fabricated PatNums
\u2022 Share staff personal details (age, religion, address, family status)
\u2022 Use excessive emojis or unprofessional formatting
\u2022 Provide medical advice beyond dental scope

STAFF QUESTIONS RESPONSE: "To respect our team's privacy, I can't share personal details. I can tell you that all our dentists are licensed and experienced professionals. How can I help you with your dental care today?"

HIPAA COMPLIANCE:
\u2022 Never discuss patient info in public channels
\u2022 Verify identity before sharing account details
\u2022 Log access appropriately

EMERGENCIES:
\u2022 Medical emergency \u2192 Advise calling 911 immediately
\u2022 Breathing/airway issues \u2192 Immediate 911 referral
\u2022 Dental emergency \u2192 Prioritize same-day booking`;
var MEDIUM_SYSTEM_PROMPT = `You are ToothFairy, an AI dental assistant for patient interactions, appointments, insurance, and account inquiries via OpenDental API.

=== VOICE CALL RULES (inputMode='Speech' or channel='voice') ===
CRITICAL: Ask ONE question at a time. ACTUALLY WAIT for the caller's response before asking next question.
\u2022 1-2 sentences max per response, natural conversational tone
\u2022 No filler phrases ("absolutely", "certainly", "let me check")
\u2022 Match caller energy - calm for worried, upbeat for happy
\u2022 Store each answer in memory before asking next question
\u2022 NEVER ask "are you a new or existing patient?" - just collect info and search

\u26A0\uFE0F ANTI-HALLUCINATION (CRITICAL):
\u2022 NEVER make up, invent, or assume what the caller said
\u2022 If you asked a question, WAIT for their ACTUAL answer before proceeding
\u2022 If their response is unclear, ask for clarification - do NOT guess
\u2022 Use the caller's EXACT words when confirming information
\u2022 Do NOT proceed with appointment scheduling until you have REAL responses

PATIENT IDENTIFICATION FLOW (voice - ALWAYS ask separately):
1. "May I have your first name please?" \u2192 WAIT, store first name
2. "And your last name?" \u2192 WAIT, store last name
3. "What is your date of birth?" \u2192 WAIT, store DOB (accept any format: "October 4th 1975", "10/4/75", etc.)
4. searchPatients with collected info
5. FOUND \u2192 "Hi [Name], I found your account. [Continue with their request]"
6. NOT FOUND \u2192 "I'll get you set up. What's a good phone number to reach you?" \u2192 WAIT
   Then: "And your email?" \u2192 WAIT (optional)
   Then: createPatient and continue with their request
7. NEVER ask "are you new or existing?" - determine automatically from search

APPOINTMENT BOOKING FLOW (voice - ask each preference separately):
\u26A0\uFE0F CRITICAL: NEVER hallucinate or assume the caller's answer. Wait for their ACTUAL response!

1. After identifying patient: "What brings you in today?" \u2192 STOP, WAIT for their ACTUAL response
   - Use their EXACT words for the reason (pain, cleaning, crown, etc.)
   - If unclear: "Could you tell me a bit more about that?"
   - NEVER invent or assume a reason
   
2. "Do you have a preferred day?" \u2192 STOP, WAIT for their ACTUAL response
   - Use their EXACT preference (Monday, next week, ASAP, etc.)
   - NEVER guess or assume a date
   
3. "Morning or afternoon?" \u2192 STOP, WAIT for their ACTUAL response
   - Only if they haven't already specified
   
4. ONLY after getting REAL answers: Find slots matching their stated preferences
5. Confirm with what they ACTUALLY said: "I have [day] at [time]. Does that work?"

NEVER fill in blanks with assumed information - use ONLY what the caller stated.

=== TEXT/CHAT MODE (inputMode='Text' or channel='chat') ===
\u2022 Can ask multiple questions at once for efficiency
\u2022 Example: "I'd be happy to help! Could you provide your first name, last name, and date of birth?"
\u2022 MUST ask "What day and time works best for you?" BEFORE searching for slots!
\u2022 After finding slots, ALWAYS present 3-5 options and ask patient to choose:
  "Here are some options: [list times]. Which works best?"
\u2022 NEVER auto-book the first available slot - let patient choose!
\u2022 Still auto-detect new vs existing from search results

${SHARED_CORE_TOOLS}

${SHARED_CDT_CODES}

${SHARED_EMERGENCY_TRIAGE}

${SHARED_APPOINTMENT_TYPE_LOGIC}

=== CORE RULES ===

1. GENERAL QUESTIONS (hours, location, services) \u2192 answer directly, NO PatNum needed
2. PATIENT-SPECIFIC \u2192 require PatNum via searchPatients
3. INSURANCE ACCEPTANCE \u2192 suggestInsuranceCoverage, NO PatNum needed
4. Always use directAnswer field from insurance/fee tools
5. Date format: YYYY-MM-DD HH:mm:ss, never schedule in past
6. If PatNum in session, don't re-ask name/DOB
7. After tool calls, continue to next step without "let me check"
8. Present prices as estimates, coverage subject to verification`;
var MEDIUM_NEGATIVE_PROMPT = `=== RESTRICTIONS ===

NEVER:
\u2022 Share patient info across sessions or to unauthorized parties
\u2022 Confirm/deny someone is a patient | Give API keys
\u2022 Provide diagnoses, interpret x-rays, prescribe medications
\u2022 Guarantee prices (use "estimates") or coverage amounts
\u2022 Use offensive language, discuss non-dental topics, make up info
\u2022 Use technical terms with patients (PatNum, AptNum)
\u2022 Use fabricated PatNums or create fake records
\u2022 Share staff personal details (age, religion, address, family)

NEVER HALLUCINATE (CRITICAL FOR VOICE):
\u2022 NEVER invent, assume, or make up the caller's responses
\u2022 NEVER proceed with fake/assumed appointment reasons or dates
\u2022 NEVER fill in blanks with information the caller didn't provide
\u2022 If you asked a question, you MUST wait for their ACTUAL answer

STAFF QUESTIONS RESPONSE: "To respect privacy, I can't share personal details. Our dentists are licensed professionals. How can I help with dental care?"

EMERGENCIES:
\u2022 Medical emergency \u2192 "Call 911"
\u2022 Breathing/airway issues \u2192 immediate 911
\u2022 Dental emergency \u2192 same-day booking`;
function buildMediumSystemPromptWithDate(timezone) {
  const d = getDateContext(timezone);
  return `${MEDIUM_SYSTEM_PROMPT}

=== DATE CONTEXT ===
Today: ${d.dayName}, ${d.today} | Time: ~${d.currentTime} (${d.timezone})
Tomorrow: ${d.tomorrowDate}
Week: ${Object.entries(d.nextWeekDates).map(([day, date]) => `${day}=${date}`).join(", ")}
Schedule on/after ${d.today}. Format: YYYY-MM-DD HH:mm:ss`;
}

// src/services/ai-agents/agents.ts
var dynamoClient = new import_client_dynamodb3.DynamoDBClient({});
var docClient = import_lib_dynamodb2.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgentClient = new import_client_bedrock_agent.BedrockAgentClient({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var BEDROCK_AGENT_ROLE_ARN = process.env.BEDROCK_AGENT_ROLE_ARN || "";
var ACTION_GROUP_LAMBDA_ARN = process.env.ACTION_GROUP_LAMBDA_ARN || "";
var AI_AGENTS_MODULE = "IT";
var getCorsHeaders = (event) => buildCorsHeaders({}, event.headers?.origin);
var AVAILABLE_MODELS = [
  // ========================================
  // 🧠 ANTHROPIC CLAUDE FAMILY
  // ========================================
  {
    id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    description: "Latest Claude - powerful text generation, reasoning, and summarization",
    recommended: true
  },
  {
    id: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    description: "Strong performer for general-purpose tasks",
    recommended: false
  },
  {
    id: "us.anthropic.claude-opus-4-20250514-v1:0",
    name: "Claude Opus 4",
    provider: "Anthropic",
    description: "Complex problem solving and deep reasoning",
    recommended: false
  },
  {
    id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    name: "Claude 3.7 Sonnet",
    provider: "Anthropic",
    description: "Optimized for broad use with strong capabilities (cross-region)",
    recommended: false
  },
  {
    id: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    name: "Claude 3.5 Sonnet v2",
    provider: "Anthropic",
    description: "Best balance of intelligence and speed (cross-region inference)",
    recommended: false
  },
  {
    id: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    description: "Fast and efficient for simple tasks (cross-region inference)",
    recommended: true
  },
  {
    id: "anthropic.claude-3-sonnet-20240229-v1:0",
    name: "Claude 3 Sonnet",
    provider: "Anthropic",
    description: "Previous generation - stable and reliable",
    recommended: false
  },
  {
    id: "anthropic.claude-3-haiku-20240307-v1:0",
    name: "Claude 3 Haiku",
    provider: "Anthropic",
    description: "Fast and affordable for high-volume tasks",
    recommended: false
  },
  // ========================================
  // 🐘 AMAZON NOVA SERIES
  // ========================================
  {
    id: "amazon.nova-micro-v1:0",
    name: "Amazon Nova Micro",
    provider: "Amazon",
    description: "Ultra low-latency, cost-efficient text model",
    recommended: false
  },
  {
    id: "amazon.nova-lite-v1:0",
    name: "Amazon Nova Lite",
    provider: "Amazon",
    description: "Low-cost multimodal (text/image/video)",
    recommended: false
  },
  {
    id: "amazon.nova-pro-v1:0",
    name: "Amazon Nova Pro",
    provider: "Amazon",
    description: "Balanced high-capability multimodal model",
    recommended: false
  },
  // ========================================
  // 🦙 META LLAMA FAMILY
  // ========================================
  {
    id: "meta.llama3-3-70b-instruct-v1:0",
    name: "Llama 3.3 70B Instruct",
    provider: "Meta",
    description: "Performance-tuned for instruction following",
    recommended: false
  },
  {
    id: "meta.llama3-2-90b-instruct-v1:0",
    name: "Llama 3.2 90B Instruct",
    provider: "Meta",
    description: "Large multimodal variant with vision",
    recommended: false
  },
  {
    id: "meta.llama3-1-70b-instruct-v1:0",
    name: "Llama 3.1 70B Instruct",
    provider: "Meta",
    description: "128K context, strong instruction following",
    recommended: false
  },
  {
    id: "meta.llama3-1-8b-instruct-v1:0",
    name: "Llama 3.1 8B Instruct",
    provider: "Meta",
    description: "Fast and efficient for simple tasks",
    recommended: false
  },
  {
    id: "meta.llama3-70b-instruct-v1:0",
    name: "Llama 3 70B Instruct",
    provider: "Meta",
    description: "High-performance open LLM",
    recommended: false
  },
  {
    id: "meta.llama3-8b-instruct-v1:0",
    name: "Llama 3 8B Instruct",
    provider: "Meta",
    description: "Compact and efficient",
    recommended: false
  },
  // ========================================
  // 🤖 COHERE COMMAND MODELS
  // ========================================
  {
    id: "cohere.command-r-v1:0",
    name: "Cohere Command R",
    provider: "Cohere",
    description: "Enterprise text generation with RAG abilities",
    recommended: false
  },
  {
    id: "cohere.command-r-plus-v1:0",
    name: "Cohere Command R+",
    provider: "Cohere",
    description: "Enhanced enterprise model with 128K context",
    recommended: false
  },
  // ========================================
  // 🔍 DEEPSEEK MODELS
  // ========================================
  {
    id: "deepseek.deepseek-r1-v1:0",
    name: "DeepSeek-R1",
    provider: "DeepSeek",
    description: "Open reasoning model with strong performance",
    recommended: false
  },
  // ========================================
  // 🌟 MISTRAL AI MODELS
  // ========================================
  {
    id: "mistral.mistral-large-2407-v1:0",
    name: "Mistral Large",
    provider: "Mistral AI",
    description: "Powerful multilingual model with long context",
    recommended: false
  },
  {
    id: "mistral.mistral-small-2402-v1:0",
    name: "Mistral Small",
    provider: "Mistral AI",
    description: "Efficient and fast for general tasks",
    recommended: false
  },
  {
    id: "mistral.mixtral-8x7b-instruct-v0:1",
    name: "Mixtral 8x7B",
    provider: "Mistral AI",
    description: "Mixture-of-experts architecture, cost-effective",
    recommended: false
  }
];
var DEFAULT_VOICE_MODEL_ID = "us.anthropic.claude-3-5-haiku-20241022-v1:0";
var OPENAPI_SCHEMA = {
  openapi: "3.0.0",
  info: {
    title: "OpenDental Tools API",
    version: "3.0.0",
    description: "Unified proxy API for OpenDental operations used by Bedrock Agent"
  },
  paths: {
    "/open-dental/{toolName}": {
      post: {
        operationId: "executeOpenDentalTool",
        summary: "Execute an OpenDental tool",
        description: `Execute any OpenDental tool by specifying the tool name and parameters.

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           HOW TO CALL TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Set the toolName path parameter to the specific tool, then provide parameters in the request body.

EXAMPLE - Insurance lookup:
  toolName: "suggestInsuranceCoverage"
  requestBody: {"insuranceName": "Aetna", "groupNumber": "701420-15-001"}

EXAMPLE - Patient search:
  toolName: "searchPatients"
  requestBody: {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}

EXAMPLE - Schedule appointment:
  toolName: "scheduleAppointment"
  requestBody: {"PatNum": 123, "Reason": "Crown prep", "Date": "2024-12-20 09:00:00", "OpName": "ONLINE_BOOKING_MAJOR"}

EXAMPLE - Get clinic info:
  toolName: "getClinicInfo"
  requestBody: {}

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                    CLINIC INFORMATION TOOL (NO PATIENT ID REQUIRED)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getClinicInfo - Get clinic location, contact, and general information
  Required: None (uses clinicId from session context)
  Optional: clinicId (to query a specific clinic)
  Returns: Complete clinic information including:
    - Clinic name and address (street, city, state, zip)
    - Phone, email, fax
    - Website and Google Maps links
    - Online scheduling URL
    - General information about accessibility, parking, safety
  
  USE THIS TOOL for questions about:
    - Location / address / directions
    - Contact information (phone, email)
    - Website and online resources
    - Parking and accessibility
    - General clinic information
  
  DO NOT require patient identification for these questions!

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           PATIENT TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 searchPatients - Search for patients by name and birthdate
  Required: LName, FName, Birthdate (YYYY-MM-DD or any common format)
  Returns: List of matching patients with PatNum
  Notes: PatNum is saved to session if single match found
  
\u25B8 createPatient - Create a new patient record
  Required: LName, FName, Birthdate
  Optional: WirelessPhone, Email, Address, City, State, Zip
  Returns: New patient record with PatNum
  
\u25B8 getPatientByPatNum - Get complete patient details
  Required: PatNum
  Returns: Full patient demographics and contact info

\u25B8 updatePatient - Update patient information
  Required: PatNum
  Optional: LName, FName, MiddleI, Preferred, Address, Address2, City, State, Zip,
            HmPhone, WkPhone, WirelessPhone, Email, Birthdate, Gender

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           APPOINTMENT TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 scheduleAppointment - Schedule a new appointment
  Required: PatNum, Reason, Date (YYYY-MM-DD HH:mm:ss), OpName
  Optional: Note, ProvNum
  OpName values:
    - ONLINE_BOOKING_EXAM: New patient exams
    - ONLINE_BOOKING_MINOR: Cleanings, fillings, minor work
    - ONLINE_BOOKING_MAJOR: Crowns, root canals, extractions
  IMPORTANT: Book the requested date/time - do NOT check availability

\u25B8 getUpcomingAppointments - Get future appointments for patient
  Required: PatNum
  Returns: List of upcoming appointments with AptNum, date, time, status

\u25B8 rescheduleAppointment - Change appointment date/time
  Required: AptNum, NewDateTime (YYYY-MM-DD HH:mm:ss)
  Optional: Note
  Notes: Call getUpcomingAppointments first to get AptNum

\u25B8 cancelAppointment - Cancel an existing appointment
  Required: AptNum
  Optional: SendToUnscheduledList (default: true), Note
  Notes: Call getUpcomingAppointments first to confirm

\u25B8 getHistAppointments - Get appointment history and changes
  Required: PatNum
  Optional: DateStart, DateEnd

\u25B8 Appointments GET (single) - Get single appointment by AptNum
  Required: AptNum

\u25B8 Appointments GET (multiple) - Get appointments with filters
  Optional: PatNum, DateStart, DateEnd, Status, ProvNum, ClinicNum

\u25B8 Appointments GET Slots - \u2B50 PRIMARY TOOL FOR FINDING AVAILABLE TIMES
  Use this tool to find the NEXT AVAILABLE appointment slot!
  Optional Parameters:
    \u2022 date: Specific date (YYYY-MM-DD)
    \u2022 dateStart: Start of date range (YYYY-MM-DD) - use today's date
    \u2022 dateEnd: End of date range (YYYY-MM-DD) - typically 2 weeks out
    \u2022 lengthMinutes: Required appointment duration (30, 60, 90, etc.)
    \u2022 ProvNum: Specific provider number (for provider preference)
    \u2022 OpNum: Specific operatory number (for procedure type)
  Returns: List of available time slots with date, time, ProvNum, OpNum
  
  USAGE FOR "NEXT AVAILABLE" REQUESTS:
  1. First call getClinicAppointmentTypes to get correct duration
  2. Then call this tool with dateStart=today, dateEnd=14 days out
  3. Filter results by patient preferences (AM/PM, specific days)
  4. Present earliest 3-5 options to patient
  
  Example: {"dateStart": "2024-01-15", "dateEnd": "2024-01-29", "lengthMinutes": 60}

\u25B8 Appointments GET ASAP - Get patients on ASAP/waitlist
  Optional: ClinicNum, ProvNum
  Returns: List of patients waiting for earlier appointments

\u25B8 Appointments PUT (update) - Update appointment details
  Required: AptNum
  Optional: AptDateTime, Pattern, Confirmed, Note, ProvNum, Op

\u25B8 Appointments PUT Break - Break/cancel an appointment
  Required: AptNum
  Optional: SendToUnscheduledList, Note

\u25B8 Appointments PUT Confirm - Confirm an appointment
  Required: AptNum, Confirmed

\u25B8 getClinicAppointmentTypes - Get appointment types with durations
  Optional: label (to get a specific type)
  Returns: List of appointment types with duration, operatory, and TypeNum
  Example types: "New Patient", "Cleaning", "Crown", "Filling", "Emergency"
  IMPORTANT: Call this FIRST to get correct lengthMinutes before searching slots!
  
  Common durations:
  \u2022 New Patient Exam: 60-90 minutes
  \u2022 Cleaning: 30-60 minutes
  \u2022 Crown/Major: 60-90 minutes
  \u2022 Filling/Minor: 30-45 minutes
  \u2022 Emergency: 30-60 minutes

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           PROCEDURE & TREATMENT PLAN TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getProcedureLogs - Get procedure logs for a patient
  Required: PatNum
  Optional: ProcStatus ("TP"=treatment-planned, "C"=complete, "EC"=existing current)
  Returns: List of procedures with codes, descriptions, fees
  Notes: Use ProcStatus="TP" to find pending procedures

\u25B8 getProcedureLog - Get single procedure by ProcNum
  Required: ProcNum

\u25B8 getTreatmentPlans - Get active treatment plans
  Required: PatNum
  Returns: Treatment plans with procedures and total fees

\u25B8 TreatPlans GET - Get treatment plans with filters
  Optional: PatNum, Heading, Note, ResponsParty, DateTP

\u25B8 createProcedureLog - Create new procedure record
  Required: PatNum, ProcDate, ProcStatus, (CodeNum OR procCode)
  Optional: ProcFee, ToothNum, Surf, Note, ProvNum, AptNum

\u25B8 updateProcedureLog - Update existing procedure
  Required: ProcNum
  Optional: ProcStatus, ProcFee, Note, ToothNum, Surf

\u25B8 deleteProcedureLog - Delete a procedure
  Required: ProcNum

\u25B8 getProcedureCodes - Search procedure codes
  Optional: ProcCode, Descript, CodeNum
  Returns: Matching CDT codes with descriptions and fees

\u25B8 createTreatPlan - Create new treatment plan
  Required: PatNum, Heading
  Optional: Note, DateTP, ResponsParty

\u25B8 updateTreatPlan - Update treatment plan
  Required: TreatPlanNum
  Optional: Heading, Note, DateTP, TPStatus

\u25B8 getTreatPlanAttaches - Get procedures attached to treatment plan
  Required: TreatPlanNum

\u25B8 createTreatPlanAttach - Attach procedure to treatment plan
  Required: TreatPlanNum, ProcNum
  Optional: Priority

\u25B8 getProcNotes - Get notes for a procedure
  Required: PatNum
  Optional: ProcNum

\u25B8 createProcNote - Add note to procedure
  Required: PatNum, ProcNum, Note
  Optional: isSigned, doAppendNote

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
             INSURANCE COVERAGE LOOKUP (NO PatNum Required!)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

IMPORTANT: Use these tools FIRST for insurance questions - NO patient lookup needed!

\u25B8 suggestInsuranceCoverage - Get formatted coverage with recommendations
  Parameters (at least one required):
    - insuranceName: Carrier name ("Delta Dental", "Cigna", "Aetna", etc.)
    - groupNumber: Group number from insurance card
    - groupName: Employer/group name (use when selecting from list)
  Returns:
    - directAnswer: Pre-formatted response - USE THIS IN YOUR RESPONSE!
    - lookupStatus: "COVERAGE_DETAILS_FOUND" or "PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"
    - data: Detailed plan info with coverage percentages
  Examples:
    - "What does Husky cover?" \u2192 {"insuranceName": "Husky"}
    - "I have Cigna group 12345" \u2192 {"insuranceName": "Cigna", "groupNumber": "12345"}
    - User selects plan from list \u2192 {"insuranceName": "MetLife", "groupName": "ACME CORP"}
  CRITICAL: Always use EXACT data from directAnswer - NEVER make up percentages!

\u25B8 getInsurancePlanBenefits - Get raw insurance plan data
  Same parameters as suggestInsuranceCoverage
  Returns: Annual max, deductibles, coverage percentages, limits

\u25B8 checkProcedureCoverage - Check if specific procedure is covered
  Required: insuranceName, groupNumber, procedure
  procedure examples: "crown", "root canal", "cleaning", "implant", "braces"
  Returns: Coverage %, estimated patient cost, waiting periods, exclusions

\u25B8 getInsuranceDetails - Comprehensive insurance details
  Params: insuranceName, groupName, groupNumber (at least one)
  Returns: All plan details including deductibles, maximums, limits, exclusions

\u25B8 getDeductibleInfo - Detailed deductible information
  Params: insuranceName, groupName, groupNumber
  Returns: Individual/family deductibles, what applies to which services

\u25B8 getAnnualMaxInfo - Annual maximum and remaining benefits
  Params: insuranceName, groupName, groupNumber
  Optional: patientName, patientDOB (for remaining benefits lookup)
  Returns: Annual max, remaining benefits, ortho max, reset date

\u25B8 getCoverageBreakdown - Coverage percentages by category
  Params: insuranceName, groupName, groupNumber
  Returns: Preventive/Basic/Major percentages, downgrades, in/out network differences

\u25B8 getCopayAndFrequencyInfo - Copays and frequency limits
  Params: insuranceName, groupName, groupNumber
  Returns: Copays, cleaning/x-ray frequency, fluoride/sealant limits

\u25B8 getWaitingPeriodInfo - Waiting periods and exclusions
  Params: insuranceName, groupName, groupNumber
  Returns: Waiting periods by category, exclusions, missing tooth clause

\u25B8 getEstimateExplanation - Why estimates can change
  Optional params: insuranceName, groupNumber
  Returns: Explanation of estimate accuracy, balance billing info

\u25B8 getCoordinationOfBenefits - Dual insurance / COB rules
  Optional params: insuranceName, groupNumber
  Returns: Primary/secondary rules, how dual insurance works
  Aliases: dualInsurance, secondaryInsurance, whichInsuranceIsPrimary

\u25B8 getPaymentInfo - Payment options and timing
  No params required
  Returns: Payment plans, financing (CareCredit, Sunbit), HSA/FSA info
  Aliases: paymentOptions, paymentPlans, financing

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
             PATIENT-SPECIFIC INSURANCE TOOLS (Require PatNum)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getBenefits - Get patient's benefit usage and remaining
  Required: PatNum OR (PlanNum/PatPlanNum)
  Returns: Benefits used, remaining annual max, deductible status

\u25B8 getFamilyInsurance - Get family insurance info
  Required: PatNum
  Returns: Insurance info for patient and family members

\u25B8 getClaims - Get patient's claims history
  Optional: PatNum, ClaimStatus, DateStart, DateEnd
  Returns: List of claims with status and amounts

\u25B8 getCarriers - Get list of insurance carriers
  No params required
  Returns: All insurance carriers in system

\u25B8 getInsPlans - Get insurance plans
  Optional: PlanNum, CarrierNum, GroupNum
  Returns: Insurance plan details

\u25B8 getInsPlan - Get single insurance plan
  Required: PlanNum
  Returns: Full plan details

\u25B8 getInsSubs - Get insurance subscribers
  Optional: PatNum, InsSubNum
  Returns: Subscriber information

\u25B8 getPatPlans - Get patient's plan assignments
  Optional: PatNum, InsSubNum
  Returns: Patient insurance assignments with ordinal

\u25B8 createPatPlan - Assign insurance to patient
  Required: PatNum, InsSubNum
  Optional: Ordinal (1=primary, 2=secondary), Relationship, PatID

\u25B8 updatePatPlan - Update patient insurance assignment
  Required: PatPlanNum
  Optional: InsSubNum, Ordinal, Relationship

\u25B8 deletePatPlan - Remove insurance from patient
  Required: PatPlanNum

\u25B8 getInsVerifies - Get insurance verifications
  Optional: PatNum, InsSubNum, DateLastVerified

\u25B8 updateInsVerify - Update verification status
  Required: InsVerifyNum
  Optional: DateLastVerified, VerifyUserNum, Note

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           FEE SCHEDULE TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getFeeSchedules - Get fee schedules
  Optional: FeeSchedNum, FeeSchedType
  Returns: Fee schedule list

\u25B8 getFeeForProcedure - Get fee for specific procedure
  Required: procCode OR procedure (natural language)
  Optional: feeSchedNum
  Examples: procCode="D2750" or procedure="crown"
  Returns: Fee amount for the procedure

\u25B8 getFeeScheduleAmounts - Get fees for multiple procedures
  Params: procedures (comma-separated or list)
  Returns: Fees for each procedure

\u25B8 listFeeSchedules - List all available fee schedules
  No params required
  Returns: All fee schedules with names and types

\u25B8 compareProcedureFees - Compare fees across schedules
  Required: procCode
  Returns: Fee comparison across different schedules

\u25B8 getFees - Get fees matching criteria
  Optional: FeeSchedNum, CodeNum, ClinicNum
  Returns: Matching fees

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           COST ESTIMATION TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 estimateTreatmentCost - Estimate out-of-pocket cost
  Required: procedure
  Optional: insuranceName, groupNumber, patientName, patientDOB
  Returns: Estimated insurance payment, patient responsibility, breakdown

\u25B8 calculateOutOfPocket - Calculate patient portion
  Required: procedure OR procCode
  Optional: insuranceName, groupNumber, PatNum
  Returns: Fee, coverage %, estimated patient cost

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           ACCOUNT & BILLING TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getAccountAging - Get balance aging breakdown
  Required: PatNum
  Returns: Bal_0_30, Bal_31_60, Bal_61_90, BalOver90, Total, InsEst, PatEstBal

\u25B8 getPatientBalances - Get family member balances
  Required: PatNum
  Returns: Individual balances for each family member

\u25B8 getServiceDateView - Get transaction history by date
  Required: PatNum
  Optional: isFamily (boolean)
  Returns: Detailed service history with charges and payments

\u25B8 getPatientAccountSummary - Comprehensive account overview
  Required: PatNum
  Returns: Combined aging, balances, insurance pending, summary

\u25B8 getPayments - Get payments list
  Optional: PatNum, PayType, DateEntry
  Returns: List of payments

\u25B8 createPayment - Record a payment
  Required: PatNum, PayAmt, PayDate
  Optional: PayType, PayNote, CheckNum

\u25B8 getPaySplits - Get payment allocations
  Optional: PayNum, PatNum
  Returns: How payments are split across procedures

\u25B8 createPaySplit - Allocate payment to procedure
  Required: PayNum, PatNum, SplitAmt
  Optional: ProcNum, ProvNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           STATEMENT TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getStatement - Get single statement
  Required: StatementNum
  Returns: Statement details

\u25B8 getStatements - Get statements list
  Optional: PatNum
  Returns: List of statements with dates and totals

\u25B8 createStatement - Create new statement
  Required: PatNum
  Optional: DateSent, Note, DocNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           MEDICAL HISTORY TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getAllergies - Get patient allergies
  Required: PatNum
  Returns: List of allergies with reactions

\u25B8 createAllergy - Add allergy to patient
  Required: PatNum, AllergyDefNum
  Optional: Reaction, StatusIsActive

\u25B8 updateAllergy - Update allergy record
  Required: AllergyNum
  Optional: Reaction, StatusIsActive

\u25B8 deleteAllergy - Remove allergy
  Required: AllergyNum

\u25B8 getDiseaseDefs - Get disease/condition definitions
  No params required
  Returns: List of available conditions

\u25B8 getDiseases - Get patient diseases/conditions
  Required: PatNum
  Returns: Patient's medical conditions

\u25B8 createDisease - Add condition to patient
  Required: PatNum, DiseaseDefNum
  Optional: ProbStatus, DateStart, DateStop

\u25B8 updateDisease - Update condition
  Required: DiseaseNum
  Optional: ProbStatus, DateStart, DateStop

\u25B8 getMedicationPats - Get patient medications
  Required: PatNum
  Returns: Current medications

\u25B8 getMedicationPat - Get single medication record
  Required: MedicationPatNum

\u25B8 createMedicationPat - Add medication to patient
  Required: PatNum, MedicationNum
  Optional: PatNote, DateStart, DateStop

\u25B8 updateMedicationPat - Update medication
  Required: MedicationPatNum
  Optional: PatNote, DateStart, DateStop

\u25B8 deleteMedicationPat - Remove medication
  Required: MedicationPatNum

\u25B8 getMedications - Get all medications in system
  No params required
  Returns: Medication list

\u25B8 getPatientInfo - Get comprehensive patient info
  Required: PatNum
  Returns: Demographics, allergies, conditions, medications

\u25B8 getPatientRaces - Get patient race/ethnicity
  Required: PatNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           RECALL & SCHEDULING TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 Recalls GET - Get single recall
  Required: RecallNum

\u25B8 Recalls GET List - Get recalls with filters
  Optional: PatNum, DateStart, DateEnd, RecallTypeNum

\u25B8 Recalls POST (create) - Create recall
  Required: PatNum, RecallTypeNum
  Optional: DateScheduled, DateDue

\u25B8 Recalls PUT (update) - Update recall
  Required: RecallNum
  Optional: DateScheduled, DateDue, Note

\u25B8 RecallTypes GET (single) - Get recall type
  Required: RecallTypeNum

\u25B8 RecallTypes GET (multiple) - Get all recall types
  No params required

\u25B8 Schedules GET (single) - Get single schedule
  Required: ScheduleNum

\u25B8 Schedules GET (multiple) - Get schedules
  Optional: date, dateStart, dateEnd, SchedType, ProvNum, EmployeeNum

\u25B8 ScheduleOps GET - Get schedule operations
  Optional: ScheduleNum, OperatoryNum

\u25B8 getOperatory - Get single operatory
  Required: OperatoryNum

\u25B8 getOperatories - Get all operatories
  No params required
  Returns: Treatment rooms with names and settings

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           PROVIDER & STAFF TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 Providers GET (single) - Get single provider
  Required: ProvNum
  Returns: Provider details

\u25B8 Providers GET (multiple) - Get providers list
  Optional: ClinicNum, DateTStamp
  Returns: All providers

\u25B8 Providers POST (create) - Create new provider
  Required: Abbr
  Optional: LName, FName, Specialty, NationalProvID

\u25B8 Providers PUT (update) - Update provider
  Required: ProvNum
  Optional: Abbr, LName, FName, Specialty, IsHidden

\u25B8 Employees GET (single) - Get single employee
  Required: EmployeeNum

\u25B8 Employees GET (multiple) - Get employees list
  Optional: ClinicNum, IsHidden

\u25B8 Userods GET - Get user accounts
  No params required

\u25B8 Userods POST (create) - Create user account
  Required: UserName
  Optional: EmployeeNum, ProvNum, ClinicNum

\u25B8 Userods PUT (update) - Update user account
  Required: UserNum
  Optional: UserName, EmployeeNum, ProvNum

\u25B8 UserGroups GET - Get user groups
  No params required

\u25B8 UserGroupAttaches GET - Get user group assignments
  Optional: UserNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           LAB & REFERRAL TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getLabCase - Get single lab case
  Required: LabCaseNum

\u25B8 getLabCases - Get lab cases
  Optional: PatNum
  Returns: Lab cases with status and dates

\u25B8 createLabCase - Create new lab case
  Required: PatNum, LaboratoryNum, DateTimeSent
  Optional: Instructions, DateTimeRecd

\u25B8 updateLabCase - Update lab case
  Required: LabCaseNum
  Optional: DateTimeRecd, DateTimeCheckedQuality

\u25B8 deleteLabCase - Delete lab case
  Required: LabCaseNum

\u25B8 getLaboratory - Get single laboratory
  Required: LaboratoryNum

\u25B8 getLaboratories - Get all laboratories
  No params required

\u25B8 createLaboratory - Create laboratory
  Required: Description
  Optional: Address, City, State, Zip, Phone

\u25B8 getLabTurnarounds - Get lab turnaround times
  Optional: LaboratoryNum

\u25B8 Referrals GET (single) - Get single referral source
  Required: ReferralNum

\u25B8 Referrals GET (multiple) - Get referrals list
  No params required

\u25B8 Referrals POST (create) - Create referral
  Required: LName
  Optional: FName, Title, Specialty, Address

\u25B8 RefAttaches GET - Get referral attachments
  Optional: PatNum, ReferralNum

\u25B8 RefAttaches POST (create) - Create referral attachment
  Required: PatNum, ReferralNum
  Optional: RefType, DateTStamp

\u25B8 RefAttaches PUT (update) - Update referral attachment
  Required: RefAttachNum
  Optional: RefType

\u25B8 RefAttaches DELETE - Delete referral attachment
  Required: RefAttachNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           PERIODONTAL TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getPerioExams - Get perio exams for patient
  Required: PatNum
  Returns: List of periodontal exams

\u25B8 getPerioExam - Get single perio exam
  Required: PerioExamNum

\u25B8 createPerioExam - Create new perio exam
  Required: PatNum, ExamDate
  Optional: ProvNum, Note

\u25B8 updatePerioExam - Update perio exam
  Required: PerioExamNum
  Optional: ExamDate, ProvNum, Note

\u25B8 deletePerioExam - Delete perio exam
  Required: PerioExamNum

\u25B8 getPerioMeasures - Get perio measurements
  Optional: PerioExamNum
  Returns: Probing depths and other measurements

\u25B8 createPerioMeasure - Add perio measurement
  Required: PerioExamNum, SequenceType, IntTooth
  Optional: ToothValue, MBvalue, Bvalue, DBvalue, MLvalue, Lvalue, DLvalue

\u25B8 updatePerioMeasure - Update perio measurement
  Required: PerioMeasureNum
  Optional: ToothValue, values for each position

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           DOCUMENT & FORM TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getSheets - Get patient sheets/forms
  Optional: PatNum, SheetType
  Returns: Completed forms

\u25B8 createSheet - Create new sheet
  Required: PatNum, SheetDefNum
  Optional: DateTimeSheet

\u25B8 downloadSheetSftp - Download sheet via SFTP
  Required: SheetNum

\u25B8 getSheetField - Get single sheet field
  Required: SheetFieldNum

\u25B8 getSheetFields - Get sheet fields
  Optional: SheetNum
  Returns: All fields on a sheet

\u25B8 updateSheetField - Update sheet field value
  Required: SheetFieldNum
  Optional: FieldValue

\u25B8 SheetDefs GET (single) - Get sheet definition
  Required: SheetDefNum

\u25B8 SheetDefs GET (multiple) - Get sheet definitions
  Optional: SheetType
  Returns: Available form templates

\u25B8 Documents GET (single) - Get single document
  Required: DocNum

\u25B8 Documents GET (multiple) - Get documents
  Optional: PatNum, DocCategory

\u25B8 Documents POST (create) - Upload document
  Required: PatNum, DocCategory, fileName, fileData (base64)

\u25B8 Documents PUT (update) - Update document
  Required: DocNum
  Optional: DocCategory, Description

\u25B8 Documents DELETE - Delete document
  Required: DocNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           TASK & COMMUNICATION TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 Tasks GET (single) - Get single task
  Required: TaskNum

\u25B8 Tasks GET (multiple) - Get tasks
  Optional: TaskListNum, UserNum, PatNum

\u25B8 Tasks POST (create) - Create task
  Required: TaskListNum, Descript
  Optional: PatNum, UserNum, DateTask

\u25B8 Tasks PUT (update) - Update task
  Required: TaskNum
  Optional: Descript, TaskStatus, UserNum

\u25B8 TaskLists GET - Get task lists
  No params required

\u25B8 TaskNotes GET (single) - Get single task note
  Required: TaskNoteNum

\u25B8 TaskNotes GET (multiple) - Get task notes
  Optional: TaskNum

\u25B8 TaskNotes POST (create) - Create task note
  Required: TaskNum, Note
  Optional: DateTimeNote

\u25B8 TaskNotes PUT (update) - Update task note
  Required: TaskNoteNum
  Optional: Note

\u25B8 CommLogs GET (single) - Get single comm log
  Required: CommlogNum

\u25B8 CommLogs GET (multiple) - Get comm logs
  Optional: PatNum, DateStart, DateEnd

\u25B8 CommLogs POST (create) - Create comm log
  Required: PatNum, CommDateTime, Mode_, Note
  Mode_ values: "None", "Email", "Phone", "InPerson", "Letter", "Text"

\u25B8 CommLogs PUT (update) - Update comm log
  Required: CommlogNum
  Optional: Note, Mode_

\u25B8 CommLogs DELETE - Delete comm log
  Required: CommlogNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           PATIENT FIELD TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getPatFieldDefs - Get patient field definitions
  No params required
  Returns: Custom field definitions

\u25B8 createPatFieldDef - Create custom field definition
  Required: FieldName
  Optional: FieldType, PickList

\u25B8 updatePatFieldDef - Update field definition
  Required: PatFieldDefNum
  Optional: FieldName, IsHidden

\u25B8 deletePatFieldDef - Delete field definition
  Required: PatFieldDefNum

\u25B8 getPatField - Get single patient field
  Required: PatFieldNum

\u25B8 getPatFields - Get patient fields
  Optional: PatNum
  Returns: Custom field values for patient

\u25B8 createPatField - Create patient field value
  Required: PatNum, FieldName, FieldValue

\u25B8 updatePatField - Update patient field value
  Required: PatFieldNum
  Optional: FieldValue

\u25B8 deletePatField - Delete patient field
  Required: PatFieldNum

\u25B8 getPatientNote - Get patient note
  Required: PatNum

\u25B8 getPatientNotes - Get all notes for patient
  Required: PatNum

\u25B8 updatePatientNote - Update patient note
  Required: PatNum
  Optional: FamFinancial, ICEName, ICEPhone, MedUrgNote

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           PHARMACY & PRESCRIPTION TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getPharmacy - Get single pharmacy
  Required: PharmacyNum

\u25B8 getPharmacies - Get all pharmacies
  No params required

\u25B8 RxPats GET (single) - Get single prescription
  Required: RxNum

\u25B8 RxPats GET (multiple) - Get prescriptions
  Optional: PatNum

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           REPORT TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 Reports GET Aging - Get aging report
  Optional: Date (as-of date)
  Returns: Patient aging balances

\u25B8 Reports GET FinanceCharges - Get finance charges report
  Optional: DateStart, DateEnd
  Returns: Finance charges applied

\u25B8 SecurityLogs GET - Get security/audit logs
  Optional: PermType, DateStart, DateEnd

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                           MISCELLANEOUS TOOLS
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u25B8 getSignalods - Get signals/notifications
  Required: SigDateTime
  Returns: System signals since datetime

\u25B8 createSubscription - Create webhook subscription
  Required: EndPointUrl, WorkstationName

\u25B8 getSubscriptions - Get webhook subscriptions
  No params required

\u25B8 updateSubscription - Update subscription
  Required: SubscriptionNum
  Optional: EndPointUrl, Enabled

\u25B8 deleteSubscription - Delete subscription
  Required: SubscriptionNum

\u25B8 ToothInitials GET - Get tooth initial conditions
  Optional: PatNum

\u25B8 ToothInitials POST (create) - Create tooth initial
  Required: PatNum, ToothNum, InitialType

\u25B8 ToothInitials DELETE - Delete tooth initial
  Required: ToothInitialNum

\u25B8 QuickPasteNotes GET (single) - Get quick paste note
  Required: QuickPasteNoteNum

\u25B8 QuickPasteNotes GET (multiple) - Get quick paste notes
  Optional: QuickPasteCatNum

\u25B8 getSubstitutionLinks - Get procedure substitution links
  Optional: PlanNum, CodeNum

\u25B8 createSubstitutionLink - Create substitution link
  Required: PlanNum, CodeNum, SubstitutionCode

\u25B8 updateSubstitutionLink - Update substitution link
  Required: SubstitutionLinkNum
  Optional: SubstitutionCode

\u25B8 deleteSubstitutionLink - Delete substitution link
  Required: SubstitutionLinkNum

\u25B8 getProcTPs - Get procedure treatment plan info
  Optional: TreatPlanNum, PatNum

\u25B8 updateProcTP - Update procedure TP
  Required: ProcTPNum
  Optional: Priority, ToothNumTP

\u25B8 deleteProcTP - Delete procedure TP
  Required: ProcTPNum`,
        parameters: [
          {
            name: "toolName",
            in: "path",
            required: true,
            description: "The OpenDental tool to execute",
            schema: {
              type: "string",
              enum: [
                // ===== CLINIC INFO TOOL (No patient ID required) =====
                "getClinicInfo",
                // ===== PATIENT TOOLS =====
                "searchPatients",
                "createPatient",
                "getPatientByPatNum",
                "updatePatient",
                // ===== APPOINTMENT TOOLS =====
                "scheduleAppointment",
                "getUpcomingAppointments",
                "rescheduleAppointment",
                "cancelAppointment",
                "getHistAppointments",
                "Appointments GET (single)",
                "Appointments GET (multiple)",
                "Appointments GET ASAP",
                "Appointments GET Slots",
                "Appointments GET SlotsWebSched",
                "Appointments GET WebSched",
                "Appointments POST (create)",
                "Appointments POST Planned",
                "Appointments POST SchedulePlanned",
                "Appointments POST WebSched",
                "Appointments PUT (update)",
                "Appointments PUT Break",
                "Appointments PUT Note",
                "Appointments PUT Confirm",
                "getClinicAppointmentTypes",
                // Get available appointment types (duration, operatory, etc.)
                "getAppointment",
                "getAppointments",
                "createAppointment",
                "updateAppointment",
                "breakAppointment",
                "getAppointmentSlots",
                "getPlannedAppts",
                // ===== PROCEDURE & TREATMENT PLAN TOOLS =====
                "getProcedureLogs",
                "getProcedureLog",
                "getTreatmentPlans",
                "TreatPlans GET",
                "TreatPlans POST (create)",
                "TreatPlans POST Saved",
                "TreatPlans PUT (update)",
                "TreatPlans DELETE",
                "getProcedureCode",
                "createProcedureLog",
                "updateProcedureLog",
                "deleteProcedureLog",
                "getProcedureCodes",
                "createProcedureCode",
                "updateProcedureCode",
                "getProcedureLogsInsuranceHistory",
                "getProcedureLogsGroupNotes",
                "createProcedureLogGroupNote",
                "createProcedureLogInsuranceHistory",
                "updateProcedureLogGroupNote",
                "deleteProcedureLogGroupNote",
                "createTreatPlan",
                "updateTreatPlan",
                "getTreatPlanAttaches",
                "createTreatPlanAttach",
                "updateTreatPlanAttach",
                "getProcNotes",
                "createProcNote",
                "getProgNotes",
                "getProcTPs",
                "updateProcTP",
                "deleteProcTP",
                // ===== INSURANCE COVERAGE LOOKUP (NO PatNum) =====
                "suggestInsuranceCoverage",
                "getInsurancePlanBenefits",
                "checkProcedureCoverage",
                "isProcedureCovered",
                "getInsuranceDetails",
                "getDeductibleInfo",
                "checkDeductible",
                "deductibleStatus",
                "getAnnualMaxInfo",
                "checkAnnualMax",
                "getRemainingBenefits",
                "annualMaximum",
                "getCoverageBreakdown",
                "coverageDetails",
                "getCopayAndFrequencyInfo",
                "getFrequencyLimits",
                "copayInfo",
                "getWaitingPeriodInfo",
                "waitingPeriods",
                "getExclusions",
                "getEstimateExplanation",
                "estimateAccuracy",
                "whyPriceChanges",
                "getCoordinationOfBenefits",
                "dualInsurance",
                "secondaryInsurance",
                "whichInsuranceIsPrimary",
                "getPaymentInfo",
                "paymentOptions",
                "paymentPlans",
                "financing",
                "checkCoverage",
                // ===== PATIENT-SPECIFIC INSURANCE TOOLS =====
                "getBenefits",
                "getFamilyInsurance",
                "getClaims",
                "getCarriers",
                "getInsPlan",
                "getInsPlans",
                "createInsPlan",
                "updateInsPlan",
                "getInsSub",
                "getInsSubs",
                "createInsSub",
                "updateInsSub",
                "deleteInsSub",
                "getPatPlans",
                "createPatPlan",
                "updatePatPlan",
                "deletePatPlan",
                "getInsVerify",
                "getInsVerifies",
                "updateInsVerify",
                "getSubstitutionLinks",
                "createSubstitutionLink",
                "updateSubstitutionLink",
                "deleteSubstitutionLink",
                // ===== FEE SCHEDULE TOOLS =====
                "getFeeSchedules",
                "getFeeForProcedure",
                "getFeeScheduleAmounts",
                "listFeeSchedules",
                "compareProcedureFees",
                "getFees",
                // ===== COST ESTIMATION TOOLS =====
                "estimateTreatmentCost",
                "calculateOutOfPocket",
                // ===== ACCOUNT & BILLING TOOLS =====
                "getAccountAging",
                "getPatientBalances",
                "getServiceDateView",
                "getPatientAccountSummary",
                "getPayments",
                "createPayment",
                "createPaymentRefund",
                "updatePayment",
                "updatePaymentPartial",
                "getPaySplits",
                "createPaySplit",
                "updatePaySplit",
                "getPayPlan",
                "getPayPlans",
                "getPayPlanCharges",
                "createPayPlan",
                "createPayPlanDynamic",
                "updatePayPlanDynamic",
                "closePayPlan",
                // ===== STATEMENT TOOLS =====
                "getStatement",
                "getStatements",
                "createStatement",
                // ===== MEDICAL HISTORY TOOLS =====
                "getAllergies",
                "createAllergy",
                "updateAllergy",
                "deleteAllergy",
                "getDiseaseDefs",
                "getDiseases",
                "createDisease",
                "updateDisease",
                "getMedicationPat",
                "getMedicationPats",
                "createMedicationPat",
                "updateMedicationPat",
                "deleteMedicationPat",
                "getMedications",
                "createMedication",
                "getPatientInfo",
                "getPatientRaces",
                // ===== RECALL & SCHEDULING TOOLS =====
                "Recalls GET",
                "Recalls GET List",
                "Recalls POST (create)",
                "Recalls PUT (update)",
                "Recalls PUT Status",
                "Recalls PUT SwitchType",
                "RecallTypes GET (single)",
                "RecallTypes GET (multiple)",
                "Schedules GET (single)",
                "Schedules GET (multiple)",
                "ScheduleOps GET",
                "getOperatory",
                "getOperatories",
                // ===== PROVIDER & STAFF TOOLS =====
                "Providers GET (single)",
                "Providers GET (multiple)",
                "Providers POST (create)",
                "Providers PUT (update)",
                "Employees GET (single)",
                "Employees GET (multiple)",
                "Userods GET",
                "Userods POST (create)",
                "Userods PUT (update)",
                "UserGroups GET",
                "UserGroupAttaches GET",
                // ===== LAB & REFERRAL TOOLS =====
                "getLabCase",
                "getLabCases",
                "createLabCase",
                "updateLabCase",
                "deleteLabCase",
                "getLaboratory",
                "getLaboratories",
                "createLaboratory",
                "updateLaboratory",
                "getLabTurnaround",
                "getLabTurnarounds",
                "createLabTurnaround",
                "updateLabTurnaround",
                "Referrals GET (single)",
                "Referrals GET (multiple)",
                "Referrals POST (create)",
                "Referrals PUT (update)",
                "RefAttaches GET",
                "RefAttaches POST (create)",
                "RefAttaches PUT (update)",
                "RefAttaches DELETE",
                // ===== PERIODONTAL TOOLS =====
                "getPerioExams",
                "getPerioExam",
                "createPerioExam",
                "updatePerioExam",
                "deletePerioExam",
                "getPerioMeasures",
                "createPerioMeasure",
                "updatePerioMeasure",
                "deletePerioMeasure",
                // ===== DOCUMENT & FORM TOOLS =====
                "getSheets",
                "createSheet",
                "downloadSheetSftp",
                "getSheetField",
                "getSheetFields",
                "updateSheetField",
                "SheetDefs GET (single)",
                "SheetDefs GET (multiple)",
                "Documents GET (single)",
                "Documents GET (multiple)",
                "Documents POST (create)",
                "Documents PUT (update)",
                "Documents DELETE",
                // ===== TASK & COMMUNICATION TOOLS =====
                "Tasks GET (single)",
                "Tasks GET (multiple)",
                "Tasks POST (create)",
                "Tasks PUT (update)",
                "TaskLists GET",
                "TaskNotes GET (single)",
                "TaskNotes GET (multiple)",
                "TaskNotes POST (create)",
                "TaskNotes PUT (update)",
                "CommLogs GET (single)",
                "CommLogs GET (multiple)",
                "CommLogs POST (create)",
                "CommLogs PUT (update)",
                "CommLogs DELETE",
                // ===== PATIENT FIELD TOOLS =====
                "getPatFieldDefs",
                "createPatFieldDef",
                "updatePatFieldDef",
                "deletePatFieldDef",
                "getPatField",
                "getPatFields",
                "createPatField",
                "updatePatField",
                "deletePatField",
                "getPatientNote",
                "getPatientNotes",
                "updatePatientNote",
                // ===== PHARMACY & PRESCRIPTION TOOLS =====
                "getPharmacy",
                "getPharmacies",
                "RxPats GET (single)",
                "RxPats GET (multiple)",
                // ===== REPORT TOOLS =====
                "Reports GET Aging",
                "Reports GET FinanceCharges",
                "SecurityLogs GET",
                // ===== MISCELLANEOUS TOOLS =====
                "getSignalods",
                "createSubscription",
                "getSubscriptions",
                "updateSubscription",
                "deleteSubscription",
                "ToothInitials GET",
                "ToothInitials POST (create)",
                "ToothInitials DELETE",
                "QuickPasteNotes GET (single)",
                "QuickPasteNotes GET (multiple)",
                "getPopups",
                "createPopup",
                "updatePopup",
                "getPreferences",
                "transferToHuman"
              ]
            }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: `Parameters for the tool. Required fields depend on the toolName selected.

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
                     COMMON PARAMETER EXAMPLES
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

INSURANCE LOOKUP (no PatNum needed):
- Insurance name only: {"insuranceName": "Delta Dental"}
- With group number: {"insuranceName": "Cigna", "groupNumber": "12345"}
- Selecting from list: {"insuranceName": "MetLife", "groupName": "ACME CORP"}

PATIENT LOOKUP:
- {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}

APPOINTMENT BOOKING:
- {"PatNum": 123, "Reason": "Crown", "Date": "2024-12-20 09:00:00", "OpName": "ONLINE_BOOKING_MAJOR"}

PROCEDURE LOOKUP:
- {"PatNum": 123, "ProcStatus": "TP"}

IMPORTANT NOTES:
- When user provides group number AND carrier name, include BOTH parameters
- When user selects a plan from a list, use insuranceName + groupName
- Date formats are flexible - system normalizes automatically`,
                properties: {
                  // ===== PATIENT IDENTIFIERS =====
                  PatNum: {
                    type: "integer",
                    description: "Patient number (unique ID). Required for most patient-specific tools."
                  },
                  LName: {
                    type: "string",
                    description: "Patient last name. Required for searchPatients and createPatient."
                  },
                  FName: {
                    type: "string",
                    description: "Patient first name. Required for searchPatients and createPatient."
                  },
                  MiddleI: {
                    type: "string",
                    description: "Patient middle initial."
                  },
                  Preferred: {
                    type: "string",
                    description: "Patient preferred/nickname."
                  },
                  Birthdate: {
                    type: "string",
                    description: 'Date of birth. Accepts: YYYY-MM-DD, MM/DD/YYYY, "July 11, 1984", etc.'
                  },
                  Gender: {
                    type: "string",
                    description: "Patient gender."
                  },
                  // ===== CONTACT INFO =====
                  WirelessPhone: {
                    type: "string",
                    description: "Mobile phone number."
                  },
                  HmPhone: {
                    type: "string",
                    description: "Home phone number."
                  },
                  WkPhone: {
                    type: "string",
                    description: "Work phone number."
                  },
                  Email: {
                    type: "string",
                    description: "Email address."
                  },
                  Address: {
                    type: "string",
                    description: "Street address line 1."
                  },
                  Address2: {
                    type: "string",
                    description: "Street address line 2."
                  },
                  City: {
                    type: "string",
                    description: "City."
                  },
                  State: {
                    type: "string",
                    description: "State abbreviation."
                  },
                  Zip: {
                    type: "string",
                    description: "ZIP/postal code."
                  },
                  // ===== APPOINTMENT PARAMETERS =====
                  AptNum: {
                    type: "integer",
                    description: "Appointment number. Required for reschedule/cancel."
                  },
                  appointmentType: {
                    type: "string",
                    description: 'Appointment type label for getClinicAppointmentTypes. Examples: "New Patient", "Cleaning", "Crown"'
                  },
                  Date: {
                    type: "string",
                    description: "Appointment datetime. Format: YYYY-MM-DD HH:mm:ss"
                  },
                  NewDateTime: {
                    type: "string",
                    description: "New datetime for rescheduling. Format: YYYY-MM-DD HH:mm:ss"
                  },
                  Reason: {
                    type: "string",
                    description: "Appointment reason/purpose."
                  },
                  OpName: {
                    type: "string",
                    description: "Operatory name: ONLINE_BOOKING_EXAM, ONLINE_BOOKING_MINOR, ONLINE_BOOKING_MAJOR"
                  },
                  Note: {
                    type: "string",
                    description: "Additional notes."
                  },
                  SendToUnscheduledList: {
                    type: "boolean",
                    description: "Add to unscheduled list when cancelling. Default: true"
                  },
                  ProvNum: {
                    type: "integer",
                    description: "Provider number."
                  },
                  OperatoryNum: {
                    type: "integer",
                    description: "Operatory number."
                  },
                  DateStart: {
                    type: "string",
                    description: "Start date for date range queries."
                  },
                  DateEnd: {
                    type: "string",
                    description: "End date for date range queries."
                  },
                  // ===== PROCEDURE PARAMETERS =====
                  ProcNum: {
                    type: "integer",
                    description: "Procedure number."
                  },
                  ProcStatus: {
                    type: "string",
                    description: "Procedure status: TP (treatment-planned), C (complete), EC (existing current)."
                  },
                  ProcDate: {
                    type: "string",
                    description: "Procedure date."
                  },
                  CodeNum: {
                    type: "integer",
                    description: "Procedure code number."
                  },
                  procCode: {
                    type: "string",
                    description: "CDT procedure code (e.g., D2750 for crown)."
                  },
                  procedureCode: {
                    type: "string",
                    description: "Alias for procCode."
                  },
                  ProcFee: {
                    type: "number",
                    description: "Procedure fee amount."
                  },
                  ToothNum: {
                    type: "string",
                    description: "Tooth number."
                  },
                  Surf: {
                    type: "string",
                    description: "Surface(s) for the procedure."
                  },
                  // ===== TREATMENT PLAN PARAMETERS =====
                  TreatPlanNum: {
                    type: "integer",
                    description: "Treatment plan number."
                  },
                  Heading: {
                    type: "string",
                    description: "Treatment plan heading/title."
                  },
                  TPStatus: {
                    type: "string",
                    description: "Treatment plan status."
                  },
                  Priority: {
                    type: "integer",
                    description: "Priority level."
                  },
                  // ===== INSURANCE LOOKUP PARAMETERS (NO PatNum needed) =====
                  insuranceName: {
                    type: "string",
                    description: "Insurance carrier name. Case-insensitive. Examples: Delta Dental, Cigna, Aetna, BCBS, MetLife, Guardian, Humana, United Healthcare."
                  },
                  groupName: {
                    type: "string",
                    description: "Employer/group name. Use when selecting from a list of plans."
                  },
                  groupNumber: {
                    type: "string",
                    description: "Group number from insurance card. Include with insuranceName for best results."
                  },
                  procedure: {
                    type: "string",
                    description: "Procedure name in natural language: cleaning, crown, root canal, filling, extraction, implant, dentures, braces, etc."
                  },
                  procedureName: {
                    type: "string",
                    description: "Alias for procedure."
                  },
                  // ===== PATIENT-SPECIFIC INSURANCE PARAMETERS =====
                  PlanNum: {
                    type: "integer",
                    description: "Insurance plan number."
                  },
                  PatPlanNum: {
                    type: "integer",
                    description: "Patient plan assignment number."
                  },
                  InsSubNum: {
                    type: "integer",
                    description: "Insurance subscriber number."
                  },
                  CarrierNum: {
                    type: "integer",
                    description: "Carrier number."
                  },
                  ClaimStatus: {
                    type: "string",
                    description: "Claim status filter."
                  },
                  Ordinal: {
                    type: "integer",
                    description: "Insurance ordinal: 1=primary, 2=secondary."
                  },
                  Relationship: {
                    type: "string",
                    description: "Relationship to subscriber."
                  },
                  // ===== FEE SCHEDULE PARAMETERS =====
                  FeeSchedNum: {
                    type: "integer",
                    description: "Fee schedule number."
                  },
                  feeSchedNum: {
                    type: "integer",
                    description: "Alias for FeeSchedNum."
                  },
                  feeSchedule: {
                    type: "string",
                    description: "Fee schedule name."
                  },
                  feeScheduleName: {
                    type: "string",
                    description: "Alias for feeSchedule."
                  },
                  // ===== ACCOUNT PARAMETERS =====
                  isFamily: {
                    type: "boolean",
                    description: "Include family members in query."
                  },
                  PayNum: {
                    type: "integer",
                    description: "Payment number."
                  },
                  PayAmt: {
                    type: "number",
                    description: "Payment amount."
                  },
                  PayDate: {
                    type: "string",
                    description: "Payment date."
                  },
                  PayType: {
                    type: "string",
                    description: "Payment type."
                  },
                  PayNote: {
                    type: "string",
                    description: "Payment note."
                  },
                  CheckNum: {
                    type: "string",
                    description: "Check number."
                  },
                  SplitAmt: {
                    type: "number",
                    description: "Payment split amount."
                  },
                  StatementNum: {
                    type: "integer",
                    description: "Statement number."
                  },
                  DateSent: {
                    type: "string",
                    description: "Date statement was sent."
                  },
                  // ===== MEDICAL HISTORY PARAMETERS =====
                  AllergyNum: {
                    type: "integer",
                    description: "Allergy record number."
                  },
                  AllergyDefNum: {
                    type: "integer",
                    description: "Allergy definition number."
                  },
                  Reaction: {
                    type: "string",
                    description: "Allergy reaction description."
                  },
                  StatusIsActive: {
                    type: "boolean",
                    description: "Whether allergy/condition is active."
                  },
                  DiseaseNum: {
                    type: "integer",
                    description: "Disease record number."
                  },
                  DiseaseDefNum: {
                    type: "integer",
                    description: "Disease definition number."
                  },
                  ProbStatus: {
                    type: "string",
                    description: "Problem status."
                  },
                  MedicationNum: {
                    type: "integer",
                    description: "Medication number."
                  },
                  MedicationPatNum: {
                    type: "integer",
                    description: "Patient medication record number."
                  },
                  PatNote: {
                    type: "string",
                    description: "Patient-specific medication note."
                  },
                  // ===== RECALL PARAMETERS =====
                  RecallNum: {
                    type: "integer",
                    description: "Recall number."
                  },
                  RecallTypeNum: {
                    type: "integer",
                    description: "Recall type number."
                  },
                  DateScheduled: {
                    type: "string",
                    description: "Scheduled date for recall."
                  },
                  DateDue: {
                    type: "string",
                    description: "Due date for recall."
                  },
                  // ===== SCHEDULE PARAMETERS =====
                  ScheduleNum: {
                    type: "integer",
                    description: "Schedule number."
                  },
                  date: {
                    type: "string",
                    description: "Single date for schedule query."
                  },
                  dateStart: {
                    type: "string",
                    description: "Start date for schedule range."
                  },
                  dateEnd: {
                    type: "string",
                    description: "End date for schedule range."
                  },
                  SchedType: {
                    type: "string",
                    description: "Schedule type: Practice, Provider, Blockout, Employee, WebSchedASAP."
                  },
                  EmployeeNum: {
                    type: "integer",
                    description: "Employee number."
                  },
                  // ===== LAB PARAMETERS =====
                  LabCaseNum: {
                    type: "integer",
                    description: "Lab case number."
                  },
                  LaboratoryNum: {
                    type: "integer",
                    description: "Laboratory number."
                  },
                  DateTimeSent: {
                    type: "string",
                    description: "Date/time lab case was sent."
                  },
                  DateTimeRecd: {
                    type: "string",
                    description: "Date/time lab case was received."
                  },
                  Instructions: {
                    type: "string",
                    description: "Lab case instructions."
                  },
                  // ===== REFERRAL PARAMETERS =====
                  ReferralNum: {
                    type: "integer",
                    description: "Referral number."
                  },
                  RefAttachNum: {
                    type: "integer",
                    description: "Referral attachment number."
                  },
                  RefType: {
                    type: "string",
                    description: "Referral type."
                  },
                  // ===== PERIODONTAL PARAMETERS =====
                  PerioExamNum: {
                    type: "integer",
                    description: "Perio exam number."
                  },
                  PerioMeasureNum: {
                    type: "integer",
                    description: "Perio measurement number."
                  },
                  ExamDate: {
                    type: "string",
                    description: "Exam date."
                  },
                  SequenceType: {
                    type: "string",
                    description: "Perio measurement sequence type."
                  },
                  IntTooth: {
                    type: "integer",
                    description: "Tooth number for perio measurement."
                  },
                  ToothValue: {
                    type: "integer",
                    description: "Perio measurement tooth value."
                  },
                  MBvalue: { type: "integer", description: "Mesio-buccal value." },
                  Bvalue: { type: "integer", description: "Buccal value." },
                  DBvalue: { type: "integer", description: "Disto-buccal value." },
                  MLvalue: { type: "integer", description: "Mesio-lingual value." },
                  Lvalue: { type: "integer", description: "Lingual value." },
                  DLvalue: { type: "integer", description: "Disto-lingual value." },
                  // ===== DOCUMENT/SHEET PARAMETERS =====
                  SheetNum: {
                    type: "integer",
                    description: "Sheet number."
                  },
                  SheetDefNum: {
                    type: "integer",
                    description: "Sheet definition number."
                  },
                  SheetType: {
                    type: "string",
                    description: "Sheet type."
                  },
                  SheetFieldNum: {
                    type: "integer",
                    description: "Sheet field number."
                  },
                  FieldValue: {
                    type: "string",
                    description: "Field value."
                  },
                  DocNum: {
                    type: "integer",
                    description: "Document number."
                  },
                  DocCategory: {
                    type: "integer",
                    description: "Document category."
                  },
                  fileName: {
                    type: "string",
                    description: "File name for uploads."
                  },
                  fileData: {
                    type: "string",
                    description: "Base64 encoded file data."
                  },
                  Description: {
                    type: "string",
                    description: "Description text."
                  },
                  // ===== TASK PARAMETERS =====
                  TaskNum: {
                    type: "integer",
                    description: "Task number."
                  },
                  TaskListNum: {
                    type: "integer",
                    description: "Task list number."
                  },
                  TaskNoteNum: {
                    type: "integer",
                    description: "Task note number."
                  },
                  Descript: {
                    type: "string",
                    description: "Task description."
                  },
                  TaskStatus: {
                    type: "string",
                    description: "Task status."
                  },
                  DateTask: {
                    type: "string",
                    description: "Task date."
                  },
                  UserNum: {
                    type: "integer",
                    description: "User number."
                  },
                  // ===== COMMUNICATION PARAMETERS =====
                  CommlogNum: {
                    type: "integer",
                    description: "Communication log number."
                  },
                  CommDateTime: {
                    type: "string",
                    description: "Communication date/time."
                  },
                  Mode_: {
                    type: "string",
                    description: "Communication mode: None, Email, Phone, InPerson, Letter, Text."
                  },
                  // ===== PATIENT FIELD PARAMETERS =====
                  PatFieldNum: {
                    type: "integer",
                    description: "Patient field number."
                  },
                  PatFieldDefNum: {
                    type: "integer",
                    description: "Patient field definition number."
                  },
                  FieldName: {
                    type: "string",
                    description: "Custom field name."
                  },
                  FieldType: {
                    type: "string",
                    description: "Custom field type."
                  },
                  // ===== MISC PARAMETERS =====
                  ClinicNum: {
                    type: "integer",
                    description: "Clinic number."
                  },
                  clinicId: {
                    type: "string",
                    description: "Clinic ID (auto-filled from session)."
                  },
                  DateTStamp: {
                    type: "string",
                    description: "Timestamp for filtering changed records."
                  },
                  Offset: {
                    type: "integer",
                    description: "Pagination offset."
                  },
                  SigDateTime: {
                    type: "string",
                    description: "Signal datetime for getSignalods."
                  },
                  SubscriptionNum: {
                    type: "integer",
                    description: "Subscription number."
                  },
                  EndPointUrl: {
                    type: "string",
                    description: "Webhook endpoint URL."
                  },
                  WorkstationName: {
                    type: "string",
                    description: "Workstation name for subscription."
                  },
                  Enabled: {
                    type: "boolean",
                    description: "Whether subscription is enabled."
                  },
                  ToothInitialNum: {
                    type: "integer",
                    description: "Tooth initial number."
                  },
                  InitialType: {
                    type: "string",
                    description: "Tooth initial type."
                  },
                  QuickPasteNoteNum: {
                    type: "integer",
                    description: "Quick paste note number."
                  },
                  QuickPasteCatNum: {
                    type: "integer",
                    description: "Quick paste category number."
                  },
                  SubstitutionLinkNum: {
                    type: "integer",
                    description: "Substitution link number."
                  },
                  SubstitutionCode: {
                    type: "string",
                    description: "Substitution procedure code."
                  },
                  ProcTPNum: {
                    type: "integer",
                    description: "Procedure treatment plan number."
                  },
                  PermType: {
                    type: "string",
                    description: "Permission type for security logs."
                  },
                  IsHidden: {
                    type: "boolean",
                    description: "Whether record is hidden."
                  },
                  // ===== COST ESTIMATION PARAMETERS =====
                  patientName: {
                    type: "string",
                    description: 'Patient full name for benefit lookup. Format: "First Last".'
                  },
                  patientDOB: {
                    type: "string",
                    description: "Patient DOB for verification."
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Successful operation",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["SUCCESS", "FAILURE"],
                      description: "Operation status"
                    },
                    directAnswer: {
                      type: "string",
                      description: "Pre-formatted answer to give to user. USE THIS IN YOUR RESPONSE!"
                    },
                    lookupStatus: {
                      type: "string",
                      description: "For insurance lookups: COVERAGE_DETAILS_FOUND or PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"
                    },
                    data: {
                      type: "object",
                      description: "Response data specific to the tool"
                    },
                    message: {
                      type: "string",
                      description: "Human-readable message"
                    },
                    totalCount: {
                      type: "integer",
                      description: "Total count of results (when paginated)"
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Bad request - missing or invalid parameters"
          },
          "404": {
            description: "Resource not found"
          },
          "500": {
            description: "Server error"
          }
        }
      }
    }
  }
};
var agents_default = OPENAPI_SCHEMA;
var handler = async (event) => {
  const httpMethod = event.httpMethod;
  let path = event.path || event.resource || "";
  if (path.startsWith("/ai-agents/ai-agents")) {
    path = path.replace("/ai-agents/ai-agents", "/ai-agents");
  }
  if (httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: "CORS preflight" }) };
  }
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Unauthorized" }) };
  }
  try {
    const agentId = event.pathParameters?.agentId;
    if ((path === "/models" || path.endsWith("/models")) && httpMethod === "GET") {
      return listModels(event);
    }
    if (agentId && path.endsWith("/prepare") && httpMethod === "POST") {
      return await prepareAgent(event, userPerms, agentId);
    }
    if ((path === "/agents" || path.endsWith("/agents")) && httpMethod === "GET") {
      return await listAgents(event, userPerms);
    }
    if ((path === "/agents" || path.endsWith("/agents")) && httpMethod === "POST") {
      return await createAgent(event, userPerms);
    }
    if (agentId && httpMethod === "GET" && !path.includes("/prepare")) {
      return await getAgent(event, userPerms, agentId);
    }
    if (agentId && httpMethod === "PUT") {
      return await updateAgent(event, userPerms, agentId);
    }
    if (agentId && httpMethod === "DELETE") {
      return await deleteAgent(event, userPerms, agentId);
    }
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Not Found" }) };
  } catch (error) {
    console.error("Handler error:", error);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error.message }) };
  }
};
function listModels(event) {
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      models: AVAILABLE_MODELS,
      defaultModel: AVAILABLE_MODELS.find((m) => m.recommended)?.id
    })
  };
}
async function listAgents(event, userPerms) {
  const clinicId = event.queryStringParameters?.clinicId;
  const includePublic = event.queryStringParameters?.includePublic !== "false";
  let command;
  if (clinicId) {
    command = new import_lib_dynamodb2.QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: "ClinicIndex",
      KeyConditionExpression: "clinicId = :cid",
      ExpressionAttributeValues: { ":cid": clinicId }
    });
  } else {
    command = new import_lib_dynamodb2.ScanCommand({ TableName: AGENTS_TABLE });
  }
  const response = await docClient.send(command);
  let agents = response.Items || [];
  const userClinicIds = userPerms.clinicRoles.map((cr) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;
  if (!isAdmin) {
    agents = agents.filter((agent) => userClinicIds.includes(agent.clinicId) || includePublic && agent.isPublic);
  }
  agents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      agents,
      totalCount: agents.length,
      // Legacy prompts (backward compatibility)
      defaultSystemPrompt: MEDIUM_SYSTEM_PROMPT,
      defaultNegativePrompt: MEDIUM_NEGATIVE_PROMPT,
      // Channel-specific prompts for voice and chat
      voiceSystemPrompt: VOICE_SYSTEM_PROMPT,
      voiceNegativePrompt: VOICE_NEGATIVE_PROMPT,
      chatSystemPrompt: CHAT_SYSTEM_PROMPT,
      chatNegativePrompt: CHAT_NEGATIVE_PROMPT
    })
  };
}
async function getAgent(event, userPerms, agentId) {
  const response = await docClient.send(new import_lib_dynamodb2.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item;
  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Agent not found" }) };
  }
  if (agent.bedrockAgentId) {
    try {
      const bedrockAgent = await bedrockAgentClient.send(new import_client_bedrock_agent.GetAgentCommand({ agentId: agent.bedrockAgentId }));
      if (bedrockAgent.agent?.agentStatus && bedrockAgent.agent.agentStatus !== agent.bedrockAgentStatus) {
        agent.bedrockAgentStatus = bedrockAgent.agent.agentStatus;
        await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
      }
    } catch (e) {
      console.error("Failed to sync Bedrock status:", e);
    }
  }
  const userClinicIds = userPerms.clinicRoles.map((cr) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;
  if (!isAdmin && !userClinicIds.includes(agent.clinicId) && !agent.isPublic) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Access denied" }) };
  }
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ agent, model: AVAILABLE_MODELS.find((m) => m.id === agent.modelId) })
  };
}
async function createAgent(event, userPerms) {
  const body = JSON.parse(event.body || "{}");
  if (!body.name) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Agent name is required" }) };
  }
  if (!body.clinicId) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Clinic ID is required" }) };
  }
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    "write",
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinicId
  );
  if (!canCreate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Permission denied" }) };
  }
  const defaultModelId = body.isVoiceEnabled === true ? DEFAULT_VOICE_MODEL_ID : AVAILABLE_MODELS.find((m) => m.recommended)?.id || AVAILABLE_MODELS[0].id;
  const modelId = body.modelId || defaultModelId;
  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!selectedModel) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Invalid model ID" }) };
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const createdBy = getUserDisplayName(userPerms);
  const internalAgentId = v4_default();
  const isVoiceAgent = body.isVoiceEnabled === true;
  const defaultSystem = isVoiceAgent ? VOICE_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
  const defaultNegative = isVoiceAgent ? VOICE_NEGATIVE_PROMPT : CHAT_NEGATIVE_PROMPT;
  const systemPrompt = body.systemPrompt || defaultSystem;
  const negativePrompt = body.negativePrompt || defaultNegative;
  const userPrompt = body.userPrompt || "";
  const fullInstruction = [
    "=== CORE INSTRUCTIONS ===",
    systemPrompt,
    "",
    "=== RESTRICTIONS ===",
    negativePrompt,
    userPrompt ? "\n=== ADDITIONAL INSTRUCTIONS ===\n" + userPrompt : ""
  ].join("\n");
  let bedrockAgentId;
  let bedrockAgentStatus = "CREATING";
  let actionGroupCreated = false;
  let actionGroupError;
  try {
    const createResponse = await bedrockAgentClient.send(
      new import_client_bedrock_agent.CreateAgentCommand({
        agentName: `${body.name.replace(/[^a-zA-Z0-9-_]/g, "-")}-${internalAgentId.slice(0, 8)}`,
        agentResourceRoleArn: BEDROCK_AGENT_ROLE_ARN,
        foundationModel: modelId,
        instruction: fullInstruction,
        description: body.description || `AI Agent: ${body.name}`,
        idleSessionTTLInSeconds: 1800
      })
    );
    bedrockAgentId = createResponse.agent?.agentId;
    bedrockAgentStatus = createResponse.agent?.agentStatus || "CREATING";
    if (bedrockAgentId) {
      try {
        await bedrockAgentClient.send(
          new import_client_bedrock_agent.CreateAgentActionGroupCommand({
            agentId: bedrockAgentId,
            agentVersion: "DRAFT",
            actionGroupName: "OpenDentalTools",
            description: "OpenDental API tools for patient and appointment management",
            actionGroupExecutor: {
              lambda: ACTION_GROUP_LAMBDA_ARN
            },
            apiSchema: {
              payload: JSON.stringify(OPENAPI_SCHEMA)
            }
          })
        );
        actionGroupCreated = true;
        console.log(`[createAgent] Action group created successfully for agent ${bedrockAgentId}`);
      } catch (agError) {
        console.error("Failed to create Action Group:", agError);
        actionGroupError = agError.message;
      }
    }
  } catch (error) {
    console.error("Failed to create Bedrock Agent:", error);
    bedrockAgentStatus = "FAILED";
  }
  if (body.isDefaultVoiceAgent === true) {
    try {
      const existingDefaultsResponse = await docClient.send(new import_lib_dynamodb2.QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: "ClinicIndex",
        KeyConditionExpression: "clinicId = :cid",
        FilterExpression: "isDefaultVoiceAgent = :true",
        ExpressionAttributeValues: {
          ":cid": body.clinicId,
          ":true": true
        }
      }));
      if (existingDefaultsResponse.Items && existingDefaultsResponse.Items.length > 0) {
        for (const existingDefault of existingDefaultsResponse.Items) {
          console.log(`[createAgent] Clearing isDefaultVoiceAgent from ${existingDefault.agentId}`);
          const updatedAgent = { ...existingDefault, isDefaultVoiceAgent: false, updatedAt: timestamp, updatedBy: createdBy };
          await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: updatedAgent }));
        }
      }
    } catch (error) {
      console.error("[createAgent] Failed to clear existing default voice agents:", error);
    }
  }
  const agent = {
    agentId: internalAgentId,
    name: body.name,
    description: body.description || "",
    modelId,
    systemPrompt,
    negativePrompt,
    userPrompt,
    bedrockAgentId,
    bedrockAgentStatus,
    clinicId: body.clinicId,
    isActive: bedrockAgentStatus !== "FAILED",
    isPublic: body.isPublic === true,
    // Website chatbot settings
    isWebsiteEnabled: body.isWebsiteEnabled === true,
    // Voice AI settings
    isVoiceEnabled: body.isVoiceEnabled === true,
    isDefaultVoiceAgent: body.isDefaultVoiceAgent === true,
    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    updatedBy: createdBy,
    tags: Array.isArray(body.tags) ? body.tags : [],
    usageCount: 0
  };
  await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
  let message = "Agent created. Call /prepare to make it ready for invocation.";
  if (bedrockAgentStatus === "FAILED") {
    message = "Agent created but Bedrock Agent creation failed";
  } else if (!actionGroupCreated) {
    message = "Agent created but Action Group (function tools) failed. Call /prepare to retry.";
  }
  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message,
      agent,
      nextStep: bedrockAgentStatus !== "FAILED" ? "POST /agents/{agentId}/prepare" : void 0,
      actionGroup: {
        created: actionGroupCreated,
        error: actionGroupError,
        lambdaArn: ACTION_GROUP_LAMBDA_ARN
      }
    })
  };
}
async function prepareAgent(event, userPerms, agentId) {
  const response = await docClient.send(new import_lib_dynamodb2.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item;
  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Agent not found" }) };
  }
  if (!agent.bedrockAgentId) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: "No Bedrock Agent associated" }) };
  }
  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    "put",
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    agent.clinicId
  );
  if (!canUpdate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Permission denied" }) };
  }
  try {
    let actionGroupStatus = "unknown";
    try {
      const actionGroupsResponse = await bedrockAgentClient.send(
        new import_client_bedrock_agent.ListAgentActionGroupsCommand({
          agentId: agent.bedrockAgentId,
          agentVersion: "DRAFT"
        })
      );
      const existingActionGroup = actionGroupsResponse.actionGroupSummaries?.find(
        (ag) => ag.actionGroupName === "OpenDentalTools"
      );
      if (existingActionGroup) {
        console.log(`[prepareAgent] Updating action group to ensure schema and Lambda ARN are current`);
        await bedrockAgentClient.send(
          new import_client_bedrock_agent.UpdateAgentActionGroupCommand({
            agentId: agent.bedrockAgentId,
            agentVersion: "DRAFT",
            actionGroupId: existingActionGroup.actionGroupId,
            actionGroupName: "OpenDentalTools",
            description: "OpenDental API tools for patient and appointment management",
            actionGroupExecutor: {
              lambda: ACTION_GROUP_LAMBDA_ARN
            },
            apiSchema: {
              payload: JSON.stringify(OPENAPI_SCHEMA)
            }
          })
        );
        actionGroupStatus = "updated";
      } else {
        console.log(`[prepareAgent] Creating missing action group for agent ${agent.bedrockAgentId}`);
        await bedrockAgentClient.send(
          new import_client_bedrock_agent.CreateAgentActionGroupCommand({
            agentId: agent.bedrockAgentId,
            agentVersion: "DRAFT",
            actionGroupName: "OpenDentalTools",
            description: "OpenDental API tools for patient and appointment management",
            actionGroupExecutor: {
              lambda: ACTION_GROUP_LAMBDA_ARN
            },
            apiSchema: {
              payload: JSON.stringify(OPENAPI_SCHEMA)
            }
          })
        );
        actionGroupStatus = "created";
      }
      console.log(`[prepareAgent] Action group status: ${actionGroupStatus}`);
    } catch (actionGroupError) {
      console.error("[prepareAgent] Failed to check/create action group:", actionGroupError);
      return {
        statusCode: 500,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Failed to configure action group (function tools)",
          details: actionGroupError.message,
          actionGroupLambdaArn: ACTION_GROUP_LAMBDA_ARN,
          hint: "Check that the ACTION_GROUP_LAMBDA_ARN environment variable is correct"
        })
      };
    }
    const prepareResponse = await bedrockAgentClient.send(
      new import_client_bedrock_agent.PrepareAgentCommand({ agentId: agent.bedrockAgentId })
    );
    agent.bedrockAgentStatus = prepareResponse.agentStatus || "PREPARING";
    agent.bedrockAgentVersion = prepareResponse.agentVersion;
    let prepared = false;
    let failureReasons = [];
    let recommendedActions = [];
    const MAX_POLL_ITERATIONS = 5;
    const POLL_INTERVAL_MS = 4e3;
    for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const getResponse = await bedrockAgentClient.send(new import_client_bedrock_agent.GetAgentCommand({ agentId: agent.bedrockAgentId }));
      agent.bedrockAgentStatus = getResponse.agent?.agentStatus;
      if (agent.bedrockAgentStatus === import_client_bedrock_agent.AgentStatus.PREPARED) {
        prepared = true;
        break;
      } else if (agent.bedrockAgentStatus === import_client_bedrock_agent.AgentStatus.FAILED) {
        failureReasons = getResponse.agent?.failureReasons || [];
        recommendedActions = getResponse.agent?.recommendedActions || [];
        console.error("[prepareAgent] Agent preparation failed:", {
          failureReasons,
          recommendedActions,
          agentId: agent.bedrockAgentId
        });
        break;
      }
    }
    if (!prepared && agent.bedrockAgentStatus === "PREPARING") {
      agent.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      agent.updatedBy = getUserDisplayName(userPerms);
      await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
      return {
        statusCode: 202,
        // Accepted - still processing
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          message: "Agent is still preparing. Poll GET /agents/{agentId} to check status.",
          agent,
          isReady: false,
          checkAgain: true,
          actionGroup: {
            status: actionGroupStatus,
            lambdaArn: ACTION_GROUP_LAMBDA_ARN
          }
        })
      };
    }
    if (agent.bedrockAgentStatus === import_client_bedrock_agent.AgentStatus.FAILED) {
      agent.isActive = false;
      agent.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      agent.updatedBy = getUserDisplayName(userPerms);
      await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Agent preparation failed",
          message: "Bedrock Agent failed to prepare. Check the failure reasons below.",
          agent,
          isReady: false,
          failureReasons: failureReasons.length > 0 ? failureReasons : ["Unknown - check AWS Console for details"],
          recommendedActions: recommendedActions.length > 0 ? recommendedActions : [
            "Check the Bedrock Agent in AWS Console for detailed error messages",
            "Ensure the agent instruction is valid and not too long",
            "Verify the model is available in your region"
          ],
          actionGroup: {
            status: actionGroupStatus,
            lambdaArn: ACTION_GROUP_LAMBDA_ARN
          }
        })
      };
    }
    if (prepared) {
      try {
        const aliasesResponse = await bedrockAgentClient.send(
          new import_client_bedrock_agent.ListAgentAliasesCommand({ agentId: agent.bedrockAgentId })
        );
        const liveAlias = aliasesResponse.agentAliasSummaries?.find((a) => a.agentAliasName === "live");
        if (liveAlias) {
          agent.bedrockAgentAliasId = liveAlias.agentAliasId;
        } else {
          const createAliasResponse = await bedrockAgentClient.send(
            new import_client_bedrock_agent.CreateAgentAliasCommand({
              agentId: agent.bedrockAgentId,
              agentAliasName: "live",
              description: "Live alias for agent invocation"
            })
          );
          agent.bedrockAgentAliasId = createAliasResponse.agentAlias?.agentAliasId;
        }
      } catch (aliasError) {
        console.error("Failed to create alias:", aliasError);
      }
    }
    agent.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    agent.updatedBy = getUserDisplayName(userPerms);
    agent.isActive = agent.bedrockAgentStatus === import_client_bedrock_agent.AgentStatus.PREPARED;
    await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        message: prepared ? "Agent prepared and ready for invocation!" : `Agent status: ${agent.bedrockAgentStatus}`,
        agent,
        isReady: prepared && !!agent.bedrockAgentAliasId,
        actionGroup: {
          status: actionGroupStatus,
          lambdaArn: ACTION_GROUP_LAMBDA_ARN
        }
      })
    };
  } catch (error) {
    console.error("Prepare agent error:", error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message || "Failed to prepare agent" })
    };
  }
}
async function updateAgent(event, userPerms, agentId) {
  const response = await docClient.send(new import_lib_dynamodb2.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item;
  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Agent not found" }) };
  }
  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    "put",
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    agent.clinicId
  );
  if (!canUpdate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Permission denied" }) };
  }
  const body = JSON.parse(event.body || "{}");
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const updatedBy = getUserDisplayName(userPerms);
  agent.name = body.name ?? agent.name;
  agent.description = body.description ?? agent.description;
  agent.systemPrompt = body.systemPrompt ?? agent.systemPrompt;
  agent.negativePrompt = body.negativePrompt ?? agent.negativePrompt;
  agent.userPrompt = body.userPrompt ?? agent.userPrompt;
  if (body.modelId && body.modelId !== agent.modelId) {
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === body.modelId);
    if (!selectedModel) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Invalid model ID" }) };
    }
    agent.modelId = body.modelId;
  }
  agent.isPublic = typeof body.isPublic === "boolean" ? body.isPublic : agent.isPublic;
  agent.tags = Array.isArray(body.tags) ? body.tags : agent.tags;
  if (typeof body.isWebsiteEnabled === "boolean") {
    agent.isWebsiteEnabled = body.isWebsiteEnabled;
  }
  if (typeof body.isVoiceEnabled === "boolean") {
    agent.isVoiceEnabled = body.isVoiceEnabled;
  }
  if (body.isDefaultVoiceAgent === true && !agent.isDefaultVoiceAgent) {
    try {
      const existingDefaultsResponse = await docClient.send(new import_lib_dynamodb2.QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: "ClinicIndex",
        KeyConditionExpression: "clinicId = :cid",
        FilterExpression: "isDefaultVoiceAgent = :true AND agentId <> :currentAgentId",
        ExpressionAttributeValues: {
          ":cid": agent.clinicId,
          ":true": true,
          ":currentAgentId": agentId
        }
      }));
      if (existingDefaultsResponse.Items && existingDefaultsResponse.Items.length > 0) {
        for (const existingDefault of existingDefaultsResponse.Items) {
          console.log(`[updateAgent] Clearing isDefaultVoiceAgent from ${existingDefault.agentId}`);
          const updatedAgent = { ...existingDefault, isDefaultVoiceAgent: false, updatedAt: timestamp, updatedBy };
          await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: updatedAgent }));
        }
      }
    } catch (error) {
      console.error("[updateAgent] Failed to clear existing default voice agents:", error);
    }
  }
  if (typeof body.isDefaultVoiceAgent === "boolean") {
    agent.isDefaultVoiceAgent = body.isDefaultVoiceAgent;
  }
  agent.updatedAt = timestamp;
  agent.updatedBy = updatedBy;
  let bedrockUpdateError;
  if (agent.bedrockAgentId) {
    try {
      const fullInstruction = [
        "=== CORE INSTRUCTIONS ===",
        agent.systemPrompt,
        "",
        "=== RESTRICTIONS ===",
        agent.negativePrompt,
        agent.userPrompt ? "\n=== ADDITIONAL INSTRUCTIONS ===\n" + agent.userPrompt : ""
      ].join("\n");
      await bedrockAgentClient.send(
        new import_client_bedrock_agent.UpdateAgentCommand({
          agentId: agent.bedrockAgentId,
          agentName: `${agent.name.replace(/[^a-zA-Z0-9-_]/g, "-")}-${agent.agentId.slice(0, 8)}`,
          agentResourceRoleArn: BEDROCK_AGENT_ROLE_ARN,
          foundationModel: agent.modelId,
          instruction: fullInstruction,
          description: agent.description,
          idleSessionTTLInSeconds: 1800
        })
      );
      agent.bedrockAgentStatus = "NOT_PREPARED";
    } catch (error) {
      console.error("Failed to update Bedrock Agent:", error);
      bedrockUpdateError = error.message || "Unknown Bedrock error";
    }
  }
  await docClient.send(new import_lib_dynamodb2.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
  if (bedrockUpdateError) {
    return {
      statusCode: 207,
      // Multi-Status - partial success
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        message: "Agent saved locally but Bedrock sync failed",
        warning: `Bedrock update failed: ${bedrockUpdateError}. The agent may be out of sync.`,
        agent,
        bedrockSyncFailed: true,
        // FIX: Provide clear next steps for the user
        nextSteps: [
          "The local agent configuration has been saved",
          "Bedrock Agent update failed - the agent is running with its previous configuration",
          "Try calling /prepare to re-sync the agent with Bedrock",
          "If the problem persists, check the agent in AWS Console"
        ]
      })
    };
  }
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: agent.bedrockAgentStatus === "NOT_PREPARED" ? "Agent updated. Call /prepare to apply changes." : "Agent updated.",
      agent,
      needsPrepare: agent.bedrockAgentStatus === "NOT_PREPARED"
    })
  };
}
async function deleteAgent(event, userPerms, agentId) {
  const response = await docClient.send(new import_lib_dynamodb2.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item;
  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Agent not found" }) };
  }
  const canDelete = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    "delete",
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    agent.clinicId
  );
  if (!canDelete) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Permission denied" }) };
  }
  const bedrockAgentId = agent.bedrockAgentId;
  await docClient.send(new import_lib_dynamodb2.DeleteCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  let bedrockDeleteError;
  if (bedrockAgentId) {
    try {
      await bedrockAgentClient.send(
        new import_client_bedrock_agent.DeleteAgentCommand({
          agentId: bedrockAgentId,
          skipResourceInUseCheck: true
        })
      );
    } catch (error) {
      console.error("Failed to delete Bedrock Agent:", error);
      bedrockDeleteError = error.message;
    }
  }
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: "Agent deleted successfully",
      agentId,
      bedrockAgentDeleted: !bedrockDeleteError,
      bedrockCleanupWarning: bedrockDeleteError ? `Bedrock agent may need manual cleanup: ${bedrockDeleteError}` : void 0
    })
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AVAILABLE_MODELS,
  CHAT_NEGATIVE_PROMPT,
  CHAT_SYSTEM_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  VOICE_NEGATIVE_PROMPT,
  VOICE_SYSTEM_PROMPT,
  buildSystemPromptWithDate,
  handler
});
