import { config } from "dotenv";
import { z } from "zod";

config();

function getFirstEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  WHATSAPP_TOKEN: z.string().min(1, "WHATSAPP_TOKEN is required"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "WHATSAPP_PHONE_NUMBER_ID is required"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

export function getEnv(): z.infer<typeof envSchema> {
  if (cachedEnv) {
    return cachedEnv;
  }

  const normalizedEnv = {
    DATABASE_URL: getFirstEnvValue("DATABASE_URL"),
    WHATSAPP_TOKEN: getFirstEnvValue("WHATSAPP_TOKEN"),
    WHATSAPP_PHONE_NUMBER_ID: getFirstEnvValue("WHATSAPP_PHONE_NUMBER_ID", "PHONE_NUMBER_ID"),
    WHATSAPP_VERIFY_TOKEN: getFirstEnvValue("WHATSAPP_VERIFY_TOKEN", "VERIFY_TOKEN"),
    OPENAI_API_KEY: getFirstEnvValue("OPENAI_API_KEY", "openai_api_key"),
  };

  const parsedEnv = envSchema.safeParse(normalizedEnv);

  if (!parsedEnv.success) {
    const issues = parsedEnv.error.issues.map((issue) => issue.message).join(", ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  cachedEnv = parsedEnv.data;
  return cachedEnv;
}
