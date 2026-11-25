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
function startGps(){
  if (!('geolocation' in navigator)) { $('#gpsTekst').textContent = 'niet beschikbaar'; return; }
  navigator.geolocation.watchPosition(p => {
    const fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, t: Date.now() };
    GPS.laatste = fix;
    GPS.recent.push(fix);
    const grens = Date.now() - 30000;
    GPS.recent = GPS.recent.filter(f => f.t >= grens);
    toonGps();
    Route.punt(fix);
    Kaart.mijnPlek(fix);
    Lagen.check(fix);
    GPS.wachters.splice(0).forEach(w => w(fix));
  }, err => {
    $('#gpsTekst').textContent = err.code === 1 ? 'geen toestemming' : 'geen signaal';
    $('#gpsChip').className = 'chip slecht';
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  setInterval(toonGps, 3000);
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
}

/* ================= ROUTE ================= */
const Route = {
  sessie: null, wakeLock: null,
  async aan(){
    Route.sessie = { id: nieuwId(), start: Date.now(), eind: null, punten: [] };
    await DB.put('tracks', Route.sessie);
    localStorage.setItem('v_route', Route.sessie.id);
    Route.toon(); Kaart.verversRoutes();
    melding('Route staat aan');
    houdSchermAan();
  },
  async uit(){
    if (!Route.sessie) return;
    Route.sessie.eind = Date.now();
    await DB.put('tracks', Route.sessie);
    Route.sessie = null; localStorage.removeItem('v_route');
    Route.toon(); Kaart.verversRoutes();
    melding('Route gestopt en bewaard');
  },
  punt(fix){
    const s = Route.sessie; if (!s) return;
    if (fix.acc > 25) return; // te onnauwkeurig voor de route
    const p = [fix.lat, fix.lon, Math.round(fix.acc), fix.t];
    const vorige = s.punten[s.punten.length - 1];
    if (vorige && afstand(vorige, p) < Math.max(1.2, fix.acc * 0.25)) return;
    s.punten.push(p);
    Kaart.routePunt(p);
    if (s.punten.length % 5 === 0) DB.put('tracks', s);
    Route.toon();
  },
  lengte(s){ let m = 0; for (let i = 1; i < s.punten.length; i++) m += afstand(s.punten[i - 1], s.punten[i]); return m; },
  toon(){
    const k = $('#routeKnop'), s = Route.sessie;
    k.classList.toggle('aan', !!s);
    if (!s) { $('#routeTekst').textContent = 'uit'; return; }
    const min = Math.floor((Date.now() - s.start) / 60000);
    const m = Route.lengte(s);
    $('#routeTekst').textContent = (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m') + ' · ' + min + ' min';
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
  if (document.visibilityState === 'visible') { houdSchermAan(); if (huidigScherm === 'zoeken') startCamera(); if (Stem.gewenst) Stem.start(); }
  else { stopCamera(); Stem.pauze(); }
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
  const f = item.fotos[item.fotos.length - 1];
  const naam = item.eigenNaam || (item.ai && item.ai.naam) || (item.status === 'bezig' ? 'Herkennen…' : 'Opgeslagen');
  let sub = item.ai ? [item.ai.periode, item.ai.zekerheid != null ? item.ai.zekerheid + '% zeker' : ''].filter(Boolean).join(' · ')
    : (item.status === 'geenkey' ? 'Zet je OpenAI-sleutel in Instellingen' : item.status === 'wacht' ? 'Wacht op herkenning…' : '');
  l.innerHTML = `<img src="${fotoUrl(f.blob, item.id + f.t)}" alt=""><div class="tx"><div class="t">${esc(naam)}</div><div class="s">${esc(sub)}</div></div><span class="pijl">›</span>`;
  l.style.display = 'flex';
  l.onclick = () => openDetail(item.id);
  l.dataset.id = item.id;
}

/* ================= STEM ================= */
const Stem = {
  rec: null, aan: false, loopt: false, laatsteKeer: 0, laatsteStart: 0,
  get gewenst(){ return localStorage.getItem('v_stem') === '1'; },
  set gewenst(v){ localStorage.setItem('v_stem', v ? '1' : '0'); },
  start(handmatig){
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
        for (let j = 0; j < e.results[i].length; j++) {
          const t = e.results[i][j].transcript.toLowerCase();
          $('#stemTekst').textContent = '“' + e.results[i][0].transcript.trim() + '”';
          if (/\b(vondst|vonst|fonds|foto|hebbes|bingo)\b/.test(t) && Date.now() - Stem.laatsteKeer > 2500) {
            Stem.laatsteKeer = Date.now();
            vondst('stem');
            return;
          }
        }
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
    if (!Stem.rec || !Stem.aan || Stem.loopt || document.visibilityState !== 'visible') return;
    Stem.laatsteStart = Date.now();
    try { Stem.rec.start(); } catch (e) {}
  },
  pauze(){ // app weggeklikt: microfoon los, maar de stem blijft 'gewenst'
    Stem.loopt = false;
    try { Stem.rec && Stem.rec.abort(); } catch (e) {}
  },
  stop(){
    Stem.gewenst = false; Stem.aan = false; Stem.loopt = false; Stem.wachtOpTik(false);
    $('#stemKnop').classList.remove('aan'); $('#stemStatus').textContent = 'uit'; $('#stemTekst').textContent = '';
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
    if (!instel.key) { f.status = 'geenkey'; await DB.put('finds', f); Herken.na(f); return; }
    if (!navigator.onLine) { f.status = 'wacht'; await DB.put('finds', f); Herken.na(f); return; }
    f.status = 'bezig'; await DB.put('finds', f); Herken.na(f);
    try {
      const model = await Herken.kiesModel();
      const fotos = f.fotos.slice(-3);
      const beelden = [];
      for (const p of fotos) beelden.push(await blobNaarDataUrl(await verkleinFoto(p.blob, 1280, 0.85)));
      const context = `Vondst gedaan op ${datumTekst(f.t)}` + (f.lat ? ` bij GPS ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)} (Nederland/België)` : ' in Nederland') +
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
      f.ai = json;
      f.status = json.veiligheid === 'gevaarlijk' ? 'gevaar' : (+json.zekerheid >= 70 ? 'herkend' : 'onzeker');
      f.fout = null;
      await DB.put('finds', f);
      Herken.na(f);
      if (f.status === 'gevaar') toonGevaar(f);
      else { piep(660, .08); setTimeout(() => piep(990, .1), 110); }
    } catch (e) {
      f.status = 'wacht'; f.fout = String(e.message || e);
      await DB.put('finds', f); Herken.na(f);
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
    alle.filter(f => f.status === 'wacht' || f.status === 'geenkey').forEach(f => Herken.wachtrij(f.id));
  },
};
window.addEventListener('online', () => Herken.allesWachtend());

/* ================= GEVAAR ================= */
function toonGevaar(f){
  $('#gevaarTekst').textContent = (f.ai && (f.ai.naam + '. ' + (f.ai.veiligheid_uitleg || ''))) || '';
  $('#gevaarPlek').textContent = f.lat ? `Plek: ${f.lat.toFixed(6)}, ${f.lon.toFixed(6)} (± ${f.acc} m)` : '';
  $('#gevaar').classList.add('open');
  tril([400, 150, 400, 150, 600]);
  piep(520, .4);
}
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
    Lagen.opKaart(map);
    if (GPS.laatste) { map.setView([GPS.laatste.lat, GPS.laatste.lon], 19); Kaart.mijnPlek(GPS.laatste); }
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
    Kaart.routeLaag && Kaart.routeLaag.eachLayer(l => l.setStyle && l.setStyle({ weight: w }));
  },
  async verversRoutes(){
    if (!Kaart.map) return;
    Kaart.routeLaag.clearLayers();
    const tracks = await DB.all('tracks');
    const w = Kaart.breedtePx();
    for (const t of tracks) {
      if (t.punten.length < 2 && !(Route.sessie && t.id === Route.sessie.id)) continue;
      const actief = Route.sessie && t.id === Route.sessie.id;
      const lijn = L.polyline((actief ? Route.sessie : t).punten.map(p => [p[0], p[1]]), {
        color: actief ? '#ffd36b' : '#7fd1ff', opacity: actief ? 0.55 : 0.35, weight: w, lineCap: 'round', lineJoin: 'round',
      }).addTo(Kaart.routeLaag);
      if (actief) Kaart.actieveLijn = lijn;
    }
  },
  routePunt(p){ if (Kaart.actieveLijn) Kaart.actieveLijn.addLatLng([p[0], p[1]]); else Kaart.verversRoutes(); },
  async verversVondsten(){
    if (!Kaart.map) return;
    Kaart.vondstLaag.clearLayers();
    const alle = await DB.all('finds');
    for (const f of alle) {
      if (f.lat == null) continue;
      const kleur = f.status === 'gevaar' ? '#ff3b30' : f.status === 'herkend' ? '#3ecf6e' : f.status === 'onzeker' ? '#ffb020' : '#cccccc';
      const m = L.circleMarker([f.lat, f.lon], { radius: 9, color: '#000', weight: 2, fillColor: kleur, fillOpacity: 1 }).addTo(Kaart.vondstLaag);
      const foto = f.fotos[f.fotos.length - 1];
      const naam = f.eigenNaam || (f.ai && f.ai.naam) || 'Nog niet herkend';
      m.bindPopup(`<img src="${fotoUrl(foto.blob, f.id + foto.t)}"><b>${esc(naam)}</b><br>${esc(datumTekst(f.t))}<button class="popknop" onclick="openDetail('${f.id}')">Bekijk</button>`);
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

/* ================= HISTORISCHE LAGEN (van Nova, volgens lagen/index.json) ================= */
const PERIODES = {
  'prehistorie': 'Prehistorie', 'romeins': 'Romeinse tijd', 'vroege-middeleeuwen': 'Vroege middeleeuwen',
  'late-middeleeuwen': 'Late middeleeuwen', 'nieuwe-tijd': 'Nieuwe tijd', 'negentiende-eeuw': '19e eeuw',
  'wereldoorlogen': 'Wereldoorlogen', 'modern': 'Na 1945',
};
const GROEPEN = { 'veiligheid': 'Veiligheid', 'periode': 'Historische perioden', 'historische-kaart': 'Oude kaarten' };
const jaar = j => j == null || j === '' ? '' : (+j < 0 ? (-j) + ' v.Chr.' : String(j));
const Lagen = {
  lijst: [], data: {}, kaartLagen: {}, map: null, gewaarschuwd: '', laatsteCheck: 0,
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
    } catch (e) { Lagen.lijst = []; }
    // veiligheidslagen altijd vooraf laden, ook als de kaart nog niet open is geweest
    for (const l of Lagen.lijst) if (l.type === 'geojson' && (l.groep === 'veiligheid' || Lagen.aan(l))) Lagen.haalData(l);
    Lagen.toonMenu();
  },
  async haalData(l){
    if (Lagen.data[l.id]) return Lagen.data[l.id];
    try {
      const r = await fetch(l.url);
      if (!r.ok) throw new Error(r.status);
      Lagen.data[l.id] = await r.json();
    } catch (e) { melding('Laag "' + l.naam + '" kon niet geladen worden'); return null; }
    if (Lagen.map) Lagen.bijwerken();
    return Lagen.data[l.id];
  },
  opKaart(map){ Lagen.map = map; map.on('zoomend', Lagen.bijwerken); Lagen.bijwerken(); },
  maakLaag(l){
    if (l.type === 'xyz') return L.tileLayer(l.url, { maxZoom: 22, maxNativeZoom: l.maxNativeZoom || 19, opacity: l.doorzichtigheid ?? 0.75, attribution: l.naamsvermelding || '' });
    if (l.type === 'wms') return L.tileLayer.wms(l.url, { layers: l.wmsLagen || '', format: 'image/png', transparent: true, maxZoom: 22, opacity: l.doorzichtigheid ?? 0.75, attribution: l.naamsvermelding || '' });
    if (l.type === 'wmts') return L.tileLayer(l.url, { maxZoom: 22, maxNativeZoom: l.maxNativeZoom || 19, opacity: l.doorzichtigheid ?? 0.75, attribution: l.naamsvermelding || '' });
    if (l.type === 'geojson') {
      const gj = Lagen.data[l.id]; if (!gj) { Lagen.haalData(l); return null; }
      const kleur = l.kleur || '#f2b630';
      const verboden = l.groep === 'veiligheid';
      return L.geoJSON(gj, {
        attribution: l.naamsvermelding || '',
        style: f => (f && f.geometry && /Point/.test(f.geometry.type)) ? { radius: 8, color: '#000', weight: 1.5, fillColor: kleur, fillOpacity: .95 } : ({ color: kleur, weight: verboden ? 2.5 : 3, opacity: .95, fillColor: kleur, fillOpacity: verboden ? .28 : .18, dashArray: verboden ? '6 5' : null }),
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 7, color: '#000', weight: 1.5, fillColor: kleur, fillOpacity: .95 }),
        onEachFeature: (f, laag) => {
          const p = f.properties || {};
          const tijd = [jaar(p.van), jaar(p.tot)].filter(Boolean).join(' – ');
          const meta = [p.soort, PERIODES[p.periode] || p.periode, tijd].filter(Boolean).join(' · ');
          laag.bindPopup(`<div class="lpop"><b>${esc(p.naam || l.naam)}</b><div class="m">${esc(meta)}</div>${p.beschrijving ? esc(p.beschrijving) : ''}` +
            `${p.zekerheid ? `<div class="b">Zekerheid plek: ${esc(p.zekerheid)}${p.nauwkeurigheid_m ? ' (± ' + esc(p.nauwkeurigheid_m) + ' m)' : ''}</div>` : ''}` +
            `<div class="b">Bron: ${p.bron_url ? `<a href="${esc(p.bron_url)}" target="_blank" rel="noopener">${esc(p.bron || 'link')}</a>` : esc(p.bron || l.bron || '')}</div></div>`);
        },
      });
    }
    return null;
  },
  bijwerken(){
    const map = Lagen.map; if (!map) return;
    const z = map.getZoom();
    for (const l of Lagen.lijst) {
      const moet = Lagen.aan(l) && z >= (l.minZoom || 0);
      let k = Lagen.kaartLagen[l.id];
      if (moet && !k) { k = Lagen.maakLaag(l); if (k) { Lagen.kaartLagen[l.id] = k; k.addTo(map); if (l.type !== 'geojson') k.bringToBack(), Kaart.lagen[Kaart.laag].bringToBack(); } }
      else if (moet && k && !map.hasLayer(k)) k.addTo(map);
      else if (!moet && k && map.hasLayer(k)) map.removeLayer(k);
    }
    // vondsten en route altijd bovenop
    Kaart.routeLaag && Kaart.routeLaag.eachLayer(x => x.bringToFront && x.bringToFront());
    Kaart.vondstLaag && Kaart.vondstLaag.eachLayer(x => x.bringToFront && x.bringToFront());
    Lagen.toonMenu();
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
    const groepen = {};
    for (const l of Lagen.lijst) (groepen[l.groep || 'overig'] = groepen[l.groep || 'overig'] || []).push(l);
    const volgorde = ['veiligheid', 'periode', 'historische-kaart', ...Object.keys(groepen)].filter((g, i, a) => groepen[g] && a.indexOf(g) === i);
    el.innerHTML = volgorde.map(g => `<div class="lgroep">${esc(GROEPEN[g] || g)}</div>` + groepen[g].map(l => {
      const aan = Lagen.aan(l), vast = l.uitzetbaar === false;
      const sub = [l.periode && PERIODES[l.periode] !== l.naam && PERIODES[l.periode], vast ? 'staat altijd aan' : '', aan && l.minZoom && z < l.minZoom ? 'zoom verder in' : ''].filter(Boolean).join(' · ');
      return `<button class="lrij ${aan ? 'aan' : ''} ${vast ? 'vast' : ''}" onclick="Lagen.wissel('${esc(l.id)}')">
        <span class="kl" style="background:${esc(l.kleur || '#888')}"></span>
        <span class="nm">${esc(l.naam)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="schakel"></span></button>`;
    }).join('')).join('');
  },
  // waarschuwing als je een 'niet zoeken'-gebied binnenloopt
  check(fix){
    if (Date.now() - Lagen.laatsteCheck < 4000) return;
    Lagen.laatsteCheck = Date.now();
    let treffer = '';
    for (const l of Lagen.lijst) {
      if (l.groep !== 'veiligheid' || !Lagen.aan(l) || !Lagen.data[l.id]) continue;
      for (const f of Lagen.data[l.id].features || []) {
        if (inGebied([fix.lon, fix.lat], f.geometry)) { treffer = (f.properties && f.properties.naam) || l.naam; break; }
      }
      if (treffer) break;
    }
    const b = $('#nietZoeken');
    if (treffer) {
      $('#nietZoekenNaam').textContent = treffer;
      b.classList.add('open');
      if (Lagen.gewaarschuwd !== treffer) { Lagen.gewaarschuwd = treffer; tril([300, 120, 300]); piep(440, .3); melding('⛔ Hier mag je niet zoeken: ' + treffer, 5000); }
    } else { b.classList.remove('open'); Lagen.gewaarschuwd = ''; }
  },
};
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
  wacht: ['l-wacht', 'Wacht op AI'], bezig: ['l-wacht', 'Bezig…'], geenkey: ['l-wacht', 'Geen AI-sleutel'],
};
async function toonLijst(){
  let alle = (await DB.all('finds')).sort((a, b) => b.t - a.t);
  if (filter === 'onzeker') alle = alle.filter(f => f.status === 'onzeker');
  if (filter === 'wacht') alle = alle.filter(f => ['wacht', 'geenkey', 'bezig'].includes(f.status));
  if (filter === 'gevaar') alle = alle.filter(f => f.status === 'gevaar');
  if (filter === 'pan') alle = alle.filter(f => f.panGemeld);
  const l = $('#lijst');
  if (!alle.length) { l.innerHTML = '<div class="leeg">Nog geen vondsten hier.<br>Ga naar Zoeken en druk op de gouden knop.</div>'; return; }
  l.innerHTML = alle.map(f => {
    const foto = f.fotos[f.fotos.length - 1];
    const naam = f.eigenNaam || (f.ai && f.ai.naam) || 'Nog niet herkend';
    const sub = f.ai ? [f.ai.periode, f.ai.materiaal].filter(Boolean).join(' · ') : '';
    const [kl, tk] = statusLabel[f.status] || statusLabel.wacht;
    return `<button class="kaartje ${f.status === 'gevaar' ? 'gevaar' : ''}" onclick="openDetail('${f.id}')">
      <img src="${fotoUrl(foto.blob, f.id + foto.t)}" alt="">
      <div><div class="naam">${esc(naam)}</div><div class="sub">${esc(sub)}</div><div class="sub">${esc(datumTekst(f.t))}</div>
      <span class="label ${kl}">${tk}${f.ai && f.status !== 'gevaar' ? ' · ' + f.ai.zekerheid + '%' : ''}</span>${f.panGemeld ? '<span class="label l-pan">PAN</span>' : ''}</div>
    </button>`;
  }).join('');
}
$('#filters').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f; $$('#filters button').forEach(x => x.classList.toggle('aan', x === b)); toonLijst();
};

/* ================= DETAIL ================= */
async function openDetail(id){
  const f = await DB.get('finds', id); if (!f) return;
  const d = $('#detail'); d.dataset.id = id;
  const a = f.ai || {};
  const naam = f.eigenNaam || a.naam || 'Nog niet herkend';
  const [kl, tk] = statusLabel[f.status] || statusLabel.wacht;
  const rij = (k, v) => v ? `<div class="rij"><span>${k}</span><span>${esc(v)}</span></div>` : '';
  d.innerHTML = `
    <div class="terug"><button onclick="sluitDetail()">← Terug</button><div style="font-weight:800;font-size:18px">${esc(naam)}</div></div>
    <div class="fotos">${f.fotos.map((p, i) => `<figure><img src="${fotoUrl(p.blob, f.id + p.t)}" alt=""><figcaption>Foto ${i + 1} · ${p.soort === 'veld' ? 'in het veld' : 'thuis / schoon'} · ${esc(datumTekst(p.t))}</figcaption></figure>`).join('')}</div>
    ${a.veiligheid ? `<div class="veiligbalk v-${a.veiligheid}">${a.veiligheid === 'gevaarlijk' ? '⚠️ GEVAARLIJK – niet aanraken, politie bellen (0900-8844).' : a.veiligheid === 'voorzichtig' ? '⚠️ Voorzichtig.' : '✓ Veilig.'} ${esc(a.veiligheid_uitleg || '')}</div>` : ''}
    <div class="blok">
      <h3>Wat is het?</h3>
      <span class="label ${kl}">${tk}</span>
      ${a.zekerheid != null ? `<div style="margin-top:8px;font-size:14px;color:var(--zacht)">Zekerheid ${a.zekerheid}%</div><div class="balk"><div style="width:${+a.zekerheid || 0}%"></div></div>` : ''}
      ${a.beschrijving ? `<p>${esc(a.beschrijving)}</p>` : f.status === 'geenkey' ? '<p>Zet je OpenAI-sleutel in Instellingen, dan wordt deze vondst herkend.</p>' : f.fout ? `<p>Laatste poging mislukte: ${esc(f.fout)}</p>` : '<p>Nog niet herkend.</p>'}
      ${rij('Categorie', a.categorie)}${rij('Periode', a.periode)}${rij('Datering', a.datering)}${rij('Materiaal', a.materiaal)}${rij('Merk / model', a.merk_model)}${rij('Zeldzaamheid', a.zeldzaamheid)}${rij('Waarde (grof)', a.waarde_indicatie)}
    </div>
    ${a.herkenningstekens ? `<div class="blok"><h3>Waaraan herkend</h3><p>${esc(a.herkenningstekens)}</p></div>` : ''}
    ${a.alternatieven && a.alternatieven.length ? `<div class="blok"><h3>Kan ook zijn</h3><p>${a.alternatieven.map(esc).join('<br>')}</p></div>` : ''}
    ${a.foto_advies ? `<div class="blok"><h3>Tip voor een betere foto</h3><p>${esc(a.foto_advies)}</p></div>` : ''}
    ${a.schoonmaak_advies ? `<div class="blok"><h3>Schoonmaken</h3><p>${esc(a.schoonmaak_advies)}</p></div>` : ''}
    <div class="knoppen">
      <button class="groot kleur kgoud breed" onclick="extraFoto('${f.id}')">📷 Nieuwe foto toevoegen (schoongemaakt)</button>
      <button class="groot kleur kpaars" onclick="Herken.wachtrij('${f.id}')">🔄 Opnieuw herkennen</button>
      <button class="groot kleur kblauw" onclick="toonOpKaart('${f.id}')">🗺️ Op de kaart</button>
      <button class="groot kleur kgroen breed" onclick="meldPan('${f.id}')">🏛️ ${f.panGemeld ? 'Gemeld bij PAN ✓ (opnieuw openen)' : 'Melden bij PAN (jouw keuze)'}</button>
    </div>
    <div class="blok">
      <h3>Vindplek</h3>
      ${f.lat != null ? rij('Coördinaten', f.lat.toFixed(6) + ', ' + f.lon.toFixed(6)) + rij('Nauwkeurigheid', '± ' + f.acc + ' m' + (f.gpsMetingen ? ' (' + f.gpsMetingen + ' metingen)' : '')) : '<p>Geen GPS-plek opgeslagen.</p>'}
      ${rij('Datum en tijd', datumTekst(f.t))}
    </div>
    <div class="blok">
      <h3>Eigen gegevens</h3>
      <div class="veld"><label>Eigen naam (overschrijft de AI)</label><input id="dNaam" value="${esc(f.eigenNaam)}"></div>
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
  f.eigenNaam = $('#dNaam').value.trim(); f.diepte = $('#dDiepte').value.trim(); f.notitie = $('#dNotitie').value.trim();
  await DB.put('finds', f); melding('Opgeslagen'); openDetail(id); Kaart.verversVondsten();
}
async function extraFoto(id){
  const blob = await vraagFoto(); if (!blob) return;
  const f = await DB.get('finds', id);
  f.fotos.push({ blob: await verkleinFoto(blob, 1800, 0.88), t: Date.now(), soort: 'thuis' });
  await DB.put('finds', f);
  melding('Foto toegevoegd, opnieuw herkennen…');
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
  const c = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rijen = finds.map(f => { const a = f.ai || {}; return [new Date(f.t).toLocaleString('nl-NL'), f.eigenNaam || a.naam, a.categorie, a.periode, a.datering, a.materiaal, a.zekerheid, a.veiligheid, f.lat, f.lon, f.acc, f.diepte, f.notitie, f.panGemeld ? 'ja' : ''].map(c).join(';'); });
  download('vondsten-' + vandaag() + '.csv', '﻿' + kol.join(';') + '\n' + rijen.join('\n'), 'text/csv');
};
$('#exportGpx').onclick = async () => {
  const finds = await DB.all('finds'), tracks = await DB.all('tracks');
  const x = s => esc(s);
  let g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Vondst" xmlns="http://www.topografix.com/GPX/1/1">\n';
  for (const f of finds) if (f.lat != null) g += `<wpt lat="${f.lat}" lon="${f.lon}"><time>${new Date(f.t).toISOString()}</time><name>${x(f.eigenNaam || (f.ai && f.ai.naam) || 'Vondst')}</name><desc>${x((f.ai && f.ai.beschrijving) || '')}</desc></wpt>\n`;
  for (const t of tracks) if (t.punten.length > 1) g += `<trk><name>Route ${x(datumTekst(t.start))}</name><trkseg>${t.punten.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[3]).toISOString()}</time></trkpt>`).join('')}</trkseg></trk>\n`;
  download('vondsten-' + vandaag() + '.gpx', g + '</gpx>', 'application/gpx+xml');
};
$('#allesWissen').onclick = async () => {
  if (!confirm('ALLE vondsten en routes wissen? Dit kan niet ongedaan worden.')) return;
  if (!confirm('Echt zeker? Maak eventueel eerst een back-up.')) return;
  await DB.clear('finds'); await DB.clear('tracks'); Route.sessie = null; localStorage.removeItem('v_route'); Route.toon();
  Kaart.verversRoutes(); Kaart.verversVondsten(); toonLijst(); melding('Alles gewist');
};

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
$('#stemKnop').onclick = e => { e.stopPropagation(); Stem.aan ? Stem.stop() : Stem.start(true); };
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
  if (Stem.gewenst) Stem.start(); // stem stond aan: meteen weer luisteren
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
