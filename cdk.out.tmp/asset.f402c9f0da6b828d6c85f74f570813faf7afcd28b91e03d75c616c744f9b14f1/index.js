"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/integrations/open-dental/consolidatedTransferAuth.ts
var consolidatedTransferAuth_exports = {};
__export(consolidatedTransferAuth_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(consolidatedTransferAuth_exports);
var handler = async (event) => {
  console.log("Transfer Family Auth Event:", JSON.stringify(event, null, 2));
  const { password, protocol, serverId, sourceIp } = event;
  const username = event.userName || event.username;
  const tfBucket = process.env.TF_BUCKET;
  const tfPassword = process.env.TF_PASSWORD;
  const tfRoleArn = process.env.TF_ROLE_ARN;
  const clinicsConfigStr = process.env.CLINICS_CONFIG;
  if (!tfBucket || !tfPassword || !tfRoleArn || !clinicsConfigStr) {
    console.error("Missing required environment variables");
    return {};
  }
  let clinicsConfig;
  try {
    clinicsConfig = JSON.parse(clinicsConfigStr);
  } catch (error) {
    console.error("Failed to parse clinics configuration:", error);
    return {};
  }
  const legacyPassword = "Clinic@2020!";
  const newPassword = "Clinic2020";
  const isValidPassword = password === tfPassword || password === legacyPassword || password === newPassword;
  if (!isValidPassword) {
    console.log(`Authentication failed for user ${username}: Invalid password`);
    return {};
  }
  if (username === "sftpuser") {
    console.log("Authentication successful for Open Dental sftpuser (TRUE root access)");
    console.log("Home directory: / (true root directory for Open Dental compatibility)");
    const policy2 = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "AllowFullBucketListing",
          Effect: "Allow",
          Action: "s3:ListBucket",
          Resource: `arn:aws:s3:::${tfBucket}`
        },
        {
          Sid: "AllowFullBucketAccess",
          Effect: "Allow",
          Action: [
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:GetObjectVersion",
            "s3:DeleteObjectVersion"
          ],
          Resource: `arn:aws:s3:::${tfBucket}/*`
        }
      ]
    };
    const homeDirDetails = [
      {
        Entry: "/",
        Target: `/${tfBucket}/sftp-home/sftpuser`
      }
    ];
    return {
      Role: tfRoleArn,
      HomeDirectory: "/",
      // TRUE root directory access for Open Dental compatibility
      HomeDirectoryType: "LOGICAL",
      HomeDirectoryDetails: JSON.stringify(homeDirDetails),
      Policy: JSON.stringify(policy2)
    };
  }
  const matchingClinic = clinicsConfig.find(
    (clinic) => clinic.sftpFolderPath === username
  );
  if (!matchingClinic) {
    console.log(`Authentication failed for user ${username}: No matching clinic found`);
    return {};
  }
  const homeDirectory = `/sftp-home/${matchingClinic.sftpFolderPath}`;
  console.log(`Authentication successful for clinic ${matchingClinic.clinicId} (${matchingClinic.clinicName})`);
  console.log(`Home directory: ${homeDirectory}`);
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowListingOfUserFolder",
        Effect: "Allow",
        Action: "s3:ListBucket",
        Resource: `arn:aws:s3:::${tfBucket}`,
        Condition: {
          StringLike: {
            "s3:prefix": [`sftp-home/${matchingClinic.sftpFolderPath}/*`]
          }
        }
      },
      {
        Sid: "HomeDirObjectAccess",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ],
        Resource: `arn:aws:s3:::${tfBucket}/sftp-home/${matchingClinic.sftpFolderPath}/*`
      }
    ]
  };
  return {
    Role: tfRoleArn,
    HomeDirectory: homeDirectory,
    Policy: JSON.stringify(policy)
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
