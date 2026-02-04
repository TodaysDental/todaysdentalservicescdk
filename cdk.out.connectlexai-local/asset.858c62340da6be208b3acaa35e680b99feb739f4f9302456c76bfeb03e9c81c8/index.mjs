// src/services/chime/get-call-analytics.ts
import { DynamoDBDocumentClient as DynamoDBDocumentClient2, QueryCommand, GetCommand as GetCommand2 } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createHmac } from "crypto";

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

// src/types/analytics-state-machine.ts
function getFinalizationEstimate(metadata) {
  if (metadata.currentState !== "finalizing" /* FINALIZING */) {
    return null;
  }
  if (!metadata.finalizationScheduledAt) {
    return 3e4;
  }
  const remaining = metadata.finalizationScheduledAt - Date.now();
  return Math.max(0, remaining);
}

// src/services/shared/utils/analytics-state-manager.ts
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
var LOCK_DURATION_MS = parseInt(process.env.ANALYTICS_LOCK_DURATION_MS || "60000", 10);
if (LOCK_DURATION_MS < 1e4 || LOCK_DURATION_MS > 3e5) {
  console.warn("[StateManager] ANALYTICS_LOCK_DURATION_MS outside recommended range (10s-300s):", {
    configuredMs: LOCK_DURATION_MS,
    recommendation: "Use 30000-60000 for most workloads"
  });
}
async function getAnalyticsState(ddb2, tableName, callId, timestamp) {
  const { Item: analytics } = await ddb2.send(new GetCommand({
    TableName: tableName,
    Key: { callId, timestamp },
    ProjectionExpression: "analyticsState, stateHistory, lockedBy, lockedUntil, finalizationScheduledAt, finalizedAt"
  }));
  if (!analytics) {
    return null;
  }
  return {
    currentState: analytics.analyticsState || "initializing" /* INITIALIZING */,
    stateHistory: analytics.stateHistory || [],
    lockedBy: analytics.lockedBy,
    lockedUntil: analytics.lockedUntil,
    finalizationScheduledAt: analytics.finalizationScheduledAt,
    finalizedAt: analytics.finalizedAt
  };
}

// src/types/analytics.ts
var AGENT_BADGES = {
  TOP_PERFORMER: {
    id: "top_performer",
    name: "Top Performer",
    icon: "\u{1F3C6}",
    description: "Ranked #1 in the clinic"
  },
  CALL_CHAMPION: {
    id: "call_champion",
    name: "Call Champion",
    icon: "\u{1F4DE}",
    description: "Handled 100+ calls this period"
  },
  SENTIMENT_STAR: {
    id: "sentiment_star",
    name: "Sentiment Star",
    icon: "\u2B50",
    description: "90%+ positive sentiment score"
  },
  SPEED_DEMON: {
    id: "speed_demon",
    name: "Speed Demon",
    icon: "\u26A1",
    description: "Below average handle time with high quality"
  },
  RISING_STAR: {
    id: "rising_star",
    name: "Rising Star",
    icon: "\u{1F680}",
    description: "Improved 20%+ from previous period"
  },
  CONSISTENCY_KING: {
    id: "consistency_king",
    name: "Consistency King",
    icon: "\u{1F451}",
    description: "Maintained top 3 ranking for 3+ periods"
  },
  ZERO_ISSUES: {
    id: "zero_issues",
    name: "Flawless",
    icon: "\u{1F48E}",
    description: "Zero detected issues this period"
  },
  CUSTOMER_FAVORITE: {
    id: "customer_favorite",
    name: "Customer Favorite",
    icon: "\u2764\uFE0F",
    description: "95%+ customer satisfaction"
  }
};

// src/services/chime/get-call-analytics.ts
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
var PAGINATION_TOKEN_SECRET = process.env.JWT_SECRET || process.env.PAGINATION_SECRET || "default-pagination-secret";
var TOKEN_EXPIRY_MS = 30 * 60 * 1e3;
function signPaginationToken(data, context) {
  const payload = {
    ...data,
    _ctx: context,
    _exp: Date.now() + TOKEN_EXPIRY_MS
  };
  const payloadStr = JSON.stringify(payload);
  const signature = createHmac("sha256", PAGINATION_TOKEN_SECRET).update(payloadStr).digest("hex").substring(0, 16);
  const signedToken = Buffer.from(JSON.stringify({ p: payload, s: signature })).toString("base64");
  return signedToken;
}
function verifyPaginationToken(token, expectedContext) {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    if (decoded.p && decoded.s) {
      const { p: payload, s: signature } = decoded;
      const expectedSig = createHmac("sha256", PAGINATION_TOKEN_SECRET).update(JSON.stringify(payload)).digest("hex").substring(0, 16);
      if (signature !== expectedSig) {
        return { valid: false, error: "Invalid token signature" };
      }
      if (payload._exp && payload._exp < Date.now()) {
        return { valid: false, error: "Token expired" };
      }
      if (payload._ctx && payload._ctx !== expectedContext) {
        return { valid: false, error: "Token context mismatch" };
      }
      const { _ctx, _exp, ...data } = payload;
      return { valid: true, data };
    }
    console.warn("[verifyPaginationToken] Legacy unsigned token detected - consider re-issuing");
    return { valid: true, data: decoded };
  } catch (err) {
    return { valid: false, error: `Cannot decode token: ${err.message}` };
  }
}
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var STAFF_USER_TABLE_NAME = process.env.STAFF_USER_TABLE || "StaffUser";
var dynamodbClient = new DynamoDBClient({});
var ddb = DynamoDBDocumentClient2.from(dynamodbClient);
var ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
var AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var TRANSCRIPT_BUFFER_TABLE_NAME = process.env.TRANSCRIPT_BUFFER_TABLE_NAME;
if (!ANALYTICS_TABLE_NAME) {
  throw new Error("CALL_ANALYTICS_TABLE_NAME environment variable is required");
}
function normalizeTimestamp(value) {
  const YEAR_2100_SECONDS = 4102444800;
  if (value > YEAR_2100_SECONDS) {
    return Math.floor(value / 1e3);
  }
  return value;
}
function validateTimeRange(startTime, endTime) {
  const now = Math.floor(Date.now() / 1e3);
  const oneYearAgo = now - 365 * 24 * 60 * 60;
  if (isNaN(startTime) || isNaN(endTime)) {
    return {
      valid: false,
      error: {
        message: "Invalid time format. Use epoch seconds.",
        error: "INVALID_TIME_FORMAT"
      }
    };
  }
  const normalizedStart = normalizeTimestamp(startTime);
  const normalizedEnd = normalizeTimestamp(endTime);
  if (normalizedStart !== startTime || normalizedEnd !== endTime) {
    console.log("[validateTimeRange] Normalized timestamps from ms to seconds:", {
      originalStart: startTime,
      normalizedStart,
      originalEnd: endTime,
      normalizedEnd
    });
  }
  if (normalizedStart >= normalizedEnd) {
    return {
      valid: false,
      error: {
        message: "startTime must be before endTime",
        error: "INVALID_TIME_RANGE",
        startTime: normalizedStart,
        endTime: normalizedEnd
      }
    };
  }
  if (normalizedStart < oneYearAgo) {
    return {
      valid: false,
      error: {
        message: "startTime cannot be more than 1 year in the past",
        error: "TIME_RANGE_TOO_OLD",
        maxStartTime: oneYearAgo
      }
    };
  }
  if (normalizedEnd > now + 3600) {
    return {
      valid: false,
      error: {
        message: "endTime cannot be more than 1 hour in the future",
        error: "TIME_RANGE_FUTURE",
        currentTime: now
      }
    };
  }
  const MAX_RANGE_SECONDS = 90 * 24 * 60 * 60;
  if (normalizedEnd - normalizedStart > MAX_RANGE_SECONDS) {
    return {
      valid: false,
      error: {
        message: "Time range cannot exceed 90 days",
        error: "TIME_RANGE_TOO_LARGE",
        requestedRange: normalizedEnd - normalizedStart,
        maxRange: MAX_RANGE_SECONDS
      }
    };
  }
  return { valid: true, normalizedStart, normalizedEnd };
}
var handler = async (event) => {
  console.log("[get-analytics] Function invoked", {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId
  });
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders({
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  }, requestOrigin);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      console.warn("[get-analytics] No user permissions in authorizer context");
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Unauthorized" })
      };
    }
    const path = event.path;
    if (path.includes("/call/")) {
      return await getCallAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes("/live")) {
      return await getLiveCallAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes("/clinic/")) {
      return await getClinicAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes("/agent/")) {
      return await getAgentAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes("/summary")) {
      return await getAnalyticsSummary(event, userPerms, corsHeaders);
    } else if (path.includes("/rankings")) {
      return await getAgentRankings(event, userPerms, corsHeaders);
    } else if (path.includes("/queue")) {
      return await getQueueCalls(event, userPerms, corsHeaders);
    }
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Not found" })
    };
  } catch (error) {
    console.error("[get-analytics] Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Internal server error",
        error: error?.message
      })
    };
  }
};
async function getCallAnalytics(event, userPerms, corsHeaders) {
  const callId = event.pathParameters?.callId;
  if (!callId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Missing callId parameter" })
    };
  }
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: "callId = :callId",
    ExpressionAttributeValues: { ":callId": callId },
    ScanIndexForward: false,
    // Get most recent record first (callId is PK, timestamp is SK)
    Limit: 1
  }));
  const analytics = queryResult.Items?.[0];
  if (!analytics) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Call analytics not found" })
    };
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, analytics.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Unauthorized" })
    };
  }
  let transcriptBuffer = null;
  if (TRANSCRIPT_BUFFER_TABLE_NAME) {
    try {
      const bufferResult = await ddb.send(new GetCommand2({
        TableName: TRANSCRIPT_BUFFER_TABLE_NAME,
        Key: { callId }
      }));
      transcriptBuffer = bufferResult.Item || null;
    } catch (err) {
      console.warn("[getCallAnalytics] Failed to fetch transcript buffer (non-fatal):", {
        callId,
        errorName: err?.name,
        errorMessage: err?.message
      });
    }
  }
  if (transcriptBuffer && Array.isArray(transcriptBuffer.segments) && transcriptBuffer.segments.length > 0) {
    const segments = transcriptBuffer.segments;
    const bufferSegmentCount = typeof transcriptBuffer.segmentCount === "number" ? transcriptBuffer.segmentCount : segments.length;
    const existingCount = typeof analytics.transcriptCount === "number" ? analytics.transcriptCount : 0;
    analytics.transcriptCount = Math.max(existingCount, bufferSegmentCount);
    const existingLatest = Array.isArray(analytics.latestTranscripts) ? analytics.latestTranscripts : [];
    if (existingLatest.length === 0) {
      analytics.latestTranscripts = segments.slice(-10).map((seg, idx) => {
        const rawSpeaker = String(seg.speaker || "CUSTOMER").toUpperCase();
        const speaker = rawSpeaker === "AGENT" || rawSpeaker === "ASSISTANT" ? "AGENT" : "CUSTOMER";
        const timestamp = typeof seg.startTime === "number" ? seg.startTime : typeof seg.timestamp === "number" ? seg.timestamp : idx;
        const text = String(seg.content ?? seg.text ?? seg.message ?? "").trim();
        const confidence = typeof seg.confidence === "number" ? seg.confidence : void 0;
        return { timestamp, speaker, text, confidence };
      }).filter((t) => typeof t.text === "string" && t.text.trim().length > 0);
    }
    const hasFullTranscript = typeof analytics.fullTranscript === "string" && analytics.fullTranscript.trim().length > 0;
    if (!hasFullTranscript) {
      const MAX_SEGMENTS_FOR_FULL = 400;
      const MAX_CHARS_FOR_FULL = 2e4;
      const segmentsForFull = segments.length > MAX_SEGMENTS_FOR_FULL ? segments.slice(-MAX_SEGMENTS_FOR_FULL) : segments;
      const lines = [];
      for (const seg of segmentsForFull) {
        const rawSpeaker = String(seg.speaker || "CUSTOMER").toUpperCase();
        const speaker = rawSpeaker === "AGENT" || rawSpeaker === "ASSISTANT" ? "AGENT" : "CUSTOMER";
        const text = String(seg.content ?? seg.text ?? seg.message ?? "").trim();
        if (!text)
          continue;
        lines.push(`${speaker}: ${text}`);
      }
      let fullText = lines.join("\n");
      let truncated = false;
      if (segments.length > MAX_SEGMENTS_FOR_FULL)
        truncated = true;
      if (fullText.length > MAX_CHARS_FOR_FULL) {
        fullText = fullText.substring(fullText.length - MAX_CHARS_FOR_FULL);
        truncated = true;
      }
      analytics.fullTranscript = fullText;
      analytics.fullTranscriptTruncated = truncated;
    }
  }
  const isFinalized = analytics.analyticsState === "finalized" /* FINALIZED */ || analytics.finalized === true || analytics.callStatus === "completed" || analytics.callStatus === "finalized";
  const cacheControl = isFinalized ? "public, max-age=3600" : "no-store";
  const changeMarker = analytics.finalizedAt || analytics.updatedAt || analytics.lastActivityTime || analytics.callEndTime || analytics.timestamp;
  const bufferMarker = transcriptBuffer ? `${transcriptBuffer.lastUpdate || ""}-${transcriptBuffer.segmentCount || transcriptBuffer.segments?.length || 0}` : "";
  const etagSource = `${callId}-${analytics.timestamp}-${changeMarker}-${bufferMarker}`;
  const etag = Buffer.from(etagSource).toString("base64");
  const clientETag = event.headers?.["If-None-Match"] || event.headers?.["if-none-match"];
  if (clientETag === etag) {
    return {
      statusCode: 304,
      headers: {
        ...corsHeaders,
        "ETag": etag,
        "Cache-Control": cacheControl
      },
      body: ""
    };
  }
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      "ETag": etag,
      "Cache-Control": cacheControl,
      "X-Data-Version": analytics.timestamp.toString()
    },
    body: JSON.stringify({
      ...analytics,
      etag
    })
  };
}
async function getLiveCallAnalytics(event, userPerms, corsHeaders) {
  const callId = event.queryStringParameters?.callId;
  if (!callId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Missing callId query parameter" })
    };
  }
  console.log("[getLiveCallAnalytics] Fetching live analytics for callId:", callId);
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: "callId = :callId",
    ExpressionAttributeValues: { ":callId": callId },
    ScanIndexForward: false,
    // Get most recent first
    Limit: 1
  }));
  const analytics = queryResult.Items?.[0];
  if (!analytics) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Call analytics not found",
        callId
      })
    };
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, analytics.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Unauthorized" })
    };
  }
  const analyticsState = analytics.analyticsState || "active" /* ACTIVE */;
  const hasCallEnded = analytics.callEndTime || analytics.finalized;
  const callStartTimestamp = analytics.callStartTimestamp || new Date(analytics.callStartTime).getTime();
  const now = Date.now();
  const callDuration = now - callStartTimestamp;
  const MAX_REASONABLE_CALL_DURATION = 4 * 60 * 60 * 1e3;
  if (analyticsState === "active" /* ACTIVE */ && callDuration > MAX_REASONABLE_CALL_DURATION) {
    console.error("[getLiveCallAnalytics] Stale active call detected (>4 hours):", {
      callId,
      callStartTimestamp,
      callDuration: Math.floor(callDuration / 1e3 / 60),
      // minutes
      analyticsState
    });
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Call data appears stale. Call may have ended without proper finalization.",
        callId,
        error: "STALE_CALL_DATA",
        callDuration: Math.floor(callDuration / 1e3 / 60),
        // minutes
        hint: "Contact support if this persists. The call may need manual finalization."
      })
    };
  }
  const lastUpdate = new Date(analytics.updatedAt).getTime();
  const timeSinceUpdate = now - lastUpdate;
  const STALE_THRESHOLD = 5 * 60 * 1e3;
  if (analyticsState === "active" /* ACTIVE */ && timeSinceUpdate > STALE_THRESHOLD) {
    console.warn("[getLiveCallAnalytics] No recent updates for active call:", {
      callId,
      lastUpdate: analytics.updatedAt,
      minutesSinceUpdate: Math.floor(timeSinceUpdate / 1e3 / 60)
    });
    analytics._warning = "No recent updates received. Call may have ended.";
    analytics._lastUpdateMinutesAgo = Math.floor(timeSinceUpdate / 1e3 / 60);
  }
  if (analyticsState === "finalizing" /* FINALIZING */) {
    const stateMetadata = await getAnalyticsState(ddb, ANALYTICS_TABLE_NAME, callId, analytics.timestamp);
    const estimatedMsRaw = stateMetadata ? getFinalizationEstimate(stateMetadata) : null;
    const estimatedMs = estimatedMsRaw ?? 3e4;
    console.log("[getLiveCallAnalytics] Call is in FINALIZING state", {
      callId,
      estimatedMs
    });
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ...analytics,
        status: "finalizing",
        message: "Call has ended and is being finalized. Check back shortly for complete analytics.",
        estimatedReadyIn: Math.ceil(estimatedMs / 1e3),
        // seconds
        estimatedReadyAt: Date.now() + estimatedMs,
        isLive: false,
        isFinalizing: true,
        hint: "Poll this endpoint or use GET /analytics/call/{callId} once finalized",
        fetchedAt: Date.now()
      })
    };
  }
  if (analyticsState === "finalized" /* FINALIZED */ || hasCallEnded) {
    console.log("[getLiveCallAnalytics] Call is finalized", {
      callId,
      analyticsState,
      hasCallEnded
    });
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: "finalized",
        message: "Call has been finalized. Use GET /analytics/call/{callId} for complete analytics.",
        callId,
        callEndTime: analytics.callEndTime,
        isCompleted: true,
        redirectTo: `/analytics/call/${callId}`,
        hint: "This call is no longer live. Complete analytics are available at the redirectTo endpoint."
      })
    };
  }
  if (analyticsState !== "active" /* ACTIVE */ && analyticsState !== "initializing" /* INITIALIZING */) {
    console.error("[getLiveCallAnalytics] Unexpected analytics state", {
      callId,
      analyticsState
    });
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Call is not in an active state",
        analyticsState,
        error: "INVALID_STATE_FOR_LIVE_ANALYTICS"
      })
    };
  }
  const activeSeconds = Math.floor((Date.now() - callStartTimestamp) / 1e3);
  const etagSource = `${callId}-${analytics.timestamp}-${new Date(analytics.updatedAt).getTime()}`;
  const etag = Buffer.from(etagSource).toString("base64");
  const clientETag = event.headers?.["If-None-Match"] || event.headers?.["if-none-match"];
  if (clientETag === etag) {
    return {
      statusCode: 304,
      // Not Modified
      headers: {
        ...corsHeaders,
        "ETag": etag,
        "Cache-Control": "no-cache"
      },
      body: ""
    };
  }
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      "ETag": etag,
      "Cache-Control": "no-cache, must-revalidate",
      "X-Data-Version": analytics.timestamp.toString(),
      "X-Last-Updated": analytics.updatedAt
    },
    body: JSON.stringify({
      ...analytics,
      isLive: true,
      // Indicator that this is from the live endpoint
      fetchedAt: Date.now(),
      activeSeconds,
      // How long the call has been active
      lastUpdatedSeconds: Math.floor((Date.now() - new Date(analytics.updatedAt).getTime()) / 1e3),
      etag
      // Include in response for client reference
    })
  };
}
async function getClinicAnalytics(event, userPerms, corsHeaders) {
  const clinicId = event.pathParameters?.clinicId;
  const queryParams = event.queryStringParameters || {};
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Missing clinicId parameter" })
    };
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Unauthorized" })
    };
  }
  const startTime = queryParams.startTime ? parseInt(queryParams.startTime, 10) : Math.floor(Date.now() / 1e3) - 24 * 60 * 60;
  const endTime = queryParams.endTime ? parseInt(queryParams.endTime, 10) : Math.floor(Date.now() / 1e3);
  const timeValidation = validateTimeRange(startTime, endTime);
  if (!timeValidation.valid) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify(timeValidation.error)
    };
  }
  let exclusiveStartKey = void 0;
  if (queryParams.lastEvaluatedKey) {
    const tokenResult = verifyPaginationToken(queryParams.lastEvaluatedKey, `clinic:${clinicId}`);
    if (!tokenResult.valid) {
      console.warn("[getClinicAnalytics] Token verification failed:", {
        error: tokenResult.error,
        requestedClinic: clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: `Invalid pagination token: ${tokenResult.error}`,
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    exclusiveStartKey = tokenResult.data;
    if (!exclusiveStartKey || typeof exclusiveStartKey !== "object") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: malformed structure",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    if (!exclusiveStartKey.clinicId || !exclusiveStartKey.timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: missing required fields (clinicId, timestamp)",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    if (exclusiveStartKey.clinicId !== clinicId) {
      console.warn("[getClinicAnalytics] Token clinic mismatch:", {
        requestedClinic: clinicId,
        tokenClinic: exclusiveStartKey.clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: does not match requested clinic",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
  }
  const limit = Math.min(parseInt(queryParams.limit || "100", 10), 100);
  let filterExpression = "";
  const filterValues = {
    ":clinicId": clinicId,
    ":start": startTime,
    ":end": endTime
  };
  const filterNames = { "#ts": "timestamp" };
  if (queryParams.sentiment) {
    filterExpression = "overallSentiment = :sentiment";
    filterValues[":sentiment"] = queryParams.sentiment;
  }
  if (queryParams.minDuration) {
    const minDuration = parseInt(queryParams.minDuration, 10);
    filterExpression = filterExpression ? `${filterExpression} AND totalDuration >= :minDuration` : "totalDuration >= :minDuration";
    filterValues[":minDuration"] = minDuration;
  }
  if (queryParams.hasIssues === "true") {
    filterExpression = filterExpression ? `${filterExpression} AND attribute_exists(detectedIssues) AND size(detectedIssues) > :zero` : "attribute_exists(detectedIssues) AND size(detectedIssues) > :zero";
    filterValues[":zero"] = 0;
  }
  if (queryParams.category) {
    filterExpression = filterExpression ? `${filterExpression} AND callCategory = :category` : "callCategory = :category";
    filterValues[":category"] = queryParams.category;
  }
  const queryCommand = {
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: "clinicId-timestamp-index",
    KeyConditionExpression: "clinicId = :clinicId AND #ts BETWEEN :start AND :end",
    ExpressionAttributeNames: filterNames,
    ExpressionAttributeValues: filterValues,
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey
  };
  if (filterExpression) {
    queryCommand.FilterExpression = filterExpression;
  }
  const queryResult = await ddb.send(new QueryCommand(queryCommand));
  const analytics = queryResult.Items || [];
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      clinicId,
      startTime,
      endTime,
      totalCalls: analytics.length,
      calls: analytics,
      // **FLAW #10 FIX: Include signed pagination tokens**
      // CRITICAL FIX #15: Sign tokens to prevent tampering
      hasMore: !!queryResult.LastEvaluatedKey,
      lastEvaluatedKey: queryResult.LastEvaluatedKey ? signPaginationToken(queryResult.LastEvaluatedKey, `clinic:${clinicId}`) : null
    })
  };
}
async function getAgentAnalytics(event, userPerms, corsHeaders) {
  const agentId = event.pathParameters?.agentId;
  const queryParams = event.queryStringParameters || {};
  if (!agentId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Missing agentId parameter" })
    };
  }
  const requestingAgentId = userPerms.email;
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!isAdmin && requestingAgentId !== agentId) {
    console.warn("[getAgentAnalytics] Unauthorized access attempt", {
      requestingAgentId,
      requestedAgentId: agentId,
      allowedClinics: Array.from(allowedClinics)
    });
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Forbidden: You can only view your own analytics",
        error: "INSUFFICIENT_PERMISSIONS"
      })
    };
  }
  if (isAdmin) {
    const agentClinicsSet = /* @__PURE__ */ new Set();
    let lastEvaluatedKey = void 0;
    let pageCount = 0;
    const MAX_PAGES = 10;
    do {
      const sampleQuery2 = await ddb.send(new QueryCommand({
        TableName: ANALYTICS_TABLE_NAME,
        IndexName: "agentId-timestamp-index",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: { ":agentId": agentId },
        ProjectionExpression: "clinicId",
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      if (sampleQuery2.Items) {
        sampleQuery2.Items.forEach((item) => {
          if (item.clinicId) {
            agentClinicsSet.add(item.clinicId);
          }
        });
      }
      lastEvaluatedKey = sampleQuery2.LastEvaluatedKey;
      pageCount++;
    } while (lastEvaluatedKey && pageCount < MAX_PAGES);
    const sampleQuery = { Items: Array.from(agentClinicsSet).map((clinicId) => ({ clinicId })) };
    if (!sampleQuery.Items || sampleQuery.Items.length === 0) {
      console.warn("[getAgentAnalytics] Agent has no call history, checking presence table", {
        requestingAgentId,
        requestedAgentId: agentId
      });
      const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;
      if (AGENT_PRESENCE_TABLE) {
        try {
          const presenceResult = await ddb.send(new GetCommand2({
            TableName: AGENT_PRESENCE_TABLE,
            Key: { agentId }
          }));
          if (presenceResult.Item && presenceResult.Item.clinicId) {
            const agentClinicId = presenceResult.Item.clinicId;
            if (!hasClinicAccess(allowedClinics, agentClinicId)) {
              console.warn("[getAgentAnalytics] Admin attempted access to new agent in unauthorized clinic", {
                requestingAgentId,
                requestedAgentId: agentId,
                agentClinicId,
                allowedClinics: Array.from(allowedClinics)
              });
              return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                  message: "Forbidden: Agent belongs to a clinic you do not have access to",
                  error: "CROSS_CLINIC_ACCESS_DENIED"
                })
              };
            }
          } else {
            return {
              statusCode: 404,
              headers: corsHeaders,
              body: JSON.stringify({
                message: "Agent not found or has no clinic assignment",
                error: "AGENT_NOT_FOUND"
              })
            };
          }
        } catch (err) {
          console.error("[getAgentAnalytics] Error checking agent presence:", err);
        }
      }
    } else {
      const agentClinics = new Set(sampleQuery.Items.map((item) => item.clinicId).filter(Boolean));
      for (const agentClinicId of agentClinics) {
        if (!hasClinicAccess(allowedClinics, agentClinicId)) {
          console.warn("[getAgentAnalytics] Admin attempted cross-clinic access", {
            requestingAgentId,
            requestedAgentId: agentId,
            agentClinicId,
            allowedClinics: Array.from(allowedClinics),
            note: "Agent has worked at multiple clinics"
          });
          return {
            statusCode: 403,
            headers: corsHeaders,
            body: JSON.stringify({
              message: "Forbidden: Agent has worked at clinics you do not have access to",
              error: "CROSS_CLINIC_ACCESS_DENIED",
              hint: "Agent may have transferred between clinics. You must have access to all clinics they worked at."
            })
          };
        }
      }
    }
  }
  const startTime = queryParams.startTime ? parseInt(queryParams.startTime, 10) : Math.floor(Date.now() / 1e3) - 7 * 24 * 60 * 60;
  const endTime = queryParams.endTime ? parseInt(queryParams.endTime, 10) : Math.floor(Date.now() / 1e3);
  let exclusiveStartKey = void 0;
  if (queryParams.lastEvaluatedKey) {
    const tokenResult = verifyPaginationToken(queryParams.lastEvaluatedKey, `agent:${agentId}`);
    if (!tokenResult.valid) {
      console.warn("[getAgentAnalytics] Token verification failed:", {
        error: tokenResult.error,
        requestedAgent: agentId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: `Invalid pagination token: ${tokenResult.error}`,
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    exclusiveStartKey = tokenResult.data;
    if (!exclusiveStartKey || typeof exclusiveStartKey !== "object") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: malformed structure",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    if (!exclusiveStartKey.agentId || !exclusiveStartKey.timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: missing required fields (agentId, timestamp)",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    if (exclusiveStartKey.agentId !== agentId) {
      console.warn("[getAgentAnalytics] Token agent mismatch:", {
        requestedAgent: agentId,
        tokenAgent: exclusiveStartKey.agentId,
        requestingUser: requestingAgentId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: does not match requested agent",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
  }
  const limit = Math.min(parseInt(queryParams.limit || "100", 10), 100);
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: "agentId-timestamp-index",
    KeyConditionExpression: "agentId = :agentId AND #ts BETWEEN :start AND :end",
    ExpressionAttributeNames: { "#ts": "timestamp" },
    ExpressionAttributeValues: {
      ":agentId": agentId,
      ":start": startTime,
      ":end": endTime
    },
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey
  }));
  const analytics = queryResult.Items || [];
  if (analytics.length === 0) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        agentId,
        totalCalls: 0,
        metrics: {},
        calls: [],
        hasMore: false,
        lastEvaluatedKey: null
      })
    };
  }
  const isPaginated = !!queryParams.lastEvaluatedKey || !!queryResult.LastEvaluatedKey;
  const pageMetrics = calculateAgentMetrics(analytics);
  let fullMetrics = null;
  if (isPaginated && AGENT_PERFORMANCE_TABLE_NAME) {
    try {
      const perfResult = await ddb.send(new QueryCommand({
        TableName: AGENT_PERFORMANCE_TABLE_NAME,
        KeyConditionExpression: "agentId = :agentId AND periodDate BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":agentId": agentId,
          ":start": new Date(startTime * 1e3).toISOString().split("T")[0],
          ":end": new Date(endTime * 1e3).toISOString().split("T")[0]
        }
      }));
      if (perfResult.Items && perfResult.Items.length > 0) {
        fullMetrics = aggregatePerformanceRecords(perfResult.Items);
      } else {
        console.log("[getAgentAnalytics] No pre-aggregated data, falling back to full scan");
        fullMetrics = await fetchAllAgentCallAnalytics(agentId, startTime, endTime);
      }
    } catch (err) {
      console.warn("[getAgentAnalytics] Could not fetch pre-aggregated metrics:", err.message);
      try {
        fullMetrics = await fetchAllAgentCallAnalytics(agentId, startTime, endTime);
      } catch (fallbackErr) {
        console.error("[getAgentAnalytics] Fallback query also failed:", fallbackErr.message);
      }
    }
  }
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      agentId,
      startTime,
      endTime,
      // CRITICAL FIX: Distinguish between page-level and total counts with better clarity
      callsInPage: analytics.length,
      totalCalls: fullMetrics?.totalCalls !== void 0 ? fullMetrics.totalCalls : analytics.length,
      totalCallsNote: fullMetrics?.totalCalls !== void 0 ? "Complete total from pre-aggregated data" : "Showing page total only - use pagination to get all records",
      // Provide both page-level and full metrics when available
      metrics: {
        page: {
          ...pageMetrics,
          _note: "These metrics calculated from current page only",
          _isPageLevel: true,
          _scope: "current_page"
        },
        ...fullMetrics && {
          total: {
            ...fullMetrics,
            _note: "These metrics calculated from complete dataset",
            _isComplete: true,
            _scope: "all_calls_in_range"
          }
        }
      },
      calls: analytics,
      pagination: {
        hasMore: !!queryResult.LastEvaluatedKey,
        // CRITICAL FIX #15: Use signed pagination tokens
        lastEvaluatedKey: queryResult.LastEvaluatedKey ? signPaginationToken(queryResult.LastEvaluatedKey, `agent:${agentId}`) : null,
        isPaginated,
        warning: isPaginated && !fullMetrics ? "Metrics are calculated from current page only. For complete metrics across all calls, aggregate all pages client-side or use the agent performance summary endpoint." : null
      }
    })
  };
}
async function getAnalyticsSummary(event, userPerms, corsHeaders) {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  if (clinicId) {
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Unauthorized" })
      };
    }
  } else {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: "clinicId required for summary" })
    };
  }
  const startTime = queryParams.startTime ? parseInt(queryParams.startTime, 10) : Math.floor(Date.now() / 1e3) - 24 * 60 * 60;
  const endTime = queryParams.endTime ? parseInt(queryParams.endTime, 10) : Math.floor(Date.now() / 1e3);
  const limit = Math.min(parseInt(queryParams.limit || "1000", 10), 1e3);
  let exclusiveStartKey = void 0;
  if (queryParams.lastEvaluatedKey) {
    const tokenResult = verifyPaginationToken(queryParams.lastEvaluatedKey, `summary:${clinicId}`);
    if (!tokenResult.valid) {
      console.warn("[getAnalyticsSummary] Token verification failed:", {
        error: tokenResult.error,
        requestedClinic: clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: `Invalid pagination token: ${tokenResult.error}`,
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    exclusiveStartKey = tokenResult.data;
    if (!exclusiveStartKey?.clinicId || !exclusiveStartKey?.timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: missing required fields",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
    if (exclusiveStartKey.clinicId !== clinicId) {
      console.warn("[getAnalyticsSummary] Token clinic mismatch - possible security issue:", {
        requestedClinic: clinicId,
        tokenClinic: exclusiveStartKey.clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Invalid pagination token: clinic mismatch",
          error: "INVALID_PAGINATION_TOKEN"
        })
      };
    }
  }
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: "clinicId-timestamp-index",
    KeyConditionExpression: "clinicId = :clinicId AND #ts BETWEEN :start AND :end",
    ExpressionAttributeNames: { "#ts": "timestamp" },
    ExpressionAttributeValues: {
      ":clinicId": clinicId,
      ":start": startTime,
      ":end": endTime
    },
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey
  }));
  const analytics = queryResult.Items || [];
  const isPartialData = !!queryResult.LastEvaluatedKey;
  const hitLimit = analytics.length >= limit;
  if (hitLimit && !queryParams.lastEvaluatedKey) {
    console.warn("[getAnalyticsSummary] Large result set detected. Client receiving partial data.", {
      clinicId,
      recordsReturned: analytics.length,
      limit
    });
  }
  const summary = calculateSummaryMetrics(analytics);
  const dataCompleteness = {
    isComplete: !isPartialData,
    isPartial: isPartialData,
    recordsAnalyzed: analytics.length,
    estimatedTotalRecords: isPartialData ? ">" + analytics.length : analytics.length,
    dataQuality: isPartialData ? "PARTIAL" : "COMPLETE",
    warning: isPartialData ? "This summary is calculated from partial data. Metrics may not reflect complete picture. Use pagination to retrieve all records." : null
  };
  const responseHeaders = {
    ...corsHeaders,
    ...isPartialData && {
      "X-Data-Partial": "true",
      "X-Data-Warning": "Results are partial. Use pagination to get complete data."
    }
  };
  return {
    statusCode: 200,
    headers: responseHeaders,
    body: JSON.stringify({
      clinicId,
      startTime,
      endTime,
      summary: {
        ...summary,
        // CRITICAL: Add warning flags directly to summary object
        _isPartial: isPartialData,
        _warning: dataCompleteness.warning
      },
      dataCompleteness,
      pagination: {
        hasMore: !!queryResult.LastEvaluatedKey,
        // CRITICAL FIX #5.1: Use signed pagination tokens for summary
        lastEvaluatedKey: queryResult.LastEvaluatedKey ? signPaginationToken(queryResult.LastEvaluatedKey, `summary:${clinicId}`) : null,
        recordsInPage: analytics.length,
        limit
      }
    })
  };
}
async function fetchAllAgentCallAnalytics(agentId, startTime, endTime) {
  const allAnalytics = [];
  let lastEvaluatedKey = void 0;
  let pageCount = 0;
  const MAX_PAGES = 20;
  const MAX_DURATION_MS = 25e3;
  const startTimeMs = Date.now();
  let hitLimit = false;
  let hitTimeout = false;
  try {
    do {
      const elapsedMs = Date.now() - startTimeMs;
      if (elapsedMs > MAX_DURATION_MS) {
        hitTimeout = true;
        console.warn("[fetchAllAgentCallAnalytics] Approaching timeout limit - stopping early:", {
          agentId,
          recordsFetched: allAnalytics.length,
          elapsedMs,
          maxDurationMs: MAX_DURATION_MS
        });
        break;
      }
      const queryResult = await ddb.send(new QueryCommand({
        TableName: ANALYTICS_TABLE_NAME,
        IndexName: "agentId-timestamp-index",
        KeyConditionExpression: "agentId = :agentId AND #ts BETWEEN :start AND :end",
        ExpressionAttributeNames: { "#ts": "timestamp" },
        ExpressionAttributeValues: {
          ":agentId": agentId,
          ":start": startTime,
          ":end": endTime
        },
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      if (queryResult.Items) {
        allAnalytics.push(...queryResult.Items);
      }
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        hitLimit = true;
        console.warn("[fetchAllAgentCallAnalytics] Hit max pages limit - INCOMPLETE DATA:", {
          agentId,
          recordsFetched: allAnalytics.length,
          warning: "Metrics are incomplete for high-volume agents"
        });
        break;
      }
    } while (lastEvaluatedKey);
    const isIncomplete = hitLimit || hitTimeout;
    const incompleteReason = hitTimeout ? "Query timeout - consider using a shorter time range" : hitLimit ? "Data incomplete: Agent has >2000 calls in range. Metrics calculated from first 2000 calls only." : null;
    if (isIncomplete) {
      console.warn("[fetchAllAgentCallAnalytics] INCOMPLETE_DATA_WARNING", {
        agentId,
        recordsFetched: allAnalytics.length,
        hitTimeout,
        hitLimit,
        elapsedMs: Date.now() - startTimeMs,
        recommendation: hitTimeout ? "Consider reducing time range or increasing Lambda memory" : "Consider using pre-aggregated AgentPerformance table"
      });
    }
    return {
      ...calculateAgentMetrics(allAnalytics),
      totalCalls: allAnalytics.length,
      _source: "fallback_full_scan",
      _pagesFetched: pageCount,
      _elapsedMs: Date.now() - startTimeMs,
      _isIncomplete: isIncomplete,
      _hitTimeout: hitTimeout,
      _warning: incompleteReason,
      _estimatedTotalCalls: isIncomplete ? `>${allAnalytics.length}` : allAnalytics.length,
      // CRITICAL FIX #5.2: Add explicit field for client to check
      dataQuality: isIncomplete ? "PARTIAL" : "COMPLETE"
    };
  } catch (err) {
    console.error("[fetchAllAgentCallAnalytics] Error fetching all analytics:", err.message);
    throw err;
  }
}
function calculateAgentMetrics(analytics) {
  const totalCalls = analytics.length;
  if (totalCalls === 0) {
    return {
      averageDuration: 0,
      averageTalkPercentage: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      issuesDetected: 0,
      averageQualityScore: 0,
      weightedSentimentScore: 0
    };
  }
  const totalDuration = analytics.reduce((sum, a) => sum + (a.totalDuration || 0), 0);
  const totalTalkPercentage = analytics.reduce(
    (sum, a) => sum + (a.speakerMetrics?.agentTalkPercentage || 0),
    0
  );
  const sentimentCounts = analytics.reduce((acc, a) => {
    const sentiment = a.overallSentiment || "NEUTRAL";
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {});
  const sentimentScores = analytics.filter((a) => a.sentimentScore).map((a) => {
    const scores = a.sentimentScore;
    if (scores.positive > 0.6)
      return 75 + scores.positive * 25;
    if (scores.negative > 0.6)
      return 25 - scores.negative * 25;
    if (scores.mixed > 0.4)
      return 50 + (scores.positive - scores.negative) * 25;
    return 50;
  });
  const weightedSentimentScore = sentimentScores.length > 0 ? Math.round(sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length) : 50;
  const categoryCounts = analytics.reduce((acc, a) => {
    const category = a.callCategory || "uncategorized";
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const totalIssues = analytics.reduce(
    (sum, a) => sum + (a.detectedIssues?.length || 0),
    0
  );
  const qualityScores = analytics.filter((a) => a.audioQuality?.qualityScore).map((a) => a.audioQuality.qualityScore);
  const averageQualityScore = qualityScores.length > 0 ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length : 0;
  return {
    // FIX: Ensure division by zero is handled (totalCalls checked at start but adding safety)
    averageDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
    averageTalkPercentage: totalCalls > 0 ? Math.round(totalTalkPercentage / totalCalls) : 0,
    sentimentBreakdown: sentimentCounts,
    categoryBreakdown: categoryCounts,
    issuesDetected: totalIssues,
    averageQualityScore: qualityScores.length > 0 ? Math.round(averageQualityScore * 10) / 10 : 0,
    // CRITICAL FIX: Include weighted sentiment score for more nuanced analysis
    weightedSentimentScore,
    sentimentAnalysis: {
      categoryCounts: sentimentCounts,
      weightedScore: weightedSentimentScore,
      scoreInterpretation: weightedSentimentScore >= 75 ? "Highly Positive" : weightedSentimentScore >= 60 ? "Positive" : weightedSentimentScore >= 40 ? "Neutral/Mixed" : weightedSentimentScore >= 25 ? "Negative" : "Highly Negative"
    }
  };
}
function calculateSummaryMetrics(analytics) {
  const totalCalls = analytics.length;
  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      topIssues: [],
      averageQualityScore: 0,
      callVolumeByHour: new Array(24).fill(0).map((count, hour) => ({ hour, count }))
    };
  }
  const baseMetrics = calculateAgentMetrics(analytics);
  const issuesCounts = analytics.reduce((acc, a) => {
    (a.detectedIssues || []).forEach((issue) => {
      acc[issue] = (acc[issue] || 0) + 1;
    });
    return acc;
  }, {});
  const topIssues = Object.entries(issuesCounts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([issue, count]) => ({ issue, count }));
  const volumeByHour = new Array(24).fill(0);
  if (analytics.length === 0) {
    return volumeByHour.map((count, hour) => ({ hour, count }));
  }
  const clinicTimezone = analytics[0]?.clinicTimezone || analytics[0]?.timezone || "UTC";
  const validTimezone = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: clinicTimezone }).format(/* @__PURE__ */ new Date());
      return clinicTimezone;
    } catch (err) {
      console.warn("[calculateSummaryMetrics] Invalid timezone, using UTC:", {
        invalidTimezone: clinicTimezone,
        error: err.message
      });
      return "UTC";
    }
  })();
  let dstTransitionDetected = false;
  const hourCounts = /* @__PURE__ */ new Map();
  const dstMetadata = {
    isDSTDay: false,
    springForward: false,
    // Lost hour (2am doesn't exist)
    fallBack: false,
    // Repeated hour (1am happens twice)
    affectedHour: -1
  };
  analytics.forEach((a) => {
    if (a.callStartTime) {
      try {
        const callDate = new Date(a.callStartTime);
        if (isNaN(callDate.getTime())) {
          console.warn("[calculateSummaryMetrics] Invalid date:", {
            callStartTime: a.callStartTime,
            callId: a.callId
          });
          return;
        }
        const hour = parseInt(
          new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            hour12: false,
            timeZone: validTimezone
          }).format(callDate),
          10
        );
        if (!isNaN(hour) && hour >= 0 && hour < 24) {
          volumeByHour[hour]++;
          hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        } else {
          dstTransitionDetected = true;
          console.warn("[calculateSummaryMetrics] Hour outside 0-23 range (DST?):", {
            hour,
            callStartTime: a.callStartTime,
            timezone: validTimezone,
            originalTimezone: clinicTimezone
          });
        }
      } catch (err) {
        console.warn("[calculateSummaryMetrics] Error converting timezone:", {
          callStartTime: a.callStartTime,
          timezone: validTimezone,
          error: err.message,
          callId: a.callId
        });
        try {
          const fallbackHour = new Date(a.callStartTime).getUTCHours();
          if (!isNaN(fallbackHour) && fallbackHour >= 0 && fallbackHour < 24) {
            volumeByHour[fallbackHour]++;
            hourCounts.set(fallbackHour, (hourCounts.get(fallbackHour) || 0) + 1);
          }
        } catch (fallbackErr) {
          console.error("[calculateSummaryMetrics] Failed fallback hour calculation:", fallbackErr);
        }
      }
    }
  });
  if (hourCounts.size === 23) {
    dstMetadata.isDSTDay = true;
    dstMetadata.springForward = true;
    for (let h = 0; h < 24; h++) {
      if (!hourCounts.has(h)) {
        dstMetadata.affectedHour = h;
        break;
      }
    }
    console.warn("[calculateSummaryMetrics] DST Spring Forward detected:", {
      timezone: validTimezone,
      missingHour: dstMetadata.affectedHour,
      note: "Hour-based metrics show 23 hours for this day"
    });
  } else if (hourCounts.size === 25 || hourCounts.size > 24) {
    dstMetadata.isDSTDay = true;
    dstMetadata.fallBack = true;
    console.warn("[calculateSummaryMetrics] DST Fall Back detected:", {
      timezone: validTimezone,
      uniqueHours: hourCounts.size,
      note: "Hour-based metrics show 25 hours for this day"
    });
  }
  return {
    totalCalls,
    ...baseMetrics,
    topIssues,
    callVolumeByHour: volumeByHour.map((count, hour) => ({ hour, count })),
    // CRITICAL FIX: Include DST metadata for accurate client-side interpretation
    dstMetadata: dstMetadata.isDSTDay ? {
      isDSTDay: true,
      type: dstMetadata.springForward ? "spring_forward" : "fall_back",
      affectedHour: dstMetadata.affectedHour,
      expectedHours: dstMetadata.springForward ? 23 : 25,
      warning: dstMetadata.springForward ? `DST spring forward: Hour ${dstMetadata.affectedHour} does not exist on this day` : "DST fall back: One hour is repeated on this day"
    } : null
  };
}
function aggregatePerformanceRecords(records) {
  if (records.length === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      averageTalkPercentage: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      issuesDetected: 0,
      averageQualityScore: 0
    };
  }
  const totals = records.reduce((acc, record) => ({
    totalCalls: acc.totalCalls + (record.totalCalls || 0),
    inboundCalls: acc.inboundCalls + (record.inboundCalls || 0),
    outboundCalls: acc.outboundCalls + (record.outboundCalls || 0),
    totalTalkTime: acc.totalTalkTime + (record.totalTalkTime || 0),
    totalHandleTime: acc.totalHandleTime + (record.totalHandleTime || 0),
    sentimentScores: {
      positive: acc.sentimentScores.positive + (record.sentimentScores?.positive || 0),
      negative: acc.sentimentScores.negative + (record.sentimentScores?.negative || 0),
      neutral: acc.sentimentScores.neutral + (record.sentimentScores?.neutral || 0),
      mixed: acc.sentimentScores.mixed + (record.sentimentScores?.mixed || 0)
    }
  }), {
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    totalTalkTime: 0,
    totalHandleTime: 0,
    sentimentScores: { positive: 0, negative: 0, neutral: 0, mixed: 0 }
  });
  const averageDuration = totals.totalCalls > 0 ? Math.round(totals.totalHandleTime / totals.totalCalls) : 0;
  const totalSentimentCalls = totals.sentimentScores.positive + totals.sentimentScores.negative + totals.sentimentScores.neutral + totals.sentimentScores.mixed;
  return {
    totalCalls: totals.totalCalls,
    inboundCalls: totals.inboundCalls,
    outboundCalls: totals.outboundCalls,
    averageDuration,
    sentimentBreakdown: totals.sentimentScores,
    periodStart: records[0]?.periodDate,
    periodEnd: records[records.length - 1]?.periodDate,
    daysIncluded: records.length
  };
}
async function getAgentRankings(event, userPerms, corsHeaders) {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "clinicId query parameter is required",
        error: "MISSING_CLINIC_ID"
      })
    };
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Forbidden: You do not have access to this clinic",
        error: "INSUFFICIENT_PERMISSIONS"
      })
    };
  }
  const period = queryParams.period || "weekly";
  const criteria = queryParams.criteria || "performanceScore";
  const limit = Math.min(parseInt(queryParams.limit || "50", 10), 100);
  const includeInactive = queryParams.includeInactive === "true";
  const now = Math.floor(Date.now() / 1e3);
  let startTime;
  let endTime = now;
  let periodLabel;
  if (period === "custom") {
    startTime = queryParams.startTime ? parseInt(queryParams.startTime, 10) : now - 7 * 24 * 60 * 60;
    endTime = queryParams.endTime ? parseInt(queryParams.endTime, 10) : now;
    periodLabel = `Custom: ${new Date(startTime * 1e3).toLocaleDateString()} - ${new Date(endTime * 1e3).toLocaleDateString()}`;
  } else {
    const periodConfig = getPeriodConfig(period, now);
    startTime = periodConfig.startTime;
    endTime = periodConfig.endTime;
    periodLabel = periodConfig.label;
  }
  const timeValidation = validateTimeRange(startTime, endTime);
  if (!timeValidation.valid) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify(timeValidation.error)
    };
  }
  console.log("[getAgentRankings] Fetching rankings", {
    clinicId,
    period,
    criteria,
    startTime,
    endTime,
    limit
  });
  try {
    const allAnalytics = await fetchClinicCallAnalytics(clinicId, startTime, endTime);
    if (allAnalytics.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          clinicId,
          period: { type: period, startTime, endTime, label: periodLabel },
          criteria,
          rankings: [],
          totalAgents: 0,
          clinicStats: {
            avgPerformanceScore: 0,
            totalCalls: 0,
            avgSentimentScore: 0,
            avgHandleTime: 0
          },
          highlights: {
            topPerformer: null,
            mostImproved: null,
            callLeader: null,
            sentimentLeader: null
          },
          generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          dataCompleteness: "complete"
        })
      };
    }
    const agentAnalyticsMap = /* @__PURE__ */ new Map();
    allAnalytics.forEach((record) => {
      if (!record.agentId)
        return;
      if (!agentAnalyticsMap.has(record.agentId)) {
        agentAnalyticsMap.set(record.agentId, []);
      }
      agentAnalyticsMap.get(record.agentId).push(record);
    });
    const todayStart = getTodayStartTimestamp();
    const todayEnd = now;
    const todayAnalytics = await fetchClinicCallAnalytics(clinicId, todayStart, todayEnd);
    const agentTodayMap = /* @__PURE__ */ new Map();
    todayAnalytics.forEach((record) => {
      if (!record.agentId)
        return;
      if (!agentTodayMap.has(record.agentId)) {
        agentTodayMap.set(record.agentId, []);
      }
      agentTodayMap.get(record.agentId).push(record);
    });
    const agentIds = Array.from(agentAnalyticsMap.keys());
    const agentPresenceMap = await fetchAgentPresenceData(agentIds, clinicId);
    const agentNamesMap = await fetchAgentNames(agentIds);
    const agentMetrics = [];
    for (const [agentId, agentCalls] of agentAnalyticsMap.entries()) {
      if (agentCalls.length === 0 && !includeInactive)
        continue;
      const todayCalls = agentTodayMap.get(agentId) || [];
      const presence = agentPresenceMap.get(agentId);
      const nameInfo = agentNamesMap.get(agentId);
      const metrics = calculateAgentRankingMetrics(
        agentId,
        agentCalls,
        clinicId,
        todayCalls,
        presence,
        nameInfo
      );
      agentMetrics.push(metrics);
    }
    const sortedMetrics = sortAgentsByCriteria(agentMetrics, criteria);
    sortedMetrics.forEach((agent, index) => {
      agent.rank = index + 1;
      agent.rankLabel = formatRankLabel(index + 1);
    });
    const topAgents = sortedMetrics.slice(0, limit);
    topAgents.forEach((agent) => {
      agent.badges = calculateAgentBadges(agent, sortedMetrics);
    });
    const clinicStats = calculateClinicStats(allAnalytics);
    const highlights = calculateHighlights(sortedMetrics);
    const previousPeriod = getPreviousPeriod(period, startTime, endTime);
    const previousAnalytics = await fetchClinicCallAnalytics(clinicId, previousPeriod.startTime, previousPeriod.endTime);
    if (previousAnalytics.length > 0) {
      const previousAgentMap = /* @__PURE__ */ new Map();
      previousAnalytics.forEach((record) => {
        if (!record.agentId)
          return;
        if (!previousAgentMap.has(record.agentId)) {
          previousAgentMap.set(record.agentId, []);
        }
        previousAgentMap.get(record.agentId).push(record);
      });
      const previousMetrics = Array.from(previousAgentMap.entries()).map(
        ([agentId, calls]) => calculateAgentRankingMetrics(agentId, calls, clinicId)
      );
      const previousSorted = sortAgentsByCriteria(previousMetrics, criteria);
      previousSorted.forEach((agent, index) => {
        agent.rank = index + 1;
      });
      topAgents.forEach((agent) => {
        const previousAgent = previousSorted.find((p) => p.agentId === agent.agentId);
        if (previousAgent) {
          const rankChange = previousAgent.rank - agent.rank;
          const scoreChange = agent.performanceScore - previousAgent.performanceScore;
          agent.trend = {
            direction: rankChange > 0 ? "up" : rankChange < 0 ? "down" : "stable",
            changePercent: previousAgent.performanceScore > 0 ? Math.round(scoreChange / previousAgent.performanceScore * 100) : 0,
            previousRank: previousAgent.rank
          };
        }
      });
    }
    const response = {
      clinicId,
      period: {
        type: period,
        startTime,
        endTime,
        label: periodLabel
      },
      criteria,
      rankings: topAgents,
      totalAgents: sortedMetrics.length,
      clinicStats,
      highlights,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      dataCompleteness: allAnalytics.length >= 2e3 ? "partial" : "complete",
      warning: allAnalytics.length >= 2e3 ? "Large dataset - results may be incomplete. Consider using a shorter time period." : void 0
    };
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("[getAgentRankings] Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Failed to fetch agent rankings",
        error: error.message
      })
    };
  }
}
async function fetchClinicCallAnalytics(clinicId, startTime, endTime) {
  const allAnalytics = [];
  let lastEvaluatedKey = void 0;
  let pageCount = 0;
  const MAX_PAGES = 20;
  do {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: ANALYTICS_TABLE_NAME,
      IndexName: "clinicId-timestamp-index",
      KeyConditionExpression: "clinicId = :clinicId AND #ts BETWEEN :start AND :end",
      ExpressionAttributeNames: { "#ts": "timestamp" },
      ExpressionAttributeValues: {
        ":clinicId": clinicId,
        ":start": startTime,
        ":end": endTime
      },
      Limit: 100,
      ExclusiveStartKey: lastEvaluatedKey
    }));
    if (queryResult.Items) {
      allAnalytics.push(...queryResult.Items);
    }
    lastEvaluatedKey = queryResult.LastEvaluatedKey;
    pageCount++;
  } while (lastEvaluatedKey && pageCount < MAX_PAGES);
  return allAnalytics;
}
function calculateAgentRankingMetrics(agentId, calls, clinicId, todayCalls = [], presence, nameInfo) {
  const totalCalls = calls.length;
  const completedCalls = calls.filter((c) => c.callStatus === "completed").length;
  const missedCalls = calls.filter((c) => c.callStatus === "abandoned" || c.callStatus === "failed").length;
  const callsToday = todayCalls.length;
  const missedToday = todayCalls.filter((c) => c.callStatus === "abandoned" || c.callStatus === "failed").length;
  const totalDuration = calls.reduce((sum, c) => sum + (c.totalDuration || 0), 0);
  const totalTalkTime = calls.reduce((sum, c) => sum + (c.talkTime || c.speakerMetrics?.agentTalkPercentage / 100 * (c.totalDuration || 0) || 0), 0);
  const totalHoldTime = calls.reduce((sum, c) => sum + (c.holdTime || 0), 0);
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  calls.forEach((c) => {
    const sentiment = c.overallSentiment?.toLowerCase() || "neutral";
    if (sentimentCounts[sentiment] !== void 0) {
      sentimentCounts[sentiment]++;
    }
  });
  const totalSentimentCalls = sentimentCounts.positive + sentimentCounts.negative + sentimentCounts.neutral + sentimentCounts.mixed;
  const sentimentScore = totalSentimentCalls > 0 ? Math.round((sentimentCounts.positive * 100 + sentimentCounts.neutral * 50 + sentimentCounts.mixed * 50 + sentimentCounts.negative * 0) / totalSentimentCalls) : 50;
  const satisfactionRating = totalSentimentCalls > 0 ? Math.round((sentimentCounts.positive + sentimentCounts.neutral * 0.7) / totalSentimentCalls * 100) : 50;
  const issueCount = calls.reduce((sum, c) => sum + (c.detectedIssues?.length || 0), 0);
  const qualityScores = calls.filter((c) => c.audioQuality?.qualityScore).map((c) => c.audioQuality.qualityScore);
  const qualityScore = qualityScores.length > 0 ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length * 10) / 10 : 3;
  const completionRate = totalCalls > 0 ? completedCalls / totalCalls * 100 : 0;
  const issueFreeFactor = totalCalls > 0 ? Math.max(0, 100 - issueCount / totalCalls * 50) : 100;
  const qualityFactor = (qualityScore - 1) / 4 * 100;
  const performanceScore = Math.round(
    completionRate * 0.4 + sentimentScore * 0.3 + issueFreeFactor * 0.2 + qualityFactor * 0.1
  );
  const avgHandleTime = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
  const firstName = nameInfo?.givenName || "";
  const lastName = nameInfo?.familyName || "";
  const agentName = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || agentId.split("@")[0];
  const initials = getInitials(firstName, lastName, agentId);
  const { status, statusLabel } = formatAgentStatus(presence?.status);
  return {
    rank: 0,
    // Will be assigned after sorting
    rankLabel: "",
    // Will be assigned after sorting
    agentId,
    agentName,
    firstName,
    lastName,
    initials,
    clinicId,
    status,
    statusLabel,
    performanceScore: Math.min(100, Math.max(0, performanceScore)),
    totalCalls,
    completedCalls,
    missedCalls,
    callsToday,
    missedToday,
    sentimentScore,
    satisfactionRating,
    positiveCallsPercent: totalSentimentCalls > 0 ? Math.round(sentimentCounts.positive / totalSentimentCalls * 100) : 0,
    negativeCallsPercent: totalSentimentCalls > 0 ? Math.round(sentimentCounts.negative / totalSentimentCalls * 100) : 0,
    avgHandleTime,
    avgHandleTimeFormatted: formatDuration(avgHandleTime),
    avgTalkTime: totalCalls > 0 ? Math.round(totalTalkTime / totalCalls) : 0,
    avgHoldTime: totalCalls > 0 ? Math.round(totalHoldTime / totalCalls) : 0,
    issueCount,
    qualityScore,
    trend: {
      direction: "stable",
      changePercent: 0
    }
  };
}
function sortAgentsByCriteria(agents, criteria) {
  const sortFns = {
    performanceScore: (a, b) => b.performanceScore - a.performanceScore,
    callVolume: (a, b) => b.totalCalls - a.totalCalls,
    sentimentScore: (a, b) => b.sentimentScore - a.sentimentScore,
    avgHandleTime: (a, b) => a.avgHandleTime - b.avgHandleTime,
    // Lower is better
    customerSatisfaction: (a, b) => b.positiveCallsPercent - a.positiveCallsPercent,
    efficiency: (a, b) => {
      const efficiencyA = a.completedCalls / Math.max(1, a.totalCalls) * 100 - a.issueCount * 5;
      const efficiencyB = b.completedCalls / Math.max(1, b.totalCalls) * 100 - b.issueCount * 5;
      return efficiencyB - efficiencyA;
    }
  };
  return [...agents].sort(sortFns[criteria] || sortFns.performanceScore);
}
function calculateAgentBadges(agent, allAgents) {
  const badges = [];
  const earnedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (agent.rank === 1) {
    badges.push({ ...AGENT_BADGES.TOP_PERFORMER, earnedAt });
  }
  if (agent.totalCalls >= 100) {
    badges.push({ ...AGENT_BADGES.CALL_CHAMPION, earnedAt });
  }
  if (agent.positiveCallsPercent >= 90) {
    badges.push({ ...AGENT_BADGES.SENTIMENT_STAR, earnedAt });
  }
  const avgHandleTime = allAgents.reduce((sum, a) => sum + a.avgHandleTime, 0) / allAgents.length;
  if (agent.avgHandleTime < avgHandleTime * 0.8 && agent.qualityScore >= 3.5) {
    badges.push({ ...AGENT_BADGES.SPEED_DEMON, earnedAt });
  }
  if (agent.trend.direction === "up" && agent.trend.changePercent >= 20) {
    badges.push({ ...AGENT_BADGES.RISING_STAR, earnedAt });
  }
  if (agent.totalCalls >= 10 && agent.issueCount === 0) {
    badges.push({ ...AGENT_BADGES.ZERO_ISSUES, earnedAt });
  }
  if (agent.positiveCallsPercent >= 95 && agent.totalCalls >= 20) {
    badges.push({ ...AGENT_BADGES.CUSTOMER_FAVORITE, earnedAt });
  }
  return badges;
}
function calculateClinicStats(analytics) {
  if (analytics.length === 0) {
    return {
      avgPerformanceScore: 0,
      totalCalls: 0,
      avgSentimentScore: 0,
      avgHandleTime: 0
    };
  }
  const totalCalls = analytics.length;
  const totalDuration = analytics.reduce((sum, c) => sum + (c.totalDuration || 0), 0);
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  analytics.forEach((c) => {
    const sentiment = c.overallSentiment?.toLowerCase() || "neutral";
    if (sentimentCounts[sentiment] !== void 0) {
      sentimentCounts[sentiment]++;
    }
  });
  const totalSentimentCalls = Object.values(sentimentCounts).reduce((a, b) => a + b, 0);
  const avgSentimentScore = totalSentimentCalls > 0 ? Math.round((sentimentCounts.positive * 100 + sentimentCounts.neutral * 50 + sentimentCounts.mixed * 50 + sentimentCounts.negative * 0) / totalSentimentCalls) : 50;
  const completedCalls = analytics.filter((c) => c.callStatus === "completed").length;
  const completionRate = completedCalls / totalCalls * 100;
  const avgPerformanceScore = Math.round(completionRate * 0.5 + avgSentimentScore * 0.5);
  return {
    avgPerformanceScore,
    totalCalls,
    avgSentimentScore,
    avgHandleTime: Math.round(totalDuration / totalCalls)
  };
}
function calculateHighlights(sortedAgents) {
  if (sortedAgents.length === 0) {
    return {
      topPerformer: null,
      mostImproved: null,
      callLeader: null,
      sentimentLeader: null
    };
  }
  const topPerformer = sortedAgents[0];
  const mostImproved = [...sortedAgents].filter((a) => a.trend.direction === "up").sort((a, b) => b.trend.changePercent - a.trend.changePercent)[0] || null;
  const callLeader = [...sortedAgents].sort((a, b) => b.totalCalls - a.totalCalls)[0] || null;
  const sentimentLeader = [...sortedAgents].sort((a, b) => b.sentimentScore - a.sentimentScore)[0] || null;
  return {
    topPerformer,
    mostImproved,
    callLeader,
    sentimentLeader
  };
}
function getPeriodConfig(period, now) {
  const nowDate = new Date(now * 1e3);
  switch (period) {
    case "daily": {
      const startOfDay = new Date(nowDate);
      startOfDay.setHours(0, 0, 0, 0);
      return {
        startTime: Math.floor(startOfDay.getTime() / 1e3),
        endTime: now,
        label: `Today (${nowDate.toLocaleDateString()})`
      };
    }
    case "weekly": {
      const startOfWeek = new Date(nowDate);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return {
        startTime: Math.floor(startOfWeek.getTime() / 1e3),
        endTime: now,
        label: `Week of ${startOfWeek.toLocaleDateString()}`
      };
    }
    case "monthly": {
      const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
      return {
        startTime: Math.floor(startOfMonth.getTime() / 1e3),
        endTime: now,
        label: `${nowDate.toLocaleString("default", { month: "long" })} ${nowDate.getFullYear()}`
      };
    }
    case "quarterly": {
      const quarter = Math.floor(nowDate.getMonth() / 3);
      const startOfQuarter = new Date(nowDate.getFullYear(), quarter * 3, 1);
      return {
        startTime: Math.floor(startOfQuarter.getTime() / 1e3),
        endTime: now,
        label: `Q${quarter + 1} ${nowDate.getFullYear()}`
      };
    }
    case "yearly": {
      const startOfYear = new Date(nowDate.getFullYear(), 0, 1);
      return {
        startTime: Math.floor(startOfYear.getTime() / 1e3),
        endTime: now,
        label: `${nowDate.getFullYear()}`
      };
    }
    default:
      const defaultStart = new Date(nowDate);
      defaultStart.setDate(defaultStart.getDate() - 7);
      return {
        startTime: Math.floor(defaultStart.getTime() / 1e3),
        endTime: now,
        label: `Last 7 days`
      };
  }
}
function getPreviousPeriod(period, currentStart, currentEnd) {
  const duration = currentEnd - currentStart;
  return {
    startTime: currentStart - duration,
    endTime: currentStart - 1
  };
}
function getTodayStartTimestamp() {
  const now = /* @__PURE__ */ new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1e3);
}
async function fetchAgentPresenceData(agentIds, clinicId) {
  const presenceMap = /* @__PURE__ */ new Map();
  if (!AGENT_PRESENCE_TABLE_NAME || agentIds.length === 0) {
    return presenceMap;
  }
  try {
    const batches = [];
    for (let i = 0; i < agentIds.length; i += 100) {
      batches.push(agentIds.slice(i, i + 100));
    }
    for (const batch of batches) {
      const keys = batch.map((agentId) => ({ agentId }));
      const result = await ddb.send(new BatchGetCommand({
        RequestItems: {
          [AGENT_PRESENCE_TABLE_NAME]: {
            Keys: keys,
            ProjectionExpression: "agentId, #status",
            ExpressionAttributeNames: { "#status": "status" }
          }
        }
      }));
      const responses = result.Responses?.[AGENT_PRESENCE_TABLE_NAME] || [];
      responses.forEach((item) => {
        presenceMap.set(item.agentId, { status: item.status || "Offline" });
      });
    }
    agentIds.forEach((agentId) => {
      if (!presenceMap.has(agentId)) {
        presenceMap.set(agentId, { status: "Offline" });
      }
    });
  } catch (error) {
    console.error("[fetchAgentPresenceData] Error:", error.message);
  }
  return presenceMap;
}
async function fetchAgentNames(agentIds) {
  const namesMap = /* @__PURE__ */ new Map();
  if (!STAFF_USER_TABLE_NAME || agentIds.length === 0) {
    return namesMap;
  }
  try {
    const batches = [];
    for (let i = 0; i < agentIds.length; i += 100) {
      batches.push(agentIds.slice(i, i + 100));
    }
    for (const batch of batches) {
      const keys = batch.map((email) => ({ email: email.toLowerCase() }));
      try {
        const result = await ddb.send(new BatchGetCommand({
          RequestItems: {
            [STAFF_USER_TABLE_NAME]: {
              Keys: keys,
              ProjectionExpression: "email, givenName, familyName"
            }
          }
        }));
        const responses = result.Responses?.[STAFF_USER_TABLE_NAME] || [];
        responses.forEach((item) => {
          namesMap.set(item.email, {
            givenName: item.givenName,
            familyName: item.familyName
          });
        });
        const unprocessedKeys = result.UnprocessedKeys?.[STAFF_USER_TABLE_NAME]?.Keys;
        if (unprocessedKeys && unprocessedKeys.length > 0) {
          console.warn("[fetchAgentNames] Some keys were not processed:", {
            unprocessedCount: unprocessedKeys.length,
            totalInBatch: batch.length
          });
        }
      } catch (batchErr) {
        if (batchErr.name === "ValidationException" && batchErr.message.includes("key")) {
          console.error("[fetchAgentNames] Table schema mismatch - email may not be the partition key:", {
            tableName: STAFF_USER_TABLE_NAME,
            error: batchErr.message,
            hint: "Verify STAFF_USER_TABLE schema has email as partition key"
          });
          return namesMap;
        }
        throw batchErr;
      }
    }
  } catch (error) {
    console.error("[fetchAgentNames] Error fetching agent names:", {
      error: error.message,
      tableName: STAFF_USER_TABLE_NAME,
      agentCount: agentIds.length
    });
  }
  return namesMap;
}
function formatRankLabel(rank) {
  if (rank === 1)
    return "1st";
  if (rank === 2)
    return "2nd";
  if (rank === 3)
    return "3rd";
  return `#${rank}`;
}
function formatDuration(seconds) {
  if (seconds < 0)
    return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
function getInitials(firstName, lastName, email) {
  if (firstName && lastName) {
    return `${firstName.charAt(0).toUpperCase()}${lastName.charAt(0).toUpperCase()}`;
  }
  if (firstName) {
    return firstName.substring(0, 2).toUpperCase();
  }
  if (lastName) {
    return lastName.substring(0, 2).toUpperCase();
  }
  const emailName = email.split("@")[0];
  return emailName.substring(0, 2).toUpperCase();
}
function formatAgentStatus(status) {
  const normalizedStatus = status?.toLowerCase() || "offline";
  switch (normalizedStatus) {
    case "online":
      return { status: "Available", statusLabel: "Available" };
    case "oncall":
    case "on_call":
      return { status: "OnCall", statusLabel: "On Call" };
    case "ringing":
      return { status: "ringing", statusLabel: "Ringing" };
    case "dialing":
      return { status: "dialing", statusLabel: "Dialing" };
    case "busy":
      return { status: "Busy", statusLabel: "Busy" };
    case "offline":
    default:
      return { status: "Offline", statusLabel: "Offline" };
  }
}
async function getQueueCalls(event, userPerms, corsHeaders) {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "clinicId query parameter is required",
        error: "MISSING_CLINIC_ID"
      })
    };
  }
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Forbidden: You do not have access to this clinic",
        error: "INSUFFICIENT_PERMISSIONS"
      })
    };
  }
  if (!CALL_QUEUE_TABLE_NAME) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Call queue table not configured",
        error: "MISSING_CONFIGURATION"
      })
    };
  }
  const statusFilter = queryParams.status || "all";
  const limit = Math.min(parseInt(queryParams.limit || "100", 10), 500);
  console.log("[getQueueCalls] Fetching queue calls", {
    clinicId,
    statusFilter,
    limit
  });
  try {
    const allCalls = [];
    let lastEvaluatedKey = void 0;
    do {
      const queryResult = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        KeyConditionExpression: "clinicId = :clinicId",
        ExpressionAttributeValues: {
          ":clinicId": clinicId
        },
        Limit: 200,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      if (queryResult.Items) {
        allCalls.push(...queryResult.Items);
      }
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      if (allCalls.length >= limit * 2)
        break;
    } while (lastEvaluatedKey);
    const now = Date.now();
    const queuedCalls = [];
    const ringingCalls = [];
    const activeCalls = [];
    const onHoldCalls = [];
    let totalWaitTime = 0;
    let waitingCount = 0;
    let longestWait = 0;
    for (const call of allCalls) {
      const callStatus = call.status?.toLowerCase() || "unknown";
      if (["completed", "ended", "abandoned", "failed", "hungup"].includes(callStatus)) {
        continue;
      }
      const queueEntryTime = call.queueEntryTime ? typeof call.queueEntryTime === "number" ? call.queueEntryTime > 9999999999 ? call.queueEntryTime : call.queueEntryTime * 1e3 : new Date(call.queueEntryTime).getTime() : call.queueEntryTimeIso ? new Date(call.queueEntryTimeIso).getTime() : now;
      const waitTime = Math.max(0, Math.floor((now - queueEntryTime) / 1e3));
      const isVip = call.isVip || call.priority === "vip" || call.vipStatus === true;
      const priority = isVip ? "vip" : call.priority || "normal";
      const queueCall = {
        callId: call.callId,
        phoneNumber: call.phoneNumber || call.callerPhone || "Unknown",
        callerName: call.callerName || call.customerName,
        queuePosition: call.queuePosition || 0,
        status: callStatus,
        statusLabel: formatQueueStatus(callStatus),
        priority,
        priorityLabel: formatPriority(priority),
        waitTime,
        waitTimeFormatted: formatDuration(waitTime),
        queuedAt: call.queueEntryTimeIso || new Date(queueEntryTime).toISOString(),
        assignedAgentId: call.assignedAgentId || call.agentId,
        assignedAgentName: call.assignedAgentName,
        direction: call.direction || "inbound",
        isVip,
        callbackRequested: call.callbackRequested || false
      };
      switch (callStatus) {
        case "queued":
        case "waiting":
          queuedCalls.push(queueCall);
          totalWaitTime += waitTime;
          waitingCount++;
          longestWait = Math.max(longestWait, waitTime);
          break;
        case "ringing":
          ringingCalls.push(queueCall);
          break;
        case "connected":
        case "active":
          activeCalls.push(queueCall);
          break;
        case "on_hold":
        case "hold":
          onHoldCalls.push(queueCall);
          break;
      }
    }
    queuedCalls.sort((a, b) => {
      if (a.isVip && !b.isVip)
        return -1;
      if (!a.isVip && b.isVip)
        return 1;
      return a.queuePosition - b.queuePosition;
    });
    let response;
    if (statusFilter !== "all") {
      const filteredCalls = {
        queued: statusFilter === "queued" ? queuedCalls.slice(0, limit) : [],
        ringing: statusFilter === "ringing" ? ringingCalls.slice(0, limit) : [],
        active: statusFilter === "active" ? activeCalls.slice(0, limit) : [],
        on_hold: statusFilter === "on_hold" ? onHoldCalls.slice(0, limit) : []
      };
      response = {
        clinicId,
        queuedCalls: filteredCalls.queued,
        ringingCalls: filteredCalls.ringing,
        activeCalls: filteredCalls.active,
        onHoldCalls: filteredCalls.on_hold,
        summary: {
          totalQueued: queuedCalls.length,
          totalRinging: ringingCalls.length,
          totalActive: activeCalls.length,
          totalOnHold: onHoldCalls.length,
          avgWaitTime: waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0,
          avgWaitTimeFormatted: formatDuration(waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0),
          longestWait,
          longestWaitFormatted: formatDuration(longestWait)
        },
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } else {
      response = {
        clinicId,
        queuedCalls: queuedCalls.slice(0, limit),
        ringingCalls: ringingCalls.slice(0, limit),
        activeCalls: activeCalls.slice(0, limit),
        onHoldCalls: onHoldCalls.slice(0, limit),
        summary: {
          totalQueued: queuedCalls.length,
          totalRinging: ringingCalls.length,
          totalActive: activeCalls.length,
          totalOnHold: onHoldCalls.length,
          avgWaitTime: waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0,
          avgWaitTimeFormatted: formatDuration(waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0),
          longestWait,
          longestWaitFormatted: formatDuration(longestWait)
        },
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("[getQueueCalls] Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Failed to fetch queue calls",
        error: error.message
      })
    };
  }
}
function formatQueueStatus(status) {
  switch (status?.toLowerCase()) {
    case "queued":
    case "waiting":
      return "Waiting";
    case "ringing":
      return "Ringing";
    case "connected":
    case "active":
      return "Active";
    case "on_hold":
    case "hold":
      return "On Hold";
    case "transferring":
      return "Transferring";
    default:
      return status || "Unknown";
  }
}
function formatPriority(priority) {
  switch (priority?.toLowerCase()) {
    case "vip":
      return "VIP";
    case "high":
      return "High";
    case "normal":
      return "Normal";
    case "low":
      return "Low";
    default:
      return "Normal";
  }
}
export {
  handler
};
