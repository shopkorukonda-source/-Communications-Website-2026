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
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  appScreen.classList.toggle("admin-mode", profile.role === "admin");
  $("user-name").textContent = profile.display_name || user.email;
  $("user-role").textContent = profile.role;
  $("avatar").textContent = (profile.display_name || user.email || "S").slice(0,1).toUpperCase();
  const hour = new Date().getHours();
  $("greeting").textContent = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  $("today-date").textContent = new Intl.DateTimeFormat("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(new Date());
  await loadCatalog();
}

async function loadCatalog() {
  const grid = $("category-grid");
  grid.innerHTML = '<div class="loading-card">Loading categories…</div>';
  const [{data: cats, error: catError},{data: rows,error: serviceError}] = await Promise.all([
    supabase.from("service_categories").select("id,name,slug,sort_order,is_active").order("sort_order"),
    supabase.from("services").select("id,category_id,name,code,description,billing_type,processing_cost_type,profit_mode,billing_config,processing_cost_config,profit_config,sort_order,is_active").order("sort_order")
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
}

const icons = ["▣","◉","↗","▤","◇","✦"];
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
  if(view==="overview"){ $("page-title").textContent="Overview"; return; }
  $("page-title").textContent=btn.textContent.trim();
  if(view==="billing") {
    await renderQuickBilling();
  } else if(view==="services") {
    await renderServiceManager();
  } else if(view==="wallets") {
    await renderWalletManager();
  } else if(view==="reports") {
    await renderReports();
  } else if(view==="employees") {
    await renderEmployeeManager();
  } else if(["drawers","attendance","leave","payroll","ucl","expenses","settlement"].includes(view)) {
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
  let selectedWallets=[];
  if(s){
    const {data}=await supabase.from("service_wallet_rules").select("wallet_id").eq("service_id",id);
    selectedWallets=(data||[]).map(x=>x.wallet_id);
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
      <div class="wallet-map-box"><strong>Processing wallets</strong><p>Select any number of wallets. Order follows the selection list below.</p><div class="wallet-choice-grid">${walletOptions.map(w=>`<label class="wallet-choice"><input type="checkbox" value="${w.id}" ${selectedWallets.includes(w.id)?"checked":""} ${w.is_active?"":"disabled"}><span>${escapeHtml(w.name)} <small>${escapeHtml(w.provider||w.wallet_type)}</small></span></label>`).join("")||'<small>No wallets created yet. Add wallets from Wallets section.</small>'}</div></div>
      <label class="inline-check"><input id="svc-active" type="checkbox" ${s?.is_active===false?"":"checked"}> Service active</label>
      <div id="service-form-message" class="message"></div>
      <div class="admin-form-actions"><button type="button" class="text-btn" id="cancel-service">Cancel</button><button type="submit" class="primary-btn" id="save-service-btn">Save service</button></div>
    </form>`;
  $("svc-billing").value=s?.billing_type||"fixed";
  $("svc-cost").value=s?.processing_cost_type||"fixed";
  $("svc-profit").value=s?.profit_mode||"manual";
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
    const chosen=[...document.querySelectorAll(".wallet-choice input:checked")].map((el,i)=>({service_id:saved.id,wallet_id:el.value,wallet_slot:i+1,debit_order:1,debit_config:{},is_required:true}));
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
    <div class="admin-editor"><h3>Wallet transfer</h3><form id="transfer-form" class="service-form">
      <div class="admin-form-grid"><label>From wallet<select id="transfer-from" required></select></label><label>To wallet<select id="transfer-to" required></select></label><label>Amount (₹)<input id="transfer-amount" type="number" min="0.01" step="0.01" required></label></div>
      <label>Note<input id="transfer-note" maxlength="200" placeholder="Optional transfer note"></label><div id="transfer-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit" id="transfer-save">Transfer balance</button>
    </form></div>
    <div class="admin-table-wrap"><div class="admin-table-head"><h3>All wallets</h3><input id="wallet-search" class="search-input" placeholder="Search wallets"></div><div id="wallet-rows"></div></div>`;
  fillTransferWallets();renderWalletRows();
  $("wallet-form").addEventListener("submit",createWallet);
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
async function renderReports(){
  const host=$("other-view");host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Reports</h2><p>Billing totals and profit summaries for your shop.</p></div><select id="report-period" class="search-input"><option value="day">Today</option><option value="week">Last 7 days</option><option value="month">This month</option></select></div>
    <div class="admin-module-stats"><div><small>Customer collections</small><strong id="report-sales">₹0.00</strong></div><div><small>Processing cost</small><strong id="report-cost">₹0.00</strong></div><div><small>Profit</small><strong id="report-profit">₹0.00</strong></div></div>
    <div class="admin-table-wrap"><h3>Recent bills</h3><div id="report-rows"></div></div>`;
  $("report-period").addEventListener("change",loadReportsData);await loadReportsData();
}
async function loadReportsData(){
  const period=$("report-period").value,now=new Date(),start=new Date(now);
  if(period==="day")start.setHours(0,0,0,0);else if(period==="week")start.setDate(start.getDate()-6);else start.setDate(1);
  const {data,error}=await supabase.from("billing_transactions").select("id,bill_number,customer_name,customer_total,processing_total,profit_total,payment_mode,created_at").gte("created_at",start.toISOString()).order("created_at",{ascending:false}).limit(100);
  if(error){$("report-rows").innerHTML='<div class="empty-state">Unable to load reports.</div>';return;}
  const rows=data||[],sum=k=>rows.reduce((a,x)=>a+Number(x[k]||0),0);
  $("report-sales").textContent="₹"+sum("customer_total").toFixed(2);$("report-cost").textContent="₹"+sum("processing_total").toFixed(2);$("report-profit").textContent="₹"+sum("profit_total").toFixed(2);
  $("report-rows").innerHTML=rows.length?rows.map(x=>`<div class="admin-service-row"><div class="admin-service-main"><strong>Bill #${x.bill_number}</strong><small>${escapeHtml(x.customer_name||"Walk-in customer")} · ${new Date(x.created_at).toLocaleString("en-IN")}</small></div><div class="admin-service-meta"><strong>₹${Number(x.customer_total).toFixed(2)}</strong><span>Profit ₹${Number(x.profit_total).toFixed(2)}</span></div><div class="admin-service-meta"><span>${escapeHtml(x.payment_mode)}</span></div></div>`).join(""):'<div class="empty-state">No bills in this period.</div>';
}
async function renderEmployeeManager(){
  const host=$("other-view");host.innerHTML=`
    <div class="admin-module-head"><div><div class="eyebrow">ADMINISTRATION</div><h2>Employees</h2><p>Maintain employee details and salary settings.</p></div></div>
    <div class="admin-editor"><h3>Add employee record</h3><form id="employee-form" class="service-form"><div class="admin-form-grid"><label>Full name<input id="employee-name" required maxlength="120"></label><label>Mobile number<input id="employee-phone" maxlength="20"></label><label>Monthly fixed salary (₹)<input id="employee-salary" type="number" min="0" step="0.01" value="0"></label></div><div id="employee-message" class="message"></div><button class="primary-btn admin-add-btn" type="submit">Add employee</button></form></div>
    <div class="admin-table-wrap"><h3>Employee records</h3><div id="employee-rows"></div></div>`;
  $("employee-form").addEventListener("submit",createEmployee);
  const {data,error}=await supabase.from("employees").select("id,employee_code,full_name,phone,monthly_salary,is_active,joined_on").order("created_at",{ascending:false});
  if(error){$("employee-rows").innerHTML='<div class="empty-state">Unable to load employee records.</div>';return;}
  $("employee-rows").innerHTML=(data||[]).length?data.map(x=>`<div class="admin-service-row"><div class="admin-service-main"><strong>${escapeHtml(x.full_name)}</strong><small>${escapeHtml(x.phone||"No mobile")} · ${escapeHtml(x.employee_code||"No code")}</small></div><div class="admin-service-meta"><strong>₹${Number(x.monthly_salary).toFixed(2)} / month</strong><span class="status-pill ${x.is_active?"is-active":"is-inactive"}">${x.is_active?"Active":"Inactive"}</span></div><div class="admin-service-actions"><button data-employee-toggle="${x.id}" data-active="${x.is_active}">${x.is_active?"Deactivate":"Activate"}</button></div></div>`).join(""):'<div class="empty-state">No employees added yet.</div>';
  document.querySelectorAll("[data-employee-toggle]").forEach(b=>b.addEventListener("click",async()=>{const {error}=await supabase.from("employees").update({is_active:b.dataset.active!=="true"}).eq("id",b.dataset.employeeToggle);if(error)alert(error.message);else await renderEmployeeManager();}));
}
async function createEmployee(e){
  e.preventDefault();const msg=$("employee-message");
  const payload={full_name:$("employee-name").value.trim(),phone:$("employee-phone").value.trim()||null,monthly_salary:Number($("employee-salary").value)||0,is_active:true,joined_on:new Date().toISOString().slice(0,10)};
  const {error}=await supabase.from("employees").insert(payload);
  if(error){msg.textContent=error.message;return;}msg.textContent="Employee record created. Login account can be linked separately.";await renderEmployeeManager();
}


let billingRows = [];
let billingWalletRules = {};
function money(n){return Number(n||0).toFixed(2);}
function serviceByCode(code){return services.find(s=>s.code===code);}
function calculateBillingRow(row){
  const svc=services.find(s=>s.id===row.service_id), amount=Number(row.base||0);
  if(!svc||!amount)return {charge:0,cost:0,profit:0,total:0};
  let charge=0,cost=Number(row.cost||0),profit=0;
  if(svc.code==="CURRENT_BILLS"){
    const cfg=svc.billing_config||{}, slabs=cfg.slabs||[];
    const slab=slabs.find(x=>amount>=Number(x.min)&&amount<=Number(x.max));
    if(slab){charge=Number(slab.customer_charge||0);cost=slab.wallet_extra==null?Number(row.cost||0):Number(slab.wallet_extra);}
    else if(amount>1000){charge=10+Math.ceil((amount-1000)/100)*Number(cfg.above_1000?.extra_per_100||1);cost=Number(row.cost||0);}
  } else if(svc.code==="CREDIT_CARD_BANK"){
    charge=Math.round((amount*Number(svc.billing_config?.charge_percent||2)/100)*100)/100;
    cost=Number(row.cost||0);
  } else if(svc.code==="AEPS_WITHDRAWAL"){
    const bank=(row.bank||"").toLowerCase();
    charge=bank.includes("union")?0:Math.ceil(amount/1000)*Number(svc.billing_config?.charge_per_1000||10);
    cost=Number(row.cost||0);
  } else {
    charge=Number(row.charge||0);
    cost=Number(row.cost||0);
  }
  profit=charge-cost;
  return {charge,cost,profit,total:amount+charge};
}
async function renderQuickBilling(){
  const host=$("other-view");
  host.innerHTML=`
  <div class="admin-module-head"><div><div class="eyebrow">QUICK BILLING</div><h2>Multiple Bill Entry</h2><p>Enter all bills together and collect payment in one submission.</p></div></div>
  <div class="admin-editor billing-editor">
    <div class="billing-top"><label>Number of bills<input id="bill-count" type="number" min="1" max="100" value="1"></label><label>Customer name<input id="bill-customer" placeholder="Optional"></label><label>Customer mobile<input id="bill-phone" placeholder="Optional"></label></div>
    <div id="billing-rows"></div>
    <div class="billing-totals" id="billing-totals"></div>
    <div class="billing-payment">
      <label>Payment mode<select id="bill-mode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="split">Cash + UPI</option></select></label>
      <label>Amount received (₹)<input id="bill-received" type="number" min="0" step="0.01" value="0"></label>
      <label id="cash-paid-wrap">Cash received (₹)<input id="bill-cash" type="number" min="0" step="0.01" value="0"></label>
      <label id="upi-paid-wrap" class="hidden">UPI received (₹)<input id="bill-upi" type="number" min="0" step="0.01" value="0"></label>
    </div>
    <div class="billing-change" id="bill-change">Change: ₹0.00</div>
    <div id="billing-message" class="message"></div>
    <button id="save-billing" class="primary-btn admin-add-btn">Save all bills</button>
  </div>
  <div class="admin-table-wrap"><h3>Recent bills & edit window</h3><div id="recent-bills"></div></div>`;
  $("save-billing").addEventListener("click",saveQuickBilling);
  const count=$("bill-count");
  count.addEventListener("change",()=>{let n=Math.max(1,Math.min(100,Number(count.value)||1));count.value=n;setBillingRows(n);});
  $("bill-mode").addEventListener("change",updatePaymentFields);
  ["bill-received","bill-cash","bill-upi"].forEach(id=>$(id).addEventListener("input",updateBillingTotals));
  setBillingRows(1);await loadRecentBills();
}
async function setBillingRows(n){
  const {data:rules}=await supabase.from("service_wallet_rules").select("service_id,wallet_id,wallet_slot,debit_config").order("wallet_slot");
  billingWalletRules={};(rules||[]).forEach(x=>(billingWalletRules[x.service_id]??=[]).push(x));
  billingRows=Array.from({length:n},(_,i)=>billingRows[i]||({service_id:"",base:"",charge:"",cost:"",wallet_id:"",wallet_debit:"",bank:""}));
  $("billing-rows").innerHTML=billingRows.map((r,i)=>`
  <div class="billing-row" data-row="${i}">
    <div class="billing-row-head"><strong>Bill ${i+1}</strong><span class="billing-row-total" id="row-total-${i}">₹0.00</span></div>
    <div class="billing-row-fields">
      <label>Service<select data-field="service_id" data-i="${i}"><option value="">Select service</option>${services.filter(s=>s.is_active).map(s=>`<option value="${s.id}" ${s.id===r.service_id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}</select></label>
      <label>Bill / Transfer Amount (₹)<input data-field="base" data-i="${i}" type="number" min="0" step="0.01" value="${escapeHtml(r.base)}"></label>
      <label class="bank-field">Bank (AEPS)<input data-field="bank" data-i="${i}" value="${escapeHtml(r.bank)}" placeholder="Bank name"></label>
      <label>Extra processing cost (₹)<input data-field="cost" data-i="${i}" type="number" min="0" step="0.01" value="${escapeHtml(r.cost)}"></label>
      <label>Wallet<select data-field="wallet_id" data-i="${i}"><option value="">No wallet debit</option>${(billingWalletRules[r.service_id]||[]).map(w=>{const wallet=walletOptions.find(x=>x.id===w.wallet_id);return wallet?`<option value="${wallet.id}" ${r.wallet_id===wallet.id?"selected":""}>${escapeHtml(wallet.name)}</option>`:"";}).join("")}</select></label>
      <label>Wallet debit (₹)<input data-field="wallet_debit" data-i="${i}" type="number" min="0" step="0.01" value="${escapeHtml(r.wallet_debit)}"></label>
    </div>
    <div class="billing-row-result" id="row-result-${i}">Service Charge: ₹0.00 · Profit: ₹0.00</div>
  </div>`).join("");
  $("billing-rows").querySelectorAll("[data-field]").forEach(el=>el.addEventListener("input",onBillingRowChange));
  $("billing-rows").querySelectorAll("[data-field]").forEach(el=>el.addEventListener("change",onBillingRowChange));
  updateBillingTotals();
}
function onBillingRowChange(e){
  const i=Number(e.target.dataset.i),field=e.target.dataset.field;
  billingRows[i][field]=e.target.value;
  if(field==="service_id"){billingRows[i].wallet_id="";billingRows[i].wallet_debit="";setBillingRows(billingRows.length);return;}
  updateBillingTotals();
}
function updateBillingTotals(){
  let base=0,charges=0,costs=0,total=0;
  billingRows.forEach((r,i)=>{
    const calc=calculateBillingRow(r);base+=Number(r.base||0);charges+=calc.charge;costs+=calc.cost;total+=calc.total;
    const t=$("row-total-"+i),res=$("row-result-"+i);
    if(t)t.textContent="₹"+money(calc.total);
    if(res)res.textContent="Service Charge: ₹"+money(calc.charge)+" · Processing Cost: ₹"+money(calc.cost)+" · Profit: ₹"+money(calc.profit);
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
      if(!r.service_id||Number(r.base||0)<=0)throw new Error("Every entered row needs a service and positive bill amount.");
      const svc=services.find(s=>s.id===r.service_id),calc=calculateBillingRow(r);
      if(svc.code==="CURRENT_BILLS"&&Number(r.base)<=200&&Number(r.base)>=10&&!r.wallet_id)throw new Error("Current Bills row needs its assigned wallet.");
      const walletDebit=Number(r.wallet_debit||0)||(svc.code==="CURRENT_BILLS"&&Number(r.base)<=200?Number(r.base)+1.68:0);
      const wallet_debits=walletDebit>0&&r.wallet_id?[{wallet_id:r.wallet_id,amount:walletDebit}]:[];
      if(walletDebit>0&&!r.wallet_id)throw new Error("Select a wallet for the wallet debit on "+svc.name);
      const price=calc.total;
      items.push({service_id:r.service_id,quantity:1,customer_unit_price:price,processing_unit_cost:calc.cost,profit_amount:calc.profit,pricing_snapshot:{base_amount:Number(r.base),service_charge:calc.charge,bank:r.bank||null,wallet_debits},wallet_debits});
      customerTotal+=price;processingTotal+=calc.cost;profitTotal+=calc.profit;
    }
    if(!items.length)throw new Error("Enter at least one bill.");
    const mode=$("bill-mode").value,received=Number($("bill-received").value||0);
    const cash=mode==="upi"?0:mode==="cash"?received:Number($("bill-cash").value||0);
    const upi=mode==="cash"?0:mode==="upi"?received:Number($("bill-upi").value||0);
    if(received<customerTotal)throw new Error("Amount received must be equal to or greater than customer total.");
    if(mode==="split"&&Math.abs(cash+upi-received)>0.009)throw new Error("Cash + UPI must equal amount received.");
    const payload={customer_name:$("bill-customer").value.trim()||null,customer_phone:$("bill-phone").value.trim()||null,payment_mode:mode,customer_total:customerTotal,amount_received:received,cash_received:cash,upi_received:upi,items};
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
  const [{data:bill,error:bErr},{data:items,error:iErr}]=await Promise.all([
    supabase.from("billing_transactions").select("id,customer_name,customer_phone,payment_mode,customer_total,amount_received,cash_received,upi_received,notes,created_at,created_by").eq("id",id).single(),
    supabase.from("billing_items").select("service_id,quantity,customer_unit_price,processing_unit_cost,profit_amount,pricing_snapshot").eq("transaction_id",id)
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
