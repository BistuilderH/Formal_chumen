import './style.css';
import { createBaiduMap } from './map.js';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const defaults = { nickname: '局主', city: '北京', memberLimit: 3, origins: '北京地铁四惠站\n北京丰台站\n北京三里屯', date: '2026-09-30', startTime: '15:00', endTime: '22:00', budgetPerPerson: 500, activities: 'DIY手作,餐厅,酒吧', mustVisit: '', walkMaxMinutes: 15, rideMaxMinutes: 10, accessMaxMinutes: 20 };
const state = { room: null, identity: null, inviteToken: '', requestedRoom: '', selected: '', busy: false, error: '', status: '正在连接后端…', showHistory: false, draft: { ...defaults }, commentDraft: '', preferenceText: '', preferenceSummary: '', preferenceSearchTerms: [], showForm: true, tab: 'plaza', shareId: '', sharedPlan: null, commuteIndex: null, social: JSON.parse(localStorage.getItem('chumen.social') || '{"liked":[],"saved":[]}') };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const minutes = (seconds) => Number.isFinite(seconds) ? `${Math.ceil(seconds / 60)} 分钟` : '暂未核实';
const generationRunning = () => state.room?.generation?.status === 'running';
const visibleCandidates = () => generationRunning() ? (state.room?.generation?.candidates || []) : (state.room?.candidates || []);
const isHost = () => state.room?.viewerRole === 'host' || state.room?.members?.find((member) => member.id === state.identity?.memberId)?.role === 'host';
let pollTimer;

 document.querySelector('#app').innerHTML = `<div class="shell">
  <header class="topbar"><a class="brand" href="#"><span class="brand-mark">出</span><span>出门见</span><small>同城约见路线</small></a><span class="room-chip" id="room-label">真实路线联调</span><button class="ghost-btn" id="share-button" hidden>分享房间 ↗</button></header>
  <main class="layout"><section class="main-column" id="content"></section><aside class="map-panel"><div class="map-top"><span class="map-label"><i></i>公共活动路线</span><button class="map-mode" id="map-mode" disabled>切换 2D / 2.5D</button></div><div id="baidu-map" class="map-canvas"></div><p id="map-status" class="map-status" role="status">正在加载百度地图…</p><div class="map-footer"><div class="map-legend" aria-label="地图图例"><span><i class="legend-line legend-main"></i>主游玩路线</span><span><i class="legend-line legend-commute legend-commute-a"></i>成员 1 通勤</span><span><i class="legend-line legend-commute legend-commute-b"></i>成员 2 通勤</span></div><span class="map-privacy">仅本人和局主可见精确出发地；其他成员的路线会按权限隐藏。</span><span>点击地图后按 Q / E 左右旋转，右键拖动旋转，左键拖动平移。</span></div></aside></main>
  <nav class="bottom-nav" aria-label="主导航"><button data-tab="plaza"><span>◫</span>广场</button><button class="create-tab" data-tab="create" aria-label="创建方案">＋</button><button data-tab="profile"><span>◎</span>我的</button></nav>
  <footer class="statusbar"><span>临时测试房间 · 服务重启后数据会清空</span><span id="connection-status" role="status"></span></footer>
</div>`;

const content = document.querySelector('#content');
const mapView = createBaiduMap(document.querySelector('#baidu-map'), document.querySelector('#map-status'), import.meta.env.VITE_BAIDU_MAP_AK);
mapView.ready.then((ready) => { document.querySelector('#map-mode').disabled = !ready; updateMap(); });
document.querySelector('#map-mode').addEventListener('click', () => mapView.toggleTilt());
document.querySelector('#share-button').addEventListener('click', shareRoom);
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); state.tab = 'plaza'; location.hash = ''; resetRoom(); });

async function api(path, { method = 'GET', body, anonymous = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${apiBase}/api${path}`, {
      method, signal: controller.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(!anonymous && state.identity?.token ? { Authorization: `Bearer ${state.identity.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(typeof result?.error === 'string' ? result.error : result?.error?.message || result?.message || `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      throw error;
    }
    if (!result) throw new Error('后端未返回 JSON，请检查 API 地址是否指向后端服务。');
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接后端，请检查服务是否启动、API 地址和跨域配置。');
    throw error;
  } finally { clearTimeout(timer); }
}

function readIdentity(roomId) {
  try { return JSON.parse(localStorage.getItem(`chumen.room.${roomId}`) || 'null'); } catch { return null; }
}

function saveIdentity(result) {
  const credentials = result.credentials || result;
  state.identity = { memberId: credentials.memberId, token: credentials.token || credentials.memberToken, inviteToken: result.inviteToken || result.room?.inviteToken || state.inviteToken };
  state.inviteToken = state.identity.inviteToken;
  state.requestedRoom = result.room.id;
  try { localStorage.setItem(`chumen.room.${result.room.id}`, JSON.stringify(state.identity)); } catch { toast('当前浏览器无法保存成员身份，关闭页面后需要重新加入。'); }
  const hash = new URLSearchParams({ room: result.room.id });
  if (state.inviteToken) hash.set('invite', state.inviteToken);
  history.replaceState(null, '', `#${hash}`);
  state.showForm = false;
  setRoom(result.room);
  schedulePoll();
}

function setRoom(room) {
  state.room = room;
  state.inviteToken ||= room.inviteToken || '';
  if (!visibleCandidates().some((candidate) => candidate.id === state.selected)) state.selected = visibleCandidates()[0]?.id || '';
  state.status = '后端已连接';
  render();
}

function updateDraftFromRoom() {
  const input = state.room?.input || {};
  state.draft = { ...state.draft, ...input, origins: Array.isArray(input.origins) ? input.origins.map((origin) => typeof origin === 'string' ? origin : origin.name || '').join('\n') : state.draft.origins, activities: Array.isArray(input.activities) ? input.activities.join(',') : state.draft.activities, mustVisit: Array.isArray(input.specifiedPlaces) ? input.specifiedPlaces.join(',') : '', startTime: input.meetTime || state.draft.startTime, walkMaxMinutes: input.walkMinutes ?? 15, rideMaxMinutes: input.rideMinutes ?? 10, accessMaxMinutes: input.accessMinutes ?? 20, memberLimit: state.room.memberLimit };
}

function render() {
  document.querySelector('.floating-submit')?.remove();
  const focused = document.activeElement;
  const focusId = content.contains(focused) ? focused.id : null;
  const cursor = focusId && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
  document.querySelector('#connection-status').textContent = state.status;
  document.querySelector('#room-label').textContent = state.room ? `${state.room.city} · ${state.room.members?.length || 0} 位成员` : '城市灵感与约见路线';
  document.querySelector('#share-button').hidden = state.tab !== 'create' || !state.room || !state.inviteToken;
  document.querySelector('.shell').dataset.page = state.tab;
  document.querySelectorAll('.bottom-nav [data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.tab));
  if (state.tab === 'plaza') content.innerHTML = plazaView();
  else if (state.tab === 'profile') content.innerHTML = profileView();
  else if (state.sharedPlan) content.innerHTML = sharedPlanView();
  else content.innerHTML = createView();
  const hasRoute = Boolean(state.sharedPlan?.candidate || state.room?.candidates?.length || visibleCandidates().length);
  document.querySelector('.layout').classList.toggle('has-map', state.tab === 'create' && hasRoute);
  const submitButton = content.querySelector('.floating-submit');
  if (state.tab === 'create' && submitButton) {
    submitButton.setAttribute('form', 'plan-form');
    document.body.append(submitButton);
  }
  bind();
  if (focusId) {
    const restored = document.getElementById(focusId);
    restored?.focus({ preventScroll: true });
    if (cursor && restored?.setSelectionRange) restored.setSelectionRange(...cursor);
  }
  updateMap();
}

function createView() {
  return `${state.room ? `<div class="heading-row history-row"><button class="history-btn" data-action="history">历史版本</button></div>` : ''}
    ${state.error ? `<div class="error-panel" role="alert">${escape(state.error)}<button data-action="retry">重试连接</button></div>` : ''}
    ${state.requestedRoom && !state.identity ? joinForm() : !state.room && state.requestedRoom ? '<p class="hint">正在读取房间…</p>' : !state.room || (isHost() && state.showForm) ? planForm() : ''}
    ${state.room ? roomContent() : !state.requestedRoom ? '<p class="hint">填写出发地与活动偏好，生成可分享的约见路线。</p>' : ''}`;
}

const plazaPosts = [
  { id: 'p1', author: '周末慢游社', avatar: '慢', title: '在徐汇，把一个下午交给手作和咖啡', tags: ['上海', '手作', '咖啡'], stops: ['木工手作体验', '社区咖啡馆', '衡山路散步'], note: '三站都在步行友好的街区里，留了足够聊天的空白。', likes: 128, saves: 46 },
  { id: 'p2', author: '阿橙的城市清单', avatar: '橙', title: '下班后从五角场一路玩到夜色里', tags: ['上海', '聚餐', '夜生活'], stops: ['桌游体验', '云南菜晚餐', '精酿小酒馆'], note: '先坐下来玩，再吃饭，最后找家不吵的酒吧收尾。', likes: 93, saves: 31 },
  { id: 'p3', author: '两个人出门', avatar: '两', title: '第一次约见也不尴尬的轻松路线', tags: ['上海', '约会', '轻松'], stops: ['独立书店', '简餐小馆', '江边夜景'], note: '每一段都不赶时间，临时想改主意也很好调整。', likes: 76, saves: 58 },
];
function plazaView() {
  return `<section class="plaza-hero"><div class="eyebrow">CHUMEN · 城市灵感</div><h1>今天，和谁去哪里？</h1><p>看看大家正在安排的城市路线。</p><button class="primary-btn" data-tab="create">＋ 规划一次约见</button></section><div class="plaza-heading"><h2>大家的路线</h2><span>灵感来自城市里的真实生活</span></div><div class="post-grid">${plazaPosts.map((post) => `<article class="post-card"><div class="post-author"><span class="post-avatar">${post.avatar}</span><b>${post.author}</b><span>路线创作者</span></div><h3>${post.title}</h3><div class="post-tags">${post.tags.map((tag) => `<span>#${tag}</span>`).join('')}</div><div class="post-stops">${post.stops.map((stop, index) => `<span>${index + 1}</span><b>${stop}</b>${index < post.stops.length - 1 ? '<i>→</i>' : ''}`).join('')}</div><p class="post-note">“${post.note}”</p><div class="post-actions"><button data-social="like" data-id="${post.id}" class="${state.social.liked.includes(post.id) ? 'on' : ''}">♡ ${post.likes + Number(state.social.liked.includes(post.id))}</button><button data-social="save" data-id="${post.id}" class="${state.social.saved.includes(post.id) ? 'on' : ''}">☆ ${state.social.saved.includes(post.id) ? '已收藏' : `收藏 ${post.saves}`}</button><button data-tab="create">按这条路线规划 ↗</button></div></article>`).join('')}</div>`;
}
function profileView() {
  return `<div class="eyebrow">个人空间</div><h1>我的</h1><p class="subtitle">管理本地偏好与路线收藏。</p><section class="profile-card"><span class="profile-avatar">出</span><div><b>城市出行者</b><p>偏好保存在当前浏览器中</p></div></section><section class="settings-card"><h2>我的收藏</h2>${plazaPosts.filter((post) => state.social.saved.includes(post.id)).map((post) => `<p>${post.title}</p>`).join('') || '<p class="hint">收藏喜欢的路线后，会显示在这里。</p>'}</section><section class="settings-card"><h2>关于出门见</h2><p>为朋友、伴侣和小团体规划一条能一起出发的城市路线。</p><span class="connection-pill">${escape(state.status)}</span></section>`;
}
function sharedPlanView() {
  const candidate = state.sharedPlan.candidate;
  return `<div class="eyebrow">${escape(state.sharedPlan.city)} · 分享路线</div><h1>${escape(candidate.title)}</h1><p class="subtitle">${escape(candidate.summary || '一条为你准备的城市约见路线')}</p><div class="shared-route">${(candidate.stops || []).map((stop, index) => `<div><span>${index + 1}</span><section><small>${escape(stop.activity || '活动地点')}</small><b>${escape(stop.name)}</b></section></div>`).join('')}</div><p class="hint">${escape(state.sharedPlan.date || '')} · ${escape(state.sharedPlan.meetTime || '')} 集合 · 方案由参与者分享</p><button class="primary-btn" data-tab="create">我也规划一条</button>`;
}

function field(label, name, { type = 'text', min, max, required = true, hint = '' } = {}) {
  return `<label class="field">${escape(label)}<input id="field-${name}" name="${name}" type="${type}" value="${escape(state.draft[name])}" ${required ? 'required' : ''} ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${type === 'text' ? 'maxlength="200"' : ''}>${hint ? `<small>${escape(hint)}</small>` : ''}</label>`;
}

function planForm() {
  return `<form id="plan-form" class="plan-form"><div class="section-head"><div><h2>${state.room ? '调整这次约见' : '安排一次约见'}</h2><p>下面填写集合时间；通勤显示当前估算，指定日期班次与完整日程仍待核对。</p></div></div>
    <div class="form-grid">${!state.room ? field('你的昵称', 'nickname') : ''}${field('城市', 'city')}${field('人数上限', 'memberLimit', { type: 'number', min: 1, max: 6 })}${field('人均预算（元）', 'budgetPerPerson', { type: 'number', min: 1, max: 100000 })}${field('活动日期', 'date', { type: 'date' })}${field('集合时间', 'startTime', { type: 'time' })}${field('开始返程时间', 'endTime', { type: 'time' })}</div>
    <label class="field">各人出发地（每行一个）<textarea id="field-origins" name="origins" rows="3" maxlength="1200" required>${escape(state.draft.origins)}</textarea><small>尽量使用明确的地标和校区，避免同名地点。第一个是局主的出发地。</small></label>
    ${field('活动顺序（用逗号分隔）', 'activities')}
    ${field('必去店铺（选填）', 'mustVisit', { required: false, hint: '用逗号分隔；尽量写清分店。系统按类别匹配活动环节，并保留指定店铺。' })}
    <div class="preference-box"><label class="field">用自然语言描述偏好（选填）<input id="preference-text" maxlength="500" value="${escape(state.preferenceText || state.room?.input?.preference || '')}" placeholder="例如：想找安静一点的餐厅，不要火锅"></label><button class="text-btn" type="button" data-action="preferences" ${state.busy ? 'disabled' : ''}>应用偏好到餐厅检索</button><small>由模型整理检索词，应用后可编辑；指定店铺保持不变。</small></div>
    <details class="constraints"><summary>交通限制</summary><div class="form-grid">${field('单段步行上限（分钟）', 'walkMaxMinutes', { type: 'number', min: 1, max: 60 })}${field('单段骑行上限（分钟）', 'rideMaxMinutes', { type: 'number', min: 1, max: 60 })}${field('公交地铁接驳上限（分钟）', 'accessMaxMinutes', { type: 'number', min: 1, max: 60 })}</div></details>
    <button class="primary-btn floating-submit" type="submit" ${state.busy || generationRunning() ? 'disabled' : ''}>${state.busy ? '正在提交…' : generationRunning() ? '本轮仍在生成' : state.room ? '按新要求生成路线' : '创建房间并查询真实路线'}</button>
  </form>`;
}

function joinForm() {
  return `<form id="join-form" class="plan-form"><h2>加入约见房间</h2><p class="hint">使用昵称加入，之后在这个浏览器打开同一链接会保留身份。</p><label class="field">昵称<input id="join-nickname" name="nickname" maxlength="30" required></label><label class="field">你的出发地<input id="join-origin" name="origin" maxlength="200" required placeholder="例如：上海火车站"></label><p class="hint">精确出发地仅本人和局主可见，其他成员查看概略地点及通勤时间。</p><button class="primary-btn" ${state.busy || !state.inviteToken ? 'disabled' : ''}>${state.busy ? '正在加入…' : '加入房间'}</button>${!state.inviteToken ? '<p class="hint">该链接缺少邀请凭证，请向局主获取完整分享链接。</p>' : ''}</form>`;
}

function roomContent() {
  const room = state.room;
  const input = room.input || {};
  const candidates = visibleCandidates();
  const generation = room.generation || {};
  const memberNames = new Map((room.members || []).map((member) => [member.id, member.nickname]));
  const voted = room.myVote || candidates.find((candidate) => candidate.votes?.includes(state.identity?.memberId))?.id;
  return `<div class="room-summary"><p>${escape(input.date || '')} · ${escape(input.meetTime || '')} 集合 → ${escape(input.endTime || '')} 开始返程</p><p>人均预算 ¥${escape(input.budgetPerPerson ?? '未设置')} · 步行 ≤ ${escape(input.walkMinutes ?? 15)} 分钟 · 骑行 ≤ ${escape(input.rideMinutes ?? 10)} 分钟</p>${isHost() ? '<button class="text-btn" data-action="edit">调整需求</button>' : ''}</div>
    ${room.needsRegeneration ? '<p class="hint">成员出发地已更新，请局主调整需求并重新生成通勤路线。</p>' : ''}${state.showHistory ? historyPanel() : ''}
    <div class="section-head"><div><h2>${candidates.length ? '选一条你更想走的路线' : '候选路线'}</h2><p>预览不会投票。每人一票，可随时改票或暂不投票。</p>${generationRunning() || generation.status === 'failed' ? `<p class="generation-inline ${generation.status === 'failed' ? 'generation-inline-failed' : ''}" role="status">${generationRunning() ? '正在生成，已返回的路线可先预览' : escape(generation.error?.message || generation.error || generation.message || '路线生成失败')}</p>` : ''}</div>${voted ? `<button class="text-btn" data-vote="" ${state.busy || generationRunning() ? 'disabled' : ''}>撤回我的票</button>` : ''}</div>
    ${!candidates.length ? `<div class="empty-state">${generationRunning() ? '正在检查地点和交通可达性…' : '本轮没有可用路线。请根据提示调整地点或交通限制后重试。'}</div>` : `<div class="cards">${candidates.map(routeCard).join('')}</div>`}
    <section class="comment-box"><div class="comment-title"><span class="comment-icon">✦</span><div><b>有想法就留言</b><span>成员可见，留言保留所属版本</span></div></div><form id="comment-form" class="comment-input"><input id="comment-input" name="body" value="${escape(state.commentDraft)}" maxlength="1000" placeholder="比如：第二站想换成更安静的餐厅…" required><button ${state.busy || generationRunning() || !room.versionNo ? 'disabled' : ''}>发送</button></form><div class="comment-list">${(room.comments || []).map((comment) => `<div><b>${escape(comment.nickname || memberNames.get(comment.memberId) || '成员')}</b><span>${escape(comment.body || comment.text)}</span><small>第 ${escape(comment.versionNo || room.versionNo)} 轮</small></div>`).join('') || '<p class="hint">还没有留言。</p>'}</div></section>${candidates.length ? `<section class="verification-notes"><h3>出行前再确认</h3><p>人均预算、商家营业时间、预约条件与完整活动时长仍需核对；公交班次按当前查询估算。</p><ul>${[...new Set(candidates.flatMap((candidate) => candidate.warnings || []))].map((warning) => `<li>${escape(warning)}</li>`).join('')}</ul></section>` : ''}`;
}

function routeCard(candidate) {
  const selected = candidate.id === state.selected;
  const voted = state.room.myVote === candidate.id || candidate.votes?.includes(state.identity?.memberId);
  const checks = candidate.checks || {};
  const checkText = (key, label) => `${label}：${checks[key] === 'passed' ? '已核实' : checks[key] === 'failed' ? '不满足' : '待核实'}`;
  return `<article class="route-card ${selected ? 'selected' : ''}" data-route="${escape(candidate.id)}"><div class="card-top"><span class="route-tag ${selected ? 'active-tag' : ''}">${candidate.source === 'baidu' ? '百度实时查询' : '路线结果'}</span><button class="text-btn" data-preview="${escape(candidate.id)}" aria-pressed="${selected}">${selected ? '正在预览' : '预览地图'}</button></div><h3>${escape(candidate.title)}</h3><p class="route-note">${escape(candidate.summary)}</p><div class="route-meta">${Number.isFinite(candidate.estimatedCost) ? `<span>参考 ¥${escape(candidate.estimatedCost)} / 人</span>` : ''}<span>${escape(checkText('travel', '活动间交通'))}</span><span>${escape(checkText('commuteAccess', '公交地铁接驳'))}</span></div>
    <div class="timeline">${(candidate.stops || []).map((stop, index) => `<div class="stop"><div class="time">${index + 1}</div><div class="line-dot"></div><div class="stop-body"><span class="stop-kind">${escape(stop.activity)}</span><b>${escape(stop.name)}</b>${candidate.legs?.[index] ? `<small class="leg-detail">下一站：${['cycling', 'riding', 'ride'].includes(candidate.legs[index].mode) ? '骑行' : '步行'} ${minutes(candidate.legs[index].durationSeconds)}${Number.isFinite(candidate.legs[index].distanceMeters) ? ` · ${(candidate.legs[index].distanceMeters / 1000).toFixed(1)} km` : ''}</small>` : ''}</div></div>`).join('')}</div>
    <div class="commutes"><h4>从各自出发，汇合到这里</h4>${(candidate.commutes || []).map((commute) => `<p><b>${escape(commute.memberLabel || `成员 ${commute.originIndex + 1}`)}</b><span>前往 ${minutes(commute.durationSeconds)} · 返程 ${minutes(candidate.returnCommutes?.find((item) => item.originIndex === commute.originIndex)?.durationSeconds)}</span><button class="commute-focus" data-commute="${commute.originIndex}">查看通勤 ↗</button>${commute.warning ? `<small>${escape(commute.warning)}</small>` : ''}</p>`).join('')}</div><button class="share-plan-btn" data-share-plan="${escape(candidate.id)}">分享这条方案 ↗</button>
    <div class="card-bottom"><button class="vote-btn ${voted ? 'voted' : ''}" data-vote="${escape(candidate.id)}" ${state.busy || voted || generationRunning() || state.room.needsRegeneration ? 'disabled' : ''}>${voted ? '我已投票' : '投这条路线'}</button><span class="votes">${candidate.voteCount ?? candidate.votes?.length ?? 0} 票</span></div></article>`;
}

function historyPanel() {
  return `<div class="history-panel"><div><b>历史版本</b><span>最多保留 5 个历史版本；回溯后重新查询交通。</span></div><div class="history-actions">${(state.room.history || []).map((version) => `<button data-rollback="${escape(version.versionNo)}" ${!isHost() || state.busy || generationRunning() ? 'disabled' : ''}>回溯第 ${escape(version.versionNo)} 轮</button>`).join('') || '<span>暂无历史版本</span>'}</div></div>`;
}

function readPlan(form) {
  const values = Object.fromEntries(new FormData(form));
  const origins = values.origins.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const activities = values.activities.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
  if (!origins.length || activities.length < 2 || activities.length > 4) throw new Error('请填写 1—6 个出发地和 2—4 个活动。');
  if (origins.length > Number(values.memberLimit)) throw new Error('出发地数量不能超过人数上限。');
  if (values.endTime <= values.startTime) throw new Error('开始返程时间需要晚于集合时间；当前暂不支持跨夜活动。');
  const savedPreference = state.room?.input?.preference || '';
  const preferenceChanged = state.preferenceText.trim() !== savedPreference;
  return { ...values, origins, origin: origins[0], activities, preference: state.preferenceSummary || (preferenceChanged ? '' : savedPreference), preferenceSearchTerms: state.preferenceSummary ? state.preferenceSearchTerms : preferenceChanged ? [] : (state.room?.input?.preferenceSearchTerms || []), specifiedPlaces: values.mustVisit ? values.mustVisit.split(/[,，]/).map((value) => value.trim()).filter(Boolean) : [], meetTime: values.startTime, memberLimit: Number(values.memberLimit), budgetPerPerson: Number(values.budgetPerPerson), walkMinutes: Number(values.walkMaxMinutes), rideMinutes: Number(values.rideMaxMinutes), accessMinutes: Number(values.accessMaxMinutes) };
}

function bind() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { state.tab = button.dataset.tab; if (state.tab === 'create') state.sharedPlan = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  content.querySelectorAll('[data-social]').forEach((button) => button.addEventListener('click', () => {
    const list = button.dataset.social === 'like' ? state.social.liked : state.social.saved;
    state.social[button.dataset.social === 'like' ? 'liked' : 'saved'] = list.includes(button.dataset.id) ? list.filter((id) => id !== button.dataset.id) : [...list, button.dataset.id];
    localStorage.setItem('chumen.social', JSON.stringify(state.social)); render();
  }));
  content.querySelectorAll('[data-commute]').forEach((button) => button.addEventListener('click', () => { state.commuteIndex = Number(button.dataset.commute); updateMap(); document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  content.querySelectorAll('[data-share-plan]').forEach((button) => button.addEventListener('click', () => action(async () => {
    const result = await api(`/rooms/${state.room.id}/shares`, { method: 'POST', body: { candidateId: button.dataset.sharePlan, versionNo: state.room.versionNo } });
    if (!result.id) throw new Error('分享服务没有返回链接编号，请稍后重试。');
    const url = new URL(location.href);
    url.hash = new URLSearchParams({ share: result.id }).toString();
    showShareLink(url.href);
  })));
  content.querySelector('#plan-form')?.addEventListener('input', (event) => { if (event.target.name) state.draft[event.target.name] = event.target.value; });
  content.querySelector('#plan-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    let input;
    try { input = readPlan(event.target); } catch (error) { state.error = error.message; render(); return; }
    action(async () => {
      if (state.room) { setRoom(await api(`/rooms/${state.room.id}/regenerate`, { method: 'POST', body: { ...input, baseVersionNo: state.room.versionNo } })); state.showForm = false; }
      else { saveIdentity(await api('/rooms', { method: 'POST', body: input, anonymous: true })); setRoom(await api(`/rooms/${state.room.id}/generate`, { method: 'POST', body: { baseVersionNo: state.room.versionNo } })); }
      schedulePoll(500);
    });
  });
  content.querySelector('#preference-text')?.addEventListener('input', (event) => { state.preferenceText = event.target.value; state.preferenceSummary = ''; state.preferenceSearchTerms = []; });
  content.querySelector('[data-action="preferences"]')?.addEventListener('click', () => action(async () => {
    if (!state.preferenceText.trim()) throw new Error('请先描述你的偏好。');
    const result = await api('/preferences', { method: 'POST', body: { text: state.preferenceText, activities: state.draft.activities.split(/[,，]/).map((value) => value.trim()).filter(Boolean) }, anonymous: true });
    state.preferenceSummary = result.preferences?.preferenceSummary || '';
    state.preferenceSearchTerms = result.preferences?.foodSearchTerms || [];
    toast(state.preferenceSummary ? `偏好已加入餐厅检索：${state.preferenceSummary}` : '偏好已加入地点检索。');
  }));
  content.querySelector('#join-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    action(async () => { saveIdentity(await api(`/rooms/${state.requestedRoom}/members`, { method: 'POST', body: { ...values, inviteToken: state.inviteToken }, anonymous: true })); });
  });
  content.querySelectorAll('[data-preview]').forEach((button) => button.addEventListener('click', () => { state.selected = button.dataset.preview; state.commuteIndex = null; render(); }));
  content.querySelectorAll('[data-route]').forEach((card) => card.addEventListener('click', (event) => { if (!event.target.closest('button')) { state.selected = card.dataset.route; state.commuteIndex = null; render(); } }));
  content.querySelectorAll('[data-vote]').forEach((button) => button.addEventListener('click', () => action(async () => setRoom(await api(`/rooms/${state.room.id}/votes`, { method: 'POST', body: { candidateId: button.dataset.vote || null, versionNo: state.room.versionNo } })))));
  content.querySelector('[data-action="history"]')?.addEventListener('click', () => { state.showHistory = !state.showHistory; render(); });
  content.querySelector('[data-action="edit"]')?.addEventListener('click', () => { updateDraftFromRoom(); state.showForm = !state.showForm; render(); content.querySelector('#plan-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  content.querySelector('[data-action="retry"]')?.addEventListener('click', () => { state.error = ''; state.room || state.identity ? refreshRoom() : checkHealth(); render(); });
  content.querySelectorAll('[data-rollback]').forEach((button) => button.addEventListener('click', () => action(async () => { setRoom(await api(`/rooms/${state.room.id}/rollback`, { method: 'POST', body: { versionNo: Number(button.dataset.rollback), baseVersionNo: state.room.versionNo } })); schedulePoll(500); })));
  content.querySelector('#comment-input')?.addEventListener('input', (event) => { state.commentDraft = event.target.value; });
  content.querySelector('#comment-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = state.commentDraft.trim();
    if (!body) return;
    action(async () => { const room = await api(`/rooms/${state.room.id}/comments`, { method: 'POST', body: { body, candidateId: state.selected || null, versionNo: state.room.versionNo } }); state.commentDraft = ''; setRoom(room); });
  });
}

async function action(fn) {
  if (state.busy) return;
  state.busy = true; state.error = ''; render();
  try { await fn(); } catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); }
}

function updateMap() { const candidate = state.sharedPlan?.candidate || (state.tab === 'create' ? visibleCandidates().find((item) => item.id === state.selected) || null : null); mapView.showCandidate(candidate, { commuteIndex: state.commuteIndex }); }
function schedulePoll(delay) { clearTimeout(pollTimer); if (state.identity && state.requestedRoom) pollTimer = setTimeout(refreshRoom, delay ?? (generationRunning() ? 2000 : 8000)); }
async function refreshRoom() {
  if (!state.identity || !state.requestedRoom) return;
  if (state.busy) { schedulePoll(1000); return; }
  try { const room = await api(`/rooms/${state.requestedRoom}`); state.error = ''; setRoom(room); }
  catch (error) {
    state.status = '同步暂时中断'; state.error = error.message;
    if (error.status === 404) {
      clearTimeout(pollTimer);
      state.room = null; state.identity = null; state.requestedRoom = ''; state.inviteToken = '';
      state.showForm = true; state.error = '这个临时房间已被后端重启清空，请重新创建房间。';
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    if (error.status === 401 || error.status === 403) { state.identity = null; state.room = null; }
    render();
  } finally { schedulePoll(); }
}

async function shareRoom() {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({ room: state.room.id, invite: state.inviteToken }).toString();
  try { await navigator.clipboard.writeText(url.href); toast('链接已复制'); }
  catch { window.prompt('复制成员邀请链接', url.href); }
}

function showShareLink(link) {
  document.querySelector('.share-link-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'share-link-dialog';
  dialog.innerHTML = '<form method="dialog"><h2>方案链接已生成</h2><p>复制链接后即可分享给其他人查看。</p><input aria-label="方案分享链接" readonly><p class="share-link-status" role="status">链接已准备好。</p><div class="share-link-actions"><button type="button" data-copy-link>复制链接</button><button type="submit">关闭</button></div></form>';
  const input = dialog.querySelector('input');
  const status = dialog.querySelector('.share-link-status');
  input.value = link;
  dialog.querySelector('[data-copy-link]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = '链接已复制，可以发给其他人了。';
    } catch {
      input.focus();
      input.select();
      status.textContent = '链接已选中，请按 Ctrl+C 复制。';
    }
  });
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  input.select();
}
function toast(message) { const element = document.createElement('div'); element.className = 'toast'; element.textContent = message; document.body.appendChild(element); setTimeout(() => element.remove(), 4000); }
async function checkHealth() {
  try { await api('/health', { anonymous: true }); state.status = '后端已连接'; state.error = ''; }
  catch (error) { state.status = '后端未连接'; state.error = error.message; }
  render();
}
function resetRoom() { clearTimeout(pollTimer); state.room = null; state.identity = null; state.requestedRoom = ''; state.inviteToken = ''; state.selected = ''; state.error = ''; state.showForm = true; state.draft = { ...defaults }; render(); }
async function restoreRoom() {
  const params = new URLSearchParams(location.hash.slice(1));
  const sharedId = params.get('share');
  if (sharedId) { state.shareId = sharedId; state.tab = 'create'; state.room = null; state.identity = null; state.sharedPlan = null; render(); try { state.sharedPlan = await api(`/shares/${encodeURIComponent(sharedId)}`, { anonymous: true }); } catch (error) { state.error = error.message; } render(); return; }
  state.sharedPlan = null; state.shareId = '';
  const roomId = params.get('room');
  if (!roomId) { resetRoom(); return; }
  state.requestedRoom = roomId; state.inviteToken = params.get('invite') || ''; state.identity = readIdentity(roomId); state.room = null;
  state.inviteToken ||= state.identity?.inviteToken || '';
  state.showForm = false; state.error = ''; render();
  if (state.identity) refreshRoom();
}
window.addEventListener('hashchange', restoreRoom);
render(); restoreRoom(); checkHealth();
import './premium.css';
import './navigation.css';
// Premium visual layer is intentionally imported before the existing UI wiring so the redesign
// stays a presentation concern and never changes route generation or privacy behavior.
import './visual-upgrade.js';
