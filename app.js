/**
 * 家計トラッカー PWA
 */

// ===== 設定 =====
const APP_CONFIG = {
  // GAS WebアプリのURL（デプロイ後に設定）
  API_URL: '',

  // デモモード（API未設定時にモックデータで表示）
  get isDemoMode() {
    return !this.API_URL;
  },
};

// ===== 状態管理 =====
const state = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  data: null,
  targetPercent: loadTargetPercent(),
  budgetOverrides: loadBudgetOverrides(),
};

// ===== パスワード認証 =====
const AUTH_CONFIG = {
  SESSION_DAYS: 30, // セッション有効期間（日）
};

let authMode = 'verify'; // 'setup', 'confirm', 'verify'
let setupPassword = '';

function initAuth() {
  const storedHash = localStorage.getItem('authHash');
  const form = document.getElementById('authForm');
  const input = document.getElementById('authInput');

  if (!storedHash) {
    authMode = 'setup';
    document.getElementById('lockMessage').textContent = '新しいパスワードを設定してください';
    input.placeholder = '英数字・記号（20文字以内）';
    document.querySelector('.auth-submit').textContent = '設定';
  } else if (isSessionValid()) {
    unlockApp();
    return;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAuthSubmit();
  });

  input.focus();
}

function handleAuthSubmit() {
  const input = document.getElementById('authInput');
  const password = input.value;
  const errorEl = document.getElementById('authError');

  if (!password) return;

  if (authMode === 'setup') {
    if (password.length < 4) {
      errorEl.textContent = '4文字以上で設定してください';
      return;
    }
    setupPassword = password;
    authMode = 'confirm';
    input.value = '';
    errorEl.textContent = '';
    document.getElementById('lockMessage').textContent = '確認のためもう一度入力してください';
    input.focus();
    return;
  }

  if (authMode === 'confirm') {
    if (password === setupPassword) {
      hashPassword(setupPassword).then(hash => {
        localStorage.setItem('authHash', hash);
        setSession();
        unlockApp();
      });
    } else {
      authMode = 'setup';
      setupPassword = '';
      input.value = '';
      errorEl.textContent = 'パスワードが一致しません。もう一度設定してください';
      document.getElementById('lockMessage').textContent = '新しいパスワードを設定してください';
      document.querySelector('.auth-submit').textContent = '設定';
      input.focus();
    }
    return;
  }

  // verify
  const storedHash = localStorage.getItem('authHash');
  hashPassword(password).then(hash => {
    if (hash === storedHash) {
      setSession();
      unlockApp();
    } else {
      errorEl.textContent = 'パスワードが違います';
      input.value = '';
      input.focus();
    }
  });
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode('kakeibo_' + password + '_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function setSession() {
  const expires = Date.now() + AUTH_CONFIG.SESSION_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem('authSession', String(expires));
}

function isSessionValid() {
  const expires = localStorage.getItem('authSession');
  if (!expires) return false;
  return Date.now() < parseInt(expires);
}

function unlockApp() {
  document.getElementById('lockScreen').style.display = 'none';
  document.getElementById('app').style.display = '';
  initNavigation();
  initModals();
  loadData();
  registerServiceWorker();
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});

// ===== ナビゲーション =====
function initNavigation() {
  document.getElementById('prevMonth').addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 1) {
      state.currentMonth = 12;
      state.currentYear--;
    }
    loadData();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 12) {
      state.currentMonth = 1;
      state.currentYear++;
    }
    loadData();
  });

  // スワイプ対応
  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 80) {
      if (diff > 0) {
        document.getElementById('nextMonth').click();
      } else {
        document.getElementById('prevMonth').click();
      }
    }
  }, { passive: true });

  // 目標%設定ボタン
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
}

// ===== モーダル =====
function initModals() {
  // 予算編集モーダル
  const budgetModal = document.getElementById('budgetModal');
  budgetModal.querySelector('.modal-overlay').addEventListener('click', closeBudgetModal);
  document.getElementById('budgetCancel').addEventListener('click', closeBudgetModal);
  document.getElementById('budgetSave').addEventListener('click', saveBudgetEdit);
  document.getElementById('budgetReset').addEventListener('click', resetBudgetEdit);
  document.getElementById('budgetInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBudgetEdit();
  });

  // 設定モーダル
  const settingsModal = document.getElementById('settingsModal');
  settingsModal.querySelector('.modal-overlay').addEventListener('click', closeSettings);
  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.getElementById('targetInput').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 0 && val <= 200) {
      document.getElementById('targetValue').textContent = val + '%';
    }
  });
  document.getElementById('targetInput').addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 0 && val <= 200) {
      state.targetPercent = val;
      saveTargetPercent(val);
      render(state.data);
    }
  });

  initPinReset();
}

// ===== データ取得 =====
async function loadData() {
  const monthStr = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}`;
  updateMonthTitle();
  showLoading(true);

  try {
    let data;
    if (APP_CONFIG.isDemoMode) {
      data = generateMockData(state.currentYear, state.currentMonth);
    } else {
      const res = await fetch(`${APP_CONFIG.API_URL}?month=${monthStr}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    }

    // 予算オーバーライドを適用
    data = applyBudgetOverrides(data);
    state.data = data;

    // オフライン用にキャッシュ
    try {
      localStorage.setItem(`budget_${monthStr}`, JSON.stringify(data));
    } catch (e) { /* quota exceeded は無視 */ }

    render(data);
  } catch (err) {
    // オフラインキャッシュから復元
    const cached = localStorage.getItem(`budget_${monthStr}`);
    if (cached) {
      render(JSON.parse(cached));
    } else {
      showError(err.message);
    }
  }
}

// ===== 予算オーバーライド =====
function applyBudgetOverrides(data) {
  const overrides = state.budgetOverrides;
  if (!overrides || Object.keys(overrides).length === 0) return data;

  let totalBudget = 0;
  for (const cat of data.categories) {
    if (overrides[cat.name] !== undefined) {
      cat.budget = overrides[cat.name];
    }
    totalBudget += cat.budget;
  }
  data.totalBudget = totalBudget;
  return data;
}

function loadBudgetOverrides() {
  try {
    return JSON.parse(localStorage.getItem('budgetOverrides') || '{}');
  } catch { return {}; }
}

function saveBudgetOverrides(overrides) {
  state.budgetOverrides = overrides;
  localStorage.setItem('budgetOverrides', JSON.stringify(overrides));
}

function loadTargetPercent() {
  const val = localStorage.getItem('targetPercent');
  return val ? parseInt(val) : 85;
}

function saveTargetPercent(val) {
  localStorage.setItem('targetPercent', String(val));
}

// ===== 日進捗 =====
function getDayProgress(year, month) {
  const now = new Date();
  const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth() + 1);
  if (!isCurrentMonth) {
    // 過去月は100%、未来月は0%
    const target = new Date(year, month - 1, 1);
    const current = new Date(now.getFullYear(), now.getMonth(), 1);
    return target < current ? 1.0 : 0;
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  return now.getDate() / daysInMonth;
}

// ===== 描画 =====
function render(data) {
  showLoading(false);
  if (!data) return;

  const dayProgress = getDayProgress(state.currentYear, state.currentMonth);
  const target = state.targetPercent;

  // 全体サマリー
  const percent = data.totalBudget > 0
    ? Math.round((data.totalActual / data.totalBudget) * 100)
    : 0;
  const remaining = data.totalBudget - data.totalActual;
  const pacePercent = target * dayProgress;

  document.getElementById('totalActual').textContent = formatYen(data.totalActual);
  document.getElementById('totalBudget').textContent = formatYen(data.totalBudget);
  document.getElementById('totalPercent').textContent = `${percent}%`;
  document.getElementById('totalRemaining').textContent = `残り ${formatYen(remaining)}`;

  const totalFill = document.getElementById('totalProgressFill');
  totalFill.style.width = `${Math.min(percent, 100)}%`;
  totalFill.className = `progress-fill ${getStatusClass(percent, pacePercent, target)}`;

  // 全体プログレスバーのマーカー
  const totalContainer = document.getElementById('totalProgress').parentElement;
  updateMarkers(totalContainer, target, pacePercent);

  // ペース情報
  const paceInfo = document.getElementById('paceInfo');
  if (dayProgress > 0 && dayProgress < 1) {
    const paceTarget = Math.round(data.totalBudget * target / 100 * dayProgress);
    const diff = data.totalActual - paceTarget;
    if (diff > 0) {
      paceInfo.textContent = `目標ペースより ${formatYen(diff)} 超過`;
      paceInfo.className = 'pace-info over';
    } else {
      paceInfo.textContent = `目標ペースまで ${formatYen(Math.abs(diff))} 余裕`;
      paceInfo.className = 'pace-info under';
    }
  } else {
    paceInfo.textContent = '';
  }

  // カテゴリ一覧
  const container = document.getElementById('categoriesList');
  container.innerHTML = '';

  for (const cat of data.categories) {
    if (cat.budget === 0 && cat.actual === 0) continue;

    const catPercent = cat.budget > 0
      ? Math.round((cat.actual / cat.budget) * 100)
      : (cat.actual > 0 ? 999 : 0);
    const catRemaining = cat.budget - cat.actual;
    const catPacePercent = target * dayProgress;
    const statusClass = getStatusClass(catPercent, catPacePercent, target);
    const isOverridden = state.budgetOverrides[cat.name] !== undefined;

    const card = document.createElement('div');
    card.className = 'category-card';
    card.dataset.category = cat.name;
    card.innerHTML = `
      <div class="category-header">
        <span class="category-name">${escapeHtml(cat.name)}</span>
        <span class="category-amounts">
          ${formatYen(cat.actual)} / ${formatYen(cat.budget)}${isOverridden ? ' <span class="badge-edited">編集済</span>' : ''}
        </span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar category-bar">
          <div class="progress-fill ${statusClass}" style="width: ${Math.min(catPercent, 100)}%"></div>
        </div>
      </div>
      <div class="category-meta">
        <span class="category-percent ${statusClass}">${catPercent}%</span>
        <span class="category-remaining">${catRemaining >= 0 ? `残り ${formatYen(catRemaining)}` : `${formatYen(Math.abs(catRemaining))} 超過`}</span>
      </div>
    `;

    // タップで予算編集
    card.addEventListener('click', () => openBudgetModal(cat.name, cat.budget, cat.actual));

    // マーカー追加
    const barContainer = card.querySelector('.progress-bar-container');
    updateMarkers(barContainer, target, catPacePercent);

    container.appendChild(card);
  }

  // 更新日時
  if (data.updatedAt) {
    const d = new Date(data.updatedAt);
    document.getElementById('updatedAt').textContent =
      `最終更新: ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  if (APP_CONFIG.isDemoMode) {
    document.getElementById('updatedAt').textContent += '（デモモード）';
  }
}

// ===== マーカー描画 =====
function updateMarkers(container, targetPercent, pacePercent) {
  // 既存マーカーを削除
  container.querySelectorAll('.target-marker, .pace-marker').forEach(el => el.remove());

  // 目標マーカー（85%ライン）
  if (targetPercent > 0 && targetPercent <= 100) {
    const targetMarker = document.createElement('div');
    targetMarker.className = 'target-marker';
    targetMarker.style.left = `${targetPercent}%`;
    targetMarker.title = `目標: ${targetPercent}%`;
    container.appendChild(targetMarker);
  }

  // ペースマーカー（今日時点の目標ペース）
  if (pacePercent > 0 && pacePercent < 100) {
    const paceMarker = document.createElement('div');
    paceMarker.className = 'pace-marker';
    paceMarker.style.left = `${Math.min(pacePercent, 100)}%`;
    paceMarker.title = `今日の目標ペース: ${Math.round(pacePercent)}%`;
    container.appendChild(paceMarker);
  }
}

// ===== 予算編集モーダル =====
let editingCategory = null;

function openBudgetModal(name, budget, actual) {
  editingCategory = name;
  document.getElementById('budgetModalTitle').textContent = name;
  document.getElementById('budgetInput').value = budget;
  document.getElementById('budgetCurrentActual').textContent = `実績: ${formatYen(actual)}`;

  const isOverridden = state.budgetOverrides[name] !== undefined;
  document.getElementById('budgetReset').style.display = isOverridden ? '' : 'none';

  document.getElementById('budgetModal').classList.add('active');
  setTimeout(() => document.getElementById('budgetInput').focus(), 100);
}

function closeBudgetModal() {
  document.getElementById('budgetModal').classList.remove('active');
  editingCategory = null;
}

function saveBudgetEdit() {
  const input = document.getElementById('budgetInput');
  const val = parseInt(input.value);
  if (isNaN(val) || val < 0) return;

  const overrides = { ...state.budgetOverrides };
  overrides[editingCategory] = val;
  saveBudgetOverrides(overrides);

  closeBudgetModal();
  // データを再適用して再描画
  if (state.data) {
    const data = applyBudgetOverrides(state.data);
    render(data);
  }
}

function resetBudgetEdit() {
  const overrides = { ...state.budgetOverrides };
  delete overrides[editingCategory];
  saveBudgetOverrides(overrides);

  closeBudgetModal();
  loadData(); // 元データを再取得
}

// ===== 設定モーダル =====
function openSettings() {
  document.getElementById('targetInput').value = state.targetPercent;
  document.getElementById('targetValue').textContent = state.targetPercent + '%';
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

function initPinReset() {
  document.getElementById('pinResetBtn').addEventListener('click', () => {
    if (confirm('パスワードを再設定しますか？')) {
      localStorage.removeItem('authHash');
      localStorage.removeItem('authSession');
      location.reload();
    }
  });
}

// ===== ユーティリティ =====
function formatYen(amount) {
  if (amount === undefined || amount === null) return '--';
  return '\u00a5' + Math.abs(Math.round(amount)).toLocaleString('ja-JP');
}

function getStatusClass(percent, pacePercent, targetPercent) {
  if (percent >= 100) return 'danger';
  if (percent >= targetPercent) return 'danger';
  if (pacePercent > 0 && percent >= pacePercent * 1.1) return 'warning';
  return 'safe';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateMonthTitle() {
  document.getElementById('monthTitle').textContent =
    `${state.currentYear}年${state.currentMonth}月`;
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
  document.getElementById('categoriesList').style.display = show ? 'none' : '';
  document.getElementById('errorMessage').style.display = 'none';
}

function showError(message) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('errorMessage').style.display = 'block';
  document.getElementById('errorText').textContent = message || 'データの取得に失敗しました';
}

// ===== Service Worker 登録 =====
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

// ===== モックデータ =====
function generateMockData(year, month) {
  const budgetItems = [
    { name: 'スーパー', budget: 90000 },
    { name: '外注工賃', budget: 80000 },
    { name: '住宅', budget: 70000 },
    { name: '長期借入金', budget: 48000 },
    { name: '消耗品費', budget: 30000 },
    { name: '奨学金', budget: 22500 },
    { name: '電気', budget: 20000 },
    { name: '新聞図書費', budget: 20000 },
    { name: 'コンビニ', budget: 20000 },
    { name: '日用品費', budget: 20000 },
    { name: '車両費', budget: 20000 },
    { name: '接待交際費', budget: 20000 },
    { name: 'ごり国民年金', budget: 18000 },
    { name: '制服・ジャージ', budget: 16667 },
    { name: 'ガス', budget: 15000 },
    { name: '外食', budget: 10000 },
    { name: '被服費', budget: 10000 },
    { name: '美容費', budget: 10000 },
    { name: 'ガソリン費', budget: 10000 },
    { name: '旅費交通費', budget: 10000 },
    { name: '会議費', budget: 10000 },
    { name: '娯楽費', budget: 10000 },
    { name: 'おこづかい', budget: 10000 },
    { name: '修繕費', budget: 10000 },
    { name: '水道', budget: 8000 },
    { name: 'スマホ', budget: 8000 },
    { name: 'インターネット', budget: 6500 },
    { name: 'ごり国民健康保険', budget: 5000 },
    { name: '医療費', budget: 5000 },
    { name: '交際費', budget: 5000 },
    { name: '広告宣伝費', budget: 5000 },
    { name: '雑費', budget: 5000 },
    { name: '家具・家電', budget: 4167 },
    { name: '車購入・諸経費', budget: 4167 },
    { name: 'リース料', budget: 4167 },
    { name: 'ごり車検', budget: 4167 },
    { name: 'ごり自動車税', budget: 3833 },
    { name: '住民税', budget: 3333 },
    { name: 'ごり自動車保険', budget: 2917 },
    { name: 'ママ自動車保険', budget: 2500 },
    { name: 'ママ車検', budget: 2083 },
    { name: '租税公課', budget: 2083 },
    { name: 'その他年払い', budget: 1667 },
    { name: 'ふるさと納税', budget: 1500 },
    { name: '交通費', budget: 1000 },
    { name: '病気ケガ治療費', budget: 1000 },
    { name: '支払手数料', budget: 1000 },
    { name: 'ママ自動車税', budget: 667 },
    { name: '火災保険', budget: 417 },
  ];

  // 月の経過日数で進捗をシミュレーション
  const now = new Date();
  const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth() + 1);
  const dayProgress = isCurrentMonth
    ? now.getDate() / new Date(year, month, 0).getDate()
    : (month < now.getMonth() + 1 || year < now.getFullYear()) ? 1.0 : 0;

  // ランダム性を加えてリアルなデータを生成
  const seed = year * 100 + month;
  const random = (i) => {
    const x = Math.sin(seed + i * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };

  let totalBudget = 0;
  let totalActual = 0;

  const categories = budgetItems.map((item, i) => {
    const variance = 0.7 + random(i) * 0.6; // 70%~130%
    const actual = Math.round(item.budget * dayProgress * variance);
    totalBudget += item.budget;
    totalActual += actual;
    return {
      name: item.name,
      budget: item.budget,
      actual,
    };
  });

  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    year,
    monthNum: month,
    totalBudget,
    totalActual,
    categories,
    updatedAt: new Date().toISOString(),
  };
}
