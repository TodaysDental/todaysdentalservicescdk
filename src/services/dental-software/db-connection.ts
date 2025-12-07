// @ts-ignore - mysql2 is provided by Lambda layer
import mysql from 'mysql2/promise';

/**
 * Database connection configuration
 */
export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Get database configuration from environment variables
 */
export function getDbConfig(): DbConfig {
  return {
    host: process.env.DB_HOST || '',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dental_software',
  };
}

/**
 * Create a new database connection
 */
export async function createConnection() {
  const config = getDbConfig();
  
  try {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    });

    return connection;
  } catch (error) {
    console.error('Failed to create database connection:', error);
    throw error;
  }
}

/**
 * Execute a query with automatic connection management
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = []
): Promise<T> {
  const connection = await createConnection();
  
  try {
    const [results] = await connection.execute(query, params);
    return results as T;
  } finally {
    await connection.end();
  }
}

/**
 * Initialize the clinic table if it doesn't exist
 */
export async function initializeClinicTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS clinic (
      ClinicNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      Address VARCHAR(255),
      Address2 VARCHAR(255),
      City VARCHAR(255),
      State VARCHAR(255),
      Zip VARCHAR(255),
      Phone VARCHAR(255),
      BankNumber VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description),
      INDEX idx_city (City),
      INDEX idx_state (State)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the definition table if it doesn't exist
 */
export async function initializeDefinitionTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS definition (
      DefNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Category TINYINT NOT NULL,
      ItemOrder SMALLINT NOT NULL DEFAULT 0,
      ItemName VARCHAR(255) NOT NULL,
      ItemValue VARCHAR(255),
      ItemColor INT(11),
      IsHidden TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (Category),
      INDEX idx_category_order (Category, ItemOrder),
      INDEX idx_category_hidden (Category, IsHidden),
      INDEX idx_itemname (ItemName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}


/**
 * Initialize the account table if it doesn't exist
 * Schema based on Chart of Accounts for accounting section
 */
export async function initializeAccountTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS account (
      AccountNum BIGINT(20) PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      AcctType TINYINT NOT NULL,
      BankNumber VARCHAR(255),
      Inactive TINYINT DEFAULT 0,
      AccountColor INT(11),
      IsRetainedEarnings TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description),
      INDEX idx_accttype (AcctType)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the accountingautopay table if it doesn't exist
 * Automates entries into the database when user enters a payment into a patient account
 */
export async function initializeAccountingAutoPayTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS accountingautopay (
      AccountingAutoPayNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      PayType BIGINT(20) NOT NULL,
      PickList VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_paytype (PayType),
      FOREIGN KEY (PayType) REFERENCES definition(DefNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the userod table if it doesn't exist
 * Users are separate from providers/employees but can link to them.
 */
export async function initializeUserodTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS userod (
      UserNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      UserName VARCHAR(255) NOT NULL UNIQUE,
      Password VARCHAR(255) NOT NULL,
      UserGroupNum BIGINT(20) DEFAULT 0,
      EmployeeNum BIGINT(20) DEFAULT 0,
      ClinicNum BIGINT(20) DEFAULT 0,
      ProvNum BIGINT(20) DEFAULT 0,
      IsHidden TINYINT(1) DEFAULT 0,
      TaskListInBox BIGINT(20) DEFAULT 0,
      AnesthProvType INT(2) DEFAULT 3,
      DefaultHidePopups TINYINT(4) DEFAULT 0,
      PasswordIsStrong TINYINT(4) DEFAULT 0,
      ClinicIsRestricted TINYINT(4) DEFAULT 0,
      InboxHidePopups TINYINT(4) DEFAULT 0,
      UserNumCEMT BIGINT(20) DEFAULT 0,
      DateTFail DATETIME NULL,
      FailedAttempts TINYINT DEFAULT 0,
      DomainUser VARCHAR(255),
      IsPasswordResetRequired TINYINT(4) DEFAULT 0,
      MobileWebPin VARCHAR(255),
      MobileWebPinFailedAttempts TINYINT DEFAULT 0,
      DateTLastLogin DATETIME NULL,
      EClipboardClinicalPin VARCHAR(128),
      BadgeId VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (UserName),
      INDEX idx_employee (EmployeeNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_provider (ProvNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the activeinstance table if it doesn't exist
 * Tracks OD sessions per user/computer/process.
 */
export async function initializeActiveInstanceTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS activeinstance (
      ActiveInstanceNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ComputerNum BIGINT(20) NOT NULL,
      UserNum BIGINT(20) NOT NULL,
      ProcessId BIGINT(20) NOT NULL,
      DateTimeLastActive DATETIME NOT NULL,
      DateTRecorded DATETIME NOT NULL,
      ConnectionType TINYINT(4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_computer (ComputerNum),
      INDEX idx_user (UserNum),
      INDEX idx_process (ProcessId),
      INDEX idx_last_active (DateTimeLastActive),
      FOREIGN KEY (UserNum) REFERENCES userod(UserNum) ON DELETE CASCADE,
      FOREIGN KEY (ComputerNum) REFERENCES computers(ComputerNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the adjustment table if it doesn't exist
 * Patient account adjustments, may attach to procedures.
 */
export async function initializeAdjustmentTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS adjustment (
      AdjNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AdjDate DATE NOT NULL,
      AdjAmt DOUBLE NOT NULL,
      PatNum BIGINT(20) NOT NULL,
      AdjType BIGINT(20) NOT NULL,
      ProvNum BIGINT(20) DEFAULT 0,
      AdjNote TEXT,
      ProcDate DATE NULL,
      ProcNum BIGINT(20) DEFAULT 0,
      DateEntry DATE NOT NULL DEFAULT (CURRENT_DATE),
      ClinicNum BIGINT(20) DEFAULT 0,
      StatementNum BIGINT(20) DEFAULT 0,
      SecUserNumEntry BIGINT(20) DEFAULT 0,
      SecDateTEdit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      TaxTransID BIGINT(20) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_patnum (PatNum),
      INDEX idx_adjtype (AdjType),
      INDEX idx_provnum (ProvNum),
      INDEX idx_procnum (ProcNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_statement (StatementNum),
      INDEX idx_secuser (SecUserNumEntry),
      INDEX idx_date (AdjDate)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the alertcategory table if it doesn't exist
 * Groups alert types that users can subscribe to.
 */
export async function initializeAlertCategoryTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS alertcategory (
      AlertCategoryNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      IsHQCategory TINYINT(4) NOT NULL DEFAULT 0,
      InternalName VARCHAR(255),
      Description VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description),
      INDEX idx_internalname (InternalName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the alertcategorylink table if it doesn't exist
 * Each row is an alert type associated to an alertcategory.
 */
export async function initializeAlertCategoryLinkTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS alertcategorylink (
      AlertCategoryLinkNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AlertCategoryNum BIGINT(20) NOT NULL,
      AlertType TINYINT(4) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (AlertCategoryNum),
      INDEX idx_alerttype (AlertType),
      FOREIGN KEY (AlertCategoryNum) REFERENCES alertcategory(AlertCategoryNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the alertitem table if it doesn't exist
 * Each row is an actionable alert shown to users.
 */
export async function initializeAlertItemTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS alertitem (
      AlertItemNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ClinicNum BIGINT(20) NOT NULL DEFAULT 0,
      Description VARCHAR(2000) NOT NULL,
      Type TINYINT(4) NOT NULL,
      Severity TINYINT(4) NOT NULL DEFAULT 0,
      Actions TINYINT(4) NOT NULL DEFAULT 0,
      FormToOpen TINYINT(4) NOT NULL DEFAULT 0,
      FKey BIGINT(20) NOT NULL DEFAULT 0,
      ItemValue VARCHAR(4000),
      UserNum BIGINT(20) NOT NULL DEFAULT 0,
      SecDateTEntry DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clinic (ClinicNum),
      INDEX idx_type (Type),
      INDEX idx_user (UserNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the alertread table if it doesn't exist
 * Tracks which users have read which alert items.
 */
export async function initializeAlertReadTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS alertread (
      AlertReadNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AlertItemNum BIGINT(20) NOT NULL,
      UserNum BIGINT(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_alertitem (AlertItemNum),
      INDEX idx_user (UserNum),
      FOREIGN KEY (AlertItemNum) REFERENCES alertitem(AlertItemNum) ON DELETE CASCADE,
      FOREIGN KEY (UserNum) REFERENCES userod(UserNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the alertsub table if it doesn't exist
 * Subscribes a user (and optional clinic) to alert categories.
 */
export async function initializeAlertSubTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS alertsub (
      AlertSubNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      UserNum BIGINT(20) NOT NULL,
      ClinicNum BIGINT(20) NOT NULL DEFAULT 0,
      Type TINYINT(4) DEFAULT 0,
      AlertCategoryNum BIGINT(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (UserNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_category (AlertCategoryNum),
      FOREIGN KEY (UserNum) REFERENCES userod(UserNum) ON DELETE CASCADE,
      FOREIGN KEY (ClinicNum) REFERENCES clinic(ClinicNum) ON DELETE CASCADE,
      FOREIGN KEY (AlertCategoryNum) REFERENCES alertcategory(AlertCategoryNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the allergy table if it doesn't exist
 * Patient allergy records linked to allergy definitions.
 */
export async function initializeAllergyTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS allergy (
      AllergyNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AllergyDefNum BIGINT(20) NOT NULL,
      PatNum BIGINT(20) NOT NULL,
      Reaction VARCHAR(255),
      StatusIsActive TINYINT(4) NOT NULL DEFAULT 1,
      DateTStamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      DateAdverseReaction DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_patient (PatNum),
      INDEX idx_allergydef (AllergyDefNum),
      INDEX idx_status (StatusIsActive),
      FOREIGN KEY (AllergyDefNum) REFERENCES allergydef(AllergyDefNum) ON DELETE CASCADE,
      FOREIGN KEY (PatNum) REFERENCES patient(PatNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the allergydef table if it doesn't exist
 * Allergy definition master list.
 */
export async function initializeAllergyDefTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS allergydef (
      AllergyDefNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      ICD9Code VARCHAR(255),
      SNOMEDCTCode VARCHAR(255),
      IsHidden TINYINT(4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description),
      INDEX idx_hidden (IsHidden)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apikey table if it doesn't exist
 * Stores customer API keys and developer names.
 */
export async function initializeAPIKeyTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apikey (
      APIKeyNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      CustApiKey VARCHAR(255) NOT NULL,
      DevName VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_custapikey (CustApiKey),
      INDEX idx_devname (DevName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apisubscription table if it doesn't exist
 * Tracks API subscriptions for events.
 */
export async function initializeApiSubscriptionTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apisubscription (
      ApiSubscriptionNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      EndPointUrl VARCHAR(255) NOT NULL,
      Workstation VARCHAR(255),
      CustomerKey VARCHAR(255) NOT NULL,
      WatchTable VARCHAR(255) NOT NULL,
      PollingSeconds INT(11) NOT NULL,
      UiEventType VARCHAR(255) NOT NULL,
      DateTimeStart DATETIME NULL,
      DateTimeStop DATETIME NULL,
      Note VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customerkey (CustomerKey),
      INDEX idx_watchtable (WatchTable),
      INDEX idx_uieventtype (UiEventType)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the appointment table if it doesn't exist
 * Core appointment scheduling table.
 */
export async function initializeAppointmentTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS appointment (
      AptNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      PatNum BIGINT(20) NOT NULL,
      AptStatus TINYINT NOT NULL,
      Pattern VARCHAR(255) NOT NULL,
      Confirmed BIGINT(20),
      TimeLocked TINYINT(1) DEFAULT 0,
      Op BIGINT(20),
      Note TEXT,
      ProvNum BIGINT(20),
      ProvHyg BIGINT(20),
      AptDateTime DATETIME,
      NextAptNum BIGINT(20) DEFAULT 0,
      UnschedStatus BIGINT(20) DEFAULT 0,
      IsNewPatient TINYINT DEFAULT 0,
      ProcDescript TEXT,
      Assistant BIGINT(20) DEFAULT 0,
      ClinicNum BIGINT(20) DEFAULT 0,
      IsHygiene TINYINT DEFAULT 0,
      DateTStamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      DateTimeArrived DATETIME,
      DateTimeSeated DATETIME,
      DateTimeDismissed DATETIME,
      InsPlan1 BIGINT(20) DEFAULT 0,
      InsPlan2 BIGINT(20) DEFAULT 0,
      DateTimeAskedToArrive DATETIME,
      ProcsColored TEXT,
      ColorOverride INT(11) DEFAULT 0,
      AppointmentTypeNum BIGINT(20) DEFAULT 0,
      SecUserNumEntry BIGINT(20) DEFAULT 0,
      SecDateTEntry DATETIME DEFAULT CURRENT_TIMESTAMP,
      Priority TINYINT DEFAULT 0,
      ProvBarText VARCHAR(60),
      PatternSecondary VARCHAR(255),
      SecurityHash VARCHAR(255),
      ItemOrderPlanned INT(11) DEFAULT 0,
      IsMirrored TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_patnum (PatNum),
      INDEX idx_aptdatetime (AptDateTime),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_provnum (ProvNum),
      INDEX idx_status (AptStatus)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the appointmentrule table if it doesn't exist
 * Blocks double booking based on code ranges.
 */
export async function initializeAppointmentRuleTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS appointmentrule (
      AppointmentRuleNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      RuleDesc VARCHAR(255) NOT NULL,
      CodeStart VARCHAR(15) NOT NULL,
      CodeEnd VARCHAR(15) NOT NULL,
      IsEnabled TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_codestart (CodeStart),
      INDEX idx_codeend (CodeEnd),
      INDEX idx_enabled (IsEnabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the appointmenttype table if it doesn't exist
 */
export async function initializeAppointmentTypeTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS appointmenttype (
      AppointmentTypeNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AppointmentTypeName VARCHAR(255) NOT NULL,
      AppointmentTypeColor INT(11),
      ItemOrder INT(11) DEFAULT 0,
      IsHidden TINYINT(4) DEFAULT 0,
      Pattern VARCHAR(255),
      CodeStr VARCHAR(4000),
      CodeStrRequired VARCHAR(4000),
      RequiredProcCodesNeeded TINYINT(4) DEFAULT 0,
      BlockoutTypes VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_name (AppointmentTypeName),
      INDEX idx_hidden (IsHidden),
      INDEX idx_itemorder (ItemOrder)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptfielddef table if it doesn't exist
 */
export async function initializeApptFieldDefTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptfielddef (
      ApptFieldDefNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      FieldName VARCHAR(255) NOT NULL,
      FieldType TINYINT(4) NOT NULL,
      PickList TEXT,
      ItemOrder INT(11) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX uniq_fieldname (FieldName),
      INDEX idx_itemorder (ItemOrder)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptfield table if it doesn't exist
 */
export async function initializeApptFieldTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptfield (
      ApptFieldNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AptNum BIGINT(20) NOT NULL,
      FieldName VARCHAR(255) NOT NULL,
      FieldValue TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_apt (AptNum),
      INDEX idx_fieldname (FieldName),
      FOREIGN KEY (AptNum) REFERENCES appointment(AptNum) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptgeneralmessagesent table if it doesn't exist
 * Stores sent general messages for appointments to avoid re-sends.
 */
export async function initializeApptGeneralMessageSentTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptgeneralmessagesent (
      ApptGeneralMessageSentNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ApptNum BIGINT(20) NOT NULL,
      PatNum BIGINT(20) NOT NULL,
      ClinicNum BIGINT(20) NOT NULL,
      DateTimeEntry DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      TSPrior BIGINT(20) DEFAULT 0,
      ApptReminderRuleNum BIGINT(20) DEFAULT 0,
      SendStatus TINYINT(4) DEFAULT 0,
      ApptDateTime DATETIME,
      MessageType TINYINT(4) DEFAULT 0,
      MessageFk BIGINT(20) DEFAULT 0,
      DateTimeSent DATETIME,
      ResponseDescript TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_appt (ApptNum),
      INDEX idx_pat (PatNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_rule (ApptReminderRuleNum),
      INDEX idx_status (SendStatus),
      INDEX idx_apptdatetime (ApptDateTime)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptreminderrule table if it doesn't exist
 */
export async function initializeApptReminderRuleTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptreminderrule (
      ApptReminderRuleNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      TypeCur TINYINT(4) NOT NULL,
      TSPrior BIGINT(20) NOT NULL,
      SendOrder VARCHAR(255) NOT NULL,
      IsSendAll TINYINT(4) DEFAULT 0,
      TemplateSMS TEXT,
      TemplateEmailSubject TEXT,
      TemplateEmail TEXT,
      ClinicNum BIGINT(20) DEFAULT 0,
      TemplateSMSAggShared TEXT,
      TemplateSMSAggPerAppt TEXT,
      TemplateEmailSubjAggShared TEXT,
      TemplateEmailAggShared TEXT,
      TemplateEmailAggPerAppt TEXT,
      DoNotSendWithin BIGINT(20) DEFAULT 0,
      IsEnabled TINYINT(4) DEFAULT 1,
      TemplateAutoReply TEXT,
      TemplateAutoReplyAgg TEXT,
      IsAutoReplyEnabled TINYINT(4) DEFAULT 0,
      Language VARCHAR(255),
      TemplateComeInMessage TEXT,
      EmailTemplateType VARCHAR(255),
      AggEmailTemplateType VARCHAR(255),
      IsSendForMinorsBirthday TINYINT(4) DEFAULT 0,
      EmailHostingTemplateNum BIGINT(20) DEFAULT 0,
      MinorAge INT(11) DEFAULT 0,
      TemplateFailureAutoReply TEXT,
      SendMultipleInvites TINYINT(4) DEFAULT 0,
      TimeSpanMultipleInvites BIGINT(20) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_typecur (TypeCur),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_enabled (IsEnabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptremindersent table if it doesn't exist
 */
export async function initializeApptReminderSentTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptremindersent (
      ApptReminderSentNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ApptNum BIGINT(20) NOT NULL,
      ApptDateTime DATETIME,
      DateTimeSent DATETIME,
      TSPrior BIGINT(20),
      ApptReminderRuleNum BIGINT(20),
      PatNum BIGINT(20),
      ClinicNum BIGINT(20),
      SendStatus TINYINT(4),
      MessageType TINYINT(4),
      MessageFk BIGINT(20),
      DateTimeEntry DATETIME DEFAULT CURRENT_TIMESTAMP,
      ResponseDescript TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_appt (ApptNum),
      INDEX idx_rule (ApptReminderRuleNum),
      INDEX idx_pat (PatNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_sent (DateTimeSent)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptthankyousent table if it doesn't exist
 */
export async function initializeApptThankYouSentTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptthankyousent (
      ApptThankYouSentNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ApptNum BIGINT(20) NOT NULL,
      ApptDateTime DATETIME,
      ApptSecDateTEntry DATETIME,
      TSPrior BIGINT(20),
      ApptReminderRuleNum BIGINT(20),
      ClinicNum BIGINT(20),
      PatNum BIGINT(20),
      ResponseDescript TEXT,
      DateTimeThankYouTransmit DATETIME,
      ShortGUID VARCHAR(255),
      SendStatus TINYINT(4),
      MessageType TINYINT(4),
      MessageFk BIGINT(20),
      DateTimeEntry DATETIME DEFAULT CURRENT_TIMESTAMP,
      DateTimeSent DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_appt (ApptNum),
      INDEX idx_rule (ApptReminderRuleNum),
      INDEX idx_pat (PatNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_sent (DateTimeSent)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptview table if it doesn't exist
 */
export async function initializeApptViewTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptview (
      ApptViewNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      ItemOrder SMALLINT NOT NULL DEFAULT 0,
      RowsPerIncr TINYINT NOT NULL DEFAULT 1,
      OnlyScheduledProvs TINYINT DEFAULT 0,
      OnlySchedBeforeTime TIME,
      OnlySchedAfterTime TIME,
      StackBehavUR TINYINT(4) DEFAULT 0,
      StackBehavLR TINYINT(4) DEFAULT 0,
      ClinicNum BIGINT(20) DEFAULT 0,
      ApptTimeScrollStart TIME,
      IsScrollStartDynamic TINYINT(4) DEFAULT 0,
      IsApptBubblesDisabled TINYINT(4) DEFAULT 0,
      WidthOpMinimum SMALLINT DEFAULT 0,
      WaitingRmName TINYINT(4) DEFAULT 0,
      OnlyScheduledProvDays TINYINT(4) DEFAULT 0,
      ShowMirroredAppts TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description),
      INDEX idx_itemorder (ItemOrder),
      INDEX idx_clinic (ClinicNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the apptviewitem table if it doesn't exist
 * Each item attaches a provider/operatory/element to an appt view
 */
export async function initializeApptViewItemTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS apptviewitem (
      ApptViewItemNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ApptViewNum BIGINT(20) NOT NULL,
      OpNum BIGINT(20) DEFAULT 0,
      ProvNum BIGINT(20) DEFAULT 0,
      ElementDesc VARCHAR(255),
      ElementOrder TINYINT DEFAULT 0,
      ElementColor INT(11),
      ElementAlignment TINYINT(4) DEFAULT 0,
      ApptFieldDefNum BIGINT(20) DEFAULT 0,
      PatFieldDefNum BIGINT(20) DEFAULT 0,
      IsMobile TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_apptview (ApptViewNum),
      INDEX idx_op (OpNum),
      INDEX idx_prov (ProvNum),
      INDEX idx_apptfielddef (ApptFieldDefNum),
      INDEX idx_patfielddef (PatFieldDefNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the asapcomm table if it doesn't exist
 */
export async function initializeAsapCommTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS asapcomm (
      AsapCommNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      FKey BIGINT(20) NOT NULL,
      FKeyType TINYINT(4) NOT NULL,
      ScheduleNum BIGINT(20),
      PatNum BIGINT(20) NOT NULL,
      ClinicNum BIGINT(20) NOT NULL,
      ShortGUID VARCHAR(255),
      DateTimeEntry DATETIME,
      DateTimeExpire DATETIME,
      DateTimeSmsScheduled DATETIME,
      SmsSendStatus TINYINT(4),
      EmailSendStatus TINYINT(4),
      DateTimeSmsSent DATETIME,
      DateTimeEmailSent DATETIME,
      EmailMessageNum BIGINT(20),
      ResponseStatus TINYINT(4),
      DateTimeOrig DATETIME,
      TemplateText TEXT,
      TemplateEmail TEXT,
      TemplateEmailSubj VARCHAR(100),
      Note TEXT,
      GuidMessageToMobile TEXT,
      EmailTemplateType TINYINT(4),
      UserNum BIGINT(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_fkey (FKey),
      INDEX idx_schedule (ScheduleNum),
      INDEX idx_pat (PatNum),
      INDEX idx_clinic (ClinicNum),
      INDEX idx_shortguid (ShortGUID)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the autocode table if it doesn't exist
 */
export async function initializeAutocodeTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS autocode (
      AutoCodeNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      IsHidden TINYINT(4) DEFAULT 0,
      LessIntrusive TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the autocodeitem table if it doesn't exist
 */
export async function initializeAutocodeItemTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS autocodeitem (
      AutoCodeItemNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AutoCodeNum BIGINT(20) NOT NULL,
      OldCode VARCHAR(15),
      CodeNum BIGINT(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_autocode (AutoCodeNum),
      INDEX idx_codenumber (CodeNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the autocommexcludedate table if it doesn't exist
 */
export async function initializeAutoCommExcludeDateTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS autocommexcludedate (
      AutoCommExcludeDateNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ClinicNum BIGINT(20) NOT NULL DEFAULT 0,
      DateExclude DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clinic (ClinicNum),
      INDEX idx_date (DateExclude)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the automation table if it doesn't exist
 */
export async function initializeAutomationTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS automation (
      AutomationNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description TEXT NOT NULL,
      Autotrigger TINYINT(4) NOT NULL,
      ProcCodes TEXT,
      AutoAction TINYINT(4) NOT NULL,
      SheetDefNum BIGINT(20),
      CommType BIGINT(20),
      MessageContent TEXT,
      AptStatus TINYINT(4),
      AppointmentTypeNum BIGINT(20),
      PatStatus TINYINT(4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_autotrigger (Autotrigger),
      INDEX idx_autoaction (AutoAction),
      INDEX idx_sheetdef (SheetDefNum),
      INDEX idx_commtype (CommType),
      INDEX idx_appointmenttype (AppointmentTypeNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the automationcondition table if it doesn't exist
 */
export async function initializeAutomationConditionTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS automationcondition (
      AutomationConditionNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AutomationNum BIGINT(20) NOT NULL,
      CompareField TINYINT(4) NOT NULL,
      Comparison TINYINT(4) NOT NULL,
      CompareString VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_automation (AutomationNum),
      INDEX idx_comparefield (CompareField)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the autonote table if it doesn't exist
 */
export async function initializeAutonoteTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS autonote (
      AutoNoteNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AutoNoteName VARCHAR(50) NOT NULL,
      MainText TEXT,
      Category BIGINT(20) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_name (AutoNoteName),
      INDEX idx_category (Category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the autonotecontrol table if it doesn't exist
 */
export async function initializeAutonoteControlTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS autonotecontrol (
      AutoNoteControlNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Descript VARCHAR(50) NOT NULL,
      ControlType VARCHAR(50) NOT NULL,
      ControlLabel VARCHAR(255) NOT NULL,
      ControlOptions TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_descript (Descript),
      INDEX idx_type (ControlType)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the benefit table if it doesn't exist
 */
export async function initializeBenefitTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS benefit (
      BenefitNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      PlanNum BIGINT(20) DEFAULT 0,
      PatPlanNum BIGINT(20) DEFAULT 0,
      CovCatNum BIGINT(20) DEFAULT 0,
      BenefitType TINYINT(4) NOT NULL,
      Percent TINYINT(4) DEFAULT -1,
      MonetaryAmt DOUBLE DEFAULT -1,
      TimePeriod TINYINT(4) DEFAULT 0,
      QuantityQualifier TINYINT(4) DEFAULT 0,
      Quantity TINYINT(4) DEFAULT 0,
      CodeNum BIGINT(20) DEFAULT 0,
      CoverageLevel INT DEFAULT 0,
      SecDateTEntry DATETIME DEFAULT CURRENT_TIMESTAMP,
      SecDateTEdit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CodeGroupNum BIGINT(20) DEFAULT 0,
      TreatArea TINYINT(4) DEFAULT 0,
      ToothRange VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_plan (PlanNum),
      INDEX idx_patplan (PatPlanNum),
      INDEX idx_covcat (CovCatNum),
      INDEX idx_codenumber (CodeNum),
      INDEX idx_codegroup (CodeGroupNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the branding table if it doesn't exist
 */
export async function initializeBrandingTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS branding (
      BrandingNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      BrandingType TINYINT(4) NOT NULL,
      ClinicNum BIGINT(20) DEFAULT 0,
      ValueString TEXT,
      DateTimeUpdated DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clinic (ClinicNum),
      INDEX idx_type (BrandingType)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the canadiannetwork table if it doesn't exist
 */
export async function initializeCanadianNetworkTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS canadiannetwork (
      CanadianNetworkNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Abbrev VARCHAR(20) NOT NULL,
      Descript VARCHAR(255) NOT NULL,
      CanadianTransactionPrefix VARCHAR(255),
      CanadianIsRprHandler TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_abbrev (Abbrev)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the carrier table if it doesn't exist
 */
export async function initializeCarrierTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS carrier (
      CarrierNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      CarrierName VARCHAR(255) NOT NULL,
      Address VARCHAR(255),
      Address2 VARCHAR(255),
      City VARCHAR(255),
      State VARCHAR(255),
      Zip VARCHAR(255),
      Phone VARCHAR(255),
      ElectID VARCHAR(255),
      NoSendElect TINYINT(4) DEFAULT 0,
      IsCDA TINYINT(4) DEFAULT 0,
      CDAnetVersion VARCHAR(100),
      CanadianNetworkNum BIGINT(20) DEFAULT 0,
      IsHidden TINYINT(4) DEFAULT 0,
      CanadianEncryptionMethod TINYINT(4) DEFAULT 1,
      CanadianSupportedTypes INT DEFAULT 0,
      SecUserNumEntry BIGINT(20) DEFAULT 0,
      SecDateEntry DATE,
      SecDateTEdit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      TIN VARCHAR(255),
      CarrierGroupName BIGINT(20) DEFAULT 0,
      ApptTextBackColor INT(11) DEFAULT 0,
      IsCoinsuranceInverted TINYINT(4) DEFAULT 0,
      TrustedEtransFlags TINYINT(4) DEFAULT 0,
      CobInsPaidBehaviorOverride TINYINT(4) DEFAULT 0,
      EraAutomationOverride TINYINT(4) DEFAULT 0,
      OrthoInsPayConsolidate TINYINT(4) DEFAULT 0,
      PaySuiteTransSup TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_name (CarrierName),
      INDEX idx_electid (ElectID),
      INDEX idx_network (CanadianNetworkNum),
      INDEX idx_group (CarrierGroupName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the cdcrec table if it doesn't exist
 */
export async function initializeCdcrecTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS cdcrec (
      CdcrecNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      CdcrecCode VARCHAR(255) NOT NULL,
      HeirarchicalCode VARCHAR(255) NOT NULL,
      Description VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cdcrec_code (CdcrecCode),
      INDEX idx_heirarchical_code (HeirarchicalCode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the cdspermission table if it doesn't exist
 */
export async function initializeCdsPermissionTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS cdspermission (
      CDSPermissionNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      UserNum BIGINT(20) NOT NULL,
      SetupCDS TINYINT(4) DEFAULT 0,
      ShowCDS TINYINT(4) DEFAULT 0,
      ShowInfobutton TINYINT(4) DEFAULT 0,
      EditBibliography TINYINT(4) DEFAULT 0,
      ProblemCDS TINYINT(4) DEFAULT 0,
      MedicationCDS TINYINT(4) DEFAULT 0,
      AllergyCDS TINYINT(4) DEFAULT 0,
      DemographicCDS TINYINT(4) DEFAULT 0,
      LabTestCDS TINYINT(4) DEFAULT 0,
      VitalCDS TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_usernum (UserNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the centralconnection table if it doesn't exist
 */
export async function initializeCentralConnectionTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS centralconnection (
      CentralConnectionNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ServerName VARCHAR(255),
      DatabaseName VARCHAR(255),
      MySqlUser VARCHAR(255),
      MySqlPassword VARCHAR(255),
      ServiceURI VARCHAR(255),
      OdUser VARCHAR(255),
      OdPassword VARCHAR(255),
      Note TEXT,
      ItemOrder INT(11) DEFAULT 0,
      WebServiceIsEcw TINYINT(4) DEFAULT 0,
      ConnectionStatus VARCHAR(255),
      HasClinicBreakdownReports TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_servername (ServerName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the cert table if it doesn't exist
 */
export async function initializeCertTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS cert (
      CertNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      WikiPageLink VARCHAR(255),
      ItemOrder INT(11) DEFAULT 0,
      IsHidden TINYINT(4) DEFAULT 0,
      CertCategoryNum BIGINT(20) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_certcategory (CertCategoryNum),
      INDEX idx_itemorder (ItemOrder)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the certemployee table if it doesn't exist
 */
export async function initializeCertEmployeeTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS certemployee (
      CertEmployeeNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      CertNum BIGINT(20) NOT NULL,
      EmployeeNum BIGINT(20) NOT NULL,
      DateCompleted DATE,
      Note VARCHAR(255),
      UserNum BIGINT(20) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_certnum (CertNum),
      INDEX idx_employeenum (EmployeeNum),
      INDEX idx_usernum (UserNum),
      INDEX idx_datecompleted (DateCompleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chartview table if it doesn't exist
 */
export async function initializeChartViewTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chartview (
      ChartViewNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(255) NOT NULL,
      ItemOrder INT(11) DEFAULT 0,
      ProcStatuses TINYINT(4) DEFAULT 0,
      ObjectTypes SMALLINT(6) DEFAULT 0,
      ShowProcNotes TINYINT(4) DEFAULT 0,
      IsAudit TINYINT(4) DEFAULT 0,
      SelectedTeethOnly TINYINT(4) DEFAULT 0,
      OrionStatusFlags INT(11) DEFAULT 0,
      DatesShowing TINYINT(4) DEFAULT 0,
      IsTpCharting TINYINT(4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_itemorder (ItemOrder)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chat table if it doesn't exist
 */
export async function initializeChatTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chat (
      ChatNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_name (Name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chatmsg table if it doesn't exist
 */
export async function initializeChatMsgTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chatmsg (
      ChatMsgNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ChatNum BIGINT(20) NOT NULL,
      UserNum BIGINT(20) NOT NULL,
      DateTimeSent DATETIME NOT NULL,
      Message TEXT,
      SeqCount BIGINT(20) NOT NULL,
      Quote BIGINT(20),
      EventType TINYINT(4),
      IsImportant TINYINT(4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chatnum (ChatNum),
      INDEX idx_usernum (UserNum),
      INDEX idx_seqcount (SeqCount)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chatreaction table if it doesn't exist
 */
export async function initializeChatReactionTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chatreaction (
      ChatReactionNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ChatMsgNum BIGINT(20) NOT NULL,
      UserNum BIGINT(20) NOT NULL,
      EmojiName VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chatmsgnum (ChatMsgNum),
      INDEX idx_usernum (UserNum),
      INDEX idx_emoji (EmojiName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chatuserattach table if it doesn't exist
 */
export async function initializeChatUserAttachTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chatuserattach (
      ChatUserAttachNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      UserNum BIGINT(20) NOT NULL,
      ChatNum BIGINT(20) NOT NULL,
      IsRead TINYINT(4),
      DateTimeRemoved DATETIME,
      IsMute TINYINT(4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_usernum (UserNum),
      INDEX idx_chatnum (ChatNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chatuserod table if it doesn't exist
 */
export async function initializeChatUserodTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chatuserod (
      ChatUserodNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      UserNum BIGINT(20) NOT NULL,
      UserStatus TINYINT(4),
      DateTimeStatusReset DATETIME,
      Photo TEXT,
      PhotoCrop VARCHAR(255),
      OpenBackground TINYINT(4),
      CloseKeepRunning TINYINT(4),
      MuteNotifications TINYINT(4),
      DismissNotifySecs INT(11),
      MuteImportantNotifications TINYINT(4),
      DismissImportantNotifySecs INT(11),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_usernum (UserNum),
      INDEX idx_status (UserStatus)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the claim table if it doesn't exist
 */
export async function initializeClaimTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS claim (
      ClaimNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      PatNum BIGINT(20) NOT NULL,
      DateService DATE,
      DateSent DATE,
      ClaimStatus CHAR(1) NOT NULL,
      DateReceived DATE,
      PlanNum BIGINT(20),
      ProvTreat BIGINT(20),
      ClaimFee DOUBLE,
      InsPayEst DOUBLE,
      InsPayAmt DOUBLE,
      DedApplied DOUBLE,
      PreAuthString VARCHAR(40),
      IsProsthesis CHAR(1),
      PriorDate DATE,
      ReasonUnderPaid VARCHAR(255),
      ClaimNote VARCHAR(400),
      ClaimType VARCHAR(255) NOT NULL,
      ProvBill BIGINT(20),
      ReferringProv BIGINT(20),
      RefNumString VARCHAR(40),
      PlaceService TINYINT,
      AccidentRelated CHAR(1),
      AccidentDate DATE,
      AccidentST VARCHAR(2),
      EmployRelated TINYINT,
      IsOrtho TINYINT,
      OrthoRemainM TINYINT,
      OrthoDate DATE,
      PatRelat TINYINT,
      PlanNum2 BIGINT(20),
      PatRelat2 TINYINT,
      WriteOff DOUBLE,
      Radiographs TINYINT,
      ClinicNum BIGINT(20),
      ClaimForm BIGINT(20),
      AttachedImages INT(11),
      AttachedModels INT(11),
      AttachedFlags VARCHAR(255),
      AttachmentID VARCHAR(255),
      CanadianMaterialsForwarded VARCHAR(10),
      CanadianReferralProviderNum VARCHAR(20),
      CanadianReferralReason TINYINT,
      CanadianIsInitialLower VARCHAR(5),
      CanadianDateInitialLower DATE,
      CanadianMandProsthMaterial TINYINT,
      CanadianIsInitialUpper VARCHAR(5),
      CanadianDateInitialUpper DATE,
      CanadianMaxProsthMaterial TINYINT,
      InsSubNum BIGINT(20),
      InsSubNum2 BIGINT(20),
      CanadaTransRefNum VARCHAR(255),
      CanadaEstTreatStartDate DATE,
      CanadaInitialPayment DOUBLE,
      CanadaPaymentMode TINYINT,
      CanadaTreatDuration TINYINT,
      CanadaNumAnticipatedPayments TINYINT,
      CanadaAnticipatedPayAmount DOUBLE,
      PriorAuthorizationNumber VARCHAR(255),
      SpecialProgramCode TINYINT,
      UniformBillType VARCHAR(255),
      MedType TINYINT,
      AdmissionTypeCode VARCHAR(255),
      AdmissionSourceCode VARCHAR(255),
      PatientStatusCode VARCHAR(255),
      CustomTracking BIGINT(20),
      DateResent DATE,
      CorrectionType TINYINT,
      ClaimIdentifier VARCHAR(255),
      OrigRefNum VARCHAR(255),
      ProvOrderOverride BIGINT(20),
      OrthoTotalM TINYINT,
      ShareOfCost DOUBLE,
      SecUserNumEntry BIGINT(20),
      SecDateEntry DATE,
      SecDateTEdit TIMESTAMP NULL DEFAULT NULL,
      OrderingReferralNum BIGINT(20),
      DateSentOrig DATE,
      DateIllnessInjuryPreg DATE,
      DateIllnessInjuryPregQualifier SMALLINT,
      DateOther DATE,
      DateOtherQualifier SMALLINT,
      IsOutsideLab TINYINT,
      SecurityHash VARCHAR(255),
      Narrative TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_patnum (PatNum),
      INDEX idx_plannum (PlanNum),
      INDEX idx_claimstatus (ClaimStatus),
      INDEX idx_claimtype (ClaimType),
      INDEX idx_clinicnum (ClinicNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the claimattach table if it doesn't exist
 */
export async function initializeClaimAttachTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS claimattach (
      ClaimAttachNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ClaimNum BIGINT(20) NOT NULL,
      DisplayedFileName VARCHAR(255) NOT NULL,
      ActualFileName VARCHAR(255),
      ImageReferenceId INT(11),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_claimnum (ClaimNum),
      INDEX idx_imageref (ImageReferenceId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the claimcondcodelog table if it doesn't exist
 */
export async function initializeClaimCondCodeLogTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS claimcondcodelog (
      ClaimCondCodeLogNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ClaimNum BIGINT(20) NOT NULL,
      Code0 VARCHAR(2),
      Code1 VARCHAR(2),
      Code2 VARCHAR(2),
      Code3 VARCHAR(2),
      Code4 VARCHAR(2),
      Code5 VARCHAR(2),
      Code6 VARCHAR(2),
      Code7 VARCHAR(2),
      Code8 VARCHAR(2),
      Code9 VARCHAR(2),
      Code10 VARCHAR(2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_claimnum (ClaimNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the claimform table if it doesn't exist
 */
export async function initializeClaimFormTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS claimform (
      ClaimFormNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      Description VARCHAR(50) NOT NULL,
      IsHidden TINYINT,
      FontName VARCHAR(255),
      FontSize FLOAT,
      UniqueID VARCHAR(255),
      PrintImages TINYINT,
      OffsetX SMALLINT,
      OffsetY SMALLINT,
      Width INT(11),
      Height INT(11),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_description (Description)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the claimformitem table if it doesn't exist
 */
export async function initializeClaimFormItemTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS claimformitem (
      ClaimFormItemNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ClaimFormNum BIGINT(20) NOT NULL,
      ImageFileName VARCHAR(255),
      FieldName VARCHAR(255) NOT NULL,
      FormatString VARCHAR(255),
      XPos FLOAT,
      YPos FLOAT,
      Width FLOAT,
      Height FLOAT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_claimformnum (ClaimFormNum),
      INDEX idx_fieldname (FieldName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the chatattach table if it doesn't exist
 */
export async function initializeChatAttachTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS chatattach (
      ChatAttachNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      ChatMsgNum BIGINT(20) NOT NULL,
      FileName VARCHAR(255) NOT NULL,
      Thumbnail MEDIUMBLOB,
      FileData MEDIUMBLOB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chatmsgnum (ChatMsgNum),
      INDEX idx_filename (FileName)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

/**
 * Initialize the autocodecond table if it doesn't exist
 */
export async function initializeAutocodeCondTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS autocodecond (
      AutoCodeCondNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
      AutoCodeItemNum BIGINT(20) NOT NULL,
      Cond TINYINT(4) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_item (AutoCodeItemNum)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await executeQuery(createTableQuery);
}

