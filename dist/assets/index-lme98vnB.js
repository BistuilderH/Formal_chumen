(function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))o(e);new MutationObserver(e=>{for(const n of e)if(n.type==="childList")for(const l of n.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&o(l)}).observe(document,{childList:!0,subtree:!0});function i(e){const n={};return e.integrity&&(n.integrity=e.integrity),e.referrerPolicy&&(n.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?n.credentials="include":e.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function o(e){if(e.ep)return;e.ep=!0;const n=i(e);fetch(e.href,n)}})();const r=[{id:"north",tag:"通勤更均衡",title:"静安寺 · 手作工坊 → 本帮菜 → 微醺酒馆",note:"两人的首段通勤差距较小，活动间都在步行上限内。",total:"¥438 / 人",meet:"15:48 集合",returnTime:"22:00 开始返程",score:"9.2",stations:"静安寺站 · 2/7/14号线",stops:[["15:48","DIY 手作","拾光陶艺（静安店）","活动 80 分钟 · ¥128"],["17:30","晚餐","甬府小鲜（静安嘉里店）","步行 8 分钟 · 人均 ¥168"],["19:35","酒吧","棠梨酒馆","步行 7 分钟 · 约 ¥142"]],legs:["上交大 → 静安寺：地铁 39 分钟","上海站 → 静安寺：地铁 18 分钟"]},{id:"people",tag:"地点质量更高",title:"愚园路 · KTV → 创意菜 → 隐藏酒吧",note:"更靠近主理人偏好的小店，上海站一方通勤更省时。",total:"¥486 / 人",meet:"15:42 集合",returnTime:"22:00 开始返程",score:"8.9",stations:"江苏路站 · 2/11号线",stops:[["15:42","娱乐","玩点 KTV（愚园路店）","活动 90 分钟 · ¥158"],["17:40","晚餐","南城小馆","骑行 8 分钟 · 人均 ¥186"],["19:50","酒吧","Blank Room","步行 11 分钟 · 约 ¥142"]],legs:["上交大 → 江苏路：地铁 31 分钟","上海站 → 江苏路：地铁 14 分钟"]},{id:"xuhui",tag:"预算最宽松",title:"徐家汇 · 桌游 → 本帮菜 → 屋顶酒吧",note:"预算余量最多，但上交大一方需要多一次换乘。",total:"¥392 / 人",meet:"15:55 集合",returnTime:"22:00 开始返程",score:"8.7",stations:"徐家汇站 · 1/9/11号线",stops:[["15:55","娱乐","骰子星球桌游","活动 90 分钟 · ¥96"],["17:50","晚餐","老吉士（徐家汇店）","步行 9 分钟 · 人均 ¥154"],["19:55","酒吧","Roof 19","步行 10 分钟 · 约 ¥142"]],legs:["上交大 → 徐家汇：地铁 27 分钟","上海站 → 徐家汇：地铁 32 分钟"]}],a={selected:"north",votes:{north:1,people:0,xuhui:0},comments:[],roomVersion:3,showHistory:!1},v=document.querySelector("#app");function d(){const t=r.find(i=>i.id===a.selected),s=Object.values(a.votes).reduce((i,o)=>i+o,0);v.innerHTML=`
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
            <button class="history-btn" data-action="history">版本 ${a.roomVersion} <span>⌄</span></button>
          </div>
          ${a.showHistory?u():""}
          <div class="route-context">
            <div class="person"><div class="avatar avatar-blue">林</div><div><b>林同学</b><span>上海交通大学 · 预计 39 分钟</span></div></div>
            <div class="connector"><span>集合</span></div>
            <div class="person"><div class="avatar avatar-orange">周</div><div><b>周同学</b><span>上海火车站 · 预计 18 分钟</span></div></div>
            <div class="context-rule"><span>步行 ≤ 15 分钟</span><span>骑行 ≤ 10 分钟</span></div>
          </div>
          <div class="section-head"><div><h2>选一条你更想走的路线</h2><p>每人可投一票，票数相同由局主决定</p></div><span class="vote-count">${s} 人已投票</span></div>
          <div class="cards">${r.map(i=>p(i)).join("")}</div>
          <div class="comment-box">
            <div class="comment-title"><span class="comment-icon">✦</span><div><b>有想法就留言</b><span>留言会和本轮路线一起保存</span></div></div>
            <div class="comment-input"><input id="commentInput" placeholder="比如：第二站想换成更安静的餐厅…"/><button data-action="comment">发送</button></div>
            ${a.comments.length?`<div class="comment-list">${a.comments.map(i=>`<div><b>${i.name}</b><span>${i.text}</span></div>`).join("")}</div>`:""}
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
            <div class="map-caption"><b>${t.title.split(" · ")[0]}</b><span>${t.stations}</span></div>
          </div>
          <div class="map-footer"><div><span class="legend-dot blue"></span>林同学 <b>39 分钟</b></div><div><span class="legend-dot orange"></span>周同学 <b>18 分钟</b></div><button data-action="expand">放大地图</button></div>
        </aside>
      </main>
      <footer class="statusbar"><div><span class="lock">⌁</span> 房间内容仅成员可见 · ${a.roomVersion} 个版本已保存</div><div><span class="green-dot"></span> 地图数据已更新 · 刚刚</div></footer>
    </div>`,m()}function p(t){const s=a.selected===t.id,i=a.votes[t.id];return`<article class="route-card ${s?"selected":""}" data-route="${t.id}">
    <div class="card-top"><span class="route-tag ${s?"active-tag":""}">${t.tag}</span><span class="radio ${s?"checked":""}">${s?"✓":""}</span></div>
    <h3>${t.title}</h3><p class="route-note">${t.note}</p>
    <div class="route-meta"><span>✦ ${t.total}</span><span>◷ ${t.meet}</span><span>⌂ ${t.returnTime}</span></div>
    <div class="timeline">${t.stops.map((o,e)=>`<div class="stop"><div class="time">${o[0]}</div><div class="line-dot ${e===t.stops.length-1?"last":""}"></div><div class="stop-body"><span class="stop-kind">${o[1]}</span><b>${o[2]}</b><small>${o[3]}</small></div></div>`).join("")}</div>
    <div class="legs">${t.legs.map(o=>`<span>↝ ${o}</span>`).join("")}</div>
    <div class="card-bottom"><button class="vote-btn ${s?"voted":""}" data-vote="${t.id}">${s?"已选择":"选择这条"} <span>→</span></button><span class="votes">${i?`${i} 票`:"暂无票"}</span><span class="rating">${t.score}</span></div>
  </article>`}function u(){return'<div class="history-panel"><div><b>历史版本</b><span>当前版本之外保留 5 个可回溯版本</span></div><button data-action="rollback">回溯版本 2</button></div>'}function m(){document.querySelectorAll("[data-route]").forEach(t=>t.addEventListener("click",s=>{s.target.closest("button")||(a.selected=t.dataset.route,d())})),document.querySelectorAll("[data-vote]").forEach(t=>t.addEventListener("click",s=>{s.stopPropagation(),a.selected=t.dataset.vote,a.votes[t.dataset.vote]=1,d()})),document.querySelector('[data-action="history"]')?.addEventListener("click",()=>{a.showHistory=!a.showHistory,d()}),document.querySelector('[data-action="comment"]')?.addEventListener("click",()=>{const t=document.querySelector("#commentInput");t.value.trim()&&(a.comments.push({name:"林同学",text:t.value.trim()}),d())}),document.querySelector('[data-action="share"]')?.addEventListener("click",()=>{navigator.clipboard?.writeText(location.href),c("房间链接已复制")}),document.querySelector('[data-action="rollback"]')?.addEventListener("click",()=>{a.roomVersion+=1,a.showHistory=!1,c("已基于历史版本生成新一轮候选"),d()}),document.querySelector('[data-action="mapmode"]')?.addEventListener("click",()=>c("地图视角将在百度 JSAPI 4.0 接入后切换")),document.querySelector('[data-action="expand"]')?.addEventListener("click",()=>c("地图全屏预览即将开放"))}function c(t){const s=document.createElement("div");s.className="toast",s.textContent=t,document.body.appendChild(s),setTimeout(()=>s.remove(),2200)}d();
