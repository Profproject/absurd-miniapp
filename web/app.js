// ====== CONFIG (EDIT THESE 3) ======
const API_BASE = "https://absurd-miniapp.onrender.com"; // <- твой backend
const BOT_USERNAME = "picabsurd_bot";              // без @
const MINIAPP_SHORTNAME = "absurd";                    // short name mini app в BotFather
// ===================================

const app = document.getElementById('app');
const tg = window.Telegram?.WebApp;

function getUserId() {
  const id = tg?.initDataUnsafe?.user?.id;
  return id ? String(id) : "0";
}

function getStartParam() {
  // ref via startapp
  return tg?.initDataUnsafe?.start_param || "";
}

const state = {
  userId: getUserId(),
  startParam: getStartParam(),
  freeUploads: 0,
  invoiceId: null,
  useFree: false,
  audioStarted: false
};

function startBgIfNeeded() {
  if (state.audioStarted) return;
  state.audioStarted = true;
  const bg = document.getElementById('bg');
  try { bg.volume = 0.22; bg.play(); } catch {}
}

function clickSound() {
  const c = document.getElementById('click');
  try {
    c.pause();
    c.currentTime = 0;
    c.volume = 0.9;
    const p = c.play();
    if (p?.catch) p.catch(() => {});
  } catch {}
}

function safeOpen(url) {
  // inside Telegram: use tg.openLink to avoid blocked popup
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank");
}

function safeOpenTelegram(url) {
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.location.href = url;
}

function renderLoading() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card isFrame">
        <div class="big big3d">Галерея абсурда загружается, ожидайте пожалуйста</div>

        <div class="loadBar3d">
          <div class="loadTrack"></div>
          <div class="loadBeam"></div>
        </div>

        
      </div>
    </div>
  `;
}

function attachPressFX() {
  document.querySelectorAll('.btn').forEach((b) => {
    b.addEventListener('pointerdown', () => b.classList.add('isDown'));
    b.addEventListener('pointerup', () => b.classList.remove('isDown'));
    b.addEventListener('pointercancel', () => b.classList.remove('isDown'));
    b.addEventListener('pointerleave', () => b.classList.remove('isDown'));
  });
}

function renderHome() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="big big3d">Преврати свой безумный абсурд в TON</div>

        <div class="sub">
          Подробности — ниже.
        </div>

        <div class="arrows"><span>↓</span><span>↓</span><span>↓</span></div>

        <div class="btns">
          <button class="btn" id="how"><span class="face">Как это работает</span></button>
          <button class="btn" id="upload">
            <span class="face">
              Загрузить изображение<br><span class="smallNote">(1 TON)</span>
            </span>
          </button>
          <button class="btn" id="invite"><span class="face">Пригласить друга</span></button>
        </div>

        <div class="under">
          <div class="free">
            Бесплатные загрузки: ${state.freeUploads}
            ${state.freeUploads > 0 ? `<a id="useFree">использовать 1 бесплатно</a>` : ``}
            <div style="margin-top:8px;color:rgba(255,255,255,.72);font-weight:900">
              3 оплаты рефералов = 1 бесплатная загрузка
            </div>
          </div>

          <div class="winner">
            <div class="winnerTitle">Победитель недели</div>
            <div class="winnerBox">?</div>
            <div class="winnerHint">Каждое воскресенье мы выбираем 1 победителя и отправляем 100 TON на его кошелёк.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  attachPressFX();

  document.getElementById('how').onclick = () => { startBgIfNeeded(); clickSound(); openHow(); };
  document.getElementById('upload').onclick = () => { startBgIfNeeded(); clickSound(); startPayment(); };
  document.getElementById('invite').onclick = () => { startBgIfNeeded(); clickSound(); openInvite(); };

  const useFree = document.getElementById('useFree');
  if (useFree) useFree.onclick = () => { startBgIfNeeded(); clickSound(); state.useFree = true; openForm(); };
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

    <p>😈 <b>1)</b> Нажми «Загрузить изображение» → оплата <b>1 TON</b> через Crypto Pay.</p>
    <p>🧩 <b>2)</b> После оплаты появится форма: <b>кошелёк</b>, <b>название</b>, <b>файл</b> → «Отправить».</p>
    <p>🎭 <b>3)</b> Можно: рисунок, фото, фотошоп, мем-арт, ИИ — всё подходит. Важен эффект.</p>
    <p>👑 <b>4)</b> Победителя выбирает <b>жюри</b>. Лайков нет — накрутки нет.</p>
    <p>💸 <b>5)</b> В воскресенье мы объявляем <b>1 победителя</b> и отправляем <b>100 TON</b> на указанный кошелёк.</p>

    <p style="opacity:.9"><b>Прозрачность:</b> проект живёт на комиссии с входных взносов. Это конкурс, не инвестиции.</p>
    <p style="opacity:.9"><b>Ранний этап:</b> сейчас участников мало — шанс победить выше.</p>
  `);
}

async function loadMe() {
  if (state.userId === "0") { state.freeUploads = 0; return; }
  const r = await fetch(`${API_BASE}/api/me?user_id=${encodeURIComponent(state.userId)}`);
  const j = await r.json();
  if (j?.ok) state.freeUploads = j.free_uploads || 0;
}

async function startPayment() {
  state.useFree = false;
  state.invoiceId = null;

  const r = await fetch(`${API_BASE}/api/create-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId, start_param: state.startParam })
  });

  const j = await r.json();
  if (!j?.ok || !j.pay_url) {
    openModal(`<h2>Ошибка</h2><p>Не удалось создать оплату. Попробуй ещё раз.</p>`);
    return;
  }

  state.invoiceId = j.invoice_id;

  // open Crypto Pay inside Telegram
  safeOpen(j.pay_url);

  // wait payment (poll)
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const s = await fetch(`${API_BASE}/api/invoice-status?invoice_id=${encodeURIComponent(state.invoiceId)}`);
      const sj = await s.json();
      if (sj?.status === "paid") {
        clearInterval(timer);
        openForm();
      }
      if (Date.now() - started > 10 * 60 * 1000) clearInterval(timer);
    } catch (e) {}
  }, 2000);
}

function openForm() {
  const modal = openModal(`
    <h2>Отправка работы</h2>

    <div class="warn">
      ⚠️ ВНИМАНИЕ: если ваш кошелёк содержит <b>MEMO/Комментарий</b> — обязательно укажите его.<br/>
      Иначе вы можете потерять еженедельную награду!!!
    </div>

    <label>TON-кошелёк (с MEMO при необходимости)</label>
    <input id="wallet" placeholder="UQ... / EQ... + MEMO если нужно" />

    <label>Название изображения</label>
    <input id="title" placeholder="Смешное название = плюс к шансам" />

    <label>Файл изображения</label>
    <input id="file" type="file" accept="image/*" />

    <div class="row">
      <button class="btn" id="send"><span class="face">Отправить</span></button>
    </div>
  `);

  // press fx for send button too
  modal.querySelectorAll('.btn').forEach((b) => {
    b.addEventListener('pointerdown', () => b.classList.add('isDown'));
    b.addEventListener('pointerup', () => b.classList.remove('isDown'));
    b.addEventListener('pointercancel', () => b.classList.remove('isDown'));
    b.addEventListener('pointerleave', () => b.classList.remove('isDown'));
  });

  modal.querySelector('#send').onclick = async () => {
    startBgIfNeeded();
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
      try { await loadMe(); } catch {}
      renderHome();
    } else {
      openModal(`<h2>Ошибка</h2><p>Не удалось отправить. Проверь оплату/файл и попробуй снова.</p>`);
    }
  };
}

function openInvite() {
  const ref = `ref_${state.userId}`;

  // link to mini app with referral
  const miniAppLink = `https://t.me/${BOT_USERNAME}/${MINIAPP_SHORTNAME}?startapp=${encodeURIComponent(ref)}`;

  const text =
    `😈 НЕАДЕКВАТНЫЙ КОНКУРС\n` +
    `Загрузи абсурд — получи шанс на 100 TON в воскресенье.\n\n` +
    `Мой код: ${ref}`;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(miniAppLink)}&text=${encodeURIComponent(text)}`;

  safeOpenTelegram(shareUrl);
}

// BOOT
try { tg?.ready?.(); tg?.expand?.(); } catch {}

renderLoading();

// ALWAYS go to home quickly (never stuck on loading)
setTimeout(async () => {
  try { await loadMe(); } catch {}
  renderHome();
}, 3000);






