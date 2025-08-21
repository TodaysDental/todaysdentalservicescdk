export const handler = async (event: any) => {
  console.log('Transfer auth event:', JSON.stringify(event, null, 2));

  const userName = event.userName || event.username;
  const password = event.password;

  console.log('Received:', { userName, password: password ? '***set***' : '***not set***' });
  console.log('Expected:', { username: process.env.TF_USERNAME, password: process.env.TF_PASSWORD ? '***set***' : '***not set***' });

  if (userName !== process.env.TF_USERNAME || password !== process.env.TF_PASSWORD) {
    console.log('Auth failed - credentials mismatch');
    return {};
  }

  console.log('Auth successful, returning role and home directory');

  const roleArn = process.env.TF_ROLE_ARN!;
  const bucket = process.env.TF_BUCKET!;
  const rawPrefix = process.env.TF_PREFIX || `sftp-home/${userName}`;
  const prefix = rawPrefix.replace(/^\/+|\/+$/g, '');

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'ListUserPrefix',
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: [`arn:aws:s3:::${bucket}`],
        Condition: { StringLike: { 's3:prefix': [`${prefix}/*`] } },
      },
      {
        Sid: 'RWUserObjects',
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        Resource: [`arn:aws:s3:::${bucket}/${prefix}/*`],
      },
    ],
  };

  return {
    Role: roleArn,
    HomeDirectoryType: 'LOGICAL',
    HomeDirectoryDetails: JSON.stringify([{ Entry: '/', Target: `/${bucket}/${prefix}` }]),
    Policy: JSON.stringify(policy),
  };
};


