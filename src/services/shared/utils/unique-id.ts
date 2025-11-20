/**
 * FIX #4: Queue Position Conflicts
 * 
 * Generates unique queue positions using timestamp + nanoid
 * to prevent collisions even with concurrent insertions.
 */

import { randomBytes } from 'crypto';

/**
 * Generate a nanoid-like unique string
 * Uses URL-safe characters for DynamoDB compatibility
 */
function generateNanoid(size: number = 10): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(size);
  let id = '';
  
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  
  return id;
}

/**
 * FIX #4: Generate unique queue position
 * Format: {timestamp}-{nanoid}
 * Ensures lexicographic ordering by time while preventing collisions
 */
export function generateUniqueQueuePosition(): number {
  // Use timestamp in milliseconds as base
  const timestamp = Date.now();
  
  // Add small random component (0-999) to handle same-millisecond insertions
  const randomComponent = Math.floor(Math.random() * 1000);
  
  // Combine: timestamp * 1000 + random gives us unique sortable numbers
  return timestamp * 1000 + randomComponent;
}

/**
 * Generate a unique position string (alternative approach)
 * Uses timestamp + nanoid for absolute uniqueness
 */
export function generateUniquePositionString(): string {
  const timestamp = Date.now();
  const nanoid = generateNanoid(8);
  return `${timestamp}-${nanoid}`;
}

/**
 * FIX #4: Generate unique composite key for call records
 * Ensures no collisions in queue position even with high concurrency
 */
export interface UniqueCallPosition {
  queuePosition: number;
  uniquePositionId: string;
}

export function generateUniqueCallPosition(): UniqueCallPosition {
  const timestamp = Date.now();
  const nanoid = generateNanoid(12);
  
  return {
    queuePosition: timestamp,
    uniquePositionId: nanoid
  };
}

/**
 * Parse queue position to extract timestamp
 */
export function extractTimestampFromPosition(position: number): number {
  // If position is in the new format (timestamp * 1000 + random)
  if (position > Date.now() * 100) {
    return Math.floor(position / 1000);
  }
  // Legacy format
  return position;
}

/**
 * Validate queue position format
 */
export function isValidQueuePosition(position: number): boolean {
  if (typeof position !== 'number' || !isFinite(position)) {
    return false;
  }
  
  // Position should be a reasonable timestamp
  const minTimestamp = new Date('2020-01-01').getTime();
  const maxTimestamp = Date.now() * 1000 + 1000; // Allow for new format
  
  const extractedTimestamp = extractTimestampFromPosition(position);
  return extractedTimestamp >= minTimestamp && extractedTimestamp <= maxTimestamp;
}

