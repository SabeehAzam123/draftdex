import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import type { ErrorCode } from "./codes";

export type ErrorResponse = {
    message: string;
    code: ErrorCode | string;
    traceId: string;
};

export function errorJson(status: number, message: string, code: ErrorCode | string, traceId?: string) {
    const body: ErrorResponse = { message, code, traceId: traceId || uuidv4() };
    return NextResponse.json(body, { status });
}
