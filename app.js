(function () {
  'use strict';

  var DAYS = window.DAYS || [];
  var EXAMS = window.EXAMS || [];
  var LETTERS = 'ABCDEFGH';
  var app = document.getElementById('app');

  // ---------- Storage (per-viewer conveniences only) ----------
  var store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set: function (key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    }
  };
  var settings = Object.assign({ mode: 'instant', shuffle: false }, store.get('ai20k.settings', {}));
  var best = store.get('ai20k.best', {});
  function saveSettings() { store.set('ai20k.settings', settings); }

  // ---------- Helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function md(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sameSet(a, b) {
    if (!a || a.length !== b.length) return false;
    for (var i = 0; i < b.length; i++) if (a.indexOf(b[i]) === -1) return false;
    return true;
  }
  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m));
    return (h ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0');
  }
  function letters(idxs) { return idxs.slice().sort().map(function (i) { return LETTERS[i]; }).join(', '); }

  // ---------- Data access ----------
  function typeOf(q) { return q.k ? 'essay' : (q.a.length > 1 ? 'multi' : 'single'); }

  function getQuiz(id) {
    var d = DAYS.find(function (x) { return x.id === id; });
    if (d) {
      return {
        id: d.id, kind: 'day', label: d.label, kicker: d.label + ' · Phase ' + d.phase,
        title: d.title, questions: d.qs
      };
    }
    var e = EXAMS.find(function (x) { return x.id === id; });
    if (e) {
      return {
        id: e.id, kind: 'exam', label: e.label, kicker: e.label + ' · ' + e.scope,
        title: e.title, questions: e.mcq.concat(e.essays)
      };
    }
    return null;
  }

  // ---------- Session ----------
  var S = null;
  var timerId = null;

  function newSession(quiz, subset) {
    var all = quiz.questions.map(function (_, i) { return i; });
    var order = subset ? subset.slice() : all;
    if (settings.shuffle && !subset) {
      var mcq = order.filter(function (i) { return typeOf(quiz.questions[i]) !== 'essay'; });
      var ess = order.filter(function (i) { return typeOf(quiz.questions[i]) === 'essay'; });
      order = shuffled(mcq).concat(shuffled(ess));
    }
    S = {
      quiz: quiz, order: order, pos: 0, mode: settings.mode,
      ans: {}, checked: {}, self: {}, submitted: false,
      view: 'question', start: Date.now(), end: null,
      retry: !!subset, navOpen: false
    };
  }

  function q(i) { return S.quiz.questions[i]; }
  function revealed(i) { return S.submitted || !!S.checked[i]; }
  function picked(i) { return S.ans[i] || []; }
  function isCorrect(i) { return sameSet(picked(i), q(i).a); }

  function isDone(i) {
    var t = typeOf(q(i));
    if (t === 'essay') return revealed(i) || !!(S.ans[i] && String(S.ans[i]).trim());
    if (S.mode === 'instant') return !!S.checked[i];
    return picked(i).length > 0;
  }

  function tally() {
    var r = { mcq: 0, right: 0, wrong: 0, blank: 0, essays: 0, essayScore: 0, essayGraded: 0, done: 0 };
    S.order.forEach(function (i) {
      var item = q(i);
      if (isDone(i)) r.done++;
      if (typeOf(item) === 'essay') {
        r.essays++;
        var ticks = S.self[i] || [];
        var n = ticks.filter(Boolean).length;
        if (revealed(i) && S.self[i]) { r.essayGraded++; r.essayScore += n / item.k.length; }
        return;
      }
      r.mcq++;
      if (!picked(i).length) r.blank++;
      else if (isCorrect(i)) r.right++;
      else r.wrong++;
    });
    return r;
  }

  // ---------- Router ----------
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var m = h.match(/^q\/([\w-]+)/);
    if (m) return { name: 'quiz', id: m[1] };
    return { name: 'home' };
  }

  function startQuiz(id, subset) {
    var quiz = getQuiz(id);
    if (!quiz) return;
    newSession(quiz, subset);
    var target = '#/q/' + id;
    if (location.hash !== target) location.hash = target;
    else render();
  }

  function render() {
    stopTimer();
    var r = route();
    if (r.name === 'quiz') {
      var quiz = getQuiz(r.id);
      if (!quiz) { location.hash = '#/'; return; }
      if (!S || S.quiz.id !== quiz.id) newSession(quiz);
      renderQuiz();
      return;
    }
    renderHome();
  }

  // ---------- Home ----------
  function bestHtml(id) {
    var b = best[id];
    if (b == null) return '<span class="best">Chưa làm</span>';
    return '<span class="best' + (b >= 80 ? ' good' : '') + '">Cao nhất ' + b + '%</span>';
  }
  function barHtml(id) {
    var b = best[id] || 0;
    return '<div class="bar' + (b >= 80 ? ' good' : '') + '"><span style="width:' + b + '%"></span></div>';
  }

  function renderHome() {
    var totalDayQ = DAYS.reduce(function (s, d) { return s + d.qs.length; }, 0);
    var phases = [1, 2].map(function (p) {
      var days = DAYS.filter(function (d) { return d.phase === p; });
      if (!days.length) return '';
      return '<h3 class="phase-title">' + (p === 1 ? 'Phase 1 — Foundation' : 'Phase 2 — AI Applications') + '</h3>' +
        '<div class="grid">' + days.map(function (d) {
          return '<button class="card-link" data-start="' + d.id + '">' +
            '<div class="card-top"><span class="day-badge">' + esc(d.label) + '</span>' + bestHtml(d.id) + '</div>' +
            '<h3>' + esc(d.title) + '</h3>' +
            '<div class="card-meta">' + d.qs.length + ' câu trắc nghiệm</div>' + barHtml(d.id) +
            '</button>';
        }).join('') + '</div>';
    }).join('');

    function examCard(e) {
      var meta = e.mcq.length
        ? (e.mcq.length + e.essays.length) + ' câu · ' + e.mcq.length + ' trắc nghiệm · ' + e.essays.length + ' tự luận'
        : e.essays.length + ' câu tự luận · có lời giải mẫu';
      return '<button class="card-link exam-card" data-start="' + e.id + '">' +
        '<div class="card-top"><span class="day-badge">' + esc(e.label) + '</span>' + bestHtml(e.id) + '</div>' +
        '<h3>' + esc(e.title) + '</h3><p>' + esc(e.desc) + '</p>' +
        '<div class="card-meta">' + meta + '</div>' + barHtml(e.id) + '</button>';
    }
    var fullExams = EXAMS.filter(function (e) { return e.kind !== 'practice'; });
    var practice = EXAMS.filter(function (e) { return e.kind === 'practice'; });
    var exams = fullExams.map(examCard).join('');
    var practiceHtml = practice.length
      ? '<section class="section"><div class="section-head"><h2>Luyện tự luận</h2><span>Tự chấm theo ý chính</span></div>' +
        '<div class="grid exams">' + practice.map(examCard).join('') + '</div></section>'
      : '';

    app.innerHTML =
      '<header class="site-header"><div class="wrap">' +
        '<a class="brand" href="#/"><span class="brand-mark">' + checkSvg() + '</span><span>Ôn thi AI20K<small>Phase 1 · Phase 2</small></span></a>' +
      '</div></header>' +
      '<main class="wrap">' +
        '<section class="hero"><h1>Ôn tập theo ngày, luyện đề tổng hợp</h1>' +
          '<p>Mỗi ngày học có 10 câu trắc nghiệm kèm giải thích. Đề tổng hợp gồm 60 câu: 50 trắc nghiệm (một hoặc nhiều đáp án đúng) và 10 câu tự luận có đáp án gợi ý để tự chấm.</p>' +
          '<div class="stats"><span class="stat"><b>' + DAYS.length + '</b> bài theo ngày</span><span class="stat"><b>' + totalDayQ + '</b> câu ôn theo ngày</span><span class="stat"><b>' + fullExams.length + '</b> đề tổng hợp</span>' +
            (practice.length ? '<span class="stat"><b>' + practice.reduce(function (s, e) { return s + e.essays.length; }, 0) + '</b> câu luyện tự luận</span>' : '') + '</div>' +
        '</section>' +
        '<section class="card settings">' +
          '<div><div class="setting-label">Cách hiện đáp án</div>' +
            '<div class="seg" role="radiogroup" aria-label="Cách hiện đáp án">' +
              segBtn('instant', 'Hiện ngay sau mỗi câu', 'Chọn xong là biết đúng/sai kèm giải thích') +
              segBtn('exam', 'Làm hết rồi mới chấm', 'Như thi thật — nộp bài mới xem đáp án và giải thích') +
            '</div></div>' +
          '<label class="toggle"><input type="checkbox" id="shuffle"' + (settings.shuffle ? ' checked' : '') + '><span class="track"></span>' +
            '<span>Trộn thứ tự câu hỏi<small>Mỗi lần làm, câu hỏi được xáo lại</small></span></label>' +
        '</section>' +
        '<section class="section"><div class="section-head"><h2>Đề thi tổng hợp</h2><span>60 câu / đề</span></div>' +
          '<div class="grid exams">' + exams + '</div></section>' + practiceHtml +
        '<section class="section"><div class="section-head"><h2>Ôn theo ngày</h2><span>10 câu / ngày</span></div>' + phases + '</section>' +
      '</main>' +
      '<footer class="site-footer">Nội dung tổng hợp từ slide AI20K · Phase 1 & Phase 2</footer>';

    app.querySelectorAll('[data-start]').forEach(function (b) {
      b.addEventListener('click', function () { startQuiz(b.getAttribute('data-start')); });
    });
    app.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        settings.mode = b.getAttribute('data-mode'); saveSettings();
        app.querySelectorAll('[data-mode]').forEach(function (x) {
          x.setAttribute('aria-checked', String(x === b));
        });
      });
    });
    var sh = document.getElementById('shuffle');
    sh.addEventListener('change', function () { settings.shuffle = sh.checked; saveSettings(); });
    window.scrollTo(0, 0);
  }

  function segBtn(mode, title, sub) {
    return '<button type="button" role="radio" data-mode="' + mode + '" aria-checked="' + (settings.mode === mode) + '">' +
      '<span class="radio"></span><span><b>' + title + '</b><small>' + sub + '</small></span></button>';
  }
  function checkSvg() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  }

  // ---------- Quiz ----------
  function renderQuiz() {
    var t = tally();
    var total = S.order.length;
    var pct = total ? Math.round(t.done / total * 100) : 0;

    app.innerHTML =
      '<header class="qbar"><div class="wrap qbar-in">' +
        '<a class="back" href="#/">← Trang chủ</a>' +
        '<div class="qtitle"><div class="kicker">' + esc(S.quiz.kicker) + (S.retry ? ' · Làm lại câu sai' : '') + '</div><div class="name">' + esc(S.quiz.title) + '</div></div>' +
        '<div class="qmeta"><span class="pill' + (S.mode === 'exam' ? ' exam' : '') + '">' + (S.mode === 'exam' ? 'Làm hết rồi chấm' : 'Hiện đáp án ngay') + '</span>' +
        '<span class="timer" id="timer"></span></div>' +
      '</div><div class="progress"><span style="width:' + pct + '%"></span></div></header>' +
      '<div class="wrap quiz-layout">' +
        '<main id="main">' + (S.view === 'result' ? resultHtml(t) : questionHtml()) + '</main>' +
        '<aside class="side' + (S.navOpen ? ' open' : '') + '" id="side">' + sideHtml(t) + '</aside>' +
      '</div>';

    bindQuiz();
    startTimer();
  }

  function questionHtml() {
    var i = S.order[S.pos];
    var item = q(i);
    var type = typeOf(item);
    var rev = revealed(i);
    var tagText = type === 'essay' ? 'Tự luận' : (type === 'multi' ? 'Chọn nhiều đáp án' : 'Một đáp án đúng');
    var html = '<article class="card qcard">' +
      '<div class="qhead"><span class="qnum">Câu ' + (S.pos + 1) + '<span> / ' + S.order.length + '</span></span>' +
      '<span class="tag' + (type === 'multi' ? ' multi' : type === 'essay' ? ' essay' : '') + '">' + tagText + '</span></div>' +
      '<h2 class="qtext">' + md(item.q) + '</h2>';

    if (type === 'essay') {
      html += '<textarea class="essay-box" id="essay" placeholder="Viết câu trả lời của bạn ở đây (không bắt buộc)…"' + (rev ? ' readonly' : '') + '>' + esc(S.ans[i] || '') + '</textarea>';
      if (rev) html += modelHtml(i);
      else if (S.mode === 'instant') html += '<div class="hint">Viết xong (hoặc nghĩ trong đầu) rồi bấm <b>Xem đáp án gợi ý</b> để đối chiếu.</div>';
      else html += '<div class="hint">Đáp án gợi ý và ý chính sẽ hiện sau khi nộp bài.</div>';
    } else {
      var sel = picked(i);
      html += '<div class="opts">' + item.o.map(function (opt, k) {
        var cls = 'opt' + (type === 'multi' ? ' multi' : '');
        var mark = '';
        var isSel = sel.indexOf(k) !== -1;
        var isAns = item.a.indexOf(k) !== -1;
        if (rev) {
          if (isAns) { cls += ' correct'; mark = '✓'; }
          else if (isSel) { cls += ' wrong'; mark = '✗'; }
          else cls += ' dim';
        } else if (isSel) cls += ' selected';
        return '<button class="' + cls + '" data-opt="' + k + '"' + (rev ? ' disabled' : '') +
          ' aria-pressed="' + isSel + '"><span class="key">' + LETTERS[k] + '</span><span class="otext">' + md(opt) + '</span>' +
          (mark ? '<span class="mark">' + mark + '</span>' : '') + '</button>';
      }).join('') + '</div>';

      if (rev) html += feedbackHtml(i);
      else if (type === 'multi' && S.mode === 'instant') html += '<div class="hint">Chọn tất cả đáp án đúng rồi bấm <b>Kiểm tra</b>.</div>';
    }

    // navigation row
    var last = S.pos === S.order.length - 1;
    var checkBtn = '';
    if (!rev && S.mode === 'instant') {
      if (type === 'multi') checkBtn = '<button class="btn primary" data-act="check"' + (picked(i).length ? '' : ' disabled') + '>Kiểm tra</button>';
      if (type === 'essay') checkBtn = '<button class="btn primary" data-act="check">Xem đáp án gợi ý</button>';
    }
    var nextBtn = last
      ? (S.submitted ? '<button class="btn primary" data-act="result">Xem kết quả</button>'
        : '<button class="btn primary" data-act="submit">' + (S.mode === 'exam' ? 'Nộp bài' : 'Kết thúc') + '</button>')
      : '<button class="btn' + (checkBtn ? '' : ' primary') + '" data-act="next">Câu sau →</button>';
    html += '<div class="qnav"><button class="btn ghost" data-act="prev"' + (S.pos === 0 ? ' disabled' : '') + '>← Câu trước</button>' +
      '<span class="spacer"></span>' + checkBtn + nextBtn + '</div>';
    if (type !== 'essay') {
      html += '<div class="shortcuts">Phím tắt: <kbd>A</kbd>–<kbd>' + LETTERS[item.o.length - 1] + '</kbd> hoặc <kbd>1</kbd>–<kbd>' + item.o.length + '</kbd> chọn · <kbd>Enter</kbd> ' +
        (S.mode === 'instant' && type === 'multi' ? 'kiểm tra / ' : '') + 'câu sau · <kbd>←</kbd> <kbd>→</kbd> chuyển câu</div>';
    }
    return html + '</article>';
  }

  function feedbackHtml(i) {
    var item = q(i);
    var sel = picked(i);
    var cls, title;
    if (!sel.length) { cls = 'skip'; title = 'Bạn chưa chọn — đáp án đúng: ' + letters(item.a); }
    else if (isCorrect(i)) { cls = 'ok'; title = 'Chính xác!'; }
    else { cls = 'bad'; title = 'Chưa đúng — đáp án đúng: ' + letters(item.a); }
    return '<div class="feedback ' + cls + '"><div class="fb-title">' + title + '</div><p>' + md(item.e || '') + '</p></div>';
  }

  function modelHtml(i) {
    var item = q(i);
    var ticks = S.self[i] || [];
    var n = ticks.filter(Boolean).length;
    var paras = [], list = [], code = null;
    function flush() { if (list.length) { paras.push('<ul>' + list.join('') + '</ul>'); list = []; } }
    item.m.forEach(function (line) {
      if (/^```/.test(line)) {
        if (code) { paras.push('<pre class="code">' + code.join('\n') + '</pre>'); code = null; }
        else { flush(); code = []; }
      } else if (code) code.push(esc(line));
      else if (/^- /.test(line)) list.push('<li>' + md(line.slice(2)) + '</li>');
      else if (line) { flush(); paras.push('<p>' + md(line) + '</p>'); }
    });
    if (code) paras.push('<pre class="code">' + code.join('\n') + '</pre>');
    flush();
    return '<div class="model">' +
      '<div><h4>Đáp án gợi ý</h4><div class="model-answer">' + paras.join('') + '</div></div>' +
      '<div><h4>Tự chấm — tick các ý bài của bạn đã có</h4><div class="kp">' +
        item.k.map(function (kp, k) {
          return '<label><input type="checkbox" data-kp="' + k + '"' + (ticks[k] ? ' checked' : '') + '><span>' + md(kp) + '</span></label>';
        }).join('') +
      '</div></div>' +
      '<div class="kp-score" id="kpscore">Bạn đạt <b>' + n + '/' + item.k.length + '</b> ý chính.</div></div>';
  }

  function chipClass(i, posIdx) {
    var item = q(i);
    var cls = 'chip';
    if (typeOf(item) === 'essay') {
      if (revealed(i)) cls += ' essay-done';
      else if (isDone(i)) cls += ' answered';
    } else if (revealed(i)) {
      cls += isCorrect(i) ? ' correct' : ' wrong';
    } else if (picked(i).length) cls += ' answered';
    if (posIdx === S.pos && S.view === 'question') cls += ' current';
    return cls;
  }

  function sideHtml(t) {
    var mcqChips = [], essChips = [];
    S.order.forEach(function (i, p) {
      var chip = '<button class="' + chipClass(i, p) + '" data-go="' + p + '" aria-label="Câu ' + (p + 1) + '">' + (p + 1) + '</button>';
      if (typeOf(q(i)) === 'essay') essChips.push(chip); else mcqChips.push(chip);
    });
    var actions;
    if (S.submitted) {
      actions = '<button class="btn primary block" data-act="result">Xem kết quả</button>';
    } else {
      actions = '<button class="btn primary block" data-act="submit">' + (S.mode === 'exam' ? 'Nộp bài' : 'Kết thúc & xem kết quả') + '</button>';
    }
    var legend = S.submitted || S.mode === 'instant'
      ? '<span><i class="lg-ok"></i>Đúng</span><span><i class="lg-bad"></i>Sai</span><span><i class="lg-none"></i>Chưa làm</span>'
      : '<span><i class="lg-ans"></i>Đã chọn</span><span><i class="lg-none"></i>Chưa làm</span>';
    return '<div class="card nav-card">' +
      '<div class="nav-head" data-act="togglenav"><b>Danh sách câu</b><span>' + t.done + '/' + S.order.length + ' đã làm <span class="nav-toggle">▾</span></span></div>' +
      '<div class="nav-body">' +
        (mcqChips.length ? (essChips.length ? '<div class="sec-label">Trắc nghiệm</div>' : '') +
          '<div class="chips">' + mcqChips.join('') + '</div>' : '') +
        (essChips.length ? (mcqChips.length ? '<div class="sec-label">Tự luận</div>' : '') +
          '<div class="chips">' + essChips.join('') + '</div>' : '') +
        '<div class="legend">' + legend + '</div>' +
        '<div class="side-actions">' + actions + '</div>' +
      '</div></div>';
  }

  function resultHtml(t) {
    if (!t.mcq) return essayResultHtml(t);
    var pct = t.mcq ? Math.round(t.right / t.mcq * 100) : 0;
    var verdict = pct >= 90 ? 'Xuất sắc — bạn nắm rất chắc phần này.'
      : pct >= 75 ? 'Tốt — xem lại vài câu sai là ổn.'
      : pct >= 50 ? 'Khá — nên đọc lại tóm tắt và làm lại các câu sai.'
      : 'Cần ôn thêm — đọc lại tóm tắt bài rồi làm lại nhé.';
    var ring = pct >= 75 ? 'var(--ok)' : pct >= 50 ? 'var(--primary)' : 'var(--bad)';
    var elapsed = (S.end || Date.now()) - S.start;
    var stats = '<div class="rstat ok"><span>Đúng</span><b>' + t.right + '</b></div>' +
      '<div class="rstat bad"><span>Sai</span><b>' + t.wrong + '</b></div>' +
      '<div class="rstat"><span>Bỏ trống</span><b>' + t.blank + '</b></div>' +
      '<div class="rstat"><span>Thời gian</span><b>' + fmtTime(elapsed) + '</b></div>';
    var essayNote = '';
    if (t.essays) {
      stats += '<div class="rstat"><span>Tự luận (tự chấm)</span><b>' + (Math.round(t.essayScore * 10) / 10) + '/' + t.essays + '</b></div>';
      essayNote = '<div class="essay-note">Phần tự luận: mở từng câu tự luận để đọc đáp án gợi ý và tick các ý chính bài của bạn đã có — điểm tự chấm cập nhật ngay (đã chấm ' + t.essayGraded + '/' + t.essays + ' câu).</div>';
    }
    var wrongCount = S.order.filter(function (i) { return typeOf(q(i)) !== 'essay' && !isCorrect(i); }).length;
    return '<article class="card result">' +
      '<div class="ring" style="--p:' + pct + ';--ring:' + ring + '"><div><b>' + pct + '%</b><small>' + t.right + '/' + t.mcq + ' trắc nghiệm</small></div></div>' +
      '<h2>Kết quả</h2><p class="verdict">' + verdict + '</p>' +
      '<div class="rstats">' + stats + '</div>' + essayNote +
      '<div class="ractions">' +
        '<button class="btn primary" data-act="review">Xem lại bài & giải thích</button>' +
        (wrongCount ? '<button class="btn" data-act="retrywrong">Làm lại ' + wrongCount + ' câu sai</button>' : '') +
        '<button class="btn" data-act="restart">Làm lại từ đầu</button>' +
        '<a class="btn ghost" href="#/">Trang chủ</a>' +
      '</div></article>';
  }

  function essayResultHtml(t) {
    var pct = t.essays ? Math.round(t.essayScore / t.essays * 100) : 0;
    var done = t.essayGraded === t.essays;
    var verdict = !t.essayGraded
      ? 'Mở từng câu, đọc lời giải mẫu và tick các ý chính bài của bạn đã có để tự chấm.'
      : !done ? 'Bạn đã tự chấm ' + t.essayGraded + '/' + t.essays + ' câu — chấm nốt các câu còn lại để có điểm đầy đủ.'
      : pct >= 75 ? 'Tốt — bài làm đã bao quát phần lớn ý chính.'
      : 'Đối chiếu lại lời giải mẫu ở những ý còn thiếu rồi viết lại nhé.';
    var ring = pct >= 75 ? 'var(--ok)' : pct >= 50 ? 'var(--primary)' : 'var(--bad)';
    return '<article class="card result">' +
      '<div class="ring" style="--p:' + pct + ';--ring:' + ring + '"><div><b>' + pct + '%</b><small>' + (Math.round(t.essayScore * 10) / 10) + '/' + t.essays + ' điểm tự chấm</small></div></div>' +
      '<h2>Kết quả tự luận</h2><p class="verdict">' + verdict + '</p>' +
      '<div class="rstats">' +
        '<div class="rstat"><span>Đã tự chấm</span><b>' + t.essayGraded + '/' + t.essays + '</b></div>' +
        '<div class="rstat ok"><span>Điểm tự chấm</span><b>' + (Math.round(t.essayScore * 10) / 10) + '/' + t.essays + '</b></div>' +
        '<div class="rstat"><span>Thời gian</span><b>' + fmtTime((S.end || Date.now()) - S.start) + '</b></div>' +
      '</div>' +
      '<div class="ractions">' +
        '<button class="btn primary" data-act="review">Xem lời giải & tự chấm</button>' +
        '<button class="btn" data-act="restart">Làm lại từ đầu</button>' +
        '<a class="btn ghost" href="#/">Trang chủ</a>' +
      '</div></article>';
  }

  function recordEssayBest() {
    var t = tally();
    if (t.mcq || !t.essays || t.essayGraded < t.essays) return;
    var pct = Math.round(t.essayScore / t.essays * 100);
    if (best[S.quiz.id] == null || pct > best[S.quiz.id]) { best[S.quiz.id] = pct; store.set('ai20k.best', best); }
  }

  // ---------- Actions ----------
  function go(pos) {
    if (pos < 0 || pos >= S.order.length) return;
    S.pos = pos; S.view = 'question';
    renderQuiz();
    scrollToTop();
  }
  function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function choose(k) {
    var i = S.order[S.pos];
    var item = q(i);
    var type = typeOf(item);
    if (type === 'essay' || revealed(i) || k >= item.o.length) return;
    if (type === 'single') {
      S.ans[i] = [k];
      if (S.mode === 'instant') S.checked[i] = true;
    } else {
      var cur = picked(i).slice();
      var at = cur.indexOf(k);
      if (at === -1) cur.push(k); else cur.splice(at, 1);
      S.ans[i] = cur;
    }
    renderQuiz();
  }

  function check() {
    var i = S.order[S.pos];
    var type = typeOf(q(i));
    if (revealed(i) || S.mode !== 'instant') return;
    if (type === 'multi' && !picked(i).length) return;
    S.checked[i] = true;
    renderQuiz();
  }

  function submit(force) {
    var t = tally();
    var left = S.order.length - t.done;
    if (!force && left > 0) {
      confirmModal(
        S.mode === 'exam' ? 'Nộp bài?' : 'Kết thúc lượt làm?',
        'Bạn còn ' + left + ' câu chưa làm. Các câu trắc nghiệm bỏ trống sẽ tính là sai.',
        S.mode === 'exam' ? 'Nộp bài' : 'Kết thúc',
        function () { submit(true); }
      );
      return;
    }
    S.submitted = true;
    S.end = Date.now();
    S.view = 'result';
    var after = tally();
    if (!S.retry && after.mcq) {
      var pct = Math.round(after.right / after.mcq * 100);
      if (best[S.quiz.id] == null || pct > best[S.quiz.id]) { best[S.quiz.id] = pct; store.set('ai20k.best', best); }
    }
    if (!S.retry) recordEssayBest();
    renderQuiz();
    scrollToTop();
  }

  function confirmModal(title, text, okText, onOk) {
    var wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle">' +
      '<h3 id="mtitle">' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
      '<div class="row"><button class="btn" data-m="cancel">Làm tiếp</button><button class="btn primary" data-m="ok">' + esc(okText) + '</button></div></div>';
    document.body.appendChild(wrap);
    var okBtn = wrap.querySelector('[data-m="ok"]');
    okBtn.focus();
    function close() { document.removeEventListener('keydown', onKey, true); wrap.remove(); }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', function (e) {
      var m = e.target.getAttribute && e.target.getAttribute('data-m');
      if (e.target === wrap || m === 'cancel') close();
      else if (m === 'ok') { close(); onOk(); }
    });
  }

  function bindQuiz() {
    app.querySelectorAll('[data-opt]').forEach(function (b) {
      b.addEventListener('click', function () { choose(+b.getAttribute('data-opt')); });
    });
    app.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (window.innerWidth <= 900) S.navOpen = false;
        go(+b.getAttribute('data-go'));
      });
    });
    app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'prev') go(S.pos - 1);
        else if (act === 'next') go(S.pos + 1);
        else if (act === 'check') check();
        else if (act === 'submit') submit(false);
        else if (act === 'result') { S.view = 'result'; recordEssayBest(); renderQuiz(); scrollToTop(); }
        else if (act === 'review') go(0);
        else if (act === 'restart') startQuiz(S.quiz.id);
        else if (act === 'retrywrong') {
          var wrong = S.order.filter(function (i) { return typeOf(q(i)) !== 'essay' && !isCorrect(i); });
          var id = S.quiz.id;
          newSession(getQuiz(id), wrong);
          renderQuiz();
          scrollToTop();
        } else if (act === 'togglenav') {
          if (window.innerWidth > 900) return;
          S.navOpen = !S.navOpen;
          document.getElementById('side').classList.toggle('open', S.navOpen);
        }
      });
    });
    var essay = document.getElementById('essay');
    if (essay) {
      essay.addEventListener('input', function () {
        var i = S.order[S.pos];
        S.ans[i] = essay.value;
        var chip = app.querySelector('[data-go="' + S.pos + '"]');
        if (chip) chip.className = chipClass(i, S.pos);
      });
    }
    app.querySelectorAll('[data-kp]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var i = S.order[S.pos];
        var arr = (S.self[i] || []).slice();
        arr[+cb.getAttribute('data-kp')] = cb.checked;
        S.self[i] = arr;
        var n = arr.filter(Boolean).length;
        var el = document.getElementById('kpscore');
        if (el) el.innerHTML = 'Bạn đạt <b>' + n + '/' + q(i).k.length + '</b> ý chính.';
      });
    });
  }

  // ---------- Timer ----------
  function startTimer() {
    var el = document.getElementById('timer');
    if (!el) return;
    function tick() { el.textContent = fmtTime((S.end || Date.now()) - S.start); }
    tick();
    if (!S.end) timerId = setInterval(tick, 1000);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  // ---------- Keyboard ----------
  document.addEventListener('keydown', function (e) {
    if (route().name !== 'quiz' || !S || S.view !== 'question') return;
    if (document.querySelector('.overlay')) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var key = e.key;
    var i = S.order[S.pos];
    var item = q(i);
    if (key === 'ArrowRight') { e.preventDefault(); go(S.pos + 1); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); go(S.pos - 1); return; }
    if (key === 'Enter') {
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if (S.mode === 'instant' && !revealed(i) && typeOf(item) === 'multi' && picked(i).length) check();
      else if (S.pos < S.order.length - 1) go(S.pos + 1);
      return;
    }
    if (typeOf(item) === 'essay') return;
    var k = -1;
    if (/^[1-9]$/.test(key)) k = +key - 1;
    else if (/^[a-h]$/i.test(key)) k = LETTERS.indexOf(key.toUpperCase());
    if (k >= 0 && k < item.o.length) { e.preventDefault(); choose(k); }
  });

  window.addEventListener('hashchange', render);
  render();
})();
