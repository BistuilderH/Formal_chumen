/**
 * Small progressive enhancement layer for the editorial UI. It only decorates
 * existing nodes; route generation, map data and room state stay untouched.
 */
const decorate = () => {
  const root = document.querySelector('#app') || document.body;
  root.classList.add('premium-shell');
  if (!root.querySelector('.premium-masthead')) {
    const masthead = document.createElement('section');
    masthead.className = 'premium-masthead';
    masthead.setAttribute('aria-label', '产品介绍');
    masthead.innerHTML = '<div class="premium-masthead__brand"><span class="premium-mark">↗</span><span>CHUMEN / 出门</span></div><div class="premium-masthead__story"><span class="premium-masthead__eyebrow">URBAN RENDEZVOUS · SHANGHAI</span><strong>把分散的出发地，编排成今晚的一条路。</strong></div><div class="premium-masthead__meta">城市约见策划台 <span aria-hidden="true">·</span> 实时协作</div>';
    root.prepend(masthead);
  }
  const map = root.querySelector('[data-map], #map, .map, .map-panel, .map-stage');
  if (map) map.classList.add('premium-map-stage');
  root.querySelectorAll('button').forEach((button) => {
    button.classList.add('premium-button');
    if (/生成|规划|开始|更新|确认|采用|分享/.test(button.textContent || '')) button.classList.add('premium-primary');
  });
  root.querySelectorAll('input, select, textarea').forEach((field) => field.classList.add('premium-field'));
  root.querySelectorAll('[data-activity], .activity, .activity-card, .route-stop, .timeline-item').forEach((item, index) => {
    item.classList.add('premium-stop');
    item.style.setProperty('--stagger', `${Math.min(index, 7) * 65}ms`);
  });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate, { once: true });
else decorate();
let decorateFrame = 0;
const observer = new MutationObserver(() => {
  cancelAnimationFrame(decorateFrame);
  decorateFrame = requestAnimationFrame(decorate);
});
observer.observe(document.body, { childList: true, subtree: true });
