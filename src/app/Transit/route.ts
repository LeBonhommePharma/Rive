import { NextRequest, NextResponse } from "next/server";

// Resolve relative assets against the standalone atlas directory.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/Transit/index.html", request.url));
}
