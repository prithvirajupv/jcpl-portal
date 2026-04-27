import { getStore } from "@netlify/blobs";

const SITE_ID = "eadc5ac3-f726-4952-b387-4aee5a4bd418";
const TOKEN = process.env.NETLIFY_TOKEN || process.env.NETLIFY_AUTH_TOKEN || "nfp_sLFJSWSnjLcsFNqK21eb58FPz4ZU3Bghe508";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

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

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function tok() { return crypto.randomUUID().replace(/-/g,"")+Date.now().toString(36); }
function res(data, s=200) { return new Response(JSON.stringify(data),{status:s,headers:CORS}); }
function S(name) { return getStore({ name, siteID: SITE_ID, token: TOKEN }); }

async function getUsers() {
  const s=S("jcpl-users"), u=await s.get("all",{type:"json"});
  if(!u) {
    const init=await Promise.all(DEFAULT_USERS.map(async d=>({...d,Password:undefined,PasswordHash:await sha256(d.Password)})));
    await s.setJSON("all",init); return init;
  }
  return u;
}

async function login(p) {
  const email=(p.get("email")||"").toLowerCase().trim(), pwd=p.get("password")||"";
  const users=await getUsers(), user=users.find(u=>u.Email.toLowerCase()===email);
  if(!user) return {ok:false,error:"User not found"};
  if(await sha256(pwd)!==user.PasswordHash) return {ok:false,error:"Incorrect password"};
  if(user.Active!=="YES") return {ok:false,error:"Account inactive"};
  const token=tok();
  await S("jcpl-sessions").setJSON(token,{token,userID:user.UserID,name:user.Name,email:user.Email,role:user.Role,department:user.Department,expires:Date.now()+8*3600000});
  return {ok:true,token,name:user.Name,role:user.Role,email:user.Email,userID:user.UserID,approvalRules:APPROVAL_RULES};
}

async function validateSession(token) {
  if(!token) return null;
  const s=await S("jcpl-sessions").get(token,{type:"json"});
  if(!s||s.expires<Date.now()) { if(s) await S("jcpl-sessions").delete(token); return null; }
  return s;
}

async function submitForm(p,session) {
  const id="REC-"+p.get("formCode")+"-"+Math.random().toString(36).slice(2,10).toUpperCase();
  let data={}; try{data=JSON.parse(p.get("data")||"{}");}catch(e){}
  const title=p.get("formName")||p.get("formCode");
  const rec={id,FormCode:p.get("formCode"),Title:title,Status:"Pending",SubmittedBy:session.name,SubmittedByID:session.userID,SubmittedByRole:session.role,SubmittedAt:new Date().toISOString(),Data:data,Approvals:[],CurrentStep:1};
  await S("jcpl-forms").setJSON(id,rec);
  const idx=S("jcpl-index"), index=await idx.get("records",{type:"json"})||[];
  index.unshift({id,FormCode:rec.FormCode,Title:rec.Title,Status:rec.Status,SubmittedBy:rec.SubmittedBy,SubmittedAt:rec.SubmittedAt,CurrentStep:1});
  await idx.setJSON("records",index);
  return {ok:true,id,recordId:id};
}

async function approveStep(p,session) {
  const recordId=p.get("recordId"),stepNum=parseInt(p.get("step")||"0"),decision=p.get("decision")||"Approved",remarks=p.get("remarks")||"";
  const s=S("jcpl-forms"), rec=await s.get(recordId,{type:"json"});
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
  await s.setJSON(recordId,rec);
  const idx=S("jcpl-index"), index=await idx.get("records",{type:"json"})||[];
  const i=index.findIndex(r=>r.id===recordId);
  if(i>=0){index[i].Status=rec.Status;index[i].CurrentStep=rec.CurrentStep;await idx.setJSON("records",index);}
  return {ok:true,status:rec.Status,currentStep:rec.CurrentStep};
}

async function getRecords(p,session) {
  let records=await S("jcpl-index").get("records",{type:"json"})||[];
  if(!DIRECTOR_ROLES.includes(session.role)) {
    records=records.filter(r=>{
      const rules=APPROVAL_RULES[r.FormCode]||{};
      return Object.values(rules).some(roles=>roles.includes(session.role))||r.SubmittedByID===session.userID;
    });
  }
  const fc=p.get("formCode"); if(fc) records=records.filter(r=>r.FormCode===fc);
  return {ok:true,records,total:records.length};
}

async function getDashboard(session) {
  const all=await S("jcpl-index").get("records",{type:"json"})||[];
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

async function listUsers(session) {
  return {ok:true,users:(await getUsers()).map(u=>({...u,PasswordHash:undefined}))};
}

async function getAuditLog(session) {
  if(!DIRECTOR_ROLES.includes(session.role)) return {ok:false,error:"Directors only"};
  return {ok:true,logs:await S("jcpl-audit").get("logs",{type:"json"})||[]};
}

async function changePassword(p,session) {
  const s=S("jcpl-users"), users=await s.get("all",{type:"json"});
  const i=users.findIndex(u=>u.UserID===session.userID);
  if(i<0) return {ok:false,error:"User not found"};
  if(await sha256(p.get("oldPassword")||"")!==users[i].PasswordHash) return {ok:false,error:"Current password incorrect"};
  users[i].PasswordHash=await sha256(p.get("newPassword")||"");
  await s.setJSON("all",users); return {ok:true};
}

export default async (req) => {
  if(req.method==="OPTIONS") return new Response("",{status:200,headers:CORS});
  try {
    const p=new URL(req.url).searchParams;
    const action=p.get("action")||"", token=p.get("token")||"";
    let result;

    if(action==="ping") {
      result={ok:true,message:"Connected - Netlify Blobs",storage:"Netlify"};
    } else if(action==="debug") {
      const records=await S("jcpl-index").get("records",{type:"json"});
      const users=await getUsers();
      result={ok:true,recordCount:records?records.length:0,usersCount:users.length};
    } else if(action==="login") {
      result=await login(p);
    } else if(action==="logout") {
      await S("jcpl-sessions").delete(token); result={ok:true};
    } else {
      const session=await validateSession(token);
      if(!session) return res({ok:false,error:"Session expired. Please log in again."});
      if(action==="submitForm") result=await submitForm(p,session);
      else if(action==="approveStep") result=await approveStep(p,session);
      else if(action==="getRecords") result=await getRecords(p,session);
      else if(action==="getDashboard") result=await getDashboard(session);
      else if(action==="listUsers") result=await listUsers(session);
      else if(action==="getAuditLog") result=await getAuditLog(session);
      else if(action==="changePassword") result=await changePassword(p,session);
      else if(action==="whoami") result={ok:true,user:session};
      else result={ok:false,error:"Unknown action: "+action};
    }
    return res(result);
  } catch(err) {
    return res({ok:false,error:err.message},500);
  }
};
