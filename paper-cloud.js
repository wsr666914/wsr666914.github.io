(function(){
  "use strict";

  const project = "https://iwuwgomdyibaqjojltbw.supabase.co";
  const publicKey = "sb_publishable_J_MM34HOtZcp7gQ2Ye_biw_iNqv4IW0";
  const dialog = document.getElementById("prCloudDialog");
  const form = document.getElementById("prCloudAuth");
  const status = document.getElementById("prCloudStatus");
  const actions = document.getElementById("prCloudActions");
  const compare = document.getElementById("prCloudSync");
  const upload = document.createElement("button");
  const download = document.createElement("button");
  upload.textContent = "将本机版本上传";
  download.textContent = "将云端版本存到本机";
  for(const button of [upload, download]){
    button.type = "button";
    button.className = "modal-btn";
    button.hidden = true;
    actions.insertBefore(button, compare.nextSibling);
  }

  const fingerprints = new WeakMap();
  let session, binding, comparison, busy = false, siteMode = false;

  async function request(path, method, body, accessToken, prefer){
    const headers = {apikey:publicKey};
    if(body !== undefined) headers["Content-Type"] = "application/json";
    if(accessToken) headers.Authorization = "Bearer " + accessToken;
    if(prefer) headers.Prefer = prefer;
    const response = await fetch(project + path, {
      method, headers, body:body === undefined ? undefined : JSON.stringify(body),
      signal:AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(function(){ return null; });
    if(!response.ok){
      const error = new Error("云端请求失败");
      error.status = response.status;
      error.code = data?.error_code || data?.code;
      throw error;
    }
    return data;
  }

  function sessionKey(){ return STORAGE_KEY + "_paperCloudSession"; }

  function rememberSession(value){
    session = {...value, expires_at:value.expires_at || Math.floor(Date.now() / 1000) + value.expires_in};
    sessionStorage.setItem(sessionKey(), JSON.stringify(session));
  }

  async function accessToken(){
    if(!session?.user?.id) throw new Error("请先登录云端账号。");
    if(Date.now() + 30000 < session.expires_at * 1000) return session.access_token;
    try{
      rememberSession(await request("/auth/v1/token?grant_type=refresh_token", "POST", {
        refresh_token:session.refresh_token
      }));
      return session.access_token;
    }catch(error){
      if(error.status === 400 || error.status === 401){
        sessionStorage.removeItem(sessionKey());
        session = null;
        updateDialog();
        throw new Error("云端登录已过期，请重新登录。");
      }
      throw error;
    }
  }

  function updateDialog(){
    document.getElementById("prCloudTitle").textContent = siteMode ? "全站云同步" : "论文云同步";
    compare.textContent = siteMode ? "比较本机与云端备份" : "比较并同步本篇";
    form.hidden = Boolean(session);
    actions.hidden = !session;
    upload.hidden = !comparison;
    download.hidden = !comparison?.remote;
    for(const button of dialog.querySelectorAll("button")) button.disabled = busy;
  }

  async function run(action){
    if(busy) return;
    busy = true;
    updateDialog();
    try{ await action(); }
    catch(error){
      status.textContent = error.code === "email_not_confirmed" ? "请先点击注册邮件中的确认链接。"
        : error.code === "invalid_credentials" ? "邮箱或云端密码不正确。"
        : error.status === 409 ? "云端版本刚刚更新，请重新比较。"
        : error.code === "email_address_not_authorized" ? "当前云项目只允许项目成员接收注册邮件。"
        : error.status === 429 ? "操作过于频繁，请稍后重试。"
        : error.name === "AbortError" || error.name === "TimeoutError" || error instanceof TypeError ? "无法连接云端，请检查网络后重试。"
        : error.message;
    }finally{
      busy = false;
      updateDialog();
    }
  }

  async function paperKey(item){
    if(fingerprints.has(item)) return fingerprints.get(item);
    const bytes = await getOriginalPdf(item);
    if(!bytes) return "item:" + item.id;
    const buffer = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    const key = "pdf:" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,"0")).join("");
    fingerprints.set(item,key);
    return key;
  }

  function activePaper(){
    const item = state.items.find(entry => entry.id === prState.itemId);
    if(binding !== STORAGE_KEY || !item || item.category !== "paper") throw new Error("请重新打开需要同步的论文。");
    return item;
  }

  function canonicalJson(value){
    return JSON.stringify(value, function(key, part){
      if(!part || typeof part !== "object" || Array.isArray(part)) return part;
      return Object.fromEntries(Object.keys(part).sort().map(name => [name, part[name]]));
    });
  }

  function localVersion(item){
    return {
      position:getPaperPosition(item.id),
      annotations:structuredClone(item.highlights || [])
    };
  }

  function compareVersions(){
    comparison = null;
    return run(async function(){
      const item = activePaper();
      if(prState.saving || prState.dirty) throw new Error("请先保存当前论文的修改，再比较云端版本。");
      savePaperPosition();
      const key = await paperKey(item);
      const filter = "?paper_id=eq." + encodeURIComponent(key) + "&user_id=eq." + encodeURIComponent(session.user.id);
      const url = "/rest/v1/paper_reading_state";
      const token = await accessToken();
      const rows = await request(url + filter + "&select=position,annotations,updated_at", "GET", undefined, token);
      const remote = rows[0];
      const local = localVersion(item);
      if(remote && canonicalJson(remote.annotations) === canonicalJson(local.annotations)
        && canonicalJson(remote.position) === canonicalJson(local.position)){
        status.textContent = "本机和云端版本一致。";
        return;
      }
      comparison = {item,key,filter,url,remote,local};
      status.textContent = remote
        ? "本机 " + local.annotations.length + " 条批注，云端 " + remote.annotations.length + " 条批注。请选择要保留的版本。"
        : "云端还没有这篇论文的记录，可以上传本机版本。";
    });
  }

  function openCloud(mode){
    siteMode = mode;
    if(!currentUser){
      toast("请先进入网站账号或游客模式。");
      return;
    }
    if(busy) return;
    binding = STORAGE_KEY;
    comparison = null;
    try{ session = JSON.parse(sessionStorage.getItem(sessionKey())); }catch(error){ session = null; }
    status.textContent = session?.user?.email ? "已登录 " + session.user.email : "";
    updateDialog();
    dialog.showModal();
  }
  document.getElementById("prCloudOpen").addEventListener("click", () => openCloud(false));
  document.getElementById("siteCloudOpen").addEventListener("click", () => openCloud(true));

  dialog.addEventListener("cancel", function(event){ if(busy) event.preventDefault(); });

  form.addEventListener("submit", function(event){
    event.preventDefault();
    const signup = event.submitter?.value === "signup";
    const credentials = {email:form.elements.email.value.trim(), password:form.elements.password.value};
    form.elements.password.value = "";
    run(async function(){
      const response = await request(signup ? "/auth/v1/signup?redirect_to=" + encodeURIComponent("https://wsr666914.github.io/")
        : "/auth/v1/token?grant_type=password", "POST", credentials);
      if(response.access_token){
        rememberSession(response);
        status.textContent = "已登录 " + response.user.email;
      }else{
        status.textContent = "请打开注册邮件确认邮箱，然后返回这里登录。";
      }
    });
  });

  const siteTable = "/rest/v1/site_cloud_backup";

  async function sitePointer(token){
    const rows = await request(siteTable + "?select=file_name,updated_at", "GET", undefined, token);
    return rows[0];
  }

  async function siteFile(token, fileName, method, blob){
    const folder = session.user.id;
    const name = folder + "/" + fileName + ".zip";
    const authenticated = method === "GET" ? "authenticated/" : "";
    const path = method === "DELETE" ? "" : "/" + name;
    const headers = {apikey:publicKey, Authorization:"Bearer " + token};
    if(method === "POST") headers["Content-Type"] = "application/zip";
    if(method === "DELETE") headers["Content-Type"] = "application/json";
    const response = await fetch(project + "/storage/v1/object/" + authenticated + "site-backups" + path, {
      method, headers, body:method === "DELETE" ? JSON.stringify({prefixes:[name]}) : blob,
      signal:AbortSignal.timeout(120000)
    });
    if(!response.ok) throw new Error("全站备份文件访问失败，请检查网络与云端空间。");
    return method === "GET" ? response.blob() : undefined;
  }

  async function compareSite(){
    comparison = null;
    const remote = await sitePointer(await accessToken());
    comparison = {remote};
    status.textContent = remote
      ? "本机有 " + state.items.length + " 条志录。云端备份时间为 " + new Date(remote.updated_at).toLocaleString() + "。请选择上传或恢复。"
      : "云端还没有全站备份。可以上传首页志录、回收站、论文批注、阅读位置和本机保留的原 PDF。";
  }

  async function uploadSite(selected){
    const {blob} = await buildSiteBackup(true);
    if(blob.size > 50000000) throw new Error("全站备份超过免费版 50 MB 单文件上限，已保留现有云端版本。");
    const token = await accessToken();
    const old = selected.remote?.file_name;
    const fresh = (await sitePointer(token))?.file_name;
    if(old !== fresh) throw new Error("云端备份刚刚更新，请重新比较。");
    const name = crypto.randomUUID();
    await siteFile(token, name, "POST", blob);
    const payload = {file_name:name, updated_at:new Date().toISOString()};
    let rows;
    try{
      rows = await request(old ? siteTable + "?file_name=eq." + encodeURIComponent(old) : siteTable,
        old ? "PATCH" : "POST", payload, token, "return=representation");
    }catch(error){
      const live = await sitePointer(token);
      if(live?.file_name !== name){
        await siteFile(token, name, "DELETE").catch(() => {});
        throw error;
      }
      rows = [live];
    }
    if(!rows?.length){
      await siteFile(token, name, "DELETE").catch(() => {});
      throw new Error("云端备份刚刚更新，请重新比较。");
    }
    if(old) await siteFile(token, old, "DELETE").catch(() => {});
    status.textContent = "全站备份已上传。";
  }

  async function downloadSite(selected){
    if(!selected?.remote) return;
    const blob = await siteFile(await accessToken(), selected.remote.file_name, "GET");
    if(binding !== STORAGE_KEY) throw new Error("网站账号已切换，请重新打开全站云同步。");
    dialog.close();
    await handleImportFile(new File([blob], "全站云备份.zip", {type:"application/zip"}), true);
  }

  compare.addEventListener("click", () => siteMode ? run(compareSite) : compareVersions());
  upload.addEventListener("click", function(){
    run(async function(){
      const selected = comparison;
      comparison = null;
      if(siteMode && selected) return uploadSite(selected);
      if(!selected || activePaper() !== selected.item || prState.dirty || prState.saving)
        throw new Error("论文已更改，请保存后重新比较。");
      const token = await accessToken();
      const previous = selected.remote?.updated_at;
      const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
      const payload = {...selected.local, updated_at:updatedAt};
      const rows = previous
        ? await request(selected.url + selected.filter + "&updated_at=eq." + encodeURIComponent(previous),
          "PATCH", payload, token, "return=representation")
        : await request(selected.url, "POST", {...payload, paper_id:selected.key},
          token, "return=representation");
      status.textContent = rows?.length ? "阅读位置和批注已保存到云端。" : "云端版本刚刚更新，请重新比较。";
    });
  });

  download.addEventListener("click", function(){
    run(async function(){
      const selected = comparison;
      comparison = null;
      if(siteMode) return downloadSite(selected);
      const item = activePaper();
      if(!selected?.remote || item !== selected.item || prState.dirty || prState.saving)
        throw new Error("论文已更改，请保存后重新比较。");
      const prior = item.highlights;
      item.highlights = selected.remote.annotations;
      if(!await saveState()){
        item.highlights = prior;
        throw new Error("本机保存失败，原有批注已恢复。");
      }
      const key = STORAGE_KEY + "_readpos_" + item.id;
      const position = selected.remote.position;
      if(position) localStorage.setItem(key, JSON.stringify(position));
      else localStorage.removeItem(key);
      prState.snapshot = snapshotPaper(item);
      prState.history = [];
      prState.redoHistory = [];
      prState.resume = position;
      refreshHighlightsRender(item);
      restorePaperPosition(item.id, true);
      status.textContent = "已将云端版本保存到本机。";
    });
  });

  document.getElementById("prCloudLogout").addEventListener("click", function(){
    run(async function(){
      const token = await accessToken();
      await request("/auth/v1/logout?scope=local", "POST", undefined, token);
      sessionStorage.removeItem(sessionKey());
      session = null;
      comparison = null;
      status.textContent = "已退出云端账号。";
    });
  });
})();
