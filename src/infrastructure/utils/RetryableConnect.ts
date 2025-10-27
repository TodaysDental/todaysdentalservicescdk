import { ConnectClient } from '@aws-sdk/client-connect';

export class RetryableConnect {
    private connect: ConnectClient;
    private maxRetries: number;
    private baseDelay: number;

    constructor(connect: ConnectClient, maxRetries = 5, baseDelay = 1000) {
        this.connect = connect;
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
    }

    async retry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: any;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                if (error.name === 'TooManyRequestsException') {
                    const delay = Math.min(
                        this.baseDelay * Math.pow(2, attempt),
                        30000 // Max delay of 30 seconds
                    );
                    console.log(`Rate limited. Retrying after ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw error; // Re-throw if it's not a rate limit error
            }
        }
        throw lastError;
    }
}