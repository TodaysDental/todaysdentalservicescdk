import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

interface ClinicConfig {
  clinicId: string;
  clinicName: string;
  customerKey: string;
  developerKey: string;
}

/**
 * Loads clinic configurations directly from the clinics.json file
 */
async function getClinics(): Promise<ClinicConfig[]> {
  try {
    // Read from the clinics.json file
    let filePath: string;
    
    // In Lambda environment, the file will be in the deployment package
    if (process.env.LAMBDA_TASK_ROOT) {
      filePath = path.join(process.env.LAMBDA_TASK_ROOT, 'clinics.json');
    } else {
      // For local development, use relative path
      filePath = path.join(__dirname, '..', '..', 'infrastructure', 'configs', 'clinics.json');
    }
    
    // Read and parse the JSON file
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const clinicsData = JSON.parse(fileContent);

    if (!Array.isArray(clinicsData) || clinicsData.length === 0) {
      console.log('No clinics found in clinics.json');
      return [];
    }

    return clinicsData.map((item: any) => ({
      clinicId: item.clinicId,
      clinicName: item.clinicName || item.clinicId,
      customerKey: item.customerKey,
      developerKey: item.developerKey
    }));
  } catch (error) {
    console.error('Error loading clinics from file:', error);
    return [];
  }
}

/**
 * Run the fluoride automation for a specific clinic
 * @returns Statistics about procedures and claims added
 */
async function runFluorideAutomation(clinic: ClinicConfig): Promise<{
  proceduresAdded: number;
  claimsCreated: number;
  missingFluorideTreatments: number;
}> {
  console.log(`Processing clinic: ${clinic.clinicName} (${clinic.clinicId})`);

  const API_BASE_URL = "https://api.opendental.com/api/v1";
  const DEVELOPER_KEY = clinic.developerKey;
  const CUSTOMER_KEY = clinic.customerKey;

  // Headers for Authentication - format must be exactly "ODFHIR {DeveloperKey}/{CustomerKey}"
  // with no spaces between developer key and customer key except for the slash
  const headers = {
    "Authorization": `ODFHIR ${DEVELOPER_KEY}/${CUSTOMER_KEY}`,
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
  
  // Log the authentication info for debugging purposes only (remove in production)
  console.log(`Using auth for ${clinic.clinicId}: Developer=${DEVELOPER_KEY}, Customer=${CUSTOMER_KEY}`);

  // Track statistics
  let proceduresAdded = 0;
  let claimsCreated = 0;
  let missingFluorideTreatments = 0;

  try {
    // Run the query to find missing fluoride treatments
    const missingFluorideData = await runAuditQuery();
    missingFluorideTreatments = missingFluorideData.length;
    console.log(`Found ${missingFluorideTreatments} appointments needing Fluoride for ${clinic.clinicName}`);

    // Process each missing fluoride treatment
    for (const row of missingFluorideData) {
      const patNum = row.PatNum;
      // Ensure date is formatted YYYY-MM-DD for the API
      const procDate = row.ProcDate.split('T')[0];
      const provNum = row.ProvNum;

      console.log(`Processing PatNum ${patNum} for date ${procDate}...`);
      
      // Add the fluoride procedure
      const newProcNum = await addProcedure(patNum, procDate, provNum);
      
      // Create a claim if procedure was added successfully
      if (newProcNum) {
        proceduresAdded++;
        const claimCreated = await createClaim(patNum, newProcNum);
        if (claimCreated) {
          claimsCreated++;
        }
      }
    }
    
    console.log(`Clinic ${clinic.clinicId} summary: Added ${proceduresAdded} procedures and ${claimsCreated} claims`);
    
  } catch (error: any) {
    console.error(`Error processing clinic ${clinic.clinicId}: ${error.message}`);
  }

  return {
    proceduresAdded,
    claimsCreated,
    missingFluorideTreatments
  };

  /**
   * Runs the SQL query via API to find missing D1206s.
   */
  async function runAuditQuery(): Promise<Array<{PatNum: string; ProcDate: string; ProvNum: string}>> {
    const sql = `
      SELECT p.PatNum, pl.ProcDate, pl.ProvNum
      FROM procedurelog pl
      INNER JOIN patient p ON p.PatNum = pl.PatNum
      INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum
      WHERE pc.ProcCode IN ('D1110', 'D1120')
      AND pl.ProcStatus = 2
      AND NOT EXISTS (
        SELECT 1 FROM procedurelog pl2
        INNER JOIN procedurecode pc2 ON pc2.CodeNum = pl2.CodeNum
        WHERE pl2.PatNum = pl.PatNum
        AND pl2.ProcDate = pl.ProcDate
        AND pc2.ProcCode = 'D1206'
        AND pl2.ProcStatus = 2
      )
    `;

    try {
      // POST /queries endpoint for running SQL queries
      const url = `${API_BASE_URL}/queries`;
      
      // Include SFTP details required by Open Dental API
      // The file will be saved to the clinic's SFTP folder with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sftpPath = `${clinic.clinicId}/QuerytemplateCSV/missing-fluoride-${timestamp}.csv`;
      
      // Get SFTP credentials from environment variables if available
      const sftpUsername = process.env.CONSOLIDATED_SFTP_USERNAME || "sftpuser";
      const sftpPassword = process.env.CONSOLIDATED_SFTP_PASSWORD || "Clinic2020";
      
      // Query payload with SFTP details
      const queryPayload = {
        SqlCommand: sql,
        SftpAddress: `sftp-home/${sftpPath}`,
        SftpPort: 22,
        SftpUsername: sftpUsername,
        SftpPassword: sftpPassword
      };
      
      // Add timeout to prevent hanging if API is unresponsive
      const response = await axios.post(url, queryPayload, { 
        headers, 
        timeout: 10000 // 10 second timeout
      });
      
      // POST requests often return 200 or 201
      if (response.status === 200 || response.status === 201) {
        console.log(`SQL query results saved to SFTP path: ${sftpPath}`);
        return response.data;
      } else {
        console.warn(`Unexpected response status: ${response.status}`);
        console.warn(`Response data:`, response.data);
      }
    } catch (error: any) {
      console.error(`Error running query for clinic ${clinic.clinicId}: ${error.message}`);
      
      // Provide detailed error information for debugging
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error(`Response data:`, error.response.data);
        
        // Special handling for auth errors
        if (error.response.status === 401) {
          console.error(`Authentication failed for clinic ${clinic.clinicId}. Please verify developer key and customer key.`);
        }
      } else if (error.request) {
        console.error(`No response received from server. Request:`, error.request);
      }
    }
    
    return [];
  }

  /**
   * Adds the D1206 procedure to the patient's chart.
   * Returns the new ProcNum.
   */
  async function addProcedure(patNum: string, dateStr: string, provNum: string): Promise<string | null> {
    const url = `${API_BASE_URL}/procedures`;
    
    const payload = {
      "PatNum": patNum,
      "ProcDate": dateStr,
      "ProcCode": "D1206",
      "ProcStatus": "2", // Complete
      "ProvNum": provNum,
    };

    try {
      const response = await axios.post(url, payload, { 
        headers,
        timeout: 10000 // 10 second timeout
      });
      
      if (response.status === 201) {
        const data = response.data;
        console.log(`  [SUCCESS] Added D1206 for PatNum ${patNum} on ${dateStr}. New ProcNum: ${data.ProcNum}`);
        return data.ProcNum;
      } else {
        console.warn(`  [WARNING] Unexpected response status ${response.status} when adding procedure`);
        console.warn(`  Response data:`, response.data);
      }
    } catch (error: any) {
      console.error(`  [ERROR] Failed to add procedure: ${error.message}`);
      
      if (error.response) {
        console.error(`  Status: ${error.response.status}`);
        console.error(`  Response data:`, error.response.data);
        
        if (error.response.status === 401) {
          console.error(`  Authentication failed while adding procedure. Check API keys.`);
        }
      }
    }
    
    return null;
  }

  /**
   * Creates a claim for the specific procedure.
   * @returns boolean indicating if claim was successfully created
   */
  async function createClaim(patNum: string, procNum: string): Promise<boolean> {
    const url = `${API_BASE_URL}/claims/CreateClaim`;
    
    const payload = {
      "PatNum": patNum,
      "ProcNums": [procNum],
      "ClaimType": "P" // Primary
    };

    try {
      const response = await axios.post(url, payload, { 
        headers,
        timeout: 10000 // 10 second timeout  
      });
      
      if (response.status === 201) {
        console.log(`  [SUCCESS] Claim created for ProcNum ${procNum}`);
        return true;
      } else {
        console.warn(`  [WARNING] Unexpected response status ${response.status} when creating claim`);
        console.warn(`  Response data:`, response.data);
      }
    } catch (error: any) {
      if (error.response && error.response.status === 400) {
        console.log(`  [WARNING] Could not create claim (Patient might not have insurance): ${error.response.data}`);
      } else if (error.response && error.response.status === 401) {
        console.error(`  [ERROR] Authentication failed while creating claim. Check API keys.`);
        console.error(`  Response data:`, error.response.data);
      } else {
        console.error(`  [ERROR] Claim creation failed: ${error.message}`);
        if (error.response) console.error(`  Response data:`, error.response.data);
      }
    }
    return false;
  }
}

/**
 * Lambda handler function that runs once per hour
 */
export const handler = async (event: any): Promise<any> => {
  const startTime = new Date();
  console.log('=== Starting Fluoride Automation Lambda ===');
  console.log(`Execution started at: ${startTime.toISOString()}`);
  console.log('Event:', JSON.stringify(event));
  
  try {
    // Get all clinics
    const clinics = await getClinics();
    console.log(`Found ${clinics.length} clinics to process`);
    
    // Track statistics
    let processedCount = 0;
    let errorCount = 0;
    let totalProceduresAdded = 0;
    let totalClaimsCreated = 0;
    let totalMissingTreatments = 0;
    
    // Process each clinic
    for (const clinic of clinics) {
      try {
        console.log(`\n=== Processing clinic: ${clinic.clinicName} (${clinic.clinicId}) ===`);
        const stats = await runFluorideAutomation(clinic);
        
        // Update global stats
        totalProceduresAdded += stats.proceduresAdded;
        totalClaimsCreated += stats.claimsCreated;
        totalMissingTreatments += stats.missingFluorideTreatments;
        
        processedCount++;
      } catch (clinicError: any) {
        errorCount++;
        console.error(`Failed to process clinic ${clinic.clinicId}: ${clinicError.message}`);
      }
    }
    
    const endTime = new Date();
    const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
    
    console.log('\n=== Fluoride Automation Summary ===');
    console.log(`Total clinics: ${clinics.length}`);
    console.log(`Successfully processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Missing fluoride treatments found: ${totalMissingTreatments}`);
    console.log(`Procedures added: ${totalProceduresAdded}`);
    console.log(`Claims created: ${totalClaimsCreated}`);
    console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);
    console.log(`Completed at: ${endTime.toISOString()}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully processed ${processedCount} clinics`,
        statistics: {
          totalClinics: clinics.length,
          successfulClinics: processedCount,
          errorClinics: errorCount,
          missingTreatments: totalMissingTreatments,
          proceduresAdded: totalProceduresAdded,
          claimsCreated: totalClaimsCreated,
          executionTime: `${executionTime.toFixed(2)} seconds`
        },
        timestamp: endTime.toISOString()
      })
    };
  } catch (error: any) {
    console.error('Fatal error in Lambda handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error running fluoride automation',
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};