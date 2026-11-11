import { createApi } from "@/lib/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handle = createApi();
export const GET = handle;
export const POST = handle;
