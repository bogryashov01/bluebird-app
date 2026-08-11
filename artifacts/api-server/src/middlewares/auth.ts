import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "@workspace/db";
import { revokedTokensTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret && process.env.NODE_ENV !== "development") {
  throw new Error("JWT_SECRET environment variable is required in non-development environments");
}
export const JWT_SECRET = rawSecret ?? "bluebird-dev-only-secret";

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  const [row] = await db
    .select({ tokenHash: revokedTokensTable.tokenHash })
    .from(revokedTokensTable)
    .where(eq(revokedTokensTable.tokenHash, hashToken(token)));
  return !!row;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    if (await isTokenRevoked(token)) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    (req as any).userId = payload.userId;
    (req as any).token = token;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
