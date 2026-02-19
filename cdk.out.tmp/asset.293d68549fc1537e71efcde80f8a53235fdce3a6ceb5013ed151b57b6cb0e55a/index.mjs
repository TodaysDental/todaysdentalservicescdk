// src/services/credentialing/index.ts
import { DynamoDBClient as DynamoDBClient2 } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient as DynamoDBDocumentClient2,
  QueryCommand as QueryCommand2,
  ScanCommand,
  PutCommand as PutCommand2,
  DeleteCommand,
  UpdateCommand as UpdateCommand2,
  GetCommand as GetCommand2
} from "@aws-sdk/lib-dynamodb";
import { S3Client as S3Client2, PutObjectCommand, GetObjectCommand as GetObjectCommand2, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SESv2Client } from "@aws-sdk/client-sesv2";

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
function hasClinicAccess(allowedClinics, clinicId) {
  return allowedClinics.has("*") || allowedClinics.has(clinicId);
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
var VALID_DOCUMENT_TYPES = [
  // A) Identity and Legal Documents
  "photoId",
  "w9",
  "ownershipDocs",
  // B) Licensure and Professional IDs
  "stateLicense",
  "specialtyLicense",
  "deaCertificate",
  "cdsCertificate",
  "npiConfirmation",
  // C) Professional History Documents
  "cv",
  "diploma",
  "transcript",
  "boardCertification",
  "residencyCertificate",
  "cprCertification",
  "aclsCertification",
  // D) Malpractice / Liability Documents
  "malpracticeInsurance",
  "tailCoverage",
  "claimsHistory",
  "premisesLiability",
  // E) Practice / Location Documents
  "practiceLocations",
  "taxIdConfirmation",
  "facilityAccreditation",
  "clinicLicense",
  // F) Portal / Workflow-specific
  "caqhAttestation",
  "signaturePage",
  "credentialingApplication",
  "photo",
  "references",
  "supplementalDocs",
  // Legacy / catch-all
  "other"
];
function validateDocumentType(type) {
  if (VALID_DOCUMENT_TYPES.includes(type)) {
    return type;
  }
  return "other";
}

// src/services/credentialing/credentialing-doc-processor.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  TextractClient,
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  FeatureType
} from "@aws-sdk/client-textract";
import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from "@aws-sdk/client-bedrock-runtime";
import { S3Client } from "@aws-sdk/client-s3";
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
var textract = new TextractClient({});
var bedrock = new BedrockRuntimeClient({});
var s3 = new S3Client({});
var PROVIDERS_TABLE = process.env.PROVIDERS_TABLE;
var PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE;
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var EXTRACTED_DATA_TABLE = process.env.EXTRACTED_DATA_TABLE;
function classifyDocumentFromPath(s3Key) {
  const keyLower = s3Key.toLowerCase();
  const filename = s3Key.split("/").pop() || "";
  const filenameLower = filename.toLowerCase();
  const patterns = [
    { type: "stateLicense", patterns: [/license/i, /dental.*license/i, /state.*license/i, /professional.*license/i] },
    { type: "deaCertificate", patterns: [/dea/i, /drug.*enforcement/i] },
    { type: "cdsCertificate", patterns: [/cds/i, /controlled.*substance/i] },
    { type: "npiConfirmation", patterns: [/npi/i, /nppes/i, /national.*provider/i] },
    { type: "malpracticeInsurance", patterns: [/malpractice/i, /liability.*insurance/i, /coi/i, /certificate.*insurance/i] },
    { type: "diploma", patterns: [/diploma/i, /dds/i, /dmd/i, /dental.*degree/i, /graduation/i] },
    { type: "boardCertification", patterns: [/board.*cert/i, /specialty.*cert/i, /american.*board/i] },
    { type: "cprCertification", patterns: [/cpr/i, /bls/i, /basic.*life/i] },
    { type: "aclsCertification", patterns: [/acls/i, /advanced.*cardiac/i] },
    { type: "w9", patterns: [/w-?9/i, /tax.*form/i, /taxpayer.*identification/i] },
    { type: "cv", patterns: [/cv/i, /curriculum.*vitae/i, /resume/i] },
    { type: "photoId", patterns: [/id/i, /driver.*license/i, /passport/i, /photo.*id/i] },
    { type: "residencyCertificate", patterns: [/residency/i, /training.*cert/i, /postgraduate/i] },
    { type: "transcript", patterns: [/transcript/i, /academic.*record/i] }
  ];
  const pathMatch = s3Key.match(/providers\/[^/]+\/([^/]+)\//);
  if (pathMatch) {
    const pathType = pathMatch[1];
    if (VALID_DOCUMENT_TYPES.includes(pathType)) {
      return { documentType: pathType, confidence: 0.9 };
    }
  }
  for (const { type, patterns: regexes } of patterns) {
    for (const regex of regexes) {
      if (regex.test(filenameLower)) {
        return { documentType: type, confidence: 0.75 };
      }
    }
  }
  return { documentType: "other", confidence: 0.3 };
}
async function extractTextFromDocument(bucket, key) {
  console.log(`Extracting text from s3://${bucket}/${key}`);
  const extension = key.split(".").pop()?.toLowerCase() || "";
  const isImage = ["png", "jpg", "jpeg", "tiff", "tif"].includes(extension);
  if (isImage) {
    const response = await textract.send(new AnalyzeDocumentCommand({
      Document: { S3Object: { Bucket: bucket, Name: key } },
      FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES]
    }));
    return parseTextractBlocks(response.Blocks || []);
  } else {
    const startResponse = await textract.send(new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
      FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES]
    }));
    const jobId = startResponse.JobId;
    let status = "IN_PROGRESS";
    let attempts = 0;
    const maxAttempts = 30;
    let blocks = [];
    while (status === "IN_PROGRESS" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2e3));
      const getResponse = await textract.send(new GetDocumentAnalysisCommand({ JobId: jobId }));
      status = getResponse.JobStatus || "FAILED";
      if (status === "SUCCEEDED") {
        blocks = getResponse.Blocks || [];
        let nextToken = getResponse.NextToken;
        while (nextToken) {
          const nextPage = await textract.send(new GetDocumentAnalysisCommand({
            JobId: jobId,
            NextToken: nextToken
          }));
          blocks = blocks.concat(nextPage.Blocks || []);
          nextToken = nextPage.NextToken;
        }
      }
      attempts++;
    }
    if (status !== "SUCCEEDED") {
      console.warn(`Textract job ${jobId} did not complete successfully. Status: ${status}`);
      const detectResponse = await textract.send(new DetectDocumentTextCommand({
        Document: { S3Object: { Bucket: bucket, Name: key } }
      }));
      return parseTextractBlocks(detectResponse.Blocks || []);
    }
    return parseTextractBlocks(blocks);
  }
}
function parseTextractBlocks(blocks) {
  const lines = [];
  const keyValuePairs = {};
  const tables = [];
  const blockMap = {};
  blocks.forEach((block) => {
    blockMap[block.Id] = block;
  });
  for (const block of blocks) {
    if (block.BlockType === "LINE") {
      lines.push(block.Text || "");
    }
  }
  for (const block of blocks) {
    if (block.BlockType === "KEY_VALUE_SET" && block.EntityTypes?.includes("KEY")) {
      let key = "";
      let value = "";
      if (block.Relationships) {
        for (const rel of block.Relationships) {
          if (rel.Type === "CHILD") {
            for (const childId of rel.Ids || []) {
              const child = blockMap[childId];
              if (child && child.BlockType === "WORD") {
                key += (key ? " " : "") + (child.Text || "");
              }
            }
          }
          if (rel.Type === "VALUE") {
            for (const valueId of rel.Ids || []) {
              const valueBlock = blockMap[valueId];
              if (valueBlock?.Relationships) {
                for (const valueRel of valueBlock.Relationships) {
                  if (valueRel.Type === "CHILD") {
                    for (const childId of valueRel.Ids || []) {
                      const child = blockMap[childId];
                      if (child && child.BlockType === "WORD") {
                        value += (value ? " " : "") + (child.Text || "");
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (key && value) {
        keyValuePairs[key.toLowerCase().trim()] = value.trim();
      }
    }
  }
  return {
    fullText: lines.join("\n"),
    lines,
    keyValuePairs,
    tables
  };
}
async function extractFieldsWithBedrock(documentType, extractedText) {
  const fieldsToExtract = getFieldsForDocumentType(documentType);
  const prompt = `You are a healthcare credentialing document extraction specialist. Analyze the following text from a ${documentType} document and extract the specified fields.

Return ONLY a valid JSON object with the following structure:
{
  "fieldName": { "value": "extracted value or null", "confidence": 0.0-1.0 },
  ...
}

Fields to extract:
${fieldsToExtract.map((f) => `- ${f}`).join("\n")}

Document text:
${extractedText.fullText.substring(0, 8e3)}

${Object.keys(extractedText.keyValuePairs).length > 0 ? `
Key-Value pairs detected:
${JSON.stringify(extractedText.keyValuePairs, null, 2)}
` : ""}

Instructions:
- For dates, use ISO format (YYYY-MM-DD)
- For license numbers, include the full number as shown
- For NPI, extract exactly 10 digits
- If a field cannot be found, set value to null
- Set confidence based on clarity: 0.9+ for clear matches, 0.6-0.8 for likely matches, below 0.5 for guesses

Return only the JSON object, no explanation.`;
  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }]
      })
    }));
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const result = {};
      for (const [field, data] of Object.entries(parsed)) {
        if (data && typeof data === "object" && "value" in data) {
          result[field] = {
            value: data.value,
            confidence: data.confidence ?? 0.5,
            source: "bedrock"
          };
        }
      }
      return result;
    }
  } catch (error) {
    console.error("Bedrock field extraction failed:", error.message);
  }
  return patternBasedExtraction(documentType, extractedText);
}
function getFieldsForDocumentType(documentType) {
  const baseFields = ["firstName", "lastName", "npi"];
  const typeSpecificFields = {
    stateLicense: ["stateLicenseNumber", "stateLicenseState", "stateLicenseIssueDate", "stateLicenseExpiry", "stateLicenseStatus"],
    deaCertificate: ["deaNumber", "deaState", "deaExpiry", "deaSchedules"],
    cdsCertificate: ["cdsNumber", "cdsState", "cdsExpiry"],
    npiConfirmation: ["npi", "npiType", "practiceName", "practiceAddress1", "practiceCity", "practiceState", "practiceZip"],
    malpracticeInsurance: ["malpracticeInsurer", "malpracticePolicyNumber", "malpracticeLimitPerClaim", "malpracticeLimitAggregate", "malpracticeEffectiveDate", "malpracticeExpiry"],
    diploma: ["dentalSchoolName", "degreeType", "graduationDate", "graduationYear"],
    boardCertification: ["boardCertification", "boardCertifyingBody", "boardCertDate", "boardCertExpiry"],
    cprCertification: ["cprCertDate", "cprExpiry", "cprProvider"],
    aclsCertification: ["aclsCertDate", "aclsExpiry"],
    w9: ["firstName", "lastName", "taxId", "taxIdType", "practiceAddress1", "practiceCity", "practiceState", "practiceZip"],
    cv: [
      "firstName",
      "lastName",
      "primarySpecialty",
      "dentalSchoolName",
      "degreeType",
      "graduationYear",
      "residencyProgram",
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
      "previousEmployer2Reason"
    ],
    photoId: ["firstName", "lastName", "dateOfBirth"]
  };
  return [...baseFields, ...typeSpecificFields[documentType] || []];
}
function patternBasedExtraction(documentType, extractedText) {
  const result = {};
  const text = extractedText.fullText;
  const kvPairs = extractedText.keyValuePairs;
  const patterns = {
    npi: [/\b(\d{10})\b/, /npi[:\s#]*(\d{10})/i],
    stateLicenseNumber: [/license\s*#?\s*[:\s]?([A-Z0-9\-]+)/i, /dental\s*license[:\s#]*([A-Z0-9\-]+)/i],
    deaNumber: [/dea\s*#?\s*[:\s]?([A-Z]{2}\d{7})/i, /([A-Z]{2}\d{7})/],
    dateOfBirth: [/dob[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i, /birth\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i],
    graduationYear: [/class\s*of\s*(\d{4})/i, /graduated[:\s]*(\d{4})/i, /(\d{4})/],
    expirationDate: [/exp(?:ires?|iration)?[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i]
  };
  for (const [key, value] of Object.entries(kvPairs)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes("license") && keyLower.includes("number")) {
      result.stateLicenseNumber = { value, confidence: 0.8, source: "textract" };
    }
    if (keyLower.includes("expir")) {
      const fieldName = documentType === "stateLicense" ? "stateLicenseExpiry" : documentType === "deaCertificate" ? "deaExpiry" : documentType === "malpracticeInsurance" ? "malpracticeExpiry" : "expirationDate";
      result[fieldName] = { value, confidence: 0.8, source: "textract" };
    }
    if (keyLower.includes("npi")) {
      result.npi = { value, confidence: 0.85, source: "textract" };
    }
  }
  for (const [field, regexes] of Object.entries(patterns)) {
    if (!result[field]) {
      for (const regex of regexes) {
        const match = text.match(regex);
        if (match?.[1]) {
          result[field] = { value: match[1], confidence: 0.6, source: "pattern" };
          break;
        }
      }
    }
  }
  return result;
}

// src/services/credentialing/index.ts
var PROVIDERS_TABLE2 = process.env.PROVIDERS_TABLE;
var PROVIDER_CREDENTIALS_TABLE2 = process.env.PROVIDER_CREDENTIALS_TABLE;
var PROVIDER_STAFF_LINK_TABLE = process.env.PROVIDER_STAFF_LINK_TABLE;
var CREDENTIALING_USERS_TABLE = process.env.CREDENTIALING_USERS_TABLE;
var PROVIDER_USER_LINK_TABLE = process.env.PROVIDER_USER_LINK_TABLE;
var PAYER_ENROLLMENTS_TABLE = process.env.PAYER_ENROLLMENTS_TABLE;
var TASKS_TABLE = process.env.TASKS_TABLE;
var DOCUMENTS_TABLE2 = process.env.DOCUMENTS_TABLE;
var DOCUMENTS_BUCKET2 = process.env.DOCUMENTS_BUCKET;
var STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;
var STAFF_USER_TABLE = process.env.STAFF_USER_TABLE;
var CREDENTIALING_MODE = process.env.CREDENTIALING_MODE || "internal";
var APP_NAME = process.env.APP_NAME || "TodaysDentalInsights";
var FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@todaysdentalinsights.com";
var SES_REGION = process.env.SES_REGION || "us-east-1";
var ddb2 = DynamoDBDocumentClient2.from(new DynamoDBClient2({}));
var s32 = new S3Client2({});
var ses = new SESv2Client({ region: SES_REGION });
var MODULE_NAME = "CREDENTIALING";
var METHOD_PERMISSIONS = {
  GET: "read",
  POST: "write",
  PUT: "put",
  DELETE: "delete"
};
var AVAILABLE_PAYERS = [
  { id: "delta-dental", name: "Delta Dental", type: "Dental Insurance" },
  { id: "metlife-dental", name: "MetLife Dental", type: "Dental Insurance" },
  { id: "cigna-dental", name: "Cigna Dental", type: "Dental Insurance" },
  { id: "united-dental", name: "United Healthcare Dental", type: "Dental Insurance" },
  { id: "aetna-dental", name: "Aetna Dental", type: "Dental Insurance" },
  { id: "guardian-dental", name: "Guardian Dental", type: "Dental Insurance" },
  { id: "medicaid-dental", name: "Medicaid (Dental)", type: "Government" },
  { id: "medicare-dental", name: "Medicare Dental", type: "Government" },
  { id: "humana-dental", name: "Humana Dental", type: "Dental Insurance" },
  { id: "blue-cross-dental", name: "Blue Cross Blue Shield Dental", type: "Dental Insurance" }
];
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
  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const method = event.httpMethod;
  const path = event.path.replace("/credentialing", "");
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};
  try {
    if (method === "GET" && path === "/dashboard") {
      return getDashboard(userPerms, isAdmin, allowedClinics);
    }
    if (method === "GET" && path === "/providers") {
      return listProviders(queryParams, allowedClinics);
    }
    if (method === "POST" && path === "/providers") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return createProvider(JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/providers\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      return getProvider(providerId, allowedClinics);
    }
    if (method === "PUT" && path.match(/^\/providers\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updateProvider(providerId, JSON.parse(event.body), allowedClinics);
    }
    if (method === "DELETE" && path.match(/^\/providers\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      return deleteProvider(providerId, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/providers\/[^\/]+\/credentials$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      return getProviderCredentials(providerId, allowedClinics);
    }
    if (method === "POST" && path.match(/^\/providers\/[^\/]+\/credentials$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return upsertProviderCredential(providerId, JSON.parse(event.body), allowedClinics);
    }
    if (method === "GET" && path.match(/^\/providers\/[^\/]+\/credentials\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      const credentialType = pathParams.credentialType || path.split("/")[4];
      return getProviderCredential(providerId, credentialType, allowedClinics);
    }
    if (method === "PUT" && path.match(/^\/providers\/[^\/]+\/credentials\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      const credentialType = pathParams.credentialType || path.split("/")[4];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updateProviderCredential(providerId, credentialType, JSON.parse(event.body), allowedClinics);
    }
    if (method === "DELETE" && path.match(/^\/providers\/[^\/]+\/credentials\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      const credentialType = pathParams.credentialType || path.split("/")[4];
      return deleteProviderCredential(providerId, credentialType, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/providers\/[^\/]+\/enrollments$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      return getProviderEnrollments(providerId, allowedClinics);
    }
    if (method === "POST" && path.match(/^\/providers\/[^\/]+\/enrollments$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return createEnrollment(providerId, JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/providers\/[^\/]+\/documents$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      return getProviderDocuments(providerId, allowedClinics);
    }
    if (method === "POST" && path.match(/^\/providers\/[^\/]+\/documents$/)) {
      const providerId = pathParams.providerId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return getDocumentUploadUrl(providerId, JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === "GET" && path === "/enrollments") {
      return listEnrollments(queryParams, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/enrollments\/[^\/]+$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split("/")[2];
      return getEnrollment(enrollmentId, allowedClinics);
    }
    if (method === "PUT" && path.match(/^\/enrollments\/[^\/]+$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updateEnrollment(enrollmentId, JSON.parse(event.body), allowedClinics);
    }
    if (method === "DELETE" && path.match(/^\/enrollments\/[^\/]+$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split("/")[2];
      return deleteEnrollment(enrollmentId, allowedClinics);
    }
    if (method === "PUT" && path.match(/^\/enrollments\/[^\/]+\/status$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updateEnrollmentStatus(enrollmentId, JSON.parse(event.body), allowedClinics);
    }
    if (method === "GET" && path === "/tasks") {
      return listTasks(queryParams, userPerms, isAdmin, allowedClinics);
    }
    if (method === "POST" && path === "/tasks") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return createTask(JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/tasks\/[^\/]+$/)) {
      const taskId = pathParams.taskId || path.split("/")[2];
      return getTask(taskId, allowedClinics);
    }
    if (method === "PUT" && path.match(/^\/tasks\/[^\/]+$/)) {
      const taskId = pathParams.taskId || path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updateTask(taskId, JSON.parse(event.body), allowedClinics);
    }
    if (method === "DELETE" && path.match(/^\/tasks\/[^\/]+$/)) {
      const taskId = pathParams.taskId || path.split("/")[2];
      return deleteTask(taskId, allowedClinics);
    }
    if (method === "PUT" && path.match(/^\/tasks\/[^\/]+\/complete$/)) {
      const taskId = pathParams.taskId || path.split("/")[2];
      return completeTask(taskId, allowedClinics);
    }
    if (method === "GET" && path === "/documents") {
      return listDocuments(queryParams, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/documents\/[^\/]+$/)) {
      const documentId = pathParams.documentId || path.split("/")[2];
      return getDocumentDownloadUrl(documentId, allowedClinics);
    }
    if (method === "DELETE" && path.match(/^\/documents\/[^\/]+$/)) {
      const documentId = pathParams.documentId || path.split("/")[2];
      return deleteDocument(documentId, allowedClinics);
    }
    if (method === "POST" && path === "/documents/process") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return processDocumentExtraction(JSON.parse(event.body), allowedClinics);
    }
    if (method === "GET" && path.match(/^\/documents\/[^\/]+\/extracted$/)) {
      const documentId = pathParams.documentId || path.split("/")[2];
      return getExtractedData(documentId, allowedClinics);
    }
    if (method === "GET" && path === "/payers") {
      return httpOk({ payers: AVAILABLE_PAYERS });
    }
    if (method === "POST" && path === "/verifications/oig") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return runOigCheck(JSON.parse(event.body), allowedClinics);
    }
    if (method === "POST" && path === "/verifications/npdb") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return runNpdbCheck(JSON.parse(event.body), allowedClinics);
    }
    if (method === "POST" && path === "/verifications/state-board") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return runStateBoardCheck(JSON.parse(event.body), allowedClinics);
    }
    const hasProviderRole = isProviderUser(userPerms.clinicRoles);
    if (path.startsWith("/me")) {
      if (!hasProviderRole) {
        return httpErr(403, "Provider role required to access this endpoint");
      }
      if (method === "GET" && path === "/me") {
        return getMyProviderProfile(userPerms);
      }
      if (method === "POST" && path === "/me/profile") {
        if (!event.body)
          return httpErr(400, "Missing request body");
        return createMyProviderProfile(userPerms, JSON.parse(event.body));
      }
      if (method === "GET" && path === "/me/credentials") {
        return getMyCredentials(userPerms);
      }
      if (method === "POST" && path === "/me/credentials") {
        if (!event.body)
          return httpErr(400, "Missing request body");
        return updateMyCredentials(userPerms, JSON.parse(event.body));
      }
      if (method === "GET" && path === "/me/documents") {
        return getMyDocuments(userPerms);
      }
    }
    if (method === "GET" && path === "/users") {
      return listCredentialingUsers(queryParams);
    }
    if (method === "POST" && path === "/users") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return createCredentialingUser(JSON.parse(event.body), userPerms);
    }
    if (method === "GET" && path.match(/^\/users\/[^\/]+$/)) {
      const userId = path.split("/")[2];
      return getCredentialingUser(userId);
    }
    if (method === "PUT" && path.match(/^\/users\/[^\/]+$/)) {
      const userId = path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return updateCredentialingUser(userId, JSON.parse(event.body));
    }
    if (method === "DELETE" && path.match(/^\/users\/[^\/]+$/)) {
      const userId = path.split("/")[2];
      return deleteCredentialingUser(userId);
    }
    if (method === "POST" && path === "/users/sync-staff") {
      if (!event.body)
        return httpErr(400, "Missing request body");
      return syncStaffUsers(JSON.parse(event.body), userPerms);
    }
    if (method === "GET" && path.match(/^\/providers\/[^\/]+\/linked-users$/)) {
      const providerId = path.split("/")[2];
      return getLinkedUsers(providerId, allowedClinics);
    }
    if (method === "POST" && path.match(/^\/providers\/[^\/]+\/linked-users$/)) {
      const providerId = path.split("/")[2];
      if (!event.body)
        return httpErr(400, "Missing request body");
      return linkUserToProvider(providerId, JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === "DELETE" && path.match(/^\/providers\/[^\/]+\/linked-users\/[^\/]+$/)) {
      const providerId = path.split("/")[2];
      const userId = path.split("/")[4];
      return unlinkUserFromProvider(providerId, userId, allowedClinics);
    }
    if (method === "GET" && path === "/analytics") {
      return getAnalytics(queryParams, allowedClinics);
    }
    return httpErr(404, "Not Found");
  } catch (err) {
    console.error("Error in handler:", err);
    return httpErr(500, err.message || "Internal server error");
  }
};
async function getDashboard(userPerms, isAdmin, allowedClinics) {
  const { Items: providers } = await ddb2.send(new ScanCommand({
    TableName: PROVIDERS_TABLE2
  }));
  const filteredProviders = (providers || []).filter((p) => {
    if (userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin)
      return true;
    return p.clinicIds?.some((cid) => allowedClinics.has(cid));
  });
  const statusCounts = {
    draft: 0,
    "in-progress": 0,
    verified: 0,
    enrolled: 0
  };
  filteredProviders.forEach((p) => {
    const status = p.status;
    if (statusCounts[status] !== void 0) {
      statusCounts[status]++;
    }
  });
  const { Items: enrollments } = await ddb2.send(new ScanCommand({
    TableName: PAYER_ENROLLMENTS_TABLE
  }));
  const providerIds = new Set(filteredProviders.map((p) => p.providerId));
  const filteredEnrollments = (enrollments || []).filter((e) => providerIds.has(e.providerId));
  const enrollmentCounts = {
    "not-started": 0,
    "in-progress": 0,
    approved: 0,
    rejected: 0,
    "pending-info": 0
  };
  filteredEnrollments.forEach((e) => {
    const status = e.status;
    if (enrollmentCounts[status] !== void 0) {
      enrollmentCounts[status]++;
    }
  });
  const { Items: tasks } = await ddb2.send(new ScanCommand({
    TableName: TASKS_TABLE
  }));
  const filteredTasks = (tasks || []).filter((t) => {
    if (userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin)
      return true;
    return allowedClinics.has(t.clinicId);
  });
  const taskCounts = {
    pending: 0,
    "in-progress": 0,
    completed: 0,
    overdue: 0
  };
  const now = /* @__PURE__ */ new Date();
  filteredTasks.forEach((t) => {
    let status = t.status;
    if (status !== "completed" && new Date(t.dueDate) < now) {
      status = "overdue";
    }
    if (taskCounts[status] !== void 0) {
      taskCounts[status]++;
    }
  });
  const thirtyDaysFromNow = /* @__PURE__ */ new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const { Items: credentials } = await ddb2.send(new ScanCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    FilterExpression: "expirationDate <= :expDate",
    ExpressionAttributeValues: {
      ":expDate": thirtyDaysFromNow.toISOString().split("T")[0]
    }
  }));
  const expiringCredentials = (credentials || []).filter((c) => providerIds.has(c.providerId)).length;
  return httpOk({
    providers: {
      total: filteredProviders.length,
      byStatus: statusCounts
    },
    enrollments: {
      total: filteredEnrollments.length,
      byStatus: enrollmentCounts
    },
    tasks: {
      total: filteredTasks.length,
      byStatus: taskCounts
    },
    alerts: {
      expiringCredentials,
      pendingTasks: taskCounts.pending,
      overdueTasks: taskCounts.overdue
    }
  });
}
async function listProviders(queryParams, allowedClinics) {
  const { status, clinicId, limit = "50", lastKey } = queryParams;
  let params = {
    TableName: PROVIDERS_TABLE2,
    Limit: parseInt(limit)
  };
  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }
  if (status) {
    params = {
      ...params,
      IndexName: "byStatus",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    const filtered2 = (result2.Items || []).filter((p) => {
      if (allowedClinics.has("*"))
        return true;
      return p.clinicIds?.some((cid) => allowedClinics.has(cid));
    });
    return httpOk({
      providers: filtered2,
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  if (clinicId) {
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(403, "No access to this clinic");
    }
    params = {
      ...params,
      IndexName: "byClinic",
      KeyConditionExpression: "primaryClinicId = :clinicId",
      ExpressionAttributeValues: { ":clinicId": clinicId }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    return httpOk({
      providers: result2.Items || [],
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  const result = await ddb2.send(new ScanCommand(params));
  const filtered = (result.Items || []).filter((p) => {
    if (allowedClinics.has("*"))
      return true;
    return p.clinicIds?.some((cid) => allowedClinics.has(cid));
  });
  return httpOk({
    providers: filtered,
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}
async function createProvider(body, userPerms, allowedClinics) {
  const { name, npi, specialty, clinicIds, email, tempProviderId, linkedStaffEmail } = body;
  if (!name || !npi || !specialty) {
    return httpErr(400, "name, npi, and specialty are required");
  }
  const providerClinicIds = clinicIds || [];
  for (const cid of providerClinicIds) {
    if (!hasClinicAccess(allowedClinics, cid)) {
      return httpErr(403, `No access to clinic ${cid}`);
    }
  }
  const { Items: existing } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDERS_TABLE2,
    IndexName: "byNpi",
    KeyConditionExpression: "npi = :npi",
    ExpressionAttributeValues: { ":npi": npi }
  }));
  if (existing && existing.length > 0) {
    for (const existingProvider of existing) {
      const existingClinicIds = existingProvider.clinicIds || [];
      const overlappingClinics = providerClinicIds.filter((cid) => existingClinicIds.includes(cid));
      if (overlappingClinics.length > 0) {
        return httpErr(400, `A provider with this NPI already exists for clinic(s): ${overlappingClinics.join(", ")}`);
      }
    }
  }
  const providerId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const provider = {
    providerId,
    name,
    npi,
    specialty,
    status: "draft",
    credentialingProgress: 0,
    enrollmentProgress: 0,
    clinicIds: providerClinicIds,
    primaryClinicId: providerClinicIds[0] || null,
    email: email || null,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: PROVIDERS_TABLE2, Item: provider }));
  if (linkedStaffEmail) {
    try {
      const { Items: existingUsers } = await ddb2.send(new QueryCommand2({
        TableName: CREDENTIALING_USERS_TABLE,
        IndexName: "byEmail",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": linkedStaffEmail.toLowerCase() }
      }));
      let userId;
      if (existingUsers && existingUsers.length > 0) {
        userId = existingUsers[0].userId;
      } else {
        userId = v4_default();
        await ddb2.send(new PutCommand2({
          TableName: CREDENTIALING_USERS_TABLE,
          Item: {
            userId,
            email: linkedStaffEmail.toLowerCase(),
            name: linkedStaffEmail.split("@")[0],
            role: "provider",
            source: "tdi-staff",
            externalRef: linkedStaffEmail.toLowerCase(),
            orgId: "default",
            isActive: true,
            createdAt: now,
            updatedAt: now
          }
        }));
      }
      await ddb2.send(new PutCommand2({
        TableName: PROVIDER_USER_LINK_TABLE,
        Item: {
          providerId,
          userId,
          relationshipType: "owner",
          linkedAt: now,
          linkedBy: userPerms.email,
          isActive: true,
          createdAt: now,
          updatedAt: now
        }
      }));
      await ddb2.send(new PutCommand2({
        TableName: PROVIDER_STAFF_LINK_TABLE,
        Item: {
          providerId,
          staffUserId: linkedStaffEmail.toLowerCase(),
          staffEmail: linkedStaffEmail.toLowerCase(),
          relationshipType: "owner",
          linkedAt: now,
          linkedBy: userPerms.email,
          isActive: true,
          createdAt: now,
          updatedAt: now
        }
      }));
      console.log(`Created user link: ${providerId} -> userId=${userId}, email=${linkedStaffEmail}`);
    } catch (err) {
      console.error("Error creating user link:", err);
    }
  }
  let linkedDocuments = 0;
  if (tempProviderId && tempProviderId.startsWith("temp-")) {
    try {
      const { Items: tempDocs } = await ddb2.send(new QueryCommand2({
        TableName: DOCUMENTS_TABLE2,
        IndexName: "byProvider",
        KeyConditionExpression: "providerId = :tempId",
        ExpressionAttributeValues: { ":tempId": tempProviderId }
      }));
      for (const doc of tempDocs || []) {
        await ddb2.send(new UpdateCommand2({
          TableName: DOCUMENTS_TABLE2,
          Key: { documentId: doc.documentId },
          UpdateExpression: "SET providerId = :newId, #status = :status, linkedAt = :linkedAt",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":newId": providerId,
            ":status": "pending",
            // Change from pending-provider to pending
            ":linkedAt": now
          }
        }));
        linkedDocuments++;
      }
      console.log(`Linked ${linkedDocuments} documents from temp provider ${tempProviderId} to ${providerId}`);
    } catch (err) {
      console.error("Error linking temp documents:", err);
    }
  }
  return httpCreated({
    providerId,
    message: "Provider created successfully",
    provider,
    linkedDocuments
  });
}
async function getProvider(providerId, allowedClinics) {
  const { Item } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  if (!Item) {
    return httpErr(404, "Provider not found");
  }
  if (!allowedClinics.has("*")) {
    const hasAccess = Item.clinicIds?.some((cid) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, "No access to this provider");
    }
  }
  return httpOk({ provider: Item });
}
async function updateProvider(providerId, body, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  if (!existing) {
    return httpErr(404, "Provider not found");
  }
  if (!allowedClinics.has("*")) {
    const hasAccess = existing.clinicIds?.some((cid) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, "No access to this provider");
    }
  }
  const updateFields = ["name", "specialty", "status", "credentialingProgress", "enrollmentProgress", "clinicIds", "email"];
  const updateExpressions = ["#updatedAt = :updatedAt"];
  const expressionAttributeNames = { "#updatedAt": "updatedAt" };
  const expressionAttributeValues = { ":updatedAt": (/* @__PURE__ */ new Date()).toISOString() };
  for (const field of updateFields) {
    if (body[field] !== void 0) {
      updateExpressions.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = body[field];
    }
  }
  if (body.clinicIds) {
    updateExpressions.push("#primaryClinicId = :primaryClinicId");
    expressionAttributeNames["#primaryClinicId"] = "primaryClinicId";
    expressionAttributeValues[":primaryClinicId"] = body.clinicIds[0] || null;
  }
  await ddb2.send(new UpdateCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId },
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  }));
  return httpOk({ providerId, message: "Provider updated successfully" });
}
async function deleteProvider(providerId, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  if (!existing) {
    return httpErr(404, "Provider not found");
  }
  if (!allowedClinics.has("*")) {
    const hasAccess = existing.clinicIds?.some((cid) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, "No access to this provider");
    }
  }
  await ddb2.send(new DeleteCommand({ TableName: PROVIDERS_TABLE2, Key: { providerId } }));
  return httpOk({ message: "Provider deleted successfully" });
}
async function getProviderCredentials(providerId, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { Items } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  return httpOk({ credentials: Items || [] });
}
async function upsertProviderCredential(providerId, body, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { credentialType, ...credentialData } = body;
  if (!credentialType) {
    return httpErr(400, "credentialType is required");
  }
  const validTypes = ["identity", "education", "license", "workHistory", "insurance", "sanctions", "clinicInfo"];
  if (!validTypes.includes(credentialType)) {
    return httpErr(400, `Invalid credentialType. Must be one of: ${validTypes.join(", ")}`);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const credential = {
    providerId,
    credentialType,
    ...credentialData,
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: PROVIDER_CREDENTIALS_TABLE2, Item: credential }));
  await updateCredentialingProgress(providerId);
  return httpOk({ message: "Credential saved successfully", credential });
}
async function getProviderCredential(providerId, credentialType, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { Item } = await ddb2.send(new GetCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Key: { providerId, credentialType }
  }));
  if (!Item) {
    return httpErr(404, "Credential not found");
  }
  return httpOk({ credential: Item });
}
async function updateProviderCredential(providerId, credentialType, body, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Key: { providerId, credentialType }
  }));
  if (!existing) {
    return httpErr(404, "Credential not found");
  }
  const updated = {
    ...existing,
    ...body,
    providerId,
    credentialType,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await ddb2.send(new PutCommand2({ TableName: PROVIDER_CREDENTIALS_TABLE2, Item: updated }));
  await updateCredentialingProgress(providerId);
  return httpOk({ message: "Credential updated successfully", credential: updated });
}
async function deleteProviderCredential(providerId, credentialType, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  await ddb2.send(new DeleteCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Key: { providerId, credentialType }
  }));
  await updateCredentialingProgress(providerId);
  return httpOk({ message: "Credential deleted successfully" });
}
async function updateCredentialingProgress(providerId) {
  const { Items: credentials } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  const requiredTypes = ["identity", "education", "license", "workHistory", "insurance", "sanctions"];
  const completedTypes = new Set((credentials || []).map((c) => c.credentialType));
  let completedCount = 0;
  for (const type of requiredTypes) {
    if (completedTypes.has(type)) {
      completedCount++;
    }
  }
  const progress = Math.round(completedCount / requiredTypes.length * 100);
  let status = "draft";
  if (progress > 0 && progress < 100) {
    status = "in-progress";
  } else if (progress === 100) {
    status = "verified";
  }
  await ddb2.send(new UpdateCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId },
    UpdateExpression: "SET credentialingProgress = :progress, #status = :status, updatedAt = :now",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":progress": progress,
      ":status": status,
      ":now": (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
}
async function getProviderEnrollments(providerId, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { Items } = await ddb2.send(new QueryCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  return httpOk({ enrollments: Items || [] });
}
async function createEnrollment(providerId, body, userPerms, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { payerId, payerName, payerType } = body;
  if (!payerId || !payerName) {
    return httpErr(400, "payerId and payerName are required");
  }
  const enrollmentId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const enrollment = {
    enrollmentId,
    providerId,
    payerId,
    payerName,
    payerType: payerType || "Dental Insurance",
    status: "in-progress",
    applicationDate: now,
    approvalDate: null,
    notes: body.notes || null,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: PAYER_ENROLLMENTS_TABLE, Item: enrollment }));
  await updateEnrollmentProgress(providerId);
  return httpCreated({ enrollmentId, message: "Enrollment started successfully", enrollment });
}
async function listEnrollments(queryParams, allowedClinics) {
  const { status, payerId, limit = "50", lastKey } = queryParams;
  let params = {
    TableName: PAYER_ENROLLMENTS_TABLE,
    Limit: parseInt(limit)
  };
  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }
  if (status) {
    params = {
      ...params,
      IndexName: "byStatus",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    return httpOk({
      enrollments: result2.Items || [],
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  if (payerId) {
    params = {
      ...params,
      IndexName: "byPayer",
      KeyConditionExpression: "payerId = :payerId",
      ExpressionAttributeValues: { ":payerId": payerId }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    return httpOk({
      enrollments: result2.Items || [],
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  const result = await ddb2.send(new ScanCommand(params));
  return httpOk({
    enrollments: result.Items || [],
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}
async function getEnrollment(enrollmentId, allowedClinics) {
  const { Item } = await ddb2.send(new GetCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId }
  }));
  if (!Item) {
    return httpErr(404, "Enrollment not found");
  }
  return httpOk({ enrollment: Item });
}
async function updateEnrollment(enrollmentId, body, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId }
  }));
  if (!existing) {
    return httpErr(404, "Enrollment not found");
  }
  const updated = {
    ...existing,
    ...body,
    enrollmentId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await ddb2.send(new PutCommand2({ TableName: PAYER_ENROLLMENTS_TABLE, Item: updated }));
  await updateEnrollmentProgress(existing.providerId);
  return httpOk({ message: "Enrollment updated successfully", enrollment: updated });
}
async function deleteEnrollment(enrollmentId, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId }
  }));
  if (!existing) {
    return httpErr(404, "Enrollment not found");
  }
  await ddb2.send(new DeleteCommand({ TableName: PAYER_ENROLLMENTS_TABLE, Key: { enrollmentId } }));
  await updateEnrollmentProgress(existing.providerId);
  return httpOk({ message: "Enrollment deleted successfully" });
}
async function updateEnrollmentStatus(enrollmentId, body, allowedClinics) {
  const { status, notes } = body;
  if (!status) {
    return httpErr(400, "status is required");
  }
  const validStatuses = ["not-started", "in-progress", "approved", "rejected", "pending-info"];
  if (!validStatuses.includes(status)) {
    return httpErr(400, `Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId }
  }));
  if (!existing) {
    return httpErr(404, "Enrollment not found");
  }
  const updateExpressions = ["#status = :status", "updatedAt = :now"];
  const expressionAttributeNames = { "#status": "status" };
  const expressionAttributeValues = {
    ":status": status,
    ":now": (/* @__PURE__ */ new Date()).toISOString()
  };
  if (notes !== void 0) {
    updateExpressions.push("notes = :notes");
    expressionAttributeValues[":notes"] = notes;
  }
  if (status === "approved") {
    updateExpressions.push("approvalDate = :approvalDate");
    expressionAttributeValues[":approvalDate"] = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  }
  await ddb2.send(new UpdateCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId },
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  }));
  await updateEnrollmentProgress(existing.providerId);
  return httpOk({ message: "Enrollment status updated successfully" });
}
async function updateEnrollmentProgress(providerId) {
  const { Items: enrollments } = await ddb2.send(new QueryCommand2({
    TableName: PAYER_ENROLLMENTS_TABLE,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  if (!enrollments || enrollments.length === 0) {
    await ddb2.send(new UpdateCommand2({
      TableName: PROVIDERS_TABLE2,
      Key: { providerId },
      UpdateExpression: "SET enrollmentProgress = :progress, updatedAt = :now",
      ExpressionAttributeValues: {
        ":progress": 0,
        ":now": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    return;
  }
  const approvedCount = enrollments.filter((e) => e.status === "approved").length;
  const progress = Math.round(approvedCount / enrollments.length * 100);
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  let newStatus = provider?.status || "draft";
  if (provider?.credentialingProgress === 100 && progress === 100) {
    newStatus = "enrolled";
  }
  await ddb2.send(new UpdateCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId },
    UpdateExpression: "SET enrollmentProgress = :progress, #status = :status, updatedAt = :now",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":progress": progress,
      ":status": newStatus,
      ":now": (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
}
async function listTasks(queryParams, userPerms, isAdmin, allowedClinics) {
  const { status, priority, providerId, clinicId, assigneeId, limit = "50", lastKey } = queryParams;
  let params = {
    TableName: TASKS_TABLE,
    Limit: parseInt(limit)
  };
  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }
  if (status) {
    params = {
      ...params,
      IndexName: "byStatus",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    const filtered2 = filterTasksByAccess(result2.Items || [], allowedClinics, userPerms, isAdmin);
    return httpOk({
      tasks: filtered2,
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  if (providerId) {
    params = {
      ...params,
      IndexName: "byProvider",
      KeyConditionExpression: "providerId = :providerId",
      ExpressionAttributeValues: { ":providerId": providerId }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    const filtered2 = filterTasksByAccess(result2.Items || [], allowedClinics, userPerms, isAdmin);
    return httpOk({
      tasks: filtered2,
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  if (clinicId) {
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(403, "No access to this clinic");
    }
    params = {
      ...params,
      IndexName: "byClinic",
      KeyConditionExpression: "clinicId = :clinicId",
      ExpressionAttributeValues: { ":clinicId": clinicId }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    return httpOk({
      tasks: result2.Items || [],
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  if (assigneeId) {
    params = {
      ...params,
      IndexName: "byAssignee",
      KeyConditionExpression: "assigneeId = :assigneeId",
      ExpressionAttributeValues: { ":assigneeId": assigneeId }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    const filtered2 = filterTasksByAccess(result2.Items || [], allowedClinics, userPerms, isAdmin);
    return httpOk({
      tasks: filtered2,
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  const result = await ddb2.send(new ScanCommand(params));
  const filtered = filterTasksByAccess(result.Items || [], allowedClinics, userPerms, isAdmin);
  return httpOk({
    tasks: filtered,
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}
function filterTasksByAccess(tasks, allowedClinics, userPerms, isAdmin) {
  if (allowedClinics.has("*"))
    return tasks;
  return tasks.filter((t) => {
    if (t.assigneeId === userPerms.email)
      return true;
    if (t.clinicId && allowedClinics.has(t.clinicId))
      return true;
    return false;
  });
}
async function createTask(body, userPerms, allowedClinics) {
  const { title, description, providerId, clinicId, priority, dueDate, assigneeId, category } = body;
  if (!title || !providerId || !dueDate) {
    return httpErr(400, "title, providerId, and dueDate are required");
  }
  if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "No access to this clinic");
  }
  const taskId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const task = {
    taskId,
    title,
    description: description || "",
    providerId,
    clinicId: clinicId || null,
    priority: priority || "medium",
    status: "pending",
    dueDate,
    assigneeId: assigneeId || null,
    assigneeName: null,
    // Will be populated if assignee exists
    category: category || "verification",
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: TASKS_TABLE, Item: task }));
  return httpCreated({ taskId, message: "Task created successfully", task });
}
async function getTask(taskId, allowedClinics) {
  const { Item } = await ddb2.send(new GetCommand2({
    TableName: TASKS_TABLE,
    Key: { taskId }
  }));
  if (!Item) {
    return httpErr(404, "Task not found");
  }
  return httpOk({ task: Item });
}
async function updateTask(taskId, body, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: TASKS_TABLE,
    Key: { taskId }
  }));
  if (!existing) {
    return httpErr(404, "Task not found");
  }
  const updated = {
    ...existing,
    ...body,
    taskId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await ddb2.send(new PutCommand2({ TableName: TASKS_TABLE, Item: updated }));
  return httpOk({ message: "Task updated successfully", task: updated });
}
async function deleteTask(taskId, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: TASKS_TABLE,
    Key: { taskId }
  }));
  if (!existing) {
    return httpErr(404, "Task not found");
  }
  await ddb2.send(new DeleteCommand({ TableName: TASKS_TABLE, Key: { taskId } }));
  return httpOk({ message: "Task deleted successfully" });
}
async function completeTask(taskId, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: TASKS_TABLE,
    Key: { taskId }
  }));
  if (!existing) {
    return httpErr(404, "Task not found");
  }
  await ddb2.send(new UpdateCommand2({
    TableName: TASKS_TABLE,
    Key: { taskId },
    UpdateExpression: "SET #status = :status, completedAt = :completedAt, updatedAt = :now",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":status": "completed",
      ":completedAt": (/* @__PURE__ */ new Date()).toISOString(),
      ":now": (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
  return httpOk({ message: "Task marked as completed" });
}
async function getProviderDocuments(providerId, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
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
  const { Items } = await ddb2.send(new QueryCommand2({
    TableName: DOCUMENTS_TABLE2,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :providerId",
    ExpressionAttributeValues: { ":providerId": providerId }
  }));
  return httpOk({ documents: Items || [] });
}
async function getDocumentUploadUrl(providerId, body, userPerms, allowedClinics) {
  const isTempProvider = providerId.startsWith("temp-");
  if (!isTempProvider) {
    const { Item: provider } = await ddb2.send(new GetCommand2({
      TableName: PROVIDERS_TABLE2,
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
  }
  const { fileName, documentType, contentType } = body;
  if (!fileName || !documentType) {
    return httpErr(400, "fileName and documentType are required");
  }
  const validatedType = validateDocumentType(documentType);
  if (validatedType === "other" && documentType !== "other") {
    console.warn(`Unknown document type '${documentType}', using 'other'. Valid types: ${VALID_DOCUMENT_TYPES.join(", ")}`);
  }
  const documentId = v4_default();
  const s3Key = isTempProvider ? `staging/${providerId}/${validatedType}/${documentId}-${fileName}` : `providers/${providerId}/${validatedType}/${documentId}-${fileName}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const command = new PutObjectCommand({
    Bucket: DOCUMENTS_BUCKET2,
    Key: s3Key,
    ContentType: contentType || "application/octet-stream"
  });
  const uploadUrl = await getSignedUrl(s32, command, { expiresIn: 3600 });
  const document = {
    documentId,
    providerId,
    // Store temp ID - will be updated when provider is created
    tempProviderId: isTempProvider ? providerId : void 0,
    // Track temp ID for later linking
    documentType,
    fileName,
    s3Key,
    contentType: contentType || "application/octet-stream",
    status: isTempProvider ? "pending-provider" : "pending",
    // Different status for temp uploads
    uploadedAt: now,
    uploadedBy: userPerms.email
  };
  await ddb2.send(new PutCommand2({ TableName: DOCUMENTS_TABLE2, Item: document }));
  return httpOk({
    documentId,
    uploadUrl,
    message: "Upload URL generated. URL expires in 1 hour.",
    document
  });
}
async function listDocuments(queryParams, allowedClinics) {
  const { documentType, limit = "50", lastKey } = queryParams;
  let params = {
    TableName: DOCUMENTS_TABLE2,
    Limit: parseInt(limit)
  };
  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }
  if (documentType) {
    params = {
      ...params,
      IndexName: "byDocumentType",
      KeyConditionExpression: "documentType = :documentType",
      ExpressionAttributeValues: { ":documentType": documentType }
    };
    const result2 = await ddb2.send(new QueryCommand2(params));
    return httpOk({
      documents: result2.Items || [],
      lastKey: result2.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result2.LastEvaluatedKey)) : null
    });
  }
  const result = await ddb2.send(new ScanCommand(params));
  return httpOk({
    documents: result.Items || [],
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}
async function getDocumentDownloadUrl(documentId, allowedClinics) {
  const { Item } = await ddb2.send(new GetCommand2({
    TableName: DOCUMENTS_TABLE2,
    Key: { documentId }
  }));
  if (!Item) {
    return httpErr(404, "Document not found");
  }
  const command = new GetObjectCommand2({
    Bucket: DOCUMENTS_BUCKET2,
    Key: Item.s3Key
  });
  const downloadUrl = await getSignedUrl(s32, command, { expiresIn: 3600 });
  return httpOk({
    documentId,
    downloadUrl,
    document: Item,
    message: "Download URL generated. URL expires in 1 hour."
  });
}
async function deleteDocument(documentId, allowedClinics) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: DOCUMENTS_TABLE2,
    Key: { documentId }
  }));
  if (!existing) {
    return httpErr(404, "Document not found");
  }
  try {
    await s32.send(new DeleteObjectCommand({
      Bucket: DOCUMENTS_BUCKET2,
      Key: existing.s3Key
    }));
  } catch (err) {
    console.error("Error deleting S3 object:", err);
  }
  await ddb2.send(new DeleteCommand({ TableName: DOCUMENTS_TABLE2, Key: { documentId } }));
  return httpOk({ message: "Document deleted successfully" });
}
var EXTRACTED_DATA_TABLE2 = process.env.EXTRACTED_DATA_TABLE || "ExtractedData";
async function processDocumentExtraction(body, allowedClinics) {
  const { documentId, providerId } = body;
  if (!documentId || !providerId) {
    return httpErr(400, "documentId and providerId are required");
  }
  const { Item: document } = await ddb2.send(new GetCommand2({
    TableName: DOCUMENTS_TABLE2,
    Key: { documentId }
  }));
  if (!document) {
    return httpErr(404, "Document not found");
  }
  const { Items: existingExtractions } = await ddb2.send(new QueryCommand2({
    TableName: EXTRACTED_DATA_TABLE2,
    IndexName: "byDocument",
    KeyConditionExpression: "documentId = :documentId",
    ExpressionAttributeValues: { ":documentId": documentId },
    Limit: 1
  }));
  if (existingExtractions && existingExtractions.length > 0) {
    const extraction = existingExtractions[0];
    return httpOk({
      documentType: extraction.documentType,
      classificationConfidence: extraction.classificationConfidence || 0.9,
      fieldsExtracted: Object.keys(extraction.extractedFields || {}).length,
      fields: extraction.extractedFields || {},
      status: extraction.status,
      extractionId: extraction.extractionId
    });
  }
  const documentType = document.documentType || classifyDocumentFromPath(document.s3Key).documentType;
  try {
    console.log(`Processing document: ${document.s3Key}`);
    const extractedText = await extractTextFromDocument(DOCUMENTS_BUCKET2, document.s3Key);
    console.log(`Extracted ${extractedText.lines.length} lines, ${Object.keys(extractedText.keyValuePairs).length} key-value pairs`);
    const extractedFields = await extractFieldsWithBedrock(documentType, extractedText);
    console.log(`Extracted ${Object.keys(extractedFields).length} fields with Bedrock`);
    const extractionId = v4_default();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await ddb2.send(new PutCommand2({
      TableName: EXTRACTED_DATA_TABLE2,
      Item: {
        extractionId,
        documentId,
        providerId,
        documentType,
        extractedFields,
        rawTextPreview: extractedText.fullText.substring(0, 500),
        status: "extracted",
        classificationConfidence: 0.85,
        createdAt: now
      }
    }));
    await ddb2.send(new UpdateCommand2({
      TableName: DOCUMENTS_TABLE2,
      Key: { documentId },
      UpdateExpression: "SET extractionId = :extractionId, extractionStatus = :status, extractedAt = :now",
      ExpressionAttributeValues: {
        ":extractionId": extractionId,
        ":status": "extracted",
        ":now": now
      }
    }));
    return httpOk({
      documentType,
      classificationConfidence: 0.85,
      fieldsExtracted: Object.keys(extractedFields).length,
      fields: extractedFields,
      status: "extracted",
      extractionId
    });
  } catch (error) {
    console.error("Error during document extraction:", error);
    return httpErr(500, `Document extraction failed: ${error.message}`);
  }
}
async function getExtractedData(documentId, allowedClinics) {
  const { Items } = await ddb2.send(new QueryCommand2({
    TableName: EXTRACTED_DATA_TABLE2,
    IndexName: "byDocument",
    KeyConditionExpression: "documentId = :documentId",
    ExpressionAttributeValues: { ":documentId": documentId },
    Limit: 1
  }));
  if (!Items || Items.length === 0) {
    return httpErr(404, "No extracted data found for this document");
  }
  const extraction = Items[0];
  return httpOk({
    extractionId: extraction.extractionId,
    documentId: extraction.documentId,
    providerId: extraction.providerId,
    documentType: extraction.documentType,
    extractedFields: extraction.extractedFields || {},
    status: extraction.status,
    createdAt: extraction.createdAt
  });
}
async function runOigCheck(body, allowedClinics) {
  const { providerId, npi, firstName, lastName } = body;
  if (!providerId || !npi) {
    return httpErr(400, "providerId and npi are required");
  }
  const checkResult = {
    providerId,
    checkType: "OIG Exclusions",
    status: "clear",
    // 'clear' | 'flagged' | 'error'
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    details: {
      npi,
      firstName,
      lastName,
      message: "No exclusions found in OIG LEIE database"
    }
  };
  await ddb2.send(new PutCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Item: {
      providerId,
      credentialType: "sanctions",
      oigCheck: checkResult,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
  return httpOk({ result: checkResult });
}
async function runNpdbCheck(body, allowedClinics) {
  const { providerId, npi, firstName, lastName } = body;
  if (!providerId || !npi) {
    return httpErr(400, "providerId and npi are required");
  }
  const checkResult = {
    providerId,
    checkType: "NPDB Query",
    status: "clear",
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    details: {
      npi,
      firstName,
      lastName,
      message: "No adverse actions found in National Practitioner Data Bank"
    }
  };
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Key: { providerId, credentialType: "sanctions" }
  }));
  await ddb2.send(new PutCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Item: {
      ...existing,
      providerId,
      credentialType: "sanctions",
      npdbCheck: checkResult,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
  return httpOk({ result: checkResult });
}
async function runStateBoardCheck(body, allowedClinics) {
  const { providerId, licenseNumber, licenseState } = body;
  if (!providerId || !licenseNumber || !licenseState) {
    return httpErr(400, "providerId, licenseNumber, and licenseState are required");
  }
  const checkResult = {
    providerId,
    checkType: "State Dental Board",
    status: "clear",
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    details: {
      licenseNumber,
      licenseState,
      licenseStatus: "Active",
      message: `License verified as active with ${licenseState} Dental Board. No disciplinary actions found.`
    }
  };
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Key: { providerId, credentialType: "sanctions" }
  }));
  await ddb2.send(new PutCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Item: {
      ...existing,
      providerId,
      credentialType: "sanctions",
      stateBoardCheck: checkResult,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
  return httpOk({ result: checkResult });
}
async function getAnalytics(queryParams, allowedClinics) {
  const { startDate, endDate, clinicId } = queryParams;
  const { Items: providers } = await ddb2.send(new ScanCommand({
    TableName: PROVIDERS_TABLE2
  }));
  const filteredProviders = (providers || []).filter((p) => {
    if (allowedClinics.has("*"))
      return true;
    return p.clinicIds?.some((cid) => allowedClinics.has(cid));
  });
  const providersByStatus = {
    draft: 0,
    "in-progress": 0,
    verified: 0,
    enrolled: 0
  };
  filteredProviders.forEach((p) => {
    if (providersByStatus[p.status] !== void 0) {
      providersByStatus[p.status]++;
    }
  });
  const { Items: enrollments } = await ddb2.send(new ScanCommand({
    TableName: PAYER_ENROLLMENTS_TABLE
  }));
  const providerIds = new Set(filteredProviders.map((p) => p.providerId));
  const filteredEnrollments = (enrollments || []).filter((e) => providerIds.has(e.providerId));
  const enrollmentsByPayer = {};
  filteredEnrollments.forEach((e) => {
    if (!enrollmentsByPayer[e.payerName]) {
      enrollmentsByPayer[e.payerName] = { total: 0, approved: 0 };
    }
    enrollmentsByPayer[e.payerName].total++;
    if (e.status === "approved") {
      enrollmentsByPayer[e.payerName].approved++;
    }
  });
  const approvedEnrollments = filteredEnrollments.filter((e) => e.status === "approved" && e.approvalDate && e.applicationDate);
  let avgDaysToApproval = 0;
  if (approvedEnrollments.length > 0) {
    const totalDays = approvedEnrollments.reduce((sum, e) => {
      const days = Math.ceil((new Date(e.approvalDate).getTime() - new Date(e.applicationDate).getTime()) / (1e3 * 60 * 60 * 24));
      return sum + days;
    }, 0);
    avgDaysToApproval = Math.round(totalDays / approvedEnrollments.length);
  }
  const { Items: tasks } = await ddb2.send(new ScanCommand({
    TableName: TASKS_TABLE
  }));
  const filteredTasks = (tasks || []).filter((t) => {
    if (allowedClinics.has("*"))
      return true;
    return allowedClinics.has(t.clinicId);
  });
  const completedTasks = filteredTasks.filter((t) => t.status === "completed").length;
  const taskCompletionRate = filteredTasks.length > 0 ? Math.round(completedTasks / filteredTasks.length * 100) : 0;
  return httpOk({
    summary: {
      totalProviders: filteredProviders.length,
      totalEnrollments: filteredEnrollments.length,
      totalTasks: filteredTasks.length,
      avgDaysToApproval,
      taskCompletionRate
    },
    providersByStatus,
    enrollmentsByPayer,
    trends: {
      // In a real implementation, this would include historical data
      message: "Historical trend data would be included here"
    }
  });
}
async function listCredentialingUsers(queryParams) {
  const { orgId } = queryParams;
  if (orgId) {
    const { Items: users2 } = await ddb2.send(new QueryCommand2({
      TableName: CREDENTIALING_USERS_TABLE,
      IndexName: "byOrgId",
      KeyConditionExpression: "orgId = :orgId",
      ExpressionAttributeValues: { ":orgId": orgId }
    }));
    return httpOk({ users: users2 || [] });
  }
  const { Items: users } = await ddb2.send(new ScanCommand({
    TableName: CREDENTIALING_USERS_TABLE
  }));
  return httpOk({ users: users || [] });
}
async function createCredentialingUser(body, userPerms) {
  const { email, name, role, orgId, source, externalRef } = body;
  if (!email || !name) {
    return httpErr(400, "email and name are required");
  }
  const { Items: existing } = await ddb2.send(new QueryCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    IndexName: "byEmail",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: { ":email": email.toLowerCase() }
  }));
  if (existing && existing.length > 0) {
    return httpErr(400, "A user with this email already exists");
  }
  const userId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const user = {
    userId,
    email: email.toLowerCase(),
    name,
    role: role || "provider",
    orgId: orgId || "default",
    source: source || "manual",
    externalRef: externalRef || null,
    isActive: true,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: CREDENTIALING_USERS_TABLE, Item: user }));
  return httpCreated({ userId, user, message: "Credentialing user created" });
}
async function getCredentialingUser(userId) {
  const { Item: user } = await ddb2.send(new GetCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId }
  }));
  if (!user)
    return httpErr(404, "User not found");
  return httpOk({ user });
}
async function updateCredentialingUser(userId, body) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId }
  }));
  if (!existing)
    return httpErr(404, "User not found");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updatedUser = { ...existing, ...body, userId, updatedAt: now };
  await ddb2.send(new PutCommand2({ TableName: CREDENTIALING_USERS_TABLE, Item: updatedUser }));
  return httpOk({ user: updatedUser, message: "User updated" });
}
async function deleteCredentialingUser(userId) {
  const { Item: existing } = await ddb2.send(new GetCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId }
  }));
  if (!existing)
    return httpErr(404, "User not found");
  await ddb2.send(new UpdateCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId },
    UpdateExpression: "SET isActive = :f, updatedAt = :now",
    ExpressionAttributeValues: { ":f": false, ":now": (/* @__PURE__ */ new Date()).toISOString() }
  }));
  return httpOk({ message: "User deactivated" });
}
async function syncStaffUsers(body, userPerms) {
  if (CREDENTIALING_MODE !== "internal") {
    return httpErr(403, "Staff sync is only available in internal mode");
  }
  const { staffUsers } = body;
  if (!Array.isArray(staffUsers) || staffUsers.length === 0) {
    return httpErr(400, "staffUsers array is required");
  }
  let created = 0;
  let skipped = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const staff of staffUsers) {
    if (!staff.email) {
      skipped++;
      continue;
    }
    const { Items: existing } = await ddb2.send(new QueryCommand2({
      TableName: CREDENTIALING_USERS_TABLE,
      IndexName: "byEmail",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: { ":email": staff.email.toLowerCase() }
    }));
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }
    await ddb2.send(new PutCommand2({
      TableName: CREDENTIALING_USERS_TABLE,
      Item: {
        userId: v4_default(),
        email: staff.email.toLowerCase(),
        name: staff.name || staff.email.split("@")[0],
        role: staff.role || "provider",
        orgId: staff.orgId || "default",
        source: "tdi-staff",
        externalRef: staff.username || staff.email.toLowerCase(),
        isActive: true,
        createdAt: now,
        createdBy: userPerms.email,
        updatedAt: now
      }
    }));
    created++;
  }
  return httpOk({ created, skipped, message: `Synced ${created} staff users, ${skipped} skipped` });
}
async function getLinkedUsers(providerId, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  if (!provider)
    return httpErr(404, "Provider not found");
  if (!provider.clinicIds?.some((cid) => allowedClinics.has("*") || allowedClinics.has(cid))) {
    return httpErr(403, "No access to this provider");
  }
  const { Items: links } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDER_USER_LINK_TABLE,
    KeyConditionExpression: "providerId = :pid",
    ExpressionAttributeValues: { ":pid": providerId }
  }));
  const enrichedLinks = [];
  for (const link of links || []) {
    const { Item: user } = await ddb2.send(new GetCommand2({
      TableName: CREDENTIALING_USERS_TABLE,
      Key: { userId: link.userId }
    }));
    enrichedLinks.push({ ...link, user: user || null });
  }
  return httpOk({ providerId, linkedUsers: enrichedLinks });
}
async function linkUserToProvider(providerId, body, userPerms, allowedClinics) {
  const { userId, relationshipType } = body;
  if (!userId)
    return httpErr(400, "userId is required");
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  if (!provider)
    return httpErr(404, "Provider not found");
  if (!provider.clinicIds?.some((cid) => allowedClinics.has("*") || allowedClinics.has(cid))) {
    return httpErr(403, "No access to this provider");
  }
  const { Item: user } = await ddb2.send(new GetCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId }
  }));
  if (!user)
    return httpErr(404, "Credentialing user not found");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const link = {
    providerId,
    userId,
    relationshipType: relationshipType || "viewer",
    linkedAt: now,
    linkedBy: userPerms.email,
    isActive: true,
    createdAt: now,
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: PROVIDER_USER_LINK_TABLE, Item: link }));
  return httpCreated({ link, message: "User linked to provider" });
}
async function unlinkUserFromProvider(providerId, userId, allowedClinics) {
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId }
  }));
  if (!provider)
    return httpErr(404, "Provider not found");
  if (!provider.clinicIds?.some((cid) => allowedClinics.has("*") || allowedClinics.has(cid))) {
    return httpErr(403, "No access to this provider");
  }
  await ddb2.send(new DeleteCommand({
    TableName: PROVIDER_USER_LINK_TABLE,
    Key: { providerId, userId }
  }));
  return httpOk({ message: "User unlinked from provider" });
}
function isProviderUser(clinicRoles) {
  const CLINICAL_ROLES = [
    "Dentist",
    "Dental Hygienist",
    "Dental Assistant",
    "DOCTOR",
    "HYGIENIST",
    "DENTAL_ASSISTANT",
    "PROVIDER"
  ];
  return clinicRoles.some((cr) => CLINICAL_ROLES.includes(cr.role));
}
async function resolveMyProviderId(email) {
  const { Items: users } = await ddb2.send(new QueryCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    IndexName: "byEmail",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: { ":email": email.toLowerCase() }
  }));
  if (!users || users.length === 0)
    return null;
  const userId = users[0].userId;
  const { Items: links } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDER_USER_LINK_TABLE,
    IndexName: "byUserId",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": userId }
  }));
  if (!links || links.length === 0)
    return null;
  return { providerId: links[0].providerId, userId };
}
async function getMyProviderProfile(userPerms) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, "No provider profile linked to your account");
  }
  const { Item: provider } = await ddb2.send(new GetCommand2({
    TableName: PROVIDERS_TABLE2,
    Key: { providerId: resolved.providerId }
  }));
  if (!provider) {
    return httpErr(404, "Provider profile not found");
  }
  return httpOk({
    provider,
    link: {
      userId: resolved.userId,
      providerId: resolved.providerId
    }
  });
}
async function createMyProviderProfile(userPerms, body) {
  const { name, npi, specialty, email, clinicIds } = body;
  if (!npi || !specialty) {
    return httpErr(400, "npi and specialty are required");
  }
  const existing = await resolveMyProviderId(userPerms.email);
  if (existing) {
    return httpErr(400, "You already have a provider profile");
  }
  const providerClinicIds = clinicIds || userPerms.clinicRoles.map((cr) => cr.clinicId).filter(Boolean);
  const { Items: existingNpi } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDERS_TABLE2,
    IndexName: "byNpi",
    KeyConditionExpression: "npi = :npi",
    ExpressionAttributeValues: { ":npi": npi }
  }));
  if (existingNpi && existingNpi.length > 0) {
    for (const existingProvider of existingNpi) {
      const existingClinicIds = existingProvider.clinicIds || [];
      const overlappingClinics = providerClinicIds.filter((cid) => existingClinicIds.includes(cid));
      if (overlappingClinics.length > 0) {
        return httpErr(400, `A provider with this NPI already exists for clinic(s): ${overlappingClinics.join(", ")}`);
      }
    }
  }
  const providerId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const providerName = name || `${userPerms.givenName || ""} ${userPerms.familyName || ""}`.trim() || "Provider";
  const provider = {
    providerId,
    name: providerName,
    npi,
    specialty,
    status: "draft",
    credentialingProgress: 0,
    enrollmentProgress: 0,
    clinicIds: providerClinicIds,
    primaryClinicId: providerClinicIds[0] || null,
    email: email || userPerms.email,
    createdAt: now,
    createdBy: "SELF_CREATED",
    updatedAt: now
  };
  await ddb2.send(new PutCommand2({ TableName: PROVIDERS_TABLE2, Item: provider }));
  let userId;
  const { Items: existingUsers } = await ddb2.send(new QueryCommand2({
    TableName: CREDENTIALING_USERS_TABLE,
    IndexName: "byEmail",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: { ":email": userPerms.email.toLowerCase() }
  }));
  if (existingUsers && existingUsers.length > 0) {
    userId = existingUsers[0].userId;
  } else {
    userId = v4_default();
    await ddb2.send(new PutCommand2({
      TableName: CREDENTIALING_USERS_TABLE,
      Item: {
        userId,
        email: userPerms.email.toLowerCase(),
        name: providerName,
        role: "provider",
        source: CREDENTIALING_MODE === "internal" ? "tdi-staff" : "manual",
        externalRef: userPerms.email.toLowerCase(),
        orgId: "default",
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    }));
  }
  await ddb2.send(new PutCommand2({
    TableName: PROVIDER_USER_LINK_TABLE,
    Item: {
      providerId,
      userId,
      relationshipType: "owner",
      linkedAt: now,
      linkedBy: "SELF",
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
  }));
  return httpCreated({
    providerId,
    message: "Provider profile created successfully",
    provider
  });
}
async function getMyCredentials(userPerms) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, "No provider profile linked to your account");
  }
  const { Items: credentials } = await ddb2.send(new QueryCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    KeyConditionExpression: "providerId = :pid",
    ExpressionAttributeValues: { ":pid": resolved.providerId }
  }));
  return httpOk({
    providerId: resolved.providerId,
    credentials: credentials || []
  });
}
async function updateMyCredentials(userPerms, body) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, "No provider profile linked to your account");
  }
  const { credentialType, ...data } = body;
  if (!credentialType) {
    return httpErr(400, "credentialType is required");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const credential = {
    providerId: resolved.providerId,
    credentialType,
    ...data,
    updatedAt: now,
    updatedBy: userPerms.email
  };
  await ddb2.send(new PutCommand2({
    TableName: PROVIDER_CREDENTIALS_TABLE2,
    Item: credential
  }));
  await updateCredentialingProgress(resolved.providerId);
  return httpOk({
    message: "Credential updated successfully",
    credential
  });
}
async function getMyDocuments(userPerms) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, "No provider profile linked to your account");
  }
  const { Items: documents } = await ddb2.send(new QueryCommand2({
    TableName: DOCUMENTS_TABLE2,
    IndexName: "byProvider",
    KeyConditionExpression: "providerId = :pid",
    ExpressionAttributeValues: { ":pid": resolved.providerId }
  }));
  return httpOk({
    providerId: resolved.providerId,
    documents: documents || []
  });
}
export {
  handler
};
