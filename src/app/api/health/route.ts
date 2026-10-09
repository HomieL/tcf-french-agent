import { handle } from "@/lib/api";

export async function GET() {
  return handle(async ({ provider }) => ({ ok: true, provider: provider.name, model: provider.model }));
}
