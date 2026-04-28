// JCPL Procurement Portal Backend
// Storage: GitHub API (JSON files in repo)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// GitHub storage config
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_REPO = "prithvirajupv/jcpl-portal";
const GH_BRANCH = "main";
const DATA_PATH = "data"; // folder in repo for data files

const APPROVAL_RULES = {
  "FIN-01": { 1:["Indenter","Purchase Exec","Director"], 2:["Director","Purchase Manager","Finance Head"], 3:["Stores"], 4:["Director"] },
  "FIN-02": { 1:["Purchase Manager","Purchase Exec","Director"], 2:["Purchase Manager","Director"], 3:["Director"] },
  "FIN-03": { 1:["Purchase Manager","Purchase Exec","Director"], 2:["Accounts","Finance Head","Director"], 3:["Director"] },
  "FIN-04": { 1:["Stores","Director"], 2:["QC Officer","Director"], 3:["Purchase Manager","Director"] },
  "FIN-05": { 1:["Accounts","Finance Head","Director"], 2:["Purchase Manager","Director"], 3:["Finance Head","Director"] },
  "FIN-06": { 1:["Director"] },
  "FIN-07": { 1:["Accounts","Finance Head","Director"], 2:["Finance Head","Director"], 3:["Finance Head","Director"] },
  "FIN-08": { 1:["Accounts","Finance Head","Director"], 2:["Finance Head","Director"] }
};

const DIRECTOR_ROLES = ["Director"];

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

// ── GitHub API helpers ─────────────────────────────────────────
async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`, {
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: "application/vnd.github.v3+json" }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET failed: ${r.status}`);
  const data = await r.json();
  return { content: JSON.parse(atob(data.content.replace(/\n/g,""))), sha: data.sha };
}

async function ghSet(path, content, sha, rawBase64, mimeType) {
  // If rawBase64 provided, use it directly; otherwise JSON encode content
  const fileContent = rawBase64 || btoa(JSON.stringify(content, null, 2));
  const body = { message: `Update ${path}`, content: fileContent, branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
    method: "PUT", headers: { Authorization: `token ${GH_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`GitHub PUT failed: ${r.status} ${e}`); }
  return await r.json();
}

async function readDB(name) {
  const result = await ghGet(`${DATA_PATH}/${name}.json`);
  return result ? result.content : null;
}

async function writeDB(name, content) {
  const existing = await ghGet(`${DATA_PATH}/${name}.json`);
  await ghSet(`${DATA_PATH}/${name}.json`, content, existing?.sha);
}

// ── Auth helpers ───────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function genToken() { return crypto.randomUUID().replace(/-/g,"")+Date.now().toString(36); }
function res(data, s=200) { return new Response(JSON.stringify(data),{status:s,headers:CORS}); }

// ── User management ────────────────────────────────────────────
async function getUsers() {
  let users = await readDB("users");
  if (!users) {
    users = await Promise.all(DEFAULT_USERS.map(async u => ({
      UserID:u.UserID, Name:u.Name, Email:u.Email,
      PasswordHash: await sha256(u.Password),
      Role:u.Role, Department:u.Department, Active:u.Active
    })));
    await writeDB("users", users);
  }
  return users;
}

// ── Session management (in-memory + GitHub for persistence) ───
const SESSIONS = {};

async function login(p) {
  const email=(p.get("email")||"").toLowerCase().trim(), pwd=p.get("password")||"";
  const users=await getUsers(), user=users.find(u=>u.Email.toLowerCase()===email);
  if(!user) return {ok:false,error:"User not found"};
  if(await sha256(pwd)!==user.PasswordHash) return {ok:false,error:"Incorrect password"};
  if(user.Active!=="YES") return {ok:false,error:"Account inactive"};
  const token=genToken();
  const session={token,userID:user.UserID,name:user.Name,email:user.Email,role:user.Role,department:user.Department,expires:Date.now()+8*3600000};
  SESSIONS[token]=session;
  // Also save to GitHub for cross-instance persistence
  try {
    let sessions=await readDB("sessions")||{};
    sessions[token]=session;
    // Clean expired
    Object.keys(sessions).forEach(k=>{ if(sessions[k].expires<Date.now()) delete sessions[k]; });
    await writeDB("sessions", sessions);
  } catch(e) { console.warn("Session save failed:", e.message); }
  return {ok:true,token,name:user.Name,role:user.Role,email:user.Email,userID:user.UserID,approvalRules:APPROVAL_RULES};
}

async function validateSession(token) {
  if(!token) return null;
  // Check memory first
  if(SESSIONS[token] && SESSIONS[token].expires>Date.now()) return SESSIONS[token];
  // Fall back to GitHub
  try {
    const sessions=await readDB("sessions")||{};
    const session=sessions[token];
    if(!session||session.expires<Date.now()) return null;
    SESSIONS[token]=session; // cache in memory
    return session;
  } catch(e) { return null; }
}

// ── Form operations ────────────────────────────────────────────
async function submitForm(p, session) {
  const id="REC-"+p.get("formCode")+"-"+Math.random().toString(36).slice(2,10).toUpperCase();
  let data={}; try{data=JSON.parse(p.get("data")||"{}");}catch(e){}
  const title=p.get("formName")||p.get("formCode");
  const rec={id,FormCode:p.get("formCode"),Title:title,Status:"Pending",SubmittedBy:session.name,SubmittedByID:session.userID,SubmittedByRole:session.role,SubmittedAt:new Date().toISOString(),Data:data,Approvals:[],CurrentStep:1};
  
  // Save full record
  await writeDB(`records/${id}`, rec);
  
  // Update index
  let index=await readDB("index")||[];
  index.unshift({id,FormCode:rec.FormCode,Title:rec.Title,Status:rec.Status,SubmittedBy:rec.SubmittedBy,SubmittedAt:rec.SubmittedAt,CurrentStep:1});
  await writeDB("index", index);
  
  return {ok:true,id,recordId:id,message:"Saved to GitHub"};
}

async function getRecords(p, session) {
  let records=await readDB("index")||[];
  if(!DIRECTOR_ROLES.includes(session.role)) {
    records=records.filter(r=>{
      const rules=APPROVAL_RULES[r.FormCode]||{};
      return Object.values(rules).some(roles=>roles.includes(session.role))||r.SubmittedByID===session.userID;
    });
  }
  const fc=p.get("formCode"); if(fc) records=records.filter(r=>r.FormCode===fc);
  return {ok:true,records,total:records.length};
}

async function getRecord(p, session) {
  const recordId = p.get("recordId");
  if(!recordId) return {ok:false,error:"recordId required"};
  const rec = await readDB(`records/${recordId}`);
  if(!rec) return {ok:false,error:"Record not found"};
  return {ok:true,record:rec};
}

async function getDashboard(session) {
  const all=await readDB("index")||[];
  const myPending=all.filter(r=>{
    if(r.Status!=="Pending"&&r.Status!=="In Progress") return false;
    return (APPROVAL_RULES[r.FormCode]?.[r.CurrentStep||1]||[]).includes(session.role);
  });
  const visible=DIRECTOR_ROLES.includes(session.role)?all:all.filter(r=>{
    const rules=APPROVAL_RULES[r.FormCode]||{};
    return Object.values(rules).some(roles=>roles.includes(session.role))||r.SubmittedByID===session.userID;
  });
  return {ok:true,total:visible.length,pending:visible.filter(r=>r.Status==="Pending"||r.Status==="In Progress").length,approved:visible.filter(r=>r.Status==="Approved").length,rejected:visible.filter(r=>r.Status==="Rejected"||r.Status==="On Hold").length,myPending:myPending.length,myPendingRecords:myPending.slice(0,10),approvalRules:APPROVAL_RULES};
}

async function approveStep(p, session) {
  const recordId=p.get("recordId"),stepNum=parseInt(p.get("step")||"0"),decision=p.get("decision")||"Approved",remarks=p.get("remarks")||"";
  let rec=await readDB(`records/${recordId}`);
  if(!rec) return {ok:false,error:"Record not found"};
  const allowed=APPROVAL_RULES[rec.FormCode]?.[stepNum];
  if(!allowed) return {ok:false,error:"Invalid step"};
  if(!allowed.includes(session.role)) return {ok:false,error:`Access denied. Step ${stepNum} requires: ${allowed.join(", ")}. Your role: ${session.role}`};
  if(rec.Approvals?.find(a=>a.step===stepNum)) return {ok:false,error:`Step ${stepNum} already approved`};
  rec.Approvals=[...rec.Approvals||[],{step:stepNum,approvedBy:session.name,approvedByID:session.userID,role:session.role,decision,remarks,timestamp:new Date().toISOString()}];
  rec.CurrentStep=stepNum+1;
  if(decision==="Rejected") rec.Status="Rejected";
  else if(decision==="Hold") rec.Status="On Hold";
  else { const t=Object.keys(APPROVAL_RULES[rec.FormCode]||{}).length; rec.Status=stepNum>=t?"Approved":"In Progress"; }
  await writeDB(`records/${recordId}`, rec);
  let index=await readDB("index")||[];
  const i=index.findIndex(r=>r.id===recordId);
  if(i>=0){index[i].Status=rec.Status;index[i].CurrentStep=rec.CurrentStep;await writeDB("index",index);}
  return {ok:true,status:rec.Status,currentStep:rec.CurrentStep};
}

async function listUsers(session) {
  return {ok:true,users:(await getUsers()).map(u=>({...u,PasswordHash:undefined}))};
}

async function changePassword(p, session) {
  const users=await getUsers();
  const i=users.findIndex(u=>u.UserID===session.userID);
  if(i<0) return {ok:false,error:"User not found"};
  if(await sha256(p.get("oldPassword")||"")!==users[i].PasswordHash) return {ok:false,error:"Current password incorrect"};
  users[i].PasswordHash=await sha256(p.get("newPassword")||"");
  await writeDB("users",users);
  return {ok:true};
}

// ── Main handler ───────────────────────────────────────────────

async function uploadAttachment(p, session) {
  const recordId = p.get("recordId");
  let uploads = [];
  try { uploads = JSON.parse(p.get("uploads") || "[]"); } catch(e) {}
  if(!uploads.length) return { ok: false, error: "No files provided" };

  // Get existing record
  const rec = await readDB(`records/${recordId}`);
  if(!rec) return { ok: false, error: "Record not found" };

  if(!rec.Attachments) rec.Attachments = [];
  const newAttachments = [];

  for(const file of uploads) {
    try {
      // Upload to GitHub as binary in data/attachments/ folder
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `data/attachments/${recordId}/${Date.now()}_${safeName}`;
      const url = `https://github.com/prithvirajupv/jcpl-portal/blob/main/${path}`;
      const rawUrl = `https://raw.githubusercontent.com/prithvirajupv/jcpl-portal/main/${path}`;

      // Save file to GitHub
      await ghSet(path, null, null, file.data, file.type);

      const att = {
        name: file.name,
        path,
        url: `https://github.com/prithvirajupv/jcpl-portal/blob/main/${path}`,
        rawUrl,
        type: file.type,
        size: file.size,
        uploadedBy: session.name,
        uploadedAt: new Date().toISOString()
      };
      rec.Attachments.push(att);
      newAttachments.push(att);
    } catch(e) {
      console.warn("Failed to upload", file.name, e.message);
    }
  }

  await writeDB(`records/${recordId}`, rec);

  // Update index
  const index = await readDB("index") || [];
  const i = index.findIndex(r => r.id === recordId);
  if(i >= 0) { index[i].attachmentCount = rec.Attachments.length; await writeDB("index", index); }

  return { ok: true, attachments: rec.Attachments, uploaded: newAttachments.length };
}

export default async (req) => {
  if(req.method==="OPTIONS") return new Response("",{status:200,headers:CORS});
  try {
    const p=new URL(req.url).searchParams;
    const action=p.get("action")||"", token=p.get("token")||"";
    let result;

    if(action==="ping") {
      result={ok:true,message:"Connected - GitHub Storage",storage:"GitHub"};
    } else if(action==="debug") {
      const index=await readDB("index");
      const users=await getUsers();
      result={ok:true,recordCount:index?index.length:0,usersCount:users.length};
    } else if(action==="login") {
      result=await login(p);
    } else if(action==="logout") {
      delete SESSIONS[token]; result={ok:true};
    } else {
      const session=await validateSession(token);
      if(!session) return res({ok:false,error:"Session expired. Please log in again."});
      if(action==="submitForm") result=await submitForm(p,session);
      else if(action==="approveStep") result=await approveStep(p,session);
      else if(action==="getRecords") result=await getRecords(p,session);
      else if(action==="getRecord") result=await getRecord(p,session);
      else if(action==="uploadAttachment") result=await uploadAttachment(p,session);
      else if(action==="getDashboard") result=await getDashboard(session);
      else if(action==="listUsers") result=await listUsers(session);
      else if(action==="changePassword") result=await changePassword(p,session);
      else if(action==="whoami") result={ok:true,user:session};
      else result={ok:false,error:"Unknown action: "+action};
    }
    return res(result);
  } catch(err) {
    return res({ok:false,error:err.message},500);
  }
};
