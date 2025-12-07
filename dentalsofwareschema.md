Home
Version 25.4b

Filter Tables...

Show Schema Changes
Database Tables
account
accountingautopay
activeinstance
adjustment
alertcategory
alertcategorylink
alertitem
alertread
alertsub
allergy
allergydef
apikey
apisubscription
appointment
appointmentrule
appointmenttype
apptfield
apptfielddef
apptgeneralmessagesent
apptnewpatthankyousent
apptreminderrule
apptremindersent
apptthankyousent
apptview
apptviewitem
asapcomm
autocode
autocodecond
autocodeitem
autocommexcludedate
automation
automationcondition
autonote
autonotecontrol
benefit
branding
canadiannetwork
carecreditwebresponse
carrier
cdcrec
cdspermission
centralconnection
cert
certemployee
chartview
chat
chatattach
chatmsg
chatreaction
chatuserattach
chatuserod
claim
claimattach
claimcondcodelog
claimform
claimformitem
claimpayment
claimproc
claimsnapshot
claimtracking
claimvalcodelog
clearinghouse
clinic
clinicerx
clinicpref
clockevent
cloudaddress
codegroup
codesystem
commlog
commoptout
computer
computerpref
confirmationrequest
connectiongroup
conngroupattach
contact
county
covcat
covspan
cpt
creditcard
custrefentry
custreference
cvx
dashboardar
dashboardcell
dashboardlayout
databasemaintenance
dbmlog
definition
deflink
deletedobject
deposit
dictcustom
discountplan
discountplansub
disease
diseasedef
displayfield
displayreport
dispsupply
document
documentmisc
drugmanufacturer
drugunit
dunning
ebill
eclipboardimagecapture
eclipboardimagecapturedef
eclipboardsheetdef
eduresource
eform
eformdef
eformfield
eformfielddef
eformimportrule
ehramendment
ehraptobs
ehrcareplan
ehrlab
ehrlabclinicalinfo
ehrlabimage
ehrlabnote
ehrlabresult
ehrlabresultscopyto
ehrlabspecimen
ehrlabspecimencondition
ehrlabspecimenrejectreason
ehrmeasure
ehrmeasureevent
ehrnotperformed
ehrpatient
ehrprovkey
ehrquarterlykey
ehrsummaryccd
ehrtrigger
electid
emailaddress
emailattach
emailautograph
emailhostingtemplate
emailmessage
emailmessageuid
emailsecure
emailsecureattach
emailtemplate
employee
employer
encounter
entrylog
eobattach
equipment
erouting
eroutingaction
eroutingactiondef
eroutingdef
eroutingdeflink
erxlog
eservicelog
eserviceshortguid
eservicesignal
etrans
etrans835
etrans835attach
etransmessagetext
evaluation
evaluationcriterion
evaluationcriteriondef
evaluationdef
famaging
familyhealth
fee
feesched
feeschedgroup
feeschednote
fhircontactpoint
fhirsubscription
fielddeflink
formpat
gradingscale
gradingscaleitem
grouppermission
guardian
hcpcs
hieclinic
hiequeue
histappointment
hl7def
hl7deffield
hl7defmessage
hl7defsegment
hl7msg
hl7procattach
icd10
icd9
imagedraw
imagingdevice
insbluebook
insbluebooklog
insbluebookrule
inseditlog
inseditpatlog
insfilingcode
insfilingcodesubtype
inspending
insplan
insplanpreference
inssub
installmentplan
insverify
insverifyhist
intervention
journalentry
labcase
laboratory
labpanel
labresult
labturnaround
language
languageforeign
languagepat
letter
lettermerge
lettermergefield
limitedbetafeature
loginattempt
loinc
medicalorder
medication
medicationpat
medlab
medlabfacattach
medlabfacility
medlabresult
medlabspecimen
mobileappdevice
mobilebrandingprofile
mobiledatabyte
mobilenotification
mount
mountdef
mountitem
mountitemdef
msgtopaysent
oidexternal
oidinternal
operatory
orionproc
orthocase
orthochart
orthochartlog
orthochartrow
orthocharttab
orthocharttablink
orthohardware
orthohardwarespec
orthoplanlink
orthoproclink
orthorx
orthoschedule
patfield
patfielddef
patfieldpickitem
patient
patientlink
patientnote
patientportalinvite
patientrace
patplan
patrestriction
payconnectresponseweb
payment
payortype
payperiod
payplan
payplancharge
payplanlink
payplantemplate
paysplit
paysuitepayment
paysuitepaymentdetail
payterminal
pearlrequest
perioexam
periomeasure
pharmacy
pharmclinic
phonenumber
popup
preference
printer
procapptcolor
procbutton
procbuttonitem
procbuttonquick
proccodenote
procedurecode
procedurelog
procgroupitem
procmultivisit
procnote
proctp
program
programproperty
promotion
promotionlog
provider
providerclinic
providercliniclink
providererx
providerident
queryfilter
question
questiondef
quickpastecat
quickpastenote
reactivation
recall
recalltrigger
recalltype
reconcile
recurringcharge
refattach
referral
referralcliniclink
registrationkey
reminderrule
repeatcharge
replicationserver
reqneeded
reqstudent
requiredfield
requiredfieldcondition
rxalert
rxdef
rxnorm
rxpat
schedule
scheduledprocess
scheduleop
schoolapproval
schoolclass
schoolcourse
schoolcoursedef
schoolcourseenrollee
schoolcourseinstructor
schoolcoursesched
screen
screengroup
screenpat
securitylog
securityloghash
sequencecounter
sessiontoken
sheet
sheetdef
sheetfield
sheetfielddef
sigbutdef
sigelementdef
sigmessage
signalod
site
smsblockphone
smsfrommobile
smsphone
smstomobile
snomed
sop
stateabbr
statement
statementprod
stmtlink
substitutionlink
supplier
supply
supplyneeded
supplyorder
supplyorderitem
task
taskancestor
taskattachment
taskhist
tasklist
tasknote
tasksubscription
taskunread
terminalactive
timeadjust
timecardrule
toolbutitem
toothgridcell
toothgridcol
toothgriddef
toothinitial
transaction
transactioninvoice
treatplan
treatplanattach
treatplanparam
tsitranslog
ucum
updatehistory
userclinic
usergroup
usergroupattach
userod
userodapptview
userodpref
userquery
userweb
utm
vaccinedef
vaccineobs
vaccinepat
vitalsign
webschedcarrierrule
webschedrecall
wikilistheaderwidth
wikilisthist
wikipage
wikipagehist
xchargetransaction
xwebresponse
zipcode

account
Used in the accounting section in chart of accounts. Not related to patient accounts in any way.
Order	Name	Type	Summary
0	AccountNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	AcctType	tinyint	Enum:AccountType Asset, Liability, Equity,Revenue, Expense
Asset: 0
Liability: 1
Equity: 2
Income: 3
Expense: 4
3	BankNumber	varchar(255)	For asset accounts, this would be the bank account number for deposit slips.
4	Inactive	tinyint	Set to true to not normally view this account in the list.
5	AccountColor	int(11)	.
6	IsRetainedEarnings	tinyint(4)	This will be set true for exactly one account, and it can't be changed. On the Balance Sheet report, this special account will also contain the sum of all expenses and income for all previous years.

accountingautopay
In the accounting section, this automates entries into the database when user enters a payment into a patient account. This table presents the user with a picklist specific to that payment type. For example, a cash payment would create a picklist of cashboxes for user to put the cash into.
Order	Name	Type	Summary
0	AccountingAutoPayNum	bigint(20)	Primary key.
1	PayType	bigint(20)	FK to definition.DefNum.
2	PickList	varchar(255)	FK to account.AccountNum. AccountNums separated by commas. No spaces.

activeinstance
ActiveInstances are used to track OD sessions.
Order	Name	Type	Summary
0	ActiveInstanceNum	bigint(20)	Primary key
1	ComputerNum	bigint(20)	FK to Computers.ComputerNum
2	UserNum	bigint(20)	FK to userod.UserNum
3	ProcessId	bigint(20)	Windows Process ID of the Open Dental instance
4	DateTimeLastActive	datetime	Last datetime that was activity was recorded
5	DateTRecorded	datetime	The time at which we recorded DateTimeLastActive. This is not a TimeStamp column because we need to update it even if nothing else in the row changed.
6	ConnectionType	tinyint(4)	Enum:ConnectionTypes Used to distinguish the connection type.
Direct: 0 - Direct
MiddleTier: 1 - MiddleTier
Thinfinity: 2 - Thinfinity
AppStream: 3 - AppStream

adjustment
An adjustment in the patient account. Usually, adjustments are very simple, just being assigned to one patient and provider. But they can also be attached to a procedure to represent a discount on that procedure. Attaching adjustments to procedures is not automated, so it is not very common.
Order	Name	Type	Summary
0	AdjNum	bigint(20)	Primary key.
1	AdjDate	date	The date that the adjustment shows in the patient account.
2	AdjAmt	double	Amount of adjustment. Can be pos or neg.
3	PatNum	bigint(20)	FK to patient.PatNum.
4	AdjType	bigint(20)	FK to definition.DefNum.
5	ProvNum	bigint(20)	FK to provider.ProvNum.
6	AdjNote	text	Note for this adjustment.
7	ProcDate	date	Procedure date. Not when the adjustment was entered.
8	ProcNum	bigint(20)	FK to procedurelog.ProcNum. Only used if attached to a procedure. Otherwise, 0.
9	DateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
10	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
11	StatementNum	bigint(20)	FK to statement.StatementNum. Only used when the statement in an invoice.
12	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
13	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
14	TaxTransID	bigint(20)	(Deprecated) Holds the Avalara transaction ID associated with this adjustment so that we can track reported adjustments. Not editable in the UI.

alertcategory
A grouping of alert types that you can subscribe to. The alert types are stored as AlertCategoryLink rows attached to each category. Users can make their own custom categories by copying existing ones.
Order	Name	Type	Summary
0	AlertCategoryNum	bigint(20)	Primary key.
1	IsHQCategory	tinyint(4)	False by default, indicates that this is a category that can not be edited or deleted. When a copy of a category is made, the copy changes this value from true to false.
2	InternalName	varchar(255)	Name used by HQ to identify the type of alert category this started as, allows us to associate new alerts.
3	Description	varchar(255)	Name displayed to user when subscribing to alerts categories.

alertcategorylink
Each row is an alert type for an alertcategory. Users can change which types are attached to custom categories.
Order	Name	Type	Summary
0	AlertCategoryLinkNum	bigint(20)	Primary key.
1	AlertCategoryNum	bigint(20)	FK to alertcategory.AlertCategoryNum.
2	AlertType	tinyint(4)	Enum:AlertType Identifies what types of alert this row is associated to.
Generic: 0 - Generic. Informational, has no action associated with it
OnlinePaymentsPending: 1 - Opens the Online Payments Window when clicked
VoiceMailMonitor: 2 - Only used by Open Dental HQ. The server monitoring incoming voicemails is not working.
RadiologyProcedures: 3 - Opens the Radiology Order List window when clicked.
CallbackRequested: 4 - A patient has clicked "Request Callback" on an e-Confirmation.
WebSchedNewPat: 5 - Alerts related to the Web Sched New Pat eService.
WebSchedNewPatApptCreated: 6 - Alerts related to Web Sched New Patient Appointments.
NumberBarredFromTexting: 7 - A number is not able to receive text messages.
MaxConnectionsMonitor: 8 - The number of MySQL connections to the server has exceeded half the allowed number of connections.
WebSchedASAPApptCreated: 9 - Alerts related to new ASAP appointments via web sched.
AsteriskServerMonitor: 10 - Only used by Open Dental HQ. The Asterisk Server is not processing messages or is getting all blank payloads.
MultipleEConnectors: 11 - Multiple computers are running eConnector services. There should only ever be one.
EConnectorDown: 12 - The eConnector is in a critical state and not currently turned on. There should only ever be one.
EConnectorError: 13 - The eConnector has an error that is not critical but is worth looking into. There should only ever be one.
DoseSpotProviderRegistered: 14 - Alerts related to DoseSpot provider registration.
DoseSpotClinicRegistered: 15 - Alerts related to DoseSpot clinic registration.
WebSchedRecallApptCreated: 16 - An appointment has been created via Web Sched Recall.
ClinicsChanged: 17 - Alerts related to turning clinics on or off for eServices.
ClinicsChangedInternal: 18 - Alerts related to turning clinics on or off for eServices. Internal, not displayed to the customer. Will be processed by the eConnector and then deleted.
MultipleOpenDentalServices: 19 - Multiple computers are running OpenDentalServices. There should only ever be one.
OpenDentalServiceDown: 20 - OpenDentalService is down.
WebMailReceived: 21 - Triggered when a new WebMail is received from the patient portal.
EconnectorEmailTooManySendFails: 22 - Triggered when the consecutive count of failed emails for clinic reaches greater than the value set in EmailAlertMaxConsecutiveFails preference.
SupplementalBackups: 23 - Alert the user for things like not making a local supplemental backup within the last month.
EConnectorMySqlTime: 24 - Alert the user that the local time on the eConnector does not closely match the time of the database. Intended to only have one instance max.
CareCreditBatchError: 25 - Alert the user that there are CareCredit batch errors.
PatientArrival: 26 - Alert the user that there are patients who have texted to indicate they have arrived for their appointment.
EmailSecure: 27 - Alert the user that there are new secure emails that have been downloaded.
WebSchedExistingPatApptCreated: 28 - An appointment has been created via Web Sched Exising Pat
CloudAlertWithinLimit: 29 - Alert the user when they're approaching their Cloud Session Limit (determined by CloudAlertWithinLimit pref)
WebFormsReady: 30 - Alert that web forms are ready to be retrieved.
PushHubDown: 31 - Alert HQ that a push hub client has reached its failure threshold or all push hub clients are failing
Update: 32 - Alert that user action is required after an update.
ReplicationMonitor: 33 - Alert.
WebSchedRecallsNotSending: 34 - Alert that no recalls have sent in a period of time.
TenDlc: 35 - Alert if an account using 10DLC goes over their daily max limit or if we've neglected to set up our pref correctly
AddToCalendar: 36 - Alert if a clinic is not signed for eConfirmations but is trying to use the AddToCalendar tag. FKey on this alert type is used to determine the type of autocomm that created this alert rather than a FKey to a db row.
EConnectorRedistributableMissing: 37 - Alert that is created when an eClipboard/ODM/ODT device tries to get a tooth chart image, but their eConn server is missing a specific redistributable that allows the creation of the image.
SMSThread: 38 - Alert that is created when the SMSQueuer is turned on but no Broadcaster Servers are configured to send out text messages. Requires Engineers to update BroadcasterThreadSettings.
SignatureCleared: 39 - Alert that is created when a procedure or group note's signature is cleared by another user editing that note.
Pearl: 40 - Alert that is created when an error occurs while uploading an image to Pearl or processing Pearl results.
BetterDiagnostics: 41 - Alert that is created when an error occurs while uploading an image to BetterDiagnostics or processing BetterDiagnostics results.
MessageToPayTag: 42 - Alert that is created when running Billing and both email and SMS templates do not contain [MsgToPayURL] replacement tag.
MassEmailUpload: 43 - Alert that is created while a mass email audience is being uploaded.
MassEmailReceipt: 44 - Alert that commlogs have been created for a sent mass email.
HQNotification: 45 - Alert that is created by HQ to send a notification to specific customers.
TreatmentPlanImagesFolderInaccesible: 46 - Alert that is created when the eConnector is unable to gain access to or cannot find the images folder when saving Signed Treatment Plan PDFs for ODTouch or eClipboard.
PaymentPlanImagesFolderInaccesible: 47 - Alert that is created when the eConnector is unable to gain access to or cannot find the images folder when saving Signed Payment Plan PDFs for ODTouch or eClipboard.
CannotCreateOrAccessPatientFolder: 48 - Alert that is created when unable to create or access a Patient folder in the images folder for ODTouch or eClipboard.
DefaultEmailNotSet: 49 - Alert that is created when there is no default email address set for an office that is subscribed to an eService that uses email.

alertitem
Any row in this table will show up in the main menu of Open Dental to get the attention of the user. The user can click on the alert and take an action. The actions available to the user are also determined in this row.
Order	Name	Type	Summary
0	AlertItemNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be 0 or -1. -1 indicates show the alert in all clinics.
2	Description	varchar(2000)	What is displayed in the menu item.
3	Type	tinyint(4)	Enum:AlertType Identifies what type of alert this row is.
Generic: 0 - Generic. Informational, has no action associated with it
OnlinePaymentsPending: 1 - Opens the Online Payments Window when clicked
VoiceMailMonitor: 2 - Only used by Open Dental HQ. The server monitoring incoming voicemails is not working.
RadiologyProcedures: 3 - Opens the Radiology Order List window when clicked.
CallbackRequested: 4 - A patient has clicked "Request Callback" on an e-Confirmation.
WebSchedNewPat: 5 - Alerts related to the Web Sched New Pat eService.
WebSchedNewPatApptCreated: 6 - Alerts related to Web Sched New Patient Appointments.
NumberBarredFromTexting: 7 - A number is not able to receive text messages.
MaxConnectionsMonitor: 8 - The number of MySQL connections to the server has exceeded half the allowed number of connections.
WebSchedASAPApptCreated: 9 - Alerts related to new ASAP appointments via web sched.
AsteriskServerMonitor: 10 - Only used by Open Dental HQ. The Asterisk Server is not processing messages or is getting all blank payloads.
MultipleEConnectors: 11 - Multiple computers are running eConnector services. There should only ever be one.
EConnectorDown: 12 - The eConnector is in a critical state and not currently turned on. There should only ever be one.
EConnectorError: 13 - The eConnector has an error that is not critical but is worth looking into. There should only ever be one.
DoseSpotProviderRegistered: 14 - Alerts related to DoseSpot provider registration.
DoseSpotClinicRegistered: 15 - Alerts related to DoseSpot clinic registration.
WebSchedRecallApptCreated: 16 - An appointment has been created via Web Sched Recall.
ClinicsChanged: 17 - Alerts related to turning clinics on or off for eServices.
ClinicsChangedInternal: 18 - Alerts related to turning clinics on or off for eServices. Internal, not displayed to the customer. Will be processed by the eConnector and then deleted.
MultipleOpenDentalServices: 19 - Multiple computers are running OpenDentalServices. There should only ever be one.
OpenDentalServiceDown: 20 - OpenDentalService is down.
WebMailReceived: 21 - Triggered when a new WebMail is received from the patient portal.
EconnectorEmailTooManySendFails: 22 - Triggered when the consecutive count of failed emails for clinic reaches greater than the value set in EmailAlertMaxConsecutiveFails preference.
SupplementalBackups: 23 - Alert the user for things like not making a local supplemental backup within the last month.
EConnectorMySqlTime: 24 - Alert the user that the local time on the eConnector does not closely match the time of the database. Intended to only have one instance max.
CareCreditBatchError: 25 - Alert the user that there are CareCredit batch errors.
PatientArrival: 26 - Alert the user that there are patients who have texted to indicate they have arrived for their appointment.
EmailSecure: 27 - Alert the user that there are new secure emails that have been downloaded.
WebSchedExistingPatApptCreated: 28 - An appointment has been created via Web Sched Exising Pat
CloudAlertWithinLimit: 29 - Alert the user when they're approaching their Cloud Session Limit (determined by CloudAlertWithinLimit pref)
WebFormsReady: 30 - Alert that web forms are ready to be retrieved.
PushHubDown: 31 - Alert HQ that a push hub client has reached its failure threshold or all push hub clients are failing
Update: 32 - Alert that user action is required after an update.
ReplicationMonitor: 33 - Alert.
WebSchedRecallsNotSending: 34 - Alert that no recalls have sent in a period of time.
TenDlc: 35 - Alert if an account using 10DLC goes over their daily max limit or if we've neglected to set up our pref correctly
AddToCalendar: 36 - Alert if a clinic is not signed for eConfirmations but is trying to use the AddToCalendar tag. FKey on this alert type is used to determine the type of autocomm that created this alert rather than a FKey to a db row.
EConnectorRedistributableMissing: 37 - Alert that is created when an eClipboard/ODM/ODT device tries to get a tooth chart image, but their eConn server is missing a specific redistributable that allows the creation of the image.
SMSThread: 38 - Alert that is created when the SMSQueuer is turned on but no Broadcaster Servers are configured to send out text messages. Requires Engineers to update BroadcasterThreadSettings.
SignatureCleared: 39 - Alert that is created when a procedure or group note's signature is cleared by another user editing that note.
Pearl: 40 - Alert that is created when an error occurs while uploading an image to Pearl or processing Pearl results.
BetterDiagnostics: 41 - Alert that is created when an error occurs while uploading an image to BetterDiagnostics or processing BetterDiagnostics results.
MessageToPayTag: 42 - Alert that is created when running Billing and both email and SMS templates do not contain [MsgToPayURL] replacement tag.
MassEmailUpload: 43 - Alert that is created while a mass email audience is being uploaded.
MassEmailReceipt: 44 - Alert that commlogs have been created for a sent mass email.
HQNotification: 45 - Alert that is created by HQ to send a notification to specific customers.
TreatmentPlanImagesFolderInaccesible: 46 - Alert that is created when the eConnector is unable to gain access to or cannot find the images folder when saving Signed Treatment Plan PDFs for ODTouch or eClipboard.
PaymentPlanImagesFolderInaccesible: 47 - Alert that is created when the eConnector is unable to gain access to or cannot find the images folder when saving Signed Payment Plan PDFs for ODTouch or eClipboard.
CannotCreateOrAccessPatientFolder: 48 - Alert that is created when unable to create or access a Patient folder in the images folder for ODTouch or eClipboard.
DefaultEmailNotSet: 49 - Alert that is created when there is no default email address set for an office that is subscribed to an eService that uses email.
4	Severity	tinyint(4)	Enum:SeverityType The severity will help determine what color this alert should be in the main menu.
Normal: 0 - White
Low: 1 - Yellow
Medium: 2 - Orange
High: 3 - Red
5	Actions	tinyint(4)	Enum:ActionType Bitwise flag that represents what actions are available for this alert.
None:
MarkAsRead:
OpenForm:
Delete:
ShowItemValue:
6	FormToOpen	tinyint(4)	Enum:FormType The form to open when the user clicks "Open Form".
None: 0 - No form.
FormEServicesWebSchedRecall: 1 - FormEServicesWebSchedRecall.
FormOnlinePayments: 2 - FormOnlinePayments.
FormRadOrderList: 3 - FormRadOrderList.
FormEServicesSignupPortal: 4 - FormEServicesSetup.
FormApptEdit: 5 - FormEServicesSetup. FKey will be the AptNum of the appointment to open.
FormEServicesWebSchedNewPat: 6 - FormEServicesSetup Web Sched New Pat.
FormWebSchedAppts: 7 - FormWebSchedAppts.
FormPatientEdit: 8 - FormPatientEdit. FKey will be PatNum.
FormEServicesEConnector: 9 - FormEServicesSetup eConnector Service.
FormDoseSpotAssignUserId: 10 - FormDoseSpotAssignUserId.
FormDoseSpotAssignClinicId: 11 - FormDoseSpotAssignClinicId.
FormEmailInbox: 12 - FormWebMailMessageEdit
FormEmailAddresses: 13 - FormEmailAddresses
FormCareCreditTransactions: 14 - FormCareCreditTransactions
FormCloudManagement: 15 - FormCloudUserManagement
FormWebForms: 16 - FormWebForms
FormModuleSetup: 17 - FormModuleSetup
FormEServicesAutoMsging: 18 - FormEServicesAutoMsging
FrmStatementSendSetup: 19 - FrmStatementSendSetup
FormAdvertisingMassEmailUpload: 20 - FormAdvertisingMassEmailUpload
7	FKey	bigint(20)	A FK to a table associated with the AlertType. 0 indicates not in use.
8	ItemValue	varchar(4000)	Like description, but more specific. When set use ActionType.ShowItemValue to show this variable within a MsgBoxCopyPaste window.
9	UserNum	bigint(20)	FK to userod.UserNum. Will only be shown to that specific user. 0 is all users.
10	SecDateTEntry	datetime	Date this row was added to the database. Not editable by the user

alertread
Order	Name	Type	Summary
0	AlertReadNum	bigint(20)	Primary key.
1	AlertItemNum	bigint(20)	FK to alertitem.AlertItemNum.
2	UserNum	bigint(20)	FK to userod.UserNum.

alertsub
Subscribes a user and optional clinic to specific alert types. Users will not get alerts unless they have an entry in this table.
Order	Name	Type	Summary
0	AlertSubNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be 0.
3	Type	tinyint(4)	Deprecated.
4	AlertCategoryNum	bigint(20)	FK to alertcategory.AlertCategoryNum.

allergy
An allergy attached to a patient and linked to an AllergyDef.
Order	Name	Type	Summary
0	AllergyNum	bigint(20)	Primary key.
1	AllergyDefNum	bigint(20)	FK to allergydef.AllergyDefNum
2	PatNum	bigint(20)	FK to patient.PatNum
3	Reaction	varchar(255)	Adverse reaction description. When importing from eForms, this is where the allergy name goes for "Other" when there's no match.
4	StatusIsActive	tinyint(4)	True if still an active allergy. False helps hide it from the list of active allergies.
5	DateTStamp	timestamp	To be used for synch with web server for CertTimelyAccess.
6	DateAdverseReaction	date	The historical date that the patient had the adverse reaction to this agent.
7	SnomedReaction	varchar(255)	Snomed code for reaction. Optional and independent of the Reaction text field. Not needed for reporting. Only used for CCD export/import.

allergydef
An allergy definition. Gets linked to an allergy and patient. Allergies will not show in CCD messages unless they have a valid Medication (that has an RxNorm) or UniiCode.
Order	Name	Type	Summary
0	AllergyDefNum	bigint(20)	Primary key.
1	Description	varchar(255)	Name of the drug. User can change this. If an RxCui is present, the RxNorm string can be pulled from the in-memory table for UI display in addition to the Description.
2	IsHidden	tinyint(4)	Because user can't delete.
3	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.
4	SnomedType	tinyint(4)	Enum:SnomedAllergy SNOMED Allergy Type Code. Only used to create CCD in FormSummaryOfCare.
None: 0-No SNOMED allergy type code has been assigned.
AllergyToSubstance: 1-Allergy to substance (disorder), code number 418038007.
DrugAllergy: 2-Drug allergy (disorder), code number 416098002.
DrugIntolerance: 3-Drug intolerance (disorder), code number 59037007.
FoodAllergy: 4-Food allergy (disorder), code number 414285001.
FoodIntolerance: 5-Food intolerance (disorder), code number 235719002.
AdverseReactions: 6-Propensity to adverse reactions (disorder), code number 420134006.
AdverseReactionsToDrug: 7-Propensity to adverse reactions to drug (disorder), code number 419511003
AdverseReactionsToFood: 8-Propensity to adverse reactions to food (disorder), code number 418471000.
AdverseReactionsToSubstance: 9-Propensity to adverse reactions to substance (disorder), code number 419199007.
5	MedicationNum	bigint(20)	FK to medication.MedicationNum. Optional, only used with CCD messages.
6	UniiCode	varchar(255)	The Unii code for the Allergen. Optional, but there must be either a MedicationNum or a UniiCode. Used to create CCD in FormSummaryOfCare, or set during CCD allergy reconcile.

apikey
Used to keep track of Customer's API Key and Developer's name. Just a copy from OD HQ for convenience.
Order	Name	Type	Summary
0	APIKeyNum	bigint(20)	Primary key.
1	CustApiKey	varchar(255)	Customer's API key.
2	DevName	varchar(255)	Developer's name, exactly as they entered it in FHIR developer portal.

apisubscription
A subscription by an API client that requests events to be fired for db changes or ui actions. Events are currently sent blindly. In the future, we could support acking for db events, but not very useful for ui events.
Order	Name	Type	Summary
0	ApiSubscriptionNum	bigint(20)	Primary key.
1	EndPointUrl	varchar(255)	This is the URL endpoint to which events will be sent.
2	Workstation	varchar(255)	Name of the workstation that will fire events. Blank if you want all workstations to fire events.
3	CustomerKey	varchar(255)	API Key the subscribing developer gave the customer. There can be multiple 3rd parties products for one database, each with their own key.
4	WatchTable	varchar(255)	Enum: EnumWatchTable, stored as string
5	PollingSeconds	int(11)	Frequency of database polling, in seconds.
6	UiEventType	varchar(255)	Enum: EnumApiUiEventType, stored as string.
7	DateTimeStart	datetime	When the subscription started. This gets updated each time db is polled so that it represents the start of the date range for the next polling.
8	DateTimeStop	datetime	When the subscription will expire. MinVal 01-01-0001 if no expiration.
9	Note	varchar(255)	.

appointment
Appointments can show in the Appointments module, or they can be on the unscheduled list. An appointment object is also used to store the Planned appointment. The planned appointment never gets scheduled, but instead gets copied. Also see histappointment, which keeps a historical record.
Order	Name	Type	Summary
0	AptNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. The patient that the appointment is for.
2	AptStatus	tinyint	Enum:ApptStatus .
None: 0- No appointment should ever have this status.
Scheduled: 1- Shows as a regularly scheduled appointment.
Complete: 2- Shows greyed out.
UnschedList: 3- Only shows on unscheduled list.
ASAP: 4- Deprecated in 17.4.1. Use Appointment.Priority instead.
Broken: 5- Shows with a big X on it.
Planned: 6- Planned appointment. Only shows in Chart module. User not allowed to change this status, and it does not display as one of the options.
PtNote: 7- Patient "post-it" note on the schedule. Shows light yellow. Shows on day scheduled just like appt, as well as in prog notes, etc.
PtNoteCompleted: 8- Patient "post-it" note completed
3	Pattern	varchar(255)	Time pattern, X for Dr time, / for assist time. Stored in 5 minute increments. Converted as needed to 10 or 15 minute representations for display. There's not a hard limit on this. When dragging, the max is 6.5 hours. Within the AptEdit window, it can be set to 9 hours.
4	Confirmed	bigint(20)	FK to definition.DefNum. This field can also be used to show patient arrived, in chair, etc. The Category column in the definition table is DefCat.ApptConfirmed.
5	TimeLocked	tinyint(1)	If true, then the program will not attempt to reset the user's time pattern and length when adding or removing procedures.
6	Op	bigint(20)	FK to operatory.OperatoryNum.
7	Note	text	Note.
8	ProvNum	bigint(20)	FK to provider.ProvNum.
9	ProvHyg	bigint(20)	FK to provider.ProvNum. Optional. Only used if a hygienist is assigned to this appt.
10	AptDateTime	datetime	Appointment Date and time. Use a datetime range instad of DATE(AptDateTime) or TIME(AptDateTime) in any query to avoid slowness.
11	NextAptNum	bigint(20)	FK to appointment.AptNum. A better description of this field would be PlannedAptNum. Only used to show that this apt is derived from specified planned apt. Otherwise, 0.
12	UnschedStatus	bigint(20)	FK to definition.DefNum. The definition.Category in the definition table is DefCat.RecallUnschedStatus. Only used if this is an Unsched or Planned appt.
13	IsNewPatient	tinyint	This is the first appoinment this patient has had at this office. Somewhat automated.
14	ProcDescript	text	A one line summary of all procedures. Can be used in various reports, Unscheduled list, and Planned appointment tracker. Not user editable right now, so it doesn't show on the screen.
15	Assistant	bigint(20)	FK to employee.EmployeeNum. You can assign an assistant to the appointment.
16	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if no clinic.
17	IsHygiene	tinyint	Set true if this is a hygiene appt. This flag is frequently not set even when it is a hygiene appointment because some offices want the dentist color on the appointments.
18	DateTStamp	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable.
19	DateTimeArrived	datetime	The date and time that the patient checked in.
20	DateTimeSeated	datetime	The date and time that the patient was seated in the chair in the operatory.
21	DateTimeDismissed	datetime	The date and time that the patient got up out of the chair. Date is largely ignored since it should be the same as the appt.
22	InsPlan1	bigint(20)	FK to insplan.PlanNum for the primary insurance plan at the time the appointment is set complete. May be 0. We can't tell later which subscriber is involved; only the plan.
23	InsPlan2	bigint(20)	FK to insplan.PlanNum for the secoondary insurance plan at the time the appointment is set complete. May be 0. We can't tell later which subscriber is involved; only the plan.
24	DateTimeAskedToArrive	datetime	Date and time patient asked to arrive, or minval if patient not asked to arrive at a different time than appt.
25	ProcsColored	text	Stores XML for the procs colors
26	ColorOverride	int(11)	If set to anything but 0, then this will override the graphic color for the appointment. Typically set to the color of the corresponding appointment type (if one is set) or a color manually picked by the user.
27	AppointmentTypeNum	bigint(20)	FK to appointmenttype.AppointmentTypeNum. Make sure to update ColorOverride to the corresponding color associated to this appointment type when changing the appointment type.
28	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
29	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
30	Priority	tinyint(4)	Enum:ApptPriority 0 for normal appointments, 1 for ASAP.
Normal: 0 - Default priority
ASAP: 1 - Used to identify items for the ASAP list
31	ProvBarText	varchar(60)	Text that is superimposed on the provbar at the left of each appointment. One character per 10 or 15 minute increment, not per 5 min.
32	PatternSecondary	varchar(255)	Time pattern, X for secondary provider time, / for spacing. Stored in 5 minute increments. Converted as needed to 10 or 15 minute representations for display. This could be Dr or Hyg, depending on if the IsHyg box is checked. Does not have any effect on appointment length. Probably same length as Pattern, but no guarantee.
33	SecurityHash	varchar(255)	Holds the salted hash of the following appointment fields: AptStatus, Confirmed, AptDateTime.
34	ItemOrderPlanned	int(11)	One-indexed order of patnum specific planned appointments. Column moved from the deprecated table plannedappt.
35	IsMirrored	tinyint(4)	If true, then this appointment will show a duplicate mirrored on the secondary provider's operatory. The length of the mirror will be based on the provider time set for the secondary provider, so it won't be the same size as the original. Default for new appointments is based on ApptMirrorSecondary. The mirrored appointments can be set to show/hide using ApptView.ShowMirroredAppts.

appointmentrule
For now, the rule is simple. It simply blocks all double booking of the specified code range. The double booking would have to be for the same provider. This can later be extended to provide more complex rules, such as partial double booking, time limitations, etc.
Order	Name	Type	Summary
0	AppointmentRuleNum	bigint(20)	Primary key.
1	RuleDesc	varchar(255)	The description of the rule which will be displayed to the user.
2	CodeStart	varchar(15)	The procedure code of the start of the range.
3	CodeEnd	varchar(15)	The procedure code of the end of the range.
4	IsEnabled	tinyint	Usually true. But this does allow you to turn off a rule temporarily without losing the settings.

appointmenttype
Appointment type is used to override appointment color. Might control other properties on appointments in the future.
Order	Name	Type	Summary
0	AppointmentTypeNum	bigint(20)	Primary key.
1	AppointmentTypeName	varchar(255)	
2	AppointmentTypeColor	int(11)	
3	ItemOrder	int(11)	0 based
4	IsHidden	tinyint(4)	
5	Pattern	varchar(255)	Time pattern, X for Dr time, / for assist time. Stored in 5 minute increments. Convert as needed to 10 or 15 minute representations for display. Will be blank if the pattern should be dynamically calculated via the procedures found in CodeStr.
6	CodeStr	varchar(4000)	Comma delimited list of procedure codes. E.g. T1234,T4321,N3214
7	CodeStrRequired	varchar(4000)	Comma delimited list of procedure codes that are required for this appt type. E.g. T1234,T4321,N3214.
8	RequiredProcCodesNeeded	tinyint(4)	Enum:EnumRequiredProcCodesNeeded 0=None,1=AtLeastOne,2=All
None: No ProcCodes from CodeStrRequired are needed to schedule appointments of this AppointmentType.
AtLeastOne: At least one ProcCode from CodeStrRequired is needed to schedule appointments of this AppointmentType.
All: All ProcCodes from CodeStrRequired are needed to schedule appointments of this AppointmentType.
9	BlockoutTypes	varchar(255)	Comma delimited list of Blockout Types (definition.DefNums where definition.Category=25) this appointment type can be associated to.

apptfield
These are custom fields added to appointments and managed by the user.
Order	Name	Type	Summary
0	ApptFieldNum	bigint(20)	Primary key.
1	AptNum	bigint(20)	FK to appointment.AptNum
2	FieldName	varchar(255)	FK to apptfielddef.FieldName. The full name is shown here for ease of use when running queries. But the user is only allowed to change fieldNames in the patFieldDef setup window.
3	FieldValue	text	Any text that the user types in. Will later allow some automation.

apptfielddef
These are the definitions for the custom patient fields added and managed by the user.
Order	Name	Type	Summary
0	ApptFieldDefNum	bigint(20)	Primary key.
1	FieldName	varchar(255)	The name of the field that the user will be allowed to fill in the appt edit window. Duplicates are prevented.
2	FieldType	tinyint(4)	Enum:ApptFieldType Text=0,PickList=1
Text: 0
PickList: 1
3	PickList	text	The text that contains pick list values, each separated by \r\n. Length 4000.
4	ItemOrder	int(11)	Zero based ordering for the items.

apptgeneralmessagesent
When a general message is sent for an appointment a record of that send is stored here. This is used to prevent re-sends of the same message.
Order	Name	Type	Summary
0	ApptGeneralMessageSentNum	bigint(20)	Primary key.
1	ApptNum	bigint(20)	If true then we need to consider the subject in an autocomm object
2	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
4	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
5	TSPrior	bigint(20)	This was the TSPrior used to send this reminder.
6	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
7	SendStatus	tinyint(4)	Indicates status of message.
8	ApptDateTime	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.
9	MessageType	tinyint(4)	
10	MessageFk	bigint(20)	FK to primary key of appropriate table.
11	DateTimeSent	datetime	DateTime the message was sent.
12	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.

apptnewpatthankyousent
When a reminder is sent for an appointment a record of that send is stored here. Only want to send new patient thank yous once per patient.
Order	Name	Type	Summary
0	ApptNewPatThankYouSentNum	bigint(20)	Primary key.
1	ApptNum	bigint(20)	Foreign key to the appointment represented by this AutoCommAppt.
2	ApptDateTime	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.
3	ApptSecDateTEntry	datetime	The Date and time of the original appointment.
4	TSPrior	bigint(20)	This was the TSPrior used to send this reminder.
5	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
6	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
7	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
8	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
9	DateTimeNewPatThankYouTransmit	datetime	Generated by OD. Timestamp when EConnector sent this ApptNewPatThankYouSent to HQ. Stored in local customer timezone.
10	ShortGUID	varchar(255)	Generated by HQ. Identifies this AutoCommGuid in future transactions between HQ and OD.
11	SendStatus	tinyint(4)	Indicates status of message.
12	MessageType	tinyint(4)	
13	MessageFk	bigint(20)	FK to primary key of appropriate table.
14	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
15	DateTimeSent	datetime	DateTime the message was sent.

apptreminderrule
This is called eServices Automated Messaging Rules in the UI. These are used to track the automated generation and sending of appointment reminders and confirmations. Users are allowed to define up to two reminders and one confirmation (per clinic). These can be sent out any number of Days, Hours, and/or Minutes before a scheduled appointment. PRACTICE - Appointment Reminder Rules will be saved and edited with clinicNum=0. This denotes the "Defaults" when using clinics, but for a practice the defaults become the practice rules.CLINICS - When using clinics, each clinic has a bool "IsConfirmEnabled" that determines if a particular clinic has automated reminders/confirmations enabled. If not, no reminders will be sent out for the clinic. If enabled, and no rules are defined for the clinic, then the clinic will attempt to use the defaults that have been defined with clinicNum==0. If a clinic is enabled and has at least one AppointmentReminderRule defined, then NO defaults will be used for that clinic.REMINDERS - reminders are sent out using the ApptComm system implemented by DerekG. These used to be stored as preferences for the practice only. Now users are allowed to define them on a per-clinic basis. Reminders should be considered one way communications and should not be desingned with a customer response in mind.CONFIRMATIONS - confirmations are sent using the new automated-confirmation system implemented by RyanM (proper) and SamO (web backend). Confirmations are intended to allow end patients to respond to OpenDental via text or email and automatically confirm, or set to a desired status, the appointments on the schedule.
Order	Name	Type	Summary
0	ApptReminderRuleNum	bigint(20)	Primary key.
1	TypeCur	tinyint(4)	Enum:ApptReminderType
Undefined: -1 - Used to define an Undefined ApptReminderType.
Reminder: 0 - Used to define the rules for when reminders should be sent out.
ConfirmationFutureDay: 1 - Defines rules for when confirmations should be sent out.
ReminderFutureDay: 2 - DEPRECATED. As of 17.4, all reminders have a status of Reminder.
PatientPortalInvite: 3 - Send emails to patients with their credentials to the Patient Portal.
ScheduleThankYou: 4 - Defines rules for when Schedule Verify ("Thank You"s) should be sent out.
Arrival: 5 - Defines rules for when Arrival instructions should be sent out.
Birthday: 6 - Birthday. Defines rule for sending out automated birthday emails.
GeneralMessage: 7 - General Message. Defines rules for sending out automated messages after an appointment is set complete. TSPrior will always be negative (occurs in future) for GeneralMessage. Allowing GM before appointment is prohibited since it would simply be duplicating eReminder behavior.
WebSchedRecall: 8 - WebSchedRecall. (Note, not yet used in db, but could be if we ever want clinic specific templates) Defines rules for sending out automated messages for Recalls.
NewPatientThankYou: 9 - NewPatientThankYou, Thank you for New Patient which is able to send with a new patient web form URL.
PayPortalMsgToPay: 10 - PaymentPortal Msg-To-Pay, used to send msg-to-pay messages to patients. Currently not an AutoComm feature but doing this now so functionality can be easier added in the future.
EClipboardWeb: 11 - EClipboard Web, used to send eClipboard web URLs to existing patients. No automation yet. Sent by right clicking on appt.
2	TSPrior	bigint(20)	Positive value indicates time BEFORE appointment that this rule should be sent. Negative value indicates time AFTER appointment that this rule should be sent. GeneralMessage: will always be negative (occurs in future). Allowing GM before appointment is prohibited since it would simply be duplicating eReminder behavior.
3	SendOrder	varchar(255)	Comma Delimited List of comm types. Enum values of ApptComm.CommType. 0=pref,1=sms,2=email; Like the deprecated pref "ApptReminderSendOrder"
4	IsSendAll	tinyint(4)	Set to True if both an email AND a text should be sent.
5	TemplateSMS	text	If using SMS, this template will be used to generate the body of the text message.
6	TemplateEmailSubject	text	If using email, this template will be used to generate the subject of the email.
7	TemplateEmail	text	If using email, this template will be used to generate the body of the email.
8	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Allows reminder rules to be configured on a per clinic basis. If ClinicNum==0 then it is the practice/HQ/default settings.
9	TemplateSMSAggShared	text	Used when aggregating multiple appointments together into a single message.
10	TemplateSMSAggPerAppt	text	Used when aggregating multiple appointments together into a single message.
11	TemplateEmailSubjAggShared	text	Used when aggregating multiple appointments together into a single message.
12	TemplateEmailAggShared	text	Used when aggregating multiple appointments together into a single message.
13	TemplateEmailAggPerAppt	text	Used when aggregating multiple appointments together into a single message.
14	DoNotSendWithin	bigint(20)	The time before the appointment in which this reminder should NOT be sent. E.g., if this value is 2 days, and an appt is created one day in the future, a reminder will not be sent.
15	IsEnabled	tinyint(4)	Enables/Disables the ApptReminderRule.
16	TemplateAutoReply	text	Used when auto replying single eConfirmations.
17	TemplateAutoReplyAgg	text	Used when auto replying multiple patient eConfirmations.
18	IsAutoReplyEnabled	tinyint(4)	Enables/Disables eConfirmation auto replies. Only for when the patient responds positively via text.
19	Language	varchar(255)	When set, matched by text against the patient's language. Typically eng (English), fra (French), spa (Spanish), or similar. If it's a custom language, then it might look like Tahitian. Empty string implies that this rule uses the default language of the practice.
20	TemplateComeInMessage	text	Used when inviting patient to come into office.
21	EmailTemplateType	varchar(255)	Enum. The Type of email for the template.
22	AggEmailTemplateType	varchar(255)	Enum:EmailType The type of email for the aggregated template.
Regular: 0 - This is a regular email that may contain our special wiki markup. Not converted to html.
Html: 1 - Html. Basic html email which uses the master template supplied by OD. Template includes header, styles, and the opening body tag. The user only needs to provide the body itself, which can inclcude tags that get automatically replaced.
RawHtml: 2 - More advanced html that does not include the master template. User must provide everything.
23	IsSendForMinorsBirthday	tinyint(4)	Boolean false by default. Controls if birthday messages will get sent to a minor for their birthday.
24	EmailHostingTemplateNum	bigint(20)	FK to emailhostingtemplate.EmailHostingTemplateNum. If used, rules fields will be based from the template.
25	MinorAge	int(11)	When IsSendForMinorsBirthday is true, this is the age that defines what a minor is.
26	TemplateFailureAutoReply	text	Used when auto replying to appointment confirmations that failed.
27	SendMultipleInvites	tinyint(4)	Enum:SendMultipleInvites . Whether we are able to send multiple invites.
UntilPatientVisitsPortal: 0 - Send a patient portal invite if the patient has not visited patient portal before.
EveryAppointment: 1 - Send a patient portal invite every appointment.
NoVisitInTimespan: 2 - Send a patient portal invite if the patient hasn't visited patient portal within TimeSpanMultipleInvites pref.
28	TimeSpanMultipleInvites	bigint(20)	Used in conjunction with CanSendMultipleInvites. We will not send an invite if a patient has visited Patient Portal within this timespan.

apptremindersent
When a reminder is sent for an appointment a record of that send is stored here. This is used to prevent re-sends of the same reminder.
Order	Name	Type	Summary
0	ApptReminderSentNum	bigint(20)	Primary key.
1	ApptNum	bigint(20)	Foreign key to the appointment represented by this AutoCommAppt.
2	ApptDateTime	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.
3	DateTimeSent	datetime	DateTime the message was sent.
4	TSPrior	bigint(20)	This was the TSPrior used to send this reminder.
5	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
6	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
7	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
8	SendStatus	tinyint(4)	Indicates status of message.
9	MessageType	tinyint(4)	
10	MessageFk	bigint(20)	FK to primary key of appropriate table.
11	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
12	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.

apptthankyousent
When a reminder is sent for an appointment a record of that send is stored here. This is used to prevent re-sends of the same Thank You.
Order	Name	Type	Summary
0	ApptThankYouSentNum	bigint(20)	Primary key.
1	ApptNum	bigint(20)	Foreign key to the appointment represented by this AutoCommAppt.
2	ApptDateTime	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.
3	ApptSecDateTEntry	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.
4	TSPrior	bigint(20)	This was the TSPrior used to send this reminder.
5	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
6	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
7	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
8	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
9	DateTimeThankYouTransmit	datetime	Generated by OD. Timestamp when EConnector sent this ApptThankYouSent to HQ. Stored in local customer timezone.
10	ShortGUID	varchar(255)	Generated by HQ. Identifies this AutoCommGuid in future transactions between HQ and OD.
11	SendStatus	tinyint(4)	Indicates status of message.
12	DoNotResend	tinyint(4)	Indicates that the ApptThankYouSent should not be resent if changes were made.
13	MessageType	tinyint(4)	
14	MessageFk	bigint(20)	FK to primary key of appropriate table.
15	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
16	DateTimeSent	datetime	DateTime the message was sent.

apptview
Enables viewing a variety of operatories or providers. This table holds the views that the user picks between. The apptviewitem table holds the items attached to each view.
Order	Name	Type	Summary
0	ApptViewNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of this view. Gets displayed in Appt module.
2	ItemOrder	smallint	0-based order to display in lists. This is unique per clinic. So this does allow duplicate numbers if they are in different clinics.
3	RowsPerIncr	tinyint	Number of rows per time increment. Usually 1 or 2. Programming note: Value updated to ApptDrawing.RowsPerIncr to track current state.
4	OnlyScheduledProvs	tinyint	If set to true, then the only operatories that will show will be for providers that have schedules for the day, ops with no provs assigned.
5	OnlySchedBeforeTime	time	If OnlyScheduledProvs is set to true, and this time is not 0:00, then only provider schedules with start or stop time before this time will be included.
6	OnlySchedAfterTime	time	If OnlyScheduledProvs is set to true, and this time is not 0:00, then only provider schedules with start or stop time after this time will be included.
7	StackBehavUR	tinyint(4)	Enum:ApptViewStackBehavior
Vertical:
Horizontal:
8	StackBehavLR	tinyint(4)	Enum:ApptViewStackBehavior
Vertical:
Horizontal:
9	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0=All clinics. This appointment view will only be visible when the current clinic showing is set to this clinic. Within the appointment edit window, this setting is used to filter the list of available operatories. Also used in conjunction with 'OnlyScheduledProvs' (when enabled) in order to filter the visible operatories within the Appt module.
10	ApptTimeScrollStart	time	Time the appointment module's view will scroll to on load.
11	IsScrollStartDynamic	tinyint(4)	If set to true, the appointment view scrolls to the first scheduled operatory start time or the first scheduled appointment.
12	IsApptBubblesDisabled	tinyint(4)	If set to true, the appointment view will not show appointment bubbles.
13	WidthOpMinimum	smallint	Zero is default and old behavior. For any larger number, appointments won't shrink past that number but they may be wider. Instead of getting narrower, a horizontal scrollbar shows up.
14	WaitingRmName	tinyint(4)	Enum:EnumWaitingRmName - Shows how patient name is displayed in the waiting room. Defaults to Last, First.
LastFirst: 0
FirstLastI: 1
First: 2
15	OnlyScheduledProvDays	tinyint(4)	If set to true, then the only days that will show in Week view will be days that have providers scheduled or an appointment scheduled.
16	ShowMirroredAppts	tinyint(4)	Default false. See Appointment.IsMirrored and Pref.ApptMirrorSecondary

apptviewitem
Each item is attached to a row in the apptview table. Each item specifies ONE of: OpNum, ProvNum, ElementDesc, ApptFieldDefNum, or PatFieldDefNum. The other 4 will be 0 or "".
Order	Name	Type	Summary
0	ApptViewItemNum	bigint(20)	Primary key.
1	ApptViewNum	bigint(20)	FK to apptview.
2	OpNum	bigint(20)	FK to operatory.OperatoryNum.
3	ProvNum	bigint(20)	FK to provider.ProvNum.
4	ElementDesc	varchar(255)	Must be one of the hard coded strings picked from the available list.
5	ElementOrder	tinyint	If this is a row Element, then this is the 0-based order within its area. For example, UR starts over with 0 ordering.
6	ElementColor	int(11)	If this is an element, then this is the color.
7	ElementAlignment	tinyint(4)	Enum:ApptViewAlignment If this is an element, then this is the alignment of the element within the appointment.
Main: 0
UR: 1
LR: 2
8	ApptFieldDefNum	bigint(20)	FK to apptfielddef.ApptFieldDefNum. If this is an element, and the element is an appt field, then this tells us which one.
9	PatFieldDefNum	bigint(20)	FK to patfielddef.PatFieldDefNum. If this is an element, and the element is an pat field, then this tells us which one.
10	IsMobile	tinyint(4)	Bool indicating if this ApptViewItem is for use in Mobile App appointment view

asapcomm
Used by the Web Sched ASAP feature to quickly send text messages to patients on the ASAP List about last minute appointment openings. In OD proper, in the ASAP list, a user can send a text message to a patient for either an existing ASAP appointment or a recall ASAP appointment. It contains a link that patient clicks on to schedule via WebSchedASAP. The entry first gets created in this table. Then, separately, the rows are consumed by a listener thread on the eConnector which handles the actual sending.
Order	Name	Type	Summary
0	AsapCommNum	bigint(20)	Primary key.
1	FKey	bigint(20)	FK to the object for which this communication was made. Usually AptNum or RecallNum.
2	FKeyType	tinyint(4)	Enum:AsapCommFKeyType The type of object for which this communication was made.
None: 0 - Should not be present in database.
ScheduledAppt: 1 - A scheduled appointment marked ASAP.
UnscheduledAppt: 2 - An unscheduled appointment marked ASAP.
PlannedAppt: 3 - A planned appointment marked ASAP.
Recall: 4 - A recall marked ASAP
Broken: 5 - A broken appointment marked ASAP
3	ScheduleNum	bigint(20)	FK to schedule.ScheduleNum. The block on the schedule for which this communication was made.
4	PatNum	bigint(20)	FK to patient.PatNum.
5	ClinicNum	bigint(20)	FK to clinic.ClinicNum. The clinic that is sending this AsapComm.
6	ShortGUID	varchar(255)	An identifier that is used to communicate with OD HQ regarding this communication item.
7	DateTimeEntry	datetime	When this communication item was entered into the database.
8	DateTimeExpire	datetime	When this communication item will expire.
9	DateTimeSmsScheduled	datetime	The date and time when a text message is scheduled to be sent.
10	SmsSendStatus	tinyint(4)	Enum:AutoCommStatus The status of sending the text for this communication.
Undefined: 0 - Should not be in the database but can be used in the program.
DoNotSend: 1 - Do not send a reminder.
SendNotAttempted: 2 - We will send, but send has not been attempted yet.
SendSuccessful: 3 - Has been sent successfully.
SendFailed: 4 - Attempted to send but not successful.
SentAwaitingReceipt: 5 - Has been sent successfully, awaiting receipt.
11	EmailSendStatus	tinyint(4)	Enum:AutoCommStatus The status of sending the email for this communication.
Undefined: 0 - Should not be in the database but can be used in the program.
DoNotSend: 1 - Do not send a reminder.
SendNotAttempted: 2 - We will send, but send has not been attempted yet.
SendSuccessful: 3 - Has been sent successfully.
SendFailed: 4 - Attempted to send but not successful.
SentAwaitingReceipt: 5 - Has been sent successfully, awaiting receipt.
12	DateTimeSmsSent	datetime	The date and time a text message was sent.
13	DateTimeEmailSent	datetime	The date and time an email was sent.
14	EmailMessageNum	bigint(20)	FK to emailmessage.EmailMessageNum. The email message that was sent to the patient.
15	ResponseStatus	tinyint(4)	Enum:AsapRSVPStatus How the patient has responded to this communication.
UnableToSend: 0 - Neither text nor email was permitted to be sent.
AwaitingTransmit: 1 - EConnector will pickup and send to HQ and change to pendingRsvp.
PendingRsvp: 2 - EConnector has sent this to HQ and will remain in this status until it is either terminated or receives a response from the patient.
Viewed: 3 - The patient viewed the portal and took no action.
ViewedNotAvailable: 4 - The patient viewed the portal but the slot was no longer available.
AcceptedAndMoved: 5 - The patient accepted the appointment and the appointment was successfully moved.
AcceptedAndNotAvailable: 6 - The patient accepted the appointment but the appointment was not successfully moved.
Declined: 7 - The patient declined any open slots.
ChoseDifferentSlot: 8 - The patient declined this slot but chose a different time slot.
Expired: 9 - Patient took no action by the time DateTimeExpired passed and the message was terminated.
Failed: 10 - HQ or EConnector was unable to send the message so it was terminated prematurely.
DeclinedStopComm: 11 - The patient declined and requested that we do not continue contacting them for this appointment.
16	DateTimeOrig	datetime	The date and time of the appointment when this communication was made or the date and time of the recall date due.
17	TemplateText	text	The template that will be used when sending a text message.
18	TemplateEmail	text	The template that will be used when creating the body of the email message.
19	TemplateEmailSubj	varchar(100)	The template that will be used for the email subject line.
20	Note	text	Any notes regarding this communication item.
21	GuidMessageToMobile	text	FK to smstomobile.GuidMessage. Generated at HQ when the SMS is generated.
22	EmailTemplateType	varchar(255)	Enum:EmailType Type of markup for the template.
Regular: 0 - This is a regular email that may contain our special wiki markup. Not converted to html.
Html: 1 - Html. Basic html email which uses the master template supplied by OD. Template includes header, styles, and the opening body tag. The user only needs to provide the body itself, which can inclcude tags that get automatically replaced.
RawHtml: 2 - More advanced html that does not include the master template. User must provide everything.
23	UserNum	bigint(20)	FK to userod.UserNum. The user that is sending this AsapComm. Will be 0 if unknown.

autocode
An autocode automates entering procedures. The user only has to pick composite, for instance, and the autocode figures out the code based on the number of surfaces, and posterior vs. anterior. Autocodes also enforce and suggest changes to a procedure code if the number of surfaces or other properties change.
Order	Name	Type	Summary
0	AutoCodeNum	bigint(20)	Primary key.
1	Description	varchar(255)	Displays meaningful decription, like "Amalgam".
2	IsHidden	tinyint	User can hide autocodes
3	LessIntrusive	tinyint	This will be true if user no longer wants to see this autocode message when closing a procedure. This makes it less intrusive, but it can still be used in procedure buttons.

autocodecond
AutoCode condition. Always attached to an AutoCodeItem, which is then, in turn, attached to an autocode. There is usually only one or two conditions for a given AutoCodeItem.
Order	Name	Type	Summary
0	AutoCodeCondNum	bigint(20)	Primary key.
1	AutoCodeItemNum	bigint(20)	FK to autocodeitem.AutoCodeItemNum.
2	Cond	tinyint	Enum:AutoCondition
Anterior: 0
Posterior: 1
Premolar: 2
Molar: 3
One_Surf: 4
Two_Surf: 5
Three_Surf: 6
Four_Surf: 7
Five_Surf: 8
First: 9
EachAdditional: 10
Maxillary: 11
Mandibular: 12
Primary: 13
Permanent: 14
Pontic: 15
Retainer: 16
AgeOver18: 17

autocodeitem
Corresponds to the autocodeitem table in the database. There are multiple AutoCodeItems for a given AutoCode. Each Item has one ADA code.
Order	Name	Type	Summary
0	AutoCodeItemNum	bigint(20)	Primary key.
1	AutoCodeNum	bigint(20)	FK to autocode.AutoCodeNum
2	OldCode	varchar(15)	Do not use
3	CodeNum	bigint(20)	FK to procedurecode.CodeNum

autocommexcludedate
AutoComms are sent a certain number of days in advance. Clinicpref called eConfirmExcludeDays handles excluding weekends, and this table handles excluding holidays. So AutoComms only go out when office is open. (First iteration currently only applies to eConfirmations)
Order	Name	Type	Summary
0	AutoCommExcludeDateNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	ClinicNum this row applies to. 0 for HQ
2	DateExclude	datetime	

automation
A trigger event causes one or more actions.
Order	Name	Type	Summary
0	AutomationNum	bigint(20)	Primary key.
1	Description	text	.
2	Autotrigger	tinyint(4)	Enum:EnumAutomationTrigger What triggers this automation
ProcedureComplete: 0
ApptBreak: 1
ApptNewPatCreate: 2
PatientOpen: 3. Regardless of module. Usually only used with conditions.
ApptCreate: 4
ProcSchedule: 5. Attaching a procedure to a scheduled appointment.
BillingTypeSet: 6
RxCreate: 7
ClaimCreate: 8
ClaimOpen: 9
ApptComplete: 10
3	ProcCodes	text	If this has a CompleteProcedure trigger, this is a comma-delimited list of codes that will trigger the action.
4	AutoAction	tinyint(4)	Enum:AutomationAction The action taken as a result of the trigger. To get more than one action, create multiple automation entries.
PrintPatientLetter:
CreateCommlog:
PrintReferralLetter: If a referral does not exist for this patient, then notify user instead.
ShowExamSheet:
PopUp:
SetApptASAP:
ShowConsentForm:
SetApptType:
PopUpThenDisable10Min: Similar to PopUp, but will only show once per WS per 10 minutes.
PatRestrictApptSchedTrue: When triggered, automatically restricts patient from being scheduled. See also PatRestriction.cs
PatRestrictApptSchedFalse: When triggered, automatically removes patient from scheduling restriction. See also PatRestriction.cs
PrintRxInstruction: When triggered, it will automatically print a copy of the Patient Rx Instructions
ChangePatStatus: When triggered, automatically set a patient's status to the status type in the PatStatus column. Delete should never be used.
5	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum. If the action is to print a sheet, then this tells which sheet to print. So it must be a custom sheet. Also, not that this organization does not allow passing parameters to the sheet such as which procedures were completed, or which appt was broken.
6	CommType	bigint(20)	FK to definition.DefNum. Only used if action is CreateCommlog.
7	MessageContent	text	If a commlog action, then this is the text that goes in the commlog. If this is a ShowStatementNoteBold action, then this is the NoteBold. Might later be expanded to work with email or to use variables.
8	AptStatus	tinyint(4)	Enum:ApptStatus . This column is not used anymore.
None: 0- No appointment should ever have this status.
Scheduled: 1- Shows as a regularly scheduled appointment.
Complete: 2- Shows greyed out.
UnschedList: 3- Only shows on unscheduled list.
ASAP: 4- Deprecated in 17.4.1. Use Appointment.Priority instead.
Broken: 5- Shows with a big X on it.
Planned: 6- Planned appointment. Only shows in Chart module. User not allowed to change this status, and it does not display as one of the options.
PtNote: 7- Patient "post-it" note on the schedule. Shows light yellow. Shows on day scheduled just like appt, as well as in prog notes, etc.
PtNoteCompleted: 8- Patient "post-it" note completed
9	AppointmentTypeNum	bigint(20)	FK to appointmenttype.AppointmentTypeNum.
10	PatStatus	tinyint(4)	Enum:PatientStatus - used to determine which status to change to for ChangePatientStatus automation actions. Should never be 'Deleted'
Patient: 0
NonPatient: 1
Inactive: 2
Archived: 3 - This status is also used for a merged patient that you're not keeping.
Deleted: 4
Deceased: 5
Prospective: 6- Not an actual patient yet.

automationcondition
Each condition evaluates to true or false. A series of conditions for a single automation is ANDed together.
Order	Name	Type	Summary
0	AutomationConditionNum	bigint(20)	Primary key.
1	AutomationNum	bigint(20)	FK to automation.AutomationNum.
2	CompareField	tinyint(4)	Enum:AutoCondField
NeedsSheet: Typically specify Equals the exact name/description of the sheet.
Problem: disease
Medication:
Allergy:
Age: Example, 23
Gender: Allowed values are M or F, not case sensitive. Enforce at entry time.
Labresult:
InsuranceNotEffective:
BillingType:
IsProcRequired:
IsControlled:
IsPatientInstructionPresent:
PlanNum:
ClaimContainsProcCode:
3	Comparison	tinyint(4)	Enum:AutoCondComparison Not all comparisons are allowed with all data types.
Equals: Not sensitive to capitalization.
GreaterThan:
LessThan:
Contains: aka Like
None: Should not be displayed to users to choose from. Used when the condition has one and only one 'comparison' to trigger it. E.g. ins not effective.
4	CompareString	varchar(255)	.

autonote
A single autonote template.
Order	Name	Type	Summary
0	AutoNoteNum	bigint(20)	Primary key
1	AutoNoteName	varchar(50)	Name of AutoNote
2	MainText	text	Was 'ControlsToInc' in previous versions.
3	Category	bigint(20)	FK to definition.DefNum. This is the AutoNoteCat definition category (DefCat=41), for categorizing autonotes. Uncategorized autonotes will be set to 0.

autonotecontrol
In the program, this is now called an autonote prompt.
Order	Name	Type	Summary
0	AutoNoteControlNum	bigint(20)	Primary key
1	Descript	varchar(50)	The description of the prompt as it will be referred to from other windows.
2	ControlType	varchar(50)	'Text', 'OneResponse', or 'MultiResponse'. More types to be added later.
3	ControlLabel	varchar(255)	The prompt text.
4	ControlOptions	text	For TextBox, this is the default text. For a ComboBox, this is the list of possible responses, one per line.

benefit
Corresponds to the benefit table in the database which replaces the old covpat table. A benefit is usually a percentage, deductible, limitation, max, or similar. Each row represents a single benefit. A benefit can have a value in EITHER PlanNum OR PatPlanNum. If it is for a PlanNum, the most common, then the benefit is attached to an insurance plan. If it is for a PatPlanNum, then it overrides the plan benefit, usually a percentage, for a single patient. Benefits we can't handle yet include posterior composites, COB duplication, amounts used, in/out of plan network, authorization required, missing tooth exclusion, and any date related limitations like waiting periods.Here are examples of typical usage which parallel X12 usage.Example fields shown in this order:CovCat, ProcCode(- indicates blank), BenefitType, Percent, MonetaryAmt, TimePeriod, QuantityQualifier, Quantity, CoverageLevelAnnual Max Indiv $1000: None/General,-,Limitations,-1,1000,CalendarYear,None,0,IndividualRestorative 80%: Restorative,-,CoInsurance,80,-1,CalendarYear,None,0,None$50 deductible: None/General,-,Deductible,-1,50,CalendarYear,None,0,IndividualDeductible waived on preventive: Preventive,-,Deductible,-1,0,CalendarYear,None,0,Individual1 pano every 5 years: None,D0330,Limitations,-1,-1,Years?,Years,5,None2 exams per year: Preventive(or Diagnostic),-,Limitations,-1,-1,BenefitYear,NumberOfServices,2,NoneFluoride limit 18yo: None, D1204, Limitations, -1, -1, CalendarYear/None, AgeLimit, 18,None (might require a second identical entry for D1205)4BW every 6 months: None, D0274, Limitations, -1, -1, None, Months, 6,None.The text above might be difficult to read. We are trying to improve the white spacing.
Order	Name	Type	Summary
0	BenefitNum	bigint(20)	Primary key.
1	PlanNum	bigint(20)	FK to insplan.PlanNum. Most benefits should be attached using PlanNum. The exception would be if each patient has a different percentage. If PlanNum is used, then PatPlanNum should be 0.
2	PatPlanNum	bigint(20)	FK to patplan.PatPlanNum. It is rare to attach benefits this way. Usually only used to override percentages for patients. In this case, PlanNum should be 0.
3	CovCatNum	bigint(20)	FK to covcat.CovCatNum. Corresponds to X12 EB03- Service Type code. Situational, so it can be 0. Will probably be 0 for general deductible and annual max. There are very specific categories covered by X12. Users should set their InsCovCats to the defaults we provide.
4	BenefitType	tinyint	Enum:InsBenefitType Corresponds to X12 EB01. Examples: 0=ActiveCoverage, 1=CoInsurance, 2=Deductible, 3=CoPayment, 4=Exclusions, 5=Limitations. ActiveCoverage doesn't really provide meaningful information.
ActiveCoverage: 0- Informational only. Not usually used. Would only be used if you are just indicating that the patient is covered, but without any specifics.
CoInsurance: 1- Used for percentages to indicate portion that insurance will cover. When interpreting electronic benefit information, this is the opposite percentage, the percentage that the patient will pay after deductible.
Deductible: 2- The deductible amount. Might be two entries if, for instance, deductible is waived on preventive.
CoPayment: 3- Informational only. A dollar amount.
Exclusions: 4- Services that are simply not covered at all.
Limitations: 5- Covers a variety of limitations, including Max, frequency, fee reductions, etc.
WaitingPeriod: 6- Sets a period of time after the effective date where a benefit will not be used.
5	Percent	tinyint(4)	Only used if BenefitType=CoInsurance. Valid values are 0 to 100. -1 indicates empty, which is almost always true if not CoInsurance. The percentage that insurance will pay on the procedure. Note that benefits coming from carriers are usually backwards, indicating the percentage that the patient is responsible for.
6	MonetaryAmt	double	Used for CoPayment, Limitations, and Deductible. -1 indicates empty
7	TimePeriod	tinyint	Enum:BenefitTimePeriod Corresponds to X12 EB06, Time Period Qualifier. Examples: 0=None,1=ServiceYear,2=CalendarYear,3=Lifetime,4=Years. Might add Visit and Remaining.
None: 0- A timeperiod is frequenly not needed. For example, percentages.
ServiceYear: 1- The renewal month is not Jan. In this case, we need to know the effective date so that we know which month the benefits start over in.
CalendarYear: 2- Renewal month is Jan.
Lifetime: 3- Usually used for ortho max.
Years: 4- Wouldn't be used alone. Years would again be specified in the quantity field along with a number.
NumberInLast12Months: 5- # in last 12 months. Does not care about when benefit year begins. Looks at previous 12 months.
8	QuantityQualifier	tinyint	Enum:BenefitQuantity Corresponds to X12 EB09. Not used very much. Examples: 0=None,1=NumberOfServices,2=AgeLimit,3=Visits,4=Years,5=Months
None: 0- This is used a lot. Most benefits do not need any sort of quantity.
NumberOfServices: 1- For example, two exams per year
AgeLimit: 2- For example, 18 when fluoride only covered to 18 y.o.
Visits: 3- For example, copay per 1 visit.
Years: 4- For example, pano every 5 years.
Months: 5- For example, BWs every 6 months.
9	Quantity	tinyint	Corresponds to X12 EB10. Qualify the quantity using QuantityQualifier.
10	CodeNum	bigint(20)	FK to procedurecode.CodeNum. Typical uses include fluoride, sealants, etc. If a specific code is used here, then the CovCat should be None.
11	CoverageLevel	int(11)	Enum:BenefitCoverageLevel Corresponds to X12 EB02. None, Individual, or Family. Individual and Family are commonly used for deductibles and maximums. None is commonly used for percentages and copays.
None: 0- Since this is a situational X12 field, we can also have none. Typical for percentages and copayments.
Individual: 1- The default for deductibles and maximums.
Family: 2- For example, family deductible or family maximum.
12	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
13	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed.
14	CodeGroupNum	bigint(20)	FK to codegroup.CodeGroupNum The group of procedure codes that apply to this frequency limitation benefit.
15	TreatArea	tinyint(4)	Enum:TreatmentArea . Only for frequency limitations, ignored for all other benefits. Enforced by the UI. Example 3 fillings per year [mouth]. Example: on any particular tooth, one crown every 5 years. Tests: 140 through 147. 0 means default.
None: 0-goes on claims as blank.
Surf: 1
Tooth: 2
Mouth: 3-goes on claims as 00.
Quad: 4
Sextant: 5
Arch: 6
ToothRange: 7
16	ToothRange	varchar(255)	Single tooth numbers separated by commas. When displayed to user, it can contain hyphens and commas. Example: "2,15" or "1" or "23-26,7-10". Used for age limitations. Example: D7140 extraction on "AS,BS,CS,DS" allowed 0 to 7yrs old. Also used for exclusions. Example: D2740 porcelain crown is not covered on #2 and 15.

branding
Replaces MobileBrandingProfile. Stores clinic level customizations to the way eServices are displayed to users (colors, logos, etc). Colors use the MaterialColorUtilities package which implements Google's Material Color Utilities for C#. Material Color is a system for generating a theme of color variations based on a single source color. Changes made to the primary, secondary, or tertiary colors on the theme will cause the other colors to change slightly as well. This table is stored in the dental office database, not at OD HQ.
Order	Name	Type	Summary
0	BrandingNum	bigint(20)	Primary key.
1	BrandingType	tinyint(4)	Enum:EnumBrandingType
None: 0: No branding should have this type.
LogoFilePath: 1: Path to the logo file. Only used for eClipboard. eConnector will fetch this file. Same path for every computer, so maybe use a network shared file. Shows as 90x90 pixels.
MaterialColorPalette: 2: JSON serialized light and dark Schemes for a Material Color palette as well as the source color. Colors will be represented as either their respective RGB values (255,255,255) or simply the name of the color (White). Users are only able to edit the primary, secondary, and tertiary colors of a Scheme.
OfficeDescription: 3: The Clinic Name that will be shown on eClipboard CheckIn
2	ClinicNum	bigint(20)	FK to clinic. 0 indicates a global default Branding.
3	ValueString	text	Stores the value for the branding type. Colors will be stored as JSON Serialized SchemesAndSource, which will hold both light and dark Schemes as well as the source color. Example serialized Scheme: {"Primary": "109, 94, 15","OnPrimary": "White","PrimaryContainer": "248, 226, 135", etc for the 39 generated colors}
4	DateTimeUpdated	datetime	The last time this row was updated. Some eServices store relevant rows locally, and will only need to update when this exceeds their locally stored values. Saves calls to database.

canadiannetwork
Not user-editable.
Order	Name	Type	Summary
0	CanadianNetworkNum	bigint(20)	Primary key.
1	Abbrev	varchar(20)	This will also be the folder name
2	Descript	varchar(255)	.
3	CanadianTransactionPrefix	varchar(255)	A01. Up to 12 char.
4	CanadianIsRprHandler	tinyint(4)	Set to true if this network is in charge of handling all Request for Payment Reconciliation (RPR) transactions for all carriers within this network, as opposed to the individual carriers wihtin the network processing the RPR transactions themselves.

carecreditwebresponse
This table will never delete records, only upsert. CareCreditResponseWeb rows are records of all CareCredit made.
Order	Name	Type	Summary
0	CareCreditWebResponseNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	PayNum	bigint(20)	FK to payment.PayNum.
3	RefNumber	varchar(255)	The RefNumber associated to this request.
4	Amount	double	The amount of the request. This can be purchases or refund amount.
5	WebToken	varchar(255)	New: The sessionId is returned from the prefill response that we use to send the user to the portal. Old: The web token used for pullback request.
6	ProcessingStatus	varchar(255)	Enum:CareCreditWebStatus Used to determine if the request is pending, needs action, or is completed.
Created: 0.
CreatedError: 1.
Pending: 2.
PendingError: 3.
Expired: 4.
Completed: 5.
PreApproved: 6.
Cancelled: 7.
Declined: 8.
CallForAuth: 9.
DupQS: 10.
AccountFound: 11.
Unknown: 12.
BatchError: 13.
UnknownError: 14.
ErrorAcknowledged: 15.
ExpiredBatch: 16.
AccountNotFoundQS: 17.
7	DateTimeEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual datetime of entry.
8	DateTimePending	datetime	DateTime that the request went to a pending status.
9	DateTimeCompleted	datetime	DateTime that the request went to a completed status.
10	DateTimeExpired	datetime	DateTime that the request expired.
11	DateTimeLastError	datetime	DateTime of the last time the request had an error.
12	LastResponseStr	text	Raw JSON response (or error) from CareCredit.
13	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
14	ServiceType	varchar(255)	Enum:CareCreditServiceType Used to determine what service was requested for this web response.
Batch: 0.
Prefill: 1.
IndividualQS: 2.
15	TransType	varchar(255)	Enum:CareCreditTransType Used to determine the transaction type.
None: 0.
Purchase: 1.
Refund: 2.
16	MerchantNumber	varchar(20)	The MerchantNumber associated to this request.
17	HasLogged	tinyint(4)	True if row has been logged at HQ, otherwise false.

carrier
Every InsPlan has a Carrier. The carrier stores the name and address.
Order	Name	Type	Summary
0	CarrierNum	bigint(20)	Primary key.
1	CarrierName	varchar(255)	Name of the carrier.
2	Address	varchar(255)	.
3	Address2	varchar(255)	Second line of address.
4	City	varchar(255)	.
5	State	varchar(255)	2 char in the US.
6	Zip	varchar(255)	Postal code.
7	Phone	varchar(255)	Includes any punctuation.
8	ElectID	varchar(255)	E-claims electronic payer id. 5 char in USA. 6 digits in Canada. I've seen an ID this long before: "LA-DHH-MEDICAID". The user interface currently limits length to 20, although db limits length to 255. X12 requires length between 2 and 80.
9	NoSendElect	tinyint	Enum:NoSendElectType 0 - send electronically, 1 - don't send electronically, 2 - don't send non-primary (secondary,tertiary, etc.) claims electronically.
SendElect: 0 - Sending electronically is allowed for this carrier.
NoSendElect: 1 - Do not send electronically for this carrier.
NoSendSecondaryElect: 2 - Do not send electronically for this carrier if the carrier is not the primary insurance for the patient.
10	IsCDA	tinyint	Canada: True if a CDAnet carrier. This has significant implications: 1. It can be filtered for in the list of carriers. 2. An ElectID is required. 3. The ElectID can never be used by another carrier. 4. If the carrier is attached to any etrans, then the ElectID cannot be changed (and, of course, the carrier cannot be deleted or combined).
11	CDAnetVersion	varchar(100)	The version of CDAnet supported. Either 02 or 04.
12	CanadianNetworkNum	bigint(20)	FK to canadiannetwork.CanadianNetworkNum. Only used in Canada. Right now, there is no UI to the canadiannetwork table in our db.
13	IsHidden	tinyint(4)	.
14	CanadianEncryptionMethod	tinyint(4)	1=No Encryption, 2=CDAnet standard #1, 3=CDAnet standard #2. Field A10. Deprecated for all Canadian carriers. Will always be 1 (No Encryption).
15	CanadianSupportedTypes	int(11)	Bit flags.
16	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
17	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
18	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
19	TIN	varchar(255)	Tax ID Number. Not user editable. No UI for this field. Used in when importing insurance plans from 834s to uniquely identify carriers.
20	CarrierGroupName	bigint(20)	FK to definition.DefNum. Links carriers into groups for queries.
21	ApptTextBackColor	int(11)	Color that the carrier is highlighted within the appointment module appointment and popup bubble. 0 represents empty no color.
22	IsCoinsuranceInverted	tinyint(4)	False by default. Determines if the carrier supplied EB08 field of 271 transactions should be inverted for coinsurance percentages. When true carriers sent us insurance percentage so we do not need to invert it, it is already inverted for us.
23	TrustedEtransFlags	tinyint(4)	Enum:TrustedEtransTypes Bit flags. None (0) by default. Stores trusted user selected X12 transaction types related to this carrier.
None: 0 - Default, no trusted types.
RealTimeEligibility: 1 - When used in bit-wise value enables the automated import of certain fields for 271s, otherwise disabled.
24	CobInsPaidBehaviorOverride	tinyint(4)	Enum:EclaimCobInsPaidBehavior When sending X12 5010 eclaims, if not set to Default, then this setting overrides the ClaimCobInsPaidBehavior preference.
Default: Use the global preference value instead of the carrier override.
ClaimLevel: Only send COB eclaim data claim totals.
ProcedureLevel: Only send COD eclaim data respective procedure amounts.
Both: Send COB eclaim data claim totals and respective procedure amounts.
25	EraAutomationOverride	tinyint(4)	Enum:EraAutomationMode UseGlobal (0) by default. Determines the level of ERA processing automation for this carrier. This will override the EraAutomationBehavior preference when not set to UseGlobal.
UseGlobal: 0 - Never used for the EraAutomationBehavior preference. Only used for Carrier.EraAutomationOverride to indicate that the carrier uses the EraAutomationBehavior preference instead of an override.
ReviewAll: 1 - ERAs are manually processed.
SemiAutomatic: 2 - Allows ERAs to be processed with a single button click.
FullyAutomatic: 3 - When ERAs are imported, they are fully processed without any input from a user.
26	OrthoInsPayConsolidate	tinyint(4)	Enum:EnumOrthoInsPayConsolidate Global (0) by default. Determines how this carrier requires payments made to ortho claims made by the Auto Ortho Tool. This will override the OrthoInsPayConsolidated preference when not set to Global.
Global: Uses the preference value of OrthoInsPayConsolidated.
ForceConsolidateOn: Overrides the preference value of OrthoInsPayConsolidated and blocks users from entering payments on claims created by the Auto Ortho Tool.
ForceConsolidateOff: Overrides the preference value of OrthoInsPayConsolidated and allows users to enter payments on claims created by the Auto Ortho Tool.
27	PaySuiteTransSup	tinyint(4)	Enum:EnumPaySuiteTransTypes (0) None by default. Indicates which PaySuite transaction types a Canadian carrier supports.
None: 0
ExtendedReversal: 1 - Carrier supports PaySuite Extend Reversals which are reversals made more than 24 hours after sending the claim.
PlanDetails: 2 - Carrier supports PaySuite Plan Details requests which return plan/benefit details.
Both: 3 - Carrier supports both Extended Reversals and Plan Details Requests.

cdcrec
CDC Race and Ethnicity. About 200 rows.
Order	Name	Type	Summary
0	CdcrecNum	bigint(20)	Primary key.
1	CdcrecCode	varchar(255)	CDCREC Code. Example: 1002-5. Not allowed to edit this column once saved in the database.
2	HeirarchicalCode	varchar(255)	Heirarchical Code. Example: R1 =="American Indian or alaska Native"R1.01 =="American Indian"R1.01.001=="Abenaki"Not allowed to edit this column once saved in the database.
3	Description	varchar(255)	Description.

cdspermission
User to specify user level permissions used for CDS interventions. Unlike normal permissions and security, each permission has its own column and each employee has their own row.
Order	Name	Type	Summary
0	CDSPermissionNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	SetupCDS	tinyint(4)	True if allowed to edit EHR Triggers.
3	ShowCDS	tinyint(4)	True if user should see EHR triggers that are enabled. If false, no CDS interventions will show.
4	ShowInfobutton	tinyint(4)	True if user can see Infobutton.
5	EditBibliography	tinyint(4)	True if user can edit to bibliographic information.
6	ProblemCDS	tinyint(4)	True to enable Problem based CDS interventions for this user.
7	MedicationCDS	tinyint(4)	True to enable Medication based CDS interventions for this user.
8	AllergyCDS	tinyint(4)	True to enable Allergy based CDS interventions for this user.
9	DemographicCDS	tinyint(4)	True to enable Demographic based CDS interventions for this user.
10	LabTestCDS	tinyint(4)	True to enable Lab Test based CDS interventions for this user.
11	VitalCDS	tinyint(4)	True to enable Vital Sign based CDS interventions for this user.

centralconnection
Used by the Central Manager. Stores the information needed to establish a connection to a remote database.
Order	Name	Type	Summary
0	CentralConnectionNum	bigint(20)	Primary key.
1	ServerName	varchar(255)	If direct db connection. Can be ip address.
2	DatabaseName	varchar(255)	If direct db connection.
3	MySqlUser	varchar(255)	If direct db connection.
4	MySqlPassword	varchar(255)	If direct db connection. Symmetrically encrypted.
5	ServiceURI	varchar(255)	If connecting to the web service. Can be on VPN, or can be over https.
6	OdUser	varchar(255)	Deprecated. If connecting to the web service.
7	OdPassword	varchar(255)	Deprecated. If connecting to the web service. Symmetrically encrypted.
8	Note	text	When being used by ConnectionStore xml file, must deserialize to a ConnectionNames enum value. Otherwise just used as a generic notes field.
9	ItemOrder	int(11)	0-based.
10	WebServiceIsEcw	tinyint(4)	If set to true, the password hash is calculated differently.
11	ConnectionStatus	varchar(255)	Contains the most recent information about this connection. OK if no problems, version information if version mismatch, nothing for not checked, and OFFLINE if previously couldn't connect.
12	HasClinicBreakdownReports	tinyint(4)	If set to True, display clinic breakdown in reports, else only show practice totals.

cert
A single certification that any employee may complete.
Order	Name	Type	Summary
0	CertNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	WikiPageLink	varchar(255)	The exact name of a wiki page.
3	ItemOrder	int(11)	0-indexed. This is a little tricky because a cert can be in multiple categories. So users can only reorder when they are looking at the entire list of certs not ordered by category.
4	IsHidden	tinyint(4)	If hidden, then this cert won't normally show in the main list.
5	CertCategoryNum	bigint(20)	FK to definition.DefNum.

certemployee
A certification completed by an employee on a specific date.
Order	Name	Type	Summary
0	CertEmployeeNum	bigint(20)	Primary key.
1	CertNum	bigint(20)	FK to cert.CertNum.
2	EmployeeNum	bigint(20)	FK to employee.EmployeeNum.
3	DateCompleted	date	
4	Note	varchar(255)	Rarely, a very short note is required.
5	UserNum	bigint(20)	FK to userod.UserNum. The user who made this entry. Usually some sort of supervisor.

chartview
Enables viewing a variety of views in chart module.
Order	Name	Type	Summary
0	ChartViewNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of this view. Gets displayed at top of Progress Notes grid.
2	ItemOrder	int(11)	0-based order to display in lists.
3	ProcStatuses	tinyint(4)	Enum:ChartViewProcStat None=0,TP=1,Complete=2,Existing Cur Prov=4,Existing Other Prov=8,Referred=16,Deleted=32,Condition=64,All=127.
None: 0- None.
TP: 1- Treatment Plan.
C: 2- Complete.
EC: 4- Existing Current Provider.
EO: 8- Existing Other Provider.
R: 16- Referred Out.
D: 32- Deleted.
Cn: 64- Condition.
All: 127- All.
4	ObjectTypes	smallint(6)	Enum:ChartViewObjs None=0,Appointments=1,Comm Log=2,Comm Log Family=4,Tasks=8,Email=16,LabCases=32,Rx=64,Sheets=128,Comm Log Super Family=256,All=511.
None: 0- None
Appointments: 1- Appointments
CommLog: 2- Comm Log
CommLogFamily: 4- Comm Log Family
Tasks: 8- Tasks
Email: 16- Email
LabCases: 32- Lab Cases
Rx: 64- Rx
Sheets: 128- Sheets
CommLogSuperFamily: 256- Comm Log Super Family
All: 511- All
5	ShowProcNotes	tinyint(4)	Set true to show procedure notes.
6	IsAudit	tinyint(4)	Set true to enable audit mode.
7	SelectedTeethOnly	tinyint(4)	Set true to only show information regarding the selected teeth.
8	OrionStatusFlags	int(11)	Enum:OrionStatus Which orion statuses to show. Will be zero if not orion.
None: 0- None. While a normal orion proc would never have this status2, it is still needed for flags in ChartViews. And it's also possible that a status2 slipped through the cracks and was not assigned, leaving it with this value.
TP: 1– Treatment planned
C: 2– Completed
E: 4– Existing prior to incarceration
R: 8– Refused treatment
RO: 16– Referred out to specialist
CS: 32– Completed by specialist
CR: 64– Completed by registry
CA_Tx: 128- Cancelled, tx plan changed
CA_EPRD: 256- Cancelled, eligible parole
CA_PD: 512- Cancelled, parole/discharge
S: 1024– Suspended, unacceptable plaque
ST: 2048- Stop clock, multi visit
W: 4096– Watch
A: 8192– Alternative
9	DatesShowing	tinyint(4)	Enum:ChartViewDates All,Today,Yesterday,ThisYear,LastYear
All: 0- All
Today: 1- Today
Yesterday: 2- Yesterday
ThisYear: 3- This Year
LastYear: 4- Last Year
10	IsTpCharting	tinyint(4)	set true to show treatment plan controls in chart module.

chat
A single chat object can contain any number of users. The users attached to a chat can change over time as users are removed or added. A chat can be named. It can contain any number of chatMessages. Visibility of messages to a user is based on whether they are currently attached. The chat feature works out of the box for all normal OD customers. It runs as a separate .exe so that it can run even when the main OD program has a dialog open or is shut down for update. Every workstation that's using chat will poll the database about every 5 seconds. This might cause slowness in larger offices, so they will want to use one or more of the following advanced features: You can set up a read-only slave database in OD, and the chat will automatically use it for frequent read operations. If you want to use the mobile app, you will need to download and install a windows service to sit between the db and all mobile users. We might install this windows service by default for all users just in case, but at least the exe will be in the normal OD folder. If you want to use a dedicated db for chat, that's a manual process that involves moving those 6 tables to their own db with no other tables in it, and then setting the prefs ChatServer... from in the prefs window.
Order	Name	Type	Summary
0	ChatNum	bigint(20)	Primary key.
1	Name	varchar(255)	

chatattach
An image or file attached to a chat message. Always stored entirely in db to avoid file permission issues and to allow mobile use. To support massive scalability, the plan is to eventually support a dedicated db for chat if a larger office desires.
Order	Name	Type	Summary
0	ChatAttachNum	bigint(20)	Primary key.
1	ChatMsgNum	bigint(20)	FK to chatmsg.ChatMsgNum.
2	FileName	varchar(255)	Any filename plus extension. It will show to the user in some cases like a pdf. Doesn't need to be unique, so many might just be Image.png.
3	Thumbnail	mediumblob	This is a pretty big thumbnail, but much smaller than the FileData. Max 150 pixels width or height. Same proportions as original image. Stored as png. Not always present. For example a PDF would not have a thumbnail.
4	FileData	mediumblob	mediumblob can hold up to 16,777,215 bytes. Stored as png. User gets an error message if they try to attach bigger. This doesn't get downloaded from db unless user manually clicks to open a file or image.

chatmsg
An individual message on a chat.
Order	Name	Type	Summary
0	ChatMsgNum	bigint(20)	Primary key.
1	ChatNum	bigint(20)	FK to chat.ChatNum.
2	UserNum	bigint(20)	FK to userod.UserNum. The author of this msg
3	DateTimeSent	datetime	The DateTime this message was added to the Db. Uses server time.
4	Message	text	If the EventType is None, this is a standard XAML FlowDocument with bold, etc. Emojis are in runs as plain text tokens like :thumbsup:. For User Added/Removed messages, this is plain text that is displayed without formatting.
5	SeqCount	bigint(20)	See SequenceCounter.cs table for information on how this is used. More accurate than using a datetime cutoff for getting new messages.
6	Quote	bigint(20)	FK to chatmsg.ChatMsgNum. A reference to this quote will show above this message. You can click on it to go to the original.
7	EventType	tinyint(4)	Some messages aren't messages, but are instead event notifications. This tells us which kind of event. This is on the ChatMsg table so that the clients can just pull from this single table every 5 seconds and also simultaneously be notified about other events. Most event types are always deleted when a new row of that type supercedes it, because we only care about the most recent. UsersChanged events are different. They have messages that are shown to the user in the stack of msgs for a chat, so they don't get deleted. Also see ChatUserAttach.DateTimeRemoved which is related but used for completely different purposes.
8	IsImportant	tinyint(4)	

chatreaction
A single reaction to a chat msg.
Order	Name	Type	Summary
0	ChatReactionNum	bigint(20)	Primary key.
1	ChatMsgNum	bigint(20)	FK to chatmsg.ChatMsgNum.
2	UserNum	bigint(20)	FK to userod.UserNum. The author of this reaction.
3	EmojiName	varchar(255)	One from the list of 192 that we use. Example: "Angry face with horns". Colons are not used here.

chatuserattach
Attaches a user to a chat. When the user leaves the chat, this object gets deleted. Also keeps track of whether that user has any new messages.
Order	Name	Type	Summary
0	ChatUserAttachNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum. User being attached to the chat.
2	ChatNum	bigint(20)	FK to chat.ChatNum. Chat to attach user to.
3	IsRead	tinyint(4)	True if the user has read the most recent message in the chat. If false, it will show bold in their list. Each time a msg is added, all these flags for the chat get set to false. No need to do anything if adding a user to a chat becaue it's already false.
4	DateTimeRemoved	datetime	Also see chatmsg.EventType UsersChanged which is for displaying to users. This field is closely related but used for a different purpose. This is used when getting a list of chats because we need to not consider msgs after this date for sorting purposes. This chat will still show for the user, but will fall gradually into the past instead of popping to the top again. It's also used to suppress showing any recent msgs in the list of msgs for a chat. It also prevents any new msg notifications and makes the user not show as part of the group.
5	IsMute	tinyint(4)	

chatuserod
Status and options for a user. Name is pulled from Userod table. A new ChatUserod will be created the first time it's needed if it doesn't already exist.
Order	Name	Type	Summary
0	ChatUserodNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum. One one row per user
2	UserStatus	tinyint(4)	Enum:EnumUserStatus Available, Away, DoNotDisturb. If the user is linked to an Employee in OD, then this status will mirror the clocked in status. If there is no linkage, then it's based on whether PC gets locked from inactivity
3	DateTimeStatusReset	datetime	User can manually change status for a duration. That duration is translated into this reset time for when the status gets reset automatically.
4	Photo	text	Any photo. The import process resamples it to 100 pixels high with proportional width to the original. The crop is stored separately in PhotoCrop. Text, so max length=65k base64.
5	PhotoCrop	varchar(255)	This is a composite of 3 numbers that determine the size and position of the circle crop. Diameter of the circle is in pixels. X,Y is the position of the center of the circle within the Photo. Format is "D,X,Y". The numbers are all double, rounded to 1/10th of a pixel. Example: 70,60.1,47.3
6	OpenBackground	tinyint(4)	If true, when auto starting, the main window will not open. Instead, just the tray icon will show. This does not apply to manually starting.
7	CloseKeepRunning	tinyint(4)	If true, when closing, the main window will close, but the tray icon will continue to show.
8	MuteNotifications	tinyint(4)	If true, no regular notifications will pop up.
9	DismissNotifySecs	int(11)	The number of seconds for a regular popup to show before it goes away on its own. If 0, it will show a default of 5 seconds. Max 2_147_483_647 seconds, which is int max.
10	MuteImportantNotifications	tinyint(4)	If true, important notifications will be treated the same as normal notifications. This would be unusual and this would normally be false.
11	DismissImportantNotifySecs	int(11)	The number of seconds for an important popup to show before it goes away on its own. If 0, it will show a default of 99,999, a little over a day. Max 2_147_483_647 seconds, which is int max.

claim
The claim table holds information about individual claims. Each row represents one claim.
Order	Name	Type	Summary
0	ClaimNum	bigint(20)	Primary key
1	PatNum	bigint(20)	FK to patient.PatNum. Must always match claimProc.PatNum
2	DateService	date	Usually the same date as the procedures, but it can be changed if you wish.
3	DateSent	date	Usually the date it was created. It might be sent a few days later if you don't send your e-claims every day.
4	ClaimStatus	char(1)	Single char: U,H,W,P,S,R, or I. U=Unsent, H=Hold until pri received, W=Waiting in queue, S=Sent, R=Received, I=Hold for In Process. A(adj) is no longer used. P(prob sent) is no longer used.
5	DateReceived	date	Date the claim was received.
6	PlanNum	bigint(20)	FK to insplan.PlanNum. Every claim is attached to one plan.
7	ProvTreat	bigint(20)	FK to provider.ProvNum. Treating provider for dental claims. For institutional claims, this is called the attending provider.
8	ClaimFee	double	Total fee of claim.
9	InsPayEst	double	Amount insurance is estimated to pay on this claim.
10	InsPayAmt	double	Amount insurance actually paid.
11	DedApplied	double	Deductible applied to this claim.
12	PreAuthString	varchar(40)	The predetermination of benefits number received from ins. In X12, REF G3.
13	IsProsthesis	char(1)	Single char for No, Initial, or Replacement.
14	PriorDate	date	Date prior prosthesis was placed. Note that this is only for paper claims. E-claims have a date field on each individual procedure.
15	ReasonUnderPaid	varchar(255)	Note for patient for why insurance didn't pay as expected.
16	ClaimNote	varchar(400)	Note to be sent to insurance. Max 400 char. E-claims also have notes on each procedure.
17	ClaimType	varchar(255)	"P"=primary, "S"=secondary, "PreAuth"=preauth, "Other"=other, "Cap"=capitation. Not allowed to be blank. Might need to add "Med"=medical claim.
18	ProvBill	bigint(20)	FK to provider.ProvNum. Billing provider. Assignment can be automated from the setup section.
19	ReferringProv	bigint(20)	FK to referral.ReferralNum.
20	RefNumString	varchar(40)	Referral number for this claim.
21	PlaceService	tinyint	Enum:PlaceOfService .
Office: 0. Code 11
PatientsHome: 1. Code 12
InpatHospital: 2. Code 21
OutpatHospital: 3. Code 22
SkilledNursFac: 4. Code 31
CustodialCareFacility: 5. Code 33. In X12, a similar code AdultLivCareFac 35 is mentioned.
OtherLocation: 6. Code 99. We use 11 for office.
MobileUnit: 7. Code 15
School: 8. Code 03
MilitaryTreatFac: 9. Code 26
FederalHealthCenter: 10. Code 50
PublicHealthClinic: 11. Code 71
RuralHealthClinic: 12. Code 72
EmergencyRoomHospital: 13. Code 23
AmbulatorySurgicalCenter: 14. Code 24
TelehealthOutsideHome: 15. Code 02.
TelehealthInHome: 16. Code 10
OutreachSiteOrStreet: 17. Code 27
22	AccidentRelated	char(1)	blank or A=Auto, E=Employment, O=Other.
23	AccidentDate	date	Date of accident, if applicable. Canada only.
24	AccidentST	varchar(2)	Accident state.
25	EmployRelated	tinyint	Enum:YN .
Unknown: 0
Yes: 1
No: 2
26	IsOrtho	tinyint	True if is ortho.
27	OrthoRemainM	tinyint	Remaining months of ortho. Valid values are 1-36, although we allow greater than or equal to 0.
28	OrthoDate	date	Date ortho appliance placed.
29	PatRelat	tinyint	Enum:Relat Relationship to subscriber. The relationship is copied from InsPlan when the claim is created. It might need to be changed in both places.
Self: 0
Spouse: 1
Child: 2
Employee: 3
HandicapDep: 4
SignifOther: 5
InjuredPlaintiff: 6
LifePartner: 7
Dependent: 8
30	PlanNum2	bigint(20)	FK to insplan.PlanNum. Other coverage plan number. 0 if none. This provides the user with total control over what other coverage shows. This obviously limits the coverage on a single claim to two insurance companies.
31	PatRelat2	tinyint	Enum:Relat The relationship to the subscriber for other coverage on this claim.
Self: 0
Spouse: 1
Child: 2
Employee: 3
HandicapDep: 4
SignifOther: 5
InjuredPlaintiff: 6
LifePartner: 7
Dependent: 8
32	WriteOff	double	Sum of ClaimProc.Writeoff for this claim.
33	Radiographs	tinyint	The number of x-rays enclosed.
34	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if no clinic. Since one claim cannot have procs from multiple clinics, the clinicNum is set when creating the claim and then cannot be changed. The claim would have to be deleted and recreated. Otherwise, if changing at the claim level, a feature would have to be added that synched all procs, claimprocs, and probably some other tables.
35	ClaimForm	bigint(20)	FK to claimform.ClaimFormNum. 0 if not assigned to use the claimform for the insplan.
36	AttachedImages	int(11)	The number of intraoral images attached. Not the number of files attached. This is the value that goes on the 2006 claimform.
37	AttachedModels	int(11)	The number of models attached.
38	AttachedFlags	varchar(255)	A comma-delimited set of flag keywords. Can have one or more of the following: EoB,Note,Perio,Misc,Unsup. Must also contain one of these: Mail or Elect. Additionally, the Submitted flag is for determining when DentalXChange attachment was submitted.
39	AttachmentID	varchar(255)	Example: NEA#1234567 or dxc123456789. If present, and if the claim note does not already start with this Id, then it will be prepended to the claim note for both e-claims and mail. If using e-claims, this same ID will be used for all PWK segements.
40	CanadianMaterialsForwarded	varchar(10)	A08. Any combination of E(email), C(correspondence), M(models), X(x-rays), and I(images). So up to 5 char. Gets converted to a single char A-Z for e-claims.
41	CanadianReferralProviderNum	varchar(20)	B05. Optional. The 9-digit CDA number of the referring provider, or identifier of referring party up to 10 characters in length.
42	CanadianReferralReason	tinyint(4)	B06. A number 0(none) through 13.
43	CanadianIsInitialLower	varchar(5)	F18. Y, N, or X(not a lower denture, crown, or bridge).
44	CanadianDateInitialLower	date	F19. Mandatory if F18 is N.
45	CanadianMandProsthMaterial	tinyint(4)	F21. If crown, not required. If denture or bridge, required if F18 is N. Single digit number code, 0-6. We added type 7, which is crown.
46	CanadianIsInitialUpper	varchar(5)	F15. Y, N, or X(not an upper denture, crown, or bridge).
47	CanadianDateInitialUpper	date	F04. Mandatory if F15 is N.
48	CanadianMaxProsthMaterial	tinyint(4)	F20. If crown, not required. If denture or bridge, required if F15 is N. 0 indicates empty response. Single digit number code, 1-6. We added type 7, which is crown.
49	InsSubNum	bigint(20)	FK to inssub.InsSubNum.
50	InsSubNum2	bigint(20)	FK to inssub.InsSubNum. The fk to the 'Other' insurance subscriber. For a primary claim, this will be the secondary insurance subscriber. For a secondary claim, this will be primary insurance subscriber.
51	CanadaTransRefNum	varchar(255)	G01 assigned by carrier/network and returned in acks. Used for claim reversal. For Claim Acknowledgements, this can sometimes be a series of spaces, which means the number is effectively empty. This happens when the Claim Acknowledgement is forwarded to the carrier as part of a batch.
52	CanadaEstTreatStartDate	date	F37 Used for predeterminations.
53	CanadaInitialPayment	double	F28 Used for predeterminations.
54	CanadaPaymentMode	tinyint	F29 Used for predeterminations.
55	CanadaTreatDuration	tinyint	F30 Used for predeterminations.
56	CanadaNumAnticipatedPayments	tinyint	F31 Used for predeterminations.
57	CanadaAnticipatedPayAmount	double	F32 Used for predeterminations.
58	PriorAuthorizationNumber	varchar(255)	This is NOT the predetermination of benefits number. In X12, this is REF G1.
59	SpecialProgramCode	tinyint(4)	Enum:EnumClaimSpecialProgram This is used to track EPSDT.
none:
EPSDT_1:
Handicapped_2:
SpecialFederal_3:
Disability_5:
SecondOpinion_9:
60	UniformBillType	varchar(255)	A three digit number used on 837I. Aka Bill Code. UBO4 4. Examples: 321,823,131,652. The third digit is claim frequency code. If this is used, then our CorrectionType should be 0=original.
61	MedType	tinyint(4)	Enum:EnumClaimMedType 0=Dental, 1=Medical, 2=Institutional
Dental: 0
Medical: 1
Institutional: 2
62	AdmissionTypeCode	varchar(255)	Used for inst claims. Single digit. X12 2300 CL101. UB04 14. Should only be required for IP, but X12 clearly states required for all.
63	AdmissionSourceCode	varchar(255)	Used for inst claims. Single char. X12 2300 CL102. UB04 15. Should only be required for IP, but X12 clearly states required for all.
64	PatientStatusCode	varchar(255)	Used for inst claims. Two digit. X12 2300 CL103. UB04 17. Should only be required for IP, but X12 clearly states required for all.
65	CustomTracking	bigint(20)	FK to definition.DefNum. Most users will leave this blank. Some offices may set up tracking statuses such as 'review', 'hold', 'riskmanage', etc.
66	DateResent	date	Used for historical purposes only, not sent electronically. Automatically set when CorrectionType is original and the claim is resent.
67	CorrectionType	tinyint(4)	Enum:ClaimCorrectionType X12 CLM05-3. Usually set to original, but can be used to resubmit claims. Also used in 1500 Medical Claim Form field 22.
Original: 0 - X12 1. Use for claims that are not ongoing.
Replacement: 1 - X12 7. Use to entirely replace an original claim. A claim reference number will be required.
Void: 2 - X12 8. Use to undo an original claim. A claim reference number will be required.
68	ClaimIdentifier	varchar(255)	X12 CLM01. Semi-unique identifier for the claim within the current database. Defaults to PatNum/ClaimNum, but can be edited by user, and is often modified by the clearinghouse to ensure uniqueness on their end. This also set for PreAuth claims. The ClaimIdentifier for a PreAuth will probably not match the ClaimIdentifier for a regular claim, which makes ERA claim matching more straight forward for both PreAuths and regular claims.
69	OrigRefNum	varchar(255)	X12 2300 REF (F8). Used when resending claims to refer to the original claim. The user must type this value in after reading it from the original claim response report.
70	ProvOrderOverride	bigint(20)	FK to provider.ProvNum. Ordering provider override. Goes hand-in-hand with OrderingReferralNum. Medical eclaims only. Defaults to zero.
71	OrthoTotalM	tinyint	Total estimated months of ortho. Valid values are 1-36, although we allow greater than or equal to 0.
72	ShareOfCost	double	Sum of all amounts paid specifically to this claim by the patient or family. Goes out in X12 4010/5010 loop 2300 AMT segment if greater than zero. Default value is 0, thus will not go out by default unless the user enters a value. This field was added for Denti-Cal certification, but can go out for any clearinghouse.
73	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
74	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
75	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
76	OrderingReferralNum	bigint(20)	FK to referral.ReferralNum. Goes hand-in-hand with ProvOrderOverride. Medical eclaims only. Defaults to zero. If set, and the ProvOrderOverride is not set, then this referral will go out at the ordering provider on medical e-claims.
77	DateSentOrig	date	The original date the claim was sent.
78	DateIllnessInjuryPreg	date	Date of Current Illness, Injury, or Pregnancy (LMP). (LMP = Last Menstrual Period) For use in 1500 Medical Claim Form box 14. Identifies the first date of onset of illness, the actual date of injury, or the LMP for pregnancy.
79	DateIllnessInjuryPregQualifier	smallint(6)	Enum:DateIllnessInjuryPregQualifier 3 digit code used in 1500 Medical Claim Form, 'Qual' box of field 14. Valid values are 431 or 484.
None: 0 - None
OnsetCurSymptoms: 431 - Onset of Current Symptoms or Illness
LastMenstrualPeriod: 484 - Last Menstrual Period
80	DateOther	date	Another date related to the patient's condition or treatment. For use in 1500 Medical Claim Form box 15.
81	DateOtherQualifier	smallint(6)	Enum:DateOtherQualifier 3 digit code used in 1500 Medical Claim Form, 'Qual' box of field 15. Valid values are 090, 091, 304, 439, 444, 453,454, 455, and 471.
None: 0 - None
ReportStart: 090 - Report Start
ReportEnd: 091 - Report End
LatestVisitConsult: 304 - Latest Visit or Consultation
Accident: 439 - Accident
FirstVisitConsult: 444 - First Visit or Consultation
ChronicCondManifest: 453 - Acute Manifestation of a Chronic Condition
InitialTreatment: 454 - Initial Treatment
LastXray: 455 - Last X-ray
Prescription: 471 - Prescription
82	IsOutsideLab	tinyint(4)	Used in 1500 Medical Claim Form field 20. Place an 'X' the 'Yes' if true and the 'No' if false.
83	SecurityHash	varchar(255)	Holds the salted hash of the following claim fields: ClaimFee, ClaimStatus, InsPayEst, InsPayAmt.
84	Narrative	text	A note that pertains to all attachments on the claim. Currently only applies to DentalXChange, but could be expanded. 2000 character limit put in place by DentalXChange.

claimattach
Keeps track of one image file attached to a claim. Multiple files can be attached to a claim using this method. DentalXChange uses the term "attachment" differently, referring to a group of images.
Order	Name	Type	Summary
0	ClaimAttachNum	bigint(20)	Primary key.
1	ClaimNum	bigint(20)	FK to claim.ClaimNum
2	DisplayedFileName	varchar(255)	The name of the file that shows on the claim. For example: tooth2.jpg.
3	ActualFileName	varchar(255)	The actual file is stored in the A-Z folder in EmailAttachments. (yes, even though it's not actually an email attachment) The files are named automatically based on Date/time along with a random number. This ensures that they will be sequential as well as unique.
4	ImageReferenceId	int(11)	This is the image Id that DentalXChange gives back after calling addImage(). Storing this will allow users to delete images they sent to DentalXChange.

claimcondcodelog
There is either one or zero per claim.
Order	Name	Type	Summary
0	ClaimCondCodeLogNum	bigint(20)	Primary key.
1	ClaimNum	bigint(20)	FK to claim.ClaimNum.
2	Code0	varchar(2)	Corresponds with condition code 18 on the UB04.
3	Code1	varchar(2)	Corresponds with condition code 19 on the UB04.
4	Code2	varchar(2)	Corresponds with condition code 20 on the UB04.
5	Code3	varchar(2)	Corresponds with condition code 21 on the UB04.
6	Code4	varchar(2)	Corresponds with condition code 22 on the UB04.
7	Code5	varchar(2)	Corresponds with condition code 23 on the UB04.
8	Code6	varchar(2)	Corresponds with condition code 24 on the UB04.
9	Code7	varchar(2)	Corresponds with condition code 25 on the UB04.
10	Code8	varchar(2)	Corresponds with condition code 26 on the UB04.
11	Code9	varchar(2)	Corresponds with condition code 27 on the UB04.
12	Code10	varchar(2)	Corresponds with condition code 28 on the UB04.

claimform
Stores the information for printing different types of claim forms. Each claimform has many claimformitems attached to it, one for each field on the claimform. This table has nothing to do with the actual claims. It just describes how to print them.
Order	Name	Type	Summary
0	ClaimFormNum	bigint(20)	Primary key.
1	Description	varchar(50)	eg. ADA2002 or CA Medicaid
2	IsHidden	tinyint	If true, then it will not be displayed in various claim form lists as a choice.
3	FontName	varchar(255)	Valid font name for all text on the form.
4	FontSize	float	Font size for all text on the form.
5	UniqueID	varchar(255)	Deprecated as of version 17.2. Internal claimforms have been moved over to XML files in OpenDentBusiness.Properties.Resources.
6	PrintImages	tinyint	Set to false to not print images. This removes the background for printing on premade forms.
7	OffsetX	smallint(5)	Shifts all items by x/100th's of an inch to compensate for printer, typically less than 1/4 inch.
8	OffsetY	smallint(5)	Shifts all items by y/100th's of an inch to compensate for printer, typically less than 1/4 inch.
9	Width	int(11)	The width of the claim form.
10	Height	int(11)	The height of the claim form.

claimformitem
One item is needed for each field on a claimform.
Order	Name	Type	Summary
0	ClaimFormItemNum	bigint(20)	Primary key.
1	ClaimFormNum	bigint(20)	FK to claimform.ClaimFormNum
2	ImageFileName	varchar(255)	If this item is an image. Usually only one per claimform. eg ADA2002.emf. Otherwise it MUST be left blank, or it will trigger an error that the image cannot be found.
3	FieldName	varchar(255)	Must be one of the hardcoded available fieldnames for claims.
4	FormatString	varchar(255)	For dates, the format string. ie MM/dd/yyyy or M d y among many other possibilities.
5	XPos	float	The x position of the item on the claim form. In pixels. 100 pixels per inch.
6	YPos	float	The y position of the item.
7	Width	float	Limits the printable area of the item. Set to zero to not limit.
8	Height	float	Limits the printable area of the item. Set to zero to not limit.

claimpayment
Each row represents a single check from the insurance company. The amount may be split between patients using claimprocs. The amount of the check must always exactly equal the sum of all the claimprocs attached to it. There might be only one claimproc.
Order	Name	Type	Summary
0	ClaimPaymentNum	bigint(20)	Primary key.
1	CheckDate	date	Date the check was entered into this system, not the date on the check.
2	CheckAmt	double	The amount of the check.
3	CheckNum	varchar(25)	The check number.
4	BankBranch	varchar(25)	Bank and branch.
5	Note	varchar(255)	Note for this check if needed.
6	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if no clinic (unassigned).
7	DepositNum	bigint(20)	FK to deposit.DepositNum. 0 if not attached to any deposits.
8	CarrierName	varchar(255)	Descriptive name of the carrier just for reporting purposes. We use this because the CarrierNums could conceivably be different for the different claimprocs attached.
9	DateIssued	date	Date that the carrier issued the check. Date on the check.
10	IsPartial	tinyint(4)	.
11	PayType	bigint(20)	FK to definition.DefNum. 0 if not attached to any definitions
12	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
13	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
14	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
15	PayGroup	bigint(20)	FK to definition.DefNum. The payment group for this claim payment.

claimproc
Links procedures to claims. Also links ins payments to procedures or claims. Also used for estimating procedures even if no claim yet. Warning: One proc might be linked twice to a given claim if insurance made two payments. Many of the important fields are actually optional. For instance, ProcNum is only required if itemizing ins payment, and ClaimNum is blank if Status=adjustment,cap,or estimate.
Order	Name	Type	Summary
0	ClaimProcNum	bigint(20)	Primary key.
1	ProcNum	bigint(20)	FK to procedurelog.ProcNum. Is 0 for payments by total or for Canadian Carrier Issued Procedures.
2	ClaimNum	bigint(20)	FK to claim.ClaimNum. Is 0 for estimates, adjustments and capitation (CapClaim and CapComplete).
3	PatNum	bigint(20)	FK to patient.PatNum. Must always match claim.PatNum
4	ProvNum	bigint(20)	FK to provider.ProvNum.
5	FeeBilled	double	Fee billed to insurance. Might not be the same as the actual fee. The fee billed can be different than the actual procedure. For instance, if you have set the insurance plan to bill insurance using UCR fees, then this field will contain the UCR fee instead of the fee that the patient was charged.
6	InsPayEst	double	Actual amount this carrier is expected to pay, after taking everything else into account. Considers annual max, override, percentAmt, copayAmt, deductible, etc. This estimate is computed automatically when sent to ins.
7	DedApplied	double	0 if blank. Deductible applied to this procedure only. Only for procedures attached to claims. Otherwise, the DedEst and DedEstOverride are used.
8	Status	tinyint	Enum:ClaimProcStatus . When setting recieved\supplemental must set DateEntry.
NotReceived: 0: For claims that have been created or sent, but have not been received.
Received: 1: For claims that have been received.
Preauth: 2: For preauthorizations.
Adjustment: 3: The only place that this status is used is to make adjustments to benefits from the coverage window. It is never attached to a claim.
Supplemental: 4:This differs from Received only slightly. It's for additional payments on procedures already received. Most fields are blank.
CapClaim: 5: CapClaim is used when you want to send a claim to a capitation insurance company. These are similar to Supplemental in that there will always be a duplicate claimproc for a procedure. The first claimproc tracks the copay and writeoff, has a status of CapComplete, and is never attached to a claim. The second claimproc has status of CapClaim.
Estimate: 6: Estimates have replaced the fields that were in the procedure table. Once a procedure is complete, the claimprocstatus will still be Estimate. An Estimate can be attached to a claim and status gets changed to NotReceived.
CapComplete: 7: For capitation procedures that are complete. This replaces the old procedurelog.CapCoPay field. This stores the copay and writeoff amounts. The copay is only there for reference, while it is the writeoff that actually affects the balance. Never attached to a claim. If procedure is TP, then status will be CapEstimate. Only set to CapComplete if procedure is Complete.
CapEstimate: 8: For capitation procedures that are still estimates rather than complete. When procedure is completed, this can be changed to CapComplete, but never to anything else.
InsHist: 9: For InsHist procedures. Corresponds to Existing Other (EO) procs.
9	InsPayAmt	double	Amount insurance actually paid.
10	Remarks	varchar(255)	The remarks that insurance sends in the EOB about procedures.
11	ClaimPaymentNum	bigint(20)	FK to claimpayment.ClaimPaymentNum(the insurance check).
12	PlanNum	bigint(20)	FK to insplan.PlanNum
13	DateCP	date	This is the date that is used for payment reports and tracks the payment date. Once a payment has been attached, the DateCP will exactly match the date of the ClaimPayment it's attached to. See the note under Ledgers.ComputePayments. This will eventually not be used for aging. The ProcDate will instead be used. See ProcDate.
14	WriteOff	double	Amount not covered by ins which is written off. The writeoff estimate goes in a different column. This is filled with the WriteOffEst value when a claim is created.
15	CodeSent	varchar(15)	The procedure code that was sent to insurance. This is not necessarily the usual procedure code. It will already have been trimmed to 5 char if it started with "D", or it could be the alternate code. Not allowed to be blank if it is procedure.
16	AllowedOverride	double	The allowed fee (not the override) is a complex calculation which is performed on the fly in Procedure.ComputeEstimates/ClaimProc.ComputeBaseEst. It is the amount that the percentage is based on. If this carrier has a lower UCR than the standard fee for the office, then the allowed fee is where that is handled. It can be pulled from an allowed fee schedule. It is also where substitutions for posterior composites are handled. The AllowedOverride allows the user to override the calculation. -1 indicates blank. A new use of this field is for when entering insurance payments. On the eob, it will tell you what the allowed/UCR fee is. The user will now be able to enter this information into the AllowedOverride field. They will simultaneously pass the info to the allowed fee schedule. AllowedOverride is never changed automatically by the program except to sometimes set it to -1 if NoBillIns.
17	Percentage	tinyint(4)	-1 if blank. Otherwise a number between 0 and 100. The percentage that insurance pays on this procedure, as determined from insurance categories. Not user editable.
18	PercentOverride	tinyint(4)	-1 if blank. Otherwise a number between 0 and 100. Can only be changed by user.
19	CopayAmt	double	-1 if blank or uninitialized, but otherwise should be 0 or positive. Calculated automatically. User cannot edit but can use CopayOverride instead. Opposite of InsEst, because this is the patient portion estimate. Two different uses: 1. For capitation, this automates calculation of writeoff. 2. For any other insurance, it gets deducted during calculation as shown in the edit window. Neither use directly affects patient balance.
20	NoBillIns	tinyint	Set to true to not bill to this insurance plan. This gets automatically set only when inserting. It's based on procedurecode.NoBillIns and insplanpreference.ValueString.
21	PaidOtherIns	double	-1 if blank. The amount paid or estimated to be paid by another insurance. This amount is then subtracted from what the current insurance would pay. When running the calculation and considering other claimprocs, it will ignore any patPlan with a higher ordinal. So, always blank for primary claims. User cannot edit, but can use PaidOtherInsOverride.
22	BaseEst	double	Always has a value. Used in TP, etc. The base estimate is the ((fee or allowedOverride)-Copay) x (percentage or percentOverride). Does not include all the extras like ded, annualMax,and paidOtherIns that InsEstTotal holds. BaseEst cannot be overridden by the user. Instead, the following fields can be manipulated: allowedOverride, CopayOverride, PercentOverride.
23	CopayOverride	double	-1 if blank. See description of CopayAmt. This lets the user set a copay that will never be overwritten by automatic calculations.
24	ProcDate	date	Date of the procedure. Displayed in Edit Claim window procedures grid. Currently only used for tracking annual insurance benefits remaining. Important in Adjustments to benefits. For total claim payments, MUST be the date of the procedures to correctly figure benefits. Will eventually transition to use this field to actually calculate aging. See the note under Ledgers.ComputePayments.
25	DateEntry	date	Date that it was changed to status received or supplemental. It is usually attached to a claimPayment at that point, but not if user forgets. This is still the date that it becomes important financial data. Only applies if Received or Supplemental. Otherwise, the date is disregarded. User may never edit. Important in audit trail.
26	LineNumber	tinyint	Assigned when claim is created as a way to order the procs showing on a claim. Indirectly goes out in X12 loop 2400. Used in Canadian eclaims (field F07). One based index. Is zero for total payments. For under and over payments, this gets set to zero to prevent it from showing on a claim.
27	DedEst	double	-1 if blank. Not sure why we need to allow -1. Calculated automatically. User cannot edit, but can use DedEstOverride instead.
28	DedEstOverride	double	-1 if blank. Overrides the DedEst value.
29	InsEstTotal	double	Always has a value. BaseEst-(DedEst or DedEstOverride)-PaidOtherIns-OverAnnualMax. User cannot edit, but can instead use InsEstTotalOverride. Recalculated each time TP is viewed, is saved as the value calculated for the last viewed TP. This variable should probably just be moved to memory and removed as a DB field.
30	InsEstTotalOverride	double	-1 if blank. Overrides the InsEstTotal value.
31	PaidOtherInsOverride	double	-1 if blank. Overrides the PaidOtherIns value.
32	EstimateNote	varchar(255)	An automatically generated note that displays information about over max, exclusions, and other limitations for which there are no fields. Only applies to estimate. Once it's attached to a claim, similar information can go in the remarks field.
33	WriteOffEst	double	-1 if blank. The estimated writeoff as calculated by OD. Usually only used for PPOs.
34	WriteOffEstOverride	double	-1 if blank. Overrides WriteOffEst. Usually only used for PPOs.
35	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be zero. No user interface for editing. Forced to always be the same as the procedure, or if no procedure, then the claim.
36	InsSubNum	bigint(20)	FK to inssub.InsSubNum.
37	PaymentRow	int(11)	1-indexed. Allows user to sort the order of payments on an EOB. All claimprocs for a payment will have the same PaymentRow value.
38	PayPlanNum	bigint(20)	FK to payplan.PayPlanNum. 0 if not attached to a payplan.
39	ClaimPaymentTracking	bigint(20)	FK to definition.DefNum. Connected to the ClaimPaymentTracking DefCat.
40	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
41	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
42	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
43	DateSuppReceived	date	The date the claim proc was first set to received or supplemental. If status is set to something other than received/supplemental, this field will be set to DateTime.MinValue if DateSuppReceived is today. If DateSuppReceived is set to a day in the past and the status is changed from received/supplemental to something else, the field will not be cleared or updated. Db only field used by one customer and this is how they requested it. PatNum #19191
44	DateInsFinalized	date	Date of the first claimPayment for this claim.
45	IsTransfer	tinyint(4)	Bool, defaults to false. When true, indicates that a claimproc is part of a transfer from a claim.
46	ClaimAdjReasonCodes	varchar(255)	Holds a comma delimited list of Claim Adjustment Reason Codes from an ERA. https://x12.org/codes/claim-adjustment-reason-codes
47	IsOverpay	tinyint(4)	Bool, defaults to false. When true, Status is NotReceived and indicates that the claimproc represents an insurance overpayment OR underpayment. Example insurance has partially paid on a claim, this procedure has still been paid 0, so it's an underpayment. The status column in the claim edit window will show PndSup.
48	SecurityHash	varchar(255)	Holds the salted hash of the following claimproc fields: ClaimNum, Status, InsPayEst, InsPayAmt.

claimsnapshot
Stores the original insurance writeoff, fee, and expected insurance payment information on claims.
Order	Name	Type	Summary
0	ClaimSnapshotNum	bigint(20)	Primary key.
1	ProcNum	bigint(20)	FK to procedurelog.ProcNum
2	ClaimType	varchar(255)	"P"=primary, "S"=secondary, "Other"=other, "Cap"=capitation. Never "PreAuth" as PreAuths will never be in this table
3	Writeoff	double	
4	InsPayEst	double	Expected amount the insurance will pay on the procedure.
5	Fee	double	Procedure's ProcFee
6	DateTEntry	datetime	The date/time that the snapshot was created. Not user editable.
7	ClaimProcNum	bigint(20)	FK to claimproc.ClaimProcNum
8	SnapshotTrigger	tinyint(4)	Enum:ClaimSnapshotTrigger Stores the trigger to which this ClaimSnapshot was created.
ClaimCreate: 0
Service: 1
InsPayment: 2

claimtracking
Order	Name	Type	Summary
0	ClaimTrackingNum	bigint(20)	Primary key.
1	ClaimNum	bigint(20)	FK to claim.ClaimNum
2	TrackingType	varchar(255)	Enum:ClaimTrackingType Identifies the type of claimtracking row.
StatusHistory:
ClaimUser:
ClaimProcReceived:
3	UserNum	bigint(20)	FK to user.UserNum
4	DateTimeEntry	timestamp	Automatically updated by MySQL every time a row is inserted or modified.
5	Note	text	Generic column for additional info.
6	TrackingDefNum	bigint(20)	FK to definition.DefNum for custom tracking when TrackingType=StatusHistory
7	TrackingErrorDefNum	bigint(20)	FK to definition.DefNum for custom tracking errors when TrackingType=StatusHistory

claimvalcodelog
Value codes for institutional 'claims'. Can have up to 12 per claim.
Order	Name	Type	Summary
0	ClaimValCodeLogNum	bigint(20)	Primary key.
1	ClaimNum	bigint(20)	FK to claim.ClaimNum.
2	ClaimField	varchar(5)	Descriptive abbreviation to help place field on form (Ex: "FL55" for field 55).
3	ValCode	char(2)	Value Code. 2 char.
4	ValAmount	double	Value Code Amount.
5	Ordinal	int(10)	Order of Value Code

clearinghouse
Since we can send e-claims to multiple clearinghouses, this table keeps track of each clearinghouse. Will eventually be used for individual carriers as well if they accept
Order	Name	Type	Summary
0	ClearinghouseNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of this clearinghouse
2	ExportPath	text	The path to export the X12 file to. \ is now optional. Can be overridden by clinic-level clearinghouses.
3	Payors	text	A list of all payors which should have claims sent to this clearinghouse. Comma delimited with no spaces. Not necessary if IsDefault.
4	Eformat	tinyint	Enum:ElectronicClaimFormat The format of the file that gets sent electronically.
None: 0-Not in database, but used in various places in program.
x837D_4010: 1-The American standard through 12/31/11.
Renaissance: 2-Proprietary format for Renaissance.
Canadian: 3-CDAnet format version 4.
Dutch: 4-CSV file adaptable for use in Netherlands.
x837D_5010_dental: 5-The American standard starting on 1/1/12.
x837_5010_med_inst: 6-Either professional or medical. The distiction is stored at the claim level.
Ramq: 7-A specific Canadian carrier located in Quebec which has their own format.
5	ISA05	varchar(255)	Sender ID Qualifier. Usually ZZ, sometimes 30. Seven other values are allowed as specified in X12 document, but probably never used.
6	SenderTIN	varchar(255)	Used in ISA06, GS02, 1000A NM1, and 1000A PER. If blank, then 810624427 is used to indicate Open Dental. Can be overridden by clinic-level clearinghouses.
7	ISA07	varchar(255)	Receiver ID Qualifier. Usually ZZ, sometimes 30. Seven other values are allowed as specified in X12 document, but probably never used.
8	ISA08	varchar(255)	Receiver ID. Also used in GS03. Provided by clearinghouse. Examples: BCBSGA or 0135WCH00(webMD)
9	ISA15	varchar(255)	"P" for Production or "T" for Test.
10	Password	varchar(255)	Password is usually combined with the login ID for user validation. Can be overridden by clinic-level clearinghouses.
11	ResponsePath	varchar(255)	The path that all incoming response files will be saved to. \ is now optional. Can be overridden by clinic-level clearinghouses.
12	CommBridge	tinyint	Enum:EclaimsCommBridge One of the included hard-coded communications bridges. Or none to just create the claim files without uploading.
None: 0-No comm bridge will be activated. The claim files will be created to the specified path, but they will not be uploaded.
WebMD: 1
BCBSGA: 2
Renaissance: 3
ClaimConnect: 4
RECS: 5
Inmediata: 6
AOS: 7
PostnTrack: 8
ITRANS: 9 Canadian clearinghouse.
Tesia: 10
MercuryDE: 11
ClaimX: 12
DentiCal: 13
EmdeonMedical: 14
Claimstream: 15 Canadian clearinghouse.
NHS: 16 UK clearinghouse.
EDS: 17
Ramq: 18
EdsMedical: 19
Lantek: 20
ITRANS2: 21 Canadian clearinghouse. Similar to ITRANS except supports certificate and carrier list web fetching.
VyneDental: 22
13	ClientProgram	varchar(255)	If applicable, this is the name of the client program to launch. It is even used by the hard-coded comm bridges, because the user may have changed the installation directory or exe name. Can be overridden by clinic-level clearinghouses.
14	LastBatchNumber	smallint	Each clearinghouse increments their batch numbers by one each time a claim file is sent. User never sees this number. Maxes out at 999, then loops back to 1. This field must NOT be cached and must be ignored in the code except where it explicitly retrieves it from the db. Defaults to 0 for brand new clearinghouses, which causes the first batch to go out as #1.
15	ModemPort	tinyint	Was not used. 1,2,3,or 4. The port that the modem is connected to if applicable. Always uses 9600 baud and standard settings. Will crash if port or modem not valid.
16	LoginID	varchar(255)	A clearinghouse usually has a login ID that is used with the password in order to access the remote server. This value is not usualy used within the actual claim. Can be overridden by clinic-level clearinghouses.
17	SenderName	varchar(255)	Used in 1000A NM1 and 1000A PER. But if SenderTIN is blank, then OPEN DENTAL SOFTWARE is used instead. Can be overridden by clinic-level clearinghouses.
18	SenderTelephone	varchar(255)	Used in 1000A PER. But if SenderTIN is blank, then 8776861248 is used instead. 10 digit phone is required by WebMD and is universally assumed, so for now, this must be either blank or 10 digits. Can be overridden by clinic-level clearinghouses.
19	GS03	varchar(255)	Usually the same as ISA08, but at least one clearinghouse uses a different number here.
20	ISA02	varchar(10)	Authorization information. Almost always blank. Used for Denti-Cal.
21	ISA04	varchar(10)	Security information. Almost always blank. Used for Denti-Cal.
22	ISA16	varchar(2)	X12 component element separator. Two digit hexadecimal string representing an ASCII character or blank. Usually blank, implying 3A which represents ':'. For Denti-Cal, hexadecimal value 22 must be used, corresponding to '"'.
23	SeparatorData	varchar(2)	X12 data element separator. Two digit hexadecimal string representing an ASCII character or blank. Usually blank, implying 2A which represents '*'. For Denti-Cal, hexadecimal value 1D must be used, corresponding to the "group separator" character which has no visual representation.
24	SeparatorSegment	varchar(2)	X12 segment terminator. Two digit hexadecimal string representing an ASCII character or blank. Usually blank, implying 7E which represents '~'. For Denti-Cal, hexadecimal value 1C must be used, corresponding to the "file separator" character which has no visual representation.
25	ClinicNum	bigint(20)	FK to clinic.ClinicNum. ClinicNum=0 for HQ.
26	HqClearinghouseNum	bigint(20)	FK to clearinghouse.ClearingHouseNum. Never 0. Points to the HQ copy of this clearinghouse. If this copy is the HQ copy, then HqClearinghouseNum=ClearinghouseNum.
27	IsEraDownloadAllowed	tinyint(4)	Enum:EraBehaviors EraBehaviors.DownloadAndReceive by default. This flag is implemented individually within each clearinghouse. Can be overridden by clinic-level clearinghouses.
None: 0 - Do not download ERAs/EOBs
DownloadDoNotReceive: 1 - Download ERAs/EOBs, but do not mark claims and claim procedures as 'Received'.
DownloadAndReceive: 2 - Download ERAs/EOBs, and mark claims and claim procedures as 'Received'.
28	IsClaimExportAllowed	tinyint(4)	True by default. This flag is implemented individually within each clearinghouse. Can be overridden by clinic-level clearinghouses.
29	IsAttachmentSendAllowed	tinyint(4)	Currently only used for DentalXChange's attachment service. This indicates that the user has set up the attachment service and would like to use it in Open Dental.
30	LocationID	varchar(255)	A unique identifier provided by the clearinghouse to identify the practice in their system. This is separate from the issue of clinics, where we already enforce only one clinic per clearinghouse.
31	EnableXConnect	tinyint(4)	False by default. This bool is used to control whether a clinic has enabled XConnect for the clearinghouse.

clinic
A clinic is usually a separate physical office location. If multiple clinics are sharing one database, then this is used. Patients, Operatories, Claims, and many other types of objects can be assigned to a clinic.
Order	Name	Type	Summary
0	ClinicNum	bigint(20)	Primary key. Used in patient,payment,claimpayment,appointment,procedurelog, etc.
1	Description	varchar(255)	Use Abbr for all user-facing forms. Description is required and should not be blank.
2	Address	varchar(255)	.
3	Address2	varchar(255)	Second line of address.
4	City	varchar(255)	.
5	State	varchar(255)	2 char in the US.
6	Zip	varchar(255)	.
7	Phone	varchar(255)	Does not include any punctuation. Exactly 10 digits or blank in USA and Canada.
8	BankNumber	varchar(255)	The account number for deposits.
9	DefaultPlaceService	tinyint	Enum:PlaceOfService Usually 0 unless a mobile clinic for instance.
Office: 0. Code 11
PatientsHome: 1. Code 12
InpatHospital: 2. Code 21
OutpatHospital: 3. Code 22
SkilledNursFac: 4. Code 31
CustodialCareFacility: 5. Code 33. In X12, a similar code AdultLivCareFac 35 is mentioned.
OtherLocation: 6. Code 99. We use 11 for office.
MobileUnit: 7. Code 15
School: 8. Code 03
MilitaryTreatFac: 9. Code 26
FederalHealthCenter: 10. Code 50
PublicHealthClinic: 11. Code 71
RuralHealthClinic: 12. Code 72
EmergencyRoomHospital: 13. Code 23
AmbulatorySurgicalCenter: 14. Code 24
TelehealthOutsideHome: 15. Code 02.
TelehealthInHome: 16. Code 10
OutreachSiteOrStreet: 17. Code 27
10	InsBillingProv	bigint(20)	FK to provider.ProvNum. 0=Default practice provider, -1=Treating provider.
11	Fax	varchar(50)	Does not include any punctuation. Exactly 10 digits or empty in USA and Canada.
12	EmailAddressNum	bigint(20)	FK to emailaddress.EmailAddressNum.
13	DefaultProv	bigint(20)	FK to provider.ProvNum. Used in place of the default practice provider when making new patients.
14	SmsContractDate	datetime	DateSMSContract was signed.
15	SmsMonthlyLimit	double	Always stored in USD, this is the desired limit for SMS out for a given month.
16	IsMedicalOnly	tinyint(4)	True if this clinic is a medical clinic. Used to hide/change certain areas of Open Dental, like hiding the tooth chart and changing 'dentist' to 'provider'.
17	BillingAddress	varchar(255)	Overrides Address on claims if not blank.
18	BillingAddress2	varchar(255)	Second line of billing address.
19	BillingCity	varchar(255)	Overrides City on claims if BillingAddress is not blank.
20	BillingState	varchar(255)	Overrides State on claims if BillingAddress is not blank.
21	BillingZip	varchar(255)	Overrides Zip on claims if BillingAddress is not blank.
22	PayToAddress	varchar(255)	Overrides practice PayTo address if not blank.
23	PayToAddress2	varchar(255)	Second line of PayTo address.
24	PayToCity	varchar(255)	Overrides practice PayToCity if PayToAddress is not blank.
25	PayToState	varchar(255)	Overrides practice PayToState if PayToAddress is not blank.
26	PayToZip	varchar(255)	Overrides practice PayToZip if PayToAddress is not blank.
27	UseBillAddrOnClaims	tinyint(4)	True if this clinic's billing address should be used on outgoing claims.
28	Region	bigint(20)	FK to definition.DefNum when definition.DefCat is Regions. A region is a way of grouping multiple clinics. Used in Ins Verification and Tasks.
29	ItemOrder	int(11)	0 based. Clinics cache is sorted by ItemOrder if the preference ClinicListIsAlphabetical is false.
30	IsInsVerifyExcluded	tinyint(4)	True if this clinic should be excluded from showing up in the Insurance Verification List.
31	Abbr	varchar(255)	Abbreviation for the Clinic's description. Sorted by Abbr if ClinicListIsAlphabetical is true. Use this for all user-facing forms. Abbr is required and should not be blank.
32	MedLabAccountNum	varchar(16)	FK to medlab.PatAccountNum. Used to filter MedLab results by the MedLab Account Number assigned to each clinic.
33	IsConfirmEnabled	tinyint(4)	Clinic level preference. (Better Name is "IsAutomationEnabled" but that conflicts with other definitions of what Automation means. Determines if autocomm should be sent for/from this clinic.
34	IsConfirmDefault	tinyint(4)	Deprecated. Clinic level preference. If true then this clinic is using the default automated reminder/confirmation settings as defined by the user.
35	IsNewPatApptExcluded	tinyint(4)	Deprecated as of 17.1, use signup portal. Indicates whether or not the New Patient Appointment version of Web Sched is excluded for this specifc clinic.
36	IsHidden	tinyint(4)	Indicates whether or not the clinic is hidden.
37	ExternalID	bigint(20)	Not currently used by Open Dental but is used by other software's.
38	SchedNote	varchar(255)	Indicates if the clinic should only be scheduled in a certain way (e.g. ortho only, etc)
39	HasProcOnRx	tinyint(4)	Defaults to false. If true, will require procedure be attached to controlled prescriptions written from this clinic.
40	TimeZone	varchar(75)	Allows adding timezone info to FHIR datetimes. This does not actually change the datetime of any field.
41	EmailAliasOverride	varchar(255)	Overrides the SenderAddress (aka Alias) for emails sent from this clinic.

clinicerx
Tracks which clinics have access to eRx based on ClinicDescr. Synchronized with HQ.
Order	Name	Type	Summary
0	ClinicErxNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. Holder of registration key only for HQ record, in customer record this will be 0.
2	ClinicDesc	varchar(255)	Description of a clinic from the clinic table. Only used by OD HQ. For customer records, use ClinicNum.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Is the clinic that is used for accessing eRx.
4	EnabledStatus	tinyint(4)	Enum:ErxStatus Set to true if the clinic with the given ClinicName has access to eRx.
Disabled: 0.
Enabled: 1.
Undefined: 2.
PendingAccountId: 3.
NeedsManualAccountId: 4.
PendingEmail: 5.
Pending: 6.
PendingEconnTransmit: 7.
InTransitToEconn: 8.
NeedsManualOfficeContact: 9.
NeedsErxId: 10.
5	ClinicId	varchar(255)	Clinic identifier used by the erx option. Only used by OD HQ.
6	ClinicKey	varchar(255)	Unique key used by the erx option. Only used by OD HQ.
7	AccountId	varchar(25)	Only used by OD HQ.
8	RegistrationKeyNum	bigint(20)	FK to registrationkey.RegistrationKeyNum. HQ only, links to the registration key used to make this clinicerx row.

clinicpref
Used to store preferences specific to clinics. Works in conjunction with the Pref table.
Order	Name	Type	Summary
0	ClinicPrefNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Never 0 because that would indicate HQ, but all HQ prefs are stored in Pref table instead of here.
2	PrefName	varchar(255)	Enum: PrefName
3	ValueString	text	The stored value.

clockevent
One clock-in / clock-out pair. Or, if the pair is a break, then it's an out/in pair. With normal clock in/out pairs, we want to know how long the employee was working. It's the opposite with breaks. We want to know how long they were not working, so the pair is backwards. This means that a normal clock in is left incomplete when the clock out for break is created. And once both are finished, the regular in/out will surround the break. Breaks cannot be viewed easily on the same grid as regular clock events for this reason. And since breaks do not affect pay, they should not clutter the normal grid.
Order	Name	Type	Summary
0	ClockEventNum	bigint(20)	Primary key.
1	EmployeeNum	bigint(20)	FK to employee.EmployeeNum
2	TimeEntered1	datetime	The actual time that this entry was entered. Cannot be 01-01-0001.
3	TimeDisplayed1	datetime	The time to display and to use in all calculations. Cannot be 01-01-0001.
4	ClockStatus	tinyint	Enum:TimeClockStatus Home, Lunch, or Break. The status really only applies to the clock out. Except the Break status applies to both out and in.
Home: 0
Lunch: 1
Break: 2
5	Note	text	.
6	TimeEntered2	datetime	The user can never edit this, but the program has to be able to edit this when user clocks out. Can be 01-01-0001 if not clocked out yet.
7	TimeDisplayed2	datetime	User can edit. Can be 01-01-0001 if not clocked out yet.
8	OTimeHours	time	This is a manual override for OTimeAuto. Typically -1 hour (-01:00:00) to indicate no override. When used as override, allowed values are zero or positive. This is an alternative to using a TimeAdjust row.
9	OTimeAuto	time	Automatically calculated OT. Will be zero if none.
10	Adjust	time	This is a manual override of AdjustAuto. Ignored unless AdjustIsOverridden set to true. When used as override, it's typically negative, although zero and positive are also allowed.
11	AdjustAuto	time	Automatically calculated Adjust. Will be zero if none.
12	AdjustIsOverridden	tinyint(4)	True if AdjustAuto is overridden by Adjust.
13	Rate2Hours	time	This is a manual override for Rate2Auto. Typically -1 hour (-01:00:00) to indicate no override. When used as override, allowed values are zero or positive. This is the portion of the hours worked which are at Rate2, so it's not in addition to the hours worked. Also used to calculate the Rate2 OT.
14	Rate2Auto	time	Automatically calculated rate2 pay. Will be zero if none.
15	ClinicNum	bigint(20)	FK to clinic.ClinicNum. The clinic the ClockEvent was entered at.
16	Rate3Hours	time	This is a manual override for Rate3Auto. Typically -1 hour (-01:00:00) to indicate no override. When used as override, allowed values are zero or positive. This is the portion of the hours worked which are at Rate3, so it's not in addition to the hours worked. Also used to calculate the Rate3 OT.
17	Rate3Auto	time	Automatically calculated Rate3 pay. Will be zero if none.
18	IsWorkingHome	tinyint(4)	True if the Clock Event is made by choosing "Available at Home" when clocking in. Will be false if "Available At Office" is selected instead.

cloudaddress
Order	Name	Type	Summary
0	CloudAddressNum	bigint(20)	Primary key.
1	IpAddress	varchar(50)	The IP address the user is connecting from.
2	UserNumLastConnect	bigint(20)	FK to userod.UserNum.
3	DateTimeLastConnect	datetime	DateTime of the last successful login from the address.

codegroup
These groups of procedure codes are used in Benefit Frequencies (and Insurance History?). We can't use CovCats because those spans are frequently far too broad. We often need specific codes. Cached.
Order	Name	Type	Summary
0	CodeGroupNum	bigint(20)	Primary key.
1	GroupName	varchar(50)	.
2	ProcCodes	text	List of D codes with commas and dashes. No spaces. Example: "D0000-D0999,D2140-D2161,D2750" would mean all exams and xrays, some amalgams, and a crown.
3	ItemOrder	int(11)	Zero-based. CodeGroups that don't show in either list (IsHidden=true and ShowInAgeLimit=false) get higher ItemOrders so that then are at the bottom of the setup list.
4	CodeGroupFixed	tinyint(4)	Enum:EnumCodeGroupFixed 0=None,BW,PanoFMX,Exam,Perio,Prophy,SRP,FMDebride,Fluoride,Sealant. Six are used in sheet static text fields (example StaticTextField.dateLastBW), and seven are used in Ins History Window.
None: 0
BW: 1
PanoFMX: 2
Exam: 3
Perio: 4
Prophy: 5
SRP: 6- When used in InsHist window, the quadrant is hard coded for each of the 4 rows.
FMDebride: 7
Fluoride: 8
Sealant: 9
5	IsHidden	tinyint(4)	If true, a user will not be able to see this codegroup as an option in the benefit edit form or any grid on FormInsBenefits.
6	ShowInAgeLimit	tinyint(4)	If true, this codegroup will show in Age Limitations grid. Control of showing in Freq Lim is done separately using ShowInFrequency.
7	ShowInFrequency	tinyint(4)	If true, this codegroup will show in the Frequency Limitations Grid.
8	ShowInOther	tinyint(4)	If true, this codegroup will show in the Ins Benefits Window in the Other Benefits grid.

codesystem
Used for tracking code systems imported to OD. HL7OID used for sending messages. This must be a database table in order to keep track of VersionCur between sessions.
Order	Name	Type	Summary
0	CodeSystemNum	bigint(20)	Primary key. Not currently referenced anywhere.
1	CodeSystemName	varchar(255)	.
2	VersionCur	varchar(255)	Only used for display, not actually interpreted. Updated by Code System importer. Examples: 2013 or 1
3	VersionAvail	varchar(255)	Only used for display, not actually interpreted. Updated by Convert DB script.
4	HL7OID	varchar(255)	Example: 2.16.840.1.113883.6.13
5	Note	varchar(255)	Notes to display to user. Examples: "CDT codes distributed via program updates.", "CPT codes require purchase and download from www.ama.com

commlog
Tracks all forms of communications with patients, including emails, phonecalls, postcards, etc. Any changes made to this table need to be added to CommlogHist and CommlogHists.CreateFromCommlog().
Order	Name	Type	Summary
0	CommlogNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. This will be 0 if Referral.
2	CommDateTime	datetime	Date and time of entry
3	CommType	bigint(20)	FK to definition.DefNum. This will be 0 if Referral.
4	Note	text	Note for this commlog entry.
5	Mode_	tinyint	Enum:CommItemMode Phone, email, etc.
None: 0-
Email: 1-
Mail: 2
Phone: 3
InPerson: 4
Text: 5
EmailAndText: 6
PhoneAndText: 7
Fax: 8
6	SentOrReceived	tinyint	Enum:CommSentOrReceived Neither=0,Sent=1,Received=2.
Neither: 0
Sent: 1
Received: 2
7	UserNum	bigint(20)	FK to userod.UserNum.
8	Signature	text	Signature. For details, see procnote.Signature.
9	SigIsTopaz	tinyint(4)	True if signed using the Topaz signature pad, false otherwise.
10	DateTStamp	timestamp	Automatically updated by MySQL every time a row is added or changed.
11	DateTimeEnd	datetime	Date and time when commlog ended. Mainly for internal use.
12	CommSource	tinyint(4)	Enum:CommItemSource Set to the source of the entity that created this commlog. E.g. WebSched.
User: 0
WebSched: 1
ProgramLink: 2
ApptReminder: 3
EServices: 4 - HQ Only
SupplementalBackup: 5
ApptThankYou: 6
FHIR: 7 - Includes non-FHIR API.
NewPatThankYou: 8
MsgToPay: 9
MassEmail: 10
13	ProgramNum	bigint(20)	FK to program.ProgramNum. This will be 0 unless CommSource is set to ProgramLink.
14	DateTEntry	datetime	Track Date Created for commlogs. Value for existing commlogs show as blank in the UI. Not editable by user.
15	ReferralNum	bigint(20)	FK to referral.ReferralNum.
16	CommReferralBehavior	tinyint(4)	Enum:EnumCommReferralBehavior Changes how this referral commlog displays within grids.
None: 0
TopAnchored: 1
Hidden: 2

commoptout
The patient does not want to recieve messages for a particular type of communication.
Order	Name	Type	Summary
0	CommOptOutNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. The patient who is opting out of this form of communication.
2	OptOutSms	int(11)	Enum:CommOptOutType The type of communication for which this patient does not want to receive automated sms.
All: 1 - All. Allows adding new entries to this enum without requiring a convert script.
eConfirm:
eReminder:
eThankYou:
WebSchedRecall:
WebSchedASAP:
PatientPortalInvites:
Verify:
Statements:
Arrivals:
Birthdays:
GeneralMessages:
MsgToPay:
3	OptOutEmail	int(11)	Enum:CommOptOutType The type of communication for which this patient does not want to receive automated email.
All: 1 - All. Allows adding new entries to this enum without requiring a convert script.
eConfirm:
eReminder:
eThankYou:
WebSchedRecall:
WebSchedASAP:
PatientPortalInvites:
Verify:
Statements:
Arrivals:
Birthdays:
GeneralMessages:
MsgToPay:

computer
Keeps track of the computers in an office. The list will eventually become cluttered with the names of old computers that are no longer in service. The old rows can be safely deleted. Although the primary key is used in at least one table, this will probably be changed, and the computername will become the primary key.
Order	Name	Type	Summary
0	ComputerNum	bigint(20)	Primary key.
1	CompName	varchar(100)	Name of the computer.
2	LastHeartBeat	datetime	Allows us to tell which computers are running. All workstations record a heartbeat here at an interval of 3 minutes. So if the heartbeat is fairly fresh, then that's an accurate indicator of whether Open Dental is running on that computer.

computerpref
Enables preference specific to individual computers on a customer network.
Order	Name	Type	Summary
0	ComputerPrefNum	bigint(20)	Primary key.
1	ComputerName	varchar(64)	The human-readable name of the computer on the network (not the IP address).
2	GraphicsUseHardware	tinyint(1)	Set to true if the tooth chart is to use a hardware accelerated OpenGL window when available. Set to false to use software rendering when available. Of course, the final pixel format on the customer machine depends on the list of available formats. Best match pixel format is always used. This option only applies if GraphicsSimple is set to false.
3	GraphicsSimple	tinyint(1)	Enum:DrawingMode Set to 1 to use the low-quality 2D tooth chart in the chart module. Set to 0 to use a 3D DirectX based tooth chart in the chart module. This option helps the program run even when the local graphics hardware is buggy or unavailable.
DirectX: 0
Simple2D: 1
OpenGL: 2
4	SensorType	varchar(255)	Indicates the type of Suni sensor connected to the local computer (if any). This can be a value of A, B, C, or D.
5	SensorBinned	tinyint(4)	Indicates wether or not the Suni sensor uses binned operation.
6	SensorPort	int(11)	Indicates which Suni box port to connect with. There are 2 ports on a box (ports 0 and 1).
7	SensorExposure	int(11)	Indicates the exposure level to use when capturing from a Suni sensor. Values can be 1 through 7.
8	GraphicsDoubleBuffering	tinyint(4)	Indicates if the user prefers double-buffered 3D tooth-chart (where applicable).
9	PreferredPixelFormatNum	int(11)	Indicates the current OpenGL pixel format by number which the user prefers (if using OpenGL).
10	AtoZpath	varchar(255)	The path of the A-Z folder for the specified computer. Overrides the officewide default. Used when multiple locations are on a single virtual database and they each want to look to the local data folder for images.
11	TaskKeepListHidden	tinyint(1)	If the global setting for showing the Task List is on, this controls if it should be hidden on this specified computer
12	TaskDock	int(11)	Dock task bar on bottom (0) or right (1).
13	TaskX	int(11)	X pos for right docked task list.
14	TaskY	int(11)	Y pos for bottom docked task list.
15	DirectXFormat	varchar(255)	Holds a semi-colon separated list of enumeration names and values representing a DirectX format. If blank, then no format is currently set and the best theoretical format will be chosen at program startup. If this value is set to 'opengl' then this computer is using OpenGL and a DirectX format will not be picked.
16	ScanDocSelectSource	tinyint(4)	Show the select scanner dialog when scanning documents. This can also be set to prevent a couple of issues that can happen after scanning with some Canon scanners. One issue is when the Imaging Module won't load some PDFs. The other issue is when listbox selections won't visually update in other windows like the commlog.
17	ScanDocShowOptions	tinyint(4)	Show the scanner options dialog when scanning documents.
18	ScanDocDuplex	tinyint(4)	Attempt to scan in duplex mode when scanning multipage documents with an ADF.
19	ScanDocGrayscale	tinyint(4)	Scan in gray scale when scanning documents.
20	ScanDocResolution	int(11)	Scan at the specified resolution when scanning documents. Example: 150.
21	ScanDocQuality	tinyint	0-100. Quality of jpeg after compression when scanning documents. 100 indicates full quality. Opposite of compression. Should only be used when scanning.
22	ClinicNum	bigint(20)	FK to clinic.ClinicNum. The most recent clinic for this computer. Determines which clinic is used when loading Open Dental.
23	ApptViewNum	bigint(20)	FK to apptview.ApptViewNum. The most recent appt view num for this computer. Used when opening with the Appts module in conjunction with ClinicNum if this ApptViewNum is associated to the ClinicNum.
24	RecentApptView	tinyint	Deprecated. The index of the most recent appt view for this computer. Uses it when opening. This column cannot be dropped due to older versions using it upon opening (prior to calling the update file copier code) so they will throw a UE if this column is ever dropped.
25	PatSelectSearchMode	tinyint(4)	Enum:SearchMode The search mode that is used when loading the patient select window, and while typing. When 0 the patient select window will use the DB wide pref PatientSelectUsesSearchButton.
Default: 0
UseSearchButton: 1
RefreshWhileTyping: 2
26	NoShowLanguage	tinyint(4)	
27	NoShowDecimal	tinyint(4)	If true, don't warn user if the region's decimal setting is not 2.
28	ComputerOS	varchar(255)	Enum:PlatformOD The current operating system platform for the computer.
Undefined: Only happens when workstation has not ran through convert script yet.
Win32S: The operating system is Win32s. Win32s is a layer that runs on 16-bit versions of Windows to provide access to 32-bit applications.
Win32Windows: The operating system is Windows 95 or Windows 98.
Win32NT: The operating system is Windows NT or later.
WinCE: The operating system is Windows CE.
Unix: The operating system is Unix.
MacOSX: The operating system is Macintosh.
29	HelpButtonXAdjustment	double	Deprecated.
30	GraphicsUseDirectX11	tinyint(4)	Enum:YN Unknown, Yes, No.
Unknown: 0
Yes: 1
No: 2
31	Zoom	int(11)	Default 0. Typically a bit above 100. Example 120. Below 100 is allowed but rare, like 80. In addition to normal monitor scale set in Windows. 0 is treated the same as 100, or no additional zoom.
32	VideoRectangle	varchar(255)	This is x,y,w,h format for the desktop location of the Video window. This is saved each time the Video window closes. If the Video window is maximized, then the form will instead be like this: "100,120,600,800,Max". The rectangle here defines the RestoreBounds when user unmaximizes.
33	CreditCardTerminalId	varchar(255)	Holds the value of the last Terminal used in a transaction. Used for PayConnect2 in FormPayConnect2 to set the default value of the Terminal list loading a new terminal payment.

confirmationrequest
Requests that have been sent via EConnector to HQ. HQ will process and update status as responses become available.
Order	Name	Type	Summary
0	ConfirmationRequestNum	bigint(20)	PK. Generated by HQ.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
2	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
3	ApptNum	bigint(20)	Foreign key to the appointment represented by this AutoCommAppt.
4	DateTimeConfirmExpire	datetime	Generated by OD. Typically the time of the appointment. This is the time at which HQ will consider this unconfirmed and auto terminate.
5	ShortGUID	varchar(255)	Generated by HQ. Identifies this AutoCommGuid in future transactions between HQ and OD.
6	ConfirmCode	varchar(255)	Generated by HQ. The code that the patient will text back in order to confirm the appointment. If received then it indicates a positive response.
7	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
8	DateTimeConfirmTransmit	datetime	Generated by OD. Timestamp when EConnector sent this confirm request to HQ. Stored in local customer timezone.
9	DateTimeRSVP	datetime	Generated by OD. Timestamp when HQ updates this request to indicate that it has been terminated. RSVPStatusCode will change to its final state at this time. Stored in local customer timezone.
10	RSVPStatus	tinyint(4)	Enum:RSVPStatusCodes Generated by OD in some cases and HQ in others. Indicates current status in the lifecycle of this ConfirmationRequest.
AwaitingTransmit: Entered manually by something other than EConnector. EConnector will pickup and send to HQ and change to pendingRsvp.
PendingRsvp: EConnector has sent this to HQ and will remain in this status until it is either terminated or receives a response from the patient.
PositiveRsvp: Patient responded with an affirmative confirmation.
NegativeRsvp: Patient responded and declined the confirmation.
Callback: Patient responded by requesting a callback.
Expired: Patient took no action by the time DateTimeExpired passed and the confirmation was terminated.
Failed: HQ or EConnector was unable to create the confirmation so it was terminated prematurely.
ApptChanged: 7 - The appointment date/time was changed before the patient responded to the original confirmation. OD proper will simply delete these ConfirmationRequests. HQ will move them to the terminated table and mark them ApptChanged.
11	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
12	GuidMessageFromMobile	text	FK to smsfrommobile.GuidMessage. Generated at HQ when the confirmation pending is terminated with confirmation text message. Also allows SmsFromMobile to be linked to ConfirmationRequest in OD proper.
13	ApptDateTime	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.
14	TSPrior	bigint(20)	This was the TSPrior used to send this reminder.
15	DoNotResend	tinyint(4)	Indicates whether the user has chosen to not resend the confirmation request when the AptDateTime has changed.
16	SendStatus	tinyint(4)	Indicates status of message.
17	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
18	MessageType	tinyint(4)	
19	MessageFk	bigint(20)	FK to primary key of appropriate table.
20	DateTimeSent	datetime	DateTime the message was sent.

connectiongroup
Used in the Central Enterprise Management Tool for creating a group of connections.
Order	Name	Type	Summary
0	ConnectionGroupNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of the connection group

conngroupattach
Used in the Central Enterprise Management Tool to link CentralConnections and ConnectionGroups. Each connection can be in multiple groups.
Order	Name	Type	Summary
0	ConnGroupAttachNum	bigint(20)	Primary Key
1	ConnectionGroupNum	bigint(20)	FK to connectiongroup.ConnectionGroupNum
2	CentralConnectionNum	bigint(20)	FK to centralconnection.CentralConnectionNum

contact
Like a rolodex for businesses that the office interacts with. Used to store pharmacies, etc.
Order	Name	Type	Summary
0	ContactNum	bigint(20)	Primary key.
1	LName	varchar(255)	Last name or, frequently, the entire name.
2	FName	varchar(255)	First name is optional.
3	WkPhone	varchar(255)	Work phone.
4	Fax	varchar(255)	Fax number.
5	Category	bigint(20)	FK to definition.DefNum
6	Notes	text	Note for this contact.

county
Used in public health.
Order	Name	Type	Summary
0	CountyNum	bigint(20)	Primary Key.
1	CountyName	varchar(255)	Frequently used as the primary key of this table. But it's allowed to change. Change is programmatically synchronized.
2	CountyCode	varchar(255)	Optional. Usage varies.

covcat
Insurance coverage categories. They need to look like in the manual for the American calculations to work properly.
Order	Name	Type	Summary
0	CovCatNum	bigint(20)	Primary key. Only used in Benefit and CovSpan tables.
1	Description	varchar(50)	Description of this category.
2	DefaultPercent	smallint(6)	Default percent for this category. -1 to skip this category and not apply a percentage.
3	CovOrder	int(11)	The order in which the categories are displayed. Includes hidden categories. 0-based.
4	IsHidden	tinyint	If true, this category will be hidden.
5	EbenefitCat	tinyint	Enum:EbenefitCategory The X12 benefit categories. Each CovCat can link to one X12 category. Default is 0 (unlinked).
None: 0- Default. Applies to all codes.
General: 1- X12: 30 and 35. All ADA codes except ortho. D0000-D7999 and D9000-D9999
Diagnostic: 2- X12: 23. ADA D0000-D0999. This includes DiagnosticXray.
Periodontics: 3- X12: 24. ADA D4000
Restorative: 4- X12: 25. ADA D2000-D2699, and D2800-D2999.
Endodontics: 5- X12: 26. ADA D3000
MaxillofacialProsth: 6- X12: 27. ADA D5900-D5999
Crowns: 7- X12: 36. Exclusive subcategory of restorative. D2700-D2799
Accident: 8- X12: 37. ADA range?
Orthodontics: 9- X12: 38. ADA D8000-D8999
Prosthodontics: 10- X12: 39. ADA D5000-D5899 (removable), and D6200-D6899 (fixed)
OralSurgery: 11- X12: 40. ADA D7000
RoutinePreventive: 12- X12: 41. ADA D1000
DiagnosticXRay: 13- X12: 4. ADA D0200-D0399. So this is like an optional category which is otherwise considered to be diagnosic.
Adjunctive: 14- X12: 28. ADA D9000-D9999

covspan
Always attached to covcats, this describes the span of procedure codes to which the category applies.
Order	Name	Type	Summary
0	CovSpanNum	bigint(20)	Primary key.
1	CovCatNum	bigint(20)	FK to covcat.CovCatNum.
2	FromCode	varchar(15)	Lower range of the span. Does not need to be a valid code.
3	ToCode	varchar(15)	Upper range of the span. Does not need to be a valid code.

cpt
Other tables generally use the CptCode as their foreign key.
Order	Name	Type	Summary
0	CptNum	bigint(20)	Primary key. .
1	CptCode	varchar(255)	Cpt code. Not allowed to edit this column once saved in the database.
2	Description	varchar(4000)	Short Description provided by Cpt documentation.
3	VersionIDs	varchar(255)	Comma delimited list of years the Cpt code existed in that have been imported into this table.

creditcard
One credit card along with any recurring charge information.
Order	Name	Type	Summary
0	CreditCardNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	Address	varchar(255)	.
3	Zip	varchar(255)	Postal code.
4	XChargeToken	varchar(255)	Token for X-Charge. Alphanumeric, upper and lower case, about 15 char long. Passed into Xcharge instead of the actual card number. Used for Global Payments (formerly EdgeExpress) as well.
5	CCNumberMasked	varchar(255)	Credit Card Number. Will be stored masked: XXXXXXXXXXXX1234.
6	CCExpiration	date	Only month and year are used, the day will usually be 1.
7	ItemOrder	int(11)	The order that multiple cards will show. Zero-based. First one will be default.
8	ChargeAmt	double	Amount set for recurring charges.
9	DateStart	date	Start date for recurring charges.
10	DateStop	date	Stop date for recurring charges.
11	Note	varchar(255)	Any notes about the credit card or account goes here.
12	PayPlanNum	bigint(20)	FK to payplan.PayPlanNum.
13	PayConnectToken	varchar(255)	Token for PayConnect. PayConnect returns a token and token expiration, when requested by the merchant's system, to be used instead of actual credit card number in subsequent transactions.
14	PayConnectTokenExp	date	Expiration for the PayConnect token. Used with the PayConnect token instead of the actual credit card number and expiration.
15	Procedures	text	Comma delimited list of the ProcCodes authorized to allow a recurring charge to be processed for the credit card. When empty, ProcCodes will not be considered when authorizing recurring charges.
16	CCSource	tinyint(4)	Enum:CreditCardSource Indicates which application made this credit card and token.
None: 0 - This is used when the payment is not a Credit Card. If CC, then this means we are storing the actual credit card number. Not recommended.
XServer: 1 - Local installation of X-Charge
XWeb: 2 - Credit card created via X-Web (an eService)
PayConnect: 3 - PayConnect web service (from within OD).
XServerPayConnect: 4 - Credit card has been added through the local installation of X-Charge and the PayConnect web service.
XWebPortalLogin: 5 - Made from the login screen of the Patient Portal.
PaySimple: 6 - PaySimple web service (from within OD).
PaySimpleACH: 7 - PaySimple ACH web service (from within OD).
PayConnectPortal: 8 - PayConnect credit card (made from Patient Portal)
PayConnectPortalLogin: 9 - PayConnect credit card (made from Patient Portal Login screen).
CareCredit: 10 - CareCredit.
EdgeExpressRCM: 11 - Global Payments Cloud (formerly EdgeExpress) when calling the RCM program.
EdgeExpressCNP: 12 - Global Payments Card Not Present API (formerly EdgeExpress).
API: 13 - Payment taken through Open Dental API.
EdgeExpressPaymentPortal: 14 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal.
EdgeExpressPaymentPortalGuest: 15 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal as a guest.
PayConnectPaymentPortal: 16 - PayConnect payment taken through the Payment Portal.
PayConnectPaymentPortalGuest: 17 - PayConnect payment taken through the Payment Portal as a guest.
PaySimplePaymentPortal: 18 - PaySimple payment taken through the Payment Portal.
PaySimplePaymentPortalGuest: 19 - PaySimple payment taken through the Payment Portal as a guest.
PaySimplePaymentPortalACH: 20 - PaySimple ACH Payment taken through the Payment Portal.
XWebPaymentPortal: 21 - XWeb payment taken through the Payment Portal.
XWebPaymentPortalGuest: 22 - XWeb payment taken through the Payment Portal as a guest.
MeetInTheCloudTerminal: 23 - Meet In The Cloud payment via terminal.
17	ClinicNum	bigint(20)	FK to clinic.ClinicNum. The clinic where this card was added. Each clinic could have a different AuthKey and different AuthKeys could generate overlapping tokens.
18	ExcludeProcSync	tinyint(4)	Only used at OD HQ. Excludes credit card from syncing default procedures. False by default.
19	PaySimpleToken	varchar(255)	Token for PaySimple. PaySimple returns a token, when requested by the merchant's system, to be used instead of actual credit card number in subsequent transactions.
20	ChargeFrequency	varchar(150)	Stores how often the credit card gets charged for a recurring charge. The card can either be charged fixed days of the month or fixed week days of the month. Some examples of the former are "4th day of the month" or "1st and 16th day of the month". Some examples of the latter are "Third Monday of the month" or "Every other Friday of the month". If the first character of this column is a 0, then the frequency is fixed day of the month. If the first character is 1, the frequency is fixed week days of the month. The next character is a pipe for separation. If fixed day of the month, the remaining characters will be a comma-separated list of days of the month. If fixed week days, the next character will represent type of frequency (Every, EveryOther, First, etc.). Then a pipe follows. The last character will be the day of the week (0 for Sunday, 1 for Monday, etc.).
21	CanChargeWhenNoBal	tinyint(4)	Set true to indicate the Credit Card in question can be charged when the Patient account balance is $0, which corresponds directly to a preference called "RecurringChargesAllowedWhenPatNoBal" (true by default) which must be turned on via Module>Account>Misc to be available.
22	PaymentType	bigint(20)	FK to definition.DefNum. Payment type override for recurring charges.
23	IsRecurringActive	tinyint(4)	True by default. Set to false to inactivate this specific credit card from the recurring charges (both manual and via the service).
24	Nickname	varchar(255)	Nickname or alias. Currently only used in Web API for PaySimple.
25	CardHolderName	varchar(255)	The card holder name associated with the credit card. Not used by all merchant services.

custrefentry
For internal use only.
Order	Name	Type	Summary
0	CustRefEntryNum	bigint(20)	Primary key.
1	PatNumCust	bigint(20)	FK to patient.PatNum. The customer seeking a reference.
2	PatNumRef	bigint(20)	FK to patient.PatNum. The chosen reference. This is the customer who was given as a reference to the new customer.
3	DateEntry	date	Date the reference was chosen.
4	Note	varchar(255)	Notes specific to this particular reference entry, mostly for a special reference situation.

custreference
One to one relation with the patient table representing each customer as a reference.
Order	Name	Type	Summary
0	CustReferenceNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateMostRecent	date	Most recent date the reference was used, loosely kept updated.
3	Note	varchar(255)	Notes specific to this customer as a reference.
4	IsBadRef	tinyint(4)	Set to true if this customer was a bad reference.

cvx
Vaccines administered. Other tables generally use the CvxCode as their foreign key.
Order	Name	Type	Summary
0	CvxNum	bigint(20)	Primary key. .
1	CvxCode	varchar(255)	Cvx code. Not allowed to edit this column once saved in the database.
2	Description	varchar(255)	Short Description provided by Cvx documentation.
3	IsActive	varchar(255)	Not currently in use. Might not need this column. If we use this in the future, then convert from string to bool. 1 if the code is an active code, 0 if the code is inactive.

dashboardar
A table just used by the dashboard to store historical AR because it never changes and it takes too long (1 second for each of the 12 dates) to compute on the fly. One entry per month going back at least 12 months. This table gets automatically filled the first time that the dashboard is used. The most recent month also gets added by using the dashboard.
Order	Name	Type	Summary
0	DashboardARNum	bigint(20)	Primary key.
1	DateCalc	date	This date will always be the last day of a month.
2	BalTotal	double	Bal_0_30+Bal_31_60+Bal_61_90+BalOver90 for all patients. This should also exactly equal BalTotal for all patients with positive amounts. Negative BalTotals are credits, not A/R.
3	InsEst	double	Sum of all InsEst for all patients for the month.

dashboardcell
Each DashboardLayout can include multiple DashboardCell(s). DashboardLayout and DashboardCell work in conjunction to form the dashboard layout.
Order	Name	Type	Summary
0	DashboardCellNum	bigint(20)	PK.
1	DashboardLayoutNum	bigint(20)	FK to dashboardlayout.DashboardLayoutNum. This foreign key object will include the 0 based DashboardTabOrder, which is used to place this DashboardCell.
2	CellRow	int(11)	The row to which this DashboardCell belongs. 0 based.
3	CellColumn	int(11)	The column to which this DashboardCell belongs. 0 based.
4	CellType	varchar(255)	Enum:DashboardCellType Determines what type of control will be docked in this cell.
NotDefined:
ProductionGraph:
IncomeGraph:
AccountsReceivableGraph:
NewPatientsGraph:
BrokenApptGraph:
HQMtMessage: HQ only. Will not be saved to DashboardCell table.
HQBillingInboundOutbound: HQ only. Will not be saved to DashboardCell table.
HQBillingUsageAccess: HQ only. Will not be saved to DashboardCell table.
HQMoMessage: HQ only. Will not be saved to DashboardCell table.
HQPhone: HQ only. Will not be saved to DashboardCell table.
HQSignups: HQ only. Will not be saved to DashboardCell table.
5	CellSettings	text	Typically a serialized string that the control will accept in order to change view attributes.
6	LastQueryTime	datetime	Not used yet. Timestamp at which the cached data behind this cell was last retrieved.
7	LastQueryData	text	Not used yet. Cached data behind this cell.
8	RefreshRateSeconds	int(11)	Not used yet. Frequency at which the cached data behind this cell should be retrieved.

dashboardlayout
Each tab in the dashboard has a corresponding DashboardLayout. DashboardLayout and DashboardCell work in conjunction to form the dashboard layout.
Order	Name	Type	Summary
0	DashboardLayoutNum	bigint(20)	PK.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	UserGroupNum	bigint(20)	FK to usergroup.UserGroupNum.
3	DashboardTabName	varchar(255)	Text shown in the tab header.
4	DashboardTabOrder	int(11)	Orders the tabs in the tab control. 0 based.
5	DashboardRows	int(11)	Number of rows for this DashboardLayout. Min value of 1.
6	DashboardColumns	int(11)	Number of columns for this DashboardLayout. Min value of 1.
7	DashboardGroupName	varchar(255)	Groups multiple DashboardLayout(s) together.

databasemaintenance
Order	Name	Type	Summary
0	DatabaseMaintenanceNum	bigint(20)	Primary key.
1	MethodName	varchar(255)	The name of the databasemaintenance name.
2	IsHidden	tinyint(4)	Set to true to indicate that the method is hidden.
3	IsOld	tinyint(4)	Set to true to indicate that the method is old.
4	DateLastRun	datetime	Updates the date and time they run the method.

dbmlog
Order	Name	Type	Summary
0	DbmLogNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum. This is the assigned user dbm log.
2	FKey	bigint(20)	Foreign key to any table defined in the DbmLogType Enumeration.
3	FKeyType	tinyint(4)	Enum:DbmLogFKeyType The type of log.
None: This means FKey should be 0.
Appointment: This means FKey will link to AptNum.
AutoCode: This means FKey will link to AutoCodeNum.
Automation: This means FKey will link to AutomationNum.
Benefit: This means FKey will link to BenefitNum.
Carrier: This means FKey will link to CarrierNum.
Claim: This means FKey will link to ClaimNum.
ClaimPayment: This means FKey will link to ClaimPaymentNum.
ClaimProc: This means FKey will link to ClaimProcNum.
Clinic: This means FKey will link to ClinicNum.
CreditCard: This means FKey will link to CreditCardNum.
DiscountPlanSub: This means FKey will link to DiscountPlanSub.
Etrans: This means FKey will link to EtransNum.
Fee: This means FKey will link to FeeNum.
FeeSched: This means FKey will link to FeeSchedNum.
InsPlan: This means FKey will link to PlanNum.
InsSub: This means FKey will link to InsSubNum.
PatPlan: This means FKey will link to PatPlanNum.
Patient: This means FKey will link to PatNum.
Payment: This means FKey will link to PayNum.
PayPlan: This means FKey will link to PayPlanNum.
PayPlanCharge: This means FKey will link to PayPlanChargeNum.
PaySplit: This means FKey will link to PaySpliteNum.
PlannedAppt: This means FKey will link to PlannedApptNum.
Procedure: This means FKey will link to ProcNum.
Securitylog: This means FKey will link to SecurityLogNum.
HistAppointment: This means FKey will link to HistApptNum.
ProcedureCode: This means FKey will link to CodeNum.
ToothInitial: This means FKey will link to ToothInitialNum
Provider: This means FKey will link to ProvNum
4	ActionType	tinyint(4)	Enum:DbmLogActionType The type of verification.
Insert: 0. This means the action done was an Insert.
Update: 1. This means the action done was an Update
Delete: 2. This means the action done was a Delete
5	DateTimeEntry	datetime	DateTime the row was added.
6	MethodName	varchar(255)	The name of the DBM that created this row.
7	LogText	text	The description of exactly what was done.

definition
The info in the definition table is used by other tables extensively. Almost every table in the database links to definition. Almost all links to this table will be to a DefNum. Using the DefNum, you can find any of the other fields of interest, usually the ItemName. Make sure to look at the Defs class to see how the definitions are used. Loaded into memory ahead of time for speed.
Order	Name	Type	Summary
0	DefNum	bigint(20)	Primary key.
1	Category	tinyint	Enum:DefCat
AccountColors: 0- Colors to display in Account module.
AdjTypes: 1- Adjustment types.
ApptConfirmed: 2- Appointment confirmed types.
ApptProcsQuickAdd: 3- Procedure quick add list for appointments. Example: D1023,D1024. Single tooth numbers are allowed, example D1151#8,D0220#15. This is really only useful for PAs. Tooth number is stored in user's nomenclature, not American numbering.
BillingTypes: 4- Billing types.
ClaimFormats: 5- Not used.
DunningMessages: 6- Not used.
FeeSchedNamesOld: 7- Not used.
MedicalNotes: 8- Not used.
OperatoriesOld: 9- Not used.
PaymentTypes: 10- Payment types.
ProcCodeCats: 11- Procedure code categories.
ProgNoteColors: 12- Progress note colors.
RecallUnschedStatus: 13- Statuses for recall, reactivation, unscheduled, and next appointments.
ServiceNotes: 14- Not used.
DiscountTypes: 15- Not used.
Diagnosis: 16- Diagnosis types.
AppointmentColors: 17- Colors to display in the Appointments module.
ImageCats: 18- Image categories. ItemValue can be one or more of the following, no delimiters. X = Show in Chart Module, M=Show Thumbnails, F = Show in Patient Forms, L = Show in Patient Portal, P = Show in Patient Pictures, S = Statements, T = Graphical Tooth Charts, R = Treatment Plans, E = Expanded, A = Payment Plans, C = Claim Attachments, B = Lab Cases, U = Autosave Forms, Y = Task Attachments, N = Claim Responses.
ApptPhoneNotes: 19- Not used.
TxPriorities: 20- Treatment plan priority names.
MiscColors: 21- Miscellaneous color options. See enum DefCatMisColors.
ChartGraphicColors: 22- Colors for the graphical tooth chart.
ContactCategories: 23- Categories for the Contact list.
LetterMergeCats: 24- Categories for Letter Merge.
BlockoutTypes: 25- Types of Schedule Blockouts.
ProcButtonCats: 26- Categories of procedure buttons in Chart module
CommLogTypes: 27- Types of commlog entries.
SupplyCats: 28- Categories of Supplies
PaySplitUnearnedType: 29- Types of unearned income used in accrual accounting.
Prognosis: 30- Prognosis types.
ClaimCustomTracking: 31- Custom Tracking, statuses such as 'review', 'hold', 'riskmanage', etc.
InsurancePaymentType: 32- PayType for claims such as 'Check', 'EFT', etc.
TaskPriorities: 33- Categories of priorities for tasks.
FeeColors: 34- Categories for fee override colors.
ProviderSpecialties: 35- Provider specialties. General, Hygienist, Pediatric, Primary Care Physician, etc.
ClaimPaymentTracking: 36- Reason why a claim proc was rejected. This must be set on each individual claim proc.
AccountQuickCharge: 37- Procedure quick charge list for patient accounts.
InsuranceVerificationStatus: 38- Insurance verification status such as 'Verified', 'Unverified', 'Pending Verification'.
Regions: 39- Regions that clinics can be assigned to.
ClaimPaymentGroups: 40- ClaimPayment Payment Groups.
AutoNoteCats: 41 - Auto Note Categories. Used to categorize autonotes into custom categories.
WebSchedNewPatApptTypes: 42 - Web Sched New Patient Appointment Types. Displays in Web Sched. Each appointment can be assigned one appointment.AppointmentTypeNum. Multiple AppointmentTypes are linked to this definition through the DefLink table, where deflink.DefNum=definition.DefNum, deflink.LinkType=2, and deflink.FKey=appointmenttype.AppointmentTypeNum.
ClaimErrorCode: 43 - Custom Claim Status Error Code.
ClinicSpecialty: 44 - Specialties that clinics perform. Useful for separating patient clones across clinics.
JobPriorities: 45 - HQ Only job priorities.
CarrierGroupNames: 46 - Carrier Group Name.
PayPlanCategories: 47 - PayPlanCategory
AutoDeposit: 48 - Associates an insurance payment to an account number. Currently only used with "Auto Deposits".
InsuranceFilingCodeGroup: 49 - Code Group used for insurance filing.
TimeCardAdjTypes: 50 - Time card adjustment types. Currently for PTO, but in future could be used for other types as well if we implement the Usage def field.
WebSchedExistingApptTypes: 51 - Web Sched Existing Appt Types. Each appointment can be assigned one appointment.AppointmentTypeNum. Multiple AppointmentTypes are linked to this definition through the DefLink table, where deflink.DefNum=definition.DefNum, deflink.LinkType=2, and deflink.FKey=appointmenttype.AppointmentTypeNum.
CertificationCategories: 52 - Categories for the Certifications feature.
EClipboardImageCapture: 53 - Images the office prompts the patient to submit when checking in via eClipboard
TaskCategories: 54 - Task categories.
OperatoryTypes: 55 - Operatory Types. This field is only informational. The value isn't used for functionality.
2	ItemOrder	smallint	Order that each item shows on various lists. 0-indexed.
3	ItemName	varchar(255)	Each category is a little different. This field is usually the common name of the item.
4	ItemValue	varchar(255)	This field can be used to store extra info about the item. Used extensively by ImageCategories to store single letter codes.
5	ItemColor	int(11)	Some categories include a color option.
6	IsHidden	tinyint	If hidden, the item will not show on any list, but can still be referenced.

deflink
This table holds rows for linking a definition object to another object. Allows for a many-to-many relationship between definitions and other object types.
Order	Name	Type	Summary
0	DefLinkNum	bigint(20)	Primary key.
1	DefNum	bigint(20)	FK to definition.DefNum. The definition that is linked to
2	FKey	bigint(20)	A foreign key to a table associated with the DefLinkType. Uses include: ClinicNum with DefLinkType ClinicSpecialty, PatNum with DefLinkType Patient.
3	LinkType	tinyint(4)	Enum:DefLinkType The type of link.
ClinicSpecialty: 0. Specialties for a clinic.
Patient: 1. One definition of Category DefCat.ClinicSpecialty is linked to one patient.PatNum. This is how specialties are assigned to patient clones.
AppointmentType: 2. One definition can be linked to multiple appointment types. See definition.Category: DefCat.WebSchedNewPatApptTypes and WebSchedExistingApptTypes
Operatory: 3. One definition can be linked to multiple operatories where definition.Category=(DefCat.WebSchedNewPatApptTypes(42) or WebSchedExistingApptTypes(51)), deflink.DefNum=definition.DefNum, deflink.LinkType=3, and deflink.FKey=operatory.OperatoryNum.
BlockoutType: 4. The definition is linked to another definition that is in the BlockoutType category. Used by WebSched for restricting available time slots.
RecallType: 5. The definition is linked to a recall type. Used by WebSched for identifying available time slots for recalls.

deletedobject
When some objects are deleted, we sometimes need a way to track them for synching purposes. Other objects already have fields for IsHidden or PatStatus which track deletions just fine. Those types of objects will not use this table.
Order	Name	Type	Summary
0	DeletedObjectNum	bigint(20)	Primary key.
1	ObjectNum	bigint(20)	Foreign key to a number of different tables, depending on which type it is.
2	ObjectType	int(11)	Enum:DeletedObjectType
Appointment: 0
ScheduleProv: 1 - A schedule object. Only provider schedules are tracked for deletion.
RecallPatNum: 2 - When a recall row is deleted, this records the PatNum for which it was deleted.
RxPat: Deprecated
LabPanel: Deprecated
LabResult: Deprecated
DrugUnit: Deprecated
Medication: Deprecated
MedicationPat: Deprecated
Allergy: Deprecated
AllergyDef: Deprecated
Disease: Deprecated
DiseaseDef: Deprecated
ICD9: Deprecated
Provider: Deprecated
Pharmacy: Deprecated
Statement: Deprecated
Document: Deprecated
Recall: Deprecated
3	DateTStamp	timestamp	Updated any time the row is altered in any way.

deposit
A deposit slip. Contains multiple insurance and patient checks.
Order	Name	Type	Summary
0	DepositNum	bigint(20)	Primary key.
1	DateDeposit	date	The date of the deposit.
2	BankAccountInfo	text	User editable. Usually includes name on the account and account number. Possibly the bank name as well.
3	Amount	double	Total amount of the deposit. User not allowed to directly edit.
4	Memo	varchar(255)	Short description to help identify the deposit.
5	Batch	varchar(25)	Holds the batch number for the deposit. Does not have a default value. 25 character limit.
6	DepositAccountNum	bigint(20)	FK to definition.DefNum. Links this deposit to a definition of type AutoDeposit. When set to a valid value, it indicates that this deposit is an "auto deposit".
7	IsSentToQuickBooksOnline	tinyint(4)	Bool that indicates of a deposit has already been sent via QuickBooks Online. Defaults to false. Only true when successfully sent from FormDepositEdit.cs

dictcustom
Spell check custom dictionary, shared by the whole office.
Order	Name	Type	Summary
0	DictCustomNum	bigint(20)	Primary key.
1	WordText	varchar(255)	No space or punctuation allowed.

discountplan
Discount plans will automatically create adjustments when procedures are completed. The fee schedule associated to the discount plan will be used with the UCR fee schedule in order to determine the "discount". The associated DefNum will be the adjustment type that is used so that users can quickly query adjustments to see discount plan usage.
Order	Name	Type	Summary
0	DiscountPlanNum	bigint(20)	Primary key
1	Description	varchar(255)	Description of this discount plan
2	FeeSchedNum	bigint(20)	FK to feesched.FeeSchedNum
3	DefNum	bigint(20)	FK to definition.DefNum. Represents the adjustment type of the feesched plan.
4	IsHidden	tinyint(4)	Set true to hide in Discount Plan list.
5	PlanNote	text	Note for this plan.
6	ExamFreqLimit	int(11)	Number of Procedures allowed for a discount plans Exam category.
7	XrayFreqLimit	int(11)	Number of Procedures allowed for a discount plans X-Ray category.
8	ProphyFreqLimit	int(11)	Number of Procedures allowed for a discount plans Prophylaxis category.
9	FluorideFreqLimit	int(11)	Number of Procedures allowed for a discount plans Fluoride category.
10	PerioFreqLimit	int(11)	Number of Procedures allowed for a discount plans Periodontal category.
11	LimitedExamFreqLimit	int(11)	Number of Procedures allowed for a discount plans Limited Exam category.
12	PAFreqLimit	int(11)	Number of Procedures allowed for a discount plans Periapical X-Ray category.
13	AnnualMax	double	Annual discount maximum for frequency limitations. -1 indicates blank or no annual max limitation.

discountplansub
Table used to determine discount plan subscribers, as well as the effective date range of a discount plan.
Order	Name	Type	Summary
0	DiscountSubNum	bigint(20)	PK
1	DiscountPlanNum	bigint(20)	FK to discountplan.DiscountPlanNum, represents which plan the patient is subscribed to.
2	PatNum	bigint(20)	FK to patient.PatNum which represents the subscriber
3	DateEffective	date	When the discount plan should start to impact procedure fees.
4	DateTerm	date	When the discount plan should no longer impact procedure fees.
5	SubNote	text	Note for this sub.

disease
Each row is one disease that one patient has. Now called a problem in the UI. Must have a DiseaseDefNum.
Order	Name	Type	Summary
0	DiseaseNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	DiseaseDefNum	bigint(20)	FK to diseasedef.DiseaseDefNum. The disease description is in that table.
3	PatNote	text	Any note about this disease that is specific to this patient. When importing from eForms, this is where the disease name goes for "Other" when there's no match.
4	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.
5	ProbStatus	tinyint(4)	Enum:ProblemStatus Active=0, Resolved=1, Inactive=2.
Active: 0
Resolved: 1
Inactive: 2
6	DateStart	date	Date that the disease was diagnosed. Can be minval if unknown.
7	DateStop	date	Date that the disease was set resolved or inactive. Will be minval if still active. ProbStatus should be used to determine if it is active or not.
8	SnomedProblemType	varchar(255)	FK to snomed.SnomedCode. Used in EHR CCD export/import only. Must be one of the following SNOMED codes: Problem/Concern (55607006 or blank), Finding (404684003), Complaint (409586006), Dignosis (282291009), Condition (64572001), FunctionalLimitation (248536006), Symptom (418799008).
9	FunctionStatus	tinyint(4)	Enum:FunctionalStatus Used to export EHR CCD functional status and/or cognitive status information only.
Problem: 0 - Default value. If not using EHR, then each diseasedef will use this value.
CognitiveResult: 1 - This clinical statement contains details of an evaluation or assessment of a patient’s cognitive status. The evaluation may include assessment of a patient's mood, memory, and ability to make decisions. The statement will include, if present, supporting caregivers, non-medical devices, and the time period for which the evaluation and assessment were performed.
CognitiveProblem: 2 - A cognitive status problem observation is a clinical statement that describes a patient's cognitive condition, findings or symptoms. Examples of cognitive problem observations are inability to recall, amnesia, dementia, and aggressive behavior. A cognitive problem observation is a finding or medical condition. This is different from a cognitive result observation, which is a response to a question that provides insight to the patient's cognitive status. It reflects findings that provide information about a medical condition, while a result observation reflects responses to questions in a cognitive test or those that provide information about a person's judgement, comprehension ability, and response speed.
FunctionalResult: 3 - This clinical statement represents details of an evaluation or assessment of a patient’s functional status. The evaluation may include assessment of a patient's language, vision, hearing, activities of daily living, behavior, general function, mobility and self-care status. The statement will include, if present, supporting caregivers, non-medical devices, and the time period for which the evaluation and assessment were performed.
FunctionalProblem: 4 - A functional status problem observation is a clinical statement that represents a patient’s functional perfomance and ability.

diseasedef
A list of diseases that can be assigned to patients. Cannot be deleted if in use by any patients.
Order	Name	Type	Summary
0	DiseaseDefNum	bigint(20)	Primary key.
1	DiseaseName	varchar(255)	.
2	ItemOrder	smallint	0-based. The order that the diseases will show in various lists.
3	IsHidden	tinyint	If hidden, the disease will still show on any patient that it was previously attached to, but it will not be available for future patients.
4	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.
5	ICD9Code	varchar(255)	FK to icd9.Icd9Code. Example: 250.00 for diabetes. User not allowed to enter any string anymore, must pick one from the Icd9Code table. Some may exist in the databases without linking to a valid Icd9Code table entry if the ConvertDatabase could not find the user typed string in the list of valid Icd9Codes.
6	SnomedCode	varchar(255)	FK to snomed.SnomedCode. Example: 230572002 for diabetic neuropathy. User not allowed to enter any string anymore, must pick from the Snomed table. Some may exist in the databases without linking to a valid Snomed table entry if the ConvertDatabase could find the user typed string in the list of valid SnomedCodes.
7	Icd10Code	varchar(255)	FK to icd10.Icd10Code. Example: E10.1 for 'Type 1 diabetes mellitus with ketoacidosis'. User not allowed to enter any string anymore, must pick one from the Icd10Code table.

displayfield
Allows customization of which fields display in various lists and grids. For now, the only grid is ProgressNotes. Will also eventually let users set column widths and translate titles. For now, the selections are the same for all computers.
Order	Name	Type	Summary
0	DisplayFieldNum	bigint(20)	Primary key.
1	InternalName	varchar(255)	This is the internal name that OD uses to identify the field within this category. This will be the default description if the user doesn't specify an alternate in Description. For Ortho chart, this column will be "Signature", "Provider", or blank. For SuperFamilyGridCols, if this is a patfield column, then this will be blank.
2	ItemOrder	int(11)	Order to display in the grid or list. Every entry must have a unique itemorder.
3	Description	varchar(255)	Optional alternate description to display for field. Can be in another language. For Ortho, this is the 'key', since InternalName is blank sometimes. For SuperFamilyGridCols, if this is a patfield column, then this will be the name of the patfield.FieldName.
4	ColumnWidth	int(11)	For grid columns, this lets user override the column width. Especially useful for foreign languages.
5	Category	int(11)	Enum:DisplayFieldCategory If category is 0, then this is attached to a ChartView.
None: 0- Badly named. This should be called Progress Notes.
PatientSelect: 1
PatientInformation: 2- Family module.
AccountModule: 3
RecallList: 4
ChartPatientInformation: 5
ProcedureGroupNote: 6
TreatmentPlanModule: 7
OrthoChart: 8
AppointmentBubble: 9
AccountPatientInformation: 10- Account module patient information
StatementMainGrid: 11
FamilyRecallGrid: 12
AppointmentEdit: 13
PlannedAppointmentEdit: 14
OutstandingInsReport: 15
CEMTSearchPatients: 16
ArManagerSentGrid: 17 - A/R Manager Sent Grid
ArManagerUnsentGrid: 18 - A/R Manager Unsent Grid
ArManagerExcludedGrid: 19 - A/R Manager Excluded Grid
LimitedCustomStatement: 20 - Statement Limited Custom SuperFamily
SuperFamilyGridCols: 21 - SuperFamily Grid
6	ChartViewNum	bigint(20)	FK to chartview.ChartViewNum. 0 if attached to a category.
7	PickList	text	Newline delimited string which contains the selectable options in combo box dropdowns. Specifically for the Ortho chart.
8	DescriptionOverride	varchar(255)	Only used in Ortho and SuperFamilyGridCols (PatField). Ortho chart display fields utilize the InternalName field for Signature and Provider indicators, this field is here to override description. Some users want to use different fields but use the same description for multiple tabs. Example: The display field of WeightWeekly shows as "Weight" and in another tab the field for WeightMonthly can also show as "Weight".

displayreport
One row per standard report.
Order	Name	Type	Summary
0	DisplayReportNum	bigint(20)	Primary key.
1	InternalName	varchar(255)	.
2	ItemOrder	int(11)	.
3	Description	varchar(255)	.
4	Category	tinyint(4)	Enum:DisplayReportCategory 0 - ProdInc; 1 - Daily, 2 - Monthly, 3 - Lists, 4 - PublicHealth, 5 - ArizonaPrimaryCare.
ProdInc: 0 - Production and Income reports
Daily: 1 - Daily reports
Monthly: 2 - Monthly reports
Lists: 3 - List reports
PublicHealth: 4 - Public Health reports
ArizonaPrimaryCare: 5 - Arizona Primary care reports
5	IsHidden	tinyint(4)	.
6	IsVisibleInSubMenu	tinyint(4)	When true and IsHidden is false, will show this report in a pop out sub menu.

dispsupply
A dental supply or office supply item that has been dispensed.
Order	Name	Type	Summary
0	DispSupplyNum	bigint(20)	Primary key.
1	SupplyNum	bigint(20)	FK to supply.SupplyNum
2	ProvNum	bigint(20)	FK to provider.ProvNum
3	DateDispensed	date	
4	DispQuantity	float	Quantity given out.
5	Note	text	Notes on the dispensed supply.

document
Represents a single document in the imaging module.
Order	Name	Type	Summary
0	DocNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of the document.
2	DateCreated	datetime	Date and time. Can be edited by user, but not forward dated without that permission.
3	DocCategory	bigint(20)	FK to definition.DefNum. Categories for documents. 0 for ChartLetters.
4	PatNum	bigint(20)	FK to patient.PatNum. The document will be located in the patient folder of this patient.
5	FileName	varchar(255)	The name of the file. Does not include any directory info.
6	ImgType	tinyint	Enum:ImageType Document, Radiograph, Photo, File, Attachment.
Document: 0- Includes scanned documents and screenshots.
Radiograph: 1
Photo: 2
File: 3- For instance a Word document or a spreadsheet. Not an image.
Attachment: 4- Used for Claim Attachments. Preserves original resolution.
7	IsFlipped	tinyint	True if flipped horizontally. A vertical flip would be stored as a horizontal flip plus a 180 rotation.
8	DegreesRotated	float	Any positive or negative, including decimals.
9	ToothNumbers	varchar(255)	An optional list of tooth numbers. In Db, rigorously formatted as American numbers, and separated by commas. For display, uses hyphens for sequences. Very likely supports international tooth numbers, but not tested for that.
10	Note	mediumtext	MediumText, so max length=16M for API upload base64.
11	SigIsTopaz	tinyint	True if the signature is in Topaz format rather than OD format.
12	Signature	text	The encrypted and bound signature in base64 format. The signature is bound to the byte sequence of the original image. Signature for ChartLetter is also bound to bytes of Word doc, but it might be a slightly different algorithm than non-ChartLetters.
13	CropX	int(11)	Crop rectangle X. May be negative. First, image is rotated as needed around center. Then, clipped to this crop rectangle. X-Y is center of the crop rectangle relative to center of the image, and where positive is to the upper right of the center of the image.
14	CropY	int(11)	Crop rectangle Y. May be negative. First, image is rotated as needed around center. Then, clipped to this crop rectangle. X-Y is center of the crop rectangle relative to center of the image, and where positive is to the upper right of the center of the image.
15	CropW	int(11)	Crop rectangle Width in original image pixel scale. May be zero if no cropping. May be greater than original image width.
16	CropH	int(11)	Crop rectangle Height in original image pixel scale. May be zero if no cropping. May be greater than original image height.
17	WindowingMin	int(11)	The lower value of the "windowing" (contrast/brightness) for radiographs. Default is 0. Max is 255.
18	WindowingMax	int(11)	The upper value of the "windowing" (contrast/brightness) for radiographs. Default is 0(no windowing). Max is 255. For 12 bit images with a max of 4096, the same max of 255 is used here, but it's just scaled proportionally (x16).
19	MountItemNum	bigint(20)	FK to mountitem.MountItemNum. If set, then this image will only show on a mount, not in the main tree. If set to 0, then no mount item is associated with this document.
20	DateTStamp	timestamp	Date/time last altered.
21	RawBase64	mediumtext	The raw file data encoded as base64. Only used if there is no AtoZ folder.
22	Thumbnail	text	Thumbnail encoded as base64. Only present if not using AtoZ folder. 100x100 pixels, jpg, takes around 5.5k.
23	ExternalGUID	varchar(255)	The primary key associated to a document hosted on an external source.
24	ExternalSource	varchar(255)	Enum:ExternalSourceType None, Dropbox, XVWeb. The source for the corresponding ExternalGUID.
None: This is a document that is not stored in an external source. All documents stored by Open Dental will be this type.
Dropbox: This document can be found in a corresponding Dropbox account.
XVWeb: This document is saved from a download from XVWeb program link.
25	ProvNum	bigint(20)	FK to provider.ProvNum. Optional. Used for radiographs and ChartLetters.
26	IsCropOld	tinyint	Set to true as part of conversion to 21.4. Set back to false once the crop is converted to the new scheme. It would take too long to do this conversion in the normal script because it involves loading each image to obtain width and height. So this is a lazy conversion.
27	OcrResponseData	text	Stores a JSON serialized OcrInsScanResponse object. The type of this object is defined by the OcrCaptureType.
28	ImageCaptureType	tinyint(4)	Enum:EnumOcrCaptureType 0=Miscellaneous, 1=PrimaryInsFront, 2=PrimaryInsBack, 3=SecondaryInsFront, 4=SecondaryInsBack. Only used when patient scans their insurance card from eClipboard.
Miscellaneous: 0- Catch-All type for imageCaptures without unique behavior
PrimaryInsFront: 1
PrimaryInsBack: 2
SecondaryInsFront: 3
SecondaryInsBack: 4
29	PrintHeading	tinyint(4)	Set true by default for radiographs and tooth charts. When set to true, it will print additional heading text including patient name, DOB, and today's date.
30	ChartLetterStatus	tinyint(4)	If not 0, this document is a Chart Letter. It will only show in the Chart Module and not in the Imaging Module. The document will be a Word document based on a template. The intent is for it to be used for very complex chart notes. It could then be sent to the referring dentist, for example. DocCategory will be 0 for these which naturally hides them in Imaging module. Like a procnote, a chart letter cannot actually be edited or deleted. All edits are preserved for audit trail and a copy is made for each edit.
31	UserNum	bigint(20)	FK to userod.UserNum. Only used when DocChartLetterStatus > 0. Tracks which user made the change.
32	ChartLetterHash	varchar(255)	Only used for ChartLetter. Every time a Word document is saved, we create a new document row with this hash tied to the byte sequence of that Word document. This proves that it was unaltered. The hash is 16 bytes, but we want a human-readable version. So we convert each byte to a two char hex string. So this field will always be 32 characters without any spaces or punc.

documentmisc
For storing docs/images in database. This table is for the various miscellaneous documents that are not in the normal patient subfolders.
Order	Name	Type	Summary
0	DocMiscNum	bigint(20)	Primary key.
1	DateCreated	date	Date created.
2	FileName	varchar(255)	The name the file would have if it was not in the database. Does not include any directory info. DocumentMisc rows that store the contents of the UpdateFiles folder will set this column to an "item order". Due to severe limitations with sending large amounts of data all in one query we are going to store the UpdateFiles over several rows. The FileName column will store the order of which the UpdateFiles need to go back into when we try to reconstruct it.
3	DocMiscType	tinyint(4)	Enum:DocumentMiscType Corresponds to the same subfolder within AtoZ folder. eg. UpdateFiles
UpdateFiles: 0- There will just be zero or one row of this type. It will contain a zipped archive.
UpdateFilesSegment: 1- Entries with this doc type hold segments of the UpdateFiles RawBase64 zip contents that will be pieced back together later. Storing the entire Update Files contents into one row was exceeding MySQL max_allowed_packet limitations so this new type is required. Each row of this type will contain ~1MB of RawBase64 data.
ShareScreenExeSegment: 2- Entires of this doc type are segments of OpenDentalShareScreen.exe from our website. File names are formatted like version{guid}segment# (ex 12.11.2022.501{45e744a7-f6dd-4e55-9f9f-11d1f746eefe}13). An OpenDentalShareScreen.exe is complete when a record is present without a segment# (ex 12.11.2022.501{45e744a7-f6dd-4e55-9f9f-11d1f746eefe}).
4	RawBase64	longtext	The raw file data encoded as base64.

drugmanufacturer
Manufacturer of a vaccine.
Order	Name	Type	Summary
0	DrugManufacturerNum	bigint(20)	Primary key.
1	ManufacturerName	varchar(255)	.
2	ManufacturerCode	varchar(20)	An abbreviation of the manufacturer name.

drugunit
And other kinds of units. We will only prefill this list with units needed for the tests. Users would have to manually add any other units.
Order	Name	Type	Summary
0	DrugUnitNum	bigint(20)	Primary key.
1	UnitIdentifier	varchar(20)	Example ml, capitalization not critical. Usually entered as lowercase except for L.
2	UnitText	varchar(255)	Example milliliter.

dunning
A message that will show on certain patient statements when printing bills. Criteria must be met in order for the dunning message to show.
Order	Name	Type	Summary
0	DunningNum	bigint(20)	Primary key.
1	DunMessage	text	The actual dunning message that will go on the patient bill.
2	BillingType	bigint(20)	FK to definition.DefNum.
3	AgeAccount	tinyint	Program forces only 0,30,60,or 90.
4	InsIsPending	tinyint	Enum:YN Set Y to only show if insurance is pending.
Unknown: 0
Yes: 1
No: 2
5	MessageBold	text	A message that will be copied to the NoteBold field of the Statement.
6	EmailSubject	varchar(255)	An override for the default email subject.
7	EmailBody	mediumtext	An override for the default email body. Limit in db: 16M char.
8	DaysInAdvance	int(11)	The number of days before an account reaches AgeAccount to include this dunning message on statements. Example: If DaysInAdvance=3 and AgeAccount=90, an account that is 87 days old when bills are generated will include this message.
9	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
10	IsSuperFamily	tinyint(4)	Boolean. Is true when the message is specifically created for super families.

ebill
Keeps track of account details of e-statements per clinic.
Order	Name	Type	Summary
0	EbillNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum
2	ClientAcctNumber	varchar(255)	The account number for the e-statement client.
3	ElectUserName	varchar(255)	The user name for this particular account.
4	ElectPassword	varchar(255)	The password for this particular account.
5	PracticeAddress	tinyint(4)	Enum:EbillAddress
PracticePhysical: 0
PracticeBilling: 1
PracticePayTo: 2
ClinicPhysical: 3
ClinicBilling: 4
ClinicPayTo: 5
6	RemitAddress	tinyint(4)	Enum:EbillAddress
PracticePhysical: 0
PracticeBilling: 1
PracticePayTo: 2
ClinicPhysical: 3
ClinicBilling: 4
ClinicPayTo: 5

eclipboardimagecapture
Linker table between patients and the images they have submitted to the office via eClipboard. Lets office know when a patient last submitted a certain image. Is used in conjuction with EClipboardImageCaptureDef table to allow offices to set frequencies for how often patients should submit certain images, similar to sheets.
Order	Name	Type	Summary
0	EClipboardImageCaptureNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DefNum	bigint(20)	FK to def.DefNum. Should match a DefNum that that is in the in 'EClipboard Images' defcat. Will be zero when IsSelfPortrait.
3	IsSelfPortrait	tinyint(4)	Using DefNum to identify the self portrait is unreliable as the image category that is used to store self portraits may change. Instead, set this field to true for any image capture that is a self portrait. Only for self-portraits tied to the pref 'EClipboardAllowSelfPortraitOnCheckIn', not 'eClipboard Images' defcat.
4	DateTimeUpserted	datetime	Records the date and time the patient took the image. If patient has submitted this eclipboard image before, then we simply update the DateUpserted field and DocNum field. We do not insert an entirely new record.
5	DocNum	bigint(20)	FK to document.DocNum. If a document is deleted, need to also delete any record from this table with the same DocNum.
6	OcrCaptureType	tinyint(4)	Enum:EnumOcrCaptureType 0=Miscellaneous, 1=PrimaryInsFront, 2=PrimaryInsBack, 3=SecondaryInsFront, 4=SecondaryInsBack
Miscellaneous: 0- Catch-All type for imageCaptures without unique behavior
PrimaryInsFront: 1
PrimaryInsBack: 2
SecondaryInsFront: 3
SecondaryInsBack: 4

eclipboardimagecapturedef
Used to set rules for how often a patient should submit an image when checking in for their appointment via eClipboard. Example: insurance card or patient portrait. This is the grid on the right in eClipboard Images window.
Order	Name	Type	Summary
0	EClipboardImageCaptureDefNum	bigint(20)	Primary key.
1	DefNum	bigint(20)	FK to def.DefNum. Should match a DefNum that is in the in 'EClipboard Images' defcat. Will be zero when IsSelfPortrait.
2	IsSelfPortrait	tinyint(4)	True if the rule pertains to the patient self portrait. False if the rule is for an 'Eclipboard images' defcat definition.
3	FrequencyDays	int(11)	Deprecated.
4	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Clinic the rule pertains to.
5	OcrCaptureType	tinyint(4)	Enum:EnumOcrCaptureType 0=Miscellaneous, 1=PrimaryInsFront, 2=PrimaryInsBack, 3=SecondaryInsFront, 4=SecondaryInsBack
Miscellaneous: 0- Catch-All type for imageCaptures without unique behavior
PrimaryInsFront: 1
PrimaryInsBack: 2
SecondaryInsFront: 3
SecondaryInsBack: 4
6	Frequency	tinyint(4)	Enum:EnumEClipFreq 0=Once, 1=EachTime, 2=TimeSpan. The frequency that an image capture will be submitted by patients. ResubmitInterval can only be set if Frequency is TimeSpan.
Once: 0 - Each patient will submit this form or image capture exactly one time.
EachTime: 1 - Each patient will submit this form or image capture at every visit.
TimeSpan: 2 - Each patient will submit this form or image capture based on a specified time span measured in Years and Months.
7	ResubmitInterval	bigint(20)	If Frequency is EnumEClipFreq.TimeSpan, this will indicate the acceptable amount of time (measured in Years and Months) that can pass since the last time the patient has submitted this image capture.

eclipboardsheetdef
Holds settings for eClipboard. Each row is attached to one SheetDef or EFormDef. This table might typically only have 3 to 4 rows in it. There could be more for different clinics. This information helps the software decide whether or not to display a sheet or eForm for a specific patient based on certain criteria. Examples include MinAge, MaxAge, Frequency, and ResubmitInterval. Forms will also end up on the eClipboard if their sheet.ShowInTerminal is non-zero or eForm.Status=ReadyForPatientFill.
Order	Name	Type	Summary
0	EClipboardSheetDefNum	bigint(20)	Primary key.
1	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum. Can be zero if this row is for an eForm.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if no clinic or if default clinic.
3	ResubmitInterval	bigint(20)	If Frequency is EnumEClipFreq.TimeSpan, this will indicate the acceptable amount of time (measured in Years, Months, and Days) that can pass since the last time the patient has filled this form out. Once this has elapsed, if the EClipboardCreateMissingFormsOnCheckIn pref is turned on, this form will automatically be added to the patient forms to fill out when the patient is checked in.
4	ItemOrder	int(11)	The order in which the patient will be asked to fill out this form.
5	PrefillStatus	tinyint(4)	Determines how forms will be shown in eClipboard, blank or prefill. eForms are prefilled regardless. This flag just indicates whether to also attempt to fill non-db fields by using info from previous eForms.
6	MinAge	int(11)	Indicates the minimum age of the patient to be given the form to fill out. If their age is below the minimum limit, they will not be given the form to fill out. A value of -1 means ignore any age requirements.
7	MaxAge	int(11)	Indicates the maximum age of the patient to be given the form to fill out. If their age is over or equal to this maximum limit, they will not be given the form to fill out. A value of -1 means ignore any age requirements.
8	IgnoreSheetDefNums	text	Comma delimited list of sheetdef nums to ignore. This can only be set if the preFillStatus is set to Once. These sheetDefs are ignored until this sheet is filled out. For example, an office may have a sheet for new patients that is only filled out once. IgnoreSheetDefNums can be set to include the normal patient forms which will be ignored at first. Once the new patient has filled out this sheet, these other sheetDefs will no longer be ignored when the patient checks in again. Nothing like this for eForms yet.
9	PrefillStatusOverride	bigint(20)	For both Sheets and eForms. 0 by default. When saving a linked Def, the UI gives the user an option to update this field with the new RevID. It explains that this will cause all patients to have to fill out this form again, even though it's marked as Frequency Once. If this value is higher than the RevID of the last form the patient filled out, then the Def must have been updated in this manner and the patient will need to fill out the form again. Otherwise, it will be excluded.
10	EFormDefNum	bigint(20)	FK to eformdef.EFormDefNum. Can be zero if this row is for a sheet.
11	Frequency	tinyint(4)	Enum:EnumEClipFreq 0=Once, 1=EachTime, 2=TimeSpan. The frequency that a form will be submitted by patients. ResubmitInterval can only be set if Frequency is TimeSpan.
Once: 0 - Each patient will submit this form or image capture exactly one time.
EachTime: 1 - Each patient will submit this form or image capture at every visit.
TimeSpan: 2 - Each patient will submit this form or image capture based on a specified time span measured in Years and Months.
12	SheetDefNumsConsidered	varchar(255)	Comma-delimited list of sheetDefNums that will also be considered with this eForm when doing frequency calculations. This allows easy transition from sheets to eForms. The reason we allow multiple is because sheets were likely to have one form for new patients and a different form for existing patients. The code must be resilient enough to handle bad SheetNums here.

eduresource
EHR education resource. Only one of the 3 FK fields will be used at a time (DiseaseDefNum, MedicationNum, or LabResultID). The other two will be blank. Displays a clickable URL if the patient meets certain criteria.
Order	Name	Type	Summary
0	EduResourceNum	bigint(20)	Primary key.
1	DiseaseDefNum	bigint(20)	FK to diseasedef.DiseaseDefNum. This now also handles ICD9s and Snomeds via the entry in DiseaseDef.
2	MedicationNum	bigint(20)	FK to medication.MedicationNum.
3	LabResultID	varchar(255)	FK to labresult.TestID.
4	LabResultName	varchar(255)	Used for display in the grid.
5	LabResultCompare	varchar(255)	String, example <43. Must start with < or > followed by int. Only used if FK LabResultID is used.
6	ResourceUrl	varchar(255)	.
7	SmokingSnoMed	varchar(255)	FK to ehrmeasureevent.CodeValueResult when ehrmeasureevent.EventType=EhrMeasureEventType.TobaccoUseAssessed (8).

eform
EForms is a way for patients to fill out forms. This is similar to sheets, but optimized for dynamic layout instead of fixed layout. The office sets up templates, EFormDefs, which get copied to EForms. Each EForm is linked to one patient.
Order	Name	Type	Summary
0	EFormNum	bigint(20)	Primary key.
1	FormType	tinyint(4)	Enum:EnumEFormType 0=PatientForm, 1=MedicalHistory, 2=Consent. This doesn't actually do anything, and all fields are available for all types, but that might eventually change if more types are added.
PatientForm: 0 - Includes patient information and insurance information.
MedicalHistory: 1 -
Consent: 2 - .
2	PatNum	bigint(20)	FKey to patient.PatNum.
3	DateTimeShown	datetime	The date and time that show in the UI. Updated when the patient fills out and submits the eForm via eClipboard.
4	Description	varchar(255)	The title of the EForm. Copied from EFormDef.Description.
5	DateTEdited	datetime	The date and time when the EForm was lasted edited. Not editable by the user in the UI. Doesn't seem to actually be used for anything.
6	MaxWidth	int(11)	Required. Can be any value between 50 and 1000. On wide screens, this limits the width of the form. This is needed on pretty much anything other than a phone. Makes it look consistent across devices and prevents useless white space. Default 450.
7	EFormDefNum	bigint(20)	FKey to eformdef.EFormDefNum. Don't use this as a FK to an EFormDef normally because the original def is not guaranteed to be intact. Since it was just a template, it can easily have changed since the eForm was copied from the template. Think of it as a lightweight minimal reference just used for a few edge cases. This is only used alongside the eClipboardSheetDef table to determine if the patient has filled out that form yet. It's also used with the RevID to prefill fields that don't use a DbLink by pulling from a previous form. I think this also requires using the ReportableName for those fields.
8	Status	tinyint(4)	Enum:EnumEFormStatus 0-None, 1-ShowInEClipboard, 2-Filled, 3-Imported. In the None status, the office might be filling in the tooth number on a consent form. ShowInEClipboard status makes it show in eClipboard. Sheets use ShowInTerminal for this purpose. Once the patient has filled it, the status is changed to Filled. Sheets uses IsWebForm for this purpose. If a Filled eForm gets imported, then the status is changed to Imported.
None: 0 - If a form is added manually in OD proper and then filled out by the patient in OD proper, it will remain this status.
ShowInEClipboard: 1 - Forms with this status will show in eClipboard. Unlike sheets, there is no way to set order.
Filled: 2 - This status gets set from eClipboard after filling.
9	RevID	int(11)	Revision ID. Copied from EFormDef. See notes over there.
10	ShowLabelsBold	tinyint(4)	If true, then this form will show labels at 95% and slightly bold. This looks good, but some users might not want it for certain forms, so it's an option. This applies to text, date, radiobuttons, and sigBox. It does not apply to types label, checkbox, or medicationList.
11	SpaceBelowEachField	int(11)	The amount of space below each field. Overrides the global default and can be overridden by field.SpaceBelow. -1 indicates to use default. That way, 0 means 0 space.
12	SpaceToRightEachField	int(11)	The amount of space to the right of each field. Overrides the global default and can be overridden by field.SpaceToRight. -1 indicates to use default. That way, 0 means 0 space.
13	SaveImageCategory	bigint(20)	FK to definition.DefNum. This gets set when an EForm is created from an EFormDef. 0 for none or else it's set to an image category. User can change it. It only saves if user saves manually.

eformdef
EForms are a way for patients to fill out forms. This is similar to sheets, but optimized for dynamic layout instead of fixed layout. The office sets up templates, EFormDefs, which get copied to EForms. Since this is a template EForm, it does not link to a patient. It can be freely changed without affecting any EForms. We also supply internal EFormDefs, which are hard coded as XML rather than being in any office database.
Order	Name	Type	Summary
0	EFormDefNum	bigint(20)	Primary key.
1	FormType	tinyint(4)	Enum:EnumEFormType 0=PatientForm, 1=MedicalHistory, 2=Consent. This doesn't actually do anything, and all fields are available for all types, but that might eventually change if more types are added.
PatientForm: 0 - Includes patient information and insurance information.
MedicalHistory: 1 -
Consent: 2 - .
2	Description	varchar(255)	The title of the EFormDef. Set by the user.
3	DateTCreated	datetime	The date and time when the EFormDef was created. Not editable by the user in the UI.
4	IsInternalHidden	tinyint(4)	Deprecated.
5	MaxWidth	int(11)	Required. Can be any value between 50 and 1000. On wide screens, this limits the width of the form. This is needed on pretty much anything other than a phone. Makes it look consistent across devices and prevents useless white space. Default 450.
6	RevID	int(11)	Revision ID. Gets updated any time an eForm field is added or deleted from an eFormDef. This includes any time a translation is changed. See eClipboardSheetDef.PrefillStatusOverride for an explanation of how a new RevID can trigger patients needing to fill out a new form. This is also used to pull info from a previous form onto a new form. This can only be done when RevID of both forms is the same, and it's only for non-db fields. 0-based.
7	ShowLabelsBold	tinyint(4)	If true, then this form will show labels at 95% and slightly bold. This looks good, but some users might not want it for certain forms, so it's an option. This applies to text, date, radiobuttons, and sigBox. It does not apply to types label, checkbox, or medicationList.
8	SpaceBelowEachField	int(11)	The amount of space below each field. Overrides the global default and can be overridden by field.SpaceBelow. -1 indicates to use default. That way, 0 means 0 space.
9	SpaceToRightEachField	int(11)	The amount of space to the right of each field. Overrides the global default and can be overridden by field.SpaceToRight. -1 indicates to use default. That way, 0 means 0 space.
10	SaveImageCategory	bigint(20)	FK to definition.DefNum. There is a global setting to save forms to the image category which has ItemVal set to "U". We completely ignore that and it will only work for sheets. If this is 0, it will not save to images. Copied to EForm child.

eformfield
Individual fields for EForm. Each field generally includes a label and a value. Links to a EForm by FKey to eform.EFormNum. NOTE: If any new fields get added to this class and EFormFieldDef, make sure to add them to the methods EFormFields.FromDef and EFormFields.ToDef
Order	Name	Type	Summary
0	EFormFieldNum	bigint(20)	Primary key.
1	EFormNum	bigint(20)	FKey to eform.EFormNum
2	PatNum	bigint(20)	FKey to patient.PatNum to let us quickly grab all for a patient, and then loop later.
3	FieldType	tinyint(4)	Enum:EFormFieldType 0-TextField, 1-Label, 2-DateField, etc.
4	DbLink	varchar(255)	If this field is importable, then this links to a db field. The list of available fields for each type is in EFormFieldsAvailable. Users can pick from that lis which is the same list as in Sheets. In addition to those hardcoded values, this field can also contain custom PatFields. It's string-based instead of enum, just like Sheets, because it's too complex to use an enum, even for our reduced number of items. None is always represented in UI as "None" and in db as empty string. All DbLinks are available on all form types to give users more flexibility. Checkboxes can have DBLinks that look like "allergy:...", "med:...", or "problem:..."
5	ValueLabel	text	Used differently for different types: TextField, DateField, CheckBox: The label next to or above the textbox, or checkbox.RadioButtons: This label next to or above the group of radiobuttons. Labels on each radiobutton are in PickListVis.Label: This label is the only thing that shows. A label is always a WPF FlowDocument, which is an XML format. This allows extensive rich text formatting, like bold, color, paragraph formatting, etc. This format can be used directly in OD proper, but it will need to be converted for some other programming languages using external tools. BUT, prior to that, it must be run through a method that adjusts all the font sizes. FlowDocuments only support absolute font sizes instead of relative font sizes. We use 11.5 as the base font size and all other fonts are considered to be relative to this base. So if a font size of 13.8 is present in the FlowDocument, that does not mean to use 13.8; it instead means to use 120%. If your chosen base font size on a mobile device is 16, then the conversion method needs to convert the 13.8 to 19.2 prior to using the FlowDocument.PageBreak: Not used.SigBox: Optional label above sig box.MedicationList: This holds an EFormMedListLayout object, serialized as json, including the Title, column headers, column widths, etc.PatientList: This holds an EFormPatListLayout object, serialized as json, including Label.InsPick: This holds the label above the 3 radiobuttons.
6	ValueString	text	The data as entered by patient or pulled from the db. We do not need this in EFormFieldDef because that has no patient or db data. Used differently for different types: TextField: value in textBox. For allergiesOther, medsOther, and problemsOther, this is a comma-delimited list. Spaces by commas are ok. Like this: "Aspirin, Iodine, Latex"Label: Not used because no patient input.DateField: date in culture format, like 4/25/2024.Checkbox: "X" or blank "".RadioButton: String value chosen by patient. Pulled from PickListDb, not PickListVis. When importing, empty signifies that patient did not enter any choice, so do not import.ComboBox (not yet added): String value chosen by patient.SigBox: First char is 0 for our sigbox and 1 for Topaz. The remainder is the signature string. See OpenDentBusiness\UI\SignatureBoxWrapper.cs for details. Same format as used for all signatures in OD. Does not get imported.MedicationList: This holds a list of EFormMed objects, serialized as json.PatientList: This holds a PatNum representing the selected patient, if applicable. Example: "143". Can be blank.InsPick: If user picked None, this is empty. If user picked New, the value of this is "New". If user picked Existing, then this is either "InsSubNum:####" or "InsPendingNum:####". A live call to the db using one of those primary keys can derive all the other needed fields for read-only display.
7	ItemOrder	int(11)	0 based.
8	PickListVis	text	Pipe-delimited list of strings, used for radioButtons, InsPick, future comboBoxes, etc. This is the list of items that are visible to the patient. Setup enforces same number of items in PickListDb for 1:1 match. This list allows customization of what the patient sees vs what's in the db. Example: Vis=Hispanic, Db=2135-2. Example: Vis=Do Not Call, Db=DoNotCall. For radiobuttons, the number of items in the lists determines the number of radiobuttons to show to the patient. These editable lists also allow excluding some db options from being visible to patient. Example: Ins Relationship has 9 options, but only 4 of them are really used in dentistry. Just leave the other 5 off and force them to pick one of the 4. But it is also not required for them to pick one. Example: For Marital Status, you might only show Married and Child, excluding Divorced and Single from the pick list. The unselected state then represents no change, so an existing patient could leave both radio buttons unchecked and their status would remain Divorced or Single. However, we currently lack a feature to let them uncheck a radiobutton that is already checked. This is a rare edge case that nearly nobody will care about. You can also have a row with no db value. For example, a visible value of Separated might have no corresponding db value entered. In that case, an import would not cause any change to the existing db value. These lists also allow two radioButtons to represent one db item. Example: Gender Other in db can be expanded to show patient both Nonbinary and Other. When patient picks either of these, it goes into the db as Other. The lists also allow any or all items to be empty with no label. Example: Y/N radiobuttons for a series of allergies. Y/N label at top, but none of the radiobuttons need labels. When translation is added later, it will translate this list, not the PickListDb. PickListVis will, by default, simply be exactly the same as PickListDb. In this state, what the patient sees is the same as what's in the db. Must have at least two items for now.
9	PickListDb	text	Pipe delimited list of strings, used for radioButtons, future comboBoxes, etc. Not used by InsPick. This is the list of items as they would be stored in the database. See PickListVis above for examples of how to use. The value chosen from this list is what will be stored in the ValueString field. Never show this value to the patient.
10	IsHorizStacking	tinyint(4)	Typically false. Set to true to cause this field to get stacked horizontally compared to its previous sibling. Example might be to set State and Zip fields to true. This request will be ignored if screen is too small, like on a phone. The following types are not allowed to stack: SigBox, PageBreak, MedicationList.
11	IsTextWrap	tinyint(4)	Only applies when this is a TextField. Default is false, which creates a single row textbox that scrolls horizontally if text is too long. Set to true to cause text to wrap instead. This will cause the box to grow to fit the text.
12	Width	int(11)	This stores either pixel width or percentage width, depending on IsWidthPercentage. In either case, if this is blank/0, then width will be 100% of what's available. The discussion here is for fixed widths. See IsWidthPercentage for discussion of percentage widths. If fields are stacked horizontally, then they will wrap when they hit screen width. So horizontally stacked fields may end up vertically stacked on a small screen. But if a single field is still set to be wider than the current screen, it will shrink to fit the screen. This width uses WPF DIPs which are 1/96". Android phones define DIPs differently; they use 1/160" per DIP. But if you are using a language like Flutter, they are handling that conversion for you in the background. Regardless, we will be ignoring DIPs and scaling based solely on font size. The reason for this is to make fonts and boxes all look proportionally the same on both OD proper and in eClipboard. So assuming you use 14 flutter logical pixels for 100% font vs 11.5 in WPF, the conversion would look like this: Width/11.5*14. Notice that we are only converting based on font size. This makes our converted width a near perfect fit for the same text as the original. Width is only available on the field types that are h-stackable.
13	FontScale	int(11)	Applies to both the label on the field and the field itself. Never 0. Does not apply to Label types, though, since those are only handled by editing the rich text. Always has a valid value between 50 and 300. Default is 100, indicating normal size. WPF defines a DIP as 1/96". Open Dental uses 11.5 DIPs for nearly all fonts on desktop version. Old Microsoft font sizes were based on 1/72", so 11.5 converts to old 8.6. Android defines a DIP as 1/160". Typical recommended font size on Android seems to be about 16, which translates to 9.6 MS DIPs or 7.2 old Windows font. In other words, recommended phone fonts are physically slightly smaller than desktop fonts. EForms uses font sizes based on 100% being a standard normal size. 100% equates to 11.5 on desktop, probably about 16 on Android phones, and whatever our engineers come up with for tablets. By doing it this way, we do not have to explain anything complicated to users, and they also have very good control over font sizes.
14	IsRequired	tinyint(4)	False by default. If this is set to true, the patient will be required to fill out the field. If conditional logic causes a required field to not show, it will not enforce the requirement. The only checkboxes that allow this field are AllergiesNone and ProblemsNone. For those fields, this makes sure that either an allergy/prob was checked or None was checked.
15	ConditionalParent	varchar(255)	This string is the label of the field that acts as the parent for conditional logic. Empty string by default indicates no parent. Truncated to the first 255 characters.
16	ConditionalValue	text	
17	LabelAlign	tinyint(4)	Enum:EnumEFormLabelAlign 0-TopLeft, 1-LeftLeft, 2-Right. Only used in RadioButtons for now.
TopLeft: 0-Default. Above the radiobuttons, aligned left.
LeftLeft: 1-Left of the remainder of the field, and left aligned within that space.
Right: 2-Right of the remainder of the field, and left aligned within that space.
18	SpaceBelow	int(11)	The amount of space below each field. Overrides the form and global defaults. -1 indicates to use default. That way, 0 means 0 space. If multiple fields are stacked horizontally, then only the right-most field can have this field set.
19	ReportableName	varchar(255)	Allows reporting on fields that don't have DbLink.
20	IsLocked	tinyint(4)	If a field is locked, it stops a patient from editing the text when presented to them. Example is a consent form. Only available for TextField and CheckBox. This flag inherits from EFormFieldDef and there's no UI to change it once it's in EFormField. In FrmEFormFillEdit, this field has no effect because offices still need to be able to edit. So the field only has an effect when filling out by a patient on the web or in eClipboard. Patients can still use FrmEFormFillEdit, and in that case, it's assumed that office staff is watching to make sure they don't change the text.
21	Border	tinyint(4)	Enum:EnumEFormBorder 0-none, 1-3D. Shaded borders are optional on each field. They are on by default when most fields are added. But they don't make sense in some cases, like labels and stacks of Y/N radio buttons for allergies. When a border is present, any single row textbox inside it gets shown as a single underline instead of a rectangle. If the textbox has text wrapping turned on, it will always be a rectangle.
None: 0-No border
ThreeD: 1-3D border with gradient shadows and rounded corners
22	IsWidthPercentage	tinyint(4)	False=DIPs / pixels at 96 dpi, True=Percentage. There is no mechanisms for "fill remainder" or "auto size to contents". There is no allowed mixing of fixed and percentage on the same row. Wrap won't happen until all columns have hit their MinWidth. If someone specifies percentages that add up to more than 100, that's ok. We will proportionally adapt. So in addition to expected percentages like 30-30-40, the user would get the same behavior by using 150-150-200. Let's use the example of 150-150-200 and assume MinWidths were 110-100-100. If available width was 400, then the widths would be 120-120-160. If available width was 330, then the widths would be 110-94-126, or (minWidth)-3/7-4/7. Below 310, they would start wrapping. If percentages add up to less than 100, then they might stop short of 100%. For example, 25-25-25 would come up short. They would continue to occupy 75% of available space until the space got so small that they started to hit their MinWidths. Let's assume MinWidths in that example were 50-100-100. If available width was 600, then the widths would be 150-150-150 (still 75%). If available width was 300, then the widths would be 75-100-100 (only 92%). Below 250, they would start wrapping.
23	MinWidth	int(11)	Only used with IsWidthPercentage. If left blank/0, then no minimum width. A number might be present here but will be ignored if IsWidthPercentage is false.
24	WidthLabel	int(11)	If the label is to the left of the field, this is the width of that label. Only used for RadioButtons right now because that's the only type that allows labels to the left. In RadioButtons, this is helpful to allow a stack of radioButtons to line up. Default is 0 to indicate automatic.
25	SpaceToRight	int(11)	The amount of space to the right of each field. Overrides the form and global defaults. -1 indicates to use default. That way, 0 means 0 space. Not used for SigBox or MedicationList which use form level instead.
26	AutoImport	tinyint(4)	The moment the patient completes the form, this field will import to the database. The field should also be required if they want to prevent clearing it out. For example, even a field like last name needs to be able to change if patient got married or divorced, if office misspelled it, if child's last name is different, etc. Patient knows best. Also works great for address. This is important for multiple forms in a family to prevent duplicate entry of address, etc. Implemented for the following DbLinks: "addressSameEntireFamily", "Address", "Address2", "allergy:", "allergiesNone", "allergiesOther", "Birthdate", "City", "Email", "FName", "Gender", "HmPhone", "ICEName", "ICEPhone", "ins1PlanFromList", "ins2PlanFromList", "LName", "MiddleI", "Position", "PreferConfirmMethod", "PreferContactMethod", "PreferRecallMethod", "Preferred", "problem:", "problemsNone", "problemsOther", "referredFrom", "SSN", "State", "StudentStatus", "WirelessPhone", "wirelessPhoneSameEntireFamily", "WkPhone", "Zip".
27	PrefillFromGuar	tinyint(4)	If db value is empty for the patient, then prefill from guarantor. Used for addresses to avoid double entry for children. Implemented for the following DbLinks: "Address", "Address2", "City", "State", "Zip", "WirelessPhone".
28	ValueLabelEnglish	text	This is not needed for translation, but for conditional logic to identify this field in spite of language translations.
29	PickListVisEnglish	text	Pipe-delimited list of English strings, used for radioButtons, InsPick, etc. When the eForm is first created or defined in English, this will match PickListVis. After translation, PickListVis contains translated strings, while PickListVisEnglish remains in English for conditional logic comparisons (child field ConditionalValue vs. parent field selected option) and conditional value pick lists.

eformfielddef
Individual fields for the EForm. Each field generally includes a label and a value. Links to a EFormDef by FKey to eformdef.EFormDefNum. NOTE: If any new fields get added to this class and EFormField, make sure to add them to the methods EFormFields.FromDef and EFormFields.ToDef
Order	Name	Type	Summary
0	EFormFieldDefNum	bigint(20)	Primary key.
1	EFormDefNum	bigint(20)	FKey to eformdef.EFormDefNum
2	FieldType	tinyint(4)	Enum:EnumEFormFieldType 0-TextField, 1-Label, 2-CheckBox, etc.
TextField: 0-A textbox that the user can type into. Frequently tied to a database field. Can frequently be prefilled from database if desired. In Sheets, this was two different field types: InputField and OutputField.
Label: 1-This can be used for a label, heading, title, paragraph, etc. These also support the exact same replacement fields as in sheets StaticText. See the extensive comments on the ValueLabel field.
DateField: 2-Some sort of textbox that's optimized for date input.
CheckBox: 3-Simple checkbox that can be tied to a db field.
RadioButtons: 4-Not a single radiobutton, but a group of them.
SigBox: 5-A signature box, directly on the screen with stylus/mouse. Just the drawing, no encryption to tie it to the data yet.
PageBreak: 6-.
MedicationList: 7-A Medication List is a complex field. It consists of a list of medications with an optional second column for strength and frequency. Each medication has a Delete button to its right. There is also an Add button and a None checkbox at the bottom. The None checkbox only shows when the list is empty and allows satisfying a 'required' flag. There is no way to indicate 'no changes', but the office is free to add a separate No Changes checkbox below this list which doesn't actually do anything but which can serve as a visual indicator.
PatientList: 8-This is a complex field that includes a popup window. On the form, it shows as a read-only textbox with a button beside it that says 'Pick'. The popup window has a list of patients that are pulled from the live office db in real time. In that window, there's also an Add button which actually adds a new patient to the office database. For now, there's no mechanism to edit existing patients in that list. There's also a second popup window to enter the name and BD of a new patient. The only use so far is to pick insurance plan subscriber, but more uses are planned such as guarantor, guardian, adding children to family, etc.
InsPick: 9-Shows as 3 radio buttons: None, New, and Existing. Selecting Existing makes a popup window show to allow selecting an existing insurance in the family.
3	DbLink	varchar(255)	If this field is importable, then this links to a db field. The list of available fields for each type is in EFormFieldsAvailable. Users can pick from that lis which is the same list as in Sheets. In addition to those hardcoded values, this field can also contain custom PatFields. It's string-based instead of enum, just like Sheets, because it's too complex to use an enum, even for our reduced number of items. None is always represented in UI as "None" and in db as empty string. All DbLinks are available on all form types to give users more flexibility. Checkboxes can have DBLinks that look like "allergy:...", "med:...", or "problem:..."
4	ValueLabel	text	Used differently for different types: TextField, DateField, CheckBox: The label next to or above the textbox, or checkbox.RadioButtons: The label above the group of radiobuttons. Labels on each radiobutton are in PickListVis.Label: This label is the only thing that shows. A label is always a WPF FlowDocument, which is an XML format. This allows extensive rich text formatting, like bold, color, paragraph formatting, etc. This format can be used directly in OD proper, but it will need to be converted for some other programming languages using external tools. BUT, prior to that, it must be run through a method that adjusts all the font sizes. FlowDocuments only support absolute font sizes instead of relative font sizes. We use 11.5 as the base font size and all other fonts are considered to be relative to this base. So if a font size of 13.8 is present in the FlowDocument, that does not mean to use 13.8; it instead means to use 120%. If your chosen base font size on a mobile device is 16, then the conversion method needs to convert the 13.8 to 19.2 prior to using the FlowDocument.PageBreak: Not used.SigBox: Optional label above sig box.MedicationList: This holds an EFormMedListLayout object, serialized as json, including the Title, column headers, column widths, etc.PatientList: This holds an EFormPatListLayout object, serialized as json, including Label.InsPick: This holds the label above the 3 radiobuttons.
5	ItemOrder	int(11)	0 based.
6	PickListVis	text	Pipe-delimited list of strings, used for radioButtons, InsPick, future comboBoxes, etc. This is the list of items that are visible to the patient. Setup enforces same number of items in PickListDb for 1:1 match. This list allows customization of what the patient sees vs what's in the db. Example: Vis=Hispanic, Db=2135-2. Example: Vis=Do Not Call, Db=DoNotCall. For radiobuttons, the number of items in the lists determines the number of radiobuttons to show to the patient. These editable lists also allow excluding some db options from being visible to patient. Example: Ins Relationship has 9 options, but only 4 of them are really used in dentistry. Just leave the other 5 off and force them to pick one of the 4. But it is also not required for them to pick one. Example: For Marital Status, you might only show Married and Child, excluding Divorced and Single from the pick list. The unselected state then represents no change, so an existing patient could leave both radio buttons unchecked and their status would remain Divorced or Single. However, we currently lack a feature to let them uncheck a radiobutton that is already checked. This is a rare edge case that nearly nobody will care about. You can also have a row with no db value. For example, a visible value of Separated might have no corresponding db value entered. In that case, an import would not cause any change to the existing db value. These lists also allow two radioButtons to represent one db item. Example: Gender Other in db can be expanded to show patient both Nonbinary and Other. When patient picks either of these, it goes into the db as Other. The lists also allow any or all items to be empty with no label. Example: Y/N radiobuttons for a series of allergies. Y/N label at top, but none of the radiobuttons need labels. When translation is added later, it will translate this list, not the PickListDb. PickListVis will, by default, simply be exactly the same as PickListDb. In this state, what the patient sees is the same as what's in the db. Must have at least two items for now.
7	PickListDb	text	Pipe delimited list of strings, used for radioButtons, future comboBoxes, etc. Not used by InsPick. This is the list of items as they would be stored in the database. See PickListVis above for examples of how to use. The value chosen from this list is what will be stored in the ValueString field. Never show this value to the patient.
8	IsHorizStacking	tinyint(4)	Typically false. Set to true to cause this field to get stacked horizontally compared to its previous sibling. Example might be to set State and Zip fields to true. This request will be ignored if screen is too small, like on a phone. We don't allow this option for RadioButtons because they already stack horizontally, and that would be confusing. The following types are not allowed to stack: SigBox, PageBreak, MedicationList.
9	IsTextWrap	tinyint(4)	Only applies when this is a TextField. Default is false, which creates a single row textbox that scrolls horizontally if text is too long. Set to true to cause text to wrap instead. This will cause the box to grow to fit the text.
10	Width	int(11)	This stores either pixel width or percentage width, depending on IsWidthPercentage. In either case, if this is blank/0, then width will be 100% of what's available. The discussion here is for fixed widths. See IsWidthPercentage for discussion of percentage widths. If fields are stacked horizontally, then they will wrap when they hit screen width. So horizontally stacked fields may end up vertically stacked on a small screen. But if a single field is still set to be wider than the current screen, it will shrink to fit the screen. This width uses WPF DIPs which are 1/96". Android phones define DIPs differently; they use 1/160" per DIP. But if you are using a language like Flutter, they are handling that conversion for you in the background. Regardless, we will be ignoring DIPs and scaling based solely on font size. The reason for this is to make fonts and boxes all look proportionally the same on both OD proper and in eClipboard. So assuming you use 14 flutter logical pixels for 100% font vs 11.5 in WPF, the conversion would look like this: Width/11.5*14. Notice that we are only converting based on font size. This makes our converted width a near perfect fit for the same text as the original. Width is only available on the field types that are h-stackable.
11	FontScale	int(11)	Applies to both the label on the field and the field itself. Never 0. Does not apply to Label types, though, since those are only handled by editing the rich text. Always has a valid value between 50 and 300. Default is 100, indicating normal size. WPF defines a DIP as 1/96". Open Dental uses 11.5 DIPs for nearly all fonts on desktop version. Old Microsoft font sizes were based on 1/72", so 11.5 converts to old 8.6. Android defines a DIP as 1/160". Typical recommended font size on Android seems to be about 16, which translates to 9.6 MS DIPs or 7.2 old Windows font. In other words, recommended phone fonts are physically slightly smaller than desktop fonts. EForms uses font sizes based on 100% being a standard normal size. 100% equates to 11.5 on desktop, probably about 16 on Android phones, and whatever our engineers come up with for tablets. By doing it this way, we do not have to explain anything complicated to users, and they also have very good control over font sizes.
12	IsRequired	tinyint(4)	False by default. If this is set to true, the patient will be required to fill out the field. If conditional logic causes a required field to not show, it will not enforce the requirement. The only checkboxes that allow this field are AllergiesNone and ProblemsNone. For those fields, this makes sure that either an allergy/prob was checked or None was checked.
13	ConditionalParent	varchar(255)	This string is the label of the field that acts as the parent for conditional logic. Empty string by default indicates no parent. Truncated to the first 255 characters.
14	ConditionalValue	text	
15	LabelAlign	tinyint(4)	Enum:EnumEFormLabelAlign 0-TopLeft, 1-LeftLeft, 2-Right. Only used in RadioButtons for now.
TopLeft: 0-Default. Above the radiobuttons, aligned left.
LeftLeft: 1-Left of the remainder of the field, and left aligned within that space.
Right: 2-Right of the remainder of the field, and left aligned within that space.
16	SpaceBelow	int(11)	The amount of space below each field. Overrides the form and global default. -1 indicates to use default. That way, 0 means 0 space. If multiple fields are stacked horizontally, then only the right-most field can have this field set.
17	ReportableName	varchar(255)	Allows reporting on fields that don't have DbLink.
18	IsLocked	tinyint(4)	If a field is locked, it stops a patient from editing the text when presented to them. Example is a consent form. Only available for TextField and CheckBox. This flag is set here in the EFormFieldDef and then EFormField inherits it with no UI to change it later. See additional notes in EFormField.
19	Border	tinyint(4)	Enum:EnumEFormBorder 0-none, 1-3D. Shaded borders are optional on each field. They are on by default when most fields are added. But they don't make sense in some cases, like labels and stacks of Y/N radio buttons for allergies. When a border is present, any single row textbox inside it gets shown as a single underline instead of a rectangle. If the textbox has text wrapping turned on, it will always be a rectangle.
None: 0-No border
ThreeD: 1-3D border with gradient shadows and rounded corners
20	IsWidthPercentage	tinyint(4)	False=DIPs / pixels at 96 dpi, True=Percentage. There is no mechanisms for "fill remainder" or "auto size to contents". There is no allowed mixing of fixed and percentage on the same row. Wrap won't happen until all columns have hit their MinWidth. If someone specifies percentages that add up to more than 100, that's ok. We will proportionally adapt. So in addition to expected percentages like 30-30-40, the user would get the same behavior by using 150-150-200. Let's use the example of 150-150-200 and assume MinWidths were 110-100-100. If available width was 400, then the widths would be 120-120-160. If available width was 330, then the widths would be 110-94-126, or (minWidth)-3/7-4/7. Below 310, they would start wrapping. If percentages add up to less than 100, then they might stop short of 100%. For example, 25-25-25 would come up short. They would continue to occupy 75% of available space until the space got so small that they started to hit their MinWidths. Let's assume MinWidths in that example were 50-100-100. If available width was 600, then the widths would be 150-150-150 (still 75%). If available width was 300, then the widths would be 75-100-100 (only 92%). Below 250, they would start wrapping.
21	MinWidth	int(11)	Only used with IsWidthPercentage. If left blank/0, then no minimum width. A number might be present here but will be ignored if IsWidthPercentage is false.
22	WidthLabel	int(11)	If the label is to the left of the field, this is the width of that label. Only used for RadioButtons right now because that's the only type that allows labels to the left. In RadioButtons, this is helpful to allow a stack of radioButtons to line up. Default is 0 to indicate automatic.
23	SpaceToRight	int(11)	The amount of space to the right of each field. Overrides the form and global defaults. -1 indicates to use default. That way, 0 means 0 space. Not used for SigBox or MedicationList which use form level instead.
24	AutoImport	tinyint(4)	The moment the patient completes the form, this field will import to the database. The field should also be required if they want to prevent clearing it out. For example, even a field like last name needs to be able to change if patient got married or divorced, if office misspelled it, if child's last name is different, etc. Patient knows best. Also works great for address. This is important for multiple forms in a family to prevent duplicate entry of address, etc. Implemented for the following DbLinks: "addressSameEntireFamily", "Address", "Address2", "allergy:", "allergiesNone", "allergiesOther", "Birthdate", "City", "Email", "FName", "Gender", "HmPhone", "ICEName", "ICEPhone", "ins1PlanFromList", "ins2PlanFromList", "LName", "MiddleI", "Position", "PreferConfirmMethod", "PreferContactMethod", "PreferRecallMethod", "Preferred", "problem:", "problemsNone", "problemsOther", "referredFrom", "SSN", "State", "StudentStatus", "WirelessPhone", "wirelessPhoneSameEntireFamily", "WkPhone", "Zip".
25	PrefillFromGuar	tinyint(4)	If db value is empty for the patient, then prefill from guarantor. Used for addresses to avoid double entry for children. Implemented for the following DbLinks: "Address", "Address2", "City", "State", "Zip", "WirelessPhone".

eformimportrule
This table is present, but it does absolutely nothing because we never finished implementing it. In the future: Each row is a rule that controls how form import logic works. It currently also applies to sheets. Clearly, if there's no row for a specific field, then a global rule handles it. Since there are 4 different situations, we might need 4 global rules just to start. But since users might forget to add them, if any of the 4 is missing, then that situation behaves the old way: action is Review.
Order	Name	Type	Summary
0	EFormImportRuleNum	bigint(20)	Primary key.
1	FieldName	varchar(255)	If empty, this is a global rule. if the field name matches a DbLink value, then this applies to the Db field. Otherwise, it must be a Non-db field. It will first try to match a reportable name and then a label.
2	Situation	tinyint(4)	Enum:EnumEFormImportSituation
New: 0-Original blank and entered new value
Changed: 1-
Deleted: 2-
Invalid: 3-Setup UI explains the fields that this can apply to.
3	Action	tinyint(4)	Enum:EnumEFormImportAction
Overwrite: 0-
Review: 1-
Ignore: 2-
Fix: 3-Setup UI explains the fixes that can be made.

ehramendment
Used in EHR only. Stores an entry indicating whether the office has accepted or denied the amendment. Amendments can be verbal or written requests to add information to the patient's record. The provider can either scan / import the document or create a detailed description that indicates what was verbally requested or where the document can be found.
Order	Name	Type	Summary
0	EhrAmendmentNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	IsAccepted	tinyint(4)	Enum:YN Y=accepted, N=denied, U=requested.
Unknown: 0
Yes: 1
No: 2
3	Description	text	Description or user-defined location of the amendment.
4	Source	tinyint(4)	Enum:AmendmentSource Patient, Provider, Organization, Other. Required.
Patient: 0
Provider: 1
Organization: 2
Other: 3
5	SourceName	text	User-defined name of the amendment source. For example, a patient name or organization name.
6	FileName	varchar(255)	The file is stored in the A-Z folder in 'EhrAmendments' folder. This field stores the name of the file. The files are named automatically based on Date/time along with EhrAmendmentNum for uniqueness. This meets the requirement of "appending" to the patient's record.
7	RawBase64	longtext	The raw file data encoded as base64. Only used if there is no AtoZ folder. This meets the requirement of "appending" to the patient's record.
8	DateTRequest	datetime	Date and time of the amendment request.
9	DateTAcceptDeny	datetime	Date and time of the amendment acceptance or denial. If there is a date here, then the IsAccepted will be set.
10	DateTAppend	datetime	Date and time of the file being appended to the amendment or a link provided.

ehraptobs
An EHR appointment observation. Needed for syndromic surveillance messaging. Each syndromic message requires at least one observation.
Order	Name	Type	Summary
0	EhrAptObsNum	bigint(20)	Primary key.
1	AptNum	bigint(20)	FK to appointment.AptNum. There can be an unlimited number of observations per appointment.
2	IdentifyingCode	tinyint(4)	Enum:EhrAptObsIdentifier - Used in HL7 OBX-3 for syndromic surveillance.
BodyTemp: 0 - Body temperature:Temp:Enctrfrst:Patient:Qn: Loinc code 11289-6.
DateIllnessOrInjury: 1 - Illness or injury onset date and time:TmStp:Pt:Patient:Qn: Loinc code 11368-8.
PatientAge: 2 - Age Time Patient Reported Loinc code 21612-7.
PrelimDiag: 3 - Diagnosis.preliminary:Imp:Pt:Patient:Nom: Loinc code 44833-2.
TriageNote: 4 - Triage note:Find:Pt:Emergency department:Doc: Loinc code 54094-8.
OxygenSaturation: 5 - Oxygen saturation:MFr:Pt:BldA:Qn:Pulse oximetry Loinc code 59408-5.
CheifComplaint: 6 - Chief complaint:Find:Pt:Patient:Nom:Reported Loinc code 8661-1.
TreatFacilityID: 7 - Treating Facility Identifier PHINQUESTION code SS001.
TreatFacilityLocation: 8 - Treating Facility Location PHINQUESTION code SS002.
VisitType: 9 - Facility / Visit Type PHINQUESTION code SS003.
3	ValType	tinyint(4)	Enum:EhrAptObsType . Used in HL7 OBX-2 for syndromic surveillance. Identifies the data type for the observation value in ValReported.
Address: 0 - This should only be used with EhrAptObsIdentifier.TreatFacilityLocation.
Coded: 1
DateAndTime: 2
Numeric: 3
Text: 4
4	ValReported	varchar(255)	The value of the observation. The value format must match the ValType. This field could be text, a datetime, a code, etc.. Used in HL7 OBX-5 for syndromic surveillance.
5	UcumCode	varchar(255)	Used in HL7 OBX-6 for syndromic surveillance when ValType is Numeric (otherwise left blank).
6	ValCodeSystem	varchar(255)	When ValType is Coded, then this contains the code system corresponding to the code in ValReported. When ValType is not Coded, then this field should be blank. Allowed values are LOINC,SNOMEDCT,ICD9,ICD10.

ehrcareplan
Order	Name	Type	Summary
0	EhrCarePlanNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	SnomedEducation	varchar(255)	Snomed code describing the type of educational instruction provided. Limited to terms descending from the Snomed 409073007 (Education Hierarchy).
3	Instructions	varchar(255)	Instructions provided to the patient.
4	DatePlanned	date	This field does not help much with care plan instructions, but will be more helpful for other types of care plans if we expand in the future (for example, planned procedures). We also saw examples where this date was included in the human readable part of a CCD, but not in the machine readable part.

ehrlab
For EHR module, lab request that contains all required fields for HL7 Lab Reporting Interface (LRI).
Order	Name	Type	Summary
0	EhrLabNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. PID-3.1
2	OrderControlCode	varchar(255)	Always RE unless importing from outside sources.
3	PlacerOrderNum	varchar(255)	Placer order number assigned to this lab order, usually assigned by the dental office. Not the same as EhrLabNum, but similar. OBR.2.1 and ORC.2.1.
4	PlacerOrderNamespace	varchar(255)	Usually empty, only used if PlacerOrderNum+PlacerUniversalID cannot uniquely identify the lab order. OBR.2.2 and ORC.2.2.
5	PlacerOrderUniversalID	varchar(255)	Usually OID root that uniquely identifies the context that makes PlacerOrderNum globally unique. May be GUID if importing from other sources. OBR.2.3 and ORC.2.3.
6	PlacerOrderUniversalIDType	varchar(255)	Always "ISO", unless importing from other sources. OBR.2.4 and ORC.2.4
7	FillerOrderNum	varchar(255)	Filler order number assigned to this lab order, usually assigned by the laboratory. Not the same as EhrLabNum, but similar. OBR.3.1 and ORC.3.1.
8	FillerOrderNamespace	varchar(255)	Usually empty, only used if FillerOrderNum+FillerUniversalID cannot uniquely identify the lab order. OBR.3.2 and ORC.3.2.
9	FillerOrderUniversalID	varchar(255)	Usually OID root that uniquely identifies the context that makes FillerOrderNum globally unique. May be GUID if importing from other sources. OBR.3.2 and ORC.3.3.
10	FillerOrderUniversalIDType	varchar(255)	Always "ISO", unless importing from other sources. OBR.3.4 and ORC.3.4
11	PlacerGroupNum	varchar(255)	[0..1] May be empty. Placer group number assigned to this lab order, usually assigned by the dental office. ORC.4.1.
12	PlacerGroupNamespace	varchar(255)	[0..1] Usually empty, only used if PlacerGroupNum+PlacerUniversalID cannot uniquely identify the Group Num. ORC.4.2.
13	PlacerGroupUniversalID	varchar(255)	[0..1] Usually OID root that uniquely identifies the context that makes PlacerGroupNum globally unique. May be GUID if importing from other sources. ORC.4.3.
14	PlacerGroupUniversalIDType	varchar(255)	[0..1] Always "ISO", unless importing from other sources. ORC.4.4
15	OrderingProviderID	varchar(255)	May be provnum or NPI num or any other num, when combined with OrderingProviderIdAssigningAuthority should uniquely identify the provider. ORC.12.1
16	OrderingProviderLName	varchar(255)	ORC.12.2
17	OrderingProviderFName	varchar(255)	ORC.12.3
18	OrderingProviderMiddleNames	varchar(255)	Middle names or initials therof. ORC.12.4
19	OrderingProviderSuffix	varchar(255)	Example: JR or III. ORC.12.5
20	OrderingProviderPrefix	varchar(255)	Example: DR, Not MD, MD would be stored in an optional field that was not implemented called OrderingProviderDegree. ORC.12.6
21	OrderingProviderAssigningAuthorityNamespaceID	varchar(255)	Usually empty, "The value of [this field] reflects a local code that represents the combination of [the next two fields]." ORC.12.9.1
22	OrderingProviderAssigningAuthorityUniversalID	varchar(255)	ISO compliant OID that represents the organization that assigned the unique provider ID. ORC.12.9.2
23	OrderingProviderAssigningAuthorityIDType	varchar(255)	Always "ISO", unless importing from outside source. ORC.12.9.3
24	OrderingProviderNameTypeCode	varchar(255)	Describes the type of name used. ORC.12.10
25	OrderingProviderIdentifierTypeCode	varchar(255)	Must be value from HL70203 code set, see note at bottom of EhrLab.cs for usage. ORC.12.13
26	SetIdOBR	bigint(20)	Enumerates the OBR segments within a single message starting with 1. OBR.1
27	UsiID	varchar(255)	OBR.4.1
28	UsiText	varchar(255)	Description of UsiId. OBR.4.2
29	UsiCodeSystemName	varchar(255)	CodeSystem that UsiId came from. OBR.4.3
30	UsiIDAlt	varchar(255)	OBR.4.4
31	UsiTextAlt	varchar(255)	Description of UsiIdAlt. OBR.4.5
32	UsiCodeSystemNameAlt	varchar(255)	CodeSystem that UsiId came from. OBR.4.6
33	UsiTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. OBR.4.9
34	ObservationDateTimeStart	varchar(255)	Stored as string in the format YYYY[MM[DD[HH[MM[SS]]]]] where bracketed values are optional. When time is not known will be valued "0000". OBR.7.1
35	ObservationDateTimeEnd	varchar(255)	May be empty. Stored as string in the format YYYY[MM[DD[HH[MM[SS]]]]] where bracketed values are optional. OBR.8.1
36	SpecimenActionCode	varchar(255)	OBR.11
37	ResultDateTime	varchar(255)	Date Time that the result was stored or last updated. Stored in the format YYYYMMDDHHmmss. Required to be accurate to the second. OBR.22.1
38	ResultStatus	varchar(255)	OBR.25
39	ParentObservationID	varchar(255)	OBR.26.1.1
40	ParentObservationText	varchar(255)	Description of ParentObservationId. OBR.26.1.2
41	ParentObservationCodeSystemName	varchar(255)	CodeSystem that ParentObservationId came from. OBR.26.1.3
42	ParentObservationIDAlt	varchar(255)	OBR.26.1.4
43	ParentObservationTextAlt	varchar(255)	Description of ParentObservationIdAlt. OBR.26.1.5
44	ParentObservationCodeSystemNameAlt	varchar(255)	CodeSystem that ParentObservationIdAlt came from. OBR.26.1.6
45	ParentObservationTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. OBR.26.1.9
46	ParentObservationSubID	varchar(255)	OBR.26.2
47	ParentPlacerOrderNum	varchar(255)	Placer order number assigned to this lab order, usually assigned by the dental office. Not the same as EhrLabNum, but similar. OBR.29.1.1.
48	ParentPlacerOrderNamespace	varchar(255)	Usually empty, only used if PlacerOrderNum+PlacerUniversalID cannot uniquely identify the lab order. OBR.29.1.2
49	ParentPlacerOrderUniversalID	varchar(255)	Usually OID root that uniquely identifies the context that makes PlacerOrderNum globally unique. May be GUID if importing from other sources. OBR.29.1.3
50	ParentPlacerOrderUniversalIDType	varchar(255)	Always "ISO", unless importing from other sources. OBR.29.1.4
51	ParentFillerOrderNum	varchar(255)	Filler order number assigned to this lab order, usually assigned by the laboratory. Not the same as EhrLabNum, but similar. OBR.29.2.1
52	ParentFillerOrderNamespace	varchar(255)	Usually empty, only used if FillerOrderNum+FillerUniversalID cannot uniquely identify the lab order. OBR.29.2.2
53	ParentFillerOrderUniversalID	varchar(255)	Usually OID root that uniquely identifies the context that makes FillerOrderNum globally unique. May be GUID if importing from other sources. OBR.29.2.3
54	ParentFillerOrderUniversalIDType	varchar(255)	Always "ISO", unless importing from other sources. OBR.29.2.4
55	ListEhrLabResultsHandlingF	tinyint(4)	"Film with patient." Technically a coded value from HL70507. Stored as a bool instead of 7 seperate columns. OBR.49.* is used to set both ListEhrLabResultsHandlingF and ListEhrLabResultsHandlingN. OBR.49.*
56	ListEhrLabResultsHandlingN	tinyint(4)	"Notify provider when ready." Technically a coded value from HL70507. Stored as a bool instead of 7 seperate columns. OBR.49.* is used to set both ListEhrLabResultsHandlingF and ListEhrLabResultsHandlingN. OBR.49.*
57	TQ1SetId	bigint(20)	Enumerates the TQ1 segments within a single message starting with 1. TQ1.1
58	TQ1DateTimeStart	varchar(255)	Stored as string in the format YYYY[MM[DD[HH[MM[SS]]]]] where bracketed values are optional. TQ1.7
59	TQ1DateTimeEnd	varchar(255)	Stored as string in the format YYYY[MM[DD[HH[MM[SS]]]]] where bracketed values are optional. TQ1.8
60	IsCpoe	tinyint(4)	This gets set when a provider is logged in with a valid EHR key and then creates a lab.
61	OriginalPIDSegment	text	The PID Segment from the HL7 message used to generate or update the lab order.

ehrlabclinicalinfo
For EHR module, lab request that contains all required fields for HL7 Lab Reporting Interface (LRI). OBR.13.*
Order	Name	Type	Summary
0	EhrLabClinicalInfoNum	bigint(20)	Primary key.
1	EhrLabNum	bigint(20)	FK to ehrlab.EhrLabNum.
2	ClinicalInfoID	varchar(255)	OBR.13.*.1
3	ClinicalInfoText	varchar(255)	Description of ClinicalInfoId. OBR.13.*.2
4	ClinicalInfoCodeSystemName	varchar(255)	CodeSystem that ClinicalInfoId came from. OBR.13.*.3
5	ClinicalInfoIDAlt	varchar(255)	OBR.13.*.4
6	ClinicalInfoTextAlt	varchar(255)	Description of ClinicalInfoIdAlt. OBR.13.*.5
7	ClinicalInfoCodeSystemNameAlt	varchar(255)	CodeSystem that ClinicalInfoId came from. OBR.13.*.6
8	ClinicalInfoTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. OBR.13.*.7

ehrlabimage
Used to link images to an EHR lab.
Order	Name	Type	Summary
0	EhrLabImageNum	bigint(20)	Primary key.
1	EhrLabNum	bigint(20)	FK to ehrlab.EhrLabNum.
2	DocNum	bigint(20)	FK to document.DocNum. Will be -1 to indicate that lab is expecting image results.

ehrlabnote
For EHR module, May either be a note attached to an EhrLab or an EhrLabResult. NTE.*
Order	Name	Type	Summary
0	EhrLabNoteNum	bigint(20)	Primary key.
1	EhrLabNum	bigint(20)	FK to ehrlab.EhrLabNum. Should never be zero.
2	EhrLabResultNum	bigint(20)	FK to ehrlabresult.EhrLabResult. May be 0 if this is a Lab Note, will be valued if this is an Ehr Lab Result Note.
3	Comments	text	Carret delimited list of comments. Comments must be formatted text and cannot contain the following 6 characters |^&~\# NTE.*.*

ehrlabresult
For EHR module, lab result that contains all required fields for HL7 Lab Reporting Interface (LRI). OBX
Order	Name	Type	Summary
0	EhrLabResultNum	bigint(20)	Primary key.
1	EhrLabNum	bigint(20)	FK to ehrlab.EhrLabNum.
2	SetIdOBX	bigint(20)	Enumerates the OBX segments within a single message starting with 1. OBX.1
3	ValueType	varchar(255)	This field identifies the data type used for ObservationValue (OBX-5). OBX.2
4	ObservationIdentifierID	varchar(255)	"LOINC shall be used as the standard coding system for this field if an appropriate LOINC code exists. Appropriate status is defined in the LOINC Manual Section 11.2 Classification of LOINC Term Status. If a local coding system is in use, a local code should also be sent to help with identification of coding issues. When no valid LOINC exists the local code may be the only code sent. When populating this field with values, this guide does not give preference to the triplet in which the standard (LOINC) code should appear." OBX.3.1
5	ObservationIdentifierText	varchar(255)	Description of ObservationIdentifierId. OBX.3.2
6	ObservationIdentifierCodeSystemName	varchar(255)	CodeSystem that ObservationIdentifierId came from. Should be "LN". OBX.3.3
7	ObservationIdentifierIDAlt	varchar(255)	Probably a LoincCode or empty. OBX.3.4
8	ObservationIdentifierTextAlt	varchar(255)	Description of ObservationIdentifierIdAlt. OBX.3.5
9	ObservationIdentifierCodeSystemNameAlt	varchar(255)	CodeSystem that ObservationIdentifierId came from. Should be "LN" or empty. OBX.3.6
10	ObservationIdentifierTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. OBX.3.7
11	ObservationIdentifierSub	varchar(255)	OBX.4
12	ObservationValueCodedElementID	varchar(255)	OBX.5.1
13	ObservationValueCodedElementText	varchar(255)	Description of ObservationValueCodedElementId. OBX.5.2
14	ObservationValueCodedElementCodeSystemName	varchar(255)	CodeSystem that ObservationValueCodedElementId came from. OBX.5.3
15	ObservationValueCodedElementIDAlt	varchar(255)	OBX.5.4
16	ObservationValueCodedElementTextAlt	varchar(255)	Description of ObservationValueCodedElementIdAlt. OBX.5.5
17	ObservationValueCodedElementCodeSystemNameAlt	varchar(255)	CodeSystem that ObservationValueCodedElementId came from. OBX.5.6
18	ObservationValueCodedElementTextOriginal	varchar(255)	CWE only. Optional text that describes the original text used to encode the values above. OBX.5.7
19	ObservationValueDateTime	varchar(255)	Stored as string in the formatYYYY[MM[DD]] for DT and YYYYMMDDHHMMSS for TS. Note: this is the lab result value, not the DT the test was performed. OBX.5.1
20	ObservationValueTime	time	Note: this is the lab result value, not the time the test was performed. OBX.5.1
21	ObservationValueComparator	varchar(255)	OBX.5.1
22	ObservationValueNumber1	double	OBX.5.2
23	ObservationValueSeparatorOrSuffix	varchar(255)	OBX.5.3
24	ObservationValueNumber2	double	OBX.5.4
25	ObservationValueNumeric	double	OBX.5.1
26	ObservationValueText	varchar(255)	OBX.5.1
27	UnitsID	varchar(255)	"UCUM (Unified Code for Units of Measure) will be evaluated during the pilot for potential subsequent inclusion. As part of the pilot test, for dimensionless units the UCUM representation could be {string}, e.g., for titer the pilot might use {titer} to test feasibility. When sending units of measure as text, they must be placed in the correct component of OBX-6 (CWE_CRE.9)." OBX.6.1
28	UnitsText	varchar(255)	Description of UnitsId. OBX.6.2
29	UnitsCodeSystemName	varchar(255)	CodeSystem that UnitsId came from. Should be "UCUM". OBX.6.3
30	UnitsIDAlt	varchar(255)	OBX.6.4
31	UnitsTextAlt	varchar(255)	Description of UnitsIdAlt. OBX.6.5
32	UnitsCodeSystemNameAlt	varchar(255)	CodeSystem that UnitsId came from. OBX.6.6
33	UnitsTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. OBX.6.7
34	referenceRange	varchar(255)	"Guidance: It is not appropriate to send the reference range for a result in an associated NTE segment. It would be appropriate to send additional information clarifying the reference range in an NTE associated with this OBX-" OBX.7
35	AbnormalFlags	varchar(255)	Comma Delimited list of Abnormal Flags using HL70078 enum values. OBX.8.*
36	ObservationResultStatus	varchar(255)	Coded status of result. OBX.11
37	ObservationDateTime	varchar(255)	Stored as string in the format YYYYMMDD[HH[MM[SS]]]. "For specimen based test, if it is valued it must be the same as SPM-17. If SPM-17 is present and relates to the same observation, then OBX-14 must be within the DR range." OBX.14.1
38	AnalysisDateTime	varchar(255)	Stored as string in the format YYYYMMDD[HH[MM[SS]]]. "Be as precise as appropriate and available." OBX.19.1
39	PerformingOrganizationName	varchar(255)	OBX.23.1
40	PerformingOrganizationNameAssigningAuthorityNamespaceId	varchar(255)	OBX.23.6.1
41	PerformingOrganizationNameAssigningAuthorityUniversalId	varchar(255)	The Assigning Authority component is used to identify the system, application, organization, etc. that assigned the ID in component 10. OBX.23.6.2
42	PerformingOrganizationNameAssigningAuthorityUniversalIdType	varchar(255)	Should always be "ISO", unless importing. OBX.23.6.3
43	PerformingOrganizationIdentifierTypeCode	varchar(255)	OBX.23.7
44	PerformingOrganizationIdentifier	varchar(255)	OBX.23.10
45	PerformingOrganizationAddressStreet	varchar(255)	OBX.24.1.1
46	PerformingOrganizationAddressOtherDesignation	varchar(255)	OBX.24.2
47	PerformingOrganizationAddressCity	varchar(255)	OBX.24.3
48	PerformingOrganizationAddressStateOrProvince	varchar(255)	USPS Alpha State Codes. OBX.24.4
49	PerformingOrganizationAddressZipOrPostalCode	varchar(255)	OBX.24.5
50	PerformingOrganizationAddressCountryCode	varchar(255)	Should be the three letter Alpha Code derived from ISO 3166 alpha-3 code set. http://www.nationsonline.org/oneworld/country_code_list.htm OBX.24.6
51	PerformingOrganizationAddressAddressType	varchar(255)	OBX.24.7
52	PerformingOrganizationAddressCountyOrParishCode	varchar(255)	Should be based on FIPS 6-4. We are just importing the string as is. OBX.24.8
53	MedicalDirectorID	varchar(255)	May be provnum or NPI num or any other num, when combined with MedicalDirectorIdAssigningAuthority should uniquely identify the provider. OBX.25.1
54	MedicalDirectorLName	varchar(255)	OBX.25.2
55	MedicalDirectorFName	varchar(255)	OBX.25.3
56	MedicalDirectorMiddleNames	varchar(255)	Middle names or initials therof. OBX.25.4
57	MedicalDirectorSuffix	varchar(255)	Example: JR or III. OBX.25.5
58	MedicalDirectorPrefix	varchar(255)	Example: DR, Not MD, MD would be stored in an optional field that was not implemented called MedicalDirectorDegree. OBX.25.6
59	MedicalDirectorAssigningAuthorityNamespaceID	varchar(255)	Usually empty, "The value of [this field] reflects a local code that represents the combination of [the next two fields]." OBX.25.9.1
60	MedicalDirectorAssigningAuthorityUniversalID	varchar(255)	ISO compliant OID that represents the organization that assigned the unique provider ID. OBX.25.9.2
61	MedicalDirectorAssigningAuthorityIDType	varchar(255)	Always "ISO", unless importing from outside source. OBX.25.9.3
62	MedicalDirectorNameTypeCode	varchar(255)	Describes the type of name used. OBX.25.10
63	MedicalDirectorIdentifierTypeCode	varchar(255)	Must be value from HL70203 code set, see note at bottom of EhrLab.cs for usage. OBX.25.13

ehrlabresultscopyto
For EHR module, copy results to... that contains all required fields for HL7 Lab Reporting Interface (LRI).
Order	Name	Type	Summary
0	EhrLabResultsCopyToNum	bigint(20)	Primary key.
1	EhrLabNum	bigint(20)	FK to ehrlab.EhrLabNum.
2	CopyToID	varchar(255)	May be provnum or NPI num or any other num, when combined with CopyToIdAssigningAuthority should uniquely identify the provider. OBR.28.1
3	CopyToLName	varchar(255)	OBR.28.2
4	CopyToFName	varchar(255)	OBR.28.3
5	CopyToMiddleNames	varchar(255)	Middle names or initials therof. OBR.28.4
6	CopyToSuffix	varchar(255)	Example: JR or III. OBR.28.5
7	CopyToPrefix	varchar(255)	Example: DR, Not MD, MD would be stored in an optional field that was not implemented called CopyToDegree. OBR.28.6
8	CopyToAssigningAuthorityNamespaceID	varchar(255)	Usually empty, "The value of [this field] reflects a local code that represents the combination of [the next two fields]." OBR.28.9.1
9	CopyToAssigningAuthorityUniversalID	varchar(255)	ISO compliant OID that represents the organization that assigned the unique provider ID. OBR.28.9.2
10	CopyToAssigningAuthorityIDType	varchar(255)	Always "ISO", unless importing from outside source. OBR.28.9.3
11	CopyToNameTypeCode	varchar(255)	Describes the type of name used. OBR.28.10
12	CopyToIdentifierTypeCode	varchar(255)	Must be value from HL70203 code set, see note at bottom of EhrLab.cs for usage. OBR.28.13

ehrlabspecimen
For EHR module, the specimen upon which the lab orders were/are to be performed on. NTE.*
Order	Name	Type	Summary
0	EhrLabSpecimenNum	bigint(20)	Primary key.
1	EhrLabNum	bigint(20)	FK to ehrlab.EhrLabNum. May be 0.
2	SetIdSPM	bigint(20)	Enumerates the SPM segments within a single message starting with 1. SPM.1
3	SpecimenTypeID	varchar(255)	SPM.2
4	SpecimenTypeText	varchar(255)	Description of SpecimenTypeId. SPM.3
5	SpecimenTypeCodeSystemName	varchar(255)	CodeSystem that SpecimenTypeId came from. SPM.4
6	SpecimenTypeIDAlt	varchar(255)	SPM.5
7	SpecimenTypeTextAlt	varchar(255)	Description of SpecimenTypeIdAlt. SPM.6
8	SpecimenTypeCodeSystemNameAlt	varchar(255)	CodeSystem that SpecimenTypeId came from. SPM.7
9	SpecimenTypeTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. SPM.8
10	CollectionDateTimeStart	varchar(255)	Stored as string in the format YYYYMMDD[HH[MM[SS]]] where bracketed values are optional. When time is not known will be valued "0000". SPM.17.1.1
11	CollectionDateTimeEnd	varchar(255)	May be empty. Stored as string in the format YYYYMMDD[HH[MM[SS]]] where bracketed values are optional. SPM.17.2.1

ehrlabspecimencondition
For EHR module, the specimen upon which the lab orders were/are to be performed on. SPM.24
Order	Name	Type	Summary
0	EhrLabSpecimenConditionNum	bigint(20)	Primary key.
1	EhrLabSpecimenNum	bigint(20)	FK to ehrlabspecimen.EhrLabSpecimenNum.
2	SpecimenConditionID	varchar(255)	SPM.24.1
3	SpecimenConditionText	varchar(255)	Description of SpecimenConditionId. SPM.24.2
4	SpecimenConditionCodeSystemName	varchar(255)	CodeSystem that SpecimenConditionId came from. SPM.24.3
5	SpecimenConditionIDAlt	varchar(255)	SPM.24.4
6	SpecimenConditionTextAlt	varchar(255)	Description of SpecimenConditionIdAlt. SPM.24.5
7	SpecimenConditionCodeSystemNameAlt	varchar(255)	CodeSystem that SpecimenConditionId came from. SPM.24.6
8	SpecimenConditionTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. SPM.24.7

ehrlabspecimenrejectreason
For EHR module, the specimen upon which the lab orders were/are to be performed on. (May Repeat) SPM.21
Order	Name	Type	Summary
0	EhrLabSpecimenRejectReasonNum	bigint(20)	Primary key.
1	EhrLabSpecimenNum	bigint(20)	FK to ehrlab.EhrLabNum. May be 0.
2	SpecimenRejectReasonID	varchar(255)	SPM.21.1
3	SpecimenRejectReasonText	varchar(255)	Description of SpecimenRejectReasonId. SPM.21.2
4	SpecimenRejectReasonCodeSystemName	varchar(255)	CodeSystem that SpecimenRejectReasonId came from. SPM.21.3
5	SpecimenRejectReasonIDAlt	varchar(255)	SPM.21.4
6	SpecimenRejectReasonTextAlt	varchar(255)	Description of SpecimenRejectReasonIdAlt. SPM.21.5
7	SpecimenRejectReasonCodeSystemNameAlt	varchar(255)	CodeSystem that SpecimenRejectReasonId came from. SPM.21.6
8	SpecimenRejectReasonTextOriginal	varchar(255)	Optional text that describes the original text used to encode the values above. SPM.21.7

ehrmeasure
For EHR module, automate measure calculation.
Order	Name	Type	Summary
0	EhrMeasureNum	bigint(20)	Primary key.
1	MeasureType	tinyint(4)	Enum:EhrMeasureType
ProblemList: 0
MedicationList: 1
AllergyList: 2
Demographics: 3
Education: 4
TimelyAccess: 5
ProvOrderEntry: 6
CPOE_MedOrdersOnly: 7
CPOE_PreviouslyOrdered: 8
Rx: 9
VitalSigns: 10
VitalSignsBMIOnly: 11
VitalSignsBPOnly: 12
Smoking: 13
Lab: 14
ElectronicCopy: 15
ClinicalSummaries: 16
Reminders: 17
MedReconcile: 18
SummaryOfCare: 19- Summary of care record for transition or referral.
CPOE_LabOrdersOnly: 20
CPOE_RadiologyOrdersOnly: 21
ElectronicCopyAccess: 22
SummaryOfCareElectronic: 23
SecureMessaging: 24
FamilyHistory: 25
ElectronicNote: 26
LabImages: 27
VitalSigns2014: 28
DrugDrugInteractChecking: 29
DrugFormularyChecking: 30
ProtectElectHealthInfo: 31
ImmunizationRegistries: 32
SyndromicSurveillance: 33
PatientList: 34
ClinicalInterventionRules: 35
2	Numerator	smallint(6)	0-100, -1 indicates not entered yet.
3	Denominator	smallint(6)	0-100, -1 indicates not entered yet.

ehrmeasureevent
Stores events for EHR that are needed for reporting purposes.
Order	Name	Type	Summary
0	EhrMeasureEventNum	bigint(20)	Primary key.
1	DateTEvent	datetime	Date and time of measure event.
2	EventType	tinyint(4)	Enum:EhrMeasureEventType .
EducationProvided: 0
OnlineAccessProvided: 1
ElectronicCopyRequested: 2
ElectronicCopyProvidedToPt: 3
ClinicalSummaryProvidedToPt: 4, For one office visit.
ReminderSent: 5
MedicationReconcile: 6
SummaryOfCareProvidedToDr: 7 - When Summary of Care is provided in one of the following ways: Printed, exported, or sent to the patient portal (for referrals To doctors).
TobaccoUseAssessed: 8
TobaccoCessation: 9
CurrentMedsDocumented: 10
CPOE_MedOrdered: 11
CPOE_LabOrdered: 12
CPOE_RadOrdered: 13
SummaryOfCareProvidedToDrElectronic: 14 - When a Summary of Care is provided to a doctor electronically in one of the following ways: Exported (we assume they send another way), or a Direct message is sent with Summary of Care attached.
SecureMessageFromPat: 15
DrugDrugInteractChecking: 16
DrugFormularyChecking: 17
ProtectElectHealthInfo: 18
ImmunizationRegistries: 19
SyndromicSurveillance: 20
PatientList: 21
ClinicalInterventionRules: 22
3	PatNum	bigint(20)	FK to patient.PatNum
4	MoreInfo	varchar(255)	Used to provide extra information about a measure event. Not typically used.
5	CodeValueEvent	varchar(30)	The code for this event. Example: TobaccoUseAssessed can be one of three LOINC codes: 11366-2 History of tobacco use Narrative, 68535-4 Have you used tobacco in the last 30 days, and 68536-2 Have you used smokeless tobacco product in the last 30 days.
6	CodeSystemEvent	varchar(30)	The code system name for the event code. Examples: LOINC, SNOMEDCT.
7	CodeValueResult	varchar(30)	The code for this event result. Example: A TobaccoUseAssessed event type could result in a finding of SNOMED code 8517006 - Ex-smoker (finding). There are 54 allowed tobacco user/non-user codes, and the user is allowed to select from any SNOMED code if they wish, for a TobaccoUseAssessed event.
8	CodeSystemResult	varchar(30)	The code system for this event result. Example: SNOMEDCT,
9	FKey	bigint(20)	A foreign key to a table associated with the EventType. 0 indicates not in use. Used to properly count denominators for specific measure types.
10	TobaccoCessationDesire	tinyint	How eager a tobacco user is to quit using tobacco. Scale of 1-10.
11	DateStartTobacco	date	The date the patient started using tobacco.

ehrnotperformed
For EHR module, these are all the items 'not performed' on patients. Each row will link to the ehrcode table to retrieve relevant data. To join this table to the ehrcode table you must join on CodeValue and CodeSystem. Some items will have associated reasons attached to specify why it was not performed. Those reasons will also be defined in the ehrcode table, so it may be necessary to join with that table again for the data relevant to the reason.
Order	Name	Type	Summary
0	EhrNotPerformedNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ProvNum	bigint(20)	FK to provider.ProvNum.
3	CodeValue	varchar(30)	This will be a FK to a specific code system table identified by the CodeSystem column. The code for this item from one of the code systems supported. Examples: 90656 or 442333005.
4	CodeSystem	varchar(30)	FK to codesystem.CodeSystemName. The code system name for this code. Possible values are: CPT, CVX, LOINC, SNOMEDCT.
5	CodeValueReason	varchar(30)	FK to ehrcode.CodeValue. This code may not exist in the ehrcode table, it may have been chosen from a bigger list of available codes. In that case, this will be a FK to a specific code system table identified by the CodeSystem column. The code for the reason the item was not performed from one of the code systems supported. Examples: 182856006 or 419808006.
6	CodeSystemReason	varchar(30)	FK to codesystem.CodeSystemName. The code system name for this code. Possible value is: SNOMEDCT.
7	Note	text	Relevant notes for this not performed item. Just in case users want it, does not get reported in EHR quality measure reporting.
8	DateEntry	date	The date and time this item was created. Can be edited to the date and time the item actually occurred.

ehrpatient
Patient information needed for EHR. 1:1 relation to patient table. They are stored here because we want to try to keep the size of the patient table a bit smaller. Some non-EHR columns have also been added, which isn't a big deal.
Order	Name	Type	Summary
0	PatNum	bigint(20)	FK to patient.PatNum. Also the primary key for this table. Always one to one relationship with patient table. A new patient might not have an entry here until needed.
1	MotherMaidenFname	varchar(255)	Mother's maiden first name. Exported in HL7 PID-6 for immunization messages.
2	MotherMaidenLname	varchar(255)	Mother's maiden last name. Exported in HL7 PID-6 for immunization messages.
3	VacShareOk	tinyint(4)	Enum:YN Indicates whether or not the patient wants to share their vaccination information with other EHRs. Used in immunization export.
Unknown: 0
Yes: 1
No: 2
4	MedicaidState	varchar(50)	The abbreviation for the state for the patient's MedicaidID. Displayed in patient information window, used to validate the length of the MedicaidID.
5	SexualOrientation	varchar(255)	The patient's sexual orientation. Stored as a SNOMED code or HL7 null flavor.
6	GenderIdentity	varchar(255)	The patient's gender identity. Stored as a SNOMED code or HL7 null flavor.
7	SexualOrientationNote	varchar(255)	Will be blank unless SexualOrientation is OTH, additional orientation.
8	GenderIdentityNote	varchar(255)	Will be blank unless GenderIdentity is OTH, additional gender identity.
9	DischargeDate	datetime	Used in hospitals. Used to track patients discharge date.

ehrprovkey
Used to store and track Ehr Provider Keys. There can be multiple EhrProvKeys per provider.
Order	Name	Type	Summary
0	EhrProvKeyNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. Only used by HQ for generating keys for customers. Will always be 0 for non-HQ users.
2	LName	varchar(255)	The provider LName.
3	FName	varchar(255)	The provider FName.
4	ProvKey	varchar(255)	The key assigned to the provider
5	FullTimeEquiv	float	Usually 1. Can be less, like .5 or .25 to indicate possible discount is justified.
6	Notes	text	Any notes that the tech wishes to include regarding this situation.
7	YearValue	int(11)	Required when generating a new provider key. It is used to determine annual EHR eligibility. Format will always be YY.

ehrquarterlykey
Also used by OD customer support to store and track Ehr Quarterly Keys for customers.
Order	Name	Type	Summary
0	EhrQuarterlyKeyNum	bigint(20)	Primary key.
1	YearValue	int(11)	Example 11
2	QuarterValue	int(11)	Example 2
3	PracticeName	varchar(255)	The customer must have this exact practice name entered in practice setup.
4	KeyValue	varchar(255)	The calculated key value, tied to year, quarter, and practice name.
5	PatNum	bigint(20)	FK to patient.PatNum. Always zero for customer databases. When used by OD customer support, this is the customer num.
6	Notes	text	Any notes that the tech wishes to include regarding this situation.

ehrsummaryccd
Can also be a CCR. Received CCDs/CCRs are stored both here and in emailattach. Sent CCDs are not saved here, but are only stored in emailattach. To display a saved Ccd, it is combined with an internal stylesheet.
Order	Name	Type	Summary
0	EhrSummaryCcdNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateSummary	date	Date that this Ccd was received.
3	ContentSummary	longtext	The xml content of the received text file.
4	EmailAttachNum	bigint(20)	FK to emailattach.EmailAttachNum. The Direct email attachment where the CCD xml message came from. Needed to sync PatNum with the email PatNum if the PatNum is changed on the email.

ehrtrigger
CDS Triggers when referenced in UI. Used for CDS automation. May later be expanded to replace "automation."
Order	Name	Type	Summary
0	EhrTriggerNum	bigint(20)	Primary key.
1	Description	varchar(255)	Short description to describe the trigger.
2	ProblemSnomedList	text	
3	ProblemIcd9List	text	
4	ProblemIcd10List	text	
5	ProblemDefNumList	text	
6	MedicationNumList	text	
7	RxCuiList	text	
8	CvxList	text	
9	AllergyDefNumList	text	
10	DemographicsList	text	Age, Gender. Can be multiple age entries but only one gender entry as coma delimited values. Example: " age,>18 age,<=55 gender,male"
11	LabLoincList	text	List of loinc codes padded with spaces.
12	VitalLoincList	text	Examples: Height,>=72 Weight<,100 BMI= (BP currently not implemented.)
13	Instructions	text	The reccomended course of action for this intervention.
14	Bibliography	text	Bibliographic information, not a URL.
15	Cardinality	tinyint(4)	Enum:MatchCardinality Requires One, OneOfEachCategory, TwoOrMore, or All for trigger to match.
One: 0 - If any one of the conditions are met from any of the categories.
OneOfEachCategory: 1 - Must have one match from each of the categories with set values. Categories are :Medication, Allergy, Problem, Vitals, Age, Gender, and Lab Results.
TwoOrMore: 2 - Must match any two conditions, may be from same category.
All: 3 - Must match every code defined in the EhrTrigger.

electid
Corresponds to the electid table in the database. Helps with entering elecronic/payor id's as well as keeping track of the specific carrier requirements. Only used by the X12 format.
Order	Name	Type	Summary
0	ElectIDNum	bigint(20)	Primary key.
1	PayorID	varchar(255)	aka Electronic ID. A simple string. This is not necessarily unique between different CarrierNames. Also, different clearinghouses use different systems of PayorIDs.
2	CarrierName	varchar(255)	Used when doing a search.
3	IsMedicaid	tinyint	True if medicaid. Then, the billing and treating providers will have their Medicaid ID's attached.
4	ProviderTypes	varchar(255)	Integers separated by commas. Each long represents a ProviderSupplementalID type that is required by this insurance. Usually only used for BCBS or other carriers that require supplemental provider id's. Even if we don't put the supplemental types in here, the user can still add them. This just helps by doing an additional check for known required types.
5	Comments	text	Any comments. Usually includes enrollment requirements and descriptions of how to use the provider id's supplied by the carrier because they might call them by different names.
6	CommBridge	tinyint(4)	Enum:EclaimsCommBridge Where this Electronic ID came from. Will be 0 if created by the user. Currently, only ClaimConnect and EDS are supported.
None: 0-No comm bridge will be activated. The claim files will be created to the specified path, but they will not be uploaded.
WebMD: 1
BCBSGA: 2
Renaissance: 3
ClaimConnect: 4
RECS: 5
Inmediata: 6
AOS: 7
PostnTrack: 8
ITRANS: 9 Canadian clearinghouse.
Tesia: 10
MercuryDE: 11
ClaimX: 12
DentiCal: 13
EmdeonMedical: 14
Claimstream: 15 Canadian clearinghouse.
NHS: 16 UK clearinghouse.
EDS: 17
Ramq: 18
EdsMedical: 19
Lantek: 20
ITRANS2: 21 Canadian clearinghouse. Similar to ITRANS except supports certificate and carrier list web fetching.
VyneDental: 22
7	Attributes	varchar(255)	Comma delimited list of which PayerAttributes of a CommBridge are supported by this Electronic ID. Example: "0,2,8". Enum values for either EnumClaimConnectPayerAttributes or EnumEDSPayerAttributes.

emailaddress
Stores all the connection info for one email address. Linked to clinic by clinic.EmailAddressNum. Sends email based on patient's clinic.
Order	Name	Type	Summary
0	EmailAddressNum	bigint(20)	Primary key.
1	SMTPserver	varchar(255)	For example smtp.gmail.com
2	EmailUsername	varchar(255)	.
3	EmailPassword	varchar(255)	Password associated with this email address. Encrypted when stored in the database and decrypted before using.
4	ServerPort	int(11)	Usually 587, sometimes 25 or 465.
5	UseSSL	tinyint(4)	.
6	SenderAddress	varchar(255)	The email address of the sender as it should appear to the recipient.
7	Pop3ServerIncoming	varchar(255)	For example pop.gmail.com
8	ServerPortIncoming	int(11)	Usually 110, sometimes 995.
9	UserNum	bigint(20)	FK to userod.UserNum. Associates a user with this email address. A user may only have one email address associated with them. Can be 0 if no user is associated with this email address.
10	AccessToken	varchar(2000)	Needed for OAuth.
11	RefreshToken	text	Needed for OAuth.
12	DownloadInbox	tinyint(4)	When true, this will allow the user to download emails to their inbox.
13	QueryString	varchar(1000)	Allows gmail users to specify search parameters
14	AuthenticationType	tinyint(4)	Enum:OAuthType None=0,Google=1,Microsoft=2. Indicates which OAuth type to use for the email address.
None: 0 - Aka Using Password. Not using OAuth
Google: 1 - Using OAuth for Google
Microsoft: 2 - Using OAuth for Microsoft

emailattach
Keeps track of one file attached to an email. Multiple files can be attached to an email using this method.
Order	Name	Type	Summary
0	EmailAttachNum	bigint(20)	Primary key.
1	EmailMessageNum	bigint(20)	FK to emailmessage.EmailMessageNum. 0 if EmailTemplateNum is set, otherwise must have a value.
2	DisplayedFileName	varchar(255)	The name of the file that shows on the email. For example: tooth2.jpg.
3	ActualFileName	varchar(255)	The actual file is stored in the A-Z folder in EmailAttachments. This field stores the sub directories and name of the file. The files are named automatically based on Date/time along with a random number. This ensures that they will be sequential as well as unique.
4	EmailTemplateNum	bigint(20)	FK to emailtemplate.EmailTemplateNum. 0 if EmailMessageNum is set, otherwise must have a value.

emailautograph
A manually created autograph that can be inserted at the bottom of an outgoing email.
Order	Name	Type	Summary
0	EmailAutographNum	bigint(20)	Primary key.
1	Description	text	Description of the autograph. This is what the user sees when picking an autograph.
2	EmailAddress	varchar(255)	Email address(es) that this autograph is associated with. An autograph can be associated with multiple addresses.
3	AutographText	text	The actual text of the autograph.

emailhostingtemplate
Order	Name	Type	Summary
0	EmailHostingTemplateNum	bigint(20)	Primary key.
1	TemplateName	varchar(255)	Name of the template.
2	Subject	text	Default subject line.
3	BodyPlainText	mediumtext	Body of the email
4	BodyHTML	mediumtext	Body of the email. When email is regular html this will only contain the body text. Will contain full html when email type is RawHtml
5	TemplateId	bigint(20)	The email hosting template's identifier
6	ClinicNum	bigint(20)	FK to clinic.ClinicNum
7	EmailTemplateType	varchar(255)	Enum:EmailType The type of email template this is (Regular HTML or Full HTML)
Regular: 0 - This is a regular email that may contain our special wiki markup. Not converted to html.
Html: 1 - Html. Basic html email which uses the master template supplied by OD. Template includes header, styles, and the opening body tag. The user only needs to provide the body itself, which can inclcude tags that get automatically replaced.
RawHtml: 2 - More advanced html that does not include the master template. User must provide everything.
8	TemplateType	varchar(255)	Enum:PromotionType the type of mass email this template is for
Manual: 0 - Signifies Manually Sent Promotions like from Mass Emails
Birthday: 1 - Signifies Birthday Greetings
Treatment: 2 - Promotional Treatment
Special: 3 - Special Promotions

emailmessage
Stores both sent and received emails, as well as saved emails which are still in composition.
Order	Name	Type	Summary
0	EmailMessageNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. The patient whom is sending this message. May be sent by a guarantor on behalf of a dependent.
2	ToAddress	text	Either a single email address or a comma-delimited list of addresses. For web mail messages, this will not be an email address. Instead, it will be the name of the corresponding patient or provider.
3	FromAddress	text	Valid email address. For web mail messages, this will not be an email address. Instead, it will be the name of the corresponding patient or provider.
4	Subject	text	Subject line.
5	BodyText	longtext	Body of the email. Both this and HtmlText are required if this is an HTML email.
6	MsgDateTime	datetime	Date and time the message was sent. Automated at the UI level.
7	SentOrReceived	tinyint	Enum:EmailSentOrReceived Neither, Received, Read, WebMailReceived, WebMailRecdRead, WebMailSent, WebMailSentRead, SentDirect, ReceivedEncrypted, ReceivedDirect, ReadDirect, AckDirectProcessed, AckDirectNotSent
Neither: 0 Unsent
Sent: 1 For regular email only.
Received: 2 For regular email only. Shows in Inbox. Once it's attached to a patient it will also show in Chart module.
Read: 3 For received regular email only. Has been read. Shows in Inbox. Once it's attached to a patient it will also show in Chart module.
WebMailReceived: 4 WebMail received from patient portal. Shows in OD Inbox and in pt Chart module. Also shows in PP as a sent and unread WebMail msg.
WebMailRecdRead: 5 WebMail received from patient portal that has been marked read. Shows in the OD Inbox and in pt Chart module. Also shows in PP as a sent and read WebMail.
WebMailSent: 6 Webmail sent from provider to patient. Shows in Chart module and also shows in PP as a received and unread WebMail msg.
WebMailSentRead: 7 Webmail sent from provider to patient and read by patient. Shows in Chart module and also shows in PP as a received and read WebMail msg.
SentDirect: 8 Sent and encrypted using Direct. Required for counting messages in EHR modules g.1 and g.2, Automated Measure Calculation.
ReceivedEncrypted: 9 Received email matches application/pkcs7-mime mime type, but could not be decrypted. Shows in Inbox. The user can decrypt from FormEmailMessageEdit. If the user has the correct private key, then the status will change to Read.
ReceivedDirect: 10 Received email matches application/pkcs7-mime mime type and has been decrypted. Shows in Inbox. Once it's attached to a patient it will also show in Chart module. When viewing inside of FormEmailMessageEdit, the XML body of the message shows as xhtml instead of raw. Still need to work on supporting collapsing and expanding, as required for meaningful use in 2014.
ReadDirect: 11 For received direct messages. Has been read. Shows in Inbox. Once it's attached to a patient it will also show in Chart module. When viewing inside of FormEmailMessageEdit, the XML body of the message shows as xhtml.
AckDirectProcessed: 12 Message Delivery Notification (MDN) processed. Always outgoing. Indicates to sender that a Direct message was received and decrypted, but not necessarily displayed for the user. Does not show in patient Chart. Attached to the same patient as the incoming email which caused the MDN to be sent.
AckDirectNotSent: 13 Message Delivery Notification (MDN) created and saved to db, but not sent yet. Does not show in patient Chart. Attached to the same patient as the incoming email which caused the MDN to be created. This status is used to try resending MDNs if they fail to send. The MDN is saved to the db so the unset MDNs can be found easily, and also because MDNs are hard to rebuild again later.
SecureEmailSent: 14 Email sent via EmailHostingAPI.
SecureEmailReceivedUnread: 15 Email received via EmailHostingAPI. Has not been read.
SecureEmailReceivedRead: 16 Email sent via EmailHostingAPI. has been read.
SendFailed: 17 Email failed to send.
8	RecipientAddress	varchar(255)	Copied from the EmailAddress.EmailUsername field when a message is received into the inbox. Similar to the ToAddress, except the ToAddress could contain multiple recipient addresses or group email address instead. The recipient address helps match the an email to a particular EmailAddress.
9	RawEmailIn	longtext	For incomming email only. The raw email contents for encrypted email or email which we had trouble parsing. For unencrypted (clear text) email, this will be similar to the raw email except the attachments will be dissolved to prevent db bloating. Can be used for debugging if there are any issues parsing the content. This will bloat the database a little bit, but we need it for now to ensure our inbox is working in real world scenarios. Might be blank for a few emails downloaded immediately after the email inbox feature was created.
10	ProvNumWebMail	bigint(20)	FK to provider.ProvNum. The provider to whom this message was sent or from whom this message was sent. Only used when EmailSentOrReceived is WebMailReceived, WebMailRecdRead, WebMailSent, or WebMailSentRead. Will be 0 if not a web mail message.
11	PatNumSubj	bigint(20)	FK to patient.PatNum. Represents the patient to whom this email message is addressed, or from whom it is being sent on behalf of. If guarantor is sending on behalf of self then this field will match PatNum field.
12	CcAddress	text	Single address or comma-delimited list of addresses. User may enter multiple email addresses for visible carbon copies.
13	BccAddress	text	Single email address or comma-delimited list of addresses. User may enter multiple email addresses for blind carbon copies.
14	HideIn	tinyint(4)	Enum:HideInFlags None=0,EmailInbox=1,ApptEdit=2,ContrChartProgNotes=4,ContrAccountGridProg. Indicates which places in the program that should not show this email message, bitwise. 0 means don't hide anywhere.
None: 0 - None
EmailInbox: 1 - Hide email from EmailInbox grids
ApptEdit: 2 - Hide email from Appointment Edit grid
ChartProgNotes: 4 - Hide email from ContrChart ProgNotes grid
AccountProgNotes: 8 - No Longer Used - Was used to hide email from ContrAcount ProgNotes grid
AccountCommLog: 16 - Hide email from ContrAcount CommLog grid
15	AptNum	bigint(20)	FK to appointment.AptNum. Used to a attach an email to an appointment for eReminders and eConfirmations.
16	UserNum	bigint(20)	FK to userod.UserNum. Optional. 0 if unknown (ex recieved emails).
17	HtmlType	tinyint(4)	Enum:EmailType
Regular: 0 - This is a regular email that may contain our special wiki markup. Not converted to html.
Html: 1 - Html. Basic html email which uses the master template supplied by OD. Template includes header, styles, and the opening body tag. The user only needs to provide the body itself, which can inclcude tags that get automatically replaced.
RawHtml: 2 - More advanced html that does not include the master template. User must provide everything.
18	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
19	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
20	MsgType	varchar(255)	Enum:EmailMessageSource Stored in db as string. This is used to identify where in the program this message originated from. This is used for sent email messages.
Undefined: Should not be used.
Legacy: This is used for all existing messages prior to v21.1.6.0.
Confirmation: Confirmation messages.
Cryo: Oregon Cryonics.
EConfirmation: Auto eConfirmation messages.
EHR: EHR messages.
EReminder: Auto eReminder messages.
Forward: Forward messages.
Hosting: Generated by Open Dental email hosting.
JobManager: Jobmanager messages.
Manual: Manual messages by office.
PatPortalInvite: Auto Patient portal invites.
PatPortalReset: Auto Patient portal pass code reset.
PaymentReceipt: Payment receipt.
Promotion: Auto Promotion messages.
Recall: Recall messages.
Reply: Reply messages.
Sheet: Sheet messages.
Statement: Statement messages.
ThankYou: Auto Thankyou messages.
TreatmentPlan: Treatment plan messages.
Verification: Auto verification messages.
WebMail: Webmail messages.
WebSchedASAP: Auto websched ASAP messages.
WebSchedRecall: Auto websched recall messages.
GeneralMessage: Appointment General Message.
NewPatThankYou: New patient web form thank you message.
MsgToPay: Payment Portal Msg-To-Pay message
EClipboardWeb: EClipboard Web URL message
21	FailReason	text	Reason the message failed to send. Blank if sent successful.

emailmessageuid
Used to track which email messages have been downloaded into the inbox for a particular recipient address. Not linked to the email message itself because no link is needed. If we decide to add a foreign key to a EmailMessage later, we should consider what do to when an email message is deleted (set the foreign key to 0 perhaps).
Order	Name	Type	Summary
0	EmailMessageUidNum	bigint(20)	Primary key.
1	MsgId	text	The unique id for the associated EmailMessage.
2	RecipientAddress	varchar(255)	Copied from the EmailAddress.EmailUsername field when a message is received into the inbox. Similar to the ToAddress of the EmailMessage, except the ToAddress could contain multiple recipient addresses or group email address instead. The recipient address helps match the EmailMessageUid to a particular EmailAddress.

emailsecure
Tracks every secure email sent and received from or to a patient.
Order	Name	Type	Summary
0	EmailSecureNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
2	PatNum	bigint(20)	FK to patient.PatNum.
3	EmailMessageNum	bigint(20)	FK to emailmessage.EmailMessageNum. 0 indicates email has not been successfully downloaded from API yet.
4	EmailChainFK	bigint(20)	FK to emailchain, as hosted by API. Table does not exist at dental office.
5	EmailFK	bigint(20)	FK to email, as hosted by API. Table does not exist at dental office.
6	DateTEntry	datetime	DateTime the entry was inserted
7	SecDateTEdit	timestamp	DateTime the entry was edited.

emailsecureattach
Tracks every attachment linked to a secure email.
Order	Name	Type	Summary
0	EmailSecureAttachNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
2	EmailAttachNum	bigint(20)	FK to emailattach.EmailAttachNum. 0 indicates attachment has not been successfully downloaded from API yet.
3	EmailSecureNum	bigint(20)	FK to emailsecure.EmailSecureNum.
4	AttachmentGuid	varchar(50)	Attachment identifier, as hosted by API. Table does not exist at dental office.
5	DisplayedFileName	varchar(255)	The displayed name of the file/object.
6	Extension	varchar(255)	The extension of the object (i.e. png).
7	DateTEntry	datetime	FK to email, as hosted by API. Table does not exist at dental office.
8	SecDateTEdit	timestamp	DateTime the entry was edited.

emailtemplate
A template email which can be used as the basis for a new email.
Order	Name	Type	Summary
0	EmailTemplateNum	bigint(20)	Primary key.
1	Subject	text	Default subject line.
2	BodyText	text	Body of the email
3	Description	text	Different than Subject. The description of the email template. This is what the user sees in the list.
4	TemplateType	tinyint(4)	Enum:EmailType
Regular: 0 - This is a regular email that may contain our special wiki markup. Not converted to html.
Html: 1 - Html. Basic html email which uses the master template supplied by OD. Template includes header, styles, and the opening body tag. The user only needs to provide the body itself, which can inclcude tags that get automatically replaced.
RawHtml: 2 - More advanced html that does not include the master template. User must provide everything.

employee
An employee at the dental office.
Order	Name	Type	Summary
0	EmployeeNum	bigint(20)	Primary key.
1	LName	varchar(255)	Employee's last name.
2	FName	varchar(255)	First name.
3	MiddleI	varchar(255)	Middle initial or name.
4	IsHidden	tinyint	If hidden, the employee will not show on the list.
5	ClockStatus	varchar(255)	This is just text used to quickly display the clockstatus. eg Working,Break,Lunch,Home, etc.
6	PhoneExt	int(11)	The phone extension for the employee. e.g. 101,102,etc. This field is only visible for user editing if the pref DockPhonePanelShow is true (1).
7	PayrollID	varchar(255)	Used to store the payroll identification number used to generate payroll reports. ADP uses six digit number between 000051 and 999999.
8	WirelessPhone	varchar(255)	
9	EmailWork	varchar(255)	
10	EmailPersonal	varchar(255)	
11	IsFurloughed	tinyint(4)	
12	IsWorkingHome	tinyint(4)	
13	ReportsTo	bigint(20)	FK to employee.EmployeeNum

employer
Most insurance plans are organized by employer. This table keeps track of the list of employers. The address fields were added at one point, but I don't know why they don't show in the program in order to edit. Nobody has noticed their absence even though it's been a few years, so for now we are just using the EmpName and not the address.
Order	Name	Type	Summary
0	EmployerNum	bigint(20)	Primary key.
1	EmpName	varchar(255)	Name of the employer.
2	Address	varchar(255)	.
3	Address2	varchar(255)	Second line of address.
4	City	varchar(255)	.
5	State	varchar(255)	2 char in the US.
6	Zip	varchar(255)	.
7	Phone	varchar(255)	Includes any punctuation.

encounter
Mostly used for EHR. This rigorously records encounters using rich automation, so that reporting can be easy and meaningful. Encounters can also be tracked separately using billable procedures. In contrast, encounters in this table are not billable. There can be multiple encounters at one appointment because there can be different types.
Order	Name	Type	Summary
0	EncounterNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ProvNum	bigint(20)	FK to provider.ProvNum.
3	CodeValue	varchar(30)	FK to ehrcode.CodeValue. This code may not exist in the ehrcode table, it may have been chosen from a bigger list of available codes. In that case, this will be a FK to a specific code system table identified by the CodeSystem column. The code for this item from one of the code systems supported. Examples: 185349003 or 406547006.
4	CodeSystem	varchar(30)	FK to codesystem.CodeSystemName. This will determine which specific code system table the CodeValue is a FK to. We only allow the following CodeSystems in this table: CDT, CPT, HCPCS, and SNOMEDCT.
5	Note	text	
6	DateEncounter	date	Date the encounter occurred

entrylog
Stores entries made for AppointmentCreate. Acts as an additional securitylog entry.
Order	Name	Type	Summary
0	EntryLogNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum
2	FKeyType	tinyint(4)	Enum:EntryLogFKeyType
Appointment: 0
3	FKey	bigint(20)	A foreign key to a table associated with the EntryLogFKeyType.
4	LogSource	tinyint(4)	Enum:LogSources
None: 0 - Open Dental and unknown entities.
WebSched: 1 - GWT Web Sched application Recall version.
InsPlanImport834: 2 - X12 834 Insurance Plan Import from the Manage Module.
HL7: 3 - HL7 is an automated process which the user may not be aware of.
DBM: 4 - Database maintenance. This process creates patients which are known to be missing, but the user may not be aware that the fix involves patient recreation.
FHIR: 5 - FHIR is an automated process which the user may not be aware of.
PatientPortal: 6 - Patient Portal application.
WebSchedNewPatAppt: 7 - GWT Web Sched application New Patient Appointment version
AutoConfirmations: 8 - Automated eConfirmation and eReminders
Diagnostic: 9 - Open Dental messages created for debugging and diagnostic purposes. For example, to diagnose an unhandled exception or unexpected behavior that is otherwise too hard to diagnose.
MobileWeb: 10 - Mobile Web application.
CanadaEobAutoImport: 11 - When retrieving reports in the background of FormOpenDental
WebSchedASAP: 12 - Web Sched application for moving ASAP appointments.
OpenDentalService: 13 - OpenDentalService.
BroadcastMonitor: 14 - Broadcast Monitor.
AutoLogOff: 15 - Automatic log off from main form. Used to track when auto log off needs to kill the program to force close open forms which are blocked or slow to respond.
ODMobile: 16 - ODMobile App.
TextMessaging: 17 - Open Dental text messaging.
CareCredit: 18 - CareCredit.
WebSchedExistingPatient: 19 - GWT Web Sched application Existing Patient Appointmention version
eRx: 20 - eRx
SignupPortal: 21 - SignupPortal
EmployerImport834: 22 - X12 834 Employer Import from the Manage Module.
API: 23 - The non-FHIR API.
ClaimReceiveAutomatic: 24 - Indicates that a claim was automatically received.
PaymentPortal: 25 - Indicates that a payment was made from the Payment Portal.
5	EntryDateTime	datetime	The date and time of the entry. Its value is set when inserting and can never change. Even if a user changes the date on their computer, this remains accurate because it uses server time.

eobattach
One file attached to an eob (claimpayment). Multiple files can be attached to an eob using this method. Order shown will be based on date/time scanned.
Order	Name	Type	Summary
0	EobAttachNum	bigint(20)	Primary key.
1	ClaimPaymentNum	bigint(20)	FK to claimpayment.ClaimPaymentNum. Will be zero if this eobattach is for a preauthorization.
2	DateTCreated	datetime	Date/time created.
3	FileName	varchar(255)	The file is stored in the A-Z folder in 'EOBs' folder. This field stores the name of the file. The files are named automatically based on Date/time along with EobAttachNum for uniqueness.
4	RawBase64	text	The raw file data encoded as base64. Only used if there is no AtoZ folder.
5	ClaimNumPreAuth	bigint(20)	FK to claim.ClaimNum of a preauthorization. Will be zero if this eobattach is for a claimpayment.

equipment
Used for property tax tracking.
Order	Name	Type	Summary
0	EquipmentNum	bigint(20)	Primary key.
1	Description	text	Short description, need not be very unique.
2	SerialNumber	varchar(255)	Must be unique among all pieces of equipment. Auto-generated 3 char alpha numeric gives 1.5M unique serial numbers. Zero never part of autogenerated serial number.
3	ModelYear	varchar(2)	Limit 2 char.
4	DatePurchased	date	Date when this corporation obtained the equipment. Always has a valid value.
5	DateSold	date	Normally 01-01-0001 if equipment still in possession. Once sold, a date will be present.
6	PurchaseCost	double	.
7	MarketValue	double	.
8	Location	text	Freeform text.
9	DateEntry	date	Security uses this date to lock older entries from accidental deletion. Date, no time.
10	ProvNumCheckedOut	bigint(20)	FK to provider.ProvNum. Only filled in if equipment has been checked out, otherwise 0.
11	DateCheckedOut	date	Only used when equipment has been checked out.
12	DateExpectedBack	date	Only used when equipment has been checked out. Defaults to same day as check out.
13	DispenseNote	text	Any notes regarding the equipment checked out.
14	Status	text	Status of the equipment.

erouting
A set of actions to take in sequence for each interaction with a specific patient. Individual actions are in eRoutingAction. Templates are in eRoutingDef. Only used in eClipboard for now.
Order	Name	Type	Summary
0	ERoutingNum	bigint(20)	Primary Key.
1	Description	varchar(255)	Copied from eRoutingDef.
2	PatNum	bigint(20)	FK to patient.PatNum. The patient this eRouting is for.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum. The clinic this patient eRouting is in. Set to 0 if in headquarters or clinics are disabled.
4	SecDateTEntry	datetime	The DateTime this eRouting was created. eRoutings are created when they are started. Not able to edited by the user.
5	IsComplete	tinyint(4)	eRouting is considered complete if this is true. Used on backend to get incomplete eRouting without checking eRoutingActions

eroutingaction
A single action attached to a eRouting. Only used in eClipboard for now.
Order	Name	Type	Summary
0	ERoutingActionNum	bigint(20)	Primary Key
1	ERoutingNum	bigint(20)	FK to erouting.ERoutingNum
2	ItemOrder	int(11)	Copied from eRoutingActionDef.ItemOrder.
3	ERoutingActionType	tinyint(4)	Enum:EnumERoutingActionType
None: 0-Shouldn't be present in db. Used in UI when user has not yet picked an action type.
PerioChart: 1-Perio Chart
TreatmentPlan: 2-Treatment Plan
PaymentPlan: 3-Payment Plan
ChartProcedures: 4-Chart Procedures
Imaging: 5-Imaging
CompleteAppointment: 6-Complete Appointment
TakePayment: 7-Take Payment
ScheduleFollowup: 8-Schedule Follow up
eRx: 9-ERX
ExamSheet: 10-Exam Sheet
ConsentForm: 11-Consent Form
Medical: 12-Medical
ChecklistItem: 13-Checklist Item
4	UserNum	bigint(20)	FK to userod.UserNum. This is the user that completed the action. If not complete, this will be 0.
5	IsComplete	tinyint(4)	True if marked complete, otherwise set to false.
6	DateTimeComplete	datetime	The date and time this action was set complete by the user.
7	ForeignKeyType	tinyint(4)	Enum:EnumERoutingFKType Indicates the type of object that ForeignKey references. None=0, Sheet=1
8	ForeignKey	bigint(20)	FK to attached object. Type is indicated by ForeignKeyType. Sheet for Consent forms.
9	LabelOverride	varchar(255)	Override for the title of the eRouting Action. This will be shown in the eClipboard UI instead of EnumERoutingActionType description if it is present.

eroutingactiondef
A single action attached to an ERoutingDef. Changing these does not alter any patient records. Only used in ODTouch for now.
Order	Name	Type	Summary
0	ERoutingActionDefNum	bigint(20)	PK
1	ERoutingDefNum	bigint(20)	FK to erouting.eRoutingDefNum. Defines what eRouting this action is tied to
2	ERoutingActionType	tinyint(4)	Enum:EnumeRoutingActionType
3	ItemOrder	int(11)	Determines the order the items show in the eRoutingactiondef and what order they are to be completed in.
4	SecDateTEntry	datetime	The date this action definition was created. Not able to edited by the user.
5	DateTLastModified	datetime	The date time this action was last changed. Not able to be edited by the user.
6	ForeignKeyType	tinyint(4)	Enum:EnumERoutingDefFKType Indicates the type of object that ForeignKey references. None=0, SheetDef=1
7	ForeignKey	bigint(20)	FK to attached object. Type is indicated by ForeignKeyType. SheetDef for Consent forms.
8	LabelOverride	varchar(255)	Override for the title of the eRouting Action. This will be shown in the eClipboard UI instead of EnumERoutingActionType description if it is present.

eroutingdef
A set of actions to take in sequence for each interaction with a patient. Individual actions are in eRoutingActionDef. Changing these does not alter any patient records. Only used in eClipboard for now.
Order	Name	Type	Summary
0	ERoutingDefNum	bigint(20)	
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Represents the clinic that the eRouting is tied to, if any. Can be 0.
2	Description	varchar(255)	The name of the eRouting.
3	UserNumCreated	bigint(20)	FK to userod.UserNum. The user that created this eRouting. Cannot be edited by user.
4	UserNumModified	bigint(20)	FK to userod.UserNum. The user that last edited this eRouting. Cannot be edited by user.
5	SecDateTEntered	datetime	Date Time this eRouting was created. Cannot be edited by user.
6	DateLastModified	datetime	Date time this eRouting was last edited. Cannot be edited by user.

eroutingdeflink
There can be multiple eRoutingDefLinks for each eRoutingDef. For example, one eRoutingDef could have 4 appointment types as well as a billing type, for a total of 5 eRoutingDefLinks. If an appointment has a matching AppointmentType and BillingType, then that eRouting is used.
Order	Name	Type	Summary
0	ERoutingDefLinkNum	bigint(20)	PK
1	ERoutingDefNum	bigint(20)	FK to eroutingdef.eRoutingDefNum.
2	Fkey	bigint(20)	FK to other tables. Dictated by the FKey Type.
3	ERoutingType	tinyint(4)	Enum:EnumeRoutingType

erxlog
Order	Name	Type	Summary
0	ErxLogNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	MsgText	mediumtext	Holds up to 16MB.
3	DateTStamp	timestamp	Automatically updated by MySQL every time a row is added or changed.
4	ProvNum	bigint(20)	FK to provider.ProvNum. The provider that the prescription request was sent by or on behalf of.
5	UserNum	bigint(20)	FK to userod.UserNum. The user that created the erx.

eservicelog
Stores an ongoing record of EServices activity. User not allowed to edit.
Order	Name	Type	Summary
0	EServiceLogNum	bigint(20)	Primary key.
1	LogDateTime	datetime	The date and time of the entry. It's value is set when inserting and can never change. Even if a user changes the date on their computer, this remains accurate because it uses server time.
2	PatNum	bigint(20)	FK to patient.PatNum. Can be 0 if not applicable.
3	EServiceType	tinyint(4)	Enum:eServiceType Indicates which eService feature this log entry is associated with, such as Web Sched, Patient Portal, or eClipboard.
Unknown: 0. In the case of an action, this means Unknown.
WSRecall: 1. This means the action done was a Web Sched Recall.
WSNewPat: 2. This means the action done was for a New Patient.
WSExistingPat: 3. This means the action done was for an Existing Patient.
WSAsap: 4. This means the action done was for a Web Sched ASAP.
PatientPortal: 5. This means the action done was for a Patient Portal.
EClipboard: 6. This means the action done was for a Mobile Checkin.
ApptConfirmations: 7. This means the action done was for a Appointment Confirmations.
WebForms: 8. This means the action done was for a WebForm.
WSGeneral: 9. This means the action done was for unspecified WebSched.
Arrivals: 10. This means the action done was for Arrivals.
IntegratedTexting: 11. This means the action done was for Integrated Texting.
ODTouch: 12. This means the action done was for the mobile app ODTouch.
PaymentPortal: 13. This means the action done was for the Payment Portal.
BetterDiag: 14. This means the action done was for the Better Diagnostics AI bridge.
MassEmail: 15. This means the action was done for Mass Email.
Pearl: 16. This means the action was done for the Pearl AI bridge. Pearl is technically not an eService, but is logged using this table.
4	EServiceAction	smallint(6)	Enum:eServiceAction Describes the specific action or event that occurred within the eService, such as scheduling an appointment, submitting a form, or logging in.
Undefined: 0 - Should not be in the database.
WSHomeView: 1 - Patient arrives at home view.
WSServiceSelect: 2 - Patient chooses between new/existing/recall appointment on home view.
WSIdentify: 3 - Patient identifies themselves.
WSScheduler: 4 - Patient arrives at the scheduler page.
WSMonthSwitch: 5 - Patient switches months in the timeslot picker.
WSTimeSlotChoose: 6 - Patient selects an open timeslot.
WSConfirmationPopup: 7 - Patient recieves the confirmation popup.
WSDateTimeYes: 8 - Patient accepted the datetime.
WSDateTimeNo: 9 - Patient declines the datetime.
WSTwoFactorSent: 10 - Patient was sent a 2FA code.
WSTwoFactorPassed: 11 - Patient successfully passed 2FA.
WSAppointmentScheduleFromClient: 12 - Patient schedules appointment.
WSAppointmentScheduledFromServer: 13 - Appointment scheduled.
CONFConfirmedAppt: 14 - Appointment confirmation.
WSMovedAppt: 15 - Appointment has been moved.
PPLoggedIn: 16 - Patient logged into patient portal.
PPMadePayment: 17 - Deprecated. Do not use.
ECAddedForm: 18 - Form created.
ECCompletedForm: 19 - Form was filled out.
ECLoggedIn: 20 - eClipboard Checked In.
WFCompletedForm: 21 - Web Forms Form Completed.
WSRecallNotFound: 22 - Web Sched Recall Not Found.
WSRecallAlreadyScheduled: 23 - Web Sched Already Scheduled.
ArrivalReceived: 24 - Arrivals, patient arrived.
IntegratedTextingOptOut: 25 - Integrated Texting, Patient Opted Out.
PPStatementPortalArrived: 26 - Patient Portal, Patient Arrived At Statement Portal.
PPStatementPortalLoggedIn: 27 - Patient Portal, Patient Logged In At Statement Portal.
PPStatementPortalDownloadStatement: 28 - Patient Portal, Patient Downloaded Statement.
PPPaymentFormOpened: 29 - Patient Portal, Patient Opened Payment Form.
PPPaymentFormOpenedFromLogin: 30 - Patient Portal, Patient Opened Payment Form From Login.
PPOpenedHostedPaymentForm: 31 - Patient Portal, Patient Opened Hosted Payment Form.
PPPayWithExistingFromClient: 32 - Patient Portal, Patient Paid With Existing Card.
PPPaymentCreatedByXWeb: 33 - Patient Portal, Patient Submitted Payment With XWeb.
PPPaymentCreatedByPayconnect: 34 - Patient Portal, Patient Submitted Payment With PayConnect.
PPDuplicatePaymentAlert: 35 - Patient Portal, Patient Notified of Possible Duplicate Payment.
PPDuplicatePaymentAllowed: 36 - Patient Portal, Patient Allowed Submission of Duplicate Payment.
PPDuplicatePaymentDenied: 37 - Patient Portal, Patient Rejected Submission of Duplicate Payment.
ECCheckInBYOD: 38 - eClipboard - Check In for patients bringing their own device
ECCheckInStarted: 39 - eClipboard - Check In process started
ECCheckInArrived: 40 - eClipboard - Check In Arrived
ECCheckInSubmitted: 41 - eClipboard - Check In Submitted
ECCheckInErrorApptNotFound: 42 - eClipboard - Check In Error: Appt Not Found
ECCheckInErrorPatNumNotLinkedToAppt: 43 - eClipboard - Check In Error: PatNum Not Linked To Appt
ECCheckInErrorDeviceSetupForOtherClinic: 44 - eClipboard - Error: Device Setup for Other Clinic
ECCheckInErrorDeviceNotAllowedForCheckin: 45 - eClipboard - Check In Error: Device Not Allowed for Checkin
ECCheckInErrorOfficeDeviceUsedAsBYOD: 46 - eClipboard - Check In Error: Office Device used as BYOD
ECCheckInErrorNoApptFoundBYOD: 47 - eClipboard - Check In Error: No Appointment Found BYOD
ECCheckInErrorNoApptFound: 48 - eClipboard - Check In Error: No Appt Found
ECCheckInErrorMultiplePatsFound: 49 - eClipboard - Check In Error: Multiple Pats Found
ECCheckInErrorSignatureError: 50 - eClipboard - Check In Error: Signature Error
ECCheckInErrorDeprecatedMethod: 51 - eClipboard - Check In Error: Deprecated Method
ECCheckInConfirmedApptWithProvYes: 52 - eClipboard - Check In Confirmed Appt With Prov - Yes
ECCheckInConfirmedApptWithProvNo: 53 - eClipboard - Check In Confirmed Appt With Prov - No
ECCheckInListSubmittedWithPicture: 54 - eClipboard - Check In Took selfie before submitting
ECCheckInListSubmittedWithOutPicture: 55 - eClipboard - Check In List Did not take selfie before submitting
ECCheckInListErrorSubmittedWithoutAllItems: 56 - eClipboard - Check In List Error, submitted without all items
ECCheckInListXamSubmitError: 57 - eClipboard - Check In List Submit Xamarin Error
ECCheckInListSumbitSuccess: 58 - eClipboard - Check In Submit Success
ECCheckInListSumbitSuccessBYOD: 59 - eClipboard - Check In Submit Success BYOD
ECCheckInListSelectedItem: 60 - eClipboard - Check In List Selected Item
ECCheckInListSheetNextTapped: 61 - eClipboard - Check In List Sheet Next Tapped
ECCheckInListSheetPrevTapped: 62 - eClipboard - Check In List Sheet Prev Tapped
ECCheckInListSheetOfficeSignedTreatPlan: 63 - eClipboard - Check In List Sheet Office signed Treatment Plan
ECCheckInListSheetPatientSignedTreatPlan: 64 - eClipboard - Check In List Sheet Patient signed treatment plan
ECCheckInListSheetPatientSignedPaymentPlan: 65 - eClipboard - Check In List Sheet Patient signed Payment Plan
ECPatientDirectedToMakePayment: 66 - eClipboard - Check In List Sheet Patient signed Payment Plan
ECBYODValidationReached: 67 - eClipboard - BYOD 6 Digit validation page reached
ECBYODValidationFailed: 68 - eClipboard - BYOD 6 Digit validation failed
ECBYODValidationSuccess: 69 - eClipboard - BYOD 6 Digit validation success
EC2FactorAuthShown: 70 - eClipboard - 2 Factor Auth Screen Shown
EC2FactorAuthClosed: 71 - eClipboard - 2 Factor Auth Close Clicked
EC2FactorAuthEmailSelected: 72 - eClipboard - 2 Factor Auth Email Selected
EC2FactorAuthTextSelected: 73 - eClipboard - 2 Factor Auth Text Selected
EC2FactorAuthCodeSubmitted: 74 - eClipboard - 2 Factor Auth Code Submitted
EC2FactorAuthCodeSuccess: 75 - eClipboard - 2 Factor Auth Code Success
EC2FactorAuthCodeFail: 76 - eClipboard - 2 Factor Auth Code Fail
DoNotLog: 77 - Used in Xam Exceptions. If this is sent back, error will not be logged. Default eServiceAction for XamException.
ECOpenPaymentPage: 78 - eClipboard - patient opens payment page. Note should indicate where it is opened from
ECAddCreditCardTapped: 79 - eClipboard - User tapped "Add Card"
ECCreditCardManageDoneTapped: 80 - eClipboard - User tapped 'Done' on credit card manage page
ECCreditCardRemoved: 81 - eClipboard - User removed a credit card
ECCreditCardPaymentWithNewCard: 82 - eClipboard - User made payment with new credit card
ECCreditCardPaymentWIthExistingCard: 83 - eClipboard - User made payment with existing credit card
ECCreditCardPaymentCancelled: 84 - eClipboard - User tapped cancel when making a payment
ECCreditCardErrorDeleteCardNotFound: 85 - eClipboard - Error: Delete card not found
ECCreditCardErrorDeleteCardPatNumDoesNotMatch: 86 - eClipboard - Error: Delete credit card patnum does not match current patnum
ECCreditCardErrorDeleteCardInvalidAlias: 87 - eClipboard - Error: Delete credit card invalid alias
ECCreditCardErrorDeleteCardPatientNotFound: 88 - eClipboard - Error: Delete credit card patient not found
ECCreditCardErrorMakingPaymentWithAlias: 89 - eClipboard - Error: error making payment
ECCreditCardErrorMakingPaymentPatientNotFound: 90 - eClipboard - Error: Making Payment, patient not found
ECCreditCardErrorMakingPaymentInvalidAmount: 91 - eClipboard - Error: Making Payment, invalid amount
ECQRScanAttempt: 92 - EClipboard - QR scan window activated
ECQRScanCancel: 93 - EClipboard - QR scan window cancelled
ECQRScanOk: 94 - EClipboard - QR scan window success
ECSubmitSheetFailed: 95 - EClipboard - Error: Failed to submit sheet or eForm
WFDownloadedForm: 96 - Web Forms Form Downloaded.
WFDiscardedForm: 97 - Web Forms Form Discarded.
WFSkippedForm: 98 - Web Forms Form Skipped.
WFDeletedForm: 99 - Web Forms Form Deleted.
WFError: 100 - Web Forms Error.
WFCancelled: 101 - Web Forms Cancelled Import.
PayPortalArrived: 102 - Payment Portal - Unverified user arrived at the payment portal
PayPortalArrivedWithSessionToken: 103 - Payment Portal - Verified user arrived at the payment portal
PayPortalArrivedWithPayGuid: 104 - Payment Portal - User arrived at the payment portal via message-to-pay
SelectedPatient: 105 - Web App - User provided patient information within the patient selection view
PayPortalSwitchedToCorrectClinic: 106 - Payment Portal - Switched to selected patient's clinic
PayPortalRequestedCodeViaEmail: 107 - Payment Portal - User requested an email authentication code
PayPortalRequestedCodeViaSms: 108 - Payment Portal - User requested a text authentication code
PayPortalAuthenticatedViaEmail: 109 - Payment Portal - User verified identity with an email authentication code
PayPortalAuthenticatedViaSms: 110 - Payment Portal - User verified identity with an SMS authentication code
PayPortalUseAmountDue: 111 - Payment Portal - User opted to pay amount due
PayPortalEnteredPayAmount: 112 - Payment Portal - User entered a custom amount to pay
PayPortalSelectedPaymentMethod: 113 - Payment Portal - User selected an existing payment method
PayPortalHostedFormLoaded: 114 - Payment Portal - The make payment window was loaded
PayPortalPaymentSucceeded: 115 - Payment Portal - The payment was processed successfully
PayPortalClickedPrint: 116 - Payment Portal - The user printed their receipt
WebAppError: 117 - Web App - The user received an error
BetterDiagPass: 118 - Better Diagnostics AI - The BD API passed back 200 (OK).
BetterDiagFail: 119 - Better Diagnostics AI - The BD API passed back non 200 (not OK).
BetterDiagException: 120 - Better Diagnostics AI - The BD API thew an exception.
ECCheckinErrorEFormToImaging: 121 eClipboard - Error: Submitted EForm Failed to Save to Imaging Module.
MassEmailUpload: 122 - Mass Email - Email Addresses Uploaded
MassEmailUploadError: 123 - Mass Email - Email Addresses Uploaded
MassEmailReceipt: 124 - Mass Email Receipt
OcrInsuranceCardScannerError: 125 - eClipboard - OCR insurance card scanner error
PearlSentImage: 126 - Pearl - Image uploaded to Pearl API. Only logged once a day per clinic.
AppLoaded: 127 - Web Sched - The application loaded without issue
VerificationMethodSelected: 128 - Web Sched - User selected a two-factor authentication method
InsuranceInfoPresented: 129 - Web Sched - User arrived at the insurance information view
ApptReasonSelected: 130 - Web Sched - User selected an appointment reason
ApptConfirmPresented: 131 - Web Sched - User prompted to confirm appointment details
ApptConfirmAttempted: 132 - Web Sched - User confirmed their appointment details
ScheduleAnotherAppt: 133 - Web Sched - User chose to schedule another appointment
5	KeyType	smallint(6)	Enum:FKeyType
Undefined: 0 Undefined.
ApptNum: 1 Appointment Number.
PayNum: 2 Payment Number.
SheetNum: 3 Sheet Number.
UtmNum: 4 Utm Number.
WebFormSheetID: 5 Web Form Sheet Number.
SmsMtSentNum: 6 SmsMtSent Number
SmsMtTerminatedNum: 7 SmsMtTerminated Number
EFormNum: 8 EForm Number.
6	LogGuid	varchar(36)	Guid for logging actions with no associated PatNum.
7	ClinicNum	bigint(20)	Clinic Number.
8	FKey	bigint(20)	FKey for given type.
9	DateTimeUploaded	datetime	The time this log was uploaded.
10	Note	varchar(255)	Additional information for the log. This is intentionally limited to 255 characters to prevent bloat. Add any new uses of this field to the list below. Provide the eServiceAction types and what the Note field represents for those types. PPPaymentCreatedByXWeb: The amount of the payment. PPPaymentCreatedByPayconnect: The amount of the payment. PPOpenedHostedPaymentForm: The name of the merchant service that the hosted payment form belongs to.

eserviceshortguid
For example, links a statement to a specific MsgToPay. ShortGuids are usually generated at ODHQ.
Order	Name	Type	Summary
0	EServiceShortGuidNum	bigint(20)	Primary key.
1	EServiceCode	varchar(255)	Enum:eServiceCode EService that this short GUID applies to.
Undefined: 0 - Should not be used. If you are seeing this then an entry was made incorrectly.
ListenerService: 1 - Runs 1 instance per customer on a given client PC.
IntegratedTexting: 2 - Runs 1 instance total on HQ server.
HQProxyService: 3 - Runs 1 instance total on HQ server.
MobileWeb: 4 - EService WebApp.
PatientPortal: 5 - EService WebApp.
WebSched: 6 - EService WebApp. The "Recall" version of Web Sched.
WebForms: 7 - EService WebApp.
ResellerPortal: 8 - EService WebApp.
FeaturePortal: 9 - EService WebApp.
ConfirmationRequest: 10 - EService WebApp.
OAuth: 11 - EService WebApp.
FHIR: 12 - RESTful API from HL7.
WebSchedNewPatAppt: 13 - EService WebApp. The "New Patient Appointment" version of Web Sched.
HQManager: 14 - HQ only WebApp. Allows HQ to remotely modify web services.
Bundle: 15 - Entitles this practice/clinic to all eServices. Supercedes any other repeat charges for this practice/clinic.
IntegratedTextingUsage: 16 - IntegratedTexting is the actual enum value for texting access. This value is for the usage portion. Not used in billing, mainly used to keep technicians from manually adding the "TextUse" procedure code as a repeating charge.
ResellerSoftwareOnly: 17 - Resellers need to be able to give this service (not technically an eService) to their customers via sign up portal.
SignupPortal: 18 - Denotes the SignupPortal web app. Only currently used to get a new URL path separate from FeaturePortal.
SoftwareUpdate: 19 - Used by WebServiceCustomerUpdate to ask WebServiceHQ if this RegKey is eligible for OD proper version updates.
WebSchedASAP: 20 - EService Web App. The "ASAP" version of Web Sched.
BugSubmission: 21 - Request made to store information about unhandled exceptions
PatientPortalMakePayment: 22 -
PatientPortalViewStatement: 23 -
WebHostSynch: 24 -
Headmaster: 25 - Monitoring app used by OD HQ.
EClipboard: 26 - EClipboard mobile application.
ODHelp: 27 - Displays Help information.
PaySimple: 28- Originally for paysimple ACH payments
CustomerVersion: 29 - Used for storing customers OD software versions.
ConfirmationOwn: 30 - eServiceCode that corresponds to ProcCode 045 in customers db at HQ. Not used for eService validation. Use ConfirmationRequest insted.
IntegratedTextingOwn: 31 - eServiceCode that corresponds to ProcCode 046 in customers db at HQ. Not used for eService validation. Use IntegratedTexting insted.
SoftwareOnly: 32 - eServiceCode that corresponds to ProcCode 030 in customers db at HQ. Not used for eService validation.
SupplementalBackup: 33
EmailMassUsage: 34 - Will have a $0 RepeatCharge. Procedure will be generated each month as a function of number of masss email messages sent. Each email message has an incremental cost.
EmailSecureUsage: 35 - Will have a $0 RepeatCharge. Procedure will be generated each month as a function of number of secure email messages sent. Each email message has an incremental cost.
EmailSecureAccess: 36 - Has a RepeatCharge. Clinics sign up for access to use secure email. Each email sent will be charged an additional fee, see EmailSecureUsage.
ApptThankYou: 37 - eService for Automated Appointment Thank-Yous and calendar events.
OregonCryo: 38.
EserviceLog: 39 - eServices logging service.
LicenseAgreementSig: 40 - Used for storing customers license agreement acceptance signature.
WebFormManager: 41 - A Windows service running at HQ that is monitored by Headmaster.
ODTouch: 42 - Eclipboard Clinical Mobile application. Not included in the bundle.
PaymentPortalUI: 43 - Payment Portal UI.
PaymentPortalApi: 44 - Payment Portal Api.
EServiceApi: 45 - EService Api.
AuthApi: 46 - Auth Api.
ODTSurplus: 47 - ODTouch Mobile application surcharge for additional devices that exceed the ODTouchDeviceLimitDefault pref.
OCR: 48 - OCR Scans
UrlRedirect: 49 - Used by ShortGuidLookup to redirect from an OD-generated Short URL to a long URL provided by customer.
DeveloperPortalApi: 50 - Developer Portal API
DeveloperPortalUI: 51 - Developer Portal UI
EmailHqService: 52 - Email Transmission HQ Service
BetterDiagnostics: 53 - Better Diagnostics AI. Not included in the bundle.
EmailMassAccess: 54 - eService for Mass email signup. Not included in the bundle.
WebSchedExistingPatientUI: 55 - Web Sched Existing Patient UI
WebSchedExistingPatientApi: 56 - Web Sched Existing Patient Api
2	ShortGuid	varchar(255)	A unique alphanumeric string that identifies something.
3	ShortURL	varchar(255)	URL generated by HQ.
4	FKey	bigint(20)	Usually identifies the object that is linked to ShortGUID.
5	FKeyType	varchar(255)	Describes the type of object referenced by the FKey.
6	DateTimeExpiration	datetime	Timestamp at which this short GUID will expire..
7	DateTEntry	datetime	The exact server time when this EServiceShortGuid was entered into db. Handled automatically.

eservicesignal
Communication item from workstation to OD HQ. Stores the statuses of the eConnector and other eServices.
Order	Name	Type	Summary
0	EServiceSignalNum	bigint(20)	Primary key.
1	ServiceCode	int(11)	Enum eServiceCode. Service which this signal applies to.
2	ReasonCategory	int(11)	The enum is at HQ as OpenDentalWebCore.BroadcasterThreadDefs. Can be zero if no grouping is necessary per a given service.
3	ReasonCode	int(11)	The enum is at HQ as OpenDentalWebCore.BroadcasterErrorCodes. This code is used to determine what actions to take and how to process this message. It is a function of ReasonCategory. It will most likely be defined by an enum that lives on HQ-only closed source.
4	Severity	tinyint(4)	Enum:eServiceSignalSeverity
None: Service is not in use and is not supposed to be in use.
NotEnabled: 0-Service is not in use and is not supposed to be in use.
Info: 1-Used to convey information. Does not change the "working" status of the service. Will always be inserted with IsProcess=true.
Working: 2-Service is operational and working as designed. Typcially used for heartbeat and initialization.
Warning: 3-Recoverable error has has occurred and no user intervention is required. Typically requires user acknowledgement only.
Error: 4-Recoverable error has has occurred and user intervention is probably required in addition to user acknowledgement only.
Critical: 5-Unrecoverable error and the service has shut itself off. Immediate user intervention is required.
5	Description	text	Human readable description of what this signal means, or a message for the user.
6	SigDateTime	datetime	Time signal was sent.
7	Tag	text	Used to store serialized data that can be used for processing this signal.
8	IsProcessed	tinyint(4)	After a message has been processed or acknowledged this is set true. Not currently used for heartbeat or service status signals.

etrans
One electronic transaction. Typically, one claim or response. Or one benefit request or response. Is constantly being expanded to include more types of transactions with clearinghouses. Also stores printing of paper claims. Sometimes stores a copy of what was sent.
Order	Name	Type	Summary
0	EtransNum	bigint(20)	Primary key.
1	DateTimeTrans	datetime	The date and time of the transaction.
2	ClearingHouseNum	bigint(20)	FK to clearinghouse.ClearinghouseNum . Can be 0 if no clearinghouse was involved.
3	Etype	tinyint	Enum:EtransType
ClaimSent: 0 X12-837.
ClaimPrinted: 1 claim physically printed.
Claim_CA: 2 Canada. Type 01
Claim_Ren: 3 Renaissance
ClaimAck_CA: 4 Canada. Type 11
ClaimEOB_CA: 5 Canada. Type 21
Eligibility_CA: 6 Canada. Type 08
EligResponse_CA: 7 Canada. Type 18. V02 type 10.
ClaimReversal_CA: 8 Canada. Type 02
Predeterm_CA: 9 Canada. Type 03
RequestOutstand_CA: 10 Canada. Type 04
RequestSumm_CA: 11 Canada. Type 05
RequestPay_CA: 12 Canada. Type 06
ClaimCOB_CA: 13 Canada. Type 07
ReverseResponse_CA: 14 Canada. Type 12
PredetermAck_CA: 15 Canada. Type 13
PredetermEOB_CA: 16 Canada. Type 23
OutstandingAck_CA: 17 Canada. Type 14
EmailResponse_CA: 18 Canada. Type 24
PaymentResponse_CA: 19 Canada. Type 16
SummaryResponse_CA: 20 Canada. Type 15
Acknowledge_997: 21 Ack from clearinghouse. X12-997.
StatusNotify_277: 22 X12-277. Unsolicited claim status notification.
TextReport: 23 Text report from clearinghouse in human readable format.
BenefitInquiry270: 24 X12-270.
BenefitResponse271: 25 X12-271
AckError: 26 When an electronic transmission is sent, and an error comes back instead of a message. This stores information about the error. The etrans with this type is attached it to the original etrans as an ack.
ERA_835: 27 X12-835. Electronic Remittance Advice (ERA). Also known an an electronic EOB.
Acknowledge_999: 28 Ack from clearinghouse. X12-999.
Ack_Interchange: 29 Simple and generic ack from clearinghouse which is used to replace 997s, 999s, or 277s.
Claim_Ramq: 30 Carrier RAMQ located in Quebec Canada.
ItransNcpl: 31 Canadian iTrans 2.0 users can download carrier information.
HTML: 32 HTML response from clearinghouse. Usually in addition to a 271 used to import benefits.
DXCAttachments: 33 DXC Attachments. We make etrans entries for all communication with DXC's API.
Attachment_CA: 34 Canada. Type 09.
AttachmentAck_CA: 35 Canada. Type 19.
Claim_XConnect: 36 DentalXChange XConnect Claim.
ClaimAck_XConnect: 37 DentalXChange XConnect Claim Ack.
4	ClaimNum	bigint(20)	FK to claim.ClaimNum if a claim. Otherwise 0. Warning. Original claim might have been deleted. But if Canadian claim was successfully sent, then deletion will be blocked.
5	OfficeSequenceNumber	int(11)	For Canada. Unique for every transaction sent. Uncapped, but is modded by 1,000,000 when sent in a transaction as required by the standard.
6	CarrierTransCounter	int(11)	For Canada. Separate counter for each carrier. Uncapped, but is modded by 100,000 when sent in a transaction as required by the standard.
7	CarrierTransCounter2	int(11)	For Canada. Separate counter for each carrier. Uncapped, but is modded by 100,000 when sent in a transaction as required by the standard. If this claim includes secondary, then this is the counter for the secondary carrier.
8	CarrierNum	bigint(20)	FK to carrier.CarrierNum.
9	CarrierNum2	bigint(20)	FK to carrier.CarrierNum Only used if secondary insurance info is provided on a claim. Necessary for Canada.
10	PatNum	bigint(20)	FK to patient.PatNum This is useful in case the original claim has been deleted. Now, we can still tell who the patient was.
11	BatchNumber	int(11)	Maxes out at 999, then loops back to 1. This is not a good key, but is a restriction of (canadian?). So dates must also be used to isolate the correct BatchNumber key. Specific to one clearinghouse. Only used with e-claims. Claim will have BatchNumber, and 997 will have matching BatchNumber. (In X12 lingo, it's a functional group number)
12	AckCode	varchar(255)	A=Accepted, R=Rejected, blank if not able to parse, Recd=Received (835s only). More options will be added later. The incoming 997 or 999 sets this flag automatically. To find the 997 or 999, look for a matching BatchNumber with a similar date, since both the claims and the 997 or 999 will both have the same batch number. The 997 or 999 does not have this flag set on itself.
13	TransSetNum	int(11)	For sent e-claims, within each batch (functional group), each carrier gets it's own transaction set. Since 997s and 999s acknowledge transaction sets rather than batches, we need to keep track of which transaction set each claim is part of as well as which batch it's part of. This field can't be set as part of 997 or 999, because one 997 or 999 refers to multiple trans sets.
14	Note	text	Typical uses include indicating that the report was printed, the claim was resent, reason for rejection, etc. For a 270, this contains the automatically generated short summary of the response. The response could include the reason for failure, or it could be a short summary of the 271.
15	EtransMessageTextNum	bigint(20)	FK to etransmessagetext.EtransMessageTextNum. Can be 0 if there is no message text. Multiple Etrans objects can refer to the same message text, very common in a batch.
16	AckEtransNum	bigint(20)	FK to etrans.EtransNum. Only has a non-zero value if there exists an ack etrans, like a 997, 999, 277ack, 271, 835, or ackError. There can be only one ack for any given etrans, but one ack can apply to multiple etran's that were sent as one batch. 999 FK can be replaced by 277ack FK, and then by 835 FK. This column does triple duty. The AckEtransNum can be used to chain together related etrans entries. For example, if this is a 270 request, then AckEtransNum points to the 271 response. If this is a 271, then AckEtransNum points to the HTML (if any) for the response.
17	PlanNum	bigint(20)	FK to insplan.PlanNum. Used if EtransType.BenefitInquiry270 and BenefitResponse271 and Eligibility_CA.
18	InsSubNum	bigint(20)	FK to inssub.InsSubNum. Used if EtransType.BenefitInquiry270 and BenefitResponse271 and Eligibility_CA.
19	TranSetId835	varchar(255)	X12 ST02 Transaction Set Identifier for an 835. Specifies the unique transaction id within the 835 that this etrans record corresponds to. This column will always be set for 835s imported in version 14.3 or greater. For 835s imported in version 14.2, this column will alway be blank. If blank, and there is more than one transaction id within the 835, then FormEtrans835PickEob will show and allow the user to select the desired EOB from a list. The X12 guide states that there is only one transaction (EOB) allowed per 835, but ClaimConnect returns multiple transactions (EOBs) within a single 835 and other clearinghouses probably do as well. When an 835 is imported, it is examined to determine the number of transactions within it. One etrans entry is created for each EOB within the 835. We may have a similar issue with multiple transactions within 277s as well, but we have not seen any evidence yet. Our current 277 implementation expects a single transaction, just as the X12 standard specifies.
20	CarrierNameRaw	varchar(60)	Only used if the CarrierNum is 0. If CarrierNum is not 0, the name associated to CarrierNum will override CarrierNameRaw in the FormClaimsSend history grid. Added for 835s so that customer databases are not cluttered with dummy carriers and so there is no extra processing time when FormClaimsSend is loading. Size is 60 bytes to match 835 carrier name length.
21	PatientNameRaw	varchar(133)	Only used if the PatNum is 0. If PatNum is not 0, the name associated to PatNum will override PatientNameRaw in the FormClaimsSend history grid. Added for 835s so that there is no extra processing time when FormClaimsSend is loading, and so text representing the patient count can be used instead of an actual patient name. Size is 133 bytes to match X12 specs for last name (60), first name (35), middle name (25), suffix (10), and spaces in between (3).
22	UserNum	bigint(20)	FK to userod.UserNum

etrans835
Corresponds to an etrans record containing a raw 835 X12 message attached in etransmessagetext table. This is denoted by etrans.Etype=ERA_835
Order	Name	Type	Summary
0	Etrans835Num	bigint(20)	Primary key.
1	EtransNum	bigint(20)	FK to etrans.EtransNum .
2	PayerName	varchar(60)	Up to 60 characters. Corresponds to X835.PayerName, a read-only field.
3	TransRefNum	varchar(50)	Up to 50 characters. Corresponds to X835.TransRefNum, a read-only field.
4	InsPaid	double	Corresponds to X835.InsPaid, a read-only field.
5	ControlId	varchar(9)	Up to 9 characters. Corresponds to X835.ControlId, a read-only field.
6	PaymentMethodCode	varchar(3)	Up to 3 characters. Corresponds to X835._paymentMethodCode, a read-only field.
7	PatientName	varchar(100)	Up to 100 characters (not based on actual patient name field sizes). Corresponds to Hx835_Claim.PatientName.ToString() if one patient, or says "(#)" if multiple patients to show count.
8	Status	tinyint(4)	Enum:X835Status . Calculated status. Only changes when ERA changes.
None: 1 - Just a place holder if there is an issue. Should never show in UI.
Unprocessed: 2 - There are no received claims attached to the ERA. There can be one or more detached claims on the ERA.
Partial: 3 - Some claims for this ERA have had financial information entered, no finalaized claim payment.
NotFinalized: 4 - Ignores manually detached. All claims for this ERA have had financial information entered, no finalaized claim payment.
FinalizedSomeDetached: 5 - Some claims have been manually detached but all other claims have had financial information entered and finalaized claim payment created.
FinalizedAllDetached: 6 - All claims have been manually detached.
Finalized: 7 - All claims for this ERA have had financial information entered and a finalaized claim payment was created.
9	AutoProcessed	tinyint(4)	Enum:X835AutoProcessed . The initial disposition of ERA's that have passed through our auto/semi-auto processing system.
None: 0
SemiAutoIncomplete: 1
SemiAutoComplete: 2
FullAutoIncomplete: 3
FullAutoComplete: 4
10	IsApproved	tinyint(4)	True if a user has acknowledged the auto processed ERA.

etrans835attach
Links a specific claim within an ERA 835 to an actual claim in the claims table.
Order	Name	Type	Summary
0	Etrans835AttachNum	bigint(20)	Primary key.
1	EtransNum	bigint(20)	FK to etrans.EtransNum.
2	ClaimNum	bigint(20)	FK to claim.ClaimNum. Can be 0, which indicates that the ERA claim does not have a match in OD.
3	ClpSegmentIndex	int(11)	Segment index for the CLP/Claim segment within the X12 document containing the 835. This index is unique, even if there are multiple 835 transactions within the X12 document.
4	DateTimeEntry	datetime	DateTime that the row was inserted.

etransmessagetext
Each row is big. The entire X12 message text is stored here, since it can be the same for multiple etrans objects, and since the messages can be so big.
Order	Name	Type	Summary
0	EtransMessageTextNum	bigint(20)	Primary key.
1	MessageText	mediumtext	The entire message text, including carriage returns.

evaluation
An evaluation is for one student and is copied from an EvaluationDef. There are multiple evaluations per course, which add up to the final course grade. An evaluation is for a single day and can optionally have multiple criteria on it. Evaluations get created on the day they are filled out, not ahead of time. The user would typically set up at least one evaluationDef that didn't have any criteria on it for simple situations. There is no weight yet for different evaluations, so the automatically calculated course grades will treat all evaluations with equal weight.
Order	Name	Type	Summary
0	EvaluationNum	bigint(20)	Primary key.
1	InstructNum	bigint(20)	FK to provider.ProvNum.
2	StudentNum	bigint(20)	FK to provider.ProvNum.
3	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. For example to PEDO 732.
4	EvalTitle	varchar(255)	Copied from evaluation def. Not editable.
5	DateEval	date	Date of the evaluation.
6	GradingScaleNum	bigint(20)	
7	OverallGradeShowing	varchar(255)	OverallGradeNumber is calculated as described below. Once the nearest number on the scale is found, the corresponding gradescaleitem.GradeShowing is used here.
8	OverallGradeNumber	float	Always recalculated as each individual criterion is changed, so no risk of getting out of synch. Only considers criteria on the evaluation that use the same grading scale as the evaluation itself. It's an average of all those criteria. When averaging, the result will almost never exactly equal one of the numbers in the scale, so the nearest one must be found and used here. For example, if the average is 3.6 on a 4 point scale, this will show 4. Percentages will be rounded to the nearest whole number. This is the value that will be returned in reports and also used in calculations of the student's grade for the term.
9	Notes	text	Any note that the instructor wishes to place at the bottom of this evaluation.
10	GradeOverride	float	-1 by default. The override grade number entered manually by the instructor. If populated, the OverallGradeShowing is derived from this override value instead.

evaluationcriterion
One row on an evaluation. For example, a single evaluation would be created for one patient appointment. The criteria might include things like professionalism, patient comfort, anesthesia, prep, matrix, restoration, margins, contact, contours, polish, etc. Each criterion can be assigned a grade and the evaluation gets an overall grade. For simple situations the criteria can be left blank. There is no window to edit an individual criterion. That's done in FrmEvaluationEdit in the grid.
Order	Name	Type	Summary
0	EvaluationCriterionNum	bigint(20)	Primary key.
1	EvaluationNum	bigint(20)	FK to evaluation.EvaluationNum
2	CriterionDescript	varchar(255)	Description that is displayed for the criterion.
3	IsCategoryName	tinyint(4)	This row will show in bold and will not have a grade attached to it.
4	GradingScaleNum	bigint(20)	
5	GradeShowing	varchar(255)	Copied from gradingscaleitem.GradeShowing. Required. For example A, B, C, D, F, or 1-10, pass, fail, 89, etc. Except for percentages, must come from pick list.
6	GradeNumber	float	Copied from gradingscaleitem.GradeNumber. Required. For example A=4, A-=3.8, pass=1, percentages stored as 89, etc. Except for percentages, must come from pick list.
7	Notes	text	A note about why this student received this particular grade on this criterion.
8	ItemOrder	int(11)	Copied from item order of def. Defines the order that all the criteria show on the evaluation. User not allowed to change here, only in the def.
9	MaxPointsPoss	float	For ScaleType=Points, sets the maximum value of points for this criterion.

evaluationcriteriondef
One row on an EvaluationDef. The criteria might include things like professionalism, patient comfort, anesthesia, prep, matrix, restoration, margins, contact, contours, polish, etc. For simple situations the criteria can be left blank.
Order	Name	Type	Summary
0	EvaluationCriterionDefNum	bigint(20)	Primary key.
1	EvaluationDefNum	bigint(20)	FK to evaluationdef.EvaluationDefNum.
2	CriterionDescript	varchar(255)	Description that is displayed for the criterion.
3	IsCategoryName	tinyint(4)	This row will show in bold and will not have a grade attached to it.
4	GradingScaleNum	bigint(20)	
5	ItemOrder	int(11)	Defines the order that all the criteria show on the evaluation. Copied to ItemOrder of actual criterion.
6	MaxPointsPoss	float	For ScaleType=Points, sets the maximum value of points for this criterion.

evaluationdef
An evaluation def is the entire form that the instructor sets up ahead of time. Actual evaluations for students are copied from these 'templates', so an evaluation def can be altered or deleted without damaging any student record. Evaluation defs are usually not specific to instructors, but if different instructors want different evaluation forms, they can use the description column to differentiate. For example, the description can include the instructor's name or even the year. But most commonly, the same evaluation will be used from year to year. There should be a duplicate function to make a copy an entire evaluation def and then allow user to alter the SchoolCourseNum.
Order	Name	Type	Summary
0	EvaluationDefNum	bigint(20)	Primary key.
1	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. Will be 0 when the evaluation def is for a course def.
2	EvalTitle	varchar(255)	Description of this evaluation form.
3	GradingScaleNum	bigint(20)	
4	SchoolCourseDefNum	bigint(20)	FK to schoolcoursedef.SchoolCourseNum. Will be 0 when the evaluation def is for a course.

famaging
This table stores intermediate family aged balances just prior to updating the patient table. Once the aging calculations are finished and the patient table is updated, this table is truncated. At the start of the aging calculations this table is checked and if there are existing rows, we will notify the user and force them to decide whether an aging calculation has already begun or an error happened that prevented the calculations from finishing and the rows are left over and can be deleted.
Order	Name	Type	Summary
0	PatNum	bigint(20)	FK to patient.PatNum. Also the primary key for this table. Always the PatNum for the Guarantor of a family. A guarantor may not exist in this table if the family does not have a balance. i.e. If a PatNum is not in this table, the aged balance columns on the patient table are set to 0, so either the patient is not the guarantor or the family has a zero balance.
1	Bal_0_30	double	Aged balance from 0 to 30 days old. Aging numbers are for entire family. Only stored with guarantor.
2	Bal_31_60	double	Aged balance from 31 to 60 days old. Aging numbers are for entire family. Only stored with guarantor.
3	Bal_61_90	double	Aged balance from 61 to 90 days old. Aging numbers are for entire family. Only stored with guarantor.
4	BalOver90	double	Aged balance over 90 days old. Aging numbers are for entire family. Only stored with guarantor.
5	InsEst	double	Insurance Estimate for entire family. Only stored with guarantor.
6	BalTotal	double	Total balance for entire family before insurance estimate. Not the same as the sum of the 4 aging balances because this can be negative. Only stored with guarantor.
7	PayPlanDue	double	Amount "due now" for all payment plans such that someone in this family is the payment plan guarantor. This is the total of all payment plan charges past due (taking into account the PayPlansBillInAdvanceDays setting) subtract the amount already paid for the payment plans. Only stored with family guarantor.

familyhealth
For EHR, this lets us record medical problems for family members. These family members will usually not be in our database, and they are just recorded by relationship.
Order	Name	Type	Summary
0	FamilyHealthNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	Relationship	tinyint(4)	Enum:FamilyRelationship
Parent: 0
Sibling: 1
Offspring: 2
3	DiseaseDefNum	bigint(20)	FK to diseasedef.DiseaseDefNum, which will have a SnoMed associated with it.
4	PersonName	varchar(255)	Name of the family member.

fee
There is one entry in this table for each fee for a single procedurecode. So if there are 5 different fees stored for one procedurecode, then there will be five entries here.
Order	Name	Type	Summary
0	FeeNum	bigint(20)	Primary key.
1	Amount	double	The amount usually charged. If an amount is unknown, then the entire Fee entry is deleted from the database. The absence of a fee is shown in the user interface as a blank entry. For clinic and/or provider fees, amount can be set to -1 which indicates that their fee should be blank and not use the default fee.
2	OldCode	varchar(15)	Do not use.
3	FeeSched	bigint(20)	FK to feesched.FeeSchedNum.
4	UseDefaultFee	tinyint	Not used.
5	UseDefaultCov	tinyint	Not used.
6	CodeNum	bigint(20)	FK to procedurecode.CodeNum.
7	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Must be 0 if feesched.IsGlobal=true.
8	ProvNum	bigint(20)	FK to provider.ProvNum. Must be 0 if feesched.IsGlobal=true.
9	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Gets set automatically to the user logged in when the row is inserted at SecDateEntry date and time.
10	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
11	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
12	DateEffective	date	The date when the Fee is valid. Most users will have their fees with empty dates (0001-01-01) meaning their fees are always valid. This lets user enter a fee schedule ahead of an effective date. When we show fees to the user in areas where there is no date filter, we use today as the dateEffective. We don't show future fees in those areas.

feesched
Fee schedule names used to be in the definition table, but now they have their own table. We are about to have many many more fee schedules as we start automating allowed fees.
Order	Name	Type	Summary
0	FeeSchedNum	bigint(20)	Primary key.
1	Description	varchar(255)	The name of the fee schedule.
2	FeeSchedType	int(11)	Enum:FeeScheduleType
Normal: 0
CoPay: 1
OutNetwork: 2, Formerly named "Allowed"
FixedBenefit: 3
ManualBlueBook: 4
3	ItemOrder	int(11)	Unlike with the old definition table, this ItemOrder is not as critical in the caching of data. The item order is only for fee schedules of the same type.
4	IsHidden	tinyint(1)	True if the fee schedule is hidden. Can't delete fee schedules or change their type once created.
5	IsGlobal	tinyint(4)	True if the fee schedule is used globally and linked to the HQ. Localization of the fees is not allowed. ClinicNum and ProvNum must both be zero for all fees.
6	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
7	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
8	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

feeschedgroup
Can be used when using clinics, and a single fee schedule has fees that are region specific and need to be different for different clinics. A FeeSchedGroup stores a list of clinics that one fee schedule applies to, overriding the normal fee sched. This is designed so that you can have a few "groups" per fee sched instead of dozens or hundreds of clinics. Fees are still created on a per-clinic basis, and we attempt to manage them when we do things like change fees or edit groups.
Order	Name	Type	Summary
0	FeeSchedGroupNum	bigint(20)	Primary key.
1	Description	varchar(255)	
2	FeeSchedNum	bigint(20)	FK to feesched.FeeSchedNum.
3	ClinicNums	varchar(255)	Comma delimited list of Clinic.ClinicNums.

feeschednote
A note that is attached to a fee schedule, and can additionally be associated with a clinic too.
Order	Name	Type	Summary
0	FeeSchedNoteNum	bigint(20)	Primary key.
1	FeeSchedNum	bigint(20)	FK to feesched.FeeSchedNum.
2	ClinicNums	text	A comma delimited list of clinic nums that the fee schedule note is for. Can include 0. For most offices this will be empty string because they do not use clinics.
3	Note	text	A note for a particular fee schedule. No character lim.
4	DateEntry	date	The date of this note. User is allowed to change this date.
5	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
6	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
7	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

fhircontactpoint
Details of a Technology mediated contact point (phone, fax, email, etc.). https://www.hl7.org/fhir/datatypes.html#contactpoint .
Order	Name	Type	Summary
0	FHIRContactPointNum	bigint(20)	Primary key.
1	FHIRSubscriptionNum	bigint(20)	FK to fhirsubscription.FHIRSubscriptionNum.
2	ContactSystem	tinyint(4)	Enum:ContactPointSystem
Phone: The value is a telephone number used for voice calls. Use of full international numbers starting with + is recommended to enable automatic dialing support but not required.
Fax: The value is a fax machine. Use of full international numbers starting with + is recommended to enable automatic dialing support but not required.
Email: The value is an email address.
Pager: The value is a pager number. These may be local pager numbers that are only usable on a particular pager system.
Other: A contact that is not a phone, fax, or email address. The format of the value SHOULD be a URL. This is intended for various personal contacts including blogs, Twitter, Facebook, etc. Do not use for email addresses. If this is not a URL, then it will require human interpretation.
3	ContactValue	varchar(255)	The actual contact point details.
4	ContactUse	tinyint(4)	Enum:ContactPointUse
Home: A communication contact point at a home; attempted contacts for business purposes might intrude privacy and chances are one will contact family or other household members instead of the person one wishes to call. Typically used with urgent cases, or if no other contacts are available.
Work: An office contact point. First choice for business related contacts during business hours.
Temp: A temporary contact point. The period can provide more detailed information.
Old: This contact point is no longer in use (or was never correct, but retained for records).
Mobile: A telecommunication device that moves and stays with its owner. May have characteristics of all other use codes, suitable for urgent matters, not the first choice for routine business.
5	ItemOrder	int(11)	Specify preferred order of use (1 = highest)
6	DateStart	date	Time when the contact point started to be in use.
7	DateEnd	date	Timewhen the contact point stopped being used.

fhirsubscription
A subscription by a client that requests an alert whenever a change is made to a FHIR resource.
Order	Name	Type	Summary
0	FHIRSubscriptionNum	bigint(20)	Primary key.
1	Criteria	varchar(255)	Rule for server push criteria.
2	Reason	varchar(255)	Description of why this subscription was created.
3	SubStatus	tinyint(4)	Enum:SubscriptionStatus
Requested: The client has requested the subscription, and the server has not yet set it up.
Active: The subscription is active.
Error: The server has an error executing the notification.
Off: Too many errors have occurred or the subscription has expired.
4	ErrorNote	text	Latest error note.
5	ChannelType	tinyint(4)	Enum:SubscriptionChannelType
Rest_Hook: The channel is executed by making a post to the URI. If a payload is included, the URL is interpreted as the service base, and an update (PUT) is made.
Websocket: The channel is executed by sending a packet across a web socket connection maintained by the client. The URL identifies the websocket, and the client binds to this URL.
Email: The channel is executed by sending an email to the email addressed in the URI (which must be a mailto:).
Sms: The channel is executed by sending an SMS message to the phone number identified in the URL (tel:).
Message: The channel is executed by sending a message (e.g. a Bundle with a MessageHeader resource etc.) to the application identified in the URI.
6	ChannelEndpoint	varchar(255)	Where the channel points to.
7	ChannelPayLoad	varchar(255)	Mimetype to send, or blank for no payload.
8	ChannelHeader	varchar(255)	Usage depends on the channel type.
9	DateEnd	datetime	When to automatically delete the subscription.
10	APIKeyHash	varchar(255)	A hash of the API key that was used in the request to create this subscription.

fielddeflink
A better name would be FieldHide. This specifies places where PatFields or ApptFields should be hidden. PatFieldDefs already have an IsHidden field, so this is redundant there. But it's powerful for letting PatFields show in some places but not other places.
Order	Name	Type	Summary
0	FieldDefLinkNum	bigint(20)	Primary key
1	FieldDefNum	bigint(20)	A generic FieldDefNum FK to any particular field def item that will be defined by the FieldDefType column.
2	FieldDefType	tinyint(4)	Enum:FieldDefTypes Defines what FieldDefNum represents.
Appointment: 0
Patient: 1
3	FieldLocation	tinyint(4)	Enum:FieldLocations Defines where this particular field def needs to be hidden.
Account: 0
AppointmentEdit: 1
Chart: 2
Family: 3
OrthoChart: 4
GroupNote: 5

formpat
This is an old table that isn't really used anymore. We used to have a "questionnaire" that could be filled out by a patient, and this is it. Each patient can have multiple questionnaires.
Order	Name	Type	Summary
0	FormPatNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	FormDateTime	datetime	The date and time that this questionnaire was filled out.

gradingscale
Used in Evaluations. Describes a scale to be used in grading. Freeform scales are not allowed. Percentage scales are handled a little differently than the other scales.
Order	Name	Type	Summary
0	GradingScaleNum	bigint(20)	Primary key.
1	Description	varchar(255)	For example, A-F or Pass/Fail.
2	ScaleType	tinyint(4)	Enum:EnumScaleType Used to determine method of assigning grades. PickList will be the only type that has GradingScaleItems.
PickList: 0- User-Defined list of possible grades. Grade is calculated as an average.
Percentage: 1- Percentage Scale 0-100. Grade is calculated as an average.
Weighted: 2- Allows point values for grades. Grade is calculated as a sum of all points out of points possible.

gradingscaleitem
Only used when GradingScale.ScaleType=PickList, not Percentage or Points. The specific grades allowed on a scale. Contains both the GradeShowing and the equivalent number. There are no FKs to these items. The values are all copied from here into student records as they are used.
Order	Name	Type	Summary
0	GradingScaleItemNum	bigint(20)	Primary key.
1	GradingScaleNum	bigint(20)	FK to gradingscale.GradingScaleNum
2	GradeShowing	varchar(255)	For example A, B, C, D, F. Optional. If not specified, it shows the number.
3	GradeNumber	float	For example A=4, A-=3.8, pass=1, etc. Required. Enforced to be equal to or less than GradingScale.MaxPointsPoss.
4	Description	varchar(255)	Optional additional info about what this particular grade means. Just used as guidance and does not get copied to the individual student record.

grouppermission
Every user group has certain permissions. This defines a permission for a group. The absense of permission would cause that row to be deleted from this table.
Order	Name	Type	Summary
0	GroupPermNum	bigint(20)	Primary key.
1	NewerDate	date	Only granted permission if newer than this date. Can be Minimum (01-01-0001) to always grant permission.
2	NewerDays	int(11)	Can be 0 to always grant permission. Otherwise, only granted permission if item is newer than the given number of days. 1 would mean only if entered today.
3	UserGroupNum	bigint(20)	FK to usergroup.UserGroupNum. The user group for which this permission is granted. If not authorized, then this groupPermission will have been deleted.
4	PermType	smallint(6)	Enum:EnumPermType Some permissions will treat a zero FKey differently. Some denote it as having access to everything for that PermType. I.e. Reports.
None: 0
AppointmentsModule: 1
FamilyModule: 2
AccountModule: 3
TPModule: 4
ChartModule: 5
ImagingModule: 6
ManageModule: 7
Setup: 8. Currently covers a wide variety of setup functions.
RxCreate: 9
ProcComplEdit: 10 - DEPRECATED - Uses date restrictions. Covers editing/deleting of Completed, EO, and EC procs. Deleting procs of other statuses are covered by ProcDelete.
ChooseDatabase: 11
Schedules: 12
BlockoutEdit: 13 - There are two kinds of blockouts: those flagged as NS(no sched) or DC(disable cut/copy/paste) and those with no flag. This permission handles the blockouts with no flag, including edit and copy/paste. Logs an audit trail entry when a blockout is added, edited, deleted, cut, copied, pasted, or cleared. See BlockoutsFlagged permission for the other blockouts flagged as NS or DC.
ClaimSentEdit: 14. Uses date restrictions.
PaymentCreate: 15. Uses date restrictions.
PaymentEdit: 16. Uses date restrictions.
AdjustmentCreate: 17
AdjustmentEdit: 18. Uses date restrictions.
UserQuery: 19
StartupSingleUserOld: 20. Not used anymore.
StartupMultiUserOld: 21 Not used anymore.
Reports: 22
ProcComplCreate: 23. Includes setting procedures complete.
SecurityAdmin: 24. At least one user must have this permission.
AppointmentCreate: 25.
AppointmentMove: 26
AppointmentEdit: 27. AppointmentDelete permission required in order to delete appointments.
Backup: 28
TimecardsEditAll: 29
DepositSlips: 30
AccountingEdit: 31. Uses date restrictions.
AccountingCreate: 32. Uses date restrictions.
Accounting: 33
AnesthesiaIntakeMeds: 34
AnesthesiaControlMeds: 35
InsPayCreate: 36
InsPayEdit: 37. Uses date restrictions. Edit Batch Insurance Payment.
TreatPlanEdit: 38. Uses date restrictions.
ReportProdInc: 39. DEPRECATED
TimecardDeleteEntry: 40. Uses date restrictions.
EquipmentDelete: 41. Uses date restrictions. All other equipment functions are covered by .Setup.
SheetEdit: 42. Uses date restrictions. Also used in audit trail to log web form importing.
CommlogEdit: 43. Uses date restrictions.
ImageDelete: 44. Uses date restrictions. Allows deletion of images. SignedImageEdit permission is also needed to delete signed images.
PerioEdit: 45. Uses date restrictions.
ProcEditShowFee: 46. Shows the fee textbox in the proc edit window.
AdjustmentEditZero: 47
EhrEmergencyAccess: 48
ProcDelete: 49. Uses date restrictions. This only applies to non-completed procs. Deletion of completed procs is covered by ProcCompleteStatusEdit.
EhrKeyAdd: 50 - Only used at OD HQ. No user interface.
ProviderEdit: 51- Allows user to edit all providers. This is not fine-grained enough for extremely large organizations such as dental schools, so other permissions are being added as well.
EcwAppointmentRevise: 52
ProcedureNoteFull: 53
ReferralAdd: 54
InsPlanChangeSubsc: 55
RefAttachAdd: 56
RefAttachDelete: 57
CarrierCreate: 58
GraphicalReports: 59
AutoNoteQuickNoteEdit: 60
EquipmentSetup: 61
Billing: 62
ProblemDefEdit: 63
ProcFeeEdit: 64- There is no user interface in the security window for this permission. It is only used for tracking.
InsPlanChangeCarrierName: 65- There is no user interface in the security window for this permission. It is only used for tracking. Only tracks changes to carriername, not any other carrier info.
TaskNoteEdit: 66- (Was named TaskEdit prior to version 14.2.39) When editing an existing task: delete the task, edit original description, or double click on note rows. Even if you don't have the permission, you can still edit your own task description (but not the notes) as long as it's in your inbox and as long as nobody but you has added any notes.
WikiListSetup: 67- Add or delete lists and list columns..
Copy: 68- There is no user interface in the security window for this permission. It is only used for tracking. Tracks copying of patient information. Required by EHR.
Printing: 69- There is no user interface in the security window for this permission. It is only used for tracking. Tracks printing of patient information. Required by EHR.
MedicalInfoViewed: 70- There is no user interface in the security window for this permission. It is only used for tracking. Tracks viewing of patient medical information.
PatProblemListEdit: 71- Tracks creation and editing of patient problems.
PatMedicationListEdit: 72- Tracks creation and edting of patient medications.
PatAllergyListEdit: 73- Tracks creation and editing of patient allergies.
PatFamilyHealthEdit: 74- There is no user interface in the security window for this permission. It is only used for tracking. Tracks creation and editing of patient family health history.
PatientPortal: 75- There is no user interface in the security window for this permission. It is only used for tracking. Patient Portal access of patient information. Required by EHR.
RxEdit: 76
SchoolAdminStudentEdit: 77- Assign this permission to a staff person who will administer setting up and editing Dental School Students in the system.
SchoolAdminInstructorEdit: 78- Assign this permission to a staff person who will administer setting up and editing Dental School Instructors in the system.
OrthoChartEditFull: 79- Uses date restrictions. Has a unique audit trail so that users can track specific ortho chart edits.
PatientFieldEdit: 80- There is no user interface in the security window for this permission. It is only used for tracking. Mainly used for ortho clinics.
SchoolAdminAcesss: 81- Assign this permission to a staff member who needs full access to instructor and student records. Grants the ability to view anything they can view and perform any action on their behalf.
TreatPlanDiscountEdit: 82- There is no user interface in the security window for this permission. It is only used for tracking.
UserLogOnOff: 83- There is no user interface in the security window for this permission. It is only used for tracking.
TaskEdit: 84- Allows user to edit other users' tasks.
EmailSend: 85- Allows user to send unsecured email
WebMailSend: 86- Allows user to send webmail
UserQueryAdmin: 87- Allows user to run, edit, and write non-released queries.
InsPlanChangeAssign: 88- Security permission for assignment of benefits.
ImageEdit: 89- Uses date restrictions. Allows user to flip, rotate, resize, and crop image. Also allows editing of details on the "Item Info" window. SignedImageEdit permission is also needed to edit signed images.
EhrMeasureEventEdit: 90- Allows editing of all measure events. Also used to track changes made to events.
EServicesSetup: 91- Allows users to edit settings in the eServices Setup window. Also causes the Listener Service monitor thread to start upon logging in.
FeeSchedEdit: 92- Allows users to edit Fee Schedules throughout the program. Logs editing of fee schedule properties.
ProviderFeeEdit: 93- Allows user to edit and delete provider specific fees overrides.
PatientMerge: 94- Allows user to merge patients.
ClaimHistoryEdit: 95- Only used in Claim History Status Edit
AppointmentCompleteEdit: 96- Allows user to edit a completed appointment. AppointmentCompleteDelete permission required in order to delete completed appointments.
WebMailDelete: 97- Audit trail for deleting webmail messages. There is no user interface in the security window for this permission.
RequiredFields: 98- Audit trail for saving a patient with required fields missing. There is no user interface in the security window for this permission.
ReferralMerge: 99- Allows user to merge referrals.
ProcEdit: 100- There is no user interface in the security window for this permission. It is only used for tracking. Currently only used for tracking automatically changing the IsCpoe flag on procedures. Can be enhanced to do more in the future. There is only one place where we could have automatically changed IsCpoe without a corresponding log of a different permission. That place is in the OnClosing of the Procedure Edit window. We update this flag even when the user Cancels out of it.
ProviderMerge: 101- Allows user to use the provider merge tool.
MedicationMerge: 102- Allows user to use the medication merge tool.
AccountProcsQuickAdd: 103- Allow users to use the Quick Add tool in the Account module.
ClaimSend: 104- Allow users to send claims.
TaskListCreate: 105- Allow users to create new task lists.
PatientCreate: 106 - Audit when a new patient is added.
GraphicalReportSetup: 107- Allows changing the settings for graphical repots.
PatientEdit: 108 - Audit when a patient is edited and restrict editing patients.
InsPlanCreate: 109 - Audit when an insurance plan is created. Currently only used in X12 834 insurance plan import.
InsPlanEdit: 110 - Audit when an insurance plan is edited. Currently only used in X12 834 insurance plan import.
InsPlanCreateSub: 111 - InsSub Created. Currently only used in X12 834 insurance plan import and in API.
InsPlanEditSub: 112 - Audit when an insurance subscriber is edited. Currently only used in X12 834 insurance plan import.
InsPlanAddPat: 113 - Audit when a patient is added to an insurance plan. Currently only used in X12 834 insurance plan import.
InsPlanDropPat: 114 - Audit when a patient is dropped from an insurance plan. Currently only used in X12 834 insurance plan import.
InsPlanVerifyList: 115 - Allows users to be assigned Insurance Verifications.
SplitCreatePastLockDate: 116 - Allows users to bypass the global lock date to add paysplits.
ProcComplEditLimited: 117 - DEPRECATED - Uses date restrictions. Covers editing some fields of completed procs.
ClaimDelete: 118 - Uses date restrictions based on the SecDateEntry field as the claim date. Covers deleting a claim of any status (Sent, Waiting to Send, Received, etc).
InsWriteOffEdit: 119 - Covers editing the Write-off and Write-off Override fields for claimprocs. Prevents the user from creating a claimproc to prevent subversion of an existing write-off. Prevents the user from deleting a claimproc as well, since otherwise deleting one outside the date range and creating a new one would subvert the date/days restriction. Uses date/days restriction based on the attached proc.DateEntryC; unless it's a total payment, then uses claimproc.SecDateEntry.Applies to all plan types (i.e. PPO, Category%, Capitation, etc).
ApptConfirmStatusEdit: 120 - Allows users to change appointment confirmation status.
GraphicsRemoteEdit: 121 - Audit trail for when users change graphical settings for another workstation in FormGraphics.cs.
AuditTrail: 122 - Audit Trail (Separated from SecurityAdmin permission)
TreatPlanPresenterEdit: 123 - Allows the user to change the presenter on a treatment plan.
ProviderAlphabetize: 124 - Allows users to use the Alphabetize Provider button from FormProviderSetup to permanently re-order providers.
ClaimProcReceivedEdit: 125 - Allows editing of claimprocs that are marked as received status.
StatementPatNumMismatch: 126 - Used to diagnose an error in statement creation. Audit Trail Permission Only
MobileWeb: 127 - User has access to ODTouch.
PatPlanCreate: 128 - For logging purposes only. Used when PatPlans are created and not otherwise logged.
PatPriProvEdit: 129 - Allows the user to change a patient's primary provider, with audit trail logging.
ReferralEdit: 130
PatientBillingEdit: 131 - Allows users to change a patient's billing type.
ReportProdIncAllProviders: 132 - Allows viewing annual prod inc of all providers instead of just a single provider.
ReportDaily: 133 - Allows running daily reports. DEPRECATED.
ReportDailyAllProviders: 134 - Allows viewing daily prod inc of all providers instead of just a single provider
PatientApptRestrict: 135 - Allows user to change the appointment schedule flag.
SheetDelete: 136 - Allows deleting sheets when they're associated to patients.
UpdateCustomTracking: 137 - Allows updating custom tracking on claims.
GraphicsEdit: 138 - Allows people to set graphics option for the workstation and other computers.
InsPlanOrthoEdit: 139 - Allows user to change the fields within the Ortho tab of the Ins Plan Edit window.
ClaimProcClaimAttachedProvEdit: 140 - Allows user to change the provider on claimproc when claimproc is attached to a claim.
InsPlanMerge: 141 - Audit when insurance plans are merged.
InsCarrierCombine: 142 - Allows user to combine carriers.
PopupEdit: 143 - Allows user to edit popups. A user without this permission will still be able to edit their own popups.
InsPlanPickListExisting: 144 - Allows user to select new insplan from list prior to dropping current insplan associated with a patplan.
OrthoChartEditUser: 145 - Allows user to edit their own signed ortho charts even if they don't have full permission.
ProcedureNoteUser: 146 - Allows user to edit procedure notes that they created themselves if they don't have full permission.
GroupNoteEditSigned: 147 - Allows user to edit group notes signed by other users. If a user does not have this permission, they can still edit group notes that they themselves have signed.
WikiAdmin: 148 - Allows user to lock and unlock wiki pages. Also allows the user to edit locked wiki pages.
PayPlanEdit: 149 - Allows user to create, edit, close, and delete payment plans.
ClaimEdit: 150 - Used for logging when a claim is created, cancelled, or saved.
CommandQuery: 151- Allows user to run command queries. Command queries are any non-SELECT queries for any non-temporary table.
ReplicationSetup: 152 - Gives user access to the replication setup window.
PreAuthSentEdit: 153 - Allows user to edit and delete sent and received pre-auths. Uses date restriction.
LogFeeEdit: 154 - Edit fees (for logging only). Security log entry for this points to feeNum instead of CodeNum.
LogSubscriberEdit: 155 - Log ClaimProcEdit
RecallEdit: 156 - Logs changes to recalls, recalltypes, and recaltriggers.
ProcCodeEdit: 157 - Allows users with this permission the ability to edit procedure codes. Users with the Setup permission have this by default. Logs changes made to individual proc codes (excluding fee changes) including when run from proc code tools.
AddNewUser: 158 - Allows users with this permission the ability to add new users. Security admins have this by default.
ClaimView: 159 - Allows users with this permission the ability to view claims.
RepeatChargeTool: 160 - Allows users to run the Repeat Charge Tool.
DiscountPlanAddDrop: 161 - Logs when a discount plan is added or dropped from a patient.
TreatPlanSign: 162 - Allows users with this permission the ability to sign treatment plans.
ProcExistingEdit: 163 - Allows users with this permission to edit an existing EO or EC procedure.
UnrestrictedSearch: 164 - Allows users to search for patients in all clinics even when they are restricted to clinics. Also allows user to reassign patient clinic.
ArchivedPatientEdit: 165 - Allows users to edit patient information for archived patients. This really only stops editing inside Patient Edit window. Also see ArchivedPatientSelect. Blocking user from patient selection prevents changes to all the other tables.
CommlogPersistent: 166 - HQ only. Must access from dropdown menu next to commlog button. Only for new commlog. Originally, this was written to allow commlogs to reuse a single persistent non-modal window. In about 2023, we accidentally introduced a bug that made it not reuse the original window. So now, it's multiple non-modal windows. We like the change, so we're keeping it.
VerifyPhoneOwnership: 167 - Logs when a phone number has had its ownership verified. For OD HQ only.
SalesTaxAdjEdit: 168 - HQ only. Allows users to make changes to Sales Tax type adjustments.
InsuranceVerification: 169 - Allows user to set last verified dates for insurance benefits. Also allows access to FormInsVerificationList.
CreditCardMove: 170 - Logs when a credit card is moved from one patient to another. Makes a log for both patients. Audit Trail Permission Only.
AgingRan: 171 - Logs when aging is being ran and from where.
HeadmasterSetup: 172 - HQ only. Allows user to add, edit, and delete Headmaster services and devices.
DashboardWidget: 173 - Allows user to view a specific Dashboard Widget.
NewClaimsProcNotBilled: 174 - Prevent users from creating bulk claims from the Procs Not Billed Report if past the lock date.
PatientPortalLogin: 175 - Logging into patient portal. Used for audit trail only.
FAQEdit: 176 - Allows user to create and edit FAQ objects shown by the help button(?).
FeatureRequestEdit: 177 - HQ only. Alows user to edit feature request.
TaskReminderPopup: 178- Logs when a reminder task is popped up. Used for audit trail only.
SupplementalBackup: 179 - Logs when changes are made to supplemental backup settings inside the FormBackup window.
WebSchedRecallManualSend: 180 - Logs when a user sends a Web Sched Recall through the Recall List. Used for audit trail only
PatientSSNView: 181 - Allows the user to unmask patient SSN for temporary viewing. Logs any unmasks in the audit trail
PatientDOBView: 182 - Allows the user to unmask patient DOB for temporary viewing. Logs any unmasks in the audit trail
FamAgingTruncate: 183 - Logs when the family aging table has been truncated. For audit trails only.
DiscountPlanMerge: 184 - Logs when discount plans are merged. For audit trails only.
ProcCompleteStatusEdit: 185 - Uses date restrictions. Allows user to change status of a completed procedure, or delete compeleted procedure
ProcCompleteAddAdj: 186 - Allows user to add an adjustment to a procedure (date locked)
ProcCompleteEditMisc: 187 - Misc Edit that includes "Do Not Bill Ins" and "Hide Graphics" (date locked)
ProcCompleteNote: 188 - Edit the note of a completed procedure
ProcCompleteEdit: 189 - Edit main information of a procedure that is not already covered by the other permissions. Is not all inclusive.
ProtectedLeaveAdjustmentEdit: 190 - User can create, edit, and delete time card adjustments for protected leave on their time card of the current pay period. Users that also have the Edit All Time Cards permission, have this permission for all time cards.
TimeAdjustEdit: 191 - Logs when a time card adjustment is created, edited, or deleted.
QueryMonitor: 192 - Permission for users to monitor queries
CommlogCreate: 193 - Permission for users to create commlogs.
WebFormAccess: 194 - Permission for users to modify and discard webforms
CloseOtherSessions: 195 - Close other sessions of Open Dental Cloud
RepeatChargeCreate: 196 - Permission for Repeating Charge creation.
RepeatChargeUpdate: 197 - Permission for Repeating Charge update.
RepeatChargeDelete: 198 - Permission for Repeating Charge deletion.
Zoom: 199 - User can open the zoom window and edit zoom level. Used to block remote application users who all share the same computer.
FormAdded: 200 - Permission for forms added to eclipboard mobile check in.
ImageExport: 201. Uses date restrictions.
ImageCreate: 202. Permission to Scan, Import, and Create Images.
CertificationEmployee: 203 - Permission to update Employee Certifications.
CertificationSetup: 204 - Permission to set up Certifications.
EmployerCreate: 205 - Permission to create Employers.
AllowLoginFromAnyLocation: 206 - Permission to allow users to login to ODCloud from any IP Address.
LogDoseSpotMedicationNoteEdit: 207 - Logging only. Creates an entry if a medicationpat.PatNote needs to be truncated before sending to DoseSpot.
PayPlanChargeDateEdit: 208 - Allows user to edit a payment plan charge date that has an APR.
DiscountPlanAdd: 209 - Logs when discount plans are added. For audit trails only.
DiscountPlanEdit: 210 - Logs when discount plans are edited. For audit trails only.
AllowFeeEditWhileReceivingClaim: 211 - Permission to allow users without FeeSchedEdit permission to update fee schedule while receiving claims.
ManageHighSecurityProgProperties: 212 - Permission for managing high security program properties.
CreditCardEdit: 213 - Logs when a patient's credit card is edited.
MedicationDefEdit: 214 - Allows user to edit medication definitions.
AllergyDefEdit: 215 - Allows user to edit allergy definitions.
Advertising: 216 - Allows user to setup and use Advertising features like Postcards.
TextMessageView: 217 - Allows user to view text messages.
TextMessageSend: 218 - Allows uer to send text messages.
RxMerge: 219 - Allows user to merge prescriptions.
DefEdit: 220 - Allows user to add or update Definitions.
UpdateInstall: 221 - Allows user to install Open Dental updates.
AdjustmentTypeDeny: 222 - Denies users access to specific adjustment types. Special type of permission where having this permission actually denies users access. If a usergroup has an entry for this permission, then they do not have access to the adjustment type with the defnum that is stored in grouppermission.FKey. Pattern approved by Jordan.
StatementCSV: 223 - Allows user to export statements as CSV files.
CarrierEdit: 224 - Allows users to edit carriers.
ApiSubscription: 225 - Logs when API subscriptions are added or deleted. For audit trails only.
SecurityGlobal: 226 - Logs changes to global lock date. For audit trails only.
TaskDelete: 228 - Allows user to delete tasks.
SetupWizard: 229 - Allows user to use setup wizard.
ShowFeatures: 230 - Allows user to use show features.
PrinterSetup: 231 - Allows user to setup printer.
ProviderAdd: 232 - Allows user to add provider.
ClinicEdit: 233 - Allows user to edit clinic.
ApiAccountEdit: 234 - Allows the editing of customer accounts for the ODApi via the BCM.
RegistrationKeyCreate: 235 - Logs when registration keys are created. For audit trails only.
RegistrationKeyEdit: 236 - Logs when registration keys are edited. For audit trails only.
AppointmentDelete: 237 - Allows user to delete appointments.
AppointmentCompleteDelete: 238 - Allows user to delete completed appointments.
AppointmentTypeEdit: 239 - Logs when Appointment Types are edited. For audit trails only.
TextingAccountEdit: 240 - Only used at OD HQ. Allows users to make high level changes in regards to texting.
WebChatEdit: 241 - Logs when web chat sessions are edited. For audit trails only.
SupplierEdit: 242 - Allows users to access FormSuppliers
SupplyPurchases: 243 - Logs when any supply purchases are created, placed, or deleted.
PreferenceEditBroadcastMonitor: 244 - Only used at OD HQ. Ability to edit table rows via Broadcast Monitor.
AppointmentResize: 245 - Allows users to resize appointments.
CreditCardTerminal: 246 - Logs when a user pays with a credit card. For Audit Trails only.
ViewAppointmentAuditTrail: 247 - Only for viewing the audit trail in FormEditAppointment
PayPlanChargeEdit: 248 - Logs when a user edits a payment plan charge.
ArchivedPatientSelect: 249 - Also see ArchivedPatientEdit. Blocking user from patient selection prevents changes to all the other tables besides the patient table. It's more rigorous.
CloudCustomerEdit: 250 - Only used at OD HQ. Ability to edit Cloud tab info via Broadcast Monitor.
ChanSpy: 251 - Only used at OD HQ. Ability to listen to live calls.
ClaimProcFieldsBilledToInsEdit: 252 - Ability to edit Fee Billed to Insurance or Code Sent to Insurance in FormClaimProc, whether new or existing.
AllergyMerge: 253 - Allow users to merge allergies.
AiChatSession: 254 - Only used at OD HQ. Ability to open the AI chat window.
BadgeIdEdit: 255 - Allow users to edit BadgeIds in the userod table.
ChildDaycareEdit: 256 - Internal Child Daycare only. Allow users to make changes to the daycare. Only used at HQ.
PerioEditCopy: 257 - Allow users to copy perio charts in the Perio Chart window.
LicenseAccept: 258 - For audit trail only. Logs when a license is accepted by a user.
EFormEdit: 259 - Uses date restrictions but no global lock date. Also used in audit trail to log importing.
EFormDelete: 260 - Allows deleting eForms when they're attached to patients. No date restrictions.
MobileNotification: 261 - Used for logging only. Can be used to log whenever mobile notifications are inserted into the database.
ChartViewsEdit: 262 - Allows users to move chart views up and down, and add new chart views
SuperFamilyDisband: 263 - Allows disbanding of Super Families.
ImageSignatureCreate: 264 - Allows creation of note and signature for images without a signature.
SignedImageEdit: 265 - Allows editing and deletion of note and signature for images with a signature. Allows users with the ImageEdit permission to edit signed images. Allows users with the ImageDelete permission to delete signed images.
BlockoutsFlagged: 266 - There are two kinds of blockouts: those flagged as NS(no sched) or DC(disable cut/copy/paste) and those with no flag. This permission handles all the flagged blockouts, including add, edit, copy/paste, and delete. Logs an audit trail entry when a flagged blockout is added, edited, deleted, cut, copied, pasted, or cleared. See Blockouts permission for the other unflagged blockouts.
PayPlanUnlock: 267 - Payment plans have a 'Locked' checkbox. This permission allows the user to uncheck that box which will unlock the payment plan. Users without this permission will not be able to unlock a payment plan.
SendAlertsFromHQ: 268 - Allows sending notifications from HQ to customers. Only used at HQ.
TextAllEmployees: 269 - Only used at OD HQ. Ability to send mass texts to all current employees.
ProcTPEditFee: 270 - Allows editing the fee of a treatment planned procedure.
EFormImport: 271 - Only used to make log entries.
BlockoutAdd: 272 - This permission handles adding blockouts with no flag.
BlockoutDelete: 273 - This permission handles deleting blockouts with no flag.
PhoneExtension: 274 - Only used at HQ to make audit trail entries when a change is made to a row in the Phone table.
5	FKey	bigint(20)	Generic foreign key to any other table. Typically used in combination with PermType to give permission to specific things.

guardian
Links patient to patient in a many to many database relationship. The two PatNums need not be in the same family, but will usually be. The two PatNums could be in different families if the relationship was entered, then one of the patients in the relationship is moved to another family. This table can also be used for other relationship types besides guardians. The table name is guardian because we only supported guardian relationships in the past, and we did not want to risk breaking queries by changing the table or column names. User can specify any relationship as a guardian or not a guardian. For example, a retired person might specify their brother or child as their guardian, or the user may want to record the brother of a patient as a non-guardian.
Order	Name	Type	Summary
0	GuardianNum	bigint(20)	Primary key.
1	PatNumChild	bigint(20)	FK to patient.PatNum. If Relationship is "Mother", then this PatNum is the child of the mother.
2	PatNumGuardian	bigint(20)	FK to patient.PatNum. If Relationship is "Mother", then this is the PatNum of the mother.
3	Relationship	tinyint(4)	Enum:GuardianRelationship .
None: 0 - Never stored in db guardian table, but can be stored in eFormField for import purposes.
Mother: 1 - Added due to feature request. Needed for EHR.
Stepfather: 2 - Added due to feature request.
Stepmother: 3 - Added due to feature request.
Grandfather: 4 - Added due to feature request.
Grandmother: 5 - Added due to feature request.
Father: 6 - Added due to feature request. Needed for EHR.
Brother: 7 - Added for EHR.
CareGiver: 8 - Added for EHR.
FosterChild: 9 - Added for EHR.
Guardian: 10 - Added for EHR. Also meets request #154.
Grandparent: 11 - Added for EHR.
Other: 12 - Added for EHR. Also meets request #154.
Parent: 13 - Added for EHR. Also meets request #154.
Stepchild: 14 - Added for EHR.
Self: 15 - Added for EHR.
Sibling: 16 - Added for EHR.
Sister: 17 - Added for EHR. Also meets request #154.
Spouse: 18 - Added for EHR.
Child: 19 - Added for EHR.
LifePartner: 20 - Added for EHR.
Friend: 21 - Added for EHR.
Grandchild: 22 - Added for EHR.
Sitter: 23 - Added due to feature request. Maps to caregiver in EHR.
4	IsGuardian	tinyint(4)	True if this specifies a guardian relationship, or false if any other relationship. When this flag is true, the relationship will show in the "Guardians" appointment view field and in the family module "Guardians" display field for the patient. This also grants PHI access in the patient portal to the specific patient designated via PatNumChild.

hcpcs
A code system used in EHR. Healhtcare Common Procedure Coding System. Another system used to describe procedure codes.
Order	Name	Type	Summary
0	HcpcsNum	bigint(20)	Primary key..
1	HcpcsCode	varchar(255)	Examples: AQ, J1040
2	DescriptionShort	varchar(255)	Short description. This is the HCPCS supplied abbreviated description.

hieclinic
Health Information Exchange clinic settings. This table stores settings for generating automatic CCDs.
Order	Name	Type	Summary
0	HieClinicNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClincNum.
2	SupportedCarrierFlags	tinyint(4)	Enum:HieCarrierFlags AllPatient=0,Medicaid=1. Indicates the supported carrier, bitwise.
AllCarriers: No carrier set. All carriers are supported.
3	PathExportCCD	varchar(255)	The path to export CCD. This field will not be blank when enabled.
4	TimeOfDayExportCCD	bigint(20)	The time to export CCD.
5	IsEnabled	tinyint(4)	

hiequeue
Health Information Exchange queue. This table stores pending patients that need to be considered for an auto-generated CCD.
Order	Name	Type	Summary
0	HieQueueNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.

histappointment
A historical copy of an appointment. These are generated as a result of an appointment being edited. When creating for insertion it needs a passed-in Appointment object.
Order	Name	Type	Summary
0	HistApptNum	bigint(20)	Primary key.
1	HistUserNum	bigint(20)	FK to userod.UserNum Identifies the user that changed this appointment from previous state, not the person who originally wrote it.
2	HistDateTStamp	datetime	The date and time that this appointment was edited and added to the Hist table.
3	HistApptAction	tinyint(4)	Enum:HistAppointmentAction .
Created: 0
Changed: 1
Missed: 2
Cancelled: 3
Deleted: 4
4	ApptSource	tinyint(4)	Enum:EServiceTypes .
None: Not an eService user. All valid users should be this type otherwise permission checking will act differently.
EConnector:
Broadcaster:
BroadcastMonitor:
ServiceMainHQ:
OpenDentalService: Used by the OpenDentalService. Not a eService but we need the "phantom" user to behave like eService users.
OpenDentalAPIService: Used by the Open Dental API Service.
5	AptNum	bigint(20)	Copied from Appointment.
6	PatNum	bigint(20)	Copied from Appointment.
7	AptStatus	tinyint(4)	Copied from Appointment.
8	Pattern	varchar(255)	Copied from Appointment.
9	Confirmed	bigint(20)	Copied from Appointment.
10	TimeLocked	tinyint(4)	Copied from Appointment.
11	Op	bigint(20)	Copied from Appointment.
12	Note	text	Copied from Appointment.
13	ProvNum	bigint(20)	Copied from Appointment.
14	ProvHyg	bigint(20)	Copied from Appointment.
15	AptDateTime	datetime	Copied from Appointment.
16	NextAptNum	bigint(20)	Copied from Appointment.
17	UnschedStatus	bigint(20)	Copied from Appointment.
18	IsNewPatient	tinyint(4)	Copied from Appointment.
19	ProcDescript	text	Copied from Appointment.
20	Assistant	bigint(20)	Copied from Appointment.
21	ClinicNum	bigint(20)	Copied from Appointment.
22	IsHygiene	tinyint(4)	Copied from Appointment.
23	DateTStamp	timestamp	Not copied from Appointment. Automatically updated by MySQL every time a row is added or changed.
24	DateTimeArrived	datetime	Copied from Appointment.
25	DateTimeSeated	datetime	Copied from Appointment.
26	DateTimeDismissed	datetime	Copied from Appointment.
27	InsPlan1	bigint(20)	Copied from Appointment.
28	InsPlan2	bigint(20)	Copied from Appointment.
29	DateTimeAskedToArrive	datetime	Copied from Appointment.
30	ProcsColored	text	Copied from Appointment.
31	ColorOverride	int(11)	Copied from Appointment.
32	AppointmentTypeNum	bigint(20)	Copied from Appointment.
33	SecUserNumEntry	bigint(20)	Copied from Appointment.
34	SecDateTEntry	datetime	Copied from Appointment.
35	Priority	tinyint(4)	Copied from Appointment.
36	ProvBarText	varchar(60)	Copied from Appointment.
37	PatternSecondary	varchar(255)	Copied from Appointment.
38	SecurityHash	varchar(255)	Copied from Appointment.
39	ItemOrderPlanned	int(11)	Copied from Appointment.
40	IsMirrored	tinyint(4)	Copied from Appointment.

hl7def
.
Order	Name	Type	Summary
0	HL7DefNum	bigint(20)	Primary key.
1	Description	varchar(255)	
2	ModeTx	tinyint(4)	Enum:ModeTxHL7 File, TcpIp.
File: 0
TcpIp: 1
Sftp: 2. Used for MedLab HL7 transmission, currently only LabCorp.
3	IncomingFolder	varchar(255)	Used for File mode and for SFTP mode. For file mode, this is the folder for inbound HL7 messages. For SFTP mode, this is the relative path from the SFTP root directory to the directory where the result messages can be found. The root or home directory '.' can be included in the path but is not necessary. Examples: /./results or /results or results.
4	OutgoingFolder	varchar(255)	Only used for File mode
5	IncomingPort	varchar(255)	Only used for tcpip mode. Example: 1461
6	OutgoingIpPort	varchar(255)	Only used for tcpip mode. Example: 192.168.0.23:1462
7	FieldSeparator	varchar(5)	Only relevant for outgoing. Incoming field separators are defined in MSH. Default |.
8	ComponentSeparator	varchar(5)	Only relevant for outgoing. Incoming field separators are defined in MSH. Default ^.
9	SubcomponentSeparator	varchar(5)	Only relevant for outgoing. Incoming field separators are defined in MSH. Default &.
10	RepetitionSeparator	varchar(5)	Only relevant for outgoing. Incoming field separators are defined in MSH. Default ~.
11	EscapeCharacter	varchar(5)	Only relevant for outgoing. Incoming field separators are defined in MSH. Default \.
12	IsInternal	tinyint(4)	If this is set, then there will be no child tables. Internal types are fully defined within the C# code rather than in the database.
13	InternalType	varchar(255)	Enum:HL7InternalType Stored in db as string, but used in OD as enum HL7InternalType. Example: eCWTight. This will always have a value because we always start with a copy of some internal type.
eCWFull: Message structure is identical to eCWTight, minor changes in the program like showing patient demographics and the account module.Like eCWTight, eCW dictates the patients' PatNums in PID.2, so we try to locate the patient with that PatNum.If not found we do not attempt to use PID.4 ChartNumber or name, we assume new patient and insert.
eCWStandalone: Only Incoming ADT messages are processed, OD is responsible for adding patients so we assign PatNum.The incoming messages patient ID in PID.2 is stored as ChartNumber and PID.4 is not processed.The Account and Chart modules are visible and the users can change and add patients in OD. No outgoing messages.
eCWTight: Patient demographics are hidden as well as account and appt modules.We let eCW dictate the PatNum values in PID.2 and trust that they are unique and longs (no string characters).Unlike Standalone, if the pat isn't found by PID.2 PatNum we don't try to locate the pat by PID.4 ChartNumber or name, we assume it's a new pat.
Centricity: Account and Appointment modules are visible and users can change and add patients.Only outgoing DFT message defined, no incoming messages are processed.
HL7v2_6: Our default behavior for processing and sending HL7 messages.Send and receive ADT and SIU messages, receive DFT messages.The v2.6 documentation claims both PID.2 and PID.4 are only retained for backward compatibility and PID.3 is now required and used for a list of patient IDs.We will still put ChartNumber in PID.2 (used to be referred to as 'external ID' by HL7 doc) for outgoing msgs and look for our PatNum in PID.2 for incoming msgs.We will now also check PID.3 for a repitition that contains our PatNum as part of the CX data type.Account and Appointments module are visible and users can change and add patients.
MedLabv2_3: This is currently used for LabCorp and is based on HL7 version 2.3 specifications. This interface has been built to the LabCorp standards and may not match the HL7 version 2.3 specs exactly.
14	InternalTypeVersion	varchar(50)	Example: 12.2.14. This will be empty if IsInternal. This records the version at which they made their copy. We might have made significant improvements since their copy.
15	IsEnabled	tinyint(4)	.
16	Note	text	
17	HL7Server	varchar(255)	The machine name of the computer where the OpenDentHL7 service for this def is running.
18	HL7ServiceName	varchar(255)	The name of the HL7 service for this def. Must begin with OpenDent...
19	ShowDemographics	tinyint(4)	Enum:HL7ShowDemographics Hide,Show,Change,ChangeAndAdd
Hide: Cannot see or change.
Show: Can see, but not change.
Change: Can change, but not add patients. Might get overwritten by next incoming message.
ChangeAndAdd: Can change and add patients. Might get overwritten by next incoming message.
20	ShowAppts	tinyint(4)	Show Appointments module.
21	ShowAccount	tinyint(4)	Show Account module
22	IsQuadAsToothNum	tinyint(4)	Send the quadrant in the tooth number component instead of the surface component of the FT1.26 field of the outgoing DFT messages. Only for eCW.
23	LabResultImageCat	bigint(20)	FK to definition.DefNum. Image category used by MedLab HL7 interfaces when storing PDFs received via inbound HL7 messages.
24	SftpUsername	varchar(255)	The username for logging into the Sftp server.
25	SftpPassword	varchar(255)	The password used with the SftpUsername to log into the Sftp server. This won't be displayed to the user but will be stored as encrypted text in the db.
26	SftpInSocket	varchar(255)	The socket used to connect to the Sftp server for retrieving inbound HL7 messages. Currently only used by MedLabv2_3 interfaces. This will be the address:port of the Sftp server to connect to for retrieving lab results. Example: server.address.com:20020.
27	HasLongDCodes	tinyint(4)	For eCW HL7 interfaces only. False by default. When false, D codes sent in outbound DFT messages will be limited to 5 characters. Any additional characters will be stripped off when generating the HL7 message. When true, D codes will not be truncated.
28	IsProcApptEnforced	tinyint(4)	If true a message box will warn users if they try to send procedures from the chart module that are not attached to an appointment.

hl7deffield
Multiple fields per segment.
Order	Name	Type	Summary
0	HL7DefFieldNum	bigint(20)	Primary key.
1	HL7DefSegmentNum	bigint(20)	FK to hl7deffield.HL7DefSegmentNum
2	OrdinalPos	int(11)	Position within the segment.
3	TableId	varchar(255)	HL7 table Id, if applicable. Example: 0234. Example: 1234/2345. DataType will be ID.
4	DataType	varchar(255)	The DataTypeHL7 enum will be unlinked from the db by storing as string in db. As it's loaded into OD, it will become an enum.
5	FieldName	varchar(255)	User will get to pick from a list of fields that we will maintain. Example: guar.nameLFM, prov.provIdName, or pat.addressCityStateZip. See below for the full list. This will be blank if this is a fixed text field.
6	FixedText	text	User will need to insert fixed text for some fields. Either FixedText or FieldName will have a value, not both.

hl7defmessage
There is no field for MessageStructureHL7 (ADT_A01), because that will be inferred. Defined in HL7 specs, section 2.16.3.
Order	Name	Type	Summary
0	HL7DefMessageNum	bigint(20)	Primary key.
1	HL7DefNum	bigint(20)	FK to hl7def.HL7DefNum
2	MessageType	varchar(255)	Enum:MessageTypeHL7 Stored in db as string, but used in OD as enum MessageTypeHL7. Example: ADT
NotDefined: Use this for unsupported message types
ACK: Message Acknowledgment
ADT: Demographics - A01,A04,A08,A28,A31
DFT: Detailed Financial Transaction - P03
ORU: Unsolicited Observation Message - R01
PPR: Patient Problem - PC1,PC2,PC3
SIU: Schedule Information Unsolicited - Event types S12 through S26. Currently only S12, S14, S15, and S17 events are supported. Inbound for eCW, outbound for other interfaces.
SRM: Schedule Request Message - Event types S01 through S11. Currently only S03 and S04 events are supported. Not used for eCW, inbound for other interfaces.
SRR: Schedule Request Response - Event types S01 through S11. Currently only S03 and S04 events are supported. Not used for eCW, inbound for other interfaces.
VXU: Unsolicited Vaccination Record Update - V04
3	EventType	varchar(255)	Enum:EventTypeHL7 Stored in db as string, but used in OD as enum EventTypeHL7. Example: A04, which is only used with ADT/ACK.
NotDefined: Use this for unsupported event types
A04: Only used with ADT/ACK. A04 - Register a PatientFor eCW, the A04 and A08 are inbound messages and are processed the same. We attempt to locate the patient, if not found we insert one.For other interfaces, the same method of locating a patient and if not found inserting one will be used for inbound ADT^A04 and ADT^A08 messages.Outbound messages will have an A04 event type if a new patient is added
A08: Only used with ADT/ACK. A08 - Update Patient InfoA04 and A08 inbound are processed the same, but we will send the A08 event type if updating a patient in an outbound ADT.
P03: Only used with DFT/ACK.
PC1: Only used with PPR/ACK (Patient Problem messages). Not used for eCW.These are inbound messages for adding/updating patient problems.PC1 is the Add event. Add and Update events will be handled the same for now.
PC2: Only used with PPR/ACK (Patient Problem messages). Not used for eCW.PC2 is the Update event. Add and Update events will be handled the same for now.
S03: Only used with SRM/SRR/ACK. S03 - Request Appointment Modification. Not used for eCW.These will be inbound and are used for updating a limited amount of information for an existing appointment.S03 messages are used to update appointments.
S04: Only used with SRM/SRR/ACK. S04 - Request Appointment Cancellation. Not used for eCW.S04 messages are used to set an appointment.AptStatus to ApptStatus.Broken.
S12: Only used with SIU/ACK. S12 - New ApptFor eCW, these are inbound, OD is considered an auxiliary application, and S12 and S14 messages are processed the same.For interfaces that require outbound SIU messages, OD is considered the filler application since OD has control over the operatories and schedules.As the filler application, events S12-S26 are the message events and they all have the same structure defined by HL7.Different actions in OD will cause a different outbound event type to be inserted, but the defined segments and fields will otherwise be the same.
S13: Only used with SIU/ACK. S13 - Appt Rescheduling
S14: Only used with SIU/ACK. S14 - Appt Modification
S15: Only used with SIU/ACK. S15 - Appt Cancellation
S17: Only used with SIU/ACK. S17 - Appt Deletion
4	InOrOut	tinyint(4)	Enum:InOutHL7 Incoming, Outgoing
Incoming: 0
Outgoing: 1
5	ItemOrder	int(11)	The only purpose of this column is to let you change the order in the HL7 Def windows. It's just for convenience.
6	Note	text	text
7	MessageStructure	varchar(255)	Enum:MessageStructureHL7 Stored in db as string, but used in OD as enum MessageStructure. Example: ADT_A01, which is the structure used for event types A01, A04, A08, and A13.
NotDefined: Use this for unsupported message structures
ADT_A01: Used for ADT/ACK event types A01, A04, A08, and A13. We currently only support A04 and A08 event types, both will use this structure.
DFT_P03: Used for DFT/ACK event type P03. All outbound DFT's are this structure.
ORU_R01: Used for ORU/ACK event type R01. All inbound ORU - Unsolicited transmission of an observation message will use this structure.This is used for all inbound LabCorp messages.
PPR_PC1: Used for PPR/ACK event types PC1, PC2, and PC3. We currently only support PC1 (add problem) and PC2 (update problem), both use this structure.
SIU_S12: Used for SIU/ACK event types S12 through S24 and S26. We currently only support S12 through S17.Inbound SIU's are all treated the same, regardless of the event type.We send different event types in outbound SIU's depending on the action that causes the message.All SIU's, inbound or outbound, use this message structure.
SRM_S01: Used for SRM/ACK event types S01 through S11. We currently only support S03 (update appt request) and S04 (cancel appt request).SRM's are inbound and when the action of updating or cancelling the appt is completed, an SRR is sent.SRM's and SRR's still require ACK's. i.e. SRM received, ACK sent, action completed leads to SRR sent, ACK received.SRM's and SRR's will all use this message structure.
SRR_S01: Used for SRR/ACK event types S01 through S11. We currently only support S03 and S04 (see SRM_S01).SRR's are outbound and sent when an SRM is processed correctly.

hl7defsegment
multiple segments per message
Order	Name	Type	Summary
0	HL7DefSegmentNum	bigint(20)	Primary key.
1	HL7DefMessageNum	bigint(20)	FK to hl7defmessage.HL7DefMessageNum
2	ItemOrder	int(11)	Since we don't enforce or automate, it can be 1-based or 0-based. For outgoing, this affects the message structure. For incoming, this is just for convenience and organization in the HL7 Def windows.
3	CanRepeat	tinyint(4)	For example, a DFT can have multiple FT1 segments. This turns out to be a completely useless field, since we already know which ones can repeat.
4	IsOptional	tinyint(4)	If this is false, and an incoming message is missing this segment, then it gets logged as an error/failure. If this is true, then it will gracefully skip a missing incoming segment. Not used for outgoing.
5	SegmentName	varchar(255)	Stored in db as string, but used in OD as enum SegmentNameHL7. Example: PID.
6	Note	text	.

hl7msg
HL7 messages sent and received.
Order	Name	Type	Summary
0	HL7MsgNum	bigint(20)	Primary key.
1	HL7Status	int(11)	Enum:HL7MessageStatus Out/In are relative to Open Dental. This is in contrast to the names of the old ecw folders, which were relative to the other program. OutPending, OutSent, InReceived, InProcessed.
OutPending: 0
OutSent: 1
OutFailed: 2-Tried to send, but there was a problem. Will keep trying.
InProcessed: 3
InFailed: 4
2	MsgText	mediumtext	The actual HL7 message in its entirity.
3	AptNum	bigint(20)	FK to appointment.AptNum. Many of the messages contain "Visit ID" which is equivalent to our AptNum.
4	DateTStamp	timestamp	Used to determine which messages are old so that they can be cleaned up.
5	PatNum	bigint(20)	FK to patient.PatNum.
6	Note	text	

hl7procattach
Keeps track of whether procedures have been sent in an HL7 message.
Order	Name	Type	Summary
0	HL7ProcAttachNum	bigint(20)	Primary key.
1	HL7MsgNum	bigint(20)	FK to hl7msg.HL7MsgNum.
2	ProcNum	bigint(20)	FK to procedurelog.ProcNum.

icd10
Other tables generally use the ICD10Code string as their foreign key. It is implied that these are all ICD10CMs, although that may not be the case in the future.
Order	Name	Type	Summary
0	Icd10Num	bigint(20)	Primary key. Also identical to "Order Number" column in ICD10 documentation.
1	Icd10Code	varchar(255)	ICD-10-CM or ICD-10-PCS code. Dots are included. Not allowed to edit this column once saved in the database.
2	Description	varchar(255)	Short Description provided by ICD10 documentation.
3	IsCode	varchar(255)	0 if the code is a “header” – not valid for submission on a UB04. 1 if the code is valid for submission on a UB04.

icd9
Other tables generally use the ICD9Code string as their foreign key. Currently synched to mobile server in a very inefficient manner. It is implied that these are all ICD9CMs, although that may not be the case in the future.
Order	Name	Type	Summary
0	ICD9Num	bigint(20)	Primary key.
1	ICD9Code	varchar(255)	Not allowed to edit this column once saved in the database.
2	Description	varchar(255)	Description.
3	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.

imagedraw
Image text, lines. drawings, and scales. Attached to either a document or a mount. Drawings are in pixel coordinates of original image prior to any cropping or rotating. For a mount, coordinates are relative to the entire mount. Drawings do not get changed when cropping or rotating are changed. The result is that drawings always stay on the image in exactly the original location, and they move with the image.
Order	Name	Type	Summary
0	ImageDrawNum	bigint(20)	Primary key.
1	DocNum	bigint(20)	FK to document.DocNum
2	MountNum	bigint(20)	FK to mount.MountNum
3	ColorDraw	int(11)	For text, this is the foreground color. For lines, this is the color, and ColorBack is not used. For polygons, this is the fill color. No transparency component.
4	ColorBack	int(11)	Background color for text. Can be Transparent (0,255,255,255)=16777215.
5	DrawingSegment	text	Point data for a drawing segment. The format would look similar to this: 45.2,68.1;48,70;49,72;0,0;55,88;etc. It's simply a sequence of points, separated by semicolons. Only positive floats are used, rounded to one decimal place. 0,0 is the upper left of the image or mount. Cropping is ignored. If the pen is picked up, it becomes a new segment, so a new row in the database. Or, if this is DrawType.ScaleValue, then this field stores scale, decimal places, and units, separated by spaces. Example: "123.4 0 mm". The first two are required; units is optional.
6	DrawText	varchar(255)	The location of the text in pixels is incorporated into this string. Example: 25,123;This shows. Carriage returns etc are not supported. ColorDraw and FontSize are also used. Unlike tooth initial, this does not support floats.
7	FontSize	float	This could vary significantly based on the size of the image. It's always relative to orginal image or mount pixels. Always 0 for Pearl.
8	DrawType	tinyint(4)	Enum:ImageDrawType
Text: 0 - Location and string, combined
Line: 1 - A series of straight lines, stored the same as a pen drawing.
Pen: 2 - One continuous segment of a drawing.
ScaleValue: 3 - Stores a float, decimals, and units in the drawing segement. Only one of this type is allowed per image or mount.
Polygon: 4 - A series of connected points forming the outline of a closed polygon. Stored same as pen drawing. Polygons only have a fill color, not any outline color.
9	ImageAnnotVendor	tinyint(4)	Enum:EnumImageAnnotVendor 0: Open Dental drawings and text, 1:Pearl AI annotations.
OpenDental: 0 - Open Dental drawings and text.
Pearl: 1 - Pearl AI annotations.
BetterDiagnostics: 2 - Better Diagnostics AI annotations.
10	Details	text	Extra space for any text. Currently only used for Pearl annotation categories, relationship properties, and relationship values, which are all stored as a single chunk of user readable text drawn straight to screen when hovering.
11	PearlLayer	tinyint(4)	Enum:Pearl.EnumCategoryOD This is how we hide and show layers for Pearl objects in the Imaging module.
None: 0 - None.
Crown: 1 - Crown.
PeriapicalRadiolucency: 2 - Periapical Radiolucency.
Filling: 3 - Filling.
Anatomy: 4 - Anatomy.
CariesProgressed: 5 - Caries -Progressed.
NotableMargin: 6 - Notable Margin.
Implant: 7 - Implant.
RootCanal: 8 - Root Canal.
Bridge: 9 - Bridge.
Calculus: 10 - Calculus.
Measurements: 11 - Measurements.
Bone: 12 - Bone (Tooth Part).
Cementum: 13 - Cementum (Tooth Part).
Dentin: 14 - Dentin (Tooth Part).
Enamel: 15 - Enamel (Tooth Part).
Pulp: 16 - Pulp (Tooth Part).
Restoration: 17 - Restoration (Tooth Part).
InferiorAlveolarNerve: 18 - Inferior Alveolar Nerve (Tooth Part). Not included in legend.
Sinus: 19 - Sinus (Tooth Part). Not included in legend.
NasalCavity: 20 - NasalCavity (Tooth Part). Not included in legend.
CariesIncipient: 21 - Caries -Incipient.
12	BetterDiagLayer	tinyint(4)	Enum:EnumCategoryBetterDiag This is how we hide and show layers for BetterDiagnostics objects in the Imaging module.
None: 0 - None.
Dentin: 1 - Dentin.
Enamel: 2 - Enamel.
Pulp: 3 - Pulp.
Restoration: 4 - Restoration.
Crown: 5 - Crown.
Cavity: 6 - Cavity.
BoneLoss: 7 - Bone Loss.
PeriapicalRadiolucency: 8 - Periapical Radiolucency.
BoneLevel: 9 - Bone Level.
Iac: 10 - Iac. Inferior alveolar canal.
NasalFloor: 11 - Nasal floor.
NormalTmj: 12 - Normal Tmj.
Sinus: 13 - Sinus.
RootStumps: 14 - Root stumps.
MissingTooth: 15 - Missing tooth.
Calculus: 16 - Calculus.
Disclaimer: 17 - FDA Disclaimer.
MarginalDiscrepancy: 18 - Marginal discrepancies.

imagingdevice
Xray sensor, camera, etc. Depending on the hardware, this can either be one physical device or a set of similar devices.
Order	Name	Type	Summary
0	ImagingDeviceNum	bigint(20)	Primary key.
1	Description	varchar(255)	Any description of the device.
2	ComputerName	varchar(255)	Name of the computer where this device is available. Optional. If blank, then this device will be available to all computers.
3	DeviceType	tinyint(4)	Enum:EnumImgDeviceType TwainRadiograph, XDR(not functional), or TwainMulti.
TwainRadiograph: 0
XDR: 1
TwainMulti: 2
4	TwainName	varchar(255)	The name of the twain device as in Windows.
5	ItemOrder	int(11)	
6	ShowTwainUI	tinyint(4)	

insbluebook
One row for each procedure primary/secondary claim combination. Records insurance plan and insurance payment data of a procedure that has been paid on primary or secondary insurance claim made to out of network plans. This data is used to estimate allowed fees and make more accurate insurance estimates. It will be processed and summarized as entries in InsBlueBookAllowedFees.
Order	Name	Type	Summary
0	InsBlueBookNum	bigint(20)	Primary key.
1	ProcCodeNum	bigint(20)	FK to procedurecode.CodeNum. The code of the procedure.
2	CarrierNum	bigint(20)	FK to insplan.CarrierNum. The carrier that the insurance plan belongs to.
3	PlanNum	bigint(20)	FK to insplan.PlanNum. The insurance plan for which the claim was made.
4	GroupNum	varchar(25)	The insplan.GroupNum. May be blank.
5	InsPayAmt	double	The sum of InsPayAmt per claim for received and supplemental claimprocs of the procedure that are associated to the insurance plan. Not used for future estimate calculations.
6	AllowedOverride	double	The AllowedOverride of the received claimproc on the claim. This is the number that is actually used to provide the estimate for future payments.
7	DateTEntry	datetime	The date and time of entry. Not editable by user.
8	ProcNum	bigint(20)	FK to procedurelog.ProcNum.
9	ProcDate	date	The date of service, derived from claimproc.ProcDate of the received claimproc on the claim.
10	ClaimType	varchar(10)	The claim.ClaimType. Currently only gathering data for primary and secondary claims, so this will be "P"(Primary) or "S"(Secondary).
11	ClaimNum	bigint(20)	FK to claim.ClaimNum.

insbluebooklog
Logs all changes made to claimproc estimates that are made by the Blue Book feature.
Order	Name	Type	Summary
0	InsBlueBookLogNum	bigint(20)	Primary key.
1	ClaimProcNum	bigint(20)	FK to claimproc.ClaimProcNum. The claimproc for which the estimate was changed.
2	AllowedFee	double	The new claimproc.InsEstTotal that was calculated from a group of AllowedOverrides by the Blue Book feature.
3	DateTEntry	datetime	The date and time of entry. Not editable by user.
4	Description	text	Explanation of how the Blue Book feature obtained the new insurance estimate.

insbluebookrule
The insbluebookrule table represents an ordered hierarchy of rules that the program will attempt to apply when determining insurance estimates for out of network plans. If the highest priority rule does not produce an estimate, the program attempts to apply the second rule, and so on, until an estimate is obtained. Always same number of rows (6), just allowed to customize order and details.
Order	Name	Type	Summary
0	InsBlueBookRuleNum	bigint(20)	Primary key.
1	ItemOrder	smallint(6)	0 based. This rule's priority in the hierarchy of all insbluebookrules. 0 is highest priority.
2	RuleType	tinyint(4)	Enum:InsBlueBookRuleType Types 0 to 3 are for rules that determine estimates by looking at the payment history of an insurance plan, insurance plan group, carrier, or carrier group. Type 4 utilizes fee schedules that are attached to out of network plans that are manually maintained by the user. Type 5 bases estimates off of the provider fee.
InsurancePlan: 0 - Insurance Plan
GroupNumber: 1 - Group Number
InsuranceCarrier: 2 - Insurance Carrier
InsuranceCarrierGroup: 3 - Insurance Carrier Group
ManualBlueBookSchedule: 4 - Manual Blue Book Schedule. You can set a manual BB fee sched on an InsPlan. So to calculate the allowed fee, it does not need to look at any entries in InsBlueBook table.
ProviderFee: 5 - Provider Fee. Since this uses the provider fee, it also does not need to look at any entries in InsBlueBook table.
3	LimitValue	int(11)	The number of years, months, weeks, or days of insurance payment history that will be considered when generating a Blue Book estimate. Will be 0 if the RuleType is 4-ManualBlueBookSchedule or 5-ProviderFee as limits do not apply to these rule types.
4	LimitType	tinyint(4)	Enum:InsBlueBookRuleLimitType Determines the unit of time that InsBlueBookRule.LimitValue represents. Will be 0-None if the RuleType is 4-ManualBlueBookSchedule or 5-ProviderFee as limits do not apply to these rule types.
None: 0 - None
Years: 1 - Years
Months: 2 - Months
Weeks: 3 - Weeks
Days: 4 - Days

inseditlog
Order	Name	Type	Summary
0	InsEditLogNum	bigint(20)	Primary key.
1	FKey	bigint(20)	Key to the foreign table.
2	LogType	tinyint(4)	Enum:InsEditLogType 0 - InsPlan, 1 - Carrier, 2 - Benefit, 3 - Employer.
InsPlan: 0
Carrier: 1
Benefit: 2
Employer: 3
3	FieldName	varchar(255)	The name of the column that was altered.
4	OldValue	varchar(255)	The old value of this field.
5	NewValue	varchar(255)	The new value of this field.
6	UserNum	bigint(20)	FK to userod.UserNum. The user that made this change.
7	DateTStamp	timestamp	Time that the row was inserted into the DB.
8	ParentKey	bigint(20)	Stores the key to the parent table (insplan.PlanNum) when LogType = 2 (Benefit).
9	Description	varchar(255)	The string describing this entry. Displays different information depending on the LogType: 0 - InsPlan: GroupNum and GroupName 1 - Carrier: CarrierNum and CarrierName 2 - Benefit: CovCat Description 3 - Employer: Employer Name

inseditpatlog
Order	Name	Type	Summary
0	InsEditPatLogNum	bigint(20)	Primary key.
1	FKey	bigint(20)	Foreign key to the field flagged with the PriKey attributed for the corresponding table type which is specified by LogType. Note, some logs do not use table type objects that are directly related to the LogType. E.g. Adjustment LogType uses a claimproc entity. 0 - PatPlan: patplan.PatPlanNum. 1 - Subscriber: inssub.InsSubNum. 2 - Adjustment: claimproc.ClaimProcNum.
2	LogType	tinyint(4)	Enum:InsEditPatLogType 0 - PatPlan, 1 - Subscriber, 2 - Adjustment.
PatPlan: 0
Subscriber: 1
Adjustment: 2 - Adjustments to insurance benefits.
3	FieldName	varchar(255)	The name of the column that was altered.
4	OldValue	varchar(255)	The old value of this field.
5	NewValue	varchar(255)	The new value of this field.
6	UserNum	bigint(20)	FK to userod.UserNum. The user that made this change.
7	DateTStamp	timestamp	Time that the row was inserted into the DB.
8	ParentKey	bigint(20)	Used to store another foreign key link to another entity based off of the current LogType. 0 - PatPlan: Not used. 1 - Subscriber: Not used. 2 - Adjustment: claimproc.InsSubNum
9	Description	varchar(255)	The string describing this entry. Displays different information depending on the LogType: 1 - Subscriber: Subscriber's Name, 2 - Adjustment: Insurance Benefit

insfilingcode
An optional field on insplan and claims. This lets user customize so that they can track insurance types. Only used for e-claims. Typically two characters. Examples: CI for Commercial Insurance, VA for Veterans, WC for Worker's Comp, MB for Medicare part B, etc.
Order	Name	Type	Summary
0	InsFilingCodeNum	bigint(20)	Primary key.
1	Descript	varchar(255)	Description of the insurance filing code.
2	EclaimCode	varchar(100)	Code for electronic claim.
3	ItemOrder	int(11)	Display order for this filing code within the UI. 0-indexed.
4	GroupType	bigint(20)	FK to definition.DefNum. Reporting Group.
5	ExcludeOtherCoverageOnPriClaims	tinyint(4)	If set to true, and the patient's secondary insurance plan uses this insfilingcode, the secondary insurance plan will not be populated on primary e-claims or paper claims.

insfilingcodesubtype
Stores the list of insurance filing code subtypes.
Order	Name	Type	Summary
0	InsFilingCodeSubtypeNum	bigint(20)	Primary key.
1	InsFilingCodeNum	bigint(20)	FK to insfilingcode.insfilingcodenum
2	Descript	varchar(255)	The description of the insurance filing code subtype.

inspending
This table is an easy way to import insurance into Open Dental. It avoids all the complexity of InsPlans, Carriers, InsSubs, and PatPlans. The API and eClipboard eForms both take advantage of this table. The office then has control over when and how they convert this InsPending to an actual insurance plan. Details are entered separately for each family member so it can look like there's some duplication in a family. But the UI to convert to a real ins plan handles that smoothly. Ins Pending shows to the left of normal insurance in the Family module. InsPending does not mix with InsSub or PatPlan. There can be multiple InsPendings per patient if needed.
Order	Name	Type	Summary
0	InsPendingNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum The patient who has this insurance. Analogous to patplan.PatNum. Always required.
2	PatNumSubscriber	bigint(20)	FK to patient.PatNum The patient who is the subscriber. Always required.
3	Ordinal	tinyint	Number like 1, 2, 3, etc. Represents primary ins, secondary ins, tertiary ins, etc. But this is really just an indicator of which ordinal the patient "wants" the insurance to go into. It always shows to the left of the true plans in the Family module. These aren't actually intermingled with ins plans. A number here does not indicate that the InsPending is actually in the desired position. Since it's not very important, it can also be 0.
4	Relationship	tinyint(4)	Enum:Relat Required to be Self if this is the subscriber (PatNum==PatNumSubscriber).
Self: 0
Spouse: 1
Child: 2
Employee: 3
HandicapDep: 4
SignifOther: 5
InjuredPlaintiff: 6
LifePartner: 7
Dependent: 8
5	GroupNum	varchar(255)	Optional.
6	GroupName	varchar(255)	Optional.
7	Employer	varchar(255)	Optional.
8	SubscriberID	varchar(255)	Number assigned by insurance company. No dashes. Not allowed to be blank.
9	Phone	varchar(255)	Includes any punctuation.
10	CarrierName	varchar(255)	

insplan
Subscribers can share insplans by using the InsSub table. The patplan table determines coverage for individual patients. InsPlans can also exist without any subscriber.
Order	Name	Type	Summary
0	PlanNum	bigint(20)	Primary key.
1	GroupName	varchar(50)	Optional
2	GroupNum	varchar(50)	Optional. In Canada, this is called the Plan Number.
3	PlanNote	text	Note for this plan. Same for all subscribers.
4	FeeSched	bigint(20)	FK to feesched.FeeSchedNum.
5	PlanType	char(1)	""=percentage(the default),"p"=ppo_percentage,"f"=flatCopay,"c"=capitation.
6	ClaimFormNum	bigint(20)	FK to claimform.ClaimFormNum. eg. "1" for ADA2002. For ADA2006, it varies by office.
7	UseAltCode	tinyint	0=no,1=yes. could later be extended if more alternates required
8	ClaimsUseUCR	tinyint	Fee billed on claim should be the standard provider fee for the patient's provider.
9	CopayFeeSched	bigint(20)	FK to feesched.FeeSchedNum. Not usually used. This fee schedule holds only co-pays(patient portions). Only used for Capitation or for fixed copay plans.
10	EmployerNum	bigint(20)	FK to employer.EmployerNum.
11	CarrierNum	bigint(20)	FK to carrier.CarrierNum.
12	AllowedFeeSched	bigint(20)	FK to feesched.FeeSchedNum. Not usually used. This fee schedule holds amounts allowed by carriers. Always represents a feesched of type OutOfNetwork.
13	TrojanID	varchar(100)	.
14	DivisionNo	varchar(255)	Only used in Canada. It's a suffix to the plan number (group number).
15	IsMedical	tinyint	True if this is medical insurance rather than dental insurance. When creating a claim, this, along with pref.
16	FilingCode	bigint(20)	FK to insfilingcode.InsFilingCodeNum. Used for e-claims. Also used for some complex reports in public health. The e-claim usage might become obsolete when PlanID implemented by HIPAA. Can be 0 to indicate none. Then 'CI' will go out on claims.
17	DentaideCardSequence	tinyint	Canadian e-claim field. D11 and E07. Zero indicates empty. Mandatory value for Dentaide. Not used for all others. 2 digit. DEPRECATED - See CDAnet Message Formats+Standards 4.2_2021.
18	ShowBaseUnits	tinyint(1)	If checked, the units Qty will show the base units assigned to a procedure on the claim form.
19	CodeSubstNone	tinyint(1)	Set to true to not allow procedure code downgrade substitution on this insurance plan.
20	IsHidden	tinyint(4)	Set to true to hide it from the pick list and from the main list.
21	MonthRenew	tinyint(4)	The month, 1 through 12 when the insurance plan renews. It will renew on the first of the month. To indicate calendar year, set renew month to 0.
22	FilingCodeSubtype	bigint(20)	FK to insfilingcodesubtype.InsFilingCodeSubtypeNum
23	CanadianPlanFlag	varchar(5)	Canadian C12. Single char, usually blank. If non-blank, then it's one of three kinds of Provincial Medical Plans. A=Newfoundland MCP Plan. V=Veteran's Affairs Plan. N=NIHB. N and V are not yet in use, so they will result in blank being sent instead. See Elig5.
24	CanadianDiagnosticCode	varchar(255)	Canadian C39. Required when CanadianPlanFlag is 'A'.
25	CanadianInstitutionCode	varchar(255)	Canadian C40. Required when CanadianPlanFlag is 'A'.
26	RxBIN	varchar(255)	BIN location number. Only used with EHR.
27	CobRule	tinyint(4)	Enum:EnumCobRule 0=Basic, 1=Standard, 2=CarveOut.
Basic: 0=Basic
Standard: 1=Standard
CarveOut: 2=CarveOut
SecondaryMedicaid: 3=SecondaryMedicaid. The secondary insurance will reduce what it pays by what primary pays (like Basic). Then anything that would be the patient portion is a writeoff for the secondary insurance. Sometimes Medicaid is required to be the primary, so only use this if you are sure you are allowed to.
28	SopCode	varchar(255)	FK to sop.SopCode. Examples: 121, 3115, etc. Acts as default for all patients using this insurance. When code is changed for an insplan, it should change automatically for patients having that primary insurance.
29	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
30	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
31	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
32	HideFromVerifyList	tinyint(4)	Is false if this plan needs to be verified.
33	OrthoType	tinyint(4)	Enum:OrthoClaimType 0=InitialClaimOnly, 1=InitialPlusVisit, 2=InitialPlusPeriodic. If this is an ortho claim, dictates what type of Ortho claim it is.
InitialClaimOnly: Payment schedule to be determined after EOB is received.
InitialPlusVisit: D8080 submitted on initial banding with D8030 or D8670 submitted per visit.
InitialPlusPeriodic: D8080 submitted on initial banding and OrthoAutoProc (usually D8670.auto) submitted at a set frequency regardless of visits. Actual visits should use D8670 and be marked 'DoNotBillIns.'
34	OrthoAutoProcFreq	tinyint(4)	Enum:OrthoAutoProcFrequency The frequency that the automatic procedures and claims are created for insplans with an InitialPlusPeriodic OrthoType
Monthly:
Quarterly: Every three months.
SemiAnnual: Every six months.
Annual:
35	OrthoAutoProcCodeNumOverride	bigint(20)	If 0, this insplan uses the OrthoAutoProc preference. Otherwise, this overrides that value.
36	OrthoAutoFeeBilled	double	The amount that the ortho auto procedure will bill to insurance by default. Overridden by patplan.OrthoAutoFeeBilledOverride.
37	OrthoAutoClaimDaysWait	int(11)	Usually 0 or 30. Number of days that should pass after the initial banding that an automatic Ortho claim/procedure are generated.
38	BillingType	bigint(20)	FK to definition.DefNum.
39	HasPpoSubstWriteoffs	tinyint(4)	True by default. When a plan allows downgrading procedures and this field is false, the writeoff will be $0 and the difference between the proc fee and the insurance estimate will be the patient portion.
40	ExclusionFeeRule	tinyint(4)	Enum:ExclusionRule Controls how write-offs are handled for excluded (not covered) procedures on an in-network plan. Defaults to PracticeDefault. 0=Practice Default (use the global InsPlanUseUcrFeeForExclusions preference), 1=Do Nothing (apply the normal contracted fee and write-off logic), 2=Use Standard Provider Fee (apply the full standard provider fee with no write-offs)
PracticeDefault: 0=Practice Default
DoNothing: 1=Do Nothing
UseStandardProvFee: 2=Use Standard Provider Fee
41	ManualFeeSchedNum	bigint(20)	FK to feesched that has a FeeSchedType of 4-ManualBlueBook. Optional, can be 0.
42	IsBlueBookEnabled	tinyint(4)	determines if the plan is going to have BlueBook Enabled or not
43	InsPlansZeroWriteOffsOnAnnualMaxOverride	tinyint(4)	Enum:YN Plan-level override for how write-offs are handled when the patient has met their annual maximum. 0=Default (use the global InsPlansZeroWriteOffsOnAnnualMax preference), 1=Yes (apply the full standard provider fee with no write-offs), 2=No (apply the normal contracted fee and write-off logic)
Unknown: 0
Yes: 1
No: 2
44	InsPlansZeroWriteOffsOnFreqOrAgingOverride	tinyint(4)	Enum:YN Plan-level override for how write-offs are handled when a procedure is not covered due to an age or frequency limitation. 0=Default (use the global InsPlansZeroWriteOffsOnFreqOrAging preference), 1=Yes (apply the full standard provider fee with no write-offs), 2=No (apply the normal contracted fee and write-off logic)
Unknown: 0
Yes: 1
No: 2
45	PerVisitPatAmount	double	The per visit patient copay amount. 0 by default. When an appt is scheduled or set complete, a new proc gets created with code specified in pref.PerVisitPatAmountProcCode.
46	PerVisitInsAmount	double	The per visit amount to bill insurance. 0 by default. When an appt is scheduled or set complete, a new proc gets created with code specified in pref.PerVisitInsAmountProcCode.

insplanpreference
Used to create overrides at the insurance plan level.
Order	Name	Type	Summary
0	InsPlanPrefNum	bigint(20)	Primary key.
1	PlanNum	bigint(20)	FK to insplan.PlanNum.
2	FKey	bigint(20)	FK to to a table associated with FKeyType
3	FKeyType	tinyint(4)	Enum:InsPlanPrefFKeyType ProcCodeNoBillIns
ProcCodeNoBillIns: 0 - Overrides the procedurecode.NoBillIns field at the insurance plan level. FKey stores the CodeNum. ValueString stores NoBillInsOverride enum value.
4	ValueString	text	Used to hold the override. NoBillIns stores 0, 1.

inssub
Multiple subscribers can have the same insurance plan. But the patplan table is still what determines coverage for individual patients.
Order	Name	Type	Summary
0	InsSubNum	bigint(20)	Primary key.
1	PlanNum	bigint(20)	FK to insplan.PlanNum.
2	Subscriber	bigint(20)	FK to patient.PatNum.
3	DateEffective	date	Date plan became effective. Is 0001-01-01 if not set.
4	DateTerm	date	Date plan was terminated. Is 0001-01-01 if not set.
5	ReleaseInfo	tinyint(4)	Release of information signature is on file.
6	AssignBen	tinyint(4)	Assignment of benefits signature is on file. For Canada, this handles Payee Code, F01. Option to pay other third party is not included.
7	SubscriberID	varchar(255)	Number assigned by insurance company. No dashes. Not allowed to be blank.
8	BenefitNotes	text	User doesn't usually put these in. Only used when automatically requesting benefits, such as with Trojan. All the benefits get stored here in text form for later reference. Not at plan level because might be specific to subscriber. If blank, we try to display a benefitNote for another subscriber to the plan.
9	SubscNote	text	Use to store any other info that affects coverage.
10	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
11	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
12	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
13	SecurityHash	varchar(255)	Holds the salted hash of the following inssub fields: PlanNum, Subscriber, SubscriberID, and DateTerm.

installmentplan
Simpler than a payment plan. Does not affect running account balances. Allows override of finance charges. Affects the "pay now" on statements. Only one installmentplan is allowed for a family, attached to guarantor only. This is loosely enforced.
Order	Name	Type	Summary
0	InstallmentPlanNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateAgreement	date	Date payment plan agreement was made.
3	DateFirstPayment	date	Date of first payment.
4	MonthlyPayment	double	Amount of monthly payment.
5	APR	float	Annual Percentage Rate. e.g. 12.
6	Note	varchar(255)	Note

insverify
A row for the most recent time an insplan benefit or patplan enrollment was verified. Also see insverifyhist, which keeps a historical record. When a new plan is created, a row gets created here with no date. There is never more than one row per plan because old ones get moved over to InsVerifyHist.
Order	Name	Type	Summary
0	InsVerifyNum	bigint(20)	Primary key.
1	DateLastVerified	date	The date of the last successful verification. This date will be DateTime.MinVal upon insert and will not change until the user has verified insurance benefits or pat plan eligibility in FormInsVerificationList, or until the user has entered and saved a date in Eligibility Last Verified or Benefits Last Verified textboxes in FormInsPlan.
2	UserNum	bigint(20)	FK to userod.UserNum. Typically 0. There is an optional feature that lets an office "assign" users to a verification so that they can split the load of verifying between different users.
3	VerifyType	tinyint(4)	Enum:VerifyTypes either InsuranceBenefits or PatientEnrollment
None: 0. This means FKey should be 0.
InsuranceBenefit: 1. This means FKey will link to insplan.PlanNum
PatientEnrollment: 2. This means FKey will link to patplan.PatPlanNum
4	FKey	bigint(20)	Foreign key either insplan.PlanNum or patplan.PatPlanNum.
5	DefNum	bigint(20)	FK to definition.DefNum. Links to the category InsVerifyStatus
6	Note	text	Note for this insurance verification.
7	DateLastAssigned	date	Optional feature that's part of "assigning" users to verification. Default is DateTime.MinVal. The DateTime of when a userod.UserNum was last assigned/unassigned a patient's insverify in FormInsVerificationList, the last time the status was changed on the insverify, when a patient's patplan has been dropped, or whenever an error occurs when trying to batch verify patient benefits.
8	DateTimeEntry	datetime	DateTime the row was added.
9	HoursAvailableForVerification	double	Number of hours that were available from the time the insurance needed verified to the date of the appointment. Includes minutes if applicable.
10	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed.
11	SecurityHash	varchar(255)	Holds the salted hash of the following insverify fields: UserNum, DefNum, DateLastAssigned.

insverifyhist
A historical copy of an insurance verification record.
Order	Name	Type	Summary
0	InsVerifyHistNum	bigint(20)	Primary key.
1	InsVerifyNum	bigint(20)	Copied from InsVerify.
2	DateLastVerified	date	Copied from InsVerify.
3	UserNum	bigint(20)	Copied from InsVerify.
4	VerifyType	tinyint(4)	Copied from InsVerify.
5	FKey	bigint(20)	Copied from InsVerify.
6	DefNum	bigint(20)	Copied from InsVerify.
7	Note	text	Copied from InsVerify.
8	DateLastAssigned	date	Copied from InsVerify.
9	DateTimeEntry	datetime	Copied from InsVerify.
10	HoursAvailableForVerification	double	Copied from InsVerify.
11	VerifyUserNum	bigint(20)	FK to userod.UserNum. User that was logged on when row was inserted.
12	SecDateTEdit	timestamp	Not copied from Task. Automatically updated by MySQL every time a row is added or changed.
13	SecurityHash	varchar(255)	Copied from InsVerify. When an InsVerifyHist is created, the 3 hashed fields remain unchanged, so this hash remains valid.

intervention
An intervention ordered or performed. Examples: smoking cessation and weightloss counseling. Links to a definition in the ehrcode table using the CodeValue and CodeSystem.
Order	Name	Type	Summary
0	InterventionNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ProvNum	bigint(20)	FK to provider.ProvNum.
3	CodeValue	varchar(30)	FK to ehrcode.CodeValue. This code may not exist in the ehrcode table, it may have been chosen from a bigger list of available codes. In that case, this will be a FK to a specific code system table identified by the CodeSystem column. The code for this item from one of the code systems supported. Examples: V65.3 or 418995006.
4	CodeSystem	varchar(30)	FK to codesystem.CodeSystemName. The code system name for this code. Possible values are: CPT, HCPCS, ICD9CM, ICD10CM, and SNOMEDCT.
5	Note	text	User-entered details about the intervention for this patient.
6	DateEntry	date	The date of the intervention.
7	CodeSet	tinyint(4)	Enum:InterventionCodeSet AboveNormalWeight, BelowNormalWeight, TobaccoCessation, Nutrition, PhysicalActivity, Dialysis.
AboveNormalWeight: 0 - Above Normal Weight Follow-up/Referrals where weight assessment may occur
BelowNormalWeight: 1 - Below Normal Weight Follow-up/Referrals where weight assessment may occur
Nutrition: 2 - Counseling for Nutrition
PhysicalActivity: 3 - Counseling for Physical Activity
TobaccoCessation: 4 - Tobacco Use Cessation Counseling
Dialysis: 5 - Dialysis Education/Other Services Related to Dialysis
None: 6 - None
8	IsPatDeclined	tinyint(4)	Indicates whether the intervention was offered/recommended to the patient and the patient declined the treatment/referral.

journalentry
Used in accounting to represent a single credit or debit entry. There will always be at least 2 journal enties attached to every transaction. All transactions balance to 0.
Order	Name	Type	Summary
0	JournalEntryNum	bigint(20)	Primary key.
1	TransactionNum	bigint(20)	FK to transaction.TransactionNum
2	AccountNum	bigint(20)	FK to account.AccountNum
3	DateDisplayed	date	Always the same for all journal entries within one transaction.
4	DebitAmt	double	Negative numbers never allowed.
5	CreditAmt	double	Negative numbers never allowed.
6	Memo	text	Was previously used as multi purpose for Payee and Notes also.
7	Splits	text	A human-readable description of the splits. Used only for display purposes. Can be very large
8	CheckNumber	varchar(255)	Any user-defined string. Usually a check number, but can also be D for deposit, Adj, etc.
9	ReconcileNum	bigint(20)	FK to reconcile.ReconcileNum. 0 if not attached to a reconcile. Not allowed to alter amounts if attached.
10	SecUserNumEntry	bigint(20)	FK to userod.UserNum. The user who created this journal entry.
11	SecDateTEntry	datetime	The date and time that this journal entry was created.
12	SecUserNumEdit	bigint(20)	FK to userod.UserNum. The user who last edited this journal entry.
13	SecDateTEdit	timestamp	The last time this journal entry was edited.
14	Payee	varchar(255)	Was previously mixed in with Memo. Limit 255 char.
15	Notes	text	Was previously mixed in with Memo. Limit 65k.

labcase
A lab case.
Order	Name	Type	Summary
0	LabCaseNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	LaboratoryNum	bigint(20)	FK to laboratory.LaboratoryNum. The lab that the case gets sent to. Required.
3	AptNum	bigint(20)	FK to appointment.AptNum. This is how a lab case is attached to a scheduled appointment. Multiple labcases can be attached to any appointment. Labcase can exist without being attached to any appointments at all, making this zero.
4	PlannedAptNum	bigint(20)	FK to appointment.AptNum. This is how a lab case is attached to a planned appointment in addition to the scheduled appointment.
5	DateTimeDue	datetime	The due date that is put on the labslip. NOT when you really need the labcase back, which is usually a day or two later and is the date of the appointment this case is attached to.
6	DateTimeCreated	datetime	When this lab case was created. User can edit.
7	DateTimeSent	datetime	Time that it actually went out to the lab.
8	DateTimeRecd	datetime	Date/time received back from the lab. If this is filled, then the case is considered received.
9	DateTimeChecked	datetime	Date/time that quality was checked. It is now completely ready for the patient.
10	ProvNum	bigint(20)	FK to provider.ProvNum.
11	Instructions	text	The text instructions for this labcase.
12	LabFee	double	This is used for tracking and informational purposes only. The fee is not used in any calculation.
13	DateTStamp	timestamp	Automatically updated whenever a row is added or changed. Not user editable.
14	InvoiceNum	varchar(255)	Optional invoice number

laboratory
A dental laboratory. Will be attached to lab cases.
Order	Name	Type	Summary
0	LaboratoryNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of lab.
2	Phone	varchar(255)	Freeform text includes punctuation.
3	Notes	text	Any notes. No practical limit to amount of text.
4	Slip	bigint(20)	FK to sheetdef.SheetDefNum. Lab slips can be set for individual laboratories. If zero, then the default internal lab slip will be used instead of a custom lab slip.
5	Address	varchar(255)	.
6	City	varchar(255)	.
7	State	varchar(255)	.
8	Zip	varchar(255)	.
9	Email	varchar(255)	.
10	WirelessPhone	varchar(255)	.
11	IsHidden	tinyint(4)	.

labpanel
One lab panel comes back from the lab with multiple lab results. Multiple panels can come back in one HL7 message. This table loosely corresponds to the OBR segment.
Order	Name	Type	Summary
0	LabPanelNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	RawMessage	text	The entire raw HL7 message. Can contain other labpanels in addition to this one.
3	LabNameAddress	varchar(255)	Both name and address in a single field. OBR-20.
4	DateTStamp	timestamp	To be used for synch with web server.
5	SpecimenCondition	varchar(255)	OBR-13. Usually blank. Example: hemolyzed.
6	SpecimenSource	varchar(255)	OBR-15. Usually blank. Example: LNA&Arterial Catheter&HL70070.
7	ServiceId	varchar(255)	OBR-4-0, Service performed, id portion, LOINC. For example, 24331-1.
8	ServiceName	varchar(255)	OBR-4-1, Service performed description. Example, Lipid Panel.
9	MedicalOrderNum	bigint(20)	FK to medicalorder.MedicalOrderNum. Used to attach in imported lab panel to a lab order. Multiple panels may be attached to an order.

labresult
Medical labs, not dental labs. Multiple labresults are attached to a labpanel. Loosely corresponds to the OBX segment in HL7.
Order	Name	Type	Summary
0	LabResultNum	bigint(20)	Primary key.
1	LabPanelNum	bigint(20)	FK to labpanel.LabPanelNum.
2	DateTimeTest	datetime	OBX-14.
3	TestName	varchar(255)	OBX-3-1, text portion.
4	DateTStamp	timestamp	To be used for synch with web server.
5	TestID	varchar(255)	OBX-3-0, id portion, LOINC. For example, 10676-5.
6	ObsValue	varchar(255)	OBX-5. Value always stored as a string because the type might vary in the future.
7	ObsUnits	varchar(255)	OBX-6 For example, mL. Was FK to drugunit.DrugUnitNum, but that would make reliable import problematic, so now it's just text.
8	ObsRange	varchar(255)	OBX-7 For example, <200 or >=40.
9	AbnormalFlag	tinyint(4)	Enum:LabAbnormalFlag 0-None, 1-Below, 2-Normal, 3-Above.
None: 0-No value.
Below: 1-Below normal.
Normal: 2-Normal.
Above: 3-Above high normal.

labturnaround
The amount of time it takes for a lab case to be processed at the lab. Used to compute due dates.
Order	Name	Type	Summary
0	LabTurnaroundNum	bigint(20)	Primary key.
1	LaboratoryNum	bigint(20)	FK to laboratory.LaboratoryNum. The lab that this item is attached to.
2	Description	varchar(255)	The description of the service that the lab is performing.
3	DaysPublished	smallint(6)	The number of days that the lab publishes as the turnaround time for the service.
4	DaysActual	smallint(6)	The actual number of days. Might be longer than DaysPublished due to travel time. This is what the actual calculations will be done on.

language
This is a list of phrases that need to be translated. The primary key is a combination of the ClassType and the English phrase. This table is currently filled dynmically at run time, but the plan is to fill it using a tool that parses the code.
Order	Name	Type	Summary
0	LanguageNum	bigint(20)	Primary key.
1	EnglishComments	text	No longer used.
2	ClassType	text	A string representing the class where the translation is used.
3	English	text	The English version of the phrase, case sensitive.
4	IsObsolete	tinyint	As this gets more sophisticated, we will use this field to mark some phrases obsolete instead of just deleting them outright. That way, translators will still have access to them. For now, this is not used at all.

languageforeign
Will usually only contain translations for a single foreign language, although more are allowed. The primary key is a combination of the ClassType and the English phrase and the culture.
Order	Name	Type	Summary
0	LanguageForeignNum	bigint(20)	Primary key.
1	ClassType	text	A string representing the class where the translation is used.
2	English	text	The English version of the phrase. Case sensitive.
3	Culture	varchar(255)	The specific culture name. Almost always in 5 digit format like this: en-US.
4	Translation	text	The foreign translation. Remember we use Unicode-8, so this translation can be in any language, including Russian, Hebrew, and Chinese.
5	Comments	text	Comments for other translators for the foreign language.

languagepat
Practice-defined translations for text shown to patients. Unlike Language and LanguageForeign, which translate Open Dental's interface to a practice's preferred language, LanguagePat allows practices to customize translations of messages and information displayed to patients in their preferred language. Used right now for about 30 prefs for things like email messages. Also used for EForms. So either PrefName will be empty or EFormFieldDefNum will be 0. Sheets are translated differently, by making a copy of each SheetFieldDef used for each language.
Order	Name	Type	Summary
0	LanguagePatNum	bigint(20)	Primary key.
1	PrefName	varchar(255)	FK to pref.PrefName. There are about 30 of these in use. This allows us to translate the value stored for templates like email, postcard, text, etc. Will be empty string if this is an eForm translation.>
2	Language	varchar(255)	Three-letter language name or custom language name. The custom language name is the full string name and is not necessarily supported by Microsoft. This will typically be matched to the patient's preferred language to select the appropriate translation. Three-letter language name examples: eng (English), spa (Spanish), fra (French).Custom language name examples: Tahitian, American Sign Language, Morse Code. The LanguagesUsedByPatients preference stores the three-letter names that the practice chooses to support.
3	Translation	text	The translated text. Max 65,000 characters. Might store complex email templates.
4	EFormFieldDefNum	bigint(20)	FK to eformfielddef.EFormFieldDefNum. This is how eForms get translated. Once a def is converted to an eForm, this is not needed. The eForm fields have all the translated text. Will be 0 if this is a pref translation.

letter
These are templates that are used to send simple letters to patients.
Order	Name	Type	Summary
0	LetterNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of the Letter.
2	BodyText	text	Text of the letter

lettermerge
Describes the templates for letter merges to Word.
Order	Name	Type	Summary
0	LetterMergeNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description of this letter.
2	TemplateName	varchar(255)	The filename of the Word template. eg MyTemplate.doc.
3	DataFileName	varchar(255)	The name of the data file. eg MyTemplate.txt.
4	Category	bigint(20)	FK to definition.DefNum.
5	ImageFolder	bigint(20)	FK to definition.DefNum. This determines the default Image Category that will be selected when printing or previewing the letter. Can be 0 which means 'None' will be selected.

lettermergefield
When doing a lettermerge, a data file is created with certain fields. This is a list of those fields for each lettermerge.
Order	Name	Type	Summary
0	FieldNum	bigint(20)	Primary key.
1	LetterMergeNum	bigint(20)	FK to lettermerge.LetterMergeNum.
2	FieldName	varchar(255)	One of the preset available field names.

limitedbetafeature
Limited Beta features are specific parts of the OpenDental suite of services that are locked behind a registration process while the feature undergoes improvement or further testing. This registration process is done through HQ working with a customer to determine if they will be a good candidate to use and test this feature before it's full release. If they are a good candidate, a row is inserted into their database that will allow them access to the feature. LimitedBetaFeatures get inserted during the nightly synch with our eServiceSignups. This is done in our call to WebServiceMainHQProxy.GetEServiceSetupFull. The nightly synch is the only place these rows get altered.
Order	Name	Type	Summary
0	LimitedBetaFeatureNum	bigint(20)	
1	LimitedBetaFeatureTypeNum	bigint(20)	Stores the integer value of the LimitedBetaFeatureEnum. This is done to prevent out of bounds exceptions due to versioning.
2	ClinicNum	bigint(20)	ClinicNum that is signed up for the feature. Clinic independant features only have one row with a clinicNum of -1.
3	IsSignedUp	tinyint(4)	An office is considered signed up if they have a valid version to be using this feature on, the feature is on limited beta, and they've signed up with HQ.

loginattempt
Keeps track of failed login attempts.
Order	Name	Type	Summary
0	LoginAttemptNum	bigint(20)	Primary key.
1	UserName	varchar(255)	The username that was attempted. May not be a username that exists.
2	LoginType	tinyint(4)	Enum:UserWebFKeyType The part of the program where an attempt was made. If we want to use this for other parts of the program that are do not use the userweb table, we can change this enum to a different one.
Undefined: This is a default value that should never be saved into the table.
PatientPortal: FK to patient.PatNum
3	DateTFail	datetime	When the failed attempt was attempted.

loinc
Logical Observation Identifiers Names and Codes (LOINC) used to identify both lab panels and lab results. Widths specified are from LOINC documentation and may not represent length of fields in the Open Dental Database.
Order	Name	Type	Summary
0	LoincNum	bigint(20)	Primary key. Internal use only.
1	LoincCode	varchar(255)	#EULA REQUIRED# Also called LOINC_NUM in the official LOINCDB. Width-10. LOINC244 column 1.
2	Component	varchar(255)	#EULA REQUIRED# First Major axis:component or analyte. Width-255. LOINC244 column 2.
3	PropertyObserved	varchar(255)	#EULA REQUIRED# Second major axis:property observed (e.g., mass vs. substance). Width-30. LOINC244 column 3.
4	TimeAspct	varchar(255)	#EULA REQUIRED# Third major axis:timing of the measurement (e.g., point in time vs 24 hours). Width-15. LOINC244 column 4.
5	SystemMeasured	varchar(255)	#EULA REQUIRED# Fourth major axis:type of specimen or system (e.g., serum vs urine). Width-100 LOINC244. column 5.
6	ScaleType	varchar(255)	#EULA REQUIRED# Fifth major axis:scale of measurement (e.g., qualitative vs. quantitative). Width-30. LOINC244 column 6.
7	MethodType	varchar(255)	#EULA REQUIRED# Sixth major axis:method of measurement. Width-50. LOINC244 column 7.
8	StatusOfCode	varchar(255)	#EULA REQUIRED# Width-10. LOINC244 column 13.ACTIVE = Concept is active. Use at will.TRIAL = Concept is experimental in nature. Use with caution as the concept and associated attributes may change. DISCOURAGED = Concept is not recommended for current use. New mappings to this concept are discouraged; although existing may mappings may continue to be valid in context. Wherever possible, the superseding concept is indicated in the MAP_TO field in the MAP_TO table (see Table 28b) and should be used instead. DEPRECATED = Concept is deprecated. Concept should not be used, but it is retained in LOINC for historical purposes. Wherever possible, the superseding concept is indicated in the MAP_TO field (see Table 28b) and should be used both for new mappings and updating existing implementations..
9	NameShort	varchar(255)	#EULA REQUIRED# Introduced in version 2.07, this field is a concatenation of the fully specified LOINC name. The field width may change in a future release. Width 40. LOINC244 column 29.
10	ClassType	varchar(255)	1=Laboratory class; 2=Clinical class; 3=Claims attachments; 4=Surveys. LOINC244 column 16.
11	UnitsRequired	tinyint(4)	Y/N field that indicates that units are required when this LOINC is included as an OBX segment in a HIPAA attachment. LOINC244 column 26.
12	OrderObs	varchar(255)	Defines term as order only, observation only, or both. A fourth category, Subset, is used for terms that are subsets of a panel but do not represent a package that is known to be orderable we have defined them only to make it easier to maintain panels or other sets within the LOINC construct. LOINC244 column 30.
13	HL7FieldSubfieldID	varchar(255)	A value in this field means that the content should be delivered in the named field/subfield of the HL7 message. When NULL, the data for this data element should be sent in an OBX segment with this LOINC code stored in OBX-3 and with the value in the OBX-5. Width 50. LOINC244 column 32.
14	ExternalCopyrightNotice	text	External copyright holders copyright notice for this LOINC code. LOINC244 column 33.
15	NameLongCommon	varchar(255)	This field contains the LOINC term in a more readable format than the fully specified name. The long common names have been created via a table driven algorithmic process. Most abbreviations and acronyms that are used in the LOINC database have been fully spelled out in English. Width 255. LOINC244 column 35.
16	UnitsUCUM	varchar(255)	The Unified Code for Units of Measure (UCUM) is a code system intended to include all units of measures being contemporarily used in international science, engineering, and business. (www.unitsofmeasure.org ) This field contains example units of measures for this term expressed as UCUM units. Width 255. LOINC244 column 1.
17	RankCommonTests	int(11)	Ranking of approximately 2000 common tests performed by laboratories in USA. LOINC244 column 45.
18	RankCommonOrders	int(11)	Ranking of approximately 300 common orders performed by laboratories in USA. LOINC244 column 46.

medicalorder
Ehr. Lab and radiology orders. Medication orders are simply fields in medicationPat.
Order	Name	Type	Summary
0	MedicalOrderNum	bigint(20)	Primary key.
1	MedOrderType	tinyint(4)	Enum:MedicalOrderType Laboratory=0,Radiology=1.
Laboratory: 0- Laboratory
Radiology: 1- Radiology
2	PatNum	bigint(20)	FK to patient.PatNum
3	DateTimeOrder	datetime	Date and time of order.
4	Description	varchar(255)	User will be required to type entire order out from scratch.
5	IsDiscontinued	tinyint(4)	EHR requires Active/Discontinued status. 0=Active, 1=Discontinued.
6	ProvNum	bigint(20)	FK to provider.ProvNum.

medication
A list of medications, not attached to any particular patient. Not allowed to delete if in use by a patient. Not allowed to edit name once created due to possibility of damage to patient record.
Order	Name	Type	Summary
0	MedicationNum	bigint(20)	Primary key.
1	MedName	varchar(255)	Name of the medication. User can change this. If an RxCui is present, the RxNorm string can be pulled from the in-memory table for UI display in addition to the MedName.
2	GenericNum	bigint(20)	FK to medication.MedicationNum. Cannot be zero. If this is a generic drug, then the GenericNum will be the same as the MedicationNum. Otherwise, if this is a brand drug, then the GenericNum will be a non-zero value corresponding to another medicaiton.
3	Notes	text	Examples: interactions, drug class, contraindications, etc. Not typically for dosage. Mg, times per days, etc. typically entered into MedicationPat.PatNote.
4	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.
5	RxCui	bigint(20)	RxNorm Code identifier. We should have used a string type. Used by EHR in CQM. But the queries should use medicationpat.RxCui, NOT this RxCui, because all medicationpats (meds and orders) coming back from NewCrop will not have a FK to this medication table. When this RxCui is modified by the user, then medicationpat.RxCui is automatically updated where medicationpat.MedicationNum matches this medication.
6	IsHidden	tinyint(4)	.

medicationpat
Links medications to patients. For ehr, some of these can be considered 'medication orders', but only if they contain a PatNote (instructions), a ProvNum, and a DateStart.
Order	Name	Type	Summary
0	MedicationPatNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	MedicationNum	bigint(20)	FK to medication.MedicationNum. If 0, implies that the medication order came from eRx. This was done to allow MU2 measures to be set by either creating a medication from the medical window, or by creating an manual prescription.
3	PatNote	text	Medication notes specific to this patient. Example: 10 mg tablets, two tabs 3 times per day
4	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.
5	DateStart	date	Date that the medication was started. Can be minval if unknown.
6	DateStop	date	Date that the medication was stopped. Can be minval if unknown. If minval, then the medication is not "discontinued". If prior to today, then the medication is "discontinued". If today or a future date, then not discontinued yet.
7	ProvNum	bigint(20)	FK to provider.ProvNum. Can be 0. Gets set to the patient's primary provider when adding a new med. If adding the med from EHR, gets set to the ProvNum of the logged-in user.
8	MedDescript	varchar(255)	Used for eRx and eForm import. In these cases, MedicationNum=0.
9	RxCui	bigint(20)	For NewCrop medical orders, corresponds to the RxCui of the prescription (NewCrop only returns a value sometimes). Otherwise, this field is synched with the medication.RxCui field based on medication.MedicationNum. We should have used a string type. The only purpose of this field is so that when CCDs are created, we have structured data to put in the XML, not just plain text. Allergies exported in CCD do not look at this table, but only at the medication table. Medications require MedicationPat.RxCui or Medication.RxCui to be exported on CCD.
10	ErxGuid	varchar(255)	Uniquely identifies the prescription corresponding to the medical order. Allows us to update existing eRx medical orders when refreshing prescriptions in the Chart (similar to how prescriptions are updated). Also used in 2-way medication synching with eRx.
11	IsCpoe	tinyint(4)	If eRx is used to prescribe a medication, a medication order is imported automatically into Open Dental. If a provider is logged in, then this is CPOE (Computerized Provider Order Entry), and this will be true. Or, if a provider is logged in and Rx entered through OD, it's also CPOE. If a staff person is logged in, and enters an Rx through NewCrop or OD, then this is non-CPOE, so false.

medlab
The EHRLab table is structured to tightly with the HL7 standard and should have names that more reflect how the user will consume the data and for that reason for actual implementation we are using these medlab tables. Medical lab observation order. This table is currently only used for LabCorp, but may be utilized by other third party lab services in the future. These are the fields required for the LabCorp result report, used to link the order to the result(s), specimen(s), place(s) of service, or for linking parent and child results. This table contains data from the PID, ORC, OBR, and applicable NTE segments
Order	Name	Type	Summary
0	MedLabNum	bigint(20)	Primary key.
1	SendingApp	varchar(255)	MSH-2 - Sending Application. Used to identify the LabCorp Lab System sending the results. Possible values for LabCorp (as of their v10.7 specs): '1100' - LabCorp Lab System, 'DIANON' - DIANON Systems, 'ADL' - Acupath Diagnostic Laboratories, 'EGL' - Esoterix Genetic Laboratories. For backward compatibility only: 'CMBP', 'LITHOLINK', 'USLABS'
2	SendingFacility	varchar(255)	MSH-3 - Sending Facility. Identifies the LabCorp laboratory responsible for the client. It could be a LabCorp assigned 'Responsible Lab Code' representing the responsible laboratory or it could be a CLIA number.
3	PatNum	bigint(20)	FK to patient.PatNum. PID.2 - External Patient ID. LabCorp report field "Client Alt. Pat ID".
4	ProvNum	bigint(20)	FK to provider.ProvNum. Can be 0. Attempt to match ordering prov external IDs to internal provnum.
5	PatIDLab	varchar(255)	PID.3 - Lab Assigned Patient Id. LabCorp report field "Specimen Number". LabCorp assigned, alpha numeric specimen number.
6	PatIDAlt	varchar(255)	PID.4 - Alternate Patient ID. LabCorp report field "Patient ID". Alternate patient ID.
7	PatAge	varchar(255)	PID.7.2/7.3/7.4 - Patient Age Years/Months/Days. LabCorp report field "Age (Y/M/D)". YYY/MM/DD format. Three chars for years, 2 each for months and days. Some tests require age for calculation of result. This will be the age at the time of the test, so we will use the values in the message instead of re-calculating..
8	PatAccountNum	varchar(255)	PID.18.1 - Account Number. LabCorp report field "Account Number". LabCorp Client ID, 8 digit account number.
9	PatFasting	tinyint(4)	PID.18.7 - Fasting. LabCorp report field "Fasting". Y, N, or blank. A blank component will be stored as 0 - Unknown, the result report fasting field will be blank.
10	SpecimenID	varchar(255)	ORC.2.1 and OBR.2.1 - Unique Foreign Accession or Specimen ID. LabCorp report field "Client Accession (ACC)". ID sent on the specimen container.
11	SpecimenIDFiller	varchar(255)	ORC.3.1 and OBR.3.1 - Internal (to LabCorp for example)/Filler Accession or Specimen ID. LabCorp assigned specimen number, reused on a yearly basis.
12	ObsTestID	varchar(255)	OBR.4.1 - Observation Battery Identifier. Reflex result will have this value in OBR.29 to link the reflex to the parent.
13	ObsTestDescript	varchar(255)	OBR.4.2 - Observation Battery Text. LabCorp report field "Tests Ordered".
14	ObsTestLoinc	varchar(255)	OBR.4.4 - Alternate Battery Identifier (LOINC). This is the LOINC code for the test performed. When displaying the results, LabCorp requires OBR.4.2, the text name of the test to be displayed, not the LOINC code. But we will store it so we can link to the LOINC code table for reporting purposes.
15	ObsTestLoincText	varchar(255)	OBR.4.5 - Alternate Observation Battery Text (LOINC Description). The LOINC code description for the test performed. We will display OBR.4.2 per LabCorp requirements, but we will store this description for reporting purposes.
16	DateTimeCollected	datetime	OBR.7 - Observation/Specimen Collection Date/Time. LabCorp report field "Date & Time Collected". yyyyMMddHHmm format in the message, no seconds. May be blank.
17	TotalVolume	varchar(255)	OBR.9 - Collection/Urine Volume (Quantity/Field Value). LabCorp report field "Total Volume". The LabCorp document says this field is "Numeric Characters", but the HL7 documentation data type as CQ, which is a number with units in the form of Quantity^Units. The Units component has subcomponents: ID&Text&Name of Coding System&Alt ID&Alt Text& Name of Alt Coding System&Coding System Version ID&Alt Coding System Version ID&Original Text. We will make this a string column and store the Quantity with the Units ID subcomponent if present. The default unit of measurement is ML, so if the field is a number only we will add ML.
18	ActionCode	varchar(255)	Enum:ResultAction OBR.11 - Action Code. Blank for normal result, "G" for reflex result.
None: 0 - None. Standard results will be blank.
A: 1 - Add On. Limited usage and not applicable for all add on tests.
G: 2 - Reflex. Lab generated result for test not on the original order.
19	ClinicalInfo	varchar(255)	OBR.13.1 - Relevant Clinical Information. LabCorp report field "Additional Information". The report field will be filled with this value from the first OBR record in the message. The message limits this field to 64 characters, the rest is truncated.
20	DateTimeEntered	datetime	OBR.14 - Date/Time of Specimen Receipt in Lab. LabCorp report field "Date Entered". yyyyMMddHHmm format in the message, no seconds. Date and time the order was entered in the Lab System.
21	OrderingProvNPI	varchar(255)	ORC.12.1 and OBR.16.1 - Ordering Provider ID Number. LabCorp report field "NPI". ORC.12.* and OBR.16.* are repeatable, the eighth component identifies the source of the ID in the first component. Component 8 possible values: "U"-UPIN, "P"-Provider Number (Medicaid or Commercial Ins Provider ID), "N"-NPI (Required for third party billing), "L"-Local (Physician ID).
22	OrderingProvLocalID	varchar(255)	ORC.12.1 and OBR.16.1 - Ordering Provider ID Number. LabCorp report field "Physician ID". ORC.12.* and OBR.16.* are repeatable, the eighth component identifies the source of the ID in the first component. Component 8 possible values: "U"-UPIN, "P"-Provider Number (Medicaid or Commercial Ins Provider ID), "N"-NPI (Required for third party billing), "L"-Local (Physician ID).
23	OrderingProvLName	varchar(255)	ORC.12.2 and OBR.16.2 - Ordering Provider Last Name. LabCorp report field "Physician Name". Last, First.
24	OrderingProvFName	varchar(255)	ORC.12.3 and OBR.16.3 - Ordering Provider First Initial. LabCorp report field "Physician Name". Last, First.
25	SpecimenIDAlt	varchar(255)	OBR.18 - Alternate Unique Foreign Accession / Specimen ID. LabCorp report field "Control Number".
26	DateTimeReported	datetime	OBR.22 - Date/Time Observations Reported. LabCorp report field "Date & Time Reported". yyyyMMddHHmm format in the message, no secs. Date and time the results were released from the Lab System.
27	ResultStatus	varchar(255)	Enum:ResultStatus OBR.25 - Order Result Status. LabCorp possible values: "F" - Final, "P" - Preliminary, "X" - Cancelled, "C" - Corrected.
C: 0 - Corrected Result.
F: 1 - Final. Result complete and verified.
I: 2 - Incomplete. For Discrete Microbiology Testing.
P: 3 - Preliminary. Final not yet obtained.
X: 4 - Canceled. Procedure cannot be done. Result canceled due to Non-Performance.
28	ParentObsID	varchar(255)	OBR.26.1 - Link to Parent Result or Organism Link to Susceptibility. A reflex test will have the parent's OBX.3.1 value here for linking.
29	ParentObsTestID	varchar(255)	OBR.29 - Link to Parent Order. A reflex test will have the value from OBR.4.1 of the original order in this field for linking.
30	NotePat	text	NTE.3 - Comment Text, PID Level. The NTE segment is repeatable and the Comment Text component is limited to 78 characters. Multiple NTE segments can be used for longer comments. All NTE segments at the PID level will be concatenated and stored in this one field.
31	NoteLab	text	NTE.3 - Comment Text, OBR level. The NTE segment is repeatable and the Comment Text component is limited to 78 characters. Multiple NTE segments can be used for longer comments. All NTE segments at the OBR level will be concatenated and stored in this one field.
32	FileName	varchar(255)	Not unique. More than one MedLab object can point to the same FileName, so deleting the MedLab object does not necessarily mean the file can also be deleted. This is the filename of the original archived message that was processed to create this medlab object as well as associated medlabresult, medlabspecimen, and medlabfacility obects. The files will be stored in the OpenDentImages folder in a sub-folder called MedLabHL7. If a message is processed correctly it will be moved into the sub-folder MedLabHL7/Processed. Any message that remains in the MedLabHL7 folder and aren't moved into the Processed folder failed at some point during processing. If the option to store images directly in the database is chosen, this will be an empty field and there will not be the option to display the original HL7 message. This is a relative file path from the ImageStore.GetPreferredAtoZpath(), Example: "MedLabHL7/FileName.txt" OR "MedLabHL7/Processed/FileName.txt" Use: string pathToFile=ODFileUtils.CombinePaths(ImageStore.GetPreferredAtoZpath(),FileName)
33	OriginalPIDSegment	text	The PID Segment from the HL7 message used to generate this MedLab object.

medlabfacattach
Links a MedLab or a MedLabResult to a place of service. Either the MedLabNum OR the MedLabResultNum column will be populated, never both, so this will link the facility to EITHER a MedLab OR a MedLabResult object. Every MedLab and MedLabResult will have 1 to many laboratories attached.
Order	Name	Type	Summary
0	MedLabFacAttachNum	bigint(20)	Primary key.
1	MedLabNum	bigint(20)	FK to medlab.MedLabNum.
2	MedLabResultNum	bigint(20)	FK to medlabresult.MedLabResultNum.
3	MedLabFacilityNum	bigint(20)	FK to medlabfacility.MedLabFacilityNum.

medlabfacility
Medical lab facility that performed the test procedure(s). Contains data from the ZPS segment. Each MedLab object can have one to many places of service, each in a repetition of the ZPS segment. Each repetition will be its own row in this table.
Order	Name	Type	Summary
0	MedLabFacilityNum	bigint(20)	Primary key.
1	FacilityName	varchar(255)	ZPS.3 - Facility Name. Medical lab location name that performed the testing.
2	Address	varchar(255)	ZPS.4.1 - Facility Address.
3	City	varchar(255)	ZPS.4.3 - Facility City.
4	State	varchar(255)	ZPS.4.4 - Facility State or Province. Upper case state abbreviation.
5	Zip	varchar(255)	ZPS.4.5 - Facility Zip or Postal Code.
6	Phone	varchar(255)	ZPS.5 - Facility Phone Number.
7	DirectorTitle	varchar(255)	ZPS.7.1 - Facility Director Title.
8	DirectorLName	varchar(255)	ZPS.7.2 - Facility Director Last Name.
9	DirectorFName	varchar(255)	ZPS.7.3 - Facility Director First Name.

medlabresult
Medical lab result. The EHRLabResult table is structured too tightly with the HL7 standard and should have names that more reflect how the user will consume the data and for that reason for actual implementation we are using these medlab tables. This table is currently only used for LabCorp, but may be utilized by other third party lab services in the future. These fields are required for the LabCorp result report, used to link the result to an order, or for linking a parent and child result. Contains data from the OBX, ZEF, and applicable NTE segments.
Order	Name	Type	Summary
0	MedLabResultNum	bigint(20)	Primary key.
1	MedLabNum	bigint(20)	FK to medlab.medLabNum. Each MedLab object can have one or more results pointing to it.
2	ObsID	varchar(255)	OBX.3.1 - Observation Identifier. Reflex results will have the ObsID of the parent in OBR.26 for linking.
3	ObsText	varchar(255)	OBX.3.2 - Observation Text. LabCorp report field "TESTS". LabCorp test name.
4	ObsLoinc	varchar(255)	OBX.3.4 - Alternate Identifier (LOINC). This is the LOINC code for the observation. When displaying the results, LabCorp requires OBX.3.2, the text name of the test to be displayed, not the LOINC code. But we will store it so we can link to the LOINC code table for reporting purposes.
5	ObsLoincText	varchar(255)	OBX.3.5 - Alternate Observation Text (LOINC Description). The LOINC code description for the observation. We will display OBX.3.2 per LabCorp requirements, but we will store this description for reporting purposes.
6	ObsIDSub	varchar(255)	OBX.4 - Observation Sub ID. Used to aid in the identification of results with the same Observation ID (OBX.3) within a given OBR. This value is used to tie the results to the same organism. The value in OBX.5.3 tells whether this OBX is the organism, observation, or antibiotic and then the value in OBX.4 links them together as to whether this is for organism #1, organism #2, etc.
7	ObsValue	text	OBX.5.1 - Observation Value. LabCorp report field "RESULT". Can be null if coded entries, prelims, canceled, or >21 chars and being returned as an attached NTE. "TNP" will be reported for Test Not Performed. For value >21 chars in length: OBX.2 will be 'TX' for text, OBX.5 will be NULL (empty field), and the value will be in attached NTEs. Examples: Value less than 21 chars: OBX|1|ST|001180^Potassium, Serum^L||K+ is >6.5 mEq/L.||3.5-5.5|A||N|F|19830527||200605040929|01| Value >21 chars: OBX|6|TX|001180^Potassium, Serum^L||||3.5-5.5|||N|C|19830527||200511071406|01| NTE|1|L|Red cells observed in serum. Glucose may be falsely decreased. NTE|2|L|Potassium may be falsely increased.
8	ObsSubType	varchar(255)	Enum:DataSubtype OBX.5.3 - Data Subtype. Used to identify the coding system. Required if Discrete Microbiology testing is ordered to identify Microbiology Result Type. Example of use: If OBX.5.3 is ORM, then the observation sub ID in OBX.4 is used to associate the result with a specific organism. OBX.4 might contain 1, 2, or 3 meaning the result is for organism #1, organism #2, or organism #3.
Unknown: This idicates that we are unable to parse the value from the HL7 message into a data subtype.
ANT: Antibody (for Discrete Microbiology only)
ORM: Organism identifier (for Discrete Microbiology only)
ORP: Presumptive organism identifier (for Discrete Microbiology only)
OBS: Observation (for Discrete Microbiology only)
MOD: Modifier (for Discrete Microbiology only)
L: Local Identifier (default when no Microbiology Result Text)
PDF: Embedded PDF result type or separate PDF file
TIF: Embedded TIF result type or a separate TIF file
9	ObsUnits	varchar(255)	OBX.6.1 - Identifier. LabCorp report field "UNITS". Units of measure, if too large it will be in the NTE segment.
10	ReferenceRange	varchar(255)	OBX.7 - Reference Ranges. LabCorp report field "REFERENCE INTERVAL". Only if applicable.
11	AbnormalFlag	varchar(255)	Enum:AbnormalFlag OBX.8 - Abnormal Flags. LabCorp report field "FLAG". Blank or null is normal. When this is displayed on the LabCorp report it must be the human readable display name, so for example _gt (>) is displayed as "Panic High" and _lt (<) is "Panic Low".
None: 0 - None. Blank or null value indicates normal result, so no abnormal flag.
_gt: 1 - Panic High. Actual value is ">" but symbol cannot be used as an enum value.
_lt: 2 - Panic Low. Actual value is "<" but symbol cannot be used as an enum value.
A: 3 - Abnormal. Applies to non-numeric results.
AA: 4 - Critical Abnormal. Applies to non-numeric results.
H: 5 - Above High Normal.
HH: 6 - Alert High.
I: 7 - Intermediate. For Discrete Microbiology susceptibilities only.
L: 8 - Below Low Normal.
LL: 9 - Alert Low.
NEG: 10 - Negative for Drug Interpretation Codes and Discrete Microbiology.
POS: 11 - Positive for Drug Interpretation Codes and Discrete Microbiology.
R: 12 - Resistant. For Discrete Microbiology susceptibilities only.
S: 13 - Susceptible. For Discrete Microbiology susceptibilities only.
12	ResultStatus	varchar(255)	Enum:ResultStatus OBX.11 - Observation Result Status.
C: 0 - Corrected Result.
F: 1 - Final. Result complete and verified.
I: 2 - Incomplete. For Discrete Microbiology Testing.
P: 3 - Preliminary. Final not yet obtained.
X: 4 - Canceled. Procedure cannot be done. Result canceled due to Non-Performance.
13	DateTimeObs	datetime	OBX.14 - Date/Time of Observation. yyyyMMddHHmm format in the message, no seconds. Date and time tech entered result into the Lab System.
14	FacilityID	varchar(255)	OBX.15 - Producer ID (Producer’s Reference). LabCorp report field "LAB". ID of LabCorp Facility responsible for performing the testing. The Lab Name is supplied in the ZPS segment.
15	DocNum	bigint(20)	FK to document.DocNum. ZEF.2 - Embedded File. Each result may have one or more ZEF segments for embedded files. The base-64 text version of the PDF is sent in ZEF.2. If the file size exceeds 50k, then multiple segments will be sent with 50k blocks of the text. When processing, we will concatenate all ZEF.2 fields, create the PDF document, store the file in the patient's image folder, and create an entry in the document table. Then update this field with the pointer to the document table entry.
16	Note	text	NTE.3 at the OBX level. The NTE segment is repeatable and the Comment Text component is limited to 78 characters. Multiple NTE segments can be used for longer comments. All NTE segments at the OBX level will be concatenated and stored in this one field.

medlabspecimen
The EHRLabSpecimen table is structured to tightly with the HL7 standard and should have names that more reflect how the user will consume the data and for that reason for actual implementation we are using these medlab tables. Medical lab specimen. Contains data from the SPM segment. Each MedLab object can have 0 to many specimen segments. Each segment will be its own row in this table.
Order	Name	Type	Summary
0	MedLabSpecimenNum	bigint(20)	Primary key.
1	MedLabNum	bigint(20)	FK to medlab.MedLabNum. Each MedLab object can have 0 to many specimens pointing to it.
2	SpecimenID	varchar(255)	SPM.2 - Specimen ID. Unique identifier for the specimen as referenced by the Placer application, the Filler application, or both. The value sent in this field should be the identification value sent on the specimen container.
3	SpecimenDescript	varchar(255)	SPM.14 - Specimen Description. Additional information about the specimen.
4	DateTimeCollected	datetime	SPM.17 - Specimen Collection Date/Time. yyyyMMddHHmm format in the message, no seconds. The date and time when the specimen was acquired from the source. This is a DR - Date/Time Range data type, so it may have more than one component if a specimen was collected over a period of time. The first component is the start date/time so we will make sure to only store SPM.17.1 in this field.

mobileappdevice
Stores information on mobile app devices. These are devices that utilize the Xamarin mobile application.
Order	Name	Type	Summary
0	MobileAppDeviceNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
2	DeviceName	varchar(255)	The name of the device.
3	UniqueID	varchar(255)	The unique identifier of the device. Platform specific.
4	IsEclipboardEnabled	tinyint(4)	Indicates whether the device is allowed to operate the checkin app. For BYOD sessions will always be true because BYOD is authenticated by a unique URL link in a text message.
5	EclipboardLastAttempt	datetime	The date and time of the last attempted login for Eclipboard.
6	EclipboardLastLogin	datetime	The date and time of the last successful login for Eclipboard.
7	PatNum	bigint(20)	FK to patient.PatNum. Indicates which patient is currently using the device. 0 indicates the device is not in use. -1 indicates that the device is in use but we do not yet know which patient is using the device.
8	LastCheckInActivity	datetime	The date and time when we last updated the PatNum field for this device (indication the current use-state of the device).
9	IsBYODDevice	tinyint(4)	Indicates whether a device is a BYOD device, defaults to false.
10	DevicePage	tinyint(4)	Current page of the device.
11	UserNum	bigint(20)	FK to userod.UserNum. Indicates which user is currently logged into the device. 0 indicates this device is not logged into.
12	IsODTouchEnabled	tinyint(4)	Indicates whether this device is being used for ODTouch or not.
13	ODTouchLastLogin	datetime	The date and time of the last successful login for ODTouch.
14	ODTouchLastAttempt	datetime	The date and time of the last attempted login for ODTouch.

mobilebrandingprofile
Deprecated. Use Branding instead. Branding Profile for eClipboard customization. One (or none) to One relationship with clinics. Allows customers to customize the look of their eClipboard with a Clinic name and Logo.
Order	Name	Type	Summary
0	MobileBrandingProfileNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
2	OfficeDescription	varchar(255)	The Clinic Name that will be shown on eClipboard CheckIn
3	LogoFilePath	varchar(255)	eConnector will fetch this file. Same path for every computer, so maybe use a network shared file. Shows as 90x90 pixels.
4	DateTStamp	timestamp	The time that this object was last modified or inserted. Automatically updated by MySQL every time a row is added or changed. Used to determine if eClipboard needs to fetch an updated mobile branding profile.

mobiledatabyte
Table used to send various types of objects as bytes to ODXam applications. Example is a PDF for TxPlan or PaymentPlan. Row gets added here, sent to mobile device, and then consumed. Old rows are ignored.
Order	Name	Type	Summary
0	MobileDataByteNum	bigint(20)	Primary key.
1	RawBase64Data	mediumtext	The bytes in Base64.
2	RawBase64Code	mediumtext	The unlock code in Base64. Blank if no unlock code required to retrieve.
3	RawBase64Tag	mediumtext	Misc data in Base64
4	PatNum	bigint(20)	Can start out as 0.
5	ActionType	tinyint(4)	Enum:eActionType Stores the intended action associated to this rows data.
None: 0 - Placeholder
TreatmentPlan: 1 - Row is associated to a TP pdf to be viewed in eClipboard.
MakePayment: 2 - Instructs eClipboard to present patient with payment window.
PaymentPlan: 3 -
PerioExam: 4 - Associated with a list of perio exams.
ExamSheet: 5 - Used by eClilpboard to fill out exam sheets.
Checkin: 6 - Used by eClilpboard to checkin using QR code.
6	DateTimeEntry	datetime	The DateTime this row was entered.
7	DateTimeExpires	datetime	The DateTime that this row should be removed.

mobilenotification
Mobile App devices periodically poll this table and retrieve any records that are relevant to the device itself, the user using the device, or the clinic the device belongs to. The mobile apps will then perform an action based on the mobile notification type.
Order	Name	Type	Summary
0	MobileNotificationNum	bigint(20)	Primary key.
1	NotificationType	tinyint(4)	Enum:MobileNotificationType The type of notification. Example: TP. This will determine what actions the mobile app will perform upon retrieving this notification.
None: Default.
CI_CheckinPatient: Check-in a patient on a given device. For this type, the tag will have 3 items: the first name, last name, and birthdate of the patient in that order. The birthdate will be in DateTime.Ticks.
CI_AddSheet: Tells the device that is currently filling out sheets to add a sheet to the list. For this type, the list of primary keys will have two items: the patnum and the SheetNum in that order.
CI_RemoveSheet: Tells the device that is currently fillout out sheets to remove a sheet from the list. For this type, the list of primary keys will have two items: the patnum and the SheetNum in that order.
CI_GoToCheckin: This mobile notification tells the device to stop whatever it is doing and go to a fresh checkin page. This may be a blank self-checkin or may be waiting for a mobile notification. This allows users from OD to "clear" the device of a stale patient. No primary keys or tags needed.
CI_NewEClipboardPrefs: This mobile notification occurs when the preferences for this device's clinic changes. The tags for this mobile notification will be the EClipboardAllowSelfCheckIn(bool), EClipboardMessageComplete(string), EClipboardAllowSelfPortraitOnCheckIn(bool), and EClipboardPresentAvailableFormsOnCheckIn(bool) in that order.
IsAllowedChanged: This mobile notification occurs when the MobileAppDevice.IsAllowed changed for this device. The tag for this mobile notification will be IsAllowed (bool). If true then device which is currently awaiting in 'Not Allowed' state will try another login, should work this time. If false then force signout. Used for eClipboard and ODTouch.
ODM_LogoutODUser: This mobile notification occurs when a permission has changed for a given OD user and they are no longer allowed to use OD Mobile. The ListPrimaryKeys may contain the UserNum of the user who is no longer allowed. This session will then be logged out of versioned OD Mobile. If ListPrimaryKeys IsNullOrEmpty() then assume all users for the given ClinicNum should be logged out. No UserNum filter necessary in this case.
CI_TreatmentPlan: This mobile notification occurs when a OD proper user sends a patients treatment plan to a specific device to show the user. ListPrimaryKeys => [MobileDataByteNum, PatNum, TreatPlanNum]. ListTags Keys => The treatPlan.Heading, hasPracticeSig(Obsolete; based on if TP sheet has SigBoxPractice) .
CI_RemoveTreatmentPlan: This mobile notification occurs when a TreatmentPlan is deleted in OD and we want to tell a specific device so that they can remove it when viewing TreatmentPlans. ListPrimaryKeys => [TreatPlan.PatNum,TreatPlan.TreatPlanNum]
CI_SendPayment: This mobile notification occurs when a payment needs to be made on an eClip device. This either adds the Make Payment action item to the checkin checklist or it will open the QR code to scan from OD. ListPrimaryKeys => [TreatPlan.PatNum]
CI_RefreshPayment: This mobile notification occurs when a patient is currently on the device, when a payment is made, when a new card is added (XWeb only), and when a new statement is created in OD. ListPrimaryKeys => [PatNum]
CI_PaymentPlan: This mobile notification occurs when an OD proper user sends a payment plan to a specific device. ListPrimaryKeys => [MobileDataByte.MobileDataByteNum,PayPlan.PatNum,PayPlan.PayPlanNum] ListTags => [PayPlan.PayPlanDate]
CI_RemovePaymentPlan: This mobile notification occurs when a payment plan is removed from the associated eClip device or when a payment plan is removed from OD proper. This will remove a payment plan from user view on eClip. ListPrimaryKeys => [PayPlan.PatNum,PayPlan.PayPlanNum]
ODT_ExamSheetsAll:
ODT_ExamSheet:
ODT_PrintError:
ODM_NewTextMessage: Occurs when a new text message is received. This is a workaround due to android push notifications no longer being supported for xamarin.
CI_AddEForm: Tells the device that is currently filling out forms to add an eForm to the list. For this type, the list of primary keys will have two items: the PatNum and the EFormNum in that order.
CI_RemoveEForm: Tells the device that is currently filling out forms to remove an eForm from the list. For this type, the list of primary keys will have two items: the PatNum and the EFormNum in that order.
2	DeviceId	varchar(255)	The device id for the mobile notification. Example is random string of 10-12 characters. Only the device with this DeviceId will retrieve this record.
3	PrimaryKeys	text	A comma-delimited list of primary keys associated with the mobile notification. See MobileNotificationType for what is included with each type. Can include MobileDataByteNums, TreatPlanNum, SheetNums, and others.
4	Tags	text	A comma-delimited list of tags for this mobile notification. Can be anything. Different for each MobileNotificationType. See MobileNotificationType for what is included with each type.
5	DateTimeEntry	datetime	DateTime notification was entered into Db. Should not be edited.
6	DateTimeExpires	datetime	DateTime notification expires and becomes invalid.
7	AppTarget	tinyint(4)	Enum:EnumAppTarget Stores the mobile app that this notification is targeting. Prohibits a device running one app from consuming mobile notifications intended for a different app.
eClipboard: 0
ODMobile: 1
ODTouch: 2

mount
A mount shows in the images module just like other images in the tree. But it is just a container for images within it rather than an actual image itself. A mount layout cannot be edited once created for a patient (simply because we didn't add that functionality), but the individual images on it can be edited.
Order	Name	Type	Summary
0	MountNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	DocCategory	bigint(20)	FK to definition.DefNum. Categories for documents.
3	DateCreated	datetime	The date/time at which the mount itself was created. Usually, all the images on the mount are the same date, but not always.
4	Description	varchar(255)	Used to provide a document description in the image module tree-view.
5	Note	text	To allow the user to enter specific information regarding the exam and tooth numbers, as well as points of interest in the xray images.
6	Width	int(11)	The width of the mount, in pixels.
7	Height	int(11)	The height of the mount, in pixels.
8	ColorBack	int(11)	Color of the mount background. Typically white for photos and black for radiographs. Transparency not allowed.
9	ProvNum	bigint(20)	FK to provider.ProvNum. Optional. Used for radiographs.
10	ColorFore	int(11)	Color of drawings and text. Typically black for photos and white for radiographs.
11	ColorTextBack	int(11)	Color of drawing text background. Typically white for photos and black for radiographs. Transparent is allowed.
12	FlipOnAcquire	tinyint(4)	If true, each image will be flipped as it's acquired. Because ScanX images are backwards.
13	AdjModeAfterSeries	tinyint(4)	If true, then it will switch to Adj mode instead of the usual Pan mode.

mountdef
Template for each new mount. But there is no linking of the mount back to this mountDef. These can be freely deleted, renamed, moved, etc. without affecting any patient info.
Order	Name	Type	Summary
0	MountDefNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	ItemOrder	int(11)	The order that the mount defs will show in various lists.
3	Width	int(11)	The width of the mount, in pixels.
4	Height	int(11)	Height of the mount, in pixels.
5	ColorBack	int(11)	Color of the mount background. Typically white for photos and black for radiographs.
6	ColorFore	int(11)	Color of drawings and text. Typically black for photos and white for radiographs.
7	ColorTextBack	int(11)	Color of drawing text background. Typically white for photos and black for radiographs. Transparent is allowed.
8	ScaleValue	varchar(255)	Scale, decimal places, and units, separated by spaces. Example: "123.4 0 mm". The first two are required; units is optional. When a mount is created, and if this isn't blank, then this is converted into an ImageDraw of type ScaleValue.
9	DefaultCat	bigint(20)	FK to definition.DefNum. If set, a new mount will go into this category, regardless of which category is currently selected.
10	FlipOnAcquire	tinyint(4)	If true, each image will be flipped as it's acquired. Because ScanX images are backwards.
11	AdjModeAfterSeries	tinyint(4)	If true, then it will switch to Adj mode instead of the usual Pan mode.

mountitem
These are always attached to a mount. Like a mount, they cannot be edited. Documents are attached to each MountItem using Document.MountItemNum field. Image will always be cropped to make it look smaller or bigger if it doesn't exactly match the mount item rectangle ratio.
Order	Name	Type	Summary
0	MountItemNum	bigint(20)	Primary key.
1	MountNum	bigint(20)	FK to mount.MountNum.
2	Xpos	int(11)	The x position, in pixels, of the item on the mount.
3	Ypos	int(11)	The y position, in pixels, of the item on the mount.
4	ItemOrder	int(11)	The ordinal position of the item on the mount. 1-indexed because users see it. Any item with an ItemOrder of 0 is text, which cannot accept an image or be clicked on. Any item with an ItemOrder of -1 is unmounted and will show in the umounted area instead of on the mount.
5	Width	int(11)	The width, in pixels, of the mount item rectangle.
6	Height	int(11)	The height, in pixels, of the mount item rectangle.
7	RotateOnAcquire	int(11)	0,90,180,or 270.
8	ToothNumbers	varchar(255)	An optional list of tooth numbers. In Db, rigorously formatted as American numbers, and separated by commas. For display, uses hyphens for sequences. Very likely supports international tooth numbers, but not tested for that. These tooth numbers are initially copied here from the MountItemDef. They are then copied to the document (image) that gets put in this mount item. So mountitem.ToothNumbers is not actually used to indicate the final tooth numbers. use document.ToothNumbers instead.
9	TextShowing	text	Instead of an image, a mount item can show text. In this case, ItemOrder=0. Text color and background will be the mount default.
10	FontSize	float	This could vary significantly based on the size of the mount. It's always relative to mount pixels.

mountitemdef
These are always attached to mountdefs. Can be deleted without any problems.
Order	Name	Type	Summary
0	MountItemDefNum	bigint(20)	Primary key.
1	MountDefNum	bigint(20)	FK to mountdef.MountDefNum.
2	Xpos	int(11)	The x position, in pixels, of the item on the mount.
3	Ypos	int(11)	The y position, in pixels, of the item on the mount.
4	Width	int(11)	Width, in pixels, of the item rectangle on the mount. Any cropping, rotating, etc, will all be defined in the original image itself.
5	Height	int(11)	Height, in pixels, of the item rectangle on the mount. Any cropping, rotating, etc, will all be defined in the original image itself.
6	ItemOrder	int(11)	The ordinal position of the item on the mount. 1-indexed because users see it. 0 if TestShowing has a value.
7	RotateOnAcquire	int(11)	0,90,180,or 270.
8	ToothNumbers	varchar(255)	An optional list of tooth numbers. In Db, rigorously formatted as American numbers, and separated by commas. For display, uses hyphens for sequences. Very likely supports international tooth numbers, but not tested for that.
9	TextShowing	text	Instead of an image, a mount item can show text. In this case, ItemOrder=0. Text color and background will be the mount default.
10	FontSize	float	This could vary significantly based on the size of the mount. It's always relative to mount pixels.

msgtopaysent
AutoComm object for MsgToPay messages that have been queued or sent by the eConnector. The HQ version of this object is MsgToPayActive where a record is kept for ShortGuid/redirect purposes. Inherits IAutoCommApptGuid since they will all be attached to appointments.
Order	Name	Type	Summary
0	MsgToPaySentNum	bigint(20)	PK.
1	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
2	ClinicNum	bigint(20)	FK to patient.ClinicNum for the corresponding patient.
3	SendStatus	tinyint(4)	Indicates status of message.
4	Source	tinyint(4)	Source of this object. Can be Manual (implemented) or EConnectorAutoComm (not yet implemented).
5	MessageType	tinyint(4)	
6	MessageFk	bigint(20)	FK to primary key of appropriate table.
7	Subject	text	Subject of the message.
8	Message	text	Content of the message.
9	EmailType	tinyint(4)	Only used for manually sent emails.
10	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
11	DateTimeSent	datetime	DateTime the message was sent.
12	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
13	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
14	ShortGUID	varchar(255)	Generated by HQ. Identifies this AutoCommGuid in future transactions between HQ and OD.
15	DateTimeSendFailed	datetime	
16	ApptNum	bigint(20)	FK to appointment.AptNum
17	ApptDateTime	datetime	
18	TSPrior	bigint(20)	
19	StatementNum	bigint(20)	FK to statement.StatementNum

oidexternal
Order	Name	Type	Summary
0	OIDExternalNum	bigint(20)	Primary key.
1	IDType	varchar(255)	Enum:IdentifierType Internal data type to be associated with.
Root: Will most likely be the root of all other OIDs. Represents the organization.
LabOrder: FK to ehrlab.EhrLabNum. root+".1"
Patient: FK to patient.PatNum. root+".2"
Provider: FK to provider.ProvNum. root+".3"
CqmItem: This will be the root for all CQM reported items, like encounters, procedures, problems, etc. root+".4" The extension will be abbreviated name concatenated with the primary key of the object. Examples: pat5231 or medpat197432 or proc231782 or notperf38291. This is only used for generating QRDA documents and requires that the encounter, procedure, etc. is uniquely identified in the reports. The root+".4" makes it unique to this office, the abbreviated name plus primary key makes it unique within the office.
Problem: FK to disease.DiseaseNum. root+".5"
Appointment: FK to appointment.AptNum. root+".6"
InsPlan: FK to insplan.PlanNum. root+".7"
Procedure: FK to procedurelog.ProcNum. root+".8"
2	IDInternal	bigint(20)	This should be a Primary Key to a Table Type defined by the IDType field. Example: If IDType==Patient, then this field should be a PatNum that is a FK to Patient.Patnum
3	IDExternal	varchar(255)	The OID extension, when combined with rootExternal it uniquely identifies an object.
4	rootExternal	varchar(255)	The OID root, when combined with IDExternal it uniquely identifies an object.

oidinternal
Order	Name	Type	Summary
0	OIDInternalNum	bigint(20)	Primary key.
1	IDType	varchar(255)	Enum:IdentifierType Internal data type to be associated with OIDRoot
Root: Will most likely be the root of all other OIDs. Represents the organization.
LabOrder: FK to ehrlab.EhrLabNum. root+".1"
Patient: FK to patient.PatNum. root+".2"
Provider: FK to provider.ProvNum. root+".3"
CqmItem: This will be the root for all CQM reported items, like encounters, procedures, problems, etc. root+".4" The extension will be abbreviated name concatenated with the primary key of the object. Examples: pat5231 or medpat197432 or proc231782 or notperf38291. This is only used for generating QRDA documents and requires that the encounter, procedure, etc. is uniquely identified in the reports. The root+".4" makes it unique to this office, the abbreviated name plus primary key makes it unique within the office.
Problem: FK to disease.DiseaseNum. root+".5"
Appointment: FK to appointment.AptNum. root+".6"
InsPlan: FK to insplan.PlanNum. root+".7"
Procedure: FK to procedurelog.ProcNum. root+".8"
2	IDRoot	varchar(255)	This is the root OID for this data type, when combined with extension, uniquely identifies a single object.

operatory
Each row is a single operatory or column in the appts module.
Order	Name	Type	Summary
0	OperatoryNum	bigint(20)	Primary key
1	OpName	varchar(255)	The full name to show in the column.
2	Abbrev	varchar(255)	5 char or less. Not used much.
3	ItemOrder	smallint	The order that this op column will show. Changing views only hides some ops; it does not change their order. Zero based.
4	IsHidden	tinyint	Used instead of deleting to hide an op that is no longer used.
5	ProvDentist	bigint(20)	FK to provider.ProvNum. The dentist assigned to this op. If more than one dentist might be assigned to an op, then create a second op and use one for each dentist. If 0, then no dentist is assigned.
6	ProvHygienist	bigint(20)	FK to provider.ProvNum. The hygienist assigned to this op. If 0, then no hygienist is assigned.
7	IsHygiene	tinyint	Set true if this is a hygiene operatory. The hygienist will then be considered the main provider for this op.
8	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if no clinic.
9	DateTStamp	timestamp	Not user editable. The last time this row was edited.
10	SetProspective	tinyint(4)	If true patients put into this operatory will have status set to prospective.
11	IsWebSched	tinyint(4)	Operatories with IsWebSched set to true will be the ONLY operatories considered when searching for available time slots.
12	IsNewPatAppt	tinyint(4)	Deprecated as of 18.1. Entries within the deflink table indicate if this operatory is in fact available for WebSched New Pat Appt. Old summary: Operatories with IsNewPatAppt set to true will be the ONLY operatories considered when searching for available time slots. This is in regards to the New Patient Appointment portion of the Web Sched web application.
13	OperatoryType	bigint(20)	FK to definition.DefNum. The type of the Operatory. This value is not normally used, but rather to just mark which type the Operatory is.

orionproc
Order	Name	Type	Summary
0	OrionProcNum	bigint(20)	
1	ProcNum	bigint(20)	
2	DPC	tinyint(4)	
3	DateScheduleBy	date	
4	DateStopClock	date	
5	Status2	int(11)	
6	IsOnCall	tinyint(4)	
7	IsEffectiveComm	tinyint(4)	
8	IsRepair	tinyint(4)	
9	DPCpost	tinyint(4)	

orthocase
Holds financial and timing information for a single ortho case. For procs linked to Orthocases, estimates are calculated based off of orthocase info, not insurance info. The orthocase numbers are automatically placed into InsPayEst and InsEstTotalOverride in Procedures.ComputeEstimates(), taking control from insurance. Procedure fees are calculated based on orthocase info, not fee schedules. All overrides (fees and insurance) are performed when the procedure is set complete.
Order	Name	Type	Summary
0	OrthoCaseNum	bigint(20)	Primary key
1	PatNum	bigint(20)	FK to patient.PatNum. The patient on this ortho case.
2	ProvNum	bigint(20)	FK to provider.ProvNum.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
4	Fee	double	Total amount of procedure fees. Is editable by user.
5	FeeInsPrimary	double	The amount that primary insurance will cover for the entire ortho case.
6	FeePat	double	Calculated from Fee - FeeIns.
7	BandingDate	date	Date of Banding.
8	DebondDate	date	Date of Debond.
9	DebondDateExpected	date	Date of expected Debond.
10	IsTransfer	tinyint(4)	Used to denote that the banding date is used as the transfer date instead.
11	OrthoType	bigint(20)	FK to definition.DefNum
12	SecDateTEntry	datetime	DateTime ortho case was added. Not editable by user.
13	SecUserNumEntry	bigint(20)	FK to userod.usernum. The usernum that added the OrthoCase.
14	SecDateTEdit	timestamp	Timestamp of the last modification to the ortho case. Not editable by user.
15	IsActive	tinyint(4)	Determines whether or not this is an active ortho case
16	FeeInsSecondary	double	The amount that secondary insurance will cover for the entire ortho case. Will be set to zero if patient doesn't have secondary insurance

orthochart
For the orthochart feature, each row in this table is one cell in that grid. An empty cell often corresponds to a missing db table row.
Order	Name	Type	Summary
0	OrthoChartNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateService	date	Deprecated, use orthochartrow table instead. Date of service.
3	FieldName	varchar(255)	Keyed to displayfield.Description.
4	FieldValue	text	Stores the text that the user entered or picked.
5	UserNum	bigint(20)	Deprecated, use orthochartrow table instead. FK to userod.UserNum. The user that created or last edited an ortho chart field.
6	ProvNum	bigint(20)	Deprecated, use orthochartrow table instead. FK to provider.ProvNum. Can be 0.
7	OrthoChartRowNum	bigint(20)	FK to orthochartrow.OrthoChartRowNum.

orthochartlog
This stores log entries for debugging the orthochart. Logging gets turned on and off with the pref. This table will go away once the bug is found.
Order	Name	Type	Summary
0	OrthoChartLogNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ComputerName	varchar(255)	
3	DateTimeLog	datetime	DateTime that this log entry was made
4	DateTimeService	datetime	DateTime of the chart row.
5	UserNum	bigint(20)	FK to userod.UserNum. The user that created or last edited an ortho chart field.
6	ProvNum	bigint(20)	FK to provider.ProvNum.
7	OrthoChartRowNum	bigint(20)	FK to orthochartrow.OrthoChartRowNum.
8	LogData	mediumtext	This can be long and complex -- whatever you want. MediumText, so max length=16M.

orthochartrow
Represent a row in the ortho chart UI grid.
Order	Name	Type	Summary
0	OrthoChartRowNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateTimeService	datetime	DateTime of service.
3	UserNum	bigint(20)	FK to userod.UserNum. The user that created or last edited an ortho chart field.
4	ProvNum	bigint(20)	FK to provider.ProvNum.
5	Signature	text	Examples: "0:ritwq/wV8vlrgUYahhK+RH5UeBFA6W4jCkZdo0cDWd63aZb1S/W3Z4eW5LmchqfgniG23" and "1:52222559445999975122111500485555". The 1st character is whether or not the signature is Topaz. The 2nd character is a separator. The rest of the string is the hashed signature data. Raw signature data is the concatenation of the FieldName and FieldValue of all cells (orthocharts), ordered by FieldName.

orthocharttab
Links one orthocharttab to one displayfield. Allows for displayfields to be part of multiple orthocharttabs.
Order	Name	Type	Summary
0	OrthoChartTabNum	bigint(20)	FK to orthocharttab.OrthoChartTabNum.
1	TabName	varchar(255)	
2	ItemOrder	int(11)	Overrides the displayfield ItemOrder, so that each display field can have a different order in each ortho chart tab.
3	IsHidden	tinyint(4)	

orthocharttablink
Links one orthocharttab to one displayfield. Allows for displayfields to be part of multiple orthocharttabs.
Order	Name	Type	Summary
0	OrthoChartTabLinkNum	bigint(20)	Primary key.
1	ItemOrder	int(11)	Overrides the displayfield ItemOrder, so that each display field can have a different order in each ortho chart tab.
2	OrthoChartTabNum	bigint(20)	FK to orthocharttab.OrthoChartTabNum.
3	DisplayFieldNum	bigint(20)	FK to displayfield.DisplayFieldNum.
4	ColumnWidthOverride	int(11)	Overrides the DisplayField.ColumnWidth for OrthChartTabLinks when not 0. Otherwise uses associated DisplayFieldFieldNums DisplayField.ColumnWidth value.

orthohardware
Represents one bracket, wire, or elastic.
Order	Name	Type	Summary
0	OrthoHardwareNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateExam	date	Every hardware entry is tied to a single date. At each exam, a copy can be made of the hardware from the previous exam, and then it can be edited. It normally shows the most recent exam, and the hardware items showing in the ortho grid only include the most recent exam. Not sure yet how we will show hardware for previous exams/dates.
3	OrthoHardwareType	tinyint(4)	Enum:EnumOrthoHardwareType Bracket, Wire, or Elastic.
Bracket: 0
Wire: 1
Elastic: 2
4	OrthoHardwareSpecNum	bigint(20)	FK to orthohardwarespec.OrthoHardwareSpecNum. This is where the description and color come from.
5	ToothRange	varchar(255)	Tooth numbers stored here are always stored in Universal (1-32) notation. They are displayed to the user as Palmer notation. For brackets, always use single tooth numbers, like 8. For wires, must use a range like 2-15. For elastics, typically use 2 teeth separated with commas, but more are allowed.
6	Note	varchar(255)	
7	IsHidden	tinyint(4)	

orthohardwarespec
Specification for ortho hardware. Linked to one type such as bracket, wire, or elastic. This is a pick list of description and color for the user. These remain linked to patient data, so changes here will affect historical chart entries.
Order	Name	Type	Summary
0	OrthoHardwareSpecNum	bigint(20)	Primary key.
1	OrthoHardwareType	tinyint(4)	Enum:EnumOrthoHardwareType Bracket, Wire, or Elastic.
Bracket: 0
Wire: 1
Elastic: 2
2	Description	varchar(255)	Example NITI 16x25
3	ItemColor	int(11)	
4	IsHidden	tinyint(4)	
5	ItemOrder	int(11)	0 indexed. User controls it with arrows.

orthoplanlink
Used to attach payment plans and ortho schedules to an Ortho Case.
Order	Name	Type	Summary
0	OrthoPlanLinkNum	bigint(20)	Primary key
1	OrthoCaseNum	bigint(20)	FK to orthocase.OrthoCaseNum.
2	LinkType	tinyint(4)	Enum:OrthoPlanLinkType Holds the type of object that is being linked.
OrthoSchedule: 0 - OrthoSchedule
InsPayPlan: 1 - Insurance Payment Plan
PatPayPlan: 2 - Patient Payment Plan
3	FKey	bigint(20)	Holds the FKey of the object from the LinkType.
4	IsActive	tinyint(4)	Denotes if plan link is active or not.
5	SecDateTEntry	datetime	DateTime. Date plan link was added. Not editable by user.
6	SecUserNumEntry	bigint(20)	FK to userod.UseNum. User that added the plan link.

orthoproclink
Used to attach procedures to an OrthoCase. Multiple procs are typically attached to one OrthoCase.
Order	Name	Type	Summary
0	OrthoProcLinkNum	bigint(20)	Primary key
1	OrthoCaseNum	bigint(20)	FK to orthocase.OrthoCaseNum.
2	ProcNum	bigint(20)	FK to procedurelog.ProcNum
3	SecDateTEntry	datetime	DateTime proclink was added. Not editable by user.
4	SecUserNumEntry	bigint(20)	FK to userod.UserNum. User that added the proc link.
5	ProcLinkType	tinyint(4)	Enum:OrthoProcType Indicates what type of procedure is being associated to Ortho Case in link.
Banding: 0 - Procedure for putting appliance on.
Debond: 1 - Procedure for removing appliance.
Visit: 2 - All maintenance visits between Banding and Debond procedures.

orthorx
A group of ortho hardware that allows for faster entry than one tooth at a time. Changes to this table do not affect any patient records.
Order	Name	Type	Summary
0	OrthoRxNum	bigint(20)	Primary key.
1	OrthoHardwareSpecNum	bigint(20)	FK to orthohardwarespec.OrthoHardwareSpecNum. Description comes from here.
2	Description	varchar(255)	The description used for picking the prescription from a list.
3	ToothRange	varchar(255)	Tooth numbers stored here are always stored in Universal (1-32) notation. They are displayed to the user as Palmer notation. For brackets and elastics, always use tooth numbers separated by commas, like 2,3,4,5,6. For wires, must use a range like 2-15.
4	ItemOrder	int(11)	0 indexed. User controls it with arrows.

orthoschedule
Optional. Holds the Production Schedule for an OrthoCase.
Order	Name	Type	Summary
0	OrthoScheduleNum	bigint(20)	Primary key
1	BandingDateOverride	date	Override for banding date.
2	DebondDateOverride	date	Override for debond date.
3	BandingAmount	double	Amount to charge for banding procedure.
4	VisitAmount	double	Used every visit until the total off all visits+BandingAmount+DebondAmount=Fee of linked OrthoCase.
5	DebondAmount	double	Amount to charge for debond procedure.
6	IsActive	tinyint(4)	Is true if the ortho schedule is active.
7	SecDateTEdit	timestamp	DateTime the ortho schedule was last modified. Not editable by user.

patfield
These are custom fields added and managed by the user. Each row here is a field value for one patient.
Order	Name	Type	Summary
0	PatFieldNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	FieldName	varchar(255)	FK to patfielddef.FieldName. The full name is shown here for ease of use when running queries. But the user is only allowed to change fieldNames in the patFieldDef setup window.
3	FieldValue	text	Any text that the user types in. For picklists, this will contain the picked text. For dates, this is stored as the user typed it, after validating that it could be parsed. So queries that involve dates won't work very well. If we want better handling of date fields, we should add a column to this table. Checkbox will either have a value of 1, or else the row will be deleted from the db. Currency is handled in a culture neutral way, just like other currency in the db.
4	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
5	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
6	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

patfielddef
These are the definitions for the custom patient fields added and managed by the user.
Order	Name	Type	Summary
0	PatFieldDefNum	bigint(20)	Primary key.
1	FieldName	varchar(255)	This is treated as the key. The name of the field that the user will be allowed to fill in the patient info window.
2	FieldType	tinyint(4)	Enum:PatFieldType Text=0,PickList=1,Date=2,Checkbox=3,Currency=4
Text: 0
PickList: 1
Date: 2-Stored in db as entered, already localized. For example, it could be 2/04/11, 2/4/11, 2/4/2011, or any other variant. This makes it harder to create queries that filter by date, but easier to display dates as part of results.
Checkbox: 3-If checked, value stored as "1". If unchecked, row deleted.
Currency: 4-Numbers only.
InCaseOfEmergency: 5 - DEPRECATED. (Only used 16.3.1, deprecated by 16.3.4)
CareCreditStatus: 6 - CareCredit pre-approval status. For example, FieldValue string="Pre-Approved", from CareCreditWebStatus enum.
CareCreditPreApprovalAmt: 7 - CareCredit pre-approval amount.
CareCreditAvailableCredit: 8 - CareCredit - Remaining available Credit for CareCredit cardholders.
3	PickList	text	Deprecated. Use patfieldpickitem.
4	ItemOrder	int(11)	
5	IsHidden	tinyint(4)	Hides this PatField for any patient where it's currently blank. If already in use by a patient, then it still shows.

patfieldpickitem
Each row is an item in a PatFieldDef picklist. Not used unless the PatFieldDef is a Picklist type. These objects are created and managed by user.
Order	Name	Type	Summary
0	PatFieldPickItemNum	bigint(20)	Primary key.
1	PatFieldDefNum	bigint(20)	FK to patfielddef.PatFieldDefNum
2	Name	varchar(255)	Full text of PickList item.
3	Abbreviation	varchar(255)	Abbr to show when PickList item is displayed in cramped spaces like columns. Only implemented in Superfamily grid so far.
4	IsHidden	tinyint(4)	False for normal PickList items. Even if true/hidden, this item will still show in all the various windows where patient fields show. A hidden item will not normally show when picking from list for a patient unless the patient has already been assigned this item.
5	ItemOrder	int(11)	0-based.

patient
One row for each patient. Includes deleted patients.
Order	Name	Type	Summary
0	PatNum	bigint(20)	Primary key.
1	LName	varchar(100)	Last name.
2	FName	varchar(100)	First name.
3	MiddleI	varchar(100)	Middle initial or name.
4	Preferred	varchar(100)	Preferred name, aka nickname.
5	PatStatus	tinyint	Enum:PatientStatus
Patient: 0
NonPatient: 1
Inactive: 2
Archived: 3 - This status is also used for a merged patient that you're not keeping.
Deleted: 4
Deceased: 5
Prospective: 6- Not an actual patient yet.
6	Gender	tinyint	Enum:PatientGender
Male: 0
Female: 1
Unknown: 2- Required by HIPAA for privacy. Required by ehr to track missing entries. EHR/HL7 known as undifferentiated (UN).
Other: 3
7	Position	tinyint	Enum:PatientPosition Marital status would probably be a better name for this column.
Single: 0
Married: 1
Child: 2
Widowed: 3
Divorced: 4
8	Birthdate	date	Age is not stored in the database. Age is always calculated as needed from birthdate.
9	SSN	varchar(100)	In the US, this is 9 digits, no dashes. For all other countries, any punctuation or format is allowed.
10	Address	varchar(100)	.
11	Address2	varchar(100)	Optional second address line.
12	City	varchar(100)	.
13	State	varchar(100)	2 Char in USA. Used to store province for Canadian users.
14	Zip	varchar(100)	Postal code. For Canadian claims, it must be ANANAN. No validation gets done except there.
15	HmPhone	varchar(30)	Home phone. Includes any punctuation
16	WkPhone	varchar(30)	.
17	WirelessPhone	varchar(30)	.
18	Guarantor	bigint(20)	FK to patient.PatNum. Head of household.
19	CreditType	char(1)	Single char. Shows at upper right corner of appointments. Suggested use is A,B,or C to designate creditworthiness, but it can actually be used for any purpose.
20	Email	varchar(100)	.
21	Salutation	varchar(100)	Dear __. This field does not include the "Dear" or a trailing comma. If this field is blank, then the typical salutation is FName. Or, if a Preferred name is present, that is used instead of FName.
22	EstBalance	double	Current patient balance.(not family). Never subtracts insurance estimates.
23	PriProv	bigint(20)	FK to provider.ProvNum. The patient's primary provider. Required. The database maintenance tool ensures that every patient always has this number set, so the program no longer has to handle 0.
24	SecProv	bigint(20)	FK to provider.ProvNum. Secondary provider (hygienist). Optional.
25	FeeSched	bigint(20)	FK to feesched.FeeSchedNum. Fee schedule for this patient. Usually not used. If missing, the practice default fee schedule is used. If patient has insurance, then the fee schedule for the insplan is used.
26	BillingType	bigint(20)	FK to definition.DefNum. Must have a value, or the patient will not show on some reports.
27	ImageFolder	varchar(100)	Name of folder where images will be stored. Not editable for now.
28	AddrNote	text	Address or phone note. Unlimited length in order to handle data from other programs during a conversion.
29	FamFinUrgNote	text	Family financial urgent note. Only stored with guarantor, and shared for family.
30	MedUrgNote	varchar(255)	Individual patient note for Urgent medical.
31	ApptModNote	varchar(255)	Individual patient note for Appointment module note.
32	StudentStatus	char(1)	Single char. Nonstudent='N' or blank, Parttime='P', Fulltime='F'.
33	SchoolName	varchar(255)	College name. If Canadian, then this is field C10 and must be filled if C9 (patient.CanadianEligibilityCode) is 1 and patient is 18 or older.
34	ChartNumber	varchar(100)	Usually blank. Alternative and supplement to PatNum. Can take alphanumeric. Usually set during conversion or when bridging to imaging software. Historically, it typically showed as a sticker on the outside of a paper chart. Max length 100 to support larger ids for bridging to imaging softwares.
35	MedicaidID	varchar(20)	Optional. The Medicaid ID for this patient.
36	Bal_0_30	double	Aged balance from 0 to 30 days old. Aging numbers are for entire family. Only stored with guarantor.
37	Bal_31_60	double	Aged balance from 31 to 60 days old. Aging numbers are for entire family. Only stored with guarantor.
38	Bal_61_90	double	Aged balance from 61 to 90 days old. Aging numbers are for entire family. Only stored with guarantor.
39	BalOver90	double	Aged balance over 90 days old. Aging numbers are for entire family. Only stored with guarantor.
40	InsEst	double	Insurance Estimate for entire family. Only stored with guarantor.
41	BalTotal	double	Total balance for entire family before insurance estimate. Not the same as the sum of the 4 aging balances because this can be negative. Only stored with guarantor.
42	EmployerNum	bigint(20)	FK to employer.EmployerNum.
43	EmploymentNote	varchar(255)	Not used since version 2.8.
44	County	varchar(255)	FK to county.CountyName, although it will not crash if key absent.
45	GradeLevel	tinyint(4)	Enum:PatientGrade Gradelevel.
Unknown: 0
First: 1
Second: 2
Third: 3
Fourth: 4
Fifth: 5
Sixth: 6
Seventh: 7
Eighth: 8
Ninth: 9
Tenth: 10
Eleventh: 11
Twelfth: 12
PrenatalWIC: 13
PreK: 14
Kindergarten: 15
Other: 16
46	Urgency	tinyint(4)	Enum:TreatmentUrgency Used in public health screenings.
Unknown:
NoProblems:
NeedsCare:
Urgent:
47	DateFirstVisit	date	The date that the patient first visited the office. Automated.
48	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be zero if not attached to a clinic or no clinics set up.
49	HasIns	varchar(255)	For now, an 'I' indicates that the patient has insurance. This is only used when displaying appointments. It will later be expanded. User can't edit.
50	TrophyFolder	varchar(255)	The Trophy bridge is inadequate, this attempts to make it usable for offices that have invested in Trophy hardware.
51	PlannedIsDone	tinyint	This simply indicates whether the 'done' box is checked in the chart module. Used to be handled as a -1 in the NextAptNum field, but now that field is unsigned.
52	Premed	tinyint	Set to true if patient needs to be premedicated for appointments, includes PAC, halcion, etc.
53	Ward	varchar(255)	Only used in hospitals.
54	PreferConfirmMethod	tinyint	Enum:ContactMethod Used for eCR, which includes eReminders eConfirmations.
None: 0
DoNotCall: 1
HmPhone: 2
WkPhone: 3
WirelessPh: 4
Email: 5
SeeNotes: 6
Mail: 7
TextMessage: 8
55	PreferContactMethod	tinyint	Enum:ContactMethod
None: 0
DoNotCall: 1
HmPhone: 2
WkPhone: 3
WirelessPh: 4
Email: 5
SeeNotes: 6
Mail: 7
TextMessage: 8
56	PreferRecallMethod	tinyint	Enum:ContactMethod
None: 0
DoNotCall: 1
HmPhone: 2
WkPhone: 3
WirelessPh: 4
Email: 5
SeeNotes: 6
Mail: 7
TextMessage: 8
57	SchedBeforeTime	time	.
58	SchedAfterTime	time	.
59	SchedDayOfWeek	tinyint	We do not use this, but some users do, so here it is. 0=none. Otherwise, 1-7 for day.
60	Language	varchar(100)	The primary language of the patient. Typically eng (English), fra (French), spa (Spanish), or similar. If it's a custom language, then it might look like Tahitian. If none, then empty string.
61	AdmitDate	date	Used in hospitals. It can be before the first visit date. It typically gets set automatically by the hospital system.
62	Title	varchar(15)	Includes any punctuation. For example, Mr., Mrs., Miss, Dr., etc. There is no selection mechanism yet for user; they must simply type it in.
63	PayPlanDue	double	Amount "due now" for all payment plans such that someone in this family is the payment plan guarantor. This is the total of all payment plan charges past due (taking into account the PayPlansBillInAdvanceDays setting) subtract the amount already paid for the payment plans. Only stored with family guarantor.
64	SiteNum	bigint(20)	FK to site.SiteNum. Can be zero. Replaces the old GradeSchool field with a proper foreign key.
65	DateTStamp	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable.
66	ResponsParty	bigint(20)	FK to patient.PatNum. Can be zero. Person responsible for medical decisions rather than finances. Guarantor is still responsible for finances. This is useful for nursing home residents. Part of public health.
67	CanadianEligibilityCode	tinyint(4)	C09. Eligibility Exception Code. A number between 1-4. 0 is not acceptable for e-claims. 1=FT student, 2=disabled, 3=disabled student, 4=code not applicable. Warning. 4 is a 0 if using CDAnet version 02. This column should have been created as an int.
68	AskToArriveEarly	int(11)	Number of minutes patient is asked to come early to appointments.
69	PreferContactConfidential	tinyint(4)	Enum:ContactMethod Used for EHR.
None: 0
DoNotCall: 1
HmPhone: 2
WkPhone: 3
WirelessPh: 4
Email: 5
SeeNotes: 6
Mail: 7
TextMessage: 8
70	SuperFamily	bigint(20)	FK to patient.PatNum. If this is the same as PatNum, then this is a SuperHead. If zero, then not part of a superfamily. Synched for entire family. If family is part of a superfamily, then the guarantor for this family will show in the superfamily list in the Family module for anyone else who is in the superfamily. Only a guarantor can be a superfamily head.
71	TxtMsgOk	tinyint(4)	Enum:YN
Unknown: 0
Yes: 1
No: 2
72	SmokingSnoMed	varchar(32)	EHR smoking status as a SNOMED code. Will always be the most recent smoking status for the patient.
73	Country	varchar(255)	Country name. Only used by HQ to add country names to statements.
74	DateTimeDeceased	datetime	Needed for EHR syndromic surveillance messaging. Used in HL7 PID-29. Also for feature request #3040. Date and time because we need precision to the minute in syndromic surveillence messging.
75	BillingCycleDay	int(11)	A number between 1 and 31 that is the day of month that repeat charges should be applied to this account. Previously this was determined by the start date of the repeate charges.
76	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
77	SecDateEntry	date	Date automatically generated and user not allowed to change. Date when patient was inserted.
78	HasSuperBilling	tinyint(4)	0 by default. If true, this guarantor should be included in superbilling statements.
79	PatNumCloneFrom	bigint(20)	Deprecated, use patientlink table instead. Indicates if this patient should act as a clone of another patient. Previously, ortho cloned patients were signified by capitalizing the name fields of the newly cloned patient. This field will allow for an explicit flag to be set to indicate cloned status.
80	DiscountPlanNum	bigint(20)	Deprecated, use discountplansub table instead. FK to discountplan.DiscountPlanNum. Will be 0 if there is no DiscountPlan.
81	HasSignedTil	tinyint(4)	Signed Truth in Lending, relates to client permission to be charged interest on a payment plan.
82	ShortCodeOptIn	tinyint(4)	Syncs down from HQ and indicates whether the patient has texted STOP or START in response to text messages. Indicates if the patient has opted in, out, or not yet to using Short Codes for Appointment Texts.
83	SecurityHash	varchar(255)	Holds the salted hash of the PatNum. This prevents 3rd parties from inserting patients without our Db Integrity system noticing.

patientlink
Keeps track of patients who have been merged or cloned.
Order	Name	Type	Summary
0	PatientLinkNum	bigint(20)	Primary key.
1	PatNumFrom	bigint(20)	FK to patient.PatNum. The patient that is linked from. For a Merge type, this is that patient that was merged from. For a Clone type, this is the original or master patient.
2	PatNumTo	bigint(20)	FK to patient.PatNum, unless LinkType=PaySimple. The patient that is linked to. For a Merge type, this is that patient that was merged into. For a Clone type, this represents the clone that was made from the PatNumFrom patient.
3	LinkType	tinyint(4)	Enum:PatientLinkType The type of link.
Undefined: 0
Merge: 1 - The two patients have been merged into each other.
Clone: 2 - A clone has been made of the From patient. PatNumFrom is the original or master and PatNumTo is the clone.
PaySimple: 3 - The PatNumFrom column will hold the ID for PaySimple. This should not be used in OpenDental to get a patient.
4	DateTimeLink	datetime	The time the link was created.

patientnote
Essentially more columns in the patient table. They are stored here because these fields can contain a lot of information, and we want to try to keep the size of the patient table a bit smaller.
Order	Name	Type	Summary
0	PatNum	bigint(20)	FK to patient.PatNum. Also the primary key for this table. Always one to one relationship with patient table. A new patient might not have an entry here until needed.
1	FamFinancial	text	Only one note per family stored with guarantor.
2	ApptPhone	text	No longer used.
3	Medical	text	Medical Summary
4	Service	text	Service notes. Shows in Medical information window and in the Pt Info section of the Chart module.
5	MedicalComp	text	Complete current Medical History
6	Treatment	text	Shows in the Chart module normally just below the graphical tooth chart. Also known as Odontogram Notes.
7	ICEName	varchar(255)	In Case of Emergency Name.
8	ICEPhone	varchar(30)	In Case of Emergency Phone.
9	OrthoMonthsTreatOverride	int(11)	-1 by default. Overrides the default number of months for an ortho treatment for this patient. Gets automatically set to the current value found in the pref OrthoDefaultMonthsTreat when the first placement procedure has been completed and this value is -1. This column is an integer instead of a byte because it needs to store -1 so that users can override with the value of 0. When set to -1 the default practice value for the pref OrthoDefaultMonthsTreat is used.
10	DateOrthoPlacementOverride	date	Overrides the date of the first ortho procedure for this patient to use for ortho case patients. If MinDate, then the date is derived by looking at the first ortho procedure for this patient.
11	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
12	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed.
13	Consent	tinyint(4)	Enum:PatConsentFlags None=0,ShareMedicationHistoryErx=1, Indicates if the patient consents for DoseSpot to access their medication history, bitwise.
None: 0 - None
ShareMedicationHistoryErx: 1 - Patient consents for eRx to access their medication history
14	UserNumOrthoLocked	bigint(20)	FK to userod.UserNum. A real-time flag of which user is currently editing the Orth Chart. Prevents concurrency issues. 0 indicates unlocked. -5 indicates that an instance of OD changed users locally in order to sign an Ortho Chart row. -4 only lasts for 5 seconds and indicates that a user saved the chart and all machines viewing that chart need to refresh -1 indicates another user with the same username took control.
15	Pronoun	tinyint(4)	Enum: PronounPreferred Patient Pronoun override. None indicates no override.

patientportalinvite
Order	Name	Type	Summary
0	PatientPortalInviteNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
2	ApptNum	bigint(20)	Foreign key to the appointment represented by this AutoCommAppt.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
4	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
5	TSPrior	bigint(20)	This was the TSPrior used to send this reminder.
6	SendStatus	tinyint(4)	Indicates status of message.
7	MessageFk	bigint(20)	FK to primary key of appropriate table.
8	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
9	MessageType	tinyint(4)	
10	DateTimeSent	datetime	DateTime the message was sent.
11	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.
12	ApptDateTime	datetime	The Date and time of the original appointment. We need this in case the appointment was moved and needs another reminder sent out.

patientrace
Each patient may have multiple races. Used to represent a race or an ethnicity for a patient.
Order	Name	Type	Summary
0	PatientRaceNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	Race	tinyint(4)	Enum:PatRace Deprecated. CdcrecCode should be used exclusively.
NotSet: -1 - The value for all PatientRace entries after the Race column was deprecated.
Aboriginal: 0 - Hidden for EHR.
AfricanAmerican: 1 - CDCREC:2054-5 Race
AmericanIndian: 2 - CDCREC:1002-5 Race
Asian: 3 - CDCREC:2028-9 Race
DeclinedToSpecifyRace: 4 - Our hard-coded option for EHR reporting.
HawaiiOrPacIsland: 5 - CDCREC:2076-8 Race
Hispanic: 6 - CDCREC:2135-2 Ethnicicty. If EHR is turned on, our UI will force this to be supplemental to a base 'race'.
Multiracial: 7 - We had to keep this for backward compatibility. Hidden for EHR because it's explicitly not allowed.
Other: 8 - CDCREC:2131-1 Race.
White: 9 - CDCREC:2106-3 Race
NotHispanic: 10 - CDCREC:2186-5 Ethnicity. We originally used the lack of Hispanic to indicate NonHispanic. Now we are going to explicitly store NonHispanic to make queries for ClinicalQualityMeasures easier.
DeclinedToSpecifyEthnicity: 11 - Our hard-coded option for EHR reporting.
3	CdcrecCode	varchar(255)	FK to cdcrec.CdcrecCode. Example 2054-5. The value 'Declined to Specify' is stored as ASKU-ETHNICITY for ethnicity and ASKU-RACE as race.

patplan
Each row represents the linking of one insplan to one patient for current coverage. Dropping a plan will delete the entry in this table. Deleting a patplan will delete the actual insplan (if no dependencies).
Order	Name	Type	Summary
0	PatPlanNum	bigint(20)	Primary key
1	PatNum	bigint(20)	FK to patient.PatNum. The patient who currently has the insurance. Not the same as the subscriber.
2	Ordinal	tinyint	Number like 1, 2, 3, etc. Represents primary ins, secondary ins, tertiary ins, etc. 0 is not used
3	IsPending	tinyint	For informational purposes only. You have to enter the plan in order to check this box. Not related at all to the InsPending table.
4	Relationship	tinyint	Enum:Relat Remember that this may need to be changed in the Claim also, if already created.
Self: 0
Spouse: 1
Child: 2
Employee: 3
HandicapDep: 4
SignifOther: 5
InjuredPlaintiff: 6
LifePartner: 7
Dependent: 8
5	PatID	varchar(100)	An optional patient ID which will override the insplan.SubscriberID on eclaims. For Canada, this holds the Dependent Code, C17 and E17, and in that use it doesn't override subscriber id, but instead supplements it.
6	InsSubNum	bigint(20)	FK to inssub.InsSubNum. Gives info about the subscriber.
7	OrthoAutoFeeBilledOverride	double	Only for Ortho practices. The fee that will be charged out by the auto procedureto insurance each period. Overrides insplan.OrthoAutoFeeBilled. -1 to use insplan default. Instantiated to -1 in the program so that it defaults to the insplan default.
8	OrthoAutoNextClaimDate	date	Only for Ortho practices. The date before which the next automatic ortho procedure/claim cannot be automatically generated. If blank, this patient's ortho treatment has been stopped.
9	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
10	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

patrestriction
Currently only used to block scheduling of specific patients.
Order	Name	Type	Summary
0	PatRestrictionNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	PatRestrictType	tinyint(4)	Enum:PatRestrict
None: 0
ApptSchedule: 1 - Patient cannot be scheduled nor have schedule edited. This PatRestrict should probably be checked every place the group permissions AppointmentCreate, AppointmentMove, and AppointmentEdit are checked.

payconnectresponseweb
This table will never delete records, only upsert. PayConnectResponseWeb rows are records of all payments made from the Patient Portal via either PayConnect's Web Portal, or PayConnect's Merchant Services WebService if using a credit card token as a result of PayConnect's Web Portal.
Order	Name	Type	Summary
0	PayConnectResponseWebNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	PayNum	bigint(20)	FK to payment.PayNum.
3	AccountToken	varchar(255)	The account token used to poll the processing status.
4	PaymentToken	varchar(255)	The payment token used for future payments.
5	ProcessingStatus	varchar(255)	Enum:PayConnectWebStatus Used to determine if the payment is pending, needs action, or is completed and attached to a payment.
Created: 0.
CreatedError: 1.
Pending: 2.
PendingError: 3.
Expired: 4.
Completed: 5.
Cancelled: 6.
Declined: 7.
Unknown: 8.
UnknownError: 9.
6	DateTimeEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual datetime of entry.
7	DateTimePending	datetime	DateTime that the payment went to the pending status.
8	DateTimeCompleted	datetime	DateTime that the payment went to the completed status and is attached to a payment.
9	DateTimeExpired	datetime	DateTime that the payment opportunity time expired.
10	DateTimeLastError	datetime	DateTime of the last time that the payment had an error.
11	LastResponseStr	text	Raw JSON response (or error) from PayConnect.
12	CCSource	tinyint(4)	Enum:CreditCardSource .
None: 0 - This is used when the payment is not a Credit Card. If CC, then this means we are storing the actual credit card number. Not recommended.
XServer: 1 - Local installation of X-Charge
XWeb: 2 - Credit card created via X-Web (an eService)
PayConnect: 3 - PayConnect web service (from within OD).
XServerPayConnect: 4 - Credit card has been added through the local installation of X-Charge and the PayConnect web service.
XWebPortalLogin: 5 - Made from the login screen of the Patient Portal.
PaySimple: 6 - PaySimple web service (from within OD).
PaySimpleACH: 7 - PaySimple ACH web service (from within OD).
PayConnectPortal: 8 - PayConnect credit card (made from Patient Portal)
PayConnectPortalLogin: 9 - PayConnect credit card (made from Patient Portal Login screen).
CareCredit: 10 - CareCredit.
EdgeExpressRCM: 11 - Global Payments Cloud (formerly EdgeExpress) when calling the RCM program.
EdgeExpressCNP: 12 - Global Payments Card Not Present API (formerly EdgeExpress).
API: 13 - Payment taken through Open Dental API.
EdgeExpressPaymentPortal: 14 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal.
EdgeExpressPaymentPortalGuest: 15 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal as a guest.
PayConnectPaymentPortal: 16 - PayConnect payment taken through the Payment Portal.
PayConnectPaymentPortalGuest: 17 - PayConnect payment taken through the Payment Portal as a guest.
PaySimplePaymentPortal: 18 - PaySimple payment taken through the Payment Portal.
PaySimplePaymentPortalGuest: 19 - PaySimple payment taken through the Payment Portal as a guest.
PaySimplePaymentPortalACH: 20 - PaySimple ACH Payment taken through the Payment Portal.
XWebPaymentPortal: 21 - XWeb payment taken through the Payment Portal.
XWebPaymentPortalGuest: 22 - XWeb payment taken through the Payment Portal as a guest.
MeetInTheCloudTerminal: 23 - Meet In The Cloud payment via terminal.
13	Amount	double	The amount of the payment that is attempting to be made.
14	PayNote	varchar(255)	The note entered when making a payment.
15	IsTokenSaved	tinyint(4)	Whether or not the credit card token can be saved for future uses.
16	PayToken	varchar(255)	The payment token used to poll the processing status.
17	ExpDateToken	varchar(255)	Provides the Expiration Date of the account being accessed. Format is yyMM from XWeb gateway. Will be converted to ExpirationDate.
18	RefNumber	varchar(255)	The RefNumber associated to this transaction. Will only be set for Completed PayConnectWebStatuses.
19	TransType	varchar(255)	The Transaction Type associated to this transaction. Will only be set for Completed PayConnectWebStatuses.
20	EmailResponse	varchar(255)	Email address used for a requested receipt provided by the user when making a payment via the patient portal.
21	LogGuid	varchar(36)	The GUID used in EserviceLogs related to this response. May be blank.

payment
A patient payment. Always has at least one split.
Order	Name	Type	Summary
0	PayNum	bigint(20)	Primary key.
1	PayType	bigint(20)	FK to definition.DefNum. This will be 0 if this is an income transfer to another provider. Examples: Cash, Check, CC, Refund.
2	PayDate	date	The date that the payment displays on the patient account.
3	PayAmt	double	Amount of the payment. Must equal the sum of the splits.
4	CheckNum	varchar(25)	Check number is optional.
5	BankBranch	varchar(25)	Bank-branch code for checks. Example 19-7076.
6	PayNote	text	Any admin note. Not for patient to see. Length 4000.
7	IsSplit	tinyint	No longer used. Set to true to indicate that a payment has more than one paysplit.
8	PatNum	bigint(20)	FK to patient.PatNum. The patient where the payment entry will show. But only the splits affect account balances. This has a value even if the 'payment' is actually an income transfer to another provider.
9	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be 0 to indicate no clinic (unassigned). Copied from patient.ClinicNum when creating payment, but user can override. Not used in provider income transfers. Cannot be used in financial reporting when grouping by clinic, because payments may be split between clinics.
10	DateEntry	date	The date that this payment was entered. Not user editable.
11	DepositNum	bigint(20)	FK to deposit.DepositNum. 0 if not attached to any deposits. Cash does not usually get attached to a deposit; only checks.
12	Receipt	text	Text of printed receipt if the payment was done electronically. Allows reprinting if needed.
13	IsRecurringCC	tinyint(4)	True if this was an automatically added recurring CC charge rather then one entered by the user. This was set to true for all historical entries before version 11.1, but will be accurate after that.
14	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
15	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
16	PaymentSource	tinyint(4)	Enum:CreditCardSource Indicates the origin of the payment if the payment came from a credit card or from an external API. Will be 'None' if this payment did not use a credit card or API
None: 0 - This is used when the payment is not a Credit Card. If CC, then this means we are storing the actual credit card number. Not recommended.
XServer: 1 - Local installation of X-Charge
XWeb: 2 - Credit card created via X-Web (an eService)
PayConnect: 3 - PayConnect web service (from within OD).
XServerPayConnect: 4 - Credit card has been added through the local installation of X-Charge and the PayConnect web service.
XWebPortalLogin: 5 - Made from the login screen of the Patient Portal.
PaySimple: 6 - PaySimple web service (from within OD).
PaySimpleACH: 7 - PaySimple ACH web service (from within OD).
PayConnectPortal: 8 - PayConnect credit card (made from Patient Portal)
PayConnectPortalLogin: 9 - PayConnect credit card (made from Patient Portal Login screen).
CareCredit: 10 - CareCredit.
EdgeExpressRCM: 11 - Global Payments Cloud (formerly EdgeExpress) when calling the RCM program.
EdgeExpressCNP: 12 - Global Payments Card Not Present API (formerly EdgeExpress).
API: 13 - Payment taken through Open Dental API.
EdgeExpressPaymentPortal: 14 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal.
EdgeExpressPaymentPortalGuest: 15 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal as a guest.
PayConnectPaymentPortal: 16 - PayConnect payment taken through the Payment Portal.
PayConnectPaymentPortalGuest: 17 - PayConnect payment taken through the Payment Portal as a guest.
PaySimplePaymentPortal: 18 - PaySimple payment taken through the Payment Portal.
PaySimplePaymentPortalGuest: 19 - PaySimple payment taken through the Payment Portal as a guest.
PaySimplePaymentPortalACH: 20 - PaySimple ACH Payment taken through the Payment Portal.
XWebPaymentPortal: 21 - XWeb payment taken through the Payment Portal.
XWebPaymentPortalGuest: 22 - XWeb payment taken through the Payment Portal as a guest.
MeetInTheCloudTerminal: 23 - Meet In The Cloud payment via terminal.
17	ProcessStatus	tinyint(4)	Enum:ProcessStat Flags whether a payment came from online and needs to be processed.
OfficeProcessed: 0 - Payment made within the OD program.
OnlineProcessed: 1 - Payment made from the Patient Portal and has been processed within OD.
OnlinePending: 2 - Payment made from the Patient Portal and needs to be processed within OD.
18	RecurringChargeDate	date	The date of the recurring charge that this payment applies to.
19	ExternalId	varchar(255)	External Id
20	PaymentStatus	tinyint(4)	Enum:PaymentStatus
None: 0 - None
PaySimpleAchPosted: 1 - PaySimpleAchPosted
PaySimpleAchSettled: 2 - PaySimpleAchSettled
PaySimpleAchFailed: 3 - PaySimpleAchFailed
21	IsCcCompleted	tinyint(4)	A credit card transaction has been completed. This disables the CC buttons at the top of payment edit window to prevent duplicates.
22	MerchantFee	double	Stores any additional fees charged to the customer during a transaction. For display and reporting purposes.

payortype
Used to identify the source of payment for a given patient at a given point in time. As insurance is added and removed, rows should be either automatically inserted into this table, or the user should be prompted to specify what the new payor type is. The DateStart of one payor type is interpreted as the end date of the previous payor type. Example: Patient with no insurance may have payortype.SopCode=81 ("SelfPay"). Patient then adds Medicaid insurance and gets a second new PayorType entry with SopCode=2 (Medicaid).
Order	Name	Type	Summary
0	PayorTypeNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateStart	date	Date of the beginning of new payor type. End date is the DateStart of the next payor type entry.
3	SopCode	varchar(255)	FK to sop.SopCode. Examples: 121, 3115, etc.
4	Note	text	

payperiod
Used to view employee timecards. Timecard entries are not linked to a pay period. Instead, payperiods are set up, and the user can only view specific pay periods. So it feels like they are linked, but it's date based.
Order	Name	Type	Summary
0	PayPeriodNum	bigint(20)	Primary key.
1	DateStart	date	The first day of the payperiod
2	DateStop	date	The last day of the payperiod. Inclusive, ignoring time of day.
3	DatePaycheck	date	The date that paychecks will be dated. A few days after the dateStop. Optional.

payplan
Each row represents one signed agreement to make payments.
Order	Name	Type	Summary
0	PayPlanNum	bigint(20)	Primary key
1	PatNum	bigint(20)	FK to patient.PatNum. The patient who had the treatment done.
2	Guarantor	bigint(20)	FK to patient.PatNum. The person responsible for the payments. Does not need to be in the same family as the patient. Not necessarily the same as the guarantor on the PayPlanCharge.
3	PayPlanDate	date	Date that the payment plan will display in the account.
4	APR	double	Annual percentage rate. eg 18. This does not take into consideration any late payments, but only the percentage used to calculate the amortization schedule.
5	Note	text	Generally used to archive the terms when the amortization schedule is created.
6	PlanNum	bigint(20)	FK to insplan.PlanNum. Will be 0 if standard payment plan. But if this is being used to track expected insurance payments, then this will be the foreign key to insplan.PlanNum, and Guarantor will be 0.
7	CompletedAmt	double	The amount of the treatment that has already been completed. This should match the sum of the principal amounts for most situations. But if the procedures have not yet been completed, and the payment plan is to make any sense, then this number must be changed.
8	InsSubNum	bigint(20)	FK to inssub.InsSubNum. Will be 0 if standard payment plan. But if this is being used to track expected insurance payments, then this will be the foreign key to inssub.InsSubNum, and Guarantor will be 0.
9	PaySchedule	tinyint(4)	Enum:PaymentSchedule How often payments are scheduled to be made. This was used to make charges for amortization schedules of patient payment plans before dynamic payment plans were created. It is conceptually the same as ChargeFrequency and provides the same options. This is still set in various places, but only ChargeFrequency is used in algorithms for creating charges. This is now only used for insurance and old patient payment plans.
Monthly: 0 - Pay 1 time every month.
MonthlyDayOfWeek: 1 - Pay monthly, same week and day (e.g. 3rd Friday)
Weekly: 2 - Pay every week per month.
BiWeekly: 3 - Pay every other week per times per month.
Quarterly: 4 - Pay 4 times per year.
10	NumberOfPayments	int(11)	The number of payments that will be made to complete the payment plan.
11	PayAmt	double	Payment amount due per payment plan charge.
12	DownPayment	double	The amount paid toward the payment plan when it was first opened.
13	IsClosed	tinyint(4)	True if this payment plan is closed. Closed should not be edited.
14	Signature	text	The encrypted and bound signature in base64 format. The signature is bound to the concatenation of the Total Amount,APR,Number of Payments,Payment Amount
15	SigIsTopaz	tinyint(4)	True if the signature is in Topaz format rather than OD format.
16	PlanCategory	bigint(20)	FK to definition.DefNum
17	IsDynamic	tinyint(4)	True if this payment plan is a dynamic payment plan, false if it is static.
18	ChargeFrequency	tinyint(4)	Enum:PayPlanFrequency How often charges are created for the payment plan. This column was added when dynamic payment plans were created. Why this was added is uncertain because it is conceptually the same as PaySchedule and provides the same options. PaySchedule is still set in various places, but only ChargeFrequency is used in algorithms for creating charges. This is only used for dynamic payment plans.
Weekly: 0 - Weekly
EveryOtherWeek: 1 - Every Other Week
OrdinalWeekday: 2 - Monthly, same week and day (e.g. 3rd Friday)
Monthly: 3 - Monthly
Quarterly: 4 - Quarterly
19	DatePayPlanStart	date	The date of the first payment plan charge. Does not include downpayment.
20	IsLocked	tinyint(4)	True if the payment plan is locked. This is "Locked", not just disabling the terms. Locked payment plans cannot add production or modify terms. The checkbox 'Locked' can't be unchecked unless the user has the PayPlanUnlock permission. If the preference PayPlanRequireLockForAPR is enabled, 'Locked' must be checked before saving a plan with APR.
21	DateInterestStart	date	The date on which the pay plan can begin posting interest charges.
22	DynamicPayPlanTPOption	tinyint(4)	Enum:DynamicPayPlanTPOptions Indicates the selected mode for how treatment planned procedures are handled by a dynamic payment plan.
None: 0
AwaitComplete: 1
TreatAsComplete: 2
23	MobileAppDeviceNum	bigint(20)	A FK to the mobile app device that the PayPlan is currently on.
24	SecurityHash	varchar(255)	Holds the salted hash of the following paysplit fields: Guarantor, PayAmt, IsClosed, IsLocked.
25	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum. This is use when printing. Can only be payment plan type sheet. If 0, uses hard coded logic.

payplancharge
One of the dated charges attached to a payment plan. This has nothing to do with payments, but rather just causes the amount due to increase on the date of the charge. The amount of the charge is the sum of the principal and the interest.
Order	Name	Type	Summary
0	PayPlanChargeNum	bigint(20)	Primary key.
1	PayPlanNum	bigint(20)	FK to payplan.PayPlanNum.
2	Guarantor	bigint(20)	FK to patient.PatNum. The guarantor account that each charge will affect. Does not have to match the guarantor of the payment plan. This column doesn't even have to point to a family guarantor at all because that has a different meaning than a PP guarantor. E.g. Credits and Closeout debits will be linked to the patient, not guarantor.
3	PatNum	bigint(20)	FK to patient.PatNum. The patient account that the principal gets removed from.
4	ChargeDate	date	The date that the charge will show on the patient account. Any charge with a future date will not show on the account yet and will not affect the balance.
5	Principal	double	For Debits, this is the principal charge amount. For Credits (version 2 only), then this is the credit amount.
6	Interest	double	For Debits, this is the interest portion of this payment. Always 0 for Credits.
7	Note	text	Any note about this particular payment plan charge
8	ProvNum	bigint(20)	FK to provider.ProvNum. In old PPs, this was required to be the same for all payplancharges. In DPPs, it can be different for each charge. This must match the object that FKey is pointing to, whether proc, adj, or orthocase. When a payment is applied, it's done with paysplit.PayPlanChargeNum. Those paysplit ProvNums also need to match. Old payment plans didn't need to have production attched, which is why ProvNums previously had to be the same.
9	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Since there is no ClincNum field at the payplan level, the clinic must be the same for all payplancharges. It's initially assigned using the patient clinic. Payments applied should be to this clinic, although the current user interface does not help with this.
10	ChargeType	tinyint(4)	Enum:PayPlanChargeType The charge type of the payment plan. 0 - ChargeDue, 1 - Production. Only relevant for those on Payment Plan Version 2, not Dynamic Payment Plans.
Debit: 0
Credit: 1 - The production can be either Procedure, Adjust, or Ortho. Only used for PPv2, not DPPs.
11	ProcNum	bigint(20)	FK to procedurelog.ProcNum. The procedure that this payplancharge is attached to. Only applies to credits. Since DPPs dont' use credits, this column is not used for DPPs. Always 0 for ChargeDue. Can be 0 for production not attached to a procedure.
12	SecDateTEntry	datetime	DateTime payplancharge was added to the payplan. Not editable by user.
13	SecDateTEdit	timestamp	DateTime payplancharge was edited. Not editable by user.
14	StatementNum	bigint(20)	FK to statement.StatementNum. Only used when the statement in an invoice.
15	FKey	bigint(20)	Only present for dynamic payment plans. Contains FKey of the link type. ProcNum, AdjNum, or OrthoCaseNum. Since one ChargeDue can be split to multiple procedures, multiple rows are created in that case. In UI, these would be grouped by due date unless user checked ungroup box.
16	LinkType	tinyint(4)	Enum:PayPlanLinkType Only present for dynamic payment plans.
None: 0 - None. Should only be this when charges/credits are for regular static payment plans.
Adjustment: 1 - Adjustment
Procedure: 2 - Procedure
OrthoCase: 3 - OrthoCase
17	IsOffset	tinyint(4)	Set to true if this charge is created to offset an overcharge. Dynamic payment plans can get into this rare scenario where a charge has been inserted into the database for too much value. There is a 'fix' that users can apply from within the dynamic payment plan overcharge report which will create offsetting negative charges. The Income Transfer logic needs to know that this is an overcharge in order to remove value from corresponding charge that is linked to the same production entry (proc, adj, etc).
18	IsDownPayment	tinyint(4)	Set to true if this charge is a down payment. There can be multiple charges marked as down payment on one pay plan because of how charges get split because they get attached to production.

payplanlink
Each row represents Production for a Procedure, Adjustment, or OrthoCase on a (Dynamic) Payment Plan. The sum of these is the total of the payment plan.
Order	Name	Type	Summary
0	PayPlanLinkNum	bigint(20)	Primary key
1	PayPlanNum	bigint(20)	FK to payplan.PayPlanNum
2	LinkType	tinyint(4)	Enum:PayPlanLinkType The object type being linked to be credited.
None: 0 - None. Should only be this when charges/credits are for regular static payment plans.
Adjustment: 1 - Adjustment
Procedure: 2 - Procedure
OrthoCase: 3 - OrthoCase
3	FKey	bigint(20)	Stores the FKey of object being linked, known from link type.
4	AmountOverride	double	Optional override if full amount of object is not desired.
5	SecDateTEntry	datetime	DateTime. Date the link was created. If pref.PayPlanItemDateShowProc is false, then this is also the date that this entry shows in the main account module.

payplantemplate
A template of payplan terms that can be copied to a payment plan. Only used for dynamic payment plans, not patient payment plans.
Order	Name	Type	Summary
0	PayPlanTemplateNum	bigint(20)	Primary key
1	PayPlanTemplateName	varchar(255)	The name of the Pay Plan Template.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be 0.
3	APR	double	Annual percentage rate. eg 18.
4	InterestDelay	int(11)	The number of payments before interest is applied.
5	PayAmt	double	The total payment amount due for each period.
6	NumberOfPayments	int(11)	The total number of periods for the payment plan. If the Pay Plan is dynamic and NumberOfPayments is not 0 then this is only used to calculate the PayAmt. After the PayAmt is calculated, NumberOfPayments is set to 0.
7	ChargeFrequency	tinyint(4)	Enum:PayPlanFrequency How often charges are created for the payment plan. Monthly, weekly, etc. Only for Dynamic Payment Plans.
Weekly: 0 - Weekly
EveryOtherWeek: 1 - Every Other Week
OrdinalWeekday: 2 - Monthly, same week and day (e.g. 3rd Friday)
Monthly: 3 - Monthly
Quarterly: 4 - Quarterly
8	DownPayment	double	The amount paid toward the payment plan when it was first opened.
9	DynamicPayPlanTPOption	tinyint(4)	Enum:DynamicPayPlanTPOptions Indicates the selected mode for how treatment planned procedures are handled by a dynamic payment plan. None, AwaitComplete, or TreatAsComplete.
None: 0
AwaitComplete: 1
TreatAsComplete: 2
10	Note	varchar(255)	A detailed note of the terms shows for future reference. Any changes made to the terms will be added to the note. Other notes can be added as needed.
11	IsHidden	tinyint(4)	Templates can not be deleted, but can be hidden if not needed any more.
12	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum. This is use when printing. Can only be payment plan type sheet. If 0, uses hard coded logic.

paysplit
Always attached to a payment. Always affects exactly one patient account and one provider.
Order	Name	Type	Summary
0	SplitNum	bigint(20)	Primary key.
1	SplitAmt	double	Amount of split.
2	PatNum	bigint(20)	FK to patient.PatNum. Can be the PatNum of the guarantor if this is a split for a payment plan and the guarantor is in another family.
3	ProcDate	date	DEPRECATED. No longer used. In older versions (before 7.0), this was the date that showed on the account. Frequently the same as the date of the payment, but not necessarily. Not when the payment was made.
4	PayNum	bigint(20)	FK to payment.PayNum. Every paysplit must be linked to a payment.
5	IsDiscount	tinyint	No longer used.
6	DiscountType	tinyint	No longer used
7	ProvNum	bigint(20)	FK to provider.ProvNum.
8	PayPlanNum	bigint(20)	FK to payplan.PayPlanNum. 0 if not attached to a payplan.
9	DatePay	date	Date always in perfect synch with Payment date.
10	ProcNum	bigint(20)	FK to procedurelog.ProcNum. 0 if not attached to a procedure.
11	DateEntry	date	Date this paysplit was created. User not allowed to edit.
12	UnearnedType	bigint(20)	FK to definition.DefNum. Usually 0 unless this is an Unearned / Prepayment split. If there is no procedure attached to the paysplit, defaults to the type set in Pref PrepaymentUnearnedType. In the paysplit UI, 0=None. When this is set, it defaults to the first one in the list of defs which is typically Prepayment.
13	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Can be 0. Need not match the ClinicNum of the Payment, because a payment can be split between clinics.
14	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
15	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
16	FSplitNum	bigint(20)	No longer used.
17	AdjNum	bigint(20)	FK to adjustment.AdjNum. Can be 0. Indicates that this paysplit is meant to counteract an Adjustment.
18	PayPlanChargeNum	bigint(20)	FK to payplancharge.PayPlanChargeNum. Can be 0. Indicates that this paysplit is meant to counteract a PayPlanCharge.
19	PayPlanDebitType	tinyint(4)	Enum:PayPlanDebitTypes Explicitly specifies what this paysplit should be applied towards in regards to principal or interest.
Unknown: 0 - Legacy splits associated to payment plans did not specify what SplitAmt was applied towards and use this status.
Principal: 1 - Flags a split as a principal only payment.
Interest: 2 - Flags a split as an interest only payment.
20	SecurityHash	varchar(255)	Holds the salted hash of the following paysplit fields: PatNum, SplitAmt, DateEntry.

paysuitepayment
Received from various instream PaySuite API calls. Primarily used to post or reconcile insurance payments in Open Dental.
Order	Name	Type	Summary
0	PaySuitePaymentNum	bigint(20)	Primary key.
1	PaymentId	varchar(255)	PaySuite's payment identifier.
2	ProviderId	varchar(255)	CDA provider number of provider the payment was issued to. Provider.NationalProvID in Open Dental.
3	PaymentMethod	varchar(255)	"C" if payment is a cheque. "D" if payment is Direct Deposit.
4	PaymentReference	varchar(255)	Cheque number if PaymentMethod is "C". Direct deposit reference number if PaymentMethod is "D".
5	PaymentAmount	double	The total amount of the payment.
6	PaymentDate	date	Date the payment was made. Only specific to the date, not the time.
7	PaymentStatus	varchar(255)	PaySuite's payment status. "I"-Issued (Check/Direct Deposit not cashed or deposited yet), "P"-Paid (Check/Direct Deposit has been cashed or deposited), R-"Reversed", UT-Under Threshold (payment is too small for Direct Pay and will be rolled into a future payment).
8	ReversalReasonCode	varchar(255)	Reason the payment was reversed. "L"-Lost,"STO"-Stolen,"STA"-Stale,"MB"-Mailed back to instream,"PI"-Reversed by Payor,"O"-Other, blank if PaymentStatus is not "R".
9	AssociatedPaymentId	varchar(255)	If PaymentStatus is "R" or "UT", this is the PaymentId of the subsequent payment that this payment was rolled into. Will be blank for other statuses.
10	PaySuitePaymentDetailNum	bigint(20)	FK to PaySuitePaymentDetail
11	HasUnresolvedClaimPayment	tinyint(4)	True when a PaySuitePayment with status "P" (paid) matches multiple claimpayments or a single partial claimpayment. Also true when any claimpayment matches a PaySuitePayment with status of "R" (reversed).
12	ReconciliationStatus	tinyint(4)	Enum:EnumReconciliationStatus (0) DoNotProcess by default. Determines which stage of PaySuite reconciliation processing this PaySuitePayment is in.
DoNotProcess: 0 - Set for PaySuitePayments we don't need to reconcile, those with a PaymentStatus of "I" (Issued), "UT" (UnderThreshold), or ones that enter the database as "R" (Reversed).
ReadyToProcess: 1 - The OpenDentalService will attempt to reconcile these PaySuitePayments. We set this for PaySuitePayments that get inserted or updated with a PaymentStatus of "P" (Paid) and those that change from "P" to "R" (Reversed).
UnresolvedClaims: 2 - The OpenDentalService sets this status during reconciliation processing when a claim associated to the PaySuitePayment is not received or it has multiple matches in the database.
DiscrepanciesFound: 3 - The OpenDentalService sets this status during reconciliation processing when discrepancies are found between a claim associated to the PaySuitePayment in the database and PaySuite's claim or eob.
Complete: 4 - Set when a PaySuitePayment passes reconciliation with no discrepancies detected, or when a user resolves discrepancies.

paysuitepaymentdetail
Additional details for a PaySuitePayment stored as a JSON string. The reason we have a separate table is because the json can be quite large and we don't usually need it.
Order	Name	Type	Summary
0	PaySuitePaymentDetailNum	bigint(20)	Primary key.
1	DetailsJson	mediumtext	JSON string containing additional details for a PaySuitePayment. Can be deserialized to class PaySuitePaymentDetails. Includes arrays for PaymentIds of payments rolled into this one, claims paid by this payment, adjustments to the payment, credits and debits issued by the payor during the payment period, and PaySuite fees (an empty array unless the provider's subscription method deducts fees from insurance payments).

payterminal
Stores information about credit card terminals used for taking payments. Only used for PayConnect.
Order	Name	Type	Summary
0	PayTerminalNum	bigint(20)	Primary key.
1	Name	varchar(255)	User defined name for the payterminal. E.g. Front Desk.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
3	TerminalID	varchar(255)	Serial number of physical device, typically provided by the card processor.
4	CCIntegration	varchar(50)	Credit Card integration associated with the pay terminal (e.g. PayConnect)

pearlrequest
Stores the necessary information for polling Pearl’s API to check if AI annotations have been generated for an image sent from the Imaging module. It's also used to prevent duplicate image submissions to the API, which would return an error response. To poll Pearl for an image, all that's required is a request_id and an organization_id. Organization_id is stored in the Pearl program link.
Order	Name	Type	Summary
0	PearlRequestNum	bigint(20)	Primary key.
1	RequestId	varchar(255)	Request ID given to Pearl to uniquely identify this request. Generated as a GUID before uploading an image to Pearl.
2	DocNum	bigint(20)	FK to document. Links this request to the image that was sent. This is sufficient for mounts because mount images are sent individually to Pearl.
3	RequestStatus	tinyint(4)	Enum:EnumPearlStatus Keeps track of the request's status. Can be Polling, Received, or Error.
Polling: 0 - An individual machine is actively polling Pearl.
Received: 1 - The image was successfully processed and AI annotations were returned from Pearl.
Error: 2 - An error occurred on Pearl’s side. Only set for errors that prevent this request from ever being fulfilled, such as the image being rejected.
TimedOut: 3 - Pearl did not give results within the timeout period of 10 minutes. Polling for this request can be retried.
Uploading: 4 - The image is being uploaded to Pearl.
ErrorUploading: 5 - An error occurred while uploading. The image should be reuploaded..
ErrorProcessing: 6 - An error occurred while processing. The image should not be reuploaded, but we can restart polling.
NoResults: 7 - Pearl returned no results for this image. The image show not be reuploaded.
4	DateTSent	date	The time the image was originally sent to Pearl.
5	DateTChecked	date	The most recent time an API call was made to Pearl to check the status of this request.

perioexam
One perio exam for one patient on one date. Has lots of periomeasures attached to it.
Order	Name	Type	Summary
0	PerioExamNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ExamDate	date	.
3	ProvNum	bigint(20)	FK to provider.ProvNum.
4	DateTMeasureEdit	datetime	Date and time PerioExam was created or modified, including the associated PerioMeasure rows.
5	Note	text	Note box for exam based notes.

periomeasure
One row can hold up to six measurements for one tooth, all of the same type. Always attached to a perioexam.
Order	Name	Type	Summary
0	PerioMeasureNum	bigint(20)	Primary key.
1	PerioExamNum	bigint(20)	FK to perioexam.PerioExamNum.
2	SequenceType	tinyint	Enum:PerioSequenceType eg probing, mobility, recession, etc.
Mobility: 0
Furcation: 1
GingMargin: 2-AKA recession.
MGJ: 3-MucoGingivalJunction- the division between attached and unattached mucosa.
Probing: 4
SkipTooth: 5-For the skiptooth type, set surf to none, and ToothValue to 1.
BleedSupPlaqCalc: 6. Sum of flags for bleeding(1), suppuration(2), plaque(4), and calculus(8).
CAL: 7. But this type is never saved to the db. It is always calculated on the fly.
AttGing: 8. Attached Gingiva. This type is auto calculated and is never saved to the db.
3	IntTooth	smallint(6)	Valid values are 1-32. Every measurement must be associated with a tooth.
4	ToothValue	smallint(6)	This is used when the measurement does not apply to a surface(mobility and skiptooth). Valid values for all surfaces are 0 through 19, or -1 to represent no measurement taken.
5	MBvalue	smallint(6)	-1 represents no measurement and are very common. Values of 100+ represent positive values for Gingival Margins. Example: +5. Non-probing numbers show through from previous exams as slightly greyed out. The value from the most recent exam will show through. It will ignore any -1's on recent exams when deciding what should show through.
6	Bvalue	smallint(6)	.
7	DBvalue	smallint(6)	.
8	MLvalue	smallint(6)	.
9	Lvalue	smallint(6)	.
10	DLvalue	smallint(6)	.
11	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
12	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

pharmacy
An individual pharmacy store.
Order	Name	Type	Summary
0	PharmacyNum	bigint(20)	Primary key.
1	PharmID	varchar(255)	NCPDPID assigned by NCPDP. Not used yet.
2	StoreName	varchar(255)	For now, it can just be a common description. Later, it might have to be an official designation.
3	Phone	varchar(255)	Includes all punctuation.
4	Fax	varchar(255)	Includes all punctuation.
5	Address	varchar(255)	.
6	Address2	varchar(255)	Optional.
7	City	varchar(255)	.
8	State	varchar(255)	Two char, uppercase.
9	Zip	varchar(255)	.
10	Note	text	A freeform note for any info that is needed about the pharmacy, such as hours.
11	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.

pharmclinic
Links a pharmacy store to a clinic.
Order	Name	Type	Summary
0	PharmClinicNum	bigint(20)	Primary key.
1	PharmacyNum	bigint(20)	FK to pharmacy.PharmacyNum.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum.

phonenumber
Used to store phone numbers for patients.
Order	Name	Type	Summary
0	PhoneNumberNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	PhoneNumberVal	varchar(255)	The actual phone number for the patient. Includes any punctuation. No leading 1 or plus, so almost always 10 digits.
3	PhoneNumberDigits	varchar(30)	The phone number for the patient with all non-digit chars and any leading 1's or 0's removed.
4	PhoneType	tinyint(4)	Enum:PhoneType . Used to determine which column in the patient table, if any, this row should be synced with. Rows with 0 - Other are not synced with patient table columns. The other values sync with their corresponding column in the patient table 1 - HmPhone, 2 - WkPhone, and 3 - WirelessPhone.
Other: 0 - Other
HmPhone: 1 - HmPhone. Row is synced with the patient.HmPhone column.
WkPhone: 2 - WkPhone. Row is synced with the patient.WkPhone column.
WirelessPhone: 3 - WirelessPhone. Row is synced with the patient.WirelessPhone column.

popup
If an existing popup message gets changed, then an archive first gets created that's a copy of the original. This is so that we can track historical changes. When a new one gets created, all the archived popups will get automatically repointed to the new one. If you "delete" a popup, it actually archives that popup. All the other archives of that popup still point to the newly archived popup, but now there is no popup in that group with the IsArchived flag not set.
Order	Name	Type	Summary
0	PopupNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	Description	text	The text of the popup.
3	IsDisabled	tinyint(1)	Deprecated. Use DateTimeDisabled instead.
4	PopupLevel	tinyint(4)	Enum:EnumPopupLevel 0=Patient, 1=Family, 2=Superfamily. If Family, then this Popup will apply to the entire family. If Superfamily, then this popup will apply to the entire superfamily.
Patient: 0=Patient
Family: 1=Family
SuperFamily: 2=SuperFamily
Automation: 3=Automation. Not in db. This is only used in FormPopupsForFam as a dummy status for temporary display objects that will not be in db.
5	UserNum	bigint(20)	FK to userod.UserNum.
6	DateTimeEntry	datetime	The server time that this note was entered. Cannot be changed by user. Does not get changed automatically when level or isDisabled gets changed. If note itself changes, then a new popup is created along with a new DateTimeEntry. Current popup's edit date gets set to the previous entry's DateTimeEntry
7	IsArchived	tinyint(4)	Indicates that this is not the most current popup and that it is an archive. True for any archived or "deleted" popups.
8	PopupNumArchive	bigint(20)	This will be zero for current popups that show when a patient is selected. Archived popups will have a value which is the FK to its parent Popup. The parent popup could be the most recent popup or another archived popup. Will be zero for current and "deleted" popups.
9	DateTimeDisabled	datetime	The DateTime at which this popup will be disabled. If this is DateTime.MinValue, then it will never be disabled.

preference
Stores small bits of data for a wide variety of purposes. Any data that's too small to warrant its own table will usually end up here.
Order	Name	Type	Summary
0	PrefName	varchar(255)	The text 'key' in the key/value pairing.
1	ValueString	text	The stored value.
2	PrefNum	bigint(20)	Primary key. Not actually used. All queries are designed to use PrefName.
3	Comments	text	Documentation on usage and values of each pref. Mostly deprecated now in favor of using XML comments in the code.

printer
One printer selection for one situation for one computer.
Order	Name	Type	Summary
0	PrinterNum	bigint(20)	Primary key.
1	ComputerNum	bigint(20)	FK to computer.ComputerNum. This will be changed some day to refer to the computername, because it would make more sense as a key than a cryptic number.
2	PrintSit	tinyint	Enum:PrintSituation One of about 10 different situations where printing takes place. PrintSituation.Default is the OD default, not the windows default.
Default: 0- Covers any printing situation not listed separately.
Statement: 1
LabelSingle: 2
Claim: 3
TPPerio: 4- TP and perio
Rx: 5
LabelSheet: 6
Postcard: 7
Appointments: 8
RxControlled: 9
Receipt: 10
RxMulti: 11
3	PrinterName	varchar(255)	The name of the printer as set from the specified computer. Usually, if no printer was selected for a specific or default situation, then there will be no row in the db. But this can also be an empty string. For example, if DisplayPrompt is true, then a row is required in the db even if no specific printer is selected. Empty string or missing row indicates to use windows default or OD default.
4	DisplayPrompt	tinyint	If true, then user will be prompted for printer. Otherwise, print directly with little user interaction.
5	FileExtension	varchar(255)	String that holds the file extension type for this printer. No leading period. Example pdf or xps. Only used when IsVirtualPrinter is true.
6	IsVirtualPrinter	tinyint(4)	Bool that indicates if this printer is a virtual printer (pdf, xps, etc).

procapptcolor
An individual procedure code color range.
Order	Name	Type	Summary
0	ProcApptColorNum	bigint(20)	Primary key.
1	CodeRange	varchar(255)	Procedure code range defined by user. Includes commas and dashes, but no spaces. The codes need not be valid since they are ranges.
2	ColorText	int(11)	Color that shows in appointments
3	ShowPreviousDate	tinyint(4)	Adds most recent completed date to ProcsColored

procbutton
The 'buttons' to show in the Chart module. They must have items attached in order to do anything.
Order	Name	Type	Summary
0	ProcButtonNum	bigint(20)	Primary key
1	Description	varchar(255)	The text to show on the button.
2	ItemOrder	smallint	Order that they will show in the Chart module.
3	Category	bigint(20)	FK to definition.DefNum.
4	ButtonImage	text	If no image, then the clob will be an empty string. In this case, the bitmap will be null when loaded from the database.
5	IsMultiVisit	tinyint(4)	Only useful for procedure buttons which cause more than one procedure to be charted. Example: Crown (D code) and Delivery (N code). Causes the procedures generated by this procedure button to be grouped using links in the procmultivisit table.

procbuttonitem
Attached to procbuttons. These tell the program what to do when a user clicks on a button. There are two types: proccodes or autocodes.
Order	Name	Type	Summary
0	ProcButtonItemNum	bigint(20)	Primary key.
1	ProcButtonNum	bigint(20)	FK to procbutton.ProcButtonNum.
2	OldCode	varchar(15)	Do not use.
3	AutoCodeNum	bigint(20)	FK to autocode.AutoCodeNum. 0 if this is a procedure code.
4	CodeNum	bigint(20)	FK to procedurecode.CodeNum. 0 if this is an autocode.
5	ItemOrder	bigint(20)	Unusual ItemOrder column. Set implicitly based on the order procedures were added to the procedure button. This should prevent "random" ordered procedures on buttons with multiple procedures.

procbuttonquick
Used to customize quick buttons in the chart module.
Order	Name	Type	Summary
0	ProcButtonQuickNum	bigint(20)	Primary Key.
1	Description	varchar(255)	Description used for display.
2	CodeValue	varchar(255)	FK to procedurecode.ProcCode.
3	Surf	varchar(255)	Surfaces.
4	YPos	int(11)	Zero based YPos, row number within panel.
5	ItemOrder	int(11)	Items within each row are sorted using item order. Smallest item order will be drawn on the left.
6	IsLabel	tinyint(4)	If true, this "button" will be displayed as a label.

proccodenote
Stores the default note and time increments for one procedure code for one provider. That way, an unlimited number of providers can each have different notes and times. These notes and times override the defaults which are part of the procedurecode table. So, for single provider offices, there will be no change to the current interface.
Order	Name	Type	Summary
0	ProcCodeNoteNum	bigint(20)	Primary Key.
1	CodeNum	bigint(20)	FK to procedurecode.CodeNum.
2	ProvNum	bigint(20)	FK to provider.ProvNum.
3	Note	text	The note.
4	ProcTime	varchar(255)	X's and /'s describe Dr's time and assistant's time in the same increments as the user has set.
5	ProcStatus	tinyint(4)	Enum:ProcStat Indicates which status the procedure has to be set to in order for this note to take affect. Should only ever be 1 (TP) or 2 (C). See procedurelog.ProcStatus for more info.
TP: 1- Treatment Plan.
C: 2- Complete.
EC: 3- Existing Current Provider.
EO: 4- Existing Other Provider.
R: 5- Referred Out.
D: 6- Deleted.
Cn: 7- Condition.
TPi: 8- Treatment Plan inactive.

procedurecode
A list setup ahead of time with all the procedure codes used by the office. Every procedurelog entry which is attached to a patient is also linked to this table.
Order	Name	Type	Summary
0	CodeNum	bigint(20)	Primary Key. This happened in version 4.8.7.
1	ProcCode	varchar(15)	D-Code. Was Primary key, but now CodeNum is primary key. Can hold dental codes, medical codes, custom codes, etc.
2	Descript	varchar(255)	The main description.
3	AbbrDesc	varchar(50)	Abbreviated description.
4	ProcTime	varchar(24)	X's and /'s describe Dr's time and assistant's time in the same increments as the user has set.
5	ProcCat	bigint(20)	FK to definition.DefNum. The category that this code will be found under in the search window. Has nothing to do with insurance categories.
6	TreatArea	tinyint	Enum:TreatmentArea
None: 0-goes on claims as blank.
Surf: 1
Tooth: 2
Mouth: 3-goes on claims as 00.
Quad: 4
Sextant: 5
Arch: 6
ToothRange: 7
7	NoBillIns	tinyint	If true, do not usually bill this procedure to insurance.
8	IsProsth	tinyint	True if Crown,Bridge,Denture, or RPD. Forces user to enter Initial or Replacement and Date.
9	DefaultNote	text	The default procedure note to copy when marking complete.
10	IsHygiene	tinyint	Identifies hygiene procedures so that the correct provider can be selected.
11	GTypeNum	smallint	No longer used.
12	AlternateCode1	varchar(15)	For Medicaid. There may be more later.
13	MedicalCode	varchar(15)	FK to procedurecode.ProcCode. The actual medical code that is being referenced must be setup first. Anytime a procedure it added, this medical code will also be added to that procedure. The user can change it in procedurelog.
14	IsTaxed	tinyint	Used by some offices. SalesTaxPercentage has been added to the preference table to store the amount of sales tax to apply as an adjustment attached to a procedurelog entry.
15	PaintType	tinyint(4)	Enum:ToothPaintingType
None: 0
Extraction: 1
Implant: 2
RCT: 3
PostBU: 4
FillingDark: 5
FillingLight: 6
CrownDark: 7
CrownLight: 8
BridgeDark: 9
BridgeLight: 10
DentureDark: 11
DentureLight: 12
Sealant: 13
Veneer: 14
Text: 15-Text was previously called Watch
RetainedRoot: 16
SpaceMaintainer: 17
16	GraphicColor	int(11)	If set to anything but 0, then this will override the graphic color for all procedures of this code, regardless of the status.
17	LaymanTerm	varchar(255)	When creating treatment plans, this description will be used instead of the technical description.
18	IsCanadianLab	tinyint	Only used in Canada. Set to true if this procedure code is only used as an adjunct to track the lab fee.
19	PreExisting	tinyint(1)	This is true if this procedure code existed before ADA code distribution changed at version 4.8, false otherwise.
20	BaseUnits	int(11)	Support for Base Units for a Code (like anesthesia). Should normally be zero.
21	SubstitutionCode	varchar(25)	FK to procedurecode.ProcCode. Used for posterior composites because insurance substitutes the amalgam code when figuring the coverage.
22	SubstOnlyIf	int(11)	Enum:SubstitutionCondition Used so that posterior composites only substitute if tooth is molar. Ins usually pays for premolar composites.
Always: 0
Molar: 1
SecondMolar: 2
Never: 3
Posterior: 4
23	DateTStamp	timestamp	Last datetime that this row was inserted or updated.
24	IsMultiVisit	tinyint(4)	Deprecated
25	DrugNDC	varchar(255)	11 digits or blank, enforced. For 837I
26	RevenueCodeDefault	varchar(255)	Gets copied to procedure.RevCode. For 837I
27	ProvNumDefault	bigint(20)	FK to provider.ProvNum. 0 for none. Otherwise, this provider will be used for this code instead of the normal provider.
28	CanadaTimeUnits	double	For Canadian customers, tracks scaling insurance and periodontal scaling units for patients depending on coverage.
29	IsRadiology	tinyint(4)	Set to true for radiology procedures. An EHR core measure uses this flag to help determine the denominator for rad orders.
30	DefaultClaimNote	text	Default note inserted to claim note when claim is created.
31	DefaultTPNote	text	The default procedure note used when creating a new treatment planned procedure.
32	BypassGlobalLock	tinyint(4)	Enum:BypassLockStatus Specifies whether a proceduce with this code can be created before the global lock date. The only values that should be used for this field are NeverBypass and BypassIfZero.
NeverBypass: 0 - Never bypass the lock date.
BypassIfZero: 1 - Bypass the lock date if the fee is zero.
BypassAlways: 2 - Always bypass the global lock date.
33	TaxCode	varchar(16)	Used only by OD HQ for Sales Tax. This is the tax code we send to Avalara API so they can determine how much sales tax to charge for this procedure. The only way to edit this value is through raw queries, which is very dangerous.
34	PaintText	varchar(255)	The text to draw on the tooth for paint type Text.
35	AreaAlsoToothRange	tinyint(4)	This is an adjunct to TreatArea. If Quad or Arch, then this allows users to also specify a tooth or tooth range. Required by some insurance.
36	DiagnosticCodes	varchar(255)	Text to store up to 4 ICD-10 codes. Codes are comma-separated with no whitespace. Used to set the default DiagnosticCode, DiagnosticCode2, DiagnosticCode3, and DiagnosticCode4 fields for new procedures linked to the procedure code. When this field is not empty or null, it will override the ICD9DefaultForNewProcs preference. Example: M26.31,K08.401,K02.51

procedurelog
Database table is procedurelog. A procedure for a patient. Can be treatment planned or completed. Once it's completed, it gets tracked more closely by the security portion of the program. A procedure can NEVER be deleted. Status can just be changed to "deleted". A "Group Note" is a special kind of procedure. Its status is always EC. It always uses DCode "~GRP~". Just like all other procs, it can have exactly one ProcNote. To attach other procs to a Group Note, we use the ProcGroupItem table. It does not have to have any attachd procs, and their ProcStatuses do not matter (except maybe D). The ProvNum of a GroupNote can be set independently of the ProvNums on the attached procs.
Order	Name	Type	Summary
0	ProcNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	AptNum	bigint(20)	FK to appointment.AptNum. Only allowed to attach proc to one appt(not counting planned appt)
3	OldCode	varchar(15)	No longer used.
4	ProcDate	date	Procedure date that will show in the account as the date performed. If just treatment planned, the date can be the date it was tp'd, or the date can be min val if we don't care. This has no time component. Also see ProcTime column.
5	ProcFee	double	Procedure fee.
6	Surf	varchar(10)	Surfaces, or use "UL" etc for quadrant, "2" etc for sextant, "U","L" for arches. Sextants in the United States are: 1 (Upper Right), 2 (Upper Anterior), 3 (Upper Left), 4 (Lower Left), 5 (Lower Anterior), 6 (Lower Right). In Canada, Sextants are 03 through 08 (add 2 to the US sextant and prepend a zero).
7	ToothNum	varchar(2)	May be blank, otherwise 1-32 or A-T, 1 or 2 char. For supernumerary, add 50 to use 51-82. For supernumerary primary, use AS-TS. For Canadian users, using FDI nomenclature, we use 51-55 as a placeholder for supernumerary teeth, which are tooth numbers 99, 19 (UL quadrant), 29 (UR quadrant), 39 (LR quadrant), and 49 (LL quadrant). Logic for this is handled in the tooth logic class.
8	ToothRange	varchar(100)	May be blank, otherwise is series of toothnumbers separated by commas. No dashes. Tooth numbers include 1-32 or A-T. Supernumeraries not supported here yet.
9	Priority	bigint(20)	FK to definition.DefNum, which contains the text of the priority.
10	ProcStatus	tinyint	Enum:ProcStat TP=1,Complete=2,Existing Cur Prov=3,Existing Other Prov=4,Referred=5,Deleted=6,Condition=7.
TP: 1- Treatment Plan.
C: 2- Complete.
EC: 3- Existing Current Provider.
EO: 4- Existing Other Provider.
R: 5- Referred Out.
D: 6- Deleted.
Cn: 7- Condition.
TPi: 8- Treatment Plan inactive.
11	ProvNum	bigint(20)	FK to provider.ProvNum.
12	Dx	bigint(20)	FK to definition.DefNum, which contains text of the Diagnosis.
13	PlannedAptNum	bigint(20)	FK to appointment.AptNum. Was called NextAptNum in older versions. Allows this procedure to be attached to a Planned appointment as well as a standard appointment.
14	PlaceService	tinyint	Enum:PlaceOfService Only used in Public Health. Defaults to Pref.DefaultProcedurePlaceService or Clinic.DefaultPlaceService if using clinics when completing or creating a new proc.
Office: 0. Code 11
PatientsHome: 1. Code 12
InpatHospital: 2. Code 21
OutpatHospital: 3. Code 22
SkilledNursFac: 4. Code 31
CustodialCareFacility: 5. Code 33. In X12, a similar code AdultLivCareFac 35 is mentioned.
OtherLocation: 6. Code 99. We use 11 for office.
MobileUnit: 7. Code 15
School: 8. Code 03
MilitaryTreatFac: 9. Code 26
FederalHealthCenter: 10. Code 50
PublicHealthClinic: 11. Code 71
RuralHealthClinic: 12. Code 72
EmergencyRoomHospital: 13. Code 23
AmbulatorySurgicalCenter: 14. Code 24
TelehealthOutsideHome: 15. Code 02.
TelehealthInHome: 16. Code 10
OutreachSiteOrStreet: 17. Code 27
15	Prosthesis	char(1)	Single char. Blank=no, I=Initial, R=Replacement.
16	DateOriginalProsth	date	For a prosthesis Replacement, this is the original date.
17	ClaimNote	varchar(80)	This note goes out on e-claims. Not visible in Canada.
18	DateEntryC	date	This is the date this procedure was entered or set complete. If not status C, then the value is ignored. This date is set automatically when Insert, but older data or converted data might not have this value set. It gets updated when set complete. User never allowed to edit. This will be enhanced later.
19	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if no clinic.
20	MedicalCode	varchar(15)	FK to procedurecode.ProcCode. Optional.
21	DiagnosticCode	varchar(255)	Simple text for ICD-9 code. Gets sent with medical claims.
22	IsPrincDiag	tinyint	Set true if this medical diagnostic code is the principal diagnosis for the visit. If no principal diagnosis is marked for any procedures on a medical e-claim, then it won't be allowed to be sent. If more than one is marked, then it will just use one at random.
23	ProcNumLab	bigint(20)	FK to procedurelog.ProcNum. Only used in Canada. If not zero, then this proc is a lab fee and this indicates to which actual procedure the lab fee is attached. For ordinary use, they are treated like two separate procedures. It's only for insurance claims that we need to know which lab fee belongs to which procedure. Two lab fees may be attached to one procedure.
24	BillingTypeOne	bigint(20)	FK to definition.DefNum. Lets some users track charges for certain types of reports. For example, a Medicaid billing type could be assigned to a procedure, flagging it for inclusion in a report mandated by goverment. Would be more useful if it was automated to flow down based on insurance plan type, but that can be added later. Not visible if prefs.EasyHideMedicaid is true.
25	BillingTypeTwo	bigint(20)	FK to definition.DefNum. Same as BillingTypeOne, but used when there is a secondary billing type to account for.
26	CodeNum	bigint(20)	FK to procedurecode.CodeNum
27	CodeMod1	char(2)	Modifier for certain CPT codes.
28	CodeMod2	char(2)	Modifier for certain CPT codes.
29	CodeMod3	char(2)	Modifier for certain CPT codes.
30	CodeMod4	char(2)	Modifier for certain CPT codes.
31	RevCode	varchar(45)	NUBC Revenue Code for medical/inst billing. Used on UB04 and 837I.
32	UnitQty	int(11)	Default is 1. Becomes Service Unit Count on institutional UB claimforms SV205. Becomes Service Unit Count on medical 1500 claimforms SV104. Becomes procedure count on dental claims SV306. Gets multiplied by fee in all accounting calculations.
33	BaseUnits	int(11)	Base units used for some billing codes. Default is 0. No UI for this field. It is only edited in the ProcedureCode window. The database maint tool changes BaseUnits of all procedures to match that of the procCode. Not sure yet what it's for.
34	StartTime	int(11)	Start time in military. No longer used, but not deleting just in case someone has critical information stored here.
35	StopTime	int(11)	Stop time in military. No longer used, but not deleting just in case someone has critical information stored here.
36	DateTP	date	The date that the procedure was originally treatment planned. Does not change when marked complete.
37	SiteNum	bigint(20)	FK to site.SiteNum.
38	HideGraphics	tinyint(4)	Set to true to hide the chart graphics for this procedure. For example, a crown was done, but then tooth extracted.
39	CanadianTypeCodes	varchar(20)	F16, up to 5 char. One or more of the following: A=Repair of a prior service, B=Temporary placement, C=TMJ, E=Implant, L=Appliance lost, S=Appliance stolen, X=none of the above. Blank is equivalent to X for claim output, but one value will not be automatically converted to the other in this table. That will allow us to track user entry for procedurecode.IsProsth.
40	ProcTime	time	Used to be part of the ProcDate, but that was causing reporting issues.
41	ProcTimeEnd	time	Marks the time a procedure was finished.
42	DateTStamp	timestamp	Automatically updated by MySQL every time a row is added or changed.
43	Prognosis	bigint(20)	FK to definition.DefNum, which contains text of the Prognosis.
44	DrugUnit	tinyint(4)	Enum:EnumProcDrugUnit For 837I and UB04
None: 0
InternationalUnit: 1 - F2 on UB04.
Gram: 2 - GR on UB04.
Milligram: 3 - GR on UB04.
Milliliter: 4 - ML on UB04.
Unit: 5 - UN on UB04.
45	DrugQty	float	Includes fractions. For 837I
46	UnitQtyType	tinyint(4)	Enum:ProcUnitQtyType For dental, the type is always sent electronically as MultiProcs. For institutional SV204, Days will be sent electronically if chosen, otherwise ServiceUnits will be sent. For medical SV103, MinutesAnesth will be sent electronically if chosen, otherwise ServiceUnits will be sent.
MultProcs: 0-Only allowed on dental, and only option allowed on dental. This is also the default for all procs in our UI. For example, 4 PAs all on one line on the e-claim.
MinutesAnesth: 1-Only allowed on medical SV103.
ServiceUnits: 2-Allowed on medical SV103 and institutional SV204. This is the default for both medical and inst when creating X12 claims, regardless of what is set on the proc.
Days: 3-Only allowed on institutional SV204.
47	StatementNum	bigint(20)	FK to statement.StatementNum. Only used when the statement in an invoice.
48	IsLocked	tinyint(4)	If this flag is set, then the proc is locked down tight. No changes at all can be made except to append, sign, or invalidate. Invalidate really just sets the proc to status 'deleted'. An invalidated proc retains its IsLocked status. All locked procs will be status of C or D. Locked group notes will be status of EC or D.
49	BillingNote	varchar(255)	A note that will show directly in the Account module. Also used for repeating charges. Helps distinguish between charges for the same proccode in the same month.
50	RepeatChargeNum	bigint(20)	FK to repeatcharge.RepeatChargeNum. Used in repeating charges to determine which procedures belong to each repeating charge. If the repeat charge that this RepeatChargeNum points to is deleted, this column will not be set to 0 so that a record will still exist that this procedure came from a repeat charge.
51	SnomedBodySite	varchar(255)	Some procedures require a SNOMED code which indicates that site on the body at which this procedure was performed.
52	DiagnosticCode2	varchar(255)	Simple text for ICD-9 code. Gets sent with medical claims.
53	DiagnosticCode3	varchar(255)	Simple text for ICD-9 code. Gets sent with medical claims.
54	DiagnosticCode4	varchar(255)	Simple text for ICD-9 code. Gets sent with medical claims.
55	ProvOrderOverride	bigint(20)	FK to provider.ProvNum. Ordering provider override. Goes hand-in-hand with OrderingReferralNum. Medical eclaims only. Defaults to zero.
56	Discount	double	Stores the dollar amount of the discount, not full price. E.g. for a 10% discount, Fee = $160 Discount = $16. This column is used by treatment planned procedures to create an adjustment when set complete. It should not be used as an accurate monetary discount value for completed procedures.
57	IsDateProsthEst	tinyint(4)	For prosthesis replacement procedures on 5010 eclaims only. If true, indicates that the DateOriginalProsth is an estimated date. Estimated dates are often used when the original prosthesis was performed by another doctor.
58	IcdVersion	tinyint	The ICD code version for all diagnosis codes on this procedure, including DiagnosisCode, DiagnosisCode2, DiagnosisCode3, and DiagnosisCode4. Value of 9 for ICD-9, 10 for ICD-10, etc. Default value is 9. This value is copied from the DxIcdVersion preference when a procedure is created. The user can also manually change the IcdVersion on individual procedures.
59	IsCpoe	tinyint(4)	Procedures will be flagged as CPOE (Computerized Provider Order Entry) if this procedure was created by a provider. If a provider views, edits, or has any interaction with this procedure after its creation, it will be flagged as IsCPOE. Also, there will be a helpful window where providers can go to to "approve" non-CPOE procedures and mark them as CPOE to help meet EHR measures. If a staff person is logged in and enters this procedure then this is non-CPOE, so false.
60	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
61	SecDateEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date and time of entry.
62	DateComplete	date	Normally do not use this field. The date the procedure was originally set complete. If status is set complete and then set to something other than complete, this field will be set to DateTime.MinValue if DateComplete is today. If DateComplete is set to a day in the past and the status is changed from complete to something else, the field will not be cleared or updated. Db only field used by one customer and this is how they requested it. PatNum #19191
63	OrderingReferralNum	bigint(20)	FK to referral.ReferralNum. Goes hand-in-hand with ProvOrderOverride. Medical eclaims only. Defaults to zero. If set, and the ProvOrderOverride is not set, then this referral will go out at the ordering provider on medical e-claims.
64	TaxAmt	double	Holds the Sales Tax estimate for this procedure. Becomes a finalized amount when the procedure is marked complete.
65	Urgency	tinyint(4)	Enum:ProcUrgency Used in 1500 Medical Claim Form box 24c. Normal=blank 24c,Emergency='Y' in 24c.
Normal: 0 - Standard procedure urgency. Most procedures will have this ProcUrgency. This will result in the 1500 Medical Claim Form box 24c being blank. (Normal=blank,Emergency='Y')
Emergency: 1 - Emergency ProcUrgency is used to populate the 1500 Medical Claim Form box 24c with a 'Y'. (Emergency='Y',Normal=blank)
66	DiscountPlanAmt	double	The difference between the standard provider fee and discount plan fee. Frequently recalculated when procedure is TP.
67	NoBillIns	tinyint(4)	Preserves a “Do Not Bill Insurance” decision on individual procedures, ClaimProcs inherit this setting to their own NoBillIns preference as they are initially calculated and when they are regenerated due to insurance plan changes. Can only be set true by deliberately checking "Do Not Bill to Ins" on the Procedure Info window. Will automatically be set back to false if any attached ClaimProcs are manually edited to be billed to insurance. This field is not a separate checkbox on proc edit window. It just changes the behavior of the existing checkbox.

procgroupitem
Links Procedures(groupnotes) to Procedures in a 1-n relationship.
Order	Name	Type	Summary
0	ProcGroupItemNum	bigint(20)	Primary key.
1	ProcNum	bigint(20)	FK to procedurelog.ProcNum.
2	GroupNum	bigint(20)	FK to procedurelog.ProcNum.This is the group note that the procedure is in.

procmultivisit
Example: a crown prep and seat is spread over two appointments. A ProcMultiVisit row is created for each procedure. The procedure "In Process" status is a derived status in the UI based on the existence of a link between procedures in this table. In Process is removed once all procs in the group have been set complete. Having a procedure become part of a multi-visit group can affect how benefits are calculated and will set claim statuses so that they reflect that a multi-visit group is in progress.
Order	Name	Type	Summary
0	ProcMultiVisitNum	bigint(20)	Primary key
1	GroupProcMultiVisitNum	bigint(20)	FK to procmultivisit.ProcMultiVisitNum. Groups procmultivisit rows. Set to the ProcMultiVisitNum of the first row in the group.
2	ProcNum	bigint(20)	FK to procedurelog.ProcNum.
3	ProcStatus	tinyint(4)	Enum:ProcStat A copy of the value from procedurelog.ProcStatus, based on ProcNum. Reduces queries and speeds up logic.
TP: 1- Treatment Plan.
C: 2- Complete.
EC: 3- Existing Current Provider.
EO: 4- Existing Other Provider.
R: 5- Referred Out.
D: 6- Deleted.
Cn: 7- Condition.
TPi: 8- Treatment Plan inactive.
4	IsInProcess	tinyint(4)	A pseudo-status, calculated for the entire group and based on ProcStatuses of all procedures in the group. This will be true for all rows in an In Process group.
5	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
6	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
7	PatNum	bigint(20)	FK to patient.PatNum.

procnote
A procedure note for one procedure. User does not have any direct control over this table at all. It's handled automatically. When user "edits" a procedure note, the program actually just adds another note. No note can EVER be edited or deleted.
Order	Name	Type	Summary
0	ProcNoteNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	ProcNum	bigint(20)	FK to procedurelog.ProcNum
3	EntryDateTime	datetime	The server time that this note was entered. Essentially a timestamp.
4	UserNum	bigint(20)	FK to userod.UserNum.
5	Note	text	The actual note.
6	SigIsTopaz	tinyint	There are two kinds of signatures. Topaz signatures use hardware manufactured by that company, and the signature is created by their library. OD signatures work exactly the same way, but are only for on-screen signing.
7	Signature	text	The encrypted signature. A signature starts as a collection of vectors. The Topaz .sig file format is proprietary. The OD signature format looks like this: 45,68;48,70;49,72;0,0;55,88;etc. Tenths are allowed, so it's common to see decimals. It's simply a sequence of points, separated by semicolons. 0,0 represents pen up. Then, a hash is created from the Note, concatenated directly with the userNum. For example, "This is a note3" gets turned into a hash of 2849283940385391 (16 bytes). The hash is used to encrypt the signature data string using symmetric encryption. Therefore, the actual signature cannot be retrieved from the database by ordinary means. Also, the signature info cannot even be retrieved by Open Dental at all unless it supplies the same hash as before, proving that the data has not changed since signed. If OD supplies the correct hash, then it will be able to extract the sequence of vectors which it will then use to display the signature. The OD sigs are not compressed, and the Topaz sigs are. But there is very little difference in their sizes. It would be very rare for a signature to be larger than 1000 bytes. There are also situations where the API or web service inserts a totally different here. The first two points are int.MinVal. Example: -2147483648,-2147483648;-2147483648,-2147483648;47,23;12,35;... The remaining points after the first two are the byte values of individual letters that make up a string that will be displayed inside the signature box.

proctp
These are copies of procedures that are attached to saved treatment plans. The ProcNumOrig points to the actual procedurelog row.
Order	Name	Type	Summary
0	ProcTPNum	bigint(20)	Primary key.
1	TreatPlanNum	bigint(20)	FK to treatplan.TreatPlanNum. The treatment plan to which this proc is attached.
2	PatNum	bigint(20)	FK to patient.PatNum.
3	ProcNumOrig	bigint(20)	FK to procedurelog.ProcNum. This procNum is only here to compare and test the existence of the referenced procedure. If present, it will check to see whether the procedure is still status TP.
4	ItemOrder	smallint	The order of this proc within its tp. This is set when the tp is first created and can't be changed. Drastically simplifies loading the tp.
5	Priority	bigint(20)	FK to definition.DefNum which contains the text of the priority.
6	ToothNumTP	varchar(255)	A simple string displaying the tooth number. If international tooth numbers are used, then this will be in international format already. For Canadian users, using FDI nomenclature, we use 51 as a placeholder for supernumerary teeth, which is tooth number 99 according to CDHA standards (2/17/2014). Logic for this is handled in the tooth logic class.
7	Surf	varchar(255)	Tooth surfaces or area. This is already converted for international use. If arch or quad, then it will have U,LR, etc.
8	ProcCode	varchar(15)	Not a foreign key. Simply display text. Can be changed by user at any time.
9	Descript	varchar(255)	Description is originally copied from procedurecode.Descript, but user can change it.
10	FeeAmt	double	The fee charged to the patient. Never gets automatically updated.
11	PriInsAmt	double	The amount primary insurance is expected to pay. Never gets automatically updated.
12	SecInsAmt	double	The amount secondary insurance is expected to pay. Never gets automatically updated.
13	PatAmt	double	The amount the patient is expected to pay. Never gets automatically updated.
14	Discount	double	The amount of discount. Used for PPOs and procedure level discounts.
15	Prognosis	varchar(255)	Text from prognosis definition. Can be changed by user at any time.
16	Dx	varchar(255)	Text from diagnosis definition. Can be changed by user at any time.
17	ProcAbbr	varchar(50)	The ProcedureCode abbreviation. Can be changed by user at any time.
18	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
19	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
20	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
21	FeeAllowed	double	The amount primary insurance allows. Should be the exact amount in the FormClaimProc allowed amount field. May be either the PPO fee or the out of network allowed fee.
22	TaxAmt	double	Holds the Sales Tax estimate for this procedure. Used to review history when being reviewed by accounting. In the Treatment Plan, this represents an estimate and a record for pre-payments.
23	ProvNum	bigint(20)	FK to provider.ProvNum. Holds the ProvNum for this procedure's provider.
24	DateTP	date	Holds the DateTP for this procedure.
25	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Holds the ClinicNum for this procedure's clinic.
26	CatPercUCR	double	The UCR fee for the procedure. Cannot be changed by the user.

program
Each row is a bridge to an outside program, frequently an imaging program. Most of the bridges are hard coded, and simply need to be enabled. But user can also add their own custom bridge.
Order	Name	Type	Summary
0	ProgramNum	bigint(20)	Primary key.
1	ProgName	varchar(100)	Unique name for built-in program bridges. Not user-editable. enum ProgramName
2	ProgDesc	varchar(100)	Description that shows.
3	Enabled	tinyint	True if enabled.
4	Path	text	The path of the executable to run or file to open. Text since 255 is the largest VARCHAR supported and some softwares have long paths that can easily exceed 255 characters.
5	CommandLine	text	Some programs will accept command line arguments. Text since 255 is the largest VARCHAR supported and some softwares have long command line arguments that can easily exceed 255 characters.
6	Note	text	Notes about this program link. Peculiarities, etc.
7	PluginDllName	varchar(255)	If this is a Plugin, then this is the filename of the dll, including the extension. The dll must be located in the application directory.
8	ButtonImage	text	If no image, then will be an empty string. In this case, the bitmap will be null when loaded from the database. Must be a 22 x 22 image, and thus needs (width) x (height) x (depth) = 22 x 22 x 4 = 1936 bytes.
9	FileTemplate	text	For custom program links only. Stores the template of a file to be generated when launching the program link.
10	FilePath	varchar(255)	For custom program links only. Stores the path of a file to be generated when launching the program link.
11	IsDisabledByHq	tinyint(4)	Do not use directly. Call Programs.IsEnabledByHq() instead. Has HQ disabled this program for all customers via WebServiceHq.EnableAdditionalFeatures(). Using 'Disabled' because the web method will only send Programs HQ cares about. Any user defined Programs should not be marked as 'Disabled' by default.
12	CustErr	varchar(255)	Typically blank. A value is added to this if we have disabled this program at HQ's side and will be updated during HqProgram.Download()

programproperty
Some program links (bridges), have properties that need to be set. The property names are always hard coded. User can change the value. The property is usually retrieved based on its name.
Order	Name	Type	Summary
0	ProgramPropertyNum	bigint(20)	Primary key.
1	ProgramNum	bigint(20)	FK to program.ProgramNum
2	PropertyDesc	varchar(255)	The description or prompt for this property. Blank for workstation overrides of program path. Many bridges use this description as an "internal description". This way it can act like a FK in order to look up this particular property. Users cannot edit.
3	PropertyValue	text	The value. Could contain FK to other tables.
4	ComputerName	varchar(255)	The human-readable name of the computer on the network (not the IP address). Only used when overriding program path. Blank for typical Program Properties.
5	ClinicNum	bigint(20)	FK to clinic.ClinicNum. This is only used by a few bridges. Set to 0 for most bridges.
6	IsMasked	tinyint(4)	Is true if the program property is sensitive information that would need to be masked in the UI. False by default.
7	IsHighSecurity	tinyint(4)	Is true if the program property is a high security property. False by default.

promotion
This table represents a grouping of promotionlogs. When sending a waive of emails, this table links those promotion logs/emails together.
Order	Name	Type	Summary
0	PromotionNum	bigint(20)	Primary key.
1	PromotionName	varchar(255)	The name of the promotion.
2	DateTimeCreated	date	The time this promotion was sent out.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum The clinic this promotion was sent for.
4	TypePromotion	tinyint(4)	Enum:PromotionType - The type of promotion this is.
Manual: 0 - Signifies Manually Sent Promotions like from Mass Emails
Birthday: 1 - Signifies Birthday Greetings
Treatment: 2 - Promotional Treatment
Special: 3 - Special Promotions

promotionlog
When a reminder is sent for an appointment a record of that send is stored here. This is used to prevent re-sends of the same reminder.
Order	Name	Type	Summary
0	PromotionLogNum	bigint(20)	Primary key.
1	PromotionNum	bigint(20)	FK to promotion.PromotionNum
2	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
3	MessageFk	bigint(20)	FK to primary key of appropriate table.
4	EmailHostingFK	bigint(20)	A foreign key from the email hosting API that allows us to receive status updates on this specific email.
5	DateTimeSent	datetime	DateTime the message was sent.
6	PromotionStatus	tinyint(4)	Enum:PromotionLogStatus
Unknown: 0 - Unknown
Pending: 1 - Promotion has not been sent.
Bounced: 2 - Email has bounced because email does not exist.
Unsubscribed: 3 - User has unsubscribed in the passed and this was rejected.
Complaint: 4 - This email was sent and then marked as spam by the user.
Delivered: 5 - The email sent and delivered successfully.
Failed: 6 - The email failed to send for a different reason than any of the reasons above.
Opened: 7 - The email was opened by the user.
7	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
8	SendStatus	tinyint(4)	Indicates status of message.
9	MessageType	tinyint(4)	
10	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
11	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
12	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.

provider
A provider is usually a dentist or a hygienist. But a provider might also be a denturist, a dental student, or a dental hygiene student. A provider might also be a 'dummy', used only for billing purposes or for notes in the Appointments module. There is no limit to the number of providers that can be added.
Order	Name	Type	Summary
0	ProvNum	bigint(20)	Primary key.
1	Abbr	varchar(255)	Abbreviation. There was a limit of 5 char before version 5.4. The new limit is 255 char. This will allow more elegant solutions to various problems. Providers will no longer be referred to by FName and LName. Abbr is used as a human readable primary key.
2	ItemOrder	smallint	Order that provider will show in lists. 0-based.
3	LName	varchar(100)	Last name.
4	FName	varchar(100)	First name.
5	MI	varchar(100)	Middle inital or name.
6	Suffix	varchar(100)	eg. DMD or DDS.
7	FeeSched	bigint(20)	FK to feesched.FeeSchedNum.
8	Specialty	bigint(20)	FK to definition.DefNum.
9	SSN	varchar(12)	or TIN. No punctuation
10	StateLicense	varchar(15)	DEPRECATED. Can include punctuation
11	DEANum	varchar(15)	DEPRECATED. DEANum can be found in the providerclinic table.
12	IsSecondary	tinyint	True if hygienist.
13	ProvColor	int(11)	Color that shows in appointments. 0 represents empty no color.
14	IsHidden	tinyint	If true, provider will not show on any lists. The provider will still be a selection option in standard reports. Use IsHiddenReport to hide from reports. Hidden providers cannot access eRx. This will not affect scheduled appointments.
15	UsingTIN	tinyint	True if the SSN field is actually a Tax ID Num
16	BlueCrossID	varchar(25)	No longer used since each state assigns a different ID. Use the providerident instead which allows you to assign a different BCBS ID for each Payor ID.
17	SigOnFile	tinyint	Signature on file.
18	MedicaidID	varchar(20)	.
19	OutlineColor	int(11)	Color that shows in appointments as outline when highlighted. 0 represents empty no color.
20	SchoolClassNum	bigint(20)	FK to schoolclass.SchoolClassNum Used in dental schools. Each student is a provider. This keeps track of which class they are in.
21	NationalProvID	varchar(255)	US NPI, and Canadian UIN/CDA provider number.
22	CanadianOfficeNum	varchar(100)	Canadian field required for e-claims. Assigned by CDA. It's OK to have multiple providers with the same OfficeNum. Max length should be 4.
23	DateTStamp	timestamp	.
24	AnesthProvType	bigint(20)	FK to ??. Field used to set the Anesthesia Provider type. Used to filter the provider dropdowns on FormAnestheticRecord
25	TaxonomyCodeOverride	varchar(255)	If none of the supplied taxonomies works. This will show on claims.
26	IsCDAnet	tinyint(4)	For Canada. Set to true if CDA Net or a Canadian billable provider.
27	EcwID	varchar(255)	The name of this field is bad and will soon be changed to MedicalSoftID. This allows an ID field that can be used for HL7 synch with other software. Before this field was added, we were using prov abbreviation, which did not work well.
28	StateRxID	varchar(255)	DEPRECATED. Provider medical State ID.
29	IsNotPerson	tinyint(4)	Default is false because most providers are persons. But some dummy providers used for practices or billing entities are not persons. This is needed on 837s.
30	StateWhereLicensed	varchar(50)	DEPRECATED. The state abbreviation where the state license number in the StateLicense field is legally registered.
31	EmailAddressNum	bigint(20)	Not currently used. FK to emailaddress.EmailAddressNum. Optional, can be 0.
32	IsInstructor	tinyint(4)	Default is false because most providers will not be instructors. Used in Dental Schools
33	EhrMuStage	int(11)	Used to determine which stage of MU the provider is shown. 0=Global preference(Default), 1=Stage 1, 2=Stage 2, 3=Modified Stage 2.
34	ProvNumBillingOverride	bigint(20)	FK to provider.ProvNum
35	CustomID	varchar(255)	Custom ID used for reports or bridges only.
36	ProvStatus	tinyint(4)	Enum:ProviderStatus
Active: 0
Deleted: 1
37	IsHiddenReport	tinyint(4)	Determines whether the provider will show in the combobox on standard reports. IsHidden will not hide from reports. Data for this provider is still included on reports when running for "All" providers.
38	IsErxEnabled	tinyint(4)	Enum:ErxEnabledStatus Indicates whether or not the provider has individually agreed to accept eRx charges. Defaults to Disabled for new providers.
Disabled: 0.
Enabled: 1.
EnabledWithLegacy: 2.
39	Birthdate	date	The birthdate of the provider.
40	SchedNote	varchar(255)	Indicates if the provider should only be scheduled in a certain way (e.g. Root canals only)
41	WebSchedDescript	varchar(500)	The description of the provider that is displayed to patients in Web Sched.
42	WebSchedImageLocation	varchar(255)	The image of the provider that is displayed to patients in Web Sched. File name only (path not included). This should be a file name in the A to Z folder.
43	HourlyProdGoalAmt	double	The hourly production goal amount of the provider.
44	DateTerm	date	The date that the provider's term ends. This can be used to prevent appointments from being scheduled, appointments from being marked complete, prescriptions from being prescribed, and claims from being sent.
45	PreferredName	varchar(100)	The preferred name of the provider, shows what will be displayed to patients in eClipboard.

providerclinic
Allows specifying DEA number override and other overrides for the given combination of provider and clinic. This is different from the ProviderClinicLink table. That table records which providers are restricted to which clinics.
Order	Name	Type	Summary
0	ProviderClinicNum	bigint(20)	Primary key.
1	ProvNum	bigint(20)	FK to provider.ProvNum.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
3	DEANum	varchar(15)	The DEA number for this provider and clinic. The DEA number used to be stored in provider.DEANum.
4	StateLicense	varchar(50)	License number corresponding to the StateWhereLicensed. Can include punctuation
5	StateRxID	varchar(255)	Provider medical State ID.
6	StateWhereLicensed	varchar(15)	The state abbreviation where the state license number in the StateLicense field is legally registered.
7	CareCreditMerchantId	varchar(20)	The merchant number for this provider and clinic.

providercliniclink
This table restricts a provider to a certain clinic. Muliple entries will allow them access to multiple clinics. If a provider does not have an entry in this table, it means that provider is linked to all clinics. This is different from the ProviderClinic table. That table holds override information for providers for certain clinics.
Order	Name	Type	Summary
0	ProviderClinicLinkNum	bigint(20)	Primary key.
1	ProvNum	bigint(20)	FK to provider.ProvNum
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum. An entry of -1 means the provider is associated to no clinics.

providererx
Tracks which providers have access to eRx based on NPI. Synchronized with HQ.
Order	Name	Type	Summary
0	ProviderErxNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. Holder of registration key only for HQ record, in customer record this will be 0.
2	NationalProviderID	varchar(255)	NPI of a provider from the provider table. May correspond to multiple records in the provider table.
3	IsEnabled	tinyint(4)	Enum:ErxStatus Set to Enabled if the provider with the given NationalProviderID has access to eRx. Pending statuses are treated as if Disabled.
Disabled: 0.
Enabled: 1.
Undefined: 2.
PendingAccountId: 3.
NeedsManualAccountId: 4.
PendingEmail: 5.
Pending: 6.
PendingEconnTransmit: 7.
InTransitToEconn: 8.
NeedsManualOfficeContact: 9.
NeedsErxId: 10.
4	IsIdentifyProofed	tinyint(4)	True if HQ knows that the provider has completed the Identify Proofing (IDP) process and is allowed access to eRx. A provider can be enabled even when this is false if the provider is an existing provider before version 15.4 (a legacy provider).
5	IsSentToHq	tinyint(4)	Set to true if the NationalProviderID has been sent to HQ. Will be false in customer db until sent. If true, this tells us that the IsEnabled and IsIdentityProofed flags are set according to HQ records.
6	IsEpcs	tinyint(4)	Set to true manually if the customer has completed their EPCS process.
7	ErxType	tinyint(4)	Enum:ErxOption Identifies which eRx option is being used when asking HQ if they are enabled.
NewCrop: 0. Rebranded to Ensora.
DoseSpot: 1.
DoseSpotWithNewCrop: 2.
8	UserId	varchar(255)	User identifier used by the associated ErxType. Only used by OD HQ.
9	AccountId	varchar(25)	Only used by OD HQ.
10	RegistrationKeyNum	bigint(20)	FK to registrationkey.RegistrationKeyNum. HQ only, links to the registration key used to make this providererx row.

providerident
Some insurance companies require special provider ID #s, and this table holds them.
Order	Name	Type	Summary
0	ProviderIdentNum	bigint(20)	Primary key.
1	ProvNum	bigint(20)	FK to provider.ProvNum. An ID only applies to one provider.
2	PayorID	varchar(255)	FK to carrier.ElectID aka Electronic ID. An ID only applies to one insurance carrier.
3	SuppIDType	tinyint	Enum:ProviderSupplementalID
BlueCross: 0
BlueShield: 1
SiteNumber: 2
CommercialNumber: 3
4	IDNumber	varchar(255)	The number assigned by the ins carrier.

queryfilter
Each row is a query filter for the Query Monitor window. That window will exclude queries from showing and logging when they contain FilterText. This can significantly reduce the noise when looking through the queries.
Order	Name	Type	Summary
0	QueryFilterNum	bigint(20)	Primary key.
1	GroupName	varchar(255)	This is a simple string instead of a FK to another small table.
2	FilterText	varchar(255)	The text that we look for in the query monitor. Any query that contains this text will be filtered out.

question
Each row is one Question for one patient. If a patient has never filled out a questionnaire, then they will have no rows in this table.
Order	Name	Type	Summary
0	QuestionNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	ItemOrder	smallint	The order that this question shows in the list.
3	Description	text	The original question.
4	Answer	text	The answer to the question in text form.
5	FormPatNum	bigint(20)	FK to formpat.FormPatNum

questiondef
Each row represents one question on the medical history questionnaire. Later, other questionnaires will be allowed, but for now, all questions are on one questionnaire for the patient. This table has no dependencies, since the question is copied when added to a patient record. Any row can be freely deleted or altered without any problems.
Order	Name	Type	Summary
0	QuestionDefNum	bigint(20)	Primary key.
1	Description	text	The question as presented to the patient.
2	ItemOrder	smallint	The order that the Questions will show.
3	QuestType	tinyint	Enum:QuestionType
FreeformText: 0
YesNoUnknown: 1

quickpastecat
Quick paste categories are used by the quick paste notes feature.
Order	Name	Type	Summary
0	QuickPasteCatNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	ItemOrder	smallint	The order of this category within the list. 0-based.
3	DefaultForTypes	text	Enum:EnumQuickPasteType Each Category can be set to be the default category for multiple types of notes. Stored as integers separated by commas.
None: 0 - If None is used for a TextRich, then QuickPasteNotes will be disabled.
Procedure: 1
Appointment: 2
CommLog: 3
Adjustment: 4
Claim: 5
Email: 6
InsPlan: 7
Letter: 8
MedicalSummary: 9
ServiceNotes: 10
MedicalHistory: 11
MedicationEdit: 12
MedicationPat: 13
PatAddressNote: 14
Payment: 15
PayPlan: 16
Query: 17
Referral: 18
Rx: 19
FinancialNotes: 20
ChartTreatment: 21
MedicalUrgent: 22
Statement: 23
Recall: 24
Popup: 25
TxtMsg: 26
Task: 27
Schedule: 28
TreatPlan: 29
ClaimCustomTrack: 30
AutoNotePrompt: 31
JobManager: 32
ReadOnly: 33 - Do not use
Lab: 34
Equipment: 35
Etrans834Import: 36
InCaseOfEmergency: 37
ProviderSearchFilter: 38
ProgramLink: 39
PhoneEmpDefaultStatus: 40
WebChat: 41
FAQ: 42
Sheets: 43-Just autonotes, not quickpaste.

quickpastenote
Template for quick pasted note feature.
Order	Name	Type	Summary
0	QuickPasteNoteNum	bigint(20)	Primary key.
1	QuickPasteCatNum	bigint(20)	FK to quickpastecat.QuickPasteCatNum. Keeps track of which category this note is in.
2	ItemOrder	smallint	The order of this note within it's category. 0-based.
3	Note	text	The actual note. Can be multiple lines and possibly very long.
4	Abbreviation	varchar(255)	The abbreviation which will automatically substitute when preceded by a ?.

reactivation
Track patient contact via a commlog type ("Reactivation"). Any commlogs of this type that occur after the last completed procedure will be considered a contact attempt. Patients should show in this list if they have previously completed procedures (excluding broken/canceled), and the most recent was completed before the time span specified by the "Days Past" preference. Include Patients with the following PatStatus: Patient, Inactive, Prospective Patients should not show in this list if they have been marked "Do not contact". Patients should not show in this list if a future appointment is scheduled. Once contacted, Patient should not show in this list. Patient will later reappear in this list if the "Reactivation contact interval" time period passes since the last contact and an appointment has not yet been scheduled. If the patient is contacted the maximum number of times specified by the "Count Contact Max" preference, mark the patient as "Do Not Contact". Example: Johnny Patient had his last procedure completed on 1/1/2018. There is a "Reactivation" type commlog on his chart from 6/1/2018. He does not have any future scheduled appointments. Johnny would be included in the list of "Reactivation" patients, with a single contact attempt having been made already.
Order	Name	Type	Summary
0	ReactivationNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ReactivationStatus	bigint(20)	FK to definition.DefNum. Uses the existing RecallUnschedStatus DefCat.
3	ReactivationNote	text	An administrative note for staff use.
4	DoNotContact	tinyint(4)	The patient can set this property if they don't want to be contacted so that it won't interfere with the max attempts to contact option.

recall
A patient can only have one recall object per type. The recall table stores a few dates that must be kept synchronized with other information in the database. This is difficult. Anytime one of the following items changes, things need to be synchronized: procedurecode.SetRecall, any procedurelog change for a patient (procs added, deleted, completed, status changed, date changed, etc), patient status changed. There are expected to be a few bugs in the synchronization logic, so anytime a patient's recall is opened, it will also update. During synchronization, the program will frequently alter DateDueCalc, DateDue, and DatePrevious based on trigger procs. The system will also add and delete recalls as necessary. But it will not delete a recall unless all values are default and there is no useful information. When a user tries to delete a recall, they will only be successful if the trigger conditions do not apply. Otherwise, they will have to disable the recall instead.
Order	Name	Type	Summary
0	RecallNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateDueCalc	date	Not editable. The calculated date due. Generated by the program and subject to change anytime the conditions change. It can be blank (0001-01-01) if no appropriate triggers.
3	DateDue	date	This is the date that is actually used when doing reports for recall. It will usually be the same as DateDueCalc unless user has changed it. System will only update this field if it is the same as DateDueCalc. Otherwise, it will be left alone. Gets cleared along with DateDueCalc when resetting recall. When setting disabled, this field will also be cleared. This is the field to use if converting from another software.
4	DatePrevious	date	Not editable. Previous date that procedures were done to trigger this recall. It is calculated and enforced automatically. If you want to affect this date, add a procedure to the chart with a status of C, EC, or EO.
5	RecallInterval	int(11)	The interval between recalls. The Interval struct combines years, months, weeks, and days into a single integer value.
6	RecallStatus	bigint(20)	FK to definition.DefNum, or 0 for none.
7	Note	text	An administrative note for staff use.
8	IsDisabled	tinyint	If true, this recall type will be disabled (there's only one type right now). This is usually used rather than deleting the recall type from the patient because trigger conditions must be enforced for all patients.
9	DateTStamp	timestamp	Last datetime that this row was inserted or updated.
10	RecallTypeNum	bigint(20)	FK to recalltype.RecallTypeNum.
11	DisableUntilBalance	double	Default is 0. If a positive number is entered, then the family balance must be less in order for this recall to show in the recall list.
12	DisableUntilDate	date	If a date is entered, then this recall will be disabled until that date.
13	DateScheduled	date	This will only have a value if a recall is scheduled.
14	Priority	tinyint(4)	Enum:RecallPriority Indicates if the appointment has any special priority.
Normal: 0 - Default priority
ASAP: 1 - Used to identify items for the ASAP list
15	TimePatternOverride	varchar(255)	Default is an empty string. Used to override a RecallTypes time pattern.

recalltrigger
Links one procedurecode to one recalltype. The presence of this trigger is used when determining DatePrevious in the recall table.
Order	Name	Type	Summary
0	RecallTriggerNum	bigint(20)	Primary key.
1	RecallTypeNum	bigint(20)	FK to recalltype.RecallTypeNum
2	CodeNum	bigint(20)	FK to procedurecode.CodeNum

recalltype
All recalls are based on these recall types. Recall triggers are in their own table.
Order	Name	Type	Summary
0	RecallTypeNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	DefaultInterval	int(11)	The interval between recalls. The Interval struct combines years, months, weeks, and days into a single integer value.
3	TimePattern	varchar(255)	Stores the length of the appointment in /'s and X's. Used when scheduling the appointment. Each / or X represents one unit in regards to the global 'Time Increments' appointment view setting. This means that recall appointment lengths change along with the 'Time Increments' preference. /X/ could rep 15 mins, 30 mins, etc.
4	Procedures	varchar(255)	What procedures to put on the recall appointment. Comma delimited set of ProcCodes. (We may change this to CodeNums).
5	AppendToSpecial	tinyint(4)	Set to true if this recall type should be automatically appended to the appointment when scheduling a special recall type. This boolean only gets considered if this recall type is a "manual" or "custom" recall type. If this recall type is flagged as a special recall type then variable is ignored.

reconcile
Used in the Accounting section. Each row represents one reconcile. Transactions will be attached to it.
Order	Name	Type	Summary
0	ReconcileNum	bigint(20)	Primary key.
1	AccountNum	bigint(20)	FK to account.AccountNum
2	StartingBal	double	User enters starting balance here.
3	EndingBal	double	User enters ending balance here.
4	DateReconcile	date	The date that the reconcile was performed.
5	IsLocked	tinyint	If StartingBal + sum of entries selected = EndingBal, then user can lock. Unlock requires special permission, which nobody will have by default.

recurringcharge
This table holds a record of recurring charges that have been attempted.
Order	Name	Type	Summary
0	RecurringChargeNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. The patient this recurring charge is for.
2	ClinicNum	bigint(20)	FK to patient.ClinicNum. The clinic this recurring charge is for.
3	DateTimeCharge	datetime	The date time of the charge.
4	ChargeStatus	tinyint(4)	Enum:RecurringChargeStatus
NotYetCharged: 0 - The charge has not been attempted yet.
ChargeSuccessful: 1 - The charge was successful.
ChargeFailed: 2 - Processing the charge failed.
ChargeDeclined: 3 - Processing the charge failed and was specifically declined.
5	FamBal	double	The family balance at the time this charge was created.
6	PayPlanDue	double	The pay plan due at the time this charge was created.
7	TotalDue	double	The sum of the FamBal and PayPlanDue at the time this charge was created.
8	RepeatAmt	double	The recurring charge amount from the credit card at the time this charge was created.
9	ChargeAmt	double	The amount that was charged (or will be charged if the status is NotYetCharged).
10	UserNum	bigint(20)	FK to userod.UserNum. The user that processed this charge. Will be 0 if this was done automatically.
11	PayNum	bigint(20)	FK to payment.PayNum. The payment created from this charge.
12	CreditCardNum	bigint(20)	FK to creditcard.CreditCardNum. The credit card that caused this charge.
13	ErrorMsg	text	Any error message from processing this charge.

refattach
Attaches a referral to a patient.
Order	Name	Type	Summary
0	RefAttachNum	bigint(20)	Primary key.
1	ReferralNum	bigint(20)	FK to referral.ReferralNum.
2	PatNum	bigint(20)	FK to patient.PatNum.
3	ItemOrder	smallint	Order to display in patient info. One-based. Will be automated more in future.
4	RefDate	date	Date of referral.
5	RefType	tinyint(4)	Enum:ReferralType 0=RefTo,1=RefFrom,2=RefCustom.
RefTo: 0-
RefFrom: 1-
RefCustom: 2-Rarely used. Neither to nor from. Will not show on reports.
6	RefToStatus	tinyint	Enum:ReferralToStatus 0=None,1=Declined,2=Scheduled,3=Consulted,4=InTreatment,5=Complete.
None: 0
Declined: 1
Scheduled: 2
Consulted: 3
InTreatment: 4
Complete: 5
7	Note	text	Why the patient was referred out, or less commonly, the circumstances of the referral source. Also used when importing from forms. A referral is created with LName=Other. It gets attached to the patient with a note here.
8	IsTransitionOfCare	tinyint(4)	Used to track ehr events. All outgoing referrals default to true. The incoming ones get a popup asking if it's a transition of care.
9	ProcNum	bigint(20)	FK to procedurelog.ProcNum
10	DateProcComplete	date	.
11	ProvNum	bigint(20)	FK to provider.ProvNum. Used when referring out a patient to track the referring provider for EHR meaningful use. Will be -1 when RefType is not set to RefTo.
12	DateTStamp	timestamp	The datetime this referral attachment was last edited.

referral
All info about a referral is stored with that referral even if a patient. That way, it's available for easy queries.
Order	Name	Type	Summary
0	ReferralNum	bigint(20)	Primary key.
1	LName	varchar(100)	Last name. Or, if this is a referral like "website" or "word of mouth", then that text goes here in the LName field.
2	FName	varchar(100)	First name.
3	MName	varchar(100)	Middle name or initial.
4	SSN	varchar(9)	SSN or TIN, no punctuation. For Canada, this holds the referring provider CDA num for claims.
5	UsingTIN	tinyint	Specificies if SSN is real SSN.
6	Specialty	bigint(20)	FK to definition.DefNum.
7	ST	varchar(2)	State
8	Telephone	varchar(30)	Primary phone. Prior to version 25.4, this was restrictive and only allowed exactly 10 digits.
9	Address	varchar(100)	.
10	Address2	varchar(100)	.
11	City	varchar(100)	.
12	Zip	varchar(10)	.
13	Note	text	Holds important info about the referral.
14	Phone2	varchar(30)	Additional phone no restrictions
15	IsHidden	tinyint	Can't delete a referral, but can hide if not needed any more.
16	NotPerson	tinyint	Set to true for referralls such as Yellow Pages.
17	Title	varchar(255)	i.e. DMD or DDS
18	EMail	varchar(255)	.
19	PatNum	bigint(20)	FK to patient.PatNum for referrals that are patients.
20	NationalProvID	varchar(255)	NPI for the referral
21	Slip	bigint(20)	FK to sheetdef.SheetDefNum. Referral slips can be set for individual referral sources. If zero, then the default internal referral slip will be used instead of a custom referral slip.
22	IsDoctor	tinyint(4)	True if another dentist or physician. Cannot be a patient.
23	IsTrustedDirect	tinyint(4)	True if checkbox E-mail Trust for Direct is checked.
24	DateTStamp	timestamp	The datetime this referral was last edited.
25	IsPreferred	tinyint(4)	True if the referral is a preferred referral. The only purpose is to allow filtering in the list of referrals so that the list can be much shorter.
26	BusinessName	varchar(255)	Represents the name of the business that the referral works for.
27	DisplayNote	varchar(4000)	This is a global field used for Scheduling Notes that will show in the family module patient info grid.

referralcliniclink
Table to link referrals and clinics together.
Order	Name	Type	Summary
0	ReferralClinicLinkNum	bigint(20)	Primary key.
1	ReferralNum	bigint(20)	FK to referral.ReferralNum.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum.

registrationkey
Keeps track of which product keys have been assigned to which customers. This datatype is only used if the program is being run from a distributor installation. A single customer is allowed to have more than one key, to accommodate for various circumstances, including having multiple physical business locations.
Order	Name	Type	Summary
0	RegistrationKeyNum	bigint(20)	Primary Key.
1	PatNum	bigint(20)	FK to patient.PatNum. The customer to which this registration key applies.
2	RegKey	varchar(4000)	The registration key as stored in the customer database.
3	Note	varchar(4000)	Db note about the registration key. Specifically, the note must include information about the location to which this key pertains, since once at least one key must be assigned to each location to be legal.
4	DateStarted	date	This will help later with tracking for licensing.
5	DateDisabled	date	This is used to completely disable a key. Might possibly even cripple the user's program. Usually only used if reassigning another key due to abuse or error. If no date specified, then this key is still valid.
6	DateEnded	date	This is used when the customer cancels monthly support. This still allows the customer to get downloads for bug fixes, but only up through a certain version. Our web server program will use this date to deduce which version they are allowed to have. Any version that was released as a beta before this date is allowed to be downloaded.
7	IsForeign	tinyint(1)	This is assigned automatically based on whether the registration key is a US version vs. a foreign version. The foreign version is not able to unlock the procedure codes. There are muliple layers of safeguards in place.
8	UsesServerVersion	tinyint(4)	Deprecated.
9	IsFreeVersion	tinyint(4)	We have given this customer a free version. Typically in India.
10	IsOnlyForTesting	tinyint(4)	This customer is not using the software with live patient data, but only for testing and development purposes.
11	VotesAllotted	int(11)	Typically 100, although it can be more for multilocation offices.
12	IsResellerCustomer	tinyint(4)	This is a customer of a reseller, so this customer will not have full access to all our services.
13	HasEarlyAccess	tinyint(4)	This is a customer that is allowed early access to certain features. E.g. downloading the Alpha version of the software.
14	DateTBackupScheduled	datetime	Deprecated. Moved to the supplementalbackups database. Next date and time of supplemental backup for the customer who owns this registration key.
15	BackupPassCode	varchar(32)	Deprecated. Moved to the supplementalbackups database. Pass code for next supplemental backup expected from this customer.

reminderrule
Ehr
Order	Name	Type	Summary
0	ReminderRuleNum	bigint(20)	Primary key.
1	ReminderCriterion	tinyint(4)	Enum:EhrCriterion Problem,Medication,Allergy,Age,Gender,LabResult.
Problem: 0-DiseaseDef. Shows as 'problem' because it needs to be human readable.
Medication: 1-Medication
Allergy: 2-AllergyDef
Age: 3-Age
Gender: 4-Gender
LabResult: 5-LabResult
2	CriterionFK	bigint(20)	Foreign key to disease.DiseaseDefNum, medicationpat.MedicationNum, or allergy.AllergyDefNum. Will be 0 if Age, Gender, or LabResult are the trigger.
3	CriterionValue	varchar(255)	Only used if Age, Gender, or LabResult are the trigger. Examples: "<25"(must include < or >), "Male"/"Female", "INR" (the simple description of the lab test)
4	Message	varchar(255)	Text that will show as the reminder.

repeatcharge
Each row represents one charge that will be added. Usually monthly, but quarterly and annually are allowed.
Order	Name	Type	Summary
0	RepeatChargeNum	bigint(20)	Primary key
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ProcCode	varchar(15)	FK to procedurecode.ProcCode. The code that will be added to the account as a completed procedure.
3	ChargeAmt	double	The amount that will be charged. The amount from the procedurecode will not be used. This way, a repeating charge cannot be accidentally altered.
4	DateStart	date	The date of the first charge if UseBillingCycleDays is not enabled. Charges will always be added on the same day of the frequency start date. If UseBillingCycleDays is enabled, repeat charges will be applied on billing cycle day instead. If more than one frequency cycle goes by without applying repeating charges, then multiple procedures will be added.
5	DateStop	date	The last date on which a charge is allowed. Can be blank (0001-01-01) to represent a perpetual repeating charge.
6	Note	text	Any note for internal use.
7	CopyNoteToProc	tinyint(4)	Indicates that the note should be copied to the corresponding procedure billing note.
8	CreatesClaim	tinyint(4)	Set to true to have a claim automatically created for the patient with the procedure that is attached to this repeating charge.
9	IsEnabled	tinyint(4)	Set to false to disable the repeating charge. This allows patients to have repeating charges in their history that are not active. Used mainly for repeating charges with notes that should not be deleted.
10	UsePrepay	tinyint(4)	Set to true to use prepayments for repeating charges.
11	Npi	text	Stores the NPI of the provider on this repeating charge for Erx. This used to be stored in the Note field but got moved over to its own column in 17.2.
12	ErxAccountId	text	Stores the Erx Account ID on this repeating charge for Erx. This used to be stored in the Note field but got moved over to its own column in 17.2.
13	ProviderName	text	Stores the name of the provider on this repeating charge for Erx. Value is received directly from NewCrop.
14	ChargeAmtAlt	double	HQ Only. An alternate amount to be charged for this RepeatCharge in some cases. Should always default to -1 as -1 will be used as a flag to indicate it has not been set. A value of 0 means ChargeAmtAlt has been intentionally set to 0.
15	UnearnedTypes	varchar(4000)	If UsePrepay is true, when the procedure is created from this repeat charge, it will allocate payments from these unearned types. Stored as a comma separated list of DefNums of Category PaySplitUnearnedType. If empty, then all unearned types will be considered.
16	Frequency	tinyint(4)	Enum:EnumRepeatChargeFrequency 0-Monthly, 1-Quarterly, 2-Annually.
Monthly: 0 - Monthly
Quarterly: 1 - Quarterly
Annually: 2 - Annually

replicationserver
Replication server information. Used for server specific replication settings, manually entered by the user. Each row is one server.
Order	Name	Type	Summary
0	ReplicationServerNum	bigint(20)	Primary key.
1	Descript	text	The description or name of the server. Optional.
2	ServerId	int(10)	Db admin sets this server_id server variable on each replication server. Allows us to know what server each workstation is connected to. In display, it's ordered by this value. Users are always forced to enter a value here.
3	RangeStart	bigint(20)	Deprecated. Only used for Random Primary Keys. The start of the key range for this server. 0 if no value entered yet.
4	RangeEnd	bigint(20)	Deprecated. Only used for Random Primary Keys. The end of the key range for this server. 0 if no value entered yet.
5	AtoZpath	varchar(255)	The AtoZpath for this server. Optional.
6	UpdateBlocked	tinyint(4)	If true, then this server cannot initiate an update. Typical for satellite servers.
7	SlaveMonitor	varchar(255)	Deprecated. Monitoring the status of replication is now monitored by a separate service. See online manual for information on installing the new service. The description or name of the comptuer that will monitor replication for this server.

reqneeded
For Dental Schools. Requirements needed in order to complete course or graduation needs. Copied from def to course so that the ones attached to defs can be freely deleted or edited without affecting any students.
Order	Name	Type	Summary
0	ReqNeededNum	bigint(20)	Primary key.
1	Descript	varchar(255)	.
2	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. Will be 0 if req is for a course def or defining a grad requirement.
3	SchoolClassNum	bigint(20)	FK to schoolclass.SchoolClassNum. Will be 0 if req is for a course def.
4	SchoolCourseDefNum	bigint(20)	FK to schoolcoursedef.SchoolCourseDef. Will be 0 if req is for a course or defining a grad requirement.

reqstudent
For Dental Schools. The purpose of this table changed significantly in version 4.5. This now only stores completed requirements. There can be multiple completed requirements of each ReqNeededNum. No need to synchronize any longer.
Order	Name	Type	Summary
0	ReqStudentNum	bigint(20)	Primary key.
1	ReqNeededNum	bigint(20)	FK to reqneeded.ReqNeededNum.
2	Descript	varchar(255)	.
3	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. Never 0.
4	ProvNum	bigint(20)	FK to provider.ProvNum. The student. Never 0.
5	AptNum	bigint(20)	
6	PatNum	bigint(20)	FK to patient.PatNum
7	InstructorNum	bigint(20)	FK to provider.ProvNum
8	DateCompleted	date	The date that the requirement was completed.
9	ProcNum	bigint(20)	FK to procedure.ProcNum

requiredfield
Each row represents a field that is required to be filled out.
Order	Name	Type	Summary
0	RequiredFieldNum	bigint(20)	Primary key.
1	FieldType	tinyint(4)	Enum:RequiredFieldType . The area of the program that uses this field.
PatientInfo: 0 - Edit Patient Information window and Add Family (FormPatientAddAll) window.
InsPayEdit: 1 - Edit Claim Payment window.
2	FieldName	varchar(50)	Enum:RequiredFieldName
Address:
Address2:
AddressPhoneNotes:
AdmitDate:
AskArriveEarly:
BatchNumber:
BillingType:
Birthdate:
Carrier:
ChartNumber:
CheckDate:
CheckNumber:
City:
Clinic:
CollegeName:
County:
CreditType:
DateFirstVisit:
DateTimeDeceased:
DepositAccountNumber:
DepositDate:
DischargeDate:
EligibilityExceptCode:
EmailAddress:
EmergencyName:
EmergencyPhone:
Employer:
Ethnicity:
FeeSchedule:
FirstName:
Gender:
GenderIdentity:
GradeLevel:
GroupName:
GroupNum:
HomePhone:
InsPayEditClinic:
InsurancePhone:
InsuranceSubscriber:
InsuranceSubscriberID:
Language:
LastName:
PaymentAmount:
PaymentType:
Position:
MedicaidID:
MedicaidState:
MiddleInitial:
MothersMaidenFirstName:
MothersMaidenLastName:
PatientStatus:
PreferConfirmMethod:
PreferContactMethod:
PreferRecallMethod:
PreferredName:
PrimaryProvider:
Race:
ReferredFrom:
ResponsibleParty:
Salutation:
SecondaryProvider:
SexualOrientation:
Site:
SocialSecurityNumber:
State:
StudentStatus:
TextOK:
Title:
TreatmentUrgency:
TrophyFolder:
Ward:
WirelessPhone:
WorkPhone:
Zip:

requiredfieldcondition
When one of these conditions is true, the corresponding requiredfield will be triggered.
Order	Name	Type	Summary
0	RequiredFieldConditionNum	bigint(20)	Primary key.
1	RequiredFieldNum	bigint(20)	FK to requiredfield.RequiredFieldNum.
2	ConditionType	varchar(50)	Enum:RequiredFieldName
Address:
Address2:
AddressPhoneNotes:
AdmitDate:
AskArriveEarly:
BatchNumber:
BillingType:
Birthdate:
Carrier:
ChartNumber:
CheckDate:
CheckNumber:
City:
Clinic:
CollegeName:
County:
CreditType:
DateFirstVisit:
DateTimeDeceased:
DepositAccountNumber:
DepositDate:
DischargeDate:
EligibilityExceptCode:
EmailAddress:
EmergencyName:
EmergencyPhone:
Employer:
Ethnicity:
FeeSchedule:
FirstName:
Gender:
GenderIdentity:
GradeLevel:
GroupName:
GroupNum:
HomePhone:
InsPayEditClinic:
InsurancePhone:
InsuranceSubscriber:
InsuranceSubscriberID:
Language:
LastName:
PaymentAmount:
PaymentType:
Position:
MedicaidID:
MedicaidState:
MiddleInitial:
MothersMaidenFirstName:
MothersMaidenLastName:
PatientStatus:
PreferConfirmMethod:
PreferContactMethod:
PreferRecallMethod:
PreferredName:
PrimaryProvider:
Race:
ReferredFrom:
ResponsibleParty:
Salutation:
SecondaryProvider:
SexualOrientation:
Site:
SocialSecurityNumber:
State:
StudentStatus:
TextOK:
Title:
TreatmentUrgency:
TrophyFolder:
Ward:
WirelessPhone:
WorkPhone:
Zip:
3	Operator	tinyint(4)	Enum:ConditionOperator . The operator that is being applied to the ConditionType.
Equals: 0: =
NotEquals: 1: !=
GreaterThan: 2: >
LessThan: 3: <
GreaterThanOrEqual: 4: >=
LessThanOrEqual: 5: <=
4	ConditionValue	varchar(255)	The value that the condition is being compared against. Could be 18, Fulltime, Male, etc.
5	ConditionRelationship	tinyint(4)	Enum:LogicalOperator 0-None,1-And,2-Or. This field is only used when comparing continuous values such as age or date.
None: 0
And: 1
Or: 2

rxalert
Many-to-many relationship connecting Rx with DiseaseDef, AllergyDef, or Medication. Only one of those links may be specified in a single row; the other two will be 0.
Order	Name	Type	Summary
0	RxAlertNum	bigint(20)	Primary key.
1	RxDefNum	bigint(20)	FK to rxdef.RxDefNum. This alert is to be shown when user attempts to write an Rx for this RxDef.
2	DiseaseDefNum	bigint(20)	FK to diseasedef.DiseaseDefNum. Only if DrugProblem interaction. This is compared against disease.DiseaseDefNum using PatNum. Drug-Problem (they call it Drug-Diagnosis) checking is also performed in NewCrop.
3	AllergyDefNum	bigint(20)	FK to allergydef.AllergyDefNum. Only if DrugAllergy interaction. Compared against allergy.AllergyDefNum using PatNum. Drug-Allergy checking is also perfomed in NewCrop.
4	MedicationNum	bigint(20)	FK to medication.MedicationNum. Only if DrugDrug interaction. This will be compared against medicationpat.MedicationNum using PatNum. Drug-Drug checking is also performed in NewCrop.
5	NotificationMsg	varchar(255)	This is typically blank, so a default message will be displayed by OD. But if this contains a message, then this message will be used instead.
6	IsHighSignificance	tinyint(4)	False by default. Set to true to flag the drug-drug or drug-allergy intervention as high significance.

rxdef
Rx definitions. Can safely delete or alter, because they get copied to the rxPat table, not referenced.
Order	Name	Type	Summary
0	RxDefNum	bigint(20)	Primary key.
1	Drug	varchar(255)	The name of the drug.
2	Sig	varchar(255)	Directions intended for the pharmacist.
3	Disp	varchar(255)	Amount to dispense.
4	Refills	varchar(30)	Number of refills.
5	Notes	varchar(255)	Notes about this drug. Will not be copied to the rxpat.
6	IsControlled	tinyint(4)	Is a controlled substance. This will affect the way it prints.
7	RxCui	bigint(20)	RxNorm Code identifier. Copied down into medicationpat.RxCui (medical order) when a prescription is written.
8	IsProcRequired	tinyint(4)	If true will require procedure be attached to this prescription when printed. Usually true if IsControlled is true.
9	PatientInstruction	text	Directions intended for the patient.

rxnorm
RxNorm created from a zip file.
Order	Name	Type	Summary
0	RxNormNum	bigint(20)	Primary key.
1	RxCui	varchar(255)	RxNorm Concept universal ID. Throughout the program, this is actually used as the Primary Key of this table rather than the RxNormNum.
2	MmslCode	varchar(255)	Multum code. Only used for crosscoding during import/export with electronic Rx program. User cannot see multum codes. Most of the rows in this table do not have an MmslCode and user searches ignore rows with an MmslCode.
3	Description	text	Only used for RxNorms, not Multums.

rxpat
One Rx for one patient. Copied from rxdef rather than linked to it.
Order	Name	Type	Summary
0	RxNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	RxDate	date	Date of Rx.
3	Drug	varchar(255)	Drug name. Example: PenVK 500 mg capsules. Example: Percocet 5/500 tablets.
4	Sig	varchar(255)	Directions intended for the pharmacist. Example: Take 2 tablets twice a day.
5	Disp	varchar(255)	Amount to dispense. Example: 12 (twelve)
6	Refills	varchar(30)	Number of refills. Example: 3. Example: 1 per month.
7	ProvNum	bigint(20)	FK to provider.ProvNum.
8	Notes	varchar(255)	Notes specific to this Rx. Will not show on the printout. For staff use only.
9	PharmacyNum	bigint(20)	FK to pharmacy.PharmacyNum.
10	IsControlled	tinyint(4)	Is a controlled substance. This will affect the way it prints.
11	DateTStamp	timestamp	The last date and time this row was altered. Not user editable.
12	SendStatus	tinyint(4)	Enum:RxSendStatus
Unsent: 0
InElectQueue: 1- This will never be used in production. It was only used for proof of concept when building EHR.
SentElect: 2
Printed: 3
Faxed: 4
CalledIn: 5
GaveScript: 6
Pending: 7
13	RxCui	bigint(20)	Deprecated. RxNorm Code identifier. Was used in FormRxSend for EHR 2011, but FormRxSend has been deleted. No longer in use anywhere. Still exists in db for now.
14	DosageCode	varchar(255)	NCI Pharmaceutical Dosage Form code. Only used with ehr. For example, C48542 is the code for “Tablet dosing unit”. User enters code manually, and it's only used for Rx Send, which will be deprecated with 2014 cert. Guaranteed that nobody actually uses or cares about this field.
15	ErxGuid	varchar(40)	eRx returns this unique identifier to use for electronic Rx. Also set for Open Dental created medications using a different format.
16	IsErxOld	tinyint(4)	True for historic prescriptions which existed prior to version 15.4. The purpose of this column is to keep historic reports accurate.
17	ErxPharmacyInfo	varchar(255)	The pharmacyinfo field contains the pharmacy name as well as other information about the pharmacy, but the information is inconsistent. The purpose of this field is to give the user means to visually verify they have the correct pharmacy selected.
18	IsProcRequired	tinyint(4)	If true will require procedure be attached to this prescription when printed. Usually true if IsControlled is true.
19	ProcNum	bigint(20)	The procedure attached to this prescription when IsProcRequired is true.
20	DaysOfSupply	double	The number of days this prescription is intended to last. Only used when IsProcRequired is true.
21	PatientInstruction	text	Directions intended for the patient.
22	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
23	UserNum	bigint(20)	FK to userod.UserNum. Used to log who is accessing pdmp bridge
24	RxType	tinyint(4)	Enum:RxTypes to check what bridge is being used to access pdmp. Indexed in database
Rx: 0 - Rx, existing entries should default to this
LogicoyAccess: 1 - LogicoyAccess
BambooAccess: 2 -

schedule
One block of time. Either for practice, provider, employee, or blockout.
Order	Name	Type	Summary
0	ScheduleNum	bigint(20)	Primary key.
1	SchedDate	date	Date for this timeblock.
2	StartTime	time	Start time for this timeblock.
3	StopTime	time	Stop time for this timeblock.
4	SchedType	tinyint	Enum:ScheduleType 0=Practice,1=Provider,2=Blockout,3=Employee. Practice is used as a way to indicate holidays and as a way to put a note in for the entire practice for one day. But whenever type is Practice, times will be ignored.
Practice: 0
Provider: 1
Blockout: 2
Employee: 3
WebSchedASAP: 4 - A slot of time that an ASAP appointment can be moved up to.
5	ProvNum	bigint(20)	FK to provider.ProvNum if a provider type.
6	BlockoutType	bigint(20)	FK to definition.DefNum if blockout. eg. HighProduction, RCT Only, Emerg.
7	Note	text	This contains various types of text entered by the user.
8	Status	tinyint	Enum:SchedStatus enumeration 0=Open,1=Override,2=Holiday. All blocks have a status of Open, but user doesn't see the status. The "Override" status is used only by ODHQ in Phone Graph Edit window. Holidays are a special type of practice schedule item which do not have providers attached. Holidays are also used by blockouts. Used to differentiate between Practice SchedType Holidays and Notes.
Open: 0
Override: 1
Holiday: 2
9	EmployeeNum	bigint(20)	FK to employee.EmployeeNum.
10	DateTStamp	timestamp	Last datetime that this row was inserted or updated.
11	ClinicNum	bigint(20)	FK to clinic.ClinicNum if SchedType.Practice (holidays and practice notes) and applies to one clinic (operatories for one clinic). If SchedType.Practice and this applies to all clinics, or if any other SchedType, ClinicNum will be 0. There won't be any scheduleop rows linking this schedule to operatories when the type is SchedType.Practice. Instead, the linkage is implied based on the operatory.ClinicNum and applies to all operatories for the clinic.

scheduledprocess
Order	Name	Type	Summary
0	ScheduledProcessNum	bigint(20)	Primary Key
1	ScheduledAction	varchar(50)	Enum:ScheduledActionEnum
RecallSync: 0
InsVerifyBatch: 1
Statements: 2
2	TimeToRun	datetime	What time of the day it's supposed to run.
3	FrequencyToRun	varchar(50)	Enum:FrequencyToRunEnum
Daily: 0
4	LastRanDateTime	datetime	Date and time when process last ran.

scheduleop
Links one schedule block to one operatory. A schedule block can be linked to one or more operatories. A schedule can also not have any scheduleops. For example the provider schedule.
Order	Name	Type	Summary
0	ScheduleOpNum	bigint(20)	Primary key.
1	ScheduleNum	bigint(20)	FK to schedule.ScheduleNum.
2	OperatoryNum	bigint(20)	FK to operatory.OperatoryNum.

schoolapproval
Dental school instructor approval linked to a student item like a procedure or treatment plan.
Order	Name	Type	Summary
0	SchoolApprovalNum	bigint(20)	Primary key.
1	ProvNum	bigint(20)	FK to provider.ProvNum. The student. Never 0.
2	SignOffStatus	tinyint(4)	The current review status of the item.
3	InstructorNum	bigint(20)	FK to provider.ProvNum. Indicates the instructor who reviewed this item.
4	AptNum	bigint(20)	FK to appointment.AptNum. Indicates the appointment this approval is for. 0 if not applicable.
5	ProcNum	bigint(20)	FK to procedure.ProcNum. Indicates the procedure this approval is for. 0 if not applicable.
6	TreatPlanNum	bigint(20)	FK to treatplan.TreatPlanNum. Indicates the treatment plan this approval is for. 0 if not applicable.
7	PerioExamNum	bigint(20)	FK to perioexam.PerioExamNum. Indicates the perio exam this approval is for. 0 if not applicable.
8	AllergyNum	bigint(20)	FK to allergy.AllergyNum. Indicates the allergy this approval is for. 0 if not applicable.
9	DiseaseNum	bigint(20)	FK to disease.DiseaseNum. Indicates the disease this approval is for. 0 if not applicable.
10	DocNum	bigint(20)	FK to document.DocNum. Indicates the document this approval is for. 0 if not applicable.
11	MountNum	bigint(20)	FK to mount.MountNum. Indicates the mount this approval is for. 0 if not applicable.
12	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
13	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

schoolclass
Used in dental schools. eg. Dental 2009 or Hygiene 2007.
Order	Name	Type	Summary
0	SchoolClassNum	bigint(20)	Primary key.
1	GradYear	int(11)	The year this class will graduate
2	Descript	varchar(255)	Description of this class. eg Dental or Hygiene

schoolcourse
A scheduled course in dental schools. These are copied from SchoolCourseDef and are linked to a class cohort. Example: OP 732 Operative Dentistry Clinic II.Students are not linked individually to courses. Instead, it is assumed that all students from the specified class are in this course.
Order	Name	Type	Summary
0	SchoolCourseNum	bigint(20)	Primary key.
1	CourseID	varchar(255)	Alphanumeric. Example: PEDO 732.
2	Descript	varchar(255)	Full course name. Example: Pediatric Dentistry Clinic II
3	DateStart	date	Start date of the effective schedule. Required for default schedules
4	DateEnd	date	End date of the effective schedule. Required for default schedules.
5	SchoolClassNum	bigint(20)	FK to schoolclass.SchoolClassNum. Indicates which class cohort this scheduled course is assigned to. Can be zero for older courses. Use SchoolCourseEnrollees to see the students registered for this course.
6	GradingScaleNum	bigint(20)	FK to gradingscale.GradingScaleNum. Indicates the grading scale for this course. All associated EvaluationDefs must use the same grading scale.

schoolcoursedef
A course definition used in dental schools. These predefined courses are added from the course directory and can be copied when scheduling actual courses for a class cohort. Example OP 732 Operative Dentistry Clinic II. Can be deleted without affecting scheduled SchoolCourse entries.
Order	Name	Type	Summary
0	SchoolCourseDefNum	bigint(20)	Primary key.
1	CourseID	varchar(255)	Alphanumeric. Example: PEDO 732.
2	Descript	varchar(255)	Full course name. Example: Pediatric Dentistry Clinic II
3	GradingScaleNum	bigint(20)	FK to gradingscale.GradingScaleNum. Indicates the grading scale for this course. All associated EvaluationDefs must use the same grading scale.

schoolcourseenrollee
Represents a student’s enrollment in a specific school course, including their current overall grade for the course.
Order	Name	Type	Summary
0	SchoolCourseEnrolleeNum	bigint(20)	Primary key.
1	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. Identifies the course in which the student is enrolled.
2	StudentNum	bigint(20)	FK to provider.ProvNum. Identifies the student.
3	GradeNumber	float	-1 by default, indicating that no grade number is assigned when there are no corresponding evaluations. The student’s calculated overall grade for this course. Computed by averaging all evaluations for the course and student. This value is then used to determine the displayed grade. For pick list grading scales, the closest scale item is chosen. For percentage and weighted grading, the number itself is shown as a percentage. There is no weight yet for different evaluations, so the automatically calculated course grades will treat all evaluations with equal weight.
4	GradeOverride	float	-1 by default, indicating no grade override. An optional override grade manually entered by an instructor. If populated, this value takes precedence over GradeNumber for the overall grade for this course.

schoolcourseinstructor
Links an instructor to a specific school course. A course can have multiple instructors, and an instructor can teach multiple courses.
Order	Name	Type	Summary
0	SchoolCourseInstructorNum	bigint(20)	Primary key.
1	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. Identifies the course this instructor is assigned to.
2	InstructorNum	bigint(20)	FK to provider.ProvNum. Identifies the instructor assigned to this course.

schoolcoursesched
Represents a single classroom session on a specific date and time for a school course's default schedule or a schedule override. Used for both SchoolCourse and SchoolCourseDef. Copied from def when creating course from def. For a typical course, there will be one row per scheduled day of the week, plus any override entries as needed.
Order	Name	Type	Summary
0	SchoolCourseSchedNum	bigint(20)	Primary key.
1	SchoolCourseDefNum	bigint(20)	FK to schoolcoursedef.SchoolCourseDefNum. Indicates the course definition that this schedule applies to. 0 if it's for a schoolcourse.
2	SchoolCourseNum	bigint(20)	FK to schoolcourse.SchoolCourseNum. Indicates the course that this schedule applies to. 0 if it's for a schoolcoursedef.
3	TimeStart	time	The time of day the course is scheduled to start. Only allowed to be Zero if this is an IsCanceled row.
4	TimeEnd	time	The time of day the course is scheduled to end. Only allowed to be Zero if this is an IsCanceled row.
5	DayOfTheWeek	tinyint(4)	The day of the week this schedule applies to. 0 is Sunday, 1 is Monday, up to 6 for Saturday. Ignored and not visible if override.
6	DateOverride	date	Date of the override. Used only for SchoolCourse, not SchoolCourseDef.
7	IsOverride	tinyint(4)	True if this entry represents an override to the default schedule. False if it's part of the default schedule. Not used for SchoolCourseDef. Multiple allowed per day.
8	IsCanceled	tinyint(4)	Only used for overrides. True if the course session is canceled on the override date.

screen
Used in public health. This screening table is meant to be general purpose. It is compliant with the popular Basic Screening Survey. It is also designed with minimal foreign keys and can be easily adapted to a tablet PC. This table can be used with only the screengroup table, but is more efficient if provider, school, and county tables are also available.
Order	Name	Type	Summary
0	ScreenNum	bigint(20)	Primary key
1	Gender	tinyint	Enum:PatientGender
Male: 0
Female: 1
Unknown: 2- Required by HIPAA for privacy. Required by ehr to track missing entries. EHR/HL7 known as undifferentiated (UN).
Other: 3
2	RaceOld	tinyint(4)	Enum:PatientRaceOld and ethnicity.
Unknown: 0
Multiracial: 1
HispanicLatino: 2
AfricanAmerican: 3
White: 4
HawaiiOrPacIsland: 5
AmericanIndian: 6
Asian: 7
Other: 8
Aboriginal: 9
BlackHispanic: 10 - Required by EHR.
3	GradeLevel	tinyint(4)	Enum:PatientGrade
Unknown: 0
First: 1
Second: 2
Third: 3
Fourth: 4
Fifth: 5
Sixth: 6
Seventh: 7
Eighth: 8
Ninth: 9
Tenth: 10
Eleventh: 11
Twelfth: 12
PrenatalWIC: 13
PreK: 14
Kindergarten: 15
Other: 16
4	Age	tinyint	Age of patient at the time the screening was done. Faster than recording birthdates.
5	Urgency	tinyint(4)	Enum:TreatmentUrgency
Unknown:
NoProblems:
NeedsCare:
Urgent:
6	HasCaries	tinyint	Enum:YN Set to true if patient has cavities.
Unknown: 0
Yes: 1
No: 2
7	NeedsSealants	tinyint	Enum:YN Set to true if patient needs sealants.
Unknown: 0
Yes: 1
No: 2
8	CariesExperience	tinyint	Enum:YN
Unknown: 0
Yes: 1
No: 2
9	EarlyChildCaries	tinyint	Enum:YN
Unknown: 0
Yes: 1
No: 2
10	ExistingSealants	tinyint	Enum:YN
Unknown: 0
Yes: 1
No: 2
11	MissingAllTeeth	tinyint	Enum:YN
Unknown: 0
Yes: 1
No: 2
12	Birthdate	date	Optional
13	ScreenGroupNum	bigint(20)	FK to screengroup.ScreenGroupNum.
14	ScreenGroupOrder	smallint	The order of this item within its group.
15	Comments	varchar(255)	.
16	ScreenPatNum	bigint(20)	FK to screenpat.ScreenPatNum.
17	SheetNum	bigint(20)	FK to sheet.SheetNum

screengroup
Used in public health. The database table only has 3 columns. There are 5 additional columns in C# that are not in the databae. These extra columns are used in the UI to organize input, and are transferred to the screen table as needed.
Order	Name	Type	Summary
0	ScreenGroupNum	bigint(20)	Primary key
1	Description	varchar(255)	Up to the user.
2	SGDate	date	The date of the screening.
3	ProvName	varchar(255)	Required. Could be the name of the screener and not a provider necessarily.
4	ProvNum	bigint(20)	FK to provider.ProvNum. ProvNAME is always entered, but ProvNum supplements it by letting user select from list. When entering a provNum, the name will be filled in automatically. Can be 0 if the provider is not in the list, but provName is required.
5	PlaceService	tinyint(4)	Enum:PlaceOfService Describes where the screening will take place. Defaults to Zero(Office).
Office: 0. Code 11
PatientsHome: 1. Code 12
InpatHospital: 2. Code 21
OutpatHospital: 3. Code 22
SkilledNursFac: 4. Code 31
CustodialCareFacility: 5. Code 33. In X12, a similar code AdultLivCareFac 35 is mentioned.
OtherLocation: 6. Code 99. We use 11 for office.
MobileUnit: 7. Code 15
School: 8. Code 03
MilitaryTreatFac: 9. Code 26
FederalHealthCenter: 10. Code 50
PublicHealthClinic: 11. Code 71
RuralHealthClinic: 12. Code 72
EmergencyRoomHospital: 13. Code 23
AmbulatorySurgicalCenter: 14. Code 24
TelehealthOutsideHome: 15. Code 02.
TelehealthInHome: 16. Code 10
OutreachSiteOrStreet: 17. Code 27
6	County	varchar(255)	FK to county.CountyName, although it will not crash if key absent.
7	GradeSchool	varchar(255)	FK to site.Description, although it will not crash if key absent.
8	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum

screenpat
This allows users to set up a list of students prior to actually going to the school. It also serves to attach the exam sheet to the screening.
Order	Name	Type	Summary
0	ScreenPatNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	ScreenGroupNum	bigint(20)	FK to screengroup.ScreenGroupNum. Every screening is attached to a group (classroom)
3	SheetNum	bigint(20)	Was never used. Was supposed to be FK to sheetdef.Sheet_DEF_Num, so not even named correctly.
4	PatScreenPerm	tinyint(4)	Enum:PatScreenPerm
Unknown:
Allowed:
NoPermission:
Refused:
Absent:
Behavior:
Other:

securitylog
Stores an ongoing record of database activity for security purposes. User not allowed to edit.
Order	Name	Type	Summary
0	SecurityLogNum	bigint(20)	Primary key.
1	PermType	smallint(6)	Enum:EnumPermType
None: 0
AppointmentsModule: 1
FamilyModule: 2
AccountModule: 3
TPModule: 4
ChartModule: 5
ImagingModule: 6
ManageModule: 7
Setup: 8. Currently covers a wide variety of setup functions.
RxCreate: 9
ProcComplEdit: 10 - DEPRECATED - Uses date restrictions. Covers editing/deleting of Completed, EO, and EC procs. Deleting procs of other statuses are covered by ProcDelete.
ChooseDatabase: 11
Schedules: 12
BlockoutEdit: 13 - There are two kinds of blockouts: those flagged as NS(no sched) or DC(disable cut/copy/paste) and those with no flag. This permission handles the blockouts with no flag, including edit and copy/paste. Logs an audit trail entry when a blockout is added, edited, deleted, cut, copied, pasted, or cleared. See BlockoutsFlagged permission for the other blockouts flagged as NS or DC.
ClaimSentEdit: 14. Uses date restrictions.
PaymentCreate: 15. Uses date restrictions.
PaymentEdit: 16. Uses date restrictions.
AdjustmentCreate: 17
AdjustmentEdit: 18. Uses date restrictions.
UserQuery: 19
StartupSingleUserOld: 20. Not used anymore.
StartupMultiUserOld: 21 Not used anymore.
Reports: 22
ProcComplCreate: 23. Includes setting procedures complete.
SecurityAdmin: 24. At least one user must have this permission.
AppointmentCreate: 25.
AppointmentMove: 26
AppointmentEdit: 27. AppointmentDelete permission required in order to delete appointments.
Backup: 28
TimecardsEditAll: 29
DepositSlips: 30
AccountingEdit: 31. Uses date restrictions.
AccountingCreate: 32. Uses date restrictions.
Accounting: 33
AnesthesiaIntakeMeds: 34
AnesthesiaControlMeds: 35
InsPayCreate: 36
InsPayEdit: 37. Uses date restrictions. Edit Batch Insurance Payment.
TreatPlanEdit: 38. Uses date restrictions.
ReportProdInc: 39. DEPRECATED
TimecardDeleteEntry: 40. Uses date restrictions.
EquipmentDelete: 41. Uses date restrictions. All other equipment functions are covered by .Setup.
SheetEdit: 42. Uses date restrictions. Also used in audit trail to log web form importing.
CommlogEdit: 43. Uses date restrictions.
ImageDelete: 44. Uses date restrictions. Allows deletion of images. SignedImageEdit permission is also needed to delete signed images.
PerioEdit: 45. Uses date restrictions.
ProcEditShowFee: 46. Shows the fee textbox in the proc edit window.
AdjustmentEditZero: 47
EhrEmergencyAccess: 48
ProcDelete: 49. Uses date restrictions. This only applies to non-completed procs. Deletion of completed procs is covered by ProcCompleteStatusEdit.
EhrKeyAdd: 50 - Only used at OD HQ. No user interface.
ProviderEdit: 51- Allows user to edit all providers. This is not fine-grained enough for extremely large organizations such as dental schools, so other permissions are being added as well.
EcwAppointmentRevise: 52
ProcedureNoteFull: 53
ReferralAdd: 54
InsPlanChangeSubsc: 55
RefAttachAdd: 56
RefAttachDelete: 57
CarrierCreate: 58
GraphicalReports: 59
AutoNoteQuickNoteEdit: 60
EquipmentSetup: 61
Billing: 62
ProblemDefEdit: 63
ProcFeeEdit: 64- There is no user interface in the security window for this permission. It is only used for tracking.
InsPlanChangeCarrierName: 65- There is no user interface in the security window for this permission. It is only used for tracking. Only tracks changes to carriername, not any other carrier info.
TaskNoteEdit: 66- (Was named TaskEdit prior to version 14.2.39) When editing an existing task: delete the task, edit original description, or double click on note rows. Even if you don't have the permission, you can still edit your own task description (but not the notes) as long as it's in your inbox and as long as nobody but you has added any notes.
WikiListSetup: 67- Add or delete lists and list columns..
Copy: 68- There is no user interface in the security window for this permission. It is only used for tracking. Tracks copying of patient information. Required by EHR.
Printing: 69- There is no user interface in the security window for this permission. It is only used for tracking. Tracks printing of patient information. Required by EHR.
MedicalInfoViewed: 70- There is no user interface in the security window for this permission. It is only used for tracking. Tracks viewing of patient medical information.
PatProblemListEdit: 71- Tracks creation and editing of patient problems.
PatMedicationListEdit: 72- Tracks creation and edting of patient medications.
PatAllergyListEdit: 73- Tracks creation and editing of patient allergies.
PatFamilyHealthEdit: 74- There is no user interface in the security window for this permission. It is only used for tracking. Tracks creation and editing of patient family health history.
PatientPortal: 75- There is no user interface in the security window for this permission. It is only used for tracking. Patient Portal access of patient information. Required by EHR.
RxEdit: 76
SchoolAdminStudentEdit: 77- Assign this permission to a staff person who will administer setting up and editing Dental School Students in the system.
SchoolAdminInstructorEdit: 78- Assign this permission to a staff person who will administer setting up and editing Dental School Instructors in the system.
OrthoChartEditFull: 79- Uses date restrictions. Has a unique audit trail so that users can track specific ortho chart edits.
PatientFieldEdit: 80- There is no user interface in the security window for this permission. It is only used for tracking. Mainly used for ortho clinics.
SchoolAdminAcesss: 81- Assign this permission to a staff member who needs full access to instructor and student records. Grants the ability to view anything they can view and perform any action on their behalf.
TreatPlanDiscountEdit: 82- There is no user interface in the security window for this permission. It is only used for tracking.
UserLogOnOff: 83- There is no user interface in the security window for this permission. It is only used for tracking.
TaskEdit: 84- Allows user to edit other users' tasks.
EmailSend: 85- Allows user to send unsecured email
WebMailSend: 86- Allows user to send webmail
UserQueryAdmin: 87- Allows user to run, edit, and write non-released queries.
InsPlanChangeAssign: 88- Security permission for assignment of benefits.
ImageEdit: 89- Uses date restrictions. Allows user to flip, rotate, resize, and crop image. Also allows editing of details on the "Item Info" window. SignedImageEdit permission is also needed to edit signed images.
EhrMeasureEventEdit: 90- Allows editing of all measure events. Also used to track changes made to events.
EServicesSetup: 91- Allows users to edit settings in the eServices Setup window. Also causes the Listener Service monitor thread to start upon logging in.
FeeSchedEdit: 92- Allows users to edit Fee Schedules throughout the program. Logs editing of fee schedule properties.
ProviderFeeEdit: 93- Allows user to edit and delete provider specific fees overrides.
PatientMerge: 94- Allows user to merge patients.
ClaimHistoryEdit: 95- Only used in Claim History Status Edit
AppointmentCompleteEdit: 96- Allows user to edit a completed appointment. AppointmentCompleteDelete permission required in order to delete completed appointments.
WebMailDelete: 97- Audit trail for deleting webmail messages. There is no user interface in the security window for this permission.
RequiredFields: 98- Audit trail for saving a patient with required fields missing. There is no user interface in the security window for this permission.
ReferralMerge: 99- Allows user to merge referrals.
ProcEdit: 100- There is no user interface in the security window for this permission. It is only used for tracking. Currently only used for tracking automatically changing the IsCpoe flag on procedures. Can be enhanced to do more in the future. There is only one place where we could have automatically changed IsCpoe without a corresponding log of a different permission. That place is in the OnClosing of the Procedure Edit window. We update this flag even when the user Cancels out of it.
ProviderMerge: 101- Allows user to use the provider merge tool.
MedicationMerge: 102- Allows user to use the medication merge tool.
AccountProcsQuickAdd: 103- Allow users to use the Quick Add tool in the Account module.
ClaimSend: 104- Allow users to send claims.
TaskListCreate: 105- Allow users to create new task lists.
PatientCreate: 106 - Audit when a new patient is added.
GraphicalReportSetup: 107- Allows changing the settings for graphical repots.
PatientEdit: 108 - Audit when a patient is edited and restrict editing patients.
InsPlanCreate: 109 - Audit when an insurance plan is created. Currently only used in X12 834 insurance plan import.
InsPlanEdit: 110 - Audit when an insurance plan is edited. Currently only used in X12 834 insurance plan import.
InsPlanCreateSub: 111 - InsSub Created. Currently only used in X12 834 insurance plan import and in API.
InsPlanEditSub: 112 - Audit when an insurance subscriber is edited. Currently only used in X12 834 insurance plan import.
InsPlanAddPat: 113 - Audit when a patient is added to an insurance plan. Currently only used in X12 834 insurance plan import.
InsPlanDropPat: 114 - Audit when a patient is dropped from an insurance plan. Currently only used in X12 834 insurance plan import.
InsPlanVerifyList: 115 - Allows users to be assigned Insurance Verifications.
SplitCreatePastLockDate: 116 - Allows users to bypass the global lock date to add paysplits.
ProcComplEditLimited: 117 - DEPRECATED - Uses date restrictions. Covers editing some fields of completed procs.
ClaimDelete: 118 - Uses date restrictions based on the SecDateEntry field as the claim date. Covers deleting a claim of any status (Sent, Waiting to Send, Received, etc).
InsWriteOffEdit: 119 - Covers editing the Write-off and Write-off Override fields for claimprocs. Prevents the user from creating a claimproc to prevent subversion of an existing write-off. Prevents the user from deleting a claimproc as well, since otherwise deleting one outside the date range and creating a new one would subvert the date/days restriction. Uses date/days restriction based on the attached proc.DateEntryC; unless it's a total payment, then uses claimproc.SecDateEntry.Applies to all plan types (i.e. PPO, Category%, Capitation, etc).
ApptConfirmStatusEdit: 120 - Allows users to change appointment confirmation status.
GraphicsRemoteEdit: 121 - Audit trail for when users change graphical settings for another workstation in FormGraphics.cs.
AuditTrail: 122 - Audit Trail (Separated from SecurityAdmin permission)
TreatPlanPresenterEdit: 123 - Allows the user to change the presenter on a treatment plan.
ProviderAlphabetize: 124 - Allows users to use the Alphabetize Provider button from FormProviderSetup to permanently re-order providers.
ClaimProcReceivedEdit: 125 - Allows editing of claimprocs that are marked as received status.
StatementPatNumMismatch: 126 - Used to diagnose an error in statement creation. Audit Trail Permission Only
MobileWeb: 127 - User has access to ODTouch.
PatPlanCreate: 128 - For logging purposes only. Used when PatPlans are created and not otherwise logged.
PatPriProvEdit: 129 - Allows the user to change a patient's primary provider, with audit trail logging.
ReferralEdit: 130
PatientBillingEdit: 131 - Allows users to change a patient's billing type.
ReportProdIncAllProviders: 132 - Allows viewing annual prod inc of all providers instead of just a single provider.
ReportDaily: 133 - Allows running daily reports. DEPRECATED.
ReportDailyAllProviders: 134 - Allows viewing daily prod inc of all providers instead of just a single provider
PatientApptRestrict: 135 - Allows user to change the appointment schedule flag.
SheetDelete: 136 - Allows deleting sheets when they're associated to patients.
UpdateCustomTracking: 137 - Allows updating custom tracking on claims.
GraphicsEdit: 138 - Allows people to set graphics option for the workstation and other computers.
InsPlanOrthoEdit: 139 - Allows user to change the fields within the Ortho tab of the Ins Plan Edit window.
ClaimProcClaimAttachedProvEdit: 140 - Allows user to change the provider on claimproc when claimproc is attached to a claim.
InsPlanMerge: 141 - Audit when insurance plans are merged.
InsCarrierCombine: 142 - Allows user to combine carriers.
PopupEdit: 143 - Allows user to edit popups. A user without this permission will still be able to edit their own popups.
InsPlanPickListExisting: 144 - Allows user to select new insplan from list prior to dropping current insplan associated with a patplan.
OrthoChartEditUser: 145 - Allows user to edit their own signed ortho charts even if they don't have full permission.
ProcedureNoteUser: 146 - Allows user to edit procedure notes that they created themselves if they don't have full permission.
GroupNoteEditSigned: 147 - Allows user to edit group notes signed by other users. If a user does not have this permission, they can still edit group notes that they themselves have signed.
WikiAdmin: 148 - Allows user to lock and unlock wiki pages. Also allows the user to edit locked wiki pages.
PayPlanEdit: 149 - Allows user to create, edit, close, and delete payment plans.
ClaimEdit: 150 - Used for logging when a claim is created, cancelled, or saved.
CommandQuery: 151- Allows user to run command queries. Command queries are any non-SELECT queries for any non-temporary table.
ReplicationSetup: 152 - Gives user access to the replication setup window.
PreAuthSentEdit: 153 - Allows user to edit and delete sent and received pre-auths. Uses date restriction.
LogFeeEdit: 154 - Edit fees (for logging only). Security log entry for this points to feeNum instead of CodeNum.
LogSubscriberEdit: 155 - Log ClaimProcEdit
RecallEdit: 156 - Logs changes to recalls, recalltypes, and recaltriggers.
ProcCodeEdit: 157 - Allows users with this permission the ability to edit procedure codes. Users with the Setup permission have this by default. Logs changes made to individual proc codes (excluding fee changes) including when run from proc code tools.
AddNewUser: 158 - Allows users with this permission the ability to add new users. Security admins have this by default.
ClaimView: 159 - Allows users with this permission the ability to view claims.
RepeatChargeTool: 160 - Allows users to run the Repeat Charge Tool.
DiscountPlanAddDrop: 161 - Logs when a discount plan is added or dropped from a patient.
TreatPlanSign: 162 - Allows users with this permission the ability to sign treatment plans.
ProcExistingEdit: 163 - Allows users with this permission to edit an existing EO or EC procedure.
UnrestrictedSearch: 164 - Allows users to search for patients in all clinics even when they are restricted to clinics. Also allows user to reassign patient clinic.
ArchivedPatientEdit: 165 - Allows users to edit patient information for archived patients. This really only stops editing inside Patient Edit window. Also see ArchivedPatientSelect. Blocking user from patient selection prevents changes to all the other tables.
CommlogPersistent: 166 - HQ only. Must access from dropdown menu next to commlog button. Only for new commlog. Originally, this was written to allow commlogs to reuse a single persistent non-modal window. In about 2023, we accidentally introduced a bug that made it not reuse the original window. So now, it's multiple non-modal windows. We like the change, so we're keeping it.
VerifyPhoneOwnership: 167 - Logs when a phone number has had its ownership verified. For OD HQ only.
SalesTaxAdjEdit: 168 - HQ only. Allows users to make changes to Sales Tax type adjustments.
InsuranceVerification: 169 - Allows user to set last verified dates for insurance benefits. Also allows access to FormInsVerificationList.
CreditCardMove: 170 - Logs when a credit card is moved from one patient to another. Makes a log for both patients. Audit Trail Permission Only.
AgingRan: 171 - Logs when aging is being ran and from where.
HeadmasterSetup: 172 - HQ only. Allows user to add, edit, and delete Headmaster services and devices.
DashboardWidget: 173 - Allows user to view a specific Dashboard Widget.
NewClaimsProcNotBilled: 174 - Prevent users from creating bulk claims from the Procs Not Billed Report if past the lock date.
PatientPortalLogin: 175 - Logging into patient portal. Used for audit trail only.
FAQEdit: 176 - Allows user to create and edit FAQ objects shown by the help button(?).
FeatureRequestEdit: 177 - HQ only. Alows user to edit feature request.
TaskReminderPopup: 178- Logs when a reminder task is popped up. Used for audit trail only.
SupplementalBackup: 179 - Logs when changes are made to supplemental backup settings inside the FormBackup window.
WebSchedRecallManualSend: 180 - Logs when a user sends a Web Sched Recall through the Recall List. Used for audit trail only
PatientSSNView: 181 - Allows the user to unmask patient SSN for temporary viewing. Logs any unmasks in the audit trail
PatientDOBView: 182 - Allows the user to unmask patient DOB for temporary viewing. Logs any unmasks in the audit trail
FamAgingTruncate: 183 - Logs when the family aging table has been truncated. For audit trails only.
DiscountPlanMerge: 184 - Logs when discount plans are merged. For audit trails only.
ProcCompleteStatusEdit: 185 - Uses date restrictions. Allows user to change status of a completed procedure, or delete compeleted procedure
ProcCompleteAddAdj: 186 - Allows user to add an adjustment to a procedure (date locked)
ProcCompleteEditMisc: 187 - Misc Edit that includes "Do Not Bill Ins" and "Hide Graphics" (date locked)
ProcCompleteNote: 188 - Edit the note of a completed procedure
ProcCompleteEdit: 189 - Edit main information of a procedure that is not already covered by the other permissions. Is not all inclusive.
ProtectedLeaveAdjustmentEdit: 190 - User can create, edit, and delete time card adjustments for protected leave on their time card of the current pay period. Users that also have the Edit All Time Cards permission, have this permission for all time cards.
TimeAdjustEdit: 191 - Logs when a time card adjustment is created, edited, or deleted.
QueryMonitor: 192 - Permission for users to monitor queries
CommlogCreate: 193 - Permission for users to create commlogs.
WebFormAccess: 194 - Permission for users to modify and discard webforms
CloseOtherSessions: 195 - Close other sessions of Open Dental Cloud
RepeatChargeCreate: 196 - Permission for Repeating Charge creation.
RepeatChargeUpdate: 197 - Permission for Repeating Charge update.
RepeatChargeDelete: 198 - Permission for Repeating Charge deletion.
Zoom: 199 - User can open the zoom window and edit zoom level. Used to block remote application users who all share the same computer.
FormAdded: 200 - Permission for forms added to eclipboard mobile check in.
ImageExport: 201. Uses date restrictions.
ImageCreate: 202. Permission to Scan, Import, and Create Images.
CertificationEmployee: 203 - Permission to update Employee Certifications.
CertificationSetup: 204 - Permission to set up Certifications.
EmployerCreate: 205 - Permission to create Employers.
AllowLoginFromAnyLocation: 206 - Permission to allow users to login to ODCloud from any IP Address.
LogDoseSpotMedicationNoteEdit: 207 - Logging only. Creates an entry if a medicationpat.PatNote needs to be truncated before sending to DoseSpot.
PayPlanChargeDateEdit: 208 - Allows user to edit a payment plan charge date that has an APR.
DiscountPlanAdd: 209 - Logs when discount plans are added. For audit trails only.
DiscountPlanEdit: 210 - Logs when discount plans are edited. For audit trails only.
AllowFeeEditWhileReceivingClaim: 211 - Permission to allow users without FeeSchedEdit permission to update fee schedule while receiving claims.
ManageHighSecurityProgProperties: 212 - Permission for managing high security program properties.
CreditCardEdit: 213 - Logs when a patient's credit card is edited.
MedicationDefEdit: 214 - Allows user to edit medication definitions.
AllergyDefEdit: 215 - Allows user to edit allergy definitions.
Advertising: 216 - Allows user to setup and use Advertising features like Postcards.
TextMessageView: 217 - Allows user to view text messages.
TextMessageSend: 218 - Allows uer to send text messages.
RxMerge: 219 - Allows user to merge prescriptions.
DefEdit: 220 - Allows user to add or update Definitions.
UpdateInstall: 221 - Allows user to install Open Dental updates.
AdjustmentTypeDeny: 222 - Denies users access to specific adjustment types. Special type of permission where having this permission actually denies users access. If a usergroup has an entry for this permission, then they do not have access to the adjustment type with the defnum that is stored in grouppermission.FKey. Pattern approved by Jordan.
StatementCSV: 223 - Allows user to export statements as CSV files.
CarrierEdit: 224 - Allows users to edit carriers.
ApiSubscription: 225 - Logs when API subscriptions are added or deleted. For audit trails only.
SecurityGlobal: 226 - Logs changes to global lock date. For audit trails only.
TaskDelete: 228 - Allows user to delete tasks.
SetupWizard: 229 - Allows user to use setup wizard.
ShowFeatures: 230 - Allows user to use show features.
PrinterSetup: 231 - Allows user to setup printer.
ProviderAdd: 232 - Allows user to add provider.
ClinicEdit: 233 - Allows user to edit clinic.
ApiAccountEdit: 234 - Allows the editing of customer accounts for the ODApi via the BCM.
RegistrationKeyCreate: 235 - Logs when registration keys are created. For audit trails only.
RegistrationKeyEdit: 236 - Logs when registration keys are edited. For audit trails only.
AppointmentDelete: 237 - Allows user to delete appointments.
AppointmentCompleteDelete: 238 - Allows user to delete completed appointments.
AppointmentTypeEdit: 239 - Logs when Appointment Types are edited. For audit trails only.
TextingAccountEdit: 240 - Only used at OD HQ. Allows users to make high level changes in regards to texting.
WebChatEdit: 241 - Logs when web chat sessions are edited. For audit trails only.
SupplierEdit: 242 - Allows users to access FormSuppliers
SupplyPurchases: 243 - Logs when any supply purchases are created, placed, or deleted.
PreferenceEditBroadcastMonitor: 244 - Only used at OD HQ. Ability to edit table rows via Broadcast Monitor.
AppointmentResize: 245 - Allows users to resize appointments.
CreditCardTerminal: 246 - Logs when a user pays with a credit card. For Audit Trails only.
ViewAppointmentAuditTrail: 247 - Only for viewing the audit trail in FormEditAppointment
PayPlanChargeEdit: 248 - Logs when a user edits a payment plan charge.
ArchivedPatientSelect: 249 - Also see ArchivedPatientEdit. Blocking user from patient selection prevents changes to all the other tables besides the patient table. It's more rigorous.
CloudCustomerEdit: 250 - Only used at OD HQ. Ability to edit Cloud tab info via Broadcast Monitor.
ChanSpy: 251 - Only used at OD HQ. Ability to listen to live calls.
ClaimProcFieldsBilledToInsEdit: 252 - Ability to edit Fee Billed to Insurance or Code Sent to Insurance in FormClaimProc, whether new or existing.
AllergyMerge: 253 - Allow users to merge allergies.
AiChatSession: 254 - Only used at OD HQ. Ability to open the AI chat window.
BadgeIdEdit: 255 - Allow users to edit BadgeIds in the userod table.
ChildDaycareEdit: 256 - Internal Child Daycare only. Allow users to make changes to the daycare. Only used at HQ.
PerioEditCopy: 257 - Allow users to copy perio charts in the Perio Chart window.
LicenseAccept: 258 - For audit trail only. Logs when a license is accepted by a user.
EFormEdit: 259 - Uses date restrictions but no global lock date. Also used in audit trail to log importing.
EFormDelete: 260 - Allows deleting eForms when they're attached to patients. No date restrictions.
MobileNotification: 261 - Used for logging only. Can be used to log whenever mobile notifications are inserted into the database.
ChartViewsEdit: 262 - Allows users to move chart views up and down, and add new chart views
SuperFamilyDisband: 263 - Allows disbanding of Super Families.
ImageSignatureCreate: 264 - Allows creation of note and signature for images without a signature.
SignedImageEdit: 265 - Allows editing and deletion of note and signature for images with a signature. Allows users with the ImageEdit permission to edit signed images. Allows users with the ImageDelete permission to delete signed images.
BlockoutsFlagged: 266 - There are two kinds of blockouts: those flagged as NS(no sched) or DC(disable cut/copy/paste) and those with no flag. This permission handles all the flagged blockouts, including add, edit, copy/paste, and delete. Logs an audit trail entry when a flagged blockout is added, edited, deleted, cut, copied, pasted, or cleared. See Blockouts permission for the other unflagged blockouts.
PayPlanUnlock: 267 - Payment plans have a 'Locked' checkbox. This permission allows the user to uncheck that box which will unlock the payment plan. Users without this permission will not be able to unlock a payment plan.
SendAlertsFromHQ: 268 - Allows sending notifications from HQ to customers. Only used at HQ.
TextAllEmployees: 269 - Only used at OD HQ. Ability to send mass texts to all current employees.
ProcTPEditFee: 270 - Allows editing the fee of a treatment planned procedure.
EFormImport: 271 - Only used to make log entries.
BlockoutAdd: 272 - This permission handles adding blockouts with no flag.
BlockoutDelete: 273 - This permission handles deleting blockouts with no flag.
PhoneExtension: 274 - Only used at HQ to make audit trail entries when a change is made to a row in the Phone table.
2	UserNum	bigint(20)	FK to userod.UserNum
3	LogDateTime	datetime	The date and time of the entry. It's value is set when inserting and can never change. Even if a user changes the date on their computer, this remains accurate because it uses server time.
4	LogText	text	The description of exactly what was done. Varies by permission type.
5	PatNum	bigint(20)	FK to patient.PatNum. Can be 0 if not applicable.
6	CompName	varchar(255)	.
7	FKey	bigint(20)	A foreign key to a table associated with the PermType. 0 indicates not in use. This is typically used for objects that have specific audit trails so that users can see all audit entries related to a particular object. Every permission using FKey should be included and implmented in the CrudAuditPerms enum so that securitylog FKeys are note orphaned. Additonaly, the tabletype will to have the [CrudTable(CrudAuditPerms=CrudAuditPerm._____] added with the new CrudAuditPerm you created. For the patient portal, it is used to indicate logs created on behalf of other patients. It's uses include: AptNum with PermType AppointmentCreate, AppointmentEdit, or AppointmentMove tracks all appointment logs for a particular appointment. CodeNum with PermType ProcFeeEdit currently only tracks fee changes. PatNum with PermType PatientPortal represents an entry that a patient made on behalf of another patient. The PatNum column will represent the patient who is taking the action. PlanNum with PermType InsPlanChangeCarrierName tracks carrier name changes.
8	LogSource	tinyint(4)	Enum:LogSources None, WebSched, InsPlanImport834, FHIR, PatientPortal.
None: 0 - Open Dental and unknown entities.
WebSched: 1 - GWT Web Sched application Recall version.
InsPlanImport834: 2 - X12 834 Insurance Plan Import from the Manage Module.
HL7: 3 - HL7 is an automated process which the user may not be aware of.
DBM: 4 - Database maintenance. This process creates patients which are known to be missing, but the user may not be aware that the fix involves patient recreation.
FHIR: 5 - FHIR is an automated process which the user may not be aware of.
PatientPortal: 6 - Patient Portal application.
WebSchedNewPatAppt: 7 - GWT Web Sched application New Patient Appointment version
AutoConfirmations: 8 - Automated eConfirmation and eReminders
Diagnostic: 9 - Open Dental messages created for debugging and diagnostic purposes. For example, to diagnose an unhandled exception or unexpected behavior that is otherwise too hard to diagnose.
MobileWeb: 10 - Mobile Web application.
CanadaEobAutoImport: 11 - When retrieving reports in the background of FormOpenDental
WebSchedASAP: 12 - Web Sched application for moving ASAP appointments.
OpenDentalService: 13 - OpenDentalService.
BroadcastMonitor: 14 - Broadcast Monitor.
AutoLogOff: 15 - Automatic log off from main form. Used to track when auto log off needs to kill the program to force close open forms which are blocked or slow to respond.
ODMobile: 16 - ODMobile App.
TextMessaging: 17 - Open Dental text messaging.
CareCredit: 18 - CareCredit.
WebSchedExistingPatient: 19 - GWT Web Sched application Existing Patient Appointmention version
eRx: 20 - eRx
SignupPortal: 21 - SignupPortal
EmployerImport834: 22 - X12 834 Employer Import from the Manage Module.
API: 23 - The non-FHIR API.
ClaimReceiveAutomatic: 24 - Indicates that a claim was automatically received.
PaymentPortal: 25 - Indicates that a payment was made from the Payment Portal.
9	DefNum	bigint(20)	Not used.
10	DefNumError	bigint(20)	Not used.
11	DateTPrevious	datetime	Used to store the previous DateTStamp or SecDateTEdit of the object FKey refers to.

securityloghash
Stores hashes of audit logs for detecting alteration. User not allowed to edit.
Order	Name	Type	Summary
0	SecurityLogHashNum	bigint(20)	Primary key.
1	SecurityLogNum	bigint(20)	FK to securitylog.SecurityLogNum.
2	LogHash	varchar(255)	The SHA-256 hash of PermType, UserNum, LogDateTime, LogText, and PatNum, all concatenated together. This hash has length of 32 bytes encoded as base64. Used to detect if the entry has been altered outside of Open Dental.

sequencecounter
This table is used when you need the "last" of some other table row. We can't use a datetime column to get the "last" one because those are only accurate to one second. This means you would need to choose between sometimes missing an entry (a boundary gap) and always getting duplicates that you would need to track and deduplicate on the client end. Most db engineers use the PK to solve this problem, but since we allow random PKs, this also won't work. This table is the solution. It has only one row for each other table where you are trying to solve this problem. Document in this file each time you add a row.
Order	Name	Type	Summary
0	CounterNum	bigint(20)	Primary key.
1	CounterName	varchar(255)	This must be unique, typically just the name of the table you are using it for. Example: chatmsg.
2	CounterVal	bigint(20)	Just the number of the last item in the other table.

sessiontoken
Stores the session token for when a user has logged into something.
Order	Name	Type	Summary
0	SessionTokenNum	bigint(20)	Primary key.
1	SessionTokenHash	varchar(255)	The hash of the token. Hashed using SHA3_512 without a salt.
2	Expiration	datetime	The datetime when this token will expire.
3	TokenType	tinyint(4)	Enum:SessionTokenType The type of token this is.
Undefined: 0 - Should not be used in the database.
PatientPortal: 1 - The patient has logged in with a username and password.
MobileWeb: 2 - The OD user has logged in with a username and password.
ODHQ: 3 - This token is for an OD HQ service that has authenticated to us.
PatientPortalVerifyUser: 4 - The patient verified him or herself with just a name and birthdate.
4	FKey	bigint(20)	The FKey this token is for. For Patient Portal tokens, this is patient.PatNum. For Mobile Web tokens, this is userod.UserNum.

sheet
One sheet for one patient. A better name might be Form, but that name is not unique enough and has already been used by MS. Sheets allow customized layout for things like postcards and lab slips. They also support data that the user fills out for things like medical histories.
Order	Name	Type	Summary
0	SheetNum	bigint(20)	Primary key.
1	SheetType	int(11)	Enum:SheetTypeEnum
LabelPatient: 0-Requires SheetParameter for PatNum. Does not get saved to db.
LabelCarrier: 1-Requires SheetParameter for CarrierNum. Does not get saved to db.
LabelReferral: 2-Requires SheetParameter for ReferralNum. Does not get saved to db.
ReferralSlip: 3-Requires SheetParameters for PatNum,ReferralNum.
LabelAppointment: 4-Requires SheetParameter for AptNum. Does not get saved to db.
Rx: 5-Requires SheetParameter for RxNum.
Consent: 6-Requires SheetParameter for PatNum.
PatientLetter: 7-Requires SheetParameter for PatNum.
ReferralLetter: 8-Requires SheetParameters for PatNum,ReferralNum.
PatientForm: 9-Requires SheetParameter for PatNum.
RoutingSlip: 10-Requires SheetParameter for AptNum. Does not get saved to db.
MedicalHistory: 11-Requires SheetParameter for PatNum.
LabSlip: 12-Requires SheetParameter for PatNum, LabCaseNum.
ExamSheet: 13-Requires SheetParameter for PatNum.
DepositSlip: 14-Requires SheetParameter for DepositNum.
Statement: 15-Requires SheetParameter for PatNum.
MedLabResults: 16-Requires SheetParameters for PatNum,MedLab,MedLabResult.
TreatmentPlan: 17-Requires SheetParameters for PatNum,TreatmentPlan.
Screening: 18-Requires SheetParameter for ScreenNum. Optional SheetParameter for PatNum if screening is associated to a patient.
PaymentPlan: 19-Used for Payment Plans to Sheets.
RxMulti: 20-Requires SheetParameters for ListRxSheet and ListRxNums.
ERA: 21
ERAGridHeader: 22
RxInstruction: 23
PatientDashboard: 24-Deprecated. No longer needed when change was made to only display one Patient Dashboard at a time. Defines the layout of a patient specific dashboard sheet. Not directly user editable. Each sheetfielddef linked to this sheet type further links a PatientDashboardWidget type sheet to this PatientDashboard sheet, allowing users to place various PatientDashboardWidgets on their personal PatientDashboard.
PatientDashboardWidget: 25-Defines the layout and elements of a Patient Dashboard. Editable from Dashboard Setup with Setup permissions.
ChartModule: 26
None: 27-Not designed to be saved to the db. Useful when needing a "none" or "all" default option for UI.
Check: 28-For printing checks
2	PatNum	bigint(20)	FK to patient.PatNum. A saved sheet is always attached to a patient (except deposit slip). There are a few sheets that are so minor that they don't get saved, such as a Carrier label.
3	DateTimeSheet	datetime	The date and time of the sheet as it will be displayed in the commlog. Updated when the patient fills out and submits the sheet via eClipboard.
4	FontSize	float	The default fontSize for the sheet. The actual font must still be saved with each sheetField.
5	FontName	varchar(255)	The default fontName for the sheet. The actual font must still be saved with each sheetField.
6	Width	int(11)	Width of each page in the sheet in pixels, 100 pixels per inch.
7	Height	int(11)	Height of each page in the sheet in pixels, 100 pixels per inch.
8	IsLandscape	tinyint(4)	.
9	InternalNote	text	An internal note for the use of the office staff regarding the sheet. Not to be printed on the sheet in any way.
10	Description	varchar(255)	Copied from the SheetDef description.
11	ShowInTerminal	tinyint(4)	Examples: 1, 2, etc. The order that this sheet will show in the Kiosk queue, or zero if not set. Also determines if it will show in eClipboard in addition to any eClipboardSheetDef. For eClipboard, this is just treated like a boolean and that actual order is ignored.
12	IsWebForm	tinyint(4)	True if this sheet was downloaded from the webforms service. EForms uses Status field instead.
13	IsMultiPage	tinyint(4)	Forces old single page behavior, ignoring page breaks.
14	IsDeleted	tinyint(4)	Indicates whether or not this sheet has been marked deleted.
15	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum. The SheetDef that was used to create this sheet. Will be 0 if an internal sheet or if the sheet was created before 17.2. Can be 0 for sheets that were created from web forms that were associated to web form sheet defs missing this value at HQ. The original purpose of this column was to use it in connection with RefID of the Sheet and SheetDef to automate the updating of forms such as office policies when they change significantly. It is now also used when making a copy of a sheet. Also used alongside EClipboardSheetDef to determine whether patient has already filled out a form.
16	DocNum	bigint(20)	FK to document.DocNum. Referral letters are stored as PDF in the A to Z folder.
17	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Used by webforms to limit the sheets displayed based on the currently selected clinic.
18	DateTSheetEdited	datetime	The date and time the sheet was inserted or last time someone opened the sheet and clicked OK on FormSheetFillEdit. Gets updated even if no changes were made to the sheet or sheetfields, because we don't want to do the lengthy work of comparing all fields. Only used for one thing: when editing a sheet to warn user if the sheet has been edited by someone else while you had that window open.
19	HasMobileLayout	tinyint(4)	If true then this Sheet has been designed for mobile and will be displayed as a mobile-friendly WebForm.
20	RevID	int(11)	Revision ID. Used to determine in conjunction with PrefillMode for eClipboard to determine whether to show a patient a new form or have them update their last filled out form. Must match up with SheetDef RevID to show a previously filled out form.
21	WebFormSheetID	bigint(20)	Only set when this sheet was created from a Web Form. FK to webforms_sheet.SheetID within the Web Forms server. Used to determine if this particular Web Form has been retrieved before in order to avoid creating duplicate sheet entries for a single Web Form.

sheetdef
A definition (template) for a sheet. Can be pulled from the database, or it can be internally defined.
Order	Name	Type	Summary
0	SheetDefNum	bigint(20)	Primary key.
1	Description	varchar(255)	The description of this sheetdef.
2	SheetType	int(11)	Enum:SheetTypeEnum
LabelPatient: 0-Requires SheetParameter for PatNum. Does not get saved to db.
LabelCarrier: 1-Requires SheetParameter for CarrierNum. Does not get saved to db.
LabelReferral: 2-Requires SheetParameter for ReferralNum. Does not get saved to db.
ReferralSlip: 3-Requires SheetParameters for PatNum,ReferralNum.
LabelAppointment: 4-Requires SheetParameter for AptNum. Does not get saved to db.
Rx: 5-Requires SheetParameter for RxNum.
Consent: 6-Requires SheetParameter for PatNum.
PatientLetter: 7-Requires SheetParameter for PatNum.
ReferralLetter: 8-Requires SheetParameters for PatNum,ReferralNum.
PatientForm: 9-Requires SheetParameter for PatNum.
RoutingSlip: 10-Requires SheetParameter for AptNum. Does not get saved to db.
MedicalHistory: 11-Requires SheetParameter for PatNum.
LabSlip: 12-Requires SheetParameter for PatNum, LabCaseNum.
ExamSheet: 13-Requires SheetParameter for PatNum.
DepositSlip: 14-Requires SheetParameter for DepositNum.
Statement: 15-Requires SheetParameter for PatNum.
MedLabResults: 16-Requires SheetParameters for PatNum,MedLab,MedLabResult.
TreatmentPlan: 17-Requires SheetParameters for PatNum,TreatmentPlan.
Screening: 18-Requires SheetParameter for ScreenNum. Optional SheetParameter for PatNum if screening is associated to a patient.
PaymentPlan: 19-Used for Payment Plans to Sheets.
RxMulti: 20-Requires SheetParameters for ListRxSheet and ListRxNums.
ERA: 21
ERAGridHeader: 22
RxInstruction: 23
PatientDashboard: 24-Deprecated. No longer needed when change was made to only display one Patient Dashboard at a time. Defines the layout of a patient specific dashboard sheet. Not directly user editable. Each sheetfielddef linked to this sheet type further links a PatientDashboardWidget type sheet to this PatientDashboard sheet, allowing users to place various PatientDashboardWidgets on their personal PatientDashboard.
PatientDashboardWidget: 25-Defines the layout and elements of a Patient Dashboard. Editable from Dashboard Setup with Setup permissions.
ChartModule: 26
None: 27-Not designed to be saved to the db. Useful when needing a "none" or "all" default option for UI.
Check: 28-For printing checks
3	FontSize	float	The default fontSize for the sheet. The actual font must still be saved with each sheetField.
4	FontName	varchar(255)	The default fontName for the sheet. The actual font must still be saved with each sheetField.
5	Width	int(11)	Width of each page in the sheet in pixels, 100 pixels per inch.
6	Height	int(11)	Height of each page in the sheet in pixels, 100 pixels per inch.
7	IsLandscape	tinyint(4)	Set to true to print landscape.
8	PageCount	int(11)	Amount of editable space. Actual size when filling sheet may be different.
9	IsMultiPage	tinyint(4)	If false, forces old single page behavior which ignores page breaks.
10	BypassGlobalLock	tinyint(4)	Enum:BypassLockStatus Specifies whether a sheet can be created before the global lock date.
NeverBypass: 0 - Never bypass the lock date.
BypassIfZero: 1 - Bypass the lock date if the fee is zero.
BypassAlways: 2 - Always bypass the global lock date.
11	HasMobileLayout	tinyint(4)	If true then this Sheet has been designed for mobile and will be displayed as a mobile-friendly WebForm.
12	DateTCreated	datetime	The Date and time that SheetDef was created. Defaults to 0001-01-01 00:00:00 for existing sheets. When duplicating a custom sheet, if the original custom sheet's DateTCreated is 0001-01-01 00:00:00, the duplicate's DateTCreated will also be 0001-01-01 00:00:00. This is because this column is used for altering text fields' positions in PDFs.
13	RevID	int(11)	Revision ID. Gets updated any time a sheet field is added or deleted from a sheetdef (this includes any time a new language is added) or a static text field is changed. Used to determine in conjunction with PrefillMode for eClipboard to determine whether to show a patient a new form or have them update their last filled out form. Must match up with Sheet RevID to show a filled out form.
14	AutoCheckSaveImage	tinyint(4)	Indicates whether sheets created with this sheet def get copied to the imaging module when changes are made and saved. It's badly named since we don't use a checkbox anymore.
15	AutoCheckSaveImageDocCategory	bigint(20)	FK to definition.DefNum. Used to override the category that is selected when auto saving the sheet to the imaging module. This allows users to choose the category that a sheet is saved to on a per sheet basis.

sheetfield
One field on a sheet. Any language translations have already happened. See SheetFieldDef. How Exam Sheet replacement fields work: Fields can be placed in a static text field on a PatientLetter, ReferralSlip, or ReferralLetter. 1. For fields with FieldName (not misc), format is [ExamSheet:ExamSheetName;FieldName]. 2. For misc radiobuttons, format is [ExamSheet:ExamSheetName;RadioButtonGroupName]. 3. For other fields, format is [ExamSheet:ExamSheetName;ReportableName]. When replacing text, for misc checkboxes and radio buttons, this tag is replaced with the ReportableName if the checkbox is checked or radio button is selected, and with nothing otherwise.
Order	Name	Type	Summary
0	SheetFieldNum	bigint(20)	Primary key.
1	SheetNum	bigint(20)	FK to sheet.SheetNum.
2	FieldType	int(11)	Enum:SheetFieldType OutputText, InputField, StaticText,Parameter(only used for SheetField, not SheetFieldDef),Image,Drawing,Line,Rectangle,CheckBox,SigBox,PatImage,Grid, etc.
OutputText: 0-Pulled from the database to be printed on the sheet. Or also possibly just generated at runtime even though not pulled from the database. User still allowed to change the output text as they are filling out the sheet so that it can different from what was initially generated.
InputField: 1-A blank box that the user is supposed to fill in.
StaticText: 2-This is text that is defined as part of the sheet and will never change from sheet to sheet.
Parameter: 3-Stores a parameter other than the PatNum. Not meant to be seen on the sheet. Only used for SheetField, not SheetFieldDef.
Image: 4-Any image of any size, typically a background image for a form.
Drawing: 5-One sequence of dots that makes a line. Continuous without any breaks. Each time the pen is picked up, it creates a new field row in the database.
Line: 6-A simple line drawn from x,y to x+width,y+height. So for these types, we must allow width and height to be negative or zero.
Rectangle: 7-A simple rectangle outline.
CheckBox: 8-A clickable area on the screen. It's a form of input, so treated similarly to an InputField. The X will go from corner to corner of the rectangle specified. It can also behave like a radio button
SigBox: 9-A signature box, either Topaz pad or directly on the screen with stylus/mouse. The signature is encrypted based an a hash of all other field values in the entire sheet, excluding other SigBoxes. The order is critical.
PatImage: 10-An image specific to one patient.
Special: 11-Special: Used for ToothChart, ToothChartLegend, and 3 more chart module items.
Grid: 12-Grid: Placeable grids similar to ODGrids. Used primarily in statements.
ComboBox: 13-ComboBox: Placeable combo box for selecting filled options.
ScreenChart: 14-ScreenChart: A tooth chart that is desiged for screenings.
MobileHeader: 15-MobileHeader: The parent field of a group of fields. All fields in between this field and the next MobileHeader will be grouped toghether in the mobile view. EG... "Personal", "Address and Home Phone", "Insurance".
SigBoxPractice: 16-A signature box, either Topaz pad or directly on the screen with stylus/mouse. The signature is encrypted based an a hash of all other field values in the entire sheet, excluding other SigBoxes. The order is critical.
3	FieldName	varchar(255)	
4	FieldValue	text	For OutputText, this value is set before printing. This is the data obtained from the database and ready to print. For StaticText, this is copied from the sheetFieldDef, but in-line fields like [this] will have been filled. For an archived sheet retrieved from the database (all SheetField rows), this value will have been saved and will not be filled again automatically.For InputField, this is the filled value. If an an AutoNote attached, then this field will start out like AutoNoteNum:### until they click to fill out the autonote.Parameter fieldtype: this will store the value of the parameter. FKs are numbers. Two of the parameters allow multiple ProcNums, which are stored here as comma list.Drawing fieldtype: this will be the point data for the lines. The format would look similar to this: 45,68;48,70;49,72;0,0;55,88;etc. It's simply a sequence of points, separated by semicolons.CheckBox: it will either be an X or empty.SigBox: the first char will be 0 or 1 to indicate SigIsTopaz, and all subsequent chars will be the Signature itself.PatImage: FK to document.DocNum, or blank, or "MountNum:####" to indicate mount instead of document.ComboBox: The chosen option, semicolon, then a pipe delimited list of options such as: March;January|February|March|AprilScreenChart: Contains a semicolon delimited list of a single number followed by groups of comma separated surfaces. The first digit represents what type of ScreenChart it is. 0 = Permanent, 1 = Primary It may look like 0;S,P,N;S,S,S;... etc.Grid: Not used. All grid content is generated on the fly rather than preserved in the database. In the future, we should serialize grid content into here. But we probably have to overhaul the language translation for grids first.
5	FontSize	float	The fontSize for this field regardless of the default for the sheet. The actual font must be saved with each sheetField.
6	FontName	varchar(255)	The fontName for this field regardless of the default for the sheet. The actual font must be saved with each sheetField.
7	FontIsBold	tinyint(4)	.
8	XPos	int(11)	In pixels.
9	YPos	int(11)	In pixels.
10	Width	int(11)	The field will be constrained horizontally to this size. Not allowed to be zero.
11	Height	int(11)	The field will be constrained vertically to this size. Not allowed to be stored as 0. It's not allowed to be zero so that it will be visible on the designer. Set to 0 in memory by SheetUtil.CalculateHeights if image is innacessible for printing.
12	GrowthBehavior	int(11)	Enum:GrowthBehaviorEnum
None: Not allowed to grow. Max size would be Height and Width.
DownLocal: Can grow down if needed, and will push nearby objects out of the way so that there is no overlap.
DownGlobal: Can grow down, and will push down all objects on the sheet that are below it. Mostly used when drawing grids.
FillRightDown: Used with dynamic grids to grow the grid to fill to the right and bottom of the parent control, does not check for overlap.
FillDown: Used with dynamic grids to grow the grid to fill to the bottom of the parent control, does not check for overlap.
FillRight: Used with dynamic grids to grow the grid to fill to the right of the parent control, does not check for overlap.
FillDownFitColumns: Used with dynamic grids to grow the grid to fill vertical space in parent control and fit grid width to include all columns. Primarily for ProgressNotes grid in Chart Module.
13	RadioButtonValue	varchar(255)	This is only used for checkboxes that you want to behave like radiobuttons. Set the FieldName the same for each Checkbox in the group. The FieldValue will likely be X for one of them and empty string for the others. Each of them will have a different RadioButtonValue. Whichever box has X, the RadioButtonValue for that box will be used when importing. This field is not used for "misc" radiobutton groups.
14	RadioButtonGroup	varchar(255)	Only used for radiobuttons with FieldName set to "misc". Name which identifies the group within which the radio button belongs.
15	IsRequired	tinyint(4)	Set to true if this field is required to have a value before the sheet is closed.
16	TabOrder	int(11)	Tab stop order for all fields. Only checkboxes and input fields can have values other than 0.
17	ReportableName	varchar(255)	Allows reporting on misc fields using queries. This is also used in Exam Sheet replacement fields as the value to show for checkboxes and radiobuttons. See summary of this table for explanation of how they can be used in Exam Sheet replacement fields.
18	TextAlign	tinyint(4)	Text Alignment for text fields.
19	ItemColor	int(11)	Text color, line color, rectangle color. -16777216 is Black. 0 means Empty, which we attempt to treat as black if it happens.
20	DateTimeSig	datetime	DateTime that a sheet was signed.
21	IsLocked	tinyint(4)	Only used in Output and Static fields. Gets locked in the setup and cannot be edited at all once it is in the SheetFillEdit window. Example might be for text of a consent form.
22	TabOrderMobile	int(11)	Tab stop order for all fields of a mobile sheet. One-based. Only mobile fields can have values other than 0. If all SheetFieldDefs for a given SheetField are 0 then assume that this sheet has no mobile-specific view.
23	UiLabelMobile	text	Each input field for a mobile will need a corresponding UI label. This is what the user sees as the label describing what this input is for. EG "First Name:, Last Name:, Address, etc." For check boxes, this field should be blank otherwise a group box will be displayed to the user with this text. For radio buttons, this field should be set to the text of the group caption.
24	UiLabelMobileRadioButton	text	Human-readable label that will be displayed for radio button or checkbox item. Cannot use UiLabelMobile for this purpose as it is already dedicated to the radio group header that groups radio button items together.
25	SheetFieldDefNum	bigint(20)	FK to sheetfielddef.SheetFieldDefNum. Only used in the Patient Forms window when the Prefill button is clicked.
26	CanElectronicallySign	tinyint(4)	When true, allows a user to sign a signature box electronically. ESign/DigitallySign means clicking instead of using a stylus to write out the sig. If IsSigProvRestricted, then the E button for digitally signing won't be visible unless a provider is signed in. There is a completely separate Pref.SignatureAllowDigital which only applies to signing procedures etc., not sheets.
27	IsSigProvRestricted	tinyint(4)	When true, only allows the signature box to be signed by a provider. There is a completely separate Pref.NotesProviderSignatureOnly for doing the same thing in procedures etc., not sheets.
28	UserSigned	bigint(20)	FK to userod.UserNum. Only for sig boxes. Stores the OD user that signed. Only stores it if the user.ProvNum > 0. Only needed when user clicks to change user before signing. Will have a value of 0 for sheets with sigboxes which have "Allow Electronic Signatures" or "Restrict Signature to Providers" left unchecked (ex. MedicalHistory sheet sigbox). In the richtextbox for drawing SigBoxes in FormSheetFillEdit.cs: "By: " will not show with the username if UserSigned value is 0. This is only used in sheets because other places like FormProcEdit can store in procnote.UserNum. Sheets is also the only places where the change user button shows within the sig box.

sheetfielddef
One field on a sheetDef. Language translations are handled by the LanguagePat table. See SheetField. How Exam Sheet replacement fields work: Fields can be placed in a static text field on a PatientLetter, ReferralSlip, or ReferralLetter. 1. For fields with FieldName (not misc), format is [ExamSheet:ExamSheetName;FieldName]. 2. For misc radiobuttons, format is [ExamSheet:ExamSheetName;RadioButtonGroupName]. 3. For other fields, format is [ExamSheet:ExamSheetName;ReportableName].
Order	Name	Type	Summary
0	SheetFieldDefNum	bigint(20)	Primary key.
1	SheetDefNum	bigint(20)	FK to sheetdef.SheetDefNum.
2	FieldType	int(11)	Enum:SheetFieldType OutputText, InputField, StaticText,Parameter(only used for SheetField, not SheetFieldDef),Image,Drawing,Line,Rectangle,CheckBox,SigBox,PatImage,Grid, etc.
OutputText: 0-Pulled from the database to be printed on the sheet. Or also possibly just generated at runtime even though not pulled from the database. User still allowed to change the output text as they are filling out the sheet so that it can different from what was initially generated.
InputField: 1-A blank box that the user is supposed to fill in.
StaticText: 2-This is text that is defined as part of the sheet and will never change from sheet to sheet.
Parameter: 3-Stores a parameter other than the PatNum. Not meant to be seen on the sheet. Only used for SheetField, not SheetFieldDef.
Image: 4-Any image of any size, typically a background image for a form.
Drawing: 5-One sequence of dots that makes a line. Continuous without any breaks. Each time the pen is picked up, it creates a new field row in the database.
Line: 6-A simple line drawn from x,y to x+width,y+height. So for these types, we must allow width and height to be negative or zero.
Rectangle: 7-A simple rectangle outline.
CheckBox: 8-A clickable area on the screen. It's a form of input, so treated similarly to an InputField. The X will go from corner to corner of the rectangle specified. It can also behave like a radio button
SigBox: 9-A signature box, either Topaz pad or directly on the screen with stylus/mouse. The signature is encrypted based an a hash of all other field values in the entire sheet, excluding other SigBoxes. The order is critical.
PatImage: 10-An image specific to one patient.
Special: 11-Special: Used for ToothChart, ToothChartLegend, and 3 more chart module items.
Grid: 12-Grid: Placeable grids similar to ODGrids. Used primarily in statements.
ComboBox: 13-ComboBox: Placeable combo box for selecting filled options.
ScreenChart: 14-ScreenChart: A tooth chart that is desiged for screenings.
MobileHeader: 15-MobileHeader: The parent field of a group of fields. All fields in between this field and the next MobileHeader will be grouped toghether in the mobile view. EG... "Personal", "Address and Home Phone", "Insurance".
SigBoxPractice: 16-A signature box, either Topaz pad or directly on the screen with stylus/mouse. The signature is encrypted based an a hash of all other field values in the entire sheet, excluding other SigBoxes. The order is critical.
3	FieldName	varchar(255)	FieldName is used differently for different FieldTypes. For OutputText, each sheet typically has a main datatable type. For example statements correspond to the statment table. See SheetFieldsAvailable.GetList() for available values.     If the output field exactly matches a column from the main table this will be the <ColumnName>. For example, "FName" on patient Forms.     If the output field exactly matches a column from a different table this will be the <tablename>.<ColumnName>. For example, appt.Note on Routing Slips.     If the output field is not a database column it must start with a lowercase letter. For example, "statementReceiptInvoice" on Statements.For InputField, these are hardcoded to correspond to DB fields, for example "FName" corresponsds to patient.FName. See SheetFieldsAvailable.GetList() for available values.For Image, this file name with extention, for example "image1.jpg". Some image names are handled specially, for example "Patient Info.gif". Images are stored in <imagefolder>\SheetImages\image1.jpg.For CheckBox, this groups checkboxes together so that only one per group can be checked.For PatImage, this is the name of the DocCategory.For Special, identifies the type of special field. Currently only ToothChart and ToothChartLegend.For Grid, this is the specific type of grid. See SheetUtil.GetDataTableForGridType() for values. For example "StatementPayPlan". Column names use hard coded display fields that can be found in SheetUtil.GetGridColumnAvailable().For all other fieldtypes, FieldName is blank or irrelevant.
4	FieldValue	text	For StaticText, this text can include bracketed fields, like [nameLF]. For OutputText and InputField, this will be blank. If an InputField has an AutoNote attached, then this field will be AutoNoteNum:'value'. Example AutoNoteNum:268.For CheckBoxes, either X or blank. Even if the checkbox is set to behave like a radio button. For Pat Images, this is blank. The filename of a PatImage will later be stored in SheetField.FieldValue.For ComboBoxes, the chosen option, semicolon, then a pipe delimited list of options such as: March;January|February|March|AprilFor ScreenCharts, a semicolon delimited list of comma separated surfaces. It may look like S,P,N;S,S,S;... etc.For Grid, not used. All grid content is generated on the fly rather than preserved in the database. In the future, we should serialize grid content into here. But we probably have to overhaul the language translation for grids first.
5	FontSize	float	The fontSize for this field regardless of the default for the sheet. The actual font must be saved with each sheetField.
6	FontName	varchar(255)	The fontName for this field regardless of the default for the sheet. The actual font must be saved with each sheetField.
7	FontIsBold	tinyint(4)	.
8	XPos	int(11)	In pixels.
9	YPos	int(11)	In pixels.
10	Width	int(11)	The field will be constrained horizontally to this size. Not allowed to be zero. When SheetType is associated to a dynamic layout def and GrowthBehavior is set to a dynamic value this value represents the corresponding controls minimum width.
11	Height	int(11)	The field will be constrained vertically to this size. Not allowed to be 0. It's not allowed to be zero so that it will be visible on the designer. When SheetType is associated to a dynamic layout def and GrowthBehavior is set to a dynamic value this value represents the corresponding controls minimum height.
12	GrowthBehavior	int(11)	Enum:GrowthBehaviorEnum
None: Not allowed to grow. Max size would be Height and Width.
DownLocal: Can grow down if needed, and will push nearby objects out of the way so that there is no overlap.
DownGlobal: Can grow down, and will push down all objects on the sheet that are below it. Mostly used when drawing grids.
FillRightDown: Used with dynamic grids to grow the grid to fill to the right and bottom of the parent control, does not check for overlap.
FillDown: Used with dynamic grids to grow the grid to fill to the bottom of the parent control, does not check for overlap.
FillRight: Used with dynamic grids to grow the grid to fill to the right of the parent control, does not check for overlap.
FillDownFitColumns: Used with dynamic grids to grow the grid to fill vertical space in parent control and fit grid width to include all columns. Primarily for ProgressNotes grid in Chart Module.
13	RadioButtonValue	varchar(255)	This is only used for checkboxes that you want to behave like radiobuttons. Set the FieldName the same for each Checkbox in the group. The FieldValue will likely be X for one of them and empty string for the others. Each of them will have a different RadioButtonValue. Whichever box has X, the RadioButtonValue for that box will be used when importing. This field is not used for "misc" radiobutton groups.
14	RadioButtonGroup	varchar(255)	Only used for radiobuttons with FieldName set to "misc". Name which identifies the group within which the radio button belongs.
15	IsRequired	tinyint(4)	Set to true if this field is required to have a value before the sheet is closed.
16	TabOrder	int(11)	The Bitmap should be converted to Base64 using POut.Bitmap() before placing in this field. Not stored in the database. Only used when uploading SheetDefs to the web server.
17	ReportableName	varchar(255)	Allows reporting on misc fields using queries. See summary of this table for explanation of how they can be used in Exam Sheet replacement fields.
18	TextAlign	tinyint(4)	Text Alignment for text fields.
19	IsPaymentOption	tinyint(4)	Used to determine if the field should be hidden when printing statements.
20	ItemColor	int(11)	Text color, line color, rectangle color.
21	IsLocked	tinyint(4)	Only used in Output and Static fields. Gets locked in the setup and cannot be edited at all once it is in the SheetFillEdit window. Example might be for text of a consent form.
22	TabOrderMobile	int(11)	Tab stop order for all fields of a mobile sheet. One-based. Only mobile fields can have values other than 0. If all SheetFieldDefs for a given SheetField are 0 then assume that this sheet has no mobile-specific view.
23	UiLabelMobile	text	Each input field for a mobile will need a corresponding UI label. This is what the user sees as the label describing what this input is for. EG "First Name:, Last Name:, Address, etc." For check boxes, this field should be blank otherwise a group box will be displayed to the user with this text. For radio buttons, this field should be set to the text of the group caption.
24	UiLabelMobileRadioButton	text	Human-readable label that will be displayed for radio button or checkbox item. Cannot use UiLabelMobile for this purpose as it is already dedicated to the radio group header that groups radio button items together. This is also used in Exam Sheet replacement fields as the value to show for checkboxes and radiobuttons.
25	LayoutMode	tinyint(4)	Enum:SheetFieldLayoutMode Just used in Chart module for ecw or medical. Otherwise, use SheetFieldLayoutMode.Default. TP mode in Chart module is no longer included here.
Default: Valid for every SheetTypeEnum. When SheetTypeEnum is associated to a dynamic layout this is the way the layout will show by default.
TreatPlan: Deprecated. Chart module dynamic layout when we are viewing the SheetFieldLayoutMode.Default and the Treatment Plans checkbox is checked.
Ecw: Chart module dynamic layout when ECW is enabled.
EcwTreatPlan: Deprecated. Chart module dynamic layout when ECW is enabled and the Treatment Plans checkbox is checked.
Orion: Deprecated. Chart module dynamic layout when Orion is enabled.
OrionTreatPlan: Deprecated. Chart module dynamic layout when Orion is enabled and the Treatment Plans checkbox is checked.
MedicalPractice: Chart module dynamic layout when current clinic is associated to a medical clinic or practice.
MedicalPracticeTreatPlan: Deprecated. Chart module dynamic layout when current clinic is associated to a medical clinic or practice and the Treatment Plans checkbox is checked.
26	Language	varchar(255)	Blank by default. When set, patient.Language will attempt to match to SheetFieldDefs with a matching Language value.
27	CanElectronicallySign	tinyint(4)	When true, allows a user to sign a signature box electronically which means clicking instead of using a stylus to write out the sig. If IsSigProvRestricted, then the E button for digitally signing won't be visible unless a provider is signed in. There is a completely separate Pref.SignatureAllowDigital which only applies to signing procedures etc., not sheets.
28	IsSigProvRestricted	tinyint(4)	When true, only allows the signature box to be signed by a provider. There is a completely separate Pref.NotesProviderSignatureOnly for doing the same thing in procedures etc., not sheets.

sigbutdef
This defines the light buttons on the left of the main screen.
Order	Name	Type	Summary
0	SigButDefNum	bigint(20)	Primary key.
1	ButtonText	varchar(255)	The text on the button
2	ButtonIndex	smallint(6)	0-based index defines the order of the buttons.
3	SynchIcon	tinyint	0=none, or 1-9. The cell in the 3x3 tic-tac-toe main program icon that is to be synched with this button. It will light up or clear whenever this button lights or clears.
4	ComputerName	varchar(255)	Blank for the default buttons. Or contains the computer name for the buttons that override the defaults.
5	SigElementDefNumUser	bigint(20)	FK to sigelementdef.SigElementDefNum
6	SigElementDefNumExtra	bigint(20)	FK to sigelementdef.SigElementDefNum
7	SigElementDefNumMsg	bigint(20)	FK to sigelementdef.SigElementDefNum

sigelementdef
This defines the items that will be available for clicking when composing a manual message. Also, these are referred to in the button definitions as a sequence of elements.
Order	Name	Type	Summary
0	SigElementDefNum	bigint(20)	Primary key.
1	LightRow	tinyint	If this element should cause a button to light up, this would be the row. 0 means none.
2	LightColor	int(11)	If a light row is set, this is the color it will turn when triggered. Ack sets it back to white. Note that color and row can be in two separate elements of the same signal.
3	SigElementType	tinyint	Enum:SignalElementType 0=User,1=Extra,2=Message.
User: 0-To and From lists. Not tied in any way to the users that are part of security.
Extra: Typically used to insert "family" before "phone" signals.
Message: Elements of this type show in the last column and trigger the message to be sent.
4	SigText	varchar(255)	The text that shows for the element, like the user name or the two word message. No long text is stored here.
5	Sound	mediumtext	The sound to play for this element. Wav file stored in the database in string format until "played". If empty string, then no sound.
6	ItemOrder	smallint(6)	The order of this element within the list of the same type.

sigmessage
These are messages sent and received in the Manage module. Affects the main icon with the 9 boxes. Also causes a recorded sound to play so that everyone knows who the message is for.
Order	Name	Type	Summary
0	SigMessageNum	bigint(20)	Primary key.
1	ButtonText	varchar(255)	The text on the button
2	ButtonIndex	int(11)	0-based index defines the order of the buttons.
3	SynchIcon	tinyint	0=none, or 1-9. The cell in the 3x3 tic-tac-toe main program icon that is to be synched with this button. It will light up or clear whenever this button lights or clears.
4	FromUser	varchar(255)	Text version of 'user' this message was sent from, which can actually be any description of a group or individual.
5	ToUser	varchar(255)	Text version of 'user' this message was sent to, which can actually be any description of a group or individual.
6	MessageDateTime	datetime	Automatically set to the date and time upon insert. Uses server time.
7	AckDateTime	datetime	This date time will get set as soon as this message has been acknowledged. How lights get turned off.
8	SigText	varchar(255)	The text that shows for the element, like the user name or the two word message. No long text is stored here.
9	SigElementDefNumUser	bigint(20)	FK to sigelementdef.SigElementDefNum
10	SigElementDefNumExtra	bigint(20)	FK to sigelementdef.SigElementDefNum
11	SigElementDefNumMsg	bigint(20)	FK to sigelementdef.SigElementDefNum

signalod
Open Dental uses a memory cache for many common small tables that don't change very often. If one computer makes a change to a cache table, then they insert a row in this table to indicate to all other computers that they need to update their cache for the given table. Certain entries in this table can also trigger the Appointments module to refresh if that date is currently showing for any computer. To add a row here, use DataValid.SetInvalid. See the discussion in Cache.cs. It seems like the rows that use KeyType and FKey seem to be treated very differently from the rows that use InvalidType for the cache.
Order	Name	Type	Summary
0	SignalNum	bigint(20)	Primary key.
1	DateViewing	date	If IType=Date, then this is the affected date in the Appointments module.
2	SigDateTime	datetime	The exact server time when this signal was entered into db. This does not need to be set by sender since it's handled automatically.
3	FKey	bigint(20)	Usually identifies the object that was edited to cause the signal to be created. Can be used for special scenarios based on the FKeyType. E.g. for SmsMsgUnreadCount, this represents a count, not an FK.
4	FKeyType	varchar(255)	Enum:KeyType Describes the type of object referenced by the FKey.
Undefined: Probably represented by empty string, but possibly by "Undefined".
FeeSched:
Job:
Operatory:
PhoneExtension: HQ only. FKey will be the extension of the corresponding phone that is invalid. Specifically used to talk to the PhoneTrackingServer in order to let it know that an extension has changed (e.g. queue change).
Provider:
SigMessage:
SmsMsgUnreadCount: Special KeyType that does not use a FK but instead will set FKey to a count of unread messages. Used along side the SmsTextMsgReceivedUnreadCount InvalidType.
Task:
ProcessId: Used to identify which signals a form can ignore. If the FKey==Process.GetCurrentProcess().Id then this process sent it so ignore it. Used in FormTerminal, FormTerminalManager, and FormSheetFillEdit (for forms being filled at a kiosk).
ConfKick: Used to notify the phone tracking server to kick all users out of a conference room.
PatNum: Used in AccModule, TPModule, and PerioExams.
UserOd: Deprecated. Indicates Signalod pertains to a specific UserOd.
EmailAddress: Used to indicate that this specific email address is what this signal is for
ChanSpy: This is HQ specific and will be used to listen in on live calls
Computer: Used to speficy that the passed-in computerNum is what the signal is for.
5	IType	tinyint(4)	Enum:InvalidType Indicates what cache or entity has been changed.
None: 0
Date: 1 Deprecated. Not used with any other flags
AllLocal: 2 Deprecated. Inefficient. All flags combined except Date and Tasks.
Task: 3 Not used with any other flags. Used to just indicate added tasks, but now it indicates any change at all except those where a popup is needed. If we also want a popup, then use TaskPopup.
ProcCodes: 4
Prefs: 5
Views: 6 ApptViews, ApptViewItems, AppointmentRules, ProcApptColors.
AutoCodes: 7
Carriers: 8
ClearHouses: 9
Computers: 10
InsCats: 11
Employees: 12- Also includes payperiods.
StartupOld: 13- Deprecated.
Defs: 14
Email: 15. Templates and addresses, but not messages.
Fees: 16. Obsolete
Letters: 17
QuickPaste: 18- Invalidates quick paste notes and cats.
Security: 19- Userods, UserGroups, UserGroupAttaches, and GroupPermissions
Programs: 20 - Also includes program properties.
ToolButsAndMounts: 21- Also includes MountDefs and ImagingDevices
Providers: 22- Also includes clinics.
ClaimForms: 23- Also includes ClaimFormItems.
ZipCodes: 24
LetterMerge: 25
DentalSchools: 26- Includes SchoolClass, SchoolCourse, SchoolCourseDef, SchoolCourseSched, and ReqNeeded.
Operatories: 27
TaskPopup: 28
Sites: 29
Pharmacies: 30
Sheets: 31 - Also include EForms.
RecallTypes: 32
FeeScheds: 33
PhoneNumbers: 34. This is used internally by OD, Inc with the phonenumber table and the phone server.
Signals: 35. Deprecated, use SigMessages instead. Old summary: Signal/message defs
DisplayFields: 36. And ChartViews.
PatFields: 37. And ApptFields and PatFieldPickItems.
AccountingAutoPays: 38
ProcButtons: 39
Diseases: 40. Includes ICD9s.
Languages: 41. Includes LanguagePats
AutoNotes: 42
ElectIDs: 43
Employers: 44
ProviderIdents: 45
ShutDownNow: 46
InsFilingCodes: 47
ReplicationServers: 48
Automation: 49
PhoneAsteriskReload: 50. This is used internally by OD, Inc with the phone server to trigger the phone system to reload after changing which call groups users are in. Also used when sending a signal to the phone tracking server to kick users in conference rooms. This will be used additionally to listen in on live calls.
TimeCardRules: 51
Vaccines: 52. Includes DrugManufacturers and DrugUnits.
HL7Defs: 53. Includes all 4 HL7Def tables.
DictCustoms: 54
Wiki: 55. Caches the wiki master page and the wikiListHeaderWidths
Sops: 56. SourceOfPayment
EhrCodes: 57. In-Memory table used for hard-coded codes and CQMs
AppointmentTypes: 58. Used to override appointment color. Might be used for other appointment attributes in the future.
Medications: 59. Caches the medication list to stop from over-refreshing and causing slowness.
SmsTextMsgReceivedUnreadCount: 60. This is a special InvalidType which indicates a refresh, but also includes the data to be refreshed inside of the signalod.FKey field.
ProviderErxs: 61
Jobs: 62. This is used internally by OD, refreshes the jobs windows in the Job Manager.
JobPermission: 63. This is used internally by OD, refreshes the jobRoles
StateAbbrs: 64. Caches the StateAbbrs used for helping prefill state fields and for state validations.
RequiredFields: 65
Ebills: 66
UserClinics: 67. Not used.
Appointment: 68. Replaces the deprecated "Date" invalid type for more granularity on invalid signals.
OrthoChartTabs: 69 Also includes OrthoHardwareSpecs.
SigMessages: 70. A user either acknowledged or added to the messaging buttons system.
AlertSubs: 71. Deprecated.
AlertItems: 72. THIS IS NOT CACHED. But is used to make server run the alert logic in OpenDentalService.
VoiceMails: 73. This is used internally by OD HQ, refreshes the voice mails.
Kiosk: 74. Used to refresh the active kiosk grid in FormTerminalManager and loaded patient with list of forms in FormTerminal.
ClinicPrefs: 75
EmailMessages: 76. Not addresses or templates, but inbox and sent messages.
WebSchedRecallReminders: 77. The eConnector has finished sending web sched recall reminders.
SmsBlockPhones: 78.
AlertCategories: 79.
AlertCategoryLinks: 80.
UnfinalizedPayMenuUpdate: 81. Used in updating menu item in report menu.
ClinicErxs: 82. Used for validating clinics for eRx.
DisplayReports: 83.
UserQueries: 84.
Schedules: 85. Schedules are not cached, but alerts other workstations if the schedules were changed
PhoneComps: 86. This is used internally by OD, refreshes the computer / extension linker table.
PhoneMap: 87. Used internally by OD, refreshes call center map associated with tables MapArea and MapAreaContainer.
SmsPhones: 88.
WebChatSessions: 89. Chat support through our website at http://opendental.com/contact.html. Used to indicate a new session has been created, an existing session has been destroyed, or messages inside the session have changed.
TaskList: 90. Used for tracking refreshes on tabs 'for [User]', 'New for [User]', 'Main', 'Reminders'.
TaskAuthor: 91. Used for tracking refreshes on tab 'Open Tasks'.
TaskPatient: 92. Used for tracking refreshes on tab 'Patient Tasks'.
Referral: 93. Used for refreshing the Referral cache.
ProcMultiVisits: 94. Used for refreshing "In Process" pseudo procedure statuses.
ProviderClinicLink: 95. Used for refreshing the ProviderClinicLink cache.
EClipboard: 96. Used for refreshing the KioskManager with eClipboard information.
TPModule: 97. Used for refreshing the TP module for a specific patient. PatNum used in FKey.
ActiveInstance: 98. Used for closing Cloud sessions. ActiveInstanceNum is the Fkey.
PhoneEmpDefaults: 99. Used internally by OD HQ.
UserOdPrefs: 100. Not used.
JobTeams: 101. Used internally by OD HQ.
AccModule: 102. Used to refresh the Account Module for a specific patient. PatNum used in FKey.
LimitedBetaFeature: 103. Used for limitedBetaFeature Cache.
PerioExams: 104. Used to refresh Perio Chart. patient.PatNum used in FKey.
EmailInboxRetrieve: 105.
ApiSubscriptions: 106. Table in db is apisubscriptions. Small and changes rarely, but all workstations must know about the change.
ERoutingDef: 107. Used as template for Patient eRouting
FlowActionDef: 108. Used as template for Patient eRouting Actions
FlowDefLink: 109. Used to link PatientFlowDefs with other objects: appointments, appt types, billing types, etc.
CodeGroups: 110. Group of codes used with frequency limitations.
BillingList: 111. Used to refresh the billing list when it's open and a patient's account was adjusted. Works immediately on the current computer and at the signal interval of about 10 seconds on other computers.
ConnectionStoreClear: 112. Indicates that database connection settings have changed and the cached connections should be reinitialized.
Children: 113. Used to keep the daycare map and parent check in/out window synced. Has nothing to do with the cache.
Print: 114. Instructs a specific computer to print the RemotePrintRequest that is attached as json. This signal is generated by eConnector in response to a print request from ODTouch or possibly others.
WebChatAiAssistants: 115. This is used internally by OD, refreshes the AI assistant list. Fkey is not used.
MassEmail: 116. Used to refresh the mass email upload form.
6	RemoteRole	tinyint(4)	Enum:MiddleTierRole The MiddleTierRole of the instance that created this signal.
ClientDirect: This dll is on a local workstation, and this workstation has successfully connected directly to the database with no Middle Tier layer.
ClientMT: Workstation that is getting its data from the Middle Tier web service on the server.
ServerMT: This dll is part of the Middle Tier web server that is providing data via web services.
7	MsgValue	text	Message value of the signal.

site
Generally used by mobile clinics to track the temporary locations where treatment is performed, such as schools, nursing homes, and community centers. Replaces the old school table.
Order	Name	Type	Summary
0	SiteNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	Note	text	Notes could include phone, contacts, etc.
3	Address	varchar(100)	
4	Address2	varchar(100)	Optional second address line.
5	City	varchar(100)	
6	State	varchar(100)	2 Char in USA. Used to store province for Canadian users.
7	Zip	varchar(100)	Postal code.
8	ProvNum	bigint(20)	FK to provider.ProvNum. Default provider for the site.
9	PlaceService	tinyint(4)	Enum:PlaceOfService Describes where the site is located.
Office: 0. Code 11
PatientsHome: 1. Code 12
InpatHospital: 2. Code 21
OutpatHospital: 3. Code 22
SkilledNursFac: 4. Code 31
CustodialCareFacility: 5. Code 33. In X12, a similar code AdultLivCareFac 35 is mentioned.
OtherLocation: 6. Code 99. We use 11 for office.
MobileUnit: 7. Code 15
School: 8. Code 03
MilitaryTreatFac: 9. Code 26
FederalHealthCenter: 10. Code 50
PublicHealthClinic: 11. Code 71
RuralHealthClinic: 12. Code 72
EmergencyRoomHospital: 13. Code 23
AmbulatorySurgicalCenter: 14. Code 24
TelehealthOutsideHome: 15. Code 02.
TelehealthInHome: 16. Code 10
OutreachSiteOrStreet: 17. Code 27

smsblockphone
If a number is entered in this table, then any incoming text message will not be entered into the database.
Order	Name	Type	Summary
0	SmsBlockPhoneNum	bigint(20)	Primary key.
1	BlockWirelessNumber	varchar(255)	The phone number to be blocked.

smsfrommobile
A Mobile Originating SMS bound for the office. Will usually be a re-constructed message.
Order	Name	Type	Summary
0	SmsFromMobileNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. Not sent from HQ.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
3	CommlogNum	bigint(20)	FK to commlog.CommlogNum. Not sent from HQ.
4	MsgText	text	Contents of the message.
5	DateTimeReceived	datetime	Date and time message was inserted into the DB. Not sent from HQ.
6	SmsPhoneNumber	varchar(255)	This is the Phone Number of the office that the mobile device sent a message to.
7	MobilePhoneNumber	varchar(255)	This is the PhoneNumber that this message was sent from.
8	MsgPart	int(11)	Message part sequence number. For single part messages this should always be 1. For messages that exist as multiple parts, due to staggered delivery of the parts, this will be a number between 1 and MsgTotal.
9	MsgTotal	int(11)	Total count of message parts for this single message identified by MsgRefID. For single part messages this should always be 1.
10	MsgRefID	varchar(255)	Each part of a multipart message will have the same MsgRefID.
11	SmsStatus	tinyint(4)	Enum:SmsFromStatus .
ReceivedUnread: 0
ReceivedRead: 1
12	Flags	varchar(255)	Words surrounded by spaces, flags should be all lower case. This allows simple querrying. Example: " junk recall " allows you to write "WHERE Flags like "% junk %" without having to worry about commas. Also, adding and removing tags is easier. Example: Flags=Flags.Replace(" junk ","");
13	IsHidden	tinyint(4)	Messages are not deleted, they can only be hidden.
14	MatchCount	int(11)	
15	GuidMessage	varchar(255)	FK to confirmationrequest.GuidMessageFromMobile. Generated at HQ when the confirmation pending is terminated with confirmation text message.
16	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

smsphone
A phone number used to send and receive SMS. When clinics is enabled all SmsPhones with clinic num 0 should be updated to have clinic num of the lowest numbered clinic. When clinics are disabled, all SmsPhones with the lowest numbered clinic num should be re-associated to clinic number 0.
Order	Name	Type	Summary
0	SmsPhoneNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
2	PhoneNumber	varchar(255)	String representation of the phone number in international format. Ex: 15035551234 This field should not contain any formatting characters.
3	DateTimeActive	datetime	Date and time this phone number became active.
4	DateTimeInactive	datetime	Date and time this phone number became inactive. Once inactive, the phone is dead and cannot be reactivated. A new number will have to be purchased.
5	InactiveCode	varchar(255)	Used to indicate why this phone number was made inactive.
6	CountryCode	varchar(255)	Country linked to this phone's clinic at the instant that this phone is created. Based on ISO31661.

smstomobile
Messages are only inserted into this table after they are accepted by ODHQ.
Order	Name	Type	Summary
0	SmsToMobileNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	GuidMessage	varchar(255)	GUID. Uniquely identifies this message and is used for tracking message status.
3	GuidBatch	varchar(255)	GUID. When sending batch messages, all messages will have the same batch GUID that should be the GUID of the first message within the batch.
4	SmsPhoneNumber	varchar(255)	This is the sending phone number in international format. Each office may have several different numbers that they use.
5	MobilePhoneNumber	varchar(255)	The phone number that this message was sent to. Must be kept in addition to the PatNum.
6	IsTimeSensitive	tinyint(4)	Set to true if this message should "jump the queue" and be sent asap.
7	MsgType	tinyint(4)	Enum:SmsMessageSource This is used to identify where in the program this message originated from.
Undefined: 0. Should not be used. Short Code Supported: NO
DirectSms: 1. This should be used for one-off messages that might be sent as direct communication with patient. Short Code Supported: NO
Recall: 2. Used when sending single or batch recall SMS from the Open Dental program. Short Code Supported: YES
Reminder: 3. Used when sending single or batch reminder SMS. Short Code Supported: YES
TestNoCharge: 4. Used when sending a test message from HQ. Customer will not be charged for this message. Short Code Supported: NO
Confirmation: 5. Used when sending confirmations. Short Code Supported: YES
ConfirmationRequest: 6. Used when sending confirmation requests. Will be the subject of automated response processing. Short Code Supported: YES
RecallAuto: 7. Used when sending batch recall SMS from the eConnector. Short Code Supported: YES
AsapManual: 8. Used when sending single or batch SMS from the clicking the Text button on the ASAP window. Short Code Supported: YES
WebSchedASAP: 9. Sending an SMS for the Web Sched ASAP feature. Short Code Supported: YES
Verify: 10. Sending an SMS for the Web Sched verify feature. Short Code Supported: YES
Statements: 11. Sending an SMS to let the patient know that a statement is available. Short Code Supported: YES
VerifyWSNP: 12. Sending an SMS to let the patient know that a statement is available. Short Code Supported: YES
Headmaster: 13. Sent from the Headmaster app. Short Code Supported: NO
NoReply: 14. Used with Short Codes to send an AutoReply message (not a monitored line). Short Code Supported: N/A
ODMobile: 15. Send from ODMobile app. Short Code Supported: NO
ApptThankYou: 16. Used when sending appointment/schedule Thank You's. Short Code Supported: YES
ConfirmationAutoReply: 17. Used when the patient responds positively to an eConfirmation. Short Code Supported: YES
OptInPrompt: 18. Used with Short Codes to send a message prompting the patient to opt in to receiving Short Code sms. Short Code Supported: YES
StopReply: 19. Used with Short Codes to send a message confirming the patient has opted out of receiving Short Code sms. Short Code Supported: YES
HelpReply: 20. Used with Short Codes to send a message detailing help options for the patient. Short Code Supported: YES
OptInReply: 21. Used with Short Codes to send a message confirming the patient has opted in to receiving Short Code sms. Short Code Supported: YES
Arrival: 22. Used to texting patients about appointment arrival instructions.
ByodToken: 23. Used for 2 factor authentication in mobile apps.
GeneralMessage: 24. Used when sending appointment general messages.
ApptNewPatThankYou: 25. Used when sending webforms for new patients on appointment schedule.
VerifyPaymentPortal: 26. Used when sending verification codes for the Payment Portal web app. Short Code Supported: NO
MsgToPay: 27. Used for Payment Portal Msg-To-Pay messages. Short Code Supported: NO
OptOutReply: 28. Used when the office checks NO for the patient to receive texts in the patient edit form. Short Code Supported: NO
EClipboardWeb: 29. Used when sending eClipboard Web URLs to patients. Short Code Supported: NO
8	MsgText	text	The contents of the message.
9	SmsStatus	tinyint(4)	Enum:SmsDeliveryStatus Set by the Listener, tracks status of SMS.
None: 0. Should not be used.
Pending: 1. After a message has been accepted at ODHQ. Before any feedback.
DeliveryConf: 2. Delivered to customer, carrier replied with confirmation.
DeliveryUnconf: 3. Delivered to customer, no confirmation of failure or delivery sent back from carrier.
FailWithCharge: 4. Attempted delivery, failure message return after arriving at handset.
FailNoCharge: 5. Attempted delivery, immediate failure confirmation received from carrier.
10	MsgParts	int(11)	The count of parts that this message will be broken into when sent. A single long message will be broken into several smaller 153 utf8 or 70 unicode character messages.
11	MsgChargeUSD	float	The amount charged to the customer. Total cost for this message always stored in US Dollars.
12	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 when not using clinics.
13	CustErrorText	varchar(255)	Only used when SmsDeliveryStatus==Failed.
14	DateTimeSent	datetime	Time message was accepted at ODHQ.
15	DateTimeTerminated	datetime	Date time that the message was either successfully delivered or failed.
16	IsHidden	tinyint(4)	Messages are hidden, not deleted.
17	MsgDiscountUSD	float	Any discount applied to this message. If a particular messages has a MsgDiscountUSD > 0 then the MsgChargeUSD will reflect the charge to the customer after the discount has already been applied. Multi-part messages will still be charged the wholesale rate for all parts after the first part. To calculate the typical charge that this customer would pay without the discount use MsgChargeUSD + MsgDiscountUSD. To calculate the percentage discounted off standard charges use (MsgDiscountUSD / (MsgChargeUSD + MsgDiscountUSD)).
18	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.

snomed
We do not import synonyms, only "Fully Specified Name records". Snomed for holding a large list of codes. Codes in use are copied into the DiseaseDef table. SNOMED CT maintained, owned and copyright International Health Terminology Standards Development Organisation (IHTSDO).
Order	Name	Type	Summary
0	SnomedNum	bigint(20)	Primary key.
1	SnomedCode	varchar(255)	Used as FK by other tables. Also called the Concept ID. Not allowed to edit this column once saved in the database.
2	Description	varchar(255)	Also called "Term", "Name", or "Fully Specified Name". Not editable and doesn't change.

sop
Order	Name	Type	Summary
0	SopNum	bigint(20)	
1	SopCode	varchar(255)	
2	Description	varchar(255)	

stateabbr
State abbreviations are always copied to patient records rather than linked. Items in this list can be freely altered or deleted without harming patient data.
Order	Name	Type	Summary
0	StateAbbrNum	bigint(20)	Primary key.
1	Description	varchar(50)	Full state name
2	Abbr	varchar(50)	Short state abbreviation (usually 2 digit)
3	MedicaidIDLength	int(11)	The length that the Medicaid ID should be for this state. If 0, then the Medicaid length is not enforced for this state

statement
Represents one statement for one family. Usually already sent, but could still be waiting to send.
Order	Name	Type	Summary
0	StatementNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum. Typically the guarantor. Can also be the patient for walkout statements.
2	DateSent	date	This will always be a valid and reasonable date regardless of whether it's actually been sent yet.
3	DateRangeFrom	date	Typically 45 days before dateSent
4	DateRangeTo	date	Any date >= year 2200 is considered max val. We generally try to automate this value to be the same date as the statement rather than the max val. This is so that when payment plans are displayed, we can add approximately 10 days to effectively show the charge that will soon be due. Adding the 10 days is not done until display time.
5	Note	text	Can include line breaks. This ordinary note will be in the standard font.
6	NoteBold	text	More important notes may go here. Font will be bold. Color and size of text will be customizable in setup.
7	Mode_	tinyint	Enum:StatementMode Mail, InPerson, Email, Electronic.
Mail: 0
InPerson: 1
Email: 2
Electronic: 3-Send the statement over the internet to an API. That company then sends the actual statement, usually by paper.
API: 4-The statement was generated by a third-party API developer. Optionally associated with a DocNum.
8	HidePayment	tinyint(1)	Set true to hide the credit card section, and the please pay box.
9	SinglePatient	tinyint(1)	One patient on statement instead of entire family.
10	Intermingled	tinyint(1)	If entire family, then this determines whether they are all intermingled into one big grid, or whether they are all listed in separate grids.
11	IsSent	tinyint(1)	True
12	DocNum	bigint(20)	FK to document.DocNum when a pdf has been archived.
13	DateTStamp	timestamp	Date/time last altered.
14	IsReceipt	tinyint(4)	The only effect of this flag is to change the text at the top of a statement from "statement" to "receipt". It might later do more.
15	IsInvoice	tinyint(4)	This flag is for marking a statement as Invoice. In this case, it must have procedures and/or adjustments attached.
16	IsInvoiceCopy	tinyint(4)	Only used if IsInvoice=true. The first printout will not be a copy. Subsequent printouts will show "copy" on them.
17	EmailSubject	varchar(255)	Empty string by default. Only used to override BillingEmailSubject pref when emailing statements. Only set when statements are created from the Billing Options window. No UI for editing.
18	EmailBody	mediumtext	Empty string by default. Only used to override BillingEmailBodyText pref when emailing statements. Only set when statements are created from the Billing Options window. No UI for editing. Limit in db: 16M char.
19	SuperFamily	bigint(20)	FK to patient.PatNum. Typically zero unless a super family statement is desired. Will be non-zero if the patient is associated with a super family and a super family statement is desired.
20	IsBalValid	tinyint(4)	True for statements generated in version 16.1 or greater, except those created via Open Dental API. Older statements did not store InsEst or BalTotal. Statements generated via Open Dental API do not use InsEst or BalTotal.
21	InsEst	double	Insurance Estimate for entire family, taken from guarantor at time of statement being sent/saved. For invoices, this field contains the total adjustment amount instead.
22	BalTotal	double	Total balance for entire family before insurance estimate. Not the same as the sum of the 4 aging balances because this can be negative.
23	StatementType	varchar(50)	Enum:StmtType Statement, Receipt, Invoice, LimitedStatement.
NotSet: Regular statement.
LimitedStatement: Contains information about specific procedures.
24	ShortGUID	varchar(30)	A short alphanumeric string used to uniquely identify this statement.
25	StatementShortURL	varchar(50)	A short URL that can be visited to view this statement. Useful to include in text messages.
26	StatementURL	varchar(255)	A URL that can be visited to view this statement.
27	SmsSendStatus	tinyint(4)	Enum:AutoCommStatus Stores what should be done or was done in regards to SMS messaging for this statement.
Undefined: 0 - Should not be in the database but can be used in the program.
DoNotSend: 1 - Do not send a reminder.
SendNotAttempted: 2 - We will send, but send has not been attempted yet.
SendSuccessful: 3 - Has been sent successfully.
SendFailed: 4 - Attempted to send but not successful.
SentAwaitingReceipt: 5 - Has been sent successfully, awaiting receipt.
28	LimitedCustomFamily	tinyint(4)	Enum:EnumLimitedCustomFamily Indicates the scope of a custom limited statement. Special behavior in getSuperFamAccount for Family and SuperFamily.
None: None=0
Patient: Patient=1
Family: Family=2
SuperFamily: SuperFamily=3
29	ShowTransSinceBalZero	tinyint(4)	Used for setting the "Show transactions since zero/negative balance" checkbox when opening/editing a statement. True for statements that were saved with "Show transactions since zero/negative balance" checked. For new statements, the value is set according to the BillingShowTransSinceBalZero pref (except for statements created from Billing, where the checkbox in the Billing Options window overrides this).

statementprod
Links production items to a statement. Also tracks whether or not a late charge adjustment has been created for the production item.
Order	Name	Type	Summary
0	StatementProdNum	bigint(20)	Primary key.
1	StatementNum	bigint(20)	FK to statement.StatementNum. The statement that the production item is on.
2	FKey	bigint(20)	Foreign key to linked production item.
3	ProdType	tinyint(4)	Enum:ProductionType Type of production item.
Procedure: 0 - Procedure
Adjustment: 1 - Adjustment
PayPlanCharge: 2 - PayPlanCharge
4	LateChargeAdjNum	bigint(20)	FK to adjustment.AdjNum. The late charge adjustment made for this production item. 0 if no late charge has been made.
5	DocNum	bigint(20)	FK to document.DocNum. The pdf document last associated to the statement. Will be 0 for statements that are sent electronically when pdfs are not saved for electronic statements.

stmtlink
Attaches individual rows of Procs, Adjustments, Payments, etc to a Statement object so that we can recreate the statement again later.
Order	Name	Type	Summary
0	StmtLinkNum	bigint(20)	Primary key.
1	StatementNum	bigint(20)	FK to statement.StatementNum.
2	StmtLinkType	tinyint(4)	Enum:StmtLinkTypes Represents what object FKey corresponds to.
Proc: 0 - Procedure
PaySplit: 1 - Pay split
Adj: 2 - Adjustment
ClaimPay: 3 - ClaimPay
PayPlanCharge: 4 - Pay plan charge
PatNum: 5 - Patient
MsgToPaySent: 6 - MsgToPaySent
3	FKey	bigint(20)	FK to type of PK of another object depending on StmtLinkType value. E.g. procedurelog.ProcNum, paysplit.PaySplitNum, adjustment.AdjNum, etc.

substitutionlink
Entries in this table will represent procedurecodes that the insurance plan wants to SKIP when considering substitution codes.
Order	Name	Type	Summary
0	SubstitutionLinkNum	bigint(20)	Primary key.
1	PlanNum	bigint(20)	FK to insplan.PlanNum.
2	CodeNum	bigint(20)	FK to procedurecode.CodeNum.
3	SubstitutionCode	varchar(25)	FK to procedurecode.ProcCode.
4	SubstOnlyIf	int(11)	Enum:SubstitutionCondition
Always: 0
Molar: 1
SecondMolar: 2
Never: 3
Posterior: 4

supplier
A company that provides supplies for the office, typically dental supplies.
Order	Name	Type	Summary
0	SupplierNum	bigint(20)	Primary key.
1	Name	varchar(255)	.
2	Phone	varchar(255)	.
3	CustomerId	varchar(255)	The customer ID that this office uses for transactions with the supplier
4	Website	text	Full address to website. We might make it clickable.
5	UserName	varchar(255)	The username used to log in to the supplier website.
6	Password	varchar(255)	The password to log in to the supplier website. Not encrypted or hidden in any way.
7	Note	text	Any note regarding supplier. Could hold address, CC info, etc.

supply
A dental supply or office supply item.
Order	Name	Type	Summary
0	SupplyNum	bigint(20)	Primary key.
1	SupplierNum	bigint(20)	FK to supplier.SupplierNum
2	CatalogNumber	varchar(255)	The catalog item number that the supplier uses to identify the supply.
3	Descript	varchar(255)	The description can be similar to the catalog, but not required. Typically includes qty per box/case, etc.
4	Category	bigint(20)	FK to definition.DefNum. User can define their own categories for supplies.
5	ItemOrder	int(11)	The zero-based order of this supply within it's category. Hidden supplies can be included in this order.
6	LevelDesired	float	Aka Stock Level. The level that a fresh order should bring item back up to. Can include fractions. If this is 0, then it will be displayed as having this field blank rather than showing 0. This simply gives a cleaner look.
7	IsHidden	tinyint(1)	If hidden, then this supply item won't normally show in the main list.
8	Price	double	The price per unit that the supplier charges for this supply. If this is 0.00, then no price will be displayed.
9	BarCodeOrID	varchar(255)	Scanned code from a reader.
10	DispDefaultQuant	float	Only used for dental schools. This is the typical quantity dispensed at the window.
11	DispUnitsCount	int(11)	Only used in dental schools. For example, 20 capsules composite per container.
12	DispUnitDesc	varchar(255)	Only used in dental schools. Description of the units when dispensing for use. For example: Capsule, cartridge, carpule, glove, or needle.
13	LevelOnHand	float	Deprecated.
14	OrderQty	int(11)	The amount to order when the next SupplyOrder is created. Creating a SupplyOrder then zeroes this out, so it's just a temporary value.

supplyneeded
A supply freeform typed in by a user.
Order	Name	Type	Summary
0	SupplyNeededNum	bigint(20)	Primary key.
1	Description	text	.
2	DateAdded	date	.

supplyorder
One supply order to one supplier. Contains SupplyOrderItems.
Order	Name	Type	Summary
0	SupplyOrderNum	bigint(20)	Primary key.
1	SupplierNum	bigint(20)	FK to supplier.SupplierNum.
2	DatePlaced	date	A date greater than 2200 (eg 2500), is considered a max date. A max date is used for an order that was started but has not yet been placed. This puts it at the end of the list where it belongs, but it will display as blank. Only one unplaced order is allowed per supplier.
3	Note	text	.
4	AmountTotal	double	The sum of all the amounts of each item on the order. If any of the item prices are zero, then it won't auto calculate this total. This will allow the user to manually put in the total without having it get deleted.
5	UserNum	bigint(20)	FK to userod.UserNum. User that placed the order, is editable.
6	ShippingCharge	double	The order's shipping charge.
7	DateReceived	date	The date the order was received. If the SupplyOrder existed before updating to version 19.4, then this value will be set to the date the office updated to 19.4.

supplyorderitem
One item on one supply order. This table links supplies to orders as well as storing a small amount of additional info.
Order	Name	Type	Summary
0	SupplyOrderItemNum	bigint(20)	Primary key.
1	SupplyOrderNum	bigint(20)	FK to supplyorder.supplyOrderNum.
2	SupplyNum	bigint(20)	FK to supply.SupplyNum.
3	Qty	int(11)	How many were ordered.
4	Price	double	Price per unit on this order.
5	DateReceived	date	Optional. The order itself already has this field. But if a partial order comes in, and if the user wants to track item dates separately, then they can do it here.

task
A task is a single todo item. Also see taskhist, which keeps a historical record.
Order	Name	Type	Summary
0	TaskNum	bigint(20)	Primary key.
1	TaskListNum	bigint(20)	FK to tasklist.TaskListNum. If 0, then it will show in the trunk of a section. This is temporarily -1 to indicate that a task is not assigned to a tasklist yet, but -1 never gets saved to the db.
2	DateTask	date	Only used if this task is assigned to a dated category. Children are NOT dated. Only dated if they should show in the trunk for a date category. They can also have a parent if they are in the main list as well.
3	KeyNum	bigint(20)	FK to patient.PatNum or appointment.AptNum. Only used when ObjectType is not 0.
4	Descript	text	The description of this task. Might be very long.
5	TaskStatus	tinyint	Enum:TaskStatusEnum New,Viewed,Done. We may want to put an index on this column someday.
New: 0
Viewed: 1
Done: 2
6	IsRepeating	tinyint	True if it is to show in the repeating section. There should be no date. All children and parents should also be set to IsRepeating=true.
7	DateType	tinyint	Enum:TaskDateType None, Day, Week, Month. If IsRepeating, then setting to None effectively disables the repeating feature.
None: 0
Day: 1
Week: 2
Month: 3
8	FromNum	bigint(20)	FK to task.TaskNum If this is derived from a repeating task, then this will hold the TaskNum of that task. It helps automate the adding and deleting of tasks. It might be deleted automatically if not are marked complete.
9	ObjectType	tinyint	Enum:TaskObjectType 0=none,1=Patient,2=Appointment. More will be added later. If a type is selected, then the KeyNum will contain the primary key of the corresponding Patient or Appointment. Does not really have anything to do with the ObjectType of the parent tasklist, although they tend to match.
None: 0
Patient: 1
Appointment: 2
10	DateTimeEntry	datetime	The date and time that this task was added. User editable. For reminder tasks, this field is used to indicate the date and time the reminder will take effect.
11	UserNum	bigint(20)	FK to userod.UserNum. The person who created the task.
12	DateTimeFinished	datetime	The date and time that this task was marked "done".
13	PriorityDefNum	bigint(20)	FK to definition.DefNum. The priority for this task which is used when filling task lists. The placement of the task in the list is dependent on the item order of the definitions.
14	ReminderGroupId	varchar(20)	Optional. Set to null or empty if not a reminder task. For repeating reminders, the ReminderGroupId will be the same for each task spawned from any task in the group.
15	ReminderType	smallint(6)	Bit field.
16	ReminderFrequency	int(11)	
17	DateTimeOriginal	datetime	The original datetime that the row was inserted. Used to sort the list by the order entered. Using taskhist.DateTimeOriginal will get the datetime that the task row was inserted, not the taskhist.
18	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed.
19	DescriptOverride	varchar(255)	Limited to 256 char. If present, shows only this text in task list grids instead of prepending date, aggregating notes, etc. Shows as Short Descript in the UI for space reasons.
20	IsReadOnly	tinyint(1)	Determines if this task can be edited by most users. Currently only used at HQ.
21	Category	bigint(20)	FK to definition.DefNum. Only used when pref.TaskCategoryShow is set to true.
22	TriagePosition	int(11)	The position in the 'Triage' tasklist that a task was in when it was claimed by a support technician. It is 1 indexed. Only used for our 'Triage' tasklist at OD HQ and is for training purposes.

taskancestor
Represents one ancestor of one task. Each task will have at least one ancestor unless it is directly on a main trunk. An ancestor is defined as a tasklist that is higher in the hierarchy for the task, regardless of how many levels up it is. This allows us to mark task lists as having "new" tasks, and it allows us to quickly check for new tasks for a user on startup.
Order	Name	Type	Summary
0	TaskAncestorNum	bigint(20)	Primary key.
1	TaskNum	bigint(20)	FK to task.TaskNum
2	TaskListNum	bigint(20)	FK to tasklist.TaskListNum

taskattachment
An attachment to a task. Attachment can be a document or a string.
Order	Name	Type	Summary
0	TaskAttachmentNum	bigint(20)	Primary key.
1	TaskNum	bigint(20)	FK to task.TaskNum.
2	DocNum	bigint(20)	FK to document.DocNum. If no document is attached, then this field will be 0.
3	TextValue	text	Used to store text that doesn't need to be visible from the main task edit window at all times.
4	Description	varchar(255)	A brief description of this attachment. If document is linked, used for document description as well.

taskhist
A historical copy of a task. These are generated as a result of a task being edited, so there can be multiple entries here per task. When creating for insertion it needs a passed-in Task object.
Order	Name	Type	Summary
0	TaskHistNum	bigint(20)	Primary key.
1	UserNumHist	bigint(20)	FK to userod.UserNum Identifies the user that changed this task from this state, not the person who originally wrote it.
2	DateTStamp	datetime	The date and time that this task was edited and added to the Hist table. This value will not be updated by MySQL whenever the row changes.
3	IsNoteChange	tinyint(4)	True if the note was changed when this historical copy was created.
4	TaskNum	bigint(20)	Copied from Task.
5	TaskListNum	bigint(20)	Copied from Task.
6	DateTask	date	Copied from Task.
7	KeyNum	bigint(20)	Copied from Task.
8	Descript	text	Copied from Task.
9	TaskStatus	tinyint(4)	Copied from Task.
10	IsRepeating	tinyint(4)	Copied from Task.
11	DateType	tinyint(4)	Copied from Task.
12	FromNum	bigint(20)	Copied from Task.
13	ObjectType	tinyint(4)	Copied from Task.
14	DateTimeEntry	datetime	Copied from Task.
15	UserNum	bigint(20)	Copied from Task.
16	DateTimeFinished	datetime	Copied from Task.
17	PriorityDefNum	bigint(20)	Copied from Task.
18	ReminderGroupId	varchar(20)	Copied from Task.
19	ReminderType	smallint(6)	Copied from Task.
20	ReminderFrequency	int(11)	Copied from Task.
21	DateTimeOriginal	datetime	Copied from Task.
22	SecDateTEdit	timestamp	Not copied from Task. Automatically updated by MySQL every time a row is added or changed.
23	DescriptOverride	varchar(255)	Copied from Task.
24	IsReadOnly	tinyint(1)	Copied from Task.
25	Category	bigint(20)	Copied from Task.
26	TriagePosition	int(11)	Copied from Task.

tasklist
A tasklist is like a folder system, where it can have child tasklists as well as tasks.
Order	Name	Type	Summary
0	TaskListNum	bigint(20)	Primary key.
1	Descript	varchar(255)	The description of this tasklist. Might be very long, but not usually.
2	Parent	bigint(20)	FK to tasklist.TaskListNum The parent task list to which this task list is assigned. If zero, then this task list is on the main trunk of one of the sections.
3	DateTL	date	Optional. Set to 0001-01-01 for no date. If a date is assigned, then this list will also be available from the date section.
4	IsRepeating	tinyint	True if it is to show in the repeating section. There should be no date. All children should also be set to IsRepeating=true.
5	DateType	tinyint	Enum:TaskDateType None, Day, Week, Month. If IsRepeating, then setting to None effectively disables the repeating feature.
None: 0
Day: 1
Week: 2
Month: 3
6	FromNum	bigint(20)	FK to tasklist.TaskListNum If this is derived from a repeating list, then this will hold the TaskListNum of that list. It helps automate the adding and deleting of lists. It might be deleted automatically if no tasks are marked complete.
7	ObjectType	tinyint	Enum:TaskObjectType 0=none, 1=Patient, 2=Appointment. More will be added later. If a type is selected, then this list will be visible in the appropriate places for attaching the correct type of object. The type is not copied to a task when created. Tasks in this list do not have to be of the same type. You can only attach an object to a task, not a tasklist.
None: 0
Patient: 1
Appointment: 2
8	DateTimeEntry	datetime	The date and time that this list was added. Used to sort the list by the order entered.
9	GlobalTaskFilterType	tinyint(4)	Enum:GlobalTaskFilterType 0=Disabled, 1=Default, 2=None, 3=Clinic, 4=Region. If a type is selected, then tasks in this tasklist will be filtered by default such that only tasks that match the tasklist's GlobalFilterType will show in the view. Disabled is not valid for tasklists and will be treated as Default if applied to a tasklist; it is only valid on the TasksGlobalFilterType preference.
10	TaskListStatus	tinyint(4)	Enum:TaskListStatusEnum 0=Active, 1=Archived. Archived task lists are hidden from the Task Window's User, Main, and Reminder tabs by default.
Active: 0 - Active.
Archived: 1 - Archived.

tasknote
A tasknote is a note that may be added to a task. Many notes may be attached to a task. A user may only edit their own tasknotes within a task.
Order	Name	Type	Summary
0	TaskNoteNum	bigint(20)	Primary key.
1	TaskNum	bigint(20)	FK to task.TaskNum. The task this tasknote is attached to.
2	UserNum	bigint(20)	FK to userod.UserNum. The user who created this tasknote.
3	DateTimeNote	datetime	Date and time the note was created or last modified (editable).
4	Note	text	Note. Text that the user wishes to show on the task.

tasksubscription
A subscription of one user to either a tasklist or to a task.
Order	Name	Type	Summary
0	TaskSubscriptionNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum
2	TaskListNum	bigint(20)	FK to tasklist.TaskListNum When this is not 0 then TaskNum will be 0.
3	TaskNum	bigint(20)	FK to task.TaskNum. When this is not 0 then TaskListNum will be 0.

taskunread
When a task is created or a comment made, a series of these taskunread objects are created, one for each user who is subscribed to the tasklist. Duplicates are intelligently avoided. Rows are deleted once user reads the task.
Order	Name	Type	Summary
0	TaskUnreadNum	bigint(20)	Primary key.
1	TaskNum	bigint(20)	FK to task.TaskNum.
2	UserNum	bigint(20)	FK to userod.UserNum.

terminalactive
Each row is 1 computer, or if in RDP session, 1 connection from 1 computer, currently acting as a terminal for patient input.
Order	Name	Type	Summary
0	TerminalActiveNum	bigint(20)	Primary key.
1	ComputerName	varchar(255)	The name of the computer where the terminal is active. On RDP, this is client name.
2	TerminalStatus	tinyint	Enum:TerminalStatusEnum No longer used. Instead, the PatNum field is used. Used to indicates at what point the patient was in the sequence. 0=standby, 1=PatientInfo, 2=Medical, 3=UpdateOnly. If status is 1, then nobody else on the network could open the patient edit window for that patient.
Standby: 0
PatientInfo: 1
Medical: 2
UpdateOnly: 3. Only the patient info tab will be visible. This is just to let patient up date their address and phone number.
3	PatNum	bigint(20)	FK to patient.PatNum. The patient currently showing in the terminal. If 0, then terminal is in standby mode.
4	SessionId	int(11)	The ID of the session from which this terminal instance was started. The session ID is unique per computer login, so if this is a terminal server every remote connection will have a unique session ID. A kiosk is identified by ComputerName+SessionId+ProcessId.
5	ProcessId	int(11)	The ID of the process that initiated this kiosk instance. This is unique per active computer process, so if a row exists with a ProcessId that matches the instance we're about to start, we know it is safe to delete it, it must be left over and needs cleaned up.
6	SessionName	varchar(255)	The name of the computer used to make the remote connection to the app server when enabling kiosk mode. Could also be a name manually entered by the user if there's already a connection to the app server from the same computer session. This serves as a human-readable name for the ComputerName+SessionId+ProcessId to uniquely identify a kiosk. We will display the ComputerName and SessionName to the user in the kiosk manager, but we will use the ComputerName+SessionId+ProcessId when the kiosk checks for available forms to display.

timeadjust
Used on employee timecards to make adjustments. Used to make the end-of-the week OT entries. Can be used instead of a clock event by admin so that a clock event doesn't have to be created.
Order	Name	Type	Summary
0	TimeAdjustNum	bigint(20)	Primary key.
1	EmployeeNum	bigint(20)	FK to employee.EmployeeNum
2	TimeEntry	datetime	The date and time that this entry will show on timecard.
3	RegHours	time	The number of regular hours to adjust timecard by. Can be + or -.
4	OTimeHours	time	Overtime hours. Usually +. Automatically combined with a - adj to RegHours. Another option is clockevent.OTimeHours.
5	Note	text	.
6	IsAuto	tinyint(4)	Set to true if this adjustment was automatically made by the system. When the calc weekly OT tool is run, these types of adjustments are fair game for deletion. Other adjustments are preserved.
7	ClinicNum	bigint(20)	FK to clinic.ClinicNum. The clinic the TimeAdjust was entered at.
8	PtoDefNum	bigint(20)	FK to definition.DefNum. Defaults to 0. Is set to 0 for general adjustments. When not 0, points to a definition in the TimeCardAdjTypes category.
9	PtoHours	time	PTO Hours. The number of PTO hours applied to a specific day. Ignored if PtoDefNum is 0.
10	IsUnpaidProtectedLeave	tinyint(4)	Defaults to false. True when this TimeAdjust is for unpaid protected leave. Hours from unpaid protected leave adjustments contribute to hours worked, but not to payable hours.
11	SecuUserNumEntry	bigint(20)	FK to userod.UserNum. The user that created this TimeAdjust.

timecardrule
A rule for automation of timecard overtime. Can apply to one employee or all.
Order	Name	Type	Summary
0	TimeCardRuleNum	bigint(20)	Primary key.
1	EmployeeNum	bigint(20)	FK to employee.EmployeeNum. If zero, then this rule applies to all employees.
2	OverHoursPerDay	time	Typical example is 8:00. In California, any work after the first 8 hours is overtime.
3	AfterTimeOfDay	time	Typical example is 16:00 to indicate that all time worked after 4pm for specific employees is at Rate2 rate.
4	BeforeTimeOfDay	time	Typical example is 6:00 to indicate that all time worked before 6am for specific employees is at Rate2 rate.
5	IsOvertimeExempt	tinyint(4)	Indicates if the employee should have overtime calculated for their hours worked in a pay period.
6	MinClockInTime	time	When set this is the earliest an employee can clock in. Otherwise minimum dateTime represents not set.
7	HasWeekendRate3	tinyint(4)	Indicates if the employee is eligible to earn Rate3 rate for weekend hours.

toolbutitem
Each row represents one toolbar button to be placed on a toolbar and linked to a program.
Order	Name	Type	Summary
0	ToolButItemNum	bigint(20)	Primary key.
1	ProgramNum	bigint(20)	FK to program.ProgramNum.
2	ToolBar	smallint	Enum:EnumToolBar The toolbar to show the button on.
AccountModule: 0
ApptModule: 1
ChartModule: 2
ImagingModule: 3
FamilyModule: 4
TreatmentPlanModule: 5
ClaimsSend: 6
MainToolbar: 7 Shows in the toolbar at the top that is common to all modules.
ReportsMenu: 8 Shows in the main menu Reports submenu.
3	ButtonText	varchar(255)	The text to show on the toolbar button.

toothgridcell
Holds one recorded cell value for a tooth grid, which is a special kind of sheet field type that shows a grid with 32 rows and configurable columns. The entire grid is a single large sheet field.
Order	Name	Type	Summary
0	ToothGridCellNum	bigint(20)	Primary key.
1	SheetFieldNum	bigint(20)	FK to sheetfield.SheetFieldNum. Required.
2	ToothGridColNum	bigint(20)	FK to toothgridcol.ToothGridColNum. This tells which column it belongs in. Can't use the column name here because multiple columns could have the same name.
3	ValueEntered	varchar(255)	Cannot be empty. For a tooth-level cell, the only allowed value is X. If the cell is unchecked, then it won't even have a row in this table. For a surface level column, only valid surfaces can be entered:MOIDBFLV Enforced. FreeText columns can have any text up to 255 char.
4	ToothNum	varchar(10)	Corresponds exactly to procedurelog.ToothNum. May be blank, otherwise 1-32, 51-82, A-T, or AS-TS, 1 or 2 char. Gets internationalized as being displayed.

toothgridcol
Defines the columns present in a single completed tooth grid, which is a special kind of sheet field that shows a grid with 32 rows and configurable columns. The entire grid is a single large sheet field. This table defines how the grid is layed out on an actual sheet, pulled initially from a ToothGridDef. The data itself is recorded in ToothGridCell.
Order	Name	Type	Summary
0	ToothGridColNum	bigint(20)	Primary key.
1	SheetFieldNum	bigint(20)	FK to sheet.SheetFieldNum. Required.
2	NameItem	varchar(255)	Pulled from the ToothGridDef. This can be a NameInternal , or it can be a NameShowing if it's a user-defined column.
3	CellType	tinyint(4)	Enum:ToothGridCellType 0=HardCoded, 1=Tooth, 2=Surface, 3=FreeText.
HardCoded: 0
Tooth: 1
Surface: 2
FreeText: 3
4	ItemOrder	smallint(6)	Order of the column to display. Every entry must have a unique itemorder.
5	ColumnWidth	smallint(6)	.
6	CodeNum	bigint(20)	FK to procedurecode.CodeNum. This allows data entered to flow into main program as actual completed or tp procedures.
7	ProcStatus	tinyint(4)	Enum:ProcStat If these flow into main program, then this is the status that the new procs will have.
TP: 1- Treatment Plan.
C: 2- Complete.
EC: 3- Existing Current Provider.
EO: 4- Existing Other Provider.
R: 5- Referred Out.
D: 6- Deleted.
Cn: 7- Condition.
TPi: 8- Treatment Plan inactive.

toothgriddef
Defines the columns present in a tooth grid, which is a special kind of sheet field def that shows a grid with 32 rows and configurable columns. Can be edited without damaging any completed sheets.
Order	Name	Type	Summary
0	ToothGridDefNum	bigint(20)	Primary key.
1	NameInternal	varchar(255)	This is the internal name that OD uses to identify the column. Blank if this is a user-defined column. We will keep a hard-coded list of available NameInternals in the code to pick from.
2	NameShowing	varchar(255)	The user may override the internal name for display purposes. If this is a user-defined column, this is the only name, since there is no NameInternal.
3	CellType	tinyint(4)	Enum:ToothGridCellType 0=HardCoded, 1=Tooth, 2=Surface, 3=FreeText.
HardCoded: 0
Tooth: 1
Surface: 2
FreeText: 3
4	ItemOrder	smallint(6)	Order of the column to display. Every entry must have a unique itemorder.
5	ColumnWidth	smallint(6)	.
6	CodeNum	bigint(20)	FK to procedurecode.CodeNum. This allows data entered to flow into main program as actual completed or tp procedures.
7	ProcStatus	tinyint(4)	Enum:ProcStat If these flow into main program, then this is the status that the new procs will have.
TP: 1- Treatment Plan.
C: 2- Complete.
EC: 3- Existing Current Provider.
EO: 4- Existing Other Provider.
R: 5- Referred Out.
D: 6- Deleted.
Cn: 7- Condition.
TPi: 8- Treatment Plan inactive.
8	SheetFieldDefNum	bigint(20)	FK to sheetfielddef.SheetFieldDefNum

toothinitial
Used to track missing teeth, primary teeth, movements, and drawings.
Order	Name	Type	Summary
0	ToothInitialNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum
2	ToothNum	varchar(2)	1-32 or A-Z. Supernumeraries not supported here yet.
3	InitialType	tinyint	Enum:ToothInitialType
Missing: 0
Hidden: 1 - Also hides the number. Number can be primary or permanent.
Primary: 2 - Only used with 1-32. "sets" this tooth as a primary tooth. The result is that the primary tooth shows in addition to the perm, and that the letter shows in addition to the number. It also does a Shift0 -12 and some other handy movements. Even if this is set to true, there can be a separate entry for a missing primary tooth; this would be almost equivalent to not even setting the tooth as primary, but would also allow user to select the letter.
ShiftM: 3 - Mesial mm
ShiftO: 4 - Occlusal/incisal mm
ShiftB: 5 - Buccal aka Labial mm
Rotate: 6 - Clockwise as viewed from occlusal/incisal.
TipM: 7 - Mesial degrees
TipB: 8 - Buccal degrees
Drawing: 9 - One segment of a drawing.
Text: 10 - Location and string, combined
4	Movement	float	Shift in mm, or rotation / tipping in degrees.
5	DrawingSegment	text	Point data for a drawing segment. The format would look similar to this: 45,68;48,70;49,72;0,0;55,88;etc. It's simply a sequence of points, separated by semicolons. Only positive numbers are used. 0,0 is the upper left of the tooth chart, and the lower right is at 410,307. This scale of 410,307 is always used, regardless of how the tooth chart control is scaled for viewing. Floats with tenths can be included. If the pen is picked up, it becomes a new segment, so a new row in the database.
6	ColorDraw	int(11)	.
7	SecDateTEntry	datetime	Timestamp automatically generated and user not allowed to change. The actual date of entry.
8	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
9	DrawText	varchar(255)	For text not associated with any tooth. The location of the text within 410,307 is incorporated into this string. Example: 25.3,123.8;This shows. Carriage returns etc are not supported. ColorDraw is used.

transaction
Used in the accounting section of the program. Each row is one transaction in the ledger, and must always have at least two JournalEntries (splits). All JournalEntries must always add up to zero.
Order	Name	Type	Summary
0	TransactionNum	bigint(20)	Primary key.
1	DateTimeEntry	datetime	Not user editable. Server time.
2	UserNum	bigint(20)	FK to userod.UserNum. The user that entered this transaction.
3	DepositNum	bigint(20)	FK to deposit.DepositNum. Will eventually be replaced by a source document table, and deposits will just be one of many types.
4	PayNum	bigint(20)	FK to payment.PayNum. Like DepositNum, it will eventually be replaced by a source document table, and payments will just be one of many types.
5	SecUserNumEdit	bigint(20)	FK to userod.UserNum. The user who last edited this transaction.
6	SecDateTEdit	timestamp	The last time this transaction was edited.
7	TransactionInvoiceNum	bigint(20)	FK to transactioninvoice.TransactionInvoiceNum. A document that can be attached to the transaction.
8	NeedsReview	tinyint(4)	Deprecated

transactioninvoice
Used in the accounting section of the program. Each row contains a document that is attached to a transaction.
Order	Name	Type	Summary
0	TransactionInvoiceNum	bigint(20)	Primary key.
1	FileName	varchar(255)	File name including the extension.
2	InvoiceData	mediumtext	The raw file data converted to base64. Will be blank when using FilePath.
3	FilePath	varchar(255)	Full file path. Will be blank when using InvoiceData.

treatplan
Stores all treatment plans, including Active, Inactive, and Saved treatment plans. Active and Inactive treatment plans use treatplanattaches to reference attached procedures. As procedures are set complete, they get removed from active and inactive treatment plans. Saved treatment plans use proctps, which are copies of the procedure, and will not change after being saved.
Order	Name	Type	Summary
0	TreatPlanNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	DateTP	date	The date of the treatment plan
3	Heading	varchar(255)	The heading that shows at the top of the treatment plan. Usually 'Proposed Treatment Plan'
4	Note	text	A note specific to this treatment plan that shows at the bottom.
5	Signature	text	The encrypted and bound signature in base64 format. The signature is bound to the concatenation of the tp Note, DateTP, and to each proctp Descript and PatAmt.
6	SigIsTopaz	tinyint(1)	True if the signature is in Topaz format rather than OD format.
7	ResponsParty	bigint(20)	FK to patient.PatNum. Can be 0. The patient responsible for approving the treatment. Public health field not visible to everyone else.
8	DocNum	bigint(20)	FK to document.DocNum. Can be 0. If signed, this is the pdf document of the TP at time of signing. See PrefName.TreatPlanSaveSignedToPdf
9	TPStatus	tinyint(4)	Enum:TreatPlanStatus Determines the type of treatment plan this is. 0 - Saved, 1 - Active, 2 - Inactive.
Saved: 0 - Saved treatment plans. Prior to version 15.4.1 all treatment plans were considered archived. Archived TPs are linked to ProcTPs.
Active: 1 - Current active TP. There should be only one Active TP per patient. This is a TP linked directly to procedures via the TreatPlanAttach table.
Inactive: 2 - Current inactive TP. This is a TP linked directly to procedures via the TreatPlanAttach table.
10	SecUserNumEntry	bigint(20)	FK to userod.UserNum. Set to the user logged in when the row was inserted at SecDateEntry date and time.
11	SecDateEntry	date	Timestamp automatically generated and user not allowed to change. The actual date of entry.
12	SecDateTEdit	timestamp	Automatically updated by MySQL every time a row is added or changed. Could be changed due to user editing, custom queries or program updates. Not user editable with the UI.
13	UserNumPresenter	bigint(20)	FK to userod.UserNum. The user that will present the treatment plan. Defaults to the user that entered the treatment plan, but can be changed with the TreatPlanPresenterEdit permission.
14	TPType	tinyint(4)	Enum:TreatPlanType Determines the type of insurance this treatment plan was saved with. Used for displaying proper information when loading.
Insurance: 0 - Treatment plan saved for regular insurance.
Discount: 1 - Treatment plan saved for discount plan.
15	SignaturePractice	text	The encrypted and bound signature in base64 format. The signature is bound to the concatenation of the tp Note, DateTP, and to each proctp Descript and PatAmt.
16	DateTSigned	datetime	The date of the treatment plan is signed.
17	DateTPracticeSigned	datetime	The date of the treatment plan is signed by the office.
18	SignatureText	varchar(255)	The typed name of the person who signed the treatplan.
19	SignaturePracticeText	varchar(255)	The typed name of the person who signed the practice signature.
20	MobileAppDeviceNum	bigint(20)	FK to mobileappdevice.

treatplanattach
Links active and inactive treatment plans to procedurelog rows. When the treatment plan or chart modules are selected, any treatplanattach rows that are linked to completed or deleted procedures will be deleted.
Order	Name	Type	Summary
0	TreatPlanAttachNum	bigint(20)	Primary key.
1	TreatPlanNum	bigint(20)	FK to treatplan.TreatPlanNum.
2	ProcNum	bigint(20)	FK to procedurelog.ProcNum.
3	Priority	bigint(20)	FK to definition.DefNum, which contains the text of the priority. Identical to Procedure.Priority but used to allow different priorities for the same procedure depending on which TP it is a part of.

treatplanparam
Stores check box information for each treatment plan, so that when a signed treatment plan PDF needs to be saved from eClipboard, it can correctly save and generate the PDF.
Order	Name	Type	Summary
0	TreatPlanParamNum	bigint(20)	
1	PatNum	bigint(20)	FK to patient.
2	TreatPlanNum	bigint(20)	FK to treatplan.
3	ShowDiscount	tinyint(4)	Value is set by the Discount check box in the Tx Module.
4	ShowMaxDed	tinyint(4)	Value is set by the Use Ins Max and Deduct check box in the Tx Module.
5	ShowSubTotals	tinyint(4)	Value is set by the Subtotals check box in the Tx Module.
6	ShowTotals	tinyint(4)	Value is set by the Totals check box in the Tx Module.
7	ShowCompleted	tinyint(4)	Value is set by the Graphical Completed Tx check box in the Tx Module.
8	ShowFees	tinyint(4)	Value is set by the Fees check box in the Tx Module.
9	ShowIns	tinyint(4)	Value is set by the Insurances Estimates check box in the Tx Module.

tsitranslog
Transworld Systems Inc (TSI) transaction log. Logs communication between the Open Dental program and TSI. Entries contain information about accounts placed with TSI, payments or adjustments to accounts placed, or transactions to Suspend, Reinstate or Cancel accounts.
Order	Name	Type	Summary
0	TsiTransLogNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum for the guarantor of the account sent to TSI for collection services. TSI refers to this as the Debtor Reference or Responsible Party Account Number.
2	UserNum	bigint(20)	FK to userod.UserNum. The user who sent the account for placement with TSI or who suspended, reinstated or cancelled collection services for an account placed with TSI or who created the payment/adjustment for an account placed with TSI.
3	TransType	tinyint(4)	Enum:TsiTransType - Identifies the transaction message sent to TSI. Can be a message for placing/cancelling/suspending/reinstating collection services for an account or to notify TSI of a payment/writeoff/adjustment entered into OD.
None: -1 - None: Used for marking trans that represent account items NOT sent to Transworld. The TsiTransLogs with this trans type are used to prevent the ODService from sending the trans to Transworld. Example: Transworld collects a payment from a patient and deduct their fee and send the practice the remaining amt. Office staff will enter the payment in the patient's account and then enter an adjustment to account for Transworld's fee. TsiTransLogs will be inserted for the paysplits and adjustment so that we don't send those trans to Transworld and cause an infinite loop of sorts. Logs with this type will be update by the ODService if the ledger trans amt is updated.
CN: 0 - Cancel: cancel collection services for an account. Collection services can be restarted but will incur another TSI fee.
CR: 1 - Credit Adjustment: negative adjustment to reduce balance. Example: a discount given or portion of the debt written off.
DB: 2 - Debit Adjustment: positive adjustment to increase balance. Offices are supposed to stop all finance charges once placed with TSI, but there may be other transactions that require increasing the amount owed.
PF: 3 - Paid in Full: payment entered that pays off account balance. Closes account with TSI and stops collection activity.
PL: 4 - Placement: account sent to TSI for Accelerator/Profit Recovery/Collection services.
PP: 5 - Partial Payment: payment by either patient or ins payment/writeoff that pays a portion of the balance.
PT: 6 - Paid in Full, Thank You: payment entered that pays off account balance. Closes account with TSI and stops collection activity. TSI will send a Thank You letter to the patient free of charge.
RI: 7 - Reinstate: an account that has been suspended can be reinstated within 50 days and the collection services will resume where it left off. After 50 days the account is automatically cancelled and in order to restart collection services the office would have to initiate a new placement, which will incur another TSI fee.
SS: 8 - Suspend: places collection services for the account on hold for up to 50 days. Example: After an account is placed with TSI, the customer comes into the office and agrees to a payment plan. The account can be suspended and if the patient fails to make a payment within 50 days the account can be reinstated and the collection process will resume where it left off and TSI will not charge an additional fee. After 50 days the account is automatically cancelled by TSI and in order to restart the collection process, the office would have to initiate a new placement which starts the collection process over and will result in an additional TSI fee.
Agg: 9 - To differentiate aggregate rows from rows linked to transactions in the OD db.
Excluded: 10 - Used for adjustments entered with the SyncExcludePosAdjType or SyncExcludeNegAdjType set in the Transworld program link. Excluded from syncing with TSI and from the amount due calculation used in future msgs or to determine if the acct is paid in full.
4	TransDateTime	datetime	Timestamp at which this row was created. Auto generated on insert. Identifies exactly when the action happened in OD to cause the message to be sent to TSI.
5	ServiceType	tinyint(4)	Enum:TsiServiceType - for placements, this is the type of collection activity that will start on the account being placed.
Accelerator: 0 - Accelerator
ProfitRecovery: 1 - Profit Recovery
ProfessionalCollections: 2 - Professional Collections
6	ServiceCode	tinyint(4)	Enum:TsiServiceCode - for placements, intensity of first letter sent to guarantor. Will usually be 0 - Diplomatic.
Diplomatic: 0 - Diplomatic: most commonly used service code.
Intensive: 1 - Intensive: More intense first letter.
BadCheck: 3 - Bad Check: in a conference call with TSI one of the reps said this is rarely used.
7	TransAmt	double	Used for payments/writeoffs/adjustments, amount applied to the debt.
8	AccountBalance	double	Total balance due on the account by the patient, i.e. BalTotal-InsPayEst-WoEst. If this is a placement, this is the debt amount TSI is going to attempt to collect. If this is a payment/writeoff/adjustment, this is the new balance after the transaction amount is applied to the debt.
9	FKeyType	tinyint(4)	Enum:TsiFKeyType - Used in conjunction with FKey to point to the item that this log row represents.
None: -1 - None. For place, suspend, cancel, agg.
Adjustment: 0 - adjustment.AdjNum. Can be a positive (Debit) or negative (Credit) adjustment to the amount owed. The resulting message TsiTransType is DB (Debit) for positive adjustments or CR (Credit) for negative adjustments.
Claimproc: 1 - claimproc.ClaimProcNum. For ins payments and/or writeoffs entered after the account has been placed with TSI. The resulting message TsiTransType is PP (Partial Payment), PF (Paid in Full), or PT (Paid in Full, Thank You).
PayPlan: 2 - payplan.PayPlanNum. In payplan version 1 the entire CompletedAmt is aged, so it will be negative (credit) and decrease the amount owed. The resulting message TsiTransType is CR (Credit).
PayPlanCharge: 3 - payplancharge.PayPlanChargeNum. Depends on payplan version, could be negative (credit - decrease amount owed) or positive (debit - increase amount owed). The resulting message TsiTransType is DB (Debit) if positive or CR (Credit) if negative.
PaySplit: 4 - paysplit.SplitNum. Patient payment on an account placed with TSI. The resulting message TsiTransType is PP (Partial Payment), PF (Paid in Full), or PT (Paid in Full, Thank You).
Procedure: 5 - procedurelog.ProcNum. Positive (debit, increases the amount owed). The resulting message TsiTransType is DB (Debit).
10	FKey	bigint(20)	Foreign key to the table defined by the corresponding FKeyType. Currently supports paysplit.SplitNum, claimproc.ClaimProcNum, adjustment.AdjNum, procedurelog.ProcNum, payplan.PayPlanNum, payplancharge.PayPlanChargeNum.
11	RawMsgText	varchar(1000)	Raw pipe-delimited message sent to TSI.
12	ClientId	varchar(25)	If ServiceType for the placement is TsiDemandType.AcceleratorPr, this will be the Accelerator/Profit Recovery client ID. If TsiServiceType.Collection it will be the Collection client ID. Will always match the first field, Client Number, in the RawMsgText.
13	TransJson	mediumtext	Json serialized string representation of the TsiTrans list used to calculate the account balance for this guarantor at the time of placement with Transworld. Used to update Transworld if any of the transactions are modified after placement.
14	ClinicNum	bigint(20)	FK to clinic.ClinicNum. This will be 0 if clinics are not enabled. This will be 0 for logs prior to version 18.4.
15	AggTransLogNum	bigint(20)	FK to tsitranslog.TransLogNum. Will be 0 if not part of an aggregate group. Will be 0 for logs prior to version 18.4.

ucum
Unified Code for Units of Measure. UCUM is not a stricly defined list of codes but is instead a language definition that allows for all units and derived units to be named. Examples: g (grams), g/L (grams per liter), g/L/s (grams per liter per second), g/L/s/s (grams per liter per second per second), etc... are all allowed units meaning there is an infinite number of units that can be defined using UCUM conventions. The codes stored in this table are merely a common subset that was readily available and premade.
Order	Name	Type	Summary
0	UcumNum	bigint(20)	Primary key.
1	UcumCode	varchar(255)	Indexed. Also called concept code. Example: mol/mL
2	Description	varchar(255)	Also called Concept Name. Human readable form of the UCUM code. Example: Moles Per MilliLiter [Substance Concentration Units]
3	IsInUse	tinyint(4)	True if this unit of measure is or has ever been in use. Useful for assisting users to select common units.

updatehistory
Makes an entry every time Open Dental has successfully updated to a newer version. New entries will always be for the newest version being used so that users can see a "history" of how long they used previous versions. This will also help EHR customers when attesting or when they get audited.
Order	Name	Type	Summary
0	UpdateHistoryNum	bigint(20)	Primary key.
1	DateTimeUpdated	datetime	DateTime that OD was updated to the Version.
2	ProgramVersion	varchar(255)	The version that OD was updated to.
3	Signature	text	Obfuscated string containing when and who accepted the license agreement.

userclinic
This creates a many-to-many relationship between users and clinics. An entry in this table means that the user has access to the clinic. Not used unless userod.ClinicIsRestricted is turned on for a user. Userod.Clinic is also used separately, regardless of whether this table is used. Provider access is derived from this by using the userod.ProvNum.
Order	Name	Type	Summary
0	UserClinicNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum

usergroup
A group of users. Security permissions are determined by the usergroup of a user.
Order	Name	Type	Summary
0	UserGroupNum	bigint(20)	Primary key.
1	Description	varchar(255)	.
2	UserGroupNumCEMT	bigint(20)	FK to usergroup.UserGroupNum. The user group num within the Central Manager database. Only editable via CEMT. Can change when CEMT syncs.

usergroupattach
Allows multiple groups to be attached to a user. Security permissions are determined by the usergroups of a user.
Order	Name	Type	Summary
0	UserGroupAttachNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	UserGroupNum	bigint(20)	FK to usergroup.UserGroupNum.

userod
(User OD since "user" is a reserved word) Users are a completely separate entity from Providers and Employees even though they can be linked. A usernumber can never be changed, ensuring a permanent way to record database entries and leave an audit trail. A user can be a provider, employee, or neither.
Order	Name	Type	Summary
0	UserNum	bigint(20)	Primary key.
1	UserName	varchar(255)	.
2	Password	varchar(255)	The password details in a "HashType$Salt$Hash" format, separating the different fields by '$'. This is NOT the actual password but the encoded password hash. If the contents of this variable are not in the aforementioned format, it is assumed to be a legacy password hash (MD5).
3	UserGroupNum	bigint(20)	Deprecated. Use UserGroupAttaches to link Userods to UserGroups.
4	EmployeeNum	bigint(20)	FK to employee.EmployeeNum. Used for timecards to block access by other users.
5	ClinicNum	bigint(20)	FK to clinic.ClinicNum. Default clinic for this user. It causes new patients to default to this clinic when entered by this user. If 0, then user has no default clinic or default clinic is HQ if clinics are enabled. Also see userod.ClinicIsRestricted and userclinic table.
6	ProvNum	bigint(20)	FK to provider.ProvNum. It is possible to have multiple userods attached to a single provider.
7	IsHidden	tinyint(1)	Set true to hide user from login list.
8	TaskListInBox	bigint(20)	FK to tasklist.TaskListNum. 0 if no inbox setup yet. It is assumed that the TaskList is in the main trunk, but this is not strictly enforced. User can't delete an attached TaskList, but they could move it.
9	AnesthProvType	int(2)	Defaults to 3 (regular user) unless specified. Helps populates the Anesthetist, Surgeon, Assistant and Circulator dropdowns properly on FormAnestheticRecord///
10	DefaultHidePopups	tinyint(4)	If set to true, the BlockSubsc button will start out pressed for this user.
11	PasswordIsStrong	tinyint(4)	Gets set to true if strong passwords are turned on, and this user changes their password to a strong password. We don't store actual passwords, so this flag is the only way to tell.
12	ClinicIsRestricted	tinyint(4)	When true, prevents user from having access to clinics that are not in the corresponding userclinic table. Many places throughout the program will optionally remove the 'All' option from this user when true. Also see userod.ClinicNum and userclinic table. This field handles the double negative issue because the default must be no restriction.
13	InboxHidePopups	tinyint(4)	If set to true, the BlockInbox button will start out pressed for this user.
14	UserNumCEMT	bigint(20)	FK to userod.UserNum. The user num within the Central Manager database. Only editable via CEMT. Can change when CEMT syncs.
15	DateTFail	datetime	The date and time of the most recent log in failure for this user. Set to MinValue after user logs in successfully.
16	FailedAttempts	tinyint	The number of times this user has failed to log into their account. Set to 0 after user logs in successfully.
17	DomainUser	varchar(255)	The username for the ActiveDirectory user to link the account to. Consists of the Pref DomainObjectGuid followed by the domain user name. Example:634dd357-3902-48e2-b6d3-9b84dada6bd2\KyleG.
18	IsPasswordResetRequired	tinyint(4)	Boolean. If true, the user's password needs to be reset on next login.
19	MobileWebPin	varchar(255)	A hashed pin that is used for mobile web validation on eClipboard. Not used in OD proper.
20	MobileWebPinFailedAttempts	tinyint	The number of attempts the mobile web pin has failed. Reset on successful attempt.
21	DateTLastLogin	datetime	Minimum date if last login date and time is unknown. Otherwise contians the last date and time this user successfully logged in.
22	EClipboardClinicalPin	varchar(128)	Pin for ODT. This is the hashed value of the pin. Not used in OD proper.
23	BadgeId	varchar(255)	A unique number that corresponds to the number on an employee badge. The last numbers on an employee badge. Will be 1 to 4 digits. These numbers are assigned to the badges by the factory. We order a specific range of badges, such as 1801-2000, which are assigned in order and not reused to avoid duplicates. The first four digits on the badges are not used by the Lenel OnGuard software, so we do not use them here either.

userodapptview
Keeps track of the last appointment view used on a per user basis. Users can have multiple rows in this table when using clinics.
Order	Name	Type	Summary
0	UserodApptViewNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	ClinicNum	bigint(20)	FK to clinic.ClinicNum. 0 if clinics is not being used or if the user has not been assigned a clinic.
3	ApptViewNum	bigint(20)	FK to apptview.ApptViewNum.

userodpref
This is a specific preference for a unique Userod. Typically just a few for each user. These all could have all been columns in the userod table. Most of these just hold a ValueString of some sort.
Order	Name	Type	Summary
0	UserOdPrefNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	Fkey	bigint(20)	Foreign key to a table associated with FkeyType. Usually 0, but it does contain an actual Fky in the case of program, clinicLast, SheetDef.SheetDefNum, ImageCats, and possibly others.
3	FkeyType	tinyint(4)	Enum:UserOdFkeyType This is the field that tells us which kind of row this is. It's badly named because in most cases, Fkey is just 0, and the row is just storing a ValueString.
ImageCategoryExpanded: 0 - Imaging module expanded categories. Presence of a row means expanded. Absence means collapsed. No valuestring needed. Can have FKey that relates to ImageCat defNum
ClinicLast: 1 - FKey to ClinicNum Used to track the last opened clinic for the user.
WikiHomePage: 2 - Wiki home pages use ValueString to store the name of the wiki page instead of Fkey due to how FormWiki loads pages.
AutoNoteExpandedCats: 3 - ValueString will be a comma delimited list of DefNums for the last expanded categories for the user. When FormAutoNotes loads, these categories will be expanded again.
TaskCollapse: 4 - Controls whether tasks will be collapsed or not by default
CommlogPersistClearNote: 5 - When FormCommItem is in Persistent mode, clear the note text box after the user creates a commlog.
CommlogPersistClearEndDate: 6 - When FormCommItem is in Persistent mode, clear the End text box after the user creates a commlog.
CommlogPersistUpdateDateTimeWithNewPatient: 7 - When FormCommItem is in Persistent mode, update the Date / Time text box with NOW() whenver the patient changes.
PerioCurrentExamOnly: 8 - Whether or not to display just the currently selected exam in the Perio Chart.
SmsGroupBy: 9 - Text message grouping preference. 0 - None; 1 - By Patient;
TaskListBlock: 10 - Stores a TaskListNum that the corresponding user wants to block all pop ups from.
Program: 11 - FKey to ProgramNum. Also used in DoseSpot for the DoseSpot User ID, stored in ValueString.
SuppressLogOffMessage: 12
AcctProcBreakdown: 13 - Sets the default state of the Account Module "Show Proc Breakdowns" checkbox.
ProgramUserName: 14 - Stores user specific username for programs, generally used for Oryx.ProgNum.
ProgramPassword: 15 - Stores user specific password for programs.
Dashboard: 16 - Stores user specific dashboard to open on load. FKey points to the SheetDef.SheetDefNum that the user last had open.
UserTheme: 17 - Deprecated.
DynamicChartLayout: 18 - Stores the Dynamic Chart Layout SheetDef.SheetDefNum selected by a user, FKey points to ShetDef.SheetDefNum.
PerioAutoAdvanceFacialsFirst: 19 - Whether or not to set the perio auto advance to custom.
LogOffTimerOverride: 20 - Stores the value (in minutes) of when the user should be auto logged off.
ReceivedSupplyOrders: 21 - Whether or not we check the "Show received" checkbox when loading the supply order history.
ToothChartUsesDiffColorByProv: 22 - Color defs can be used for different proc statuses when the user's provider doesn't match the procedure's provider.
ShowAutomatedCommlog: 23 - Whether to show automated commlogs in the account module, chart module, and appointment edit window.
QueryMonitorHasStackTraces: 24 - Preference that indicates whether stack traces are to be logged by the query monitor or not. If exists 0 or 1 is stored in ValueString
WikiSearchIncludeContent: 25 - Preference only applies to the wiki search. Set and unset only in the wiki search window. Box defaults to checked if this preference is not set.
TaskBlockedMakeSound: 26 - Sets whether tasks popups that are blocked still play the sound notification. If true, sound will play. If false, sound will be blocked as well.
ImageSelectorWidth: 27 - Stores the width of the left Image Selector (tree) of the Imaging module in the ValueString. Does not store expanded/collapsed, so this width would be the expanded width. There is no limit. Does not use FKey.
DefaultMapSetting: 28 HQ only. This is used for storing the default map to open up on a customers DB for a specific user. Examples include Engineers, Daycare , Conv/Techs. The Fkey points to the MapAreaContaainer.MapAreaContainerNum table.
4	ValueString	text	Used to hold the value relating to the flag. FKey=0 in this case. This can be a simple primitive value, a comma separated list, or a complex document in xml.
5	ClinicNum	bigint(20)	FK to clinic.ClinicNum, The default clinic for a User. This is duplicate info that's already available in userod.ClinicNum, but having it here might allow simpler queries or linq.

userquery
A list of query favorites that users can run.
Order	Name	Type	Summary
0	QueryNum	bigint(20)	Primary key.
1	Description	varchar(255)	Description.
2	FileName	varchar(255)	The name of the file to export to.
3	QueryText	mediumtext	The text of the query.
4	IsReleased	tinyint(4)	Determines whether the query is safe for users with lower permissions. Also causes this user query to be available in the Main Menu, Reports, Query Favorites Filtered.
5	IsPromptSetup	tinyint(4)	Determines whether the Query Favorites window should prompt for query values via FormQueryParser/'SET Fields' popup when running query.
6	DefaultFormatRaw	tinyint(4)	Determines whether the UserQuery window loads with the 'Raw' format radio button pre-selected. For a new userquery, this is set based on pref.UserQueryDefaultRaw.

userweb
Holds credentials for web applications. Each userweb entry should be linked to a table type or entity of sorts. E.g. Patient Portal credentials will have an FKey to patient.PatNum and an FKeyType linked to "UserWebFKeyType.PatientPortal".
Order	Name	Type	Summary
0	UserWebNum	bigint(20)	Primary key.
1	FKey	bigint(20)	Foreign key to the table defined by the corresponding FKeyType.
2	FKeyType	tinyint(4)	Enum:UserWebFKeyType The type of row that identifies which table FKey links to.
Undefined: This is a default value that should never be saved into the table.
PatientPortal: FK to patient.PatNum
3	UserName	varchar(255)	
4	Password	varchar(255)	The password details in a "HashType$Salt$Hash" format, separating the different fields by '$'. This is NOT the actual password but the encoded password hash. If the contents of this variable are not in the aforementioned format, it is assumed to be a legacy password hash (MD5).
5	PasswordResetCode	varchar(255)	A randomly generated code that can be used to reset the password.
6	RequireUserNameChange	tinyint(4)	Set to true to require a user to change their UserName.
7	DateTimeLastLogin	datetime	The last time when the user used their credentials to log in.
8	RequirePasswordChange	tinyint(4)	Set to true to require a user to change their Password.

utm
A UTM (urchin tracking module) code is a simple string that you can add to the end of a URL to track the performance of campaigns and content.
Order	Name	Type	Summary
0	UtmNum	bigint(20)	Primary key.
1	CampaignName	varchar(500)	Text that identifies a specific campaign or promotion identifying why traffic is being directed to the users website.
2	MediumInfo	varchar(500)	Text that tracks how traffic is getting to the users website, such as email or social media.
3	SourceInfo	varchar(500)	Text that identifies where traffic is originating from.

vaccinedef
A vaccine definition. Should not be altered once linked to VaccinePat.
Order	Name	Type	Summary
0	VaccineDefNum	bigint(20)	Primary key.
1	CVXCode	varchar(255)	RXA-5-1.
2	VaccineName	varchar(255)	Name of vaccine. RXA-5-2.
3	DrugManufacturerNum	bigint(20)	FK to drugmanufacturer.DrugManufacturerNum.

vaccineobs
Vaccine observation. There may be multiple vaccine observations for each vaccine.
Order	Name	Type	Summary
0	VaccineObsNum	bigint(20)	Primary key.
1	VaccinePatNum	bigint(20)	FK to vaccinepat.VaccinePatNum.
2	ValType	tinyint(4)	Enum:VaccineObsType Coded, Dated, Numeric, Text, DateAndTime. Used in HL7 OBX-2.
Coded: 0 - Code CE. Coded entry. (default)
Dated: 1 - Code DT. Date (no time).
Numeric: 2 - Code NM. Numeric.
Text: 3 - Code ST. String.
DateAndTime: 4 - Code TS. Date and time.
3	IdentifyingCode	tinyint(4)	Enum:VaccineObsIdentifier Identifies the observation question. Used in HL7 OBX-3.
DatePublished: 0 - LOINC code 29768-9. Date vaccine information statement published:TmStp:Pt:Patient:Qn: (default)
DatePresented: 1 - LOINC code 29769-7. Date vaccine information statement presented:TmStp:Pt:Patient:Qn:
DatePrecautionExpiration: 2 - LOINC code 30944-3. Date of vaccination temporary contraindication and or precaution expiration:TmStp:Pt:Patient:Qn:
Precaution: 3 - LOINC code 30945-0. Vaccination contraindication and or precaution:Find:Pt:Patient:Nom:
DatePrecautionEffective: 4 - LOINC code 30946-8. Date vaccination contraindication and or precaution effective:TmStp:Pt:Patient:Qn:
TypeOf: 5 - LOINC code 30956-7. Type:ID:Pt:Vaccine:Nom:
FundsPurchasedWith: 6 - LOINC code 30963-3. Funds vaccine purchased with:Find:Pt:Patient:Nom:
DoseNumber: 7 - LOINC code 30973-2. Dose number:Num:Pt:Patient:Qn:
NextDue: 8 - LOINC code 30979-9. Vaccines due next:Cmplx:Pt:Patient:Set:
DateDue: 9 - LOINC code 30980-7. Date vaccine due:TmStp:Pt:Patient:Qn:
DateEarliestAdminister: 10 - LOINC code 30981-5. Earliest date to give:TmStp:Pt:Patient:Qn:
ReasonForcast: 11 - LOINC code 30982-3. Reason applied by forcast logic to project this vaccine:Find:Pt:Patient:Nom:
Reaction: 12 - LOINC code 31044-1. Reaction:Find:Pt:Patient:Nom:
ComponentType: 13 - LOINC code 38890-0. Vaccine component type:ID:Pt:Vaccine:Nom:
TakeResponseType: 14 - LOINC code 46249-9. Vaccination take-response type:Prid:Pt:Patient:Nom:
DateTakeResponse: 15 - LOINC code 46250-7. Vaccination take-response date:TmStp:Pt:Patient:Qn:
ScheduleUsed: 16 - LOINC code 59779-9. Immunization schedule used:Find:Pt:Patient:Nom:
Series: 17 - LOINC code 59780-7. Immunization series:Find:Pt:Patient:Nom:
DoseValidity: 18 - LOINC code 59781-5. Dose validity:Find:Pt:Patient:Ord:
NumDosesPrimary: 19 - LOINC code 59782-3. Number of doses in primary immunization series:Num:Pt:Patient:Qn:
StatusInSeries: 20 - LOINC code 59783-1. Status in immunization series:Find:Pt:Patient:Nom:
DiseaseWithImmunity: 21 - LOINC code 59784-9. Disease with presumed immunity:Find:Pt:Patient:Nom:
Indication: 22 - LOINC code 59785-6. Indication for Immunization:Find:Pt:Patient:Nom:
FundPgmEligCat: 23 - LOINC code 64994-7. Vaccine fund pgm elig cat
DocumentType: 24 - LOINC code 69764-9. Document type
4	ValReported	varchar(255)	The observation value. The type of the value depends on the ValType. Used in HL7 OBX-5.
5	ValCodeSystem	tinyint(4)	Enum:VaccineObsValCodeSystem CVX, HL70064. The observation value code system when ValType is Coded. Used in HL7 OBX-5.
CVX: 0 (default)
HL70064: 1
SCT: 2
6	VaccineObsNumGroup	bigint(20)	FK to vaccineobs.VaccineObsNum. All vaccineobs records with matching GroupId are in the same group. Set to 0 if this vaccine observation is not part of a group. Used in HL7 OBX-4.
7	UcumCode	varchar(255)	Used in HL7 OBX-6.
8	DateObs	date	Date of observation. Used in HL7 OBX-14.
9	MethodCode	varchar(255)	Code from code set CDCPHINVS (this code system is not yet fully defined, so user has to enter manually). Used in HL7 OBX-17. Only required when IdentifyingCode is FundPgmEligCat.

vaccinepat
A vaccine given to a patient on a date.
Order	Name	Type	Summary
0	VaccinePatNum	bigint(20)	Primary key.
1	VaccineDefNum	bigint(20)	FK to vaccinedef.VaccineDefNum. Can be 0 if and only if CompletionStatus=NotAdministered, in which case CVX code is assumed to be 998 (not administered) and there is no manufacturer.
2	DateTimeStart	datetime	The datetime that the vaccine was administered.
3	DateTimeEnd	datetime	Typically set to the same as DateTimeStart. User can change.
4	AdministeredAmt	float	Size of the dose of the vaccine. 0 indicates unknown and gets converted to 999 on HL7 output.
5	DrugUnitNum	bigint(20)	FK to drugunit.DrugUnitNum. Unit of measurement of the AdministeredAmt. 0 represents null. When going out in HL7 RXA-7, the units must be valid UCUM or the export will be blocked. Sometime in the future, we may want to convert this column to a string and name it "UcumCode". For now left alone for backwards compatibility.
6	LotNumber	varchar(255)	Optional. Used in HL7 RXA-9.1.
7	PatNum	bigint(20)	FK to patient.PatNum.
8	Note	text	Documentation sometimes required.
9	FilledCity	varchar(255)	The city where the vaccine was filled. This can be different than the practice office city for historical vaccine information. Exported in HL7 ORC-3.
10	FilledST	varchar(255)	The state where the vaccine was filled. This can be different than the practice office state for historical vaccine infromation. Exported in HL7 ORC-3.
11	CompletionStatus	tinyint(4)	Enum:VaccineCompletionStatus Exported in HL7 RXA-20. Corresponds to HL7 table 0322 (guide page 225).
Complete: 0 - Code CP. Default.
Refused: 1 - Code RE
NotAdministered: 2 - Code NA
PartiallyAdministered: 3 - Code PA
12	AdministrationNoteCode	tinyint(4)	Enum:VaccineAdministrationNote Exported in HL7 RXA-9. Corresponds to CDC code set NIP001 (http://hl7v2-iz-testing.nist.gov/mu-immunization/).
NewRecord: 0 - Code 00. Default.
HistoricalSourceUnknown: 1 - Code 01
HistoricalOtherProvider: 2 - Code 02
HistoricalParentsWrittenRecord: 3 - Code 03
HistoricalParentsRecall: 4 - Code 04
HistoricalOtherRegistry: 5 - Code 05
HistoricalBirthCertificate: 6 - Code 06
HistoricalSchoolRecord: 7 - Code 07
HistoricalPublicAgency: 8 - Code 08
13	UserNum	bigint(20)	FK to userod.UserNum. The user that the vaccine was entered by. May be 0 for vaccines added before this column was created. Exported in HL7 ORD-10.
14	ProvNumOrdering	bigint(20)	FK to provider.ProvNum. The provider who ordered the vaccine. Exported in HL7 ORD-12.
15	ProvNumAdminister	bigint(20)	FK to provider.ProvNum. The provider who administered the vaccine. Exported in HL7 RXA-10.
16	DateExpire	date	The date that the vaccine expires. Exported in HL7 RXA-16.
17	RefusalReason	tinyint(4)	Enum:VaccineRefusalReason Exported in HL7 RXA-18. Corresponds to CDC code set NIP002 (http://hl7v2-iz-testing.nist.gov/mu-immunization/).
None: 0 - No code. Default. Not sent in HL7 messages. Only used in UI.
ParentalDecision: 1 - Code 00
ReligiousExemption: 2 - Code 01
Other: 3 - Code 02
PatientDecision: 4 - Code 03
18	ActionCode	tinyint(4)	Enum:VaccineAction Exported in HL7 RXA-21. Corresponds to HL7 table 0323 (guide page 225).
Add: 0 - Code A. Default.
Delete: 1 - Code D
Update: 2 - Code U
19	AdministrationRoute	tinyint(4)	Enum:VaccineAdministrationRoute Exported in HL7 RXR-1. Corresponds to HL7 table 0162 (guide page 200).
None: 0 - No code. Default. Not sent in HL7 messages. Used in UI only.
Intradermal: 1 - Code ID.
Intramuscular: 2 - Code IM.
Nasal: 3 - Code NS.
Intravenous: 4 - Code IV.
Oral: 5 - Code PO.
Other: 6 - Code OTH.
Subcutaneous: 7 - Code SC.
Transdermal: 8 - Code TD.
20	AdministrationSite	tinyint(4)	Enum:VaccineAdministrationSite Exported in HL7 RXR-2. Corresponds to HL7 table 0163 (guide page 201).
None: 0 - No code. Default. Not sent in HL7 messages. Used in UI only.
LeftThigh: 1- Code LT
LeftArm: 2 - Code LA
LeftDeltoid: 3 - Code LD
LeftGluteousMedius: 4 - Code LG
LeftVastusLateralis: 5 - Code LVL
LeftLowerForearm: 6 - Code LLFA
RightArm: 7 - Code RA
RightThigh: 8 - Code RT
RightVastusLateralis: 9 - Code RVL
RightGluteousMedius: 10 - Code RG
RightDeltoid: 11 - Code RD
RightLowerForearm: 12 - Code RLFA

vitalsign
For EHR module, one dated vital sign entry. BMI is calulated on demand based on height and weight and may be one of 4 ALOINC codes. 39156-5 "Body mass index (BMI) [Ratio]" is most applicable.
Order	Name	Type	Summary
0	VitalsignNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	Height	float	Height of patient in inches. Fractions might be needed some day. Allowed to be 0. Six possible LOINC codes, most applicable is 8302-2, "Body height".
3	Weight	float	Lbs. Allowed to be 0. Six possible LOINC codes, most applicable is 29463-7, "Body weight".
4	BpSystolic	smallint(6)	Units are mmHg (millimeters of mercury). Allowed to be 0. LOINC code 8480-6.
5	BpDiastolic	smallint(6)	Units are mmHg (millimeters of mercury). Allowed to be 0. LOINC code 8462-4.
6	DateTaken	date	The date that the vitalsigns were taken.
7	HasFollowupPlan	tinyint(4)	For an abnormal BMI measurement this must be true in order to meet quality measurement.
8	IsIneligible	tinyint(4)	If a BMI was not recorded, this must be true in order to meet quality measurement. For children, this is used as an IsPregnant flag, the only valid reason for not taking BMI on children.
9	Documentation	text	A general note inside the VS window.
10	ChildGotNutrition	tinyint(4)	.
11	ChildGotPhysCouns	tinyint(4)	.
12	WeightCode	varchar(255)	Used for CQMs. SNOMED CT code either Normal="", Overweight="238131007", or Underweight="248342006". Set when BMI is found to be "out of range", based on age groups. Should be calculated when vital sign is saved. Calculate based on age as of Jan 1 of the year vitals were taken. Not currently displayed to user.
13	HeightExamCode	varchar(30)	FK to ehrcode.CodeValue. Also FK to LOINC.LoincCode. Used for CQMs. LOINC code used to describe the height exam performed. Examples: Body Height Measured=3137-7, Body Height Stated=3138-5, Body Height --pre surgery=8307-1. We will default to Body Height=8302-2, but user can choose another from the list of 6 allowed. Can be blank if BP only.
14	WeightExamCode	varchar(30)	FK to ehrcode.CodeValue. Also FK to LOINC.LoincCode. Used for CQMs. LOINC code used to describe the weight exam performed. Examples: Body Weight Measured=3141-9, Body Weight Stated=3142-7, Body Weight --with clothes=8350-1. We will default to Body Weight=29463-7, but user can choose another from the list of 6 allowed. Can be blank if BP only.
15	BMIExamCode	varchar(30)	FK to ehrcode.CodeValue. Also FK to LOINC.LoincCode. Used for CQMs. LOINC code used to describe the BMI percentile calculated. We will use LOINC 59576-9 - BMI Percentile Per age and gender. Can be blank if BP only.
16	EhrNotPerformedNum	bigint(20)	FK to ehrnotperformed.EhrNotPerformedNum. This will link a vitalsign to the EhrNotPerformed object where the reason not performed will be stored. The linking will allow us to display the not performed reason directly in the vital sign window and will make CQM queries easier. Will be 0 if not linked to an EhrNotPerformed object.
17	PregDiseaseNum	bigint(20)	FK to disease.DiseaseNum. This will link this vitalsign object to a pregnancy diagnosis for this patient. It will be 0 for non pregnant patients. The disease it is linked to will be inserted automatically based on the default value set. In order to change this code for this specific exam it will have to be changed in the problems list.
18	BMIPercentile	int(11)	BMI percentile of patient, based on gender and age and the calculated BMI. We will use the CDC numbers to calculate percentile found here: (http://www.cdc.gov/nchs/data/series/sr_11/sr11_246.pdf).
19	Pulse	int(11)	Recorded pulse of the patient. Stored in beats per minute.

webschedcarrierrule
Order	Name	Type	Summary
0	WebSchedCarrierRuleNum	bigint(20)	Primary key.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
2	CarrierName	varchar(255)	Name of the carrier.
3	DisplayName	varchar(255)	Set by the user. This is what is shown as a selection for the patient in the WebSched UI.
4	Message	text	Return message sent back to patients through WebSched. Set by the office after a patient has made a carrier selection.
5	Rule	tinyint(4)	Enum:RuleType Allow, AllowWithInput, AllowWithMessage, Block.
Allow: 0
AllowWithInput: 1
AllowWithMessage: 2
BlockWithMessage: 3

webschedrecall
Web Sched recall reminders that may have been sent via EConnector to HQ.
Order	Name	Type	Summary
0	WebSchedRecallNum	bigint(20)	PK. Generated by HQ.
1	ClinicNum	bigint(20)	FK to clinic.ClinicNum for the corresponding appointment.
2	PatNum	bigint(20)	FK to patient.PatNum for the corresponding patient.
3	RecallNum	bigint(20)	FK to recall.RecallNum. Generated by OD.
4	DateTimeEntry	datetime	Generated by OD. Timestamp when row is created.
5	DateDue	datetime	The date that the recall is due.
6	ReminderCount	int(11)	The number of reminders that have been sent for this recall.
7	DateTimeSent	datetime	DateTime the message was sent.
8	DateTimeSendFailed	datetime	The most recent time that sending a reminder failed. Will be 01/01/0001 if a reminder has never been attempted.
9	SendStatus	tinyint(4)	Enum:AutoCommStatus The status of the email or text being sent for this recall.
Undefined: 0 - Should not be in the database but can be used in the program.
DoNotSend: 1 - Do not send a reminder.
SendNotAttempted: 2 - We will send, but send has not been attempted yet.
SendSuccessful: 3 - Has been sent successfully.
SendFailed: 4 - Attempted to send but not successful.
SentAwaitingReceipt: 5 - Has been sent successfully, awaiting receipt.
10	ShortGUID	varchar(255)	Generated by HQ. Identifies this AutoCommGuid in future transactions between HQ and OD.
11	ResponseDescript	text	Generated by OD in some cases and HQ in others. Any human readable error message generated by either HQ or EConnector. Used for debugging.
12	Source	tinyint(4)	Enum:WebSchedRecallSource Where this row came from.
Undefined: 0 - Should not be in the database.
FormRecallList: 1 - Originated from a user clicking the Web Sched button in the Recall List.
EConnectorAutoComm: 2 - The eConnector created this row in the Auto Comm Web Sched thread.
13	CommlogNum	bigint(20)	FK to commlog associated to this WebSchedRecall.
14	MessageType	tinyint(4)	Enum:CommType The type of message being sent for this recall.
Invalid: -1 - Do not use.
Preferred: 0 - Use text OR email based on patient preference.
Text: 1 - Attempt to send text message, if successful do not send via email. (Unless, a SendAll bool is used, which usually negates the need for this enumeration.)
Email: 2 - Attempt to send email message, if successful do not send via text. (Unless, a SendAll bool is used, which usually negates the need for this enumeration.)
SecureEmail: 3 - Attempt to send secure email message.
15	MessageFk	bigint(20)	FK to primary key of appropriate table.
16	ApptReminderRuleNum	bigint(20)	FK to apptreminderrule.ApptReminderRuleNum. Allows us to look up the rules to determine how to send this apptcomm out.

wikilistheaderwidth
Keeps track of column widths in Wiki Lists.
Order	Name	Type	Summary
0	WikiListHeaderWidthNum	bigint(20)	Primary key.
1	ListName	varchar(255)	Name of the list that this header belongs to. Tablename without the prefix.
2	ColName	varchar(255)	Name of the column that this header belongs to.
3	ColWidth	int(11)	Width in pixels of column.
4	PickList	text	Newline delimited list of options for the user to select from when adding or editing a wiki list item.
5	IsHidden	tinyint(4)	Hide or show this column in the UI.

wikilisthist
Rows never edited, just added. Contains all historical versions of each list.
Order	Name	Type	Summary
0	WikiListHistNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	ListName	varchar(255)	Will not be unique because there are multiple revisions per page.
3	ListHeaders	text	The contents of the corresponding WikiListHeaderWidths row converted to a string in format ColName1,ColWidth1;ColName2,ColWidth2;... Database type text/varChar2(4000) (65K/4K)
4	ListContent	mediumtext	The entire contents of the revision are stored as XML. Database type mediumtext/clob (16M,4G)
5	DateTimeSaved	datetime	The DateTime from the original WikiPage object.

wikipage
Rows never edited, just added, unless the wiki page is a draft. Contains only newest versions of each page and all drafts.
Order	Name	Type	Summary
0	WikiPageNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	PageTitle	varchar(255)	Must be unique. Any character is allowed except: \r, \n, and ". Needs to be tested, especially with apostrophes.
3	KeyWords	varchar(255)	Automatically filled from the [[Keywords:]] tab in the PageContent field as page is being saved.
4	PageContent	mediumtext	Content of page stored in "wiki markup language". This should never be updated, unless it is a draft. Medtext (16M)
5	DateTimeSaved	datetime	The DateTime that the page was saved to the DB. User can't directly edit.
6	IsDraft	tinyint(4)	Signifies that the wiki page is a draft, and will only show in the Wiki Drafts form.
7	IsLocked	tinyint(4)	Records if a wiki page is locked. If it is locked, only user swith the WikiAdmin permission are allowed to edit the page
8	IsDeleted	tinyint(4)	This flag will be set when the user archives the WikiPage.
9	PageContentPlainText	mediumtext	Content of page stored without any HTML markup or wiki page links. This plain text allows for easier searching.

wikipagehist
Rows never edited, just added. Contains all historical versions of each page as well.
Order	Name	Type	Summary
0	WikiPageNum	bigint(20)	Primary key.
1	UserNum	bigint(20)	FK to userod.UserNum.
2	PageTitle	varchar(255)	Will not be unique because there are multiple revisions per page.
3	PageContent	mediumtext	The entire contents of the revision are stored in "wiki markup language". This should never be updated. Medtext (16M)
4	DateTimeSaved	datetime	The DateTime from the original WikiPage object.
5	IsDeleted	tinyint(4)	This flag will only be set for the revision where the user marked it deleted, not the ones prior.

xchargetransaction
XCharge transactions that have been imported into OD. Used by reconcile tool. Keeps a history, but no references to these rows from other tables.
Order	Name	Type	Summary
0	XChargeTransactionNum	bigint(20)	Primary key.
1	TransType	varchar(255)	Usually "CCPurchase."
2	Amount	double	Amount.
3	CCEntry	varchar(255)	Credit card entry method. Usually "Keyed".
4	PatNum	bigint(20)	FK to patient.PatNum.
5	Result	varchar(255)	Result: AP for approved, DECLINE for declined.
6	ClerkID	varchar(255)	ClerkID. Open Dental username with a possible " R" at the end to indicate a recurring charge.
7	ResultCode	varchar(255)	ResultCode: 000 for approved, 005 for declined.
8	Expiration	varchar(255)	Expiration is shown as a four digit number (string since it may contain leading zeros).
9	CCType	varchar(255)	VISA, AMEX, MC, DISC etc.
10	CreditCardNum	varchar(255)	Usually looks like 123456XXXXXX7890.
11	BatchNum	varchar(255)	BatchNum.
12	ItemNum	varchar(255)	ItemNum. Starts at 0001 for each batch.
13	ApprCode	varchar(255)	Approval code. 6 characters. 72142Z for example.
14	TransactionDateTime	datetime	TransactionDateTime. Is taken from the Date and Time columns in X-Charge.
15	BatchTotal	double	BatchTotal. Stores the BatchTotal from XCharge. This is a cumulative value for all transactions up to this row in the same batch. BatchTotal from the last transaction in a batch should match the sum of all the Amount fields for the same batch

xwebresponse
Received as XML output from XWeb gateway. Not all fields are available for all method calls. This is a combination of all possible output fields. The fields that are available are dependent on which method was called and the given result. HPF (XWeb Hosted Payment Form) Payments and HPF CC Alias creations will each enter a row in this table. That row will be monitored by the eConnector and updated when the XWebResponseCode changes from Pending. -- 1) Create the row and indicate the HPF/OTK. -- 2) Poll the OTK (one-time key) until an XWebResponseCode is available. Update the row with information about the transaction. DTG (XWeb Direct To Gateway) Will enter 1 row in this table. -- 1) Make the DTG payment using a pre-authorized CC alias. Create row with information about the transaction. Any fields prefixed with 'Gateaway output' come directly as XML output from the XWeb Gateway. All other fields are derived by OD. The class instance will created by eConnector by deserializing an XML string as received from XWeb Gateway. The fields names MUST NOT CHANGE for this reason. XML will not deserialize if the names do not match EXACTLY.
Order	Name	Type	Summary
0	XWebResponseNum	bigint(20)	Primary key.
1	PatNum	bigint(20)	FK to patient.PatNum.
2	ProvNum	bigint(20)	FK to provider.ProvNum.
3	ClinicNum	bigint(20)	FK to clinic.ClinicNum.
4	PaymentNum	bigint(20)	FK to payment.PayNum.
5	DateTEntry	datetime	Timestamp at which this row was created. Auto generated on insert.
6	DateTUpdate	datetime	Timestamp at which this row was last updated. Will be updated each time the OTK status is polled and one final time when XWebResponseCode changes from Pending.
7	TransactionStatus	tinyint(4)	Inidicates which phase of the XWeb process this transaction is in. See class summary for details.
8	ResponseCode	int(11)	Gateaway output. Pre-defined responses generated by XWeb. Will be converted to strongly typed enum XWebResponseCode.
9	XWebResponseCode	varchar(255)	Enum:XWebResponseCodes Strongly typed representation of ResponseCode. Initialized by XWebInputAbs.CreateGatewayResponse().
Undefined: 1000
OtkSuccess: 100
Approval: 000
Declined: 001
AliasSuccess: 005
PartialApproval: 007
AutoDecline: 009
InvalidExpirationDate: 010
ZeroDollarAuthApproval: 032 - Used when creating a card alias.
ExpiredWithoutApproval: 101 - Expired Without Approval. Hosted Form timed out without Approval, OTK was never launched, or Invalid OTK
Pending: 102 - Pending (neither of the above events has occurred yet)
ParsingError: 800 Parsing Error Unable to parse the XML request sent.
MaxRequestDataExceededError: 801 Maximum Request Data Exceeded Error - The XML request exceeds the 2048-byte maximum size.
DuplicateFieldError: 802 Duplicate Field Error - The XML request had more than one copy of a particular field. The field causing the error may be specified.
ImproperDLLError: 803 Improper DLL Error - Unrecognized DLL name. This can be caused by a wrong URL entered into the "Server Location" setting under XCharge Server Setup, Credit Cards, Connection.
SpecificationVersionError: 804 Specification Version Error - XML error, the Specification Version field is set incorrectly.
AuthenticationError: 805 Authentication Error - The XWeb ID, Auth Key or Terminal ID fields are incorrect (check for leading and trailing spaces if they appear to match those on file). The field causing the error may be specified.
ProductionMerchantSetUpError: 806 Production Merchant Set Up Error - The Mode was incorrectly sent. This can happen when trying to process on theProduction server with a Development or Test Mode Processing Account.
TestMerchantSetUpError: 807 Test Merchant Set Up Error - The Mode was incorrectly sent. This can happen when trying to process on the Testserver with a Development or Production Mode Processing Account.
DevelopmentMerchantSetUpError: 808 Development Merchant Set Up Error - The Mode was incorrectly sent. This can happen when trying to process on theDevelopment server with a Production or Test Mode Processing Account.
RequiredFieldNotSentError: 809 Required Field Not Sent Error - A field that is required for this transaction type was not sent. The field causing theerror may be specified.
InconsistentConditionalFieldError: 810 Inconsistent Conditional Field Error - A field that does not have to be sent was sent in the wrong context. The field causing the error may be specified.
ImproperFieldDataError: 811 Improper Field Data Error - A field sent to the EdgeExpress Gateway was not formatted correctly. This could pertain to Processing Account Information configured in XCharge or BMS, or card information. The field causing the error may be specified.
UnrecognizedNameTagError: 812 Unrecognized Name / Tag Error - The XML tag sent is not in the API
DuplicateTransactionError: 813 Duplicate Transaction Error - A transaction was run for the same amount on the same card within a certain time limit. The duplicate checking time is set on the EdgeExpress Gateway, usuallybetween 1 and 60 minutes.
InvalidReferenceError: 814 Invalid Reference Error - The Transaction ID used for a Void, Return, etc. is invalid.
TransactionAlreadyVoided: 815 Transaction Already Voided - The Transaction ID used for a Void was already voided.
TransactionAlreadyCaptured: 816 Transaction Already Captured - The Transaction ID used for a Capture of an Authorized charge was already used and the transaction has been Captured.
EmptyBatch: 817 Empty Batch - The batch is empty and cannot settle. You cannot settle an empty batch.
MerchantLockedForSettlement: 818 Merchant Locked For Settlement - The Processing Account is in the process of being settled/batched. Wait a moment and try again.
MerchantLockedForMaintenance: 819 Merchant Locked for Maintenance - The Processing Account is locked for database or server maintenance. Wait amoment and try again.
TemporaryServiceOutage: 820 Temporary Service Outage - Retry Transaction - The EdgeExpress Gateway itself may be down. Wait a moment and try again.
ProcessingHostUnavailable: 821 Processing Host Unavailable - Certain back end account parameters may not be set correctly. Have the account settings checked. Specifically, check the TSYS Vital Hierarchy Values.
InvalidAccountData: 823 Invalid Account Data - A field sent to the EdgeExpress Gateway appears invalid (correctly formatted but not on file). This could pertain to Processing Account Information configured in XCharge or BMS, or card information. The field causing the response may be specified.
IndustryMismatchError: 824 Industry Mismatch Error - The Processing Account is configured with the incorrect Market Type. This can occur if XCharge or BMS is not configured with the same Market Type as the EdgeExpress Gateway.
RejectedInternalSupportOnly: 825 Rejected Internal support only - Reserved for Fraud, Not currently implemented.
InvalidCardType: 827 Invalid Card Type - The account number entered is not valid for the card type entered. If Card Type is Visa, then the account number must be for a Visa account.
CardTypeNotSupported: 828 Card Type Not Supported - The card type (Visa, Mastercard, American Express, etc.) for the attempted transaction is not enabled at the EdgeExpress Gateway.
CardCodeRequired: 829 Card Code Required - The Card Security Code (CSC, also known as the CVV, CVC or CID) is set to "required" for keyed transactions at the EdgeExpress Gateway, but was not sent.
AddressRequired: 830 Address Required - The address (house number, part of the Address Verification System) is set to "required" for keyed transactions at the EdgeExpress Gateway, but was not sent.
ZipCodeRequired: 831 ZIP Code Required - The ZIP code (part of the Address Verification System) is set to "required" for keyed transactions at the EdgeExpress Gateway, but was not sent.
EncodedDataFormatError: 832 Encoded Data Format Error - Encoded format of check image file could not be read or was not submitted when expected.
CheckServicesImageErrorMICRAndAmout: 833 Check Services Image Error - MICR and Amount cannot be read The attempted paper check scan failed. When this occurs you should have the option to manually enter the check information or rescan the check.
CheckServicesImageErrorMICROnly: 834 Check Services Image Error - MICR cannot be read The attempted paper check scan failed. When this occurs you should have the option to manually enter the check information or rescan the check.
CheckServicesImageErrorAmountOnly: 835 Check Services Image Error - Amount cannot be read The attempted paper check scan failed. When this occurs you should have the option to manually enter the check information or rescan the check.
EmailServiceError: 838 Email Service Error - The EdgeExpress Gateway attempted to send an email, possibly for a password reset request, but the attempt failed.
InvalidReferenceErrorResponseCodeMisMatch: 842 Invalid Reference Error - Response code returned when the referenced transaction type does not match.
TSYSError: 900 TSYS Error - Error thrown by Processor TSYS: the EdgeExpress Gateway is setup correctly, but the card or other value submitted is incorrect. SERV NOT ALLOWED usually indicates a Decline, Failure CV indicates the Card Type is not supported (e.g. AMEX needs to be enabled), and Failure HV indicates an error on the account setup in the EdgeExpress Gateway.
ProcessorError: 901 Processor Error Can be Global or TSYS errors (900 Global Payments Error: or 900 TSYS Error:) are returned on transactions if a processor setting is not configured correctly. This can occur if the card or transaction type is not enabled on the Processing Account at the processor end.
10	ResponseDescription	varchar(255)	Gateaway output. Gives a more detailed description on the ResponseCode.
11	OTK	varchar(255)	Gateaway output. This is the One Time Key that is used to launch the Hosted Payment Form. The status of the OTK can be polled to determine if the end user has completed the HPF or if it has expired.
12	HpfUrl	text	This URL will be generated as a result of the OTK. The URL can be browsed in an IFRAME to create a secure portal between a browser and the XWeb server. It is used with EdgeExpress now that HPF is deprecated.
13	HpfExpiration	datetime	Timestamp at which this HPF will expire. The end user will only be able to access the HPF before it has expired. This expiration is set explicitly when creating the HPF.
14	TransactionID	varchar(255)	Gateaway output. Each transaction is given a reference for future use. This can be used to void the transaction.
15	TransactionType	varchar(255)	Gateaway output. The type of transaction that was processed. Must be a string data type because it comes from the Gateway as a string.
16	Alias	varchar(255)	Gateaway output. A credit transaction will return an alias which is now linked to the credit card which was used. This alias can be used in the future to make DTG payments and circumvent the need for the secure HPF. Only applies when Credit (not Debit) data is submitted on the HPF. CreditCard.XChargeToken is often set to this value.
17	CardType	varchar(255)	Gateaway output. The card type used for this transaction. "Credit" - for cards that support signature only. "Debit/Credit" - for cards that support either PIN-entry or signature. "Debit/ATM" - for cards that support PIN-entry only. "FSA" - for Flexible Spending Accounts
18	CardBrand	varchar(255)	Gateaway output. The card brand used for this transaction. Possible values include "Visa", "MasterCard", "Discover", "American Express", "Diners Club", "JCB", "PayPal".
19	CardBrandShort	varchar(255)	Gateaway output. The industry standard abbreviation of the card brand. Possible values include "VS", "MC", "DS", "AX", "DCIDISC", "JCB-DISC", "PP" (order respective to CardBrand above).
20	MaskedAcctNum	varchar(255)	Gateaway output. Provides a masked format of the account number. The format will show the last 4 digits, the remainder will masked out with an asterisk character. End user will be presented with a list of previously generated MaskedAcctNum(s) when making a payment. These are linked to an alias which can be used to make a DTG payment. This ciccumvents the need to use the HPF.
21	Amount	double	Gateaway output. Amount of credit card and check transactions.
22	ApprovalCode	varchar(255)	Gateaway output. A 6 digit authorization approval code.
23	CardCodeResponse	varchar(255)	Gateaway output. Response from the Card Security Code lookup. Only applies when Credit(not Debit) data is submitted on the HPF.
24	ReceiptID	int(11)	Gateaway output. An identification number assigned by the OpenEdge Gateway to the receipt.
25	ExpDate	varchar(255)	Gateaway output. Provides the Expiration Date of the account being accessed. Format is yyMM from XWeb gateway. Will be converted to ExpirationDate.
26	EntryMethod	varchar(255)	Gateaway output. Indicates how the account number was entered by the end user. Always 'KEYED' in our case.
27	ProcessorResponse	varchar(255)	Gateaway output. The response from the processor. It is only returned on transactions that are processed by the processor (Auth, Sales and Settlements).
28	BatchNum	int(11)	Gateaway output. This indicates the current open batch number.
29	BatchAmount	double	Gateaway output. Net amount of Credit and Debit Card transactions in batch.
30	AccountExpirationDate	date	The expiration date of the credit card that was referenced in this transaction. DateTime representation of ExpDate. Initialized by XWebInputAbs.CreateGatewayResponse().
31	DebugError	text	Debug information regarding this response. Can only be set by XWebResponses.ProcessOutstandingTransactions().
32	PayNote	text	Will be entered as Payment.PayNote once payment transaction has completed.
33	CCSource	tinyint(4)	Enum:CreditCardSource The source of where this transaction originated from.
None: 0 - This is used when the payment is not a Credit Card. If CC, then this means we are storing the actual credit card number. Not recommended.
XServer: 1 - Local installation of X-Charge
XWeb: 2 - Credit card created via X-Web (an eService)
PayConnect: 3 - PayConnect web service (from within OD).
XServerPayConnect: 4 - Credit card has been added through the local installation of X-Charge and the PayConnect web service.
XWebPortalLogin: 5 - Made from the login screen of the Patient Portal.
PaySimple: 6 - PaySimple web service (from within OD).
PaySimpleACH: 7 - PaySimple ACH web service (from within OD).
PayConnectPortal: 8 - PayConnect credit card (made from Patient Portal)
PayConnectPortalLogin: 9 - PayConnect credit card (made from Patient Portal Login screen).
CareCredit: 10 - CareCredit.
EdgeExpressRCM: 11 - Global Payments Cloud (formerly EdgeExpress) when calling the RCM program.
EdgeExpressCNP: 12 - Global Payments Card Not Present API (formerly EdgeExpress).
API: 13 - Payment taken through Open Dental API.
EdgeExpressPaymentPortal: 14 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal.
EdgeExpressPaymentPortalGuest: 15 - Global Payments (formerly EdgeExpress) payment taken through the Payment Portal as a guest.
PayConnectPaymentPortal: 16 - PayConnect payment taken through the Payment Portal.
PayConnectPaymentPortalGuest: 17 - PayConnect payment taken through the Payment Portal as a guest.
PaySimplePaymentPortal: 18 - PaySimple payment taken through the Payment Portal.
PaySimplePaymentPortalGuest: 19 - PaySimple payment taken through the Payment Portal as a guest.
PaySimplePaymentPortalACH: 20 - PaySimple ACH Payment taken through the Payment Portal.
XWebPaymentPortal: 21 - XWeb payment taken through the Payment Portal.
XWebPaymentPortalGuest: 22 - XWeb payment taken through the Payment Portal as a guest.
MeetInTheCloudTerminal: 23 - Meet In The Cloud payment via terminal.
34	OrderId	varchar(255)	Generated by us but necessary for Card Not Present API calls. Used to link transactions together (e.g. for returns).
35	EmailResponse	varchar(255)	Email address used for a requested receipt provided by the user when making a payment via the patient portal.
36	LogGuid	varchar(36)	The GUID used in EserviceLogs related to this response. May be blank.

zipcode
Zipcodes are also known as postal codes. Zipcodes are always copied to patient records rather than linked. So items in this list can be freely altered or deleted without harming patient data.
Order	Name	Type	Summary
0	ZipCodeNum	bigint(20)	Primary key.
1	ZipCodeDigits	varchar(20)	The actual zipcode.
2	City	varchar(100)	.
3	State	varchar(20)	.
4	IsFrequent	tinyint	If true, then it will show in the dropdown list in the patient edit window.
