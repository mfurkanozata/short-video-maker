import { createShortInput, CreateShortInput, questionVideoInput, QuestionVideoInput } from "../types/shorts";
import { logger } from "../logger";
import { ZodError } from "zod";

export interface ValidationErrorResult {
  message: string;
  missingFields: Record<string, string>;
}

export function validateCreateShortInput(input: object): CreateShortInput {
  const validated = createShortInput.safeParse(input);
  logger.info({ validated }, "Validated input");

  if (validated.success) {
    return validated.data;
  }

  // Process the validation errors
  const errorResult = formatZodError(validated.error);

  throw new Error(
    JSON.stringify({
      message: errorResult.message,
      missingFields: errorResult.missingFields,
    }),
  );
}

export function validateQuestionVideoInput(input: object): QuestionVideoInput {
  const validated = questionVideoInput.safeParse(input);
  logger.info({ validated }, "Validated question video input");

  if (validated.success) {
    return validated.data;
  }

  // Process the validation errors
  const errorResult = formatZodError(validated.error);

  throw new Error(
    JSON.stringify({
      message: errorResult.message,
      missingFields: errorResult.missingFields,
    }),
  );
}

function formatZodError(error: ZodError): ValidationErrorResult {
  const missingFields: Record<string, string> = {};

  // Extract all the errors into a human-readable format
  error.errors.forEach((err) => {
    const path = err.path.join(".");
    missingFields[path] = err.message;
  });

  // Create a human-readable message
  const errorPaths = Object.keys(missingFields);
  let message = `Validation failed for ${errorPaths.length} field(s): `;
  message += errorPaths.join(", ");

  return {
    message,
    missingFields,
  };
}
