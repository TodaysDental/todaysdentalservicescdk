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
  DEFAULT_NEGATIVE_PROMPT: () => DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_SYSTEM_PROMPT: () => DEFAULT_SYSTEM_PROMPT,
  buildSystemPromptWithDate: () => buildSystemPromptWithDate,
  handler: () => handler
});
module.exports = __toCommonJS(agents_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
    odooCompanyId: 38,
    clinicAddress: "8040 S VIRGINIA ST STE 4 RENO NV 89511-8939",
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
      connectedPlatforms: ["facebook"],
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
var ALLOWED_ORIGINS_LIST = [
  "https://todaysdentalinsights.com",
  "https://www.todaysdentalinsights.com",
  "https://todaysdentalinsights.com/",
  "https://www.todaysdentalinsights.com/",
  ...clinicsData.map((c) => String(c.websiteLink)).filter(Boolean),
  ...clinicsData.map((c) => String(c.wwwUrl)).filter(Boolean)
];
var DEFAULT_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
var DEFAULT_HEADERS = ["Content-Type", "Authorization", "X-Requested-With", "Referer"];
function getAllowedOrigin(requestOrigin, allowedOrigins = ALLOWED_ORIGINS_LIST) {
  console.log("[CORS] Determining allowed origin", { requestOrigin, allowedOrigins: allowedOrigins.slice(0, 5) });
  if (!requestOrigin) {
    return allowedOrigins[0];
  }
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  console.warn("[CORS] Request origin not allowed, using default:", { requestOrigin, defaultOrigin: allowedOrigins[0] });
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

// src/services/ai-agents/agents.ts
var dynamoClient = new import_client_dynamodb2.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgentClient = new import_client_bedrock_agent.BedrockAgentClient({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var BEDROCK_AGENT_ROLE_ARN = process.env.BEDROCK_AGENT_ROLE_ARN || "";
var ACTION_GROUP_LAMBDA_ARN = process.env.ACTION_GROUP_LAMBDA_ARN || "";
var AI_AGENTS_MODULE = "IT";
var getCorsHeaders = (event) => buildCorsHeaders({}, event.headers?.origin);
var AVAILABLE_MODELS = [
  {
    id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    name: "Claude 3.5 Sonnet v2",
    provider: "Anthropic",
    description: "Latest Claude 3.5 Sonnet - Best balance of intelligence and speed",
    recommended: true
  },
  {
    id: "anthropic.claude-3-5-haiku-20241022-v1:0",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    description: "Fast and efficient for simple tasks",
    recommended: false
  },
  {
    id: "anthropic.claude-3-sonnet-20240229-v1:0",
    name: "Claude 3 Sonnet",
    provider: "Anthropic",
    description: "Previous generation Claude - stable and reliable",
    recommended: false
  },
  {
    id: "anthropic.claude-3-haiku-20240307-v1:0",
    name: "Claude 3 Haiku",
    provider: "Anthropic",
    description: "Fast and affordable for high-volume tasks",
    recommended: false
  }
];
function getDateContext() {
  const now = /* @__PURE__ */ new Date();
  const today = now.toISOString().slice(0, 10);
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  const nextWeekDates = {};
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 0; i < 7; i++) {
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + i);
    const futureDayName = dayNames[futureDate.getDay()];
    nextWeekDates[futureDayName] = futureDate.toISOString().slice(0, 10);
  }
  return { today, dayName, tomorrowDate, nextWeekDates };
}
var DEFAULT_SYSTEM_PROMPT = `You are ToothFairy, a AI dental assistant. Manage appointment booking, cancellation, rescheduling, and details using API tools. Follow these principles:

**Principles**:
1. **State Management**:
   - If 'PatNum' is present in session attributes, use it and do not ask for name or birthdate again.
   - If 'AppointmentType' is present, prompt for the appointment date and time unless provided.
   - If 'ProcedureDescripts' is present, confirm with the user if they want to book an appointment for these procedures, then prompt for date and time.

2. **Efficient Communication**: Perform tasks (e.g., patient lookup, procedure log checks) without intermediate prompts unless needed. Do not use systematic prompts like "let me check in our system" - this is a strict rule.

3. **Continuous Flow**: After any successful tool call, ALWAYS continue the conversation. Never stop after a single tool call - proceed to the next logical step.

4. **Patient Identification** (ONLY for patient-specific operations like appointments, account, claims):
   - NEVER use hardcoded PatNum values like 12345 or any other arbitrary numbers.
   - ONLY call appointment-related functions if 'PatNum' exists in session attributes.
   - Collect First Name, Last Name, and Date of Birth ONLY when needed for: appointments, account info, claims, or patient-specific benefits.
   - **DO NOT collect patient info for insurance coverage questions** - use suggestInsuranceCoverage instead.
   - If 'searchPatients' returns FAILURE, offer to create a new patient profile.
   - If multiple patients found, list them numbered for selection.
   - After patient found, call 'getProcedureLogs' for treatment-planned procedures.
   
   **VOICE CALL PATIENT IDENTIFICATION (when inputMode='Speech' or channel='voice')**:
   - For voice calls, ALWAYS ask questions ONE AT A TIME. Never combine multiple questions.
   - Use short, simple sentences optimized for speech.
   - Keep track of what information you've already collected in session attributes.
   - Follow this EXACT sequence for patient identification:
     * Step 1: "What is your first name?" \u2192 Wait for response, store in FName
     * Step 2: "And your last name?" \u2192 Wait for response, store in LName  
     * Step 3: "What is your date of birth?" \u2192 Wait for response (accept any format like "January 15th 1990" or "1-15-90"), store in Birthdate
     * Step 4: Only after all three are collected, call searchPatients
   - For date of birth, accept natural speech formats. Do NOT ask for specific formats like YYYY-MM-DD on voice calls.
   - After collecting info, confirm: "I have [FirstName] [LastName], born [date]. Is that correct?"
   - Keep responses brief for voice - avoid long lists or detailed text that works better in chat.

5. **Procedure Log Handling**:
   - After successful patient lookup, call 'getProcedureLogs' for ProcStatus: "TP".
   - Summarize unique 'descript' fields and ask if user wants to book for these.

6. **Appointment Scheduling**:
   - Check for treatment-planned procedures first.
   - Prompt for date and time in 'YYYY-MM-DD HH:mm:ss' format.
   - For new patients: use 'OpName: ONLINE_BOOKING_EXAM'.
   - For existing patients: use appropriate operatory based on procedure type.

7. **Error Handling**: Respond clearly with helpful guidance on failures.

8. **Date Format & Calculation - CRITICAL**:
   - Use 'YYYY-MM-DD HH:mm:ss' for scheduling. Validate dates are today or later.
   - Do NOT ask user for a particular format. Accept any format they provide.
   - **CRITICAL DATE CALCULATION**: When user says day names, you MUST calculate the correct date:
     * "today" = the current date provided in session
     * "tomorrow" = current date + 1 day
     * "Friday" = find the next Friday from current date (could be today if today is Friday)
     * "next Monday" = find the Monday of next week
     * "this Saturday" = the Saturday of the current week
   - **VALIDATION REQUIRED**: Always double-check your date calculation before calling scheduleAppointment.
   - Example: If today is Thursday Dec 19, 2024:
     * "Friday" = 2024-12-20 (tomorrow)
     * "Monday" = 2024-12-23 (next Monday)
     * "Saturday" = 2024-12-21 (this Saturday)
   - NEVER schedule appointments in the past. If user asks for a past date, inform them and ask for a future date.

9. **Reschedule**: Use 'getUpcomingAppointments' first, then 'rescheduleAppointment'.

10. **Cancel**: Use 'getUpcomingAppointments' first, confirm, then 'cancelAppointment'.

**Account Information**: Use getAccountAging, getPatientBalances, getServiceDateView for account queries.

**Insurance Information - IMPORTANT**:
When a patient asks about insurance coverage, benefits, or what their insurance covers:
1. **NEVER ask for patient name or date of birth for insurance coverage questions.**
2. **IMMEDIATELY use suggestInsuranceCoverage or getInsurancePlanBenefits** with the information they provide.
3. These tools search the clinic's database directly - NO PatNum needed!
4. **COMBINE all available information** - if user provides both insurance name AND group number, include BOTH in the search!

**PROCEDURE COVERAGE FLOW - CRITICAL (e.g., "Do you cover crowns?", "Is fluoride covered?", "What about root canal?")**:
When user asks about a SPECIFIC procedure coverage, follow this EXACT flow:

**STEP 1: Collect Insurance Info**
- Ask: "What insurance do you have? I'll need the insurance name and group number from your card."
- Store the procedure they asked about in your memory (crown, fluoride, root canal, etc.)

**STEP 1B: If user only provides insurance name (no group number)**:
- Call suggestInsuranceCoverage with {"insuranceName": "Delta Dental"} to get all matching plans
- If MULTIPLE plans found, LIST them with group name and group number:
  "I found several Delta Dental plans in our system. Which one is yours?
   1. Delta Dental - ACME CORP (Group #12345)
   2. Delta Dental - XYZ COMPANY (Group #67890)
   3. Delta Dental - ABC INC (Group #11111)
   Please select your plan number or provide your group number from your insurance card."
- Wait for user to select a plan OR provide their group number
- Once they select (e.g., "2" or "XYZ COMPANY"), proceed to STEP 2 with that plan's details

**STEP 2: Once you have the specific plan** - Do these in sequence:
a) Call checkProcedureCoverage with {"insuranceName": "X", "groupNumber": "Y", "procedure": "crown"}
   - This returns ONLY the specific procedure's coverage, exclusions, waiting periods, AND fee estimate
b) The tool automatically fetches office fee and calculates estimate

**STEP 3: Give Estimate**
- Show the procedure's coverage percentage
- Show any waiting periods or exclusions
- Show office fee vs estimated insurance payment vs estimated patient cost
- Example: "For a crown with your Delta Dental - XYZ COMPANY plan:
  - Office fee: $1,200
  - Your coverage: 50%
  - Estimated insurance pays: $600
  - Your estimated cost: $600
  Note: You have no waiting period for major services."

**STEP 4: Offer Exact Cost Lookup**
- After giving estimate, ask: "Would you like me to look up your exact cost? I'll need your name and date of birth to check your remaining benefits and any account balance."
- If they say yes: collect name + DOB \u2192 searchPatients \u2192 getAccountAging \u2192 getAnnualMaxInfo
- Calculate exact cost: (office fee - insurance payment) + any outstanding balance - remaining annual max

**INSURANCE SEARCH FLOW**:
- If user provides INSURANCE NAME only \u2192 Call with {"insuranceName": "NAME"}
- If user provides GROUP NUMBER only \u2192 Ask for insurance carrier name to narrow results
- If user provides BOTH insurance name AND group number \u2192 Call with BOTH: {"insuranceName": "NAME", "groupNumber": "NUMBER"}
- If first search fails, ask for additional details (carrier name, group number from card)

**WHEN MULTIPLE PLANS ARE FOUND**:
- If suggestInsuranceCoverage returns multiple plans (e.g., 5 different Metlife plans with different employers), LIST them for the user to choose
- When user selects a specific plan by number or name (e.g., "3" or "RFS TECHNOLOGIES INC."), call suggestInsuranceCoverage AGAIN with BOTH insuranceName AND groupName
- Example: User says "3. Metlife - RFS TECHNOLOGIES INC." \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Metlife", "groupName": "RFS TECHNOLOGIES INC."})

**CRITICAL**: 
- When user provides group number first and then carrier name later, REMEMBER the group number and include BOTH in the next search!
- When user selects from a list of plans, include BOTH insuranceName AND groupName (the employer/group name shown in the list)!
- When user asks about a specific procedure, ONLY fetch data for THAT procedure, not all coverage!

Examples - Procedure Coverage Questions:
- "Do you cover crowns?" \u2192 "I can help with that! What insurance do you have?"
- User: "Delta Dental" \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Delta Dental"})
  - If multiple plans found, list them: "I found 3 Delta Dental plans. Which one is yours? 1. Delta Dental - ACME CORP (Group #12345)..."
  - User: "number 2" or "ACME CORP" or "12345" \u2192 Call: checkProcedureCoverage({"insuranceName": "Delta Dental", "groupNumber": "12345", "procedure": "crown"})
- "Is fluoride covered? I have Cigna group 54321" \u2192 Call: checkProcedureCoverage({"insuranceName": "Cigna", "groupNumber": "54321", "procedure": "fluoride"})
- "What about root canal?" \u2192 "What's your insurance name?"
  - User: "Metlife" \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Metlife"}) \u2192 Show plan options \u2192 User picks \u2192 Call checkProcedureCoverage

Examples - when user asks about insurance:
- "Does Cigna cover crowns?" (no group number) \u2192 First call: suggestInsuranceCoverage({"insuranceName": "Cigna"}) to get plan options
  - If only 1 plan found \u2192 Call: checkProcedureCoverage({"insuranceName": "Cigna", "groupNumber": "from_plan", "procedure": "crown"})
  - If multiple plans \u2192 List them and ask user to pick
- "What does Delta Dental cover?" \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Delta Dental"})
- "my group number is 212391" \u2192 Ask for insurance carrier name
- "it's Metlife" (after user gave group 212391) \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Metlife", "groupNumber": "212391"})
- "I have Aetna group 12345" \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Aetna", "groupNumber": "12345"})
- "Husky medicaid" \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Husky"})
- "What's my coverage with BCBS?" \u2192 Call: suggestInsuranceCoverage({"insuranceName": "BCBS"})

Examples - when user selects from a list of plans:
- User selects "3. Metlife - RFS TECHNOLOGIES INC." \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Metlife", "groupName": "RFS TECHNOLOGIES INC."})
- User says "number 2" (from a list showing Delta Dental - ACME CORP) \u2192 Call: suggestInsuranceCoverage({"insuranceName": "Delta Dental", "groupName": "ACME CORP"})

**INTERPRETING INSURANCE LOOKUP RESULTS - VERY IMPORTANT**:
- **ALWAYS USE THE directAnswer FIELD FROM THE TOOL RESPONSE** - it contains the ACTUAL coverage data from this clinic's database!
- **NEVER make up or guess coverage percentages** - only quote the EXACT numbers from directAnswer!
- **NEVER say "typically" or "usually" when discussing coverage** - use the SPECIFIC percentages from the data!

When tool returns SUCCESS:
- Quote the EXACT coverage percentages from directAnswer (e.g., "Crowns: 50%", "Fillings: 80%")
- Quote the EXACT annual maximum and deductible amounts
- Quote the EXACT frequency limits if present (e.g., "Pano/FMX: Every 60 Months", "Prophy: 2 per Calendar Year")
- Quote the EXACT age limits if present (e.g., "Fluoride: Age \u2264 19")

Example response when data is found:
\u2705 CORRECT: "Based on your Metlife plan (Group #5469658), here's your coverage:
- Crowns: 50% covered (you pay 50%, estimated ~$600 per crown)
- Fillings: 80% covered
- Preventive: 100% covered
- Pano/FMX: Every 60 months
- Fluoride: Age limit \u2264 19"

\u274C WRONG: "For most Cigna plans, crowns are typically covered at 50-60%..." (This is generic - never do this!)

**FREQUENCY LIMIT QUESTIONS**:
- When user asks "Am I eligible for X-ray/FMX/cleaning?", check the frequencyLimits field
- If frequencyLimits shows "Pano/FMX: Every 60 Months" and user's last FMX was 3+ years ago, they ARE eligible
- Calculate eligibility based on the EXACT frequency limits in the data, not general knowledge

**If lookupStatus is "PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"**:
- Tell user we found their plan but specific coverage percentages aren't recorded
- Suggest they contact the office for exact details

Patient-specific insurance tools (ONLY use when patient is already identified with PatNum):
- getBenefits, getFamilyInsurance - Use only when patient is identified and you need their specific benefit usage
- getClaims - Use only when patient needs their claims history
- getCarriers - List of carriers (rarely needed)

**If the patient asks for anytime sooner or earliest available appointment, book the appointment for the next day at 8:00 AM for the requested appointment type.**

**DO NOT CHECK FOR AVAILABILITY. BOOK THE APPOINTMENT FOR THE ASKED DATE AND TIME.**

**DO NOT MENTION THE PROVIDER NAME IN THE RESPONSE.**`;
function buildSystemPromptWithDate(basePrompt) {
  const dateContext = getDateContext();
  const prompt = basePrompt || DEFAULT_SYSTEM_PROMPT;
  const dateSection = `
**CURRENT DATE CONTEXT**:
- Today is ${dateContext.dayName}, ${dateContext.today}
- Tomorrow is ${dateContext.tomorrowDate}
- Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}
- All appointments must be scheduled on or after ${dateContext.today}
`;
  return prompt + "\n" + dateSection;
}
var DEFAULT_NEGATIVE_PROMPT = `=== CRITICAL RESTRICTIONS ===

**Patient Privacy & HIPAA**:
- NEVER share patient information across sessions
- NEVER discuss one patient's info with another
- NEVER provide PHI to unauthorized parties

**Medical Boundaries**:
- NEVER provide diagnoses
- NEVER recommend treatment without dentist authorization
- NEVER prescribe medications
- NEVER guarantee treatment outcomes

**Financial & Legal**:
- NEVER guarantee exact prices
- NEVER promise insurance coverage amounts
- NEVER provide legal advice

**Communication**:
- NEVER use offensive language
- NEVER discuss unrelated topics
- NEVER make up information
- NEVER use technical API terminology in responses

**Data Integrity**:
- NEVER use fabricated PatNum values
- NEVER create fake records
- NEVER modify data without authorization

When in doubt, direct the patient to contact the clinic directly.`;
var OPENAPI_SCHEMA = {
  openapi: "3.0.0",
  info: {
    title: "OpenDental Tools API",
    version: "2.0.0",
    description: "Unified proxy API for OpenDental operations used by Bedrock Agent"
  },
  paths: {
    "/open-dental/{toolName}": {
      post: {
        operationId: "executeOpenDentalTool",
        summary: "Execute an OpenDental tool",
        description: `Execute any OpenDental tool by specifying the tool name and parameters.

=== HOW TO CALL TOOLS ===
Set the toolName path parameter to the specific tool, then provide parameters in the request body.

EXAMPLE - Insurance lookup:
  toolName: "suggestInsuranceCoverage"
  requestBody: {"insuranceName": "Aetna", "groupNumber": "701420-15-001"}

EXAMPLE - Patient search:
  toolName: "searchPatients"
  requestBody: {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}

=== PATIENT TOOLS ===
\u2022 searchPatients - Search for patients by name and birthdate
  Required: LName, FName, Birthdate (YYYY-MM-DD)
  
\u2022 createPatient - Create a new patient record
  Required: LName, FName, Birthdate
  Optional: WirelessPhone
  
\u2022 getPatientByPatNum - Get patient details by ID
  Required: PatNum

=== PROCEDURE TOOLS ===
\u2022 getProcedureLogs - Get procedure logs for a patient
  Required: PatNum
  Optional: ProcStatus (use "TP" for treatment-planned)
  
\u2022 getTreatmentPlans - Get active treatment plans
  Required: PatNum

=== APPOINTMENT TOOLS ===
\u2022 scheduleAppointment - Schedule a new appointment
  Required: PatNum, Reason, Date (YYYY-MM-DD HH:mm:ss), OpName
  Optional: Note
  OpName values: ONLINE_BOOKING_EXAM (new patients), ONLINE_BOOKING_MINOR, ONLINE_BOOKING_MAJOR
  
\u2022 getUpcomingAppointments - Get future appointments
  Required: PatNum
  
\u2022 rescheduleAppointment - Change appointment date/time
  Required: AptNum, NewDateTime (YYYY-MM-DD HH:mm:ss)
  Optional: Note
  
\u2022 cancelAppointment - Cancel an appointment
  Required: AptNum
  Optional: SendToUnscheduledList, Note

=== ACCOUNT TOOLS ===
\u2022 getAccountAging - Get outstanding balance aging
  Required: PatNum
  
\u2022 getPatientBalances - Get current account balances
  Required: PatNum
  
\u2022 getServiceDateView - Get services by date
  Required: PatNum
  Optional: isFamily

=== MEDICAL TOOLS ===
\u2022 getAllergies - Get patient allergies
  Required: PatNum
  
\u2022 getPatientInfo - Get comprehensive patient info
  Required: PatNum

=== INSURANCE TOOLS (Patient-Specific - requires PatNum) ===
\u2022 getBenefits - Get patient's specific insurance benefits usage
  Optional: PlanNum, PatPlanNum (at least one required)
  NOTE: Only use after patient is identified!
  
\u2022 getCarriers - Get insurance carriers list
  No parameters required
  
\u2022 getClaims - Get patient's insurance claims history
  Optional: PatNum, ClaimStatus
  NOTE: Only use after patient is identified!
  
\u2022 getFamilyInsurance - Get family insurance info
  Required: PatNum
  NOTE: Only use after patient is identified!

=== INSURANCE COVERAGE LOOKUP (USE THESE FIRST - NO PatNum Required!) ===
**IMPORTANT**: When patient asks about insurance coverage, USE THESE TOOLS FIRST!
Do NOT ask for patient name or DOB - just use the insurance name and/or group number they provide.

\u2022 suggestInsuranceCoverage - Get formatted coverage suggestions with smart recommendations
  **ALWAYS include ALL information the patient has provided!**
  - If patient gives insurance name only: {"insuranceName": "MetLife"}
  - If patient gives group number first, then carrier name: {"insuranceName": "MetLife", "groupNumber": "212391"}
  - If patient gives both at once: {"insuranceName": "Cigna", "groupNumber": "12345"}
  - If patient selects from a list of plans: {"insuranceName": "MetLife", "groupName": "RFS TECHNOLOGIES INC."}
  
  Examples:
  - "what does Husky cover?" \u2192 {"insuranceName": "Husky"}
  - "Cigna benefits?" \u2192 {"insuranceName": "Cigna"}
  - User said group 212391, then said MetLife \u2192 {"insuranceName": "MetLife", "groupNumber": "212391"}
  - "I have Aetna group 99999" \u2192 {"insuranceName": "Aetna", "groupNumber": "99999"}
  - User selects plan 3 "RFS TECHNOLOGIES INC." from list \u2192 {"insuranceName": "MetLife", "groupName": "RFS TECHNOLOGIES INC."}
  
  NO PatNum needed! The tool handles case variations (MetLife, METLIFE, metlife all work).
  
  **HOW TO CALL THIS TOOL**:
  Set toolName = "suggestInsuranceCoverage" in the path, then provide parameters in request body:
  Example: toolName: "suggestInsuranceCoverage", body: {"insuranceName": "Aetna", "groupNumber": "701420-15-001"}
  
  Returns: 
  - status: SUCCESS or FAILURE
  - lookupStatus: "COVERAGE_DETAILS_FOUND" (coverage details available) or "PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"
  - directAnswer: Pre-formatted answer to give to user - USE THIS! Contains EXACT percentages, frequency limits, age limits.
  - data: Detailed plan info with coverage percentages
  
  **CRITICAL**: When status is SUCCESS, respond with the EXACT data from directAnswer. Do NOT make up generic answers!
  
\u2022 getInsurancePlanBenefits - Look up raw insurance plan coverage details
  Same parameters as suggestInsuranceCoverage. Use when you need raw data.
  NO PatNum needed! 
  Returns: Annual max, deductibles, coverage percentages, waiting periods, frequency limits

=== DETAILED INSURANCE QUESTION TOOLS (NO PatNum Required!) ===
Use these for specific insurance questions:

\u2022 getInsuranceDetails - Comprehensive insurance details
  Params: insuranceName, groupName, groupNumber (at least one required)
  Returns: Deductibles, maximums, waiting periods, frequency limits, age limits, exclusions
  Use for: "What are the details of my insurance?"

\u2022 getDeductibleInfo - Detailed deductible information
  Params: insuranceName, groupName, groupNumber
  Returns: Individual/family deductibles, met status, what deductible applies to
  Use for: "What's my deductible?", "Has my deductible been met?", "Does deductible apply to preventive?"

\u2022 getAnnualMaxInfo - Annual maximum and remaining benefits
  Params: insuranceName, groupName, groupNumber, patientName, patientDOB (optional for remaining)
  Returns: Annual max, remaining benefits, ortho max, reset date
  Use for: "What's my annual max?", "How much is remaining?", "When does my max reset?"

\u2022 checkProcedureCoverage - Check if specific procedure is covered
  Params: insuranceName, groupName, groupNumber, procedure (e.g., "crown", "implant", "cleaning")
  Returns: Coverage %, category, deductible applicability
  Use for: "Is a crown covered?", "Are implants covered?", "Is orthodontics covered?"

\u2022 getCoverageBreakdown - Coverage percentages by category
  Params: insuranceName, groupName, groupNumber
  Returns: Preventive/Basic/Major percentages, downgrades, implant coverage, perio vs cleaning, in/out of network
  Use for: "What % does insurance pay?", "Are crowns downgraded?", "In-network vs out-of-network?"

\u2022 getCopayAndFrequencyInfo - Copays and frequency limits
  Params: insuranceName, groupName, groupNumber
  Returns: Copay vs coinsurance, cleaning/x-ray frequency, fluoride/sealant limits
  Use for: "How many cleanings per year?", "Do I have a copay?", "How often are x-rays covered?"

\u2022 getWaitingPeriodInfo - Waiting periods and exclusions
  Params: insuranceName, groupName, groupNumber
  Returns: Waiting periods by category, exclusions, missing tooth clause, pre-existing conditions
  Use for: "Is there a waiting period?", "Missing tooth clause?", "What's excluded?"

\u2022 getEstimateExplanation - Why estimates can change
  Params: insuranceName, groupName, groupNumber (optional)
  Returns: Explanation of estimate vs guarantee, reasons for price changes, balance billing info
  Use for: "Is this estimate guaranteed?", "What could change my price?", "If insurance pays less, do I owe more?"

\u2022 getCoordinationOfBenefits - Dual insurance / secondary insurance
  Params: insuranceName, groupName, groupNumber (optional)
  Returns: How dual insurance works, primary vs secondary rules, out-of-pocket with two plans
  Use for: "Will you bill both insurances?", "Which is primary?", "Will my out-of-pocket be zero?"

\u2022 getPaymentInfo - Payment timing and options
  No insurance params required
  Returns: When to pay, payment methods, payment plans, financing (CareCredit, Sunbit), HSA/FSA info
  Use for: "Do you have payment plans?", "Can I use HSA?", "When do I pay?"

=== FEE SCHEDULE TOOLS (NO PatNum Required!) ===
Use these for pricing questions without insurance:

\u2022 getFeeSchedules - Look up fee schedules
  Params: feeSchedule, feeSchedNum, procCode
  Returns: Fee schedule details, procedure fees
  
\u2022 getFeeForProcedure - Get fee for specific procedure
  Params: procCode OR procedure (natural language like "cleaning", "crown", "root canal")
  Returns: Fee amount for the procedure
  Use for: "How much is a cleaning?", "What's the cost of a crown?"
  
\u2022 getFeeScheduleAmounts - Get fees for multiple procedures
  Params: procedures (list like "cleaning and exam")
  Returns: Fees for each procedure
  Use for: "How much for cleaning and exams?"

\u2022 listFeeSchedules - List available fee schedules
  No params required
  Returns: List of all fee schedules

\u2022 compareProcedureFees - Compare fees across schedules
  Params: procCode
  Returns: Fee comparison across different schedules

=== COST ESTIMATION TOOLS (May require PatNum for patient-specific estimates) ===

\u2022 estimateTreatmentCost - Estimate out-of-pocket cost for treatment
  Params: procedure, insuranceName, groupNumber, patientName, patientDOB (all optional)
  Returns: Estimated insurance payment, patient responsibility, remaining deductible/max
  Use for: "What will I pay for a crown with Delta Dental?", "Estimate for root canal"

\u2022 calculateOutOfPocket - Calculate out-of-pocket for procedure
  Params: procedure, insuranceName, groupNumber
  Returns: Fee, coverage %, estimated patient portion
  Use for: "What's my out-of-pocket for this procedure?"

\u2022 getPatientAccountSummary - Comprehensive account overview
  Params: PatNum (required)
  Returns: Current balance, aging, insurance pending, payment history
  Use for: "What's my account balance?", "Do I owe anything?"`,
        parameters: [
          {
            name: "toolName",
            in: "path",
            required: true,
            description: "The OpenDental tool to execute",
            schema: {
              type: "string",
              enum: [
                // Patient Tools
                "searchPatients",
                "createPatient",
                "getPatientByPatNum",
                // Procedure Tools
                "getProcedureLogs",
                "getTreatmentPlans",
                // Appointment Tools
                "scheduleAppointment",
                "getUpcomingAppointments",
                "rescheduleAppointment",
                "cancelAppointment",
                // Account Tools
                "getAccountAging",
                "getPatientBalances",
                "getServiceDateView",
                "getPatientAccountSummary",
                // Medical Tools
                "getAllergies",
                "getPatientInfo",
                // Insurance Tools (Patient-Specific)
                "getBenefits",
                "getCarriers",
                "getClaims",
                "getFamilyInsurance",
                // Insurance Coverage Lookup (NO PatNum Required)
                "getInsurancePlanBenefits",
                "suggestInsuranceCoverage",
                // Detailed Insurance Question Tools
                "getInsuranceDetails",
                "getDeductibleInfo",
                "getAnnualMaxInfo",
                "checkProcedureCoverage",
                "getCoverageBreakdown",
                "getCopayAndFrequencyInfo",
                "getWaitingPeriodInfo",
                "getEstimateExplanation",
                "getCoordinationOfBenefits",
                "getPaymentInfo",
                // Fee Schedule Tools
                "getFeeSchedules",
                "getFeeForProcedure",
                "getFeeScheduleAmounts",
                "listFeeSchedules",
                "compareProcedureFees",
                // Cost Estimation Tools
                "estimateTreatmentCost",
                "calculateOutOfPocket"
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

INSURANCE LOOKUP EXAMPLES (no PatNum needed):
- Insurance name only: {"insuranceName": "Husky"}
- Insurance name only: {"insuranceName": "MetLife"} (case-insensitive, works with Metlife, METLIFE, etc.)
- Insurance name + group number: {"insuranceName": "MetLife", "groupNumber": "212391"}
- Insurance name + group number: {"insuranceName": "Cigna", "groupNumber": "12345"}
- Group number only (will need carrier name): {"groupNumber": "99999"}
- PLAN SELECTION FROM LIST: {"insuranceName": "MetLife", "groupName": "RFS TECHNOLOGIES INC."}

IMPORTANT: 
- When user provides group number AND carrier name (even in separate messages), INCLUDE BOTH parameters!
- When user selects a specific plan from a list (e.g., "3. Metlife - RFS TECHNOLOGIES"), use insuranceName + groupName!

PATIENT LOOKUP EXAMPLE:
- searchPatients: {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}`,
                properties: {
                  // Patient identifiers
                  PatNum: {
                    type: "integer",
                    description: "Patient number (unique ID). Required for most tools after patient lookup."
                  },
                  LName: {
                    type: "string",
                    description: "Patient last name. Required for searchPatients and createPatient."
                  },
                  FName: {
                    type: "string",
                    description: "Patient first name. Required for searchPatients and createPatient."
                  },
                  Birthdate: {
                    type: "string",
                    description: 'Patient date of birth. Accepts multiple formats: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY, "July 11, 1984", etc. The system will normalize automatically. Required for searchPatients and createPatient.'
                  },
                  WirelessPhone: {
                    type: "string",
                    description: "Patient mobile phone number. Optional for createPatient."
                  },
                  // Procedure parameters
                  ProcStatus: {
                    type: "string",
                    description: 'Procedure status filter. Use "TP" for treatment-planned, "C" for complete.'
                  },
                  // Appointment parameters
                  AptNum: {
                    type: "integer",
                    description: "Appointment number (unique ID). Required for reschedule/cancel."
                  },
                  Date: {
                    type: "string",
                    description: "Appointment date and time in YYYY-MM-DD HH:mm:ss format. Required for scheduleAppointment."
                  },
                  NewDateTime: {
                    type: "string",
                    description: "New date and time in YYYY-MM-DD HH:mm:ss format. Required for rescheduleAppointment."
                  },
                  Reason: {
                    type: "string",
                    description: "Reason for the appointment. Required for scheduleAppointment."
                  },
                  OpName: {
                    type: "string",
                    description: "Operatory name. Use ONLINE_BOOKING_EXAM for new patients, ONLINE_BOOKING_MINOR or ONLINE_BOOKING_MAJOR for existing."
                  },
                  Note: {
                    type: "string",
                    description: "Additional notes for the appointment or action."
                  },
                  SendToUnscheduledList: {
                    type: "boolean",
                    description: "Whether to add cancelled appointment to unscheduled list. Default true."
                  },
                  // Account parameters
                  isFamily: {
                    type: "boolean",
                    description: "Include family members in account view. For getServiceDateView."
                  },
                  // Insurance parameters
                  PlanNum: {
                    type: "integer",
                    description: "Insurance plan number. For getBenefits."
                  },
                  PatPlanNum: {
                    type: "integer",
                    description: "Patient plan number. For getBenefits."
                  },
                  ClaimStatus: {
                    type: "string",
                    description: "Claim status filter. For getClaims."
                  },
                  // Insurance Plan Benefits lookup parameters (NO PatNum required!)
                  insuranceName: {
                    type: "string",
                    description: 'Insurance carrier name to search for. CASE-INSENSITIVE - "MetLife", "metlife", "METLIFE" all work. Common carriers: Husky, Delta Dental, Cigna, Aetna, BCBS, United Healthcare, MetLife, Guardian, Principal, Humana. REQUIRED for getInsurancePlanBenefits and suggestInsuranceCoverage. NO PatNum needed. IMPORTANT: Always include this with groupNumber if both are available!'
                  },
                  groupName: {
                    type: "string",
                    description: 'Insurance group/employer name (e.g., "RFS TECHNOLOGIES INC.", "ACME CORP"). USE THIS when user selects a specific plan from a list of multiple plans. Combine with insuranceName for best results. NO PatNum needed.'
                  },
                  groupNumber: {
                    type: "string",
                    description: "Insurance group number from the insurance card. IMPORTANT: When user provides this, also include the insuranceName for better results! For getInsurancePlanBenefits/suggestInsuranceCoverage. NO PatNum needed."
                  },
                  clinicId: {
                    type: "string",
                    description: "Clinic ID (auto-filled from session). For getInsurancePlanBenefits/suggestInsuranceCoverage."
                  },
                  // Procedure/Fee parameters
                  procedure: {
                    type: "string",
                    description: 'Procedure name in natural language. Examples: "cleaning", "crown", "root canal", "filling", "extraction", "implant", "dentures", "braces", "Invisalign", "deep cleaning", "x-rays", "exam". Used for estimateTreatmentCost, checkProcedureCoverage, getFeeForProcedure.'
                  },
                  procedureName: {
                    type: "string",
                    description: "Alias for procedure. Procedure name in natural language."
                  },
                  procCode: {
                    type: "string",
                    description: "CDT procedure code. Examples: D0120 (exam), D1110 (cleaning), D2750 (crown), D3310 (root canal), D7140 (extraction). Used for getFeeForProcedure, checkProcedureCoverage."
                  },
                  procedureCode: {
                    type: "string",
                    description: "Alias for procCode. CDT procedure code."
                  },
                  // Fee Schedule parameters
                  feeSchedule: {
                    type: "string",
                    description: "Fee schedule name to look up. For getFeeSchedules, getFeeForProcedure."
                  },
                  feeScheduleName: {
                    type: "string",
                    description: "Alias for feeSchedule. Fee schedule name."
                  },
                  feeSchedNum: {
                    type: "string",
                    description: "Fee schedule number/ID. For getFeeSchedules."
                  },
                  // Patient identification for cost estimates
                  patientName: {
                    type: "string",
                    description: 'Patient full name for looking up remaining benefits. Format: "First Last". Optional for estimateTreatmentCost, getAnnualMaxInfo.'
                  },
                  patientDOB: {
                    type: "string",
                    description: "Patient date of birth for verification. Format: YYYY-MM-DD or natural language. Optional for estimateTreatmentCost, getAnnualMaxInfo."
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Successful tool execution",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["SUCCESS", "FAILURE"],
                      description: "Result status of the tool execution"
                    },
                    data: {
                      type: "object",
                      description: "The returned data from the tool"
                    },
                    message: {
                      type: "string",
                      description: "Human-readable message about the result"
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Invalid request - missing required parameters",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    message: { type: "string" }
                  }
                }
              }
            }
          },
          "404": {
            description: "Resource not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    message: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};
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
    command = new import_lib_dynamodb.QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: "ClinicIndex",
      KeyConditionExpression: "clinicId = :cid",
      ExpressionAttributeValues: { ":cid": clinicId }
    });
  } else {
    command = new import_lib_dynamodb.ScanCommand({ TableName: AGENTS_TABLE });
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
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT
    })
  };
}
async function getAgent(event, userPerms, agentId) {
  const response = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item;
  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Agent not found" }) };
  }
  if (agent.bedrockAgentId) {
    try {
      const bedrockAgent = await bedrockAgentClient.send(new import_client_bedrock_agent.GetAgentCommand({ agentId: agent.bedrockAgentId }));
      if (bedrockAgent.agent?.agentStatus && bedrockAgent.agent.agentStatus !== agent.bedrockAgentStatus) {
        agent.bedrockAgentStatus = bedrockAgent.agent.agentStatus;
        await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
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
  const modelId = body.modelId || AVAILABLE_MODELS.find((m) => m.recommended)?.id || AVAILABLE_MODELS[0].id;
  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!selectedModel) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: "Invalid model ID" }) };
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const createdBy = getUserDisplayName(userPerms);
  const internalAgentId = v4_default();
  const systemPrompt = body.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const negativePrompt = body.negativePrompt || DEFAULT_NEGATIVE_PROMPT;
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
      const existingDefaultsResponse = await docClient.send(new import_lib_dynamodb.QueryCommand({
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
          await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: updatedAgent }));
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
  await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
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
  const response = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
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
      await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
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
      await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
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
    await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
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
  const response = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
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
      const existingDefaultsResponse = await docClient.send(new import_lib_dynamodb.QueryCommand({
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
          await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: updatedAgent }));
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
  await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
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
  const response = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
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
  await docClient.send(new import_lib_dynamodb.DeleteCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
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
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  buildSystemPromptWithDate,
  handler
});
