import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { executeQuery, initializeClinicTable, initializeAccountTable, initializeDefinitionTable, initializeAccountingAutoPayTable, initializeUserodTable, initializeActiveInstanceTable, initializeAdjustmentTable, initializeAlertCategoryTable, initializeAlertCategoryLinkTable, initializeAlertItemTable, initializeAlertReadTable, initializeAlertSubTable, initializeAllergyTable, initializeAllergyDefTable, initializeAPIKeyTable, initializeApiSubscriptionTable, initializeAppointmentTable, initializeAppointmentRuleTable, initializeAppointmentTypeTable, initializeApptFieldDefTable, initializeApptFieldTable, initializeApptGeneralMessageSentTable, initializeApptReminderRuleTable, initializeApptReminderSentTable, initializeApptThankYouSentTable, initializeApptViewTable, initializeApptViewItemTable, initializeAsapCommTable, initializeAutocodeTable, initializeAutocodeCondTable, initializeAutocodeItemTable, initializeAutoCommExcludeDateTable, initializeAutomationTable, initializeAutomationConditionTable, initializeAutonoteTable, initializeAutonoteControlTable, initializeBenefitTable, initializeBrandingTable, initializeCanadianNetworkTable, initializeCarrierTable, initializeCdcrecTable, initializeCdsPermissionTable, initializeCentralConnectionTable, initializeCertTable, initializeCertEmployeeTable, initializeChartViewTable, initializeChatTable, initializeChatMsgTable, initializeChatReactionTable, initializeChatUserAttachTable, initializeChatUserodTable, initializeChatAttachTable, initializeClaimTable, initializeClaimAttachTable, initializeClaimCondCodeLogTable, initializeClaimFormTable, initializeClaimFormItemTable } from './db-connection';
import { 
  Clinic, CreateClinicRequest, UpdateClinicRequest,
  Account, CreateAccountRequest, UpdateAccountRequest,
  Definition, CreateDefinitionRequest, UpdateDefinitionRequest, ListDefinitionsQuery,
  AccountingAutoPay, CreateAccountingAutoPayRequest, UpdateAccountingAutoPayRequest,
  Userod, CreateUserodRequest, UpdateUserodRequest,
  ActiveInstance, CreateActiveInstanceRequest, UpdateActiveInstanceRequest, ConnectionType,
  Adjustment, CreateAdjustmentRequest, UpdateAdjustmentRequest,
  AlertCategory, CreateAlertCategoryRequest, UpdateAlertCategoryRequest,
  AlertCategoryLink, CreateAlertCategoryLinkRequest, UpdateAlertCategoryLinkRequest, AlertType,
  AlertItem, CreateAlertItemRequest, UpdateAlertItemRequest, SeverityType, ActionType, FormType,
  AlertRead, CreateAlertReadRequest, UpdateAlertReadRequest,
  AlertSub, CreateAlertSubRequest, UpdateAlertSubRequest,
  Allergy, CreateAllergyRequest, UpdateAllergyRequest,
  AllergyDef, CreateAllergyDefRequest, UpdateAllergyDefRequest,
  APIKey, CreateAPIKeyRequest, UpdateAPIKeyRequest,
  ApiSubscription, CreateApiSubscriptionRequest, UpdateApiSubscriptionRequest,
  Appointment, CreateAppointmentRequest, UpdateAppointmentRequest, ApptStatus, ApptPriority,
  AppointmentRule, CreateAppointmentRuleRequest, UpdateAppointmentRuleRequest,
  AppointmentType, CreateAppointmentTypeRequest, UpdateAppointmentTypeRequest, RequiredProcCodesNeeded,
  ApptFieldDef, CreateApptFieldDefRequest, UpdateApptFieldDefRequest, ApptFieldType,
  ApptField, CreateApptFieldRequest, UpdateApptFieldRequest,
  ApptGeneralMessageSent, CreateApptGeneralMessageSentRequest, UpdateApptGeneralMessageSentRequest,
  ApptReminderRule, CreateApptReminderRuleRequest, UpdateApptReminderRuleRequest, ApptReminderType, SendMultipleInvites, EmailType,
  ApptReminderSent, CreateApptReminderSentRequest, UpdateApptReminderSentRequest,
  ApptThankYouSent, CreateApptThankYouSentRequest, UpdateApptThankYouSentRequest,
  ApptView, CreateApptViewRequest, UpdateApptViewRequest, ApptViewStackBehavior, WaitingRmName,
  ApptViewItem, CreateApptViewItemRequest, UpdateApptViewItemRequest, ApptViewAlignment,
  AsapComm, CreateAsapCommRequest, UpdateAsapCommRequest, AsapCommFKeyType, AutoCommStatus, AsapRSVPStatus,
  Autocode, CreateAutocodeRequest, UpdateAutocodeRequest,
  AutocodeCond, CreateAutocodeCondRequest, UpdateAutocodeCondRequest, AutoCondition,
  AutocodeItem, CreateAutocodeItemRequest, UpdateAutocodeItemRequest,
  AutoCommExcludeDate, CreateAutoCommExcludeDateRequest, UpdateAutoCommExcludeDateRequest,
  Automation, CreateAutomationRequest, UpdateAutomationRequest, AutomationTrigger, AutomationAction, PatientStatus,
  AutomationCondition, CreateAutomationConditionRequest, UpdateAutomationConditionRequest, AutoCondField, AutoCondComparison,
  Autonote, CreateAutonoteRequest, UpdateAutonoteRequest,
  AutonoteControl, CreateAutonoteControlRequest, UpdateAutonoteControlRequest, AutonoteControlType,
  Benefit, CreateBenefitRequest, UpdateBenefitRequest, InsBenefitType, BenefitTimePeriod, BenefitQuantity, BenefitCoverageLevel, TreatmentArea,
  Branding, CreateBrandingRequest, UpdateBrandingRequest, BrandingType,
  CanadianNetwork, CreateCanadianNetworkRequest, UpdateCanadianNetworkRequest,
  Carrier, CreateCarrierRequest, UpdateCarrierRequest, NoSendElectType, TrustedEtransTypes, EclaimCobInsPaidBehavior, EraAutomationMode, EnumOrthoInsPayConsolidate, EnumPaySuiteTransTypes,
  Cdcrec, CreateCdcrecRequest, UpdateCdcrecRequest,
  CdsPermission, CreateCdsPermissionRequest, UpdateCdsPermissionRequest,
  CentralConnection, CreateCentralConnectionRequest, UpdateCentralConnectionRequest,
  Cert, CreateCertRequest, UpdateCertRequest,
  CertEmployee, CreateCertEmployeeRequest, UpdateCertEmployeeRequest,
  ChartView, CreateChartViewRequest, UpdateChartViewRequest, ChartViewProcStat, ChartViewObjs, ChartViewDates,
  Chat, CreateChatRequest, UpdateChatRequest,
  ChatMsg, CreateChatMsgRequest, UpdateChatMsgRequest,
  ChatReaction, CreateChatReactionRequest, UpdateChatReactionRequest,
  ChatUserAttach, CreateChatUserAttachRequest, UpdateChatUserAttachRequest,
  ChatUserod, CreateChatUserodRequest, UpdateChatUserodRequest, ChatUserStatus,
  ChatAttach, CreateChatAttachRequest, UpdateChatAttachRequest,
  Claim, CreateClaimRequest, UpdateClaimRequest, PlaceService, EmployRelated, ClaimSpecialProgram, ClaimMedType, ClaimCorrectionType, DateIllnessInjuryPregQualifier, DateOtherQualifier,
  ClaimAttach, CreateClaimAttachRequest, UpdateClaimAttachRequest,
  ClaimCondCodeLog, CreateClaimCondCodeLogRequest, UpdateClaimCondCodeLogRequest,
  ClaimForm, CreateClaimFormRequest, UpdateClaimFormRequest,
  ClaimFormItem, CreateClaimFormItemRequest, UpdateClaimFormItemRequest,
  ApiResponse
} from './types';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { verifyIdToken } from '../../shared/utils/auth-helper';

/**
 * Main handler for all dental-software API routes
 * Routes are determined by path and HTTP method
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Dental Software Handler - Event:', JSON.stringify(event, null, 2));

  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders({}, requestOrigin);

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  }

  // Authorization (shared auth-helper)
  const authz = event.headers?.Authorization || event.headers?.authorization || '';
  const verifyResult = await verifyIdToken(authz);
  if (!verifyResult.ok) {
    const response: ApiResponse = {
      success: false,
      error: verifyResult.message || 'Unauthorized',
    };
    return {
      statusCode: verifyResult.code || 401,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const pathParams = event.pathParameters;
    const proxy = pathParams?.proxy || '';

    // Route to appropriate handler based on path and method
    // Path format: /dental-software/{proxy+}
    // proxy will be: init-database, clinics, clinics/{id}, accounts, accounts/{id}, definitions, definitions/{id}, accountingautopay, accountingautopay/{id}, userod, userod/{id}, activeinstance, activeinstance/{id}, adjustment, adjustment/{id}, alertcategory, alertcategory/{id}, alertcategorylink, alertcategorylink/{id}, alertitem, alertitem/{id}, alertread, alertread/{id}, alertsub, alertsub/{id}, allergy, allergy/{id}, allergydef, allergydef/{id}, apikey, apikey/{id}, apisubscription, apisubscription/{id}, appointment, appointment/{id}, appointmentrule, appointmentrule/{id}, appointmenttype, appointmenttype/{id}, apptfielddef, apptfielddef/{id}, apptfield, apptfield/{id}, apptgeneralmessagesent, apptgeneralmessagesent/{id}, apptreminderrule, apptreminderrule/{id}, apptremindersent, apptremindersent/{id}, apptthankyousent, apptthankyousent/{id}, apptview, apptview/{id}, apptviewitem, apptviewitem/{id}, asapcomm, asapcomm/{id}, autocode, autocode/{id}, autocodecond, autocodecond/{id}, autocodeitem, autocodeitem/{id}, autocommexcludedate, autocommexcludedate/{id}, automation, automation/{id}, automationcondition, automationcondition/{id}, autonote, autonote/{id}, autonotecontrol, autonotecontrol/{id}, benefit, benefit/{id}, branding, branding/{id}, canadiannetwork, canadiannetwork/{id}, carrier, carrier/{id}, cdcrec, cdcrec/{id}, cdspermission, cdspermission/{id}, centralconnection, centralconnection/{id}, cert, cert/{id}, certemployee, certemployee/{id}, chartview, chartview/{id}, chat, chat/{id}, chatattach, chatattach/{id}, chatmsg, chatmsg/{id}, chatreaction, chatreaction/{id}, chatuserattach, chatuserattach/{id}, chatuserod, chatuserod/{id}, claim, claim/{id}, claimattach, claimattach/{id}, claimcondcodelog, claimcondcodelog/{id}, claimform, claimform/{id}, claimformitem, claimformitem/{id}

    // Initialize Database
    if (proxy === 'init-database' && method === 'POST') {
      return await handleInitDatabase(corsHeaders);
    }

    // Clinic routes
    if (proxy === 'clinics' && method === 'GET') {
      return await handleGetClinics(corsHeaders);
    }
    if (proxy === 'clinics' && method === 'POST') {
      return await handlePostClinic(event, corsHeaders);
    }
    if (proxy.startsWith('clinics/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetClinic(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutClinic(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteClinic(id, corsHeaders);
      }
    }

    // Account routes
    if (proxy === 'accounts' && method === 'GET') {
      return await handleGetAccounts(corsHeaders);
    }
    if (proxy === 'accounts' && method === 'POST') {
      return await handlePostAccount(event, corsHeaders);
    }
    if (proxy.startsWith('accounts/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAccount(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAccount(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAccount(id, corsHeaders);
      }
    }

    // Definition routes
    if (proxy === 'definitions' && method === 'GET') {
      return await handleGetDefinitions(event, corsHeaders);
    }
    if (proxy === 'definitions' && method === 'POST') {
      return await handlePostDefinition(event, corsHeaders);
    }
    if (proxy.startsWith('definitions/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetDefinition(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutDefinition(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteDefinition(id, corsHeaders);
      }
    }

    // AccountingAutoPay routes
    if (proxy === 'accountingautopay' && method === 'GET') {
      return await handleGetAccountingAutoPays(corsHeaders);
    }
    if (proxy === 'accountingautopay' && method === 'POST') {
      return await handlePostAccountingAutoPay(event, corsHeaders);
    }
    if (proxy.startsWith('accountingautopay/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAccountingAutoPay(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAccountingAutoPay(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAccountingAutoPay(id, corsHeaders);
      }
    }

    // Userod routes
    if (proxy === 'userod' && method === 'GET') {
      return await handleGetUserods(corsHeaders);
    }
    if (proxy === 'userod' && method === 'POST') {
      return await handlePostUserod(event, corsHeaders);
    }
    if (proxy.startsWith('userod/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetUserod(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutUserod(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteUserod(id, corsHeaders);
      }
    }

    // ActiveInstance routes
    if (proxy === 'activeinstance' && method === 'GET') {
      return await handleGetActiveInstances(corsHeaders);
    }
    if (proxy === 'activeinstance' && method === 'POST') {
      return await handlePostActiveInstance(event, corsHeaders);
    }
    if (proxy.startsWith('activeinstance/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetActiveInstance(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutActiveInstance(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteActiveInstance(id, corsHeaders);
      }
    }

    // Adjustment routes
    if (proxy === 'adjustment' && method === 'GET') {
      return await handleGetAdjustments(corsHeaders);
    }
    if (proxy === 'adjustment' && method === 'POST') {
      return await handlePostAdjustment(event, corsHeaders);
    }
    if (proxy.startsWith('adjustment/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAdjustment(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAdjustment(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAdjustment(id, corsHeaders);
      }
    }

    // AlertCategory routes
    if (proxy === 'alertcategory' && method === 'GET') {
      return await handleGetAlertCategories(corsHeaders);
    }
    if (proxy === 'alertcategory' && method === 'POST') {
      return await handlePostAlertCategory(event, corsHeaders);
    }
    if (proxy.startsWith('alertcategory/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAlertCategory(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAlertCategory(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAlertCategory(id, corsHeaders);
      }
    }

    // AlertCategoryLink routes
    if (proxy === 'alertcategorylink' && method === 'GET') {
      return await handleGetAlertCategoryLinks(corsHeaders);
    }
    if (proxy === 'alertcategorylink' && method === 'POST') {
      return await handlePostAlertCategoryLink(event, corsHeaders);
    }
    if (proxy.startsWith('alertcategorylink/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAlertCategoryLink(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAlertCategoryLink(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAlertCategoryLink(id, corsHeaders);
      }
    }

    // AlertItem routes
    if (proxy === 'alertitem' && method === 'GET') {
      return await handleGetAlertItems(corsHeaders);
    }
    if (proxy === 'alertitem' && method === 'POST') {
      return await handlePostAlertItem(event, corsHeaders);
    }
    if (proxy.startsWith('alertitem/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAlertItem(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAlertItem(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAlertItem(id, corsHeaders);
      }
    }

    // AlertRead routes
    if (proxy === 'alertread' && method === 'GET') {
      return await handleGetAlertReads(corsHeaders);
    }
    if (proxy === 'alertread' && method === 'POST') {
      return await handlePostAlertRead(event, corsHeaders);
    }
    if (proxy.startsWith('alertread/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAlertRead(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAlertRead(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAlertRead(id, corsHeaders);
      }
    }

    // AlertSub routes
    if (proxy === 'alertsub' && method === 'GET') {
      return await handleGetAlertSubs(corsHeaders);
    }
    if (proxy === 'alertsub' && method === 'POST') {
      return await handlePostAlertSub(event, corsHeaders);
    }
    if (proxy.startsWith('alertsub/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAlertSub(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAlertSub(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAlertSub(id, corsHeaders);
      }
    }

    // Allergy routes
    if (proxy === 'allergy' && method === 'GET') {
      return await handleGetAllergies(corsHeaders);
    }
    if (proxy === 'allergy' && method === 'POST') {
      return await handlePostAllergy(event, corsHeaders);
    }
    if (proxy.startsWith('allergy/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAllergy(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAllergy(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAllergy(id, corsHeaders);
      }
    }

    // AllergyDef routes
    if (proxy === 'allergydef' && method === 'GET') {
      return await handleGetAllergyDefs(corsHeaders);
    }
    if (proxy === 'allergydef' && method === 'POST') {
      return await handlePostAllergyDef(event, corsHeaders);
    }
    if (proxy.startsWith('allergydef/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAllergyDef(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAllergyDef(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAllergyDef(id, corsHeaders);
      }
    }

    // APIKey routes
    if (proxy === 'apikey' && method === 'GET') {
      return await handleGetAPIKeys(corsHeaders);
    }
    if (proxy === 'apikey' && method === 'POST') {
      return await handlePostAPIKey(event, corsHeaders);
    }
    if (proxy.startsWith('apikey/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAPIKey(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAPIKey(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAPIKey(id, corsHeaders);
      }
    }

    // ApiSubscription routes
    if (proxy === 'apisubscription' && method === 'GET') {
      return await handleGetApiSubscriptions(corsHeaders);
    }
    if (proxy === 'apisubscription' && method === 'POST') {
      return await handlePostApiSubscription(event, corsHeaders);
    }
    if (proxy.startsWith('apisubscription/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApiSubscription(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApiSubscription(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApiSubscription(id, corsHeaders);
      }
    }

    // Appointment routes
    if (proxy === 'appointment' && method === 'GET') {
      return await handleGetAppointments(corsHeaders);
    }
    if (proxy === 'appointment' && method === 'POST') {
      return await handlePostAppointment(event, corsHeaders);
    }
    if (proxy.startsWith('appointment/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAppointment(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAppointment(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAppointment(id, corsHeaders);
      }
    }

    // AppointmentRule routes
    if (proxy === 'appointmentrule' && method === 'GET') {
      return await handleGetAppointmentRules(corsHeaders);
    }
    if (proxy === 'appointmentrule' && method === 'POST') {
      return await handlePostAppointmentRule(event, corsHeaders);
    }
    if (proxy.startsWith('appointmentrule/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAppointmentRule(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAppointmentRule(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAppointmentRule(id, corsHeaders);
      }
    }

    // AppointmentType routes
    if (proxy === 'appointmenttype' && method === 'GET') {
      return await handleGetAppointmentTypes(corsHeaders);
    }
    if (proxy === 'appointmenttype' && method === 'POST') {
      return await handlePostAppointmentType(event, corsHeaders);
    }
    if (proxy.startsWith('appointmenttype/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAppointmentType(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAppointmentType(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAppointmentType(id, corsHeaders);
      }
    }

    // ApptFieldDef routes
    if (proxy === 'apptfielddef' && method === 'GET') {
      return await handleGetApptFieldDefs(corsHeaders);
    }
    if (proxy === 'apptfielddef' && method === 'POST') {
      return await handlePostApptFieldDef(event, corsHeaders);
    }
    if (proxy.startsWith('apptfielddef/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptFieldDef(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptFieldDef(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptFieldDef(id, corsHeaders);
      }
    }

    // ApptField routes
    if (proxy === 'apptfield' && method === 'GET') {
      return await handleGetApptFields(corsHeaders);
    }
    if (proxy === 'apptfield' && method === 'POST') {
      return await handlePostApptField(event, corsHeaders);
    }
    if (proxy.startsWith('apptfield/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptField(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptField(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptField(id, corsHeaders);
      }
    }

    // ApptGeneralMessageSent routes
    if (proxy === 'apptgeneralmessagesent' && method === 'GET') {
      return await handleGetApptGeneralMessageSents(corsHeaders);
    }
    if (proxy === 'apptgeneralmessagesent' && method === 'POST') {
      return await handlePostApptGeneralMessageSent(event, corsHeaders);
    }
    if (proxy.startsWith('apptgeneralmessagesent/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptGeneralMessageSent(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptGeneralMessageSent(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptGeneralMessageSent(id, corsHeaders);
      }
    }

    // ApptReminderRule routes
    if (proxy === 'apptreminderrule' && method === 'GET') {
      return await handleGetApptReminderRules(corsHeaders);
    }
    if (proxy === 'apptreminderrule' && method === 'POST') {
      return await handlePostApptReminderRule(event, corsHeaders);
    }
    if (proxy.startsWith('apptreminderrule/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptReminderRule(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptReminderRule(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptReminderRule(id, corsHeaders);
      }
    }

    // ApptReminderSent routes
    if (proxy === 'apptremindersent' && method === 'GET') {
      return await handleGetApptReminderSents(corsHeaders);
    }
    if (proxy === 'apptremindersent' && method === 'POST') {
      return await handlePostApptReminderSent(event, corsHeaders);
    }
    if (proxy.startsWith('apptremindersent/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptReminderSent(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptReminderSent(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptReminderSent(id, corsHeaders);
      }
    }

    // ApptThankYouSent routes
    if (proxy === 'apptthankyousent' && method === 'GET') {
      return await handleGetApptThankYouSents(corsHeaders);
    }
    if (proxy === 'apptthankyousent' && method === 'POST') {
      return await handlePostApptThankYouSent(event, corsHeaders);
    }
    if (proxy.startsWith('apptthankyousent/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptThankYouSent(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptThankYouSent(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptThankYouSent(id, corsHeaders);
      }
    }

    // ApptView routes
    if (proxy === 'apptview' && method === 'GET') {
      return await handleGetApptViews(corsHeaders);
    }
    if (proxy === 'apptview' && method === 'POST') {
      return await handlePostApptView(event, corsHeaders);
    }
    if (proxy.startsWith('apptview/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptView(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptView(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptView(id, corsHeaders);
      }
    }

    // ApptViewItem routes
    if (proxy === 'apptviewitem' && method === 'GET') {
      return await handleGetApptViewItems(corsHeaders);
    }
    if (proxy === 'apptviewitem' && method === 'POST') {
      return await handlePostApptViewItem(event, corsHeaders);
    }
    if (proxy.startsWith('apptviewitem/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetApptViewItem(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutApptViewItem(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteApptViewItem(id, corsHeaders);
      }
    }

    // AsapComm routes
    if (proxy === 'asapcomm' && method === 'GET') {
      return await handleGetAsapComms(corsHeaders);
    }
    if (proxy === 'asapcomm' && method === 'POST') {
      return await handlePostAsapComm(event, corsHeaders);
    }
    if (proxy.startsWith('asapcomm/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAsapComm(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAsapComm(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAsapComm(id, corsHeaders);
      }
    }

    // Autocode routes
    if (proxy === 'autocode' && method === 'GET') {
      return await handleGetAutocodes(corsHeaders);
    }
    if (proxy === 'autocode' && method === 'POST') {
      return await handlePostAutocode(event, corsHeaders);
    }
    if (proxy.startsWith('autocode/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutocode(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutocode(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutocode(id, corsHeaders);
      }
    }

    // AutocodeCond routes
    if (proxy === 'autocodecond' && method === 'GET') {
      return await handleGetAutocodeConds(corsHeaders);
    }
    if (proxy === 'autocodecond' && method === 'POST') {
      return await handlePostAutocodeCond(event, corsHeaders);
    }
    if (proxy.startsWith('autocodecond/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutocodeCond(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutocodeCond(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutocodeCond(id, corsHeaders);
      }
    }

    // AutocodeItem routes
    if (proxy === 'autocodeitem' && method === 'GET') {
      return await handleGetAutocodeItems(corsHeaders);
    }
    if (proxy === 'autocodeitem' && method === 'POST') {
      return await handlePostAutocodeItem(event, corsHeaders);
    }
    if (proxy.startsWith('autocodeitem/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutocodeItem(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutocodeItem(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutocodeItem(id, corsHeaders);
      }
    }

    // AutoCommExcludeDate routes
    if (proxy === 'autocommexcludedate' && method === 'GET') {
      return await handleGetAutoCommExcludeDates(corsHeaders);
    }
    if (proxy === 'autocommexcludedate' && method === 'POST') {
      return await handlePostAutoCommExcludeDate(event, corsHeaders);
    }
    if (proxy.startsWith('autocommexcludedate/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutoCommExcludeDate(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutoCommExcludeDate(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutoCommExcludeDate(id, corsHeaders);
      }
    }

    // Automation routes
    if (proxy === 'automation' && method === 'GET') {
      return await handleGetAutomations(corsHeaders);
    }
    if (proxy === 'automation' && method === 'POST') {
      return await handlePostAutomation(event, corsHeaders);
    }
    if (proxy.startsWith('automation/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutomation(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutomation(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutomation(id, corsHeaders);
      }
    }

    // AutomationCondition routes
    if (proxy === 'automationcondition' && method === 'GET') {
      return await handleGetAutomationConditions(corsHeaders);
    }
    if (proxy === 'automationcondition' && method === 'POST') {
      return await handlePostAutomationCondition(event, corsHeaders);
    }
    if (proxy.startsWith('automationcondition/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutomationCondition(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutomationCondition(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutomationCondition(id, corsHeaders);
      }
    }

    // Autonote routes
    if (proxy === 'autonote' && method === 'GET') {
      return await handleGetAutonotes(corsHeaders);
    }
    if (proxy === 'autonote' && method === 'POST') {
      return await handlePostAutonote(event, corsHeaders);
    }
    if (proxy.startsWith('autonote/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutonote(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutonote(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutonote(id, corsHeaders);
      }
    }

    // AutonoteControl routes
    if (proxy === 'autonotecontrol' && method === 'GET') {
      return await handleGetAutonoteControls(corsHeaders);
    }
    if (proxy === 'autonotecontrol' && method === 'POST') {
      return await handlePostAutonoteControl(event, corsHeaders);
    }
    if (proxy.startsWith('autonotecontrol/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetAutonoteControl(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutAutonoteControl(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteAutonoteControl(id, corsHeaders);
      }
    }

    // Benefit routes
    if (proxy === 'benefit' && method === 'GET') {
      return await handleGetBenefits(corsHeaders);
    }
    if (proxy === 'benefit' && method === 'POST') {
      return await handlePostBenefit(event, corsHeaders);
    }
    if (proxy.startsWith('benefit/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetBenefit(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutBenefit(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteBenefit(id, corsHeaders);
      }
    }

    // Branding routes
    if (proxy === 'branding' && method === 'GET') {
      return await handleGetBrandings(corsHeaders);
    }
    if (proxy === 'branding' && method === 'POST') {
      return await handlePostBranding(event, corsHeaders);
    }
    if (proxy.startsWith('branding/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetBranding(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutBranding(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteBranding(id, corsHeaders);
      }
    }

    // CanadianNetwork routes
    if (proxy === 'canadiannetwork' && method === 'GET') {
      return await handleGetCanadianNetworks(corsHeaders);
    }
    if (proxy === 'canadiannetwork' && method === 'POST') {
      return await handlePostCanadianNetwork(event, corsHeaders);
    }
    if (proxy.startsWith('canadiannetwork/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCanadianNetwork(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCanadianNetwork(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCanadianNetwork(id, corsHeaders);
      }
    }

    // Carrier routes
    if (proxy === 'carrier' && method === 'GET') {
      return await handleGetCarriers(corsHeaders);
    }
    if (proxy === 'carrier' && method === 'POST') {
      return await handlePostCarrier(event, corsHeaders);
    }
    if (proxy.startsWith('carrier/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCarrier(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCarrier(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCarrier(id, corsHeaders);
      }
    }

    // Cdcrec routes
    if (proxy === 'cdcrec' && method === 'GET') {
      return await handleGetCdcrecs(corsHeaders);
    }
    if (proxy === 'cdcrec' && method === 'POST') {
      return await handlePostCdcrec(event, corsHeaders);
    }
    if (proxy.startsWith('cdcrec/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCdcrec(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCdcrec(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCdcrec(id, corsHeaders);
      }
    }

    // CdsPermission routes
    if (proxy === 'cdspermission' && method === 'GET') {
      return await handleGetCdsPermissions(corsHeaders);
    }
    if (proxy === 'cdspermission' && method === 'POST') {
      return await handlePostCdsPermission(event, corsHeaders);
    }
    if (proxy.startsWith('cdspermission/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCdsPermission(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCdsPermission(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCdsPermission(id, corsHeaders);
      }
    }

    // CentralConnection routes
    if (proxy === 'centralconnection' && method === 'GET') {
      return await handleGetCentralConnections(corsHeaders);
    }
    if (proxy === 'centralconnection' && method === 'POST') {
      return await handlePostCentralConnection(event, corsHeaders);
    }
    if (proxy.startsWith('centralconnection/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCentralConnection(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCentralConnection(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCentralConnection(id, corsHeaders);
      }
    }

    // Cert routes
    if (proxy === 'cert' && method === 'GET') {
      return await handleGetCerts(corsHeaders);
    }
    if (proxy === 'cert' && method === 'POST') {
      return await handlePostCert(event, corsHeaders);
    }
    if (proxy.startsWith('cert/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCert(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCert(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCert(id, corsHeaders);
      }
    }

    // CertEmployee routes
    if (proxy === 'certemployee' && method === 'GET') {
      return await handleGetCertEmployees(corsHeaders);
    }
    if (proxy === 'certemployee' && method === 'POST') {
      return await handlePostCertEmployee(event, corsHeaders);
    }
    if (proxy.startsWith('certemployee/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetCertEmployee(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutCertEmployee(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteCertEmployee(id, corsHeaders);
      }
    }

    // ChartView routes
    if (proxy === 'chartview' && method === 'GET') {
      return await handleGetChartViews(corsHeaders);
    }
    if (proxy === 'chartview' && method === 'POST') {
      return await handlePostChartView(event, corsHeaders);
    }
    if (proxy.startsWith('chartview/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChartView(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChartView(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChartView(id, corsHeaders);
      }
    }

    // Chat routes
    if (proxy === 'chat' && method === 'GET') {
      return await handleGetChats(corsHeaders);
    }
    if (proxy === 'chat' && method === 'POST') {
      return await handlePostChat(event, corsHeaders);
    }
    if (proxy.startsWith('chat/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChat(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChat(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChat(id, corsHeaders);
      }
    }

    // ChatAttach routes
    if (proxy === 'chatattach' && method === 'GET') {
      return await handleGetChatAttaches(corsHeaders);
    }
    if (proxy === 'chatattach' && method === 'POST') {
      return await handlePostChatAttach(event, corsHeaders);
    }
    if (proxy.startsWith('chatattach/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChatAttach(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChatAttach(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChatAttach(id, corsHeaders);
      }
    }

    // ChatMsg routes
    if (proxy === 'chatmsg' && method === 'GET') {
      return await handleGetChatMsgs(corsHeaders);
    }
    if (proxy === 'chatmsg' && method === 'POST') {
      return await handlePostChatMsg(event, corsHeaders);
    }
    if (proxy.startsWith('chatmsg/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChatMsg(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChatMsg(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChatMsg(id, corsHeaders);
      }
    }

    // ChatReaction routes
    if (proxy === 'chatreaction' && method === 'GET') {
      return await handleGetChatReactions(corsHeaders);
    }
    if (proxy === 'chatreaction' && method === 'POST') {
      return await handlePostChatReaction(event, corsHeaders);
    }
    if (proxy.startsWith('chatreaction/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChatReaction(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChatReaction(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChatReaction(id, corsHeaders);
      }
    }

    // ChatUserAttach routes
    if (proxy === 'chatuserattach' && method === 'GET') {
      return await handleGetChatUserAttaches(corsHeaders);
    }
    if (proxy === 'chatuserattach' && method === 'POST') {
      return await handlePostChatUserAttach(event, corsHeaders);
    }
    if (proxy.startsWith('chatuserattach/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChatUserAttach(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChatUserAttach(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChatUserAttach(id, corsHeaders);
      }
    }

    // ChatUserod routes
    if (proxy === 'chatuserod' && method === 'GET') {
      return await handleGetChatUserods(corsHeaders);
    }
    if (proxy === 'chatuserod' && method === 'POST') {
      return await handlePostChatUserod(event, corsHeaders);
    }
    if (proxy.startsWith('chatuserod/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetChatUserod(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutChatUserod(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteChatUserod(id, corsHeaders);
      }
    }

    // Claim routes
    if (proxy === 'claim' && method === 'GET') {
      return await handleGetClaims(corsHeaders);
    }
    if (proxy === 'claim' && method === 'POST') {
      return await handlePostClaim(event, corsHeaders);
    }
    if (proxy.startsWith('claim/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetClaim(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutClaim(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteClaim(id, corsHeaders);
      }
    }

    // ClaimAttach routes
    if (proxy === 'claimattach' && method === 'GET') {
      return await handleGetClaimAttaches(corsHeaders);
    }
    if (proxy === 'claimattach' && method === 'POST') {
      return await handlePostClaimAttach(event, corsHeaders);
    }
    if (proxy.startsWith('claimattach/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetClaimAttach(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutClaimAttach(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteClaimAttach(id, corsHeaders);
      }
    }

    // ClaimCondCodeLog routes
    if (proxy === 'claimcondcodelog' && method === 'GET') {
      return await handleGetClaimCondCodeLogs(corsHeaders);
    }
    if (proxy === 'claimcondcodelog' && method === 'POST') {
      return await handlePostClaimCondCodeLog(event, corsHeaders);
    }
    if (proxy.startsWith('claimcondcodelog/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetClaimCondCodeLog(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutClaimCondCodeLog(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteClaimCondCodeLog(id, corsHeaders);
      }
    }

    // ClaimForm routes
    if (proxy === 'claimform' && method === 'GET') {
      return await handleGetClaimForms(corsHeaders);
    }
    if (proxy === 'claimform' && method === 'POST') {
      return await handlePostClaimForm(event, corsHeaders);
    }
    if (proxy.startsWith('claimform/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetClaimForm(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutClaimForm(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteClaimForm(id, corsHeaders);
      }
    }

    // ClaimFormItem routes
    if (proxy === 'claimformitem' && method === 'GET') {
      return await handleGetClaimFormItems(corsHeaders);
    }
    if (proxy === 'claimformitem' && method === 'POST') {
      return await handlePostClaimFormItem(event, corsHeaders);
    }
    if (proxy.startsWith('claimformitem/')) {
      const id = proxy.split('/')[1];
      if (method === 'GET') {
        return await handleGetClaimFormItem(id, corsHeaders);
      }
      if (method === 'PUT') {
        return await handlePutClaimFormItem(id, event, corsHeaders);
      }
      if (method === 'DELETE') {
        return await handleDeleteClaimFormItem(id, corsHeaders);
      }
    }

    // Route not found
    const response: ApiResponse = {
      success: false,
      error: 'Route not found',
      message: `No handler for ${method} ${proxy}`,
    };

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in dental software handler:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
};

// ========================================
// DATABASE INITIALIZATION
// ========================================

async function handleInitDatabase(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    console.log('Initializing clinic table...');
    await initializeClinicTable();
    console.log('Clinic table initialized successfully');

    console.log('Initializing account table...');
    await initializeAccountTable();
    console.log('Account table initialized successfully');

    console.log('Initializing definition table...');
    await initializeDefinitionTable();
    console.log('Definition table initialized successfully');

    console.log('Initializing userod table...');
    await initializeUserodTable();
    console.log('Userod table initialized successfully');

    console.log('Initializing accountingautopay table...');
    await initializeAccountingAutoPayTable();
    console.log('AccountingAutoPay table initialized successfully');

    console.log('Initializing activeinstance table...');
    await initializeActiveInstanceTable();
    console.log('ActiveInstance table initialized successfully');

    console.log('Initializing adjustment table...');
    await initializeAdjustmentTable();
    console.log('Adjustment table initialized successfully');

    console.log('Initializing alertcategory table...');
    await initializeAlertCategoryTable();
    console.log('AlertCategory table initialized successfully');

    console.log('Initializing alertcategorylink table...');
    await initializeAlertCategoryLinkTable();
    console.log('AlertCategoryLink table initialized successfully');

    console.log('Initializing alertitem table...');
    await initializeAlertItemTable();
    console.log('AlertItem table initialized successfully');

    console.log('Initializing alertread table...');
    await initializeAlertReadTable();
    console.log('AlertRead table initialized successfully');

    console.log('Initializing alertsub table...');
    await initializeAlertSubTable();
    console.log('AlertSub table initialized successfully');

    console.log('Initializing allergy table...');
    await initializeAllergyTable();
    console.log('Allergy table initialized successfully');

    console.log('Initializing allergydef table...');
    await initializeAllergyDefTable();
    console.log('AllergyDef table initialized successfully');

    console.log('Initializing apikey table...');
    await initializeAPIKeyTable();
    console.log('APIKey table initialized successfully');

    console.log('Initializing apisubscription table...');
    await initializeApiSubscriptionTable();
    console.log('ApiSubscription table initialized successfully');

    console.log('Initializing appointment table...');
    await initializeAppointmentTable();
    console.log('Appointment table initialized successfully');

    console.log('Initializing appointmentrule table...');
    await initializeAppointmentRuleTable();
    console.log('AppointmentRule table initialized successfully');

    console.log('Initializing appointmenttype table...');
    await initializeAppointmentTypeTable();
    console.log('AppointmentType table initialized successfully');

    console.log('Initializing apptfielddef table...');
    await initializeApptFieldDefTable();
    console.log('ApptFieldDef table initialized successfully');

    console.log('Initializing apptfield table...');
    await initializeApptFieldTable();
    console.log('ApptField table initialized successfully');

    console.log('Initializing apptgeneralmessagesent table...');
    await initializeApptGeneralMessageSentTable();
    console.log('ApptGeneralMessageSent table initialized successfully');

    console.log('Initializing apptreminderrule table...');
    await initializeApptReminderRuleTable();
    console.log('ApptReminderRule table initialized successfully');

    console.log('Initializing apptremindersent table...');
    await initializeApptReminderSentTable();
    console.log('ApptReminderSent table initialized successfully');

    console.log('Initializing apptthankyousent table...');
    await initializeApptThankYouSentTable();
    console.log('ApptThankYouSent table initialized successfully');

    console.log('Initializing apptview table...');
    await initializeApptViewTable();
    console.log('ApptView table initialized successfully');

    console.log('Initializing apptviewitem table...');
    await initializeApptViewItemTable();
    console.log('ApptViewItem table initialized successfully');

    console.log('Initializing asapcomm table...');
    await initializeAsapCommTable();
    console.log('AsapComm table initialized successfully');

    console.log('Initializing autocode table...');
    await initializeAutocodeTable();
    console.log('Autocode table initialized successfully');

    console.log('Initializing autocodecond table...');
    await initializeAutocodeCondTable();
    console.log('AutocodeCond table initialized successfully');

    console.log('Initializing autocodeitem table...');
    await initializeAutocodeItemTable();
    console.log('AutocodeItem table initialized successfully');

    console.log('Initializing autocommexcludedate table...');
    await initializeAutoCommExcludeDateTable();
    console.log('AutoCommExcludeDate table initialized successfully');

    console.log('Initializing automation table...');
    await initializeAutomationTable();
    console.log('Automation table initialized successfully');

    console.log('Initializing automationcondition table...');
    await initializeAutomationConditionTable();
    console.log('AutomationCondition table initialized successfully');

    console.log('Initializing autonote table...');
    await initializeAutonoteTable();
    console.log('Autonote table initialized successfully');

    console.log('Initializing autonotecontrol table...');
    await initializeAutonoteControlTable();
    console.log('AutonoteControl table initialized successfully');

    console.log('Initializing benefit table...');
    await initializeBenefitTable();
    console.log('Benefit table initialized successfully');

    console.log('Initializing branding table...');
    await initializeBrandingTable();
    console.log('Branding table initialized successfully');

    console.log('Initializing canadiannetwork table...');
    await initializeCanadianNetworkTable();
    console.log('CanadianNetwork table initialized successfully');

    console.log('Initializing carrier table...');
    await initializeCarrierTable();
    console.log('Carrier table initialized successfully');

    console.log('Initializing cdcrec table...');
    await initializeCdcrecTable();
    console.log('Cdcrec table initialized successfully');

    console.log('Initializing cdspermission table...');
    await initializeCdsPermissionTable();
    console.log('CdsPermission table initialized successfully');

    console.log('Initializing centralconnection table...');
    await initializeCentralConnectionTable();
    console.log('CentralConnection table initialized successfully');

    console.log('Initializing cert table...');
    await initializeCertTable();
    console.log('Cert table initialized successfully');

    console.log('Initializing certemployee table...');
    await initializeCertEmployeeTable();
    console.log('CertEmployee table initialized successfully');

    console.log('Initializing chartview table...');
    await initializeChartViewTable();
    console.log('ChartView table initialized successfully');

    console.log('Initializing chat table...');
    await initializeChatTable();
    console.log('Chat table initialized successfully');

    console.log('Initializing chatmsg table...');
    await initializeChatMsgTable();
    console.log('ChatMsg table initialized successfully');

    console.log('Initializing chatreaction table...');
    await initializeChatReactionTable();
    console.log('ChatReaction table initialized successfully');

    console.log('Initializing chatuserattach table...');
    await initializeChatUserAttachTable();
    console.log('ChatUserAttach table initialized successfully');

    console.log('Initializing chatuserod table...');
    await initializeChatUserodTable();
    console.log('ChatUserod table initialized successfully');

    console.log('Initializing claim table...');
    await initializeClaimTable();
    console.log('Claim table initialized successfully');

    console.log('Initializing claimattach table...');
    await initializeClaimAttachTable();
    console.log('ClaimAttach table initialized successfully');

    console.log('Initializing claimcondcodelog table...');
    await initializeClaimCondCodeLogTable();
    console.log('ClaimCondCodeLog table initialized successfully');

    console.log('Initializing claimform table...');
    await initializeClaimFormTable();
    console.log('ClaimForm table initialized successfully');

    console.log('Initializing claimformitem table...');
    await initializeClaimFormItemTable();
    console.log('ClaimFormItem table initialized successfully');

    console.log('Initializing chatattach table...');
    await initializeChatAttachTable();
    console.log('ChatAttach table initialized successfully');

    const response: ApiResponse = {
      success: true,
      message: 'Database initialized successfully. Clinic, Account, Definition, Userod, AccountingAutoPay, ActiveInstance, Adjustment, AlertCategory, AlertCategoryLink, AlertItem, AlertRead, AlertSub, Allergy, AllergyDef, APIKey, ApiSubscription, Appointment, AppointmentRule, AppointmentType, ApptFieldDef, ApptField, ApptGeneralMessageSent, ApptReminderRule, ApptReminderSent, ApptThankYouSent, ApptView, ApptViewItem, AsapComm, Autocode, AutocodeCond, AutocodeItem, AutoCommExcludeDate, Automation, AutomationCondition, Autonote, AutonoteControl, Benefit, Branding, CanadianNetwork, Carrier, Cdcrec, CdsPermission, CentralConnection, Cert, CertEmployee, ChartView, Chat, ChatMsg, ChatReaction, ChatUserAttach, ChatUserod, Claim, ClaimAttach, ClaimCondCodeLog, ClaimForm, ClaimFormItem, and ChatAttach tables created or already exist.',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error initializing database:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Failed to initialize database',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPTREMINDERSENT HANDLERS
// ========================================

function mapApptReminderSent(record: any): ApptReminderSent {
  return {
    ...record,
    ApptReminderSentNum: Number(record.ApptReminderSentNum),
    ApptNum: Number(record.ApptNum),
    TSPrior: record.TSPrior !== null ? Number(record.TSPrior) : null,
    ApptReminderRuleNum: record.ApptReminderRuleNum !== null ? Number(record.ApptReminderRuleNum) : null,
    PatNum: record.PatNum !== null ? Number(record.PatNum) : null,
    ClinicNum: record.ClinicNum !== null ? Number(record.ClinicNum) : null,
    SendStatus: record.SendStatus !== null ? Number(record.SendStatus) : null,
    MessageType: record.MessageType !== null ? Number(record.MessageType) : null,
    MessageFk: record.MessageFk !== null ? Number(record.MessageFk) : null,
  };
}

function validateApptReminderSentPayload(
  data: CreateApptReminderSentRequest | UpdateApptReminderSentRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkPos = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  need((data as any).ApptNum !== undefined, 'ApptNum is required');
  checkPos((data as any).ApptNum, 'ApptNum');
  checkPos((data as any).ApptReminderRuleNum, 'ApptReminderRuleNum', true);
  checkPos((data as any).PatNum, 'PatNum', true);
  checkPos((data as any).ClinicNum, 'ClinicNum', true);
  checkPos((data as any).TSPrior, 'TSPrior', true);
  checkPos((data as any).MessageFk, 'MessageFk', true);

  if ((data as any).SendStatus !== undefined) {
    const n = Number((data as any).SendStatus);
    if (!Number.isFinite(n)) errors.push('SendStatus must be a number');
  }
  if ((data as any).MessageType !== undefined) {
    const n = Number((data as any).MessageType);
    if (!Number.isFinite(n)) errors.push('MessageType must be a number');
  }

  return errors;
}

async function handleGetApptReminderSents(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptReminderSentNum, ApptNum, ApptDateTime, DateTimeSent, TSPrior, ApptReminderRuleNum, PatNum, ClinicNum, SendStatus, MessageType, MessageFk, DateTimeEntry, ResponseDescript, created_at, updated_at
      FROM apptremindersent
      ORDER BY ApptReminderSentNum DESC
    `;
    const results = await executeQuery<ApptReminderSent[]>(query);
    const mapped = results.map(mapApptReminderSent);
    const response: ApiResponse<ApptReminderSent[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptremindersent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptReminderSent(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptReminderSentNum, ApptNum, ApptDateTime, DateTimeSent, TSPrior, ApptReminderRuleNum, PatNum, ClinicNum, SendStatus, MessageType, MessageFk, DateTimeEntry, ResponseDescript, created_at, updated_at
      FROM apptremindersent
      WHERE ApptReminderSentNum = ?
    `;
    const results = await executeQuery<ApptReminderSent[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptReminderSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ApptReminderSent> = { success: true, data: mapApptReminderSent(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptremindersent by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptReminderSent(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptReminderSentRequest = JSON.parse(event.body);
    const errors = validateApptReminderSentPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptremindersent
      (ApptNum, ApptDateTime, DateTimeSent, TSPrior, ApptReminderRuleNum, PatNum, ClinicNum, SendStatus, MessageType, MessageFk, ResponseDescript)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ApptNum,
      data.ApptDateTime ?? null,
      data.DateTimeSent ?? null,
      data.TSPrior ?? null,
      data.ApptReminderRuleNum ?? null,
      data.PatNum ?? null,
      data.ClinicNum ?? null,
      data.SendStatus ?? null,
      data.MessageType ?? null,
      data.MessageFk ?? null,
      data.ResponseDescript ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptReminderSentNum, ApptNum, ApptDateTime, DateTimeSent, TSPrior, ApptReminderRuleNum, PatNum, ClinicNum, SendStatus, MessageType, MessageFk, DateTimeEntry, ResponseDescript, created_at, updated_at
      FROM apptremindersent
      WHERE ApptReminderSentNum = ?
    `;
    const records = await executeQuery<ApptReminderSent[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptReminderSent> = {
      success: true,
      data: mapApptReminderSent(records[0]),
      message: 'ApptReminderSent created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptremindersent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptReminderSent(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptReminderSentNum FROM apptremindersent WHERE ApptReminderSentNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptReminderSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptReminderSentRequest = JSON.parse(event.body);
    const errors = validateApptReminderSentPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ApptNum !== undefined) { updateFields.push('ApptNum = ?'); updateParams.push(data.ApptNum); }
    if (data.ApptDateTime !== undefined) { updateFields.push('ApptDateTime = ?'); updateParams.push(data.ApptDateTime ?? null); }
    if (data.DateTimeSent !== undefined) { updateFields.push('DateTimeSent = ?'); updateParams.push(data.DateTimeSent ?? null); }
    if (data.TSPrior !== undefined) { updateFields.push('TSPrior = ?'); updateParams.push(data.TSPrior ?? null); }
    if (data.ApptReminderRuleNum !== undefined) { updateFields.push('ApptReminderRuleNum = ?'); updateParams.push(data.ApptReminderRuleNum ?? null); }
    if (data.PatNum !== undefined) { updateFields.push('PatNum = ?'); updateParams.push(data.PatNum ?? null); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum ?? null); }
    if (data.SendStatus !== undefined) { updateFields.push('SendStatus = ?'); updateParams.push(data.SendStatus ?? null); }
    if (data.MessageType !== undefined) { updateFields.push('MessageType = ?'); updateParams.push(data.MessageType ?? null); }
    if (data.MessageFk !== undefined) { updateFields.push('MessageFk = ?'); updateParams.push(data.MessageFk ?? null); }
    if (data.ResponseDescript !== undefined) { updateFields.push('ResponseDescript = ?'); updateParams.push(data.ResponseDescript ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptremindersent
      SET ${updateFields.join(', ')}
      WHERE ApptReminderSentNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptReminderSentNum, ApptNum, ApptDateTime, DateTimeSent, TSPrior, ApptReminderRuleNum, PatNum, ClinicNum, SendStatus, MessageType, MessageFk, DateTimeEntry, ResponseDescript, created_at, updated_at
      FROM apptremindersent
      WHERE ApptReminderSentNum = ?
    `;
    const records = await executeQuery<ApptReminderSent[]>(selectQuery, [id]);

    const response: ApiResponse<ApptReminderSent> = {
      success: true,
      data: mapApptReminderSent(records[0]),
      message: 'ApptReminderSent updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptremindersent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptReminderSent(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptReminderSentNum FROM apptremindersent WHERE ApptReminderSentNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptReminderSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptremindersent WHERE ApptReminderSentNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptReminderSent deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptremindersent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}
// ========================================
// APISUBSCRIPTION HANDLERS
// ========================================

function mapApiSubscription(record: any): ApiSubscription {
  return {
    ...record,
    ApiSubscriptionNum: Number(record.ApiSubscriptionNum),
    PollingSeconds: Number(record.PollingSeconds),
  };
}

function validateApiSubscriptionPayload(
  data: CreateApiSubscriptionRequest | UpdateApiSubscriptionRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkPosInt = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  need(data.EndPointUrl !== undefined, 'EndPointUrl is required');
  need(data.CustomerKey !== undefined, 'CustomerKey is required');
  need(data.WatchTable !== undefined, 'WatchTable is required');
  need(data.PollingSeconds !== undefined, 'PollingSeconds is required');
  need(data.UiEventType !== undefined, 'UiEventType is required');

  if (data.EndPointUrl !== undefined && data.EndPointUrl.trim() === '') errors.push('EndPointUrl cannot be blank');
  if (data.CustomerKey !== undefined && data.CustomerKey.trim() === '') errors.push('CustomerKey cannot be blank');
  if (data.WatchTable !== undefined && data.WatchTable.trim() === '') errors.push('WatchTable cannot be blank');
  if (data.UiEventType !== undefined && data.UiEventType.trim() === '') errors.push('UiEventType cannot be blank');

  checkPosInt((data as any).PollingSeconds, 'PollingSeconds');

  return errors;
}

async function handleGetApiSubscriptions(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApiSubscriptionNum, EndPointUrl, Workstation, CustomerKey, WatchTable, PollingSeconds, UiEventType, DateTimeStart, DateTimeStop, Note, created_at, updated_at
      FROM apisubscription
      ORDER BY ApiSubscriptionNum DESC
    `;

    const results = await executeQuery<ApiSubscription[]>(query);
    const subs = results.map(mapApiSubscription);

    const response: ApiResponse<ApiSubscription[]> = { success: true, data: subs };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apisubscription:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApiSubscription(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApiSubscriptionNum, EndPointUrl, Workstation, CustomerKey, WatchTable, PollingSeconds, UiEventType, DateTimeStart, DateTimeStop, Note, created_at, updated_at
      FROM apisubscription
      WHERE ApiSubscriptionNum = ?
    `;

    const results = await executeQuery<ApiSubscription[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApiSubscription not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<ApiSubscription> = { success: true, data: mapApiSubscription(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apisubscription by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApiSubscription(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateApiSubscriptionRequest = JSON.parse(event.body);
    const errors = validateApiSubscriptionPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apisubscription
      (EndPointUrl, Workstation, CustomerKey, WatchTable, PollingSeconds, UiEventType, DateTimeStart, DateTimeStop, Note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.EndPointUrl.trim(),
      data.Workstation ?? null,
      data.CustomerKey.trim(),
      data.WatchTable.trim(),
      data.PollingSeconds,
      data.UiEventType.trim(),
      data.DateTimeStart ?? null,
      data.DateTimeStop ?? null,
      data.Note ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApiSubscriptionNum, EndPointUrl, Workstation, CustomerKey, WatchTable, PollingSeconds, UiEventType, DateTimeStart, DateTimeStop, Note, created_at, updated_at
      FROM apisubscription
      WHERE ApiSubscriptionNum = ?
    `;
    const records = await executeQuery<ApiSubscription[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApiSubscription> = {
      success: true,
      data: mapApiSubscription(records[0]),
      message: 'ApiSubscription created successfully',
    };

    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apisubscription:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApiSubscription(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApiSubscriptionNum FROM apisubscription WHERE ApiSubscriptionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApiSubscription not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApiSubscriptionRequest = JSON.parse(event.body);
    const errors = validateApiSubscriptionPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.EndPointUrl !== undefined) { updateFields.push('EndPointUrl = ?'); updateParams.push(data.EndPointUrl.trim()); }
    if (data.Workstation !== undefined) { updateFields.push('Workstation = ?'); updateParams.push(data.Workstation ?? null); }
    if (data.CustomerKey !== undefined) { updateFields.push('CustomerKey = ?'); updateParams.push(data.CustomerKey.trim()); }
    if (data.WatchTable !== undefined) { updateFields.push('WatchTable = ?'); updateParams.push(data.WatchTable.trim()); }
    if (data.PollingSeconds !== undefined) { updateFields.push('PollingSeconds = ?'); updateParams.push(data.PollingSeconds); }
    if (data.UiEventType !== undefined) { updateFields.push('UiEventType = ?'); updateParams.push(data.UiEventType.trim()); }
    if (data.DateTimeStart !== undefined) { updateFields.push('DateTimeStart = ?'); updateParams.push(data.DateTimeStart ?? null); }
    if (data.DateTimeStop !== undefined) { updateFields.push('DateTimeStop = ?'); updateParams.push(data.DateTimeStop ?? null); }
    if (data.Note !== undefined) { updateFields.push('Note = ?'); updateParams.push(data.Note ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apisubscription
      SET ${updateFields.join(', ')}
      WHERE ApiSubscriptionNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApiSubscriptionNum, EndPointUrl, Workstation, CustomerKey, WatchTable, PollingSeconds, UiEventType, DateTimeStart, DateTimeStop, Note, created_at, updated_at
      FROM apisubscription
      WHERE ApiSubscriptionNum = ?
    `;
    const records = await executeQuery<ApiSubscription[]>(selectQuery, [id]);

    const response: ApiResponse<ApiSubscription> = {
      success: true,
      data: mapApiSubscription(records[0]),
      message: 'ApiSubscription updated successfully',
    };

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apisubscription:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApiSubscription(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApiSubscriptionNum FROM apisubscription WHERE ApiSubscriptionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApiSubscription not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apisubscription WHERE ApiSubscriptionNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApiSubscription deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apisubscription:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CLINIC HANDLERS
// ========================================

async function handleGetClinics(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClinicNum, Description, Address, Address2, City, State, Zip, Phone, BankNumber
      FROM clinic
      ORDER BY Description ASC
    `;
    
    const results = await executeQuery<Clinic[]>(query);

    const response: ApiResponse<Clinic[]> = {
      success: true,
      data: results,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET clinics:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPTTHANKYOUSENT HANDLERS
// ========================================

function mapApptThankYouSent(record: any): ApptThankYouSent {
  return {
    ...record,
    ApptThankYouSentNum: Number(record.ApptThankYouSentNum),
    ApptNum: Number(record.ApptNum),
    TSPrior: record.TSPrior !== null ? Number(record.TSPrior) : null,
    ApptReminderRuleNum: record.ApptReminderRuleNum !== null ? Number(record.ApptReminderRuleNum) : null,
    ClinicNum: record.ClinicNum !== null ? Number(record.ClinicNum) : null,
    PatNum: record.PatNum !== null ? Number(record.PatNum) : null,
    SendStatus: record.SendStatus !== null ? Number(record.SendStatus) : null,
    MessageType: record.MessageType !== null ? Number(record.MessageType) : null,
    MessageFk: record.MessageFk !== null ? Number(record.MessageFk) : null,
  };
}

function validateApptThankYouSentPayload(
  data: CreateApptThankYouSentRequest | UpdateApptThankYouSentRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkPos = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  need((data as any).ApptNum !== undefined, 'ApptNum is required');
  checkPos((data as any).ApptNum, 'ApptNum');
  checkPos((data as any).ApptReminderRuleNum, 'ApptReminderRuleNum', true);
  checkPos((data as any).PatNum, 'PatNum', true);
  checkPos((data as any).ClinicNum, 'ClinicNum', true);
  checkPos((data as any).TSPrior, 'TSPrior', true);
  checkPos((data as any).MessageFk, 'MessageFk', true);

  if ((data as any).SendStatus !== undefined) {
    const n = Number((data as any).SendStatus);
    if (!Number.isFinite(n)) errors.push('SendStatus must be a number');
  }
  if ((data as any).MessageType !== undefined) {
    const n = Number((data as any).MessageType);
    if (!Number.isFinite(n)) errors.push('MessageType must be a number');
  }

  return errors;
}

async function handleGetApptThankYouSents(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptThankYouSentNum, ApptNum, ApptDateTime, ApptSecDateTEntry, TSPrior, ApptReminderRuleNum, ClinicNum, PatNum,
             ResponseDescript, DateTimeThankYouTransmit, ShortGUID, SendStatus, MessageType, MessageFk, DateTimeEntry, DateTimeSent, created_at, updated_at
      FROM apptthankyousent
      ORDER BY ApptThankYouSentNum DESC
    `;
    const results = await executeQuery<ApptThankYouSent[]>(query);
    const mapped = results.map(mapApptThankYouSent);
    const response: ApiResponse<ApptThankYouSent[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptthankyousent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// APPTVIEW HANDLERS
// ========================================

function mapApptView(record: any): ApptView {
  return {
    ...record,
    ApptViewNum: Number(record.ApptViewNum),
    ItemOrder: Number(record.ItemOrder),
    RowsPerIncr: Number(record.RowsPerIncr),
    OnlyScheduledProvs: Boolean(record.OnlyScheduledProvs),
    StackBehavUR: record.StackBehavUR !== null ? Number(record.StackBehavUR) as ApptViewStackBehavior : undefined,
    StackBehavLR: record.StackBehavLR !== null ? Number(record.StackBehavLR) as ApptViewStackBehavior : undefined,
    ClinicNum: record.ClinicNum !== null ? Number(record.ClinicNum) : undefined,
    IsScrollStartDynamic: Boolean(record.IsScrollStartDynamic),
    IsApptBubblesDisabled: Boolean(record.IsApptBubblesDisabled),
    WidthOpMinimum: record.WidthOpMinimum !== null ? Number(record.WidthOpMinimum) : undefined,
    WaitingRmName: record.WaitingRmName !== null ? Number(record.WaitingRmName) as WaitingRmName : undefined,
    OnlyScheduledProvDays: Boolean(record.OnlyScheduledProvDays),
    ShowMirroredAppts: Boolean(record.ShowMirroredAppts),
  };
}

function validateApptViewPayload(
  data: CreateApptViewRequest | UpdateApptViewRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need(data.Description !== undefined, 'Description is required');
  need((data as any).ItemOrder !== undefined, 'ItemOrder is required');
  need((data as any).RowsPerIncr !== undefined, 'RowsPerIncr is required');

  if (data.Description !== undefined && data.Description.trim() === '') errors.push('Description cannot be blank');
  checkNum((data as any).ItemOrder, 'ItemOrder');
  checkNum((data as any).RowsPerIncr, 'RowsPerIncr');
  checkNum((data as any).WidthOpMinimum, 'WidthOpMinimum', true);
  checkNum((data as any).ClinicNum, 'ClinicNum', true);

  if ((data as any).StackBehavUR !== undefined) {
    const n = Number((data as any).StackBehavUR);
    if (n < ApptViewStackBehavior.Vertical || n > ApptViewStackBehavior.Horizontal) {
      errors.push('StackBehavUR must be 0 or 1');
    }
  }
  if ((data as any).StackBehavLR !== undefined) {
    const n = Number((data as any).StackBehavLR);
    if (n < ApptViewStackBehavior.Vertical || n > ApptViewStackBehavior.Horizontal) {
      errors.push('StackBehavLR must be 0 or 1');
    }
  }
  if ((data as any).WaitingRmName !== undefined) {
    const n = Number((data as any).WaitingRmName);
    if (n < WaitingRmName.LastFirst || n > WaitingRmName.First) {
      errors.push('WaitingRmName must be 0,1,2');
    }
  }

  return errors;
}

async function handleGetApptViews(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptViewNum, Description, ItemOrder, RowsPerIncr, OnlyScheduledProvs, OnlySchedBeforeTime, OnlySchedAfterTime,
             StackBehavUR, StackBehavLR, ClinicNum, ApptTimeScrollStart, IsScrollStartDynamic, IsApptBubblesDisabled,
             WidthOpMinimum, WaitingRmName, OnlyScheduledProvDays, ShowMirroredAppts, created_at, updated_at
      FROM apptview
      ORDER BY ClinicNum ASC, ItemOrder ASC, ApptViewNum ASC
    `;
    const results = await executeQuery<ApptView[]>(query);
    const mapped = results.map(mapApptView);
    const response: ApiResponse<ApptView[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptView(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptViewNum, Description, ItemOrder, RowsPerIncr, OnlyScheduledProvs, OnlySchedBeforeTime, OnlySchedAfterTime,
             StackBehavUR, StackBehavLR, ClinicNum, ApptTimeScrollStart, IsScrollStartDynamic, IsApptBubblesDisabled,
             WidthOpMinimum, WaitingRmName, OnlyScheduledProvDays, ShowMirroredAppts, created_at, updated_at
      FROM apptview
      WHERE ApptViewNum = ?
    `;
    const results = await executeQuery<ApptView[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptView not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ApptView> = { success: true, data: mapApptView(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptview by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptView(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptViewRequest = JSON.parse(event.body);
    const errors = validateApptViewPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptview
      (Description, ItemOrder, RowsPerIncr, OnlyScheduledProvs, OnlySchedBeforeTime, OnlySchedAfterTime, StackBehavUR, StackBehavLR, ClinicNum,
       ApptTimeScrollStart, IsScrollStartDynamic, IsApptBubblesDisabled, WidthOpMinimum, WaitingRmName, OnlyScheduledProvDays, ShowMirroredAppts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.Description.trim(),
      data.ItemOrder,
      data.RowsPerIncr,
      data.OnlyScheduledProvs ? 1 : 0,
      data.OnlySchedBeforeTime ?? null,
      data.OnlySchedAfterTime ?? null,
      data.StackBehavUR ?? ApptViewStackBehavior.Vertical,
      data.StackBehavLR ?? ApptViewStackBehavior.Vertical,
      data.ClinicNum ?? 0,
      data.ApptTimeScrollStart ?? null,
      data.IsScrollStartDynamic ? 1 : 0,
      data.IsApptBubblesDisabled ? 1 : 0,
      data.WidthOpMinimum ?? 0,
      data.WaitingRmName ?? WaitingRmName.LastFirst,
      data.OnlyScheduledProvDays ? 1 : 0,
      data.ShowMirroredAppts ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptViewNum, Description, ItemOrder, RowsPerIncr, OnlyScheduledProvs, OnlySchedBeforeTime, OnlySchedAfterTime,
             StackBehavUR, StackBehavLR, ClinicNum, ApptTimeScrollStart, IsScrollStartDynamic, IsApptBubblesDisabled,
             WidthOpMinimum, WaitingRmName, OnlyScheduledProvDays, ShowMirroredAppts, created_at, updated_at
      FROM apptview
      WHERE ApptViewNum = ?
    `;
    const records = await executeQuery<ApptView[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptView> = {
      success: true,
      data: mapApptView(records[0]),
      message: 'ApptView created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptView(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptViewNum FROM apptview WHERE ApptViewNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptView not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptViewRequest = JSON.parse(event.body);
    const errors = validateApptViewPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.ItemOrder !== undefined) { updateFields.push('ItemOrder = ?'); updateParams.push(data.ItemOrder); }
    if (data.RowsPerIncr !== undefined) { updateFields.push('RowsPerIncr = ?'); updateParams.push(data.RowsPerIncr); }
    if (data.OnlyScheduledProvs !== undefined) { updateFields.push('OnlyScheduledProvs = ?'); updateParams.push(data.OnlyScheduledProvs ? 1 : 0); }
    if (data.OnlySchedBeforeTime !== undefined) { updateFields.push('OnlySchedBeforeTime = ?'); updateParams.push(data.OnlySchedBeforeTime ?? null); }
    if (data.OnlySchedAfterTime !== undefined) { updateFields.push('OnlySchedAfterTime = ?'); updateParams.push(data.OnlySchedAfterTime ?? null); }
    if (data.StackBehavUR !== undefined) { updateFields.push('StackBehavUR = ?'); updateParams.push(data.StackBehavUR); }
    if (data.StackBehavLR !== undefined) { updateFields.push('StackBehavLR = ?'); updateParams.push(data.StackBehavLR); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum ?? 0); }
    if (data.ApptTimeScrollStart !== undefined) { updateFields.push('ApptTimeScrollStart = ?'); updateParams.push(data.ApptTimeScrollStart ?? null); }
    if (data.IsScrollStartDynamic !== undefined) { updateFields.push('IsScrollStartDynamic = ?'); updateParams.push(data.IsScrollStartDynamic ? 1 : 0); }
    if (data.IsApptBubblesDisabled !== undefined) { updateFields.push('IsApptBubblesDisabled = ?'); updateParams.push(data.IsApptBubblesDisabled ? 1 : 0); }
    if (data.WidthOpMinimum !== undefined) { updateFields.push('WidthOpMinimum = ?'); updateParams.push(data.WidthOpMinimum ?? 0); }
    if (data.WaitingRmName !== undefined) { updateFields.push('WaitingRmName = ?'); updateParams.push(data.WaitingRmName ?? WaitingRmName.LastFirst); }
    if (data.OnlyScheduledProvDays !== undefined) { updateFields.push('OnlyScheduledProvDays = ?'); updateParams.push(data.OnlyScheduledProvDays ? 1 : 0); }
    if (data.ShowMirroredAppts !== undefined) { updateFields.push('ShowMirroredAppts = ?'); updateParams.push(data.ShowMirroredAppts ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptview
      SET ${updateFields.join(', ')}
      WHERE ApptViewNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptViewNum, Description, ItemOrder, RowsPerIncr, OnlyScheduledProvs, OnlySchedBeforeTime, OnlySchedAfterTime,
             StackBehavUR, StackBehavLR, ClinicNum, ApptTimeScrollStart, IsScrollStartDynamic, IsApptBubblesDisabled,
             WidthOpMinimum, WaitingRmName, OnlyScheduledProvDays, ShowMirroredAppts, created_at, updated_at
      FROM apptview
      WHERE ApptViewNum = ?
    `;
    const records = await executeQuery<ApptView[]>(selectQuery, [id]);

    const response: ApiResponse<ApptView> = {
      success: true,
      data: mapApptView(records[0]),
      message: 'ApptView updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptView(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptViewNum FROM apptview WHERE ApptViewNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptView not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptview WHERE ApptViewNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptView deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// APPTVIEWITEM HANDLERS
// ========================================

function mapApptViewItem(record: any): ApptViewItem {
  return {
    ...record,
    ApptViewItemNum: Number(record.ApptViewItemNum),
    ApptViewNum: Number(record.ApptViewNum),
    OpNum: record.OpNum !== null ? Number(record.OpNum) : undefined,
    ProvNum: record.ProvNum !== null ? Number(record.ProvNum) : undefined,
    ElementOrder: record.ElementOrder !== null ? Number(record.ElementOrder) : undefined,
    ElementColor: record.ElementColor !== null ? Number(record.ElementColor) : undefined,
    ElementAlignment: record.ElementAlignment !== null ? Number(record.ElementAlignment) as ApptViewAlignment : undefined,
    ApptFieldDefNum: record.ApptFieldDefNum !== null ? Number(record.ApptFieldDefNum) : undefined,
    PatFieldDefNum: record.PatFieldDefNum !== null ? Number(record.PatFieldDefNum) : undefined,
    IsMobile: Boolean(record.IsMobile),
  };
}

function validateApptViewItemPayload(
  data: CreateApptViewItemRequest | UpdateApptViewItemRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ApptViewNum !== undefined, 'ApptViewNum is required');
  checkNum((data as any).ApptViewNum, 'ApptViewNum');
  checkNum((data as any).OpNum, 'OpNum', true);
  checkNum((data as any).ProvNum, 'ProvNum', true);
  checkNum((data as any).ElementOrder, 'ElementOrder', true);
  checkNum((data as any).ElementColor, 'ElementColor', true);
  checkNum((data as any).ApptFieldDefNum, 'ApptFieldDefNum', true);
  checkNum((data as any).PatFieldDefNum, 'PatFieldDefNum', true);

  if ((data as any).ElementAlignment !== undefined) {
    const n = Number((data as any).ElementAlignment);
    if (n < ApptViewAlignment.Main || n > ApptViewAlignment.LR) {
      errors.push('ElementAlignment must be 0,1,2');
    }
  }
  if ((data as any).ElementDesc !== undefined && (data as any).ElementDesc.trim() === '') {
    errors.push('ElementDesc cannot be blank');
  }

  return errors;
}

async function handleGetApptViewItems(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptViewItemNum, ApptViewNum, OpNum, ProvNum, ElementDesc, ElementOrder, ElementColor, ElementAlignment, ApptFieldDefNum, PatFieldDefNum, IsMobile, created_at, updated_at
      FROM apptviewitem
      ORDER BY ApptViewNum ASC, ApptViewItemNum ASC
    `;
    const results = await executeQuery<ApptViewItem[]>(query);
    const mapped = results.map(mapApptViewItem);
    const response: ApiResponse<ApptViewItem[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptviewitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptViewItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptViewItemNum, ApptViewNum, OpNum, ProvNum, ElementDesc, ElementOrder, ElementColor, ElementAlignment, ApptFieldDefNum, PatFieldDefNum, IsMobile, created_at, updated_at
      FROM apptviewitem
      WHERE ApptViewItemNum = ?
    `;
    const results = await executeQuery<ApptViewItem[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptViewItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ApptViewItem> = { success: true, data: mapApptViewItem(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptviewitem by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptViewItem(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptViewItemRequest = JSON.parse(event.body);
    const errors = validateApptViewItemPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptviewitem
      (ApptViewNum, OpNum, ProvNum, ElementDesc, ElementOrder, ElementColor, ElementAlignment, ApptFieldDefNum, PatFieldDefNum, IsMobile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ApptViewNum,
      data.OpNum ?? 0,
      data.ProvNum ?? 0,
      data.ElementDesc ?? null,
      data.ElementOrder ?? 0,
      data.ElementColor ?? null,
      data.ElementAlignment ?? ApptViewAlignment.Main,
      data.ApptFieldDefNum ?? 0,
      data.PatFieldDefNum ?? 0,
      data.IsMobile ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptViewItemNum, ApptViewNum, OpNum, ProvNum, ElementDesc, ElementOrder, ElementColor, ElementAlignment, ApptFieldDefNum, PatFieldDefNum, IsMobile, created_at, updated_at
      FROM apptviewitem
      WHERE ApptViewItemNum = ?
    `;
    const records = await executeQuery<ApptViewItem[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptViewItem> = {
      success: true,
      data: mapApptViewItem(records[0]),
      message: 'ApptViewItem created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptviewitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptViewItem(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptViewItemNum FROM apptviewitem WHERE ApptViewItemNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptViewItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptViewItemRequest = JSON.parse(event.body);
    const errors = validateApptViewItemPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ApptViewNum !== undefined) { updateFields.push('ApptViewNum = ?'); updateParams.push(data.ApptViewNum); }
    if (data.OpNum !== undefined) { updateFields.push('OpNum = ?'); updateParams.push(data.OpNum ?? 0); }
    if (data.ProvNum !== undefined) { updateFields.push('ProvNum = ?'); updateParams.push(data.ProvNum ?? 0); }
    if (data.ElementDesc !== undefined) { updateFields.push('ElementDesc = ?'); updateParams.push(data.ElementDesc ?? null); }
    if (data.ElementOrder !== undefined) { updateFields.push('ElementOrder = ?'); updateParams.push(data.ElementOrder ?? 0); }
    if (data.ElementColor !== undefined) { updateFields.push('ElementColor = ?'); updateParams.push(data.ElementColor ?? null); }
    if (data.ElementAlignment !== undefined) { updateFields.push('ElementAlignment = ?'); updateParams.push(data.ElementAlignment ?? ApptViewAlignment.Main); }
    if (data.ApptFieldDefNum !== undefined) { updateFields.push('ApptFieldDefNum = ?'); updateParams.push(data.ApptFieldDefNum ?? 0); }
    if (data.PatFieldDefNum !== undefined) { updateFields.push('PatFieldDefNum = ?'); updateParams.push(data.PatFieldDefNum ?? 0); }
    if (data.IsMobile !== undefined) { updateFields.push('IsMobile = ?'); updateParams.push(data.IsMobile ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptviewitem
      SET ${updateFields.join(', ')}
      WHERE ApptViewItemNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptViewItemNum, ApptViewNum, OpNum, ProvNum, ElementDesc, ElementOrder, ElementColor, ElementAlignment, ApptFieldDefNum, PatFieldDefNum, IsMobile, created_at, updated_at
      FROM apptviewitem
      WHERE ApptViewItemNum = ?
    `;
    const records = await executeQuery<ApptViewItem[]>(selectQuery, [id]);

    const response: ApiResponse<ApptViewItem> = {
      success: true,
      data: mapApptViewItem(records[0]),
      message: 'ApptViewItem updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptviewitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptViewItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptViewItemNum FROM apptviewitem WHERE ApptViewItemNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptViewItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptviewitem WHERE ApptViewItemNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptViewItem deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptviewitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// ASAPCOMM HANDLERS
// ========================================

function mapAsapComm(record: any): AsapComm {
  return {
    ...record,
    AsapCommNum: Number(record.AsapCommNum),
    FKey: Number(record.FKey),
    FKeyType: Number(record.FKeyType) as AsapCommFKeyType,
    ScheduleNum: record.ScheduleNum !== null ? Number(record.ScheduleNum) : undefined,
    PatNum: Number(record.PatNum),
    ClinicNum: Number(record.ClinicNum),
    SmsSendStatus: record.SmsSendStatus !== null ? Number(record.SmsSendStatus) as AutoCommStatus : undefined,
    EmailSendStatus: record.EmailSendStatus !== null ? Number(record.EmailSendStatus) as AutoCommStatus : undefined,
    EmailMessageNum: record.EmailMessageNum !== null ? Number(record.EmailMessageNum) : undefined,
    ResponseStatus: record.ResponseStatus !== null ? Number(record.ResponseStatus) as AsapRSVPStatus : undefined,
    DateTimeOrig: record.DateTimeOrig ?? undefined,
    EmailTemplateType: record.EmailTemplateType !== null ? Number(record.EmailTemplateType) as EmailType : undefined,
    UserNum: record.UserNum !== null ? Number(record.UserNum) : undefined,
  };
}

function validateAsapCommPayload(
  data: CreateAsapCommRequest | UpdateAsapCommRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).FKey !== undefined, 'FKey is required');
  need((data as any).FKeyType !== undefined, 'FKeyType is required');
  need((data as any).PatNum !== undefined, 'PatNum is required');
  need((data as any).ClinicNum !== undefined, 'ClinicNum is required');

  checkNum((data as any).FKey, 'FKey');
  checkNum((data as any).FKeyType, 'FKeyType');
  checkNum((data as any).ScheduleNum, 'ScheduleNum', true);
  checkNum((data as any).PatNum, 'PatNum');
  checkNum((data as any).ClinicNum, 'ClinicNum');
  checkNum((data as any).SmsSendStatus, 'SmsSendStatus', true);
  checkNum((data as any).EmailSendStatus, 'EmailSendStatus', true);
  checkNum((data as any).EmailMessageNum, 'EmailMessageNum', true);
  checkNum((data as any).ResponseStatus, 'ResponseStatus', true);
  checkNum((data as any).UserNum, 'UserNum', true);

  if ((data as any).FKeyType !== undefined) {
    const n = Number((data as any).FKeyType);
    if (n < AsapCommFKeyType.None || n > AsapCommFKeyType.Broken) {
      errors.push('FKeyType must be between 0 and 5');
    }
  }
  const checkAutoCommStatus = (val: any, name: string) => {
    if (val === undefined || val === null) return;
    const n = Number(val);
    if (n < AutoCommStatus.Undefined || n > AutoCommStatus.SentAwaitingReceipt) {
      errors.push(`${name} must be between 0 and 5`);
    }
  };
  checkAutoCommStatus((data as any).SmsSendStatus, 'SmsSendStatus');
  checkAutoCommStatus((data as any).EmailSendStatus, 'EmailSendStatus');

  if ((data as any).ResponseStatus !== undefined && (data as any).ResponseStatus !== null) {
    const n = Number((data as any).ResponseStatus);
    if (n < AsapRSVPStatus.UnableToSend || n > AsapRSVPStatus.DeclinedStopComm) {
      errors.push('ResponseStatus must be between 0 and 11');
    }
  }
  if ((data as any).EmailTemplateType !== undefined && (data as any).EmailTemplateType !== null) {
    const n = Number((data as any).EmailTemplateType);
    if (n < EmailType.Regular || n > EmailType.RawHtml) {
      errors.push('EmailTemplateType must be 0,1,2');
    }
  }
  if ((data as any).ShortGUID !== undefined && (data as any).ShortGUID.trim() === '') {
    errors.push('ShortGUID cannot be blank');
  }
  if ((data as any).TemplateEmailSubj !== undefined && (data as any).TemplateEmailSubj.trim() === '') {
    errors.push('TemplateEmailSubj cannot be blank');
  }

  return errors;
}

async function handleGetAsapComms(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AsapCommNum, FKey, FKeyType, ScheduleNum, PatNum, ClinicNum, ShortGUID, DateTimeEntry, DateTimeExpire, DateTimeSmsScheduled,
             SmsSendStatus, EmailSendStatus, DateTimeSmsSent, DateTimeEmailSent, EmailMessageNum, ResponseStatus, DateTimeOrig,
             TemplateText, TemplateEmail, TemplateEmailSubj, Note, GuidMessageToMobile, EmailTemplateType, UserNum, created_at, updated_at
      FROM asapcomm
      ORDER BY AsapCommNum DESC
    `;
    const results = await executeQuery<AsapComm[]>(query);
    const mapped = results.map(mapAsapComm);
    const response: ApiResponse<AsapComm[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET asapcomm:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAsapComm(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AsapCommNum, FKey, FKeyType, ScheduleNum, PatNum, ClinicNum, ShortGUID, DateTimeEntry, DateTimeExpire, DateTimeSmsScheduled,
             SmsSendStatus, EmailSendStatus, DateTimeSmsSent, DateTimeEmailSent, EmailMessageNum, ResponseStatus, DateTimeOrig,
             TemplateText, TemplateEmail, TemplateEmailSubj, Note, GuidMessageToMobile, EmailTemplateType, UserNum, created_at, updated_at
      FROM asapcomm
      WHERE AsapCommNum = ?
    `;
    const results = await executeQuery<AsapComm[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AsapComm not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<AsapComm> = { success: true, data: mapAsapComm(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET asapcomm by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAsapComm(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAsapCommRequest = JSON.parse(event.body);
    const errors = validateAsapCommPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO asapcomm
      (FKey, FKeyType, ScheduleNum, PatNum, ClinicNum, ShortGUID, DateTimeEntry, DateTimeExpire, DateTimeSmsScheduled,
       SmsSendStatus, EmailSendStatus, DateTimeSmsSent, DateTimeEmailSent, EmailMessageNum, ResponseStatus, DateTimeOrig,
       TemplateText, TemplateEmail, TemplateEmailSubj, Note, GuidMessageToMobile, EmailTemplateType, UserNum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.FKey,
      data.FKeyType,
      data.ScheduleNum ?? null,
      data.PatNum,
      data.ClinicNum,
      data.ShortGUID ?? null,
      data.DateTimeEntry ?? null,
      data.DateTimeExpire ?? null,
      data.DateTimeSmsScheduled ?? null,
      data.SmsSendStatus ?? null,
      data.EmailSendStatus ?? null,
      data.DateTimeSmsSent ?? null,
      data.DateTimeEmailSent ?? null,
      data.EmailMessageNum ?? null,
      data.ResponseStatus ?? null,
      data.DateTimeOrig ?? null,
      data.TemplateText ?? null,
      data.TemplateEmail ?? null,
      data.TemplateEmailSubj ?? null,
      data.Note ?? null,
      data.GuidMessageToMobile ?? null,
      data.EmailTemplateType ?? null,
      data.UserNum ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AsapCommNum, FKey, FKeyType, ScheduleNum, PatNum, ClinicNum, ShortGUID, DateTimeEntry, DateTimeExpire, DateTimeSmsScheduled,
             SmsSendStatus, EmailSendStatus, DateTimeSmsSent, DateTimeEmailSent, EmailMessageNum, ResponseStatus, DateTimeOrig,
             TemplateText, TemplateEmail, TemplateEmailSubj, Note, GuidMessageToMobile, EmailTemplateType, UserNum, created_at, updated_at
      FROM asapcomm
      WHERE AsapCommNum = ?
    `;
    const records = await executeQuery<AsapComm[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AsapComm> = {
      success: true,
      data: mapAsapComm(records[0]),
      message: 'AsapComm created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST asapcomm:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAsapComm(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AsapCommNum FROM asapcomm WHERE AsapCommNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AsapComm not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAsapCommRequest = JSON.parse(event.body);
    const errors = validateAsapCommPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.FKey !== undefined) { updateFields.push('FKey = ?'); updateParams.push(data.FKey); }
    if (data.FKeyType !== undefined) { updateFields.push('FKeyType = ?'); updateParams.push(data.FKeyType); }
    if (data.ScheduleNum !== undefined) { updateFields.push('ScheduleNum = ?'); updateParams.push(data.ScheduleNum ?? null); }
    if (data.PatNum !== undefined) { updateFields.push('PatNum = ?'); updateParams.push(data.PatNum); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum); }
    if (data.ShortGUID !== undefined) { updateFields.push('ShortGUID = ?'); updateParams.push(data.ShortGUID ?? null); }
    if (data.DateTimeEntry !== undefined) { updateFields.push('DateTimeEntry = ?'); updateParams.push(data.DateTimeEntry ?? null); }
    if (data.DateTimeExpire !== undefined) { updateFields.push('DateTimeExpire = ?'); updateParams.push(data.DateTimeExpire ?? null); }
    if (data.DateTimeSmsScheduled !== undefined) { updateFields.push('DateTimeSmsScheduled = ?'); updateParams.push(data.DateTimeSmsScheduled ?? null); }
    if (data.SmsSendStatus !== undefined) { updateFields.push('SmsSendStatus = ?'); updateParams.push(data.SmsSendStatus ?? null); }
    if (data.EmailSendStatus !== undefined) { updateFields.push('EmailSendStatus = ?'); updateParams.push(data.EmailSendStatus ?? null); }
    if (data.DateTimeSmsSent !== undefined) { updateFields.push('DateTimeSmsSent = ?'); updateParams.push(data.DateTimeSmsSent ?? null); }
    if (data.DateTimeEmailSent !== undefined) { updateFields.push('DateTimeEmailSent = ?'); updateParams.push(data.DateTimeEmailSent ?? null); }
    if (data.EmailMessageNum !== undefined) { updateFields.push('EmailMessageNum = ?'); updateParams.push(data.EmailMessageNum ?? null); }
    if (data.ResponseStatus !== undefined) { updateFields.push('ResponseStatus = ?'); updateParams.push(data.ResponseStatus ?? null); }
    if (data.DateTimeOrig !== undefined) { updateFields.push('DateTimeOrig = ?'); updateParams.push(data.DateTimeOrig ?? null); }
    if (data.TemplateText !== undefined) { updateFields.push('TemplateText = ?'); updateParams.push(data.TemplateText ?? null); }
    if (data.TemplateEmail !== undefined) { updateFields.push('TemplateEmail = ?'); updateParams.push(data.TemplateEmail ?? null); }
    if (data.TemplateEmailSubj !== undefined) { updateFields.push('TemplateEmailSubj = ?'); updateParams.push(data.TemplateEmailSubj ?? null); }
    if (data.Note !== undefined) { updateFields.push('Note = ?'); updateParams.push(data.Note ?? null); }
    if (data.GuidMessageToMobile !== undefined) { updateFields.push('GuidMessageToMobile = ?'); updateParams.push(data.GuidMessageToMobile ?? null); }
    if (data.EmailTemplateType !== undefined) { updateFields.push('EmailTemplateType = ?'); updateParams.push(data.EmailTemplateType ?? null); }
    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE asapcomm
      SET ${updateFields.join(', ')}
      WHERE AsapCommNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AsapCommNum, FKey, FKeyType, ScheduleNum, PatNum, ClinicNum, ShortGUID, DateTimeEntry, DateTimeExpire, DateTimeSmsScheduled,
             SmsSendStatus, EmailSendStatus, DateTimeSmsSent, DateTimeEmailSent, EmailMessageNum, ResponseStatus, DateTimeOrig,
             TemplateText, TemplateEmail, TemplateEmailSubj, Note, GuidMessageToMobile, EmailTemplateType, UserNum, created_at, updated_at
      FROM asapcomm
      WHERE AsapCommNum = ?
    `;
    const records = await executeQuery<AsapComm[]>(selectQuery, [id]);

    const response: ApiResponse<AsapComm> = {
      success: true,
      data: mapAsapComm(records[0]),
      message: 'AsapComm updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT asapcomm:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAsapComm(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AsapCommNum FROM asapcomm WHERE AsapCommNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AsapComm not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM asapcomm WHERE AsapCommNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AsapComm deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE asapcomm:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTOCODE HANDLERS
// ========================================

function mapAutocode(record: any): Autocode {
  return {
    ...record,
    AutoCodeNum: Number(record.AutoCodeNum),
    IsHidden: Boolean(record.IsHidden),
    LessIntrusive: Boolean(record.LessIntrusive),
  };
}

function validateAutocodePayload(
  data: CreateAutocodeRequest | UpdateAutocodeRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need((data as any).Description !== undefined, 'Description is required');
  if (data.Description !== undefined && data.Description.trim() === '') errors.push('Description cannot be blank');

  return errors;
}

async function handleGetAutocodes(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCodeNum, Description, IsHidden, LessIntrusive, created_at, updated_at
      FROM autocode
      ORDER BY AutoCodeNum ASC
    `;
    const results = await executeQuery<Autocode[]>(query);
    const mapped = results.map(mapAutocode);
    const response: ApiResponse<Autocode[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocode:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutocode(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCodeNum, Description, IsHidden, LessIntrusive, created_at, updated_at
      FROM autocode
      WHERE AutoCodeNum = ?
    `;
    const results = await executeQuery<Autocode[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Autocode not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Autocode> = { success: true, data: mapAutocode(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocode by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutocode(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutocodeRequest = JSON.parse(event.body);
    const errors = validateAutocodePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO autocode
      (Description, IsHidden, LessIntrusive)
      VALUES (?, ?, ?)
    `;
    const params = [
      data.Description.trim(),
      data.IsHidden ? 1 : 0,
      data.LessIntrusive ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutoCodeNum, Description, IsHidden, LessIntrusive, created_at, updated_at
      FROM autocode
      WHERE AutoCodeNum = ?
    `;
    const records = await executeQuery<Autocode[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Autocode> = {
      success: true,
      data: mapAutocode(records[0]),
      message: 'Autocode created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST autocode:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutocode(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutoCodeNum FROM autocode WHERE AutoCodeNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Autocode not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutocodeRequest = JSON.parse(event.body);
    const errors = validateAutocodePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.IsHidden !== undefined) { updateFields.push('IsHidden = ?'); updateParams.push(data.IsHidden ? 1 : 0); }
    if (data.LessIntrusive !== undefined) { updateFields.push('LessIntrusive = ?'); updateParams.push(data.LessIntrusive ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE autocode
      SET ${updateFields.join(', ')}
      WHERE AutoCodeNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutoCodeNum, Description, IsHidden, LessIntrusive, created_at, updated_at
      FROM autocode
      WHERE AutoCodeNum = ?
    `;
    const records = await executeQuery<Autocode[]>(selectQuery, [id]);

    const response: ApiResponse<Autocode> = {
      success: true,
      data: mapAutocode(records[0]),
      message: 'Autocode updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT autocode:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutocode(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutoCodeNum FROM autocode WHERE AutoCodeNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Autocode not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM autocode WHERE AutoCodeNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Autocode deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE autocode:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTOCODECOND HANDLERS
// ========================================

function mapAutocodeCond(record: any): AutocodeCond {
  return {
    ...record,
    AutoCodeCondNum: Number(record.AutoCodeCondNum),
    AutoCodeItemNum: Number(record.AutoCodeItemNum),
    Cond: Number(record.Cond) as AutoCondition,
  };
}

function validateAutocodeCondPayload(
  data: CreateAutocodeCondRequest | UpdateAutocodeCondRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).AutoCodeItemNum !== undefined, 'AutoCodeItemNum is required');
  need((data as any).Cond !== undefined, 'Cond is required');

  checkNum((data as any).AutoCodeItemNum, 'AutoCodeItemNum');
  if ((data as any).Cond !== undefined) {
    const n = Number((data as any).Cond);
    if (n < AutoCondition.Anterior || n > AutoCondition.AgeOver18) {
      errors.push('Cond out of range');
    }
  }

  return errors;
}

async function handleGetAutocodeConds(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCodeCondNum, AutoCodeItemNum, Cond, created_at, updated_at
      FROM autocodecond
      ORDER BY AutoCodeCondNum ASC
    `;
    const results = await executeQuery<AutocodeCond[]>(query);
    const mapped = results.map(mapAutocodeCond);
    const response: ApiResponse<AutocodeCond[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocodecond:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutocodeCond(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCodeCondNum, AutoCodeItemNum, Cond, created_at, updated_at
      FROM autocodecond
      WHERE AutoCodeCondNum = ?
    `;
    const results = await executeQuery<AutocodeCond[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutocodeCond not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<AutocodeCond> = { success: true, data: mapAutocodeCond(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocodecond by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutocodeCond(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutocodeCondRequest = JSON.parse(event.body);
    const errors = validateAutocodeCondPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO autocodecond
      (AutoCodeItemNum, Cond)
      VALUES (?, ?)
    `;
    const params = [
      data.AutoCodeItemNum,
      data.Cond,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutoCodeCondNum, AutoCodeItemNum, Cond, created_at, updated_at
      FROM autocodecond
      WHERE AutoCodeCondNum = ?
    `;
    const records = await executeQuery<AutocodeCond[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AutocodeCond> = {
      success: true,
      data: mapAutocodeCond(records[0]),
      message: 'AutocodeCond created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST autocodecond:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutocodeCond(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutoCodeCondNum FROM autocodecond WHERE AutoCodeCondNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutocodeCond not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutocodeCondRequest = JSON.parse(event.body);
    const errors = validateAutocodeCondPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AutoCodeItemNum !== undefined) { updateFields.push('AutoCodeItemNum = ?'); updateParams.push(data.AutoCodeItemNum); }
    if (data.Cond !== undefined) { updateFields.push('Cond = ?'); updateParams.push(data.Cond); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE autocodecond
      SET ${updateFields.join(', ')}
      WHERE AutoCodeCondNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutoCodeCondNum, AutoCodeItemNum, Cond, created_at, updated_at
      FROM autocodecond
      WHERE AutoCodeCondNum = ?
    `;
    const records = await executeQuery<AutocodeCond[]>(selectQuery, [id]);

    const response: ApiResponse<AutocodeCond> = {
      success: true,
      data: mapAutocodeCond(records[0]),
      message: 'AutocodeCond updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT autocodecond:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutocodeCond(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutoCodeCondNum FROM autocodecond WHERE AutoCodeCondNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutocodeCond not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM autocodecond WHERE AutoCodeCondNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AutocodeCond deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE autocodecond:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTOCODEITEM HANDLERS
// ========================================

function mapAutocodeItem(record: any): AutocodeItem {
  return {
    ...record,
    AutoCodeItemNum: Number(record.AutoCodeItemNum),
    AutoCodeNum: Number(record.AutoCodeNum),
    OldCode: record.OldCode ?? undefined,
    CodeNum: Number(record.CodeNum),
  };
}

function validateAutocodeItemPayload(
  data: CreateAutocodeItemRequest | UpdateAutocodeItemRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).AutoCodeNum !== undefined, 'AutoCodeNum is required');
  need((data as any).CodeNum !== undefined, 'CodeNum is required');

  checkNum((data as any).AutoCodeNum, 'AutoCodeNum');
  checkNum((data as any).CodeNum, 'CodeNum');

  return errors;
}

async function handleGetAutocodeItems(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCodeItemNum, AutoCodeNum, OldCode, CodeNum, created_at, updated_at
      FROM autocodeitem
      ORDER BY AutoCodeItemNum ASC
    `;
    const results = await executeQuery<AutocodeItem[]>(query);
    const mapped = results.map(mapAutocodeItem);
    const response: ApiResponse<AutocodeItem[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocodeitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutocodeItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCodeItemNum, AutoCodeNum, OldCode, CodeNum, created_at, updated_at
      FROM autocodeitem
      WHERE AutoCodeItemNum = ?
    `;
    const results = await executeQuery<AutocodeItem[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutocodeItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<AutocodeItem> = { success: true, data: mapAutocodeItem(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocodeitem by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutocodeItem(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutocodeItemRequest = JSON.parse(event.body);
    const errors = validateAutocodeItemPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO autocodeitem
      (AutoCodeNum, OldCode, CodeNum)
      VALUES (?, ?, ?)
    `;
    const params = [
      data.AutoCodeNum,
      data.OldCode ?? null,
      data.CodeNum,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutoCodeItemNum, AutoCodeNum, OldCode, CodeNum, created_at, updated_at
      FROM autocodeitem
      WHERE AutoCodeItemNum = ?
    `;
    const records = await executeQuery<AutocodeItem[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AutocodeItem> = {
      success: true,
      data: mapAutocodeItem(records[0]),
      message: 'AutocodeItem created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST autocodeitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutocodeItem(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutoCodeItemNum FROM autocodeitem WHERE AutoCodeItemNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutocodeItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutocodeItemRequest = JSON.parse(event.body);
    const errors = validateAutocodeItemPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AutoCodeNum !== undefined) { updateFields.push('AutoCodeNum = ?'); updateParams.push(data.AutoCodeNum); }
    if (data.OldCode !== undefined) { updateFields.push('OldCode = ?'); updateParams.push(data.OldCode ?? null); }
    if (data.CodeNum !== undefined) { updateFields.push('CodeNum = ?'); updateParams.push(data.CodeNum); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE autocodeitem
      SET ${updateFields.join(', ')}
      WHERE AutoCodeItemNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutoCodeItemNum, AutoCodeNum, OldCode, CodeNum, created_at, updated_at
      FROM autocodeitem
      WHERE AutoCodeItemNum = ?
    `;
    const records = await executeQuery<AutocodeItem[]>(selectQuery, [id]);

    const response: ApiResponse<AutocodeItem> = {
      success: true,
      data: mapAutocodeItem(records[0]),
      message: 'AutocodeItem updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT autocodeitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutocodeItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutoCodeItemNum FROM autocodeitem WHERE AutoCodeItemNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutocodeItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM autocodeitem WHERE AutoCodeItemNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AutocodeItem deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE autocodeitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTOCOMMEXCLUDEDATES HANDLERS
// ========================================

function mapAutoCommExcludeDate(record: any): AutoCommExcludeDate {
  return {
    ...record,
    AutoCommExcludeDateNum: Number(record.AutoCommExcludeDateNum),
    ClinicNum: Number(record.ClinicNum),
    DateExclude: record.DateExclude,
  };
}

function validateAutoCommExcludeDatePayload(
  data: CreateAutoCommExcludeDateRequest | UpdateAutoCommExcludeDateRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ClinicNum !== undefined, 'ClinicNum is required');
  need((data as any).DateExclude !== undefined, 'DateExclude is required');
  checkNum((data as any).ClinicNum, 'ClinicNum');
  if ((data as any).DateExclude !== undefined && String((data as any).DateExclude).trim() === '') {
    errors.push('DateExclude cannot be blank');
  }

  return errors;
}

async function handleGetAutoCommExcludeDates(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCommExcludeDateNum, ClinicNum, DateExclude, created_at, updated_at
      FROM autocommexcludedate
      ORDER BY DateExclude ASC, AutoCommExcludeDateNum ASC
    `;
    const results = await executeQuery<AutoCommExcludeDate[]>(query);
    const mapped = results.map(mapAutoCommExcludeDate);
    const response: ApiResponse<AutoCommExcludeDate[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocommexcludedate:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutoCommExcludeDate(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoCommExcludeDateNum, ClinicNum, DateExclude, created_at, updated_at
      FROM autocommexcludedate
      WHERE AutoCommExcludeDateNum = ?
    `;
    const results = await executeQuery<AutoCommExcludeDate[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutoCommExcludeDate not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<AutoCommExcludeDate> = { success: true, data: mapAutoCommExcludeDate(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autocommexcludedate by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutoCommExcludeDate(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutoCommExcludeDateRequest = JSON.parse(event.body);
    const errors = validateAutoCommExcludeDatePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO autocommexcludedate
      (ClinicNum, DateExclude)
      VALUES (?, ?)
    `;
    const params = [
      data.ClinicNum,
      data.DateExclude,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutoCommExcludeDateNum, ClinicNum, DateExclude, created_at, updated_at
      FROM autocommexcludedate
      WHERE AutoCommExcludeDateNum = ?
    `;
    const records = await executeQuery<AutoCommExcludeDate[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AutoCommExcludeDate> = {
      success: true,
      data: mapAutoCommExcludeDate(records[0]),
      message: 'AutoCommExcludeDate created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST autocommexcludedate:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutoCommExcludeDate(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutoCommExcludeDateNum FROM autocommexcludedate WHERE AutoCommExcludeDateNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutoCommExcludeDate not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutoCommExcludeDateRequest = JSON.parse(event.body);
    const errors = validateAutoCommExcludeDatePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum); }
    if (data.DateExclude !== undefined) { updateFields.push('DateExclude = ?'); updateParams.push(data.DateExclude); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE autocommexcludedate
      SET ${updateFields.join(', ')}
      WHERE AutoCommExcludeDateNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutoCommExcludeDateNum, ClinicNum, DateExclude, created_at, updated_at
      FROM autocommexcludedate
      WHERE AutoCommExcludeDateNum = ?
    `;
    const records = await executeQuery<AutoCommExcludeDate[]>(selectQuery, [id]);

    const response: ApiResponse<AutoCommExcludeDate> = {
      success: true,
      data: mapAutoCommExcludeDate(records[0]),
      message: 'AutoCommExcludeDate updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT autocommexcludedate:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutoCommExcludeDate(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutoCommExcludeDateNum FROM autocommexcludedate WHERE AutoCommExcludeDateNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutoCommExcludeDate not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM autocommexcludedate WHERE AutoCommExcludeDateNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AutoCommExcludeDate deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE autocommexcludedate:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTOMATION HANDLERS
// ========================================

function mapAutomation(record: any): Automation {
  return {
    ...record,
    AutomationNum: Number(record.AutomationNum),
    Autotrigger: Number(record.Autotrigger) as AutomationTrigger,
    AutoAction: Number(record.AutoAction) as AutomationAction,
    SheetDefNum: record.SheetDefNum !== null ? Number(record.SheetDefNum) : undefined,
    CommType: record.CommType !== null ? Number(record.CommType) : undefined,
    AptStatus: record.AptStatus !== null ? Number(record.AptStatus) as ApptStatus : undefined,
    AppointmentTypeNum: record.AppointmentTypeNum !== null ? Number(record.AppointmentTypeNum) : undefined,
    PatStatus: record.PatStatus !== null ? Number(record.PatStatus) as PatientStatus : undefined,
  };
}

function validateAutomationPayload(
  data: CreateAutomationRequest | UpdateAutomationRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).Description !== undefined, 'Description is required');
  need((data as any).Autotrigger !== undefined, 'Autotrigger is required');
  need((data as any).AutoAction !== undefined, 'AutoAction is required');

  if (data.Description !== undefined && data.Description.trim() === '') {
    errors.push('Description cannot be blank');
  }

  if ((data as any).Autotrigger !== undefined) {
    const n = Number((data as any).Autotrigger);
    if (n < AutomationTrigger.ProcedureComplete || n > AutomationTrigger.ApptComplete) {
      errors.push('Autotrigger out of range');
    }
  }
  if ((data as any).AutoAction !== undefined) {
    const n = Number((data as any).AutoAction);
    if (n < AutomationAction.PrintPatientLetter || n > AutomationAction.ChangePatStatus) {
      errors.push('AutoAction out of range');
    }
  }
  if ((data as any).AptStatus !== undefined) {
    const n = Number((data as any).AptStatus);
    if (n < ApptStatus.None || n > ApptStatus.PtNoteCompleted) {
      errors.push('AptStatus out of range');
    }
  }
  if ((data as any).PatStatus !== undefined) {
    const n = Number((data as any).PatStatus);
    if (n < PatientStatus.Patient || n > PatientStatus.Prospective) {
      errors.push('PatStatus out of range');
    }
  }

  checkNum((data as any).SheetDefNum, 'SheetDefNum', true);
  checkNum((data as any).CommType, 'CommType', true);
  checkNum((data as any).AppointmentTypeNum, 'AppointmentTypeNum', true);

  return errors;
}

async function handleGetAutomations(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutomationNum, Description, Autotrigger, ProcCodes, AutoAction, SheetDefNum, CommType, MessageContent,
             AptStatus, AppointmentTypeNum, PatStatus, created_at, updated_at
      FROM automation
      ORDER BY AutomationNum ASC
    `;
    const results = await executeQuery<Automation[]>(query);
    const mapped = results.map(mapAutomation);
    const response: ApiResponse<Automation[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET automation:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutomation(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutomationNum, Description, Autotrigger, ProcCodes, AutoAction, SheetDefNum, CommType, MessageContent,
             AptStatus, AppointmentTypeNum, PatStatus, created_at, updated_at
      FROM automation
      WHERE AutomationNum = ?
    `;
    const results = await executeQuery<Automation[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Automation not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Automation> = { success: true, data: mapAutomation(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET automation by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutomation(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutomationRequest = JSON.parse(event.body);
    const errors = validateAutomationPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO automation
      (Description, Autotrigger, ProcCodes, AutoAction, SheetDefNum, CommType, MessageContent, AptStatus, AppointmentTypeNum, PatStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.Description.trim(),
      data.Autotrigger,
      data.ProcCodes ?? null,
      data.AutoAction,
      data.SheetDefNum ?? null,
      data.CommType ?? null,
      data.MessageContent ?? null,
      data.AptStatus ?? null,
      data.AppointmentTypeNum ?? null,
      data.PatStatus ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutomationNum, Description, Autotrigger, ProcCodes, AutoAction, SheetDefNum, CommType, MessageContent,
             AptStatus, AppointmentTypeNum, PatStatus, created_at, updated_at
      FROM automation
      WHERE AutomationNum = ?
    `;
    const records = await executeQuery<Automation[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Automation> = {
      success: true,
      data: mapAutomation(records[0]),
      message: 'Automation created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST automation:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutomation(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutomationNum FROM automation WHERE AutomationNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Automation not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutomationRequest = JSON.parse(event.body);
    const errors = validateAutomationPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.Autotrigger !== undefined) { updateFields.push('Autotrigger = ?'); updateParams.push(data.Autotrigger); }
    if (data.ProcCodes !== undefined) { updateFields.push('ProcCodes = ?'); updateParams.push(data.ProcCodes ?? null); }
    if (data.AutoAction !== undefined) { updateFields.push('AutoAction = ?'); updateParams.push(data.AutoAction); }
    if (data.SheetDefNum !== undefined) { updateFields.push('SheetDefNum = ?'); updateParams.push(data.SheetDefNum ?? null); }
    if (data.CommType !== undefined) { updateFields.push('CommType = ?'); updateParams.push(data.CommType ?? null); }
    if (data.MessageContent !== undefined) { updateFields.push('MessageContent = ?'); updateParams.push(data.MessageContent ?? null); }
    if (data.AptStatus !== undefined) { updateFields.push('AptStatus = ?'); updateParams.push(data.AptStatus ?? null); }
    if (data.AppointmentTypeNum !== undefined) { updateFields.push('AppointmentTypeNum = ?'); updateParams.push(data.AppointmentTypeNum ?? null); }
    if (data.PatStatus !== undefined) { updateFields.push('PatStatus = ?'); updateParams.push(data.PatStatus ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE automation
      SET ${updateFields.join(', ')}
      WHERE AutomationNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutomationNum, Description, Autotrigger, ProcCodes, AutoAction, SheetDefNum, CommType, MessageContent,
             AptStatus, AppointmentTypeNum, PatStatus, created_at, updated_at
      FROM automation
      WHERE AutomationNum = ?
    `;
    const records = await executeQuery<Automation[]>(selectQuery, [id]);

    const response: ApiResponse<Automation> = {
      success: true,
      data: mapAutomation(records[0]),
      message: 'Automation updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT automation:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutomation(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutomationNum FROM automation WHERE AutomationNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Automation not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM automation WHERE AutomationNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Automation deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE automation:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTOMATIONCONDITION HANDLERS
// ========================================

function mapAutomationCondition(record: any): AutomationCondition {
  return {
    ...record,
    AutomationConditionNum: Number(record.AutomationConditionNum),
    AutomationNum: Number(record.AutomationNum),
    CompareField: Number(record.CompareField) as AutoCondField,
    Comparison: Number(record.Comparison) as AutoCondComparison,
    CompareString: record.CompareString ?? undefined,
  };
}

function validateAutomationConditionPayload(
  data: CreateAutomationConditionRequest | UpdateAutomationConditionRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).AutomationNum !== undefined, 'AutomationNum is required');
  need((data as any).CompareField !== undefined, 'CompareField is required');
  need((data as any).Comparison !== undefined, 'Comparison is required');

  checkNum((data as any).AutomationNum, 'AutomationNum');

  if ((data as any).CompareField !== undefined) {
    const n = Number((data as any).CompareField);
    if (n < AutoCondField.NeedsSheet || n > AutoCondField.ClaimContainsProcCode) {
      errors.push('CompareField out of range');
    }
  }
  if ((data as any).Comparison !== undefined) {
    const n = Number((data as any).Comparison);
    if (n < AutoCondComparison.Equals || n > AutoCondComparison.None) {
      errors.push('Comparison out of range');
    }
  }
  if ((data as any).CompareString !== undefined && (data as any).CompareString.trim() === '') {
    errors.push('CompareString cannot be blank');
  }

  return errors;
}

async function handleGetAutomationConditions(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutomationConditionNum, AutomationNum, CompareField, Comparison, CompareString, created_at, updated_at
      FROM automationcondition
      ORDER BY AutomationConditionNum ASC
    `;
    const results = await executeQuery<AutomationCondition[]>(query);
    const mapped = results.map(mapAutomationCondition);
    const response: ApiResponse<AutomationCondition[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET automationcondition:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutomationCondition(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutomationConditionNum, AutomationNum, CompareField, Comparison, CompareString, created_at, updated_at
      FROM automationcondition
      WHERE AutomationConditionNum = ?
    `;
    const results = await executeQuery<AutomationCondition[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutomationCondition not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<AutomationCondition> = { success: true, data: mapAutomationCondition(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET automationcondition by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutomationCondition(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutomationConditionRequest = JSON.parse(event.body);
    const errors = validateAutomationConditionPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO automationcondition
      (AutomationNum, CompareField, Comparison, CompareString)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.AutomationNum,
      data.CompareField,
      data.Comparison,
      data.CompareString ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutomationConditionNum, AutomationNum, CompareField, Comparison, CompareString, created_at, updated_at
      FROM automationcondition
      WHERE AutomationConditionNum = ?
    `;
    const records = await executeQuery<AutomationCondition[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AutomationCondition> = {
      success: true,
      data: mapAutomationCondition(records[0]),
      message: 'AutomationCondition created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST automationcondition:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutomationCondition(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutomationConditionNum FROM automationcondition WHERE AutomationConditionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutomationCondition not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutomationConditionRequest = JSON.parse(event.body);
    const errors = validateAutomationConditionPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AutomationNum !== undefined) { updateFields.push('AutomationNum = ?'); updateParams.push(data.AutomationNum); }
    if (data.CompareField !== undefined) { updateFields.push('CompareField = ?'); updateParams.push(data.CompareField); }
    if (data.Comparison !== undefined) { updateFields.push('Comparison = ?'); updateParams.push(data.Comparison); }
    if (data.CompareString !== undefined) { updateFields.push('CompareString = ?'); updateParams.push(data.CompareString ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE automationcondition
      SET ${updateFields.join(', ')}
      WHERE AutomationConditionNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutomationConditionNum, AutomationNum, CompareField, Comparison, CompareString, created_at, updated_at
      FROM automationcondition
      WHERE AutomationConditionNum = ?
    `;
    const records = await executeQuery<AutomationCondition[]>(selectQuery, [id]);

    const response: ApiResponse<AutomationCondition> = {
      success: true,
      data: mapAutomationCondition(records[0]),
      message: 'AutomationCondition updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT automationcondition:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutomationCondition(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutomationConditionNum FROM automationcondition WHERE AutomationConditionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutomationCondition not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM automationcondition WHERE AutomationConditionNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AutomationCondition deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE automationcondition:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTONOTE HANDLERS
// ========================================

function mapAutonote(record: any): Autonote {
  return {
    ...record,
    AutoNoteNum: Number(record.AutoNoteNum),
    Category: record.Category !== null ? Number(record.Category) : undefined,
  };
}

function validateAutonotePayload(
  data: CreateAutonoteRequest | UpdateAutonoteRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).AutoNoteName !== undefined, 'AutoNoteName is required');
  if (data.AutoNoteName !== undefined && data.AutoNoteName.trim() === '') {
    errors.push('AutoNoteName cannot be blank');
  }
  checkNum((data as any).Category, 'Category');

  return errors;
}

async function handleGetAutonotes(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoNoteNum, AutoNoteName, MainText, Category, created_at, updated_at
      FROM autonote
      ORDER BY AutoNoteName ASC, AutoNoteNum ASC
    `;
    const results = await executeQuery<Autonote[]>(query);
    const mapped = results.map(mapAutonote);
    const response: ApiResponse<Autonote[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autonote:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutonote(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoNoteNum, AutoNoteName, MainText, Category, created_at, updated_at
      FROM autonote
      WHERE AutoNoteNum = ?
    `;
    const results = await executeQuery<Autonote[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Autonote not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Autonote> = { success: true, data: mapAutonote(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autonote by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutonote(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutonoteRequest = JSON.parse(event.body);
    const errors = validateAutonotePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO autonote
      (AutoNoteName, MainText, Category)
      VALUES (?, ?, ?)
    `;
    const params = [
      data.AutoNoteName.trim(),
      data.MainText ?? null,
      data.Category ?? 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutoNoteNum, AutoNoteName, MainText, Category, created_at, updated_at
      FROM autonote
      WHERE AutoNoteNum = ?
    `;
    const records = await executeQuery<Autonote[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Autonote> = {
      success: true,
      data: mapAutonote(records[0]),
      message: 'Autonote created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST autonote:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutonote(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutoNoteNum FROM autonote WHERE AutoNoteNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Autonote not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutonoteRequest = JSON.parse(event.body);
    const errors = validateAutonotePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AutoNoteName !== undefined) { updateFields.push('AutoNoteName = ?'); updateParams.push(data.AutoNoteName.trim()); }
    if (data.MainText !== undefined) { updateFields.push('MainText = ?'); updateParams.push(data.MainText ?? null); }
    if (data.Category !== undefined) { updateFields.push('Category = ?'); updateParams.push(data.Category ?? 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE autonote
      SET ${updateFields.join(', ')}
      WHERE AutoNoteNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutoNoteNum, AutoNoteName, MainText, Category, created_at, updated_at
      FROM autonote
      WHERE AutoNoteNum = ?
    `;
    const records = await executeQuery<Autonote[]>(selectQuery, [id]);

    const response: ApiResponse<Autonote> = {
      success: true,
      data: mapAutonote(records[0]),
      message: 'Autonote updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT autonote:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutonote(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutoNoteNum FROM autonote WHERE AutoNoteNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Autonote not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM autonote WHERE AutoNoteNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Autonote deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE autonote:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// AUTONOTECONTROL HANDLERS
// ========================================

function mapAutonoteControl(record: any): AutonoteControl {
  return {
    ...record,
    AutoNoteControlNum: Number(record.AutoNoteControlNum),
    ControlType: record.ControlType as AutonoteControlType,
  };
}

function validateAutonoteControlPayload(
  data: CreateAutonoteControlRequest | UpdateAutonoteControlRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need((data as any).Descript !== undefined, 'Descript is required');
  need((data as any).ControlType !== undefined, 'ControlType is required');
  need((data as any).ControlLabel !== undefined, 'ControlLabel is required');

  if (data.Descript !== undefined && data.Descript.trim() === '') errors.push('Descript cannot be blank');
  if (data.ControlLabel !== undefined && data.ControlLabel.trim() === '') errors.push('ControlLabel cannot be blank');
  if (data.ControlType !== undefined) {
    const allowed = [AutonoteControlType.Text, AutonoteControlType.OneResponse, AutonoteControlType.MultiResponse];
    if (!allowed.includes(data.ControlType as AutonoteControlType)) {
      errors.push('ControlType must be Text, OneResponse, or MultiResponse');
    }
  }

  return errors;
}

async function handleGetAutonoteControls(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoNoteControlNum, Descript, ControlType, ControlLabel, ControlOptions, created_at, updated_at
      FROM autonotecontrol
      ORDER BY Descript ASC, AutoNoteControlNum ASC
    `;
    const results = await executeQuery<AutonoteControl[]>(query);
    const mapped = results.map(mapAutonoteControl);
    const response: ApiResponse<AutonoteControl[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autonotecontrol:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAutonoteControl(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AutoNoteControlNum, Descript, ControlType, ControlLabel, ControlOptions, created_at, updated_at
      FROM autonotecontrol
      WHERE AutoNoteControlNum = ?
    `;
    const results = await executeQuery<AutonoteControl[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutonoteControl not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<AutonoteControl> = { success: true, data: mapAutonoteControl(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET autonotecontrol by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAutonoteControl(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAutonoteControlRequest = JSON.parse(event.body);
    const errors = validateAutonoteControlPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO autonotecontrol
      (Descript, ControlType, ControlLabel, ControlOptions)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.Descript.trim(),
      data.ControlType,
      data.ControlLabel.trim(),
      data.ControlOptions ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AutoNoteControlNum, Descript, ControlType, ControlLabel, ControlOptions, created_at, updated_at
      FROM autonotecontrol
      WHERE AutoNoteControlNum = ?
    `;
    const records = await executeQuery<AutonoteControl[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AutonoteControl> = {
      success: true,
      data: mapAutonoteControl(records[0]),
      message: 'AutonoteControl created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST autonotecontrol:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAutonoteControl(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AutoNoteControlNum FROM autonotecontrol WHERE AutoNoteControlNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutonoteControl not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAutonoteControlRequest = JSON.parse(event.body);
    const errors = validateAutonoteControlPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Descript !== undefined) { updateFields.push('Descript = ?'); updateParams.push(data.Descript.trim()); }
    if (data.ControlType !== undefined) { updateFields.push('ControlType = ?'); updateParams.push(data.ControlType); }
    if (data.ControlLabel !== undefined) { updateFields.push('ControlLabel = ?'); updateParams.push(data.ControlLabel.trim()); }
    if (data.ControlOptions !== undefined) { updateFields.push('ControlOptions = ?'); updateParams.push(data.ControlOptions ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE autonotecontrol
      SET ${updateFields.join(', ')}
      WHERE AutoNoteControlNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AutoNoteControlNum, Descript, ControlType, ControlLabel, ControlOptions, created_at, updated_at
      FROM autonotecontrol
      WHERE AutoNoteControlNum = ?
    `;
    const records = await executeQuery<AutonoteControl[]>(selectQuery, [id]);

    const response: ApiResponse<AutonoteControl> = {
      success: true,
      data: mapAutonoteControl(records[0]),
      message: 'AutonoteControl updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT autonotecontrol:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAutonoteControl(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AutoNoteControlNum FROM autonotecontrol WHERE AutoNoteControlNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AutonoteControl not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM autonotecontrol WHERE AutoNoteControlNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AutonoteControl deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE autonotecontrol:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// BENEFIT HANDLERS
// ========================================

function mapBenefit(record: any): Benefit {
  return {
    ...record,
    BenefitNum: Number(record.BenefitNum),
    PlanNum: record.PlanNum !== null ? Number(record.PlanNum) : undefined,
    PatPlanNum: record.PatPlanNum !== null ? Number(record.PatPlanNum) : undefined,
    CovCatNum: record.CovCatNum !== null ? Number(record.CovCatNum) : undefined,
    BenefitType: Number(record.BenefitType) as InsBenefitType,
    Percent: record.Percent !== null ? Number(record.Percent) : undefined,
    MonetaryAmt: record.MonetaryAmt !== null ? Number(record.MonetaryAmt) : undefined,
    TimePeriod: record.TimePeriod !== null ? Number(record.TimePeriod) as BenefitTimePeriod : undefined,
    QuantityQualifier: record.QuantityQualifier !== null ? Number(record.QuantityQualifier) as BenefitQuantity : undefined,
    Quantity: record.Quantity !== null ? Number(record.Quantity) : undefined,
    CodeNum: record.CodeNum !== null ? Number(record.CodeNum) : undefined,
    CoverageLevel: record.CoverageLevel !== null ? Number(record.CoverageLevel) as BenefitCoverageLevel : undefined,
    CodeGroupNum: record.CodeGroupNum !== null ? Number(record.CodeGroupNum) : undefined,
    TreatArea: record.TreatArea !== null ? Number(record.TreatArea) as TreatmentArea : undefined,
    ToothRange: record.ToothRange ?? undefined,
    SecDateTEntry: record.SecDateTEntry ?? undefined,
    SecDateTEdit: record.SecDateTEdit ?? undefined,
  };
}

function validateBenefitPayload(
  data: CreateBenefitRequest | UpdateBenefitRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).BenefitType !== undefined, 'BenefitType is required');

  // Require at least one of PlanNum or PatPlanNum
  if (requireAll) {
    if (data.PlanNum === undefined && data.PatPlanNum === undefined) {
      errors.push('Either PlanNum or PatPlanNum is required');
    }
  }

  checkNum((data as any).PlanNum, 'PlanNum');
  checkNum((data as any).PatPlanNum, 'PatPlanNum');
  checkNum((data as any).CovCatNum, 'CovCatNum');
  checkNum((data as any).Percent, 'Percent');
  checkNum((data as any).MonetaryAmt, 'MonetaryAmt');
  checkNum((data as any).Quantity, 'Quantity');
  checkNum((data as any).CodeNum, 'CodeNum');
  checkNum((data as any).CodeGroupNum, 'CodeGroupNum');

  if ((data as any).BenefitType !== undefined) {
    const n = Number((data as any).BenefitType);
    if (n < InsBenefitType.ActiveCoverage || n > InsBenefitType.WaitingPeriod) {
      errors.push('BenefitType out of range');
    }
  }
  if ((data as any).TimePeriod !== undefined) {
    const n = Number((data as any).TimePeriod);
    if (n < BenefitTimePeriod.None || n > BenefitTimePeriod.NumberInLast12Months) {
      errors.push('TimePeriod out of range');
    }
  }
  if ((data as any).QuantityQualifier !== undefined) {
    const n = Number((data as any).QuantityQualifier);
    if (n < BenefitQuantity.None || n > BenefitQuantity.Months) {
      errors.push('QuantityQualifier out of range');
    }
  }
  if ((data as any).CoverageLevel !== undefined) {
    const n = Number((data as any).CoverageLevel);
    if (n < BenefitCoverageLevel.None || n > BenefitCoverageLevel.Family) {
      errors.push('CoverageLevel out of range');
    }
  }
  if ((data as any).TreatArea !== undefined) {
    const n = Number((data as any).TreatArea);
    if (n < TreatmentArea.None || n > TreatmentArea.ToothRange) {
      errors.push('TreatArea out of range');
    }
  }
  if ((data as any).Percent !== undefined) {
    const n = Number((data as any).Percent);
    if (n !== -1 && (n < 0 || n > 100)) {
      errors.push('Percent must be between 0 and 100 or -1');
    }
  }

  return errors;
}

async function handleGetBenefits(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT BenefitNum, PlanNum, PatPlanNum, CovCatNum, BenefitType, Percent, MonetaryAmt, TimePeriod, QuantityQualifier, Quantity, CodeNum, CoverageLevel,
             SecDateTEntry, SecDateTEdit, CodeGroupNum, TreatArea, ToothRange, created_at, updated_at
      FROM benefit
      ORDER BY BenefitNum DESC
    `;
    const results = await executeQuery<Benefit[]>(query);
    const mapped = results.map(mapBenefit);
    const response: ApiResponse<Benefit[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET benefit:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetBenefit(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT BenefitNum, PlanNum, PatPlanNum, CovCatNum, BenefitType, Percent, MonetaryAmt, TimePeriod, QuantityQualifier, Quantity, CodeNum, CoverageLevel,
             SecDateTEntry, SecDateTEdit, CodeGroupNum, TreatArea, ToothRange, created_at, updated_at
      FROM benefit
      WHERE BenefitNum = ?
    `;
    const results = await executeQuery<Benefit[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Benefit not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Benefit> = { success: true, data: mapBenefit(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET benefit by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostBenefit(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateBenefitRequest = JSON.parse(event.body);
    const errors = validateBenefitPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    // ensure either PlanNum or PatPlanNum set
    const planNumVal = data.PlanNum ?? 0;
    const patPlanNumVal = data.PatPlanNum ?? 0;

    const insertQuery = `
      INSERT INTO benefit
      (PlanNum, PatPlanNum, CovCatNum, BenefitType, Percent, MonetaryAmt, TimePeriod, QuantityQualifier, Quantity, CodeNum, CoverageLevel, CodeGroupNum, TreatArea, ToothRange)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      planNumVal,
      patPlanNumVal,
      data.CovCatNum ?? 0,
      data.BenefitType,
      data.Percent ?? -1,
      data.MonetaryAmt ?? -1,
      data.TimePeriod ?? BenefitTimePeriod.None,
      data.QuantityQualifier ?? BenefitQuantity.None,
      data.Quantity ?? 0,
      data.CodeNum ?? 0,
      data.CoverageLevel ?? BenefitCoverageLevel.None,
      data.CodeGroupNum ?? 0,
      data.TreatArea ?? TreatmentArea.None,
      data.ToothRange ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT BenefitNum, PlanNum, PatPlanNum, CovCatNum, BenefitType, Percent, MonetaryAmt, TimePeriod, QuantityQualifier, Quantity, CodeNum, CoverageLevel,
             SecDateTEntry, SecDateTEdit, CodeGroupNum, TreatArea, ToothRange, created_at, updated_at
      FROM benefit
      WHERE BenefitNum = ?
    `;
    const records = await executeQuery<Benefit[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Benefit> = {
      success: true,
      data: mapBenefit(records[0]),
      message: 'Benefit created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST benefit:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutBenefit(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT BenefitNum FROM benefit WHERE BenefitNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Benefit not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateBenefitRequest = JSON.parse(event.body);
    const errors = validateBenefitPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.PlanNum !== undefined) { updateFields.push('PlanNum = ?'); updateParams.push(data.PlanNum ?? 0); }
    if (data.PatPlanNum !== undefined) { updateFields.push('PatPlanNum = ?'); updateParams.push(data.PatPlanNum ?? 0); }
    if (data.CovCatNum !== undefined) { updateFields.push('CovCatNum = ?'); updateParams.push(data.CovCatNum ?? 0); }
    if (data.BenefitType !== undefined) { updateFields.push('BenefitType = ?'); updateParams.push(data.BenefitType); }
    if (data.Percent !== undefined) { updateFields.push('Percent = ?'); updateParams.push(data.Percent ?? -1); }
    if (data.MonetaryAmt !== undefined) { updateFields.push('MonetaryAmt = ?'); updateParams.push(data.MonetaryAmt ?? -1); }
    if (data.TimePeriod !== undefined) { updateFields.push('TimePeriod = ?'); updateParams.push(data.TimePeriod ?? BenefitTimePeriod.None); }
    if (data.QuantityQualifier !== undefined) { updateFields.push('QuantityQualifier = ?'); updateParams.push(data.QuantityQualifier ?? BenefitQuantity.None); }
    if (data.Quantity !== undefined) { updateFields.push('Quantity = ?'); updateParams.push(data.Quantity ?? 0); }
    if (data.CodeNum !== undefined) { updateFields.push('CodeNum = ?'); updateParams.push(data.CodeNum ?? 0); }
    if (data.CoverageLevel !== undefined) { updateFields.push('CoverageLevel = ?'); updateParams.push(data.CoverageLevel ?? BenefitCoverageLevel.None); }
    if (data.CodeGroupNum !== undefined) { updateFields.push('CodeGroupNum = ?'); updateParams.push(data.CodeGroupNum ?? 0); }
    if (data.TreatArea !== undefined) { updateFields.push('TreatArea = ?'); updateParams.push(data.TreatArea ?? TreatmentArea.None); }
    if (data.ToothRange !== undefined) { updateFields.push('ToothRange = ?'); updateParams.push(data.ToothRange ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE benefit
      SET ${updateFields.join(', ')}
      WHERE BenefitNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT BenefitNum, PlanNum, PatPlanNum, CovCatNum, BenefitType, Percent, MonetaryAmt, TimePeriod, QuantityQualifier, Quantity, CodeNum, CoverageLevel,
             SecDateTEntry, SecDateTEdit, CodeGroupNum, TreatArea, ToothRange, created_at, updated_at
      FROM benefit
      WHERE BenefitNum = ?
    `;
    const records = await executeQuery<Benefit[]>(selectQuery, [id]);

    const response: ApiResponse<Benefit> = {
      success: true,
      data: mapBenefit(records[0]),
      message: 'Benefit updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT benefit:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteBenefit(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT BenefitNum FROM benefit WHERE BenefitNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Benefit not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM benefit WHERE BenefitNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Benefit deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE benefit:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}


// ========================================
// BRANDING HANDLERS
// ========================================

function mapBranding(record: any): Branding {
  return {
    ...record,
    BrandingNum: Number(record.BrandingNum),
    BrandingType: Number(record.BrandingType) as BrandingType,
    ClinicNum: record.ClinicNum !== null ? Number(record.ClinicNum) : undefined,
    ValueString: record.ValueString ?? undefined,
    DateTimeUpdated: record.DateTimeUpdated ?? undefined,
  };
}

function validateBrandingPayload(
  data: CreateBrandingRequest | UpdateBrandingRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).BrandingType !== undefined, 'BrandingType is required');
  checkNum((data as any).ClinicNum, 'ClinicNum');

  if ((data as any).BrandingType !== undefined) {
    const n = Number((data as any).BrandingType);
    if (n < BrandingType.None || n > BrandingType.OfficeDescription) {
      errors.push('BrandingType out of range');
    }
  }

  return errors;
}

async function handleGetBrandings(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT BrandingNum, BrandingType, ClinicNum, ValueString, DateTimeUpdated, created_at, updated_at
      FROM branding
      ORDER BY BrandingNum DESC
    `;
    const results = await executeQuery<Branding[]>(query);
    const mapped = results.map(mapBranding);
    const response: ApiResponse<Branding[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET branding:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetBranding(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT BrandingNum, BrandingType, ClinicNum, ValueString, DateTimeUpdated, created_at, updated_at
      FROM branding
      WHERE BrandingNum = ?
    `;
    const results = await executeQuery<Branding[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Branding not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Branding> = { success: true, data: mapBranding(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET branding by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostBranding(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateBrandingRequest = JSON.parse(event.body);
    const errors = validateBrandingPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO branding
      (BrandingType, ClinicNum, ValueString, DateTimeUpdated)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.BrandingType,
      data.ClinicNum ?? 0,
      data.ValueString ?? null,
      data.DateTimeUpdated ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT BrandingNum, BrandingType, ClinicNum, ValueString, DateTimeUpdated, created_at, updated_at
      FROM branding
      WHERE BrandingNum = ?
    `;
    const records = await executeQuery<Branding[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Branding> = {
      success: true,
      data: mapBranding(records[0]),
      message: 'Branding created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST branding:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutBranding(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT BrandingNum FROM branding WHERE BrandingNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Branding not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateBrandingRequest = JSON.parse(event.body);
    const errors = validateBrandingPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.BrandingType !== undefined) { updateFields.push('BrandingType = ?'); updateParams.push(data.BrandingType); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum ?? 0); }
    if (data.ValueString !== undefined) { updateFields.push('ValueString = ?'); updateParams.push(data.ValueString ?? null); }
    if (data.DateTimeUpdated !== undefined) { updateFields.push('DateTimeUpdated = ?'); updateParams.push(data.DateTimeUpdated ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE branding
      SET ${updateFields.join(', ')}
      WHERE BrandingNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT BrandingNum, BrandingType, ClinicNum, ValueString, DateTimeUpdated, created_at, updated_at
      FROM branding
      WHERE BrandingNum = ?
    `;
    const records = await executeQuery<Branding[]>(selectQuery, [id]);

    const response: ApiResponse<Branding> = {
      success: true,
      data: mapBranding(records[0]),
      message: 'Branding updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT branding:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteBranding(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT BrandingNum FROM branding WHERE BrandingNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Branding not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM branding WHERE BrandingNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Branding deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE branding:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CANADIAN NETWORK HANDLERS
// ========================================

function mapCanadianNetwork(record: any): CanadianNetwork {
  return {
    ...record,
    CanadianNetworkNum: Number(record.CanadianNetworkNum),
    CanadianIsRprHandler: Boolean(record.CanadianIsRprHandler),
  };
}

function validateCanadianNetworkPayload(
  data: CreateCanadianNetworkRequest | UpdateCanadianNetworkRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need((data as any).Abbrev !== undefined, 'Abbrev is required');
  need((data as any).Descript !== undefined, 'Descript is required');

  if (data.Abbrev !== undefined && data.Abbrev.trim() === '') errors.push('Abbrev cannot be blank');
  if (data.Descript !== undefined && data.Descript.trim() === '') errors.push('Descript cannot be blank');

  return errors;
}

async function handleGetCanadianNetworks(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CanadianNetworkNum, Abbrev, Descript, CanadianTransactionPrefix, CanadianIsRprHandler, created_at, updated_at
      FROM canadiannetwork
      ORDER BY CanadianNetworkNum ASC
    `;
    const results = await executeQuery<CanadianNetwork[]>(query);
    const mapped = results.map(mapCanadianNetwork);
    const response: ApiResponse<CanadianNetwork[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET canadiannetwork:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCanadianNetwork(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CanadianNetworkNum, Abbrev, Descript, CanadianTransactionPrefix, CanadianIsRprHandler, created_at, updated_at
      FROM canadiannetwork
      WHERE CanadianNetworkNum = ?
    `;
    const results = await executeQuery<CanadianNetwork[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'CanadianNetwork not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<CanadianNetwork> = { success: true, data: mapCanadianNetwork(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET canadiannetwork by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCanadianNetwork(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCanadianNetworkRequest = JSON.parse(event.body);
    const errors = validateCanadianNetworkPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO canadiannetwork
      (Abbrev, Descript, CanadianTransactionPrefix, CanadianIsRprHandler)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.Abbrev.trim(),
      data.Descript.trim(),
      data.CanadianTransactionPrefix ?? null,
      data.CanadianIsRprHandler ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CanadianNetworkNum, Abbrev, Descript, CanadianTransactionPrefix, CanadianIsRprHandler, created_at, updated_at
      FROM canadiannetwork
      WHERE CanadianNetworkNum = ?
    `;
    const records = await executeQuery<CanadianNetwork[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<CanadianNetwork> = {
      success: true,
      data: mapCanadianNetwork(records[0]),
      message: 'CanadianNetwork created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST canadiannetwork:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCanadianNetwork(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CanadianNetworkNum FROM canadiannetwork WHERE CanadianNetworkNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CanadianNetwork not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCanadianNetworkRequest = JSON.parse(event.body);
    const errors = validateCanadianNetworkPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Abbrev !== undefined) { updateFields.push('Abbrev = ?'); updateParams.push(data.Abbrev.trim()); }
    if (data.Descript !== undefined) { updateFields.push('Descript = ?'); updateParams.push(data.Descript.trim()); }
    if (data.CanadianTransactionPrefix !== undefined) { updateFields.push('CanadianTransactionPrefix = ?'); updateParams.push(data.CanadianTransactionPrefix ?? null); }
    if (data.CanadianIsRprHandler !== undefined) { updateFields.push('CanadianIsRprHandler = ?'); updateParams.push(data.CanadianIsRprHandler ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE canadiannetwork
      SET ${updateFields.join(', ')}
      WHERE CanadianNetworkNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CanadianNetworkNum, Abbrev, Descript, CanadianTransactionPrefix, CanadianIsRprHandler, created_at, updated_at
      FROM canadiannetwork
      WHERE CanadianNetworkNum = ?
    `;
    const records = await executeQuery<CanadianNetwork[]>(selectQuery, [id]);

    const response: ApiResponse<CanadianNetwork> = {
      success: true,
      data: mapCanadianNetwork(records[0]),
      message: 'CanadianNetwork updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT canadiannetwork:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCanadianNetwork(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CanadianNetworkNum FROM canadiannetwork WHERE CanadianNetworkNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CanadianNetwork not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM canadiannetwork WHERE CanadianNetworkNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'CanadianNetwork deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE canadiannetwork:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CARRIER HANDLERS
// ========================================

function mapCarrier(record: any): Carrier {
  return {
    ...record,
    CarrierNum: Number(record.CarrierNum),
    NoSendElect: record.NoSendElect !== null ? Number(record.NoSendElect) as NoSendElectType : undefined,
    IsCDA: Boolean(record.IsCDA),
    CanadianNetworkNum: record.CanadianNetworkNum !== null ? Number(record.CanadianNetworkNum) : undefined,
    IsHidden: Boolean(record.IsHidden),
    CanadianEncryptionMethod: record.CanadianEncryptionMethod !== null ? Number(record.CanadianEncryptionMethod) : undefined,
    CanadianSupportedTypes: record.CanadianSupportedTypes !== null ? Number(record.CanadianSupportedTypes) : undefined,
    SecUserNumEntry: record.SecUserNumEntry !== null ? Number(record.SecUserNumEntry) : undefined,
    CarrierGroupName: record.CarrierGroupName !== null ? Number(record.CarrierGroupName) : undefined,
    ApptTextBackColor: record.ApptTextBackColor !== null ? Number(record.ApptTextBackColor) : undefined,
    IsCoinsuranceInverted: Boolean(record.IsCoinsuranceInverted),
    TrustedEtransFlags: record.TrustedEtransFlags !== null ? Number(record.TrustedEtransFlags) as TrustedEtransTypes : undefined,
    CobInsPaidBehaviorOverride: record.CobInsPaidBehaviorOverride !== null ? Number(record.CobInsPaidBehaviorOverride) as EclaimCobInsPaidBehavior : undefined,
    EraAutomationOverride: record.EraAutomationOverride !== null ? Number(record.EraAutomationOverride) as EraAutomationMode : undefined,
    OrthoInsPayConsolidate: record.OrthoInsPayConsolidate !== null ? Number(record.OrthoInsPayConsolidate) as EnumOrthoInsPayConsolidate : undefined,
    PaySuiteTransSup: record.PaySuiteTransSup !== null ? Number(record.PaySuiteTransSup) as EnumPaySuiteTransTypes : undefined,
  };
}

function validateCarrierPayload(
  data: CreateCarrierRequest | UpdateCarrierRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).CarrierName !== undefined, 'CarrierName is required');
  if (data.CarrierName !== undefined && data.CarrierName.trim() === '') errors.push('CarrierName cannot be blank');

  if ((data as any).NoSendElect !== undefined) {
    const n = Number((data as any).NoSendElect);
    if (n < NoSendElectType.SendElect || n > NoSendElectType.NoSendSecondaryElect) errors.push('NoSendElect must be 0,1,2');
  }
  if ((data as any).TrustedEtransFlags !== undefined) {
    const n = Number((data as any).TrustedEtransFlags);
    if (n < TrustedEtransTypes.None || n > TrustedEtransTypes.RealTimeEligibility) errors.push('TrustedEtransFlags out of range');
  }
  if ((data as any).CobInsPaidBehaviorOverride !== undefined) {
    const n = Number((data as any).CobInsPaidBehaviorOverride);
    if (n < EclaimCobInsPaidBehavior.Default || n > EclaimCobInsPaidBehavior.Both) errors.push('CobInsPaidBehaviorOverride out of range');
  }
  if ((data as any).EraAutomationOverride !== undefined) {
    const n = Number((data as any).EraAutomationOverride);
    if (n < EraAutomationMode.UseGlobal || n > EraAutomationMode.FullyAutomatic) errors.push('EraAutomationOverride out of range');
  }
  if ((data as any).OrthoInsPayConsolidate !== undefined) {
    const n = Number((data as any).OrthoInsPayConsolidate);
    if (n < EnumOrthoInsPayConsolidate.Global || n > EnumOrthoInsPayConsolidate.ForceConsolidateOff) errors.push('OrthoInsPayConsolidate out of range');
  }
  if ((data as any).PaySuiteTransSup !== undefined) {
    const n = Number((data as any).PaySuiteTransSup);
    if (n < EnumPaySuiteTransTypes.None || n > EnumPaySuiteTransTypes.Both) errors.push('PaySuiteTransSup out of range');
  }

  checkNum((data as any).CanadianNetworkNum, 'CanadianNetworkNum');
  checkNum((data as any).CarrierGroupName, 'CarrierGroupName');
  checkNum((data as any).ApptTextBackColor, 'ApptTextBackColor');
  checkNum((data as any).SecUserNumEntry, 'SecUserNumEntry');

  return errors;
}

async function handleGetCarriers(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CarrierNum, CarrierName, Address, Address2, City, State, Zip, Phone, ElectID, NoSendElect, IsCDA, CDAnetVersion, CanadianNetworkNum, IsHidden,
             CanadianEncryptionMethod, CanadianSupportedTypes, SecUserNumEntry, SecDateEntry, SecDateTEdit, TIN, CarrierGroupName, ApptTextBackColor,
             IsCoinsuranceInverted, TrustedEtransFlags, CobInsPaidBehaviorOverride, EraAutomationOverride, OrthoInsPayConsolidate, PaySuiteTransSup,
             created_at, updated_at
      FROM carrier
      ORDER BY CarrierName ASC, CarrierNum ASC
    `;
    const results = await executeQuery<Carrier[]>(query);
    const mapped = results.map(mapCarrier);
    const response: ApiResponse<Carrier[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET carrier:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCarrier(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CarrierNum, CarrierName, Address, Address2, City, State, Zip, Phone, ElectID, NoSendElect, IsCDA, CDAnetVersion, CanadianNetworkNum, IsHidden,
             CanadianEncryptionMethod, CanadianSupportedTypes, SecUserNumEntry, SecDateEntry, SecDateTEdit, TIN, CarrierGroupName, ApptTextBackColor,
             IsCoinsuranceInverted, TrustedEtransFlags, CobInsPaidBehaviorOverride, EraAutomationOverride, OrthoInsPayConsolidate, PaySuiteTransSup,
             created_at, updated_at
      FROM carrier
      WHERE CarrierNum = ?
    `;
    const results = await executeQuery<Carrier[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Carrier not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Carrier> = { success: true, data: mapCarrier(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET carrier by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCarrier(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCarrierRequest = JSON.parse(event.body);
    const errors = validateCarrierPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO carrier
      (CarrierName, Address, Address2, City, State, Zip, Phone, ElectID, NoSendElect, IsCDA, CDAnetVersion, CanadianNetworkNum, IsHidden,
       CanadianEncryptionMethod, CanadianSupportedTypes, SecUserNumEntry, SecDateEntry, TIN, CarrierGroupName, ApptTextBackColor, IsCoinsuranceInverted,
       TrustedEtransFlags, CobInsPaidBehaviorOverride, EraAutomationOverride, OrthoInsPayConsolidate, PaySuiteTransSup)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.CarrierName.trim(),
      data.Address ?? null,
      data.Address2 ?? null,
      data.City ?? null,
      data.State ?? null,
      data.Zip ?? null,
      data.Phone ?? null,
      data.ElectID ?? null,
      data.NoSendElect ?? NoSendElectType.SendElect,
      data.IsCDA ? 1 : 0,
      data.CDAnetVersion ?? null,
      data.CanadianNetworkNum ?? 0,
      data.IsHidden ? 1 : 0,
      data.CanadianEncryptionMethod ?? 1,
      data.CanadianSupportedTypes ?? 0,
      data.SecUserNumEntry ?? 0,
      data.SecDateEntry ?? null,
      data.TIN ?? null,
      data.CarrierGroupName ?? 0,
      data.ApptTextBackColor ?? 0,
      data.IsCoinsuranceInverted ? 1 : 0,
      data.TrustedEtransFlags ?? TrustedEtransTypes.None,
      data.CobInsPaidBehaviorOverride ?? EclaimCobInsPaidBehavior.Default,
      data.EraAutomationOverride ?? EraAutomationMode.UseGlobal,
      data.OrthoInsPayConsolidate ?? EnumOrthoInsPayConsolidate.Global,
      data.PaySuiteTransSup ?? EnumPaySuiteTransTypes.None,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CarrierNum, CarrierName, Address, Address2, City, State, Zip, Phone, ElectID, NoSendElect, IsCDA, CDAnetVersion, CanadianNetworkNum, IsHidden,
             CanadianEncryptionMethod, CanadianSupportedTypes, SecUserNumEntry, SecDateEntry, SecDateTEdit, TIN, CarrierGroupName, ApptTextBackColor,
             IsCoinsuranceInverted, TrustedEtransFlags, CobInsPaidBehaviorOverride, EraAutomationOverride, OrthoInsPayConsolidate, PaySuiteTransSup,
             created_at, updated_at
      FROM carrier
      WHERE CarrierNum = ?
    `;
    const records = await executeQuery<Carrier[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Carrier> = {
      success: true,
      data: mapCarrier(records[0]),
      message: 'Carrier created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST carrier:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCarrier(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CarrierNum FROM carrier WHERE CarrierNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Carrier not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCarrierRequest = JSON.parse(event.body);
    const errors = validateCarrierPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.CarrierName !== undefined) { updateFields.push('CarrierName = ?'); updateParams.push(data.CarrierName.trim()); }
    if (data.Address !== undefined) { updateFields.push('Address = ?'); updateParams.push(data.Address ?? null); }
    if (data.Address2 !== undefined) { updateFields.push('Address2 = ?'); updateParams.push(data.Address2 ?? null); }
    if (data.City !== undefined) { updateFields.push('City = ?'); updateParams.push(data.City ?? null); }
    if (data.State !== undefined) { updateFields.push('State = ?'); updateParams.push(data.State ?? null); }
    if (data.Zip !== undefined) { updateFields.push('Zip = ?'); updateParams.push(data.Zip ?? null); }
    if (data.Phone !== undefined) { updateFields.push('Phone = ?'); updateParams.push(data.Phone ?? null); }
    if (data.ElectID !== undefined) { updateFields.push('ElectID = ?'); updateParams.push(data.ElectID ?? null); }
    if (data.NoSendElect !== undefined) { updateFields.push('NoSendElect = ?'); updateParams.push(data.NoSendElect); }
    if (data.IsCDA !== undefined) { updateFields.push('IsCDA = ?'); updateParams.push(data.IsCDA ? 1 : 0); }
    if (data.CDAnetVersion !== undefined) { updateFields.push('CDAnetVersion = ?'); updateParams.push(data.CDAnetVersion ?? null); }
    if (data.CanadianNetworkNum !== undefined) { updateFields.push('CanadianNetworkNum = ?'); updateParams.push(data.CanadianNetworkNum ?? 0); }
    if (data.IsHidden !== undefined) { updateFields.push('IsHidden = ?'); updateParams.push(data.IsHidden ? 1 : 0); }
    if (data.CanadianEncryptionMethod !== undefined) { updateFields.push('CanadianEncryptionMethod = ?'); updateParams.push(data.CanadianEncryptionMethod ?? 1); }
    if (data.CanadianSupportedTypes !== undefined) { updateFields.push('CanadianSupportedTypes = ?'); updateParams.push(data.CanadianSupportedTypes ?? 0); }
    if (data.SecUserNumEntry !== undefined) { updateFields.push('SecUserNumEntry = ?'); updateParams.push(data.SecUserNumEntry ?? 0); }
    if (data.SecDateEntry !== undefined) { updateFields.push('SecDateEntry = ?'); updateParams.push(data.SecDateEntry ?? null); }
    if (data.TIN !== undefined) { updateFields.push('TIN = ?'); updateParams.push(data.TIN ?? null); }
    if (data.CarrierGroupName !== undefined) { updateFields.push('CarrierGroupName = ?'); updateParams.push(data.CarrierGroupName ?? 0); }
    if (data.ApptTextBackColor !== undefined) { updateFields.push('ApptTextBackColor = ?'); updateParams.push(data.ApptTextBackColor ?? 0); }
    if (data.IsCoinsuranceInverted !== undefined) { updateFields.push('IsCoinsuranceInverted = ?'); updateParams.push(data.IsCoinsuranceInverted ? 1 : 0); }
    if (data.TrustedEtransFlags !== undefined) { updateFields.push('TrustedEtransFlags = ?'); updateParams.push(data.TrustedEtransFlags ?? TrustedEtransTypes.None); }
    if (data.CobInsPaidBehaviorOverride !== undefined) { updateFields.push('CobInsPaidBehaviorOverride = ?'); updateParams.push(data.CobInsPaidBehaviorOverride ?? EclaimCobInsPaidBehavior.Default); }
    if (data.EraAutomationOverride !== undefined) { updateFields.push('EraAutomationOverride = ?'); updateParams.push(data.EraAutomationOverride ?? EraAutomationMode.UseGlobal); }
    if (data.OrthoInsPayConsolidate !== undefined) { updateFields.push('OrthoInsPayConsolidate = ?'); updateParams.push(data.OrthoInsPayConsolidate ?? EnumOrthoInsPayConsolidate.Global); }
    if (data.PaySuiteTransSup !== undefined) { updateFields.push('PaySuiteTransSup = ?'); updateParams.push(data.PaySuiteTransSup ?? EnumPaySuiteTransTypes.None); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE carrier
      SET ${updateFields.join(', ')}
      WHERE CarrierNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CarrierNum, CarrierName, Address, Address2, City, State, Zip, Phone, ElectID, NoSendElect, IsCDA, CDAnetVersion, CanadianNetworkNum, IsHidden,
             CanadianEncryptionMethod, CanadianSupportedTypes, SecUserNumEntry, SecDateEntry, SecDateTEdit, TIN, CarrierGroupName, ApptTextBackColor,
             IsCoinsuranceInverted, TrustedEtransFlags, CobInsPaidBehaviorOverride, EraAutomationOverride, OrthoInsPayConsolidate, PaySuiteTransSup,
             created_at, updated_at
      FROM carrier
      WHERE CarrierNum = ?
    `;
    const records = await executeQuery<Carrier[]>(selectQuery, [id]);

    const response: ApiResponse<Carrier> = {
      success: true,
      data: mapCarrier(records[0]),
      message: 'Carrier updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT carrier:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCarrier(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CarrierNum FROM carrier WHERE CarrierNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Carrier not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM carrier WHERE CarrierNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Carrier deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE carrier:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CDCREC HANDLERS
// ========================================

function mapCdcrec(record: any): Cdcrec {
  return {
    ...record,
    CdcrecNum: Number(record.CdcrecNum),
  };
}

function validateCdcrecPayload(
  data: CreateCdcrecRequest | UpdateCdcrecRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need((data as any).CdcrecCode !== undefined, 'CdcrecCode is required');
  need((data as any).HeirarchicalCode !== undefined, 'HeirarchicalCode is required');
  need((data as any).Description !== undefined, 'Description is required');

  if (data.CdcrecCode !== undefined && data.CdcrecCode.trim() === '') errors.push('CdcrecCode cannot be blank');
  if (data.HeirarchicalCode !== undefined && data.HeirarchicalCode.trim() === '') errors.push('HeirarchicalCode cannot be blank');
  if (data.Description !== undefined && data.Description.trim() === '') errors.push('Description cannot be blank');

  return errors;
}

async function handleGetCdcrecs(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CdcrecNum, CdcrecCode, HeirarchicalCode, Description, created_at, updated_at
      FROM cdcrec
      ORDER BY CdcrecNum ASC
    `;
    const results = await executeQuery<Cdcrec[]>(query);
    const mapped = results.map(mapCdcrec);
    const response: ApiResponse<Cdcrec[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET cdcrec:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCdcrec(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CdcrecNum, CdcrecCode, HeirarchicalCode, Description, created_at, updated_at
      FROM cdcrec
      WHERE CdcrecNum = ?
    `;
    const results = await executeQuery<Cdcrec[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Cdcrec not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Cdcrec> = { success: true, data: mapCdcrec(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET cdcrec by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCdcrec(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCdcrecRequest = JSON.parse(event.body);
    const errors = validateCdcrecPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO cdcrec
      (CdcrecCode, HeirarchicalCode, Description)
      VALUES (?, ?, ?)
    `;
    const params = [
      data.CdcrecCode.trim(),
      data.HeirarchicalCode.trim(),
      data.Description.trim(),
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CdcrecNum, CdcrecCode, HeirarchicalCode, Description, created_at, updated_at
      FROM cdcrec
      WHERE CdcrecNum = ?
    `;
    const records = await executeQuery<Cdcrec[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Cdcrec> = {
      success: true,
      data: mapCdcrec(records[0]),
      message: 'Cdcrec created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST cdcrec:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCdcrec(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CdcrecNum FROM cdcrec WHERE CdcrecNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Cdcrec not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCdcrecRequest = JSON.parse(event.body);
    const errors = validateCdcrecPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.CdcrecCode !== undefined) { updateFields.push('CdcrecCode = ?'); updateParams.push(data.CdcrecCode.trim()); }
    if (data.HeirarchicalCode !== undefined) { updateFields.push('HeirarchicalCode = ?'); updateParams.push(data.HeirarchicalCode.trim()); }
    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE cdcrec
      SET ${updateFields.join(', ')}
      WHERE CdcrecNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CdcrecNum, CdcrecCode, HeirarchicalCode, Description, created_at, updated_at
      FROM cdcrec
      WHERE CdcrecNum = ?
    `;
    const records = await executeQuery<Cdcrec[]>(selectQuery, [id]);

    const response: ApiResponse<Cdcrec> = {
      success: true,
      data: mapCdcrec(records[0]),
      message: 'Cdcrec updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT cdcrec:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCdcrec(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CdcrecNum FROM cdcrec WHERE CdcrecNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Cdcrec not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM cdcrec WHERE CdcrecNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Cdcrec deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE cdcrec:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CDS PERMISSION HANDLERS
// ========================================

function mapCdsPermission(record: any): CdsPermission {
  return {
    ...record,
    CDSPermissionNum: Number(record.CDSPermissionNum),
    UserNum: Number(record.UserNum),
    SetupCDS: Boolean(record.SetupCDS),
    ShowCDS: Boolean(record.ShowCDS),
    ShowInfobutton: Boolean(record.ShowInfobutton),
    EditBibliography: Boolean(record.EditBibliography),
    ProblemCDS: Boolean(record.ProblemCDS),
    MedicationCDS: Boolean(record.MedicationCDS),
    AllergyCDS: Boolean(record.AllergyCDS),
    DemographicCDS: Boolean(record.DemographicCDS),
    LabTestCDS: Boolean(record.LabTestCDS),
    VitalCDS: Boolean(record.VitalCDS),
  };
}

function validateCdsPermissionPayload(
  data: CreateCdsPermissionRequest | UpdateCdsPermissionRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkPos = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  need((data as any).UserNum !== undefined, 'UserNum is required');
  checkPos((data as any).UserNum, 'UserNum');

  return errors;
}

async function handleGetCdsPermissions(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CDSPermissionNum, UserNum, SetupCDS, ShowCDS, ShowInfobutton, EditBibliography, ProblemCDS, MedicationCDS, AllergyCDS, DemographicCDS, LabTestCDS, VitalCDS, created_at, updated_at
      FROM cdspermission
      ORDER BY CDSPermissionNum ASC
    `;
    const results = await executeQuery<CdsPermission[]>(query);
    const mapped = results.map(mapCdsPermission);
    const response: ApiResponse<CdsPermission[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET cdspermission:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCdsPermission(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CDSPermissionNum, UserNum, SetupCDS, ShowCDS, ShowInfobutton, EditBibliography, ProblemCDS, MedicationCDS, AllergyCDS, DemographicCDS, LabTestCDS, VitalCDS, created_at, updated_at
      FROM cdspermission
      WHERE CDSPermissionNum = ?
    `;
    const results = await executeQuery<CdsPermission[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'CdsPermission not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<CdsPermission> = { success: true, data: mapCdsPermission(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET cdspermission by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCdsPermission(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCdsPermissionRequest = JSON.parse(event.body);
    const errors = validateCdsPermissionPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO cdspermission
      (UserNum, SetupCDS, ShowCDS, ShowInfobutton, EditBibliography, ProblemCDS, MedicationCDS, AllergyCDS, DemographicCDS, LabTestCDS, VitalCDS)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.UserNum,
      data.SetupCDS ? 1 : 0,
      data.ShowCDS ? 1 : 0,
      data.ShowInfobutton ? 1 : 0,
      data.EditBibliography ? 1 : 0,
      data.ProblemCDS ? 1 : 0,
      data.MedicationCDS ? 1 : 0,
      data.AllergyCDS ? 1 : 0,
      data.DemographicCDS ? 1 : 0,
      data.LabTestCDS ? 1 : 0,
      data.VitalCDS ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CDSPermissionNum, UserNum, SetupCDS, ShowCDS, ShowInfobutton, EditBibliography, ProblemCDS, MedicationCDS, AllergyCDS, DemographicCDS, LabTestCDS, VitalCDS, created_at, updated_at
      FROM cdspermission
      WHERE CDSPermissionNum = ?
    `;
    const records = await executeQuery<CdsPermission[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<CdsPermission> = {
      success: true,
      data: mapCdsPermission(records[0]),
      message: 'CdsPermission created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST cdspermission:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCdsPermission(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CDSPermissionNum FROM cdspermission WHERE CDSPermissionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CdsPermission not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCdsPermissionRequest = JSON.parse(event.body);
    const errors = validateCdsPermissionPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }
    if (data.SetupCDS !== undefined) { updateFields.push('SetupCDS = ?'); updateParams.push(data.SetupCDS ? 1 : 0); }
    if (data.ShowCDS !== undefined) { updateFields.push('ShowCDS = ?'); updateParams.push(data.ShowCDS ? 1 : 0); }
    if (data.ShowInfobutton !== undefined) { updateFields.push('ShowInfobutton = ?'); updateParams.push(data.ShowInfobutton ? 1 : 0); }
    if (data.EditBibliography !== undefined) { updateFields.push('EditBibliography = ?'); updateParams.push(data.EditBibliography ? 1 : 0); }
    if (data.ProblemCDS !== undefined) { updateFields.push('ProblemCDS = ?'); updateParams.push(data.ProblemCDS ? 1 : 0); }
    if (data.MedicationCDS !== undefined) { updateFields.push('MedicationCDS = ?'); updateParams.push(data.MedicationCDS ? 1 : 0); }
    if (data.AllergyCDS !== undefined) { updateFields.push('AllergyCDS = ?'); updateParams.push(data.AllergyCDS ? 1 : 0); }
    if (data.DemographicCDS !== undefined) { updateFields.push('DemographicCDS = ?'); updateParams.push(data.DemographicCDS ? 1 : 0); }
    if (data.LabTestCDS !== undefined) { updateFields.push('LabTestCDS = ?'); updateParams.push(data.LabTestCDS ? 1 : 0); }
    if (data.VitalCDS !== undefined) { updateFields.push('VitalCDS = ?'); updateParams.push(data.VitalCDS ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE cdspermission
      SET ${updateFields.join(', ')}
      WHERE CDSPermissionNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CDSPermissionNum, UserNum, SetupCDS, ShowCDS, ShowInfobutton, EditBibliography, ProblemCDS, MedicationCDS, AllergyCDS, DemographicCDS, LabTestCDS, VitalCDS, created_at, updated_at
      FROM cdspermission
      WHERE CDSPermissionNum = ?
    `;
    const records = await executeQuery<CdsPermission[]>(selectQuery, [id]);

    const response: ApiResponse<CdsPermission> = {
      success: true,
      data: mapCdsPermission(records[0]),
      message: 'CdsPermission updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT cdspermission:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCdsPermission(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CDSPermissionNum FROM cdspermission WHERE CDSPermissionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CdsPermission not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM cdspermission WHERE CDSPermissionNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'CdsPermission deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE cdspermission:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CENTRAL CONNECTION HANDLERS
// ========================================

function mapCentralConnection(record: any): CentralConnection {
  return {
    ...record,
    CentralConnectionNum: Number(record.CentralConnectionNum),
    ItemOrder: record.ItemOrder !== null ? Number(record.ItemOrder) : undefined,
    WebServiceIsEcw: Boolean(record.WebServiceIsEcw),
    HasClinicBreakdownReports: Boolean(record.HasClinicBreakdownReports),
  };
}

function validateCentralConnectionPayload(
  data: CreateCentralConnectionRequest | UpdateCentralConnectionRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, allowZero = true) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || (!allowZero && n <= 0)) errors.push(`${name} must be a valid number`);
  };

  need((data as any).ServerName !== undefined || (data as any).ServiceURI !== undefined, 'ServerName or ServiceURI is required');

  if (data.ServerName !== undefined && data.ServerName.trim() === '' && data.ServiceURI === undefined) errors.push('ServerName cannot be blank if provided');
  if (data.ServiceURI !== undefined && data.ServiceURI.trim() === '') errors.push('ServiceURI cannot be blank');
  if (data.DatabaseName !== undefined && data.DatabaseName.trim() === '') errors.push('DatabaseName cannot be blank');
  if (data.MySqlUser !== undefined && data.MySqlUser.trim() === '') errors.push('MySqlUser cannot be blank');

  checkNum((data as any).ItemOrder, 'ItemOrder', true);

  return errors;
}

async function handleGetCentralConnections(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CentralConnectionNum, ServerName, DatabaseName, MySqlUser, MySqlPassword, ServiceURI, OdUser, OdPassword, Note, ItemOrder, WebServiceIsEcw, ConnectionStatus, HasClinicBreakdownReports, created_at, updated_at
      FROM centralconnection
      ORDER BY ItemOrder ASC, CentralConnectionNum ASC
    `;
    const results = await executeQuery<CentralConnection[]>(query);
    const mapped = results.map(mapCentralConnection);
    const response: ApiResponse<CentralConnection[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET centralconnection:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCentralConnection(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CentralConnectionNum, ServerName, DatabaseName, MySqlUser, MySqlPassword, ServiceURI, OdUser, OdPassword, Note, ItemOrder, WebServiceIsEcw, ConnectionStatus, HasClinicBreakdownReports, created_at, updated_at
      FROM centralconnection
      WHERE CentralConnectionNum = ?
    `;
    const results = await executeQuery<CentralConnection[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'CentralConnection not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<CentralConnection> = { success: true, data: mapCentralConnection(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET centralconnection by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCentralConnection(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCentralConnectionRequest = JSON.parse(event.body);
    const errors = validateCentralConnectionPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO centralconnection
      (ServerName, DatabaseName, MySqlUser, MySqlPassword, ServiceURI, OdUser, OdPassword, Note, ItemOrder, WebServiceIsEcw, ConnectionStatus, HasClinicBreakdownReports)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ServerName ?? null,
      data.DatabaseName ?? null,
      data.MySqlUser ?? null,
      data.MySqlPassword ?? null,
      data.ServiceURI ?? null,
      data.OdUser ?? null,
      data.OdPassword ?? null,
      data.Note ?? null,
      data.ItemOrder ?? 0,
      data.WebServiceIsEcw ? 1 : 0,
      data.ConnectionStatus ?? null,
      data.HasClinicBreakdownReports ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CentralConnectionNum, ServerName, DatabaseName, MySqlUser, MySqlPassword, ServiceURI, OdUser, OdPassword, Note, ItemOrder, WebServiceIsEcw, ConnectionStatus, HasClinicBreakdownReports, created_at, updated_at
      FROM centralconnection
      WHERE CentralConnectionNum = ?
    `;
    const records = await executeQuery<CentralConnection[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<CentralConnection> = {
      success: true,
      data: mapCentralConnection(records[0]),
      message: 'CentralConnection created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST centralconnection:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCentralConnection(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CentralConnectionNum FROM centralconnection WHERE CentralConnectionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CentralConnection not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCentralConnectionRequest = JSON.parse(event.body);
    const errors = validateCentralConnectionPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ServerName !== undefined) { updateFields.push('ServerName = ?'); updateParams.push(data.ServerName ?? null); }
    if (data.DatabaseName !== undefined) { updateFields.push('DatabaseName = ?'); updateParams.push(data.DatabaseName ?? null); }
    if (data.MySqlUser !== undefined) { updateFields.push('MySqlUser = ?'); updateParams.push(data.MySqlUser ?? null); }
    if (data.MySqlPassword !== undefined) { updateFields.push('MySqlPassword = ?'); updateParams.push(data.MySqlPassword ?? null); }
    if (data.ServiceURI !== undefined) { updateFields.push('ServiceURI = ?'); updateParams.push(data.ServiceURI ?? null); }
    if (data.OdUser !== undefined) { updateFields.push('OdUser = ?'); updateParams.push(data.OdUser ?? null); }
    if (data.OdPassword !== undefined) { updateFields.push('OdPassword = ?'); updateParams.push(data.OdPassword ?? null); }
    if (data.Note !== undefined) { updateFields.push('Note = ?'); updateParams.push(data.Note ?? null); }
    if (data.ItemOrder !== undefined) { updateFields.push('ItemOrder = ?'); updateParams.push(data.ItemOrder ?? 0); }
    if (data.WebServiceIsEcw !== undefined) { updateFields.push('WebServiceIsEcw = ?'); updateParams.push(data.WebServiceIsEcw ? 1 : 0); }
    if (data.ConnectionStatus !== undefined) { updateFields.push('ConnectionStatus = ?'); updateParams.push(data.ConnectionStatus ?? null); }
    if (data.HasClinicBreakdownReports !== undefined) { updateFields.push('HasClinicBreakdownReports = ?'); updateParams.push(data.HasClinicBreakdownReports ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE centralconnection
      SET ${updateFields.join(', ')}
      WHERE CentralConnectionNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CentralConnectionNum, ServerName, DatabaseName, MySqlUser, MySqlPassword, ServiceURI, OdUser, OdPassword, Note, ItemOrder, WebServiceIsEcw, ConnectionStatus, HasClinicBreakdownReports, created_at, updated_at
      FROM centralconnection
      WHERE CentralConnectionNum = ?
    `;
    const records = await executeQuery<CentralConnection[]>(selectQuery, [id]);

    const response: ApiResponse<CentralConnection> = {
      success: true,
      data: mapCentralConnection(records[0]),
      message: 'CentralConnection updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT centralconnection:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCentralConnection(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CentralConnectionNum FROM centralconnection WHERE CentralConnectionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CentralConnection not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM centralconnection WHERE CentralConnectionNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'CentralConnection deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE centralconnection:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CERT HANDLERS
// ========================================

function mapCert(record: any): Cert {
  return {
    ...record,
    CertNum: Number(record.CertNum),
    ItemOrder: record.ItemOrder !== null ? Number(record.ItemOrder) : undefined,
    IsHidden: Boolean(record.IsHidden),
    CertCategoryNum: record.CertCategoryNum !== null ? Number(record.CertCategoryNum) : undefined,
  };
}

function validateCertPayload(
  data: CreateCertRequest | UpdateCertRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).Description !== undefined, 'Description is required');
  if (data.Description !== undefined && data.Description.trim() === '') errors.push('Description cannot be blank');

  checkNum((data as any).ItemOrder, 'ItemOrder');
  checkNum((data as any).CertCategoryNum, 'CertCategoryNum');

  return errors;
}

async function handleGetCerts(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CertNum, Description, WikiPageLink, ItemOrder, IsHidden, CertCategoryNum, created_at, updated_at
      FROM cert
      ORDER BY ItemOrder ASC, CertNum ASC
    `;
    const results = await executeQuery<Cert[]>(query);
    const mapped = results.map(mapCert);
    const response: ApiResponse<Cert[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET cert:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCert(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CertNum, Description, WikiPageLink, ItemOrder, IsHidden, CertCategoryNum, created_at, updated_at
      FROM cert
      WHERE CertNum = ?
    `;
    const results = await executeQuery<Cert[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Cert not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Cert> = { success: true, data: mapCert(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET cert by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCert(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCertRequest = JSON.parse(event.body);
    const errors = validateCertPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO cert
      (Description, WikiPageLink, ItemOrder, IsHidden, CertCategoryNum)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      data.Description.trim(),
      data.WikiPageLink ?? null,
      data.ItemOrder ?? 0,
      data.IsHidden ? 1 : 0,
      data.CertCategoryNum ?? 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CertNum, Description, WikiPageLink, ItemOrder, IsHidden, CertCategoryNum, created_at, updated_at
      FROM cert
      WHERE CertNum = ?
    `;
    const records = await executeQuery<Cert[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Cert> = {
      success: true,
      data: mapCert(records[0]),
      message: 'Cert created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST cert:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCert(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CertNum FROM cert WHERE CertNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Cert not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCertRequest = JSON.parse(event.body);
    const errors = validateCertPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.WikiPageLink !== undefined) { updateFields.push('WikiPageLink = ?'); updateParams.push(data.WikiPageLink ?? null); }
    if (data.ItemOrder !== undefined) { updateFields.push('ItemOrder = ?'); updateParams.push(data.ItemOrder ?? 0); }
    if (data.IsHidden !== undefined) { updateFields.push('IsHidden = ?'); updateParams.push(data.IsHidden ? 1 : 0); }
    if (data.CertCategoryNum !== undefined) { updateFields.push('CertCategoryNum = ?'); updateParams.push(data.CertCategoryNum ?? 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE cert
      SET ${updateFields.join(', ')}
      WHERE CertNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CertNum, Description, WikiPageLink, ItemOrder, IsHidden, CertCategoryNum, created_at, updated_at
      FROM cert
      WHERE CertNum = ?
    `;
    const records = await executeQuery<Cert[]>(selectQuery, [id]);

    const response: ApiResponse<Cert> = {
      success: true,
      data: mapCert(records[0]),
      message: 'Cert updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT cert:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCert(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CertNum FROM cert WHERE CertNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Cert not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM cert WHERE CertNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Cert deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE cert:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CERT EMPLOYEE HANDLERS
// ========================================

function mapCertEmployee(record: any): CertEmployee {
  return {
    ...record,
    CertEmployeeNum: Number(record.CertEmployeeNum),
    CertNum: Number(record.CertNum),
    EmployeeNum: Number(record.EmployeeNum),
    UserNum: record.UserNum !== null ? Number(record.UserNum) : undefined,
  };
}

function validateCertEmployeePayload(
  data: CreateCertEmployeeRequest | UpdateCertEmployeeRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkPos = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  need((data as any).CertNum !== undefined, 'CertNum is required');
  need((data as any).EmployeeNum !== undefined, 'EmployeeNum is required');

  checkPos((data as any).CertNum, 'CertNum');
  checkPos((data as any).EmployeeNum, 'EmployeeNum');
  checkPos((data as any).UserNum, 'UserNum');

  if (data.Note !== undefined && data.Note.trim() === '') errors.push('Note cannot be blank');

  return errors;
}

async function handleGetCertEmployees(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CertEmployeeNum, CertNum, EmployeeNum, DateCompleted, Note, UserNum, created_at, updated_at
      FROM certemployee
      ORDER BY CertEmployeeNum ASC
    `;
    const results = await executeQuery<CertEmployee[]>(query);
    const mapped = results.map(mapCertEmployee);
    const response: ApiResponse<CertEmployee[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET certemployee:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetCertEmployee(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT CertEmployeeNum, CertNum, EmployeeNum, DateCompleted, Note, UserNum, created_at, updated_at
      FROM certemployee
      WHERE CertEmployeeNum = ?
    `;
    const results = await executeQuery<CertEmployee[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'CertEmployee not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<CertEmployee> = { success: true, data: mapCertEmployee(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET certemployee by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostCertEmployee(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateCertEmployeeRequest = JSON.parse(event.body);
    const errors = validateCertEmployeePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO certemployee
      (CertNum, EmployeeNum, DateCompleted, Note, UserNum)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      data.CertNum,
      data.EmployeeNum,
      data.DateCompleted ?? null,
      data.Note ?? null,
      data.UserNum ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT CertEmployeeNum, CertNum, EmployeeNum, DateCompleted, Note, UserNum, created_at, updated_at
      FROM certemployee
      WHERE CertEmployeeNum = ?
    `;
    const records = await executeQuery<CertEmployee[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<CertEmployee> = {
      success: true,
      data: mapCertEmployee(records[0]),
      message: 'CertEmployee created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST certemployee:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutCertEmployee(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT CertEmployeeNum FROM certemployee WHERE CertEmployeeNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CertEmployee not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateCertEmployeeRequest = JSON.parse(event.body);
    const errors = validateCertEmployeePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.CertNum !== undefined) { updateFields.push('CertNum = ?'); updateParams.push(data.CertNum); }
    if (data.EmployeeNum !== undefined) { updateFields.push('EmployeeNum = ?'); updateParams.push(data.EmployeeNum); }
    if (data.DateCompleted !== undefined) { updateFields.push('DateCompleted = ?'); updateParams.push(data.DateCompleted ?? null); }
    if (data.Note !== undefined) { updateFields.push('Note = ?'); updateParams.push(data.Note ?? null); }
    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE certemployee
      SET ${updateFields.join(', ')}
      WHERE CertEmployeeNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT CertEmployeeNum, CertNum, EmployeeNum, DateCompleted, Note, UserNum, created_at, updated_at
      FROM certemployee
      WHERE CertEmployeeNum = ?
    `;
    const records = await executeQuery<CertEmployee[]>(selectQuery, [id]);

    const response: ApiResponse<CertEmployee> = {
      success: true,
      data: mapCertEmployee(records[0]),
      message: 'CertEmployee updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT certemployee:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteCertEmployee(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT CertEmployeeNum FROM certemployee WHERE CertEmployeeNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'CertEmployee not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM certemployee WHERE CertEmployeeNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'CertEmployee deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE certemployee:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHARTVIEW HANDLERS
// ========================================

function mapChartView(record: any): ChartView {
  return {
    ...record,
    ChartViewNum: Number(record.ChartViewNum),
    ItemOrder: record.ItemOrder !== null ? Number(record.ItemOrder) : undefined,
    ProcStatuses: record.ProcStatuses !== null ? Number(record.ProcStatuses) as ChartViewProcStat : undefined,
    ObjectTypes: record.ObjectTypes !== null ? Number(record.ObjectTypes) as ChartViewObjs : undefined,
    OrionStatusFlags: record.OrionStatusFlags !== null ? Number(record.OrionStatusFlags) : undefined,
    DatesShowing: record.DatesShowing !== null ? Number(record.DatesShowing) as ChartViewDates : undefined,
    ShowProcNotes: Boolean(record.ShowProcNotes),
    IsAudit: Boolean(record.IsAudit),
    SelectedTeethOnly: Boolean(record.SelectedTeethOnly),
    IsTpCharting: Boolean(record.IsTpCharting),
  };
}

function validateChartViewPayload(
  data: CreateChartViewRequest | UpdateChartViewRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, min?: number, max?: number) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) { errors.push(`${name} must be a number`); return; }
    if (min !== undefined && n < min) errors.push(`${name} must be >= ${min}`);
    if (max !== undefined && n > max) errors.push(`${name} must be <= ${max}`);
  };

  need((data as any).Description !== undefined, 'Description is required');
  if (data.Description !== undefined && data.Description.trim() === '') errors.push('Description cannot be blank');

  checkNum((data as any).ItemOrder, 'ItemOrder');
  checkNum((data as any).ProcStatuses, 'ProcStatuses');
  checkNum((data as any).ObjectTypes, 'ObjectTypes');
  checkNum((data as any).OrionStatusFlags, 'OrionStatusFlags');
  checkNum((data as any).DatesShowing, 'DatesShowing', 0, 4);

  return errors;
}

async function handleGetChartViews(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChartViewNum, Description, ItemOrder, ProcStatuses, ObjectTypes, ShowProcNotes, IsAudit, SelectedTeethOnly, OrionStatusFlags, DatesShowing, IsTpCharting, created_at, updated_at
      FROM chartview
      ORDER BY ItemOrder ASC, ChartViewNum ASC
    `;
    const results = await executeQuery<ChartView[]>(query);
    const mapped = results.map(mapChartView);
    const response: ApiResponse<ChartView[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chartview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChartView(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChartViewNum, Description, ItemOrder, ProcStatuses, ObjectTypes, ShowProcNotes, IsAudit, SelectedTeethOnly, OrionStatusFlags, DatesShowing, IsTpCharting, created_at, updated_at
      FROM chartview
      WHERE ChartViewNum = ?
    `;
    const results = await executeQuery<ChartView[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChartView not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ChartView> = { success: true, data: mapChartView(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chartview by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChartView(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChartViewRequest = JSON.parse(event.body);
    const errors = validateChartViewPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chartview
      (Description, ItemOrder, ProcStatuses, ObjectTypes, ShowProcNotes, IsAudit, SelectedTeethOnly, OrionStatusFlags, DatesShowing, IsTpCharting)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.Description.trim(),
      data.ItemOrder ?? 0,
      data.ProcStatuses ?? ChartViewProcStat.None,
      data.ObjectTypes ?? ChartViewObjs.None,
      data.ShowProcNotes ? 1 : 0,
      data.IsAudit ? 1 : 0,
      data.SelectedTeethOnly ? 1 : 0,
      data.OrionStatusFlags ?? 0,
      data.DatesShowing ?? ChartViewDates.All,
      data.IsTpCharting ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChartViewNum, Description, ItemOrder, ProcStatuses, ObjectTypes, ShowProcNotes, IsAudit, SelectedTeethOnly, OrionStatusFlags, DatesShowing, IsTpCharting, created_at, updated_at
      FROM chartview
      WHERE ChartViewNum = ?
    `;
    const records = await executeQuery<ChartView[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ChartView> = {
      success: true,
      data: mapChartView(records[0]),
      message: 'ChartView created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chartview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChartView(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChartViewNum FROM chartview WHERE ChartViewNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChartView not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChartViewRequest = JSON.parse(event.body);
    const errors = validateChartViewPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.ItemOrder !== undefined) { updateFields.push('ItemOrder = ?'); updateParams.push(data.ItemOrder ?? 0); }
    if (data.ProcStatuses !== undefined) { updateFields.push('ProcStatuses = ?'); updateParams.push(data.ProcStatuses ?? ChartViewProcStat.None); }
    if (data.ObjectTypes !== undefined) { updateFields.push('ObjectTypes = ?'); updateParams.push(data.ObjectTypes ?? ChartViewObjs.None); }
    if (data.ShowProcNotes !== undefined) { updateFields.push('ShowProcNotes = ?'); updateParams.push(data.ShowProcNotes ? 1 : 0); }
    if (data.IsAudit !== undefined) { updateFields.push('IsAudit = ?'); updateParams.push(data.IsAudit ? 1 : 0); }
    if (data.SelectedTeethOnly !== undefined) { updateFields.push('SelectedTeethOnly = ?'); updateParams.push(data.SelectedTeethOnly ? 1 : 0); }
    if (data.OrionStatusFlags !== undefined) { updateFields.push('OrionStatusFlags = ?'); updateParams.push(data.OrionStatusFlags ?? 0); }
    if (data.DatesShowing !== undefined) { updateFields.push('DatesShowing = ?'); updateParams.push(data.DatesShowing ?? ChartViewDates.All); }
    if (data.IsTpCharting !== undefined) { updateFields.push('IsTpCharting = ?'); updateParams.push(data.IsTpCharting ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chartview
      SET ${updateFields.join(', ')}
      WHERE ChartViewNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChartViewNum, Description, ItemOrder, ProcStatuses, ObjectTypes, ShowProcNotes, IsAudit, SelectedTeethOnly, OrionStatusFlags, DatesShowing, IsTpCharting, created_at, updated_at
      FROM chartview
      WHERE ChartViewNum = ?
    `;
    const records = await executeQuery<ChartView[]>(selectQuery, [id]);

    const response: ApiResponse<ChartView> = {
      success: true,
      data: mapChartView(records[0]),
      message: 'ChartView updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chartview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChartView(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChartViewNum FROM chartview WHERE ChartViewNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChartView not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chartview WHERE ChartViewNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ChartView deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chartview:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHAT HANDLERS
// ========================================

function mapChat(record: any): Chat {
  return {
    ...record,
    ChatNum: Number(record.ChatNum),
  };
}

function validateChatPayload(
  data: CreateChatRequest | UpdateChatRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need((data as any).Name !== undefined, 'Name is required');
  if (data.Name !== undefined && data.Name.trim() === '') errors.push('Name cannot be blank');

  return errors;
}

async function handleGetChats(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatNum, Name, created_at, updated_at
      FROM chat
      ORDER BY ChatNum ASC
    `;
    const results = await executeQuery<Chat[]>(query);
    const mapped = results.map(mapChat);
    const response: ApiResponse<Chat[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chat:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChat(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatNum, Name, created_at, updated_at
      FROM chat
      WHERE ChatNum = ?
    `;
    const results = await executeQuery<Chat[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Chat not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Chat> = { success: true, data: mapChat(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chat by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChat(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChatRequest = JSON.parse(event.body);
    const errors = validateChatPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chat
      (Name)
      VALUES (?)
    `;
    const params = [data.Name.trim()];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChatNum, Name, created_at, updated_at
      FROM chat
      WHERE ChatNum = ?
    `;
    const records = await executeQuery<Chat[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Chat> = {
      success: true,
      data: mapChat(records[0]),
      message: 'Chat created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chat:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChat(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChatNum FROM chat WHERE ChatNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Chat not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChatRequest = JSON.parse(event.body);
    const errors = validateChatPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Name !== undefined) { updateFields.push('Name = ?'); updateParams.push(data.Name.trim()); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chat
      SET ${updateFields.join(', ')}
      WHERE ChatNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChatNum, Name, created_at, updated_at
      FROM chat
      WHERE ChatNum = ?
    `;
    const records = await executeQuery<Chat[]>(selectQuery, [id]);

    const response: ApiResponse<Chat> = {
      success: true,
      data: mapChat(records[0]),
      message: 'Chat updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chat:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChat(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChatNum FROM chat WHERE ChatNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Chat not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chat WHERE ChatNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Chat deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chat:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHAT ATTACH HANDLERS
// ========================================

function mapChatAttach(record: any): ChatAttach {
  const toBase64 = (val: any) => {
    if (val === null || val === undefined) return undefined;
    if (Buffer.isBuffer(val)) return val.toString('base64');
    return val;
  };

  return {
    ...record,
    ChatAttachNum: Number(record.ChatAttachNum),
    ChatMsgNum: Number(record.ChatMsgNum),
    Thumbnail: toBase64(record.Thumbnail),
    FileData: toBase64(record.FileData),
  };
}

function validateChatAttachPayload(
  data: CreateChatAttachRequest | UpdateChatAttachRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ChatMsgNum !== undefined, 'ChatMsgNum is required');
  need((data as any).FileName !== undefined, 'FileName is required');

  checkNum((data as any).ChatMsgNum, 'ChatMsgNum');

  if (data.FileName !== undefined && data.FileName.trim() === '') errors.push('FileName cannot be blank');
  if (data.Thumbnail !== undefined && typeof data.Thumbnail !== 'string') errors.push('Thumbnail must be a base64 string');
  if (data.FileData !== undefined && typeof data.FileData !== 'string') errors.push('FileData must be a base64 string');

  return errors;
}

async function handleGetChatAttaches(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatAttachNum, ChatMsgNum, FileName, Thumbnail, FileData, created_at, updated_at
      FROM chatattach
      ORDER BY ChatAttachNum ASC
    `;
    const results = await executeQuery<ChatAttach[]>(query);
    const mapped = results.map(mapChatAttach);
    const response: ApiResponse<ChatAttach[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChatAttach(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatAttachNum, ChatMsgNum, FileName, Thumbnail, FileData, created_at, updated_at
      FROM chatattach
      WHERE ChatAttachNum = ?
    `;
    const results = await executeQuery<ChatAttach[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ChatAttach> = { success: true, data: mapChatAttach(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatattach by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChatAttach(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChatAttachRequest = JSON.parse(event.body);
    const errors = validateChatAttachPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chatattach
      (ChatMsgNum, FileName, Thumbnail, FileData)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.ChatMsgNum,
      data.FileName.trim(),
      data.Thumbnail ?? null,
      data.FileData ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChatAttachNum, ChatMsgNum, FileName, Thumbnail, FileData, created_at, updated_at
      FROM chatattach
      WHERE ChatAttachNum = ?
    `;
    const records = await executeQuery<ChatAttach[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ChatAttach> = {
      success: true,
      data: mapChatAttach(records[0]),
      message: 'ChatAttach created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chatattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChatAttach(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChatAttachNum FROM chatattach WHERE ChatAttachNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChatAttachRequest = JSON.parse(event.body);
    const errors = validateChatAttachPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ChatMsgNum !== undefined) { updateFields.push('ChatMsgNum = ?'); updateParams.push(data.ChatMsgNum); }
    if (data.FileName !== undefined) { updateFields.push('FileName = ?'); updateParams.push(data.FileName.trim()); }
    if (data.Thumbnail !== undefined) { updateFields.push('Thumbnail = ?'); updateParams.push(data.Thumbnail ?? null); }
    if (data.FileData !== undefined) { updateFields.push('FileData = ?'); updateParams.push(data.FileData ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chatattach
      SET ${updateFields.join(', ')}
      WHERE ChatAttachNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChatAttachNum, ChatMsgNum, FileName, Thumbnail, FileData, created_at, updated_at
      FROM chatattach
      WHERE ChatAttachNum = ?
    `;
    const records = await executeQuery<ChatAttach[]>(selectQuery, [id]);

    const response: ApiResponse<ChatAttach> = {
      success: true,
      data: mapChatAttach(records[0]),
      message: 'ChatAttach updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chatattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChatAttach(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChatAttachNum FROM chatattach WHERE ChatAttachNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chatattach WHERE ChatAttachNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ChatAttach deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chatattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHAT MESSAGE HANDLERS
// ========================================

function mapChatMsg(record: any): ChatMsg {
  const normalizeDate = (val: any) => {
    if (!val) return val;
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  return {
    ...record,
    ChatMsgNum: Number(record.ChatMsgNum),
    ChatNum: Number(record.ChatNum),
    UserNum: Number(record.UserNum),
    DateTimeSent: normalizeDate(record.DateTimeSent),
    SeqCount: Number(record.SeqCount),
    Quote: record.Quote !== null ? Number(record.Quote) : undefined,
    EventType: record.EventType !== null ? Number(record.EventType) : undefined,
    IsImportant: record.IsImportant !== null ? Boolean(record.IsImportant) : undefined,
  };
}

function validateChatMsgPayload(
  data: CreateChatMsgRequest | UpdateChatMsgRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ChatNum !== undefined, 'ChatNum is required');
  need((data as any).UserNum !== undefined, 'UserNum is required');
  need((data as any).DateTimeSent !== undefined, 'DateTimeSent is required');
  need((data as any).SeqCount !== undefined, 'SeqCount is required');

  checkNum((data as any).ChatNum, 'ChatNum');
  checkNum((data as any).UserNum, 'UserNum');
  checkNum((data as any).SeqCount, 'SeqCount');
  checkNum((data as any).Quote, 'Quote');
  checkNum((data as any).EventType, 'EventType');

  if (data.DateTimeSent !== undefined) {
    const dt = new Date(data.DateTimeSent);
    if (isNaN(dt.getTime())) errors.push('DateTimeSent must be a valid datetime string');
  }
  if (data.Message !== undefined && typeof data.Message !== 'string') errors.push('Message must be a string');
  if (data.IsImportant !== undefined && typeof data.IsImportant !== 'boolean') errors.push('IsImportant must be a boolean');

  return errors;
}

async function handleGetChatMsgs(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatMsgNum, ChatNum, UserNum, DateTimeSent, Message, SeqCount, Quote, EventType, IsImportant, created_at, updated_at
      FROM chatmsg
      ORDER BY SeqCount ASC, ChatMsgNum ASC
    `;
    const results = await executeQuery<ChatMsg[]>(query);
    const mapped = results.map(mapChatMsg);
    const response: ApiResponse<ChatMsg[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatmsg:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChatMsg(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatMsgNum, ChatNum, UserNum, DateTimeSent, Message, SeqCount, Quote, EventType, IsImportant, created_at, updated_at
      FROM chatmsg
      WHERE ChatMsgNum = ?
    `;
    const results = await executeQuery<ChatMsg[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatMsg not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ChatMsg> = { success: true, data: mapChatMsg(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatmsg by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChatMsg(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChatMsgRequest = JSON.parse(event.body);
    const errors = validateChatMsgPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chatmsg
      (ChatNum, UserNum, DateTimeSent, Message, SeqCount, Quote, EventType, IsImportant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ChatNum,
      data.UserNum,
      data.DateTimeSent,
      data.Message ?? null,
      data.SeqCount,
      data.Quote ?? null,
      data.EventType ?? null,
      data.IsImportant === undefined ? null : data.IsImportant ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChatMsgNum, ChatNum, UserNum, DateTimeSent, Message, SeqCount, Quote, EventType, IsImportant, created_at, updated_at
      FROM chatmsg
      WHERE ChatMsgNum = ?
    `;
    const records = await executeQuery<ChatMsg[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ChatMsg> = {
      success: true,
      data: mapChatMsg(records[0]),
      message: 'ChatMsg created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chatmsg:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChatMsg(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChatMsgNum FROM chatmsg WHERE ChatMsgNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatMsg not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChatMsgRequest = JSON.parse(event.body);
    const errors = validateChatMsgPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ChatNum !== undefined) { updateFields.push('ChatNum = ?'); updateParams.push(data.ChatNum); }
    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }
    if (data.DateTimeSent !== undefined) { updateFields.push('DateTimeSent = ?'); updateParams.push(data.DateTimeSent); }
    if (data.Message !== undefined) { updateFields.push('Message = ?'); updateParams.push(data.Message ?? null); }
    if (data.SeqCount !== undefined) { updateFields.push('SeqCount = ?'); updateParams.push(data.SeqCount); }
    if (data.Quote !== undefined) { updateFields.push('Quote = ?'); updateParams.push(data.Quote ?? null); }
    if (data.EventType !== undefined) { updateFields.push('EventType = ?'); updateParams.push(data.EventType ?? null); }
    if (data.IsImportant !== undefined) { updateFields.push('IsImportant = ?'); updateParams.push(data.IsImportant ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chatmsg
      SET ${updateFields.join(', ')}
      WHERE ChatMsgNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChatMsgNum, ChatNum, UserNum, DateTimeSent, Message, SeqCount, Quote, EventType, IsImportant, created_at, updated_at
      FROM chatmsg
      WHERE ChatMsgNum = ?
    `;
    const records = await executeQuery<ChatMsg[]>(selectQuery, [id]);

    const response: ApiResponse<ChatMsg> = {
      success: true,
      data: mapChatMsg(records[0]),
      message: 'ChatMsg updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chatmsg:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChatMsg(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChatMsgNum FROM chatmsg WHERE ChatMsgNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatMsg not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chatmsg WHERE ChatMsgNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ChatMsg deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chatmsg:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHAT REACTION HANDLERS
// ========================================

function mapChatReaction(record: any): ChatReaction {
  return {
    ...record,
    ChatReactionNum: Number(record.ChatReactionNum),
    ChatMsgNum: Number(record.ChatMsgNum),
    UserNum: Number(record.UserNum),
  };
}

function validateChatReactionPayload(
  data: CreateChatReactionRequest | UpdateChatReactionRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ChatMsgNum !== undefined, 'ChatMsgNum is required');
  need((data as any).UserNum !== undefined, 'UserNum is required');
  need((data as any).EmojiName !== undefined, 'EmojiName is required');

  checkNum((data as any).ChatMsgNum, 'ChatMsgNum');
  checkNum((data as any).UserNum, 'UserNum');

  if (data.EmojiName !== undefined && data.EmojiName.trim() === '') errors.push('EmojiName cannot be blank');

  return errors;
}

async function handleGetChatReactions(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatReactionNum, ChatMsgNum, UserNum, EmojiName, created_at, updated_at
      FROM chatreaction
      ORDER BY ChatReactionNum ASC
    `;
    const results = await executeQuery<ChatReaction[]>(query);
    const mapped = results.map(mapChatReaction);
    const response: ApiResponse<ChatReaction[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatreaction:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChatReaction(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatReactionNum, ChatMsgNum, UserNum, EmojiName, created_at, updated_at
      FROM chatreaction
      WHERE ChatReactionNum = ?
    `;
    const results = await executeQuery<ChatReaction[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatReaction not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ChatReaction> = { success: true, data: mapChatReaction(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatreaction by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChatReaction(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChatReactionRequest = JSON.parse(event.body);
    const errors = validateChatReactionPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chatreaction
      (ChatMsgNum, UserNum, EmojiName)
      VALUES (?, ?, ?)
    `;
    const params = [
      data.ChatMsgNum,
      data.UserNum,
      data.EmojiName.trim(),
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChatReactionNum, ChatMsgNum, UserNum, EmojiName, created_at, updated_at
      FROM chatreaction
      WHERE ChatReactionNum = ?
    `;
    const records = await executeQuery<ChatReaction[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ChatReaction> = {
      success: true,
      data: mapChatReaction(records[0]),
      message: 'ChatReaction created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chatreaction:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChatReaction(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChatReactionNum FROM chatreaction WHERE ChatReactionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatReaction not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChatReactionRequest = JSON.parse(event.body);
    const errors = validateChatReactionPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ChatMsgNum !== undefined) { updateFields.push('ChatMsgNum = ?'); updateParams.push(data.ChatMsgNum); }
    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }
    if (data.EmojiName !== undefined) { updateFields.push('EmojiName = ?'); updateParams.push(data.EmojiName.trim()); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chatreaction
      SET ${updateFields.join(', ')}
      WHERE ChatReactionNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChatReactionNum, ChatMsgNum, UserNum, EmojiName, created_at, updated_at
      FROM chatreaction
      WHERE ChatReactionNum = ?
    `;
    const records = await executeQuery<ChatReaction[]>(selectQuery, [id]);

    const response: ApiResponse<ChatReaction> = {
      success: true,
      data: mapChatReaction(records[0]),
      message: 'ChatReaction updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chatreaction:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChatReaction(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChatReactionNum FROM chatreaction WHERE ChatReactionNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatReaction not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chatreaction WHERE ChatReactionNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ChatReaction deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chatreaction:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHAT USER ATTACH HANDLERS
// ========================================

function mapChatUserAttach(record: any): ChatUserAttach {
  const normalizeDate = (val: any) => {
    if (!val) return val;
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  return {
    ...record,
    ChatUserAttachNum: Number(record.ChatUserAttachNum),
    UserNum: Number(record.UserNum),
    ChatNum: Number(record.ChatNum),
    IsRead: record.IsRead !== null ? Boolean(record.IsRead) : undefined,
    DateTimeRemoved: normalizeDate(record.DateTimeRemoved),
    IsMute: record.IsMute !== null ? Boolean(record.IsMute) : undefined,
  };
}

function validateChatUserAttachPayload(
  data: CreateChatUserAttachRequest | UpdateChatUserAttachRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).UserNum !== undefined, 'UserNum is required');
  need((data as any).ChatNum !== undefined, 'ChatNum is required');

  checkNum((data as any).UserNum, 'UserNum');
  checkNum((data as any).ChatNum, 'ChatNum');

  if (data.DateTimeRemoved !== undefined) {
    const dt = new Date(data.DateTimeRemoved);
    if (isNaN(dt.getTime())) errors.push('DateTimeRemoved must be a valid datetime string');
  }
  if (data.IsRead !== undefined && typeof data.IsRead !== 'boolean') errors.push('IsRead must be a boolean');
  if (data.IsMute !== undefined && typeof data.IsMute !== 'boolean') errors.push('IsMute must be a boolean');

  return errors;
}

async function handleGetChatUserAttaches(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatUserAttachNum, UserNum, ChatNum, IsRead, DateTimeRemoved, IsMute, created_at, updated_at
      FROM chatuserattach
      ORDER BY ChatUserAttachNum ASC
    `;
    const results = await executeQuery<ChatUserAttach[]>(query);
    const mapped = results.map(mapChatUserAttach);
    const response: ApiResponse<ChatUserAttach[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatuserattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChatUserAttach(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatUserAttachNum, UserNum, ChatNum, IsRead, DateTimeRemoved, IsMute, created_at, updated_at
      FROM chatuserattach
      WHERE ChatUserAttachNum = ?
    `;
    const results = await executeQuery<ChatUserAttach[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatUserAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ChatUserAttach> = { success: true, data: mapChatUserAttach(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatuserattach by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChatUserAttach(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChatUserAttachRequest = JSON.parse(event.body);
    const errors = validateChatUserAttachPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chatuserattach
      (UserNum, ChatNum, IsRead, DateTimeRemoved, IsMute)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      data.UserNum,
      data.ChatNum,
      data.IsRead === undefined ? null : data.IsRead ? 1 : 0,
      data.DateTimeRemoved ?? null,
      data.IsMute === undefined ? null : data.IsMute ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChatUserAttachNum, UserNum, ChatNum, IsRead, DateTimeRemoved, IsMute, created_at, updated_at
      FROM chatuserattach
      WHERE ChatUserAttachNum = ?
    `;
    const records = await executeQuery<ChatUserAttach[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ChatUserAttach> = {
      success: true,
      data: mapChatUserAttach(records[0]),
      message: 'ChatUserAttach created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chatuserattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChatUserAttach(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChatUserAttachNum FROM chatuserattach WHERE ChatUserAttachNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatUserAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChatUserAttachRequest = JSON.parse(event.body);
    const errors = validateChatUserAttachPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }
    if (data.ChatNum !== undefined) { updateFields.push('ChatNum = ?'); updateParams.push(data.ChatNum); }
    if (data.IsRead !== undefined) { updateFields.push('IsRead = ?'); updateParams.push(data.IsRead ? 1 : 0); }
    if (data.DateTimeRemoved !== undefined) { updateFields.push('DateTimeRemoved = ?'); updateParams.push(data.DateTimeRemoved ?? null); }
    if (data.IsMute !== undefined) { updateFields.push('IsMute = ?'); updateParams.push(data.IsMute ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chatuserattach
      SET ${updateFields.join(', ')}
      WHERE ChatUserAttachNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChatUserAttachNum, UserNum, ChatNum, IsRead, DateTimeRemoved, IsMute, created_at, updated_at
      FROM chatuserattach
      WHERE ChatUserAttachNum = ?
    `;
    const records = await executeQuery<ChatUserAttach[]>(selectQuery, [id]);

    const response: ApiResponse<ChatUserAttach> = {
      success: true,
      data: mapChatUserAttach(records[0]),
      message: 'ChatUserAttach updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chatuserattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChatUserAttach(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChatUserAttachNum FROM chatuserattach WHERE ChatUserAttachNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatUserAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chatuserattach WHERE ChatUserAttachNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ChatUserAttach deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chatuserattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CHATUSEROD HANDLERS
// ========================================

function mapChatUserod(record: any): ChatUserod {
  const normalizeDate = (val: any) => {
    if (!val) return val;
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  return {
    ...record,
    ChatUserodNum: Number(record.ChatUserodNum),
    UserNum: Number(record.UserNum),
    UserStatus: record.UserStatus !== null ? Number(record.UserStatus) as ChatUserStatus : undefined,
    DateTimeStatusReset: normalizeDate(record.DateTimeStatusReset),
    OpenBackground: record.OpenBackground !== null ? Boolean(record.OpenBackground) : undefined,
    CloseKeepRunning: record.CloseKeepRunning !== null ? Boolean(record.CloseKeepRunning) : undefined,
    MuteNotifications: record.MuteNotifications !== null ? Boolean(record.MuteNotifications) : undefined,
    DismissNotifySecs: record.DismissNotifySecs !== null ? Number(record.DismissNotifySecs) : undefined,
    MuteImportantNotifications: record.MuteImportantNotifications !== null ? Boolean(record.MuteImportantNotifications) : undefined,
    DismissImportantNotifySecs: record.DismissImportantNotifySecs !== null ? Number(record.DismissImportantNotifySecs) : undefined,
  };
}

function validateChatUserodPayload(
  data: CreateChatUserodRequest | UpdateChatUserodRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).UserNum !== undefined, 'UserNum is required');
  checkNum((data as any).UserNum, 'UserNum');
  checkNum((data as any).UserStatus, 'UserStatus');
  checkNum((data as any).DismissNotifySecs, 'DismissNotifySecs');
  checkNum((data as any).DismissImportantNotifySecs, 'DismissImportantNotifySecs');

  if ((data as any).UserStatus !== undefined) {
    const n = Number((data as any).UserStatus);
    if (n < ChatUserStatus.Available || n > ChatUserStatus.DoNotDisturb) errors.push('UserStatus out of range');
  }

  if (data.DateTimeStatusReset !== undefined) {
    const dt = new Date(data.DateTimeStatusReset);
    if (isNaN(dt.getTime())) errors.push('DateTimeStatusReset must be a valid datetime string');
  }
  if (data.Photo !== undefined && typeof data.Photo !== 'string') errors.push('Photo must be a string');
  if (data.PhotoCrop !== undefined && typeof data.PhotoCrop !== 'string') errors.push('PhotoCrop must be a string');
  if (data.OpenBackground !== undefined && typeof data.OpenBackground !== 'boolean') errors.push('OpenBackground must be a boolean');
  if (data.CloseKeepRunning !== undefined && typeof data.CloseKeepRunning !== 'boolean') errors.push('CloseKeepRunning must be a boolean');
  if (data.MuteNotifications !== undefined && typeof data.MuteNotifications !== 'boolean') errors.push('MuteNotifications must be a boolean');
  if (data.MuteImportantNotifications !== undefined && typeof data.MuteImportantNotifications !== 'boolean') errors.push('MuteImportantNotifications must be a boolean');

  return errors;
}

async function handleGetChatUserods(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatUserodNum, UserNum, UserStatus, DateTimeStatusReset, Photo, PhotoCrop, OpenBackground, CloseKeepRunning, MuteNotifications, DismissNotifySecs, MuteImportantNotifications, DismissImportantNotifySecs, created_at, updated_at
      FROM chatuserod
      ORDER BY ChatUserodNum ASC
    `;
    const results = await executeQuery<ChatUserod[]>(query);
    const mapped = results.map(mapChatUserod);
    const response: ApiResponse<ChatUserod[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatuserod:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetChatUserod(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ChatUserodNum, UserNum, UserStatus, DateTimeStatusReset, Photo, PhotoCrop, OpenBackground, CloseKeepRunning, MuteNotifications, DismissNotifySecs, MuteImportantNotifications, DismissImportantNotifySecs, created_at, updated_at
      FROM chatuserod
      WHERE ChatUserodNum = ?
    `;
    const results = await executeQuery<ChatUserod[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatUserod not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ChatUserod> = { success: true, data: mapChatUserod(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET chatuserod by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostChatUserod(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateChatUserodRequest = JSON.parse(event.body);
    const errors = validateChatUserodPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO chatuserod
      (UserNum, UserStatus, DateTimeStatusReset, Photo, PhotoCrop, OpenBackground, CloseKeepRunning, MuteNotifications, DismissNotifySecs, MuteImportantNotifications, DismissImportantNotifySecs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.UserNum,
      data.UserStatus ?? null,
      data.DateTimeStatusReset ?? null,
      data.Photo ?? null,
      data.PhotoCrop ?? null,
      data.OpenBackground === undefined ? null : data.OpenBackground ? 1 : 0,
      data.CloseKeepRunning === undefined ? null : data.CloseKeepRunning ? 1 : 0,
      data.MuteNotifications === undefined ? null : data.MuteNotifications ? 1 : 0,
      data.DismissNotifySecs ?? null,
      data.MuteImportantNotifications === undefined ? null : data.MuteImportantNotifications ? 1 : 0,
      data.DismissImportantNotifySecs ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ChatUserodNum, UserNum, UserStatus, DateTimeStatusReset, Photo, PhotoCrop, OpenBackground, CloseKeepRunning, MuteNotifications, DismissNotifySecs, MuteImportantNotifications, DismissImportantNotifySecs, created_at, updated_at
      FROM chatuserod
      WHERE ChatUserodNum = ?
    `;
    const records = await executeQuery<ChatUserod[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ChatUserod> = {
      success: true,
      data: mapChatUserod(records[0]),
      message: 'ChatUserod created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST chatuserod:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutChatUserod(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ChatUserodNum FROM chatuserod WHERE ChatUserodNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatUserod not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateChatUserodRequest = JSON.parse(event.body);
    const errors = validateChatUserodPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }
    if (data.UserStatus !== undefined) { updateFields.push('UserStatus = ?'); updateParams.push(data.UserStatus ?? null); }
    if (data.DateTimeStatusReset !== undefined) { updateFields.push('DateTimeStatusReset = ?'); updateParams.push(data.DateTimeStatusReset ?? null); }
    if (data.Photo !== undefined) { updateFields.push('Photo = ?'); updateParams.push(data.Photo ?? null); }
    if (data.PhotoCrop !== undefined) { updateFields.push('PhotoCrop = ?'); updateParams.push(data.PhotoCrop ?? null); }
    if (data.OpenBackground !== undefined) { updateFields.push('OpenBackground = ?'); updateParams.push(data.OpenBackground ? 1 : 0); }
    if (data.CloseKeepRunning !== undefined) { updateFields.push('CloseKeepRunning = ?'); updateParams.push(data.CloseKeepRunning ? 1 : 0); }
    if (data.MuteNotifications !== undefined) { updateFields.push('MuteNotifications = ?'); updateParams.push(data.MuteNotifications ? 1 : 0); }
    if (data.DismissNotifySecs !== undefined) { updateFields.push('DismissNotifySecs = ?'); updateParams.push(data.DismissNotifySecs ?? null); }
    if (data.MuteImportantNotifications !== undefined) { updateFields.push('MuteImportantNotifications = ?'); updateParams.push(data.MuteImportantNotifications ? 1 : 0); }
    if (data.DismissImportantNotifySecs !== undefined) { updateFields.push('DismissImportantNotifySecs = ?'); updateParams.push(data.DismissImportantNotifySecs ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE chatuserod
      SET ${updateFields.join(', ')}
      WHERE ChatUserodNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ChatUserodNum, UserNum, UserStatus, DateTimeStatusReset, Photo, PhotoCrop, OpenBackground, CloseKeepRunning, MuteNotifications, DismissNotifySecs, MuteImportantNotifications, DismissImportantNotifySecs, created_at, updated_at
      FROM chatuserod
      WHERE ChatUserodNum = ?
    `;
    const records = await executeQuery<ChatUserod[]>(selectQuery, [id]);

    const response: ApiResponse<ChatUserod> = {
      success: true,
      data: mapChatUserod(records[0]),
      message: 'ChatUserod updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT chatuserod:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteChatUserod(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ChatUserodNum FROM chatuserod WHERE ChatUserodNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ChatUserod not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM chatuserod WHERE ChatUserodNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ChatUserod deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE chatuserod:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CLAIM HANDLERS
// ========================================

function mapClaim(record: any): Claim {
  const normalizeDate = (val: any) => {
    if (!val) return val;
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    return val;
  };
  const numOrU = (v: any) => (v === null || v === undefined ? undefined : Number(v));
  const boolOrU = (v: any) => (v === null || v === undefined ? undefined : Boolean(v));

  return {
    ...record,
    ClaimNum: Number(record.ClaimNum),
    PatNum: Number(record.PatNum),
    PlanNum: numOrU(record.PlanNum),
    ProvTreat: numOrU(record.ProvTreat),
    ClaimFee: numOrU(record.ClaimFee),
    InsPayEst: numOrU(record.InsPayEst),
    InsPayAmt: numOrU(record.InsPayAmt),
    DedApplied: numOrU(record.DedApplied),
    ProvBill: numOrU(record.ProvBill),
    ReferringProv: numOrU(record.ReferringProv),
    PlaceService: record.PlaceService !== null ? Number(record.PlaceService) as PlaceService : undefined,
    EmployRelated: record.EmployRelated !== null ? Number(record.EmployRelated) as EmployRelated : undefined,
    IsOrtho: boolOrU(record.IsOrtho),
    OrthoRemainM: numOrU(record.OrthoRemainM),
    PatRelat: numOrU(record.PatRelat),
    PlanNum2: numOrU(record.PlanNum2),
    PatRelat2: numOrU(record.PatRelat2),
    WriteOff: numOrU(record.WriteOff),
    Radiographs: numOrU(record.Radiographs),
    ClinicNum: numOrU(record.ClinicNum),
    ClaimForm: numOrU(record.ClaimForm),
    AttachedImages: numOrU(record.AttachedImages),
    AttachedModels: numOrU(record.AttachedModels),
    CanadianReferralReason: numOrU(record.CanadianReferralReason),
    CanadianMandProsthMaterial: numOrU(record.CanadianMandProsthMaterial),
    CanadianMaxProsthMaterial: numOrU(record.CanadianMaxProsthMaterial),
    InsSubNum: numOrU(record.InsSubNum),
    InsSubNum2: numOrU(record.InsSubNum2),
    CanadaInitialPayment: numOrU(record.CanadaInitialPayment),
    CanadaPaymentMode: numOrU(record.CanadaPaymentMode),
    CanadaTreatDuration: numOrU(record.CanadaTreatDuration),
    CanadaNumAnticipatedPayments: numOrU(record.CanadaNumAnticipatedPayments),
    CanadaAnticipatedPayAmount: numOrU(record.CanadaAnticipatedPayAmount),
    SpecialProgramCode: record.SpecialProgramCode !== null ? Number(record.SpecialProgramCode) as ClaimSpecialProgram : undefined,
    MedType: record.MedType !== null ? Number(record.MedType) as ClaimMedType : undefined,
    CustomTracking: numOrU(record.CustomTracking),
    CorrectionType: record.CorrectionType !== null ? Number(record.CorrectionType) as ClaimCorrectionType : undefined,
    ProvOrderOverride: numOrU(record.ProvOrderOverride),
    OrthoTotalM: numOrU(record.OrthoTotalM),
    ShareOfCost: numOrU(record.ShareOfCost),
    SecUserNumEntry: numOrU(record.SecUserNumEntry),
    DateService: normalizeDate(record.DateService),
    DateSent: normalizeDate(record.DateSent),
    DateReceived: normalizeDate(record.DateReceived),
    PriorDate: normalizeDate(record.PriorDate),
    OrthoDate: normalizeDate(record.OrthoDate),
    AccidentDate: normalizeDate(record.AccidentDate),
    CanadianDateInitialLower: normalizeDate(record.CanadianDateInitialLower),
    CanadianDateInitialUpper: normalizeDate(record.CanadianDateInitialUpper),
    CanadaEstTreatStartDate: normalizeDate(record.CanadaEstTreatStartDate),
    DateResent: normalizeDate(record.DateResent),
    DateSentOrig: normalizeDate(record.DateSentOrig),
    DateIllnessInjuryPreg: normalizeDate(record.DateIllnessInjuryPreg),
    DateOther: normalizeDate(record.DateOther),
    DateTimeStatusReset: normalizeDate(record.DateTimeStatusReset),
    SecDateEntry: normalizeDate(record.SecDateEntry),
    DateTimeRemoved: normalizeDate(record.DateTimeRemoved),
    DateIllnessInjuryPregQualifier: record.DateIllnessInjuryPregQualifier !== null ? Number(record.DateIllnessInjuryPregQualifier) as DateIllnessInjuryPregQualifier : undefined,
    DateOtherQualifier: record.DateOtherQualifier !== null ? Number(record.DateOtherQualifier) as DateOtherQualifier : undefined,
    IsOutsideLab: boolOrU(record.IsOutsideLab),
  };
}

function validateClaimPayload(
  data: CreateClaimRequest | UpdateClaimRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).PatNum !== undefined, 'PatNum is required');
  need((data as any).ClaimStatus !== undefined, 'ClaimStatus is required');
  need((data as any).ClaimType !== undefined, 'ClaimType is required');

  checkNum((data as any).PatNum, 'PatNum');
  checkNum((data as any).PlanNum, 'PlanNum');
  checkNum((data as any).ProvTreat, 'ProvTreat');
  checkNum((data as any).ClaimFee, 'ClaimFee');
  checkNum((data as any).InsPayEst, 'InsPayEst');
  checkNum((data as any).InsPayAmt, 'InsPayAmt');
  checkNum((data as any).DedApplied, 'DedApplied');
  checkNum((data as any).ProvBill, 'ProvBill');
  checkNum((data as any).ReferringProv, 'ReferringProv');
  checkNum((data as any).PlaceService, 'PlaceService');
  checkNum((data as any).EmployRelated, 'EmployRelated');
  checkNum((data as any).OrthoRemainM, 'OrthoRemainM');
  checkNum((data as any).PatRelat, 'PatRelat');
  checkNum((data as any).PlanNum2, 'PlanNum2');
  checkNum((data as any).PatRelat2, 'PatRelat2');
  checkNum((data as any).WriteOff, 'WriteOff');
  checkNum((data as any).Radiographs, 'Radiographs');
  checkNum((data as any).ClinicNum, 'ClinicNum');
  checkNum((data as any).ClaimForm, 'ClaimForm');
  checkNum((data as any).AttachedImages, 'AttachedImages');
  checkNum((data as any).AttachedModels, 'AttachedModels');
  checkNum((data as any).CanadianReferralReason, 'CanadianReferralReason');
  checkNum((data as any).CanadianMandProsthMaterial, 'CanadianMandProsthMaterial');
  checkNum((data as any).CanadianMaxProsthMaterial, 'CanadianMaxProsthMaterial');
  checkNum((data as any).InsSubNum, 'InsSubNum');
  checkNum((data as any).InsSubNum2, 'InsSubNum2');
  checkNum((data as any).CanadaInitialPayment, 'CanadaInitialPayment');
  checkNum((data as any).CanadaPaymentMode, 'CanadaPaymentMode');
  checkNum((data as any).CanadaTreatDuration, 'CanadaTreatDuration');
  checkNum((data as any).CanadaNumAnticipatedPayments, 'CanadaNumAnticipatedPayments');
  checkNum((data as any).CanadaAnticipatedPayAmount, 'CanadaAnticipatedPayAmount');
  checkNum((data as any).SpecialProgramCode, 'SpecialProgramCode');
  checkNum((data as any).MedType, 'MedType');
  checkNum((data as any).CustomTracking, 'CustomTracking');
  checkNum((data as any).CorrectionType, 'CorrectionType');
  checkNum((data as any).ProvOrderOverride, 'ProvOrderOverride');
  checkNum((data as any).OrthoTotalM, 'OrthoTotalM');
  checkNum((data as any).ShareOfCost, 'ShareOfCost');
  checkNum((data as any).SecUserNumEntry, 'SecUserNumEntry');
  checkNum((data as any).OrderingReferralNum, 'OrderingReferralNum');
  checkNum((data as any).DateIllnessInjuryPregQualifier, 'DateIllnessInjuryPregQualifier');
  checkNum((data as any).DateOtherQualifier, 'DateOtherQualifier');

  const checkDate = (val: any, name: string) => {
    if (val === undefined) return;
    const dt = new Date(val);
    if (isNaN(dt.getTime())) errors.push(`${name} must be a valid date`);
  };

  checkDate((data as any).DateService, 'DateService');
  checkDate((data as any).DateSent, 'DateSent');
  checkDate((data as any).DateReceived, 'DateReceived');
  checkDate((data as any).PriorDate, 'PriorDate');
  checkDate((data as any).OrthoDate, 'OrthoDate');
  checkDate((data as any).AccidentDate, 'AccidentDate');
  checkDate((data as any).CanadianDateInitialLower, 'CanadianDateInitialLower');
  checkDate((data as any).CanadianDateInitialUpper, 'CanadianDateInitialUpper');
  checkDate((data as any).CanadaEstTreatStartDate, 'CanadaEstTreatStartDate');
  checkDate((data as any).DateResent, 'DateResent');
  checkDate((data as any).DateSentOrig, 'DateSentOrig');
  checkDate((data as any).DateIllnessInjuryPreg, 'DateIllnessInjuryPreg');
  checkDate((data as any).DateOther, 'DateOther');

  if ((data as any).ClaimStatus !== undefined && typeof (data as any).ClaimStatus !== 'string') errors.push('ClaimStatus must be a string');
  if ((data as any).ClaimType !== undefined && typeof (data as any).ClaimType !== 'string') errors.push('ClaimType must be a string');
  if ((data as any).ClaimType !== undefined && (data as any).ClaimType.trim() === '') errors.push('ClaimType cannot be blank');
  if ((data as any).ClaimStatus !== undefined && String((data as any).ClaimStatus).trim().length !== 1) errors.push('ClaimStatus must be a single character');

  if (data.IsOutsideLab !== undefined && typeof data.IsOutsideLab !== 'boolean') errors.push('IsOutsideLab must be a boolean');

  return errors;
}

async function handleGetClaims(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT *
      FROM claim
      ORDER BY ClaimNum ASC
    `;
    const results = await executeQuery<Claim[]>(query);
    const mapped = results.map(mapClaim);
    const response: ApiResponse<Claim[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claim:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetClaim(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT *
      FROM claim
      WHERE ClaimNum = ?
    `;
    const results = await executeQuery<Claim[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Claim not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<Claim> = { success: true, data: mapClaim(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claim by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostClaim(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateClaimRequest = JSON.parse(event.body);
    const errors = validateClaimPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO claim
      (PatNum, DateService, DateSent, ClaimStatus, DateReceived, PlanNum, ProvTreat, ClaimFee, InsPayEst, InsPayAmt, DedApplied, PreAuthString, IsProsthesis, PriorDate, ReasonUnderPaid, ClaimNote, ClaimType, ProvBill, ReferringProv, RefNumString, PlaceService, AccidentRelated, AccidentDate, AccidentST, EmployRelated, IsOrtho, OrthoRemainM, OrthoDate, PatRelat, PlanNum2, PatRelat2, WriteOff, Radiographs, ClinicNum, ClaimForm, AttachedImages, AttachedModels, AttachedFlags, AttachmentID, CanadianMaterialsForwarded, CanadianReferralProviderNum, CanadianReferralReason, CanadianIsInitialLower, CanadianDateInitialLower, CanadianMandProsthMaterial, CanadianIsInitialUpper, CanadianDateInitialUpper, CanadianMaxProsthMaterial, InsSubNum, InsSubNum2, CanadaTransRefNum, CanadaEstTreatStartDate, CanadaInitialPayment, CanadaPaymentMode, CanadaTreatDuration, CanadaNumAnticipatedPayments, CanadaAnticipatedPayAmount, PriorAuthorizationNumber, SpecialProgramCode, UniformBillType, MedType, AdmissionTypeCode, AdmissionSourceCode, PatientStatusCode, CustomTracking, DateResent, CorrectionType, ClaimIdentifier, OrigRefNum, ProvOrderOverride, OrthoTotalM, ShareOfCost, SecUserNumEntry, SecDateEntry, SecDateTEdit, OrderingReferralNum, DateSentOrig, DateIllnessInjuryPreg, DateIllnessInjuryPregQualifier, DateOther, DateOtherQualifier, IsOutsideLab, SecurityHash, Narrative)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)
    `;
    const params = [
      data.PatNum,
      data.DateService ?? null,
      data.DateSent ?? null,
      data.ClaimStatus.trim(),
      data.DateReceived ?? null,
      data.PlanNum ?? null,
      data.ProvTreat ?? null,
      data.ClaimFee ?? null,
      data.InsPayEst ?? null,
      data.InsPayAmt ?? null,
      data.DedApplied ?? null,
      data.PreAuthString ?? null,
      data.IsProsthesis ?? null,
      data.PriorDate ?? null,
      data.ReasonUnderPaid ?? null,
      data.ClaimNote ?? null,
      data.ClaimType.trim(),
      data.ProvBill ?? null,
      data.ReferringProv ?? null,
      data.RefNumString ?? null,
      data.PlaceService ?? null,
      data.AccidentRelated ?? null,
      data.AccidentDate ?? null,
      data.AccidentST ?? null,
      data.EmployRelated ?? null,
      data.IsOrtho === undefined ? null : data.IsOrtho ? 1 : 0,
      data.OrthoRemainM ?? null,
      data.OrthoDate ?? null,
      data.PatRelat ?? null,
      data.PlanNum2 ?? null,
      data.PatRelat2 ?? null,
      data.WriteOff ?? null,
      data.Radiographs ?? null,
      data.ClinicNum ?? null,
      data.ClaimForm ?? null,
      data.AttachedImages ?? null,
      data.AttachedModels ?? null,
      data.AttachedFlags ?? null,
      data.AttachmentID ?? null,
      data.CanadianMaterialsForwarded ?? null,
      data.CanadianReferralProviderNum ?? null,
      data.CanadianReferralReason ?? null,
      data.CanadianIsInitialLower ?? null,
      data.CanadianDateInitialLower ?? null,
      data.CanadianMandProsthMaterial ?? null,
      data.CanadianIsInitialUpper ?? null,
      data.CanadianDateInitialUpper ?? null,
      data.CanadianMaxProsthMaterial ?? null,
      data.InsSubNum ?? null,
      data.InsSubNum2 ?? null,
      data.CanadaTransRefNum ?? null,
      data.CanadaEstTreatStartDate ?? null,
      data.CanadaInitialPayment ?? null,
      data.CanadaPaymentMode ?? null,
      data.CanadaTreatDuration ?? null,
      data.CanadaNumAnticipatedPayments ?? null,
      data.CanadaAnticipatedPayAmount ?? null,
      data.PriorAuthorizationNumber ?? null,
      data.SpecialProgramCode ?? null,
      data.UniformBillType ?? null,
      data.MedType ?? null,
      data.AdmissionTypeCode ?? null,
      data.AdmissionSourceCode ?? null,
      data.PatientStatusCode ?? null,
      data.CustomTracking ?? null,
      data.DateResent ?? null,
      data.CorrectionType ?? null,
      data.ClaimIdentifier ?? null,
      data.OrigRefNum ?? null,
      data.ProvOrderOverride ?? null,
      data.OrthoTotalM ?? null,
      data.ShareOfCost ?? null,
      data.SecUserNumEntry ?? null,
      data.SecDateEntry ?? null,
      data.SecDateTEdit ?? null,
      data.OrderingReferralNum ?? null,
      data.DateSentOrig ?? null,
      data.DateIllnessInjuryPreg ?? null,
      data.DateIllnessInjuryPregQualifier ?? null,
      data.DateOther ?? null,
      data.DateOtherQualifier ?? null,
      data.IsOutsideLab === undefined ? null : data.IsOutsideLab ? 1 : 0,
      data.SecurityHash ?? null,
      data.Narrative ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT *
      FROM claim
      WHERE ClaimNum = ?
    `;
    const records = await executeQuery<Claim[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Claim> = {
      success: true,
      data: mapClaim(records[0]),
      message: 'Claim created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST claim:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutClaim(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ClaimNum FROM claim WHERE ClaimNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Claim not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateClaimRequest = JSON.parse(event.body);
    const errors = validateClaimPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];
    const setField = (cond: any, sql: string, val: any) => { if (cond !== undefined) { updateFields.push(sql); updateParams.push(val); } };

    setField(data.PatNum, 'PatNum = ?', data.PatNum);
    setField(data.DateService, 'DateService = ?', data.DateService ?? null);
    setField(data.DateSent, 'DateSent = ?', data.DateSent ?? null);
    setField(data.ClaimStatus, 'ClaimStatus = ?', data.ClaimStatus?.trim());
    setField(data.DateReceived, 'DateReceived = ?', data.DateReceived ?? null);
    setField(data.PlanNum, 'PlanNum = ?', data.PlanNum ?? null);
    setField(data.ProvTreat, 'ProvTreat = ?', data.ProvTreat ?? null);
    setField(data.ClaimFee, 'ClaimFee = ?', data.ClaimFee ?? null);
    setField(data.InsPayEst, 'InsPayEst = ?', data.InsPayEst ?? null);
    setField(data.InsPayAmt, 'InsPayAmt = ?', data.InsPayAmt ?? null);
    setField(data.DedApplied, 'DedApplied = ?', data.DedApplied ?? null);
    setField(data.PreAuthString, 'PreAuthString = ?', data.PreAuthString ?? null);
    setField(data.IsProsthesis, 'IsProsthesis = ?', data.IsProsthesis ?? null);
    setField(data.PriorDate, 'PriorDate = ?', data.PriorDate ?? null);
    setField(data.ReasonUnderPaid, 'ReasonUnderPaid = ?', data.ReasonUnderPaid ?? null);
    setField(data.ClaimNote, 'ClaimNote = ?', data.ClaimNote ?? null);
    setField(data.ClaimType, 'ClaimType = ?', data.ClaimType?.trim());
    setField(data.ProvBill, 'ProvBill = ?', data.ProvBill ?? null);
    setField(data.ReferringProv, 'ReferringProv = ?', data.ReferringProv ?? null);
    setField(data.RefNumString, 'RefNumString = ?', data.RefNumString ?? null);
    setField(data.PlaceService, 'PlaceService = ?', data.PlaceService ?? null);
    setField(data.AccidentRelated, 'AccidentRelated = ?', data.AccidentRelated ?? null);
    setField(data.AccidentDate, 'AccidentDate = ?', data.AccidentDate ?? null);
    setField(data.AccidentST, 'AccidentST = ?', data.AccidentST ?? null);
    setField(data.EmployRelated, 'EmployRelated = ?', data.EmployRelated ?? null);
    setField(data.IsOrtho, 'IsOrtho = ?', data.IsOrtho === undefined ? null : data.IsOrtho ? 1 : 0);
    setField(data.OrthoRemainM, 'OrthoRemainM = ?', data.OrthoRemainM ?? null);
    setField(data.OrthoDate, 'OrthoDate = ?', data.OrthoDate ?? null);
    setField(data.PatRelat, 'PatRelat = ?', data.PatRelat ?? null);
    setField(data.PlanNum2, 'PlanNum2 = ?', data.PlanNum2 ?? null);
    setField(data.PatRelat2, 'PatRelat2 = ?', data.PatRelat2 ?? null);
    setField(data.WriteOff, 'WriteOff = ?', data.WriteOff ?? null);
    setField(data.Radiographs, 'Radiographs = ?', data.Radiographs ?? null);
    setField(data.ClinicNum, 'ClinicNum = ?', data.ClinicNum ?? null);
    setField(data.ClaimForm, 'ClaimForm = ?', data.ClaimForm ?? null);
    setField(data.AttachedImages, 'AttachedImages = ?', data.AttachedImages ?? null);
    setField(data.AttachedModels, 'AttachedModels = ?', data.AttachedModels ?? null);
    setField(data.AttachedFlags, 'AttachedFlags = ?', data.AttachedFlags ?? null);
    setField(data.AttachmentID, 'AttachmentID = ?', data.AttachmentID ?? null);
    setField(data.CanadianMaterialsForwarded, 'CanadianMaterialsForwarded = ?', data.CanadianMaterialsForwarded ?? null);
    setField(data.CanadianReferralProviderNum, 'CanadianReferralProviderNum = ?', data.CanadianReferralProviderNum ?? null);
    setField(data.CanadianReferralReason, 'CanadianReferralReason = ?', data.CanadianReferralReason ?? null);
    setField(data.CanadianIsInitialLower, 'CanadianIsInitialLower = ?', data.CanadianIsInitialLower ?? null);
    setField(data.CanadianDateInitialLower, 'CanadianDateInitialLower = ?', data.CanadianDateInitialLower ?? null);
    setField(data.CanadianMandProsthMaterial, 'CanadianMandProsthMaterial = ?', data.CanadianMandProsthMaterial ?? null);
    setField(data.CanadianIsInitialUpper, 'CanadianIsInitialUpper = ?', data.CanadianIsInitialUpper ?? null);
    setField(data.CanadianDateInitialUpper, 'CanadianDateInitialUpper = ?', data.CanadianDateInitialUpper ?? null);
    setField(data.CanadianMaxProsthMaterial, 'CanadianMaxProsthMaterial = ?', data.CanadianMaxProsthMaterial ?? null);
    setField(data.InsSubNum, 'InsSubNum = ?', data.InsSubNum ?? null);
    setField(data.InsSubNum2, 'InsSubNum2 = ?', data.InsSubNum2 ?? null);
    setField(data.CanadaTransRefNum, 'CanadaTransRefNum = ?', data.CanadaTransRefNum ?? null);
    setField(data.CanadaEstTreatStartDate, 'CanadaEstTreatStartDate = ?', data.CanadaEstTreatStartDate ?? null);
    setField(data.CanadaInitialPayment, 'CanadaInitialPayment = ?', data.CanadaInitialPayment ?? null);
    setField(data.CanadaPaymentMode, 'CanadaPaymentMode = ?', data.CanadaPaymentMode ?? null);
    setField(data.CanadaTreatDuration, 'CanadaTreatDuration = ?', data.CanadaTreatDuration ?? null);
    setField(data.CanadaNumAnticipatedPayments, 'CanadaNumAnticipatedPayments = ?', data.CanadaNumAnticipatedPayments ?? null);
    setField(data.CanadaAnticipatedPayAmount, 'CanadaAnticipatedPayAmount = ?', data.CanadaAnticipatedPayAmount ?? null);
    setField(data.PriorAuthorizationNumber, 'PriorAuthorizationNumber = ?', data.PriorAuthorizationNumber ?? null);
    setField(data.SpecialProgramCode, 'SpecialProgramCode = ?', data.SpecialProgramCode ?? null);
    setField(data.UniformBillType, 'UniformBillType = ?', data.UniformBillType ?? null);
    setField(data.MedType, 'MedType = ?', data.MedType ?? null);
    setField(data.AdmissionTypeCode, 'AdmissionTypeCode = ?', data.AdmissionTypeCode ?? null);
    setField(data.AdmissionSourceCode, 'AdmissionSourceCode = ?', data.AdmissionSourceCode ?? null);
    setField(data.PatientStatusCode, 'PatientStatusCode = ?', data.PatientStatusCode ?? null);
    setField(data.CustomTracking, 'CustomTracking = ?', data.CustomTracking ?? null);
    setField(data.DateResent, 'DateResent = ?', data.DateResent ?? null);
    setField(data.CorrectionType, 'CorrectionType = ?', data.CorrectionType ?? null);
    setField(data.ClaimIdentifier, 'ClaimIdentifier = ?', data.ClaimIdentifier ?? null);
    setField(data.OrigRefNum, 'OrigRefNum = ?', data.OrigRefNum ?? null);
    setField(data.ProvOrderOverride, 'ProvOrderOverride = ?', data.ProvOrderOverride ?? null);
    setField(data.OrthoTotalM, 'OrthoTotalM = ?', data.OrthoTotalM ?? null);
    setField(data.ShareOfCost, 'ShareOfCost = ?', data.ShareOfCost ?? null);
    setField(data.SecUserNumEntry, 'SecUserNumEntry = ?', data.SecUserNumEntry ?? null);
    setField(data.SecDateEntry, 'SecDateEntry = ?', data.SecDateEntry ?? null);
    setField(data.SecDateTEdit, 'SecDateTEdit = ?', data.SecDateTEdit ?? null);
    setField(data.OrderingReferralNum, 'OrderingReferralNum = ?', data.OrderingReferralNum ?? null);
    setField(data.DateSentOrig, 'DateSentOrig = ?', data.DateSentOrig ?? null);
    setField(data.DateIllnessInjuryPreg, 'DateIllnessInjuryPreg = ?', data.DateIllnessInjuryPreg ?? null);
    setField(data.DateIllnessInjuryPregQualifier, 'DateIllnessInjuryPregQualifier = ?', data.DateIllnessInjuryPregQualifier ?? null);
    setField(data.DateOther, 'DateOther = ?', data.DateOther ?? null);
    setField(data.DateOtherQualifier, 'DateOtherQualifier = ?', data.DateOtherQualifier ?? null);
    setField(data.IsOutsideLab, 'IsOutsideLab = ?', data.IsOutsideLab === undefined ? null : data.IsOutsideLab ? 1 : 0);
    setField(data.SecurityHash, 'SecurityHash = ?', data.SecurityHash ?? null);
    setField(data.Narrative, 'Narrative = ?', data.Narrative ?? null);

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE claim
      SET ${updateFields.join(', ')}
      WHERE ClaimNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT *
      FROM claim
      WHERE ClaimNum = ?
    `;
    const records = await executeQuery<Claim[]>(selectQuery, [id]);

    const response: ApiResponse<Claim> = {
      success: true,
      data: mapClaim(records[0]),
      message: 'Claim updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT claim:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteClaim(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ClaimNum FROM claim WHERE ClaimNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Claim not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM claim WHERE ClaimNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Claim deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE claim:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CLAIM ATTACH HANDLERS
// ========================================

function mapClaimAttach(record: any): ClaimAttach {
  return {
    ...record,
    ClaimAttachNum: Number(record.ClaimAttachNum),
    ClaimNum: Number(record.ClaimNum),
    ImageReferenceId: record.ImageReferenceId !== null ? Number(record.ImageReferenceId) : undefined,
  };
}

function validateClaimAttachPayload(
  data: CreateClaimAttachRequest | UpdateClaimAttachRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ClaimNum !== undefined, 'ClaimNum is required');
  need((data as any).DisplayedFileName !== undefined, 'DisplayedFileName is required');

  checkNum((data as any).ClaimNum, 'ClaimNum');
  checkNum((data as any).ImageReferenceId, 'ImageReferenceId');

  if (data.DisplayedFileName !== undefined && data.DisplayedFileName.trim() === '') errors.push('DisplayedFileName cannot be blank');
  if (data.ActualFileName !== undefined && typeof data.ActualFileName !== 'string') errors.push('ActualFileName must be a string');

  return errors;
}

async function handleGetClaimAttaches(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimAttachNum, ClaimNum, DisplayedFileName, ActualFileName, ImageReferenceId, created_at, updated_at
      FROM claimattach
      ORDER BY ClaimAttachNum ASC
    `;
    const results = await executeQuery<ClaimAttach[]>(query);
    const mapped = results.map(mapClaimAttach);
    const response: ApiResponse<ClaimAttach[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetClaimAttach(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimAttachNum, ClaimNum, DisplayedFileName, ActualFileName, ImageReferenceId, created_at, updated_at
      FROM claimattach
      WHERE ClaimAttachNum = ?
    `;
    const results = await executeQuery<ClaimAttach[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ClaimAttach> = { success: true, data: mapClaimAttach(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimattach by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostClaimAttach(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateClaimAttachRequest = JSON.parse(event.body);
    const errors = validateClaimAttachPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO claimattach
      (ClaimNum, DisplayedFileName, ActualFileName, ImageReferenceId)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.ClaimNum,
      data.DisplayedFileName.trim(),
      data.ActualFileName ?? null,
      data.ImageReferenceId ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ClaimAttachNum, ClaimNum, DisplayedFileName, ActualFileName, ImageReferenceId, created_at, updated_at
      FROM claimattach
      WHERE ClaimAttachNum = ?
    `;
    const records = await executeQuery<ClaimAttach[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ClaimAttach> = {
      success: true,
      data: mapClaimAttach(records[0]),
      message: 'ClaimAttach created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST claimattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutClaimAttach(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ClaimAttachNum FROM claimattach WHERE ClaimAttachNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateClaimAttachRequest = JSON.parse(event.body);
    const errors = validateClaimAttachPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ClaimNum !== undefined) { updateFields.push('ClaimNum = ?'); updateParams.push(data.ClaimNum); }
    if (data.DisplayedFileName !== undefined) { updateFields.push('DisplayedFileName = ?'); updateParams.push(data.DisplayedFileName.trim()); }
    if (data.ActualFileName !== undefined) { updateFields.push('ActualFileName = ?'); updateParams.push(data.ActualFileName ?? null); }
    if (data.ImageReferenceId !== undefined) { updateFields.push('ImageReferenceId = ?'); updateParams.push(data.ImageReferenceId ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE claimattach
      SET ${updateFields.join(', ')}
      WHERE ClaimAttachNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ClaimAttachNum, ClaimNum, DisplayedFileName, ActualFileName, ImageReferenceId, created_at, updated_at
      FROM claimattach
      WHERE ClaimAttachNum = ?
    `;
    const records = await executeQuery<ClaimAttach[]>(selectQuery, [id]);

    const response: ApiResponse<ClaimAttach> = {
      success: true,
      data: mapClaimAttach(records[0]),
      message: 'ClaimAttach updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT claimattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteClaimAttach(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ClaimAttachNum FROM claimattach WHERE ClaimAttachNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimAttach not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM claimattach WHERE ClaimAttachNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ClaimAttach deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE claimattach:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CLAIM CONDITION CODE LOG HANDLERS
// ========================================

function mapClaimCondCodeLog(record: any): ClaimCondCodeLog {
  return {
    ...record,
    ClaimCondCodeLogNum: Number(record.ClaimCondCodeLogNum),
    ClaimNum: Number(record.ClaimNum),
  };
}

function validateClaimCondCodeLogPayload(
  data: CreateClaimCondCodeLogRequest | UpdateClaimCondCodeLogRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ClaimNum !== undefined, 'ClaimNum is required');

  checkNum((data as any).ClaimNum, 'ClaimNum');

  const codes = ['Code0','Code1','Code2','Code3','Code4','Code5','Code6','Code7','Code8','Code9','Code10'];
  codes.forEach((c) => {
    const val = (data as any)[c];
    if (val !== undefined && typeof val !== 'string') errors.push(`${c} must be a string`);
    if (typeof val === 'string' && val.length > 2) errors.push(`${c} must be at most 2 characters`);
  });

  return errors;
}

async function handleGetClaimCondCodeLogs(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimCondCodeLogNum, ClaimNum, Code0, Code1, Code2, Code3, Code4, Code5, Code6, Code7, Code8, Code9, Code10, created_at, updated_at
      FROM claimcondcodelog
      ORDER BY ClaimCondCodeLogNum ASC
    `;
    const results = await executeQuery<ClaimCondCodeLog[]>(query);
    const mapped = results.map(mapClaimCondCodeLog);
    const response: ApiResponse<ClaimCondCodeLog[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimcondcodelog:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetClaimCondCodeLog(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimCondCodeLogNum, ClaimNum, Code0, Code1, Code2, Code3, Code4, Code5, Code6, Code7, Code8, Code9, Code10, created_at, updated_at
      FROM claimcondcodelog
      WHERE ClaimCondCodeLogNum = ?
    `;
    const results = await executeQuery<ClaimCondCodeLog[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimCondCodeLog not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ClaimCondCodeLog> = { success: true, data: mapClaimCondCodeLog(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimcondcodelog by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostClaimCondCodeLog(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateClaimCondCodeLogRequest = JSON.parse(event.body);
    const errors = validateClaimCondCodeLogPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO claimcondcodelog
      (ClaimNum, Code0, Code1, Code2, Code3, Code4, Code5, Code6, Code7, Code8, Code9, Code10)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ClaimNum,
      data.Code0 ?? null,
      data.Code1 ?? null,
      data.Code2 ?? null,
      data.Code3 ?? null,
      data.Code4 ?? null,
      data.Code5 ?? null,
      data.Code6 ?? null,
      data.Code7 ?? null,
      data.Code8 ?? null,
      data.Code9 ?? null,
      data.Code10 ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ClaimCondCodeLogNum, ClaimNum, Code0, Code1, Code2, Code3, Code4, Code5, Code6, Code7, Code8, Code9, Code10, created_at, updated_at
      FROM claimcondcodelog
      WHERE ClaimCondCodeLogNum = ?
    `;
    const records = await executeQuery<ClaimCondCodeLog[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ClaimCondCodeLog> = {
      success: true,
      data: mapClaimCondCodeLog(records[0]),
      message: 'ClaimCondCodeLog created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST claimcondcodelog:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutClaimCondCodeLog(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ClaimCondCodeLogNum FROM claimcondcodelog WHERE ClaimCondCodeLogNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimCondCodeLog not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateClaimCondCodeLogRequest = JSON.parse(event.body);
    const errors = validateClaimCondCodeLogPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ClaimNum !== undefined) { updateFields.push('ClaimNum = ?'); updateParams.push(data.ClaimNum); }
    if (data.Code0 !== undefined) { updateFields.push('Code0 = ?'); updateParams.push(data.Code0 ?? null); }
    if (data.Code1 !== undefined) { updateFields.push('Code1 = ?'); updateParams.push(data.Code1 ?? null); }
    if (data.Code2 !== undefined) { updateFields.push('Code2 = ?'); updateParams.push(data.Code2 ?? null); }
    if (data.Code3 !== undefined) { updateFields.push('Code3 = ?'); updateParams.push(data.Code3 ?? null); }
    if (data.Code4 !== undefined) { updateFields.push('Code4 = ?'); updateParams.push(data.Code4 ?? null); }
    if (data.Code5 !== undefined) { updateFields.push('Code5 = ?'); updateParams.push(data.Code5 ?? null); }
    if (data.Code6 !== undefined) { updateFields.push('Code6 = ?'); updateParams.push(data.Code6 ?? null); }
    if (data.Code7 !== undefined) { updateFields.push('Code7 = ?'); updateParams.push(data.Code7 ?? null); }
    if (data.Code8 !== undefined) { updateFields.push('Code8 = ?'); updateParams.push(data.Code8 ?? null); }
    if (data.Code9 !== undefined) { updateFields.push('Code9 = ?'); updateParams.push(data.Code9 ?? null); }
    if (data.Code10 !== undefined) { updateFields.push('Code10 = ?'); updateParams.push(data.Code10 ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE claimcondcodelog
      SET ${updateFields.join(', ')}
      WHERE ClaimCondCodeLogNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ClaimCondCodeLogNum, ClaimNum, Code0, Code1, Code2, Code3, Code4, Code5, Code6, Code7, Code8, Code9, Code10, created_at, updated_at
      FROM claimcondcodelog
      WHERE ClaimCondCodeLogNum = ?
    `;
    const records = await executeQuery<ClaimCondCodeLog[]>(selectQuery, [id]);

    const response: ApiResponse<ClaimCondCodeLog> = {
      success: true,
      data: mapClaimCondCodeLog(records[0]),
      message: 'ClaimCondCodeLog updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT claimcondcodelog:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteClaimCondCodeLog(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ClaimCondCodeLogNum FROM claimcondcodelog WHERE ClaimCondCodeLogNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimCondCodeLog not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM claimcondcodelog WHERE ClaimCondCodeLogNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ClaimCondCodeLog deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE claimcondcodelog:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CLAIM FORM HANDLERS
// ========================================

function mapClaimForm(record: any): ClaimForm {
  const numOrU = (v: any) => (v === null || v === undefined ? undefined : Number(v));
  const boolOrU = (v: any) => (v === null || v === undefined ? undefined : Boolean(v));
  return {
    ...record,
    ClaimFormNum: Number(record.ClaimFormNum),
    IsHidden: boolOrU(record.IsHidden),
    FontSize: numOrU(record.FontSize),
    OffsetX: numOrU(record.OffsetX),
    OffsetY: numOrU(record.OffsetY),
    Width: numOrU(record.Width),
    Height: numOrU(record.Height),
    PrintImages: boolOrU(record.PrintImages),
  };
}

function validateClaimFormPayload(
  data: CreateClaimFormRequest | UpdateClaimFormRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).Description !== undefined, 'Description is required');
  if (data.Description !== undefined && data.Description.trim() === '') errors.push('Description cannot be blank');

  checkNum((data as any).FontSize, 'FontSize');
  checkNum((data as any).OffsetX, 'OffsetX');
  checkNum((data as any).OffsetY, 'OffsetY');
  checkNum((data as any).Width, 'Width');
  checkNum((data as any).Height, 'Height');

  if (data.IsHidden !== undefined && typeof data.IsHidden !== 'boolean') errors.push('IsHidden must be a boolean');
  if (data.PrintImages !== undefined && typeof data.PrintImages !== 'boolean') errors.push('PrintImages must be a boolean');

  return errors;
}

async function handleGetClaimForms(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimFormNum, Description, IsHidden, FontName, FontSize, UniqueID, PrintImages, OffsetX, OffsetY, Width, Height, created_at, updated_at
      FROM claimform
      ORDER BY ClaimFormNum ASC
    `;
    const results = await executeQuery<ClaimForm[]>(query);
    const mapped = results.map(mapClaimForm);
    const response: ApiResponse<ClaimForm[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimform:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetClaimForm(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimFormNum, Description, IsHidden, FontName, FontSize, UniqueID, PrintImages, OffsetX, OffsetY, Width, Height, created_at, updated_at
      FROM claimform
      WHERE ClaimFormNum = ?
    `;
    const results = await executeQuery<ClaimForm[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimForm not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ClaimForm> = { success: true, data: mapClaimForm(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimform by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostClaimForm(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateClaimFormRequest = JSON.parse(event.body);
    const errors = validateClaimFormPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO claimform
      (Description, IsHidden, FontName, FontSize, UniqueID, PrintImages, OffsetX, OffsetY, Width, Height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.Description.trim(),
      data.IsHidden === undefined ? null : data.IsHidden ? 1 : 0,
      data.FontName ?? null,
      data.FontSize ?? null,
      data.UniqueID ?? null,
      data.PrintImages === undefined ? null : data.PrintImages ? 1 : 0,
      data.OffsetX ?? null,
      data.OffsetY ?? null,
      data.Width ?? null,
      data.Height ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ClaimFormNum, Description, IsHidden, FontName, FontSize, UniqueID, PrintImages, OffsetX, OffsetY, Width, Height, created_at, updated_at
      FROM claimform
      WHERE ClaimFormNum = ?
    `;
    const records = await executeQuery<ClaimForm[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ClaimForm> = {
      success: true,
      data: mapClaimForm(records[0]),
      message: 'ClaimForm created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST claimform:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutClaimForm(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ClaimFormNum FROM claimform WHERE ClaimFormNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimForm not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateClaimFormRequest = JSON.parse(event.body);
    const errors = validateClaimFormPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.IsHidden !== undefined) { updateFields.push('IsHidden = ?'); updateParams.push(data.IsHidden ? 1 : 0); }
    if (data.FontName !== undefined) { updateFields.push('FontName = ?'); updateParams.push(data.FontName ?? null); }
    if (data.FontSize !== undefined) { updateFields.push('FontSize = ?'); updateParams.push(data.FontSize ?? null); }
    if (data.UniqueID !== undefined) { updateFields.push('UniqueID = ?'); updateParams.push(data.UniqueID ?? null); }
    if (data.PrintImages !== undefined) { updateFields.push('PrintImages = ?'); updateParams.push(data.PrintImages ? 1 : 0); }
    if (data.OffsetX !== undefined) { updateFields.push('OffsetX = ?'); updateParams.push(data.OffsetX ?? null); }
    if (data.OffsetY !== undefined) { updateFields.push('OffsetY = ?'); updateParams.push(data.OffsetY ?? null); }
    if (data.Width !== undefined) { updateFields.push('Width = ?'); updateParams.push(data.Width ?? null); }
    if (data.Height !== undefined) { updateFields.push('Height = ?'); updateParams.push(data.Height ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE claimform
      SET ${updateFields.join(', ')}
      WHERE ClaimFormNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ClaimFormNum, Description, IsHidden, FontName, FontSize, UniqueID, PrintImages, OffsetX, OffsetY, Width, Height, created_at, updated_at
      FROM claimform
      WHERE ClaimFormNum = ?
    `;
    const records = await executeQuery<ClaimForm[]>(selectQuery, [id]);

    const response: ApiResponse<ClaimForm> = {
      success: true,
      data: mapClaimForm(records[0]),
      message: 'ClaimForm updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT claimform:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteClaimForm(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ClaimFormNum FROM claimform WHERE ClaimFormNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimForm not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM claimform WHERE ClaimFormNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ClaimForm deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE claimform:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// CLAIM FORM ITEM HANDLERS
// ========================================

function mapClaimFormItem(record: any): ClaimFormItem {
  const numOrU = (v: any) => (v === null || v === undefined ? undefined : Number(v));
  return {
    ...record,
    ClaimFormItemNum: Number(record.ClaimFormItemNum),
    ClaimFormNum: Number(record.ClaimFormNum),
    XPos: numOrU(record.XPos),
    YPos: numOrU(record.YPos),
    Width: numOrU(record.Width),
    Height: numOrU(record.Height),
  };
}

function validateClaimFormItemPayload(
  data: CreateClaimFormItemRequest | UpdateClaimFormItemRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).ClaimFormNum !== undefined, 'ClaimFormNum is required');
  need((data as any).FieldName !== undefined, 'FieldName is required');

  checkNum((data as any).ClaimFormNum, 'ClaimFormNum');
  checkNum((data as any).XPos, 'XPos');
  checkNum((data as any).YPos, 'YPos');
  checkNum((data as any).Width, 'Width');
  checkNum((data as any).Height, 'Height');

  if (data.FieldName !== undefined && data.FieldName.trim() === '') errors.push('FieldName cannot be blank');
  if (data.ImageFileName !== undefined && typeof data.ImageFileName !== 'string') errors.push('ImageFileName must be a string');
  if (data.FormatString !== undefined && typeof data.FormatString !== 'string') errors.push('FormatString must be a string');

  return errors;
}

async function handleGetClaimFormItems(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimFormItemNum, ClaimFormNum, ImageFileName, FieldName, FormatString, XPos, YPos, Width, Height, created_at, updated_at
      FROM claimformitem
      ORDER BY ClaimFormNum ASC, ClaimFormItemNum ASC
    `;
    const results = await executeQuery<ClaimFormItem[]>(query);
    const mapped = results.map(mapClaimFormItem);
    const response: ApiResponse<ClaimFormItem[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimformitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetClaimFormItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClaimFormItemNum, ClaimFormNum, ImageFileName, FieldName, FormatString, XPos, YPos, Width, Height, created_at, updated_at
      FROM claimformitem
      WHERE ClaimFormItemNum = ?
    `;
    const results = await executeQuery<ClaimFormItem[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimFormItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ClaimFormItem> = { success: true, data: mapClaimFormItem(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET claimformitem by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostClaimFormItem(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateClaimFormItemRequest = JSON.parse(event.body);
    const errors = validateClaimFormItemPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO claimformitem
      (ClaimFormNum, ImageFileName, FieldName, FormatString, XPos, YPos, Width, Height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ClaimFormNum,
      data.ImageFileName ?? null,
      data.FieldName.trim(),
      data.FormatString ?? null,
      data.XPos ?? null,
      data.YPos ?? null,
      data.Width ?? null,
      data.Height ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ClaimFormItemNum, ClaimFormNum, ImageFileName, FieldName, FormatString, XPos, YPos, Width, Height, created_at, updated_at
      FROM claimformitem
      WHERE ClaimFormItemNum = ?
    `;
    const records = await executeQuery<ClaimFormItem[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ClaimFormItem> = {
      success: true,
      data: mapClaimFormItem(records[0]),
      message: 'ClaimFormItem created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST claimformitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutClaimFormItem(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ClaimFormItemNum FROM claimformitem WHERE ClaimFormItemNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimFormItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateClaimFormItemRequest = JSON.parse(event.body);
    const errors = validateClaimFormItemPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ClaimFormNum !== undefined) { updateFields.push('ClaimFormNum = ?'); updateParams.push(data.ClaimFormNum); }
    if (data.ImageFileName !== undefined) { updateFields.push('ImageFileName = ?'); updateParams.push(data.ImageFileName ?? null); }
    if (data.FieldName !== undefined) { updateFields.push('FieldName = ?'); updateParams.push(data.FieldName.trim()); }
    if (data.FormatString !== undefined) { updateFields.push('FormatString = ?'); updateParams.push(data.FormatString ?? null); }
    if (data.XPos !== undefined) { updateFields.push('XPos = ?'); updateParams.push(data.XPos ?? null); }
    if (data.YPos !== undefined) { updateFields.push('YPos = ?'); updateParams.push(data.YPos ?? null); }
    if (data.Width !== undefined) { updateFields.push('Width = ?'); updateParams.push(data.Width ?? null); }
    if (data.Height !== undefined) { updateFields.push('Height = ?'); updateParams.push(data.Height ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE claimformitem
      SET ${updateFields.join(', ')}
      WHERE ClaimFormItemNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ClaimFormItemNum, ClaimFormNum, ImageFileName, FieldName, FormatString, XPos, YPos, Width, Height, created_at, updated_at
      FROM claimformitem
      WHERE ClaimFormItemNum = ?
    `;
    const records = await executeQuery<ClaimFormItem[]>(selectQuery, [id]);

    const response: ApiResponse<ClaimFormItem> = {
      success: true,
      data: mapClaimFormItem(records[0]),
      message: 'ClaimFormItem updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT claimformitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteClaimFormItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ClaimFormItemNum FROM claimformitem WHERE ClaimFormItemNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ClaimFormItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM claimformitem WHERE ClaimFormItemNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ClaimFormItem deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE claimformitem:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptThankYouSent(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptThankYouSentNum, ApptNum, ApptDateTime, ApptSecDateTEntry, TSPrior, ApptReminderRuleNum, ClinicNum, PatNum,
             ResponseDescript, DateTimeThankYouTransmit, ShortGUID, SendStatus, MessageType, MessageFk, DateTimeEntry, DateTimeSent, created_at, updated_at
      FROM apptthankyousent
      WHERE ApptThankYouSentNum = ?
    `;
    const results = await executeQuery<ApptThankYouSent[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptThankYouSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ApptThankYouSent> = { success: true, data: mapApptThankYouSent(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptthankyousent by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptThankYouSent(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptThankYouSentRequest = JSON.parse(event.body);
    const errors = validateApptThankYouSentPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptthankyousent
      (ApptNum, ApptDateTime, ApptSecDateTEntry, TSPrior, ApptReminderRuleNum, ClinicNum, PatNum, ResponseDescript, DateTimeThankYouTransmit, ShortGUID, SendStatus, MessageType, MessageFk, DateTimeEntry, DateTimeSent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ApptNum,
      data.ApptDateTime ?? null,
      data.ApptSecDateTEntry ?? null,
      data.TSPrior ?? null,
      data.ApptReminderRuleNum ?? null,
      data.ClinicNum ?? null,
      data.PatNum ?? null,
      data.ResponseDescript ?? null,
      data.DateTimeThankYouTransmit ?? null,
      data.ShortGUID ?? null,
      data.SendStatus ?? null,
      data.MessageType ?? null,
      data.MessageFk ?? null,
      data.DateTimeEntry ?? null,
      data.DateTimeSent ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptThankYouSentNum, ApptNum, ApptDateTime, ApptSecDateTEntry, TSPrior, ApptReminderRuleNum, ClinicNum, PatNum,
             ResponseDescript, DateTimeThankYouTransmit, ShortGUID, SendStatus, MessageType, MessageFk, DateTimeEntry, DateTimeSent, created_at, updated_at
      FROM apptthankyousent
      WHERE ApptThankYouSentNum = ?
    `;
    const records = await executeQuery<ApptThankYouSent[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptThankYouSent> = {
      success: true,
      data: mapApptThankYouSent(records[0]),
      message: 'ApptThankYouSent created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptthankyousent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptThankYouSent(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptThankYouSentNum FROM apptthankyousent WHERE ApptThankYouSentNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptThankYouSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptThankYouSentRequest = JSON.parse(event.body);
    const errors = validateApptThankYouSentPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ApptNum !== undefined) { updateFields.push('ApptNum = ?'); updateParams.push(data.ApptNum); }
    if (data.ApptDateTime !== undefined) { updateFields.push('ApptDateTime = ?'); updateParams.push(data.ApptDateTime ?? null); }
    if (data.ApptSecDateTEntry !== undefined) { updateFields.push('ApptSecDateTEntry = ?'); updateParams.push(data.ApptSecDateTEntry ?? null); }
    if (data.TSPrior !== undefined) { updateFields.push('TSPrior = ?'); updateParams.push(data.TSPrior ?? null); }
    if (data.ApptReminderRuleNum !== undefined) { updateFields.push('ApptReminderRuleNum = ?'); updateParams.push(data.ApptReminderRuleNum ?? null); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum ?? null); }
    if (data.PatNum !== undefined) { updateFields.push('PatNum = ?'); updateParams.push(data.PatNum ?? null); }
    if (data.ResponseDescript !== undefined) { updateFields.push('ResponseDescript = ?'); updateParams.push(data.ResponseDescript ?? null); }
    if (data.DateTimeThankYouTransmit !== undefined) { updateFields.push('DateTimeThankYouTransmit = ?'); updateParams.push(data.DateTimeThankYouTransmit ?? null); }
    if (data.ShortGUID !== undefined) { updateFields.push('ShortGUID = ?'); updateParams.push(data.ShortGUID ?? null); }
    if (data.SendStatus !== undefined) { updateFields.push('SendStatus = ?'); updateParams.push(data.SendStatus ?? null); }
    if (data.MessageType !== undefined) { updateFields.push('MessageType = ?'); updateParams.push(data.MessageType ?? null); }
    if (data.MessageFk !== undefined) { updateFields.push('MessageFk = ?'); updateParams.push(data.MessageFk ?? null); }
    if (data.DateTimeEntry !== undefined) { updateFields.push('DateTimeEntry = ?'); updateParams.push(data.DateTimeEntry ?? null); }
    if (data.DateTimeSent !== undefined) { updateFields.push('DateTimeSent = ?'); updateParams.push(data.DateTimeSent ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptthankyousent
      SET ${updateFields.join(', ')}
      WHERE ApptThankYouSentNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptThankYouSentNum, ApptNum, ApptDateTime, ApptSecDateTEntry, TSPrior, ApptReminderRuleNum, ClinicNum, PatNum,
             ResponseDescript, DateTimeThankYouTransmit, ShortGUID, SendStatus, MessageType, MessageFk, DateTimeEntry, DateTimeSent, created_at, updated_at
      FROM apptthankyousent
      WHERE ApptThankYouSentNum = ?
    `;
    const records = await executeQuery<ApptThankYouSent[]>(selectQuery, [id]);

    const response: ApiResponse<ApptThankYouSent> = {
      success: true,
      data: mapApptThankYouSent(records[0]),
      message: 'ApptThankYouSent updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptthankyousent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptThankYouSent(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptThankYouSentNum FROM apptthankyousent WHERE ApptThankYouSentNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptThankYouSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptthankyousent WHERE ApptThankYouSentNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptThankYouSent deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptthankyousent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// APPOINTMENT HANDLERS
// ========================================

function mapAppointment(record: any): Appointment {
  return {
    ...record,
    AptNum: Number(record.AptNum),
    PatNum: Number(record.PatNum),
    AptStatus: Number(record.AptStatus) as ApptStatus,
    Confirmed: record.Confirmed !== null ? Number(record.Confirmed) : null,
    TimeLocked: Boolean(record.TimeLocked),
    Op: record.Op !== null ? Number(record.Op) : null,
    ProvNum: record.ProvNum !== null ? Number(record.ProvNum) : null,
    ProvHyg: record.ProvHyg !== null ? Number(record.ProvHyg) : null,
    NextAptNum: record.NextAptNum !== null ? Number(record.NextAptNum) : null,
    UnschedStatus: record.UnschedStatus !== null ? Number(record.UnschedStatus) : null,
    IsNewPatient: Boolean(record.IsNewPatient),
    Assistant: record.Assistant !== null ? Number(record.Assistant) : null,
    ClinicNum: record.ClinicNum !== null ? Number(record.ClinicNum) : null,
    IsHygiene: Boolean(record.IsHygiene),
    InsPlan1: record.InsPlan1 !== null ? Number(record.InsPlan1) : null,
    InsPlan2: record.InsPlan2 !== null ? Number(record.InsPlan2) : null,
    ColorOverride: record.ColorOverride !== null ? Number(record.ColorOverride) : null,
    AppointmentTypeNum: record.AppointmentTypeNum !== null ? Number(record.AppointmentTypeNum) : null,
    SecUserNumEntry: record.SecUserNumEntry !== null ? Number(record.SecUserNumEntry) : null,
    Priority: record.Priority !== null ? Number(record.Priority) as ApptPriority : undefined,
    ItemOrderPlanned: record.ItemOrderPlanned !== null ? Number(record.ItemOrderPlanned) : null,
    IsMirrored: Boolean(record.IsMirrored),
  };
}

function validateAppointmentPayload(
  data: CreateAppointmentRequest | UpdateAppointmentRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNumber = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).PatNum !== undefined, 'PatNum is required');
  need((data as any).AptStatus !== undefined, 'AptStatus is required');
  need((data as any).Pattern !== undefined, 'Pattern is required');

  if (data.Pattern !== undefined && data.Pattern.trim() === '') errors.push('Pattern cannot be blank');

  if ((data as any).AptStatus !== undefined) {
    const n = Number((data as any).AptStatus);
    if (n < ApptStatus.None || n > ApptStatus.PtNoteCompleted) {
      errors.push('AptStatus out of range');
    }
  }
  if ((data as any).Priority !== undefined) {
    const n = Number((data as any).Priority);
    if (n < ApptPriority.Normal || n > ApptPriority.ASAP) {
      errors.push('Priority must be 0 or 1');
    }
  }

  checkNumber((data as any).PatNum, 'PatNum');
  checkNumber((data as any).Confirmed, 'Confirmed', true);
  checkNumber((data as any).Op, 'Op', true);
  checkNumber((data as any).ProvNum, 'ProvNum', true);
  checkNumber((data as any).ProvHyg, 'ProvHyg', true);
  checkNumber((data as any).NextAptNum, 'NextAptNum', true);
  checkNumber((data as any).UnschedStatus, 'UnschedStatus', true);
  checkNumber((data as any).Assistant, 'Assistant', true);
  checkNumber((data as any).ClinicNum, 'ClinicNum', true);
  checkNumber((data as any).InsPlan1, 'InsPlan1', true);
  checkNumber((data as any).InsPlan2, 'InsPlan2', true);
  checkNumber((data as any).ColorOverride, 'ColorOverride', true);
  checkNumber((data as any).AppointmentTypeNum, 'AppointmentTypeNum', true);
  checkNumber((data as any).SecUserNumEntry, 'SecUserNumEntry', true);
  checkNumber((data as any).ItemOrderPlanned, 'ItemOrderPlanned', true);

  return errors;
}

async function handleGetAppointments(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT * FROM appointment
      ORDER BY AptDateTime IS NULL, AptDateTime ASC, AptNum DESC
    `;
    const results = await executeQuery<Appointment[]>(query);
    const appts = results.map(mapAppointment);
    const response: ApiResponse<Appointment[]> = { success: true, data: appts };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET appointment:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAppointment(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `SELECT * FROM appointment WHERE AptNum = ?`;
    const results = await executeQuery<Appointment[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Appointment not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<Appointment> = { success: true, data: mapAppointment(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET appointment by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAppointment(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAppointmentRequest = JSON.parse(event.body);
    const errors = validateAppointmentPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO appointment
      (PatNum, AptStatus, Pattern, Confirmed, TimeLocked, Op, Note, ProvNum, ProvHyg, AptDateTime, NextAptNum, UnschedStatus, IsNewPatient, ProcDescript, Assistant, ClinicNum, IsHygiene, DateTimeArrived, DateTimeSeated, DateTimeDismissed, InsPlan1, InsPlan2, DateTimeAskedToArrive, ProcsColored, ColorOverride, AppointmentTypeNum, SecUserNumEntry, Priority, ProvBarText, PatternSecondary, SecurityHash, ItemOrderPlanned, IsMirrored)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.PatNum,
      data.AptStatus,
      data.Pattern.trim(),
      data.Confirmed ?? null,
      data.TimeLocked ? 1 : 0,
      data.Op ?? null,
      data.Note ?? null,
      data.ProvNum ?? null,
      data.ProvHyg ?? null,
      data.AptDateTime ?? null,
      data.NextAptNum ?? null,
      data.UnschedStatus ?? null,
      data.IsNewPatient ? 1 : 0,
      data.ProcDescript ?? null,
      data.Assistant ?? null,
      data.ClinicNum ?? null,
      data.IsHygiene ? 1 : 0,
      data.DateTimeArrived ?? null,
      data.DateTimeSeated ?? null,
      data.DateTimeDismissed ?? null,
      data.InsPlan1 ?? null,
      data.InsPlan2 ?? null,
      data.DateTimeAskedToArrive ?? null,
      data.ProcsColored ?? null,
      data.ColorOverride ?? null,
      data.AppointmentTypeNum ?? null,
      data.SecUserNumEntry ?? null,
      data.Priority ?? ApptPriority.Normal,
      data.ProvBarText ?? null,
      data.PatternSecondary ?? null,
      data.SecurityHash ?? null,
      data.ItemOrderPlanned ?? null,
      data.IsMirrored ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `SELECT * FROM appointment WHERE AptNum = ?`;
    const records = await executeQuery<Appointment[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Appointment> = {
      success: true,
      data: mapAppointment(records[0]),
      message: 'Appointment created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST appointment:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAppointment(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const exists = await executeQuery<any[]>(`SELECT AptNum FROM appointment WHERE AptNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Appointment not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAppointmentRequest = JSON.parse(event.body);
    const errors = validateAppointmentPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.PatNum !== undefined) { updateFields.push('PatNum = ?'); updateParams.push(data.PatNum); }
    if (data.AptStatus !== undefined) { updateFields.push('AptStatus = ?'); updateParams.push(data.AptStatus); }
    if (data.Pattern !== undefined) { updateFields.push('Pattern = ?'); updateParams.push(data.Pattern.trim()); }
    if (data.Confirmed !== undefined) { updateFields.push('Confirmed = ?'); updateParams.push(data.Confirmed ?? null); }
    if (data.TimeLocked !== undefined) { updateFields.push('TimeLocked = ?'); updateParams.push(data.TimeLocked ? 1 : 0); }
    if (data.Op !== undefined) { updateFields.push('Op = ?'); updateParams.push(data.Op ?? null); }
    if (data.Note !== undefined) { updateFields.push('Note = ?'); updateParams.push(data.Note ?? null); }
    if (data.ProvNum !== undefined) { updateFields.push('ProvNum = ?'); updateParams.push(data.ProvNum ?? null); }
    if (data.ProvHyg !== undefined) { updateFields.push('ProvHyg = ?'); updateParams.push(data.ProvHyg ?? null); }
    if (data.AptDateTime !== undefined) { updateFields.push('AptDateTime = ?'); updateParams.push(data.AptDateTime ?? null); }
    if (data.NextAptNum !== undefined) { updateFields.push('NextAptNum = ?'); updateParams.push(data.NextAptNum ?? null); }
    if (data.UnschedStatus !== undefined) { updateFields.push('UnschedStatus = ?'); updateParams.push(data.UnschedStatus ?? null); }
    if (data.IsNewPatient !== undefined) { updateFields.push('IsNewPatient = ?'); updateParams.push(data.IsNewPatient ? 1 : 0); }
    if (data.ProcDescript !== undefined) { updateFields.push('ProcDescript = ?'); updateParams.push(data.ProcDescript ?? null); }
    if (data.Assistant !== undefined) { updateFields.push('Assistant = ?'); updateParams.push(data.Assistant ?? null); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum ?? null); }
    if (data.IsHygiene !== undefined) { updateFields.push('IsHygiene = ?'); updateParams.push(data.IsHygiene ? 1 : 0); }
    if (data.DateTimeArrived !== undefined) { updateFields.push('DateTimeArrived = ?'); updateParams.push(data.DateTimeArrived ?? null); }
    if (data.DateTimeSeated !== undefined) { updateFields.push('DateTimeSeated = ?'); updateParams.push(data.DateTimeSeated ?? null); }
    if (data.DateTimeDismissed !== undefined) { updateFields.push('DateTimeDismissed = ?'); updateParams.push(data.DateTimeDismissed ?? null); }
    if (data.InsPlan1 !== undefined) { updateFields.push('InsPlan1 = ?'); updateParams.push(data.InsPlan1 ?? null); }
    if (data.InsPlan2 !== undefined) { updateFields.push('InsPlan2 = ?'); updateParams.push(data.InsPlan2 ?? null); }
    if (data.DateTimeAskedToArrive !== undefined) { updateFields.push('DateTimeAskedToArrive = ?'); updateParams.push(data.DateTimeAskedToArrive ?? null); }
    if (data.ProcsColored !== undefined) { updateFields.push('ProcsColored = ?'); updateParams.push(data.ProcsColored ?? null); }
    if (data.ColorOverride !== undefined) { updateFields.push('ColorOverride = ?'); updateParams.push(data.ColorOverride ?? null); }
    if (data.AppointmentTypeNum !== undefined) { updateFields.push('AppointmentTypeNum = ?'); updateParams.push(data.AppointmentTypeNum ?? null); }
    if (data.SecUserNumEntry !== undefined) { updateFields.push('SecUserNumEntry = ?'); updateParams.push(data.SecUserNumEntry ?? null); }
    if (data.Priority !== undefined) { updateFields.push('Priority = ?'); updateParams.push(data.Priority ?? ApptPriority.Normal); }
    if (data.ProvBarText !== undefined) { updateFields.push('ProvBarText = ?'); updateParams.push(data.ProvBarText ?? null); }
    if (data.PatternSecondary !== undefined) { updateFields.push('PatternSecondary = ?'); updateParams.push(data.PatternSecondary ?? null); }
    if (data.SecurityHash !== undefined) { updateFields.push('SecurityHash = ?'); updateParams.push(data.SecurityHash ?? null); }
    if (data.ItemOrderPlanned !== undefined) { updateFields.push('ItemOrderPlanned = ?'); updateParams.push(data.ItemOrderPlanned ?? null); }
    if (data.IsMirrored !== undefined) { updateFields.push('IsMirrored = ?'); updateParams.push(data.IsMirrored ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE appointment
      SET ${updateFields.join(', ')}
      WHERE AptNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `SELECT * FROM appointment WHERE AptNum = ?`;
    const records = await executeQuery<Appointment[]>(selectQuery, [id]);

    const response: ApiResponse<Appointment> = {
      success: true,
      data: mapAppointment(records[0]),
      message: 'Appointment updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT appointment:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAppointment(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AptNum FROM appointment WHERE AptNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Appointment not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM appointment WHERE AptNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'Appointment deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE appointment:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetClinic(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ClinicNum, Description, Address, Address2, City, State, Zip, Phone, BankNumber
      FROM clinic
      WHERE ClinicNum = ?
    `;
    
    const results = await executeQuery<Clinic[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Clinic not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<Clinic> = {
      success: true,
      data: results[0],
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET clinic:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPOINTMENT RULE HANDLERS
// ========================================

function mapAppointmentRule(record: any): AppointmentRule {
  return {
    ...record,
    AppointmentRuleNum: Number(record.AppointmentRuleNum),
    IsEnabled: Boolean(record.IsEnabled),
  };
}

function validateAppointmentRulePayload(
  data: CreateAppointmentRuleRequest | UpdateAppointmentRuleRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need(data.RuleDesc !== undefined, 'RuleDesc is required');
  need(data.CodeStart !== undefined, 'CodeStart is required');
  need(data.CodeEnd !== undefined, 'CodeEnd is required');

  if (data.RuleDesc !== undefined && data.RuleDesc.trim() === '') errors.push('RuleDesc cannot be blank');
  if (data.CodeStart !== undefined && data.CodeStart.trim() === '') errors.push('CodeStart cannot be blank');
  if (data.CodeEnd !== undefined && data.CodeEnd.trim() === '') errors.push('CodeEnd cannot be blank');

  return errors;
}

async function handleGetAppointmentRules(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AppointmentRuleNum, RuleDesc, CodeStart, CodeEnd, IsEnabled, created_at, updated_at
      FROM appointmentrule
      ORDER BY AppointmentRuleNum DESC
    `;
    const results = await executeQuery<AppointmentRule[]>(query);
    const rules = results.map(mapAppointmentRule);

    const response: ApiResponse<AppointmentRule[]> = { success: true, data: rules };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET appointmentrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAppointmentRule(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AppointmentRuleNum, RuleDesc, CodeStart, CodeEnd, IsEnabled, created_at, updated_at
      FROM appointmentrule
      WHERE AppointmentRuleNum = ?
    `;
    const results = await executeQuery<AppointmentRule[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AppointmentRule not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<AppointmentRule> = { success: true, data: mapAppointmentRule(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET appointmentrule by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAppointmentRule(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAppointmentRuleRequest = JSON.parse(event.body);
    const errors = validateAppointmentRulePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO appointmentrule (RuleDesc, CodeStart, CodeEnd, IsEnabled)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.RuleDesc.trim(),
      data.CodeStart.trim(),
      data.CodeEnd.trim(),
      data.IsEnabled ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AppointmentRuleNum, RuleDesc, CodeStart, CodeEnd, IsEnabled, created_at, updated_at
      FROM appointmentrule
      WHERE AppointmentRuleNum = ?
    `;
    const records = await executeQuery<AppointmentRule[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AppointmentRule> = {
      success: true,
      data: mapAppointmentRule(records[0]),
      message: 'AppointmentRule created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST appointmentrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAppointmentRule(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AppointmentRuleNum FROM appointmentrule WHERE AppointmentRuleNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AppointmentRule not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAppointmentRuleRequest = JSON.parse(event.body);
    const errors = validateAppointmentRulePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.RuleDesc !== undefined) { updateFields.push('RuleDesc = ?'); updateParams.push(data.RuleDesc.trim()); }
    if (data.CodeStart !== undefined) { updateFields.push('CodeStart = ?'); updateParams.push(data.CodeStart.trim()); }
    if (data.CodeEnd !== undefined) { updateFields.push('CodeEnd = ?'); updateParams.push(data.CodeEnd.trim()); }
    if (data.IsEnabled !== undefined) { updateFields.push('IsEnabled = ?'); updateParams.push(data.IsEnabled ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE appointmentrule
      SET ${updateFields.join(', ')}
      WHERE AppointmentRuleNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AppointmentRuleNum, RuleDesc, CodeStart, CodeEnd, IsEnabled, created_at, updated_at
      FROM appointmentrule
      WHERE AppointmentRuleNum = ?
    `;
    const records = await executeQuery<AppointmentRule[]>(selectQuery, [id]);

    const response: ApiResponse<AppointmentRule> = {
      success: true,
      data: mapAppointmentRule(records[0]),
      message: 'AppointmentRule updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT appointmentrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAppointmentRule(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AppointmentRuleNum FROM appointmentrule WHERE AppointmentRuleNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AppointmentRule not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM appointmentrule WHERE AppointmentRuleNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AppointmentRule deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE appointmentrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostClinic(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const clinicData: CreateClinicRequest = JSON.parse(event.body);

    if (!clinicData.Description || clinicData.Description.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'Description is required and cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (clinicData.Phone) {
      const phoneDigits = clinicData.Phone.replace(/\D/g, '');
      if (phoneDigits.length !== 0 && phoneDigits.length !== 10) {
        const response: ApiResponse = {
          success: false,
          error: 'Phone must be exactly 10 digits or blank',
        };

        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify(response),
        };
      }
      clinicData.Phone = phoneDigits;
    }

    const insertQuery = `
      INSERT INTO clinic 
      (Description, Address, Address2, City, State, Zip, Phone, BankNumber)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      clinicData.Description,
      clinicData.Address || null,
      clinicData.Address2 || null,
      clinicData.City || null,
      clinicData.State || null,
      clinicData.Zip || null,
      clinicData.Phone || null,
      clinicData.BankNumber || null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ClinicNum, Description, Address, Address2, City, State, Zip, Phone, BankNumber
      FROM clinic
      WHERE ClinicNum = ?
    `;

    const clinics = await executeQuery<Clinic[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Clinic> = {
      success: true,
      data: clinics[0],
      message: 'Clinic created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST clinic:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPOINTMENT TYPE HANDLERS
// ========================================

function mapAppointmentType(record: any): AppointmentType {
  return {
    ...record,
    AppointmentTypeNum: Number(record.AppointmentTypeNum),
    ItemOrder: record.ItemOrder !== null ? Number(record.ItemOrder) : null,
    AppointmentTypeColor: record.AppointmentTypeColor !== null ? Number(record.AppointmentTypeColor) : null,
    IsHidden: Boolean(record.IsHidden),
    RequiredProcCodesNeeded: record.RequiredProcCodesNeeded !== null ? Number(record.RequiredProcCodesNeeded) as RequiredProcCodesNeeded : null,
  };
}

function validateAppointmentTypePayload(
  data: CreateAppointmentTypeRequest | UpdateAppointmentTypeRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  need(data.AppointmentTypeName !== undefined, 'AppointmentTypeName is required');

  if (data.AppointmentTypeName !== undefined && data.AppointmentTypeName.trim() === '') {
    errors.push('AppointmentTypeName cannot be blank');
  }

  if (data.RequiredProcCodesNeeded !== undefined) {
    const val = Number(data.RequiredProcCodesNeeded);
    if (val < RequiredProcCodesNeeded.None || val > RequiredProcCodesNeeded.All) {
      errors.push('RequiredProcCodesNeeded must be 0, 1, or 2');
    }
  }

  return errors;
}

async function handleGetAppointmentTypes(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AppointmentTypeNum, AppointmentTypeName, AppointmentTypeColor, ItemOrder, IsHidden, Pattern, CodeStr, CodeStrRequired, RequiredProcCodesNeeded, BlockoutTypes, created_at, updated_at
      FROM appointmenttype
      ORDER BY ItemOrder ASC, AppointmentTypeName ASC
    `;

    const results = await executeQuery<AppointmentType[]>(query);
    const types = results.map(mapAppointmentType);

    const response: ApiResponse<AppointmentType[]> = { success: true, data: types };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET appointmenttype:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAppointmentType(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AppointmentTypeNum, AppointmentTypeName, AppointmentTypeColor, ItemOrder, IsHidden, Pattern, CodeStr, CodeStrRequired, RequiredProcCodesNeeded, BlockoutTypes, created_at, updated_at
      FROM appointmenttype
      WHERE AppointmentTypeNum = ?
    `;

    const results = await executeQuery<AppointmentType[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AppointmentType not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<AppointmentType> = { success: true, data: mapAppointmentType(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET appointmenttype by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAppointmentType(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateAppointmentTypeRequest = JSON.parse(event.body);
    const errors = validateAppointmentTypePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO appointmenttype
      (AppointmentTypeName, AppointmentTypeColor, ItemOrder, IsHidden, Pattern, CodeStr, CodeStrRequired, RequiredProcCodesNeeded, BlockoutTypes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.AppointmentTypeName.trim(),
      data.AppointmentTypeColor ?? null,
      data.ItemOrder ?? 0,
      data.IsHidden ? 1 : 0,
      data.Pattern ?? null,
      data.CodeStr ?? null,
      data.CodeStrRequired ?? null,
      data.RequiredProcCodesNeeded ?? RequiredProcCodesNeeded.None,
      data.BlockoutTypes ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AppointmentTypeNum, AppointmentTypeName, AppointmentTypeColor, ItemOrder, IsHidden, Pattern, CodeStr, CodeStrRequired, RequiredProcCodesNeeded, BlockoutTypes, created_at, updated_at
      FROM appointmenttype
      WHERE AppointmentTypeNum = ?
    `;
    const records = await executeQuery<AppointmentType[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AppointmentType> = {
      success: true,
      data: mapAppointmentType(records[0]),
      message: 'AppointmentType created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST appointmenttype:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAppointmentType(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT AppointmentTypeNum FROM appointmenttype WHERE AppointmentTypeNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AppointmentType not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAppointmentTypeRequest = JSON.parse(event.body);
    const errors = validateAppointmentTypePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AppointmentTypeName !== undefined) { updateFields.push('AppointmentTypeName = ?'); updateParams.push(data.AppointmentTypeName.trim()); }
    if (data.AppointmentTypeColor !== undefined) { updateFields.push('AppointmentTypeColor = ?'); updateParams.push(data.AppointmentTypeColor ?? null); }
    if (data.ItemOrder !== undefined) { updateFields.push('ItemOrder = ?'); updateParams.push(data.ItemOrder ?? 0); }
    if (data.IsHidden !== undefined) { updateFields.push('IsHidden = ?'); updateParams.push(data.IsHidden ? 1 : 0); }
    if (data.Pattern !== undefined) { updateFields.push('Pattern = ?'); updateParams.push(data.Pattern ?? null); }
    if (data.CodeStr !== undefined) { updateFields.push('CodeStr = ?'); updateParams.push(data.CodeStr ?? null); }
    if (data.CodeStrRequired !== undefined) { updateFields.push('CodeStrRequired = ?'); updateParams.push(data.CodeStrRequired ?? null); }
    if (data.RequiredProcCodesNeeded !== undefined) { updateFields.push('RequiredProcCodesNeeded = ?'); updateParams.push(data.RequiredProcCodesNeeded ?? RequiredProcCodesNeeded.None); }
    if (data.BlockoutTypes !== undefined) { updateFields.push('BlockoutTypes = ?'); updateParams.push(data.BlockoutTypes ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE appointmenttype
      SET ${updateFields.join(', ')}
      WHERE AppointmentTypeNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AppointmentTypeNum, AppointmentTypeName, AppointmentTypeColor, ItemOrder, IsHidden, Pattern, CodeStr, CodeStrRequired, RequiredProcCodesNeeded, BlockoutTypes, created_at, updated_at
      FROM appointmenttype
      WHERE AppointmentTypeNum = ?
    `;
    const records = await executeQuery<AppointmentType[]>(selectQuery, [id]);

    const response: ApiResponse<AppointmentType> = {
      success: true,
      data: mapAppointmentType(records[0]),
      message: 'AppointmentType updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT appointmenttype:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAppointmentType(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT AppointmentTypeNum FROM appointmenttype WHERE AppointmentTypeNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AppointmentType not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM appointmenttype WHERE AppointmentTypeNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'AppointmentType deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE appointmenttype:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutClinic(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateData: UpdateClinicRequest = JSON.parse(event.body);

    const checkQuery = `SELECT ClinicNum FROM clinic WHERE ClinicNum = ?`;
    const existingClinics = await executeQuery<Clinic[]>(checkQuery, [id]);

    if (existingClinics.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Clinic not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (updateData.Description !== undefined && updateData.Description.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'Description cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (updateData.Phone !== undefined) {
      const phoneDigits = updateData.Phone.replace(/\D/g, '');
      if (phoneDigits.length !== 0 && phoneDigits.length !== 10) {
        const response: ApiResponse = {
          success: false,
          error: 'Phone must be exactly 10 digits or blank',
        };

        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify(response),
        };
      }
      updateData.Phone = phoneDigits;
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (updateData.Description !== undefined) {
      updateFields.push('Description = ?');
      updateParams.push(updateData.Description);
    }
    if (updateData.Address !== undefined) {
      updateFields.push('Address = ?');
      updateParams.push(updateData.Address || null);
    }
    if (updateData.Address2 !== undefined) {
      updateFields.push('Address2 = ?');
      updateParams.push(updateData.Address2 || null);
    }
    if (updateData.City !== undefined) {
      updateFields.push('City = ?');
      updateParams.push(updateData.City || null);
    }
    if (updateData.State !== undefined) {
      updateFields.push('State = ?');
      updateParams.push(updateData.State || null);
    }
    if (updateData.Zip !== undefined) {
      updateFields.push('Zip = ?');
      updateParams.push(updateData.Zip || null);
    }
    if (updateData.Phone !== undefined) {
      updateFields.push('Phone = ?');
      updateParams.push(updateData.Phone || null);
    }
    if (updateData.BankNumber !== undefined) {
      updateFields.push('BankNumber = ?');
      updateParams.push(updateData.BankNumber || null);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No fields to update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE clinic
      SET ${updateFields.join(', ')}
      WHERE ClinicNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ClinicNum, Description, Address, Address2, City, State, Zip, Phone, BankNumber
      FROM clinic
      WHERE ClinicNum = ?
    `;

    const clinics = await executeQuery<Clinic[]>(selectQuery, [id]);

    const response: ApiResponse<Clinic> = {
      success: true,
      data: clinics[0],
      message: 'Clinic updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT clinic:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPTFIELDDEF HANDLERS
// ========================================

function mapApptFieldDef(record: any): ApptFieldDef {
  return {
    ...record,
    ApptFieldDefNum: Number(record.ApptFieldDefNum),
    FieldType: Number(record.FieldType) as ApptFieldType,
    ItemOrder: record.ItemOrder !== null ? Number(record.ItemOrder) : null,
  };
}

function validateApptFieldDefPayload(
  data: CreateApptFieldDefRequest | UpdateApptFieldDefRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need(data.FieldName !== undefined, 'FieldName is required');
  need(data.FieldType !== undefined, 'FieldType is required');

  if (data.FieldName !== undefined && data.FieldName.trim() === '') {
    errors.push('FieldName cannot be blank');
  }

  if (data.FieldType !== undefined) {
    const val = Number(data.FieldType);
    if (val < ApptFieldType.Text || val > ApptFieldType.PickList) {
      errors.push('FieldType must be 0 (Text) or 1 (PickList)');
    }
  }

  return errors;
}

async function handleGetApptFieldDefs(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptFieldDefNum, FieldName, FieldType, PickList, ItemOrder, created_at, updated_at
      FROM apptfielddef
      ORDER BY ItemOrder ASC, FieldName ASC
    `;

    const results = await executeQuery<ApptFieldDef[]>(query);
    const defs = results.map(mapApptFieldDef);

    const response: ApiResponse<ApptFieldDef[]> = { success: true, data: defs };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptfielddef:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptFieldDef(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptFieldDefNum, FieldName, FieldType, PickList, ItemOrder, created_at, updated_at
      FROM apptfielddef
      WHERE ApptFieldDefNum = ?
    `;

    const results = await executeQuery<ApptFieldDef[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptFieldDef not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<ApptFieldDef> = { success: true, data: mapApptFieldDef(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptfielddef by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptFieldDef(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptFieldDefRequest = JSON.parse(event.body);
    const errors = validateApptFieldDefPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptfielddef (FieldName, FieldType, PickList, ItemOrder)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      data.FieldName.trim(),
      data.FieldType,
      data.PickList ?? null,
      data.ItemOrder ?? 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptFieldDefNum, FieldName, FieldType, PickList, ItemOrder, created_at, updated_at
      FROM apptfielddef
      WHERE ApptFieldDefNum = ?
    `;
    const records = await executeQuery<ApptFieldDef[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptFieldDef> = {
      success: true,
      data: mapApptFieldDef(records[0]),
      message: 'ApptFieldDef created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptfielddef:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptFieldDef(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptFieldDefNum FROM apptfielddef WHERE ApptFieldDefNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptFieldDef not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptFieldDefRequest = JSON.parse(event.body);
    const errors = validateApptFieldDefPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.FieldName !== undefined) { updateFields.push('FieldName = ?'); updateParams.push(data.FieldName.trim()); }
    if (data.FieldType !== undefined) { updateFields.push('FieldType = ?'); updateParams.push(data.FieldType); }
    if (data.PickList !== undefined) { updateFields.push('PickList = ?'); updateParams.push(data.PickList ?? null); }
    if (data.ItemOrder !== undefined) { updateFields.push('ItemOrder = ?'); updateParams.push(data.ItemOrder ?? 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptfielddef
      SET ${updateFields.join(', ')}
      WHERE ApptFieldDefNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptFieldDefNum, FieldName, FieldType, PickList, ItemOrder, created_at, updated_at
      FROM apptfielddef
      WHERE ApptFieldDefNum = ?
    `;
    const records = await executeQuery<ApptFieldDef[]>(selectQuery, [id]);

    const response: ApiResponse<ApptFieldDef> = {
      success: true,
      data: mapApptFieldDef(records[0]),
      message: 'ApptFieldDef updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptfielddef:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptFieldDef(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptFieldDefNum FROM apptfielddef WHERE ApptFieldDefNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptFieldDef not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptfielddef WHERE ApptFieldDefNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptFieldDef deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptfielddef:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// APPTFIELD HANDLERS
// ========================================

function mapApptField(record: any): ApptField {
  return {
    ...record,
    ApptFieldNum: Number(record.ApptFieldNum),
    AptNum: Number(record.AptNum),
  };
}

function validateApptFieldPayload(
  data: CreateApptFieldRequest | UpdateApptFieldRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  need((data as any).AptNum !== undefined, 'AptNum is required');
  need((data as any).FieldName !== undefined, 'FieldName is required');

  if (data.FieldName !== undefined && data.FieldName.trim() === '') {
    errors.push('FieldName cannot be blank');
  }

  if ((data as any).AptNum !== undefined) {
    const n = Number((data as any).AptNum);
    if (!Number.isFinite(n) || n <= 0) errors.push('AptNum must be a positive number');
  }

  return errors;
}

async function handleGetApptFields(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptFieldNum, AptNum, FieldName, FieldValue, created_at, updated_at
      FROM apptfield
      ORDER BY ApptFieldNum DESC
    `;

    const results = await executeQuery<ApptField[]>(query);
    const fields = results.map(mapApptField);

    const response: ApiResponse<ApptField[]> = { success: true, data: fields };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptfield:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptField(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptFieldNum, AptNum, FieldName, FieldValue, created_at, updated_at
      FROM apptfield
      WHERE ApptFieldNum = ?
    `;

    const results = await executeQuery<ApptField[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptField not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<ApptField> = { success: true, data: mapApptField(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptfield by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptField(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptFieldRequest = JSON.parse(event.body);
    const errors = validateApptFieldPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptfield (AptNum, FieldName, FieldValue)
      VALUES (?, ?, ?)
    `;
    const params = [
      data.AptNum,
      data.FieldName.trim(),
      data.FieldValue ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptFieldNum, AptNum, FieldName, FieldValue, created_at, updated_at
      FROM apptfield
      WHERE ApptFieldNum = ?
    `;
    const records = await executeQuery<ApptField[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptField> = {
      success: true,
      data: mapApptField(records[0]),
      message: 'ApptField created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptfield:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptField(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptFieldNum FROM apptfield WHERE ApptFieldNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptField not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptFieldRequest = JSON.parse(event.body);
    const errors = validateApptFieldPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AptNum !== undefined) { updateFields.push('AptNum = ?'); updateParams.push(data.AptNum); }
    if (data.FieldName !== undefined) { updateFields.push('FieldName = ?'); updateParams.push(data.FieldName.trim()); }
    if (data.FieldValue !== undefined) { updateFields.push('FieldValue = ?'); updateParams.push(data.FieldValue ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptfield
      SET ${updateFields.join(', ')}
      WHERE ApptFieldNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptFieldNum, AptNum, FieldName, FieldValue, created_at, updated_at
      FROM apptfield
      WHERE ApptFieldNum = ?
    `;
    const records = await executeQuery<ApptField[]>(selectQuery, [id]);

    const response: ApiResponse<ApptField> = {
      success: true,
      data: mapApptField(records[0]),
      message: 'ApptField updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptfield:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptField(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptFieldNum FROM apptfield WHERE ApptFieldNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptField not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptfield WHERE ApptFieldNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptField deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptfield:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteClinic(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT ClinicNum FROM clinic WHERE ClinicNum = ?`;
    const existingClinics = await executeQuery<any[]>(checkQuery, [id]);

    if (existingClinics.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Clinic not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM clinic WHERE ClinicNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'Clinic deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE clinic:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPTGENERALMESSAGESENT HANDLERS
// ========================================

function mapApptGeneralMessageSent(record: any): ApptGeneralMessageSent {
  return {
    ...record,
    ApptGeneralMessageSentNum: Number(record.ApptGeneralMessageSentNum),
    ApptNum: Number(record.ApptNum),
    PatNum: Number(record.PatNum),
    ClinicNum: Number(record.ClinicNum),
    TSPrior: record.TSPrior !== null ? Number(record.TSPrior) : null,
    ApptReminderRuleNum: record.ApptReminderRuleNum !== null ? Number(record.ApptReminderRuleNum) : null,
    SendStatus: record.SendStatus !== null ? Number(record.SendStatus) : null,
    MessageType: record.MessageType !== null ? Number(record.MessageType) : null,
    MessageFk: record.MessageFk !== null ? Number(record.MessageFk) : null,
  };
}

function validateApptGeneralMessageSentPayload(
  data: CreateApptGeneralMessageSentRequest | UpdateApptGeneralMessageSentRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkPos = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  need((data as any).ApptNum !== undefined, 'ApptNum is required');
  need((data as any).PatNum !== undefined, 'PatNum is required');
  need((data as any).ClinicNum !== undefined, 'ClinicNum is required');

  checkPos((data as any).ApptNum, 'ApptNum');
  checkPos((data as any).PatNum, 'PatNum');
  checkPos((data as any).ClinicNum, 'ClinicNum');
  checkPos((data as any).TSPrior, 'TSPrior');
  checkPos((data as any).ApptReminderRuleNum, 'ApptReminderRuleNum');
  checkPos((data as any).MessageFk, 'MessageFk');

  if ((data as any).SendStatus !== undefined) {
    const n = Number((data as any).SendStatus);
    if (!Number.isFinite(n)) errors.push('SendStatus must be a number');
  }
  if ((data as any).MessageType !== undefined) {
    const n = Number((data as any).MessageType);
    if (!Number.isFinite(n)) errors.push('MessageType must be a number');
  }

  return errors;
}

async function handleGetApptGeneralMessageSents(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptGeneralMessageSentNum, ApptNum, PatNum, ClinicNum, DateTimeEntry, TSPrior, ApptReminderRuleNum, SendStatus, ApptDateTime, MessageType, MessageFk, DateTimeSent, ResponseDescript, created_at, updated_at
      FROM apptgeneralmessagesent
      ORDER BY ApptGeneralMessageSentNum DESC
    `;
    const results = await executeQuery<ApptGeneralMessageSent[]>(query);
    const mapped = results.map(mapApptGeneralMessageSent);
    const response: ApiResponse<ApptGeneralMessageSent[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptgeneralmessagesent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptGeneralMessageSent(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptGeneralMessageSentNum, ApptNum, PatNum, ClinicNum, DateTimeEntry, TSPrior, ApptReminderRuleNum, SendStatus, ApptDateTime, MessageType, MessageFk, DateTimeSent, ResponseDescript, created_at, updated_at
      FROM apptgeneralmessagesent
      WHERE ApptGeneralMessageSentNum = ?
    `;
    const results = await executeQuery<ApptGeneralMessageSent[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptGeneralMessageSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ApptGeneralMessageSent> = { success: true, data: mapApptGeneralMessageSent(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptgeneralmessagesent by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptGeneralMessageSent(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptGeneralMessageSentRequest = JSON.parse(event.body);
    const errors = validateApptGeneralMessageSentPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptgeneralmessagesent
      (ApptNum, PatNum, ClinicNum, TSPrior, ApptReminderRuleNum, SendStatus, ApptDateTime, MessageType, MessageFk, DateTimeSent, ResponseDescript)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.ApptNum,
      data.PatNum,
      data.ClinicNum,
      data.TSPrior ?? null,
      data.ApptReminderRuleNum ?? null,
      data.SendStatus ?? null,
      data.ApptDateTime ?? null,
      data.MessageType ?? null,
      data.MessageFk ?? null,
      data.DateTimeSent ?? null,
      data.ResponseDescript ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptGeneralMessageSentNum, ApptNum, PatNum, ClinicNum, DateTimeEntry, TSPrior, ApptReminderRuleNum, SendStatus, ApptDateTime, MessageType, MessageFk, DateTimeSent, ResponseDescript, created_at, updated_at
      FROM apptgeneralmessagesent
      WHERE ApptGeneralMessageSentNum = ?
    `;
    const records = await executeQuery<ApptGeneralMessageSent[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptGeneralMessageSent> = {
      success: true,
      data: mapApptGeneralMessageSent(records[0]),
      message: 'ApptGeneralMessageSent created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptgeneralmessagesent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptGeneralMessageSent(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptGeneralMessageSentNum FROM apptgeneralmessagesent WHERE ApptGeneralMessageSentNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptGeneralMessageSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptGeneralMessageSentRequest = JSON.parse(event.body);
    const errors = validateApptGeneralMessageSentPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ApptNum !== undefined) { updateFields.push('ApptNum = ?'); updateParams.push(data.ApptNum); }
    if (data.PatNum !== undefined) { updateFields.push('PatNum = ?'); updateParams.push(data.PatNum); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum); }
    if (data.TSPrior !== undefined) { updateFields.push('TSPrior = ?'); updateParams.push(data.TSPrior ?? null); }
    if (data.ApptReminderRuleNum !== undefined) { updateFields.push('ApptReminderRuleNum = ?'); updateParams.push(data.ApptReminderRuleNum ?? null); }
    if (data.SendStatus !== undefined) { updateFields.push('SendStatus = ?'); updateParams.push(data.SendStatus ?? null); }
    if (data.ApptDateTime !== undefined) { updateFields.push('ApptDateTime = ?'); updateParams.push(data.ApptDateTime ?? null); }
    if (data.MessageType !== undefined) { updateFields.push('MessageType = ?'); updateParams.push(data.MessageType ?? null); }
    if (data.MessageFk !== undefined) { updateFields.push('MessageFk = ?'); updateParams.push(data.MessageFk ?? null); }
    if (data.DateTimeSent !== undefined) { updateFields.push('DateTimeSent = ?'); updateParams.push(data.DateTimeSent ?? null); }
    if (data.ResponseDescript !== undefined) { updateFields.push('ResponseDescript = ?'); updateParams.push(data.ResponseDescript ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptgeneralmessagesent
      SET ${updateFields.join(', ')}
      WHERE ApptGeneralMessageSentNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptGeneralMessageSentNum, ApptNum, PatNum, ClinicNum, DateTimeEntry, TSPrior, ApptReminderRuleNum, SendStatus, ApptDateTime, MessageType, MessageFk, DateTimeSent, ResponseDescript, created_at, updated_at
      FROM apptgeneralmessagesent
      WHERE ApptGeneralMessageSentNum = ?
    `;
    const records = await executeQuery<ApptGeneralMessageSent[]>(selectQuery, [id]);

    const response: ApiResponse<ApptGeneralMessageSent> = {
      success: true,
      data: mapApptGeneralMessageSent(records[0]),
      message: 'ApptGeneralMessageSent updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptgeneralmessagesent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptGeneralMessageSent(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptGeneralMessageSentNum FROM apptgeneralmessagesent WHERE ApptGeneralMessageSentNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptGeneralMessageSent not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptgeneralmessagesent WHERE ApptGeneralMessageSentNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptGeneralMessageSent deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptgeneralmessagesent:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

// ========================================
// ACCOUNT HANDLERS
// ========================================

async function handleGetAccounts(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AccountNum, Description, AcctType, BankNumber, Inactive, AccountColor, IsAssetAccount, CashFlowReserve
      FROM account
      ORDER BY Description ASC
    `;
    
    const results = await executeQuery<Account[]>(query);

    const accounts = results.map(acc => ({
      ...acc,
      Inactive: Boolean(acc.Inactive),
      IsAssetAccount: Boolean(acc.IsAssetAccount),
    }));

    const response: ApiResponse<Account[]> = {
      success: true,
      data: accounts,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET accounts:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APPTREMINDERRULE HANDLERS
// ========================================

function mapApptReminderRule(record: any): ApptReminderRule {
  return {
    ...record,
    ApptReminderRuleNum: Number(record.ApptReminderRuleNum),
    TypeCur: Number(record.TypeCur) as ApptReminderType,
    TSPrior: Number(record.TSPrior),
    IsSendAll: Boolean(record.IsSendAll),
    ClinicNum: Number(record.ClinicNum),
    DoNotSendWithin: record.DoNotSendWithin !== null ? Number(record.DoNotSendWithin) : null,
    IsEnabled: Boolean(record.IsEnabled),
    IsAutoReplyEnabled: record.IsAutoReplyEnabled ? Boolean(record.IsAutoReplyEnabled) : false,
    IsSendForMinorsBirthday: record.IsSendForMinorsBirthday ? Boolean(record.IsSendForMinorsBirthday) : false,
    EmailHostingTemplateNum: record.EmailHostingTemplateNum !== null ? Number(record.EmailHostingTemplateNum) : null,
    MinorAge: record.MinorAge !== null ? Number(record.MinorAge) : null,
    SendMultipleInvites: record.SendMultipleInvites !== null ? Number(record.SendMultipleInvites) as SendMultipleInvites : null,
    TimeSpanMultipleInvites: record.TimeSpanMultipleInvites !== null ? Number(record.TimeSpanMultipleInvites) : null,
  };
}

function validateApptReminderRulePayload(
  data: CreateApptReminderRuleRequest | UpdateApptReminderRuleRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };
  const checkNum = (val: any, name: string, allowNull = false) => {
    if (val === undefined) return;
    if (allowNull && val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number`);
  };

  need((data as any).TypeCur !== undefined, 'TypeCur is required');
  need((data as any).TSPrior !== undefined, 'TSPrior is required');
  need((data as any).SendOrder !== undefined, 'SendOrder is required');

  if ((data as any).TypeCur !== undefined) {
    const n = Number((data as any).TypeCur);
    if (n < ApptReminderType.Undefined || n > ApptReminderType.EClipboardWeb) {
      errors.push('TypeCur out of range');
    }
  }

  checkNum((data as any).TSPrior, 'TSPrior');
  if (data.SendOrder !== undefined && data.SendOrder.trim() === '') errors.push('SendOrder cannot be blank');
  checkNum((data as any).DoNotSendWithin, 'DoNotSendWithin', true);
  checkNum((data as any).EmailHostingTemplateNum, 'EmailHostingTemplateNum', true);
  checkNum((data as any).MinorAge, 'MinorAge', true);
  checkNum((data as any).TimeSpanMultipleInvites, 'TimeSpanMultipleInvites', true);
  checkNum((data as any).ClinicNum, 'ClinicNum', true);

  if ((data as any).SendMultipleInvites !== undefined) {
    const n = Number((data as any).SendMultipleInvites);
    if (n < SendMultipleInvites.UntilPatientVisitsPortal || n > SendMultipleInvites.NoVisitInTimespan) {
      errors.push('SendMultipleInvites must be 0,1,2');
    }
  }
  if ((data as any).EmailTemplateType !== undefined) {
    const n = Number((data as any).EmailTemplateType);
    if (n < EmailType.Regular || n > EmailType.RawHtml) errors.push('EmailTemplateType out of range');
  }
  if ((data as any).AggEmailTemplateType !== undefined) {
    const n = Number((data as any).AggEmailTemplateType);
    if (n < EmailType.Regular || n > EmailType.RawHtml) errors.push('AggEmailTemplateType out of range');
  }

  return errors;
}

async function handleGetApptReminderRules(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptReminderRuleNum, TypeCur, TSPrior, SendOrder, IsSendAll, TemplateSMS, TemplateEmailSubject, TemplateEmail, ClinicNum,
             TemplateSMSAggShared, TemplateSMSAggPerAppt, TemplateEmailSubjAggShared, TemplateEmailAggShared, TemplateEmailAggPerAppt,
             DoNotSendWithin, IsEnabled, TemplateAutoReply, TemplateAutoReplyAgg, IsAutoReplyEnabled, Language, TemplateComeInMessage,
             EmailTemplateType, AggEmailTemplateType, IsSendForMinorsBirthday, EmailHostingTemplateNum, MinorAge, TemplateFailureAutoReply,
             SendMultipleInvites, TimeSpanMultipleInvites, created_at, updated_at
      FROM apptreminderrule
      ORDER BY ClinicNum ASC, TypeCur ASC, ApptReminderRuleNum ASC
    `;
    const results = await executeQuery<ApptReminderRule[]>(query);
    const mapped = results.map(mapApptReminderRule);
    const response: ApiResponse<ApptReminderRule[]> = { success: true, data: mapped };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptreminderrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetApptReminderRule(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ApptReminderRuleNum, TypeCur, TSPrior, SendOrder, IsSendAll, TemplateSMS, TemplateEmailSubject, TemplateEmail, ClinicNum,
             TemplateSMSAggShared, TemplateSMSAggPerAppt, TemplateEmailSubjAggShared, TemplateEmailAggShared, TemplateEmailAggPerAppt,
             DoNotSendWithin, IsEnabled, TemplateAutoReply, TemplateAutoReplyAgg, IsAutoReplyEnabled, Language, TemplateComeInMessage,
             EmailTemplateType, AggEmailTemplateType, IsSendForMinorsBirthday, EmailHostingTemplateNum, MinorAge, TemplateFailureAutoReply,
             SendMultipleInvites, TimeSpanMultipleInvites, created_at, updated_at
      FROM apptreminderrule
      WHERE ApptReminderRuleNum = ?
    `;
    const results = await executeQuery<ApptReminderRule[]>(query, [id]);
    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptReminderRule not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const response: ApiResponse<ApptReminderRule> = { success: true, data: mapApptReminderRule(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apptreminderrule by id:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostApptReminderRule(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }
    const data: CreateApptReminderRuleRequest = JSON.parse(event.body);
    const errors = validateApptReminderRulePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apptreminderrule
      (TypeCur, TSPrior, SendOrder, IsSendAll, TemplateSMS, TemplateEmailSubject, TemplateEmail, ClinicNum,
       TemplateSMSAggShared, TemplateSMSAggPerAppt, TemplateEmailSubjAggShared, TemplateEmailAggShared, TemplateEmailAggPerAppt,
       DoNotSendWithin, IsEnabled, TemplateAutoReply, TemplateAutoReplyAgg, IsAutoReplyEnabled, Language, TemplateComeInMessage,
       EmailTemplateType, AggEmailTemplateType, IsSendForMinorsBirthday, EmailHostingTemplateNum, MinorAge, TemplateFailureAutoReply,
       SendMultipleInvites, TimeSpanMultipleInvites)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.TypeCur,
      data.TSPrior,
      data.SendOrder.trim(),
      data.IsSendAll ? 1 : 0,
      data.TemplateSMS ?? null,
      data.TemplateEmailSubject ?? null,
      data.TemplateEmail ?? null,
      data.ClinicNum ?? 0,
      data.TemplateSMSAggShared ?? null,
      data.TemplateSMSAggPerAppt ?? null,
      data.TemplateEmailSubjAggShared ?? null,
      data.TemplateEmailAggShared ?? null,
      data.TemplateEmailAggPerAppt ?? null,
      data.DoNotSendWithin ?? 0,
      data.IsEnabled === undefined ? 1 : (data.IsEnabled ? 1 : 0),
      data.TemplateAutoReply ?? null,
      data.TemplateAutoReplyAgg ?? null,
      data.IsAutoReplyEnabled ? 1 : 0,
      data.Language ?? null,
      data.TemplateComeInMessage ?? null,
      data.EmailTemplateType ?? null,
      data.AggEmailTemplateType ?? null,
      data.IsSendForMinorsBirthday ? 1 : 0,
      data.EmailHostingTemplateNum ?? null,
      data.MinorAge ?? null,
      data.TemplateFailureAutoReply ?? null,
      data.SendMultipleInvites ?? SendMultipleInvites.UntilPatientVisitsPortal,
      data.TimeSpanMultipleInvites ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ApptReminderRuleNum, TypeCur, TSPrior, SendOrder, IsSendAll, TemplateSMS, TemplateEmailSubject, TemplateEmail, ClinicNum,
             TemplateSMSAggShared, TemplateSMSAggPerAppt, TemplateEmailSubjAggShared, TemplateEmailAggShared, TemplateEmailAggPerAppt,
             DoNotSendWithin, IsEnabled, TemplateAutoReply, TemplateAutoReplyAgg, IsAutoReplyEnabled, Language, TemplateComeInMessage,
             EmailTemplateType, AggEmailTemplateType, IsSendForMinorsBirthday, EmailHostingTemplateNum, MinorAge, TemplateFailureAutoReply,
             SendMultipleInvites, TimeSpanMultipleInvites, created_at, updated_at
      FROM apptreminderrule
      WHERE ApptReminderRuleNum = ?
    `;
    const records = await executeQuery<ApptReminderRule[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ApptReminderRule> = {
      success: true,
      data: mapApptReminderRule(records[0]),
      message: 'ApptReminderRule created successfully',
    };
    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apptreminderrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutApptReminderRule(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT ApptReminderRuleNum FROM apptreminderrule WHERE ApptReminderRuleNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptReminderRule not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateApptReminderRuleRequest = JSON.parse(event.body);
    const errors = validateApptReminderRulePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.TypeCur !== undefined) { updateFields.push('TypeCur = ?'); updateParams.push(data.TypeCur); }
    if (data.TSPrior !== undefined) { updateFields.push('TSPrior = ?'); updateParams.push(data.TSPrior); }
    if (data.SendOrder !== undefined) { updateFields.push('SendOrder = ?'); updateParams.push(data.SendOrder.trim()); }
    if (data.IsSendAll !== undefined) { updateFields.push('IsSendAll = ?'); updateParams.push(data.IsSendAll ? 1 : 0); }
    if (data.TemplateSMS !== undefined) { updateFields.push('TemplateSMS = ?'); updateParams.push(data.TemplateSMS ?? null); }
    if (data.TemplateEmailSubject !== undefined) { updateFields.push('TemplateEmailSubject = ?'); updateParams.push(data.TemplateEmailSubject ?? null); }
    if (data.TemplateEmail !== undefined) { updateFields.push('TemplateEmail = ?'); updateParams.push(data.TemplateEmail ?? null); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum ?? 0); }
    if (data.TemplateSMSAggShared !== undefined) { updateFields.push('TemplateSMSAggShared = ?'); updateParams.push(data.TemplateSMSAggShared ?? null); }
    if (data.TemplateSMSAggPerAppt !== undefined) { updateFields.push('TemplateSMSAggPerAppt = ?'); updateParams.push(data.TemplateSMSAggPerAppt ?? null); }
    if (data.TemplateEmailSubjAggShared !== undefined) { updateFields.push('TemplateEmailSubjAggShared = ?'); updateParams.push(data.TemplateEmailSubjAggShared ?? null); }
    if (data.TemplateEmailAggShared !== undefined) { updateFields.push('TemplateEmailAggShared = ?'); updateParams.push(data.TemplateEmailAggShared ?? null); }
    if (data.TemplateEmailAggPerAppt !== undefined) { updateFields.push('TemplateEmailAggPerAppt = ?'); updateParams.push(data.TemplateEmailAggPerAppt ?? null); }
    if (data.DoNotSendWithin !== undefined) { updateFields.push('DoNotSendWithin = ?'); updateParams.push(data.DoNotSendWithin ?? 0); }
    if (data.IsEnabled !== undefined) { updateFields.push('IsEnabled = ?'); updateParams.push(data.IsEnabled ? 1 : 0); }
    if (data.TemplateAutoReply !== undefined) { updateFields.push('TemplateAutoReply = ?'); updateParams.push(data.TemplateAutoReply ?? null); }
    if (data.TemplateAutoReplyAgg !== undefined) { updateFields.push('TemplateAutoReplyAgg = ?'); updateParams.push(data.TemplateAutoReplyAgg ?? null); }
    if (data.IsAutoReplyEnabled !== undefined) { updateFields.push('IsAutoReplyEnabled = ?'); updateParams.push(data.IsAutoReplyEnabled ? 1 : 0); }
    if (data.Language !== undefined) { updateFields.push('Language = ?'); updateParams.push(data.Language ?? null); }
    if (data.TemplateComeInMessage !== undefined) { updateFields.push('TemplateComeInMessage = ?'); updateParams.push(data.TemplateComeInMessage ?? null); }
    if (data.EmailTemplateType !== undefined) { updateFields.push('EmailTemplateType = ?'); updateParams.push(data.EmailTemplateType ?? null); }
    if (data.AggEmailTemplateType !== undefined) { updateFields.push('AggEmailTemplateType = ?'); updateParams.push(data.AggEmailTemplateType ?? null); }
    if (data.IsSendForMinorsBirthday !== undefined) { updateFields.push('IsSendForMinorsBirthday = ?'); updateParams.push(data.IsSendForMinorsBirthday ? 1 : 0); }
    if (data.EmailHostingTemplateNum !== undefined) { updateFields.push('EmailHostingTemplateNum = ?'); updateParams.push(data.EmailHostingTemplateNum ?? null); }
    if (data.MinorAge !== undefined) { updateFields.push('MinorAge = ?'); updateParams.push(data.MinorAge ?? null); }
    if (data.TemplateFailureAutoReply !== undefined) { updateFields.push('TemplateFailureAutoReply = ?'); updateParams.push(data.TemplateFailureAutoReply ?? null); }
    if (data.SendMultipleInvites !== undefined) { updateFields.push('SendMultipleInvites = ?'); updateParams.push(data.SendMultipleInvites ?? SendMultipleInvites.UntilPatientVisitsPortal); }
    if (data.TimeSpanMultipleInvites !== undefined) { updateFields.push('TimeSpanMultipleInvites = ?'); updateParams.push(data.TimeSpanMultipleInvites ?? null); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apptreminderrule
      SET ${updateFields.join(', ')}
      WHERE ApptReminderRuleNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ApptReminderRuleNum, TypeCur, TSPrior, SendOrder, IsSendAll, TemplateSMS, TemplateEmailSubject, TemplateEmail, ClinicNum,
             TemplateSMSAggShared, TemplateSMSAggPerAppt, TemplateEmailSubjAggShared, TemplateEmailAggShared, TemplateEmailAggPerAppt,
             DoNotSendWithin, IsEnabled, TemplateAutoReply, TemplateAutoReplyAgg, IsAutoReplyEnabled, Language, TemplateComeInMessage,
             EmailTemplateType, AggEmailTemplateType, IsSendForMinorsBirthday, EmailHostingTemplateNum, MinorAge, TemplateFailureAutoReply,
             SendMultipleInvites, TimeSpanMultipleInvites, created_at, updated_at
      FROM apptreminderrule
      WHERE ApptReminderRuleNum = ?
    `;
    const records = await executeQuery<ApptReminderRule[]>(selectQuery, [id]);

    const response: ApiResponse<ApptReminderRule> = {
      success: true,
      data: mapApptReminderRule(records[0]),
      message: 'ApptReminderRule updated successfully',
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apptreminderrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteApptReminderRule(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const exists = await executeQuery<any[]>(`SELECT ApptReminderRuleNum FROM apptreminderrule WHERE ApptReminderRuleNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'ApptReminderRule not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apptreminderrule WHERE ApptReminderRuleNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'ApptReminderRule deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apptreminderrule:', error);
    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAccount(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AccountNum, Description, AcctType, BankNumber, Inactive, AccountColor, IsAssetAccount, CashFlowReserve
      FROM account
      WHERE AccountNum = ?
    `;
    
    const results = await executeQuery<Account[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Account not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const account = {
      ...results[0],
      Inactive: Boolean(results[0].Inactive),
      IsAssetAccount: Boolean(results[0].IsAssetAccount),
    };

    const response: ApiResponse<Account> = {
      success: true,
      data: account,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET account:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAccount(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const accountData: CreateAccountRequest = JSON.parse(event.body);

    if (!accountData.Description || accountData.Description.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'Description is required and cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (accountData.AcctType === undefined || accountData.AcctType === null) {
      const response: ApiResponse = {
        success: false,
        error: 'AcctType is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const insertQuery = `
      INSERT INTO account 
      (Description, AcctType, BankNumber, Inactive, AccountColor, IsAssetAccount, CashFlowReserve)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      accountData.Description,
      accountData.AcctType,
      accountData.BankNumber || null,
      accountData.Inactive ? 1 : 0,
      accountData.AccountColor || null,
      accountData.IsAssetAccount ? 1 : 0,
      accountData.CashFlowReserve || null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AccountNum, Description, AcctType, BankNumber, Inactive, AccountColor, IsAssetAccount, CashFlowReserve
      FROM account
      WHERE AccountNum = ?
    `;

    const accounts = await executeQuery<Account[]>(selectQuery, [result.insertId]);
    
    const account = {
      ...accounts[0],
      Inactive: Boolean(accounts[0].Inactive),
      IsAssetAccount: Boolean(accounts[0].IsAssetAccount),
    };

    const response: ApiResponse<Account> = {
      success: true,
      data: account,
      message: 'Account created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST account:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAccount(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateData: UpdateAccountRequest = JSON.parse(event.body);

    const checkQuery = `SELECT AccountNum FROM account WHERE AccountNum = ?`;
    const existingAccounts = await executeQuery<Account[]>(checkQuery, [id]);

    if (existingAccounts.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Account not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (updateData.Description !== undefined && updateData.Description.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'Description cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (updateData.Description !== undefined) {
      updateFields.push('Description = ?');
      updateParams.push(updateData.Description);
    }
    if (updateData.AcctType !== undefined) {
      updateFields.push('AcctType = ?');
      updateParams.push(updateData.AcctType);
    }
    if (updateData.BankNumber !== undefined) {
      updateFields.push('BankNumber = ?');
      updateParams.push(updateData.BankNumber || null);
    }
    if (updateData.Inactive !== undefined) {
      updateFields.push('Inactive = ?');
      updateParams.push(updateData.Inactive ? 1 : 0);
    }
    if (updateData.AccountColor !== undefined) {
      updateFields.push('AccountColor = ?');
      updateParams.push(updateData.AccountColor || null);
    }
    if (updateData.IsAssetAccount !== undefined) {
      updateFields.push('IsAssetAccount = ?');
      updateParams.push(updateData.IsAssetAccount ? 1 : 0);
    }
    if (updateData.CashFlowReserve !== undefined) {
      updateFields.push('CashFlowReserve = ?');
      updateParams.push(updateData.CashFlowReserve || null);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No fields to update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE account
      SET ${updateFields.join(', ')}
      WHERE AccountNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AccountNum, Description, AcctType, BankNumber, Inactive, AccountColor, IsAssetAccount, CashFlowReserve
      FROM account
      WHERE AccountNum = ?
    `;

    const accounts = await executeQuery<Account[]>(selectQuery, [id]);

    const account = {
      ...accounts[0],
      Inactive: Boolean(accounts[0].Inactive),
      IsAssetAccount: Boolean(accounts[0].IsAssetAccount),
    };

    const response: ApiResponse<Account> = {
      success: true,
      data: account,
      message: 'Account updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT account:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAccount(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AccountNum FROM account WHERE AccountNum = ?`;
    const existingAccounts = await executeQuery<any[]>(checkQuery, [id]);

    if (existingAccounts.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Account not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM account WHERE AccountNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'Account deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE account:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// DEFINITION HANDLERS
// ========================================

async function handleGetDefinitions(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const queryParams: ListDefinitionsQuery = {
      category: event.queryStringParameters?.category 
        ? parseInt(event.queryStringParameters.category, 10) 
        : undefined,
      includeHidden: event.queryStringParameters?.includeHidden === 'true',
    };

    let query = `
      SELECT DefNum, Category, ItemOrder, ItemName, ItemValue, ItemColor, IsHidden
      FROM definition
      WHERE 1=1
    `;
    const params: any[] = [];

    if (queryParams.category !== undefined) {
      query += ` AND Category = ?`;
      params.push(queryParams.category);
    }

    if (!queryParams.includeHidden) {
      query += ` AND IsHidden = 0`;
    }

    query += ` ORDER BY Category ASC, ItemOrder ASC`;
    
    const results = await executeQuery<Definition[]>(query, params);

    const definitions = results.map(def => ({
      ...def,
      IsHidden: Boolean(def.IsHidden),
    }));

    const response: ApiResponse<Definition[]> = {
      success: true,
      data: definitions,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET definitions:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetDefinition(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT DefNum, Category, ItemOrder, ItemName, ItemValue, ItemColor, IsHidden
      FROM definition
      WHERE DefNum = ?
    `;
    
    const results = await executeQuery<Definition[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Definition not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const definition = {
      ...results[0],
      IsHidden: Boolean(results[0].IsHidden),
    };

    const response: ApiResponse<Definition> = {
      success: true,
      data: definition,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET definition:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostDefinition(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const definitionData: CreateDefinitionRequest = JSON.parse(event.body);

    if (definitionData.Category === undefined || definitionData.Category === null) {
      const response: ApiResponse = {
        success: false,
        error: 'Category is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (!definitionData.ItemName || definitionData.ItemName.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'ItemName is required and cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (definitionData.ItemOrder === undefined || definitionData.ItemOrder === null) {
      const response: ApiResponse = {
        success: false,
        error: 'ItemOrder is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (definitionData.Category < 0 || definitionData.Category > 255) {
      const response: ApiResponse = {
        success: false,
        error: 'Category must be between 0 and 255',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const insertQuery = `
      INSERT INTO definition 
      (Category, ItemOrder, ItemName, ItemValue, ItemColor, IsHidden)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      definitionData.Category,
      definitionData.ItemOrder,
      definitionData.ItemName,
      definitionData.ItemValue || null,
      definitionData.ItemColor || null,
      definitionData.IsHidden ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT DefNum, Category, ItemOrder, ItemName, ItemValue, ItemColor, IsHidden
      FROM definition
      WHERE DefNum = ?
    `;

    const definitions = await executeQuery<Definition[]>(selectQuery, [result.insertId]);
    
    const definition = {
      ...definitions[0],
      IsHidden: Boolean(definitions[0].IsHidden),
    };

    const response: ApiResponse<Definition> = {
      success: true,
      data: definition,
      message: 'Definition created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST definition:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutDefinition(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateData: UpdateDefinitionRequest = JSON.parse(event.body);

    const checkQuery = `SELECT DefNum FROM definition WHERE DefNum = ?`;
    const existingDefinitions = await executeQuery<Definition[]>(checkQuery, [id]);

    if (existingDefinitions.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Definition not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (updateData.ItemName !== undefined && updateData.ItemName.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'ItemName cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (updateData.Category !== undefined && (updateData.Category < 0 || updateData.Category > 255)) {
      const response: ApiResponse = {
        success: false,
        error: 'Category must be between 0 and 255',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (updateData.Category !== undefined) {
      updateFields.push('Category = ?');
      updateParams.push(updateData.Category);
    }
    if (updateData.ItemOrder !== undefined) {
      updateFields.push('ItemOrder = ?');
      updateParams.push(updateData.ItemOrder);
    }
    if (updateData.ItemName !== undefined) {
      updateFields.push('ItemName = ?');
      updateParams.push(updateData.ItemName);
    }
    if (updateData.ItemValue !== undefined) {
      updateFields.push('ItemValue = ?');
      updateParams.push(updateData.ItemValue || null);
    }
    if (updateData.ItemColor !== undefined) {
      updateFields.push('ItemColor = ?');
      updateParams.push(updateData.ItemColor || null);
    }
    if (updateData.IsHidden !== undefined) {
      updateFields.push('IsHidden = ?');
      updateParams.push(updateData.IsHidden ? 1 : 0);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No fields to update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE definition
      SET ${updateFields.join(', ')}
      WHERE DefNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT DefNum, Category, ItemOrder, ItemName, ItemValue, ItemColor, IsHidden
      FROM definition
      WHERE DefNum = ?
    `;

    const definitions = await executeQuery<Definition[]>(selectQuery, [id]);

    const definition = {
      ...definitions[0],
      IsHidden: Boolean(definitions[0].IsHidden),
    };

    const response: ApiResponse<Definition> = {
      success: true,
      data: definition,
      message: 'Definition updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT definition:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteDefinition(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT DefNum FROM definition WHERE DefNum = ?`;
    const existingDefinitions = await executeQuery<any[]>(checkQuery, [id]);

    if (existingDefinitions.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Definition not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM definition WHERE DefNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'Definition deleted successfully. Warning: This may affect other tables that reference this definition.',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE definition:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') || 
                              errorMessage.includes('Cannot delete or update a parent row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError 
        ? 'Cannot delete definition: it is referenced by other records. Consider setting IsHidden=true instead.'
        : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 409 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ACCOUNTING AUTOPAY HANDLERS
// ========================================

async function handleGetAccountingAutoPays(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AccountingAutoPayNum, PayType, PickList
      FROM accountingautopay
      ORDER BY AccountingAutoPayNum ASC
    `;
    
    const results = await executeQuery<AccountingAutoPay[]>(query);

    const response: ApiResponse<AccountingAutoPay[]> = {
      success: true,
      data: results,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET accountingautopay:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAccountingAutoPay(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AccountingAutoPayNum, PayType, PickList
      FROM accountingautopay
      WHERE AccountingAutoPayNum = ?
    `;
    
    const results = await executeQuery<AccountingAutoPay[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AccountingAutoPay not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<AccountingAutoPay> = {
      success: true,
      data: results[0],
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET accountingautopay by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAccountingAutoPay(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: CreateAccountingAutoPayRequest = JSON.parse(event.body);

    if (!data.PayType || data.PayType <= 0) {
      const response: ApiResponse = {
        success: false,
        error: 'PayType is required and must be a valid positive number',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (!data.PickList || data.PickList.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'PickList is required and cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    // Validate that PickList contains comma-separated numbers with no spaces
    const pickListPattern = /^\d+(,\d+)*$/;
    if (!pickListPattern.test(data.PickList.trim())) {
      const response: ApiResponse = {
        success: false,
        error: 'PickList must contain comma-separated AccountNums with no spaces (e.g., "101,102,105")',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const insertQuery = `
      INSERT INTO accountingautopay 
      (PayType, PickList)
      VALUES (?, ?)
    `;

    const params = [
      data.PayType,
      data.PickList.trim(),
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AccountingAutoPayNum, PayType, PickList
      FROM accountingautopay
      WHERE AccountingAutoPayNum = ?
    `;

    const autoPayRecords = await executeQuery<AccountingAutoPay[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AccountingAutoPay> = {
      success: true,
      data: autoPayRecords[0],
      message: 'AccountingAutoPay created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST accountingautopay:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') || 
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError 
        ? 'Invalid PayType: The specified PayType does not exist in the definition table'
        : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAccountingAutoPay(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const checkQuery = `SELECT AccountingAutoPayNum FROM accountingautopay WHERE AccountingAutoPayNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AccountingAutoPay not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: UpdateAccountingAutoPayRequest = JSON.parse(event.body);

    // Validate PickList format if provided
    if (data.PickList !== undefined) {
      if (data.PickList.trim() === '') {
        const response: ApiResponse = {
          success: false,
          error: 'PickList cannot be blank',
        };

        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify(response),
        };
      }

      const pickListPattern = /^\d+(,\d+)*$/;
      if (!pickListPattern.test(data.PickList.trim())) {
        const response: ApiResponse = {
          success: false,
          error: 'PickList must contain comma-separated AccountNums with no spaces (e.g., "101,102,105")',
        };

        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify(response),
        };
      }
    }

    // Validate PayType if provided
    if (data.PayType !== undefined && data.PayType <= 0) {
      const response: ApiResponse = {
        success: false,
        error: 'PayType must be a valid positive number',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.PayType !== undefined) {
      updateFields.push('PayType = ?');
      updateParams.push(data.PayType);
    }

    if (data.PickList !== undefined) {
      updateFields.push('PickList = ?');
      updateParams.push(data.PickList.trim());
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'At least one field must be provided for update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE accountingautopay
      SET ${updateFields.join(', ')}
      WHERE AccountingAutoPayNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AccountingAutoPayNum, PayType, PickList
      FROM accountingautopay
      WHERE AccountingAutoPayNum = ?
    `;

    const autoPayRecords = await executeQuery<AccountingAutoPay[]>(selectQuery, [id]);

    const response: ApiResponse<AccountingAutoPay> = {
      success: true,
      data: autoPayRecords[0],
      message: 'AccountingAutoPay updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT accountingautopay:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') || 
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError 
        ? 'Invalid PayType: The specified PayType does not exist in the definition table'
        : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAccountingAutoPay(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AccountingAutoPayNum FROM accountingautopay WHERE AccountingAutoPayNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AccountingAutoPay not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM accountingautopay WHERE AccountingAutoPayNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AccountingAutoPay deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE accountingautopay:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// USEROD HANDLERS
// ========================================

function mapUserod(record: any): Userod {
  return {
    ...record,
    IsHidden: Boolean(record.IsHidden),
    DefaultHidePopups: Boolean(record.DefaultHidePopups),
    PasswordIsStrong: Boolean(record.PasswordIsStrong),
    ClinicIsRestricted: Boolean(record.ClinicIsRestricted),
    InboxHidePopups: Boolean(record.InboxHidePopups),
    IsPasswordResetRequired: Boolean(record.IsPasswordResetRequired),
  };
}

async function handleGetUserods(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT UserNum, UserName, Password, UserGroupNum, EmployeeNum, ClinicNum, ProvNum, IsHidden, TaskListInBox,
             AnesthProvType, DefaultHidePopups, PasswordIsStrong, ClinicIsRestricted, InboxHidePopups, UserNumCEMT,
             DateTFail, FailedAttempts, DomainUser, IsPasswordResetRequired, MobileWebPin, MobileWebPinFailedAttempts,
             DateTLastLogin, EClipboardClinicalPin, BadgeId
      FROM userod
      ORDER BY UserNum ASC
    `;

    const results = await executeQuery<Userod[]>(query);
    const users = results.map(mapUserod);

    const response: ApiResponse<Userod[]> = {
      success: true,
      data: users,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET userod:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetUserod(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT UserNum, UserName, Password, UserGroupNum, EmployeeNum, ClinicNum, ProvNum, IsHidden, TaskListInBox,
             AnesthProvType, DefaultHidePopups, PasswordIsStrong, ClinicIsRestricted, InboxHidePopups, UserNumCEMT,
             DateTFail, FailedAttempts, DomainUser, IsPasswordResetRequired, MobileWebPin, MobileWebPinFailedAttempts,
             DateTLastLogin, EClipboardClinicalPin, BadgeId
      FROM userod
      WHERE UserNum = ?
    `;

    const results = await executeQuery<Userod[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Userod not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<Userod> = {
      success: true,
      data: mapUserod(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET userod by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostUserod(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: CreateUserodRequest = JSON.parse(event.body);

    if (!data.UserName || data.UserName.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'UserName is required and cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (!data.Password || data.Password.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'Password is required and cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const insertQuery = `
      INSERT INTO userod 
      (UserName, Password, UserGroupNum, EmployeeNum, ClinicNum, ProvNum, IsHidden, TaskListInBox,
       AnesthProvType, DefaultHidePopups, PasswordIsStrong, ClinicIsRestricted, InboxHidePopups, UserNumCEMT,
       DateTFail, FailedAttempts, DomainUser, IsPasswordResetRequired, MobileWebPin, MobileWebPinFailedAttempts,
       DateTLastLogin, EClipboardClinicalPin, BadgeId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.UserName.trim(),
      data.Password,
      data.UserGroupNum ?? 0,
      data.EmployeeNum ?? 0,
      data.ClinicNum ?? 0,
      data.ProvNum ?? 0,
      data.IsHidden ? 1 : 0,
      data.TaskListInBox ?? 0,
      data.AnesthProvType ?? 3,
      data.DefaultHidePopups ? 1 : 0,
      data.PasswordIsStrong ? 1 : 0,
      data.ClinicIsRestricted ? 1 : 0,
      data.InboxHidePopups ? 1 : 0,
      data.UserNumCEMT ?? 0,
      data.DateTFail ?? null,
      data.FailedAttempts ?? 0,
      data.DomainUser ?? null,
      data.IsPasswordResetRequired ? 1 : 0,
      data.MobileWebPin ?? null,
      data.MobileWebPinFailedAttempts ?? 0,
      data.DateTLastLogin ?? null,
      data.EClipboardClinicalPin ?? null,
      data.BadgeId ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT UserNum, UserName, Password, UserGroupNum, EmployeeNum, ClinicNum, ProvNum, IsHidden, TaskListInBox,
             AnesthProvType, DefaultHidePopups, PasswordIsStrong, ClinicIsRestricted, InboxHidePopups, UserNumCEMT,
             DateTFail, FailedAttempts, DomainUser, IsPasswordResetRequired, MobileWebPin, MobileWebPinFailedAttempts,
             DateTLastLogin, EClipboardClinicalPin, BadgeId
      FROM userod
      WHERE UserNum = ?
    `;

    const users = await executeQuery<Userod[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Userod> = {
      success: true,
      data: mapUserod(users[0]),
      message: 'Userod created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST userod:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isUniqueError = errorMessage.includes('Duplicate entry') && errorMessage.includes('UserName');

    const response: ApiResponse = {
      success: false,
      error: isUniqueError ? 'UserName must be unique' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isUniqueError ? 409 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutUserod(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const checkQuery = `SELECT UserNum FROM userod WHERE UserNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Userod not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: UpdateUserodRequest = JSON.parse(event.body);

    if (data.UserName !== undefined && data.UserName.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'UserName cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (data.Password !== undefined && data.Password.trim() === '') {
      const response: ApiResponse = {
        success: false,
        error: 'Password cannot be blank',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.UserName !== undefined) {
      updateFields.push('UserName = ?');
      updateParams.push(data.UserName.trim());
    }
    if (data.Password !== undefined) {
      updateFields.push('Password = ?');
      updateParams.push(data.Password);
    }
    if (data.UserGroupNum !== undefined) {
      updateFields.push('UserGroupNum = ?');
      updateParams.push(data.UserGroupNum ?? 0);
    }
    if (data.EmployeeNum !== undefined) {
      updateFields.push('EmployeeNum = ?');
      updateParams.push(data.EmployeeNum ?? 0);
    }
    if (data.ClinicNum !== undefined) {
      updateFields.push('ClinicNum = ?');
      updateParams.push(data.ClinicNum ?? 0);
    }
    if (data.ProvNum !== undefined) {
      updateFields.push('ProvNum = ?');
      updateParams.push(data.ProvNum ?? 0);
    }
    if (data.IsHidden !== undefined) {
      updateFields.push('IsHidden = ?');
      updateParams.push(data.IsHidden ? 1 : 0);
    }
    if (data.TaskListInBox !== undefined) {
      updateFields.push('TaskListInBox = ?');
      updateParams.push(data.TaskListInBox ?? 0);
    }
    if (data.AnesthProvType !== undefined) {
      updateFields.push('AnesthProvType = ?');
      updateParams.push(data.AnesthProvType ?? 3);
    }
    if (data.DefaultHidePopups !== undefined) {
      updateFields.push('DefaultHidePopups = ?');
      updateParams.push(data.DefaultHidePopups ? 1 : 0);
    }
    if (data.PasswordIsStrong !== undefined) {
      updateFields.push('PasswordIsStrong = ?');
      updateParams.push(data.PasswordIsStrong ? 1 : 0);
    }
    if (data.ClinicIsRestricted !== undefined) {
      updateFields.push('ClinicIsRestricted = ?');
      updateParams.push(data.ClinicIsRestricted ? 1 : 0);
    }
    if (data.InboxHidePopups !== undefined) {
      updateFields.push('InboxHidePopups = ?');
      updateParams.push(data.InboxHidePopups ? 1 : 0);
    }
    if (data.UserNumCEMT !== undefined) {
      updateFields.push('UserNumCEMT = ?');
      updateParams.push(data.UserNumCEMT ?? 0);
    }
    if (data.DateTFail !== undefined) {
      updateFields.push('DateTFail = ?');
      updateParams.push(data.DateTFail ?? null);
    }
    if (data.FailedAttempts !== undefined) {
      updateFields.push('FailedAttempts = ?');
      updateParams.push(data.FailedAttempts ?? 0);
    }
    if (data.DomainUser !== undefined) {
      updateFields.push('DomainUser = ?');
      updateParams.push(data.DomainUser ?? null);
    }
    if (data.IsPasswordResetRequired !== undefined) {
      updateFields.push('IsPasswordResetRequired = ?');
      updateParams.push(data.IsPasswordResetRequired ? 1 : 0);
    }
    if (data.MobileWebPin !== undefined) {
      updateFields.push('MobileWebPin = ?');
      updateParams.push(data.MobileWebPin ?? null);
    }
    if (data.MobileWebPinFailedAttempts !== undefined) {
      updateFields.push('MobileWebPinFailedAttempts = ?');
      updateParams.push(data.MobileWebPinFailedAttempts ?? 0);
    }
    if (data.DateTLastLogin !== undefined) {
      updateFields.push('DateTLastLogin = ?');
      updateParams.push(data.DateTLastLogin ?? null);
    }
    if (data.EClipboardClinicalPin !== undefined) {
      updateFields.push('EClipboardClinicalPin = ?');
      updateParams.push(data.EClipboardClinicalPin ?? null);
    }
    if (data.BadgeId !== undefined) {
      updateFields.push('BadgeId = ?');
      updateParams.push(data.BadgeId ?? null);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'At least one field must be provided for update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE userod
      SET ${updateFields.join(', ')}
      WHERE UserNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT UserNum, UserName, Password, UserGroupNum, EmployeeNum, ClinicNum, ProvNum, IsHidden, TaskListInBox,
             AnesthProvType, DefaultHidePopups, PasswordIsStrong, ClinicIsRestricted, InboxHidePopups, UserNumCEMT,
             DateTFail, FailedAttempts, DomainUser, IsPasswordResetRequired, MobileWebPin, MobileWebPinFailedAttempts,
             DateTLastLogin, EClipboardClinicalPin, BadgeId
      FROM userod
      WHERE UserNum = ?
    `;

    const users = await executeQuery<Userod[]>(selectQuery, [id]);

    const response: ApiResponse<Userod> = {
      success: true,
      data: mapUserod(users[0]),
      message: 'Userod updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT userod:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isUniqueError = errorMessage.includes('Duplicate entry') && errorMessage.includes('UserName');

    const response: ApiResponse = {
      success: false,
      error: isUniqueError ? 'UserName must be unique' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isUniqueError ? 409 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteUserod(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT UserNum FROM userod WHERE UserNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Userod not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM userod WHERE UserNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'Userod deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE userod:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ACTIVEINSTANCE HANDLERS
// ========================================

function mapActiveInstance(record: any): ActiveInstance {
  return {
    ...record,
    ConnectionType: Number(record.ConnectionType),
  };
}

function isValidConnectionType(value: number): boolean {
  return value >= ConnectionType.Direct && value <= ConnectionType.AppStream;
}

async function handleGetActiveInstances(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ActiveInstanceNum, ComputerNum, UserNum, ProcessId, DateTimeLastActive, DateTRecorded, ConnectionType
      FROM activeinstance
      ORDER BY ActiveInstanceNum ASC
    `;

    const results = await executeQuery<ActiveInstance[]>(query);
    const instances = results.map(mapActiveInstance);

    const response: ApiResponse<ActiveInstance[]> = {
      success: true,
      data: instances,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET activeinstance:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetActiveInstance(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT ActiveInstanceNum, ComputerNum, UserNum, ProcessId, DateTimeLastActive, DateTRecorded, ConnectionType
      FROM activeinstance
      WHERE ActiveInstanceNum = ?
    `;

    const results = await executeQuery<ActiveInstance[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'ActiveInstance not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<ActiveInstance> = {
      success: true,
      data: mapActiveInstance(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET activeinstance by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

function validateActiveInstancePayload(data: CreateActiveInstanceRequest | UpdateActiveInstanceRequest, requireAll: boolean) {
  const errors: string[] = [];
  const checkPositive = (val: any, name: string) => {
    if (val === undefined || val === null) {
      if (requireAll) errors.push(`${name} is required`);
      return;
    }
    if (typeof val !== 'number' || val <= 0) {
      errors.push(`${name} must be a positive number`);
    }
  };

  checkPositive((data as any).ComputerNum, 'ComputerNum');
  checkPositive((data as any).UserNum, 'UserNum');
  checkPositive((data as any).ProcessId, 'ProcessId');

  if (requireAll && !(data as any).DateTimeLastActive) {
    errors.push('DateTimeLastActive is required');
  }
  if (requireAll && !(data as any).DateTRecorded) {
    errors.push('DateTRecorded is required');
  }

  if ((data as any).ConnectionType !== undefined) {
    const ct = Number((data as any).ConnectionType);
    if (!isValidConnectionType(ct)) {
      errors.push('ConnectionType must be between 0 (Direct) and 3 (AppStream)');
    }
  } else if (requireAll) {
    errors.push('ConnectionType is required');
  }

  return errors;
}

async function handlePostActiveInstance(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: CreateActiveInstanceRequest = JSON.parse(event.body);

    const errors = validateActiveInstancePayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO activeinstance
      (ComputerNum, UserNum, ProcessId, DateTimeLastActive, DateTRecorded, ConnectionType)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.ComputerNum,
      data.UserNum,
      data.ProcessId,
      data.DateTimeLastActive,
      data.DateTRecorded,
      data.ConnectionType,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT ActiveInstanceNum, ComputerNum, UserNum, ProcessId, DateTimeLastActive, DateTRecorded, ConnectionType
      FROM activeinstance
      WHERE ActiveInstanceNum = ?
    `;

    const records = await executeQuery<ActiveInstance[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<ActiveInstance> = {
      success: true,
      data: mapActiveInstance(records[0]),
      message: 'ActiveInstance created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST activeinstance:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid ComputerNum or UserNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutActiveInstance(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const checkQuery = `SELECT ActiveInstanceNum FROM activeinstance WHERE ActiveInstanceNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'ActiveInstance not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: UpdateActiveInstanceRequest = JSON.parse(event.body);

    const errors = validateActiveInstancePayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ComputerNum !== undefined) {
      updateFields.push('ComputerNum = ?');
      updateParams.push(data.ComputerNum);
    }
    if (data.UserNum !== undefined) {
      updateFields.push('UserNum = ?');
      updateParams.push(data.UserNum);
    }
    if (data.ProcessId !== undefined) {
      updateFields.push('ProcessId = ?');
      updateParams.push(data.ProcessId);
    }
    if (data.DateTimeLastActive !== undefined) {
      updateFields.push('DateTimeLastActive = ?');
      updateParams.push(data.DateTimeLastActive);
    }
    if (data.DateTRecorded !== undefined) {
      updateFields.push('DateTRecorded = ?');
      updateParams.push(data.DateTRecorded);
    }
    if (data.ConnectionType !== undefined) {
      updateFields.push('ConnectionType = ?');
      updateParams.push(data.ConnectionType);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'At least one field must be provided for update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE activeinstance
      SET ${updateFields.join(', ')}
      WHERE ActiveInstanceNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT ActiveInstanceNum, ComputerNum, UserNum, ProcessId, DateTimeLastActive, DateTRecorded, ConnectionType
      FROM activeinstance
      WHERE ActiveInstanceNum = ?
    `;

    const records = await executeQuery<ActiveInstance[]>(selectQuery, [id]);

    const response: ApiResponse<ActiveInstance> = {
      success: true,
      data: mapActiveInstance(records[0]),
      message: 'ActiveInstance updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT activeinstance:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid ComputerNum or UserNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteActiveInstance(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT ActiveInstanceNum FROM activeinstance WHERE ActiveInstanceNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'ActiveInstance not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM activeinstance WHERE ActiveInstanceNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'ActiveInstance deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE activeinstance:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ADJUSTMENT HANDLERS
// ========================================

function mapAdjustment(record: any): Adjustment {
  return {
    ...record,
    AdjAmt: Number(record.AdjAmt),
    ProcNum: Number(record.ProcNum),
    PatNum: Number(record.PatNum),
    AdjType: Number(record.AdjType),
    ProvNum: Number(record.ProvNum),
    ClinicNum: Number(record.ClinicNum),
    StatementNum: Number(record.StatementNum),
    SecUserNumEntry: Number(record.SecUserNumEntry),
    TaxTransID: record.TaxTransID !== null ? Number(record.TaxTransID) : null,
  };
}

function validateAdjustmentPayload(data: CreateAdjustmentRequest | UpdateAdjustmentRequest, requireAll: boolean) {
  const errors: string[] = [];
  const checkNumber = (val: any, name: string) => {
    if (val === undefined || val === null) {
      if (requireAll) errors.push(`${name} is required`);
      return;
    }
    if (typeof val !== 'number' || Number.isNaN(val)) {
      errors.push(`${name} must be a number`);
    }
  };

  if (requireAll && !data.AdjDate) errors.push('AdjDate is required');
  if (requireAll && data.AdjAmt === undefined) errors.push('AdjAmt is required');
  if (requireAll && (data as any).PatNum === undefined) errors.push('PatNum is required');
  if (requireAll && (data as any).AdjType === undefined) errors.push('AdjType is required');

  if (data.AdjAmt !== undefined && typeof data.AdjAmt !== 'number') errors.push('AdjAmt must be a number');

  checkNumber((data as any).PatNum, 'PatNum');
  checkNumber((data as any).AdjType, 'AdjType');
  if ((data as any).ProvNum !== undefined) checkNumber((data as any).ProvNum, 'ProvNum');
  if ((data as any).ProcNum !== undefined) checkNumber((data as any).ProcNum, 'ProcNum');
  if ((data as any).ClinicNum !== undefined) checkNumber((data as any).ClinicNum, 'ClinicNum');
  if ((data as any).StatementNum !== undefined) checkNumber((data as any).StatementNum, 'StatementNum');
  if ((data as any).SecUserNumEntry !== undefined) checkNumber((data as any).SecUserNumEntry, 'SecUserNumEntry');
  if ((data as any).TaxTransID !== undefined && (typeof (data as any).TaxTransID !== 'number')) {
    errors.push('TaxTransID must be a number');
  }

  return errors;
}

async function handleGetAdjustments(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AdjNum, AdjDate, AdjAmt, PatNum, AdjType, ProvNum, AdjNote, ProcDate, ProcNum,
             DateEntry, ClinicNum, StatementNum, SecUserNumEntry, SecDateTEdit, TaxTransID
      FROM adjustment
      ORDER BY AdjDate DESC, AdjNum DESC
    `;

    const results = await executeQuery<Adjustment[]>(query);
    const adjustments = results.map(mapAdjustment);

    const response: ApiResponse<Adjustment[]> = {
      success: true,
      data: adjustments,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET adjustment:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAdjustment(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AdjNum, AdjDate, AdjAmt, PatNum, AdjType, ProvNum, AdjNote, ProcDate, ProcNum,
             DateEntry, ClinicNum, StatementNum, SecUserNumEntry, SecDateTEdit, TaxTransID
      FROM adjustment
      WHERE AdjNum = ?
    `;

    const results = await executeQuery<Adjustment[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Adjustment not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<Adjustment> = {
      success: true,
      data: mapAdjustment(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET adjustment by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAdjustment(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: CreateAdjustmentRequest = JSON.parse(event.body);

    const errors = validateAdjustmentPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO adjustment
      (AdjDate, AdjAmt, PatNum, AdjType, ProvNum, AdjNote, ProcDate, ProcNum, ClinicNum, StatementNum, SecUserNumEntry, TaxTransID)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.AdjDate,
      data.AdjAmt,
      data.PatNum,
      data.AdjType,
      data.ProvNum ?? 0,
      data.AdjNote ?? null,
      data.ProcDate ?? null,
      data.ProcNum ?? 0,
      data.ClinicNum ?? 0,
      data.StatementNum ?? 0,
      data.SecUserNumEntry ?? 0,
      data.TaxTransID ?? 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AdjNum, AdjDate, AdjAmt, PatNum, AdjType, ProvNum, AdjNote, ProcDate, ProcNum,
             DateEntry, ClinicNum, StatementNum, SecUserNumEntry, SecDateTEdit, TaxTransID
      FROM adjustment
      WHERE AdjNum = ?
    `;

    const records = await executeQuery<Adjustment[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Adjustment> = {
      success: true,
      data: mapAdjustment(records[0]),
      message: 'Adjustment created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST adjustment:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid foreign key reference for PatNum/AdjType/ProvNum/etc.' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAdjustment(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const checkQuery = `SELECT AdjNum FROM adjustment WHERE AdjNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Adjustment not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: UpdateAdjustmentRequest = JSON.parse(event.body);

    const errors = validateAdjustmentPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AdjDate !== undefined) {
      updateFields.push('AdjDate = ?');
      updateParams.push(data.AdjDate);
    }
    if (data.AdjAmt !== undefined) {
      updateFields.push('AdjAmt = ?');
      updateParams.push(data.AdjAmt);
    }
    if (data.PatNum !== undefined) {
      updateFields.push('PatNum = ?');
      updateParams.push(data.PatNum);
    }
    if (data.AdjType !== undefined) {
      updateFields.push('AdjType = ?');
      updateParams.push(data.AdjType);
    }
    if (data.ProvNum !== undefined) {
      updateFields.push('ProvNum = ?');
      updateParams.push(data.ProvNum);
    }
    if (data.AdjNote !== undefined) {
      updateFields.push('AdjNote = ?');
      updateParams.push(data.AdjNote);
    }
    if (data.ProcDate !== undefined) {
      updateFields.push('ProcDate = ?');
      updateParams.push(data.ProcDate);
    }
    if (data.ProcNum !== undefined) {
      updateFields.push('ProcNum = ?');
      updateParams.push(data.ProcNum);
    }
    if (data.ClinicNum !== undefined) {
      updateFields.push('ClinicNum = ?');
      updateParams.push(data.ClinicNum);
    }
    if (data.StatementNum !== undefined) {
      updateFields.push('StatementNum = ?');
      updateParams.push(data.StatementNum);
    }
    if (data.SecUserNumEntry !== undefined) {
      updateFields.push('SecUserNumEntry = ?');
      updateParams.push(data.SecUserNumEntry);
    }
    if (data.TaxTransID !== undefined) {
      updateFields.push('TaxTransID = ?');
      updateParams.push(data.TaxTransID);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'At least one field must be provided for update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE adjustment
      SET ${updateFields.join(', ')}
      WHERE AdjNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AdjNum, AdjDate, AdjAmt, PatNum, AdjType, ProvNum, AdjNote, ProcDate, ProcNum,
             DateEntry, ClinicNum, StatementNum, SecUserNumEntry, SecDateTEdit, TaxTransID
      FROM adjustment
      WHERE AdjNum = ?
    `;

    const records = await executeQuery<Adjustment[]>(selectQuery, [id]);

    const response: ApiResponse<Adjustment> = {
      success: true,
      data: mapAdjustment(records[0]),
      message: 'Adjustment updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT adjustment:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid foreign key reference for PatNum/AdjType/ProvNum/etc.' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAdjustment(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AdjNum FROM adjustment WHERE AdjNum = ?`;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Adjustment not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM adjustment WHERE AdjNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'Adjustment deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE adjustment:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALERTCATEGORY HANDLERS
// ========================================

function mapAlertCategory(record: any): AlertCategory {
  return {
    ...record,
    IsHQCategory: Boolean(record.IsHQCategory),
  };
}

function validateAlertCategoryPayload(data: CreateAlertCategoryRequest | UpdateAlertCategoryRequest, requireAll: boolean) {
  const errors: string[] = [];
  if (requireAll && (!data.Description || data.Description.trim() === '')) {
    errors.push('Description is required and cannot be blank');
  }
  if (data.Description !== undefined && data.Description.trim() === '') {
    errors.push('Description cannot be blank');
  }
  return errors;
}

async function handleGetAlertCategories(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertCategoryNum, IsHQCategory, InternalName, Description, created_at, updated_at
      FROM alertcategory
      ORDER BY Description ASC
    `;

    const results = await executeQuery<AlertCategory[]>(query);
    const categories = results.map(mapAlertCategory);

    const response: ApiResponse<AlertCategory[]> = {
      success: true,
      data: categories,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertcategory:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAlertCategory(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertCategoryNum, IsHQCategory, InternalName, Description, created_at, updated_at
      FROM alertcategory
      WHERE AlertCategoryNum = ?
    `;

    const results = await executeQuery<AlertCategory[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertCategory not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<AlertCategory> = {
      success: true,
      data: mapAlertCategory(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertcategory by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAlertCategory(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: CreateAlertCategoryRequest = JSON.parse(event.body);

    const errors = validateAlertCategoryPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO alertcategory
      (IsHQCategory, InternalName, Description)
      VALUES (?, ?, ?)
    `;

    const params = [
      data.IsHQCategory ? 1 : 0,
      data.InternalName ?? null,
      data.Description.trim(),
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AlertCategoryNum, IsHQCategory, InternalName, Description, created_at, updated_at
      FROM alertcategory
      WHERE AlertCategoryNum = ?
    `;

    const records = await executeQuery<AlertCategory[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AlertCategory> = {
      success: true,
      data: mapAlertCategory(records[0]),
      message: 'AlertCategory created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST alertcategory:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAlertCategory(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const checkQuery = `
      SELECT AlertCategoryNum, IsHQCategory
      FROM alertcategory
      WHERE AlertCategoryNum = ?
    `;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertCategory not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (existingRecords[0].IsHQCategory) {
      const response: ApiResponse = {
        success: false,
        error: 'HQ categories cannot be edited',
      };

      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: UpdateAlertCategoryRequest = JSON.parse(event.body);

    const errors = validateAlertCategoryPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.IsHQCategory !== undefined) {
      updateFields.push('IsHQCategory = ?');
      updateParams.push(data.IsHQCategory ? 1 : 0);
    }
    if (data.InternalName !== undefined) {
      updateFields.push('InternalName = ?');
      updateParams.push(data.InternalName ?? null);
    }
    if (data.Description !== undefined) {
      updateFields.push('Description = ?');
      updateParams.push(data.Description.trim());
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'At least one field must be provided for update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE alertcategory
      SET ${updateFields.join(', ')}
      WHERE AlertCategoryNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AlertCategoryNum, IsHQCategory, InternalName, Description, created_at, updated_at
      FROM alertcategory
      WHERE AlertCategoryNum = ?
    `;

    const records = await executeQuery<AlertCategory[]>(selectQuery, [id]);

    const response: ApiResponse<AlertCategory> = {
      success: true,
      data: mapAlertCategory(records[0]),
      message: 'AlertCategory updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT alertcategory:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAlertCategory(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `
      SELECT AlertCategoryNum, IsHQCategory
      FROM alertcategory
      WHERE AlertCategoryNum = ?
    `;
    const existingRecords = await executeQuery<any[]>(checkQuery, [id]);

    if (existingRecords.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertCategory not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (existingRecords[0].IsHQCategory) {
      const response: ApiResponse = {
        success: false,
        error: 'HQ categories cannot be deleted',
      };

      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM alertcategory WHERE AlertCategoryNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AlertCategory deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE alertcategory:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALERTCATEGORYLINK HANDLERS
// ========================================

function mapAlertCategoryLink(record: any): AlertCategoryLink {
  return {
    ...record,
    AlertCategoryNum: Number(record.AlertCategoryNum),
    AlertType: Number(record.AlertType) as AlertType,
  };
}

function validateAlertCategoryLinkPayload(
  data: CreateAlertCategoryLinkRequest | UpdateAlertCategoryLinkRequest,
  requireAll: boolean
) {
  const errors: string[] = [];

  if (requireAll && (data as any).AlertCategoryNum === undefined) {
    errors.push('AlertCategoryNum is required');
  }
  if (requireAll && (data as any).AlertType === undefined) {
    errors.push('AlertType is required');
  }

  if ((data as any).AlertCategoryNum !== undefined) {
    const val = Number((data as any).AlertCategoryNum);
    if (!Number.isFinite(val) || val <= 0) errors.push('AlertCategoryNum must be a positive number');
  }
  if ((data as any).AlertType !== undefined) {
    const val = Number((data as any).AlertType);
    if (val < AlertType.Generic || val > AlertType.WebSchedNewPat) {
      errors.push('AlertType must be between 0 and 5');
    }
  }

  return errors;
}

async function checkCategoryNotHQ(categoryNum: number) {
  const query = `
    SELECT AlertCategoryNum, IsHQCategory
    FROM alertcategory
    WHERE AlertCategoryNum = ?
  `;
  const rows = await executeQuery<any[]>(query, [categoryNum]);
  if (rows.length === 0) {
    throw new Error('AlertCategory not found');
  }
  if (rows[0].IsHQCategory) {
    const err: any = new Error('HQ categories cannot be modified');
    err.code = 'HQ_LOCKED';
    throw err;
  }
}

async function handleGetAlertCategoryLinks(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertCategoryLinkNum, AlertCategoryNum, AlertType, created_at, updated_at
      FROM alertcategorylink
      ORDER BY AlertCategoryNum ASC, AlertCategoryLinkNum ASC
    `;

    const results = await executeQuery<AlertCategoryLink[]>(query);
    const links = results.map(mapAlertCategoryLink);

    const response: ApiResponse<AlertCategoryLink[]> = {
      success: true,
      data: links,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertcategorylink:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAlertCategoryLink(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertCategoryLinkNum, AlertCategoryNum, AlertType, created_at, updated_at
      FROM alertcategorylink
      WHERE AlertCategoryLinkNum = ?
    `;

    const results = await executeQuery<AlertCategoryLink[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertCategoryLink not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<AlertCategoryLink> = {
      success: true,
      data: mapAlertCategoryLink(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertcategorylink by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAlertCategoryLink(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: CreateAlertCategoryLinkRequest = JSON.parse(event.body);
    const errors = validateAlertCategoryLinkPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await checkCategoryNotHQ(data.AlertCategoryNum);

    const insertQuery = `
      INSERT INTO alertcategorylink
      (AlertCategoryNum, AlertType)
      VALUES (?, ?)
    `;

    const params = [
      data.AlertCategoryNum,
      data.AlertType,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AlertCategoryLinkNum, AlertCategoryNum, AlertType, created_at, updated_at
      FROM alertcategorylink
      WHERE AlertCategoryLinkNum = ?
    `;

    const records = await executeQuery<AlertCategoryLink[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AlertCategoryLink> = {
      success: true,
      data: mapAlertCategoryLink(records[0]),
      message: 'AlertCategoryLink created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST alertcategorylink:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');
    const isHQ = (error as any)?.code === 'HQ_LOCKED';

    const response: ApiResponse = {
      success: false,
      error: isHQ
        ? 'HQ categories cannot be modified'
        : isForeignKeyError
          ? 'Invalid AlertCategoryNum reference'
          : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isHQ ? 403 : isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAlertCategoryLink(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = {
        success: false,
        error: 'Request body is required',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const checkQuery = `
      SELECT AlertCategoryLinkNum, AlertCategoryNum
      FROM alertcategorylink
      WHERE AlertCategoryLinkNum = ?
    `;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertCategoryLink not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const data: UpdateAlertCategoryLinkRequest = JSON.parse(event.body);
    const errors = validateAlertCategoryLinkPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    // If category is changing or for safety, ensure target category is not HQ
    const targetCategory = data.AlertCategoryNum ?? existing[0].AlertCategoryNum;
    await checkCategoryNotHQ(targetCategory);

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AlertCategoryNum !== undefined) {
      updateFields.push('AlertCategoryNum = ?');
      updateParams.push(data.AlertCategoryNum);
    }
    if (data.AlertType !== undefined) {
      updateFields.push('AlertType = ?');
      updateParams.push(data.AlertType);
    }

    if (updateFields.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'At least one field must be provided for update',
      };

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE alertcategorylink
      SET ${updateFields.join(', ')}
      WHERE AlertCategoryLinkNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AlertCategoryLinkNum, AlertCategoryNum, AlertType, created_at, updated_at
      FROM alertcategorylink
      WHERE AlertCategoryLinkNum = ?
    `;

    const records = await executeQuery<AlertCategoryLink[]>(selectQuery, [id]);

    const response: ApiResponse<AlertCategoryLink> = {
      success: true,
      data: mapAlertCategoryLink(records[0]),
      message: 'AlertCategoryLink updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT alertcategorylink:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');
    const isHQ = (error as any)?.code === 'HQ_LOCKED';

    const response: ApiResponse = {
      success: false,
      error: isHQ
        ? 'HQ categories cannot be modified'
        : isForeignKeyError
          ? 'Invalid AlertCategoryNum reference'
          : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isHQ ? 403 : isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAlertCategoryLink(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `
      SELECT acl.AlertCategoryLinkNum, ac.IsHQCategory
      FROM alertcategorylink acl
      INNER JOIN alertcategory ac ON ac.AlertCategoryNum = acl.AlertCategoryNum
      WHERE acl.AlertCategoryLinkNum = ?
    `;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertCategoryLink not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    if (existing[0].IsHQCategory) {
      const response: ApiResponse = {
        success: false,
        error: 'HQ categories cannot be modified',
      };

      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const deleteQuery = `DELETE FROM alertcategorylink WHERE AlertCategoryLinkNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AlertCategoryLink deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE alertcategorylink:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALERTITEM HANDLERS
// ========================================

function mapAlertItem(record: any): AlertItem {
  return {
    ...record,
    ClinicNum: Number(record.ClinicNum),
    Type: Number(record.Type) as AlertType,
    Severity: Number(record.Severity) as SeverityType,
    Actions: Number(record.Actions) as ActionType,
    FormToOpen: Number(record.FormToOpen) as FormType,
    FKey: Number(record.FKey),
    UserNum: Number(record.UserNum),
  };
}

function validateAlertItemPayload(
  data: CreateAlertItemRequest | UpdateAlertItemRequest,
  requireAll: boolean
) {
  const errors: string[] = [];

  const require = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  require(data.Description !== undefined, 'Description is required');
  require((data as any).Type !== undefined, 'Type is required');

  if (data.Description !== undefined && data.Description.trim() === '') {
    errors.push('Description cannot be blank');
  }

  if ((data as any).Type !== undefined) {
    const val = Number((data as any).Type);
    if (val < AlertType.Generic || val > AlertType.DefaultEmailNotSet) {
      errors.push('Type must be between 0 and 49');
    }
  }

  if ((data as any).Severity !== undefined) {
    const val = Number((data as any).Severity);
    if (val < SeverityType.Normal || val > SeverityType.High) {
      errors.push('Severity must be between 0 and 3');
    }
  }

  if ((data as any).Actions !== undefined) {
    const val = Number((data as any).Actions);
    if (!Number.isFinite(val) || val < 0) {
      errors.push('Actions must be a non-negative number');
    }
  }

  if ((data as any).FormToOpen !== undefined) {
    const val = Number((data as any).FormToOpen);
    if (val < FormType.None || val > FormType.FormAdvertisingMassEmailUpload) {
      errors.push('FormToOpen must be between 0 and 20');
    }
  }

  if ((data as any).ClinicNum !== undefined) {
    const val = Number((data as any).ClinicNum);
    if (!Number.isFinite(val)) errors.push('ClinicNum must be a number');
  }

  if ((data as any).FKey !== undefined) {
    const val = Number((data as any).FKey);
    if (!Number.isFinite(val) || val < 0) errors.push('FKey must be a non-negative number');
  }

  if ((data as any).UserNum !== undefined) {
    const val = Number((data as any).UserNum);
    if (!Number.isFinite(val) || val < 0) errors.push('UserNum must be a non-negative number');
  }

  return errors;
}

async function handleGetAlertItems(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertItemNum, ClinicNum, Description, Type, Severity, Actions, FormToOpen, FKey, ItemValue, UserNum, SecDateTEntry, created_at, updated_at
      FROM alertitem
      ORDER BY AlertItemNum DESC
    `;

    const results = await executeQuery<AlertItem[]>(query);
    const items = results.map(mapAlertItem);

    const response: ApiResponse<AlertItem[]> = {
      success: true,
      data: items,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertitem:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAlertItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertItemNum, ClinicNum, Description, Type, Severity, Actions, FormToOpen, FKey, ItemValue, UserNum, SecDateTEntry, created_at, updated_at
      FROM alertitem
      WHERE AlertItemNum = ?
    `;

    const results = await executeQuery<AlertItem[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertItem not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<AlertItem> = {
      success: true,
      data: mapAlertItem(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertitem by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAlertItem(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateAlertItemRequest = JSON.parse(event.body);
    const errors = validateAlertItemPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO alertitem
      (ClinicNum, Description, Type, Severity, Actions, FormToOpen, FKey, ItemValue, UserNum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.ClinicNum ?? 0,
      data.Description.trim(),
      data.Type,
      data.Severity ?? SeverityType.Normal,
      data.Actions ?? ActionType.None,
      data.FormToOpen ?? FormType.None,
      data.FKey ?? 0,
      data.ItemValue ?? null,
      data.UserNum ?? 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AlertItemNum, ClinicNum, Description, Type, Severity, Actions, FormToOpen, FKey, ItemValue, UserNum, SecDateTEntry, created_at, updated_at
      FROM alertitem
      WHERE AlertItemNum = ?
    `;

    const records = await executeQuery<AlertItem[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AlertItem> = {
      success: true,
      data: mapAlertItem(records[0]),
      message: 'AlertItem created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST alertitem:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAlertItem(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const checkQuery = `SELECT AlertItemNum FROM alertitem WHERE AlertItemNum = ?`;
    const exists = await executeQuery<any[]>(checkQuery, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAlertItemRequest = JSON.parse(event.body);
    const errors = validateAlertItemPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum); }
    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.Type !== undefined) { updateFields.push('Type = ?'); updateParams.push(data.Type); }
    if (data.Severity !== undefined) { updateFields.push('Severity = ?'); updateParams.push(data.Severity); }
    if (data.Actions !== undefined) { updateFields.push('Actions = ?'); updateParams.push(data.Actions); }
    if (data.FormToOpen !== undefined) { updateFields.push('FormToOpen = ?'); updateParams.push(data.FormToOpen); }
    if (data.FKey !== undefined) { updateFields.push('FKey = ?'); updateParams.push(data.FKey); }
    if (data.ItemValue !== undefined) { updateFields.push('ItemValue = ?'); updateParams.push(data.ItemValue); }
    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE alertitem
      SET ${updateFields.join(', ')}
      WHERE AlertItemNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AlertItemNum, ClinicNum, Description, Type, Severity, Actions, FormToOpen, FKey, ItemValue, UserNum, SecDateTEntry, created_at, updated_at
      FROM alertitem
      WHERE AlertItemNum = ?
    `;

    const records = await executeQuery<AlertItem[]>(selectQuery, [id]);

    const response: ApiResponse<AlertItem> = {
      success: true,
      data: mapAlertItem(records[0]),
      message: 'AlertItem updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT alertitem:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAlertItem(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AlertItemNum FROM alertitem WHERE AlertItemNum = ?`;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertItem not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const deleteQuery = `DELETE FROM alertitem WHERE AlertItemNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AlertItem deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE alertitem:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALERTREAD HANDLERS
// ========================================

function mapAlertRead(record: any): AlertRead {
  return {
    ...record,
    AlertItemNum: Number(record.AlertItemNum),
    UserNum: Number(record.UserNum),
  };
}

function validateAlertReadPayload(
  data: CreateAlertReadRequest | UpdateAlertReadRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const checkPos = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  if (requireAll && (data as any).AlertItemNum === undefined) {
    errors.push('AlertItemNum is required');
  }
  if (requireAll && (data as any).UserNum === undefined) {
    errors.push('UserNum is required');
  }

  checkPos((data as any).AlertItemNum, 'AlertItemNum');
  checkPos((data as any).UserNum, 'UserNum');

  return errors;
}

async function handleGetAlertReads(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertReadNum, AlertItemNum, UserNum, created_at, updated_at
      FROM alertread
      ORDER BY AlertReadNum DESC
    `;

    const results = await executeQuery<AlertRead[]>(query);
    const reads = results.map(mapAlertRead);

    const response: ApiResponse<AlertRead[]> = {
      success: true,
      data: reads,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertread:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAlertRead(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertReadNum, AlertItemNum, UserNum, created_at, updated_at
      FROM alertread
      WHERE AlertReadNum = ?
    `;

    const results = await executeQuery<AlertRead[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'AlertRead not found',
      };

      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const response: ApiResponse<AlertRead> = {
      success: true,
      data: mapAlertRead(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertread by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAlertRead(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateAlertReadRequest = JSON.parse(event.body);
    const errors = validateAlertReadPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO alertread (AlertItemNum, UserNum)
      VALUES (?, ?)
    `;

    const params = [data.AlertItemNum, data.UserNum];
    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AlertReadNum, AlertItemNum, UserNum, created_at, updated_at
      FROM alertread
      WHERE AlertReadNum = ?
    `;

    const records = await executeQuery<AlertRead[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AlertRead> = {
      success: true,
      data: mapAlertRead(records[0]),
      message: 'AlertRead created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST alertread:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid AlertItemNum or UserNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAlertRead(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const checkQuery = `SELECT AlertReadNum FROM alertread WHERE AlertReadNum = ?`;
    const exists = await executeQuery<any[]>(checkQuery, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertRead not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAlertReadRequest = JSON.parse(event.body);
    const errors = validateAlertReadPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AlertItemNum !== undefined) { updateFields.push('AlertItemNum = ?'); updateParams.push(data.AlertItemNum); }
    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE alertread
      SET ${updateFields.join(', ')}
      WHERE AlertReadNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AlertReadNum, AlertItemNum, UserNum, created_at, updated_at
      FROM alertread
      WHERE AlertReadNum = ?
    `;

    const records = await executeQuery<AlertRead[]>(selectQuery, [id]);

    const response: ApiResponse<AlertRead> = {
      success: true,
      data: mapAlertRead(records[0]),
      message: 'AlertRead updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT alertread:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid AlertItemNum or UserNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAlertRead(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AlertReadNum FROM alertread WHERE AlertReadNum = ?`;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertRead not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const deleteQuery = `DELETE FROM alertread WHERE AlertReadNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AlertRead deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE alertread:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALERTSUB HANDLERS
// ========================================

function mapAlertSub(record: any): AlertSub {
  return {
    ...record,
    UserNum: Number(record.UserNum),
    ClinicNum: Number(record.ClinicNum),
    Type: Number(record.Type),
    AlertCategoryNum: Number(record.AlertCategoryNum),
  };
}

function validateAlertSubPayload(
  data: CreateAlertSubRequest | UpdateAlertSubRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const checkPos = (val: any, name: string, allowZero = false) => {
    if (val === undefined) return;
    const n = Number(val);
    const ok = allowZero ? n >= 0 : n > 0;
    if (!Number.isFinite(n) || !ok) errors.push(`${name} must be ${allowZero ? 'non-negative' : 'positive'} number`);
  };

  if (requireAll && (data as any).UserNum === undefined) errors.push('UserNum is required');
  if (requireAll && (data as any).AlertCategoryNum === undefined) errors.push('AlertCategoryNum is required');

  checkPos((data as any).UserNum, 'UserNum');
  checkPos((data as any).AlertCategoryNum, 'AlertCategoryNum');
  checkPos((data as any).ClinicNum, 'ClinicNum', true);
  if ((data as any).Type !== undefined) {
    const n = Number((data as any).Type);
    if (!Number.isFinite(n)) errors.push('Type must be a number');
  }

  return errors;
}

async function handleGetAlertSubs(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertSubNum, UserNum, ClinicNum, Type, AlertCategoryNum, created_at, updated_at
      FROM alertsub
      ORDER BY AlertSubNum DESC
    `;

    const results = await executeQuery<AlertSub[]>(query);
    const subs = results.map(mapAlertSub);

    const response: ApiResponse<AlertSub[]> = {
      success: true,
      data: subs,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertsub:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAlertSub(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AlertSubNum, UserNum, ClinicNum, Type, AlertCategoryNum, created_at, updated_at
      FROM alertsub
      WHERE AlertSubNum = ?
    `;

    const results = await executeQuery<AlertSub[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertSub not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<AlertSub> = {
      success: true,
      data: mapAlertSub(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET alertsub by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAlertSub(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateAlertSubRequest = JSON.parse(event.body);
    const errors = validateAlertSubPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO alertsub (UserNum, ClinicNum, Type, AlertCategoryNum)
      VALUES (?, ?, ?, ?)
    `;

    const params = [
      data.UserNum,
      data.ClinicNum ?? 0,
      data.Type ?? 0,
      data.AlertCategoryNum,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AlertSubNum, UserNum, ClinicNum, Type, AlertCategoryNum, created_at, updated_at
      FROM alertsub
      WHERE AlertSubNum = ?
    `;

    const records = await executeQuery<AlertSub[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AlertSub> = {
      success: true,
      data: mapAlertSub(records[0]),
      message: 'AlertSub created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST alertsub:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid UserNum, ClinicNum, or AlertCategoryNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAlertSub(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const checkQuery = `SELECT AlertSubNum FROM alertsub WHERE AlertSubNum = ?`;
    const exists = await executeQuery<any[]>(checkQuery, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertSub not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAlertSubRequest = JSON.parse(event.body);
    const errors = validateAlertSubPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.UserNum !== undefined) { updateFields.push('UserNum = ?'); updateParams.push(data.UserNum); }
    if (data.ClinicNum !== undefined) { updateFields.push('ClinicNum = ?'); updateParams.push(data.ClinicNum); }
    if (data.Type !== undefined) { updateFields.push('Type = ?'); updateParams.push(data.Type); }
    if (data.AlertCategoryNum !== undefined) { updateFields.push('AlertCategoryNum = ?'); updateParams.push(data.AlertCategoryNum); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE alertsub
      SET ${updateFields.join(', ')}
      WHERE AlertSubNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AlertSubNum, UserNum, ClinicNum, Type, AlertCategoryNum, created_at, updated_at
      FROM alertsub
      WHERE AlertSubNum = ?
    `;

    const records = await executeQuery<AlertSub[]>(selectQuery, [id]);

    const response: ApiResponse<AlertSub> = {
      success: true,
      data: mapAlertSub(records[0]),
      message: 'AlertSub updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT alertsub:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid UserNum, ClinicNum, or AlertCategoryNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAlertSub(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AlertSubNum FROM alertsub WHERE AlertSubNum = ?`;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = { success: false, error: 'AlertSub not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const deleteQuery = `DELETE FROM alertsub WHERE AlertSubNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AlertSub deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE alertsub:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALLERGY HANDLERS
// ========================================

function mapAllergy(record: any): Allergy {
  return {
    ...record,
    AllergyDefNum: Number(record.AllergyDefNum),
    PatNum: Number(record.PatNum),
    StatusIsActive: Boolean(record.StatusIsActive),
  };
}

function validateAllergyPayload(
  data: CreateAllergyRequest | UpdateAllergyRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const checkPos = (val: any, name: string) => {
    if (val === undefined) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };

  if (requireAll && (data as any).AllergyDefNum === undefined) errors.push('AllergyDefNum is required');
  if (requireAll && (data as any).PatNum === undefined) errors.push('PatNum is required');

  checkPos((data as any).AllergyDefNum, 'AllergyDefNum');
  checkPos((data as any).PatNum, 'PatNum');

  if (data.StatusIsActive !== undefined && typeof data.StatusIsActive !== 'boolean') {
    errors.push('StatusIsActive must be boolean');
  }

  if (data.Reaction !== undefined && data.Reaction !== null && data.Reaction.trim() === '') {
    errors.push('Reaction cannot be blank if provided');
  }

  return errors;
}

async function handleGetAllergies(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AllergyNum, AllergyDefNum, PatNum, Reaction, StatusIsActive, DateTStamp, DateAdverseReaction, created_at, updated_at
      FROM allergy
      ORDER BY AllergyNum DESC
    `;

    const results = await executeQuery<Allergy[]>(query);
    const allergies = results.map(mapAllergy);

    const response: ApiResponse<Allergy[]> = {
      success: true,
      data: allergies,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET allergy:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAllergy(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AllergyNum, AllergyDefNum, PatNum, Reaction, StatusIsActive, DateTStamp, DateAdverseReaction, created_at, updated_at
      FROM allergy
      WHERE AllergyNum = ?
    `;

    const results = await executeQuery<Allergy[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'Allergy not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<Allergy> = {
      success: true,
      data: mapAllergy(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET allergy by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAllergy(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateAllergyRequest = JSON.parse(event.body);
    const errors = validateAllergyPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO allergy
      (AllergyDefNum, PatNum, Reaction, StatusIsActive, DateAdverseReaction)
      VALUES (?, ?, ?, ?, ?)
    `;

    const params = [
      data.AllergyDefNum,
      data.PatNum,
      data.Reaction ?? null,
      data.StatusIsActive === undefined ? 1 : (data.StatusIsActive ? 1 : 0),
      data.DateAdverseReaction ?? null,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AllergyNum, AllergyDefNum, PatNum, Reaction, StatusIsActive, DateTStamp, DateAdverseReaction, created_at, updated_at
      FROM allergy
      WHERE AllergyNum = ?
    `;

    const records = await executeQuery<Allergy[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<Allergy> = {
      success: true,
      data: mapAllergy(records[0]),
      message: 'Allergy created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST allergy:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid AllergyDefNum or PatNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAllergy(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const checkQuery = `SELECT AllergyNum FROM allergy WHERE AllergyNum = ?`;
    const exists = await executeQuery<any[]>(checkQuery, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'Allergy not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAllergyRequest = JSON.parse(event.body);
    const errors = validateAllergyPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.AllergyDefNum !== undefined) { updateFields.push('AllergyDefNum = ?'); updateParams.push(data.AllergyDefNum); }
    if (data.PatNum !== undefined) { updateFields.push('PatNum = ?'); updateParams.push(data.PatNum); }
    if (data.Reaction !== undefined) { updateFields.push('Reaction = ?'); updateParams.push(data.Reaction); }
    if (data.StatusIsActive !== undefined) { updateFields.push('StatusIsActive = ?'); updateParams.push(data.StatusIsActive ? 1 : 0); }
    if (data.DateAdverseReaction !== undefined) { updateFields.push('DateAdverseReaction = ?'); updateParams.push(data.DateAdverseReaction); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE allergy
      SET ${updateFields.join(', ')}
      WHERE AllergyNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AllergyNum, AllergyDefNum, PatNum, Reaction, StatusIsActive, DateTStamp, DateAdverseReaction, created_at, updated_at
      FROM allergy
      WHERE AllergyNum = ?
    `;

    const records = await executeQuery<Allergy[]>(selectQuery, [id]);

    const response: ApiResponse<Allergy> = {
      success: true,
      data: mapAllergy(records[0]),
      message: 'Allergy updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT allergy:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot add or update a child row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Invalid AllergyDefNum or PatNum reference' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 400 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAllergy(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AllergyNum FROM allergy WHERE AllergyNum = ?`;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = { success: false, error: 'Allergy not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const deleteQuery = `DELETE FROM allergy WHERE AllergyNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'Allergy deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE allergy:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// ALLERGYDEF HANDLERS
// ========================================

function mapAllergyDef(record: any): AllergyDef {
  return {
    ...record,
    IsHidden: Boolean(record.IsHidden),
  };
}

function validateAllergyDefPayload(
  data: CreateAllergyDefRequest | UpdateAllergyDefRequest,
  requireAll: boolean
) {
  const errors: string[] = [];

  if (requireAll && (!data.Description || data.Description.trim() === '')) {
    errors.push('Description is required and cannot be blank');
  }
  if (data.Description !== undefined && data.Description.trim() === '') {
    errors.push('Description cannot be blank');
  }

  return errors;
}

async function handleGetAllergyDefs(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AllergyDefNum, Description, ICD9Code, SNOMEDCTCode, IsHidden, created_at, updated_at
      FROM allergydef
      ORDER BY Description ASC
    `;

    const results = await executeQuery<AllergyDef[]>(query);
    const defs = results.map(mapAllergyDef);

    const response: ApiResponse<AllergyDef[]> = {
      success: true,
      data: defs,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET allergydef:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleGetAllergyDef(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT AllergyDefNum, Description, ICD9Code, SNOMEDCTCode, IsHidden, created_at, updated_at
      FROM allergydef
      WHERE AllergyDefNum = ?
    `;

    const results = await executeQuery<AllergyDef[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'AllergyDef not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<AllergyDef> = {
      success: true,
      data: mapAllergyDef(results[0]),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in GET allergydef by id:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePostAllergyDef(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateAllergyDefRequest = JSON.parse(event.body);
    const errors = validateAllergyDefPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO allergydef
      (Description, ICD9Code, SNOMEDCTCode, IsHidden)
      VALUES (?, ?, ?, ?)
    `;

    const params = [
      data.Description.trim(),
      data.ICD9Code ?? null,
      data.SNOMEDCTCode ?? null,
      data.IsHidden ? 1 : 0,
    ];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT AllergyDefNum, Description, ICD9Code, SNOMEDCTCode, IsHidden, created_at, updated_at
      FROM allergydef
      WHERE AllergyDefNum = ?
    `;

    const records = await executeQuery<AllergyDef[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<AllergyDef> = {
      success: true,
      data: mapAllergyDef(records[0]),
      message: 'AllergyDef created successfully',
    };

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in POST allergydef:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handlePutAllergyDef(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const checkQuery = `SELECT AllergyDefNum FROM allergydef WHERE AllergyDefNum = ?`;
    const exists = await executeQuery<any[]>(checkQuery, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'AllergyDef not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAllergyDefRequest = JSON.parse(event.body);
    const errors = validateAllergyDefPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.Description !== undefined) { updateFields.push('Description = ?'); updateParams.push(data.Description.trim()); }
    if (data.ICD9Code !== undefined) { updateFields.push('ICD9Code = ?'); updateParams.push(data.ICD9Code ?? null); }
    if (data.SNOMEDCTCode !== undefined) { updateFields.push('SNOMEDCTCode = ?'); updateParams.push(data.SNOMEDCTCode ?? null); }
    if (data.IsHidden !== undefined) { updateFields.push('IsHidden = ?'); updateParams.push(data.IsHidden ? 1 : 0); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE allergydef
      SET ${updateFields.join(', ')}
      WHERE AllergyDefNum = ?
    `;

    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT AllergyDefNum, Description, ICD9Code, SNOMEDCTCode, IsHidden, created_at, updated_at
      FROM allergydef
      WHERE AllergyDefNum = ?
    `;

    const records = await executeQuery<AllergyDef[]>(selectQuery, [id]);

    const response: ApiResponse<AllergyDef> = {
      success: true,
      data: mapAllergyDef(records[0]),
      message: 'AllergyDef updated successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in PUT allergydef:', error);

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

async function handleDeleteAllergyDef(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const checkQuery = `SELECT AllergyDefNum FROM allergydef WHERE AllergyDefNum = ?`;
    const existing = await executeQuery<any[]>(checkQuery, [id]);

    if (existing.length === 0) {
      const response: ApiResponse = { success: false, error: 'AllergyDef not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const deleteQuery = `DELETE FROM allergydef WHERE AllergyDefNum = ?`;
    await executeQuery(deleteQuery, [id]);

    const response: ApiResponse = {
      success: true,
      message: 'AllergyDef deleted successfully',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in DELETE allergydef:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isForeignKeyError = errorMessage.includes('foreign key constraint') ||
                              errorMessage.includes('Cannot delete or update a parent row');

    const response: ApiResponse = {
      success: false,
      error: isForeignKeyError ? 'Cannot delete AllergyDef: it is referenced by other records' : 'Internal server error',
      message: errorMessage,
    };

    return {
      statusCode: isForeignKeyError ? 409 : 500,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  }
}

// ========================================
// APIKEY HANDLERS
// ========================================

function mapAPIKey(record: any): APIKey {
  return {
    ...record,
    APIKeyNum: Number(record.APIKeyNum),
  };
}

function validateAPIKeyPayload(
  data: CreateAPIKeyRequest | UpdateAPIKeyRequest,
  requireAll: boolean
) {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (requireAll && !cond) errors.push(msg); };

  need(data.CustApiKey !== undefined, 'CustApiKey is required');
  need(data.DevName !== undefined, 'DevName is required');

  if (data.CustApiKey !== undefined && data.CustApiKey.trim() === '') {
    errors.push('CustApiKey cannot be blank');
  }
  if (data.DevName !== undefined && data.DevName.trim() === '') {
    errors.push('DevName cannot be blank');
  }

  return errors;
}

async function handleGetAPIKeys(corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT APIKeyNum, CustApiKey, DevName, created_at, updated_at
      FROM apikey
      ORDER BY APIKeyNum DESC
    `;

    const results = await executeQuery<APIKey[]>(query);
    const keys = results.map(mapAPIKey);

    const response: ApiResponse<APIKey[]> = { success: true, data: keys };

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apikey:', error);

    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleGetAPIKey(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const query = `
      SELECT APIKeyNum, CustApiKey, DevName, created_at, updated_at
      FROM apikey
      WHERE APIKeyNum = ?
    `;

    const results = await executeQuery<APIKey[]>(query, [id]);

    if (results.length === 0) {
      const response: ApiResponse = { success: false, error: 'APIKey not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const response: ApiResponse<APIKey> = { success: true, data: mapAPIKey(results[0]) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in GET apikey by id:', error);

    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePostAPIKey(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: CreateAPIKeyRequest = JSON.parse(event.body);
    const errors = validateAPIKeyPayload(data, true);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const insertQuery = `
      INSERT INTO apikey (CustApiKey, DevName)
      VALUES (?, ?)
    `;
    const params = [data.CustApiKey.trim(), data.DevName.trim()];

    const result: any = await executeQuery(insertQuery, params);

    const selectQuery = `
      SELECT APIKeyNum, CustApiKey, DevName, created_at, updated_at
      FROM apikey
      WHERE APIKeyNum = ?
    `;
    const records = await executeQuery<APIKey[]>(selectQuery, [result.insertId]);

    const response: ApiResponse<APIKey> = {
      success: true,
      data: mapAPIKey(records[0]),
      message: 'APIKey created successfully',
    };

    return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in POST apikey:', error);

    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handlePutAPIKey(id: string, event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      const response: ApiResponse = { success: false, error: 'Request body is required' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const exists = await executeQuery<any[]>(`SELECT APIKeyNum FROM apikey WHERE APIKeyNum = ?`, [id]);
    if (exists.length === 0) {
      const response: ApiResponse = { success: false, error: 'APIKey not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const data: UpdateAPIKeyRequest = JSON.parse(event.body);
    const errors = validateAPIKeyPayload(data, false);
    if (errors.length > 0) {
      const response: ApiResponse = { success: false, error: errors.join('; ') };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (data.CustApiKey !== undefined) { updateFields.push('CustApiKey = ?'); updateParams.push(data.CustApiKey.trim()); }
    if (data.DevName !== undefined) { updateFields.push('DevName = ?'); updateParams.push(data.DevName.trim()); }

    if (updateFields.length === 0) {
      const response: ApiResponse = { success: false, error: 'At least one field must be provided for update' };
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(response) };
    }

    updateParams.push(id);

    const updateQuery = `
      UPDATE apikey
      SET ${updateFields.join(', ')}
      WHERE APIKeyNum = ?
    `;
    await executeQuery(updateQuery, updateParams);

    const selectQuery = `
      SELECT APIKeyNum, CustApiKey, DevName, created_at, updated_at
      FROM apikey
      WHERE APIKeyNum = ?
    `;
    const records = await executeQuery<APIKey[]>(selectQuery, [id]);

    const response: ApiResponse<APIKey> = {
      success: true,
      data: mapAPIKey(records[0]),
      message: 'APIKey updated successfully',
    };

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in PUT apikey:', error);

    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

async function handleDeleteAPIKey(id: string, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    const existing = await executeQuery<any[]>(`SELECT APIKeyNum FROM apikey WHERE APIKeyNum = ?`, [id]);
    if (existing.length === 0) {
      const response: ApiResponse = { success: false, error: 'APIKey not found' };
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify(response) };
    }

    await executeQuery(`DELETE FROM apikey WHERE APIKeyNum = ?`, [id]);

    const response: ApiResponse = { success: true, message: 'APIKey deleted successfully' };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in DELETE apikey:', error);

    const response: ApiResponse = { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' };
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(response) };
  }
}

