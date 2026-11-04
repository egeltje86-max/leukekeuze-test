/* Spooksite – feedmotor. Gebruikt de feeds van de Feedzoeker (map "Feedzoeker LeukeKeuze" op het bureaublad):
   alle feeds, alle producten. Zoeken gaat terwijl je typt. Ververs de feeds met "Feedzoeker verversen.cmd". */
(function () {
  'use strict';
  var MAP = '../Feedzoeker LeukeKeuze/data/';
  var DAISYCON_PAUZE = true; /* zelfde als in de Feedzoeker: Daisycon-links tijdelijk rechtstreeks naar de winkel */
  var DC = /^https?:\/\/(lt45|fr135|bdt9|glp8|ds1|jdt8|rkn3|jf79)\.n[le]t?\/c\/|^https?:\/\/aff\.svinando\.be\/c\//;
  var ROOT = { '999 Games': 'https://www.999games.nl/', 'Bartogi': 'https://bartogi.nl/', 'Bloompost': 'https://www.bloompost.nl/', 'Decantalo': 'https://www.decantalo.com/',
    'Dille & Kamille': 'https://www.dille-kamille.nl/', 'Dropwinkel': 'https://www.dropwinkel.eu/', 'Fietsparadijs': 'https://www.fietsparadijs.com/', 'Fietstas.com': 'https://www.fietstas.com/',
    'Invicta': 'https://www.invictastores.eu/', 'Kerstland': 'https://www.kerstland.nl/', 'Myka': 'https://www.myka.com/', 'Prydligt': 'https://www.prydligt.eu/',
    'Svinando': 'https://www.svinando.nl/', 'Wijnkring': 'https://www.wijnkring.nl/', 'WoodWick': 'https://woodwick.nl/', 'La Redoute': 'https://www.laredoute.nl/' };
  function ttTc(link) {
    try { var u = new URL(link), tt = (u.searchParams.get('tt') || '').split('_'), r = u.searchParams.get('r') || '';
      if (tt.length >= 3 && r.indexOf('http') === 0) return 'https://tc.tradetracker.net/?c=' + tt[0] + '&m=' + tt[1] + '&a=' + tt[2] + '&r=&u=' + encodeURIComponent(r);
    } catch (e) {}
    return link;
  }
  function winkelLink(link, winkel) {
    if (/lookinggoodtoday\.com|247jeans\.com/.test(link) && /[?&]tt=/.test(link)) return ttTc(link);
    if (!DAISYCON_PAUZE || !DC.test(link)) return link;
    try {
      var dl = new URL(link).searchParams.get('dl') || '';
      var m = dl.match(/murl=([^&]+)/);
      if (m) { var u = decodeURIComponent(m[1]); return u.indexOf('http') === 0 ? u : link; }
      if (dl.indexOf('http') === 0) return dl;
      var r = Object.keys(ROOT).filter(function (k) { return winkel && winkel.indexOf(k) === 0; })[0];
      if (r) return ROOT[r] + dl.replace(/\.aspx(?=[a-z])/, '.aspx?').replace(/^\//, '');
    } catch (e) {}
    return link;
  }
  function norm(t) { return ' ' + String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9€]+/g, ' ') + ' '; }

  var F = window.SPOOK_FEEDMOTOR = { alles: [], meta: {}, geladen: 0, totaal: 0, klaar: false, fout: '', bijWijziging: null, datum: '' };
  var VLAG = { u: 'uitverkocht', d: 'dubbel', f: 'geen foto' };
  window.FZ = { laad: function (d) {
    var m = F.meta[d.id] || d;
    d.rijen.forEach(function (r) {
      var p = { titel: r[0], prijs: r[1], oud: r[2], link: winkelLink(d.link + r[3], m.winkel), foto: r[4] ? d.foto + r[4] : '', cat: r[5] || '', merk: r[6] || '', vlag: r[7] || '', winkel: m.winkel, netwerk: m.netwerk, feed: d.id };
      p.hooi = norm(p.titel + ' ' + p.merk + ' ' + p.cat + ' ' + p.winkel); p.tn = norm(p.titel);
      F.alles.push(p);
    });
  } };
  function laadScript(src, klaar) { var s = document.createElement('script'); s.src = src; s.onload = function () { klaar(true); }; s.onerror = function () { klaar(false); }; document.head.appendChild(s); }
  F.start = function () {
    if (F.gestart) return; F.gestart = true;
    laadScript(MAP + 'feeds.js', function (ok) {
      if (!ok || !window.FZ_FEEDS) { F.fout = 'De Feedzoeker is niet gevonden. Hij moet op het bureaublad staan, in de map "Feedzoeker LeukeKeuze".'; F.bijWijziging && F.bijWijziging(); return; }
      F.datum = window.FZ_DATUM || '';
      var lijst = window.FZ_FEEDS.filter(function (m) { return !/hummeltje/i.test(m.winkel); });
      lijst.forEach(function (m) { F.meta[m.id] = m; });
      F.totaal = lijst.length;
      var i = 0;
      (function volgende() {
        if (i >= lijst.length) { F.klaar = true; F.bijWijziging && F.bijWijziging(); return; }
        laadScript(MAP + lijst[i++].id + '.js', function () { F.geladen++; if (F.geladen % 5 === 0 || F.geladen === F.totaal) F.bijWijziging && F.bijWijziging(); setTimeout(volgende, 0); });
      })();
    });
  };
  F.winkels = function () { var s = {}; Object.keys(F.meta).forEach(function (k) { s[F.meta[k].winkel] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'nl'); }); };
  /* zoek: alle woorden moeten erin staan; -woord sluit uit. Beste match eerst (woorden in de titel tellen zwaarder). */
  F.zoek = function (q, opt) {
    opt = opt || {};
    var wel = [], niet = [];
    String(q || '').toLowerCase().split(/\s+/).forEach(function (w) { if (!w) return; var uit = w[0] === '-'; var n = norm(uit ? w.slice(1) : w).trim(); if (!n) return; n.split(' ').forEach(function (d) { (uit ? niet : wel).push(d); }); });
    if (!wel.length && !opt.winkel) return [];
    var res = [];
    for (var i = 0; i < F.alles.length; i++) {
      var p = F.alles[i];
      if (opt.winkel && p.winkel !== opt.winkel) continue;
      if (!opt.ookWeg && p.vlag) continue;
      if (opt.min && p.prijs < opt.min) continue;
      if (opt.max && p.prijs > opt.max) continue;
      var ok = true, score = 0;
      for (var j = 0; j < wel.length; j++) {
        var w = wel[j].length >= 4 ? wel[j] : ' ' + wel[j];
        if (p.hooi.indexOf(w) < 0) { ok = false; break; }
        if (p.tn.indexOf(' ' + wel[j] + ' ') >= 0) score += 3; else if (p.tn.indexOf(w) >= 0) score += 2; else score += 1;
      }
      if (!ok) continue;
      for (var k = 0; k < niet.length; k++) if (p.hooi.indexOf(niet[k]) >= 0) { ok = false; break; }
      if (ok) res.push([score, i]);
    }
    if (opt.sorteer === 'laag') res.sort(function (a, b) { return F.alles[a[1]].prijs - F.alles[b[1]].prijs; });
    else if (opt.sorteer === 'hoog') res.sort(function (a, b) { return F.alles[b[1]].prijs - F.alles[a[1]].prijs; });
    else res.sort(function (a, b) { return b[0] - a[0]; });
    return res.map(function (x) { return x[1]; });
  };
  F.vlagTekst = function (v) { return VLAG[v] || (v ? 'weggefilterd' : ''); };
})();
