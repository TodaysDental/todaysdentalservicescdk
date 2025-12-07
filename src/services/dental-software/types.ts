/**
 * Clinic Entity Type Definition
 * 
 * A clinic is usually a separate physical office location. If multiple clinics are sharing 
 * one database, then this is used. Patients, Operatories, Claims, and many other types of 
 * objects can be assigned to a clinic.
 */
export interface Clinic {
  /**
   * Primary key. Used in patient, payment, claimpayment, appointment, procedurelog, etc.
   */
  ClinicNum: number;

  /**
   * Use Abbr for all user-facing forms. Description is required and should not be blank.
   */
  Description: string;

  /**
   * First line of address
   */
  Address?: string;

  /**
   * Second line of address
   */
  Address2?: string;

  /**
   * City
   */
  City?: string;

  /**
   * 2 char in the US
   */
  State?: string;

  /**
   * Zip code
   */
  Zip?: string;

  /**
   * Does not include any punctuation. Exactly 10 digits or blank in USA and Canada.
   */
  Phone?: string;

  /**
   * The account number for deposits
   */
  BankNumber?: string;
}

/**
 * Create Clinic Request - ClinicNum is auto-generated
 */
export interface CreateClinicRequest {
  Description: string;
  Address?: string;
  Address2?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Phone?: string;
  BankNumber?: string;
}

/**
 * Update Clinic Request - ClinicNum is required in path, other fields optional
 */
export interface UpdateClinicRequest {
  Description?: string;
  Address?: string;
  Address2?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Phone?: string;
  BankNumber?: string;
}

// ========================================
// ACCOUNT TYPES
// ========================================

/**
 * Account types used by the accounting section (chart of accounts).
 * Not related to patient accounts.
 */
export enum AccountType {
  Asset = 0,
  Liability = 1,
  Equity = 2,
  Income = 3,
  Expense = 4,
}

export interface Account {
  AccountNum: number; // bigint(20) primary key
  Description: string;
  AcctType: AccountType;
  BankNumber?: string | null; // For asset accounts: bank account number for deposit slips
  Inactive?: boolean; // Set true to hide from usual lists
  AccountColor?: number | null;
  IsAssetAccount?: boolean; // Whether this is an asset account
  CashFlowReserve?: number | null; // Cash flow reserve amount
  created_at?: string;
  updated_at?: string;
}

/**
 * Create Account Request - AccountNum is auto-generated
 */
export interface CreateAccountRequest {
  Description: string;
  AcctType: AccountType;
  BankNumber?: string;
  Inactive?: boolean;
  AccountColor?: number;
  IsAssetAccount?: boolean;
  CashFlowReserve?: number;
}

/**
 * Update Account Request - AccountNum is required in path, other fields optional
 */
export interface UpdateAccountRequest {
  Description?: string;
  AcctType?: AccountType;
  BankNumber?: string;
  Inactive?: boolean;
  AccountColor?: number;
  IsAssetAccount?: boolean;
  CashFlowReserve?: number;
}

// ========================================
// DEFINITION TYPES
// ========================================

/**
 * Definition Entity Type Definition
 * 
 * The info in the definition table is used by other tables extensively. Almost every table 
 * in the database links to definition. Almost all links to this table will be to a DefNum. 
 * Using the DefNum, you can find any of the other fields of interest, usually the ItemName.
 */

/**
 * Definition Category Enum
 * Each category represents a different type of definition used throughout the system
 */
export enum DefCat {
  AccountColors = 0,              // Colors to display in Account module
  AdjTypes = 1,                   // Adjustment types
  ApptConfirmed = 2,              // Appointment confirmed types
  ApptProcsQuickAdd = 3,          // Procedure quick add list for appointments
  BillingTypes = 4,               // Billing types
  ClaimFormats = 5,               // Not used
  DunningMessages = 6,            // Not used
  FeeSchedNamesOld = 7,           // Not used
  MedicalNotes = 8,               // Not used
  OperatoriesOld = 9,             // Not used
  PaymentTypes = 10,              // Payment types
  ProcCodeCats = 11,              // Procedure code categories
  ProgNoteColors = 12,            // Progress note colors
  RecallUnschedStatus = 13,       // Statuses for recall, reactivation, unscheduled, and next appointments
  ServiceNotes = 14,              // Not used
  DiscountTypes = 15,             // Not used
  Diagnosis = 16,                 // Diagnosis types
  AppointmentColors = 17,         // Colors to display in the Appointments module
  ImageCats = 18,                 // Image categories
  ApptPhoneNotes = 19,            // Not used
  TxPriorities = 20,              // Treatment plan priority names
  MiscColors = 21,                // Miscellaneous color options
  ChartGraphicColors = 22,        // Colors for the graphical tooth chart
  ContactCategories = 23,         // Categories for the Contact list
  LetterMergeCats = 24,           // Categories for Letter Merge
  BlockoutTypes = 25,             // Types of Schedule Blockouts
  ProcButtonCats = 26,            // Categories of procedure buttons in Chart module
  CommLogTypes = 27,              // Types of commlog entries
  SupplyCats = 28,                // Categories of Supplies
  PaySplitUnearnedType = 29,      // Types of unearned income used in accrual accounting
  Prognosis = 30,                 // Prognosis types
  ClaimCustomTracking = 31,       // Custom Tracking, statuses such as 'review', 'hold', 'riskmanage'
  InsurancePaymentType = 32,      // PayType for claims such as 'Check', 'EFT'
  TaskPriorities = 33,            // Categories of priorities for tasks
  FeeColors = 34,                 // Categories for fee override colors
  ProviderSpecialties = 35,       // Provider specialties
  ClaimPaymentTracking = 36,      // Reason why a claim proc was rejected
  AccountQuickCharge = 37,        // Procedure quick charge list for patient accounts
  InsuranceVerificationStatus = 38, // Insurance verification status
  Regions = 39,                   // Regions that clinics can be assigned to
  ClaimPaymentGroups = 40,        // ClaimPayment Payment Groups
  AutoNoteCats = 41,              // Auto Note Categories
  WebSchedNewPatApptTypes = 42,   // Web Sched New Patient Appointment Types
  ClaimErrorCode = 43,            // Custom Claim Status Error Code
  ClinicSpecialty = 44,           // Specialties that clinics perform
  JobPriorities = 45,             // HQ Only job priorities
  CarrierGroupNames = 46,         // Carrier Group Name
  PayPlanCategories = 47,         // PayPlanCategory
  AutoDeposit = 48,               // Associates an insurance payment to an account number
  InsuranceFilingCodeGroup = 49,  // Code Group used for insurance filing
  TimeCardAdjTypes = 50,          // Time card adjustment types
  WebSchedExistingApptTypes = 51, // Web Sched Existing Appt Types
  CertificationCategories = 52,   // Categories for the Certifications feature
  EClipboardImageCapture = 53,    // Images for eClipboard check-in
  TaskCategories = 54,            // Task categories
  OperatoryTypes = 55,            // Operatory Types (informational only)
}

/**
 * Definition entity
 */
export interface Definition {
  /**
   * Primary key
   */
  DefNum: number;

  /**
   * Category enum (DefCat)
   */
  Category: DefCat;

  /**
   * Order that each item shows on various lists. 0-indexed.
   */
  ItemOrder: number;

  /**
   * Common name of the item
   */
  ItemName: string;

  /**
   * Extra info about the item. Used extensively by ImageCategories to store single letter codes.
   */
  ItemValue?: string;

  /**
   * Some categories include a color option
   */
  ItemColor?: number;

  /**
   * If hidden, the item will not show on any list, but can still be referenced
   */
  IsHidden: boolean;
}

/**
 * Create Definition Request - DefNum is auto-generated
 */
export interface CreateDefinitionRequest {
  Category: DefCat;
  ItemOrder: number;
  ItemName: string;
  ItemValue?: string;
  ItemColor?: number;
  IsHidden?: boolean;
}

/**
 * Update Definition Request - DefNum is required in path, other fields optional
 */
export interface UpdateDefinitionRequest {
  Category?: DefCat;
  ItemOrder?: number;
  ItemName?: string;
  ItemValue?: string;
  ItemColor?: number;
  IsHidden?: boolean;
}

/**
 * Query parameters for listing definitions
 */
export interface ListDefinitionsQuery {
  category?: DefCat;
  includeHidden?: boolean;
}

// ========================================
// ACCOUNTING AUTOPAY TYPES
// ========================================

/**
 * Accounting AutoPay Entity Type Definition
 * 
 * In the accounting section, this automates entries into the database when user 
 * enters a payment into a patient account. This table presents the user with a 
 * picklist specific to that payment type. For example, a cash payment would create 
 * a picklist of cashboxes for user to put the cash into.
 */
export interface AccountingAutoPay {
  /**
   * Primary key
   */
  AccountingAutoPayNum: number;

  /**
   * FK to definition.DefNum. References the payment type definition.
   */
  PayType: number;

  /**
   * FK to account.AccountNum. AccountNums separated by commas. No spaces.
   * Example: "101,102,105"
   */
  PickList: string;

  created_at?: string;
  updated_at?: string;
}

/**
 * Create Accounting AutoPay Request - AccountingAutoPayNum is auto-generated
 */
export interface CreateAccountingAutoPayRequest {
  PayType: number;
  PickList: string;
}

/**
 * Update Accounting AutoPay Request - AccountingAutoPayNum is required in path, other fields optional
 */
export interface UpdateAccountingAutoPayRequest {
  PayType?: number;
  PickList?: string;
}

// ========================================
// USEROD TYPES
// ========================================

/**
 * Userod Entity Type Definition
 *
 * Users are distinct from providers and employees, but can be linked.
 * The user number never changes to preserve audit trails.
 */
export interface Userod {
  /** Primary key */
  UserNum: number;

  /** Username (unique) */
  UserName: string;

  /**
   * Password stored as "HashType$Salt$Hash" (encoded hash, not plain password).
   * Legacy hashes may not follow this format.
   */
  Password: string;

  /** Deprecated. Use UserGroupAttaches instead. */
  UserGroupNum?: number | null;

  /** FK to employee.EmployeeNum */
  EmployeeNum?: number | null;

  /** FK to clinic.ClinicNum. Default clinic for this user. */
  ClinicNum?: number | null;

  /** FK to provider.ProvNum (optional) */
  ProvNum?: number | null;

  /** Hidden users do not show in login list */
  IsHidden?: boolean;

  /** FK to tasklist.TaskListNum (0 if none) */
  TaskListInBox?: number | null;

  /** Defaults to 3 (regular user) */
  AnesthProvType?: number | null;

  /** If true, BlockSubsc button starts pressed */
  DefaultHidePopups?: boolean;

  /** Flag indicating strong password used */
  PasswordIsStrong?: boolean;

  /** When true, restricts clinic access to those in userclinic table */
  ClinicIsRestricted?: boolean;

  /** If true, BlockInbox button starts pressed */
  InboxHidePopups?: boolean;

  /** FK to userod.UserNum in Central Manager (CEMT) */
  UserNumCEMT?: number | null;

  /** Date/time of most recent failed login */
  DateTFail?: string | null;

  /** Count of failed attempts */
  FailedAttempts?: number | null;

  /** AD username link, format: DomainGuid\\UserName */
  DomainUser?: string | null;

  /** If true, password must be reset on next login */
  IsPasswordResetRequired?: boolean;

  /** Hashed pin for mobile web validation */
  MobileWebPin?: string | null;

  /** Count of failed mobile web pin attempts */
  MobileWebPinFailedAttempts?: number | null;

  /** Last successful login time (min date if unknown) */
  DateTLastLogin?: string | null;

  /** Hashed pin for eClipboard clinical use */
  EClipboardClinicalPin?: string | null;

  /** Badge identifier (1–4 digits, unique to badge) */
  BadgeId?: string | null;

  created_at?: string;
  updated_at?: string;
}

/**
 * Create Userod Request - UserNum is auto-generated
 */
export interface CreateUserodRequest {
  UserName: string;
  Password: string;
  UserGroupNum?: number | null;
  EmployeeNum?: number | null;
  ClinicNum?: number | null;
  ProvNum?: number | null;
  IsHidden?: boolean;
  TaskListInBox?: number | null;
  AnesthProvType?: number | null;
  DefaultHidePopups?: boolean;
  PasswordIsStrong?: boolean;
  ClinicIsRestricted?: boolean;
  InboxHidePopups?: boolean;
  UserNumCEMT?: number | null;
  DateTFail?: string | null;
  FailedAttempts?: number | null;
  DomainUser?: string | null;
  IsPasswordResetRequired?: boolean;
  MobileWebPin?: string | null;
  MobileWebPinFailedAttempts?: number | null;
  DateTLastLogin?: string | null;
  EClipboardClinicalPin?: string | null;
  BadgeId?: string | null;
}

/**
 * Update Userod Request - UserNum required in path, other fields optional
 */
export interface UpdateUserodRequest {
  UserName?: string;
  Password?: string;
  UserGroupNum?: number | null;
  EmployeeNum?: number | null;
  ClinicNum?: number | null;
  ProvNum?: number | null;
  IsHidden?: boolean;
  TaskListInBox?: number | null;
  AnesthProvType?: number | null;
  DefaultHidePopups?: boolean;
  PasswordIsStrong?: boolean;
  ClinicIsRestricted?: boolean;
  InboxHidePopups?: boolean;
  UserNumCEMT?: number | null;
  DateTFail?: string | null;
  FailedAttempts?: number | null;
  DomainUser?: string | null;
  IsPasswordResetRequired?: boolean;
  MobileWebPin?: string | null;
  MobileWebPinFailedAttempts?: number | null;
  DateTLastLogin?: string | null;
  EClipboardClinicalPin?: string | null;
  BadgeId?: string | null;
}

// ========================================
// ACTIVEINSTANCE TYPES
// ========================================

export enum ConnectionType {
  Direct = 0,
  MiddleTier = 1,
  Thinfinity = 2,
  AppStream = 3,
}

/**
 * ActiveInstance tracks OD sessions.
 */
export interface ActiveInstance {
  /** Primary key */
  ActiveInstanceNum: number;

  /** FK to computers.ComputerNum */
  ComputerNum: number;

  /** FK to userod.UserNum */
  UserNum: number;

  /** Windows Process ID */
  ProcessId: number;

  /** Last datetime that activity was recorded */
  DateTimeLastActive: string;

  /**
   * Recorded time for DateTimeLastActive (not timestamp column; must be explicitly updated)
   */
  DateTRecorded: string;

  /** Connection type enum */
  ConnectionType: ConnectionType;

  created_at?: string;
  updated_at?: string;
}

export interface CreateActiveInstanceRequest {
  ComputerNum: number;
  UserNum: number;
  ProcessId: number;
  DateTimeLastActive: string;
  DateTRecorded: string;
  ConnectionType: ConnectionType;
}

export interface UpdateActiveInstanceRequest {
  ComputerNum?: number;
  UserNum?: number;
  ProcessId?: number;
  DateTimeLastActive?: string;
  DateTRecorded?: string;
  ConnectionType?: ConnectionType;
}

// ========================================
// ADJUSTMENT TYPES
// ========================================

/**
 * Adjustment in the patient account.
 */
export interface Adjustment {
  /** Primary key */
  AdjNum: number;

  /** Date shown in patient account */
  AdjDate: string; // date

  /** Amount, can be positive or negative */
  AdjAmt: number;

  /** FK to patient.PatNum */
  PatNum: number;

  /** FK to definition.DefNum */
  AdjType: number;

  /** FK to provider.ProvNum */
  ProvNum: number;

  /** Note for this adjustment */
  AdjNote?: string | null;

  /** Procedure date */
  ProcDate?: string | null; // date

  /** FK to procedurelog.ProcNum (0 if none) */
  ProcNum: number;

  /** Actual entry date (set by DB) */
  DateEntry: string; // date

  /** FK to clinic.ClinicNum */
  ClinicNum: number;

  /** FK to statement.StatementNum (invoice) */
  StatementNum: number;

  /** FK to userod.UserNum who created */
  SecUserNumEntry: number;

  /** Auto-updated timestamp */
  SecDateTEdit: string;

  /** Deprecated Avalara transaction ID */
  TaxTransID?: number | null;

  created_at?: string;
  updated_at?: string;
}

/**
 * Create Adjustment Request - AdjNum auto-generated, DateEntry auto-set by DB
 */
export interface CreateAdjustmentRequest {
  AdjDate: string;
  AdjAmt: number;
  PatNum: number;
  AdjType: number;
  ProvNum?: number;
  AdjNote?: string;
  ProcDate?: string;
  ProcNum?: number;
  ClinicNum?: number;
  StatementNum?: number;
  SecUserNumEntry?: number;
  TaxTransID?: number;
}

/**
 * Update Adjustment Request - AdjNum required in path
 * DateEntry is not editable.
 */
export interface UpdateAdjustmentRequest {
  AdjDate?: string;
  AdjAmt?: number;
  PatNum?: number;
  AdjType?: number;
  ProvNum?: number;
  AdjNote?: string | null;
  ProcDate?: string | null;
  ProcNum?: number;
  ClinicNum?: number;
  StatementNum?: number;
  SecUserNumEntry?: number;
  TaxTransID?: number | null;
}

// ========================================
// ALERT CATEGORY TYPES
// ========================================

/**
 * Alert Category groups alert types that users can subscribe to.
 */
export interface AlertCategory {
  /** Primary key */
  AlertCategoryNum: number;

  /**
   * When true, category is HQ-managed and should not be edited or deleted.
   */
  IsHQCategory: boolean;

  /** HQ/internal identifier for the category origin */
  InternalName?: string | null;

  /** Display name shown to users */
  Description: string;

  created_at?: string;
  updated_at?: string;
}

export interface CreateAlertCategoryRequest {
  IsHQCategory?: boolean;
  InternalName?: string | null;
  Description: string;
}

export interface UpdateAlertCategoryRequest {
  IsHQCategory?: boolean;
  InternalName?: string | null;
  Description?: string;
}

// ========================================
// ALERT CATEGORY LINK TYPES
// ========================================

export enum AlertType {
  Generic = 0,
  OnlinePaymentsPending = 1,
  VoiceMailMonitor = 2,
  RadiologyProcedures = 3,
  CallbackRequested = 4,
  WebSchedNewPat = 5,
  WebSchedNewPatApptCreated = 6,
  NumberBarredFromTexting = 7,
  MaxConnectionsMonitor = 8,
  WebSchedASAPApptCreated = 9,
  AsteriskServerMonitor = 10,
  MultipleEConnectors = 11,
  EConnectorDown = 12,
  EConnectorError = 13,
  DoseSpotProviderRegistered = 14,
  DoseSpotClinicRegistered = 15,
  WebSchedRecallApptCreated = 16,
  ClinicsChanged = 17,
  ClinicsChangedInternal = 18,
  MultipleOpenDentalServices = 19,
  OpenDentalServiceDown = 20,
  WebMailReceived = 21,
  EconnectorEmailTooManySendFails = 22,
  SupplementalBackups = 23,
  EConnectorMySqlTime = 24,
  CareCreditBatchError = 25,
  PatientArrival = 26,
  EmailSecure = 27,
  WebSchedExistingPatApptCreated = 28,
  CloudAlertWithinLimit = 29,
  WebFormsReady = 30,
  PushHubDown = 31,
  Update = 32,
  ReplicationMonitor = 33,
  WebSchedRecallsNotSending = 34,
  TenDlc = 35,
  AddToCalendar = 36,
  EConnectorRedistributableMissing = 37,
  SMSThread = 38,
  SignatureCleared = 39,
  Pearl = 40,
  BetterDiagnostics = 41,
  MessageToPayTag = 42,
  MassEmailUpload = 43,
  MassEmailReceipt = 44,
  HQNotification = 45,
  TreatmentPlanImagesFolderInaccesible = 46,
  PaymentPlanImagesFolderInaccesible = 47,
  CannotCreateOrAccessPatientFolder = 48,
  DefaultEmailNotSet = 49,
}

/**
 * AlertCategoryLink represents an alert type attached to a category.
 */
export interface AlertCategoryLink {
  /** Primary key */
  AlertCategoryLinkNum: number;

  /** FK to alertcategory.AlertCategoryNum */
  AlertCategoryNum: number;

  /** Enum AlertType */
  AlertType: AlertType;

  created_at?: string;
  updated_at?: string;
}

export interface CreateAlertCategoryLinkRequest {
  AlertCategoryNum: number;
  AlertType: AlertType;
}

export interface UpdateAlertCategoryLinkRequest {
  AlertCategoryNum?: number;
  AlertType?: AlertType;
}

// ========================================
// ALERT ITEM TYPES
// ========================================

export enum SeverityType {
  Normal = 0,
  Low = 1,
  Medium = 2,
  High = 3,
}

export enum ActionType {
  None = 0,
  MarkAsRead = 1,
  OpenForm = 2,
  Delete = 4,
  ShowItemValue = 8,
}

export enum FormType {
  None = 0,
  FormEServicesWebSchedRecall = 1,
  FormOnlinePayments = 2,
  FormRadOrderList = 3,
  FormEServicesSignupPortal = 4,
  FormApptEdit = 5,
  FormEServicesWebSchedNewPat = 6,
  FormWebSchedAppts = 7,
  FormPatientEdit = 8,
  FormEServicesEConnector = 9,
  FormDoseSpotAssignUserId = 10,
  FormDoseSpotAssignClinicId = 11,
  FormEmailInbox = 12,
  FormEmailAddresses = 13,
  FormCareCreditTransactions = 14,
  FormCloudManagement = 15,
  FormWebForms = 16,
  FormModuleSetup = 17,
  FormEServicesAutoMsging = 18,
  FrmStatementSendSetup = 19,
  FormAdvertisingMassEmailUpload = 20,
}

/**
 * AlertItem shown in main menu for user attention.
 */
export interface AlertItem {
  AlertItemNum: number;
  ClinicNum: number; // 0 or -1 for all clinics
  Description: string;
  Type: AlertType;
  Severity: SeverityType;
  Actions: ActionType; // bitwise flags
  FormToOpen: FormType;
  FKey: number;
  ItemValue?: string | null;
  UserNum: number; // 0 for all users
  SecDateTEntry?: string; // datetime
  created_at?: string;
  updated_at?: string;
}

export interface CreateAlertItemRequest {
  ClinicNum?: number;
  Description: string;
  Type: AlertType;
  Severity?: SeverityType;
  Actions?: ActionType;
  FormToOpen?: FormType;
  FKey?: number;
  ItemValue?: string;
  UserNum?: number;
}

export interface UpdateAlertItemRequest {
  ClinicNum?: number;
  Description?: string;
  Type?: AlertType;
  Severity?: SeverityType;
  Actions?: ActionType;
  FormToOpen?: FormType;
  FKey?: number;
  ItemValue?: string | null;
  UserNum?: number;
}

// ========================================
// ALERT READ TYPES
// ========================================

export interface AlertRead {
  AlertReadNum: number;
  AlertItemNum: number;
  UserNum: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAlertReadRequest {
  AlertItemNum: number;
  UserNum: number;
}

export interface UpdateAlertReadRequest {
  AlertItemNum?: number;
  UserNum?: number;
}

// ========================================
// ALERT SUB TYPES
// ========================================

/**
 * Alert subscription for a user (and optional clinic) to a category.
 */
export interface AlertSub {
  AlertSubNum: number;
  UserNum: number;
  ClinicNum: number; // 0 allowed
  Type: number; // deprecated
  AlertCategoryNum: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAlertSubRequest {
  UserNum: number;
  ClinicNum?: number; // default 0
  Type?: number; // deprecated
  AlertCategoryNum: number;
}

export interface UpdateAlertSubRequest {
  UserNum?: number;
  ClinicNum?: number;
  Type?: number;
  AlertCategoryNum?: number;
}

// ========================================
// ALLERGY TYPES
// ========================================

export interface Allergy {
  AllergyNum: number;
  AllergyDefNum: number;
  PatNum: number;
  Reaction?: string | null;
  StatusIsActive: boolean;
  DateTStamp?: string; // timestamp
  DateAdverseReaction?: string | null; // date
  created_at?: string;
  updated_at?: string;
}

export interface CreateAllergyRequest {
  AllergyDefNum: number;
  PatNum: number;
  Reaction?: string;
  StatusIsActive?: boolean;
  DateAdverseReaction?: string;
}

export interface UpdateAllergyRequest {
  AllergyDefNum?: number;
  PatNum?: number;
  Reaction?: string | null;
  StatusIsActive?: boolean;
  DateAdverseReaction?: string | null;
}

// ========================================
// ALLERGY DEF TYPES
// ========================================

export interface AllergyDef {
  AllergyDefNum: number;
  Description: string;
  ICD9Code?: string | null;
  SNOMEDCTCode?: string | null;
  IsHidden: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAllergyDefRequest {
  Description: string;
  ICD9Code?: string;
  SNOMEDCTCode?: string;
  IsHidden?: boolean;
}

export interface UpdateAllergyDefRequest {
  Description?: string;
  ICD9Code?: string | null;
  SNOMEDCTCode?: string | null;
  IsHidden?: boolean;
}

// ========================================
// APIKEY TYPES
// ========================================

export interface APIKey {
  APIKeyNum: number;
  CustApiKey: string;
  DevName: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAPIKeyRequest {
  CustApiKey: string;
  DevName: string;
}

export interface UpdateAPIKeyRequest {
  CustApiKey?: string;
  DevName?: string;
}

// ========================================
// API SUBSCRIPTION TYPES
// ========================================

/**
 * API subscription for event notifications.
 */
export interface ApiSubscription {
  ApiSubscriptionNum: number;
  EndPointUrl: string;
  Workstation?: string | null;
  CustomerKey: string;
  WatchTable: string; // EnumWatchTable stored as string
  PollingSeconds: number;
  UiEventType: string; // EnumApiUiEventType stored as string
  DateTimeStart?: string | null;
  DateTimeStop?: string | null;
  Note?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApiSubscriptionRequest {
  EndPointUrl: string;
  CustomerKey: string;
  WatchTable: string;
  PollingSeconds: number;
  UiEventType: string;
  Workstation?: string;
  DateTimeStart?: string;
  DateTimeStop?: string;
  Note?: string;
}

export interface UpdateApiSubscriptionRequest {
  EndPointUrl?: string;
  CustomerKey?: string;
  WatchTable?: string;
  PollingSeconds?: number;
  UiEventType?: string;
  Workstation?: string | null;
  DateTimeStart?: string | null;
  DateTimeStop?: string | null;
  Note?: string | null;
}

// ========================================
// APPOINTMENT TYPES
// ========================================

export enum ApptStatus {
  None = 0,
  Scheduled = 1,
  Complete = 2,
  UnschedList = 3,
  ASAP = 4,
  Broken = 5,
  Planned = 6,
  PtNote = 7,
  PtNoteCompleted = 8,
}

export enum ApptPriority {
  Normal = 0,
  ASAP = 1,
}

export interface Appointment {
  AptNum: number;
  PatNum: number;
  AptStatus: ApptStatus;
  Pattern: string;
  Confirmed?: number | null;
  TimeLocked?: boolean;
  Op?: number | null;
  Note?: string | null;
  ProvNum?: number | null;
  ProvHyg?: number | null;
  AptDateTime?: string | null;
  NextAptNum?: number | null;
  UnschedStatus?: number | null;
  IsNewPatient?: boolean;
  ProcDescript?: string | null;
  Assistant?: number | null;
  ClinicNum?: number | null;
  IsHygiene?: boolean;
  DateTStamp?: string;
  DateTimeArrived?: string | null;
  DateTimeSeated?: string | null;
  DateTimeDismissed?: string | null;
  InsPlan1?: number | null;
  InsPlan2?: number | null;
  DateTimeAskedToArrive?: string | null;
  ProcsColored?: string | null;
  ColorOverride?: number | null;
  AppointmentTypeNum?: number | null;
  SecUserNumEntry?: number | null;
  SecDateTEntry?: string;
  Priority?: ApptPriority;
  ProvBarText?: string | null;
  PatternSecondary?: string | null;
  SecurityHash?: string | null;
  ItemOrderPlanned?: number | null;
  IsMirrored?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAppointmentRequest {
  PatNum: number;
  AptStatus: ApptStatus;
  Pattern: string;
  Confirmed?: number;
  TimeLocked?: boolean;
  Op?: number;
  Note?: string;
  ProvNum?: number;
  ProvHyg?: number;
  AptDateTime?: string;
  NextAptNum?: number;
  UnschedStatus?: number;
  IsNewPatient?: boolean;
  ProcDescript?: string;
  Assistant?: number;
  ClinicNum?: number;
  IsHygiene?: boolean;
  DateTimeArrived?: string;
  DateTimeSeated?: string;
  DateTimeDismissed?: string;
  InsPlan1?: number;
  InsPlan2?: number;
  DateTimeAskedToArrive?: string;
  ProcsColored?: string;
  ColorOverride?: number;
  AppointmentTypeNum?: number;
  SecUserNumEntry?: number;
  Priority?: ApptPriority;
  ProvBarText?: string;
  PatternSecondary?: string;
  SecurityHash?: string;
  ItemOrderPlanned?: number;
  IsMirrored?: boolean;
}

export interface UpdateAppointmentRequest extends Partial<CreateAppointmentRequest> {}

// ========================================
// APPOINTMENT RULE TYPES
// ========================================

export interface AppointmentRule {
  AppointmentRuleNum: number;
  RuleDesc: string;
  CodeStart: string;
  CodeEnd: string;
  IsEnabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAppointmentRuleRequest {
  RuleDesc: string;
  CodeStart: string;
  CodeEnd: string;
  IsEnabled?: boolean;
}

export interface UpdateAppointmentRuleRequest {
  RuleDesc?: string;
  CodeStart?: string;
  CodeEnd?: string;
  IsEnabled?: boolean;
}

// ========================================
// APPOINTMENT TYPE TYPES
// ========================================

export enum RequiredProcCodesNeeded {
  None = 0,
  AtLeastOne = 1,
  All = 2,
}

export interface AppointmentType {
  AppointmentTypeNum: number;
  AppointmentTypeName: string;
  AppointmentTypeColor?: number | null;
  ItemOrder?: number | null;
  IsHidden?: boolean;
  Pattern?: string | null;
  CodeStr?: string | null;
  CodeStrRequired?: string | null;
  RequiredProcCodesNeeded?: RequiredProcCodesNeeded | null;
  BlockoutTypes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAppointmentTypeRequest {
  AppointmentTypeName: string;
  AppointmentTypeColor?: number;
  ItemOrder?: number;
  IsHidden?: boolean;
  Pattern?: string;
  CodeStr?: string;
  CodeStrRequired?: string;
  RequiredProcCodesNeeded?: RequiredProcCodesNeeded;
  BlockoutTypes?: string;
}

export interface UpdateAppointmentTypeRequest {
  AppointmentTypeName?: string;
  AppointmentTypeColor?: number | null;
  ItemOrder?: number | null;
  IsHidden?: boolean;
  Pattern?: string | null;
  CodeStr?: string | null;
  CodeStrRequired?: string | null;
  RequiredProcCodesNeeded?: RequiredProcCodesNeeded | null;
  BlockoutTypes?: string | null;
}

// ========================================
// APPTFIELD & APPTFIELDDEF TYPES
// ========================================

export enum ApptFieldType {
  Text = 0,
  PickList = 1,
}

export interface ApptFieldDef {
  ApptFieldDefNum: number;
  FieldName: string;
  FieldType: ApptFieldType;
  PickList?: string | null;
  ItemOrder?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptFieldDefRequest {
  FieldName: string;
  FieldType: ApptFieldType;
  PickList?: string;
  ItemOrder?: number;
}

export interface UpdateApptFieldDefRequest {
  FieldName?: string;
  FieldType?: ApptFieldType;
  PickList?: string | null;
  ItemOrder?: number | null;
}

export interface ApptField {
  ApptFieldNum: number;
  AptNum: number;
  FieldName: string; // denormalized name
  FieldValue?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptFieldRequest {
  AptNum: number;
  FieldName: string;
  FieldValue?: string;
}

export interface UpdateApptFieldRequest {
  AptNum?: number;
  FieldName?: string;
  FieldValue?: string | null;
}

// ========================================
// APPT GENERAL MESSAGE SENT TYPES
// ========================================

export interface ApptGeneralMessageSent {
  ApptGeneralMessageSentNum: number;
  ApptNum: number;
  PatNum: number;
  ClinicNum: number;
  DateTimeEntry?: string;
  TSPrior?: number | null;
  ApptReminderRuleNum?: number | null;
  SendStatus?: number | null;
  ApptDateTime?: string | null;
  MessageType?: number | null;
  MessageFk?: number | null;
  DateTimeSent?: string | null;
  ResponseDescript?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptGeneralMessageSentRequest {
  ApptNum: number;
  PatNum: number;
  ClinicNum: number;
  TSPrior?: number;
  ApptReminderRuleNum?: number;
  SendStatus?: number;
  ApptDateTime?: string;
  MessageType?: number;
  MessageFk?: number;
  DateTimeSent?: string;
  ResponseDescript?: string;
}

export interface UpdateApptGeneralMessageSentRequest {
  ApptNum?: number;
  PatNum?: number;
  ClinicNum?: number;
  TSPrior?: number | null;
  ApptReminderRuleNum?: number | null;
  SendStatus?: number | null;
  ApptDateTime?: string | null;
  MessageType?: number | null;
  MessageFk?: number | null;
  DateTimeSent?: string | null;
  ResponseDescript?: string | null;
}

// ========================================
// APPT REMINDER RULE TYPES
// ========================================

export enum ApptReminderType {
  Undefined = -1,
  Reminder = 0,
  ConfirmationFutureDay = 1,
  ReminderFutureDay = 2, // deprecated
  PatientPortalInvite = 3,
  ScheduleThankYou = 4,
  Arrival = 5,
  Birthday = 6,
  GeneralMessage = 7,
  WebSchedRecall = 8,
  NewPatientThankYou = 9,
  PayPortalMsgToPay = 10,
  EClipboardWeb = 11,
}

export enum SendMultipleInvites {
  UntilPatientVisitsPortal = 0,
  EveryAppointment = 1,
  NoVisitInTimespan = 2,
}

export enum EmailType {
  Regular = 0,
  Html = 1,
  RawHtml = 2,
}

export interface ApptReminderRule {
  ApptReminderRuleNum: number;
  TypeCur: ApptReminderType;
  TSPrior: number; // positive before, negative after
  SendOrder: string; // comma list of comm types
  IsSendAll: boolean;
  TemplateSMS?: string | null;
  TemplateEmailSubject?: string | null;
  TemplateEmail?: string | null;
  ClinicNum: number;
  TemplateSMSAggShared?: string | null;
  TemplateSMSAggPerAppt?: string | null;
  TemplateEmailSubjAggShared?: string | null;
  TemplateEmailAggShared?: string | null;
  TemplateEmailAggPerAppt?: string | null;
  DoNotSendWithin?: number | null;
  IsEnabled: boolean;
  TemplateAutoReply?: string | null;
  TemplateAutoReplyAgg?: string | null;
  IsAutoReplyEnabled?: boolean;
  Language?: string | null;
  TemplateComeInMessage?: string | null;
  EmailTemplateType?: EmailType | null;
  AggEmailTemplateType?: EmailType | null;
  IsSendForMinorsBirthday?: boolean;
  EmailHostingTemplateNum?: number | null;
  MinorAge?: number | null;
  TemplateFailureAutoReply?: string | null;
  SendMultipleInvites?: SendMultipleInvites | null;
  TimeSpanMultipleInvites?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptReminderRuleRequest {
  TypeCur: ApptReminderType;
  TSPrior: number;
  SendOrder: string;
  IsSendAll?: boolean;
  TemplateSMS?: string;
  TemplateEmailSubject?: string;
  TemplateEmail?: string;
  ClinicNum?: number;
  TemplateSMSAggShared?: string;
  TemplateSMSAggPerAppt?: string;
  TemplateEmailSubjAggShared?: string;
  TemplateEmailAggShared?: string;
  TemplateEmailAggPerAppt?: string;
  DoNotSendWithin?: number;
  IsEnabled?: boolean;
  TemplateAutoReply?: string;
  TemplateAutoReplyAgg?: string;
  IsAutoReplyEnabled?: boolean;
  Language?: string;
  TemplateComeInMessage?: string;
  EmailTemplateType?: EmailType;
  AggEmailTemplateType?: EmailType;
  IsSendForMinorsBirthday?: boolean;
  EmailHostingTemplateNum?: number;
  MinorAge?: number;
  TemplateFailureAutoReply?: string;
  SendMultipleInvites?: SendMultipleInvites;
  TimeSpanMultipleInvites?: number;
}

export interface UpdateApptReminderRuleRequest extends Partial<CreateApptReminderRuleRequest> {}

// ========================================
// APPT REMINDER SENT TYPES
// ========================================

export interface ApptReminderSent {
  ApptReminderSentNum: number;
  ApptNum: number;
  ApptDateTime?: string | null;
  DateTimeSent?: string | null;
  TSPrior?: number | null;
  ApptReminderRuleNum?: number | null;
  PatNum?: number | null;
  ClinicNum?: number | null;
  SendStatus?: number | null;
  MessageType?: number | null;
  MessageFk?: number | null;
  DateTimeEntry?: string;
  ResponseDescript?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptReminderSentRequest {
  ApptNum: number;
  ApptDateTime?: string;
  DateTimeSent?: string;
  TSPrior?: number;
  ApptReminderRuleNum?: number;
  PatNum?: number;
  ClinicNum?: number;
  SendStatus?: number;
  MessageType?: number;
  MessageFk?: number;
  ResponseDescript?: string;
}

export interface UpdateApptReminderSentRequest {
  ApptNum?: number;
  ApptDateTime?: string | null;
  DateTimeSent?: string | null;
  TSPrior?: number | null;
  ApptReminderRuleNum?: number | null;
  PatNum?: number | null;
  ClinicNum?: number | null;
  SendStatus?: number | null;
  MessageType?: number | null;
  MessageFk?: number | null;
  ResponseDescript?: string | null;
}

// ========================================
// APPT THANK YOU SENT TYPES
// ========================================

export interface ApptThankYouSent {
  ApptThankYouSentNum: number;
  ApptNum: number;
  ApptDateTime?: string | null;
  ApptSecDateTEntry?: string | null;
  TSPrior?: number | null;
  ApptReminderRuleNum?: number | null;
  ClinicNum?: number | null;
  PatNum?: number | null;
  ResponseDescript?: string | null;
  DateTimeThankYouTransmit?: string | null;
  ShortGUID?: string | null;
  SendStatus?: number | null;
  MessageType?: number | null;
  MessageFk?: number | null;
  DateTimeEntry?: string;
  DateTimeSent?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptThankYouSentRequest {
  ApptNum: number;
  ApptDateTime?: string;
  ApptSecDateTEntry?: string;
  TSPrior?: number;
  ApptReminderRuleNum?: number;
  ClinicNum?: number;
  PatNum?: number;
  ResponseDescript?: string;
  DateTimeThankYouTransmit?: string;
  ShortGUID?: string;
  SendStatus?: number;
  MessageType?: number;
  MessageFk?: number;
  DateTimeEntry?: string;
  DateTimeSent?: string;
}

export interface UpdateApptThankYouSentRequest {
  ApptNum?: number;
  ApptDateTime?: string | null;
  ApptSecDateTEntry?: string | null;
  TSPrior?: number | null;
  ApptReminderRuleNum?: number | null;
  ClinicNum?: number | null;
  PatNum?: number | null;
  ResponseDescript?: string | null;
  DateTimeThankYouTransmit?: string | null;
  ShortGUID?: string | null;
  SendStatus?: number | null;
  MessageType?: number | null;
  MessageFk?: number | null;
  DateTimeEntry?: string | null;
  DateTimeSent?: string | null;
}

// ========================================
// APPT VIEW TYPES
// ========================================

export enum ApptViewStackBehavior {
  Vertical = 0,
  Horizontal = 1,
}

export enum WaitingRmName {
  LastFirst = 0,
  FirstLastI = 1,
  First = 2,
}

export enum ApptViewAlignment {
  Main = 0,
  UR = 1,
  LR = 2,
}

export interface ApptView {
  ApptViewNum: number;
  Description: string;
  ItemOrder: number;
  RowsPerIncr: number;
  OnlyScheduledProvs?: boolean;
  OnlySchedBeforeTime?: string | null; // time
  OnlySchedAfterTime?: string | null; // time
  StackBehavUR?: ApptViewStackBehavior;
  StackBehavLR?: ApptViewStackBehavior;
  ClinicNum?: number;
  ApptTimeScrollStart?: string | null; // time
  IsScrollStartDynamic?: boolean;
  IsApptBubblesDisabled?: boolean;
  WidthOpMinimum?: number | null;
  WaitingRmName?: WaitingRmName;
  OnlyScheduledProvDays?: boolean;
  ShowMirroredAppts?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptViewRequest {
  Description: string;
  ItemOrder: number;
  RowsPerIncr: number;
  OnlyScheduledProvs?: boolean;
  OnlySchedBeforeTime?: string;
  OnlySchedAfterTime?: string;
  StackBehavUR?: ApptViewStackBehavior;
  StackBehavLR?: ApptViewStackBehavior;
  ClinicNum?: number;
  ApptTimeScrollStart?: string;
  IsScrollStartDynamic?: boolean;
  IsApptBubblesDisabled?: boolean;
  WidthOpMinimum?: number;
  WaitingRmName?: WaitingRmName;
  OnlyScheduledProvDays?: boolean;
  ShowMirroredAppts?: boolean;
}

export interface UpdateApptViewRequest extends Partial<CreateApptViewRequest> {}

// ========================================
// APPT VIEW ITEM TYPES
// ========================================

export interface ApptViewItem {
  ApptViewItemNum: number;
  ApptViewNum: number;
  OpNum?: number | null;
  ProvNum?: number | null;
  ElementDesc?: string | null;
  ElementOrder?: number | null;
  ElementColor?: number | null;
  ElementAlignment?: ApptViewAlignment | null;
  ApptFieldDefNum?: number | null;
  PatFieldDefNum?: number | null;
  IsMobile?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApptViewItemRequest {
  ApptViewNum: number;
  OpNum?: number;
  ProvNum?: number;
  ElementDesc?: string;
  ElementOrder?: number;
  ElementColor?: number;
  ElementAlignment?: ApptViewAlignment;
  ApptFieldDefNum?: number;
  PatFieldDefNum?: number;
  IsMobile?: boolean;
}

export interface UpdateApptViewItemRequest extends Partial<CreateApptViewItemRequest> {}

// ========================================
// ASAP COMM TYPES
// ========================================

export enum AsapCommFKeyType {
  None = 0,
  ScheduledAppt = 1,
  UnscheduledAppt = 2,
  PlannedAppt = 3,
  Recall = 4,
  Broken = 5,
}

export enum AutoCommStatus {
  Undefined = 0,
  DoNotSend = 1,
  SendNotAttempted = 2,
  SendSuccessful = 3,
  SendFailed = 4,
  SentAwaitingReceipt = 5,
}

export enum AsapRSVPStatus {
  UnableToSend = 0,
  AwaitingTransmit = 1,
  PendingRsvp = 2,
  Viewed = 3,
  ViewedNotAvailable = 4,
  AcceptedAndMoved = 5,
  AcceptedAndNotAvailable = 6,
  Declined = 7,
  ChoseDifferentSlot = 8,
  Expired = 9,
  Failed = 10,
  DeclinedStopComm = 11,
}

export interface AsapComm {
  AsapCommNum: number;
  FKey: number;
  FKeyType: AsapCommFKeyType;
  ScheduleNum?: number | null;
  PatNum: number;
  ClinicNum: number;
  ShortGUID?: string | null;
  DateTimeEntry?: string | null;
  DateTimeExpire?: string | null;
  DateTimeSmsScheduled?: string | null;
  SmsSendStatus?: AutoCommStatus | null;
  EmailSendStatus?: AutoCommStatus | null;
  DateTimeSmsSent?: string | null;
  DateTimeEmailSent?: string | null;
  EmailMessageNum?: number | null;
  ResponseStatus?: AsapRSVPStatus | null;
  DateTimeOrig?: string | null;
  TemplateText?: string | null;
  TemplateEmail?: string | null;
  TemplateEmailSubj?: string | null;
  Note?: string | null;
  GuidMessageToMobile?: string | null;
  EmailTemplateType?: EmailType | null;
  UserNum?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAsapCommRequest {
  FKey: number;
  FKeyType: AsapCommFKeyType;
  PatNum: number;
  ClinicNum: number;
  ScheduleNum?: number;
  ShortGUID?: string;
  DateTimeEntry?: string;
  DateTimeExpire?: string;
  DateTimeSmsScheduled?: string;
  SmsSendStatus?: AutoCommStatus;
  EmailSendStatus?: AutoCommStatus;
  DateTimeSmsSent?: string;
  DateTimeEmailSent?: string;
  EmailMessageNum?: number;
  ResponseStatus?: AsapRSVPStatus;
  DateTimeOrig?: string;
  TemplateText?: string;
  TemplateEmail?: string;
  TemplateEmailSubj?: string;
  Note?: string;
  GuidMessageToMobile?: string;
  EmailTemplateType?: EmailType;
  UserNum?: number;
}

export interface UpdateAsapCommRequest extends Partial<CreateAsapCommRequest> {}

// ========================================
// AUTOCODE TYPES
// ========================================

export interface Autocode {
  AutoCodeNum: number;
  Description: string;
  IsHidden?: boolean;
  LessIntrusive?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutocodeRequest {
  Description: string;
  IsHidden?: boolean;
  LessIntrusive?: boolean;
}

export interface UpdateAutocodeRequest extends Partial<CreateAutocodeRequest> {}

// ========================================
// AUTOCODE CONDITION TYPES
// ========================================

export enum AutoCondition {
  Anterior = 0,
  Posterior = 1,
  Premolar = 2,
  Molar = 3,
  One_Surf = 4,
  Two_Surf = 5,
  Three_Surf = 6,
  Four_Surf = 7,
  Five_Surf = 8,
  First = 9,
  EachAdditional = 10,
  Maxillary = 11,
  Mandibular = 12,
  Primary = 13,
  Permanent = 14,
  Pontic = 15,
  Retainer = 16,
  AgeOver18 = 17,
}

export interface AutocodeCond {
  AutoCodeCondNum: number;
  AutoCodeItemNum: number;
  Cond: AutoCondition;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutocodeCondRequest {
  AutoCodeItemNum: number;
  Cond: AutoCondition;
}

export interface UpdateAutocodeCondRequest extends Partial<CreateAutocodeCondRequest> {}

// ========================================
// AUTOCODE ITEM TYPES
// ========================================

export interface AutocodeItem {
  AutoCodeItemNum: number;
  AutoCodeNum: number;
  OldCode?: string | null;
  CodeNum: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutocodeItemRequest {
  AutoCodeNum: number;
  CodeNum: number;
  OldCode?: string;
}

export interface UpdateAutocodeItemRequest extends Partial<CreateAutocodeItemRequest> {}

// ========================================
// AUTOCOMM EXCLUDE DATE TYPES
// ========================================

export interface AutoCommExcludeDate {
  AutoCommExcludeDateNum: number;
  ClinicNum: number;
  DateExclude: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutoCommExcludeDateRequest {
  ClinicNum: number;
  DateExclude: string;
}

export interface UpdateAutoCommExcludeDateRequest extends Partial<CreateAutoCommExcludeDateRequest> {}

// ========================================
// AUTOMATION TYPES
// ========================================

export enum AutomationTrigger {
  ProcedureComplete = 0,
  ApptBreak = 1,
  ApptNewPatCreate = 2,
  PatientOpen = 3,
  ApptCreate = 4,
  ProcSchedule = 5,
  BillingTypeSet = 6,
  RxCreate = 7,
  ClaimCreate = 8,
  ClaimOpen = 9,
  ApptComplete = 10,
}

export enum AutomationAction {
  PrintPatientLetter = 0,
  CreateCommlog = 1,
  PrintReferralLetter = 2,
  ShowExamSheet = 3,
  PopUp = 4,
  SetApptASAP = 5,
  ShowConsentForm = 6,
  SetApptType = 7,
  PopUpThenDisable10Min = 8,
  PatRestrictApptSchedTrue = 9,
  PatRestrictApptSchedFalse = 10,
  PrintRxInstruction = 11,
  ChangePatStatus = 12,
}

export enum PatientStatus {
  Patient = 0,
  NonPatient = 1,
  Inactive = 2,
  Archived = 3,
  Deleted = 4,
  Deceased = 5,
  Prospective = 6,
}

export interface Automation {
  AutomationNum: number;
  Description: string;
  Autotrigger: AutomationTrigger;
  ProcCodes?: string | null;
  AutoAction: AutomationAction;
  SheetDefNum?: number | null;
  CommType?: number | null;
  MessageContent?: string | null;
  AptStatus?: ApptStatus | null;
  AppointmentTypeNum?: number | null;
  PatStatus?: PatientStatus | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutomationRequest {
  Description: string;
  Autotrigger: AutomationTrigger;
  AutoAction: AutomationAction;
  ProcCodes?: string;
  SheetDefNum?: number;
  CommType?: number;
  MessageContent?: string;
  AptStatus?: ApptStatus;
  AppointmentTypeNum?: number;
  PatStatus?: PatientStatus;
}

export interface UpdateAutomationRequest extends Partial<CreateAutomationRequest> {}

// ========================================
// AUTOMATION CONDITION TYPES
// ========================================

export enum AutoCondField {
  NeedsSheet = 0,
  Problem = 1,
  Medication = 2,
  Allergy = 3,
  Age = 4,
  Gender = 5,
  Labresult = 6,
  InsuranceNotEffective = 7,
  BillingType = 8,
  IsProcRequired = 9,
  IsControlled = 10,
  IsPatientInstructionPresent = 11,
  PlanNum = 12,
  ClaimContainsProcCode = 13,
}

export enum AutoCondComparison {
  Equals = 0,
  GreaterThan = 1,
  LessThan = 2,
  Contains = 3,
  None = 4,
}

export interface AutomationCondition {
  AutomationConditionNum: number;
  AutomationNum: number;
  CompareField: AutoCondField;
  Comparison: AutoCondComparison;
  CompareString?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutomationConditionRequest {
  AutomationNum: number;
  CompareField: AutoCondField;
  Comparison: AutoCondComparison;
  CompareString?: string;
}

export interface UpdateAutomationConditionRequest extends Partial<CreateAutomationConditionRequest> {}

// ========================================
// AUTONOTE TYPES
// ========================================

export interface Autonote {
  AutoNoteNum: number;
  AutoNoteName: string;
  MainText?: string | null;
  Category?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutonoteRequest {
  AutoNoteName: string;
  MainText?: string;
  Category?: number;
}

export interface UpdateAutonoteRequest extends Partial<CreateAutonoteRequest> {}

// ========================================
// AUTONOTE CONTROL TYPES
// ========================================

export enum AutonoteControlType {
  Text = 'Text',
  OneResponse = 'OneResponse',
  MultiResponse = 'MultiResponse',
}

export interface AutonoteControl {
  AutoNoteControlNum: number;
  Descript: string;
  ControlType: AutonoteControlType;
  ControlLabel: string;
  ControlOptions?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAutonoteControlRequest {
  Descript: string;
  ControlType: AutonoteControlType;
  ControlLabel: string;
  ControlOptions?: string;
}

export interface UpdateAutonoteControlRequest extends Partial<CreateAutonoteControlRequest> {}

// ========================================
// BENEFIT TYPES
// ========================================

export enum InsBenefitType {
  ActiveCoverage = 0,
  CoInsurance = 1,
  Deductible = 2,
  CoPayment = 3,
  Exclusions = 4,
  Limitations = 5,
  WaitingPeriod = 6,
}

export enum BenefitTimePeriod {
  None = 0,
  ServiceYear = 1,
  CalendarYear = 2,
  Lifetime = 3,
  Years = 4,
  NumberInLast12Months = 5,
}

export enum BenefitQuantity {
  None = 0,
  NumberOfServices = 1,
  AgeLimit = 2,
  Visits = 3,
  Years = 4,
  Months = 5,
}

export enum BenefitCoverageLevel {
  None = 0,
  Individual = 1,
  Family = 2,
}

export enum TreatmentArea {
  None = 0,
  Surf = 1,
  Tooth = 2,
  Mouth = 3,
  Quad = 4,
  Sextant = 5,
  Arch = 6,
  ToothRange = 7,
}

export interface Benefit {
  BenefitNum: number;
  PlanNum?: number | null;
  PatPlanNum?: number | null;
  CovCatNum?: number | null;
  BenefitType: InsBenefitType;
  Percent?: number | null;
  MonetaryAmt?: number | null;
  TimePeriod?: BenefitTimePeriod | null;
  QuantityQualifier?: BenefitQuantity | null;
  Quantity?: number | null;
  CodeNum?: number | null;
  CoverageLevel?: BenefitCoverageLevel | null;
  SecDateTEntry?: string;
  SecDateTEdit?: string;
  CodeGroupNum?: number | null;
  TreatArea?: TreatmentArea | null;
  ToothRange?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateBenefitRequest {
  BenefitType: InsBenefitType;
  PlanNum?: number;
  PatPlanNum?: number;
  CovCatNum?: number;
  Percent?: number;
  MonetaryAmt?: number;
  TimePeriod?: BenefitTimePeriod;
  QuantityQualifier?: BenefitQuantity;
  Quantity?: number;
  CodeNum?: number;
  CoverageLevel?: BenefitCoverageLevel;
  CodeGroupNum?: number;
  TreatArea?: TreatmentArea;
  ToothRange?: string;
}

export interface UpdateBenefitRequest extends Partial<CreateBenefitRequest> {}

// ========================================
// BRANDING TYPES
// ========================================

export enum BrandingType {
  None = 0,
  LogoFilePath = 1,
  MaterialColorPalette = 2,
  OfficeDescription = 3,
}

export interface Branding {
  BrandingNum: number;
  BrandingType: BrandingType;
  ClinicNum?: number | null;
  ValueString?: string | null;
  DateTimeUpdated?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateBrandingRequest {
  BrandingType: BrandingType;
  ClinicNum?: number;
  ValueString?: string;
  DateTimeUpdated?: string;
}

export interface UpdateBrandingRequest extends Partial<CreateBrandingRequest> {}

// ========================================
// CANADIAN NETWORK TYPES
// ========================================

export interface CanadianNetwork {
  CanadianNetworkNum: number;
  Abbrev: string;
  Descript: string;
  CanadianTransactionPrefix?: string | null;
  CanadianIsRprHandler?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCanadianNetworkRequest {
  Abbrev: string;
  Descript: string;
  CanadianTransactionPrefix?: string;
  CanadianIsRprHandler?: boolean;
}

export interface UpdateCanadianNetworkRequest extends Partial<CreateCanadianNetworkRequest> {}

// ========================================
// CARRIER TYPES
// ========================================

export enum NoSendElectType {
  SendElect = 0,
  NoSendElect = 1,
  NoSendSecondaryElect = 2,
}

export enum TrustedEtransTypes {
  None = 0,
  RealTimeEligibility = 1,
}

export enum EclaimCobInsPaidBehavior {
  Default = 0,
  ClaimLevel = 1,
  ProcedureLevel = 2,
  Both = 3,
}

export enum EraAutomationMode {
  UseGlobal = 0,
  ReviewAll = 1,
  SemiAutomatic = 2,
  FullyAutomatic = 3,
}

export enum EnumOrthoInsPayConsolidate {
  Global = 0,
  ForceConsolidateOn = 1,
  ForceConsolidateOff = 2,
}

export enum EnumPaySuiteTransTypes {
  None = 0,
  ExtendedReversal = 1,
  PlanDetails = 2,
  Both = 3,
}

export interface Carrier {
  CarrierNum: number;
  CarrierName: string;
  Address?: string | null;
  Address2?: string | null;
  City?: string | null;
  State?: string | null;
  Zip?: string | null;
  Phone?: string | null;
  ElectID?: string | null;
  NoSendElect?: NoSendElectType | null;
  IsCDA?: boolean;
  CDAnetVersion?: string | null;
  CanadianNetworkNum?: number | null;
  IsHidden?: boolean;
  CanadianEncryptionMethod?: number | null;
  CanadianSupportedTypes?: number | null;
  SecUserNumEntry?: number | null;
  SecDateEntry?: string | null;
  SecDateTEdit?: string | null;
  TIN?: string | null;
  CarrierGroupName?: number | null;
  ApptTextBackColor?: number | null;
  IsCoinsuranceInverted?: boolean;
  TrustedEtransFlags?: TrustedEtransTypes | null;
  CobInsPaidBehaviorOverride?: EclaimCobInsPaidBehavior | null;
  EraAutomationOverride?: EraAutomationMode | null;
  OrthoInsPayConsolidate?: EnumOrthoInsPayConsolidate | null;
  PaySuiteTransSup?: EnumPaySuiteTransTypes | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCarrierRequest {
  CarrierName: string;
  Address?: string;
  Address2?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Phone?: string;
  ElectID?: string;
  NoSendElect?: NoSendElectType;
  IsCDA?: boolean;
  CDAnetVersion?: string;
  CanadianNetworkNum?: number;
  IsHidden?: boolean;
  CanadianEncryptionMethod?: number;
  CanadianSupportedTypes?: number;
  SecUserNumEntry?: number;
  SecDateEntry?: string;
  TIN?: string;
  CarrierGroupName?: number;
  ApptTextBackColor?: number;
  IsCoinsuranceInverted?: boolean;
  TrustedEtransFlags?: TrustedEtransTypes;
  CobInsPaidBehaviorOverride?: EclaimCobInsPaidBehavior;
  EraAutomationOverride?: EraAutomationMode;
  OrthoInsPayConsolidate?: EnumOrthoInsPayConsolidate;
  PaySuiteTransSup?: EnumPaySuiteTransTypes;
}

export interface UpdateCarrierRequest extends Partial<CreateCarrierRequest> {}

// ========================================
// CDCREC TYPES
// ========================================

export interface Cdcrec {
  CdcrecNum: number;
  CdcrecCode: string;
  HeirarchicalCode: string;
  Description: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCdcrecRequest {
  CdcrecCode: string;
  HeirarchicalCode: string;
  Description: string;
}

export interface UpdateCdcrecRequest extends Partial<CreateCdcrecRequest> {}

// ========================================
// CDS PERMISSION TYPES
// ========================================

export interface CdsPermission {
  CDSPermissionNum: number;
  UserNum: number;
  SetupCDS?: boolean;
  ShowCDS?: boolean;
  ShowInfobutton?: boolean;
  EditBibliography?: boolean;
  ProblemCDS?: boolean;
  MedicationCDS?: boolean;
  AllergyCDS?: boolean;
  DemographicCDS?: boolean;
  LabTestCDS?: boolean;
  VitalCDS?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCdsPermissionRequest {
  UserNum: number;
  SetupCDS?: boolean;
  ShowCDS?: boolean;
  ShowInfobutton?: boolean;
  EditBibliography?: boolean;
  ProblemCDS?: boolean;
  MedicationCDS?: boolean;
  AllergyCDS?: boolean;
  DemographicCDS?: boolean;
  LabTestCDS?: boolean;
  VitalCDS?: boolean;
}

export interface UpdateCdsPermissionRequest extends Partial<CreateCdsPermissionRequest> {}

// ========================================
// CENTRAL CONNECTION TYPES
// ========================================

export interface CentralConnection {
  CentralConnectionNum: number;
  ServerName?: string | null;
  DatabaseName?: string | null;
  MySqlUser?: string | null;
  MySqlPassword?: string | null;
  ServiceURI?: string | null;
  OdUser?: string | null;
  OdPassword?: string | null;
  Note?: string | null;
  ItemOrder?: number | null;
  WebServiceIsEcw?: boolean;
  ConnectionStatus?: string | null;
  HasClinicBreakdownReports?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCentralConnectionRequest {
  ServerName?: string;
  DatabaseName?: string;
  MySqlUser?: string;
  MySqlPassword?: string;
  ServiceURI?: string;
  OdUser?: string;
  OdPassword?: string;
  Note?: string;
  ItemOrder?: number;
  WebServiceIsEcw?: boolean;
  ConnectionStatus?: string;
  HasClinicBreakdownReports?: boolean;
}

export interface UpdateCentralConnectionRequest extends Partial<CreateCentralConnectionRequest> {}

// ========================================
// CERT TYPES
// ========================================

export interface Cert {
  CertNum: number;
  Description: string;
  WikiPageLink?: string | null;
  ItemOrder?: number | null;
  IsHidden?: boolean;
  CertCategoryNum?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCertRequest {
  Description: string;
  WikiPageLink?: string;
  ItemOrder?: number;
  IsHidden?: boolean;
  CertCategoryNum?: number;
}

export interface UpdateCertRequest extends Partial<CreateCertRequest> {}

// ========================================
// CERT EMPLOYEE TYPES
// ========================================

export interface CertEmployee {
  CertEmployeeNum: number;
  CertNum: number;
  EmployeeNum: number;
  DateCompleted?: string | null;
  Note?: string | null;
  UserNum?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateCertEmployeeRequest {
  CertNum: number;
  EmployeeNum: number;
  DateCompleted?: string;
  Note?: string;
  UserNum?: number;
}

export interface UpdateCertEmployeeRequest extends Partial<CreateCertEmployeeRequest> {}

// ========================================
// CHART VIEW TYPES
// ========================================

export enum ChartViewProcStat {
  None = 0,
  TP = 1,
  Complete = 2,
  ExistingCurProv = 4,
  ExistingOtherProv = 8,
  Referred = 16,
  Deleted = 32,
  Condition = 64,
  All = 127,
}

export enum ChartViewObjs {
  None = 0,
  Appointments = 1,
  CommLog = 2,
  CommLogFamily = 4,
  Tasks = 8,
  Email = 16,
  LabCases = 32,
  Rx = 64,
  Sheets = 128,
  CommLogSuperFamily = 256,
  All = 511,
}

export enum ChartViewDates {
  All = 0,
  Today = 1,
  Yesterday = 2,
  ThisYear = 3,
  LastYear = 4,
}

export interface ChartView {
  ChartViewNum: number;
  Description: string;
  ItemOrder?: number | null;
  ProcStatuses?: ChartViewProcStat | null;
  ObjectTypes?: ChartViewObjs | null;
  ShowProcNotes?: boolean;
  IsAudit?: boolean;
  SelectedTeethOnly?: boolean;
  OrionStatusFlags?: number | null;
  DatesShowing?: ChartViewDates | null;
  IsTpCharting?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChartViewRequest {
  Description: string;
  ItemOrder?: number;
  ProcStatuses?: ChartViewProcStat;
  ObjectTypes?: ChartViewObjs;
  ShowProcNotes?: boolean;
  IsAudit?: boolean;
  SelectedTeethOnly?: boolean;
  OrionStatusFlags?: number;
  DatesShowing?: ChartViewDates;
  IsTpCharting?: boolean;
}

export interface UpdateChartViewRequest extends Partial<CreateChartViewRequest> {}

// ========================================
// CHAT TYPES
// ========================================

export interface Chat {
  ChatNum: number;
  Name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChatRequest {
  Name: string;
}

export interface UpdateChatRequest extends Partial<CreateChatRequest> {}

// ========================================
// CHAT ATTACH TYPES
// ========================================

export interface ChatAttach {
  ChatAttachNum: number;
  ChatMsgNum: number;
  FileName: string;
  Thumbnail?: string | null;
  FileData?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChatAttachRequest {
  ChatMsgNum: number;
  FileName: string;
  Thumbnail?: string;
  FileData?: string;
}

export interface UpdateChatAttachRequest extends Partial<CreateChatAttachRequest> {}

// ========================================
// CHAT MESSAGE TYPES
// ========================================

export interface ChatMsg {
  ChatMsgNum: number;
  ChatNum: number;
  UserNum: number;
  DateTimeSent: string;
  Message?: string | null;
  SeqCount: number;
  Quote?: number | null;
  EventType?: number | null;
  IsImportant?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChatMsgRequest {
  ChatNum: number;
  UserNum: number;
  DateTimeSent: string;
  Message?: string;
  SeqCount: number;
  Quote?: number;
  EventType?: number;
  IsImportant?: boolean;
}

export interface UpdateChatMsgRequest extends Partial<CreateChatMsgRequest> {}

// ========================================
// CHAT REACTION TYPES
// ========================================

export interface ChatReaction {
  ChatReactionNum: number;
  ChatMsgNum: number;
  UserNum: number;
  EmojiName: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChatReactionRequest {
  ChatMsgNum: number;
  UserNum: number;
  EmojiName: string;
}

export interface UpdateChatReactionRequest extends Partial<CreateChatReactionRequest> {}

// ========================================
// CHAT USER ATTACH TYPES
// ========================================

export interface ChatUserAttach {
  ChatUserAttachNum: number;
  UserNum: number;
  ChatNum: number;
  IsRead?: boolean;
  DateTimeRemoved?: string | null;
  IsMute?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChatUserAttachRequest {
  UserNum: number;
  ChatNum: number;
  IsRead?: boolean;
  DateTimeRemoved?: string;
  IsMute?: boolean;
}

export interface UpdateChatUserAttachRequest extends Partial<CreateChatUserAttachRequest> {}

// ========================================
// CHAT USER STATUS (CHATUSEROD) TYPES
// ========================================

export enum ChatUserStatus {
  Available = 0,
  Away = 1,
  DoNotDisturb = 2,
}

export interface ChatUserod {
  ChatUserodNum: number;
  UserNum: number;
  UserStatus?: ChatUserStatus | null;
  DateTimeStatusReset?: string | null;
  Photo?: string | null;
  PhotoCrop?: string | null;
  OpenBackground?: boolean;
  CloseKeepRunning?: boolean;
  MuteNotifications?: boolean;
  DismissNotifySecs?: number | null;
  MuteImportantNotifications?: boolean;
  DismissImportantNotifySecs?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChatUserodRequest {
  UserNum: number;
  UserStatus?: ChatUserStatus;
  DateTimeStatusReset?: string;
  Photo?: string;
  PhotoCrop?: string;
  OpenBackground?: boolean;
  CloseKeepRunning?: boolean;
  MuteNotifications?: boolean;
  DismissNotifySecs?: number;
  MuteImportantNotifications?: boolean;
  DismissImportantNotifySecs?: number;
}

export interface UpdateChatUserodRequest extends Partial<CreateChatUserodRequest> {}

// ========================================
// CLAIM TYPES
// ========================================

export enum PlaceService {
  Office = 0,
  PatientsHome = 1,
  InpatHospital = 2,
  OutpatHospital = 3,
  SkilledNursFac = 4,
  CustodialCareFacility = 5,
  OtherLocation = 6,
  MobileUnit = 7,
  School = 8,
  MilitaryTreatFac = 9,
  FederalHealthCenter = 10,
  PublicHealthClinic = 11,
  RuralHealthClinic = 12,
  EmergencyRoomHospital = 13,
  AmbulatorySurgicalCenter = 14,
  TelehealthOutsideHome = 15,
  TelehealthInHome = 16,
  OutreachSiteOrStreet = 17,
}

export enum EmployRelated {
  Unknown = 0,
  Yes = 1,
  No = 2,
}

export enum ClaimSpecialProgram {
  None = 0,
  EPSDT_1 = 1,
  Handicapped_2 = 2,
  SpecialFederal_3 = 3,
  Disability_5 = 5,
  SecondOpinion_9 = 9,
}

export enum ClaimMedType {
  Dental = 0,
  Medical = 1,
  Institutional = 2,
}

export enum ClaimCorrectionType {
  Original = 0,
  Replacement = 1,
  Void = 2,
}

export enum DateIllnessInjuryPregQualifier {
  None = 0,
  OnsetCurSymptoms = 431,
  LastMenstrualPeriod = 484,
}

export enum DateOtherQualifier {
  None = 0,
  ReportStart = 90,
  ReportEnd = 91,
  LatestVisitConsult = 304,
  Accident = 439,
  FirstVisitConsult = 444,
  ChronicCondManifest = 453,
  InitialTreatment = 454,
  LastXray = 455,
  Prescription = 471,
}

export interface Claim {
  ClaimNum: number;
  PatNum: number;
  DateService?: string | null;
  DateSent?: string | null;
  ClaimStatus: string;
  DateReceived?: string | null;
  PlanNum?: number | null;
  ProvTreat?: number | null;
  ClaimFee?: number | null;
  InsPayEst?: number | null;
  InsPayAmt?: number | null;
  DedApplied?: number | null;
  PreAuthString?: string | null;
  IsProsthesis?: string | null;
  PriorDate?: string | null;
  ReasonUnderPaid?: string | null;
  ClaimNote?: string | null;
  ClaimType: string;
  ProvBill?: number | null;
  ReferringProv?: number | null;
  RefNumString?: string | null;
  PlaceService?: PlaceService | null;
  AccidentRelated?: string | null;
  AccidentDate?: string | null;
  AccidentST?: string | null;
  EmployRelated?: EmployRelated | null;
  IsOrtho?: boolean;
  OrthoRemainM?: number | null;
  OrthoDate?: string | null;
  PatRelat?: number | null;
  PlanNum2?: number | null;
  PatRelat2?: number | null;
  WriteOff?: number | null;
  Radiographs?: number | null;
  ClinicNum?: number | null;
  ClaimForm?: number | null;
  AttachedImages?: number | null;
  AttachedModels?: number | null;
  AttachedFlags?: string | null;
  AttachmentID?: string | null;
  CanadianMaterialsForwarded?: string | null;
  CanadianReferralProviderNum?: string | null;
  CanadianReferralReason?: number | null;
  CanadianIsInitialLower?: string | null;
  CanadianDateInitialLower?: string | null;
  CanadianMandProsthMaterial?: number | null;
  CanadianIsInitialUpper?: string | null;
  CanadianDateInitialUpper?: string | null;
  CanadianMaxProsthMaterial?: number | null;
  InsSubNum?: number | null;
  InsSubNum2?: number | null;
  CanadaTransRefNum?: string | null;
  CanadaEstTreatStartDate?: string | null;
  CanadaInitialPayment?: number | null;
  CanadaPaymentMode?: number | null;
  CanadaTreatDuration?: number | null;
  CanadaNumAnticipatedPayments?: number | null;
  CanadaAnticipatedPayAmount?: number | null;
  PriorAuthorizationNumber?: string | null;
  SpecialProgramCode?: ClaimSpecialProgram | null;
  UniformBillType?: string | null;
  MedType?: ClaimMedType | null;
  AdmissionTypeCode?: string | null;
  AdmissionSourceCode?: string | null;
  PatientStatusCode?: string | null;
  CustomTracking?: number | null;
  DateResent?: string | null;
  CorrectionType?: ClaimCorrectionType | null;
  ClaimIdentifier?: string | null;
  OrigRefNum?: string | null;
  ProvOrderOverride?: number | null;
  OrthoTotalM?: number | null;
  ShareOfCost?: number | null;
  SecUserNumEntry?: number | null;
  SecDateEntry?: string | null;
  SecDateTEdit?: string | null;
  OrderingReferralNum?: number | null;
  DateSentOrig?: string | null;
  DateIllnessInjuryPreg?: string | null;
  DateIllnessInjuryPregQualifier?: DateIllnessInjuryPregQualifier | null;
  DateOther?: string | null;
  DateOtherQualifier?: DateOtherQualifier | null;
  IsOutsideLab?: boolean;
  SecurityHash?: string | null;
  Narrative?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateClaimRequest {
  PatNum: number;
  ClaimStatus: string;
  ClaimType: string;
  DateService?: string;
  DateSent?: string;
  DateReceived?: string;
  PlanNum?: number;
  ProvTreat?: number;
  ClaimFee?: number;
  InsPayEst?: number;
  InsPayAmt?: number;
  DedApplied?: number;
  PreAuthString?: string;
  IsProsthesis?: string;
  PriorDate?: string;
  ReasonUnderPaid?: string;
  ClaimNote?: string;
  ProvBill?: number;
  ReferringProv?: number;
  RefNumString?: string;
  PlaceService?: PlaceService;
  AccidentRelated?: string;
  AccidentDate?: string;
  AccidentST?: string;
  EmployRelated?: EmployRelated;
  IsOrtho?: boolean;
  OrthoRemainM?: number;
  OrthoDate?: string;
  PatRelat?: number;
  PlanNum2?: number;
  PatRelat2?: number;
  WriteOff?: number;
  Radiographs?: number;
  ClinicNum?: number;
  ClaimForm?: number;
  AttachedImages?: number;
  AttachedModels?: number;
  AttachedFlags?: string;
  AttachmentID?: string;
  CanadianMaterialsForwarded?: string;
  CanadianReferralProviderNum?: string;
  CanadianReferralReason?: number;
  CanadianIsInitialLower?: string;
  CanadianDateInitialLower?: string;
  CanadianMandProsthMaterial?: number;
  CanadianIsInitialUpper?: string;
  CanadianDateInitialUpper?: string;
  CanadianMaxProsthMaterial?: number;
  InsSubNum?: number;
  InsSubNum2?: number;
  CanadaTransRefNum?: string;
  CanadaEstTreatStartDate?: string;
  CanadaInitialPayment?: number;
  CanadaPaymentMode?: number;
  CanadaTreatDuration?: number;
  CanadaNumAnticipatedPayments?: number;
  CanadaAnticipatedPayAmount?: number;
  PriorAuthorizationNumber?: string;
  SpecialProgramCode?: ClaimSpecialProgram;
  UniformBillType?: string;
  MedType?: ClaimMedType;
  AdmissionTypeCode?: string;
  AdmissionSourceCode?: string;
  PatientStatusCode?: string;
  CustomTracking?: number;
  DateResent?: string;
  CorrectionType?: ClaimCorrectionType;
  ClaimIdentifier?: string;
  OrigRefNum?: string;
  ProvOrderOverride?: number;
  OrthoTotalM?: number;
  ShareOfCost?: number;
  SecUserNumEntry?: number;
  SecDateEntry?: string;
  SecDateTEdit?: string;
  OrderingReferralNum?: number;
  DateSentOrig?: string;
  DateIllnessInjuryPreg?: string;
  DateIllnessInjuryPregQualifier?: DateIllnessInjuryPregQualifier;
  DateOther?: string;
  DateOtherQualifier?: DateOtherQualifier;
  IsOutsideLab?: boolean;
  SecurityHash?: string;
  Narrative?: string;
}

export interface UpdateClaimRequest extends Partial<CreateClaimRequest> {}

// ========================================
// CLAIM ATTACH TYPES
// ========================================

export interface ClaimAttach {
  ClaimAttachNum: number;
  ClaimNum: number;
  DisplayedFileName: string;
  ActualFileName?: string | null;
  ImageReferenceId?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateClaimAttachRequest {
  ClaimNum: number;
  DisplayedFileName: string;
  ActualFileName?: string;
  ImageReferenceId?: number;
}

export interface UpdateClaimAttachRequest extends Partial<CreateClaimAttachRequest> {}

// ========================================
// CLAIM CONDITION CODE LOG TYPES
// ========================================

export interface ClaimCondCodeLog {
  ClaimCondCodeLogNum: number;
  ClaimNum: number;
  Code0?: string | null;
  Code1?: string | null;
  Code2?: string | null;
  Code3?: string | null;
  Code4?: string | null;
  Code5?: string | null;
  Code6?: string | null;
  Code7?: string | null;
  Code8?: string | null;
  Code9?: string | null;
  Code10?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateClaimCondCodeLogRequest {
  ClaimNum: number;
  Code0?: string;
  Code1?: string;
  Code2?: string;
  Code3?: string;
  Code4?: string;
  Code5?: string;
  Code6?: string;
  Code7?: string;
  Code8?: string;
  Code9?: string;
  Code10?: string;
}

export interface UpdateClaimCondCodeLogRequest extends Partial<CreateClaimCondCodeLogRequest> {}

// ========================================
// CLAIM FORM TYPES
// ========================================

export interface ClaimForm {
  ClaimFormNum: number;
  Description: string;
  IsHidden?: boolean;
  FontName?: string | null;
  FontSize?: number | null;
  UniqueID?: string | null;
  PrintImages?: boolean;
  OffsetX?: number | null;
  OffsetY?: number | null;
  Width?: number | null;
  Height?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateClaimFormRequest {
  Description: string;
  IsHidden?: boolean;
  FontName?: string;
  FontSize?: number;
  UniqueID?: string;
  PrintImages?: boolean;
  OffsetX?: number;
  OffsetY?: number;
  Width?: number;
  Height?: number;
}

export interface UpdateClaimFormRequest extends Partial<CreateClaimFormRequest> {}

// ========================================
// CLAIM FORM ITEM TYPES
// ========================================

export interface ClaimFormItem {
  ClaimFormItemNum: number;
  ClaimFormNum: number;
  ImageFileName?: string | null;
  FieldName: string;
  FormatString?: string | null;
  XPos?: number | null;
  YPos?: number | null;
  Width?: number | null;
  Height?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateClaimFormItemRequest {
  ClaimFormNum: number;
  FieldName: string;
  ImageFileName?: string;
  FormatString?: string;
  XPos?: number;
  YPos?: number;
  Width?: number;
  Height?: number;
}

export interface UpdateClaimFormItemRequest extends Partial<CreateClaimFormItemRequest> {}

// ========================================
// SHARED TYPES
// ========================================

/**
 * API Response wrapper
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
