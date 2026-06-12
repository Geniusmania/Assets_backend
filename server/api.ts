import { Router } from "express";
import bcrypt from "bcryptjs";
import { authenticateToken, authorizeRoles, optionalAuthToken, generateToken, AuthenticatedRequest } from "./auth";
import { generateListingDescription } from "./ai";
import * as repo from "./repository";

const router = Router();

function parseRouteId(param: string | string[]): number {
  const value = Array.isArray(param) ? param[0] : param;
  return parseInt(value, 10);
}

// -----------------------------------------------------
// 1. PUBLIC & AUTH ENDPOINTS
// -----------------------------------------------------

router.post("/auth/register", async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: "Missing required fields (name, email, password)." });
    return;
  }

  const existingUser = await repo.findUserByEmail(email);
  if (existingUser) {
    res.status(400).json({ error: "Email address is already registered." });
    return;
  }

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);

  const newUser = await repo.createUser({
    name,
    email,
    password_hash,
    phone,
  });

  await repo.assignUserRole(newUser.id, "User");
  const assignedRoles = ["User"];

  await repo.insertActivityLog(
    newUser.id,
    "User Registration",
    `Registered account for ${name} (${email}) as User`
  );

  const token = generateToken(newUser, assignedRoles);

  res.status(201).json({
    message: "User registered successfully.",
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      profile_image: newUser.profile_image,
      roles: assignedRoles,
    },
  });
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const user = await repo.findUserByEmail(email);
  if (!user) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  if (user.status === "suspended") {
    res.status(403).json({ error: "Your account is suspended. Please contact platform support." });
    return;
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const rolesList = await repo.getUserRoles(user.id);
  const token = generateToken(user, rolesList);

  await repo.insertActivityLog(user.id, "User Login", "Logged in successfully from client");

  res.json({
    message: "Login successful.",
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profile_image: user.profile_image,
      roles: rolesList,
    },
  });
});

router.get("/auth/profile", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const user = await repo.findUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User profile not found." });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    profile_image: user.profile_image,
    roles: await repo.getUserRoles(user.id),
    created_at: user.created_at,
  });
});

router.put("/auth/profile", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { name, phone, profile_image, password } = req.body;
  const updates: {
    name?: string;
    phone?: string;
    profile_image?: string;
    password_hash?: string;
  } = {};

  if (name) updates.name = name;
  if (phone !== undefined) updates.phone = phone;
  if (profile_image) updates.profile_image = profile_image;
  if (password) {
    const salt = bcrypt.genSaltSync(10);
    updates.password_hash = bcrypt.hashSync(password, salt);
  }

  const user = await repo.updateUserProfile(req.user!.id, updates);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  await repo.insertActivityLog(user.id, "Profile Update", "Updated personal contact & password profile info");

  res.json({
    message: "Profile updated successfully.",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profile_image: user.profile_image,
      roles: req.user?.roles,
    },
  });
});

// -----------------------------------------------------
// 2. LISTING ENDPOINTS
// -----------------------------------------------------

router.get("/listings", async (req, res) => {
  const { category_id, search, location, min_price, max_price, sort, featured } = req.query;

  const listings = await repo.listPublicListings({
    category_id: category_id ? parseInt(category_id as string) : undefined,
    search: search as string | undefined,
    location: location as string | undefined,
    min_price: min_price ? parseFloat(min_price as string) : undefined,
    max_price: max_price ? parseFloat(max_price as string) : undefined,
    featured: featured === "true",
    sort: sort as string | undefined,
  });

  res.json(listings);
});

router.get("/listings/my", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  const listings = await repo.listMyListings(req.user!.id, isSuperAdmin);
  res.json(listings);
});

router.get("/listings/:id", optionalAuthToken, async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const listing = await repo.findListingById(id);

  if (!listing) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const isOwner = req.user?.id === listing.user_id;
  const isSuperAdmin = req.user?.roles.includes("Super Admin");
  const isPubliclyVisible = listing.approval_status === "approved" && listing.status === "available";

  if (!isPubliclyVisible && !isOwner && !isSuperAdmin) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const detail = await repo.getListingDetail(id, isPubliclyVisible);
  res.json(detail);
});

router.post("/listings", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const { title, description, category_id, price, location, address, city, region, country, images, featured } = req.body;

  if (!title || !category_id || !price || !location) {
    res.status(400).json({ error: "Missing required listing fields." });
    return;
  }

  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;

  const newListing = await repo.createListing(
    {
      user_id: req.user!.id,
      title,
      description: description || "",
      category_id: parseInt(category_id),
      price: parseFloat(price),
      location,
      address: address || "",
      city: city || "",
      region: region || "",
      country: country || "",
      status: "available",
      approval_status: isSuperAdmin ? "approved" : "pending",
      featured: isSuperAdmin ? !!featured : false,
    },
    Array.isArray(images) ? images : []
  );

  await repo.insertActivityLog(
    req.user!.id,
    "Create Listing",
    `Created asset listing ID ${newListing.id}: '${title}'`
  );

  res.status(201).json({
    message: isSuperAdmin
      ? "Listing created and approved successfully."
      : "Listing submitted. Subject to Super Admin approval.",
    listing: newListing,
  });
});

router.put("/listings/:id", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const listingId = parseRouteId(req.params.id);
  const { title, description, category_id, price, location, address, city, region, country, images, status, featured } = req.body;

  const existingListing = await repo.findListingById(listingId);
  if (!existingListing) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  if (!isSuperAdmin && existingListing.user_id !== req.user?.id) {
    res.status(403).json({ error: "Access denied. You do not own this listing." });
    return;
  }

  const updates: Partial<typeof existingListing> = {};
  if (title) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (category_id) updates.category_id = parseInt(category_id);
  if (price !== undefined) updates.price = parseFloat(price);
  if (location) updates.location = location;
  if (address !== undefined) updates.address = address;
  if (city !== undefined) updates.city = city;
  if (region !== undefined) updates.region = region;
  if (country !== undefined) updates.country = country;
  if (status) updates.status = status;
  if (isSuperAdmin && featured !== undefined) updates.featured = !!featured;

  const updated = await repo.updateListing(
    listingId,
    updates,
    Array.isArray(images) ? images : undefined
  );

  await repo.insertActivityLog(
    req.user!.id,
    "Edit Listing",
    `Modified listing info for ID ${listingId}: '${updated?.title}'`
  );

  res.json({ message: "Listing updated successfully.", listing: updated });
});

router.delete("/listings/:id", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const listing = await repo.findListingById(id);

  if (!listing) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  if (!isSuperAdmin && listing.user_id !== req.user?.id) {
    res.status(403).json({ error: "Access denied. You do not own this listing." });
    return;
  }

  await repo.deleteListing(id);

  await repo.insertActivityLog(
    req.user!.id,
    "Delete Listing",
    `Deleted listing ID ${id}: '${listing.title}' along with associated images.`
  );

  res.json({ message: "Listing deleted successfully." });
});

router.patch("/listings/:id/status", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const { status } = req.body;

  if (!["available", "sold", "unavailable"].includes(status)) {
    res.status(400).json({ error: "Invalid status value." });
    return;
  }

  const listing = await repo.findListingById(id);
  if (!listing) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  if (!isSuperAdmin && listing.user_id !== req.user?.id) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const updated = await repo.updateListing(id, { status });

  await repo.insertActivityLog(
    req.user!.id,
    "Update Asset Availability",
    `Changed listing '${updated?.title}' (ID: ${id}) availability status to '${status}'`
  );

  res.json({ message: `Listing marked as ${status}.`, listing: updated });
});

router.patch("/listings/:id/featured", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const { featured } = req.body;

  const listing = await repo.findListingById(id);
  if (!listing) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const updated = await repo.updateListing(id, { featured: !!featured });

  await repo.insertActivityLog(
    req.user!.id,
    "Toggle Featured Status",
    `Super Admin set featured='${!!featured}' for listing '${updated?.title}' (ID: ${id})`
  );

  res.json({ message: "Listing featured status changed successfully.", listing: updated });
});

router.patch("/listings/:id/approve", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "Status must be approved or rejected." });
    return;
  }

  const listing = await repo.findListingById(id);
  if (!listing) {
    res.status(404).json({ error: "Listing not found." });
    return;
  }

  const updated = await repo.updateListing(id, {
    approval_status: status as "approved" | "rejected",
  });

  await repo.insertActivityLog(
    req.user!.id,
    status === "approved" ? "Approve Listing" : "Reject Listing",
    `Super Admin moderated & set approval status to '${status}' for listing '${updated?.title}' (ID: ${id})`
  );

  res.json({ message: `Listing is now ${status}.`, listing: updated });
});

// -----------------------------------------------------
// 3. CATEGORY ENDPOINTS
// -----------------------------------------------------

router.get("/categories", async (_req, res) => {
  const categories = await repo.listCategories();
  res.json(categories);
});

router.post("/categories", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const { name, description } = req.body;

  if (!name) {
    res.status(400).json({ error: "Category name is required." });
    return;
  }

  const newCat = await repo.createCategory(name, description || "");

  await repo.insertActivityLog(
    req.user!.id,
    "Create Category",
    `Super Admin added asset category '${name}' (ID: ${newCat.id})`
  );

  res.status(201).json({ message: "Category created successfully.", category: newCat });
});

router.put("/categories/:id", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const { name, description } = req.body;

  const updated = await repo.updateCategory(id, name, description);
  if (!updated) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  await repo.insertActivityLog(req.user!.id, "Edit Category", `Super Admin updated category ID ${id} information`);

  res.json({ message: "Category updated successfully.", category: updated });
});

router.delete("/categories/:id", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);

  const exists = await repo.findCategoryById(id);
  if (!exists) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const deleted = await repo.deleteCategory(id);
  if (!deleted) {
    res.status(400).json({
      error: "Cannot delete category because active listings are assigned to it. Re-assign them first.",
    });
    return;
  }

  await repo.insertActivityLog(req.user!.id, "Delete Category", `Super Admin deleted category ID ${id}`);

  res.json({ message: "Category deleted successfully." });
});

// -----------------------------------------------------
// 4. INQUIRY ENDPOINTS
// -----------------------------------------------------

router.post("/inquiries", optionalAuthToken, async (req: AuthenticatedRequest, res) => {
  const { listing_id, sender_name, sender_email, sender_phone, message } = req.body;

  if (!listing_id || !sender_name || !sender_email || !message) {
    res.status(400).json({ error: "Missing required inquiry fields." });
    return;
  }

  const listing = await repo.findListingById(parseInt(listing_id));
  if (!listing) {
    res.status(404).json({ error: "Associated listing asset not found." });
    return;
  }

  if (listing.approval_status !== "approved" || listing.status !== "available") {
    res.status(400).json({ error: "Inquiries can only be sent for approved, available listings." });
    return;
  }

  const resolvedName = sender_name || req.user?.name || "";
  const resolvedEmail = sender_email || req.user?.email || "";

  const newInq = await repo.createInquiry({
    listing_id: parseInt(listing_id),
    sender_name: resolvedName,
    sender_email: resolvedEmail,
    sender_phone: sender_phone || "",
    message,
    status: "new",
  });

  const actorLabel = req.user ? `User ${req.user.name}` : `Visitor ${resolvedName}`;
  await repo.insertActivityLog(
    req.user?.id ?? null,
    "Submit Inquiry",
    `${actorLabel} submitted contact inquiry for Listing ID ${listing_id}`
  );

  res.status(201).json({
    message: "Inquiry sent successfully to the listing owner.",
    inquiry: newInq,
  });
});

router.get("/inquiries/my", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  const inquiries = await repo.listInquiriesForOwner(req.user!.id, isSuperAdmin);
  res.json(inquiries);
});

router.post("/inquiries/:id/reply", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const { response_text } = req.body;

  if (!response_text || response_text.trim() === "") {
    res.status(400).json({ error: "Reply response text is required." });
    return;
  }

  const inquiry = await repo.findInquiryById(id);
  if (!inquiry) {
    res.status(404).json({ error: "Inquiry not found." });
    return;
  }

  const listingObj = await repo.findListingById(inquiry.listing_id);
  if (!listingObj) {
    res.status(404).json({ error: "Associated listing for feedback no longer active." });
    return;
  }

  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  if (!isSuperAdmin && listingObj.user_id !== req.user?.id) {
    res.status(403).json({ error: "Access denied. You do not own this listing asset." });
    return;
  }

  const updated = await repo.updateInquiry(id, { status: "replied", response_text });

  await repo.insertActivityLog(
    req.user!.id,
    "Respond to Inquiry",
    `Seller replied to message from ${inquiry.sender_name} about listing '${listingObj.title}'`
  );

  res.json({ message: "Reply submitted and logged successfully.", inquiry: updated });
});

router.patch("/inquiries/:id/status", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const id = parseRouteId(req.params.id);
  const { status } = req.body;

  if (!["new", "ignored"].includes(status)) {
    res.status(400).json({ error: "Status must be 'new' or 'ignored'." });
    return;
  }

  const inquiry = await repo.findInquiryById(id);
  if (!inquiry) {
    res.status(404).json({ error: "Inquiry not found." });
    return;
  }

  const listingObj = await repo.findListingById(inquiry.listing_id);
  if (!listingObj) {
    res.status(404).json({ error: "Associated listing no longer exists." });
    return;
  }

  const isSuperAdmin = req.user?.roles.includes("Super Admin") ?? false;
  if (!isSuperAdmin && listingObj.user_id !== req.user?.id) {
    res.status(403).json({ error: "Access denied. You do not own this listing asset." });
    return;
  }

  const updated = await repo.updateInquiry(id, { status });

  await repo.insertActivityLog(
    req.user!.id,
    "Update Inquiry Status",
    `Set inquiry from ${inquiry.sender_name} to '${status}'`
  );

  res.json({ message: `Inquiry marked as ${status}.`, inquiry: updated });
});

// -----------------------------------------------------
// 5. CONTACT & AI ENDPOINTS
// -----------------------------------------------------

router.post("/contact", async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    res.status(400).json({ error: "Name, email, and message are required." });
    return;
  }

  await repo.createContactMessage({
    sender_name: name,
    sender_email: email,
    subject: subject || "",
    message,
    status: "new",
  });

  await repo.insertActivityLog(
    null,
    "Contact Form",
    `${name} (${email}) submitted a support message: ${subject || "No subject"}`
  );

  res.status(201).json({ message: "Your message has been received. We will respond shortly." });
});

router.get("/contact", authenticateToken, authorizeRoles("Super Admin"), async (_req, res) => {
  const messages = await repo.listContactMessages();
  res.json(messages);
});

router.post("/ai/generate-description", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const { title, category, price, location, city, region } = req.body;

  if (!title) {
    res.status(400).json({ error: "Title is required to generate a description." });
    return;
  }

  try {
    const description = await generateListingDescription({ title, category, price, location, city, region });
    await repo.insertActivityLog(req.user!.id, "AI Description", `Generated listing description for '${title}'`);
    res.json({ description });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "AI description generation failed.";
    res.status(503).json({ error: message });
  }
});

// -----------------------------------------------------
// 6. DASHBOARD & ANALYTICS ENDPOINTS
// -----------------------------------------------------

router.get("/analytics/dashboard", authenticateToken, authorizeRoles("Super Admin"), async (_req, res) => {
  const analytics = await repo.getDashboardAnalytics();
  res.json(analytics);
});

router.get("/analytics/my-stats", authenticateToken, authorizeRoles("Admin", "Super Admin"), async (req: AuthenticatedRequest, res) => {
  const stats = await repo.getSellerStats(req.user!.id);
  res.json(stats);
});

// -----------------------------------------------------
// 7. SUPER ADMIN USER MANAGEMENT
// -----------------------------------------------------

router.get("/admin/users", authenticateToken, authorizeRoles("Super Admin"), async (_req, res) => {
  const users = await repo.listUsersWithRoles();
  res.json(users);
});

router.patch("/admin/users/:id/status", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const targetId = parseRouteId(req.params.id);
  const { status } = req.body;

  if (targetId === req.user!.id) {
    res.status(400).json({ error: "You cannot suspend or modify your own active Super Admin session." });
    return;
  }

  if (!["active", "suspended"].includes(status)) {
    res.status(400).json({ error: "Invalid status value. Use active or suspended." });
    return;
  }

  const user = await repo.findUserById(targetId);
  if (!user) {
    res.status(404).json({ error: "User registration not found." });
    return;
  }

  await repo.updateUserStatus(targetId, status as "active" | "suspended");

  await repo.insertActivityLog(
    req.user!.id,
    status === "suspended" ? "Suspend User" : "Activate User",
    `${status === "suspended" ? "Suspended" : "Activated"} login security for user ${user.name} (${user.email})`
  );

  res.json({ message: `User account is now marked as ${status}.` });
});

router.patch("/admin/users/:id/role", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const targetId = parseRouteId(req.params.id);
  const { role } = req.body;

  if (!["Admin", "User"].includes(role)) {
    res.status(400).json({ error: "Role must be 'Admin' or 'User'." });
    return;
  }

  if (targetId === req.user!.id) {
    res.status(400).json({ error: "You cannot change your own role." });
    return;
  }

  const user = await repo.findUserById(targetId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const currentRoles = await repo.getUserRoles(targetId);
  if (currentRoles.includes("Super Admin")) {
    res.status(400).json({ error: "Super Admin roles cannot be changed via this endpoint." });
    return;
  }

  const changed = await repo.changeUserRole(targetId, role);
  if (!changed) {
    res.status(400).json({ error: "Failed to change user role." });
    return;
  }

  await repo.insertActivityLog(
    req.user!.id,
    "Change User Role",
    `Changed role for ${user.name} (${user.email}) to '${role}'`
  );

  res.json({ message: `User role updated to ${role}.` });
});

router.delete("/admin/users/:id", authenticateToken, authorizeRoles("Super Admin"), async (req: AuthenticatedRequest, res) => {
  const targetId = parseRouteId(req.params.id);

  if (targetId === req.user!.id) {
    res.status(400).json({ error: "You cannot delete your own Super Admin registration." });
    return;
  }

  const user = await repo.deleteUser(targetId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  await repo.insertActivityLog(
    req.user!.id,
    "Delete User Registration",
    `Super Admin deleted user ${user.name} (${user.email}) along with all cascade assets matching user ID.`
  );

  res.json({ message: "User account and all matching asset listings deleted successfully." });
});

// -----------------------------------------------------
// 8. DIRECT SECURITY ACTIVITY LOGS
// -----------------------------------------------------

router.get("/admin/logs", authenticateToken, authorizeRoles("Super Admin"), async (_req, res) => {
  const logs = await repo.listActivityLogs();
  res.json(logs);
});

export default router;
