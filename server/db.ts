import mysql from "mysql2/promise";

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  phone: string;
  profile_image: string;
  status: "active" | "suspended";
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: number;
  role_name: string;
}

export interface UserRole {
  user_id: number;
  role_id: number;
}

export interface Listing {
  id: number;
  user_id: number;
  title: string;
  description: string;
  category_id: number;
  price: number;
  location: string;
  address: string;
  city: string;
  region: string;
  country: string;
  status: "available" | "sold" | "unavailable";
  approval_status: "pending" | "approved" | "rejected";
  featured: boolean;
  views_count: number;
  created_at: string;
  updated_at: string;
}

export interface ListingImage {
  id: number;
  listing_id: number;
  image_url: string;
}

export interface Category {
  id: number;
  name: string;
  description: string;
}

export interface Inquiry {
  id: number;
  listing_id: number;
  sender_name: string;
  sender_email: string;
  sender_phone: string;
  message: string;
  status: "new" | "replied" | "ignored";
  response_text?: string;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  user_id: number | null;
  action: string;
  description: string;
  created_at: string;
}

export interface ContactMessage {
  id: number;
  sender_name: string;
  sender_email: string;
  subject: string;
  message: string;
  status: "new" | "read";
  created_at: string;
}

let mysqlPool: mysql.Pool | null = null;
let dbInitialized = false;

export function getPool(): mysql.Pool {
  if (!mysqlPool) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return mysqlPool;
}

export function isDatabaseReady(): boolean {
  return dbInitialized && mysqlPool !== null;
}

export async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T> {
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}

export async function execute(sql: string, params?: unknown[]): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().query(sql, params);
  return result as mysql.ResultSetHeader;
}

export async function initDatabase(): Promise<void> {
  const host = process.env.DB_HOST || process.env.MYSQL_HOST || "localhost";
  const port = parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || "3306", 10);
  const user = process.env.DB_USER || process.env.MYSQL_USER || "root";
  const password = process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "";
  const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || "asset_connect_db";

  console.log(`Connecting to MySQL at ${host}:${port}/${database}...`);

  const bootstrap = await mysql.createConnection({ host, port, user, password });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  mysqlPool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  });

  const conn = await mysqlPool.getConnection();
  console.log("Successfully connected to MySQL database.");
  conn.release();

  await createMySQLSchemas();
  await ensureBaselineRoles();
  dbInitialized = true;
}

export async function initMySQL(): Promise<void> {
  return initDatabase();
}

async function createMySQLSchemas() {
  const pool = getPool();

  const queries = [
    `CREATE TABLE IF NOT EXISTS roles (
      id INT PRIMARY KEY,
      role_name VARCHAR(50) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(255) DEFAULT '',
      profile_image LONGTEXT,
      status VARCHAR(50) DEFAULT 'active',
      created_at VARCHAR(255) NOT NULL,
      updated_at VARCHAR(255) NOT NULL,
      UNIQUE KEY unique_email (email)
    )`,
    `CREATE TABLE IF NOT EXISTS user_roles (
      user_id INT NOT NULL,
      role_id INT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS listings (
      id INT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      category_id INT NOT NULL,
      price DECIMAL(15,2) NOT NULL,
      location VARCHAR(255) NOT NULL,
      address VARCHAR(255) DEFAULT '',
      city VARCHAR(255) DEFAULT '',
      region VARCHAR(255) DEFAULT '',
      country VARCHAR(255) DEFAULT '',
      status VARCHAR(50) DEFAULT 'available',
      approval_status VARCHAR(50) DEFAULT 'pending',
      featured TINYINT(1) DEFAULT 0,
      views_count INT DEFAULT 0,
      created_at VARCHAR(255) NOT NULL,
      updated_at VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS listing_images (
      id INT PRIMARY KEY,
      listing_id INT NOT NULL,
      image_url LONGTEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS inquiries (
      id INT PRIMARY KEY,
      listing_id INT NOT NULL,
      sender_name VARCHAR(255) NOT NULL,
      sender_email VARCHAR(255) NOT NULL,
      sender_phone VARCHAR(255) DEFAULT '',
      message TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'new',
      response_text TEXT,
      created_at VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id INT PRIMARY KEY,
      user_id INT,
      action VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      created_at VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id INT PRIMARY KEY,
      sender_name VARCHAR(255) NOT NULL,
      sender_email VARCHAR(255) NOT NULL,
      subject VARCHAR(255) DEFAULT '',
      message TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'new',
      created_at VARCHAR(255) NOT NULL
    )`,
  ];

  for (const q of queries) {
    await pool.query(q);
  }
}

/** Insert role rows required for authorization — not demo/seed business data. */
async function ensureBaselineRoles() {
  const rows = await query<{ count: number }[]>("SELECT COUNT(*) as count FROM roles");
  if (rows[0].count > 0) return;

  console.log("Initializing baseline roles in MySQL...");
  await query(
    "INSERT INTO roles (id, role_name) VALUES (1, 'Super Admin'), (2, 'Admin'), (3, 'User')"
  );
}
