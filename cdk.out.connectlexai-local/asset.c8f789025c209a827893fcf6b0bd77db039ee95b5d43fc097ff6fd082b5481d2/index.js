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

// src/services/ai-agents/voice-ai-handler.ts
var voice_ai_handler_exports = {};
__export(voice_ai_handler_exports, {
  getGreeting: () => getGreeting,
  getVoiceAgent: () => getVoiceAgent,
  getVoiceSettings: () => getVoiceSettings,
  handler: () => handler,
  isClinicOpen: () => isClinicOpen,
  recordCallAnalytics: () => recordCallAnalytics,
  textToSpeech: () => textToSpeech
});
module.exports = __toCommonJS(voice_ai_handler_exports);
var import_client_dynamodb4 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var import_client_polly2 = require("@aws-sdk/client-polly");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");

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

// src/services/ai-agents/voice-ai-handler.ts
var import_client_ssm = require("@aws-sdk/client-ssm");

// src/services/ai-agents/voice-agent-config.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-e6d6091484b5474281291379879901b8",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b7576e8cf26a4fd49b8a221fea062922",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-add5c4f5f7cd489499c8910e3caf8aef",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b10bbd82fce94f11968b03a4eec09322",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-3e55e6a9e1a14964b8876b8e35411049",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-e7812a96ba4049e288f04b702cd988b9",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-f097049ff6b947b59e73406acd056faf",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-5206f38a54434048b08f43bfff0cf933",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-fbad55ead7554aaaaaffa3400fe73a84",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-c6693db736964c09b670e9ba84735f2b",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-d20c3c06affa4114a99d71b60eea87e4",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-476b26df530e42bcb55c157f20d5141e",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-391fd647103a49c5ad36c38422ea8009",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-a2fe2c95e0254b12a39e7fe1d4359223",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-a7079480e46c41308fdcf855a79a6555",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-9039b266b7024aed8a45f3747c511a34",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-5d5c8099c6624552a7d779037d702f4b",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-23cbc8f035e94d7c85a8177361999c75",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-0a580af9da914a03bb68a715a212848f",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-819f553d8d72424a85292eab0e0030ce",
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
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinaustintx.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd34e09bf3c648848318c031cfeb13b6",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-698ca15acec542ba849576b9440ca958",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b818b4b13ed846529fc08e5a27935ef7",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-3e30fb6357124b5cb03bfadfc72859ba",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-d6087aec7474416a81b800eec92bf33a",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b34686d575d34041a7dcd5fac6db3369",
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
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-e6bc4666724a4e20bdff15017b2c165e",
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

// src/services/ai-agents/voice-agent-config.ts
var dynamoClient = new import_client_dynamodb2.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || "VoiceAgentConfig";
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || "ClinicHours";
async function getFullVoiceConfig(clinicId) {
  const response = await docClient.send(new import_lib_dynamodb.GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId }
  }));
  return response.Item || null;
}
var DEFAULT_VOICE_SETTINGS = {
  voiceId: "Joanna",
  engine: "neural",
  speakingRate: "medium",
  pitch: "medium",
  volume: "medium"
};
var DEFAULT_FILLER_PHRASES = [
  "Let me check that for you.",
  "One moment please.",
  "I'm looking into that now.",
  "Let me find that information.",
  "Just a moment while I check.",
  "I'm checking our system now."
];
var DEFAULT_OUTBOUND_GREETINGS = {
  appointment_reminder: "Hi {patientName}, this is {clinicName} calling to remind you about your upcoming dental appointment. Would you like to confirm, reschedule, or do you have any questions?",
  follow_up: "Hi {patientName}, this is {clinicName} calling to follow up on your recent visit. How are you feeling? Do you have any questions or concerns?",
  payment_reminder: "Hi {patientName}, this is {clinicName}. We're calling about an outstanding balance on your account. Would you like to discuss payment options or have any questions?",
  reengagement: "Hi {patientName}, this is {clinicName}. We noticed it's been a while since your last visit and wanted to check in. Would you like to schedule a check-up or cleaning?",
  custom: "{customMessage}"
};
var DEFAULT_AFTER_HOURS_GREETING = "Thank you for calling {clinicName}. Our office is currently closed, but I'm ToothFairy, your AI dental assistant. I can help you schedule appointments, answer questions, or take a message. How can I help you today?";

// src/services/chime/utils/streaming-tts-manager.ts
var import_client_polly = require("@aws-sdk/client-polly");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_crypto3 = require("crypto");
var REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || "us-east-1";
var pollyClient = new import_client_polly.PollyClient({ region: REGION });
var s3Client = new import_client_s3.S3Client({ region: REGION });
var TTS_AUDIO_BUCKET = process.env.TTS_AUDIO_BUCKET || process.env.HOLD_MUSIC_BUCKET;
var ABBREVIATIONS = /* @__PURE__ */ new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "sr",
  "jr",
  "vs",
  "etc",
  "inc",
  "ltd",
  "am",
  "pm",
  "st",
  "rd",
  "ave",
  "blvd",
  "apt",
  "no",
  "tel",
  "fax"
]);
function splitIntoSentences(text) {
  const sentencePattern = /([^.!?]*[.!?])(?:\s+|$)/g;
  const sentences = [];
  let lastIndex = 0;
  let match;
  while ((match = sentencePattern.exec(text)) !== null) {
    const sentence = match[1].trim();
    const wordBeforePeriod = sentence.match(/(\w+)\.$/);
    if (wordBeforePeriod && ABBREVIATIONS.has(wordBeforePeriod[1].toLowerCase())) {
      continue;
    }
    sentences.push(sentence);
    lastIndex = match.index + match[0].length;
  }
  const remaining = text.slice(lastIndex).trim();
  const hasIncompleteLast = remaining.length > 0;
  if (hasIncompleteLast) {
  }
  return { sentences, hasIncompleteLast };
}
var MIN_SENTENCE_LENGTH = 3;
var ttsCache = /* @__PURE__ */ new Map();
var TTS_CACHE_TTL_MS = 12 * 60 * 60 * 1e3;
var TTS_CACHE_MAX_SIZE = 100;
function evictCacheIfNeeded() {
  if (ttsCache.size <= TTS_CACHE_MAX_SIZE)
    return;
  const entries = Array.from(ttsCache.entries()).sort((a, b) => {
    if (a[1].accessCount !== b[1].accessCount) {
      return a[1].accessCount - b[1].accessCount;
    }
    return a[1].timestamp - b[1].timestamp;
  });
  const toRemove = Math.ceil(TTS_CACHE_MAX_SIZE * 0.2);
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    ttsCache.delete(entries[i][0]);
  }
  console.log(`[StreamingTTS] Evicted ${toRemove} cache entries, new size: ${ttsCache.size}`);
}
function cleanExpiredCache() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of ttsCache.entries()) {
    if (now - entry.timestamp > TTS_CACHE_TTL_MS) {
      ttsCache.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[StreamingTTS] Cleaned ${removed} expired cache entries`);
  }
}
var VOICE_ENGINE_PREFERENCE = [import_client_polly.Engine.NEURAL, import_client_polly.Engine.STANDARD];
function createStreamingTTSManager(callId) {
  let buffer = "";
  let sequenceNumber = 0;
  let processedSentences = /* @__PURE__ */ new Set();
  return {
    async processText(text, onChunk, options = {}) {
      buffer += text;
      const { sentences } = splitIntoSentences(buffer);
      for (const sentence of sentences) {
        if (sentence.length >= MIN_SENTENCE_LENGTH && !processedSentences.has(sentence)) {
          processedSentences.add(sentence);
          const idx = buffer.indexOf(sentence);
          if (idx !== -1) {
            buffer = buffer.slice(idx + sentence.length).trimStart();
          }
          const s3Key = await generateTTSToS3(callId, sentence, sequenceNumber, options);
          if (s3Key) {
            await onChunk({
              text: sentence,
              audioS3Key: s3Key,
              isFinal: false,
              sequenceNumber: sequenceNumber++
            });
          }
        }
      }
    },
    async flush(onChunk, options = {}) {
      const remainingText = buffer.trim();
      if (remainingText.length >= MIN_SENTENCE_LENGTH && !processedSentences.has(remainingText)) {
        const s3Key = await generateTTSToS3(callId, remainingText, sequenceNumber, options);
        if (s3Key) {
          await onChunk({
            text: remainingText,
            audioS3Key: s3Key,
            isFinal: true,
            sequenceNumber: sequenceNumber++
          });
        }
      }
      buffer = "";
    },
    reset() {
      buffer = "";
      sequenceNumber = 0;
      processedSentences = /* @__PURE__ */ new Set();
    }
  };
}
async function generateTTSToS3(callId, text, sequenceNumber, options = {}) {
  if (!TTS_AUDIO_BUCKET) {
    console.error("[StreamingTTS] TTS_AUDIO_BUCKET not configured");
    return null;
  }
  if (Math.random() < 0.1) {
    cleanExpiredCache();
  }
  const cacheKey = `${options.voiceId || "Joanna"}-${options.useSSML ? "ssml-" : ""}${text}`;
  const cached = ttsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TTS_CACHE_TTL_MS) {
    cached.accessCount++;
    console.log("[StreamingTTS] Using cached TTS", { text: text.substring(0, 30), s3Key: cached.s3Key });
    return cached.s3Key;
  }
  const startTime = Date.now();
  try {
    const voiceId = options.voiceId || "Joanna";
    const engine = options.engine || "neural";
    let speechText = text;
    let textType = "text";
    if (options.useSSML) {
      const rate = options.speakingRate || "100%";
      speechText = `<speak><prosody rate="${rate}">${escapeSSML(text)}</prosody></speak>`;
      textType = "ssml";
    }
    const response = await pollyClient.send(new import_client_polly.SynthesizeSpeechCommand({
      Text: speechText,
      TextType: textType,
      OutputFormat: import_client_polly.OutputFormat.PCM,
      // FIX: Changed from MP3 to PCM
      VoiceId: voiceId,
      Engine: engine,
      // 8kHz for telephony (standard PSTN quality)
      SampleRate: options.sampleRate || "8000"
    }));
    if (!response.AudioStream) {
      console.error("[StreamingTTS] No audio stream returned from Polly");
      return null;
    }
    const chunks = [];
    const audioStream = response.AudioStream;
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const pcmData = Buffer.concat(chunks);
    const wavBuffer = createWavFromPcm(pcmData, 8e3, 1, 16);
    const s3Key = `tts/${callId}/${(0, import_crypto3.randomUUID)()}-${sequenceNumber}.wav`;
    await s3Client.send(new import_client_s3.PutObjectCommand({
      Bucket: TTS_AUDIO_BUCKET,
      Key: s3Key,
      Body: wavBuffer,
      ContentType: "audio/wav"
      // FIX: Changed from audio/mpeg to audio/wav
      // Note: S3 "Expires" header is metadata only, doesn't delete objects.
      // Deletion is handled by S3 lifecycle rules configured in CDK.
    }));
    const durationMs = Date.now() - startTime;
    console.log("[StreamingTTS] Generated TTS", {
      text: text.substring(0, 50),
      s3Key,
      durationMs,
      audioBytes: wavBuffer.length,
      format: "wav"
    });
    if (isCommonPhrase(text)) {
      evictCacheIfNeeded();
      ttsCache.set(cacheKey, { s3Key, timestamp: Date.now(), accessCount: 1 });
    }
    return s3Key;
  } catch (error) {
    console.error("[StreamingTTS] Error generating TTS:", {
      error: error.message,
      text: text.substring(0, 50)
    });
    return null;
  }
}
function createWavFromPcm(pcmData, sampleRate, numChannels, bitsPerSample) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}
function isCommonPhrase(text) {
  const lowerText = text.toLowerCase().trim();
  const exactPhrases = [
    "hello",
    "hi there",
    "thank you",
    "thanks",
    "goodbye",
    "bye",
    "please hold",
    "one moment",
    "one moment please",
    "how can i help you",
    "how may i help you",
    "is there anything else",
    "have a great day",
    "have a nice day"
  ];
  return exactPhrases.some(
    (phrase) => lowerText === phrase || lowerText.startsWith(phrase + ".") || lowerText.startsWith(phrase + "!")
  );
}
function escapeSSML(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// src/shared/prompts/ai-prompts.ts
var import_client_dynamodb3 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var docClient2 = null;
function getDocClient() {
  if (!docClient2) {
    docClient2 = import_lib_dynamodb2.DynamoDBDocumentClient.from(new import_client_dynamodb3.DynamoDBClient({}));
  }
  return docClient2;
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
    const response = await getDocClient().send(new import_lib_dynamodb2.GetCommand({
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
    const response = await getDocClient().send(new import_lib_dynamodb2.GetCommand({
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

// src/services/ai-agents/voice-ai-handler.ts
var CONFIG = {
  // Default voice settings (can be overridden per clinic)
  DEFAULT_VOICE_ID: import_client_polly2.VoiceId.Joanna,
  DEFAULT_VOICE_ENGINE: import_client_polly2.Engine.NEURAL,
  SAMPLE_RATE: "8000",
  // Telephony standard
  OUTPUT_FORMAT: import_client_polly2.OutputFormat.PCM,
  // Goodbye message
  GOODBYE_MESSAGE: "Thank you for calling. Have a great day!",
  // Error message
  ERROR_MESSAGE: "I apologize, but I'm having trouble processing your request. Please try calling back during office hours or leave a message.",
  // Analytics retention (90 days TTL)
  ANALYTICS_TTL_DAYS: 90,
  // FIX: Cache configuration to prevent memory leaks
  MAX_CACHE_SIZE: 100,
  // Maximum number of clinic configs to cache
  // FIX: Streaming timeout - reduced to allow fallback within Lambda timeout
  STREAMING_TIMEOUT_MS: 18e3,
  // 18 seconds (leaves 12s for fallback + cleanup)
  // FIX: Chunk retry configuration
  CHUNK_MAX_RETRIES: 2,
  CHUNK_RETRY_DELAY_MS: 100,
  // FIX: Analytics DLQ retry configuration
  ANALYTICS_MAX_RETRIES: 2,
  ANALYTICS_RETRY_DELAY_MS: 50
};
var dynamoClient2 = new import_client_dynamodb4.DynamoDBClient({});
var docClient3 = import_lib_dynamodb3.DynamoDBDocumentClient.from(dynamoClient2);
var bedrockAgentClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var pollyClient2 = new import_client_polly2.PollyClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeVoiceClient = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({
  region: CHIME_MEDIA_REGION
});
var ssmClient = new import_client_ssm.SSMClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE2 = process.env.AGENTS_TABLE || "AiAgents";
var VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE || "VoiceAiSessions";
var CLINIC_HOURS_TABLE2 = process.env.CLINIC_HOURS_TABLE || "ClinicHours";
var CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || "";
var CALL_ANALYTICS_ENABLED = process.env.CALL_ANALYTICS_ENABLED === "true";
var CALL_RECORDINGS_BUCKET = process.env.CALL_RECORDINGS_BUCKET || "";
var STREAMING_ENABLED = process.env.ENABLE_STREAMING_RESPONSES === "true";
var SMA_ID_MAP_PARAMETER = process.env.SMA_ID_MAP_PARAMETER || "";
var voiceConfigCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS2 = 5 * 60 * 1e3;
function evictCacheIfNeeded2() {
  if (voiceConfigCache.size <= CONFIG.MAX_CACHE_SIZE)
    return;
  const entriesToRemove = voiceConfigCache.size - CONFIG.MAX_CACHE_SIZE + 10;
  const entries = Array.from(voiceConfigCache.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess).slice(0, entriesToRemove);
  for (const [key] of entries) {
    voiceConfigCache.delete(key);
  }
  console.log(`[voiceConfigCache] Evicted ${entries.length} entries, cache size now: ${voiceConfigCache.size}`);
}
async function isClinicOpen(clinicId) {
  try {
    const response = await docClient3.send(new import_lib_dynamodb3.GetCommand({
      TableName: CLINIC_HOURS_TABLE2,
      Key: { clinicId }
    }));
    const clinicHours = response.Item;
    if (!clinicHours?.hours) {
      return false;
    }
    const now = /* @__PURE__ */ new Date();
    const timezone = clinicHours.timezone || "America/New_York";
    const options = {
      timeZone: timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    };
    const formatter = new Intl.DateTimeFormat("en-US", options);
    const parts = formatter.formatToParts(now);
    const dayOfWeek = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
    const currentTime = hour * 60 + minute;
    const todayHours = clinicHours.hours[dayOfWeek];
    if (!todayHours || todayHours.closed) {
      return false;
    }
    const [openHour, openMin] = todayHours.open.split(":").map(Number);
    const [closeHour, closeMin] = todayHours.close.split(":").map(Number);
    const openTime = openHour * 60 + openMin;
    const closeTime = closeHour * 60 + closeMin;
    return currentTime >= openTime && currentTime < closeTime;
  } catch (error) {
    console.error("Error checking clinic hours:", error);
    return false;
  }
}
async function getCachedVoiceConfig(clinicId) {
  const now = Date.now();
  const cached = voiceConfigCache.get(clinicId);
  if (cached && now - cached.timestamp < CACHE_TTL_MS2) {
    cached.lastAccess = now;
    return cached.config;
  }
  const config = await getFullVoiceConfig(clinicId);
  evictCacheIfNeeded2();
  voiceConfigCache.set(clinicId, { config, timestamp: now, lastAccess: now });
  return config;
}
async function getThinkingPhrase(clinicId) {
  const config = await getCachedVoiceConfig(clinicId);
  const phrases = config?.customFillerPhrases?.length ? config.customFillerPhrases : DEFAULT_FILLER_PHRASES;
  const index = Math.floor(Math.random() * phrases.length);
  return phrases[index];
}
async function getGreeting(clinicId, isOutbound, purpose, context) {
  const config = await getCachedVoiceConfig(clinicId);
  let greeting;
  if (isOutbound && purpose) {
    const customGreetings = config?.outboundGreetings;
    greeting = customGreetings?.[purpose] || DEFAULT_OUTBOUND_GREETINGS[purpose] || DEFAULT_OUTBOUND_GREETINGS["custom"];
  } else {
    greeting = config?.afterHoursGreeting || DEFAULT_AFTER_HOURS_GREETING;
  }
  if (context) {
    greeting = greeting.replace(/{patientName}/g, context.patientName || "there").replace(/{clinicName}/g, context.clinicName || "our dental office").replace(/{appointmentDate}/g, context.appointmentDate || "your scheduled date").replace(/{customMessage}/g, context.customMessage || "");
  }
  return greeting;
}
async function getVoiceSettings(clinicId) {
  const config = await getCachedVoiceConfig(clinicId);
  return config?.voiceSettings || DEFAULT_VOICE_SETTINGS;
}
async function textToSpeech(text, clinicId) {
  const voiceSettings = clinicId ? await getVoiceSettings(clinicId) : DEFAULT_VOICE_SETTINGS;
  const command = new import_client_polly2.SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: CONFIG.OUTPUT_FORMAT,
    VoiceId: voiceSettings.voiceId,
    Engine: voiceSettings.engine === "neural" ? import_client_polly2.Engine.NEURAL : import_client_polly2.Engine.STANDARD,
    SampleRate: CONFIG.SAMPLE_RATE
  });
  const response = await pollyClient2.send(command);
  if (response.AudioStream) {
    const chunks = [];
    for await (const chunk of response.AudioStream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("No audio stream returned from Polly");
}
async function recordCallAnalytics(params) {
  if (!CALL_ANALYTICS_ENABLED || !CALL_ANALYTICS_TABLE) {
    console.warn("[recordCallAnalytics] Call analytics disabled or table not configured");
    return;
  }
  const now = Date.now();
  const ttl = Math.floor(now / 1e3) + CONFIG.ANALYTICS_TTL_DAYS * 24 * 60 * 60;
  const overallSentiment = params.sentiment ? params.sentiment.toUpperCase() : void 0;
  const analytics = {
    // Primary Key (shared table schema)
    callId: params.callId,
    timestamp: now,
    // Core fields
    clinicId: params.clinicId,
    callStatus: params.outcome === "error" ? "error" : "completed",
    callCategory: params.callType === "outbound" ? "ai_outbound" : "ai_voice",
    // Call details
    callType: params.callType,
    purpose: params.purpose,
    duration: params.duration,
    outcome: params.outcome,
    // Agent info
    aiAgentId: params.aiAgentId,
    aiAgentName: params.aiAgentName,
    // Caller info
    callerNumber: params.callerNumber,
    patientName: params.patientName,
    // Analytics fields
    transcriptSummary: params.transcriptSummary,
    toolsUsed: params.toolsUsed,
    appointmentBooked: params.appointmentBooked,
    overallSentiment,
    // Source identifier
    analyticsSource: "voice_ai",
    // TTL
    ttl
  };
  let lastError = null;
  for (let attempt = 1; attempt <= CONFIG.ANALYTICS_MAX_RETRIES + 1; attempt++) {
    try {
      await docClient3.send(new import_lib_dynamodb3.PutCommand({
        TableName: CALL_ANALYTICS_TABLE,
        Item: analytics
      }));
      console.log("[recordCallAnalytics] Analytics recorded to shared table:", {
        callId: analytics.callId,
        clinicId: analytics.clinicId,
        callType: analytics.callType,
        callCategory: analytics.callCategory,
        outcome: analytics.outcome,
        analyticsSource: analytics.analyticsSource,
        attempt
      });
      return;
    } catch (error) {
      lastError = error;
      const isRetryable = error.name === "ProvisionedThroughputExceededException" || error.name === "ServiceUnavailable" || error.name === "InternalServerError" || error.message?.includes("ECONNRESET");
      if (isRetryable && attempt <= CONFIG.ANALYTICS_MAX_RETRIES) {
        console.warn(`[recordCallAnalytics] Transient error, retrying (attempt ${attempt}):`, error.message);
        await new Promise((resolve) => setTimeout(resolve, CONFIG.ANALYTICS_RETRY_DELAY_MS * attempt));
        continue;
      }
      break;
    }
  }
  console.error("[recordCallAnalytics] Failed to record analytics after retries:", {
    callId: params.callId,
    clinicId: params.clinicId,
    error: lastError?.message || "Unknown error",
    errorName: lastError?.name,
    // Include enough data to manually recover if needed
    analyticsPayload: JSON.stringify(analytics).substring(0, 1e3)
  });
}
async function getOrCreateSession(callId, clinicId, agentId, callerNumber) {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 75;
  const sessionId = `voice-${callId}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const directRead = await docClient3.send(new import_lib_dynamodb3.GetCommand({
        TableName: VOICE_SESSIONS_TABLE,
        Key: { sessionId },
        ConsistentRead: true
        // FIX: Use consistent read on main table
      }));
      if (directRead.Item) {
        console.log(`[getOrCreateSession] Found existing session via direct read for callId ${callId}`);
        return directRead.Item;
      }
    } catch (readError) {
      console.warn(`[getOrCreateSession] Direct read failed, falling back to GSI:`, readError);
    }
    const existingResponse = await docClient3.send(new import_lib_dynamodb3.QueryCommand({
      TableName: VOICE_SESSIONS_TABLE,
      IndexName: "CallIdIndex",
      KeyConditionExpression: "callId = :cid",
      ExpressionAttributeValues: { ":cid": callId }
    }));
    if (existingResponse.Items && existingResponse.Items.length > 0) {
      console.log(`[getOrCreateSession] Found existing session via GSI for callId ${callId}`);
      return existingResponse.Items[0];
    }
    const bedrockSessionId = v4_default();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const session = {
      sessionId,
      callId,
      clinicId,
      agentId,
      callerNumber,
      bedrockSessionId,
      startTime: now,
      lastActivityTime: now,
      status: "active",
      transcripts: [],
      toolsUsed: [],
      ttl: Math.floor(Date.now() / 1e3) + 24 * 60 * 60
      // 24 hour TTL
    };
    try {
      await docClient3.send(new import_lib_dynamodb3.PutCommand({
        TableName: VOICE_SESSIONS_TABLE,
        Item: session,
        ConditionExpression: "attribute_not_exists(sessionId)"
      }));
      console.log(`[getOrCreateSession] Created new session for callId ${callId}`, { sessionId, attempt });
      return session;
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        console.log(`[getOrCreateSession] Session already exists (created by parallel request), retrieving...`);
        const existingSession = await docClient3.send(new import_lib_dynamodb3.GetCommand({
          TableName: VOICE_SESSIONS_TABLE,
          Key: { sessionId },
          ConsistentRead: true
        }));
        if (existingSession.Item) {
          return existingSession.Item;
        }
        if (attempt < MAX_RETRIES) {
          const jitter = Math.random() * 50;
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw error;
    }
  }
  const finalCheck = await docClient3.send(new import_lib_dynamodb3.GetCommand({
    TableName: VOICE_SESSIONS_TABLE,
    Key: { sessionId },
    ConsistentRead: true
  }));
  if (finalCheck.Item) {
    console.log(`[getOrCreateSession] Found session in final check for callId ${callId}`);
    return finalCheck.Item;
  }
  throw new Error(`[getOrCreateSession] Failed to create or find session for callId ${callId} after ${MAX_RETRIES} attempts`);
}
async function updateSessionTranscript(sessionId, speaker, text, newToolsUsed) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const newTtl = Math.floor(Date.now() / 1e3) + 24 * 60 * 60;
  let updateExpression = "SET transcripts = list_append(if_not_exists(transcripts, :empty), :transcript), lastActivityTime = :now, #ttl = :newTtl";
  const expressionAttributeValues = {
    ":empty": [],
    ":transcript": [{ speaker, text, timestamp: now }],
    ":now": now,
    ":newTtl": newTtl
  };
  const expressionAttributeNames = { "#ttl": "ttl" };
  if (newToolsUsed && newToolsUsed.length > 0) {
    updateExpression += ", toolsUsed = list_append(if_not_exists(toolsUsed, :emptyTools), :newTools)";
    expressionAttributeValues[":emptyTools"] = [];
    expressionAttributeValues[":newTools"] = newToolsUsed;
  }
  await docClient3.send(new import_lib_dynamodb3.UpdateCommand({
    TableName: VOICE_SESSIONS_TABLE,
    Key: { sessionId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  }));
}
async function getVoiceAgent(clinicId) {
  const voiceConfig = await getFullVoiceConfig(clinicId);
  if (voiceConfig) {
    if (voiceConfig.aiInboundEnabled === false) {
      console.log(`[getVoiceAgent] AI inbound is explicitly DISABLED for clinic ${clinicId}`);
      return null;
    }
    if (voiceConfig.inboundAgentId) {
      const agentResponse = await docClient3.send(new import_lib_dynamodb3.GetCommand({
        TableName: AGENTS_TABLE2,
        Key: { agentId: voiceConfig.inboundAgentId }
      }));
      if (agentResponse.Item && agentResponse.Item.isActive && agentResponse.Item.bedrockAgentStatus === "PREPARED") {
        console.log(`[getVoiceAgent] Using CONFIGURED agent for clinic ${clinicId}:`, voiceConfig.inboundAgentId);
        return agentResponse.Item;
      }
      console.warn(`[getVoiceAgent] Configured agent ${voiceConfig.inboundAgentId} is not ready, trying fallbacks`);
    }
    if (voiceConfig.aiInboundEnabled === void 0 && !voiceConfig.inboundAgentId) {
      console.log(`[getVoiceAgent] Config exists but no agent set for clinic ${clinicId}, using voicemail`);
      return null;
    }
  }
  const defaultResponse = await docClient3.send(new import_lib_dynamodb3.QueryCommand({
    TableName: AGENTS_TABLE2,
    IndexName: "ClinicIndex",
    KeyConditionExpression: "clinicId = :cid",
    FilterExpression: "isActive = :active AND isVoiceEnabled = :voice AND isDefaultVoiceAgent = :default AND bedrockAgentStatus = :status",
    ExpressionAttributeValues: {
      ":cid": clinicId,
      ":active": true,
      ":voice": true,
      ":default": true,
      ":status": "PREPARED"
    }
  }));
  if (defaultResponse.Items && defaultResponse.Items.length > 0) {
    console.log(`[getVoiceAgent] Using DEFAULT voice agent for clinic ${clinicId}:`, defaultResponse.Items[0].agentId);
    return defaultResponse.Items[0];
  }
  const voiceResponse = await docClient3.send(new import_lib_dynamodb3.QueryCommand({
    TableName: AGENTS_TABLE2,
    IndexName: "ClinicIndex",
    KeyConditionExpression: "clinicId = :cid",
    FilterExpression: "isActive = :active AND isVoiceEnabled = :voice AND bedrockAgentStatus = :status",
    ExpressionAttributeValues: {
      ":cid": clinicId,
      ":active": true,
      ":voice": true,
      ":status": "PREPARED"
    },
    Limit: 1
  }));
  if (voiceResponse.Items && voiceResponse.Items.length > 0) {
    console.log(`[getVoiceAgent] Using voice-enabled agent for clinic ${clinicId}:`, voiceResponse.Items[0].agentId);
    return voiceResponse.Items[0];
  }
  if (!voiceConfig) {
    const fallbackResponse = await docClient3.send(new import_lib_dynamodb3.QueryCommand({
      TableName: AGENTS_TABLE2,
      IndexName: "ClinicIndex",
      KeyConditionExpression: "clinicId = :cid",
      FilterExpression: "isActive = :active AND bedrockAgentStatus = :status",
      ExpressionAttributeValues: {
        ":cid": clinicId,
        ":active": true,
        ":status": "PREPARED"
      },
      Limit: 1
    }));
    if (fallbackResponse.Items && fallbackResponse.Items.length > 0) {
      console.log(`[getVoiceAgent] Using fallback agent for clinic ${clinicId}:`, fallbackResponse.Items[0].agentId);
      return fallbackResponse.Items[0];
    }
  }
  console.warn(`[getVoiceAgent] No suitable agent found for clinic ${clinicId}`);
  return null;
}
var smaIdMapCache = null;
var smaIdMapCacheTime = 0;
var SMA_ID_MAP_CACHE_TTL = 5 * 60 * 1e3;
async function getSmaIdForClinic(clinicId) {
  if (!SMA_ID_MAP_PARAMETER) {
    console.warn("[getSmaIdForClinic] SMA_ID_MAP_PARAMETER not configured");
    return null;
  }
  try {
    const now = Date.now();
    if (smaIdMapCache && now - smaIdMapCacheTime < SMA_ID_MAP_CACHE_TTL) {
      return smaIdMapCache[clinicId] || smaIdMapCache["default"] || null;
    }
    const response = await ssmClient.send(new import_client_ssm.GetParameterCommand({
      Name: SMA_ID_MAP_PARAMETER
    }));
    if (response.Parameter?.Value) {
      smaIdMapCache = JSON.parse(response.Parameter.Value);
      smaIdMapCacheTime = now;
      return smaIdMapCache?.[clinicId] || smaIdMapCache?.["default"] || null;
    }
    return null;
  } catch (error) {
    console.error("[getSmaIdForClinic] Error fetching SMA ID:", error);
    return null;
  }
}
async function invokeAiAgentWithStreaming(agent, session, userMessage, callId, clinicId, cancellationSignal) {
  const thinking = [];
  let fullResponse = "";
  let chunksSent = 0;
  const ttsManager = createStreamingTTSManager(callId);
  let voiceSettings = DEFAULT_VOICE_SETTINGS;
  try {
    const voiceConfig = await getFullVoiceConfig(clinicId);
    if (voiceConfig?.voiceSettings) {
      voiceSettings = voiceConfig.voiceSettings;
    }
  } catch (err) {
    console.warn("[invokeAiAgentWithStreaming] Failed to get voice config, using defaults");
  }
  const ttsOptions = {
    voiceId: voiceSettings.voiceId || "Joanna",
    engine: voiceSettings.engine || "neural"
  };
  const [clinicTimezone, clinicName] = await Promise.all([
    getClinicTimezone(session.clinicId),
    getClinicName(session.clinicId)
  ]);
  const dateContext = getDateContext(clinicTimezone);
  const [year, month, day] = dateContext.today.split("-");
  const todayFormatted = `${month}/${day}/${year}`;
  const sessionAttributes = {
    clinicId: session.clinicId,
    clinicName,
    callerNumber: session.callerNumber,
    isVoiceCall: "true",
    inputMode: "Speech",
    // Current date information for accurate scheduling (timezone-aware)
    todayDate: dateContext.today,
    todayFormatted,
    dayName: dateContext.dayName,
    tomorrowDate: dateContext.tomorrowDate,
    currentTime: dateContext.currentTime,
    nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
    timezone: dateContext.timezone
  };
  const promptSessionAttributes = {
    clinicName,
    currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
    dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`
  };
  const invokeCommand = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
    agentId: agent.bedrockAgentId,
    agentAliasId: agent.bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: userMessage,
    enableTrace: true,
    sessionState: {
      sessionAttributes,
      promptSessionAttributes
    }
  });
  const bedrockResponse = await bedrockAgentClient.send(invokeCommand);
  if (bedrockResponse.completion) {
    for await (const event of bedrockResponse.completion) {
      if (cancellationSignal?.cancelled) {
        console.log("[invokeAiAgentWithStreaming] Cancellation requested, stopping stream processing");
        ttsManager.reset();
        break;
      }
      if (event.trace?.trace) {
        const trace = event.trace.trace;
        if (trace.orchestrationTrace?.rationale?.text) {
          thinking.push(trace.orchestrationTrace.rationale.text);
        }
        if (trace.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const action = trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          thinking.push(`Checking: ${action.apiPath}`);
        }
      }
      if (event.chunk?.bytes) {
        const chunkText = new TextDecoder().decode(event.chunk.bytes);
        fullResponse += chunkText;
        if (cancellationSignal?.cancelled) {
          console.log("[invokeAiAgentWithStreaming] Skipping TTS processing due to cancellation");
          continue;
        }
        await ttsManager.processText(
          chunkText,
          async (ttsChunk) => {
            if (cancellationSignal?.cancelled)
              return;
            const sent = await sendStreamingChunkWithTTS(
              callId,
              clinicId,
              ttsChunk,
              session.sessionId
            );
            if (sent)
              chunksSent++;
          },
          ttsOptions
        );
      }
    }
  }
  if (cancellationSignal?.cancelled) {
    console.log("[invokeAiAgentWithStreaming] Skipping flush due to cancellation");
    return { response: fullResponse, thinking, chunksSent };
  }
  await ttsManager.flush(
    async (ttsChunk) => {
      const sent = await sendStreamingChunkWithTTS(
        callId,
        clinicId,
        { ...ttsChunk, isFinal: true },
        session.sessionId
      );
      if (sent)
        chunksSent++;
    },
    ttsOptions
  );
  return {
    response: fullResponse || "I'm sorry, I couldn't process that request.",
    thinking,
    chunksSent
  };
}
async function sendStreamingChunkWithTTS(callId, clinicId, ttsChunk, sessionId) {
  const smaId = await getSmaIdForClinic(clinicId);
  if (!smaId) {
    console.warn("[sendStreamingChunkWithTTS] No SMA ID found for clinic:", clinicId);
    return false;
  }
  const actions = [
    {
      Type: "PlayAudio",
      Parameters: {
        AudioSource: {
          Type: "S3",
          BucketName: process.env.TTS_AUDIO_BUCKET || process.env.HOLD_MUSIC_BUCKET,
          Key: ttsChunk.audioS3Key
        }
      }
    }
  ];
  if (ttsChunk.isFinal) {
    actions.push({
      Type: "Pause",
      Parameters: {
        DurationInMilliseconds: "500"
      }
    });
  }
  let lastError = null;
  for (let attempt = 1; attempt <= CONFIG.CHUNK_MAX_RETRIES + 1; attempt++) {
    try {
      await chimeVoiceClient.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: callId,
        Arguments: {
          pendingAiActions: JSON.stringify(actions),
          aiResponseTime: (/* @__PURE__ */ new Date()).toISOString(),
          isStreamingChunk: "true",
          isFinalChunk: ttsChunk.isFinal ? "true" : "false",
          sessionId: sessionId || "",
          ttsSequence: String(ttsChunk.sequenceNumber)
        }
      }));
      console.log("[sendStreamingChunkWithTTS] Sent TTS chunk:", {
        callId,
        textLength: ttsChunk.text.length,
        isFinal: ttsChunk.isFinal,
        sequence: ttsChunk.sequenceNumber,
        attempt
      });
      return true;
    } catch (error) {
      lastError = error;
      const isRetryable = error.name === "ThrottlingException" || error.name === "ServiceUnavailableException" || error.message?.includes("ECONNRESET") || error.message?.includes("socket hang up");
      const isCallEnded = error.name === "NotFoundException" || error.message?.includes("Call not found") || error.message?.includes("Transaction");
      if (isCallEnded) {
        console.warn("[sendStreamingChunkWithTTS] Call is no longer active, skipping chunk");
        return false;
      }
      if (isRetryable && attempt <= CONFIG.CHUNK_MAX_RETRIES) {
        console.warn(`[sendStreamingChunkWithTTS] Transient error, retrying (attempt ${attempt}):`, error.message);
        await new Promise((resolve) => setTimeout(resolve, CONFIG.CHUNK_RETRY_DELAY_MS * attempt));
        continue;
      }
      console.error("[sendStreamingChunkWithTTS] Failed to send chunk:", {
        error: lastError?.message,
        callId,
        attempt
      });
      return false;
    }
  }
  return false;
}
async function invokeAiAgent(agent, session, userMessage) {
  const thinking = [];
  let fullResponse = "";
  const [clinicTimezone, clinicName] = await Promise.all([
    getClinicTimezone(session.clinicId),
    getClinicName(session.clinicId)
  ]);
  const dateContext = getDateContext(clinicTimezone);
  const [year, month, day] = dateContext.today.split("-");
  const todayFormatted = `${month}/${day}/${year}`;
  const sessionAttributes = {
    clinicId: session.clinicId,
    clinicName,
    callerNumber: session.callerNumber,
    isVoiceCall: "true",
    inputMode: "Speech",
    // Current date information for accurate scheduling (timezone-aware)
    todayDate: dateContext.today,
    todayFormatted,
    dayName: dateContext.dayName,
    tomorrowDate: dateContext.tomorrowDate,
    currentTime: dateContext.currentTime,
    nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
    timezone: dateContext.timezone
  };
  const promptSessionAttributes = {
    clinicName,
    currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
    dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`
  };
  const invokeCommand = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
    agentId: agent.bedrockAgentId,
    agentAliasId: agent.bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: userMessage,
    enableTrace: true,
    sessionState: {
      sessionAttributes,
      promptSessionAttributes
    }
  });
  const bedrockResponse = await bedrockAgentClient.send(invokeCommand);
  if (bedrockResponse.completion) {
    for await (const event of bedrockResponse.completion) {
      if (event.trace?.trace) {
        const trace = event.trace.trace;
        if (trace.orchestrationTrace?.rationale?.text) {
          thinking.push(trace.orchestrationTrace.rationale.text);
        }
        if (trace.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const action = trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          thinking.push(`Checking: ${action.apiPath}`);
        }
      }
      if (event.chunk?.bytes) {
        fullResponse += new TextDecoder().decode(event.chunk.bytes);
      }
    }
  }
  return { response: fullResponse || "I'm sorry, I couldn't process that request.", thinking };
}
var handler = async (event) => {
  console.log("Voice AI Event:", JSON.stringify(event, null, 2));
  const responses = [];
  const callStartTime = Date.now();
  try {
    switch (event.eventType) {
      case "NEW_CALL": {
        const {
          callId,
          clinicId,
          callerNumber,
          isOutbound,
          purpose,
          patientName,
          customMessage,
          clinicName,
          appointmentDate,
          aiAgentId,
          isAiPhoneNumber
        } = event;
        if (!isOutbound && !isAiPhoneNumber) {
          const isOpen = await isClinicOpen(clinicId);
          if (isOpen) {
            return [{
              action: "TRANSFER",
              transferNumber: "QUEUE"
              // Transfer to agent queue
            }];
          }
        }
        if (isAiPhoneNumber) {
          console.log(`[NEW_CALL] AI Phone Number call - bypassing hours check`, {
            callId,
            clinicId,
            callerNumber
          });
        }
        let agent = null;
        if (aiAgentId) {
          const agentResponse = await docClient3.send(new import_lib_dynamodb3.GetCommand({
            TableName: AGENTS_TABLE2,
            Key: { agentId: aiAgentId }
          }));
          if (agentResponse.Item?.isActive && agentResponse.Item?.bedrockAgentStatus === "PREPARED") {
            agent = agentResponse.Item;
          }
        }
        if (!agent) {
          agent = await getVoiceAgent(clinicId);
        }
        if (!agent) {
          await recordCallAnalytics({
            callId,
            clinicId,
            callType: isOutbound ? "outbound" : "inbound",
            purpose,
            duration: 0,
            outcome: "error",
            aiAgentId: "",
            callerNumber,
            patientName
          });
          return [{
            action: "SPEAK",
            text: "I'm sorry, our AI assistant is not available right now. Please call back during office hours."
          }, {
            action: "HANG_UP"
          }];
        }
        const session = await getOrCreateSession(callId, clinicId, agent.agentId, callerNumber || "unknown");
        const greeting = await getGreeting(
          clinicId,
          isOutbound || false,
          purpose,
          { patientName, clinicName, appointmentDate, customMessage }
        );
        responses.push({
          action: "SPEAK",
          text: greeting,
          sessionId: session.sessionId
        });
        responses.push({
          action: "CONTINUE",
          sessionId: session.sessionId
        });
        console.log("[NEW_CALL] Session created:", {
          sessionId: session.sessionId,
          callId,
          clinicId,
          isOutbound,
          purpose,
          agentId: agent.agentId
        });
        break;
      }
      case "TRANSCRIPT": {
        const { callId, clinicId, transcript, sessionId, aiAgentId } = event;
        if (!transcript) {
          console.warn("[TRANSCRIPT] Empty transcript received, skipping");
          return [{ action: "CONTINUE", sessionId }];
        }
        let session;
        if (sessionId) {
          const sessionResponse = await docClient3.send(new import_lib_dynamodb3.GetCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId }
          }));
          session = sessionResponse.Item;
        }
        if (!session && callId) {
          const callIdQuery = await docClient3.send(new import_lib_dynamodb3.QueryCommand({
            TableName: VOICE_SESSIONS_TABLE,
            IndexName: "CallIdIndex",
            KeyConditionExpression: "callId = :cid",
            ExpressionAttributeValues: { ":cid": callId },
            Limit: 1
          }));
          session = callIdQuery.Items?.[0];
        }
        if (!session && callId && clinicId) {
          console.log("[TRANSCRIPT] No existing session found, creating new session for real-time transcript");
          let agentId = aiAgentId;
          if (!agentId) {
            const voiceAgent = await getVoiceAgent(clinicId);
            agentId = voiceAgent?.agentId;
          }
          if (agentId) {
            session = await getOrCreateSession(callId, clinicId, agentId, "real-time-transcript");
          }
        }
        if (!session) {
          return [{
            action: "SPEAK",
            text: CONFIG.ERROR_MESSAGE
          }, {
            action: "HANG_UP"
          }];
        }
        const activeSessionId = session.sessionId;
        await updateSessionTranscript(activeSessionId, "caller", transcript);
        const agentResponse = await docClient3.send(new import_lib_dynamodb3.GetCommand({
          TableName: AGENTS_TABLE2,
          Key: { agentId: session.agentId }
        }));
        let agent = agentResponse.Item;
        if (!agent || !agent.isActive || agent.bedrockAgentStatus !== "PREPARED") {
          console.warn(`[TRANSCRIPT] Original agent ${session.agentId} not found or not ready, attempting fallback`);
          const fallbackAgent = await getVoiceAgent(session.clinicId);
          if (fallbackAgent) {
            console.log(`[TRANSCRIPT] Using fallback agent ${fallbackAgent.agentId} for call`);
            agent = fallbackAgent;
            const newBedrockSessionId = v4_default();
            await docClient3.send(new import_lib_dynamodb3.UpdateCommand({
              TableName: VOICE_SESSIONS_TABLE,
              Key: { sessionId: activeSessionId },
              UpdateExpression: "SET agentId = :newAgentId, bedrockSessionId = :newBedrockSessionId, agentFallbackUsed = :true, originalAgentId = :originalAgentId, previousBedrockSessionId = :prevSessionId",
              ExpressionAttributeValues: {
                ":newAgentId": agent.agentId,
                ":newBedrockSessionId": newBedrockSessionId,
                ":true": true,
                ":originalAgentId": session.agentId,
                ":prevSessionId": session.bedrockSessionId
              }
            }));
            session.bedrockSessionId = newBedrockSessionId;
            session.agentId = agent.agentId;
          } else {
            console.error(`[TRANSCRIPT] No fallback agent available for clinic ${session.clinicId}`);
            const apologyMessage = "I apologize, but I'm experiencing technical difficulties. Please call back in a few minutes, or I can have someone from our office call you back. Would you like us to call you back?";
            await updateSessionTranscript(activeSessionId, "ai", apologyMessage);
            return [{
              action: "SPEAK",
              text: apologyMessage,
              sessionId: activeSessionId
            }, {
              action: "CONTINUE",
              // Keep listening for response instead of hanging up immediately
              sessionId: activeSessionId
            }];
          }
        }
        const lowerTranscript = transcript.toLowerCase().trim();
        const wordCount = lowerTranscript.split(/\s+/).length;
        const isShortUtterance = wordCount <= 8;
        const definitiveGoodbyePatterns = [
          /^(bye|goodbye|good\s*bye|bye\s*bye|bye\s*now)\.?$/i,
          // Just "bye" variations alone
          /^(ok\s*)?(thanks?|thank\s*you)[\s,]*(bye|goodbye)?\.?$/i,
          // "thanks bye" or just "thanks"
          /\bthat'?s\s+all\s+(i\s+need(ed)?|for\s+(now|today))\b/i,
          // "that's all I needed"
          /\b(have\s+a\s+(good|great|nice)\s+(day|one|evening|night))\s*(bye)?\.?$/i,
          /\bi'?m\s+(all\s+)?done[\s,.]*(thanks?|thank\s*you)?\.?$/i,
          /\bnothing\s+(else|more)[\s,.]*(thanks?|bye)?\.?$/i
        ];
        const hasQuestionIndicator = /\?|\bcan\s+you\b|\bwhat\b|\bhow\b|\bwhen\b|\bwhere\b|\bwhy\b|\bwill\b|\bcould\b|\bwould\b/i.test(lowerTranscript);
        const hasEngagementIndicator = /\bactually\b|\balso\b|\band\b.*\?|\bbut\b|\bone\s+more\b|\banother\b/i.test(lowerTranscript);
        const isGoodbye = isShortUtterance && !hasQuestionIndicator && !hasEngagementIndicator && definitiveGoodbyePatterns.some((pattern) => pattern.test(lowerTranscript));
        if (isGoodbye) {
          console.log("[TRANSCRIPT] Goodbye phrase detected:", { transcript: lowerTranscript });
          await updateSessionTranscript(activeSessionId, "ai", CONFIG.GOODBYE_MESSAGE);
          return [{
            action: "SPEAK",
            text: CONFIG.GOODBYE_MESSAGE,
            sessionId: activeSessionId
          }, {
            action: "HANG_UP"
          }];
        }
        if (STREAMING_ENABLED && callId && clinicId) {
          console.log("[TRANSCRIPT] Using streaming response mode");
          const fillerPhrase = await getThinkingPhrase(clinicId);
          responses.push({
            action: "SPEAK",
            text: fillerPhrase,
            sessionId: activeSessionId
          });
          const streamingStartTime = (/* @__PURE__ */ new Date()).toISOString();
          await docClient3.send(new import_lib_dynamodb3.UpdateCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId: activeSessionId },
            UpdateExpression: "SET streamingInProgress = :streaming, lastTranscript = :transcript, streamingStartTime = :now",
            ExpressionAttributeValues: {
              ":streaming": true,
              ":transcript": transcript,
              ":now": streamingStartTime
            }
          }));
          try {
            const cancellationSignal = { cancelled: false };
            const streamingPromise = invokeAiAgentWithStreaming(
              agent,
              session,
              transcript,
              callId,
              clinicId,
              cancellationSignal
            );
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                cancellationSignal.cancelled = true;
                console.log("[TRANSCRIPT] Streaming timeout - cancellation signal set");
                reject(new Error("Streaming timeout"));
              }, CONFIG.STREAMING_TIMEOUT_MS);
            });
            const { response: aiResponse, thinking, chunksSent } = await Promise.race([
              streamingPromise,
              timeoutPromise
            ]);
            console.log("[TRANSCRIPT] Streaming complete:", {
              chunksSent,
              responseLength: aiResponse.length
            });
            const detectedTools = thinking.filter((t) => t.includes("Checking:")).map((t) => t.replace("Checking: ", ""));
            await updateSessionTranscript(activeSessionId, "ai", aiResponse, detectedTools);
            await docClient3.send(new import_lib_dynamodb3.UpdateCommand({
              TableName: VOICE_SESSIONS_TABLE,
              Key: { sessionId: activeSessionId },
              UpdateExpression: "SET streamingInProgress = :streaming, lastAiResponse = :response, streamingCompletedAt = :now",
              ExpressionAttributeValues: {
                ":streaming": false,
                ":response": aiResponse,
                ":now": (/* @__PURE__ */ new Date()).toISOString()
              }
            }));
            if (chunksSent === 0 && aiResponse) {
              responses.push({
                action: "SPEAK",
                text: aiResponse,
                sessionId: activeSessionId
              });
            }
          } catch (err) {
            console.error("[TRANSCRIPT] Streaming error or timeout:", err.message);
            await docClient3.send(new import_lib_dynamodb3.UpdateCommand({
              TableName: VOICE_SESSIONS_TABLE,
              Key: { sessionId: activeSessionId },
              UpdateExpression: "SET streamingInProgress = :streaming, streamingError = :error",
              ExpressionAttributeValues: {
                ":streaming": false,
                ":error": err.message || "Unknown streaming error"
              }
            }));
            console.log("[TRANSCRIPT] Falling back to non-streaming response");
            const { response: aiResponse, thinking } = await invokeAiAgent(agent, session, transcript);
            const detectedTools = thinking.filter((t) => t.includes("Checking:")).map((t) => t.replace("Checking: ", ""));
            await updateSessionTranscript(activeSessionId, "ai", aiResponse, detectedTools);
            responses.push({
              action: "SPEAK",
              text: aiResponse,
              sessionId: activeSessionId
            });
          }
          responses.push({
            action: "CONTINUE",
            sessionId: activeSessionId
          });
        } else {
          console.log("[TRANSCRIPT] Using non-streaming response mode");
          const fillerPhrase = await getThinkingPhrase(clinicId);
          responses.push({
            action: "SPEAK",
            text: fillerPhrase,
            sessionId: activeSessionId
          });
          const { response: aiResponse, thinking } = await invokeAiAgent(agent, session, transcript);
          const detectedTools = thinking.filter((t) => t.includes("Checking:")).map((t) => t.replace("Checking: ", ""));
          await updateSessionTranscript(activeSessionId, "ai", aiResponse, detectedTools);
          responses.push({
            action: "SPEAK",
            text: aiResponse,
            sessionId: activeSessionId
          });
          responses.push({
            action: "CONTINUE",
            sessionId: activeSessionId
          });
        }
        break;
      }
      case "DTMF": {
        const { sessionId, dtmfDigits } = event;
        if (dtmfDigits === "0") {
          return [{
            action: "SPEAK",
            text: "I'll connect you to our voicemail. Please leave a message after the tone.",
            sessionId
          }, {
            action: "TRANSFER",
            transferNumber: "VOICEMAIL"
          }];
        }
        responses.push({
          action: "CONTINUE",
          sessionId
        });
        break;
      }
      case "CALL_ENDED": {
        const { sessionId, callId, clinicId, isOutbound, purpose, patientName, callerNumber } = event;
        if (sessionId) {
          const sessionResponse = await docClient3.send(new import_lib_dynamodb3.GetCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId }
          }));
          const session = sessionResponse.Item;
          await docClient3.send(new import_lib_dynamodb3.UpdateCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: "SET #status = :ended, lastActivityTime = :now",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":ended": "ended",
              ":now": (/* @__PURE__ */ new Date()).toISOString()
            }
          }));
          if (session) {
            const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1e3);
            const transcriptSummary = session.transcripts?.slice(-5).map((t) => `${t.speaker}: ${t.text}`).join(" | ");
            const aiResponses = session.transcripts?.filter((t) => t.speaker === "ai").map((t) => t.text.toLowerCase()).join(" ") || "";
            const appointmentBooked = aiResponses.includes("scheduled") || aiResponses.includes("booked") || aiResponses.includes("appointment confirmed");
            const persistedToolsUsed = session.toolsUsed || [];
            await recordCallAnalytics({
              callId: session.callId,
              clinicId: session.clinicId,
              callType: isOutbound ? "outbound" : "inbound",
              purpose,
              duration,
              outcome: "completed",
              aiAgentId: session.agentId,
              callerNumber: session.callerNumber,
              patientName,
              transcriptSummary,
              toolsUsed: [...new Set(persistedToolsUsed)],
              // Deduplicate
              appointmentBooked
            });
          }
        }
        break;
      }
      default:
        console.warn("Unknown event type:", event.eventType);
    }
    return responses;
  } catch (error) {
    console.error("Voice AI error:", error);
    try {
      await recordCallAnalytics({
        callId: event.callId,
        clinicId: event.clinicId,
        callType: event.isOutbound ? "outbound" : "inbound",
        purpose: event.purpose,
        duration: Math.floor((Date.now() - callStartTime) / 1e3),
        outcome: "error",
        aiAgentId: "",
        callerNumber: event.callerNumber,
        patientName: event.patientName
      });
    } catch {
    }
    return [{
      action: "SPEAK",
      text: CONFIG.ERROR_MESSAGE
    }, {
      action: "HANG_UP"
    }];
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getGreeting,
  getVoiceAgent,
  getVoiceSettings,
  handler,
  isClinicOpen,
  recordCallAnalytics,
  textToSpeech
});
