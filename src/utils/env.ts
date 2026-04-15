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

const baseEnvSchema = z.object({
  WHATSAPP_TOKEN: z.string().min(1, "WHATSAPP_TOKEN is required"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "WHATSAPP_PHONE_NUMBER_ID is required"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
});

const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
});

type BaseEnv = z.infer<typeof baseEnvSchema>;
type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;
let cachedWhatsappEnv: BaseEnv | null = null;

function formatEnvIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

function getNormalizedEnvSource(): Record<keyof Env, string | undefined> {
  return {
    DATABASE_URL: getFirstEnvValue("DATABASE_URL"),
    WHATSAPP_TOKEN: getFirstEnvValue("WHATSAPP_TOKEN"),
    WHATSAPP_PHONE_NUMBER_ID: getFirstEnvValue("WHATSAPP_PHONE_NUMBER_ID", "PHONE_NUMBER_ID"),
    WHATSAPP_VERIFY_TOKEN: getFirstEnvValue("WHATSAPP_VERIFY_TOKEN", "VERIFY_TOKEN"),
    OPENAI_API_KEY: getFirstEnvValue("OPENAI_API_KEY", "openai_api_key"),
  };
}

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsedEnv = envSchema.safeParse(getNormalizedEnvSource());

  if (!parsedEnv.success) {
    throw new Error(`Invalid environment configuration: ${formatEnvIssues(parsedEnv.error)}`);
  }

  cachedEnv = parsedEnv.data;
  return cachedEnv;
}

export function getWhatsappEnv(): BaseEnv {
  if (cachedWhatsappEnv) {
    return cachedWhatsappEnv;
  }

  const source = getNormalizedEnvSource();
  const parsedEnv = baseEnvSchema.safeParse({
    WHATSAPP_TOKEN: source.WHATSAPP_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: source.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_VERIFY_TOKEN: source.WHATSAPP_VERIFY_TOKEN,
  });

  if (!parsedEnv.success) {
    throw new Error(`Invalid WhatsApp environment configuration: ${formatEnvIssues(parsedEnv.error)}`);
  }

  cachedWhatsappEnv = parsedEnv.data;
  return cachedWhatsappEnv;
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
