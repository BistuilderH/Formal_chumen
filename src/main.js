import './style.css';

const candidates = [
  {
    id: 'north',
    tag: '通勤更均衡',
    title: '静安寺 · 手作工坊 → 本帮菜 → 微醺酒馆',
    note: '两人的首段通勤差距较小，活动间都在步行上限内。',
    total: '¥438 / 人',
    meet: '15:48 集合',
    returnTime: '22:00 开始返程',
    score: '9.2',
    stations: '静安寺站 · 2/7/14号线',
    stops: [
      ['15:48', 'DIY 手作', '拾光陶艺（静安店）', '活动 80 分钟 · ¥128'],
      ['17:30', '晚餐', '甬府小鲜（静安嘉里店）', '步行 8 分钟 · 人均 ¥168'],
      ['19:35', '酒吧', '棠梨酒馆', '步行 7 分钟 · 约 ¥142'],
    ],
    legs: ['上交大 → 静安寺：地铁 39 分钟', '上海站 → 静安寺：地铁 18 分钟'],
  },
  {
    id: 'people',
    tag: '地点质量更高',
    title: '愚园路 · KTV → 创意菜 → 隐藏酒吧',
    note: '更靠近主理人偏好的小店，上海站一方通勤更省时。',
    total: '¥486 / 人',
    meet: '15:42 集合',
    returnTime: '22:00 开始返程',
    score: '8.9',
    stations: '江苏路站 · 2/11号线',
    stops: [
      ['15:42', '娱乐', '玩点 KTV（愚园路店）', '活动 90 分钟 · ¥158'],
      ['17:40', '晚餐', '南城小馆', '骑行 8 分钟 · 人均 ¥186'],
      ['19:50', '酒吧', 'Blank Room', '步行 11 分钟 · 约 ¥142'],
    ],
    legs: ['上交大 → 江苏路：地铁 31 分钟', '上海站 → 江苏路：地铁 14 分钟'],
  },
  {
    id: 'xuhui',
    tag: '预算最宽松',
    title: '徐家汇 · 桌游 → 本帮菜 → 屋顶酒吧',
    note: '预算余量最多，但上交大一方需要多一次换乘。',
    total: '¥392 / 人',
    meet: '15:55 集合',
    returnTime: '22:00 开始返程',
    score: '8.7',
    stations: '徐家汇站 · 1/9/11号线',
    stops: [
      ['15:55', '娱乐', '骰子星球桌游', '活动 90 分钟 · ¥96'],
      ['17:50', '晚餐', '老吉士（徐家汇店）', '步行 9 分钟 · 人均 ¥154'],
      ['19:55', '酒吧', 'Roof 19', '步行 10 分钟 · 约 ¥142'],
    ],
    legs: ['上交大 → 徐家汇：地铁 27 分钟', '上海站 → 徐家汇：地铁 32 分钟'],
  },
];

const state = {
  selected: 'north',
  votes: { north: 1, people: 0, xuhui: 0 },
  comments: [],
  roomVersion: 3,
  showHistory: false,
};

const app = document.querySelector('#app');

function render() {
  const selected = candidates.find((c) => c.id === state.selected);
  const voteTotal = Object.values(state.votes).reduce((a, b) => a + b, 0);
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">出</span><span>出门见</span><small>同城约见路线</small></div>
        <div class="room-chip"><span class="live-dot"></span>上海 · 房间 #M7K2</div>
        <button class="ghost-btn" data-action="share">分享房间 <span>↗</span></button>
      </header>
      <main class="layout">
        <section class="main-column">
          <div class="eyebrow"><span class="pulse"></span> 第 3 轮方案 · 正在等待大家选择</div>
          <div class="heading-row">
            <div><h1>今晚去哪里见？</h1><p class="subtitle">9 月 30 日 · 15:00 出发 · 活动 → 吃饭 → 酒吧</p></div>
            <button class="history-btn" data-action="history">版本 ${state.roomVersion} <span>⌄</span></button>
          </div>
          ${state.showHistory ? historyPanel() : ''}
          <div class="route-context">
            <div class="person"><div class="avatar avatar-blue">林</div><div><b>林同学</b><span>上海交通大学 · 预计 39 分钟</span></div></div>
            <div class="connector"><span>集合</span></div>
            <div class="person"><div class="avatar avatar-orange">周</div><div><b>周同学</b><span>上海火车站 · 预计 18 分钟</span></div></div>
            <div class="context-rule"><span>步行 ≤ 15 分钟</span><span>骑行 ≤ 10 分钟</span></div>
          </div>
          <div class="section-head"><div><h2>选一条你更想走的路线</h2><p>每人可投一票，票数相同由局主决定</p></div><span class="vote-count">${voteTotal} 人已投票</span></div>
          <div class="cards">${candidates.map((c) => routeCard(c)).join('')}</div>
          <div class="comment-box">
            <div class="comment-title"><span class="comment-icon">✦</span><div><b>有想法就留言</b><span>留言会和本轮路线一起保存</span></div></div>
            <div class="comment-input"><input id="commentInput" placeholder="比如：第二站想换成更安静的餐厅…"/><button data-action="comment">发送</button></div>
            ${state.comments.length ? `<div class="comment-list">${state.comments.map((x) => `<div><b>${x.name}</b><span>${x.text}</span></div>`).join('')}</div>` : ''}
          </div>
        </section>
        <aside class="map-panel">
          <div class="map-top"><span class="map-label"><i></i>路线预览</span><button class="map-mode" data-action="mapmode">2.5D <span>⌄</span></button></div>
          <div class="map-canvas">
            <div class="map-grid"></div><div class="river"></div><div class="road road-a"></div><div class="road road-b"></div><div class="road road-c"></div>
            <div class="district d1">静安区</div><div class="district d2">黄浦区</div><div class="district d3">徐汇区</div>
            <div class="building b1"></div><div class="building b2"></div><div class="building b3"></div><div class="building b4"></div><div class="building b5"></div>
            <div class="map-route route-1"></div><div class="map-route route-2"></div><div class="map-route route-3"></div>
            <div class="map-pin pin-start one">林</div><div class="map-pin pin-start two">周</div><div class="map-pin pin-stop">见</div>
            <div class="map-caption"><b>${selected.title.split(' · ')[0]}</b><span>${selected.stations}</span></div>
          </div>
          <div class="map-footer"><div><span class="legend-dot blue"></span>林同学 <b>39 分钟</b></div><div><span class="legend-dot orange"></span>周同学 <b>18 分钟</b></div><button data-action="expand">放大地图</button></div>
        </aside>
      </main>
      <footer class="statusbar"><div><span class="lock">⌁</span> 房间内容仅成员可见 · ${state.roomVersion} 个版本已保存</div><div><span class="green-dot"></span> 地图数据已更新 · 刚刚</div></footer>
    </div>`;
  bind();
}

function routeCard(c) {
  const selected = state.selected === c.id;
  const votes = state.votes[c.id];
  return `<article class="route-card ${selected ? 'selected' : ''}" data-route="${c.id}">
    <div class="card-top"><span class="route-tag ${selected ? 'active-tag' : ''}">${c.tag}</span><span class="radio ${selected ? 'checked' : ''}">${selected ? '✓' : ''}</span></div>
    <h3>${c.title}</h3><p class="route-note">${c.note}</p>
    <div class="route-meta"><span>✦ ${c.total}</span><span>◷ ${c.meet}</span><span>⌂ ${c.returnTime}</span></div>
    <div class="timeline">${c.stops.map((s, i) => `<div class="stop"><div class="time">${s[0]}</div><div class="line-dot ${i === c.stops.length - 1 ? 'last' : ''}"></div><div class="stop-body"><span class="stop-kind">${s[1]}</span><b>${s[2]}</b><small>${s[3]}</small></div></div>`).join('')}</div>
    <div class="legs">${c.legs.map((x) => `<span>↝ ${x}</span>`).join('')}</div>
    <div class="card-bottom"><button class="vote-btn ${selected ? 'voted' : ''}" data-vote="${c.id}">${selected ? '已选择' : '选择这条'} <span>→</span></button><span class="votes">${votes ? `${votes} 票` : '暂无票'}</span><span class="rating">${c.score}</span></div>
  </article>`;
}

function historyPanel() { return `<div class="history-panel"><div><b>历史版本</b><span>当前版本之外保留 5 个可回溯版本</span></div><button data-action="rollback">回溯版本 2</button></div>`; }

function bind() {
  document.querySelectorAll('[data-route]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('button')) { state.selected = el.dataset.route; render(); } }));
  document.querySelectorAll('[data-vote]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); state.selected = el.dataset.vote; state.votes[el.dataset.vote] = 1; render(); }));
  document.querySelector('[data-action="history"]')?.addEventListener('click', () => { state.showHistory = !state.showHistory; render(); });
  document.querySelector('[data-action="comment"]')?.addEventListener('click', () => { const input = document.querySelector('#commentInput'); if (input.value.trim()) { state.comments.push({ name: '林同学', text: input.value.trim() }); render(); } });
  document.querySelector('[data-action="share"]')?.addEventListener('click', () => { navigator.clipboard?.writeText(location.href); toast('房间链接已复制'); });
  document.querySelector('[data-action="rollback"]')?.addEventListener('click', () => { state.roomVersion += 1; state.showHistory = false; toast('已基于历史版本生成新一轮候选'); render(); });
  document.querySelector('[data-action="mapmode"]')?.addEventListener('click', () => toast('地图视角将在百度 JSAPI 4.0 接入后切换')); document.querySelector('[data-action="expand"]')?.addEventListener('click', () => toast('地图全屏预览即将开放'));
}
function toast(message) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); }

render();
