const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function hashPassword(password) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  return crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
}

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
    const initialized = await Promise.all(DEFAULT_USERS.map(async u => {
      const h = await hashPassword(u.Password);
      return { UserID:u.UserID, Name:u.Name, Email:u.Email, PasswordHash:h, Role:u.Role, Department:u.Department, Active:u.Active };
    }));
    await store.setJSON("all", initialized);
    users = initialized;
  }
  return users;
}

async function login(params) {
  const email = (params.email || "").toLowerCase().trim();
  const password = params.password || "";
  const users = await getUsers();
  const user = users.find(u => u.Email.toLowerCase() === email);
  if (!user) return { ok: false, error: "User not found" };
  const hash = await hashPassword(password);
  if (hash !== user.PasswordHash) return { ok: false, error: "Incorrect password" };
  if (user.Active !== "YES") return { ok: false, error: "Account inactive" };
  const token = generateToken();
  const sessionStore = getStore({ name: "jcpl-sessions", consistency: "strong" });
  await sessionStore.setJSON(token, {
    token, userID: user.UserID, name: user.Name,
    email: user.Email, role: user.Role, department: user.Department,
    expires: Date.now() + 8 * 60 * 60 * 1000
  });
  return { ok: true, token, name: user.Name, role: user.Role, email: user.Email, userID: user.UserID };
}

async function validateSession(token) {
  if (!token) return null;
  const store = getStore({ name: "jcpl-sessions", consistency: "strong" });
  const session = await store.get(token, { type: "json" });
  if (!session) return null;
  if (session.expires < Date.now()) { await store.delete(token); return null; }
  return session;
}

async function submitForm(params, session) {
  const store = getStore({ name: "jcpl-forms", consistency: "strong" });
  const id = "REC-" + Date.now() + "-" + Math.random().toString(36).slice(2,6).toUpperCase();
  let data = {};
  try { data = JSON.parse(params.data || "{}"); } catch(e) {}
  const record = {
    id, FormCode: params.formCode, Title: params.title,
    Status: "Pending", SubmittedBy: session.name,
    SubmittedByID: session.userID, SubmittedAt: new Date().toISOString(),
    Data: data, Approvals: []
  };
  await store.setJSON(id, record);
  const indexStore = getStore({ name: "jcpl-index", consistency: "strong" });
  const index = await indexStore.get("records", { type: "json" }) || [];
  index.unshift({ id, FormCode: record.FormCode, Title: record.Title, Status: record.Status, SubmittedBy: record.SubmittedBy, SubmittedAt: record.SubmittedAt });
  await indexStore.setJSON("records", index);
  await addAudit({ action: "Form Submitted", formCode: params.formCode, recordId: id, userName: session.name, details: params.title });
  return { ok: true, id };
}

async function getRecords(params, session) {
  const indexStore = getStore({ name: "jcpl-index", consistency: "strong" });
  let records = await indexStore.get("records", { type: "json" }) || [];
  if (params.formCode) records = records.filter(r => r.FormCode === params.formCode);
  return { ok: true, records };
}

async function getDashboard(session) {
  const indexStore = getStore({ name: "jcpl-index", consistency: "strong" });
  const records = await indexStore.get("records", { type: "json" }) || [];
  return {
    ok: true,
    total: records.length,
    pending: records.filter(r => r.Status === "Pending").length,
    approved: records.filter(r => r.Status === "Approved").length,
    rejected: records.filter(r => r.Status === "Rejected").length,
    myPending: records.filter(r => r.Status === "Pending").length
  };
}

async function listUsers(session) {
  const users = await getUsers();
  return { ok: true, users: users.map(u => ({ ...u, PasswordHash: undefined })) };
}

async function addAudit(entry) {
  const store = getStore({ name: "jcpl-audit", consistency: "strong" });
  const logs = await store.get("logs", { type: "json" }) || [];
  logs.unshift({ ...entry, ts: new Date().toISOString() });
  if (logs.length > 500) logs.splice(500);
  await store.setJSON("logs", logs);
}

async function getAuditLog(session) {
  const store = getStore({ name: "jcpl-audit", consistency: "strong" });
  const logs = await store.get("logs", { type: "json" }) || [];
  return { ok: true, logs };
}

exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  try {
    const params = event.queryStringParameters || {};
    const action = params.action || "";
    const token = params.token || "";
    let result;

    if (action === "ping") {
      result = { ok: true, message: "Connected - Netlify Blobs", storage: "Netlify" };
    } else if (action === "login") {
      result = await login(params);
    } else if (action === "logout") {
      const store = getStore({ name: "jcpl-sessions", consistency: "strong" });
      await store.delete(token);
      result = { ok: true };
    } else {
      const session = await validateSession(token);
      if (!session) {
        result = { ok: false, error: "Session expired. Please log in again." };
      } else {
        if (action === "submitForm") result = await submitForm(params, session);
        else if (action === "getRecords") result = await getRecords(params, session);
        else if (action === "getDashboard") result = await getDashboard(session);
        else if (action === "listUsers") result = await listUsers(session);
        else if (action === "getAuditLog") result = await getAuditLog(session);
        else if (action === "whoami") result = { ok: true, user: session };
        else result = { ok: false, error: "Unknown action: " + action };
      }
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
