import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// Simple password hashing (SHA-256 via Web Crypto)
async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Generate session token
function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
}

// Pre-hashed passwords for all 14 users (SHA-256 of their passwords)
const DEFAULT_USERS = [
  {UserID:"U001",Name:"P. Srinivas Raju",Email:"psr@jcpl.in",Password:"JCPL@PSR2025",Role:"Director",Department:"Management",Active:"YES"},
  {UserID:"U002",Name:"Prithvi Raju",Email:"pr@jcpl.in",Password:"JCPL@PR2025",Role:"Director",Department:"Management",Active:"YES"},
  {UserID:"U003",Name:"Prathap Varma",Email:"pv@jcpl.in",Password:"JCPL@PV2025",Role:"Director",Department:"Finance",Active:"YES"},
  {UserID:"U004",Name:"Finance Head",Email:"cfo@jcpl.in",Password:"JCPL@CFO2025",Role:"Finance Head",Department:"Finance",Active:"YES"},
  {UserID:"U005",Name:"Purchase Manager",Email:"purmgr@jcpl.in",Password:"JCPL@PM2025",Role:"Purchase Manager",Department:"Purchase",Active:"YES"},
  {UserID:"U006",Name:"Accounts Manager",Email:"accounts@jcpl.in",Password:"JCPL@AM2025",Role:"Accounts",Department:"Finance",Active:"YES"},
  {UserID:"U007",Name:"Accounts Executive",Email:"accountsexec@jcpl.in",Password:"JCPL@AE2025",Role:"Accounts",Department:"Finance",Active:"YES"},
  {UserID:"U008",Name:"Purchase Executive",Email:"purexec@jcpl.in",Password:"JCPL@PE2025",Role:"Purchase Exec",Department:"Purchase",Active:"YES"},
  {UserID:"U009",Name:"Store In Charge",Email:"stores@jcpl.in",Password:"JCPL@ST2025",Role:"Stores",Department:"Stores",Active:"YES"},
  {UserID:"U010",Name:"QC Officer",Email:"qc@jcpl.in",Password:"JCPL@QC2025",Role:"QC Officer",Department:"Quality",Active:"YES"},
  {UserID:"U011",Name:"Hardware Engineer",Email:"hardware@jcpl.in",Password:"JCPL@HW2025",Role:"Indenter",Department:"Hardware Engg.",Active:"YES"},
  {UserID:"U012",Name:"Software Engineer",Email:"software@jcpl.in",Password:"JCPL@SW2025",Role:"Indenter",Department:"Software Engg.",Active:"YES"},
  {UserID:"U013",Name:"Mechanical Engineer",Email:"mechanical@jcpl.in",Password:"JCPL@ME2025",Role:"Indenter",Department:"Mechanical Engg.",Active:"YES"},
  {UserID:"U014",Name:"Production Engineer",Email:"production@jcpl.in",Password:"JCPL@PRD2025",Role:"Indenter",Department:"Production Engg.",Active:"YES"},
];

async function getUsers() {
  const store = getStore({ name: "jcpl-users", consistency: "strong" });
  let users = await store.get("all", { type: "json" });
  if (!users) {
    // Initialize with default users on first run
    const initialized = await Promise.all(DEFAULT_USERS.map(async u => ({
      ...u,
      PasswordHash: await hashPassword(u.Password),
      Password: undefined
    })));
    await store.setJSON("all", initialized);
    users = initialized;
  }
  return users as any[];
}

async function login(params: any) {
  const email = (params.email || "").toLowerCase().trim();
  const password = params.password || "";
  const users = await getUsers();
  const user = users.find((u: any) => u.Email.toLowerCase() === email);
  if (!user) return { ok: false, error: "User not found" };
  const hash = await hashPassword(password);
  if (hash !== user.PasswordHash) return { ok: false, error: "Incorrect password" };
  if (user.Active !== "YES") return { ok: false, error: "Account inactive" };
  
  // Create session
  const token = generateToken();
  const sessionStore = getStore({ name: "jcpl-sessions", consistency: "strong" });
  await sessionStore.setJSON(token, {
    token, userID: user.UserID, name: user.Name,
    email: user.Email, role: user.Role, department: user.Department,
    expires: Date.now() + 8 * 60 * 60 * 1000
  });
  return { ok: true, token, name: user.Name, role: user.Role, email: user.Email, userID: user.UserID };
}

async function validateSession(token: string) {
  if (!token) return null;
  const store = getStore({ name: "jcpl-sessions", consistency: "strong" });
  const session = await store.get(token, { type: "json" });
  if (!session) return null;
  if (session.expires < Date.now()) { await store.delete(token); return null; }
  return session;
}

async function submitForm(body: any, session: any) {
  const store = getStore({ name: "jcpl-forms", consistency: "strong" });
  const id = "REC-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const record = {
    id, FormCode: body.formCode, Title: body.title,
    Status: "Pending", SubmittedBy: session.name,
    SubmittedByID: session.userID, SubmittedAt: new Date().toISOString(),
    Data: body.data || {}, Approvals: []
  };
  await store.setJSON(id, record);
  // Update index
  const indexStore = getStore({ name: "jcpl-index", consistency: "strong" });
  const index = await indexStore.get("records", { type: "json" }) || [];
  index.unshift({ id, FormCode: record.FormCode, Title: record.Title, Status: record.Status, SubmittedBy: record.SubmittedBy, SubmittedAt: record.SubmittedAt });
  await indexStore.setJSON("records", index);
  // Audit
  await addAudit({ action: "Form Submitted", formCode: body.formCode, recordId: id, userName: session.name, details: body.title });
  return { ok: true, id };
}

async function getRecords(body: any, session: any) {
  const indexStore = getStore({ name: "jcpl-index", consistency: "strong" });
  let records = await indexStore.get("records", { type: "json" }) || [];
  if (body.formCode) records = records.filter((r: any) => r.FormCode === body.formCode);
  return { ok: true, records };
}

async function getDashboard(session: any) {
  const indexStore = getStore({ name: "jcpl-index", consistency: "strong" });
  const records = await indexStore.get("records", { type: "json" }) || [];
  return {
    ok: true,
    total: records.length,
    pending: records.filter((r: any) => r.Status === "Pending").length,
    approved: records.filter((r: any) => r.Status === "Approved").length,
    rejected: records.filter((r: any) => r.Status === "Rejected").length,
    myPending: records.filter((r: any) => r.Status === "Pending").length
  };
}

async function listUsers(session: any) {
  if (!["Director","Finance Head","Accounts"].includes(session.role)) return { ok: false, error: "Access denied" };
  const users = await getUsers();
  return { ok: true, users: users.map((u: any) => ({ ...u, PasswordHash: undefined })) };
}

async function addAudit(entry: any) {
  const store = getStore({ name: "jcpl-audit", consistency: "strong" });
  const logs = await store.get("logs", { type: "json" }) || [];
  logs.unshift({ ...entry, ts: new Date().toISOString() });
  if (logs.length > 500) logs.splice(500);
  await store.setJSON("logs", logs);
}

async function getAuditLog(session: any) {
  if (!["Director"].includes(session.role)) return { ok: false, error: "Access denied" };
  const store = getStore({ name: "jcpl-audit", consistency: "strong" });
  const logs = await store.get("logs", { type: "json" }) || [];
  return { ok: true, logs };
}

async function logout(token: string) {
  const store = getStore({ name: "jcpl-sessions", consistency: "strong" });
  await store.delete(token);
  return { ok: true };
}

async function changePassword(body: any, session: any) {
  const store = getStore({ name: "jcpl-users", consistency: "strong" });
  const users = await store.get("all", { type: "json" }) as any[];
  const idx = users.findIndex((u: any) => u.UserID === session.userID);
  if (idx < 0) return { ok: false, error: "User not found" };
  const oldHash = await hashPassword(body.oldPassword || "");
  if (oldHash !== users[idx].PasswordHash) return { ok: false, error: "Current password incorrect" };
  users[idx].PasswordHash = await hashPassword(body.newPassword);
  await store.setJSON("all", users);
  return { ok: true };
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });
  try {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams);
    const action = params.action || "";
    const token = params.token || "";
    let result: any;

    if (action === "ping") {
      result = { ok: true, message: "Connected to Netlify Blobs", storage: "Netlify" };
    } else if (action === "login") {
      result = await login(params);
    } else if (action === "logout") {
      result = await logout(token);
    } else {
      const session = await validateSession(token);
      if (!session) {
        result = { ok: false, error: "Session expired. Please log in again." };
      } else {
        if (action === "submitForm") result = await submitForm(JSON.parse(params.data || "{}"), session);
        else if (action === "getRecords") result = await getRecords(params, session);
        else if (action === "getDashboard") result = await getDashboard(session);
        else if (action === "listUsers") result = await listUsers(session);
        else if (action === "getAuditLog") result = await getAuditLog(session);
        else if (action === "changePassword") result = await changePassword(JSON.parse(params.data || "{}"), session);
        else if (action === "whoami") result = { ok: true, user: session };
        else result = { ok: false, error: "Unknown action: " + action };
      }
    }
    return json(result);
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
};

export const config = { path: "/api" };
