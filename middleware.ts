import { NextResponse, type NextRequest } from "next/server";

import {
  getSiteAccessToken,
  getUnlockCookieName,
  isOpenPath,
  isSiteAccessAllowed
} from "@/app/lib/site-access";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isOpenPath(pathname)) {
    return NextResponse.next();
  }

  const token = getSiteAccessToken();
  const cookieValue = request.cookies.get(getUnlockCookieName())?.value;
  const allowed = isSiteAccessAllowed({
    authorization: request.headers.get("authorization"),
    cookieValue,
    pathname,
    token
  });

  if (allowed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "site_locked", message: "Unlock YC OS before using this endpoint." },
      { status: 401 }
    );
  }

  const unlockUrl = request.nextUrl.clone();
  unlockUrl.pathname = "/unlock";
  unlockUrl.search = "";
  unlockUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
