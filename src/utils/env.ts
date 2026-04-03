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

const normalizedEnvSchema = z.object({
  DATABASE_URL: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

type Env = z.infer<typeof normalizedEnvSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
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

  cachedEnv = normalizedEnvSchema.parse(normalizedEnv);
  return cachedEnv;
}

export function requireEnv<const K extends keyof Env>(...keys: K[]): Env & { [P in K]-?: NonNullable<Env[P]> } {
  const env = getEnv();
  const missingKeys = keys.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missingKeys.length > 0) {
    throw new Error(`Invalid environment configuration: ${missingKeys.join(", ")} is required`);
  }

  return env as Env & { [P in K]-?: NonNullable<Env[P]> };
}
