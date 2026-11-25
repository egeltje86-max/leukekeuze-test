// Zet de webapp (../vondst) klaar als Android-app en past het Android-project aan.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const hier = path.join(__dirname, '..');
const run = c => execSync(c, { cwd: hier, stdio: 'inherit' });

// 1. webbestanden kopiëren
const www = path.join(hier, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(path.join(hier, '..', 'vondst'), www, { recursive: true });
fs.rmSync(path.join(www, 'sw.js'), { force: true });
fs.copyFileSync(path.join(hier, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(www, 'capacitor.js'));
let html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
html = html.replace('<script src="https://unpkg.com/leaflet', '<script src="capacitor.js"></script>\n<script src="https://unpkg.com/leaflet');
fs.writeFileSync(path.join(www, 'index.html'), html);

// 2. Android-project maken
if (!fs.existsSync(path.join(hier, 'android'))) run('npx cap add android');

// 3. eigen MainActivity (volumeknoppen)
const javaMap = path.join(hier, 'android/app/src/main/java/nl/leukekeuze/vondst');
fs.mkdirSync(javaMap, { recursive: true });
fs.copyFileSync(path.join(hier, 'native/MainActivity.java'), path.join(javaMap, 'MainActivity.java'));

// 4. rechten in het manifest
const mf = path.join(hier, 'android/app/src/main/AndroidManifest.xml');
let m = fs.readFileSync(mf, 'utf8');
const rechten = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];
for (const r of rechten) if (!m.includes(r)) m = m.replace('</manifest>', '    ' + r + '\n</manifest>');
m = m.replace('<activity', '<activity android:screenOrientation="portrait"');
fs.writeFileSync(mf, m);

// 5. tekst van de meldingsbalk
const sx = path.join(hier, 'android/app/src/main/res/values/strings.xml');
let s = fs.readFileSync(sx, 'utf8');
if (!s.includes('capacitor_background_geolocation_notification_channel_name'))
  s = s.replace('</resources>', '    <string name="capacitor_background_geolocation_notification_channel_name">Route bijhouden</string>\n</resources>');
fs.writeFileSync(sx, s);

// 6. vaste ondertekening, zodat een nieuwe versie over de oude heen installeert (gegevens blijven bewaard)
const bg = path.join(hier, 'android/app/build.gradle');
let g = fs.readFileSync(bg, 'utf8');
if (!g.includes('vondst-debug.keystore')) g += `
android {
    signingConfigs {
        debug {
            storeFile file("../../vondst-debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
}
`;
fs.writeFileSync(bg, g);

// 7. alles synchroniseren
run('npx cap sync android');
console.log('Klaar: Android-project voorbereid.');
