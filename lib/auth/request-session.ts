import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth/session";
import { WMS_SESSION_COOKIE, type WmsAuthSession } from "@/lib/auth/types";

export async function getRequestSession(): Promise<WmsAuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(WMS_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
