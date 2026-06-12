import { Request, Response, NextFunction } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { User } from "./db";

const isProduction = process.env.NODE_ENV === "production";
const configuredSecret = process.env.JWT_SECRET?.trim();

if (isProduction && !configuredSecret) {
  throw new Error("JWT_SECRET environment variable is required in production.");
}

export const JWT_SECRET =
  configuredSecret || "assetconnecthub_dev_only_secret_change_in_production";
export const JWT_EXPIRY = process.env.JWT_EXPIRY || "7d";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    name: string;
    email: string;
    roles: string[]; // e.g. ["Super Admin"] or ["Admin"] or ["User"]
  };
}

// Generate JWT token
export function generateToken(user: User, roles: string[]): string {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: roles
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY } as SignOptions
  );
}

// Authentication Middleware
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: "Access denied. Authentication token required." });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (err) {
      res.status(403).json({ error: "Invalid or expired token." });
      return;
    }

    req.user = decoded;
    next();
  });
}

// Optional Auth (for visitors/inquirers to see listings but tag auth details if logged in)
export function optionalAuthToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    next();
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (!err) {
      req.user = decoded;
    }
    next();
  });
}

// Role Authorization Middleware creator
export function authorizeRoles(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      res.status(403).json({ error: "Access denied. Insufficient privileges." });
      return;
    }

    next();
  };
}
