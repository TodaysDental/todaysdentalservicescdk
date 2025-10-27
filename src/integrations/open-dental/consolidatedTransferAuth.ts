export interface TransferAuthEvent {
  username?: string; // some TF events use "username"
  userName?: string; // others use "userName"
  password: string;
  protocol: string;
  serverId: string;
  sourceIp: string;
}

export interface TransferAuthResponse {
  Role: string;
  HomeDirectory: string;
  PublicKeys?: string[];
  Policy?: string;
  // When using AWS_LAMBDA IdP, we can return logical directory mappings so 
  // "/" resolves to an S3 target. This is required for true root-level writes.
  HomeDirectoryDetails?: string; // JSON string per AWS Transfer spec
  HomeDirectoryType?: 'LOGICAL' | 'PATH';
}

interface Clinic {
  clinicId: string;
  clinicName: string;
  sftpFolderPath: string;
  [key: string]: any;
}

export const handler = async (event: TransferAuthEvent): Promise<TransferAuthResponse | {}> => {
  console.log('Transfer Family Auth Event:', JSON.stringify(event, null, 2));

  // Normalize username casing sent by AWS Transfer (can be "username" or "userName")
  const { password, protocol, serverId, sourceIp } = event;
  const username = (event as any).userName || (event as any).username;

  // Get environment variables
  const tfBucket = process.env.TF_BUCKET;
  const tfPassword = process.env.TF_PASSWORD;
  const tfRoleArn = process.env.TF_ROLE_ARN;
  const clinicsConfigStr = process.env.CLINICS_CONFIG;

  if (!tfBucket || !tfPassword || !tfRoleArn || !clinicsConfigStr) {
    console.error('Missing required environment variables');
    return {};
  }

  // Parse clinics configuration
  let clinicsConfig: Clinic[];
  try {
    clinicsConfig = JSON.parse(clinicsConfigStr);
  } catch (error) {
    console.error('Failed to parse clinics configuration:', error);
    return {};
  }

  // Validate password (temporarily accept both legacy and new values)
  const legacyPassword = 'Clinic@2020!';
  const newPassword = 'Clinic2020';
  const isValidPassword = password === tfPassword || password === legacyPassword || password === newPassword;
  if (!isValidPassword) {
    console.log(`Authentication failed for user ${username}: Invalid password`);
    return {};
  }

  // Handle special sftpuser for Open Dental queries (TRUE root access) - Updated 2025-09-03 06:35
  if (username === 'sftpuser') {
    console.log('Authentication successful for Open Dental sftpuser (TRUE root access)');
    console.log('Home directory: / (true root directory for Open Dental compatibility)');

    // Create IAM policy with full bucket access for Open Dental (root directory access)
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowFullBucketListing',
          Effect: 'Allow',
          Action: 's3:ListBucket',
          Resource: `arn:aws:s3:::${tfBucket}`
        },
        {
          Sid: 'AllowFullBucketAccess',
          Effect: 'Allow',
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:GetObjectVersion',
            's3:DeleteObjectVersion'
          ],
          Resource: `arn:aws:s3:::${tfBucket}/*`
        }
      ]
    };

    // Map the logical root "/" to the sftpuser folder in S3 so that
    // SftpAddress "host/filename.csv" writes to s3://<bucket>/sftp-home/sftpuser/filename.csv
    const homeDirDetails = [
      {
        Entry: '/',
        Target: `/${tfBucket}/sftp-home/sftpuser`
      }
    ];

    return {
      Role: tfRoleArn,
      HomeDirectory: '/', // TRUE root directory access for Open Dental compatibility
      HomeDirectoryType: 'LOGICAL',
      HomeDirectoryDetails: JSON.stringify(homeDirDetails),
      Policy: JSON.stringify(policy)
    };
  }

  // Find matching clinic by sftpFolderPath (used as username)
  const matchingClinic = clinicsConfig.find((clinic) => 
    clinic.sftpFolderPath === username
  );

  if (!matchingClinic) {
    console.log(`Authentication failed for user ${username}: No matching clinic found`);
    return {};
  }

  const homeDirectory = `/sftp-home/${matchingClinic.sftpFolderPath}`;

  console.log(`Authentication successful for clinic ${matchingClinic.clinicId} (${matchingClinic.clinicName})`);
  console.log(`Home directory: ${homeDirectory}`);

  // Create IAM policy for this specific clinic's folder
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowListingOfUserFolder',
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: `arn:aws:s3:::${tfBucket}`,
        Condition: {
          StringLike: {
            's3:prefix': [`sftp-home/${matchingClinic.sftpFolderPath}/*`]
          }
        }
      },
      {
        Sid: 'HomeDirObjectAccess',
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject'
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
