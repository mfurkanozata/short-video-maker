import { logger } from "../logger";

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  retryCondition?: (error: any) => boolean;
  // add full jitter to spread thundering herd
  jitter?: boolean;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public lastError: any,
    public attempts: number
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 10000,
    retryCondition = () => true,
    jitter = true
  } = options;

  let lastError: any;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug({ attempt, maxAttempts }, "Retry attempt");
      const result = await operation();
      
      if (attempt > 1) {
        logger.info({ attempt, maxAttempts }, "Operation succeeded after retry");
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if we should retry this error
      if (!retryCondition(error)) {
        logger.debug({ attempt, error: error instanceof Error ? error.message : String(error) }, "Error not retryable");
        throw error;
      }
      
      // If this was the last attempt, throw the error
      if (attempt === maxAttempts) {
        logger.error({ 
          attempt, 
          maxAttempts, 
          error: error instanceof Error ? error.message : String(error) 
        }, "All retry attempts failed");
        
        throw new RetryError(
          `Operation failed after ${maxAttempts} attempts`,
          lastError,
          maxAttempts
        );
      }
      
      // Honor Retry-After header if present (seconds or HTTP-date)
      let effectiveDelay = currentDelay;
      const retryAfter = (error as any)?.response?.headers?.["retry-after"];
      if (retryAfter) {
        const asInt = parseInt(String(retryAfter), 10);
        if (!Number.isNaN(asInt)) {
          effectiveDelay = Math.min(asInt * 1000, maxDelayMs);
        } else {
          const dateMs = Date.parse(String(retryAfter));
          if (!Number.isNaN(dateMs)) {
            effectiveDelay = Math.min(Math.max(0, dateMs - Date.now()), maxDelayMs);
          }
        }
      }

      // Apply full jitter (0..effectiveDelay)
      if (jitter) {
        const jitterAmount = Math.floor(Math.random() * effectiveDelay);
        effectiveDelay = jitterAmount;
      }

      logger.warn({ 
        attempt, 
        maxAttempts, 
        delayMs: effectiveDelay,
        error: error instanceof Error ? error.message : String(error) 
      }, "Operation failed, retrying");
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, effectiveDelay));
      
      // Increase delay for next attempt (exponential backoff)
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }
  
  throw lastError;
}

// Specific retry conditions for different services
export const retryConditions = {
  // ElevenLabs: retry on network errors, rate limits, server errors
  elevenlabs: (error: any) => {
    if (error?.response?.status >= 500) return true; // Server errors
    if (error?.response?.status === 429) return true; // Rate limit
    if (error?.code === 'ECONNRESET') return true; // Connection reset
    if (error?.code === 'ETIMEDOUT') return true; // Timeout
    if (error?.code === 'ENOTFOUND') return true; // DNS error
    return false;
  },
  
  // OpenAI: retry on network errors, rate limits, server errors
  openai: (error: any) => {
    if (error?.response?.status >= 500) return true; // Server errors
    if (error?.response?.status === 429) return true; // Rate limit
    if (error?.response?.status === 408) return true; // Request timeout
    if (error?.code === 'ECONNRESET') return true; // Connection reset
    if (error?.code === 'ETIMEDOUT') return true; // Timeout
    if (error?.code === 'ENOTFOUND') return true; // DNS error
    return false;
  },
  
  // Faster-Whisper: retry on network errors, server errors
  whisper: (error: any) => {
    if (error?.response?.status >= 500) return true; // Server errors
    if (error?.code === 'ECONNRESET') return true; // Connection reset
    if (error?.code === 'ETIMEDOUT') return true; // Timeout
    if (error?.code === 'ENOTFOUND') return true; // DNS error
    if (error?.message?.includes('timeout')) return true; // Timeout in message
    return false;
  },
  
  // Video creation: retry on temporary failures
  video: (error: any) => {
    if (error?.message?.includes('timeout')) return true;
    if (error?.message?.includes('connection')) return true;
    if (error?.message?.includes('network')) return true;
    return false;
  }
};
