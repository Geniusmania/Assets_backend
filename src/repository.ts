import {
  query,
  execute,
  User,
  Listing,
  Category,
  Inquiry,
  ContactMessage,
  ActivityLog,
  Role,
} from "./db";

const DEFAULT_LISTING_IMAGE =
  "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800";
const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150";

async function nextId(table: string): Promise<number> {
  const rows = await query<{ id: number }[]>(
    `SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${table}`
  );
  return rows[0].id;
}

function formatListing(row: Record<string, unknown>): Listing {
  return {
    ...row,
    price: parseFloat(String(row.price)),
    featured: row.featured === 1 || row.featured === true,
  } as Listing;
}

export async function insertActivityLog(
  userId: number | null,
  action: string,
  description: string
): Promise<void> {
  const id = await nextId("activity_logs");
  const created_at = new Date().toISOString();
  await query(
    "INSERT INTO activity_logs (id, user_id, action, description, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, userId, action, description, created_at]
  );
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await query<User[]>("SELECT * FROM users WHERE email = ?", [
    email.toLowerCase(),
  ]);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<User | null> {
  const rows = await query<User[]>("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function getUserRoles(userId: number): Promise<string[]> {
  const rows = await query<{ role_name: string }[]>(
    `SELECT r.role_name FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map((r) => r.role_name);
}

export async function createUser(data: {
  name: string;
  email: string;
  password_hash: string;
  phone?: string;
}): Promise<User> {
  const id = await nextId("users");
  const now = new Date().toISOString();
  const user: User = {
    id,
    name: data.name,
    email: data.email.toLowerCase(),
    password_hash: data.password_hash,
    phone: data.phone || "",
    profile_image: DEFAULT_AVATAR,
    status: "active",
    created_at: now,
    updated_at: now,
  };

  await query(
    "INSERT INTO users (id, name, email, password_hash, phone, profile_image, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      user.id,
      user.name,
      user.email,
      user.password_hash,
      user.phone,
      user.profile_image,
      user.status,
      user.created_at,
      user.updated_at,
    ]
  );

  return user;
}

export async function assignUserRole(userId: number, roleName: string): Promise<void> {
  const roles = await query<Role[]>("SELECT * FROM roles WHERE role_name = ?", [roleName]);
  const role = roles[0];
  if (!role) throw new Error(`Role '${roleName}' not found in database.`);

  await query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, role.id]);
}

export async function replaceUserRole(userId: number, roleName: string): Promise<void> {
  const roles = await query<Role[]>("SELECT * FROM roles WHERE role_name = ?", [roleName]);
  const role = roles[0];
  if (!role) throw new Error(`Role '${roleName}' not found in database.`);

  await query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, role.id]);
}

export async function updateUserProfile(
  userId: number,
  updates: { name?: string; phone?: string; profile_image?: string; password_hash?: string }
): Promise<User | null> {
  const user = await findUserById(userId);
  if (!user) return null;

  const name = updates.name ?? user.name;
  const phone = updates.phone !== undefined ? updates.phone : user.phone;
  const profile_image = updates.profile_image ?? user.profile_image;
  const password_hash = updates.password_hash ?? user.password_hash;
  const updated_at = new Date().toISOString();

  await query(
    "UPDATE users SET name = ?, phone = ?, profile_image = ?, password_hash = ?, updated_at = ? WHERE id = ?",
    [name, phone, profile_image, password_hash, updated_at, userId]
  );

  return { ...user, name, phone, profile_image, password_hash, updated_at };
}

export async function listCategories(): Promise<Category[]> {
  return query<Category[]>("SELECT * FROM categories ORDER BY id");
}

export async function findCategoryById(id: number): Promise<Category | null> {
  const rows = await query<Category[]>("SELECT * FROM categories WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function createCategory(name: string, description: string): Promise<Category> {
  const id = await nextId("categories");
  const cat: Category = { id, name, description };
  await query("INSERT INTO categories (id, name, description) VALUES (?, ?, ?)", [
    id,
    name,
    description,
  ]);
  return cat;
}

export async function updateCategory(
  id: number,
  name?: string,
  description?: string
): Promise<Category | null> {
  const cat = await findCategoryById(id);
  if (!cat) return null;

  const newName = name ?? cat.name;
  const newDesc = description !== undefined ? description : cat.description;
  await query("UPDATE categories SET name = ?, description = ? WHERE id = ?", [
    newName,
    newDesc,
    id,
  ]);
  return { id, name: newName, description: newDesc };
}

export async function deleteCategory(id: number): Promise<boolean> {
  const listingCount = await query<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM listings WHERE category_id = ?",
    [id]
  );
  if (listingCount[0].count > 0) return false;

  const result = await execute("DELETE FROM categories WHERE id = ?", [id]);
  return result.affectedRows !== 0;
}

export async function getListingImages(listingId: number): Promise<string[]> {
  const rows = await query<{ image_url: string }[]>(
    "SELECT image_url FROM listing_images WHERE listing_id = ?",
    [listingId]
  );
  return rows.map((r) => r.image_url);
}

export async function setListingImages(listingId: number, urls: string[]): Promise<void> {
  await query("DELETE FROM listing_images WHERE listing_id = ?", [listingId]);

  const validUrls = urls.filter((u) => u && u.trim() !== "");
  const toInsert =
    validUrls.length > 0 ? validUrls : [DEFAULT_LISTING_IMAGE];

  for (const url of toInsert) {
    const imgId = await nextId("listing_images");
    await query("INSERT INTO listing_images (id, listing_id, image_url) VALUES (?, ?, ?)", [
      imgId,
      listingId,
      url.trim(),
    ]);
  }
}

export interface ListingFilters {
  category_id?: number;
  search?: string;
  location?: string;
  min_price?: number;
  max_price?: number;
  featured?: boolean;
  sort?: string;
}

export async function listPublicListings(filters: ListingFilters = {}) {
  let sql = `
    SELECT l.*, c.name AS category_name,
      u.name AS seller_name, u.email AS seller_email, u.phone AS seller_phone, u.profile_image AS seller_profile_image
    FROM listings l
    JOIN categories c ON c.id = l.category_id
    JOIN users u ON u.id = l.user_id
    WHERE l.approval_status = 'approved' AND l.status = 'available'
  `;
  const params: unknown[] = [];

  if (filters.category_id) {
    sql += " AND l.category_id = ?";
    params.push(filters.category_id);
  }
  if (filters.search) {
    sql +=
      " AND (LOWER(l.title) LIKE ? OR LOWER(l.description) LIKE ? OR LOWER(l.city) LIKE ? OR LOWER(l.region) LIKE ?)";
    const term = `%${filters.search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }
  if (filters.location) {
    sql +=
      " AND (LOWER(l.location) LIKE ? OR LOWER(l.city) LIKE ? OR LOWER(l.region) LIKE ? OR LOWER(l.country) LIKE ?)";
    const term = `%${filters.location.toLowerCase()}%`;
    params.push(term, term, term, term);
  }
  if (filters.min_price !== undefined) {
    sql += " AND l.price >= ?";
    params.push(filters.min_price);
  }
  if (filters.max_price !== undefined) {
    sql += " AND l.price <= ?";
    params.push(filters.max_price);
  }
  if (filters.featured) {
    sql += " AND l.featured = 1";
  }

  if (filters.sort === "price-asc") sql += " ORDER BY l.price ASC";
  else if (filters.sort === "price-desc") sql += " ORDER BY l.price DESC";
  else if (filters.sort === "views") sql += " ORDER BY l.views_count DESC";
  else sql += " ORDER BY l.created_at DESC";

  const rows = await query<Record<string, unknown>[]>(sql, params);

  return Promise.all(
    rows.map(async (row) => {
      const images = await getListingImages(row.id as number);
      return {
        ...formatListing(row),
        category_name: row.category_name,
        images: images.length > 0 ? images : [DEFAULT_LISTING_IMAGE],
        seller: {
          name: row.seller_name,
          email: row.seller_email,
          phone: row.seller_phone,
          profile_image: row.seller_profile_image,
        },
      };
    })
  );
}

export async function listMyListings(userId: number, isSuperAdmin: boolean) {
  let sql = `
    SELECT l.*, c.name AS category_name,
      u.name AS seller_name, u.email AS seller_email, u.phone AS seller_phone
    FROM listings l
    JOIN categories c ON c.id = l.category_id
    JOIN users u ON u.id = l.user_id
  `;
  const params: unknown[] = [];

  if (!isSuperAdmin) {
    sql += " WHERE l.user_id = ?";
    params.push(userId);
  }

  sql += " ORDER BY l.created_at DESC";

  const rows = await query<Record<string, unknown>[]>(sql, params);

  return Promise.all(
    rows.map(async (row) => {
      const images = await getListingImages(row.id as number);
      return {
        ...formatListing(row),
        category_name: row.category_name,
        images: images.length > 0 ? images : [DEFAULT_LISTING_IMAGE],
        seller: {
          name: row.seller_name,
          email: row.seller_email,
          phone: row.seller_phone,
        },
      };
    })
  );
}

export async function getListingDetail(id: number, incrementViews = false) {
  const rows = await query<Record<string, unknown>[]>(
    `SELECT l.*, c.name AS category_name,
      u.id AS seller_id, u.name AS seller_name, u.email AS seller_email,
      u.phone AS seller_phone, u.profile_image AS seller_profile_image, u.created_at AS seller_joined
     FROM listings l
     JOIN categories c ON c.id = l.category_id
     JOIN users u ON u.id = l.user_id
     WHERE l.id = ?`,
    [id]
  );

  const row = rows[0];
  if (!row) return null;

  if (incrementViews) {
    await query("UPDATE listings SET views_count = views_count + 1 WHERE id = ?", [id]);
    row.views_count = (row.views_count as number) + 1;
  }

  const images = await getListingImages(id);

  return {
    ...formatListing(row),
    category_name: row.category_name,
    images: images.length > 0 ? images : [DEFAULT_LISTING_IMAGE],
    seller: {
      id: row.seller_id,
      name: row.seller_name,
      email: row.seller_email,
      phone: row.seller_phone,
      profile_image: row.seller_profile_image,
      joined: row.seller_joined,
    },
  };
}

export async function findListingById(id: number): Promise<Listing | null> {
  const rows = await query<Record<string, unknown>[]>("SELECT * FROM listings WHERE id = ?", [id]);
  return rows[0] ? formatListing(rows[0]) : null;
}

export async function createListing(
  data: Omit<Listing, "id" | "views_count" | "created_at" | "updated_at">,
  images: string[]
): Promise<Listing> {
  const id = await nextId("listings");
  const now = new Date().toISOString();
  const listing: Listing = {
    ...data,
    id,
    views_count: 0,
    created_at: now,
    updated_at: now,
  };

  await query(
    `INSERT INTO listings (id, user_id, title, description, category_id, price, location, address, city, region, country, status, approval_status, featured, views_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      listing.id,
      listing.user_id,
      listing.title,
      listing.description,
      listing.category_id,
      listing.price,
      listing.location,
      listing.address,
      listing.city,
      listing.region,
      listing.country,
      listing.status,
      listing.approval_status,
      listing.featured ? 1 : 0,
      listing.views_count,
      listing.created_at,
      listing.updated_at,
    ]
  );

  await setListingImages(id, images);
  return listing;
}

export async function updateListing(
  id: number,
  updates: Partial<Listing>,
  images?: string[]
): Promise<Listing | null> {
  const existing = await findListingById(id);
  if (!existing) return null;

  const listing: Listing = {
    ...existing,
    ...updates,
    id,
    updated_at: new Date().toISOString(),
  };

  await query(
    `UPDATE listings SET title = ?, description = ?, category_id = ?, price = ?, location = ?, address = ?, city = ?, region = ?, country = ?, status = ?, approval_status = ?, featured = ?, updated_at = ?
     WHERE id = ?`,
    [
      listing.title,
      listing.description,
      listing.category_id,
      listing.price,
      listing.location,
      listing.address,
      listing.city,
      listing.region,
      listing.country,
      listing.status,
      listing.approval_status,
      listing.featured ? 1 : 0,
      listing.updated_at,
      id,
    ]
  );

  if (images !== undefined) {
    await setListingImages(id, images);
  }

  return listing;
}

export async function deleteListing(id: number): Promise<boolean> {
  const listing = await findListingById(id);
  if (!listing) return false;

  await query("DELETE FROM listing_images WHERE listing_id = ?", [id]);
  await query("DELETE FROM inquiries WHERE listing_id = ?", [id]);
  await query("DELETE FROM listings WHERE id = ?", [id]);
  return true;
}

export async function createInquiry(data: Omit<Inquiry, "id" | "created_at">): Promise<Inquiry> {
  const id = await nextId("inquiries");
  const created_at = new Date().toISOString();
  const inquiry: Inquiry = { ...data, id, created_at };

  await query(
    `INSERT INTO inquiries (id, listing_id, sender_name, sender_email, sender_phone, message, status, response_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      inquiry.id,
      inquiry.listing_id,
      inquiry.sender_name,
      inquiry.sender_email,
      inquiry.sender_phone,
      inquiry.message,
      inquiry.status,
      inquiry.response_text ?? null,
      inquiry.created_at,
    ]
  );

  return inquiry;
}

export async function listInquiriesForOwner(userId: number, isSuperAdmin: boolean) {
  let sql = `
    SELECT i.*, l.title AS listing_title, l.price AS listing_price
    FROM inquiries i
    JOIN listings l ON l.id = i.listing_id
  `;
  const params: unknown[] = [];

  if (!isSuperAdmin) {
    sql += " WHERE l.user_id = ?";
    params.push(userId);
  }

  sql += " ORDER BY i.created_at DESC";

  return query<Inquiry & { listing_title: string; listing_price: number }[]>(sql, params);
}

export async function findInquiryById(id: number): Promise<Inquiry | null> {
  const rows = await query<Inquiry[]>("SELECT * FROM inquiries WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function updateInquiry(
  id: number,
  updates: Partial<Pick<Inquiry, "status" | "response_text">>
): Promise<Inquiry | null> {
  const inquiry = await findInquiryById(id);
  if (!inquiry) return null;

  const status = updates.status ?? inquiry.status;
  const response_text =
    updates.response_text !== undefined ? updates.response_text : inquiry.response_text;

  await query("UPDATE inquiries SET status = ?, response_text = ? WHERE id = ?", [
    status,
    response_text ?? null,
    id,
  ]);

  return { ...inquiry, status, response_text };
}

export async function createContactMessage(
  data: Omit<ContactMessage, "id" | "created_at">
): Promise<ContactMessage> {
  const id = await nextId("contact_messages");
  const created_at = new Date().toISOString();
  const msg: ContactMessage = { ...data, id, created_at };

  await query(
    "INSERT INTO contact_messages (id, sender_name, sender_email, subject, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      msg.id,
      msg.sender_name,
      msg.sender_email,
      msg.subject,
      msg.message,
      msg.status,
      msg.created_at,
    ]
  );

  return msg;
}

export async function listContactMessages(): Promise<ContactMessage[]> {
  return query<ContactMessage[]>("SELECT * FROM contact_messages ORDER BY created_at DESC");
}

export async function getDashboardAnalytics() {
  const users = await query<{ count: number }[]>("SELECT COUNT(*) as count FROM users");
  const listings = await query<{ count: number }[]>("SELECT COUNT(*) as count FROM listings");
  const inquiries = await query<{ count: number }[]>("SELECT COUNT(*) as count FROM inquiries");
  const pending = await query<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM listings WHERE approval_status = 'pending'"
  );
  const approved = await query<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM listings WHERE approval_status = 'approved'"
  );
  const sold = await query<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM listings WHERE status = 'sold'"
  );

  const categorySplit = await query<{ name: string; count: number }[]>(
  `SELECT c.name, COUNT(l.id) as count FROM categories c
   LEFT JOIN listings l ON l.category_id = c.id
   GROUP BY c.id, c.name`
  );

  const recentRows = await query<Record<string, unknown>[]>(
    `SELECT l.*, c.name AS category_name, u.name AS seller_name
     FROM listings l
     JOIN categories c ON c.id = l.category_id
     JOIN users u ON u.id = l.user_id
     ORDER BY l.created_at DESC LIMIT 5`
  );

  const recentListings = recentRows.map((row) => ({
    ...formatListing(row),
    category_name: row.category_name,
    seller_name: row.seller_name,
  }));

  return {
    metrics: {
      totalUsers: users[0].count,
      totalListings: listings[0].count,
      totalInquiries: inquiries[0].count,
      pendingListings: pending[0].count,
      approvedListings: approved[0].count,
      soldListings: sold[0].count,
    },
    categorySplit,
    recentListings,
  };
}

export async function getSellerStats(userId: number) {
  const myListings = await query<Listing[]>("SELECT * FROM listings WHERE user_id = ?", [userId]);
  const formatted = myListings.map((l) => formatListing(l as unknown as Record<string, unknown>));

  const totalViews = formatted.reduce((sum, l) => sum + l.views_count, 0);
  const soldCount = formatted.filter((l) => l.status === "sold").length;
  const pendingApprovalCount = formatted.filter((l) => l.approval_status === "pending").length;
  const listingIds = formatted.map((l) => l.id);

  let inquiries: Inquiry[] = [];
  if (listingIds.length > 0) {
    inquiries = await query<Inquiry[]>(
      `SELECT * FROM inquiries WHERE listing_id IN (${listingIds.map(() => "?").join(",")})`,
      listingIds
    );
  }

  return {
    totalListed: formatted.length,
    totalViews,
    soldCount,
    pendingApprovalCount,
    inquiriesCount: inquiries.length,
    newInquiriesCount: inquiries.filter((i) => i.status === "new").length,
    listingsSummary: formatted.map((l) => ({
      id: l.id,
      title: l.title,
      price: l.price,
      status: l.status,
      approval_status: l.approval_status,
      views: l.views_count,
    })),
  };
}

export async function listUsersWithRoles() {
  const users = await query<User[]>("SELECT * FROM users ORDER BY id");
  return Promise.all(
    users.map(async (u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      profile_image: u.profile_image,
      status: u.status,
      roles: await getUserRoles(u.id),
      created_at: u.created_at,
    }))
  );
}

export async function updateUserStatus(userId: number, status: "active" | "suspended"): Promise<boolean> {
  const updated_at = new Date().toISOString();
  const result = await execute("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [
    status,
    updated_at,
    userId,
  ]);
  return result.affectedRows !== 0;
}

export async function changeUserRole(targetId: number, roleName: string): Promise<boolean> {
  const user = await findUserById(targetId);
  if (!user) return false;

  const currentRoles = await getUserRoles(targetId);
  if (currentRoles.includes("Super Admin")) return false;

  await replaceUserRole(targetId, roleName);
  return true;
}

export async function deleteUser(targetId: number): Promise<User | null> {
  const user = await findUserById(targetId);
  if (!user) return null;

  const listings = await query<{ id: number }[]>("SELECT id FROM listings WHERE user_id = ?", [
    targetId,
  ]);
  const listingIds = listings.map((l) => l.id);

  if (listingIds.length > 0) {
    const placeholders = listingIds.map(() => "?").join(",");
    await query(`DELETE FROM listing_images WHERE listing_id IN (${placeholders})`, listingIds);
    await query(`DELETE FROM inquiries WHERE listing_id IN (${placeholders})`, listingIds);
    await query(`DELETE FROM listings WHERE user_id = ?`, [targetId]);
  }

  await query("DELETE FROM user_roles WHERE user_id = ?", [targetId]);
  await query("DELETE FROM users WHERE id = ?", [targetId]);

  return user;
}

export async function listActivityLogs() {
  const logs = await query<ActivityLog[]>("SELECT * FROM activity_logs ORDER BY id DESC");
  return Promise.all(
    logs.map(async (log) => {
      const operator = log.user_id ? await findUserById(log.user_id) : null;
      return {
        ...log,
        operator_name: operator ? operator.name : "System / Visitor",
      };
    })
  );
}

export async function countUsers(): Promise<number> {
  const rows = await query<{ count: number }[]>("SELECT COUNT(*) as count FROM users");
  return rows[0].count;
}

export async function countListings(): Promise<number> {
  const rows = await query<{ count: number }[]>("SELECT COUNT(*) as count FROM listings");
  return rows[0].count;
}
