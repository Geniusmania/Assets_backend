import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import apiRouter from "./src/api";
import { initDatabase } from "./src/db";
import * as repo from "./src/repository";

dotenv.config();

const FRONTEND_DIST = path.resolve(__dirname, "..", "frontend", "dist");

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  console.log("Initializing MySQL database...");
  await initDatabase();
  const userCount = await repo.countUsers();
  const listingCount = await repo.countListings();
  console.log(`Database ready with ${userCount} users and ${listingCount} listings.`);

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  app.use("/api", apiRouter);

  if (process.env.NODE_ENV === "production") {
    console.log("Starting server in production mode...");
    app.use(express.static(FRONTEND_DIST));
    app.use((_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`===============================================`);
    console.log(`Asset Connect Hub API is active!`);
    console.log(`Local Access: http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`Run the frontend with: cd frontend && npm run dev`);
    }
    console.log(`===============================================`);
  });
}

startServer().catch((error) => {
  console.error("Critical error starting Asset Connect Hub engine:", error);
});
