package nl.leukekeuze.vondst;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;

// Luistert zonder internet en onafgebroken naar "hebbes" en "vondst", ook met het scherm op slot.
public class StemService extends Service implements RecognitionListener {
    static volatile boolean actief = false;
    static volatile boolean laden = false;
    static volatile String fout = "";
    private static final String KANAAL = "vondst_stem";
    private static final String WOORDEN = "[\"hebbes\", \"vondst\", \"gevonden\", \"[unk]\"]";
    private Model model;
    private SpeechService spraak;
    private long laatste = 0;
    private boolean wachtOpEinde = false;

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startVoorgrond();
        if (spraak == null && !laden) { laden = true; new Thread(this::laadEnStart).start(); }
        return START_STICKY;
    }

    private void startVoorgrond() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null)
            nm.createNotificationChannel(new NotificationChannel(KANAAL, "Stem (hebbes)", NotificationManager.IMPORTANCE_LOW));
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, KANAAL)
            .setContentTitle("Vondst luistert")
            .setContentText("Zeg \"hebbes\" om een vondst vast te leggen")
            .setSmallIcon(getApplicationInfo().icon)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= 30) startForeground(42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(42, n);
    }

    private void laadEnStart() {
        try {
            File doel = new File(getFilesDir(), "model-nl");
            File klaar = new File(doel, ".klaar");
            if (!klaar.exists()) { kopieer("model-nl", doel); klaar.createNewFile(); }
            model = new Model(doel.getAbsolutePath());
            Recognizer rec = new Recognizer(model, 16000.0f, WOORDEN);
            spraak = new SpeechService(rec, 16000.0f);
            spraak.startListening(this);
            actief = true;
            fout = "";
        } catch (Exception e) {
            fout = String.valueOf(e.getMessage());
            actief = false;
            stopSelf();
        } finally {
            laden = false;
        }
    }

    private void kopieer(String pad, File doel) throws IOException {
        AssetManager am = getAssets();
        String[] lijst = am.list(pad);
        if (lijst == null || lijst.length == 0) {
            File map = doel.getParentFile();
            if (map != null) map.mkdirs();
            try (InputStream in = am.open(pad); OutputStream out = new FileOutputStream(doel)) {
                byte[] b = new byte[65536];
                int n;
                while ((n = in.read(b)) > 0) out.write(b, 0, n);
            }
            return;
        }
        doel.mkdirs();
        for (String s : lijst) kopieer(pad + "/" + s, new File(doel, s));
    }

    private static String woordIn(String json) {
        if (json == null) return null;
        String t = json.toLowerCase();
        if (t.contains("hebbes")) return "hebbes";
        if (t.contains("vondst")) return "vondst";
        if (t.contains("gevonden")) return "gevonden";
        return null;
    }

    @Override
    public void onPartialResult(String hyp) {
        if (wachtOpEinde) return;
        String w = woordIn(hyp);
        if (w != null) { wachtOpEinde = true; gevonden(w); }
    }

    @Override
    public void onResult(String hyp) {
        if (wachtOpEinde) { wachtOpEinde = false; return; }
        String w = woordIn(hyp);
        if (w != null) gevonden(w);
    }

    @Override
    public void onFinalResult(String hyp) { onResult(hyp); }

    @Override
    public void onError(Exception e) { fout = String.valueOf(e.getMessage()); }

    @Override
    public void onTimeout() { }

    private void gevonden(String woord) {
        long nu = System.currentTimeMillis();
        if (nu - laatste < 2500) return;
        laatste = nu;
        final StemPlugin p = StemPlugin.instantie;
        if (p != null && p.voorgrond) {
            new Handler(Looper.getMainLooper()).post(() -> p.meldWoord(woord));
            bevestig(false);
        } else {
            Spelden.zet(this, woord);
            bevestig(true);
        }
    }

    private void bevestig(boolean speld) {
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= 26)
                    v.vibrate(VibrationEffect.createWaveform(speld ? new long[] { 0, 140, 110, 140 } : new long[] { 0, 70 }, -1));
                else v.vibrate(150);
            }
        } catch (Exception e) { }
        if (speld) {
            try {
                final ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90);
                tg.startTone(ToneGenerator.TONE_PROP_ACK, 250);
                new Handler(Looper.getMainLooper()).postDelayed(tg::release, 600);
            } catch (Exception e) { }
        }
    }

    @Override
    public void onDestroy() {
        actief = false;
        try { if (spraak != null) { spraak.stop(); spraak.shutdown(); } } catch (Exception e) { }
        spraak = null;
        try { if (model != null) model.close(); } catch (Exception e) { }
        model = null;
        super.onDestroy();
    }
}
