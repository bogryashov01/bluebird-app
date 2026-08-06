import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret && process.env.NODE_ENV !== "development") {
  throw new Error("JWT_SECRET environment variable is required in non-development environments");
}
export const JWT_SECRET = rawSecret ?? "bluebird-dev-only-secret";

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
