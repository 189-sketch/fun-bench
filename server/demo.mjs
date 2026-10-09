const base = (body, css, script = '') =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif}button{cursor:pointer;font:inherit} ${css}</style></head><body>${body}<script>${script}</script></body></html>`;
export const demoTask = {
  title: '把专注时间，变成一个小小的仪式',
  prompt:
    '我在居家工作时很容易分心。请用单文件 HTML 制作一个番茄钟：可以开始、暂停、重置，支持 25 分钟专注和 5 分钟休息切换。希望它看起来舒服，有一点让人愿意回来使用的小巧思。所有 CSS 和 JavaScript 内联，不使用外部依赖，返回完整 HTML。',
  evaluation:
    '功能完整性（40 分）：开始、暂停、重置与模式切换正确。\n使用体验（30 分）：操作清楚，计时易读，状态反馈明确。\n视觉与趣味（30 分）：界面舒适，并有让人愿意继续使用的设计。',
  format: 'html',
  criteria: [
    { name: '功能完整性', description: '开始、暂停、重置、模式切换是否正确', maxScore: 40 },
    { name: '使用体验', description: '操作是否直观，反馈是否清晰', maxScore: 30 },
    { name: '视觉与趣味', description: '界面是否舒服，有没有想再用一次', maxScore: 30 },
  ],
};
const timerScript = `let remaining=1500,total=1500,timer=null;const display=document.getElementById('clock'),start=document.getElementById('start');function draw(){display.textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');document.documentElement.style.setProperty('--progress',((total-remaining)/total*100)+'%')}function pause(){clearInterval(timer);timer=null;start.textContent='开始专注'}start.onclick=()=>{if(timer){pause();return}if(!remaining)remaining=total;start.textContent='暂停一下';timer=setInterval(()=>{remaining--;draw();if(remaining<=0){pause();document.getElementById('note').textContent='这一刻，属于认真生活的你。休息一下吧。'}},1000)};document.getElementById('reset').onclick=()=>{pause();remaining=total;draw()};document.querySelectorAll('[data-min]').forEach(btn=>btn.onclick=()=>{pause();total=remaining=Number(btn.dataset.min)*60;document.querySelectorAll('[data-min]').forEach(b=>b.classList.toggle('active',b===btn));draw()});draw();`;
export const demoEntries = [
  {
    name: '纸飞机 · 演示作品',
    model: 'paper-plane-demo',
    protocol: 'demo',
    content: base(
      '<main><div class="eyebrow">A LITTLE TIME FOR YOURSELF</div><h1>慢慢来，比较快。</h1><p id="note">把世界调成静音，只做眼前这一件事。</p><div class="modes"><button class="active" data-min="25">专注 25 分钟</button><button data-min="5">休息 5 分钟</button></div><div class="ring"><span id="clock">25:00</span><small>ONE THING AT A TIME</small></div><div class="buttons"><button id="start">开始专注</button><button id="reset">重置</button></div><footer>今天的每一点专注，都算数。</footer></main>',
      'body{background:#f0f2e8;color:#304735}main{text-align:center;padding:38px 18px}.eyebrow{font-size:10px;letter-spacing:3px;color:#687a61}h1{font-size:28px;margin:15px 0 10px}p{font-size:13px;color:#67775e}.modes{display:flex;justify-content:center;gap:6px;margin:24px 0}.modes button{border:0;background:transparent;color:#4c624a;padding:9px 12px;border-radius:20px;font-size:12px}.modes .active{background:#dce4cf}.ring{width:205px;height:205px;border:7px solid #d5dfc5;border-top-color:#78945d;border-radius:50%;margin:0 auto 24px;display:flex;flex-direction:column;justify-content:center}#clock{font-size:51px;font-variant-numeric:tabular-nums;letter-spacing:-3px}.ring small{font-size:8px;letter-spacing:2px;margin-top:8px;color:#829471}.buttons{display:flex;gap:9px;justify-content:center}.buttons button{padding:12px 24px;border:0;border-radius:8px;background:#dce4cf;color:#304735}.buttons #start{background:#405b3b;color:white}footer{margin-top:28px;color:#849177;font-size:11px}',
      timerScript,
    ),
  },
  {
    name: '小彗星 · 演示作品',
    model: 'little-comet-demo',
    protocol: 'demo',
    content: base(
      '<main><span class="pill">FOCUS CLUB / 001</span><h1>今天，也要闪闪发光。</h1><div class="modes"><button class="active" data-min="25">专注</button><button data-min="5">休息</button></div><div class="sun">✺</div><div id="clock">25:00</div><p id="note">下一站：心无旁骛。</p><div><button id="start">开始专注</button><button id="reset" aria-label="重置">↻</button></div><footer><span></span> 给大脑一点留白。</footer></main>',
      'body{background:#fff0cf;color:#6c3623}main{text-align:center;padding:30px 15px}.pill{font-size:10px;border:1px solid #d5af7e;border-radius:20px;padding:6px 12px;letter-spacing:1px}h1{font-size:24px;margin:25px 0 18px}.modes{display:inline-flex;background:#f3dfb2;padding:4px;border-radius:25px}.modes button{border:0;border-radius:20px;padding:8px 24px;background:transparent;color:#79523a;font-size:12px}.modes .active{background:#fff9e9}.sun{font-size:65px;color:#ef8251;margin:12px auto 0;animation:spin 35s linear infinite;width:80px}#clock{font-size:68px;letter-spacing:-4px;font-weight:750;font-variant-numeric:tabular-nums}p{font-size:13px;color:#a47d5b;margin:3px 0 24px}#start{background:#e87845;color:#fff9eb;border:0;border-radius:24px;padding:13px 37px}#reset{border:1px solid #d7b684;color:#8a5639;border-radius:50%;background:transparent;width:43px;height:43px;margin-left:8px}footer{margin-top:30px;font-size:11px;color:#a47d5b}footer span{display:inline-block;width:6px;height:6px;border-radius:50%;background:#9baf79;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.sun{animation:none}}',
      timerScript,
    ),
  },
  {
    name: '夜航船 · 演示作品',
    model: 'night-sail-demo',
    protocol: 'demo',
    content: base(
      '<main><div class="top">QUIET HOURS <span>● ONLINE</span></div><h1>留一段时间给自己。</h1><p id="note">一件事。一个当下。一次深呼吸。</p><div class="modes"><button class="active" data-min="25">25 / 专注</button><button data-min="5">05 / 休息</button></div><div id="clock">25:00</div><div class="track"><div></div></div><div class="controls"><button id="start">开始专注</button><button id="reset">重新开始</button></div><footer>LESS NOISE. MORE YOU.</footer></main>',
      'body{background:#232d3b;color:#e9e4d7}main{padding:32px 30px;max-width:480px;margin:auto}.top{font-size:10px;letter-spacing:2px;color:#a5b0bc;display:flex;justify-content:space-between}.top span{color:#b9cfa1;font-size:8px}h1{margin:45px 0 8px;font-size:26px}p{font-size:12px;color:#9ca8b6}.modes{display:flex;gap:10px;margin-top:26px}.modes button{border:1px solid #4a5563;background:transparent;color:#a8b3bf;border-radius:6px;padding:8px 13px;font-size:11px}.modes .active{background:#3c4857;color:#f0ebde}#clock{font-size:86px;letter-spacing:-5px;font-variant-numeric:tabular-nums;font-weight:300;margin:15px 0}.track{height:3px;background:#46515f}.track div{height:100%;width:var(--progress,0%);background:#bdcea7}.controls{display:flex;gap:12px;margin-top:30px}.controls button{padding:12px 22px;border:1px solid #566170;border-radius:5px;background:transparent;color:#c4cbd1}.controls #start{background:#c5d3af;color:#263528;border:0}footer{font-size:9px;letter-spacing:3px;color:#7d8b9e;margin-top:35px}',
      timerScript,
    ),
  },
];
