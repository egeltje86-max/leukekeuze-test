package nl.leukekeuze.vondst;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

// Volumeknoppen (en bluetooth-sluiterknopjes, die als volumeknop werken) maken een foto.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StemPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int k = event.getKeyCode();
        if (k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_CAMERA
                || k == KeyEvent.KEYCODE_HEADSETHOOK || k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0
                    && bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                        "window.vondstExternKnop && window.vondstExternKnop()", null));
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
