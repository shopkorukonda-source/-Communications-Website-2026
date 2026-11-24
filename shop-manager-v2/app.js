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
    const {data: employeeLink} = await supabase.from("employees").select("id,full_name,employee_code").eq("profile_id",user.id).maybeSingle();
    currentEmployee = employeeLink || null;
  }
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  appScreen.classList.toggle("admin-mode", profile.role === "admin");
  $("user-name").textContent = profile.display_name || user.email;
  $("user-role").textContent = profile.role;
  $("avatar").textContent = (profile.display_name || user.email || "S").slice(0,1).toUpperCase();
  const hour = new Date().getHours();
  $("greeting").textContent = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  $("today-date").textContent = new Intl.DateTimeFormat("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(new Date());
  if (profile.role === "employee") {
    $("page-title").textContent = "My Dashboard";
    document.querySelector(".welcome-row h1").innerHTML = "Your work, <span>in control.</span>";
    document.querySelector(".welcome-row p").textContent = "Your daily billing, collections and shift activity.";
    document.querySelector(".stat-card:nth-child(2) .stat-top span:first-child").textContent = "My collections";
    document.querySelector(".stat-card:nth-child(2) .stat-icon").textContent = "₹";
    document.querySelector(".stat-card:nth-child(2) small").textContent = "Customer collections from your bills";
    $("today-bill-caption").textContent = currentEmployee ? "Bills you recorded today" : "Ask Admin to link your employee record";
  } else {
    document.querySelector(".welcome-row h1").innerHTML = "Your shop, <span>in control.</span>";
    document.querySelector(".welcome-row p").textContent = "Here’s a clear view of today’s operations.";
    document.querySelector(".stat-card:nth-child(2) .stat-top span:first-child").textContent = "Cash position";
    document.querySelector(".stat-card:nth-child(2) small").textContent = "Shop Cash wallet balance";
  }
  await loadCatalog();
  if (profile.role === "employee") await loadEmployeeAnnouncements();
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
    const {data: wallets, error: walletError} = await supabase.from("wallets").select("id,name,wallet_type,provider,current_balance,is_active").eq("is_active",true).order("name");
    if (walletError) console.warn("Wallet list unavailable", walletError);
    walletOptions = wallets || [];
  }
  $("service-count").textContent = services.length;
  renderCategories();
  await loadOverviewStats();
}

const icons = ["▣","◉","↗","▤","◇","✦"];
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
      supabase.from("billing_transactions").select("id,customer_total",{count:"exact"}).eq("employee_id",currentEmployee.id).gte("created_at",start.toISOString()),
      supabase.from("drawer_sessions").select("id,status,opened_at").eq("employee_id",currentEmployee.id).eq("status","open").order("opened_at",{ascending:false}).limit(1)
    ]);
    $("today-bill-count").textContent=error?"—":String(count||0);
    $("today-bill-caption").textContent=error?"Unable to load your bills":"Bills you recorded today";
    const collections=(ownBills||[]).reduce((sum,b)=>sum+Number(b.customer_total||0),0);
    $("cash-position").textContent=error?"—":"₹"+money(collections);
    $("cash-position-caption").textContent=sessionResult.data?.[0]?"Your collections today · Shift open":"Your collections today";
    return;
  }
  const [{count,error},sessionResult]=await Promise.all([
    supabase.from("billing_transactions").select("id",{count:"exact",head:true}).gte("created_at",start.toISOString()),
    supabase.from("drawer_sessions").select("id,opening_cash,opened_at,drawer_id").eq("status","open").order("opened_at",{ascending:false}).limit(1)
  ]);
  $("today-bill-count").textContent=error?"—":String(count||0);
  $("today-bill-caption").textContent=error?"Unable to load today's bills":"Bills recorded today";
  const cash=walletOptions.filter(w=>w.wallet_type==="cash").reduce((sum,w)=>sum+Number(w.current_balance||0),0);
  $("cash-position").textContent="₹"+money(cash);
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
  const {data,error} = await supabase.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  if (error) setMessage(error.message);
  else await showApp(data.user);
  button.disabled = false;
  button.innerHTML = 'Sign in <span>→</span>';
});
$("toggle-password").addEventListener("click",()=>{
  const input = $("password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  $("toggle-password").textContent = visible ? "Hide" : "Show";
});
$("signout-btn").addEventListener("click",async()=>{await supabase.auth.signOut();showLogin();});
$("service-search").addEventListener("input",renderServices);
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",async()=>{
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item===btn));
  const view = btn.dataset.view;
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
  } else if(["drawers","attendance","leave","payroll","incentives","ucl","expenses","settlement"].includes(view)) {
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
  let selectedWalletRules=[];
  if(s){
    const {data}=await supabase.from("service_wallet_rules").select("wallet_id,debit_config").eq("service_id",id).order("wallet_slot");
    selectedWalletRules=data||[];
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
        <label>Billing config (JSON)<textarea id="svc-billing-config" rows="3">${escapeHtml(JSON.stringify(s?.billing_config||{},null,2))}</textarea></label>
        <label>Processing cost config (JSON)<textarea id="svc-cost-config" rows="3">${escapeHtml(JSON.stringify(s?.processing_cost_config||{},null,2))}</textarea></label>
        <label>Profit config (JSON)<textarea id="svc-profit-config" rows="3">${escapeHtml(JSON.stringify(s?.profit_config||{},null,2))}</textarea></label>
      </div>
      <div class="wallet-map-box"><strong>Processing wallets</strong><p>Admin selects the wallet and debit formula for each service.</p><div class="wallet-choice-grid">${walletOptions.map(w=>{const rule=selectedWalletRules.find(x=>x.wallet_id===w.id),cfg=rule?.debit_config||{},mode=cfg.mode||(cfg.fixed_amount!=null?"fixed_amount":"processing_cost"),value=mode==="percentage"?(cfg.percentage??""):(cfg.fixed_amount??"");return `<label class="wallet-choice"><input type="checkbox" data-admin-wallet-check value="${w.id}" ${rule?"checked":""} ${w.is_active?"":"disabled"}><span>${escapeHtml(w.name)} <small>${escapeHtml(w.provider||w.wallet_type)}</small><select data-admin-wallet-mode="${w.id}" ${rule?"":"disabled"}><option value="processing_cost" ${mode==="processing_cost"?"selected":""}>Processing cost</option><option value="base_amount" ${mode==="base_amount"?"selected":""}>Bill amount</option><option value="base_plus_processing_cost" ${mode==="base_plus_processing_cost"?"selected":""}>Bill + processing cost</option><option value="fixed_amount" ${mode==="fixed_amount"?"selected":""}>Fixed amount</option><option value="percentage" ${mode==="percentage"?"selected":""}>Percentage of bill</option></select><input type="number" min="0" step="0.01" data-admin-wallet-value="${w.id}" value="${value}" placeholder="Value for fixed / percentage" ${rule&&["fixed_amount","percentage"].includes(mode)?"":"disabled"}></span></label>`;}).join("")||'<small>No wallets created yet. Add wallets from Wallets section.</small>'}</div></div>
      <label class="inline-check"><input id="svc-active" type="checkbox" ${s?.is_active===false?"":"checked"}> Service active</label>
      <div id="service-form-message" class="message"></div>
      <div class="admin-form-actions"><button type="button" class="text-btn" id="cancel-service">Cancel</button><button type="submit" class="primary-btn" id="save-service-btn">Save service</button></div>
    </form>`;
  $("svc-billing").value=s?.billing_type||"fixed";
  $("svc-cost").value=s?.processing_cost_type||"fixed";
  $("svc-profit").value=s?.profit_mode||"manual";
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
  const payload={category_id:$("svc-category").value,name:$("svc-name").value.trim(),code:$("svc-code").value.trim()||null,description:$("svc-description").value.trim()||null,billing_type:$("svc-billing").value,processing_cost_type:$("svc-cost").value,profit_mode:$("svc-profit").value,billing_config:billingConfig,processing_cost_config:costConfig,profit_config:profitConfig,is_active:$("svc-active").checked,updated_at:new Date().toISOString()};
  if(!payload.name){msg.textContent="Service name is required.";return;}
  btn.disabled=true;btn.textContent="Saving…";
  try{
    let saved;
    if(editingServiceId){const {data,error}=await supabase.from("services").update(payload).eq("id",editingServiceId).select("id").single();if(error)throw error;saved=data;}
    else{const {data,error}=await supabase.from("services").insert(payload).select("id").single();if(error)throw error;saved=data;}
    const chosen=[...document.querySelectorAll("[data-admin-wallet-check]:checked")].map((el,i)=>{const mode=document.querySelector('[data-admin-wallet-mode="'+el.value+'"]')?.value||"processing_cost",value=Number(document.querySelector('[data-admin-wallet-value="'+el.value+'"]')?.value||0),debit_config={mode};if(mode==="fixed_amount")debit_config.fixed_amount=value;if(mode==="percentage")debit_config.percentage=value;return {service_id:saved.id,wallet_id:el.value,wallet_slot:i+1,debit_order:i+1,debit_config,is_required:true};});
    if(chosen.some(x=>(x.debit_config.mode==="fixed_amount"||x.debit_config.mode==="percentage")&&(!(Number(x.debit_config.fixed_amount??x.debit_config.percentage)>0))))throw new Error("Enter a positive value for every fixed or percentage wallet rule.");
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
  host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Wallet Management</h2><p>Create wallets, track balances and transfer funds between wallets.</p></div></div>
    <div class="admin-editor"><h3>Create wallet</h3><form id="wallet-form" class="service-form">
      <div class="admin-form-grid"><label>Wallet name<input id="wallet-name" required maxlength="100" placeholder="e.g. IDFC Bank"></label><label>Wallet type<select id="wallet-type"><option value="bank">Bank</option><option value="upi">UPI</option><option value="provider">Provider</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label>Provider / account label<input id="wallet-provider" maxlength="100" placeholder="Optional"></label></div>
      <small class="muted">New wallets always start with ₹0 opening balance.</small><div id="wallet-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit" id="wallet-save">Create wallet</button>
    </form></div>
    <div class="admin-editor"><h3>Load wallet balance</h3><form id="load-form" class="service-form"><div class="admin-form-grid"><label>Wallet<select id="load-wallet" required></select></label><label>Load amount (₹)<input id="load-amount" type="number" min="0.01" step="0.01" required></label><label>Source / bank account<input id="load-source" placeholder="e.g. SBI / IDFC / cash" maxlength="100"></label></div><div id="load-message" class="message"></div><button class="primary-btn" type="submit">Record wallet load</button></form></div>
    <div class="admin-editor"><h3>Wallet transfer</h3><form id="transfer-form" class="service-form">
      <div class="admin-form-grid"><label>From wallet<select id="transfer-from" required></select></label><label>To wallet<select id="transfer-to" required></select></label><label>Amount (₹)<input id="transfer-amount" type="number" min="0.01" step="0.01" required></label></div>
      <label>Note<input id="transfer-note" maxlength="200" placeholder="Optional transfer note"></label><div id="transfer-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit" id="transfer-save">Transfer balance</button>
    </form></div>
    <div class="admin-table-wrap"><div class="admin-table-head"><h3>All wallets</h3><input id="wallet-search" class="search-input" placeholder="Search wallets"></div><div id="wallet-rows"></div></div>`;
  fillTransferWallets();renderWalletRows();
  $("wallet-form").addEventListener("submit",createWallet);
  $("load-wallet").innerHTML=walletOptions.filter(w=>w.is_active).map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join("");
  $("load-form").addEventListener("submit",loadWallet);
  $("transfer-form").addEventListener("submit",transferWallet);
  $("wallet-search").addEventListener("input",renderWalletRows);
}
function fillTransferWallets(){
  const opts=walletOptions.filter(w=>w.is_active);
  const html=opts.map(w=>`<option value="${w.id}">${escapeHtml(w.name)} · ₹${Number(w.current_balance||0).toFixed(2)}</option>`).join("");
  $("transfer-from").innerHTML='<option value="">Select source</option>'+html;
  $("transfer-to").innerHTML='<option value="">Select destination</option>'+html;
}
function renderWalletRows(){
  const q=$("wallet-search")?.value.trim().toLowerCase()||"";
  const rows=walletOptions.filter(w=>w.name.toLowerCase().includes(q)||(w.provider||"").toLowerCase().includes(q));
  $("wallet-rows").innerHTML=rows.length?rows.map(w=>`
    <div class="admin-service-row"><div class="admin-service-main"><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(w.provider||w.wallet_type)} · ${escapeHtml(w.wallet_type)}</small></div><div class="admin-service-meta"><strong>₹${Number(w.current_balance||0).toFixed(2)}</strong><span class="status-pill ${w.is_active?"is-active":"is-inactive"}">${w.is_active?"Active":"Inactive"}</span></div><div class="admin-service-actions"><button data-wallet-toggle="${w.id}">${w.is_active?"Deactivate":"Activate"}</button></div></div>`).join(""):'<div class="empty-state">No wallets created yet.</div>';
  document.querySelectorAll("[data-wallet-toggle]").forEach(b=>b.addEventListener("click",()=>toggleWallet(b.dataset.walletToggle)));
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
 <div class="admin-table-wrap"><h3>Recent bills</h3><div id="report-rows"></div></div>`;
 $("report-period").addEventListener("change",loadReportsData);
 $("finance-target-period").addEventListener("change",async()=>{const {data}=await supabase.from("income_targets").select("period_type,target_amount,daily_target_start_date");const key=financeDbPeriod[$("finance-target-period").value];const x=(data||[]).find(v=>v.period_type===key);$("finance-target-input").value=Number(x?.target_amount||0);$("finance-expense-target-input").value=Number(x?.expense_target_amount||0)});
 $("finance-target-form").addEventListener("submit",async e=>{e.preventDefault();const period=financeDbPeriod[$("finance-target-period").value],amount=Number($("finance-target-input").value),expenseBudget=Number($("finance-expense-target-input").value);if(!Number.isFinite(amount)||amount<0||!Number.isFinite(expenseBudget)||expenseBudget<0)return;const {error}=await supabase.from("income_targets").upsert({period_type:period,target_amount:amount,expense_target_amount:expenseBudget,updated_by:(await supabase.auth.getUser()).data.user?.id,updated_at:new Date().toISOString()},{onConflict:"period_type"});$("finance-target-message").textContent=error?"Unable to save target: "+error.message:"Target saved successfully.";if(!error)await loadReportsData()});
 await loadReportsData();
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
async function renderEmployeeManager(){
  const {data:profiles}=await supabase.from("profiles").select("id,display_name,phone,role").eq("is_active",true).eq("role","employee").order("display_name");
  const {data:existingLinks}=await supabase.from("employees").select("profile_id");
  const linkedProfileIds=new Set((existingLinks||[]).map(x=>x.profile_id).filter(Boolean));
  const availableProfiles=(profiles||[]).filter(p=>!linkedProfileIds.has(p.id));
  const host=$("other-view");host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Employees</h2><p>Maintain employee details and salary settings.</p></div></div>
    <div class="admin-editor"><h3>Add employee record</h3><form id="employee-form" class="service-form"><div class="admin-form-grid"><label>Full name<input id="employee-name" required maxlength="120"></label><label>Mobile number<input id="employee-phone" maxlength="20"></label><label>Link login account<select id="employee-profile"><option value="">Not linked</option>${availableProfiles.map(p=>`<option value="${p.id}">${escapeHtml(p.display_name||p.phone||p.id)}</option>`).join("")}</select></label><label>Monthly fixed salary (₹)<input id="employee-salary" type="number" min="0" step="0.01" value="0"></label></div><div id="employee-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit">Add employee</button></form></div>
    <div class="admin-table-wrap"><h3>Employee records</h3><div id="employee-rows"></div></div>`;
  $("employee-form").addEventListener("submit",createEmployee);
  const {data,error}=await supabase.from("employees").select("id,employee_code,full_name,phone,monthly_salary,is_active,joined_on,profile_id").order("created_at",{ascending:false});
  if(error){$("employee-rows").innerHTML='<div class="empty-state">Unable to load employee records.</div>';return;}
  const linked=new Set((data||[]).map(x=>x.profile_id).filter(Boolean));
  const profileOptions=(profiles||[]).filter(p=>!linked.has(p.id));
  $("employee-rows").innerHTML=(data||[]).length?data.map(x=>`<div class="admin-service-row"><div class="admin-service-main"><strong>${escapeHtml(x.full_name)}</strong><small>${escapeHtml(x.phone||"No mobile")} · ${escapeHtml(x.employee_code||"No code")} · ${x.profile_id?"Login linked":"Login not linked"}</small></div><div class="admin-service-meta"><strong>₹${Number(x.monthly_salary).toFixed(2)} / month</strong><span class="status-pill ${x.is_active?"is-active":"is-inactive"}">${x.is_active?"Active":"Inactive"}</span></div><div class="admin-service-actions">${!x.profile_id?'<select data-employee-profile="'+x.id+'"><option value="">Select login</option>'+profileOptions.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.display_name||p.phone||p.id)+'</option>').join("")+'</select><button data-employee-link="'+x.id+'">Link login</button>':""}<button data-employee-toggle="${x.id}" data-active="${x.is_active}">${x.is_active?"Deactivate":"Activate"}</button></div></div>`).join(""):'<div class="empty-state">No employees added yet.</div>';
  document.querySelectorAll("[data-employee-link]").forEach(b=>b.addEventListener("click",async()=>{const select=document.querySelector('[data-employee-profile="'+b.dataset.employeeLink+'"]');if(!select?.value){alert("Select an employee login account first.");return;}const {error}=await supabase.from("employees").update({profile_id:select.value}).eq("id",b.dataset.employeeLink);if(error)alert(error.message);else await renderEmployeeManager();}));
  document.querySelectorAll("[data-employee-toggle]").forEach(b=>b.addEventListener("click",async()=>{const {error}=await supabase.from("employees").update({is_active:b.dataset.active!=="true"}).eq("id",b.dataset.employeeToggle);if(error)alert(error.message);else await renderEmployeeManager();}));
}
async function createEmployee(e){
  e.preventDefault();const msg=$("employee-message");
  const payload={full_name:$("employee-name").value.trim(),phone:$("employee-phone").value.trim()||null,profile_id:$("employee-profile").value||null,monthly_salary:Number($("employee-salary").value)||0,is_active:true,joined_on:new Date().toISOString().slice(0,10)};
  const {error}=await supabase.from("employees").insert(payload);
  if(error){msg.textContent=error.message;return;}msg.textContent="Employee record created.";await renderEmployeeManager();
}


let billingRows = [];
let billingWalletRules = {};
function money(n){return Number(n||0).toFixed(2);}
function serviceByCode(code){return services.find(s=>s.code===code);}
function calculateBillingRow(row){
  const svc=services.find(s=>s.id===row.service_id), amount=Number(row.base||0),qty=Math.max(1,Number(row.quantity||1));
  if(!svc||amount<0)return {charge:0,cost:0,profit:0,unitTotal:0,total:0};
  let charge=0,cost=Number(row.cost||0),profit=0;
  if(svc.code==="CURRENT_BILLS"){
    const cfg=svc.billing_config||{}, slabs=cfg.slabs||[];
    const slab=slabs.find(x=>amount>=Number(x.min)&&amount<=Number(x.max));
    const debitTotal=(row.wallet_debits||[]).reduce((sum,x)=>sum+Number(x.amount||0),0);
    if(slab){charge=Number(slab.customer_charge||0);cost=debitTotal>0?debitTotal-amount:(slab.wallet_extra==null?Number(row.cost||0):Number(slab.wallet_extra));}
    else if(amount>1000){charge=10+Math.ceil((amount-1000)/100)*Number(cfg.above_1000?.extra_per_100||1);cost=debitTotal>0?debitTotal-amount:Number(row.cost||0);}
  } else if(svc.code==="MONEY_TRANSFER"){
    charge=Math.ceil(amount/1000)*Number(svc.billing_config?.charge_per_1000||10);cost=Number(row.cost||0);
  } else if(svc.code==="PRIVATE_BUS_TICKET"){
    charge=Math.round(amount*Number(svc.billing_config?.commission_percent||6)/100*100)/100;cost=Number(row.cost||0);
  } else if(svc.code==="APSRTC_TICKET"||svc.code==="TTD_TICKET"){
    charge=Number(svc.billing_config?.customer_charge||50);cost=Number(row.cost||svc.processing_cost_config?.fixed_amount||0);
  } else if(svc.code==="CREDIT_CARD_BANK"){
    charge=Math.round((amount*Number(svc.billing_config?.charge_percent||2)/100)*100)/100;cost=Number(row.cost||0);
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
  if(["CURRENT_BILLS","MONEY_TRANSFER","PRIVATE_BUS_TICKET","APSRTC_TICKET","TTD_TICKET","CREDIT_CARD_BANK","AEPS_WITHDRAWAL"].includes(svc.code))profit=charge-cost;
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
  const rules=billingWalletRules[row.service_id]||[];
  if(!rules.length)return [];
  const amount=Number(row.base||0),processingCost=Number(row.cost||svc?.processing_cost_config?.fixed_amount||0);
  const modes=rules.map(rule=>rule.debit_config?.mode||(rule.debit_config?.fixed_amount!=null?"fixed_amount":"processing_cost"));
  const hasBaseAmount=modes.includes("base_amount");
  let autoTarget=processingCost;
  if(svc?.code==="CURRENT_BILLS"){
    const cfg=svc.billing_config||{},slab=(cfg.slabs||[]).find(x=>amount>=Number(x.min||0)&&amount<=Number(x.max||0));
    const extra=Number(slab?.wallet_extra??row.cost??cfg.above_1000?.wallet_extra??0);
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
  billingRows=Array.from({length:n},(_,i)=>billingRows[i]||({service_id:"",base:"",charge:"",cost:"",bank:"",quantity:1,wallet_debits:[]}));
  $("billing-rows").innerHTML=billingRows.map((r,i)=>{
    const serviceOptions=services.filter(s=>s.is_active).map(s=>'<option value="'+s.id+'" '+(s.id===r.service_id?"selected":"")+'>'+escapeHtml(s.name)+'</option>').join("");
    const svc=services.find(s=>s.id===r.service_id),alloc=automaticWalletDebits(r,svc);
    const allowedPrintRates=(svc?.code==="PRINTOUT"?(svc.billing_config?.allowed_charges||[2,5]).map(Number):[]);
    const chargeField=svc?.code==="PRINTOUT"?'<label>Rate per print<select data-field="charge" data-i="'+i+'">'+allowedPrintRates.map(rate=>'<option value="'+rate+'" '+(Number(r.charge||svc.billing_config?.customer_charge||allowedPrintRates[0])===rate?"selected":"")+'">₹'+rate+' / print</option>').join("")+'</select></label>':svc?.code?.startsWith("XEROX_")?'<label>Rate per copy<input type="text" value="₹'+money(svc.billing_config?.customer_charge||0)+' / copy" readonly></label>':'<label>Service charge (₹)<input data-field="charge" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.charge||"")+'"></label>';
    const walletOptionsHtml=(billingWalletRules[r.service_id]||[]).map(rule=>{
      const wallet=walletOptions.find(x=>x.id===rule.wallet_id),debit=alloc.find(x=>x.wallet_id===rule.wallet_id);
      return wallet?'<div class="wallet-choice"><span>'+escapeHtml(wallet.name)+' <small>Balance ₹'+money(wallet.current_balance)+' · Auto debit ₹'+money(debit?.amount||0)+'</small></span></div>':"";
    }).join("")||"<small>No processing wallet configured for this service.</small>";
    return '<div class="billing-row" data-row="'+i+'"><div class="billing-row-head"><strong>Service '+(i+1)+'</strong><span class="billing-row-total" id="row-total-'+i+'">₹0.00</span></div><div class="billing-row-fields"><label>Service<select data-field="service_id" data-i="'+i+'"><option value="">Select service</option>'+serviceOptions+'</select></label><label style="display:'+((svc?.code==="PRINTOUT"||svc?.code?.startsWith("XEROX_"))?"none":"grid")+'">Bill / Transfer Amount (₹)<input data-field="base" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.base)+'"></label><label>'+(svc?.code==="PRINTOUT"||svc?.code?.startsWith("XEROX_")?"Prints / Copies":"Quantity")+'<input data-field="quantity" data-i="'+i+'" type="number" min="1" step="1" value="'+Number(r.quantity||1)+'"></label>'+chargeField+'<label class="bank-field">Bank (AEPS)<input data-field="bank" data-i="'+i+'" value="'+escapeHtml(r.bank)+'" placeholder="Bank name"></label><label style="display:'+((svc?.processing_cost_config?.manual_entry||svc?.processing_cost_config?.mode==="admin_configurable_wallet_debit"||(svc?.code==="CURRENT_BILLS"&&Number(r.base||0)>=10&&((svc.billing_config?.slabs||[]).find(x=>Number(r.base)>=Number(x.min||0)&&Number(r.base)<=Number(x.max||0))?.wallet_extra==null)))?"":"none")+'">Manual processing cost (₹)<input data-field="cost" data-i="'+i+'" type="number" min="0" step="0.01" value="'+escapeHtml(r.cost)+'"></label></div><div class="wallet-map-box"><strong>Processing wallet (automatic)</strong><p>Wallet and debit amount are taken from Admin service settings.</p><div class="wallet-choice-grid" id="wallet-auto-'+i+'">'+walletOptionsHtml+'</div></div><div class="billing-row-result" id="row-result-'+i+'">Service Charge: ₹0.00 · Profit: ₹0.00</div></div>';
  }).join("");
  $("billing-rows").querySelectorAll("[data-field]").forEach(el=>{el.addEventListener("input",onBillingRowChange);el.addEventListener("change",onBillingRowChange);});
  updateBillingTotals();
}

function onBillingRowChange(e){
  const i=Number(e.target.dataset.i),field=e.target.dataset.field;
  billingRows[i][field]=e.target.value;
  if(field==="service_id"){const svc=services.find(s=>s.id===e.target.value);billingRows[i].base=svc?.billing_config?.base_amount??"";billingRows[i].charge=svc?.billing_config?.customer_charge??"";billingRows[i].cost=svc?.processing_cost_config?.fixed_amount??"";billingRows[i].quantity=1;billingRows[i].wallet_debits=[];setBillingRows(billingRows.length);return;}
  updateBillingTotals();
}
function onBillingWalletChange(){}

function updateBillingTotals(){
  let base=0,charges=0,costs=0,total=0;
  billingRows.forEach((r,i)=>{
    const calc=calculateBillingRow(r);base+=Number(r.base||0);charges+=calc.charge;costs+=calc.cost;total+=calc.total;
    const t=$("row-total-"+i),res=$("row-result-"+i),svc=services.find(s=>s.id===r.service_id),alloc=automaticWalletDebits(r,svc),walletBox=$("wallet-auto-"+i);
    if(t)t.textContent="₹"+money(calc.total);
    if(walletBox)walletBox.innerHTML=(billingWalletRules[r.service_id]||[]).map(rule=>{const wallet=walletOptions.find(x=>x.id===rule.wallet_id),debit=alloc.find(x=>x.wallet_id===rule.wallet_id);return wallet?'<div class="wallet-choice"><span>'+escapeHtml(wallet.name)+' <small>Balance ₹'+money(wallet.current_balance)+' · Auto debit ₹'+money(debit?.amount||0)+'</small></span></div>':"";}).join("")||"<small>No processing wallet configured for this service.</small>";
    if(res)res.textContent=currentProfile?.role==="admin"?"Service Charge: ₹"+money(calc.charge)+" · Processing Cost: ₹"+money(calc.cost)+" · Profit: ₹"+money(calc.profit)+" · Wallet debit: ₹"+money(alloc.reduce((a,x)=>a+x.amount,0)):"Service Charge: ₹"+money(calc.charge);
  });
  $("billing-totals").innerHTML=`<div><small>Total bill amount</small><strong>₹${money(base)}</strong></div><div><small>Total service charges</small><strong>₹${money(charges)}</strong></div><div><small>Customer total</small><strong>₹${money(total)}</strong></div>`;
  const received=Number($("bill-received").value||0);
  $("bill-change").textContent="Change: ₹"+money(Math.max(0,received-total));
}
function updatePaymentFields(){
  const mode=$("bill-mode").value;
  $("cash-paid-wrap").classList.toggle("hidden",mode==="upi");
  $("upi-paid-wrap").classList.toggle("hidden",mode==="cash");
}
async function saveQuickBilling(){
  const msg=$("billing-message"),btn=$("save-billing");btn.disabled=true;msg.textContent="";
  try{
    const items=[];let customerTotal=0,processingTotal=0,profitTotal=0;
    for(const r of billingRows){
      if(!r.service_id&&!Number(r.base||0))continue;
      if(!r.service_id||Number(r.base||0)<0)throw new Error("Every entered row needs a service and a valid bill amount.");
      const svc=services.find(s=>s.id===r.service_id);
      const wallet_debits=automaticWalletDebits(r,svc);
      if(svc.code==="CURRENT_BILLS"&&Number(r.base)>=10&&!(billingWalletRules[r.service_id]||[]).length)throw new Error("Admin must assign a processing wallet to Current Bills.");
      if((billingWalletRules[r.service_id]||[]).length&&!wallet_debits.length)throw new Error("Set processing wallet debit amounts in Admin Services for "+svc.name);
      if(wallet_debits.some(x=>!Number.isFinite(Number(x.amount))||Number(x.amount)<=0))throw new Error("Invalid automatic wallet debit amount.");
      r.wallet_debits=wallet_debits;
      const calc=calculateBillingRow(r);
      const quantity=Math.max(1,Number(r.quantity||1)),price=calc.unitTotal;
      const itemPayload={service_id:r.service_id,quantity,customer_unit_price:price,processing_unit_cost:calc.cost,pricing_snapshot:{base_amount:Number(r.base),service_charge:calc.charge,bank:r.bank||null,wallet_debits},wallet_debits};
      if(currentProfile?.role==="admin")itemPayload.profit_amount=calc.profit;
      items.push(itemPayload);
      customerTotal+=price*quantity;processingTotal+=calc.cost*quantity;profitTotal+=calc.profit*quantity;
    }
    if(!items.length)throw new Error("Enter at least one bill.");
    const mode=$("bill-mode").value,received=Number($("bill-received").value||0);
    const cash=mode==="upi"?0:mode==="cash"?received:Number($("bill-cash").value||0);
    const upi=mode==="cash"?0:mode==="upi"?received:Number($("bill-upi").value||0);
    if(received<customerTotal)throw new Error("Amount received must be equal to or greater than customer total.");
    if(mode==="split"&&Math.abs(cash+upi-received)>0.009)throw new Error("Cash + UPI must equal amount received.");
    let activeDrawerId=null;if(currentProfile?.role==="employee"&&currentEmployee){const activeSession=await supabase.from("drawer_sessions").select("drawer_id").eq("employee_id",currentEmployee.id).eq("status","open").order("opened_at",{ascending:false}).limit(1).maybeSingle();if(activeSession.error)throw activeSession.error;activeDrawerId=activeSession.data?.drawer_id||null;}
    const payload={drawer_id:activeDrawerId,customer_name:$("bill-customer").value.trim()||null,customer_phone:$("bill-phone").value.trim()||null,payment_mode:mode,customer_total:customerTotal,amount_received:received,cash_received:cash,upi_received:upi,items};
    const {data,error}=await supabase.rpc("create_bill",{payload});
    if(error)throw error;
    msg.textContent="Bills saved successfully. Transaction ID: "+data;
    $("bill-received").value="0";$("bill-cash").value="0";$("bill-upi").value="0";
    await setBillingRows(Number($("bill-count").value||1));await loadRecentBills();
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
    return `<div class="admin-service-row"><div class="admin-service-main"><strong>Bill #${x.bill_number}</strong><small>${new Date(x.created_at).toLocaleString("en-IN")}</small></div><div class="admin-service-meta"><strong>₹${money(x.customer_total)}</strong><span>${mins<=60?"Within 1-hour edit window":"Approval required"}</span></div><div class="admin-service-actions">${canEdit?`<button data-bill-edit="${x.id}">Edit bill</button>`:pending?'<span>Request pending</span>':approved?`<button data-apply-approved="${approved.id}" data-bill="${x.id}">Apply approved</button>`:`<button data-bill-request="${x.id}">Request edit</button>`}</div></div>`;
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
  const host=$("recent-bills");
  const editor=document.createElement("div");editor.className="admin-editor";editor.id="bill-edit-editor";
  editor.innerHTML=`<div class="admin-editor-head"><div><h3>${requestOnly?"Request bill edit":"Edit bill"} </h3><p>Review the bill data before saving. Wallet debits and profit are recalculated by the database function.</p></div><button type="button" class="text-btn" id="close-bill-editor">Close</button></div>
  <label class="service-form">Bill data (JSON)<textarea id="bill-edit-json" rows="14" spellcheck="false"></textarea></label>
  ${requestOnly?'<label class="service-form">Reason for edit<input id="bill-edit-reason" placeholder="Explain why this bill needs correction" required></label>':""}
  <div id="bill-edit-message" class="message"></div><div class="admin-form-actions"><button class="primary-btn" id="submit-bill-edit">${requestOnly?"Send edit request":"Save bill changes"}</button></div>`;
  host.prepend(editor);$("bill-edit-json").value=JSON.stringify(payload,null,2);
  $("close-bill-editor").onclick=()=>editor.remove();
  $("submit-bill-edit").onclick=async()=>{
    const btn=$("submit-bill-edit"),msg=$("bill-edit-message");btn.disabled=true;
    try{
      const proposed=JSON.parse($("bill-edit-json").value);
      if(!Array.isArray(proposed.items)||!proposed.items.length)throw new Error("Items array is required.");
      let result;
      if(requestOnly){
        const reason=$("bill-edit-reason").value.trim();if(reason.length<3)throw new Error("Please enter an edit reason.");
        result=await supabase.rpc("request_billing_edit",{p_transaction_id:id,p_reason:reason,p_proposed_payload:proposed});
      }else{
        result=await supabase.rpc("update_bill_with_approval",{p_transaction_id:id,p_payload:proposed,p_edit_request_id:null});
      }
      if(result.error)throw result.error;
      msg.textContent=requestOnly?"Edit request sent to Admin.":"Bill updated successfully.";
      await loadRecentBills();
    }catch(e){msg.textContent=e.message||"Unable to process edit.";console.error(e);}
    finally{btn.disabled=false;}
  };
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
    .select("id,name,url,category,is_active,sort_order").order("sort_order").order("name");
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
        <button class="primary-btn" type="submit">+ Add Website</button>
      </form>
    </div>`:''}
    <div class="quick-link-grid">
      ${visible.length?visible.map(link=>`<article class="quick-link-card">
        <div class="quick-link-mark">↗</div><div class="quick-link-info"><strong>${escapeHtml(link.name)}</strong><small>${escapeHtml(link.category||"General")}</small></div>
        <a class="primary-btn quick-link-open" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">Open Website ↗</a>
        ${admin?`<div class="quick-link-admin"><span>${link.is_active?"Active":"Hidden for employees"}</span><button type="button" class="secondary-btn" data-link-toggle="${link.id}" data-active="${link.is_active}">${link.is_active?"Hide":"Show"}</button><button type="button" class="danger-btn" data-link-delete="${link.id}">Delete</button></div>`:''}
      </article>`).join(""):'<div class="empty-state">No websites are available yet. Ask Admin to add a website.</div>'}
    </div>
    <div class="quick-link-note"><strong>Customer form assistance:</strong> External portals may block automatic form filling. For security, enter passwords, OTPs and CAPTCHA directly on the official website. Never save CSC login credentials here.</div>`;
  if(admin){
    $("quick-link-form").addEventListener("submit",async e=>{
      e.preventDefault();
      const name=$("quick-link-name").value.trim(),url=$("quick-link-url").value.trim(),category=$("quick-link-category").value.trim()||"General";
      let parsed;try{parsed=new URL(url)}catch{return alert("Enter a valid website URL.");}
      if(parsed.protocol!=="https:")return alert("Only secure HTTPS websites are allowed.");
      const {error:saveError}=await supabase.from("quick_links").insert({name,url:parsed.href,category,created_by:(await supabase.auth.getUser()).data.user?.id});
      if(saveError){alert("Could not add website: "+saveError.message);return;}
      await renderQuickLinks();
    });
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
 const esc=v=>String(v||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 const age=d=>{if(!d)return null;const b=new Date(d+"T00:00:00"),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))a--;return a};
 host.innerHTML='<h2>PAN Applications</h2><p>New PAN Form 93 · Correction CR-01 · Minor RA details · Local device records</p><div class="pan-tabs"><button id="pan-new">New PAN</button><button id="pan-corr">Correction</button><button id="pan-search">Search / Link Ack</button></div><div id="pan-work"></div>';
 const root=$("pan-work");
 function print(r){
  const w=window.open("","_blank");if(!w)return alert("Allow pop-ups to print.");
  const rows=Object.entries(r).filter(([k,v])=>v&&!["photo","signature"].includes(k)).map(([k,v])=>"<p><b>"+esc(k.replace(/_/g," "))+":</b> "+esc(v)+"</p>").join("");
  w.document.write('<html><head><title>'+esc(r.temp_ack)+'</title><style>@page{size:A4;margin:15mm}body{font:12px Arial}.page{min-height:265mm;page-break-after:always}h2{text-align:center}.photos{display:flex;gap:18px;justify-content:flex-end}.photos img{width:35mm;height:45mm;object-fit:contain;border:1px solid #888}</style></head><body><section class="page"><h2>SLV COMMUNICATIONS<br>'+(r.mode==="new"?"FORM 93 – NEW PAN":"PAN CR-01 – CORRECTION")+'<br><small>Prepared draft – verify against official form</small></h2><h3>Temporary Ack: '+esc(r.temp_ack)+'</h3><div class="photos">'+(r.photo?'<img src="'+r.photo+'">':"Photo blank")+(r.signature?'<img src="'+r.signature+'">':"Signature blank")+'</div>'+rows+'</section><section class="page"><h2>REPRESENTATIVE ASSESSEE & DECLARATION</h2><h3>Temporary Ack: '+esc(r.temp_ack)+'</h3>'+(r.kind==="Minor"?["ra_name","ra_relation","ra_pan","ra_aadhaar","ra_mobile","ra_email","ra_address","ra_city","ra_state","ra_pin"].map(k=>"<p><b>"+k.replace(/_/g," ")+":</b> "+esc(r[k])+"</p>").join(""):"Adult applicant – RA not applicable")+'<p>I declare that the above details are true and correct. This is an internal shop draft, not an official acknowledgement.</p><p>Place: __________ Date: __________</p><div style="height:30mm;width:55mm;border:1px solid #888;margin-left:auto"></div><p style="text-align:right">Applicant / RA Signature</p><p>Official Ack: '+esc(r.actual_ack||"Not linked")+'</p></section><script>onload=function(){print()}<\/script></body></html>');
  w.document.close();
 }
 function form(mode){
  const fields=[["name","Applicant full name *","required"],["dob","Date of birth *",'type="date" required'],["mobile","Mobile *","required"],["email","Email *",'type="email" required'],["aadhaar","Applicant Aadhaar",'maxlength="12"'],["father","Father name",""],["mother","Mother name",""],["address","Full address",""],["city","City",""],["state","State",'value="Andhra Pradesh"'],["pin","PIN code",'maxlength="6"']];
  root.innerHTML='<form id="pan-form"><h3>'+(mode==="new"?"New PAN – Form 93":"PAN Correction – CR-01")+'</h3><div class="pan-grid">'+fields.map(([n,l,a])=>'<label>'+l+'<input name="'+n+'" '+a+'></label>').join("")+'<label>Gender<select name="gender"><option value="">Select</option><option>Male</option><option>Female</option><option>Transgender</option></select></label><label>Parent name to print<select name="parent"><option value="">Select</option><option>Father</option><option>Mother</option></select></label>'+(mode==="correction"?'<label>Existing PAN *<input name="pan" required maxlength="10"></label><label>Correction requested<input name="correction"></label>':"")+'</div><label>Applicant type<select name="kind" id="pan-kind"><option>Auto detect from DOB</option><option>Adult</option><option>Minor</option></select></label><div id="pan-ra" class="pan-section hidden"><h3>Representative Assessee – Minor</h3><p>RA PAN or RA Aadhaar is required. Mobile, email and address are required.</p><div class="pan-grid">'+[["ra_name","RA full name","required"],["ra_relation","Relationship (Father / Mother / Guardian)","required"],["ra_pan","RA PAN",""],["ra_aadhaar","RA Aadhaar",'maxlength="12"'],["ra_mobile","RA mobile","required"],["ra_email","RA email",'type="email" required'],["ra_address","RA address","required"],["ra_city","RA city","required"],["ra_state","RA state","required"],["ra_pin","RA PIN","required"]].map(([n,l,a])=>'<label>'+l+'<input name="'+n+'" '+a+'></label>').join("")+'</div></div><div class="pan-grid"><label>Applicant photo (optional)<input id="pan-photo" type="file" accept="image/*"></label><label>Applicant signature (optional)<input id="pan-sign" type="file" accept="image/*"></label></div><button class="primary-btn" type="submit">Save & Generate Temporary Ack</button><p id="pan-message"></p></form>';
  const f=$("pan-form"),kind=f.elements.kind,dob=f.elements.dob,ra=$("pan-ra");let photo="",signature="";
  const update=()=>{const a=age(dob.value),m=kind.value==="Minor"||(kind.value==="Auto detect from DOB"&&a!==null&&a<18);ra.classList.toggle("hidden",!m);["ra_name","ra_relation","ra_mobile","ra_email","ra_address","ra_city","ra_state","ra_pin"].forEach(n=>f.elements[n].required=m)};
  kind.onchange=dob.onchange=update;update();
  const load=(file,cb)=>{if(!file)return;const rd=new FileReader();rd.onload=()=>cb(rd.result);rd.readAsDataURL(file)};
  $("pan-photo").onchange=e=>load(e.target.files[0],v=>photo=v);$("pan-sign").onchange=e=>load(e.target.files[0],v=>signature=v);
  f.onsubmit=e=>{e.preventDefault();const r=Object.fromEntries(new FormData(f).entries()),minor=r.kind==="Minor"||(r.kind==="Auto detect from DOB"&&age(r.dob)<18);if(minor&&!r.ra_pan&&!r.ra_aadhaar)return alert("Minor applicant: enter RA PAN or RA Aadhaar.");if(r.aadhaar&&r.aadhaar.replace(/\D/g,"").length!==12)return alert("Applicant Aadhaar must be 12 digits.");if(r.ra_aadhaar&&r.ra_aadhaar.replace(/\D/g,"").length!==12)return alert("RA Aadhaar must be 12 digits.");if(mode==="correction"&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test((r.pan||"").toUpperCase()))return alert("Enter valid PAN.");r.kind=minor?"Minor":"Adult";r.mode=mode;r.photo=photo;r.signature=signature;const n=Number(localStorage.getItem("slv_pan_seq")||0)+1;localStorage.setItem("slv_pan_seq",String(n));r.temp_ack="SLV-PAN-"+new Date().getFullYear()+"-"+String(n).padStart(6,"0");r.actual_ack="";r.status="Details Saved";try{const a=read();a.unshift(r);write(a)}catch{return alert("Browser storage full. Use smaller images.")}$("pan-message").textContent="Saved locally · "+r.temp_ack;print(r)};
 }
 function search(){
  root.innerHTML='<div class="pan-search-row"><input id="pan-q" placeholder="Search name / mobile / Temporary Ack"><button id="pan-find">Search</button></div><div id="pan-results"></div>';
  const run=()=>{const q=$("pan-q").value.toLowerCase(),a=read().filter(r=>!q||[r.name,r.mobile,r.temp_ack,r.actual_ack].some(v=>String(v||"").toLowerCase().includes(q)));$("pan-results").innerHTML=a.map(r=>'<p><b>'+esc(r.name)+'</b> · '+esc(r.mobile)+' · '+esc(r.temp_ack)+' · '+esc(r.actual_ack)+' <button data-link="'+r.temp_ack+'">Link Ack</button> <button data-print="'+r.temp_ack+'">Print</button></p>').join("")||"No records";root.querySelectorAll("[data-link]").forEach(b=>b.onclick=()=>{const r=read().find(x=>x.temp_ack===b.dataset.link),v=prompt("Enter official acknowledgement number",r.actual_ack||"");if(v===null)return;r.actual_ack=v.trim();r.status="Actual Ack Linked";write(read().map(x=>x.temp_ack===r.temp_ack?r:x));run()});root.querySelectorAll("[data-print]").forEach(b=>b.onclick=()=>print(read().find(x=>x.temp_ack===b.dataset.print)))};
  $("pan-find").onclick=run;run();
 }
 $("pan-new").onclick=()=>form("new");$("pan-corr").onclick=()=>form("correction");$("pan-search").onclick=search;form("new");
}


const announcementMeta={
 festive:{label:"Festive Wishes",icon:"🎉"},
 holiday:{label:"Holiday Declaration",icon:"📅"},
 important:{label:"Important Announcement",icon:"📢"}
};
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
