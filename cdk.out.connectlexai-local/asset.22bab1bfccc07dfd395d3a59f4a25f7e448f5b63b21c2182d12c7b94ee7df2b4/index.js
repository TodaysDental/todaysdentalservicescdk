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

// src/services/lease-management/listLeases.ts
var listLeases_exports = {};
__export(listLeases_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(listLeases_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

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

// src/services/lease-management/listLeases.ts
var client = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client);
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var LEGAL_MODULE = "Legal";
var handler = async (event) => {
  console.log("List Leases Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    const clinicId = event.headers["x-clinic-id"] || event.queryStringParameters?.clinicId;
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      "read",
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId || void 0
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: "Permission denied. Legal module access required." });
    }
    const includeDeleted = event.queryStringParameters?.includeDeleted === "true";
    let allLeases = [];
    let lastEvaluatedKey = void 0;
    do {
      let result;
      if (clinicId) {
        result = await docClient.send(new import_lib_dynamodb.QueryCommand({
          TableName: LEASE_TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":pk": `CLINIC#${clinicId}`, ":sk": "LEASE#" },
          ExclusiveStartKey: lastEvaluatedKey
        }));
      } else {
        result = await docClient.send(new import_lib_dynamodb.ScanCommand({
          TableName: LEASE_TABLE_NAME,
          FilterExpression: "begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":sk": "LEASE#" },
          ExclusiveStartKey: lastEvaluatedKey
        }));
      }
      if (result.Items) {
        allLeases = allLeases.concat(result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    let leases = allLeases;
    if (!includeDeleted) {
      leases = leases.filter((lease) => lease.status !== "Deleted");
    }
    leases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const flattenedData = leases.map((lease) => {
      const clinicId2 = lease.propertyInformation?.clinicId || lease.PK?.replace("CLINIC#", "");
      const leaseId = lease.SK?.replace("LEASE#", "");
      return {
        // Primary keys
        clinicId: clinicId2,
        leaseId,
        PK: lease.PK,
        SK: lease.SK,
        entityType: lease.entityType,
        // Property Information (flattened)
        clinicName: lease.propertyInformation?.clinicName || "",
        practiceId: lease.propertyInformation?.practiceId || "",
        propertyId: lease.propertyInformation?.propertyId || "",
        address: lease.propertyInformation?.address || "",
        addressLine2: lease.propertyInformation?.addressLine2 || "",
        city: lease.propertyInformation?.city || "",
        state: lease.propertyInformation?.state || "",
        zip: lease.propertyInformation?.zip || "",
        propertyType: lease.propertyInformation?.propertyType || "",
        landlord: lease.propertyInformation?.landlord || "",
        propertyManager: lease.propertyInformation?.propertyManager || "",
        parkingSpaces: lease.propertyInformation?.parkingSpaces || "",
        // Financial Details (flattened)
        currentRentInclCAM: lease.financialDetails?.currentRentInclCAM || 0,
        baseRent: lease.financialDetails?.baseRent || 0,
        baseRentPerSqFt: lease.financialDetails?.baseRentPerSqFt || 0,
        camCharges: lease.financialDetails?.camCharges || 0,
        maintenanceCharges: lease.financialDetails?.maintenanceCharges || 0,
        realEstateTaxes: lease.financialDetails?.realEstateTaxes || 0,
        utilities: lease.financialDetails?.utilities || 0,
        insurance: lease.financialDetails?.insurance || 0,
        totalLeaseLiability: lease.financialDetails?.totalLeaseLiability || 0,
        securityDeposit: lease.financialDetails?.securityDeposit || 0,
        depositRefundable: lease.financialDetails?.depositRefundable || false,
        // Lease Terms (flattened)
        originalLeaseDate: lease.leaseTerms?.originalLeaseDate || "",
        startDate: lease.leaseTerms?.startDate || "",
        endDate: lease.leaseTerms?.endDate || "",
        termLength: lease.leaseTerms?.termLength || "",
        leaseType: lease.leaseTerms?.leaseType || "",
        status: lease.leaseTerms?.status || lease.status || "",
        sqft: lease.leaseTerms?.sqft || 0,
        totalSqft: lease.leaseTerms?.totalSqft || 0,
        renewalRequestStartDate: lease.leaseTerms?.renewalRequestStartDate || "",
        renewalRequestEndDate: lease.leaseTerms?.renewalRequestEndDate || "",
        renewalTerms: lease.leaseTerms?.renewalTerms || "",
        // Renewal Information (flattened)
        renewalRequestStart: lease.renewalInformation?.requestStartDate || "",
        renewalFinalDate: lease.renewalInformation?.finalDate || "",
        renewalSubmissionDate: lease.renewalInformation?.submissionDate || "",
        // Payment Terms (flattened)
        rentDueDate: lease.paymentTerms?.rentDueDate || "",
        lateCharges: lease.paymentTerms?.lateCharges || "",
        interestRate: lease.paymentTerms?.interestRate || "",
        failedCheckFee: lease.paymentTerms?.failedCheckFee || "",
        // Clauses (flattened)
        exclusiveUse: lease.clauses?.exclusiveUse || "",
        daysOfOperation: lease.clauses?.daysOfOperation || "",
        assignmentFee: lease.clauses?.assignmentFee || 0,
        guaranteeType: lease.clauses?.guaranteeType || "",
        // Hidden Charges (flattened)
        signageFee: lease.hiddenCharges?.signageFee || 0,
        trashPickup: lease.hiddenCharges?.trashPickup || 0,
        marketingFund: lease.hiddenCharges?.marketingFund || 0,
        snowRemoval: lease.hiddenCharges?.snowRemoval || 0,
        merchantAssociationFee: lease.hiddenCharges?.merchantAssociationFee || 0,
        // Notes and Remarks (flattened)
        notes: lease.notesAndRemarks?.notes || "",
        remarks: lease.notesAndRemarks?.remarks || "",
        // Convenience: rent alias for table display
        rent: lease.financialDetails?.currentRentInclCAM || lease.financialDetails?.baseRent || 0,
        // Counts for quick reference
        documentsCount: lease.documents?.length || 0,
        assetsCount: lease.assets?.length || 0,
        eventsCount: lease.events?.length || 0,
        contactsCount: lease.contacts?.length || 0,
        // Arrays (keep as arrays - can't flatten)
        documents: lease.documents || [],
        assets: lease.assets || [],
        events: lease.events || [],
        contacts: lease.contacts || [],
        // Custom fields (spread at top level)
        ...lease.customFields,
        // Also spread any custom fields from nested objects
        ...lease.propertyInformation ? Object.fromEntries(
          Object.entries(lease.propertyInformation).filter(
            ([key]) => ![
              "clinicId",
              "clinicName",
              "practiceId",
              "propertyId",
              "address",
              "addressLine2",
              "city",
              "state",
              "zip",
              "propertyType",
              "landlord",
              "propertyManager",
              "parkingSpaces"
            ].includes(key)
          )
        ) : {},
        ...lease.financialDetails ? Object.fromEntries(
          Object.entries(lease.financialDetails).filter(
            ([key]) => ![
              "currentRentInclCAM",
              "baseRent",
              "baseRentPerSqFt",
              "camCharges",
              "maintenanceCharges",
              "realEstateTaxes",
              "utilities",
              "insurance",
              "totalLeaseLiability",
              "securityDeposit",
              "depositRefundable"
            ].includes(key)
          )
        ) : {},
        ...lease.leaseTerms ? Object.fromEntries(
          Object.entries(lease.leaseTerms).filter(
            ([key]) => ![
              "originalLeaseDate",
              "startDate",
              "endDate",
              "termLength",
              "leaseType",
              "status",
              "sqft",
              "totalSqft",
              "renewalRequestStartDate",
              "renewalRequestEndDate",
              "renewalTerms"
            ].includes(key)
          )
        ) : {},
        // Timestamps and audit info
        createdAt: lease.createdAt,
        updatedAt: lease.updatedAt,
        createdBy: lease.createdBy || "",
        lastModifiedBy: lease.lastModifiedBy || "",
        deletedBy: lease.deletedBy,
        deletedAt: lease.deletedAt
      };
    });
    return createResponse(200, {
      success: true,
      data: flattenedData,
      count: flattenedData.length
    });
  } catch (error) {
    console.error("Error listing leases:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-clinic-id"
    },
    body: JSON.stringify(body)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
