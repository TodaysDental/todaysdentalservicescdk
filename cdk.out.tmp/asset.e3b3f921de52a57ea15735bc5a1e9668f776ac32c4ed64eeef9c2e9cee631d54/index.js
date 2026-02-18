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

// src/services/ai-agents/invoke-agent.ts
var invoke_agent_exports = {};
__export(invoke_agent_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(invoke_agent_exports);
var import_client_dynamodb3 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");

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
function getUserDisplayName(permissions) {
  return permissions.givenName || permissions.email || "system";
}

// src/shared/prompts/ai-prompts.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var docClient = null;
function getDocClient() {
  if (!docClient) {
    docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
  }
  return docClient;
}
var timezoneCache = /* @__PURE__ */ new Map();
var TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1e3;
var clinicNameCache = /* @__PURE__ */ new Map();
var CLINIC_NAME_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getClinicName(clinicId) {
  const DEFAULT_CLINIC_NAME = clinicId || "the clinic";
  if (!clinicId)
    return DEFAULT_CLINIC_NAME;
  const cached = clinicNameCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < CLINIC_NAME_CACHE_TTL_MS)
    return cached.clinicName;
  try {
    const response = await getDocClient().send(new import_lib_dynamodb.GetCommand({
      TableName: process.env.CLINICS_TABLE || "Clinics",
      Key: { clinicId },
      ProjectionExpression: "clinicName, #n",
      ExpressionAttributeNames: { "#n": "name" }
    }));
    const clinicName = response.Item?.clinicName || response.Item?.name || DEFAULT_CLINIC_NAME;
    clinicNameCache.set(clinicId, { clinicName, timestamp: Date.now() });
    return clinicName;
  } catch {
    return DEFAULT_CLINIC_NAME;
  }
}
async function getClinicTimezone(clinicId) {
  const DEFAULT_TIMEZONE = "America/Chicago";
  if (!clinicId)
    return DEFAULT_TIMEZONE;
  const cached = timezoneCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < TIMEZONE_CACHE_TTL_MS)
    return cached.timezone;
  try {
    const response = await getDocClient().send(new import_lib_dynamodb.GetCommand({
      TableName: process.env.CLINICS_TABLE || "Clinics",
      Key: { clinicId },
      ProjectionExpression: "timezone"
    }));
    const timezone = response.Item?.timezone || DEFAULT_TIMEZONE;
    timezoneCache.set(clinicId, { timezone, timestamp: Date.now() });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
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

// src/services/ai-agents/invoke-agent.ts
var dynamoClient = new import_client_dynamodb3.DynamoDBClient({});
var docClient2 = import_lib_dynamodb2.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgentRuntimeClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var SESSIONS_TABLE = process.env.SESSIONS_TABLE || "AiAgentSessions";
var CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "AiAgentConversations";
var getCorsHeaders = (event) => buildCorsHeaders({}, event.headers?.origin);
var agentCache = /* @__PURE__ */ new Map();
var AGENT_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getCachedAgent(agentId) {
  const cached = agentCache.get(agentId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }
  const response = await docClient2.send(
    new import_lib_dynamodb2.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } })
  );
  const agent = response.Item;
  if (agent) {
    agentCache.set(agentId, { agent, timestamp: Date.now() });
  }
  return agent || null;
}
async function logMessage(message) {
  const ttl = Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60;
  try {
    await docClient2.send(new import_lib_dynamodb2.PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        ...message,
        ttl
      }
    }));
  } catch (error) {
    console.error("[LogMessage] Failed to log conversation message:", error);
  }
}
var MAX_MESSAGES_PER_SESSION = 100;
var SESSION_TTL_SECONDS = 30 * 60;
var PUBLIC_RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 10,
  // Max requests per IP/visitor per minute
  WINDOW_MS: 60 * 1e3,
  // 1 minute window
  TTL_SECONDS: 300
  // 5 minute TTL for rate limit records
};
var RATE_LIMIT_TABLE = SESSIONS_TABLE;
async function checkPublicRateLimit(clinicId, visitorId, sourceIp) {
  const now = Date.now();
  const windowStart = Math.floor(now / PUBLIC_RATE_LIMIT.WINDOW_MS) * PUBLIC_RATE_LIMIT.WINDOW_MS;
  const ttl = Math.floor(now / 1e3) + PUBLIC_RATE_LIMIT.TTL_SECONDS;
  const rateLimitKey = `ratelimit:${clinicId}:${visitorId || sourceIp || "unknown"}`;
  try {
    const response = await docClient2.send(new import_lib_dynamodb2.GetCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: { sessionId: rateLimitKey }
    }));
    const record = response.Item;
    const storedWindowStart = record?.windowStart || 0;
    const isNewWindow = windowStart > storedWindowStart;
    const currentCount = isNewWindow ? 0 : record?.requestCount || 0;
    if (currentCount >= PUBLIC_RATE_LIMIT.MAX_REQUESTS_PER_MINUTE) {
      const timeLeft = Math.ceil((storedWindowStart + PUBLIC_RATE_LIMIT.WINDOW_MS - now) / 1e3);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Please wait ${Math.max(1, timeLeft)} seconds before making more requests.`
      };
    }
    await docClient2.send(new import_lib_dynamodb2.PutCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: {
        sessionId: rateLimitKey,
        windowStart: isNewWindow ? windowStart : storedWindowStart,
        requestCount: currentCount + 1,
        clinicId,
        visitorId,
        sourceIp,
        ttl,
        isRateLimitRecord: true
        // Flag to distinguish from session records
      }
    }));
    return { allowed: true };
  } catch (error) {
    console.error("[PublicRateLimit] Error checking rate limit:", error);
    return { allowed: true };
  }
}
async function getOrCreateSession(sessionId, agentId, aliasId, clinicId, userId) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ttl = Math.floor(Date.now() / 1e3) + SESSION_TTL_SECONDS;
  try {
    const existing = await docClient2.send(new import_lib_dynamodb2.GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId }
    }));
    if (existing.Item) {
      const session = existing.Item;
      if (session.userId !== userId) {
        console.warn(`[Session] User ${userId} attempted to use session owned by ${session.userId}`);
        return createNewSession(agentId, aliasId, clinicId, userId);
      }
      if (session.messageCount >= MAX_MESSAGES_PER_SESSION) {
        console.warn(`[Session] Session ${sessionId} exceeded max messages`);
        return { session, isNew: false, shouldEnd: true };
      }
      await docClient2.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: "SET messageCount = messageCount + :one, lastActivity = :now, #ttl = :ttl",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":now": now,
          ":ttl": ttl
        }
      }));
      session.messageCount++;
      session.lastActivity = now;
      return { session, isNew: false, shouldEnd: false };
    }
  } catch (error) {
    console.error("[Session] Error getting session:", error);
  }
  return createNewSession(agentId, aliasId, clinicId, userId);
}
async function createNewSession(agentId, aliasId, clinicId, userId) {
  const sessionId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ttl = Math.floor(Date.now() / 1e3) + SESSION_TTL_SECONDS;
  const session = {
    sessionId,
    agentId,
    aliasId,
    clinicId,
    userId,
    messageCount: 1,
    createdAt: now,
    lastActivity: now,
    ttl
  };
  try {
    await docClient2.send(new import_lib_dynamodb2.PutCommand({
      TableName: SESSIONS_TABLE,
      Item: session,
      ConditionExpression: "attribute_not_exists(sessionId)"
    }));
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return getOrCreateSession(sessionId, agentId, aliasId, clinicId, userId);
    }
    throw error;
  }
  return { session, isNew: true, shouldEnd: false };
}
async function endSession(sessionId) {
  try {
    await docClient2.send(new import_lib_dynamodb2.DeleteCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId }
    }));
  } catch (error) {
    console.error("[Session] Error ending session:", error);
  }
}
function isPublicRequest(event) {
  const path = event.path || event.resource || "";
  return path.includes("/public/");
}
var handler = async (event) => {
  const httpMethod = event.httpMethod;
  const isPublic = isPublicRequest(event);
  if (httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: "CORS preflight" })
    };
  }
  if (httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }
  let userPerms = null;
  let userName = "Website Visitor";
  let userId = "";
  if (!isPublic) {
    userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "Unauthorized" })
      };
    }
    userName = getUserDisplayName(userPerms);
    userId = userPerms.email || "";
  }
  const agentId = event.pathParameters?.agentId;
  const pathClinicId = event.pathParameters?.clinicId;
  if (!agentId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: "Agent ID is required" })
    };
  }
  const startTime = Date.now();
  try {
    const body = JSON.parse(event.body || "{}");
    const clinicId = pathClinicId || body.clinicId;
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "clinicId is required (in path or body)" })
      };
    }
    if (!body.message) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "message is required" })
      };
    }
    const agent = await getCachedAgent(agentId);
    if (!agent) {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "Agent not found" })
      };
    }
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      return {
        statusCode: 403,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "Agent does not belong to this clinic" })
      };
    }
    if (isPublic) {
      if (!agent.isWebsiteEnabled) {
        return {
          statusCode: 403,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: "Website chatbot is not enabled for this agent" })
        };
      }
      userName = body.visitorName || "Website Visitor";
      userId = body.visitorId || `visitor-${v4_default().slice(0, 8)}`;
      const sourceIp = event.requestContext?.identity?.sourceIp;
      const rateLimitCheck = await checkPublicRateLimit(clinicId, userId, sourceIp);
      if (!rateLimitCheck.allowed) {
        return {
          statusCode: 429,
          headers: getCorsHeaders(event),
          body: JSON.stringify({
            error: "Too many requests",
            message: rateLimitCheck.reason
          })
        };
      }
    } else {
      const userClinicIds = userPerms.clinicRoles.map((cr) => cr.clinicId);
      const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;
      if (!isAdmin && !userClinicIds.includes(clinicId)) {
        return {
          statusCode: 403,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: "You do not have access to this clinic" })
        };
      }
    }
    if (!agent.isActive) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "Agent is not active" })
      };
    }
    if (!agent.bedrockAgentId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: "No Bedrock Agent associated with this agent" })
      };
    }
    if (!agent.bedrockAgentAliasId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Agent is not prepared",
          status: agent.bedrockAgentStatus
        })
      };
    }
    if (agent.bedrockAgentStatus !== "PREPARED") {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: `Agent is not ready. Current status: ${agent.bedrockAgentStatus}`,
          status: agent.bedrockAgentStatus
        })
      };
    }
    const [sessionResult, clinicTimezone, clinicName] = await Promise.all([
      // SECURITY FIX: Get or create session with user binding
      // Sessions are now stored in DynamoDB and bound to specific users
      // to prevent session hijacking across Lambda instances
      getOrCreateSession(
        body.sessionId || v4_default(),
        agent.bedrockAgentId,
        agent.bedrockAgentAliasId,
        clinicId,
        userId || `anon-${v4_default().slice(0, 8)}`
      ),
      // Fetch clinic's timezone from the Clinics table
      getClinicTimezone(clinicId),
      // Fetch clinic display name for natural greetings
      getClinicName(clinicId)
    ]);
    const { session, isNew, shouldEnd } = sessionResult;
    const sessionId = session.sessionId;
    const shouldEndSession = body.endSession || shouldEnd;
    if (shouldEnd && !body.endSession) {
      console.log(`[InvokeAgent] Forcing session end for ${sessionId} due to message limit`);
    }
    const dateContext = getDateContext(clinicTimezone);
    const [year, month, day] = dateContext.today.split("-");
    const todayFormatted = `${month}/${day}/${year}`;
    const sessionAttributes = {
      clinicId,
      clinicName,
      userId,
      userName,
      isPublicRequest: isPublic ? "true" : "false",
      // Current date information for accurate scheduling (timezone-aware)
      todayDate: dateContext.today,
      todayFormatted,
      dayName: dateContext.dayName,
      tomorrowDate: dateContext.tomorrowDate,
      nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
      timezone: dateContext.timezone
    };
    const promptSessionAttributes = {
      clinicName,
      currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
      dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`
    };
    const userMessageTimestamp = Date.now();
    const visitorId = isPublic ? userId : void 0;
    logMessage({
      sessionId,
      timestamp: userMessageTimestamp,
      messageType: "user",
      content: body.message,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      userId: isPublic ? void 0 : userId,
      userName: isPublic ? void 0 : userName,
      visitorId,
      channel: "api",
      isPublicChat: isPublic
    });
    const invokeCommand = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId,
      inputText: body.message,
      enableTrace: body.enableTrace || false,
      endSession: shouldEndSession,
      sessionState: {
        sessionAttributes,
        promptSessionAttributes
      }
    });
    const bedrockResponse = await bedrockAgentRuntimeClient.send(invokeCommand);
    let responseText = "";
    const traceEvents = [];
    if (bedrockResponse.completion) {
      for await (const event2 of bedrockResponse.completion) {
        if (event2.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event2.chunk.bytes);
          responseText += chunk;
        }
        if (event2.trace && body.enableTrace) {
          traceEvents.push(event2.trace);
        }
      }
    }
    const latencyMs = Date.now() - startTime;
    logMessage({
      sessionId,
      timestamp: Date.now(),
      messageType: "assistant",
      content: responseText || "No response from agent",
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      userId: isPublic ? void 0 : userId,
      userName: isPublic ? void 0 : userName,
      visitorId,
      channel: "api",
      isPublicChat: isPublic,
      responseTimeMs: latencyMs,
      traceData: traceEvents.length > 0 ? JSON.stringify(traceEvents) : void 0
    });
    await docClient2.send(
      new import_lib_dynamodb2.UpdateCommand({
        TableName: AGENTS_TABLE,
        Key: { agentId },
        UpdateExpression: "SET usageCount = if_not_exists(usageCount, :zero) + :one",
        ExpressionAttributeValues: { ":zero": 0, ":one": 1 }
      })
    );
    if (shouldEndSession) {
      await endSession(sessionId);
    }
    const response = {
      response: responseText || "No response from agent",
      sessionId,
      agentId: agent.agentId,
      agentName: agent.name,
      clinicId,
      metrics: {
        latencyMs
      }
    };
    if (body.enableTrace && traceEvents.length > 0) {
      response.trace = traceEvents;
    }
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("Invoke agent error:", error);
    if (error.name === "ValidationException") {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Invalid request to Bedrock Agent",
          details: error.message
        })
      };
    }
    if (error.name === "ResourceNotFoundException") {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Bedrock Agent not found. It may have been deleted.",
          details: error.message
        })
      };
    }
    if (error.name === "ThrottlingException") {
      return {
        statusCode: 429,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Too many requests. Please try again later.",
          details: error.message
        })
      };
    }
    if (error.name === "AccessDeniedException") {
      return {
        statusCode: 403,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "Access denied to Bedrock Agent",
          details: error.message
        })
      };
    }
    if (error.name === "DependencyFailedException") {
      console.error("[InvokeAgent] DependencyFailedException - Action group Lambda may have failed");
      return {
        statusCode: 502,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: "The AI assistant encountered an issue while processing your request. Please try again.",
          details: "Action group execution failed. This may be a temporary issue.",
          errorType: error.name
        })
      };
    }
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: error.message || "Internal server error",
        errorType: error.name
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
