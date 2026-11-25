package nl.leukekeuze.vondst;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Brug tussen de app (JavaScript) en de eigen woordherkenner (StemService).
@CapacitorPlugin(name = "VondstStem", permissions = {
    @Permission(alias = "microfoon", strings = { android.Manifest.permission.RECORD_AUDIO })
})
public class StemPlugin extends Plugin {
    static volatile StemPlugin instantie;
    volatile boolean voorgrond = true;

    @Override
    public void load() { instantie = this; }

    @Override
    protected void handleOnResume() { voorgrond = true; }

    @Override
    protected void handleOnPause() { voorgrond = false; }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microfoon") != PermissionState.GRANTED) {
            requestPermissionForAlias("microfoon", call, "naToestemming");
            return;
        }
        startDienst();
        call.resolve();
    }

    @PermissionCallback
    private void naToestemming(PluginCall call) {
        if (getPermissionState("microfoon") == PermissionState.GRANTED) { startDienst(); call.resolve(); }
        else call.reject("Geen toestemming voor de microfoon");
    }

    private void startDienst() {
        Intent i = new Intent(getContext(), StemService.class);
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
        else getContext().startService(i);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), StemService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("actief", StemService.actief);
        r.put("bezig", StemService.laden);
        r.put("fout", StemService.fout);
        call.resolve(r);
    }

    @PluginMethod
    public void haalSpelden(PluginCall call) {
        JSObject r = new JSObject();
        r.put("json", Spelden.haalEnLeeg(getContext()));
        call.resolve(r);
    }

    void meldWoord(String woord) {
        JSObject d = new JSObject();
        d.put("woord", woord);
        notifyListeners("woord", d);
    }
}
