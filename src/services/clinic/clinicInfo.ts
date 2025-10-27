import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'ClinicInfo';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

const getGroupsFromClaims = (claims?: Record<string, any>): string[] => {
  if (!claims) return [];
  // Common shapes for groups claim in API Gateway
  const raw = claims['cognito:groups'] ?? claims['cognito:groups[]'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    // Could be JSON array string or comma separated
    const trimmed = raw.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {
        // fall through to comma split
      }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const isWriteAuthorized = (groups: string[]): boolean => {
  if (!groups || groups.length === 0) return false;
  // Only global super admin can write
  return groups.some((g) => g === 'GLOBAL__SUPER_ADMIN');
};

// Static clinic data - this will be the default data
const staticClinicData = [
  {
    "Clinic": "Todays Dental Cayce",
    "URL": "https://todaysdentalcayce.com/",
    "Virtual Receptionist": "(803) 233-6141",
    "Fax Number": "(803) 753-1442",
    "Direct Dial Number": "(803) 753-1442",
    "Gmail": "todaysdentalcayce@gmail.com",
    "Domain Mail": "Dentist@TodaysDentalCayce.com",
    "Ap Domain Mail": "ap@todaysdentalcayce.com",
    "Address": "1305 Knox Abbott Dr suite 101, Cayce, SC 29033, USA",
    "Book appointment link": "https://todaysdentalcayce.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://todaysdentalcayce.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://todaysdentalcayce.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Todays Dental Alexandria",
    "URL": "https://todaysdentalalexandria.com/",
    "Virtual Receptionist": "703-256-2085",
    "Fax Number": "703-256-5076",
    "Direct Dial Number": "703-256-5076",
    "Gmail": "todaysdentalalexandria@gmail.com",
    "Domain Mail": "Dentist@TodaysDentalAlexandria.com",
    "Ap Domain Mail": "ap@todaysdentalalexandria.com",
    "Address": "4601 Pinecrest Office Park Dr Ste D, Alexandria, VA 22312, USA",
    "Book appointment link": "https://todaysdentalalexandria.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "http://todaysdentalalexandria.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://todaysdentalalexandria.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Todays Dental Greenville",
    "URL": "https://todaysdentalgreenville.com/",
    "Virtual Receptionist": "864-999-9899",
    "Fax Number": "864-274-0708",
    "Direct Dial Number": "864-274-0708",
    "Gmail": "todaysdentalgreenville@gmail.com",
    "Domain Mail": "Dentist@TodaysDentalGreenville.com",
    "Ap Domain Mail": "ap@todaysdentalgreenville.com",
    "Address": "1530 Poinsett Hwy Greenville, SC 29609, USA",
    "Book appointment link": "https://todaysdentalgreenville.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://todaysdentalgreenville.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://todaysdentalgreenville.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Todays Dental West Columbia",
    "URL": "https://todaysdentalwestcolumbia.com/",
    "Virtual Receptionist": "803-233-8177",
    "Fax Number": "803-233-8178",
    "Direct Dial Number": "803-233-8178",
    "Gmail": "todaysdentalwestcolumbia@gmail.com",
    "Domain Mail": "Dentist@TodaysDentalWestColumbia.com",
    "Ap Domain Mail": "ap@todaysdentalwestcolumbia.com",
    "Address": "115 Medical Cir, West Columbia, SC 29169, USA",
    "Book appointment link": "https://todaysdentalwestcolumbia.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://todaysdentalwestcolumbia.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://todaysdentalwestcolumbia.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Todays Dental Lexington",
    "URL": "https://todaysdentallexington.com/",
    "Virtual Receptionist": "(803) 756-4353",
    "Fax Number": "(803) 756-4550",
    "Direct Dial Number": "(803) 756-4550",
    "Gmail": "todaysdentallexington@gmail.com",
    "Domain Mail": "Dentist@TodaysDentalLexington.com",
    "Ap Domain Mail": "ap@todaysdentallexington.com",
    "Address": "458 Old Cherokee Rd Suite 100, Lexington, SC 29072, USA",
    "Book appointment link": "https://todaysdentallexington.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://todaysdentallexington.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://todaysdentallexington.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Concord",
    "URL": "https://dentistinconcord.com/",
    "Virtual Receptionist": "(704) 707-3620",
    "Fax Number": "(704) 707-3621",
    "Direct Dial Number": "(704) 707-3621",
    "Gmail": "dentistinconcord@gmail.com",
    "Domain Mail": "DentalCare@DentistinConcord.com",
    "Ap Domain Mail": "ap@dentistinconcord.com",
    "Address": "2460 WONDER DR STE C, KANNAPOLIS, NC 28083",
    "Book appointment link": "https://dentistinconcord.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinconcord.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinconcord.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Edgewater",
    "URL": "https://dentistinedgewatermd.com/",
    "Virtual Receptionist": "(410) 956-4608",
    "Fax Number": "(443) 334-6689",
    "Direct Dial Number": "(443) 334-6689",
    "Gmail": "dentistinedgewatermd@gmail.com",
    "Domain Mail": "DentalCare@DentistinEdgewater.com",
    "Ap Domain Mail": "ap@dentistinedgewater.com",
    "Address": "15 Lee Airpark Dr, Suite 100, Edgewater MD 21037",
    "Book appointment link": "https://dentistinedgewatermd.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinedgewatermd.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinedgewatermd.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Oregon",
    "URL": "https://dentistinoregonoh.com/",
    "Virtual Receptionist": "(419) 690-0320",
    "Fax Number": "(419) 391-9906",
    "Direct Dial Number": "(419) 391-9906",
    "Gmail": "dentistinoregonoh@gmail.com",
    "Domain Mail": "dentalcare@dentistinoregonoh.com",
    "Ap Domain Mail": "ap@dentistinoregonoh.com",
    "Address": "3555 Navarre Ave Stre 12, Oregon OH 43616",
    "Book appointment link": "https://dentistinoregonoh.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinoregonoh.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinoregonoh.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Bowie",
    "URL": "https://dentistinbowie.com/",
    "Virtual Receptionist": "(301) 880-0504",
    "Fax Number": "(301) 880-0940",
    "Direct Dial Number": "(301) 880-0940",
    "Gmail": "dentistinbowie@gmail.com",
    "Domain Mail": "DentalCare@DentistinBowie.com",
    "Ap Domain Mail": "ap@dentistinbowie.com",
    "Address": "14999 Health Center Dr, Suite 110, Bowie, MD, 20716, USA",
    "Book appointment link": "https://dentistinbowie.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinbowie.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinbowie.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Perrysburg",
    "URL": "https://dentistinperrysburg.com/",
    "Virtual Receptionist": "(419) 792-1264",
    "Fax Number": "(419) 792-1263",
    "Direct Dial Number": "(419) 792-1263",
    "Gmail": "dentistinperrysburg@gmail.com",
    "Domain Mail": "DentalCare@DentistinPerrysburg.com",
    "Ap Domain Mail": "ap@dentistinperrysburg.com",
    "Address": "110 E South Boundary St, Suite 903A, Perrysburg, OH 43551, USA",
    "Book appointment link": "https://dentistinperrysburg.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinperrysburg.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinperrysburg.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Greenville",
    "URL": "https://dentistingreenville.com/",
    "Virtual Receptionist": "(864) 284-0066",
    "Fax Number": "(864) 468-2300",
    "Direct Dial Number": "(864) 468-2300",
    "Gmail": "dentistingreenville@gmail.com",
    "Domain Mail": "DentalCare@DentistinGreenville.com",
    "Ap Domain Mail": "ap@dentistingreenville.com",
    "Address": "4 Market Point Drive Suite E, Greenville SC 29607",
    "Book appointment link": "https://dentistingreenville.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistingreenville.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistingreenville.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in powell",
    "URL": "https://dentistinpowellohio.com/",
    "Virtual Receptionist": "(614) 659-0018",
    "Fax Number": "(614) 664-9667",
    "Direct Dial Number": "(614) 664-9667",
    "Gmail": "dentistinpowell@gmail.com",
    "Domain Mail": "DentalCare@DentistinPowellOhio.com",
    "Ap Domain Mail": "ap@dentistinpowellohio.com",
    "Address": "4091 W Powell Rd 1, Powell, OH 43065, United States",
    "Book appointment link": "https://dentistinpowellohio.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinpowellohio.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinpowellohio.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist at SaludaPointe",
    "URL": "https://dentistatsaludapointe.com/",
    "Virtual Receptionist": "(419) 792-1264",
    "Fax Number": "(419) 792-1263",
    "Direct Dial Number": "(419) 792-1263",
    "Gmail": "dentistatsaludapointe@gmail.com",
    "Domain Mail": "DentalCare@DentistatSaludaPointe.com",
    "Ap Domain Mail": "ap@dentistatsaludapointe.com",
    "Address": "105 Saluda Pointe Ct Suite C, Lexington, SC 29072, USA",
    "Book appointment link": "https://dentistatsaludapointe.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistatsaludapointe.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistatsaludapointe.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Lawrence dentistry",
    "URL": "http://lawrencevilledentistry.com/",
    "Virtual Receptionist": "(770) 415-0077",
    "Fax Number": "(770) 415-4995",
    "Direct Dial Number": "(770) 415-4995",
    "Gmail": "dentistinlawrenceville@gmail.com",
    "Domain Mail": "Dentist@LawrencevilleDentistry.com",
    "Ap Domain Mail": "ap@lawrencevilledentistry.com",
    "Address": "1455 Pleasant Hill Road, Lawrenceville, Suite 807A, Georgia 30044, USA",
    "Book appointment link": "https://lawrencevilledentistry.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://lawrencevilledentistry.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://lawrencevilledentistry.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Louisville",
    "URL": "https://dentistinlouisville.com/",
    "Virtual Receptionist": "(502) 239-9751",
    "Fax Number": "(502) 212-9629        (502) 444-7005",
    "Direct Dial Number": "(502) 212-9629",
    "Gmail": "dentistinlouisvillekentucky@gmail.com",
    "Domain Mail": "dentalcare@dentistinlouisville.com",
    "Ap Domain Mail": "ap@dentistinlouisville.com",
    "Address": "6826 Bardstown Road, Louisville, Kentucky, 40291, USA",
    "Book appointment link": "https://dentistinlouisville.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinlouisville.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinlouisville.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in New Britain",
    "URL": "https://dentistinnewbritain.com/",
    "Virtual Receptionist": "(860) 259-4141        (860) 770-6774",
    "Fax Number": "",
    "Direct Dial Number": "(186) 077-06775",
    "Gmail": "dentistinnewbritain@gmail.com",
    "Domain Mail": "dentalcare@dentistinnewbritain.com",
    "Ap Domain Mail": "ap@dentistinnewbritain.com",
    "Address": "446 S Main St, New Britain CT 06051-3516, USA",
    "Book appointment link": "https://dentistinnewbritain.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinnewbritain.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinnewbritain.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Bloomingdale",
    "URL": "https://dentistinbloomingdaleil.com/",
    "Virtual Receptionist": "(630) 686-1328",
    "Fax Number": "(630) 686-1327",
    "Direct Dial Number": "(630) 686-1327",
    "Gmail": "dentistinbloomingdale@gmail.com",
    "Domain Mail": "dentalcare@dentistinbloomingdaleil.com",
    "Ap Domain Mail": "ap@dentistinbloomingdaleil.com",
    "Address": "366 W Army Trail Rd #310a, Bloomingdale, IL 60108, USA",
    "Book appointment link": "https://dentistinbloomingdaleil.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinbloomingdaleil.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinbloomingdaleil.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Vernon Hills",
    "URL": "https://dentistinvernonhills.com/",
    "Virtual Receptionist": "(847) 978-4077",
    "Fax Number": "",
    "Direct Dial Number": "(847) 796-8762",
    "Gmail": "Dentistinvernonhills@gmail.com",
    "Domain Mail": "DentalCare@dentistinvernonhills.com",
    "Ap Domain Mail": "ap@dentistinvernonhills.com",
    "Address": "555 E Townline Rd Ste 4 Vernon Hills, IL 60061",
    "Book appointment link": "https://dentistinvernonhills.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinvernonhills.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinvernonhills.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "The Rim Dental Care",
    "URL": "https://therimdentalcare.com/",
    "Virtual Receptionist": "",
    "Fax Number": "(726) 215-9920",
    "Direct Dial Number": "(726) 215-9920",
    "Gmail": "rimdentalcare@gmail.com",
    "Domain Mail": "Dentist@therimdentalcare.com",
    "Ap Domain Mail": "ap@therimdentalcare.com",
    "Address": "6028 WORTH PKWY STE 101, SAN ANTONIO, TX 78257-5071",
    "Book appointment link": "https://therimdentalcare.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://therimdentalcare.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://therimdentalcare.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Austin",
    "URL": "https://dentistinaustintx.com/",
    "Virtual Receptionist": "(512) 430-4472",
    "Fax Number": "(512) 430-4563",
    "Direct Dial Number": "(512) 430-4563",
    "Gmail": "dentistinaustin@gmail.com",
    "Domain Mail": "dentalcare@dentistinaustintx.com",
    "Ap Domain Mail": "ap@dentistinaustintx.com",
    "Address": "2110 W Slaughter Ln Ste 190, Austin, TX 78748, USA",
    "Book appointment link": "https://dentistinaustintx.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinaustintx.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinaustintx.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Creek Crossing Dental Care",
    "URL": "https://creekcrossingdentalcare.com/",
    "Virtual Receptionist": "469-333-6158",
    "Fax Number": "",
    "Direct Dial Number": "",
    "Gmail": "creekcrossingdentalcare@gmail.com",
    "Domain Mail": "dentist@creekcrossingdentalcare.com",
    "Ap Domain Mail": "ap@creekcrossingdentalcare.com",
    "Address": "1927 Faithon P Lucas Sr Blvd Ste 120, Mesquite, TX 75181, United States",
    "Book appointment link": "https://creekcrossingdentalcare.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://creekcrossingdentalcare.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://creekcrossingdentalcare.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Winston-Salem",
    "URL": "https://dentistinwinston-salem.com/",
    "Virtual Receptionist": "336-802-1894",
    "Fax Number": "",
    "Direct Dial Number": "",
    "Gmail": "dentistinwinston@gmail.com",
    "Domain Mail": "dentalcare@dentistinwinston-salem.com",
    "Ap Domain Mail": "ap@dentistinwinston-salem.com",
    "Address": "3210 Silas Creek Pkwy, Suite-4Winston salem, NC, 27103",
    "Book appointment link": "https://dentistinwinston-salem.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistinwinston-salem.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistinwinston-salem.patient-portal.tensorlinks.app?link=payments"
  },
  {
    "Clinic": "Dentist in Centennial",
    "URL": "https://dentistincentennial.com/",
    "Virtual Receptionist": "303-923-9068",
    "Fax Number": "",
    "Direct Dial Number": "",
    "Gmail": "dentistincentennial@gmail.com",
    "Domain Mail": "Dentalcare@dentistincentennial.com",
    "Ap Domain Mail": "ap@dentistincentennial.com",
    "Address": "20269 E Smoky Hill Rd, Centennial, CO 80015, USA",
    "Book appointment link": "https://dentistincentennial.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://dentistincentennial.patient-portal.tensorlinks.app/new-patient-schedule",
    "Payment Link": "https://dentistincentennial.com/pay-your-bill/"
  },
  {
    "Clinic": "Reno Dental Care and Orthodontics",
    "URL": "https://renodentalcareandorthodontics.com/",
    "Virtual Receptionist": "775-339-9893",
    "Fax Number": "775-339-9894",
    "Direct Dial Number": "775-339-9894",
    "Gmail": "dentistinrenonv@gmail.com",
    "Domain Mail": "dentalcare@renodentalcareandorthodontics.com",
    "Ap Domain Mail": "ap@renodentalcareandorthodontics.com",
    "Address": "8040 S VIRGINIA ST STE 4 RENO NV 89511-8939",
    "Book appointment link": "https://renodentalcareandorthodontics.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://renodentalcareandorthodontics.patient-portal.tensorlinks.app/?link=appointment/new-patient-schedule",
    "Payment Link": "https://renodentalcareandorthodontics.com/pay-your-bill/"
  },
  {
    "Clinic": "Meadows Dental Care",
    "URL": "https://themeadowsdentalcare.com/",
    "Virtual Receptionist": "(737) 263-1581",
    "Fax Number": "(737) 263-1592",
    "Direct Dial Number": "(737) 263-1592",
    "Gmail": "themeadowsdentalcare@gmail.com",
    "Domain Mail": "dentist@themeadowsdentalcare.com",
    "Ap Domain Mail": "ap@themeadowsdentalcare.com",
    "Address": "9600 S I-35 Frontage Rd Bldg S #275, Austin, TX 78748, United States",
    "Book appointment link": "https://themeadowsdentalcare.patient-portal.tensorlinks.app/?link=appointment/new",
    "New Appointment Link": "https://themeadowsdentalcare.patient-portal.tensorlinks.app/?link=appointment/new-patient-schedule",
    "Payment Link": "https://themeadowsdentalcare.com/pay-your-bill/"
  },
  {
    "Clinic": "Still Water Dental Care and Ortho",
    "URL": "https://stillwaterdentalcareandortho.com/",
    "Virtual Receptionist": "254-492-3224",
    "Fax Number": "",
    "Direct Dial Number": "",
    "Gmail": "dentistinstillwater@gmail.com",
    "Domain Mail": "dentalcare@stillwaterdentalcareandortho.com",
    "Ap Domain Mail": "ap@stillwaterdentalcareandortho.com",
    "Address": "5619 W. Loop, 1604 N Ste 112, San Antonio, TX 78253-5795",
    "Book appointment link": "",
    "New Appointment Link": "",
    "Payment Link": ""
  }
];

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const path = event.path || event.resource || '';

  // Handle OPTIONS request for CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  const groups = getGroupsFromClaims((event.requestContext as any)?.authorizer?.claims);
  const wantsWrite = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'DELETE';
  if (wantsWrite && !isWriteAuthorized(groups)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  try {
    if ((path === '/clinics' || path.endsWith('/clinics')) && httpMethod === 'GET') {
      return await listClinics(event);
    } else if ((path === '/clinics' || path.endsWith('/clinics')) && httpMethod === 'POST') {
      return await createClinic(event);
    } else if ((path.startsWith('/clinics/') || path.includes('/clinics/')) && httpMethod === 'DELETE') {
      const clinicId = event.pathParameters?.clinicId || path.split('/').pop() as string;
      return await deleteClinic(event, clinicId);
    } else if ((path.startsWith('/clinics/') || path.includes('/clinics/')) && httpMethod === 'PUT') {
      const clinicId = event.pathParameters?.clinicId || path.split('/').pop() as string;
      return await updateClinic(event, clinicId);
    } else {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Not Found' }),
      };
    }
  } catch (error: any) {
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

async function listClinics(event: APIGatewayProxyEvent) {
  const search = event.queryStringParameters?.search || '';
  
  // Filter static data based on search
  let filteredClinics = staticClinicData;
  
  if (search) {
    const searchLower = search.toLowerCase();
    filteredClinics = staticClinicData.filter(clinic => 
      Object.values(clinic).some(value => 
        String(value).toLowerCase().includes(searchLower)
      )
    );
  }

  // Add unique IDs for frontend compatibility
  const clinicsWithIds = filteredClinics.map((clinic, index) => ({
    id: index + 1,
    clinic_id: index + 1,
    ...clinic,
    modified_at: new Date().toISOString(),
    modified_by: 'system'
  }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      clinics: clinicsWithIds,
    }),
  };
}

async function createClinic(event: APIGatewayProxyEvent) {
  const body = JSON.parse(event.body || '{}');

  if (!body.Clinic) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Clinic name is required' }),
    };
  }

  const clinicId = uuidv4();
  const timestamp = new Date().toISOString();

  const item = {
    clinic_id: clinicId,
    ...body,
    modified_at: timestamp,
    modified_by: body.modified_by || 'system',
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await docClient.send(command);

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      clinic_id: clinicId,
      message: 'Clinic created successfully',
    }),
  };
}

async function updateClinic(event: APIGatewayProxyEvent, clinicId: string) {
  const body = JSON.parse(event.body || '{}');

  if (!body.Clinic) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Clinic name is required' }),
    };
  }

  const timestamp = new Date().toISOString();

  const item = {
    clinic_id: clinicId,
    ...body,
    modified_at: timestamp,
    modified_by: body.modified_by || 'system',
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      clinic_id: clinicId,
      message: 'Clinic updated successfully',
    }),
  };
}

async function deleteClinic(event: APIGatewayProxyEvent, clinicId: string) {
  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      clinic_id: clinicId,
    },
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ message: 'Clinic deleted successfully' }),
  };
}
