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

// src/services/shared/utils/unique-id.ts
var unique_id_exports = {};
__export(unique_id_exports, {
  extractTimestampFromPosition: () => extractTimestampFromPosition,
  generateUniqueCallPosition: () => generateUniqueCallPosition,
  generateUniquePositionString: () => generateUniquePositionString,
  generateUniqueQueuePosition: () => generateUniqueQueuePosition,
  isValidQueuePosition: () => isValidQueuePosition
});
function generateNanoid(size = 10) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = (0, import_crypto2.randomBytes)(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}
function generateUniqueQueuePosition() {
  const timestamp = Date.now();
  const randomComponent = Math.floor(Math.random() * 1e3);
  return timestamp * 1e3 + randomComponent;
}
function generateUniquePositionString() {
  const timestamp = Date.now();
  const nanoid = generateNanoid(8);
  return `${timestamp}-${nanoid}`;
}
function generateUniqueCallPosition() {
  const timestamp = Date.now();
  const nanoid = generateNanoid(12);
  return {
    queuePosition: timestamp,
    uniquePositionId: nanoid
  };
}
function extractTimestampFromPosition(position) {
  if (position > Date.now() * 100) {
    return Math.floor(position / 1e3);
  }
  return position;
}
function isValidQueuePosition(position) {
  if (typeof position !== "number" || !isFinite(position)) {
    return false;
  }
  const minTimestamp = (/* @__PURE__ */ new Date("2020-01-01")).getTime();
  const maxTimestamp = Date.now() * 1e3 + 1e3;
  const extractedTimestamp = extractTimestampFromPosition(position);
  return extractedTimestamp >= minTimestamp && extractedTimestamp <= maxTimestamp;
}
var import_crypto2;
var init_unique_id = __esm({
  "src/services/shared/utils/unique-id.ts"() {
    "use strict";
    import_crypto2 = require("crypto");
  }
});

// src/services/chime/add-call.ts
var add_call_exports = {};
__export(add_call_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(add_call_exports);
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_crypto3 = require("crypto");

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

// src/services/shared/utils/dynamodb-manager.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_https = require("https");
var DynamoDBManager = class _DynamoDBManager {
  constructor(config = {}) {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
    this.warmed = false;
    const httpsAgent = new import_https.Agent({
      maxSockets: config.maxSockets || 50,
      keepAlive: true,
      keepAliveMsecs: 1e3,
      maxFreeSockets: 10,
      // Keep some connections ready
      timeout: 6e4,
      scheduling: "lifo"
      // Reuse recent connections first
    });
    const clientConfig = {
      maxAttempts: config.maxRetries || 3,
      requestHandler: {
        requestTimeout: config.requestTimeout || 3e3,
        connectionTimeout: config.connectionTimeout || 1e3,
        httpsAgent
      }
    };
    this.client = new import_client_dynamodb2.DynamoDBClient(clientConfig);
    this.documentClient = import_lib_dynamodb.DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      },
      unmarshallOptions: {
        wrapNumbers: false
      }
    });
    console.log("[DynamoDBManager] Initialized with optimized connection pooling");
    this.warmConnections();
  }
  /**
   * Warm DynamoDB connections on Lambda cold start
   * Makes a lightweight query to establish connection pool
   */
  async warmConnections() {
    if (this.warmed)
      return;
    try {
      await this.documentClient.send(new import_lib_dynamodb.GetCommand({
        TableName: process.env.AGENT_PRESENCE_TABLE_NAME || "warmup-dummy",
        Key: { agentId: "__warmup__" }
      })).catch(() => {
      });
      this.warmed = true;
      console.log("[DynamoDBManager] Connections warmed successfully");
    } catch (err) {
      console.warn("[DynamoDBManager] Connection warming failed (non-fatal):", err);
    }
  }
  static getInstance(config) {
    if (!_DynamoDBManager.instance) {
      _DynamoDBManager.instance = new _DynamoDBManager(config);
    }
    return _DynamoDBManager.instance;
  }
  getDocumentClient() {
    this.requestCount++;
    if (this.requestCount % 1e3 === 0) {
      const elapsed = Date.now() - this.lastResetTime;
      const rps = 1e3 / elapsed * 1e3;
      console.log(`[DynamoDBManager] Metrics: ${this.requestCount} requests, ~${rps.toFixed(2)} req/sec`);
    }
    return this.documentClient;
  }
  getMetrics() {
    const elapsed = Date.now() - this.lastResetTime;
    return {
      requestCount: this.requestCount,
      elapsedMs: elapsed,
      requestsPerSecond: this.requestCount / elapsed * 1e3
    };
  }
  resetMetrics() {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
  }
};
function getDynamoDBClient(config) {
  return DynamoDBManager.getInstance(config).getDocumentClient();
}

// node_modules/jose/dist/node/esm/runtime/base64url.js
var import_node_buffer = require("node:buffer");

// node_modules/jose/dist/node/esm/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}

// node_modules/jose/dist/node/esm/runtime/base64url.js
function normalize(input) {
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  return encoded;
}
var decode = (input) => new Uint8Array(import_node_buffer.Buffer.from(normalize(input), "base64url"));

// node_modules/jose/dist/node/esm/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// node_modules/jose/dist/node/esm/runtime/is_key_object.js
var util = __toESM(require("node:util"), 1);
var is_key_object_default = (obj) => util.types.isKeyObject(obj);

// node_modules/jose/dist/node/esm/runtime/webcrypto.js
var crypto = __toESM(require("node:crypto"), 1);
var util2 = __toESM(require("node:util"), 1);
var webcrypto2 = crypto.webcrypto;
var webcrypto_default = webcrypto2;
var isCryptoKey = (key) => util2.types.isCryptoKey(key);

// node_modules/jose/dist/node/esm/lib/crypto_key.js
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
function checkUsage(key, usages) {
  if (usages.length && !usages.some((expected) => key.usages.includes(expected))) {
    let msg = "CryptoKey does not support this operation, its usages must include ";
    if (usages.length > 2) {
      const last = usages.pop();
      msg += `one of ${usages.join(", ")}, or ${last}.`;
    } else if (usages.length === 2) {
      msg += `one of ${usages[0]} or ${usages[1]}.`;
    } else {
      msg += `${usages[0]}.`;
    }
    throw new TypeError(msg);
  }
}
function checkSigCryptoKey(key, alg, ...usages) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "EdDSA": {
      if (key.algorithm.name !== "Ed25519" && key.algorithm.name !== "Ed448") {
        throw unusable("Ed25519 or Ed448");
      }
      break;
    }
    case "Ed25519": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usages);
}

// node_modules/jose/dist/node/esm/lib/invalid_key_input.js
function message(msg, actual, ...types4) {
  types4 = types4.filter(Boolean);
  if (types4.length > 2) {
    const last = types4.pop();
    msg += `one of type ${types4.join(", ")}, or ${last}.`;
  } else if (types4.length === 2) {
    msg += `one of type ${types4[0]} or ${types4[1]}.`;
  } else {
    msg += `of type ${types4[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
var invalid_key_input_default = (actual, ...types4) => {
  return message("Key must be ", actual, ...types4);
};
function withAlg(alg, actual, ...types4) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types4);
}

// node_modules/jose/dist/node/esm/runtime/is_key_like.js
var is_key_like_default = (key) => is_key_object_default(key) || isCryptoKey(key);
var types3 = ["KeyObject"];
if (globalThis.CryptoKey || webcrypto_default?.CryptoKey) {
  types3.push("CryptoKey");
}

// node_modules/jose/dist/node/esm/lib/is_disjoint.js
var isDisjoint = (...headers) => {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
};
var is_disjoint_default = isDisjoint;

// node_modules/jose/dist/node/esm/lib/is_object.js
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}

// node_modules/jose/dist/node/esm/runtime/get_named_curve.js
var import_node_crypto = require("node:crypto");

// node_modules/jose/dist/node/esm/lib/is_jwk.js
function isJWK(key) {
  return isObject(key) && typeof key.kty === "string";
}
function isPrivateJWK(key) {
  return key.kty !== "oct" && typeof key.d === "string";
}
function isPublicJWK(key) {
  return key.kty !== "oct" && typeof key.d === "undefined";
}
function isSecretJWK(key) {
  return isJWK(key) && key.kty === "oct" && typeof key.k === "string";
}

// node_modules/jose/dist/node/esm/runtime/get_named_curve.js
var namedCurveToJOSE = (namedCurve) => {
  switch (namedCurve) {
    case "prime256v1":
      return "P-256";
    case "secp384r1":
      return "P-384";
    case "secp521r1":
      return "P-521";
    case "secp256k1":
      return "secp256k1";
    default:
      throw new JOSENotSupported("Unsupported key curve for this operation");
  }
};
var getNamedCurve2 = (kee, raw) => {
  let key;
  if (isCryptoKey(kee)) {
    key = import_node_crypto.KeyObject.from(kee);
  } else if (is_key_object_default(kee)) {
    key = kee;
  } else if (isJWK(kee)) {
    return kee.crv;
  } else {
    throw new TypeError(invalid_key_input_default(kee, ...types3));
  }
  if (key.type === "secret") {
    throw new TypeError('only "private" or "public" type keys can be used for this operation');
  }
  switch (key.asymmetricKeyType) {
    case "ed25519":
    case "ed448":
      return `Ed${key.asymmetricKeyType.slice(2)}`;
    case "x25519":
    case "x448":
      return `X${key.asymmetricKeyType.slice(1)}`;
    case "ec": {
      const namedCurve = key.asymmetricKeyDetails.namedCurve;
      if (raw) {
        return namedCurve;
      }
      return namedCurveToJOSE(namedCurve);
    }
    default:
      throw new TypeError("Invalid asymmetric key type for this operation");
  }
};
var get_named_curve_default = getNamedCurve2;

// node_modules/jose/dist/node/esm/runtime/check_key_length.js
var import_node_crypto2 = require("node:crypto");
var check_key_length_default = (key, alg) => {
  let modulusLength;
  try {
    if (key instanceof import_node_crypto2.KeyObject) {
      modulusLength = key.asymmetricKeyDetails?.modulusLength;
    } else {
      modulusLength = Buffer.from(key.n, "base64url").byteLength << 3;
    }
  } catch {
  }
  if (typeof modulusLength !== "number" || modulusLength < 2048) {
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
  }
};

// node_modules/jose/dist/node/esm/runtime/jwk_to_key.js
var import_node_crypto3 = require("node:crypto");
var parse = (key) => {
  if (key.d) {
    return (0, import_node_crypto3.createPrivateKey)({ format: "jwk", key });
  }
  return (0, import_node_crypto3.createPublicKey)({ format: "jwk", key });
};
var jwk_to_key_default = parse;

// node_modules/jose/dist/node/esm/key/import.js
async function importJWK(jwk, alg) {
  if (!isObject(jwk)) {
    throw new TypeError("JWK must be an object");
  }
  alg ||= jwk.alg;
  switch (jwk.kty) {
    case "oct":
      if (typeof jwk.k !== "string" || !jwk.k) {
        throw new TypeError('missing "k" (Key Value) Parameter value');
      }
      return decode(jwk.k);
    case "RSA":
      if ("oth" in jwk && jwk.oth !== void 0) {
        throw new JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
      }
    case "EC":
    case "OKP":
      return jwk_to_key_default({ ...jwk, alg });
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}

// node_modules/jose/dist/node/esm/lib/check_key_type.js
var tag = (key) => key?.[Symbol.toStringTag];
var jwkMatchesOp = (alg, key, usage) => {
  if (key.use !== void 0 && key.use !== "sig") {
    throw new TypeError("Invalid key for this operation, when present its use must be sig");
  }
  if (key.key_ops !== void 0 && key.key_ops.includes?.(usage) !== true) {
    throw new TypeError(`Invalid key for this operation, when present its key_ops must include ${usage}`);
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, when present its alg must be ${alg}`);
  }
  return true;
};
var symmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (key instanceof Uint8Array)
    return;
  if (allowJwk && isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, "Uint8Array", allowJwk ? "JSON Web Key" : null));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
};
var asymmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (allowJwk && isJWK(key)) {
    switch (usage) {
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, allowJwk ? "JSON Web Key" : null));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (usage === "sign" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
  }
  if (usage === "decrypt" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
  }
  if (key.algorithm && usage === "verify" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
  }
  if (key.algorithm && usage === "encrypt" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
  }
};
function checkKeyType(allowJwk, alg, key, usage) {
  const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A\d{3}(?:GCM)?KW$/.test(alg);
  if (symmetric) {
    symmetricTypeCheck(alg, key, usage, allowJwk);
  } else {
    asymmetricTypeCheck(alg, key, usage, allowJwk);
  }
}
var check_key_type_default = checkKeyType.bind(void 0, false);
var checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);

// node_modules/jose/dist/node/esm/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
var validate_crit_default = validateCrit;

// node_modules/jose/dist/node/esm/lib/validate_algorithms.js
var validateAlgorithms = (option, algorithms) => {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
};
var validate_algorithms_default = validateAlgorithms;

// node_modules/jose/dist/node/esm/runtime/verify.js
var crypto3 = __toESM(require("node:crypto"), 1);
var import_node_util2 = require("node:util");

// node_modules/jose/dist/node/esm/runtime/dsa_digest.js
function dsaDigest(alg) {
  switch (alg) {
    case "PS256":
    case "RS256":
    case "ES256":
    case "ES256K":
      return "sha256";
    case "PS384":
    case "RS384":
    case "ES384":
      return "sha384";
    case "PS512":
    case "RS512":
    case "ES512":
      return "sha512";
    case "Ed25519":
    case "EdDSA":
      return void 0;
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}

// node_modules/jose/dist/node/esm/runtime/node_key.js
var import_node_crypto4 = require("node:crypto");
var ecCurveAlgMap = /* @__PURE__ */ new Map([
  ["ES256", "P-256"],
  ["ES256K", "secp256k1"],
  ["ES384", "P-384"],
  ["ES512", "P-521"]
]);
function keyForCrypto(alg, key) {
  let asymmetricKeyType;
  let asymmetricKeyDetails;
  let isJWK2;
  if (key instanceof import_node_crypto4.KeyObject) {
    asymmetricKeyType = key.asymmetricKeyType;
    asymmetricKeyDetails = key.asymmetricKeyDetails;
  } else {
    isJWK2 = true;
    switch (key.kty) {
      case "RSA":
        asymmetricKeyType = "rsa";
        break;
      case "EC":
        asymmetricKeyType = "ec";
        break;
      case "OKP": {
        if (key.crv === "Ed25519") {
          asymmetricKeyType = "ed25519";
          break;
        }
        if (key.crv === "Ed448") {
          asymmetricKeyType = "ed448";
          break;
        }
        throw new TypeError("Invalid key for this operation, its crv must be Ed25519 or Ed448");
      }
      default:
        throw new TypeError("Invalid key for this operation, its kty must be RSA, OKP, or EC");
    }
  }
  let options;
  switch (alg) {
    case "Ed25519":
      if (asymmetricKeyType !== "ed25519") {
        throw new TypeError(`Invalid key for this operation, its asymmetricKeyType must be ed25519`);
      }
      break;
    case "EdDSA":
      if (!["ed25519", "ed448"].includes(asymmetricKeyType)) {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ed25519 or ed448");
      }
      break;
    case "RS256":
    case "RS384":
    case "RS512":
      if (asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa");
      }
      check_key_length_default(key, alg);
      break;
    case "PS256":
    case "PS384":
    case "PS512":
      if (asymmetricKeyType === "rsa-pss") {
        const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = asymmetricKeyDetails;
        const length = parseInt(alg.slice(-3), 10);
        if (hashAlgorithm !== void 0 && (hashAlgorithm !== `sha${length}` || mgf1HashAlgorithm !== hashAlgorithm)) {
          throw new TypeError(`Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" ${alg}`);
        }
        if (saltLength !== void 0 && saltLength > length >> 3) {
          throw new TypeError(`Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" ${alg}`);
        }
      } else if (asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa or rsa-pss");
      }
      check_key_length_default(key, alg);
      options = {
        padding: import_node_crypto4.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: import_node_crypto4.constants.RSA_PSS_SALTLEN_DIGEST
      };
      break;
    case "ES256":
    case "ES256K":
    case "ES384":
    case "ES512": {
      if (asymmetricKeyType !== "ec") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ec");
      }
      const actual = get_named_curve_default(key);
      const expected = ecCurveAlgMap.get(alg);
      if (actual !== expected) {
        throw new TypeError(`Invalid key curve for the algorithm, its curve must be ${expected}, got ${actual}`);
      }
      options = { dsaEncoding: "ieee-p1363" };
      break;
    }
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
  if (isJWK2) {
    return { format: "jwk", key, ...options };
  }
  return options ? { ...options, key } : key;
}

// node_modules/jose/dist/node/esm/runtime/sign.js
var crypto2 = __toESM(require("node:crypto"), 1);
var import_node_util = require("node:util");

// node_modules/jose/dist/node/esm/runtime/hmac_digest.js
function hmacDigest(alg) {
  switch (alg) {
    case "HS256":
      return "sha256";
    case "HS384":
      return "sha384";
    case "HS512":
      return "sha512";
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}

// node_modules/jose/dist/node/esm/runtime/get_sign_verify_key.js
var import_node_crypto5 = require("node:crypto");
function getSignVerifyKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key, ...types3));
    }
    return (0, import_node_crypto5.createSecretKey)(key);
  }
  if (key instanceof import_node_crypto5.KeyObject) {
    return key;
  }
  if (isCryptoKey(key)) {
    checkSigCryptoKey(key, alg, usage);
    return import_node_crypto5.KeyObject.from(key);
  }
  if (isJWK(key)) {
    if (alg.startsWith("HS")) {
      return (0, import_node_crypto5.createSecretKey)(Buffer.from(key.k, "base64url"));
    }
    return key;
  }
  throw new TypeError(invalid_key_input_default(key, ...types3, "Uint8Array", "JSON Web Key"));
}

// node_modules/jose/dist/node/esm/runtime/sign.js
var oneShotSign = (0, import_node_util.promisify)(crypto2.sign);
var sign2 = async (alg, key, data) => {
  const k = getSignVerifyKey(alg, key, "sign");
  if (alg.startsWith("HS")) {
    const hmac = crypto2.createHmac(hmacDigest(alg), k);
    hmac.update(data);
    return hmac.digest();
  }
  return oneShotSign(dsaDigest(alg), data, keyForCrypto(alg, k));
};
var sign_default = sign2;

// node_modules/jose/dist/node/esm/runtime/verify.js
var oneShotVerify = (0, import_node_util2.promisify)(crypto3.verify);
var verify2 = async (alg, key, signature, data) => {
  const k = getSignVerifyKey(alg, key, "verify");
  if (alg.startsWith("HS")) {
    const expected = await sign_default(alg, k, data);
    const actual = signature;
    try {
      return crypto3.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  const algorithm = dsaDigest(alg);
  const keyInput = keyForCrypto(alg, k);
  try {
    return await oneShotVerify(algorithm, data, keyInput, signature);
  } catch {
    return false;
  }
};
var verify_default = verify2;

// node_modules/jose/dist/node/esm/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!is_disjoint_default(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validate_algorithms_default("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
    checkKeyTypeWithJwk(alg, key, "verify");
    if (isJWK(key)) {
      key = await importJWK(key, alg);
    }
  } else {
    checkKeyTypeWithJwk(alg, key, "verify");
  }
  const data = concat(encoder.encode(jws.protected ?? ""), encoder.encode("."), typeof jws.payload === "string" ? encoder.encode(jws.payload) : jws.payload);
  let signature;
  try {
    signature = decode(jws.signature);
  } catch {
    throw new JWSInvalid("Failed to base64url decode the signature");
  }
  const verified = await verify_default(alg, key, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    try {
      payload = decode(jws.payload);
    } catch {
      throw new JWSInvalid("Failed to base64url decode the payload");
    }
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key };
  }
  return result;
}

// node_modules/jose/dist/node/esm/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}

// node_modules/jose/dist/node/esm/lib/epoch.js
var epoch_default = (date) => Math.floor(date.getTime() / 1e3);

// node_modules/jose/dist/node/esm/lib/secs.js
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = (str) => {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
};

// node_modules/jose/dist/node/esm/lib/jwt_claims_set.js
var normalizeTyp = (value) => value.toLowerCase().replace(/^application\//, "");
var checkAudiencePresence = (audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
};
var jwt_claims_set_default = (protectedHeader, encodedPayload, options = {}) => {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs_default(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch_default(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs_default(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
};

// node_modules/jose/dist/node/esm/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = jwt_claims_set_default(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}

// src/shared/utils/jwt.ts
var JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is required but not set");
}
var JWT_ISSUER = "TodaysDentalInsights";
var JWT_AUDIENCE = "api.todaysdentalinsights.com";
async function verifyToken(token) {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    return payload;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
}

// src/shared/utils/auth-helper.ts
async function verifyIdToken(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, code: 401, message: "Missing Bearer token" };
  }
  const token = authorizationHeader.slice(7).trim();
  try {
    const payload = await verifyToken(token);
    if (payload.type !== "access") {
      return { ok: false, code: 401, message: "Access token required" };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, code: 401, message: `Invalid token: ${err.message}` };
  }
}

// src/shared/utils/permissions-helper.ts
function getClinicsFromJwtPayload(payload) {
  if (payload.isGlobalSuperAdmin || payload.isSuperAdmin) {
    return ["ALL"];
  }
  const xClinics = String(payload["x_clinics"] || "").trim();
  if (xClinics === "ALL")
    return ["ALL"];
  if (xClinics) {
    return xClinics.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const xRbc = String(payload["x_rbc"] || "").trim();
  if (xRbc) {
    return xRbc.split(",").map((pair) => pair.split(":")[0]).filter(Boolean);
  }
  const groups = Array.isArray(payload["cognito:groups"]) ? payload["cognito:groups"] : [];
  if (groups.length > 0) {
    const clinicIds = groups.map((name) => {
      const nameStr = String(name);
      if (nameStr.length > 200)
        return "";
      const match = /^clinic_([a-zA-Z0-9_-]+)__[A-Z_]+$/.exec(nameStr);
      return match ? match[1] : "";
    }).filter(Boolean);
    if (clinicIds.length > 0) {
      return clinicIds;
    }
  }
  return [];
}
function hasClinicAccessFromJwt(authorizedClinics, requestedClinic) {
  return authorizedClinics[0] === "ALL" || authorizedClinics.includes(requestedClinic);
}
function checkClinicAuthorization(payload, clinicId) {
  const authorizedClinics = getClinicsFromJwtPayload(payload);
  if (authorizedClinics.length === 0) {
    return {
      authorized: false,
      reason: "No clinic access configured for user"
    };
  }
  if (!hasClinicAccessFromJwt(authorizedClinics, clinicId)) {
    return {
      authorized: false,
      reason: `Not authorized for clinic ${clinicId}`
    };
  }
  return { authorized: true };
}
function getUserIdFromJwt(payload) {
  return payload.sub || payload.email || "";
}

// src/services/shared/utils/input-sanitization.ts
var E164_REGEX = /^\+[1-9]\d{1,14}$/;
function sanitizePhoneNumber(input) {
  if (typeof input !== "string") {
    return { error: "Phone number must be a string" };
  }
  const trimmed = input.trim();
  if (!E164_REGEX.test(trimmed)) {
    return { error: "Phone number must be in E.164 format (e.g., +12065550100)" };
  }
  if (trimmed.includes("@") || trimmed.includes(":") || trimmed.includes(";")) {
    return { error: "Phone number contains invalid characters" };
  }
  return { sanitized: trimmed };
}

// src/services/chime/utils/sma-map.ts
var cachedMap;
function parseSmaMap() {
  if (cachedMap) {
    return cachedMap;
  }
  const raw = process.env.SMA_ID_MAP;
  if (!raw) {
    console.warn("[sma-map] SMA_ID_MAP environment variable is not defined");
    cachedMap = {};
    return cachedMap;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      cachedMap = parsed;
    } else {
      console.error("[sma-map] SMA_ID_MAP did not parse to an object");
      cachedMap = {};
    }
  } catch (err) {
    console.error("[sma-map] Failed to parse SMA_ID_MAP", err);
    cachedMap = {};
  }
  return cachedMap;
}
function getSmaIdForClinic(clinicId) {
  if (!clinicId) {
    return void 0;
  }
  const map = parseSmaMap();
  return map[clinicId];
}

// src/services/chime/config/ttl-policy.ts
var TTL_POLICY = {
  /**
   * Agent session TTL: How long an agent session stays alive after creation
   * Must be at least as long as the longest possible call duration
   * Default: 24 hours (matches call TTL)
   */
  AGENT_SESSION_SECONDS: parseInt(process.env.CHIME_TTL_AGENT_SESSION || String(24 * 60 * 60), 10),
  /**
   * Active call TTL: How long a call record stays in DynamoDB
   * Includes duration for on-hold, transfer, and completion
   * Default: 24 hours
   */
  ACTIVE_CALL_SECONDS: parseInt(process.env.CHIME_TTL_ACTIVE_CALL || String(24 * 60 * 60), 10),
  /**
   * Queued call TTL: How long a call waits in queue before expiry
   * Default: 24 hours (same as active call)
   */
  QUEUED_CALL_SECONDS: parseInt(process.env.CHIME_TTL_QUEUED_CALL || String(24 * 60 * 60), 10),
  /**
   * Held call TTL: How long a call can remain on hold
   * Typically same as active call, but can be shortened if desired
   * Default: 24 hours
   */
  HELD_CALL_SECONDS: parseInt(process.env.CHIME_TTL_HELD_CALL || String(24 * 60 * 60), 10),
  /**
   * Heartbeat grace period: After this duration without heartbeat, agent is considered stale
   * This should be LESS than AGENT_SESSION to catch stale agents before TTL cleanup
   * Default: 15 minutes
   */
  HEARTBEAT_GRACE_SECONDS: parseInt(process.env.CHIME_TTL_HEARTBEAT_GRACE || String(15 * 60), 10),
  /**
   * Session expiry: Maximum duration an agent can stay logged in
   * Independent from heartbeat - agents stay online even if idle
   * Default: 8 hours (typical work shift)
   */
  SESSION_MAX_SECONDS: parseInt(process.env.CHIME_SESSION_MAX_SECONDS || String(8 * 60 * 60), 10)
};

// src/services/chime/utils/distributed-lock.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_crypto = require("crypto");
var RETRYABLE_ERRORS = [
  "ConditionalCheckFailedException",
  // Lock is held by another process
  "ProvisionedThroughputExceededException",
  // Throttling
  "ThrottlingException",
  // General throttling
  "RequestLimitExceeded",
  // Request rate limit
  "InternalServerError",
  // Transient internal error
  "ServiceUnavailable"
  // Service temporarily unavailable
];
var DistributedLock = class {
  constructor(ddb2, config) {
    this.ddb = ddb2;
    this.config = config;
    this.acquired = false;
    this.fencingToken = 0;
    this.lockId = (0, import_crypto.randomUUID)();
  }
  /**
   * Acquire the lock
   * @returns boolean for backwards compatibility
   */
  async acquire() {
    const result = await this.acquireWithFencingToken();
    return result.acquired;
  }
  /**
   * Acquire the lock with a fencing token
   * The fencing token is a monotonically increasing value that can be used
   * to detect stale lock holders in downstream operations.
   * 
   * FIX: Addresses the distributed systems problem where:
   * 1. Process A acquires lock
   * 2. Process A freezes (GC pause, throttling)
   * 3. Lock expires via TTL
   * 4. Process B acquires lock and makes progress
   * 5. Process A resumes - both think they have the lock
   * 
   * Solution: Downstream operations should verify fencing token hasn't been superseded
   */
  async acquireWithFencingToken() {
    const { tableName, lockKey, ttlSeconds = 30, maxRetries = 3, retryDelayMs = 100 } = this.config;
    const now = Math.floor(Date.now() / 1e3);
    const expiresAt = now + ttlSeconds;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        let nextFencingToken = 1;
        try {
          const { Item } = await this.ddb.send(new import_lib_dynamodb2.GetCommand({
            TableName: tableName,
            Key: { lockKey },
            ProjectionExpression: "fencingToken"
          }));
          if (Item?.fencingToken && typeof Item.fencingToken === "number") {
            nextFencingToken = Item.fencingToken + 1;
          }
        } catch (readErr) {
          console.warn(`[DistributedLock] Could not read current fencing token for ${lockKey}:`, readErr);
        }
        await this.ddb.send(new import_lib_dynamodb2.PutCommand({
          TableName: tableName,
          Item: {
            lockKey,
            lockId: this.lockId,
            acquiredAt: now,
            expiresAt,
            fencingToken: nextFencingToken,
            ttl: expiresAt + 300
            // Clean up 5 minutes after expiry
          },
          ConditionExpression: "attribute_not_exists(lockKey) OR expiresAt < :now",
          ExpressionAttributeValues: {
            ":now": now
          }
        }));
        this.acquired = true;
        this.fencingToken = nextFencingToken;
        console.log(`[DistributedLock] Acquired lock: ${lockKey} (fencingToken: ${nextFencingToken})`);
        return { acquired: true, fencingToken: nextFencingToken };
      } catch (err) {
        const errorName = err.name || err.code || "";
        const isRetryable = RETRYABLE_ERRORS.includes(errorName);
        if (isRetryable) {
          if (attempt < maxRetries - 1) {
            const baseBackoff = retryDelayMs * Math.pow(2, attempt);
            const jitter = Math.random() * baseBackoff * 0.1;
            const backoff = Math.floor(baseBackoff + jitter);
            if (errorName !== "ConditionalCheckFailedException") {
              console.warn(`[DistributedLock] Retryable error (${errorName}), attempt ${attempt + 1}/${maxRetries}, backoff ${backoff}ms: ${lockKey}`);
            }
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          console.warn(`[DistributedLock] Exhausted retries for ${lockKey} after ${errorName}`);
        } else {
          console.error(`[DistributedLock] Non-retryable error acquiring lock ${lockKey}:`, errorName, err.message);
          throw err;
        }
      }
    }
    console.warn(`[DistributedLock] Failed to acquire lock after ${maxRetries} attempts: ${lockKey}`);
    return { acquired: false };
  }
  async release() {
    if (!this.acquired)
      return;
    const { tableName, lockKey } = this.config;
    const maxReleaseRetries = 3;
    for (let attempt = 0; attempt < maxReleaseRetries; attempt++) {
      try {
        await this.ddb.send(new import_lib_dynamodb2.DeleteCommand({
          TableName: tableName,
          Key: { lockKey },
          ConditionExpression: "lockId = :lockId",
          ExpressionAttributeValues: {
            ":lockId": this.lockId
          }
        }));
        this.acquired = false;
        console.log(`[DistributedLock] Released lock: ${lockKey}`);
        return;
      } catch (err) {
        const errorName = err.name || err.code || "";
        if (errorName === "ConditionalCheckFailedException") {
          this.acquired = false;
          console.log(`[DistributedLock] Lock already released or expired: ${lockKey}`);
          return;
        }
        const isThrottling = ["ProvisionedThroughputExceededException", "ThrottlingException", "RequestLimitExceeded"].includes(errorName);
        if (isThrottling && attempt < maxReleaseRetries - 1) {
          const backoff = 100 * Math.pow(2, attempt);
          console.warn(`[DistributedLock] Throttled releasing lock, retrying in ${backoff}ms: ${lockKey}`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        console.error(`[DistributedLock] Error releasing lock: ${lockKey}`, errorName, err.message);
        this.acquired = false;
        return;
      }
    }
  }
  async withLock(fn) {
    const acquired = await this.acquire();
    if (!acquired)
      return null;
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
  /**
   * Check if this lock instance currently holds the lock
   */
  isAcquired() {
    return this.acquired;
  }
  /**
   * Get the fencing token for this lock acquisition
   * Returns 0 if lock was not acquired
   */
  getFencingToken() {
    return this.fencingToken;
  }
  /**
   * Validate that the current fencing token is still valid
   * This should be called before performing critical operations
   * to detect if another process has acquired the lock
   * 
   * @returns true if the fencing token is still the highest for this lock
   */
  async validateFencingToken() {
    if (!this.acquired || this.fencingToken === 0) {
      return false;
    }
    const { tableName, lockKey } = this.config;
    try {
      const { Item } = await this.ddb.send(new import_lib_dynamodb2.GetCommand({
        TableName: tableName,
        Key: { lockKey },
        ConsistentRead: true
      }));
      if (!Item) {
        console.warn(`[DistributedLock] Lock record not found for ${lockKey} - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      if (Item.lockId !== this.lockId) {
        console.warn(`[DistributedLock] Lock ${lockKey} owned by different process - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      if (Item.fencingToken !== this.fencingToken) {
        console.warn(`[DistributedLock] Fencing token mismatch for ${lockKey}: expected ${this.fencingToken}, got ${Item.fencingToken}`);
        this.acquired = false;
        return false;
      }
      const now = Math.floor(Date.now() / 1e3);
      if (Item.expiresAt < now) {
        console.warn(`[DistributedLock] Lock ${lockKey} has expired - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[DistributedLock] Error validating fencing token for ${lockKey}:`, err);
      return false;
    }
  }
};

// src/services/chime/add-call.ts
var ddb = getDynamoDBClient();
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeVoiceClient = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
var handler = async (event) => {
  console.log("[add-call] Function invoked", {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId
  });
  const corsHeaders = buildCorsHeaders({ allowMethods: ["POST", "OPTIONS"] });
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  try {
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn("[add-call] Auth verification failed", verifyResult);
      return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    const agentId = getUserIdFromJwt(verifyResult.payload);
    if (!agentId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "Invalid token: missing subject claim" }) };
    }
    const body = JSON.parse(event.body || "{}");
    console.log("[add-call] Parsed request body", {
      primaryCallId: body.primaryCallId,
      toPhoneNumber: body.toPhoneNumber,
      fromClinicId: body.fromClinicId
    });
    if (!body.primaryCallId || !body.toPhoneNumber || !body.fromClinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: "primaryCallId, toPhoneNumber, and fromClinicId are required" })
      };
    }
    const phoneValidation = sanitizePhoneNumber(body.toPhoneNumber);
    if (!phoneValidation.sanitized) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: phoneValidation.error })
      };
    }
    const toPhoneNumber = phoneValidation.sanitized;
    const authzCheck = checkClinicAuthorization(verifyResult.payload, body.fromClinicId);
    if (!authzCheck.authorized) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }
    if (!LOCKS_TABLE_NAME) {
      console.error("[add-call] LOCKS_TABLE_NAME not configured");
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: "System configuration error" }) };
    }
    const addCallLock = new DistributedLock(ddb, {
      tableName: LOCKS_TABLE_NAME,
      lockKey: `add-call-${agentId}`,
      ttlSeconds: 20,
      maxRetries: 1,
      // Don't retry - if locked, user already has an add-call in progress
      retryDelayMs: 0
    });
    const lockAcquired = await addCallLock.acquire();
    if (!lockAcquired) {
      console.warn("[add-call] Failed to acquire lock - possible double-click", { agentId });
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Add call operation already in progress. Please wait." })
      };
    }
    try {
      const { Item: agentPresence } = await ddb.send(new import_lib_dynamodb3.GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId }
      }));
      if (!agentPresence) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: "Agent session not found" }) };
      }
      if (agentPresence.currentCallId !== body.primaryCallId) {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: "Agent is not on the specified primary call" }) };
      }
      if (agentPresence.status !== "OnCall" && agentPresence.callStatus !== "connected") {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: "Agent must be connected to a call to add another call" }) };
      }
      if (agentPresence.secondaryCallId) {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: "Agent already has a secondary call active" }) };
      }
      const { Item: clinic } = await ddb.send(new import_lib_dynamodb3.GetCommand({
        TableName: CLINICS_TABLE_NAME,
        Key: { clinicId: body.fromClinicId }
      }));
      if (!clinic || !clinic.phoneNumber) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: "Clinic phone number not found" }) };
      }
      const fromPhoneNumber = clinic.phoneNumber;
      const smaId = getSmaIdForClinic(body.fromClinicId);
      if (!smaId) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: "Add call is not configured for this clinic" }) };
      }
      const { Items: primaryCallRecords } = await ddb.send(new import_lib_dynamodb3.QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: "callId-index",
        KeyConditionExpression: "callId = :callId",
        ExpressionAttributeValues: { ":callId": body.primaryCallId }
      }));
      if (!primaryCallRecords || primaryCallRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: "Primary call not found" }) };
      }
      const primaryCall = primaryCallRecords[0];
      if (primaryCall.status !== "connected") {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            message: `Primary call must be connected to add a secondary call. Current status: ${primaryCall.status}`
          })
        };
      }
      const secondaryCallReference = `add-call-${Date.now()}-${agentId}`;
      const idempotencyKey = (0, import_crypto3.randomUUID)();
      const callCommandInput = {
        FromPhoneNumber: fromPhoneNumber,
        ToPhoneNumber: toPhoneNumber,
        SipMediaApplicationId: smaId,
        ClientRequestToken: idempotencyKey,
        ArgumentsMap: {
          "callType": "AddCall",
          "agentId": agentId,
          "primaryCallId": body.primaryCallId,
          "meetingId": agentPresence.meetingInfo?.MeetingId || "",
          "callReference": secondaryCallReference,
          "idempotencyKey": idempotencyKey,
          "toPhoneNumber": toPhoneNumber,
          "fromPhoneNumber": fromPhoneNumber,
          "fromClinicId": body.fromClinicId,
          "holdPrimaryCall": body.holdPrimaryCall !== false ? "true" : "false"
        }
      };
      let callResponse;
      try {
        callResponse = await chimeVoiceClient.send(new import_client_chime_sdk_voice.CreateSipMediaApplicationCallCommand(callCommandInput));
      } catch (err) {
        console.error("[add-call] Failed to initiate secondary call:", err);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Failed to initiate secondary call", error: err.message })
        };
      }
      const secondaryCallId = callResponse.SipMediaApplicationCall?.TransactionId;
      if (!secondaryCallId) {
        throw new Error("CreateSipMediaApplicationCall did not return a TransactionId");
      }
      console.log("[add-call] Secondary call initiated", { secondaryCallId });
      const now = /* @__PURE__ */ new Date();
      const nowTs = Math.floor(now.getTime() / 1e3);
      const callTTL = nowTs + TTL_POLICY.ACTIVE_CALL_SECONDS;
      const { generateUniqueQueuePosition: generateUniqueQueuePosition2 } = (init_unique_id(), __toCommonJS(unique_id_exports));
      const queuePosition = generateUniqueQueuePosition2();
      await ddb.send(new import_lib_dynamodb3.PutCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Item: {
          clinicId: body.fromClinicId,
          callId: secondaryCallId,
          queuePosition,
          queueEntryTime: nowTs,
          queueEntryTimeIso: now.toISOString(),
          phoneNumber: toPhoneNumber,
          status: "dialing",
          direction: "outbound",
          callType: "add-call",
          assignedAgentId: agentId,
          primaryCallId: body.primaryCallId,
          callReference: secondaryCallReference,
          meetingInfo: agentPresence.meetingInfo,
          ttl: callTTL
        }
      }));
      console.log(`[add-call] Secondary call ${secondaryCallId} added to queue table`);
      try {
        const transactItems = [
          // Update agent presence with secondary call info
          {
            Update: {
              TableName: AGENT_PRESENCE_TABLE_NAME,
              Key: { agentId },
              UpdateExpression: "SET secondaryCallId = :callId, secondaryCallStatus = :status, secondaryCallReference = :ref, lastActivityAt = :now",
              ConditionExpression: "attribute_not_exists(secondaryCallId) AND currentCallId = :primaryCallId",
              ExpressionAttributeValues: {
                ":callId": secondaryCallId,
                ":status": "dialing",
                ":ref": secondaryCallReference,
                ":now": now.toISOString(),
                ":primaryCallId": body.primaryCallId
              }
            }
          }
        ];
        if (body.holdPrimaryCall !== false) {
          transactItems.push({
            Update: {
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId: primaryCall.clinicId, queuePosition: primaryCall.queuePosition },
              UpdateExpression: "SET #status = :holdStatus, holdStartTime = :now, heldByAgentId = :agentId, heldForSecondaryCall = :secondaryCallId",
              // FIX: Add ConditionExpression to verify call is still connected
              ConditionExpression: "#status = :connectedStatus AND assignedAgentId = :agentId",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":holdStatus": "on_hold",
                ":connectedStatus": "connected",
                ":now": now.toISOString(),
                ":agentId": agentId,
                ":secondaryCallId": secondaryCallId
              }
            }
          });
        }
        await ddb.send(new import_lib_dynamodb3.TransactWriteCommand({ TransactItems: transactItems }));
        console.log("[add-call] Agent presence and primary call updated atomically");
      } catch (txnErr) {
        console.error("[add-call] Transaction failed, rolling back queue entry:", txnErr);
        try {
          await ddb.send(new import_lib_dynamodb3.DeleteCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: { clinicId: body.fromClinicId, queuePosition }
          }));
          console.log("[add-call] Rolled back queue table entry");
        } catch (rollbackErr) {
          console.error("[add-call] Failed to rollback queue entry:", rollbackErr);
        }
        if (txnErr.name === "TransactionCanceledException") {
          const reasons = txnErr.CancellationReasons || [];
          console.warn("[add-call] Transaction cancelled", { reasons });
          if (reasons[0]?.Code === "ConditionalCheckFailed") {
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: "Agent state changed during operation. You may already have a secondary call." })
            };
          }
          if (reasons[1]?.Code === "ConditionalCheckFailed") {
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: "Primary call state changed. It may no longer be connected." })
            };
          }
        }
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Failed to update call state", error: txnErr.message })
        };
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: "Secondary call initiated",
          secondaryCallId,
          primaryCallId: body.primaryCallId,
          primaryCallOnHold: body.holdPrimaryCall !== false
        })
      };
    } finally {
      await addCallLock.release();
    }
  } catch (err) {
    console.error("[add-call] Error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Failed to add call", error: err?.message })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
