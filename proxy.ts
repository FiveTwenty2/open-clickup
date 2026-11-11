import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Redirect unauthenticated page requests to /login (presence check only;
// API routes validate the session for real). Excludes /api, static assets, /login.
// (Next renamed the "middleware" file convention to "proxy".)
export function proxy(req: NextRequest) {
  const upload = /^\/uploads\/([^/]+)$/.exec(req.nextUrl.pathname);
  if (upload) {
    const destination = req.nextUrl.clone();
    destination.pathname = "/api/legacy-uploads/" + upload[1];
    return NextResponse.rewrite(destination);
  }
  if (req.nextUrl.pathname.startsWith("/uploads/")) return new NextResponse(null, { status: 404 });
  const hasSession = req.cookies.has("cu_session");
  const { pathname } = req.nextUrl;

  if (!hasSession && pathname !== "/login" && !/^\/(submit|shared-task|shared-view)\/[a-zA-Z0-9_-]{32}$/.test(pathname)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
