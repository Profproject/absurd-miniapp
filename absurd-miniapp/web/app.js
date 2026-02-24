// 1) ВПИШИ backend URL после деплоя (Render выдаст домен)
const API_BASE = "https://YOUR_BACKEND_DOMAIN";

const app = document.getElementById('app');
const tg = window.Telegram?.WebApp;

function getUserId() {
  const id = tg?.initDataUnsafe?.user?.id;
  return id ? String(id) : "0";
}

function getStartParam() {
  return tg?.initDataUnsafe?.start_param || "";
}

const state = {
  userId: getUserId(),
  startParam: getStartParam(),
  freeUploads: 0,
  invoiceId: null,
  useFree: false
};

function clickSound() {
  const c = document.getElementById('click');
  try { c.currentTime = 0; c.volume = 0.7; c.play(); } catch {}
}

function ensureBgAudioOnce() {
  const bg = document.getElementById('bg');
  try { bg.volume = 0.25; bg.play(); } catch {}
  window.removeEventListener('pointerdown', ensureBgAudioOnce);
}
window.addEventListener('pointerdown', ensureBgAudioOnce, { once: true });

function renderLoading() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="big">ЗАГРУЖАЕМ ГАЛЕРЕЮ АБСУРДА…</div>
        <div class="sub">Честно. Прозрачно. Победитель — каждое воскресенье.</div>
        <div class="sub" style="color:rgba(190,120,255,.85)">Нажми в любом месте, чтобы включить звук.</div>
      </div>
    </div>
  `;
}

function renderHome() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="big">НЕАДЕКВАТНЫЙ КОНКУРС</div>

        <div class="intro">
          Загрузи гениально-абсурдную картинку. Если рассмешишь нас — победишь и получишь <b>100 TON</b>.
          Детали — ниже.
        </div>

        <div class="arrows"><span>⬇</span><span>⬇</span><span>⬇</span></div>

        <div class="btns">
          <button class="btn" id="how"><span class="face">Как это работает</span></button>
          <button class="btn" id="upload"><span class="face">Загрузить изображение (1 TON)</span></button>
          <button class="btn" id="invite"><span class="face">Пригласить друга</span></button>
        </div>

        <div class="under">
          <div class="free">
            <b>Бесплатные загрузки:</b> ${state.freeUploads}
            ${state.freeUploads > 0 ? `<a id="useFree">использовать 1 бесплатно</a>` : ``}
            <div style="margin-top:6px;color:rgba(255,255,255,.72);font-weight:900">
              3 оплаты рефералов = 1 бесплатная загрузка
            </div>
          </div>

          <div class="winner">
            <div class="winnerTitle">Победитель недели</div>
            <div class="winnerBox">?</div>
            <div class="winnerHint">Каждое воскресенье здесь появляется победитель и получает 100 TON.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('how').onclick = () => { clickSound(); openHow(); };
  document.getElementById('upload').onclick = () => { clickSound(); startPayment(); };
  document.getElementById('invite').onclick = () => { clickSound(); openInvite(); };
  const useFree = document.getElementById('useFree');
  if (useFree) useFree.onclick = () => { clickSound(); state.useFree = true; openForm(); };
}

function openModal(innerHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'back';
  wrap.innerHTML = `
    <div class="modal">
      <button class="x" id="x">✕</button>
      ${innerHtml}
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('#x').onclick = () => { clickSound(); wrap.remove(); };
  wrap.onclick = (e) => { if (e.target === wrap) { clickSound(); wrap.remove(); } };
  return wrap;
}

function openHow() {
  openModal(`
    <h2>Как это работает</h2>
    <p><b>1)</b> Нажми «Загрузить изображение» → оплата <b>1 TON</b> через Crypto Pay.</p>
    <p><b>2)</b> После оплаты откроется форма: <b>кошелёк</b>, <b>название</b>, <b>файл</b>.</p>
    <p><b>3)</b> Можно: рисунок, фото, фотошоп, мем-арт, ИИ — всё подходит. Важен эффект.</p>
    <p><b>4)</b> Победителя выбирает <b>жюри</b>. Лайков нет — накрутки нет.</p>
    <p><b>5)</b> В воскресенье мы объявляем <b>1 победителя</b> недели и отправляем <b>100 TON</b> на ваш кошелёк.</p>
    <p><b>Прозрачность:</b> проект живёт на комиссии с входных взносов. Это конкурс, не инвестиции.</p>
    <p><b>Ранний этап:</b> сейчас участников мало — шанс победить выше.</p>
  `);
}

function openInvite() {
  const ref = `ref_${state.userId}`;
  openModal(`
    <h2>Пригласить друга</h2>
    <p>Отправь другу ссылку на мини-апп с твоим кодом.</p>
    <p><b>Награда:</b> 3 оплаты рефералов = 1 бесплатная загрузка.</p>
    <div class="warn" style="border-color:rgba(190,120,255,.55);background:rgba(190,120,255,.08);color:rgba(240,230,255,.95)">
      Твой код: <b>${ref}</b><br/>
      (ссылку вставим после привязки mini-app в BotFather)
    </div>
  `);
}

async function loadMe() {
  if (state.userId === "0") return;
  const r = await fetch(`${API_BASE}/api/me?user_id=${encodeURIComponent(state.userId)}`);
  const j = await r.json();
  if (j?.ok) state.freeUploads = j.free_uploads || 0;
}

async function startPayment() {
  state.useFree = false;
  const r = await fetch(`${API_BASE}/api/create-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId, start_param: state.startParam })
  });
  const j = await r.json();
  if (!j?.ok) return;

  state.invoiceId = j.invoice_id;

  // редирект на Crypto Pay
  window.open(j.pay_url, "_blank");

  // ждём оплату (poll)
  const started = Date.now();
  const timer = setInterval(async () => {
    const s = await fetch(`${API_BASE}/api/invoice-status?invoice_id=${encodeURIComponent(state.invoiceId)}`);
    const sj = await s.json();
    if (sj?.status === "paid") {
      clearInterval(timer);
      openForm();
    }
    if (Date.now() - started > 10 * 60 * 1000) clearInterval(timer);
  }, 2000);
}

function openForm() {
  const modal = openModal(`
    <h2>Отправка работы</h2>
    <div class="warn">
      ВНИМАНИЕ: если ваш кошелёк содержит <b>MEMO/Комментарий</b> — обязательно укажите его.
      Иначе вы можете потерять еженедельную награду!!!
    </div>

    <label>TON-кошелёк (с MEMO при необходимости)</label>
    <input id="wallet" placeholder="UQ... / EQ... + MEMO если нужно" />

    <label>Название изображения</label>
    <input id="title" placeholder="Смешное название = плюс к шансам" />

    <label>Файл изображения</label>
    <input id="file" type="file" accept="image/*" />

    <div style="margin-top:14px">
      <button class="btn" id="send"><span class="face">Отправить</span></button>
    </div>
  `);

  modal.querySelector('#send').onclick = async () => {
    clickSound();
    const wallet = modal.querySelector('#wallet').value.trim();
    const title = modal.querySelector('#title').value.trim();
    const file = modal.querySelector('#file').files?.[0];

    if (!wallet || !title || !file) return;

    const fd = new FormData();
    fd.append('user_id', state.userId);
    fd.append('wallet', wallet);
    fd.append('title', title);
    fd.append('image', file);

    if (state.useFree) {
      fd.append('use_free', '1');
    } else {
      fd.append('invoice_id', String(state.invoiceId || ''));
    }

    const r = await fetch(`${API_BASE}/api/submit`, { method: 'POST', body: fd });
    const j = await r.json();
    if (j?.ok) {
      modal.remove();
      await loadMe();
      renderHome();
    }
  };
}

// boot
try { tg?.ready?.(); tg?.expand?.(); } catch {}
renderLoading();
setTimeout(async () => {
  await loadMe();
  renderHome();
}, 900);