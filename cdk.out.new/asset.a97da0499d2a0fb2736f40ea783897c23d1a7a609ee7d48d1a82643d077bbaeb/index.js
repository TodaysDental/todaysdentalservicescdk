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

// open-dental/transferAuth.ts
var transferAuth_exports = {};
__export(transferAuth_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(transferAuth_exports);
var handler = async (event) => {
  console.log("Transfer auth event:", JSON.stringify(event, null, 2));
  const userName = event.userName || event.username;
  const password = event.password;
  console.log("Received:", { userName, password: password ? "***set***" : "***not set***" });
  console.log("Expected:", { username: process.env.TF_USERNAME, password: process.env.TF_PASSWORD ? "***set***" : "***not set***" });
  if (userName !== process.env.TF_USERNAME || password !== process.env.TF_PASSWORD) {
    console.log("Auth failed - credentials mismatch");
    return {};
  }
  console.log("Auth successful, returning role and home directory");
  const roleArn = process.env.TF_ROLE_ARN;
  const bucket = process.env.TF_BUCKET;
  const rawPrefix = process.env.TF_PREFIX || `sftp-home/${userName}`;
  const prefix = rawPrefix.replace(/^\/+|\/+$/g, "");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ListUserPrefix",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: [`arn:aws:s3:::${bucket}`],
        Condition: { StringLike: { "s3:prefix": [`${prefix}/*`] } }
      },
      {
        Sid: "RWUserObjects",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource: [`arn:aws:s3:::${bucket}/${prefix}/*`]
      }
    ]
  };
  return {
    Role: roleArn,
    HomeDirectoryType: "LOGICAL",
    HomeDirectoryDetails: JSON.stringify([{ Entry: "/", Target: `/${bucket}/${prefix}` }]),
    Policy: JSON.stringify(policy)
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
