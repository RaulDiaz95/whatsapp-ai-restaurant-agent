# WhatsApp AI Restaurant Agent Backend

Production-ready backend scaffold for a WhatsApp AI ordering agent built for Vercel serverless functions with Node.js, TypeScript, Prisma, and PostgreSQL.

## Stack

- Node.js 20+
- TypeScript
- Vercel Serverless API Routes
- Prisma ORM
- PostgreSQL
- dotenv for environment configuration

## Project Structure

```text
api/
  health.ts
  webhook.ts
src/
  ai/
  db/
  orders/
  services/
  users/
  utils/
prisma/
  schema.prisma
```

## Environment Variables

Create a local `.env` file from `.env.example` and fill in the required values:

```env
DATABASE_URL=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
OPENAI_API_KEY=
```

The runtime also accepts legacy aliases if they already exist in your deployment:
`PHONE_NUMBER_ID`, `VERIFY_TOKEN`, and `openai_api_key`.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Generate the Prisma client:

```bash
npm run prisma:generate
```

3. Run the initial Prisma migration against your PostgreSQL database:

```bash
npm run prisma:migrate -- --name init
```

4. Start the local Vercel development server:

```bash
npx vercel dev
```

Do not run `npm run dev` for this project. Vercel should be started directly so it can serve the `api/` routes without recursively invoking itself.

The health endpoint will be available at `http://localhost:3000/api/health`.

## Build

Run a type-check build locally with:

```bash
npm run build
```

## Deploy to Vercel

1. Create a new Vercel project linked to this repository.
2. Add the environment variables from `.env.example` in the Vercel project settings.
3. Ensure your PostgreSQL database is reachable from Vercel.
4. Run Prisma migrations as part of your deployment workflow or from a trusted CI/CD step.
5. Deploy with Vercel.

## Notes

- `api/health` returns `{ "status": "ok" }`.
- `api/webhook` is a placeholder ready for WhatsApp webhook verification and message handling logic.
- The Prisma schema includes the initial `User`, `Session`, `Order`, `OrderItem`, and `Address` models.
