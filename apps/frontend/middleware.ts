import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const protectedRoutes = ['/dashboard'];
  const isProtected = protectedRoutes.some((route) => req.nextUrl.pathname.startsWith(route));

  if (!isProtected) {
    return NextResponse.next();
  }

  const hasRefreshCookie = req.cookies.has('refreshToken');
  if (!hasRefreshCookie) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
