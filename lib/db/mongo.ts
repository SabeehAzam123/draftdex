import mongoose from "mongoose";

declare global {
    // eslint-disable-next-line no-var
    var __mongooseConn: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    throw new Error("MONGO_URI is missing in environment variables.");
}

export async function connectMongo() {
    if (!global.__mongooseConn) global.__mongooseConn = { conn: null, promise: null };

    if (global.__mongooseConn.conn) return global.__mongooseConn.conn;

    if (!global.__mongooseConn.promise) {
        global.__mongooseConn.promise = mongoose
            .connect(MONGO_URI, { dbName: undefined })
            .then((m) => m);
    }

    global.__mongooseConn.conn = await global.__mongooseConn.promise;
    return global.__mongooseConn.conn;
}
