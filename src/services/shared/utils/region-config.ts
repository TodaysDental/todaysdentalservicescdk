/**
 * FIX #39: Region Configuration Management
 * 
 * Centralized region configuration to prevent conflicts and ensure
 * proper region selection for different AWS services.
 */

export class RegionConfig {
  private static instance: RegionConfig;

  public readonly defaultRegion: string;
  public readonly chimeMediaRegion: string;
  public readonly cognitoRegion: string;

  private constructor() {
    // Priority: Explicit > Default > AWS_REGION
    this.defaultRegion = process.env.AWS_REGION || 'us-east-1';

    // Chime Media (where meetings are hosted)
    this.chimeMediaRegion = process.env.CHIME_MEDIA_REGION || this.defaultRegion;

    // Cognito (where users are authenticated)
    this.cognitoRegion = process.env.COGNITO_REGION || this.defaultRegion;

    console.log('[RegionConfig] Initialized:', {
      default: this.defaultRegion,
      chimeMedia: this.chimeMediaRegion,
      cognito: this.cognitoRegion
    });

    // Validate regions
    this.validate();
  }

  private validate(): void {
    const validRegions = [
      'us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1',
      'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1'
    ];

    if (!validRegions.includes(this.defaultRegion)) {
      console.warn(`[RegionConfig] Unusual default region: ${this.defaultRegion}`);
    }

    // Chime Media has limited region support
    const chimeRegions = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-1'];
    if (!chimeRegions.includes(this.chimeMediaRegion)) {
      throw new Error(
        `Invalid CHIME_MEDIA_REGION: ${this.chimeMediaRegion}. ` +
        `Must be one of: ${chimeRegions.join(', ')}`
      );
    }
  }

  static getInstance(): RegionConfig {
    if (!RegionConfig.instance) {
      RegionConfig.instance = new RegionConfig();
    }
    return RegionConfig.instance;
  }
}

/**
 * Get region configuration singleton
 */
export function getRegionConfig(): RegionConfig {
  return RegionConfig.getInstance();
}

