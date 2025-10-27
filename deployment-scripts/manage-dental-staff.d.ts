export interface OpenDentalUser {
    UserNum: number;
    UserName: string;
    userGroupNums: number[];
    EmployeeNum: number;
    employeeName: string;
    ClinicNum: number;
    ProviderNum: number;
    providerName: string;
    emailAddress: string;
    IsHidden: string;
    UserNumCEMT: number;
    IsPasswordResetRequired: string;
}
export interface DentalStaffAttributes {
    email: string;
    hourlyPay?: string;
    openDentalUserNum?: string;
    openDentalUserName?: string;
    employeeNum?: string;
    providerNum?: string;
    clinicNum?: string;
}
export declare class CognitoDentalStaffManager {
    private userPoolId;
    constructor(userPoolId: string);
    /**
     * Update a Cognito user's dental staff attributes
     */
    updateUserAttributes(username: string, attributes: DentalStaffAttributes): Promise<void>;
    /**
     * Get a user's current attributes
     */
    getUserAttributes(username: string): Promise<Record<string, string>>;
    /**
     * Sync OpenDental users with Cognito user attributes
     */
    syncWithOpenDental(openDentalUsers: OpenDentalUser[], hourlyPayRates?: Record<string, string>): Promise<void>;
    /**
     * Sync user's clinic groups based on their OpenDental ClinicNum
     */
    syncUserClinicGroups(username: string, clinicNum: number): Promise<void>;
    /**
     * List all users with their dental staff attributes
     */
    listUsersWithAttributes(): Promise<void>;
}
