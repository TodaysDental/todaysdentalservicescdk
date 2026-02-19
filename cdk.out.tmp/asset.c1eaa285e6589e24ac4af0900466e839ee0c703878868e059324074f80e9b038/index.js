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

// src/services/chime/transfer-call.ts
var transfer_call_exports = {};
__export(transfer_call_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(transfer_call_exports);
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");

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
function getUserIdFromJwt(payload) {
  return payload.sub || payload.email || "";
}

// src/services/chime/transfer-call.ts
var import_crypto2 = require("crypto");

// src/services/chime/utils/push-notifications.ts
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");

// src/services/chime/config.ts
var CHIME_CONFIG = {
  /**
   * Call Queue Configuration
   */
  QUEUE: {
    /** Maximum number of agents to ring simultaneously for incoming calls */
    MAX_RING_AGENTS: parseInt(process.env.CHIME_MAX_RING_AGENTS || "25", 10),
    /** Timeout for calls stuck in queue (seconds) */
    TIMEOUT_SECONDS: parseInt(process.env.CHIME_QUEUE_TIMEOUT || String(24 * 60 * 60), 10),
    /** Average call duration for capacity planning (seconds) */
    AVG_CALL_DURATION_SECONDS: parseInt(process.env.CHIME_AVG_CALL_DURATION || "300", 10)
  },
  /**
   * Agent Management Configuration
   */
  AGENT: {
    /** Minutes of inactivity before agent marked offline */
    STALE_HEARTBEAT_MINUTES: parseInt(process.env.CHIME_STALE_HEARTBEAT_MINUTES || "15", 10),
    /** Maximum agent session duration (seconds) */
    SESSION_MAX_SECONDS: parseInt(process.env.CHIME_SESSION_MAX_SECONDS || String(8 * 60 * 60), 10),
    /** Grace period after last heartbeat before cleanup (seconds) */
    HEARTBEAT_GRACE_SECONDS: parseInt(process.env.CHIME_HEARTBEAT_GRACE_SECONDS || String(15 * 60), 10),
    /** Maximum connected call duration before auto-hangup (minutes) */
    MAX_CONNECTED_CALL_MINUTES: parseInt(process.env.CHIME_MAX_CONNECTED_CALL_MINUTES || "60", 10),
    /**
     * Wrap-up period after a call ends (seconds).
     * Delays the next queue check to give agents time for note-taking.
     * Set to 0 to disable (immediate re-dispatch).
     * @default 0
     */
    WRAP_UP_SECONDS: parseInt(process.env.CHIME_WRAP_UP_SECONDS || "0", 10)
  },
  /**
   * Dispatch Configuration
   * Controls how the fair-share dispatcher allocates agents to queued calls.
   */
  DISPATCH: {
    /** Maximum calls that can ring simultaneously per clinic (static limit) */
    MAX_SIMUL_RING_CALLS: parseInt(process.env.CHIME_MAX_SIMUL_RING_CALLS || "10", 10),
    /**
     * Enable dynamic scaling of MAX_SIMUL_RING_CALLS based on available agents.
     * Formula: min(max(10, ceil(idleAgents / 2)), DYNAMIC_SIMUL_RING_MAX)
     * @default true
     */
    DYNAMIC_SIMUL_RING: process.env.CHIME_DYNAMIC_SIMUL_RING !== "false",
    /** Upper bound for dynamic simultaneous ring calls */
    DYNAMIC_SIMUL_RING_MAX: parseInt(process.env.CHIME_DYNAMIC_SIMUL_RING_MAX || "50", 10),
    /**
     * Enable priority-weighted agent allocation.
     * Higher-priority calls get proportionally more agents instead of even distribution.
     * @default true
     */
    PRIORITY_WEIGHTED_ALLOCATION: process.env.CHIME_PRIORITY_WEIGHTED_ALLOCATION !== "false",
    /**
     * Enable parallel clinic dispatch.
     * Dispatches to all clinics concurrently instead of sequentially.
     * Safe because each clinic uses its own distributed lock.
     * @default true
     */
    PARALLEL_CLINIC_DISPATCH: process.env.CHIME_PARALLEL_CLINIC_DISPATCH !== "false",
    /**
     * Enable ring timeout escalation.
     * After each ring timeout, escalate the routing strategy:
     * Attempt 1: re-ring with different agents
     * Attempt 2: trigger overflow routing
     * Attempt 3+: offer voicemail/AI fallback
     * @default true
     */
    RING_TIMEOUT_ESCALATION: process.env.CHIME_RING_TIMEOUT_ESCALATION !== "false",
    /** Maximum ring attempts before final fallback */
    RING_ESCALATION_MAX_ATTEMPTS: parseInt(process.env.CHIME_RING_ESCALATION_MAX_ATTEMPTS || "3", 10)
  },
  /**
   * Hold Configuration
   * CRITICAL FIX: Moved from hardcoded values to configurable settings
   */
  HOLD: {
    /** Maximum hold duration in minutes before allowing stale hold override (default: 30 minutes) */
    MAX_HOLD_DURATION_MINUTES: parseInt(process.env.CHIME_MAX_HOLD_DURATION_MINUTES || "30", 10),
    /** Whether to allow supervisor override of active holds */
    ALLOW_SUPERVISOR_OVERRIDE: process.env.CHIME_HOLD_SUPERVISOR_OVERRIDE !== "false"
  },
  /**
   * Transfer Configuration
   */
  TRANSFER: {
    /** Maximum length of transfer notes field */
    MAX_NOTE_LENGTH: parseInt(process.env.CHIME_TRANSFER_NOTE_MAX || "500", 10)
  },
  /**
   * Retry Configuration
   */
  RETRY: {
    /** Maximum number of retry attempts for Lambda invocations */
    MAX_ATTEMPTS: parseInt(process.env.CHIME_RETRY_MAX_ATTEMPTS || "3", 10),
    /** Base delay between retries (milliseconds) */
    BASE_DELAY_MS: parseInt(process.env.CHIME_RETRY_BASE_DELAY_MS || "1000", 10)
  },
  /**
   * Cleanup Configuration
   */
  CLEANUP: {
    /** Minutes of inactivity for ringing/dialing status before cleanup */
    STALE_RINGING_DIALING_MINUTES: parseInt(process.env.CHIME_STALE_RINGING_DIALING_MINUTES || "5", 10),
    /** Minutes for queued calls with meeting to be marked as orphaned */
    STALE_QUEUED_CALL_MINUTES: parseInt(process.env.CHIME_STALE_QUEUED_CALL_MINUTES || "30", 10),
    /** Minutes for ringing calls to be marked as abandoned */
    ABANDONED_RINGING_CALL_MINUTES: parseInt(process.env.CHIME_ABANDONED_RINGING_CALL_MINUTES || "10", 10)
  },
  /**
   * Broadcast Ring Configuration
   * Ring strategy: 'broadcast' (ring all), 'parallel' (limited parallel), 'sequential'
   */
  BROADCAST: {
    /** Ring strategy: 'broadcast' | 'parallel' | 'sequential' */
    STRATEGY: process.env.CHIME_RING_STRATEGY || "parallel",
    /** Maximum agents to ring in broadcast mode (safety limit) */
    MAX_BROADCAST_AGENTS: parseInt(process.env.CHIME_MAX_BROADCAST_AGENTS || "100", 10),
    /** Ring timeout in seconds before fallback */
    RING_TIMEOUT_SECONDS: parseInt(process.env.CHIME_RING_TIMEOUT_SECONDS || "30", 10),
    /** Enable push notifications for ringing */
    ENABLE_PUSH_NOTIFICATIONS: process.env.CHIME_ENABLE_PUSH_NOTIFICATIONS !== "false",
    /** Minimum agents to use broadcast (falls back to sequential if fewer) */
    MIN_AGENTS_FOR_BROADCAST: parseInt(process.env.CHIME_MIN_AGENTS_FOR_BROADCAST || "3", 10)
  },
  /**
   * Push Notification Configuration
   * Controls when push notifications are sent for call-lifecycle events
   */
  PUSH: {
    /** Number of queued calls before sending a backup alert to all active agents */
    QUEUE_BACKUP_ALERT_THRESHOLD: parseInt(process.env.CHIME_QUEUE_BACKUP_ALERT_THRESHOLD || "3", 10),
    /** Enable push notifications when a call is transferred to an agent */
    ENABLE_TRANSFER_PUSH: process.env.CHIME_ENABLE_TRANSFER_PUSH !== "false",
    /** Enable push notification when an outbound call is initiated (mobile state sync) */
    ENABLE_OUTBOUND_CALL_PUSH: process.env.CHIME_ENABLE_OUTBOUND_CALL_PUSH !== "false",
    /** Enable push notification when an agent is added to a conference */
    ENABLE_CONFERENCE_JOIN_PUSH: process.env.CHIME_ENABLE_CONFERENCE_JOIN_PUSH !== "false",
    /** Enable push notification on hold/resume (mobile state sync) */
    ENABLE_HOLD_RESUME_PUSH: process.env.CHIME_ENABLE_HOLD_RESUME_PUSH !== "false",
    /** Enable push alert to supervisors when an agent goes offline (opt-in, can be noisy) */
    ENABLE_SESSION_OFFLINE_ALERT: process.env.CHIME_ENABLE_SESSION_OFFLINE_ALERT === "true",
    /** Enable call_cancelled push when a queued call is manually picked up (stops phantom ringing) */
    ENABLE_QUEUE_PICKUP_CANCEL_PUSH: process.env.CHIME_ENABLE_QUEUE_PICKUP_CANCEL_PUSH !== "false",
    /** Enable push notification when agent leaves a call (mobile state sync) */
    ENABLE_LEAVE_CALL_PUSH: process.env.CHIME_ENABLE_LEAVE_CALL_PUSH !== "false"
  },
  /**
   * Overflow Routing Configuration
   * Routes calls to sister clinics when primary clinic agents unavailable
   */
  OVERFLOW: {
    /** Enable overflow routing */
    ENABLED: process.env.CHIME_ENABLE_OVERFLOW === "true",
    /** Seconds to wait before triggering overflow */
    WAIT_THRESHOLD_SECONDS: parseInt(process.env.CHIME_OVERFLOW_WAIT_THRESHOLD || "60", 10),
    /** Maximum clinics to include in overflow */
    MAX_OVERFLOW_CLINICS: parseInt(process.env.CHIME_MAX_OVERFLOW_CLINICS || "5", 10),
    /** Require skill match for overflow agents */
    REQUIRE_SKILL_MATCH: process.env.CHIME_OVERFLOW_REQUIRE_SKILL_MATCH !== "false",
    /** Fallback action if no overflow agents: 'queue' | 'ai' | 'voicemail' */
    FALLBACK_ACTION: process.env.CHIME_OVERFLOW_FALLBACK || "queue",
    /** Default overflow clinic IDs (comma-separated) */
    DEFAULT_OVERFLOW_CLINICS: process.env.CHIME_DEFAULT_OVERFLOW_CLINICS || ""
  },
  /**
   * CloudWatch Metrics Configuration
   */
  METRICS: {
    /** Enable CloudWatch custom metrics */
    ENABLED: process.env.CHIME_METRICS_ENABLED !== "false",
    /** CloudWatch namespace */
    NAMESPACE: process.env.CHIME_METRICS_NAMESPACE || "TodaysDental/Chime"
  },
  /**
   * Enhanced Agent Selection Configuration
   */
  AGENT_SELECTION: {
    /** Enable time-of-day weighting */
    USE_TIME_OF_DAY_WEIGHTING: process.env.CHIME_USE_TIME_OF_DAY_WEIGHTING === "true",
    /** Enable historical performance scoring */
    USE_HISTORICAL_PERFORMANCE: process.env.CHIME_USE_HISTORICAL_PERFORMANCE !== "false",
    /** Enable fair distribution mode (round-robin style) */
    FAIR_DISTRIBUTION_MODE: process.env.CHIME_FAIR_DISTRIBUTION_MODE === "true",
    /** Weight for performance vs availability (0-1) */
    PERFORMANCE_WEIGHT: parseFloat(process.env.CHIME_PERFORMANCE_WEIGHT || "0.3"),
    /** Max calls per agent before deprioritization */
    MAX_CALLS_BEFORE_DEPRIORITIZE: parseInt(process.env.CHIME_MAX_CALLS_BEFORE_DEPRIORITIZE || "15", 10),
    /** Time window for performance calculation (hours) */
    PERFORMANCE_WINDOW_HOURS: parseInt(process.env.CHIME_PERFORMANCE_WINDOW_HOURS || "24", 10)
  },
  /**
   * Sentiment Analysis Configuration
   */
  SENTIMENT: {
    /** Enable real-time sentiment analysis */
    ENABLE_REALTIME: process.env.CHIME_ENABLE_REALTIME_SENTIMENT !== "false",
    /** Negative sentiment threshold for alerts (0-1) */
    NEGATIVE_ALERT_THRESHOLD: parseFloat(process.env.CHIME_NEGATIVE_SENTIMENT_THRESHOLD || "0.7"),
    /** Minimum text length to analyze */
    MIN_TEXT_LENGTH: parseInt(process.env.CHIME_MIN_SENTIMENT_TEXT_LENGTH || "20", 10),
    /** Enable supervisor sentiment alerts */
    ENABLE_SUPERVISOR_ALERTS: process.env.CHIME_ENABLE_SENTIMENT_ALERTS === "true"
  },
  /**
   * Call Summarization Configuration
   */
  SUMMARIZATION: {
    /** Enable AI call summarization */
    ENABLED: process.env.CHIME_ENABLE_CALL_SUMMARY !== "false",
    /** Bedrock model ID for summarization */
    MODEL_ID: process.env.BEDROCK_SUMMARY_MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0",
    /** Maximum tokens for summary */
    MAX_TOKENS: parseInt(process.env.CHIME_SUMMARY_MAX_TOKENS || "1024", 10),
    /** Include sentiment in summary */
    INCLUDE_SENTIMENT: process.env.CHIME_SUMMARY_INCLUDE_SENTIMENT !== "false"
  },
  /**
   * Quality Scoring Configuration
   */
  QUALITY: {
    /** Enable quality scoring */
    ENABLED: process.env.CHIME_ENABLE_QUALITY_SCORING !== "false",
    /** Weight for audio quality (0-1) */
    WEIGHT_AUDIO: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AUDIO || "0.15"),
    /** Weight for agent performance (0-1) */
    WEIGHT_AGENT: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AGENT || "0.35"),
    /** Weight for customer experience (0-1) */
    WEIGHT_CUSTOMER: parseFloat(process.env.CHIME_QUALITY_WEIGHT_CUSTOMER || "0.35"),
    /** Weight for compliance (0-1) */
    WEIGHT_COMPLIANCE: parseFloat(process.env.CHIME_QUALITY_WEIGHT_COMPLIANCE || "0.15"),
    /** Minimum overall score before alert */
    ALERT_THRESHOLD_OVERALL: parseInt(process.env.CHIME_QUALITY_ALERT_THRESHOLD || "60", 10)
  },
  /**
   * Supervisor Tools Configuration
   */
  SUPERVISOR: {
    /** Enable supervisor monitoring tools */
    ENABLED: process.env.CHIME_ENABLE_SUPERVISOR_TOOLS !== "false",
    /** Enable whisper mode */
    ENABLE_WHISPER: process.env.CHIME_ENABLE_WHISPER !== "false",
    /** Enable barge-in mode */
    ENABLE_BARGE: process.env.CHIME_ENABLE_BARGE !== "false",
    /** Maximum concurrent supervisions per supervisor */
    MAX_CONCURRENT_SUPERVISIONS: parseInt(process.env.CHIME_MAX_CONCURRENT_SUPERVISIONS || "5", 10)
  },
  /**
   * PII Redaction Configuration (HIPAA Compliance)
   */
  PII: {
    /** Enable PII detection and redaction */
    ENABLED: process.env.CHIME_ENABLE_PII_REDACTION !== "false",
    /** Use AWS Comprehend for PII detection */
    USE_COMPREHEND: process.env.CHIME_USE_COMPREHEND_PII !== "false",
    /** Enable audit logging for PII access */
    AUDIT_LOG: process.env.CHIME_PII_AUDIT_LOG === "true",
    /** Replacement template for redacted text */
    REPLACEMENT_TEMPLATE: process.env.CHIME_PII_REPLACEMENT_TEMPLATE || "[REDACTED-{TYPE}]"
  },
  /**
   * Audit Logging Configuration (HIPAA Compliance)
   */
  AUDIT: {
    /** Enable audit logging */
    ENABLED: process.env.CHIME_ENABLE_AUDIT_LOGGING !== "false",
    /** Log PII access events */
    LOG_PII_ACCESS: process.env.CHIME_LOG_PII_ACCESS === "true",
    /** Retention period in days (HIPAA requires 6 years minimum) */
    RETENTION_DAYS: parseInt(process.env.CHIME_AUDIT_RETENTION_DAYS || "2555", 10),
    /** Enable CloudWatch audit logging */
    CLOUDWATCH_ENABLED: process.env.CHIME_AUDIT_CLOUDWATCH !== "false",
    /** Redact sensitive data in audit logs */
    REDACT_SENSITIVE_DATA: process.env.CHIME_AUDIT_REDACT !== "false"
  },
  /**
   * Circuit Breaker Configuration
   */
  CIRCUIT_BREAKER: {
    /** Failures before circuit opens */
    FAILURE_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_FAILURE_THRESHOLD || "5", 10),
    /** Time before attempting to close circuit (ms) */
    RESET_TIMEOUT_MS: parseInt(process.env.CHIME_CIRCUIT_RESET_TIMEOUT_MS || "30000", 10),
    /** Successes needed to fully close circuit */
    SUCCESS_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_SUCCESS_THRESHOLD || "3", 10)
  },
  /**
   * Performance Thresholds (ms)
   */
  PERFORMANCE: {
    THRESHOLD_AGENT_SELECTION: parseInt(process.env.PERF_THRESHOLD_AGENT_SELECTION || "200", 10),
    THRESHOLD_BROADCAST_RING: parseInt(process.env.PERF_THRESHOLD_BROADCAST_RING || "500", 10),
    THRESHOLD_DDB_QUERY: parseInt(process.env.PERF_THRESHOLD_DDB_QUERY || "100", 10),
    THRESHOLD_AI_RESPONSE: parseInt(process.env.PERF_THRESHOLD_AI_RESPONSE || "5000", 10),
    THRESHOLD_TOTAL_ROUTING: parseInt(process.env.PERF_THRESHOLD_TOTAL_ROUTING || "2000", 10)
  }
};

// src/services/chime/utils/push-notifications.ts
var SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || "";
var PUSH_NOTIFICATIONS_ENABLED = !!SEND_PUSH_FUNCTION_ARN;
var lambdaClient = null;
var cwClient = null;
function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new import_client_lambda.LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return lambdaClient;
}
function getCloudWatchClient() {
  if (!cwClient) {
    cwClient = new import_client_cloudwatch.CloudWatchClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return cwClient;
}
function isPushNotificationsEnabled() {
  return PUSH_NOTIFICATIONS_ENABLED;
}
async function invokeSendPushLambda(payload, options = {}) {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log("[ChimePush] Push notifications not configured, skipping");
    return { success: false, error: "Push notifications not configured" };
  }
  const { sync = false, skipPreferenceCheck = false } = options;
  try {
    const invocationType = sync ? "RequestResponse" : "Event";
    const response = await getLambdaClient().send(new import_client_lambda.InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify({
        _internalCall: true,
        skipPreferenceCheck,
        ...payload
      }),
      InvocationType: invocationType
    }));
    if (!sync) {
      const success = response.StatusCode === 202 || response.StatusCode === 200;
      if (!success) {
        console.error(`[ChimePush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
      } else {
        console.log(`[ChimePush] Async Lambda invoked, StatusCode: ${response.StatusCode}`);
      }
      return { success };
    }
    if (response.Payload) {
      const payloadStr = new TextDecoder().decode(response.Payload);
      const result = JSON.parse(payloadStr);
      if (response.FunctionError) {
        console.error("[ChimePush] Lambda function error:", result);
        return {
          success: false,
          error: result.errorMessage || "Lambda function error"
        };
      }
      if (result.statusCode && result.body) {
        const body = JSON.parse(result.body);
        return {
          success: result.statusCode === 200,
          sent: body.sent,
          failed: body.failed,
          error: body.error
        };
      }
      return { success: true, ...result };
    }
    return { success: true };
  } catch (error) {
    console.error("[ChimePush] Failed to invoke send-push Lambda:", error.message);
    return { success: false, error: error.message };
  }
}
async function invokeSendPushLambdaWithRetry(payload, options = {}) {
  const { maxRetries = 2, ...invokeOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await invokeSendPushLambda(payload, invokeOptions);
    if (result.success) {
      return result;
    }
    lastError = result.error;
    if (result.error?.includes("not configured") || result.error?.includes("Invalid") || result.error?.includes("Unauthorized")) {
      break;
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
      console.log(`[ChimePush] Retrying push notification (attempt ${attempt + 2})`);
    }
  }
  return { success: false, error: lastError || "Max retries exceeded" };
}
async function emitPushMetric(metricName, dimensions, value = 1) {
  if (!CHIME_CONFIG.METRICS.ENABLED)
    return;
  try {
    await getCloudWatchClient().send(new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: CHIME_CONFIG.METRICS.NAMESPACE,
      MetricData: [{
        MetricName: metricName,
        Dimensions: [
          { Name: "NotificationType", Value: dimensions.notificationType }
        ],
        Value: value,
        Unit: "Count",
        Timestamp: /* @__PURE__ */ new Date()
      }]
    }));
  } catch (err) {
    console.warn(`[ChimePush] Failed to emit ${metricName} metric:`, err.message);
  }
}
function formatPhoneNumber(phone) {
  if (!phone)
    return "Unknown";
  const cleaned = phone.replace(/^\+1/, "").replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}
function getCallerDisplay(data) {
  if (data.callerName && data.callerName !== "Unknown") {
    return data.callerName;
  }
  return formatPhoneNumber(data.callerPhoneNumber || "Unknown caller");
}
async function sendIncomingCallToAgents(agentUserIds, notification) {
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0) {
    console.log("[ChimePush] sendIncomingCallToAgents skipped", {
      pushEnabled: PUSH_NOTIFICATIONS_ENABLED,
      agentCount: agentUserIds.length,
      callId: notification.callId
    });
    return;
  }
  console.log("[ChimePush] \u{1F4DE} Sending incoming-call push notification", {
    callId: notification.callId,
    clinicId: notification.clinicId,
    clinicName: notification.clinicName,
    callerPhoneNumber: notification.callerPhoneNumber,
    targetAgentIds: agentUserIds,
    agentCount: agentUserIds.length,
    timestamp: notification.timestamp,
    sendPushArn: process.env.SEND_PUSH_FUNCTION_ARN?.substring(0, 60) + "..."
  });
  const callerDisplay = getCallerDisplay(notification);
  const idempotencyKey = `incoming_call:${notification.callId}:agents:${notification.timestamp}`;
  const result = await invokeSendPushLambdaWithRetry({
    userIds: agentUserIds,
    notification: {
      title: "Incoming Call",
      body: `${callerDisplay} calling ${notification.clinicName}`,
      type: "incoming_call",
      // Use system default sound across platforms (iOS app does not bundle ringtone.caf).
      sound: "default",
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        action: "answer_call",
        timestamp: notification.timestamp
      },
      category: "INCOMING_CALL"
    }
  }, {
    sync: true,
    skipPreferenceCheck: true,
    maxRetries: 2
  });
  if (result.success) {
    console.log(`[ChimePush] \u2705 Incoming call push delivered`, {
      callId: notification.callId,
      agentCount: agentUserIds.length,
      agents: agentUserIds,
      response: `sent=${result.sent ?? "?"}, failed=${result.failed ?? "?"}`
    });
    emitPushMetric("PushDelivered", { notificationType: "incoming_call" }, result.sent || agentUserIds.length);
  } else {
    console.error(`[ChimePush] \u274C Failed to push incoming call notification`, {
      callId: notification.callId,
      error: result.error,
      agents: agentUserIds,
      clinicId: notification.clinicId
    });
    emitPushMetric("PushFailed", { notificationType: "incoming_call" });
  }
}

// src/services/chime/transfer-call.ts
var ddb = getDynamoDBClient();
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeVoice = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var chime = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var MAX_TRANSFER_NOTE_LENGTH = CHIME_CONFIG.TRANSFER.MAX_NOTE_LENGTH;
var VALID_TRANSFER_NOTES_REGEX = /^[a-zA-Z0-9\s.,!?:;'"\-@#$/()&+]*$/;
function sanitizeTransferNotes(input) {
  if (typeof input !== "string") {
    return { sanitized: void 0 };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { sanitized: void 0 };
  }
  if (trimmed.length > MAX_TRANSFER_NOTE_LENGTH) {
    return {
      error: `Transfer notes too long (max ${MAX_TRANSFER_NOTE_LENGTH} characters)`,
      sanitized: void 0
    };
  }
  if (!VALID_TRANSFER_NOTES_REGEX.test(trimmed)) {
    return { error: "Transfer notes contain unsupported characters" };
  }
  return { sanitized: trimmed.slice(0, MAX_TRANSFER_NOTE_LENGTH) };
}
var handler = async (event) => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ["OPTIONS", "POST"] }, event.headers?.origin);
  try {
    if (!event.body) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "Missing request body" }) };
    }
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn("[transfer-call] Auth verification failed", {
        code: verifyResult.code,
        message: verifyResult.message
      });
      return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    const requestingAgentId = getUserIdFromJwt(verifyResult.payload);
    console.log("[transfer-call] Auth verification successful", { requestingAgentId });
    const body = JSON.parse(event.body);
    const {
      callId,
      fromAgentId,
      toAgentId,
      transferType: transferTypeInput,
      transferMode: transferModeInput,
      mode: modeInput,
      enableConference,
      conference,
      transferNotes: transferNotesInput,
      notes: notesInput
    } = body;
    const normalizedTransferType = [transferTypeInput, transferModeInput, modeInput].find((value) => typeof value === "string")?.toLowerCase();
    const conferenceFlag = typeof enableConference === "boolean" ? enableConference : typeof conference === "boolean" ? conference : void 0;
    const isConferenceTransfer = conferenceFlag ?? normalizedTransferType === "conference";
    const transferMode = isConferenceTransfer ? "conference" : "blind";
    const rawNotes = [transferNotesInput, notesInput].find((value) => typeof value === "string");
    const { sanitized: transferNotes, error: transferNotesError } = sanitizeTransferNotes(rawNotes);
    if (transferNotesError) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: transferNotesError })
      };
    }
    if (!callId || !fromAgentId || !toAgentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Missing required parameters: callId, fromAgentId, toAgentId" })
      };
    }
    if (requestingAgentId !== fromAgentId) {
      console.warn("[transfer-call] Authorization failed - agent attempting to transfer call they are not on", {
        requestingAgentId,
        fromAgentId
      });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Forbidden: You can only transfer calls you are currently on" })
      };
    }
    const lock = new DistributedLock(ddb, {
      tableName: process.env.LOCKS_TABLE_NAME || "ChimeLocks",
      lockKey: `agent-transfer-${toAgentId}`,
      ttlSeconds: 5
      // Reduced from 30s to 5s to minimize orphaned locks
    });
    const lockAcquired = await lock.acquire();
    if (!lockAcquired) {
      console.warn("[transfer-call] Could not acquire lock on target agent", { toAgentId });
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Target agent is busy with another operation. Please try again." })
      };
    }
    try {
      const { Item: targetAgent } = await ddb.send(new import_lib_dynamodb4.GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: toAgentId },
        ConsistentRead: true
        // FIX #3: Use consistent read for critical state check
      }));
      if (!targetAgent) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Target agent not found" })
        };
      }
      if (targetAgent.currentCallId || targetAgent.ringingCallId) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Target agent is already on a call" })
        };
      }
      const { Items: callRecords } = await ddb.send(new import_lib_dynamodb4.QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: "callId-index",
        KeyConditionExpression: "callId = :callId",
        ExpressionAttributeValues: {
          ":callId": callId
        }
      }));
      if (!callRecords || callRecords.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Call not found" })
        };
      }
      const callRecord = callRecords[0];
      const { clinicId, queuePosition } = callRecord;
      const TRANSFERABLE_STATES = ["connected"];
      if (!TRANSFERABLE_STATES.includes(callRecord.status)) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            message: `Cannot transfer call in ${callRecord.status} state`,
            error: "INVALID_CALL_STATE",
            currentState: callRecord.status,
            allowedStates: TRANSFERABLE_STATES
          })
        };
      }
      if (callRecord.callStatus === "on_hold") {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            message: "Cannot transfer call while on hold. Resume call first.",
            error: "CALL_ON_HOLD"
          })
        };
      }
      if (!callRecord.meetingInfo?.MeetingId) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            message: "Cannot transfer call - no active meeting",
            error: "NO_ACTIVE_MEETING"
          })
        };
      }
      const smaId = getSmaIdForClinic(clinicId);
      if (!smaId) {
        console.error("[transfer-call] Missing SMA mapping for clinic", { clinicId });
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Call transfers are not configured for this clinic" })
        };
      }
      if (callRecord.assignedAgentId !== fromAgentId) {
        console.warn("[transfer-call] Source agent not on this call", {
          fromAgentId,
          assignedAgentId: callRecord.assignedAgentId
        });
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ message: "You are not currently on this call" })
        };
      }
      const sourceAgentClinics = getClinicsFromJwtPayload(verifyResult.payload);
      const targetAgentClinics = targetAgent.activeClinicIds || [];
      const hasAccess = targetAgent.activeClinicIds?.includes(clinicId) || targetAgent.activeClinicIds?.includes("ALL");
      if (!hasAccess) {
        console.warn("[transfer-call] Target agent does not have access to this clinic", {
          toAgentId,
          clinicId,
          targetAgentClinics: targetAgent.activeClinicIds
        });
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ message: "Target agent does not have access to this clinic" })
        };
      }
      let toAgentAttendee;
      try {
        if (!callRecord.meetingInfo?.MeetingId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ message: "No active meeting found for this call" })
          };
        }
        const meetingInfo = callRecord.meetingInfo;
        try {
          await chime.send(new import_client_chime_sdk_meetings.GetMeetingCommand({ MeetingId: meetingInfo.MeetingId }));
          console.log(`[transfer-call] Meeting ${meetingInfo.MeetingId} validated - exists`);
        } catch (meetingErr) {
          if (meetingErr.name === "NotFoundException") {
            console.error(`[transfer-call] Meeting ${meetingInfo.MeetingId} no longer exists`);
            await ddb.send(new import_lib_dynamodb4.UpdateCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition },
              UpdateExpression: "REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo SET meetingError = :error",
              ExpressionAttributeValues: {
                ":error": "Meeting not found in Chime SDK during transfer"
              }
            })).catch((cleanupErr) => console.warn("[transfer-call] Failed to cleanup stale meeting ref:", cleanupErr));
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({
                message: "Cannot transfer call - meeting no longer exists",
                error: "MEETING_NOT_FOUND"
              })
            };
          }
          throw meetingErr;
        }
        const transferAttemptId = (0, import_crypto2.randomUUID)();
        const externalUserIdForTransfer = `${toAgentId}-transfer-${transferAttemptId}`;
        console.log(`[transfer-call] Creating attendee for target agent ${toAgentId} in meeting ${meetingInfo.MeetingId}`);
        try {
          const toAgentAttendeeResponse = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
            MeetingId: meetingInfo.MeetingId,
            ExternalUserId: externalUserIdForTransfer
          }));
          if (!toAgentAttendeeResponse.Attendee) {
            throw new Error("Failed to create attendee for target agent");
          }
          toAgentAttendee = toAgentAttendeeResponse.Attendee;
          console.log(`[transfer-call] Created attendee ${toAgentAttendee.AttendeeId} for target agent`);
        } catch (attendeeErr) {
          console.error(`[transfer-call] Failed to create attendee:`, attendeeErr);
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: "Failed to prepare meeting for transfer" })
          };
        }
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const callerNumber = typeof callRecord.phoneNumber === "string" && callRecord.phoneNumber.trim().length > 0 ? callRecord.phoneNumber : "Transferred Caller";
        const hasTransferNotes = Boolean(transferNotes);
        const callRecordSetParts = [
          "transferStatus = :ts",
          "transferToAgentId = :ta",
          "transferFromAgentId = :fa",
          "transferInitiatedAt = :timestamp",
          "#transferMode = :transferModeValue",
          "isConferenceTransfer = :isConference"
        ];
        const callRecordRemoveParts = [];
        if (hasTransferNotes) {
          callRecordSetParts.push("transferNotes = :transferNotes");
        } else {
          callRecordRemoveParts.push("transferNotes");
        }
        const callRecordUpdateExpression = `SET ${callRecordSetParts.join(", ")}${callRecordRemoveParts.length ? " REMOVE " + callRecordRemoveParts.join(", ") : ""}`;
        const targetAgentSetParts = [
          "ringingCallId = :callId",
          "callStatus = :status",
          "inboundMeetingInfo = :meeting",
          "inboundAttendeeInfo = :attendee",
          "ringingCallTime = :time",
          "lastActivityAt = :timestamp",
          "ringingCallFrom = :callerNumber",
          "ringingCallTransferAgentId = :transferInitiatedBy",
          "ringingCallTransferMode = :ringingTransferMode"
        ];
        const targetAgentRemoveParts = [];
        if (hasTransferNotes) {
          targetAgentSetParts.push("ringingCallNotes = :transferNotes");
        } else {
          targetAgentRemoveParts.push("ringingCallNotes");
        }
        const targetAgentUpdateExpression = `SET ${targetAgentSetParts.join(", ")}${targetAgentRemoveParts.length ? " REMOVE " + targetAgentRemoveParts.join(", ") : ""}`;
        const sourceAgentSetParts = [
          "#status = :sourceStatus",
          "lastActivityAt = :timestamp",
          "transferInitiatedAt = :timestamp"
        ];
        const sourceAgentRemoveParts = [];
        if (!isConferenceTransfer) {
          sourceAgentRemoveParts.push("currentCallId", "callStatus");
        }
        const sourceAgentUpdateExpression = `SET ${sourceAgentSetParts.join(", ")}${sourceAgentRemoveParts.length ? " REMOVE " + sourceAgentRemoveParts.join(", ") : ""}`;
        const sourceAgentFinalUpdateExpression = sourceAgentUpdateExpression;
        await ddb.send(new import_lib_dynamodb4.TransactWriteCommand({
          TransactItems: [
            // 1. Update call record
            {
              Update: {
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: callRecordUpdateExpression,
                ConditionExpression: "#status = :connectedStatus AND assignedAgentId = :fromAgent",
                ExpressionAttributeNames: { "#status": "status", "#transferMode": "transferMode" },
                ExpressionAttributeValues: {
                  ":ts": "pending",
                  ":ta": toAgentId,
                  ":fa": fromAgentId,
                  ":timestamp": timestamp,
                  ":connectedStatus": "connected",
                  ":fromAgent": fromAgentId,
                  ":transferModeValue": transferMode,
                  ":isConference": isConferenceTransfer,
                  ...hasTransferNotes ? { ":transferNotes": transferNotes } : {}
                }
              }
            },
            // 2. Update target agent's record (set to ringing)
            // NOTE: No ConditionExpression on status — transfers allowed regardless of agent status
            {
              Update: {
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: toAgentId },
                UpdateExpression: targetAgentUpdateExpression,
                ExpressionAttributeValues: {
                  ":callId": callId,
                  ":status": "ringing",
                  ":meeting": meetingInfo,
                  ":attendee": toAgentAttendee,
                  ":time": timestamp,
                  ":timestamp": timestamp,
                  ":callerNumber": callerNumber,
                  ":transferInitiatedBy": fromAgentId,
                  ":ringingTransferMode": transferMode,
                  ...hasTransferNotes ? { ":transferNotes": transferNotes } : {}
                }
              }
            },
            // 3. Update source agent's record (set to Online or keep OnCall for conference)
            {
              Update: {
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: fromAgentId },
                UpdateExpression: sourceAgentFinalUpdateExpression,
                ConditionExpression: "currentCallId = :callId",
                // Only if still on this call
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                  ":sourceStatus": isConferenceTransfer ? "OnCall" : "Online",
                  ":timestamp": timestamp,
                  ":callId": callId
                }
              }
            }
          ]
        }));
        console.log(`[transfer-call] Transaction completed successfully - transfer initiated from ${fromAgentId} to ${toAgentId}`);
      } catch (err) {
        if (err.name === "TransactionCanceledException") {
          const reasons = err.CancellationReasons || [];
          if (reasons[0]?.Code === "ConditionalCheckFailed") {
            console.warn("[transfer-call] Call state invalid for transfer", { callId });
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: "Call is not in a valid state for transfer" })
            };
          } else if (reasons[1]?.Code === "ConditionalCheckFailed") {
            console.warn("[transfer-call] Target agent no longer available", { toAgentId });
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: "Target agent is no longer available" })
            };
          } else if (reasons[2]?.Code === "ConditionalCheckFailed") {
            console.warn("[transfer-call] Source agent no longer on call", { fromAgentId });
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: "You are no longer on this call" })
            };
          }
          return {
            statusCode: 409,
            headers: corsHeaders,
            body: JSON.stringify({ message: "Transfer failed due to conflicting state changes" })
          };
        }
        throw err;
      }
      try {
        const smaArguments = {
          action: "TRANSFER_INITIATED",
          fromAgentId,
          toAgentId,
          transferType: transferMode,
          isConference: isConferenceTransfer ? "true" : "false"
        };
        if (transferNotes) {
          smaArguments.transferNotes = transferNotes;
        }
        await chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: callId,
          Arguments: smaArguments
        }));
        console.log(`[transfer-call] SMA notification sent successfully for transfer from ${fromAgentId} to ${toAgentId}`);
        if (isPushNotificationsEnabled() && CHIME_CONFIG.PUSH.ENABLE_TRANSFER_PUSH) {
          try {
            await sendIncomingCallToAgents([toAgentId], {
              callId,
              clinicId,
              clinicName: clinicId,
              callerPhoneNumber: callRecord.phoneNumber || void 0,
              callerName: `Transfer from ${fromAgentId}`,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
            console.log(`[transfer-call] \u{1F4F2} Transfer push notification sent to agent ${toAgentId}`);
          } catch (pushErr) {
            console.warn("[transfer-call] Push notification failed (non-fatal):", pushErr);
          }
        }
      } catch (updateError) {
        console.error("[transfer-call] Error triggering SMA for transfer, rolling back:", updateError);
        try {
          const targetMeetingInfo = callRecord.meetingInfo;
          const rollbackId = `rollback-${(0, import_crypto2.randomUUID)()}`;
          console.log(`[transfer-call] Starting compensating transaction ${rollbackId}`);
          await ddb.send(new import_lib_dynamodb4.TransactWriteCommand({
            TransactItems: [
              // 1. Revert call record
              {
                Update: {
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId, queuePosition },
                  UpdateExpression: "REMOVE transferStatus, transferToAgentId, transferFromAgentId, transferInitiatedAt, transferNotes, transferMode, isConferenceTransfer SET rollbackId = :rollbackId, lastRollbackAt = :timestamp",
                  ConditionExpression: "transferStatus = :pendingStatus AND transferToAgentId = :toAgent AND transferFromAgentId = :fromAgent",
                  ExpressionAttributeValues: {
                    ":pendingStatus": "pending",
                    ":toAgent": toAgentId,
                    ":fromAgent": fromAgentId,
                    ":rollbackId": rollbackId,
                    ":timestamp": (/* @__PURE__ */ new Date()).toISOString()
                  }
                }
              },
              // 2. Revert target agent
              {
                Update: {
                  TableName: AGENT_PRESENCE_TABLE_NAME,
                  Key: { agentId: toAgentId },
                  UpdateExpression: "SET #status = :status, lastActivityAt = :timestamp, rollbackId = :rollbackId REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode",
                  ExpressionAttributeNames: { "#status": "status" },
                  ConditionExpression: "ringingCallId = :callId",
                  ExpressionAttributeValues: {
                    ":status": "Online",
                    ":timestamp": (/* @__PURE__ */ new Date()).toISOString(),
                    ":callId": callId,
                    ":rollbackId": rollbackId
                  }
                }
              },
              // 3. Restore source agent
              // FIX #4: For blind transfers, also restore callStatus which was removed in forward path
              // FIX: Add ConditionExpression to prevent overwriting legitimate state changes
              {
                Update: {
                  TableName: AGENT_PRESENCE_TABLE_NAME,
                  Key: { agentId: fromAgentId },
                  UpdateExpression: "SET currentCallId = :callId, callStatus = :callStatus, #status = :status, lastActivityAt = :timestamp, rollbackId = :rollbackId REMOVE transferInitiatedAt",
                  // FIX: Only restore if agent hasn't started a new call or is still in transferring state
                  ConditionExpression: "attribute_not_exists(currentCallId) OR #status = :onlineStatus OR transferInitiatedAt = :timestamp",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":callId": callId,
                    ":callStatus": "connected",
                    ":status": "OnCall",
                    ":onlineStatus": "Online",
                    ":timestamp": (/* @__PURE__ */ new Date()).toISOString(),
                    ":rollbackId": rollbackId
                  }
                }
              }
            ]
          }));
          if (toAgentAttendee?.AttendeeId && targetMeetingInfo?.MeetingId) {
            try {
              await chime.send(new import_client_chime_sdk_meetings.DeleteAttendeeCommand({
                MeetingId: targetMeetingInfo.MeetingId,
                AttendeeId: toAgentAttendee.AttendeeId
              }));
              console.log(`[transfer-call] Cleaned up target agent attendee ${toAgentAttendee.AttendeeId}`);
            } catch (deleteErr) {
              console.warn(`[transfer-call] Failed to delete attendee:`, deleteErr);
            }
          }
          console.log(`[transfer-call] Successfully rolled back transfer with ID ${rollbackId}`);
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
              message: "Transfer failed - SMA notification error",
              rollbackId
            })
          };
        } catch (rollbackErr) {
          console.error(`[transfer-call] Failed to roll back transfer:`, rollbackErr);
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
              message: "Transfer failed with unrecoverable error - manual intervention needed",
              callId
            })
          };
        }
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Transfer initiated",
          transferStatus: "pending"
        })
      };
    } catch (transferErr) {
      console.error("[transfer-call] Transfer operation failed:", transferErr);
      throw transferErr;
    } finally {
      await lock.release();
    }
  } catch (error) {
    console.error("Error processing transfer request:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Internal server error" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
