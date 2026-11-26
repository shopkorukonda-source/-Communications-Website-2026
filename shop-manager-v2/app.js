import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { renderOperations } from "./operations.js";

const SUPABASE_URL = "https://fvjtbefsuzhrjimpmdop.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ntLQ0BhfjcRnkxjt6xmRAQ_tBl5LtGD";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const loginScreen = $("login-screen");
const appScreen = $("app-screen");
let categories = [];
let services = [];
let selectedCategory = null;
let currentProfile = null;
let currentEmployee = null;
let walletOptions = [];
let editingServiceId = null;

function setMessage(message, isError = true) {
  $("login-message").textContent = message;
  $("login-message").style.color = isError ? "#b33b34" : "#27865e";
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  appScreen.classList.add("hidden");
}

async function showApp(user) {
  const { data: profile, error } = await supabase.from("profiles")
    .select("display_name,role,is_active").eq("id", user.id).single();
  if (error || !profile || !profile.is_active) {
    await supabase.auth.signOut();
    showLogin();
    setMessage("Your account profile is not active. Please contact the administrator.");
    return;
  }
  currentProfile = profile;
  currentEmployee = null;
  if (profile.role === "employee") {
    const {data: employeeLink,error:employeeError} = await supabase.from("employees").select("id,full_name,employee_code,is_active").eq("profile_id",user.id).eq("is_active",true).maybeSingle();
    if(employeeError || !employeeLink || !employeeLink.is_active){
      await supabase.auth.signOut(); showLogin();
      setMessage("Employee access is inactive or not linked. Please contact Admin.");
      return;
    }
    currentEmployee = employeeLink;
  }
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  appScreen.classList.toggle("admin-mode", profile.role === "admin");
  appScreen.classList.toggle("employee-mode", profile.role === "employee");
  $("user-name").textContent = profile.display_name || user.email;
  $("user-role").textContent = profile.role;
  $("avatar").textContent = (profile.display_name || user.email || "S").slice(0,1).toUpperCase();
  const hour = new Date().getHours();
  $("greeting").textContent = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  $("today-date").textContent = new Intl.DateTimeFormat("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(new Date());
  if (profile.role === "employee") {
    $("page-title").textContent = "My Dashboard";
    document.querySelector(".welcome-row h1").innerHTML = "Your work, <span>in control.</span>";
    document.querySelector(".welcome-row p").textContent = "Your daily work and shift activity.";
    $("today-bill-caption").textContent = currentEmployee ? "Bills you recorded today" : "Ask Admin to link your employee record";
  } else {
    document.querySelector(".welcome-row h1").innerHTML = "Your shop, <span>in control.</span>";
    document.querySelector(".welcome-row p").textContent = "Here’s a clear view of today’s operations.";
    document.querySelector(".stat-card:nth-child(2) .stat-top span:first-child").textContent = "Cash position";
    document.querySelector(".stat-card:nth-child(2) small").textContent = "Shop Cash wallet balance";
  }
  await loadCatalog();
  if (profile.role === "employee") { await loadEmployeeAnnouncements(); await loadEmployeeTaskReminders(); }
}

async function loadCatalog() {
  const grid = $("category-grid");
  grid.innerHTML = '<div class="loading-card">Loading categories…</div>';
  const serviceFields=currentProfile?.role==="admin"?"id,category_id,name,code,description,billing_type,processing_cost_type,profit_mode,billing_config,processing_cost_config,profit_config,sort_order,is_active":"id,category_id,name,code,description,billing_type,processing_cost_type,profit_mode,billing_config,processing_cost_config,sort_order,is_active";
  const [{data: cats, error: catError},{data: rows,error: serviceError}] = await Promise.all([
    supabase.from("service_categories").select("id,name,slug,sort_order,is_active").order("sort_order"),
    supabase.from("services").select(serviceFields).order("sort_order")
  ]);
  if (catError || serviceError) {
    grid.innerHTML = '<div class="empty-state">Unable to load the service catalogue. Please refresh or contact the administrator.</div>';
    console.error(catError || serviceError);
    return;
  }
  categories = cats || [];
  services = (rows || []).filter(s => currentProfile?.role === "admin" || s.is_active);
  {
    if(currentProfile?.role==="admin"){
      const {data: wallets, error: walletError} = await supabase.from("wallets").select("id,name,wallet_type,provider,current_balance,is_active,low_balance_threshold,low_balance_alert_enabled").eq("is_active",true).order("name");
      if (walletError) console.warn("Wallet list unavailable", walletError);
      walletOptions = wallets || [];
    }else if(currentEmployee?.id){
      const [{data: assigned, error: assignedError},{data: profitRules,error:profitRulesError}]=await Promise.all([
        supabase.from("employee_wallet_access").select("wallet_id").eq("employee_id",currentEmployee.id).eq("is_active",true),
        supabase.from("service_profit_wallet_rules").select("wallet_id")
      ]);
      if(assignedError)console.warn("Assigned wallet list unavailable",assignedError);
      if(profitRulesError)console.warn("Service profit wallet list unavailable",profitRulesError);
      const ids=[...new Set([...(assigned||[]).map(x=>x.wallet_id),...(profitRules||[]).map(x=>x.wallet_id)])];
      if(ids.length){
        const {data: wallets,error:walletError}=await supabase.from("wallets").select("id,name,wallet_type,provider,current_balance,is_active,low_balance_threshold,low_balance_alert_enabled").eq("is_active",true).in("id",ids).order("name");
        if(walletError)console.warn("Assigned and service profit wallet details unavailable",walletError);
        walletOptions=wallets||[];
      }else walletOptions=[];
    }else walletOptions=[];
  }
  $("service-count").textContent = services.length;
  renderCategories();
  renderEmployeeWallets();
  renderWalletAlerts();
  await loadOverviewStats();
}

const icons = ["▣","◉","↗","▤","◇","✦"];

function renderEmployeeWallets(){
 const host=$("employee-wallets");if(!host)return;
 const isAdmin=currentProfile?.role==="admin";
 const heading=isAdmin?"ALL SHOP WALLETS":"MY ASSIGNED WALLETS";
 const title=isAdmin?"Wallet balances":"Assigned wallet balances";
 if(!walletOptions.length){host.innerHTML='<div class="announcement-heading"><div><div class="eyebrow">'+heading+'</div><h3>'+(isAdmin?"No active wallets created":"No wallets assigned")+'</h3></div></div>';return;}
 host.innerHTML='<div class="announcement-heading"><div><div class="eyebrow">'+heading+'</div><h3>'+title+'</h3></div></div><div class="employee-wallet-grid">'+walletOptions.filter(w=>w.is_active!==false).map(w=>'<article class="employee-wallet-card"><div><strong>'+escapeHtml(w.name)+'</strong><small>'+escapeHtml(w.provider||w.wallet_type||"Wallet")+'</small></div><b>'+money(w.current_balance)+'</b></article>').join("")+'</div>';
}
function renderWalletAlerts(){
 const host=$("wallet-alerts");if(!host)return;
 const low=walletOptions.filter(w=>w.low_balance_alert_enabled!==false&&Number(w.current_balance||0)<=Number(w.low_balance_threshold||0));
 if(!low.length){host.innerHTML="";return;}
 host.innerHTML='<div class="announcement-heading"><div><div class="eyebrow">WALLET BALANCE ALERT</div><h3>Recharge Required</h3></div></div><div class="announcement-list">'+low.map(w=>'<article class="announcement-card wallet-low-balance"><div class="announcement-icon">₹</div><div class="announcement-copy"><strong>'+escapeHtml(w.name)+'</strong><p>Current balance '+money(w.current_balance)+' · Minimum '+money(w.low_balance_threshold||0)+'</p></div></article>').join("")+'</div>';
}
async function loadOverviewStats(){
  const start=new Date();start.setHours(0,0,0,0);
  if(currentProfile?.role==="employee"){
    if(!currentEmployee){
      $("today-bill-count").textContent="—";
      $("cash-position").textContent="—";
      $("cash-position-caption").textContent="Employee login is not linked yet";
      $("today-bill-caption").textContent="Ask Admin to link your employee record";
      return;
    }
    const [{data:ownBills,count,error},sessionResult]=await Promise.all([
      supabase.from("billing_transactions").select("id",{count:"exact",head:true}).eq("employee_id",currentEmployee.id).gte("created_at",start.toISOString()),
      supabase.from("drawer_sessions").select("id,status,opened_at").eq("employee_id",currentEmployee.id).eq("status","open").order("opened_at",{ascending:false}).limit(1)
    ]);
    $("today-bill-count").textContent=error?"—":String(count||0);
    $("today-bill-caption").textContent=error?"Unable to load your bills":"Bills you recorded today";
    $("cash-position").textContent="—";
    $("cash-position-caption").textContent="";
    return;
  }
  const [{count,error},sessionResult]=await Promise.all([
    supabase.from("billing_transactions").select("id",{count:"exact",head:true}).gte("created_at",start.toISOString()),
    supabase.from("drawer_sessions").select("id,opening_cash,opened_at,drawer_id").eq("status","open").order("opened_at",{ascending:false}).limit(1)
  ]);
  $("today-bill-count").textContent=error?"—":String(count||0);
  $("today-bill-caption").textContent=error?"Unable to load today's bills":"Bills recorded today";
  const cash=walletOptions.filter(w=>w.wallet_type==="cash").reduce((sum,w)=>sum+Number(w.current_balance||0),0);
  $("cash-position").textContent=""+money(cash);
  const open=sessionResult.data?.[0];
  $("cash-position-caption").textContent=open?"Live Shop Cash · Shift open":"Shop Cash wallet balance";
}

function renderCategories() {
  $("category-grid").innerHTML = categories.map((cat,i) => `
    <button class="category-card ${selectedCategory===cat.id?"selected":""}" data-category="${cat.id}">
      <span class="category-icon">${icons[i] || "✦"}</span>
      <span><strong>${escapeHtml(cat.name)}</strong><small>${services.filter(s=>s.category_id===cat.id).length} services</small></span>
    </button>`).join("");
  document.querySelectorAll("[data-category]").forEach(btn => btn.addEventListener("click",()=>{
    selectedCategory = btn.dataset.category;
    renderCategories();
    renderServices();
  }));
}

function renderServices() {
  const query = $("service-search").value.trim().toLowerCase();
  const list = services.filter(s => s.category_id===selectedCategory && s.name.toLowerCase().includes(query));
  $("service-subtitle").textContent = categories.find(c=>c.id===selectedCategory)?.name || "Available services";
  $("service-list").innerHTML = list.length ? list.map(s=>`
    <div class="service-item"><strong>${escapeHtml(s.name)}</strong><span>›</span></div>`).join("") : '<div class="empty-state">No services in this category yet.</div>';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("login-btn");
  button.disabled = true;
  button.textContent = "Signing in…";
  setMessage("", false);
  try {
    const identity=$("email").value.trim();
    const digits=identity.replace(/\D/g,"");
    const isMobile=/^\d{10}$/.test(digits) && !identity.includes("@");
    const credentials=isMobile
      ? {email:"slv.employee."+digits+"@example.com",password:$("password").value}
      : {email:identity,password:$("password").value};
    const authResult = await Promise.race([
      supabase.auth.signInWithPassword(credentials),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("Login request timed out. Check internet connection and try again.")),18000))
    ]);
    if (authResult.error) {
      setMessage(authResult.error.message);
      return;
    }
    button.textContent = "Loading workspace…";
    await Promise.race([
      showApp(authResult.data.user),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("Login succeeded, but the workspace is taking too long to load. Refresh and try again.")),18000))
    ]);
  } catch (err) {
    console.error("SLV login error:",err);
    setMessage(err?.message || "Unable to sign in. Please check your connection and try again.");
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span>→</span>';
  }
});
$("toggle-password").addEventListener("click",()=>{
  const input = $("password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  $("toggle-password").textContent = visible ? "Hide" : "Show";
});

function openPasswordDialog(recovery=false){
  $("password-dialog").classList.remove("hidden");
  $("password-form").dataset.recovery=recovery?"true":"false";
  $("password-dialog-title").textContent=recovery?"Set a new password":"Change password";
  $("password-dialog-copy").textContent=recovery?"Choose a new password for your SLV account.":"Verify your current password, then choose a new secure password.";
  $("current-password-label").classList.toggle("hidden",recovery);
  $("current-password").required=!recovery;
  $("password-form").reset();
  $("password-dialog-message").textContent="";
  $("password-dialog-close").classList.toggle("hidden",recovery);
}
function closePasswordDialog(){
  $("password-dialog").classList.add("hidden");
  $("password-form").reset();
}
$("forgot-password-btn").addEventListener("click",async()=>{
  const email=$("email").value.trim();
  if(/^\d{10}$/.test(email)){setMessage("Employee password reset is managed by Admin. Please contact your administrator.");return;}
  if(!email||!email.includes("@")){setMessage("Enter your Admin email address first.");$("email").focus();return;}
  const btn=$("forgot-password-btn");btn.disabled=true;btn.textContent="Sending recovery email…";
  const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:"https://slv-shop-manager-v2.onrender.com/"});
  if(error)setMessage(error.message);
  else setMessage("Password reset link sent. Check your inbox and Spam folder.",false);
  btn.disabled=false;btn.textContent="Forgot password?";
});
$("change-password-btn").addEventListener("click",()=>openPasswordDialog(false));
$("password-dialog-close").addEventListener("click",closePasswordDialog);
$("password-dialog").addEventListener("click",e=>{if(e.target===$("password-dialog")&&!$("password-form").dataset.recovery)closePasswordDialog();});
$("password-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const recovery=$("password-form").dataset.recovery==="true";
  const current=$("current-password").value;
  const next=$("new-password").value;
  const confirm=$("confirm-password").value;
  const msg=$("password-dialog-message"),btn=$("password-save-btn");
  if(next.length<8){msg.textContent="Use at least 8 characters for the new password.";return;}
  if(next!==confirm){msg.textContent="New password and confirmation do not match.";return;}
  if(!recovery&&next===current){msg.textContent="New password must be different from current password.";return;}
  btn.disabled=true;btn.textContent="Updating…";msg.textContent="";
  try{
    if(!recovery){
      const {data:{user},error:authError}=await supabase.auth.getUser();
      if(authError||!user?.email)throw authError||new Error("Unable to verify the signed-in account.");
      const {error:verifyError}=await supabase.auth.signInWithPassword({email:user.email,password:current});
      if(verifyError)throw new Error("Current password is incorrect. Please try again.");
    }
    const {error}=await supabase.auth.updateUser({password:next});
    if(error)throw error;
    msg.style.color="#27865e";
    msg.textContent="Password updated successfully.";
    $("password-form").reset();
    if(recovery){
      setTimeout(async()=>{await supabase.auth.signOut();closePasswordDialog();showLogin();setMessage("Password updated. Sign in with your new password.",false);},1100);
    }else{
      setTimeout(closePasswordDialog,1100);
    }
  }catch(error){msg.style.color="#b33b34";msg.textContent=error.message||"Unable to update password.";}
  finally{btn.disabled=false;btn.textContent="Update password";}
});
supabase.auth.onAuthStateChange((event,session)=>{
  if(event==="PASSWORD_RECOVERY"&&session?.user){
    loginScreen.classList.remove("hidden");appScreen.classList.add("hidden");
    openPasswordDialog(true);
  }
});

$("signout-btn").addEventListener("click",async()=>{await supabase.auth.signOut();showLogin();});
$("service-search").addEventListener("input",renderServices);
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",async()=>{
  if(currentProfile?.role!=="admin" && (btn.classList.contains("admin-only") || btn.dataset.view==="services")) return;
  const view = btn.dataset.view;
  const shiftRequiredViews=["billing","quicklinks","panforms","ucl","expenses"];
  if(currentProfile?.role==="employee" && currentEmployee && shiftRequiredViews.includes(view)){
    const [active,lunch]=await Promise.all([
      supabase.from("drawer_sessions").select("id").eq("employee_id",currentEmployee.id).eq("status","open").order("opened_at",{ascending:false}).limit(1).maybeSingle(),
      supabase.from("attendance").select("lunch_start,lunch_end").eq("employee_id",currentEmployee.id).eq("work_date",new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"})).maybeSingle()
    ]);
    if(active.error || !active.data){
      alert("Please Start Shift at the shop first. Billing and work actions are locked until your shift is open.");
      const drawerButton=document.querySelector('.nav-item[data-view="drawers"]');
      if(drawerButton)drawerButton.click();
      return;
    }
    if(lunch.error || (lunch.data?.lunch_start && !lunch.data?.lunch_end)){
      alert("Lunch break is active. Please tap End Lunch before starting billing or other work.");
      const attendanceButton=document.querySelector('.nav-item[data-view="attendance"]');
      if(attendanceButton)attendanceButton.click();
      return;
    }
  }
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item===btn));
  $("overview-view").classList.toggle("hidden",view!=="overview");
  $("other-view").classList.toggle("hidden",view==="overview");
  if(view==="overview"){ $("page-title").textContent=currentProfile?.role==="employee"?"My Dashboard":"Overview"; return; }
  $("page-title").textContent=btn.textContent.trim();
  if(view==="billing") {
    await renderQuickBilling();
  } else if(view==="quicklinks") {
    await renderQuickLinks();
  } else if(view==="panforms") {
    renderPanApplications();
  } else if(view==="announcements") {
    await renderAnnouncementManager();
  } else if(view==="services") {
    await renderServiceManager();
  } else if(view==="wallets") {
    await renderWalletManager();
  } else if(view==="reports") {
    await renderReports();
  } else if(view==="employees") {
    await renderEmployeeManager();
  } else if(["drawers","attendance","leave","payroll","incentives","ucl","walletaccess","tasks","inventory","expenses","settlement"].includes(view)) {
    await renderOperations(view,{supabase,host:$("other-view"),profile:currentProfile,$});
  } else {
    $("other-view").innerHTML='<div class="empty-panel"><div class="empty-icon">✦</div><h2 id="other-title"></h2><p>This module will be enabled after its complete workflow and safety checks are ready.</p></div>';
    $("other-title").textContent=btn.textContent.trim();
  }
}));


async function renderServiceManager() {
  const host = $("other-view");
  if (currentProfile?.role !== "admin") {
    host.innerHTML = '<div class="empty-panel"><div class="empty-icon">▦</div><h2>Services</h2><p>Available services are shown on the Overview page.</p></div>';
    return;
  }
  const activeCount = services.filter(s=>s.is_active).length;
  host.innerHTML = `
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Services Management</h2><p>Manage service catalogue, pricing modes and wallet routing.</p></div><button class="primary-btn admin-add-btn" id="new-service-btn">+ Add Service</button></div>
    <div class="admin-module-stats"><div><small>Total services</small><strong>${services.length}</strong></div><div><small>Active services</small><strong>${activeCount}</strong></div><div><small>Wallets available</small><strong>${walletOptions.filter(w=>w.is_active).length}</strong></div></div>
    <div id="service-editor" class="admin-editor hidden"></div>
    <div class="admin-table-wrap"><div class="admin-table-head"><h3>Service catalogue</h3><input id="admin-service-search" class="search-input" placeholder="Search services"></div><div id="admin-service-rows"></div></div>`;
  $("new-service-btn").addEventListener("click",()=>openServiceEditor());
  $("admin-service-search").addEventListener("input",renderAdminServiceRows);
  renderAdminServiceRows();
}
function renderAdminServiceRows(){
  const q=$("admin-service-search")?.value.trim().toLowerCase()||"";
  const rows=services.filter(s=>s.name.toLowerCase().includes(q)||(s.code||"").toLowerCase().includes(q));
  $("admin-service-rows").innerHTML=rows.length?rows.map(s=>`
    <div class="admin-service-row"><div class="admin-service-main"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(categories.find(c=>c.id===s.category_id)?.name||"Uncategorised")} · ${escapeHtml(s.code||"No code")}</small></div><div class="admin-service-meta"><span>${s.billing_type} / ${s.processing_cost_type} / ${s.profit_mode}</span><span class="status-pill ${s.is_active?"is-active":"is-inactive"}">${s.is_active?"Active":"Inactive"}</span></div><div class="admin-service-actions"><button data-edit-service="${s.id}">Edit</button><button data-toggle-service="${s.id}">${s.is_active?"Deactivate":"Activate"}</button></div></div>`).join(""):'<div class="empty-state">No services found. Add your first service.</div>';
  document.querySelectorAll("[data-edit-service]").forEach(b=>b.addEventListener("click",()=>openServiceEditor(b.dataset.editService)));
  document.querySelectorAll("[data-toggle-service]").forEach(b=>b.addEventListener("click",()=>toggleService(b.dataset.toggleService)));
}
async function openServiceEditor(id=null){
  editingServiceId=id;
  const s=id?services.find(x=>x.id===id):null;
  let selectedWalletRules=[],selectedProfitWallets=[];
  if(s){
    const [{data},{data:profitWallets}]=await Promise.all([
      supabase.from("service_wallet_rules").select("wallet_id,debit_config").eq("service_id",id).order("wallet_slot"),
      supabase.from("service_profit_wallet_rules").select("wallet_id").eq("service_id",id)
    ]);
    selectedWalletRules=data||[];selectedProfitWallets=(profitWallets||[]).map(x=>x.wallet_id);
  }
  const editor=$("service-editor");
  editor.classList.remove("hidden");
  editor.innerHTML=`
    <div class="admin-editor-head"><div><h3>${s?"Edit service":"Add service"}</h3><p>All pricing configurations are stored against this service.</p></div><button type="button" id="close-service-editor" class="text-btn">Close</button></div>
    <form id="service-form" class="service-form">
      <label>Category<select id="svc-category" required>${categories.map(c=>`<option value="${c.id}" ${s?.category_id===c.id?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
      <label>Service name<input id="svc-name" required maxlength="120" value="${escapeHtml(s?.name||"")}"></label>
      <label>Service code<input id="svc-code" maxlength="50" value="${escapeHtml(s?.code||"")}" placeholder="Optional unique code"></label>
      <label>Description<input id="svc-description" value="${escapeHtml(s?.description||"")}" placeholder="Optional description"></label>
      <div class="admin-form-grid">
        <label>Billing type<select id="svc-billing"><option value="fixed">Fixed price</option><option value="percentage">Percentage</option><option value="slabs">Slabs</option><option value="manual">Manual</option></select></label>
        <label>Processing cost type<select id="svc-cost"><option value="fixed">Fixed</option><option value="percentage">Percentage</option><option value="slabs">Slabs</option><option value="manual">Manual</option></select></label>
        <label>Profit mode<select id="svc-profit"><option value="manual">Manual</option><option value="slabs">Slabs</option><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select></label>
      </div>
      <div class="admin-form-grid">
        <label>Billing config (JSON)<textarea id="svc-billing-config" rows="4">${escapeHtml(JSON.stringify(s?.billing_config||{},null,2))}</textarea><small class="muted">Xerox / Printing: customer_charge is the fixed rate per paper/page. Optional quantity_slabs use [{"min_quantity":1,"max_quantity":50,"rate":2},{"min_quantity":51,"max_quantity":null,"rate":1.5}]. Employees cannot edit rates; only discounts are entered at billing.</small></label>
        <label>Processing cost config (JSON)<textarea id="svc-cost-config" rows="3">${escapeHtml(JSON.stringify(s?.processing_cost_config||{},null,2))}</textarea></label>
        <label>Profit config (JSON)<textarea id="svc-profit-config" rows="3">${escapeHtml(JSON.stringify(s?.profit_config||{},null,2))}</textarea></label>
      </div>
      <div class="wallet-map-box" id="printout-slab-editor" style="display:${s?.code==="PRINTOUT"?"block":"none"}">
        <strong>Printout quantity-wise customer rates</strong>
        <p>Set page ranges and rate per page. Leave the maximum blank for the last unlimited slab. Rate is applied to total pages (pages × sets).</p>
        <div id="printout-slab-rows">${(s?.billing_config?.quantity_slabs||[{min_quantity:1,max_quantity:null,rate:Number(s?.billing_config?.customer_charge||0)}]).map((x)=>'<div class="admin-form-grid printout-slab-row" style="align-items:end"><label>From pages<input data-slab-min type="number" min="1" step="1" value="'+Number(x.min_quantity??x.min??1)+'"></label><label>To pages (blank = unlimited)<input data-slab-max type="number" min="1" step="1" value="'+(x.max_quantity??x.max??"")+'"></label><label>Rate per page (₹)<input data-slab-rate type="number" min="0" step="0.01" value="'+Number(x.rate??x.customer_charge??0)+'"></label><button type="button" class="text-btn" data-remove-printout-slab>Remove</button></div>').join("")}</div>
        <button type="button" class="secondary-btn" id="add-printout-slab">+ Add rate slab</button>
      </div>
      <div class="wallet-map-box" id="credit-profit-wallet-box" style="display:${s?.code==="CREDIT_CARD_BANK"?"block":"none"}"><strong>Credit Card profit wallets</strong><p>Select all wallets employees may choose. Each bill's calculated profit is credited to the selected wallet.</p><div class="wallet-choice-grid">${walletOptions.map(w=>`<label class="wallet-choice"><input type="checkbox" data-profit-wallet-check value="${w.id}" ${selectedProfitWallets.includes(w.id)?"checked":""} ${w.is_active?"":"disabled"}><span>${escapeHtml(w.name)} <small>${escapeHtml(w.provider||w.wallet_type)}</small></span></label>`).join("")||'<small>No wallets created yet. Add wallets from Wallets section.</small>'}</div></div>
      <div class="wallet-map-box"><strong>Processing wallets</strong><p>Admin selects the wallet and debit formula for each service.</p><div class="wallet-choice-grid">${walletOptions.map(w=>{const rule=selectedWalletRules.find(x=>x.wallet_id===w.id),cfg=rule?.debit_config||{},mode=cfg.mode||(cfg.fixed_amount!=null?"fixed_amount":"processing_cost"),value=mode==="percentage"?(cfg.percentage??""):(cfg.fixed_amount??"");return `<label class="wallet-choice"><input type="checkbox" data-admin-wallet-check value="${w.id}" ${rule?"checked":""} ${w.is_active?"":"disabled"}><span>${escapeHtml(w.name)} <small>${escapeHtml(w.provider||w.wallet_type)}</small><select data-admin-wallet-mode="${w.id}" ${rule?"":"disabled"}><option value="processing_cost" ${mode==="processing_cost"?"selected":""}>Processing cost</option><option value="base_amount" ${mode==="base_amount"?"selected":""}>Bill amount</option><option value="base_plus_processing_cost" ${mode==="base_plus_processing_cost"?"selected":""}>Bill + processing cost</option><option value="fixed_amount" ${mode==="fixed_amount"?"selected":""}>Fixed amount</option><option value="percentage" ${mode==="percentage"?"selected":""}>Percentage of bill</option></select><input type="number" min="0" step="0.01" data-admin-wallet-value="${w.id}" value="${value}" placeholder="Value for fixed / percentage" ${rule&&["fixed_amount","percentage"].includes(mode)?"":"disabled"}></span></label>`;}).join("")||'<small>No wallets created yet. Add wallets from Wallets section.</small>'}</div></div>
      <label class="inline-check"><input id="svc-active" type="checkbox" ${s?.is_active===false?"":"checked"}> Service active</label>
      <div id="service-form-message" class="message"></div>
      <div class="admin-form-actions"><button type="button" class="text-btn" id="cancel-service">Cancel</button><button type="submit" class="primary-btn" id="save-service-btn">Save service</button></div>
    </form>`;
  $("svc-billing").value=s?.billing_type||"fixed";
  $("svc-cost").value=s?.processing_cost_type||"fixed";
  $("svc-profit").value=s?.profit_mode||"manual";
  const syncCreditProfitWalletBox=()=>{const box=$("credit-profit-wallet-box");if(box)box.style.display=$("svc-code").value.trim().toUpperCase()==="CREDIT_CARD_BANK"?"block":"none";};
  $("svc-code").addEventListener("input",syncCreditProfitWalletBox);syncCreditProfitWalletBox();
  const printoutSlabBox=$("printout-slab-editor"),printoutSlabRows=$("printout-slab-rows");
  const syncPrintoutSlabBox=()=>{if(printoutSlabBox)printoutSlabBox.style.display=$("svc-code").value.trim().toUpperCase()==="PRINTOUT"?"block":"none";};
  const addPrintoutSlab=(slab={min_quantity:1,max_quantity:"",rate:0})=>{
    const row=document.createElement("div");row.className="admin-form-grid printout-slab-row";row.style.alignItems="end";
    row.innerHTML='<label>From pages<input data-slab-min type="number" min="1" step="1" value="'+Number(slab.min_quantity??slab.min??1)+'"></label><label>To pages (blank = unlimited)<input data-slab-max type="number" min="1" step="1" value="'+(slab.max_quantity??slab.max??"")+'"></label><label>Rate per page (₹)<input data-slab-rate type="number" min="0" step="0.01" value="'+Number(slab.rate??slab.customer_charge??0)+'"></label><button type="button" class="text-btn" data-remove-printout-slab>Remove</button>';
    printoutSlabRows.appendChild(row);
  };
  $("svc-code").addEventListener("input",syncPrintoutSlabBox);
  $("add-printout-slab")?.addEventListener("click",()=>{const rows=[...printoutSlabRows.querySelectorAll(".printout-slab-row")],last=rows.at(-1),next=last?Number(last.querySelector("[data-slab-max]").value||last.querySelector("[data-slab-min]").value)+1:1;addPrintoutSlab({min_quantity:next,max_quantity:"",rate:0});});
  printoutSlabRows?.addEventListener("click",e=>{if(e.target.closest("[data-remove-printout-slab]")){const rows=printoutSlabRows.querySelectorAll(".printout-slab-row");if(rows.length>1)e.target.closest(".printout-slab-row").remove();}});

  const syncWalletRule=(walletId,checked)=>{const mode=editor.querySelector('[data-admin-wallet-mode="'+walletId+'"]'),value=editor.querySelector('[data-admin-wallet-value="'+walletId+'"]');if(mode)mode.disabled=!checked;if(value)value.disabled=!checked||!["fixed_amount","percentage"].includes(mode?.value);};
  editor.querySelectorAll("[data-admin-wallet-check]").forEach(ch=>ch.addEventListener("change",()=>syncWalletRule(ch.value,ch.checked)));
  editor.querySelectorAll("[data-admin-wallet-mode]").forEach(sel=>sel.addEventListener("change",()=>syncWalletRule(sel.dataset.adminWalletMode,editor.querySelector('[data-admin-wallet-check][value="'+sel.dataset.adminWalletMode+'"]')?.checked)));
  $("close-service-editor").addEventListener("click",()=>editor.classList.add("hidden"));
  $("cancel-service").addEventListener("click",()=>editor.classList.add("hidden"));
  $("service-form").addEventListener("submit",saveService);
  editor.scrollIntoView({behavior:"smooth",block:"start"});
}
async function saveService(event){
  event.preventDefault();
  const btn=$("save-service-btn"), msg=$("service-form-message");
  const parseConfig=id=>{const v=$(id).value.trim()||"{}";const parsed=JSON.parse(v);if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")throw new Error("Configuration must be a JSON object");return parsed;};
  let billingConfig,costConfig,profitConfig;
  try{billingConfig=parseConfig("svc-billing-config");costConfig=parseConfig("svc-cost-config");profitConfig=parseConfig("svc-profit-config");}
  catch(e){msg.textContent="Invalid JSON: "+e.message;return;}
  if($("svc-code").value.trim().toUpperCase()==="PRINTOUT"){
    const rows=[...document.querySelectorAll("#printout-slab-rows .printout-slab-row")];
    const slabs=rows.map(el=>({min_quantity:Number(el.querySelector("[data-slab-min]").value),max_quantity:el.querySelector("[data-slab-max]").value===""?null:Number(el.querySelector("[data-slab-max]").value),rate:Number(el.querySelector("[data-slab-rate]").value)}));
    if(!slabs.length||slabs.some(x=>!Number.isInteger(x.min_quantity)||x.min_quantity<1||x.rate<0||!Number.isFinite(x.rate)||(x.max_quantity!==null&&(!Number.isInteger(x.max_quantity)||x.max_quantity<x.min_quantity)))){msg.textContent="Enter valid printout slabs: positive page ranges and non-negative per-page rates.";return;}
    const sorted=[...slabs].sort((a,b)=>a.min_quantity-b.min_quantity);
    for(let i=1;i<sorted.length;i++){if(sorted[i-1].max_quantity===null||sorted[i].min_quantity<=sorted[i-1].max_quantity){msg.textContent="Printout slab ranges must not overlap.";return;}}
    billingConfig={...billingConfig,quantity_slabs:sorted};
  }
  const payload={category_id:$("svc-category").value,name:$("svc-name").value.trim(),code:$("svc-code").value.trim()||null,description:$("svc-description").value.trim()||null,billing_type:$("svc-billing").value,processing_cost_type:$("svc-cost").value,profit_mode:$("svc-profit").value,billing_config:billingConfig,processing_cost_config:costConfig,profit_config:profitConfig,is_active:$("svc-active").checked,updated_at:new Date().toISOString()};
  if(!payload.name){msg.textContent="Service name is required.";return;}
  btn.disabled=true;btn.textContent="Saving…";
  try{
    let saved;
    if(editingServiceId){const {data,error}=await supabase.from("services").update(payload).eq("id",editingServiceId).select("id").single();if(error)throw error;saved=data;}
    else{const {data,error}=await supabase.from("services").insert(payload).select("id").single();if(error)throw error;saved=data;}
    const chosen=[...document.querySelectorAll("[data-admin-wallet-check]:checked")].map((el,i)=>{const mode=document.querySelector('[data-admin-wallet-mode="'+el.value+'"]')?.value||"processing_cost",value=Number(document.querySelector('[data-admin-wallet-value="'+el.value+'"]')?.value||0),debit_config={mode};if(mode==="fixed_amount")debit_config.fixed_amount=value;if(mode==="percentage")debit_config.percentage=value;return {service_id:saved.id,wallet_id:el.value,wallet_slot:i+1,debit_order:i+1,debit_config,is_required:true};});
    if(chosen.some(x=>(x.debit_config.mode==="fixed_amount"||x.debit_config.mode==="percentage")&&(!(Number(x.debit_config.fixed_amount??x.debit_config.percentage)>0))))throw new Error("Enter a positive value for every fixed or percentage wallet rule.");
    if(payload.code==="CREDIT_CARD_BANK"&&!document.querySelectorAll("[data-profit-wallet-check]:checked").length)throw new Error("Assign at least one Credit Card profit wallet.");
    const profitWalletIds=[...document.querySelectorAll("[data-profit-wallet-check]:checked")].map(el=>el.value);
    const {error:profitDelError}=await supabase.from("service_profit_wallet_rules").delete().eq("service_id",saved.id);
    if(profitDelError)throw profitDelError;
    if(profitWalletIds.length){const {error:profitRuleError}=await supabase.from("service_profit_wallet_rules").insert(profitWalletIds.map(wallet_id=>({service_id:saved.id,wallet_id})));if(profitRuleError)throw profitRuleError;}
    const {error:delError}=await supabase.from("service_wallet_rules").delete().eq("service_id",saved.id);
    if(delError)throw delError;
    if(chosen.length){const {error:ruleError}=await supabase.from("service_wallet_rules").insert(chosen);if(ruleError)throw ruleError;}
    msg.textContent="Saved successfully.";
    await loadCatalog();await renderServiceManager();
  }catch(e){msg.textContent=e.message||"Unable to save service.";console.error(e);}
  finally{btn.disabled=false;btn.textContent="Save service";}
}
async function toggleService(id){
  const s=services.find(x=>x.id===id);if(!s)return;
  const {error}=await supabase.from("services").update({is_active:!s.is_active,updated_at:new Date().toISOString()}).eq("id",id);
  if(error){alert(error.message);return;}
  await loadCatalog();await renderServiceManager();
}



async function renderWalletManager(){
  await loadCatalog();
  const host=$("other-view");
  const {data:transferHistory,error:transferHistoryError}=await supabase.from("wallet_ledger")
    .select("id,wallet_id,transfer_group_id,amount,direction,description,created_at")
    .in("entry_type",["wallet_transfer_in","wallet_transfer_out"])
    .order("created_at",{ascending:false}).limit(30);
  host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Wallet Management</h2><p>Create wallets, load balances, recharge between wallets and configure low-balance alerts.</p></div></div>
    <div class="admin-editor"><h3>Create wallet</h3><form id="wallet-form" class="service-form">
      <div class="admin-form-grid"><label>Wallet name<input id="wallet-name" required maxlength="100" placeholder="e.g. IDFC Bank"></label><label>Wallet type<select id="wallet-type"><option value="bank">Bank</option><option value="upi">UPI</option><option value="provider">Provider</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label>Provider / account label<input id="wallet-provider" maxlength="100" placeholder="Optional"></label></div>
      <small class="muted">New wallets always start with ₹0 opening balance.</small><div id="wallet-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit" id="wallet-save">Create wallet</button>
    </form></div>
    <div class="admin-editor"><h3>Load wallet balance</h3><form id="load-form" class="service-form"><div class="admin-form-grid"><label>Wallet<select id="load-wallet" required></select></label><label>Load amount (₹)<input id="load-amount" type="number" min="0.01" step="0.01" required></label><label>Source / bank account<input id="load-source" placeholder="e.g. SBI / IDFC / cash" maxlength="100"></label></div><div id="load-message" class="message"></div><button class="primary-btn" type="submit">Record wallet load</button></form></div>
    <div class="admin-editor"><h3>Wallet-to-Wallet Recharge / Transfer</h3><form id="transfer-form" class="service-form">
      <div class="admin-form-grid"><label>From wallet<select id="transfer-from" required></select></label><label>To wallet<select id="transfer-to" required></select></label><label>Amount (₹)<input id="transfer-amount" type="number" min="0.01" step="0.01" required></label></div>
      <label>Note<input id="transfer-note" maxlength="200" placeholder="Optional transfer note"></label><div id="transfer-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit" id="transfer-save">Recharge / Transfer</button>
    </form></div>
    <div class="admin-table-wrap"><div class="admin-table-head"><h3>All wallets · Set low-balance alert limits</h3><input id="wallet-search" class="search-input" placeholder="Search wallets"></div><div id="wallet-rows"></div></div>
    <div class="admin-table-wrap"><h3>Recent wallet-to-wallet transfers</h3><div id="wallet-transfer-history">${transferHistoryError?'<div class="empty-state">Transfer history unavailable.</div>':(transferHistory||[]).map(x=>{const w=walletOptions.find(y=>y.id===x.wallet_id);return '<div class="admin-service-row"><div class="admin-service-main"><strong>'+escapeHtml(w?.name||"Wallet")+' · '+(x.direction==="out"?"Sent":"Received")+'</strong><small>'+escapeHtml(x.description||"Wallet transfer")+' · '+new Date(x.created_at).toLocaleString("en-IN")+'</small></div><div class="admin-service-meta"><strong>'+(x.direction==="out"?"−":"+")+money(x.amount)+'</strong></div></div>';}).join("")||'<div class="empty-state">No wallet-to-wallet transfers recorded yet.</div>'}</div></div>`;
  fillTransferWallets();renderWalletRows();
  $("wallet-form").addEventListener("submit",createWallet);
  $("load-wallet").innerHTML=walletOptions.filter(w=>w.is_active).map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join("");
  $("load-form").addEventListener("submit",loadWallet);
  $("transfer-form").addEventListener("submit",transferWallet);
  $("wallet-search").addEventListener("input",renderWalletRows);
}
function fillTransferWallets(){
  const opts=walletOptions.filter(w=>w.is_active);
  const html=opts.map(w=>`<option value="${w.id}">${escapeHtml(w.name)} · ${money(w.current_balance)}</option>`).join("");
  $("transfer-from").innerHTML='<option value="">Select source</option>'+html;
  $("transfer-to").innerHTML='<option value="">Select destination</option>'+html;
}
function renderWalletRows(){
  const q=$("wallet-search")?.value.trim().toLowerCase()||"";
  const rows=walletOptions.filter(w=>w.name.toLowerCase().includes(q)||(w.provider||"").toLowerCase().includes(q));
  $("wallet-rows").innerHTML=rows.length?rows.map(w=>`
    <div class="admin-service-row ${w.low_balance_alert_enabled!==false&&Number(w.current_balance||0)<=Number(w.low_balance_threshold||0)?"wallet-low-balance":""}"><div class="admin-service-main"><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(w.provider||w.wallet_type)} · ${escapeHtml(w.wallet_type)}</small><label>Low balance alert at ₹<input type="number" min="0" step=".01" value="${Number(w.low_balance_threshold||0)}" data-wallet-threshold="${w.id}" style="width:110px"></label><label><input type="checkbox" data-wallet-alert="${w.id}" ${w.low_balance_alert_enabled!==false?"checked":""}> Alert enabled</label><button class="secondary-btn" data-wallet-threshold-save="${w.id}">Save alert</button></div><div class="admin-service-meta"><strong>${money(w.current_balance)}</strong><span class="status-pill ${w.is_active?"is-active":"is-inactive"}">${w.is_active?"Active":"Inactive"}</span></div><div class="admin-service-actions"><button data-wallet-toggle="${w.id}">${w.is_active?"Deactivate":"Activate"}</button></div></div>`).join(""):'<div class="empty-state">No wallets created yet.</div>';
  document.querySelectorAll("[data-wallet-toggle]").forEach(b=>b.addEventListener("click",()=>toggleWallet(b.dataset.walletToggle)));
  document.querySelectorAll("[data-wallet-threshold-save]").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.walletThresholdSave,threshold=Number(document.querySelector('[data-wallet-threshold="'+id+'"]').value),enabled=document.querySelector('[data-wallet-alert="'+id+'"]').checked;
    if(!Number.isFinite(threshold)||threshold<0){alert("Enter a valid minimum balance.");return;}
    const {error}=await supabase.from("wallets").update({low_balance_threshold:threshold,low_balance_alert_enabled:enabled}).eq("id",id);
    if(error){alert(error.message);return;}await loadCatalog();await renderWalletManager();
  }));
}
async function createWallet(e){
  e.preventDefault();const msg=$("wallet-message"),btn=$("wallet-save");btn.disabled=true;
  const payload={name:$("wallet-name").value.trim(),wallet_type:$("wallet-type").value,provider:$("wallet-provider").value.trim()||null,opening_balance:0,current_balance:0,is_active:true};
  try{const {error}=await supabase.from("wallets").insert(payload);if(error)throw error;msg.textContent="Wallet created with ₹0 opening balance."; $("wallet-form").reset();await loadCatalog();await renderWalletManager();}
  catch(err){msg.textContent=err.message||"Unable to create wallet.";}
  finally{btn.disabled=false;}
}
async function loadWallet(e){
  e.preventDefault();const msg=$("load-message"),btn=$("load-form").querySelector("button");btn.disabled=true;
  try{
    const amount=Number($("load-amount").value);if(!Number.isFinite(amount)||amount<=0)throw new Error("Enter a positive load amount.");
    const {error}=await supabase.from("wallet_ledger").insert({wallet_id:$("load-wallet").value,entry_type:"top_up",amount,direction:"in",description:"Wallet load from "+($("load-source").value.trim()||"unspecified source"),created_by:(await supabase.auth.getUser()).data.user.id});
    if(error)throw error;msg.textContent="Wallet load recorded and balance updated.";await loadCatalog();await renderWalletManager();
  }catch(err){msg.textContent=err.message||"Unable to record wallet load.";}finally{btn.disabled=false;}
}
async function toggleWallet(id){
  const w=walletOptions.find(x=>x.id===id);if(!w)return;
  const {error}=await supabase.from("wallets").update({is_active:!w.is_active}).eq("id",id);
  if(error){alert(error.message);return;}await loadCatalog();await renderWalletManager();
}
async function transferWallet(e){
  e.preventDefault();const msg=$("transfer-message"),btn=$("transfer-save");btn.disabled=true;
  const from=$("transfer-from").value,to=$("transfer-to").value,amount=Number($("transfer-amount").value);
  if(!from||!to||from===to||!Number.isFinite(amount)||amount<=0){msg.textContent="Choose two different wallets and enter a valid amount.";btn.disabled=false;return;}
  try{const {error}=await supabase.rpc("transfer_wallet_balance",{p_from:from,p_to:to,p_amount:amount,p_note:$("transfer-note").value.trim()||null});if(error)throw error;msg.textContent="Transfer completed."; $("transfer-form").reset();await loadCatalog();await renderWalletManager();}
  catch(err){msg.textContent=err.message||"Transfer failed.";}
  finally{btn.disabled=false;}
}

const financePeriodLabels={day:"Daily",week:"Weekly",fortnight:"Fortnightly",month:"Monthly",year:"Yearly"};
const financeDbPeriod={day:"daily",week:"weekly",fortnight:"fortnightly",month:"monthly",year:"yearly"};
function financeYmd(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function financeRange(period){
 const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=new Date(start);
 if(period==="day")end.setDate(end.getDate()+1);
 else if(period==="week"){const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);end.setTime(start.getTime());end.setDate(end.getDate()+7)}
 else if(period==="fortnight"){if(start.getDate()<=15){start.setDate(1);end.setDate(16)}else{start.setDate(16);end.setMonth(end.getMonth()+1,1)}}
 else if(period==="month"){start.setDate(1);end.setMonth(end.getMonth()+1,1)}
 else {start.setMonth(0,1);end.setFullYear(end.getFullYear()+1,0,1)}
 return {start,end};
}
async function renderReports(){
 const host=$("other-view");host.innerHTML=`
 <div class="admin-module-head"><div><div class="eyebrow">ADMIN FINANCIAL CONTROL</div><h2>Targets, Income & Expenses</h2><p>Track earned service income against targets, operating expenses and net profit.</p></div><select id="report-period" class="search-input"><option value="day">Daily</option><option value="week">Weekly (Monday–Sunday)</option><option value="fortnight">Fortnightly (1–15 / 16–month end)</option><option value="month">Monthly</option><option value="year">Yearly</option></select></div>
 <div class="finance-period-label" id="finance-period-label"></div>
 <div class="finance-kpi-grid">
  <article class="finance-kpi"><small>Income target (including carry forward)</small><strong id="finance-target">₹0.00</strong><span id="finance-target-carry">Carry forward: ₹0.00</span><span id="finance-progress-label">0% achieved</span><div class="finance-progress"><i id="finance-progress-bar"></i></div></article>
  <article class="finance-kpi"><small>Earned income</small><strong id="finance-income">₹0.00</strong><span>Service margin + earned commission</span></article>
  <article class="finance-kpi"><small>Expenses</small><strong id="finance-expenses">₹0.00</strong><span id="finance-expense-count">0 expenses</span><div class="finance-progress"><i id="finance-expense-progress-bar"></i></div><span id="finance-expense-progress-label">No expense budget set</span></article>
  <article class="finance-kpi"><small>Net profit after expenses</small><strong id="finance-net">₹0.00</strong><span>Earned income − operating expenses</span></article>
 </div>
 <div class="finance-secondary-stats"><div><small>Customer collections (not income)</small><strong id="finance-collections">₹0.00</strong></div><div><small>Processing costs already deducted in earned income</small><strong id="finance-processing">₹0.00</strong></div></div>
 <div class="admin-editor finance-target-editor"><h3>Set income targets</h3><p>Set a recurring target for each period. Actual income is compared with the selected period's target.</p><form id="finance-target-form" class="finance-target-form"><label>Target period<select id="finance-target-period"><option value="day">Daily</option><option value="week">Weekly</option><option value="fortnight">Fortnightly</option><option value="month">Monthly</option><option value="year">Yearly</option></select></label><label>Income target (₹)<input id="finance-target-input" type="number" min="0" step=".01" required></label><label>Expense budget (₹)<input id="finance-expense-target-input" type="number" min="0" step=".01" required value="0"></label><button class="primary-btn" type="submit">Save target</button></form><div id="finance-target-message" class="message"></div><div class="finance-target-chips" id="finance-target-chips"></div></div>
 <div class="finance-lower-grid"><div class="admin-table-wrap"><h3>Expense category breakdown</h3><div id="finance-category-rows"></div></div><div class="admin-table-wrap"><h3>Recent expenses</h3><div id="finance-expense-rows"></div></div></div>
 <div class="admin-table-wrap"><h3>Recent bills</h3><div id="report-rows"></div></div><div class="admin-table-wrap"><h3>Permanent monthly income & expense history</h3><p class="muted">Monthly totals remain available even after old bill and expense details are cleaned up.</p><div id="monthly-financial-archive"></div></div>`;
 $("report-period").addEventListener("change",loadReportsData);
 $("finance-target-period").addEventListener("change",async()=>{const {data,error}=await supabase.from("income_targets").select("period_type,target_amount,expense_target_amount,daily_target_start_date");if(error){$("finance-target-message").textContent=error.message;return;}const key=financeDbPeriod[$("finance-target-period").value];const x=(data||[]).find(v=>v.period_type===key);$("finance-target-input").value=Number(x?.target_amount||0);$("finance-expense-target-input").value=Number(x?.expense_target_amount||0)});
 $("finance-target-form").addEventListener("submit",async e=>{e.preventDefault();const period=financeDbPeriod[$("finance-target-period").value],amount=Number($("finance-target-input").value),expenseBudget=Number($("finance-expense-target-input").value);if(!Number.isFinite(amount)||amount<0||!Number.isFinite(expenseBudget)||expenseBudget<0)return;const {data:existing,error:readError}=await supabase.from("income_targets").select("daily_target_start_date").eq("period_type",period).maybeSingle();if(readError){$("finance-target-message").textContent="Unable to check existing target: "+readError.message;return;}const payload={period_type:period,target_amount:amount,expense_target_amount:expenseBudget,updated_by:(await supabase.auth.getUser()).data.user?.id,updated_at:new Date().toISOString()};if(period==="daily")payload.daily_target_start_date=existing?.daily_target_start_date||financeYmd(new Date());const {error}=await supabase.from("income_targets").upsert(payload,{onConflict:"period_type"});$("finance-target-message").textContent=error?"Unable to save target: "+error.message:"Target saved successfully.";if(!error)await loadReportsData()});
 await loadReportsData();
 await loadMonthlyFinancialArchive();
}
async function loadMonthlyFinancialArchive(){
 const host=$("monthly-financial-archive");
 if(!host)return;
 const {data,error}=await supabase.from("monthly_financial_summaries")
  .select("month_start,month_label,income_total,expense_total,net_profit,bill_count")
  .order("month_start",{ascending:false}).limit(60);
 if(error){host.innerHTML='<div class="empty-state">Unable to load saved monthly history: '+escapeHtml(error.message)+'</div>';return;}
 const rows=data||[];
 const money=v=>"₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
 host.innerHTML=rows.length?'<div class="admin-service-row"><div class="admin-service-main"><strong>Month</strong></div><div class="admin-service-meta"><strong>Income</strong><strong>Expenses</strong><strong>Net profit</strong></div></div>'+rows.map(x=>'<div class="admin-service-row"><div class="admin-service-main"><strong>'+escapeHtml(x.month_label)+'</strong><small>'+Number(x.bill_count||0)+' bills</small></div><div class="admin-service-meta"><strong>'+money(x.income_total)+'</strong><strong>'+money(x.expense_total)+'</strong><strong>'+money(x.net_profit)+'</strong></div></div>').join(""):'<div class="empty-state">Monthly history will appear after each month is completed.</div>';
}
async function loadReportsData(){
 const period=$("report-period")?.value||"day",{start,end}=financeRange(period),startIso=start.toISOString(),endIso=end.toISOString(),startDate=financeYmd(start),endDate=financeYmd(new Date(end.getTime()-86400000));
 const [tx,ex,targets]=await Promise.all([
  supabase.from("billing_transactions").select("id,bill_number,customer_name,customer_total,processing_total,profit_total,payment_mode,created_at").gte("created_at",startIso).lt("created_at",endIso).order("created_at",{ascending:false}).limit(1000),
  supabase.from("expenses").select("id,expense_date,category,description,amount,payment_mode").gte("expense_date",startDate).lte("expense_date",endDate).order("expense_date",{ascending:false}).limit(1000),
  supabase.from("income_targets").select("period_type,target_amount,expense_target_amount,daily_target_start_date")
 ]);
 const failure=tx.error||ex.error||targets.error;if(failure){$("report-rows").innerHTML='<div class="empty-state">Unable to load financial report: '+escapeHtml(failure.message)+'</div>';return}
 const bills=tx.data||[],expenses=ex.data||[],targetRows=targets.data||[];
 const sum=(arr,k)=>arr.reduce((n,x)=>n+Number(x[k]||0),0),income=sum(bills,"profit_total"),expenseTotal=sum(expenses,"amount"),collection=sum(bills,"customer_total"),processing=sum(bills,"processing_total"),targetRow=targetRows.find(x=>x.period_type===financeDbPeriod[period]),baseTarget=Number(targetRow?.target_amount||0),expenseBudget=Number(targetRow?.expense_target_amount||0);
 let carryForward=0;
 if(period==="day"&&baseTarget>0&&targetRow?.daily_target_start_date){
  const carryStart=new Date(targetRow.daily_target_start_date+"T00:00:00");
  if(carryStart<start){
   const history=await supabase.from("billing_transactions").select("profit_total,created_at").gte("created_at",carryStart.toISOString()).lt("created_at",startIso).limit(10000);
   if(history.error){$("report-rows").innerHTML='<div class="empty-state">Unable to calculate daily target carry forward: '+escapeHtml(history.error.message)+'</div>';return}
   const dailyIncome={};(history.data||[]).forEach(x=>{const key=financeYmd(new Date(x.created_at));dailyIncome[key]=(dailyIncome[key]||0)+Number(x.profit_total||0)});
   for(let d=new Date(carryStart);d<start;d.setDate(d.getDate()+1)){const dayKey=financeYmd(d);carryForward=Math.max(0,baseTarget+carryForward-(dailyIncome[dayKey]||0))}
  }
 }
 const target=baseTarget+(period==="day"?carryForward:0),net=income-expenseTotal,pct=target>0?income/target*100:0,expensePct=expenseBudget>0?expenseTotal/expenseBudget*100:0;
 const money=v=>"₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
 $("finance-period-label").textContent=financePeriodLabels[period]+" · "+startDate+" to "+endDate;
 $("finance-target").textContent=money(target);$("finance-target-carry").textContent=period==="day"?"Carry forward: "+money(carryForward):"No daily carry forward for this period";$("finance-income").textContent=money(income);$("finance-expenses").textContent=money(expenseTotal);$("finance-net").textContent=money(net);$("finance-collections").textContent=money(collection);$("finance-processing").textContent=money(processing);$("finance-expense-count").textContent=expenses.length+" expense entries";
 $("finance-progress-label").textContent=target>0?Math.min(pct,999).toFixed(1)+"% achieved"+(pct>=100?" · Target reached":""):"Set a target to track progress";
 $("finance-progress-bar").style.width=Math.min(pct,100)+"%";$("finance-expense-progress-bar").style.width=Math.min(expensePct,100)+"%";$("finance-expense-progress-label").textContent=expenseBudget>0?(expensePct.toFixed(1)+"% of budget used"):"No expense budget set";
 $("finance-target-input").value=Number(targetRows.find(x=>x.period_type===financeDbPeriod[$("finance-target-period").value])?.target_amount||0);$("finance-expense-target-input").value=Number(targetRows.find(x=>x.period_type===financeDbPeriod[$("finance-target-period").value])?.expense_target_amount||0);
 $("finance-target-chips").innerHTML=Object.entries(financePeriodLabels).map(([k,label])=>{const v=targetRows.find(x=>x.period_type===financeDbPeriod[k]);return '<span>'+label+' income: <b>'+money(v?.target_amount||0)+'</b> · expense budget: <b>'+money(v?.expense_target_amount||0)+'</b></span>'}).join("");
 const cats={};expenses.forEach(x=>{const k=x.category||"Other";cats[k]=(cats[k]||0)+Number(x.amount||0)});
 $("finance-category-rows").innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<div class="admin-service-row"><div class="admin-service-main"><strong>'+escapeHtml(k)+'</strong></div><div class="admin-service-meta"><strong>'+money(v)+'</strong></div></div>').join("")||'<div class="empty-state">No expenses in this period.</div>';
 $("finance-expense-rows").innerHTML=expenses.slice(0,30).map(x=>'<div class="admin-service-row"><div class="admin-service-main"><strong>'+escapeHtml(x.category)+'</strong><small>'+x.expense_date+' · '+escapeHtml(x.description||"")+'</small></div><div class="admin-service-meta"><strong>'+money(x.amount)+'</strong><span>'+escapeHtml(x.payment_mode||"")+'</span></div></div>').join("")||'<div class="empty-state">No expenses in this period.</div>';
 $("report-rows").innerHTML=bills.slice(0,30).map(x=>'<div class="admin-service-row"><div class="admin-service-main"><strong>Bill #'+x.bill_number+'</strong><small>'+escapeHtml(x.customer_name||"Walk-in customer")+' · '+new Date(x.created_at).toLocaleString("en-IN")+'</small></div><div class="admin-service-meta"><strong>'+money(x.profit_total)+' income</strong><span>'+money(x.customer_total)+' collected</span></div><div class="admin-service-meta"><span>'+escapeHtml(x.payment_mode)+'</span></div></div>').join("")||'<div class="empty-state">No bills in this period.</div>';
}
async function manageEmployee(action,payload){
  const {data,error}=await supabase.functions.invoke("employee-management",{body:{action,...payload}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  return data;
}
async function renderEmployeeManager(){
  const host=$("other-view");
  host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Employees</h2><p>Create employee login with mobile number and password. Deactivate instead of deleting to preserve history.</p></div></div>
    <div class="admin-editor"><h3>Add employee & login</h3><form id="employee-form" class="service-form">
      <div class="admin-form-grid">
        <label>Full name<input id="employee-name" required maxlength="120"></label>
        <label>10-digit mobile number<input id="employee-phone" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required></label>
        <label>Monthly fixed salary (₹)<input id="employee-salary" type="number" min="0" step="0.01" value="0" required></label>
        <label>Initial password<input id="employee-password" type="password" minlength="8" autocomplete="new-password" required></label>
      </div><div id="employee-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit">Create employee login</button>
    </form></div>
    <div class="admin-table-wrap"><h3>Employee records</h3><div id="employee-rows">Loading…</div></div>`;
  $("employee-form").addEventListener("submit",createEmployee);
  const {data,error}=await supabase.from("employees").select("id,employee_code,full_name,phone,monthly_salary,is_active,joined_on,profile_id").order("created_at",{ascending:false});
  if(error){$("employee-rows").innerHTML='<div class="empty-state">Unable to load employee records: '+escapeHtml(error.message)+'</div>';return;}
  $("employee-rows").innerHTML=(data||[]).length?data.map(x=>`
    <div class="admin-service-row">
      <div class="admin-service-main"><strong>${escapeHtml(x.full_name)}</strong><small>${escapeHtml(x.phone||"No mobile")} · ${escapeHtml(x.employee_code||"No code")} · ${x.profile_id?"Login linked":"Login not linked"}</small></div>
      <div class="admin-service-meta"><strong>${money(x.monthly_salary)} / month</strong><span class="status-pill ${x.is_active?"is-active":"is-inactive"}">${x.is_active?"Active":"Inactive"}</span></div>
      <div class="admin-service-actions">
        ${!x.profile_id?'<button data-employee-link-login="'+x.id+'">Create login</button>':'<button data-employee-migrate="'+x.id+'">Enable mobile login</button>'}
        <button data-employee-wallets="${x.id}">Assign wallets</button>
        <button data-employee-edit="${x.id}">Edit</button>
        <button data-employee-reset="${x.id}">Reset password</button>
        <button data-employee-toggle="${x.id}" data-active="${x.is_active}">${x.is_active?"Deactivate":"Activate"}</button>
      </div>
    </div>`).join(""):'<div class="empty-state">No employees added yet.</div>';
  document.querySelectorAll("[data-employee-link-login]").forEach(b=>b.addEventListener("click",async()=>{
    const row=(data||[]).find(x=>x.id===b.dataset.employeeLinkLogin);if(!row)return;
    const pwd=prompt("Set initial password for "+row.full_name+" (minimum 8 characters):");if(pwd===null)return;
    if(pwd.length<8){alert("Password must contain at least 8 characters.");return;}
    try{await manageEmployee("link_existing",{employee_id:row.id,password:pwd,full_name:row.full_name});await renderEmployeeManager();alert("Employee login linked successfully.");}
    catch(err){alert("Login creation failed: "+(err.message||err));}
  }));
  document.querySelectorAll("[data-employee-migrate]").forEach(b=>b.addEventListener("click",async()=>{
    const row=(data||[]).find(x=>x.id===b.dataset.employeeMigrate);if(!row)return;
    if(!confirm("Enable mobile-number + password login for "+row.full_name+" without SMS OTP?"))return;
    b.disabled=true;
    try{await manageEmployee("migrate_login",{employee_id:row.id});alert("Mobile login enabled. Employee can now sign in with the 10-digit mobile number and password.");}
    catch(err){alert("Mobile login setup failed: "+(err.message||err));}
    finally{b.disabled=false;}
  }));
  document.querySelectorAll("[data-employee-wallets]").forEach(b=>b.addEventListener("click",async()=>{
    const row=(data||[]).find(x=>x.id===b.dataset.employeeWallets);if(!row)return;
    try{
      const nav=document.querySelector('.nav-item[data-view="walletaccess"]');
      document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===nav));
      $("overview-view").classList.add("hidden");$("other-view").classList.remove("hidden");$("page-title").textContent="Wallet Access";
      await renderOperations("walletaccess",{supabase,host:$("other-view"),profile:currentProfile,$});
      const pick=$("wa-employee");if(pick){pick.value=row.id;pick.dispatchEvent(new Event("change"));}
    }catch(err){alert("Unable to open wallet assignment: "+(err.message||err));}
  }));
  document.querySelectorAll("[data-employee-edit]").forEach(b=>b.addEventListener("click",async()=>{
    const row=(data||[]).find(x=>x.id===b.dataset.employeeEdit);if(!row)return;
    const name=prompt("Employee full name:",row.full_name);if(name===null)return;
    const phone=prompt("10-digit mobile number:",row.phone||"");if(phone===null)return;
    const salary=prompt("Monthly fixed salary (₹):",String(row.monthly_salary||0));if(salary===null)return;
    if(!/^\d{10}$/.test(phone.trim())||!name.trim()||!Number.isFinite(Number(salary))||Number(salary)<0){alert("Enter valid name, 10-digit mobile and salary.");return;}
    try{await manageEmployee("update",{employee_id:row.id,full_name:name.trim(),phone:phone.trim(),monthly_salary:Number(salary)});await renderEmployeeManager();}
    catch(err){alert("Update failed: "+(err.message||err));}
  }));
  document.querySelectorAll("[data-employee-reset]").forEach(b=>b.addEventListener("click",async()=>{
    const pwd=prompt("Enter a new password (minimum 8 characters):");if(pwd===null)return;
    if(pwd.length<8){alert("Password must contain at least 8 characters.");return;}
    try{await manageEmployee("reset_password",{employee_id:b.dataset.employeeReset,password:pwd});alert("Employee password updated.");}
    catch(err){alert("Password reset failed: "+(err.message||err));}
  }));
  document.querySelectorAll("[data-employee-toggle]").forEach(b=>b.addEventListener("click",async()=>{
    const active=b.dataset.active!=="true";
    if(!confirm(active?"Activate this employee login?":"Deactivate this employee login? Existing history will be preserved."))return;
    try{await manageEmployee("set_active",{employee_id:b.dataset.employeeToggle,is_active:active});await renderEmployeeManager();}
    catch(err){alert("Status update failed: "+(err.message||err));}
  }));
}
async function createEmployee(e){
  e.preventDefault();const msg=$("employee-message"),btn=e.submitter||e.currentTarget.querySelector("button[type=submit]");
  const payload={full_name:$("employee-name").value.trim(),phone:$("employee-phone").value.trim(),monthly_salary:Number($("employee-salary").value)||0,password:$("employee-password").value};
  if(!/^\d{10}$/.test(payload.phone)){msg.textContent="Enter a valid 10-digit Indian mobile number.";return;}
  if(payload.password.length<8){msg.textContent="Initial password must be at least 8 characters.";return;}
  btn.disabled=true;msg.textContent="Creating secure employee login…";
  try{await manageEmployee("create",payload);msg.textContent="Employee login created successfully.";e.currentTarget.reset();$("employee-salary").value="0";await renderEmployeeManager();}
  catch(err){msg.textContent=err.message||"Unable to create employee login.";}
  finally{btn.disabled=false;}
}

let billingRows = [];
let billingWalletRules = {};
let billingProfitWalletRules = {};
function money(n){return "₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function serviceByCode(code){return services.find(s=>s.code===code);}
function isPaperPageService(svc){return !!svc&&(svc.code==="PRINTOUT"||svc.code?.startsWith("XEROX_"));}
function paperPageUnit(svc){return svc?.code==="PRINTOUT"?"page":"paper";}
function paperPageRate(row,svc,count){
  const cfg=svc?.billing_config||{};
  const slab=(cfg.quantity_slabs||[]).find(x=>count>=Number(x.min_quantity||x.min||0)&&(x.max_quantity==null&&x.max==null||count<=Number(x.max_quantity??x.max)));
  return Number(slab?.rate??slab?.customer_charge??cfg.customer_charge??0);
}
function calculateBillingRow(row){
  const svc=services.find(s=>s.id===row.service_id), amount=Number(row.base||0),qty=Math.max(1,Number(row.quantity||1));
  if(!svc||amount<0)return {charge:0,cost:0,profit:0,unitTotal:0,total:0};
  if(isPaperPageService(svc)){
    const count=Math.max(0,Number(row.unit_count||0))*Math.max(1,Number(row.sets||1));
    const rate=paperPageRate(row,svc,count),gross=count*rate,discount=Math.min(gross,Math.max(0,Number(row.discount||0)));
    const cost=Number(row.cost||svc.processing_cost_config?.fixed_amount||0);
    return {charge:gross,cost,profit:gross-discount-cost,unitTotal:gross-discount,total:gross-discount,gross,discount,count,rate,quantity:1};
  }
  let charge=0,cost=Number(row.cost||0),profit=0;
  if(svc.code==="CURRENT_BILLS"){
    const cfg=svc.billing_config||{}, costCfg=svc.processing_cost_config||{}, slabs=cfg.slabs||[];
    const slab=slabs.find(x=>amount>=Number(x.min)&&amount<=Number(x.max));
    const costSlab=(costCfg.slabs||[]).find(x=>amount>=Number(x.min)&& (x.max==null||amount<=Number(x.max)));
    const debitTotal=(row.wallet_debits||[]).reduce((sum,x)=>sum+Number(x.amount||0),0);
    const configuredCost=costSlab?Number(costSlab.cost??costSlab.processing_cost??0):(slab?.wallet_extra!=null?Number(slab.wallet_extra):Number(cfg.above_1000?.wallet_extra??row.cost??0));
    if(slab){charge=Number(slab.customer_charge||0);cost=debitTotal>0?debitTotal-amount:configuredCost;}
    else if(amount>1000){charge=10+Math.ceil((amount-1000)/100)*Number(cfg.above_1000?.extra_per_100||1);cost=debitTotal>0?debitTotal-amount:configuredCost;}
  } else if(svc.code==="MONEY_TRANSFER"){
    charge=Math.ceil(amount/1000)*Number(svc.billing_config?.charge_per_1000||10);cost=Number(row.cost||0);
  } else if(svc.code==="PRIVATE_BUS_TICKET"){
    charge=Math.round(amount*Number(svc.billing_config?.commission_percent||6)/100*100)/100;cost=Number(row.cost||0);
  } else if(svc.code==="APSRTC_TICKET"||svc.code==="TTD_TICKET"){
    charge=Number(svc.billing_config?.customer_charge||50);cost=Number(row.cost||svc.processing_cost_config?.fixed_amount||0);
  } else if(svc.code==="CREDIT_CARD_BANK"){
    const pct=Number(row.charge_percent??svc.billing_config?.charge_percent??2);
    charge=Math.round((amount*pct/100)*100)/100;cost=0;profit=charge;
  } else if(svc.code==="AEPS_WITHDRAWAL"){
    const bank=(row.bank||"").toLowerCase();charge=bank.includes("union")?0:Math.ceil(amount/1000)*Number(svc.billing_config?.charge_per_1000||10);cost=Number(row.cost||0);
  } else {
    const bc=svc.billing_config||{},cc=svc.processing_cost_config||{},pc=svc.profit_config||{};
    if(svc.billing_type==="fixed") charge=Number(bc.customer_charge||0);
    else if(svc.billing_type==="percentage") charge=Math.round(amount*Number(bc.percentage||0))/100;
    else if(svc.billing_type==="slabs"){
      const slab=(bc.slabs||[]).find(x=>amount>=Number(x.min||0)&&amount<=Number(x.max||0));
      charge=slab?(slab.percentage!=null?Math.round(amount*Number(slab.percentage))/100:Number(slab.customer_charge??slab.charge??0)):0;
    } else charge=Number(row.charge||bc.customer_charge||0);
    if(svc.processing_cost_type==="fixed") cost=Number(cc.fixed_amount||0);
    else if(svc.processing_cost_type==="percentage") cost=Math.round(amount*Number(cc.percentage||0))/100;
    else if(svc.processing_cost_type==="slabs"){
      const slab=(cc.slabs||[]).find(x=>amount>=Number(x.min||0)&&amount<=Number(x.max||0));
      cost=Number(slab?.cost??slab?.processing_cost??0);
    } else cost=Number(row.cost||0);
    profit=charge-cost;
    if(svc.profit_mode==="fixed"&&pc.fixed_amount!=null)profit=Number(pc.fixed_amount);
    else if(svc.profit_mode==="percentage"&&pc.percentage!=null)profit=Math.round(amount*Number(pc.percentage))/100;
    else if(svc.profit_mode==="slabs"&&Array.isArray(pc.slabs)){
      const slab=pc.slabs.find(x=>amount>=Number(x.min||0)&&amount<=Number(x.max||0));
      profit=Number(slab?.profit??slab?.amount??0);
    }
  }
  if(svc.code==="CREDIT_CARD_BANK")profit=charge;
  else if(["CURRENT_BILLS","MONEY_TRANSFER","PRIVATE_BUS_TICKET","APSRTC_TICKET","TTD_TICKET","AEPS_WITHDRAWAL"].includes(svc.code))profit=charge-cost;
  else if(svc.profit_mode==="manual")profit=charge-cost;
  const unitTotal=amount+charge;
  return {charge,cost,profit,unitTotal,total:unitTotal*qty};
}
async function renderQuickBilling(){
  const host=$("other-view");
  host.innerHTML=`
  <div class="admin-module-head"><div><div class="eyebrow">QUICK BILLING</div><h2>Single Customer · Multiple Services</h2><p>Add any number of services under one customer. Enter customer details and collect payment only once for the complete bill.</p></div></div>
  <div class="admin-editor billing-editor">
    <div class="billing-top"><label>Number of services<input id="bill-count" type="number" min="1" max="100" value="1"></label><label>Customer name (Optional)<input id="bill-customer" placeholder="Enter customer name"></label><label>Customer mobile (Optional)<input id="bill-phone" type="tel" inputmode="numeric" maxlength="15" placeholder="Enter mobile number"></label></div>
    <div id="billing-rows"></div>
    <div class="billing-totals" id="billing-totals"></div>
    <div class="billing-payment">
      <label>Payment mode<select id="bill-mode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="split">Cash + UPI</option></select></label>
      <label>Amount received (₹)<input id="bill-received" type="number" min="0" step="0.01" value="0"></label>
      <label id="cash-paid-wrap">Cash received (₹)<input id="bill-cash" type="number" min="0" step="0.01" value="0"></label>
      <label id="upi-paid-wrap" class="hidden">UPI / PhonePe received (₹)<input id="bill-upi" type="number" min="0" step="0.01" value="0"></label>
    </div>
    <div class="billing-change" id="bill-change">Change: ₹0.00</div>
    <div id="billing-message" class="message"></div>
    <button id="save-billing" class="primary-btn admin-add-btn">Save one bill with all services</button>
  </div>
  <div class="admin-table-wrap"><h3>Recent bills & edit window</h3><div id="recent-bills"></div></div>`;
  $("save-billing").addEventListener("click",saveQuickBilling);
  const count=$("bill-count");
  count.addEventListener("change",()=>{let n=Math.max(1,Math.min(100,Number(count.value)||1));count.value=n;setBillingRows(n);});
  $("bill-mode").addEventListener("change",updatePaymentFields);
  ["bill-received","bill-cash","bill-upi"].forEach(id=>$(id).addEventListener("input",updateBillingTotals));
  setBillingRows(1);await loadRecentBills();
}
function automaticWalletDebits(row,svc){
  if(svc?.code==="UPI_TO_CASH")return [];
  const rules=billingWalletRules[row.service_id]||[];
  if(!rules.length)return [];
  const amount=Number(row.base||0),processingCost=Number(row.cost||svc?.processing_cost_config?.fixed_amount||0);
  const modes=rules.map(rule=>rule.debit_config?.mode||(rule.debit_config?.fixed_amount!=null?"fixed_amount":"processing_cost"));
  const hasBaseAmount=modes.includes("base_amount");
  let autoTarget=processingCost;
  if(svc?.code==="CURRENT_BILLS"){
    const cfg=svc.billing_config||{},costCfg=svc.processing_cost_config||{};
    const slab=(costCfg.slabs||[]).find(x=>amount>=Number(x.min||0)&&(x.max==null||amount<=Number(x.max)));
    const billingSlab=(cfg.slabs||[]).find(x=>amount>=Number(x.min||0)&&amount<=Number(x.max||0));
    const extra=Number(slab?.cost??slab?.processing_cost??billingSlab?.wallet_extra??row.cost??cfg.above_1000?.wallet_extra??0);
    autoTarget=hasBaseAmount?extra:amount+extra;
  }
  const allocations=rules.map((rule,i)=>{
    const cfg=rule.debit_config||{},mode=modes[i];
    if(mode==="base_amount")return {wallet_id:rule.wallet_id,amount};
    if(mode==="base_plus_processing_cost")return {wallet_id:rule.wallet_id,amount:svc?.code==="CURRENT_BILLS"?autoTarget:amount+processingCost};
    if(mode==="fixed_amount")return {wallet_id:rule.wallet_id,amount:Number(cfg.fixed_amount||0)};
    if(mode==="percentage")return {wallet_id:rule.wallet_id,amount:Math.round(amount*Number(cfg.percentage||0))/100};
    return {wallet_id:rule.wallet_id,amount:null};
  });
  const autoIndexes=allocations.map((x,i)=>x.amount===null?i:-1).filter(i=>i>=0);
  if(autoIndexes.length)allocations[autoIndexes[autoIndexes.length-1]].amount=autoTarget;
  return allocations.filter(x=>Number(x.amount)>0);
}
async function setBillingRows(n){
  const {data:rules}=await supabase.from("service_wallet_rules").select("service_id,wallet_id,wallet_slot,debit_config").order("wallet_slot");
  billingWalletRules={};(rules||[]).forEach(x=>(billingWalletRules[x.service_id]??=[]).push(x));
  const {data:profitRules,error:profitRulesError}=await supabase.from("service_profit_wallet_rules").select("service_id,wallet_id").order("wallet_id");
  if(profitRulesError){console.warn("Optional service profit-wallet rules could not be loaded; continuing Quick Billing.",profitRulesError);}
  billingProfitWalletRules={};(profitRules||[]).forEach(x=>(billingProfitWalletRules[x.service_id]??=[]).push(x.wallet_id));
  billingRows=Array.from({length:n},(_,i)=>billingRows[i]||({service_id:"",base:"",charge:"",cost:"",bank:"",quantity:1,unit_count:"",sets:1,item_label:"",discount:0,wallet_debits:[],bill_count:1,bill_amounts:[""]}));
  $("billing-rows").innerHTML=billingRows.map((r,i)=>{
    const serviceOptions=services.filter(s=>s.is_active).map(s=>'<option value="'+s.id+'" '+(s.id===r.service_id?"selected":"")+'>'+escapeHtml(s.name)+'</option>').join("");
    const svc=services.find(s=>s.id===r.service_id)||{},special=isPaperPageService(svc),alloc=automaticWalletDebits(r,svc);
    const count=Number(r.unit_count||0)*Math.max(1,Number(r.sets||1)),rate=paperPageRate(r,svc,count);
    const walletOptionsHtml=(billingWalletRules[r.service_id]||[]).map(rule=>{
      const wallet=walletOptions.find(x=>x.id===rule.wallet_id),debit=alloc.find(x=>x.wallet_id===rule.wallet_id);
      return wallet?'<div class="wallet-choice"><span>'+escapeHtml(wallet.name)+' <small>Balance '+money(wallet.current_balance)+' · Auto debit '+money(debit?.amount||0)+'</small></span></div>':"";
    }).join("")||"<small>No processing wallet configured for this service.</small>";
    const isCreditCard=svc?.code==="CREDIT_CARD_BANK";
    const ccWalletIds=billingProfitWalletRules[r.service_id]||[];
    const isCurrentBills=svc?.code==="CURRENT_BILLS";
    const billAmounts=Array.isArray(r.bill_amounts)?r.bill_amounts:[];
    const isCashTransfer=["CASH_TO_UPI","UPI_TO_CASH"].includes(svc?.code);
    const serviceFields=isCurrentBills
      ? '<label>Number of current bills<input data-field="bill_count" data-i="'+i+'" type="number" min="1" max="100" step="1" value="'+Math.max(1,Number(r.bill_count||billAmounts.length||1))+'"></label><div class="current-bills-grid-wrap"><table class="current-bills-grid"><thead><tr><th>#</th><th>Bill amount (₹)</th><th>Service charge (₹)</th><th>Customer total (₹)</th></tr></thead><tbody>'+Array.from({length:Math.max(1,Number(r.bill_count||billAmounts.length||1))},(_,j)=>{const amount=Number(billAmounts[j]||0),calc=calculateBillingRow({...r,base:amount});return '<tr><td>'+(j+1)+'</td><td><input data-field="bill_amount" data-i="'+i+'" data-j="'+j+'" type="number" min="0" step="0.01" value="'+(billAmounts[j]??"")+'" placeholder="Enter bill amount"></td><td><span data-current-charge="'+i+'-'+j+'">'+money(calc.charge)+'</span></td><td><strong data-current-total="'+i+'-'+j+'">'+money(calc.total)+'</strong></td></tr>';}).join("")+'</tbody></table></div>'
      : special
      ? '<label>Book / PDF name (optional)<input data-field="item_label" data-i="'+i+'" value="'+escapeHtml(r.item_label||"")+'" placeholder="Book 1 / PDF 1"></label><label>'+(svc.code==="PRINTOUT"?"PDF pages":"Xerox papers")+'<input data-field="unit_count" data-i="'+i+'" type="number" min="1" step="1" value="'+escapeHtml(r.unit_count||"")+'" placeholder="Enter count"></label><label>Number of sets<input data-field="sets" data-i="'+i+'" type="number" min="1" step="1" value="'+Number(r.sets||1)+'"></label><label>Admin fixed rate (automatic)<input type="text" readonly value="'+money(rate)+' / '+(svc.code==="PRINTOUT"?"page":"paper")+'"></label><label>Discount (₹)<input data-field="discount" data-i="'+i+'" type="number" min="0" step="0.01" value="'+Number(r.discount||0)+'" placeholder="Optional"></label>'
      : isCreditCard
        ? '<label>Transfer amount (₹)<input data-field="base" data-i="'+i+'" type="number" min="0.01" step="0.01" value="'+escapeHtml(r.base||"")+'" placeholder="Enter amount"></label><label>Service charge (%)<input data-field="charge_percent" data-i="'+i+'" type="number" min="0.01" max="100" step="0.01" value="'+escapeHtml(r.charge_percent??svc.billing_config?.charge_percent??2)+'"></label><label>Profit wallet<select data-field="profit_wallet_id" data-i="'+i+'"><option value="">Select wallet</option>'+ccWalletIds.map(id=>{const w=walletOptions.find(x=>x.id===id&&x.is_active);return w?'<option value="'+w.id+'" '+(r.profit_wallet_id===w.id?"selected":"")+'>'+escapeHtml(w.name)+' · '+money(w.current_balance)+'</option>':"";}).join("")+'</select></label><label>Quantity<input data-field="quantity" data-i="'+i+'" type="number" min="1" step="1" value="'+Number(r.quantity||1)+'"></label>'
        : isCashTransfer
          ? '<label>Amount (₹)<input data-field="base" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.base)+'" placeholder="Enter transfer amount"></label><label>Quantity<input data-field="quantity" data-i="'+i+'" type="number" min="1" step="1" value="'+Number(r.quantity||1)+'"></label><label>Adjustment Type<select data-field="adjustment_type" data-i="'+i+'"><option value="">No adjustment</option><option value="deduct" '+(r.adjustment_type==="deduct"?"selected":"")+'>Amount Deduct</option><option value="extra" '+(r.adjustment_type==="extra"?"selected":"")+'>Amount Extra</option></select></label><label>Adjustment Amount (₹)<input data-field="adjustment_amount" data-i="'+i+'" type="number" min="0" step="0.01" value="'+Number(r.adjustment_amount||0)+'" placeholder="0.00"></label>'+(svc.code==="UPI_TO_CASH"?'<label>UPI Credit Destination<select data-field="selected_upi_to_cash_wallet_id" data-i="'+i+'"><option value="">Select UPI Collection / Bank Account</option>'+walletOptions.filter(w=>w.is_active&&["upi","bank"].includes(w.wallet_type)).map(w=>'<option value="'+w.id+'" '+(r.selected_upi_to_cash_wallet_id===w.id?"selected":"")+'>'+escapeHtml(w.name)+' · '+money(w.current_balance)+'</option>').join("")+'</select></label>':"")+(svc.code==="CASH_TO_UPI"&&r.adjustment_type==="deduct"?'<label>Deduct from Wallet<select data-field="selected_adjustment_wallet_id" data-i="'+i+'"><option value="">Select wallet</option>'+(billingWalletRules[r.service_id]||[]).map(rule=>{const w=walletOptions.find(x=>x.id===rule.wallet_id&&x.is_active);return w?'<option value="'+w.id+'" '+(r.selected_adjustment_wallet_id===w.id?"selected":"")+'>'+escapeHtml(w.name)+' · '+money(w.current_balance)+'</option>':"";}).join("")+'</select></label>':"")+(r.adjustment_type==="extra"?(svc.code==="UPI_TO_CASH"?'<small>Extra amount will be added to the selected UPI / Bank wallet.</small>':'<label>Extra Payment Mode<select data-field="adjustment_mode" data-i="'+i+'"><option value="cash" '+((r.adjustment_mode||"cash")==="cash"?"selected":"")+'>Cash</option><option value="upi" '+(r.adjustment_mode==="upi"?"selected":"")+'>UPI</option></select></label>'):"")
          : '<label>Bill / Transfer Amount (₹)<input data-field="base" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.base)+'"></label><label>Quantity<input data-field="quantity" data-i="'+i+'" type="number" min="1" step="1" value="'+Number(r.quantity||1)+'"></label><label>Service charge (₹)<input data-field="charge" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.charge||"")+'"></label><label class="bank-field">Bank (AEPS)<input data-field="bank" data-i="'+i+'" value="'+escapeHtml(r.bank)+'" placeholder="Bank name"></label><label>Manual processing cost (₹)<input data-field="cost" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.cost)+'"></label>';
    return '<div class="billing-row" data-row="'+i+'"><div class="billing-row-head"><strong>Item '+(i+1)+'</strong><span class="billing-row-total" id="row-total-'+i+'">₹0.00</span></div><div class="billing-row-fields"><label>Service<div class="service-picker" data-service-picker="'+i+'"><input type="search" data-service-search="'+i+'" value="'+escapeHtml(svc?.name||"")+'" placeholder="Type one letter or service name…" autocomplete="off"><div class="service-picker-options hidden" id="service-picker-options-'+i+'"></div></div></label>'+serviceFields+'</div><div class="wallet-map-box"><strong>Processing wallet (automatic)</strong><p>Wallet and debit amount are taken from Admin service settings.</p><div class="wallet-choice-grid" id="wallet-auto-'+i+'">'+walletOptionsHtml+'</div></div><div class="billing-row-result" id="row-result-'+i+'">Service Charge: ₹0.00</div></div>';
  }).join("");
  $("billing-rows").querySelectorAll("[data-field]").forEach(el=>{
    if(el.dataset.field==="bill_count")el.addEventListener("change",onBillingRowChange);
    else {el.addEventListener("input",onBillingRowChange);el.addEventListener("change",onBillingRowChange);}
  });
  $("billing-rows").querySelectorAll("[data-service-search]").forEach(input=>{
    const idx=Number(input.dataset.serviceSearch),menu=$("service-picker-options-"+idx);
    const showMatches=()=>{const q=input.value.trim().toLowerCase();const matches=services.filter(s=>s.is_active&&(!q||s.name.toLowerCase().includes(q)||String(s.code||"").toLowerCase().includes(q)));menu.innerHTML=matches.map(s=>'<button type="button" data-service-option="'+s.id+'" data-row-index="'+idx+'">'+escapeHtml(s.name)+'</button>').join("")||'<div class="service-picker-empty">No matching services</div>';menu.classList.remove("hidden");};
    input.addEventListener("focus",showMatches);input.addEventListener("input",showMatches);
    input.addEventListener("keydown",e=>{if(e.key==="Escape")menu.classList.add("hidden");if(e.key==="Enter"){const first=menu.querySelector("[data-service-option]");if(first){e.preventDefault();first.click();}}});
  });
  $("billing-rows").onclick=e=>{
    const btn=e.target.closest("[data-service-option]");if(!btn)return;
    const idx=Number(btn.dataset.rowIndex),svc=services.find(s=>s.id===btn.dataset.serviceOption);if(!svc)return;
    billingRows[idx].service_id=svc.id;billingRows[idx].base=svc.billing_config?.base_amount??"";billingRows[idx].charge=svc.billing_config?.customer_charge??"";billingRows[idx].cost=svc.processing_cost_config?.fixed_amount??"";billingRows[idx].charge_percent=svc.billing_config?.charge_percent??2;billingRows[idx].profit_wallet_id="";billingRows[idx].quantity=1;billingRows[idx].unit_count="";billingRows[idx].sets=1;billingRows[idx].item_label="";billingRows[idx].discount=0;billingRows[idx].wallet_debits=[];billingRows[idx].bill_count=1;billingRows[idx].bill_amounts=[""];
    setBillingRows(billingRows.length);
  };
  updateBillingTotals();
}
function onBillingRowChange(e){
  const i=Number(e.target.dataset.i),field=e.target.dataset.field;
  if(field==="bill_amount"){
    billingRows[i].bill_amounts=Array.isArray(billingRows[i].bill_amounts)?billingRows[i].bill_amounts:[];
    billingRows[i].bill_amounts[Number(e.target.dataset.j)]=e.target.value;
    updateBillingTotals();return;
  }
  if(field==="bill_count"){
    const n=Math.max(1,Math.min(100,Number(e.target.value)||1));
    billingRows[i].bill_count=n;
    billingRows[i].bill_amounts=Array.from({length:n},(_,j)=>billingRows[i].bill_amounts?.[j]??"");
    setBillingRows(billingRows.length);return;
  }
  billingRows[i][field]=e.target.value;
  if(field==="adjustment_type"){
    if(e.target.value==="extra"&&!billingRows[i].adjustment_mode)billingRows[i].adjustment_mode="cash";
    setBillingRows(billingRows.length);return;
  }
  if(field==="service_id"){
    const svc=services.find(s=>s.id===e.target.value);
    billingRows[i].base=svc?.billing_config?.base_amount??"";
    billingRows[i].charge=svc?.billing_config?.customer_charge??"";
    billingRows[i].cost=svc?.processing_cost_config?.fixed_amount??"";
    billingRows[i].charge_percent=svc?.billing_config?.charge_percent??2;
    billingRows[i].profit_wallet_id="";
    billingRows[i].quantity=1;billingRows[i].unit_count="";billingRows[i].sets=1;billingRows[i].item_label="";billingRows[i].discount=0;billingRows[i].wallet_debits=[];billingRows[i].bill_count=1;billingRows[i].bill_amounts=[""];billingRows[i].adjustment_type="";billingRows[i].adjustment_amount=0;billingRows[i].adjustment_mode="cash";billingRows[i].selected_upi_to_cash_wallet_id="";
    setBillingRows(billingRows.length);return;
  }
  updateBillingTotals();
}
function onBillingWalletChange(){}

function updateBillingTotals(){
  let base=0,charges=0,costs=0,total=0;
  billingRows.forEach((r,i)=>{
    const svc=services.find(s=>s.id===r.service_id),isCurrentBills=svc?.code==="CURRENT_BILLS",special=isPaperPageService(svc),alloc=automaticWalletDebits(r,svc),t=$("row-total-"+i),res=$("row-result-"+i),walletBox=$("wallet-auto-"+i);
    const currentCalcs=isCurrentBills?(r.bill_amounts||[]).map(amount=>calculateBillingRow({...r,base:amount})):null;
    if(isCurrentBills)currentCalcs.forEach((x,j)=>{const charge=$("[data-current-charge='"+i+"-"+j+"']"),lineTotal=$("[data-current-total='"+i+"-"+j+"']");if(charge)charge.textContent=money(x.charge);if(lineTotal)lineTotal.textContent=money(x.total);});
    const calc=isCurrentBills?{charge:currentCalcs.reduce((a,x)=>a+x.charge,0),cost:currentCalcs.reduce((a,x)=>a+x.cost,0),profit:currentCalcs.reduce((a,x)=>a+x.profit,0),total:currentCalcs.reduce((a,x)=>a+x.total,0)}:calculateBillingRow(r);
    const adjustmentExtra=["CASH_TO_UPI","UPI_TO_CASH"].includes(svc?.code)&&r.adjustment_type==="extra"?Math.max(0,Number(r.adjustment_amount||0)):0;
    base+=isCurrentBills?(r.bill_amounts||[]).reduce((a,x)=>a+Number(x||0),0):Number(r.base||0);charges+=calc.charge;costs+=calc.cost;total+=calc.total+adjustmentExtra;
    if(t)t.textContent=""+money(calc.total+adjustmentExtra);
    if(walletBox)walletBox.innerHTML=(billingWalletRules[r.service_id]||[]).map(rule=>{const wallet=walletOptions.find(x=>x.id===rule.wallet_id),debit=alloc.find(x=>x.wallet_id===rule.wallet_id);return wallet?'<div class="wallet-choice"><span>'+escapeHtml(wallet.name)+' <small>Balance '+money(wallet.current_balance)+' · Auto debit '+money(debit?.amount||0)+'</small></span></div>':"";}).join("")||"<small>No processing wallet configured for this service.</small>";
    if(res)res.textContent=isCurrentBills?"Bills: "+(r.bill_amounts||[]).filter(x=>Number(x)>0).length+" · Service charges: "+money(calc.charge)+" · Customer total: "+money(calc.total)+(currentProfile?.role==="admin"?" · Profit: "+money(calc.profit):""):currentProfile?.role==="admin"?"Gross: "+money(calc.gross??calc.charge)+" · Discount: "+money(calc.discount||0)+" · Processing Cost: "+money(calc.cost)+" · Profit: "+money(calc.profit)+" · Wallet debit: "+money(alloc.reduce((a,x)=>a+x.amount,0)):"Amount: "+money(calc.total)+(special?" · "+calc.count+" "+(svc.code==="PRINTOUT"?"pages":"papers"):"");
  });
  $("billing-totals").innerHTML='<div><small>Gross / base</small><strong>'+money(base+charges)+'</strong></div><div><small>Service charges</small><strong>'+money(charges)+'</strong></div><div><small>Customer total</small><strong>'+money(total)+'</strong></div>';
  const received=Number($("bill-received").value||0);
  const balance=Math.max(0,total-received),change=Math.max(0,received-total),status=$("bill-change");
  status.classList.remove("payment-short","payment-exact","payment-change");
  if(received<total){status.classList.add("payment-short");status.textContent="BALANCE TO COLLECT  ·  "+money(balance);}
  else if(received===total){status.classList.add("payment-exact");status.textContent="PAYMENT SETTLED  ·  "+money(0);}
  else{status.classList.add("payment-change");status.textContent="RETURN TO CUSTOMER  ·  "+money(change);}
}
function updatePaymentFields(){
  const mode=$("bill-mode").value;
  $("cash-paid-wrap").classList.toggle("hidden",mode==="upi");
  $("upi-paid-wrap").classList.toggle("hidden",mode==="cash");
}
let editingBillId=null;
async function saveQuickBilling(){
  const msg=$("billing-message"),btn=$("save-billing");btn.disabled=true;msg.textContent="";
  try{
    const items=[];let customerTotal=0,processingTotal=0,profitTotal=0;
    const expandedBillingRows=billingRows.flatMap(r=>{
      const svc=services.find(s=>s.id===r.service_id);
      if(svc?.code!=="CURRENT_BILLS")return [r];
      return (r.bill_amounts||[]).filter(v=>String(v).trim()!==""&&Number(v)>0).map(v=>({...r,base:String(v),quantity:1}));
    });
    for(const r of expandedBillingRows){
      if(!r.service_id&&!Number(r.base||0)&&!Number(r.unit_count||0))continue;
      if(!r.service_id||Number(r.base||0)<0)throw new Error("Every entered row needs a service and valid count or bill amount.");
      const svc=services.find(s=>s.id===r.service_id),special=isPaperPageService(svc);
      const wallet_debits=automaticWalletDebits(r,svc);
      if(svc.code==="CURRENT_BILLS"&&Number(r.base)>=10&&!(billingWalletRules[r.service_id]||[]).length)throw new Error("Admin must assign a processing wallet to Current Bills.");
      if(svc.code==="CREDIT_CARD_BANK"){
        if(!(billingProfitWalletRules[r.service_id]||[]).includes(r.profit_wallet_id))throw new Error("Select a profit wallet assigned by Admin for Credit Card service.");
        if(!(Number(r.base)>0)||!(Number(r.charge_percent)>0)||Number(r.charge_percent)>100)throw new Error("Enter a valid transfer amount and percentage (0.01–100).");
      }
      if(svc.code!=="UPI_TO_CASH"&&(billingWalletRules[r.service_id]||[]).length&&!wallet_debits.length)throw new Error("Set processing wallet debit amounts in Admin Services for "+svc.name);
      if(wallet_debits.some(x=>!Number.isFinite(Number(x.amount))||Number(x.amount)<=0))throw new Error("Invalid automatic wallet debit amount.");
      r.wallet_debits=wallet_debits;
      const calc=calculateBillingRow(r);
      if(special&&(!Number(r.unit_count)||Number(r.unit_count)<1||!Number(r.sets)||Number(r.sets)<1))throw new Error("Enter a valid paper/page count and number of sets for "+svc.name+".");
      if(special&&Number(r.discount||0)>calc.gross)throw new Error("Discount cannot exceed the fixed-price amount.");
      const quantity=special?1:Math.max(1,Number(r.quantity||1)),price=calc.unitTotal;
      const snapshot=special
        ? {base_amount:0,service_charge:calc.gross,count_unit:svc.code==="PRINTOUT"?"pages":"papers",unit_count:Number(r.unit_count),sets:Number(r.sets),total_count:calc.count,item_label:r.item_label||null,unit_rate:calc.rate,discount_amount:calc.discount,wallet_debits}
        : svc.code==="CREDIT_CARD_BANK" ? {base_amount:Number(r.base),service_charge:calc.charge,charge_percent:Number(r.charge_percent),profit_wallet_id:r.profit_wallet_id,wallet_debits}
        : {base_amount:Number(r.base),service_charge:calc.charge,bank:r.bank||null,upi_to_cash_wallet_id:svc.code==="UPI_TO_CASH"?r.selected_upi_to_cash_wallet_id||null:null,wallet_debits};
      const itemPayload={service_id:r.service_id,quantity,customer_unit_price:price,processing_unit_cost:calc.cost,pricing_snapshot:snapshot,wallet_debits};
      if(currentProfile?.role==="admin")itemPayload.profit_amount=calc.profit;
      items.push(itemPayload);
      customerTotal+=price*quantity;processingTotal+=calc.cost*quantity;profitTotal+=calc.profit*quantity;
    }
    if(!items.length)throw new Error("Enter at least one bill.");
    const adjustmentRows=expandedBillingRows.filter(r=>["UPI_TO_CASH","CASH_TO_UPI"].includes(services.find(s=>s.id===r.service_id)?.code));
    if(adjustmentRows.length>1)throw new Error("Please bill one Cash to UPI / UPI to Cash service row at a time when using an adjustment.");
    const adjustmentRow=adjustmentRows[0]||null,adjustmentServiceCode=services.find(s=>s.id===adjustmentRow?.service_id)?.code||null,adjustmentType=adjustmentRow?.adjustment_type||null,adjustmentAmount=Math.max(0,Number(adjustmentRow?.adjustment_amount||0)),adjustmentMode=adjustmentRow?.adjustment_mode||null;
    if(adjustmentAmount>0&&!adjustmentType)throw new Error("Select Amount Deduct or Amount Extra.");
    if(adjustmentAmount>0&&adjustmentType==="deduct"&&adjustmentServiceCode==="CASH_TO_UPI"&&!adjustmentRow?.selected_adjustment_wallet_id)throw new Error("Select the wallet for Cash to UPI deduction.");
    if(adjustmentServiceCode==="UPI_TO_CASH"&&!adjustmentRow?.selected_upi_to_cash_wallet_id)throw new Error("Select where the customer UPI amount should be credited.");
    if(adjustmentType==="extra"&&adjustmentAmount>0&&adjustmentServiceCode==="CASH_TO_UPI"&&!["cash","upi"].includes(adjustmentMode))throw new Error("Select Cash or UPI for Amount Extra.");
    const mode=$("bill-mode").value,enteredReceived=Number($("bill-received").value||0);
    if(adjustmentServiceCode==="UPI_TO_CASH"&&mode!=="upi")throw new Error("UPI to Cash must be collected through UPI. Select UPI payment mode.");
    let cash=mode==="upi"?0:mode==="cash"?enteredReceived:Number($("bill-cash").value||0),upi=mode==="cash"?0:mode==="upi"?enteredReceived:Number($("bill-upi").value||0),finalMode=mode,received=mode==="split"?cash+upi:enteredReceived;
    if(adjustmentType==="extra"&&adjustmentAmount>0){if(adjustmentServiceCode==="UPI_TO_CASH")upi+=adjustmentAmount;else if(adjustmentMode==="cash")cash+=adjustmentAmount;else upi+=adjustmentAmount;received+=adjustmentAmount;if(cash>0&&upi>0)finalMode="split";else finalMode=cash>0?"cash":"upi";}
    const customerTotalWithAdjustment=customerTotal+(adjustmentType==="extra"?adjustmentAmount:0);
    if(received<customerTotalWithAdjustment)throw new Error("Amount received must be equal to or greater than customer total including extra amount.");
    if(finalMode==="split"&&Math.abs(cash+upi-received)>0.009)throw new Error("Cash + UPI must equal amount received.");
    let activeDrawerId=null;if(currentProfile?.role==="employee"&&currentEmployee){const activeSession=await supabase.from("drawer_sessions").select("drawer_id").eq("employee_id",currentEmployee.id).eq("status","open").order("opened_at",{ascending:false}).limit(1).maybeSingle();if(activeSession.error)throw activeSession.error;activeDrawerId=activeSession.data?.drawer_id||null;}
    const payload={drawer_id:activeDrawerId,customer_name:$("bill-customer").value.trim()||null,customer_phone:$("bill-phone").value.trim()||null,payment_mode:finalMode,customer_total:customerTotalWithAdjustment,amount_received:received,cash_received:cash,upi_received:upi,items};
    const {data,error}=editingBillId?await supabase.rpc("update_bill_with_approval",{p_transaction_id:editingBillId,p_payload:{...payload,notes:null},p_edit_request_id:null}):await supabase.rpc("create_bill",{payload});
    if(error)throw error;
    if(adjustmentRows.length){const adjustmentResult=adjustmentServiceCode==="UPI_TO_CASH"?await supabase.rpc("settle_upi_to_cash",{p_transaction_id:data||editingBillId,p_adjustment_type:adjustmentType,p_adjustment_amount:adjustmentAmount,p_destination_wallet_id:adjustmentRow?.selected_upi_to_cash_wallet_id}):await supabase.rpc("set_aeps_cash_adjustment",{p_transaction_id:data||editingBillId,p_adjustment_type:adjustmentType,p_amount:adjustmentAmount,p_mode:adjustmentMode,p_wallet_id:adjustmentServiceCode==="CASH_TO_UPI"?adjustmentRow?.selected_adjustment_wallet_id||null:null});if(adjustmentResult.error)throw adjustmentResult.error;}
    msg.textContent=(editingBillId?"Bill updated successfully.":"Bills saved successfully.")+" Transaction ID: "+(data||editingBillId);editingBillId=null;$("save-billing").textContent="Save one bill with all services";
    $("bill-received").value="0";$("bill-cash").value="0";$("bill-upi").value="0";
    $("bill-customer").value="";$("bill-phone").value="";
    billingRows=[];
    const freshCount=Math.max(1,Math.min(100,Number($("bill-count").value)||1));
    $("bill-count").value=freshCount;
    await setBillingRows(freshCount);
    updatePaymentFields();await loadRecentBills();
  }catch(e){msg.textContent=e.message||"Unable to save bills.";console.error(e);}
  finally{btn.disabled=false;}
}
async function loadRecentBills(){
  const {data:userData}=await supabase.auth.getUser();awaitUserId=userData?.user?.id||null;
  const {data,error}=await supabase.from("billing_transactions").select("id,bill_number,customer_name,customer_phone,payment_mode,customer_total,amount_received,cash_received,upi_received,created_at,created_by").order("created_at",{ascending:false}).limit(20);
  if(error){$("recent-bills").textContent="Unable to load bills.";return;}
  const rows=data||[];
  const {data:reqs}=await supabase.from("billing_edit_requests").select("id,transaction_id,requested_by,status,reason,created_at,review_note").order("created_at",{ascending:false}).limit(30);
  $("recent-bills").innerHTML=rows.map(x=>{
    const mins=(Date.now()-new Date(x.created_at).getTime())/60000,own=x.created_by=== (awaitUserId),canEdit=currentProfile?.role==="admin"||(own&&mins<=60);
    const pending=(reqs||[]).find(r=>r.transaction_id===x.id&&r.status==="pending"&&r.requested_by===awaitUserId);
    const approved=(reqs||[]).find(r=>r.transaction_id===x.id&&r.status==="approved"&&r.requested_by===awaitUserId);
    return `<div class="admin-service-row"><div class="admin-service-main"><strong>Bill #${x.bill_number}</strong><small>${new Date(x.created_at).toLocaleString("en-IN")}</small></div><div class="admin-service-meta"><strong>${money(x.customer_total)}</strong><span>${mins<=60?"Within 1-hour edit window":"Approval required"}</span></div><div class="admin-service-actions">${canEdit?`<button data-bill-edit="${x.id}">Edit bill</button>`:pending?'<span>Request pending</span>':approved?`<button data-apply-approved="${approved.id}" data-bill="${x.id}">Apply approved</button>`:`<button data-bill-request="${x.id}">Request edit</button>`}</div></div>`;
  }).join("")||'<div class="empty-state">No bills yet.</div>';
  document.querySelectorAll("[data-bill-edit]").forEach(b=>b.addEventListener("click",()=>openBillEditor(b.dataset.billEdit,false)));
  document.querySelectorAll("[data-bill-request]").forEach(b=>b.addEventListener("click",()=>openBillEditor(b.dataset.billRequest,true)));
  document.querySelectorAll("[data-apply-approved]").forEach(b=>b.addEventListener("click",()=>applyApprovedEdit(b.dataset.bill,b.dataset.applyApproved)));
  if(currentProfile?.role==="admin") await renderEditApprovals(reqs||[]);
}
let awaitUserId=null;
async function openBillEditor(id,requestOnly){
  const {data:userData}=await supabase.auth.getUser();awaitUserId=userData.user.id;
  const itemFields=currentProfile?.role==="admin"?"service_id,quantity,customer_unit_price,processing_unit_cost,profit_amount,pricing_snapshot":"service_id,quantity,customer_unit_price,pricing_snapshot";
  const [{data:bill,error:bErr},{data:items,error:iErr}]=await Promise.all([
    supabase.from("billing_transactions").select("id,customer_name,customer_phone,payment_mode,customer_total,amount_received,cash_received,upi_received,notes,created_at,created_by").eq("id",id).single(),
    supabase.from("billing_items").select(itemFields).eq("transaction_id",id)
  ]);
  if(bErr||iErr){alert((bErr||iErr).message);return;}
  const payload={customer_name:bill.customer_name,customer_phone:bill.customer_phone,payment_mode:bill.payment_mode,customer_total:Number(bill.customer_total),amount_received:Number(bill.amount_received),cash_received:Number(bill.cash_received),upi_received:Number(bill.upi_received),notes:bill.notes,items:(items||[]).map(it=>({...it,wallet_debits:it.pricing_snapshot?.wallet_debits||[]}))};
  if(requestOnly){
    const host=$("recent-bills"),editor=document.createElement("div");editor.className="admin-editor";editor.id="bill-edit-editor";
    editor.innerHTML=`<div class="admin-editor-head"><div><h3>Request bill edit</h3><p>Send the proposed changes to Admin for approval.</p></div><button type="button" class="text-btn" id="close-bill-editor">Close</button></div><label class="service-form">Bill data (JSON)<textarea id="bill-edit-json" rows="14" spellcheck="false"></textarea></label><label class="service-form">Reason for edit<input id="bill-edit-reason" placeholder="Explain why this bill needs correction" required></label><div id="bill-edit-message" class="message"></div><div class="admin-form-actions"><button class="primary-btn" id="submit-bill-edit">Send edit request</button></div>`;
    host.prepend(editor);$("bill-edit-json").value=JSON.stringify(payload,null,2);$("close-bill-editor").onclick=()=>editor.remove();
    $("submit-bill-edit").onclick=async()=>{const btn=$("submit-bill-edit"),msg=$("bill-edit-message");btn.disabled=true;try{const proposed=JSON.parse($("bill-edit-json").value);if(!Array.isArray(proposed.items)||!proposed.items.length)throw new Error("Items array is required.");const reason=$("bill-edit-reason").value.trim();if(reason.length<3)throw new Error("Please enter an edit reason.");const result=await supabase.rpc("request_billing_edit",{p_transaction_id:id,p_reason:reason,p_proposed_payload:proposed});if(result.error)throw result.error;msg.textContent="Edit request sent to Admin.";await loadRecentBills();}catch(e){msg.textContent=e.message||"Unable to process edit.";}finally{btn.disabled=false;}};
    return;
  }
  editingBillId=id;
  billingRows=(items||[]).map(it=>{
    const snap=it.pricing_snapshot||{},svc=services.find(x=>x.id===it.service_id),special=isPaperPageService(svc);
    return {service_id:it.service_id,base:String(snap.base_amount??0),charge:String(snap.service_charge??""),cost:String(it.processing_unit_cost??0),bank:snap.bank||"",selected_upi_to_cash_wallet_id:snap.upi_to_cash_wallet_id||"",quantity:Number(it.quantity||1),unit_count:special?String(snap.unit_count||""):"",sets:special?Number(snap.sets||1):1,item_label:snap.item_label||"",discount:Number(snap.discount_amount||0),wallet_debits:snap.wallet_debits||[],charge_percent:snap.charge_percent??svc?.billing_config?.charge_percent??2,profit_wallet_id:snap.profit_wallet_id||"",bill_count:1,bill_amounts:[""]};
  });
  $("bill-count").value=Math.max(1,billingRows.length);await setBillingRows(billingRows.length);
  $("bill-customer").value=payload.customer_name||"";$("bill-phone").value=payload.customer_phone||"";
  $("bill-mode").value=payload.payment_mode||"cash";$("bill-received").value=payload.amount_received;
  $("bill-cash").value=payload.cash_received;$("bill-upi").value=payload.upi_received;
  updatePaymentFields();updateBillingTotals();
  $("save-billing").textContent="Save changes to Bill";$("billing-message").textContent="Editing existing bill. Review the details and save changes.";
  $("other-view").scrollIntoView({behavior:"smooth",block:"start"});
}

async function renderEditApprovals(reqs){
  const host=$("recent-bills");if(!host)return;
  const pending=(reqs||[]).filter(r=>r.status==="pending");
  const wrap=document.createElement("div");wrap.className="admin-table-wrap";
  wrap.innerHTML='<h3>Pending bill edit approvals</h3><div id="pending-edit-rows"></div><h3 style="margin-top:18px">Recent edit audit</h3><div id="billing-audit-rows"></div>';
  host.append(wrap);
  $("pending-edit-rows").innerHTML=pending.length?pending.map(r=>`<div class="admin-service-row"><div class="admin-service-main"><strong>Bill edit request</strong><small>${escapeHtml(r.reason)} · ${new Date(r.created_at).toLocaleString("en-IN")}</small></div><div class="admin-service-meta"><span>${r.transaction_id.slice(0,8)}</span></div><div class="admin-service-actions"><button data-review-edit="${r.id}" data-approve="true">Approve</button><button data-review-edit="${r.id}" data-approve="false">Reject</button></div></div>`).join(""):'<div class="empty-state">No pending requests.</div>';
  document.querySelectorAll("[data-review-edit]").forEach(b=>b.addEventListener("click",async()=>{
    const note=prompt(b.dataset.approve==="true"?"Optional approval note":"Reason for rejection")||null;
    const {error}=await supabase.rpc("review_billing_edit",{p_request_id:b.dataset.reviewEdit,p_approve:b.dataset.approve==="true",p_note:note});
    if(error)alert(error.message);else await loadRecentBills();
  }));
  const {data:audit,error}=await supabase.from("billing_audit_log").select("transaction_id,action,note,created_at").order("created_at",{ascending:false}).limit(15);
  $("billing-audit-rows").innerHTML=error?'<div class="empty-state">Audit history unavailable.</div>':(audit||[]).map(a=>`<div class="admin-service-row"><div class="admin-service-main"><strong>${escapeHtml(a.action)}</strong><small>${escapeHtml(a.note||"")} · ${new Date(a.created_at).toLocaleString("en-IN")}</small></div><div class="admin-service-meta">${a.transaction_id.slice(0,8)}</div></div>`).join("")||'<div class="empty-state">No audit entries.</div>';
}
async function applyApprovedEdit(transactionId,requestId){
  const {data,error}=await supabase.from("billing_edit_requests").select("proposed_payload").eq("id",requestId).single();
  if(error){alert(error.message);return;}
  const result=await supabase.rpc("update_bill_with_approval",{p_transaction_id:transactionId,p_payload:data.proposed_payload,p_edit_request_id:requestId});
  if(result.error)alert(result.error.message);else{alert("Approved edit applied. Wallet and profit entries recalculated.");await loadRecentBills();}
}

const {data:{session}} = await supabase.auth.getSession();
if(session?.user) await showApp(session.user);


async function renderQuickLinks() {
  const host=$("other-view");
  const admin=currentProfile?.role==="admin";
  const {data:links,error}=await supabase.from("quick_links")
    .select("id,name,url,category,is_active,sort_order,logo_url,logo_path").order("sort_order").order("name");
  if(error){
    host.innerHTML='<div class="empty-panel"><h2>Quick Links</h2><p>Unable to load saved websites. Please refresh or contact Admin.</p></div>';
    console.error(error); return;
  }
  const visible=(links||[]).filter(x=>admin||x.is_active);
  host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">WORKSPACE TOOLS</div><h2>Daily Use Websites</h2><p>Open approved work portals in a new browser tab. Your SLV dashboard stays open.</p></div></div>
    ${admin?`<div class="admin-editor quick-link-editor"><h3>Manage websites</h3>
      <form id="quick-link-form" class="quick-link-form">
        <label>Website name<input id="quick-link-name" maxlength="80" required placeholder="e.g. CSC Digital Seva"></label>
        <label>Website URL<input id="quick-link-url" type="url" required placeholder="https://example.gov.in"></label>
        <label>Category<input id="quick-link-category" maxlength="50" value="General" placeholder="Government Services"></label>
        <label>Website logo<input id="quick-link-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
        <button class="primary-btn" type="submit">+ Add Website</button>
      </form>
    </div>`:''}
    <div class="quick-link-grid">
      ${visible.length?visible.map(link=>`<article class="quick-link-card">
        <div class="quick-link-mark">${link.logo_url?`<img src="${escapeHtml(link.logo_url)}" alt="" style="width:42px;height:42px;object-fit:contain">`:"↗"}</div><div class="quick-link-info"><strong>${escapeHtml(link.name)}</strong><small>${escapeHtml(link.category||"General")}</small></div>
        <a class="primary-btn quick-link-open" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">Open Website ↗</a>
        ${admin?`<div class="quick-link-admin"><span>${link.is_active?"Active":"Hidden for employees"}</span><label class="secondary-btn">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-link-logo="${link.id}" style="display:none"></label><button type="button" class="secondary-btn" data-link-toggle="${link.id}" data-active="${link.is_active}">${link.is_active?"Hide":"Show"}</button><button type="button" class="danger-btn" data-link-delete="${link.id}">Delete</button></div>`:''}
      </article>`).join(""):'<div class="empty-state">No websites are available yet. Ask Admin to add a website.</div>'}
    </div>
    <div class="quick-link-note"><strong>Customer form assistance:</strong> External portals may block automatic form filling. For security, enter passwords, OTPs and CAPTCHA directly on the official website. Never save CSC login credentials here.</div>`;
  if(admin){
    $("quick-link-form").addEventListener("submit",async e=>{
      e.preventDefault();
      const name=$("quick-link-name").value.trim(),url=$("quick-link-url").value.trim(),category=$("quick-link-category").value.trim()||"General";
      let parsed;try{parsed=new URL(url)}catch{return alert("Enter a valid website URL.");}
      if(parsed.protocol!=="https:")return alert("Only secure HTTPS websites are allowed.");
      const {data:saved,error:saveError}=await supabase.from("quick_links").insert({name,url:parsed.href,category,created_by:(await supabase.auth.getUser()).data.user?.id}).select("id").single();
      if(saveError){alert("Could not add website: "+saveError.message);return;}
      const logoFile=$("quick-link-logo").files[0];
      if(logoFile){
        if(!["image/png","image/jpeg","image/webp","image/svg+xml"].includes(logoFile.type)||logoFile.size>5*1024*1024){alert("Choose PNG/JPG/WEBP/SVG logo under 5 MB.");return;}
        const path="quick-links/"+saved.id+"/"+Date.now()+"-"+logoFile.name.replace(/[^a-zA-Z0-9._-]/g,"_");
        const up=await supabase.storage.from("quick-link-logos").upload(path,logoFile,{upsert:true,contentType:logoFile.type});
        if(up.error){alert("Website saved, but logo upload failed: "+up.error.message);await renderQuickLinks();return;}
        const publicUrl=supabase.storage.from("quick-link-logos").getPublicUrl(path).data.publicUrl;
        const upd=await supabase.from("quick_links").update({logo_path:path,logo_url:publicUrl}).eq("id",saved.id);
        if(upd.error)alert("Website saved, but logo link update failed: "+upd.error.message);
      }
      await renderQuickLinks();
    });
    host.querySelectorAll("[data-link-logo]").forEach(input=>input.addEventListener("change",async()=>{
      const file=input.files?.[0];if(!file)return;
      if(!["image/png","image/jpeg","image/webp","image/svg+xml"].includes(file.type)||file.size>5*1024*1024){alert("Choose PNG/JPG/WEBP/SVG logo under 5 MB.");return;}
      const id=input.dataset.linkLogo,path="quick-links/"+id+"/"+Date.now()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      const up=await supabase.storage.from("quick-link-logos").upload(path,file,{upsert:true,contentType:file.type});
      if(up.error){alert(up.error.message);return;}
      const publicUrl=supabase.storage.from("quick-link-logos").getPublicUrl(path).data.publicUrl;
      const upd=await supabase.from("quick_links").update({logo_path:path,logo_url:publicUrl}).eq("id",id);
      if(upd.error){alert(upd.error.message);return;}await renderQuickLinks();
    }));
    host.querySelectorAll("[data-link-toggle]").forEach(btn=>btn.addEventListener("click",async()=>{
      const {error:updateError}=await supabase.from("quick_links").update({is_active:btn.dataset.active!=="true"}).eq("id",btn.dataset.linkToggle);
      if(updateError){alert("Could not update website.");return;} await renderQuickLinks();
    }));
    host.querySelectorAll("[data-link-delete]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!confirm("Delete this website link?"))return;
      const {error:deleteError}=await supabase.from("quick_links").delete().eq("id",btn.dataset.linkDelete);
      if(deleteError){alert("Could not delete website.");return;} await renderQuickLinks();
    }));
  }
}

function renderPanApplications(){
 const host=$("other-view"),key="slv_pan_local_v1";
 const read=()=>{try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return []}};
 const write=a=>localStorage.setItem(key,JSON.stringify(a));
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const age=d=>{if(!d)return null;const b=new Date(d+"T00:00:00"),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))a--;return a};
 const addressFields=(prefix,label)=>[
  [prefix+"_country",label+" – Country / Region","India"],[prefix+"_flat",label+" – Flat / Door / Building",""],
  [prefix+"_road",label+" – Road / Street / Block / Sector",""],[prefix+"_pin",label+" – PIN / ZIP",""],
  [prefix+"_post",label+" – Post Office",""],[prefix+"_area",label+" – Area / Locality",""],
  [prefix+"_district",label+" – District",""],[prefix+"_state",label+" – State","Andhra Pradesh"]
 ];
 const field=(name,label,type="text",required=false,placeholder="")=>'<label>'+esc(label)+(required?' *':'')+'<input name="'+name+'" type="'+type+'" '+(required?'required':'')+' placeholder="'+esc(placeholder)+'"></label>';
 const select=(name,label,opts,required=false)=>'<label>'+esc(label)+(required?' *':'')+'<select name="'+name+'" '+(required?'required':'')+'><option value="">Select</option>'+opts.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("")+'</select></label>';
 const group=(title,body,desc="")=>'<section class="pan-section" style="margin:18px 0;padding:16px;border:1px solid #d8d8d8;border-radius:10px"><h3>'+title+'</h3>'+(desc?'<p class="muted">'+desc+'</p>':'')+'<div class="pan-grid">'+body+'</div></section>';
 const addr=(prefix,label)=>addressFields(prefix,label).map(([n,l,v])=>field(n,l,"text",n==="res_pin",v)).join("");
 host.innerHTML='<h2>PAN Applications</h2><p>New PAN Form 93 · Correction CR-01 · Full applicant details · Local device records</p><div class="pan-tabs"><button id="pan-new">New PAN – Form 93</button><button id="pan-corr">Correction – CR-01</button><button id="pan-search">Search / Link Ack</button></div><div id="pan-work"></div>';
 const root=$("pan-work");
 async function printLegacy(r){
  // Retained temporarily as a fallback while the HTML overlay preview is validated.
  const btn=document.querySelector('#pan-form button[type="submit"]'),original=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent="Preparing legacy preview…";}
  try{await showPanPreview("",r)}finally{if(btn){btn.disabled=false;btn.textContent=original||"Save Details & Preview Form"}}
 }
 async function print(r){await loadForm93LayoutSettings();return showForm93HtmlPreview(r)}
let form93LayoutSettings={};
let form93ApplicantLayoutSettings={};
function applicantLayoutStorageKey(r){return "slv_form93_applicant_layout_v1_"+String(r?.temp_ack||"").replace(/[^a-zA-Z0-9_-]/g,"_")}
async function loadApplicantLayoutSettings(r){form93ApplicantLayoutSettings={};const {data,error}=await supabase.from("form93_applicant_layout_settings").select("settings").eq("temp_ack",r?.temp_ack||"").maybeSingle();if(error){console.warn("Applicant layout cloud load failed",error);try{form93ApplicantLayoutSettings=JSON.parse(localStorage.getItem(applicantLayoutStorageKey(r))||"{}")}catch{}return form93ApplicantLayoutSettings}form93ApplicantLayoutSettings=data?.settings||{};return form93ApplicantLayoutSettings}
async function saveApplicantLayoutSettings(r){const {data:{user}}=await supabase.auth.getUser();const {error}=await supabase.from("form93_applicant_layout_settings").upsert({temp_ack:r?.temp_ack||"",settings:form93ApplicantLayoutSettings,updated_by:user?.id||null,updated_at:new Date().toISOString()},{onConflict:"temp_ack"});if(error)throw error;localStorage.setItem(applicantLayoutStorageKey(r),JSON.stringify(form93ApplicantLayoutSettings))}
async function loadForm93LayoutSettings(){
 const {data,error}=await supabase.from("form93_layout_settings").select("settings").eq("id","default").maybeSingle();
 if(error){console.warn("Form 93 layout settings unavailable",error);return form93LayoutSettings;}
 form93LayoutSettings=data?.settings||{};return form93LayoutSettings;
}
async function saveForm93LayoutSettings(){
 const {data:{user}}=await supabase.auth.getUser();
 const {error}=await supabase.from("form93_layout_settings").upsert({id:"default",settings:form93LayoutSettings,updated_by:user?.id||null,updated_at:new Date().toISOString()},{onConflict:"id"});
 if(error)throw error;
}
async function showForm93HtmlPreview(r){
  await loadApplicantLayoutSettings(r);
  const previous=$("pan-preview-overlay");if(previous)previous.remove();
  const overlay=document.createElement("div");overlay.id="pan-preview-overlay";overlay.className="pan-preview-overlay";
  overlay.innerHTML='<section class="pan-preview-modal" role="dialog" aria-modal="true" aria-label="PAN Form 93 preview"><header class="pan-preview-header"><div><strong>Form 93 Preview · HTML overlay</strong><small>'+esc(r.name||"Applicant")+' · '+esc(r.temp_ack||"")+'</small></div><div class="pan-preview-actions"><button type="button" class="secondary-btn" id="pan-preview-back">← Back</button><button type="button" class="secondary-btn" id="pan-preview-zoom-out" aria-label="Zoom out">−</button><span id="pan-preview-zoom-label" style="min-width:42px;text-align:center;font-size:12px">100%</span><button type="button" class="secondary-btn" id="pan-preview-zoom-in" aria-label="Zoom in">+</button><button type="button" class="secondary-btn" id="pan-preview-zoom-reset">100%</button><button type="button" class="secondary-btn" id="pan-preview-print" disabled>Print</button></div></header><div class="pan-preview-pages" id="pan-preview-pages"><p class="pan-preview-loading">Loading official Form 93 background…</p></div></section>';
  if(!document.getElementById("pan-form-roboto-font")){const fontLink=document.createElement("link");fontLink.id="pan-form-roboto-font";fontLink.rel="stylesheet";fontLink.href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap";document.head.appendChild(fontLink)}
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();overlay.querySelector("#pan-preview-back").onclick=close;overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
  let previewZoom=100;const applyPreviewZoom=()=>{const pages=overlay.querySelector("#pan-preview-pages");if(pages)pages.style.zoom=String(previewZoom/100);overlay.querySelector("#pan-preview-zoom-label").textContent=previewZoom+"%"};overlay.querySelector("#pan-preview-zoom-out").onclick=()=>{previewZoom=Math.max(50,previewZoom-10);applyPreviewZoom()};overlay.querySelector("#pan-preview-zoom-in").onclick=()=>{previewZoom=Math.min(160,previewZoom+10);applyPreviewZoom()};overlay.querySelector("#pan-preview-zoom-reset").onclick=()=>{previewZoom=100;applyPreviewZoom()};
  const key=e=>{if(e.key==="Escape"&&$("pan-preview-overlay")){close();document.removeEventListener("keydown",key)}};document.addEventListener("keydown",key);
  try{
   if(!window.pdfjsLib)await new Promise((resolve,reject)=>{const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";sc.onload=resolve;sc.onerror=()=>reject(new Error("Preview engine could not load"));document.head.appendChild(sc)});
   window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
   const response=await fetch("https://fvjtbefsuzhrjimpmdop.supabase.co/functions/v1/form93-template");if(!response.ok)throw new Error("Official Form 93 template unavailable");
   const bytes=await response.arrayBuffer(),doc=await window.pdfjsLib.getDocument({data:bytes}).promise,pagesEl=overlay.querySelector("#pan-preview-pages");pagesEl.innerHTML="";
   const pageModels=[];
   for(let n=1;n<=Math.min(2,doc.numPages);n++){
    const page=await doc.getPage(n),vp=page.getViewport({scale:1.5}),canvas=document.createElement("canvas");canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);canvas.className="pan-html-page-bg";
    await page.render({canvasContext:canvas.getContext("2d"),viewport:vp}).promise;
    const wrap=document.createElement("div");wrap.className="pan-html-page";wrap.style.aspectRatio=vp.width+"/"+vp.height;wrap.appendChild(canvas);
    const layer=document.createElement("div");layer.className="pan-html-overlay";wrap.appendChild(layer);pagesEl.appendChild(wrap);
    pageModels.push({page,wrap,layer,width:vp.width,height:vp.height,scale:vp.scale});
   }
   const correction=13.5,cellW=10.62,cellH=13.7;let activeLayoutKey="",activeWordKey="",activeLetterKey="",activeLetterNumber=0;
   const put=(pi,x,top,w,h,content,cls="pan-html-text")=>{
    const m=pageModels[pi];if(!m||content===null||content===undefined||(String(content)===""&&cls!=="pan-html-photo"&&cls!=="pan-html-space-marker"))return null;
    const el=document.createElement("div");el.className=cls;el.dataset.layoutKey=activeLayoutKey||("p"+pi+"-"+Math.round(x*10)+"-"+Math.round(top*10));
    if(activeWordKey)el.dataset.layoutWord=activeWordKey;if(activeLetterKey){el.dataset.layoutLetter=activeLetterKey;el.dataset.letterNumber=String(activeLetterNumber??1)}
    const fieldOff=form93LayoutSettings[el.dataset.layoutKey]||{},wordOff=activeWordKey?(form93LayoutSettings[activeWordKey]||{}):{},letterOff=activeLetterKey?(form93LayoutSettings[activeLetterKey]||{}):{};
    el.style.left=((x+Number(fieldOff.dx||0)+Number(wordOff.dx||0)+Number(letterOff.dx||0))*m.scale/m.width*100)+"%";el.style.top=((top+Number(fieldOff.dy||0)+Number(wordOff.dy||0)+Number(letterOff.dy||0)+correction)*m.scale/m.height*100)+"%";el.style.width=(w*m.scale/m.width*100)+"%";el.style.height=(h*m.scale/m.height*100)+"%";el.textContent=String(content);el.style.fontWeight="700";m.layer.appendChild(el);return el;
   };
   const setBaseFont=(el,pi,size)=>{if(!el)return;el.dataset.baseFont=String(size);el.dataset.pageIndex=String(pi);const f=form93LayoutSettings[el.dataset.layoutKey]||{},w=form93LayoutSettings[el.dataset.layoutWord]||{},c=form93LayoutSettings[el.dataset.layoutLetter]||{};el.style.fontSize=(Number(c.size??w.size??f.size??size)*mScale(pageModels[pi]))+"px"};
   const text=(pi,x,top,value,w=120,size=6)=>{const prior=activeLayoutKey;activeLayoutKey="p"+pi+"-"+Math.round(x*10)+"-"+Math.round(top*10);const el=put(pi,x,top,w,12,value);activeLayoutKey=prior;if(el)setBaseFont(el,pi,size*1.12)};
   const mScale=m=>m.width/(m.page.view[2]-m.page.view[0]);
   const aadhaarNameGrid=(value)=>{const prior=activeLayoutKey,priorWord=activeWordKey,priorLetter=activeLetterKey,priorNumber=activeLetterNumber,base="p0-1800-2383";activeLayoutKey=base;const chars=Array.from({length:25},(_,i)=>[...String(value??"").toUpperCase()].slice(0,25)[i]||"");const step=Math.min(nameSpacing(),375/Math.max(chars.length,1));let wordIndex=0;chars.forEach((ch,i)=>{const isSpace=!ch||/\s/.test(ch);activeLetterNumber=i+1;activeWordKey=base+"-w"+wordIndex;activeLetterKey=base+"-c"+i;if(isSpace){const gap=put(0,180+i*step,238.3,nameCellW,cellH," ","pan-html-space-marker");if(gap){gap.style.color="transparent";gap.style.opacity="0";gap.setAttribute("aria-label","Space position "+(i+1))}wordIndex++;return}const el=put(0,180+i*step,238.3,nameCellW,cellH,ch,"pan-html-char");if(el)setBaseFont(el,0,5.9)});activeLayoutKey=prior;activeWordKey=priorWord;activeLetterKey=priorLetter;activeLetterNumber=priorNumber};
   const grid=(pi,x,top,value,cols=36,cw=cellW,size=5.4,letterStep=cw)=>{
    const prior=activeLayoutKey,priorWord=activeWordKey,priorLetter=activeLetterKey,priorNumber=activeLetterNumber,base="p"+pi+"-"+Math.round(x*10)+"-"+Math.round(top*10);activeLayoutKey=base;
    let wordIndex=0;Array.from({length:cols},(_,i)=>[...String(value??"").toUpperCase()][i]||"").forEach((ch,i)=>{const isSpace=!ch||/\s/.test(ch);activeLetterNumber=i+1;activeWordKey=base+"-w"+wordIndex;activeLetterKey=base+"-c"+i;if(isSpace){const spacer=put(pi,x+i*letterStep,top,cw,cellH," ","pan-html-space-marker");if(spacer){spacer.style.color="transparent";spacer.style.opacity="0";spacer.setAttribute("aria-label","Space position "+(i+1))}wordIndex++;return}const el=put(pi,x+i*letterStep,top,cw,cellH,ch,"pan-html-char");if(el)setBaseFont(el,pi,size)});
    activeLayoutKey=prior;activeWordKey=priorWord;activeLetterKey=priorLetter;activeLetterNumber=priorNumber;
   };
   const nameCellW=15;const nameSpacing=()=>({compact:12,normal:15,expand:18}[form93LayoutSettings.__nameSpacing||"normal"]||15);const nameGrid=(pi,x,top,value,cols=25,size=5.2)=>{const chars=[...String(value??"").toUpperCase()].slice(0,cols);const step=Math.min(nameSpacing(),375/Math.max(cols,1));grid(pi,x,top,value,cols,nameCellW,size,step)};const name=(pi,top,value)=>{const words=String(value||"").trim().replace(/\s+/g," ").split(" ").filter(Boolean);[words[0]||"",words[1]||"",words.slice(2).join(" ")].forEach((v,i)=>nameGrid(pi,180,top+i*13.7-1.2,v,25,i===0?5.0:5.2))};
   const addr=(pi,p,top)=>{["flat","road","post","area","district"].forEach((k,i)=>grid(pi,180,top+i*13.7-2.5,r[p+"_"+k],25,15,5.4));grid(pi,132,top+5*13.7-2.5,r[p+"_state"],8,cellW,5.2);grid(pi,285,top+5*13.7-2.5,r[p+"_country"]||"India",12,cellW,5.2);grid(pi,455,top+5*13.7-2.5,r[p+"_pin"],10,cellW,5.2)};
   const mark=(pi,x,top)=>{const el=put(pi,x,top,10,12,"✓","pan-html-mark");if(el)setBaseFont(el,pi,8);return el};
   // Page 1: applicant identity and contact.
   const applicantParts=[r.name_first,r.name_middle,r.name_last];
   applicantParts.forEach((part,i)=>nameGrid(0,180,183.5+i*13.7-1.2,part,25,i===0?5.0:5.2));
   aadhaarNameGrid(r.name_as_aadhaar||r.name);
   mark(0,({Male:183,Female:229,Transgender:290})[r.gender]||183,280.5);
   if(r.dob){const [yy,mm,dd]=r.dob.split("-");[dd,mm,yy].forEach((part,i)=>grid(0,181+[0,44,84][i],291.5,part,4,15,6.5))}
   grid(0,185,307,r.aadhaar,12,10.62,5.8);addr(0,"res",342);if(r.office_flat||r.office_road||r.office_pin)addr(0,"office",435);
   mark(0,({Resident:213,"Non-resident":275,"Resident but not ordinarily resident":352})[r.residential_status]||213,523);
   text(0,345,547,r.passport,160,5.8);text(0,345,563,r.tin,180,5.8);
   grid(0,240,598,"91",3);grid(0,375,598,r.mobile,10);text(0,150,610,r.email,380,5.8);grid(0,240,624,String(r.landline||"").replace(/\D/g,""),4);
   const inc={"Salary":[181,637],"Income from Business / Profession":[258,637],"Income from House Property":[397,637],"Capital Gains":[181,652],"Income from Other Sources":[258,652],"No Income":[397,652]};(r.income_sources||[]).forEach(v=>{if(inc[v])mark(0,inc[v][0],inc[v][1])});
   mark(0,r.single_parent==="Yes"?243:304,675);name(0,698,[r.father_first,r.father_middle,r.father_last].filter(Boolean).join(" "));
   // Page 2: mother, AO, RA, proof and declaration.
   name(1,9.5,[r.mother_first,r.mother_middle,r.mother_last].filter(Boolean).join(" "));mark(1,r.parent==="Father"?335:397,53.5);
   text(1,235,93.5,r.ao_area,45,5.8);text(1,395,93.5,r.ao_type,32,5.8);text(1,235,107.5,r.ao_range,45,5.8);text(1,395,107.5,r.ao_number,32,5.8);
   name(1,155,r.ra_name);text(1,180,196,r.ra_pan,160,5.8);grid(1,280,211,r.ra_aadhaar,12);
   addr(1,"ra",240);grid(1,240,339.5,"91",3);grid(1,355,339.5,r.ra_mobile,10);text(1,240,353.5,r.ra_email,350,5.8);grid(1,240,367.5,r.ra_landline,16);
   mark(1,({Residence:216,"Representative Assessee Address":302,Office:448})[r.communication_address]||367,402.5);
   const px=[70,169,270,70,169],proof=["proof_identity","proof_address","proof_dob","ra_proof_identity","ra_proof_address"];proof.forEach((k,i)=>{if(r[k])mark(1,px[i],460.5+(i>=3?37:0))});
   text(1,110,547.5,r.declarant_name,220,6);text(1,110,608.5,r.place,140,6);text(1,110,623.5,r.declaration_date,140,6);text(1,390,766,r.declarant_name,125,6);text(1,410,793,r.declarant_designation,105,6);
   const addImage=(pi,x,top,w,h,data)=>{if(!data)return;const el=put(pi,x,top-correction,w,h,"","pan-html-photo");el.style.backgroundImage="url("+data+")"};
   addImage(0,46,23,100,128,r.photo);addImage(0,443,23,100,128,r.photo);addImage(0,49,108,94,30,r.signature);addImage(1,329,620,200,65,r.signature);
   if(currentProfile?.role==="admin"){
    const tools=document.createElement("div");tools.className="pan-calibration-toolbar";tools.innerHTML='<button type="button" class="secondary-btn" id="pan-calibrate-toggle">Adjust field positions</button><select id="pan-calibrate-mode" class="secondary-btn" aria-label="Adjustment mode"><option value="field">Whole field</option><option value="word">Each word</option><option value="letter" selected>Each letter / space</option></select><select id="pan-name-spacing" class="secondary-btn" aria-label="Name letter spacing"><option value="normal">Normal spacing</option><option value="compact">Compress letters</option><option value="expand">Expand letters</option></select><select id="pan-calibrate-size" class="secondary-btn" aria-label="Lettering size"><option value="4">Size 4</option><option value="5">Size 5</option><option value="6" selected>Size 6</option><option value="7">Size 7</option><option value="8">Size 8</option></select><button type="button" class="secondary-btn" id="pan-calibrate-apply-size" disabled>Apply size to selected</button><button type="button" class="secondary-btn" id="pan-calibrate-save" hidden>Save layout</button><button type="button" class="secondary-btn" id="pan-calibrate-reset" hidden>Reset positions</button><small id="pan-calibrate-help">Admin only: choose Each letter / space. Example: RA MA = 1, 2, 3, 4, 5. Space stays blank but keeps its own number.</small>';overlay.querySelector(".pan-preview-header").after(tools);
    let calibration=true,drag=null;
    const toggle=tools.querySelector("#pan-calibrate-toggle"),save=tools.querySelector("#pan-calibrate-save"),reset=tools.querySelector("#pan-calibrate-reset");
    const handles=[],modeSelect=tools.querySelector("#pan-calibrate-mode"),sizeSelect=tools.querySelector("#pan-calibrate-size"),applySize=tools.querySelector("#pan-calibrate-apply-size"),spacingSelect=tools.querySelector("#pan-name-spacing");spacingSelect.value=form93LayoutSettings.__nameSpacing||"normal";spacingSelect.addEventListener("change",()=>{form93LayoutSettings.__nameSpacing=spacingSelect.value;overlay.remove();showForm93HtmlPreview(r)});let selectedCalibration=null;
    const makeHandles=()=>{
      handles.forEach(h=>h.remove());handles.length=0;
      const mode=modeSelect.value,attr=mode==="letter"?"layoutLetter":mode==="word"?"layoutWord":"layoutKey";
      pageModels.forEach(m=>{
        const groups=new Map();
        m.layer.querySelectorAll("[data-layout-key]").forEach(el=>{const k=el.dataset[attr]||el.dataset.layoutKey;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(el)});
        groups.forEach((els,key)=>{
          const rects=els.map(e=>e.getBoundingClientRect()),left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));
          const h=document.createElement("div");h.className="pan-calibration-handle";h.dataset.key=key;
          h.style.left=((left-m.wrap.getBoundingClientRect().left)/m.wrap.clientWidth*100)+"%";h.style.top=((top-m.wrap.getBoundingClientRect().top)/m.wrap.clientHeight*100)+"%";
          h.style.width=Math.max(mode==="letter"?1:2,(right-left)/m.wrap.clientWidth*100)+"%";h.style.height=Math.max(mode==="letter"?0.8:1.5,(bottom-top)/m.wrap.clientHeight*100)+"%";
          const ordinal=Number(els[0]?.dataset.letterNumber||0),ordinalLabel=ordinal?ordinal+(ordinal%100>=11&&ordinal%100<=13?"th":({1:"st",2:"nd",3:"rd"}[ordinal%10]||"th"))+" letter":"";const isSpace=els[0]?.classList.contains("pan-html-space-marker");if(mode==="letter"){h.dataset.number=String(ordinal);if(isSpace)h.dataset.kind="space";h.textContent=String(ordinal);h.style.cssText+=";display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:2px solid #d97706;background:rgba(255,247,237,.96);color:#111827;font-size:11px;font-weight:800;line-height:1;border-radius:3px;min-width:18px;min-height:18px;z-index:50;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,.25);"}h.title=mode==="letter"?(isSpace?"Position "+ordinal+" · SPACE (blank cell) · drag to move":"Position "+ordinal+" · "+ordinalLabel+" · drag to move"):mode==="word"?"Tap to select this word, drag to move":"Tap to select this field, drag to move";h.addEventListener("click",()=>{selectedCalibration={key,els,mode};handles.forEach(x=>x.classList.toggle("selected",x===h));applySize.disabled=false});
          h.addEventListener("pointerdown",e=>{if(!calibration)return;e.preventDefault();h.setPointerCapture(e.pointerId);drag={key,els,startX:e.clientX,startY:e.clientY,dx:0,dy:0}});
          h.addEventListener("pointermove",e=>{if(!drag||drag.key!==key)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;drag.dx=dx;drag.dy=dy;els.forEach(el=>el.style.transform="translate("+dx+"px,"+dy+"px)")});
          h.addEventListener("pointerup",()=>{if(!drag||drag.key!==key)return;const scale=m.scale,prev=form93LayoutSettings[key]||{};form93LayoutSettings[key]={...prev,dx:Number(prev.dx||0)+drag.dx/scale,dy:Number(prev.dy||0)+drag.dy/scale};
            els.forEach(el=>{el.style.transform="";el.style.left=(parseFloat(el.style.left)+drag.dx/m.wrap.clientWidth*100)+"%";el.style.top=(parseFloat(el.style.top)+drag.dy/m.wrap.clientHeight*100)+"%"});drag=null;makeHandles()});
          m.layer.appendChild(h);handles.push(h);
        });
      });
    };
    modeSelect.addEventListener("change",()=>{selectedCalibration=null;applySize.disabled=true;if(calibration)makeHandles()});
    applySize.addEventListener("click",()=>{if(!selectedCalibration)return;const {key,els}=selectedCalibration,prev=form93LayoutSettings[key]||{},size=Number(sizeSelect.value);form93LayoutSettings[key]={...prev,size};els.forEach(el=>{const pi=Number(el.dataset.pageIndex||0);el.style.fontSize=(size*mScale(pageModels[pi]))+"px"});});
    toggle.onclick=()=>{calibration=!calibration;overlay.classList.toggle("pan-calibrating",calibration);toggle.textContent=calibration?"Finish adjusting":"Adjust field positions";save.hidden=!calibration;reset.hidden=!calibration;tools.querySelector("#pan-calibrate-help").textContent=calibration?"Mode: "+modeSelect.options[modeSelect.selectedIndex].text+". Letters and spaces are numbered in order (RA MA = 1, 2, 3, 4, 5). Space stays blank. Drag each numbered box to its matching printed box, then save.":"Admin only: choose Each letter / space to see position numbers. Spaces stay blank but receive their own position number.";if(calibration)makeHandles();else{handles.forEach(h=>h.remove());handles.length=0}};
    save.onclick=async()=>{save.disabled=true;try{await saveForm93LayoutSettings();save.textContent="Saved for all applicants";setTimeout(()=>save.textContent="Save layout",1600)}catch(e){alert("Could not save applicant layout to cloud: "+e.message)}finally{save.disabled=false}};
    reset.onclick=async()=>{if(!confirm("Reset the shared Form 93 layout adjustments for all applicants?"))return;form93LayoutSettings={};try{await saveForm93LayoutSettings();overlay.remove();await print(r)}catch(e){alert("Could not reset applicant layout: "+e.message)}};
    overlay.classList.add("pan-calibrating");toggle.textContent="Finish adjusting";save.hidden=false;reset.hidden=false;tools.querySelector("#pan-calibrate-help").textContent="Admin numbering is ON. Each letter / space has its own number. Drag each numbered box to the matching printed box, then save.";
    makeHandles();
   }
   const printBtn=overlay.querySelector("#pan-preview-print");printBtn.disabled=false;printBtn.onclick=()=>{
    const frame=document.createElement("iframe");frame.style.cssText="position:fixed;width:1px;height:1px;right:0;bottom:0;border:0";document.body.appendChild(frame);
    const d=frame.contentDocument;d.open();d.write('<!doctype html><html><head><title>Form 93</title><style>@page{size:A4;margin:0}body{margin:0}.pan-html-page{position:relative;width:210mm;height:297mm;page-break-after:always;overflow:hidden}.pan-html-page:last-child{page-break-after:auto}.pan-html-page-bg{position:absolute;inset:0;width:100%;height:100%}.pan-html-overlay{position:absolute;inset:0}.pan-html-char,.pan-html-mark,.pan-html-text{position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;font-family:Roboto,Arial,sans-serif;font-weight:500;line-height:1;color:#111;white-space:nowrap}.pan-html-photo{position:absolute;background-size:100% 100%;background-repeat:no-repeat}</style></head><body>');
    pageModels.forEach(m=>{const wrap=m.wrap.cloneNode(true);wrap.querySelectorAll(".pan-calibration-handle").forEach(el=>el.remove());const can=wrap.querySelector("canvas");if(can){const img=d.createElement("img");img.src=can.toDataURL("image/png");img.className="pan-html-page-bg";can.replaceWith(img)}d.body.appendChild(wrap)});d.close();setTimeout(()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),1500)},500);
   };
  }catch(err){console.error(err);overlay.querySelector("#pan-preview-pages").innerHTML='<p class="pan-preview-loading">Preview failed: '+esc(err.message||"Try again")+'</p>'}
 }
 async function showPanPreview(url,r){return showForm93HtmlPreview(r)}

 async function showPanPreview(url,r){
  const previous=$("pan-preview-overlay");
  if(previous){previous.remove();if(previous.dataset.objectUrl)URL.revokeObjectURL(previous.dataset.objectUrl)}
  const overlay=document.createElement("div");
  overlay.id="pan-preview-overlay";overlay.className="pan-preview-overlay";overlay.dataset.objectUrl=url;
  overlay.innerHTML='<section class="pan-preview-modal" role="dialog" aria-modal="true" aria-label="PAN Form 93 preview"><header class="pan-preview-header"><div><strong>Form 93 Preview</strong><small>'+esc(r.name||"Applicant")+' · '+esc(r.temp_ack||"")+'</small></div><div class="pan-preview-actions"><button type="button" class="secondary-btn" id="pan-preview-print" disabled>Print</button><button type="button" class="danger-btn" id="pan-preview-close">Close</button></div></header><div class="pan-preview-pages" id="pan-preview-pages"><p class="pan-preview-loading">Preparing preview…</p></div></section>';
  document.body.appendChild(overlay);
  const close=()=>{overlay.remove();URL.revokeObjectURL(url)};
  overlay.querySelector("#pan-preview-close").addEventListener("click",close);
  overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
  const onKey=e=>{if(e.key==="Escape"&&$("pan-preview-overlay")){close();document.removeEventListener("keydown",onKey)}};
  document.addEventListener("keydown",onKey);
  try{
   if(!window.pdfjsLib)await new Promise((resolve,reject)=>{const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";sc.onload=resolve;sc.onerror=()=>reject(new Error("Preview engine could not load."));document.head.appendChild(sc)});
   window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
   const doc=await window.pdfjsLib.getDocument(url).promise,pages=overlay.querySelector("#pan-preview-pages"),canvases=[];
   pages.innerHTML="";
   for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n),viewport=page.getViewport({scale:1.35}),canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.className="pan-preview-page";
    await page.render({canvasContext:ctx,viewport}).promise;
    pages.appendChild(canvas);canvases.push(canvas);
   }
   const printButton=overlay.querySelector("#pan-preview-print");printButton.disabled=false;
   printButton.addEventListener("click",()=>{
    const frame=document.createElement("iframe");frame.setAttribute("aria-hidden","true");frame.style.cssText="position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0";document.body.appendChild(frame);
    const doc=frame.contentDocument;doc.open();doc.write('<!doctype html><html><head><title>Form 93</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{display:block;width:210mm;height:297mm;object-fit:fill;page-break-after:always}img:last-child{page-break-after:auto}</style></head><body>');
    canvases.forEach(canvas=>{const img=doc.createElement("img");img.src=canvas.toDataURL("image/png");doc.body.appendChild(img)});
    doc.close();
    setTimeout(()=>{try{frame.contentWindow.focus();frame.contentWindow.print()}catch(error){alert("Print could not start. Please try again.")}finally{setTimeout(()=>frame.remove(),1200)}},500);
   });
  }catch(error){
   console.error(error);
   overlay.querySelector("#pan-preview-pages").innerHTML='<p class="pan-preview-loading">Unable to prepare preview: '+esc(error.message||"Please try again.")+'</p>';
  }
 }
 function form(mode){
  const newMode=mode==="new";
  const personal=field("name_first","First name (as per application)","text",true,"Enter the exact First Name")+field("name_middle","Middle name (optional)","text",false,"Leave blank if not applicable")+field("name_last","Last name / Surname (optional)","text",false,"Enter exactly as per application")+'<input type="hidden" name="name" id="pan-full-name">'+field("name_as_aadhaar","Name exactly as per Aadhaar","text",true,"Enter exactly as printed on Aadhaar")+select("gender","Gender",["Male","Female","Transgender"],true)+field("dob","Date of birth","date",true)+field("aadhaar","Aadhaar number (12 digits)","text",true,"12-digit number");
  const contact=field("mobile","Mobile number (10 digits)","tel",true,"Enter all 10 digits")+field("email","Email ID","email",true)+field("landline","Landline with STD code");
  const residence=addr("res","Residence Address");
  const office=addr("office","Office Address (if applicable)");
  const residentialStatusFields=select("residential_status","Residential status",["Resident","Non-resident","Resident but not ordinarily resident"],true)+field("passport","Passport number (mandatory for NRI / RNOR)")+field("tin","TIN in country of residence (if any)");
  const income='<div class="pan-check-grid">'+["Salary","Income from Business / Profession","Income from House Property","Capital Gains","Income from Other Sources","No Income"].map(x=>'<label><input type="checkbox" name="income_sources" value="'+esc(x)+'"> '+esc(x)+'</label>').join("")+'</div>';
  const parents=select("single_parent","Whether mother / father is a single parent?",["Yes","No"],true)+field("father_full","Father full name (First Middle Last)")+field("mother_full","Mother full name (First Middle Last)")+field("father_first","Father – First name")+field("father_middle","Father – Middle name")+field("father_last","Father – Last name")+field("mother_first","Mother – First name")+field("mother_middle","Mother – Middle name")+field("mother_last","Mother – Last name")+select("parent","Parent name to print on PAN card",["Father","Mother"],true);
  const ao=field("ao_area","Area Code")+field("ao_type","AO Type")+field("ao_range","Range Code")+field("ao_number","AO Number");
  const ra=field("ra_name","Representative Assessee full name")+field("ra_pan","RA PAN (if available)")+field("ra_aadhaar","RA Aadhaar (if PAN unavailable)")+select("ra_relation","Relationship / capacity",["Father","Mother","Guardian","Other"])+field("ra_mobile","RA mobile with country code","tel")+field("ra_email","RA email","email")+field("ra_landline","RA landline with STD code")+addr("ra","Representative Assessee Address");
  const communication=select("communication_address","Address for communication",["Residence","Office","Representative Assessee Address"],true);
  const proofs=select("proof_identity","Applicant – Proof of Identity",["Aadhaar","Passport","Voter ID","Driving Licence","Other notified document"],true)+select("proof_address","Applicant – Proof of Address",["Aadhaar","Passport","Voter ID","Driving Licence","Bank statement","Other notified document"],true)+select("proof_dob","Applicant – Proof of Date of Birth",["Birth Certificate","Passport","Driving Licence","Matriculation certificate","Other notified document"],true)+select("ra_proof_identity","RA – Proof of Identity",["Aadhaar","Passport","Voter ID","Driving Licence","Other notified document"])+select("ra_proof_address","RA – Proof of Address",["Aadhaar","Passport","Voter ID","Driving Licence","Bank statement","Other notified document"]);
  const declaration=field("declarant_name","Verifier name (exactly as per Aadhaar)","text",true)+select("declarant_capacity","Capacity",["Self","Representative Assessee"],true)+field("declarant_designation","Designation (if applicable)")+field("place","Place","text",true)+field("declaration_date","Verification date","date",true);
  const correction=mode==="correction"?group("Existing PAN / Correction Details",field("pan","Existing PAN","text",true,"ABCDE1234F")+field("correction","Details to be corrected / requested changes")):"";
  root.innerHTML='<form id="pan-form"><h3>'+(newMode?"New PAN – Form No. 93":"PAN Correction – CR-01")+'</h3><p class="muted">Fields follow the notified Form 93 structure. Enter details exactly as supported by the applicant’s documents.</p>'+correction+
   group("PART A — PERSONAL INFORMATION",personal+residence+office+residentialStatusFields+contact,"Residence address is required. Office address is optional.")+
   group("PART B — SOURCE OF INCOME",income)+group("PART C — DETAILS OF PARENTS",parents)+group("PART D — AO CODE",ao)+
   '<div id="pan-ra-wrap">'+group("PART E — REPRESENTATIVE ASSESSEE (IF APPLICABLE)",ra,"For minors and cases where a Representative Assessee is required. Enter RA details as applicable.")+'</div>'+
   group("PART F — COMMUNICATION ADDRESS",communication)+group("PART G — DOCUMENTS / PROOFS",proofs)+group("VERIFICATION AND DECLARATION",declaration)+
   '<section class="pan-section" style="padding:16px;border:1px solid #d8d8d8;border-radius:10px"><h3>Photograph & Signature</h3><div class="pan-grid"><label>Recent colour photograph (4.5 cm × 3.5 cm)<input id="pan-photo" type="file" accept="image/*"></label><label>Signature / left thumb impression<input id="pan-sign" type="file" accept="image/*"></label></div></section><button class="primary-btn" type="submit">Save Details & Preview Form</button><p id="pan-message"></p></form>';
  const f=$("pan-form");let photo="",signature="";
  // Guided, mobile-friendly entry flow: one Form 93 section per step.
  f.noValidate=true;
  const stepNodes=Array.from(f.children).filter(el=>el.matches(".pan-section")||el.id==="pan-ra-wrap");
  const stepTitles=stepNodes.map(el=>el.querySelector("h3")?.textContent?.trim()||"Additional details");
  const steps=stepNodes.map((el,i)=>{
   const panel=document.createElement("section");panel.className="pan-wizard-step";panel.dataset.step=String(i);
   el.before(panel);panel.appendChild(el);return panel;
  });
  let activeStep=0;
  const wizard=document.createElement("div");wizard.className="pan-wizard";
  wizard.innerHTML='<div class="pan-wizard-top"><div><small>APPLICATION PROGRESS</small><strong id="pan-step-title"></strong></div><span id="pan-step-count"></span></div><div class="pan-wizard-track"><span id="pan-step-progress"></span></div><div class="pan-wizard-dots" id="pan-step-dots"></div>';
  f.insertBefore(wizard,steps[0]);
  const submitButton=f.querySelector('button[type="submit"]');
  const nav=document.createElement("div");nav.className="pan-wizard-nav";
  nav.innerHTML='<button type="button" class="secondary-btn" id="pan-step-back">Back</button><button type="button" class="primary-btn" id="pan-step-next">Continue</button>';
  submitButton.before(nav);
  const renderStep=()=>{
   steps.forEach((step,i)=>{step.hidden=i!==activeStep;});
   $("pan-step-title").textContent=stepTitles[activeStep];
   $("pan-step-count").textContent="Step "+(activeStep+1)+" of "+steps.length;
   $("pan-step-progress").style.width=((activeStep+1)/steps.length*100)+"%";
   $("pan-step-dots").innerHTML=stepTitles.map((t,i)=>'<button type="button" class="pan-step-dot '+(i===activeStep?"active":i<activeStep?"done":"")+'" data-pan-step="'+i+'" aria-label="Go to '+esc(t)+'" title="'+esc(t)+'">'+(i+1)+'</button>').join("");
   $("pan-step-back").disabled=activeStep===0;
   $("pan-step-next").hidden=activeStep===steps.length-1;
   submitButton.hidden=activeStep!==steps.length-1;
   $("pan-step-dots").querySelectorAll("[data-pan-step]").forEach(b=>b.addEventListener("click",()=>{
    const target=Number(b.dataset.panStep);
    if(target<=activeStep){activeStep=target;renderStep();steps[activeStep].scrollIntoView({behavior:"smooth",block:"start"});}
   }));
  };
  const validateStep=step=>{
   const controls=Array.from(step.querySelectorAll("input,select,textarea")).filter(el=>!el.disabled&&!el.closest("[hidden]"));
   for(const el of controls){if(!el.checkValidity()){el.reportValidity();return false;}}
   return true;
  };
  $("pan-step-back").onclick=()=>{if(activeStep>0){activeStep--;renderStep();steps[activeStep].scrollIntoView({behavior:"smooth",block:"start"});}};
  $("pan-step-next").onclick=()=>{if(!validateStep(steps[activeStep]))return;if(activeStep<steps.length-1){activeStep++;renderStep();steps[activeStep].scrollIntoView({behavior:"smooth",block:"start"});}};
  renderStep();
  // Split typed names into First / Middle / Last fields and mirror applicant name to Aadhaar-name field.
  const splitName=value=>{
   const words=String(value||"").trim().replace(/\\s+/g," ").split(" ").filter(Boolean);
   return {first:words[0]||"",middle:words[1]||"",last:words.slice(2).join(" ")};
  };
  const bindNameSplit=(sourceName,prefix)=>{
   const source=f.elements.namedItem(sourceName);
   if(!source)return;
   const targets={first:f.elements.namedItem(prefix+"_first"),middle:f.elements.namedItem(prefix+"_middle"),last:f.elements.namedItem(prefix+"_last")};
   const sync=()=>{
    const parts=splitName(source.value);
    Object.entries(targets).forEach(([key,el])=>{if(el)el.value=parts[key]});
   };
   source.addEventListener("input",sync);source.addEventListener("change",sync);sync();
  };
  const applicantName=f.elements.namedItem("name"),aadhaarName=f.elements.namedItem("name_as_aadhaar");
  const syncApplicantName=()=>{const first=f.elements.namedItem("name_first")?.value.trim()||"",middle=f.elements.namedItem("name_middle")?.value.trim()||"",last=f.elements.namedItem("name_last")?.value.trim()||"";applicantName.value=[first,middle,last].filter(Boolean).join(" ");};
  ["name_first","name_middle","name_last"].forEach(n=>{const el=f.elements.namedItem(n);el?.addEventListener("input",syncApplicantName);el?.addEventListener("change",syncApplicantName)});
  syncApplicantName();
  bindNameSplit("father_full","father");
  bindNameSplit("mother_full","mother");
  ["father_first","father_middle","father_last","mother_first","mother_middle","mother_last"].forEach(n=>{const el=f.elements.namedItem(n);if(el?.closest("label"))el.closest("label").hidden=true});
  // India PIN lookup: fill district, state and matching post office for each address.
  const attachPinLookup=(prefix)=>{
   const pin=f.elements.namedItem(prefix+"_pin");
   if(!pin)return;
   pin.maxLength=6;pin.inputMode="numeric";pin.pattern="[0-9]{6}";
   const district=f.elements.namedItem(prefix+"_district"),state=f.elements.namedItem(prefix+"_state");
   const note=document.createElement("small");note.className="pan-pin-status";note.setAttribute("aria-live","polite");pin.closest("label")?.appendChild(note);
   let lastLookup="";
   const lookup=async()=>{
    const code=pin.value.trim();
    if(!/^\d{6}$/.test(code)){lastLookup="";note.textContent="Enter 6-digit PIN to auto-fill district and state.";return}
    if(lastLookup===code)return;lastLookup=code;note.textContent="Looking up PIN…";
    try{
     const response=await fetch("https://api.postalpincode.in/pincode/"+encodeURIComponent(code));
     if(!response.ok)throw new Error("PIN lookup service unavailable");
     const result=await response.json(),entry=result?.[0];
     if(!entry||entry.Status!=="Success"||!entry.PostOffice?.length)throw new Error("PIN not found");
     const first=entry.PostOffice[0];
     if(district)district.value=first.District||"";
     if(state)state.value=first.State||"";
     note.textContent="District and State filled automatically.";
    }catch(error){lastLookup="";note.textContent=error.message==="PIN not found"?"PIN not found. Check the 6 digits.":"Could not look up PIN. Enter district and state manually."}
   };
   pin.addEventListener("change",lookup);pin.addEventListener("blur",lookup);
  };
  ["res","office","ra"].forEach(attachPinLookup);
  // Safe defaults for commonly used values; identity and proof fields stay applicant-specific.
  const setDefault=(name,value)=>{const el=f.elements.namedItem(name);if(el&&!el.value)el.value=value};
  setDefault("res_country","India");
  setDefault("office_country","India");setDefault("residential_status","Resident");
  setDefault("single_parent","No");setDefault("parent","Father");
  setDefault("communication_address","Residence");setDefault("declarant_capacity","Self");
  const localToday=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
  setDefault("declaration_date",localToday());
  setDefault("ao_area","APR");setDefault("ao_type","W");setDefault("ao_range","116");setDefault("ao_number","1");
  const aadhaarInput=f.elements.namedItem("aadhaar"),mobileInput=f.elements.namedItem("mobile");
  aadhaarInput.maxLength=12;aadhaarInput.inputMode="numeric";aadhaarInput.pattern="[0-9]{12}";aadhaarInput.title="Enter exactly 12 digits";
  mobileInput.maxLength=10;mobileInput.inputMode="numeric";mobileInput.pattern="[0-9]{10}";mobileInput.title="Enter exactly 10 digits (without +91)";
  // Representative Assessee is shown automatically only when DOB indicates the applicant is under 18.
  const raWrap=$("pan-ra-wrap");
  const raBody=raWrap.querySelector(".pan-section");
  const raProofFields=["ra_proof_identity","ra_proof_address"].map(n=>f.elements.namedItem(n)?.closest("label")).filter(Boolean);
  const syncRa=()=>{
   const ageNow=age(f.elements.namedItem("dob").value);
   const show=ageNow!==null&&ageNow<18;
   raBody.hidden=!show;
   raProofFields.forEach(el=>{el.hidden=!show});
   raBody.querySelectorAll("input,select").forEach(el=>{el.required=show&&["ra_name","ra_relation","ra_mobile","ra_email","ra_address","ra_pin"].includes(el.name)});
  };
  f.elements.namedItem("dob").addEventListener("change",syncRa);
  f.elements.namedItem("dob").addEventListener("input",syncRa);
  syncRa();
  // Passport/TIN only displayed for non-resident applicants.
  const passport=f.elements.namedItem("passport"),tin=f.elements.namedItem("tin"),status=f.elements.namedItem("residential_status");
  const nriWrap=document.createElement("div");nriWrap.id="pan-nri-fields";passport.closest("label").before(nriWrap);nriWrap.append(passport.closest("label"),tin.closest("label"));
  const syncNri=()=>{nriWrap.hidden=!status.value||status.value==="Resident"};status.addEventListener("change",syncNri);syncNri();
  // Optional office address is collapsed until requested.
  const officeFields=["office_country","office_flat","office_road","office_pin","office_post","office_area","office_district","office_state"].map(n=>f.elements.namedItem(n)?.closest("label")).filter(Boolean);
  if(officeFields.length){const details=document.createElement("details");details.className="pan-optional";details.innerHTML="<summary>Add office address (optional)</summary>";officeFields[0].before(details);officeFields.forEach(el=>details.appendChild(el))}

  const load=(file,cb)=>{if(!file)return;const rd=new FileReader();rd.onload=()=>cb(rd.result);rd.readAsDataURL(file)};
  $("pan-photo").onchange=e=>load(e.target.files[0],v=>photo=v);$("pan-sign").onchange=e=>load(e.target.files[0],v=>signature=v);
  f.onsubmit=async e=>{
   e.preventDefault();
   steps.forEach(step=>step.hidden=false);
   for(let i=0;i<steps.length;i++){if(!validateStep(steps[i])){activeStep=i;renderStep();steps[i].scrollIntoView({behavior:"smooth",block:"start"});return;}}
   const fd=new FormData(f),r=Object.fromEntries(fd.entries());r.income_sources=fd.getAll("income_sources");r.income_sources_text=r.income_sources.join(", ");
   if(!/^\d{12}$/.test((r.aadhaar||"").trim()))return alert("Aadhaar number must contain exactly 12 digits. Form cannot be saved without all 12 digits.");
   if(!/^\d{10}$/.test((r.mobile||"").trim()))return alert("Mobile number must contain exactly 10 digits (without +91). Form cannot be saved without all 10 digits.");
   r.name=[r.name_first,r.name_middle,r.name_last].map(v=>(v||"").trim()).filter(Boolean).join(" ");r.father=[r.father_first,r.father_middle,r.father_last].filter(Boolean).join(" ");r.mother=[r.mother_first,r.mother_middle,r.mother_last].filter(Boolean).join(" ");
   const applicantAge=age(r.dob),isMinor=applicantAge!==null&&applicantAge<18;
   if(!isMinor){["ra_name","ra_pan","ra_aadhaar","ra_relation","ra_mobile","ra_email","ra_landline","ra_address","ra_post","ra_area","ra_district","ra_state","ra_country","ra_pin"].forEach(k=>r[k]="");}

   if(r.res_pin&&!/^\d{6}$/.test(r.res_pin))return alert("Residence PIN must contain 6 digits.");
   if(r.office_pin&&!/^\d{6}$/.test(r.office_pin))return alert("Office PIN must contain 6 digits.");
   if(r.ra_aadhaar&&!/^\d{12}$/.test(r.ra_aadhaar.replace(/\s/g,"")))return alert("RA Aadhaar must contain 12 digits.");
   if(r.ra_pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(r.ra_pan.toUpperCase()))return alert("Enter a valid RA PAN.");
   if(isMinor&&(!r.ra_name||!r.ra_relation||!r.ra_mobile||!r.ra_email||!r.ra_address||!r.ra_state||!r.ra_pin))return alert("Minor applicant: complete all Representative Assessee details.");
   if(isMinor&&!r.ra_pan&&!r.ra_aadhaar)return alert("Minor applicant: enter RA PAN or RA Aadhaar.");
   if(mode==="correction"&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test((r.pan||"").toUpperCase()))return alert("Enter a valid existing PAN.");
   if(r.residential_status!=="Resident"&&(!r.passport||!r.passport.trim()))return alert("Passport number is mandatory for Non-resident / RNOR applicants.");
   if(!r.income_sources.length)return alert("Select at least one source of income.");
   if(r.single_parent==="Yes"&&!r.parent)return alert("Select the parent name to print on PAN.");
   if(r.declarant_capacity==="Self"&&!r.declarant_name.trim())return alert("Enter declaration name.");
   r.mode=mode;r.kind=age(r.dob)!==null&&age(r.dob)<18?"Minor":"Adult";r.ra_required=r.kind==="Minor"||Boolean(r.ra_name||r.ra_pan||r.ra_aadhaar);r.photo=photo;r.signature=signature;
   const n=Number(localStorage.getItem("slv_pan_seq")||0)+1;localStorage.setItem("slv_pan_seq",String(n));
   r.temp_ack="SLV-PAN-"+new Date().getFullYear()+"-"+String(n).padStart(6,"0");r.actual_ack="";r.status="Details Saved";
   try{const a=read();a.unshift(r);write(a)}catch{return alert("Browser storage full. Use a smaller photo image.")}
   $("pan-message").textContent="Saved locally · "+r.temp_ack+" · Preparing preview…";
   await print(r);
   $("pan-message").textContent="Saved locally · "+r.temp_ack+" · Preview only; not submitted to PAN provider";
  };
 }
 function search(){
  root.innerHTML='<div class="pan-search-row"><input id="pan-q" placeholder="Search name / mobile / Temporary Ack"><button id="pan-find">Search</button></div><div id="pan-results"></div>';
  const run=()=>{const q=$("pan-q").value.toLowerCase(),a=read().filter(r=>!q||[r.name,r.mobile,r.temp_ack,r.actual_ack].some(v=>String(v||"").toLowerCase().includes(q)));$("pan-results").innerHTML=a.map(r=>'<p><b>'+esc(r.name)+'</b> · '+esc(r.mobile)+' · '+esc(r.temp_ack)+' · '+esc(r.actual_ack)+' <button data-link="'+esc(r.temp_ack)+'">Link Ack</button> <button data-print="'+esc(r.temp_ack)+'">Print</button></p>').join("")||"No records";root.querySelectorAll("[data-link]").forEach(b=>b.onclick=()=>{const r=read().find(x=>x.temp_ack===b.dataset.link),v=prompt("Enter official acknowledgement number",r.actual_ack||"");if(v===null)return;r.actual_ack=v.trim();r.status="Actual Ack Linked";write(read().map(x=>x.temp_ack===r.temp_ack?r:x));run()});root.querySelectorAll("[data-print]").forEach(b=>b.onclick=()=>print(read().find(x=>x.temp_ack===b.dataset.print)))};
  $("pan-find").onclick=run;run();
 }
 $("pan-new").onclick=()=>form("new");$("pan-corr").onclick=()=>form("correction");$("pan-search").onclick=search;form("new");
 // Blank Form 93 preview: opens the official blank background without requiring applicant data or saving a record.
 const blankPreviewButton=document.createElement("button");blankPreviewButton.type="button";blankPreviewButton.className="secondary-btn pan-blank-preview";blankPreviewButton.textContent="Preview blank Form 93";blankPreviewButton.title="Open a blank Form 93 preview without filling or saving applicant details.";$("pan-new").after(blankPreviewButton);
 blankPreviewButton.addEventListener("click",async()=>{blankPreviewButton.disabled=true;const old=blankPreviewButton.textContent;blankPreviewButton.textContent="Opening blank preview…";try{await print({name:"Blank Form 93",temp_ack:"BLANK PREVIEW",income_sources:[],residential_status:"",gender:"",single_parent:"",parent:"",communication_address:"",photo:"",signature:""});}catch(error){console.error(error);alert("Could not open blank Form 93 preview: "+(error.message||"Please try again."));}finally{blankPreviewButton.disabled=false;blankPreviewButton.textContent=old;}});
 // A one-click dummy-data preview lets staff verify PDF alignment without retyping a full application.
 const sampleButton=document.createElement("button");sampleButton.type="button";sampleButton.className="secondary-btn pan-sample-preview";
 sampleButton.textContent="Preview sample alignment (test only)";
 sampleButton.title="Creates a temporary Form 93 preview with fictitious details; does not save or submit an application.";
 $("pan-new").after(sampleButton);
 sampleButton.addEventListener("click",()=>{
  const sample={
   name:"ARUN KUMAR REDDY",name_first:"ARUN",name_middle:"KUMAR",name_last:"REDDY",name_as_aadhaar:"ARUN KUMAR REDDY",gender:"Male",dob:"1993-01-29",aadhaar:"123456789012",
   res_country:"India",res_flat:"12-4 MAIN BUILDING",res_road:"MAIN ROAD KORUKONDA",res_post:"KORUKONDA",res_area:"KORUKONDA",res_district:"EAST GODAVARI",res_state:"ANDHRA PRADESH",res_pin:"533289",
   office_country:"India",office_flat:"SLV COMMUNICATIONS",office_road:"MAIN ROAD",office_post:"KORUKONDA",office_area:"KORUKONDA",office_district:"EAST GODAVARI",office_state:"ANDHRA PRADESH",office_pin:"533289",
   residential_status:"Resident",passport:"",tin:"",mobile:"9876543210",email:"sample@example.com",landline:"0883",
   income_sources:["Income from Business / Profession"],single_parent:"No",father_first:"RAMESH",father_middle:"KUMAR",father_last:"REDDY",
   mother_first:"LAKSHMI",mother_middle:"DEVI",mother_last:"REDDY",parent:"Father",
   ao_area:"APR",ao_type:"W",ao_range:"116",ao_number:"1",
   ra_name:"",ra_pan:"",ra_aadhaar:"",ra_mobile:"",ra_email:"",ra_landline:"",
   communication_address:"Residence",proof_identity:"Aadhaar",proof_address:"Aadhaar",proof_dob:"Aadhaar",
   ra_proof_identity:"",ra_proof_address:"",declarant_name:"ARUN KUMAR REDDY",declarant_capacity:"Self",declarant_designation:"",
   place:"KORUKONDA",declaration_date:"2026-11-24",temp_ack:"SLV-SAMPLE-ALIGNMENT",photo:"",signature:""
  };
  print(sample);
 });
}

const announcementMeta={
 festive:{label:"Festive Wishes",icon:"🎉"},
 holiday:{label:"Holiday Declaration",icon:"📅"},
 important:{label:"Important Announcement",icon:"📢"}
};
async function loadEmployeeTaskReminders(){
 const host=$("employee-task-reminders");
 if(!host||currentProfile?.role!=="employee"||!currentEmployee?.id){if(host)host.innerHTML="";return;}
 const {data,error}=await supabase.from("employee_tasks").select("id,title,details,due_date,priority,status")
  .eq("employee_id",currentEmployee.id).in("status",["pending","in_progress"])
  .order("due_date",{ascending:true}).limit(8);
 if(error){host.innerHTML="";console.warn("Task reminders unavailable",error);return;}
 const rows=data||[];
 host.innerHTML=rows.length?'<div class="announcement-heading"><div><div class="eyebrow">YOUR ASSIGNED WORK</div><h3>Pending Work Reminders</h3></div></div><div class="announcement-list">'+rows.map(t=>'<article class="announcement-card"><div class="announcement-icon">'+(t.priority==="urgent"?"!":t.priority==="high"?"↑":"•")+'</div><div class="announcement-copy"><div class="announcement-type">'+escapeHtml(t.priority.toUpperCase())+(t.due_date?' · Due '+escapeHtml(t.due_date):'')+'</div><strong>'+escapeHtml(t.title)+'</strong><p>'+escapeHtml(t.details||"")+'</p></div></article>').join("")+'</div>':'';
}
async function loadEmployeeAnnouncements(){
 const host=$("employee-announcements");if(!host||currentProfile?.role!=="employee")return;
 const {data,error}=await supabase.from("shop_announcements")
  .select("id,announcement_type,title,message,event_date,expires_on,created_at")
  .eq("is_published",true).or("expires_on.is.null,expires_on.gte."+new Date().toISOString().slice(0,10))
  .order("created_at",{ascending:false}).limit(12);
 if(error){host.innerHTML="";console.warn("Announcements unavailable",error);return}
 if(!data?.length){host.innerHTML="";return}

 const festive=data.filter(a=>a.announcement_type==="festive");
 if(festive.length)showFestiveLoginPopup(festive);
 host.innerHTML='<div class="announcement-heading"><div><div class="eyebrow">FROM SLV MANAGEMENT</div><h3>Updates & Announcements</h3></div></div><div class="announcement-list">'+data.map(a=>{
 const m=announcementMeta[a.announcement_type]||announcementMeta.important;
 return '<article class="announcement-card announcement-'+a.announcement_type+'"><div class="announcement-icon">'+m.icon+'</div><div class="announcement-copy"><div class="announcement-type">'+m.label+(a.event_date?' · '+new Date(a.event_date+"T00:00:00").toLocaleDateString("en-IN"):"")+'</div><strong>'+escapeHtml(a.title)+'</strong><p>'+escapeHtml(a.message).replace(/\n/g,"<br>")+'</p></div></article>'
 }).join("")+'</div>';
}
function showFestiveLoginPopup(items){
 const previous=$("festive-login-overlay");if(previous)previous.remove();
 const overlay=document.createElement("div");overlay.id="festive-login-overlay";overlay.className="festive-login-overlay";
 const modal=document.createElement("section");modal.className="festive-login-modal";modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-labelledby","festive-popup-title");
 const closeButton=document.createElement("button");closeButton.type="button";closeButton.className="festive-popup-close";closeButton.setAttribute("aria-label","Close");closeButton.textContent="×";
 const decoration=document.createElement("div");decoration.className="festive-popup-confetti";decoration.textContent="✦ ✧ ✦";
 const eyebrow=document.createElement("div");eyebrow.className="festive-popup-eyebrow";eyebrow.textContent="A MESSAGE FROM SLV COMMUNICATIONS";
 const title=document.createElement("h2");title.id="festive-popup-title";title.textContent="Festive Wishes";
 const subtitle=document.createElement("p");subtitle.className="festive-popup-subtitle";subtitle.textContent="Wishing you and your family happiness, health and prosperity.";
 const list=document.createElement("div");list.className="festive-popup-items";
 items.forEach(a=>{const card=document.createElement("article");card.className="festive-popup-item";const date=document.createElement("div");date.className="festive-popup-date";date.textContent=a.event_date?new Date(a.event_date+"T00:00:00").toLocaleDateString("en-IN"):"";const heading=document.createElement("h3");heading.textContent=a.title||"Festive Wishes";const message=document.createElement("p");message.textContent=a.message||"";card.append(date,heading,message);list.appendChild(card)});
 const ok=document.createElement("button");ok.type="button";ok.className="primary-btn festive-popup-ok";ok.textContent="Thank you";
 modal.append(closeButton,decoration,eyebrow,title,subtitle,list,ok);overlay.appendChild(modal);document.body.appendChild(overlay);
 const close=()=>overlay.remove();closeButton.addEventListener("click",close);ok.addEventListener("click",close);overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 const onKey=e=>{if(e.key==="Escape"&&$("festive-login-overlay")){close();document.removeEventListener("keydown",onKey)}};document.addEventListener("keydown",onKey);ok.focus();
}
async function renderAnnouncementManager(){
 const host=$("other-view");if(currentProfile?.role!=="admin"){host.innerHTML='<div class="empty-panel"><h2>Announcements</h2><p>Only Admin can manage shop announcements.</p></div>';return}
 const {data:rows,error}=await supabase.from("shop_announcements").select("*").order("created_at",{ascending:false}).limit(100);
 if(error){host.innerHTML='<div class="empty-panel"><h2>Announcements</h2><p>Unable to load announcements.</p></div>';return}
 host.innerHTML=`
 <div class="admin-module-head"><div><div class="eyebrow">EMPLOYEE COMMUNICATION</div><h2>Festive Wishes & Announcements</h2><p>Create festive wishes, holiday declarations and important notices for all employees.</p></div></div>
 <div class="admin-editor announcement-editor"><h3 id="announcement-form-title">Create announcement</h3>
 <form id="announcement-form" class="announcement-form">
  <input type="hidden" id="announcement-id">
  <label>Announcement type<select id="announcement-type"><option value="festive">Festive Wishes</option><option value="holiday">Holiday Declaration</option><option value="important">Important Announcement</option></select></label>
  <label>Title<input id="announcement-title" maxlength="120" required placeholder="e.g. Happy Diwali"></label>
  <label>Message<textarea id="announcement-message" rows="4" maxlength="2000" required placeholder="Write message for employees"></textarea></label>
  <label>Event / Holiday date<input id="announcement-date" type="date"></label>
  <label>Visible until<input id="announcement-expiry" type="date"></label>
  <label>Publish status<select id="announcement-published"><option value="true">Publish now</option><option value="false">Save as draft / hidden</option></select></label>
  <div class="announcement-actions"><button class="primary-btn" type="submit" id="announcement-save">Publish announcement</button><button class="secondary-btn" type="button" id="announcement-reset">Clear form</button></div>
 </form></div>
 <div class="announcement-admin-list"><h3>Existing announcements</h3>
 ${rows?.length?rows.map(a=>{const m=announcementMeta[a.announcement_type]||announcementMeta.important;return `<article class="announcement-admin-row"><div class="announcement-icon">${m.icon}</div><div class="announcement-copy"><div class="announcement-type">${m.label} · ${a.is_published?"Published":"Draft / Hidden"}</div><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.message)}</p><small>${a.event_date?"Event: "+a.event_date:""} ${a.expires_on?"· Expires: "+a.expires_on:""}</small></div><div class="announcement-row-actions"><button type="button" data-ann-edit="${a.id}">Edit</button><button type="button" data-ann-toggle="${a.id}" data-published="${a.is_published}">${a.is_published?"Hide":"Publish"}</button><button type="button" class="danger-btn" data-ann-delete="${a.id}">Delete</button></div></article>`}).join(""):'<div class="empty-state">No announcements created yet.</div>'}
 </div>`;
 const reset=()=>{$("announcement-form").reset();$("announcement-id").value="";$("announcement-form-title").textContent="Create announcement";$("announcement-save").textContent="Publish announcement"};
 $("announcement-reset").onclick=reset;
 $("announcement-form").onsubmit=async e=>{
  e.preventDefault();const id=$("announcement-id").value;
  const payload={announcement_type:$("announcement-type").value,title:$("announcement-title").value.trim(),message:$("announcement-message").value.trim(),event_date:$("announcement-date").value||null,expires_on:$("announcement-expiry").value||null,is_published:$("announcement-published").value==="true"};
  if(payload.expires_on&&payload.event_date&&payload.expires_on<payload.event_date){alert("Visible until date cannot be before event date.");return}
  const result=id?await supabase.from("shop_announcements").update(payload).eq("id",id):await supabase.from("shop_announcements").insert({...payload,created_by:(await supabase.auth.getUser()).data.user?.id});
  if(result.error){alert("Unable to save: "+result.error.message);return}
  await renderAnnouncementManager();
 };
 host.querySelectorAll("[data-ann-edit]").forEach(btn=>btn.onclick=()=>{const a=rows.find(x=>x.id===btn.dataset.annEdit);$("announcement-id").value=a.id;$("announcement-type").value=a.announcement_type;$("announcement-title").value=a.title;$("announcement-message").value=a.message;$("announcement-date").value=a.event_date||"";$("announcement-expiry").value=a.expires_on||"";$("announcement-published").value=String(a.is_published);$("announcement-form-title").textContent="Edit announcement";$("announcement-save").textContent="Save changes";$("announcement-form").scrollIntoView({behavior:"smooth",block:"start"})});
 host.querySelectorAll("[data-ann-toggle]").forEach(btn=>btn.onclick=async()=>{const {error:e}=await supabase.from("shop_announcements").update({is_published:btn.dataset.published!=="true"}).eq("id",btn.dataset.annToggle);if(e)alert(e.message);else await renderAnnouncementManager()});
 host.querySelectorAll("[data-ann-delete]").forEach(btn=>btn.onclick=async()=>{if(!confirm("Delete this announcement?"))return;const {error:e}=await supabase.from("shop_announcements").delete().eq("id",btn.dataset.annDelete);if(e)alert(e.message);else await renderAnnouncementManager()});
}
window.__slvAppReady = true;


/* Profile dropdown: account actions live beside the user identity */
const profileTrigger=$("profile-trigger"),profileDropdown=$("profile-dropdown"),profileMenu=$("profile-menu");
profileTrigger?.addEventListener("click",()=>{
  const opening=profileDropdown?.classList.contains("hidden");
  profileDropdown?.classList.toggle("hidden",!opening);
  profileTrigger.setAttribute("aria-expanded",String(!!opening));
});
document.addEventListener("click",e=>{
  if(profileMenu&&!profileMenu.contains(e.target)){
    profileDropdown?.classList.add("hidden");
    profileTrigger?.setAttribute("aria-expanded","false");
  }
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    profileDropdown?.classList.add("hidden");
    profileTrigger?.setAttribute("aria-expanded","false");
  }
});
