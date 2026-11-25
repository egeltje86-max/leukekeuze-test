/* Vondst – testversie. Alles blijft op de telefoon; AI via eigen OpenAI-sleutel. */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const instel = {
  get key(){ return localStorage.getItem('v_key') || ''; },
  set key(v){ v ? localStorage.setItem('v_key', v) : localStorage.removeItem('v_key'); },
  get model(){ return localStorage.getItem('v_model') || ''; },
  set model(v){ localStorage.setItem('v_model', v || ''); },
  get heelScherm(){ return localStorage.getItem('v_heel') === '1'; },
  set heelScherm(v){ localStorage.setItem('v_heel', v ? '1' : '0'); },
  get aiTeller(){ return +(localStorage.getItem('v_aiteller') || 0); },
  set aiTeller(v){ localStorage.setItem('v_aiteller', String(v)); },
};

/* ================= DATABASE (IndexedDB) ================= */
const DB = {
  db: null,
  open(){
    return new Promise((ok, fout) => {
      const r = indexedDB.open('vondst', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('finds')) d.createObjectStore('finds', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      };
      r.onsuccess = () => { DB.db = r.result; ok(); };
      r.onerror = () => fout(r.error);
    });
  },
  tx(store, mode, fn){
    return new Promise((ok, fout) => {
      const t = DB.db.transaction(store, mode);
      const s = t.objectStore(store);
      let res;
      const req = fn(s);
      if (req) req.onsuccess = () => { res = req.result; };
      t.oncomplete = () => ok(res);
      t.onerror = () => fout(t.error);
    });
  },
  put(store, obj){ return DB.tx(store, 'readwrite', s => s.put(obj)); },
  get(store, id){ return DB.tx(store, 'readonly', s => s.get(id)); },
  all(store){ return DB.tx(store, 'readonly', s => s.getAll()); },
  del(store, id){ return DB.tx(store, 'readwrite', s => s.delete(id)); },
  clear(store){ return DB.tx(store, 'readwrite', s => s.clear()); },
};

/* ================= HULPJES ================= */
const nieuwId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const wacht = ms => new Promise(r => setTimeout(r, ms));
function melding(tekst, ms = 2600){
  const m = $('#melding'); m.textContent = tekst; m.style.display = 'block';
  clearTimeout(melding.t); melding.t = setTimeout(() => m.style.display = 'none', ms);
}
function datumTekst(t){
  return new Date(t).toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function afstand(a, b){ // meters tussen [lat,lon]
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const urlCache = new Map();
const SPELD_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#241e17"/><path d="M50 18c-13 0-23 10-23 23 0 17 23 41 23 41s23-24 23-41c0-13-10-23-23-23z" fill="#ff4a3d" stroke="#fff" stroke-width="3"/><circle cx="50" cy="41" r="8" fill="#fff"/></svg>');
function fotoSrc(f){ const p = f.fotos && f.fotos[f.fotos.length - 1]; return p ? fotoUrl(p.blob, f.id + p.t) : SPELD_IMG; }
function fotoUrl(blob, sleutel){
  if (sleutel && urlCache.has(sleutel)) return urlCache.get(sleutel);
  const u = URL.createObjectURL(blob);
  if (sleutel) urlCache.set(sleutel, u);
  return u;
}
let audioCtx;
function piep(freq = 880, duur = 0.12){
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duur);
    o.start(); o.stop(audioCtx.currentTime + duur);
  } catch (e) {}
}
function tril(p){ try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

function verkleinFoto(blob, max = 1600, kwaliteit = 0.85){
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => ok(b || blob), 'image/jpeg', kwaliteit);
    };
    img.onerror = () => ok(blob);
    img.src = URL.createObjectURL(blob);
  });
}
function blobNaarDataUrl(blob){
  return new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
}
async function dataUrlNaarBlob(u){ return (await fetch(u)).blob(); }

/* ================= GPS ================= */
const GPS = { laatste: null, recent: [], wachters: [] };
// Draait de app als echte Android-app (Capacitor)?
const CAP = window.capacitorExports;
const NATIEF = !!(CAP && CAP.Capacitor && CAP.Capacitor.isNativePlatform && CAP.Capacitor.isNativePlatform());
const plugin = naam => NATIEF ? CAP.registerPlugin(naam) : null;

function verwerkFix(fix){
  GPS.laatste = fix;
  GPS.recent.push(fix);
  const grens = Date.now() - 30000;
  GPS.recent = GPS.recent.filter(f => f.t >= grens);
  toonGps();
  Route.punt(fix);
  Kaart.mijnPlek(fix);
  Lagen.check(fix);
  GPS.wachters.splice(0).forEach(w => w(fix));
}
const NatiefGps = {
  id: null, achtergrond: null,
  // Met achtergrond = true blijft de GPS doorlopen met het scherm uit (melding 'Route bijhouden').
  async start(achtergrond){
    const BG = plugin('BackgroundGeolocation');
    if (NatiefGps.id && NatiefGps.achtergrond === achtergrond) return;
    if (NatiefGps.id) { try { await BG.removeWatcher({ id: NatiefGps.id }); } catch (e) {} NatiefGps.id = null; }
    const opties = { requestPermissions: true, stale: false, distanceFilter: 0 };
    if (achtergrond) { opties.backgroundTitle = 'Vondst houdt je route bij'; opties.backgroundMessage = 'Tik om de app te openen'; }
    NatiefGps.achtergrond = achtergrond;
    NatiefGps.id = await BG.addWatcher(opties, (loc, err) => {
      if (err) {
        $('#gpsTekst').textContent = err.code === 'NOT_AUTHORIZED' ? 'geen toestemming' : 'geen signaal';
        $('#gpsChip').className = 'chip slecht';
        if (err.code === 'NOT_AUTHORIZED' && confirm('Vondst heeft je locatie nodig. Instellingen openen?')) BG.openSettings();
        return;
      }
      if (!loc) return;
      verwerkFix({ lat: loc.latitude, lon: loc.longitude, acc: loc.accuracy, alt: loc.altitude, t: Date.now() });
    });
  },
};
function startGps(){
  setInterval(toonGps, 3000);
  if (NATIEF) { NatiefGps.start(!!(Route && Route.sessie)); return; }
  if (!('geolocation' in navigator)) { $('#gpsTekst').textContent = 'niet beschikbaar'; return; }
  navigator.geolocation.watchPosition(p => {
    verwerkFix({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, t: Date.now() });
  }, err => {
    $('#gpsTekst').textContent = err.code === 1 ? 'geen toestemming' : 'geen signaal';
    $('#gpsChip').className = 'chip slecht';
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function toonGps(){
  const f = GPS.laatste, chip = $('#gpsChip');
  if (!f || Date.now() - f.t > 15000) { chip.className = 'chip slecht'; $('#gpsTekst').textContent = f ? 'signaal kwijt' : 'zoeken…'; return; }
  const a = Math.round(f.acc);
  chip.className = 'chip ' + (a <= 5 ? 'goed' : a <= 15 ? 'matig' : 'slecht');
  $('#gpsTekst').textContent = '± ' + a + ' m';
}
// Beste positie: alle metingen van de laatste paar seconden, gewogen naar nauwkeurigheid.
function bestePositie(vanaf){
  const bruikbaar = GPS.recent.filter(f => f.t >= vanaf && f.acc <= 50);
  if (!bruikbaar.length) return GPS.laatste ? { ...GPS.laatste, n: 1 } : null;
  let sw = 0, la = 0, lo = 0, minAcc = Infinity;
  for (const f of bruikbaar) { const w = 1 / (f.acc * f.acc); sw += w; la += f.lat * w; lo += f.lon * w; minAcc = Math.min(minAcc, f.acc); }
  return { lat: la / sw, lon: lo / sw, acc: minAcc, n: bruikbaar.length, t: Date.now() };
}
async function verfijnPlek(id, start){
  // 6 seconden extra metingen verzamelen en het gemiddelde opslaan
  await wacht(6000);
  const pos = bestePositie(start - 3000);
  if (!pos) return;
  const f = await DB.get('finds', id); if (!f) return;
  f.lat = pos.lat; f.lon = pos.lon; f.acc = Math.round(pos.acc * 10) / 10; f.gpsMetingen = pos.n;
  await DB.put('finds', f);
  Kaart.verversVondsten();
  Plek.vulVondst(id);
}

/* ================= ROUTE ================= */
// Is er tussen twee routepunten niets gemeten? (scherm uit, app weg, of een grote sprong in de tijd)
function isGat(a, b){
  if (b[4] === 1) return afstand(a, b) > 8;
  return (b[3] - a[3]) > 25000 && afstand(a, b) > 20;
}
function segmenten(punten){
  const delen = [[]], gaten = [];
  punten.forEach((p, i) => {
    if (i && isGat(punten[i - 1], p)) { gaten.push([punten[i - 1], p]); delen.push([]); }
    delen[delen.length - 1].push(p);
  });
  return { delen, gaten };
}
var Route = window.Route = {
  sessie: null, wakeLock: null,
  async aan(){
    Route.sessie = { id: nieuwId(), start: Date.now(), eind: null, punten: [] };
    await DB.put('tracks', Route.sessie);
    localStorage.setItem('v_route', Route.sessie.id);
    Route.toon(); Kaart.verversRoutes();
    if (NATIEF) NatiefGps.start(true);
    melding(NATIEF ? 'Route staat aan, ook met het scherm uit' : 'Route staat aan');
    houdSchermAan();
  },
  async uit(){
    if (!Route.sessie) return;
    Route.sessie.eind = Date.now();
    await DB.put('tracks', Route.sessie);
    Route.sessie = null; localStorage.removeItem('v_route');
    Route.toon(); Kaart.verversRoutes();
    if (NATIEF) NatiefGps.start(false);
    melding('Route gestopt en bewaard');
  },
  ruw: [], naPauze: false,
  punt(fix){
    const s = Route.sessie; if (!s) return;
    if (fix.acc > 60) return; // alleen echt onbruikbare metingen weggooien
    // Uitmiddelen: metingen van de laatste 8 seconden, gewogen naar nauwkeurigheid (goed onder bomen)
    Route.ruw.push(fix);
    Route.ruw = Route.ruw.filter(f => fix.t - f.t <= 8000);
    let sw = 0, la = 0, lo = 0, minAcc = Infinity;
    for (const f of Route.ruw) { const w = 1 / (f.acc * f.acc); sw += w; la += f.lat * w; lo += f.lon * w; minAcc = Math.min(minAcc, f.acc); }
    const p = [la / sw, lo / sw, Math.round(minAcc), fix.t];
    if (Route.naPauze) { p[4] = 1; Route.naPauze = false; } // markeer: hiervoor ontbreekt een stuk
    const vorige = s.punten[s.punten.length - 1];
    const minStap = minAcc <= 15 ? Math.max(1.2, minAcc * 0.25) : minAcc * 0.35;
    if (vorige && !p[4] && afstand(vorige, p) < minStap) return;
    s.punten.push(p);
    if (!s.plek && !s.plekBezig && minAcc <= 25) { s.plekBezig = true; Plek.vulRoute(s).finally(() => { s.plekBezig = false; }); }
    if (vorige && isGat(vorige, p)) Kaart.verversRoutes(); else Kaart.routePunt(p);
    DB.put('tracks', s);
    Route.toon();
  },
  pauze(){ if (Route.sessie) { Route.naPauze = true; Route.ruw = []; DB.put('tracks', Route.sessie); } },
  lengte(s){ let m = 0; for (let i = 1; i < s.punten.length; i++) if (!isGat(s.punten[i - 1], s.punten[i])) m += afstand(s.punten[i - 1], s.punten[i]); return m; },
  toon(){
    const k = $('#routeKnop'), s = Route.sessie;
    k.classList.toggle('aan', !!s);
    if (!s) { $('#routeTekst').textContent = 'uit'; return; }
    const min = Math.floor((Date.now() - s.start) / 60000);
    const m = Route.lengte(s);
    $('#routeTekst').textContent = (s.naam ? s.naam.slice(0, 14) + ' · ' : '') + (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m') + ' · ' + min + ' min';
  },
};
setInterval(() => Route.sessie && Route.toon(), 20000);

async function houdSchermAan(){
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !Route.wakeLock) {
      Route.wakeLock = await navigator.wakeLock.request('screen');
      Route.wakeLock.addEventListener('release', () => { Route.wakeLock = null; });
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { haalNatieveSpelden(); houdSchermAan(); if (huidigScherm === 'zoeken') startCamera(); if (Stem.gewenst) Stem.start(); }
  else { stopCamera(); Stem.pauze(); if (!NATIEF) Route.pauze(); }
});

/* ================= CAMERA ================= */
let stream = null;
async function startCamera(){
  if (stream) return;
  const video = $('#cam');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('#camUit').style.display = 'none';
  } catch (e) {
    stream = null;
    $('#camUit').style.display = 'flex';
  }
}
function stopCamera(){
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}
function pakFrame(){
  // Neemt het camerabeeld en snijdt het bij tot het richtvenster (met wat ruimte eromheen).
  const v = $('#cam');
  return new Promise(ok => {
    if (!stream || !v.videoWidth) return ok(null);
    const vw = v.videoWidth, vh = v.videoHeight;
    const vr = v.getBoundingClientRect(), rr = $('#richt').getBoundingClientRect();
    const schaal = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
    const offX = (vr.width - vw * schaal) / 2, offY = (vr.height - vh * schaal) / 2;
    const marge = rr.width * 0.18;
    let sx = (rr.left - vr.left - marge - offX) / schaal, sy = (rr.top - vr.top - marge - offY) / schaal;
    let sw = (rr.width + 2 * marge) / schaal, sh = (rr.height + 2 * marge) / schaal;
    sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    const c = document.createElement('canvas');
    if (!(sw > 50 && sh > 50)) { c.width = vw; c.height = vh; c.getContext('2d').drawImage(v, 0, 0); }
    else { c.width = Math.round(sw); c.height = Math.round(sh); c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height); }
    c.toBlob(b => ok(b), 'image/jpeg', 0.92);
  });
}

/* ================= VONDST VASTLEGGEN ================= */
let bezig = false;
async function vondst(bron){
  if (bezig) return;
  bezig = true; $('#knop').classList.add('bezig');
  const start = Date.now();
  try {
    let blob = await pakFrame();
    if (!blob) {
      // geen live camera: val terug op de gewone camera-app
      blob = await vraagFoto();
      if (!blob) return;
    }
    const f = $('#flits'); f.style.opacity = '.85'; setTimeout(() => f.style.opacity = '0', 120);
    const r = $('#richt'); r.classList.add('klik'); setTimeout(() => r.classList.remove('klik'), 350);
    tril(70); piep(1100);
    blob = await verkleinFoto(blob, 1800, 0.88);
    const pos = GPS.laatste;
    const item = {
      id: nieuwId(), t: start, bron,
      lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, acc: pos ? Math.round(pos.acc) : null,
      sessie: Route.sessie ? Route.sessie.id : null,
      fotos: [{ blob, t: start, soort: 'veld' }],
      status: 'wacht', ai: null, eigenNaam: '', notitie: '', diepte: '', panGemeld: null,
    };
    await DB.put('finds', item);
    sessieTeller++;
    $('#teller').textContent = sessieTeller + (sessieTeller === 1 ? ' vondst' : ' vondsten') + ' vandaag vastgelegd';
    toonLaatste(item);
    Kaart.verversVondsten();
    verfijnPlek(item.id, start);
    if (!pos) { // nog geen GPS: wacht tot er een plek is
      new Promise(r => GPS.wachters.push(r)).then(() => verfijnPlek(item.id, Date.now()));
    }
    Herken.wachtrij(item.id);
  } finally {
    setTimeout(() => { bezig = false; $('#knop').classList.remove('bezig'); }, 900);
  }
}
let sessieTeller = 0;

function vraagFoto(){
  return new Promise(ok => {
    const inp = $('#extraFoto');
    inp.value = '';
    inp.onchange = () => ok(inp.files[0] || null);
    inp.click();
  });
}

async function toonLaatste(item){
  const l = $('#laatste');
  const naam = item.eigenNaam || (item.ai && item.ai.naam) || (item.status === 'bezig' ? 'Herkennen…' : 'Opgeslagen');
  let sub = item.ai ? [item.ai.periode, item.ai.zekerheid != null ? item.ai.zekerheid + '% zeker' : ''].filter(Boolean).join(' · ')
    : (item.status === 'geenkey' ? 'Zet je OpenAI-sleutel in Instellingen' : item.status === 'pro' ? 'Gratis herkenningen op · tik voor Pro' : item.status === 'speld' ? 'Speld gezet · voeg later een foto toe' : item.status === 'wacht' ? 'Wacht op herkenning…' : '');
  l.innerHTML = `<img src="${fotoSrc(item)}" alt=""><div class="tx"><div class="t">${esc(naam)}</div><div class="s">${esc(sub)}</div></div><span class="pijl">›</span>`;
  l.style.display = 'flex';
  l.onclick = () => openDetail(item.id);
  l.dataset.id = item.id;
}

/* ================= STEM ================= */
const Stem = {
  rec: null, aan: false, loopt: false, laatsteKeer: 0, laatsteStart: 0,
  get gewenst(){ return localStorage.getItem('v_stem') === '1'; },
  set gewenst(v){ localStorage.setItem('v_stem', v ? '1' : '0'); },
  // Woord van de eigen herkenner terwijl de app open is
  natiefWoord(woord){
    Stem.laatsteKeer = Date.now();
    $('#stemTekst').textContent = '“' + woord + '”';
    if (huidigScherm === 'zoeken' && !$('#detail').classList.contains('open')) vondst('stem');
    else zetSpeld('stem');
  },
  verwerk(tekst){
    const t = (tekst || '').toLowerCase();
    if (t.trim()) $('#stemTekst').textContent = '“' + tekst.trim() + '”';
    if (/\b(vondst|vondsten|vonst|fonds|fondst|vonts|foto|foto's|photo|hebbes|hebbers|hebbus|hebbe|heppes|ebbes|bingo)\b/.test(t) && Date.now() - Stem.laatsteKeer > 2500) {
      Stem.laatsteKeer = Date.now();
      vondst('stem');
      return true;
    }
    return false;
  },
  // ---- Android-app: spraakherkenning van de telefoon zelf ----
  async startNatief(handmatig){
    // Eerst de eigen offline woordherkenner (luistert ook met het scherm uit)
    if (!Stem.geenVosk) {
      try {
        const VS = plugin('VondstStem');
        await VS.start();
        if (!Stem.voskLuisteraar) {
          Stem.voskLuisteraar = true;
          VS.addListener('woord', d => Stem.natiefWoord(d.woord));
        }
        Stem.vosk = VS; Stem.gewenst = true; Stem.aan = true; Stem.loopt = true;
        $('#stemKnop').classList.add('aan'); $('#stemStatus').textContent = 'luistert';
        setTimeout(async () => { try { const st = await VS.status(); if (!st.actief && !st.bezig && st.fout) { Stem.geenVosk = true; Stem.vosk = null; Stem.loopt = false; melding('Eigen spraakherkenning lukte niet, ik gebruik die van de telefoon'); Stem.startNatief(handmatig); } } catch (e) {} }, 8000);
        return;
      } catch (e) {
        if (String(e && e.message || e).includes('toestemming')) { melding('Geen toestemming voor de microfoon'); return; }
        Stem.geenVosk = true;
      }
    }
    const SR = plugin('SpeechRecognition');
    try { const a = await SR.available(); if (!a.available) { if (handmatig) melding('Spraakherkenning is niet beschikbaar op deze telefoon'); return; } } catch (e) {}
    try {
      const p = await SR.checkPermissions();
      if (p.speechRecognition !== 'granted') {
        const r = await SR.requestPermissions();
        if (r.speechRecognition !== 'granted') { melding('Geen toestemming voor de microfoon'); return; }
      }
    } catch (e) {}
    Stem.gewenst = true; Stem.aan = true;
    $('#stemKnop').classList.add('aan'); $('#stemStatus').textContent = 'luistert';
    if (!Stem.natiefLuisteraars) {
      Stem.natiefLuisteraars = true;
      SR.addListener('partialResults', d => { for (const m of (d.matches || [])) if (Stem.verwerk(m)) break; });
      SR.addListener('listeningState', d => {
        Stem.loopt = d.status === 'started';
        if (d.status === 'stopped' && Stem.aan && document.visibilityState === 'visible') setTimeout(Stem.herstart, 400);
      });
    }
    Stem.herstart();
  },
  start(handmatig){
    if (NATIEF) return Stem.startNatief(handmatig);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { if (handmatig) melding('Spraak werkt niet in deze browser. Gebruik Chrome.'); return; }
    Stem.gewenst = true; Stem.aan = true;
    $('#stemKnop').classList.add('aan'); $('#stemStatus').textContent = 'luistert';
    if (Stem.rec) { Stem.herstart(); return; }
    const r = new SR();
    r.lang = 'nl-NL'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
    r.onstart = () => { Stem.loopt = true; Stem.wachtOpTik(false); };
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        for (let j = 0; j < e.results[i].length; j++) if (Stem.verwerk(e.results[i][j].transcript)) return;
      }
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // Mag (nog) niet zonder tik: wacht op de eerste tik ergens op het scherm.
        Stem.loopt = false; Stem.wachtOpTik(true);
      }
    };
    r.onend = () => { Stem.loopt = false; if (Stem.aan && document.visibilityState === 'visible') setTimeout(Stem.herstart, 300); };
    Stem.rec = r;
    Stem.herstart();
  },
  herstart(){
    if (Stem.vosk) return; // de eigen woordherkenner luistert zelf onafgebroken
    if (NATIEF) {
      if (!Stem.aan || Stem.loopt || document.visibilityState !== 'visible') return;
      Stem.loopt = true; Stem.laatsteStart = Date.now();
      plugin('SpeechRecognition').start({ language: 'nl-NL', maxResults: 3, partialResults: true, popup: false }).catch(() => { Stem.loopt = false; });
      return;
    }
    if (!Stem.rec || !Stem.aan || Stem.loopt || document.visibilityState !== 'visible') return;
    Stem.laatsteStart = Date.now();
    try { Stem.rec.start(); } catch (e) {}
  },
  pauze(){ // app weggeklikt: microfoon los, maar de stem blijft 'gewenst'
    if (Stem.vosk) return; // blijft luisteren: met scherm uit zet hij spelden
    Stem.loopt = false;
    if (NATIEF) { plugin('SpeechRecognition').stop().catch(() => {}); return; }
    try { Stem.rec && Stem.rec.abort(); } catch (e) {}
  },
  stop(){
    Stem.gewenst = false; Stem.aan = false; Stem.loopt = false; Stem.wachtOpTik(false);
    $('#stemKnop').classList.remove('aan'); $('#stemStatus').textContent = 'uit'; $('#stemTekst').textContent = '';
    if (Stem.vosk) { Stem.vosk.stop().catch(() => {}); Stem.vosk = null; }
    if (NATIEF && !Stem.geenVosk) {} else if (NATIEF) plugin('SpeechRecognition').stop().catch(() => {});
    try { Stem.rec && Stem.rec.abort(); } catch (e) {}
    Stem.rec = null;
  },
  wachtOpTik(ja){
    $('#stemStatus').textContent = ja ? 'tik scherm' : (Stem.aan ? 'luistert' : 'uit');
    if (ja && !Stem.tikLuisteraar) {
      Stem.tikLuisteraar = () => { Stem.wachtOpTik(false); Stem.herstart(); };
      document.addEventListener('pointerdown', Stem.tikLuisteraar, { once: true, capture: true });
    }
    if (!ja && Stem.tikLuisteraar) { document.removeEventListener('pointerdown', Stem.tikLuisteraar, { capture: true }); Stem.tikLuisteraar = null; }
  },
};
// Waakhond: soms stopt Chrome het luisteren zonder melding; dan starten we hem opnieuw.
setInterval(() => { if (Stem.aan && !Stem.loopt && document.visibilityState === 'visible' && Date.now() - Stem.laatsteStart > 3000) Stem.herstart(); }, 3000);

/* ================= SPELDEN (vondst zonder foto, bijv. met de telefoon in je zak) ================= */
async function zetSpeld(bron, data){
  const pos = data || GPS.laatste;
  const t = data ? data.t : Date.now();
  const heeftPlek = pos && pos.lat != null;
  const item = {
    id: nieuwId(), t, bron,
    lat: heeftPlek ? pos.lat : null, lon: heeftPlek ? pos.lon : null, acc: heeftPlek && pos.acc != null ? Math.round(pos.acc) : null,
    sessie: Route.sessie && t >= Route.sessie.start ? Route.sessie.id : null,
    fotos: [], status: 'speld', ai: null, eigenNaam: '', diepte: '', panGemeld: null,
    notitie: data && data.gpsLeeftijd > 120000 ? 'Let op: de GPS-plek was ' + Math.round(data.gpsLeeftijd / 60000) + ' minuten oud.' : '',
  };
  await DB.put('finds', item);
  Kaart.verversVondsten();
  if (!data) { tril([0, 120, 100, 120]); piep(880, .12); melding('📍 Speld gezet. Voeg later een foto toe.'); verfijnPlek(item.id, Date.now()); }
  Plek.vulVondst(item.id);
  toonSpeldChip();
  return item;
}
async function haalNatieveSpelden(){
  if (!NATIEF) return;
  try {
    const r = await plugin('VondstStem').haalSpelden();
    const lijst = JSON.parse(r.json || '[]');
    for (const sp of lijst) await zetSpeld('stem-slot', sp);
    if (lijst.length) melding(`📍 ${lijst.length} ${lijst.length === 1 ? 'speld' : 'spelden'} gezet terwijl je telefoon op slot was. Voeg later een foto toe.`, 5500);
  } catch (e) {}
  toonSpeldChip();
}
async function toonSpeldChip(){
  const n = (await DB.all('finds')).filter(f => f.status === 'speld').length;
  const c = $('#speldChip'); if (!c) return;
  c.style.display = n ? 'inline-flex' : 'none';
  c.textContent = `📍 ${n} ${n === 1 ? 'speld' : 'spelden'} zonder foto`;
}
window.zetSpeld = zetSpeld;

/* ================= AI-HERKENNING ================= */
const PROMPT = `Je bent een ervaren Nederlandse vondstdeskundige: archeoloog, numismaat en munitiekenner tegelijk. Je helpt metaaldetectorzoekers in Nederland en Vlaanderen hun vondsten te herkennen. Vondsten zijn vaak vuil, gecorrodeerd, verbogen of maar een deel van het oorspronkelijke voorwerp. Herken dan het oorspronkelijke voorwerp aan het stuk dat er nog is (vorm, groeven, rand, gaatjes, opschrift, versiering).

Ken in het bijzonder: Nederlandse en Europese munten van Romeins tot nu (duiten, stuivers, dubbeltjes, oorden, penningen, Romeinse munten, rekenpenningen, jetons), knopen (uniformknopen, tinnen, koperen, beenderen), gespen, schoenen- en riemgespen, riemtongen, mantelspelden, fibula's, vingerhoeden, loodjes (laken-, zak- en douaneloodjes), muntgewichten, bestek (lepels, messen, vorken), sleutels, speelgoed (tinnen soldaatjes, loden speelgoed), religieuze insignes, sieraden, gereedschap, paardentuig, en moderne spullen (bierdoppen met merk, blikjes, trekringen, munten in euro en gulden, auto-onderdelen). Noem bij modern spul zo mogelijk merk, model of soort.

MUNITIE EN VEILIGHEID – heel belangrijk:
- "veilig": afgevuurde kogels (vervormd projectiel zonder huls), lege afgevuurde hulzen (slaghoedje ingedeukt), granaatscherven (losse kapotte stukken staal of ijzer met scherpe breukranden, ook als er groeven of een ribbelpatroon op zitten waaraan je ziet dat het een granaat was), kogelgeleidingsbanden, losse stukken koper.
- "voorzichtig": lege hulzen waarvan je het slaghoedje niet goed ziet, onduidelijke stukken metaal die op munitie kunnen lijken, oude ontstekeronderdelen die duidelijk kapot en leeg zijn.
- "gevaarlijk": intacte patronen (huls met kogel erin), niet-afgevuurde munitie, kogels met gekleurde punt (bijvoorbeeld .50 met blauwe, zilveren of zwarte punt = brand- of pantserbrisant, ook als de verf bijna weg is), alles met fosfor, intacte of bijna intacte granaten, mortiergranaten, geweergranaten, landmijnen, ontstekers en buizen, intacte cilindervormige of peervormige ijzeren voorwerpen die munitie kunnen zijn. Witte fosfor lijkt op een geelbruin klompje barnsteen of was en kan spontaan gaan branden als het droogt.
- Twijfel je tussen voorzichtig en gevaarlijk, kies dan gevaarlijk.
- Noem een granaatscherf gewoon een granaatscherf en meld dat het een veilig stuk staal is als het een losse scherf is.

Wees eerlijk over zekerheid. Een slechte, modderige foto geeft een lage zekerheid; zeg dan wat er op een volgende foto te zien moet zijn (andere kant, schoongemaakt, met munt of liniaal ernaast voor de maat). Als er meerdere foto's zijn, is de laatste meestal schoongemaakt en het meest betrouwbaar. Raad nooit dingen aan die een vondst beschadigen (geen staalborstel of zuur op munten).

Antwoord ALLEEN met JSON, in het Nederlands, met precies deze velden:
{
 "naam": "korte naam, bijvoorbeeld 'Duit van Holland' of 'Uniformknoop' of 'Heineken bierdop'",
 "categorie": "munt | knoop | gesp | sieraad | loodje | bestek | gereedschap | speelgoed | religieus | munitie | granaatscherf | modern | afval | onbekend | anders",
 "periode": "bijvoorbeeld 'Romeins', 'Late middeleeuwen', '17e eeuw', 'Tweede Wereldoorlog', 'Modern'",
 "datering": "jaartallen, bijvoorbeeld '1702-1780' of 'circa 1940-1945'",
 "materiaal": "koper, brons, lood, tin, zilver, goud, ijzer, aluminium, ...",
 "beschrijving": "2 tot 4 zinnen: wat het is, waaraan je het herkent, en een leuk weetje",
 "herkenningstekens": "wat je op de foto ziet waarop je je oordeel baseert",
 "merk_model": "voor modern spul of munitie: merk, model, kaliber; anders leeg",
 "zeldzaamheid": "algemeen | vrij algemeen | bijzonder | zeldzaam | onbekend",
 "waarde_indicatie": "grove indicatie in euro of 'geen handelswaarde'; leeg als je het niet weet",
 "zekerheid": 0-100,
 "alternatieven": ["andere mogelijkheden als je twijfelt"],
 "veiligheid": "veilig | voorzichtig | gevaarlijk",
 "veiligheid_uitleg": "één zin",
 "pan_meldwaardig": true of false (true als het waarschijnlijk een archeologische vondst is, ouder dan circa 50 jaar en geen munitie),
 "foto_advies": "wat een volgende foto beter zou maken; leeg als de foto goed is",
 "schoonmaak_advies": "veilig schoonmaakadvies voor dit soort vondst"
}`;

const Herken = {
  rij: [], loopt: false,
  wachtrij(id){ if (!Herken.rij.includes(id)) Herken.rij.push(id); Herken.verwerk(); },
  async verwerk(){
    if (Herken.loopt) return;
    Herken.loopt = true;
    try {
      while (Herken.rij.length) {
        const id = Herken.rij.shift();
        await Herken.een(id);
      }
    } finally { Herken.loopt = false; }
  },
  async kiesModel(){
    if (instel.model) return instel.model;
    const lijst = await Herken.modellen();
    const voorkeur = ['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'];
    const gekozen = voorkeur.find(m => lijst.includes(m)) || lijst.find(m => /^gpt-(5|4\.1|4o)/.test(m) && !/(audio|realtime|search|transcribe|tts|image)/.test(m));
    if (!gekozen) throw new Error('Geen geschikt AI-model gevonden bij je OpenAI-account');
    instel.model = gekozen;
    return gekozen;
  },
  async modellen(){
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + instel.key } });
    if (!r.ok) throw new Error(r.status === 401 ? 'De sleutel klopt niet' : 'OpenAI gaf fout ' + r.status);
    const j = await r.json();
    return j.data.map(m => m.id).sort();
  },
  async een(id){
    const f = await DB.get('finds', id); if (!f) return;
    if (!f.fotos || !f.fotos.length) { if (f.status !== 'speld') { f.status = 'speld'; await DB.put('finds', f); } Herken.na(f); return; }
    if (!instel.key) { f.status = 'geenkey'; await DB.put('finds', f); Herken.na(f); return; }
    if (!Pro.mag()) { f.status = 'pro'; await DB.put('finds', f); Herken.na(f); if (!Herken.proGetoond) { Herken.proGetoond = true; Pro.open(); } return; }
    if (!navigator.onLine) { f.status = 'wacht'; await DB.put('finds', f); Herken.na(f); return; }
    f.status = 'bezig'; await DB.put('finds', f); Herken.na(f);
    try {
      const model = await Herken.kiesModel();
      const fotos = f.fotos.slice(-3);
      const beelden = [];
      for (const p of fotos) beelden.push(await blobNaarDataUrl(await verkleinFoto(p.blob, 1280, 0.85)));
      // Alleen wat nodig is: land en datum, geen precieze plek.
      const context = `Vondst gedaan in ${landVan(f.lat, f.lon) === 'BE' ? 'België' : 'Nederland of België'} op ${new Date(f.t).toLocaleDateString('nl-NL')}` +
        `. Aantal foto's: ${fotos.length}. ` + fotos.map((p, i) => `Foto ${i + 1}: ${p.soort === 'veld' ? 'in het veld, mogelijk vuil' : 'schoongemaakt of thuis gefotografeerd'}.`).join(' ') +
        (f.diepte ? ` Diepte: ${f.diepte} cm.` : '') + (f.notitie ? ` Notitie van de zoeker: ${f.notitie}` : '');
      const inhoud = [{ type: 'text', text: context }, ...beelden.map(u => ({ type: 'image_url', image_url: { url: u, detail: 'high' } }))];
      const body = { model, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: inhoud }], response_format: { type: 'json_object' } };
      let r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + instel.key }, body: JSON.stringify(body),
      });
      if (r.status === 400) { // sommige modellen kennen response_format niet
        delete body.response_format;
        r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + instel.key }, body: JSON.stringify(body),
        });
      }
      if (!r.ok) {
        let txt = ''; try { txt = (await r.json()).error.message; } catch (e) {}
        if (r.status === 404 || /model/i.test(txt)) instel.model = ''; // volgende keer opnieuw kiezen
        throw new Error('OpenAI fout ' + r.status + (txt ? ': ' + txt : ''));
      }
      const j = await r.json();
      const tekst = j.choices[0].message.content || '';
      const json = JSON.parse(tekst.slice(tekst.indexOf('{'), tekst.lastIndexOf('}') + 1));
      json.model = model; json.tijd = Date.now();
      instel.aiTeller = instel.aiTeller + 1;
      Pro.tel();
      const vers = await DB.get('finds', id);
      if (!vers) return; // intussen verwijderd
      vers.ai = json;
      vers.status = json.veiligheid === 'gevaarlijk' ? 'gevaar' : (+json.zekerheid >= 70 ? 'herkend' : 'onzeker');
      vers.fout = null;
      await DB.put('finds', vers);
      Herken.na(vers);
      if (vers.status === 'gevaar') toonGevaar(vers);
      else { piep(660, .08); setTimeout(() => piep(990, .1), 110); }
    } catch (e) {
      const vers = await DB.get('finds', id); if (!vers) return;
      vers.status = 'wacht'; vers.fout = String(e.message || e);
      await DB.put('finds', vers); Herken.na(vers); f.fout = vers.fout;
      melding('Herkenning lukte niet: ' + f.fout, 4500);
    }
  },
  na(f){
    const l = $('#laatste');
    if (l.dataset.id === f.id) toonLaatste(f);
    if (huidigScherm === 'vondsten') toonLijst();
    if ($('#detail').classList.contains('open') && $('#detail').dataset.id === f.id) openDetail(f.id);
    Kaart.verversVondsten();
  },
  async allesWachtend(){
    const alle = await DB.all('finds');
    alle.filter(f => ['wacht', 'geenkey', 'bezig', 'pro'].includes(f.status)).forEach(f => Herken.wachtrij(f.id));
  },
};
window.addEventListener('online', () => Herken.allesWachtend());

/* ================= GEVAAR ================= */
// Grof: ligt een plek in België? (voor de juiste alarmnummers; handmatig te wisselen)
function landVan(lat, lon){
  if (lat == null) return 'NL';
  if (lat < 50.75) return 'BE';
  if (lat < 51.37 && lon < 5.7 && !(lat > 51.27 && lon > 3.35 && lon < 4.2)) return 'BE';
  return 'NL';
}
function toonGevaar(f, handmatig){
  const naam = f && f.ai ? f.ai.naam : '';
  $('#gevaarTekst').textContent = handmatig ? 'Je hebt aangegeven dat dit munitie kan zijn.' : (naam ? 'De herkenning denkt aan: ' + naam + '.' : '');
  const lat = f && f.lat != null ? f.lat : GPS.laatste && GPS.laatste.lat, lon = f && f.lon != null ? f.lon : GPS.laatste && GPS.laatste.lon;
  $('#gevaarPlek').textContent = lat != null ? `Plek: ${lat.toFixed(6)}, ${lon.toFixed(6)}` : '';
  kiesAlarmLand(landVan(lat, lon));
  $('#gevaar').classList.add('open');
  tril([400, 150, 400, 150, 600]);
  piep(520, .4);
}
function kiesAlarmLand(land){
  const nl = land !== 'BE';
  $('#alarmLandNL').classList.toggle('aan', nl); $('#alarmLandBE').classList.toggle('aan', !nl);
  $('#belNiet').href = nl ? 'tel:0900-8844' : 'tel:101';
  $('#belNiet').textContent = nl ? 'Bel politie 0900-8844' : 'Bel politie 101';
}
$('#alarmLandNL').onclick = () => kiesAlarmLand('NL');
$('#alarmLandBE').onclick = () => kiesAlarmLand('BE');
$('#munitieKnop').onclick = e => { e.stopPropagation(); toonGevaar(null, true); };
window.toonGevaar = toonGevaar;
$('#gevaarDicht').onclick = () => $('#gevaar').classList.remove('open');

/* ================= KAART ================= */
var Kaart = window.Kaart = {
  map: null, lagen: {}, laag: 'sat', vondstLaag: null, routeLaag: null, actieveLijn: null, mijnMarker: null, mijnCirkel: null, volgen: true,
  init(){
    if (Kaart.map || !window.L) return;
    const map = L.map('kaartDiv', { zoomControl: false, maxZoom: 22 }).setView([52.1, 5.3], 8);
    Kaart.lagen.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, attribution: 'Esri' });
    Kaart.lagen.kaart = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
    Kaart.lagen.sat.addTo(map);
    Kaart.routeLaag = L.layerGroup().addTo(map);
    Kaart.vondstLaag = L.layerGroup().addTo(map);
    map.on('zoomend', Kaart.dikte);
    map.on('dragstart', () => { Kaart.volgen = false; });
    Kaart.map = map;
    Kaart.verversRoutes(); Kaart.verversVondsten();
    if (GPS.laatste) { map.setView([GPS.laatste.lat, GPS.laatste.lon], 19); Kaart.mijnPlek(GPS.laatste); }
    Lagen.opKaart(map);
  },
  // Een zoekstrook van ongeveer 1 meter breed (zwaai van de detector)
  breedtePx(){
    const m = Kaart.map; if (!m) return 4;
    const lat = m.getCenter().lat;
    const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, m.getZoom());
    return Math.max(3, Math.min(80, 1.1 / mpp));
  },
  dikte(){
    const w = Kaart.breedtePx();
    Kaart.routeLaag && Kaart.routeLaag.eachLayer(l => l.setStyle && !l.options.gat && l.setStyle({ weight: w }));
  },
  async verversRoutes(){
    if (!Kaart.map) return;
    Kaart.routeLaag.clearLayers(); Kaart.actieveLijn = null;
    const tracks = await DB.all('tracks');
    const w = Kaart.breedtePx();
    for (const t0 of tracks) {
      const actief = Route.sessie && t0.id === Route.sessie.id;
      const t = actief ? Route.sessie : t0;
      if (t.punten.length < 2 && !actief) continue;
      if (!Routes.zichtbaar(t0)) continue;
      const kleur = actief ? routeKleur() : oudeRouteKleur();
      const { delen, gaten } = segmenten(t.punten);
      for (const [a, b] of gaten) {
        L.polyline([[a[0], a[1]], [b[0], b[1]]], { color: kleur, opacity: .9, weight: 3, dashArray: '2 9', lineCap: 'round', gat: true, interactive: false }).addTo(Kaart.routeLaag);
      }
      delen.forEach((d, i) => {
        const lijn = L.polyline(d.map(p => [p[0], p[1]]), { color: kleur, opacity: actief ? 0.6 : 0.35, weight: w, lineCap: 'round', lineJoin: 'round' }).addTo(Kaart.routeLaag);
        if (actief && i === delen.length - 1) Kaart.actieveLijn = lijn;
      });
    }
  },
  routePunt(p){ if (Kaart.actieveLijn) Kaart.actieveLijn.addLatLng([p[0], p[1]]); else Kaart.verversRoutes(); },
  async verversVondsten(){
    if (!Kaart.map) return;
    Kaart.vondstLaag.clearLayers();
    const alle = await DB.all('finds');
    for (const f of alle) {
      if (f.lat == null) continue;
      const kleur = f.status === 'gevaar' ? '#ff3b30' : f.status === 'herkend' ? '#3ecf6e' : f.status === 'onzeker' ? '#ffb020' : f.status === 'speld' ? '#b06bff' : '#cccccc';
      const m = L.circleMarker([f.lat, f.lon], { radius: 9, color: '#000', weight: 2, fillColor: kleur, fillOpacity: 1 }).addTo(Kaart.vondstLaag);
      const naam = f.eigenNaam || (f.ai && f.ai.naam) || (f.status === 'speld' ? 'Speld (nog geen foto)' : 'Nog niet herkend');
      m.bindPopup(`<img src="${fotoSrc(f)}"><b>${esc(naam)}</b><br>${esc(datumTekst(f.t))}<button class="popknop" onclick="openDetail('${f.id}')">Bekijk</button>`);
    }
  },
  mijnPlek(fix){
    if (!Kaart.map) return;
    const ll = [fix.lat, fix.lon];
    if (!Kaart.mijnMarker) {
      Kaart.mijnCirkel = L.circle(ll, { radius: fix.acc, color: '#3fa9ff', weight: 1, fillOpacity: .12 }).addTo(Kaart.map);
      Kaart.mijnMarker = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: '#1e88ff', fillOpacity: 1 }).addTo(Kaart.map);
    } else { Kaart.mijnMarker.setLatLng(ll); Kaart.mijnCirkel.setLatLng(ll).setRadius(fix.acc); }
    if (Kaart.volgen && huidigScherm === 'kaart') Kaart.map.panTo(ll, { animate: true });
  },
  wissel(){
    if (!Kaart.map) return;
    Kaart.map.removeLayer(Kaart.lagen[Kaart.laag]);
    Kaart.laag = Kaart.laag === 'sat' ? 'kaart' : 'sat';
    Kaart.lagen[Kaart.laag].addTo(Kaart.map).bringToBack();
  },
};
$('#volgKnop').onclick = () => { Kaart.volgen = true; if (GPS.laatste && Kaart.map) Kaart.map.setView([GPS.laatste.lat, GPS.laatste.lon], Math.max(Kaart.map.getZoom(), 19)); };
$('#laagKnop').onclick = () => Kaart.wissel();
async function toonOpKaart(id){
  const f = await DB.get('finds', id); if (!f || f.lat == null) return melding('Deze vondst heeft geen GPS-plek');
  sluitDetail(); kiesScherm('kaart'); Kaart.volgen = false;
  Kaart.map.setView([f.lat, f.lon], 20);
}

/* ================= PLAATSNAMEN ================= */
// Nederland: PDOK Locatieserver (Kadaster, open data). Buiten Nederland: OpenStreetMap (Nominatim).
const Plek = {
  cache: (() => { try { return JSON.parse(localStorage.getItem('v_plekcache') || '{}'); } catch (e) { return {}; } })(),
  sleutel: (lat, lon) => lat.toFixed(4) + ',' + lon.toFixed(4),
  bewaarCache(){
    const k = Object.keys(Plek.cache);
    if (k.length > 400) k.slice(0, k.length - 400).forEach(x => delete Plek.cache[x]);
    try { localStorage.setItem('v_plekcache', JSON.stringify(Plek.cache)); } catch (e) {}
  },
  async pdok(lat, lon, type){
    const r = await fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse?lat=${lat}&lon=${lon}&rows=1&type=${type}&fl=*`);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.response && j.response.docs && j.response.docs[0]) || null;
  },
  async zoek(lat, lon){
    if (lat == null) return null;
    const k = Plek.sleutel(lat, lon);
    if (Plek.cache[k]) return Plek.cache[k];
    if (!navigator.onLine) return null;
    let p = null;
    try {
      const [adres, weg, perceel] = await Promise.all([Plek.pdok(lat, lon, 'adres'), Plek.pdok(lat, lon, 'weg'), Plek.pdok(lat, lon, 'perceel')]);
      const nl = adres && adres.afstand != null && adres.afstand < 3000;
      if (nl) p = {
        land: 'Nederland',
        provincie: adres.provincienaam || '', gemeente: adres.gemeentenaam || '', plaats: adres.woonplaatsnaam || '',
        straat: (weg && weg.straatnaam) || adres.straatnaam || '',
        adres: adres.afstand <= 60 ? adres.weergavenaam : '',
        afstandAdres: Math.round(adres.afstand || 0),
        perceel: perceel ? (perceel.weergavenaam || perceel.identificatie || '') : '',
        bron: 'Kadaster / PDOK',
      };
    } catch (e) {}
    if (!p) {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1&accept-language=nl`);
        if (r.ok) {
          const j = await r.json(), a = j.address || {};
          p = {
            land: a.country || '', provincie: a.state || a.province || '', gemeente: a.municipality || a.city || a.town || '',
            plaats: a.village || a.town || a.city || a.hamlet || a.suburb || '', straat: a.road || '',
            adres: '', afstandAdres: null, perceel: '', bron: 'OpenStreetMap',
          };
        }
      } catch (e) {}
    }
    if (p) { Plek.cache[k] = p; Plek.bewaarCache(); }
    return p;
  },
  kort(p){ if (!p) return ''; return [p.plaats || p.gemeente, p.land && p.land !== 'Nederland' ? p.land : ''].filter(Boolean).join(', '); },
  lang(p){
    if (!p) return '';
    const waar = p.adres ? p.adres : (p.straat ? (p.afstandAdres > 150 ? 'Buitengebied langs ' : 'Bij ') + p.straat : 'Buitengebied');
    return [waar, p.plaats && !(p.adres || '').includes(p.plaats) ? p.plaats : '', p.gemeente && p.gemeente !== p.plaats ? 'gemeente ' + p.gemeente : '', p.provincie, p.land].filter(Boolean).join(', ');
  },
  async vulVondst(id){
    const f0 = await DB.get('finds', id); if (!f0 || f0.lat == null) return;
    const p = await Plek.zoek(f0.lat, f0.lon); if (!p) return;
    const f = await DB.get('finds', id); if (!f) return;
    f.plek = p; await DB.put('finds', f);
    if (huidigScherm === 'vondsten') toonLijst();
    if ($('#detail').classList.contains('open') && $('#detail').dataset.id === id) openDetail(id);
  },
  async vulRoute(t){
    const pt = t.punten.find(x => x[2] <= 25) || t.punten[0]; if (!pt) return null;
    const p = await Plek.zoek(pt[0], pt[1]); if (!p) return null;
    const vers = (Route.sessie && Route.sessie.id === t.id) ? Route.sessie : await DB.get('tracks', t.id);
    if (!vers) return null;
    vers.plek = p; await DB.put('tracks', vers);
    return p;
  },
  async vulOntbrekende(){
    if (!navigator.onLine) return;
    const finds = (await DB.all('finds')).filter(f => !f.plek && f.lat != null).slice(-30);
    for (const f of finds) { await Plek.vulVondst(f.id); await wacht(1100); }
    const tracks = (await DB.all('tracks')).filter(t => !t.plek && t.punten.length);
    for (const t of tracks) { await Plek.vulRoute(t); await wacht(1100); }
  },
};
window.addEventListener('online', () => Plek.vulOntbrekende());

/* ================= ROUTES-OVERZICHT ================= */
const Routes = {
  alleenVandaag: () => localStorage.getItem('v_alleenvandaag') === '1',
  zichtbaar(t){
    if (Route.sessie && t.id === Route.sessie.id) return true;
    if (t.verborgen) return false;
    if (Routes.alleenVandaag()) { const d = new Date(); d.setHours(0, 0, 0, 0); return t.start >= d.getTime(); }
    return true;
  },
  naam(t){ return t.naam || (t.plek ? Plek.kort(t.plek) : '') || 'Route van ' + new Date(t.start).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }); },
  async open(){ await Routes.toon(); $('#routesPaneel').classList.add('open'); },
  async toon(){
    const tracks = (await DB.all('tracks')).map(t => (Route.sessie && t.id === Route.sessie.id) ? Route.sessie : t)
      .filter(t => t.punten.length || (Route.sessie && t.id === Route.sessie.id)).sort((a, b) => b.start - a.start);
    const finds = await DB.all('finds');
    const el = $('#routesLijst');
    let html = `<div class="routeknoppen">
      <button class="groot ${Route.sessie ? '' : 'goud'}" onclick="Routes.nieuw()">${Route.sessie ? '⏹ Stoppen en nieuwe route starten' : '▶ Nieuwe route starten'}</button>
      <label class="vandaag"><input type="checkbox" ${Routes.alleenVandaag() ? 'checked' : ''} onchange="Routes.zetVandaag(this.checked)"> Alleen routes van vandaag op de kaart</label></div>`;
    if (!tracks.length) html += '<div class="leeg">Nog geen routes. Zet Route aan op het zoekscherm.</div>';
    html += tracks.map(t => {
      const actief = Route.sessie && t.id === Route.sessie.id;
      const eind = t.eind || (t.punten.length ? t.punten[t.punten.length - 1][3] : t.start);
      const min = Math.max(0, Math.round((eind - t.start) / 60000));
      const m = Route.lengte(t);
      const aantal = finds.filter(f => f.sessie === t.id).length;
      const zicht = Routes.zichtbaar(t);
      if (!t.plek && t.punten.length && navigator.onLine) Plek.vulRoute(t).then(p => p && Routes.toon());
      return `<div class="routekaart ${actief ? 'actief' : ''}">
        <div class="rk-kop"><b>${esc(Routes.naam(t))}</b>${actief ? '<span class="label l-herkend">loopt nu</span>' : ''}</div>
        <div class="rk-sub">${esc(new Date(t.start).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${min >= 60 ? Math.floor(min / 60) + ' u ' + (min % 60) + ' min' : min + ' min'} · ${m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'} · ${aantal} ${aantal === 1 ? 'vondst' : 'vondsten'}</div>
        ${t.plek ? `<div class="rk-sub">📍 ${esc(Plek.lang(t.plek))}</div>` : ''}
        <div class="rk-knoppen">
          <button onclick="Routes.bekijk('${t.id}')">🔍 Bekijk</button>
          <button onclick="Routes.hernoem('${t.id}')">✏️ Naam</button>
          ${actief ? '' : `<button onclick="Routes.wisselZicht('${t.id}')">${zicht ? '🙈 Verberg' : '👁 Toon'}</button>
          <button class="rood" onclick="Routes.verwijder('${t.id}')">🗑️</button>`}
        </div></div>`;
    }).join('');
    el.innerHTML = html;
  },
  async haal(id){ return (Route.sessie && Route.sessie.id === id) ? Route.sessie : DB.get('tracks', id); },
  async bekijk(id){
    const t = await Routes.haal(id); if (!t || !t.punten.length) return melding('Deze route heeft nog geen punten');
    if (t.verborgen) { t.verborgen = false; await DB.put('tracks', t); }
    $('#routesPaneel').classList.remove('open');
    if (huidigScherm !== 'kaart') kiesScherm('kaart');
    await Kaart.verversRoutes();
    Kaart.volgen = false;
    Kaart.map.fitBounds(L.latLngBounds(t.punten.map(p => [p[0], p[1]])), { padding: [40, 40], maxZoom: 19 });
  },
  async hernoem(id){
    const t = await Routes.haal(id); if (!t) return;
    const n = prompt('Naam voor deze route (bijvoorbeeld "Akker boer Jansen"):', t.naam || '');
    if (n === null) return;
    t.naam = n.trim(); await DB.put('tracks', t);
    Routes.toon(); Route.toon();
  },
  async wisselZicht(id){
    const t = await DB.get('tracks', id); if (!t) return;
    t.verborgen = !t.verborgen; await DB.put('tracks', t);
    Routes.toon(); Kaart.verversRoutes();
  },
  async verwijder(id){
    const t = await DB.get('tracks', id); if (!t) return;
    if (!confirm('Route "' + Routes.naam(t) + '" verwijderen? Je vondsten blijven bewaard.')) return;
    await DB.del('tracks', id);
    Routes.toon(); Kaart.verversRoutes(); melding('Route verwijderd');
  },
  zetVandaag(aan){ localStorage.setItem('v_alleenvandaag', aan ? '1' : '0'); Kaart.verversRoutes(); },
  async nieuw(){
    if (Route.sessie) await Route.uit();
    await Route.aan();
    Routes.toon();
  },
};
window.Routes = Routes;
$('#routesKnop').onclick = () => Routes.open();
$('#routesDicht').onclick = () => $('#routesPaneel').classList.remove('open');

/* ================= ROUTEKLEUR ================= */
const ROUTEKLEUREN = [
  ['#ffd36b', 'Goud'], ['#ffffff', 'Wit'], ['#ff2bd6', 'Roze'], ['#00e5ff', 'Lichtblauw'],
  ['#ff3b30', 'Rood'], ['#7dff3a', 'Felgroen'], ['#ff8a00', 'Oranje'], ['#7a5cff', 'Paars'],
];
const routeKleur = () => localStorage.getItem('v_routekleur') || '#ffd36b';
const oudeRouteKleur = () => routeKleur() === '#00e5ff' ? '#ffffff' : '#7fd1ff';
function toonKleurKeuze(){
  $('#kleurStaal').style.background = routeKleur();
  $('#kleurKeuze').innerHTML = ROUTEKLEUREN.map(([k, n]) =>
    `<button title="${n}" aria-label="${n}" style="background:${k}" class="${k === routeKleur() ? 'aan' : ''}" onclick="kiesRouteKleur('${k}')"></button>`).join('');
}
function kiesRouteKleur(k){
  localStorage.setItem('v_routekleur', k);
  toonKleurKeuze(); Kaart.verversRoutes();
  setTimeout(() => $('#kleurKeuze').classList.remove('open'), 250);
}
window.kiesRouteKleur = kiesRouteKleur;
$('#kleurKnop').onclick = () => { toonKleurKeuze(); $('#kleurKeuze').classList.toggle('open'); };
toonKleurKeuze();

/* ================= HISTORISCHE LAGEN (van Nova, volgens lagen/index.json) ================= */
const PERIODES = {
  'prehistorie': 'Prehistorie', 'romeins': 'Romeinse tijd', 'vroege-middeleeuwen': 'Vroege middeleeuwen',
  'late-middeleeuwen': 'Late middeleeuwen', 'nieuwe-tijd': 'Nieuwe tijd', 'negentiende-eeuw': '19e eeuw',
  'wereldoorlogen': 'Wereldoorlogen', 'modern': 'Na 1945',
};
const GROEPEN = { 'veiligheid': 'Veiligheid', 'periode': 'Historische perioden', 'historische-kaart': 'Oude kaarten' };
const jaar = j => j == null || j === '' ? '' : (+j < 0 ? (-j) + ' v.Chr.' : String(j));
const Lagen = {
  lijst: [], data: {}, kaartLagen: {}, map: null, gewaarschuwd: '', laatsteCheck: 0, dekking: '', bezigMet: {},
  aan(l){
    if (l.uitzetbaar === false) return true;
    const v = localStorage.getItem('v_laag_' + l.id);
    return v === null ? !!l.standaardAan : v === '1';
  },
  async laad(){
    try {
      const r = await fetch('lagen/index.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const j = await r.json();
      Lagen.lijst = (j.lagen || []).filter(l => l && l.id && l.url && l.type);
      Lagen.dekking = j.dekking || '';
    } catch (e) { Lagen.lijst = []; }
    if (GPS.laatste) Lagen.check(GPS.laatste, true);
    Lagen.toonMenu();
  },
  // ligt [lon, lat] in het vak van een laag (met marge in graden)?
  inVak(l, lon, lat, marge = 0){
    const b = l.bbox; if (!b) return true;
    return lon >= b[0] - marge && lon <= b[2] + marge && lat >= b[1] - marge && lat <= b[3] + marge;
  },
  vakInBeeld(l){
    const b = l.bbox; if (!b || !Lagen.map) return true;
    const z = Lagen.map.getBounds();
    return !(b[2] < z.getWest() || b[0] > z.getEast() || b[3] < z.getSouth() || b[1] > z.getNorth());
  },
  async haalData(l){
    if (Lagen.data[l.id]) return Lagen.data[l.id];
    if (Lagen.bezigMet[l.id]) return Lagen.bezigMet[l.id];
    Lagen.bezigMet[l.id] = (async () => {
      try {
        const r = await fetch(l.url);
        if (!r.ok) throw new Error(r.status);
        const gj = await r.json();
        for (const f of gj.features || []) f._bb = vakVan(f.geometry);
        Lagen.data[l.id] = gj;
      } catch (e) { melding('Laag "' + l.naam + '" kon niet geladen worden'); return null; }
      finally { delete Lagen.bezigMet[l.id]; }
      if (Lagen.map) Lagen.bijwerken();
      return Lagen.data[l.id];
    })();
    return Lagen.bezigMet[l.id];
  },
  opKaart(map){ Lagen.map = map; Lagen.canvas = L.canvas({ padding: 0.3 }); map.on('zoomend moveend', Lagen.bijwerken); Lagen.bijwerken(); },
  maakLaag(l){
    if (l.type === 'xyz') return L.tileLayer(l.url, { maxZoom: 22, maxNativeZoom: l.maxNativeZoom || 19, opacity: l.doorzichtigheid ?? 0.75, attribution: l.naamsvermelding || '' });
    if (l.type === 'wms') return L.tileLayer.wms(l.url, { layers: l.wmsLagen || '', format: 'image/png', transparent: true, maxZoom: 22, opacity: l.doorzichtigheid ?? 0.75, attribution: l.naamsvermelding || '' });
    if (l.type === 'wmts') return L.tileLayer(l.url, { maxZoom: 22, maxNativeZoom: l.maxNativeZoom || 19, opacity: l.doorzichtigheid ?? 0.75, attribution: l.naamsvermelding || '' });
    if (l.type === 'geojson') {
      const gj = Lagen.data[l.id]; if (!gj) { Lagen.haalData(l); return null; }
      const kleur = l.kleur || '#f2b630';
      const verboden = l.groep === 'veiligheid';
      return L.geoJSON(gj, {
        renderer: Lagen.canvas,
        attribution: l.naamsvermelding || '',
        style: f => (f && f.geometry && /Point/.test(f.geometry.type)) ? { radius: 8, color: '#000', weight: 1.5, fillColor: kleur, fillOpacity: .95 } : ({ color: kleur, weight: verboden ? 2 : 3, opacity: .95, fillColor: kleur, fillOpacity: verboden ? .28 : .18, dashArray: verboden ? '6 5' : null }),
        pointToLayer: (f, ll) => L.circleMarker(ll, { renderer: Lagen.canvas, radius: 8, color: '#000', weight: 1.5, fillColor: kleur, fillOpacity: .95 }),
        onEachFeature: (f, laag) => {
          const p = f.properties || {};
          const tijd = [jaar(p.van), jaar(p.tot)].filter(Boolean).join(' – ');
          const meta = [p.soort, PERIODES[p.periode] || p.periode, tijd].filter(Boolean).join(' · ');
          laag.bindPopup(`<div class="lpop"><b>${esc(p.naam || l.naam)}</b><div class="m">${esc(meta)}</div>${p.beschrijving ? esc(p.beschrijving) : ''}` +
            `${p.zekerheid ? `<div class="b">Zekerheid plek: ${esc(p.zekerheid)}${p.nauwkeurigheid_m ? ' (± ' + esc(p.nauwkeurigheid_m) + ' m)' : ''}</div>` : ''}` +
            `${p.bijgewerkt ? `<div class="b">Peildatum: ${esc(p.bijgewerkt)}</div>` : ''}` +
            `<div class="b">Bron: ${p.bron_url ? `<a href="${esc(p.bron_url)}" target="_blank" rel="noopener">${esc(p.bron || 'link')}</a>` : esc(p.bron || l.bron || '')}${p.licentie || l.licentie ? ' · ' + esc(p.licentie || l.licentie) : ''}</div></div>`);
        },
      });
    }
    return null;
  },
  bijwerken(){
    const map = Lagen.map; if (!map) return;
    const z = map.getZoom();
    for (const l of Lagen.lijst) {
      const moet = Lagen.aan(l) && z >= (l.minZoom || 0) && Lagen.vakInBeeld(l);
      let k = Lagen.kaartLagen[l.id];
      if (moet && !k) { k = Lagen.maakLaag(l); if (k) { Lagen.kaartLagen[l.id] = k; k.addTo(map); if (l.type !== 'geojson') { k.bringToBack(); Kaart.lagen[Kaart.laag].bringToBack(); } } }
      else if (moet && k && !map.hasLayer(k)) k.addTo(map);
      else if (!moet && k && map.hasLayer(k)) map.removeLayer(k);
    }
    Kaart.routeLaag && Kaart.routeLaag.eachLayer(x => x.bringToFront && x.bringToFront());
    Kaart.vondstLaag && Kaart.vondstLaag.eachLayer(x => x.bringToFront && x.bringToFront());
  },
  wissel(id){
    const l = Lagen.lijst.find(x => x.id === id); if (!l) return;
    if (l.uitzetbaar === false) return melding('Deze veiligheidslaag staat altijd aan');
    localStorage.setItem('v_laag_' + id, Lagen.aan(l) ? '0' : '1');
    if (Lagen.aan(l) && l.type === 'geojson') Lagen.haalData(l);
    if (Lagen.aan(l) && Lagen.map && l.minZoom && Lagen.map.getZoom() < l.minZoom) melding('Zoom verder in om deze laag te zien');
    Lagen.bijwerken(); Lagen.toonMenu();
  },
  toonMenu(){
    const el = $('#lagenLijst'); if (!el) return;
    if (!Lagen.lijst.length) { el.innerHTML = '<div class="leeg">Er zijn nog geen historische lagen.<br>Zodra Nova de eerste levert, verschijnen ze hier.</div>'; return; }
    const z = Lagen.map ? Lagen.map.getZoom() : 99;
    const veilig = Lagen.lijst.filter(l => l.groep === 'veiligheid');
    const rest = Lagen.lijst.filter(l => l.groep !== 'veiligheid');
    let html = Lagen.dekking ? `<div class="dekking">${esc(Lagen.dekking)}</div>` : '';
    if (veilig.length) {
      const gebieden = veilig.map(l => l.naam.split(' · ')[0]).filter(n => n !== 'grensgebied');
      html += `<div class="lgroep">Veiligheid</div><div class="lrij aan vast"><span class="kl" style="background:#ff3b30"></span>
        <span class="nm">Hier mag je niet zoeken<small>Staat altijd aan · ${esc(gebieden.join(', '))}</small></span><span class="schakel"></span></div>`;
    }
    const groepen = {};
    for (const l of rest) (groepen[l.groep || 'overig'] = groepen[l.groep || 'overig'] || []).push(l);
    const volgorde = ['periode', 'historische-kaart', ...Object.keys(groepen)].filter((g, i, a) => groepen[g] && a.indexOf(g) === i);
    html += volgorde.map(g => `<div class="lgroep">${esc(GROEPEN[g] || g)}</div>` + groepen[g].map(l => {
      const aan = Lagen.aan(l);
      const sub = [l.periode && PERIODES[l.periode] !== l.naam && PERIODES[l.periode], aan && l.minZoom && z < l.minZoom ? 'zoom verder in' : ''].filter(Boolean).join(' · ');
      return `<button class="lrij ${aan ? 'aan' : ''}" data-laag="${esc(l.id)}">
        <span class="kl" style="background:${esc(l.kleur || '#888')}"></span>
        <span class="nm">${esc(l.naam)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="schakel"></span></button>`;
    }).join('')).join('');
    el.innerHTML = html;
    el.querySelectorAll('button[data-laag]').forEach(b => b.onclick = () => Lagen.wissel(b.dataset.laag));
  },
  // waarschuwing als je een 'niet zoeken'-gebied binnenloopt, en grijs als we voor deze plek geen gegevens hebben
  async check(fix, direct){
    if (!direct && Date.now() - Lagen.laatsteCheck < 4000) return;
    Lagen.laatsteCheck = Date.now();
    const veilig = Lagen.lijst.filter(l => l.groep === 'veiligheid');
    if (!veilig.length) return;
    const dichtbij = veilig.filter(l => Lagen.inVak(l, fix.lon, fix.lat, 0.05));
    for (const l of dichtbij) if (!Lagen.data[l.id]) await Lagen.haalData(l);
    let treffer = '';
    for (const l of dichtbij) {
      const gj = Lagen.data[l.id]; if (!gj) continue;
      for (const f of gj.features || []) {
        const b = f._bb;
        if (b && (fix.lon < b[0] || fix.lon > b[2] || fix.lat < b[1] || fix.lat > b[3])) continue;
        if (inGebied([fix.lon, fix.lat], f.geometry)) { treffer = (f.properties && f.properties.naam) || l.naam; break; }
      }
      if (treffer) break;
    }
    const geenGegevens = !veilig.some(l => Lagen.inVak(l, fix.lon, fix.lat, 0.03));
    const b = $('#nietZoeken');
    b.classList.toggle('grijs', !treffer && geenGegevens);
    if (treffer) {
      b.innerHTML = '⛔ Je bent in een gebied waar je <b>niet mag zoeken</b><small>' + esc(treffer) + '</small>';
      b.classList.add('open');
      if (Lagen.gewaarschuwd !== treffer) { Lagen.gewaarschuwd = treffer; tril([300, 120, 300]); piep(440, .3); melding('⛔ Hier mag je niet zoeken: ' + treffer, 5000); }
    } else if (geenGegevens) {
      b.innerHTML = 'Geen verbodsgegevens voor deze plek<small>Check zelf de regels van de gemeente en vraag de grondeigenaar.</small>';
      b.classList.add('open'); Lagen.gewaarschuwd = '';
    } else { b.classList.remove('open'); Lagen.gewaarschuwd = ''; }
  },
};
function vakVan(g){
  if (!g) return null;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  (function loop(x){ if (typeof x[0] === 'number') { if (x[0] < a) a = x[0]; if (x[0] > c) c = x[0]; if (x[1] < b) b = x[1]; if (x[1] > d) d = x[1]; } else x.forEach(loop); })(g.coordinates || []);
  return [a, b, c, d];
}
function inRing(pt, ring){
  let binnen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) binnen = !binnen;
  }
  return binnen;
}
function inPolygoon(pt, rings){ return inRing(pt, rings[0]) && !rings.slice(1).some(r => inRing(pt, r)); }
function inGebied(pt, g){
  if (!g) return false;
  if (g.type === 'Polygon') return inPolygoon(pt, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some(p => inPolygoon(pt, p));
  if (g.type === 'GeometryCollection') return g.geometries.some(x => inGebied(pt, x));
  return false;
}
window.Lagen = Lagen;
$('#lagenKnop').onclick = () => { Lagen.toonMenu(); $('#lagenPaneel').classList.add('open'); };
$('#lagenDicht').onclick = () => $('#lagenPaneel').classList.remove('open');

/* ================= LIJST ================= */
let filter = 'alle';
const statusLabel = {
  herkend: ['l-herkend', 'Herkend'], onzeker: ['l-onzeker', 'Onzeker'], gevaar: ['l-gevaar', 'GEVAAR'],
  speld: ['l-pan', '📍 Speld · foto toevoegen'], wacht: ['l-wacht', 'Wacht op AI'], bezig: ['l-wacht', 'Bezig…'], geenkey: ['l-wacht', 'Geen AI-sleutel'], pro: ['l-onzeker', 'Herkennen met Pro'],
};
async function toonLijst(){
  let alle = (await DB.all('finds')).sort((a, b) => b.t - a.t);
  if (filter === 'onzeker') alle = alle.filter(f => f.status === 'onzeker');
  if (filter === 'wacht') alle = alle.filter(f => ['wacht', 'geenkey', 'bezig'].includes(f.status));
  if (filter === 'gevaar') alle = alle.filter(f => f.status === 'gevaar');
  if (filter === 'pan') alle = alle.filter(f => f.panGemeld);
  if (filter === 'speld') alle = alle.filter(f => f.status === 'speld');
  const routeNamen = {}; (await DB.all('tracks')).forEach(t => { if (t.naam) routeNamen[t.id] = t.naam; });
  const l = $('#lijst');
  if (!alle.length) { l.innerHTML = '<div class="leeg">Nog geen vondsten hier.<br>Ga naar Zoeken en druk op de gouden knop.</div>'; return; }
  l.innerHTML = alle.map(f => {
    const naam = f.eigenNaam || (f.ai && f.ai.naam) || (f.status === 'speld' ? 'Speld (nog geen foto)' : 'Nog niet herkend');
    const sub = f.ai ? [f.ai.periode, f.ai.materiaal].filter(Boolean).join(' · ') : '';
    const rt = f.sessie && routeNamen[f.sessie];
    const waar = f.eigenPlek || (rt ? rt + (f.plek && f.plek.plaats ? ', ' + f.plek.plaats : '') : Plek.kort(f.plek));
    const [kl, tk] = statusLabel[f.status] || statusLabel.wacht;
    return `<button class="kaartje ${f.status === 'gevaar' ? 'gevaar' : ''}" onclick="openDetail('${f.id}')">
      <img src="${fotoSrc(f)}" alt="">
      <div><div class="naam">${esc(naam)}</div><div class="sub">${esc(sub)}</div><div class="sub">${esc(datumTekst(f.t))}${waar ? ' · 📍 ' + esc(waar) : ''}</div>
      <span class="label ${kl}">${tk}${f.ai && f.status !== 'gevaar' ? ' · ' + f.ai.zekerheid + '%' : ''}</span>${f.panGemeld ? '<span class="label l-pan">PAN</span>' : ''}</div>
    </button>`;
  }).join('');
}
$('#speldChip').onclick = e => {
  e.stopPropagation(); filter = 'speld';
  $$('#filters button').forEach(x => x.classList.toggle('aan', x.dataset.f === 'speld'));
  kiesScherm('vondsten');
};
$('#filters').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f; $$('#filters button').forEach(x => x.classList.toggle('aan', x === b)); toonLijst();
};

/* ================= DETAIL ================= */
function veiligBalk(a){
  const munitie = /munitie|granaat|kogel|patroon|huls|ontsteker|mortier|fosfor/i.test([a.categorie, a.naam, a.merk_model].join(' '));
  if (a.veiligheid === 'gevaarlijk') return `<div class="veiligbalk v-gevaarlijk">⚠️ Mogelijk gevaarlijk. Raak het niet aan, verplaats het niet. Ga op afstand en waarschuw de politie. <button class="groot" style="margin-top:8px;width:100%;background:#fff;color:#b3140e" onclick="toonGevaar(null, true)">Alarmnummers tonen</button><div style="font-weight:500;margin-top:6px">${esc(a.veiligheid_uitleg || '')}</div></div>`;
  if (munitie || a.veiligheid === 'voorzichtig') return `<div class="veiligbalk v-voorzichtig">⚠️ ${munitie ? 'Dit lijkt munitie of een deel daarvan.' : 'Voorzichtig.'} De herkenning kan zich vergissen: twijfel je, raak het dan niet aan en bel de politie.<div style="font-weight:500;margin-top:6px">${esc(a.veiligheid_uitleg || '')}</div></div>`;
  return `<div class="veiligbalk v-veilig">✓ Geen munitie herkend. ${esc(a.veiligheid_uitleg || '')}</div>`;
}
async function openDetail(id){
  const f = await DB.get('finds', id); if (!f) return;
  const route = f.sessie ? await DB.get('tracks', f.sessie) : null;
  const d = $('#detail'); d.dataset.id = id;
  const a = f.ai || {};
  const naam = f.eigenNaam || a.naam || (f.status === 'speld' ? 'Speld (nog geen foto)' : 'Nog niet herkend');
  const [kl, tk] = statusLabel[f.status] || statusLabel.wacht;
  const rij = (k, v) => v ? `<div class="rij"><span>${k}</span><span>${esc(v)}</span></div>` : '';
  d.innerHTML = `
    <div class="terug"><button onclick="sluitDetail()">← Terug</button><div style="font-weight:800;font-size:18px">${esc(naam)}</div></div>
    <div class="fotos">${!f.fotos.length ? `<figure><img src="${SPELD_IMG}" alt=""><figcaption>Speld gezet met je stem (${esc(datumTekst(f.t))}). Voeg hieronder een foto toe, dan wordt hij herkend.</figcaption></figure>` : ''}${f.fotos.map((p, i) => `<figure><img src="${fotoUrl(p.blob, f.id + p.t)}" alt=""><figcaption>Foto ${i + 1} · ${p.soort === 'veld' ? 'in het veld' : 'thuis / schoon'} · ${esc(datumTekst(p.t))}</figcaption></figure>`).join('')}</div>
    ${a.veiligheid ? veiligBalk(a) : ''}
    <div class="blok">
      <h3>Wat is het?</h3>
      <span class="label ${kl}">${tk}</span>
      ${a.zekerheid != null ? `<div style="margin-top:8px;font-size:14px;color:var(--zacht)">Zekerheid ${a.zekerheid}%</div><div class="balk"><div style="width:${+a.zekerheid || 0}%"></div></div>` : ''}
      ${a.beschrijving ? `<p>${esc(a.beschrijving)}</p>` : f.status === 'speld' ? '<p>Voeg een foto toe, dan wordt deze vondst herkend.</p>' : f.status === 'geenkey' ? '<p>Zet je OpenAI-sleutel in Instellingen, dan wordt deze vondst herkend.</p>' : f.status === 'pro' ? '<p>Je gratis herkenningen zijn op.</p><button class="groot goud" style="width:100%" onclick="Pro.open()">⭐ Herken met Vondst Pro</button>' : f.fout ? `<p>Laatste poging mislukte: ${esc(f.fout)}</p>` : '<p>Nog niet herkend.</p>'}
      ${rij('Categorie', a.categorie)}${rij('Periode', a.periode)}${rij('Datering', a.datering)}${rij('Materiaal', a.materiaal)}${rij('Merk / model', a.merk_model)}${rij('Zeldzaamheid', a.zeldzaamheid)}${rij('Waarde (grof)', a.waarde_indicatie)}
    </div>
    ${a.herkenningstekens ? `<div class="blok"><h3>Waaraan herkend</h3><p>${esc(a.herkenningstekens)}</p></div>` : ''}
    ${a.alternatieven && a.alternatieven.length ? `<div class="blok"><h3>Kan ook zijn</h3><p>${a.alternatieven.map(esc).join('<br>')}</p></div>` : ''}
    ${a.foto_advies ? `<div class="blok"><h3>Tip voor een betere foto</h3><p>${esc(a.foto_advies)}</p></div>` : ''}
    ${a.schoonmaak_advies ? `<div class="blok"><h3>Schoonmaken</h3><p>${esc(a.schoonmaak_advies)}</p></div>` : ''}
    <div class="knoppen">
      <button class="groot kleur kgoud breed" onclick="extraFoto('${f.id}')">${f.fotos.length ? '📷 Nieuwe foto toevoegen (schoongemaakt)' : '📷 Foto toevoegen'}</button>
      <button class="groot kleur kpaars" onclick="Herken.wachtrij('${f.id}')">🔄 Opnieuw herkennen</button>
      <button class="groot kleur kblauw" onclick="toonOpKaart('${f.id}')">🗺️ Op de kaart</button>
      <button class="groot rood breed" onclick="toonGevaar(null, true)">⚠️ Dit kan munitie zijn</button>
      <button class="groot kleur kgroen breed" onclick="meldPan('${f.id}')">🏛️ ${f.panGemeld ? 'Gemeld bij PAN ✓ (opnieuw openen)' : 'Melden bij PAN (jouw keuze)'}</button>
    </div>
    <div class="blok">
      <h3>Vindplek</h3>
      ${f.eigenPlek || route && route.naam ? `<p style="font-weight:800;font-size:17px">📍 ${esc(f.eigenPlek || route.naam)}</p>` : ''}
      ${f.plek ? `<p>${esc(Plek.lang(f.plek))}</p>` + (f.plek.perceel ? rij('Kadastraal perceel', f.plek.perceel) : '') : (f.lat != null ? '<p class="uitleg">Plaatsnaam wordt opgezocht zodra je internet hebt…</p>' : '')}
      ${f.lat != null ? rij('Coördinaten', f.lat.toFixed(6) + ', ' + f.lon.toFixed(6)) + rij('Nauwkeurigheid', '± ' + f.acc + ' m' + (f.gpsMetingen ? ' (' + f.gpsMetingen + ' metingen)' : '')) : '<p>Geen GPS-plek opgeslagen.</p>'}
      ${rij('Datum en tijd', datumTekst(f.t))}
    </div>
    <div class="blok">
      <h3>Eigen gegevens</h3>
      <div class="veld"><label>Eigen naam (overschrijft de AI)</label><input id="dNaam" value="${esc(f.eigenNaam)}"></div>
      <div class="veld"><label>Naam van de plek (bijv. "Akker boer Jansen")</label><input id="dPlek" value="${esc(f.eigenPlek || '')}"></div>
      <div class="veld"><label>Diepte in cm</label><input id="dDiepte" inputmode="numeric" value="${esc(f.diepte)}"></div>
      <div class="veld"><label>Notitie</label><textarea id="dNotitie" rows="3">${esc(f.notitie)}</textarea></div>
      <button class="groot kleur kgroen" style="width:100%" onclick="bewaarEigen('${f.id}')">Opslaan</button>
    </div>
    <div class="knoppen"><button class="groot kleur krood breed" onclick="verwijder('${f.id}')">🗑️ Vondst verwijderen</button></div>
    ${a.model ? `<p class="uitleg" style="padding:0 16px">Herkend door ${esc(a.model)} op ${esc(datumTekst(a.tijd))}</p>` : ''}
  `;
  d.classList.add('open');
}
function sluitDetail(){ $('#detail').classList.remove('open'); if (huidigScherm === 'vondsten') toonLijst(); }
async function bewaarEigen(id){
  const f = await DB.get('finds', id);
  f.eigenPlek = $('#dPlek').value.trim();
  f.eigenNaam = $('#dNaam').value.trim(); f.diepte = $('#dDiepte').value.trim(); f.notitie = $('#dNotitie').value.trim();
  await DB.put('finds', f); melding('Opgeslagen'); openDetail(id); Kaart.verversVondsten();
}
async function extraFoto(id){
  const blob = await vraagFoto(); if (!blob) return;
  const f = await DB.get('finds', id);
  f.fotos.push({ blob: await verkleinFoto(blob, 1800, 0.88), t: Date.now(), soort: f.status === 'speld' ? 'veld' : 'thuis' });
  if (f.status === 'speld') f.status = 'wacht';
  await DB.put('finds', f);
  melding('Foto toegevoegd, opnieuw herkennen…');
  toonSpeldChip();
  openDetail(id);
  Herken.wachtrij(id);
}
async function verwijder(id){
  if (!confirm('Deze vondst echt verwijderen?')) return;
  await DB.del('finds', id); sluitDetail(); Kaart.verversVondsten(); melding('Verwijderd');
}
async function meldPan(id){
  const f = await DB.get('finds', id); const a = f.ai || {};
  const tekst = [
    'Vondst: ' + (f.eigenNaam || a.naam || 'onbekend'),
    a.categorie && 'Categorie: ' + a.categorie, a.periode && 'Periode: ' + a.periode, a.datering && 'Datering: ' + a.datering,
    a.materiaal && 'Materiaal: ' + a.materiaal, 'Datum vondst: ' + new Date(f.t).toLocaleDateString('nl-NL'),
    f.plek && 'Vindplaats: ' + Plek.lang(f.plek), f.plek && f.plek.perceel && 'Kadastraal perceel: ' + f.plek.perceel,
    f.lat != null && 'Coördinaten (WGS84): ' + f.lat.toFixed(6) + ', ' + f.lon.toFixed(6) + ' (± ' + f.acc + ' m)',
    f.diepte && 'Diepte: ' + f.diepte + ' cm', a.beschrijving && 'Beschrijving: ' + a.beschrijving, f.notitie && 'Notitie: ' + f.notitie,
  ].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(tekst); melding('Gegevens gekopieerd. Plak ze in het PAN-formulier.', 4000); } catch (e) { prompt('Kopieer deze gegevens:', tekst); }
  window.open('https://portable-antiquities.nl/pan/#/public/melden', '_blank');
  if (!f.panGemeld && confirm('Heb je deze vondst bij PAN gemeld? (Dan krijgt hij het label PAN.)')) {
    f.panGemeld = Date.now(); await DB.put('finds', f); openDetail(id);
  }
}
Object.assign(window, { openDetail, sluitDetail, bewaarEigen, extraFoto, verwijder, meldPan, toonOpKaart, Herken });

/* ================= INSTELLINGEN ================= */
function toonInstellingen(){
  Pro.toonBlok();
  if (NATIEF) {
    $('#uitlegKnop').textContent = 'de volumeknoppen van je telefoon en een bluetooth-sluiterknopje maken ook een foto (op het zoekscherm). Stem: zeg "hebbes" of "vondst"; met je telefoon op slot zet hij een speld.';
    const v = $('#uitlegVersie'); v.textContent = 'Android-app: de route loopt door met het scherm uit en de telefoon in je zak. Je ziet dan een melding "Vondst houdt je route bij". Stem werkt ook met het scherm uit: dan zet hij een speld op de kaart (trilt twee keer).';
    v.previousElementSibling.textContent = 'Over deze app';
  }
  $('#keyInput').value = instel.key ? '••••••••' + instel.key.slice(-4) : '';
  $('#aiTeller').textContent = instel.aiTeller;
  $('#heelScherm').checked = instel.heelScherm;
  const sel = $('#modelSelect');
  if (instel.model && !Array.from(sel.options).some(o => o.value === instel.model)) sel.add(new Option(instel.model, instel.model));
  sel.value = instel.model;
}
$('#keyInput').onfocus = e => { if (e.target.value.startsWith('••')) e.target.value = ''; };
$('#keyOpslaan').onclick = async () => {
  const v = $('#keyInput').value.trim();
  if (v && !v.startsWith('••')) instel.key = v;
  if (!instel.key) return melding('Vul eerst je sleutel in');
  $('#keyStatus').textContent = 'Testen…';
  try {
    const lijst = await Herken.modellen();
    instel.model = '';
    const m = await Herken.kiesModel();
    const sel = $('#modelSelect'); sel.innerHTML = '<option value="">Automatisch kiezen</option>';
    lijst.filter(x => /^gpt-(5|4\.1|4o)/.test(x) && !/(audio|realtime|search|transcribe|tts|image)/.test(x)).forEach(x => sel.add(new Option(x, x)));
    sel.value = m;
    $('#keyStatus').innerHTML = '✅ Sleutel werkt. Gekozen model: <b>' + esc(m) + '</b>';
    toonInstellingen();
    Herken.allesWachtend();
  } catch (e) { $('#keyStatus').textContent = '❌ ' + e.message; }
};
$('#keyWis').onclick = () => { instel.key = ''; instel.model = ''; $('#keyStatus').textContent = 'Sleutel gewist'; toonInstellingen(); };
$('#modelSelect').onchange = e => { instel.model = e.target.value; };
$('#heelScherm').onchange = e => { instel.heelScherm = e.target.checked; };

function download(naam, inhoud, type){
  const b = inhoud instanceof Blob ? inhoud : new Blob([inhoud], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = naam; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const vandaag = () => new Date().toISOString().slice(0, 10);
$('#exportJson').onclick = async () => {
  melding('Back-up maken…');
  const finds = await DB.all('finds');
  for (const f of finds) f.fotos = await Promise.all(f.fotos.map(async p => ({ ...p, blob: await blobNaarDataUrl(p.blob) })));
  download('vondsten-backup-' + vandaag() + '.json', JSON.stringify({ versie: 1, finds, tracks: await DB.all('tracks') }), 'application/json');
};
$('#importKnop').onclick = () => $('#importBestand').click();
$('#importBestand').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    for (const f of d.finds || []) { f.fotos = await Promise.all(f.fotos.map(async p => ({ ...p, blob: await dataUrlNaarBlob(p.blob) }))); await DB.put('finds', f); }
    for (const t of d.tracks || []) await DB.put('tracks', t);
    melding('Back-up teruggezet: ' + (d.finds || []).length + ' vondsten'); Kaart.verversRoutes(); Kaart.verversVondsten();
  } catch (err) { melding('Dit bestand kon ik niet lezen'); }
};
$('#exportCsv').onclick = async () => {
  const finds = (await DB.all('finds')).sort((a, b) => a.t - b.t);
  const kol = ['datum', 'naam', 'categorie', 'periode', 'datering', 'materiaal', 'zekerheid', 'veiligheid', 'lat', 'lon', 'nauwkeurigheid_m', 'diepte_cm', 'notitie', 'pan_gemeld'];
  const c = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const rijen = finds.map(f => { const a = f.ai || {}; return [new Date(f.t).toLocaleString('nl-NL'), f.eigenNaam || a.naam, a.categorie, a.periode, a.datering, a.materiaal, a.zekerheid, a.veiligheid, f.lat, f.lon, f.acc, f.diepte, f.notitie, f.panGemeld ? 'ja' : ''].map(c).join(';'); });
  download('vondsten-' + vandaag() + '.csv', '﻿' + kol.join(';') + '\n' + rijen.join('\n'), 'text/csv');
};
$('#exportGpx').onclick = async () => {
  const finds = await DB.all('finds'), tracks = await DB.all('tracks');
  const x = s => esc(s);
  let g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Vondst" xmlns="http://www.topografix.com/GPX/1/1">\n';
  for (const f of finds) if (f.lat != null) g += `<wpt lat="${f.lat}" lon="${f.lon}"><time>${new Date(f.t).toISOString()}</time><name>${x(f.eigenNaam || (f.ai && f.ai.naam) || 'Vondst')}</name><desc>${x((f.ai && f.ai.beschrijving) || '')}</desc></wpt>\n`;
  for (const t of tracks) if (t.punten.length > 1) g += `<trk><name>Route ${x(datumTekst(t.start))}</name>${segmenten(t.punten).delen.filter(d => d.length > 1).map(d => `<trkseg>${d.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[3]).toISOString()}</time></trkpt>`).join('')}</trkseg>`).join('')}</trk>\n`;
  download('vondsten-' + vandaag() + '.gpx', g + '</gpx>', 'application/gpx+xml');
};
$('#allesWissen').onclick = async () => {
  if (!confirm('ALLE vondsten en routes wissen? Dit kan niet ongedaan worden.')) return;
  if (!confirm('Echt zeker? Maak eventueel eerst een back-up.')) return;
  await DB.clear('finds'); await DB.clear('tracks'); Route.sessie = null; localStorage.removeItem('v_route'); Route.toon();
  Kaart.verversRoutes(); Kaart.verversVondsten(); toonLijst(); melding('Alles gewist');
};

/* ================= TERUGKNOP ================= */
// Eén stap terug: eerst open schermpjes sluiten, dan naar het zoekscherm. Op het zoekscherm gaat de app naar de achtergrond (route loopt door).
function terug(){
  if ($('#pro').classList.contains('open')) { Pro.dicht(); return true; }
  if ($('#uitleg').classList.contains('open')) { Uitleg.dicht(); return true; }
  if ($('#gevaar').classList.contains('open')) { $('#gevaar').classList.remove('open'); return true; }
  if ($('#detail').classList.contains('open')) { sluitDetail(); return true; }
  if ($('#lagenPaneel').classList.contains('open')) { $('#lagenPaneel').classList.remove('open'); return true; }
  if ($('#routesPaneel').classList.contains('open')) { $('#routesPaneel').classList.remove('open'); return true; }
  if ($('#kleurKeuze').classList.contains('open')) { $('#kleurKeuze').classList.remove('open'); return true; }
  if (huidigScherm !== 'zoeken') { kiesScherm('zoeken'); return true; }
  return false;
}
const opBasis = () => huidigScherm === 'zoeken' && !['#pro', '#uitleg', '#gevaar', '#detail', '#lagenPaneel', '#routesPaneel', '#kleurKeuze'].some(x => $(x).classList.contains('open'));
if (NATIEF) {
  const App = plugin('App');
  App.addListener('backButton', () => { if (!terug()) App.minimizeApp(); });
} else {
  // In de browser: de terugknop van de telefoon gaat ook eerst terug binnen de app
  history.replaceState({ basis: 1 }, '');
  const bewaak = () => { if (!opBasis() && !(history.state && history.state.diep)) history.pushState({ diep: 1 }, ''); };
  window.addEventListener('popstate', () => { terug(); setTimeout(bewaak, 0); });
  setInterval(bewaak, 500);
}

/* ================= VONDST PRO (proefweergave, nog zonder echte betaling) ================= */
const GRATIS = 10;
const Pro = {
  get klant(){ return localStorage.getItem('v_klantweergave') === '1'; },
  set klant(v){ localStorage.setItem('v_klantweergave', v ? '1' : '0'); },
  get actief(){ return localStorage.getItem('v_pro') === '1'; },
  set actief(v){ localStorage.setItem('v_pro', v ? '1' : '0'); },
  get gebruikt(){ return +(localStorage.getItem('v_gratis_gebruikt') || 0); },
  set gebruikt(v){ localStorage.setItem('v_gratis_gebruikt', String(v)); },
  // Mag deze herkenning? Alleen in klantweergave wordt er geteld.
  mag(){ return !Pro.klant || Pro.actief || Pro.gebruikt < GRATIS; },
  tel(){ if (Pro.klant && !Pro.actief) Pro.gebruikt = Pro.gebruikt + 1; },
  over(){ return Math.max(0, GRATIS - Pro.gebruikt); },
  plan: 'jaar',
  open(){ $('#pro').classList.add('open'); },
  dicht(){ $('#pro').classList.remove('open'); },
  toonBlok(){
    const b = $('#proBlok'); if (!b) return;
    if (!Pro.klant) {
      b.innerHTML = `<h3>Vondst Pro <span class="pro-badge">voorbeeld</span></h3>
        <p class="uitleg">Jij gebruikt nu je eigen OpenAI-sleutel, dus voor jou is herkennen onbeperkt. Wil je zien hoe een klant de app ziet: gratis versie met ${GRATIS} herkenningen, daarna Vondst Pro?</p>
        <div class="knoppen" style="margin:0"><button class="groot goud breed" onclick="Pro.zetKlant(true)">👀 Bekijk als klant</button><button class="groot breed" onclick="Pro.open()">Toon het Pro-scherm</button></div>`;
      return;
    }
    const over = Pro.over();
    b.innerHTML = Pro.actief
      ? `<h3>Vondst Pro <span class="pro-badge">actief</span></h3><p class="uitleg">Onbeperkt herkennen staat aan (proef: zonder echte betaling).</p>
         <div class="knoppen" style="margin:0"><button class="groot breed" onclick="Pro.zetPro(false)">Pro uitzetten (test)</button><button class="groot breed" onclick="Pro.zetKlant(false)">Terug naar mijn eigen weergave</button></div>`
      : `<h3>Gratis versie</h3><p class="uitleg">Nog <b>${over} van ${GRATIS}</b> gratis herkenningen over.</p>
         <div class="pro-teller"><div style="width:${over / GRATIS * 100}%"></div></div>
         <div class="knoppen" style="margin:0"><button class="groot goud breed" onclick="Pro.open()">⭐ Bekijk Vondst Pro</button>
         <button class="groot" onclick="Pro.gebruikt = 0; Pro.toonBlok()">Teller op 0 (test)</button><button class="groot" onclick="Pro.zetKlant(false)">Eigen weergave</button></div>`;
  },
  zetKlant(v){ Pro.klant = v; Pro.toonBlok(); melding(v ? 'Je ziet de app nu zoals een klant' : 'Terug naar je eigen weergave'); },
  zetPro(v){ Pro.actief = v; Pro.toonBlok(); },
};
window.Pro = Pro;
$('#proDicht').onclick = () => Pro.dicht();
$$('.pro-optie').forEach(b => b.onclick = () => { Pro.plan = b.dataset.plan; $$('.pro-optie').forEach(x => x.classList.toggle('gekozen', x === b)); });
$('#proStart').onclick = () => {
  Pro.dicht();
  if (Pro.klant) { Pro.actief = true; Pro.toonBlok(); melding('Proefversie: Vondst Pro staat aan. Echt betalen komt via Google Play.', 4500); Herken.allesWachtend(); }
  else melding('Dit is een voorbeeld. Echt betalen komt via Google Play.', 4000);
};

/* ================= UITLEG ================= */
const Uitleg = {
  stap: 0,
  dias(){
    const knop = NATIEF ? 'de <b>gouden knop</b>, de <b>volumeknop</b> van je telefoon of een bluetooth-knopje' : 'de <b>gouden knop</b> op het scherm';
    return [
      { ico: '🪙', titel: 'Welkom bij Vondst', tekst: '<p>Leg je vondsten vast met één druk op de knop. De app bewaart de <b>foto, de plek, de datum en de tijd</b> en vertelt je wat je gevonden hebt.</p>' },
      { ico: '📸', titel: 'Een vondst vastleggen', tekst: `<p>Ga naar <b>Zoeken</b>. Leg je vondst in het <b>gouden vak</b> en druk op ${knop}.</p><p>Klaar. De rest gaat vanzelf.</p>` },
      NATIEF
        ? { ico: '🎤', titel: 'Vieze handen? Gebruik je stem', tekst: '<p>Tik bovenin op <b>Stem</b>. Zeg dan:</p><p><span class="u-zeg">hebbes</span> <span class="u-zeg">vondst</span> <span class="u-zeg">gevonden</span></p><p>Staat de app open op Zoeken, dan maakt hij <b>meteen een foto</b>.</p><p>Zit je telefoon in je zak of op slot, dan zet hij een <b>📍 speld</b> op de kaart en trilt hij twee keer. De foto voeg je later toe. Dit werkt ook zonder internet.</p>' }
        : { ico: '🎤', titel: 'Vieze handen? Gebruik je stem', tekst: '<p>Tik bovenin op <b>Stem</b>. Als het blauw is, luistert de app. Zeg dan:</p><p><span class="u-zeg">hebbes</span> <span class="u-zeg">vondst</span> <span class="u-zeg">foto</span></p><p>De app maakt meteen een foto. Stem blijft aan, ook als je de app later weer opent.</p>' },
      { ico: '🧭', titel: 'Je route op de kaart', tekst: `<p>Tik op <b>Route</b> voordat je begint. Op de <b>Kaart</b> zie je dan precies waar je gelopen hebt en waar je wat vond.</p><p>${NATIEF ? 'De route loopt door met het scherm uit en de telefoon in je zak.' : 'Houd de app open, dan blijft de route meelopen.'} Met de paarse knop 🧭 op de kaart geef je routes een naam of verwijder je ze.</p>` },
      { ico: '⛔', titel: 'Veilig en volgens de regels', tekst: '<div class="u-lijst"><div><b>Rood op de kaart</b>: hier mag je niet zoeken. Loop je erin, dan waarschuwt de app.</div><div><b>Rode ⚠️-knop</b>: denk je dat het munitie is? Raak het niet aan en druk op deze knop voor de alarmnummers.</div><div>Vraag altijd <b>toestemming aan de grondeigenaar</b>.</div></div>' },
      { ico: '🔍', titel: 'Wat heb ik gevonden?', tekst: '<p>Zet bij <b>Instellingen</b> je OpenAI-sleutel. Dan herkent de app je vondst: wat het is, hoe oud en van welk materiaal.</p><p>Was de foto vies? Maak thuis een <b>nieuwe foto als hij schoon is</b>. De app kijkt dan opnieuw.</p>' },
      { ico: '🏛️', titel: 'Klaar om te zoeken!', tekst: '<p>Bij een oude vondst kun je hem met één knop <b>melden bij PAN</b>, als je dat wilt.</p><p>Deze uitleg vind je altijd terug bij <b>Instellingen</b>. Veel succes en mooie vondsten!</p>' },
    ];
  },
  open(){ Uitleg.stap = 0; Uitleg.toon(); $('#uitleg').classList.add('open'); },
  dicht(){ $('#uitleg').classList.remove('open'); localStorage.setItem('v_uitleg_gezien', '1'); },
  toon(){
    const d = Uitleg.dias(), x = d[Uitleg.stap];
    $('#uDia').innerHTML = `<div class="u-ico">${x.ico}</div><h2>${x.titel}</h2>${x.tekst}`;
    $('#uStippen').innerHTML = d.map((_, i) => `<i class="${i === Uitleg.stap ? 'aan' : ''}"></i>`).join('');
    const laatste = Uitleg.stap === d.length - 1;
    $('#uVolgende').textContent = laatste ? 'Beginnen' : 'Volgende';
    $('#uOverslaan').textContent = Uitleg.stap ? 'Terug' : 'Overslaan';
  },
};
$('#uVolgende').onclick = () => { if (Uitleg.stap >= Uitleg.dias().length - 1) Uitleg.dicht(); else { Uitleg.stap++; Uitleg.toon(); } };
$('#uOverslaan').onclick = () => { if (Uitleg.stap) { Uitleg.stap--; Uitleg.toon(); } else Uitleg.dicht(); };
(() => { // vegen tussen de dia's
  let x0 = null;
  $('#uitleg').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  $('#uitleg').addEventListener('touchend', e => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -60) $('#uVolgende').click(); else if (dx > 60 && Uitleg.stap) $('#uOverslaan').click();
  });
})();
window.Uitleg = Uitleg;
// Hint zolang de stem luistert en er nog niets gezegd is
function toonStemHint(){
  const h = $('#stemHint');
  const aan = Stem.aan && huidigScherm === 'zoeken' && Date.now() - (Stem.laatsteKeer || 0) > 8000 && !$('#stemTekst').textContent;
  h.classList.toggle('open', !!aan);
}
setInterval(toonStemHint, 1000);
setInterval(() => { if ($('#stemTekst').textContent) $('#stemTekst').textContent = ''; }, 6000);

/* ================= NAVIGATIE ================= */
let huidigScherm = 'zoeken';
function kiesScherm(s){
  huidigScherm = s;
  $$('.scherm').forEach(x => x.classList.toggle('actief', x.id === s));
  $$('nav button').forEach(b => b.classList.toggle('aan', b.dataset.s === s));
  if (s === 'zoeken') { startCamera(); houdSchermAan(); } else if (!Route.sessie) stopCamera(); else stopCamera();
  if (s === 'kaart') { Kaart.init(); setTimeout(() => { Kaart.map && Kaart.map.invalidateSize(); if (GPS.laatste && Kaart.volgen) Kaart.map.setView([GPS.laatste.lat, GPS.laatste.lon], Math.max(Kaart.map.getZoom(), 18)); }, 60); }
  if (s === 'vondsten') toonLijst();
  if (s === 'instellingen') toonInstellingen();
}
$$('nav button').forEach(b => b.onclick = () => kiesScherm(b.dataset.s));

/* ================= KNOPPEN ================= */
$('#knop').addEventListener('click', e => { e.stopPropagation(); vondst('knop'); });
$('#zoeken').addEventListener('click', e => {
  if (!instel.heelScherm) return;
  if (e.target.closest('.bovenbalk') || e.target.closest('#laatste') || e.target.closest('#camUit') || e.target.closest('nav')) return;
  vondst('scherm');
});
$('#camAanKnop').onclick = e => { e.stopPropagation(); startCamera(); };
$('#routeKnop').onclick = e => { e.stopPropagation(); Route.sessie ? (confirm('Route stoppen?') && Route.uit()) : Route.aan(); };
$('#stemKnop').onclick = e => { e.stopPropagation(); if (Stem.aan) Stem.stop(); else { Stem.start(true); melding(NATIEF ? '🎤 Stem staat aan. Zeg “hebbes” of “vondst”. Werkt ook met je telefoon in je zak.' : '🎤 Stem staat aan. Zeg “hebbes”, “vondst” of “foto”.', 4000); } };
window.vondstExternKnop = () => { if (huidigScherm === 'zoeken' && !$('#detail').classList.contains('open')) vondst('knop-extern'); else melding('Ga naar Zoeken om met de knop een foto te maken'); };
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (huidigScherm !== 'zoeken') return;
  if (['Enter', ' ', 'AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown', 'MediaPlayPause', 'Camera'].includes(e.key)) {
    e.preventDefault(); vondst('knop-extern');
  }
});

/* ================= START ================= */
(async function start(){
  await DB.open();
  const rid = localStorage.getItem('v_route');
  if (rid) { const t = await DB.get('tracks', rid); if (t && !t.eind) Route.sessie = t; }
  Route.toon();
  startGps();
  startCamera();
  houdSchermAan();
  const vandaagStart = new Date(); vandaagStart.setHours(0, 0, 0, 0);
  sessieTeller = (await DB.all('finds')).filter(f => f.t >= vandaagStart.getTime()).length;
  if (sessieTeller) $('#teller').textContent = sessieTeller + (sessieTeller === 1 ? ' vondst' : ' vondsten') + ' vandaag vastgelegd';
  if (!instel.key) setTimeout(() => melding('Tip: zet je OpenAI-sleutel in Instellingen voor herkenning', 4000), 1500);
  Herken.allesWachtend();
  Lagen.laad();
  haalNatieveSpelden();
  setTimeout(() => Plek.vulOntbrekende(), 4000);
  if (!localStorage.getItem('v_uitleg_gezien')) Uitleg.open();
  if (Stem.gewenst) Stem.start(); // stem stond aan: meteen weer luisteren
  if (!NATIEF && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
