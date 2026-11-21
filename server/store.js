import { randomBytes, createHash } from 'node:crypto';
import { assert } from './errors.js';
const rooms = new Map();
const shares = new Map();
const token = () => randomBytes(32).toString('base64url');
const id = (p) => p + '_' + randomBytes(10).toString('hex');
const hash = (v) => createHash('sha256').update(v || '').digest('hex');
const now = () => new Date().toISOString();
const str = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function range(v, fallback, min, max, label) {
  const n = v == null ? fallback : Number(v);
  assert(Number.isFinite(n) && n >= min && n <= max, 400, 'INVALID_INPUT', label + '超出允许范围');
  return n;
}
export function normalizeInput(body = {}, previous = {}) {
  const m = { ...previous, ...body };
  const origins = m.origins || (m.origin ? [m.origin] : []);
  const activities = m.activities || ['DIY手作', '餐厅', '酒吧'];
  assert(Array.isArray(origins) && origins.length >= 1 && origins.length <= 6, 400, 'INVALID_INPUT', '请填写 1—6 个出发地');
  assert(Array.isArray(activities) && activities.length >= 2 && activities.length <= 4, 400, 'INVALID_INPUT', '请填写 2—4 个活动');
  assert(origins.every(x => str(x)) && activities.every(x => str(x)), 400, 'INVALID_INPUT', '出发地和活动不能为空');
  const specifiedPlaces = m.specifiedPlaces || [];
  assert(Array.isArray(specifiedPlaces) && specifiedPlaces.length <= 4 && specifiedPlaces.every(x => str(x)), 400, 'INVALID_INPUT', '指定店铺最多 4 家');
  const input = {
    city: str(m.city || '上海', 30), origins: origins.map(x => str(x)), activities: activities.map(x => str(x, 60)),
    specifiedPlaces: specifiedPlaces.map(x => str(x)),
    budgetPerPerson: range(m.budgetPerPerson, 500, 1, 100000, '预算'),
    walkMinutes: range(m.walkMinutes, 15, 1, 60, '单段步行时间'),
    rideMinutes: range(m.rideMinutes, 10, 1, 60, '单段骑行时间'),
    accessMinutes: range(m.accessMinutes, 20, 1, 60, '公交接驳时间'),
    date: str(m.date || '2026-09-30', 10), meetTime: str(m.meetTime || '15:00', 5),
    endTime: str(m.endTime || '22:00', 5), preference: str(m.preference, 2000),
    preferenceSearchTerms: Array.isArray(m.preferenceSearchTerms) ? m.preferenceSearchTerms.filter(term => typeof term === 'string' && term.trim()).slice(0, 4).map(term => str(term, 40)) : [],
  };
  for (const key of ['meetTime', 'endTime']) assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(input[key]), 400, 'INVALID_INPUT', '时间格式应为 HH:mm');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.date), 400, 'INVALID_INPUT', '日期格式应为 YYYY-MM-DD');
  return input;
}
export function createRoom(body) {
  assert(rooms.size < 500, 503, 'CAPACITY', '当前测试服务房间已满，请重启后端清理');
  const input = normalizeInput(body);
  const bearer = token();
  const host = { id: id('member'), role: 'host', nickname: str(body.nickname || '局主', 30), originIndex: 0, origin: input.origins[0], tokenHash: hash(bearer) };
  const room = { id: id('room'), hostId: host.id, inviteToken: token(), city: input.city,
    memberLimit: Math.max(input.origins.length, Math.floor(range(body.memberLimit, 6, 1, 6, '人数上限'))),
    members: [host], input, versionNo: 0, current: null, history: [], generation: { status: 'idle', message: '等待生成' }, createdAt: now() };
  rooms.set(room.id, room); return { room, host, token: bearer };
}
export function getRoom(roomId) {
  const room = rooms.get(roomId);
  assert(room, 404, 'ROOM_NOT_FOUND', '房间不存在或后端已重启，请重新创建'); return room;
}
export function authenticate(room, bearer) {
  const member = room.members.find(x => x.tokenHash === hash(bearer));
  assert(member && bearer, 401, 'UNAUTHORIZED', '请使用本浏览器保存的成员身份，或通过邀请链接加入'); return member;
}
export function requireHost(room, member) { assert(room.hostId === member.id, 403, 'FORBIDDEN', '只有局主可以修改路线'); }
export function joinRoom(room, body) {
  assert(body.inviteToken && hash(body.inviteToken) === hash(room.inviteToken), 403, 'INVALID_INVITE', '邀请链接不正确');
  assert(room.members.length < room.memberLimit, 409, 'ROOM_FULL', '房间人数已达上限');
  assert(room.generation.status !== 'running', 409, 'GENERATION_RUNNING', '路线仍在生成，请稍后加入');
  const bearer = token(), originIndex = room.members.length;
  const origin = str(body.origin);
  assert(origin, 400, 'INVALID_INPUT', '请填写自己的出发地');
  const member = { id: id('member'), role: 'participant', nickname: str(body.nickname || ('成员' + (originIndex + 1)), 30), originIndex,
    origin, tokenHash: hash(bearer) };
  const changed = room.input.origins[originIndex] !== origin;
  const nextOrigins = [...room.input.origins]; nextOrigins[originIndex] = origin;
  room.input = { ...room.input, origins: nextOrigins };
  if (room.current && changed) room.needsRegeneration = true;
  room.members.push(member); return { member, token: bearer };
}
export function beginGeneration(room, input, baseVersionNo, rollbackOf = null) {
  assert(room.generation.status !== 'running', 409, 'GENERATION_RUNNING', '当前已有生成任务，请等待结束');
  assert(Number(baseVersionNo) === room.versionNo, 409, 'STALE_VERSION', '路线版本已变化，请刷新后再操作');
  const plan = { versionNo: room.versionNo + 1, input, candidates: [], votes: {}, comments: [], createdAt: now(), rollbackOf };
  room.generation = { id: id('job'), status: 'running', stage: 'search', message: '正在检索真实地点', startedAt: now(), candidates: [], plan };
  return plan;
}
export function generationProgress(room, event) {
  room.generation.stage = str(event.stage, 60); room.generation.message = str(event.message, 250);
  if (event.candidate && !room.generation.candidates.some(c => c.id === event.candidate.id)) room.generation.candidates.push(event.candidate);
}
export function finishGeneration(room, plan, candidates) {
  assert(Array.isArray(candidates) && candidates.length > 0, 422, 'NO_ROUTES', '没有找到满足交通条件的路线，请更换活动或调整时间上限');
  if (room.current) room.history.unshift(room.current);
  room.history = room.history.slice(0, 5); plan.candidates = candidates;
  room.current = plan; room.versionNo = plan.versionNo; room.input = plan.input; room.city = plan.input.city;
  room.needsRegeneration = false;
  room.members.forEach(m => { m.origin = plan.input.origins[m.originIndex] || ''; });
  room.generation = { status: 'complete', message: '已生成 ' + candidates.length + ' 条真实地点路线，未知信息请核对', completedAt: now() };
}
export function failGeneration(room, error) { room.generation = { status: 'failed', code: error.code, message: error.message, completedAt: now() }; }
function currentVersion(room, n) {
  assert(room.current, 409, 'NO_PLAN', '请先生成路线');
  assert(Number(n) === room.versionNo, 409, 'STALE_VERSION', '这是旧版路线，请刷新后重试'); return room.current;
}
export function addVote(room, member, body) {
  assert(!room.needsRegeneration, 409, 'PLAN_OUTDATED', '成员出发地已更新，请局主重新生成路线后投票');
  const plan = currentVersion(room, body.versionNo);
  assert(body.candidateId === null || plan.candidates.some(c => c.id === body.candidateId), 400, 'INVALID_CANDIDATE', '候选路线不存在');
  if (body.candidateId === null) delete plan.votes[member.id]; else plan.votes[member.id] = body.candidateId;
}
export function addComment(room, member, body) {
  const plan = currentVersion(room, body.versionNo);
  assert(typeof body.body === 'string' && body.body.trim().length > 0 && body.body.length <= 2000, 400, 'INVALID_COMMENT', '留言须为 1—2000 字');
  assert(!body.candidateId || plan.candidates.some(c => c.id === body.candidateId), 400, 'INVALID_CANDIDATE', '留言对应的路线不存在');
  assert(plan.comments.length < 500, 429, 'COMMENT_LIMIT', '当前版本留言已达上限');
  plan.comments.push({ id: id('comment'), versionNo: plan.versionNo, memberId: member.id, nickname: member.nickname,
    candidateId: body.candidateId || null, body: body.body.trim(), createdAt: now() });
}
function viewInput(input, room, viewer) {
  if (viewer.id === room.hostId) return structuredClone(input);
  const { preference, ...rest } = input;
  return { ...rest, origins: input.origins.map((x, i) => i === viewer.originIndex && x === viewer.origin ? x : '其他成员出发地（已隐藏）') };
}
function viewCandidate(candidate, room, viewer, input) {
  const c = structuredClone(candidate);
  for (const key of ['commutes', 'returnCommutes']) c[key] = (c[key] || []).map(leg => {
    if (viewer.id === room.hostId || (viewer.originIndex === leg.originIndex && input?.origins[leg.originIndex] === viewer.origin)) return leg;
    const r = leg.route || leg;
    return { originIndex: leg.originIndex, origin: { name: '其他成员出发地（已隐藏）' },
      durationSeconds: r.durationSeconds, distanceMeters: r.distanceMeters, mode: r.mode,
      accessCheck: leg.accessCheck, source: 'baidu', redacted: true };
  });
  return c;
}
function viewPlan(plan, room, viewer) {
  return { versionNo: plan.versionNo, input: viewInput(plan.input, room, viewer), createdAt: plan.createdAt, rollbackOf: plan.rollbackOf,
    candidates: plan.candidates.map(c => ({ ...viewCandidate(c, room, viewer, plan.input), voteCount: Object.values(plan.votes).filter(v => v === c.id).length })),
    myVote: plan.votes[viewer.id] || null, voteCount: Object.keys(plan.votes).length, comments: structuredClone(plan.comments), warnings: plan.warnings || [] };
}
export function publicRoom(room, viewer) {
  const current = room.current ? viewPlan(room.current, room, viewer) : { candidates: [], comments: [], myVote: null, voteCount: 0 };
  return { id: room.id, city: room.city, hostId: room.hostId, viewerId: viewer.id, viewerRole: viewer.role, storage: 'memory',
    memberLimit: room.memberLimit, versionNo: room.versionNo, input: viewInput(room.input, room, viewer),
    members: room.members.map(m => ({ id: m.id, nickname: m.nickname, role: m.role, originIndex: m.originIndex,
      origin: viewer.id === room.hostId || viewer.id === m.id ? m.origin : '出发地已隐藏' })),
    ...current, input: viewInput(room.input, room, viewer), needsRegeneration: Boolean(room.needsRegeneration), history: room.history.map(p => viewPlan(p, room, viewer)),
    generation: { status: room.generation.status, stage: room.generation.stage, code: room.generation.code,
      message: room.generation.message, candidates: (room.generation.candidates || []).map(c => viewCandidate(c, room, viewer, room.generation.plan?.input)) },
    ...(viewer.id === room.hostId ? { inviteToken: room.inviteToken } : {}) };
}

export function createPublicShare(room, viewer, body) {
  assert(viewer.id === room.hostId || room.members.some(member => member.id === viewer.id), 403, 'FORBIDDEN', '无权分享此方案');
  const version = [room.current, ...room.history].find(plan => plan?.versionNo === Number(body.versionNo));
  assert(version, 404, 'VERSION_NOT_FOUND', '方案版本不存在');
  const candidate = version.candidates.find(item => item.id === body.candidateId);
  assert(candidate, 404, 'CANDIDATE_NOT_FOUND', '路线方案不存在');
  assert(shares.size < 5000, 503, 'CAPACITY', '当前分享链接数量已满');
  const shareId = id('share');
  const { commutes, returnCommutes, ...route } = structuredClone(candidate);
  const share = { id: shareId, city: room.city, date: version.input.date, meetTime: version.input.meetTime,
    candidate: route, createdAt: now() };
  shares.set(shareId, share);
  return structuredClone(share);
}
export function getPublicShare(shareId) {
  const share = shares.get(shareId);
  assert(share, 404, 'SHARE_NOT_FOUND', '分享链接不存在或已失效');
  return structuredClone(share);
}
