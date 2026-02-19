// src/services/credentialing/autofill-handler.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
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
function hasModulePermission(clinicRoles, module, permission, isSuperAdmin, isGlobalSuperAdmin, clinicId) {
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }
  for (const cr of clinicRoles) {
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }
    const moduleAccess = cr.moduleAccess?.find((ma) => ma.module === module);
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

// src/services/credentialing/credentialing-schema.ts
var CANONICAL_FIELDS = {
  // ----------------------------------------
  // A) IDENTITY AND LEGAL
  // ----------------------------------------
  identity: [
    "firstName",
    "middleName",
    "lastName",
    "suffix",
    "maidenName",
    "dateOfBirth",
    "ssn",
    "gender",
    "birthCity",
    "birthState",
    "birthCountry",
    "citizenship",
    "visaStatus",
    "visaExpiry"
  ],
  contact: [
    "email",
    "phone",
    "cellPhone",
    "fax",
    "homeAddress1",
    "homeAddress2",
    "homeCity",
    "homeState",
    "homeZip",
    "mailingAddress1",
    "mailingAddress2",
    "mailingCity",
    "mailingState",
    "mailingZip"
  ],
  legal: [
    "taxId",
    "taxIdType",
    // SSN or EIN
    "ownershipType",
    "ownerName",
    "authorizedSignerName",
    "authorizedSignerTitle"
  ],
  // ----------------------------------------
  // B) LICENSURE AND PROFESSIONAL IDS
  // ----------------------------------------
  license: [
    "stateLicenseNumber",
    "stateLicenseState",
    "stateLicenseIssueDate",
    "stateLicenseExpiry",
    "stateLicenseStatus",
    "specialtyLicenseNumber",
    "specialtyLicenseState",
    "specialtyLicenseExpiry",
    "deaNumber",
    "deaState",
    "deaExpiry",
    "deaSchedules",
    "cdsNumber",
    "cdsState",
    "cdsExpiry"
    // Controlled Dangerous Substances (state-specific)
  ],
  professionalIds: [
    "npi",
    "npiType",
    // Type 1 (individual) or Type 2 (organization)
    "caqhId",
    "caqhUsername",
    "medicaidId",
    "medicaidState",
    "medicareId",
    "medicarePtan",
    "stateMedicaidId"
  ],
  // ----------------------------------------
  // C) PROFESSIONAL HISTORY
  // ----------------------------------------
  education: [
    "dentalSchoolName",
    "dentalSchoolAddress",
    "dentalSchoolCity",
    "dentalSchoolState",
    "degreeType",
    "graduationDate",
    "graduationYear",
    "residencyProgram",
    "residencyHospital",
    "residencyStartDate",
    "residencyEndDate",
    "specialtyTrainingProgram",
    "specialtyTrainingDates",
    "internshipProgram",
    "internshipDates"
  ],
  certifications: [
    "boardCertification",
    "boardCertifyingBody",
    "boardCertDate",
    "boardCertExpiry",
    "boardRecertDate",
    "additionalBoardCerts",
    "cprCertDate",
    "cprExpiry",
    "cprProvider",
    "blsCertDate",
    "blsExpiry",
    "aclsCertDate",
    "aclsExpiry",
    "palsCertDate",
    "palsExpiry"
  ],
  workHistory: [
    "currentEmployer",
    "currentEmployerAddress",
    "currentEmployerPhone",
    "currentEmployerStartDate",
    "previousEmployer1",
    "previousEmployer1Address",
    "previousEmployer1Dates",
    "previousEmployer1Reason",
    "previousEmployer2",
    "previousEmployer2Address",
    "previousEmployer2Dates",
    "previousEmployer2Reason",
    "previousEmployer3",
    "previousEmployer3Address",
    "previousEmployer3Dates",
    "previousEmployer3Reason",
    "gapsExplanation"
    // Explanation for gaps in work history
  ],
  specialty: [
    "primarySpecialty",
    "primarySpecialtyCode",
    "secondarySpecialty",
    "secondarySpecialtyCode",
    "subspecialty",
    "procedureFocus"
  ],
  // ----------------------------------------
  // D) MALPRACTICE / LIABILITY
  // ----------------------------------------
  malpractice: [
    "malpracticeInsurer",
    "malpracticeInsurerAddress",
    "malpracticeInsurerPhone",
    "malpracticePolicyNumber",
    "malpracticePolicyType",
    // Claims-made vs Occurrence
    "malpracticeLimitPerClaim",
    "malpracticeLimitAggregate",
    "malpracticeEffectiveDate",
    "malpracticeExpiry",
    "tailCoverageRequired",
    "tailCoveragePurchased",
    "premisesLiabilityInsurer",
    "premisesLiabilityLimit",
    "premisesLiabilityExpiry"
  ],
  claims: [
    "hasPendingClaims",
    "pendingClaimsDescription",
    "hasSettledClaims",
    "settledClaimsDescription",
    "hasDisciplinaryActions",
    "disciplinaryActionsDescription",
    "hasLicenseRevocations",
    "licenseRevocationsDescription",
    "hasCriminalHistory",
    "criminalHistoryDescription",
    "hasHospitalPrivilegesDenied",
    "hospitalPrivilegesDescription"
  ],
  // ----------------------------------------
  // E) PRACTICE / LOCATION
  // ----------------------------------------
  practice: [
    "practiceName",
    "practiceType",
    // Solo, Group, Hospital, etc.
    "practiceNpi",
    "practiceTaxId",
    "practiceLegalName",
    "practiceDoingBusinessAs",
    "practiceAddress1",
    "practiceAddress2",
    "practiceCity",
    "practiceState",
    "practiceZip",
    "practicePhone",
    "practiceFax",
    "practiceEmail",
    "practiceWebsite",
    "practiceBillingAddress1",
    "practiceBillingCity",
    "practiceBillingState",
    "practiceBillingZip",
    "practiceCorrespondenceAddress1",
    "practiceCorrespondenceCity",
    "practiceCorrespondenceState",
    "practiceCorrespondenceZip",
    "acceptingNewPatients",
    "officeHours",
    "handicapAccessible",
    "publicTransportAccess",
    "parkingAvailable",
    "languagesSpoken"
  ],
  additionalLocations: [
    "location2Name",
    "location2Address",
    "location2City",
    "location2State",
    "location2Zip",
    "location2Phone",
    "location3Name",
    "location3Address",
    "location3City",
    "location3State",
    "location3Zip",
    "location3Phone"
  ],
  hospitalAffiliations: [
    "hospital1Name",
    "hospital1Address",
    "hospital1PrivilegeType",
    "hospital1StartDate",
    "hospital2Name",
    "hospital2Address",
    "hospital2PrivilegeType",
    "hospital2StartDate"
  ],
  // ----------------------------------------
  // F) PORTAL / WORKFLOW-SPECIFIC
  // ----------------------------------------
  portalSpecific: [
    "attestationDate",
    "attestationSignature",
    "electronicSignatureDate",
    "credentialingContactName",
    "credentialingContactEmail",
    "credentialingContactPhone",
    "effectiveDate",
    "recredentialingDueDate"
  ]
};
var CANONICAL_FIELDS_FLAT = [
  ...CANONICAL_FIELDS.identity,
  ...CANONICAL_FIELDS.contact,
  ...CANONICAL_FIELDS.legal,
  ...CANONICAL_FIELDS.license,
  ...CANONICAL_FIELDS.professionalIds,
  ...CANONICAL_FIELDS.education,
  ...CANONICAL_FIELDS.certifications,
  ...CANONICAL_FIELDS.workHistory,
  ...CANONICAL_FIELDS.specialty,
  ...CANONICAL_FIELDS.malpractice,
  ...CANONICAL_FIELDS.claims,
  ...CANONICAL_FIELDS.practice,
  ...CANONICAL_FIELDS.additionalLocations,
  ...CANONICAL_FIELDS.hospitalAffiliations,
  ...CANONICAL_FIELDS.portalSpecific
];
var DOCUMENT_TYPE_SECTIONS = {
  // A) Identity and Legal Documents
  photoId: [
    "Government-issued ID",
    "Photo ID",
    "Driver's License",
    "Passport",
    "State ID",
    "Identity Document",
    "ID Upload"
  ],
  w9: [
    "W-9",
    "W9",
    "Tax Form",
    "Request for Taxpayer Identification",
    "W-9 Tax Form",
    "IRS Form W-9"
  ],
  ownershipDocs: [
    "Ownership Documents",
    "Authorized Signer",
    "Business Documents",
    "Corporate Documents",
    "Entity Documentation"
  ],
  // B) Licensure and Professional IDs
  stateLicense: [
    "State License",
    "Dental License",
    "Professional License",
    "License Upload",
    "License Copy",
    "State Dental License"
  ],
  specialtyLicense: [
    "Specialty License",
    "Specialty Permit",
    "Specialty Certificate",
    "Advanced Specialty License"
  ],
  deaCertificate: [
    "DEA Certificate",
    "DEA License",
    "DEA Registration",
    "Drug Enforcement Administration",
    "DEA Upload"
  ],
  cdsCertificate: [
    "CDS Certificate",
    "Controlled Substances Certificate",
    "State CDS License",
    "Controlled Dangerous Substances"
  ],
  npiConfirmation: [
    "NPI Confirmation",
    "NPI Letter",
    "NPPES Confirmation",
    "NPI Documentation",
    "National Provider Identifier"
  ],
  // C) Professional History Documents
  cv: [
    "CV",
    "Curriculum Vitae",
    "Resume",
    "Work History",
    "Professional Resume",
    "Career History"
  ],
  diploma: [
    "Diploma",
    "Degree Certificate",
    "DDS Certificate",
    "DMD Certificate",
    "Dental Degree",
    "Education Certificate",
    "Dental School Diploma"
  ],
  transcript: [
    "Transcript",
    "Academic Record",
    "Official Transcript",
    "School Transcript"
  ],
  boardCertification: [
    "Board Certification",
    "Specialty Certification",
    "Board Certificate",
    "American Board Certification",
    "Specialty Board Cert"
  ],
  residencyCertificate: [
    "Residency Certificate",
    "Residency Completion",
    "Training Certificate",
    "Postgraduate Training"
  ],
  cprCertification: [
    "CPR Certification",
    "BLS Certification",
    "Basic Life Support",
    "CPR Card",
    "BLS Card",
    "CPR/BLS Certificate"
  ],
  aclsCertification: [
    "ACLS Certification",
    "Advanced Cardiac Life Support",
    "ACLS Card"
  ],
  // D) Malpractice / Liability Documents
  malpracticeInsurance: [
    "Malpractice Insurance",
    "COI",
    "Certificate of Insurance",
    "Liability Insurance",
    "Professional Liability",
    "Malpractice COI",
    "Insurance Declaration",
    "Insurance Face Sheet"
  ],
  tailCoverage: [
    "Tail Coverage",
    "Extended Reporting Period",
    "ERP Coverage",
    "Tail Insurance"
  ],
  claimsHistory: [
    "Claims History",
    "Malpractice Claims",
    "Claims Explanation",
    "Insurance Claims Report",
    "Loss Run Report"
  ],
  premisesLiability: [
    "Premises Liability",
    "General Liability",
    "Commercial Liability",
    "Premises Insurance"
  ],
  // E) Practice / Location Documents
  practiceLocations: [
    "Practice Locations",
    "Location List",
    "Practice Sites",
    "Service Locations"
  ],
  taxIdConfirmation: [
    "Tax ID Confirmation",
    "EIN Letter",
    "Tax ID Letter",
    "IRS EIN Confirmation",
    "CP 575"
  ],
  facilityAccreditation: [
    "Facility Accreditation",
    "AAAHC Accreditation",
    "Accreditation Certificate",
    "Facility Certificate"
  ],
  clinicLicense: [
    "Clinic License",
    "Facility License",
    "Business License",
    "Health Facility License"
  ],
  // F) Portal / Workflow-specific
  caqhAttestation: [
    "CAQH Attestation",
    "CAQH Profile",
    "CAQH Completion",
    "ProView Attestation"
  ],
  signaturePage: [
    "Signature Page",
    "Provider Signature",
    "Authorized Signature",
    "Signed Application",
    "Electronic Signature"
  ],
  credentialingApplication: [
    "Credentialing Application",
    "Application Form",
    "Enrollment Application",
    "Provider Application"
  ],
  photo: [
    "Provider Photo",
    "Headshot",
    "Profile Photo",
    "Professional Photo"
  ],
  references: [
    "References",
    "Professional References",
    "Peer References",
    "Reference Letters"
  ],
  supplementalDocs: [
    "Supplemental Documents",
    "Additional Documents",
    "Supporting Documents",
    "Other Documents"
  ],
  other: [
    "Other",
    "Miscellaneous",
    "Additional"
  ]
};
function findUploadSection(documentType) {
  const sections = DOCUMENT_TYPE_SECTIONS[documentType];
  if (sections && sections.length > 0) {
    return sections[0];
  }
  for (const [docType, sectionLabels] of Object.entries(DOCUMENT_TYPE_SECTIONS)) {
    if (docType === documentType || documentType.toLowerCase().includes(docType.toLowerCase())) {
      return sectionLabels[0];
    }
  }
  return void 0;
}

// src/services/credentialing/autofill-handler.ts
var PROVIDERS_TABLE = process.env.PROVIDERS_TABLE;
var PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE;
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var PORTAL_ADAPTERS_TABLE = process.env.PORTAL_ADAPTERS_TABLE;
var PAYER_REQUIREMENTS_TABLE = process.env.PAYER_REQUIREMENTS_TABLE;
var AUTOFILL_AUDIT_TABLE = process.env.AUTOFILL_AUDIT_TABLE;
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
var s3 = new S3Client({});
var MODULE_NAME = "CREDENTIALING";
var METHOD_PERMISSIONS = {
  GET: "read",
  POST: "write",
  PUT: "put",
  DELETE: "delete"
};
var currentCorsHeaders = buildCorsHeaders();
var httpErr = (code, message) => ({
  statusCode: code,
  headers: currentCorsHeaders,
  body: JSON.stringify({ success: false, message })
});
var httpOk = (data) => ({
  statusCode: 200,
  headers: currentCorsHeaders,
  body: JSON.stringify({ success: true, ...data })
});
var httpCreated = (data) => ({
  statusCode: 201,
  headers: currentCorsHeaders,
  body: JSON.stringify({ success: true, ...data })
});
var handler = async (event) => {
  currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: currentCorsHeaders, body: "" };
  }
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(401, "Unauthorized - Invalid token");
  }
  const requiredPermission = METHOD_PERMISSIONS[event.httpMethod] || "read";
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return httpErr(403, `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module`);
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const method = event.httpMethod;
  const path = event.path.replace("/credentialing/autofill", "");
  const queryParams = event.queryStringParameters || {};
  const pathParams = event.pathParameters || {};
  try {
    if (method === "GET" && path === "/payload") {
      return getAutofillPayload(queryParams, userPerms, allowedClinics);
    }
    if (method === "GET" && path === "/documents") {
      return getAutofillDocuments(queryParams, userPerms, allowedClinics);
    }
    if (method === "POST" && path === "/audit") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return logAutofillEvent(JSON.parse(event.body), userPerms, event);
    }
    if (method === "GET" && path === "/portals") {
      return listPortalAdapters(queryParams);
    }
    if (method === "POST" && path === "/portals") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return createPortalAdapter(JSON.parse(event.body), userPerms);
    }
    if (method === "GET" && path.match(/^\/portals\/[^\/]+$/)) {
      const portalId = pathParams.portalId || path.split("/")[2];
      return getPortalAdapter(portalId);
    }
    if (method === "PUT" && path.match(/^\/portals\/[^\/]+$/)) {
      const portalId = pathParams.portalId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updatePortalAdapter(portalId, JSON.parse(event.body), userPerms);
    }
    if (method === "DELETE" && path.match(/^\/portals\/[^\/]+$/)) {
      const portalId = pathParams.portalId || path.split("/")[2];
      return deletePortalAdapter(portalId, userPerms);
    }
    if (method === "GET" && path === "/requirements") {
      return listPayerRequirements(queryParams);
    }
    if (method === "POST" && path === "/requirements") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return createPayerRequirements(JSON.parse(event.body), userPerms);
    }
    if (method === "GET" && path.match(/^\/requirements\/[^\/]+$/)) {
      const payerId = pathParams.payerId || path.split("/")[2];
      return getPayerRequirements(payerId);
    }
    if (method === "PUT" && path.match(/^\/requirements\/[^\/]+$/)) {
      const payerId = pathParams.payerId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updatePayerRequirements(payerId, JSON.parse(event.body), userPerms);
    }
    if (method === "DELETE" && path.match(/^\/requirements\/[^\/]+$/)) {
      const payerId = pathParams.payerId || path.split("/")[2];
      return deletePayerRequirements(payerId, userPerms);
    }
    if (method === "GET" && path === "/email-packet") {
      return generateEmailPacket(queryParams, userPerms, allowedClinics);
    }
    if (method === "GET" && path === "/schema") {
      return httpOk({
        fieldsByCategory: CANONICAL_FIELDS,
        fields: CANONICAL_FIELDS_FLAT,
        documentTypes: Object.keys(DOCUMENT_TYPE_SECTIONS),
        documentSections: DOCUMENT_TYPE_SECTIONS,
        submissionModes: ["PORTAL", "EMAIL", "HYBRID"]
      });
    }
    return httpErr(404, "Not Found");
  } catch (err) {
    console.error("Error in autofill handler:", err);
    return httpErr(500, err.message || "Internal server error");
  }
};
async function getAutofillPayload(queryParams, userPerms, allowedClinics) {
  const { providerId, portal } = queryParams;
  if (!providerId) {
    return httpErr(400, "providerId is required");
  }
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId }
  }));
  if (!provider) {
    return httpErr(404, "Provider not found");
  }
  if (!allowedClinics.has("*")) {
    const hasAccess = provider.clinicIds?.some((cid) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, "No access to this provider");
    }
  }
  const { Items: credentials } = await ddb.send(new QueryCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  const fields = [];
  const providerFields = {
    firstName: { value: provider.name?.split(" ")[0] || "", source: "manual" },
    lastName: { value: provider.name?.split(" ").slice(1).join(" ") || "", source: "manual" },
    npi: { value: provider.npi || "", source: "verified" },
    email: { value: provider.email || "", source: "manual" },
    specialty: { value: provider.specialty || "", source: "manual" }
  };
  for (const [key, { value, source }] of Object.entries(providerFields)) {
    if (value) {
      fields.push({
        schemaKey: key,
        value,
        confidence: source === "verified" ? "high" : "medium",
        source
      });
    }
  }
  for (const cred of credentials || []) {
    const credType = cred.credentialType;
    if (credType === "identity" && cred.data) {
      addCredentialFields(fields, cred.data, ["ssn", "dateOfBirth", "gender"], "verified");
    }
    if (credType === "license" && cred.data) {
      addCredentialFields(fields, cred.data, [
        "stateLicenseNumber",
        "stateLicenseState",
        "stateLicenseExpiry"
      ], "verified");
    }
    if (credType === "education" && cred.data) {
      addCredentialFields(fields, cred.data, [
        "medicalSchool",
        "graduationYear",
        "residencyProgram",
        "residencyYear"
      ], "verified");
    }
    if (credType === "insurance" && cred.data) {
      addCredentialFields(fields, cred.data, [
        "malpracticeInsurer",
        "malpracticePolicyNumber",
        "malpracticeLimit",
        "malpracticeExpiry"
      ], "verified");
    }
  }
  const { Items: documents } = await ddb.send(new QueryCommand({
    TableName: DOCUMENTS_TABLE,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  const autofillDocs = [];
  for (const doc of documents || []) {
    const command = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: doc.s3Key
    });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    autofillDocs.push({
      documentId: doc.documentId,
      documentType: doc.documentType,
      fileName: doc.fileName,
      downloadUrl,
      uploadSection: findUploadSection(doc.documentType)
    });
  }
  let requirements = {
    portal: portal || "generic",
    requiredFields: [],
    requiredDocs: [],
    readiness: "ready",
    missingItems: [],
    conflicts: []
  };
  if (portal) {
    requirements = await checkRequirements(portal, fields, autofillDocs);
  }
  const payload = {
    providerId,
    portal: portal || "generic",
    fields,
    documents: autofillDocs,
    requirements
  };
  return httpOk({ payload });
}
function addCredentialFields(fields, data, keys, source) {
  for (const key of keys) {
    if (data[key]) {
      fields.push({
        schemaKey: key,
        value: String(data[key]),
        confidence: "high",
        source
      });
    }
  }
}
async function checkRequirements(portal, fields, documents) {
  const { Item: requirements } = await ddb.send(new GetCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId: portal }
  }));
  if (!requirements) {
    return {
      portal,
      requiredFields: [],
      requiredDocs: [],
      readiness: "ready",
      missingItems: [],
      conflicts: []
    };
  }
  const missingItems = [];
  const conflicts = [];
  const fieldKeys = new Set(fields.map((f) => f.schemaKey));
  for (const reqField of requirements.requiredFields || []) {
    if (!fieldKeys.has(reqField)) {
      missingItems.push(`Field: ${reqField}`);
    }
  }
  const docTypes = new Set(documents.map((d) => d.documentType));
  for (const reqDoc of requirements.requiredDocs || []) {
    if (!docTypes.has(reqDoc)) {
      missingItems.push(`Document: ${reqDoc}`);
    }
  }
  if (requirements.minMalpracticeLimit) {
    const malpracticeField = fields.find((f) => f.schemaKey === "malpracticeLimit");
    if (malpracticeField) {
      const limit = parseInt(malpracticeField.value.replace(/[^0-9]/g, ""));
      if (limit < requirements.minMalpracticeLimit) {
        conflicts.push({
          field: "malpracticeLimit",
          issue: `Minimum limit is $${requirements.minMalpracticeLimit.toLocaleString()}, current is $${limit.toLocaleString()}`
        });
      }
    }
  }
  const readiness = conflicts.length > 0 ? "conflicts" : missingItems.length > 0 ? "missing" : "ready";
  return {
    portal,
    requiredFields: requirements.requiredFields || [],
    requiredDocs: requirements.requiredDocs || [],
    readiness,
    missingItems,
    conflicts
  };
}
async function getAutofillDocuments(queryParams, userPerms, allowedClinics) {
  const { providerId, portal, documentTypes } = queryParams;
  if (!providerId) {
    return httpErr(400, "providerId is required");
  }
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId }
  }));
  if (!provider) {
    return httpErr(404, "Provider not found");
  }
  if (!allowedClinics.has("*")) {
    const hasAccess = provider.clinicIds?.some((cid) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, "No access to this provider");
    }
  }
  const { Items: documents } = await ddb.send(new QueryCommand({
    TableName: DOCUMENTS_TABLE,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  let filteredDocs = documents || [];
  if (documentTypes) {
    const types = documentTypes.split(",").map((t) => t.trim());
    filteredDocs = filteredDocs.filter((d) => types.includes(d.documentType));
  }
  const autofillDocs = [];
  for (const doc of filteredDocs) {
    const command = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: doc.s3Key
    });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    autofillDocs.push({
      documentId: doc.documentId,
      documentType: doc.documentType,
      fileName: doc.fileName,
      downloadUrl,
      uploadSection: findUploadSection(doc.documentType)
    });
  }
  return httpOk({ documents: autofillDocs });
}
async function logAutofillEvent(body, userPerms, event) {
  const { providerId, portal, action, fieldsChanged, documentsUploaded, confidence } = body;
  if (!providerId || !portal || !action) {
    return httpErr(400, "providerId, portal, and action are required");
  }
  const validActions = ["fill", "upload", "submit_review", "email_generated", "email_sent"];
  if (!validActions.includes(action)) {
    return httpErr(400, `action must be one of: ${validActions.join(", ")}`);
  }
  const submissionMode = action === "email_generated" || action === "email_sent" ? "EMAIL" : body.submissionMode || "PORTAL";
  const auditEntry = {
    auditId: v4_default(),
    userId: userPerms.userId || userPerms.email,
    userEmail: userPerms.email,
    providerId,
    portal,
    submissionMode,
    action,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    fieldsChanged: fieldsChanged || [],
    documentsUploaded: documentsUploaded || [],
    confidence: confidence || 0,
    ipAddress: event.requestContext?.identity?.sourceIp,
    userAgent: event.headers?.["User-Agent"] || event.headers?.["user-agent"]
  };
  await ddb.send(new PutCommand({
    TableName: AUTOFILL_AUDIT_TABLE,
    Item: auditEntry
  }));
  return httpCreated({
    auditId: auditEntry.auditId,
    message: "Autofill event logged successfully"
  });
}
async function listPortalAdapters(queryParams) {
  const { tier, limit = "50", lastKey } = queryParams;
  let params = {
    TableName: PORTAL_ADAPTERS_TABLE,
    Limit: parseInt(limit)
  };
  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }
  if (tier !== void 0) {
    params = {
      ...params,
      IndexName: "byTier",
      KeyConditionExpression: "#tier = :tier",
      ExpressionAttributeNames: { "#tier": "tier" },
      ExpressionAttributeValues: { ":tier": parseInt(tier) }
    };
    const result2 = await ddb.send(new QueryCommand(params));
    return httpOk({
      adapters: result2.Items || [],
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  const result = await ddb.send(new ScanCommand(params));
  return httpOk({
    adapters: result.Items || [],
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}
async function createPortalAdapter(body, userPerms) {
  const { portalId, portalName, tier, match, fieldMap, navigation, uploads, quirks, customCode } = body;
  if (!portalId || !portalName || tier === void 0 || !match) {
    return httpErr(400, "portalId, portalName, tier, and match are required");
  }
  if (!match.hostnames || !Array.isArray(match.hostnames) || match.hostnames.length === 0) {
    return httpErr(400, "match.hostnames must be a non-empty array");
  }
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Key: { portalId }
  }));
  if (existing) {
    return httpErr(400, "A portal adapter with this ID already exists");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const adapter = {
    portalId,
    portalName,
    tier,
    match,
    fieldMap: fieldMap || {},
    navigation,
    uploads,
    quirks,
    customCode,
    createdAt: now,
    updatedAt: now
  };
  await ddb.send(new PutCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Item: adapter
  }));
  return httpCreated({ portalId, message: "Portal adapter created successfully", adapter });
}
async function getPortalAdapter(portalId) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Key: { portalId }
  }));
  if (!Item) {
    return httpErr(404, "Portal adapter not found");
  }
  return httpOk({ adapter: Item });
}
async function updatePortalAdapter(portalId, body, userPerms) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Key: { portalId }
  }));
  if (!existing) {
    return httpErr(404, "Portal adapter not found");
  }
  const updated = {
    ...existing,
    ...body,
    portalId,
    // Ensure portalId cannot be changed
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await ddb.send(new PutCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Item: updated
  }));
  return httpOk({ message: "Portal adapter updated successfully", adapter: updated });
}
async function deletePortalAdapter(portalId, userPerms) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Key: { portalId }
  }));
  if (!existing) {
    return httpErr(404, "Portal adapter not found");
  }
  await ddb.send(new DeleteCommand({
    TableName: PORTAL_ADAPTERS_TABLE,
    Key: { portalId }
  }));
  return httpOk({ message: "Portal adapter deleted successfully" });
}
async function listPayerRequirements(queryParams) {
  const { limit = "50", lastKey } = queryParams;
  const params = {
    TableName: PAYER_REQUIREMENTS_TABLE,
    Limit: parseInt(limit)
  };
  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }
  const result = await ddb.send(new ScanCommand(params));
  return httpOk({
    requirements: result.Items || [],
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}
async function createPayerRequirements(body, userPerms) {
  const { payerId, payerName, requiredFields, requiredDocs, minMalpracticeLimit, licenseStateRules, recredentialingCadence, specialRequirements } = body;
  if (!payerId || !payerName) {
    return httpErr(400, "payerId and payerName are required");
  }
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId }
  }));
  if (existing) {
    return httpErr(400, "Payer requirements for this ID already exist");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const requirements = {
    payerId,
    payerName,
    submissionMode: body.submissionMode || "PORTAL",
    portalUrl: body.portalUrl,
    submissionEmail: body.submissionEmail,
    faxNumber: body.faxNumber,
    submissionInstructions: body.submissionInstructions,
    requiredFields: requiredFields || [],
    requiredDocs: requiredDocs || [],
    minMalpracticeLimit,
    premisesLiabilityRequired: body.premisesLiabilityRequired,
    premisesLiabilityMinimum: body.premisesLiabilityMinimum,
    licenseStateRules,
    recredentialingCadence,
    specialRequirements,
    emailSubjectTemplate: body.emailSubjectTemplate,
    emailBodyTemplate: body.emailBodyTemplate,
    createdAt: now,
    updatedAt: now
  };
  await ddb.send(new PutCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Item: requirements
  }));
  return httpCreated({ payerId, message: "Payer requirements created successfully", requirements });
}
async function getPayerRequirements(payerId) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId }
  }));
  if (!Item) {
    return httpErr(404, "Payer requirements not found");
  }
  return httpOk({ requirements: Item });
}
async function updatePayerRequirements(payerId, body, userPerms) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId }
  }));
  if (!existing) {
    return httpErr(404, "Payer requirements not found");
  }
  const updated = {
    ...existing,
    ...body,
    payerId,
    // Ensure payerId cannot be changed
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await ddb.send(new PutCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Item: updated
  }));
  return httpOk({ message: "Payer requirements updated successfully", requirements: updated });
}
async function deletePayerRequirements(payerId, userPerms) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId }
  }));
  if (!existing) {
    return httpErr(404, "Payer requirements not found");
  }
  await ddb.send(new DeleteCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId }
  }));
  return httpOk({ message: "Payer requirements deleted successfully" });
}
async function generateEmailPacket(queryParams, userPerms, allowedClinics) {
  const { providerId, payerId } = queryParams;
  if (!providerId || !payerId) {
    return httpErr(400, "providerId and payerId are required");
  }
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId }
  }));
  if (!provider) {
    return httpErr(404, "Provider not found");
  }
  if (!allowedClinics.has("*")) {
    const hasAccess = provider.clinicIds?.some((cid) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, "No access to this provider");
    }
  }
  const { Item: payerReqs } = await ddb.send(new GetCommand({
    TableName: PAYER_REQUIREMENTS_TABLE,
    Key: { payerId }
  }));
  const { Items: documents } = await ddb.send(new QueryCommand({
    TableName: DOCUMENTS_TABLE,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  const providerName = provider.name || `${provider.firstName || ""} ${provider.lastName || ""}`.trim();
  let subject;
  if (payerReqs?.emailSubjectTemplate) {
    subject = payerReqs.emailSubjectTemplate.replace("{{providerName}}", providerName).replace("{{npi}}", provider.npi || "N/A").replace("{{payerName}}", payerReqs.payerName || payerId);
  } else {
    subject = `Credentialing Application \u2013 ${providerName}, NPI ${provider.npi || "N/A"}`;
  }
  let body;
  if (payerReqs?.emailBodyTemplate) {
    body = payerReqs.emailBodyTemplate.replace("{{providerName}}", providerName).replace("{{npi}}", provider.npi || "N/A").replace("{{payerName}}", payerReqs.payerName || payerId);
  } else {
    body = buildDefaultEmailBody(providerName, provider.npi, payerReqs?.payerName || payerId);
  }
  const requiredDocs = payerReqs?.requiredDocs || [];
  const attachments = [];
  const missingDocs = [];
  const docsByType = {};
  for (const doc of documents || []) {
    docsByType[doc.documentType] = doc;
  }
  for (const reqDoc of requiredDocs) {
    const doc = docsByType[reqDoc];
    if (doc) {
      const command = new GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: doc.s3Key
      });
      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      attachments.push({
        documentType: reqDoc,
        fileName: doc.fileName,
        downloadUrl
      });
    } else {
      missingDocs.push(reqDoc);
    }
  }
  for (const doc of documents || []) {
    if (!requiredDocs.includes(doc.documentType)) {
      const command = new GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: doc.s3Key
      });
      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      attachments.push({
        documentType: doc.documentType,
        fileName: doc.fileName,
        downloadUrl
      });
    }
  }
  const missingFields = [];
  const requiredFields = payerReqs?.requiredFields || [];
  for (const field of requiredFields) {
    if (!provider[field] && field !== "npi") {
      missingFields.push(field);
    }
  }
  const readiness = missingDocs.length > 0 ? "missing_docs" : missingFields.length > 0 ? "missing_fields" : "ready";
  const packet = {
    providerId,
    payerId,
    subject,
    body,
    attachments,
    readiness,
    missingItems: [...missingDocs.map((d) => `Document: ${d}`), ...missingFields.map((f) => `Field: ${f}`)]
  };
  return httpOk({
    packet,
    payerInfo: {
      payerName: payerReqs?.payerName || payerId,
      submissionMode: payerReqs?.submissionMode || "EMAIL",
      submissionEmail: payerReqs?.submissionEmail,
      submissionInstructions: payerReqs?.submissionInstructions
    }
  });
}
function buildDefaultEmailBody(providerName, npi, payerName) {
  return `Dear ${payerName} Credentialing Team,

Please find attached the completed credentialing application and supporting documents for ${providerName}.

Provider Details:
- Name: ${providerName}
- NPI: ${npi || "N/A"}

Attachments included with this submission are listed in the email attachments.

Please let us know if any additional information is required.

Thank you,
${providerName}`;
}
export {
  handler
};
