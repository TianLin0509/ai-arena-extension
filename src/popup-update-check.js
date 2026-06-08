// popup-update-check.js — v5.2.0 检查更新
// 调 GitHub Releases API 拿 latest tag，跟本地 manifest 比对，弹守门员风 modal
// 节流：24h 内不重复自动检查；用户主动点按钮永远立即检查
// 提示去重：用户点过"暂不更新"的版本不再自动弹提示，但按钮还能手动看
//
// 用法：
//   window.ChatUpdateCheck.checkAndShow({ manual: true })   // 手动按钮触发
//   window.ChatUpdateCheck.checkAndShow({ manual: false })  // popup 启动自动检查

(function () {
  const REPO_OWNER = "TianLin0509";
  const REPO_NAME  = "ai-arena-extension";
  const API_URL    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

  const KEY_LAST_AUTO_CHECK  = "updateCheckLastAuto";       // 上次自动检查时间戳
  const KEY_DISMISSED_VERSION = "updateCheckDismissedVer";  // 用户点过"暂不更新"的版本
  const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;       // 24h 节流

  // 当前版本（来自 manifest）
  function currentVersion() {
    try {
      const m = chrome.runtime.getManifest();
      return m.version_name || m.version || "unknown";
    } catch (_) { return "unknown"; }
  }

  // 解析 "v5.1.0-beta" / "5.1.0" → { nums: [5,1,0], pre: "beta" }
  // 解析失败返回 null（hasNewer 据此 fail-safe 为 false，不乱弹）
  function parseSemver(s) {
    const m = String(s || "").trim().replace(/^v/i, "")
      .match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?$/);
    if (!m) return null;
    return {
      nums: [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || "0", 10)],
      pre: m[4] || "",
    };
  }

  // a vs b: -1 / 0 / 1。规则：主次补段按数字比；pre-release 段（-beta 等）按 semver 视为更小
  function compareSemver(a, b) {
    const pa = parseSemver(a), pb = parseSemver(b);
    if (!pa || !pb) return 0;
    for (let i = 0; i < 3; i++) {
      if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
    }
    if (pa.pre && !pb.pre) return -1;
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre < pb.pre) return -1;
    if (pa.pre > pb.pre) return 1;
    return 0;
  }

  // 判断 latest 是否严格比 current 新（latest > current 才提示）
  // 避免反向 bug：当 GitHub latest 因任何原因回退到老版本时，新版本用户不再被错误提示
  function hasNewer(currentVer, latestTag) {
    return compareSemver(currentVer, latestTag) < 0;
  }

  async function fetchLatestRelease() {
    const r = await fetch(API_URL, {
      method: "GET",
      headers: { "Accept": "application/vnd.github+json" },
    });
    if (r.status === 403) {
      // GitHub 限流（无 token 时 60 次/小时/IP）
      throw new Error("GitHub API 限流（每小时 60 次），请稍后再试");
    }
    if (!r.ok) {
      throw new Error(`GitHub API 异常 HTTP ${r.status}`);
    }
    const j = await r.json();
    return {
      tag: j.tag_name || "",
      htmlUrl: j.html_url || RELEASES_URL,
      publishedAt: j.published_at || "",
      body: j.body || "",
      assets: (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    };
  }

  // 截取 changelog 前 5 行做预览（body 是 markdown）
  function changelogPreview(body, maxLines = 5) {
    if (!body) return "";
    const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const slice = lines.slice(0, maxLines);
    return slice.join("\n") + (lines.length > maxLines ? `\n…（共 ${lines.length} 行，点「查看完整 changelog」看全部）` : "");
  }

  // 找 zip 资产（src 包优先）
  function pickZipAsset(release) {
    if (!release.assets?.length) return null;
    return release.assets.find(a => /\.zip$/i.test(a.name)) || release.assets[0];
  }

  async function bumpLastAutoCheck() {
    try {
      await new Promise(r => chrome.storage.local.set({ [KEY_LAST_AUTO_CHECK]: Date.now() }, r));
    } catch (_) {}
  }

  async function getLastAutoCheck() {
    try {
      const r = await new Promise(res => chrome.storage.local.get([KEY_LAST_AUTO_CHECK], resp => res(resp || {})));
      return r[KEY_LAST_AUTO_CHECK] || 0;
    } catch (_) { return 0; }
  }

  async function getDismissedVersion() {
    try {
      const r = await new Promise(res => chrome.storage.local.get([KEY_DISMISSED_VERSION], resp => res(resp || {})));
      return r[KEY_DISMISSED_VERSION] || "";
    } catch (_) { return ""; }
  }

  async function setDismissedVersion(tag) {
    try {
      await new Promise(r => chrome.storage.local.set({ [KEY_DISMISSED_VERSION]: tag }, r));
    } catch (_) {}
  }

  function openInTab(url) {
    try {
      chrome.tabs?.create?.({ url });
    } catch (_) {
      try { window.open(url, "_blank"); } catch (__) {}
    }
  }

  // 弹 "发现新版" modal
  function showHasNewerModal(release, cur) {
    if (!window.ChatModal?.show) return;
    const tag = release.tag;
    const zipAsset = pickZipAsset(release);
    const downloadUrl = zipAsset ? zipAsset.url : release.htmlUrl;
    const sizeMb = zipAsset ? (zipAsset.size / 1024 / 1024).toFixed(2) + " MB" : "";
    const preview = changelogPreview(release.body, 5);

    window.ChatModal.show({
      tone: "info",
      icon: "🆙",
      title: `发现新版本 ${tag}`,
      message: `当前 v${cur} → 最新 ${tag}${sizeMb ? "（zip " + sizeMb + "）" : ""}`,
      tip: preview || "（无 changelog）",
      primary: {
        label: "下载新版 .zip",
        onClick: () => openInTab(downloadUrl),
      },
      secondary: {
        label: "查看完整 changelog",
        onClick: () => openInTab(release.htmlUrl),
      },
      cancel: { label: "暂不更新（本版本不再自动提示）" },
    });

    // 用户关 modal（任意非 primary/secondary）→ 记当前 tag 为 dismissed
    // 这是个粗略处理：onCancel 没在 show() API 里独立暴露，只能在 cancel 按钮 / Escape / 点遮罩时通过 ChatModal 内部 close 触发
    // 我们用兜底：modal 弹出后 1s 检查，如果 modal 仍在则 OK；否则视为用户已关（cancel/ESC/遮罩三种都算 dismiss）
    // 简单做法：直接在弹之前先记，假定用户看完会关。如果用户点了 primary/secondary 也算"看到过"，记下没坏处
    setDismissedVersion(tag);
  }

  // 弹 "已是最新" modal
  function showUpToDateModal(cur) {
    if (!window.ChatModal?.show) return;
    window.ChatModal.show({
      tone: "info",
      icon: "✓",
      title: "已是最新版",
      message: `当前 v${cur} 是 GitHub Releases 上的最新版本`,
      tip: "下次发布会自动提示（每 24 小时检查一次，或随时点顶栏「↻ 检查更新」手动查）",
      primary: { label: "知道了", onClick: () => {} },
      cancel: { label: "关闭" },
    });
  }

  // 弹 "检查失败" 提示
  function showErrorModal(errMsg) {
    if (!window.ChatModal?.show) return;
    window.ChatModal.show({
      tone: "warning",
      icon: "⚠",
      title: "检查更新失败",
      message: errMsg || "网络异常或 GitHub API 不可用",
      tip: "你也可以直接去 GitHub Releases 看：" + RELEASES_URL,
      primary: { label: "去 GitHub 看", onClick: () => openInTab(RELEASES_URL) },
      cancel: { label: "稍后再试" },
    });
  }

  // 核心：手动 / 自动检查
  //   opts.manual: true = 用户主动点按钮（无版本即弹"已是最新"或失败弹错）
  //                false = 自动检查（无新版静默；同版本被 dismissed 也静默）
  async function checkAndShow(opts) {
    const manual = !!opts?.manual;
    const cur = currentVersion();

    // 自动检查路径：24h 节流
    if (!manual) {
      const last = await getLastAutoCheck();
      if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return { skipped: "throttled" };
    }

    let release;
    try {
      release = await fetchLatestRelease();
    } catch (e) {
      if (manual) showErrorModal(e.message);
      return { error: e.message };
    }

    // 自动检查时更新节流时间
    if (!manual) await bumpLastAutoCheck();

    if (!hasNewer(cur, release.tag)) {
      if (manual) showUpToDateModal(cur);
      return { upToDate: true, cur, latest: release.tag };
    }

    // 自动模式：用户已 dismiss 当前版本 → 静默不弹
    if (!manual) {
      const dismissed = await getDismissedVersion();
      if (dismissed === release.tag) return { skipped: "dismissed", tag: release.tag };
    }

    showHasNewerModal(release, cur);
    return { hasNewer: true, cur, latest: release.tag };
  }

  // popup 启动时自动调一次（24h 节流，无新版静默）
  function scheduleAutoCheck() {
    // 推迟 3s 避免跟其他启动逻辑抢资源
    setTimeout(() => {
      checkAndShow({ manual: false }).catch(() => {});
    }, 3000);
  }

  window.ChatUpdateCheck = {
    checkAndShow,
    currentVersion,
    _hasNewer: hasNewer,  // 测试用
  };

  // popup 加载完自动启动节流检查
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleAutoCheck);
  } else {
    scheduleAutoCheck();
  }
})();
